import { dossierEditorHtml, bindDossierEditor, readDossierFromDom } from './feature-dossier-editor.js';
import { featureHasDossierContent } from './dossier-shared.js';
import { normalizeFeatureDossierRaw } from './feature-dossier-editor.js';

const PIN_COLORS = ['blue', 'yellow', 'red'];

const ATLAS_DOSSIER_CONFIG = {
  title: 'Location dossier',
  hint: 'Show screenshots, diagrams, in-game captures, boat model links, and notes for this pin.',
  showMap: false,
  showResearchMilestones: false,
  uploadFolder: 'media/atlas',
  open: true,
};

function clampPinTilt(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.min(20, Math.max(-20, Math.round(n)));
}

function defaultPinTilt(id = 'pin') {
  let hash = 5381;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) + hash) ^ id.charCodeAt(i);
  }
  return -20 + (Math.abs(hash) % 41);
}

function resolvePinTilt(pin) {
  if (pin?.tilt !== undefined && pin?.tilt !== null && pin?.tilt !== '') {
    const clamped = clampPinTilt(pin.tilt);
    if (clamped !== null) return clamped;
  }
  return defaultPinTilt(pin?.id || 'pin');
}

function pinHasCustomTilt(pin) {
  return pin?.tilt !== undefined && pin?.tilt !== null && pin?.tilt !== '';
}

function colorLabel(colorId, pinColors = []) {
  return pinColors.find((c) => c.id === colorId)?.label || colorId;
}

function pinMarkerHtml(pin, selectedId) {
  const tilt = resolvePinTilt(pin);
  return `<button type="button" class="cork-pin cork-pin--${pin.color}${pin.id === selectedId ? ' cork-pin--selected' : ''} cork-pin--editable"
    style="left:${pin.x * 100}%;top:${pin.y * 100}%;--pin-tilt:${tilt}deg"
    data-atlas-pin-marker="${pin.id}" aria-label="${pin.name}">
    <span class="cork-pin-shadow"></span>
    <span class="cork-pin-figure"><span class="cork-pin-head"></span><span class="cork-pin-stem"></span></span>
  </button>`;
}

function slugify(text) {
  return String(text || 'pin')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'pin';
}

function pinListHtml(pins, selectedId, pinColors = []) {
  if (!pins.length) {
    return `<div class="atlas-map-empty-list">
      <p class="hint">No pins yet.</p>
      <p class="hint">Pick a color below the map, then click <strong>Add pin</strong> and drop it on the cork board.</p>
    </div>`;
  }
  return `<div class="list feature-list atlas-pin-list">${pins.map((pin) => `
    <button type="button" class="atlas-pin-list-item${pin.id === selectedId ? ' active' : ''}" data-atlas-pin-id="${pin.id}">
      <span class="atlas-pin-list-dot atlas-pin-dot atlas-pin-dot--${pin.color}" aria-hidden="true"></span>
      <span class="atlas-pin-list-copy">
        <strong>${pin.name}</strong>
        <span class="feature-list-meta">${colorLabel(pin.color, pinColors)} · ${Math.round(pin.x * 100)}%, ${Math.round(pin.y * 100)}%${pinHasCustomTilt(pin) ? ` · tilt ${resolvePinTilt(pin)}°` : ''}</span>
      </span>
    </button>`).join('')}</div>`;
}

