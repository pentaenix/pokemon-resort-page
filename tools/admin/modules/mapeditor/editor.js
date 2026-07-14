import {
  SPECIAL,
  SPECIAL_LABELS,
  SPECIAL_MAX,
  RAMP_PRESETS,
  cornerHeightsForTile,
  effectiveSpecial,
} from '/shared/ramp-specials.js';
import {
  bindGlbWebGLViewport,
  clearModelCache,
  closeModelViewport,
  renderGlbThumbnail,
} from '/shared/model-viewer.js';
import { downloadRtpksTileGlb, mountMap3DView, mountRtpksTilePreview } from './map-3d-view.js';
import { openTilePackEditor } from './tile-pack-editor.js';

const LAYER_META = {
  height: { label: 'Height', min: 0, max: 255, default: 0 },
  special: { label: 'Special', min: 0, max: SPECIAL_MAX, default: 0 },
  collision: { label: 'Collision', min: 0, max: 1, default: 0 },
};

const TILE_SIZE = 16;
const ADJACENT_STRIP_TILES = 16;
const MAP_HISTORY_LIMIT = 80;
const DEFAULT_TILE_LAYERS = [
  { id: 'ground', name: 'Ground' },
  { id: 'path', name: 'Paths' },
  { id: 'detail_a', name: 'Detail A' },
  { id: 'detail_b', name: 'Detail B' },
  { id: 'overlay', name: 'Overlay' },
];
const MAX_TILE_LAYERS = 7;

const BRUSHES = [
  { id: 'height', label: 'Height', layer: 'height', color: '#74d4e5' },
  { id: 'tile', label: 'Tile', layer: null, color: '#22c55e' },
  { id: 'path', label: 'Path', layer: null, color: '#c084fc' },
  { id: 'ramp', label: 'Ramp', layer: 'special', color: '#fbbf24' },
  { id: 'collision', label: 'Blocked', layer: 'collision', color: '#ef6461' },
  { id: 'spawn', label: 'Spawn', layer: null, color: '#f59e0b' },
];

const TOOLS = [
  { id: 'paint', label: 'Paint', icon: 'brush', title: 'Paint on the active layer' },
  { id: 'erase', label: 'Erase', icon: 'eraser', title: 'Erase only the active layer' },
  { id: 'clear', label: 'Clear Cell', icon: 'clear-cell', title: 'Clear this cell across all map layers' },
  { id: 'area', label: 'Area', icon: 'rect', title: 'Apply the active tool to a rectangle' },
  { id: 'line', label: 'Line', icon: 'line', title: 'Apply the active tool along a line' },
  { id: 'fill', label: 'Fill', icon: 'fill', title: 'Flood fill matching cells on the active layer' },
  { id: 'raise', label: 'Raise', icon: 'arrow-up', title: 'Raise height by 1' },
  { id: 'lower', label: 'Lower', icon: 'arrow-down', title: 'Lower height by 1' },
  { id: 'eyedropper', label: 'Pick', icon: 'eyedropper', title: 'Pick from the active layer' },
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

function modelAuthoringFootprint(model) {
  return model?.authoringFootprintTiles || model?.footprintTiles || { w: 1, d: 1, h: 1 };
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

function tileCatalogFiltered(editor) {
  const q = (editor.tileSearch || '').trim().toLowerCase();
  const activeTabId = editor.tileTabId || editor.tilePackage?.tabs?.[0]?.id || '';
  const list = (editor.tilePackage?.tiles || [])
    .filter((tile) => !activeTabId || tile.tabId === activeTabId);
  if (!q) return list;
  return list.filter((tile) => {
    const key = String(tile.key || '').toLowerCase();
    return key.includes(q)
      || String(tile.localIndex).includes(q);
  });
}

function tileEntry(editor, resortTileId) {
  const id = Number(resortTileId);
  return (editor.tilePackage?.tiles || []).find((tile) => Number(tile.resortTileId) === id);
}

function tileFootprint(tile) {
  return {
    w: Math.max(1, Number(tile?.width || tile?.footprint?.w || 1)),
    h: Math.max(1, Number(tile?.height || tile?.footprint?.h || tile?.footprint?.d || 1)),
  };
}

function tileSizeLabel(fp) {
  return fp.w > 1 || fp.h > 1 ? `${fp.w}x${fp.h}` : '';
}

function tileCardSpanStyle(fp) {
  const cols = Math.max(1, Math.min(4, Number(fp?.w) || 1));
  const rows = Math.max(1, Math.min(4, Number(fp?.h) || 1));
  if (cols === 1 && rows === 1) return '';
  return `grid-column:span ${cols};grid-row:span ${rows};`;
}

function tileTextureUrl(editor, tile) {
  if (!editor.tilePackage?.fileName || !tile?.previewTexture) return '';
  return `/api/tile-packages/texture?file=${encodeURIComponent(editor.tilePackage.fileName)}&texture=${encodeURIComponent(tile.previewTexture)}`;
}

/** Cropped per-tile preview — matches the tile palette, not the raw atlas sheet. */
function tilePaintVisualUrl(editor, tileId) {
  const id = Number(tileId);
  if (!Number.isFinite(id)) return '';
  return cachedRtpksTileThumb(editor, id) || tilePreviewSource(editor, id) || '';
}

function tilePreviewSource(editor, tileId) {
  const tile = tileEntry(editor, tileId);
  return tile?.previewImage || '';
}

function tileHashColor(id) {
  const n = Number(id) || 0;
  const hue = (n * 47) % 360;
  return `hsl(${hue} 62% 66%)`;
}

function iconHtml(name) {
  return `<span class="map-icon map-icon-${name}" aria-hidden="true"></span>`;
}

function cloneMapForHistory(map) {
  return map ? JSON.parse(JSON.stringify(map)) : null;
}

function mapHistoryKey(map) {
  return map ? JSON.stringify(map) : '';
}

function normalizeRestoredMap(map) {
  if (!map) return null;
  map.grid.tileSize = TILE_SIZE;
  ensureTileLayers(map);
  ensurePathLayer(map);
  ensureTerrainVisual(map);
  return map;
}

function clearMapHistory(editor) {
  editor.undoStack = [];
  editor.redoStack = [];
  editor._pendingHistorySnapshot = null;
  editor._pendingHistoryKey = '';
}

function beginMapHistory(editor) {
  if (!editor?.map || editor._pendingHistorySnapshot) return;
  editor._pendingHistorySnapshot = cloneMapForHistory(editor.map);
  editor._pendingHistoryKey = mapHistoryKey(editor.map);
}

function commitMapHistory(editor) {
  if (!editor?._pendingHistorySnapshot) return false;
  const before = editor._pendingHistoryKey || '';
  const after = mapHistoryKey(editor.map);
  if (before !== after) {
    if (!Array.isArray(editor.undoStack)) editor.undoStack = [];
    editor.undoStack.push(editor._pendingHistorySnapshot);
    if (editor.undoStack.length > MAP_HISTORY_LIMIT) editor.undoStack.shift();
    editor.redoStack = [];
  }
  editor._pendingHistorySnapshot = null;
  editor._pendingHistoryKey = '';
  return before !== after;
}

function cancelMapHistory(editor) {
  editor._pendingHistorySnapshot = null;
  editor._pendingHistoryKey = '';
}

function undoMapEdit(editor) {
  if (!editor?.map || !editor.undoStack?.length) return false;
  if (!Array.isArray(editor.redoStack)) editor.redoStack = [];
  editor.redoStack.push(cloneMapForHistory(editor.map));
  editor.map = normalizeRestoredMap(editor.undoStack.pop());
  editor.dirty = true;
  cancelMapHistory(editor);
  return true;
}

function redoMapEdit(editor) {
  if (!editor?.map || !editor.redoStack?.length) return false;
  if (!Array.isArray(editor.undoStack)) editor.undoStack = [];
  editor.undoStack.push(cloneMapForHistory(editor.map));
  if (editor.undoStack.length > MAP_HISTORY_LIMIT) editor.undoStack.shift();
  editor.map = normalizeRestoredMap(editor.redoStack.pop());
  editor.dirty = true;
  cancelMapHistory(editor);
  return true;
}

function createDefaultProject(files = []) {
  return {
    version: 1,
    id: 'default',
    name: 'Default Project',
    maps: files.map((file, index) => ({
      id: file.name.replace(/\.(owmap|map\.json)$/i, ''),
      name: file.name.replace(/\.(owmap|map\.json)$/i, '').replace(/_/g, ' '),
      file: file.name,
      gridX: index,
      gridY: 0,
    })),
    tilePackages: [],
    defaultTilePackageId: '',
    pathSets: [],
    editor: { activeMapId: '', viewMode: '2d', zoom: 1, overlays: { values: true, neighbors: true } },
    export: {},
  };
}

function ensureTerrainVisual(map) {
  if (!map) return null;
  if (!map.terrainVisual || typeof map.terrainVisual !== 'object') map.terrainVisual = {};
  map.terrainVisual = {
    floorHeightScale: Number(map.terrainVisual.floorHeightScale) || TILE_SIZE,
    floorRecolorEnabled: map.terrainVisual.floorRecolorEnabled !== false,
    rampRecolorEnabled: map.terrainVisual.rampRecolorEnabled !== false,
    floorColors: {
      1: '#d84f5f',
      ...(map.terrainVisual.floorColors || {}),
    },
    rampColor: map.terrainVisual.rampColor || '#f4d03f',
    rampReadability: {
      enabled: map.terrainVisual.rampReadability?.enabled !== false,
      lowShade: Number.isFinite(Number(map.terrainVisual.rampReadability?.lowShade)) ? Number(map.terrainVisual.rampReadability.lowShade) : 0.88,
      highShade: Number.isFinite(Number(map.terrainVisual.rampReadability?.highShade)) ? Number(map.terrainVisual.rampReadability.highShade) : 1.10,
      bandCount: Number.isFinite(Number(map.terrainVisual.rampReadability?.bandCount)) ? Number(map.terrainVisual.rampReadability.bandCount) : 5,
      bandStrength: Number.isFinite(Number(map.terrainVisual.rampReadability?.bandStrength)) ? Number(map.terrainVisual.rampReadability.bandStrength) : 0.12,
      bandSoftness: Number.isFinite(Number(map.terrainVisual.rampReadability?.bandSoftness)) ? Number(map.terrainVisual.rampReadability.bandSoftness) : 0.32,
    },
    lightPreset: map.terrainVisual.lightPreset || 'day',
    lightYawDeg: Number.isFinite(Number(map.terrainVisual.lightYawDeg)) ? Number(map.terrainVisual.lightYawDeg) : 38,
    lightPitchDeg: Number.isFinite(Number(map.terrainVisual.lightPitchDeg)) ? Number(map.terrainVisual.lightPitchDeg) : 58,
  };
  return map.terrainVisual;
}

function ensurePathLayer(map) {
  if (!map) return null;
  const width = map.grid?.width || 16;
  const height = map.grid?.height || 16;
  if (!map.pathLayer || typeof map.pathLayer !== 'object') {
    map.pathLayer = { version: 1, activeSetId: '', cells: createTileGrid(width, height, 0) };
  }
  const next = createTileGrid(width, height, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) next[y][x] = map.pathLayer.cells?.[y]?.[x] ? 1 : 0;
  }
  map.pathLayer.cells = next;
  map.pathLayer.version = 1;
  if (typeof map.pathLayer.activeSetId !== 'string') map.pathLayer.activeSetId = '';
  return map.pathLayer;
}

function pathCellValue(map, x, y) {
  const layer = ensurePathLayer(map);
  return layer?.cells?.[y]?.[x] ? 1 : 0;
}

function setPathCell(map, x, y, value) {
  if (!inBounds(map, x, y)) return;
  const layer = ensurePathLayer(map);
  layer.cells[y][x] = value ? 1 : 0;
}

const PDSMS_SMART_UNITS = [
  [true, false, false, true, false, false, false, false],
  [true, false, true, true, false, false, false, false],
  [true, false, true, false, false, false, false, false],
  [true, true, true, true, true, false, true, true],
  [true, true, true, true, false, true, true, true],
  [true, true, false, true, false, false, false, false],
  [true, true, true, true, true, true, true, true],
  [true, true, true, false, false, false, false, false],
  [true, true, true, true, true, true, true, false],
  [true, true, true, true, true, true, false, true],
  [false, true, false, true, false, false, false, false],
  [false, true, true, true, false, false, false, false],
  [false, true, true, false, false, false, false, false],
];

function activePathSet(editor) {
  const id = editor.activePathSetId || editor.map?.pathLayer?.activeSetId;
  const smartSets = (editor.tilePackage?.smartSets || []).map((set) => ({ ...set, source: 'rtpks-smart' }));
  return smartSets.find((set) => set.id === id)
    || smartSets[0]
    || null;
}

function tileIdFromPathSet(set, key) {
  const raw = set?.tiles?.[key];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function pathTileKeyForCell(map, x, y) {
  const n = inBounds(map, x, y - 1) && pathCellValue(map, x, y - 1);
  const e = inBounds(map, x + 1, y) && pathCellValue(map, x + 1, y);
  const s = inBounds(map, x, y + 1) && pathCellValue(map, x, y + 1);
  const w = inBounds(map, x - 1, y) && pathCellValue(map, x - 1, y);
  const count = Number(n) + Number(e) + Number(s) + Number(w);
  if (count === 0) return 'center';
  if (count === 4) return 'cross';
  if (count === 3) return 'cross';
  if (count === 1) {
    if (n) return 'endN';
    if (e) return 'endE';
    if (s) return 'endS';
    return 'endW';
  }
  if (n && s) return 'n';
  if (e && w) return 'e';
  if (n && e) return 'ne';
  if (e && s) return 'se';
  if (s && w) return 'sw';
  if (w && n) return 'nw';
  return 'center';
}

function pathTileIdForCell(map, set, x, y) {
  if (set?.source === 'rtpks-smart' || Array.isArray(set?.grid)) {
    return smartTileIdForCell(map, set, x, y);
  }
  const key = pathTileKeyForCell(map, x, y);
  return tileIdFromPathSet(set, key)
    ?? tileIdFromPathSet(set, key[0])
    ?? tileIdFromPathSet(set, 'center');
}

function smartSame(map, x, y) {
  if (!inBounds(map, x, y)) return true;
  return Boolean(pathCellValue(map, x, y));
}

function smartUnitForCell(map, x, y) {
  return [
    smartSame(map, x, y - 1),
    smartSame(map, x, y + 1),
    smartSame(map, x - 1, y),
    smartSame(map, x + 1, y),
    smartSame(map, x - 1, y - 1),
    smartSame(map, x + 1, y - 1),
    smartSame(map, x - 1, y + 1),
    smartSame(map, x + 1, y + 1),
  ];
}

function sameCross(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function sameCorners(a, b) {
  return sameCross(a, b) && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7];
}

function fullCross(unit) {
  return unit[0] && unit[1] && unit[2] && unit[3];
}

function smartTileIdForCell(map, set, x, y) {
  const unit = smartUnitForCell(map, x, y);
  let index = -1;
  for (let i = 0; i < PDSMS_SMART_UNITS.length; i += 1) {
    if ((fullCross(unit) ? sameCorners : sameCross)(PDSMS_SMART_UNITS[i], unit)) {
      index = i;
      break;
    }
  }
  if (index < 0) index = 6;
  const sx = index % (set.width || 5);
  const sy = Math.floor(index / (set.width || 5));
  const tileId = Number(set.grid?.[sx]?.[sy]);
  return Number.isFinite(tileId) && tileId >= 0 ? tileId : null;
}

function resolvePathTiles(editor, changedCells = null) {
  if (!editor.map) return;
  const set = activePathSet(editor);
  const layer = ensurePathLayer(editor.map);
  if (!set || !layer) return;
  const pathTileLayer = tileLayerIndexById(editor.map, 'path');
  const cells = new Map();
  const add = (x, y) => {
    if (inBounds(editor.map, x, y)) cells.set(`${x},${y}`, [x, y]);
  };
  if (changedCells?.length) {
    for (const [x, y] of changedCells) {
      add(x, y); add(x + 1, y); add(x - 1, y); add(x, y + 1); add(x, y - 1);
    }
  } else {
    for (let y = 0; y < editor.map.grid.height; y += 1) {
      for (let x = 0; x < editor.map.grid.width; x += 1) add(x, y);
    }
  }
  for (const [x, y] of cells.values()) {
    if (pathCellValue(editor.map, x, y)) {
      const tileId = pathTileIdForCell(editor.map, set, x, y);
      if (tileId != null) setTileCell(editor.map, x, y, tileId, pathTileLayer);
    } else if (changedCells?.some(([cx, cy]) => cx === x && cy === y)) {
      setTileCell(editor.map, x, y, null, pathTileLayer);
    }
  }
  editor.map.pathLayer.activeSetId = set.id;
  editor.activePathSetId = set.id;
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

function isPropLayerActive(editor) {
  return editor.propTool === 'select' || editor.propTool === 'place';
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
    <button type="button" class="tool-btn map-prop-tool ${!editor.propTool ? 'active' : ''}" data-prop-tool="terrain" title="Terrain brushes" aria-label="Terrain brushes">${iconHtml('grid')}</button>
    <button type="button" class="tool-btn map-prop-tool ${editor.propTool === 'select' ? 'active' : ''}" data-prop-tool="select" title="Select and drag placed props" aria-label="Select and drag placed props">${iconHtml('select')}</button>
    <button type="button" class="tool-btn map-prop-tool ${editor.propTool === 'place' ? 'active' : ''}" data-prop-tool="place" title="Place props on the grid" aria-label="Place props on the grid" ${activeId ? '' : 'disabled'}>${iconHtml('plus')}</button>
    ${editor.propTool === 'select' && selIdx != null ? `
      <span class="map-prop-tool-sep"></span>
      <button type="button" class="tool-btn map-prop-action" data-placement-rotate="-90" title="Rotate -90 degrees" aria-label="Rotate selected prop left">${iconHtml('rotate-left')}</button>
      <button type="button" class="tool-btn map-prop-action" data-placement-rotate="90" title="Rotate +90 degrees" aria-label="Rotate selected prop right">${iconHtml('rotate-right')}</button>
      <label class="map-prop-scale" title="Scale selected prop">
        <span>Scale</span>
        <input type="range" id="mapPlacementScale" min="0.25" max="4" step="0.05" value="${scale}">
        <strong id="mapPlacementScaleLabel">${scale.toFixed(2)}×</strong>
      </label>
      <button type="button" class="tool-btn map-prop-action map-prop-action-del" data-placement-delete title="Remove selected prop" aria-label="Remove selected prop">${iconHtml('x')}</button>
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

function createTileGrid(width, height, fill = null) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => fill));
}

function normalizeTileGridCells(cells, width, height, fill = null) {
  const next = createTileGrid(width, height, fill);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = cells?.[y]?.[x];
      next[y][x] = value === undefined ? fill : value;
    }
  }
  return next;
}

function ensureTileLayers(map) {
  if (!map) return null;
  const width = map.grid?.width || 16;
  const height = map.grid?.height || 16;
  if (!map.tileLayers || !Array.isArray(map.tileLayers.layers)) {
    map.tileLayers = {
      version: 1,
      activeLayer: 0,
      layers: [{ id: 'base', name: 'Base tiles', visible: true, cells: createTileGrid(width, height, null) }],
    };
  }
  if (!map.tileLayers.layers.length) {
    map.tileLayers.layers.push({ id: 'base', name: 'Base tiles', visible: true, cells: createTileGrid(width, height, null) });
  }
  map.tileLayers.layers = map.tileLayers.layers.map((layer, index) => ({
    id: String(layer.id || DEFAULT_TILE_LAYERS[index]?.id || `layer_${index + 1}`),
    name: String(layer.name || DEFAULT_TILE_LAYERS[index]?.name || `Layer ${index + 1}`),
    visible: layer.visible !== false,
    cells: normalizeTileGridCells(layer.cells, width, height, null),
  }));
  if (map.tileLayers.layers.length > MAX_TILE_LAYERS) map.tileLayers.layers.length = MAX_TILE_LAYERS;
  map.tileLayers.activeLayer = Math.max(0, Math.min(map.tileLayers.layers.length - 1, map.tileLayers.activeLayer || 0));
  return map.tileLayers.layers[map.tileLayers.activeLayer];
}

function activeTileLayer(map) {
  return ensureTileLayers(map);
}

function tileLayerAt(map, layerIndex) {
  ensureTileLayers(map);
  return map.tileLayers.layers[layerIndex] || map.tileLayers.layers[0];
}

function tileLayerHasTiles(layer) {
  return (layer?.cells || []).some((row) => (row || []).some((value) => value != null && value !== ''));
}

function tileLayerIndexById(map, id) {
  ensureTileLayers(map);
  const index = map.tileLayers.layers.findIndex((layer) => layer.id === id);
  return index >= 0 ? index : 0;
}

function tileCellValueAtLayer(map, x, y, layerIndex = map.tileLayers?.activeLayer || 0) {
  const layer = tileLayerAt(map, layerIndex);
  const value = layer?.cells?.[y]?.[x];
  return value == null || value === '' ? null : Number(value);
}

function tileCellValue(map, x, y) {
  return tileCellValueAtLayer(map, x, y, map.tileLayers?.activeLayer || 0);
}

function visibleTileStack(map, x, y) {
  ensureTileLayers(map);
  const stack = [];
  for (let i = 0; i < map.tileLayers.layers.length; i += 1) {
    const layer = map.tileLayers.layers[i];
    if (layer.visible === false) continue;
    const value = layer.cells?.[y]?.[x];
    if (value != null && value !== '') stack.push({ layer, layerIndex: i, tileId: Number(value) });
  }
  return stack;
}

function displayTileCellValue(map, x, y) {
  const stack = visibleTileStack(map, x, y);
  return stack.length ? stack[stack.length - 1].tileId : null;
}

function visibleTileFootprintAt(editor, map, x, y) {
  ensureTileLayers(map);
  for (let i = map.tileLayers.layers.length - 1; i >= 0; i -= 1) {
    const layer = map.tileLayers.layers[i];
    if (layer.visible === false) continue;
    for (let ay = 0; ay <= y; ay += 1) {
      for (let ax = 0; ax <= x; ax += 1) {
        const value = layer.cells?.[ay]?.[ax];
        if (value == null || value === '') continue;
        const tile = tileEntry(editor, Number(value));
        const fp = tileFootprint(tile);
        if (x >= ax && x < ax + fp.w && y >= ay && y < ay + fp.h) {
          return { tileId: Number(value), anchorX: ax, anchorY: ay, layerIndex: i, footprint: fp };
        }
      }
    }
  }
  return null;
}

function visibleTileFootprintAtLayer(editor, map, x, y, layerIndex = map.tileLayers?.activeLayer || 0) {
  ensureTileLayers(map);
  const layer = tileLayerAt(map, layerIndex);
  if (!layer || layer.visible === false) return null;
  for (let ay = 0; ay <= y; ay += 1) {
    for (let ax = 0; ax <= x; ax += 1) {
      const value = layer.cells?.[ay]?.[ax];
      if (value == null || value === '') continue;
      const tile = tileEntry(editor, Number(value));
      const fp = tileFootprint(tile);
      if (x >= ax && x < ax + fp.w && y >= ay && y < ay + fp.h) {
        return { tileId: Number(value), anchorX: ax, anchorY: ay, layerIndex, footprint: fp };
      }
    }
  }
  return null;
}

function setTileCell(map, x, y, resortTileId, layerIndex = map.tileLayers?.activeLayer || 0) {
  if (!inBounds(map, x, y)) return;
  const layer = tileLayerAt(map, layerIndex);
  layer.cells[y][x] = resortTileId == null ? null : Number(resortTileId);
}

function applyTileCollision(editor, map, tileId, anchorX, anchorY, clearing = false) {
  const tile = tileEntry(editor, tileId);
  const rule = tile?.collision;
  if (!rule || rule.mode === 'none' || (!clearing && rule.autoApply === false) || (clearing && rule.clearOnErase !== true)) return;
  const fp = tileFootprint(tile);
  for (let dy = 0; dy < fp.h; dy += 1) {
    for (let dx = 0; dx < fp.w; dx += 1) {
      const included = rule.mode === 'footprint' || Boolean(rule.mask?.[dy]?.[dx]);
      if (included && inBounds(map, anchorX + dx, anchorY + dy)) {
        map.terrain.collision[anchorY + dy][anchorX + dx] = clearing ? 0 : 1;
      }
    }
  }
}

function clearTileAt(editor, map, x, y, layerIndex = map.tileLayers?.activeLayer || 0) {
  const hit = visibleTileFootprintAtLayer(editor, map, x, y, layerIndex);
  if (hit) {
    applyTileCollision(editor, map, hit.tileId, hit.anchorX, hit.anchorY, true);
    setTileCell(map, hit.anchorX, hit.anchorY, null, layerIndex);
    return true;
  }
  setTileCell(map, x, y, null, layerIndex);
  return true;
}

function clearTileAtAllLayers(editor, map, x, y) {
  ensureTileLayers(map);
  for (let layerIndex = 0; layerIndex < map.tileLayers.layers.length; layerIndex += 1) {
    clearTileAt(editor, map, x, y, layerIndex);
  }
}

function clearAllAt(editor, map, x, y) {
  clearTerrainCell(map, x, y);
  clearTileAtAllLayers(editor, map, x, y);
  setPathCell(map, x, y, 0);
  if (map.player?.spawnTile?.[0] === x && map.player?.spawnTile?.[1] === y) {
    map.player.spawnTile = null;
  }
  resolvePathTiles(editor, [[x, y]]);
}

function deleteActiveTileLayer(editor) {
  if (!editor?.map) return false;
  ensureTileLayers(editor.map);
  const layers = editor.map.tileLayers.layers;
  if (layers.length <= 1) return false;
  const index = Math.max(0, Math.min(layers.length - 1, Number(editor.map.tileLayers.activeLayer) || 0));
  const layer = layers[index];
  if (tileLayerHasTiles(layer)) {
    const ok = window.confirm(`Delete decoration layer ${index + 1}? This only removes tiles on that decoration layer.`);
    if (!ok) return false;
  }
  layers.splice(index, 1);
  editor.map.tileLayers.activeLayer = Math.max(0, Math.min(layers.length - 1, index));
  editor.brush = 'tile';
  editor.sidebarTab = 'tiles';
  editor.dirty = true;
  return true;
}

function floodFillTile(editor, map, x, y, target, replacement) {
  if (target === replacement) return;
  const w = map.grid.width;
  const h = map.grid.height;
  const stack = [[x, y]];
  const seen = new Set();
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const key = `${cx},${cy}`;
    if (seen.has(key) || !inBounds(map, cx, cy)) continue;
    if (tileCellValue(map, cx, cy) !== target) continue;
    seen.add(key);
    if (target != null) applyTileCollision(editor, map, target, cx, cy, true);
    setTileCell(map, cx, cy, replacement);
    if (replacement != null) applyTileCollision(editor, map, replacement, cx, cy, false);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

function floodFillPath(editor, x, y, target, replacement) {
  const map = editor.map;
  if (!map || target === replacement) return;
  const w = map.grid.width;
  const h = map.grid.height;
  const stack = [[x, y]];
  const seen = new Set();
  const changed = [];
  const pathTileLayer = tileLayerIndexById(map, 'path');
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const key = `${cx},${cy}`;
    if (seen.has(key) || !inBounds(map, cx, cy)) continue;
    if (pathCellValue(map, cx, cy) !== target) continue;
    seen.add(key);
    setPathCell(map, cx, cy, replacement);
    if (!replacement) setTileCell(map, cx, cy, null, pathTileLayer);
    changed.push([cx, cy]);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  resolvePathTiles(editor, changed);
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

function heightOverlayColor(v) {
  const palette = [
    'rgba(255,255,255,.04)',
    'rgba(74,144,226,.28)',
    'rgba(104,211,145,.28)',
    'rgba(250,204,21,.30)',
    'rgba(251,146,60,.32)',
    'rgba(244,114,182,.32)',
    'rgba(167,139,250,.34)',
  ];
  return palette[Math.max(0, Math.min(palette.length - 1, Number(v) || 0))];
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

function emptyTileCheckerBackground() {
  return 'none';
}

function emptyTileCheckerStyle(x = 0, y = 0) {
  const rgb = ((x + y) & 1) === 0 ? PREVIEW_TOP_A : PREVIEW_TOP_B;
  return `background-color:rgb(${rgb[0]},${rgb[1]},${rgb[2]});background-image:none;background-size:auto;background-position:0 0`;
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
  if (editor.brush === 'tile') return editor.tileBrushId ?? null;
  if (editor.brush === 'path') return 1;
  const layer = brushLayer(editor.brush);
  if (!layer) return 0;
  return editor.values[editor.brush] ?? LAYER_META[layer].default;
}

function applyToolAt(map, editor, x, y) {
  const brush = editor.brush;
  const layer = brushLayer(brush);
  const tool = editor.tool;
  if (tool === 'clear') {
    clearAllAt(editor, map, x, y);
    return;
  }
  if (brush === 'spawn' || tool === 'spawn') {
    if (tool === 'erase') {
      if (map.player?.spawnTile?.[0] === x && map.player?.spawnTile?.[1] === y) {
        map.player.spawnTile = null;
      }
      return;
    }
    map.player.spawnTile = [x, y];
    return;
  }
  if (brush === 'tile') {
    if (tool === 'eyedropper') {
      editor.tileBrushId = tileCellValue(map, x, y);
      editor.tool = 'paint';
      return;
    }
    if (tool === 'fill') {
      floodFillTile(editor, map, x, y, tileCellValue(map, x, y), editor.tileBrushId ?? null);
      return;
    }
    if (tool === 'erase') {
      clearTileAt(editor, map, x, y);
      return;
    }
    if (tool === 'raise' || tool === 'lower') return;
    setTileCell(map, x, y, editor.tileBrushId ?? null);
    applyTileCollision(editor, map, editor.tileBrushId, x, y, false);
    return;
  }
  if (brush === 'path') {
    const before = pathCellValue(map, x, y);
    if (tool === 'eyedropper') {
      editor.brush = 'path';
      editor.tool = 'paint';
      return;
    }
    if (tool === 'fill') {
      floodFillPath(editor, x, y, before, 1);
      return;
    }
    if (tool === 'erase') {
      setPathCell(map, x, y, 0);
      setTileCell(map, x, y, null, tileLayerIndexById(map, 'path'));
      resolvePathTiles(editor, [[x, y]]);
      return;
    }
    if (tool === 'raise' || tool === 'lower') return;
    setPathCell(map, x, y, 1);
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
  if (tool === 'erase') {
    setCell(map, layer, x, y, LAYER_META[layer].default);
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
  if (editor.brush === 'path') resolvePathTiles(editor, [...unique.values()]);
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
  const visual = ensureTerrainVisual(map);
  const floorHeight = Number(visual?.floorHeightScale) || TILE_SIZE;
  const heights = map.terrain.height;
  const specials = map.terrain.special;
  const collision = map.terrain.collision;
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
    floorHeight,
    specials,
    collision,
  );
  return { w, h, tileH, tileSpecial, inBounds, cornerHeights, visual, floorHeight };
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
const tilePreviewImageCache = new Map();
const rtpksTileThumbUrlCache = new Map();
const rtpksTileMeshPreviewCache = new Map();
const rtpksTextureSamplerCache = new Map();
const RTPKS_TILE_THUMB_SIZE = 128;

function rtpksTileThumbKey(editor, tileId, size = RTPKS_TILE_THUMB_SIZE) {
  return `${editor.tilePackage?.fileName || ''}|${Number(tileId)}|${size}`;
}

function rememberRtpksTileThumb(editor, tileId, dataUrl) {
  if (!dataUrl) return;
  if (!editor._rtpksThumbUrls) editor._rtpksThumbUrls = {};
  editor._rtpksThumbUrls[Number(tileId)] = dataUrl;
}

function cachedRtpksTileThumb(editor, tileId, size = RTPKS_TILE_THUMB_SIZE) {
  const tile = tileEntry(editor, tileId);
  if (tile?.previewImage) {
    rememberRtpksTileThumb(editor, tileId, tile.previewImage);
    return tile.previewImage;
  }
  const local = editor._rtpksThumbUrls?.[Number(tileId)];
  if (local) return local;
  const cached = rtpksTileThumbUrlCache.get(rtpksTileThumbKey(editor, tileId, size));
  if (typeof cached === 'string') {
    rememberRtpksTileThumb(editor, tileId, cached);
    return cached;
  }
  return '';
}

function applyTilePreviewImage(target, src) {
  if (!target || !src) return;
  target.innerHTML = `<img src="${src}" alt="" loading="lazy">`;
}

async function fetchRtpksPreviewMesh(fileName, tileId) {
  const key = `${fileName}|${Number(tileId)}`;
  if (!rtpksTileMeshPreviewCache.has(key)) {
    rtpksTileMeshPreviewCache.set(key, fetch(`/api/tile-packages/mesh?file=${encodeURIComponent(fileName)}&tileId=${encodeURIComponent(Number(tileId))}`)
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload) throw new Error(payload?.error || `Mesh request failed (${res.status})`);
        return payload;
      }));
  }
  return rtpksTileMeshPreviewCache.get(key);
}

function loadPreviewImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load failed: ${url}`));
    img.src = url;
  });
}

