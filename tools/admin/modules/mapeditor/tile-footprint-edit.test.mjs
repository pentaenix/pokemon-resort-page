import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVisibleFootprintIndex, footprintAnchorAt, overlappingFootprintAnchors } from './tile-footprint-edit.js';

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

test('visible footprint index resolves all cells once and lets higher layers win', () => {
  const base = Array.from({ length: 5 }, () => Array(5).fill(null));
  const upper = Array.from({ length: 5 }, () => Array(5).fill(null));
  const hidden = Array.from({ length: 5 }, () => Array(5).fill(null));
  base[1][1] = 9;
  upper[2][2] = 1;
  hidden[0][0] = 9;
  const index = buildVisibleFootprintIndex([
    { cells: base },
    { cells: upper },
    { cells: hidden, visible: false },
  ], footprint);
  assert.deepEqual(index.get('3,3'), {
    tileId: 9, anchorX: 1, anchorY: 1, layerIndex: 0, footprint: { w: 3, h: 3 },
  });
  assert.deepEqual(index.get('2,2'), {
    tileId: 1, anchorX: 2, anchorY: 2, layerIndex: 1, footprint: { w: 1, h: 1 },
  });
  assert.equal(index.get('0,0'), undefined);
});
