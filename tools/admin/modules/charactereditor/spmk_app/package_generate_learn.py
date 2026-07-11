"""Train / preview / apply charbin behavior generation from library walk→output pairs."""
from __future__ import annotations

import base64
import io
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from PIL import Image

from spmk_app.charbin_io import load_charbin_file, save_charbin_file
from spmk_app.character_package import collect_assets_from_package, load_sprite_profiles
from spmk_app.learn_overlay import apply_learned_to_image, learn_from_image_pairs
from spmk_app.package_generate import (
    expected_output_sheet_id,
    normalize_output_behavior,
    slot_missing_output,
)
from spmk_app.package_quick_anim import _walk_sheets_from_package, list_pokemon_library_entries
from spmk_app.package_store import PackageStore
from spmk_app.pokemon_variant_model import (
    actions_for_sheet_import,
    attach_variant_fields,
    sheet_display_name,
    sync_sheet_variant_fields,
)

PROFILE_DIRECTIONS: Tuple[str, ...] = ("south", "west", "east", "north")

BEHAVIOR_TRAIN: Dict[str, Dict[str, Any]] = {
    "swim": {"directions": PROFILE_DIRECTIONS, "framesPerDirection": 4, "baseCol": 0},
    "eating": {"directions": PROFILE_DIRECTIONS, "framesPerDirection": 4, "baseCol": 0},
    "sleep": {"directions": ("south",), "framesPerDirection": 2, "baseCol": 0},
}


def _models_dir(workspace: Path) -> Path:
    d = workspace / "generate_models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _assets_dir(workspace: Path) -> Path:
    d = workspace / "assets"
    d.mkdir(parents=True, exist_ok=True)
    return d


def model_path(workspace: Path, output_behavior: str) -> Path:
    return _models_dir(workspace) / f"{normalize_output_behavior(output_behavior)}.json"


def load_behavior_model(workspace: Path, output_behavior: str) -> Optional[Dict[str, Any]]:
    path = model_path(workspace, output_behavior)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def save_behavior_model(workspace: Path, model: Dict[str, Any]) -> Dict[str, Any]:
    behavior = normalize_output_behavior(model.get("outputBehavior") or "")
    path = model_path(workspace, behavior)
    path.write_text(json.dumps(model, indent=2), encoding="utf-8")
    return model


def _profile_for_package(pkg: Dict[str, Any], sheet: Dict[str, Any]) -> Dict[str, Any]:
    name = sheet.get("profile") or pkg.get("baseProfile") or "pokemon_small"
    return load_sprite_profiles().get("profiles", {}).get(name, {})


def crop_sheet_cell(
    sheet_img: Image.Image,
    prof: Dict[str, Any],
    direction: str,
    col: int,
) -> Image.Image:
    fw = int(prof.get("frameWidth") or 32)
    fh = int(prof.get("frameHeight") or 32)
    row = int((prof.get("directions") or {}).get(direction, {}).get("row", 0))
    x = col * fw
    y = row * fh
    if x + fw > sheet_img.width or y + fh > sheet_img.height:
        raise ValueError(f"sheet too small for {direction} col {col}")
    return sheet_img.crop((x, y, x + fw, y + fh))


def _open_sheet_image(assets: Dict[str, bytes], sheet: Dict[str, Any]) -> Image.Image:
    aid = sheet.get("assetId")
    if not aid or aid not in assets:
        raise ValueError(f"sheet asset missing: {sheet.get('id')}")
    return Image.open(io.BytesIO(assets[aid])).convert("RGBA")


def _find_output_sheet(pkg: Dict[str, Any], walk_sheet: Dict[str, Any], output_behavior: str) -> Optional[Dict[str, Any]]:
    out_id = expected_output_sheet_id(walk_sheet.get("id") or "walk", walk_sheet, output_behavior)
    for sheet in pkg.get("spriteSheets") or []:
        if sheet.get("id") == out_id and sheet.get("assetId"):
            return sheet
    return None


