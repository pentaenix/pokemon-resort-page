import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { loadProjectEnv } from '../lib/load-env.mjs';
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
const publicRoot = join(root, 'public');
const dataRoot = join(root, 'public/data');
const allowedData = new Set(['site.json','homepage.json','theme.json','research-pois.json','compatibility.json','features.json','bugs.json','gallery.json','models.json','characters.json','roadmap.json','ideas.json']);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.mp4':'video/mp4', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json' };

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
function run(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, shell: process.platform === 'win32' });
    let out = '', err = '';
    child.stdout.on('data', (data) => out += data);
    child.stderr.on('data', (data) => err += data);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}
async function readAllData() {
  const entries = await Promise.all([...allowedData].map(async (file) => [file, JSON.parse(await readFile(join(dataRoot, file), 'utf8'))]));
  return Object.fromEntries(entries);
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/data') return json(res, 200, await readAllData());
    if (url.pathname === '/api/assets') return json(res, 200, { assets: await listAssets() });
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
    if (url.pathname === '/api/save' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      if (!allowedData.has(payload.file)) return json(res, 400, { ok: false, error: 'File is not editable by this tool.' });
      await writeFile(join(dataRoot, payload.file), JSON.stringify(payload.data, null, 2) + '\n');
      const validation = await run('node', ['tools/validate-data.mjs']);
      return json(res, validation.code === 0 ? 200 : 422, { ok: validation.code === 0, validation: validation.out || validation.err });
    }
    if (url.pathname === '/api/publish' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      const message = payload.message || 'Update resort data';
      const validation = await run('node', ['tools/validate-data.mjs']);
      if (validation.code !== 0) return json(res, 422, { ok: false, step: 'validate', output: validation.out || validation.err });
      const add = await run('git', ['add', 'public/data', 'public/assets', 'public/media']);
      const commit = await run('git', ['commit', '-m', message]);
      const commitOutput = commit.out || commit.err;
      const noChanges = /nothing to commit|no changes added/i.test(commitOutput);
      const push = noChanges ? { code: 0, out: 'No changes to push.', err: '' } : await run('git', ['push', 'origin', 'main']);
      return json(res, push.code === 0 ? 200 : 500, { ok: push.code === 0, validation: validation.out, add: add.out || add.err, commit: commitOutput, push: push.out || push.err });
    }

    let filePath;
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/')) filePath = join(publicRoot, url.pathname.replace(/^\//, ''));
    else filePath = url.pathname === '/' ? join(adminRoot, 'index.html') : join(adminRoot, url.pathname.replace(/^\//, ''));
    const allowedRoot = (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/')) ? publicRoot : adminRoot;
    if (!filePath.startsWith(allowedRoot) || !existsSync(filePath)) return json(res, 404, { error: 'Not found' });
    const type = mime[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    json(res, 500, { ok: false, error: error.message });
  }
});

const port = Number(process.env.PORT || 8787);
server.listen(port, '127.0.0.1', () => {
  console.log(`Resort Operations Desk: http://127.0.0.1:${port}`);
});
