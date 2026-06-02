import { basename } from 'node:path';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

export function parseGlb(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 20) throw new Error('GLB file too small.');
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('Not a GLB file (bad magic).');
  if (buf.readUInt32LE(4) !== 2) throw new Error('Only GLB version 2 is supported.');

  let offset = 12;
  let json = null;
  let bin = null;

  while (offset + 8 <= buf.length) {
    const chunkLength = buf.readUInt32LE(offset);
    offset += 4;
    const chunkType = buf.readUInt32LE(offset);
    offset += 4;
    const chunk = buf.subarray(offset, offset + chunkLength);
    offset += chunkLength;
    if (chunkType === CHUNK_JSON) {
      json = JSON.parse(chunk.toString('utf8').replace(/\0/g, '').trim());
    }
    if (chunkType === CHUNK_BIN) bin = chunk;
  }

  if (!json) throw new Error('GLB missing JSON chunk.');
  return { json, bin: bin || Buffer.alloc(0) };
}

function readAccessor(gltf, bin, accessorIndex) {
  const acc = gltf.accessors[accessorIndex];
  const bv = gltf.bufferViews[acc.bufferView];
  const compBytes = COMPONENT_BYTES[acc.componentType];
  if (!compBytes) throw new Error(`Unsupported accessor component type ${acc.componentType}`);
  const numComp = TYPE_COMPONENTS[acc.type];
  if (!numComp) throw new Error(`Unsupported accessor type ${acc.type}`);

  const stride = bv.byteStride || compBytes * numComp;
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = [];
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

  for (let i = 0; i < acc.count; i += 1) {
    const base = byteOffset + i * stride;
    const tuple = [];
    for (let c = 0; c < numComp; c += 1) {
      const o = base + c * compBytes;
      if (acc.componentType === 5126) tuple.push(view.getFloat32(o, true));
      else if (acc.componentType === 5123) tuple.push(view.getUint16(o, true));
      else if (acc.componentType === 5125) tuple.push(view.getUint32(o, true));
      else if (acc.componentType === 5121) tuple.push(view.getUint8(o));
      else tuple.push(view.getInt16(o, true));
    }
    out.push(tuple);
  }
  return out;
}

