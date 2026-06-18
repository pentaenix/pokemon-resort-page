# v12.5 Animation Preview Fix

Focused patch for character and behavior animation previews.

## Fixes

- Replaced fragile animation frame URL resolution with a shared resolver.
- Animation previews now support frames that reference sprites by `spriteId`, by label, by URL, or by temporary generated URL.
- Character animation cards show a placeholder message instead of an empty checkerboard when a frame is missing.
- The shared animation strip used in behavior and generate previews now uses the same resolver as the canvas player.

## Intent

This release intentionally avoids new features. It is only meant to restore trust in animation previews after v12.
