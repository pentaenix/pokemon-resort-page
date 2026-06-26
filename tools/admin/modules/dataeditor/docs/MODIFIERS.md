# Data Editor Modifiers

Modifiers live in `tools/admin/modules/dataeditor/modifiers/` and customize how an existing config JSON is presented.

This editor is intentionally conservative: modifiers should describe fields that actually exist in the target config file. Do not invent paths.

## JSON comment metadata

Some game config files include helper fields such as:

```json
{
  "_blockedStepComment": "Controls feedback when the player holds movement into a blocked wall.",
  "blockedStep": {
    "sfxRepeatSeconds": 0.54
  }
}
```

Fields whose names start with `_` and end with `Comment`, `Comments`, `Description`, `Descriptions`, `Note`, or `Notes` are treated as metadata. They are hidden from the Editor and displayed as helper text on the field or object they describe.

Supported forms include:

```json
{
  "_turningComment": "Explains the turning block beside it.",
  "turning": { "stepDelaySeconds": 0 },

  "movement": {
    "_comment": "Explains all fields in this object.",
    "speed": 64
  },

  "_comments": {
    "walk": "Explains the walk object.",
    "run.unitsPerSecond": "Explains a full field path."
  }
}
```

These metadata fields remain in the saved JSON unchanged unless the user explicitly edits JSON Text mode.

## Supported widgets

- `text`
- `textarea`
- `number`
- `slider`
- `checkbox`
- `select` / `dropdown`
- `list` / `key-list`
- `asset` / `path`
- `color` / `color-wheel`
- `json`
- `mask-grid` / `pixel-grid` for real matrix/string/boolean mask fields only

## Safe mask-grid usage

Only use `mask-grid` when the JSON field itself is an array, string rows, or matrix that represents a real black/white mask. Example:

```json
{
  "fields": {
    "shadow.mask": {
      "widget": "mask-grid",
      "rows": 8,
      "columns": 16,
      "format": "strings",
      "onChar": "#",
      "offChar": "."
    }
  }
}
```

Do not use this for asset paths such as `assets.logo_main_mask`; that is a file path field.

## UI preview usage

A modifier can add a `preview` block with real paths:

```json
{
  "preview": {
    "enabled": true,
    "defaultWidth": 1280,
    "defaultHeight": 800,
    "elements": [
      { "label": "Prompt", "centerX": "prompt.center_x", "y": "prompt.baseline_y", "defaultWidth": 420, "defaultHeight": 60, "anchor": "bottom_center" }
    ]
  }
}
```

Supported element inputs: `x`, `y`, `centerX`, `centerY`, `xRatio`, `yRatio`, `centerXRatio`, `centerYRatio`, `bottomOffset`, `width`, `height`, `defaultWidth`, `defaultHeight`, and `anchor`.

## Inline tools

Modifier files can place helper blocks after a field group. These blocks are not editable JSON fields and they do not save anything by themselves. They are meant for utilities like choosing colors, previewing layouts, or generating values that the user can copy and paste into real fields.

Tools still live in the `utilities/` folder for backwards compatibility with older patches, but the UI should call them **inline tools**.

Example:

```json
{
  "utilities": [
    {
      "id": "design-color-workshop",
      "utility": "color-workshop",
      "type": "color-harmony",
      "afterGroup": "tokens",
      "title": "Color Harmony Tool",
      "description": "Choose complementary and related colors, copy the selected hex, then paste it into a real field."
    }
  ]
}
```

The included Color Harmony Tool renders inside the current config modal. It has draggable harmony knobs, presets for complementary/analogous/split/triad/tetradic/monochrome colors, and copy buttons for selected colors. It never writes to JSON until the copied value is pasted into a real editable field.

## More utility documentation

See [`UTILITIES.md`](UTILITIES.md) for the full inline utility authoring contract, interaction rules, and checklist for future utility work.
