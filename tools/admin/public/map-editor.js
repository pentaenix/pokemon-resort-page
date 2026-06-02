import {
  SPECIAL,
  SPECIAL_LABELS,
  SPECIAL_MAX,
  RAMP_PRESETS,
  cornerHeightsForTile,
  effectiveSpecial,
} from './ramp-specials.js';
import {
  bindGlbWebGLViewport,
  clearModelCache,
  closeModelViewport,
  renderGlbThumbnail,
} from './model-viewer.js';
import { mountMap3DView } from './map-3d-view.js';

const LAYER_META = {
  height: { label: 'Height', min: 0, max: 255, default: 0 },
  special: { label: 'Special', min: 0, max: SPECIAL_MAX, default: 0 },
  collision: { label: 'Collision', min: 0, max: 1, default: 0 },
};

const TILE_SIZE = 16;

const BRUSHES = [
  { id: 'height', label: 'Height', layer: 'height', color: '#74d4e5' },
  { id: 'ramp', label: 'Ramp', layer: 'special', color: '#fbbf24' },
  { id: 'collision', label: 'Blocked', layer: 'collision', color: '#ef6461' },
  { id: 'spawn', label: 'Spawn', layer: null, color: '#f59e0b' },
];

const TOOLS = [
  { id: 'paint', label: 'Paint', title: 'Paint with the active brush' },
  { id: 'area', label: 'Area', title: 'Click and drag a rectangle' },
  { id: 'line', label: 'Line', title: 'Click start point, drag to end' },
  { id: 'clear', label: 'Clear', title: 'Reset height, ramps, and collision on cells (not spawn)' },
  { id: 'fill', label: 'Fill', title: 'Flood fill matching cells' },
  { id: 'raise', label: 'Raise', title: 'Raise height by 1' },
  { id: 'lower', label: 'Lower', title: 'Lower height by 1' },
  { id: 'eyedropper', label: 'Pick', title: 'Pick value from a cell' },
];

function brushLayer(brushId) {
  return BRUSHES.find((b) => b.id === brushId)?.layer;
}

function sanitizeModelId(raw) {
  const id = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return id;
}

function isValidModelId(id) {
  return Boolean(id) && id.length <= 64 && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id);
}

function catalogEntry(editor, modelId) {
  return (editor.modelCatalog || []).find((c) => c.id === modelId);
}

function catalogFiltered(editor) {
  const q = (editor.modelSearch || '').trim().toLowerCase();
  const list = editor.modelCatalog || [];
  if (!q) return list;
  return list.filter((m) => {
    const name = (m.displayName || m.id).toLowerCase();
    return name.includes(q) || m.id.toLowerCase().includes(q);
  });
}

function placementDefaults(editor, modelOrId) {
  const meta = typeof modelOrId === 'string' ? catalogEntry(editor, modelOrId) : modelOrId;
  return {
    yawDeg: Number(meta?.defaultYawDeg) || 0,
    scale: Math.max(0.05, Math.min(20, Number(meta?.defaultScale) || 1)),
  };
}

function findPlacementAt(editor, tx, ty) {
  const models = editor.map?.models || [];
  for (let i = models.length - 1; i >= 0; i -= 1) {
    const fpc = placedModelFootprint(editor, models[i]);
    if (tx >= fpc.tlx && tx < fpc.tlx + fpc.fw && ty >= fpc.tly && ty < fpc.tly + fpc.fd) return i;
  }
  return null;
}

function movePlacementToTile(editor, index, tx, ty) {
  const mdl = editor.map?.models?.[index];
  if (!mdl || !editor.map) return;
  const ts = editor.map.grid?.tileSize || TILE_SIZE;
  const hv = Math.max(0, editor.map.terrain?.height?.[ty]?.[tx] ?? 0);
  mdl.position = [(tx + 0.5) * ts, hv * ts, (ty + 0.5) * ts];
  editor.dirty = true;
}

function selectedPlacement(editor) {
  const i = editor.selectedPlacementIndex;
  if (i == null || i < 0 || !editor.map?.models?.[i]) return null;
  return editor.map.models[i];
}

function propToolRailHtml(editor, esc) {
  if (!editor.map) return '';
  const sel = selectedPlacement(editor);
  const selIdx = editor.selectedPlacementIndex;
  const activeId = editor.placeModelId || '';
  const meta = activeId ? catalogEntry(editor, activeId) : null;
  const scale = sel ? (Number(sel.scale) || 1) : (meta?.defaultScale ?? 1);
  const yaw = sel ? (Math.round(sel.yawDeg || 0)) : (Math.round(meta?.defaultYawDeg || 0));
  return `<div class="tool-group map-prop-tools" role="group" aria-label="3D props">
    <button type="button" class="tool-btn map-prop-tool ${!editor.propTool ? 'active' : ''}" data-prop-tool="terrain" title="Terrain brushes">🗺</button>
    <button type="button" class="tool-btn map-prop-tool ${editor.propTool === 'select' ? 'active' : ''}" data-prop-tool="select" title="Select and drag placed props">◎</button>
    <button type="button" class="tool-btn map-prop-tool ${editor.propTool === 'place' ? 'active' : ''}" data-prop-tool="place" title="Place props on the grid" ${activeId ? '' : 'disabled'}>＋</button>
    ${editor.propTool === 'select' && selIdx != null ? `
      <span class="map-prop-tool-sep"></span>
      <button type="button" class="tool-btn map-prop-action" data-placement-rotate="-90" title="Rotate −90°">⟲</button>
      <button type="button" class="tool-btn map-prop-action" data-placement-rotate="90" title="Rotate +90°">⟳</button>
      <label class="map-prop-scale" title="Scale selected prop">
        <span>Scale</span>
        <input type="range" id="mapPlacementScale" min="0.25" max="4" step="0.05" value="${scale}">
        <strong id="mapPlacementScaleLabel">${scale.toFixed(2)}×</strong>
      </label>
      <button type="button" class="tool-btn map-prop-action map-prop-action-del" data-placement-delete title="Remove selected prop">✕</button>
    ` : ''}
    ${editor.propTool === 'place' && activeId ? `<span class="map-prop-active-chip" title="Placing from catalog">${esc(meta?.displayName || activeId)}</span>` : ''}
    ${editor.propTool === 'select' && sel ? `<span class="map-prop-active-chip">${esc(sel.id)} · ${yaw}° · ×${scale.toFixed(2)}</span>` : ''}
  </div>`;
}

const PREVIEW_TOP_A = [116, 156, 190];
const PREVIEW_TOP_B = [125, 166, 200];
const PREVIEW_WALL_NS = [88, 117, 145];
const PREVIEW_WALL_EW = [80, 108, 136];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cellValue(map, layer, x, y) {
  return map.terrain[layer]?.[y]?.[x] ?? 0;
}

function setCell(map, layer, x, y, value) {
  const meta = LAYER_META[layer];
  map.terrain[layer][y][x] = clamp(value, meta.min, meta.max);
}

function clearTerrainCell(map, x, y) {
  if (!inBounds(map, x, y)) return;
  setCell(map, 'height', x, y, 0);
  setCell(map, 'special', x, y, 0);
  setCell(map, 'collision', x, y, 0);
}

function inBounds(map, x, y) {
  const w = map.grid.width;
  const h = map.grid.height;
  return x >= 0 && y >= 0 && x < w && y < h;
}

function heightColor(v) {
  const t = clamp(v, 0, 12) / 12;
  const r = Math.round(180 + t * 40);
  const g = Math.round(220 - t * 70);
  const b = Math.round(170 - t * 50);
  return `rgb(${r},${g},${b})`;
}

function specialColor(v) {
  const palette = [
    '#e2e8f0', '#fde68a', '#60a5fa', '#34d399', '#f472b6', '#a78bfa',
    '#fb923c', '#f97316', '#fdba74', '#fcd34d', '#86efac', '#4ade80',
    '#22d3ee', '#38bdf8',
  ];
  return palette[v] || '#94a3b8';
}

function collisionColor(v) {
  return v ? 'rgba(239,100,97,.55)' : 'rgba(255,255,255,.35)';
}

function unifiedCellStyle(map, x, y, showValues) {
  const hv = cellValue(map, 'height', x, y);
  const special = cellValue(map, 'special', x, y);
  const blocked = cellValue(map, 'collision', x, y);
  const spawn = map.player?.spawnTile;
  const isSpawn = spawn && spawn[0] === x && spawn[1] === y;
  const eff = effectiveSpecial(special, map.terrain.height, map.grid.width, map.grid.height, x, y);
  const rampLabel = special > 0 ? (special === SPECIAL.AUTO && eff >= 2
    ? `Auto → ${SPECIAL_LABELS[eff]}`
    : SPECIAL_LABELS[special] || '') : '';
  return {
    bg: heightColor(hv),
    isSpawn,
    blocked,
    hv,
    special,
    rampLabel,
    showValues,
  };
}

function cellsInRect(x0, y0, x1, y1) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const out = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) out.push([x, y]);
  }
  return out;
}

function cellsOnLine(x0, y0, x1, y1) {
  const out = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return out;
}

function floodFill(map, layer, x, y, target, replacement) {
  if (target === replacement) return;
  const w = map.grid.width;
  const h = map.grid.height;
  const stack = [[x, y]];
  const seen = new Set();
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const key = `${cx},${cy}`;
    if (seen.has(key) || !inBounds(map, cx, cy)) continue;
    if (cellValue(map, layer, cx, cy) !== target) continue;
    seen.add(key);
    setCell(map, layer, cx, cy, replacement);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

function applyBrush(map, editor, x, y) {
  const size = editor.brushSize;
  const half = Math.floor(size / 2);
  for (let dy = -half; dy <= half; dy += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      const tx = x + dx;
      const ty = y + dy;
      if (!inBounds(map, tx, ty)) continue;
      applyToolAt(map, editor, tx, ty);
    }
  }
}

function activeBrushValue(editor) {
  const layer = brushLayer(editor.brush);
  if (!layer) return 0;
  return editor.values[editor.brush] ?? LAYER_META[layer].default;
}

function applyToolAt(map, editor, x, y) {
  const brush = editor.brush;
  const layer = brushLayer(brush);
  const tool = editor.tool;
  if (brush === 'spawn' || tool === 'spawn') {
    map.player.spawnTile = [x, y];
    return;
  }
  if (!layer) return;
  if (tool === 'eyedropper') {
    editor.values[brush] = cellValue(map, layer, x, y);
    editor.tool = 'paint';
    return;
  }
  if (tool === 'fill') {
    const target = cellValue(map, layer, x, y);
    floodFill(map, layer, x, y, target, activeBrushValue(editor));
    return;
  }
  if (tool === 'raise' || tool === 'lower') {
    if (layer !== 'height') return;
    const delta = tool === 'raise' ? 1 : -1;
    setCell(map, layer, x, y, cellValue(map, layer, x, y) + delta);
    return;
  }
  if (tool === 'clear') {
    clearTerrainCell(map, x, y);
    return;
  }
  setCell(map, layer, x, y, activeBrushValue(editor));
}

function applyToolToCells(map, editor, cells) {
  const unique = new Map();
  for (const [x, y] of cells) {
    if (!inBounds(map, x, y)) continue;
    unique.set(`${x},${y}`, [x, y]);
  }
  for (const [x, y] of unique.values()) applyToolAt(map, editor, x, y);
}

function previewCellsForDrag(editor) {
  if (!editor.dragStart || !editor.dragEnd) return [];
  const [x0, y0] = editor.dragStart;
  const [x1, y1] = editor.dragEnd;
  if (editor.tool === 'line') return cellsOnLine(x0, y0, x1, y1);
  if (editor.tool === 'area') return cellsInRect(x0, y0, x1, y1);
  return [];
}

function updateDragPreview(editor) {
  const grid = document.querySelector('#mapPaintGrid');
  if (!grid) return;
  const cells = previewCellsForDrag(editor);
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  grid.querySelectorAll('[data-cell]').forEach((btn) => {
    btn.classList.toggle('map-cell-preview', set.has(btn.dataset.cell));
  });
}

function syncPreviewCamFromDraw(editor, cam) {
  editor.previewCam.panX = cam.panX;
  editor.previewCam.panY = cam.panY;
  editor.previewCam.zoom = cam.zoom;
  if (cam.refit === false) editor.previewCam.refit = false;
}

function previewModalViewSize(editor) {
  const body = document.querySelector('#mapPreviewPanSurface');
  const fallbackW = (editor.previewSize?.w || 504) - 16;
  const fallbackH = (editor.previewSize?.h || 400) - 88;
  return {
    viewW: Math.max(160, Math.round(body?.clientWidth || fallbackW)),
    viewH: Math.max(140, Math.round(body?.clientHeight || fallbackH)),
  };
}

function refreshMapPreview(state) {
  const editor = ensureMapEditorState(state);
  if (!editor.map) return;
  const dock = document.querySelector('#mapPreviewCanvasDock');
  if (dock) drawMapPreview(dock, editor.map, { fit: true }, { editor, state });
  if (editor.previewOpen) {
    const canvas = document.querySelector('#mapPreviewCanvas');
    if (canvas) {
      const { viewW, viewH } = previewModalViewSize(editor);
      const cam = { ...editor.previewCam, viewW, viewH };
      drawMapPreview(canvas, editor.map, cam, { editor, state });
      syncPreviewCamFromDraw(editor, cam);
    }
  }
}

function applyPreviewZoom(editor, state, factor) {
  editor.previewCam.zoom = clamp((editor.previewCam.zoom || 1) * factor, 0.15, 5);
  editor.previewCam.refit = false;
  refreshMapPreview(state);
}

const PREVIEW_CAM_DEFAULT = { panX: 0, panY: 0, zoom: 1, yaw: -0.78, pitch: 0.58 };

function createPreviewProjector(map, cam = {}) {
  const w = map.grid.width;
  const h = map.grid.height;
  const centerX = w * 0.5;
  const centerZ = h * 0.5;
  const yaw = cam.yaw ?? PREVIEW_CAM_DEFAULT.yaw;
  const pitch = clamp(cam.pitch ?? PREVIEW_CAM_DEFAULT.pitch, 0.22, 1.2);
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const isoX = 0.52 + pitch * 0.12;
  const isoZ = 0.26 + pitch * 0.1;
  const heightScale = 0.32 + pitch * 0.14;
  const pad = 24;
  const originX = pad + h * TILE_SIZE * isoX;
  const originY = pad + 36;

  const project = (x, z, y) => {
    const wx = (x - centerX) * TILE_SIZE;
    const wz = (z - centerZ) * TILE_SIZE;
    const rx = wx * cosY - wz * sinY;
    const rz = wx * sinY + wz * cosY;
    return {
      sx: originX + (rx - rz) * isoX,
      sy: originY + (rx + rz) * isoZ - y * heightScale,
      depth: rx + rz - y * 0.002,
    };
  };

  return { project, originX, originY };
}

