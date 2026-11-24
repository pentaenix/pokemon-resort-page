# Data Editor

Data Editor is a local-only Game Engine module for editing JSON config files from `../pokemon-resort/config`.

It renders every JSON file safely, supports modifier files for nicer controls, preserves `_comment` / `_description` metadata as helper text, and saves only real JSON values.

## Start cinematic scene

Open `cinematic/start_scene.json` in Data Editor to use the scene-specific
controls. Defaults select a boat and time of day from the current catalogs.
Environment cards expose separate ocean and sky transforms; numeric X/Y/Z
inputs preserve arrays as numbers. Boat cards include height, wake playback,
and bobbing. Flying Pokemon cards include placement, velocity, and animation
timing. Exporter material filters and fallback camera settings are available
through **Show advanced fields**. Save uses the existing backup workflow and
applies changes automatically while the cinematic is open. Normal scene
tuning preserves the current camera and selection. Editing the starting
camera pose or default selections applies those explicit changes.

`sceneCenter` is the shared origin for the scene. Boat and flying Pokemon
positions use centered models; their Y coordinate controls height. There is
no separate height override. Each environment also has a **Sky model** choice
for the original ocean-set sky or the exported daytime `0409` dome. Selecting
a sky does not change the ocean model.

**Playback music** has a **Preview song** dropdown populated from
`audio.music.tracks`, plus a relative music volume. Save, then press P in the
game to restart the selected song alongside the shot sequence. Songs use Music
Volume; boat ambience and Wailord splashes use SFX Volume. The song library is
collapsed by default and exposes labels and file paths for future additions.

Browser regression check (with the local admin server running):

```bash
ADMIN_TEST_URL=http://127.0.0.1:9477 node tools/admin/modules/dataeditor/cinematic-editor.test.mjs
```

The test intercepts the save request and never changes the game config.

## Inline tools

Modifiers can add inline tools under an existing group. These are not config fields and they do not write to JSON by themselves. They are helper blocks for choosing values that you can copy and paste into real fields.

The included `design.json` modifier places a **Color Harmony Tool** under the `tokens` group. It provides a Photoshop-style color wheel with draggable harmony knobs, selected-hex copy, and existing-config color copy.

## Install future patches

After v4 or later is installed, use:

```bash
./patch ../pokemon-resort-page-data-editor-v11.zip
```

## Developer docs

- [`docs/MODIFIERS.md`](docs/MODIFIERS.md): field customization schema.
- [`docs/UTILITIES.md`](docs/UTILITIES.md): how to add inline utility blocks like the Color Harmony Tool.


## v12 color wheel fix

The Color Harmony Tool now maps HSL hue 0 to the red area on the left side of the rendered wheel. Swatches and the selected color chip are directly clickable copy targets and show `Color copied` feedback.
