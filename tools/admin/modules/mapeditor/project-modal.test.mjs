import test from 'node:test';
import assert from 'node:assert/strict';

import { findMapSnap } from './project-modal.js';

const anchor = {
  id: 'anchor',
  left: 100,
  top: 80,
  width: 120,
  height: 90,
  gridX: 4,
  gridY: 3,
};

test('findMapSnap connects a map to the nearest matching edge', () => {
  const snap = findMapSnap({ left: 224, top: 83, width: 60, height: 50 }, [anchor]);

  assert.equal(snap?.direction, 'east');
  assert.equal(snap?.left, 220);
  assert.equal(snap?.top, 80);
  assert.equal(snap?.gridX, 5);
  assert.equal(snap?.gridY, 3);
});

test('findMapSnap returns null when a map is dropped away from every edge', () => {
  const snap = findMapSnap({ left: 500, top: 400, width: 60, height: 50 }, [anchor]);

  assert.equal(snap, null);
});

test('findMapSnap respects maps with different dimensions', () => {
  const snap = findMapSnap({ left: 103, top: 26, width: 70, height: 50 }, [anchor]);

  assert.equal(snap?.direction, 'north');
  assert.equal(snap?.left, 100);
  assert.equal(snap?.top, 30);
  assert.equal(snap?.gridX, 4);
  assert.equal(snap?.gridY, 2);
});
