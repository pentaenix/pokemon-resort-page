"""One-off repair: rebuild Pokémon action lists from embedded sheets (no PNG reimport).

Adds missing stance actions (idle_swim, sheetBehavior, etc.) on existing .charbin files.
Safe to delete this module after the library has been migrated.

Usage (from charactereditor/):
  .venv/bin/python -m spmk_app.migrate_charbin_actions
  .venv/bin/python -m spmk_app.migrate_charbin_actions --write
  .venv/bin/python -m spmk_app.migrate_charbin_actions --write --path /path/to/foo.charbin
"""
from __future__ import annotations

import argparse
import json
import sys
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Sequence

from spmk_app.charbin_io import load_charbin_file, save_charbin_file
from spmk_app.character_package import collect_assets_from_package, is_pokemon_package
from spmk_app.package_paths import LIBRARY_FOLDERS, default_characters_dir, resolve_characters_dir
from spmk_app.pokemon_variant_model import migrate_package_variant_model


def repair_charbin_package(package: Dict[str, Any]) -> Dict[str, Any]:
    """Sync variant fields and rebuild standard actions from sprite sheets."""
    from spmk_app.character_package import ensure_package_actions

    out = migrate_package_variant_model(deepcopy(package))
    if is_pokemon_package(out):
        out = ensure_package_actions(out)
    return out


def _action_signature(package: Dict[str, Any]) -> str:
    actions = package.get("actions") or []
    slim = [
        {
            "id": a.get("id"),
            "sheetId": a.get("sheetId"),
            "behavior": a.get("behavior"),
            "sheetBehavior": a.get("sheetBehavior"),
            "animationName": a.get("animationName"),
            "movementDriven": a.get("movementDriven"),
        }
        for a in actions
    ]
    return json.dumps(slim, sort_keys=True, separators=(",", ":"))


@dataclass
class MigrateResult:
    path: Path
    changed: bool
    pokemon: bool
    action_count_before: int
    action_count_after: int
    added_ids: List[str] = field(default_factory=list)
    error: str = ""

    @property
    def label(self) -> str:
        return self.path.name


def migrate_charbin_file(path: Path, *, write: bool) -> MigrateResult:
    path = path.resolve()
    res = MigrateResult(path=path, changed=False, pokemon=False, action_count_before=0, action_count_after=0)
    try:
        package, assets = load_charbin_file(path)
    except Exception as exc:
        res.error = str(exc)
        return res

    res.pokemon = is_pokemon_package(package)
    before_ids = {a.get("id") for a in (package.get("actions") or []) if a.get("id")}
    res.action_count_before = len(before_ids)
    before_sig = _action_signature(package)

    fixed = repair_charbin_package(package)
    after_ids = {a.get("id") for a in (fixed.get("actions") or []) if a.get("id")}
    res.action_count_after = len(after_ids)
    res.added_ids = sorted(aid for aid in after_ids - before_ids if aid)
    res.changed = _action_signature(fixed) != before_sig

    if res.changed and write:
        out_assets = collect_assets_from_package(fixed, assets)
        save_charbin_file(path, fixed, out_assets)

    return res


def _collect_charbin_paths(root: Path) -> List[Path]:
    paths: List[Path] = []
    for folder in LIBRARY_FOLDERS:
        paths.extend(sorted((root / folder).glob("*.charbin")))
    paths.extend(sorted(root.glob("*.charbin")))
    seen: set[str] = set()
    out: List[Path] = []
    for p in paths:
        key = str(p.resolve())
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def migrate_library(characters_dir: Path, *, write: bool) -> List[MigrateResult]:
    characters_dir = characters_dir.resolve()
    if not characters_dir.is_dir():
        raise FileNotFoundError(f"characters directory not found: {characters_dir}")
    results: List[MigrateResult] = []
    for path in _collect_charbin_paths(characters_dir):
        results.append(migrate_charbin_file(path, write=write))
    return results


def _print_report(results: Sequence[MigrateResult], *, write: bool) -> int:
    errors = [r for r in results if r.error]
    changed = [r for r in results if r.changed and not r.error]
    skipped = [r for r in results if not r.changed and not r.error]

    mode = "APPLIED" if write else "DRY RUN"
    print(f"Charbin action repair ({mode})")
    print(f"  scanned: {len(results)}")
    print(f"  changed: {len(changed)}")
    print(f"  unchanged: {len(skipped)}")
    print(f"  errors: {len(errors)}")
    print()

    for r in changed:
        tag = "pokemon" if r.pokemon else "other"
        added = ", ".join(r.added_ids[:8])
        if len(r.added_ids) > 8:
            added += f", +{len(r.added_ids) - 8} more"
        extra = f"  +[{added}]" if added else ""
        print(f"  {'WROTE' if write else 'WOULD FIX'}  {r.path}{extra}")
        print(f"           actions {r.action_count_before} → {r.action_count_after} ({tag})")

    for r in errors:
        print(f"  ERROR  {r.path}: {r.error}")

    if not write and changed:
        print()
        print("Re-run with --write to update files (PNG blobs are untouched).")

    return 1 if errors else 0


def main(argv: Sequence[str] | None = None) -> int:
    spmk_root = Path(__file__).resolve().parent.parent
    default_dir = default_characters_dir(spmk_root)

    parser = argparse.ArgumentParser(
        description="Rebuild Pokémon action records on existing .charbin files (no sprite reimport).",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Save repaired packages (default is dry-run).",
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=None,
        help=f"Characters library root (default: {default_dir})",
    )
    parser.add_argument(
        "--path",
        type=Path,
        action="append",
        default=[],
        help="Repair a single .charbin (repeatable). Skips --dir scan.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.path:
        results = [migrate_charbin_file(Path(p), write=args.write) for p in args.path]
    else:
        characters_dir = args.dir
        if characters_dir is None:
            characters_dir = resolve_characters_dir(spmk_root, str(default_dir))
        results = migrate_library(characters_dir, write=args.write)

    return _print_report(results, write=args.write)


if __name__ == "__main__":
    sys.exit(main())