function wrap01(value) {
  const wrapped = value - Math.floor(value);
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

async function textureSampler(url) {
  if (!url) return null;
  if (!rtpksTextureSamplerCache.has(url)) {
    rtpksTextureSamplerCache.set(url, loadPreviewImage(url).then((img) => {
      const canvas = document.createElement('canvas');
      const w = Math.max(1, img.naturalWidth || img.width || 1);
      const h = Math.max(1, img.naturalHeight || img.height || 1);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, w, h).data;
      return {
        sample(u, v) {
          const x = Math.min(w - 1, Math.max(0, Math.floor(wrap01(u) * w)));
          const y = Math.min(h - 1, Math.max(0, Math.floor(wrap01(v) * h)));
          const i = (y * w + x) * 4;
          return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
        },
      };
    }));
  }
  return rtpksTextureSamplerCache.get(url);
}

function rtpksMaterial(editor, materialId) {
  return (editor.tilePackage?.materials || []).find((mat) => Number(mat.materialId) === Number(materialId));
}

function meshPreviewVertex(mesh, source, uvs, colors, index, scale, pad, minX, minY) {
  const vi = index * 3;
  const ui = index * 2;
  const x = source?.[vi] ?? 0;
  const y = (mesh.height || 1) - (source?.[vi + 1] ?? 0);
  return {
    x: pad + (x - minX) * scale,
    y: pad + (y - minY) * scale,
    u: uvs?.[ui] ?? 0,
    v: uvs?.[ui + 1] ?? 0,
    r: colors?.[vi] ?? 1,
    g: colors?.[vi + 1] ?? 1,
    b: colors?.[vi + 2] ?? 1,
  };
}

function drawPreviewTriangle(ctx, verts, sampler, fallbackColor) {
  if (!verts.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))) return;
  const u = (verts[0].u + verts[1].u + verts[2].u) / 3;
  const v = (verts[0].v + verts[1].v + verts[2].v) / 3;
  const tex = sampler?.sample(u, v) || fallbackColor;
  if (!tex || tex[3] <= 8) return;
  const vr = (verts[0].r + verts[1].r + verts[2].r) / 3;
  const vg = (verts[0].g + verts[1].g + verts[2].g) / 3;
  const vb = (verts[0].b + verts[1].b + verts[2].b) / 3;
  ctx.fillStyle = `rgba(${Math.round(tex[0] * vr)},${Math.round(tex[1] * vg)},${Math.round(tex[2] * vb)},${Math.min(1, tex[3] / 255)})`;
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  ctx.lineTo(verts[1].x, verts[1].y);
  ctx.lineTo(verts[2].x, verts[2].y);
  ctx.closePath();
  ctx.fill();
}

async function renderRtpksTileCanvasThumbnail(editor, tileId, size = RTPKS_TILE_THUMB_SIZE) {
  const fileName = editor.tilePackage?.fileName;
  if (!fileName) return '';
  const mesh = await fetchRtpksPreviewMesh(fileName, tileId);
  const tile = tileEntry(editor, tileId);
  const fp = tileFootprint(tile);
  const pad = 4;
  const width = Math.max(1, Number(mesh.width || fp.w || 1));
  const height = Math.max(1, Number(mesh.height || fp.h || 1));
  const scale = Math.max(1, Math.min((size - pad * 2) / width, (size - pad * 2) / height));
  const drawW = width * scale;
  const drawH = height * scale;
  const ox = (size - drawW) * 0.5;
  const oy = (size - drawH) * 0.5;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;
  const ranges = Array.isArray(mesh.materialRanges) && mesh.materialRanges.length
    ? mesh.materialRanges
    : [{ materialId: mesh.textureIds?.[0] ?? tile?.materialId ?? 0, triStart: 0, triCount: (mesh.triangles || []).length / 9, quadStart: 0, quadCount: (mesh.quads || []).length / 12 }];
  for (const range of ranges) {
    const material = rtpksMaterial(editor, range.materialId);
    const sampler = material?.textureName
      ? await textureSampler(`/api/tile-packages/texture?file=${encodeURIComponent(fileName)}&texture=${encodeURIComponent(material.textureName)}`)
      : null;
    const fallback = [120, 190, 140, 255];
    for (let i = 0; i < (range.triCount || 0); i += 1) {
      const base = ((range.triStart || 0) + i) * 3;
      drawPreviewTriangle(ctx, [
        meshPreviewVertex(mesh, mesh.triangles, mesh.texCoordsTri, mesh.colorsTri, base, scale, ox, 0, -oy / scale),
        meshPreviewVertex(mesh, mesh.triangles, mesh.texCoordsTri, mesh.colorsTri, base + 1, scale, ox, 0, -oy / scale),
        meshPreviewVertex(mesh, mesh.triangles, mesh.texCoordsTri, mesh.colorsTri, base + 2, scale, ox, 0, -oy / scale),
      ], sampler, fallback);
    }
    for (let i = 0; i < (range.quadCount || 0); i += 1) {
      const base = ((range.quadStart || 0) + i) * 4;
      const verts = [
        meshPreviewVertex(mesh, mesh.quads, mesh.texCoordsQuad, mesh.colorsQuad, base, scale, ox, 0, -oy / scale),
        meshPreviewVertex(mesh, mesh.quads, mesh.texCoordsQuad, mesh.colorsQuad, base + 1, scale, ox, 0, -oy / scale),
        meshPreviewVertex(mesh, mesh.quads, mesh.texCoordsQuad, mesh.colorsQuad, base + 2, scale, ox, 0, -oy / scale),
        meshPreviewVertex(mesh, mesh.quads, mesh.texCoordsQuad, mesh.colorsQuad, base + 3, scale, ox, 0, -oy / scale),
      ];
      drawPreviewTriangle(ctx, [verts[0], verts[1], verts[2]], sampler, fallback);
      drawPreviewTriangle(ctx, [verts[0], verts[2], verts[3]], sampler, fallback);
    }
  }
  return canvas.toDataURL('image/png');
}

function requestRtpksTileThumbnail(editor, tileId, { size = RTPKS_TILE_THUMB_SIZE, onReady } = {}) {
  if (!editor.tilePackage?.fileName || !tileEntry(editor, tileId)) return Promise.resolve('');
  const preview = tileEntry(editor, tileId)?.previewImage;
  if (preview) {
    rememberRtpksTileThumb(editor, tileId, preview);
    onReady?.(preview);
    return Promise.resolve(preview);
  }
  const key = rtpksTileThumbKey(editor, tileId, size);
  const cached = rtpksTileThumbUrlCache.get(key);
  if (typeof cached === 'string') {
    rememberRtpksTileThumb(editor, tileId, cached);
    onReady?.(cached);
    return Promise.resolve(cached);
  }
  if (cached && typeof cached.then === 'function') {
    cached.then((dataUrl) => {
      if (!dataUrl) return;
      rememberRtpksTileThumb(editor, tileId, dataUrl);
      onReady?.(dataUrl);
    });
    return cached;
  }
  const promise = renderRtpksTileCanvasThumbnail(editor, Number(tileId), size)
    .then(async (dataUrl) => {
      if (!(await dataUrlHasVisiblePixels(dataUrl))) {
        return '';
      }
      rtpksTileThumbUrlCache.set(key, dataUrl);
      rememberRtpksTileThumb(editor, tileId, dataUrl);
      onReady?.(dataUrl);
      return dataUrl;
    })
    .catch((error) => {
      console.warn(`RTPKS tile preview failed for tile ${tileId}:`, error);
      rtpksTileThumbUrlCache.delete(key);
      return '';
    });
  rtpksTileThumbUrlCache.set(key, promise);
  return promise;
}

function roofThumbForModel(model, onReady) {
  if (!model) return null;
  const key = `${model.id}|${model.modelHash || ''}`;
  const entry = modelTopThumbCache.get(key);
  if (entry instanceof Image) return entry;
  if (entry === 'pending') return null;
  modelTopThumbCache.set(key, 'pending');
  renderGlbThumbnail(modelAssetUrl(model.id, model), { width: 160, height: 160, yaw: 0, pitch: 88, zoomFactor: 1.0 })
    .then((dataUrl) => {
      const img = new Image();
      img.onload = () => { modelTopThumbCache.set(key, img); onReady?.(); };
      img.onerror = () => { modelTopThumbCache.delete(key); };
      img.src = dataUrl;
    })
    .catch(() => { modelTopThumbCache.delete(key); });
  return null;
}

function tilePreviewImage(editor, tileId, onReady) {
  const tile = tileEntry(editor, tileId);
  const url = cachedRtpksTileThumb(editor, tileId) || tile?.previewImage || '';
  if (!url) return null;
  const key = `${editor.tilePackage?.fileName || ''}|${tileId}|${url}`;
  const cached = tilePreviewImageCache.get(key);
  if (cached instanceof Image) return cached;
  if (cached === 'pending') return null;
  tilePreviewImageCache.set(key, 'pending');
  const img = new Image();
  img.onload = () => { tilePreviewImageCache.set(key, img); onReady?.(); };
  img.onerror = () => { tilePreviewImageCache.delete(key); };
  img.src = url;
  requestRtpksTileThumbnail(editor, tileId, { onReady });
  return null;
}

// Tile-space footprint of a placed prop: catalog w×d (swapped for 90/270 yaw), centered on
// the tile that holds the model's origin. Used to highlight the cells it occupies and to
// position the roof overlay on the 2D grid.
function placedModelFootprint(editor, mdl) {
  const ts = editor.map?.grid?.tileSize || TILE_SIZE;
  const meta = (editor.modelCatalog || []).find((c) => c.id === mdl.id);
  const fp = modelAuthoringFootprint(meta);
  const swap = Math.abs(Math.round((mdl.yawDeg || 0) / 90)) % 2 !== 0;
  const fw = Math.max(1, swap ? fp.d : fp.w);
  const fd = Math.max(1, swap ? fp.w : fp.d);
  const ox = Math.floor((mdl.position?.[0] ?? 0) / ts);
  const oy = Math.floor((mdl.position?.[2] ?? 0) / ts);
  return { meta, fw, fd, ox, oy, tlx: ox - Math.floor((fw - 1) / 2), tly: oy - Math.floor((fd - 1) / 2) };
}