function measurePreviewExtents(map, cam) {
  const { project } = createPreviewProjector(map, cam);
  const heights = map.terrain.height;
  const h = map.grid.height;
  const w = map.grid.width;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let z = 0; z < h; z += 1) {
    for (let x = 0; x < w; x += 1) {
      const hv = heights?.[z]?.[x] ?? 0;
      const y = Math.max(0, hv) * TILE_SIZE;
      for (const [tx, tz] of [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]]) {
        const p = project(tx, tz, y);
        minX = Math.min(minX, p.sx);
        maxX = Math.max(maxX, p.sx);
        minY = Math.min(minY, p.sy);
        maxY = Math.max(maxY, p.sy);
      }
    }
  }
  return {
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    minX,
    minY,
  };
}

function pushFace(bucket, pts, fill) {
  const depth = pts.reduce((s, p) => s + (p.depth ?? p.sy), 0) / pts.length;
  bucket.push({ depth, pts, fill });
}

function buildPreviewScene(map) {
  const w = map.grid.width;
  const h = map.grid.height;
  const heights = map.terrain.height;
  const specials = map.terrain.special;
  const tileH = (tx, ty) => heights?.[ty]?.[tx] ?? 0;
  const tileSpecial = (tx, ty) => specials?.[ty]?.[tx] ?? 0;
  const inBounds = (tx, ty) => tx >= 0 && tx < w && ty >= 0 && ty < h;
  const cornerHeights = (tx, ty) => cornerHeightsForTile(
    tileSpecial(tx, ty),
    heights,
    w,
    h,
    tx,
    ty,
    TILE_SIZE,
  );
  return { w, h, tileH, tileSpecial, inBounds, cornerHeights };
}

function drawSortedFaces(ctx, faces, strokeTops = false) {
  faces.sort((a, b) => a.depth - b.depth);
  for (const face of faces) {
    ctx.beginPath();
    ctx.moveTo(face.pts[0].sx, face.pts[0].sy);
    for (let i = 1; i < 4; i += 1) ctx.lineTo(face.pts[i].sx, face.pts[i].sy);
    ctx.closePath();
    ctx.fillStyle = face.fill;
    ctx.fill();
    if (strokeTops) {
      ctx.strokeStyle = 'rgba(102,138,170,.35)';
      ctx.stroke();
    }
  }
}

// Top-down roof snapshots for the 2D placement view. Rendered near-vertical (pitch≈88°)
// so each prop reads as its roof/top, cached per id+hash and decoded to an Image for fast
// canvas compositing. Returns the Image when ready, else kicks off a render and returns null.
const modelTopThumbCache = new Map();
function roofThumbForModel(model, onReady) {
  if (!model) return null;
  const key = `${model.id}|${model.modelHash || ''}`;
  const entry = modelTopThumbCache.get(key);
  if (entry instanceof Image) return entry;
  if (entry === 'pending') return null;
  modelTopThumbCache.set(key, 'pending');
  renderGlbThumbnail(modelAssetUrl(model.id, model), { width: 128, height: 128, yaw: 0, pitch: 88, zoomFactor: 1 })
    .then((dataUrl) => {
      const img = new Image();
      img.onload = () => { modelTopThumbCache.set(key, img); onReady?.(); };
      img.onerror = () => { modelTopThumbCache.delete(key); };
      img.src = dataUrl;
    })
    .catch(() => { modelTopThumbCache.delete(key); });
  return null;
}

// Tile-space footprint of a placed prop: catalog w×d (swapped for 90/270 yaw), centered on
// the tile that holds the model's origin. Used to highlight the cells it occupies and to
// position the roof overlay on the 2D grid.
function placedModelFootprint(editor, mdl) {
  const ts = editor.map?.grid?.tileSize || TILE_SIZE;
  const meta = (editor.modelCatalog || []).find((c) => c.id === mdl.id);
  const fp = meta?.footprintTiles || { w: 1, d: 1 };
  const swap = Math.abs(Math.round((mdl.yawDeg || 0) / 90)) % 2 !== 0;
  const fw = Math.max(1, swap ? fp.d : fp.w);
  const fd = Math.max(1, swap ? fp.w : fp.d);
  const ox = Math.floor((mdl.position?.[0] ?? 0) / ts);
  const oy = Math.floor((mdl.position?.[2] ?? 0) / ts);
  return { meta, fw, fd, ox, oy, tlx: ox - Math.floor((fw - 1) / 2), tly: oy - Math.floor((fd - 1) / 2) };
}

// Draw roof/top snapshots over each placed prop's footprint on the 2D grid, plus a ghost
// preview that follows the cursor while placing. Positions are derived from the live cell
// geometry (offsetLeft/Width + neighbour pitch) so they stay aligned regardless of zoom/CSS,
// and the overlay lives inside #mapPaintGrid so it scrolls with the grid.
function refreshPropOverlays(editor) {
  const grid = document.getElementById('mapPaintGrid');
  const overlay = document.getElementById('mapPropOverlay');
  if (!grid || !overlay || !editor.map) return;
  const c0 = grid.querySelector('[data-cell="0,0"]');
  if (!c0) { overlay.innerHTML = ''; return; }
  const cx = grid.querySelector('[data-cell="1,0"]');
  const cy = grid.querySelector('[data-cell="0,1"]');
  const x0 = c0.offsetLeft;
  const y0 = c0.offsetTop;
  const cw = c0.offsetWidth;
  const ch = c0.offsetHeight;
  const pitchX = cx ? (cx.offsetLeft - x0) : (cw + 1);
  const pitchY = cy ? (cy.offsetTop - y0) : (ch + 1);
  const box = (tlx, tly, fw, fd) => ({
    left: x0 + tlx * pitchX,
    top: y0 + tly * pitchY,
    w: fw * pitchX - (pitchX - cw),
    h: fd * pitchY - (pitchY - ch),
  });
  const roofImg = (meta, yawDeg) => {
    const roof = roofThumbForModel(meta, () => refreshPropOverlays(editor));
    return roof ? `<img src="${roof.src}" alt="" style="transform:rotate(${yawDeg || 0}deg)">` : '';
  };
  const items = [];
  for (const mdl of (editor.map.models || [])) {
    const fpc = placedModelFootprint(editor, mdl);
    const r = box(fpc.tlx, fpc.tly, fpc.fw, fpc.fd);
    items.push(`<div class="map-prop-roof" style="left:${r.left}px;top:${r.top}px;width:${r.w}px;height:${r.h}px">${roofImg(fpc.meta, mdl.yawDeg)}</div>`);
  }
  if (editor.placeModelId && Array.isArray(editor._ghostTile)) {
    const meta = (editor.modelCatalog || []).find((c) => c.id === editor.placeModelId);
    if (meta) {
      const fp = meta.footprintTiles || { w: 1, d: 1 };
      const fw = Math.max(1, fp.w);
      const fd = Math.max(1, fp.d);
      const [gx, gy] = editor._ghostTile;
      const r = box(gx - Math.floor((fw - 1) / 2), gy - Math.floor((fd - 1) / 2), fw, fd);
      items.push(`<div class="map-prop-roof is-ghost" style="left:${r.left}px;top:${r.top}px;width:${r.w}px;height:${r.h}px">${roofImg(meta, 0)}</div>`);
    }
  }
  overlay.innerHTML = items.join('');
}

