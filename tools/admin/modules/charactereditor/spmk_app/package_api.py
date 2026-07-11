"""FastAPI routes for .charbin character package authoring."""
from __future__ import annotations

import shutil
import zipfile
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from spmk_app.character_package import (
    empty_package,
    load_sprite_profiles,
    package_from_charbin_bytes,
    package_to_charbin_bytes,
    validate_package,
)
from spmk_app.package_store import PackageStore

router = APIRouter(prefix="/api/packages", tags=["packages"])

_store: PackageStore | None = None


def init_package_api(spmk_root: Path, workspace: Path, exports: Path) -> None:
    global _store
    _store = PackageStore(spmk_root, workspace, exports)
    _store.ensure_ready()


def _store_or_500() -> PackageStore:
    if _store is None:
        raise HTTPException(500, "package store not initialized")
    return _store


def delete_package_by_id(package_id: str) -> Dict[str, Any]:
    """Delete ``{package_id}.charbin`` from the library folder."""
    st = _store_or_500()
    path = st.charbin_path_for_package_id(package_id)
    if not path.is_file():
        raise FileNotFoundError(package_id)
    st.delete_charbin(str(path))
    return {"ok": True, "path": str(path), "id": package_id}


def delete_package_by_path(path: str) -> Dict[str, Any]:
    st = _store_or_500()
    st.delete_charbin(path)
    return {"ok": True, "path": path}


def thumbnail_png_for_id(package_id: str) -> bytes:
    st = _store_or_500()
    data = st.get_thumbnail_png_by_id(package_id)
    if not data:
        raise HTTPException(404, "no embedded sheet asset for thumbnail")
    return data


@router.get("/profiles")
def get_profiles():
    return load_sprite_profiles()


@router.get("/settings")
def get_settings():
    st = _store_or_500()
    draft = st.load_draft()
    body = st.ensure_ready()
    body["hasDraft"] = draft is not None
    if draft:
        body["draftMeta"] = draft.get("meta")
        body["draftId"] = (draft.get("package") or {}).get("id")
    return body


@router.get("/llm/settings")
def get_llm_settings():
    from spmk_app.llm_service import public_settings

    return public_settings(_store_or_500().workspace)