function isTilePlacementMode(editor) {
  return editor.map
    && editor.brush === 'tile'
    && editor.propTool == null
    && editor.tool !== 'fill'
    && editor.tool !== 'eyedropper'
    && editor.tool !== 'raise'
    && editor.tool !== 'lower'
    && editor.tool !== 'erase'
    && editor.tool !== 'clear'
    && editor.tileBrushId != null;
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
  const activeLayerIndex = editor.map.tileLayers?.activeLayer || 0;
  ensureTileLayers(editor.map);
  for (let layerIndex = 0; layerIndex < editor.map.tileLayers.layers.length; layerIndex += 1) {
    const layer = editor.map.tileLayers.layers[layerIndex];
    if (layer.visible === false) continue;
    for (let y = 0; y < editor.map.grid.height; y += 1) {
      for (let x = 0; x < editor.map.grid.width; x += 1) {
        const tileId = layer.cells?.[y]?.[x];
        if (tileId == null || tileId === '') continue;
        const fp = tileFootprint(tileEntry(editor, tileId));
        if (fp.w <= 1 && fp.h <= 1) continue;
        const r = box(x, y, fp.w, fp.h);
        const src = tilePreviewSource(editor, tileId);
        const muted = layerIndex === activeLayerIndex ? '' : ' is-muted-layer';
        const img = src ? `<img src="${src}" alt="" loading="lazy">` : `<span class="map-tile-color" style="background:${tileHashColor(tileId)}"></span>`;
        items.push(`<div class="map-tile-footprint-overlay${muted}" style="left:${r.left}px;top:${r.top}px;width:${r.w}px;height:${r.h}px">${img}${tileSizeLabel(fp) ? `<span class="map-tile-size">${tileSizeLabel(fp)}</span>` : ''}</div>`);
      }
    }
  }
  for (const mdl of (editor.map.models || [])) {
    const fpc = placedModelFootprint(editor, mdl);
    const r = box(fpc.tlx, fpc.tly, fpc.fw, fpc.fd);
    items.push(`<div class="map-prop-roof" style="left:${r.left}px;top:${r.top}px;width:${r.w}px;height:${r.h}px">${roofImg(fpc.meta, mdl.yawDeg)}</div>`);
  }
  if (isTilePlacementMode(editor) && Array.isArray(editor._ghostTile)) {
    const tile = tileEntry(editor, editor.tileBrushId);
    const fp = tileFootprint(tile);
    const [gx, gy] = editor._ghostTile;
    const r = box(gx, gy, fp.w, fp.h);
    const src = tilePreviewSource(editor, editor.tileBrushId);
    const img = src ? `<img src="${src}" alt="" loading="lazy">` : `<span class="map-tile-color" style="background:${tileHashColor(editor.tileBrushId)}"></span>`;
    items.push(`<div class="map-tile-footprint-overlay is-ghost" style="left:${r.left}px;top:${r.top}px;width:${r.w}px;height:${r.h}px">${img}${tileSizeLabel(fp) ? `<span class="map-tile-size">${tileSizeLabel(fp)}</span>` : ''}</div>`);
  }
  if (editor.placeModelId && Array.isArray(editor._ghostTile)) {
    const meta = (editor.modelCatalog || []).find((c) => c.id === editor.placeModelId);
    if (meta) {
      const fp = modelAuthoringFootprint(meta);
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
  const visual = ensureTerrainVisual(map);
  const editor = opts.editor;
  const onTileReady = () => { if (opts.state) refreshMapPreview(opts.state); };

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
      const floorColor = visual?.floorRecolorEnabled && hv > 0 ? visual.floorColors?.[hv] || visual.floorColors?.[1] : null;
      ctx.fillStyle = floorColor || `rgb(${r},${g},${b})`;
      ctx.fillRect(ox + x * cell, oy + z * cell, cell, cell);
      ctx.fillStyle = ((x + z) & 1) === 0 ? 'rgba(255,255,255,.28)' : 'rgba(70,82,94,.15)';
      ctx.fillRect(ox + x * cell, oy + z * cell, cell, cell);
      ctx.fillStyle = floorColor || `rgba(${r},${g},${b},.28)`;
      ctx.fillRect(ox + x * cell, oy + z * cell, cell, cell);
      const tileStack = visibleTileStack(map, x, z);
      if (editor && tileStack.length) {
        for (const item of tileStack) {
          const img = tilePreviewImage(editor, item.tileId, onTileReady);
          if (img) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, ox + x * cell, oy + z * cell, cell, cell);
          } else {
            ctx.fillStyle = tileHashColor(item.tileId);
            ctx.fillRect(ox + x * cell, oy + z * cell, cell, cell);
          }
        }
      }
      const special = specials?.[z]?.[x] ?? 0;
      const eff = effectiveSpecial(special, heights, w, h, x, z);
      if (eff >= SPECIAL.RAMP_N && eff <= SPECIAL.CONCAVE_NW) {
        if (tileStack.length) {
          ctx.strokeStyle = visual?.rampRecolorEnabled ? (visual.rampColor || '#f4d03f') : '#fbbf24';
          ctx.lineWidth = Math.max(1 / zoom, 2 / zoom);
          ctx.strokeRect(ox + x * cell + 1 / zoom, oy + z * cell + 1 / zoom, cell - 2 / zoom, cell - 2 / zoom);
          ctx.fillStyle = 'rgba(17,24,39,.72)';
          ctx.fillRect(ox + x * cell + 2 / zoom, oy + z * cell + 2 / zoom, 10 / zoom, 10 / zoom);
          ctx.fillStyle = '#fef3c7';
          ctx.font = `${8 / zoom}px sans-serif`;
          ctx.fillText(rampIcon(eff), ox + x * cell + 3 / zoom, oy + z * cell + 10 / zoom);
        } else {
          ctx.fillStyle = visual?.rampRecolorEnabled ? `${visual.rampColor}66` : 'rgba(251,191,36,.18)';
          ctx.fillRect(ox + x * cell, oy + z * cell, cell, cell);
        }
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
    const fp = modelAuthoringFootprint(meta);
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
  const { w, h, tileSpecial, inBounds, cornerHeights, visual } = buildPreviewScene(map);
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
      const floorLevel = Math.max(0, Math.round(Math.max(...c) / (Number(visual?.floorHeightScale) || TILE_SIZE)));
      const floorColor = visual?.floorRecolorEnabled && floorLevel > 0 ? visual.floorColors?.[floorLevel] || visual.floorColors?.[1] : null;
      const fill = ramp && visual?.rampRecolorEnabled
        ? visual.rampColor
        : floorColor || (ramp
          ? `rgb(${Math.min(255, rgb[0] + 18)},${Math.min(255, rgb[1] + 24)},${rgb[2]})`
          : `rgb(${rgb.join(',')})`);
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
  if (brush === 'tile') return '';
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
  if (brush === 'tile') return 'Tile brush paints visual RTPKS tile IDs. These are graphics only; collision and ramps stay on their own layers.';
  if (brush === 'path') return 'Path brush paints a logical path mask and resolves it into the configured RTPKS path tile set.';
  if (brush === 'ramp') return 'Ramp brush: cardinals 2–5, corner ramps 6–13. Auto (1) is baked to N/E/S/W on save. Pick a type below.';
  if (brush === 'collision') return 'Blocked brush marks unwalkable tiles (red outline on the grid).';
  return 'Spawn brush sets the player start tile (gold ring).';
}

function rampIcon(id) {
  const icons = {
    0: '·',
    1: '↗',
    2: '↑',
    3: '→',
    4: '↓',
    5: '←',
    6: '◢',
    7: '◣',
    8: '◤',
    9: '◥',
    10: '◰',
    11: '◱',
    12: '◲',
    13: '◳',
  };
  return icons[id] || '?';
}

function rampButtonHtml(ramp, brushVal, esc) {
  return `<button type="button" class="ramp-btn ${brushVal === ramp.id ? 'active' : ''}" data-ramp="${ramp.id}" title="${esc(ramp.label)}" aria-label="${esc(ramp.label)}">
    ${rampMiniPreviewHtml(ramp.id, esc)}
    <span class="ramp-btn-text">${esc(ramp.short)}</span>
  </button>`;
}

function rampMiniPreviewHtml(id, esc) {
  const cells = rampPreviewCells(id)
    .map((cell) => `<span class="ramp-mini-cell ${cell.cls}">${cell.cls.includes('is-ramp') ? esc(rampMiniMark(id)) : ''}</span>`)
    .join('');
  return `<span class="ramp-mini-grid ramp-icon-${id}" aria-hidden="true">${cells}</span>`;
}

function rampMiniMark(id) {
  if (id >= 2 && id <= 5) return rampIcon(id);
  if (id === 1) return 'A';
  if (id >= 6 && id <= 9) return 'c';
  if (id >= 10 && id <= 13) return 'v';
  return '';
}

function rampPreviewCells(id) {
  const empty = () => ({ cls: '', text: '' });
  const cells = Array.from({ length: 9 }, empty);
  const set = (x, y, cls, text = '') => { cells[y * 3 + x] = { cls, text }; };
  set(1, 1, 'is-ramp', rampIcon(id));
  if (id === 2) { set(1, 0, 'is-high', 'H'); set(1, 2, 'is-low', 'L'); set(1, 1, 'is-ramp', '↑'); }
  else if (id === 3) { set(2, 1, 'is-high', 'H'); set(0, 1, 'is-low', 'L'); set(1, 1, 'is-ramp', '→'); }
  else if (id === 4) { set(1, 2, 'is-high', 'H'); set(1, 0, 'is-low', 'L'); set(1, 1, 'is-ramp', '↓'); }
  else if (id === 5) { set(0, 1, 'is-high', 'H'); set(2, 1, 'is-low', 'L'); set(1, 1, 'is-ramp', '←'); }
  else if (id === 6) { set(2, 0, 'is-high', 'H'); set(1, 1, 'is-ramp', 'cNE'); }
  else if (id === 7) { set(2, 2, 'is-high', 'H'); set(1, 1, 'is-ramp', 'cSE'); }
  else if (id === 8) { set(0, 2, 'is-high', 'H'); set(1, 1, 'is-ramp', 'cSW'); }
  else if (id === 9) { set(0, 0, 'is-high', 'H'); set(1, 1, 'is-ramp', 'cNW'); }
  else if (id === 10) { set(0, 0, 'is-high', 'H'); set(2, 2, 'is-high', 'H'); set(0, 2, 'is-high', 'H'); set(2, 0, 'is-low', 'L'); set(1, 1, 'is-ramp', 'vNE'); }
  else if (id === 11) { set(0, 0, 'is-high', 'H'); set(2, 0, 'is-high', 'H'); set(0, 2, 'is-high', 'H'); set(2, 2, 'is-low', 'L'); set(1, 1, 'is-ramp', 'vSE'); }
  else if (id === 12) { set(0, 0, 'is-high', 'H'); set(2, 0, 'is-high', 'H'); set(2, 2, 'is-high', 'H'); set(0, 2, 'is-low', 'L'); set(1, 1, 'is-ramp', 'vSW'); }
  else if (id === 13) { set(2, 0, 'is-high', 'H'); set(2, 2, 'is-high', 'H'); set(0, 2, 'is-high', 'H'); set(0, 0, 'is-low', 'L'); set(1, 1, 'is-ramp', 'vNW'); }
  else if (id === 1) { set(1, 0, 'is-high', '?'); set(1, 2, 'is-low', '?'); set(1, 1, 'is-ramp', 'A'); }
  return cells;
}

function rampSelectionPreviewHtml(selectedId, esc) {
  const id = Number(selectedId) || 0;
  const preset = RAMP_PRESETS.find((r) => r.id === id) || RAMP_PRESETS[0];
  const cells = rampPreviewCells(id)
    .map((cell) => `<span class="ramp-preview-cell ${cell.cls}">${esc(cell.text)}</span>`)
    .join('');
  const hint = id >= 2 && id <= 5
    ? 'Cardinal ramp: arrow points uphill. Side ramps can attach into perpendicular ramp spines.'
    : id >= 6 && id <= 13
      ? 'Corner ramp: H marks the high landing corners it tries to match.'
      : id === 1
        ? 'Auto ramp: baked to a cardinal direction from neighbor heights on save.'
        : 'Flat clears ramp/slope behavior.';
  return `<div class="map-ramp-selected-preview">
    <div class="ramp-preview-grid" aria-hidden="true">${cells}</div>
    <div class="ramp-preview-copy">
      <strong>${esc(preset.label)}</strong>
      <span>${esc(hint)}</span>
      <small><i class="ramp-legend-low"></i>low edge <i class="ramp-legend-high"></i>high / landing edge</small>
    </div>
  </div>`;
}

export function ensureMapEditorState(state) {
  if (!state.mapEditor) {
    state.mapEditor = {
      settings: null,
      resolvedPath: '',
      files: [],
      currentFile: null,
      map: null,
      projects: [],
      project: null,
      projectId: 'default',
      projectValidation: null,
      dirty: false,
      projectDirty: false,
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
      tilePackagesResolvedPath: '',
      tilePackages: [],
      tilePackage: null,
      tileBrushId: null,
      tileSearch: '',
      tilePage: 0,
      activePathSetId: '',
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
      editorZoom: 1,
      showNeighbors: true,
      propTool: null,
      modelSearch: '',
      selectedPlacementIndex: null,
      compileDisplayName: '',
      compileDefaultYaw: 0,
      compileDefaultScale: 1,
      undoStack: [],
      redoStack: [],
    };
  }
  if (state.mapEditor.workspaceView !== '3d') state.mapEditor.workspaceView = '2d';
  if (!state.mapEditor.projects) state.mapEditor.projects = [];
  if (!state.mapEditor.project) state.mapEditor.project = createDefaultProject(state.mapEditor.files || []);
  if (!state.mapEditor.projectId) state.mapEditor.projectId = state.mapEditor.project.id || 'default';
  if (state.mapEditor.projectValidation === undefined) state.mapEditor.projectValidation = null;
  if (state.mapEditor.projectDirty === undefined) state.mapEditor.projectDirty = false;
  if (state.mapEditor.editorZoom === undefined) state.mapEditor.editorZoom = state.mapEditor.project?.editor?.zoom || 1;
  if (state.mapEditor.showNeighbors === undefined) state.mapEditor.showNeighbors = state.mapEditor.project?.editor?.overlays?.neighbors !== false;
  if (state.mapEditor.propTool === undefined) state.mapEditor.propTool = null;
  if (state.mapEditor.modelSearch === undefined) state.mapEditor.modelSearch = '';
  if (state.mapEditor.tileSearch === undefined) state.mapEditor.tileSearch = '';
  if (state.mapEditor.tilePage === undefined) state.mapEditor.tilePage = 0;
  if (!state.mapEditor.tilePackages) state.mapEditor.tilePackages = [];
  if (state.mapEditor.tileBrushId === undefined) state.mapEditor.tileBrushId = null;
  if (state.mapEditor.activePathSetId === undefined) state.mapEditor.activePathSetId = state.mapEditor.project?.pathSets?.[0]?.id || '';
  if (state.mapEditor.selectedPlacementIndex === undefined) state.mapEditor.selectedPlacementIndex = null;
  if (!state.mapEditor.modelCatalog) state.mapEditor.modelCatalog = [];
  if (!Array.isArray(state.mapEditor.undoStack)) state.mapEditor.undoStack = [];
  if (!Array.isArray(state.mapEditor.redoStack)) state.mapEditor.redoStack = [];
  if (state.mapEditor.placeModelId === undefined) state.mapEditor.placeModelId = null;
  if (!state.mapEditor.leftTab) state.mapEditor.leftTab = 'project';
  if (!state.mapEditor.sidebarTab || state.mapEditor.sidebarTab === 'project' || state.mapEditor.sidebarTab === 'maps') state.mapEditor.sidebarTab = 'tiles';
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
  if (!state.mapEditor.mapDimensionsByFile) state.mapEditor.mapDimensionsByFile = {};
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
  const tileId = displayTileCellValue(map, x, y);
  const tile = tileId == null ? null : tileEntry(editor, tileId);
  const footprintHit = visibleTileFootprintAt(editor, map, x, y);
  const activeLayerIndex = map.tileLayers?.activeLayer || 0;
  btn.style.background = '';
  if (tile) {
    const preview = tilePaintVisualUrl(editor, tileId);
    btn.style.backgroundImage = preview ? `linear-gradient(rgba(255,255,255,.08),rgba(255,255,255,.08)), url("${preview}")` : '';
    btn.style.backgroundColor = preview ? '#d8e0e6' : tileHashColor(tileId);
    btn.style.backgroundSize = preview ? 'cover' : '';
    btn.style.backgroundPosition = preview ? 'center' : '';
    if (!preview) {
      requestRtpksTileThumbnail(editor, tileId, { onReady: () => refreshPlacedTileVisuals(editor) });
    }
  } else {
    const rgb = ((x + y) & 1) === 0 ? PREVIEW_TOP_A : PREVIEW_TOP_B;
    btn.style.backgroundColor = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    btn.style.backgroundImage = emptyTileCheckerBackground();
    btn.style.backgroundSize = 'auto';
    btn.style.backgroundPosition = '0 0';
  }
  btn.style.setProperty('--height-overlay', heightOverlayColor(st.hv));
  btn.style.setProperty('--collision-overlay', st.blocked ? 'rgba(220,38,38,.72)' : 'rgba(255,255,255,.035)');
  btn.classList.toggle('is-spawn', st.isSpawn);
  btn.classList.toggle('is-collision', st.blocked);
  btn.classList.toggle('has-ramp', Boolean(st.rampLabel));
  btn.classList.toggle('has-tile', tileId != null);
  btn.classList.toggle('has-tile-footprint', Boolean(footprintHit && (footprintHit.anchorX !== x || footprintHit.anchorY !== y)));
  btn.classList.toggle('is-muted-layer', Boolean(footprintHit && footprintHit.layerIndex !== activeLayerIndex));
  btn.classList.toggle('has-path', pathCellValue(map, x, y) === 1);
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

function placedTileIds(map) {
  if (!map?.tileLayers?.layers) return [];
  const ids = new Set();
  ensureTileLayers(map);
  for (const layer of map.tileLayers.layers) {
    if (layer.visible === false) continue;
    for (const row of (layer.cells || [])) {
      for (const value of (row || [])) {
        if (value != null && value !== '') ids.add(Number(value));
      }
    }
  }
  return Array.from(ids).filter((id) => Number.isFinite(id));
}

function refreshPlacedTileVisuals(editor) {
  if (!editor.map) return;
  document.querySelectorAll('[data-cell]').forEach((btn) => {
    const [x, y] = (btn.dataset.cell || '').split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) syncCellButton(btn, editor.map, x, y, editor);
  });
  refreshPropOverlays(editor);
}

function rememberTileCatalogScroll(editor) {
  const catalog = document.querySelector('#mapTileCatalog');
  if (catalog) editor._tileCatalogScrollTop = catalog.scrollTop;
}

function restoreTileCatalogScroll(editor) {
  const top = editor._tileCatalogScrollTop;
  if (!Number.isFinite(top)) return;
  const catalog = document.querySelector('#mapTileCatalog');
  if (catalog) catalog.scrollTop = top;
}

function syncPaintToolbarState(editor) {
  const undoBtn = document.querySelector('#mapUndo');
  const redoBtn = document.querySelector('#mapRedo');
  if (undoBtn) undoBtn.disabled = !editor.undoStack?.length;
  if (redoBtn) redoBtn.disabled = !editor.redoStack?.length;
  const badges = document.querySelectorAll('.map-editor-commandbar .map-dirty-badge');
  if (badges[0]) {
    badges[0].textContent = editor.dirty ? 'Unsaved changes' : 'Saved';
    badges[0].classList.toggle('clean', !editor.dirty);
  }
  if (badges[1]) {
    badges[1].textContent = editor.projectDirty ? 'Project unsaved' : 'Project saved';
    badges[1].classList.toggle('clean', !editor.projectDirty);
  }
}

function ensurePlacedRtpksTileThumbnails(editor, onReady) {
  if (!editor.map || !editor.tilePackage?.fileName) return;
  for (const tileId of placedTileIds(editor.map)) {
    if (cachedRtpksTileThumb(editor, tileId)) continue;
    requestRtpksTileThumbnail(editor, tileId, {
      onReady: () => onReady?.(tileId),
    });
  }
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
  const projectBadge = editor.projectDirty
    ? '<span class="map-dirty-badge">Project unsaved</span>'
    : '<span class="map-dirty-badge clean">Project saved</span>';

  const fileList = mapDiskFileListHtml(editor, esc);

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
        const tileId = displayTileCellValue(map, x, y);
        const tile = tileId == null ? null : tileEntry(editor, tileId);
        const footprintHit = visibleTileFootprintAt(editor, map, x, y);
        const activeLayerIndex = map.tileLayers?.activeLayer || 0;
        const classes = ['map-cell'];
        if (st.isSpawn) classes.push('is-spawn');
        if (st.blocked) classes.push('is-collision');
        if (st.rampLabel) classes.push('has-ramp');
        if (tileId != null) classes.push('has-tile');
        if (footprintHit && (footprintHit.anchorX !== x || footprintHit.anchorY !== y)) classes.push('has-tile-footprint');
        if (footprintHit && footprintHit.layerIndex !== activeLayerIndex) classes.push('is-muted-layer');
        if (pathCellValue(map, x, y)) classes.push('has-path');
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
        const prop = propCount ? `<span class="cell-prop" title="${propCount} prop${propCount > 1 ? 's' : ''}">${propCount > 1 ? propCount : ''}</span>` : '';
        const tileTexture = tile ? tilePaintVisualUrl(editor, tileId) : '';
        const cellVars = `--height-overlay:${heightOverlayColor(st.hv)};--collision-overlay:${st.blocked ? 'rgba(220,38,38,.72)' : 'rgba(255,255,255,.035)'}`;
        const tileStyle = tile
          ? (tileTexture
            ? `${cellVars};background:#d8e0e6;background-image:linear-gradient(rgba(255,255,255,.08),rgba(255,255,255,.08)),url('${esc(tileTexture)}')`
            : `${cellVars};background:${tileHashColor(tileId)}`)
          : `${cellVars};${emptyTileCheckerStyle(x, y)}`;
        cells.push(`<button type="button" class="${classes.join(' ')}" data-cell="${x},${y}" style="${tileStyle}" aria-label="cell ${x},${y}">${ramp}${prop}${val}</button>`);
      }
    }
    const gridModeCls = [
      placing ? 'is-placing' : (editor.propTool === 'select' ? 'is-prop-select' : ''),
      editor.brush === 'collision' ? 'is-editing-collision' : '',
      editor.brush === 'height' ? 'is-editing-height' : '',
    ].filter(Boolean).join(' ');
    gridHtml = `<div class="map-grid-wrap ${gridModeCls}" id="mapGridWrap"><div class="map-grid" id="mapPaintGrid" style="grid-template-columns:repeat(${w}, 24px)">${cells.join('')}<div class="map-prop-overlay" id="mapPropOverlay"></div></div><div class="map-drag-overlay" id="mapDragOverlay" hidden></div></div>`;
  } else {
    gridHtml = '<p class="hint">Load a map or create a new one to start painting.</p>';
  }

  return `<section class="map-editor-page map-editor-workbench">
    <section class="toolbar map-editor-toolbar map-editor-commandbar">
      <div class="map-workbench-brand">
        <button type="button" class="map-menu-btn" id="mapExitWorkbench">Back to Admin</button>
        <span class="map-menu-title">Pokemon Resort Map Studio</span>
      </div>
      <div class="actions">
        ${projectPickerHtml(editor, esc)}
        ${dirtyBadge}
        ${projectBadge}
        <button type="button" class="btn ghost map-history-btn" id="mapUndo" title="Undo" aria-label="Undo" ${editor.undoStack?.length ? '' : 'disabled'}>${iconHtml('undo')} Undo</button>
        <button type="button" class="btn ghost map-history-btn" id="mapRedo" title="Redo" aria-label="Redo" ${editor.redoStack?.length ? '' : 'disabled'}>${iconHtml('redo')} Redo</button>
        <button type="button" class="btn ghost" id="mapRefreshList">Refresh</button>
        <button type="button" class="btn ghost" id="mapNew">New map</button>
        <button type="button" class="btn ghost" id="mapSaveProject">Save project</button>
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
        <label>RTPKS folder (game assets)
          <input id="mapTilePackagesDirInput" value="${esc(editor.settings?.tilePackagesDirectory || '')}" placeholder="pokemon-resort/assets/overworld/tilepacks">
        </label>
      </div>
      <div class="row" style="margin-top:10px">
        <label>Maps path
          <input readonly value="${esc(editor.resolvedPath || '')}">
        </label>
        <label>Models path
          <input readonly value="${esc(editor.modelsResolvedPath || '')}">
        </label>
        <label>RTPKS path
          <input readonly value="${esc(editor.tilePackagesResolvedPath || '')}">
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
        <label>Save as<input id="mapFileName" value="${esc(editor.currentFile || `${map.id || 'map'}.owmap`)}"></label>
      </div>` : ''}
    </section>
    <section class="map-editor-layout">
      <aside class="panel map-sidebar map-left-panel">
        ${mapAuthoringLayersHtml(editor, esc)}
        <div class="map-sidebar-tabs" role="tablist">
          <button type="button" class="map-sidebar-tab ${editor.leftTab === 'project' ? 'active' : ''}" data-left-tab="project" role="tab">Project</button>
          <button type="button" class="map-sidebar-tab ${editor.leftTab === 'maps' ? 'active' : ''}" data-left-tab="maps" role="tab">Maps</button>
          <button type="button" class="map-sidebar-tab ${editor.leftTab === 'visuals' ? 'active' : ''}" data-left-tab="visuals" role="tab">Visuals</button>
        </div>
        <div class="map-sidebar-panel ${editor.leftTab === 'project' ? '' : 'hidden'}" id="mapSidebarProject" role="tabpanel">
          <h3>${esc(editor.project?.name || 'Project')}</h3>
          ${mapSizePanelHtml(map, esc)}
          ${adjacentActionsHtml(map, esc)}
          ${mapProjectRosterHtml(editor, esc)}
          <div class="map-edge-box">${edgeValidationHtml(editor, esc)}</div>
        </div>
        <div class="map-sidebar-panel ${editor.leftTab === 'maps' ? '' : 'hidden'}" id="mapSidebarMaps" role="tabpanel">
          <h3>Maps (.owmap)</h3>
          <p class="hint">Click a map to load and edit terrain.</p>
          <div class="list map-file-list" id="mapFileList">${fileList}</div>
        </div>
        <div class="map-sidebar-panel ${editor.leftTab === 'visuals' ? '' : 'hidden'}" id="mapSidebarVisuals" role="tabpanel">
          ${map ? terrainVisualHtml(editor, esc) : '<p class="hint">Load a map to edit terrain visuals.</p>'}
        </div>
      </aside>
      <div class="map-workspace">
        <section class="panel">
          <div class="map-tool-rail">
            <div class="map-active-layer-chip" title="Choose the edited layer from the left panel">Layer: <strong>${esc(isPropLayerActive(editor) ? 'Props' : brush === 'tile' ? `Deco ${(editor.map?.tileLayers?.activeLayer || 0) + 1}` : BRUSHES.find((b) => b.id === brush)?.label || 'Paint')}</strong></div>
            <div class="tool-group map-shared-tools" role="group" aria-label="Drawing tools">
              ${TOOLS.map((t) => {
                const disabled = isPropLayerActive(editor) || ((t.id === 'raise' || t.id === 'lower') && brush !== 'height');
                return `<button type="button" class="tool-btn map-tool ${editor.tool === t.id ? 'active' : ''}" data-tool="${t.id}" title="${esc(t.title)}" aria-label="${esc(t.label)}" ${disabled ? 'disabled' : ''}>${iconHtml(t.icon)}<span>${esc(t.label)}</span></button>`;
              }).join('')}
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
              <div class="map-ramp-group"><span>Cardinal</span>${RAMP_PRESETS.filter((r) => r.group === 'cardinal' || r.group === 'base').map((r) => rampButtonHtml(r, brushVal, esc)).join('')}</div>
              <div class="map-ramp-group"><span>Convex</span>${RAMP_PRESETS.filter((r) => r.group === 'convex').map((r) => rampButtonHtml(r, brushVal, esc)).join('')}</div>
              <div class="map-ramp-group"><span>Concave</span>${RAMP_PRESETS.filter((r) => r.group === 'concave').map((r) => rampButtonHtml(r, brushVal, esc)).join('')}</div>
            </div>${rampSelectionPreviewHtml(brushVal, esc)}` : ''}
            <p class="hint" style="margin:8px 0">${esc(brushHint(brush))}</p>
            ${brush === 'tile'
              ? `<div class="map-tile-active-strip">${editor.tileBrushId == null
                ? 'Pick an RTPKS tile from the Tiles workflow.'
                : (() => {
                  const fp = tileFootprint(tileEntry(editor, editor.tileBrushId));
                  const size = tileSizeLabel(fp);
                  return `Painting selected tile${size ? ` · ${size}` : ''}`;
                })()}</div>`
              : brush === 'path'
                ? `<div class="map-tile-active-strip">${activePathSet(editor)
                  ? `Drawing path set <strong>${esc(activePathSet(editor).name || activePathSet(editor).id)}</strong>`
                  : 'Create a path set in the Paths workflow before drawing paths.'}</div>`
              : (brush !== 'spawn' ? `<div class="map-palette" id="mapPalette">${paletteButtons(brush, brushVal, esc)}</div>` : '<p class="hint">Click cells to place spawn.</p>')}
          </div>
        </section>
        ${editor.workspaceView === '3d' && map
          ? '<div class="map-3d-mount" id="map3dMount"><p class="hint map-3d-loading">Building 3D scene…</p></div>'
          : gridHtml}
      </div>
      <aside class="panel map-workflow-panel">
        <div class="map-sidebar-tabs map-workflow-tabs" role="tablist">
          <button type="button" class="map-sidebar-tab ${editor.sidebarTab === 'tiles' ? 'active' : ''}" data-sidebar-tab="tiles" role="tab">Tiles</button>
          <button type="button" class="map-sidebar-tab ${editor.sidebarTab === 'paths' ? 'active' : ''}" data-sidebar-tab="paths" role="tab">Paths</button>
          <button type="button" class="map-sidebar-tab ${editor.sidebarTab === 'props' ? 'active' : ''}" data-sidebar-tab="props" role="tab">3D props</button>
        </div>
        <div class="map-sidebar-panel ${editor.sidebarTab === 'tiles' ? '' : 'hidden'}" id="mapSidebarTiles" role="tabpanel">
          <h3>RTPKS tiles</h3>
          ${tilePackagePickerHtml(editor, esc)}
          <label class="map-model-search">Search tiles
            <input type="search" id="mapTileSearch" placeholder="Search tiles..." value="${esc(editor.tileSearch || '')}" autocomplete="off">
          </label>
          <div class="map-tile-catalog" id="mapTileCatalog">${tileCatalogHtml(editor, esc)}</div>
          ${selectedAssetPreviewHtml(editor, esc, { showTileGlbDownload: true })}
        </div>
        <div class="map-sidebar-panel ${editor.sidebarTab === 'paths' ? '' : 'hidden'}" id="mapSidebarPaths" role="tabpanel">
          <h3>Autotile paths</h3>
          ${pathSetEditorHtml(editor, esc)}
        </div>
        <div class="map-sidebar-panel ${editor.sidebarTab === 'props' ? '' : 'hidden'}" id="mapSidebarProps" role="tabpanel">
          <h3>Prop library</h3>
          ${editor.modelsApiAvailable === false ? `<p class="map-api-warn">${esc(editor.modelsApiHint || 'Restart the Operations Desk to enable model import.')}</p>` : '<p class="hint">GLB models for map props.</p>'}
          <button type="button" class="btn small" id="mapOpenCompileWizard" style="width:100%;margin-bottom:10px" ${editor.modelsApiAvailable === false ? 'disabled' : ''}>Import GLB…</button>
          <label class="map-model-search">Search models
            <input type="search" id="mapModelSearch" placeholder="name or id…" value="${esc(editor.modelSearch || '')}" autocomplete="off">
          </label>
          <div class="map-model-catalog" id="mapModelCatalog">${modelCatalogHtml(editor, esc)}</div>
          ${selectedAssetPreviewHtml(editor, esc)}
          ${placedPropsHtml(editor, esc)}
        </div>
      </aside>
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
          <button type="button" class="map-preview-zoom" data-zoom="reset" title="Reset view" aria-label="Reset view">${iconHtml('rotate-left')}</button>
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
  if (map.tileLayers?.layers?.length) {
    next.tileLayers = {
      ...map.tileLayers,
      layers: map.tileLayers.layers.map((layer) => ({
        ...layer,
        cells: (() => {
          const rows = createTileGrid(width, height, null);
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) rows[y][x] = layer.cells?.[y]?.[x] ?? null;
          }
          return rows;
        })(),
      })),
    };
  }
  if (map.pathLayer?.cells) {
    next.pathLayer = {
      ...map.pathLayer,
      cells: (() => {
        const rows = createTileGrid(width, height, 0);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) rows[y][x] = map.pathLayer.cells?.[y]?.[x] ? 1 : 0;
        }
        return rows;
      })(),
    };
  }
  const sx = Math.min(width - 1, Math.max(0, next.player.spawnTile?.[0] ?? 0));
  const sy = Math.min(height - 1, Math.max(0, next.player.spawnTile?.[1] ?? 0));
  next.player.spawnTile = [sx, sy];
  return next;
}

function expandMapLocal(map, direction, amount) {
  const oldW = map.grid?.width || map.terrain?.height?.[0]?.length || 16;
  const oldH = map.grid?.height || map.terrain?.height?.length || 16;
  const requested = Math.max(1, Math.min(64, Math.floor(Number(amount) || 0)));
  if (!requested) return map;

  let newW = oldW;
  let newH = oldH;
  let offsetX = 0;
  let offsetY = 0;
  switch (direction) {
    case 'north':
      newH = Math.min(128, oldH + requested);
      offsetY = newH - oldH;
      break;
    case 'south':
      newH = Math.min(128, oldH + requested);
      break;
    case 'west':
      newW = Math.min(128, oldW + requested);
      offsetX = newW - oldW;
      break;
    case 'east':
      newW = Math.min(128, oldW + requested);
      break;
    default:
      return map;
  }
  if (newW === oldW && newH === oldH) return map;

  const copyWithOffset = (grid, fill = 0) => {
    const rows = Array.from({ length: newH }, () => Array.from({ length: newW }, () => fill));
    for (let y = 0; y < oldH; y += 1) {
      for (let x = 0; x < oldW; x += 1) {
        rows[y + offsetY][x + offsetX] = grid?.[y]?.[x] ?? fill;
      }
    }
    return rows;
  };

  const next = JSON.parse(JSON.stringify(map));
  const ts = Number(next.grid?.tileSize) || TILE_SIZE;
  next.grid.width = newW;
  next.grid.height = newH;
  next.grid.tileSize = TILE_SIZE;
  next.terrain.height = copyWithOffset(map.terrain?.height, 0);
  next.terrain.special = copyWithOffset(map.terrain?.special, 0);
  next.terrain.collision = copyWithOffset(map.terrain?.collision, 0);
  if (map.tileLayers?.layers?.length) {
    next.tileLayers = {
      ...map.tileLayers,
      layers: map.tileLayers.layers.map((layer) => ({
        ...layer,
        cells: copyWithOffset(layer.cells, null),
      })),
    };
  }
  if (map.pathLayer?.cells) {
    next.pathLayer = {
      ...map.pathLayer,
      cells: copyWithOffset(map.pathLayer.cells, 0).map((row) => row.map((v) => (v ? 1 : 0))),
    };
  }
  if (next.player?.spawnTile) {
    next.player.spawnTile = [
      next.player.spawnTile[0] + offsetX,
      next.player.spawnTile[1] + offsetY,
    ];
  }
  if (offsetX || offsetY) {
    for (const model of next.models || []) {
      if (!Array.isArray(model.position)) continue;
      if (offsetX) model.position[0] += offsetX * ts;
      if (offsetY) model.position[2] += offsetY * ts;
    }
  }
  ensureTileLayers(next);
  ensurePathLayer(next);
  ensureTerrainVisual(next);
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
    tilePackage: null,
    tileLayers: {
      version: 1,
      activeLayer: 0,
      layers: [{ id: 'base', name: 'Base tiles', visible: true, cells: createTileGrid(width, height, null) }],
    },
    pathLayer: { version: 1, activeSetId: '', cells: createTileGrid(width, height, 0) },
    terrainVisual: {
      floorHeightScale: TILE_SIZE,
      floorRecolorEnabled: true,
      floorColors: { 1: '#d84f5f' },
      rampRecolorEnabled: true,
      rampColor: '#f4d03f',
      rampReadability: {
        enabled: true,
        lowShade: 0.88,
        highShade: 1.10,
        bandCount: 5,
        bandStrength: 0.12,
        bandSoftness: 0.32,
      },
    },
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
  ensureTileLayers(map);
  ensurePathLayer(map);
  ensureTerrainVisual(map);
  return map;
}

function applyMapSize(editor, log, render) {
  if (!editor.map) return;
  const before = `${editor.map.grid.width}×${editor.map.grid.height}`;
  beginMapHistory(editor);
  editor.map = readMetaFromDom(editor.map, { resize: true });
  commitMapHistory(editor);
  editor.dirty = true;
  log(`Map resized ${before} → ${editor.map.grid.width}×${editor.map.grid.height}`, 'ok');
  render();
}

function applyMapExpand(editor, log, render) {
  if (!editor.map) return;
  const direction = document.querySelector('#mapExpandDirection')?.value || 'south';
  const amount = Number(document.querySelector('#mapExpandAmount')?.value);
  const before = `${editor.map.grid.width}×${editor.map.grid.height}`;
  beginMapHistory(editor);
  editor.map = expandMapLocal(editor.map, direction, amount);
  commitMapHistory(editor);
  editor.dirty = true;
  log(`Map expanded ${direction} ${before} → ${editor.map.grid.width}×${editor.map.grid.height}`, 'ok');
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
    tilePackage: editor.tilePackage,
  });
}

function syncMapEditorUI(state, { esc, render }) {
  const editor = ensureMapEditorState(state);
  syncWorkspace3DView(editor);
  ensurePlacedRtpksTileThumbnails(editor, () => {
    refreshPlacedTileVisuals(editor);
    refreshMapPreview(state);
  });
  refreshMapPreview(state);
  refreshPropOverlays(editor);
  if (editor.sidebarTab === 'props' && !editor.modelViewportOpen) refreshModelThumbnails(editor);
  refreshRtpksTileThumbnails(editor);
  refreshSelectedAssetPreview(editor);
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

async function loadTilePackage(editor, fileName) {
  if (!fileName) {
    editor.tilePackage = null;
    editor.tileBrushId = null;
    editor._rtpksThumbFile = '';
    editor._rtpksThumbUrls = {};
    return null;
  }
  const res = await fetch(`/api/tile-packages/package?file=${encodeURIComponent(fileName)}`);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.ok) throw new Error(payload.error || `RTPKS load failed (${res.status})`);
  if (editor._rtpksThumbFile !== payload.package.fileName) {
    editor._rtpksThumbFile = payload.package.fileName;
    editor._rtpksThumbUrls = {};
  }
  editor.tilePackage = payload.package;
  const firstTab = editor.tilePackage.tabs?.[0]?.id || '';
  if (!editor.tileTabId || !editor.tilePackage.tabs?.some((tab) => tab.id === editor.tileTabId)) {
    editor.tileTabId = firstTab;
  }
  if (editor.tilePackage.smartSets?.length
      && !editor.tilePackage.smartSets.some((set) => set.id === editor.activePathSetId)) {
    editor.activePathSetId = editor.tilePackage.smartSets[0].id;
  }
  if (editor.tileBrushId == null && editor.tilePackage.tiles?.length) {
    const firstTile = tileCatalogFiltered(editor)[0] || editor.tilePackage.tiles[0];
    editor.tileBrushId = firstTile.resortTileId;
  }
  return editor.tilePackage;
}

function rememberProjectTilePackage(editor, pkg = editor.tilePackage) {
  if (!pkg || !editor.project) return;
  const file = pkg.fileName || pkg.file;
  if (!file) return;
  const id = pkg.packId || file;
  const existing = editor.project.tilePackages.find((item) => item.file === file || item.id === id);
  if (existing) {
    existing.id = id;
    existing.file = file;
    existing.name = pkg.name || existing.name || id;
  } else {
    editor.project.tilePackages.push({ id, file, name: pkg.name || id });
  }
  editor.project.defaultTilePackageId = id;
  editor.projectDirty = true;
}

function syncProjectFromEditor(editor) {
  if (!editor.project) return;
  if (editor.map && editor.currentFile) {
    const mapId = editor.map.id || editor.currentFile.replace(/\.owmap$/i, '');
    let entry = editor.project.maps.find((item) => item.file === editor.currentFile || item.id === mapId);
    if (!entry) {
      entry = {
        id: mapId,
        name: editor.map.name || mapId,
        file: editor.currentFile.endsWith('.owmap') ? editor.currentFile : `${editor.currentFile}.owmap`,
        gridX: editor.project.maps.length,
        gridY: 0,
      };
      editor.project.maps.push(entry);
    }
    entry.id = mapId;
    entry.name = editor.map.name || mapId;
    entry.file = editor.currentFile.endsWith('.owmap') ? editor.currentFile : `${editor.currentFile}.owmap`;
    editor.project.editor.activeMapId = mapId;
  }
  if (editor.tilePackage) rememberProjectTilePackage(editor, editor.tilePackage);
  editor.project.editor.viewMode = editor.workspaceView;
  editor.project.editor.zoom = editor.editorZoom || 1;
  editor.project.editor.overlays = {
    ...(editor.project.editor.overlays || {}),
    values: editor.showCellValues,
    neighbors: editor.showNeighbors,
  };
}

async function saveProject(editor) {
  if (!editor.project) return null;
  syncProjectFromEditor(editor);
  const res = await fetch('/api/map-projects/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: editor.project }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.ok) throw new Error(payload.error || `Project save failed (${res.status})`);
  editor.project = payload.project;
  editor.projectId = payload.project.id;
  const validation = await fetchJsonQuiet(`/api/map-projects/validate?id=${encodeURIComponent(payload.project.id)}`);
  editor.projectValidation = validation?.validation || null;
  editor.projectDirty = false;
  return payload.project;
}

async function loadMapProject(editor, id = editor.projectId || 'default') {
  const res = await fetch(`/api/map-projects/project?id=${encodeURIComponent(id || 'default')}`);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.ok) throw new Error(payload.error || `Project load failed (${res.status})`);
  editor.project = payload.project;
  editor.projectId = payload.project.id;
  editor.activePathSetId = editor.activePathSetId || payload.project.pathSets?.[0]?.id || '';
  editor.editorZoom = payload.project.editor?.zoom || editor.editorZoom || 1;
  editor.workspaceView = payload.project.editor?.viewMode === '3d' ? '3d' : editor.workspaceView;
  editor.showNeighbors = payload.project.editor?.overlays?.neighbors !== false;
  const validation = await fetchJsonQuiet(`/api/map-projects/validate?id=${encodeURIComponent(payload.project.id)}`);
  editor.projectValidation = validation?.validation || null;
  editor.projectDirty = false;
  try {
    await refreshProjectMapDimensions(editor);
  } catch { /* keep editor usable */ }
  return payload.project;
}

function adjacentMapDimensions(direction, anchorWidth, anchorHeight) {
  const w = Number(anchorWidth) > 0 ? Number(anchorWidth) : ADJACENT_STRIP_TILES;
  const h = Number(anchorHeight) > 0 ? Number(anchorHeight) : ADJACENT_STRIP_TILES;
  if (direction === 'west' || direction === 'east') {
    return { width: ADJACENT_STRIP_TILES, height: h };
  }
  return { width: w, height: ADJACENT_STRIP_TILES };
}

function directionLabel(direction) {
  return { north: 'North', east: 'East', south: 'South', west: 'West' }[direction] || direction;
}

function mapGridPositionLabel(map, maps) {
  if (!map) return '';
  const origin = maps.find((entry) => entry.gridX === 0 && entry.gridY === 0) || maps[0];
  if (!origin || map.id === origin.id) return 'Origin · grid 0,0';
  const dx = map.gridX - origin.gridX;
  const dy = map.gridY - origin.gridY;
  const parts = [];
  if (dy < 0) parts.push(`${-dy} tile${-dy === 1 ? '' : 's'} north`);
  if (dy > 0) parts.push(`${dy} tile${dy === 1 ? '' : 's'} south`);
  if (dx < 0) parts.push(`${-dx} tile${-dx === 1 ? '' : 's'} west`);
  if (dx > 0) parts.push(`${dx} tile${dx === 1 ? '' : 's'} east`);
  const relation = parts.length ? parts.join(' · ') : `grid ${map.gridX},${map.gridY}`;
  return `${relation} of ${origin.name || origin.id}`;
}

function mapCompassTag(map, origin) {
  if (!origin || map.id === origin.id) return '★';
  const dx = map.gridX - origin.gridX;
  const dy = map.gridY - origin.gridY;
  if (dx === 0 && dy === -1) return 'N';
  if (dx === 1 && dy === 0) return 'E';
  if (dx === 0 && dy === 1) return 'S';
  if (dx === -1 && dy === 0) return 'W';
  return `${map.gridX},${map.gridY}`;
}

async function refreshProjectMapDimensions(editor) {
  editor.mapDimensionsByFile = editor.mapDimensionsByFile || {};
  const maps = editor.project?.maps || [];
  await Promise.all(maps.map(async (entry) => {
    if (!entry?.file) return;
    try {
      const res = await fetch(`/api/maps/file?file=${encodeURIComponent(entry.file)}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.map?.grid) {
        editor.mapDimensionsByFile[entry.file] = { missing: true };
        return;
      }
      editor.mapDimensionsByFile[entry.file] = {
        width: payload.map.grid.width,
        height: payload.map.grid.height,
      };
    } catch {
      editor.mapDimensionsByFile[entry.file] = { missing: true };
    }
  }));
}