function pinDetailHtml(pin, deps, pinColors = []) {
  const hasDossier = featureHasDossierContent(pin, normalizeFeatureDossierRaw);
  const tilt = resolvePinTilt(pin);
  const customTilt = pinHasCustomTilt(pin);
  return `<div class="feature-detail atlas-pin-detail">
    <div class="feature-detail-head atlas-pin-detail-head">
      <div class="feature-detail-badges">
        <span class="badge">${deps.esc(pin.id)}</span>
        <span class="badge atlas-pin-color-badge atlas-pin-color-badge--${pin.color}">${colorLabel(pin.color, pinColors)}</span>
        ${hasDossier ? '<span class="badge record-detail-dossier">Brief</span>' : ''}
      </div>
      <button type="button" class="btn ghost small danger" data-atlas-delete-pin>Delete pin</button>
    </div>
    <form class="form atlas-pin-form" data-form="atlas-pin" novalidate>
      <fieldset class="atlas-pin-fieldset">
        <legend>Basics</legend>
        <label class="feature-title-field">Name<input name="name" value="${deps.esc(pin.name)}"></label>
        <div class="row">
          <label>ID<input name="id" value="${deps.esc(pin.id)}"></label>
          <label>Color<select name="color">${PIN_COLORS.map((c) => `<option value="${c}"${pin.color === c ? ' selected' : ''}>${deps.esc(colorLabel(c, pinColors))}</option>`).join('')}</select></label>
        </div>
        <label>Hover summary<textarea name="summary" rows="3" placeholder="Short tooltip on the public map…">${deps.esc(pin.summary || '')}</textarea></label>
      </fieldset>
      <fieldset class="atlas-pin-fieldset">
        <legend>Placement</legend>
        <div class="row">
          <label>Map X (0–1)<input name="x" type="number" min="0" max="1" step="0.005" value="${pin.x}"></label>
          <label>Map Y (0–1)<input name="y" type="number" min="0" max="1" step="0.005" value="${pin.y}"></label>
        </div>
        <div class="atlas-pin-tilt-control">
          <div class="atlas-pin-tilt-head">
            <label for="atlasPinTilt">Pin tilt</label>
            <span class="atlas-pin-tilt-value" data-atlas-tilt-display>${tilt}°</span>
            ${customTilt ? '' : '<span class="hint">auto</span>'}
          </div>
          <input id="atlasPinTilt" name="tilt" type="range" min="-20" max="20" step="1" value="${tilt}" data-atlas-tilt-range${customTilt ? '' : ' data-atlas-tilt-auto="true"'}>
          <div class="atlas-pin-tilt-actions">
            <button type="button" class="btn ghost small" data-atlas-tilt-reset${customTilt ? '' : ' disabled'}>Reset to auto</button>
            <span class="hint">Drag on map or use slider · −20° to 20°</span>
          </div>
        </div>
      </fieldset>
      <details class="feature-advanced"><summary>Links &amp; 3D placeholder</summary>
        <label>Linked research ids<input name="linkedResearch" value="${deps.esc((pin.linkedResearch || []).join(', '))}"></label>
        <label>Linked features<input name="linkedFeatures" value="${deps.esc((pin.linkedFeatures || []).join(', '))}"></label>
        <label>Future 3D position<input name="position3d" value="${deps.esc((pin.position3d || []).join(', '))}" placeholder="-1.9, 0.22, 1.35"></label>
      </details>
      <div id="atlasPinDossierMount">${dossierEditorHtml(pin, deps, ATLAS_DOSSIER_CONFIG)}</div>
    </form>
  </div>`;
}

function bindAtlasPinListHandlers(state, deps, handlers) {
  deps.$('#atlasPinListHost')?.querySelectorAll('[data-atlas-pin-id]').forEach((btn) => {
    btn.onclick = () => selectAtlasPin(state, deps, handlers, btn.dataset.atlasPinId);
  });
}

function updatePinMarkerSelection(boardHost, selectedId) {
  boardHost?.querySelector('[data-atlas-board]')?.querySelectorAll('[data-atlas-pin-marker]').forEach((btn) => {
    btn.classList.toggle('cork-pin--selected', btn.dataset.atlasPinMarker === selectedId);
  });
}

function refreshAtlasPinList(state, deps) {
  const pins = state.data['atlas-pins.json']?.pins || [];
  const pinColors = state.data['atlas-pins.json']?.pinColors || [];
  const listHost = deps.$('#atlasPinListHost');
  if (listHost) listHost.innerHTML = pinListHtml(pins, state.selected.atlasPin, pinColors);
}

function refreshAtlasPinDetail(state, deps, handlers) {
  const pinColors = state.data['atlas-pins.json']?.pinColors || [];
  const detailHost = deps.$('#atlasPinDetailHost');
  const pin = getSelectedAtlasPin(state);
  if (!detailHost) return;
  detailHost.innerHTML = pin ? pinDetailHtml(pin, deps, pinColors) : '<p class="hint">Select or add a pin.</p>';
  if (pin) bindAtlasPinDossier(state, deps);
  bindPinDetailControls(state, deps, handlers);
}

function selectAtlasPin(state, deps, handlers, pinId, { persistCurrent = true } = {}) {
  if (!pinId) return;
  if (persistCurrent && state.selected.atlasPin && state.selected.atlasPin !== pinId) {
    applyPinFromForm(state, deps);
  }
  state.selected.atlasPin = pinId;
  refreshAtlasPinList(state, deps);
  bindAtlasPinListHandlers(state, deps, handlers);
  refreshAtlasPinDetail(state, deps, handlers);
  updatePinMarkerSelection(deps.$('#atlasMapBoardHost'), pinId);
}

