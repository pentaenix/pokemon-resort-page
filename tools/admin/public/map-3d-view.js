// View-only 3D workspace for the map editor.
//
// Builds a real three.js scene of the map being edited: a height-shaded terrain mesh from the
// editor's height/special grids plus every placed prop loaded as its actual GLB (reusing the
// same loader/material tuning as the prop previewer), under an orbit camera. This is a preview,
// not an editor surface — painting still happens on the 2D grid. The controller exposes only
// dispose(); the caller re-mounts after a render when the workspace is in 3D mode.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadGlbScene } from './model-glb-viewer.js';
import { SPECIAL } from './ramp-specials.js';

const TOP_A = [0x3f, 0x6b, 0x4a];
const TOP_B = [0x4a, 0x7a, 0x55];

function tileColor(level, special, blocked, parity) {
  const base = parity ? TOP_A : TOP_B;
  const shade = Math.min(70, Math.max(0, level) * 12);
  let r = Math.min(255, base[0] + shade);
  let g = Math.min(255, base[1] + shade);
  let b = Math.min(255, base[2] + shade);
  // Ramp/slope specials read amber so slopes stand out from flat tiles.
  if (special >= SPECIAL.RAMP_N && special <= SPECIAL.CONCAVE_NW) { r = (r + 251) / 2; g = (g + 191) / 2; b = (b + 60) / 2; }
  if (blocked) { r = (r + 220) / 2; g = (g + 90) / 2; b = (b + 90) / 2; }
  return new THREE.Color(r / 255, g / 255, b / 255);
}

function buildTerrain(map, tileSize) {
  const w = map.grid.width;
  const h = map.grid.height;
  const heights = map.terrain?.height || [];
  const specials = map.terrain?.special || [];
  const collision = map.terrain?.collision || [];
  const baseThk = tileSize * 0.6;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.0, vertexColors: false });
  const mesh = new THREE.InstancedMesh(geo, mat, w * h);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  let i = 0;
  for (let z = 0; z < h; z += 1) {
    for (let x = 0; x < w; x += 1) {
      const level = Math.max(0, heights?.[z]?.[x] ?? 0);
      const top = level * tileSize;
      const bottom = -baseThk;
      const boxH = top - bottom;
      pos.set((x + 0.5) * tileSize, (top + bottom) / 2, (z + 0.5) * tileSize);
      scl.set(tileSize * 0.98, boxH, tileSize * 0.98);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tileColor(level, specials?.[z]?.[x] ?? 0, Boolean(collision?.[z]?.[x]), ((x + z) & 1) === 0));
      i += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Mount a view-only 3D scene of the current map into `host`.
 * @param {HTMLElement} host
 * @param {object} map editor map (grid + terrain + models)
 * @param {Array} catalog model catalog (for footprint/hash → asset url)
 * @param {object} opts { modelUrl(id, meta) }
 * @returns {{ dispose():void }}
 */
export function mountMap3DView(host, map, catalog = [], opts = {}) {
  if (!host || !map) return { dispose() {} };
  host.innerHTML = '';
  let disposed = false;
  let raf = 0;

  const tileSize = map.grid?.tileSize || 16;
  const w = map.grid.width;
  const h = map.grid.height;
  const cx = (w * tileSize) / 2;
  const cz = (h * tileSize) / 2;
  const span = Math.max(w, h) * tileSize;

  const viewW = Math.max(320, Math.round(host.clientWidth || 640));
  const viewH = Math.max(320, Math.round(host.clientHeight || 520));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(viewW, viewH);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b2a3a);

  const camera = new THREE.PerspectiveCamera(45, viewW / viewH, 0.1, span * 12);
  camera.position.set(cx + span * 0.7, span * 0.85, cz + span * 0.9);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(cx, tileSize, cz);
  controls.maxPolarAngle = Math.PI * 0.49; // keep above the horizon
  controls.minDistance = tileSize * 2;
  controls.maxDistance = span * 6;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4a3a, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(span, span * 1.4, span * 0.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff0e0, 0.4);
  fill.position.set(-span * 0.6, span * 0.8, -span);
  scene.add(fill);

  scene.add(buildTerrain(map, tileSize));

  const modelUrl = opts.modelUrl || ((id) => `/api/overworld-models/glb?id=${encodeURIComponent(id)}`);
  const props = new THREE.Group();
  scene.add(props);
  for (const mdl of (map.models || [])) {
    const meta = (catalog || []).find((c) => c.id === mdl.id);
    const url = modelUrl(mdl.id, meta);
    loadGlbScene(url)
      .then((obj) => {
        if (disposed) return;
        const g = new THREE.Group();
        g.add(obj);
        g.position.set(mdl.position?.[0] ?? 0, mdl.position?.[1] ?? 0, mdl.position?.[2] ?? 0);
        g.rotation.y = -((mdl.yawDeg || 0) * Math.PI) / 180;
        const s = mdl.scale || 1;
        g.scale.set(s, s, s);
        props.add(g);
      })
      .catch(() => { /* a missing/broken asset just doesn't appear; not fatal for preview */ });
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  };

  const tick = () => {
    if (disposed) return;
    // If the host canvas was detached (tab switch / re-render) stop the loop and free GL.
    if (!renderer.domElement.isConnected) { dispose(); return; }
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onResize = () => {
    if (disposed) return;
    const nw = Math.max(320, Math.round(host.clientWidth || viewW));
    const nh = Math.max(320, Math.round(host.clientHeight || viewH));
    renderer.setSize(nw, nh);
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(host);

  return { dispose };
}
