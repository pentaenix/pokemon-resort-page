import http from 'node:http';
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join, extname, resolve, relative, basename, dirname } from 'node:path';
import { encodeOwmap, decodeOwmap, mapFromJson } from './lib/owmap-format.mjs';
import { bakeTerrainSpecials } from './public/ramp-specials.js';
import {
  ingestUploadArchive,
  ingestGlbUpload,
  inspectUploadArchive,
  inspectGlbUpload,
  sanitizeModelId,
} from './lib/model-ingest.mjs';
import { isValidModelId } from './lib/model-id.mjs';
import { readRawBody, parseMultipart, groupFolderUpload } from './lib/multipart.mjs';
import { saveUploadedAsset } from './lib/asset-upload.mjs';
import { ingestGlbBuffer } from './lib/glb-ingest.mjs';
import { reorientGlbBuffer } from './lib/reorient-glb.mjs';
import { spawn } from 'node:child_process';
import { loadProjectEnv } from '../lib/load-env.mjs';
import { docArticleRelativePath } from '../docs/article-path.mjs';
import { ideaArticleRelativePath } from '../ideas/article-path.mjs';
import { getGitHubStatus, listGitHubIssues } from '../lib/github-issues.mjs';
import {
  applyBoxArt,
  boxartOptions,
  boxartSearch,
  fetchBoxArtForGames,
  getLibretroStatus,
  listMissingBoxArt,
} from '../fetch-boxart.mjs';
import { LIBRETRO_BASE } from '../lib/libretro-thumbnails.mjs';

loadProjectEnv();
const root = resolve(new URL('../..', import.meta.url).pathname);
const adminRoot = join(root, 'tools/admin/public');

/** Decode URL-encoded public asset paths (spaces, unicode) without allowing traversal. */
function publicRelativePath(pathname) {
  const raw = pathname.replace(/^\//, '');
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const segments = decoded.replace(/\\/g, '/').split('/');
  if (segments.some((seg) => seg === '..')) throw new Error('Invalid path');
  return decoded;
}
const publicRoot = join(root, 'public');
const dataRoot = join(root, 'public/data');
const allowedData = new Set(['site.json','homepage.json','theme.json','research.json','atlas-pins.json','compatibility.json','features.json','bugs.json','gallery.json','models.json','characters.json','roadmap.json','ideas.json','docs.json']);
const docsArticlesRoot = join(root, 'public/docs/articles');
const ideasArticlesRoot = join(root, 'public/ideas/articles');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.owmap': 'application/octet-stream',
};
const mapSettingsPath = join(root, 'tools/admin/map-editor-settings.json');
const repoRoot = resolve(root, '..');

function isPathInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith('..'));
}

async function readMapSettings() {
  if (!existsSync(mapSettingsPath)) {
    return {
      mapsDirectory: 'pokemon-resort/assets/overworld/maps',
      modelsDirectory: 'pokemon-resort/assets/overworld/models',
    };
  }
  const parsed = JSON.parse(await readFile(mapSettingsPath, 'utf8'));
  return {
    mapsDirectory: parsed.mapsDirectory || 'pokemon-resort/assets/overworld/maps',
    modelsDirectory: parsed.modelsDirectory || 'pokemon-resort/assets/overworld/models',
  };
}

async function writeMapSettings(settings) {
  const current = await readMapSettings();
  const next = {
    mapsDirectory: String(settings.mapsDirectory || current.mapsDirectory).trim(),
    modelsDirectory: String(settings.modelsDirectory || current.modelsDirectory).trim(),
  };
  await writeFile(mapSettingsPath, JSON.stringify(next, null, 2) + '\n');
  return next;
}

function resolveModelsDirectory(settings, subPath = '') {
  const baseRel = settings.modelsDirectory || 'pokemon-resort/assets/overworld/models';
  const base = resolve(repoRoot, baseRel);
  const target = resolve(base, subPath || '');
  if (!isPathInside(target, repoRoot)) throw new Error('Models path must stay inside the workspace.');
  return { base, target };
}

