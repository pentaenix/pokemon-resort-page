import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Discover self-contained editors under tools/admin/modules (each folder has editor.json).
 * @param {string} modulesRoot absolute path to tools/admin/modules
 */
export async function loadEditorManifests(modulesRoot) {
  const entries = await readdir(modulesRoot, { withFileTypes: true });
  const tools = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('_')) continue;
    const manifestPath = join(modulesRoot, ent.name, 'editor.json');
    if (!existsSync(manifestPath)) continue;
    const raw = JSON.parse(await readFile(manifestPath, 'utf8'));
    tools.push({
      ...raw,
      module: ent.name,
      entry: raw.entry || `/modules/${ent.name}/editor.js`,
      styles: raw.styles || [`/modules/${ent.name}/editor.css`],
    });
  }
  tools.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return tools;
}

export function editorById(tools, id) {
  return (tools || []).find((t) => t.id === id) || null;
}

export function legacyRouteToEditorId(tools, route) {
  if (!route) return null;
  for (const tool of tools || []) {
    if (tool.id === route) return tool.id;
    if ((tool.legacyRoutes || []).includes(route)) return tool.id;
  }
  return null;
}