// True top-down (2D) placement view: flat tiles shaded by height, with each placed prop
// drawn as its rotated tile footprint plus a roof snapshot, so you can lay out a map by the
// space props occupy rather than guessing from the angled 3D preview.
function drawMapPreviewTopDown(canvas, map, cam = {}, opts = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = map.grid.width;
  const h = map.grid.height;
  const cell = TILE_SIZE;
  const pad = 12;
  const heights = map.terrain?.height;
  const specials = map.terrain?.special;

  const viewW = cam.fit ? (canvas.clientWidth || 240) : (cam.viewW || 480);
  const viewH = cam.fit ? (canvas.clientHeight || 200) : (cam.viewH || 360);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  canvas.style.width = `${viewW}px`;
  canvas.style.height = `${viewH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b2a3a';
  ctx.fillRect(0, 0, viewW, viewH);

  const contentW = w * cell + pad * 2;
  const contentH = h * cell + pad * 2;
  let zoom = cam.zoom ?? 1;
  let panX = cam.panX ?? 0;
  let panY = cam.panY ?? 0;
  if (cam.fit || cam.refit) {
    zoom = Math.min((viewW - 8) / contentW, (viewH - 8) / contentH, 2.4);
    panX = (viewW - contentW * zoom) / 2;
    panY = (viewH - contentH * zoom) / 2;
    if (!cam.fit && cam.refit) {
      cam.zoom = zoom; cam.panX = panX; cam.panY = panY; cam.refit = false;
    }
  }

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);
  const ox = pad;
  const oy = pad;

  for (let z = 0; z < h; z += 1) {
    for (let x = 0; x < w; x += 1) {
      const base = ((x + z) & 1) === 0 ? PREVIEW_TOP_A : PREVIEW_TOP_B;
      const hv = Math.max(0, heights?.[z]?.[x] ?? 0);
      const shade = Math.min(60, hv * 10);
      const r = Math.min(255, base[0] + shade);
      const g = Math.min(255, base[1] + shade);
      const b = Math.min(255, base[2] + shade);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(ox + x * cell, oy + z * cell, cell, cell);
      const special = specials?.[z]?.[x] ?? 0;
      const eff = effectiveSpecial(special, heights, w, h, x, z);
      if (eff >= SPECIAL.RAMP_N && eff <= SPECIAL.CONCAVE_NW) {
        ctx.fillStyle = 'rgba(251,191,36,.18)';
        ctx.fillRect(ox + x * cell, oy + z * cell, cell, cell);
      }
    }
  }

  ctx.strokeStyle = 'rgba(102,138,170,.22)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 1) {
    ctx.moveTo(ox + x * cell, oy);
    ctx.lineTo(ox + x * cell, oy + h * cell);
  }
  for (let z = 0; z <= h; z += 1) {
    ctx.moveTo(ox, oy + z * cell);
    ctx.lineTo(ox + w * cell, oy + z * cell);
  }
  ctx.stroke();

  const catalog = opts.editor?.modelCatalog || [];
  const onReady = () => { if (opts.state) refreshMapPreview(opts.state); };
  const propTs = map.grid?.tileSize || TILE_SIZE;
  for (const mdl of (map.models || [])) {
    const cx = ox + ((mdl.position?.[0] ?? 0) / propTs) * cell;
    const cz = oy + ((mdl.position?.[2] ?? 0) / propTs) * cell;
    const meta = catalog.find((c) => c.id === mdl.id);
    const fp = meta?.footprintTiles || { w: 1, d: 1 };
    const rw = Math.max(1, fp.w) * cell;
    const rd = Math.max(1, fp.d) * cell;
    const yaw = (mdl.yawDeg || 0) * Math.PI / 180;

    ctx.save();
    ctx.translate(cx, cz);
    ctx.rotate(yaw);
    const roof = roofThumbForModel(meta, onReady);
    if (roof) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-rw / 2, -rd / 2, rw, rd);
      ctx.clip();
      ctx.drawImage(roof, -rw / 2, -rd / 2, rw, rd);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(56,189,248,.18)';
      ctx.fillRect(-rw / 2, -rd / 2, rw, rd);
    }
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(-rw / 2, -rd / 2, rw, rd);
    // Facing notch toward +local-Z (north of the footprint after yaw).
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(0, -rd / 2 - 4 / zoom);
    ctx.lineTo(-3 / zoom, -rd / 2);
    ctx.lineTo(3 / zoom, -rd / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const spawn = map.player?.spawnTile || [0, 0];
  ctx.fillStyle = '#fbbf24';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2 / zoom;
  ctx.beginPath();
  ctx.arc(ox + (spawn[0] + 0.5) * cell, oy + (spawn[1] + 0.5) * cell, cell * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawMapPreview(canvas, map, cam = {}, opts = {}) {
  if (!canvas) return;
  if (cam.mode === '2d') {
    drawMapPreviewTopDown(canvas, map, cam, opts);
    return;
  }
  const ctx = canvas.getContext('2d');
  const { w, h, tileSpecial, inBounds, cornerHeights } = buildPreviewScene(map);
  const { project } = createPreviewProjector(map, cam);
  const wallEw = `rgb(${PREVIEW_WALL_EW.join(',')})`;
  const wallNs = `rgb(${PREVIEW_WALL_NS.join(',')})`;
  const wallCore = 'rgb(72, 96, 120)';
  const walls = [];
  const tops = [];

  const quad = (x0, z0, y0, x1, z1, y1, x2, z2, y2, x3, z3, y3) => [
    project(x0, z0, y0),
    project(x1, z1, y1),
    project(x2, z2, y2),
    project(x3, z3, y3),
  ];

  for (let z = 0; z < h; z += 1) {
    for (let x = 0; x < w; x += 1) {
      const corners = cornerHeights(x, z);
      const maxY = Math.max(...corners);
      const x0 = x;
      const x1 = x + 1;
      const z0 = z;
      const z1 = z + 1;
      const neighborWest = inBounds(x - 1, z) ? Math.max(...cornerHeights(x - 1, z)) : 0;
      const neighborEast = inBounds(x + 1, z) ? Math.max(...cornerHeights(x + 1, z)) : 0;
      const neighborNorth = inBounds(x, z - 1) ? Math.max(...cornerHeights(x, z - 1)) : 0;
      const neighborSouth = inBounds(x, z + 1) ? Math.max(...cornerHeights(x, z + 1)) : 0;

      if (maxY > 0) {
        if (corners[0] > neighborWest || corners[3] > neighborWest) {
          pushFace(walls, quad(x0, z0, 0, x0, z0, corners[0], x0, z1, corners[3], x0, z1, 0), wallCore);
        }
        if (corners[1] > neighborEast || corners[2] > neighborEast) {
          pushFace(walls, quad(x1, z0, 0, x1, z0, corners[1], x1, z1, corners[2], x1, z1, 0), wallCore);
        }
        if (corners[0] > neighborNorth || corners[1] > neighborNorth) {
          pushFace(walls, quad(x0, z0, 0, x0, z0, corners[0], x1, z0, corners[1], x1, z0, 0), wallCore);
        }
        if (corners[3] > neighborSouth || corners[2] > neighborSouth) {
          pushFace(walls, quad(x0, z1, 0, x0, z1, corners[3], x1, z1, corners[2], x1, z1, 0), wallCore);
        }
      }

      const c = corners;
      if (inBounds(x + 1, z)) {
        const n = cornerHeights(x + 1, z);
        if (c[1] > n[0] || c[2] > n[3]) {
          pushFace(walls, quad(x + 1, z, n[0], x + 1, z, c[1], x + 1, z + 1, c[2], x + 1, z + 1, n[3]), wallEw);
        } else if (n[0] > c[1] || n[3] > c[2]) {
          pushFace(walls, quad(x + 1, z, c[1], x + 1, z, n[0], x + 1, z + 1, n[3], x + 1, z + 1, c[2]), wallEw);
        }
      }
      if (inBounds(x, z + 1)) {
        const n = cornerHeights(x, z + 1);
        if (c[3] > n[0] || c[2] > n[1]) {
          pushFace(walls, quad(x, z + 1, n[0], x + 1, z + 1, n[1], x + 1, z + 1, c[2], x, z + 1, c[3]), wallNs);
        } else if (n[0] > c[3] || n[1] > c[2]) {
          pushFace(walls, quad(x, z + 1, c[3], x + 1, z + 1, c[2], x + 1, z + 1, n[1], x, z + 1, n[0]), wallNs);
        }
      }

      const checker = ((x + z) & 1) === 0;
      const rgb = checker ? PREVIEW_TOP_A : PREVIEW_TOP_B;
      const special = tileSpecial(x, z);
      const eff = effectiveSpecial(special, map.terrain.height, w, h, x, z);
      const ramp = eff >= SPECIAL.RAMP_N && eff <= SPECIAL.CONCAVE_NW;
      const fill = ramp
        ? `rgb(${Math.min(255, rgb[0] + 18)},${Math.min(255, rgb[1] + 24)},${rgb[2]})`
        : `rgb(${rgb.join(',')})`;
      pushFace(tops, quad(x, z, c[0], x + 1, z, c[1], x + 1, z + 1, c[2], x, z + 1, c[3]), fill);
    }
  }

  const viewW = cam.fit ? (canvas.clientWidth || 240) : (cam.viewW || 480);
  const viewH = cam.fit ? (canvas.clientHeight || 200) : (cam.viewH || 360);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  canvas.style.width = `${viewW}px`;
  canvas.style.height = `${viewH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b2a3a';
  ctx.fillRect(0, 0, viewW, viewH);

  const bounds = measurePreviewExtents(map, cam);
  let zoom = cam.zoom ?? 1;
  let panX = cam.panX ?? 0;
  let panY = cam.panY ?? 0;
  if (cam.fit || cam.refit) {
    zoom = Math.min((viewW - 24) / bounds.width, (viewH - 24) / bounds.height, 1.5);
    panX = (viewW - bounds.width * zoom) / 2 - bounds.minX * zoom;
    panY = (viewH - bounds.height * zoom) / 2 - bounds.minY * zoom;
    if (!cam.fit && cam.refit) {
      cam.zoom = zoom;
      cam.panX = panX;
      cam.panY = panY;
      cam.refit = false;
    }
  }

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);
  drawSortedFaces(ctx, walls, false);
  drawSortedFaces(ctx, tops, true);

  const propTs = map.grid?.tileSize || TILE_SIZE;
  for (const mdl of (map.models || [])) {
    const px = (mdl.position?.[0] ?? 0) / propTs;
    const pz = (mdl.position?.[2] ?? 0) / propTs;
    const py = mdl.position?.[1] ?? 0;
    const base = project(px, pz, py);
    const top = project(px, pz, py + TILE_SIZE * 0.95);
    ctx.strokeStyle = 'rgba(11,42,58,.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.lineTo(top.sx, top.sy);
    ctx.stroke();
    const yaw = (mdl.yawDeg || 0) * Math.PI / 180;
    const facing = project(px + Math.sin(yaw) * 0.7, pz + Math.cos(yaw) * 0.7, py + TILE_SIZE * 0.95);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(top.sx, top.sy);
    ctx.lineTo(facing.sx, facing.sy);
    ctx.stroke();
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#0b2a3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(top.sx, top.sy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const spawn = map.player?.spawnTile || [0, 0];
  const sh = Math.max(...cornerHeights(spawn[0], spawn[1]));
  const sp = project(spawn[0] + 0.5, spawn[1] + 0.5, sh + TILE_SIZE * 0.35);
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(sp.sx, sp.sy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function paletteButtons(brush, value, esc) {
  const layer = brushLayer(brush);
  if (!layer) return '';
  const meta = LAYER_META[layer];
  const count = layer === 'height' ? 13 : layer === 'special' ? SPECIAL_MAX + 1 : 2;
  return Array.from({ length: count }, (_, i) => {
    const v = meta.min + i;
    const label = layer === 'special'
      ? (RAMP_PRESETS.find((r) => r.id === v)?.short || SPECIAL_LABELS[v]?.[0] || v)
      : layer === 'collision'
        ? (v ? 'X' : 'O')
        : v;
    const style = layer === 'height'
      ? `background:${heightColor(v)}`
      : layer === 'special'
        ? `background:${specialColor(v)};color:#083244`
        : `background:${collisionColor(v)}`;
    const swatchClass = layer === 'collision' ? 'palette-swatch palette-swatch--mark' : 'palette-swatch';
    const title = layer === 'collision' ? (v ? 'Blocked' : 'Walkable') : (layer === 'special' ? SPECIAL_LABELS[v] : String(v));
    return `<button type="button" class="${swatchClass} ${value === v ? 'active' : ''}" data-palette="${v}" style="${style}" title="${esc(title)}">${esc(String(label))}</button>`;
  }).join('');
}

function brushHint(brush) {
  if (brush === 'height') return 'Height brush edits elevation (0 = ground). Use Raise/Lower or the palette.';
  if (brush === 'ramp') return 'Ramp brush: cardinals 2–5, corner ramps 6–13. Auto (1) is baked to N/E/S/W on save. Pick a type below.';
  if (brush === 'collision') return 'Blocked brush marks unwalkable tiles (red outline on the grid).';
  return 'Spawn brush sets the player start tile (gold ring).';
}

export function ensureMapEditorState(state) {
  if (!state.mapEditor) {
    state.mapEditor = {
      settings: null,
      resolvedPath: '',
      files: [],
      currentFile: null,
      map: null,
      dirty: false,
      brush: 'height',
      tool: 'paint',
      brushSize: 1,
      values: { height: 1, ramp: 0, collision: 1 },
      showCellValues: true,
      painting: false,
      dragStart: null,
      dragEnd: null,
      previewOpen: false,
      previewPos: { x: 48, y: 72 },
      previewSize: { w: 504, h: 400 },
      previewCam: { ...PREVIEW_CAM_DEFAULT },
      previewPanning: false,
      previewOrbiting: false,
      modelsResolvedPath: '',
      modelCatalog: [],
      selectedModelId: null,
      modelViewportOpen: false,
      compilingModel: false,
      sidebarTab: 'maps',
      compileWizardOpen: false,
      compileWizardStep: 1,
      compileZipFile: null,
      compileModelId: '',
      compileCheck: null,
      compileResult: null,
      modelsApiAvailable: true,
      modelsDeleteAvailable: false,
      modelsApiHint: '',
      placeModelId: null,
      workspaceView: '2d',
      propTool: null,
      modelSearch: '',
      selectedPlacementIndex: null,
      compileDisplayName: '',
      compileDefaultYaw: 0,
      compileDefaultScale: 1,
    };
  }
  if (state.mapEditor.workspaceView !== '3d') state.mapEditor.workspaceView = '2d';
  if (state.mapEditor.propTool === undefined) state.mapEditor.propTool = null;
  if (state.mapEditor.modelSearch === undefined) state.mapEditor.modelSearch = '';
  if (state.mapEditor.selectedPlacementIndex === undefined) state.mapEditor.selectedPlacementIndex = null;
  if (!state.mapEditor.modelCatalog) state.mapEditor.modelCatalog = [];
  if (state.mapEditor.placeModelId === undefined) state.mapEditor.placeModelId = null;
  if (!state.mapEditor.sidebarTab) state.mapEditor.sidebarTab = 'maps';
  if (!state.mapEditor.previewCam) {
    state.mapEditor.previewCam = { ...PREVIEW_CAM_DEFAULT };
  }
  if (state.mapEditor.previewCam.yaw == null) {
    state.mapEditor.previewCam.yaw = PREVIEW_CAM_DEFAULT.yaw;
    state.mapEditor.previewCam.pitch = PREVIEW_CAM_DEFAULT.pitch;
  }
  if (!state.mapEditor.values) {
    state.mapEditor.values = { height: 1, ramp: 0, collision: 1 };
  }
  if (!state.mapEditor.previewSize) {
    state.mapEditor.previewSize = { w: 504, h: 400 };
  }
  if (state.mapEditor.layer && !state.mapEditor.brush) {
    const layer = state.mapEditor.layer;
    state.mapEditor.brush = layer === 'special' ? 'ramp' : layer === 'collision' ? 'collision' : 'height';
    if (state.mapEditor.value != null) state.mapEditor.values[state.mapEditor.brush] = state.mapEditor.value;
  }
  return state.mapEditor;
}

function syncCellButton(btn, map, x, y, editor) {
  if (!btn) return;
  const st = unifiedCellStyle(map, x, y, editor.showCellValues);
  btn.style.background = st.bg;
  btn.classList.toggle('is-spawn', st.isSpawn);
  btn.classList.toggle('is-collision', st.blocked);
  btn.classList.toggle('has-ramp', Boolean(st.rampLabel));
  let rampEl = btn.querySelector('.cell-ramp');
  if (st.rampLabel) {
    const rampShort = RAMP_PRESETS.find((r) => r.id === st.special)?.short || '';
    if (!rampEl) {
      btn.insertAdjacentHTML('afterbegin', `<span class="cell-ramp" title="${st.rampLabel}">${rampShort}</span>`);
    } else {
      rampEl.textContent = rampShort;
      rampEl.title = st.rampLabel;
    }
  } else if (rampEl) rampEl.remove();
  let valEl = btn.querySelector('.cell-val');
  if (editor.showCellValues) {
    if (!valEl) btn.insertAdjacentHTML('beforeend', `<span class="cell-val">${st.hv}</span>`);
    else valEl.textContent = String(st.hv);
  } else if (valEl) valEl.remove();
}

export function mapEditorHtml(state, esc) {
  const editor = ensureMapEditorState(state);
  const map = editor.map;
  const w = map?.grid?.width || 16;
  const h = map?.grid?.height || 16;
  const brush = editor.brush;
  const brushVal = editor.values[brush] ?? 0;
  const dirtyBadge = editor.dirty
    ? '<span class="map-dirty-badge">Unsaved changes</span>'
    : '<span class="map-dirty-badge clean">Saved</span>';

  const fileList = (editor.files || []).map((f) => {
    const active = editor.currentFile === f.name ? 'active' : '';
    return `<button type="button" class="${active}" data-map-file="${esc(f.name)}"><strong>${esc(f.name)}</strong><span>${esc(f.kind)}</span></button>`;
  }).join('') || '<p class="hint">No maps in this folder yet.</p>';

  let gridHtml = '';
  if (map) {
    const tsz = map.grid?.tileSize || TILE_SIZE;
    const propTiles = new Map();
    const propFootprint = new Set();
    for (const mdl of (map.models || [])) {
      const tx = Math.floor((mdl.position?.[0] ?? 0) / tsz);
      const ty = Math.floor((mdl.position?.[2] ?? 0) / tsz);
      const key = `${tx},${ty}`;
      propTiles.set(key, (propTiles.get(key) || 0) + 1);
      const fpc = placedModelFootprint(editor, mdl);
      for (let yy = fpc.tly; yy < fpc.tly + fpc.fd; yy += 1) {
        for (let xx = fpc.tlx; xx < fpc.tlx + fpc.fw; xx += 1) propFootprint.add(`${xx},${yy}`);
      }
    }
    const placing = editor.propTool === 'place' && Boolean(editor.placeModelId);
    const selIdx = editor.selectedPlacementIndex;
    let selFootprint = null;
    if (selIdx != null && editor.propTool === 'select') {
      const selMdl = map.models?.[selIdx];
      if (selMdl) selFootprint = placedModelFootprint(editor, selMdl);
    }
    const cells = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const st = unifiedCellStyle(map, x, y, editor.showCellValues);
        const classes = ['map-cell'];
        if (st.isSpawn) classes.push('is-spawn');
        if (st.blocked) classes.push('is-collision');
        if (st.rampLabel) classes.push('has-ramp');
        const propCount = propTiles.get(`${x},${y}`) || 0;
        if (propFootprint.has(`${x},${y}`)) classes.push('has-prop-cell');
        if (selFootprint && x >= selFootprint.tlx && x < selFootprint.tlx + selFootprint.fw
          && y >= selFootprint.tly && y < selFootprint.tly + selFootprint.fd) {
          classes.push('has-prop-selected');
        }
        if (propCount) classes.push('has-prop');
        const val = st.showValues ? `<span class="cell-val">${st.hv}</span>` : '';
        const rampShort = RAMP_PRESETS.find((r) => r.id === st.special)?.short || '';
        const ramp = st.rampLabel ? `<span class="cell-ramp" title="${esc(st.rampLabel)}">${esc(rampShort)}</span>` : '';
        const prop = propCount ? `<span class="cell-prop" title="${propCount} prop${propCount > 1 ? 's' : ''}">${propCount > 1 ? propCount : '▲'}</span>` : '';
        cells.push(`<button type="button" class="${classes.join(' ')}" data-cell="${x},${y}" style="background:${st.bg}" aria-label="cell ${x},${y}">${ramp}${prop}${val}</button>`);
      }
    }
    const gridModeCls = placing ? 'is-placing' : (editor.propTool === 'select' ? 'is-prop-select' : '');
    gridHtml = `<div class="map-grid-wrap ${gridModeCls}" id="mapGridWrap"><div class="map-grid" id="mapPaintGrid" style="grid-template-columns:repeat(${w}, 28px)">${cells.join('')}<div class="map-prop-overlay" id="mapPropOverlay"></div></div><div class="map-drag-overlay" id="mapDragOverlay" hidden></div></div>`;
  } else {
    gridHtml = '<p class="hint">Load a map or create a new one to start painting.</p>';
  }

  return `<section class="map-editor-page">
    <section class="toolbar map-editor-toolbar">
      <div>
        <h2>Overworld Map Editor</h2>
        <p>One grid — pick a brush (height, ramp, blocked, spawn), then paint, area-fill, or draw lines.</p>
      </div>
      <div class="actions">
        ${dirtyBadge}
        <button type="button" class="btn ghost" id="mapTogglePreview" ${map ? '' : ' disabled'}>${editor.previewOpen ? 'Hide 3D' : 'Open 3D'}</button>
        <button type="button" class="btn ghost" id="mapRefreshList">Refresh</button>
        <button type="button" class="btn ghost" id="mapCompileModel" ${editor.modelsApiAvailable === false ? 'disabled title="Restart Operations Desk first"' : ''}>${editor.compilingModel ? 'Importing…' : 'Import GLB…'}</button>
        <button type="button" class="btn ghost" id="mapNew">New map</button>
        <button type="button" class="btn" id="mapSave" ${map ? '' : ' disabled'}>Save .owmap</button>
      </div>
    </section>
    <section class="panel map-meta-form">
      <div class="row">
        <label>Maps folder (relative to workspace)
          <input id="mapDirInput" value="${esc(editor.settings?.mapsDirectory || '')}" placeholder="pokemon-resort/assets/overworld/maps">
        </label>
        <label>Models folder (game assets)
          <input id="mapModelsDirInput" value="${esc(editor.settings?.modelsDirectory || '')}" placeholder="pokemon-resort/assets/overworld/models">
        </label>
      </div>
      <div class="row" style="margin-top:10px">
        <label>Maps path
          <input readonly value="${esc(editor.resolvedPath || '')}">
        </label>
        <label>Models path
          <input readonly value="${esc(editor.modelsResolvedPath || '')}">
        </label>
      </div>
      <div class="map-meta-actions">
        <button type="button" class="btn ghost" id="mapApplyDir">Apply folder</button>
        <button type="button" class="btn ghost" id="mapImportJson">Import .map.json</button>
        <button type="button" class="btn ghost" id="mapExportOwmap" ${map ? '' : ' disabled'}>Download .owmap</button>
      </div>
      ${map ? `<div class="row" style="margin-top:10px">
        <label>Map id<input id="mapId" value="${esc(map.id)}"></label>
        <label>Display name<input id="mapName" value="${esc(map.name)}"></label>
        <label>Width (tiles)<input id="mapWidth" type="number" min="4" max="128" value="${w}"></label>
        <label>Height (tiles)<input id="mapHeight" type="number" min="4" max="128" value="${h}"></label>
        <label>Save as<input id="mapFileName" value="${esc(editor.currentFile || `${map.id || 'map'}.owmap`)}"></label>
        <div class="actions" style="align-self:end"><button type="button" class="btn" id="mapApplySize">Apply size</button></div>
      </div>` : ''}
    </section>
    <section class="map-editor-layout">
      <aside class="panel map-sidebar">
        <div class="map-sidebar-tabs" role="tablist">
          <button type="button" class="map-sidebar-tab ${editor.sidebarTab === 'maps' ? 'active' : ''}" data-sidebar-tab="maps" role="tab">Maps</button>
          <button type="button" class="map-sidebar-tab ${editor.sidebarTab === 'props' ? 'active' : ''}" data-sidebar-tab="props" role="tab">3D props</button>
        </div>
        <div class="map-sidebar-panel ${editor.sidebarTab === 'maps' ? '' : 'hidden'}" id="mapSidebarMaps" role="tabpanel">
          <h3>Maps (.owmap)</h3>
          <p class="hint">Click a map to load and edit terrain.</p>
          <div class="list map-file-list" id="mapFileList">${fileList}</div>
        </div>
        <div class="map-sidebar-panel ${editor.sidebarTab === 'props' ? '' : 'hidden'}" id="mapSidebarProps" role="tabpanel">
          <h3>Prop library</h3>
          ${editor.modelsApiAvailable === false ? `<p class="map-api-warn">${esc(editor.modelsApiHint || 'Restart the Operations Desk to enable model import.')}</p>` : '<p class="hint">GLB models for map props.</p>'}
          <button type="button" class="btn small" id="mapOpenCompileWizard" style="width:100%;margin-bottom:10px" ${editor.modelsApiAvailable === false ? 'disabled' : ''}>Import GLB…</button>
          <label class="map-model-search">Search models
            <input type="search" id="mapModelSearch" placeholder="name or id…" value="${esc(editor.modelSearch || '')}" autocomplete="off">
          </label>
          <div class="map-model-catalog" id="mapModelCatalog">${modelCatalogHtml(editor, esc)}</div>
          ${placedPropsHtml(editor, esc)}
        </div>
      </aside>
      <div class="map-workspace">
        <section class="panel">
          <div class="map-tool-rail">
            <div class="tool-group map-brush-group" role="group" aria-label="Brush">
              ${BRUSHES.map((b) => `<button type="button" class="tool-btn brush-btn ${brush === b.id ? 'active' : ''}" data-brush="${b.id}" title="${esc(b.label)} brush" style="--brush-accent:${b.color}">${b.label}</button>`).join('')}
            </div>
            <div class="tool-group" role="group" aria-label="Tool">
              ${TOOLS.map((t) => `<button type="button" class="tool-btn map-tool ${editor.tool === t.id ? 'active' : ''}" data-tool="${t.id}" title="${esc(t.title)}">${t.label}</button>`).join('')}
            </div>
            <label>Size <input id="mapBrushSize" type="range" min="1" max="5" value="${editor.brushSize}"> <strong id="mapBrushSizeLabel">${editor.brushSize}</strong></label>
            <label><input type="checkbox" id="mapShowValues" ${editor.showCellValues ? 'checked' : ''}> Heights</label>
            ${propToolRailHtml(editor, esc)}
            <div class="tool-group map-workspace-view" role="group" aria-label="Workspace view" style="margin-left:auto">
              <button type="button" class="tool-btn ${editor.workspaceView === '3d' ? '' : 'active'}" data-workspace-view="2d" title="2D paint grid">2D</button>
              <button type="button" class="tool-btn ${editor.workspaceView === '3d' ? 'active' : ''}" data-workspace-view="3d" ${map ? '' : 'disabled'} title="View-only 3D scene with real models">3D</button>
            </div>
          </div>
          <div style="margin-top:10px">
            ${brush === 'ramp' ? `<div class="map-ramp-rail" role="group" aria-label="Ramp type">
              <div class="map-ramp-group"><span>Cardinal</span>${RAMP_PRESETS.filter((r) => r.group === 'cardinal' || r.group === 'base').map((r) => `<button type="button" class="ramp-btn ${brushVal === r.id ? 'active' : ''}" data-ramp="${r.id}" title="${esc(r.label)}">${esc(r.short)}</button>`).join('')}</div>
              <div class="map-ramp-group"><span>Convex</span>${RAMP_PRESETS.filter((r) => r.group === 'convex').map((r) => `<button type="button" class="ramp-btn ${brushVal === r.id ? 'active' : ''}" data-ramp="${r.id}" title="${esc(r.label)}">${esc(r.short)}</button>`).join('')}</div>
              <div class="map-ramp-group"><span>Concave</span>${RAMP_PRESETS.filter((r) => r.group === 'concave').map((r) => `<button type="button" class="ramp-btn ${brushVal === r.id ? 'active' : ''}" data-ramp="${r.id}" title="${esc(r.label)}">${esc(r.short)}</button>`).join('')}</div>
            </div>` : ''}
            <p class="hint" style="margin:8px 0">${esc(brushHint(brush))}</p>
            ${brush !== 'spawn' ? `<div class="map-palette" id="mapPalette">${paletteButtons(brush, brushVal, esc)}</div>` : '<p class="hint">Click cells to place spawn.</p>'}
          </div>
        </section>
        ${editor.workspaceView === '3d' && map
          ? '<div class="map-3d-mount" id="map3dMount"><p class="hint map-3d-loading">Building 3D scene…</p></div>'
          : gridHtml}
      </div>
      ${map ? `<aside class="panel map-preview-dock" id="mapPreviewDock" title="Click to open enlarged 3D view">
        <h3>3D preview</h3>
        <div class="map-preview-dock-frame">
          <canvas id="mapPreviewCanvasDock" width="240" height="200" aria-label="Map 3D thumbnail"></canvas>
          <span class="map-preview-dock-hint">Click to expand</span>
        </div>
      </aside>` : ''}
    </section>
    ${map && editor.previewOpen ? (() => {
      const psz = editor.previewSize || { w: 504, h: 400 };
      return `<div class="map-preview-modal" id="mapPreviewModal" style="left:${editor.previewPos.x}px;top:${editor.previewPos.y}px;width:${psz.w}px;height:${psz.h}px">
      <header class="map-preview-modal-head" id="mapPreviewDragHandle">
        <strong>${editor.previewCam.mode === '2d' ? 'Top-down (2D)' : '3D preview'}</strong>
        <div class="map-preview-modal-actions">
          <div class="map-preview-viewtoggle" role="group" aria-label="View mode">
            <button type="button" class="map-preview-viewbtn ${editor.previewCam.mode === '2d' ? '' : 'active'}" data-view="3d" title="3D angled view">3D</button>
            <button type="button" class="map-preview-viewbtn ${editor.previewCam.mode === '2d' ? 'active' : ''}" data-view="2d" title="Top-down footprint view">2D</button>
          </div>
          <button type="button" class="map-preview-zoom" data-zoom="out" title="Zoom out">−</button>
          <button type="button" class="map-preview-zoom" data-zoom="reset" title="Reset view">⟲</button>
          <button type="button" class="map-preview-zoom" data-zoom="in" title="Zoom in">+</button>
          <button type="button" class="map-preview-close" id="mapPreviewClose" title="Close">×</button>
        </div>
      </header>
      <div class="map-preview-modal-body" id="mapPreviewPanSurface">
        <canvas id="mapPreviewCanvas" aria-label="Isometric map preview"></canvas>
      </div>
      <p class="map-preview-modal-foot"><strong>Drag</strong> rotate · <strong>Right-drag</strong> / <strong>Shift+drag</strong> pan · <strong>− / +</strong> zoom · drag corner to resize</p>
    </div>`;
    })() : ''}
    ${compileWizardHtml(editor, esc)}
  </section>`;
}

function resizeMapLocal(map, width, height) {
  const next = JSON.parse(JSON.stringify(map));
  const copy = (grid, fill = 0) => {
    const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => fill));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) rows[y][x] = grid?.[y]?.[x] ?? fill;
    }
    return rows;
  };
  next.grid.width = width;
  next.grid.height = height;
  next.grid.tileSize = TILE_SIZE;
  next.terrain.height = copy(map.terrain.height, 0);
  next.terrain.special = copy(map.terrain.special, 0);
  next.terrain.collision = copy(map.terrain.collision, 0);
  const sx = Math.min(width - 1, Math.max(0, next.player.spawnTile?.[0] ?? 0));
  const sy = Math.min(height - 1, Math.max(0, next.player.spawnTile?.[1] ?? 0));
  next.player.spawnTile = [sx, sy];
  return next;
}

