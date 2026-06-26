import * as THREE from 'three';

/** @type {Record<string, number>} */
export const DEFAULT_MAP_ALIGNMENT = {
  planeSize: 0,
  scaleX: 1,
  scaleZ: 1,
  offsetX: 0,
  offsetZ: 0,
  rotationY: 0,
  flipU: 0,
  flipV: 1,
  overlayOpacity: 0.55,
};

const ALIGNMENT_KEYS = Object.keys(DEFAULT_MAP_ALIGNMENT);

/** @type {Record<string, number>} */
export const ISLAND_DOT_COLORS = {
  blue: 0x2f7fd4,
  yellow: 0xe8b830,
  red: 0xd24a4a,
};

/** @param {number} value */
export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** @param {unknown} raw */
export function normalizeMapAlignment(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_MAP_ALIGNMENT };
  for (const key of ALIGNMENT_KEYS) {
    if (key === 'flipU' || key === 'flipV') {
      out[key] = src[key] ? 1 : 0;
      continue;
    }
    const value = Number(src[key]);
    if (Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** @param {unknown} alignment @param {number} displaySize */
export function alignmentPlaneSize(alignment, displaySize) {
  const a = normalizeMapAlignment(alignment);
  return a.planeSize > 0 ? a.planeSize : Math.max(displaySize, 0.5);
}

/**
 * Map cork-board UV (0–1) to fitted-model XZ (Y up).
 * @param {number} u
 * @param {number} v
 * @param {unknown} alignment
 * @param {number} displaySize
 */
export function uvToModelXZ(u, v, alignment, displaySize) {
  const a = normalizeMapAlignment(alignment);
  const plane = alignmentPlaneSize(a, displaySize);
  let nu = clamp01(u);
  let nv = clamp01(v);
  if (a.flipU) nu = 1 - nu;
  if (a.flipV) nv = 1 - nv;
  let x = (nu - 0.5) * plane * a.scaleX;
  let z = (nv - 0.5) * plane * a.scaleZ;
  const cos = Math.cos(a.rotationY);
  const sin = Math.sin(a.rotationY);
  return {
    x: x * cos - z * sin + a.offsetX,
    z: x * sin + z * cos + a.offsetZ,
  };
}

/**
 * Inverse of uvToModelXZ on the horizontal plane.
 * @param {number} x
 * @param {number} z
 * @param {unknown} alignment
 * @param {number} displaySize
 */
export function modelXZToUv(x, z, alignment, displaySize) {
  const a = normalizeMapAlignment(alignment);
  const plane = alignmentPlaneSize(a, displaySize);
  let lx = x - a.offsetX;
  let lz = z - a.offsetZ;
  const cos = Math.cos(-a.rotationY);
  const sin = Math.sin(-a.rotationY);
  const ux = lx * cos - lz * sin;
  const uz = lx * sin + lz * cos;
  let u = ux / (plane * a.scaleX) + 0.5;
  let v = uz / (plane * a.scaleZ) + 0.5;
  if (a.flipU) u = 1 - u;
  if (a.flipV) v = 1 - v;
  return { u: clamp01(u), v: clamp01(v) };
}

/** @param {import('three').Object3D} root */
export function collectVisibleMeshes(root) {
  /** @type {import('three').Mesh[]} */
  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh && child.visible) meshes.push(child);
  });
  return meshes;
}

/**
 * Raycast straight down in model-local space.
 * @param {import('three').Object3D} meshRoot
 * @param {number} x
 * @param {number} z
 * @param {import('three').Raycaster} [raycaster]
 */
export function raycastTerrainPoint(meshRoot, x, z, raycaster = new THREE.Raycaster()) {
  if (!meshRoot) return null;
  const meshes = collectVisibleMeshes(meshRoot);
  if (!meshes.length) return null;
  const origin = new THREE.Vector3(x, 500, z);
  raycaster.set(origin, new THREE.Vector3(0, -1, 0));
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  return hits[0].point.clone();
}

