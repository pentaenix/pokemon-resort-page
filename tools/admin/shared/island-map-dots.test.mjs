import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uvToModelXZ, modelXZToUv } from './island-map-dots.js';

const root = new URL('../../../', import.meta.url);
const { mainModel } = JSON.parse(await readFile(new URL('public/data/models.json', root)));
const { pins } = JSON.parse(await readFile(new URL('public/data/atlas-pins.json', root)));

test('real Atlas pins match the rectangular authored terrain, without V inversion', () => {
  // All scene geometry (including water) is fitted to 15700 source units.
  // Primary terrain: X=15000*u-7500; Z=11250*v-5625, image-space V.
  const fittedScale = mainModel.displaySize / 15700;
  for (const pin of pins) {
    const actual = uvToModelXZ(pin.x, pin.y, mainModel.mapAlignment, mainModel.displaySize);
    assert.ok(Math.abs(actual.x - (15000 * pin.x - 7500) * fittedScale) < 1e-6, `${pin.name}: wrong map width or horizontal fit`);
    assert.ok(Math.abs(actual.z - (11250 * pin.y - 5625) * fittedScale) < 1e-6, `${pin.name}: wrong map height or flipped vertical axis`);
    const inverse = modelXZToUv(actual.x, actual.z, mainModel.mapAlignment, mainModel.displaySize);
    assert.ok(Math.abs(inverse.u - pin.x) < 1e-9 && Math.abs(inverse.v - pin.y) < 1e-9, `${pin.name}: projection must round-trip`);
  }
});
