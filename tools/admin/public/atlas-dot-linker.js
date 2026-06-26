import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  FRAMING_REFERENCE,
  fitIslandModel,
} from '/shared/island-viewport.js';
import {
  DEFAULT_MAP_ALIGNMENT,
  alignmentPlaneSize,
  degToRad,
  normalizeMapAlignment,
  radToDeg,
  syncIslandPinDots,
} from '/shared/island-map-dots.js';

let dotLinkerBind = null;

function alignmentSliderRow(label, key, value, min, max, step, format = (n) => n.toFixed(2)) {
  const id = `atlas-dot-align-${key}`;
  return `<label class="atlas-dot-align-slider" for="${id}">
    <span>${label}</span>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" data-atlas-dot-align="${key}">
    <output data-atlas-dot-align-out="${key}">${format(Number(value))}</output>
  </label>`;
}

function alignmentControlsHtml(alignment) {
  const a = normalizeMapAlignment(alignment);
  return `<div class="atlas-dot-align-grid">
    ${alignmentSliderRow('3D overlay opacity', 'overlayOpacity', a.overlayOpacity ?? 0.55, 0.15, 1, 0.05)}
    ${alignmentSliderRow('Plane size', 'planeSize', a.planeSize || FRAMING_REFERENCE, 4, 20, 0.5)}
    ${alignmentSliderRow('Scale X', 'scaleX', a.scaleX, 0.5, 1.5, 0.02)}
    ${alignmentSliderRow('Scale Z', 'scaleZ', a.scaleZ, 0.5, 1.5, 0.02)}
    ${alignmentSliderRow('Offset X', 'offsetX', a.offsetX, -5, 5, 0.1)}
    ${alignmentSliderRow('Offset Z', 'offsetZ', a.offsetZ, -5, 5, 0.1)}
    ${alignmentSliderRow('Rotation (deg)', 'rotationDeg', radToDeg(a.rotationY), -180, 180, 1, (n) => `${n.toFixed(0)}°`)}
    <label class="atlas-dot-align-check"><input type="checkbox" data-atlas-dot-align="flipU" ${a.flipU ? 'checked' : ''}> Flip U (left / right)</label>
    <label class="atlas-dot-align-check"><input type="checkbox" data-atlas-dot-align="flipV" ${a.flipV ? 'checked' : ''}> Flip V (top / bottom)</label>
  </div>`;
}

function pinShowsOn3d(pin) {
  return pin.map3d?.enabled !== false;
}

function dotListHtml(pins, selectedId) {
  if (!pins.length) {
    return '<p class="hint">Add cork pins on the board above first. Their map positions stay fixed — this panel only aligns the 3D mesh and shows dots on it.</p>';
  }
  return `<div class="atlas-dot-pin-list">${pins.map((pin) => {
    const on3d = pinShowsOn3d(pin);
    return `<div class="atlas-dot-pin-item${pin.id === selectedId ? ' active' : ''}" data-atlas-dot-pin-row="${pin.id}">
      <button type="button" class="atlas-dot-pin-select" data-atlas-dot-pin-id="${pin.id}">
        <span class="atlas-map-dot-marker atlas-map-dot-marker--${pin.color}" aria-hidden="true"></span>
        <span class="atlas-dot-pin-copy">
          <strong>${pin.name}</strong>
          <span class="feature-list-meta">${pin.id} · cork ${Math.round(pin.x * 100)}%, ${Math.round(pin.y * 100)}%</span>
        </span>
      </button>
      <label class="atlas-dot-pin-toggle" title="Show on 3D island">
        <input type="checkbox" data-atlas-dot-enabled="${pin.id}" ${on3d ? 'checked' : ''}>
        <span>3D</span>
      </label>
    </div>`;
  }).join('')}</div>`;
}

function overlayMarkersHtml(pins, selectedId) {
  return pins.map((pin) => {
    if (!pinShowsOn3d(pin)) return '';
    return `<span class="atlas-dot-overlay-marker atlas-map-dot-marker atlas-map-dot-marker--${pin.color}${pin.id === selectedId ? ' atlas-map-dot-marker--selected' : ''}"
      style="left:${pin.x * 100}%;top:${pin.y * 100}%"
      data-atlas-dot-overlay-marker="${pin.id}"
      title="${pin.name}"></span>`;
  }).join('');
}

function overlayStageHtml(atlas, pins, selectedId) {
  const terrain = atlas?.map?.layers?.terrain || '';
  return `<div class="atlas-dot-overlay-stage">
    <img class="atlas-dot-overlay-terrain" src="/${terrain}" alt="" draggable="false">
    <div class="atlas-dot-overlay-markers" data-atlas-dot-overlay-markers>
      ${overlayMarkersHtml(pins, selectedId)}
    </div>
    <div class="atlas-dot-overlay-canvas" data-atlas-dot-overlay aria-hidden="true"></div>
  </div>`;
}

