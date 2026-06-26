"""Character package schema, validation, and debug export.

Schema reference (keep in sync): docs/CHARBIN_SCHEMA.md
"""
from __future__ import annotations

import io
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from PIL import Image

from spmk_app.charbin_io import FORMAT_VERSION, read_charbin, write_charbin

_DATA = Path(__file__).resolve().parent / "data" / "sprite_profiles.json"
_SUPPORTED_SCHEMA = {1}
_ID_RE = re.compile(r"^[a-z][a-z0-9_]*$")

# Runtime/map fields that must never live in a static package.
_FORBIDDEN_ROOT_KEYS = {
    "mapId",
    "map",
    "position",
    "worldPosition",
    "spawn",
    "spawnPoint",
    "currentDirection",
    "currentMap",
    "partyState",
    "runtimeState",
    "eventState",
    "x",
    "y",
    "z",
    "tileX",
    "tileY",
}


def load_sprite_profiles() -> Dict[str, Any]:
    return json.loads(_DATA.read_text(encoding="utf-8"))


def profile_names() -> Set[str]:
    return set(load_sprite_profiles().get("profiles", {}).keys())


def empty_package(
    char_id: str = "new_character",
    display_name: str = "New Character",
) -> Dict[str, Any]:
    return {
        "schemaVersion": 1,
        "packageType": "character",
        "id": char_id,
        "displayName": display_name,
        "internalName": char_id,
        "metadata": {
            "originGame": "",
            "characterType": "npc",
            "description": "",
            "personality": [],
            "likes": [],
            "dislikes": [],
            "tags": [],
            "partnerPokemon": None,
            "extraPartnerPokemon": [],
            "pokemonId": None,
            "speciesName": "",
            "forms": [],
            "selectedFormId": "default",
            "pokedexEntry": "",
            "pokemonTypes": [],
            "pokeapi": None,
            "objectAnimated": False,
            "custom": {},
        },
        "baseProfile": "character",
        "spriteSheets": [],
        "actions": [],
        "dialogue": {"lines": [], "packs": [], "custom": {}},
        "relationships": [],
        "unlock": None,
        "custom": {},
    }


