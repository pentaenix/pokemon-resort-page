import test from 'node:test';
import assert from 'node:assert/strict';
import { footprintAnchorAt, overlappingFootprintAnchors } from './tile-footprint-edit.js';

const footprint = (tileId) => tileId === 9 ? { w: 3, h: 3 } : tileId === 8 ? { w: 1, h: 3 } : { w: 1, h: 1 };

test('every covered cell resolves to the multi-cell tile anchor', () => {
  const cells = Array.from({ length: 6 }, () => Array(6).fill(null));
  cells[1][2] = 9;
  assert.deepEqual(footprintAnchorAt(cells, 4, 3, footprint), {
    tileId: 9, anchorX: 2, anchorY: 1, footprint: { w: 3, h: 3 },
  });
  assert.equal(footprintAnchorAt(cells, 1, 3, footprint), null);
});

test('placing a multi-cell tile finds every overlapping anchor, including anchors to its right', () => {
  const cells = Array.from({ length: 7 }, () => Array(7).fill(null));
  cells[1][1] = 9;
  cells[2][4] = 8;
  cells[5][5] = 1;
  assert.deepEqual(
    overlappingFootprintAnchors(cells, 3, 2, { w: 3, h: 3 }, footprint)
      .map(({ tileId, anchorX, anchorY }) => [tileId, anchorX, anchorY]),
    [[9, 1, 1], [8, 4, 2]],
  );
});
