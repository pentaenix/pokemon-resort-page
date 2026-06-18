# V7 Template, Action, Generate, and Editor Polish

V7 is a usability-focused release. The main rule is: users should select visual, existing assets whenever possible. Free-text labels are limited to sprite import, sprite rename, and template prefix options.

## Templates

Only two templates are visible by default:

1. **Walk Cycle**
   - For Platinum-style 4-direction sheets.
   - Rows are `down`, `left`, `right`, `up`.
   - Columns are animation frames.
   - Defaults to scaling 64px source cells down to 32px output cells.
   - Defaults to prefix `walk`.
   - Defaults to column 0 as `base_*` plus animation frame source.

2. **General Row Cycle**
   - For run, swim, bike, surf, fishing, and other row-based sheets.
   - Rows are still `down`, `left`, `right`, `up`.
   - Columns are frames.
   - Defaults to no scaling.
   - Defaults to prefix `action`.
   - Defaults to column 0 as an animation frame only.

### Template options

Template options are hidden under **Advanced template options**:

- `prefix`: names animation frames and animations, e.g. `run_left_0` and `run_left`.
- `columnZeroRole`:
  - `base_and_frame`: creates `base_down`, `base_left`, `base_right`, `base_up` from column 0.
  - `animation_only`: column 0 becomes `prefix_direction_0`.
  - `training_only`: column 0 becomes `prefix_direction_0` and is marked with training metadata.
- `scale`:
  - `none`
  - `down2` for 50% nearest-neighbor preparation
  - `up2` for 200% nearest-neighbor preparation

The template preview endpoint accepts the same options as the apply endpoint.

## Actions

The Actions page no longer asks users to type target labels. Actions are created from existing labels with a modal:

- Select input/base label.
- Select target/action label.
- Preview an example character with both labels.
- See ready and incomplete sources.
- Create the action.

Training scans characters that have both the input label and target label, creates missing training pairs, and trains the action.

## Generate

Generate uses trained actions only. It does not create labels or actions.

The page shows:

- Target character.
- Existing trained action.
- Compatible input sprite.
- Training characters used.
- Change map preview when available.
- Save generated preview back to the target character.

## Editor

The editor now has background modes:

- Checker
- Clear/dark neutral
- Light
- Dark

This only affects viewing. PNG transparency and pixel data are unchanged.
