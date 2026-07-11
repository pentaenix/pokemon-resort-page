# Architecture

SPMK is a local web app with a Python backend and a static browser UI.

**Agents:** read [AGENTS.md](./AGENTS.md) before editing library UI — required features and guard scripts are documented there.

## Runtime

- `./spmk run` starts FastAPI through Uvicorn.
- Static UI files live in `spmk_app/static/`.
- Local project data lives in `workspace/`.

## Storage

```text
workspace/
  project.json
  llm_settings.json (local only, API key never returned to the browser)
  assets/
    sheets/
    characters/
    generated/
  exports/
```

`project.json` stores metadata: characters, sheets, templates, mappings, animations, training pairs, and generated outputs. PNG files remain normal files on disk.

## Character model bridge

`spmk_app/llm_service.py` is the single OpenAI-compatible bridge for structured character authoring. It stores the endpoint, model, and API key in `workspace/llm_settings.json` with local-only permissions; settings APIs expose only the endpoint, model, and whether a key is configured. The bridge validates all model output through `npc_intel.validate_intel_for_package` before it is applied to a `.charbin` draft.

The Character list offers one sprite-sheet-to-character modal. It analyzes the uploaded sheet, opens a human NPC draft, applies validated character intel, then delegates sheet preparation and action setup to the existing `draft/add-sheet` pipeline. Name-only enrichment uses a separate prompt but the same validated intel contract. Keep model transport and prompts in the bridge, and keep charbin/sheet changes in the existing package APIs.

The bridge guards token use centrally: sprite sheets are rejected above 2 MB, normalized to a maximum 512 px edge, and sent at low visual detail. Completion budgets are clamped to 600–2400 tokens (1600 by default). Successful requests are cached by normalized input, endpoint, and model, with the most recent 100 profiles retained locally. New model-backed workflows must use this bridge rather than sending images or prompts directly from browser code.

## Data model

- **Character**: named asset owner with sprites and attached sheet IDs.
- **Sheet**: imported or prepared PNG plus mapping settings and template ID.
- **Template**: frame size, base cell map, animation frame definitions.
- **Sprite**: labeled PNG belonging to a character.
- **Animation**: ordered sprite frame records with durations.
- **Training pair**: base sprite ID, action sprite ID, action label.

## Platinum preparation flow

`POST /api/sheet/{sid}/prepare-platinum` creates a non-destructive 50% copy of the selected sheet and assigns the prepared 32px Platinum template. This separates sheet preparation from character population, making the UI easier to understand.