export function atlasDotLinkerPanelHtml(state) {
  const atlas = state.data['atlas-pins.json'] || {};
  const pins = atlas.pins || [];
  const models = state.data['models.json'] || {};
  const alignment = models.mainModel?.mapAlignment;
  const selectedId = state.selected.atlasDotPin || state.selected.atlasPin || pins[0]?.id || null;
  return `<section class="panel atlas-dot-linker-panel" id="atlasDotLinkerPanel">
    <div class="atlas-dot-linker-head">
      <div>
        <h3>3D location dots</h3>
        <p class="hint">Cork-board pin positions are read-only here. Tune alignment so the island mesh sits over the terrain map; dots land on the mesh automatically using each pin&apos;s cork coordinates and mesh height.</p>
      </div>
      <button type="button" class="btn" id="saveAtlasDotLinker">Save 3D alignment</button>
    </div>
    <details class="atlas-dot-alignment-block" open>
      <summary>Mesh overlay alignment</summary>
      ${alignmentControlsHtml(alignment)}
    </details>
    <p class="atlas-dot-linker-status" data-atlas-dot-status role="status"></p>
    <div class="atlas-dot-linker-studio">
      <aside class="atlas-dot-linker-sidebar">
        <p class="atlas-dot-linker-sidebar-label">Pins on 3D</p>
        <div data-atlas-dot-list-host>${dotListHtml(pins, selectedId)}</div>
        <p class="hint">Uncheck <strong>3D</strong> to hide a dot on the island view. Edit cork positions on the board above only.</p>
      </aside>
      <div class="atlas-dot-linker-overlay-pane">
        <p class="hint atlas-dot-map-label">Terrain map with 3D island overlay · colored dots snap to mesh height</p>
        <div data-atlas-dot-overlay-host>${overlayStageHtml(atlas, pins, selectedId)}</div>
      </div>
    </div>
  </section>`;
}

function readAlignmentFromDom(panel) {
  const alignment = { ...DEFAULT_MAP_ALIGNMENT };
  panel?.querySelectorAll('[data-atlas-dot-align]').forEach((input) => {
    const key = input.dataset.atlasDotAlign;
    if (key === 'rotationDeg') {
      alignment.rotationY = degToRad(Number(input.value));
      return;
    }
    if (key === 'flipU' || key === 'flipV') {
      alignment[key] = input.checked ? 1 : 0;
      return;
    }
    const value = Number(input.value);
    if (Number.isFinite(value)) alignment[key] = value;
  });
  return normalizeMapAlignment(alignment);
}

function applyAlignmentFromDom(state, deps, panel) {
  const models = state.data['models.json'];
  if (!models?.mainModel || !panel) return null;
  const alignment = readAlignmentFromDom(panel);
  const before = JSON.stringify(normalizeMapAlignment(models.mainModel.mapAlignment));
  const next = JSON.stringify(alignment);
  if (before !== next) {
    models.mainModel.mapAlignment = alignment;
    deps.markDirty('models.json');
  }
  return alignment;
}

function setDotLinkerStatus(panel, message, tone = '') {
  const el = panel?.querySelector('[data-atlas-dot-status]');
  if (!el) return;
  el.textContent = message || '';
  el.className = `atlas-dot-linker-status${tone ? ` atlas-dot-linker-status--${tone}` : ''}`;
}

function getSelectedDotPin(state) {
  const pins = state.data['atlas-pins.json']?.pins || [];
  const id = state.selected.atlasDotPin || state.selected.atlasPin;
  return pins.find((p) => p.id === id) || pins[0] || null;
}

function refreshDotLinkerChrome(state, panel) {
  const pins = state.data['atlas-pins.json']?.pins || [];
  const selectedId = getSelectedDotPin(state)?.id || null;
  const atlas = state.data['atlas-pins.json'] || {};
  const listHost = panel?.querySelector('[data-atlas-dot-list-host]');
  const markersHost = panel?.querySelector('[data-atlas-dot-overlay-markers]');
  if (listHost) listHost.innerHTML = dotListHtml(pins, selectedId);
  if (markersHost) markersHost.innerHTML = overlayMarkersHtml(pins, selectedId);
  const terrain = panel?.querySelector('.atlas-dot-overlay-terrain');
  const terrainPath = atlas?.map?.layers?.terrain;
  if (terrain && terrainPath) terrain.src = `/${terrainPath}`;
}

