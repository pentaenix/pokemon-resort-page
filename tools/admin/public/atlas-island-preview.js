import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEFAULT_DISPLAY_SIZE = 6.2;

function fitIslandModel(model, targetSize = DEFAULT_DISPLAY_SIZE) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 0.001);
  const scale = targetSize / maxDim;
  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));
}

function frameCameraToGroup(camera, target, group, aspect, padding = 1.18) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const fovRad = camera.fov * (Math.PI / 180);
  const fitHeightDistance = (maxDim / 2) / Math.tan(fovRad / 2);
  const fitWidthDistance = fitHeightDistance / Math.max(aspect, 0.001);
  const distance = Math.max(fitHeightDistance, fitWidthDistance) * padding;

  target.copy(center);
  target.y += maxDim * 0.04;

  camera.position.set(
    center.x + distance * 0.1,
    center.y + distance * 0.36,
    center.z + distance * 0.9,
  );
  camera.lookAt(target);
}

function disposeObject3D(root) {
  root.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose();
    }
  });
}

/**
 * Live preview that mirrors the public Atlas IslandStage3D viewport.
 * @param {HTMLElement} mount
 * @param {{ url?: string|null, displaySize?: number, onHint?: (text: string) => void }} options
 */
export function bindAtlasIslandPreview(mount, options = {}) {
  if (!mount) return null;

  let currentDisplaySize = Number(options.displaySize) > 0 ? Number(options.displaySize) : DEFAULT_DISPLAY_SIZE;
  const onHint = typeof options.onHint === 'function' ? options.onHint : () => {};
  const url = options.url || null;

  let disposed = false;
  mount.replaceChildren();

  const scene = new THREE.Scene();
  const aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
  const camera = new THREE.PerspectiveCamera(38, aspect, 0.08, 120);
  const cameraTarget = new THREE.Vector3();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  mount.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xf8ffff, 0x7ec8d8, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.45);
  key.position.set(4.5, 7.5, 5.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd8f4ff, 0.55);
  fill.position.set(-5, 2.5, -3);
  scene.add(fill);

  const rootGroup = new THREE.Group();
  scene.add(rootGroup);
  const modelHolder = new THREE.Group();
  rootGroup.add(modelHolder);
  const placeholderGroup = new THREE.Group();
  rootGroup.add(placeholderGroup);

  const beach = new THREE.Mesh(
    new THREE.CylinderGeometry(3.05, 3.28, 0.12, 96),
    new THREE.MeshStandardMaterial({ color: 0xf4d9a4, roughness: 0.92 }),
  );
  beach.scale.set(1.22, 1, 0.87);
  beach.position.y = 0.05;
  placeholderGroup.add(beach);

  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(2.75, 3.15, 0.34, 96),
    new THREE.MeshStandardMaterial({ color: 0xb8e39b, roughness: 0.74 }),
  );
  island.scale.set(1.18, 1, 0.82);
  island.position.y = 0.19;
  placeholderGroup.add(island);

  let gltfRoot = null;
  let loadedModel = null;

  const PITCH_MIN = -0.2;
  const PITCH_MAX = 0.22;
  let yaw = -0.25;
  let pitch = 0.06;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  rootGroup.rotation.order = 'YXZ';

  function applyRotation() {
    rootGroup.rotation.y = yaw;
    rootGroup.rotation.x = pitch;
  }
  applyRotation();

  function frameCamera() {
    frameCameraToGroup(camera, cameraTarget, rootGroup, mount.clientWidth / Math.max(1, mount.clientHeight));
  }
  frameCamera();

  function remountModel() {
    if (!gltfRoot || disposed) return;
    if (loadedModel) {
      modelHolder.remove(loadedModel);
      disposeObject3D(loadedModel);
      loadedModel = null;
    }
    loadedModel = gltfRoot.clone(true);
    fitIslandModel(loadedModel, currentDisplaySize);
    modelHolder.add(loadedModel);
    placeholderGroup.visible = false;
    frameCamera();
    onHint('Drag to rotate · nudge up/down for a slight tilt');
  }

  function handlePointerDown(event) {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }
  function handlePointerMove(event) {
    if (!dragging) return;
    yaw += (event.clientX - lastX) * 0.006;
    pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch + (event.clientY - lastY) * 0.004));
    lastX = event.clientX;
    lastY = event.clientY;
    applyRotation();
  }
  function handlePointerUp(event) {
    dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  renderer.domElement.addEventListener('pointerdown', handlePointerDown);
  renderer.domElement.addEventListener('pointermove', handlePointerMove);
  renderer.domElement.addEventListener('pointerup', handlePointerUp);
  renderer.domElement.addEventListener('pointercancel', handlePointerUp);

  function resize() {
    if (disposed) return;
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    frameCamera();
  }

  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(resize)
    : null;
  if (resizeObserver) resizeObserver.observe(mount);
  else window.addEventListener('resize', resize);

  let raf = 0;
  function animate() {
    raf = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  if (url) {
    onHint('Loading island mesh…');
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        if (disposed) return;
        gltfRoot = gltf.scene;
        remountModel();
      },
      undefined,
      () => {
        if (!disposed) {
          onHint('Could not load island model — showing placeholder');
        }
      },
    );
  } else {
    onHint('Island model in progress');
  }

  return {
    setDisplaySize(size) {
      const n = Number(size);
      if (!Number.isFinite(n) || n <= 0) return;
      currentDisplaySize = n;
      if (gltfRoot) remountModel();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointercancel', handlePointerUp);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', resize);
      if (loadedModel) disposeObject3D(loadedModel);
      placeholderGroup.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          child.material?.dispose();
        }
      });
      renderer.dispose();
      mount.replaceChildren();
    },
  };
}