function renderMapBoard(host, data, state, deps, handlers) {
  if (!host) return;
  const atlas = data['atlas-pins.json'] || {};
  const layers = atlas.map?.layers || {};
  const pinColors = atlas.pinColors || [];
  const vis = state.atlasMapLayers || { buildings: true, paths: true, pins: true };
  const pins = atlas.pins || [];
  const selectedId = state.selected.atlasPin;
  const activeColor = state.atlasActiveColor || 'yellow';
  const addMode = state.atlasAddMode;
  const showPins = vis.pins !== false;

  host.innerHTML = `
    <div class="island-map2d-shell island-map2d-shell--admin">
      <div class="island-map2d-toolbar island-map2d-toolbar--admin">
        <div class="island-map2d-toolbar-group">
          <span class="island-map2d-toolbar-label">New pin</span>
          <div class="island-map2d-colors">
            ${PIN_COLORS.map((c) => `<button type="button" class="island-map2d-color island-map2d-color--${c}${activeColor === c ? ' active' : ''}" data-atlas-set-color="${c}" title="${colorLabel(c, pinColors)}">${colorLabel(c, pinColors)}</button>`).join('')}
          </div>
          <button type="button" class="btn small${addMode ? ' active' : ''}" data-atlas-toggle-add>${addMode ? 'Click map to drop…' : 'Add pin'}</button>
        </div>
        <div class="island-map2d-toolbar-group">
          <span class="island-map2d-toolbar-label">Layers</span>
          <div class="island-map2d-layers">
            <label class="island-map2d-layer-toggle"><input type="checkbox" data-atlas-layer="buildings"${vis.buildings ? ' checked' : ''}> Buildings</label>
            <label class="island-map2d-layer-toggle"><input type="checkbox" data-atlas-layer="paths"${vis.paths ? ' checked' : ''}> Paths</label>
            <label class="island-map2d-layer-toggle"><input type="checkbox" data-atlas-layer="pins"${showPins ? ' checked' : ''}> Pins</label>
          </div>
        </div>
      </div>
      <div class="island-map2d-board island-map2d-board--editable${addMode ? ' island-map2d-board--add-mode' : ''}" data-atlas-board>
        <div class="island-map2d-layers-stack">
          ${layers.terrain ? `<img class="island-map2d-layer island-map2d-layer--terrain" src="/${layers.terrain}" alt="" draggable="false">` : ''}
          ${layers.buildings && vis.buildings ? `<img class="island-map2d-layer island-map2d-layer--buildings" src="/${layers.buildings}" alt="" draggable="false">` : ''}
          ${layers.paths && vis.paths ? `<img class="island-map2d-layer island-map2d-layer--paths" src="/${layers.paths}" alt="" draggable="false">` : ''}
        </div>
        ${showPins ? `<div class="island-map2d-pins">${pins.map((pin) => pinMarkerHtml(pin, selectedId)).join('')}</div>` : ''}
      </div>
    </div>`;

  const board = host.querySelector('[data-atlas-board]');
  board?.querySelectorAll('[data-atlas-pin-marker]').forEach((btn) => {
    const pinId = btn.dataset.atlasPinMarker;
    let dragMoved = false;
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      selectAtlasPin(state, deps, handlers, pinId);
    });
    btn.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragMoved = false;

      if (state.selected.atlasPin !== pinId) {
        selectAtlasPin(state, deps, handlers, pinId);
      }

      try {
        btn.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }

      const startX = event.clientX;
      const startY = event.clientY;
      const rect = board.getBoundingClientRect();
      const move = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4) {
          dragMoved = true;
        }
        const x = Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (moveEvent.clientY - rect.top) / rect.height));
        btn.style.left = `${x * 100}%`;
        btn.style.top = `${y * 100}%`;
        handlers.onPinMove(pinId, x, y);
      };
      const up = (upEvent) => {
        if (upEvent.pointerId !== event.pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        try {
          btn.releasePointerCapture(upEvent.pointerId);
        } catch {
          /* ignore */
        }
        if (dragMoved) {
          refreshAtlasPinList(state, deps);
          bindAtlasPinListHandlers(state, deps, handlers);
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  });

  board?.addEventListener('click', (event) => {
    if (!state.atlasAddMode) return;
    if (event.target.closest('[data-atlas-pin-marker]')) return;
    const rect = board.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    state.atlasAddMode = false;
    onAddPin?.(x, y, activeColor);
  });
}

