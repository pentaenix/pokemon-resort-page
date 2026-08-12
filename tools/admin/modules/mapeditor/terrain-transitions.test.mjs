import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTransitionMask,
  resolveTerrainTransitionUpdates,
  transitionMasks,
} from './terrain-transitions.js';

test('blob transition masks contain the standard 47 normalized shapes', () => {
  assert.equal(transitionMasks().length, 47);
  assert.equal(normalizeTransitionMask(16), 0);
  assert.equal(normalizeTransitionMask(1 | 8 | 16), 1 | 8 | 16);
});

test('transition resolver selects variants from all eight same-family neighbors', () => {
  const tiles = transitionMasks().map((mask, index) => ({
    resortTileId: 1000 + index,
    properties: { 'transition.family': 'sand-grass', 'transition.mask': mask },
  }));
  const idForMask = (mask) => tiles.find((tile) => tile.properties['transition.mask'] === mask).resortTileId;
  const cells = Array.from({ length: 3 }, () => Array(3).fill(null));
  cells[1][1] = idForMask(255);

  let updates = resolveTerrainTransitionUpdates({
    tiles,
    changedCells: [[1, 1]],
    width: 3,
    height: 3,
    tileIdAt: (x, y) => cells[y][x],
  });
  assert.deepEqual(updates.map(({ x, y, tileId, mask }) => ({ x, y, tileId, mask })), [
    { x: 1, y: 1, tileId: idForMask(0), mask: 0 },
  ]);

  cells[1][0] = idForMask(255);
  updates = resolveTerrainTransitionUpdates({
    tiles,
    changedCells: [[0, 1]],
    width: 3,
    height: 3,
    tileIdAt: (x, y) => cells[y][x],
  });
  const center = updates.find((update) => update.x === 1 && update.y === 1);
  assert.equal(center.mask, 8);
  assert.equal(center.tileId, idForMask(8));
});

test('map edges are treated as matching terrain so they do not create artificial seams', () => {
  const tiles = transitionMasks().map((mask, index) => ({
    resortTileId: 2000 + index,
    properties: { 'transition.family': 'sand-grass', 'transition.mask': mask },
  }));
  const cells = [[tiles[0].resortTileId]];
  const [update] = resolveTerrainTransitionUpdates({
    tiles,
    changedCells: [[0, 0]],
    width: 1,
    height: 1,
    tileIdAt: (x, y) => cells[y][x],
  });
  assert.equal(update.mask, 255);
});
