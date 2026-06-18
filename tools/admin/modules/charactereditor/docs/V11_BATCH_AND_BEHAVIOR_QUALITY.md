# V11 — Batch Import and Behavior Quality

V11 focuses on production-scale character intake and better behavior training control.

## Batch character creation

Use **Characters → Batch create** to drop many same-format sheets at once. The batch modal:

- creates one character per sheet
- names each character from the sheet filename
- applies the selected template/options
- populates sprites and animations
- shows a rename table after import

This is intended for projects with many characters that all start from the same walk sheet format.

## Behavior actions are self-contained

Behavior training no longer creates separate single-frame action cards for every behavior frame. A behavior stores its own internal learned frame transforms under `learnedFrames`.

The Actions page stays organized:

- single actions contain one input → one target
- behaviors contain directions × frames as one project asset

## Conservative learned overlays

V11 changes the training engine from a literal first-example overlay to a conservative learned mask:

- stable shared pixels become an overlay
- high-variation pixels become uncertain
- uncertain pixels are not automatically pasted onto the target

This helps prevent hats, faces, and other identity details from a training character being copied onto a different target character.

## Learned pattern editing

Behavior detail modals expose learned-frame maps. Clicking a map opens a simple mask editor that can erase rectangular regions from the learned overlay. Use this when a recurring character detail, such as a hat, leaks into the learned pattern.

## Behavior generation preview

Generate → Behavior now supports temporary preview before saving. The page shows:

- target bases
- training source material
- generated preview frames
- save behavior
- export sheet

Preview frames are not committed until the behavior is saved.

## Generated behavior management

Character pages now include a Generated behaviors section. Each behavior can be:

- previewed
- retried from Generate
- exported as a sheet
- removed as a package

Removing a generated behavior deletes its generated sprites and animations together, so users do not need to clean up frame-by-frame.

## Export

Behavior sheet export packs generated `prefix_direction_index` sprites into the same row-cycle layout used by the training characters, with nearest-neighbor output scaling.
