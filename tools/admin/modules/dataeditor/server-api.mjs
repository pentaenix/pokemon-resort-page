import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const MODULE_ROOT = resolve(new URL('.', import.meta.url).pathname);
const SETTINGS_PATH = join(MODULE_ROOT, 'settings.json');
const MODIFIERS_ROOT = join(MODULE_ROOT, 'modifiers');
const UTILITIES_ROOT = join(MODULE_ROOT, 'utilities');
const DEFAULT_SETTINGS = { configDirectory: 'pokemon-resort/config', createBackups: true, backupDirectory: 'tools/admin/modules/dataeditor/backups' };

function isPathInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith('..'));
}
function safeRelPath(input = '') {
  const normalized = String(input || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '..' || part.startsWith('.'))) throw new Error('Invalid config path.');
  if (!/\.json$/i.test(parts[parts.length - 1])) throw new Error('Only .json files are supported.');
  return parts.join('/');
}
async function readJsonMaybe(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, 'utf8'));
}
async function readSettings() {
  const loaded = await readJsonMaybe(SETTINGS_PATH, {});
  return { ...DEFAULT_SETTINGS, ...(loaded || {}) };
}
async function writeSettings(payload = {}) {
  const current = await readSettings();
  const next = {
    ...current,
    configDirectory: String(payload.configDirectory || current.configDirectory || DEFAULT_SETTINGS.configDirectory).trim(),
    createBackups: payload.createBackups === undefined ? current.createBackups !== false : Boolean(payload.createBackups),
    backupDirectory: String(payload.backupDirectory || current.backupDirectory || DEFAULT_SETTINGS.backupDirectory).trim(),
  };
  await writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
function resolveWorkspacePath(repoRoot, maybeRelative) {
  const raw = String(maybeRelative || '').trim();
  const target = raw.startsWith('/') ? resolve(raw) : resolve(repoRoot, raw);
  if (!isPathInside(target, repoRoot)) throw new Error('Path must stay inside the parent workspace.');
  return target;
}
function resolveConfigBase(repoRoot, settings) { return resolveWorkspacePath(repoRoot, settings.configDirectory || DEFAULT_SETTINGS.configDirectory); }
function resolveBackupBase(root, repoRoot, settings) {
  const raw = settings.backupDirectory || DEFAULT_SETTINGS.backupDirectory;
  if (String(raw).startsWith('/')) {
    const target = resolve(raw);
    if (!isPathInside(target, repoRoot) && !isPathInside(target, root)) throw new Error('Backup path must stay inside the workspace.');
    return target;
  }
  return resolve(root, raw);
}
function fileHash(text) { return createHash('sha256').update(text).digest('hex'); }
function isCommentMetaKey(key = '') {
  const text = String(key || '');
  if (!text.startsWith('_')) return false;
  return /^_(comment|comments|description|descriptions|note|notes)$/i.test(text)
    || /_?(comment|comments|description|descriptions|note|notes)$/i.test(text);
}
function countFields(value) {
  if (Array.isArray(value)) return value.reduce((n, item) => n + countFields(item), 0) || value.length;
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !isCommentMetaKey(key))
      .reduce((n, [, item]) => n + countFields(item), 0);
  }
  return 1;
}
async function walkJsonFiles(dir, base = '') {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'build', 'dist', '__pycache__'].includes(entry.name)) continue;
      out.push(...await walkJsonFiles(full, rel));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) out.push(rel);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