function setPin3dEnabled(state, deps, pinId, enabled) {
  const pin = state.data['atlas-pins.json']?.pins?.find((p) => p.id === pinId);
  if (!pin) return;
  const next = enabled === true;
  const wasEnabled = pin.map3d?.enabled !== false;
  if (wasEnabled === next) return;
  if (!pin.map3d) pin.map3d = {};
  pin.map3d.enabled = next;
  deps.markDirty('atlas-pins.json');
}

function updateDotLinkerLive(state, deps, panel) {
  const alignment = applyAlignmentFromDom(state, deps, panel);
  const models = state.data['models.json'] || {};
  const displaySize = Number(models.mainModel?.displaySize) || FRAMING_REFERENCE;
  const pins = state.data['atlas-pins.json']?.pins || [];
  refreshDotLinkerChrome(state, panel);
  dotLinkerBind?.setConfig?.({
    alignment,
    displaySize,
    pins,
    selectedPinId: getSelectedDotPin(state)?.id || null,
  });
}

function frameAlignmentCamera(camera, alignment, displaySize) {
  const plane = alignmentPlaneSize(alignment, displaySize);
  const half = plane / 2;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.near = 0.1;
  camera.far = 500;
  camera.position.set(0, plane * 2.5, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

function applyMeshOverlayOpacity(root, opacity) {
  const alpha = Math.min(1, Math.max(0.1, Number(opacity) || 0.55));
  root.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material) return;
      material.transparent = true;
      material.opacity = alpha;
      material.depthWrite = alpha > 0.92;
    });
  });
}

/**
 * Transparent top-down overlay: terrain image underneath (HTML), mesh + dots in WebGL on top.
 * @param {HTMLElement} mount
 */
