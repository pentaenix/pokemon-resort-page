import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const ISLAND_MODEL_DIR = 'media/models/island';
export const ISLAND_MODEL_CANONICAL = 'island_terrain.glb';

/**
 * Replace the island terrain GLB: write one canonical file and remove any other .glb
 * in media/models/island/ so uploads do not accumulate.
 * @param {string} publicRoot
 * @param {Buffer} glbBuffer
 * @returns {Promise<string>} public-relative path (no leading slash)
 */
export async function replaceIslandModelGlb(publicRoot, glbBuffer) {
  const dir = join(publicRoot, ISLAND_MODEL_DIR);
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (ent.name.toLowerCase().endsWith('.glb')) {
      await rm(join(dir, ent.name), { force: true });
    }
  }
  await writeFile(join(dir, ISLAND_MODEL_CANONICAL), glbBuffer);
  return `${ISLAND_MODEL_DIR}/${ISLAND_MODEL_CANONICAL}`;
}
