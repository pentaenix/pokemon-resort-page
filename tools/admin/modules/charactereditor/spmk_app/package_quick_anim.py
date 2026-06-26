"""Batch pixel-edit workflow: add per-species animation sheets to Pokémon charbins."""
from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from spmk_app.charbin_io import load_charbin_file, save_charbin_file
from spmk_app.character_package import (
    collect_assets_from_package,
    is_pokemon_walk_sheet_id,
    load_sprite_profiles,
    pokemon_sleep_sheet_id_for_walk,
    pokemon_walk_sheet_suffix,
    preferred_pokemon_walk_sheet,
    sort_pokemon_walk_sheets,
)
from spmk_app.package_store import PackageStore

_ANIM_ID_RE = re.compile(r"^[a-z][a-z0-9_]*$")
_SINGLE_DIRECTION_ANIMS = frozenset({"sleep"})


def normalize_anim_id(name: str) -> str:
    raw = (name or "").strip().lower().replace("-", "_")
    raw = re.sub(r"[^a-z0-9_]+", "_", raw).strip("_")
    if not raw:
        raise ValueError("animation name required")
    if not _ANIM_ID_RE.match(raw):
        raise ValueError(f"invalid animation id {raw!r} (use letters, numbers, underscore)")
    return raw


def anim_uses_south_row_only(anim_id: str) -> bool:
    return normalize_anim_id(anim_id) in _SINGLE_DIRECTION_ANIMS


def package_has_animation(pkg: Dict[str, Any], anim_id: str) -> bool:
    for sheet in pkg.get("spriteSheets") or []:
        sid = sheet.get("id") or ""
        if sid == anim_id:
            return True
        if anim_id in (sheet.get("animations") or {}):
            return True
    for act in pkg.get("actions") or []:
        if act.get("id") == anim_id or act.get("animationName") == anim_id:
            return True
    return False


def package_has_sleep_for_walk(pkg: Dict[str, Any], walk_sheet_id: str) -> bool:
    sleep_sid = pokemon_sleep_sheet_id_for_walk(walk_sheet_id)
    for sheet in pkg.get("spriteSheets") or []:
        if sheet.get("id") == sleep_sid and sheet.get("assetId"):
            return True
    return False


def _walk_sheets_from_package(pkg: Dict[str, Any]) -> List[Dict[str, Any]]:
    sheets = [
        s
        for s in (pkg.get("spriteSheets") or [])
        if s.get("assetId") and is_pokemon_walk_sheet_id(s.get("id") or "")
    ]
    return sort_pokemon_walk_sheets(sheets)


def variant_label_for_walk(walk_sheet_id: str) -> str:
    suffix = pokemon_walk_sheet_suffix(walk_sheet_id)
    if not suffix:
        return "Default"
    return suffix.replace("_", " · ")


def list_pokemon_library_entries(store: PackageStore) -> List[Dict[str, Any]]:
    settings = store.load_settings()
    out = [
        e
        for e in (settings.get("scannedPackages") or [])
        if e.get("characterType") == "pokemon" and e.get("id") and not e.get("error")
    ]

    def sort_key(e: Dict[str, Any]) -> tuple:
        dex = e.get("pokemonId")
        if isinstance(dex, int) and dex > 0:
            return (0, dex, e.get("id") or "")
        return (1, 99999, e.get("displayName") or e.get("id") or "")

    return sorted(out, key=sort_key)


def count_missing_sleep_slots(store: PackageStore, anim_name: str) -> int:
    anim_id = normalize_anim_id(anim_name)
    if anim_id != "sleep":
        return count_pokemon_missing_animation(store, anim_name)
    n = 0
    for entry in list_pokemon_library_entries(store):
        path = Path(entry["path"])
        if not path.is_file():
            continue
        pkg, _ = load_charbin_file(path)
        for walk in _walk_sheets_from_package(pkg):
            if not package_has_sleep_for_walk(pkg, walk.get("id") or "walk"):
                n += 1
    return n


def count_pokemon_missing_animation(store: PackageStore, anim_name: str) -> int:
    return count_missing_sleep_slots(store, anim_name)


