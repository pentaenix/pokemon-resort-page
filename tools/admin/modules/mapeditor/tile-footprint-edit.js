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
