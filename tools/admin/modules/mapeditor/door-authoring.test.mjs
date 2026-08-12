import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDoorTrigger,
  buildDoorVisualIndex,
  buildDoorTriggerIndex,
  doorVisualAt,
  doorTriggerAt,
  ensureDoorAuthoring,
  moveSelectedDoorVisual,
  offsetDoorAuthoring,
  placeSelectedDoorTrigger,
  removeDoorsAt,
  removeDoorTriggerById,
  selectDoorAt,
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

test('moving a trigger does not move its animated tile reference', () => {
  const editor = {
    map: { doorTriggers: [{ id: 'front', tile: [2, 3], visual: { mapId: '', layerId: 'doors', tile: [2, 2] } }] },
    selectedDoorTriggerId: 'front',
    doorAttachVisual: false,
  };
  assert.equal(placeSelectedDoorTrigger(editor, 8, 9), true);
  assert.deepEqual(editor.map.doorTriggers[0].tile, [8, 9]);
  assert.deepEqual(editor.map.doorTriggers[0].visual.tile, [2, 2]);
});

test('animated tile references can move independently and use the active layer', () => {
  const editor = {
    map: {
      doorTriggers: [{ id: 'front', tile: [2, 3], visual: null }],
      tileLayers: { activeLayer: 1, layers: [{ id: 'ground' }, { id: 'doors' }] },
    },
    selectedDoorTriggerId: 'front',
  };
  assert.equal(moveSelectedDoorVisual(editor, 4, 5), true);
  assert.deepEqual(editor.map.doorTriggers[0].visual, { mapId: '', layerId: 'doors', tile: [4, 5] });
});

test('moving an existing animated tile preserves its assigned decoration layer', () => {
  const editor = {
    map: {
      doorTriggers: [{ id: 'front', tile: [2, 3], visual: { mapId: '', layerId: 'doors', tile: [2, 2] } }],
      tileLayers: { activeLayer: 0, layers: [{ id: 'ground' }, { id: 'doors' }] },
    },
    selectedDoorTriggerId: 'front',
  };
  assert.equal(moveSelectedDoorVisual(editor, 7, 8), true);
  assert.deepEqual(editor.map.doorTriggers[0].visual, { mapId: '', layerId: 'doors', tile: [7, 8] });
});

test('doors can be selected from either their trigger or animated tile marker', () => {
  const trigger = { id: 'front', tile: [3, 4], visual: { mapId: '', layerId: 'doors', tile: [3, 3] } };
  const editor = { map: { doorTriggers: [trigger] }, selectedDoorTriggerId: '' };
  assert.equal(selectDoorAt(editor, 3, 3), trigger);
  assert.equal(editor.selectedDoorTriggerId, 'front');
  assert.equal(selectDoorAt(editor, 3, 4), trigger);
});

test('visual lookup excludes references that belong to another map', () => {
  const local = { id: 'local', tile: [1, 1], visual: { mapId: '', tile: [2, 2] } };
  const remote = { id: 'remote', tile: [1, 2], visual: { mapId: 'outside', tile: [3, 3] } };
  const map = { id: 'inside', doorTriggers: [local, remote] };
  const index = buildDoorVisualIndex(map);
  assert.equal(doorVisualAt(map, 2, 2, index), local);
  assert.equal(doorVisualAt(map, 3, 3, index), null);
});

test('clearing either marker removes the whole door and its unused link', () => {
  const makeMap = () => ({
    id: 'water',
    links: [{ id: 'house_link', destinationMapId: 'house', destinationAnchorId: 'entry' }],
    tileLayers: { layers: [{ id: 'doors', cells: Array.from({ length: 6 }, () => Array(6).fill(7)) }] },
    doorTriggers: [{
      id: 'house_door',
      tile: [4, 5],
      visual: { mapId: '', layerId: 'doors', tile: [4, 4] },
      linkId: 'house_link',
    }],
  });
  const fromTrigger = makeMap();
  assert.equal(removeDoorsAt(fromTrigger, 4, 5).length, 1);
  assert.deepEqual(fromTrigger.doorTriggers, []);
  assert.deepEqual(fromTrigger.links, []);
  assert.equal(fromTrigger.tileLayers.layers[0].cells[4][4], null);

  const fromVisual = makeMap();
  assert.equal(removeDoorsAt(fromVisual, 4, 4).length, 1);
  assert.deepEqual(fromVisual.doorTriggers, []);
  assert.deepEqual(fromVisual.links, []);
});

test('deleting one door keeps a link that another door still uses', () => {
  const map = {
    links: [{ id: 'shared', destinationMapId: 'inside', destinationAnchorId: 'entry' }],
    doorTriggers: [
      { id: 'left', tile: [1, 1], linkId: 'shared' },
      { id: 'right', tile: [2, 1], linkId: 'shared' },
    ],
  };
  assert.equal(removeDoorTriggerById(map, 'left').length, 1);
  assert.equal(map.doorTriggers.length, 1);
  assert.equal(map.links.length, 1);
});
