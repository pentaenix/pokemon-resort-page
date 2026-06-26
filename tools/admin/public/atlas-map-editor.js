import { dossierEditorHtml, bindDossierEditor, readDossierFromDom } from './feature-dossier-editor.js';
import { openAssetUploadModal } from './asset-upload.js';
import { parseFrameFilename, resolveCarouselSlideDisplay } from './frame-filename.js';
import { featureHasDossierContent } from './dossier-shared.js';
import { normalizeFeatureDossierRaw } from './feature-dossier-editor.js';
import { bindAtlasIslandPreview } from './atlas-island-preview.js';
import {
  atlasDotLinkerPanelHtml,
  bindAtlasDotLinker,
  syncAtlasDotLinker,
} from './atlas-dot-linker.js';
import {
  DEFAULT_ISLAND_VIEWPORT,
  degToRad,
  islandViewportCacheKey,
  normalizeIslandViewport,
  radToDeg,
} from '/shared/island-viewport.js';

const DEFAULT_ISLAND_DISPLAY_SIZE = 6.2;
const MIN_ISLAND_DISPLAY_SIZE = 0.5;
const MAX_ISLAND_DISPLAY_SIZE = 120;
let atlasIslandPreviewBind = null;

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
        <legend>Panel preview</legend>
        <p class="hint">Main image in the cork panel when this pin is selected (replaces the idle show-map frame).</p>
        <label class="path-input-with-upload">Image path
          <span class="dossier-path-input-row">
            <input name="coverPath" data-pin-cover-path value="${deps.esc(pin.coverImage?.path || '')}" placeholder="media/atlas/${deps.esc(pin.id)}/…">
            <button type="button" class="btn ghost small" data-pin-cover-browse>Browse</button>
            <button type="button" class="btn small" data-pin-cover-upload>Upload</button>
          </span>
        </label>
        <div class="row"><label>Panel label<input name="coverLabel" value="${deps.esc(pin.coverImage?.label || '')}" placeholder="${deps.esc(pin.name)}"></label><label>Caption<input name="coverCaption" value="${deps.esc(pin.coverImage?.caption || '')}" placeholder="Optional frame note"></label></div>
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

function normalizeAtlasCarouselItem(item, index = 0) {
  return {
    id: String(item?.id || `atlas-slide-${index + 1}`).trim(),
    title: String(item?.title || '').trim(),
    src: String(item?.src || item?.path || '').trim(),
    caption: String(item?.caption || '').trim(),
    type: item?.type === 'video' ? 'video' : 'image',
  };
}

function atlasCarouselParsedPreviewHtml(slide, esc) {
  if (!slide.src) return '<span class="hint">Upload or paste a path</span>';
  const display = resolveCarouselSlideDisplay(slide);
  const parsed = parseFrameFilename(slide.src);
  const meta = [display.episodeLine, display.timeLine].filter(Boolean).map((part, i) => {
    const cls = i === 0 && display.episodeLine === part ? 'atlas-carousel-admin-episode' : 'atlas-carousel-admin-time';
    return `<span class="atlas-carousel-admin-meta ${cls}">${esc(part)}</span>`;
  }).join('<span class="atlas-carousel-admin-meta-sep"> · </span>');
  return `${meta ? `<span class="atlas-carousel-admin-meta-row">${meta}</span>` : ''}
    ${display.title ? `<strong>${esc(display.title)}</strong>` : ''}
    ${display.description ? `<span class="hint">${esc(display.description)}</span>` : ''}
    ${!display.title && parsed.sceneTitle ? `<span class="hint">Detected title: ${esc(parsed.sceneTitle)}</span>` : ''}`;
}