async function listOverworldModels(settings) {
  const { base } = resolveModelsDirectory(settings);
  if (!existsSync(base)) return { base, models: [] };
  const entries = await readdir(base, { withFileTypes: true });
  const models = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const id = ent.name;
    const dir = join(base, id);
    const files = await readdir(dir);
    const glbFile = files.find((f) => f.endsWith('.glb'));
    if (!glbFile) continue;
    const manifestName = files.includes('model.json') ? 'model.json' : null;
    let manifest = { id, displayName: id };
    if (manifestName) {
      try {
        manifest = JSON.parse(await readFile(join(dir, manifestName), 'utf8'));
      } catch { /* keep default */ }
    }
    models.push({
      id,
      displayName: manifest.displayName || id,
      modelFile: manifest.glbFile || manifest.modelFile || glbFile,
      storageFormat: 'glb',
      footprintTiles: manifest.footprintTiles || { w: 1, d: 1, h: 1 },
      compiledAt: manifest.compiledAt || null,
      triangleCount: manifest.triangleCount || 0,
      modelHash: manifest.modelHash || null,
      aabb: manifest.aabb || null,
      defaultYawDeg: manifest.defaultYawDeg ?? 0,
      defaultScale: manifest.defaultScale ?? 1,
    });
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return { base, models };
}

async function writeIngestedModel(settings, ingestResult) {
  const { modelId, buffer, manifest } = ingestResult;
  const safeId = sanitizeModelId(modelId);
  if (!isValidModelId(safeId)) {
    throw new Error('Invalid model id — use letters, numbers, underscore, or hyphen (e.g. pokemon_center).');
  }
  const { target } = resolveModelsDirectory(settings, safeId);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(target, { recursive: true });
  const assetName = manifest.glbFile || `${safeId}.glb`;
  const assetPath = join(target, assetName);
  const manifestPath = join(target, 'model.json');
  await writeFile(assetPath, buffer);
  await writeFile(manifestPath, JSON.stringify({
    ...manifest,
    id: safeId,
    storageFormat: 'glb',
    glbFile: assetName,
    modelFile: assetName,
  }, null, 2) + '\n');
  return {
    modelId: safeId,
    modelPath: assetPath,
    manifestPath,
    bytes: buffer.length,
    resolvedDirectory: target,
    storageFormat: 'glb',
  };
}

function resolveMapsDirectory(settings, subPath = '') {
  const baseRel = settings.mapsDirectory || 'pokemon-resort/assets/overworld/maps';
  const base = resolve(repoRoot, baseRel);
  const target = resolve(base, subPath || '');
  if (!isPathInside(target, repoRoot)) throw new Error('Maps path must stay inside the workspace.');
  return { base, target };
}

async function listMapFiles(settings) {
  const { base } = resolveMapsDirectory(settings);
  if (!existsSync(base)) return { base, files: [] };
  const names = await readdir(base);
  const files = names
    .filter((name) => /\.(owmap|map\.json)$/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, kind: name.endsWith('.owmap') ? 'owmap' : 'json' }));
  return { base, files };
}

async function readMapFile(settings, fileName) {
  const safe = basename(fileName);
  if (!safe || safe !== fileName) throw new Error('Invalid file name.');
  const { target } = resolveMapsDirectory(settings, safe);
  if (!existsSync(target)) throw new Error(`Map not found: ${safe}`);
  if (safe.endsWith('.owmap')) {
    const buf = await readFile(target);
    return { fileName: safe, map: decodeOwmap(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) };
  }
  if (safe.endsWith('.map.json')) {
    const json = JSON.parse(await readFile(target, 'utf8'));
    return { fileName: safe, map: mapFromJson(json) };
  }
  throw new Error('Only .owmap and .map.json files are supported.');
}

async function writeMapOwmap(settings, fileName, map) {
  const safe = basename(fileName);
  if (!safe.endsWith('.owmap')) throw new Error('Map file must end with .owmap');
  const { base, target } = resolveMapsDirectory(settings, safe);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(base, { recursive: true });
  const { map: baked, bakedCount, clearedCount } = bakeTerrainSpecials(map);
  const buf = Buffer.from(encodeOwmap(baked));
  await writeFile(target, buf);
  return { fileName: safe, bytes: buf.length, bakedRamps: bakedCount, clearedAutoRamps: clearedCount };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 15_000_000) reject(new Error('Body too large')); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}
