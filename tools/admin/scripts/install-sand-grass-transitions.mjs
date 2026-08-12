#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { installSandGrassTransitions } from '../lib/terrain-transition-authoring.mjs';

const [packPath, metaPath, grassTexturePath] = process.argv.slice(2);
if (!packPath || !metaPath) {
  console.error('Usage: node install-sand-grass-transitions.mjs <pack.rtpks> <pack.rtpks.meta> [black2-grass01ax.png]');
  process.exit(2);
}

const output = installSandGrassTransitions(fs.readFileSync(packPath), fs.readFileSync(metaPath), {
  grassTextureBytes: grassTexturePath ? fs.readFileSync(grassTexturePath) : null,
});
const writeAtomic = (target, bytes) => {
  const temporary = `${target}.terrain-transition-tmp`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, target);
};
writeAtomic(packPath, output.packBytes);
writeAtomic(metaPath, output.metaBytes);
console.log(JSON.stringify(output.result, null, 2));