function atlasCarouselRowHtml(item, index, esc) {
  const slide = normalizeAtlasCarouselItem(item, index);
  const thumb = slide.src
    ? `<img src="/${esc(slide.src.replace(/^\//, ''))}" alt="" loading="lazy" class="atlas-carousel-admin-thumb" />`
    : '';
  return `<div class="atlas-carousel-admin-row" data-atlas-carousel-row="${index}">
    <div class="atlas-carousel-admin-preview">${thumb}<div class="atlas-carousel-admin-copy" data-atlas-carousel-copy>${atlasCarouselParsedPreviewHtml(slide, esc)}</div></div>
    <div class="atlas-carousel-admin-fields">
      <label class="path-input-with-upload">Image path
        <span class="dossier-path-input-row">
          <input data-atlas-carousel-src value="${esc(slide.src)}" placeholder="media/atlas/carousel/…">
          <button type="button" class="btn ghost small" data-atlas-carousel-browse>Browse</button>
          <button type="button" class="btn small" data-atlas-carousel-upload>Upload</button>
        </span>
      </label>
      <label>Title <span class="hint">optional: auto from filename</span><input data-atlas-carousel-title value="${esc(slide.title)}" placeholder="Ima Role Model Now"></label>
      <label>Description <span class="hint">optional: auto “frame from episode…”</span><input data-atlas-carousel-caption value="${esc(slide.caption)}" placeholder="Frame from Pokémon Concierge, episode 7"></label>
      <input type="hidden" data-atlas-carousel-id value="${esc(slide.id)}">
      <button type="button" class="btn ghost small" data-atlas-carousel-remove>Remove slide</button>
    </div>
  </div>`;
}

function atlasMapMediaPanelHtml(atlas, esc) {
  const map = atlas.map || {};
  const ref = map.showReference || {};
  const carousel = Array.isArray(map.carousel) && map.carousel.length
    ? map.carousel
    : [{ id: 'atlas-slide-1', title: '', src: '', caption: '', type: 'image' }];
  return `<section class="atlas-map-media-panel panel" id="atlasMapMediaHost">
    <h3>Map carousel</h3>
    <p class="hint">Public gallery under the cork board. Filenames like <code>VS--Netflix-PokmonConciergeE7…-8'10"</code> auto-fill episode, time, and title.</p>
    <details class="atlas-map-media-ref"><summary>Idle map frame <span class="hint">(only when no pin is selected)</span></summary>
      <label>Path
        <span class="dossier-path-input-row">
          <input data-atlas-ref-path value="${esc(ref.path || '')}" placeholder="media/atlas/reference/…">
          <button type="button" class="btn ghost small" data-atlas-ref-browse>Browse</button>
          <button type="button" class="btn small" data-atlas-ref-upload>Upload</button>
        </span>
      </label>
      <div class="row"><label>Label<input data-atlas-ref-label value="${esc(ref.label || '')}"></label><label>Caption<input data-atlas-ref-caption value="${esc(ref.caption || '')}"></label></div>
    </details>
    <div class="atlas-carousel-admin-list" data-atlas-carousel-list>${carousel.map((item, index) => atlasCarouselRowHtml(item, index, esc)).join('')}</div>
    <button type="button" class="btn ghost small" data-atlas-carousel-add>Add carousel slide</button>
  </section>`;
}

function readAtlasMapMediaFromDom(deps) {
  const host = deps.$('#atlasMapMediaHost');
  if (!host) return null;
  const carousel = [...host.querySelectorAll('[data-atlas-carousel-row]')].map((row, index) => ({
    id: row.querySelector('[data-atlas-carousel-id]')?.value?.trim() || `atlas-slide-${index + 1}`,
    title: row.querySelector('[data-atlas-carousel-title]')?.value?.trim() || '',
    src: row.querySelector('[data-atlas-carousel-src]')?.value?.trim() || '',
    caption: row.querySelector('[data-atlas-carousel-caption]')?.value?.trim() || '',
    type: 'image',
  })).filter((item) => item.src);
  const refPath = host.querySelector('[data-atlas-ref-path]')?.value?.trim() || '';
  const showReference = refPath ? {
    path: refPath,
    label: host.querySelector('[data-atlas-ref-label]')?.value?.trim() || 'From the show',
    caption: host.querySelector('[data-atlas-ref-caption]')?.value?.trim() || '',
  } : null;
  return { carousel, showReference };
}