function imageBytes(gltf, bin, imageIndex) {
  const img = gltf.images?.[imageIndex];
  if (!img) return null;
  if (img.bufferView !== undefined) {
    const bv = gltf.bufferViews[img.bufferView];
    const start = bv.byteOffset || 0;
    const end = start + (bv.byteLength || 0);
    return bin.subarray(start, end);
  }
  return null;
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

function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0]
        + a[1 * 4 + r] * b[c * 4 + 1]
        + a[2 * 4 + r] * b[c * 4 + 2]
        + a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function mat4FromNode(node) {
  if (node.matrix) return new Float32Array(node.matrix);
  const out = mat4Identity();
  const t = node.translation || [0, 0, 0];
  const s = node.scale || [1, 1, 1];
  const q = node.rotation || [0, 0, 0, 1];
  const [qx, qy, qz, qw] = q;
  const x2 = qx + qx; const y2 = qy + qy; const z2 = qz + qz;
  const xx = qx * x2; const xy = qx * y2; const xz = qx * z2;
  const yy = qy * y2; const yz = qy * z2; const zz = qz * z2;
  const wx = qw * x2; const wy = qw * y2; const wz = qw * z2;

  const r00 = 1 - (yy + zz);
  const r01 = xy - wz;
  const r02 = xz + wy;
  const r10 = xy + wz;
  const r11 = 1 - (xx + zz);
  const r12 = yz - wx;
  const r20 = xz - wy;
  const r21 = yz + wx;
  const r22 = 1 - (xx + yy);

  const m = mat4Identity();
  m[0] = r00 * s[0]; m[1] = r10 * s[0]; m[2] = r20 * s[0];
  m[4] = r01 * s[1]; m[5] = r11 * s[1]; m[6] = r21 * s[1];
  m[8] = r02 * s[2]; m[9] = r12 * s[2]; m[10] = r22 * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function transformNormal(m, x, y, z) {
  const nx = m[0] * x + m[4] * y + m[8] * z;
  const ny = m[1] * x + m[5] * y + m[9] * z;
  const nz = m[2] * x + m[6] * y + m[10] * z;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function buildMeshFromGltf(modelId, gltf, bin) {
  const vertices = [];
  const indices = [];
  const triangleMaterials = [];
  const materialOrder = [];
  const materialIndex = new Map();
  const textures = [];
  const texByImage = new Map();
  const vertMap = new Map();

  function ensureMaterial(name) {
    if (!materialIndex.has(name)) {
      materialIndex.set(name, materialOrder.length);
      materialOrder.push(name);
    }
    return materialIndex.get(name);
  }

  function textureForMaterial(matIndex) {
    const mat = gltf.materials?.[matIndex];
    if (!mat) return 255;
    const texInfo = mat.pbrMetallicRoughness?.baseColorTexture
      || mat.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture
      || mat.normalTexture;
    const tex = texInfo ? gltf.textures?.[texInfo.index] : null;
    const imgIdx = tex?.source ?? tex?.extensions?.MSFT_texture?.source;
    if (imgIdx === undefined) return 255;
    if (!texByImage.has(imgIdx)) {
      const bytes = imageBytes(gltf, bin, imgIdx);
      if (!bytes?.length) return 255;
      const format = detectTextureFormat(bytes);
      const dim = imageDimensions(bytes, format);
      texByImage.set(imgIdx, textures.length);
      textures.push({ format, width: dim.width, height: dim.height, bytes });
    }
    return texByImage.get(imgIdx);
  }

  function addPrimitive(primitive, worldMat, matName) {
    const posAcc = primitive.attributes?.POSITION;
    if (posAcc === undefined) return;
    const positions = readAccessor(gltf, bin, posAcc);
    const normals = primitive.attributes.NORMAL !== undefined
      ? readAccessor(gltf, bin, primitive.attributes.NORMAL)
      : null;
    const uvs = primitive.attributes.TEXCOORD_0 !== undefined
      ? readAccessor(gltf, bin, primitive.attributes.TEXCOORD_0)
      : null;
    const matSlot = ensureMaterial(matName);
    const texIdx = textureForMaterial(primitive.material ?? 0);

    let triList = [];
    if (primitive.indices !== undefined) {
      const idx = readAccessor(gltf, bin, primitive.indices);
      for (const tuple of idx) triList.push(tuple[0]);
    } else {
      triList = positions.map((_, i) => i);
    }

    const mode = primitive.mode ?? 4;
    if (mode !== 4) return;

    for (let t = 0; t + 2 < triList.length; t += 3) {
      const corners = [triList[t], triList[t + 1], triList[t + 2]];
      const triIndices = [];
      for (const pi of corners) {
        const p = positions[pi];
        const tp = transformPoint(worldMat, p[0], p[1], p[2]);
        const n = normals?.[pi] || [0, 1, 0];
        const tn = transformNormal(worldMat, n[0], n[1], n[2]);
        const uv = uvs?.[pi] || [0, 0];
        const u = uv[0];
        const v = uv[1] ?? 0;
        const ti = 0;
        const ni = 0;
        const key = `${tp[0].toFixed(4)},${tp[1].toFixed(4)},${tp[2].toFixed(4)}|${u},${v}|${matName}`;
        if (!vertMap.has(key)) {
          const base = vertices.length / 8;
          vertices.push(tp[0], tp[1], tp[2], tn[0], tn[1], tn[2], u, v);
          vertMap.set(key, base);
        }
        triIndices.push(vertMap.get(key));
      }
      indices.push(...triIndices);
      triangleMaterials.push(matSlot);
    }
  }

  function walkNode(nodeIndex, parentMat) {
    const node = gltf.nodes[nodeIndex];
    const world = mat4Multiply(parentMat, mat4FromNode(node));
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh];
      for (let p = 0; p < mesh.primitives.length; p += 1) {
        const prim = mesh.primitives[p];
        const matName = gltf.materials?.[prim.material ?? 0]?.name || `mat_${prim.material ?? 0}`;
        addPrimitive(prim, world, matName);
      }
    }
    for (const child of node.children || []) walkNode(child, world);
  }

  const sceneIndex = gltf.scene ?? 0;
  const scene = gltf.scenes?.[sceneIndex];
  const root = mat4Identity();
  if (scene?.nodes) {
    for (const nodeIndex of scene.nodes) walkNode(nodeIndex, root);
  } else if (gltf.nodes?.length) {
    for (let i = 0; i < gltf.nodes.length; i += 1) walkNode(i, root);
  }

  if (!indices.length) throw new Error('GLB has no triangle geometry.');

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

  const TILE_SIZE = 16;
  const prMaterials = materialOrder.map((name) => {
    const idx = gltf.materials?.findIndex((m) => (m.name || '') === name) ?? 0;
    const texIdx = textureForMaterial(idx >= 0 ? idx : 0);
    return { name, textureIndex: texIdx === 255 ? 0 : texIdx };
  });

  if (!textures.length) {
    throw new Error('GLB has no embeddable base-color textures.');
  }

  return {
    id: modelId,
    aabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    footprint: {
      w: Math.max(1, Math.ceil((maxX - minX) / TILE_SIZE)),
      d: Math.max(1, Math.ceil((maxZ - minZ) / TILE_SIZE)),
      h: Math.max(1, Math.ceil((maxY - minY) / TILE_SIZE)),
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

