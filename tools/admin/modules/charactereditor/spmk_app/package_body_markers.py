"""Accessory anchor markers on Pokémon walk sheets (head / eyes / hands per facing)."""
from __future__ import annotations

import io
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from spmk_app.charbin_io import load_charbin_file, save_charbin_file
from spmk_app.character_package import preferred_pokemon_walk_sheet

MARKER_VERSION = 1

# Profile direction keys → max slots per kind
DIRECTION_LAYOUT: Dict[str, Dict[str, int]] = {
    "south": {"eyes": 2, "hands": 2},
    "west": {"eyes": 2, "hands": 1},
    "east": {"eyes": 2, "hands": 1},
    "north": {"eyes": 0, "hands": 0},
}

DIRECTION_LABELS = {
    "south": "Down (front)",
    "west": "Left",
    "east": "Right",
    "north": "Up (back)",
}


def _new_id() -> str:
    return uuid.uuid4().hex[:10]


def _clamp_rect(x: int, y: int, w: int, h: int, fw: int, fh: int) -> Dict[str, int]:
    w = max(1, min(w, fw))
    h = max(1, min(h, fh))
    x = max(0, min(x, fw - w))
    y = max(0, min(y, fh - h))
    return {"x": x, "y": y, "w": w, "h": h}


def empty_direction_markers(direction: str, fw: int, fh: int) -> Dict[str, Any]:
    return {
        "head": None,
        "eyes": [],
        "hands": [],
    }


def empty_body_markers(fw: int = 32, fh: int = 32) -> Dict[str, Any]:
    return {
        "version": MARKER_VERSION,
        "frameWidth": fw,
        "frameHeight": fh,
        "directions": {k: empty_direction_markers(k, fw, fh) for k in DIRECTION_LAYOUT},
    }


def _opaque_bbox(rgba: Image.Image) -> Optional[Tuple[int, int, int, int]]:
    w, h = rgba.size
    min_x, min_y = w, h
    max_x, max_y = -1, -1
    px = rgba.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 12:
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y
    if max_x < 0:
        return None
    return min_x, min_y, max_x, max_y