@router.post("/llm/settings")
def set_llm_settings(payload: Dict[str, Any]):
    from spmk_app.llm_service import save_settings

    try:
        return save_settings(_store_or_500().workspace, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/llm/models")
def get_llm_models():
    from spmk_app.llm_service import available_models

    return available_models(_store_or_500().workspace)


@router.post("/llm/intel/from-name")
def llm_intel_from_name(payload: Dict[str, Any]):
    from spmk_app.llm_service import LlmServiceError, generate_intel

    try:
        return generate_intel(_store_or_500().workspace, known_name=str(payload.get("name") or ""))
    except LlmServiceError as exc:
        raise HTTPException(400, {"message": str(exc), "diagnostics": exc.diagnostics}) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/llm/intel/from-sprite")
async def llm_intel_from_sprite(
    file: UploadFile = File(...),
    knownName: str = Form(""),
    stage: str = Form("profile"),
):
    from spmk_app.llm_service import LlmServiceError, generate_intel

    image = await file.read()
    if not image:
        raise HTTPException(400, "sprite sheet is required")
    try:
        return generate_intel(
            _store_or_500().workspace,
            known_name=knownName,
            image_bytes=image,
            image_type=file.content_type or "image/png",
            stage=stage,
        )
    except LlmServiceError as exc:
        raise HTTPException(400, {"message": str(exc), "diagnostics": exc.diagnostics}) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/settings/reset-directory")
def reset_directory():
    """Restore package directory to default ``assets/characters`` (game repo when present)."""
    from spmk_app.package_paths import default_characters_dir

    st = _store_or_500()
    return st.set_package_directory(str(default_characters_dir(st.spmk_root)))


@router.post("/settings/directory")
def set_directory(payload: Dict[str, Any]):
    path = payload.get("packageDirectory") or payload.get("path") or ""
    if not path:
        raise HTTPException(400, "packageDirectory required")
    st = _store_or_500()
    return st.set_package_directory(path)


@router.post("/delete/{package_id}")
def delete_charbin_by_id(package_id: str):
    """Delete a library character by id (preferred)."""
    try:
        return delete_package_by_id(package_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/file")
def delete_charbin_file(payload: Dict[str, Any] = Body(...)):
    path = payload.get("path") or ""
    if not path:
        raise HTTPException(400, "path required")
    try:
        return delete_package_by_path(path)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/thumb/{package_id}")
def package_thumbnail_by_id(package_id: str):
    """PNG preview of base_down (south row, column 0) for library cards."""
    try:
        return Response(content=thumbnail_png_for_id(package_id), media_type="image/png")
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/library-thumb/{package_id}")
def package_library_thumbnail(package_id: str):
    """Alias for ``/thumb/{package_id}`` (library card sprites)."""
    return package_thumbnail_by_id(package_id)


@router.get("/thumbnail")
def package_thumbnail(path: str):
    """Legacy: thumbnail by absolute path (prefer ``/thumb/{package_id}``)."""
    if not path:
        raise HTTPException(400, "path query required")
    st = _store_or_500()
    try:
        data = st.get_package_thumbnail_png(path)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not data:
        raise HTTPException(404, "no embedded sheet asset for thumbnail")
    return Response(content=data, media_type="image/png")


@router.get("/library")
def get_library():
    st = _store_or_500()
    settings = st.ensure_ready()
    return {
        "packageDirectory": settings.get("packageDirectory"),
        "defaultDirectory": settings.get("defaultDirectory"),
        "packages": settings.get("scannedPackages") or [],
        "lastScanAt": settings.get("lastScanAt"),
    }


@router.post("/scan")
def scan_packages():
    st = _store_or_500()
    st.scan_packages()
    return {"packages": st.load_settings().get("scannedPackages") or []}


@router.get("/draft")
def get_draft():
    st = _store_or_500()
    draft = st.load_draft()
    if not draft:
        return {"package": None, "assetIds": []}
    pkg = draft.get("package")
    assets = draft.get("_assets") or {}
    return {
        "package": pkg,
        "meta": draft.get("meta"),
        "assetIds": list(assets.keys()),
        "assetSizes": {k: len(v) for k, v in assets.items()},
    }


@router.get("/pokemon/lookup")
def pokemon_lookup(q: str = ""):
    from spmk_app.pokeapi_client import lookup_pokemon

    if not (q or "").strip():
        raise HTTPException(400, "q required")
    try:
        return lookup_pokemon(q)
    except Exception as exc:
        raise HTTPException(502, f"PokéAPI error: {exc}") from exc


@router.get("/item/lookup")
def item_lookup(q: str = ""):
    from spmk_app.pokeapi_client import lookup_item

    if not (q or "").strip():
        raise HTTPException(400, "q required")
    try:
        return lookup_item(q)
    except Exception as exc:
        raise HTTPException(502, f"PokéAPI error: {exc}") from exc


@router.post("/batch/import-sprites")
async def batch_import_sprites(
    characterType: str = Form(...),
    files: list[UploadFile] = File(...),
    animationVariant: str = Form(""),
    importMode: str = Form("create"),
    importBehavior: str = Form(""),
    formKind: str = Form("default"),
):
    """Import many PNG/WebP sprites as charbins (one characterType per request)."""
    from spmk_app.package_batch import batch_import_sprites as run_batch

    if not files:
        raise HTTPException(400, "at least one file required")
    pairs: list[tuple[str, bytes]] = []
    for uf in files:
        data = await uf.read()
        pairs.append((uf.filename or "sprite.png", data))
    try:
        return run_batch(
            _store_or_500(),
            characterType,
            pairs,
            animation_variant=animationVariant,
            import_mode=importMode,
            import_behavior=importBehavior,
            form_kind=formKind,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/draft/new")
def draft_new(payload: Dict[str, Any]):
    cid = (payload.get("id") or "new_character").strip()
    name = payload.get("displayName") or payload.get("name") or cid
    char_type = (payload.get("characterType") or "npc").strip().lower()
    if char_type == "playable":
        char_type = "player"
    base_profile = payload.get("baseProfile")
    replace_existing = bool(payload.get("replaceExisting"))
    return _store_or_500().open_new(
        cid, name, character_type=char_type, base_profile=base_profile,
        replace_existing=replace_existing,
    )


@router.post("/draft/open-path")
def draft_open_path(payload: Dict[str, Any]):
    path = payload.get("path") or ""
    if not path:
        raise HTTPException(400, "path required")
    try:
        return _store_or_500().open_charbin_path(path)
    except FileNotFoundError:
        raise HTTPException(404, "file not found") from None
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/draft/import")
async def draft_import(file: UploadFile = File(...)):
    data = await file.read()
    try:
        package, assets = package_from_charbin_bytes(data)
    except Exception as exc:
        raise HTTPException(400, f"invalid charbin: {exc}") from exc
    st = _store_or_500()
    try:
        saved = st.import_to_library(package, assets)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "package": package,
        "assetIds": list(assets.keys()),
        "path": saved,
    }


def _draft_response(draft: Dict[str, Any] | None) -> Dict[str, Any]:
    if not draft:
        return {"package": None, "assetIds": []}
    assets = draft.get("_assets") or {}
    return {
        "package": draft.get("package"),
        "meta": draft.get("meta"),
        "assetIds": list(assets.keys()),
        "assetSizes": {k: len(v) for k, v in assets.items()},
    }


@router.patch("/draft")
def draft_patch(payload: Dict[str, Any]):
    try:
        _store_or_500().patch_draft(payload)
        return _draft_response(_store_or_500().load_draft())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/draft/npc-intel/apply")
def draft_apply_npc_intel(payload: Dict[str, Any]):
    intel = payload.get("intel")
    if not isinstance(intel, dict):
        raise HTTPException(400, "intel object required")
    replace_id = bool(payload.get("replaceId"))
    reasoning = payload.get("reasoning")
    profile = payload.get("profile")
    try:
        from spmk_app.npc_intel import validate_intel_for_package

        report = validate_intel_for_package(profile if isinstance(profile, dict) else intel)
        _store_or_500().apply_npc_intel_draft(report["intel"], replace_id=replace_id)
        custom = {}
        if isinstance(profile, dict):
            custom["characterProfile"] = profile
        if isinstance(reasoning, dict):
            custom["generationReasoning"] = reasoning
        if custom:
            _store_or_500().patch_draft({"metadata": {"custom": custom}})
        draft = _store_or_500().load_draft()
        return {
            "ok": True,
            "validation": report,
            "package": (draft or {}).get("package"),
            "assetIds": list(((draft or {}).get("_assets") or {}).keys()),
        }
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/draft/npc-intel")
def draft_get_npc_intel():
    draft = _store_or_500().load_draft()
    if not draft:
        raise HTTPException(404, "no draft")
    from spmk_app.npc_intel import intel_from_package

    package = draft.get("package") or empty_package()
    return {"intel": intel_from_package(package)}


@router.post("/draft/npc-intel/validate")
def draft_validate_npc_intel(payload: Dict[str, Any]):
    intel = payload.get("intel")
    if not isinstance(intel, dict):
        raise HTTPException(400, "intel object required")
    from spmk_app.npc_intel import validate_intel_for_package

    return validate_intel_for_package(intel)


@router.post("/draft/asset")
async def draft_upload_asset(
    assetId: str = Form(...),
    file: UploadFile = File(...),
    profile: str = Form(""),
):
    if not assetId:
        raise HTTPException(400, "assetId required")
    data = await file.read()
    profile_name = profile.strip() or None
    try:
        prep = _store_or_500().put_draft_asset(assetId, data, profile_name=profile_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "assetId": assetId, "bytes": len(data), "prepare": prep}


@router.post("/draft/add-sheet")
async def draft_add_sheet(
    file: UploadFile = File(...),
    mode: str = Form("primary"),
    label: str = Form(""),
    walkSheetId: str = Form("walk"),
    animKind: str = Form("movement"),
    includeIdle: str = Form("0"),
    frameCount: int = Form(4),
    frameTimeMs: int = Form(120),
    sessionEnterFrames: str = Form(""),
    sessionStayFrames: str = Form(""),
    sessionExitFrames: str = Form(""),
):
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    try:
        result = _store_or_500().add_draft_sheet(
            data,
            mode=mode,
            label=label,
            walk_sheet_id=walkSheetId,
            anim_kind=animKind,
            include_idle=includeIdle.strip().lower() in ("1", "true", "yes", "on"),
            frame_count=max(1, min(4, frameCount)),
            frame_time_ms=max(50, frameTimeMs),
            session_enter_frames=sessionEnterFrames,
            session_stay_frames=sessionStayFrames,
            session_exit_frames=sessionExitFrames,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {**_draft_response(_store_or_500().load_draft()), **result}


@router.get("/draft/asset/{asset_id}")
def draft_asset(asset_id: str):
    draft = _store_or_500().load_draft()
    if not draft:
        raise HTTPException(404, "no draft")
    assets = draft.get("_assets") or {}
    if asset_id not in assets:
        raise HTTPException(404, "asset not found")
    tmp = _store.exports / f"_preview_{asset_id}.png"
    tmp.write_bytes(assets[asset_id])
    return FileResponse(tmp, media_type="image/png")


@router.post("/validate")
def validate_draft(payload: Dict[str, Any] | None = None):
    st = _store_or_500()
    if payload and payload.get("package"):
        assets = payload.get("assets") or {}
        if isinstance(assets, dict) and assets and isinstance(next(iter(assets.values())), str):
            assets = {}
        return validate_package(payload["package"], assets if assets else None)
    return st.validate_draft()


@router.post("/save")
def save_draft(payload: Dict[str, Any]):
    path = payload.get("path")
    try:
        saved = _store_or_500().save_draft_to_path(path)
        return {"ok": True, "path": saved}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@router.get("/export/charbin")
def export_charbin_download():
    draft = _store_or_500().load_draft()
    if not draft:
        raise HTTPException(404, "no draft")
    package = draft.get("package") or empty_package()
    assets = draft.get("_assets") or {}
    from spmk_app.character_package import collect_assets_from_package

    blob = package_to_charbin_bytes(package, collect_assets_from_package(package, assets))
    st = _store_or_500()
    out = st.exports / f"{package.get('id', 'character')}.charbin"
    out.write_bytes(blob)
    return FileResponse(out, filename=out.name, media_type="application/octet-stream")


@router.get("/quick-anim/stats")
def quick_anim_stats(anim: str = ""):
    from spmk_app.package_quick_anim import count_pokemon_missing_animation, normalize_anim_id

    try:
        anim_id = normalize_anim_id(anim)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st = _store_or_500()
    return {"animId": anim_id, "missing": count_pokemon_missing_animation(st, anim_id)}


@router.get("/quick-anim/next")
def quick_anim_next(anim: str = "", after: str = "", afterWalkSheet: str = ""):
    from spmk_app.package_quick_anim import find_next_pokemon_missing_animation, normalize_anim_id

    try:
        anim_id = normalize_anim_id(anim)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    entry = find_next_pokemon_missing_animation(
        _store_or_500(),
        anim_id,
        after_path=after,
        after_walk_sheet=afterWalkSheet,
    )
    if not entry:
        return {"done": True, "animId": anim_id}
    return {"done": False, "animId": anim_id, "entry": entry}


@router.get("/quick-anim/base-frame")
def quick_anim_base_frame(path: str = "", walkSheet: str = "walk"):
    from spmk_app.package_quick_anim import extract_pokemon_base_frame_png

    if not path:
        raise HTTPException(400, "path required")
    st = _store_or_500()
    try:
        resolved = st.resolve_charbin_path(path)
        png, profile = extract_pokemon_base_frame_png(resolved, walkSheet or "walk")
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={"X-SPMK-Profile": profile},
    )


@router.post("/quick-anim/apply")
async def quick_anim_apply(
    path: str = Form(...),
    anim: str = Form(...),
    walkSheet: str = Form("walk"),
    frameTimeMs: int = Form(400),
    frame0: UploadFile = File(...),
    frame1: UploadFile | None = File(None),
    frame2: UploadFile | None = File(None),
    frame3: UploadFile | None = File(None),
):
    from spmk_app.package_quick_anim import apply_quick_anim_to_path, normalize_anim_id

    try:
        anim_id = normalize_anim_id(anim)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st = _store_or_500()
    try:
        resolved = st.resolve_charbin_path(path)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    frames = [await frame0.read()]
    for extra in (frame1, frame2, frame3):
        if extra is not None:
            data = await extra.read()
            if data:
                frames.append(data)
    try:
        result = apply_quick_anim_to_path(
            resolved,
            anim_id,
            frames,
            walk_sheet_id=walkSheet or "walk",
            frame_time_ms=frameTimeMs,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st.scan_packages()
    return {"ok": True, **result}


@router.get("/generate/overview")
def generate_overview():
    from spmk_app.package_generate import count_missing_output_slots
    from spmk_app.package_generate_learn import (
        BEHAVIOR_TRAIN,
        count_training_sources_from_library,
        model_summary,
    )

    st = _store_or_500()
    behaviors = []
    for behavior in BEHAVIOR_TRAIN:
        cfg = BEHAVIOR_TRAIN[behavior]
        behaviors.append({
            "outputBehavior": behavior,
            "label": behavior.capitalize(),
            "directions": list(cfg["directions"]),
            "framesPerDirection": int(cfg["framesPerDirection"]),
            "missing": count_missing_output_slots(st, behavior),
            "librarySources": count_training_sources_from_library(st, behavior),
            "model": model_summary(st.workspace, behavior),
        })
    return {"behaviors": behaviors}


@router.get("/generate/stats")
def generate_stats(outputBehavior: str = "swim"):
    from spmk_app.package_generate import count_missing_output_slots, normalize_output_behavior

    try:
        behavior = normalize_output_behavior(outputBehavior)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st = _store_or_500()
    from spmk_app.package_generate_learn import model_summary

    return {
        "outputBehavior": behavior,
        "missing": count_missing_output_slots(st, behavior),
        "model": model_summary(st.workspace, behavior),
    }


@router.get("/generate/targets")
def generate_targets(
    outputBehavior: str = "swim",
    missingOnly: bool = True,
    q: str = "",
):
    from spmk_app.package_generate import iter_generate_slots, normalize_output_behavior

    try:
        behavior = normalize_output_behavior(outputBehavior)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st = _store_or_500()
    slots = iter_generate_slots(st, behavior, missing_only=bool(missingOnly))
    query = (q or "").strip().lower()
    if query:
        slots = [
            s
            for s in slots
            if query in (s.get("displayName") or "").lower()
            or query in (s.get("packageId") or "").lower()
            or query in (s.get("variantLabel") or "").lower()
        ]
    return {"outputBehavior": behavior, "missingOnly": bool(missingOnly), "targets": slots}


@router.get("/generate/next")
def generate_next(
    outputBehavior: str = "swim",
    after: str = "",
    afterWalkSheet: str = "",
):
    from spmk_app.package_generate import find_next_missing_slot, normalize_output_behavior

    try:
        behavior = normalize_output_behavior(outputBehavior)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    entry = find_next_missing_slot(
        _store_or_500(),
        behavior,
        after_path=after,
        after_walk_sheet=afterWalkSheet,
    )
    if not entry:
        return {"done": True, "outputBehavior": behavior}
    return {"done": False, "outputBehavior": behavior, "entry": entry}


@router.get("/generate/slot")
def generate_slot(path: str = "", walkSheet: str = "walk", outputBehavior: str = "swim"):
    from spmk_app.package_generate import describe_generate_slot, normalize_output_behavior

    if not path:
        raise HTTPException(400, "path required")
    try:
        behavior = normalize_output_behavior(outputBehavior)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st = _store_or_500()
    try:
        return describe_generate_slot(st, path, walkSheet or "walk", behavior)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/generate/model")
def generate_model(outputBehavior: str = "swim", detail: bool = False):
    from spmk_app.package_generate import normalize_output_behavior
    from spmk_app.package_generate_learn import count_training_sources_from_library, model_summary

    try:
        behavior = normalize_output_behavior(outputBehavior)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st = _store_or_500()
    out = model_summary(st.workspace, behavior, detail=bool(detail))
    if not out.get("trained"):
        out["librarySources"] = count_training_sources_from_library(st, behavior)
    return out


@router.post("/generate/train")
async def generate_train(payload: Dict[str, Any] = Body(...)):
    from spmk_app.package_generate import normalize_output_behavior
    from spmk_app.package_generate_learn import train_behavior_from_charbins

    try:
        behavior = normalize_output_behavior(str(payload.get("outputBehavior") or "swim"))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st = _store_or_500()
    try:
        model = train_behavior_from_charbins(st, behavior)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "ok": True,
        "outputBehavior": behavior,
        "trainingSourceCount": model.get("trainingSourceCount"),
        "trainedFrameCount": sum(len(v) for v in (model.get("learnedFrames") or {}).values()),
        "trainedAt": model.get("trainedAt"),
        "quality": model.get("quality"),
    }


@router.post("/generate/preview")
async def generate_preview(payload: Dict[str, Any] = Body(...)):
    from spmk_app.package_generate import normalize_output_behavior
    from spmk_app.package_generate_learn import generate_proposal_frames

    path = str(payload.get("path") or "")
    walk_sheet = str(payload.get("walkSheet") or payload.get("walkSheetId") or "walk")
    if not path:
        raise HTTPException(400, "path required")
    try:
        behavior = normalize_output_behavior(str(payload.get("outputBehavior") or "swim"))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st = _store_or_500()
    try:
        resolved = str(st.resolve_charbin_path(path))
        return generate_proposal_frames(st, resolved, walk_sheet, behavior)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/generate/apply")
async def generate_apply(payload: Dict[str, Any] = Body(...)):
    from spmk_app.package_generate import normalize_output_behavior
    from spmk_app.package_generate_learn import apply_proposal_to_charbin

    path = str(payload.get("path") or "")
    walk_sheet = str(payload.get("walkSheet") or payload.get("walkSheetId") or "walk")
    if not path:
        raise HTTPException(400, "path required")
    try:
        behavior = normalize_output_behavior(str(payload.get("outputBehavior") or "swim"))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    frame_time = int(payload.get("frameTimeMs") or 120)
    st = _store_or_500()
    try:
        resolved = str(st.resolve_charbin_path(path))
        result = apply_proposal_to_charbin(
            st,
            resolved,
            walk_sheet,
            behavior,
            frame_time_ms=frame_time,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st.scan_packages()
    return result


@router.get("/body-markers/load")
def body_markers_load(path: str = "", direction: str = "south"):
    from spmk_app.package_body_markers import DIRECTION_LABELS, DIRECTION_LAYOUT, load_body_markers_context

    if not path:
        raise HTTPException(400, "path required")
    if direction not in DIRECTION_LAYOUT:
        raise HTTPException(400, f"invalid direction: {direction}")
    st = _store_or_500()
    try:
        resolved = st.resolve_charbin_path(path)
        ctx = load_body_markers_context(resolved, direction)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "path": str(resolved),
        "direction": direction,
        "directionLabel": DIRECTION_LABELS.get(direction, direction),
        "frameWidth": ctx["frameWidth"],
        "frameHeight": ctx["frameHeight"],
        "profile": ctx["profile"],
        "walkSheetId": ctx["walkSheetId"],
        "layout": ctx["layout"],
        "markers": ctx["markers"],
        "suggested": ctx["suggested"],
    }


@router.get("/body-markers/frame")
def body_markers_frame(path: str = "", direction: str = "south"):
    from spmk_app.charbin_io import load_charbin_file
    from spmk_app.package_body_markers import DIRECTION_LAYOUT, walk_frame_png
    from spmk_app.character_package import preferred_pokemon_walk_sheet

    if not path:
        raise HTTPException(400, "path required")
    if direction not in DIRECTION_LAYOUT:
        raise HTTPException(400, f"invalid direction: {direction}")
    st = _store_or_500()
    try:
        resolved = st.resolve_charbin_path(path)
        pkg, assets = load_charbin_file(resolved)
        png, _fw, _fh, profile = walk_frame_png(pkg, assets, direction)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    walk_id = (preferred_pokemon_walk_sheet(pkg) or {}).get("id") or "walk"
    return Response(
        content=png,
        media_type="image/png",
        headers={"X-SPMK-Profile": profile, "X-SPMK-Walk-Sheet": walk_id},
    )


@router.post("/body-markers/guess")
async def body_markers_guess(payload: Dict[str, Any] = Body(...)):
    from spmk_app.charbin_io import load_charbin_file
    from spmk_app.package_body_markers import DIRECTION_LAYOUT, guess_markers_for_direction, walk_frame_png

    path = str(payload.get("path") or "")
    direction = str(payload.get("direction") or "south")
    if not path:
        raise HTTPException(400, "path required")
    if direction not in DIRECTION_LAYOUT:
        raise HTTPException(400, f"invalid direction: {direction}")
    st = _store_or_500()
    try:
        resolved = st.resolve_charbin_path(path)
        pkg, assets = load_charbin_file(resolved)
        png, fw, fh, _profile = walk_frame_png(pkg, assets, direction)
        import io
        from PIL import Image

        guessed = guess_markers_for_direction(
            Image.open(io.BytesIO(png)).convert("RGBA"), direction, fw=fw, fh=fh
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"direction": direction, "directionMarkers": guessed}


@router.post("/body-markers/save")
async def body_markers_save(payload: Dict[str, Any] = Body(...)):
    from spmk_app.package_body_markers import save_body_markers_to_path

    path = str(payload.get("path") or "")
    markers = payload.get("markers")
    if not path:
        raise HTTPException(400, "path required")
    if not isinstance(markers, dict):
        raise HTTPException(400, "markers object required")
    st = _store_or_500()
    try:
        resolved = st.resolve_charbin_path(path)
        result = save_body_markers_to_path(resolved, markers)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    st.scan_packages()
    return {"ok": True, **result}


@router.post("/export/debug-loose")
def export_debug_loose():
    st = _store_or_500()
    try:
        folder = st.debug_export_draft()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    zip_path = st.exports / f"{folder.name}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in folder.rglob("*"):
            if p.is_file():
                zf.write(p, p.relative_to(folder))
    shutil.rmtree(folder, ignore_errors=True)
    return FileResponse(zip_path, filename=zip_path.name)
