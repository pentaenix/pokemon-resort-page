const NEIGHBORS = [
  { dx: 0, dy: -1, bit: 1 },
  { dx: 1, dy: 0, bit: 2 },
  { dx: 0, dy: 1, bit: 4 },
  { dx: -1, dy: 0, bit: 8 },
  { dx: -1, dy: -1, bit: 16, cardinals: [1, 8] },
  { dx: 1, dy: -1, bit: 32, cardinals: [1, 2] },
  { dx: 1, dy: 1, bit: 64, cardinals: [2, 4] },
  { dx: -1, dy: 1, bit: 128, cardinals: [4, 8] },
];

export function normalizeTransitionMask(value) {
  let mask = Number(value) & 0xff;
  for (const neighbor of NEIGHBORS.slice(4)) {
    if (!neighbor.cardinals.every((bit) => (mask & bit) !== 0)) mask &= ~neighbor.bit;
  }
  return mask;
}

export function transitionMasks() {
  return [...new Set(Array.from({ length: 256 }, (_, mask) => normalizeTransitionMask(mask)))];
}

export function transitionFamily(tile) {
  return String(tile?.properties?.['transition.family'] || '').trim();
}

export function transitionBrushFamily(tile) {
  return String(tile?.properties?.['transition.brushFamily'] || '').trim();
}

export function transitionCatalog(tiles, family) {
  const catalog = new Map();
  for (const tile of tiles || []) {
    if (transitionFamily(tile) !== family) continue;
    const mask = normalizeTransitionMask(tile.properties?.['transition.mask']);
    catalog.set(mask, Number(tile.resortTileId));
  }
  return catalog;
}

export function transitionNeighborMask({ x, y, width, height, isFamily, outOfBoundsMatches = true }) {
  let mask = 0;
  for (const neighbor of NEIGHBORS) {
    const nx = x + neighbor.dx;
    const ny = y + neighbor.dy;
    const outside = nx < 0 || ny < 0 || nx >= width || ny >= height;
    if ((outside && outOfBoundsMatches) || (!outside && isFamily(nx, ny))) mask |= neighbor.bit;
  }
  return normalizeTransitionMask(mask);
}

export function resolveTerrainTransitionUpdates({
  tiles,
  changedCells,
  width,
  height,
  tileIdAt,
  outOfBoundsMatches = true,
}) {
  const byId = new Map((tiles || []).map((tile) => [Number(tile.resortTileId), tile]));
  const candidates = new Map();
  for (const [x, y] of changedCells || []) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx >= 0 && cy >= 0 && cx < width && cy < height) candidates.set(`${cx},${cy}`, [cx, cy]);
      }
    }
  }

  const catalogs = new Map();
  const updates = [];
  for (const [x, y] of candidates.values()) {
    const currentId = Number(tileIdAt(x, y));
    const family = transitionFamily(byId.get(currentId));
    if (!family) continue;
    if (!catalogs.has(family)) catalogs.set(family, transitionCatalog(tiles, family));
    const catalog = catalogs.get(family);
    const mask = transitionNeighborMask({
      x,
      y,
      width,
      height,
      outOfBoundsMatches,
      isFamily: (nx, ny) => transitionFamily(byId.get(Number(tileIdAt(nx, ny)))) === family,
    });
    const nextId = catalog.get(mask);
    if (Number.isFinite(nextId) && nextId !== currentId) updates.push({ x, y, tileId: nextId, family, mask });
  }
  return updates;
}