function emptyMapLocal(width, height) {
  return {
    id: 'new_map',
    name: 'New Map',
    type: 'exterior',
    visual: { mesh: '', format: 'none', material: '', textureDirectory: '', origin: [0, 0, 0], scale: 1 },
    grid: { enabled: true, tileSize: TILE_SIZE, width, height },
    player: { character: 'assets/overworld/characters/watanabe.character.json', spawnTile: [Math.floor(width / 2), Math.floor(height / 2)], spawnHeight: 0, facing: 'south' },
    camera: { preset: 'gen4_platinum_default_exterior' },
    lighting: { preset: 'gen4_default_exterior', brightness: 0.95, tint: [1, 1, 1] },
    collision: { enabled: false },
    terrain: {
      height: Array.from({ length: height }, () => Array.from({ length: width }, () => 0)),
      special: Array.from({ length: height }, () => Array.from({ length: width }, () => 0)),
      collision: Array.from({ length: height }, () => Array.from({ length: width }, () => 0)),
    },
    characters: [],
    models: [],
  };
}

function readMetaFromDom(map, { resize = false } = {}) {
  const id = document.querySelector('#mapId')?.value?.trim();
  const name = document.querySelector('#mapName')?.value?.trim();
  const width = Number(document.querySelector('#mapWidth')?.value);
  const height = Number(document.querySelector('#mapHeight')?.value);
  if (id) map.id = id;
  if (name) map.name = name;
  map.grid.tileSize = TILE_SIZE;
  if (resize && Number.isFinite(width) && Number.isFinite(height)) {
    const nw = clamp(width, 4, 128);
    const nh = clamp(height, 4, 128);
    if (nw !== map.grid.width || nh !== map.grid.height) {
      return resizeMapLocal(map, nw, nh);
    }
  }
  return map;
}

function applyMapSize(editor, log, render) {
  if (!editor.map) return;
  const before = `${editor.map.grid.width}×${editor.map.grid.height}`;
  editor.map = readMetaFromDom(editor.map, { resize: true });
  editor.dirty = true;
  log(`Map resized ${before} → ${editor.map.grid.width}×${editor.map.grid.height}`, 'ok');
  render();
}

// Mounts/disposes the view-only 3D workspace as the editor toggles between 2D and 3D. render()
// rebuilds the DOM each time, so we dispose any stale scene and mount fresh into the new
// #map3dMount; loadGlbScene caches parsed GLBs so re-mounting is cheap.
function syncWorkspace3DView(editor) {
  const mount = document.getElementById('map3dMount');
  const want3d = editor.workspaceView === '3d' && Boolean(editor.map) && Boolean(mount);
  if (editor._view3d) {
    editor._view3d.dispose();
    editor._view3d = null;
  }
  if (!want3d) return;
  editor._view3d = mountMap3DView(mount, editor.map, editor.modelCatalog || [], {
    modelUrl: (id, meta) => modelAssetUrl(id, meta),
  });
}

function syncMapEditorUI(state, { esc, render }) {
  const editor = ensureMapEditorState(state);
  syncWorkspace3DView(editor);
  refreshMapPreview(state);
  refreshPropOverlays(editor);
  if (editor.sidebarTab === 'props' && !editor.modelViewportOpen) refreshModelThumbnails(editor);
  document.querySelectorAll('.brush-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.brush === editor.brush);
  });
  document.querySelectorAll('.map-tool').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === editor.tool);
  });
  const palette = document.querySelector('#mapPalette');
  if (palette) {
    palette.innerHTML = paletteButtons(editor.brush, editor.values[editor.brush] ?? 0, esc);
    bindPalette(state, { render });
  }
}

function bindPalette(state, { render }) {
  const editor = ensureMapEditorState(state);
  document.querySelectorAll('[data-palette]').forEach((btn) => {
    btn.onclick = () => {
      editor.values[editor.brush] = Number(btn.dataset.palette);
      render();
    };
  });
}