function mapDiskFileListHtml(editor, esc) {
  const projectByFile = new Map((editor.project?.maps || []).map((entry) => [entry.file, entry]));
  const inProject = [];
  const other = [];
  for (const file of editor.files || []) {
    const entry = projectByFile.get(file.name);
    if (entry) inProject.push({ file, entry });
    else other.push(file);
  }
  const renderRow = (file, entry, inProj) => {
    const active = editor.currentFile === file.name ? 'active' : '';
    const dims = editor.mapDimensionsByFile?.[file.name];
    const sizeText = dims?.missing ? 'missing file' : dims ? `${dims.width}×${dims.height}` : '';
    const subtitle = inProj
      ? `${esc(mapGridPositionLabel(entry, editor.project?.maps || []))}${sizeText ? ` · ${esc(sizeText)}` : ''}`
      : esc(file.kind);
    const badge = inProj
      ? (active ? '<span class="map-file-badge current">Current</span>' : '<span class="map-file-badge">In project</span>')
      : '<span class="map-file-badge orphan">Not in project</span>';
    const title = inProj ? esc(entry.name || entry.id) : esc(file.name);
    return `<button type="button" class="map-file-row ${active}" data-map-file="${esc(file.name)}">
      ${badge}
      <span class="map-file-row-main">
        <strong>${title}</strong>
        <span>${subtitle}</span>
        ${inProj ? `<code class="map-file-row-code">${esc(file.name)}</code>` : ''}
      </span>
    </button>`;
  };
  const projectRows = inProject.map(({ file, entry }) => renderRow(file, entry, true)).join('');
  const otherRows = other.map((file) => renderRow(file, null, false)).join('');
  if (!projectRows && !otherRows) return '<p class="hint">No maps in this folder yet.</p>';
  return `${projectRows ? `<div class="map-file-group"><h4>In this project</h4>${projectRows}</div>` : ''}${otherRows ? `<div class="map-file-group"><h4>Other map files</h4>${otherRows}</div>` : ''}`;
}

