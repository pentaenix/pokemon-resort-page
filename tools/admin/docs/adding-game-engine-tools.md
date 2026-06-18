# Adding a Game Engine tool

The **Game Engine** tab is a launcher hub. Each entry is a card (screenshot, title, description) that slides open into the shared workbench panel on the right.

## Quick checklist

1. Add a preview image under `pokemon-resort-page/public/media/game_engine/`.
2. Register the tool in `pokemon-resort-page/tools/admin/data/game-engine-tools.json`.
3. If the tool reuses an existing workbench, set `workbench` to `map` or `character`.
4. If the tool needs a **new** editor (audio, config, playtest utilities), implement the workbench module and wire it in `admin.js` (see below).
5. Replace placeholder screenshots with PNG/WebP captures when ready (recommended size: **640×400** or 16∶10). Re-capture from a running desk:

```bash
cd pokemon-resort-page
# admin on :9477, character editor deps installed
node tools/admin/scripts/capture-game-engine-screenshots.mjs
```

This writes `public/media/game_engine/maps.png` and `characters.png` from Playwright (real UI, not generated art).

## Manifest (`data/game-engine-tools.json`)

```json
{
  "tools": [
    {
      "id": "maps",
      "title": "Map Studio",
      "description": "Short user-facing blurb shown on the card.",
      "image": "/media/game_engine/maps.png",
      "workbench": "map"
    }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | URL slug: `#/game-engine/{id}`. Use lowercase `a-z`, digits, hyphens. |
| `title` | yes | Card heading and workbench loading shell title. |
| `description` | yes | One or two sentences on the card. |
| `image` | yes | Public URL under `/media/game_engine/…`. Served from `pokemon-resort-page/public/`. |
| `workbench` | yes | `map` \| `character` today. New types need a code hook (see below). |

Tools appear in **JSON array order**.

## Preview images

- **Directory:** `pokemon-resort-page/public/media/game_engine/`
- **Naming:** match the tool `id` when possible (`maps.png`, `characters.png`, `audio.png`).
- **Aspect ratio:** 16∶10 (card uses `aspect-ratio: 16 / 10`).
- **Format:** PNG or WebP preferred for real screenshots; SVG placeholders ship in-repo until replaced.

After adding a file, reference it in the manifest (`"image": "/media/game_engine/your-file.png"`). No server restart required for static files; hard-refresh the admin tab.

## Existing workbench types

| `workbench` | Module | Subprocess / notes |
| --- | --- | --- |
| `map` | `public/map-editor.js` | In-browser; Node APIs on admin port. |
| `character` | `public/character-editor.js` | Python subprocess on port 8789 (see `DEV-PORTS.md`). |

Registering a new card with `workbench: "map"` or `"character"` is **manifest-only**.

## Adding a new workbench type (e.g. audio, config)

1. Create `public/your-editor.js` (+ CSS) with the same exports pattern as `character-editor.js`:
   - `initYourEditorTab(state, api)`
   - `yourEditorHtml(state, esc)`
   - `bindYourEditor(state, deps)`
2. In `admin.js` → `render()` workbench branch, handle `tool.workbench === 'your-type'`.
3. Add the new `workbench` string to this doc and to the manifest entry.
4. If the tool needs a subprocess or new API routes, extend `tools/admin/server.mjs` (mirror `character-editor`).

## Routing

| URL | Behavior |
| --- | --- |
| `#/game-engine` | Hub only |
| `#/game-engine/maps` | Hub + Map Studio workbench |
| `#/game-engine/characters` | Hub + Character Editor workbench |
| `#/map-editor` | Legacy → `#/game-engine/maps` |
| `#/character-editor` | Legacy → `#/game-engine/characters` |

## API

`GET /api/game-engine/tools` returns the parsed manifest (used by `game-engine.js` on first hub load).

## Related files

- `public/game-engine.js` — hub UI
- `public/game-engine.css` — card grid
- `public/admin.js` — tab, routing, workbench slide
- `public/index.html` — stylesheets
