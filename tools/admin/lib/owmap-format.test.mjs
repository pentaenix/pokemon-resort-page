import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeOwmap, encodeOwmap, emptyMap, resizeMap } from './owmap-format.mjs';

test('interior metadata round-trips through OWMAP v1', () => {
  const map = emptyMap(12, 10);
  map.id = 'house_test';
  map.type = 'interior';
  map.environment = { space: 'interior:house_test', clearColor: [0, 0, 0, 255], renderOtherSpaces: false };
  map.interior = {
    shellModelId: 'interiors/house_test.glb',
    floorDatum: -2.5,
    gridOrigin: [-16, 32],
    openings: [{ edge: 'south', from: 4, to: 6 }],
  };
  const decoded = decodeOwmap(encodeOwmap(map));
  assert.equal(decoded.type, 'interior');
  assert.deepEqual(decoded.environment, map.environment);
  assert.deepEqual(decoded.interior, map.interior);
});

test('resizing preserves interior, door, and unknown metadata', () => {
  const map = emptyMap(4, 4);
  map.type = 'interior';
  map.environment = { space: 'interior:test', clearColor: [0, 0, 0, 255], renderOtherSpaces: false };
  map.interior = { gridOrigin: [2, 3], openings: [{ edge: 'south', from: 1, to: 1 }] };
  map.anchors = [{ id: 'entry', tile: [1, 2], facing: 'north' }];
  map.doorTriggers = [{ id: 'exit', tile: [1, -1], allowedDirections: ['south'], visual: null }];
  map.customMetadata = { preserved: true };
  const resized = resizeMap(map, 6, 5);
  assert.deepEqual(resized.environment, map.environment);
  assert.deepEqual(resized.interior, map.interior);
  assert.deepEqual(resized.anchors, map.anchors);
  assert.deepEqual(resized.doorTriggers, map.doorTriggers);
  assert.deepEqual(resized.customMetadata, map.customMetadata);
});
