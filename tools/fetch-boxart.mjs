#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boxartImageUrl,
  fetchListing,
  getMatcher,
  LIBRETRO_BASE,
  matchCandidates,
  PLATFORM_FOLDERS,
} from './lib/libretro-thumbnails.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const publicRoot = join(root, 'public');
const dataPath = join(publicRoot, 'data', 'compatibility.json');

export async function readCompatibility() {
  return JSON.parse(await readFile(dataPath, 'utf8'));
}

export function findGame(data, gameId) {
  const game = data.games?.find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game id: ${gameId}`);
  return game;
}

export function gameNeedsFetch(game, assets, { force = false } = {}) {
  if (!game?.boxArt) return true;
  if (force) return true;
  const onDisk = existsSync(join(publicRoot, game.boxArt));
  const inAssetList = Array.isArray(assets) && assets.includes(game.boxArt);
  return !onDisk && !inAssetList;
}

export async function listMissingBoxArt({ force = false } = {}) {
  const data = await readCompatibility();
  return (data.games || []).filter((game) => gameNeedsFetch(game, null, { force }));
}

export function getLibretroStatus() {
  return {
    configured: true,
    source: 'Libretro Thumbnails',
    baseUrl: LIBRETRO_BASE,
    authHint: 'No API keys — downloads from the public Libretro thumbnail CDN.',
    mediaType: 'Named_Boxarts',
    mediaNote: 'No-Intro style ROM names. Prefers USA / USA+Europe box art when available.',
  };
}

export async function boxartSearch(gameId) {
  const data = await readCompatibility();
  const game = findGame(data, gameId);
  const systemFolder = PLATFORM_FOLDERS[game.platform];
  const matcher = getMatcher(game.id);

  if (!systemFolder) {
    return {
      game: { id: game.id, title: game.title, platform: game.platform, boxArt: game.boxArt },
      candidates: [],
      hint: matcher.unsupported || `No Libretro system folder for platform “${game.platform}”. Add art manually.`,
    };
  }

  if (matcher.unsupported) {
    return {
      game: { id: game.id, title: game.title, platform: game.platform, boxArt: game.boxArt },
      candidates: [],
      hint: matcher.unsupported,
    };
  }

  const files = await fetchListing(systemFolder);
  const matched = matchCandidates(files, game.id, matcher).map((item) => ({
    ...item,
    url: boxartImageUrl(systemFolder, item.hrefPath),
    systemFolder,
  }));

  return {
    game: { id: game.id, title: game.title, platform: game.platform, boxArt: game.boxArt },
    systemFolder,
    candidates: matched,
    hint: matched.length
      ? `Found ${matched.length} box art option(s) on Libretro Thumbnails.`
      : 'No matching box art on Libretro for this game. Try another title or add art manually.',
  };
}

export async function boxartOptions(gameId, filename) {
  const search = await boxartSearch(gameId);
  const options = search.candidates.filter((c) => c.filename === filename || c.id === filename);
  if (!options.length) throw new Error(`Box art file not found in Libretro listing: ${filename}`);
  return { ...search, options, name: options[0].name };
}

export async function applyBoxArt({ gameId, imageUrl, filename }) {
  const data = await readCompatibility();
  const game = findGame(data, gameId);
  const systemFolder = PLATFORM_FOLDERS[game.platform];
  if (!systemFolder) throw new Error(`Platform “${game.platform}” is not supported on Libretro Thumbnails.`);

  const url = imageUrl || (filename ? boxartImageUrl(systemFolder, encodeURIComponent(filename)) : null);
  if (!url) throw new Error('imageUrl or filename is required');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);

  const dest = join(publicRoot, game.boxArt);
  await mkdir(dirname(dest), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, buffer);

  if (game.screenscraperId) delete game.screenscraperId;
  if (game.screenscraperSystemId) delete game.screenscraperSystemId;
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`);

  return {
    ok: true,
    gameId: game.id,
    title: game.title,
    path: game.boxArt,
    sourceUrl: url,
    bytes: buffer.length,
    contentType: response.headers.get('content-type') || 'image/png',
  };
}

export async function fetchBoxArtForGames({
  gameIds = null,
  force = false,
  onProgress = () => {},
} = {}) {
  const data = await readCompatibility();
  const allGames = data.games || [];
  let targets = allGames.filter((game) => gameNeedsFetch(game, null, { force }));
  if (gameIds?.length) {
    const wanted = new Set(gameIds);
    targets = allGames.filter((game) => wanted.has(game.id));
  }

  const results = [];
  for (let index = 0; index < targets.length; index += 1) {
    const game = targets[index];
    onProgress({ phase: 'start', index, total: targets.length, game });
    try {
      const search = await boxartSearch(game.id);
      const best = search.candidates.find((c) => c.recommended) || search.candidates[0];
      if (!best) throw new Error(search.hint || 'No Libretro box art match');

      const applied = await applyBoxArt({ gameId: game.id, imageUrl: best.url });
      results.push({
        ok: true,
        gameId: game.id,
        title: game.title,
        path: game.boxArt,
        sourceUrl: best.url,
        region: best.regionLabel,
        filename: best.filename,
        bytes: applied.bytes,
      });
      onProgress({ phase: 'done', index, total: targets.length, game, result: results.at(-1) });
    } catch (error) {
      results.push({
        ok: false,
        gameId: game.id,
        title: game.title,
        path: game.boxArt,
        error: error.message,
      });
      onProgress({ phase: 'error', index, total: targets.length, game, result: results.at(-1) });
    }
  }

  return {
    ok: results.every((item) => item.ok),
    fetched: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    skipped: allGames.length - targets.length,
    total: targets.length,
    results,
  };
}

function printSummary(summary) {
  console.log(`\nBox art fetch complete: ${summary.fetched} ok, ${summary.failed} failed, ${summary.skipped} skipped.`);
  for (const item of summary.results) {
    if (item.ok) console.log(`  ✓ ${item.title} → ${item.path}`);
    else console.log(`  ✗ ${item.title}: ${item.error}`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const force = args.has('--force');
  const only = [...args].filter((arg) => !arg.startsWith('--'));
  fetchBoxArtForGames({
    gameIds: only.length ? only : null,
    force,
    onProgress: ({ game, phase }) => {
      if (phase === 'start') process.stdout.write(`Fetching ${game.title}…\n`);
    },
  })
    .then(printSummary)
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
