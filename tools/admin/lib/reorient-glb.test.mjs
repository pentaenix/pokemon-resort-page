import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMeshFromGltf, parseGlb } from './glb-compile.mjs';
import { reorientGlbBuffer } from './reorient-glb.mjs';
import { writeGlbFromMesh } from './write-glb.mjs';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAhS5Z5QAAAABJRU5ErkJggg==',
  'base64',
);

function offsetTriangleGlb() {
  return writeGlbFromMesh({
    id: 'offset_building',
    aabb: { min: [10, 4, 20], max: [14, 12, 26] },
    vertices: new Float32Array([
      10, 4, 20, 0, 1, 0, 0, 0,
      14, 4, 20, 0, 1, 0, 1, 0,
      10, 12, 26, 0, 1, 0, 0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2]),
    triangleMaterials: new Uint8Array([0]),
    materials: [{ name: 'wood', textureIndex: 0 }],
    textures: [{ format: 'png', width: 1, height: 1, bytes: PNG_1X1 }],
  });
}

test('identity orientation still centers and seats a prop on the ground', () => {
  const normalized = reorientGlbBuffer(offsetTriangleGlb(), {}, 'offset_building');
  const { json, bin } = parseGlb(normalized);
  const mesh = buildMeshFromGltf('offset_building', json, bin);

  assert.deepEqual(mesh.aabb.min, [-2, 0, -3]);
  assert.deepEqual(mesh.aabb.max, [2, 8, 3]);
  assert.equal((mesh.aabb.min[0] + mesh.aabb.max[0]) / 2, 0);
  assert.equal((mesh.aabb.min[2] + mesh.aabb.max[2]) / 2, 0);
});