function modifierPathFor(relPath) { const safe = safeRelPath(relPath); return join(MODIFIERS_ROOT, ...safe.split('/')); }
async function readDefaultsModifier() { return await readJsonMaybe(join(MODIFIERS_ROOT, '_defaults.json'), {}); }
function modifierHasCustomizations(modifier = {}) {
  return Object.keys(modifier || {}).some((key) => !String(key).startsWith('__'));
}
function globToRegex(glob = '') {
  const token = '<<<DATA_EDITOR_GLOBSTAR>>>';
  const source = String(glob || '')
    .replace(/\\/g, '/')
    .replace(/\*\*/g, token)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replaceAll(token, '.*');
  return new RegExp(`^${source}$`, 'i');
}
function modifierPatternMatches(pattern = '', relPath = '') {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  const fileName = basename(normalized);
  const candidates = [normalized, fileName];
  try {
    const rx = globToRegex(pattern);
    return candidates.some((candidate) => rx.test(candidate));
  } catch {
    return candidates.some((candidate) => String(pattern).toLowerCase() === candidate.toLowerCase());
  }
}
async function readModifier(relPath) {
  const exact = modifierPathFor(relPath);
  if (existsSync(exact)) return { ...(await readJsonMaybe(exact, {})), __source: relative(MODIFIERS_ROOT, exact).split(sep).join('/') };
  const byName = join(MODIFIERS_ROOT, basename(relPath));
  if (existsSync(byName)) return { ...(await readJsonMaybe(byName, {})), __source: relative(MODIFIERS_ROOT, byName).split(sep).join('/') };
  const modifierFiles = (await walkJsonFiles(MODIFIERS_ROOT)).filter((name) => basename(name) !== '_defaults.json');
  for (const modifierFile of modifierFiles) {
    const target = join(MODIFIERS_ROOT, ...modifierFile.split('/'));
    const modifier = await readJsonMaybe(target, {});
    const matches = [modifier.match, ...(Array.isArray(modifier.matches) ? modifier.matches : [])].filter(Boolean);
    if (matches.some((pattern) => modifierPatternMatches(pattern, relPath))) {
      return { ...modifier, __source: modifierFile, __matchedBy: matches };
    }
  }
  return {};
}

function pathParts(path = '') { return String(path || '').split('.').filter(Boolean); }
function getAtPath(root, path, fallback = undefined) {
  if (!path) return root ?? fallback;
  let cur = root;
  for (const part of pathParts(path)) {
    if (cur == null || !Object.prototype.hasOwnProperty.call(cur, part)) return fallback;
    cur = cur[part];
  }
  return cur;
}
function optionFromValue(value, label = value) {
  if (value && typeof value === 'object') return { value: value.value ?? value.id ?? value.key ?? '', label: value.label ?? value.name ?? value.value ?? value.id ?? value.key ?? '' };
  return { value, label };
}
function readOptionProp(item, prop, fallback = '') {
  if (prop === undefined || prop === null || prop === '') return fallback;
  return getAtPath(item, prop, fallback);
}
function normalizeOptions(options = []) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(options) ? options : []) {
    const option = optionFromValue(item);
    const value = option.value == null ? '' : String(option.value);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: String(option.label ?? value) });
  }
  return out;
}
function optionsFromData(data, spec = {}) {
  const include = normalizeOptions(spec.include || spec.prepend || []);
  const sourcePaths = Array.isArray(spec.paths) && spec.paths.length ? spec.paths : [spec.path || ''];
  let dynamic = [];
  for (const sourcePath of sourcePaths) {
    const source = getAtPath(data, sourcePath, data);
    if (Array.isArray(source)) {
      dynamic.push(...source
        .map((item) => {
          const value = readOptionProp(item, spec.value ?? spec.valuePath ?? 'id', item);
          const label = readOptionProp(item, spec.label ?? spec.labelPath ?? spec.value ?? spec.valuePath ?? 'id', value);
          return optionFromValue(value, label);
        }));
    } else if (source && typeof source === 'object') {
      dynamic.push(...Object.entries(source).map(([key, item]) => {
        if (spec.keys === false && item && typeof item === 'object') {
          const value = readOptionProp(item, spec.value ?? spec.valuePath ?? 'id', key);
          const label = readOptionProp(item, spec.label ?? spec.labelPath ?? spec.value ?? spec.valuePath ?? 'id', value);
          return optionFromValue(value, label);
        }
        return optionFromValue(key, item && typeof item === 'object' ? (item.label ?? item.name ?? item.id ?? key) : key);
      }));
    }
  }
  const append = normalizeOptions(spec.append || []);
  return normalizeOptions([...include, ...dynamic, ...append]);
}
async function readConfigDataByRelPath(ctx, settings, relPath) {
  const safe = safeRelPath(relPath);
  const base = resolveConfigBase(ctx.repoRoot, settings);
  const target = resolve(base, ...safe.split('/'));
  if (!isPathInside(target, base)) throw new Error('Invalid dynamic options config path.');
  if (!existsSync(target)) return {};
  return JSON.parse(await readFile(target, 'utf8'));
}
function normalizeExtensions(values = []) {
  return new Set((Array.isArray(values) ? values : [values])
    .map((ext) => String(ext || '').trim().toLowerCase())
    .filter(Boolean)
    .map((ext) => ext.startsWith('.') ? ext : `.${ext}`));
}
async function walkAssetFiles(dir, base = '', recursive = false) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...await walkAssetFiles(full, rel, recursive));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}
async function optionsFromAssets(ctx, settings, spec = {}) {
  const directory = String(spec.directory || spec.path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!directory || directory.split('/').some((part) => !part || part === '..' || part.startsWith('.'))) {
    return normalizeOptions(spec.include || []);
  }
  const config_base = resolveConfigBase(ctx.repoRoot, settings);
  const project_root = dirname(config_base);
  const target = resolve(project_root, ...directory.split('/'));
  if (!isPathInside(target, project_root)) throw new Error('Invalid dynamic asset options path.');
  const extensions = normalizeExtensions(spec.extensions || spec.ext || []);
  const files = await walkAssetFiles(target, '', Boolean(spec.recursive));
  const dynamic = files
    .filter((file) => !extensions.size || extensions.has(`.${file.split('.').pop().toLowerCase()}`))
    .map((file) => {
      const value = `${directory}/${file}`.replace(/\/+/g, '/');
      return { value, label: spec.label === 'path' ? value : file };
    });
  return normalizeOptions([...(spec.include || []), ...dynamic, ...(spec.append || [])]);
}
async function resolveRuleDynamicOptions(ctx, settings, currentData, rule = {}) {
  if (!rule || typeof rule !== 'object') return rule;
  if (rule.optionsFromAssets) {
    const spec = typeof rule.optionsFromAssets === 'string'
      ? { directory: rule.optionsFromAssets }
      : rule.optionsFromAssets;
    return { ...rule, options: await optionsFromAssets(ctx, settings, spec) };
  }
  const sourceSpec = rule.optionsFromFile || rule.optionsFrom;
  if (!sourceSpec) return rule;
  const spec = typeof sourceSpec === 'string' ? { path: sourceSpec } : sourceSpec;
  const sourceData = rule.optionsFromFile?.file
    ? await readConfigDataByRelPath(ctx, settings, rule.optionsFromFile.file)
    : currentData;
  return { ...rule, options: optionsFromData(sourceData, spec) };
}
async function resolveModifierDynamicOptions(ctx, settings, currentData, modifier = {}) {
  const resolved = JSON.parse(JSON.stringify(modifier || {}));
  for (const [path, rule] of Object.entries(resolved.fields || {})) resolved.fields[path] = await resolveRuleDynamicOptions(ctx, settings, currentData, rule);
  for (const [pattern, rule] of Object.entries(resolved.patterns || {})) resolved.patterns[pattern] = await resolveRuleDynamicOptions(ctx, settings, currentData, rule);
  return resolved;
}