function applyAtlasMapMediaToData(state, deps) {
  const atlas = state.data['atlas-pins.json'];
  if (!atlas) return;
  const media = readAtlasMapMediaFromDom(deps);
  if (!media) return;
  if (!atlas.map) atlas.map = {};
  atlas.map.carousel = media.carousel;
  if (media.showReference) atlas.map.showReference = media.showReference;
  else delete atlas.map.showReference;
}

function refreshAtlasCarouselPreview(row, esc) {
  if (!row) return;
  const src = row.querySelector('[data-atlas-carousel-src]')?.value?.trim() || '';
  const title = row.querySelector('[data-atlas-carousel-title]')?.value?.trim() || '';
  const caption = row.querySelector('[data-atlas-carousel-caption]')?.value?.trim() || '';
  const id = row.querySelector('[data-atlas-carousel-id]')?.value?.trim() || '';
  const preview = row.querySelector('.atlas-carousel-admin-preview');
  const copy = row.querySelector('[data-atlas-carousel-copy]');
  if (!preview) return;
  const thumb = preview.querySelector('.atlas-carousel-admin-thumb');
  if (src) {
    if (thumb) thumb.src = `/${src.replace(/^\//, '')}`;
    else {
      const img = document.createElement('img');
      img.src = `/${src.replace(/^\//, '')}`;
      img.className = 'atlas-carousel-admin-thumb';
      img.loading = 'lazy';
      preview.insertBefore(img, copy);
    }
  } else if (thumb) thumb.remove();
  if (copy) {
    copy.innerHTML = atlasCarouselParsedPreviewHtml({ src, title, caption, id }, esc || ((v) => v));
  }
}

function bindAtlasMapMediaPanel(state, deps) {
  const host = deps.$('#atlasMapMediaHost');
  if (!host) return;

  const touch = () => {
    applyAtlasMapMediaToData(state, deps);
    deps.markDirty('atlas-pins.json');
  };

  host.querySelector('[data-atlas-carousel-add]')?.addEventListener('click', () => {
    applyAtlasMapMediaToData(state, deps);
    const atlas = state.data['atlas-pins.json'];
    if (!atlas.map) atlas.map = {};
    if (!Array.isArray(atlas.map.carousel)) atlas.map.carousel = [];
    atlas.map.carousel.push({
      id: `atlas-slide-${Date.now().toString().slice(-5)}`,
      title: '',
      src: '',
      caption: '',
      type: 'image',
    });
    deps.markDirty('atlas-pins.json');
    renderAtlasMapMediaPanel(state, deps);
  });

  host.querySelectorAll('[data-atlas-carousel-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('[data-atlas-carousel-row]')?.remove();
      touch();
      renderAtlasMapMediaPanel(state, deps);
    });
  });

  const esc = deps.esc || ((v) => v);
  const refreshRow = (row) => refreshAtlasCarouselPreview(row, esc);

  host.querySelectorAll('[data-atlas-carousel-src], [data-atlas-carousel-title], [data-atlas-carousel-caption]').forEach((input) => {
    input.addEventListener('input', () => {
      refreshRow(input.closest('[data-atlas-carousel-row]'));
      touch();
    });
    input.addEventListener('change', touch);
  });

  host.querySelectorAll('[data-atlas-ref-path], [data-atlas-ref-label], [data-atlas-ref-caption]').forEach((input) => {
    input.addEventListener('change', touch);
    input.addEventListener('input', touch);
  });

  const openUpload = (input, subdir = 'carousel') => {
    if (!input) return;
    openAssetUploadModal({
      esc: deps.esc,
      log: deps.log,
      folder: 'media/atlas',
      subdir,
      title: 'Upload atlas image',
      refreshAssets: deps.refreshAssets,
      onSuccess: (path) => {
        input.value = path;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        touch();
      },
    });
  };

  const openBrowse = (input, folder, subdir) => {
    if (!input || typeof deps.openAssetPickerModal !== 'function') return;
    deps.openAssetPickerModal({
      defaultFolder: subdir ? `${folder}/${subdir}` : folder,
      uploadFolder: folder,
      uploadSubdir: subdir,
      title: 'Choose image',
      onSelect: (path) => {
        input.value = path;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        refreshAtlasCarouselPreview(input.closest('[data-atlas-carousel-row]'), deps.esc);
        touch();
      },
    });
  };

  host.querySelectorAll('[data-atlas-carousel-browse]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.dossier-path-input-row')?.querySelector('[data-atlas-carousel-src]');
      openBrowse(input, 'media/atlas', 'carousel');
    });
  });

  host.querySelectorAll('[data-atlas-carousel-upload]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.dossier-path-input-row')?.querySelector('[data-atlas-carousel-src]');
      openUpload(input, 'carousel');
    });
  });

  host.querySelector('[data-atlas-ref-browse]')?.addEventListener('click', () => {
    openBrowse(host.querySelector('[data-atlas-ref-path]'), 'media/atlas', 'reference');
  });

  host.querySelector('[data-atlas-ref-upload]')?.addEventListener('click', () => {
    const input = host.querySelector('[data-atlas-ref-path]');
    openUpload(input, 'reference');
  });
}

