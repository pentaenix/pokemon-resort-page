# Documentation media (no AI images)

Use **real browser captures, diagrams, and programmatic graphics** for Resort Docs. Do not use AI image generators for screenshots or UI mockups.

The **How to write documentation** article (`#/docs?article=writing-docs`) demonstrates these techniques. Agents should read [`docs/AGENTS.md`](./AGENTS.md) first.

## Primary workflow — run the app, capture with Playwright

```bash
cd pokemon-resort-page
npm install
npx playwright install chromium   # once per machine

npm run dev                       # public site → 127.0.0.1:5174
npm run admin                     # Operations Desk → 127.0.0.1:9477 (restart after pulling Docs tab changes)

npm run docs:screenshots          # headless Chromium → public/media/docs/*.webp
npm run docs:screenshots:headed   # same, but visible browser window
```

This runs `tools/docs/capture-screenshots.mjs`, which:

1. Opens `http://127.0.0.1:5174/#/docs` and waits for article cards
2. Opens `#/docs?article=writing-docs` and waits for dossier sections
3. Opens the admin **Docs** tab, selects **writing-docs**, and captures the editor

Outputs (default WebP):

| File | Target |
|------|--------|
| `media/docs/docs-hub.webp` | Public Docs index |
| `media/docs/writing-docs-article.webp` | This article rendered |
| `media/docs/admin-docs-tab.webp` | Operations Desk → Docs |

Options:

```bash
npm run docs:screenshots -- --only docs-hub
npm run docs:screenshots -- --start-dev --start-admin   # spawn servers if down
npm run docs:screenshots -- --format png
```

If admin on 9477 is an **old process** (no `docs.json` in `/api/data`), restart `npm run admin` or let the script auto-detect a fresh desk on 9478.

## Where files live

| Location | Use for |
|----------|---------|
| `public/media/docs/` | Playwright screenshots, GIFs, MP4 |
| `public/assets/docs/` | SVG diagrams, icons, fallbacks |
| JSON `"path"` | Relative to `public/` (no leading slash) |

## Other workflows

### Manual macOS window capture

```bash
npm run docs:capture -- my-shot.webp
```

Click the browser window when prompted.

### Short programmatic GIF (no browser)

```bash
npm run docs:example-gif
```

Writes `media/docs/example-ui-loop.gif` via Pillow (`tools/docs/build-example-gif.py`).

### ffmpeg screen recording → GIF

```bash
ffmpeg -i recording.mp4 -vf "fps=10,scale=960:-1:flags=lanczos" -loop 0 public/media/docs/demo.gif
```

Prefer MP4 + a `video` block for longer clips.

### Mermaid (no bitmap)

```json
{ "type": "diagram", "source": "flowchart LR\n  A --> B" }
```

## JSON examples (real captures)

```json
{
  "type": "figure",
  "path": "media/docs/docs-hub.webp",
  "body": "Captured with npm run docs:screenshots while Vite dev was running.",
  "caption": "Public Docs hub",
  "layout": "stacked"
}
```

```json
{
  "type": "compare",
  "variant": "fluid",
  "items": [
    { "path": "media/docs/docs-hub.webp", "label": "Public #/docs" },
    { "path": "media/docs/admin-docs-tab.webp", "label": "Admin Docs tab" }
  ]
}
```

## What not to do

- Do **not** use AI to fake UI screenshots
- Do **not** hotlink external images
- Do **not** commit huge uncompressed PNGs without WebP copies

## Agent checklist

1. [ ] `npm run dev` (and `npm run admin` if capturing desk)
2. [ ] `npm run docs:screenshots`
3. [ ] Point JSON blocks at `media/docs/*.webp`
4. [ ] `npm run validate:data`

See also: `docs/AUTHORING.md`
