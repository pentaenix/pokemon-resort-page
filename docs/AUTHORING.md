# Documentation authoring guide

This guide is for humans and coding agents adding articles to the **Resort Docs** hub (`#/docs` on the public site).

**Coding agents:** start with [`docs/AGENTS.md`](./AGENTS.md), then use this file for detail. The public article `#/docs?article=writing-docs` is written for contributors and does not mention agent tooling.

| Also read | Purpose |
|-----------|---------|
| [`docs/AGENTS.md`](./AGENTS.md) | Agent checklist & file index |
| [`docs/TEMPLATE.md`](./TEMPLATE.md) | Article skeleton, `code` + `tabs` |
| [`docs/MEDIA.md`](./MEDIA.md) | Playwright screenshots (no AI) |

## Why JSON instead of Markdown?

Articles use the same **dossier block model** as Research, Ideas, Features, and Milestones. That gives you diagrams (Mermaid UML), image galleries, carousels, side-by-side compares, and sanitized HTML tables without a custom Markdown parser. JSON is verbose but explicit — easy for LLMs to generate correctly and validate before publish.

## File layout

| Path | Purpose |
|------|---------|
| `public/data/docs.json` | Index: categories + article cards (metadata only) |
| `public/docs/articles/{category}/{slug}.json` | Article body (default storage path) |
| `public/docs/templates/article-template.json` | Copy-paste skeleton for new articles |
| `public/assets/docs/` | SVG mocks, icons, placeholders |
| `public/media/docs/` | Screenshots, GIFs, MP4 clips |

Each article needs **both** an entry in `docs.json` and a body file under the matching **category folder** — not in a flat `articles/` root.

```
public/docs/articles/
  meta/        — authoring guides (category: meta)
  formats/     — file format specs (category: formats)
  gameplay/    — systems & architecture (category: gameplay)
  design/      — visual / UX reference (category: design)
```

The card's `category` must match the folder name. Default path: `{category}/{slug}.json`.

For nested topics (many articles in one category), set an explicit path on the card:

```json
"path": "gameplay/overworld/follower-ai.json"
```

The public URL still uses `slug` only: `#/docs?article=follower-ai`.

### App registry and filters

`docs.json` includes an `apps[]` registry. Each article card should list relevant apps:

```json
"apps": ["pokemon-resort", "pokemon-resort-page"]
```

The Docs hub filters by app and shows app pills on cards and articles.

### Freshness

Run `npm run docs:freshness` (or `npm run validate:data`) to regenerate `public/data/docs-freshness.json`. The hub compares `updatedAt` on each card to mtimes of files referenced in `code` blocks. Bump `updatedAt` after updating an article when cited source has changed.

### Primary tabs layout

Set `"layout": "tabs-primary"` on a section that contains a single `tabs` block to render it under the article title on the public site.

## Add a new article (checklist)

1. Pick a **slug** (lowercase, hyphens): e.g. `follower-ai-architecture`.
2. Add a category in `docs.json` if needed (`categories[]`).
3. Append to `docs.json` → `articles[]`:

```json
{
  "id": "follower-ai-architecture",
  "slug": "follower-ai-architecture",
  "title": "Follower AI architecture",
  "category": "gameplay",
  "tags": ["ai", "followers", "overworld"],
  "summary": "One-line card blurb for the docs hub.",
  "publishedAt": "2026-05-27",
  "updatedAt": "2026-05-27",
  "heroImage": {
    "path": "assets/docs/article-placeholder.svg",
    "caption": "Replace with a diagram or screenshot."
  },
  "featured": false,
  "author": "Resort Operations"
}
```

4. Create `public/docs/articles/gameplay/follower-ai-architecture.json` (folder = `category`):

```json
{
  "dossier": {
    "overview": "Long intro paragraph shown under the hero.",
    "sections": [
      {
        "id": "intro",
        "title": "Section title",
        "summary": "Optional section lede.",
        "blocks": [
          { "type": "text", "body": "Paragraph text." },
          {
            "type": "figure",
            "path": "assets/docs/article-placeholder.svg",
            "body": "Explain what the screenshot shows.",
            "caption": "Optional caption",
            "layout": "stacked"
          },
          {
            "type": "diagram",
            "title": "State machine",
            "caption": "Optional",
            "source": "stateDiagram-v2\n    [*] --> Idle\n    Idle --> Following"
          },
          {
            "type": "html",
            "html": "<table><thead><tr><th>Col</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>"
          }
        ]
      }
    ]
  }
}
```