function renderAtlasMapMediaPanel(state, deps) {
  const host = deps.$('#atlasMapMediaHost');
  if (!host) return;
  const atlas = state.data['atlas-pins.json'] || {};
  host.outerHTML = atlasMapMediaPanelHtml(atlas, deps.esc);
  bindAtlasMapMediaPanel(state, deps);
}

function islandDisplaySize(models) {
  const n = Number(models?.mainModel?.displaySize);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ISLAND_DISPLAY_SIZE;
}

function islandViewportFromModels(models) {
  return normalizeIslandViewport(models?.mainModel?.viewport);
}

function islandViewportSliderRow(label, key, value, min, max, step, format = (n) => n.toFixed(2)) {
  const id = `atlas-island-vp-${key}`;
  return `<label class="atlas-island-model-slider" for="${id}">
    <span>${label}</span>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" data-atlas-island-vp="${key}">
    <output data-atlas-island-vp-out="${key}">${format(Number(value))}</output>
  </label>`;
}

function atlasIslandViewportControlsHtml(viewport) {
  const v = normalizeIslandViewport(viewport);
  return `<details class="atlas-island-viewport-group" open>
    <summary>Framing</summary>
    <div class="atlas-island-viewport-grid">
      ${islandViewportSliderRow('Vertical framing', 'targetLift', v.targetLift, -0.1, 0.55, 0.02)}
      ${islandViewportSliderRow('Zoom padding', 'padding', v.padding, 0.55, 1.35, 0.02)}
      ${islandViewportSliderRow('Camera height', 'cameraHeight', v.cameraHeight, 0.05, 0.85, 0.02)}
      ${islandViewportSliderRow('Camera distance', 'cameraDistance', v.cameraDistance, 0.35, 1.6, 0.02)}
    </div>
  </details>
  <details class="atlas-island-viewport-group" open>
    <summary>Position</summary>
    <div class="atlas-island-viewport-grid">
      ${islandViewportSliderRow('Move left / right', 'offsetX', v.offsetX, -5, 5, 0.1)}
      ${islandViewportSliderRow('Move up / down', 'offsetY', v.offsetY, -3, 5, 0.1)}
      ${islandViewportSliderRow('Move nearer / farther', 'offsetZ', v.offsetZ, -5, 5, 0.1)}
    </div>
  </details>
  <details class="atlas-island-viewport-group" open>
    <summary>Tilt and rotation</summary>
    <div class="atlas-island-viewport-grid">
      ${islandViewportSliderRow('Pitch (deg)', 'pitchDeg', radToDeg(v.pitch), -35, 45, 1, (n) => `${n.toFixed(0)}°`)}
      ${islandViewportSliderRow('Start yaw (deg)', 'yawDeg', radToDeg(v.yaw), -180, 180, 2, (n) => `${n.toFixed(0)}°`)}
    </div>
  </details>
  <details class="atlas-island-viewport-group" open>
    <summary>Lighting</summary>
    <div class="atlas-island-viewport-grid">
      ${islandViewportSliderRow('Sky fill', 'hemiIntensity', v.hemiIntensity, 0, 4, 0.1)}
      ${islandViewportSliderRow('Key light', 'keyIntensity', v.keyIntensity, 0, 4, 0.1)}
      ${islandViewportSliderRow('Fill light', 'fillIntensity', v.fillIntensity, 0, 3, 0.1)}
      ${islandViewportSliderRow('Exposure', 'exposure', v.exposure, 0.25, 2.5, 0.05)}
      ${islandViewportSliderRow('Key X', 'keyX', v.keyX, -16, 16, 0.5)}
      ${islandViewportSliderRow('Key Y', 'keyY', v.keyY, -2, 20, 0.5)}
      ${islandViewportSliderRow('Key Z', 'keyZ', v.keyZ, -16, 16, 0.5)}
    </div>
  </details>`;
}

