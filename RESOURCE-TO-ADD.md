# Resources to Add

This file is the media contract for the static app. The code is wired for these resources, but official copyrighted art and your in-progress game assets are not bundled in this zip.

Add only files you are comfortable hosting publicly in your GitHub repository. Prefer optimized `.webp` for still images, `.gif` or animated `.webp` for sprite previews, `.mp4` for short muted clips, and `.glb` for 3D models.

## Important legal note

For official Pokémon game box art, screenshots from the series, or other third-party material, keep the public site’s legal disclaimer visible and use only resources you have decided are appropriate for your fan research context. The app does not hotlink Google or random external image results because those links break and are hard to control.

## Folder rule

All public media should live under:

```text
public/media/
```

When you write paths in JSON, omit `public/`.

Example:

```json
"boxArt": "media/games/box-art/gen-03/emerald.webp"
```

## 1. Game box art for the Compatibility Ontology

Place curated local game box images at exactly these paths. The ontology side panel already points to them through `public/data/compatibility.json`.

Recommended format:

- `.webp`
- portrait crop
- consistent visual size across games
- around `512x736`, `640x920`, or similar
- optimized for web

Required paths:

```text
public/media/games/box-art/gen-01/red.webp
public/media/games/box-art/gen-01/blue.webp
public/media/games/box-art/gen-01/yellow.webp

public/media/games/box-art/gen-02/gold.webp
public/media/games/box-art/gen-02/silver.webp
public/media/games/box-art/gen-02/crystal.webp

public/media/games/box-art/gen-03/ruby.webp
public/media/games/box-art/gen-03/sapphire.webp
public/media/games/box-art/gen-03/emerald.webp
public/media/games/box-art/gen-03/fire-red.webp
public/media/games/box-art/gen-03/leaf-green.webp

public/media/games/box-art/gen-04/diamond.webp
public/media/games/box-art/gen-04/pearl.webp
public/media/games/box-art/gen-04/platinum.webp
public/media/games/box-art/gen-04/heartgold.webp
public/media/games/box-art/gen-04/soulsilver.webp

public/media/games/box-art/gen-05/black.webp
public/media/games/box-art/gen-05/white.webp
public/media/games/box-art/gen-05/black-2.webp
public/media/games/box-art/gen-05/white-2.webp

public/media/games/box-art/gen-06/x.webp
public/media/games/box-art/gen-06/y.webp
public/media/games/box-art/gen-06/omega-ruby.webp
public/media/games/box-art/gen-06/alpha-sapphire.webp

public/media/games/box-art/gen-07/sun.webp
public/media/games/box-art/gen-07/moon.webp
public/media/games/box-art/gen-07/ultra-sun.webp
public/media/games/box-art/gen-07/ultra-moon.webp
public/media/games/box-art/gen-07/lets-go-pikachu.webp
public/media/games/box-art/gen-07/lets-go-eevee.webp

public/media/games/box-art/gen-08/sword.webp
public/media/games/box-art/gen-08/shield.webp
public/media/games/box-art/gen-08/brilliant-diamond.webp
public/media/games/box-art/gen-08/shining-pearl.webp
public/media/games/box-art/gen-08/legends-arceus.webp

public/media/games/box-art/gen-09/scarlet.webp
public/media/games/box-art/gen-09/violet.webp
public/media/games/box-art/gen-09/legends-za.webp
```

After adding files, run the local Operations Desk and check **Dashboard → Needs attention**. It will stop listing any box art file it can find under `public/media`.

### Fetch via Operations Desk (Libretro Thumbnails)

