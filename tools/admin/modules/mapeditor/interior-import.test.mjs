import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapFromRaeInterior } from './interior-import.js';

test('RAE interior import aligns the shell and creates a halo exit', () => {
  const metadata = {
    format: 'rae.gen5Interior', version: 1, tileSize: 16,
    source: { mapFileIndex: 842 },
    gridOrigin: [-256, -240], gridSize: [14, 10], floorDatum: -2.49,
    blockedMask: Array.from({ length: 10 }, () => Array(14).fill(0)),
    entrance: {
      edge: 'south', tile: [6, 9], arrivalTile: [6, 8], returnTriggerTile: [6, 10],
      arrivalFacing: 'north', exitDirection: 'south',
    },
  };
  const map = createMapFromRaeInterior({ player: { character: 'haru' }, grid: {} }, metadata, {
    mapId: 'interior_0842', modelId: 'interior_0842_shell',
    modelGlbPath: 'assets/overworld/models/interior_0842_shell/map_0842_interior.glb',
  });
  assert.equal(map.type, 'interior');
  assert.deepEqual(map.models[0].position, [256, 2.49, 240]);
  assert.deepEqual(map.player.spawnTile, [6, 9]);
  assert.deepEqual(map.anchors[0].tile, [6, 10]);
  assert.deepEqual(map.doorTriggers[0].tile, [6, 10]);
  assert.deepEqual(map.doorTriggers[0].allowedDirections, ['south']);
  assert.equal(map.doorTriggers[0].scriptId, 'door_exit_default');
  assert.equal(map.environment.renderOtherSpaces, false);
});

test('RAE multi-height interior import aligns its base datum and collision heights', () => {
  const metadata = {
    format: 'rae.gen5Interior', version: 1, tileSize: 16,
    source: { mapFileIndex: 860 },
    gridOrigin: [-272, -208], gridSize: [3, 1], floorDatum: -51,
    primaryFloorDatum: -3, heightStep: 8,
    heightMask: [[0, 1, 6]], blockedMask: [[0, 0, 0]],
    surfaceHeightMask: [[-51, -43, -3]], ambiguousFloorCells: [],
    entrance: {
      edge: 'south', tile: [2, 0], arrivalTile: [2, 0], returnTriggerTile: [2, 1],
      arrivalFacing: 'north', exitDirection: 'south',
    },
  };
  const map = createMapFromRaeInterior({ player: {}, grid: {} }, metadata, {
    mapId: 'interior_0860', modelId: 'interior_0860_shell', modelGlbPath: 'shell.glb',
  });

  assert.deepEqual(map.models[0].position, [272, 51, 208]);
  assert.deepEqual(map.terrain.height, [[0, 1, 6]]);
  assert.equal(map.terrainVisual.floorHeightScale, 8);
  assert.equal(map.player.spawnHeight, 48);
  assert.equal(map.interior.primaryFloorDatum, -3);
});
