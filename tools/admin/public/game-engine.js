let cachedTools = null;

export async function loadGameEngineTools(api) {
  if (cachedTools) return cachedTools;
  const res = await api('/api/game-engine/tools');
  cachedTools = res.tools || [];
  return cachedTools;
}

export function gameEngineToolIds(tools) {
  return (tools || []).map((t) => t.id);
}

export function gameEngineToolById(tools, id) {
  return (tools || []).find((t) => t.id === id) || null;
}

export function gameEngineHubHtml(tools, esc) {
  const cards = (tools || []).map((tool) => `
    <button type="button" class="game-engine-card" data-game-engine-tool="${esc(tool.id)}" aria-label="Open ${esc(tool.title)}">
      <img class="game-engine-card-thumb" src="${esc(tool.image)}" alt="" loading="lazy" width="640" height="400"/>
      <span class="game-engine-card-body">
        <h3>${esc(tool.title)}</h3>
        <p>${esc(tool.description)}</p>
        <span class="game-engine-card-cta">Open tool →</span>
      </span>
    </button>`).join('');
  return `<section class="toolbar feature-toolbar game-engine-toolbar">
    <div>
      <h2>Game Engine</h2>
      <p class="game-engine-intro">Build and tune resort gameplay assets. Pick a tool to open it in the workbench — your place on the desk stays underneath when you slide back.</p>
    </div>
  </section>
  <section class="panel game-engine-page">
    <div class="game-engine-grid" role="list">${cards || '<p class="hint">No tools configured. See tools/admin/docs/adding-game-engine-tools.md</p>'}</div>
  </section>`;
}

export function bindGameEngineHub(state, deps) {
  document.querySelectorAll('[data-game-engine-tool]').forEach((btn) => {
    btn.onclick = () => deps.openGameEngineTool(btn.dataset.gameEngineTool);
  });
}

export function workbenchTitleForTool(tools, toolId) {
  const tool = gameEngineToolById(tools, toolId);
  return tool?.title || 'Game Engine';
}
