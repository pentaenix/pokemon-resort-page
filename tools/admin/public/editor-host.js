const moduleCache = new Map();
const loadedStyles = new Set();

export function ensureEditorStyles(urls = []) {
  for (const href of urls) {
    if (!href || loadedStyles.has(href)) continue;
    loadedStyles.add(href);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}

export function applyEditorBodyClasses(tools, activeTool) {
  for (const tool of tools || []) {
    if (tool.bodyClass) document.body.classList.remove(tool.bodyClass);
  }
  if (activeTool?.bodyClass) document.body.classList.add(activeTool.bodyClass);
}

export async function importEditorModule(tool) {
  if (!tool?.entry) throw new Error(`Editor "${tool?.id || '?'}" has no entry module.`);
  ensureEditorStyles(tool.styles);
  if (!moduleCache.has(tool.entry)) {
    moduleCache.set(tool.entry, import(tool.entry));
  }
  return moduleCache.get(tool.entry);
}

export async function initEditorWorkbench(state, api, tool) {
  const mod = await importEditorModule(tool);
  if (typeof mod.initEditorTab === 'function') await mod.initEditorTab(state, api);
  return mod;
}

export async function editorWorkbenchHtml(state, esc, tool) {
  const mod = await importEditorModule(tool);
  if (typeof mod.editorHtml !== 'function') {
    throw new Error(`Editor "${tool.id}" is missing editorHtml().`);
  }
  return mod.editorHtml(state, esc);
}

export function bindEditorWorkbench(state, deps, tool) {
  return importEditorModule(tool).then((mod) => {
    if (typeof mod.bindEditor === 'function') mod.bindEditor(state, deps);
    return mod;
  });
}