function safeUtilityName(input = '') {
  const name = String(input || '').trim().replace(/\.json$/i, '');
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error(`Invalid utility name: ${input}`);
  return `${name}.json`;
}
async function readUtilityDefinition(name) {
  if (!name) return {};
  const target = join(UTILITIES_ROOT, safeUtilityName(name));
  if (!existsSync(target)) return {};
  return await readJsonMaybe(target, {});
}
async function resolveModifierUtilities(modifier = {}) {
  const entries = Array.isArray(modifier.utilities) ? modifier.utilities : [];
  const out = [];
  for (const entry of entries) {
    const utilityName = entry.utility || entry.ref || entry.id || entry.type;
    const base = await readUtilityDefinition(utilityName);
    out.push({ ...base, ...entry, type: entry.type || base.type || entry.utility || base.id || 'utility' });
  }
  return out;
}
async function hasModifier(relPath) {
  return modifierHasCustomizations(await readModifier(relPath));
}
async function listFiles(ctx) {
  const settings = await readSettings();
  const base = resolveConfigBase(ctx.repoRoot, settings);
  const rels = await walkJsonFiles(base);
  const files = [];
  for (const rel of rels) {
    const full = resolve(base, rel);
    const st = await stat(full);
    let parseError = '', fieldCount = 0;
    try { fieldCount = countFields(JSON.parse(await readFile(full, 'utf8'))); } catch (error) { parseError = error.message; }
    const modifier = await readModifier(rel);
    const browseFolder = String(modifier.browseFolder || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const folder = browseFolder || (dirname(rel) === '.' ? '' : dirname(rel));
    files.push({ path: rel, name: basename(rel), folder, size: st.size, modifiedAt: st.mtime.toISOString(), hasModifier: modifierHasCustomizations(modifier), modifierSource: modifier.__source || '', title: modifier.title || '', description: modifier.description || '', tags: Array.isArray(modifier.tags) ? modifier.tags : [], fieldCount, parseError });
  }
  return { settings, resolvedPath: base, files };
}
async function readConfigFile(ctx, relPath) {
  const safe = safeRelPath(relPath);
  const settings = await readSettings();
  const base = resolveConfigBase(ctx.repoRoot, settings);
  const target = resolve(base, ...safe.split('/'));
  if (!isPathInside(target, base)) throw new Error('Invalid config path.');
  if (!existsSync(target)) throw new Error(`Config not found: ${safe}`);
  const rawText = await readFile(target, 'utf8');
  let data;
  try { data = JSON.parse(rawText); } catch (error) { throw new Error(`Invalid JSON in ${safe}: ${error.message}`); }
  const st = await stat(target);
  const modifier = await resolveModifierDynamicOptions(ctx, settings, data, await readModifier(safe));
  return { file: safe, data, rawText, hash: fileHash(rawText), modifier, utilities: await resolveModifierUtilities(modifier), defaults: await readDefaultsModifier(), stats: { size: st.size, modifiedAt: st.mtime.toISOString() }, resolvedPath: target };
}
function timestamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }
async function saveConfigFile(ctx, payload) {
  const safe = safeRelPath(payload.file);
  const settings = await readSettings();
  const base = resolveConfigBase(ctx.repoRoot, settings);
  const target = resolve(base, ...safe.split('/'));
  if (!isPathInside(target, base)) throw new Error('Invalid config path.');
  if (!existsSync(target)) throw new Error(`Config not found: ${safe}`);
  const nextData = typeof payload.rawText === 'string' ? JSON.parse(payload.rawText) : payload.data;
  const nextText = `${JSON.stringify(nextData, null, 2)}\n`;
  const beforeText = await readFile(target, 'utf8');
  let backupPath = '';
  if (settings.createBackups !== false && payload.createBackup !== false) {
    const backupBase = resolveBackupBase(ctx.root, ctx.repoRoot, settings);
    const backupDir = join(backupBase, dirname(safe));
    await mkdir(backupDir, { recursive: true });
    backupPath = join(backupDir, `${basename(safe, '.json')}.${timestamp()}.bak.json`);
    await writeFile(backupPath, beforeText);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, nextText);
  return { ok: true, file: safe, hash: fileHash(nextText), bytes: Buffer.byteLength(nextText), backupPath: backupPath ? relative(ctx.root, backupPath).split(sep).join('/') : '' };
}
async function listModifiers() { const rels = await walkJsonFiles(MODIFIERS_ROOT); return rels.map((path) => ({ path, name: basename(path) })); }

