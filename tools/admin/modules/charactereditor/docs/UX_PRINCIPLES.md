# UX Principles

SPMK is a production tool, not a demo.

## Primary path first

The main surface should show only the primary action sequence:

1. Import/select sheet.
2. Choose template.
3. Apply template.
4. Save prepared sheet.
5. Assign/populate character.

Advanced tools belong behind an advanced disclosure or a separate manager.

## Explicit state

Users must always know:

- which sheet is active;
- whether it is original or prepared;
- what cell size is being used;
- which template is active;
- which character will be populated;
- whether the sheet/template was already imported into that character.

## Pixel-perfect visuals

Editor canvases must use integer zoom. Sheet fit may be fractional for navigation, but sprite editing should not be fuzzy.

## Duplicate protection

Never silently import the same sheet/template into the same character twice.
The safe default is to block, explain, and offer replace/open options.


## V7 notes

- Visible built-in templates are intentionally limited to **Walk Cycle** and **General Row Cycle**.
- Template options live under Advanced options: prefix, column 0 role, and scale.
- Actions and Generate must not introduce raw label-entry fields. They should select existing labels/actions.
- Generate uses trained actions only. Labels are created by import, template extraction, rename flows, or saved outputs.
- Editor backgrounds are view-only and must not change PNG pixels.
- See `docs/V7_TEMPLATE_ACTION_GENERATE_POLISH.md`.
