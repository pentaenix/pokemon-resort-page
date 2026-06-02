import { writeGlbFromMesh } from './write-glb.mjs';

/**
 * Compiled OBJ mesh → GLB binary (embedded PNG/JPEG, MASK alpha when PNG has alpha).
 * @param {object} mesh
 * @returns {Promise<Buffer>}
 */
export async function exportMeshToGlb(mesh) {
  return writeGlbFromMesh(mesh);
}
