# Overworld GLB pipeline — agent handoff notes (NOT public)

> Internal engineering notes for coding agents. **Do not** publish this to the Docs hub
> (`#/docs`) — public articles must not contain agent/LLM wording (see `docs/AGENTS.md`).
> Public-facing version of this material: `#/docs?article=overworld-glb-models`
> (`public/docs/articles/gameplay/overworld-glb-models.json`).
> In-repo C++ spec: `pokemon-resort/docs/gameplay/overworld_glb_models.md`.

## TL;DR / current status

Overworld props go **OBJ+MTL+PNG zip → Operations Desk converter → self-contained GLB →
preview + Map Editor placement + C++ render**. The pipeline is working and verified
against an external reference GLB (ImageToStl). Two fixes were the whole ballgame:

1. **V flip** of UVs in the converter (`v → 1 - v`). OBJ origin is bottom-left, glTF/SDL is
   top-left. Without it the Pokémon Center roof renders **black** (atlas sampled mirrored).
2. **Measured-alpha policy** in the converter: decode each PNG's alpha channel and emit
   `alphaMode: MASK` (cutoff 0.5) **only** when ≥0.5% of texels are actually transparent;
   otherwise `OPAQUE`. This is the difference between a correct banner cutout and a
   **black square**, and between a solid roof and a **torn roof full of holes**.

The reference GLB the user supplied (made by an online tool) had the **correct atlas
mapping** but flattened the banner to OPAQUE → black. Our output now matches its mapping
**and** keeps the banner transparent — i.e. ours is strictly better.

**Later passes added:** (a) in-game **UV-grid clipping** so SDL's UV clamp is a no-op and
*all* props (incl. multi-tile-UV faces) sample perfectly; (b) **unified scene depth sort** so
characters no longer always draw on top of buildings; (c) a **GLB orientation re-bake**
(rotate a wrongly-oriented import — e.g. a truck imported front-down — in 90° steps in the
viewer, baked into the GLB so every consumer agrees); (d) the 2D paint grid now highlights each
prop's **full rotated footprint** with a **roof-snapshot overlay** and a **placement ghost** that
follows the cursor; (e) a **view-only 3D workspace** (`map-3d-view.js`) that renders the terrain
mesh + the actual GLB models under an orbit camera; (f) in-game **two-pass cutout ordering** (fix
"cut-off" banner sections) and a **configurable behind-distance** (`modelBehindBiasTiles`) so a
building hides the character at the doorway instead of letting them draw over the roof.

## Map Editor & orientation (later pass)

- **Orientation re-bake.** The model modal has X/Y/Z 90°-step buttons that live-preview via
  `viewport.setModelOrientation` (three.js, matrix `R = Rz·Ry·Rx`). **Save orientation** POSTs
  to `/api/overworld-models/reorient`, which calls `reorientGlbBuffer` to rotate every
  position+normal, **re-center on X/Z** and **re-seat to y=0** (so re-oriented props stay
  centered on their footprint anchor and sit on the ground), then re-ingests to refresh the
  manifest (new footprint/AABB/hash). Baking — rather than carrying a per-instance rotation —
  keeps a single source of truth: preview, placement, and the C++ game all read the same
  corrected geometry, and the C++ side needs no orientation field. The live preview uses the
  same matrix order as the bake so what you see is what you save.
- **2D footprint + roof overlay + ghost (main paint grid).** `placedModelFootprint` computes the
  full w×d footprint (swapped for 90/270 yaw) centered on the origin tile; every covered cell gets
  `.has-prop-cell`. `refreshPropOverlays` then positions an absolutely-placed **roof snapshot**
  (`roofThumbForModel` → `renderGlbThumbnail` at pitch≈88°, keyed by id+hash) over each footprint
  rect, and a translucent **ghost** (footprint + roof image) that follows the hovered cell while a
  prop is selected for placement. The overlay lives **inside** `#mapPaintGrid` (which is now
  `position:relative`) so it scrolls with the grid; positions are derived from live
  `offsetLeft/Width` + neighbour pitch, so they stay aligned regardless of CSS/zoom. Catalog cards
  still show the front-face snapshot + `w×d · N tiles`.