/** Write succeeded: always HTTP 200. Validation runs for feedback; publish still blocks on failure. */
async function respondAfterSave(res) {
  const validation = await run('node', ['tools/validate-data.mjs']);
  const text = (validation.out || validation.err || '').trim();
  return json(res, 200, {
    ok: true,
    saved: true,
    validationOk: validation.code === 0,
    validation: text,
    ...(validation.code === 0
      ? {}
      : { validationWarning: 'Saved. Fix validation issues before publish (see activity log).' }),
  });
}
function run(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, shell: process.platform === 'win32' });
    let out = '', err = '';
    child.stdout.on('data', (data) => out += data);
    child.stderr.on('data', (data) => err += data);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}
async function readJsonFile(file) {
  const path = join(dataRoot, file);
  if (!existsSync(path)) {
    throw new Error(`ENOENT: no such file or directory, open '${path}' — expected public/data/${file}. Restart the Operations Desk (npm run admin) after pulling the research/pois split.`);
  }
  return JSON.parse(await readFile(path, 'utf8'));
}
async function migrateLegacyResearchPois() {
  const legacyPath = join(dataRoot, 'research-pois.json');
  const researchPath = join(dataRoot, 'research.json');
  const poisPath = join(dataRoot, 'pois.json');
  if (!existsSync(legacyPath)) return;
  const legacy = JSON.parse(await readFile(legacyPath, 'utf8'));
  if (!existsSync(poisPath) && Array.isArray(legacy.pois)) {
    await writeFile(poisPath, JSON.stringify({ pois: legacy.pois, confidenceLegend: legacy.confidenceLegend || [] }, null, 2) + '\n');
  }
  if (!existsSync(researchPath)) {
    await writeFile(researchPath, JSON.stringify({
      entries: [],
      categories: ['Location', 'Character', 'Pokémon', 'Species', 'Mechanic', 'Region', 'Timeline', 'Asset', 'Other'],
      confidenceLegend: legacy.confidenceLegend || [],
    }, null, 2) + '\n');
  }
}
async function readArticleBodies(rootDir) {
  if (!existsSync(rootDir)) return {};
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const out = {};
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        Object.assign(out, await walk(full));
      } else if (entry.name.endsWith('.json')) {
        const slug = entry.name.replace(/\.json$/, '');
        out[slug] = JSON.parse(await readFile(full, 'utf8'));
      }
    }
    return out;
  }
  return walk(rootDir);
}
async function readDocArticles() {
  return readArticleBodies(docsArticlesRoot);
}
async function readIdeaArticles() {
  return readArticleBodies(ideasArticlesRoot);
}
async function readAllData() {
  await migrateLegacyResearchPois();
  const entries = await Promise.all([...allowedData].map(async (file) => [file, await readJsonFile(file)]));
  const data = Object.fromEntries(entries);
  if (existsSync(join(dataRoot, 'research-pois.json'))) {
    data['research-pois.json'] = await readJsonFile('research-pois.json');
  }
  return {
    files: data,
    docArticles: await readDocArticles(),
    ideaArticles: await readIdeaArticles(),
  };
}
async function listAssets() {
  async function walk(dir, base='') {
    const fs = await import('node:fs/promises');
    if (!existsSync(dir)) return [];
    const items = await fs.readdir(dir, { withFileTypes: true });
    const found = [];
    for (const item of items) {
      const rel = base ? `${base}/${item.name}` : item.name;
      const full = join(dir, item.name);
      if (item.isDirectory()) found.push(...await walk(full, rel));
      else if (/\.(png|jpg|jpeg|webp|svg|gif|mp4|glb|gltf)$/i.test(item.name)) found.push(rel);
    }
    return found;
  }
  return walk(publicRoot);
}

