const CELL_PIXELS = 24;

function finitePair(value) {
  return Array.isArray(value)
    && value.length >= 2
    && value.slice(0, 2).every((item) => Number.isFinite(Number(item)));
}

/**
 * Return CSS that continues an axis-aligned world UV texture across map cells.
 * Complex/sheared mappings keep using their rendered per-tile thumbnail.
 */
export function worldTilePreviewStyle(tilePackage, tile, x, y, cellPixels = CELL_PIXELS) {
  const material = tilePackage?.materials?.find((item) => Number(item.materialId) === Number(tile?.materialId));
  const mapping = material?.uvMapping;
  if (mapping?.mode !== 'world' || !finitePair(mapping.uPerTile) || !finitePair(mapping.vPerTile)) return null;
  const [ux, uy] = mapping.uPerTile.map(Number);
  const [vx, vy] = mapping.vPerTile.map(Number);
  if (Math.abs(uy) > 1e-9 || Math.abs(vx) > 1e-9 || ux <= 0 || vy <= 0) return null;
  const width = cellPixels / ux;
  const height = cellPixels / vy;
  return {
    backgroundSize: `${width}px ${height}px`,
    backgroundPosition: `${-(Number(x) * ux * width)}px ${-(Number(y) * vy * height)}px`,
  };
}
