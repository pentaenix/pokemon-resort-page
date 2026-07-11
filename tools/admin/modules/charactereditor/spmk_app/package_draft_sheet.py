"""Add or replace sprite sheets on the open package draft."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional, Sequence, Tuple

from spmk_app.character_package import (
    default_character_actions,
    default_object_actions,
    default_pokemon_actions_for_sheet,
    is_object_package,
    is_pokemon_package,
    pokemon_sleep_sheet_id_for_walk,
)
from spmk_app.package_batch import _register_overworld_sprite_keys, _sheet_label
from spmk_app.package_image import (
    apply_pokemon_prep_to_sheet_record,
    detect_object_play_frames,
    prepare_pokemon_sheet_bytes,
    prepare_sheet_image_bytes,
)
from spmk_app.package_quick_anim import normalize_anim_id
from spmk_app.pokemon_batch_parse import (
    ParsedPokemonImport,
    parse_walk_variant_label,
    pokemon_sheet_id_for_suffix,
)

_ANIM_KINDS = frozenset({"movement", "idle", "south_only", "session"})


def parse_frame_cols(raw: str, *, default: Tuple[int, ...]) -> List[int]:
    if not str(raw or "").strip():
        return list(default)
    out: List[int] = []
    for part in str(raw).replace(";", ",").split(","):
        token = part.strip()
        if not token:
            continue
        try:
            value = int(token)
        except ValueError:
            continue
        if value >= 0:
            out.append(value)
    return out or list(default)


def _primary_sheet_id(package: Dict[str, Any]) -> str:
    if is_object_package(package):
        return "sheet"
    return "walk"


def has_primary_sheet(package: Dict[str, Any]) -> bool:
    primary_id = _primary_sheet_id(package)
    for sheet in package.get("spriteSheets") or []:
        if sheet.get("id") == primary_id and sheet.get("assetId"):
            return True
    return False


def normalize_anim_kind(raw: str) -> str:
    kind = (raw or "movement").strip().lower()
    if kind in _ANIM_KINDS:
        return kind
    return "movement"


def build_object_anim_bundle(
    anim_key: str,
    sheet_id: str,
    *,
    frames: Optional[Sequence[int]] = None,
    frame_time_ms: int = 120,
    loop: bool = False,
    modifiers: Optional[Sequence[str]] = None,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    from spmk_app.object_variant_model import build_object_clip_bundle, normalize_object_modifiers

    frame_list = list(frames) if frames is not None else [0]
    return build_object_clip_bundle(
        anim_key,
        sheet_id,
        normalize_object_modifiers(modifiers or ()),
        frame_list,
        frame_time_ms=frame_time_ms,
        loop=loop,
    )


def build_session_activity_bundle(
    anim_key: str,
    sheet_id: str,
    *,
    enter_frames: Sequence[int] = (0, 1, 2, 3),
    stay_frames: Sequence[int] = (3,),
    exit_frames: Sequence[int] = (3, 2, 1, 0),
    frame_time_ms: int = 120,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """4-dir session: enter columns → hold → exit columns (reversed)."""
    ms = max(50, int(frame_time_ms or 120))
    enter = [int(x) for x in enter_frames] or [0, 1, 2, 3]
    stay = [int(x) for x in stay_frames] or [enter[-1]]
    exit_cols = [int(x) for x in exit_frames] or list(reversed(enter))
    anims: Dict[str, Any] = {
        "enter": {"frames": enter, "frameTimeMs": ms, "loop": False},
        "stay": {"frames": stay, "frameTimeMs": ms, "loop": True},
        "exit": {"frames": exit_cols, "frameTimeMs": ms, "loop": False},
    }
    actions: List[Dict[str, Any]] = [
        {
            "id": anim_key,
            "type": "activity",
            "activityKind": "session",
            "sheetId": sheet_id,
            "movementDriven": False,
            "facingMode": "four_direction",
            "phases": {
                "enter": {"animationName": "enter", "loop": False},
                "stay": {"animationName": "stay", "loop": True},
                "exit": {"animationName": "exit", "loop": False},
            },
        }
    ]
    return anims, actions


def build_custom_anim_bundle(
    anim_key: str,
    sheet_id: str,
    *,
    kind: str,
    frame_count: int = 4,
    frame_time_ms: int = 120,
    include_idle: bool = False,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Build per-sheet ``animations`` overrides and ``actions`` for a custom sheet.

    Movement sheets use 4-direction rows (profile directions). South-only sheets
    animate row 0 only (sleep). Idle/emote sheets loop listed frames on each row.
    """
    kind = normalize_anim_kind(kind)
    frames = list(range(max(1, min(4, int(frame_count or 4)))))
    ms = max(50, int(frame_time_ms or 120))
    anims: Dict[str, Any] = {}
    actions: List[Dict[str, Any]] = []

    if kind == "south_only":
        anims[anim_key] = {"frames": frames, "frameTimeMs": ms, "loop": True}
        action_id = sheet_id if sheet_id.startswith("sleep") else anim_key
        actions.append(
            {
                "id": action_id,
                "type": "idle",
                "sheetId": sheet_id,
                "animationName": anim_key,
                "movementDriven": False,
            }
        )
        return anims, actions

    if kind == "idle":
        loop_frames = frames[:1] if len(frames) == 1 else frames
        anims[anim_key] = {"frames": loop_frames, "frameTimeMs": ms, "loop": True}
        actions.append(
            {
                "id": anim_key,
                "type": "idle",
                "sheetId": sheet_id,
                "animationName": anim_key,
                "movementDriven": False,
            }
        )
        return anims, actions

    if kind == "session":
        return build_session_activity_bundle(anim_key, sheet_id, frame_time_ms=ms)

    anims[anim_key] = {"frames": frames, "frameTimeMs": ms, "loop": True}
    actions.append(
        {
            "id": anim_key,
            "type": "movement",
            "sheetId": sheet_id,
            "animationName": anim_key,
            "movementDriven": True,
        }
    )
    if include_idle:
        anims["idle"] = {"frames": [0], "frameTimeMs": 250, "loop": True}
        actions.append(
            {
                "id": f"{anim_key}_idle",
                "type": "idle",
                "sheetId": sheet_id,
                "animationName": "idle",
                "movementDriven": False,
            }
        )
    return anims, actions