- **Workspace 2D / 3D toggle** (tool rail, `editor.workspaceView`). 2D = the paint grid above. 3D =
  a *view-only* three.js scene in `map-3d-view.js` (`mountMap3DView`): a height-shaded
  `InstancedMesh` terrain (one box per tile from `terrain.height/special/collision`) + every placed
  prop loaded via `loadGlbScene` and positioned by `position/yawDeg/scale`, under `OrbitControls`
  with hemisphere+key+fill lights. `syncWorkspace3DView` mounts/disposes it each render (render()
  rebuilds the DOM; `loadGlbScene` caches parsed GLBs so re-mount is cheap), and the render loop
  self-disposes if its canvas is detached (tab switch). Painting/placement stays in 2D.
- **Iso preview modal (`drawMapPreviewTopDown`).** The floating "Open 3D" dock still has its angled
  iso vs. top-down 2D snapshot toggle; left-drag pans in its 2D mode. This is independent of the new
  workspace 2D/3D toggle above.

## File map (exact locations)

Conversion (repo `pokemon-resort-page`):

| File | Role | Key lines |
|------|------|-----------|
| `tools/admin/lib/obj-compile.mjs` | Parse OBJ/MTL, interleave verts, **V flip** | `~208-216` (`uv[0], 1 - uv[1]`) |
| `tools/admin/lib/texture-alpha.mjs` | **Decode PNG alpha**, measure transparency | `decodePngAlpha` `~23`, `pngHasMeaningfulTransparency` `~112`, `textureHasAlpha` `~139` |
| `tools/admin/lib/write-glb.mjs` | Emit GLB; alpha policy | cutout decision `~136-146` |
| `tools/admin/lib/mesh-to-glb.mjs` / `obj-to-glb.mjs` / `model-ingest.mjs` | Glue: zip → mesh → GLB → manifest | — |
| `tools/admin/lib/reorient-glb.mjs` | **Bake** X/Y/Z rotation into a GLB (rotate verts+normals, recenter X/Z, re-seat to y=0) | `reorientGlbBuffer` |
| `tools/admin/server.mjs` | `POST /api/overworld-models/reorient {id,rotX,rotY,rotZ}` → re-bake + re-ingest manifest; list now returns `modelHash`/`aabb` | reorient route, `listOverworldModels` |
| `tools/admin/public/model-glb-viewer.js` | three.js preview, studio lighting; `setModelOrientation` (live bake preview), `renderGlbThumbnail` (cards + 2D roof) | `bindGlbWebGLViewport`, `renderGlbThumbnail` |
| `tools/admin/public/model-texture-alpha.js` | Preview material tuning (honours GLB alphaMode verbatim) | `tuneGltfMaterials` |
| `tools/admin/public/map-editor.js` | Prop catalog + placement into `.owmap` `models[]`; **footprint cells + roof overlay + placement ghost** on the paint grid; **workspace 2D/3D toggle**; **orientation controls** in the model modal | `placedModelFootprint`, `refreshPropOverlays`, `syncWorkspace3DView`, `saveModelOrientation`, `applyPreviewOrientation` |
| `tools/admin/public/map-3d-view.js` | **View-only 3D workspace**: InstancedMesh terrain + real GLB props (`loadGlbScene`) + OrbitControls | `mountMap3DView`, `buildTerrain` |

Runtime (repo `pokemon-resort`):

