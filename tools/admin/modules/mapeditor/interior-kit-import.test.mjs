import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';

import { parseRaeInteriorKitArchive } from './interior-kit-import.js';

test('RAE interior kit archive resolves reusable GLBs and stable model ids', () => {
  const manifest = {
    format: 'rae.gen5InteriorKit', version: 1,
    source: { mapFileIndex: 842 },
    parts: [{
      id: 'wall_fhkabe_deadbeef', role: 'wall', sourceMaterial: 'fhkabe',
      glb: 'parts/wall_fhkabe_deadbeef.glb', mapPlacement: [24, 0, 16], footprint: [4, 1],
    }],
  };
  const archive = zipSync({
    'interior-kit.json': strToU8(JSON.stringify(manifest)),
    'parts/wall_fhkabe_deadbeef.glb': new Uint8Array([0x67, 0x6c, 0x54, 0x46]),
  });
  const parsed = parseRaeInteriorKitArchive(archive.buffer);
  assert.equal(parsed.parts[0].modelId, 'interior_842_wall_fhkabe_deadbeef');
  assert.deepEqual([...parsed.parts[0].bytes], [0x67, 0x6c, 0x54, 0x46]);
  assert.deepEqual(parsed.parts[0].mapPlacement, [24, 0, 16]);
});