def guess_markers_for_direction(
    frame_rgba: Image.Image,
    direction: str,
    *,
    fw: int = 32,
    fh: int = 32,
) -> Dict[str, Any]:
    """Heuristic boxes from opaque pixels (pause / down frame)."""
    layout = DIRECTION_LAYOUT.get(direction, DIRECTION_LAYOUT["south"])
    out = empty_direction_markers(direction, fw, fh)
    bbox = _opaque_bbox(frame_rgba.convert("RGBA"))
    if not bbox:
        return out
    x0, y0, x1, y1 = bbox
    bw = max(1, x1 - x0 + 1)
    bh = max(1, y1 - y0 + 1)
    cx = x0 + bw // 2

    head_h = max(4, min(fh - 2, int(bh * 0.44)))
    head_w = max(6, min(fw, int(bw * 0.92)))
    head_x = max(0, cx - head_w // 2)
    head_y = max(0, y0)
    out["head"] = _clamp_rect(head_x, head_y, head_w, head_h, fw, fh)

    if layout["eyes"] > 0:
        eye_h = max(2, min(head_h - 1, int(head_h * 0.3)))
        eye_w = max(2, min(head_w // 3, int(bw * 0.16)))
        eye_y = head_y + max(1, int(head_h * 0.28))
        if direction == "south":
            gap = max(2, int(bw * 0.1))
            eyes = [
                _clamp_rect(cx - gap - eye_w, eye_y, eye_w, eye_h, fw, fh),
                _clamp_rect(cx + gap, eye_y, eye_w, eye_h, fw, fh),
            ]
        elif direction == "west":
            eyes = [
                _clamp_rect(x1 - eye_w - 1, eye_y, eye_w, eye_h, fw, fh),
                _clamp_rect(x1 - 2 * eye_w - 3, eye_y, eye_w, eye_h, fw, fh),
            ]
        elif direction == "east":
            eyes = [
                _clamp_rect(x0, eye_y, eye_w, eye_h, fw, fh),
                _clamp_rect(x0 + eye_w + 2, eye_y, eye_w, eye_h, fw, fh),
            ]
        else:
            eyes = []
        out["eyes"] = eyes[: layout["eyes"]]

    if layout["hands"] > 0:
        hand_h = max(3, int(bh * 0.22))
        hand_w = max(3, int(bw * 0.2))
        hand_y = min(fh - hand_h, y1 - hand_h + 1)
        if direction == "south":
            hands = [
                _clamp_rect(x0, hand_y, hand_w, hand_h, fw, fh),
                _clamp_rect(x1 - hand_w + 1, hand_y, hand_w, hand_h, fw, fh),
            ]
        elif direction == "west":
            hands = [_clamp_rect(x1 - hand_w, hand_y, hand_w, hand_h, fw, fh)]
        elif direction == "east":
            hands = [_clamp_rect(x0, hand_y, hand_w, hand_h, fw, fh)]
        else:
            hands = []
        out["hands"] = hands[: layout["hands"]]

    return out


def normalize_body_markers(
    raw: Any,
    *,
    fw: int = 32,
    fh: int = 32,
) -> Dict[str, Any]:
    base = empty_body_markers(fw, fh)
    if not isinstance(raw, dict):
        return base
    base["version"] = int(raw.get("version") or MARKER_VERSION)
    base["frameWidth"] = int(raw.get("frameWidth") or fw)
    base["frameHeight"] = int(raw.get("frameHeight") or fh)
    dirs = raw.get("directions") if isinstance(raw.get("directions"), dict) else {}
    for dkey in DIRECTION_LAYOUT:
        src = dirs.get(dkey) if isinstance(dirs.get(dkey), dict) else {}
        layout = DIRECTION_LAYOUT[dkey]
        head = src.get("head")
        if isinstance(head, dict) and head.get("w") and head.get("h"):
            base["directions"][dkey]["head"] = _clamp_rect(
                int(head.get("x") or 0),
                int(head.get("y") or 0),
                int(head.get("w") or 1),
                int(head.get("h") or 1),
                fw,
                fh,
            )
        for kind, limit in (("eyes", layout["eyes"]), ("hands", layout["hands"])):
            items = src.get(kind) if isinstance(src.get(kind), list) else []
            cleaned = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                if not item.get("w") or not item.get("h"):
                    continue
                cleaned.append(
                    _clamp_rect(
                        int(item.get("x") or 0),
                        int(item.get("y") or 0),
                        int(item.get("w") or 1),
                        int(item.get("h") or 1),
                        fw,
                        fh,
                    )
                )
                if len(cleaned) >= limit:
                    break
            base["directions"][dkey][kind] = cleaned
    return base


def load_body_markers_from_package(pkg: Dict[str, Any]) -> Dict[str, Any]:
    meta = pkg.get("metadata") or {}
    custom = meta.get("custom") if isinstance(meta.get("custom"), dict) else {}
    raw = custom.get("bodyMarkers")
    fw = fh = 32
    prof_name = pkg.get("baseProfile") or "pokemon_small"
    from spmk_app.character_package import load_sprite_profiles

    prof = load_sprite_profiles().get("profiles", {}).get(prof_name, {})
    fw = int(prof.get("frameWidth") or 32)
    fh = int(prof.get("frameHeight") or 32)
    return normalize_body_markers(raw, fw=fw, fh=fh)


def walk_frame_png(
    pkg: Dict[str, Any],
    assets: Dict[str, bytes],
    direction: str,
    *,
    col: int = 0,
) -> Tuple[bytes, int, int, str]:
    """South/west/east/north row, column ``col`` (0 = pause pose)."""
    from spmk_app.character_package import load_sprite_profiles

    sheet = preferred_pokemon_walk_sheet(pkg)
    if not sheet:
        raise ValueError("no walk sheet in package")
    aid = sheet.get("assetId")
    if not aid or aid not in assets:
        raise ValueError("walk sheet asset missing")
    profile = sheet.get("profile") or pkg.get("baseProfile") or "pokemon_small"
    prof = load_sprite_profiles().get("profiles", {}).get(profile, {})
    fw = int(prof.get("frameWidth") or 32)
    fh = int(prof.get("frameHeight") or 32)
    row = int((prof.get("directions") or {}).get(direction, {}).get("row", 0))
    img = Image.open(io.BytesIO(assets[aid])).convert("RGBA")
    x, y = col * fw, row * fh
    if x + fw > img.width or y + fh > img.height:
        raise ValueError("sheet too small for direction frame")
    frame = img.crop((x, y, x + fw, y + fh))
    buf = io.BytesIO()
    frame.save(buf, format="PNG")
    return buf.getvalue(), fw, fh, profile


def load_body_markers_context(path: Path, direction: str) -> Dict[str, Any]:
    pkg, assets = load_charbin_file(path)
    meta = pkg.get("metadata") or {}
    if meta.get("characterType") != "pokemon":
        raise ValueError("body markers are for pokemon charbins only")
    png, fw, fh, profile = walk_frame_png(pkg, assets, direction)
    markers = load_body_markers_from_package(pkg)
    dir_m = markers["directions"].get(direction) or {}
    suggested = None
    if not dir_m.get("head"):
        suggested = guess_markers_for_direction(
            Image.open(io.BytesIO(png)).convert("RGBA"), direction, fw=fw, fh=fh
        )
    return {
        "frameWidth": fw,
        "frameHeight": fh,
        "profile": profile,
        "direction": direction,
        "markers": markers,
        "suggested": suggested,
        "walkSheetId": (preferred_pokemon_walk_sheet(pkg) or {}).get("id"),
        "layout": DIRECTION_LAYOUT.get(direction, DIRECTION_LAYOUT["south"]),
    }


def save_body_markers_to_path(path: Path, markers: Dict[str, Any]) -> Dict[str, Any]:
    pkg, assets = load_charbin_file(path)
    meta = pkg.get("metadata") or {}
    if meta.get("characterType") != "pokemon":
        raise ValueError("body markers are for pokemon charbins only")
    custom = dict(meta.get("custom") or {}) if isinstance(meta.get("custom"), dict) else {}
    fw = int(markers.get("frameWidth") or 32)
    fh = int(markers.get("frameHeight") or 32)
    custom["bodyMarkers"] = normalize_body_markers(markers, fw=fw, fh=fh)
    pkg = {**pkg, "metadata": {**meta, "custom": custom}}
    save_charbin_file(path, pkg, assets)
    return {"path": str(path.resolve()), "bodyMarkers": custom["bodyMarkers"]}
