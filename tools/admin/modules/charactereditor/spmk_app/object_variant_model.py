"""Appearance variants and clip actions for object .charbin packages."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from spmk_app.character_package import load_sprite_profiles

OBJECT_BASE_SHEET_ID = "sheet"
OBJECT_APPEARANCE_MODIFIERS: Tuple[str, ...] = ("shiny",)
OBJECT_BUILTIN_ANIMATIONS: Tuple[str, ...] = ("static", "play")


def normalize_suppressed_animations(raw: Any) -> Tuple[str, ...]:
    if not raw:
        return ()
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        return ()
    seen: Set[str] = set()
    out: List[str] = []
    for item in raw:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return tuple(out)


def object_suppressed_animations(sheet: Dict[str, Any]) -> Tuple[str, ...]:
    return normalize_suppressed_animations(sheet.get("suppressedAnimations"))


def suppress_object_animation(sheet: Dict[str, Any], anim_name: str) -> Dict[str, Any]:
    out = deepcopy(sheet)
    name = str(anim_name or "").strip()
    if not name:
        return out
    merged = list(object_suppressed_animations(out))
    if name not in merged:
        merged.append(name)
    out["suppressedAnimations"] = merged
    anims = dict(out.get("animations") or {})
    anims.pop(name, None)
    if anims:
        out["animations"] = anims
    else:
        out.pop("animations", None)
    return out


def unsuppress_object_animation(sheet: Dict[str, Any], anim_name: str) -> Dict[str, Any]:
    out = deepcopy(sheet)
    name = str(anim_name or "").strip()
    if not name:
        return out
    kept = [a for a in object_suppressed_animations(out) if a != name]
    if kept:
        out["suppressedAnimations"] = kept
    else:
        out.pop("suppressedAnimations", None)
    return out


def normalize_object_modifiers(mods: Sequence[str]) -> Tuple[str, ...]:
    seen: Set[str] = set()
    ordered: List[str] = []
    for m in mods:
        key = str(m or "").strip().lower().replace(" ", "_")
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    known = [m for m in OBJECT_APPEARANCE_MODIFIERS if m in seen]
    rest = [m for m in ordered if m not in OBJECT_APPEARANCE_MODIFIERS]
    return tuple(known + rest)


def object_sheet_id_for_modifiers(modifiers: Sequence[str]) -> str:
    mods = normalize_object_modifiers(modifiers)
    if not mods:
        return OBJECT_BASE_SHEET_ID
    return f"{OBJECT_BASE_SHEET_ID}_{'_'.join(mods)}"


def object_appearance_label(modifiers: Sequence[str]) -> str:
    mods = normalize_object_modifiers(modifiers)
    if not mods:
        return "Default"
    return ", ".join(m.replace("_", " ").title() for m in mods)


def sync_object_sheet_fields(sheet: Dict[str, Any]) -> Dict[str, Any]:
    out = deepcopy(sheet)
    mods = normalize_object_modifiers(out.get("modifiers") or [])
    out["modifiers"] = list(mods)
    expected_id = object_sheet_id_for_modifiers(mods)
    if not out.get("id") or out.get("id") in (OBJECT_BASE_SHEET_ID, expected_id) or str(out.get("id", "")).startswith("sheet"):
        out["id"] = expected_id
    if not out.get("name"):
        out["name"] = object_appearance_label(mods)
    return out


def object_action_id(animation_name: str, modifiers: Sequence[str]) -> str:
    anim = (animation_name or "static").strip()
    mods = normalize_object_modifiers(modifiers)
    if not mods:
        return anim
    return f"{anim}_{'_'.join(mods)}"


def action_for_object_clip(
    animation_name: str,
    sheet_id: str,
    modifiers: Sequence[str],
    *,
    action_id: Optional[str] = None,
) -> Dict[str, Any]:
    mods = normalize_object_modifiers(modifiers)
    anim = (animation_name or "static").strip()
    return {
        "id": action_id or object_action_id(anim, mods),
        "type": "idle",
        "sheetId": sheet_id,
        "animationName": anim,
        "movementDriven": False,
        "modifiers": list(mods),
    }


def build_object_clip_spec(
    frames: Sequence[int],
    *,
    frame_time_ms: int = 120,
    loop: bool = True,
) -> Dict[str, Any]:
    cols = [int(x) for x in frames]
    if not cols:
        cols = [0]
    ms = max(0, int(frame_time_ms))
    spec: Dict[str, Any] = {"frames": cols, "frameTimeMs": ms}
    if not loop:
        spec["loop"] = False
    return spec


def build_object_clip_bundle(
    animation_name: str,
    sheet_id: str,
    modifiers: Sequence[str],
    frames: Sequence[int],
    *,
    frame_time_ms: int = 120,
    loop: bool = True,
    action_id: Optional[str] = None,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    anim = (animation_name or "clip").strip()
    anims = {anim: build_object_clip_spec(frames, frame_time_ms=frame_time_ms, loop=loop)}
    actions = [
        action_for_object_clip(
            anim,
            sheet_id,
            modifiers,
            action_id=action_id,
        )
    ]
    return anims, actions


def object_profile_animation_names(profile_name: str = "object") -> List[str]:
    prof = load_sprite_profiles().get("profiles", {}).get(profile_name or "object", {})
    return sorted((prof.get("animations") or {}).keys())


def object_sheet_animation_names(sheet: Dict[str, Any], profile_name: str = "object") -> List[str]:
    suppressed = set(object_suppressed_animations(sheet))
    names: Set[str] = set(object_profile_animation_names(profile_name))
    names.update((sheet.get("animations") or {}).keys())
    return sorted(n for n in names if n not in suppressed)


def actions_for_object_sheet(
    sheet: Dict[str, Any],
    profile_name: str = "object",
) -> List[Dict[str, Any]]:
    synced = sync_object_sheet_fields(sheet)
    sid = synced.get("id") or OBJECT_BASE_SHEET_ID
    mods = synced.get("modifiers") or []
    return [
        action_for_object_clip(anim_name, sid, mods)
        for anim_name in object_sheet_animation_names(synced, profile_name)
    ]