function adjacentActionsHtml(map, esc) {
  if (!map) {
    return `<div class="map-adjacent-actions" role="group" aria-label="Create adjacent maps">
      <button type="button" class="btn small" data-create-adjacent="north" disabled>North</button>
      <button type="button" class="btn small" data-create-adjacent="west" disabled>West</button>
      <button type="button" class="btn small" data-create-adjacent="east" disabled>East</button>
      <button type="button" class="btn small" data-create-adjacent="south" disabled>South</button>
    </div>`;
  }
  const w = map.grid?.width || ADJACENT_STRIP_TILES;
  const h = map.grid?.height || ADJACENT_STRIP_TILES;
  const dirs = ['north', 'west', 'east', 'south'];
  return `<div class="map-adjacent-actions" role="group" aria-label="Create adjacent maps">
    <p class="hint map-adjacent-hint">Adds a 16-tile strip. The shared edge matches this map (${w}×${h}). Save this map first if you changed its size.</p>
    ${dirs.map((dir) => {
      const dims = adjacentMapDimensions(dir, w, h);
      return `<button type="button" class="btn small map-adjacent-btn" data-create-adjacent="${dir}">
        <span class="map-adjacent-dir">${esc(directionLabel(dir))}</span>
        <span class="map-adjacent-size">${dims.width}×${dims.height}</span>
      </button>`;
    }).join('')}
  </div>`;
}

