# Agent guide — Character Editor module

Read this before editing `spmk_app/static/ui-packages.js`, `package_store.py`, or library-related UI.

## Do not remove shipped features

This module has lost UI functionality more than once when large edits landed without re-wiring helpers. **Do not delete or “simplify away” the items below** unless the user explicitly asks to remove them.

### Protected library features (`ui-packages.js`)

| Feature | Required symbols / DOM | Doc |
|--------|-------------------------|-----|
| **Library search + filter modal** | `PKG_LIB_FILTERS_KEY`, `renderPkgLibSearchBar`, `openPkgLibFilterModal`, `matchesPkgLibFilters`, `applyPkgLibFilters`, `pkgLibPokemonFlatMode`, `.pkg-lib-searchbar` | [LIBRARY_FILTERS.md](./LIBRARY_FILTERS.md) |
| **Pokémon generation groups** | `groupPokemonByGeneration`, `renderPokemonLibrarySection`, `.pkg-lib-gen` | [LIBRARY_FILTERS.md](./LIBRARY_FILTERS.md) |
| **Object category groups** | `OBJECT_CATEGORIES`, `renderObjectLibrarySection`, `.pkg-lib-obj-cat` | [CHARBIN_SCHEMA.md](./CHARBIN_SCHEMA.md) |
| **Sheet grid inspect** | `openPkgSheetModal`, `pkgEffectiveFrameSize`, separate width/height via `profileOverrides` | [CHARBIN_SCHEMA.md](./CHARBIN_SCHEMA.md) |
| **Lazy Pokémon / object grids** | `mountPokemonGenBody`, `bindPokemonLibraryLazy`, `mountObjectCatBody` | — |
| **Generate pick mode** | `state.generatePickMode`, missing-only filter in `renderCharList` | — |

### Protected scan metadata (`package_store.py` / `character_package.py`)

Library filters depend on scan fields. **Keep these on package scan:**

- `walkCellWidth`, `walkCellHeight`, `walkSheetWidth`, `walkSheetHeight`
- `sheetDimensions`, `sheetSizeBuckets`
- `pokemonTypes`, `tags`, `objectCategory`

Removing or renaming these without updating `ui-packages.js` breaks filters silently.

### Protected styles (`ui-polish.css`)

If you change library markup, keep or update matching rules:

- `.pkg-lib-searchbar`, `.pkg-lib-filter-modal`, `.pkg-lib-filter-chip`
- `.pkg-lib-pokemon-flat`, `.pkg-lib-gen`, `.pkg-lib-obj-cat`

## Before finishing a UI change

1. Run `node scripts/check_library_filters.js` from this module root.
2. Run `node --check spmk_app/static/ui-packages.js`.
3. Bump cache bust on touched static assets in `spmk_app/static/index.html` (`?v=charbinNN`).
4. Manually smoke-test: Characters list → search, Filters modal, filter by sheet size 160, Clear.

## Editing rules

- **Extend, don’t replace** — add hooks to `renderCharList()` rather than rewriting the whole function.
- **Preserve filter pipeline** — `fullList` → `applyPkgLibFilters(fullList)` → `partitionLibrary(list)`.
- **Pass `fullList` to binders** — card delete/open handlers need the unfiltered scan; filters apply inside lazy loaders.
- **Document new library capabilities** in [LIBRARY_FILTERS.md](./LIBRARY_FILTERS.md) and add a row to the table above.

## Key files

| Area | Path |
|------|------|
| Library UI | `spmk_app/static/ui-packages.js` |
| Library styles | `spmk_app/static/ui-polish.css` |
| Scan API | `spmk_app/package_store.py` → `scan_packages()` |
| Size metadata | `spmk_app/character_package.py` → `library_walk_meta()`, `library_all_sheets_meta()` |
| Static guard | `scripts/check_library_filters.js` |
