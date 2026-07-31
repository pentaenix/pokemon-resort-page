# Black 2 interiors in Map Studio

Use the single **Interior tools** command in the Map Studio toolbar:

- **Import complete interior…** expects the matching RAE `.interior.json` and `.glb`. It compiles the shell, creates an isolated black interior OWMAP, imports collision/heights, adds `inside_entry`, and creates the directional off-grid exit trigger.
- **Import reusable kit ZIP…** expects RAE's `interior-kit.zip`. The server validates the manifest and imports every exact floor, wall, entrance, stair, window, or shadow part into **3D props**. The project stores source provenance, intended placement, footprint, and collision hint under `interiorKits`.

An imported whole interior is deliberately separated in Project & maps; it is connected through door links, not by snapping it to exterior world chunks. Interior maps clear to opaque black and do not render exterior spaces.

For source models with stacked floors, Map Studio uses RAE's highest sampled surface for collision and reports the ambiguity. Split lower and upper floors into separate maps before treating both as playable.