function initPreviewModalDelegates(state, { render }) {
  const editor = ensureMapEditorState(state);
  if (editor.previewDelegatesReady) return;
  editor.previewDelegatesReady = true;
  let modalDragging = false;
  let modalOffsetX = 0;
  let modalOffsetY = 0;
  let viewPanning = false;
  let viewOrbiting = false;
  let panAnchor = null;
  let orbitAnchor = null;

  document.addEventListener('contextmenu', (event) => {
    if (event.target.closest('#mapPreviewPanSurface')) event.preventDefault();
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('#mapPreviewClose')) {
      editor.previewOpen = false;
      render();
      return;
    }
    if (event.target.closest('#mapPreviewDock') || event.target.closest('#mapPreviewCanvasDock')) {
      editor.previewOpen = true;
      editor.previewCam = { ...PREVIEW_CAM_DEFAULT, refit: true };
      render();
      return;
    }
    const viewBtn = event.target.closest('.map-preview-viewbtn');
    if (viewBtn && event.target.closest('#mapPreviewModal')) {
      const next = viewBtn.dataset.view === '2d' ? '2d' : '3d';
      if ((editor.previewCam.mode || '3d') !== next) {
        editor.previewCam = { ...PREVIEW_CAM_DEFAULT, mode: next, refit: true };
        render();
      }
      return;
    }
    const zoomBtn = event.target.closest('.map-preview-zoom');
    if (!zoomBtn || !event.target.closest('#mapPreviewModal')) return;
    const mode = zoomBtn.dataset.zoom;
    if (mode === 'reset') {
      editor.previewCam = { ...PREVIEW_CAM_DEFAULT, mode: editor.previewCam.mode, refit: true };
      refreshMapPreview(state);
    } else {
      applyPreviewZoom(editor, state, mode === 'in' ? 1.18 : 0.85);
    }
  });

  document.addEventListener('mousedown', (event) => {
    if (event.target.closest('#mapPreviewPanSurface')) {
      const usePan = event.button === 2 || event.button === 1 || event.shiftKey
        || (event.button === 0 && editor.previewCam.mode === '2d');
      if (usePan) {
        viewPanning = true;
        panAnchor = {
          x: event.clientX,
          y: event.clientY,
          panX: editor.previewCam.panX || 0,
          panY: editor.previewCam.panY || 0,
        };
      } else if (event.button === 0) {
        viewOrbiting = true;
        orbitAnchor = {
          x: event.clientX,
          y: event.clientY,
          yaw: editor.previewCam.yaw ?? PREVIEW_CAM_DEFAULT.yaw,
          pitch: editor.previewCam.pitch ?? PREVIEW_CAM_DEFAULT.pitch,
        };
      }
      event.preventDefault();
      return;
    }
    const handle = event.target.closest('#mapPreviewDragHandle');
    if (!handle || event.target.closest('.map-preview-modal-actions')) return;
    const modal = document.querySelector('#mapPreviewModal');
    if (!modal) return;
    modalDragging = true;
    const rect = modal.getBoundingClientRect();
    modalOffsetX = event.clientX - rect.left;
    modalOffsetY = event.clientY - rect.top;
    event.preventDefault();
  });

  document.addEventListener('mousemove', (event) => {
    if (viewOrbiting && orbitAnchor) {
      editor.previewCam.yaw = orbitAnchor.yaw + (event.clientX - orbitAnchor.x) * 0.012;
      editor.previewCam.pitch = clamp(
        orbitAnchor.pitch + (event.clientY - orbitAnchor.y) * 0.01,
        0.22,
        1.2,
      );
      refreshMapPreview(state);
      return;
    }
    if (viewPanning && panAnchor) {
      editor.previewCam.panX = panAnchor.panX + (event.clientX - panAnchor.x);
      editor.previewCam.panY = panAnchor.panY + (event.clientY - panAnchor.y);
      refreshMapPreview(state);
      return;
    }
    if (!modalDragging) return;
    const modal = document.querySelector('#mapPreviewModal');
    if (!modal) return;
    editor.previewPos.x = Math.max(8, event.clientX - modalOffsetX);
    editor.previewPos.y = Math.max(8, event.clientY - modalOffsetY);
    modal.style.left = `${editor.previewPos.x}px`;
    modal.style.top = `${editor.previewPos.y}px`;
  });

  document.addEventListener('mouseup', () => {
    modalDragging = false;
    viewPanning = false;
    viewOrbiting = false;
    panAnchor = null;
    orbitAnchor = null;
  });

}

function bindPreviewResizeObserver(state) {
  const editor = ensureMapEditorState(state);
  if (!editor.previewResizeObserver) {
    editor.previewResizeObserver = new ResizeObserver(() => {
      if (!editor.previewOpen) return;
      const modal = document.querySelector('#mapPreviewModal');
      if (!modal) return;
      const w = Math.max(320, Math.round(modal.offsetWidth));
      const h = Math.max(280, Math.round(modal.offsetHeight));
      if (editor.previewSize?.w === w && editor.previewSize?.h === h) return;
      editor.previewSize = { w, h };
      refreshMapPreview(state);
    });
  }
  editor.previewResizeObserver.disconnect();
  const modal = document.querySelector('#mapPreviewModal');
  if (modal) editor.previewResizeObserver.observe(modal);
}

async function fetchJsonQuiet(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadMapEditorListing(state, api) {
  const editor = ensureMapEditorState(state);
  const mapsPayload = await api('/api/maps/list');
  editor.files = mapsPayload.files || [];
  editor.resolvedPath = mapsPayload.base || editor.resolvedPath;
  editor.settings = mapsPayload.settings || editor.settings;

  const settingsPayload = await fetchJsonQuiet('/api/maps/settings');
  if (settingsPayload?.ok) {
    editor.settings = settingsPayload.settings || editor.settings;
    editor.resolvedPath = settingsPayload.resolvedPath || editor.resolvedPath;
    editor.modelsResolvedPath = settingsPayload.modelsResolvedPath || editor.modelsResolvedPath;
  }

  const caps = await fetchJsonQuiet('/api/admin/capabilities');
  editor.modelsApiAvailable = Boolean(caps?.features?.includes('overworld-models'));
  editor.modelsDeleteAvailable = Boolean(caps?.features?.includes('overworld-model-delete'));

  const modelsPayload = await fetchJsonQuiet('/api/overworld-models/list');
  if (modelsPayload?.ok) {
    editor.modelCatalog = modelsPayload.models || [];
    editor.modelsResolvedPath = modelsPayload.base || editor.modelsResolvedPath;
    editor.modelsApiAvailable = true;
  } else {
    editor.modelCatalog = [];
    if (!editor.modelsApiAvailable) {
      editor.modelsApiHint = 'Restart the Operations Desk (stop npm run admin, then start it again) to enable GLB model import.';
    }
  }
}

let modelPreviewGen = 0;

function modelCatalogHtml(editor, esc) {
  const filtered = catalogFiltered(editor);
  const cards = filtered.map((m) => {
    const fp = m.footprintTiles || { w: 1, d: 1, h: 1 };
    const active = editor.placeModelId === m.id && editor.propTool === 'place' ? 'active' : '';
    const previewActive = editor.selectedModelId === m.id && editor.modelViewportOpen ? 'previewing' : '';
    return `<div class="map-model-card-wrap" draggable="true" data-drag-model="${esc(m.id)}">
      <button type="button" class="map-model-card ${active} ${previewActive}" data-pick-model="${esc(m.id)}" title="${esc(m.displayName || m.id)} — click to place, drag onto map">
        <canvas class="model-thumb-canvas" data-model-thumb="${esc(m.id)}" width="120" height="72" aria-hidden="true"></canvas>
        <span class="map-model-card-name">${esc(m.displayName || m.id)}</span>
        <span class="map-model-card-meta">${fp.w}×${fp.d} · ${Math.round(m.defaultYawDeg || 0)}° · ×${Number(m.defaultScale || 1).toFixed(2)}</span>
      </button>
      <button type="button" class="map-model-preview-btn" data-preview-model="${esc(m.id)}" title="3D preview">👁</button>
      <button type="button" class="map-model-delete-btn" data-delete-model="${esc(m.id)}" title="${editor.modelsDeleteAvailable === false ? 'Restart npm run admin to enable delete' : 'Delete model from disk'}" aria-label="Delete ${esc(m.displayName || m.id)}" ${editor.modelsDeleteAvailable === false ? 'disabled' : ''}>×</button>
    </div>`;
  }).join('');
  if (!editor.modelCatalog?.length) return '<p class="hint">No compiled models yet. Click <strong>Import GLB…</strong> above.</p>';
  if (!filtered.length) return '<p class="hint">No models match your search.</p>';
  return cards;
}

/** Models directory relative to the game project root (pokemon-resort), for owmap references. */
function modelsRelDir(editor) {
  let dir = String(editor.settings?.modelsDirectory || 'pokemon-resort/assets/overworld/models').replace(/\\/g, '/');
  dir = dir.replace(/^\.\//, '').replace(/^pokemon-resort\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  return dir || 'assets/overworld/models';
}

function placementGlbPath(editor, model) {
  const file = (model.modelFile && /\.glb$/i.test(model.modelFile)) ? model.modelFile : `${model.id}.glb`;
  return `${modelsRelDir(editor)}/${model.id}/${file}`;
}

function placedPropsHtml(editor, esc) {
  if (!editor.map) return '';
  const models = Array.isArray(editor.map.models) ? editor.map.models : [];
  const ts = editor.map.grid?.tileSize || TILE_SIZE;
  const status = editor.propTool === 'place' && editor.placeModelId
    ? `<p class="map-place-active">Placing <strong>${esc(catalogEntry(editor, editor.placeModelId)?.displayName || editor.placeModelId)}</strong> — click or drag onto the grid. Use <strong>◎</strong> in the toolbar to select/move.</p>`
    : '<p class="hint">Click a prop to arm placement, or drag it onto the map. Use toolbar <strong>◎</strong> to select and drag placed props.</p>';
  const rows = models.map((m, i) => {
    const tx = Math.floor((m.position?.[0] ?? 0) / ts);
    const tz = Math.floor((m.position?.[2] ?? 0) / ts);
    const selected = editor.selectedPlacementIndex === i ? ' selected' : '';
    return `<li class="map-placement-row${selected}" data-select-placement="${i}">
      <span class="map-placement-id">${esc(m.id || '?')}</span>
      <span class="map-placement-meta">tile ${tx},${tz} · ${Math.round(m.yawDeg || 0)}° · ×${Number(m.scale || 1).toFixed(2)}</span>
      <button type="button" data-remove-placement="${i}" title="Remove" class="map-placement-del">×</button>
    </li>`;
  }).join('') || '<li class="hint">No props placed on this map yet.</li>';
  return `<div class="map-placed-props"><h3>Placed props (${models.length})</h3>${status}<ul class="map-placement-list">${rows}</ul></div>`;
}

function placeModelOnTile(state, deps, x, y) {
  const editor = ensureMapEditorState(state);
  if (!editor.map || !editor.placeModelId) return false;
  const model = (editor.modelCatalog || []).find((c) => c.id === editor.placeModelId);
  if (!model) {
    deps.log?.('That prop is no longer in the catalog.', 'error');
    editor.placeModelId = null;
    return false;
  }
  const ts = editor.map.grid?.tileSize || TILE_SIZE;
  const heightGrid = editor.map.terrain?.height;
  const hv = Math.max(0, heightGrid?.[y]?.[x] ?? 0);
  if (!Array.isArray(editor.map.models)) editor.map.models = [];
  const defs = placementDefaults(editor, model);
  editor.map.models.push({
    id: model.id,
    glb: placementGlbPath(editor, model),
    position: [(x + 0.5) * ts, hv * ts, (y + 0.5) * ts],
    yawDeg: defs.yawDeg,
    scale: defs.scale,
  });
  editor.selectedPlacementIndex = editor.map.models.length - 1;
  editor.propTool = 'select';
  editor.placeModelId = null;
  editor.dirty = true;
  deps.log?.(`Placed ${model.id} at tile ${x},${y}`, 'ok');
  return true;
}

function compileMetaFieldsHtml(editor, esc, check) {
  const id = editor.compileModelId || check?.modelId || '';
  const disp = editor.compileDisplayName || check?.modelId || id;
  const yaw = editor.compileDefaultYaw ?? 0;
  const scale = editor.compileDefaultScale ?? 1;
  return `<div class="map-compile-meta-fields">
    <label>Model id (folder name)
      <input id="mapCompileModelId" value="${esc(id)}" placeholder="pokemon_center" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*">
    </label>
    <label>Display name
      <input id="mapCompileDisplayName" value="${esc(disp)}" placeholder="Pokémon Center">
    </label>
    <label>Default rotation (degrees)
      <input id="mapCompileDefaultYaw" type="number" step="90" value="${yaw}">
    </label>
    <label>Default scale
      <input id="mapCompileDefaultScale" type="range" min="0.25" max="4" step="0.05" value="${scale}">
      <strong id="mapCompileDefaultScaleLabel">${Number(scale).toFixed(2)}×</strong>
    </label>
  </div>`;
}

function readCompileMetaFromDom(editor) {
  const rawId = document.querySelector('#mapCompileModelId')?.value?.trim()
    || editor.compileModelId
    || editor.compileCheck?.modelId
    || '';
  const modelId = sanitizeModelId(rawId);
  editor.compileModelId = modelId;
  editor.compileDisplayName = document.querySelector('#mapCompileDisplayName')?.value?.trim()
    || editor.compileDisplayName
    || modelId;
  editor.compileDefaultYaw = Number(document.querySelector('#mapCompileDefaultYaw')?.value) || 0;
  editor.compileDefaultScale = Number(document.querySelector('#mapCompileDefaultScale')?.value) || 1;
  return { modelId, displayName: editor.compileDisplayName, defaultYawDeg: editor.compileDefaultYaw, defaultScale: editor.compileDefaultScale };
}

function compileWizardHtml(editor, esc) {
  if (!editor.compileWizardOpen) return '';
  const step = editor.compileWizardStep || 1;
  const check = editor.compileCheck;
  const mtl = editor.mtlInspect || check?.mtlInspect;
  const steps = [
    { n: 1, label: 'Folder' },
    { n: 2, label: 'Materials' },
    { n: 3, label: 'Compile' },
    { n: 4, label: 'Done' },
  ];
  const stepper = steps.map((s) => {
    const cls = s.n < step ? 'done' : s.n === step ? 'active' : '';
    return `<span class="map-compile-step ${cls}"><em>${s.n}</em> ${esc(s.label)}</span>`;
  }).join('');

  let body = '';
  if (step === 1) {
    body = `<div class="map-compile-drop" id="mapCompileWizardDrop">
      <p><strong>Step 1 — Upload model .zip</strong></p>
      <p class="hint">Upload a <code>.glb</code>, or a <code>.zip</code> with a GLB or <code>.obj</code>+<code>.mtl</code>+textures (OBJ is converted to GLB; PNG alpha preserved).</p>
      <div class="map-compile-drop-zone">
        <span>Drop .glb or .zip here</span>
        <button type="button" class="btn" id="mapCompileWizardPick">Choose file…</button>
        <input type="file" id="mapCompileWizardInput" accept=".glb,.zip,model/gltf-binary,application/zip" hidden>
      </div>
    </div>`;
  } else if (step === 2 && check) {
    if (check.format === 'glb') {
      body = `<div class="map-compile-review">
        <p><strong>Step 2 — GLB archive</strong></p>
        <p class="hint">Stored as-is. Set id, display name, and default placement rotation/scale.</p>
        ${compileMetaFieldsHtml(editor, esc, check)}
        <ul class="map-compile-checklist">
          <li class="ok">✓ GLB: ${esc(check.sourceFile || 'found')}</li>
        </ul>
        ${check.issues.length ? `<p class="map-compile-issues">${check.issues.map((i) => esc(i)).join('<br>')}</p>` : ''}
        <p class="hint">Saves to: <code>${esc(editor.modelsResolvedPath || '…')}/&lt;model id&gt;/</code></p>
        <div class="actions">
          <button type="button" class="btn ghost" id="mapCompileWizardBack">Back</button>
          <button type="button" class="btn" id="mapCompileWizardRun" ${check.valid ? '' : 'disabled'}>Import GLB</button>
        </div>
      </div>`;
    } else {
    const matRows = (mtl?.materials || check.materials || []).map((row) => {
      const cls = row.ok ? 'ok' : (row.mapKd ? 'bad' : 'warn');
      const status = row.ok ? `✓ ${esc(row.resolved)}` : (row.mapKd ? `✗ missing (${esc(row.mapKd)})` : '○ no map_Kd');
      return `<li class="${cls}"><strong>${esc(row.name)}</strong> — ${status}</li>`;
    }).join('') || '<li class="warn">No materials in MTL — compile will use a gray fallback texture.</li>';
    const canFix = mtl?.materials?.some((r) => r.mapKd && !r.ok);
    body = `<div class="map-compile-review">
      <p><strong>Step 2 — Verify materials &amp; textures</strong></p>
      <p class="hint">Each <code>map_Kd</code> must resolve inside the zip. Server converts OBJ→GLB; PNG alpha channels are kept (no black cutouts).</p>
      ${compileMetaFieldsHtml(editor, esc, check)}
      <ul class="map-compile-checklist">
        <li class="${check.obj ? 'ok' : 'bad'}">${check.obj ? '✓' : '✗'} OBJ: ${esc(check.obj || 'not found')}</li>
        <li class="${check.mtl ? 'ok' : 'bad'}">${check.mtl ? '✓' : '✗'} MTL: ${esc(check.mtl || 'not found')}</li>
      </ul>
      <p style="margin:10px 0 4px;font-size:12px;font-weight:800">Materials</p>
      <ul class="map-compile-mat-list">${matRows}</ul>
      ${check.issues.length ? `<p class="map-compile-issues">${check.issues.map((i) => esc(i)).join('<br>')}</p>` : ''}
      <p class="hint">Saves to: <code>${esc(editor.modelsResolvedPath || '…')}/&lt;model id&gt;/</code></p>
      <div class="actions">
        <button type="button" class="btn ghost" id="mapCompileWizardBack">Back</button>
        <button type="button" class="btn" id="mapCompileWizardRun" ${check.valid ? '' : 'disabled'} title="${check.valid ? '' : 'Use a GLB file'}">Import GLB</button>
      </div>
    </div>`;
    }
  } else if (step === 3) {
    body = `<div class="map-compile-progress">
      <p><strong>Step 3 — Importing…</strong></p>
      <p class="hint">Saving GLB (or converting OBJ→GLB with alpha) and writing <code>model.json</code>.</p>
    </div>`;
  } else if (step === 4) {
    const done = editor.compileResult || {};
    body = `<div class="map-compile-done">
      <p><strong>Step 4 — Saved</strong></p>
      <p class="map-compile-success">✓ <code>${esc(done.manifest?.glbFile || `${done.modelId || ''}.glb`)}</code> (${done.bytes || 0} bytes)</p>
      <p class="hint">Format: <strong>${esc(done.sourceFormat === 'obj' ? 'OBJ→GLB' : 'GLB')}</strong> · ${done.manifest?.triangleCount || '?'} tris · footprint ${esc(String(done.manifest?.footprintTiles?.w || '?'))}×${esc(String(done.manifest?.footprintTiles?.d || '?'))}×${esc(String(done.manifest?.footprintTiles?.h || '?'))} · hash <code>${esc((done.manifest?.modelHash || '').slice(0, 8))}</code></p>
      <p class="hint">${esc(done.resolvedDirectory || '')}</p>
      <div class="actions">
        <button type="button" class="btn" id="mapCompileWizardView">Preview model</button>
        <button type="button" class="btn ghost" id="mapCompileWizardAnother">Compile another</button>
        <button type="button" class="btn ghost" id="mapCompileWizardDone">Close</button>
      </div>
    </div>`;
  }

  return `<div class="map-compile-backdrop" id="mapCompileBackdrop">
    <div class="map-compile-wizard" role="dialog" aria-labelledby="mapCompileWizardTitle">
      <header class="map-compile-wizard-head">
        <div>
          <strong id="mapCompileWizardTitle">Import GLB model</strong>
          <p class="hint"><code>.glb</code> stored as-is · OBJ zip converted to GLB with alpha</p>
        </div>
        <button type="button" class="map-preview-close" id="mapCompileWizardClose" title="Close">×</button>
      </header>
      <div class="map-compile-stepper">${stepper}</div>
      <div class="map-compile-wizard-body">${body}</div>
    </div>
  </div>`;
}

function isModelUploadFile(file) {
  const name = file?.name || '';
  return /\.(glb|zip)$/i.test(name)
    || file?.type === 'application/zip'
    || file?.type === 'model/gltf-binary';
}

function modelAssetUrl(modelId, manifest) {
  const base = `/api/overworld-models/glb?id=${encodeURIComponent(modelId)}`;
  const hash = manifest?.modelHash || '';
  const at = manifest?.compiledAt || '';
  if (hash || at) return `${base}&hash=${encodeURIComponent(hash)}&at=${encodeURIComponent(at)}`;
  return base;
}

async function inspectModelUpload(file) {
  const fd = new FormData();
  if (/\.glb$/i.test(file.name)) fd.append('glb', file, file.name);
  else fd.append('archive', file, file.name);
  const res = await fetch('/api/overworld-models/inspect', { method: 'POST', body: fd });
  const payload = await res.json();
  if (!res.ok || !payload.ok) throw new Error(payload.error || 'Inspect failed');
  return payload;
}

async function importModelUpload(file, meta = {}) {
  const modelId = sanitizeModelId(meta.modelId);
  if (!isValidModelId(modelId)) {
    throw new Error('Model id is required — use letters, numbers, underscore, or hyphen (e.g. pokemon_center).');
  }
  const fd = new FormData();
  if (/\.glb$/i.test(file.name)) fd.append('glb', file, file.name);
  else fd.append('archive', file, file.name);
  fd.append('modelId', modelId);
  if (meta.displayName) fd.append('displayName', meta.displayName);
  fd.append('defaultYawDeg', String(meta.defaultYawDeg ?? 0));
  fd.append('defaultScale', String(meta.defaultScale ?? 1));
  const res = await fetch('/api/overworld-models/compile', { method: 'POST', body: fd });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.ok) throw new Error(payload.error || `Import failed (${res.status})`);
  return payload;
}

function drawFootprintThumb(canvas, model) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const fp = model.footprintTiles || { w: 1, d: 1, h: 1 };
  ctx.fillStyle = '#0b2a3a';
  ctx.fillRect(0, 0, w, h);
  const cx = w * 0.5;
  const cy = h * 0.62;
  const tw = Math.min(36, w * 0.22 * fp.w);
  const td = Math.min(28, w * 0.16 * fp.d);
  const th = Math.min(22, h * 0.14 * fp.h);
  ctx.fillStyle = 'rgba(126,184,216,.55)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - th);
  ctx.lineTo(cx + tw, cy - td * 0.35);
  ctx.lineTo(cx + tw, cy + td * 0.65);
  ctx.lineTo(cx, cy + th);
  ctx.lineTo(cx - tw, cy + td * 0.65);
  ctx.lineTo(cx - tw, cy - td * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(251,191,36,.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = 'bold 10px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${fp.w}×${fp.d}×${fp.h}`, cx, h - 8);
}

const modelThumbCache = new Map();

function paintThumbImage(canvas, dataUrl, model) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = new Image();
  img.onload = () => {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b2a3a';
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w / img.width, (h - 12) / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - 12 - dh) / 2, dw, dh);
    const fp = model.footprintTiles || { w: 1, d: 1, h: 1 };
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(0, h - 13, w, 13);
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = 'bold 9px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${fp.w}×${fp.d} · ${fp.w * fp.d} tiles`, w * 0.5, h - 3);
  };
  img.src = dataUrl;
}

