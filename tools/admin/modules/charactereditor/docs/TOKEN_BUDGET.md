# Token Budget Guidance for Agents

This repo is meant to be easy for future agents to modify without reading every line.

## Before editing

1. Read `README.md`.
2. Read `AGENTS.md` (product rules + **v5 documentation map** — read only the doc(s) relevant to your task).
3. Read only the relevant doc under `docs/` (see map in `AGENTS.md`; do not scan the whole tree).
4. Use targeted search instead of opening full large files (`app.js` is one module; grep before read).

## While editing

- Summarize the change plan before touching large files.
- Use small patches.
- Avoid rewriting entire files unless the user asks.
- Do not paste generated binary/base64 assets into messages or source.
- Keep UI copy concise to reduce future diff size.

## Handoff

Report only:

- what changed
- what was tested (`./spmk test` / `./spmk test e2e`)
- known gaps
- the artifact path

