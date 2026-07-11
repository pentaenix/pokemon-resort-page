"""Charbin-aware generate targets: walk source slots → missing output behaviors (swim, sleep, …)."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from spmk_app.charbin_io import load_charbin_file
from spmk_app.character_package import pokemon_sleep_sheet_id_for_walk
from spmk_app.package_quick_anim import (
    _walk_sheets_from_package,
    list_pokemon_library_entries,
    normalize_anim_id,
    variant_label_for_walk,
)
from spmk_app.package_store import PackageStore
from spmk_app.pokemon_variant_model import (
    action_id_for_variant,
    sheet_id_for_variant,
    sync_sheet_variant_fields,
)

OUTPUT_BEHAVIORS: tuple[str, ...] = ("swim", "sleep", "eating")


def normalize_output_behavior(name: str) -> str:
    raw = normalize_anim_id(name)
    if raw not in OUTPUT_BEHAVIORS:
        raise ValueError(f"output behavior must be one of {', '.join(OUTPUT_BEHAVIORS)}")
    return raw


def expected_output_sheet_id(walk_sheet_id: str, walk_sheet: Dict[str, Any], output_behavior: str) -> str:
    output_behavior = normalize_output_behavior(output_behavior)
    if output_behavior == "sleep":
        return pokemon_sleep_sheet_id_for_walk(walk_sheet_id)
    synced = sync_sheet_variant_fields(walk_sheet)
    return sheet_id_for_variant(
        synced.get("formId") or "default",
        synced.get("modifiers") or [],
        output_behavior,
    )


def slot_has_output_sheet(pkg: Dict[str, Any], output_sheet_id: str) -> bool:
    for sheet in pkg.get("spriteSheets") or []:
        if sheet.get("id") == output_sheet_id and sheet.get("assetId"):
            return True
    return False


def slot_missing_output(
    pkg: Dict[str, Any],
    walk_sheet: Dict[str, Any],
    output_behavior: str,
) -> bool:
    walk_id = walk_sheet.get("id") or "walk"
    out_id = expected_output_sheet_id(walk_id, walk_sheet, output_behavior)
    return not slot_has_output_sheet(pkg, out_id)


def _slot_sort_key(entry: Dict[str, Any], walk_sheet_id: str) -> tuple:
    dex = entry.get("pokemonId")
    dex_key = (0, dex) if isinstance(dex, int) and dex > 0 else (1, 99999)
    suffix = variant_label_for_walk(walk_sheet_id)
    return (dex_key[0], dex_key[1] if dex_key[0] == 0 else 0, entry.get("id") or "", suffix)


def iter_generate_slots(
    store: PackageStore,
    output_behavior: str,
    *,
    missing_only: bool = True,
) -> List[Dict[str, Any]]:
    output_behavior = normalize_output_behavior(output_behavior)
    slots: List[Dict[str, Any]] = []
    for entry in list_pokemon_library_entries(store):
        path = Path(entry["path"])
        if not path.is_file():
            continue
        pkg, _ = load_charbin_file(path)
        for walk in _walk_sheets_from_package(pkg):
            walk_id = walk.get("id") or "walk"
            synced = sync_sheet_variant_fields(walk)
            missing = slot_missing_output(pkg, walk, output_behavior)
            if missing_only and not missing:
                continue
            out_sheet_id = expected_output_sheet_id(walk_id, walk, output_behavior)
            slots.append(
                {
                    "path": str(path.resolve()),
                    "packageId": entry.get("id") or pkg.get("id"),
                    "displayName": entry.get("displayName") or pkg.get("displayName") or pkg.get("id"),
                    "pokemonId": entry.get("pokemonId"),
                    "walkSheetId": walk_id,
                    "variantLabel": variant_label_for_walk(walk_id),
                    "formId": synced.get("formId") or "default",
                    "modifiers": list(synced.get("modifiers") or []),
                    "outputBehavior": output_behavior,
                    "outputSheetId": out_sheet_id,
                    "sourceActionId": action_id_for_variant(
                        synced.get("formId") or "default",
                        synced.get("modifiers") or [],
                        "walk",
                    ),
                    "outputActionId": action_id_for_variant(
                        synced.get("formId") or "default",
                        synced.get("modifiers") or [],
                        output_behavior,
                    ),
                    "missingOutput": missing,
                }
            )
    slots.sort(key=lambda s: _slot_sort_key(s, s["walkSheetId"]))
    return slots


def count_missing_output_slots(store: PackageStore, output_behavior: str) -> int:
    return len(iter_generate_slots(store, output_behavior, missing_only=True))


def find_slot_by_keys(
    slots: List[Dict[str, Any]],
    path: str,
    walk_sheet_id: str,
) -> Optional[Dict[str, Any]]:
    for slot in slots:
        if slot.get("path") == path and slot.get("walkSheetId") == walk_sheet_id:
            return slot
    return None


def find_next_missing_slot(
    store: PackageStore,
    output_behavior: str,
    *,
    after_path: str = "",
    after_walk_sheet: str = "",
) -> Optional[Dict[str, Any]]:
    slots = iter_generate_slots(store, output_behavior, missing_only=True)
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


def describe_generate_slot(
    store: PackageStore,
    path: str,
    walk_sheet_id: str,
    output_behavior: str,
) -> Dict[str, Any]:
    output_behavior = normalize_output_behavior(output_behavior)
    path_obj = Path(path)
    if not path_obj.is_file():
        raise ValueError(f"charbin not found: {path}")
    pkg, _ = load_charbin_file(path_obj)
    walk = next((s for s in _walk_sheets_from_package(pkg) if s.get("id") == walk_sheet_id), None)
    if not walk:
        raise ValueError(f"walk sheet {walk_sheet_id!r} not found")
    synced = sync_sheet_variant_fields(walk)
    out_sheet_id = expected_output_sheet_id(walk_sheet_id, walk, output_behavior)
    out_sheet = next((s for s in pkg.get("spriteSheets") or [] if s.get("id") == out_sheet_id), None)
    entry = next(
        (e for e in list_pokemon_library_entries(store) if e.get("path") == str(path_obj.resolve())),
        {},
    )
    walk_options = []
    for ws in _walk_sheets_from_package(pkg):
        wid = ws.get("id") or "walk"
        ws_synced = sync_sheet_variant_fields(ws)
        walk_options.append(
            {
                "walkSheetId": wid,
                "variantLabel": variant_label_for_walk(wid),
                "formId": ws_synced.get("formId") or "default",
                "modifiers": list(ws_synced.get("modifiers") or []),
                "missingOutput": slot_missing_output(pkg, ws, output_behavior),
            }
        )
    return {
        "path": str(path_obj.resolve()),
        "packageId": pkg.get("id"),
        "displayName": pkg.get("displayName") or pkg.get("id"),
        "pokemonId": entry.get("pokemonId"),
        "walkSheetId": walk_sheet_id,
        "variantLabel": variant_label_for_walk(walk_sheet_id),
        "formId": synced.get("formId") or "default",
        "modifiers": list(synced.get("modifiers") or []),
        "outputBehavior": output_behavior,
        "outputSheetId": out_sheet_id,
        "sourceActionId": action_id_for_variant(
            synced.get("formId") or "default",
            synced.get("modifiers") or [],
            "walk",
        ),
        "outputActionId": action_id_for_variant(
            synced.get("formId") or "default",
            synced.get("modifiers") or [],
            output_behavior,
        ),
        "missingOutput": slot_missing_output(pkg, walk, output_behavior),
        "hasOutputSheet": bool(out_sheet and out_sheet.get("assetId")),
        "walkOptions": walk_options,
        "baseFrameUrl": f"/api/packages/quick-anim/base-frame?path={path_obj.resolve()}&walkSheet={walk_sheet_id}",
        "thumbnailUrl": f"/api/packages/library-thumb/{entry.get('id')}" if entry.get("id") else None,
    }
