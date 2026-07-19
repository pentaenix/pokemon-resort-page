// Lightweight top-down map thumbnail for the project layout modal.

const TILE = 16;
const TOP_A = [116, 156, 190];
const TOP_B = [125, 166, 200];
const mapDataCache = new Map();

export async function fetchMapData(fileName) {
  if (!fileName) return null;
  if (mapDataCache.has(fileName)) return mapDataCache.get(fileName);
  const promise = fetch(`/api/maps/file?file=${encodeURIComponent(fileName)}`)
    .then(async (res) => {
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.map) throw new Error(payload.error || 'Map load failed');
      return payload.map;
    })
    .catch(() => null);
  mapDataCache.set(fileName, promise);
  return promise;
}

export function clearMapPlanThumbCache(fileName) {
  if (fileName) mapDataCache.delete(fileName);
  else mapDataCache.clear();
}

/**
 * Draw a height-shaded top-down plan into `canvas` (fits map aspect ratio).
 * @param {HTMLCanvasElement} canvas
 * @param {object} map
 * @param {{ showCollision?: boolean, edgeToEdge?: boolean }} [options]
 */
export function drawMapPlanThumb(canvas, map, options = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !map?.grid) return;
  const w = Math.max(1, map.grid.width);
  const h = Math.max(1, map.grid.height);
  const heights = map.terrain?.height || [];
  const collision = map.terrain?.collision || [];
  const visual = map.terrainVisual || {};
  const viewW = Math.max(48, canvas.clientWidth || 160);
  const viewH = Math.max(48, canvas.clientHeight || 120);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  canvas.style.width = `${viewW}px`;
  canvas.style.height = `${viewH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b2a3a';
  ctx.fillRect(0, 0, viewW, viewH);

  const pad = options.edgeToEdge ? 0 : 4;
  const contentW = w * TILE + pad * 2;
  const contentH = h * TILE + pad * 2;
  const inset = options.edgeToEdge ? 0 : 4;
  const zoom = Math.min((viewW - inset) / contentW, (viewH - inset) / contentH);
  const panX = (viewW - contentW * zoom) / 2;
  const panY = (viewH - contentH * zoom) / 2;
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);
  const ox = pad;
  const oy = pad;

  for (let z = 0; z < h; z += 1) {
    for (let x = 0; x < w; x += 1) {
      const base = ((x + z) & 1) === 0 ? TOP_A : TOP_B;
      const hv = Math.max(0, heights?.[z]?.[x] ?? 0);
      const shade = Math.min(60, hv * 10);
      let r = Math.min(255, base[0] + shade);
      let g = Math.min(255, base[1] + shade);
      let b = Math.min(255, base[2] + shade);
      const floorColor = visual.floorRecolorEnabled && hv > 0
        ? (visual.floorColors?.[hv] || visual.floorColors?.[1])
        : null;
      if (floorColor) {
        ctx.fillStyle = floorColor;
      } else {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
      }
      ctx.fillRect(ox + x * TILE, oy + z * TILE, TILE, TILE);
      if (options.showCollision && collision?.[z]?.[x]) {
        ctx.fillStyle = 'rgba(220,38,38,.45)';
        ctx.fillRect(ox + x * TILE, oy + z * TILE, TILE, TILE);
      }
    }
  }
  if (!options.edgeToEdge) {
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(ox, oy, w * TILE, h * TILE);
  }
  ctx.restore();
}

export async function paintMapPlanThumb(canvas, fileName, options = {}) {
  const map = await fetchMapData(fileName);
  if (!map || !canvas.isConnected) return false;
  drawMapPlanThumb(canvas, map, options);
  return true;
}