| File | Role | Key lines |
|------|------|-----------|
| `src/gameplay/world3d/data/GlbModelLoader.cpp` | Parse GLB, bake transforms, per-material triangles | `alphaMode→alpha_blend` `~292-295` |
| `include/gameplay/world3d/data/GlbModelLoader.hpp` | `GlbVertex/GlbMaterial/GlbTriangle/GlbMesh` | — |
| `src/gameplay/world3d/rendering/GlbModelRenderer.cpp` | Upload textures, transform, project, **UV-grid clip**, **two-pass (opaque→cutout) sort**, draw; `anchorDepth` for scene sort | `clipAxis`/`emitPiece`, `DrawTri.cutout`, `anchorDepth` |
| `src/gameplay/world3d/data/SceneMetadataParser.cpp` | Read `models[]` (`glb` then fallback `mesh`); load `config/gameplay/world3d/render.json` → `model_behind_bias_tiles` | render.json block |
| `config/gameplay/world3d/render.json` | `occlusion.modelBehindBiasTiles` (how far forward a building occludes the character) | — |
| `include/gameplay/world3d/Overworld3DConfig.hpp` | `ModelPlacementConfig {id, glb_path, x,y,z, yaw_deg, scale}`; `SceneConfig.model_behind_bias_tiles` | — |
| `src/ui/Overworld3DTestScreen.cpp` | Loads `GlbMesh` per placement, unified depth sort with per-model behind-bias, renders each frame | model_depth_bias |

## How the alpha decision is made (do not regress this)

`texture-alpha.mjs::pngHasMeaningfulTransparency`:
- Inflates IDAT, **un-filters** scanlines (None/Sub/Up/Average/Paeth), extracts the alpha
  byte per pixel. Handles 8-bit non-interlaced color type 6 (RGBA) and 4 (gray+alpha).
- Color types without alpha (0/2/3) → only transparent if a `tRNS` chunk is present.
- Returns true if `transparent_pixels / total >= minFraction` (default 0.5%) using
  `alpha < cutoff` (cutoff default 0.5 → 128/255).
- If it can't fully decode (weird bit depth/interlace) it falls back to the conservative
  channel check `pngBufferHasAlpha`.

`write-glb.mjs` then sets `alphaMode: 'MASK'` + `alphaCutoff: 0.5` when true, else `OPAQUE`.
Materials are always `doubleSided: true`.

**Worked example (Pokémon Center):** `h_kage` 100% opaque → OPAQUE; `pc_1` 100% opaque →
OPAQUE; `light_a` ~33% transparent → MASK; `pc_2` ~33% transparent → MASK. `pc_2` is shared
by the orange roof (opaque texels, kept) and the banner (transparent texels, cut).

## Pitfalls / things that confused me (so you don't repeat them)

1. **Black preview ≠ texture bug.** The first "black model" was just missing lights in the
   three.js scene (`MeshStandardMaterial` needs IBL/environment). Fixed via
   `RoomEnvironment` + ambient/directional, sRGB output, `NoToneMapping`. Check lighting
   before suspecting the GLB.
2. **I chased the wrong fix twice.** First I made everything `MASK` from "has alpha
   channel" → torn roof. Then I overcorrected to **force everything OPAQUE** → black
   banner. Neither was right. The actual bug for the *black roof* was the **missing V
   flip**; once flipped, MASK is safe because the roof samples opaque texels. Lesson:
   separate the **UV-orientation** problem from the **alpha** problem — they present
   similarly (wrong-looking textures) but are independent.
3. **Decoder off-by-stride bug.** My first `decodePngAlpha` forgot to advance the row
   pointer by `stride` after each scanline, so it re-read the filter region and flagged
   *every* texture as transparent. If transparency detection looks wrong, sanity-check the
   decoder against a raw alpha histogram first (clusters should be at 0 and 255 for DS).
4. **The reference GLB has 3× the triangles** (549 vs our 183) and used `BLEND` for the
   shadow. Don't treat the reference as ground truth for *everything* — only its **atlas
   mapping** (sampled colors on big faces) and the fact that it got the banner wrong.
5. **Server doesn't hot-reload.** Editing `tools/admin/lib/*.mjs` requires restarting
   `npm run admin`. The on-disk GLB previews fine without a restart, but UI re-conversions
   use the stale module until restart. This wasted a debugging cycle.
6. **Unicode MTL filename.** The source zip references `Pokémon Center.mtl` but stores a
   differently-normalized filename; `asset-resolve.mjs` matches it and emits a warning.
   That warning is benign.

## How to verify a conversion (repeatable)

