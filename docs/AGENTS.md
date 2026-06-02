# Resort Docs — guide for coding agents

Read this file first, then the linked guides in **`pokemon-resort-page/`** (not the workspace root).

The public Docs hub (`#/docs`) is written for human contributors — no agent/LLM wording on the site. This file and the other repo markdown guides hold the automation details.

## Canonical markdown files

| File | When to read it |
|------|-----------------|
| [`docs/AUTHORING.md`](./AUTHORING.md) | JSON layout, block types, validation, categories, apps, freshness |
| [`docs/TEMPLATE.md`](./TEMPLATE.md) | Copy-paste article skeleton, `code` + `tabs` blocks |
| [`docs/MEDIA.md`](./MEDIA.md) | Real screenshots via Playwright — **no AI images** |
| [`docs/OVERWORLD_GLB_AGENT_NOTES.md`](./OVERWORLD_GLB_AGENT_NOTES.md) | Overworld GLB prop pipeline: conversion fixes, pitfalls, and C++ handoff (internal, non-public) |

## JSON template (copy this)

```
pokemon-resort-page/public/docs/templates/article-template.json
```

Live preview on site: `#/docs?article=article-template`

## Article folder layout (required)

**Never** drop new articles in a flat `public/docs/articles/` root. Store each body under the **category folder** that matches its `category` in `docs.json`:

```
public/docs/articles/
  meta/           ← Writing docs (category: meta)
    writing-docs.json
    article-template.json
  formats/        ← File formats (category: formats)
    charbin-schema.json
    owmap-format.json
  gameplay/       ← Gameplay & systems (category: gameplay)
  design/         ← Design (category: design)
```

| `category` in docs.json | Folder |
|-------------------------|--------|
| `meta` | `public/docs/articles/meta/` |
| `formats` | `public/docs/articles/formats/` |
| `gameplay` | `public/docs/articles/gameplay/` |
| `design` | `public/docs/articles/design/` |

Default path rule: **`public/docs/articles/{category}/{slug}.json`**

For large topics within a category, add a nested folder via an explicit **`path`** on the card:

```json
{
  "slug": "follower-ai",
  "category": "gameplay",
  "path": "gameplay/overworld/follower-ai.json"
}
```

The slug stays the URL id (`#/docs?article=follower-ai`); only the on-disk folder changes.

## Minimum workflow

All commands run from **`pokemon-resort-page/`**:

```bash
# 1. Pick category → copy template to public/docs/articles/{category}/{slug}.json
# 2. Add card → public/data/docs.json (category + apps[] must match folder)
# 3. Replace REPLACE_* placeholders; delete unused sections
npm run validate:data          # also refreshes docs-freshness.json

# Optional: real UI captures (not AI)
npm run dev                    # 127.0.0.1:5174
npm run admin                  # 127.0.0.1:9477 — restart after pulling
npm run docs:screenshots
npm run docs:freshness         # alone, if you only need staleness data
```

## Two files per article

| Path | Contents |
|------|----------|
| `public/data/docs.json` | Apps registry, categories, article cards (`category`, `apps[]`) |
| `public/docs/articles/{category}/{slug}.json` | Body: `{ "dossier": { overview, sections[] } }` |

Path helper (site + tools): `src/lib/docArticlePath.js`

## App filter (`apps[]` on each card)

```json
"apps": ["pokemon-resort", "pokemon-resort-page"]
```

Registry in `docs.json` → `apps[]`. Also inferred from `code` block `repo` fields when freshness is computed.

| `repo` / `apps` id | Folder |
|--------------------|--------|
| `pokemon-resort` | C++ game |
| `pokemon-resort-page` | Site + Operations Desk |
| `spmk` | SPMK tooling |
| `island-dreamforge` | Island Dreamforge |

## Freshness (staleness badges)

`tools/docs/compute-freshness.mjs` scans every article for `code` blocks (including inside `tabs`), reads source file mtimes in sibling repos, and writes **`public/data/docs-freshness.json`**.

| Status | Meaning |
|--------|---------|
| `current` | No cited code newer than `updatedAt`, or no code refs |
| `stale` | At least one cited file modified after `updatedAt` |
| `unknown` | Cited file missing on disk |

After editing cited source files, update the article body if needed and bump **`updatedAt`** on the card in `docs.json`.

## Primary tabs under the article title

For guide-style articles, mark the main tabs section:

```json
{
  "id": "guide",
  "title": "Step-by-step guide",
  "layout": "tabs-primary",
  "summary": "Optional lede shown above the tab bar.",
  "blocks": [{ "type": "tabs", "tabs": [ ... ] }]
}
```

Renders directly under the article heading on the public site (not buried under a section h3).

## Live examples on `#/docs`

| Slug | Folder | Shows |
|------|--------|--------|
| `writing-docs` | `meta/` | Portal UI, primary tabs, freshness, repo guides |
| `article-template` | `meta/` | Full skeleton with placeholders |
| `owmap-format` | `formats/` | Writing / Reading tabs + multi-repo code |
| `charbin-schema` | `formats/` | Format doc with tables and diagrams |

## Do not

- Put all articles in `public/docs/articles/` without a category subfolder
- Put “LLM”, “agent”, or “AI-generated” wording in public JSON articles
- Generate fake UI screenshots with AI — use `npm run docs:screenshots` ([MEDIA.md](./MEDIA.md))
- Hotlink external images — commit under `public/media/docs/` or `public/assets/docs/`
- Skip validation — `npm run validate:data` must pass before publish

## Human-readable mirror

Contributors browse **`#/docs?article=writing-docs`** — same workflows, contributor-facing prose.
