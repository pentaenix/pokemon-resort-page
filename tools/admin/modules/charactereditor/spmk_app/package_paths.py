"""Resolve the on-disk folder that holds .charbin character packages only."""
from __future__ import annotations

import os
import shutil
from pathlib import Path

CHARACTERS_DIR_NAME = "characters"
ASSETS_CHARACTERS = Path("assets") / CHARACTERS_DIR_NAME
ENV_CHARACTERS_DIR = "SPMK_CHARACTERS_DIR"
SCHEMA_FILENAME = "CHARBIN_SCHEMA.md"
LEGACY_CHARACTERS_REL = Path("characters")
LIBRARY_FOLDERS = ("playable", "npc", "pokemon", "objects")


def game_repo_root(spmk_root: Path) -> Path | None:
    """``pokemon-resort`` in the monorepo (sibling of spmk or nested under admin modules)."""
    here = spmk_root.resolve()
    for ancestor in [here, *here.parents]:
        candidate = (ancestor / "pokemon-resort").resolve()
        if (candidate / "assets").is_dir():
            return candidate
        workspace = (ancestor / "title_screen_demo" / "pokemon-resort").resolve()
        if (workspace / "assets").is_dir():
            return workspace
    return None


def default_characters_dir(spmk_root: Path) -> Path:
    """Game library: ``pokemon-resort/assets/characters`` when available, else ``spmk/assets/characters``."""
    game = game_repo_root(spmk_root)
    if game:
        return (game / ASSETS_CHARACTERS).resolve()
    return (spmk_root / ASSETS_CHARACTERS).resolve()


def legacy_characters_dir(spmk_root: Path) -> Path:
    return (spmk_root / LEGACY_CHARACTERS_REL).resolve()


def schema_source_path(spmk_root: Path) -> Path:
    return (spmk_root / "docs" / SCHEMA_FILENAME).resolve()


def sync_charbin_schema_doc(characters_dir: Path, spmk_root: Path) -> Path:
    """Copy canonical schema into the library folder for C++ / tooling."""
    src = schema_source_path(spmk_root)
    if not src.is_file():
        raise FileNotFoundError(f"schema source missing: {src}")
    ensure_library_subdirs(characters_dir)
    dest = characters_dir / SCHEMA_FILENAME
    banner = (
        "<!-- Canonical source: spmk/docs/CHARBIN_SCHEMA.md — synced by SPMK. Do not edit here. -->\n\n"
    )
    body = src.read_text(encoding="utf-8")
    if body.startswith("<!-- Canonical source:"):
        out = body
    else:
        out = banner + body
    dest.write_text(out, encoding="utf-8")
    return dest


def normalize_library_folder(character_type: str) -> str:
    """Map package ``characterType`` to library subfolder name."""
    ct = (character_type or "npc").strip().lower()
    if ct in ("player", "playable"):
        return "playable"
    if ct == "pokemon":
        return "pokemon"
    if ct == "object":
        return "objects"
    return "npc"


def safe_charbin_stem(char_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in str(char_id).strip()) or "character"


def ensure_library_subdirs(base: Path) -> None:
    base.mkdir(parents=True, exist_ok=True)
    for name in LIBRARY_FOLDERS:
        (base / name).mkdir(parents=True, exist_ok=True)


def charbin_path_for_package(base: Path, char_id: str, character_type: str) -> Path:
    """``{base}/{playable|npc|pokemon|objects}/{id}.charbin``."""
    folder = normalize_library_folder(character_type)
    sub = base / folder
    sub.mkdir(parents=True, exist_ok=True)
    return sub / f"{safe_charbin_stem(char_id)}.charbin"


def find_charbin_by_id(base: Path, char_id: str) -> Path | None:
    """Locate a package by id under library subfolders (or legacy flat layout)."""
    stem = safe_charbin_stem(char_id)
    for folder in LIBRARY_FOLDERS:
        p = base / folder / f"{stem}.charbin"
        if p.is_file():
            return p
    flat = base / f"{stem}.charbin"
    if flat.is_file():
        return flat
    return None


def migrate_flat_charbins_to_subdirs(base: Path) -> list[str]:
    """Move root-level ``*.charbin`` files into playable / npc / pokemon subfolders."""
    from spmk_app.charbin_io import load_charbin_file

    ensure_library_subdirs(base)
    moved: list[str] = []
    for src in sorted(base.glob("*.charbin")):
        try:
            pkg, _ = load_charbin_file(src)
            meta = pkg.get("metadata") or {}
            ct = meta.get("characterType") or "npc"
            dest = charbin_path_for_package(base, pkg.get("id") or src.stem, ct)
        except Exception:
            dest = charbin_path_for_package(base, src.stem, "npc")
        if dest.resolve() == src.resolve():
            continue
        if dest.exists():
            src.unlink()
            moved.append(src.name)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest))
        moved.append(src.name)
    return moved


def migrate_legacy_charbins(spmk_root: Path, target_dir: Path) -> list[str]:
    """Move ``spmk/characters/*.charbin`` into the new library folder once."""
    legacy = legacy_characters_dir(spmk_root)
    if not legacy.is_dir() or legacy.resolve() == target_dir.resolve():
        return []
    moved: list[str] = []
    target_dir.mkdir(parents=True, exist_ok=True)
    for src in sorted(legacy.glob("*.charbin")):
        dest = target_dir / src.name
        if dest.exists():
            continue
        shutil.move(str(src), str(dest))
        moved.append(src.name)
    return moved


def resolve_characters_dir(spmk_root: Path, configured: str | None = None) -> Path:
    """Pick directory: env override > saved setting > default."""
    env = os.environ.get(ENV_CHARACTERS_DIR, "").strip()
    if env:
        return Path(env).expanduser().resolve()
    if configured and str(configured).strip():
        return Path(configured).expanduser().resolve()
    return default_characters_dir(spmk_root)


def ensure_characters_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def charbin_path_for_id(directory: Path, char_id: str, character_type: str = "npc") -> Path:
    """Preferred: use ``charbin_path_for_package`` with an explicit type."""
    return charbin_path_for_package(directory, char_id, character_type)
