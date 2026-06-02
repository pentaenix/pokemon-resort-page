import { join, dirname, basename } from 'node:path';
import { findObjAndMtl, resolveTextureForMaterial } from './asset-resolve.mjs';

const TILE_SIZE = 16;

function trim(s) {
  return s.trim();
}

function parseObjIndexPart(raw, count) {
  if (!raw || raw === '') return -1;
  const idx = parseInt(raw, 10);
  if (Number.isNaN(idx)) return -1;
  if (idx > 0) return idx - 1;
  if (idx < 0) return count + idx;
  return -1;
}

function parseObjCorner(token, posCount, uvCount, normCount) {
  const slash = token.indexOf('/');
  if (slash === -1) {
    return { pi: parseObjIndexPart(token, posCount), ti: -1, ni: -1 };
  }
  const parts = token.split('/');
  return {
    pi: parseObjIndexPart(parts[0], posCount),
    ti: parseObjIndexPart(parts[1], uvCount),
    ni: parseObjIndexPart(parts[2], normCount),
  };
}

function parseObj(text) {
  const positions = [];
  const uvs = [];
  const normals = [];
  const faces = [];
  let activeMaterial = '';

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) {
      const p = line.slice(2).trim().split(/\s+/).map(Number);
      positions.push([p[0] || 0, p[1] || 0, p[2] || 0]);
    } else if (line.startsWith('vt ')) {
      const p = line.slice(3).trim().split(/\s+/).map(Number);
      uvs.push([p[0] || 0, p[1] || 0]);
    } else if (line.startsWith('vn ')) {
      const p = line.slice(3).trim().split(/\s+/).map(Number);
      normals.push([p[0] || 0, p[1] || 0, p[2] || 0]);
    } else if (line.startsWith('usemtl ')) {
      activeMaterial = trim(line.slice(7));
    } else if (line.startsWith('f ')) {
      const tokens = line.slice(2).trim().split(/\s+/);
      const verts = tokens.map((tok) => parseObjCorner(tok, positions.length, uvs.length, normals.length));
      if (verts.length < 3) continue;
      for (let i = 1; i + 1 < verts.length; i += 1) {
        faces.push({
          material: activeMaterial,
          a: verts[0],
          b: verts[i],
          c: verts[i + 1],
        });
      }
    }
  }

  return { positions, uvs, normals, faces };
}

function parseMtl(text, mtlDir, fileMap) {
  const materials = {};
  let current = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('newmtl ')) {
      current = trim(line.slice(7));
      materials[current] = { name: current, mapKd: null, kd: [0.78, 0.78, 0.78] };
    } else if (/^map_Kd\s/i.test(line) && current) {
      let tex = trim(line.replace(/^map_Kd\s+/i, ''));
      if (tex.includes(' ')) tex = tex.split(/\s+/).pop();
      materials[current].mapKd = tex;
    } else if (line.startsWith('Kd ') && current) {
      const p = line.slice(3).trim().split(/\s+/).map(Number);
      materials[current].kd = [p[0] ?? 0.78, p[1] ?? 0.78, p[2] ?? 0.78];
    }
  }

  for (const mat of Object.values(materials)) {
    const hit = resolveTextureForMaterial(mat.mapKd, mtlDir, fileMap, mat.name);
    if (hit) {
      mat.textureBytes = hit.bytes;
      mat.textureName = hit.textureName;
      mat.textureResolved = hit.resolved;
      if (hit.guessed) mat.textureGuessed = true;
    }
  }

  return materials;
}

function computeNormals(positions, faces) {
  const out = positions.map(() => [0, 0, 0]);
  for (const f of faces) {
    const pa = positions[f.a.pi];
    const pb = positions[f.b.pi];
    const pc = positions[f.c.pi];
    const ux = pb[0] - pa[0]; const uy = pb[1] - pa[1]; const uz = pb[2] - pa[2];
    const vx = pc[0] - pa[0]; const vy = pc[1] - pa[1]; const vz = pc[2] - pa[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const vi of [f.a.pi, f.b.pi, f.c.pi]) {
      out[vi][0] += nx;
      out[vi][1] += ny;
      out[vi][2] += nz;
    }
  }
  return out.map(([x, y, z]) => {
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  });
}

