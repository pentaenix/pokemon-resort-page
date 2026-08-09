import test from 'node:test';
import assert from 'node:assert/strict';

import { createReusedMapEntry, otherEntriesUsingFile } from './map-project-reuse.js';

test('reused map entries share one source file but receive stable instance ids', () => {
  const project = { maps: [{ id: 'water', name: 'Full water', file: 'water.owmap' }] };
  const first = createReusedMapEntry(project, 'water');
  project.maps.push(first);
  const second = createReusedMapEntry(project, first.id);

  assert.equal(first.file, 'water.owmap');
  assert.equal(first.sourceMapId, 'water');
  assert.equal(second.id, 'water_instance_2');
  assert.equal(second.sourceMapId, 'water');
  assert.equal(otherEntriesUsingFile(project, first).length, 1);
});
