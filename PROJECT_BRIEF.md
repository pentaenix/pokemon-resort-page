# Project Brief for AI Agents and Contributors

## Product vision

Build a public fan research and development hub that feels like a cozy resort landing page on the surface and a serious production atlas underneath.

The site should make visitors feel like they have arrived at a lovingly maintained resort operations desk:

- Beautiful, calm, sunny, readable.
- Public and transparent without comments or chaos.
- Clearly unofficial and non-commercial.
- Easy to update through local data files and the local admin tool.

## Core experience

1. **Front Desk** gives the visitor the current project state at a glance.
2. **Research Atlas** lets the visitor click places on the island model and understand evidence, confidence, asset needs, and linked work.
3. **Compatibility Lab** shows transfer-route ontology as a colored graph.
4. **On-Flight Board** shows current features, subtasks, progress, and status.
5. **Issue Desk** shows curated bugs and checklists without comments or submissions.
6. **Source Guide** explains the repo and data model without providing game download links.

## Design language

Use resort language instead of generic dev language where it improves clarity:

- Front Desk = status overview
- Research Atlas = island reconstruction research
- Compatibility Lab = transfer testing
- On-Flight Board = active feature work
- Issue Desk = bug tracker
- Landed = complete
- Boarding Soon = queued

The UI should feel like a sunny resort brochure mixed with an operations board: soft cards, glass panels, water/sand colors, gentle motion, clear status labels.

## Legal guardrails

Keep visible notices that this is:

- Unofficial.
- Non-commercial.
- Made by fans, for fans.
- Not affiliated with rights holders.
- Not accepting donations in any form.
- Reusing only original project-made code/assets with credit.
- Treating official/reference material as owned by its respective rights holders.

Do not add donation links, download links, comments, or public upload forms.

## Technical architecture

- Static frontend: Vite + React + Three.js.
- Hosting: GitHub Pages.
- Data source: JSON files in `public/data`.
- Local admin: Node + Express server in `tools/admin`.
- Publishing: local Git credentials, not frontend secrets.
- Secrets: `.env.local` only, ignored by Git.

## Fine-tuning rule

Before editing `src/styles.css`, try changing:

- `public/data/homepage.json`
- `public/data/theme.json`
- `public/data/site.json`

The site should remain easy to evolve through data and small config changes.