5. Run `npm run validate:data` from `pokemon-resort-page/`.
6. Optional: edit in **Operations Desk → Docs** tab.
7. Commit and publish via the desk or Git.

## Block types

| type | Fields | Notes |
|------|--------|-------|
| `text` | `body` | Paragraph with line breaks; supports bold (**…**) and inline code (`…`) in body text |
| `figure` | `path`, `body`, `caption?`, `layout` | `stacked` or `side` |
| `image` | `path`, `caption?` | Single image |
| `video` | `path`, `caption?`, `poster?` | MP4 under `public/media/` |
| `gallery` | `images[]`, `caption?` | Grid; each image `{ path, caption }` |
| `carousel` | `images[]` (2+), `caption?` | Swipeable strip |
| `compare` | `items[]`, `variant`, `caption?` | Side-by-side; `variant`: `fluid` or `fixed` |
| `diagram` | `source`, `title?`, `caption?` | Mermaid UML text |
| `code` | `repo`, `path`, `body`, `lines?`, `language?`, `caption?` | Linked source from an app root (see below) |
| `tabs` | `tabs[]`, `caption?` | Tab bar; each tab has `id`, `label`, `blocks[]` |
| `links` | `items[]` | `{ label, href }` — https only |
| `html` | `html` | Sanitized subset; good for schema tables |

### Linked code (`repo` roots)

`path` is relative to the app folder in the monorepo — not `pokemon-resort-page/` unless that is the repo value.

| `repo` | Directory |
|--------|-----------|
| `pokemon-resort` | C++ game |
| `pokemon-resort-page` | Site + Operations Desk |
| `spmk` | SPMK tooling |
| `island-dreamforge` | Island Dreamforge |

```json
{
  "type": "code",
  "repo": "pokemon-resort",
  "path": "src/gameplay/world3d/data/OwmapOverworldLoader.cpp",
  "lines": "109-140",
  "language": "cpp",
  "caption": "Runtime loader",
  "body": "SceneConfig loadOwmapScene(...) { ... }"
}
```

### Tabbed sections

Use for write vs read (or any split narrative). Requires 2+ tabs, each with 1+ nested blocks.

```json
{
  "type": "tabs",
  "tabs": [
    { "id": "writing", "label": "Writing", "blocks": [{ "type": "code", "...": "..." }] },
    { "id": "reading", "label": "Reading", "blocks": [{ "type": "text", "body": "..." }] }
  ]
}
```

## LLM article template

Copy **`public/docs/templates/article-template.json`** or open `#/docs?article=article-template`. Guide: **`docs/TEMPLATE.md`**.

Example with tabs: `#/docs?article=owmap-format`.

Asset paths are relative to `public/` (e.g. `media/docs/shot.webp`, `assets/docs/hero.png`).

## Media without AI images

**Do not use AI image generators** for documentation screenshots. Run the real app and capture it with Playwright:

```bash
npm run dev
npm run admin          # restart after pulling; needed for admin-docs capture
npm run docs:screenshots
```

Writes WebP files to `public/media/docs/`. Full guide: **`docs/MEDIA.md`**.

| Need | Command |
|------|---------|
| All doc screenshots | `npm run docs:screenshots` |
| Visible browser | `npm run docs:screenshots:headed` |
| One target | `npm run docs:screenshots -- --only docs-hub` |
| Example GIF | `npm run docs:example-gif` |

Reference captured files in JSON:

```json
"path": "media/docs/docs-hub.webp"
"path": "media/docs/writing-docs-article.webp"
"path": "media/docs/admin-docs-tab.webp"
```

Fallback placeholder:

```json
"path": "assets/docs/article-placeholder.svg"
```

## Categories (current)

- `meta` — Writing docs
- `formats` — File formats (charbin, owmap, …)
- `gameplay` — Game systems
- `design` — Visual / UX reference

## Validation rules

- Article `id` and `slug` must be unique.
- `category` must match a `categories[].id`.
- Every slug in `docs.json` must have a body at `public/docs/articles/{category}/{slug}.json` (or an explicit `path` on the card).
- Dossier blocks must pass the same rules as Research dossiers (paths on media blocks, 2+ images for carousel, etc.).

## Public URL

- Hub: `#/docs`
- Article: `#/docs?article=charbin-schema`

## Admin

**Operations Desk → Docs** edits metadata and dossier body, then saves both files to disk.