Box art is downloaded from the public [Libretro Thumbnails](https://thumbnails.libretro.com/) CDN (`Named_Boxarts` — same artwork many RetroArch setups use). **No API keys.** The public site only serves files you saved under `public/media/`.

1. `npm run admin` → **Game Library** tab.
2. Select a game → **Find covers** (or **Auto-pick recommended**).
3. Click **Use this cover** on the preview you want.
4. Or CLI: `npm run fetch:boxart` (optional game ids, `--force` to re-download).

**Coverage:** Game Boy through Nintendo 3DS Pokémon titles are on Libretro. **Switch** games (Sword/Shield, Scarlet/Violet, Legends, etc.) are not in this CDN yet — add those box images manually.

Review downloaded art before publishing; you are responsible for what you host on GitHub.

## Keeping the ontology up to date (new games or Gen X)

The Compatibility page is **data-driven**. It does not scrape release calendars; whatever is listed in `public/data/compatibility.json` is what appears in the graph, search, and game library panels.

### Add a new mainline or Legends title (example: Legends Z-A)

1. Add a `games[]` entry in `public/data/compatibility.json` with `id`, `title`, `generation` (e.g. `gen9`), `shortTitle`, `platform`, `releaseYear`, and `boxArt` path.
2. Place box art at that path under `public/media/games/box-art/…` (see list above), or fetch it from **Game Library** in the Operations Desk.
3. Run `node tools/validate-data.mjs` from `pokemon-resort-page/`.
4. Optional: use **Operations Desk** (`tools/admin`) → Game Library to edit entries without hand-editing JSON.

Search and the focused game library pick up new games automatically once they are in `games[]`.

### Add Generation X (when it ships)

1. Add a `generations[]` object (`id`: `gen10`, `label`, `shortLabel`, `number`, `era`, `accent`, `summary`).
2. Add every main title for that era to `games[]`.
3. Add **directional routes** for the new generation:
   - one `from → to` entry per ordered pair you care about (the site uses separate arrows per direction),
   - plus self-route `gen10-gen10` (Resort loop),
   - today the matrix is maintained manually in `routes[]` (81 routes for 9×9); Gen 10 means new rows for all `gen10 ↔ *` pairs.
4. Add `public/media/games/box-art/gen-10/` assets.
5. Update `REGION_GENERATIONS` in `src/pages/Ontology.jsx` if the new region should map to multiple generations (e.g. remakes later).
6. Re-run validate-data; spot-check the ontology graph (node count and spokes grow with each generation).

The graph layout (`circlePositions`) already reads `generations.length`, so a tenth node appears once `gen10` exists in data—no layout code change required.

## 2. Homepage media

Use your own project/game footage where possible. The homepage already uses the two planning images you provided, and you can replace or expand those later.

Suggested paths:

```text
public/media/home/hero/hero-01.webp
public/media/home/hero/hero-02.webp
public/media/home/hero/hero-loop.mp4
public/media/home/feature-cards/atlas.webp
public/media/home/feature-cards/compatibility.webp
public/media/home/feature-cards/operations.webp
public/media/home/feature-cards/source-guide.webp
```

Update `public/data/homepage.json` or use the Operations Desk Design Lab when you want these to appear.

## 3. Island model

Current app behavior:

- The Island Atlas currently uses a built-in temporary Three.js island so the page works immediately.
- Replace the temporary renderer later with your final GLB when the model is ready.
- Keep the existing model path in `public/data/models.json` unless you intentionally rename it.

Target path:

```text
public/media/models/island/island-main.glb
public/media/models/island/island-preview.webp
```

Recommended model format:

- `.glb` single-file export
- origin near island center
- Y-up coordinate system
- consistent scale across main model and submodels
- reasonably optimized mesh count for browser viewing
- textures ideally 1024–2048px unless a hero asset truly needs more
- avoid enormous uncompressed texture files in GitHub Pages
- Draco compression is okay if the loader is updated for it

Recommended mesh names:

```text
island_terrain
main_lodge
ferry_dock
ferry_boat
main_path
north_beach
south_beach
staff_area
activity_zone_01
activity_zone_02
vegetation_palms
props_signage
waterline_props
```

## 4. Final model POI markers

POIs are stored in:

```text
public/data/research-pois.json
```

Each POI has a position:

```json
"position": [x, y, z]
```

Marker rules for the final GLB:

- Use the final GLB coordinate system.
- Keep Y-up coordinates.
- Put markers slightly above the visible surface so they do not z-fight with the mesh.
- Keep stable POI IDs after creating them; links and related data depend on IDs.
- Place markers near the center of the playable/research area, not at the edge of a building mesh.
- Use a consistent naming style such as `ferry-dock`, `main-lodge`, `north-beach`, `staff-area`.

Recommended POI record shape:

```json
{
  "id": "ferry-dock",
  "name": "Ferry Dock",
  "type": "Transport",
  "confidence": "Likely",
  "canonStatus": "Inferred from visible references",
  "devStatus": "Blockout needed",
  "position": [1.65, 0.25, 1.35],
  "summary": "Probable arrival/departure point based on ferry scenes and map placement.",
  "evidence": [
    {
      "label": "Map crop",
      "image": "media/research/map-crops/ferry-dock-map-crop.webp",
      "note": "Connected to the lower coastal path."
    }
  ],
  "assetNeeds": ["Dock model", "Ferry boat model", "Rope posts", "Arrival sign"],
  "linkedFeatures": ["feature-atlas"],
  "relatedBugs": []
}
```

## 5. Research evidence and frame analysis

Use these folders for your frame-by-frame island reconstruction work:

```text
public/media/research/frame-crops/episode-01/
public/media/research/frame-crops/episode-02/
public/media/research/frame-crops/episode-03/
public/media/research/frame-crops/episode-04/
public/media/research/map-crops/
public/media/research/diagrams/
public/media/research/evidence/
```

Suggested first files:

```text
public/media/research/map-crops/ferry-dock-map-crop.webp
public/media/research/evidence/ferry-dock-boat-reference.webp
public/media/research/diagrams/island-map-reconstruction-v01.webp
```

After adding them, update `public/data/research-pois.json` so the relevant POI points to those paths.

## 6. Island submodels

Submodels appear inside the Island Atlas page under the 3D Model Stack. They are managed by `public/data/models.json`.

Suggested paths:

```text
public/media/models/island-submodels/ferry-dock.glb
public/media/models/island-submodels/ferry-dock-preview.webp
public/media/models/island-submodels/main-lodge.glb
public/media/models/island-submodels/main-lodge-preview.webp
public/media/models/island-submodels/beach-zone.glb
public/media/models/island-submodels/beach-zone-preview.webp
public/media/models/island-submodels/paths.glb
public/media/models/island-submodels/paths-preview.webp
public/media/models/island-submodels/staff-area.glb
public/media/models/island-submodels/staff-area-preview.webp
public/media/models/island-submodels/ferry-boat.glb
public/media/models/island-submodels/ferry-boat-preview.webp
```

Recommended submodel record:

```json
{
  "id": "model-ferry-dock",
  "name": "Ferry Dock",
  "status": "blockout",
  "file": "media/models/island-submodels/ferry-dock.glb",
  "preview": "media/models/island-submodels/ferry-dock-preview.webp",
  "summary": "Dock model used for arrival and departure logic.",
  "relatedPoi": "ferry-dock",
  "neededAssets": [
    { "label": "Dock base", "done": true },
    { "label": "Rope posts", "done": false },
    { "label": "Arrival sign", "done": false }
  ]
}
```

## 7. Characters, visitors, sprites, and animations

Characters and visitors appear inside the Island Atlas page under **Visitors & Staff**. They are managed by `public/data/characters.json`.

Recommended folders:

```text
public/media/characters/haru/portrait.webp
public/media/characters/haru/idle.gif
public/media/characters/haru/walk.gif
public/media/characters/haru/sprite-sheet.webp

public/media/characters/tyler/portrait.webp
public/media/characters/tyler/idle.gif
public/media/characters/alisa/portrait.webp
public/media/characters/alisa/idle.gif

public/media/characters/visitors/<visitor-id>/portrait.webp
public/media/characters/visitors/<visitor-id>/idle.gif
public/media/characters/visitors/<visitor-id>/walk.gif
public/media/characters/visitors/<visitor-id>/sprite-sheet.webp
```

Recommended animation formats:

- animated `.webp` preferred for smaller files
- `.gif` is okay for quick iteration
- transparent background when possible
- clean looping animation
- small dimensions for list/card usage

Recommended character record:

```json
{
  "id": "visitor-prototype-a",
  "name": "Visitor Prototype A",
  "type": "planned-visitor",
  "role": "Resort guest used to test idle, walk, react, and activity behavior.",
  "portrait": "media/characters/visitors/visitor-prototype-a/portrait.webp",
  "idle": "media/characters/visitors/visitor-prototype-a/idle.gif",
  "walk": "media/characters/visitors/visitor-prototype-a/walk.gif",
  "locations": ["front desk", "guest path"],
  "implementationStatus": "planned"
}
```

## 8. Gallery files

Gallery items appear inside the Island Atlas page when `public/data/gallery.json` has records.

Suggested folders:

```text
public/media/gallery/screenshots/
public/media/gallery/renders/
public/media/gallery/blockouts/
public/media/gallery/concepts/
public/media/gallery/diagrams/
public/media/gallery/animations/
public/media/gallery/sprites/
```

Recommended gallery item shape:

```json
{
  "id": "gallery-ferry-dock-blockout-01",
  "title": "Ferry Dock Blockout",
  "category": "blockouts",
  "src": "media/gallery/blockouts/ferry-dock-blockout-01.webp",
  "alt": "Blockout view of the ferry dock area",
  "relatedPoi": "ferry-dock",
  "relatedFeature": "feature-atlas"
}
```

## 9. Video and animation clips

Use short muted clips for GitHub Pages performance.

```text
public/media/video/island-turntable.mp4
public/media/video/ferry-arrival-test.mp4
public/media/video/character-walk-test.mp4
public/media/video/compatibility-lab-demo.mp4
```

## 10. After adding resources

1. Put files in the exact paths above.
2. Update the relevant JSON file in `public/data/`, or use the Operations Desk.
3. Run:

```bash
npm run validate:data
npm run build
```

4. Use the Operations Desk or Git to commit and push.

## 11. Atlas media carousel

The Island Atlas has a horizontal media carousel controlled by:

```text
public/data/gallery.json
```

Use it for project-made screenshots, animated WebP/GIFs, short muted clips, and diagrams you want visitors to see before the full gallery.

Recommended folders:

```text
public/media/gallery/carousel/
public/media/gallery/animations/
public/media/video/
```

Recommended carousel item shapes:

```json
{
  "id": "carousel-moving-pokemon-test",
  "title": "Moving Pokémon Prototype",
  "type": "image",
  "src": "media/gallery/animations/moving-pokemon-test.webp",
  "caption": "Animated WebP showing the early Pokémon movement prototype.",
  "tags": ["gameplay", "prototype"]
}
```

```json
{
  "id": "carousel-island-turntable",
  "title": "Island Turntable",
  "type": "video",
  "src": "media/video/island-turntable.mp4",
  "caption": "Short muted clip of the current island model in motion.",
  "tags": ["3d", "island"]
}
```

Video recommendations:

- Use `.mp4` or `.webm`.
- Keep clips short and muted.
- Prefer 720p or smaller for GitHub Pages performance.
- Avoid autoplaying many heavy videos at once.

## 12. Community issues vs internal bugs

Internal bugs are curated records in:

```text
public/data/bugs.json -> bugs[]
```

Community issues are separate records in:

```text
public/data/bugs.json -> communityIssues[]
```

Use community issues for public GitHub issue links you want to surface on the Operations page. They are not the same as internal bugs.

### Evidence images (bugs and features)

Attach screenshots or diagrams on each bug or feature record. Paths are relative to `public/` (same rule as box art). The public Operations page shows a stacked-photos control that opens a gallery modal with prev/next navigation.

```json
"images": [
  { "path": "media/bugs/transfer-error.webp", "caption": "Error after selecting party" }
]
```

You can also use a plain string path per entry. Add or pick images in **Operations Desk → Bugs** or **Features** (Evidence images section), then **Save bugs** / **Save features**.

Recommended location: `public/media/bugs/` and `public/media/features/` (create folders as needed).

### Feature research dossiers

Features can include a rich `dossier` for the public **Research** / **Details** modal (separate from the card’s quick task checklist). Edit in **Operations Desk → Features → Research dossier**.

```json
"dossier": {
  "overview": "Long-form intro",
  "map": { "poiId": "poi-…", "label": "…", "note": "…", "position": [0, 0.25, 0] },
  "researchMilestones": [{ "label": "…", "done": false }],
  "sections": [
    {
      "id": "gen-iii",
      "title": "Generation III",
      "summary": "Optional section intro",
      "blocks": [
        { "type": "text", "body": "Notes…" },
        { "type": "image", "path": "media/features/contest-ui.webp", "caption": "…" },
        { "type": "video", "path": "media/features/clip.mp4", "poster": "media/features/poster.webp" },
        { "type": "compare", "variant": "fixed", "caption": "…", "items": [{ "path": "…", "label": "Gen 3" }, { "path": "…", "label": "Gen 4" }] },
        { "type": "carousel", "caption": "…", "images": [{ "path": "…", "caption": "…" }, { "path": "…", "caption": "…" }] },
        { "type": "gallery", "caption": "…", "images": [{ "path": "…", "caption": "…" }] },
        { "type": "links", "items": [{ "label": "Bulbapedia", "href": "https://…" }] }
      ]
    }
  ]
}
```

Legacy `images[]` on a feature still works and is merged into the dossier view until you move everything into sections.

**Extending block types (developers):** register in `src/dossier/registry.js` (`registerDossierBlock`) and add a view in `src/components/dossier/blockViews.jsx`. Mirror the type in `tools/admin/public/feature-dossier-editor.js` (`BLOCK_TYPES` + editor HTML).

Recommended community issue shape:

```json
{
  "id": "gh-12",
  "number": 12,
  "title": "Example public issue title",
  "state": "open",
  "summary": "Short curated summary of the report.",
  "labels": ["compatibility", "needs-triage"],
  "url": "https://github.com/OWNER/REPO/issues/12",
  "linkedBug": "BUG-TRANSFER-GEN2-SELF"
}
```

## 13. Ontology behavior contract

The Compatibility page intentionally separates visual hover from layout state:

- Hover must never change generation coordinates.
- Dragging is only active in **Free layout** mode.
- Curated mode is the stable default.
- Route lines are directional; each generation pair renders as two parallel arrows (one per direction).
- Clicking an arrow selects the route and updates the side panel only (no generation focus).
- Clicking a generation circle focuses that generation (game library + route health).
- Self-routes display as `Generation → Resort → Generation`.
- Each visible line has an invisible wider hit path so it is easier to click.

If you later change the ontology code, keep this contract. It prevents hover jitter and accidental layout resets.


## Homepage Carousel

Homepage preview media is configured in `public/data/homepage.json` under the `carousel` array. This is intentionally separate from the Island Atlas carousel in `public/data/gallery.json`, so the homepage can explain the game vision while the Atlas shows research/model evidence.

Recommended paths:

```txt
public/media/home/
  transfer-interface-demo.webp
  pokemon-moving-around.gif
  room-customization-preview.png
  resort-minigame-preview.mp4
```

Recommended formats:

- PNG/WebP for still screenshots or polished mockups.
- GIF, animated WebP, MP4, or WebM for short loops.
- Keep homepage clips short, muted, and lightweight.
- Use different media from the Island Atlas carousel whenever possible.

Example item:

```json
{
  "id": "home-pokemon-moving",
  "title": "Moving Pokémon around",
  "type": "image",
  "src": "media/home/pokemon-moving-around.webp",
  "caption": "Early prototype footage of moving Pokémon through the resort interface.",
  "tags": ["gameplay", "prototype"]
}
```
