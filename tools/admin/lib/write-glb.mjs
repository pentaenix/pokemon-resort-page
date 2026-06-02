import { textureHasAlpha } from './texture-alpha.mjs';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** glTF 2.0 enum values */
const FILTER_NEAREST = 9720;
const WRAP_REPEAT = 10497;

function align4(n) {
  return (n + 3) & ~3;
}

function packGlb(json, binBuffer) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunkLen = jsonBuf.length + jsonPad;
  const binPad = (4 - (binBuffer.length % 4)) % 4;
  const binChunkLen = binBuffer.length + binPad;
  const total = 12 + 8 + jsonChunkLen + 8 + binChunkLen;
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(GLB_MAGIC, o); o += 4;
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jsonChunkLen, o); o += 4;
  out.writeUInt32LE(CHUNK_JSON, o); o += 4;
  jsonBuf.copy(out, o);
  for (let i = 0; i < jsonPad; i += 1) out[o + jsonBuf.length + i] = 0x20;
  o += jsonBuf.length + jsonPad;
  out.writeUInt32LE(binChunkLen, o); o += 4;
  out.writeUInt32LE(CHUNK_BIN, o); o += 4;
  binBuffer.copy(out, o);
  return out;
}

/**
 * @param {object} mesh from obj-compile (material slot → textureIndex → textures[])
 * @returns {Buffer}
 */
export function writeGlbFromMesh(mesh) {
  const { vertices, indices, materials, triangleMaterials, textures, id } = mesh;
  const vertexCount = vertices.length / 8;
  const matCount = materials.length;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i += 1) {
    const b = i * 8;
    positions[i * 3] = vertices[b];
    positions[i * 3 + 1] = vertices[b + 1];
    positions[i * 3 + 2] = vertices[b + 2];
    normals[i * 3] = vertices[b + 3];
    normals[i * 3 + 1] = vertices[b + 4];
    normals[i * 3 + 2] = vertices[b + 5];
    uvs[i * 2] = vertices[b + 6];
    uvs[i * 2 + 1] = vertices[b + 7];
  }

  const triPerMat = Array.from({ length: matCount }, () => []);
  const triCount = indices.length / 3;
  for (let t = 0; t < triCount; t += 1) {
    let slot = triangleMaterials?.[t] ?? 0;
    if (slot >= matCount) slot = 0;
    triPerMat[slot].push(t);
  }

  const binParts = [];
  const bufferViews = [];
  const accessors = [];
  let byteOffset = 0;

  const addBufferView = (buf, target = null) => {
    const padded = align4(buf.length);
    const storage = Buffer.alloc(padded);
    Buffer.from(buf).copy(storage);
    const view = { buffer: 0, byteOffset, byteLength: buf.length };
    if (target != null) view.target = target;
    bufferViews.push(view);
    binParts.push(storage);
    byteOffset += padded;
    return bufferViews.length - 1;
  };

  const addAccessor = (componentType, type, count, bufferView, byteOffset, min, max) => {
    const acc = { bufferView, componentType, count, type };
    if (byteOffset != null) acc.byteOffset = byteOffset;
    if (min) acc.min = min;
    if (max) acc.max = max;
    accessors.push(acc);
    return accessors.length - 1;
  };

  const posView = addBufferView(new Uint8Array(positions.buffer), 34962);
  const posAcc = addAccessor(5126, 'VEC3', vertexCount, posView, 0,
    [mesh.aabb.min[0], mesh.aabb.min[1], mesh.aabb.min[2]],
    [mesh.aabb.max[0], mesh.aabb.max[1], mesh.aabb.max[2]]);

  const normView = addBufferView(new Uint8Array(normals.buffer), 34962);
  const normAcc = addAccessor(5126, 'VEC3', vertexCount, normView, 0);

  const uvView = addBufferView(new Uint8Array(uvs.buffer), 34962);
  const uvAcc = addAccessor(5126, 'VEC2', vertexCount, uvView, 0);

  const images = [];
  const gltfTextures = [];
  const gltfMaterials = [];
  /** glTF texture index per material slot (same order as materials[]) */
  const textureIndexByMaterialSlot = [];

  for (let m = 0; m < matCount; m += 1) {
    const prMat = materials[m];
    const texIdx = prMat.textureIndex;
    const srcTex = texIdx !== 255 && textures[texIdx] ? textures[texIdx] : null;
    let gltfTexIndex = null;

    if (srcTex?.bytes?.length) {
      const mime = srcTex.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const view = addBufferView(srcTex.bytes);
      const imageIndex = images.length;
      images.push({ bufferView: view, mimeType: mime });
      gltfTexIndex = gltfTextures.length;
      gltfTextures.push({ source: imageIndex, sampler: 0 });
    }

    textureIndexByMaterialSlot[m] = gltfTexIndex;

    // Alpha policy: decode the texture's alpha channel and only treat it as a cutout
    // when a meaningful fraction of texels are actually transparent (see texture-alpha).
    // DS rips routinely ship RGBA PNGs that are fully opaque — those stay OPAQUE so we
    // never punch holes in roofs/walls. Genuine cutout art (banners, signs, glass) gets
    // a MASK with a crisp 0.5 cutoff, which matches DS 1-bit alpha and avoids the black
    // squares produced by tools that flatten transparency to OPAQUE.
    const cutout = srcTex ? textureHasAlpha(srcTex) : false;
    const mat = {
      name: prMat.name || `mat_${m}`,
      pbrMetallicRoughness: {
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      doubleSided: true,
      alphaMode: cutout ? 'MASK' : 'OPAQUE',
    };
    if (cutout) mat.alphaCutoff = 0.5;
    if (gltfTexIndex != null) {
      mat.pbrMetallicRoughness.baseColorTexture = { index: gltfTexIndex };
    }
    gltfMaterials.push(mat);
  }

  const primitives = [];
  for (let m = 0; m < matCount; m += 1) {
    const tris = triPerMat[m];
    if (!tris.length) continue;
    const idxList = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i += 1) {
      const t = tris[i];
      idxList[i * 3] = indices[t * 3];
      idxList[i * 3 + 1] = indices[t * 3 + 1];
      idxList[i * 3 + 2] = indices[t * 3 + 2];
    }
    const idxView = addBufferView(new Uint8Array(idxList.buffer), 34963);
    const idxAcc = addAccessor(5125, 'SCALAR', idxList.length, idxView, 0);
    primitives.push({
      attributes: {
        POSITION: posAcc,
        NORMAL: normAcc,
        TEXCOORD_0: uvAcc,
      },
      indices: idxAcc,
      material: m,
    });
  }

  if (!primitives.length) {
    throw new Error('No geometry to export to GLB.');
  }

  const binBuffer = Buffer.concat(binParts);
  const json = {
    asset: { version: '2.0', generator: 'pokemon-resort-admin' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: id || 'mesh' }],
    meshes: [{ name: id || 'mesh', primitives }],
    materials: gltfMaterials,
    textures: gltfTextures,
    images,
    samplers: [{
      magFilter: FILTER_NEAREST,
      minFilter: FILTER_NEAREST,
      wrapS: WRAP_REPEAT,
      wrapT: WRAP_REPEAT,
    }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBuffer.length }],
  };

  return packGlb(json, binBuffer);
}