let onAddPin = null;

export function atlasMapEditorHtml(state, esc, dossierDeps) {
  const atlas = state.data['atlas-pins.json'] || { pins: [] };
  const pins = atlas.pins || [];
  const id = state.selected.atlasPin || pins[0]?.id;
  state.selected.atlasPin = id;
  const pin = pins.find((p) => p.id === id);
  const dirty = state.dirty.has('atlas-pins.json');
  return `<section class="toolbar feature-toolbar atlas-map-toolbar">
    <div><h2>Island Atlas</h2><p>Cork-board map for show research — drag pins, tune tilt, toggle layers, and attach dossiers.</p>
      ${dirty ? '<p class="hint feature-unsaved"><strong>Unsaved changes</strong> — Save atlas pins when ready.</p>' : '<p class="hint feature-disk-ok">Saved to public/data/atlas-pins.json</p>'}
    </div>
    <div class="actions">
      <button type="button" class="btn ghost" id="newAtlasPin">Add pin</button>
      <button type="button" class="btn" id="saveAtlasPins">Save atlas pins</button>
    </div>
  </section>
  <section class="atlas-map-editor-layout">
    <aside class="panel feature-sidebar atlas-map-sidebar">
      <div class="atlas-map-sidebar-head">
        <h3>Locations</h3>
        <span class="badge">${pins.length}</span>
      </div>
      <div id="atlasPinListHost">${pinListHtml(pins, id, atlas.pinColors)}</div>
    </aside>
    <div class="panel atlas-map-board-panel">
      <div id="atlasMapBoardHost"></div>
    </div>
    <article class="panel feature-main atlas-map-detail-panel" id="atlasPinDetailHost">${pin ? pinDetailHtml(pin, dossierDeps, atlas.pinColors) : '<p class="hint">Select or add a pin.</p>'}</article>
  </section>`;
}

function bindAtlasPinDossier(state, deps) {
  const mount = deps.$('#atlasPinDossierMount');
  if (!mount) return;
  delete mount.dataset.dossierBound;
  bindDossierEditor({
    ...deps,
    mountSelector: '#atlasPinDossierMount',
    renderEditorHtml: (record, dossierDeps) => dossierEditorHtml(record, dossierDeps, {
      ...ATLAS_DOSSIER_CONFIG,
      uploadSubdir: record?.id || '',
    }),
    getUploadFolder: () => 'media/atlas',
    getUploadSubdir: () => getSelectedAtlasPin(state)?.id || '',
    getRecord: () => getSelectedAtlasPin(state),
    onDirty: () => deps.markDirty('atlas-pins.json'),
  });
}
function applyDossierFromForm(pin, deps) {
  pin.dossier = readDossierFromDom(deps.$, { keepDrafts: true, mountSelector: '#atlasPinDossierMount' });
}

function readPinFormFields(form) {
  if (!(form instanceof HTMLFormElement)) return null;
  const d = {};
  form.querySelectorAll('input[name], textarea[name], select[name]').forEach((el) => {
    if (el.disabled || !el.name) return;
    d[el.name] = el.value;
  });
  return d;
}

function applyPinFromForm(state, deps) {
  const pin = getSelectedAtlasPin(state);
  if (!pin) return;
  const form = deps.$('#atlasPinDetailHost')?.querySelector('form[data-form="atlas-pin"]');
  const d = readPinFormFields(form);
  if (!d) return;
  const oldId = pin.id;
  pin.name = d.name || pin.name;
  pin.id = (d.id || pin.id).trim();
  pin.color = PIN_COLORS.includes(d.color) ? d.color : pin.color;
  pin.summary = d.summary || '';
  pin.x = Math.min(1, Math.max(0, Number(d.x)));
  pin.y = Math.min(1, Math.max(0, Number(d.y)));
  const tiltInput = form.querySelector('[data-atlas-tilt-range]');
  if (tiltInput?.dataset.atlasTiltAuto === 'true') {
    delete pin.tilt;
  } else if (tiltInput) {
    const tilt = clampPinTilt(tiltInput.value);
    if (tilt !== null) pin.tilt = tilt;
  }
  pin.linkedResearch = String(d.linkedResearch || '').split(',').map((s) => s.trim()).filter(Boolean);
  pin.linkedFeatures = String(d.linkedFeatures || '').split(',').map((s) => s.trim()).filter(Boolean);
  const pos = String(d.position3d || '').split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  pin.position3d = pos.length === 3 ? pos : pin.position3d;
  applyDossierFromForm(pin, deps);
  if (oldId !== pin.id) state.selected.atlasPin = pin.id;
}

