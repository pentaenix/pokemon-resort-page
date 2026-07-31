import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDoorTrigger,
  buildDoorTriggerIndex,
  doorTriggerAt,
  ensureDoorAuthoring,
  offsetDoorAuthoring,
  placeSelectedDoorTrigger,
} from './door-authoring.js';

test('door triggers normalize and allow an exterior halo coordinate', () => {
  const map = { player: { spawnTile: [2, 3] }, doorTriggers: [{ id: 'Exit Door', tile: [4, -1], allowedDirection: 'north' }] };
  ensureDoorAuthoring(map);
  assert.deepEqual(map.doorTriggers[0].tile, [4, -1]);
  assert.equal(map.doorTriggers[0].id, 'exit_door');
  assert.deepEqual(map.doorTriggers[0].allowedDirections, ['north']);
});

test('placing a visible trigger addresses the active RTPKS layer and cell', () => {
  const editor = { map: { player: { spawnTile: [1, 1] }, tileLayers: { activeLayer: 1, layers: [{ id: 'base' }, { id: 'doors' }] } }, doorAttachVisual: true };
  addDoorTrigger(editor);
  assert.equal(placeSelectedDoorTrigger(editor, 8, 9), true);
  assert.deepEqual(editor.map.doorTriggers[0].visual, { mapId: '', layerId: 'doors', tile: [8, 9] });
});

test('expanding north or west shifts triggers, anchors, and visual references together', () => {
  const map = { anchors: [{ id: 'entry', tile: [1, 2] }], doorTriggers: [{ id: 'door', tile: [1, 2], visual: { layerId: 'doors', tile: [1, 2] } }] };
  offsetDoorAuthoring(map, 3, 4);
  assert.deepEqual(map.anchors[0].tile, [4, 6]);
  assert.deepEqual(map.doorTriggers[0].tile, [4, 6]);
  assert.deepEqual(map.doorTriggers[0].visual.tile, [4, 6]);
});

test('expanding a map does not shift a door visual on another map', () => {
  const map = { doorTriggers: [{ id: 'return', tile: [1, 0], visual: { mapId: 'resort', layerId: 'doors', tile: [9, 8] } }] };
  offsetDoorAuthoring(map, 3, 4);
  assert.deepEqual(map.doorTriggers[0].tile, [4, 4]);
  assert.deepEqual(map.doorTriggers[0].visual.tile, [9, 8]);
});

test('door lookup uses a prebuilt coordinate index without normalizing the map', () => {
  const trigger = { id: 'raw id', tile: [7, -1] };
  const map = { doorTriggers: [trigger] };
  const index = buildDoorTriggerIndex(map);
  assert.equal(doorTriggerAt(map, 7, -1, index), trigger);
  assert.equal(doorTriggerAt(map, 6, -1, index), null);
  assert.equal(trigger.id, 'raw id');
  assert.equal(map.anchors, undefined);
});
