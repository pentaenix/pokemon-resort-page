import http, { request as httpRequest } from 'node:http';
import { readFile, writeFile, readdir, rm, mkdir, copyFile, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join, extname, resolve, relative, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { encodeOwmap, decodeOwmap, mapFromJson, emptyMap } from './lib/owmap-format.mjs';
import { bakeTerrainSpecials } from './shared/ramp-specials.js';
import { loadEditorManifests } from './lib/editor-registry.mjs';
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
import { replaceIslandModelGlb } from './lib/island-model.mjs';
import { parseGlb } from './lib/glb-compile.mjs';
import { pngTransparencyKind } from './lib/texture-alpha.mjs';
import { reorientGlbBuffer } from './lib/reorient-glb.mjs';
import { spawn, execSync } from 'node:child_process';
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
import { handleDataEditorApi } from './modules/dataeditor/server-api.mjs';
import { handleScriptEngineApi } from './modules/scriptengine/server-api.mjs';
import {
  addTileToPack,
  addTilesToPack,
  inspectTileBundle,
  loadEditableTilePack,
  saveTilePackDocument,
} from './lib/tile-pack-authoring.mjs';

loadProjectEnv();
const root = resolve(new URL('../..', import.meta.url).pathname);
const adminRoot = join(root, 'tools/admin/public');
const modulesRoot = join(root, 'tools/admin/modules');
const sharedRoot = join(root, 'tools/admin/shared');

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
const mapSettingsPath = join(modulesRoot, 'mapeditor/settings.json');
const mapProjectsRoot = join(root, 'tools/admin/data/map-projects');
const characterEditorModuleRoot = join(modulesRoot, 'charactereditor');
const characterEditorSettingsPath = join(characterEditorModuleRoot, 'settings.json');
const CHARACTER_EDITOR_HOST = '127.0.0.1';
const CHARACTER_EDITOR_PORT = Number(process.env.CHARACTER_EDITOR_PORT || 8789);
const repoRoot = resolve(root, '..');
const rtpksArchiveCache = new Map();
const rtpksInspectionCache = new Map();

async function readRtpksArchive(filePath) {
  const info = await stat(filePath);
  const signature = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const cached = rtpksArchiveCache.get(filePath);
  if (cached?.signature === signature) return cached.entries;

  // Store the promise before file I/O finishes. Concurrent mesh/texture requests
  // for one map then share a single read + unzip instead of each inflating the
  // complete RTPKS archive independently.
  const entries = readFile(filePath)
    .then((bytes) => unzipSync(new Uint8Array(bytes)))
    .catch((error) => {
      if (rtpksArchiveCache.get(filePath)?.entries === entries) {
        rtpksArchiveCache.delete(filePath);
      }
      throw error;
    });
  rtpksArchiveCache.set(filePath, { signature, entries });
  return entries;
}

function resolveModulesFile(pathname) {
  const rel = pathname.replace(/^\/modules\//, '').replace(/\\/g, '/');
  const segments = rel.split('/').filter(Boolean);
  if (!segments.length) return null;
  const blocked = new Set(['.venv', 'spmk_app', 'workspace', '__pycache__', 'node_modules']);
  if (segments.some((seg) => blocked.has(seg) || seg.startsWith('.'))) return null;
  const filePath = join(modulesRoot, ...segments);
  if (!isPathInside(filePath, modulesRoot)) return null;
  return filePath;
}

function resolveSharedFile(pathname) {
  const rel = pathname.replace(/^\/shared\//, '').replace(/\\/g, '/');
  const segments = rel.split('/').filter(Boolean);
  if (!segments.length || segments.some((seg) => seg === '..' || seg.startsWith('.'))) return null;
  const filePath = join(sharedRoot, ...segments);
  if (!isPathInside(filePath, sharedRoot)) return null;
  return filePath;
}

let cachedEditorTools = null;
async function getEditorTools() {
  if (!cachedEditorTools) cachedEditorTools = await loadEditorManifests(modulesRoot);
  return cachedEditorTools;
}

function isPathInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith('..'));
}

async function readMapSettings() {
  if (!existsSync(mapSettingsPath)) {
    return {
      mapsDirectory: 'pokemon-resort/assets/overworld/maps',
      modelsDirectory: 'pokemon-resort/assets/overworld/models',
      tilePackagesDirectory: 'pokemon-resort/assets/overworld/tilepacks',
    };
  }
  const parsed = JSON.parse(await readFile(mapSettingsPath, 'utf8'));
  return {
    mapsDirectory: parsed.mapsDirectory || 'pokemon-resort/assets/overworld/maps',
    modelsDirectory: parsed.modelsDirectory || 'pokemon-resort/assets/overworld/models',
    tilePackagesDirectory: parsed.tilePackagesDirectory || 'pokemon-resort/assets/overworld/tilepacks',
  };
}

async function writeMapSettings(settings) {
  const current = await readMapSettings();
  const next = {
    mapsDirectory: String(settings.mapsDirectory || current.mapsDirectory).trim(),
    modelsDirectory: String(settings.modelsDirectory || current.modelsDirectory).trim(),
    tilePackagesDirectory: String(settings.tilePackagesDirectory || current.tilePackagesDirectory).trim(),
  };
  await writeFile(mapSettingsPath, JSON.stringify(next, null, 2) + '\n');
  return next;
}

async function readCharacterEditorSettings() {
  const rel = 'pokemon-resort/assets/characters';
  if (!existsSync(characterEditorSettingsPath)) {
    return { charactersDirectory: resolve(repoRoot, rel) };
  }
  const parsed = JSON.parse(await readFile(characterEditorSettingsPath, 'utf8'));
  const configured = String(parsed.charactersDirectory || rel).trim();
  return { charactersDirectory: resolve(repoRoot, configured) };
}

let characterEditorChild = null;
let characterEditorStartPromise = null;

function characterEditorPython() {
  const venvPython = join(characterEditorModuleRoot, '.venv/bin/python');
  if (existsSync(venvPython)) return venvPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function characterEditorAlive() {
  return Boolean(characterEditorChild && characterEditorChild.exitCode === null && !characterEditorChild.killed);
}

function characterEditorHealth(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = httpRequest({
      hostname: CHARACTER_EDITOR_HOST,
      port: CHARACTER_EDITOR_PORT,
      path: '/api/health',
      method: 'GET',
      timeout: timeoutMs,
    }, (upstream) => {
      let body = '';
      upstream.on('data', (chunk) => { body += chunk; });
      upstream.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(upstream.statusCode === 200 && data?.ok !== false);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function getCharacterEditorStatus() {
  const settings = await readCharacterEditorSettings();
  const alive = characterEditorAlive();
  const healthy = alive || await characterEditorHealth(3000);
  return {
    ok: true,
    running: healthy,
    healthy,
    port: CHARACTER_EDITOR_PORT,
    charactersDirectory: settings.charactersDirectory,
    pid: alive ? characterEditorChild.pid : null,
  };
}

async function waitForCharacterEditorHealth(maxMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await characterEditorHealth()) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function startCharacterEditor() {
  if (characterEditorStartPromise) return characterEditorStartPromise;
  if (characterEditorAlive()) {
    const healthy = await characterEditorHealth();
    if (healthy) return getCharacterEditorStatus();
  }

  characterEditorStartPromise = (async () => {
    const settings = await readCharacterEditorSettings();
    const python = characterEditorPython();
    const env = {
      ...process.env,
      SPMK_ROOT: characterEditorModuleRoot,
      SPMK_CHARACTERS_DIR: settings.charactersDirectory,
    };
    const child = spawn(
      python,
      ['-m', 'spmk_app.server', '--host', CHARACTER_EDITOR_HOST, '--port', String(CHARACTER_EDITOR_PORT)],
      { cwd: characterEditorModuleRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    characterEditorChild = child;
    child.stdout?.on('data', (data) => process.stderr.write(`[character-editor] ${data}`));
    child.stderr?.on('data', (data) => process.stderr.write(`[character-editor] ${data}`));
    child.on('exit', () => {
      if (characterEditorChild === child) characterEditorChild = null;
      characterEditorStartPromise = null;
    });

    const healthy = await waitForCharacterEditorHealth();
    if (!healthy) {
      if (await characterEditorHealth(3000)) {
        return getCharacterEditorStatus();
      }
      stopCharacterEditor();
      throw new Error(
        'Character editor failed to start. From tools/admin/modules/charactereditor run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt',
      );
    }
    return getCharacterEditorStatus();
  })();

  try {
    return await characterEditorStartPromise;
  } finally {
    if (characterEditorAlive()) characterEditorStartPromise = null;
  }
}

function stopCharacterEditor() {
  if (!characterEditorChild || characterEditorChild.killed) {
    characterEditorChild = null;
    characterEditorStartPromise = null;
    return;
  }
  try {
    characterEditorChild.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  characterEditorChild = null;
  characterEditorStartPromise = null;
}

function proxyCharacterEditorRequest(req, res, url, { stripPrefix = '' } = {}) {
  const upstreamPath = stripPrefix
    ? (url.pathname.slice(stripPrefix.length) || '/')
    : url.pathname;
  const options = {
    hostname: CHARACTER_EDITOR_HOST,
    port: CHARACTER_EDITOR_PORT,
    path: `${upstreamPath}${url.search || ''}`,
    method: req.method,
    headers: { ...req.headers, host: `${CHARACTER_EDITOR_HOST}:${CHARACTER_EDITOR_PORT}` },
  };
  delete options.headers.connection;
  const proxyReq = httpRequest(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (error) => {
    if (!res.headersSent) json(res, 502, { ok: false, error: `Character editor proxy failed: ${error.message}` });
  });
  req.pipe(proxyReq);
}

/** SPMK / character-editor API paths proxied when the subprocess is running (not admin desk routes). */
function shouldProxyToCharacterEditor(pathname) {
  if (pathname.startsWith('/asset/')) return true;
  const prefixes = [
    '/api/packages',
    '/api/project',
    '/api/character',
    '/api/upload',
    '/api/sheet-version',
    '/api/sheet-family',
    '/api/sheet',
    '/api/templates',
    '/api/template',
    '/api/actions',
    '/api/behaviors',
    '/api/generate',
    '/api/batch',
    '/api/export',
    '/api/training-pair',
    '/api/train',
    '/api/scale',
    '/api/save-edited',
    '/api/learned',
    '/api/generated',
  ];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

async function characterEditorReachable() {
  // Trust our subprocess while it is alive — batch import can block health for seconds.
  if (characterEditorAlive()) return true;
  return characterEditorHealth();
}

async function ensureCharacterEditorRunning() {
  if (await characterEditorReachable()) return true;
  try {
    await startCharacterEditor();
  } catch {
    /* fall through */
  }
  return characterEditorReachable();
}

async function proxyCharacterEditorIfNeeded(req, res, url) {
  if (!shouldProxyToCharacterEditor(url.pathname)) return false;
  if (!(await ensureCharacterEditorRunning())) {
    json(res, 503, { ok: false, error: 'Character editor is not running.' });
    return true;
  }
  proxyCharacterEditorRequest(req, res, url);
  return true;
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
      renderFootprintTiles: manifest.renderFootprintTiles || manifest.footprintTiles || { w: 1, d: 1, h: 1 },
      authoringFootprintTiles: manifest.authoringFootprintTiles || manifest.footprintTiles || { w: 1, d: 1, h: 1 },
      collisionFootprintTiles: manifest.collisionFootprintTiles || manifest.authoringFootprintTiles || manifest.footprintTiles || { w: 1, d: 1, h: 1 },
      previewOffsetTiles: manifest.previewOffsetTiles || { x: 0, y: 0 },
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
    throw new Error('Invalid model id: use letters, numbers, underscore, or hyphen (e.g. pokemon_center).');
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

function resolveTilePackagesDirectory(settings, subPath = '') {
  const baseRel = settings.tilePackagesDirectory || 'pokemon-resort/assets/overworld/tilepacks';
  const base = resolve(repoRoot, baseRel);
  const target = resolve(base, subPath || '');
  if (!isPathInside(target, repoRoot)) throw new Error('Tile package path must stay inside the workspace.');
  return { base, target };
}

function normalizeZipEntryName(name) {
  return String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function archiveText(entries, path) {
  const data = entries[normalizeZipEntryName(path)];
  if (!data) return null;
  return Buffer.from(data).toString('utf8');
}

function archiveJson(entries, path) {
  const text = archiveText(entries, path);
  return text ? JSON.parse(text) : null;
}

async function importInteriorKitArchive(settings, buffer) {
  const entries = unzipSync(new Uint8Array(buffer));
  const manifest = archiveJson(entries, 'interior-kit.json');
  if (!manifest || manifest.format !== 'rae.gen5InteriorKit' || Number(manifest.version) !== 1) {
    throw new Error('Not a supported RAE Gen 5 interior kit archive.');
  }
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) {
    throw new Error('The interior kit manifest contains no reusable parts.');
  }
  const sourceIndex = String(manifest.source?.mapFileIndex || 'map');
  const imported = [];
  for (const part of manifest.parts) {
    if (!part?.id || !part?.role || !part?.glb) throw new Error('Interior kit part is missing id, role, or GLB path.');
    const bytes = entries[part.glb] || entries[`parts/${basename(String(part.glb))}`];
    if (!bytes?.length) throw new Error(`Interior kit is missing ${part.glb}.`);
    const suffix = String(part.id).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const modelId = sanitizeModelId(`interior_${sourceIndex}_${suffix}`);
    if (!isValidModelId(modelId)) throw new Error(`Interior kit produced an invalid model id: ${modelId}`);
    const displayName = `Interior ${sourceIndex} ${part.role}: ${part.sourceMaterial || part.id}`;
    const result = ingestGlbUpload(Buffer.from(bytes), modelId, basename(String(part.glb)), {
      displayName,
      defaultYawDeg: 0,
      defaultScale: 1,
    });
    await writeIngestedModel(settings, result);
    imported.push({
      id: part.id,
      role: part.role,
      sourceMaterial: part.sourceMaterial || '',
      modelId,
      mapPlacement: part.mapPlacement || [0, 0, 0],
      footprint: part.footprint || [1, 1],
      collisionHint: part.collisionHint || '',
    });
  }
  return { manifest, parts: imported };
}

function sanitizeTilePackageFileName(name) {
  const file = basename(String(name || '').trim());
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.rtpks$/i.test(file)) {
    throw new Error('RTPKS file name must end with .rtpks and use letters, numbers, dash, underscore, or dot.');
  }
  return file;
}

function sanitizeMapProjectId(raw) {
  const id = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
    throw new Error('Project id must use letters, numbers, underscore, or hyphen.');
  }
  return id;
}

function normalizeProject(project, fallbackId = 'default') {
  const id = sanitizeMapProjectId(project?.id || fallbackId);
  const maps = Array.isArray(project?.maps) ? project.maps : [];
  const tilePackages = Array.isArray(project?.tilePackages) ? project.tilePackages : [];
  const pathSets = Array.isArray(project?.pathSets) ? project.pathSets : [];
  return {
    version: 1,
    id,
    name: String(project?.name || id).trim() || id,
    maps: maps.map((map, index) => ({
      id: String(map.id || map.file || `map_${index + 1}`).trim(),
      name: String(map.name || map.id || map.file || `Map ${index + 1}`).trim(),
      file: basename(String(map.file || `${map.id || `map_${index + 1}`}.owmap`)),
      gridX: Number.isFinite(Number(map.gridX)) ? Number(map.gridX) : 0,
      gridY: Number.isFinite(Number(map.gridY)) ? Number(map.gridY) : 0,
      linked: map.linked !== false,
      ...(map.sourceMapId ? { sourceMapId: String(map.sourceMapId).trim() } : {}),
    })),
    tilePackages: tilePackages.map((pkg) => ({
      id: String(pkg.id || pkg.file || pkg.fileName || '').trim(),
      file: basename(String(pkg.file || pkg.fileName || '')),
      name: String(pkg.name || pkg.id || pkg.file || '').trim(),
    })).filter((pkg) => pkg.file),
    defaultTilePackageId: String(project?.defaultTilePackageId || '').trim(),
    pathSets: pathSets.map((set, index) => ({
      id: String(set.id || `path_${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, '_') || `path_${index + 1}`,
      name: String(set.name || set.id || `Path ${index + 1}`).trim(),
      packageId: String(set.packageId || '').trim(),
      tiles: typeof set.tiles === 'object' && set.tiles ? { ...set.tiles } : {},
    })),
    interiorKits: (Array.isArray(project?.interiorKits) ? project.interiorKits : []).map((kit) => ({
      id: String(kit.id || '').trim(),
      source: typeof kit.source === 'object' && kit.source ? { ...kit.source } : {},
      parts: (Array.isArray(kit.parts) ? kit.parts : []).map((part) => ({
        ...part,
        mapPlacement: Array.isArray(part.mapPlacement) ? [...part.mapPlacement] : [0, 0, 0],
        footprint: Array.isArray(part.footprint) ? [...part.footprint] : [1, 1],
      })),
    })).filter((kit) => kit.id),
    editor: {
      activeMapId: String(project?.editor?.activeMapId || '').trim(),
      viewMode: project?.editor?.viewMode === '3d' ? '3d' : '2d',
      zoom: Number(project?.editor?.zoom) || 1,
      overlays: typeof project?.editor?.overlays === 'object' && project.editor.overlays ? { ...project.editor.overlays } : {},
    },
    export: typeof project?.export === 'object' && project.export ? { ...project.export } : {},
  };
}

async function listMapProjects() {
  await mkdir(mapProjectsRoot, { recursive: true });
  const names = await readdir(mapProjectsRoot);
  const projects = [];
  for (const name of names.filter((n) => /\.json$/i.test(n)).sort((a, b) => a.localeCompare(b))) {
    try {
      const project = normalizeProject(JSON.parse(await readFile(join(mapProjectsRoot, name), 'utf8')), name.replace(/\.json$/i, ''));
      projects.push({ id: project.id, name: project.name, file: name, mapCount: project.maps.length });
    } catch (error) {
      projects.push({ id: name.replace(/\.json$/i, ''), name, file: name, mapCount: 0, error: error.message });
    }
  }
  return projects;
}

async function readMapProject(id = 'default') {
  const safeId = sanitizeMapProjectId(id || 'default');
  const path = join(mapProjectsRoot, `${safeId}.json`);
  if (!existsSync(path)) {
    return normalizeProject({ id: safeId, name: safeId === 'default' ? 'Default Project' : safeId }, safeId);
  }
  return normalizeProject(JSON.parse(await readFile(path, 'utf8')), safeId);
}

async function writeMapProject(project) {
  const normalized = normalizeProject(project, project?.id || 'default');
  await mkdir(mapProjectsRoot, { recursive: true });
  const path = join(mapProjectsRoot, `${normalized.id}.json`);
  await writeFile(path, JSON.stringify(normalized, null, 2) + '\n');
  return { project: normalized, path };
}

const ADJACENT_STRIP_TILES = 16;

async function loadProjectMapDimensions(settings, entry) {
  if (!entry?.file) return null;
  try {
    const { map } = await readMapFile(settings, entry.file);
    const width = Number(map?.grid?.width);
    const height = Number(map?.grid?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
    return { width, height };
  } catch {
    return null;
  }
}

async function resolveAnchorDimensions(settings, anchorEntry, anchorWidth, anchorHeight, anchorFile) {
  const fileToRead = String(anchorFile || anchorEntry?.file || '').trim();
  if (fileToRead) {
    try {
      const { map } = await readMapFile(settings, fileToRead);
      const width = Number(map?.grid?.width);
      const height = Number(map?.grid?.height);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { width, height };
      }
    } catch { /* fall back to editor dimensions */ }
  }
  if (Number.isFinite(anchorWidth) && Number.isFinite(anchorHeight) && anchorWidth > 0 && anchorHeight > 0) {
    return { width: anchorWidth, height: anchorHeight };
  }
  return { width: ADJACENT_STRIP_TILES, height: ADJACENT_STRIP_TILES };
}

async function resolveAdjacentMapDimensions(settings, project, direction, anchorEntry, anchorWidth, anchorHeight, gridX, gridY, anchorFile) {
  const maps = project.maps || [];
  const at = (x, y) => maps.find((map) => map.gridX === x && map.gridY === y);
  const anchorDims = await resolveAnchorDimensions(settings, anchorEntry, anchorWidth, anchorHeight, anchorFile);
  const anchorW = anchorDims.width;
  const anchorH = anchorDims.height;
  if (direction === 'west' || direction === 'east') {
    let width = ADJACENT_STRIP_TILES;
    const north = await loadProjectMapDimensions(settings, at(gridX, gridY - 1));
    const south = await loadProjectMapDimensions(settings, at(gridX, gridY + 1));
    if (north?.width) width = north.width;
    else if (south?.width) width = south.width;
    return { width, height: anchorH };
  }
  let height = ADJACENT_STRIP_TILES;
  const west = await loadProjectMapDimensions(settings, at(gridX - 1, gridY));
  const east = await loadProjectMapDimensions(settings, at(gridX + 1, gridY));
  if (west?.height) height = west.height;
  else if (east?.height) height = east.height;
  return { width: anchorW, height };
}

async function buildAdjacentMapOwmap(settings, project, mapEntry, anchorEntry, direction, anchorWidth, anchorHeight, anchorFile) {
  const { width, height } = await resolveAdjacentMapDimensions(
    settings,
    project,
    direction,
    anchorEntry,
    anchorWidth,
    anchorHeight,
    mapEntry.gridX,
    mapEntry.gridY,
    anchorFile,
  );
  let anchorMap = null;
  if (anchorEntry?.file) {
    try {
      anchorMap = (await readMapFile(settings, anchorEntry.file)).map;
    } catch { /* anchor may only exist in the editor */ }
  }
  const owmap = emptyMap(width, height);
  owmap.id = mapEntry.id;
  owmap.name = mapEntry.name;
  if (anchorMap?.tilePackage) owmap.tilePackage = { ...anchorMap.tilePackage };
  return owmap;
}

async function ensureAdjacentMapFile(settings, project, mapEntry, anchorEntry, direction, anchorWidth, anchorHeight, anchorFile) {
  const { target } = resolveMapsDirectory(settings, mapEntry.file);
  if (existsSync(target)) {
    const dims = await loadProjectMapDimensions(settings, mapEntry);
    return { created: false, width: dims?.width ?? null, height: dims?.height ?? null };
  }
  const owmap = await buildAdjacentMapOwmap(settings, project, mapEntry, anchorEntry, direction, anchorWidth, anchorHeight, anchorFile);
  await writeMapOwmap(settings, mapEntry.file, owmap);
  return { created: true, width: owmap.grid.width, height: owmap.grid.height };
}

async function validateMapProjectEdges(settings, project) {
  const warnings = [];
  const loaded = new Map();
  const load = async (entry) => {
    if (loaded.has(entry.id)) return loaded.get(entry.id);
    try {
      const result = await readMapFile(settings, entry.file);
      loaded.set(entry.id, result.map);
      return result.map;
    } catch {
      loaded.set(entry.id, null);
      warnings.push(`${entry.file} is listed in the project but does not exist yet.`);
      return null;
    }
  };
  const maps = project.maps || [];
  const linkedMaps = maps.filter((entry) => entry.linked !== false);
  const byCell = new Map(linkedMaps.map((entry) => [`${entry.gridX},${entry.gridY}`, entry]));
  for (const entry of linkedMaps) {
    const map = await load(entry);
    if (!map) continue;
    const east = byCell.get(`${entry.gridX + 1},${entry.gridY}`);
    const south = byCell.get(`${entry.gridX},${entry.gridY + 1}`);
    if (east) {
      const other = await load(east);
      if (other) {
        if (map.grid.height !== other.grid.height) {
          warnings.push(`${entry.file} east edge height (${map.grid.height}) does not match ${east.file} west edge height (${other.grid.height}).`);
        }
        const rows = Math.min(map.grid.height, other.grid.height);
        for (let y = 0; y < rows; y += 1) {
          const a = map.terrain?.height?.[y]?.[map.grid.width - 1] ?? 0;
          const b = other.terrain?.height?.[y]?.[0] ?? 0;
          if (a !== b) warnings.push(`${entry.file} east edge y=${y} height ${a} differs from ${east.file} west edge height ${b}.`);
        }
      }
    }
    if (south) {
      const other = await load(south);
      if (other) {
        if (map.grid.width !== other.grid.width) {
          warnings.push(`${entry.file} south edge width (${map.grid.width}) does not match ${south.file} north edge width (${other.grid.width}).`);
        }
        const cols = Math.min(map.grid.width, other.grid.width);
        for (let x = 0; x < cols; x += 1) {
          const a = map.terrain?.height?.[map.grid.height - 1]?.[x] ?? 0;
          const b = other.terrain?.height?.[0]?.[x] ?? 0;
          if (a !== b) warnings.push(`${entry.file} south edge x=${x} height ${a} differs from ${south.file} north edge height ${b}.`);
        }
      }
    }
  }
  return { ok: warnings.length === 0, warnings };
}

function relativeGameAssetPath(settings, directoryKey, fileName) {
  const rel = String(settings[directoryKey] || '').replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^pokemon-resort\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  return `${rel || 'assets/overworld/tilepacks'}/${fileName}`;
}

function inspectRtpksBuffer(buffer, fileName = 'package.rtpks', metaBuffer = null) {
  const entries = unzipSync(new Uint8Array(buffer));
  const manifest = archiveJson(entries, 'manifest.json');
  if (!manifest || manifest.format !== 'pokemon_resort.rtpks') {
    throw new Error('Not a supported RTPKS package.');
  }
  if (manifest.version !== 2) {
    throw new Error('RTPKS v1 is no longer supported. Re-export this tileset from PDSMS to create RTPKS v2 and its .rtpks.meta sidecar.');
  }
  const tileIndexPath = manifest.tileIndex || 'index/tile_index.json';
  const tileTabsPath = manifest.tileTabs || 'index/tile_tabs.json';
  const tileIndex = archiveJson(entries, tileIndexPath);
  const tileTabs = archiveJson(entries, tileTabsPath);
  const runtime = archiveJson(entries, 'runtime/manifest.json');
  if (!tileIndex?.entries?.length) throw new Error('RTPKS is missing index/tile_index.json entries.');
  if (!tileTabs?.tabs?.length) throw new Error('RTPKS v2 is missing index/tile_tabs.json tabs.');
  if (!runtime || runtime.format !== 'pokemon_resort.rpak') {
    throw new Error('RTPKS is missing runtime/manifest.json. Re-save it with the updated PDSMS RTPKS writer.');
  }
  if (!metaBuffer) {
    throw new Error('RTPKS v2 requires a sibling .rtpks.meta editor sidecar. Re-export this tileset from PDSMS and copy both files.');
  }
  const metaEntries = unzipSync(new Uint8Array(metaBuffer));
  const metaManifest = archiveJson(metaEntries, 'manifest.json');
  if (!metaManifest || metaManifest.format !== 'pokemon_resort.rtpks.meta') {
    throw new Error('Invalid RTPKS editor sidecar. Expected pokemon_resort.rtpks.meta.');
  }
  const sourceHash = createHash('sha256').update(buffer).digest('hex');
  const previewVersion = createHash('sha256').update(metaBuffer).digest('hex').slice(0, 12);
  if (metaManifest.sourceSha256 && metaManifest.sourceSha256 !== sourceHash) {
    throw new Error('RTPKS editor sidecar does not match this .rtpks file. Re-export both files from PDSMS.');
  }
  const editorMeta = archiveJson(metaEntries, metaManifest.tileMetadata || 'editor/tile_metadata.json');
  if (!editorMeta?.tiles?.length) {
    throw new Error('RTPKS editor sidecar is missing editor/tile_metadata.json tiles.');
  }
  const metaTiles = new Map((editorMeta.tiles || []).map((tile) => [Number(tile.resortTileId), tile]));
  const tabList = (tileTabs.tabs || []).map((tab) => ({
    id: String(tab.id || 'default'),
    name: String(tab.name || tab.id || 'Default'),
    order: Number(tab.order || 0),
    tileIds: (tab.tileIds || []).map(Number).filter(Number.isFinite),
  })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const runtimeTiles = new Map((runtime.tiles || []).map((tile) => [Number(tile.resortTileId), tile]));
  const runtimeMaterials = new Map((runtime.materials || []).map((mat) => [Number(mat.materialId), mat]));
  const textureSet = new Set(Object.keys(entries)
    .filter((name) => name.startsWith('runtime/textures/'))
    .map((name) => name.slice('runtime/textures/'.length)));

  const tiles = [];
  const meshBounds = (mesh) => {
    const out = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    const values = [];
    if (Array.isArray(mesh?.triangles)) values.push(...mesh.triangles);
    if (Array.isArray(mesh?.quads)) values.push(...mesh.quads);
    if (!values.length) return out;
    out.minX = out.minY = out.minZ = Number.POSITIVE_INFINITY;
    out.maxX = out.maxY = out.maxZ = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < values.length; i += 3) {
      const x = Number(values[i] || 0);
      const y = Number(values[i + 1] || 0);
      const z = Number(values[i + 2] || 0);
      out.minX = Math.min(out.minX, x); out.maxX = Math.max(out.maxX, x);
      out.minY = Math.min(out.minY, y); out.maxY = Math.max(out.maxY, y);
      out.minZ = Math.min(out.minZ, z); out.maxZ = Math.max(out.maxZ, z);
    }
    return out;
  };
  for (const entry of tileIndex.entries || []) {
    if (entry.status && entry.status !== 'active') continue;
    const resortTileId = Number(entry.resortTileId);
    const meshPath = `runtime/meshes/tile_${resortTileId}.json`;
    const mesh = entries[meshPath] ? archiveJson(entries, meshPath) : null;
    const runtimeTile = runtimeTiles.get(resortTileId) || {};
    const metaTile = metaTiles.get(resortTileId) || {};
    const width = Number(runtimeTile.width || mesh?.width || 1);
    const height = Number(runtimeTile.height || mesh?.height || 1);
    const materialId = Array.isArray(mesh?.textureIds) ? Number(mesh.textureIds[0]) : null;
    const material = materialId != null ? runtimeMaterials.get(materialId) : null;
    const textureName = material?.textureName && textureSet.has(material.textureName)
      ? material.textureName
      : (runtime.textures || []).find((tex) => textureSet.has(tex.name))?.name || null;
    const bounds = meshBounds(mesh);
    tiles.push({
      localIndex: Number(entry.localIndex),
      resortTileId,
      key: entry.key || `tile_${String(resortTileId).padStart(4, '0')}`,
      tabId: metaTile.tabId || tabList.find((tab) => tab.tileIds.includes(resortTileId))?.id || 'default',
      width: Number(metaTile.width || width),
      height: Number(metaTile.height || height),
      footprint: { w: Number(metaTile.width || width), h: Number(metaTile.height || height), d: Number(metaTile.height || height) },
      xOffset: Number(metaTile.xOffset ?? mesh?.xOffset ?? 0),
      yOffset: Number(metaTile.yOffset ?? mesh?.yOffset ?? 0),
      tileable: {
        x: Boolean(metaTile.xTileable),
        y: Boolean(metaTile.yTileable),
        u: Boolean(metaTile.uTileable),
        v: Boolean(metaTile.vTileable),
      },
      globalTexMapping: Boolean(metaTile.globalTexMapping),
      globalTexScale: Number(metaTile.globalTexScale || 1),
      preview: metaTile.preview || null,
      previewImage: metaTile.preview?.image
        ? `/api/tile-packages/preview?file=${encodeURIComponent(basename(fileName))}&tileId=${encodeURIComponent(resortTileId)}&v=${previewVersion}`
        : '',
      bounds,
      materialCount: Number(runtimeTile.materialCount || mesh?.textureIds?.length || 0),
      vertexCount: Number(runtimeTile.vertexCount || 0),
      triangleCount: Number(runtimeTile.triangleCount || 0),
      meshPath,
      previewTexture: textureName,
      materialId,
      name: String(metaTile.name || runtimeTile.name || entry.key || `Tile ${resortTileId}`),
      tags: Array.isArray(metaTile.tags) ? metaTile.tags : (runtimeTile.tags || []),
      properties: metaTile.properties || runtimeTile.properties || {},
      animation: metaTile.animation || runtimeTile.animation || { type: 'none' },
      collision: metaTile.collision || runtimeTile.collision || { mode: 'none', autoApply: false },
    });
  }
  tiles.sort((a, b) => a.resortTileId - b.resortTileId);
  const meshCount = Object.keys(entries).filter((name) => /^runtime\/meshes\/tile_\d+\.json$/.test(name)).length;
  const textureAlphaByName = new Map((runtime.textures || []).map((texture) => {
    const name = String(texture.name || '');
    const bytes = entries[`runtime/textures/${name}`];
    return [name, bytes?.length ? pngTransparencyKind(Buffer.from(bytes)) : 'opaque'];
  }));
  return {
    fileName: basename(fileName),
    packId: manifest.packId || runtime.packId || basename(fileName, '.rtpks'),
    name: manifest.name || runtime.packId || basename(fileName, '.rtpks'),
    activeTileCount: tiles.length,
    meshCount,
    materialCount: runtime.materials?.length || 0,
    textureCount: runtime.textures?.length || 0,
    tabs: tabList,
    smartSets: editorMeta.smartSets || [],
    materials: (runtime.materials || []).map((material) => ({
      materialId: Number(material.materialId),
      name: material.name || `material_${material.materialId}`,
      textureName: material.textureName || '',
      alpha: Number(material.alpha ?? 31),
      textureAlpha: textureAlphaByName.get(String(material.textureName || '')) || 'opaque',
      sampler: material.sampler || {
        wrapS: 'repeat', wrapT: 'repeat', magFilter: 'nearest', minFilter: 'nearest',
      },
      uvMapping: material.uvMapping || { mode: 'local', uPerTile: [0, 0], vPerTile: [0, 0] },
      animation: material.animation || { type: 'none' },
      renderOrder: Number(material.renderOrder || 0),
      layerRole: String(material.layerRole || 'surface'),
    })),
    tiles,
  };
}

async function inspectRtpksFile(filePath) {
  const metaPath = `${filePath}.meta`;
  const [packInfo, metaInfo] = await Promise.all([
    stat(filePath),
    existsSync(metaPath) ? stat(metaPath) : null,
  ]);
  const signature = [
    packInfo.size, packInfo.mtimeMs, packInfo.ctimeMs,
    metaInfo?.size || 0, metaInfo?.mtimeMs || 0, metaInfo?.ctimeMs || 0,
  ].join(':');
  const cached = rtpksInspectionCache.get(filePath);
  if (cached?.signature === signature) return cached.inspection;

  const inspection = Promise.all([
    readFile(filePath),
    metaInfo ? readFile(metaPath) : null,
  ])
    .then(([packBuffer, metaBuffer]) => inspectRtpksBuffer(packBuffer, basename(filePath), metaBuffer))
    .catch((error) => {
      if (rtpksInspectionCache.get(filePath)?.inspection === inspection) {
        rtpksInspectionCache.delete(filePath);
      }
      throw error;
    });
  rtpksInspectionCache.set(filePath, { signature, inspection });
  return inspection;
}

async function listTilePackages(settings) {
  const { base } = resolveTilePackagesDirectory(settings);
  if (!existsSync(base)) return { base, packages: [] };
  const names = await readdir(base);
  const packages = [];
  for (const name of names.filter((n) => /\.rtpks$/i.test(n)).sort((a, b) => a.localeCompare(b))) {
    try {
      const inspected = await inspectRtpksFile(join(base, name));
      packages.push({
        ...inspected,
        fileName: name,
        gamePath: relativeGameAssetPath(settings, 'tilePackagesDirectory', name),
        tiles: inspected.tiles.slice(0, 96),
      });
    } catch (error) {
      packages.push({ fileName: name, name, packId: name.replace(/\.rtpks$/i, ''), error: error.message, tiles: [] });
    }
  }
  return { base, packages };
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
    throw new Error(`ENOENT: no such file or directory, open '${path}': expected public/data/${file}. Restart the Operations Desk (npm run admin) after pulling the research/pois split.`);
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

const DESK_API_VERSION = 4;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/admin/capabilities') {
      return json(res, 200, {
        ok: true,
        version: DESK_API_VERSION,
        features: ['maps', 'overworld-models', 'overworld-model-delete', 'overworld-model-zip', 'owmap-bake', 'rtpks-tile-packages', 'character-editor', 'atlas-island-model'],
      });
    }
    if (url.pathname === '/api/game-engine/tools') {
      const tools = await getEditorTools();
      return json(res, 200, { tools });
    }
    if (url.pathname === '/api/character-editor/status') {
      return json(res, 200, await getCharacterEditorStatus());
    }
    if (url.pathname === '/api/character-editor/start' && req.method === 'POST') {
      try {
        return json(res, 200, await startCharacterEditor());
      } catch (error) {
        return json(res, 500, { ok: false, error: error.message, ...(await getCharacterEditorStatus()) });
      }
    }
    if (url.pathname === '/api/character-editor/stop' && req.method === 'POST') {
      stopCharacterEditor();
      return json(res, 200, await getCharacterEditorStatus());
    }
    if (url.pathname === '/character-editor' || url.pathname.startsWith('/character-editor/')) {
      if (!(await ensureCharacterEditorRunning())) {
        return json(res, 503, { ok: false, error: 'Character editor is not running.' });
      }
      return proxyCharacterEditorRequest(req, res, url, { stripPrefix: '/character-editor' });
    }
    if (await proxyCharacterEditorIfNeeded(req, res, url)) return;
    // DATA EDITOR PATCH START
    if (url.pathname.startsWith('/api/data-editor/')) {
      await handleDataEditorApi({ req, res, url, root, repoRoot, readBody, json });
      return;
    }
    // DATA EDITOR PATCH END
    if (url.pathname.startsWith('/api/script-engine/')) {
      await handleScriptEngineApi({ req, res, url, repoRoot, readBody, json });
      return;
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
    if (url.pathname === '/api/atlas/island-model/replace' && req.method === 'POST') {
      try {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) {
          return json(res, 400, { ok: false, error: 'Expected multipart upload' });
        }
        const raw = await readRawBody(req, 120_000_000);
        const parts = parseMultipart(raw, contentType);
        let filePart = null;
        for (const part of parts) {
          if ((part.name === 'file' || part.filename) && part.bytes.length) {
            filePart = part;
            break;
          }
        }
        if (!filePart) {
          return json(res, 400, { ok: false, error: 'No file in upload (field: file).' });
        }
        const bytes = filePart.bytes;
        const isGlb = bytes.length >= 4
          && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
        if (!isGlb) {
          return json(res, 400, { ok: false, error: 'File is not a valid GLB (glTF binary).' });
        }
        parseGlb(bytes);
        const path = await replaceIslandModelGlb(publicRoot, bytes);
        return json(res, 200, { ok: true, path, bytes: bytes.length });
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
          error: 'research-pois.json was split into research.json and pois.json (Atlas). Save from Atlas POIs. Restart the desk if you still see this.',
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
        resolveTilePackagesDirectory(next);
        const { base } = resolveMapsDirectory(next);
        const { base: modelsBase } = resolveModelsDirectory(next);
        const { base: tilePackagesBase } = resolveTilePackagesDirectory(next);
        return json(res, 200, { ok: true, settings: next, resolvedPath: base, modelsResolvedPath: modelsBase, tilePackagesResolvedPath: tilePackagesBase });
      }
      const { base } = resolveMapsDirectory(settings);
      const { base: modelsBase } = resolveModelsDirectory(settings);
      const { base: tilePackagesBase } = resolveTilePackagesDirectory(settings);
      return json(res, 200, { ok: true, settings, resolvedPath: base, modelsResolvedPath: modelsBase, tilePackagesResolvedPath: tilePackagesBase });
    }
    if (url.pathname === '/api/tile-packages/list') {
      const settings = await readMapSettings();
      const listing = await listTilePackages(settings);
      return json(res, 200, { ok: true, ...listing, settings });
    }
    if (url.pathname === '/api/tile-packages/package') {
      const settings = await readMapSettings();
      try {
        const fileName = sanitizeTilePackageFileName(url.searchParams.get('file'));
        const { target } = resolveTilePackagesDirectory(settings, fileName);
        if (!existsSync(target)) return json(res, 404, { ok: false, error: 'RTPKS package not found.' });
        const inspected = await inspectRtpksFile(target);
        return json(res, 200, {
          ok: true,
          package: {
            ...inspected,
            fileName,
            gamePath: relativeGameAssetPath(settings, 'tilePackagesDirectory', fileName),
          },
        });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/tile-packages/authoring') {
      const settings = await readMapSettings();
      try {
        const fileName = sanitizeTilePackageFileName(url.searchParams.get('file'));
        const { target } = resolveTilePackagesDirectory(settings, fileName);
        const metaPath = `${target}.meta`;
        if (!existsSync(target) || !existsSync(metaPath)) {
          return json(res, 404, { ok: false, error: 'RTPKS package or editor sidecar not found.' });
        }
        if (req.method === 'GET') {
          const editable = loadEditableTilePack(await readFile(target), await readFile(metaPath));
          return json(res, 200, { ok: true, fileName, document: editable.document });
        }
        if (req.method === 'POST') {
          const payload = JSON.parse(await readBody(req));
          const result = saveTilePackDocument(await readFile(target), await readFile(metaPath), payload.document || payload);
          await writeFile(target, result.packBytes);
          await writeFile(metaPath, result.metaBytes);
          const inspected = await inspectRtpksFile(target);
          return json(res, 200, {
            ok: true,
            package: { ...inspected, fileName, gamePath: relativeGameAssetPath(settings, 'tilePackagesDirectory', fileName) },
          });
        }
        return json(res, 405, { ok: false, error: 'Method not allowed.' });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/tile-packages/tiles' && req.method === 'POST') {
      const settings = await readMapSettings();
      try {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) throw new Error('Expected multipart tile upload.');
        const parts = parseMultipart(await readRawBody(req, 160_000_000), contentType);
        const metadataPart = parts.find((part) => part.name === 'metadata');
        if (!metadataPart) throw new Error('Tile metadata is required.');
        const payload = JSON.parse(Buffer.from(metadataPart.bytes).toString('utf8'));
        const fileName = sanitizeTilePackageFileName(payload.fileName);
        const { target } = resolveTilePackagesDirectory(settings, fileName);
        const metaPath = `${target}.meta`;
        if (!existsSync(target) || !existsSync(metaPath)) throw new Error('RTPKS package or sidecar not found.');
        const glb = parts.find((part) => part.name === 'glb');
        const tileBundle = parts.find((part) => part.name === 'tileBundle');
        const texture = parts.find((part) => part.name === 'texture');
        const frames = parts.filter((part) => part.name === 'frame').map((part) => part.bytes);
        const result = addTileToPack(
          await readFile(target),
          await readFile(metaPath),
          payload.tile || {},
          {
            glb: glb?.bytes,
            tileBundle: tileBundle?.bytes,
            texture: texture?.bytes,
            textureName: texture?.filename,
            frames,
          },
        );
        await writeFile(target, result.packBytes);
        await writeFile(metaPath, result.metaBytes);
        const inspected = await inspectRtpksFile(target);
        return json(res, 200, {
          ok: true,
          resortTileId: result.resortTileId,
          package: { ...inspected, fileName, gamePath: relativeGameAssetPath(settings, 'tilePackagesDirectory', fileName) },
        });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/tile-packages/tiles/batch' && req.method === 'POST') {
      const settings = await readMapSettings();
      try {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) throw new Error('Expected multipart tile upload.');
        const parts = parseMultipart(await readRawBody(req, 240_000_000), contentType);
        const metadataPart = parts.find((part) => part.name === 'metadata');
        if (!metadataPart) throw new Error('Tile batch metadata is required.');
        const payload = JSON.parse(Buffer.from(metadataPart.bytes).toString('utf8'));
        const fileName = sanitizeTilePackageFileName(payload.fileName);
        const { target } = resolveTilePackagesDirectory(settings, fileName);
        const metaPath = `${target}.meta`;
        if (!existsSync(target) || !existsSync(metaPath)) throw new Error('RTPKS package or sidecar not found.');
        const tileBundles = parts.filter((part) => part.name === 'tileBundle' && part.bytes?.length);
        if (!tileBundles.length) throw new Error('Choose at least one .tile bundle.');
        const definition = payload.tile || {};
        const result = addTilesToPack(
          await readFile(target),
          await readFile(metaPath),
          tileBundles.map((part) => ({ definition, assets: { tileBundle: part.bytes } })),
          {
            tabId: definition.tabId,
            replaceTab: payload.replaceTab === true,
          },
        );
        await writeFile(target, result.packBytes);
        await writeFile(metaPath, result.metaBytes);
        const inspected = await inspectRtpksFile(target);
        return json(res, 200, {
          ok: true,
          resortTileIds: result.resortTileIds,
          deactivatedTileIds: result.deactivatedTileIds,
          package: { ...inspected, fileName, gamePath: relativeGameAssetPath(settings, 'tilePackagesDirectory', fileName) },
        });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/tile-packages/tile-bundles/inspect' && req.method === 'POST') {
      try {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) throw new Error('Expected multipart tile bundle upload.');
        const parts = parseMultipart(await readRawBody(req, 160_000_000), contentType);
        const tileBundle = parts.find((part) => part.name === 'tileBundle');
        if (!tileBundle?.bytes?.length) throw new Error('Choose a .tile file.');
        return json(res, 200, { ok: true, bundle: inspectTileBundle(tileBundle.bytes) });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/tile-packages/import' && req.method === 'POST') {
      const settings = await readMapSettings();
      try {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) {
          return json(res, 400, { ok: false, error: 'Expected multipart upload' });
        }
        const raw = await readRawBody(req, 120_000_000);
        const parts = parseMultipart(raw, contentType);
        let filePart = null;
        let metaPart = null;
        for (const part of parts) {
          if (!part.bytes.length) continue;
          if (/\.rtpks\.meta$/i.test(part.filename || '') || part.name === 'rtpksMeta') {
            metaPart = part;
          } else if ((part.name === 'rtpks' || part.filename) && /\.rtpks$/i.test(part.filename || '')) {
            filePart = part;
          }
        }
        if (!filePart) return json(res, 400, { ok: false, error: 'No RTPKS file in upload (field: rtpks).' });
        if (!metaPart) return json(res, 400, { ok: false, error: 'No RTPKS editor sidecar in upload (field: rtpksMeta, file: *.rtpks.meta).' });
        const safe = sanitizeTilePackageFileName(filePart.filename || 'tile_package.rtpks');
        const inspected = inspectRtpksBuffer(filePart.bytes, safe, metaPart.bytes);
        const { base, target } = resolveTilePackagesDirectory(settings, safe);
        await mkdir(base, { recursive: true });
        await writeFile(target, filePart.bytes);
        await writeFile(`${target}.meta`, metaPart.bytes);
        const listing = await listTilePackages(settings);
        return json(res, 200, {
          ok: true,
          fileName: safe,
          savedPath: target,
          gamePath: relativeGameAssetPath(settings, 'tilePackagesDirectory', safe),
          package: { ...inspected, fileName: safe, gamePath: relativeGameAssetPath(settings, 'tilePackagesDirectory', safe) },
          packages: listing.packages,
        });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/tile-packages/copy' && req.method === 'POST') {
      const settings = await readMapSettings();
      try {
        const payload = JSON.parse(await readBody(req));
        const sourcePath = resolve(repoRoot, String(payload.sourcePath || ''));
        if (!isPathInside(sourcePath, repoRoot) || !existsSync(sourcePath)) {
          throw new Error('Source RTPKS must exist inside the workspace.');
        }
        const safe = sanitizeTilePackageFileName(payload.fileName || basename(sourcePath));
        const inspected = await inspectRtpksFile(sourcePath);
        const { base, target } = resolveTilePackagesDirectory(settings, safe);
        await mkdir(base, { recursive: true });
        await copyFile(sourcePath, target);
        if (!existsSync(`${sourcePath}.meta`)) {
          throw new Error('Source RTPKS is missing required .rtpks.meta sidecar.');
        }
        await copyFile(`${sourcePath}.meta`, `${target}.meta`);
        const listing = await listTilePackages(settings);
        return json(res, 200, {
          ok: true,
          fileName: safe,
          savedPath: target,
          gamePath: relativeGameAssetPath(settings, 'tilePackagesDirectory', safe),
          package: { ...inspected, fileName: safe, gamePath: relativeGameAssetPath(settings, 'tilePackagesDirectory', safe) },
          packages: listing.packages,
        });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/tile-packages/texture') {
      const settings = await readMapSettings();
      try {
        const fileName = sanitizeTilePackageFileName(url.searchParams.get('file'));
        const textureName = normalizeZipEntryName(url.searchParams.get('texture') || '');
        if (!textureName || textureName.includes('..')) throw new Error('Invalid texture name.');
        const { target } = resolveTilePackagesDirectory(settings, fileName);
        if (!existsSync(target)) return json(res, 404, { ok: false, error: 'RTPKS package not found.' });
        const entries = await readRtpksArchive(target);
        const entryPath = normalizeZipEntryName(`runtime/textures/${textureName}`);
        const bytes = entries[entryPath];
        if (!bytes) return json(res, 404, { ok: false, error: 'Texture not found in RTPKS package.' });
        const ext = extname(textureName).toLowerCase();
        res.writeHead(200, {
          'Content-Type': mime[ext] || 'image/png',
          'Cache-Control': 'private, max-age=60',
        });
        res.end(Buffer.from(bytes));
        return;
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/tile-packages/preview') {
      const settings = await readMapSettings();
      try {
        const fileName = sanitizeTilePackageFileName(url.searchParams.get('file'));
        const tileIdRaw = url.searchParams.get('tileId');
        const tileId = Number(tileIdRaw);
        if (!Number.isInteger(tileId) || tileId < 0) throw new Error('tileId must be a non-negative integer.');
        const { target } = resolveTilePackagesDirectory(settings, fileName);
        const metaPath = `${target}.meta`;
        if (!existsSync(metaPath)) return json(res, 404, { ok: false, error: 'RTPKS editor sidecar not found.' });
        const entries = await readRtpksArchive(metaPath);
        const manifest = archiveJson(entries, 'manifest.json');
        const editorMeta = archiveJson(entries, manifest?.tileMetadata || 'editor/tile_metadata.json');
        const tile = (editorMeta?.tiles || []).find((item) => Number(item.resortTileId) === tileId);
        const previewPath = normalizeZipEntryName(tile?.preview?.image || `editor/previews/tile_${tileId}.png`);
        const bytes = entries[previewPath];
        if (!bytes) return json(res, 404, { ok: false, error: 'Preview not found in RTPKS editor sidecar.' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' });
        res.end(Buffer.from(bytes));
        return;
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/tile-packages/mesh') {
      const settings = await readMapSettings();
      try {
        const fileName = sanitizeTilePackageFileName(url.searchParams.get('file'));
        const tileIdRaw = url.searchParams.get('tileId');
        const tileId = Number(tileIdRaw);
        if (!Number.isInteger(tileId) || tileId < 0) throw new Error('tileId must be a non-negative integer.');
        const { target } = resolveTilePackagesDirectory(settings, fileName);
        if (!existsSync(target)) return json(res, 404, { ok: false, error: 'RTPKS package not found.' });
        const entries = await readRtpksArchive(target);
        const entryPath = `runtime/meshes/tile_${tileId}.json`;
        const bytes = entries[entryPath];
        if (!bytes) return json(res, 404, { ok: false, error: 'Mesh not found in RTPKS package.' });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=60' });
        res.end(Buffer.from(bytes).toString('utf8'));
        return;
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/map-projects/list') {
      try {
        return json(res, 200, { ok: true, projects: await listMapProjects() });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/map-projects/project') {
      try {
        const id = url.searchParams.get('id') || 'default';
        const project = await readMapProject(id);
        return json(res, 200, { ok: true, project });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/map-projects/validate') {
      const settings = await readMapSettings();
      try {
        const id = url.searchParams.get('id') || 'default';
        const project = await readMapProject(id);
        const validation = await validateMapProjectEdges(settings, project);
        return json(res, 200, { ok: true, projectId: project.id, validation });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/map-projects/create' && req.method === 'POST') {
      try {
        const payload = JSON.parse(await readBody(req));
        const id = sanitizeMapProjectId(payload.id || payload.name || 'default');
        const result = await writeMapProject({
          id,
          name: payload.name || id,
          maps: [],
          tilePackages: [],
          pathSets: [],
          editor: { activeMapId: '', viewMode: '2d', zoom: 1, overlays: {} },
        });
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/map-projects/save' && req.method === 'POST') {
      try {
        const payload = JSON.parse(await readBody(req));
        const result = await writeMapProject(payload.project || payload);
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/map-projects/delete' && (req.method === 'POST' || req.method === 'DELETE')) {
      try {
        let id = url.searchParams.get('id');
        if (!id) {
          const raw = await readBody(req);
          id = raw?.trim() ? JSON.parse(raw).id : '';
        }
        const safeId = sanitizeMapProjectId(id);
        await rm(join(mapProjectsRoot, `${safeId}.json`), { force: true });
        return json(res, 200, { ok: true, id: safeId });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }
    if (url.pathname === '/api/map-projects/create-adjacent' && req.method === 'POST') {
      try {
        const payload = JSON.parse(await readBody(req));
        const project = await readMapProject(payload.projectId || 'default');
        const settings = await readMapSettings();
        const activeId = String(payload.activeMapId || project.editor.activeMapId || '').trim();
        const direction = String(payload.direction || '').trim().toLowerCase();
        const anchorWidth = Number(payload.anchorWidth);
        const anchorHeight = Number(payload.anchorHeight);
        const anchorFile = String(payload.anchorFile || '').trim();
        const deltas = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
        const delta = deltas[direction];
        if (!delta) throw new Error('direction must be north, east, south, or west.');
        const anchor = project.maps.find((map) => map.id === activeId)
          || project.maps.find((map) => map.file === activeId)
          || project.maps[0];
        if (!anchor) throw new Error('Add or save the current map to the project before creating adjacent maps.');
        const gridX = anchor.gridX + delta[0];
        const gridY = anchor.gridY + delta[1];
        const existing = project.maps.find((map) => map.linked !== false && map.gridX === gridX && map.gridY === gridY);
        let map;
        let isExisting = false;
        if (existing) {
          map = existing;
          isExisting = true;
          project.editor.activeMapId = existing.id;
        } else {
          const base = sanitizeMapProjectId(`${anchor.id || 'map'}_${direction}`);
          let id = base;
          let n = 2;
          while (project.maps.some((entry) => entry.id === id || entry.file === `${id}.owmap`)) {
            id = `${base}_${n}`;
            n += 1;
          }
          map = { id, name: id.replace(/_/g, ' '), file: `${id}.owmap`, gridX, gridY, linked: true };
          project.maps.push(map);
          project.editor.activeMapId = id;
        }
        const fileResult = await ensureAdjacentMapFile(
          settings,
          project,
          map,
          anchor,
          direction,
          anchorWidth,
          anchorHeight,
          anchorFile,
        );
        const saved = await writeMapProject(project);
        return json(res, 200, {
          ok: true,
          project: saved.project,
          map,
          existing: isExisting,
          fileCreated: fileResult.created,
          dimensions: fileResult.width && fileResult.height
            ? { width: fileResult.width, height: fileResult.height }
            : null,
        });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
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
    if (url.pathname === '/api/overworld-models/import-interior-kit' && req.method === 'POST') {
      const settings = await readMapSettings();
      try {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) {
          return json(res, 400, { ok: false, error: 'Expected multipart upload' });
        }
        const parts = parseMultipart(await readRawBody(req, 240_000_000), contentType);
        const { archive } = groupFolderUpload(parts);
        if (!archive?.length) return json(res, 400, { ok: false, error: 'Upload the interior-kit.zip created by RAE.' });
        const result = await importInteriorKitArchive(settings, archive);
        return json(res, 200, { ok: true, ...result });
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
            error: 'Model id is required: use letters, numbers, underscore, or hyphen (e.g. pokemon_center).',
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
    if (url.pathname === '/api/maps/delete' && (req.method === 'POST' || req.method === 'DELETE')) {
      const settings = await readMapSettings();
      try {
        let fileName = url.searchParams.get('file');
        if (!fileName) {
          const payload = JSON.parse(await readBody(req));
          fileName = payload.fileName || payload.file;
        }
        if (!fileName) throw new Error('fileName is required.');
        const safe = basename(String(fileName));
        const { target } = resolveMapsDirectory(settings, safe);
        if (!existsSync(target)) return json(res, 404, { ok: false, error: 'Map file not found.' });
        await rm(target, { force: true });
        return json(res, 200, { ok: true, fileName: safe });
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
    } else if (url.pathname.startsWith('/modules/')) {
      filePath = resolveModulesFile(url.pathname);
    } else if (url.pathname.startsWith('/shared/')) {
      filePath = resolveSharedFile(url.pathname);
    } else {
      filePath = url.pathname === '/' ? join(adminRoot, 'index.html') : join(adminRoot, url.pathname.replace(/^\//, ''));
    }
    const allowedRoot = url.pathname.startsWith('/vendor/mermaid/')
      ? mermaidRoot
      : url.pathname.startsWith('/vendor/')
      ? threeRoot
      : url.pathname.startsWith('/modules/')
      ? modulesRoot
      : url.pathname.startsWith('/shared/')
      ? sharedRoot
      : (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/docs/')) ? publicRoot : adminRoot;
    const insideAllowed = filePath
      && (filePath.startsWith(allowedRoot)
      || (url.pathname.startsWith('/vendor/three-addons/') && filePath.startsWith(join(threeRoot, 'examples/jsm')))
      || (url.pathname.startsWith('/vendor/mermaid/') && filePath.startsWith(mermaidRoot)));
    if (!insideAllowed || !existsSync(filePath)) return json(res, 404, { error: 'Not found' });
    const type = mime[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    json(res, 500, { ok: false, error: error.message });
  }
});

/** Default desk port (8787 = Headroom proxy; 8788 = SPMK: see DEV-PORTS.md). Override: PORT=… npm run admin */
const DEFAULT_ADMIN_PORT = 9477;
const port = Number(process.env.PORT || DEFAULT_ADMIN_PORT);

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* wait for port release */ }
}

/** Stop any process already listening on the admin port so `npm run admin` can restart cleanly. */
function freeListenPort(listenPort) {
  const ownPid = process.pid;
  if (process.platform === 'win32') {
    try {
      const out = execSync(`netstat -ano | findstr :${listenPort}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const pids = new Set();
      for (const line of out.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== '0') pids.add(pid);
      }
      for (const pid of pids) {
        if (Number(pid) === ownPid) continue;
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`Stopped previous listener (PID ${pid}) on port ${listenPort}.`);
      }
    } catch {
      /* port free */
    }
    return;
  }
  try {
    const out = execSync(`lsof -ti tcp:${listenPort} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (!out) return;
    let killed = false;
    for (const raw of [...new Set(out.split(/\s+/).filter(Boolean))]) {
      const pid = Number(raw);
      if (!pid || pid === ownPid) continue;
      try {
        process.kill(pid, 'SIGTERM');
        killed = true;
        console.log(`Stopped previous admin listener (PID ${pid}) on port ${listenPort}.`);
      } catch {
        /* already gone */
      }
    }
    if (killed) sleepMs(400);
  } catch {
    /* port free */
  }
}

freeListenPort(port);

server.listen(port, '127.0.0.1', () => {
  console.log(`Resort Operations Desk: http://127.0.0.1:${port}`);
  console.log('  Map editor APIs: /api/maps/*, /api/overworld-models/* (incl. delete)');
  console.log(`  Character editor: /api/character-editor/* (subprocess on :${CHARACTER_EDITOR_PORT})`);
});

function shutdownCharacterEditor() {
  stopCharacterEditor();
}

process.on('exit', shutdownCharacterEditor);
process.on('SIGINT', () => {
  shutdownCharacterEditor();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdownCharacterEditor();
  process.exit(0);
});
