# UI copy guide (public site)

Read this before editing **any user-facing text** on the Pokémon Resort site: homepage JSON, data summaries, page titles in React, empty states, and spotlight labels.

**Coding agents:** [`docs/AGENTS.md`](./AGENTS.md) links here. Resort **ideas** use the same rules for `public/data/ideas.json` card blurbs and `public/ideas/articles/{slug}.json` dossiers.

Technical **docs articles** (`public/docs/articles/`) may use denser prose for formats and code, but hub **card summaries** in `docs.json` still follow this guide.

---

## Voice

This is a **resort operations** site: cork board, front desk, concierge, on-flight features, docs desk. Keep that theme.

The theme is **nouns and labels**, not poetry. Write like a staff member leaving a clear note, not like marketing copy.

| Keep | Avoid |
|------|--------|
| cork board, resort, concierge, desk, pins, on-flight | cozy, curated, scannable, meaningful, alive, ritual, journey arc |
| Plain verbs: Open, Add, Show, Link | Poster headlines: “Where X becomes Y” |
| Specific facts: episode timestamps, pin colors, route counts | Rule-of-three lists: “what we know, what we’re placing, what’s guesswork” |
| Short sentences | Stacked em-dash clauses |

---

## Hard rules

1. **No em dashes (—)** in UI copy. Use a comma, period, or parentheses instead.
2. **No contractions** in new or revised UI strings: write **do not**, **we will**, **it is**, **you will**, not don’t, we’ll, it’s, you’ll.
3. **One main idea per sentence** for blurbs (summaries, intros, nav card descriptions).
4. **Say what exists** when you can: file paths, pin colors, counts, episode numbers, stage names.
5. **Never mention LLMs, agents, or AI-generated** wording on the public site.

En dashes in numeric ranges inside technical docs (for example `0–100` in validation messages) are fine. Do not use them as sentence punctuation in UI.

---

## Where UI copy lives

| Location | What to edit |
|----------|----------------|
| `public/data/homepage.json` | Hero, about, carousel, nav cards, status card details |
| `public/data/ideas.json` | Idea **card** title + summary (one line each) |
| `public/ideas/articles/{slug}.json` | Full idea dossier (longer; still plain, no em dashes) |
| `public/data/features.json` | Feature `summary` (card blurb); task labels |
| `public/data/research.json` | Research entry `summary` |
| `public/data/roadmap.json` | Milestone `summary` |
| `public/data/compatibility.json` | `statuses.*.description`, `generations.*.summary` |
| `public/data/atlas-pins.json` | Pin `summary`, `pinColors[].hint`, map captions |
| `public/data/docs.json` | Category `description`, article card `summary` only |
| `public/data/site.json` | `legalShort`, `projectName` |
| `src/pages/*.jsx` | `PageTitle`, section intros, empty states |
| `src/pages/Home.jsx` | Digest labels, section headings |
| `src/lib/resortSpotlight.js` | Spotlight eyebrows and CTA labels |
| `src/lib/milestoneEras.js` | Era subtitles |
| `src/components/Layout.jsx` | Header/footer chrome |
| `src/main.jsx` | Boot loading/error messages |

Prefer **data JSON** for content that appears in multiple places. Use JSX only for structural labels that are not stored in data.

---

## Resort ideas (spark board)

Ideas are **not committed work**. Card blurbs should read like a note on the spark board.

**Good idea summary**

```json
"summary": "Player arrives by ferry. Dock is the first scene on the island."
```

**Bad idea summary**

```json
"summary": "Use the ferry and dock as the player-facing arrival ritual for the resort."
```

Checklist for a new idea:

1. Add `public/data/ideas.json` card: `id`, `slug`, `title`, `status`, `summary` (one or two short sentences).
2. Add `public/ideas/articles/{slug}.json` dossier if the idea needs tabs, media, or diagrams.
3. Run `npm run validate:data` (includes UI copy lint).
4. Summary on the card must stand alone on the Ideas index; do not make the user open the article to learn what the idea is.

Statuses: `spark`, `promising`, etc. (see existing items). Titles are plain nouns (“Ferry arrival presentation”), not slogans.

---

## Page titles and section headings

**Eyebrow** = department name (Resort operations, Island Atlas, Spark board).

**Title** = what the page is, not a metaphor:

| Avoid | Prefer |
|-------|--------|
| Where sparks become the path forward. | Ideas and the path ahead |
| A stable directional route lab for generation round trips. | Transfer routes between generations |
| Everything we learn about the series — not just map pins. | Research beyond the map pins |

Drop trailing periods on short section `h2` lines when they read like poster taglines (“What we are building toward”, not “What we are building toward.”).

---

## Compatibility and status blurbs

Generation summaries should **not** repeat the same template sentence for every generation. Lead with the era label, then status in plain language:

```json
"summary": "Kanto / Game Boy era. No round-trip test posted for this generation yet."
```

```json
"summary": "Johto / Game Boy Color era. Self round-trip marked failing. Other routes for this generation are not tested yet."
```

Status descriptions are short labels for the legend, not formal spec language:

| Status | Description |
|--------|-------------|
| green | Round trip passes our checklist. |
| gray | Not tested yet. |
| red | Round trip fails. |
| yellow | Works sometimes; edge cases still open. |
| blue | Needs more test runs. |

---

## Spotlight and CTAs (`resortSpotlight.js`)

Eyebrows can stay themed: **From the docs desk**, **Pinned on the map**, **Spark board**.

CTAs should be plain: **Open article**, **Open feature**, **Open idea**, **Open milestone**, **Read the note**. Avoid “Follow the arc”, “See the feature”, “View the idea”.

---

## Before you publish

```bash
npm run validate:data
```

Validation includes **UI copy lint** (em dashes in known UI fields and page components). Fix any reported path before commit.

When rewriting existing copy, read the surrounding page once so tone stays consistent with the resort desk theme without sliding back into generic LLM phrasing.

---

## Quick self-check

Ask:

1. Does this sound like a product landing page? Rewrite shorter and more specific.
2. Is there an em dash? Remove it.
3. Is there a contraction? Spell it out.
4. Would a contributor learn **what to do or what exists** from this line alone?
5. For ideas: would someone know the gameplay or UI change without opening the dossier?

If any answer fails, revise before opening a PR.
