import { basename } from 'node:path';
import { buildObjMeshFromUpload } from './obj-compile.mjs';
import { exportMeshToGlb } from './mesh-to-glb.mjs';
import { ingestGlbBuffer } from './glb-ingest.mjs';

/**
 * OBJ+MTL+textures (zip) → GLB with alpha-aware materials, then standard GLB ingest manifest.
 * @param {{ relativePath: string, bytes: Buffer }[]} uploadedFiles
 * @param {string} [modelIdHint]
 */
export async function convertObjZipToGlb(uploadedFiles, modelIdHint = '', meta = {}) {
  const {
    modelId,
    mesh,
    warnings,
    materialsMeta,
    objPath,
  } = buildObjMeshFromUpload(uploadedFiles, modelIdHint);

  const glbBuffer = await exportMeshToGlb(mesh);
  const glbFile = `${modelId}.glb`;
  const ingested = ingestGlbBuffer(glbBuffer, modelId, glbFile, meta);

  ingested.manifest.sourceFormat = 'obj';
  ingested.manifest.convertedFromObj = true;
  ingested.manifest.sourceObj = basename(objPath);
  ingested.manifest.materialsMeta = materialsMeta;

  return {
    ...ingested,
    sourceFormat: 'obj',
    warnings,
    mesh,
  };
}