def deep_merge_preserve_unknown(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """Merge patch into base; unknown keys in base are kept."""
    out = deepcopy(base)
    for key, val in patch.items():
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge_preserve_unknown(out[key], val)
        else:
            out[key] = val
    return out


def is_pokemon_package(package: Dict[str, Any]) -> bool:
    meta = package.get("metadata") or {}
    ct = str(meta.get("characterType") or "npc").lower()
    return ct == "pokemon"


def is_object_package(package: Dict[str, Any]) -> bool:
    meta = package.get("metadata") or {}
    return str(meta.get("characterType") or "npc").lower() == "object"


def _primary_sprite_sheet(sheets: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for sid in ("sheet", "sprite", "walk"):
        hit = next((s for s in sheets if s.get("id") == sid and s.get("assetId")), None)
        if hit:
            return hit
    return next((s for s in sheets if s.get("assetId")), None)


def is_pokemon_walk_sheet_id(sheet_id: str) -> bool:
    return sheet_id == "walk" or sheet_id.startswith("walk_")


def is_pokemon_sleep_sheet_id(sheet_id: str) -> bool:
    return sheet_id == "sleep" or sheet_id.startswith("sleep_")


def pokemon_sleep_sheet_id_for_walk(walk_sheet_id: str) -> str:
    """``walk`` → ``sleep``; ``walk_42`` → ``sleep_42``."""
    suffix = pokemon_walk_sheet_suffix(walk_sheet_id)
    return f"sleep_{suffix}" if suffix else "sleep"


def pokemon_sleep_action_id_for_walk(walk_sheet_id: str) -> str:
    return pokemon_sleep_sheet_id_for_walk(walk_sheet_id)


def pokemon_walk_sheet_suffix(sheet_id: str) -> str:
    if not sheet_id or sheet_id == "walk":
        return ""
    if sheet_id.startswith("walk_"):
        return sheet_id[5:]
    return sheet_id


def sort_pokemon_walk_sheets(sheets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Default ``walk`` first, then other variants (numeric-friendly order)."""

    def key(sheet: Dict[str, Any]) -> tuple:
        sa = pokemon_walk_sheet_suffix(sheet.get("id") or "")
        return (0 if not sa else 1, sa)

    return sorted(sheets, key=key)


def preferred_pokemon_walk_sheet(package: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Base ``walk`` sheet when present; otherwise first sorted variant."""
    sheets = [
        s
        for s in (package.get("spriteSheets") or [])
        if s.get("assetId") and is_pokemon_walk_sheet_id(s.get("id") or "")
    ]
    if not sheets:
        return None
    return sort_pokemon_walk_sheets(sheets)[0]


def preferred_walk_sheet(package: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Primary walk/sprite sheet used for library thumbnails and size metadata."""
    meta = package.get("metadata") or {}
    ct = str(meta.get("characterType") or "npc").lower()
    sheets = package.get("spriteSheets") or []
    if ct == "pokemon":
        return preferred_pokemon_walk_sheet(package)
    if ct == "object":
        return next((s for s in sheets if s.get("assetId")), None)
    for sid in ("walk", "sheet"):
        hit = next((s for s in sheets if s.get("assetId") and s.get("id") == sid), None)
        if hit:
            return hit
    return next((s for s in sheets if s.get("assetId")), None)


def effective_sheet_cell_size(sheet: Dict[str, Any], package: Dict[str, Any]) -> Tuple[int, int]:
    prof_name = sheet.get("profile") or package.get("baseProfile") or "character"
    prof = load_sprite_profiles().get("profiles", {}).get(prof_name, {})
    overrides = sheet.get("profileOverrides") or {}
    fw = int(overrides.get("frameWidth") or prof.get("frameWidth") or 32)
    fh = int(overrides.get("frameHeight") or prof.get("frameHeight") or fw)
    return fw, fh


def _sheet_png_size_bucket(width: int, height: int) -> str:
    """Bucket raw PNG size by longest edge (128 / 160 / 256 / other)."""
    longest = max(int(width), int(height))
    if longest == 128:
        return "128"
    if longest == 160:
        return "160"
    if longest == 256:
        return "256"
    return "other"


def library_walk_meta(
    package: Dict[str, Any], assets: Optional[Dict[str, bytes]] = None
) -> Dict[str, Any]:
    """Walk-sheet cell + raw PNG dimensions for library filters."""
    sheet = preferred_walk_sheet(package)
    if not sheet:
        return {}
    fw, fh = effective_sheet_cell_size(sheet, package)
    out: Dict[str, Any] = {
        "walkSheetId": sheet.get("id"),
        "walkCellWidth": fw,
        "walkCellHeight": fh,
        "baseProfile": sheet.get("profile") or package.get("baseProfile"),
    }
    aid = sheet.get("assetId")
    if assets and aid and aid in assets:
        img = Image.open(io.BytesIO(assets[aid]))
        out["walkSheetWidth"] = int(img.width)
        out["walkSheetHeight"] = int(img.height)
    return out


def library_all_sheets_meta(
    package: Dict[str, Any], assets: Optional[Dict[str, bytes]] = None
) -> Dict[str, Any]:
    """Every embedded sheet PNG dimension + size buckets for library filters."""
    if not assets:
        return {"sheetDimensions": [], "sheetSizeBuckets": []}
    dimensions: List[Dict[str, Any]] = []
    buckets: Set[str] = set()
    for sheet in package.get("spriteSheets") or []:
        aid = sheet.get("assetId")
        if not aid or aid not in assets:
            continue
        img = Image.open(io.BytesIO(assets[aid]))
        w, h = int(img.width), int(img.height)
        dimensions.append({"id": sheet.get("id"), "width": w, "height": h})
        buckets.add(_sheet_png_size_bucket(w, h))
    return {
        "sheetDimensions": dimensions,
        "sheetSizeBuckets": sorted(buckets),
    }


def pokemon_variant_from_sheet_id(sheet_id: str) -> Optional[str]:
    """``walk`` → base; ``walk_shiny`` → ``shiny``."""
    if sheet_id == "walk":
        return None
    if sheet_id.startswith("walk_"):
        return sheet_id[5:] or None
    return None


def pokemon_sheet_id_for_variant(variant: Optional[str]) -> str:
    from spmk_app.pokemon_batch_parse import pokemon_sheet_id_for_suffix

    return pokemon_sheet_id_for_suffix(variant)


def default_pokemon_actions_for_sheet(sheet_id: str) -> List[Dict[str, Any]]:
    """Idle + walk actions for a walk sheet (no pause — engine uses profile pause)."""
    from spmk_app.pokemon_variant_model import (
        DEFAULT_FORM_ID,
        actions_for_sheet_import,
        sync_sheet_variant_fields,
    )

    synced = sync_sheet_variant_fields({"id": sheet_id})
    form_id = synced.get("formId") or DEFAULT_FORM_ID
    modifiers = synced.get("modifiers") or []
    behavior = synced.get("behavior") or "walk"
    if behavior != "walk":
        from spmk_app.pokemon_variant_model import actions_for_sheet_import as act_for

        return act_for(form_id, modifiers, behavior, sheet_id)
    return actions_for_sheet_import(form_id, modifiers, "walk", sheet_id)


def default_pokemon_actions(sheet_id: str = "walk") -> List[Dict[str, Any]]:
    return default_pokemon_actions_for_sheet(sheet_id)


def default_object_actions(sheet_id: str = "sheet") -> List[Dict[str, Any]]:
    """Map objects: single non-looping play animation (row-major frames on sheet)."""
    return [
        {
            "id": "play",
            "type": "idle",
            "sheetId": sheet_id,
            "animationName": "play",
            "movementDriven": False,
        },
    ]


def default_character_actions(sheet_id: str = "walk") -> List[Dict[str, Any]]:
    return [
        {
            "id": "idle",
            "type": "idle",
            "sheetId": sheet_id,
            "animationName": "idle",
            "movementDriven": False,
        },
        {
            "id": "walk",
            "type": "movement",
            "sheetId": sheet_id,
            "animationName": "walk",
            "movementDriven": True,
        },
    ]


def ensure_package_actions(package: Dict[str, Any]) -> Dict[str, Any]:
    """Fill standard actions when a sheet with an embedded asset exists."""
    out = deepcopy(package)
    sheets = out.get("spriteSheets") or []
    if is_object_package(out):
        primary = _primary_sprite_sheet(sheets)
        if not primary:
            return out
        sheet_id = primary.get("id") or "sheet"
        defaults = default_object_actions(sheet_id)
    elif is_pokemon_package(out):
        from spmk_app.pokemon_variant_model import (
            actions_for_sheet_import,
            sync_sheet_variant_fields,
        )

        merged: List[Dict[str, Any]] = []
        seen_keys: Set[tuple] = set()
        for sheet in sheets:
            if not sheet.get("assetId"):
                continue
            synced = sync_sheet_variant_fields(sheet)
            sid = synced.get("id") or ""
            key = (
                sid,
                synced.get("formId"),
                tuple(synced.get("modifiers") or []),
                synced.get("behavior"),
            )
            if key in seen_keys:
                continue
            seen_keys.add(key)
            merged.extend(
                actions_for_sheet_import(
                    synced.get("formId") or "default",
                    synced.get("modifiers") or [],
                    synced.get("behavior") or "walk",
                    sid,
                )
            )
        if not merged:
            return out
        keep_ids = {d["id"] for d in merged}
        extra = [a for a in (out.get("actions") or []) if a.get("id") not in keep_ids]
        out["actions"] = merged + extra
        return out
    else:
        walk_sheet = next((s for s in sheets if s.get("id") == "walk" and s.get("assetId")), None)
        if not walk_sheet:
            return out
        sheet_id = walk_sheet.get("id") or "walk"
        defaults = default_character_actions(sheet_id)
    keep_ids = {d["id"] for d in defaults}
    extra = [a for a in (out.get("actions") or []) if a.get("id") not in keep_ids]
    out["actions"] = defaults + extra
    return out


def collect_assets_from_package(package: Dict[str, Any], blobs: Dict[str, bytes]) -> Dict[str, bytes]:
    """Build asset dict referenced by spriteSheets.assetId."""
    out: Dict[str, bytes] = {}
    for sheet in package.get("spriteSheets") or []:
        aid = sheet.get("assetId")
        if aid and aid in blobs:
            out[aid] = blobs[aid]
    return out


def validate_package(
    package: Dict[str, Any],
    assets: Optional[Dict[str, bytes]] = None,
    *,
    require_character_idle_walk: bool = True,
) -> Dict[str, Any]:
    """Return {ok, errors[], warnings[]}."""
    errors: List[str] = []
    warnings: List[str] = []
    profiles = profile_names()
    assets = assets or {}

    schema = package.get("schemaVersion")
    if schema not in _SUPPORTED_SCHEMA:
        errors.append(f"unknown schemaVersion {schema!r}")

    for key in _FORBIDDEN_ROOT_KEYS:
        if key in package:
            errors.append(f"runtime field must not be in package: {key}")

    cid = package.get("id") or ""
    if not cid or not _ID_RE.match(str(cid)):
        errors.append("id must be lowercase slug (a-z, 0-9, underscore)")

    base_profile = package.get("baseProfile") or "character"
    if base_profile not in profiles:
        errors.append(f"unsupported baseProfile {base_profile!r}")

    sheet_ids: Set[str] = set()
    asset_ids: Set[str] = set()
    for sheet in package.get("spriteSheets") or []:
        sid = sheet.get("id")
        if not sid:
            errors.append("spriteSheet missing id")
            continue
        if sid in sheet_ids:
            errors.append(f"duplicate spriteSheet id {sid!r}")
        sheet_ids.add(sid)

        aid = sheet.get("assetId")
        if not aid:
            errors.append(f"sheet {sid!r} missing assetId")
        elif aid in asset_ids:
            errors.append(f"duplicate assetId {aid!r}")
        else:
            asset_ids.add(aid)
        if aid and assets is not None and aid not in assets:
            errors.append(f"sheet {sid!r} missing embedded asset {aid!r}")

        prof = sheet.get("profile") or base_profile
        if prof not in profiles:
            errors.append(f"sheet {sid!r} uses unsupported profile {prof!r}")

        overrides = sheet.get("profileOverrides") or {}
        prof_def = load_sprite_profiles()["profiles"].get(prof, {})
        cols = overrides.get("columns", prof_def.get("columns", 4))
        rows = overrides.get("rows", prof_def.get("rows", 4))
        max_frame = cols * rows - 1

        anims = sheet.get("animations") or {}
        prof_anims = prof_def.get("animations") or {}
        for anim_name, anim in {**prof_anims, **anims}.items():
            if anim_name in prof_anims and anim_name not in anims:
                continue
            spec = anims.get(anim_name) or anim
            for fi in spec.get("frames") or []:
                if not isinstance(fi, int) or fi < 0 or fi > max_frame:
                    errors.append(
                        f"sheet {sid!r} animation {anim_name!r} frame {fi!r} out of range (0..{max_frame})"
                    )
            for cell in spec.get("cells") or []:
                r, c = cell.get("row"), cell.get("col")
                if r is None or c is None:
                    errors.append(f"sheet {sid!r} animation {anim_name!r} cell missing row/col")
                elif r < 0 or r >= rows or c < 0 or c >= cols:
                    errors.append(
                        f"sheet {sid!r} animation {anim_name!r} cell row={r} col={c} invalid"
                    )

    action_ids: Set[str] = set()
    has_idle = has_walk = has_pause = False
    for act in package.get("actions") or []:
        aid = act.get("id")
        if not aid:
            errors.append("action missing id")
            continue
        if aid in action_ids:
            errors.append(f"duplicate action id {aid!r}")
        action_ids.add(aid)

        sheet_id = act.get("sheetId")
        if sheet_id and sheet_id not in sheet_ids:
            errors.append(f"action {aid!r} references unknown sheetId {sheet_id!r}")

        anim = act.get("animationName") or ""
        if act.get("id") == "pause":
            has_pause = True
        if act.get("type") == "idle":
            has_idle = True
        if act.get("type") in ("movement", "walk"):
            has_walk = True

        if sheet_id and anim:
            sheet = next((s for s in package.get("spriteSheets") or [] if s.get("id") == sheet_id), None)
            if sheet:
                prof = sheet.get("profile") or base_profile
                prof_def = load_sprite_profiles()["profiles"].get(prof, {})
                custom = (sheet.get("animations") or {}).get(anim)
                if anim not in (prof_def.get("animations") or {}) and not custom:
                    warnings.append(f"action {aid!r} animation {anim!r} not in profile or sheet overrides")

    if is_object_package(package):
        has_play = any(a.get("id") == "play" for a in package.get("actions") or [])
        if not has_play:
            warnings.append('object: no play action defined (use animationName "play")')
        if any(a.get("type") in ("movement", "walk") for a in package.get("actions") or []):
            warnings.append("object: movement/walk actions are unusual for non-moving map objects")

    if require_character_idle_walk and base_profile == "character" and not is_pokemon_package(package) and not is_object_package(package):
        if not has_idle:
            warnings.append("character profile: no idle action defined")
        if not has_walk:
            warnings.append("character profile: no walk/movement action defined")

    if is_pokemon_package(package):
        if not has_walk:
            warnings.append("pokemon: no walk/movement action defined")
        for idle_act in [a for a in package.get("actions") or [] if (a.get("id") or "").startswith("idle")]:
            if idle_act.get("animationName") != "walk":
                warnings.append(
                    f'pokemon: idle action {idle_act.get("id")!r} should use animationName "walk" (walk cycle while idle)'
                )

    meta = package.get("metadata") or {}
    if "partnerPokemon" not in meta:
        warnings.append("metadata.partnerPokemon should be present (null allowed)")

    return {"ok": len(errors) == 0, "errors": errors, "warnings": warnings}


def export_debug_loose(
    package: Dict[str, Any],
    assets: Dict[str, bytes],
    out_dir: Path,
) -> Path:
    """Write {id}.character.json and assets/*.png for game debugging."""
    out_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = out_dir / "assets"
    assets_dir.mkdir(exist_ok=True)
    manifest = deepcopy(package)
    for sheet in manifest.get("spriteSheets") or []:
        aid = sheet.get("assetId")
        if aid and aid in assets:
            rel = f"assets/{aid}.png"
            (out_dir / rel).write_bytes(assets[aid])
            sheet["debugAssetPath"] = rel
    json_path = out_dir / f"{package.get('id', 'character')}.character.json"
    json_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return json_path


def package_from_charbin_bytes(data: bytes) -> Tuple[Dict[str, Any], Dict[str, bytes]]:
    return read_charbin(data)


def package_to_charbin_bytes(package: Dict[str, Any], assets: Dict[str, bytes]) -> bytes:
    return write_charbin(package, collect_assets_from_package(package, assets))
