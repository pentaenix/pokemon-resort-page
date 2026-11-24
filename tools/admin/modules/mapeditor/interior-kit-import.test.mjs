import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';

import {
  chunkInteriorTiles,
  ensureInteriorTileTabs,
  groupInteriorTilesByTab,
  parseRaeInteriorKitArchive,
} from './interior-kit-import.js';

test('RAE interior kit archive resolves reusable GLBs and stable model ids', () => {
  const manifest = {
    format: 'rae.gen5InteriorKit', version: 1,
    source: { mapFileIndex: 842 },
    parts: [{
      id: 'wall_fhkabe_deadbeef', role: 'wall', sourceMaterial: 'fhkabe',
      glb: 'parts/wall_fhkabe_deadbeef.glb', mapPlacement: [24, 0, 16], footprint: [4, 1],
    }],
  };
  const archive = zipSync({
    'interior-kit.json': strToU8(JSON.stringify(manifest)),
    'parts/wall_fhkabe_deadbeef.glb': new Uint8Array([0x67, 0x6c, 0x54, 0x46]),
  });
  const parsed = parseRaeInteriorKitArchive(archive.buffer);
  assert.equal(parsed.parts[0].modelId, 'interior_842_wall_fhkabe_deadbeef');
  assert.deepEqual([...parsed.parts[0].bytes], [0x67, 0x6c, 0x54, 0x46]);
  assert.deepEqual(parsed.parts[0].mapPlacement, [24, 0, 16]);
});

test('RAE interior tile kit archive resolves portable tile bundles', () => {
  const manifest = {
    format: 'rae.gen5InteriorTileKit', version: 1,
    source: { mapFileIndex: 842 },
    tiles: [{
      id: 'floor_2_3_deadbeef', role: 'floor', sourceCell: [2, 3],
      bundle: 'tiles/floor_2_3_deadbeef.tile',
    }],
  };
  const archive = zipSync({
    'interior-tile-kit.json': strToU8(JSON.stringify(manifest)),
    'tiles/floor_2_3_deadbeef.tile': new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
  });
  const parsed = parseRaeInteriorKitArchive(archive.buffer);
  assert.equal(parsed.kind, 'tiles');
  assert.equal(parsed.tiles[0].role, 'floor');
  assert.deepEqual(parsed.tiles[0].sourceCell, [2, 3]);
  assert.deepEqual([...parsed.tiles[0].bytes], [0x50, 0x4b, 0x03, 0x04]);
});

test('interior tiles group into stable floor and wall tabs', () => {
  const groups = groupInteriorTilesByTab([
    { id: 'floor_a', role: 'floor' },
    { id: 'floor_b', role: 'floor' },
    { id: 'wall_a', role: 'wall' },
    { id: 'window_a', role: 'window' },
  ]);
  assert.deepEqual(groups.map((group) => [group.id, group.name, group.tiles.length]), [
    ['interior_floors', 'Interior Floors', 2],
    ['interior_walls', 'Interior Walls', 2],
  ]);
});

test('interior role tabs are created once and large exports are chunked', () => {
  const document = { tabs: [{ id: 'ground', name: 'Ground', order: 0, tileIds: [] }] };
  const groups = groupInteriorTilesByTab([
    { id: 'floor_a', role: 'floor' },
    { id: 'wall_a', role: 'wall' },
  ]);
  assert.equal(ensureInteriorTileTabs(document, groups), true);
  assert.equal(ensureInteriorTileTabs(document, groups), false);
  assert.deepEqual(document.tabs.map((tab) => tab.id), ['ground', 'interior_floors', 'interior_walls']);
  assert.deepEqual(chunkInteriorTiles(Array.from({ length: 257 }, (_, index) => index)).map((chunk) => chunk.length),
    [128, 128, 1]);
});
