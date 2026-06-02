import { basename, join } from 'node:path';

function normPath(p) {
  return String(p || '').replace(/\\/g, '/');
}

function pathVariants(p) {
  const n = normPath(p);
  const out = new Set([n]);
  try {
    out.add(n.normalize('NFC'));
    out.add(n.normalize('NFD'));
  } catch { /* ignore */ }
  return [...out];
}

/**
 * Resolve a file in an upload map (handles macOS NFD vs NFC filenames).
 */
export function lookupInFileMap(fileMap, ...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    for (const key of pathVariants(c)) {
      if (fileMap.has(key)) return { bytes: fileMap.get(key), key };
    }
  }
  const bases = candidates.filter(Boolean).map((c) => basename(normPath(c)));
  for (const base of bases) {
    for (const variant of pathVariants(base)) {
      for (const [k, v] of fileMap) {
        const kb = basename(k);
        if (kb === variant) return { bytes: v, key: k };
        try {
          if (kb.normalize('NFC') === variant.normalize('NFC')) return { bytes: v, key: k };
        } catch { /* ignore */ }
      }
    }
  }
  return null;
}

export function findObjAndMtl(fileMap, objText) {
  let objPath = null;
  let objBytes = null;
  for (const [rel, bytes] of fileMap) {
    if (/\.obj$/i.test(rel) && !objPath) {
      objPath = rel;
      objBytes = bytes;
    }
  }
  if (!objBytes) return { objPath: null, objText: null, mtlPath: null, mtlText: null, mtlDir: '' };

  const objTextDecoded = objBytes.toString('utf8');
  const mtlDirFromObj = objPath.includes('/') ? normPath(objPath).split('/').slice(0, -1).join('/') : '';
  let mtlPath = null;
  let mtlText = null;
  let mtlDir = mtlDirFromObj;

  const mtllib = objTextDecoded.match(/^mtllib\s+(.+)$/im);
  if (mtllib) {
    const mtlName = mtllib[1].trim().replace(/\\/g, '/');
    const mtlDirFromName = mtlName.includes('/') ? mtlName.split('/').slice(0, -1).join('/') : '';
    const hit = lookupInFileMap(
      fileMap,
      join(mtlDirFromObj, mtlName),
      mtlName,
      join(mtlDirFromName, basename(mtlName)),
    );
    if (hit) {
      mtlPath = hit.key;
      mtlText = hit.bytes.toString('utf8');
      mtlDir = normPath(mtlPath).includes('/') ? normPath(mtlPath).split('/').slice(0, -1).join('/') : mtlDirFromName;
    }
  }
  if (!mtlText) {
    for (const [rel, bytes] of fileMap) {
      if (/\.mtl$/i.test(rel)) {
        mtlPath = rel;
        mtlText = bytes.toString('utf8');
        mtlDir = rel.includes('/') ? normPath(rel).split('/').slice(0, -1).join('/') : '';
        break;
      }
    }
  }

  return { objPath, objText: objTextDecoded, mtlPath, mtlText, mtlDir };
}

export function resolveTextureForMaterial(mapKd, mtlDir, fileMap, materialName = '') {
  if (mapKd) {
    let tex = normPath(mapKd);
    if (tex.includes(' ')) tex = tex.split(/\s+/).pop();
    const hit = lookupInFileMap(fileMap, tex, join(mtlDir, tex), basename(tex));
    if (hit) return { bytes: hit.bytes, textureName: basename(hit.key), resolved: hit.key };
  }
  if (materialName) {
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      const guess = `${materialName}${ext}`;
      const hit = lookupInFileMap(fileMap, join(mtlDir, guess), guess, basename(guess));
      if (hit) return { bytes: hit.bytes, textureName: basename(hit.key), resolved: hit.key, guessed: true };
    }
  }
  return null;
}