export function bindAtlasDotOverlay(mount, options = {}) {
  if (!mount) return null;

  let currentDisplaySize = Number(options.displaySize) > 0 ? Number(options.displaySize) : FRAMING_REFERENCE;
  let currentAlignment = normalizeMapAlignment(options.alignment);
  let currentPins = Array.isArray(options.pins) ? options.pins : [];
  let selectedPinId = options.selectedPinId || null;
  const url = options.url || null;

  let disposed = false;
  mount.replaceChildren();

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(4, 12, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd8f4ff, 0.45);
  fill.position.set(-5, 8, -4);
  scene.add(fill);

  const modelHolder = new THREE.Group();
  scene.add(modelHolder);
  const dotsGroup = new THREE.Group();
  modelHolder.add(dotsGroup);

  let loadedModel = null;
  let gltfRoot = null;

  function refreshScene() {
    frameAlignmentCamera(camera, currentAlignment, currentDisplaySize);
    syncIslandPinDots(dotsGroup, currentPins, {
      alignment: currentAlignment,
      displaySize: currentDisplaySize,
      meshRoot: loadedModel,
      selectedPinId,
    });
    if (loadedModel) applyMeshOverlayOpacity(loadedModel, currentAlignment.overlayOpacity ?? 0.55);
  }

  function remountModel() {
    if (!gltfRoot || disposed) return;
    if (loadedModel) {
      modelHolder.remove(loadedModel);
      loadedModel.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => m?.dispose());
        }
      });
      loadedModel = null;
    }
    loadedModel = gltfRoot.clone(true);
    fitIslandModel(loadedModel, currentDisplaySize);
    applyMeshOverlayOpacity(loadedModel, currentAlignment.overlayOpacity ?? 0.55);
    modelHolder.add(loadedModel);
    if (!modelHolder.children.includes(dotsGroup)) modelHolder.add(dotsGroup);
    refreshScene();
  }

  function resize() {
    if (disposed) return;
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    refreshScene();
  }
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(mount);
  else window.addEventListener('resize', resize);

  let raf = 0;
  function animate() {
    raf = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
  refreshScene();

  if (url) {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        if (disposed) return;
        gltfRoot = gltf.scene;
        remountModel();
      },
      undefined,
      () => {},
    );
  }

  return {
    setConfig(config = {}) {
      if (Number(config.displaySize) > 0) currentDisplaySize = Number(config.displaySize);
      if (config.alignment) currentAlignment = normalizeMapAlignment(config.alignment);
      if (Array.isArray(config.pins)) currentPins = config.pins;
      if (config.selectedPinId !== undefined) selectedPinId = config.selectedPinId;
      if (gltfRoot) remountModel();
      else refreshScene();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', resize);
      if (loadedModel) {
        loadedModel.traverse((child) => {
          if (child.isMesh) {
            child.geometry?.dispose();
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => m?.dispose());
          }
        });
      }
      dotsGroup.traverse((child) => {
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

function refreshDotLinkerStage(state, deps, { force = false } = {}) {
  const panel = deps.$('#atlasDotLinkerPanel');
  const host = panel?.querySelector('[data-atlas-dot-overlay]');
  if (!host) return;

  const models = state.data['models.json'] || {};
  const atlas = state.data['atlas-pins.json'] || {};
  const file = models.mainModel?.file;
  const displaySize = Number(models.mainModel?.displaySize) || FRAMING_REFERENCE;
  const alignment = normalizeMapAlignment(models.mainModel?.mapAlignment);
  const pins = atlas.pins || [];
  const selectedPinId = getSelectedDotPin(state)?.id || null;
  const cacheKey = `${file || ''}|${displaySize}|${JSON.stringify(alignment)}|${pins.length}`;
  if (!force && panel.dataset.dotLinkerKey === cacheKey && dotLinkerBind) {
    dotLinkerBind.setConfig({ alignment, displaySize, pins, selectedPinId });
    refreshDotLinkerChrome(state, panel);
    return;
  }
  panel.dataset.dotLinkerKey = cacheKey;

  if (dotLinkerBind?.dispose) {
    dotLinkerBind.dispose();
    dotLinkerBind = null;
  }

  dotLinkerBind = bindAtlasDotOverlay(host, {
    url: file ? `/${file}?_=${Date.now()}` : null,
    displaySize,
    alignment,
    pins,
    selectedPinId,
  });
  refreshDotLinkerChrome(state, panel);
}

export function bindAtlasDotLinker(state, deps) {
  const panel = deps.$('#atlasDotLinkerPanel');
  if (!panel) return;

  if (!state.atlasDotLinkerBound) {
    state.atlasDotLinkerBound = true;

    document.addEventListener('input', (event) => {
      const livePanel = deps.$('#atlasDotLinkerPanel');
      if (!livePanel || !livePanel.contains(event.target)) return;
      const alignInput = event.target.closest('[data-atlas-dot-align]');
      if (!alignInput || alignInput.type === 'checkbox') return;
      const key = alignInput.dataset.atlasDotAlign;
      const value = Number(alignInput.value);
      const out = livePanel.querySelector(`[data-atlas-dot-align-out="${key}"]`);
      if (out) {
        out.textContent = key === 'rotationDeg' ? `${value.toFixed(0)}°` : value.toFixed(2);
      }
      updateDotLinkerLive(state, deps, livePanel);
    });

    document.addEventListener('change', (event) => {
      const livePanel = deps.$('#atlasDotLinkerPanel');
      if (!livePanel || !livePanel.contains(event.target)) return;

      if (event.target.matches('[data-atlas-dot-align][type="checkbox"]')) {
        updateDotLinkerLive(state, deps, livePanel);
        return;
      }

      const enabledToggle = event.target.closest('[data-atlas-dot-enabled]');
      if (enabledToggle) {
        setPin3dEnabled(state, deps, enabledToggle.dataset.atlasDotEnabled, enabledToggle.checked);
        updateDotLinkerLive(state, deps, livePanel);
      }
    });

    document.addEventListener('click', (event) => {
      const livePanel = deps.$('#atlasDotLinkerPanel');
      if (!livePanel || !livePanel.contains(event.target)) return;

      const saveBtn = event.target.closest('#saveAtlasDotLinker');
      if (saveBtn) {
        applyAlignmentFromDom(state, deps, livePanel);
        const saves = [];
        if (state.dirty.has('models.json')) {
          saves.push(deps.saveFile('models.json', state.data['models.json']));
        }
        if (state.dirty.has('atlas-pins.json')) {
          saves.push(deps.saveFile('atlas-pins.json', state.data['atlas-pins.json']));
        }
        Promise.all(saves).then(() => {
          setDotLinkerStatus(
            livePanel,
            saves.length ? 'Saved 3D alignment and dot visibility.' : 'Nothing to save.',
            saves.length ? 'ok' : '',
          );
          if (saves.length) deps.log('3D dot alignment saved.', 'ok');
        });
        return;
      }

      const pinBtn = event.target.closest('[data-atlas-dot-pin-id]');
      if (pinBtn) {
        state.selected.atlasDotPin = pinBtn.dataset.atlasDotPinId;
        updateDotLinkerLive(state, deps, livePanel);
      }
    });
  }

  refreshDotLinkerStage(state, deps, { force: true });
}

export function syncAtlasDotLinker(state, deps) {
  const panel = deps.$('#atlasDotLinkerPanel');
  if (!panel) return;
  refreshDotLinkerStage(state, deps);
}
