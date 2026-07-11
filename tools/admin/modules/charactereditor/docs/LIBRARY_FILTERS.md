# Character library — search & filters

The Characters tab (`.charbin` library) includes a **search bar** and **filter modal** at the top of the list.

**Implementation:** `spmk_app/static/ui-packages.js`  
**Styles:** `spmk_app/static/ui-polish.css` (`.pkg-lib-searchbar`, `.pkg-lib-filter-modal`)  
**Scan data:** `POST /api/packages/scan` via `library_walk_meta()` and `library_all_sheets_meta()`

> Agents: do not remove this feature. See [AGENTS.md](./AGENTS.md).

## Search bar

- DOM: `.pkg-lib-searchbar`, `#pkgLibSearch`
- Matches: display name, id, dex #, tags, Pokémon types, walk cell size (`40×40`), raw sheet sizes (`sheet 160×160`), every embedded sheet dimension
- Shows `N characters` or `M of N` when narrowed
- **Clear** button when search or filters are active
- State key: `localStorage` → `spmk.pkg.libFilters` → `query`

## Filter modal

- Open via **Filters** button (`#pkgLibOpenFilters`); badge shows active chip count
- Chip groups:
  - **Type** — Player, NPC, Pokémon, Object
  - **Generation** — Gen I–IX, No dex (Pokémon only)
  - **Walk cell size** — Small 32px, Medium 40px, Large 64px+, Other (odd cells)
  - **Sprite sheet size** — 128, 160, 256, Other (checks **every** embedded PNG; a charbin with both 128 and 160 sheets matches both)
  - **Pokémon types** — dynamic from library metadata
  - **Tags** — dynamic from charbin `metadata.tags`
- **Clear all** in modal keeps search text; **Clear** on the bar resets everything
- Filters persist in `localStorage` (`spmk.pkg.libFilters`)

## Pokémon layout when filtering

- **No active search/filters:** Pokémon grouped by generation (collapsible, lazy-loaded grids)
- **Any search or filter active:** Pokémon shown in a **flat** grid (`.pkg-lib-pokemon-flat`) with a “filtered view” tag — generations are not used so type searches (e.g. Water) are not split across gens

## Card tags

Non-standard walk cell sizes show on library cards via `libraryCellSizeTag()` (yellow **warn** tag for odd sizes).

## Required JS symbols (guard script)

`scripts/check_library_filters.js` fails if any of these are missing from `ui-packages.js`:

`PKG_LIB_FILTERS_KEY`, `renderPkgLibSearchBar`, `openPkgLibFilterModal`, `matchesPkgLibFilters`, `applyPkgLibFilters`, `pkgLibPokemonFlatMode`, `libraryCellSizeTag`, `pkg-lib-searchbar`