// Render each catalog card as a real front-face snapshot of the model (cached per
// id+hash), falling back to the footprint diagram while the GLB renders. This is the
// "preview of the model" used to lay out maps, plus its tile footprint/area.
function refreshModelThumbnails(editor) {
  document.querySelectorAll('[data-model-thumb]').forEach((canvas) => {
    const id = canvas.dataset.modelThumb;
    const model = (editor.modelCatalog || []).find((m) => m.id === id);
    if (!model) return;
    const key = `${id}|${model.modelHash || ''}`;
    const cached = modelThumbCache.get(key);
    if (cached) {
      paintThumbImage(canvas, cached, model);
      return;
    }
    drawFootprintThumb(canvas, model);
    renderGlbThumbnail(modelAssetUrl(id, model), {
      width: canvas.width,
      height: canvas.height,
      yaw: 0,
      pitch: 15,
    })
      .then((dataUrl) => {
        modelThumbCache.set(key, dataUrl);
        if (canvas.isConnected && canvas.dataset.modelThumb === id) {
          paintThumbImage(canvas, dataUrl, model);
        }
      })
      .catch(() => { /* keep footprint fallback */ });
  });
}

function ensureModelModalHost() {
  let host = document.getElementById('mapModelModalHost');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'mapModelModalHost';
  host.className = 'map-model-backdrop hidden';
  host.setAttribute('role', 'presentation');
  host.innerHTML = `<div class="map-model-modal" role="dialog" aria-modal="true">
    <header class="map-model-modal-head">
      <strong id="mapModelModalTitle">Model</strong>
      <button type="button" class="map-preview-close" id="mapModelModalClose" title="Close">×</button>
    </header>
    <div class="map-model-modal-body">
      <div id="mapModelWebGLHost" class="map-model-webgl-host" aria-label="GLB preview"></div>
      <p class="map-model-status" id="mapModelStatus">Loading…</p>
      <div class="map-model-defaults" id="mapModelDefaults">
        <span class="map-model-orient-label">Catalog defaults</span>
        <label>Display name <input type="text" id="mapModelDisplayName" placeholder="Friendly name"></label>
        <label>Default yaw° <input type="number" id="mapModelDefaultYaw" step="90" value="0"></label>
        <label>Default scale
          <input type="range" id="mapModelDefaultScale" min="0.25" max="4" step="0.05" value="1">
          <strong id="mapModelDefaultScaleLabel">1.00×</strong>
        </label>
        <button type="button" id="mapModelMetaSave" class="map-model-meta-save">Save defaults</button>
      </div>
      <div class="map-model-orient" id="mapModelOrient">
        <span class="map-model-orient-label">Orient</span>
        <button type="button" data-orient="rx,-90" title="Pitch back (X −90°)">⤒ X−</button>
        <button type="button" data-orient="rx,90" title="Pitch forward (X +90°)">⤓ X+</button>
        <button type="button" data-orient="ry,-90" title="Turn left (Y −90°)">↺ Y</button>
        <button type="button" data-orient="ry,90" title="Turn right (Y +90°)">↻ Y</button>
        <button type="button" data-orient="rz,-90" title="Roll left (Z −90°)">↺ Z</button>
        <button type="button" data-orient="rz,90" title="Roll right (Z +90°)">↻ Z</button>
        <span class="map-model-orient-readout" id="mapModelOrientReadout">0° / 0° / 0°</span>
        <button type="button" data-orient="reset" class="map-model-orient-reset">Reset</button>
        <button type="button" id="mapModelOrientSave" class="map-model-orient-save" disabled>Save orientation</button>
      </div>
      <pre class="map-model-debug hint" id="mapModelDebug" hidden></pre>
    </div>
    <p class="map-model-modal-foot"><span id="mapModelModalPath"></span> · Drag to rotate · Buttons re-orient in 90° steps · Esc to close</p>
  </div>`;
  document.body.appendChild(host);
  return host;
}

async function mountGlbPreview(editor, { modelId, manifest, host, status, debugEl }) {
  const webglHost = host.querySelector('#mapModelWebGLHost');
  editor._modelPreviewManifest = manifest;
  closeModelViewport();
  editor._modelViewportBind = null;

  if (debugEl) {
    const mats = (manifest?.materials || []).join(', ');
    debugEl.textContent = [
      `storageFormat=glb`,
      `file=${manifest?.glbFile || manifest?.modelFile || '?'}`,
      `materials=${mats || '?'}`,
      `hash=${manifest?.modelHash || '?'}`,
      `tris=${manifest?.triangleCount || '?'}`,
    ].join('\n');
    debugEl.hidden = false;
  }

  const url = modelAssetUrl(modelId, manifest);
  const probe = await fetch(url);
  if (!probe.ok) {
    let msg = `GLB load failed (${probe.status})`;
    if (probe.status === 400) {
      try {
        const p = await probe.json();
        msg = p.error || msg;
      } catch {
        msg = 'Invalid model id — check the catalog id matches the folder on disk.';
      }
    } else if (probe.status === 404) {
      msg = 'GLB file missing on disk — try re-importing the model.';
    }
    throw new Error(msg);
  }
  editor._modelViewportBind = await bindGlbWebGLViewport(webglHost, url);
  editor._previewRot = { rx: 0, ry: 0, rz: 0 };
  syncOrientUi(editor, host);

  if (status) {
    status.textContent = `GLB · ${manifest?.triangleCount || '?'} tris · `
      + `${(manifest?.materials || []).length} mat · ${(manifest?.modelHash || '?').slice(0, 8)} · `
      + `${manifest?.footprintTiles?.w || '?'}×${manifest?.footprintTiles?.d || '?'}×${manifest?.footprintTiles?.h || '?'}`;
  }
}

function syncOrientUi(editor, host) {
  const rot = editor._previewRot || { rx: 0, ry: 0, rz: 0 };
  const norm = (v) => (((v % 360) + 360) % 360);
  const readout = host.querySelector('#mapModelOrientReadout');
  if (readout) readout.textContent = `${norm(rot.rx)}° / ${norm(rot.ry)}° / ${norm(rot.rz)}°`;
  const dirty = norm(rot.rx) !== 0 || norm(rot.ry) !== 0 || norm(rot.rz) !== 0;
  const save = host.querySelector('#mapModelOrientSave');
  if (save) {
    save.disabled = !dirty;
    save.textContent = dirty ? 'Save orientation' : 'Saved';
  }
}

function applyPreviewOrientation(editor, host, axis, deltaDeg) {
  const rot = editor._previewRot || (editor._previewRot = { rx: 0, ry: 0, rz: 0 });
  if (axis === 'reset') {
    rot.rx = 0; rot.ry = 0; rot.rz = 0;
  } else {
    rot[axis] = (rot[axis] || 0) + deltaDeg;
  }
  editor._modelViewportBind?.setModelOrientation?.(rot.rx, rot.ry, rot.rz);
  syncOrientUi(editor, host);
}

function syncModelMetaUi(host, editor, modelId) {
  const meta = catalogEntry(editor, modelId);
  const disp = host.querySelector('#mapModelDisplayName');
  const yaw = host.querySelector('#mapModelDefaultYaw');
  const scale = host.querySelector('#mapModelDefaultScale');
  const scaleLbl = host.querySelector('#mapModelDefaultScaleLabel');
  if (disp) disp.value = meta?.displayName || modelId;
  if (yaw) yaw.value = String(Math.round(meta?.defaultYawDeg || 0));
  const sc = Number(meta?.defaultScale) || 1;
  if (scale) scale.value = String(sc);
  if (scaleLbl) scaleLbl.textContent = `${sc.toFixed(2)}×`;
}