def _walk_variant_label(form_key: Optional[str], modifiers: Tuple[str, ...], suffix: Optional[str]) -> str:
    parsed = ParsedPokemonImport(
        species_id="species",
        form_key=form_key,
        modifiers=modifiers,
        behavior="walk",
        sheet_suffix=suffix,
    )
    return _sheet_label(parsed)


def _merge_walk_variant_pokemon(
    package: Dict[str, Any],
    sheet_rec: Dict[str, Any],
    sheet_id: str,
    parsed: ParsedPokemonImport,
) -> Dict[str, Any]:
    from spmk_app.pokemon_variant_model import (
        action_ids_for_sheet_import,
        actions_for_sheet_import,
        migrate_package_variant_model,
        register_pokemon_form,
        register_pokemon_modifier_def,
    )

    out = migrate_package_variant_model(deepcopy(package))
    sheets = [s for s in (out.get("spriteSheets") or []) if s.get("id") != sheet_id]
    sheets.append(sheet_rec)
    out["spriteSheets"] = sheets
    new_actions = actions_for_sheet_import(
        parsed.form_id, parsed.modifiers, parsed.behavior, sheet_id
    )
    replace_ids = action_ids_for_sheet_import(
        parsed.form_id, parsed.modifiers, parsed.behavior
    )
    actions = [a for a in (out.get("actions") or []) if a.get("id") not in replace_ids]
    out["actions"] = actions + new_actions
    meta = out.setdefault("metadata", {})
    _register_overworld_sprite_keys(meta, parsed)
    if parsed.form_id != "default":
        out = register_pokemon_form(out, parsed.form_id, name=str(parsed.form_key or parsed.form_id))
    for mod in parsed.modifiers:
        out = register_pokemon_modifier_def(out, mod)
    return out


