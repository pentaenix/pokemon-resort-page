export function footprintAnchorAt(cells, x, y, footprintForTile) {
  for (let anchorY = 0; anchorY <= y && anchorY < cells.length; anchorY += 1) {
    const row = cells[anchorY] || [];
    for (let anchorX = 0; anchorX <= x && anchorX < row.length; anchorX += 1) {
      const tileId = row[anchorX];
      if (tileId == null || tileId === '') continue;
      const footprint = footprintForTile(Number(tileId));
      if (x >= anchorX && x < anchorX + footprint.w && y >= anchorY && y < anchorY + footprint.h) {
        return { tileId: Number(tileId), anchorX, anchorY, footprint };
      }
    }
  }
  return null;
}

export function buildVisibleFootprintIndex(layers, footprintForTile) {
  const visible = new Map();
  for (let layerIndex = 0; layerIndex < (layers || []).length; layerIndex += 1) {
    const layer = layers[layerIndex];
    if (!layer || layer.visible === false) continue;
    const layerCells = new Map();
    const cells = layer.cells || [];
    for (let anchorY = 0; anchorY < cells.length; anchorY += 1) {
      const row = cells[anchorY] || [];
      for (let anchorX = 0; anchorX < row.length; anchorX += 1) {
        const rawTileId = row[anchorX];
        if (rawTileId == null || rawTileId === '') continue;
        const tileId = Number(rawTileId);
        const footprint = footprintForTile(tileId);
        for (let dy = 0; dy < footprint.h; dy += 1) {
          for (let dx = 0; dx < footprint.w; dx += 1) {
            const x = anchorX + dx;
            const y = anchorY + dy;
            if (y >= cells.length || x >= (cells[y]?.length || row.length)) continue;
            const key = `${x},${y}`;
            if (!layerCells.has(key)) {
              layerCells.set(key, { tileId, anchorX, anchorY, layerIndex, footprint });
            }
          }
        }
      }
    }
    for (const [key, hit] of layerCells) visible.set(key, hit);
  }
  return visible;
}

export function overlappingFootprintAnchors(cells, x, y, footprint, footprintForTile) {
  const right = x + footprint.w;
  const bottom = y + footprint.h;
  const overlaps = [];
  for (let anchorY = 0; anchorY < cells.length; anchorY += 1) {
    const row = cells[anchorY] || [];
    for (let anchorX = 0; anchorX < row.length; anchorX += 1) {
      const tileId = row[anchorX];
      if (tileId == null || tileId === '') continue;
      const existing = footprintForTile(Number(tileId));
      if (anchorX < right && anchorX + existing.w > x && anchorY < bottom && anchorY + existing.h > y) {
        overlaps.push({ tileId: Number(tileId), anchorX, anchorY, footprint: existing });
      }
    }
  }
  return overlaps;
}