async function saveModelMeta(state, { render, log, api }) {
  const editor = ensureMapEditorState(state);
  const modelId = editor.selectedModelId;
  if (!modelId) return;
  const host = ensureModelModalHost();
  const btn = host.querySelector('#mapModelMetaSave');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await fetch('/api/overworld-models/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: modelId,
        displayName: host.querySelector('#mapModelDisplayName')?.value?.trim(),
        defaultYawDeg: Number(host.querySelector('#mapModelDefaultYaw')?.value) || 0,
        defaultScale: Number(host.querySelector('#mapModelDefaultScale')?.value) || 1,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.ok) {
      throw new Error(payload.error || `Save failed (${res.status})`);
    }
    await loadMapEditorListing(state, api);
    syncModelMetaUi(host, editor, modelId);
    log?.(`Updated defaults for ${modelId}`, 'ok');
    render();
  } catch (e) {
    log?.(e.message || 'Save failed', 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Save defaults'; }
}

async function saveModelOrientation(state, { render, log, api }) {
  const editor = ensureMapEditorState(state);
  const modelId = editor.selectedModelId;
  const rot = editor._previewRot || { rx: 0, ry: 0, rz: 0 };
  if (!modelId) return;
  const host = ensureModelModalHost();
  const save = host.querySelector('#mapModelOrientSave');
  if (save) { save.disabled = true; save.textContent = 'Saving…'; }
  try {
    const res = await fetch('/api/overworld-models/reorient', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: modelId, rotX: rot.rx, rotY: rot.ry, rotZ: rot.rz }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.ok) {
      const stale = res.status === 404 && payload.ok === undefined;
      throw new Error(stale
        ? 'Reorient API not loaded — stop the desk and run npm run admin again, then reload.'
        : (payload.error || 'Reorient failed'));
    }
    // The GLB on disk changed: drop cached scenes/thumbnails, refresh the catalog (new
    // footprint/hash), and re-mount the preview at identity so it reflects the baked file.
    clearModelCache();
    modelThumbCache.clear();
    await loadMapEditorListing(state, api);
    editor._previewRot = { rx: 0, ry: 0, rz: 0 };
    const manifest = payload.manifest || null;
    await mountGlbPreview(editor, {
      modelId,
      manifest,
      host,
      status: host.querySelector('#mapModelStatus'),
      debugEl: host.querySelector('#mapModelDebug'),
    });
    log?.(`Re-oriented ${modelId} · footprint ${manifest?.footprintTiles?.w || '?'}×${manifest?.footprintTiles?.d || '?'}×${manifest?.footprintTiles?.h || '?'}`, 'ok');
    render();
  } catch (e) {
    log?.(e.message || 'Reorient failed', 'error');
    if (save) { save.disabled = false; save.textContent = 'Save orientation'; }
  }
}

function hideModelModalHost() {
  ensureModelModalHost().classList.add('hidden');
}

export function closeModelPreview(state, render) {
  const editor = ensureMapEditorState(state);
  editor.modelViewportOpen = false;
  modelPreviewGen += 1;
  closeModelViewport();
  editor._modelViewportBind = null;
  editor._modelPreviewManifest = null;
  hideModelModalHost();
  render();
}

async function deleteOverworldModel(state, modelId, { render, log, api }) {
  const editor = ensureMapEditorState(state);
  if (editor.modelsDeleteAvailable === false) {
    log('Restart Operations Desk: in pokemon-resort-page run npm run admin, then reload this page.', 'error');
    return;
  }
  const label = editor.modelCatalog.find((m) => m.id === modelId)?.displayName || modelId;
  if (!window.confirm(`Delete model "${label}" from disk? This cannot be undone.`)) return;
  try {
    const res = await fetch('/api/overworld-models/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: modelId }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.ok) {
      const stale = res.status === 404 && payload.error === 'Not found' && payload.ok === undefined;
      throw new Error(stale
        ? 'Delete API not loaded — stop the desk and run npm run admin again, then reload.'
        : (payload.error || 'Delete failed'));
    }
    clearModelCache();
    if (editor.selectedModelId === modelId) {
      editor.selectedModelId = null;
      closeModelPreview(state, render);
    }
    await loadMapEditorListing(state, api);
    log(`Deleted model ${modelId}`, 'ok');
    render();
  } catch (e) {
    log(e.message || 'Delete failed', 'error');
  }
}

function openModelViewport(state, modelId, render, log) {
  const editor = ensureMapEditorState(state);
  editor.selectedModelId = modelId;
  editor.modelViewportOpen = true;
  const gen = ++modelPreviewGen;
  closeModelViewport();
  editor._modelViewportBind = null;
  render();

  const host = ensureModelModalHost();
  const sel = editor.modelCatalog.find((m) => m.id === modelId);
  host.querySelector('#mapModelModalTitle').textContent = sel?.displayName || modelId;
  host.querySelector('#mapModelModalPath').textContent = `${editor.modelsResolvedPath || ''}/${modelId}/`;
  syncModelMetaUi(host, editor, modelId);
  host.classList.remove('hidden');

  const status = host.querySelector('#mapModelStatus');
  const debugEl = host.querySelector('#mapModelDebug');
  if (status) status.textContent = 'Loading model…';
  if (debugEl) {
    debugEl.hidden = true;
    debugEl.textContent = '';
  }

  (async () => {
    if (gen !== modelPreviewGen) return;
    try {
      let manifest = null;
      try {
        const mf = await fetch(`/api/overworld-models/manifest?id=${encodeURIComponent(modelId)}`);
        if (mf.ok) {
          const payload = await mf.json();
          manifest = payload.manifest;
        }
      } catch { /* manifest optional */ }

      if (gen !== modelPreviewGen) return;

      await mountGlbPreview(editor, { modelId, manifest, host, status, debugEl });
    } catch (e) {
      if (gen !== modelPreviewGen) return;
      if (status) status.textContent = e.message || 'Load failed';
      log?.(e.message || 'Model preview failed', 'error');
    }
  })();
}

function initModelModalDelegates(state, { render, log, api }) {
  const editor = ensureMapEditorState(state);
  if (editor.modelDelegatesReady) return;
  editor.modelDelegatesReady = true;
  ensureModelModalHost();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editor.modelViewportOpen) {
      closeModelPreview(state, render);
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'mapModelDefaultScale') {
      const lbl = document.querySelector('#mapModelDefaultScaleLabel');
      if (lbl) lbl.textContent = `${Number(event.target.value).toFixed(2)}×`;
    }
  });

  document.addEventListener('click', async (event) => {
    if (event.target.closest('#mapModelModalClose')) {
      closeModelPreview(state, render);
      return;
    }
    if (event.target.id === 'mapModelModalHost') {
      closeModelPreview(state, render);
      return;
    }
    if (event.target.id === 'mapModelOrientSave') {
      event.preventDefault();
      saveModelOrientation(state, { render, log, api });
      return;
    }
    if (event.target.id === 'mapModelMetaSave') {
      event.preventDefault();
      saveModelMeta(state, { render, log, api });
      return;
    }
    const orientBtn = event.target.closest('[data-orient]');
    if (orientBtn && event.target.closest('#mapModelOrient')) {
      event.preventDefault();
      const [axis, delta] = orientBtn.dataset.orient.split(',');
      applyPreviewOrientation(editor, ensureModelModalHost(), axis, Number(delta) || 0);
      return;
    }
    const delBtn = event.target.closest('[data-delete-model]');
    if (delBtn && event.target.closest('#mapModelCatalog')) {
      event.preventDefault();
      event.stopPropagation();
      deleteOverworldModel(state, delBtn.dataset.deleteModel, { render, log, api });
      return;
    }
    const pickBtn = event.target.closest('[data-pick-model]');
    if (pickBtn && event.target.closest('#mapModelCatalog')) {
      event.preventDefault();
      if (!editor.map) {
        log?.('Load or create a map before placing props.', 'error');
        return;
      }
      const id = pickBtn.dataset.pickModel;
      if (editor.placeModelId === id && editor.propTool === 'place') {
        editor.placeModelId = null;
        editor.propTool = null;
      } else {
        editor.placeModelId = id;
        editor.propTool = 'place';
        editor.selectedPlacementIndex = null;
      }
      render();
      return;
    }
    const previewBtn = event.target.closest('[data-preview-model]');
    if (previewBtn && event.target.closest('#mapModelCatalog')) {
      event.preventDefault();
      event.stopPropagation();
      openModelViewport(state, previewBtn.dataset.previewModel, render, log);
      return;
    }
    const removeBtn = event.target.closest('[data-remove-placement]');
    if (removeBtn && editor.map?.models) {
      event.preventDefault();
      const idx = Number(removeBtn.dataset.removePlacement);
      if (idx >= 0 && idx < editor.map.models.length) {
        editor.map.models.splice(idx, 1);
        editor.dirty = true;
        refreshMapPreview(state);
        render();
      }
      return;
    }
    const selectRow = event.target.closest('[data-select-placement]');
    if (selectRow && event.target.closest('.map-placement-list')) {
      event.preventDefault();
      editor.propTool = 'select';
      editor.placeModelId = null;
      editor.selectedPlacementIndex = Number(selectRow.dataset.selectPlacement);
      render();
    }
  });
}

