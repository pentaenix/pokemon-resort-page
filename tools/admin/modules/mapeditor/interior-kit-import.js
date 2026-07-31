import { strFromU8, unzipSync } from 'fflate';

export function validateRaeInteriorKitManifest(manifest) {
  if (!manifest || manifest.format !== 'rae.gen5InteriorKit' || Number(manifest.version) !== 1) {
    throw new Error('Select a RAE Gen 5 interior kit archive (rae.gen5InteriorKit version 1).');
  }
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) {
    throw new Error('The interior kit manifest contains no reusable parts.');
  }
  for (const part of manifest.parts) {
    if (!part?.id || !part?.glb || !part?.role) throw new Error('An interior kit part is missing id, role, or GLB path.');
  }
  return manifest;
}

export function interiorKitModelId(manifest, part) {
  const source = String(manifest.source?.mapFileIndex || 'map');
  const suffix = String(part.id || 'part').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `interior_${source}_${suffix}`;
}

export function parseRaeInteriorKitArchive(buffer) {
  const entries = unzipSync(new Uint8Array(buffer));
  const manifestEntry = entries['interior-kit.json'];
  if (!manifestEntry) throw new Error('The archive is missing interior-kit.json.');
  const manifest = validateRaeInteriorKitManifest(JSON.parse(strFromU8(manifestEntry)));
  const parts = manifest.parts.map((part) => {
    const bytes = entries[part.glb] || entries[`parts/${String(part.glb).split('/').pop()}`];
    if (!bytes) throw new Error(`The archive is missing ${part.glb}.`);
    return { ...part, bytes, modelId: interiorKitModelId(manifest, part) };
  });
  return { manifest, parts };
}