function readIslandViewportFromDom(panel) {
  const viewport = { ...DEFAULT_ISLAND_VIEWPORT };
  panel?.querySelectorAll('[data-atlas-island-vp]').forEach((input) => {
    const key = input.dataset.atlasIslandVp;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    if (key === 'pitchDeg') viewport.pitch = degToRad(value);
    else if (key === 'yawDeg') viewport.yaw = degToRad(value);
    else if (key in viewport) viewport[key] = value;
  });
  return normalizeIslandViewport(viewport);
}

function atlasIslandModelPanelHtml(models, esc) {
  const main = models?.mainModel || {};
  const file = main.file || '';
  const displaySize = islandDisplaySize(models);
  const viewport = islandViewportFromModels(models);
  const fileLabel = file ? file.split('/').pop() : 'No model uploaded';
  return `<section class="panel atlas-island-model-panel" id="atlasIslandModelPanel">
    <div class="atlas-island-model-head">
      <div>
        <h3>Island 3D model</h3>
        <p class="hint">Replacing removes other .glb files in <code>media/models/island/</code>.</p>
      </div>
      <button type="button" class="btn" id="saveAtlasIslandModel">Save island model</button>
    </div>
    <div class="atlas-island-model-file-row">
      <label class="btn ghost atlas-island-model-replace">
        Replace .glb
        <input type="file" accept=".glb,model/gltf-binary" data-atlas-island-file hidden>
      </label>
      <span class="atlas-island-model-file" data-atlas-island-file-label>${esc(fileLabel)}</span>
    </div>
    <p class="atlas-island-model-status" data-atlas-island-status role="status"></p>
    <div class="atlas-island-model-studio">
      <div class="atlas-island-model-preview-wrap">
        <p class="hint atlas-island-model-preview-label">Live preview</p>
        <div class="atlas-card atlas-card--3d">
          <div class="island-stage-wrap island-stage-wrap--atlas">
            <div class="island-stage island-stage--atlas" data-atlas-island-viewport></div>
            <span class="island-stage-hint soft-label" data-atlas-island-hint>Island model in progress</span>
          </div>
        </div>
      </div>
      <aside class="atlas-island-model-controls-block">
        <label class="atlas-island-model-size">
          <span>Display size</span>
          <input type="range" min="${MIN_ISLAND_DISPLAY_SIZE}" max="${MAX_ISLAND_DISPLAY_SIZE}" step="0.5" value="${displaySize}" data-atlas-island-size>
          <output data-atlas-island-size-val>${displaySize.toFixed(1)}</output>
        </label>
        <p class="hint">Sliders update the preview immediately. Save when ready to publish on the public Atlas page.</p>
        <div class="atlas-island-viewport-controls" data-atlas-island-viewport-controls>
          ${atlasIslandViewportControlsHtml(viewport)}
        </div>
      </aside>
    </div>
  </section>`;
}

function applyIslandModelFromDom(state, deps, panel = deps.$('#atlasIslandModelPanel')) {
  const models = state.data['models.json'];
  if (!models?.mainModel || !panel) return;
  let dirty = false;
  const sizeInput = panel.querySelector('[data-atlas-island-size]');
  const size = Number(sizeInput?.value);
  if (Number.isFinite(size) && size > 0 && models.mainModel.displaySize !== size) {
    models.mainModel.displaySize = size;
    dirty = true;
  }
  const viewport = readIslandViewportFromDom(panel);
  const beforeViewport = JSON.stringify(normalizeIslandViewport(models.mainModel.viewport));
  const nextViewport = JSON.stringify(viewport);
  if (beforeViewport !== nextViewport) {
    models.mainModel.viewport = viewport;
    dirty = true;
  }
  if (dirty) deps.markDirty('models.json');
  return viewport;
}