export function bindMapEditor(state, deps) {
  const { api, log, esc, render } = deps;
  const editor = ensureMapEditorState(state);

  const paintGrid = document.querySelector('#mapPaintGrid');
  const cellFromEvent = (event) => {
    const cell = event.target.closest('[data-cell]');
    if (!cell) return null;
    return cell.dataset.cell.split(',').map(Number);
  };

  const stampPaint = (x, y, { light = false } = {}) => {
    if (!editor.map) return;
    const useLight = light && editor.tool !== 'fill';
    if (editor.tool === 'fill') {
      const layer = brushLayer(editor.brush);
      if (layer) {
        const target = cellValue(editor.map, layer, x, y);
        floodFill(editor.map, layer, x, y, target, activeBrushValue(editor));
      }
    } else {
      applyBrush(editor.map, editor, x, y);
    }
    editor.dirty = true;
    if (useLight) {
      const size = editor.brushSize;
      const half = Math.floor(size / 2);
      for (let dy = -half; dy <= half; dy += 1) {
        for (let dx = -half; dx <= half; dx += 1) {
          const tx = x + dx;
          const ty = y + dy;
          const btn = paintGrid?.querySelector(`[data-cell="${tx},${ty}"]`);
          syncCellButton(btn, editor.map, tx, ty, editor);
        }
      }
      refreshMapPreview(state);
      return;
    }
    refreshMapPreview(state);
    render();
  };

  const finishDrag = () => {
    if (!editor.map || !editor.dragStart || !editor.dragEnd) return;
    const cells = previewCellsForDrag(editor);
    if (cells.length) {
      applyToolToCells(editor.map, editor, cells);
      editor.dirty = true;
      refreshMapPreview(state);
      render();
    }
    editor.dragStart = null;
    editor.dragEnd = null;
    editor.painting = false;
    updateDragPreview(editor);
  };

  if (paintGrid) {
    paintGrid.onmousedown = (event) => {
      event.preventDefault();
      const pos = cellFromEvent(event);
      if (!pos) return;
      const [x, y] = pos;
      if (editor.propTool === 'place' && editor.placeModelId) {
        if (placeModelOnTile(state, { log }, x, y)) {
          refreshMapPreview(state);
          render();
        }
        return;
      }
      if (editor.propTool === 'select' && editor.map?.models?.length) {
        const hit = findPlacementAt(editor, x, y);
        if (hit != null) {
          editor.selectedPlacementIndex = hit;
          editor._placementDrag = { index: hit, moved: false };
          return;
        }
        editor.selectedPlacementIndex = null;
        render();
        return;
      }
      if (editor.tool === 'area' || editor.tool === 'line') {
        editor.dragStart = [x, y];
        editor.dragEnd = [x, y];
        editor.painting = true;
        updateDragPreview(editor);
        return;
      }
      editor.painting = true;
      stampPaint(x, y);
    };
    paintGrid.onmousemove = (event) => {
      const pos = cellFromEvent(event);
      if (!pos) return;
      const [x, y] = pos;
      if (editor._placementDrag && editor.propTool === 'select') {
        const drag = editor._placementDrag;
        movePlacementToTile(editor, drag.index, x, y);
        drag.moved = true;
        refreshPropOverlays(editor);
        refreshMapPreview(state);
        return;
      }
      if (editor.propTool === 'place' && editor.placeModelId) {
        const prev = editor._ghostTile;
        if (!prev || prev[0] !== x || prev[1] !== y) {
          editor._ghostTile = [x, y];
          refreshPropOverlays(editor);
        }
        return;
      }
      if ((editor.tool === 'area' || editor.tool === 'line') && editor.dragStart) {
        editor.dragEnd = [x, y];
        updateDragPreview(editor);
        return;
      }
      if (!editor.painting) return;
      if (editor.tool === 'area' || editor.tool === 'line') return;
      stampPaint(x, y, { light: true });
    };
    window.addEventListener('mouseup', () => {
      if (editor._placementDrag) {
        if (editor._placementDrag.moved) {
          editor.dirty = true;
          render();
        }
        editor._placementDrag = null;
        return;
      }
      if ((editor.tool === 'area' || editor.tool === 'line') && editor.dragStart) {
        finishDrag();
        return;
      }
      if (editor.painting) render();
      editor.painting = false;
    }, { once: false });
    paintGrid.onmouseleave = () => {
      if (editor.propTool === 'place' && editor._ghostTile) {
        editor._ghostTile = null;
        refreshPropOverlays(editor);
      }
    };
  }

  if (!editor._gridDnDDocBound) {
    editor._gridDnDDocBound = true;
    document.addEventListener('dragover', (e) => {
      if (!e.target.closest('#mapGridWrap')) return;
      if ([...e.dataTransfer.types].includes('application/x-map-model')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    document.addEventListener('drop', (e) => {
      if (!e.target.closest('#mapGridWrap')) return;
      const modelId = e.dataTransfer.getData('application/x-map-model');
      if (!modelId || !editor.map) return;
      e.preventDefault();
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-cell]');
      if (!cell) return;
      const [x, y] = cell.dataset.cell.split(',').map(Number);
      editor.placeModelId = modelId;
      editor.propTool = 'place';
      if (placeModelOnTile(state, { log }, x, y)) {
        refreshMapPreview(state);
        render();
      }
    });
    document.addEventListener('dragstart', (e) => {
      const wrap = e.target.closest('#mapModelCatalog [data-drag-model]');
      if (!wrap || !editor.map) return;
      e.dataTransfer.setData('application/x-map-model', wrap.dataset.dragModel);
      e.dataTransfer.effectAllowed = 'copy';
      editor.placeModelId = wrap.dataset.dragModel;
      editor.propTool = 'place';
    });
  }

  document.querySelectorAll('[data-prop-tool]').forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.propTool;
      if (mode === 'terrain') {
        editor.propTool = null;
        editor.placeModelId = null;
        editor._ghostTile = null;
      } else if (mode === 'select') {
        editor.propTool = 'select';
        editor.placeModelId = null;
        editor._ghostTile = null;
      } else if (mode === 'place') {
        if (!editor.placeModelId) {
          log?.('Click a prop in the sidebar first.', 'warn');
          return;
        }
        editor.propTool = 'place';
        editor.selectedPlacementIndex = null;
      }
      render();
    };
  });

  document.querySelectorAll('[data-placement-rotate]').forEach((btn) => {
    btn.onclick = () => {
      const mdl = selectedPlacement(editor);
      if (!mdl) return;
      const delta = Number(btn.dataset.placementRotate) || 90;
      mdl.yawDeg = ((Math.round((mdl.yawDeg || 0) / 90) * 90) + delta + 360) % 360;
      editor.dirty = true;
      refreshMapPreview(state);
      render();
    };
  });

  const placementScale = document.querySelector('#mapPlacementScale');
  if (placementScale) {
    placementScale.oninput = () => {
      const mdl = selectedPlacement(editor);
      if (!mdl) return;
      mdl.scale = Math.max(0.25, Math.min(4, Number(placementScale.value) || 1));
      const lbl = document.querySelector('#mapPlacementScaleLabel');
      if (lbl) lbl.textContent = `${mdl.scale.toFixed(2)}×`;
      editor.dirty = true;
      refreshMapPreview(state);
    };
  }

  const placementDelete = document.querySelector('[data-placement-delete]');
  if (placementDelete) {
    placementDelete.onclick = () => {
      const idx = editor.selectedPlacementIndex;
      if (idx == null || !editor.map?.models) return;
      editor.map.models.splice(idx, 1);
      editor.selectedPlacementIndex = null;
      editor.dirty = true;
      refreshMapPreview(state);
      render();
    };
  }

  const modelSearch = document.querySelector('#mapModelSearch');
  if (modelSearch) {
    modelSearch.oninput = () => {
      editor.modelSearch = modelSearch.value;
      render();
    };
  }

  const compileScale = document.querySelector('#mapCompileDefaultScale');
  if (compileScale) {
    compileScale.oninput = () => {
      editor.compileDefaultScale = Number(compileScale.value) || 1;
      const lbl = document.querySelector('#mapCompileDefaultScaleLabel');
      if (lbl) lbl.textContent = `${editor.compileDefaultScale.toFixed(2)}×`;
    };
  }

  document.querySelectorAll('.brush-btn, .map-tool').forEach((btn) => {
    const prev = btn._propTerrainHook;
    if (prev) return;
    btn._propTerrainHook = true;
    btn.addEventListener('click', () => {
      editor.propTool = null;
      editor.placeModelId = null;
      editor._ghostTile = null;
    });
  });

  document.querySelectorAll('[data-workspace-view]').forEach((btn) => {
    btn.onclick = () => {
      if (btn.disabled) return;
      const next = btn.dataset.workspaceView === '3d' ? '3d' : '2d';
      if (editor.workspaceView === next) return;
      editor.workspaceView = next;
      render();
    };
  });

  document.querySelectorAll('.brush-btn').forEach((btn) => {
    btn.onclick = () => {
      editor.brush = btn.dataset.brush;
      if (editor.brush === 'ramp' && !editor.values.ramp) editor.values.ramp = 1;
      if (editor.brush !== 'height' && (editor.tool === 'raise' || editor.tool === 'lower')) editor.tool = 'paint';
      render();
    };
  });

  document.querySelectorAll('[data-ramp]').forEach((btn) => {
    btn.onclick = () => {
      editor.brush = 'ramp';
      editor.values.ramp = Number(btn.dataset.ramp);
      editor.tool = 'paint';
      render();
    };
  });

  const mapTogglePreview = document.querySelector('#mapTogglePreview');
  if (mapTogglePreview) {
    mapTogglePreview.onclick = () => {
      editor.previewOpen = !editor.previewOpen;
      if (editor.previewOpen) editor.previewCam = { ...PREVIEW_CAM_DEFAULT, refit: true };
      render();
    };
  }
  initPreviewModalDelegates(state, { render });
  bindPreviewResizeObserver(state);

  const mapApplySize = document.querySelector('#mapApplySize');
  if (mapApplySize) mapApplySize.onclick = () => applyMapSize(editor, log, render);

  const mapWidth = document.querySelector('#mapWidth');
  const mapHeight = document.querySelector('#mapHeight');
  const onSizeInput = (event) => {
    if (event.key === 'Enter') applyMapSize(editor, log, render);
  };
  if (mapWidth) {
    mapWidth.onchange = () => applyMapSize(editor, log, render);
    mapWidth.onkeydown = onSizeInput;
  }
  if (mapHeight) {
    mapHeight.onchange = () => applyMapSize(editor, log, render);
    mapHeight.onkeydown = onSizeInput;
  }

  document.querySelectorAll('.map-tool').forEach((btn) => {
    btn.onclick = () => {
      editor.tool = btn.dataset.tool;
      render();
    };
  });

  bindPalette(state, { render });

  const brush = document.querySelector('#mapBrushSize');
  const brushLabel = document.querySelector('#mapBrushSizeLabel');
  if (brush) {
    brush.oninput = () => {
      editor.brushSize = Number(brush.value);
      if (brushLabel) brushLabel.textContent = String(editor.brushSize);
    };
  }

  const showValues = document.querySelector('#mapShowValues');
  if (showValues) {
    showValues.onchange = () => {
      editor.showCellValues = showValues.checked;
      render();
    };
  }

  document.querySelectorAll('[data-map-file]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const payload = await api(`/api/maps/file?file=${encodeURIComponent(btn.dataset.mapFile)}`);
        editor.map = payload.map;
        editor.map.grid.tileSize = TILE_SIZE;
        editor.currentFile = payload.fileName.endsWith('.owmap') ? payload.fileName : `${payload.map.id || 'map'}.owmap`;
        editor.dirty = false;
        log(`Loaded ${btn.dataset.mapFile}`, 'ok');
        render();
      } catch (e) { /* logged in api */ }
    };
  });

  const applyDir = document.querySelector('#mapApplyDir');
  if (applyDir) {
    applyDir.onclick = async () => {
      const mapsDirectory = document.querySelector('#mapDirInput')?.value?.trim();
      const modelsDirectory = document.querySelector('#mapModelsDirInput')?.value?.trim();
      try {
        await api('/api/maps/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mapsDirectory, modelsDirectory }),
        });
        await loadMapEditorListing(state, api);
        log('Maps and models folders updated.', 'ok');
        render();
      } catch (e) { /* api */ }
    };
  }

  const openCompileWizard = () => {
    if (editor.modelsApiAvailable === false) {
      log(editor.modelsApiHint || 'Restart Operations Desk (npm run admin) to enable GLB import.', 'warn');
      return;
    }
    editor.compileWizardOpen = true;
    editor.compileWizardStep = 1;
    editor.compileZipFile = null;
    editor.compileCheck = null;
    editor.compileResult = null;
    render();
  };

  const stageModelUpload = async (file) => {
    if (!file || !isModelUploadFile(file)) {
      log('Choose a .glb file or a .zip with GLB or OBJ+MTL+textures.', 'error');
      return;
    }
    editor.compileZipFile = file;
    editor.compilingModel = true;
    render();
    try {
      const check = await inspectModelUpload(file);
      editor.compileCheck = check;
      editor.mtlInspect = check.mtlInspect;
      editor.compileModelId = sanitizeModelId(check.modelId) || check.modelId;
      editor.compileDisplayName = check.modelId || editor.compileModelId;
      editor.compileDefaultYaw = 0;
      editor.compileDefaultScale = 1;
      editor.compileWizardStep = 2;
    } catch (e) {
      log(e.message || 'Could not read file', 'error');
      editor.compileWizardStep = 1;
    }
    editor.compilingModel = false;
    render();
  };

  const runCompile = async () => {
    const file = editor.compileZipFile;
    const meta = readCompileMetaFromDom(editor);
    if (!file) return;
    if (!isValidModelId(meta.modelId)) {
      log('Enter a valid model id (letters, numbers, underscore, hyphen).', 'error');
      return;
    }
    editor.compileWizardStep = 3;
    editor.compilingModel = true;
    render();
    try {
      const payload = await importModelUpload(file, meta);
      editor.compileResult = payload;
      editor.compileWizardStep = 4;
      const glbName = payload.manifest?.glbFile || `${payload.modelId}.glb`;
      let msg = `Imported ${glbName} → ${payload.resolvedDirectory}`;
      if (payload.warnings?.length) msg += ` (${payload.warnings.length} warning(s))`;
      log(msg, 'ok');
      clearModelCache();
      await loadMapEditorListing(state, api);
      editor.sidebarTab = 'props';
    } catch (e) {
      log(e.message || 'Import failed', 'error');
      editor.compileWizardStep = 2;
    }
    editor.compilingModel = false;
    render();
  };

  document.querySelectorAll('[data-sidebar-tab]').forEach((btn) => {
    btn.onclick = () => {
      editor.sidebarTab = btn.dataset.sidebarTab;
      render();
    };
  });

  const openWizardBtn = document.querySelector('#mapOpenCompileWizard');
  if (openWizardBtn) openWizardBtn.onclick = openCompileWizard;

  const compileToolbarBtn = document.querySelector('#mapCompileModel');
  if (compileToolbarBtn) compileToolbarBtn.onclick = openCompileWizard;

  const wizardClose = document.querySelector('#mapCompileWizardClose');
  const wizardBackdrop = document.querySelector('#mapCompileBackdrop');
  const closeWizard = () => {
    editor.compileWizardOpen = false;
    editor.compileWizardStep = 1;
    render();
  };
  if (wizardClose) wizardClose.onclick = closeWizard;
  if (wizardBackdrop) {
    wizardBackdrop.onclick = (e) => {
      if (e.target === wizardBackdrop) closeWizard();
    };
  }

  const wizardPick = document.querySelector('#mapCompileWizardPick');
  const wizardInput = document.querySelector('#mapCompileWizardInput');
  if (wizardPick && wizardInput) {
    wizardPick.onclick = () => wizardInput.click();
    wizardInput.onchange = async () => {
      const file = wizardInput.files?.[0];
      if (!file) return;
      await stageModelUpload(file);
      wizardInput.value = '';
    };
  }

  const wizardDrop = document.querySelector('#mapCompileWizardDrop');
  const wizardDropZone = document.querySelector('.map-compile-drop-zone');
  const pickUploadFromDrop = (dt) => {
    const file = dt?.files?.[0];
    if (file && isModelUploadFile(file)) return file;
    return null;
  };
  const bindDrop = (el) => {
    if (!el) return;
    el.ondragover = (e) => { e.preventDefault(); wizardDropZone?.classList.add('drag-over'); };
    el.ondragleave = () => wizardDropZone?.classList.remove('drag-over');
    el.ondrop = async (e) => {
      e.preventDefault();
      wizardDropZone?.classList.remove('drag-over');
      const file = pickUploadFromDrop(e.dataTransfer);
      if (!file) {
        log('Drop a .glb or .zip file (not a folder).', 'error');
        return;
      }
      await stageModelUpload(file);
    };
  };
  bindDrop(wizardDrop);
  bindDrop(wizardDropZone);

  const wizardBack = document.querySelector('#mapCompileWizardBack');
  if (wizardBack) {
    wizardBack.onclick = () => {
      editor.compileWizardStep = 1;
      editor.compileZipFile = null;
      render();
    };
  }

  const wizardRun = document.querySelector('#mapCompileWizardRun');
  if (wizardRun) wizardRun.onclick = () => runCompile();

  const wizardDone = document.querySelector('#mapCompileWizardDone');
  if (wizardDone) wizardDone.onclick = closeWizard;

  const wizardAnother = document.querySelector('#mapCompileWizardAnother');
  if (wizardAnother) {
    wizardAnother.onclick = () => {
      editor.compileWizardStep = 1;
      editor.compileZipFile = null;
      editor.compileResult = null;
      render();
    };
  }

  const wizardView = document.querySelector('#mapCompileWizardView');
  if (wizardView) {
    wizardView.onclick = () => {
      const id = editor.compileResult?.modelId;
      closeWizard();
      if (id) openModelViewport(state, id, render, log);
    };
  }

  initModelModalDelegates(state, { render, log, api });

  const refresh = document.querySelector('#mapRefreshList');
  if (refresh) {
    refresh.onclick = async () => {
      await loadMapEditorListing(state, api);
      render();
    };
  }

  const mapNew = document.querySelector('#mapNew');
  if (mapNew) {
    mapNew.onclick = () => {
      editor.map = emptyMapLocal(16, 16);
      editor.currentFile = 'new_map.owmap';
      editor.dirty = true;
      log('New 16×16 map ready.', 'ok');
      render();
    };
  }

  const mapSave = document.querySelector('#mapSave');
  if (mapSave) {
    mapSave.onclick = async () => {
      if (!editor.map) return;
      editor.map = readMetaFromDom(editor.map, { resize: true });
      const fileName = document.querySelector('#mapFileName')?.value?.trim() || editor.currentFile || 'map.owmap';
      try {
        const result = await api('/api/maps/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, map: editor.map }),
        });
        editor.currentFile = fileName.endsWith('.owmap') ? fileName : `${fileName}.owmap`;
        editor.dirty = false;
        await loadMapEditorListing(state, api);
        const baked = result.bakedRamps || 0;
        const cleared = result.clearedAutoRamps || 0;
        let msg = `Saved ${editor.currentFile}`;
        if (baked || cleared) {
          msg += ` (${baked} auto ramp${baked === 1 ? '' : 's'} baked`;
          if (cleared) msg += `, ${cleared} cleared to flat`;
          msg += ')';
        }
        log(msg, 'ok');
        render();
      } catch (e) { /* api */ }
    };
  }

  const mapImport = document.querySelector('#mapImportJson');
  if (mapImport) {
    mapImport.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const json = JSON.parse(await file.text());
          const base = file.name.replace(/\.map\.json$/i, '').replace(/\.json$/i, '');
          const payload = await api('/api/maps/import-json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ map: json, fileName: `${base}.owmap` }),
          });
          editor.map = payload.map;
          editor.map.grid.tileSize = TILE_SIZE;
          editor.currentFile = payload.fileName;
          editor.dirty = false;
          await loadMapEditorListing(state, api);
          const baked = payload.bakedRamps || 0;
          const cleared = payload.clearedAutoRamps || 0;
          let msg = `Imported ${file.name} → ${payload.fileName}`;
          if (baked || cleared) {
            msg += ` (${baked} baked${cleared ? `, ${cleared} cleared` : ''})`;
          }
          log(msg, 'ok');
          render();
        } catch (e) {
          log(e.message || 'Import failed', 'error');
        }
      };
      input.click();
    };
  }

  const mapExport = document.querySelector('#mapExportOwmap');
  if (mapExport) {
    mapExport.onclick = async () => {
      if (!editor.map) return;
      editor.map = readMetaFromDom(editor.map, { resize: true });
      const fileName = document.querySelector('#mapFileName')?.value?.trim() || editor.currentFile || 'map.owmap';
      const safeName = fileName.endsWith('.owmap') ? fileName : `${fileName}.owmap`;
      if (editor.dirty || !editor.currentFile?.endsWith('.owmap')) {
        const res = await fetch('/api/maps/export-body', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: safeName, map: editor.map }),
        });
        if (!res.ok) {
          log('Export failed', 'error');
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = safeName;
        a.click();
        URL.revokeObjectURL(url);
        log(`Exported ${safeName}`, 'ok');
        return;
      }
      window.open(`/api/maps/export?file=${encodeURIComponent(editor.currentFile)}`, '_blank');
      log(`Downloading ${editor.currentFile}`, 'ok');
    };
  }

  syncMapEditorUI(state, deps);
  refreshMapPreview(state);
}

export async function initMapEditorTab(state, api) {
  await loadMapEditorListing(state, api);
}