function detectTextureFormat(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  return 'png';
}

function imageDimensions(bytes, format) {
  if (format === 'png' && bytes.length > 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (format === 'jpeg' && bytes.length > 2) {
    let o = 2;
    while (o < bytes.length) {
      if (bytes[o] !== 0xff) break;
      const marker = bytes[o + 1];
      const len = bytes.readUInt16BE(o + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        return { height: bytes.readUInt16BE(o + 5), width: bytes.readUInt16BE(o + 7) };
      }
      o += 2 + len;
    }
  }
  return { width: 0, height: 0 };
}

function requireObjTextureCoords(obj) {
  let withUv = 0;
  for (const f of obj.faces) {
    if (f.a.ti >= 0 && f.b.ti >= 0 && f.c.ti >= 0) withUv += 1;
  }
  if (withUv < obj.faces.length * 0.85) {
    throw new Error('OBJ must include texture coordinates (vt) on at least 85% of faces.');
  }
}

function buildMesh(modelId, obj, materials) {
  const computedNormals = computeNormals(obj.positions, obj.faces);
  const vertKey = (pi, ti, ni, mat) => `${pi}|${ti}|${ni}|${mat}`;
  const vertMap = new Map();
  const vertices = [];
  const indices = [];
  const triangleMaterials = [];
  const materialOrder = [];
  const materialIndex = new Map();
  const textures = [];
  const texIndexByMaterial = new Map();

  function ensureMaterial(name) {
    if (!materialIndex.has(name)) {
      materialIndex.set(name, materialOrder.length);
      materialOrder.push(name);
    }
    return materialIndex.get(name);
  }

  /** One embedded texture per MTL material name (avoids wrong sharing across materials). */
  function getTextureIndex(matName) {
    const mat = materials[matName];
    if (!mat?.textureBytes) return 255;
    if (!texIndexByMaterial.has(matName)) {
      const format = detectTextureFormat(mat.textureBytes);
      const dim = imageDimensions(mat.textureBytes, format);
      texIndexByMaterial.set(matName, textures.length);
      textures.push({
        format,
        width: dim.width,
        height: dim.height,
        bytes: mat.textureBytes,
        materialName: matName,
      });
    }
    return texIndexByMaterial.get(matName);
  }

  for (const face of obj.faces) {
    const matName = face.material || 'default';
    ensureMaterial(matName);
    const corners = [face.a, face.b, face.c];
    const triIndices = [];
    for (const corner of corners) {
      const pi = corner.pi;
      const ti = corner.ti >= 0 ? corner.ti : 0;
      const ni = corner.ni >= 0 ? corner.ni : pi;
      const key = vertKey(pi, ti, ni, matName);
      if (!vertMap.has(key)) {
        const p = obj.positions[pi] || [0, 0, 0];
        const n = (corner.ni >= 0 && obj.normals[corner.ni])
          ? obj.normals[corner.ni]
          : (computedNormals[pi] || [0, 1, 0]);
        const uv = obj.uvs[ti] || [0, 0];
        // OBJ texcoord origin is bottom-left; glTF (and our SDL renderer) use top-left.
        // Flip V so authored UVs sample the same texels external OBJ viewers show.
        const base = vertices.length / 8;
        vertices.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], 1 - uv[1]);
        vertMap.set(key, base);
      }
      triIndices.push(vertMap.get(key));
    }
    indices.push(...triIndices);
    const matSlot = ensureMaterial(matName);
    triangleMaterials.push(matSlot);
  }

  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 8) {
    minX = Math.min(minX, vertices[i]);
    minY = Math.min(minY, vertices[i + 1]);
    minZ = Math.min(minZ, vertices[i + 2]);
    maxX = Math.max(maxX, vertices[i]);
    maxY = Math.max(maxY, vertices[i + 1]);
    maxZ = Math.max(maxZ, vertices[i + 2]);
  }
  if (!Number.isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }

  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const spanY = maxY - minY;

  const prMaterials = materialOrder.map((name) => {
    const texIdx = getTextureIndex(name);
    return {
      name,
      textureIndex: texIdx === 255 ? 255 : texIdx,
    };
  });

  if (textures.length === 0) {
    const px = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);
    textures.push({ format: 'png', width: 1, height: 1, bytes: px, materialName: 'fallback' });
    for (const m of prMaterials) {
      if (m.textureIndex === 255) m.textureIndex = 0;
    }
  }

  return {
    id: modelId,
    aabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    footprint: {
      w: Math.max(1, Math.ceil(spanX / TILE_SIZE)),
      d: Math.max(1, Math.ceil(spanZ / TILE_SIZE)),
      h: Math.max(1, Math.ceil(spanY / TILE_SIZE)),
    },
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    triangleMaterials: new Uint8Array(triangleMaterials),
    materials: prMaterials,
    textures,
    vertexCount: vertices.length / 8,
    triangleCount: indices.length / 3,
  };
}