export async function loadMapEditorListing(state, api) {
  const editor = ensureMapEditorState(state);
  const mapsPayload = await api('/api/maps/list');
  editor.files = mapsPayload.files || [];
  editor.resolvedPath = mapsPayload.base || editor.resolvedPath;
  editor.settings = mapsPayload.settings || editor.settings;

  const projectList = await fetchJsonQuiet('/api/map-projects/list');
  if (projectList?.ok) editor.projects = projectList.projects || [];
  try {
    await loadMapProject(editor, editor.projectId || 'default');
  } catch {
    editor.project = createDefaultProject(editor.files);
    editor.projects = editor.projects?.length ? editor.projects : [{ id: 'default', name: 'Default Project', file: 'default.json', mapCount: editor.project.maps.length }];
  }
  if (!editor.project.maps?.length && editor.files?.length) {
    editor.project = createDefaultProject(editor.files);
    editor.projectDirty = true;
  }
  try {
    await refreshProjectMapDimensions(editor);
  } catch { /* keep editor usable */ }

  const settingsPayload = await fetchJsonQuiet('/api/maps/settings');
  if (settingsPayload?.ok) {
    editor.settings = settingsPayload.settings || editor.settings;
    editor.resolvedPath = settingsPayload.resolvedPath || editor.resolvedPath;
    editor.modelsResolvedPath = settingsPayload.modelsResolvedPath || editor.modelsResolvedPath;
    editor.tilePackagesResolvedPath = settingsPayload.tilePackagesResolvedPath || editor.tilePackagesResolvedPath;
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

  const tilePackagesPayload = await fetchJsonQuiet('/api/tile-packages/list');
  if (tilePackagesPayload?.ok) {
    editor.tilePackages = tilePackagesPayload.packages || [];
    editor.tilePackagesResolvedPath = tilePackagesPayload.base || editor.tilePackagesResolvedPath;
    const linkedFile = editor.map?.tilePackage?.file;
    if (linkedFile && (!editor.tilePackage || editor.tilePackage.fileName !== linkedFile)) {
      await loadTilePackage(editor, linkedFile);
    } else if (!linkedFile && !editor.tilePackage && editor.project?.defaultTilePackageId) {
      const projectPkg = editor.project.tilePackages?.find((pkg) => pkg.id === editor.project.defaultTilePackageId)
        || editor.project.tilePackages?.[0];
      if (projectPkg?.file) {
        try { await loadTilePackage(editor, projectPkg.file); } catch { /* keep unloaded */ }
      }
    }
  }
}

let modelPreviewGen = 0;

function modelCatalogHtml(editor, esc) {
  const filtered = catalogFiltered(editor);
  const cards = filtered.map((m) => {
    const fp = modelAuthoringFootprint(m);
    const active = editor.placeModelId === m.id && editor.propTool === 'place' ? 'active' : '';
    const previewActive = editor.selectedModelId === m.id && editor.modelViewportOpen ? 'previewing' : '';
    return `<div class="map-model-card-wrap" draggable="true" data-drag-model="${esc(m.id)}">
      <div class="map-model-card ${active} ${previewActive}" data-pick-model="${esc(m.id)}" role="button" tabindex="0" title="${esc(m.displayName || m.id)}: click to place, drag onto map">
        <div class="map-model-thumb" data-model-thumb="${esc(m.id)}" aria-hidden="true">
          <img data-model-thumb-img="${esc(m.id)}" alt="" loading="lazy" hidden>
          <span class="map-model-thumb-fallback">${fp.w}×${fp.d}</span>
        </div>
        <div class="map-model-card-actions">
          <button type="button" class="map-model-preview-btn" data-preview-model="${esc(m.id)}" title="3D preview" aria-label="Open 3D preview">${iconHtml('eye')}</button>
          <button type="button" class="map-model-delete-btn" data-delete-model="${esc(m.id)}" title="${editor.modelsDeleteAvailable === false ? 'Restart npm run admin to enable delete' : 'Delete model from disk'}" aria-label="Delete ${esc(m.displayName || m.id)}" ${editor.modelsDeleteAvailable === false ? 'disabled' : ''}>×</button>
        </div>
        <span class="map-model-card-name">${esc(m.displayName || m.id)}</span>
        <span class="map-model-card-meta">${fp.w}×${fp.d}</span>
      </div>
    </div>`;
  }).join('');
  if (!editor.modelCatalog?.length) return '<p class="hint">No compiled models yet. Click <strong>Import GLB…</strong> above.</p>';
  if (!filtered.length) return '<p class="hint">No models match your search.</p>';
  return cards;
}

function tilePackagePickerHtml(editor, esc) {
  const packages = editor.tilePackages || [];
  const options = packages.map((pkg) => {
    const label = pkg.error
      ? `${pkg.fileName} (invalid)`
      : `${pkg.name || pkg.packId || pkg.fileName} · ${pkg.activeTileCount || 0} tiles`;
    return `<option value="${esc(pkg.fileName)}" ${editor.tilePackage?.fileName === pkg.fileName ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
  return `<div class="map-tile-package-box">
    <label>Linked RTPKS package
      <select id="mapTilePackageSelect" ${packages.length ? '' : 'disabled'}>
        <option value="">No RTPKS linked</option>
        ${options}
      </select>
    </label>
    <button type="button" class="btn small" id="mapImportRtpks">Add RTPKS to C++ project…</button>
    <button type="button" class="btn small map-edit-tile-pack" id="mapEditTilePack" ${editor.tilePackage ? '' : 'disabled'}>Edit tile pack…</button>
    <input type="file" id="mapImportRtpksInput" accept=".rtpks,.meta,application/zip" multiple hidden>
    ${editor.tilePackage
      ? `<p class="hint"><code>${esc(editor.tilePackage.gamePath || editor.map?.tilePackage?.path || editor.tilePackage.fileName)}</code></p>`
      : '<p class="hint">Import or select an RTPKS package, then paint visual tiles onto the map.</p>'}
  </div>`;
}

function tileCatalogHtml(editor, esc) {
  const pkg = editor.tilePackage;
  if (!pkg) return '<p class="hint">No RTPKS package selected.</p>';
  if (pkg.error) return `<p class="map-api-warn">${esc(pkg.error)}</p>`;
  const tabs = pkg.tabs || [];
  const tabbar = tabs.length
    ? `<div class="map-tile-tabs">${tabs.map((tab) => `<button type="button" class="map-tile-tab ${editor.tileTabId === tab.id ? 'active' : ''}" data-tile-tab="${esc(tab.id)}" title="${esc(tab.name)}">${esc(tab.name)}</button>`).join('')}</div>`
    : '';
  const filtered = tileCatalogFiltered(editor);
  if (!filtered.length) return `${tabbar}<p class="hint">No tiles match this tab/search.</p>`;
  const visible = filtered;
  const controls = `<div class="map-tile-pagebar">
    <span>${filtered.length} tiles</span>
    <span class="map-tile-pagebar-hint">Scroll library</span>
  </div>`;
  const cards = visible.map((tile) => {
    const active = Number(editor.tileBrushId) === Number(tile.resortTileId) && editor.brush === 'tile' ? 'active' : '';
    const fp = tileFootprint(tile);
    const size = tileSizeLabel(fp);
    const previewSrc = tile.previewImage || cachedRtpksTileThumb(editor, tile.resortTileId);
    const preview = previewSrc
      ? `<img src="${esc(previewSrc)}" alt="" loading="lazy">`
      : `<span class="map-tile-color" style="background:${tileHashColor(tile.resortTileId)}"></span>`;
    return `<button type="button" class="map-tile-card ${active}" data-pick-tile="${tile.resortTileId}" data-rtpks-thumb="${tile.resortTileId}" title="${size ? `${size} tile` : 'Tile'}" style="${tileCardSpanStyle(fp)}">
      <span class="map-tile-preview">${preview}</span>
      ${size ? `<span class="map-tile-size">${esc(size)}</span>` : ''}
    </button>`;
  }).join('');
  return `${tabbar}${controls}<div class="map-tile-stamp-grid">${cards}</div>`;
}

function tileLayerPanelHtml(editor, esc) {
  if (!editor.map) return '';
  ensureTileLayers(editor.map);
  const layers = editor.map.tileLayers.layers || [];
  const canDelete = layers.length > 1;
  return `<div class="map-layer-panel" id="mapTileLayerPanel">
    <div class="map-layer-panel-head">
      <strong>Tile levels</strong>
      <span>${layers.length}</span>
    </div>
    <div class="map-layer-stack" aria-label="Tile level selector">
      ${layers.map((layer, index) => `<button type="button" class="map-layer-level ${editor.map.tileLayers.activeLayer === index ? 'active' : ''} ${layer.visible === false ? 'off' : ''}" data-active-tile-layer="${index}" title="Paint level ${index + 1}" aria-label="Paint level ${index + 1}">
        <span></span>
      </button>`).reverse().join('')}
    </div>
    <div class="map-layer-visibility" aria-label="Tile level visibility">
      ${layers.map((layer, index) => `<button type="button" class="map-layer-eye ${layer.visible === false ? 'off' : ''}" data-toggle-tile-layer="${index}" title="${layer.visible === false ? 'Show' : 'Hide'} level ${index + 1}" aria-label="${layer.visible === false ? 'Show' : 'Hide'} level ${index + 1}">
        ${iconHtml('eye')}
      </button>`).join('')}
    </div>
    <button type="button" class="map-layer-delete" data-delete-tile-layer ${canDelete ? '' : 'disabled'} title="${canDelete ? 'Delete active decoration layer' : 'At least one decoration layer is required'}">Delete layer</button>
  </div>`;
}

function mapAuthoringLayersHtml(editor, esc) {
  if (!editor.map) return '<div class="map-authoring-layers"><p class="hint">Load a map to edit layers.</p></div>';
  ensureTileLayers(editor.map);
  const activeTileLayer = editor.map.tileLayers.activeLayer || 0;
  const sysLayers = [
    { id: 'height', label: 'Height', brush: 'height', active: editor.brush === 'height' },
    { id: 'collision', label: 'Collision', brush: 'collision', active: editor.brush === 'collision' },
    { id: 'special', label: 'Modifiers', brush: 'ramp', active: editor.brush === 'ramp' },
    { id: 'path', label: 'Paths', brush: 'path', active: editor.brush === 'path' },
    { id: 'spawn', label: 'Spawn', brush: 'spawn', active: editor.brush === 'spawn' },
  ];
  const layers = editor.map.tileLayers.layers || [];
  const decoRows = layers.map((layer, index) => {
    const top = index === layers.length - 1;
    const base = index === 0;
    const order = top ? 'TOP' : (base ? 'BASE' : `L${index + 1}`);
    return `
    <div class="map-authoring-row ${editor.brush === 'tile' && activeTileLayer === index ? 'active' : ''} ${layer.visible === false ? 'off' : ''}">
      <button type="button" class="map-authoring-pick" data-active-tile-layer="${index}" title="Edit decoration layer ${index + 1}">
        <span class="map-layer-swatch"></span>
        <strong>Deco ${index + 1}</strong>
        <em>${esc(order)}</em>
      </button>
      <button type="button" class="map-authoring-eye ${layer.visible === false ? 'off' : ''}" data-toggle-tile-layer="${index}" title="${layer.visible === false ? 'Show' : 'Hide'} decoration layer ${index + 1}" aria-label="${layer.visible === false ? 'Show' : 'Hide'} decoration layer ${index + 1}">
        ${iconHtml('eye')}
      </button>
    </div>`;
  }).join('');
  const canAdd = layers.length < MAX_TILE_LAYERS;
  const canDelete = layers.length > 1;
  const propsActive = isPropLayerActive(editor);
  return `<section class="map-authoring-layers" id="mapTileLayerPanel">
    <header>
      <strong>Layers</strong>
      <span>${esc(propsActive ? 'Props' : editor.brush === 'tile' ? `Deco ${activeTileLayer + 1}` : BRUSHES.find((b) => b.id === editor.brush)?.label || 'Paint')}</span>
    </header>
    <div class="map-authoring-system">
      ${sysLayers.map((layer) => `<button type="button" class="map-authoring-system-btn ${layer.active ? 'active' : ''}" data-map-layer-brush="${layer.brush}" title="Edit ${esc(layer.label)} layer">${esc(layer.label)}</button>`).join('')}
      <button type="button" class="map-authoring-system-btn map-authoring-props ${propsActive ? 'active' : ''}" data-map-prop-layer title="Edit placed props">Props</button>
    </div>
    <div class="map-authoring-deco">
      ${decoRows}
    </div>
    <div class="map-authoring-layer-actions">
      <button type="button" class="map-authoring-add" data-add-tile-layer ${canAdd ? '' : 'disabled'} title="${canAdd ? 'Add decoration layer' : `Maximum ${MAX_TILE_LAYERS} decoration layers`}">Add ${layers.length}/${MAX_TILE_LAYERS}</button>
      <button type="button" class="map-authoring-delete" data-delete-tile-layer ${canDelete ? '' : 'disabled'} title="${canDelete ? 'Delete active decoration layer' : 'At least one decoration layer is required'}">Delete</button>
    </div>
  </section>`;
}

function selectedAssetPreviewHtml(editor, esc, { showTileGlbDownload = false } = {}) {
  let title = 'Selected preview';
  let meta = 'Pick a tile or prop to preview it before placement.';
  if (editor.sidebarTab === 'props' && editor.placeModelId) {
    const model = catalogEntry(editor, editor.placeModelId);
    const fp = modelAuthoringFootprint(model);
    title = esc(model?.displayName || editor.placeModelId);
    meta = `${fp.w}x${fp.d} footprint`;
  } else if (editor.tileBrushId != null) {
    const tile = tileEntry(editor, editor.tileBrushId);
    const fp = tileFootprint(tile);
    const size = tileSizeLabel(fp);
    title = 'Selected tile';
    meta = size ? `${size} footprint` : '1x1 tile';
  }
  const canDownloadTileGlb = showTileGlbDownload
    && editor.tileBrushId != null
    && editor.tilePackage?.fileName;
  const downloadBtn = canDownloadTileGlb
    ? `<button type="button" class="map-selected-preview-download" id="mapSelectedTileGlbDownload" title="Download tile GLB" aria-label="Download tile GLB">${iconHtml('download')}</button>`
    : '';
  return `<section class="map-selected-preview" id="mapSelectedPreview" aria-live="polite">
    <header>
      <strong>${title}</strong>
      <span>${esc(meta)}</span>
    </header>
    <div class="map-selected-preview-viewport">
      ${downloadBtn}
      <div class="map-selected-preview-frame" id="mapSelectedPreviewFrame">
        <p class="hint">No selection</p>
      </div>
    </div>
  </section>`;
}

function projectPickerHtml(editor, esc) {
  const projects = editor.projects?.length ? editor.projects : [{ id: editor.project?.id || 'default', name: editor.project?.name || 'Default Project', mapCount: editor.project?.maps?.length || 0 }];
  const options = projects.map((project) => `<option value="${esc(project.id)}" ${project.id === editor.projectId ? 'selected' : ''}>${esc(project.name || project.id)} · ${project.mapCount || 0} maps</option>`).join('');
  return `<label class="map-project-picker">Project
    <select id="mapProjectSelect">${options}</select>
  </label>`;
}

function mapSizePanelHtml(map, esc) {
  if (!map) {
    return '<p class="hint">Load a map to edit size.</p>';
  }
  const w = map.grid?.width || 16;
  const h = map.grid?.height || 16;
  return `<div class="map-size-panel">
    <h4>Map size</h4>
    <div class="map-size-fields">
      <label>Width<input id="mapWidth" type="number" min="4" max="128" value="${w}"></label>
      <label>Height<input id="mapHeight" type="number" min="4" max="128" value="${h}"></label>
    </div>
    <button type="button" class="btn small" id="mapApplySize">Apply size</button>
    <h4>Increase size</h4>
    <p class="hint">Add empty cells on one edge. Existing terrain stays in place.</p>
    <label class="map-size-direction">Direction
      <select id="mapExpandDirection">
        <option value="north">North (rows on top)</option>
        <option value="south" selected>South (rows on bottom)</option>
        <option value="west">West (columns on left)</option>
        <option value="east">East (columns on right)</option>
      </select>
    </label>
    <label>Cells to add<input id="mapExpandAmount" type="number" min="1" max="64" value="1"></label>
    <button type="button" class="btn small" id="mapExpandSize">Increase size</button>
  </div>`;
}

function mapProjectRosterHtml(editor, esc) {
  const maps = [...(editor.project?.maps || [])].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
  const activeId = editor.map?.id || editor.project?.editor?.activeMapId || '';
  const origin = maps.find((entry) => entry.gridX === 0 && entry.gridY === 0) || maps[0];
  if (!maps.length) {
    return `<div class="map-roster-empty">
      <p class="hint">No maps in this project yet. Save the current map or add an adjacent map.</p>
    </div>`;
  }
  const cards = maps.map((map) => {
    const active = map.id === activeId || map.file === editor.currentFile;
    const dims = editor.mapDimensionsByFile?.[map.file];
    const sizeText = dims?.missing ? 'file missing' : dims ? `${dims.width}×${dims.height}` : '…';
    return `<button type="button" class="map-roster-card${active ? ' active' : ''}" data-project-map="${esc(map.id)}">
      <div class="map-roster-card-head">
        <span class="map-roster-badge${active ? '' : ' subtle'}">${active ? 'Current map' : mapCompassTag(map, origin)}</span>
        <span class="map-roster-size">${esc(sizeText)} tiles</span>
      </div>
      <input type="text" class="map-roster-name" data-project-map-name="${esc(map.id)}" value="${esc(map.name || map.id)}" aria-label="Map display name">
      <div class="map-roster-meta">
        <span class="map-roster-position">${esc(mapGridPositionLabel(map, maps))}</span>
        <code class="map-roster-file">${esc(map.file)}</code>
      </div>
    </button>`;
  }).join('');
  return `<div class="map-project-maps">
    <h4 class="map-project-maps-title">Project maps (${maps.length})</h4>
    <p class="hint map-roster-hint">Click a map to edit it. Rename inline — saved with the project.</p>
    <div class="map-roster">${cards}</div>
    ${mapCompassGridHtml(editor, esc, maps, origin)}
  </div>`;
}

function mapCompassGridHtml(editor, esc, maps, origin) {
  if (!maps.length) return '';
  const activeId = editor.map?.id || editor.project?.editor?.activeMapId || '';
  const minX = Math.min(...maps.map((map) => map.gridX), 0);
  const maxX = Math.max(...maps.map((map) => map.gridX), 0);
  const minY = Math.min(...maps.map((map) => map.gridY), 0);
  const maxY = Math.max(...maps.map((map) => map.gridY), 0);
  const byCell = new Map(maps.map((map) => [`${map.gridX},${map.gridY}`, map]));
  const rows = [];
  for (let y = minY; y <= maxY; y += 1) {
    const cells = [];
    for (let x = minX; x <= maxX; x += 1) {
      const map = byCell.get(`${x},${y}`);
      if (!map) {
        cells.push('<span class="map-matrix-cell empty" aria-hidden="true"></span>');
      } else {
        const active = map.id === activeId || map.file === editor.currentFile ? 'active' : '';
        const dims = editor.mapDimensionsByFile?.[map.file];
        const sizeText = dims && !dims.missing ? `${dims.width}×${dims.height}` : '?';
        cells.push(`<button type="button" class="map-matrix-cell ${active}" data-project-map="${esc(map.id)}" title="${esc(map.name || map.id)} · ${esc(map.file)}">
          <span class="map-matrix-tag">${esc(mapCompassTag(map, origin))}</span>
          <strong>${esc(map.name || map.id)}</strong>
          <span>${esc(sizeText)}</span>
        </button>`);
      }
    }
    rows.push(`<div class="map-matrix-row">${cells.join('')}</div>`);
  }
  return `<div class="map-compass-wrap"><h4 class="map-project-maps-title">Layout</h4><div class="map-matrix">${rows.join('')}</div></div>`;
}

function mapMatrixHtml(editor, esc) {
  const maps = editor.project?.maps || [];
  const activeId = editor.map?.id || editor.project?.editor?.activeMapId || '';
  if (!maps.length) {
    return `<div class="map-matrix-empty">
      <p class="hint">Save this map to add it to the project matrix.</p>
    </div>`;
  }
  const minX = Math.min(...maps.map((map) => map.gridX), 0);
  const maxX = Math.max(...maps.map((map) => map.gridX), 0);
  const minY = Math.min(...maps.map((map) => map.gridY), 0);
  const maxY = Math.max(...maps.map((map) => map.gridY), 0);
  const byCell = new Map(maps.map((map) => [`${map.gridX},${map.gridY}`, map]));
  const rows = [];
  for (let y = minY; y <= maxY; y += 1) {
    const cells = [];
    for (let x = minX; x <= maxX; x += 1) {
      const map = byCell.get(`${x},${y}`);
      if (!map) {
        cells.push('<span class="map-matrix-cell empty"></span>');
      } else {
        const active = map.id === activeId || map.file === editor.currentFile ? 'active' : '';
        cells.push(`<button type="button" class="map-matrix-cell ${active}" data-project-map="${esc(map.id)}" title="${esc(map.file)}">
          <strong>${esc(map.name || map.id)}</strong>
          <span>${esc(map.file)}</span>
        </button>`);
      }
    }
    rows.push(`<div class="map-matrix-row">${cells.join('')}</div>`);
  }
  return `<div class="map-matrix">${rows.join('')}</div>`;
}

function edgeValidationHtml(editor, esc) {
  const warnings = editor.projectValidation?.warnings || validateMapEdges(editor);
  if (!warnings.length) return '<p class="map-edge-ok">Adjacent map edges line up.</p>';
  return `<ul class="map-edge-warnings">${warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul>`;
}

function validateMapEdges(editor) {
  const project = editor.project;
  const active = editor.map;
  if (!project || !active) return [];
  const entry = project.maps.find((map) => map.id === active.id || map.file === editor.currentFile);
  if (!entry) return [];
  const warnings = [];
  const neighborAt = (dx, dy) => project.maps.find((map) => map.gridX === entry.gridX + dx && map.gridY === entry.gridY + dy);
  const dirs = [
    ['north', 0, -1],
    ['east', 1, 0],
    ['south', 0, 1],
    ['west', -1, 0],
  ];
  for (const [name, dx, dy] of dirs) {
    const neighbor = neighborAt(dx, dy);
    if (!neighbor) continue;
    warnings.push(`Check ${name} edge against ${neighbor.file}; open the neighbor to compare exact heights before export.`);
  }
  return warnings;
}

function pathSetOptionsHtml(editor, esc) {
  const sets = (editor.tilePackage?.smartSets || []).map((set) => ({ ...set, name: `${set.name || set.id} · RTPKS` }));
  if (!sets.length) return '<option value="">No RTPKS smart set available</option>';
  return sets.map((set) => `<option value="${esc(set.id)}" ${set.id === (editor.activePathSetId || editor.map?.pathLayer?.activeSetId) ? 'selected' : ''}>${esc(set.name || set.id)}</option>`).join('');
}

function smartSetPreviewHtml(editor, set, esc) {
  const width = Math.max(1, Number(set?.width || 5));
  const height = Math.max(1, Number(set?.height || 3));
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tileId = Number(set?.grid?.[x]?.[y]);
      const src = Number.isFinite(tileId) && tileId >= 0 ? tilePreviewSource(editor, tileId) : '';
      cells.push(`<span class="map-smart-preview-cell">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ''}</span>`);
    }
  }
  return `<div class="map-smart-preview-grid" style="grid-template-columns:repeat(${width}, 22px)">${cells.join('')}</div>`;
}

function smartSetCardsHtml(editor, esc) {
  const sets = editor.tilePackage?.smartSets || [];
  if (!sets.length) return '';
  const activeId = editor.activePathSetId || editor.map?.pathLayer?.activeSetId || sets[0].id;
  return `<div class="map-smart-card-grid">${sets.map((set) => `<button type="button" class="map-smart-card ${set.id === activeId ? 'active' : ''}" data-smart-set-card="${esc(set.id)}" title="${esc(set.name || set.id)}">
    ${smartSetPreviewHtml(editor, set, esc)}
    <span>${esc(set.name || set.id)}</span>
  </button>`).join('')}</div>`;
}

function pathSetEditorHtml(editor, esc) {
  const set = activePathSet(editor);
  return `<div class="map-path-panel">
    <div class="map-path-actions">
      <label>Path set
        <select id="mapPathSetSelect">${pathSetOptionsHtml(editor, esc)}</select>
      </label>
    </div>
    ${smartSetCardsHtml(editor, esc)}
    ${set ? `<p class="hint">Using RTPKS smart tiles baked from PDSMS.</p>`
      : '<p class="hint">Re-export this RTPKS from PDSMS with smart grids to use smart path drawing.</p>'}
  </div>`;
}

function terrainVisualHtml(editor, esc) {
  const visual = ensureTerrainVisual(editor.map);
  if (!visual) return '';
  return `<div class="map-visual-panel">
    <h3>Terrain visuals</h3>
    <label>Height per floor
      <input id="mapFloorHeightScale" type="number" min="1" max="64" step="1" value="${esc(visual.floorHeightScale)}">
    </label>
    <label class="map-inline-check"><input id="mapFloorRecolorEnabled" type="checkbox" ${visual.floorRecolorEnabled ? 'checked' : ''}> Recolor floors</label>
    <label>First floor color
      <input id="mapFloorColor1" type="color" value="${esc(visual.floorColors?.[1] || '#d84f5f')}">
    </label>
    <label class="map-inline-check"><input id="mapRampRecolorEnabled" type="checkbox" ${visual.rampRecolorEnabled ? 'checked' : ''}> Recolor ramps</label>
    <label>Ramp color
      <input id="mapRampColor" type="color" value="${esc(visual.rampColor || '#f4d03f')}">
    </label>
    <label class="map-inline-check"><input id="mapRampReadabilityEnabled" type="checkbox" ${visual.rampReadability?.enabled !== false ? 'checked' : ''}> Textured ramp readability</label>
    <div class="map-visual-row">
      <label>Low shade <input id="mapRampReadabilityLow" type="number" min="0" max="4" step="0.01" value="${esc(visual.rampReadability?.lowShade ?? 0.88)}"></label>
      <label>High shade <input id="mapRampReadabilityHigh" type="number" min="0" max="4" step="0.01" value="${esc(visual.rampReadability?.highShade ?? 1.10)}"></label>
    </div>
    <div class="map-visual-row">
      <label>Bands <input id="mapRampReadabilityBands" type="number" min="0" max="64" step="0.5" value="${esc(visual.rampReadability?.bandCount ?? 5)}"></label>
      <label>Band strength <input id="mapRampReadabilityBandStrength" type="number" min="0" max="1" step="0.01" value="${esc(visual.rampReadability?.bandStrength ?? 0.12)}"></label>
      <label>Softness <input id="mapRampReadabilityBandSoftness" type="number" min="0.03" max="0.49" step="0.01" value="${esc(visual.rampReadability?.bandSoftness ?? 0.32)}"></label>
    </div>
    <label>3D light preset
      <select id="mapLightPreset">
        <option value="day" ${visual.lightPreset === 'day' ? 'selected' : ''}>Day</option>
        <option value="sunset" ${visual.lightPreset === 'sunset' ? 'selected' : ''}>Sunset / sunrise</option>
        <option value="night" ${visual.lightPreset === 'night' ? 'selected' : ''}>Night</option>
      </select>
    </label>
    <div class="map-visual-row">
      <label>Yaw° <input id="mapLightYaw" type="number" min="-180" max="180" step="1" value="${esc(visual.lightYawDeg)}"></label>
      <label>Pitch° <input id="mapLightPitch" type="number" min="5" max="85" step="1" value="${esc(visual.lightPitchDeg)}"></label>
    </div>
  </div>`;
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
    ? `<p class="map-place-active">Placing <strong>${esc(catalogEntry(editor, editor.placeModelId)?.displayName || editor.placeModelId)}</strong>: click or drag onto the grid. Use the select tool in the toolbar to move it.</p>`
    : '<p class="hint">Click a prop to arm placement, or drag it onto the map. Use the select tool in the toolbar to select and drag placed props.</p>';
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
      <p><strong>Step 1: Upload model .zip</strong></p>
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
        <p><strong>Step 2: GLB archive</strong></p>
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
      return `<li class="${cls}"><strong>${esc(row.name)}</strong>: ${status}</li>`;
    }).join('') || '<li class="warn">No materials in MTL: compile will use a gray fallback texture.</li>';
    const canFix = mtl?.materials?.some((r) => r.mapKd && !r.ok);
    body = `<div class="map-compile-review">
      <p><strong>Step 2: Verify materials &amp; textures</strong></p>
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
      <p><strong>Step 3: Importing…</strong></p>
      <p class="hint">Saving GLB (or converting OBJ→GLB with alpha) and writing <code>model.json</code>.</p>
    </div>`;
  } else if (step === 4) {
    const done = editor.compileResult || {};
    body = `<div class="map-compile-done">
      <p><strong>Step 4: Saved</strong></p>
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
    throw new Error('Model id is required: use letters, numbers, underscore, or hyphen (e.g. pokemon_center).');
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

const modelThumbCache = new Map();
const modelThumbPending = new Set();

function setModelThumbElement(el, dataUrl) {
  const img = el?.querySelector?.('[data-model-thumb-img]');
  if (!img || !dataUrl) return;
  img.src = dataUrl;
  img.hidden = false;
  el.classList.add('has-image');
}

function requestModelThumbnail(model, options = {}) {
  if (!model?.id) return Promise.resolve('');
  const key = [
    model.id,
    model.modelHash || '',
    options.width || 180,
    options.height || 132,
    options.yaw ?? 0,
    options.pitch ?? 18,
    options.zoomFactor ?? 0.86,
  ].join('|');
  const cached = modelThumbCache.get(key);
  if (typeof cached === 'string') return Promise.resolve(cached);
  if (cached && typeof cached.then === 'function') return cached;
  const promise = renderGlbThumbnail(modelAssetUrl(model.id, model), {
    width: options.width || 180,
    height: options.height || 132,
    yaw: options.yaw ?? 0,
    pitch: options.pitch ?? 18,
    zoomFactor: options.zoomFactor ?? 0.86,
  })
    .then(async (dataUrl) => {
      if (!(await dataUrlHasVisiblePixels(dataUrl))) {
        modelThumbCache.delete(key);
        return '';
      }
      modelThumbCache.set(key, dataUrl);
      return dataUrl;
    })
    .catch((error) => {
      console.warn(`Model thumbnail failed for ${model.id}:`, error);
      modelThumbCache.delete(key);
      return '';
    });
  modelThumbCache.set(key, promise);
  return promise;
}

// Render each catalog card as a real front-face snapshot of the model (cached per
// id+hash), falling back to the footprint diagram while the GLB renders. This is the
// "preview of the model" used to lay out maps, plus its tile footprint/area.
function refreshModelThumbnails(editor) {
  document.querySelectorAll('[data-model-thumb]').forEach((thumb) => {
    const id = thumb.dataset.modelThumb;
    const model = (editor.modelCatalog || []).find((m) => m.id === id);
    if (!model) return;
    const pendingKey = `${id}|${model.modelHash || ''}`;
    if (modelThumbPending.has(pendingKey)) return;
    modelThumbPending.add(pendingKey);
    requestModelThumbnail(model, { width: 180, height: 132, pitch: 18, zoomFactor: 0.82 })
      .then((dataUrl) => {
        if (dataUrl && thumb.isConnected && thumb.dataset.modelThumb === id) {
          setModelThumbElement(thumb, dataUrl);
        }
      })
      .finally(() => modelThumbPending.delete(pendingKey));
  });
}

function refreshRtpksTileThumbnails(editor) {
  if (!editor.tilePackage?.fileName) return;
  if (editor._tileThumbObserver) {
    editor._tileThumbObserver.disconnect();
    editor._tileThumbObserver = null;
  }
  const root = document.querySelector('.map-tile-catalog');
  const renderCard = (btn) => {
    const tileId = Number(btn.dataset.rtpksThumb);
    const target = btn.querySelector('.map-tile-preview');
    if (!target || !tileEntry(editor, tileId)) return;
    const cached = cachedRtpksTileThumb(editor, tileId);
    if (cached) {
      applyTilePreviewImage(target, cached);
      return;
    }
    requestRtpksTileThumbnail(editor, tileId, {
      onReady: (dataUrl) => {
        if (!dataUrl || !btn.isConnected || Number(btn.dataset.rtpksThumb) !== tileId) return;
        applyTilePreviewImage(target, dataUrl);
        refreshPlacedTileVisuals(editor);
      },
    });
  };

  if ('IntersectionObserver' in window && root) {
    editor._tileThumbObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const btn = entry.target;
        editor._tileThumbObserver?.unobserve(btn);
        renderCard(btn);
      }
    }, { root, rootMargin: '240px 0px' });
  }

  const thumbButtons = document.querySelectorAll('[data-rtpks-thumb]');
  thumbButtons.forEach((btn) => {
    const tileId = Number(btn.dataset.rtpksThumb);
    const target = btn.querySelector('.map-tile-preview');
    const cached = cachedRtpksTileThumb(editor, tileId);
    if (cached) {
      applyTilePreviewImage(target, cached);
      return;
    }
    const cardRect = btn.getBoundingClientRect();
    const rootRect = root?.getBoundingClientRect();
    const visibleNow = rootRect
      ? cardRect.bottom >= rootRect.top - 240 && cardRect.top <= rootRect.bottom + 240
      : cardRect.bottom >= -240 && cardRect.top <= window.innerHeight + 240;
    if (visibleNow) renderCard(btn);
    else if (editor._tileThumbObserver) editor._tileThumbObserver.observe(btn);
    else renderCard(btn);
  });
}

function paintSelectedPreviewFrame(frame, dataUrl, label = '') {
  frame.innerHTML = `<img src="${dataUrl}" alt="${label}" loading="lazy">`;
}

function disposeSelectedAssetPreview(editor, frame = null) {
  editor._selectedAssetPreviewToken = (Number(editor._selectedAssetPreviewToken) || 0) + 1;
  if (editor._selectedAssetPreview3d?.dispose) {
    editor._selectedAssetPreview3d.dispose();
  }
  editor._selectedAssetPreview3d = null;
  if (frame) frame.innerHTML = '';
}

function dataUrlHasVisiblePixels(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, img.naturalWidth || img.width);
      canvas.height = Math.max(1, img.naturalHeight || img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(true); return; }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 8) { resolve(true); return; }
      }
      resolve(false);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

