import { parseGlb, buildMeshFromGltf } from './glb-compile.mjs';
import { writeGlbFromMesh } from './write-glb.mjs';

const DEG = Math.PI / 180;
const TILE_SIZE = 16;

function mul3(a, b) {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      let s = 0;
      for (let k = 0; k < 3; k += 1) s += a[r * 3 + k] * b[k * 3 + c];
      o[r * 3 + c] = s;
    }
  }
  return o;
}

function apply3(m, x, y, z) {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

// Row-major 3x3 for the intrinsic X→Y→Z order (R = Rz · Ry · Rx). Pure rotation, so the
// same matrix transforms positions and normals (no non-uniform scale to worry about).
function rotationMatrix(rxDeg, ryDeg, rzDeg) {
  const rx = rxDeg * DEG;
  const ry = ryDeg * DEG;
  const rz = rzDeg * DEG;
  const cx = Math.cos(rx); const sx = Math.sin(rx);
  const cy = Math.cos(ry); const sy = Math.sin(ry);
  const cz = Math.cos(rz); const sz = Math.sin(rz);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(Rz, mul3(Ry, Rx));
}

function isIdentityRotation(rx, ry, rz) {
  const norm = (v) => ((v % 360) + 360) % 360;
  return norm(rx) === 0 && norm(ry) === 0 && norm(rz) === 0;
}

/**
 * Bake a fixed X/Y/Z rotation into a GLB's geometry so every consumer (web preview, map
 * placement, the C++ game) sees the corrected orientation without per-instance transforms.
 *
 * Positions and normals are rotated about the local origin, then the result is re-centered on
 * X/Z and re-seated so its lowest point sits on the y=0 ground plane — this keeps the placement
 * anchor at the footprint center and stops re-oriented props from floating or sinking.
 *
 * @param {Buffer|Uint8Array} buffer source GLB bytes
 * @param {{ rotX?: number, rotY?: number, rotZ?: number }} rotation degrees
 * @param {string} [modelId]
 * @returns {Buffer} re-oriented GLB bytes (self-contained)
 */
export function reorientGlbBuffer(buffer, rotation = {}, modelId = 'model') {
  const rotX = Number(rotation.rotX) || 0;
  const rotY = Number(rotation.rotY) || 0;
  const rotZ = Number(rotation.rotZ) || 0;

  const { json, bin } = parseGlb(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  const mesh = buildMeshFromGltf(modelId, json, bin);

  if (isIdentityRotation(rotX, rotY, rotZ)) {
    return writeGlbFromMesh(mesh);
  }

  const R = rotationMatrix(rotX, rotY, rotZ);
  const v = mesh.vertices; // [px,py,pz, nx,ny,nz, u,v] × N
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let i = 0; i < v.length; i += 8) {
    const [px, py, pz] = apply3(R, v[i], v[i + 1], v[i + 2]);
    const [nx, ny, nz] = apply3(R, v[i + 3], v[i + 4], v[i + 5]);
    v[i] = px; v[i + 1] = py; v[i + 2] = pz;
    v[i + 3] = nx; v[i + 4] = ny; v[i + 5] = nz;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
  }

  // Re-center on X/Z (footprint center == placement anchor) and drop onto y=0.
  const offX = -(minX + maxX) / 2;
  const offY = -minY;
  const offZ = -(minZ + maxZ) / 2;
  for (let i = 0; i < v.length; i += 8) {
    v[i] += offX; v[i + 1] += offY; v[i + 2] += offZ;
  }
  minX += offX; maxX += offX;
  minY += offY; maxY += offY;
  minZ += offZ; maxZ += offZ;

  mesh.aabb = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  mesh.footprint = {
    w: Math.max(1, Math.ceil((maxX - minX) / TILE_SIZE)),
    d: Math.max(1, Math.ceil((maxZ - minZ) / TILE_SIZE)),
    h: Math.max(1, Math.ceil((maxY - minY) / TILE_SIZE)),
  };

  return writeGlbFromMesh(mesh);
}
