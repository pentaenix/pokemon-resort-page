# V9 Stability, Control, and Polish

V9 is a stability/control pass for the workflows that were already working in V8.

## Sheet mapper

- Template options are treated as an active draft and are not reset after Apply.
- Undo/Redo buttons restore mapper selections/options after accidental template or scaling actions.
- Applying a scaling template to an already-prepared version warns before double-scaling.
- Populate saves the sheet first and stays in the mapper.
- Populate status remains visible until the next action.

## Sheet cleanup

- Versions can be deleted from the sheet-family view.
- Entire sheet families can be deleted.
- Extracted character sprites remain when sheet versions/families are deleted.
- If the current version is deleted and other versions remain, another version becomes current.

## Templates

- Walk Cycle and General Row Cycle both default to 64px source cells.
- General Row Cycle defaults to 50% scaling so 64px sheets produce 32px frames.
- Built-in templates refresh on load when upgrading old projects.
- Custom templates continue to persist through project JSON.

## Actions

- Actions open in a modal workspace.
- The modal supports description editing, input/target/reference labels, training refresh, Generate handoff, and deletion.
- Training source cards and change maps are visible in the modal.

## Generate

- Generate now presents a recipe: target character, existing learned action, compatible input sprite, references, training sources, change map, preview, and save.
- Progress and terminal logs have better spacing.

## Editor

- The grid is rendered over a transparent canvas.
- Background choices include dark checker, light checker, clear, light, and dark.
- Background settings do not change sprite pixels.
