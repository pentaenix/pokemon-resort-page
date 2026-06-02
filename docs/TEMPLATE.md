# Article template

Start from **`public/docs/templates/article-template.json`** (or the live article `#/docs?article=article-template`).

## Workflow

1. Copy the template to `public/docs/articles/{category}/{your-slug}.json` (folder must match the card's `category`).
2. Add a card in `public/data/docs.json` → `articles[]` (include **`apps[]`** for hub filters).
3. Replace every `REPLACE_*` placeholder.
4. Delete sections you do not need (media, tabs, etc.).
5. Run `npm run validate:data` (refreshes freshness + validates JSON).

## Card metadata (`docs.json`)

Each article card should list which apps the topic touches and which **category folder** stores the body:

```json
{
  "id": "your-slug",
  "slug": "your-slug",
  "category": "gameplay",
  "apps": ["pokemon-resort", "pokemon-resort-page"],
  "updatedAt": "2026-06-01"
}
```

On disk: `public/docs/articles/gameplay/your-slug.json`

## Primary tabs under the title

For guide-style articles, hoist the main tab bar directly under the article heading:

```json
{
  "id": "guide",
  "title": "Step-by-step guide",
  "layout": "tabs-primary",
  "summary": "Optional lede above the tab bar.",
  "blocks": [{ "type": "tabs", "tabs": [ … ] }]
}
```

See `#/docs?article=writing-docs` for a live example.

## Freshness

`npm run docs:freshness` writes `public/data/docs-freshness.json`. The hub marks articles **stale** when a cited source file changed after the card's `updatedAt`. Bump `updatedAt` after syncing article text with code changes.

## Section breakdown (default skeleton)

| Section id | Purpose |
|------------|---------|
| `summary` | Plain-language intro for humans |
| `concepts` | Definitions + optional Mermaid diagram |
| `implementation` | **Linked code** + optional **tabs** |
| `reference` | HTML tables for schemas / binary layout |
| `media` | Screenshots (`npm run docs:screenshots`) |
| `related` | Cross-app notes + https links |

## Linked code block

Paths are relative to an **app root** in the monorepo — not the workspace root.

| `repo` value | App folder |
|--------------|------------|
| `pokemon-resort` | Game runtime (C++) |
| `pokemon-resort-page` | Public site + Operations Desk |
| `spmk` | SPMK tooling |
| `island-dreamforge` | Island Dreamforge stack |

```json
{
  "type": "code",
  "repo": "pokemon-resort",
  "path": "src/gameplay/world3d/data/OwmapOverworldLoader.cpp",
  "lines": "109-140",
  "language": "cpp",
  "caption": "What this excerpt shows",
  "body": "paste the actual snippet here"
}
```

Rules:

- `body` must contain real code copied from the linked file (keep in sync on edits).
- `lines` is optional but recommended for navigation.
- One article may cite files from **multiple** repos.

## Tabbed section (write vs read)

Use when a format has distinct authoring and loading paths — see `#/docs?article=owmap-format`.

```json
{
  "type": "tabs",
  "caption": "Optional label above the tab bar",
  "tabs": [
    {
      "id": "writing",
      "label": "Writing",
      "blocks": [
        { "type": "text", "body": "…" },
        { "type": "code", "repo": "pokemon-resort-page", "path": "…", "body": "…" }
      ]
    },
    {
      "id": "reading",
      "label": "Reading",
      "blocks": [
        { "type": "text", "body": "…" },
        { "type": "code", "repo": "pokemon-resort", "path": "…", "body": "…" }
      ]
    }
  ]
}
```

Requirements:

- At least **two** tabs.
- Each tab needs at least **one** nested block after normalization.
- Nested blocks support the same types as top-level blocks (text, code, diagram, html, image, …).

## Live examples

| Article | Demonstrates |
|---------|--------------|
| `writing-docs` | Authoring guide with primary tabs, portal filters, freshness |
| `article-template` | Full skeleton with placeholders |
| `owmap-format` | Writing / Reading tabs + multi-repo code |

See also: [`docs/AGENTS.md`](./AGENTS.md), [`docs/AUTHORING.md`](./AUTHORING.md), [`docs/MEDIA.md`](./MEDIA.md).