/**
 * @param {{ x?: number, y?: number, map3d?: { yOffset?: number, enabled?: boolean } }} pin
 * @param {unknown} alignment
 * @param {number} displaySize
 * @param {import('three').Object3D|null} meshRoot
 */
export function resolvePinModelPosition(pin, alignment, displaySize, meshRoot) {
  if (pin?.map3d?.enabled === false) return null;
  const xz = uvToModelXZ(pin.x, pin.y, alignment, displaySize);
  const hit = meshRoot ? raycastTerrainPoint(meshRoot, xz.x, xz.z) : null;
  const yOffset = Number(pin?.map3d?.yOffset);
  const offset = Number.isFinite(yOffset) ? yOffset : 0.08;
  if (hit) {
    return { x: hit.x, y: hit.y + offset, z: hit.z, hit: true };
  }
  return { x: xz.x, y: offset, z: xz.z, hit: false };
}

/** @param {string} color @param {boolean} [selected] */
export function createPinDotMesh(color, selected = false) {
  const tint = ISLAND_DOT_COLORS[color] || 0xffffff;
  const radius = selected ? 0.2 : 0.14;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 18, 14),
    new THREE.MeshStandardMaterial({
      color: tint,
      emissive: tint,
      emissiveIntensity: selected ? 0.9 : 0.5,
      roughness: 0.35,
      metalness: 0.05,
    }),
  );
  mesh.userData.isPinDot = true;
  mesh.userData.pinColor = color;
  return mesh;
}

/**
 * @param {import('three').Group} dotsGroup
 * @param {Array<{ id: string, name?: string, color?: string, x: number, y: number, map3d?: object }>} pins
 * @param {{ alignment?: unknown, displaySize?: number, meshRoot?: import('three').Object3D|null, selectedPinId?: string|null, onDotMeshes?: (map: Map<string, import('three').Mesh>) => void }} options
 */
export function syncIslandPinDots(dotsGroup, pins, options = {}) {
  const alignment = options.alignment;
  const displaySize = Number(options.displaySize) > 0 ? Number(options.displaySize) : 10;
  const meshRoot = options.meshRoot || null;
  const selectedPinId = options.selectedPinId || null;

  while (dotsGroup.children.length) {
    const child = dotsGroup.children[0];
    dotsGroup.remove(child);
    child.geometry?.dispose();
    child.material?.dispose();
  }

  /** @type {Map<string, import('three').Mesh>} */
  const meshMap = new Map();
  for (const pin of pins || []) {
    const pos = resolvePinModelPosition(pin, alignment, displaySize, meshRoot);
    if (!pos) continue;
    const dot = createPinDotMesh(pin.color || 'yellow', pin.id === selectedPinId);
    dot.position.set(pos.x, pos.y, pos.z);
    dot.userData.pinId = pin.id;
    dot.userData.pinName = pin.name || pin.id;
    dot.userData.offMesh = !pos.hit;
    dotsGroup.add(dot);
    meshMap.set(pin.id, dot);
  }
  options.onDotMeshes?.(meshMap);
  return meshMap;
}

/**
 * @param {import('three').Raycaster} raycaster
 * @param {import('three').Vector2} pointer
 * @param {import('three').Camera} camera
 * @param {import('three').Group} dotsGroup
 */
export function pickIslandPinDot(raycaster, pointer, camera, dotsGroup) {
  raycaster.setFromCamera(pointer, camera);
  const dots = dotsGroup.children.filter((child) => child.userData?.isPinDot);
  const hits = raycaster.intersectObjects(dots, false);
  return hits[0]?.object?.userData?.pinId || null;
}

/**
 * @param {import('three').Raycaster} raycaster
 * @param {import('three').Vector2} pointer
 * @param {import('three').Camera} camera
 * @param {import('three').Object3D} meshRoot
 */
export function pickTerrainPoint(raycaster, pointer, camera, meshRoot) {
  raycaster.setFromCamera(pointer, camera);
  const meshes = collectVisibleMeshes(meshRoot);
  const hits = raycaster.intersectObjects(meshes, false);
  return hits[0]?.point?.clone() || null;
}

export function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}
