import * as THREE from 'three';

export const FRAMING_REFERENCE = 6.2;

/** @type {Record<string, number>} */
export const DEFAULT_ISLAND_VIEWPORT = {
  offsetX: 0,
  offsetY: 0.35,
  offsetZ: 0,
  pitch: 0.06,
  yaw: -0.25,
  targetLift: 0.12,
  padding: 0.94,
  cameraHeight: 0.36,
  cameraDistance: 0.9,
  cameraSide: 0.1,
  hemiIntensity: 1.35,
  keyIntensity: 1.45,
  fillIntensity: 0.55,
  exposure: 1.05,
  keyX: 4.5,
  keyY: 7.5,
  keyZ: 5.5,
  fillX: -5,
  fillY: 2.5,
  fillZ: -3,
};

const VIEWPORT_KEYS = Object.keys(DEFAULT_ISLAND_VIEWPORT);

/** @param {unknown} raw */
export function normalizeIslandViewport(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_ISLAND_VIEWPORT };
  for (const key of VIEWPORT_KEYS) {
    const value = Number(src[key]);
    if (Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** @param {string|null|undefined} file @param {number} displaySize @param {unknown} viewport */
export function islandViewportCacheKey(file, displaySize, viewport) {
  const v = normalizeIslandViewport(viewport);
  const parts = VIEWPORT_KEYS.map((key) => v[key].toFixed(3));
  return `${file || ''}|${displaySize}|${parts.join(',')}`;
}

/** @param {import('three').Object3D} model @param {number} [targetSize] */
export function fitIslandModel(model, targetSize = FRAMING_REFERENCE) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 0.001);
  const scale = targetSize / maxDim;
  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));
}

/**
 * @param {import('three').Object3D} stageRoot
 * @param {unknown} viewport
 */
export function applyIslandStageOffset(stageRoot, viewport) {
  const v = normalizeIslandViewport(viewport);
  stageRoot.position.set(v.offsetX, v.offsetY, v.offsetZ);
}

/** @deprecated use applyIslandStageOffset */
export function applyModelViewportOffset(holder, viewport) {
  applyIslandStageOffset(holder, viewport);
}

/**
 * @param {import('three').PerspectiveCamera} camera
 * @param {import('three').Vector3} target
 * @param {import('three').Object3D} group
 * @param {number} aspect
 * @param {number} displaySize
 * @param {unknown} [viewport]
 * @param {import('three').Object3D} [framingSubject]
 */
export function frameCameraToGroup(
  camera,
  target,
  group,
  aspect,
  displaySize = FRAMING_REFERENCE,
  viewport,
  framingSubject,
) {
  const v = normalizeIslandViewport(viewport);
  const subject = framingSubject || group;
  const box = new THREE.Box3().setFromObject(subject);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const fovRad = camera.fov * (Math.PI / 180);
  const fitHeightDistance = (maxDim / 2) / Math.tan(fovRad / 2);
  const fitWidthDistance = fitHeightDistance / Math.max(aspect, 0.001);
  const distance = Math.max(fitHeightDistance, fitWidthDistance)
    * v.padding
    * (FRAMING_REFERENCE / Math.max(displaySize, 0.5));

  target.copy(center);
  target.y += maxDim * v.targetLift;

  camera.position.set(
    center.x + distance * v.cameraSide,
    center.y + distance * v.cameraHeight,
    center.z + distance * v.cameraDistance,
  );
  camera.lookAt(target);
}

/** @param {import('three').Scene} scene */
export function createIslandLights(scene) {
  const hemi = new THREE.HemisphereLight(0xf8ffff, 0x7ec8d8, DEFAULT_ISLAND_VIEWPORT.hemiIntensity);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, DEFAULT_ISLAND_VIEWPORT.keyIntensity);
  key.position.set(
    DEFAULT_ISLAND_VIEWPORT.keyX,
    DEFAULT_ISLAND_VIEWPORT.keyY,
    DEFAULT_ISLAND_VIEWPORT.keyZ,
  );
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd8f4ff, DEFAULT_ISLAND_VIEWPORT.fillIntensity);
  fill.position.set(
    DEFAULT_ISLAND_VIEWPORT.fillX,
    DEFAULT_ISLAND_VIEWPORT.fillY,
    DEFAULT_ISLAND_VIEWPORT.fillZ,
  );
  scene.add(fill);
  return { hemi, key, fill };
}

/**
 * @param {{ hemi: import('three').HemisphereLight, key: import('three').DirectionalLight, fill: import('three').DirectionalLight }} lights
 * @param {import('three').WebGLRenderer} renderer
 * @param {unknown} viewport
 */
export function applyIslandLighting(lights, renderer, viewport) {
  const v = normalizeIslandViewport(viewport);
  lights.hemi.intensity = v.hemiIntensity;
  lights.key.intensity = v.keyIntensity;
  lights.key.position.set(v.keyX, v.keyY, v.keyZ);
  lights.fill.intensity = v.fillIntensity;
  lights.fill.position.set(v.fillX, v.fillY, v.fillZ);
  renderer.toneMappingExposure = v.exposure;
}

/**
 * @param {import('three').Object3D} rootGroup
 * @param {unknown} viewport
 * @param {number|null} [yawOverride]
 */
export function applyIslandBaseRotation(rootGroup, viewport, yawOverride = null) {
  const v = normalizeIslandViewport(viewport);
  rootGroup.rotation.order = 'YXZ';
  rootGroup.rotation.y = yawOverride !== null ? yawOverride : v.yaw;
  rootGroup.rotation.x = v.pitch;
}

export function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}
