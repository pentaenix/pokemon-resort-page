import { basename } from 'node:path';
import { unzipArchive } from './zip-assets.mjs';
import { ingestGlbBuffer } from './glb-ingest.mjs';
import { convertObjZipToGlb } from './obj-to-glb.mjs';
import { findObjAndMtl, resolveTextureForMaterial } from './asset-resolve.mjs';

export function unzipUploadArchive(buffer) {
  return unzipArchive(buffer);
}

export function detectArchiveFormat(files) {
  const glb = files.find((f) => /\.glb$/i.test(f.relativePath));
  if (glb) return { format: 'glb', file: glb };
  const obj = files.find((f) => /\.obj$/i.test(f.relativePath));
  if (obj) return { format: 'obj', file: obj };
  return { format: 'unknown' };
}

/**
 * @param {{ relativePath: string, bytes: Buffer }[]} files
 */
export function inspectUploadedFiles(files) {
  const detected = detectArchiveFormat(files);
  const root = files[0]?.relativePath?.replace(/\\/g, '/').split('/').filter(Boolean)[0] || '';
  const defaultId = root.replace(/[^a-zA-Z0-9_-]/g, '_') || 'model';

  if (detected.format === 'glb') {
    const buf = detected.file.bytes;
    const id = basename(detected.file.relativePath).replace(/\.glb$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') || defaultId;
    const valid = buf.length >= 20 && buf.readUInt32LE(0) === 0x46546c67;
    return {
      format: 'glb',
      modelId: id,
      valid,
      issues: valid ? [] : ['Invalid GLB file.'],
      sourceFile: detected.file.relativePath,
      materials: [{ name: 'GLB (embedded)', ok: true, mapKd: 'embedded' }],
      mtlInspect: null,
    };
  }

  if (detected.format === 'obj') {
    const fileMap = new Map();
    for (const f of files) {
      const rel = f.relativePath.replace(/\\/g, '/');
      fileMap.set(rel, f.bytes);
      fileMap.set(basename(rel), f.bytes);
    }
    const { mtlPath, mtlText, mtlDir } = findObjAndMtl(fileMap);
    const issues = [];
    const materials = [];
    if (!mtlText) issues.push('No .mtl in zip.');
    else {
      let current = null;
      for (const line of mtlText.split(/\r?\n/)) {
        if (line.startsWith('newmtl ')) {
          current = { name: line.slice(7).trim(), mapKd: null, ok: false };
          materials.push(current);
        } else if (/^map_Kd\s/i.test(line) && current) {
          current.mapKd = line.replace(/^map_Kd\s+/i, '').trim().split(/\s+/).pop();
        }
      }
      for (const mat of materials) {
        const hit = resolveTextureForMaterial(mat.mapKd, mtlDir, fileMap, mat.name);
        mat.ok = Boolean(hit);
        mat.resolved = hit?.resolved || null;
      }
      if (materials.some((m) => m.mapKd && !m.ok)) issues.push('Missing texture file(s) in zip.');
    }
    return {
      format: 'obj',
      obj: detected.file.relativePath,
      mtl: mtlPath,
      modelId: defaultId,
      valid: Boolean(mtlText) && issues.length === 0,
      issues,
      materials,
      mtlInspect: { materials, canCompile: issues.length === 0 },
      convertsToGlb: true,
    };
  }

  return {
    format: 'unknown',
    modelId: defaultId,
    valid: false,
    issues: ['Upload a .glb file, or a .zip with .glb or .obj+.mtl+textures.'],
    materials: [],
    mtlInspect: null,
  };
}

export async function ingestUploadedFiles(files, modelIdHint = '') {
  const detected = detectArchiveFormat(files);
  if (detected.format === 'glb') {
    const result = ingestGlbBuffer(
      detected.file.bytes,
      modelIdHint,
      detected.file.relativePath,
    );
    return { ...result, sourceFormat: 'glb' };
  }
  if (detected.format === 'obj') {
    const result = await convertObjZipToGlb(files, modelIdHint);
    return { ...result, sourceFormat: 'obj' };
  }
  throw new Error('Upload a .glb file, or a .zip with .glb or .obj+.mtl+textures.');
}

/** @param {Buffer} glbBytes */
export function ingestGlbUpload(glbBytes, modelIdHint = '', sourceName = 'model.glb') {
  const result = ingestGlbBuffer(glbBytes, modelIdHint, sourceName);
  return { ...result, sourceFormat: 'glb' };
}

export async function ingestUploadArchive(buffer, modelIdHint = '') {
  const files = unzipArchive(buffer);
  return ingestUploadedFiles(files, modelIdHint);
}

export function inspectUploadArchive(buffer) {
  const files = unzipArchive(buffer);
  return inspectUploadedFiles(files);
}

export function inspectGlbUpload(glbBytes, sourceName = 'model.glb') {
  const buf = Buffer.isBuffer(glbBytes) ? glbBytes : Buffer.from(glbBytes);
  const valid = buf.length >= 20 && buf.readUInt32LE(0) === 0x46546c67;
  const id = basename(sourceName).replace(/\.glb$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'model';
  return {
    format: 'glb',
    modelId: id,
    valid,
    issues: valid ? [] : ['Invalid GLB file.'],
    sourceFile: sourceName,
    materials: [{ name: 'GLB (embedded)', ok: true, mapKd: 'embedded' }],
    mtlInspect: null,
  };
}
