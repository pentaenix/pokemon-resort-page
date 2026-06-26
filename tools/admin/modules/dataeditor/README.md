# Data Editor

Data Editor is a local-only Game Engine module for editing JSON config files from `../pokemon-resort/config`.

It renders every JSON file safely, supports modifier files for nicer controls, preserves `_comment` / `_description` metadata as helper text, and saves only real JSON values.

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
