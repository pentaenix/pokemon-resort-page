# API Summary

## Project

- `GET /api/project` — load project metadata.
- `POST /api/project` — update project metadata.
- `GET /api/export/project` — download workspace backup zip.

## Characters

- `POST /api/character` — create character.
- `DELETE /api/character/{cid}` — remove character record.

## Uploads and sheets

- `POST /api/upload/sprite` — upload a sprite to a character.
- `POST /api/upload/sheet` — upload a sheet.
- `PATCH /api/sheet/{sid}` — save sheet settings, assignment, template, mappings.
- `POST /api/sheet/{sid}/prepare-platinum` — create saved 32px Platinum-prepared sheet copy.
- `POST /api/sheet/{sid}/extract-cell` — extract one cell to a character sprite.
- `POST /api/sheet/{sid}/extract-template` — populate bases and animations from a template.
- `POST /api/scale` — create a nearest-neighbor scaled copy of a sprite or sheet.

## Templates

- `GET /api/template/schema` — schema for agent-created templates.
- `POST /api/template/agent` — create/update a template from a model or coding agent.
- `POST /api/template` — create/update a template from the app.

## Transform engine

- `POST /api/training-pair` — add a base/action pair.
- `POST /api/train/{label}` — train a deterministic pixel-diff action.
- `POST /api/generate` — apply a trained action to a target sprite.
- `POST /api/save-edited` — save pixel editor output as a generated PNG.

## v5 template endpoints

### GET `/api/templates`
Returns all built-in and user/agent-created templates.

### GET `/api/templates/{template_id}/plan?sheetId={sheet_id}`
Returns a non-destructive preview of what the template will do for a sheet: output size, cell size, base labels, animation names, sprite count, and animation count.

### POST `/api/templates/{template_id}/apply`
Body:

```json
{"sheetId":"..."}
```

Applies the template. If the template has `defaultPrepareScale`, the endpoint creates a prepared sheet copy and leaves the original untouched. Otherwise it saves the template/grid settings onto the existing sheet.

### POST `/api/sheet/{sheet_id}/extract-template`
Important v5 body fields:

```json
{
  "characterId": "...",
  "templateId": "...",
  "settings": {"frameWidth":32,"frameHeight":32},
  "duplicateMode": "block"
}
```

`duplicateMode` values:

- `block`: safe default; returns HTTP 409 if this sheet/template already populated the character.
- `replace`: removes previous sprites/animations created by this sheet/template and rebuilds them.
- `version`: reserved for future versioned imports.

## v6 endpoints

### `POST /api/character/{cid}/animation`
Creates a manual animation from sprites already owned by the character.

Body:

```json
{
  "name": "walk_down",
  "loop": true,
  "frames": [
    {"spriteId": "...", "duration": 120}
  ]
}
```

### `POST /api/generated/{gid}/save-to-character`
Copies a generated preview into a character as a normal sprite.

Body:

```json
{
  "characterId": "...",
  "label": "fishing_right",
  "direction": "right",
  "replaceExisting": false
}
```

### `POST /api/actions/define`
Creates or updates an action definition.

Body:

```json
{
  "label": "fishing_right",
  "inputLabel": "base_right",
  "targetLabel": "fishing_right"
}
```

### `GET /api/actions/{label}/sources`
Returns characters that are ready or incomplete for training a label.

Response includes `ready` and `incomplete` arrays.


## V7 notes

- Visible built-in templates are intentionally limited to **Walk Cycle** and **General Row Cycle**.
- Template options live under Advanced options: prefix, column 0 role, and scale.
- Actions and Generate must not introduce raw label-entry fields. They should select existing labels/actions.
- Generate uses trained actions only. Labels are created by import, template extraction, rename flows, or saved outputs.
- Editor backgrounds are view-only and must not change PNG pixels.
- See `docs/V7_TEMPLATE_ACTION_GENERATE_POLISH.md`.

## V9 endpoints

### Delete a sheet version

`DELETE /api/sheet-version/{sheet_id}`

Deletes one version from a sheet family. Extracted character sprites remain.

### Delete a sheet family

`DELETE /api/sheet-family/{family_id}`

Deletes every sheet version in the family. Extracted character sprites remain.

### Update an action

`PATCH /api/actions/{label}`

Updates action metadata such as `label`, `description`, `inputLabel`, `targetLabel`, and `referenceLabels`.

### Action stats

`GET /api/actions/{label}/stats`

Returns ready/incomplete training-source counts and learned-action metadata.

## V10 behavior endpoints

### `POST /api/behaviors/define`
Create or update a behavior action.

Payload:

```json
{
  "name": "Bike",
  "label": "bike",
  "prefix": "bike",
  "framesPerDirection": 4,
  "directions": ["down", "left", "right", "up"],
  "inputMode": "base_directions"
}
```

### `GET /api/behaviors/{label}/sources`
Returns complete and incomplete training characters for the behavior.

### `POST /api/behaviors/{label}/train`
Creates/updates the underlying frame actions and trains them as one behavior package.

### `POST /api/behaviors/{label}/generate`
Generates all behavior sprites and animations for a target character.

Payload:

```json
{
  "characterId": "...",
  "replaceExisting": true,
  "duration": 120
}
```

### `GET /api/export/behavior-sheet/{character_id}/{behavior_label}?scale=1`
Exports a generated behavior as a row-cycle PNG sheet.

## V10 cleanup endpoints

### `DELETE /api/character/{cid}/sprite/{sprite_id}`
Deletes one sprite from a character and removes references to it from animations.

### `PATCH /api/animation/{animation_id}`
Updates an animation timeline, name, or loop flag.

### `DELETE /api/animation/{animation_id}`
Deletes an animation record. Sprites remain.


## Character packages (`.charbin`)

Prefix: `/api/packages/`. Full field definitions, binary layout, and validation rules: **[CHARBIN_SCHEMA.md](./CHARBIN_SCHEMA.md)**.

- `GET /api/packages/library` — list `.charbin` files in the configured folder.
- `GET /api/packages/library-thumb/{package_id}` — library card sprite (base_down / south row, column 0).
- `POST /api/packages/delete/{package_id}` — delete `{id}.charbin` from the library.
- `GET /api/packages/draft` — current authoring draft.
- `POST /api/packages/draft/new` — new package draft.
- `POST /api/packages/draft/open-path` — open a library file into draft.
- `PATCH /api/packages/draft` — merge package JSON.
- `POST /api/packages/draft/asset` — embed PNG (`assetId` + file).
- `POST /api/packages/save` — write `{id}.charbin`.
- `POST /api/packages/validate` — validate draft or body.
- `DELETE /api/packages/file` — delete a library file.
- `GET /api/packages/profiles` — sprite profile definitions.

## V11 notes

See `docs/V11_BATCH_AND_BEHAVIOR_QUALITY.md` for batch character creation, self-contained behavior actions, conservative learned overlays, behavior preview, and generated behavior management.

## V12 endpoints

- `POST /api/learned/{learned_id}/edit-rect` edits learned data by rectangle. Body: `{ layer: "overlay" | "remove" | "protect", x, y, w, h }`.
- `PATCH /api/character/{cid}/sprite/{sprite_id}/training` toggles manual training inclusion for a generated sprite.
- `DELETE /api/actions/{label}` removes owned behavior frame transforms when the deleted action is a behavior.
