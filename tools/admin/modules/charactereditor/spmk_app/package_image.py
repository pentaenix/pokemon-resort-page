"""Normalize package sprite uploads (PNG/WebP, optional 64px→32px sheet halving)."""
from __future__ import annotations

import io
from typing import Any, Dict, List, Tuple

from PIL import Image

from spmk_app.character_package import load_sprite_profiles

# Cell alpha above this → counts as a frame (object sheets skip empty tiles).
_CELL_ALPHA_THRESHOLD = 12
_OBJECT_MAX_FRAMES = 10

_OVERSIZED_CELL_FACTOR = 1.85
_MAX_HALVE_PASSES = 4


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


_LARGE_POKEMON_CELL_MIN = 96.0  # 512÷4 → 128px cells before halving
_TARGET_LARGE_CELL = 64
_TARGET_SMALL_CELL = 32


def detect_pokemon_sheet_profile(raw: bytes) -> str:
    """``pokemon_large`` when upload cells are ~128px (512 sheet); else ``pokemon_small``."""
    img = load_image_from_bytes(raw)
    cols, rows = 4, 4
    cw = img.width / cols
    ch = img.height / rows
    cell = max(cw, ch)
    return "pokemon_large" if cell >= _LARGE_POKEMON_CELL_MIN else "pokemon_small"


def prepare_pokemon_sheet_bytes(raw: bytes) -> Tuple[bytes, str, Dict[str, Any]]:
    """
    Scale Pokémon walk sheets: small 128→64 (32px cells), large 512→256 (64px cells).
    """
    profile_name = detect_pokemon_sheet_profile(raw)
    prof = load_sprite_profiles().get("profiles", {}).get(profile_name, {})
    cols = int(prof.get("columns") or 4)
    rows = int(prof.get("rows") or 4)
    fw = int(prof.get("frameWidth") or 32)
    fh = int(prof.get("frameHeight") or 32)

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
    meta: Dict[str, Any] = {
        "scaled": scaled,
        "halvePasses": passes,
        "originalSize": [ow, oh],
        "finalSize": [img.width, img.height],
        "profile": profile_name,
        "pokemonSize": "large" if profile_name == "pokemon_large" else "small",
        "frameSize": [fw, fh],
        "expectedGridSize": [cols * fw, rows * fh],
    }
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
            png, prof, prep = prepare_pokemon_sheet_bytes(out[aid])
            sheet["profile"] = prof
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