def _slot_sort_key(entry: Dict[str, Any], walk_sheet_id: str) -> tuple:
    dex = entry.get("pokemonId")
    dex_key = (0, dex) if isinstance(dex, int) and dex > 0 else (1, 99999)
    suffix = pokemon_walk_sheet_suffix(walk_sheet_id)
    return (dex_key[0], dex_key[1] if dex_key[0] == 0 else 0, entry.get("id") or "", suffix)


def iter_missing_sleep_slots(
    store: PackageStore,
    anim_name: str,
) -> List[Dict[str, Any]]:
    anim_id = normalize_anim_id(anim_name)
    slots: List[Dict[str, Any]] = []
    for entry in list_pokemon_library_entries(store):
        path = Path(entry["path"])
        if not path.is_file():
            continue
        pkg, _ = load_charbin_file(path)
        for walk in _walk_sheets_from_package(pkg):
            walk_id = walk.get("id") or "walk"
            if anim_id == "sleep" and package_has_sleep_for_walk(pkg, walk_id):
                continue
            if anim_id != "sleep" and package_has_animation(pkg, anim_id):
                continue
            sleep_sid = pokemon_sleep_sheet_id_for_walk(walk_id) if anim_id == "sleep" else anim_id
            slots.append(
                {
                    **entry,
                    "walkSheetId": walk_id,
                    "sleepSheetId": sleep_sid,
                    "variantLabel": variant_label_for_walk(walk_id),
                    "animId": anim_id,
                }
            )
    slots.sort(key=lambda s: _slot_sort_key(s, s["walkSheetId"]))
    return slots


def find_next_pokemon_missing_animation(
    store: PackageStore,
    anim_name: str,
    *,
    after_path: str = "",
    after_walk_sheet: str = "",
) -> Optional[Dict[str, Any]]:
    anim_id = normalize_anim_id(anim_name)
    slots = iter_missing_sleep_slots(store, anim_name)
    if not slots:
        return None
    found_after = not ((after_path or "").strip())
    for i, slot in enumerate(slots):
        if not found_after:
            if slot.get("path") == after_path and slot.get("walkSheetId") == after_walk_sheet:
                found_after = True
            continue
        return {**slot, "remaining": len(slots) - i}
    return None


def _resolve_walk_sheet(pkg: Dict[str, Any], walk_sheet_id: str) -> Dict[str, Any]:
    for sheet in _walk_sheets_from_package(pkg):
        if sheet.get("id") == walk_sheet_id:
            return sheet
    raise ValueError(f"walk sheet {walk_sheet_id!r} not found in package")


def extract_pokemon_base_frame_png(
    path: Path,
    walk_sheet_id: str = "walk",
) -> Tuple[bytes, str]:
    """South-facing frame 0 from the given walk sheet (pause pose reference)."""
    pkg, assets = load_charbin_file(path)
    sheet = _resolve_walk_sheet(pkg, walk_sheet_id)
    aid = sheet.get("assetId")
    if not aid or aid not in assets:
        raise ValueError("walk sheet asset missing")
    profile = sheet.get("profile") or pkg.get("baseProfile") or "pokemon_small"
    prof = load_sprite_profiles().get("profiles", {}).get(profile, {})
    fw = int(prof.get("frameWidth") or 32)
    fh = int(prof.get("frameHeight") or 32)
    south_row = int((prof.get("directions") or {}).get("south", {}).get("row", 0))
    img = Image.open(io.BytesIO(assets[aid]))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    x, y = 0, south_row * fh
    if x + fw > img.width or y + fh > img.height:
        raise ValueError("sheet too small for base frame crop")
    frame = img.crop((x, y, x + fw, y + fh))
    buf = io.BytesIO()
    frame.save(buf, format="PNG")
    return buf.getvalue(), profile


