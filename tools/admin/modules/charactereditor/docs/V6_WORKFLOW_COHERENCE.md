# v6 Workflow Coherence

v6 makes the app easier to navigate by reinforcing ownership and provenance.

## Core ownership model

- Characters own sprites, animations, attached sheets, and generated outputs saved to the character.
- Sheets are grouped as families with versions instead of being shown as unrelated duplicates.
- Actions are learned transformations defined by an input label and target label.
- Generate uses existing trained labels only. New labels belong in Actions.
- Editor starts from a character and then a sprite, so users know what they are editing.

## Sheet families and versions

Every imported sheet gets a `familyId`, `versionName`, and `versionRole`.

Prepared sheets created from a template reuse the original sheet family id. The Sheets page groups these versions together:

- Original
- Prepared with Platinum prepared walk sheet
- Edited or future prepared copies

Opening a sheet family shows a version picker before entering the mapper.

## Character animation creation

Characters have an **Add animation** button. The modal lets users choose sprites already owned by the character, build a timeline, set frame durations, and save a playable animation.

Endpoint: `POST /api/character/{cid}/animation`

## Actions

Actions now show:

- Input label
- Target label
- Ready training source count
- Incomplete source count
- Learned change map when trained

The right inspector previews one example and lists ready/incomplete training sources.

## Generate

Generate now shows:

- Target character
- Input sprite
- Existing learned action dropdown
- Training characters that will be used
- Change map preview

It no longer creates labels. A generated preview can be saved back to the target character.

## Editor

The editor now has:

- Character selector
- Sprite selector scoped to the character, plus generated outputs
- Visible Undo and Redo buttons
- Clearer Pencil, Eraser, Picker, and Bucket buttons
- Pixel-perfect integer zoom and smoothing disabled
