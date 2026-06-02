/**
 * Browser-side OBJ/MTL inspection before compile (mirrors server obj-compile rules).
 */

function trim(s) {
  return s.trim();
}

export function buildFileMap(files) {
  const fileMap = new Map();
  for (const f of files) {
    const rel = (f.relativePath || f.name || '').replace(/\\/g, '/');
    if (!rel) continue;
    fileMap.set(rel, f.bytes);
    fileMap.set(rel.split('/').pop(), f.bytes);
  }
  return fileMap;
}

function pathMatch(a, b) {
  if (a === b) return true;
  try {
    return a.normalize('NFC') === b.normalize('NFC')
      || a.normalize('NFD') === b.normalize('NFD');
  } catch {
    return false;
  }
}

function resolveTexturePath(mapKd, mtlDir, fileMap, materialName = '') {
  const tryPath = (p) => {
    if (!p) return null;
    const n = p.replace(/\\/g, '/');
    if (fileMap.has(n)) return n;
    for (const key of fileMap.keys()) {
      if (pathMatch(key, n) || pathMatch(key.split('/').pop(), n.split('/').pop())) return key;
    }
    return null;
  };

  if (mapKd) {
    let tex = mapKd.replace(/\\/g, '/');
    if (tex.includes(' ')) tex = tex.split(/\s+/).pop();
    const hit = tryPath(tex)
      || tryPath(mtlDir ? `${mtlDir}/${tex}` : tex)
      || tryPath(tex.split('/').pop());
    if (hit) return { resolved: hit, suggested: hit };
    return { resolved: null, suggested: tex.split('/').pop() };
  }

  if (materialName) {
    for (const ext of ['.png', '.jpg', '.jpeg']) {
      const guess = `${materialName}${ext}`;
      const hit = tryPath(guess) || tryPath(mtlDir ? `${mtlDir}/${guess}` : guess);
      if (hit) return { resolved: hit, suggested: hit, guessed: true };
    }
  }
  return { resolved: null, suggested: materialName ? `${materialName}.png` : null };
}

function parseMtlLines(text) {
  const materials = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('newmtl ')) {
      current = { name: trim(line.slice(7)), mapKd: null };
      materials.push(current);
    } else if (line.startsWith('map_Kd ') && current) {
      let tex = trim(line.slice(7));
      if (tex.includes(' ')) tex = tex.split(/\s+/).pop();
      current.mapKd = tex;
    }
  }
  return materials;
}

export function inspectModelFiles(files) {
  const fileMap = buildFileMap(files);
  let objPath = null;
  let objText = null;
  for (const [rel, bytes] of fileMap) {
    if (/\.obj$/i.test(rel) && !objPath) {
      objPath = rel;
      objText = new TextDecoder().decode(bytes);
    }
  }

  let mtlPath = null;
  let mtlText = null;
  let mtlDir = '';
  if (objText) {
    const mtllib = objText.match(/^mtllib\s+(.+)$/im);
    if (mtllib) {
      const mtlName = trim(mtllib[1]).replace(/\\/g, '/');
      mtlDir = mtlName.includes('/') ? mtlName.split('/').slice(0, -1).join('/') : '';
      mtlPath = fileMap.has(mtlName) ? mtlName : null;
      if (!mtlPath) {
        for (const key of fileMap.keys()) {
          if (pathMatch(key, mtlName) || pathMatch(key.split('/').pop(), mtlName)) {
            mtlPath = key;
            mtlDir = key.includes('/') ? key.split('/').slice(0, -1).join('/') : '';
            break;
          }
        }
      }
    }
  }
  if (!mtlPath) {
    for (const key of fileMap.keys()) {
      if (/\.mtl$/i.test(key)) {
        mtlPath = key;
        mtlDir = key.includes('/') ? key.split('/').slice(0, -1).join('/') : '';
        break;
      }
    }
  }
  if (mtlPath) mtlText = new TextDecoder().decode(fileMap.get(mtlPath));

  const materials = mtlText ? parseMtlLines(mtlText) : [];
  const rows = materials.map((mat) => {
    const { resolved, suggested, guessed } = resolveTexturePath(mat.mapKd, mtlDir, fileMap, mat.name);
    return {
      name: mat.name,
      mapKd: mat.mapKd,
      resolved,
      suggested: resolved || suggested,
      ok: Boolean(resolved),
      guessed: Boolean(guessed),
    };
  });

  const textureFiles = [...fileMap.keys()].filter((k) => /\.(png|jpe?g|webp)$/i.test(k));
  const missingCount = rows.filter((r) => r.mapKd && !r.ok).length;
  const noMapKdCount = rows.filter((r) => !r.mapKd).length;

  return {
    objPath,
    mtlPath,
    mtlDir,
    mtlText,
    materials: rows,
    textureFiles,
    canCompile: Boolean(objPath) && rows.every((r) => !r.mapKd || r.ok),
    issues: [
      !objPath ? 'Missing .obj file' : null,
      !mtlPath ? 'Missing .mtl file — textures cannot be baked' : null,
      missingCount ? `${missingCount} material(s) reference textures not found in the folder` : null,
      noMapKdCount ? `${noMapKdCount} material(s) have no map_Kd line` : null,
    ].filter(Boolean),
  };
}

/** Rewrite map_Kd paths to resolved files; returns updated MTL text. */
export function buildFixedMtlText(mtlText, mtlDir, fileMap) {
  if (!mtlText) return { text: '', changes: [] };
  const changes = [];
  let current = '';
  const lines = mtlText.split(/\r?\n/).map((line) => {
    if (line.startsWith('newmtl ')) current = trim(line.slice(7));
    if (line.startsWith('map_Kd ') && current) {
      let tex = trim(line.slice(7));
      if (tex.includes(' ')) tex = tex.split(/\s+/).pop();
      const { resolved, suggested } = resolveTexturePath(tex, mtlDir, fileMap);
      if (resolved && resolved !== tex) {
        changes.push({ material: current, from: tex, to: resolved });
        return `map_Kd ${resolved}`;
      }
      if (!resolved && suggested) {
        const tryPath = resolveTexturePath(suggested, mtlDir, fileMap).resolved;
        if (tryPath) {
          changes.push({ material: current, from: tex, to: tryPath });
          return `map_Kd ${tryPath}`;
        }
      }
    }
    return line;
  });
  return { text: lines.join('\n'), changes };
}

export function applyMtlFixToFiles(files, inspect) {
  if (!inspect.mtlPath || !inspect.mtlText) return { files, changes: [] };
  const fileMap = buildFileMap(files);
  const { text, changes } = buildFixedMtlText(inspect.mtlText, inspect.mtlDir, fileMap);
  if (!changes.length) return { files, changes: [] };
  const enc = new TextEncoder();
  const next = files.map((f) => {
    if (f.relativePath.replace(/\\/g, '/') === inspect.mtlPath) {
      return { ...f, bytes: enc.encode(text).buffer };
    }
    return f;
  });
  return { files: next, changes };
}

export function analyzeCompileFiles(files) {
  const inspect = inspectModelFiles(files);
  const root = files[0]?.relativePath.replace(/\\/g, '/').split('/').filter(Boolean)[0] || '';
  return {
    obj: inspect.objPath,
    mtl: inspect.mtlPath,
    textures: inspect.textureFiles,
    modelId: root.replace(/[^a-zA-Z0-9_-]/g, '_') || 'model',
    valid: Boolean(inspect.objPath) && inspect.canCompile,
    issues: inspect.issues,
    mtlInspect: inspect,
  };
}
