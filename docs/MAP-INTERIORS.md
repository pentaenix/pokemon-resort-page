# Black 2 interiors in Map Studio

Use the single **Interior tools** command in the Map Studio toolbar:

- **Create blank interior** starts a 16×12 isolated room with a subdued checker floor, trimmed back and side walls, and a low front cutaway wall. It is immediately visible in 2D and 3D, resizes with the normal map-size controls, and remains underneath later RTPKS decoration.
- **Import complete interior…** expects the matching RAE `.interior.json` and `.glb`. It compiles the shell, creates an isolated black interior OWMAP, imports collision/heights, adds `inside_entry`, and creates the directional off-grid exit trigger.
- **Import reusable kit ZIP…** accepts RAE's new `interior-tile-kit.zip`. Choose or create an RTPKS package first. Map Studio validates every nested `.tile` bundle, creates dedicated **Interior Floors**, **Interior Walls**, **Interior Entrances**, **Interior Stairs**, **Interior Shadows**, and **Interior Details** tabs as needed, then imports every tile into its role tab. Large kits are uploaded in safe batches rather than stopping at the normal 128-tile request limit. Floor, wall, entrance, stair, window, and shadow roles remain searchable through their `interior.<role>` tags. The project stores each tile's destination tab, source provenance, source cell, and stable `resortTileId` under `interiorKits`.
- Existing `rae.gen5InteriorKit` archives remain supported as legacy 3D prop imports. They are compatibility assets, not the preferred authoring format.

An imported whole interior is deliberately separated in Project & maps; it is connected through door links, not by snapping it to exterior world chunks. Interior maps clear to opaque black and do not render exterior spaces.

For source models with stacked floors, Map Studio uses RAE's highest sampled surface for collision and reports the ambiguity. Split lower and upper floors into separate maps before treating both as playable.

Build a tiled interior as a normal OWMAP RTPKS tile-layer map and leave `interior.shellModelId` empty. The game renders the procedural default room first and imported floor and wall tiles through the production RTPKS renderer on top. `interior.openings` removes matching default wall segments. Set `interior.defaultRoom.enabled` to `false` to hide the foundation. A non-empty shell ID continues to select the legacy complete-room model path and suppresses procedural geometry.