def _merge_object_appearance(
    package: Dict[str, Any],
    sheet_rec: Dict[str, Any],
    modifier_label: str,
) -> Dict[str, Any]:
    from spmk_app.object_variant_model import (
        OBJECT_BASE_SHEET_ID,
        actions_for_object_sheet,
        normalize_object_modifiers,
        sync_object_sheet_fields,
    )

    mods = normalize_object_modifiers([modifier_label])
    sheet_rec = sync_object_sheet_fields({**sheet_rec, "modifiers": list(mods)})
    sheet_id = sheet_rec.get("id") or OBJECT_BASE_SHEET_ID
    base = next(
        (s for s in (package.get("spriteSheets") or []) if s.get("id") == OBJECT_BASE_SHEET_ID and s.get("assetId")),
        None,
    )
    if base and base.get("animations") and not sheet_rec.get("animations"):
        sheet_rec["animations"] = deepcopy(base.get("animations"))
    out = deepcopy(package)
    sheets = [s for s in (out.get("spriteSheets") or []) if s.get("id") != sheet_id]
    sheets.append(sheet_rec)
    out["spriteSheets"] = sheets
    new_actions = actions_for_object_sheet(sheet_rec, out.get("baseProfile") or "object")
    replace_ids = {a["id"] for a in new_actions}
    actions = [a for a in (out.get("actions") or []) if (a.get("id") or "") not in replace_ids]
    out["actions"] = actions + new_actions
    return out


def _merge_custom_anim_bundle(
    package: Dict[str, Any],
    sheet_rec: Dict[str, Any],
    actions_to_add: List[Dict[str, Any]],
) -> Dict[str, Any]:
    out = deepcopy(package)
    sheet_id = sheet_rec.get("id") or ""
    sheets = [s for s in (out.get("spriteSheets") or []) if s.get("id") != sheet_id]
    sheets.append(sheet_rec)
    out["spriteSheets"] = sheets
    replace_ids = {a["id"] for a in actions_to_add if a.get("id")}
    actions = [a for a in (out.get("actions") or []) if (a.get("id") or "") not in replace_ids]
    out["actions"] = actions + actions_to_add
    return out


def _merge_replace_primary(
    package: Dict[str, Any],
    sheet_rec: Dict[str, Any],
    sheet_id: str,
) -> Dict[str, Any]:
    out = deepcopy(package)
    sheets = [s for s in (out.get("spriteSheets") or []) if s.get("id") != sheet_id]
    if is_object_package(package):
        old = next((s for s in (package.get("spriteSheets") or []) if s.get("id") == sheet_id), None)
        if old and old.get("animations"):
            sheet_rec = {**sheet_rec, "animations": deepcopy(old.get("animations"))}
    sheets.append(sheet_rec)
    out["spriteSheets"] = sheets
    if is_object_package(out):
        drop_ids = {"play"}
        new_actions = default_object_actions(sheet_id)
    elif is_pokemon_package(out):
        drop_ids = {"idle", "walk", "pause"}
        new_actions = default_pokemon_actions_for_sheet(sheet_id)
    else:
        drop_ids = {"idle", "walk"}
        new_actions = default_character_actions(sheet_id)
    actions = [a for a in (out.get("actions") or []) if a.get("id") not in drop_ids]
    out["actions"] = actions + new_actions
    return out


