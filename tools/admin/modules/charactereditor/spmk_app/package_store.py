"""Local filesystem state for character package authoring."""
from __future__ import annotations

import io
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from PIL import Image

from spmk_app.charbin_io import load_charbin_file, load_charbin_package_only, read_charbin, save_charbin_file
from spmk_app.character_package import (
    collect_assets_from_package,
    deep_merge_preserve_unknown,
    empty_package,
    export_debug_loose,
    is_pokemon_walk_sheet_id,
    library_all_sheets_meta,
    library_walk_meta,
    load_sprite_profiles,
    preferred_pokemon_walk_sheet,
    validate_package,
)
from spmk_app.package_paths import (
    charbin_path_for_package,
    default_characters_dir,
    ensure_characters_dir,
    ensure_library_subdirs,
    find_charbin_by_id,
    migrate_flat_charbins_to_subdirs,
    migrate_legacy_charbins,
    resolve_characters_dir,
    sync_charbin_schema_doc,
)
from spmk_app.pokeapi_client import sanitize_pokeapi_snapshot

_SETTINGS_NAME = "package_manager.json"
_DRAFT_NAME = "package_draft.json"
_ASSETS_NAME = "package_draft_assets"


class PackageStore:
    """Manages .charbin files in the configured characters directory.

    Sprite sheet PNGs are embedded inside charbins only. Workspace ``assets/``
    (generated sprites, legacy project sheets) is separate and untouched.
    """

    def __init__(self, spmk_root: Path, workspace: Path, exports: Path) -> None:
        self.spmk_root = spmk_root.resolve()
        self.workspace = workspace
        self.exports = exports
        self.settings_path = workspace / _SETTINGS_NAME
        self.draft_path = workspace / _DRAFT_NAME
        self.draft_assets_dir = workspace / _ASSETS_NAME

    def load_settings(self) -> Dict[str, Any]:
        if not self.settings_path.exists():
            return self._fresh_settings()
        return json.loads(self.settings_path.read_text(encoding="utf-8"))

    def _fresh_settings(self) -> Dict[str, Any]:
        return {
            "packageDirectory": str(default_characters_dir(self.spmk_root)),
            "scannedPackages": [],
            "defaultDirectory": str(default_characters_dir(self.spmk_root)),
        }

    def save_settings(self, data: Dict[str, Any]) -> Dict[str, Any]:
        self.settings_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return data

    def get_package_directory(self) -> Path:
        s = self.load_settings()
        path = resolve_characters_dir(self.spmk_root, s.get("packageDirectory"))
        return ensure_characters_dir(path)

    def set_package_directory(self, path: str) -> Dict[str, Any]:
        s = self.load_settings()
        resolved = self._prepare_library_dir(Path(path).expanduser())
        s["packageDirectory"] = str(resolved)
        s["defaultDirectory"] = str(default_characters_dir(self.spmk_root))
        self.save_settings(s)
        self.scan_packages()
        return self.load_settings()

    def _prepare_library_dir(self, directory: Path) -> Path:
        directory = ensure_characters_dir(directory)
        ensure_library_subdirs(directory)
        migrate_legacy_charbins(self.spmk_root, directory)
        migrate_flat_charbins_to_subdirs(directory)
        try:
            sync_charbin_schema_doc(directory, self.spmk_root)
        except FileNotFoundError:
            pass
        return directory

    def _sanitize_package_metadata(self, package: Dict[str, Any]) -> Dict[str, Any]:
        meta = package.get("metadata")
        if not isinstance(meta, dict):
            return package
        pa = meta.get("pokeapi")
        if pa is not None:
            meta = {**meta, "pokeapi": sanitize_pokeapi_snapshot(pa)}
            package = {**package, "metadata": meta}
        return package

    def _collect_charbin_paths(self, base: Path) -> List[Path]:
        from spmk_app.package_paths import LIBRARY_FOLDERS

        paths: List[Path] = []
        for folder in LIBRARY_FOLDERS:
            paths.extend(sorted((base / folder).glob("*.charbin")))
        paths.extend(sorted(base.glob("*.charbin")))
        seen: set[str] = set()
        out: List[Path] = []
        for p in paths:
            key = str(p.resolve())
            if key in seen:
                continue
            seen.add(key)
            out.append(p)
        return out

    @staticmethod
    def _library_fingerprint(paths: List[Path]) -> str:
        parts = []
        for p in paths:
            st = p.stat()
            parts.append(f"{p.resolve()}:{st.st_mtime_ns}:{st.st_size}")
        return str(hash(tuple(sorted(parts))))

    def ensure_ready(self, *, force_scan: bool = False) -> Dict[str, Any]:
        """Ensure library dir exists; migrate legacy folder; sync schema doc."""
        s = self.load_settings()
        default = default_characters_dir(self.spmk_root)
        configured = resolve_characters_dir(self.spmk_root, s.get("packageDirectory"))
        legacy = (self.spmk_root / "characters").resolve()
        if not configured.is_dir() or configured.resolve() == legacy:
            configured = default
        directory = self._prepare_library_dir(configured)
        s["packageDirectory"] = str(directory)
        s["defaultDirectory"] = str(default)
        self.save_settings(s)
        paths = self._collect_charbin_paths(directory)
        fp = self._library_fingerprint(paths)
        if (
            not force_scan
            and s.get("libraryFingerprint") == fp
            and s.get("scannedPackages")
        ):
            return s
        self.scan_packages()
        return self.load_settings()

    def delete_charbin(self, path: str) -> None:
        p = self.resolve_charbin_path(path)
        p.unlink()
        if self.draft_path.exists():
            try:
                body = json.loads(self.draft_path.read_text(encoding="utf-8"))
                if (body.get("meta") or {}).get("sourcePath") == str(p):
                    self.clear_draft()
            except json.JSONDecodeError:
                pass
        self.scan_packages()

    def resolve_charbin_path(self, path: str) -> Path:
        base = self.get_package_directory().resolve()
        raw = Path(path).expanduser()
        p = (base / raw).resolve() if not raw.is_absolute() else raw.resolve()
        try:
            p.relative_to(base)
        except ValueError as exc:
            raise ValueError("path outside package directory") from exc
        if not p.is_file():
            raise FileNotFoundError(path)
        return p

    def charbin_path_for_package_id(self, package_id: str) -> Path:
        base = self.get_package_directory()
        found = find_charbin_by_id(base, package_id)
        if found:
            return found
        return charbin_path_for_package(base, package_id, "npc")

    @staticmethod
    def _crop_base_down_frame(img: Image.Image, prof: Dict[str, Any]) -> Image.Image:
        """South / base_down cell (profile row south, column 0)."""
        fw = int(prof.get("frameWidth") or 32)
        fh = int(prof.get("frameHeight") or 32)
        row = int((prof.get("directions") or {}).get("south", {}).get("row", 0))
        col = 0
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
        x, y = col * fw, row * fh
        if x + fw <= img.width and y + fh <= img.height:
            return img.crop((x, y, x + fw, y + fh))
        w = min(fw, max(0, img.width - x))
        h = min(fh, max(0, img.height - y))
        if w > 0 and h > 0:
            frame = img.crop((x, y, x + w, y + h))
            if frame.size != (fw, fh):
                frame = frame.resize((fw, fh), Image.Resampling.NEAREST)
            return frame
        return img.resize((fw, fh), Image.Resampling.NEAREST)

    def get_package_thumbnail_png(self, path: str) -> Optional[bytes]:
        """Crop base_down (south, column 0) from the first sheet with an embedded asset."""
        p = self.resolve_charbin_path(path)
        pkg, assets = load_charbin_file(p)
        return self._thumbnail_from_package(pkg, assets)

    def get_thumbnail_png_by_id(self, package_id: str) -> Optional[bytes]:
        p = self.charbin_path_for_package_id(package_id)
        if not p.is_file():
            raise FileNotFoundError(package_id)
        pkg, assets = load_charbin_file(p)
        return self._thumbnail_from_package(pkg, assets)

    def _thumbnail_from_package(
        self, pkg: Dict[str, Any], assets: Dict[str, bytes]
    ) -> Optional[bytes]:
        meta = pkg.get("metadata") or {}
        sheets = pkg.get("spriteSheets") or []
        if meta.get("characterType") == "pokemon":
            preferred = preferred_pokemon_walk_sheet(pkg)
            if preferred:
                sheets = [preferred]
            else:
                sheets = [
                    s
                    for s in sheets
                    if is_pokemon_walk_sheet_id(s.get("id") or "")
                ] or sheets
        for sheet in sheets:
            aid = sheet.get("assetId")
            if not aid or aid not in assets:
                continue
            prof_name = sheet.get("profile") or pkg.get("baseProfile") or "character"
            prof = load_sprite_profiles().get("profiles", {}).get(prof_name, {})
            img = Image.open(io.BytesIO(assets[aid]))
            frame = self._crop_base_down_frame(img, prof)
            buf = io.BytesIO()
            frame.save(buf, format="PNG")
            return buf.getvalue()
        return None

    def scan_packages(self) -> List[Dict[str, Any]]:
        s = self.load_settings()
        base = self.get_package_directory()
        ensure_library_subdirs(base)
        found: List[Dict[str, Any]] = []
        paths = self._collect_charbin_paths(base)
        for p in paths:
            try:
                pkg, assets = read_charbin(p.read_bytes())
                sheets = pkg.get("spriteSheets") or []
                has_thumb = any(s.get("assetId") for s in sheets)
                meta = pkg.get("metadata") or {}
                char_type = meta.get("characterType") or "npc"
                if char_type == "playable":
                    char_type = "player"
                walk_meta = library_walk_meta(pkg, assets)
                sheets_meta = library_all_sheets_meta(pkg, assets)
                tags = meta.get("tags") or []
                if not isinstance(tags, list):
                    tags = [str(tags)] if tags else []
                poke_types = meta.get("pokemonTypes") or []
                if not isinstance(poke_types, list):
                    poke_types = [str(poke_types)] if poke_types else []
                found.append(
                    {
                        "path": str(p),
                        "fileName": p.name,
                        "id": pkg.get("id"),
                        "displayName": pkg.get("displayName"),
                        "internalName": pkg.get("internalName"),
                        "characterType": char_type,
                        "pokemonId": meta.get("pokemonId"),
                        "pokemonTypes": poke_types,
                        "tags": [str(t).strip() for t in tags if str(t).strip()],
                        "schemaVersion": pkg.get("schemaVersion"),
                        "sheetCount": len(sheets),
                        "actionCount": len(pkg.get("actions") or []),
                        "hasThumb": has_thumb,
                        "modifiedAt": int(p.stat().st_mtime * 1000),
                        **walk_meta,
                        **sheets_meta,
                    }
                )
            except Exception as exc:  # noqa: BLE001 — surface broken files in library
                found.append(
                    {
                        "path": str(p),
                        "fileName": p.name,
                        "id": None,
                        "displayName": p.stem,
                        "error": str(exc),
                    }
                )
        s["scannedPackages"] = found
        s["lastScanAt"] = int(time.time() * 1000)
        s["libraryFingerprint"] = self._library_fingerprint(paths)
        self.save_settings(s)
        return found

    def _load_draft_assets(self) -> Dict[str, bytes]:
        out: Dict[str, bytes] = {}
        if not self.draft_assets_dir.is_dir():
            return out
        for p in self.draft_assets_dir.glob("*.png"):
            out[p.stem] = p.read_bytes()
        return out

    def _save_draft_asset(self, asset_id: str, data: bytes) -> None:
        self.draft_assets_dir.mkdir(parents=True, exist_ok=True)
        safe = asset_id.replace("/", "_")
        (self.draft_assets_dir / f"{safe}.png").write_bytes(data)

    def load_draft(self) -> Optional[Dict[str, Any]]:
        if not self.draft_path.exists():
            return None
        body = json.loads(self.draft_path.read_text(encoding="utf-8"))
        body["_assets"] = self._load_draft_assets()
        return body

    def save_draft(
        self,
        package: Dict[str, Any],
        assets: Optional[Dict[str, bytes]] = None,
        *,
        source_path: str = "",
    ) -> Dict[str, Any]:
        assets = assets if assets is not None else self._load_draft_assets()
        for aid, blob in assets.items():
            self._save_draft_asset(aid, blob)
        meta = {
            "sourcePath": source_path,
            "updatedAt": int(time.time() * 1000),
        }
        pkg_copy = {k: v for k, v in package.items() if not k.startswith("_")}
        self.draft_path.write_text(
            json.dumps({"package": pkg_copy, "meta": meta}, indent=2),
            encoding="utf-8",
        )
        return {"package": pkg_copy, "assets": {k: len(v) for k, v in assets.items()}, "meta": meta}

    def clear_draft(self) -> None:
        if self.draft_path.exists():
            self.draft_path.unlink()
        if self.draft_assets_dir.is_dir():
            for p in self.draft_assets_dir.glob("*"):
                p.unlink()

    def _canonical_charbin_path(self, package: Dict[str, Any]) -> Path:
        cid = package.get("id") or "character"
        meta = package.get("metadata") or {}
        ct = meta.get("characterType") or "npc"
        return charbin_path_for_package(self.get_package_directory(), cid, ct)

    def open_charbin_path(self, path: str) -> Dict[str, Any]:
        p = Path(path).expanduser()
        if not p.is_file():
            raise FileNotFoundError(path)
        package, assets = load_charbin_file(p)
        self.save_draft(package, assets, source_path=str(p.resolve()))
        return {"package": package, "meta": {"sourcePath": str(p.resolve())}, "assetIds": list(assets.keys())}

    def open_new(
        self,
        char_id: str,
        display_name: str,
        *,
        character_type: str = "npc",
        base_profile: str | None = None,
    ) -> Dict[str, Any]:
        pkg = empty_package(char_id, display_name)
        pkg["metadata"]["characterType"] = character_type
        if character_type == "pokemon":
            pkg["baseProfile"] = base_profile or "pokemon_small"
            slug = char_id
            pkg["metadata"]["speciesName"] = display_name
            pkg["metadata"]["pokemonId"] = None
        elif character_type == "object":
            pkg["baseProfile"] = base_profile or "object"
            pkg["metadata"]["objectAnimated"] = False
        elif character_type == "player":
            pkg["baseProfile"] = base_profile or "character"
        else:
            pkg["baseProfile"] = base_profile or "character"
        target = str(self._canonical_charbin_path(pkg))
        self.save_draft(pkg, {}, source_path="")
        return {
            "package": pkg,
            "meta": {"sourcePath": "", "targetPath": target},
            "assetIds": [],
        }

    def import_to_library(self, package: Dict[str, Any], assets: Dict[str, bytes]) -> str:
        """Persist imported package into the characters directory."""
        path = self._canonical_charbin_path(package)
        from spmk_app.character_package import ensure_package_actions
        from spmk_app.package_image import normalize_package_sheet_assets

        package = self._sanitize_package_metadata(ensure_package_actions(package))
        norm = normalize_package_sheet_assets(package, assets)
        save_charbin_file(path, package, collect_assets_from_package(package, norm))
        self.save_draft(package, norm, source_path=str(path))
        self.scan_packages()
        return str(path)

    def patch_draft(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        cur = self.load_draft()
        if not cur:
            raise ValueError("no draft open")
        pkg = cur.get("package") or empty_package()
        merged = self._sanitize_package_metadata(deep_merge_preserve_unknown(pkg, patch))
        assets = cur.get("_assets") or self._load_draft_assets()
        meta = cur.get("meta") or {}
        self.save_draft(merged, assets, source_path=meta.get("sourcePath", ""))
        return self.load_draft() or {}

    def put_draft_asset(
        self,
        asset_id: str,
        raw_bytes: bytes,
        *,
        profile_name: str | None = None,
    ) -> Dict[str, Any]:
        cur = self.load_draft()
        if not cur:
            raise ValueError("no draft open")
        pkg = cur.get("package") or {}
        profile = profile_name or pkg.get("baseProfile") or "character"
        from spmk_app.package_image import prepare_sheet_image_bytes

        png_bytes, prep = prepare_sheet_image_bytes(raw_bytes, profile)
        self._save_draft_asset(asset_id, png_bytes)
        cur.setdefault("_assets", {})[asset_id] = png_bytes
        return prep

    def add_draft_sheet(
        self,
        raw_bytes: bytes,
        *,
        mode: str,
        label: str = "",
        walk_sheet_id: str = "walk",
        anim_kind: str = "movement",
        include_idle: bool = False,
        frame_count: int = 4,
        frame_time_ms: int = 120,
    ) -> Dict[str, Any]:
        from spmk_app.character_package import ensure_package_actions
        from spmk_app.package_draft_sheet import add_sheet_to_draft_package

        cur = self.load_draft()
        if not cur:
            raise ValueError("no draft open")
        pkg = cur.get("package") or {}
        profile = pkg.get("baseProfile") or "character"
        merged, asset_id, prep, sheet_id, png_bytes = add_sheet_to_draft_package(
            pkg,
            raw_bytes,
            mode=mode,
            label=label,
            walk_sheet_id=walk_sheet_id,
            anim_kind=anim_kind,
            include_idle=include_idle,
            frame_count=frame_count,
            frame_time_ms=frame_time_ms,
            profile_name=profile,
        )
        merged = self._sanitize_package_metadata(ensure_package_actions(merged))
        assets = dict(cur.get("_assets") or self._load_draft_assets())
        assets[asset_id] = png_bytes
        meta = cur.get("meta") or {}
        self.save_draft(merged, assets, source_path=meta.get("sourcePath", ""))
        return {"prepare": prep, "sheetId": sheet_id, "assetId": asset_id}

    def validate_draft(self) -> Dict[str, Any]:
        cur = self.load_draft()
        if not cur:
            return {"ok": False, "errors": ["no package open"], "warnings": []}
        return validate_package(cur.get("package") or {}, cur.get("_assets") or {})

    def save_draft_to_path(self, path: Optional[str] = None) -> str:
        cur = self.load_draft()
        if not cur:
            raise ValueError("no draft open")
        from spmk_app.package_image import normalize_package_sheet_assets

        package = cur.get("package") or {}
        raw_assets = cur.get("_assets") or {}
        assets = collect_assets_from_package(
            package,
            normalize_package_sheet_assets(package, raw_assets),
        )
        if path:
            out = Path(path).expanduser()
        else:
            meta = cur.get("meta") or {}
            existing = meta.get("sourcePath") or ""
            if existing and Path(existing).is_file():
                out = Path(existing)
            else:
                out = self._canonical_charbin_path(package)
        out.parent.mkdir(parents=True, exist_ok=True)
        from spmk_app.character_package import ensure_package_actions

        package = self._sanitize_package_metadata(ensure_package_actions(package))
        meta = cur.get("meta") or {}
        old_path = meta.get("sourcePath") or ""
        save_charbin_file(out, package, assets)
        if old_path:
            old = Path(old_path).expanduser()
            try:
                if old.is_file() and old.resolve() != out.resolve():
                    old.unlink()
            except OSError:
                pass
        self.save_draft(package, assets, source_path=str(out.resolve()))
        self.scan_packages()
        return str(out.resolve())

    def debug_export_draft(self) -> Path:
        cur = self.load_draft()
        if not cur:
            raise ValueError("no draft open")
        package = cur.get("package") or {}
        cid = package.get("id", "character")
        out_dir = self.exports / f"debug_{cid}_{int(time.time())}"
        export_debug_loose(package, cur.get("_assets") or {}, out_dir)
        return out_dir