function updateAtlasIslandPreviewLive(state, deps, panel) {
  const viewport = applyIslandModelFromDom(state, deps, panel) || readIslandViewportFromDom(panel);
  const models = state.data['models.json'] || {};
  const displaySize = islandDisplaySize(models);
  if (atlasIslandPreviewBind?.setViewport) {
    atlasIslandPreviewBind.setDisplaySize(displaySize);
    atlasIslandPreviewBind.setViewport(viewport);
    if (panel) {
      panel.dataset.previewKey = islandViewportCacheKey(models.mainModel?.file, displaySize, viewport);
    }
    return;
  }
  refreshAtlasIslandPreview(state, deps, { force: true });
}

function setAtlasIslandStatus(panel, message, tone = '') {
  const el = panel?.querySelector('[data-atlas-island-status]');
  if (!el) return;
  el.textContent = message || '';
  el.className = `atlas-island-model-status${tone ? ` atlas-island-model-status--${tone}` : ''}`;
}

async function refreshAtlasIslandPreview(state, deps, { force = false } = {}) {
  const panel = deps.$('#atlasIslandModelPanel');
  const host = panel?.querySelector('[data-atlas-island-viewport]');
  const hintEl = panel?.querySelector('[data-atlas-island-hint]');
  if (!host) return;

  const models = state.data['models.json'] || {};
  const file = models.mainModel?.file;
  const displaySize = islandDisplaySize(models);
  const viewport = islandViewportFromModels(models);
  const cacheKey = islandViewportCacheKey(file, displaySize, viewport);
  if (!force && panel.dataset.previewKey === cacheKey && atlasIslandPreviewBind) return;
  panel.dataset.previewKey = cacheKey;

  if (atlasIslandPreviewBind?.dispose) {
    atlasIslandPreviewBind.dispose();
    atlasIslandPreviewBind = null;
  }

  const onHint = (text) => {
    if (hintEl) hintEl.textContent = text;
  };

  const url = file ? `/${file}?_=${Date.now()}` : null;
  try {
    atlasIslandPreviewBind = bindAtlasIslandPreview(host, {
      url,
      displaySize,
      viewport,
      onHint,
    });
  } catch (error) {
    onHint('Could not load model');
    setAtlasIslandStatus(panel, error.message, 'error');
  }
}

async function uploadAtlasIslandModel(file, state, deps, panel) {
  const isGlb = /\.glb$/i.test(file.name) || file.type === 'model/gltf-binary';
  if (!isGlb) {
    setAtlasIslandStatus(panel, 'Choose a .glb file.', 'error');
    deps.log('Island model must be a .glb file.', 'error');
    return;
  }

  setAtlasIslandStatus(panel, `Uploading ${file.name}…`, 'busy');
  deps.log(`Uploading ${file.name}…`, 'ok');

  try {
    const body = new FormData();
    body.append('file', file, file.name || 'island.glb');
    const resp = await fetch('/api/atlas/island-model/replace', { method: 'POST', body });
    const raw = await resp.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(raw.trim().slice(0, 180) || `Upload failed (${resp.status})`);
    }
    if (!resp.ok || !data.ok) {
      if (resp.status === 404) {
        throw new Error('Island upload API missing — restart with: npm run admin');
      }
      throw new Error(data.error || `Upload failed (${resp.status})`);
    }

    const models = state.data['models.json'];
    if (!models.mainModel) models.mainModel = {};
    models.mainModel.file = data.path;
    deps.markDirty('models.json');

    const label = panel.querySelector('[data-atlas-island-file-label]');
    if (label) label.textContent = data.path.split('/').pop();
    setAtlasIslandStatus(panel, `Replaced island model (${Math.round(data.bytes / 1024)} KB). Save when ready.`, 'ok');
    await refreshAtlasIslandPreview(state, deps, { force: true });
    deps.log(`Island model replaced → ${data.path}`, 'ok');
  } catch (error) {
    setAtlasIslandStatus(panel, error.message || 'Upload failed.', 'error');
    deps.log(error.message || 'Island model upload failed.', 'error');
  }
}

