import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVertexAnimationClips } from './glb-vertex-animation.mjs';

test('bakes a named node translation clip into vertex positions', () => {
  const accessors = new Map([
    [0, [[0], [0.25]]],
    [1, [[0, 0, 0], [2, 0, 0]]],
  ]);
  const gltf = {
    nodes: [{ translation: [0, 0, 0] }],
    animations: [{
      name: 'door_op',
      samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
    }],
  };
  const clips = buildVertexAnimationClips(
    gltf,
    [{ position: [1, 0, 0], nodeIndex: 0 }],
    (index) => accessors.get(index),
  );
  assert.equal(clips[0].name, 'door_op');
  assert.equal(clips[0].frameDurationMs, 250);
  assert.deepEqual(clips[0].frames, [[1, 0, 0], [3, 0, 0]]);
});

test('applies skin joints and inverse bind matrices while baking', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const accessors = new Map([
    [0, [[0], [0.1]]],
    [1, [[0, 0, 0], [0, 3, 0]]],
    [2, [identity]],
  ]);
  const gltf = {
    nodes: [{ translation: [0, 0, 0] }, { mesh: 0, skin: 0 }],
    skins: [{ joints: [0], inverseBindMatrices: 2 }],
    animations: [{
      name: 'door_cl',
      samplers: [{ input: 0, output: 1, interpolation: 'STEP' }],
      channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
    }],
  };
  const clips = buildVertexAnimationClips(
    gltf,
    [{ position: [1, 2, 0], nodeIndex: 1, skinIndex: 0, joints: [0], weights: [1] }],
    (index) => accessors.get(index),
  );
  assert.deepEqual(clips[0].frames, [[1, 2, 0], [1, 5, 0]]);
});
