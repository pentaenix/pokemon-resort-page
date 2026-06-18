"""Batch import .charbin packages from named sprite PNGs."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from spmk_app.charbin_io import load_charbin_file, save_charbin_file
from spmk_app.character_package import (
    collect_assets_from_package,
    default_pokemon_actions_for_sheet,
    empty_package,
    ensure_package_actions,
)
from spmk_app.package_image import (
    detect_object_play_frames,
    prepare_pokemon_sheet_bytes,
    prepare_sheet_image_bytes,
)
from spmk_app.package_paths import charbin_path_for_package
from spmk_app.package_store import PackageStore
from spmk_app.pokeapi_client import (
    lookup_item,
    lookup_pokemon_for_import,
    pokeapi_slug_from_stem,
    slug_from_filename_stem,
)
from spmk_app.pokemon_batch_parse import (
    ParsedPokemonImport,
    parse_pokemon_import,
)

_BATCH_TYPES = frozenset({"player", "npc", "pokemon", "object"})
_IMPORT_MODES = frozenset({"create", "add"})


def normalize_batch_character_type(raw: str) -> str:
    ct = (raw or "npc").strip().lower()
    if ct == "playable":
        return "player"
    if ct not in _BATCH_TYPES:
        raise ValueError(f"unsupported batch characterType {raw!r}")
    return ct


def normalize_import_mode(raw: str) -> str:
    mode = (raw or "create").strip().lower()
    if mode not in _IMPORT_MODES:
        raise ValueError(f"unsupported importMode {raw!r}")
    return mode


def _display_name_from_stem(stem: str) -> str:
    return stem.replace("_", " ").replace("-", " ").strip().title() or "Asset"


def pokemon_package_id(parsed: ParsedPokemonImport, fill: Optional[Dict[str, Any]] = None) -> str:
    """Stable charbin id (underscores); uses PokéAPI slug when lookup succeeded."""
    if fill:
        return slug_from_filename_stem(fill.get("id") or fill.get("internalName") or parsed.species_id)
    return parsed.species_id


def _pokemon_has_extra_walk_sheets(package: Dict[str, Any]) -> bool:
    for sheet in package.get("spriteSheets") or []:
        sid = sheet.get("id") or ""
        if sid.startswith("walk_"):
            return True
    return False


def _register_overworld_sprite_keys(meta: Dict[str, Any], parsed: ParsedPokemonImport) -> None:
    """Track which walk sheets exist (forms × modifiers) for large species like Alcremie."""
    custom = meta.setdefault("custom", {})
    keys: List[str] = custom.get("overworldSpriteKeys") or []
    if not isinstance(keys, list):
        keys = []
    key = parsed.sheet_suffix or "default"
    if key not in keys:
        keys.append(key)
    keys.sort(key=lambda k: (k != "default", k))
    custom["overworldSpriteKeys"] = keys
    if parsed.form_key:
        form_ids: List[str] = custom.get("overworldFormIds") or []
        if not isinstance(form_ids, list):
            form_ids = []
        if parsed.form_key not in form_ids:
            form_ids.append(parsed.form_key)
        form_ids.sort(key=lambda x: (not x.isdigit(), int(x) if x.isdigit() else x))
        custom["overworldFormIds"] = form_ids


def _apply_pokemon_metadata(
    pkg: Dict[str, Any],
    fill: Dict[str, Any],
    parsed: ParsedPokemonImport,
    *,
    profile_name: str,
    prep: Dict[str, Any],
) -> None:
    pkg_id = pokemon_package_id(parsed, fill)
    pkg["id"] = pkg_id
    meta = pkg.setdefault("metadata", {})
    meta["characterType"] = "pokemon"
    meta["pokemonSize"] = prep.get("pokemonSize") or (
        "large" if profile_name == "pokemon_large" else "small"
    )
    meta["pokemonId"] = fill.get("pokemonId")
    meta["speciesName"] = fill.get("speciesName") or ""
    meta["forms"] = fill.get("forms") or []
    meta["selectedFormId"] = fill.get("selectedFormId") or "default"
    meta["originGame"] = fill.get("originGame") or ""
    meta["pokedexEntry"] = fill.get("pokedexEntry") or ""
    meta["pokemonTypes"] = fill.get("types") or []
    meta["pokeapi"] = fill.get("pokeapi")
    _register_overworld_sprite_keys(meta, parsed)
    pkg["displayName"] = fill.get("displayName") or pkg.get("displayName")
    pkg["internalName"] = pkg_id
    pkg["baseProfile"] = profile_name


def _apply_item_metadata(pkg: Dict[str, Any], fill: Dict[str, Any]) -> None:
    meta = pkg.setdefault("metadata", {})
    meta["characterType"] = "object"
    meta["objectAnimated"] = True
    meta["description"] = fill.get("description") or ""
    meta["category"] = fill.get("category") or ""
    meta["itemApi"] = fill.get("itemApi")
    pkg["displayName"] = fill.get("displayName") or pkg.get("displayName")
    pkg["internalName"] = fill.get("internalName") or pkg.get("id")


def _sheet_label(parsed: ParsedPokemonImport) -> str:
    if parsed.is_base_walk:
        return "Walk"
    bits: List[str] = []
    if parsed.form_key:
        bits.append(f"form {parsed.form_key}")
    if parsed.modifiers:
        bits.append(" ".join(parsed.modifiers))
    return f"Walk ({', '.join(bits)})" if bits else "Walk"


def _pokemon_sheet_record(sheet_id: str, asset_id: str, base_profile: str, sheet_label: str) -> Dict[str, Any]:
    return {
        "id": sheet_id,
        "name": sheet_label,
        "assetId": asset_id,
        "profile": base_profile,
    }


def _merge_pokemon_sheet(
    package: Dict[str, Any],
    assets: Dict[str, bytes],
    sheet_rec: Dict[str, Any],
    sheet_id: str,
    new_asset_bytes: Dict[str, bytes],
    parsed: ParsedPokemonImport,
) -> Tuple[Dict[str, Any], Dict[str, bytes]]:
    out = deepcopy(package)
    merged_assets = dict(assets)
    merged_assets.update(new_asset_bytes)
    sheets = [s for s in (out.get("spriteSheets") or []) if s.get("id") != sheet_id]
    sheets.append(sheet_rec)
    out["spriteSheets"] = sheets
    new_actions = default_pokemon_actions_for_sheet(sheet_id)
    replace_ids = {a["id"] for a in new_actions}
    actions = [a for a in (out.get("actions") or []) if a.get("id") not in replace_ids]
    out["actions"] = actions + new_actions
    meta = out.setdefault("metadata", {})
    _register_overworld_sprite_keys(meta, parsed)
    prof = sheet_rec.get("profile") or out.get("baseProfile")
    if prof == "pokemon_large":
        out["baseProfile"] = "pokemon_large"
        meta["pokemonSize"] = "large"
    return out, merged_assets


def _build_pokemon_package(
    parsed: ParsedPokemonImport,
    stem: str,
    png_bytes: bytes,
) -> Tuple[Dict[str, Any], Dict[str, bytes], Dict[str, Any]]:
    sheet_id = parsed.sheet_id
    asset_id = f"{sheet_id}_png"
    label = _sheet_label(parsed)
    lookup, api_slug_used = lookup_pokemon_for_import(parsed.species_id)
    pkg_id = pokemon_package_id(parsed)
    report: Dict[str, Any] = {
        "id": pkg_id,
        "form": parsed.form_key,
        "modifiers": list(parsed.modifiers),
        "sheetSuffix": parsed.sheet_suffix,
        "sheetId": sheet_id,
        "pokeapi": None,
        "pokeapiSlug": api_slug_used,
    }

    fill: Optional[Dict[str, Any]] = None
    if not lookup.get("found"):
        report["pokeapi"] = {
            "found": False,
            "suggestion": lookup.get("suggestion"),
            "corrected": False,
        }
        pkg = empty_package(pkg_id, _display_name_from_stem(parsed.species_id))
        pkg["metadata"]["characterType"] = "pokemon"
    else:
        fill = lookup["data"]
        corrected = api_slug_used != pokeapi_slug_from_stem(parsed.species_id)
        report["pokeapi"] = {"found": True, "corrected": corrected}
        if corrected:
            report["pokeapi"]["suggestion"] = api_slug_used
        pkg_id = pokemon_package_id(parsed, fill)
        report["id"] = pkg_id
        pkg = empty_package(
            pkg_id,
            fill.get("displayName") or _display_name_from_stem(parsed.species_id),
        )

    png_bytes, profile_name, prep = prepare_pokemon_sheet_bytes(png_bytes)
    _apply_pokemon_metadata(pkg, fill or {}, parsed, profile_name=profile_name, prep=prep)
    report["prepare"] = prep
    report["pokemonSize"] = prep.get("pokemonSize")
    report["baseProfile"] = profile_name
    sheet_rec = _pokemon_sheet_record(sheet_id, asset_id, profile_name, label)
    pkg["spriteSheets"] = [sheet_rec]
    pkg = ensure_package_actions(pkg)
    return pkg, {asset_id: png_bytes}, report


def build_package_from_sprite(
    character_type: str,
    filename: str,
    raw_bytes: bytes,
    *,
    animation_variant: Optional[str] = None,
) -> Tuple[Dict[str, Any], Dict[str, bytes], Dict[str, Any]]:
    """Build package + assets from one sprite file. Returns (package, assets, report)."""
    ct = normalize_batch_character_type(character_type)
    stem = Path(filename).stem
    report: Dict[str, Any] = {"file": filename, "characterType": ct}

    if ct == "pokemon":
        parsed = parse_pokemon_import(stem, animation_variant)
        report["id"] = parsed.species_id
        report["form"] = parsed.form_key
        report["modifiers"] = list(parsed.modifiers)
        report["sheetSuffix"] = parsed.sheet_suffix
        report["variant"] = parsed.sheet_suffix  # legacy UI key
        pkg, assets, extra = _build_pokemon_package(parsed, stem, raw_bytes)
        report.update(extra)
        return pkg, assets, report

    pkg_id = slug_from_filename_stem(stem)
    report["id"] = pkg_id

    if ct == "object":
        base_profile = "object"
        sheet_id, asset_id, sheet_name = "sheet", "sheet_png", "Sprite"
        api_slug = pokeapi_slug_from_stem(stem)
        lookup = lookup_item(api_slug)
        if not lookup.get("found"):
            report["itemApi"] = {"found": False, "suggestion": lookup.get("suggestion")}
            pkg = empty_package(pkg_id, _display_name_from_stem(stem))
            pkg["metadata"]["characterType"] = "object"
            pkg["baseProfile"] = base_profile
        else:
            fill = lookup["data"]
            report["itemApi"] = {"found": True}
            pkg = empty_package(fill.get("id") or pkg_id, fill.get("displayName") or _display_name_from_stem(stem))
            pkg["baseProfile"] = base_profile
            _apply_item_metadata(pkg, fill)
    else:
        base_profile = "character"
        sheet_id, asset_id, sheet_name = "walk", "walk_png", "Walk"
        display = _display_name_from_stem(stem)
        pkg = empty_package(pkg_id, display)
        pkg["metadata"]["characterType"] = ct
        pkg["baseProfile"] = base_profile

    png_bytes, prep = prepare_sheet_image_bytes(raw_bytes, base_profile)
    report["prepare"] = prep

    sheet_rec: Dict[str, Any] = {
        "id": sheet_id,
        "name": sheet_name,
        "assetId": asset_id,
        "profile": base_profile,
    }
    if ct == "object":
        play_frames = prep.get("objectPlayFrames") or detect_object_play_frames(png_bytes, base_profile)
        sheet_rec["animations"] = {
            "play": {"frames": play_frames, "frameTimeMs": 120, "loop": False},
            "static": {"frames": [play_frames[0]], "frameTimeMs": 0, "loop": False},
        }
        report["playFrames"] = play_frames

    pkg["spriteSheets"] = [sheet_rec]
    pkg = ensure_package_actions(pkg)
    assets = {asset_id: png_bytes}
    return pkg, assets, report


def _persist_package(
    store: PackageStore,
    ct: str,
    package: Dict[str, Any],
    assets: Dict[str, bytes],
    *,
    import_mode: str,
    parsed: Optional[ParsedPokemonImport],
) -> Tuple[Path, bool]:
    package = store._sanitize_package_metadata(ensure_package_actions(package))
    pkg_id = package["id"]
    out_path = charbin_path_for_package(store.get_package_directory(), pkg_id, ct)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if ct != "pokemon" or parsed is None:
        if out_path.is_file():
            out_path.unlink()
        save_charbin_file(out_path, package, collect_assets_from_package(package, assets))
        return out_path, False

    mode = normalize_import_mode(import_mode)
    exists = out_path.is_file()
    merged = False
    sheet_id = parsed.sheet_id
    sheet_rec = next((s for s in package.get("spriteSheets") or [] if s.get("id") == sheet_id), None)
    if not sheet_rec:
        raise ValueError(f"missing sheet {sheet_id!r}")
    asset_id = sheet_rec.get("assetId") or f"{sheet_id}_png"
    new_bytes = {asset_id: assets[asset_id]}

    # Non-base sheets (forms, shiny, swim, combos) always merge — never replace the whole charbin.
    if not parsed.is_base_walk:
        if exists:
            merged = True
            existing, existing_assets = load_charbin_file(out_path)
            pkg_out, merged_assets = _merge_pokemon_sheet(
                existing, existing_assets, sheet_rec, sheet_id, new_bytes, parsed
            )
            pkg_out = store._sanitize_package_metadata(ensure_package_actions(pkg_out))
            save_charbin_file(out_path, pkg_out, collect_assets_from_package(pkg_out, merged_assets))
        else:
            save_charbin_file(out_path, package, collect_assets_from_package(package, assets))
        return out_path, merged

    if mode == "add" or (exists and _pokemon_has_extra_walk_sheets(load_charbin_file(out_path)[0])):
        if not exists:
            raise ValueError(
                f"pokemon {pkg_id!r} not found — import base walk first "
                f"(e.g. GARCHOMP.png with empty Animation field)"
            )
        existing, existing_assets = load_charbin_file(out_path)
        pkg_out, merged_assets = _merge_pokemon_sheet(
            existing, existing_assets, sheet_rec, sheet_id, new_bytes, parsed
        )
        pkg_out = store._sanitize_package_metadata(ensure_package_actions(pkg_out))
        save_charbin_file(out_path, pkg_out, collect_assets_from_package(pkg_out, merged_assets))
        return out_path, True

    if exists:
        out_path.unlink()
    save_charbin_file(out_path, package, collect_assets_from_package(package, assets))
    return out_path, False


def batch_import_sprites(
    store: PackageStore,
    character_type: str,
    files: List[Tuple[str, bytes]],
    *,
    animation_variant: Optional[str] = None,
    import_mode: str = "create",
) -> Dict[str, Any]:
    """Import many sprites as charbins (one type per call)."""
    ct = normalize_batch_character_type(character_type)
    mode = normalize_import_mode(import_mode)
    results: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []

    for filename, raw in files:
        if not raw:
            errors.append({"file": filename, "error": "empty file"})
            continue
        try:
            package, assets, report = build_package_from_sprite(
                ct,
                filename,
                raw,
                animation_variant=animation_variant if ct == "pokemon" else None,
            )
            parsed: Optional[ParsedPokemonImport] = None
            if ct == "pokemon":
                parsed = parse_pokemon_import(Path(filename).stem, animation_variant)
            report["importMode"] = mode if ct == "pokemon" else "create"
            out_path, merged = _persist_package(
                store,
                ct,
                package,
                assets,
                import_mode=mode,
                parsed=parsed,
            )
            report["ok"] = True
            report["path"] = str(out_path)
            report["merged"] = merged
            results.append(report)
        except Exception as exc:  # noqa: BLE001 — per-file batch errors
            errors.append({"file": filename, "error": str(exc)})

    store.scan_packages()
    return {
        "ok": len(errors) == 0,
        "characterType": ct,
        "importMode": mode,
        "animationVariant": (animation_variant or "").strip() or None,
        "imported": len(results),
        "failed": len(errors),
        "results": results,
        "errors": errors,
    }