function bindAtlasIslandModelPanel(state, deps) {
  const panel = deps.$('#atlasIslandModelPanel');
  if (!panel) return;

  if (!state.atlasIslandPanelBound) {
    state.atlasIslandPanelBound = true;

    document.addEventListener('input', (event) => {
      const livePanel = deps.$('#atlasIslandModelPanel');
      if (!livePanel || !livePanel.contains(event.target)) return;

      const sizeInput = event.target.closest('[data-atlas-island-size]');
      if (sizeInput) {
        const sizeOut = livePanel.querySelector('[data-atlas-island-size-val]');
        const size = Number(sizeInput.value);
        if (sizeOut) sizeOut.textContent = size.toFixed(1);
        updateAtlasIslandPreviewLive(state, deps, livePanel);
        return;
      }

      const vpInput = event.target.closest('[data-atlas-island-vp]');
      if (!vpInput) return;
      const key = vpInput.dataset.atlasIslandVp;
      const value = Number(vpInput.value);
      const out = livePanel.querySelector(`[data-atlas-island-vp-out="${key}"]`);
      if (out) {
        out.textContent = key.endsWith('Deg')
          ? `${value.toFixed(key === 'yawDeg' ? 0 : 0)}°`
          : value.toFixed(2);
      }
      updateAtlasIslandPreviewLive(state, deps, livePanel);
    });

    document.addEventListener('change', (event) => {
      const livePanel = deps.$('#atlasIslandModelPanel');
      if (!livePanel || !livePanel.contains(event.target)) return;
      const input = event.target.closest('[data-atlas-island-file]');
      if (!input || !input.files?.length) return;
      const picked = input.files[0];
      uploadAtlasIslandModel(picked, state, deps, livePanel).finally(() => {
        input.value = '';
      });
    });

    document.addEventListener('click', async (event) => {
      const btn = event.target.closest('#saveAtlasIslandModel');
      if (!btn) return;
      const livePanel = deps.$('#atlasIslandModelPanel');
      applyIslandModelFromDom(state, deps, livePanel);
      await deps.saveFile('models.json', state.data['models.json']);
      setAtlasIslandStatus(livePanel, 'Saved to public/data/models.json.', 'ok');
      deps.log('Written to public/data/models.json.', 'ok');
    });
  }

  refreshAtlasIslandPreview(state, deps);
}

