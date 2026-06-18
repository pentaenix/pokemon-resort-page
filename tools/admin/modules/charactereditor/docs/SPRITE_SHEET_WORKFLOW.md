# Sprite Sheet Workflow

The sheet mapper follows a strict three-step workflow.

## Step 1: Choose and apply a template

Templates define how a sheet is scaled, sliced, labeled, and converted into animations.
The main button says **Apply template** because the chosen template can change over time.

For Platinum 64px fan sheets, the template creates a saved 50% copy with 32px cells.

## Step 2: Save prepared sheet

Saving the prepared sheet persists:

- template ID;
- grid settings;
- prepared sheet image metadata;
- mapping state.

Saving a sheet does not populate a character.

## Step 3: Populate character

Populating a character creates:

- base sprites;
- extra animation frames;
- playable animation records.

The app blocks accidental duplicate population of the same character with the same sheet/template.
Users can intentionally rebuild by choosing **Replace existing**.

## Visibility rules

After population, the character page must show the outputs clearly:

- Base sprites in a base section.
- Non-base frames in Extra frames.
- Animation records in Animations.
- Source sheets in Attached sheets.

If a frame is created but cannot be found on the character page, that is a UX bug.