/**
 * @param {{ relativePath: string, bytes: Buffer }[]} uploadedFiles
 * @param {string} [modelIdHint]
 */
export function buildObjMeshFromUpload(uploadedFiles, modelIdHint = '') {
  if (!uploadedFiles?.length) throw new Error('No files uploaded.');

  const fileMap = new Map();
  let rootPrefix = '';

  for (const f of uploadedFiles) {
    const rel = (f.relativePath || f.name || '').replace(/\\/g, '/');
    if (!rel) continue;
    const parts = rel.split('/');
    if (parts.length > 1 && !rootPrefix) rootPrefix = parts[0];
    fileMap.set(rel, f.bytes);
    fileMap.set(basename(rel), f.bytes);
  }

  const modelId = (modelIdHint || rootPrefix || 'model').replace(/[^a-zA-Z0-9_-]/g, '_');

  const { objPath, objText, mtlPath, mtlText, mtlDir } = findObjAndMtl(fileMap);
  if (!objText) throw new Error('No .obj file found in folder.');

  const obj = parseObj(objText);
  if (!obj.faces.length) throw new Error('OBJ has no faces.');

  const materials = mtlText ? parseMtl(mtlText, mtlDir, fileMap) : {};
  if (!mtlText) {
    throw new Error('No .mtl file found. Include the MTL referenced by the OBJ (textures are required).');
  }

  requireObjTextureCoords(obj);
  const mesh = buildMesh(modelId, obj, materials);

  const warnings = [];
  const mtllibLine = objText.match(/^mtllib\s+(.+)$/im)?.[1]?.trim();
  if (mtllibLine && mtlPath && !mtllibLine.includes(basename(mtlPath))) {
    warnings.push(`mtllib "${mtllibLine}" did not match filename exactly (Unicode/encoding); used "${basename(mtlPath)}" instead.`);
  }
  const usedMaterials = new Set(obj.faces.map((f) => f.material || 'default'));
  for (const name of usedMaterials) {
    const mat = materials[name];
    if (!mat?.textureBytes) {
      warnings.push(`Material "${name}" has no baked texture (check map_Kd or ${name}.png in folder).`);
    } else if (mat.textureGuessed) {
      warnings.push(`Material "${name}" texture matched by name (${mat.textureName}), not map_Kd path.`);
    }
  }
  if (mesh.textures.length === 0) {
    throw new Error('No textures could be baked. Add PNG/JPEG files referenced by the MTL next to the OBJ.');
  }
  const missingUsed = [...usedMaterials].filter((n) => !materials[n]?.textureBytes);
  if (missingUsed.length) {
    throw new Error(`Missing textures for material(s): ${missingUsed.join(', ')}`);
  }

  const materialsMeta = Object.fromEntries(
    Object.entries(materials).map(([name, m]) => [name, {
      textureResolved: m.textureResolved,
      textureName: m.textureName,
    }]),
  );

  return { modelId, mesh, warnings, materialsMeta, objPath, mtlPath };
}

