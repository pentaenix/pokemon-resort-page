import { mkdir, writeFile } from 'node:fs/promises';
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

/**
 * @param {string} publicRoot
 * @param {string} folder
 * @param {string} filename
 * @param {Buffer} bytes
 * @param {string} [subdir]
 */
export async function saveUploadedAsset(publicRoot, folder, filename, bytes, subdir = '') {
  const safeName = sanitizeUploadFilename(filename);
  const ext = extname(safeName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`Unsupported file type (${ext || 'unknown'}). Use PNG, JPG, WebP, GIF, SVG, MP4, or WebM.`);
  }
  if (!bytes?.length) throw new Error('Empty upload.');
  if (bytes.length > 50_000_000) throw new Error('File too large (max 50 MB).');

  const dir = resolveUploadDirectory(publicRoot, folder, subdir);
  let targetName = safeName;
  let full = join(dir, targetName);
  if (existsSync(full)) {
    const stem = targetName.slice(0, targetName.length - ext.length);
    targetName = `${stem}-${Date.now().toString().slice(-6)}${ext}`;
    full = join(dir, targetName);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(full, bytes);

  const relParts = String(folder).replace(/\\/g, '/').split('/').filter(Boolean);
  const extra = String(subdir || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return [...relParts, ...extra, targetName].join('/');
}