const DESK_API_VERSION = 3;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/admin/capabilities') {
      return json(res, 200, {
        ok: true,
        version: DESK_API_VERSION,
        features: ['maps', 'overworld-models', 'overworld-model-delete', 'overworld-model-zip', 'owmap-bake'],
      });
    }
    if (url.pathname === '/api/data') return json(res, 200, await readAllData());
    if (url.pathname === '/api/assets') return json(res, 200, { assets: await listAssets() });
    if (url.pathname === '/api/assets/upload' && req.method === 'POST') {
      try {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) {
          return json(res, 400, { ok: false, error: 'Expected multipart upload' });
        }
        const raw = await readRawBody(req, 55_000_000);
        const parts = parseMultipart(raw, contentType);
        let filePart = null;
        let folder = 'media/uploads';
        let subdir = '';
        for (const part of parts) {
          if (part.name === 'folder' && part.bytes.length) {
            folder = part.bytes.toString('utf8').trim();
            continue;
          }
          if (part.name === 'subdir' && part.bytes.length) {
            subdir = part.bytes.toString('utf8').trim();
            continue;
          }
          if ((part.name === 'file' || part.filename) && part.bytes.length) {
            filePart = part;
          }
        }
        if (!filePart) {
          return json(res, 400, { ok: false, error: 'No file in upload (field: file).' });
        }
        const { path, deduped } = await saveUploadedAsset(
          publicRoot,
          folder,
          filePart.filename || 'upload.webp',
          filePart.bytes,
          subdir,
        );
        return json(res, 200, { ok: true, path, deduped, assets: await listAssets() });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/boxart/status') {
      const missing = await listMissingBoxArt();
      return json(res, 200, {
        ...getLibretroStatus(),
        missingCount: missing.length,
        missing: missing.map((game) => ({ id: game.id, title: game.title, boxArt: game.boxArt, platform: game.platform })),
      });
    }
    if (url.pathname === '/api/boxart/search') {
      const gameId = url.searchParams.get('gameId');
      if (!gameId) return json(res, 400, { ok: false, error: 'gameId query parameter is required.' });
      try {
        const result = await boxartSearch(gameId);
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 500, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/boxart/options') {
      const gameId = url.searchParams.get('gameId');
      const filename = url.searchParams.get('filename');
      if (!gameId || !filename) {
        return json(res, 400, { ok: false, error: 'gameId and filename are required.' });
      }
      try {
        const result = await boxartOptions(gameId, filename);
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 500, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/boxart/apply' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      try {
        const result = await applyBoxArt(payload);
        const assets = await listAssets();
        return json(res, 200, { ok: true, ...result, assets });
      } catch (error) {
        return json(res, 500, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/boxart/proxy') {
      const imageUrl = url.searchParams.get('url');
      if (!imageUrl?.startsWith(LIBRETRO_BASE)) {
        return json(res, 400, { ok: false, error: 'Only Libretro Thumbnails URLs are allowed.' });
      }
      const response = await fetch(imageUrl);
      if (!response.ok) return json(res, 502, { ok: false, error: `Upstream HTTP ${response.status}` });
      const buffer = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get('content-type') || 'image/png';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' });
      res.end(buffer);
      return;
    }
    if (url.pathname === '/api/boxart/fetch' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      try {
        const summary = await fetchBoxArtForGames({
          gameIds: payload.gameIds || null,
          force: Boolean(payload.force),
        });
        const assets = await listAssets();
        return json(res, 200, {
          ok: summary.fetched > 0 || summary.total === 0,
          ...summary,
          assets,
        });
      } catch (error) {
        return json(res, 500, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/github/status') {
      return json(res, 200, { ok: true, ...(await getGitHubStatus()) });
    }
    if (url.pathname === '/api/github/issues') {
      const state = url.searchParams.get('state') || 'open';
      try {
        const result = await listGitHubIssues({ state, perPage: Number(url.searchParams.get('limit') || 40) });
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 500, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/status') {
      const status = await run('git', ['status', '--short']);
      return json(res, 200, { ok: status.code === 0, output: status.out || status.err });
    }
    if (url.pathname === '/api/docs/save-article' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      const slug = String(payload.slug || '').trim().replace(/[^a-z0-9-]/gi, '');
      if (!slug) return json(res, 400, { ok: false, error: 'slug is required' });
      const docsManifest = JSON.parse(await readFile(join(dataRoot, 'docs.json'), 'utf8'));
      const card = (docsManifest.articles || []).find((item) => item.slug === slug);
      if (!card) {
        return json(res, 404, { ok: false, error: `No docs.json card for slug "${slug}". Add the card before saving the body.` });
      }
      const rel = docArticleRelativePath(card);
      const target = join(docsArticlesRoot, rel);
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dirname(target), { recursive: true });
      const body = payload.data && typeof payload.data === 'object' ? payload.data : { dossier: payload.dossier };
      await writeFile(target, JSON.stringify(body, null, 2) + '\n');
      return respondAfterSave(res);
    }
    if (url.pathname === '/api/ideas/save-article' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      const slug = String(payload.slug || '').trim().replace(/[^a-z0-9-]/gi, '');
      if (!slug) return json(res, 400, { ok: false, error: 'slug is required' });
      const ideasManifest = JSON.parse(await readFile(join(dataRoot, 'ideas.json'), 'utf8'));
      const card = (ideasManifest.items || []).find((item) => item.slug === slug || item.id === slug);
      if (!card) {
        return json(res, 404, { ok: false, error: `No ideas.json card for slug "${slug}". Add the card before saving the body.` });
      }
      const rel = ideaArticleRelativePath(card);
      const target = join(ideasArticlesRoot, rel);
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dirname(target), { recursive: true });
      const body = payload.data && typeof payload.data === 'object' ? payload.data : { dossier: payload.dossier };
      await writeFile(target, JSON.stringify(body, null, 2) + '\n');
      return respondAfterSave(res);
    }
    if (url.pathname === '/api/save' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      if (payload.file === 'research-pois.json') {
        return json(res, 400, {
          ok: false,
          error: 'research-pois.json was split into research.json (Concierge Research) and pois.json (Atlas). Save from Workshop → Research or Atlas POIs. Restart the desk if you still see this.',
        });
      }
      if (!allowedData.has(payload.file)) return json(res, 400, { ok: false, error: 'File is not editable by this tool.' });
      await writeFile(join(dataRoot, payload.file), JSON.stringify(payload.data, null, 2) + '\n');
      return respondAfterSave(res);
    }
    if (url.pathname === '/api/maps/settings') {
      const settings = await readMapSettings();
      if (req.method === 'POST') {
        const payload = JSON.parse(await readBody(req));
        const next = await writeMapSettings(payload);
        resolveMapsDirectory(next);
        resolveModelsDirectory(next);
        const { base } = resolveMapsDirectory(next);
        const { base: modelsBase } = resolveModelsDirectory(next);
        return json(res, 200, { ok: true, settings: next, resolvedPath: base, modelsResolvedPath: modelsBase });
      }
      const { base } = resolveMapsDirectory(settings);
      const { base: modelsBase } = resolveModelsDirectory(settings);
      return json(res, 200, { ok: true, settings, resolvedPath: base, modelsResolvedPath: modelsBase });
    }
    if (url.pathname === '/api/overworld-models/list') {
      const settings = await readMapSettings();
      const listing = await listOverworldModels(settings);
      return json(res, 200, { ok: true, ...listing, settings });
    }
    if (url.pathname === '/api/overworld-models/manifest') {
      const settings = await readMapSettings();
      const id = url.searchParams.get('id');
      if (!id) return json(res, 400, { ok: false, error: 'id is required' });
      const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const manifestPath = resolveModelsDirectory(settings, join(safe, 'model.json')).target;
      if (!existsSync(manifestPath)) return json(res, 404, { ok: false, error: 'Model not found' });
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      return json(res, 200, { ok: true, manifest });
    }
    if (url.pathname === '/api/overworld-models/glb') {
      const settings = await readMapSettings();
      const id = url.searchParams.get('id');
      if (!id) return json(res, 400, { ok: false, error: 'id is required' });
      const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const { target: dir } = resolveModelsDirectory(settings, safe);
      if (!existsSync(dir)) return json(res, 404, { ok: false, error: 'Model not found' });
      const names = await readdir(dir);
      let manifest = {};
      const manifestPath = join(dir, 'model.json');
      if (existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        } catch { /* ignore */ }
      }
      const glbName = names.find((n) => n.endsWith('.glb'))
        || (manifest.glbFile && names.includes(manifest.glbFile) ? manifest.glbFile : null)
        || `${safe}.glb`;
      const filePath = join(dir, glbName);
      if (!existsSync(filePath)) {
        return json(res, 404, { ok: false, error: 'GLB file missing' });
      }
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
      createReadStream(filePath).pipe(res);
      return;
    }
    if (url.pathname === '/api/overworld-models/delete' && (req.method === 'POST' || req.method === 'DELETE')) {
      const settings = await readMapSettings();
      try {
        let id = url.searchParams.get('id');
        if (!id && (req.method === 'POST' || req.method === 'DELETE')) {
          const raw = await readBody(req);
          if (raw?.trim()) {
            const payload = JSON.parse(raw);
            id = payload?.id;
          }
        }
        if (!id) return json(res, 400, { ok: false, error: 'id is required' });
        const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const { target: dir } = resolveModelsDirectory(settings, safe);
        if (!existsSync(dir)) return json(res, 404, { ok: false, error: 'Model not found' });
        await rm(dir, { recursive: true, force: true });
        return json(res, 200, { ok: true, id: safe, deleted: dir });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/overworld-models/meta' && req.method === 'POST') {
      const settings = await readMapSettings();
      try {
        const raw = await readBody(req);
        const payload = raw?.trim() ? JSON.parse(raw) : {};
        const id = payload?.id;
        if (!id) return json(res, 400, { ok: false, error: 'id is required' });
        const safe = sanitizeModelId(id);
        if (!isValidModelId(safe)) return json(res, 400, { ok: false, error: 'Invalid model id.' });
        const { target: dir } = resolveModelsDirectory(settings, safe);
        if (!existsSync(dir)) return json(res, 404, { ok: false, error: 'Model not found' });
        const manifestPath = join(dir, 'model.json');
        let manifest = { id: safe, displayName: safe };
        if (existsSync(manifestPath)) {
          try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* keep */ }
        }
        if (typeof payload.displayName === 'string' && payload.displayName.trim()) {
          manifest.displayName = payload.displayName.trim();
        }
        if (payload.defaultYawDeg !== undefined && payload.defaultYawDeg !== null) {
          manifest.defaultYawDeg = ((Number(payload.defaultYawDeg) % 360) + 360) % 360;
        }
        if (payload.defaultScale !== undefined && payload.defaultScale !== null) {
          manifest.defaultScale = Math.max(0.05, Math.min(20, Number(payload.defaultScale) || 1));
        }
        manifest.id = safe;
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        return json(res, 200, { ok: true, id: safe, manifest });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/overworld-models/reorient' && req.method === 'POST') {
      const settings = await readMapSettings();
      try {
        const raw = await readBody(req);
        const payload = raw?.trim() ? JSON.parse(raw) : {};
        const id = payload?.id;
        if (!id) return json(res, 400, { ok: false, error: 'id is required' });
        const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const { target: dir } = resolveModelsDirectory(settings, safe);
        if (!existsSync(dir)) return json(res, 404, { ok: false, error: 'Model not found' });
        const names = await readdir(dir);
        const glbName = names.find((n) => n.endsWith('.glb'));
        if (!glbName) return json(res, 404, { ok: false, error: 'GLB file missing' });

        // Preserve the operator-facing display name across the re-bake.
        let priorDisplayName = safe;
        const manifestPath = join(dir, 'model.json');
        if (existsSync(manifestPath)) {
          try { priorDisplayName = JSON.parse(await readFile(manifestPath, 'utf8')).displayName || safe; }
          catch { /* keep default */ }
        }

        const sourceGlb = await readFile(join(dir, glbName));
        const reoriented = reorientGlbBuffer(sourceGlb, {
          rotX: Number(payload.rotX) || 0,
          rotY: Number(payload.rotY) || 0,
          rotZ: Number(payload.rotZ) || 0,
        }, safe);
        const ingest = ingestGlbBuffer(reoriented, safe, glbName);
        ingest.manifest.displayName = priorDisplayName;
        const saved = await writeIngestedModel(settings, ingest);
        return json(res, 200, {
          ok: true,
          ...saved,
          manifest: ingest.manifest,
          modelHash: ingest.manifest.modelHash,
        });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/overworld-models/inspect' && req.method === 'POST') {
      try {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) {
          return json(res, 400, { ok: false, error: 'Expected multipart upload' });
        }
        const raw = await readRawBody(req);
        const parts = parseMultipart(raw, contentType);
        const { archive, glb, glbName } = groupFolderUpload(parts);
        if (glb?.length) {
          const check = inspectGlbUpload(glb, glbName);
          return json(res, 200, { ok: true, ...check });
        }
        if (!archive?.length) {
          return json(res, 400, { ok: false, error: 'Upload a .glb file or a .zip archive (field: glb or archive).' });
        }
        const check = inspectUploadArchive(archive);
        return json(res, 200, { ok: true, ...check });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/overworld-models/compile' && req.method === 'POST') {
      const settings = await readMapSettings();
      try {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) {
          return json(res, 400, { ok: false, error: 'Expected multipart upload' });
        }
        const raw = await readRawBody(req);
        const parts = parseMultipart(raw, contentType);
        const {
          modelId,
          displayName,
          defaultYawDeg,
          defaultScale,
          archive,
          glb,
          glbName,
        } = groupFolderUpload(parts);
        const safeId = sanitizeModelId(modelId);
        if (!isValidModelId(safeId)) {
          return json(res, 400, {
            ok: false,
            error: 'Model id is required — use letters, numbers, underscore, or hyphen (e.g. pokemon_center).',
          });
        }
        const meta = { displayName, defaultYawDeg, defaultScale };
        let result;
        if (glb?.length) {
          result = ingestGlbUpload(glb, safeId, glbName, meta);
        } else if (archive?.length) {
          result = await ingestUploadArchive(archive, safeId, meta);
        } else {
          return json(res, 400, { ok: false, error: 'Upload a .glb file or a .zip containing a .glb or OBJ+MTL+textures.' });
        }
        const saved = await writeIngestedModel(settings, result);
        const { base } = resolveModelsDirectory(settings);
        return json(res, 200, {
          ok: true,
          ...saved,
          manifest: result.manifest,
          warnings: result.warnings,
          sourceFormat: result.sourceFormat,
          modelsDirectory: base,
        });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/maps/list') {
      const settings = await readMapSettings();
      const listing = await listMapFiles(settings);
      return json(res, 200, { ok: true, ...listing, settings });
    }
    if (url.pathname === '/api/maps/file') {
      const settings = await readMapSettings();
      const fileName = url.searchParams.get('file');
      if (!fileName) return json(res, 400, { ok: false, error: 'file query parameter is required.' });
      try {
        const result = await readMapFile(settings, fileName);
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 404, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/maps/save' && req.method === 'POST') {
      const settings = await readMapSettings();
      const payload = JSON.parse(await readBody(req));
      try {
        const result = await writeMapOwmap(settings, payload.fileName, payload.map);
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/maps/import-json' && req.method === 'POST') {
      const settings = await readMapSettings();
      const payload = JSON.parse(await readBody(req));
      try {
        const map = mapFromJson(payload.map || payload.json);
        const fileName = payload.fileName || `${map.id || 'imported_map'}.owmap`;
        const result = await writeMapOwmap(settings, fileName.endsWith('.owmap') ? fileName : `${fileName}.owmap`, map);
        return json(res, 200, { ok: true, map, ...result });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/maps/export') {
      const settings = await readMapSettings();
      const fileName = url.searchParams.get('file');
      if (!fileName) return json(res, 400, { ok: false, error: 'file query parameter is required.' });
      try {
        const { target } = resolveMapsDirectory(settings, basename(fileName));
        if (!existsSync(target)) return json(res, 404, { ok: false, error: 'Not found' });
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${basename(fileName)}"`,
        });
        createReadStream(target).pipe(res);
        return;
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/maps/export-body' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      try {
        const { map: baked } = bakeTerrainSpecials(payload.map);
        const buf = Buffer.from(encodeOwmap(baked));
        const fileName = payload.fileName || 'map.owmap';
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${basename(fileName)}"`,
        });
        res.end(buf);
        return;
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/publish' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      const message = payload.message || 'Update resort data';
      const validation = await run('node', ['tools/validate-data.mjs']);
      if (validation.code !== 0) return json(res, 422, { ok: false, step: 'validate', output: validation.out || validation.err });
      const add = await run('git', ['add', 'public/data', 'public/docs', 'public/assets', 'public/media']);
      const commit = await run('git', ['commit', '-m', message]);
      const commitOutput = commit.out || commit.err;
      const noChanges = /nothing to commit|no changes added/i.test(commitOutput);
      const push = noChanges ? { code: 0, out: 'No changes to push.', err: '' } : await run('git', ['push', 'origin', 'main']);
      return json(res, push.code === 0 ? 200 : 500, { ok: push.code === 0, validation: validation.out, add: add.out || add.err, commit: commitOutput, push: push.out || push.err });
    }

    let filePath;
    const threeRoot = join(root, 'node_modules/three');
    const mermaidRoot = join(root, 'node_modules/mermaid');
    if (url.pathname === '/vendor/three.module.js') {
      filePath = join(threeRoot, 'build/three.module.js');
    } else if (url.pathname === '/vendor/three.core.js') {
      // three.module.js (r184+) imports this sibling chunk; import map only remaps the entry.
      filePath = join(threeRoot, 'build/three.core.js');
    } else if (url.pathname.startsWith('/vendor/three-addons/')) {
      const sub = url.pathname.slice('/vendor/three-addons/'.length);
      filePath = join(threeRoot, 'examples/jsm', sub);
    } else if (url.pathname.startsWith('/vendor/mermaid/')) {
      const sub = url.pathname.slice('/vendor/mermaid/'.length);
      filePath = join(mermaidRoot, sub);
    } else if (url.pathname.startsWith('/docs/')) {
      filePath = join(publicRoot, publicRelativePath(url.pathname));
    } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/')) {
      filePath = join(publicRoot, publicRelativePath(url.pathname));
    } else {
      filePath = url.pathname === '/' ? join(adminRoot, 'index.html') : join(adminRoot, url.pathname.replace(/^\//, ''));
    }
    const allowedRoot = url.pathname.startsWith('/vendor/mermaid/')
      ? mermaidRoot
      : url.pathname.startsWith('/vendor/')
      ? threeRoot
      : (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/docs/')) ? publicRoot : adminRoot;
    const insideAllowed = filePath.startsWith(allowedRoot)
      || (url.pathname.startsWith('/vendor/three-addons/') && filePath.startsWith(join(threeRoot, 'examples/jsm')))
      || (url.pathname.startsWith('/vendor/mermaid/') && filePath.startsWith(mermaidRoot));
    if (!insideAllowed || !existsSync(filePath)) return json(res, 404, { error: 'Not found' });
    const type = mime[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    json(res, 500, { ok: false, error: error.message });
  }
});

/** Default desk port (8787 = Headroom proxy; 8788 = SPMK — see DEV-PORTS.md). Override: PORT=… npm run admin */
const DEFAULT_ADMIN_PORT = 9477;
const port = Number(process.env.PORT || DEFAULT_ADMIN_PORT);
server.listen(port, '127.0.0.1', () => {
  console.log(`Resort Operations Desk: http://127.0.0.1:${port}`);
  console.log('  Map editor APIs: /api/maps/*, /api/overworld-models/* (incl. delete)');
});