export async function handleDataEditorApi(ctx) {
  const { req, res, url, readBody, json } = ctx;
  try {
    if (url.pathname === '/api/data-editor/settings') {
      if (req.method === 'POST') {
        const payload = JSON.parse(await readBody(req));
        const settings = await writeSettings(payload);
        return json(res, 200, { ok: true, settings, resolvedPath: resolveConfigBase(ctx.repoRoot, settings) });
      }
      const settings = await readSettings();
      return json(res, 200, { ok: true, settings, resolvedPath: resolveConfigBase(ctx.repoRoot, settings) });
    }
    if (url.pathname === '/api/data-editor/files') return json(res, 200, { ok: true, ...(await listFiles(ctx)), defaults: await readDefaultsModifier() });
    if (url.pathname === '/api/data-editor/file') return json(res, 200, { ok: true, ...(await readConfigFile(ctx, url.searchParams.get('file') || '')) });
    if (url.pathname === '/api/data-editor/save' && req.method === 'POST') return json(res, 200, await saveConfigFile(ctx, JSON.parse(await readBody(req))));
    if (url.pathname === '/api/data-editor/validate' && req.method === 'POST') { const payload = JSON.parse(await readBody(req)); JSON.parse(typeof payload.rawText === 'string' ? payload.rawText : JSON.stringify(payload.data)); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/data-editor/modifiers') return json(res, 200, { ok: true, modifiers: await listModifiers(), defaults: await readDefaultsModifier() });
    return json(res, 404, { ok: false, error: 'Unknown Data Editor endpoint.' });
  } catch (error) { return json(res, 400, { ok: false, error: error.message }); }
}