def _merge_primary_first_sheet(
    package: Dict[str, Any],
    sheet_rec: Dict[str, Any],
    sheet_id: str,
    png_bytes: bytes,
) -> Dict[str, Any]:
    out = deepcopy(package)
    sheets = [s for s in (out.get("spriteSheets") or []) if s.get("id") != sheet_id]
    if is_object_package(out):
        play_frames = detect_object_play_frames(
            png_bytes,
            sheet_rec.get("profile") or out.get("baseProfile") or "object",
        )
        sheet_rec = {
            **sheet_rec,
            "animations": {
                "play": {"frames": play_frames, "frameTimeMs": 120, "loop": True},
                "static": {"frames": [play_frames[0]], "frameTimeMs": 0, "loop": False},
            },
        }
    sheets.append(sheet_rec)
    out["spriteSheets"] = sheets
    if is_object_package(out):
        new_actions = default_object_actions(sheet_id)
    elif is_pokemon_package(out):
        new_actions = default_pokemon_actions_for_sheet(sheet_id)
    else:
        new_actions = default_character_actions(sheet_id)
    drop_ids = {a["id"] for a in new_actions}
    actions = [a for a in (out.get("actions") or []) if a.get("id") not in drop_ids]
    out["actions"] = actions + new_actions
    return out


def resolve_add_sheet_target(
    package: Dict[str, Any],
    *,
    mode: str,
    label: str = "",
    walk_sheet_id: str = "walk",
    anim_kind: str = "movement",
    include_idle: bool = False,
    frame_count: int = 4,
    frame_time_ms: int = 120,
    session_enter_frames: str = "",
    session_stay_frames: str = "",
    session_exit_frames: str = "",
) -> Tuple[str, str, str, str, str, Optional[ParsedPokemonImport], Dict[str, Any], List[Dict[str, Any]]]:
    """
    Return sheet ids, anim key, parsed variant, sheet animations map, and actions list.
    """
    mode = (mode or "primary").strip().lower()
    label = (label or "").strip()

    if mode in ("primary", "replace_primary"):
        sheet_id = _primary_sheet_id(package)
        asset_id = "sheet_png" if sheet_id == "sheet" else "walk_png"
        if sheet_id == "sheet" and is_object_package(package):
            from spmk_app.object_variant_model import object_appearance_label

            sheet_name = object_appearance_label([])
        else:
            sheet_name = "Sprite" if sheet_id == "sheet" else "Walk"
        return sheet_id, asset_id, sheet_name, sheet_id, sheet_id, None, {}, []

    if mode == "walk_variant":
        if not is_pokemon_package(package):
            raise ValueError("walk_variant is only for Pokémon packages")
        form_key, mods, suffix = parse_walk_variant_label(label)
        from spmk_app.pokemon_variant_model import sheet_id_for_variant

        form_id = form_key or "default"
        sheet_id = sheet_id_for_variant(form_id, mods, "walk")
        asset_id = f"{sheet_id}_png"
        sheet_name = _walk_variant_label(form_key, mods, suffix)
        parsed = ParsedPokemonImport(
            species_id=package.get("id") or "species",
            form_key=form_key,
            modifiers=mods,
            behavior="walk",
            sheet_suffix=suffix,
        )
        return sheet_id, asset_id, sheet_name, sheet_id, "walk", parsed, {}, []

    if mode == "object_appearance":
        if not is_object_package(package):
            raise ValueError("object_appearance is only for object packages")
        from spmk_app.object_variant_model import normalize_object_modifiers, object_sheet_id_for_modifiers

        mods = normalize_object_modifiers([label])
        if not mods:
            raise ValueError("appearance name required (e.g. shiny, blue)")
        sheet_id = object_sheet_id_for_modifiers(mods)
        asset_id = f"{sheet_id}_png"
        sheet_name = label.replace("_", " ").strip().title() or sheet_id
        return sheet_id, asset_id, sheet_name, sheet_id, sheet_id, None, {}, []

    if mode == "custom_anim":
        anim_key = normalize_anim_id(label)
        kind = normalize_anim_kind(anim_kind)
        if is_pokemon_package(package) and anim_key == "sleep":
            sheet_id = pokemon_sleep_sheet_id_for_walk(walk_sheet_id or "walk")
        else:
            sheet_id = anim_key
        fc = frame_count
        ft = frame_time_ms
        if kind == "south_only":
            fc = max(1, min(4, frame_count or 2))
            ft = frame_time_ms or 400
        asset_id = f"{sheet_id}_png"
        sheet_name = anim_key.replace("_", " ").title()
        if kind == "session":
            anims, actions = build_session_activity_bundle(
                anim_key,
                sheet_id,
                enter_frames=parse_frame_cols(session_enter_frames, default=(0, 1, 2, 3)),
                stay_frames=parse_frame_cols(session_stay_frames, default=(3,)),
                exit_frames=parse_frame_cols(session_exit_frames, default=(3, 2, 1, 0)),
                frame_time_ms=ft,
            )
        else:
            anims, actions = build_custom_anim_bundle(
                anim_key,
                sheet_id,
                kind=kind,
                frame_count=fc,
                frame_time_ms=ft,
                include_idle=include_idle and kind == "movement",
            )
        return sheet_id, asset_id, sheet_name, sheet_id, anim_key, None, anims, actions

    raise ValueError(f"unknown add-sheet mode {mode!r}")


