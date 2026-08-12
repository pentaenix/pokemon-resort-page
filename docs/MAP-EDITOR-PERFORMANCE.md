# Map Studio performance principles

Map Studio should feel immediate while painting, navigating between maps, and changing tools. These principles define the performance work rather than relying on isolated micro-optimizations.

## Interaction budgets

- Pointer painting should update the affected cells within one frame whenever practical.
- Tool and sidebar changes should feel immediate and avoid loading map assets.
- Switching to a map that uses the current RTPKS package should load only the map document.
- Search should not rebuild the editor for every keystroke.

## Engineering rules

1. **Bound work per interaction.** Render only a limited catalog page and only refresh cells invalidated by an edit.
2. **Index repeated spatial queries.** Build coordinate indexes once per render for tile footprints, doors, and props instead of scanning every possible anchor for every cell.
3. **Cache immutable assets by identity.** RTPKS metadata, thumbnails, parsed models, and map layout summaries should survive map changes until their source identity changes.
4. **Invalidate narrowly.** A tile stroke should update its footprint and affected transition neighbours, not remount the entire editor.
5. **Keep editing state separate from presentation.** Mutations should produce a small changed region that the renderer can consume.
6. **Defer nonessential previews.** Visible catalog items take priority; off-page thumbnails and large 3D previews should not compete with input.
7. **Measure costs at boundaries.** Track map-load time, package-load time, editor render time, cell refresh count, and thumbnail queue depth so regressions are visible.

## Current safeguards

- Same-package map changes reuse the loaded RTPKS catalog.
- Layout navigation uses cached project summaries.
- Visible multi-cell tile coverage is indexed once for a grid refresh.
- The tile catalog is paged and search rendering is debounced.
- Drawing-tool and workflow-tab buttons update their own DOM state without rebuilding the grid.
- Cursor ghosts use a dedicated overlay. Moving between cells no longer rebuilds static tile and prop overlays.
- Grid mouse handlers are replaced during a render instead of accumulating duplicate global listeners.

## Next structural work

The current editor still rebuilds most of its DOM for many state changes. The next large improvement should split the shell, grid, inspector, and catalogs into independently invalidated views. If very large maps remain slow after that, virtualize the grid or move its visual layer to a retained canvas while keeping accessible interaction controls for the visible region.