function getSelectedAtlasPin(state) {
  const pins = state.data['atlas-pins.json']?.pins || [];
  return pins.find((p) => p.id === state.selected.atlasPin) || null;
}

function renderAtlasMapBoardOnly(state, deps, handlers) {
  const boardHost = deps.$('#atlasMapBoardHost');
  if (!boardHost) return;
  renderMapBoard(boardHost, state.data, state, deps, handlers);
  bindMapBoardControls(boardHost, state, deps, handlers);
}

function bindMapBoardControls(boardHost, state, deps, handlers) {
  boardHost?.querySelectorAll('[data-atlas-set-color]').forEach((btn) => {
    btn.onclick = () => {
      state.atlasActiveColor = btn.dataset.atlasSetColor;
      renderAtlasMapBoardOnly(state, deps, handlers);
    };
  });
  boardHost?.querySelector('[data-atlas-toggle-add]')?.addEventListener('click', () => {
    applyPinFromForm(state, deps);
    state.atlasAddMode = !state.atlasAddMode;
    renderAtlasMapBoardOnly(state, deps, handlers);
  });
  boardHost?.querySelectorAll('[data-atlas-layer]').forEach((input) => {
    input.onchange = () => {
      state.atlasMapLayers[input.dataset.atlasLayer] = input.checked;
      renderAtlasMapBoardOnly(state, deps, handlers);
    };
  });
}

function bindPinDetailControls(state, deps, handlers) {
  const detailHost = deps.$('#atlasPinDetailHost');
  const pinColors = state.data['atlas-pins.json']?.pinColors || [];

  detailHost?.querySelector('[data-atlas-delete-pin]')?.addEventListener('click', () => {
    const pin = getSelectedAtlasPin(state);
    if (!pin) return;
    if (!window.confirm(`Delete pin “${pin.name}”?`)) return;
    const pins = state.data['atlas-pins.json'].pins || [];
    const index = pins.findIndex((p) => p.id === pin.id);
    if (index >= 0) pins.splice(index, 1);
    state.selected.atlasPin = pins[0]?.id || null;
    deps.markDirty('atlas-pins.json');
    syncAtlasMapUI(state, deps);
    deps.log(`Deleted pin ${pin.id}.`, 'ok');
  });

  const tiltRange = detailHost?.querySelector('[data-atlas-tilt-range]');
  const tiltDisplay = detailHost?.querySelector('[data-atlas-tilt-display]');
  const tiltReset = detailHost?.querySelector('[data-atlas-tilt-reset]');

  function applyTiltLive(value, isAuto = false) {
    const pin = getSelectedAtlasPin(state);
    if (!pin || !tiltRange) return;
    if (isAuto) {
      delete pin.tilt;
      tiltRange.dataset.atlasTiltAuto = 'true';
      const auto = defaultPinTilt(pin.id);
      tiltRange.value = auto;
      if (tiltDisplay) tiltDisplay.textContent = `${auto}°`;
      if (tiltReset) tiltReset.disabled = true;
    } else {
      delete tiltRange.dataset.atlasTiltAuto;
      const tilt = clampPinTilt(value);
      if (tilt === null) return;
      pin.tilt = tilt;
      if (tiltDisplay) tiltDisplay.textContent = `${tilt}°`;
      if (tiltReset) tiltReset.disabled = false;
    }
    deps.markDirty('atlas-pins.json');
    renderAtlasMapBoardOnly(state, deps, handlers);
    refreshAtlasPinList(state, deps);
    bindAtlasPinListHandlers(state, deps, handlers);
  }

  tiltRange?.addEventListener('input', (event) => {
    applyTiltLive(event.target.value, false);
  });

  tiltReset?.addEventListener('click', () => {
    applyTiltLive(null, true);
  });

  detailHost?.querySelector('form[data-form="atlas-pin"]')?.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  detailHost?.querySelectorAll('[data-form="atlas-pin"] input:not([data-atlas-tilt-range]), [data-form="atlas-pin"] textarea, [data-form="atlas-pin"] select').forEach((el) => {
    el.addEventListener('change', () => {
      applyPinFromForm(state, deps);
      deps.markDirty('atlas-pins.json');
      syncAtlasMapUI(state, deps);
    });
  });
}

