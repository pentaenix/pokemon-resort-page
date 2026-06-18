# Architecture

SPMK is a local web app with a Python backend and a static browser UI.

## Runtime

- `./spmk run` starts FastAPI through Uvicorn.
- Static UI files live in `spmk_app/static/`.
- Local project data lives in `workspace/`.

## Storage

```text
workspace/
  project.json
  assets/
    sheets/
    characters/
    generated/
  exports/
```

`project.json` stores metadata: characters, sheets, templates, mappings, animations, training pairs, and generated outputs. PNG files remain normal files on disk.

## Data model

- **Character**: named asset owner with sprites and attached sheet IDs.
- **Sheet**: imported or prepared PNG plus mapping settings and template ID.
- **Template**: frame size, base cell map, animation frame definitions.
- **Sprite**: labeled PNG belonging to a character.
- **Animation**: ordered sprite frame records with durations.
- **Training pair**: base sprite ID, action sprite ID, action label.

## Platinum preparation flow

`POST /api/sheet/{sid}/prepare-platinum` creates a non-destructive 50% copy of the selected sheet and assigns the prepared 32px Platinum template. This separates sheet preparation from character population, making the UI easier to understand.
