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

## Dynamic dropdown options

`select` and `dropdown` widgets can populate their `options` from the currently opened JSON file or from another config file. The server resolves these before the modal renders, so the frontend still receives normal static `options`.

From the current file:

```json
{
  "fields": {
    "activeScene": {
      "widget": "select",
      "optionsFrom": {
        "path": "scenes",
        "value": "id",
        "label": "id"
      }
    }
  }
}
```

From another config file:

```json
{
  "patterns": {
    "scenes.*.activeFloor": {
      "widget": "select",
      "optionsFromFile": {
        "file": "gameplay/pokemon_attend/floors.json",
        "path": "floors",
        "keys": true,
        "include": [{ "value": "none", "label": "None" }]
      }
    }
  }
}
```

For arrays, use `value` and `label` paths inside each item. For objects, `keys: true` turns object keys into option values. Use `include` or `append` for fixed choices such as `none`.

From an asset folder:

```json
{
  "patterns": {
    "walls.*.texture": {
      "widget": "select",
      "optionsFromAssets": {
        "directory": "assets/pokemon_attend/wall_textures",
        "extensions": [".png", ".jpg", ".webp"],
        "recursive": true
      }
    }
  }
}
```

Asset directories resolve from the game project root inferred from the configured `pokemon-resort/config` directory. Option values are written as game-relative asset paths such as `assets/pokemon_attend/wall_textures/grass.png`.

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

## Collapsed groups

Groups may opt into being collapsed when the editor opens:

```json
{
  "groups": [
    {
      "id": "advanced",
      "label": "Advanced camera",
      "collapsedDefault": true
    }
  ]
}
```

The section still opens automatically while the user searches. Use this for rare/debug-heavy controls such as manual camera fallback, clipping, raw button styling, or exporter dictionaries.

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
