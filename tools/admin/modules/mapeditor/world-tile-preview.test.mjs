import test from 'node:test';
import assert from 'node:assert/strict';
import { worldTilePreviewStyle } from './world-tile-preview.js';

test('continues quarter-texture Gen 5 UVs across the map grid', () => {
  const tilePackage = { materials: [{ materialId: 507, uvMapping: { mode: 'world', uPerTile: [0.25, 0], vPerTile: [0, 0.25] } }] };
  assert.deepEqual(worldTilePreviewStyle(tilePackage, { materialId: 507 }, 2, 3), {
    backgroundSize: '96px 96px',
    backgroundPosition: '-48px -72px',
  });
});

test('leaves local and sheared UV mappings on rendered thumbnails', () => {
  assert.equal(worldTilePreviewStyle({ materials: [] }, { materialId: 1 }, 0, 0), null);
  const tilePackage = { materials: [{ materialId: 1, uvMapping: { mode: 'world', uPerTile: [0.25, 0.1], vPerTile: [0, 0.25] } }] };
  assert.equal(worldTilePreviewStyle(tilePackage, { materialId: 1 }, 0, 0), null);
});
