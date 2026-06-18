# Animation Model

Animations are records that reference sprite IDs. They should not duplicate image data.

A character can have:

- base sprites like `base_down`;
- extra sprites like `walk_down_01`;
- animations like `walk_down` that reference both base and extra sprites.

For the Platinum movement template, the left-column base cells are reused as the first frame of each walking animation. This avoids duplicate copies of the same visual cell.

Example:

```json
{
  "name": "walk_down",
  "frames": [
    {"label": "base_down", "duration": 120},
    {"label": "walk_down_01", "duration": 120},
    {"label": "walk_down_02", "duration": 120},
    {"label": "walk_down_03", "duration": 120}
  ]
}
```

All animation playback must use nearest-neighbor rendering.
