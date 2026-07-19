import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { cloneGlbScene } from './model-scene-clone.js';

function skinnedScene() {
  const root = new THREE.Group();
  root.name = 'source';

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ], 4));

  const bone = new THREE.Bone();
  bone.name = 'root_bone';
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'skinned_prop';
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  root.add(mesh);
  return { root, mesh, bone };
}

test('cloneGlbScene rebinds skinned meshes to cloned bones', () => {
  const source = skinnedScene();
  const clone = cloneGlbScene(source.root);
  const clonedMesh = clone.getObjectByName('skinned_prop');
  const clonedBone = clone.getObjectByName('root_bone');

  assert.ok(clonedMesh?.isSkinnedMesh);
  assert.ok(clonedBone?.isBone);
  assert.notEqual(clonedBone, source.bone);
  assert.equal(clonedMesh.skeleton.bones[0], clonedBone);
  assert.notEqual(clonedMesh.skeleton.bones[0], source.mesh.skeleton.bones[0]);

  const placement = new THREE.Group();
  placement.position.set(200, 0, 200);
  placement.add(clone);
  placement.updateMatrixWorld(true);
  assert.deepEqual(clonedMesh.getWorldPosition(new THREE.Vector3()).toArray(), [200, 0, 200]);
  assert.deepEqual(clonedBone.getWorldPosition(new THREE.Vector3()).toArray(), [200, 0, 200]);
});
