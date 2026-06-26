/**
 * Terrain special tile IDs (uint8). Value 1 is editor-only and is baked away on save.
 */
export const SPECIAL = {
  FLAT: 0,
  AUTO: 1,
  RAMP_N: 2,
  RAMP_E: 3,
  RAMP_S: 4,
  RAMP_W: 5,
  CONVEX_NE: 6,
  CONVEX_SE: 7,
  CONVEX_SW: 8,
  CONVEX_NW: 9,
  CONCAVE_NE: 10,
  CONCAVE_SE: 11,
  CONCAVE_SW: 12,
  CONCAVE_NW: 13,
};

export const SPECIAL_LABELS = {
  0: 'Flat',
  1: 'Auto ramp (editor)',
  2: 'Ramp north',
  3: 'Ramp east',
  4: 'Ramp south',
  5: 'Ramp west',
  6: 'Convex NE',
  7: 'Convex SE',
  8: 'Convex SW',
  9: 'Convex NW',
  10: 'Concave NE',
  11: 'Concave SE',
  12: 'Concave SW',
  13: 'Concave NW',
};

export const RAMP_PRESETS = [
  { id: 0, label: 'Flat', short: '·', group: 'base' },
  { id: 1, label: 'Auto ramp', short: '↗', group: 'cardinal' },
  { id: 2, label: 'Ramp north', short: 'N', group: 'cardinal' },
  { id: 3, label: 'Ramp east', short: 'E', group: 'cardinal' },
  { id: 4, label: 'Ramp south', short: 'S', group: 'cardinal' },
  { id: 5, label: 'Ramp west', short: 'W', group: 'cardinal' },
  { id: 6, label: 'Convex NE', short: 'cNE', group: 'convex' },
  { id: 7, label: 'Convex SE', short: 'cSE', group: 'convex' },
  { id: 8, label: 'Convex SW', short: 'cSW', group: 'convex' },
  { id: 9, label: 'Convex NW', short: 'cNW', group: 'convex' },
  { id: 10, label: 'Concave NE', short: 'vNE', group: 'concave' },
  { id: 11, label: 'Concave SE', short: 'vSE', group: 'concave' },
  { id: 12, label: 'Concave SW', short: 'vSW', group: 'concave' },
  { id: 13, label: 'Concave NW', short: 'vNW', group: 'concave' },
];

export const SPECIAL_MAX = 13;

function tileHeight(heights, tx, ty) {
  return heights?.[ty]?.[tx] ?? 0;
}

function inBounds(width, height, tx, ty) {
  return tx >= 0 && ty >= 0 && tx < width && ty < height;
}

function isCardinalRamp(special) {
  return special >= SPECIAL.RAMP_N && special <= SPECIAL.RAMP_W;
}

function rampAxis(special) {
  if (special === SPECIAL.RAMP_N) return { dx: 0, dy: -1 };
  if (special === SPECIAL.RAMP_E) return { dx: 1, dy: 0 };
  if (special === SPECIAL.RAMP_S) return { dx: 0, dy: 1 };
  if (special === SPECIAL.RAMP_W) return { dx: -1, dy: 0 };
  return { dx: 0, dy: 0 };
}

/** Infer cardinal ramp 2–5 from neighbor heights (same rules as game runtime). */
export function inferCardinalRampDirection(heights, width, height, tx, ty) {
  const h = tileHeight(heights, tx, ty);
  const n = tileHeight(heights, tx, ty - 1);
  const e = tileHeight(heights, tx + 1, ty);
  const s = tileHeight(heights, tx, ty + 1);
  const w = tileHeight(heights, tx - 1, ty);
  let bestDir = 0;
  let bestDelta = 0;
  if (ty > 0 && n - h > bestDelta) { bestDelta = n - h; bestDir = SPECIAL.RAMP_N; }
  if (tx < width - 1 && e - h > bestDelta) { bestDelta = e - h; bestDir = SPECIAL.RAMP_E; }
  if (ty < height - 1 && s - h > bestDelta) { bestDelta = s - h; bestDir = SPECIAL.RAMP_S; }
  if (tx > 0 && w - h > bestDelta) { bestDelta = w - h; bestDir = SPECIAL.RAMP_W; }
  return bestDir;
}

function applyCardinalSlope(out, dir, hv, tileSize) {
  const low = hv * tileSize;
  const high = (hv + 1) * tileSize;
  applyCardinalSlopeEdges(out, dir, low, high);
}

function applyCardinalSlopeEdges(out, dir, low, high) {
  if (dir === SPECIAL.RAMP_N) {
    out[0] = high; out[1] = high; out[2] = low; out[3] = low;
  } else if (dir === SPECIAL.RAMP_E) {
    out[0] = low; out[1] = high; out[2] = high; out[3] = low;
  } else if (dir === SPECIAL.RAMP_S) {
    out[0] = low; out[1] = low; out[2] = high; out[3] = high;
  } else if (dir === SPECIAL.RAMP_W) {
    out[0] = high; out[1] = low; out[2] = low; out[3] = high;
  }
}

