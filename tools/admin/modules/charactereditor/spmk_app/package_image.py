"""Normalize package sprite uploads (PNG/WebP, optional 64px→32px sheet halving)."""
from __future__ import annotations

import io
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from spmk_app.character_package import load_sprite_profiles

# Cell alpha above this → counts as a frame (object sheets skip empty tiles).
_CELL_ALPHA_THRESHOLD = 12
_OBJECT_MAX_FRAMES = 10

_OVERSIZED_CELL_FACTOR = 1.85
_MAX_HALVE_PASSES = 4

_POKEMON_GRID_COLS = 4
_POKEMON_GRID_ROWS = 4

# 2× upload edges (halve once before embed): 512→256, 320→160, 256→128.
_POKEMON_UPLOAD_LARGE_MIN = 480  # 512×512
_POKEMON_UPLOAD_MEDIUM_MIN = 304  # 320×320
_POKEMON_UPLOAD_SMALL_MIN = 200  # 256×256

# Final embedded edges after halving.
_POKEMON_FINAL_LARGE_MIN = 224  # 256×256 @ 64px cells
_POKEMON_FINAL_MEDIUM_MIN = 144  # 160×160 @ 40px cells


def _resize_nearest(img: Image.Image, factor: int) -> Image.Image:
    factor = max(1, int(factor))
    w = max(1, img.width // factor)
    h = max(1, img.height // factor)
    return img.resize((w, h), Image.Resampling.NEAREST)


def load_image_from_bytes(raw: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(raw))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    return img


def _cell_has_content(cell: Image.Image) -> bool:
    if cell.mode != "RGBA":
        cell = cell.convert("RGBA")
    alpha = cell.getchannel("A")
    return alpha.getextrema()[1] > _CELL_ALPHA_THRESHOLD


def detect_object_play_frames(
    raw: bytes,
    profile_name: str = "object",
    *,
    max_frames: int = _OBJECT_MAX_FRAMES,
) -> List[int]:
    """Row-major 4×4 grid, top-left → right → down; skip empty cells; cap at max_frames."""
    prof = load_sprite_profiles().get("profiles", {}).get(profile_name, {})
    cols = int(prof.get("columns") or 4)
    rows = int(prof.get("rows") or 4)
    fw = int(prof.get("frameWidth") or 32)
    fh = int(prof.get("frameHeight") or 32)
    img = load_image_from_bytes(raw)
    frames: List[int] = []
    for row in range(rows):
        for col in range(cols):
            if len(frames) >= max_frames:
                return frames
            x0, y0 = col * fw, row * fh
            if x0 + fw > img.width or y0 + fh > img.height:
                continue
            cell = img.crop((x0, y0, x0 + fw, y0 + fh))
            if _cell_has_content(cell):
                frames.append(row * cols + col)
    return frames if frames else [0]


def _sheet_cell_size(ow: int, oh: int, cols: int, rows: int) -> Tuple[float, float]:
    cols = max(1, int(cols))
    rows = max(1, int(rows))
    return ow / cols, oh / rows


def _sheet_needs_halving(ow: int, oh: int, cols: int, rows: int, fw: int, fh: int) -> bool:
    expected_w = cols * fw
    expected_h = rows * fh
    cw, ch = _sheet_cell_size(ow, oh, cols, rows)
    if cw >= fw * _OVERSIZED_CELL_FACTOR and ch >= fh * _OVERSIZED_CELL_FACTOR:
        return True
    if expected_w > 0 and expected_h > 0:
        if ow >= expected_w * _OVERSIZED_CELL_FACTOR and oh >= expected_h * _OVERSIZED_CELL_FACTOR:
            return True
    return False


def _layout_pokemon_small() -> Dict[str, Any]:
    return {
        "profile": "pokemon_small",
        "pokemonSize": "small",
        "cellWidth": 32,
        "cellHeight": 32,
        "profileOverrides": None,
    }


def _layout_pokemon_human() -> Dict[str, Any]:
    """Human-scale overworld Pokémon (32px cells, trainer-style profile)."""
    return {
        "profile": "character",
        "pokemonSize": "human",
        "cellWidth": 32,
        "cellHeight": 32,
        "profileOverrides": None,
    }


def _layout_pokemon_medium() -> Dict[str, Any]:
    return {
        "profile": "pokemon_small",
        "pokemonSize": "medium",
        "cellWidth": 40,
        "cellHeight": 40,
        "profileOverrides": {"frameWidth": 40, "frameHeight": 40},
    }


def _layout_pokemon_large() -> Dict[str, Any]:
    return {
        "profile": "pokemon_large",
        "pokemonSize": "large",
        "cellWidth": 64,
        "cellHeight": 64,
        "profileOverrides": None,
    }


POKEMON_SIZE_VALUES = ("small", "human", "medium", "large")


def layout_for_pokemon_size(size: str) -> Dict[str, Any]:
    """Map ``metadata.pokemonSize`` to profile + cell layout."""
    key = (size or "small").strip().lower()
    if key == "large":
        return _layout_pokemon_large()
    if key == "medium":
        return _layout_pokemon_medium()
    if key == "human":
        return _layout_pokemon_human()
    return _layout_pokemon_small()


def _layout_for_cell(cell_width: int) -> Dict[str, Any]:
    if cell_width >= 60:
        return _layout_pokemon_large()
    if cell_width >= 36:
        return _layout_pokemon_medium()
    return _layout_pokemon_small()


def infer_pokemon_sheet_layout(
    width: int,
    height: int,
    *,
    cols: int = _POKEMON_GRID_COLS,
    rows: int = _POKEMON_GRID_ROWS,
) -> Dict[str, Any]:
    """
    Infer profile + cell size from **final** embedded PNG dimensions (after 2× halving).

    Finals: 128×128 (32px), 160×160 (40px), 256×256 (64px).
    """
    longest = max(int(width), int(height))
    if longest >= _POKEMON_FINAL_LARGE_MIN:
        return _layout_pokemon_large()
    if longest >= _POKEMON_FINAL_MEDIUM_MIN:
        return _layout_pokemon_medium()
    return _layout_pokemon_small()


def _halve_pokemon_2x_upload(img: Image.Image) -> Tuple[Image.Image, int]:
    """Halve once when upload is a 2× sheet (512 / 320 / 256). Returns (image, passes)."""
    longest = max(img.width, img.height)
    if longest >= _POKEMON_UPLOAD_LARGE_MIN:
        return _resize_nearest(img, 2), 1
    if longest >= _POKEMON_UPLOAD_MEDIUM_MIN:
        return _resize_nearest(img, 2), 1
    if longest >= _POKEMON_UPLOAD_SMALL_MIN:
        return _resize_nearest(img, 2), 1
    return img, 0


def detect_pokemon_sheet_profile(raw: bytes) -> str:
    """Profile for embedded Pokémon walk sheet (runs full prepare path)."""
    _, profile, _ = prepare_pokemon_sheet_bytes(raw)
    return profile


def _effective_cell_from_sheet(
    sheet: Dict[str, Any], package: Optional[Dict[str, Any]]
) -> int:
    prof_name = sheet.get("profile") or (package or {}).get("baseProfile") or "pokemon_small"
    prof = load_sprite_profiles().get("profiles", {}).get(prof_name, {})
    overrides = sheet.get("profileOverrides") or {}
    return int(overrides.get("frameWidth") or prof.get("frameWidth") or 32)


def prepare_pokemon_sheet_bytes(
    raw: bytes,
    *,
    sheet: Optional[Dict[str, Any]] = None,
    package: Optional[Dict[str, Any]] = None,
) -> Tuple[bytes, str, Dict[str, Any]]:
    """
    Halve 2× Pokémon walk uploads, then tag profile/cell size on the embedded sheet.

    Uploads: 512→256 (large), 320→160 (medium), 256→128 (small).
    Already-embedded finals (128 / 160 / 256 large) are left unchanged on re-save.
    """
    img = load_image_from_bytes(raw)
    ow, oh = img.size
    cols = _POKEMON_GRID_COLS
    rows = _POKEMON_GRID_ROWS
    scaled = False
    passes = 0

    if sheet is not None and package is not None:
        fw = _effective_cell_from_sheet(sheet, package)
        grid = cols * fw
        if img.width == grid and img.height == grid:
            layout = _layout_for_cell(fw)
            profile_name = layout["profile"]
            fh = int(layout["cellHeight"])
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            meta: Dict[str, Any] = {
                "scaled": False,
                "halvePasses": 0,
                "originalSize": [ow, oh],
                "finalSize": [img.width, img.height],
                "profile": profile_name,
                "pokemonSize": layout["pokemonSize"],
                "frameSize": [fw, fh],
                "expectedGridSize": [grid, rows * fh],
            }
            overrides = layout.get("profileOverrides")
            if overrides:
                meta["profileOverrides"] = overrides
            return buf.getvalue(), profile_name, meta

    img, passes = _halve_pokemon_2x_upload(img)
    scaled = passes > 0

    layout = infer_pokemon_sheet_layout(img.width, img.height)
    profile_name = layout["profile"]
    fw = int(layout["cellWidth"])
    fh = int(layout["cellHeight"])

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    meta = {
        "scaled": scaled,
        "halvePasses": passes,
        "originalSize": [ow, oh],
        "finalSize": [img.width, img.height],
        "profile": profile_name,
        "pokemonSize": layout["pokemonSize"],
        "frameSize": [fw, fh],
        "expectedGridSize": [cols * fw, rows * fh],
    }
    overrides = layout.get("profileOverrides")
    if overrides:
        meta["profileOverrides"] = overrides
    return buf.getvalue(), profile_name, meta


def prepare_sheet_image_bytes(raw: bytes, profile_name: str = "character") -> Tuple[bytes, Dict[str, Any]]:
    """Decode upload; halve while cells are ~2× profile frame size (e.g. 64→32 on 4×4)."""
    prof = load_sprite_profiles().get("profiles", {}).get(profile_name, {})
    cols = int(prof.get("columns") or 4)
    rows = int(prof.get("rows") or 4)
    fw = int(prof.get("frameWidth") or 32)
    fh = int(prof.get("frameHeight") or 32)
    expected_w = cols * fw
    expected_h = rows * fh

    img = load_image_from_bytes(raw)
    ow, oh = img.size
    scaled = False
    passes = 0

    while passes < _MAX_HALVE_PASSES and _sheet_needs_halving(img.width, img.height, cols, rows, fw, fh):
        img = _resize_nearest(img, 2)
        scaled = True
        passes += 1

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    out_bytes = buf.getvalue()
    meta: Dict[str, Any] = {
        "scaled": scaled,
        "halvePasses": passes,
        "originalSize": [ow, oh],
        "finalSize": [img.width, img.height],
        "profile": profile_name,
        "expectedGridSize": [expected_w, expected_h],
    }
    if profile_name == "object":
        play_frames = detect_object_play_frames(out_bytes, profile_name)
        meta["objectPlayFrames"] = play_frames
    return out_bytes, meta


def apply_pokemon_prep_to_sheet_record(sheet: Dict[str, Any], prep: Dict[str, Any]) -> None:
    """Attach profile + per-sheet overrides from ``prepare_pokemon_sheet_bytes`` meta."""
    if prep.get("profile"):
        sheet["profile"] = prep["profile"]
    overrides = prep.get("profileOverrides")
    if overrides:
        sheet["profileOverrides"] = dict(overrides)
    elif prep.get("pokemonSize") == "small":
        sheet.pop("profileOverrides", None)


def normalize_package_sheet_assets(
    package: Dict[str, Any],
    assets: Dict[str, bytes],
) -> Dict[str, bytes]:
    """Re-run sheet normalization before embed/save (safety net if upload skipped scaling)."""
    out = dict(assets)
    base = package.get("baseProfile") or "character"
    for sheet in package.get("spriteSheets") or []:
        aid = sheet.get("assetId")
        if not aid or aid not in out:
            continue
        prof = sheet.get("profile") or base
        if prof in ("pokemon_small", "pokemon_large"):
            png, prof, prep = prepare_pokemon_sheet_bytes(
                out[aid], sheet=sheet, package=package
            )
            sheet["profile"] = prof
            apply_pokemon_prep_to_sheet_record(sheet, prep)
        else:
            png, prep = prepare_sheet_image_bytes(out[aid], prof)
        out[aid] = png
        if prof == "object" and prep.get("objectPlayFrames"):
            anims = dict(sheet.get("animations") or {})
            anims["play"] = {
                "frames": prep["objectPlayFrames"],
                "frameTimeMs": 120,
                "loop": False,
            }
            sheet["animations"] = anims
    return out
