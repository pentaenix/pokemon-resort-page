import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRtpksSampler,
  rtpksMaterialAppearance,
  sampleRtpksMaterialMotion,
} from './rtpks-material-motion.js';

test('UV motion interpolates between Nitro timeline samples', () => {
  const sample = sampleRtpksMaterialMotion({
    interpolation: 'linear',
    frameDurationMs: 100,
    frameCount: 3,
    offsets: [[0, 0], [0.25, 0.5], [0.5, 1]],
  }, 50, { wrapS: 'repeat', wrapT: 'clamp' });
  assert.deepEqual(sample.offset, [0.125, 0.25]);
  assert.equal(sample.frame, 0);
});

test('repeat interpolation follows the shortest equivalent UV path at a loop seam', () => {
  const sample = sampleRtpksMaterialMotion({
    interpolation: 'linear',
    frameDurationMs: 100,
    frameCount: 2,
    offsets: [[0.95, 0], [0.05, 0]],
  }, 50, { wrapS: 'repeat' });
  assert.ok(Math.abs(sample.offset[0] - 1) < 1e-8);
});

test('RTPKS appearance distinguishes blended water from cutout art', () => {
  assert.deepEqual(rtpksMaterialAppearance({ alpha: 16, textureAlpha: 'opaque' }), {
    opacity: 16 / 31, transparent: true, alphaTest: 0, depthWrite: false, polygonOffset: false,
  });
  assert.equal(rtpksMaterialAppearance({ alpha: 31, textureAlpha: 'cutout' }).alphaTest, 0.5);
  assert.equal(rtpksMaterialAppearance({ alpha: 31, textureAlpha: 'blend' }).transparent, true);
  assert.equal(normalizeRtpksSampler({ wrapT: 'clamp' }).wrapT, 'clamp');
});