function syncAtlasMapUI(state, deps) {
  const atlas = state.data['atlas-pins.json'] || {};
  const pins = atlas.pins || [];
  const pinColors = atlas.pinColors || [];
  if (!state.selected.atlasPin || !pins.find((p) => p.id === state.selected.atlasPin)) {
    state.selected.atlasPin = pins[0]?.id || null;
  }
  if (!state.atlasMapLayers) {
    state.atlasMapLayers = { buildings: true, paths: true, pins: true };
  }
  if (!state.atlasActiveColor) state.atlasActiveColor = 'yellow';

  const handlers = {
    onSelectPin: (pinId) => selectAtlasPin(state, deps, handlers, pinId),
    onPinMove: (pinId, x, y) => {
      const p = pins.find((item) => item.id === pinId);
      if (!p) return;
      p.x = x;
      p.y = y;
      deps.markDirty('atlas-pins.json');
      if (state.selected.atlasPin !== pinId) return;
      const xInput = deps.$('#atlasPinDetailHost [data-form="atlas-pin"] [name="x"]');
      const yInput = deps.$('#atlasPinDetailHost [data-form="atlas-pin"] [name="y"]');
      if (xInput) xInput.value = x.toFixed(4);
      if (yInput) yInput.value = y.toFixed(4);
    },
  };

  refreshAtlasPinList(state, deps);
  bindAtlasPinListHandlers(state, deps, handlers);

  const detailHost = deps.$('#atlasPinDetailHost');
  const pin = getSelectedAtlasPin(state);
  if (detailHost) {
    detailHost.innerHTML = pin ? pinDetailHtml(pin, deps, pinColors) : '<p class="hint">Select or add a pin.</p>';
    if (pin) bindAtlasPinDossier(state, deps);
    bindPinDetailControls(state, deps, handlers);
  }

  const boardHost = deps.$('#atlasMapBoardHost');
  onAddPin = (x, y, color) => {
    const idBase = slugify(`pin-${pins.length + 1}`);
    let id = idBase;
    let n = 2;
    while (pins.some((p) => p.id === id)) { id = `${idBase}-${n++}`; }
    const newPin = {
      id,
      name: 'New location',
      color,
      x,
      y,
      summary: '',
      linkedResearch: [],
      linkedFeatures: [],
      dossier: { overview: '', sections: [] },
    };
    pins.unshift(newPin);
    state.selected.atlasPin = id;
    deps.markDirty('atlas-pins.json');
    syncAtlasMapUI(state, deps);
    deps.log(`Dropped pin ${id}.`, 'ok');
  };

  renderMapBoard(boardHost, state.data, state, deps, handlers);
  bindMapBoardControls(boardHost, state, deps, handlers);

  bindAtlasPinListHandlers(state, deps, handlers);
}

export function bindAtlasMapEditor(state, deps) {
  syncAtlasMapUI(state, deps);

  deps.$('#saveAtlasPins')?.addEventListener('click', async () => {
    applyPinFromForm(state, deps);
    (state.data['atlas-pins.json'].pins || []).forEach((pin) => {
      if (pin.dossier && !featureHasDossierContent(pin, normalizeFeatureDossierRaw)) delete pin.dossier;
    });
    await deps.saveFile('atlas-pins.json', state.data['atlas-pins.json']);
    deps.log('Written to public/data/atlas-pins.json.', 'ok');
  });

  deps.$('#newAtlasPin')?.addEventListener('click', () => {
    applyPinFromForm(state, deps);
    state.atlasAddMode = true;
    syncAtlasMapUI(state, deps);
    deps.log('Add pin mode — click the map.', 'ok');
  });
}

export function initAtlasMapEditorTab(state, deps) {
  if (!state.atlasMapLayers) {
    const defaults = state.data['atlas-pins.json']?.map?.defaultLayers || { buildings: true, paths: true };
    state.atlasMapLayers = { ...defaults, pins: defaults.pins !== false };
  }
  bindAtlasMapEditor(state, deps);
}
