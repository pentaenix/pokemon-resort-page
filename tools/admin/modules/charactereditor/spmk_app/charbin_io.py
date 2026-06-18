"""Read/write SPMK .charbin static character packages.

Binary layout and JSON fields: docs/CHARBIN_SCHEMA.md
"""
from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any, Dict, List, Tuple

MAGIC = b"SPMKCHAR"
FORMAT_VERSION = 1


class CharbinError(ValueError):
    pass


def _pack_str(s: str) -> bytes:
    raw = s.encode("utf-8")
    return struct.pack("<I", len(raw)) + raw


def _unpack_str(data: bytes, offset: int) -> Tuple[str, int]:
    if offset + 4 > len(data):
        raise CharbinError("truncated string length")
    (n,) = struct.unpack_from("<I", data, offset)
    offset += 4
    end = offset + n
    if end > len(data):
        raise CharbinError("truncated string payload")
    return data[offset:end].decode("utf-8"), end


def write_charbin(package: Dict[str, Any], assets: Dict[str, bytes]) -> bytes:
    """Serialize package JSON + embedded PNG (or other) blobs."""
    payload = json.dumps(package, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    parts = [MAGIC, struct.pack("<II", FORMAT_VERSION, len(payload)), payload]
    table_ids = sorted(assets.keys())
    parts.append(struct.pack("<I", len(table_ids)))
    for asset_id in table_ids:
        blob = assets[asset_id]
        mime = "image/png"
        parts.append(_pack_str(asset_id))
        parts.append(_pack_str(mime))
        parts.append(struct.pack("<I", len(blob)))
        parts.append(blob)
    return b"".join(parts)


def read_charbin(data: bytes) -> Tuple[Dict[str, Any], Dict[str, bytes]]:
    if len(data) < 16:
        raise CharbinError("file too small")
    if data[:8] != MAGIC:
        raise CharbinError(f"bad magic (expected {MAGIC!r})")
    fmt_ver, json_len = struct.unpack_from("<II", data, 8)
    if fmt_ver != FORMAT_VERSION:
        raise CharbinError(f"unsupported formatVersion {fmt_ver}")
    offset = 16
    end = offset + json_len
    if end > len(data):
        raise CharbinError("truncated json payload")
    package = json.loads(data[offset:end].decode("utf-8"))
    offset = end
    if offset + 4 > len(data):
        raise CharbinError("truncated asset count")
    (asset_count,) = struct.unpack_from("<I", data, offset)
    offset += 4
    assets: Dict[str, bytes] = {}
    for _ in range(asset_count):
        asset_id, offset = _unpack_str(data, offset)
        _mime, offset = _unpack_str(data, offset)
        if offset + 4 > len(data):
            raise CharbinError("truncated asset length")
        (blob_len,) = struct.unpack_from("<I", data, offset)
        offset += 4
        end_blob = offset + blob_len
        if end_blob > len(data):
            raise CharbinError(f"truncated asset {asset_id!r}")
        assets[asset_id] = data[offset:end_blob]
        offset = end_blob
    if offset != len(data):
        raise CharbinError(f"trailing bytes ({len(data) - offset})")
    return package, assets


def read_charbin_package_only(data: bytes) -> Dict[str, Any]:
    """Parse package JSON without loading embedded asset blobs."""
    if len(data) < 16:
        raise CharbinError("file too small")
    if data[:8] != MAGIC:
        raise CharbinError(f"bad magic (expected {MAGIC!r})")
    fmt_ver, json_len = struct.unpack_from("<II", data, 8)
    if fmt_ver != FORMAT_VERSION:
        raise CharbinError(f"unsupported formatVersion {fmt_ver}")
    offset = 16
    end = offset + json_len
    if end > len(data):
        raise CharbinError("truncated json payload")
    return json.loads(data[offset:end].decode("utf-8"))


def load_charbin_package_only(path: Path) -> Dict[str, Any]:
    """Read only the JSON package from disk (skips embedded PNG blobs)."""
    with path.open("rb") as f:
        header = f.read(16)
        if len(header) < 16:
            raise CharbinError("file too small")
        if header[:8] != MAGIC:
            raise CharbinError(f"bad magic (expected {MAGIC!r})")
        fmt_ver, json_len = struct.unpack_from("<II", header, 8)
        if fmt_ver != FORMAT_VERSION:
            raise CharbinError(f"unsupported formatVersion {fmt_ver}")
        payload = f.read(json_len)
        if len(payload) != json_len:
            raise CharbinError("truncated json payload")
    return json.loads(payload.decode("utf-8"))


def load_charbin_file(path: Path) -> Tuple[Dict[str, Any], Dict[str, bytes]]:
    return read_charbin(path.read_bytes())


def save_charbin_file(path: Path, package: Dict[str, Any], assets: Dict[str, bytes]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(write_charbin(package, assets))