Use a throwaway Node script (the ones I used lived in `/tmp`, not committed):
- Run `buildObjMeshFromUpload` → `exportMeshToGlb`, then print each texture's
  `textureHasAlpha` result.
- Decode each texture's alpha and print a histogram (% at a==0, a<128, a==255). DS = ~1-bit.
- For both the reference GLB and ours, iterate **all** meshes/primitives (per-primitive
  accessors — do not assume one shared accessor), find the biggest faces by area, and
  sample the base-color texel at the face's centroid UV. **Equal colors on the big faces
  ⇒ atlas/V orientation is correct.**

If you need this again, re-create the comparison script; it is intentionally not part of
the committed pipeline.

## C++ side — what to check if an in-game model looks wrong

The C++ renderer is `SDL_RenderGeometry`-based (CPU projection, no GPU shader, **no depth
buffer**, **no real alpha test**). Implications and where to act:

0. **SDL_RenderGeometry CLAMPS texcoords to [0,1] — it does NOT honour REPEAT wrap.**
   This was the "black stain instead of the model" bug. DS UVs routinely run outside
   [0,1] (e.g. the Pokémon Center roof at `v≈1.15` that must wrap to `0.15`), and some faces
   on other props (`Docked_Sailboat`, `aqua_mn4`) **span more than one tile in UV**. three.js
   honours the GLB sampler's REPEAT wrap so the browser preview is correct, but SDL clamps to
   the texture edge → wrong texels (black blobs, smeared seams).
   **Current fix — UV-grid clipping (`GlbModelRenderer.cpp`, `clipAxis`/`emitPiece`).** We
   emulate REPEAT exactly: each triangle is clipped against the integer UV grid (Sutherland-
   Hodgman per cell it overlaps), and every resulting piece is re-based into `[0,1)` by
   subtracting its cell's integer offset. Each piece then lives inside a single texture tile so
   the SDL clamp is a **no-op**. Verified offline: after subdivision, 0 emitted coords fall
   outside `[0,1)` for all four shipped models (pc/truck unchanged at 183/134 tris; sailboat
   137→152, aqua 613→684). UV→screen is affine within a triangle, so clipping interpolates
   `sx/sy/depth/u/v` linearly — consistent with SDL's affine texturing.
   - The single-cell fast path (the vast majority of tris) just re-bases by `floor` and skips
     clipping. **Do not** revert to the old "subtract `floor(min U/V)` of the whole triangle"
     trick: it can't fix span>1 faces and it shifts slightly-negative UVs to the wrong edge.
   - `OverworldMapRenderer` solves the same clamp problem for terrain via its `wrapUv()` helper.
     If you add a new SDL geometry path that samples textured meshes, you MUST wrap/clip there too.
   (Diagnosed by simulating projection offline: nothing was culled and the roof drew on top, so
   it was a sampling bug, not depth.)
1. **Cutout relies on blend + binary alpha.** SDL has no `alphaTest`/`alphaCutoff`. We map
   both `MASK` and `BLEND` → `SDL_BLENDMODE_BLEND` (`GlbModelLoader.cpp ~292`) and rely on
   DS textures being ~1-bit alpha so the blended edge is effectively a hard cutout. **If a
   future model has soft/partial alpha**, expect haloing/edge fringing. Options, in order:
   - Pre-threshold the alpha to 0/255 at load (cleanest cutout) — add to
     `GlbModelRenderer` texture upload, gate on `alpha_blend && material_is_mask`.
   - Or carry a real `alpha_mode` enum (OPAQUE/MASK/BLEND) + `alpha_cutoff` from the loader
     instead of the single `alpha_blend` bool, and discard per-pixel during a software
     rasterize. This is a bigger change; only do it if true BLEND props appear.