def add_sheet_to_draft_package(
    package: Dict[str, Any],
    png_bytes: bytes,
    *,
    mode: str,
    label: str = "",
    walk_sheet_id: str = "walk",
    anim_kind: str = "movement",
    include_idle: bool = False,
    frame_count: int = 4,
    frame_time_ms: int = 120,
    session_enter_frames: str = "",
    session_stay_frames: str = "",
    session_exit_frames: str = "",
    profile_name: Optional[str] = None,
) -> Tuple[Dict[str, Any], str, Dict[str, Any], str, bytes]:
    """Merge uploaded sheet bytes into package."""
    profile = profile_name or package.get("baseProfile") or "character"
    prep: Dict[str, Any]
    if is_pokemon_package(package):
        prepared, profile, prep = prepare_pokemon_sheet_bytes(png_bytes)
    else:
        prepared, prep = prepare_sheet_image_bytes(png_bytes, profile)
    sheet_id, asset_id, sheet_name, _action_id, _anim_key, parsed, anims, custom_actions = (
        resolve_add_sheet_target(
            package,
            mode=mode,
            label=label,
            walk_sheet_id=walk_sheet_id,
            anim_kind=anim_kind,
            include_idle=include_idle,
            frame_count=frame_count,
            frame_time_ms=frame_time_ms,
            session_enter_frames=session_enter_frames,
            session_stay_frames=session_stay_frames,
            session_exit_frames=session_exit_frames,
        )
    )
    sheet_rec: Dict[str, Any] = {
        "id": sheet_id,
        "name": sheet_name,
        "assetId": asset_id,
        "profile": profile,
    }
    if is_pokemon_package(package):
        apply_pokemon_prep_to_sheet_record(sheet_rec, prep)
    if anims:
        sheet_rec["animations"] = anims
    mode_norm = (mode or "primary").strip().lower()
    if mode_norm == "object_appearance":
        merged = _merge_object_appearance(package, sheet_rec, label)
    elif mode_norm == "custom_anim":
        merged = _merge_custom_anim_bundle(package, sheet_rec, custom_actions)
    elif mode_norm == "walk_variant":
        if parsed is None:
            raise ValueError("parsed variant required")
        merged = _merge_walk_variant_pokemon(package, sheet_rec, sheet_id, parsed)
    elif mode_norm == "replace_primary":
        merged = _merge_replace_primary(package, sheet_rec, sheet_id)
    else:
        merged = _merge_primary_first_sheet(package, sheet_rec, sheet_id, prepared)
    return merged, asset_id, prep, sheet_id, prepared


def suggest_add_sheet_mode(package: Dict[str, Any]) -> str:
    """Default mode when the UI does not show a modal."""
    return "primary" if not has_primary_sheet(package) else "replace_primary"
