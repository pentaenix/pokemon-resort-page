# Template System

Templates are reusable rules for turning a sheet into named sprites and animations.

## User flow

1. Import or select a sheet.
2. Choose a template from the dropdown.
3. Read the short step list for that template.
4. Click **Apply template**.
5. Save the prepared sheet.
6. Assign/populate a character.

Applying a template prepares and labels a sheet. Populating a character is a separate action.

## Important fields

- `frameWidth`, `frameHeight`: cell size used for extraction.
- `marginX`, `marginY`, `spacingX`, `spacingY`: grid geometry.
- `baseCells`: direction-to-cell mapping, for example `down: {row: 0, col: 0}`.
- `animations`: animation names mapped to ordered frame cells.
- `defaultPrepareScale`: optional sheet-level scaling before mapping.
- `preparedTemplateId`: optional template to use after preparation.
- `steps`: short UX-facing bullets explaining what the template will do.

## Platinum 64-to-32 template

`tpl_platinum_walk_source_64` is the source template for 64px fan sheets.
It creates a prepared copy at 50% scale and then switches to `tpl_platinum_walk_prepared_32`.

The prepared template:

- uses 32×32 cells;
- uses the left column as `base_down`, `base_left`, `base_right`, and `base_up`;
- creates `walk_down`, `walk_left`, `walk_right`, and `walk_up` animations;
- keeps the original import untouched.

## Agent endpoints

- `GET /api/template/schema`
- `POST /api/template/agent`
- `GET /api/templates`
- `GET /api/templates/{template_id}/plan?sheetId=...`
- `POST /api/templates/{template_id}/apply`

Agent-created templates should be normal templates. They should appear in the same dropdown as built-ins.


## V7 notes

- Visible built-in templates are intentionally limited to **Walk Cycle** and **General Row Cycle**.
- Template options live under Advanced options: prefix, column 0 role, and scale.
- Actions and Generate must not introduce raw label-entry fields. They should select existing labels/actions.
- Generate uses trained actions only. Labels are created by import, template extraction, rename flows, or saved outputs.
- Editor backgrounds are view-only and must not change PNG pixels.
- See `docs/V7_TEMPLATE_ACTION_GENERATE_POLISH.md`.