2. **Sorting artifacts & scene render order.** Two levels of sorting, both painter-style
   (no depth buffer):
   - *Within a model (two-pass cutout order)*: pieces are sorted so **all opaque triangles draw
     first** (back-to-front), then **all cutout (MASK/BLEND) triangles draw last** (back-to-front).
     `DrawTri.cutout` is set from `GlbMaterial.alpha_blend`. This fixed the "Pokémon Center banner
     has cut-off sections" bug: a cutout banner triangle nearly **coplanar** with the opaque wall
     behind it could tie/flip on centroid depth and let the wall paint over it. Forcing cutout last
     guarantees the banner composites over the body. Don't go back to a single centroid-only sort
     of all tris together. Intersecting/large transparent quads within the cutout group can still
     sort wrong; fix is finer-grained sorting or splitting the mesh — not the converter.
   - *Between objects (the "character always on top of the building" bug)*:
     `Overworld3DTestScreen::render` no longer draws all models first and characters last.
     It builds a unified list of dynamic occluders — each placed model + the player + the
     follower — keyed by the **camera depth of its world ground anchor**
     (`GlbModelRenderer::anchorDepth` uses the placement origin; characters use
     `worldToScreen(position)`), `stable_sort`s far→near, and draws in that order. So a prop
     the player is standing **behind** now correctly occludes the sprite. Tiebreak order is
     models < player < follower. Objects don't interpenetrate (the player can't stand inside a
     building), so per-object ordering is correct; if you ever need a sprite to be partially
     occluded by a single prop, that needs a real depth buffer / software rasterizer, not this.
   - *Behind-distance tuning.* Each model's anchor depth is biased toward the camera by
     `SceneConfig.model_behind_bias_tiles * tile_size` (`config/gameplay/world3d/render.json` →
     `occlusion.modelBehindBiasTiles`, default `1.0`). Because the anchor is the footprint **center**,
     a building would otherwise only occlude the player once they pass its center, so at the door the
     character drew over the roof. Bias makes the building occlude ~N tiles sooner. Larger = sooner /
     further forward. Tune here, not in the sort code.
3. **Texture filtering.** We force `SDL_ScaleModeNearest` (`~40`). Keep it — DS pixel art
   must not bilinear-blur, and blurring also softens MASK edges into halos.
4. **Self-contained GLB only.** The loader **rejects external buffers/URIs**. If a model
   loads in the browser but not in-game, confirm it's a single-BIN-chunk GLB (our converter
   always produces that; third-party GLBs may not).
5. **Path resolution.** `SceneMetadataParser.cpp` reads `models[].glb` (falls back to
   `mesh` for older metadata) and resolves relative to project root. A missing in-game prop
   that exists on disk is usually a path/relative-root mismatch here.
6. **Transform order** is scale → yaw about +Y → translate. If placement looks rotated or
   offset vs the editor, check this order and that `yawDeg`/`scale`/`position` map 1:1 from
   the `.owmap` entry.

## Known open items / decisions left to a future pass

- **Shadow material `h_kage`.** It's 100% opaque (a black quad) so we export OPAQUE; the
  reference used BLEND. Visually it reads as a shadow under the building, but if you want a
  soft/translucent shadow you'd need a genuinely semi-transparent shadow texture (DS rip
  doesn't provide one) or special-case shadow materials to `BLEND` with reduced opacity.
- **Library swap (`obj2gltf`) considered and declined.** Our converter now matches the
  reference's mapping and handles alpha better, and it's tailored (nearest/REPEAT samplers,
  footprint computation, per-material embedded textures). Swapping to `obj2gltf` would add
  risk for no current benefit. Revisit only if we need broader OBJ feature coverage
  (smoothing groups, PBR maps, etc.). Decided to use Node's built-in `zlib` for PNG alpha
  decode rather than add a dependency.
- **Stale reference model on disk.** `assets/overworld/models/ImageToStl_com_..._Pokemon_Center__1_/`
  is the raw reference import (black banner). It's kept for comparison; delete or re-import
  the zip if it gets placed by mistake. The correct model is `pc_1_png/`.

## After editing cited source, keep docs in sync

If you touch any file cited in `code` blocks of the public article, bump `updatedAt` on the
`overworld-glb-models` card in `public/data/docs.json` and run `npm run validate:data` from
`pokemon-resort-page/`. Update `pokemon-resort/docs/gameplay/overworld_glb_models.md` and
this file in the same change.