def collect_training_pairs_from_library(
    store: PackageStore,
    output_behavior: str,
) -> Tuple[Dict[str, List[Tuple[Image.Image, Image.Image]]], int]:
    output_behavior = normalize_output_behavior(output_behavior)
    cfg = BEHAVIOR_TRAIN[output_behavior]
    directions: Sequence[str] = cfg["directions"]
    fpd = int(cfg["framesPerDirection"])
    base_col = int(cfg.get("baseCol") or 0)
    buckets: Dict[str, List[Tuple[Image.Image, Image.Image]]] = {}
    source_packages = 0
    for entry in list_pokemon_library_entries(store):
        path = Path(entry["path"])
        if not path.is_file():
            continue
        pkg, assets = load_charbin_file(path)
        used_pkg = False
        for walk in _walk_sheets_from_package(pkg):
            if slot_missing_output(pkg, walk, output_behavior):
                continue
            out_sheet = _find_output_sheet(pkg, walk, output_behavior)
            if not out_sheet:
                continue
            prof = _profile_for_package(pkg, walk)
            try:
                walk_img = _open_sheet_image(assets, walk)
                out_img = _open_sheet_image(assets, out_sheet)
            except ValueError:
                continue
            used_pkg = True
            for direction in directions:
                try:
                    base_cell = crop_sheet_cell(walk_img, prof, direction, base_col)
                except ValueError:
                    continue
                for fi in range(fpd):
                    try:
                        target_cell = crop_sheet_cell(out_img, prof, direction, fi)
                    except ValueError:
                        continue
                    key = f"{direction}:{fi}"
                    buckets.setdefault(key, []).append((base_cell.copy(), target_cell.copy()))
        if used_pkg:
            source_packages += 1
    return buckets, source_packages


def count_training_sources_from_library(store: PackageStore, output_behavior: str) -> int:
    """Count Pokémon charbins that have both walk and output sheets (no image decode)."""
    output_behavior = normalize_output_behavior(output_behavior)
    source_packages = 0
    for entry in list_pokemon_library_entries(store):
        path = Path(entry["path"])
        if not path.is_file():
            continue
        try:
            pkg, assets = load_charbin_file(path)
        except (OSError, ValueError):
            continue
        used_pkg = False
        for walk in _walk_sheets_from_package(pkg):
            if slot_missing_output(pkg, walk, output_behavior):
                continue
            out_sheet = _find_output_sheet(pkg, walk, output_behavior)
            if not out_sheet or not out_sheet.get("assetId"):
                continue
            if out_sheet.get("assetId") not in assets:
                continue
            if walk.get("assetId") not in assets:
                continue
            used_pkg = True
            break
        if used_pkg:
            source_packages += 1
    return source_packages


def train_behavior_from_charbins(store: PackageStore, output_behavior: str) -> Dict[str, Any]:
    output_behavior = normalize_output_behavior(output_behavior)
    cfg = BEHAVIOR_TRAIN[output_behavior]
    workspace = store.workspace
    assets_dir = _assets_dir(workspace)
    buckets, source_packages = collect_training_pairs_from_library(store, output_behavior)
    if not buckets:
        raise ValueError(
            f"No charbin training pairs for {output_behavior}. "
            "Import Pokémon that already have both walk and output sheets."
        )
    learned_frames: Dict[str, List[Dict[str, Any]]] = {}
    quality: Dict[str, List[Dict[str, Any]]] = {}
    trained = 0
    for direction in cfg["directions"]:
        learned_frames[direction] = []
        quality[direction] = []
        for fi in range(int(cfg["framesPerDirection"])):
            key = f"{direction}:{fi}"
            pairs = buckets.get(key) or []
            if not pairs:
                quality[direction].append(
                    {"frame": fi, "examples": 0, "consistency": "missing", "uncertainPixels": 0}
                )
                continue
            label = f"{output_behavior}_{direction}_{fi}"
            learned = learn_from_image_pairs(pairs, label, assets_dir)
            learned["targetLabel"] = f"{output_behavior}_{direction}_{fi}"
            learned["inputDirection"] = direction
            learned["frameIndex"] = fi
            learned_frames[direction].append(learned)
            quality[direction].append(
                {
                    "frame": fi,
                    "examples": learned.get("exampleCount", 0),
                    "consistency": learned.get("consistency"),
                    "uncertainPixels": learned.get("uncertainPixels", 0),
                }
            )
            trained += 1
    if trained == 0:
        raise ValueError(f"Could not train any frames for {output_behavior}")
    model = {
        "outputBehavior": output_behavior,
        "prefix": output_behavior,
        "directions": list(cfg["directions"]),
        "framesPerDirection": int(cfg["framesPerDirection"]),
        "learnedFrames": learned_frames,
        "quality": quality,
        "trainingSourceCount": source_packages,
        "trainedAt": int(time.time() * 1000),
        "pairBucketCount": sum(len(v) for v in buckets.values()),
    }
    save_behavior_model(workspace, model)
    return model