def compose_pokemon_anim_sheet(
    frame_pngs: List[bytes],
    profile_name: str,
    *,
    frame_cols: Optional[List[int]] = None,
    south_row_only: bool = False,
) -> bytes:
    """Build 4×4 profile grid. ``south_row_only`` paints only the down/south row (sleep)."""
    prof = load_sprite_profiles().get("profiles", {}).get(profile_name, {})
    fw = int(prof.get("frameWidth") or 32)
    fh = int(prof.get("frameHeight") or 32)
    cols = int(prof.get("columns") or 4)
    rows = int(prof.get("rows") or 4)
    south_row = int((prof.get("directions") or {}).get("south", {}).get("row", 0))
    out = Image.new("RGBA", (fw * cols, fh * rows), (0, 0, 0, 0))
    frames: List[Image.Image] = []
    for blob in frame_pngs:
        im = Image.open(io.BytesIO(blob)).convert("RGBA")
        if im.size != (fw, fh):
            im = im.resize((fw, fh), Image.Resampling.NEAREST)
        frames.append(im)
    if not frames:
        raise ValueError("at least one frame required")
    col_indices = frame_cols if frame_cols is not None else list(range(len(frames)))
    target_rows = [south_row] if south_row_only else list(range(rows))
    for row in target_rows:
        for ci, frame_im in zip(col_indices, frames):
            if ci < 0 or ci >= cols:
                continue
            out.paste(frame_im, (ci * fw, row * fh), frame_im)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def apply_quick_anim_to_path(
    path: Path,
    anim_name: str,
    frame_pngs: List[bytes],
    *,
    walk_sheet_id: str = "walk",
    frame_time_ms: int = 400,
) -> Dict[str, Any]:
    anim_id = normalize_anim_id(anim_name)
    if len(frame_pngs) < 1:
        raise ValueError("at least one frame PNG required")
    pkg, assets = load_charbin_file(path)
    meta = pkg.get("metadata") or {}
    if meta.get("characterType") != "pokemon":
        raise ValueError("quick anim apply is for pokemon charbins only")
    _resolve_walk_sheet(pkg, walk_sheet_id)
    profile = pkg.get("baseProfile") or "pokemon_small"
    south_only = anim_uses_south_row_only(anim_id)
    sheet_png = compose_pokemon_anim_sheet(
        frame_pngs, profile, south_row_only=south_only
    )
    if anim_id == "sleep":
        from spmk_app.pokemon_variant_model import (
            attach_variant_fields,
            pokemon_sleep_action,
            sync_sheet_variant_fields,
        )

        walk_sheet = _resolve_walk_sheet(pkg, walk_sheet_id)
        walk_synced = sync_sheet_variant_fields(walk_sheet)
        form_id = walk_synced.get("formId") or "default"
        modifiers = walk_synced.get("modifiers") or []
        sheet_id = pokemon_sleep_sheet_id_for_walk(walk_sheet_id)
        anim_key = "sleep"
    else:
        sheet_id = anim_id
        anim_key = anim_id
        form_id = "default"
        modifiers: List[str] = []
    asset_id = f"{sheet_id}_png"
    frame_indices = list(range(min(len(frame_pngs), 4)))
    sheets = [s for s in (pkg.get("spriteSheets") or []) if (s.get("id") or "") != sheet_id]
    sheet_rec: Dict[str, Any] = {
        "id": sheet_id,
        "name": anim_key.replace("_", " ").title(),
        "assetId": asset_id,
        "profile": profile,
        "animations": {
            anim_key: {
                "frames": frame_indices,
                "frameTimeMs": max(50, int(frame_time_ms)),
                "loop": True,
            }
        },
    }
    if anim_id == "sleep":
        sheet_rec = attach_variant_fields(
            sheet_rec, form_id=form_id, modifiers=modifiers, behavior="sleep"
        )
        new_action = pokemon_sleep_action(form_id, modifiers, sheet_id)
    else:
        new_action = {
            "id": sheet_id,
            "type": "idle",
            "sheetId": sheet_id,
            "animationName": anim_key,
            "movementDriven": False,
        }
    sheets.append(sheet_rec)
    action_id = new_action["id"]
    actions = [a for a in (pkg.get("actions") or []) if (a.get("id") or "") != action_id]
    actions.append(new_action)
    stale_assets = {
        s.get("assetId")
        for s in (pkg.get("spriteSheets") or [])
        if s.get("id") == sheet_id and s.get("assetId")
    }
    pkg = {**pkg, "spriteSheets": sheets, "actions": actions}
    assets = {k: v for k, v in assets.items() if k not in stale_assets or k == asset_id}
    assets[asset_id] = sheet_png
    merged = collect_assets_from_package(pkg, assets)
    save_charbin_file(path, pkg, merged)
    return {
        "path": str(path.resolve()),
        "animId": anim_key,
        "sheetId": sheet_id,
        "walkSheetId": walk_sheet_id,
    }
