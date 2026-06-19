# Adding a Game Engine editor

Each editor is a **self-contained module** under `tools/admin/modules/<name>/`. Drop in a folder with `editor.json` + `editor.js` (+ `editor.css`) and it appears on the Game Engine hub automatically — no changes to `admin.js`.

## Quick checklist

1. Create `tools/admin/modules/<your-editor>/`
2. Add `editor.json` (manifest — see below)
3. Add `editor.js` exporting the standard module API
4. Add `editor.css` (optional but typical)
5. Add a card image under `public/media/game_engine/<id>.png`
6. Restart `npm run admin` if you add server APIs or subprocess wiring

Re-capture hub screenshots:

```bash
cd pokemon-resort-page
node tools/admin/scripts/capture-game-engine-screenshots.mjs
```

## Module layout

```
tools/admin/modules/
  mapeditor/           # example: in-browser editor
    editor.json
    editor.js
    editor.css
    settings.json      # optional module-local config
    map-3d-view.js     # optional private helpers
  charactereditor/     # example: Python subprocess + iframe shell
    editor.json
    editor.js
    editor.css
    settings.json
    spmk_app/          # private backend (not served over /modules/)
```

Shared JS used by multiple editors lives in `tools/admin/shared/` (served at `/shared/`).

## Manifest (`editor.json`)

```json
{
  "id": "maps",
  "order": 1,
  "title": "Map Editor",
  "description": "One or two sentences for the hub card.",
  "image": "/media/game_engine/maps.png",
  "entry": "/modules/mapeditor/editor.js",
  "styles": ["/modules/mapeditor/editor.css"],
  "bodyClass": "map-editor-active",
  "legacyRoutes": ["map-editor"],
  "capabilities": ["maps", "overworld-models"]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | URL slug: `#/game-engine/{id}` |
| `title` | yes | Card + workbench title |
| `description` | yes | Hub card blurb |
| `image` | yes | Public URL under `/media/game_engine/` |
| `entry` | yes | ES module URL (usually `/modules/<folder>/editor.js`) |
| `styles` | no | CSS URLs loaded when editor opens |
| `bodyClass` | no | `document.body` class while workbench is open |
| `legacyRoutes` | no | Old hash routes that redirect to this editor |
| `order` | no | Hub sort order (lower first) |
| `subprocess` | no | Hint for server-managed subprocesses (e.g. `character-editor`) |
| `capabilities` | no | Documented API feature flags (informational) |

Discovery: `lib/editor-registry.mjs` scans `modules/*/editor.json`.  
API: `GET /api/game-engine/tools` returns the merged list.

## Standard module API (`editor.js`)

Export these names so `public/editor-host.js` can load any editor uniformly:

```javascript
export async function initEditorTab(state, api) { /* optional warm-up */ }
export function editorHtml(state, esc) { /* workbench inner HTML */ }
export function bindEditor(state, deps) { /* wire buttons, listeners */ }
```

You may keep internal names and alias at the bottom:

```javascript
export const initEditorTab = initMapEditorTab;
export const editorHtml = mapEditorHtml;
export const bindEditor = bindMapEditor;
```

## Server APIs

- **In-browser editors** (like Map Editor): add routes in `tools/admin/server.mjs` or a `modules/<name>/server.mjs` imported from there.
- **Subprocess editors** (like Character Editor): mirror `/api/character-editor/*` — spawn from `modules/<name>/`, proxy UI at `/character-editor/`.

Static assets: `/modules/<folder>/*` serves only editor-facing files (blocks `.venv`, `spmk_app/`, etc.).

## Routing

| URL | Behavior |
| --- | --- |
| `#/game-engine` | Hub |
| `#/game-engine/maps` | Map Editor workbench |
| `#/game-engine/characters` | Character Editor workbench |
| `#/map-editor` | Legacy → maps |
| `#/character-editor` | Legacy → characters |

## Related files

- `public/editor-host.js` — dynamic import + CSS injection
- `public/game-engine.js` — hub card grid
- `public/admin.js` — tab + workbench shell (generic; no per-editor switches)
- `lib/editor-registry.mjs` — manifest discovery
