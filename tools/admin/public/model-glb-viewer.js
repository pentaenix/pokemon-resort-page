import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { tuneGltfMaterials } from './model-texture-alpha.js';

const glbSceneCache = new Map();
let activeGlbViewport = null;

function glbCacheKey(url) {
  return url.split('&_=')[0];
}

/**
 * Neutral image-based lighting so PBR materials read correctly (matches online glTF
 * viewers). Without an environment or lights, GLTFLoader's MeshStandardMaterial renders
 * pure black — which was the cause of the black preview.
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @returns {() => void} disposer
 */
function applyStudioLighting(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envTarget = pmrem.fromScene(envScene, 0.04);
  scene.environment = envTarget.texture;

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(0.7, 1.4, 0.9);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45);
  fill.position.set(-0.8, 0.4, -0.6);
  scene.add(ambient, key, fill);

  return () => {
    scene.environment = null;
    envTarget.dispose();
    pmrem.dispose();
    envScene.dispose?.();
    scene.remove(ambient, key, fill);
  };
}

function fitOrthographicCamera(camera, object, viewW, viewH, cam) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.01);
  const aspect = viewW / Math.max(viewH, 1);
  const zoom = cam.zoomFactor ?? 1;
  const halfH = (maxDim * 0.55) / zoom;
  const halfW = halfH * aspect;

  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.near = -maxDim * 8;
  camera.far = maxDim * 8;
  camera.updateProjectionMatrix();

  const yaw = (cam.yaw ?? 35) * Math.PI / 180;
  const pitch = (cam.pitch ?? 28) * Math.PI / 180;
  const dist = maxDim * 2.2;
  camera.position.set(
    center.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    center.y + Math.sin(pitch) * dist,
    center.z + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  camera.lookAt(center);
}

export function closeGlbViewport() {
  if (activeGlbViewport) {
    activeGlbViewport.dispose();
    activeGlbViewport = null;
  }
}

// One shared offscreen renderer for all thumbnails — browsers cap live WebGL contexts,
// so we must not spin up one per card.
let thumbRenderer = null;
function getThumbRenderer() {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
    thumbRenderer.toneMapping = THREE.NoToneMapping;
    thumbRenderer.setClearColor(0x000000, 0);
  }
  return thumbRenderer;
}

/**
 * Render a one-shot, front-facing thumbnail of a GLB to a transparent PNG data URL.
 * Reuses the same scene cache, lighting, and orthographic fit as the live viewport so
 * the card image matches the modal preview. Geometry is shared with the cache and is
 * intentionally not disposed here.
 * @param {string} glbUrl
 * @param {{ width?: number, height?: number, yaw?: number, pitch?: number, zoomFactor?: number }} [options]
 * @returns {Promise<string>} PNG data URL
 */
export async function renderGlbThumbnail(glbUrl, options = {}) {
  const width = Math.max(16, Math.round(options.width || 160));
  const height = Math.max(16, Math.round(options.height || 120));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const model = await loadGlbScene(glbUrl);
  const pivot = new THREE.Group();
  pivot.add(model);
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(pivot);

  const renderer = getThumbRenderer();
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  const disposeLighting = applyStudioLighting(scene, renderer);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
  fitOrthographicCamera(camera, pivot, width, height, {
    yaw: options.yaw ?? 0,
    pitch: options.pitch ?? 15,
    zoomFactor: options.zoomFactor ?? 1.0,
  });

  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');

  disposeLighting();
  scene.remove(pivot);
  return url;
}

/**
 * @param {string} glbUrl
 * @returns {Promise<THREE.Group>}
 */
export async function loadGlbScene(glbUrl) {
  const key = glbCacheKey(glbUrl);
  if (glbSceneCache.has(key)) {
    return glbSceneCache.get(key).clone(true);
  }
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(glbUrl);
  const root = gltf.scene;
  tuneGltfMaterials(root);
  glbSceneCache.set(key, root);
  return root.clone(true);
}

export function clearGlbSceneCache() {
  glbSceneCache.clear();
}

/**
 * @param {HTMLElement} host
 * @param {string} glbUrl
 */
export async function bindGlbWebGLViewport(host, glbUrl, options = {}) {
  closeGlbViewport();
  if (!host || !glbUrl) return null;

  const viewW = Math.max(200, Math.round(host.clientWidth || 480));
  const viewH = Math.max(160, Math.round(host.clientHeight || 360));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const model = await loadGlbScene(glbUrl);
  // pivot → orient → model. The camera orbits `pivot`; `orient` holds the prospective
  // "bake" rotation so we can preview exactly what the re-oriented GLB will look like
  // before committing it server-side (same R = Rz·Ry·Rx as reorient-glb.mjs).
  const orient = new THREE.Group();
  orient.add(model);
  const pivot = new THREE.Group();
  pivot.add(orient);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b2a3a);
  scene.add(pivot);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.sortObjects = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const disposeLighting = applyStudioLighting(scene, renderer);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
  renderer.setPixelRatio(dpr);
  renderer.setSize(viewW, viewH, false);
  renderer.domElement.className = 'map-model-webgl-canvas';
  host.replaceChildren(renderer.domElement);

  const cam = { yaw: 35, pitch: 28, zoomFactor: 1 };
  const renderFrame = () => {
    fitOrthographicCamera(camera, pivot, viewW, viewH, cam);
    renderer.render(scene, camera);
  };
  renderFrame();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let disposed = false;
  let resizeObserver = null;

  const onResize = () => {
    if (disposed) return;
    const w = Math.max(200, Math.round(host.clientWidth || viewW));
    const h = Math.max(160, Math.round(host.clientHeight || viewH));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    renderFrame();
  };

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(host);
  } else {
    window.addEventListener('resize', onResize);
  }

  const el = renderer.domElement;
  const onDown = (e) => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault();
    e.stopPropagation();
  };
  const onMove = (e) => {
    if (!dragging || disposed) return;
    cam.yaw += e.clientX - lastX;
    cam.pitch = Math.max(5, Math.min(75, cam.pitch + (e.clientY - lastY) * 0.3));
    lastX = e.clientX;
    lastY = e.clientY;
    renderFrame();
    options.onCamChange?.(cam);
  };
  const onUp = () => { dragging = false; };

  el.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  // Live preview of a prospective re-orientation. Mirrors reorient-glb.mjs's matrix order
  // (R = Rz·Ry·Rx) so the modal preview is faithful to the baked result; camera fit re-runs
  // against the rotated bounds so re-seating/centering differences don't matter visually.
  const setModelOrientation = (rotX = 0, rotY = 0, rotZ = 0) => {
    const rx = (rotX * Math.PI) / 180;
    const ry = (rotY * Math.PI) / 180;
    const rz = (rotZ * Math.PI) / 180;
    const m = new THREE.Matrix4()
      .multiplyMatrices(new THREE.Matrix4().makeRotationZ(rz), new THREE.Matrix4().makeRotationY(ry))
      .multiply(new THREE.Matrix4().makeRotationX(rx));
    orient.matrixAutoUpdate = false;
    orient.matrix.copy(m);
    orient.matrixWorldNeedsUpdate = true;
    if (!disposed) renderFrame();
  };

  const viewport = {
    mode: 'glb',
    cam,
    refresh: renderFrame,
    setModelOrientation,
    dispose() {
      disposed = true;
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener('resize', onResize);
      disposeLighting();
      renderer.dispose();
      pivot.traverse((obj) => {
        obj.geometry?.dispose();
      });
      host.replaceChildren();
      if (activeGlbViewport === viewport) activeGlbViewport = null;
    },
  };

  activeGlbViewport = viewport;
  return viewport;
}
