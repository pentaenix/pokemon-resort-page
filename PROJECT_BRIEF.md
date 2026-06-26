# Project Brief for Future AI Agents

You are working on a static GitHub Pages app for an unofficial, non-commercial Pokémon Concierge-inspired fan research and game-development project.

## Product intent

Build a beautiful resort-themed public portal that feels like a polished tropical resort website while functioning as a serious public research archive and development operations board.

The public site is not a blog and not a comments platform. It is a curated, data-driven display of research, game progress, compatibility status, internal bugs, curated community issue links, milestone timeline items, models, sprites, and media.

## UI copy (agents)

All public blurbs and page chrome follow **`docs/UI-COPY.md`**:

- Resort desk theme (cork board, concierge, on-flight) without generic marketing tone.
- No em dashes in UI strings.
- No contractions in UI strings.
- Idea card summaries in `public/data/ideas.json` must state the idea plainly in one or two sentences.

`npm run validate:data` enforces UI copy lint via `tools/ui-copy-lint.mjs`.

## Core principles

1. Keep the public app static and safe for GitHub Pages.
2. Do not add a hosted backend unless explicitly requested.
3. Treat Git + JSON files as the source of truth.
4. Keep the navigation compact.
5. Prefer integrated sections over many tiny public pages.
6. Make the site beautiful, readable, and mobile-friendly.
7. Keep legal notices visible and respectful.
8. Never commit secrets.
9. Do not hotlink random external media.
10. Avoid placeholder public data; use empty states and resource instructions for missing media.

## Current public pages

Header navigation (`src/components/Layout.jsx`):

- **Home** (`#/`)
- **Island Atlas** (`#/atlas`): 2D cork-board pins, 3D viewport, gallery, models, characters
- **Compatibility** (`#/ontology`): generation transfer route graph
- **Operations** (`#/board`): on-flight features, internal bugs, community issue links
- **Ideas & Milestones** (`#/milestones`): hub linking spark board and build timeline
- **Docs** (`#/docs`): technical articles for contributors (`?article=slug`)
- **Source Guide** (`#/source`)
- **Legal** (`#/legal`)

Sub-routes (linked from hubs, not top-level nav):

- **Spark board** (`#/ideas`): uncommitted idea cards and dossiers
- **Build timeline** (`#/build`): vertical milestone roadmap

Route aliases (`src/main.jsx`): `#/issues` → Operations; `#/roadmap` → build timeline; `#/gallery`, `#/models`, `#/characters` → Island Atlas; `#/research`, `#/concierge` → Island Atlas; `#/plan` → Ideas & Milestones hub.

## Most important interaction

The Compatibility Ontology must remain stable and smooth:

- Hover must not recalculate layout.
- Nodes must not jump.
- Routes must not reset positions.
- Lines are directional and mostly straight; self-loops arc outward and use Resort as the middle point in labels.
- Each visible line should have a larger invisible hit path for easy clicking.
- Dragging must update only the moved node and its connected lines.
- Focus mode should center the selected generation and arrange the rest around it.
- Self-loops should arc outward from the node.
- Mobile users need both graph and route-list fallback.

## Local tool intent

The local Operations Desk is the private staff console. It should make updates feel inviting:

- edit route statuses
- update bugs and checklists
- update feature progress
- update atlas pins and 3D POI coordinates
- update game box-art paths
- update milestones and idea cards
- update docs hub articles
- validate data
- publish through local Git credentials

Do not turn this into a public admin panel.
