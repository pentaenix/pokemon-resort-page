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

const _rayOrigin = new THREE.Vector3();
const _rayEnd = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();
const _localNormal = new THREE.Vector3();

/** @param {number} value */
export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** @param {number} displaySize */
export function islandDotScale(displaySize = 10) {
  return Math.max(Number(displaySize) || 10, 6.2) / 10;
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
 * Raycast through the mesh column at local XZ; returns local-space ground point + normal.
 * @param {import('three').Object3D} meshRoot
 * @param {number} x
 * @param {number} z
 * @param {import('three').Raycaster} [raycaster]
 * @param {import('three').Object3D} [localSpace]
 */
export function raycastTerrainPoint(meshRoot, x, z, raycaster = new THREE.Raycaster(), localSpace = meshRoot) {
  if (!meshRoot || !localSpace) return null;
  const meshes = collectVisibleMeshes(meshRoot);
  if (!meshes.length) return null;

  _rayOrigin.set(x, 500, z);
  _rayEnd.set(x, -500, z);
  localSpace.localToWorld(_rayOrigin);
  localSpace.localToWorld(_rayEnd);
  _rayDir.copy(_rayEnd).sub(_rayOrigin).normalize();
  raycaster.set(_rayOrigin, _rayDir);

  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;

  let best = null;
  for (const hit of hits) {
    _worldNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (_worldNormal.y < 0.2) continue;
    if (!best || hit.point.y > best.point.y) best = hit;
  }
  const chosen = best || hits[0];
  _worldNormal.copy(chosen.face.normal).transformDirection(chosen.object.matrixWorld).normalize();

  const localPoint = localSpace.worldToLocal(chosen.point.clone());
  const invWorld = new THREE.Matrix4().copy(localSpace.matrixWorld).invert();
  _localNormal.copy(_worldNormal).transformDirection(invWorld).normalize();

  return {
    point: localPoint,
    normal: _localNormal.lengthSq() > 0.01 ? _localNormal : new THREE.Vector3(0, 1, 0),
  };
}

/**
 * @param {{ x?: number, y?: number, map3d?: { yOffset?: number, enabled?: boolean } }} pin
 * @param {unknown} alignment
 * @param {number} displaySize
 * @param {import('three').Object3D|null} meshRoot
 * @param {import('three').Object3D|null} [localSpace]
 */
export function resolvePinModelPosition(pin, alignment, displaySize, meshRoot, localSpace = meshRoot) {
  if (pin?.map3d?.enabled === false) return null;
  const xz = uvToModelXZ(pin.x, pin.y, alignment, displaySize);
  const surface = meshRoot ? raycastTerrainPoint(meshRoot, xz.x, xz.z, undefined, localSpace) : null;
  const scale = islandDotScale(displaySize);
  const yOffset = Number(pin?.map3d?.yOffset);
  const lift = Number.isFinite(yOffset) ? yOffset : 0.012 * scale;
  if (surface) {
    return {
      x: surface.point.x,
      y: surface.point.y + lift,
      z: surface.point.z,
      normal: surface.normal,
      hit: true,
    };
  }
  return {
    x: xz.x,
    y: lift,
    z: xz.z,
    normal: new THREE.Vector3(0, 1, 0),
    hit: false,
  };
}

function disposeDotObject(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      child.material?.dispose();
    }
  });
}

/**
 * Flat map marker hugging the terrain surface (not a floating sphere).
 * @param {string} color
 * @param {boolean} [selected]
 * @param {number} [displaySize]
 * @param {import('three').Vector3|null} [normal]
 */
export function createPinDotMesh(color, selected = false, displaySize = 10, normal = null) {
  const tint = ISLAND_DOT_COLORS[color] || 0xffffff;
  const scale = islandDotScale(displaySize);
  const outer = (selected ? 0.055 : 0.04) * scale;
  const inner = outer * 0.52;

  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      new THREE.RingGeometry(inner * 0.92, outer, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    ),
    new THREE.Mesh(
      new THREE.CircleGeometry(inner * 0.92, 20),
      new THREE.MeshBasicMaterial({
        color: tint,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    ),
  );

  const up = normal && normal.lengthSq() > 0.01
    ? normal.clone().normalize()
    : new THREE.Vector3(0, 1, 0);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
  group.userData.isPinDot = true;
  group.userData.pinColor = color;
  return group;
}

/**
 * @param {import('three').Group} dotsGroup
 * @param {Array<{ id: string, name?: string, color?: string, x: number, y: number, map3d?: object }>} pins
 * @param {{ alignment?: unknown, displaySize?: number, meshRoot?: import('three').Object3D|null, localSpace?: import('three').Object3D|null, selectedPinId?: string|null, onDotMeshes?: (map: Map<string, import('three').Object3D>) => void }} options
 */
export function syncIslandPinDots(dotsGroup, pins, options = {}) {
  const alignment = options.alignment;
  const displaySize = Number(options.displaySize) > 0 ? Number(options.displaySize) : 10;
  const meshRoot = options.meshRoot || null;
  const localSpace = options.localSpace || meshRoot;
  const selectedPinId = options.selectedPinId || null;

  while (dotsGroup.children.length) {
    const child = dotsGroup.children[0];
    dotsGroup.remove(child);
    disposeDotObject(child);
  }

  /** @type {Map<string, import('three').Object3D>} */
  const meshMap = new Map();
  for (const pin of pins || []) {
    const pos = resolvePinModelPosition(pin, alignment, displaySize, meshRoot, localSpace);
    if (!pos) continue;
    const dot = createPinDotMesh(
      pin.color || 'yellow',
      pin.id === selectedPinId,
      displaySize,
      pos.normal,
    );
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
 * Screen-space hit test for small flat dots (more reliable than mesh raycast).
 * @param {import('three').Group} dotsGroup
 * @param {PointerEvent} event
 * @param {import('three').Camera} camera
 * @param {HTMLElement} mountEl
 * @param {number} [thresholdPx]
 */
export function pickIslandPinDotScreen(dotsGroup, event, camera, mountEl, thresholdPx = 16) {
  if (!mountEl || !dotsGroup?.children?.length) return null;
  const rect = mountEl.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  let bestId = null;
  let bestDist = thresholdPx;
  const projected = new THREE.Vector3();

  dotsGroup.children.forEach((dot) => {
    if (!dot.userData?.isPinDot || !dot.userData.pinId) return;
    dot.getWorldPosition(projected);
    projected.project(camera);
    if (projected.z > 1) return;
    const sx = (projected.x * 0.5 + 0.5) * rect.width;
    const sy = (-projected.y * 0.5 + 0.5) * rect.height;
    const dist = Math.hypot(px - sx, py - sy);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = dot.userData.pinId;
    }
  });
  return bestId;
}

/**
 * @param {import('three').Raycaster} raycaster
 * @param {import('three').Vector2} pointer
 * @param {import('three').Camera} camera
 * @param {import('three').Group} dotsGroup
 */
export function pickIslandPinDot(raycaster, pointer, camera, dotsGroup) {
  raycaster.setFromCamera(pointer, camera);
  /** @type {import('three').Mesh[]} */
  const meshes = [];
  dotsGroup.children.forEach((child) => {
    if (!child.userData?.isPinDot) return;
    child.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });
  });
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  let node = hits[0].object;
  while (node && !node.userData?.pinId) node = node.parent;
  return node?.userData?.pinId || null;
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
