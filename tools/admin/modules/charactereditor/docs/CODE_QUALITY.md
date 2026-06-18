# Code Quality

## Expectations

- Keep features local-first and non-destructive.
- Write small helpers for repeated project mutations.
- Prefer deterministic image processing before adding ML.
- Keep UI state simple and serializable.

## File length

Current prototype files are intentionally compact. Future work should split:

- sheet UI into `sheets.js`
- editor UI into `editor.js`
- actions/generation into `actions.js`
- backend image operations into `image_ops.py`
- backend project persistence into `project_store.py`

New code should keep each file under 350 lines where practical.

## Tests before handoff

Full guide: [`tests/README.md`](../tests/README.md)

```bash
./spmk test quick     # unit + static guards (~seconds)
./spmk test           # + integration API workflows
./spmk test e2e       # + Playwright browser smoke (after UI changes)
```

Legacy one-offs (also run inside `./spmk test quick`):

```bash
python3 -m py_compile spmk_app/server.py
node --check spmk_app/static/app.js
node scripts/check_app_js_duplicates.js
```
