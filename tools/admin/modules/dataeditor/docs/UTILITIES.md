# Data Editor Inline Utilities

Inline utilities are helper blocks that render inside a config editor modal. They are not JSON fields, and they should not silently write values into the config. Their job is to help a designer calculate, preview, copy, or generate values that can then be pasted into real fields.

Use inline utilities when a normal field widget is not enough, for example:

- color harmony selection
- layout rulers and previews
- sprite shadow helpers
- animation timing calculators
- palette/token comparison tools
- generated value snippets that should be copied into real fields

## Where utilities live

Utilities are declared from modifier JSON files in:

```text
tools/admin/modules/dataeditor/modifiers/
```

The older `tools/admin/modules/dataeditor/utilities/` folder still exists as a place to keep shared presets or notes, but the actual rendered block should be referenced by the modifier for the config that needs it.

Example modifier:

```json
{
  "file": "design.json",
  "matches": ["design.json", "**/design.json"],
  "groups": [
    { "id": "tokens", "label": "Tokens", "paths": ["tokens"] }
  ],
  "utilities": [
    {
      "id": "design-color-harmony",
      "type": "color-harmony",
      "afterGroup": "tokens",
      "title": "Color Harmony Tool",
      "description": "Pick related colors, copy the selected hex, then paste it into a token or color field.",
      "defaultColor": "#6D5DFC",
      "mode": "complementary"
    }
  ]
}
```

`afterGroup` is the important placement value. It means: render this utility after the group whose `id` is `tokens`.

## Utility contract

Every utility object should use these common fields:

```json
{
  "id": "stable-unique-id",
  "type": "color-harmony",
  "afterGroup": "tokens",
  "title": "Human readable title",
  "description": "What this tool helps the user do.",
  "order": 20
}
```

Guidelines:

- `id` must be stable because user interaction state is keyed by it.
- `type` decides which renderer is used.
- `afterGroup` controls where it appears.
- `title` and `description` should explain the tool in plain language.
- `order` is optional and controls order when several tools share the same group.

## Available utility types

### `color-harmony`

Renders an inline color wheel with movable harmony knobs.

Supported config:

```json
{
  "id": "design-color-harmony",
  "type": "color-harmony",
  "afterGroup": "tokens",
  "title": "Color Harmony Tool",
  "description": "Pick related colors and copy the selected hex.",
  "defaultColor": "#6D5DFC",
  "mode": "complementary"
}
```

Supported modes:

- `complementary`
- `analogous`
- `split`
- `triad`
- `tetradic`
- `monochrome`

Behavior:

- Drag the base knob to rotate preset harmonies.
- Drag a non-base knob to switch to a custom harmony.
- Paste a hex into the selected hex field to move the selected knob to that hue.
- Copy buttons copy hex values to the clipboard.
- The tool never edits JSON directly.

## Adding a new utility renderer

Add the renderer in `editor.js` near `utilityBlockHtml()`:

```js
function myUtilityHtml(utility, current, esc) {
  return `<section class="data-inline-tool">...</section>`;
}

function utilityBlockHtml(utility, current, esc) {
  const type = utility.type || utility.kind || utility.utility || '';
  if (type === 'my-tool') return myUtilityHtml(utility, current, esc);
  if (['color-harmony', 'color-wheel'].includes(type)) return colorHarmonyToolHtml(utility, current, esc);
  return `<section class="data-inline-tool">...</section>`;
}
```

Then bind interactions in `bindEditor()` using delegated selectors or selectors that include the utility `id`.

Rules for future AI/code changes:

1. Do not invent fields that do not exist in the target config.
2. Do not make utilities save directly unless the user explicitly asks for that behavior.
3. Preserve scroll position when a utility causes a re-render.
4. Prefer live DOM updates for drag interactions; do not re-render the whole editor on every pointer move.
5. Keep the utility state under `state.dataEditor.utilityState[id]` or the existing `de.utilityState[id]` pattern.
6. Keep all generated values copyable.
7. Document the utility type, modifier schema, and interaction rules in this file.

## Testing checklist

When adding or changing an inline utility:

- Open a config that uses the utility.
- Scroll down before interacting with it.
- Drag controls and confirm the page does not jump.
- Paste a value and confirm the visual representation updates.
- Copy a generated value and paste it into a real field.
- Close the config modal and confirm scroll is preserved.
- Restart `npm run admin` to make sure module loading does not rely on stale state.


## Color tool coordinate rule

The Color Harmony Tool's rendered wheel starts red on the left edge. Any future color utility that places knobs on this wheel should use the shared `angleToWheelPoint()` and `hueFromWheelEvent()` helpers instead of inventing separate angle math. That keeps pasted hex values, dragged knobs, and the conic-gradient visual in sync.