def model_summary(workspace: Path, output_behavior: str, *, detail: bool = False) -> Dict[str, Any]:
    output_behavior = normalize_output_behavior(output_behavior)
    model = load_behavior_model(workspace, output_behavior)
    if not model:
        out: Dict[str, Any] = {"outputBehavior": output_behavior, "trained": False}
        if detail:
            cfg = BEHAVIOR_TRAIN.get(output_behavior, {})
            out["directions"] = list(cfg.get("directions") or ())
            out["framesPerDirection"] = int(cfg.get("framesPerDirection") or 0)
        return out
    frame_count = sum(len(v) for v in (model.get("learnedFrames") or {}).values())
    out = {
        "outputBehavior": output_behavior,
        "trained": frame_count > 0,
        "trainedAt": model.get("trainedAt"),
        "trainingSourceCount": model.get("trainingSourceCount", 0),
        "trainedFrameCount": frame_count,
        "quality": model.get("quality"),
    }
    if detail:
        out["directions"] = model.get("directions") or list(BEHAVIOR_TRAIN[output_behavior]["directions"])
        out["framesPerDirection"] = model.get("framesPerDirection") or BEHAVIOR_TRAIN[output_behavior]["framesPerDirection"]
        out["quality"] = model.get("quality")
        out["learnedFrameKeys"] = {
            direction: [int(x.get("frameIndex", i)) for i, x in enumerate(model.get("learnedFrames", {}).get(direction) or [])]
            for direction in out["directions"]
        }
    return out


def _resolve_walk_and_profile(
    path: Path,
    walk_sheet_id: str,
) -> Tuple[Dict[str, Any], Dict[str, bytes], Dict[str, Any], Dict[str, Any], Image.Image]:
    pkg, assets = load_charbin_file(path)
    walk = next((s for s in _walk_sheets_from_package(pkg) if s.get("id") == walk_sheet_id), None)
    if not walk:
        raise ValueError(f"walk sheet {walk_sheet_id!r} not found")
    prof = _profile_for_package(pkg, walk)
    walk_img = _open_sheet_image(assets, walk)
    return pkg, assets, walk, prof, walk_img


def generate_proposal_frames(
    store: PackageStore,
    path: str,
    walk_sheet_id: str,
    output_behavior: str,
) -> Dict[str, Any]:
    output_behavior = normalize_output_behavior(output_behavior)
    model = load_behavior_model(store.workspace, output_behavior)
    if not model or not model.get("learnedFrames"):
        raise ValueError(f"Train the {output_behavior} model first (Generate → Train from library).")
    cfg = BEHAVIOR_TRAIN[output_behavior]
    assets_dir = _assets_dir(store.workspace)
    path_obj = Path(path)
    pkg, _assets, walk, prof, walk_img = _resolve_walk_and_profile(path_obj, walk_sheet_id)
    synced = sync_sheet_variant_fields(walk)
    previews: Dict[str, List[Dict[str, Any]]] = {}
    for direction in cfg["directions"]:
        learned_list = (model.get("learnedFrames") or {}).get(direction) or []
        if not learned_list:
            continue
        try:
            base_cell = crop_sheet_cell(walk_img, prof, direction, int(cfg.get("baseCol") or 0))
        except ValueError:
            continue
        dir_frames: List[Dict[str, Any]] = []
        for learned in learned_list:
            out_im = apply_learned_to_image(base_cell, learned, assets_dir)
            buf = io.BytesIO()
            out_im.save(buf, format="PNG")
            data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
            fi = int(learned.get("frameIndex") or len(dir_frames))
            dir_frames.append({"index": fi, "dataUrl": data_url})
        previews[direction] = sorted(dir_frames, key=lambda x: x["index"])

    sheet_png = compose_behavior_sheet_from_directions(
        prof,
        previews,
        south_row_only=(output_behavior == "sleep"),
    )
    sheet_data_url = "data:image/png;base64," + base64.b64encode(sheet_png).decode("ascii")
    return {
        "outputBehavior": output_behavior,
        "path": str(path_obj.resolve()),
        "walkSheetId": walk_sheet_id,
        "outputSheetId": expected_output_sheet_id(walk_sheet_id, walk, output_behavior),
        "formId": synced.get("formId") or "default",
        "modifiers": list(synced.get("modifiers") or []),
        "previews": previews,
        "sheetDataUrl": sheet_data_url,
        "modelTrainedAt": model.get("trainedAt"),
    }