function solveCardinalRampRun(special, heights, specials, width, height, tx, ty) {
  const axis = rampAxis(special);
  let startX = tx;
  let startY = ty;
  let index = 0;
  while ((specials?.[startY - axis.dy]?.[startX - axis.dx] ?? SPECIAL.FLAT) === special) {
    startX -= axis.dx;
    startY -= axis.dy;
    index += 1;
  }

  let endX = startX;
  let endY = startY;
  let count = 1;
  let minBase = tileHeight(heights, endX, endY);
  let maxBase = minBase;
  while ((specials?.[endY + axis.dy]?.[endX + axis.dx] ?? SPECIAL.FLAT) === special) {
    endX += axis.dx;
    endY += axis.dy;
    count += 1;
    const h = tileHeight(heights, endX, endY);
    minBase = Math.min(minBase, h);
    maxBase = Math.max(maxBase, h);
  }

  const lowX = startX - axis.dx;
  const lowY = startY - axis.dy;
  const highX = endX + axis.dx;
  const highY = endY + axis.dy;
  let lowUnits;
  if (inBounds(width, height, lowX, lowY)) {
    lowUnits = tileHeight(heights, lowX, lowY);
  } else {
    lowUnits = minBase;
  }

  let highUnits;
  if (inBounds(width, height, highX, highY)) {
    highUnits = tileHeight(heights, highX, highY);
  } else {
    highUnits = maxBase + 1;
  }
  if (highUnits <= lowUnits) highUnits = Math.max(lowUnits + 1, maxBase + 1);
  return { index, count, lowUnits, highUnits };
}

/** Corner order NW, NE, SE, SW: matches TerrainSurface.cpp / OverworldMapRenderer.cpp. */
function applyCornerRampHeights(out, special, hv, tileSize) {
  const low = hv * tileSize;
  const high = (hv + 1) * tileSize;
  switch (special) {
    case SPECIAL.CONVEX_NE:
      out[0] = low; out[1] = low; out[2] = high; out[3] = low;
      break;
    case SPECIAL.CONVEX_SE:
      out[0] = low; out[1] = high; out[2] = low; out[3] = low;
      break;
    case SPECIAL.CONVEX_SW:
      out[0] = high; out[1] = low; out[2] = low; out[3] = low;
      break;
    case SPECIAL.CONVEX_NW:
      out[0] = low; out[1] = low; out[2] = low; out[3] = high;
      break;
    case SPECIAL.CONCAVE_NE:
      out[0] = high; out[1] = high; out[2] = low; out[3] = high;
      break;
    case SPECIAL.CONCAVE_SE:
      out[0] = high; out[1] = low; out[2] = low; out[3] = high;
      break;
    case SPECIAL.CONCAVE_SW:
      out[0] = low; out[1] = low; out[2] = high; out[3] = low;
      break;
    case SPECIAL.CONCAVE_NW:
      out[0] = low; out[1] = high; out[2] = high; out[3] = low;
      break;
    default:
      break;
  }
}

/** Resolve effective special for preview (auto → inferred cardinal). */
export function effectiveSpecial(special, heights, width, height, tx, ty) {
  if (special === SPECIAL.AUTO) {
    return inferCardinalRampDirection(heights, width, height, tx, ty) || SPECIAL.FLAT;
  }
  return special;
}

export function cornerHeightsForTile(
  special,
  heights,
  width,
  height,
  tx,
  ty,
  tileSize = 16,
  specials = null,
) {
  const hv = tileHeight(heights, tx, ty);
  const flat = Math.max(0, hv) * tileSize;
  const out = [flat, flat, flat, flat];

  const effective = effectiveSpecial(special, heights, width, height, tx, ty);
  if (isCardinalRamp(effective)) {
    if (specials) {
      const run = solveCardinalRampRun(effective, heights, specials, width, height, tx, ty);
      const t0 = run.index / Math.max(1, run.count);
      const t1 = (run.index + 1) / Math.max(1, run.count);
      const low = (run.lowUnits + ((run.highUnits - run.lowUnits) * t0)) * tileSize;
      const high = (run.lowUnits + ((run.highUnits - run.lowUnits) * t1)) * tileSize;
      applyCardinalSlopeEdges(out, effective, low, high);
    } else {
      applyCardinalSlope(out, effective, hv, tileSize);
    }
    return out;
  }

  if (effective >= SPECIAL.CONVEX_NE && effective <= SPECIAL.CONCAVE_NW) {
    applyCornerRampHeights(out, effective, hv, tileSize);
    return out;
  }

  return out;
}

/**
 * Bake editor-only specials for disk. Clones map; converts AUTO (1) → cardinal 2–5.
 * @returns {{ map: object, bakedCount: number, clearedCount: number }}
 */
export function bakeTerrainSpecials(map) {
  const width = map.grid?.width || map.terrain?.height?.[0]?.length || 0;
  const height = map.grid?.height || map.terrain?.height?.length || 0;
  const next = JSON.parse(JSON.stringify(map));
  const specials = next.terrain.special;
  let bakedCount = 0;
  let clearedCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = specials[y][x];
      if (v !== SPECIAL.AUTO) continue;
      const dir = inferCardinalRampDirection(next.terrain.height, width, height, x, y);
      if (dir >= SPECIAL.RAMP_N && dir <= SPECIAL.RAMP_W) {
        specials[y][x] = dir;
        bakedCount += 1;
      } else {
        specials[y][x] = SPECIAL.FLAT;
        clearedCount += 1;
      }
    }
  }

  return { map: next, bakedCount, clearedCount };
}
