# Pokémon Resort — Unofficial Fan Project Site

A static, data-driven GitHub Pages site for a fan-made resort project: public research atlas, compatibility graph, on-flight feature board, curated issue desk, and a local admin tool.

This repository is designed to stay public and safe:

- The public site has no backend, comments, donations, or live submission forms.
- Data lives in JSON files under `public/data`.
- The local admin tool runs only on your computer.
- Publishing uses your local Git credentials, not a token embedded in the website.
- `.env.local` is ignored and should never be committed.

## Legal / fan project notice

This is a non-commercial fan project created for research, documentation, and game development practice. Pokémon, Pokémon Concierge, character names, official imagery, concepts, and related intellectual property belong to their original owners. This project is not affiliated with, endorsed by, sponsored by, or approved by Netflix, The Pokémon Company, Nintendo, Game Freak, Creatures, or any related rights holders.

No donations, payments, crowdfunding, sponsorships, or financial support are accepted in any form. Original project-made code and development assets may be reused with appropriate credit unless otherwise stated. Official or reference material remains the property of its respective owners.

## Quick start

```bash
npm install
npm run dev
```

Open the local dev site shown by Vite, usually:

```text
http://127.0.0.1:5173
```

## Local admin tool

```bash
cp .env.example .env.local
npm run admin
```

Open:

```text
http://127.0.0.1:8787
```

The admin tool lets you edit:

- Bugs and checklists
- On-flight features and subtasks
- Compatibility graph routes
- Research Atlas points of interest
- Homepage copy
- Theme values
- Legal/site data

The **Publish** button validates data, runs `git add public/data public/assets`, commits, and pushes to `origin main` using your machine's Git authentication.

## Data files

```text
public/data/
  site.json              legal copy, navigation, repo URL
  homepage.json          hero, feature cards, media, weekly pulse
  theme.json             CSS variables and theme tuning values
  research-pois.json     3D atlas model URL and clickable POIs
  compatibility.json     games, transfer routes, route statuses
  features.json          on-flight board stages, features, subtasks
  bugs.json              curated public issue desk data
```

## Replace the island model

The atlas currently renders a procedural placeholder island. When your real model is ready:

1. Export it as `.glb` or `.gltf`.
2. Put it in `public/assets/models/`.
3. Edit `public/data/research-pois.json`:

```json
{
  "modelUrl": "assets/models/island.glb"
}
```

4. Tune each POI `position` array in the admin tool.

POI positions are `[x, y, z]` coordinates in the Three.js scene.

## Compatibility colors

Routes use these statuses:

```text
broken   = red, not working
edge     = yellow, edge cases failing
testing  = blue, more tests needed
working  = green, fully working
```

## GitHub Pages deployment

This repo includes `.github/workflows/pages.yml`. After pushing to GitHub:

1. Go to the repo settings.
2. Open **Pages**.
3. Set the source to **GitHub Actions**.
4. Push to `main`.

The workflow validates data, builds the site, and deploys the `dist` folder.

## Recommended workflow

```bash
npm run admin
# edit data in the local Operations Desk
# click Validate
# click Publish
```

Or from the terminal:

```bash
npm run validate
npm run publish -- "Resort update: compatibility and bug tracker"
```

## Fine tuning without pain

Use these files first before touching CSS:

- `public/data/homepage.json` for hero, cards, featured media, and pulse text.
- `public/data/theme.json` for color variables and theme settings.
- `public/data/site.json` for legal text and navigation.

For deeper styling, edit `src/styles.css`.
