import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { parseGlb, buildMeshFromGltf } from './glb-compile.mjs';

export const GLB_MANIFEST_VERSION = 1;

function hashBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/**
 * Store GLB as-is; manifest holds footprint/stats from a parse pass only.
 * @param {Buffer} buffer
 * @param {string} [modelIdHint]
 * @param {string} [sourceName]
 */
export function ingestGlbBuffer(buffer, modelIdHint = '', sourceName = 'model.glb') {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const { json, bin } = parseGlb(buf);
  const modelId = (modelIdHint || basename(sourceName).replace(/\.glb$/i, '') || 'model')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const mesh = buildMeshFromGltf(modelId, json, bin);
  const compiledAt = new Date().toISOString();
  const glbFile = `${modelId}.glb`;

  const manifest = {
    manifestVersion: GLB_MANIFEST_VERSION,
    storageFormat: 'glb',
    id: modelId,
    displayName: modelId,
    compiledAt,
    sourceFormat: 'glb',
    sourceFile: basename(sourceName),
    glbFile,
    modelFile: glbFile,
    modelByteSize: buf.length,
    modelHash: hashBuffer(buf),
    footprintTiles: mesh.footprint,
    aabb: mesh.aabb,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    materials: mesh.materials.map((m) => m.name),
    textureCount: mesh.textures.length,
  };

  return {
    modelId,
    buffer: buf,
    manifest,
    warnings: [],
    mesh,
  };
}
