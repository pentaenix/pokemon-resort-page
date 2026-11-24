import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBlankInteriorMap,
  defaultInteriorRoomStyle,
  interiorOpeningCovers,
} from './interior-default-room.js';

test('blank interiors receive the default procedural room contract', () => {
  const map = createBlankInteriorMap({ grid: { width: 12, height: 9 } });
  const style = defaultInteriorRoomStyle(map);
  assert.equal(map.type, 'interior');
  assert.equal(map.interior.shellModelId, '');
  assert.deepEqual(style.floorA, [72, 80, 94]);
  assert.equal(style.wallHeightTiles, 2);
  assert.equal(style.frontWallHeightTiles, 0.35);
});

test('authored shells disable the default room and openings remove wall segments', () => {
  const map = createBlankInteriorMap({});
  map.interior.openings = [{ edge: 'south', from: 3, to: 4 }];
  assert.equal(interiorOpeningCovers(map, 'south', 3), true);
  assert.equal(interiorOpeningCovers(map, 'south', 5), false);
  map.interior.shellModelId = 'interior_shell';
  assert.equal(defaultInteriorRoomStyle(map), null);
});