function refreshSelectedAssetPreview(editor) {
  const frame = document.querySelector('#mapSelectedPreviewFrame');
  if (!frame) return;
  if (editor.sidebarTab === 'props' && editor.placeModelId) {
    disposeSelectedAssetPreview(editor, frame);
    const model = catalogEntry(editor, editor.placeModelId);
    if (!model) {
      frame.innerHTML = '<p class="hint">No prop selected</p>';
      return;
    }
    frame.innerHTML = '<p class="hint">Rendering preview...</p>';
    requestModelThumbnail(model, { width: 320, height: 220, yaw: 0, pitch: 18, zoomFactor: 0.9 })
      .then((dataUrl) => {
        if (frame.isConnected && dataUrl) paintSelectedPreviewFrame(frame, dataUrl, model.displayName || model.id);
        else if (frame.isConnected) frame.innerHTML = '<p class="hint">Preview unavailable</p>';
      })
      .catch(() => {
        if (frame.isConnected) frame.innerHTML = '<p class="hint">Preview unavailable</p>';
      });
    return;
  }
  if (editor.tileBrushId != null && editor.tilePackage?.fileName) {
    const tileId = Number(editor.tileBrushId);
    const tile = tileEntry(editor, tileId);
    const fileName = editor.tilePackage.fileName;
    if (!tile) {
      disposeSelectedAssetPreview(editor, frame);
      frame.innerHTML = '<p class="hint">No tile selected</p>';
      return;
    }
    const key = `tile3d|${fileName}|${tileId}`;
    if (editor._selectedAssetPreview3d?.key === key && editor._selectedAssetPreview3d.host === frame && frame.isConnected) {
      return;
    }
    disposeSelectedAssetPreview(editor, frame);
    frame.innerHTML = '<p class="hint">Loading 3D preview...</p>';
    const expectedFrame = frame;
    const expectedKey = key;
    const token = (Number(editor._selectedAssetPreviewToken) || 0) + 1;
    editor._selectedAssetPreviewToken = token;
    editor._selectedAssetPreview3d = { key, host: frame, dispose: null, pending: true };
    mountRtpksTilePreview(frame, fileName, editor.tilePackage, tileId, {
      isCurrent: () => editor._selectedAssetPreviewToken === token
        && Number(editor.tileBrushId) === tileId
        && editor.tilePackage?.fileName === fileName,
    })
      .then((viewport) => {
        if (!expectedFrame.isConnected || editor._selectedAssetPreviewToken !== token) {
          viewport.dispose?.();
          return;
        }
        if (editor.tileBrushId == null || Number(editor.tileBrushId) !== tileId || editor.tilePackage?.fileName !== fileName) {
          viewport.dispose?.();
          return;
        }
        editor._selectedAssetPreview3d = { key: expectedKey, host: expectedFrame, dispose: viewport.dispose };
      })
      .catch(() => {
        if (!expectedFrame.isConnected || editor._selectedAssetPreviewToken !== token) return;
        editor._selectedAssetPreview3d = null;
        const cached = cachedRtpksTileThumb(editor, tileId);
        if (cached) {
          paintSelectedPreviewFrame(expectedFrame, cached, 'Selected tile');
          return;
        }
        const preview = tilePaintVisualUrl(editor, tileId);
        if (preview) paintSelectedPreviewFrame(expectedFrame, preview, 'Selected tile');
        else expectedFrame.innerHTML = '<p class="hint">Preview unavailable</p>';
      });
    requestRtpksTileThumbnail(editor, tileId, {
      size: RTPKS_TILE_THUMB_SIZE,
      onReady: (dataUrl) => {
        if (!dataUrl) return;
        refreshPlacedTileVisuals(editor);
      },
    });
    return;
  }
  disposeSelectedAssetPreview(editor, frame);
  frame.innerHTML = '<p class="hint">No selection</p>';
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
        msg = 'Invalid model id: check the catalog id matches the folder on disk.';
      }
    } else if (probe.status === 404) {
      msg = 'GLB file missing on disk: try re-importing the model.';
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
        ? 'Reorient API not loaded: stop the desk and run npm run admin again, then reload.'
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
        ? 'Delete API not loaded: stop the desk and run npm run admin again, then reload.'
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
      if (event.target.closest('[data-preview-model],[data-delete-model]')) return;
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
        beginMapHistory(editor);
        editor.map.models.splice(idx, 1);
        commitMapHistory(editor);
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

async function loadMapFileIntoEditor(state, deps, fileName) {
  const { api, log, render } = deps;
  const editor = ensureMapEditorState(state);
  const payload = await api(`/api/maps/file?file=${encodeURIComponent(fileName)}`);
  editor.map = payload.map;
  editor.map.grid.tileSize = TILE_SIZE;
  ensureTileLayers(editor.map);
  ensurePathLayer(editor.map);
  ensureTerrainVisual(editor.map);
  editor.currentFile = payload.fileName.endsWith('.owmap') ? payload.fileName : `${payload.map.id || 'map'}.owmap`;
  editor.mapDimensionsByFile = editor.mapDimensionsByFile || {};
  editor.mapDimensionsByFile[editor.currentFile] = {
    width: editor.map.grid.width,
    height: editor.map.grid.height,
  };
  const projectEntry = editor.project?.maps?.find((map) => map.file === editor.currentFile || map.id === editor.map.id);
  if (projectEntry) editor.project.editor.activeMapId = projectEntry.id;
  editor.activePathSetId = editor.map.pathLayer?.activeSetId || editor.activePathSetId || editor.project?.pathSets?.[0]?.id || '';
  if (editor.map.tilePackage?.file) {
    try {
      await loadTilePackage(editor, editor.map.tilePackage.file);
      rememberProjectTilePackage(editor);
    } catch (e) {
      log(e.message || 'Could not load linked RTPKS package.', 'warn');
    }
  }
  editor.dirty = false;
  clearMapHistory(editor);
  log(`Loaded ${fileName}`, 'ok');
  render();
}

export function bindMapEditor(state, deps) {
  const { api, log, esc } = deps;
  const editor = ensureMapEditorState(state);
  if (!editor._wrappedRender) {
    const parentRender = deps.render;
    editor._wrappedRender = () => {
      rememberTileCatalogScroll(editor);
      return parentRender();
    };
  }
  const render = editor._wrappedRender;

  if (!editor._workstationDelegatesReady) {
    editor._workstationDelegatesReady = true;
    document.addEventListener('keydown', (event) => {
      if (!document.querySelector('.map-editor-page')) return;
      const target = event.target;
      const isTyping = target?.matches?.('input, textarea, select, [contenteditable="true"]');
      if (isTyping) return;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || key !== 'z' && key !== 'y') return;
      const ed = ensureMapEditorState(state);
      const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);
      const changed = wantsRedo ? redoMapEdit(ed) : undoMapEdit(ed);
      if (!changed) return;
      event.preventDefault();
      refreshMapPreview(state);
      render();
    });
    document.addEventListener('click', (event) => {
      const activeLayerBtn = event.target.closest('[data-active-tile-layer]');
      if (activeLayerBtn && activeLayerBtn.closest('.map-editor-page')) {
        event.preventDefault();
        event.stopPropagation();
        const ed = ensureMapEditorState(state);
        if (!ed.map) return;
        ensureTileLayers(ed.map);
        ed.map.tileLayers.activeLayer = Number(activeLayerBtn.dataset.activeTileLayer) || 0;
        ed.brush = 'tile';
        ed.sidebarTab = 'tiles';
        ed.propTool = null;
        ed.placeModelId = null;
        ed.dirty = true;
        render();
        return;
      }
      const toggleLayerBtn = event.target.closest('[data-toggle-tile-layer]');
      if (toggleLayerBtn && toggleLayerBtn.closest('.map-editor-page')) {
        event.preventDefault();
        event.stopPropagation();
        const ed = ensureMapEditorState(state);
        if (!ed.map) return;
        const index = Number(toggleLayerBtn.dataset.toggleTileLayer) || 0;
        beginMapHistory(ed);
        const layer = tileLayerAt(ed.map, index);
        layer.visible = layer.visible === false;
        commitMapHistory(ed);
        ed.dirty = true;
        refreshMapPreview(state);
        render();
        return;
      }
      const addLayerBtn = event.target.closest('[data-add-tile-layer]');
      if (addLayerBtn && addLayerBtn.closest('.map-editor-page')) {
        event.preventDefault();
        event.stopPropagation();
        const ed = ensureMapEditorState(state);
        if (!ed.map) return;
        ensureTileLayers(ed.map);
        const layers = ed.map.tileLayers.layers;
        if (layers.length >= MAX_TILE_LAYERS) return;
        beginMapHistory(ed);
        const width = ed.map.grid?.width || 16;
        const height = ed.map.grid?.height || 16;
        layers.push({
          id: `deco_${layers.length + 1}`,
          name: `Deco ${layers.length + 1}`,
          visible: true,
          cells: createTileGrid(width, height, null),
        });
        ed.map.tileLayers.activeLayer = layers.length - 1;
        ed.brush = 'tile';
        ed.sidebarTab = 'tiles';
        ed.propTool = null;
        ed.placeModelId = null;
        commitMapHistory(ed);
        ed.dirty = true;
        render();
        return;
      }
      const deleteLayerBtn = event.target.closest('[data-delete-tile-layer]');
      if (deleteLayerBtn && deleteLayerBtn.closest('.map-editor-page')) {
        event.preventDefault();
        event.stopPropagation();
        const ed = ensureMapEditorState(state);
        beginMapHistory(ed);
        if (deleteActiveTileLayer(ed)) {
          commitMapHistory(ed);
          refreshMapPreview(state);
          render();
        } else {
          cancelMapHistory(ed);
        }
        return;
      }
      const propLayerBtn = event.target.closest('[data-map-prop-layer]');
      if (propLayerBtn && propLayerBtn.closest('.map-editor-page')) {
        event.preventDefault();
        event.stopPropagation();
        const ed = ensureMapEditorState(state);
        if (!ed.map) return;
        ed.propTool = ed.placeModelId ? 'place' : 'select';
        ed.sidebarTab = 'props';
        ed._ghostTile = null;
        render();
        return;
      }
      const tileTabBtn = event.target.closest('[data-tile-tab]');
      if (tileTabBtn && tileTabBtn.closest('.map-editor-page')) {
        event.preventDefault();
        event.stopPropagation();
        const ed = ensureMapEditorState(state);
        ed.tileTabId = tileTabBtn.dataset.tileTab || '';
        const firstTile = tileCatalogFiltered(ed)[0];
        if (firstTile) ed.tileBrushId = firstTile.resortTileId;
        ed.brush = 'tile';
        ed.sidebarTab = 'tiles';
        render();
        return;
      }
      const tilePageBtn = event.target.closest('[data-tile-page]');
      if (tilePageBtn && tilePageBtn.closest('.map-editor-page')) {
        event.preventDefault();
        const ed = ensureMapEditorState(state);
        const filtered = tileCatalogFiltered(ed);
        const maxPage = Math.max(0, Math.ceil(filtered.length / 160) - 1);
        ed.tilePage = tilePageBtn.dataset.tilePage === 'next'
          ? Math.min(maxPage, (Number(ed.tilePage) || 0) + 1)
          : Math.max(0, (Number(ed.tilePage) || 0) - 1);
        render();
      }
    }, true);
  }

  const paintGrid = document.querySelector('#mapPaintGrid');
  const cellFromEvent = (event) => {
    const cell = event.target.closest('[data-cell]');
    if (!cell) return null;
    return cell.dataset.cell.split(',').map(Number);
  };

  const projectSelect = document.querySelector('#mapProjectSelect');
  if (projectSelect) {
    projectSelect.onchange = async () => {
      try {
        await loadMapProject(editor, projectSelect.value || 'default');
        editor.projectId = editor.project.id;
        const active = editor.project.maps.find((map) => map.id === editor.project.editor?.activeMapId)
          || editor.project.maps[0];
        if (active?.file) await loadMapFileIntoEditor(state, deps, active.file);
        log(`Loaded project ${editor.project.name || editor.project.id}`, 'ok');
        render();
      } catch (e) {
        log(e.message || 'Could not load project.', 'error');
      }
    };
  }

  const saveProjectBtn = document.querySelector('#mapSaveProject');
  if (saveProjectBtn) {
    saveProjectBtn.onclick = async () => {
      try {
        await saveProject(editor);
        const listing = await fetchJsonQuiet('/api/map-projects/list');
        if (listing?.ok) editor.projects = listing.projects || editor.projects;
        log(`Saved project ${editor.project.name || editor.project.id}`, 'ok');
        render();
      } catch (e) {
        log(e.message || 'Could not save project.', 'error');
      }
    };
  }

  const undoBtn = document.querySelector('#mapUndo');
  if (undoBtn) {
    undoBtn.onclick = () => {
      if (!undoMapEdit(editor)) return;
      refreshMapPreview(state);
      render();
    };
  }

  const redoBtn = document.querySelector('#mapRedo');
  if (redoBtn) {
    redoBtn.onclick = () => {
      if (!redoMapEdit(editor)) return;
      refreshMapPreview(state);
      render();
    };
  }

  document.querySelectorAll('[data-project-map]').forEach((btn) => {
    btn.onclick = async (event) => {
      if (event.target.closest('[data-project-map-name]')) return;
      const entry = editor.project?.maps?.find((map) => map.id === btn.dataset.projectMap);
      if (!entry?.file) return;
      try {
        await loadMapFileIntoEditor(state, deps, entry.file);
      } catch (e) { /* api logs */ }
    };
  });

  document.querySelectorAll('[data-project-map-name]').forEach((input) => {
    const commitName = () => {
      const id = input.dataset.projectMapName;
      const entry = editor.project?.maps?.find((map) => map.id === id);
      if (!entry) return;
      const name = input.value.trim() || entry.id;
      entry.name = name;
      if (editor.map && (editor.map.id === id || editor.currentFile === entry.file)) {
        editor.map.name = name;
      }
      editor.projectDirty = true;
      render();
    };
    input.onchange = commitName;
    input.onblur = commitName;
    input.onclick = (event) => event.stopPropagation();
    input.onkeydown = (event) => event.stopPropagation();
  });

  document.querySelectorAll('[data-create-adjacent]').forEach((btn) => {
    btn.onclick = async () => {
      if (!editor.map) return;
      try {
        syncProjectFromEditor(editor);
        const payload = await fetch('/api/map-projects/create-adjacent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: editor.project?.id || 'default',
            activeMapId: editor.map.id,
            direction: btn.dataset.createAdjacent,
            anchorWidth: editor.map?.grid?.width,
            anchorHeight: editor.map?.grid?.height,
            anchorFile: editor.currentFile,
          }),
        }).then((res) => res.json().then((body) => ({ status: res.status, body })));
        if (payload.status >= 400 || !payload.body.ok) throw new Error(payload.body.error || 'Could not create adjacent map.');
        editor.project = payload.body.project;
        editor.projectId = editor.project.id;
        const validation = await fetchJsonQuiet(`/api/map-projects/validate?id=${encodeURIComponent(editor.project.id)}`);
        editor.projectValidation = validation?.validation || null;
        const entry = payload.body.map;
        await refreshProjectMapDimensions(editor);
        await loadMapFileIntoEditor(state, deps, entry.file);
        editor.projectDirty = false;
        const dims = payload.body.dimensions;
        const dir = btn.dataset.createAdjacent;
        const sizeLabel = dims ? ` (${dims.width}×${dims.height})` : '';
        if (payload.body.existing && !payload.body.fileCreated) {
          log(`Opened ${directionLabel(dir)} map ${entry.file}${sizeLabel}`, 'ok');
        } else {
          log(`Created ${directionLabel(dir)} map ${entry.file}${sizeLabel}`, 'ok');
        }
      } catch (e) {
        log(e.message || 'Could not create adjacent map.', 'error');
      }
    };
  });

  const pathSetSelect = document.querySelector('#mapPathSetSelect');
  if (pathSetSelect) {
    pathSetSelect.onchange = () => {
      editor.activePathSetId = pathSetSelect.value;
      if (editor.map) {
        beginMapHistory(editor);
        ensurePathLayer(editor.map).activeSetId = editor.activePathSetId;
        resolvePathTiles(editor);
        commitMapHistory(editor);
        editor.dirty = true;
      }
      editor.projectDirty = true;
      render();
    };
  }

  document.querySelectorAll('[data-smart-set-card]').forEach((btn) => {
    btn.onclick = () => {
      editor.activePathSetId = btn.dataset.smartSetCard || '';
      if (editor.map) {
        beginMapHistory(editor);
        ensurePathLayer(editor.map).activeSetId = editor.activePathSetId;
        resolvePathTiles(editor);
        commitMapHistory(editor);
        editor.dirty = true;
      }
      refreshMapPreview(state);
      render();
    };
  });

  const pathSetNew = document.querySelector('#mapPathSetNew');
  if (pathSetNew) {
    pathSetNew.onclick = () => {
      if (!editor.project) editor.project = createDefaultProject(editor.files);
      const id = `path_${(editor.project.pathSets?.length || 0) + 1}`;
      if (!Array.isArray(editor.project.pathSets)) editor.project.pathSets = [];
      editor.project.pathSets.push({
        id,
        name: `Path ${(editor.project.pathSets?.length || 0) + 1}`,
        packageId: editor.tilePackage?.packId || editor.tilePackage?.fileName || editor.project.defaultTilePackageId || '',
        tiles: {},
      });
      editor.activePathSetId = id;
      if (editor.map) ensurePathLayer(editor.map).activeSetId = id;
      editor.projectDirty = true;
      editor.sidebarTab = 'paths';
      render();
    };
  }

  const pathSetName = document.querySelector('#mapPathSetName');
  if (pathSetName) {
    pathSetName.oninput = () => {
      const set = activePathSet(editor);
      if (!set) return;
      set.name = pathSetName.value.trim() || set.id;
      editor.projectDirty = true;
    };
  }

  document.querySelectorAll('.map-path-tile-input').forEach((input) => {
    input.onchange = () => {
      const set = activePathSet(editor);
      if (!set) return;
      if (!set.tiles) set.tiles = {};
      const key = input.dataset.pathKey;
      const value = input.value === '' ? null : Number(input.value);
      if (value == null || !Number.isFinite(value) || value < 0) delete set.tiles[key];
      else set.tiles[key] = Math.round(value);
      if (editor.map) {
        beginMapHistory(editor);
        resolvePathTiles(editor);
        commitMapHistory(editor);
        editor.dirty = true;
      }
      editor.projectDirty = true;
      refreshMapPreview(state);
      render();
    };
  });

  const bindVisual = (selector, apply) => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.onchange = () => {
      if (!editor.map) return;
      beginMapHistory(editor);
      const visual = ensureTerrainVisual(editor.map);
      apply(el, visual);
      commitMapHistory(editor);
      editor.dirty = true;
      refreshMapPreview(state);
      render();
    };
  };
  bindVisual('#mapFloorHeightScale', (el, visual) => { visual.floorHeightScale = Math.max(1, Math.min(64, Number(el.value) || TILE_SIZE)); });
  bindVisual('#mapFloorRecolorEnabled', (el, visual) => { visual.floorRecolorEnabled = el.checked; });
  bindVisual('#mapFloorColor1', (el, visual) => { visual.floorColors[1] = el.value || '#d84f5f'; });
  bindVisual('#mapRampRecolorEnabled', (el, visual) => { visual.rampRecolorEnabled = el.checked; });
  bindVisual('#mapRampColor', (el, visual) => { visual.rampColor = el.value || '#f4d03f'; });
  const clampNumber = (value, fallback, min, max) => Math.max(min, Math.min(max, Number(value) || fallback));
  const ensureRampReadability = (visual) => {
    if (!visual.rampReadability || typeof visual.rampReadability !== 'object') {
      visual.rampReadability = { enabled: true, lowShade: 0.88, highShade: 1.10, bandCount: 5, bandStrength: 0.12, bandSoftness: 0.32 };
    }
    return visual.rampReadability;
  };
  bindVisual('#mapRampReadabilityEnabled', (el, visual) => { ensureRampReadability(visual).enabled = el.checked; });
  bindVisual('#mapRampReadabilityLow', (el, visual) => { ensureRampReadability(visual).lowShade = clampNumber(el.value, 0.88, 0, 4); });
  bindVisual('#mapRampReadabilityHigh', (el, visual) => { ensureRampReadability(visual).highShade = clampNumber(el.value, 1.10, 0, 4); });
  bindVisual('#mapRampReadabilityBands', (el, visual) => { ensureRampReadability(visual).bandCount = clampNumber(el.value, 5, 0, 64); });
  bindVisual('#mapRampReadabilityBandStrength', (el, visual) => { ensureRampReadability(visual).bandStrength = clampNumber(el.value, 0.12, 0, 1); });
  bindVisual('#mapRampReadabilityBandSoftness', (el, visual) => { ensureRampReadability(visual).bandSoftness = clampNumber(el.value, 0.32, 0.03, 0.49); });
  bindVisual('#mapLightPreset', (el, visual) => {
    visual.lightPreset = el.value || 'day';
    const presets = {
      day: { yaw: 38, pitch: 58 },
      sunset: { yaw: -42, pitch: 26 },
      night: { yaw: 25, pitch: 48 },
    };
    const preset = presets[visual.lightPreset] || presets.day;
    visual.lightYawDeg = preset.yaw;
    visual.lightPitchDeg = preset.pitch;
  });
  bindVisual('#mapLightYaw', (el, visual) => { visual.lightYawDeg = Math.max(-180, Math.min(180, Number(el.value) || 0)); });
  bindVisual('#mapLightPitch', (el, visual) => { visual.lightPitchDeg = Math.max(5, Math.min(85, Number(el.value) || 45)); });

  const stampPaint = (x, y, { light = false } = {}) => {
    if (!editor.map) return;
    const useLight = editor.brush !== 'path' && editor.tool !== 'fill' &&
      (light || editor.tool === 'paint' || editor.tool === 'erase' ||
        editor.tool === 'raise' || editor.tool === 'lower');
    if (editor.tool === 'fill') {
      if (editor.brush === 'tile') {
        floodFillTile(editor.map, x, y, tileCellValue(editor.map, x, y), editor.tileBrushId ?? null);
      } else if (editor.brush === 'path') {
        floodFillPath(editor, x, y, pathCellValue(editor.map, x, y), 1);
      } else {
        const layer = brushLayer(editor.brush);
        if (!layer) return;
        const target = cellValue(editor.map, layer, x, y);
        floodFill(editor.map, layer, x, y, target, activeBrushValue(editor));
      }
    } else {
      applyBrush(editor.map, editor, x, y);
      if (editor.brush === 'path') {
        const changed = [];
        const size = editor.brushSize;
        const half = Math.floor(size / 2);
        for (let dy = -half; dy <= half; dy += 1) {
          for (let dx = -half; dx <= half; dx += 1) changed.push([x + dx, y + dy]);
        }
        resolvePathTiles(editor, changed);
      }
    }
    editor.dirty = true;
    if (useLight) {
      editor._paintUsedLightUpdates = true;
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
    editor._paintUsedLightUpdates = false;
    refreshMapPreview(state);
    render();
  };

  const finishDrag = () => {
    if (!editor.map || !editor.dragStart || !editor.dragEnd) return;
    const cells = previewCellsForDrag(editor);
    if (cells.length) {
      applyToolToCells(editor.map, editor, cells);
      commitMapHistory(editor);
      editor.dirty = true;
      refreshMapPreview(state);
      render();
    } else {
      cancelMapHistory(editor);
    }
    editor.dragStart = null;
    editor.dragEnd = null;
    editor.painting = false;
    updateDragPreview(editor);
  };

  if (paintGrid) {
    const removeAtPointer = (x, y) => {
      if (!editor.map) return false;
      beginMapHistory(editor);
      if (editor.propTool === 'place' || editor.propTool === 'select') {
        const hit = findPlacementAt(editor, x, y);
        if (hit == null || !editor.map.models) {
          cancelMapHistory(editor);
          return false;
        }
        editor.map.models.splice(hit, 1);
        editor.selectedPlacementIndex = null;
        commitMapHistory(editor);
        editor.dirty = true;
        refreshMapPreview(state);
        render();
        return true;
      }
      if (editor.brush === 'tile') {
        clearTileAt(editor, editor.map, x, y);
        commitMapHistory(editor);
        editor.dirty = true;
        refreshMapPreview(state);
        render();
        return true;
      }
      if (editor.brush === 'path') {
        setPathCell(editor.map, x, y, 0);
        setTileCell(editor.map, x, y, null, tileLayerIndexById(editor.map, 'path'));
        resolvePathTiles(editor, [[x, y]]);
        commitMapHistory(editor);
        editor.dirty = true;
        refreshMapPreview(state);
        render();
        return true;
      }
      cancelMapHistory(editor);
      return false;
    };
    paintGrid.oncontextmenu = (event) => {
      event.preventDefault();
      const pos = cellFromEvent(event);
      if (!pos) return;
      removeAtPointer(pos[0], pos[1]);
    };
    paintGrid.onmousedown = (event) => {
      event.preventDefault();
      const pos = cellFromEvent(event);
      if (!pos) return;
      const [x, y] = pos;
      if (event.button === 2) {
        removeAtPointer(x, y);
        return;
      }
      if (editor.propTool === 'place' && editor.placeModelId) {
        beginMapHistory(editor);
        if (placeModelOnTile(state, { log }, x, y)) {
          commitMapHistory(editor);
          refreshMapPreview(state);
          render();
        } else {
          cancelMapHistory(editor);
        }
        return;
      }
      if (editor.propTool === 'select' && editor.map?.models?.length) {
        const hit = findPlacementAt(editor, x, y);
        if (hit != null) {
          editor.selectedPlacementIndex = hit;
          beginMapHistory(editor);
          editor._placementDrag = { index: hit, moved: false };
          return;
        }
        editor.selectedPlacementIndex = null;
        render();
        return;
      }
      if (editor.tool === 'area' || editor.tool === 'line') {
        beginMapHistory(editor);
        editor.dragStart = [x, y];
        editor.dragEnd = [x, y];
        editor.painting = true;
        updateDragPreview(editor);
        return;
      }
      beginMapHistory(editor);
      editor._paintingHistoryActive = true;
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
      if (isTilePlacementMode(editor)) {
        const prev = editor._ghostTile;
        if (!prev || prev[0] !== x || prev[1] !== y) {
          editor._ghostTile = [x, y];
          refreshPropOverlays(editor);
        }
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
          commitMapHistory(editor);
          editor.dirty = true;
          render();
        } else {
          cancelMapHistory(editor);
        }
        editor._placementDrag = null;
        return;
      }
      if ((editor.tool === 'area' || editor.tool === 'line') && editor.dragStart) {
        finishDrag();
        return;
      }
      if (editor.painting) {
        commitMapHistory(editor);
        editor._paintingHistoryActive = false;
        if (editor._paintUsedLightUpdates) {
          syncPaintToolbarState(editor);
          editor._paintUsedLightUpdates = false;
        } else {
          render();
        }
      }
      editor.painting = false;
    }, { once: false });
    paintGrid.onmouseleave = () => {
      if ((editor.propTool === 'place' || isTilePlacementMode(editor)) && editor._ghostTile) {
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
      beginMapHistory(editor);
      if (placeModelOnTile(state, { log }, x, y)) {
        commitMapHistory(editor);
        refreshMapPreview(state);
        render();
      } else {
        cancelMapHistory(editor);
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
      beginMapHistory(editor);
      mdl.yawDeg = ((Math.round((mdl.yawDeg || 0) / 90) * 90) + delta + 360) % 360;
      commitMapHistory(editor);
      editor.dirty = true;
      refreshMapPreview(state);
      render();
    };
  });

  const placementScale = document.querySelector('#mapPlacementScale');
  if (placementScale) {
    const beginScaleHistory = () => {
      if (selectedPlacement(editor)) beginMapHistory(editor);
    };
    const commitScaleHistory = () => {
      if (commitMapHistory(editor)) {
        editor.dirty = true;
        render();
      }
    };
    placementScale.onpointerdown = beginScaleHistory;
    placementScale.onfocus = beginScaleHistory;
    placementScale.onpointerup = commitScaleHistory;
    placementScale.onchange = commitScaleHistory;
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
      beginMapHistory(editor);
      editor.map.models.splice(idx, 1);
      editor.selectedPlacementIndex = null;
      commitMapHistory(editor);
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

  const tileSearch = document.querySelector('#mapTileSearch');
  if (tileSearch) {
    tileSearch.oninput = () => {
      editor.tileSearch = tileSearch.value;
      editor.tilePage = 0;
      render();
    };
  }

  const tileLayerSelect = document.querySelector('#mapTileLayerSelect');
  if (tileLayerSelect) {
    tileLayerSelect.onchange = () => {
      if (!editor.map) return;
      ensureTileLayers(editor.map);
      editor.map.tileLayers.activeLayer = Number(tileLayerSelect.value) || 0;
      editor.brush = 'tile';
      editor.sidebarTab = 'tiles';
      editor.propTool = null;
      editor.placeModelId = null;
      editor.dirty = true;
      render();
    };
  }

  const tileLayerPanel = document.querySelector('#mapTileLayerPanel');
  if (tileLayerPanel) {
    tileLayerPanel.onclick = (event) => {
      const activeLayerBtn = event.target.closest('[data-active-tile-layer]');
      if (activeLayerBtn) {
        event.preventDefault();
        if (!editor.map) return;
        ensureTileLayers(editor.map);
        editor.map.tileLayers.activeLayer = Number(activeLayerBtn.dataset.activeTileLayer) || 0;
        editor.brush = 'tile';
        editor.sidebarTab = 'tiles';
        editor.propTool = null;
        editor.placeModelId = null;
        editor.dirty = true;
        render();
        return;
      }
      const toggleLayerBtn = event.target.closest('[data-toggle-tile-layer]');
      if (toggleLayerBtn) {
        event.preventDefault();
        if (!editor.map) return;
        beginMapHistory(editor);
        const layer = tileLayerAt(editor.map, Number(toggleLayerBtn.dataset.toggleTileLayer) || 0);
        layer.visible = layer.visible === false;
        commitMapHistory(editor);
        editor.dirty = true;
        refreshMapPreview(state);
        render();
        return;
      }
      const addLayerBtn = event.target.closest('[data-add-tile-layer]');
      if (addLayerBtn) {
        event.preventDefault();
        if (!editor.map) return;
        ensureTileLayers(editor.map);
        const layers = editor.map.tileLayers.layers;
        if (layers.length >= MAX_TILE_LAYERS) return;
        beginMapHistory(editor);
        const width = editor.map.grid?.width || 16;
        const height = editor.map.grid?.height || 16;
        layers.push({
          id: `deco_${layers.length + 1}`,
          name: `Deco ${layers.length + 1}`,
          visible: true,
          cells: createTileGrid(width, height, null),
        });
        editor.map.tileLayers.activeLayer = layers.length - 1;
        editor.brush = 'tile';
        editor.sidebarTab = 'tiles';
        editor.propTool = null;
        editor.placeModelId = null;
        commitMapHistory(editor);
        editor.dirty = true;
        render();
        return;
      }
      const deleteLayerBtn = event.target.closest('[data-delete-tile-layer]');
      if (deleteLayerBtn) {
        event.preventDefault();
        beginMapHistory(editor);
        if (deleteActiveTileLayer(editor)) {
          commitMapHistory(editor);
          refreshMapPreview(state);
          render();
        } else {
          cancelMapHistory(editor);
        }
      }
    };
  }

  const tilePackageSelect = document.querySelector('#mapTilePackageSelect');
  if (tilePackageSelect) {
    tilePackageSelect.onchange = async () => {
      const fileName = tilePackageSelect.value;
      try {
        await loadTilePackage(editor, fileName);
        if (editor.map) {
          beginMapHistory(editor);
          editor.map.tilePackage = editor.tilePackage ? {
            file: editor.tilePackage.fileName,
            packId: editor.tilePackage.packId,
            name: editor.tilePackage.name,
            path: editor.tilePackage.gamePath,
          } : null;
          ensureTileLayers(editor.map);
          commitMapHistory(editor);
          editor.dirty = true;
        }
        if (editor.tilePackage) rememberProjectTilePackage(editor);
        editor.brush = 'tile';
        editor.sidebarTab = 'tiles';
        log(fileName ? `Linked RTPKS ${fileName}` : 'Unlinked RTPKS package', 'ok');
        render();
      } catch (e) {
        log(e.message || 'Could not load RTPKS package.', 'error');
      }
    };
  }

  const tileGlbDownload = document.querySelector('#mapSelectedTileGlbDownload');
  if (tileGlbDownload) {
    tileGlbDownload.onclick = async () => {
      if (editor.tileBrushId == null || !editor.tilePackage?.fileName) return;
      const btn = tileGlbDownload;
      const prevTitle = btn.title;
      btn.disabled = true;
      btn.title = 'Preparing GLB…';
      try {
        const fileName = await downloadRtpksTileGlb(
          editor.tilePackage.fileName,
          editor.tilePackage,
          Number(editor.tileBrushId),
        );
        log(`Downloaded ${fileName}`, 'ok');
      } catch (error) {
        log(error?.message || 'Could not export tile GLB.', 'error');
      } finally {
        btn.disabled = false;
        btn.title = prevTitle;
      }
    };
  }

  const editTilePack = document.querySelector('#mapEditTilePack');
  if (editTilePack) {
    editTilePack.onclick = async () => {
      try {
        await openTilePackEditor(editor, {
          log,
          onSaved: (updatedPackage) => {
            editor.tilePackage = updatedPackage;
            editor.tilePackages = (editor.tilePackages || []).map((pkg) => pkg.fileName === updatedPackage.fileName
              ? { ...pkg, ...updatedPackage }
              : pkg);
            const currentTab = editor.tileTabId;
            if (!updatedPackage.tabs?.some((tab) => tab.id === currentTab)) {
              editor.tileTabId = updatedPackage.tabs?.[0]?.id || '';
            }
            editor.tileBrushId = updatedPackage.tiles?.some((tile) => Number(tile.resortTileId) === Number(editor.tileBrushId))
              ? editor.tileBrushId
              : updatedPackage.tiles?.[0]?.resortTileId ?? null;
            rtpksTileThumbUrlCache.clear();
            rtpksTileMeshPreviewCache.clear();
            rtpksTextureSamplerCache.clear();
            refreshMapPreview(state);
            render();
          },
        });
      } catch (error) {
        log?.(error.message || 'Could not open the Tile Pack Editor.', 'error');
      }
    };
  }

  document.querySelectorAll('[data-pick-tile]').forEach((btn) => {
    btn.onclick = () => {
      editor.tileBrushId = Number(btn.dataset.pickTile);
      editor.brush = 'tile';
      editor.tool = editor.tool === 'raise' || editor.tool === 'lower' ? 'paint' : editor.tool;
      editor.propTool = null;
      editor.placeModelId = null;
      if (editor.map && editor.tilePackage) {
        editor.map.tilePackage = {
          file: editor.tilePackage.fileName,
          packId: editor.tilePackage.packId,
          name: editor.tilePackage.name,
          path: editor.tilePackage.gamePath,
        };
        ensureTileLayers(editor.map);
      }
      document.querySelectorAll('[data-pick-tile]').forEach((tileBtn) => {
        tileBtn.classList.toggle('active', Number(tileBtn.dataset.pickTile) === editor.tileBrushId);
      });
      document.querySelectorAll('.brush-btn').forEach((brushBtn) => {
        brushBtn.classList.toggle('active', brushBtn.dataset.brush === editor.brush);
      });
      document.querySelectorAll('.map-tool').forEach((toolBtn) => {
        toolBtn.classList.toggle('active', toolBtn.dataset.tool === editor.tool);
      });
      const strip = document.querySelector('.map-tile-active-strip');
      if (strip) {
        const fp = tileFootprint(tileEntry(editor, editor.tileBrushId));
        const size = tileSizeLabel(fp);
        strip.textContent = `Painting selected tile${size ? ` · ${size}` : ''}`;
      }
      refreshSelectedAssetPreview(editor);
      refreshPropOverlays(editor);
    };
  });

  const rtpksInput = document.querySelector('#mapImportRtpksInput');
  const rtpksBtn = document.querySelector('#mapImportRtpks');
  if (rtpksBtn && rtpksInput) {
    rtpksBtn.onclick = () => rtpksInput.click();
    rtpksInput.onchange = async () => {
      const files = Array.from(rtpksInput.files || []);
      rtpksInput.value = '';
      if (!files.length) return;
      const file = files.find((item) => /\.rtpks$/i.test(item.name));
      const meta = files.find((item) => /\.rtpks\.meta$/i.test(item.name));
      if (!file) {
        log('Choose an .rtpks file and its .rtpks.meta sidecar.', 'error');
        return;
      }
      if (!meta) {
        log('Choose the matching .rtpks.meta sidecar too.', 'error');
        return;
      }
      const fd = new FormData();
      fd.append('rtpks', file, file.name);
      fd.append('rtpksMeta', meta, meta.name);
      try {
        const res = await fetch('/api/tile-packages/import', { method: 'POST', body: fd });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.ok) throw new Error(payload.error || `Import failed (${res.status})`);
        editor.tilePackages = payload.packages || editor.tilePackages;
        if (editor._rtpksThumbFile !== payload.package?.fileName) {
          editor._rtpksThumbFile = payload.package?.fileName || '';
          editor._rtpksThumbUrls = {};
        }
        editor.tilePackage = payload.package;
        editor.tileTabId = payload.package?.tabs?.[0]?.id || '';
        editor.tileBrushId = tileCatalogFiltered(editor)[0]?.resortTileId ?? payload.package?.tiles?.[0]?.resortTileId ?? null;
        rememberProjectTilePackage(editor, payload.package);
        if (editor.map) {
          beginMapHistory(editor);
          editor.map.tilePackage = {
            file: payload.package.fileName,
            packId: payload.package.packId,
            name: payload.package.name,
            path: payload.package.gamePath,
          };
          ensureTileLayers(editor.map);
          commitMapHistory(editor);
          editor.dirty = true;
        }
        editor.brush = 'tile';
        editor.sidebarTab = 'tiles';
        log(`Added RTPKS to C++ project: ${payload.gamePath}`, 'ok');
        render();
      } catch (e) {
        log(e.message || 'RTPKS import failed', 'error');
      }
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
      if (editor.project?.editor) editor.project.editor.viewMode = next;
      render();
    };
  });

  document.querySelectorAll('.brush-btn').forEach((btn) => {
    btn.onclick = () => {
      editor.brush = btn.dataset.brush;
      if (editor.brush === 'tile') editor.sidebarTab = 'tiles';
      if (editor.brush === 'path') editor.sidebarTab = 'paths';
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

  const mapExpandSize = document.querySelector('#mapExpandSize');
  if (mapExpandSize) mapExpandSize.onclick = () => applyMapExpand(editor, log, render);

  const mapExpandAmount = document.querySelector('#mapExpandAmount');
  if (mapExpandAmount) {
    mapExpandAmount.onkeydown = (event) => {
      if (event.key === 'Enter') applyMapExpand(editor, log, render);
    };
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
        await loadMapFileIntoEditor(state, deps, btn.dataset.mapFile);
      } catch (e) { /* logged in api */ }
    };
  });

  const applyDir = document.querySelector('#mapApplyDir');
  if (applyDir) {
    applyDir.onclick = async () => {
      const mapsDirectory = document.querySelector('#mapDirInput')?.value?.trim();
      const modelsDirectory = document.querySelector('#mapModelsDirInput')?.value?.trim();
      const tilePackagesDirectory = document.querySelector('#mapTilePackagesDirInput')?.value?.trim();
      try {
        await api('/api/maps/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mapsDirectory, modelsDirectory, tilePackagesDirectory }),
        });
        await loadMapEditorListing(state, api);
        log('Maps, models, and RTPKS folders updated.', 'ok');
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
      modelThumbCache.clear();
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

  document.querySelectorAll('[data-map-layer-brush]').forEach((btn) => {
    btn.onclick = () => {
      editor.brush = btn.dataset.mapLayerBrush;
      if (editor.brush === 'tile') editor.sidebarTab = 'tiles';
      if (editor.brush === 'path') editor.sidebarTab = 'paths';
      if (editor.brush === 'ramp') editor.values.ramp = editor.values.ramp || 1;
      if (editor.brush !== 'height' && (editor.tool === 'raise' || editor.tool === 'lower')) editor.tool = 'paint';
      editor.propTool = null;
      editor.placeModelId = null;
      render();
    };
  });

  document.querySelectorAll('[data-map-prop-layer]').forEach((btn) => {
    btn.onclick = () => {
      if (!editor.map) return;
      editor.propTool = editor.placeModelId ? 'place' : 'select';
      editor.sidebarTab = 'props';
      editor._ghostTile = null;
      render();
    };
  });

  document.querySelectorAll('[data-left-tab]').forEach((btn) => {
    btn.onclick = () => {
      editor.leftTab = btn.dataset.leftTab;
      render();
    };
  });

  const openWizardBtn = document.querySelector('#mapOpenCompileWizard');
  if (openWizardBtn) openWizardBtn.onclick = openCompileWizard;

  const exitWorkbench = document.querySelector('#mapExitWorkbench');
  if (exitWorkbench) {
    exitWorkbench.onclick = () => {
      if (deps.navigateToTab) {
        deps.navigateToTab(state.deskReturnTab || 'Dashboard');
        return;
      }
      const dashboardTab = document.querySelector('#tabs [data-tab="Dashboard"]');
      if (dashboardTab) dashboardTab.click();
      else {
        state.tab = 'Dashboard';
        render();
      }
    };
  }

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
      if (editor.tilePackage) {
        editor.map.tilePackage = {
          file: editor.tilePackage.fileName,
          packId: editor.tilePackage.packId,
          name: editor.tilePackage.name,
          path: editor.tilePackage.gamePath,
        };
      }
      editor.currentFile = 'new_map.owmap';
      editor.dirty = true;
      clearMapHistory(editor);
      log('New 16×16 map ready.', 'ok');
      render();
    };
  }

  const mapSave = document.querySelector('#mapSave');
  if (mapSave) {
    mapSave.onclick = async () => {
      if (!editor.map) return;
      beginMapHistory(editor);
      editor.map = readMetaFromDom(editor.map, { resize: true });
      commitMapHistory(editor);
      const fileName = document.querySelector('#mapFileName')?.value?.trim() || editor.currentFile || 'map.owmap';
      try {
        const result = await api('/api/maps/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, map: editor.map }),
        });
        editor.currentFile = fileName.endsWith('.owmap') ? fileName : `${fileName}.owmap`;
        editor.dirty = false;
        syncProjectFromEditor(editor);
        try {
          await saveProject(editor);
        } catch (projectError) {
          editor.projectDirty = true;
          log(projectError.message || 'Map saved, but project save failed.', 'warn');
        }
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
          ensureTileLayers(editor.map);
          editor.currentFile = payload.fileName;
          editor.dirty = false;
          clearMapHistory(editor);
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
  restoreTileCatalogScroll(editor);
  requestAnimationFrame(() => restoreTileCatalogScroll(editor));
}

export async function initMapEditorTab(state, api) {
  const editor = ensureMapEditorState(state);
  if (editor.initialized) return;
  if (editor.initializing) return editor.initializing;
  editor.initializing = (async () => {
    await loadMapEditorListing(state, api);
    const activeEditor = ensureMapEditorState(state);
    if (!activeEditor.map) {
      const preferredId = activeEditor.project?.editor?.activeMapId || '';
      const projectMaps = activeEditor.project?.maps || [];
      const ordered = [
        ...projectMaps.filter((map) => map.id === preferredId),
        ...projectMaps.filter((map) => map.id !== preferredId),
      ];
      for (const entry of ordered) {
        if (!entry?.file) continue;
        try {
          const payload = await api(`/api/maps/file?file=${encodeURIComponent(entry.file)}`);
          activeEditor.map = payload.map;
          activeEditor.map.grid.tileSize = TILE_SIZE;
          ensureTileLayers(activeEditor.map);
          ensurePathLayer(activeEditor.map);
          ensureTerrainVisual(activeEditor.map);
          activeEditor.currentFile = payload.fileName.endsWith('.owmap') ? payload.fileName : `${payload.map.id || 'map'}.owmap`;
          if (activeEditor.project?.editor) activeEditor.project.editor.activeMapId = entry.id;
          if (activeEditor.map.tilePackage?.file) {
            try { await loadTilePackage(activeEditor, activeEditor.map.tilePackage.file); } catch { /* keep listing available */ }
          }
          activeEditor.dirty = false;
          clearMapHistory(activeEditor);
          break;
        } catch {
          /* try next project map */
        }
      }
    }
    activeEditor.initialized = true;
    activeEditor.initializing = null;
  })().catch((error) => {
    const activeEditor = ensureMapEditorState(state);
    activeEditor.initializing = null;
    throw error;
  });
  return editor.initializing;
}

/** Standard module API for editor-host.js */
export const initEditorTab = initMapEditorTab;
export const editorHtml = mapEditorHtml;
export const bindEditor = bindMapEditor;
