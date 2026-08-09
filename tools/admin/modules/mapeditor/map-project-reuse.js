function safeId(value) {
  return String(value || 'map')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'map';
}

export function createReusedMapEntry(project, sourceId) {
  const source = project?.maps?.find((entry) => entry.id === sourceId);
  if (!source?.file) return null;
  const sourceRootId = source.sourceMapId || source.id;
  const base = safeId(`${sourceRootId}_instance`);
  let id = base;
  let suffix = 2;
  while (project.maps.some((entry) => entry.id === id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  return {
    id,
    name: `${source.name || source.id} instance`,
    file: source.file,
    sourceMapId: sourceRootId,
    gridX: 0,
    gridY: 0,
    linked: false,
  };
}

export function otherEntriesUsingFile(project, entry) {
  if (!entry?.file) return [];
  return (project?.maps || []).filter((candidate) =>
    candidate.id !== entry.id && candidate.file === entry.file);
}