def compose_behavior_sheet_from_directions(
    prof: Dict[str, Any],
    previews: Dict[str, List[Dict[str, Any]]],
    *,
    south_row_only: bool = False,
) -> bytes:
    fw = int(prof.get("frameWidth") or 32)
    fh = int(prof.get("frameHeight") or 32)
    cols = int(prof.get("columns") or 4)
    rows = int(prof.get("rows") or 4)
    out = Image.new("RGBA", (fw * cols, fh * rows), (0, 0, 0, 0))
    directions = ("south",) if south_row_only else PROFILE_DIRECTIONS
    for direction in directions:
        frames = previews.get(direction) or []
        if not frames:
            continue
        row = int((prof.get("directions") or {}).get(direction, {}).get("row", 0))
        for item in frames:
            fi = int(item.get("index") or 0)
            if fi < 0 or fi >= cols:
                continue
            data_url = item.get("dataUrl") or ""
            if not data_url.startswith("data:"):
                continue
            raw = base64.b64decode(data_url.split(",", 1)[1])
            cell = Image.open(io.BytesIO(raw)).convert("RGBA")
            if cell.size != (fw, fh):
                cell = cell.resize((fw, fh), Image.Resampling.NEAREST)
            out.paste(cell, (fi * fw, row * fh), cell)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def apply_proposal_to_charbin(
    store: PackageStore,
    path: str,
    walk_sheet_id: str,
    output_behavior: str,
    *,
    frame_time_ms: int = 120,
) -> Dict[str, Any]:
    proposal = generate_proposal_frames(store, path, walk_sheet_id, output_behavior)
    raw = base64.b64decode(proposal["sheetDataUrl"].split(",", 1)[1])
    path_obj = Path(path)
    pkg, assets = load_charbin_file(path_obj)
    walk = next((s for s in _walk_sheets_from_package(pkg) if s.get("id") == walk_sheet_id), None)
    if not walk:
        raise ValueError(f"walk sheet {walk_sheet_id!r} not found")
    synced = sync_sheet_variant_fields(walk)
    form_id = synced.get("formId") or "default"
    modifiers = list(synced.get("modifiers") or [])
    output_behavior = normalize_output_behavior(output_behavior)
    sheet_id = proposal["outputSheetId"]
    profile = walk.get("profile") or pkg.get("baseProfile") or "pokemon_small"
    anim_key = output_behavior
    frame_indices = list(range(int(BEHAVIOR_TRAIN[output_behavior]["framesPerDirection"])))
    sheets = [s for s in (pkg.get("spriteSheets") or []) if (s.get("id") or "") != sheet_id]
    sheet_rec: Dict[str, Any] = {
        "id": sheet_id,
        "name": sheet_display_name(form_id, modifiers, output_behavior),
        "assetId": f"{sheet_id}_png",
        "profile": profile,
        "animations": {
            anim_key: {
                "frames": frame_indices,
                "frameTimeMs": max(50, int(frame_time_ms)),
                "loop": True,
            }
        },
    }
    sheet_rec = attach_variant_fields(
        sheet_rec,
        form_id=form_id,
        modifiers=modifiers,
        behavior=output_behavior,
    )
    new_actions = actions_for_sheet_import(form_id, modifiers, output_behavior, sheet_id)
    new_action_ids = {a["id"] for a in new_actions}
    actions = [a for a in (pkg.get("actions") or []) if (a.get("id") or "") not in new_action_ids]
    actions.extend(new_actions)
    stale_assets = {
        s.get("assetId")
        for s in (pkg.get("spriteSheets") or [])
        if s.get("id") == sheet_id and s.get("assetId")
    }
    sheets.append(sheet_rec)
    pkg = {**pkg, "spriteSheets": sheets, "actions": actions}
    assets = {k: v for k, v in assets.items() if k not in stale_assets or k == f"{sheet_id}_png"}
    assets[f"{sheet_id}_png"] = raw
    merged = collect_assets_from_package(pkg, assets)
    save_charbin_file(path_obj, pkg, merged)
    return {
        "ok": True,
        "path": str(path_obj.resolve()),
        "sheetId": sheet_id,
        "outputBehavior": output_behavior,
        "actionIds": list(new_action_ids),
        "walkSheetId": walk_sheet_id,
    }