export function atlasMapEditorHtml(state, esc, dossierDeps) {
  const atlas = state.data['atlas-pins.json'] || { pins: [] };
  const pins = atlas.pins || [];
  const id = state.selected.atlasPin || pins[0]?.id;
  state.selected.atlasPin = id;
  const pin = pins.find((p) => p.id === id);
  const pinsDirty = state.dirty.has('atlas-pins.json');
  const modelsDirty = state.dirty.has('models.json');
  const dirty = pinsDirty || modelsDirty;
  const dirtyHint = dirty
    ? `<p class="hint feature-unsaved"><strong>Unsaved changes</strong>${pinsDirty ? ' · atlas pins' : ''}${modelsDirty ? ' · island model' : ''}</p>`
    : '<p class="hint feature-disk-ok">Atlas pins and island model saved</p>';
  return `<section class="toolbar feature-toolbar atlas-map-toolbar">
    <div><h2>Island Atlas</h2><p>Cork-board map for show research: drag pins, tune tilt, toggle layers, and attach dossiers.</p>
      ${dirtyHint}
    </div>
    <div class="actions">
      <button type="button" class="btn ghost" id="newAtlasPin">Add pin</button>
      <button type="button" class="btn" id="saveAtlasPins">Save atlas</button>
    </div>
  </section>
  <section class="atlas-map-editor-layout">
    <div class="atlas-map-editor-main">
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
    </div>
    <div class="atlas-map-editor-footer">
      ${atlasMapMediaPanelHtml(atlas, esc)}
      ${atlasIslandModelPanelHtml(state.data['models.json'] || {}, esc)}
      ${atlasDotLinkerPanelHtml(state)}
    </div>
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
  const coverPath = String(d.coverPath || form.querySelector('[data-pin-cover-path]')?.value || '').trim();
  if (coverPath) {
    pin.coverImage = {
      path: coverPath,
      label: String(d.coverLabel || '').trim(),
      caption: String(d.coverCaption || '').trim(),
    };
  } else {
    delete pin.coverImage;
  }
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

  detailHost?.querySelector('[data-pin-cover-browse]')?.addEventListener('click', () => {
    const pin = getSelectedAtlasPin(state);
    const input = detailHost?.querySelector('[data-pin-cover-path]');
    if (!input || typeof deps.openAssetPickerModal !== 'function') return;
    deps.openAssetPickerModal({
      defaultFolder: pin?.id ? `media/atlas/${pin.id}` : 'media/atlas',
      uploadFolder: 'media/atlas',
      uploadSubdir: pin?.id || '',
      title: 'Choose pin panel image',
      onSelect: (path) => {
        input.value = path;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        applyPinFromForm(state, deps);
        deps.markDirty('atlas-pins.json');
      },
    });
  });

  detailHost?.querySelector('[data-pin-cover-upload]')?.addEventListener('click', () => {
    const pin = getSelectedAtlasPin(state);
    const input = detailHost?.querySelector('[data-pin-cover-path]');
    if (!input) return;
    openAssetUploadModal({
      esc: deps.esc,
      log: deps.log,
      folder: 'media/atlas',
      subdir: pin?.id || '',
      title: 'Upload pin panel image',
      refreshAssets: deps.refreshAssets,
      onSuccess: (path) => {
        input.value = path;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        applyPinFromForm(state, deps);
        deps.markDirty('atlas-pins.json');
      },
    });
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
  bindAtlasMapMediaPanel(state, deps);

  bindAtlasPinListHandlers(state, deps, handlers);
  syncAtlasDotLinker(state, deps);
}

export function bindAtlasMapEditor(state, deps) {
  syncAtlasMapUI(state, deps);
  bindAtlasIslandModelPanel(state, deps);
  bindAtlasDotLinker(state, deps);

  if (state.atlasEditorToolbarBound) return;
  state.atlasEditorToolbarBound = true;

  deps.$('#saveAtlasPins')?.addEventListener('click', async () => {
    applyPinFromForm(state, deps);
    applyAtlasMapMediaToData(state, deps);
    applyIslandModelFromDom(state, deps);
    (state.data['atlas-pins.json'].pins || []).forEach((pin) => {
      if (pin.dossier && !featureHasDossierContent(pin, normalizeFeatureDossierRaw)) delete pin.dossier;
    });
    if (state.dirty.has('atlas-pins.json')) {
      await deps.saveFile('atlas-pins.json', state.data['atlas-pins.json']);
      deps.log('Written to public/data/atlas-pins.json.', 'ok');
    }
    if (state.dirty.has('models.json')) {
      await deps.saveFile('models.json', state.data['models.json']);
      deps.log('Written to public/data/models.json.', 'ok');
    }
    if (!state.dirty.has('atlas-pins.json') && !state.dirty.has('models.json')) {
      deps.log('Nothing to save.', 'ok');
    }
  });

  deps.$('#newAtlasPin')?.addEventListener('click', () => {
    applyPinFromForm(state, deps);
    state.atlasAddMode = true;
    syncAtlasMapUI(state, deps);
    deps.log('Add pin mode: click the map.', 'ok');
  });
}

export function initAtlasMapEditorTab(state, deps) {
  if (!state.atlasMapLayers) {
    const defaults = state.data['atlas-pins.json']?.map?.defaultLayers || { buildings: true, paths: true };
    state.atlasMapLayers = { ...defaults, pins: defaults.pins !== false };
  }
  bindAtlasMapEditor(state, deps);
}
