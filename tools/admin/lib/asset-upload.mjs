import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const ALLOWED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.mp4', '.webm',
]);

const ALLOWED_ROOTS = new Set(['media', 'assets']);

/**
 * @param {string} name
 */
export function sanitizeUploadFilename(name) {
  const base = basename(String(name || 'upload').replace(/\\/g, '/'));
  const ext = extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  const safeStem = stem || 'upload';
  const safeExt = ALLOWED_EXT.has(ext) ? ext : '.webp';
  return `${safeStem}${safeExt}`;
}

/**
 * @param {string} publicRoot
 * @param {string} folder e.g. media/atlas
 * @param {string} [subdir] optional nested folder (pin id, slug, …)
 */
export function resolveUploadDirectory(publicRoot, folder, subdir = '') {
  const parts = String(folder || 'media/uploads')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length || !ALLOWED_ROOTS.has(parts[0])) {
    throw new Error('Upload folder must start with media/ or assets/.');
  }
  if (parts.some((p) => p === '..' || p === '.')) {
    throw new Error('Invalid upload folder.');
  }
  const extra = String(subdir || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, ''))
    .filter(Boolean);
  if (extra.some((p) => p === '..')) throw new Error('Invalid upload subfolder.');
  return join(publicRoot, ...parts, ...extra);
}

async function walkBasename(dir, targetBasename, baseRel = '') {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await walkBasename(full, targetBasename, rel);
      if (found) return found;
      continue;
    }
    if (basename(entry.name).toLowerCase() === targetBasename) return rel;
  }
  return null;
}

/** Find an existing asset anywhere under public/media or public/assets by filename. */
export async function findExistingAssetByBasename(publicRoot, filename) {
  const safeName = sanitizeUploadFilename(filename);
  const targetBasename = basename(safeName).toLowerCase();
  for (const root of ['media', 'assets']) {
    const found = await walkBasename(join(publicRoot, root), targetBasename, root);
    if (found) return found;
  }
  return null;
}

/**
 * @param {string} publicRoot
 * @param {string} folder
 * @param {string} filename
 * @param {Buffer} bytes
 * @param {string} [subdir]
 * @returns {Promise<{ path: string, deduped: boolean }>}
 */
export async function saveUploadedAsset(publicRoot, folder, filename, bytes, subdir = '') {
  const safeName = sanitizeUploadFilename(filename);
  const ext = extname(safeName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`Unsupported file type (${ext || 'unknown'}). Use PNG, JPG, WebP, GIF, SVG, MP4, or WebM.`);
  }
  if (!bytes?.length) throw new Error('Empty upload.');
  if (bytes.length > 50_000_000) throw new Error('File too large (max 50 MB).');

  const existing = await findExistingAssetByBasename(publicRoot, safeName);
  if (existing) {
    return { path: existing, deduped: true };
  }

  const dir = resolveUploadDirectory(publicRoot, folder, subdir);
  const full = join(dir, safeName);
  await mkdir(dir, { recursive: true });
  await writeFile(full, bytes);

  const relParts = String(folder).replace(/\\/g, '/').split('/').filter(Boolean);
  const extra = String(subdir || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return {
    path: [...relParts, ...extra, safeName].join('/'),
    deduped: false,
  };
}
