import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const SCRIPT_ROOT_RELATIVE = 'pokemon-resort/config/gameplay/world3d/scripts';
const INTERACTION_TEXT_RELATIVE = 'pokemon-resort/config/gameplay/world3d/interaction_text.json';
const ACTIONS = new Set(['WAIT', 'FACE', 'FACE_PLAYER', 'FACE_AWAY', 'MOVE', 'WANDER', 'JUMP', 'TEXT', 'TEXT_LITERAL', 'TEXT_FREE', 'POKEMON_INTERACTION_SESSION', 'DISABLE_ATTEND', 'ENABLE_ATTEND', 'EXIT_INTERACTION', 'CRY', 'EMOTICON']);
const KINDS = new Set(['idle', 'interaction', 'npc']);

function inside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith('..'));
}
function safePath(value = '') {
  const path = String(value).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!path || !path.endsWith('.json') || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid script path.');
  return path;
}
function validate(script) {
  const issues = [];
  if (!script || typeof script !== 'object') return ['Script must be an object.'];
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(String(script.id || ''))) issues.push('id must use lowercase letters, numbers, and underscores.');
  if (!KINDS.has(String(script.kind || ''))) issues.push('kind must be idle, interaction, or npc.');
  if (!Array.isArray(script.actions) || !script.actions.length) issues.push('A script needs at least one action.');
  for (const action of script.actions || []) {
    if (!ACTIONS.has(String(action?.action || '').toUpperCase())) issues.push(`Unknown action: ${action?.action || '(empty)'}.`);
    if (['CRY', 'EMOTICON'].includes(String(action?.action || '').toUpperCase())) issues.push(`${String(action.action).toUpperCase()} has no runtime adapter yet.`);
  }
  return issues;
}
function validateTextCatalog(catalog) {
  const issues = [];
  const ids = new Set();
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.texts)) return ['Text catalog needs a texts array.'];
  for (const entry of catalog.texts) {
    const id = String(entry?.id || '');
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(id)) issues.push('Text id must use lowercase letters, numbers, and underscores.');
    if (ids.has(id)) issues.push(`Duplicate text id: ${id}.`);
    ids.add(id);
    if (!String(entry?.body || '').trim()) issues.push(`${id || 'Text'} needs dialogue.`);
    if (!Array.isArray(entry?.requiredTags)) issues.push(`${id || 'Text'} needs requiredTags.`);
    if (!Number.isFinite(Number(entry?.weight)) || Number(entry.weight) < 1) issues.push(`${id || 'Text'} weight must be at least 1.`);
    if (!Number.isFinite(Number(entry?.globalCooldownSeconds)) || Number(entry.globalCooldownSeconds) < 0) issues.push(`${id || 'Text'} cooldown cannot be negative.`);
    if ((entry?.requiredTags || []).some((tag) => !/^[A-Z][A-Z0-9_]*$/.test(String(tag)))) issues.push(`${id || 'Text'} tags must be uppercase identifiers.`);
  }
  return issues;
}
async function catalog(root) {
  const path = join(root, 'script_catalog.json');
  if (!existsSync(path)) return { scripts: [] };
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function handleScriptEngineApi(ctx) {
  const { req, res, url, repoRoot, readBody, json } = ctx;
  const root = resolve(repoRoot, SCRIPT_ROOT_RELATIVE);
  try {
    if (url.pathname === '/api/script-engine/scripts') {
      const index = await catalog(root);
      return json(res, 200, { ok: true, scripts: index.scripts || [] });
    }
    if (url.pathname === '/api/script-engine/script') {
      const path = safePath(url.searchParams.get('path'));
      const target = resolve(root, path);
      if (!inside(target, root) || !existsSync(target)) throw new Error('Script not found.');
      return json(res, 200, { ok: true, path, script: JSON.parse(await readFile(target, 'utf8')) });
    }
    if (url.pathname === '/api/script-engine/validate' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      return json(res, 200, { ok: true, issues: validate(payload.script) });
    }
    if (url.pathname === '/api/script-engine/save' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      const path = safePath(payload.path);
      const issues = validate(payload.script);
      if (issues.length) return json(res, 400, { ok: false, issues, error: issues[0] });
      const target = resolve(root, path);
      if (!inside(target, root)) throw new Error('Invalid script path.');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(payload.script, null, 2)}\n`);
      const index = await catalog(root);
      const scripts = Array.isArray(index.scripts) ? index.scripts : [];
      if (!scripts.some((entry) => entry.path === path)) scripts.push({ path });
      await writeFile(join(root, 'script_catalog.json'), `${JSON.stringify({ scripts }, null, 2)}\n`);
      return json(res, 200, { ok: true, path, issues: [] });
    }
    if (url.pathname === '/api/script-engine/texts') {
      const path = resolve(repoRoot, INTERACTION_TEXT_RELATIVE);
      return json(res, 200, { ok: true, catalog: existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : { texts: [] } });
    }
    if (url.pathname === '/api/script-engine/condition-values') {
      const speciesRoot = resolve(repoRoot, 'pokemon-resort/assets/characters/pokemon');
      const species = existsSync(speciesRoot)
        ? (await readdir(speciesRoot)).filter((name) => name.endsWith('.charbin')).map((name) => name.slice(0, -8).toUpperCase()).sort()
        : [];
      return json(res, 200, { ok: true, species });
    }
    if (url.pathname === '/api/script-engine/texts/save' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req));
      const issues = validateTextCatalog(payload.catalog);
      if (issues.length) return json(res, 400, { ok: false, issues, error: issues[0] });
      const path = resolve(repoRoot, INTERACTION_TEXT_RELATIVE);
      await writeFile(path, `${JSON.stringify(payload.catalog, null, 2)}\n`);
      return json(res, 200, { ok: true, issues: [] });
    }
    return json(res, 404, { ok: false, error: 'Unknown Script Engine endpoint.' });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message, issues: [] });
  }
}
