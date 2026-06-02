# Pokémon Resort — Fan Research & Development Atlas

A polished, data-driven, static GitHub Pages site for a non-commercial fan research/game-development project.

The public site is static: no comments, no accounts, no hosted database, no public admin panel, and no backend. The local-only **Resort Operations Desk** edits JSON data, validates it, and can publish through your own local Git credentials.

## Public site structure

The public app intentionally keeps navigation compact:

- **Home** — the resort lobby, project status, entry cards, and a clear “What is this?” about section.
- **Island Atlas** — the 3D island viewport, confidence filters, media carousel, points of interest, submodels, character/sprite planning, and gallery resources.
- **Compatibility** — the generation ontology with stable directional routes, focus mode, free-layout dragging, outward self-loops, large line hit boxes, and mobile route fallback.
- **Operations** — On-Flight Board, internal bugs, and community issue links.
- **Milestones** — a vertical scrollable project timeline centered on the current milestone.
- **Source Guide** — repo structure and local update workflow.
- **Legal** — full fan-project disclaimer and asset/credit stance.

Aliases such as `#/issues`, `#/gallery`, `#/models`, and `#/characters` are redirected into the integrated pages. `#/roadmap` now routes to the dedicated Milestones page.

## Current ontology data stance

The compatibility ontology ships conservatively:

- Cross-generation routes are **Untested**.
- Most self-routes are **Untested** until you record checklist evidence.
- Generation II self round-trip is marked **Not working**.
- Generation VII self round-trip is marked **Not working**.

Every route is stored in `public/data/compatibility.json` and can be edited from the Operations Desk.

## Why box art is not bundled

Official game box art is not included in the zip. The app is wired to use local box-art files, and `RESOURCE-TO-ADD.md` lists the exact paths. Add curated images that you have decided are appropriate for your public fan-research repo.

The public app does not hotlink random external image results because those links are fragile and difficult to control.

## Run the public site locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (default **5174** — see [`../DEV-PORTS.md`](../DEV-PORTS.md) for the workspace port map).

## Build the site

```bash
npm run validate:data
npm run build
```

## Run the local Operations Desk

```bash
npm run admin
```

Open:

```text
http://127.0.0.1:9477
```

Port assignments for all apps in this workspace: [`../DEV-PORTS.md`](../DEV-PORTS.md).

The Operations Desk runs on your machine only. It edits files in `public/data`, validates them, shows Git status, and can commit/push through your existing Git setup.

## Operations Desk UI

The local tool includes guided editors for:

- Compatibility routes and route checklists
- Bug/issue cards and issue checklists
- Feature cards, progress, stages, and subtasks
- Research POIs and 3D marker coordinates
- Game library box-art paths (fetch from Libretro Thumbnails in the desk — not on the public site)
- Main island model metadata
- Roadmap / milestone timeline items
- Idea board cards
- Homepage/theme tuning
- Publish validation and commit/push

It also shows detected files under `public/media` so you can copy paths into gallery, model, character, and evidence records.

### Fetch box art (Libretro Thumbnails)

Uses the public [Libretro Thumbnails](https://thumbnails.libretro.com/) CDN — **no login or `.env` file**.

1. `npm run admin` → **Game Library** tab.
2. Select a game → **Find covers** → **Use this cover** (USA / USA+Europe preferred).
3. Or batch CLI:

```bash
npm run fetch:boxart
npm run fetch:boxart -- emerald legends-za
npm run fetch:boxart -- --force
```

Switch-era games are not on Libretro yet; add those paths manually (see `RESOURCE-TO-ADD.md`).

### Import community GitHub issues

Uses the GitHub REST API from the local desk only — your token never ships with the public site.

1. Copy `.env.example` → `.env.local` and set `GITHUB_TOKEN` (fine-grained or classic PAT with `repo` or `public_repo` read access to issues).
2. Set `GITHUB_REPO=owner/repo` or fix `public/data/site.json` → `repoUrl`.
3. Restart `npm run admin` → **Bugs** tab → **Community GitHub issues**.
4. **Refresh from GitHub** → **Add to site** on the issues you want on the Operations page.
5. Tweak summaries / linked internal bugs, then **Save bugs**.

## Publishing safely

Do not commit real secrets. This repo includes `.env.example` only. Real `.env.local` files are ignored.

The safest publishing path is local Git authentication:

```bash
git add public/data public/assets public/media
git commit -m "Resort update"
git push origin main
```

or use the Operations Desk publish button after reviewing Git status.

## Data files

```text
public/data/site.json              legal text, logo, project name
public/data/homepage.json          homepage copy and media
public/data/theme.json             design tuning controls
public/data/research-pois.json     3D atlas markers and evidence
public/data/compatibility.json     generations, games, routes, statuses, layout
public/data/features.json          on-flight board
public/data/bugs.json              internal bugs and community issue links
public/data/gallery.json           connected visual archive and Atlas carousel
public/data/models.json            main island model and submodels
public/data/characters.json        characters, visitors, sprite requirements
public/data/roadmap.json           vertical milestone roadmap
public/data/ideas.json             idea board
```

## Media folders

Real media lives under `public/media`. The site is already wired for box art, screenshots, renders, diagrams, GIFs, video, and GLB models. See `RESOURCE-TO-ADD.md` for the full list and exact target paths.

## Legal stance

The site repeats the non-commercial fan-project disclaimer at the top, footer, and legal page. Keep that visible as the project grows.
