import { unzipSync } from 'fflate';

/**
 * Extract a .zip upload into { relativePath, bytes }[] (zip-slip safe).
 */
export function unzipArchive(buffer) {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const entries = unzipSync(data);
  const files = [];

  for (const [rawPath, bytes] of Object.entries(entries)) {
    const rel = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || rel.endsWith('/')) continue;
    if (rel.split('/').some((seg) => seg === '..')) continue;
    files.push({
      relativePath: rel,
      name: rel.split('/').pop(),
      bytes: Buffer.from(bytes),
    });
  }

  if (!files.length) throw new Error('Zip archive is empty.');
  return files;
}
