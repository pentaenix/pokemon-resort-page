const ACTIONS = ['WAIT', 'FACE', 'FACE_PLAYER', 'FACE_AWAY', 'MOVE', 'WANDER', 'JUMP', 'TEXT', 'TEXT_FREE', 'POKEMON_INTERACTION_SESSION', 'DISABLE_ATTEND', 'ENABLE_ATTEND', 'EXIT_INTERACTION', 'CRY', 'EMOTICON'];
const VARIABLES = [
  ['{NAME}', 'Actor name'], ['{SPECIES}', 'Pokemon species'], ['{ROLE}', 'Actor role'], ['{TILE}', 'Current tile'],
  ['{PLAYER_NAME}', 'Player name'], ['{TYPE_PRIMARY}', 'Primary type'], ['{TYPE_SECONDARY}', 'Secondary type'],
  ['{NATURE}', 'Nature'], ['{FORM}', 'Form'], ['{COMPANION_NAME}', 'Companion name'], ['{NEARBY_POKEMON_NAME}', 'Nearby Pokemon']
];
const NATURES = ['HARDY', 'LONELY', 'BRAVE', 'ADAMANT', 'NAUGHTY', 'BOLD', 'DOCILE', 'RELAXED', 'IMPISH', 'LAX', 'TIMID', 'HASTY', 'SERIOUS', 'JOLLY', 'NAIVE', 'MODEST', 'MILD', 'QUIET', 'BASHFUL', 'RASH', 'CALM', 'GENTLE', 'SASSY', 'CAREFUL', 'QUIRKY'];
const TYPES = ['NORMAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE', 'FIGHTING', 'POISON', 'GROUND', 'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY'];
const SCRIPT_CONDITIONS = [
  ['targetGates', 'POKEMON', 'Pokemon target'], ['targetGates', 'CHARACTER', 'Character target'],
  ['when.allTags', 'FOLLOWER', 'Follower'], ['when.allTags', 'NATURE', 'Nature', NATURES], ['closeTo', 'PLAYER', 'Close to player', 2]
];
const TEXT_CONDITIONS = [
  ['requiredTags', 'POKEMON', 'Pokemon'], ['requiredTags', 'TILE_GROUND', 'Ground tile'],
  ['requiredTags', 'TYPE', 'Pokemon type', TYPES], ['requiredTags', 'SPECIES', 'Species', 'SPECIES']
];
const clone = (value) => JSON.parse(JSON.stringify(value));
const blankScript = (kind = 'interaction') => ({ id: 'new_script', kind, targetGates: ['POKEMON'], trigger: kind === 'interaction' ? 'ACCEPT' : 'AUTONOMOUS', priority: 0, weight: 1, cooldownSeconds: 0, when: { allTags: [], noneTags: [] }, actions: [{ action: kind === 'interaction' ? 'TEXT_FREE' : 'WANDER' }] });
const blankText = () => ({ id: 'new_pokemon_text', body: '{NAME} looks pleased to be here.', requiredTags: ['POKEMON'], weight: 1, globalCooldownSeconds: 20 });

function engine(state) {
  if (!state.scriptEngine) state.scriptEngine = { mode: 'scripts', scripts: [], selectedPath: '', script: null, selectedAction: 0, catalog: { texts: [] }, conditionSpecies: [], selectedTextId: '', text: null, issues: [], query: '', loading: false, previewTags: 'POKEMON, FOLLOWER', previewDistance: 1 };
  return state.scriptEngine;
}
function esc(value = '') { const el = document.createElement('span'); el.textContent = String(value); return el.innerHTML; }
function actionLabel(action) { return String(action?.action || 'WAIT').replaceAll('_', ' '); }
function actionSummary(action) {
  const value = action?.text || action?.value || action?.direction || action?.durationSeconds;
  return value ? String(value) : 'Ready';
}
function conditionLabel(tag) { const match = /^(NATURE|TYPE|SPECIES)_(.+)$/.exec(tag); return match ? `${match[1][0]}${match[1].slice(1).toLowerCase()}: ${match[2][0]}${match[2].slice(1).toLowerCase()}` : tag.replaceAll('_', ' '); }
function conditionChip(group, tag, label = conditionLabel(tag)) { return `<span class="condition-chip"><span>${esc(label)}</span><button type="button" title="Remove ${esc(label)}" aria-label="Remove ${esc(label)}" data-condition-remove-group="${group}" data-condition-remove-tag="${esc(tag)}">×</button></span>`; }
function tags(value = [], group = '') { return value.map((tag) => conditionChip(group, tag)).join(''); }
function conditionPalette(conditions, editor) { return `<div class="condition-palette">${conditions.map(([group, tag, label, valuesOrTiles = '']) => { const values = valuesOrTiles === 'SPECIES' ? editor.conditionSpecies : valuesOrTiles; return Array.isArray(values) ? `<span class="condition-select"><select aria-label="${esc(label)} value">${values.map((value) => `<option value="${value}">${value.split('_').map((part) => part[0] + part.slice(1).toLowerCase()).join(' ')}</option>`).join('')}</select><button type="button" class="condition-option" draggable="true" data-condition-group="${group}" data-condition-prefix="${tag}" title="Add ${esc(label)}">${esc(label)}</button></span>` : `<button type="button" class="condition-option" draggable="true" data-condition-group="${group}" data-condition-tag="${tag}" data-condition-tiles="${valuesOrTiles}" title="${esc(label)}">${esc(label)}</button>`; }).join('')}</div>`; }
function previewMatches(script, tagsValue, distance) {
  const set = new Set(String(tagsValue || '').split(',').map((tag) => tag.trim().toUpperCase()).filter(Boolean));
  const when = script?.when || {};
  if ((script?.targetGates || []).some((tag) => !set.has(String(tag).toUpperCase()))) return false;
  if ((when.allTags || []).some((tag) => !set.has(String(tag).toUpperCase()))) return false;
  if ((when.noneTags || []).some((tag) => set.has(String(tag).toUpperCase()))) return false;
  return !when.closeTo?.tag || Number(distance) <= Number(when.closeTo.maxTiles || 0);
}
function selectedText(editor) { return editor.catalog.texts.find((entry) => entry.id === editor.selectedTextId) || editor.text; }
function scriptFiles(editor) {
  return editor.scripts.filter((item) => item.path.toLowerCase().includes(editor.query.toLowerCase())).map((item) => `<button type="button" class="library-row ${item.path === editor.selectedPath ? 'selected' : ''}" data-script-file="${esc(item.path)}"><strong>${esc(item.path.split('/').pop().replace('.json', ''))}</strong><small>${esc(item.path.split('/')[0])}</small></button>`).join('');
}
function textFiles(editor) {
  return editor.catalog.texts.filter((item) => `${item.id} ${item.body}`.toLowerCase().includes(editor.query.toLowerCase())).map((item) => `<button type="button" class="library-row ${item.id === editor.selectedTextId ? 'selected' : ''}" data-text-id="${esc(item.id)}"><strong>${esc(item.id)}</strong><small>${esc(item.requiredTags?.join(' + ') || 'No conditions')}</small></button>`).join('');
}
function scriptConditions(script) {
  const when = script?.when || {};
  const close = when.closeTo?.tag ? conditionChip('closeTo', when.closeTo.tag, `Close to ${when.closeTo.tag} / ${Number(when.closeTo.maxTiles) || 0}`) : '';
  const targetGates = script?.targetGates || [];
  return `${tags(targetGates, 'targetGates')}${tags((when.allTags || []).filter((tag) => !targetGates.includes(tag)), 'when.allTags')}${tags((when.noneTags || []).map((tag) => `NOT ${tag}`), 'when.noneTags')}${close}` || '<span class="condition-muted">Drop a condition here</span>';
}
function scriptCanvas(editor) {
  const script = editor.script;
  if (!script) return '<div class="canvas-empty">Choose a script from the library or start a new one.</div>';
  const rows = (script.actions || []).map((action, index) => `<button type="button" class="sequence-block ${editor.selectedAction === index ? 'selected' : ''}" draggable="true" data-script-action="${index}"><span class="sequence-index">${index + 1}</span><span class="sequence-action">${esc(actionLabel(action))}</span><small>${esc(actionSummary(action))}</small></button>`).join('');
  return `<div class="script-title"><div><span>Script outcome</span><h3>${esc(script.id)}</h3></div><div class="status-pills"><b>${esc(script.kind)}</b><b>${esc(script.trigger || 'AUTONOMOUS')}</b></div></div><section class="condition-zone"><div class="zone-label">Conditions</div><div class="condition-flow" data-condition-drop>${scriptConditions(script)}</div><div class="condition-library"><span>Available conditions</span>${conditionPalette(SCRIPT_CONDITIONS, editor)}</div></section><section class="sequence-zone"><div class="zone-label">Sequence</div><div class="sequence-track" data-script-drop>${rows || '<div class="canvas-empty">Add an action to begin.</div>'}</div></section><section class="action-palette"><div class="zone-label">Actions</div><div>${ACTIONS.map((name) => `<button type="button" data-script-add="${name}">${name.replaceAll('_', ' ')}</button>`).join('')}</div></section>`;
}
function textCanvas(editor) {
  const text = selectedText(editor);
  if (!text) return '<div class="canvas-empty">Choose a Pokemon text or start a new one.</div>';
  return `<div class="script-title"><div><span>Pokemon free text</span><h3>${esc(text.id)}</h3></div><div class="status-pills"><b>TEXT FREE</b></div></div><section class="condition-zone"><div class="zone-label">Conditions</div><div class="condition-flow" data-condition-drop>${tags(text.requiredTags || [], 'requiredTags')}</div><div class="condition-library"><span>Available conditions</span>${conditionPalette(TEXT_CONDITIONS, editor)}</div></section><section class="dialogue-composer"><div class="zone-label">Dialogue</div><textarea data-text-body aria-label="Pokemon dialogue">${esc(text.body)}</textarea><div class="variable-tray"><span>Insert variable</span>${VARIABLES.map(([token, title]) => `<button type="button" title="${esc(title)}" data-variable="${token}">${token}</button>`).join('')}</div></section><section class="text-preview"><div class="zone-label">Textbox preview</div><p>${esc(text.body || 'Your Pokemon has something to say.').replaceAll(/\{[A-Z_]+\}/g, '<mark>$&</mark>')}</p></section>`;
}
function actionInspectorFields(action) {
  const type = String(action?.action || '').toUpperCase();
  const fields = [`<label>Action<select data-action-field="action">${ACTIONS.map((name) => `<option value="${name}" ${type === name ? 'selected' : ''}>${name.replaceAll('_', ' ')}</option>`).join('')}</select></label>`];
  if (type === 'FACE') fields.push(`<label>Direction<select data-action-field="direction">${['south', 'north', 'east', 'west'].map((name) => `<option value="${name}" ${action.direction === name ? 'selected' : ''}>${name}</option>`).join('')}</select></label>`);
  if (type === 'TEXT' || type === 'TEXT_LITERAL') fields.push(`<label>Text / value<input data-action-field="text" value="${esc(action.text || action.value || '')}"></label>`);
  if (type === 'WAIT') fields.push(`<label>Duration<input data-action-field="durationSeconds" type="number" min="0" value="${Number(action.durationSeconds) || 0}"></label>`);
  if (type === 'JUMP') fields.push(`<label>Jump height<input data-action-field="heightPixels" type="number" min="0" value="${Number(action.heightPixels) || 0}"></label>`);
  return fields.join('');
}
function scriptInspector(editor) {
  const script = editor.script;
  const action = script?.actions?.[editor.selectedAction];
  if (!script) return '<div class="inspector-empty">Script details appear here.</div>';
  return `<div class="inspector-title">Script settings</div><label>Id<input data-script-field="id" value="${esc(script.id)}"></label><label>Kind<select data-script-field="kind">${['idle', 'interaction', 'npc'].map((kind) => `<option value="${kind}" ${script.kind === kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></label><div class="field-grid"><label>Priority<input data-script-field="priority" type="number" value="${Number(script.priority) || 0}"></label><label>Weight<input data-script-field="weight" type="number" min="1" value="${Number(script.weight) || 1}"></label></div><label>Cooldown seconds<input data-script-field="cooldownSeconds" type="number" min="0" value="${Number(script.cooldownSeconds) || 0}"></label>${script.when?.closeTo?.tag ? `<label>Close-to tiles<input data-close-tiles type="number" min="0" value="${Number(script.when.closeTo.maxTiles) || 0}"></label>` : ''}<div class="inspector-title">Context preview</div><div class="context-check"><input data-preview-tags value="${esc(editor.previewTags)}"><input data-preview-distance type="number" min="0" value="${Number(editor.previewDistance) || 0}"><b class="${previewMatches(script, editor.previewTags, editor.previewDistance) ? 'pass' : 'fail'}">${previewMatches(script, editor.previewTags, editor.previewDistance) ? 'Matches sample' : 'Does not match'}</b></div>${action ? `<div class="inspector-title">Action ${editor.selectedAction + 1}</div>${actionInspectorFields(action)}<button type="button" class="danger" data-script-action-remove>Remove action</button>` : ''}`;
}
function textInspector(editor) {
  const text = selectedText(editor);
  if (!text) return '<div class="inspector-empty">Text settings appear here.</div>';
  return `<div class="inspector-title">Text settings</div><label>Id<input data-text-field="id" value="${esc(text.id)}"></label><div class="field-grid"><label>Weight<input data-text-field="weight" type="number" min="1" value="${Number(text.weight) || 1}"></label><label>Global cooldown<input data-text-field="globalCooldownSeconds" type="number" min="0" value="${Number(text.globalCooldownSeconds) || 0}"></label></div><div class="owner-note"><strong>Pokemon catalog</strong><span>Human NPC dialogue stays in each character charbin.</span></div>`;
}
function editorHtml(state) {
  const editor = engine(state); const textMode = editor.mode === 'texts';
  return `<section class="script-engine-page"><header class="workbench-header"><div><span>Operations Desk</span><h2>Script Engine</h2></div><div class="header-actions"><button type="button" class="${!textMode ? 'active' : ''}" data-engine-mode="scripts">Scripts</button><button type="button" class="${textMode ? 'active' : ''}" data-engine-mode="texts">Text database</button><button type="button" data-engine-new>New</button><button type="button" class="save" data-engine-save ${textMode ? '' : editor.script ? '' : 'disabled'}>Save</button></div></header><div class="script-engine-workbench"><aside class="library-pane"><div class="pane-heading"><span>Library</span><small>${textMode ? 'Pokemon free text' : 'Behavior scripts'}</small></div><input type="search" placeholder="Search library" value="${esc(editor.query)}" data-engine-search><div class="library-list">${textMode ? textFiles(editor) : scriptFiles(editor)}</div></aside><main class="canvas-pane">${textMode ? textCanvas(editor) : scriptCanvas(editor)}</main><aside class="inspector-pane">${textMode ? textInspector(editor) : scriptInspector(editor)}${editor.issues.length ? `<div class="validation-notice">${esc(editor.issues.join(' '))}</div>` : ''}</aside></div></section>`;
}
async function loadScript(editor, api, path, render) { editor.selectedPath = path; editor.selectedAction = 0; editor.issues = []; editor.script = (await api(`/api/script-engine/script?path=${encodeURIComponent(path)}`)).script; render(); }
function selectText(editor, id) { editor.selectedTextId = id; editor.text = editor.catalog.texts.find((entry) => entry.id === id) || null; }
function insertVariable(editor, token, render) { const area = document.querySelector('[data-text-body]'); const text = selectedText(editor); if (!area || !text) return; const start = area.selectionStart; const end = area.selectionEnd; text.body = `${text.body.slice(0, start)}${token}${text.body.slice(end)}`; render(); requestAnimationFrame(() => { const next = document.querySelector('[data-text-body]'); if (next) { next.focus(); next.setSelectionRange(start + token.length, start + token.length); } }); }
function conditionFromButton(button) { const prefix = button.dataset.conditionPrefix; const value = button.closest('.condition-select')?.querySelector('select')?.value; return { group: button.dataset.conditionGroup, tag: prefix ? `${prefix}_${value}` : button.dataset.conditionTag, tiles: Number(button.dataset.conditionTiles) || 0 }; }
function addCondition(editor, condition) {
  if (editor.mode === 'texts') {
    const text = selectedText(editor); if (text && !text.requiredTags.includes(condition.tag)) text.requiredTags.push(condition.tag);
    return;
  }
  const script = editor.script; if (!script) return;
  if (condition.group === 'targetGates') script.targetGates = [condition.tag];
  if (condition.group === 'when.allTags') { script.when ||= {}; script.when.allTags ||= []; if (!script.when.allTags.includes(condition.tag)) script.when.allTags.push(condition.tag); }
  if (condition.group === 'closeTo') { script.when ||= {}; script.when.closeTo ||= { tag: condition.tag, maxTiles: condition.tiles || 2 }; }
}
function removeCondition(editor, group, tag) {
  if (editor.mode === 'texts') { const text = selectedText(editor); if (text) text.requiredTags = text.requiredTags.filter((value) => value !== tag); return; }
  const script = editor.script; if (!script) return;
  if (group === 'targetGates') { script.targetGates = script.targetGates.filter((value) => value !== tag); script.when.allTags = (script.when.allTags || []).filter((value) => value !== tag); }
  if (group === 'when.allTags') script.when.allTags = (script.when.allTags || []).filter((value) => value !== tag);
  if (group === 'when.noneTags') script.when.noneTags = (script.when.noneTags || []).filter((value) => value !== tag.replace(/^NOT /, ''));
  if (group === 'closeTo') delete script.when.closeTo;
}
export async function initEditorTab(state, api) { const editor = engine(state); if (!editor.loading && !editor.scripts.length) { editor.loading = true; const [scripts, texts, values] = await Promise.all([api('/api/script-engine/scripts'), api('/api/script-engine/texts'), api('/api/script-engine/condition-values')]); editor.scripts = scripts.scripts || []; editor.catalog = texts.catalog || { texts: [] }; editor.conditionSpecies = values.species || []; if (editor.scripts[0]?.path) { editor.selectedPath = editor.scripts[0].path; editor.script = (await api(`/api/script-engine/script?path=${encodeURIComponent(editor.selectedPath)}`)).script; } editor.loading = false; } }
export { editorHtml };
export function bindEditor(state, { api, render, log }) {
  const editor = engine(state); let dragIndex = -1;
  document.querySelectorAll('[data-engine-mode]').forEach((button) => button.onclick = () => { editor.mode = button.dataset.engineMode; editor.query = ''; render(); });
  document.querySelector('[data-engine-search]')?.addEventListener('input', (event) => { editor.query = event.target.value; render(); });
  document.querySelectorAll('[data-script-file]').forEach((button) => button.onclick = () => loadScript(editor, api, button.dataset.scriptFile, render).catch((error) => { editor.issues = [error.message]; render(); }));
  document.querySelectorAll('[data-text-id]').forEach((button) => button.onclick = () => { selectText(editor, button.dataset.textId); render(); });
  document.querySelector('[data-engine-new]')?.addEventListener('click', () => { editor.issues = []; if (editor.mode === 'texts') { const text = blankText(); editor.catalog.texts.push(text); selectText(editor, text.id); } else { editor.selectedPath = 'interactions/new_script.json'; editor.script = blankScript(); editor.selectedAction = 0; } render(); });
  document.querySelector('[data-engine-save]')?.addEventListener('click', async () => { try { if (editor.mode === 'texts') { const result = await api('/api/script-engine/texts/save', { method: 'POST', body: JSON.stringify({ catalog: editor.catalog }) }); editor.issues = result.issues || []; log('Text database saved.', 'ok'); } else { const result = await api('/api/script-engine/save', { method: 'POST', body: JSON.stringify({ path: editor.selectedPath, script: editor.script }) }); editor.issues = result.issues || []; if (!editor.scripts.some((item) => item.path === editor.selectedPath)) editor.scripts.push({ path: editor.selectedPath }); log('Script saved.', 'ok'); } render(); } catch (error) { editor.issues = [error.message]; render(); } });
  document.querySelectorAll('[data-script-action]').forEach((button) => { button.onclick = () => { editor.selectedAction = Number(button.dataset.scriptAction); render(); }; button.ondragstart = () => { dragIndex = Number(button.dataset.scriptAction); }; });
  document.querySelectorAll('[data-condition-group]').forEach((button) => { button.onclick = () => { addCondition(editor, conditionFromButton(button)); render(); }; button.ondragstart = (event) => event.dataTransfer.setData('application/x-script-condition', JSON.stringify(conditionFromButton(button))); });
  document.querySelectorAll('[data-condition-remove-group]').forEach((button) => button.onclick = () => { removeCondition(editor, button.dataset.conditionRemoveGroup, button.dataset.conditionRemoveTag); render(); });
  document.querySelector('[data-condition-drop]')?.addEventListener('dragover', (event) => event.preventDefault());
  document.querySelector('[data-condition-drop]')?.addEventListener('drop', (event) => { event.preventDefault(); const raw = event.dataTransfer.getData('application/x-script-condition'); if (!raw) return; try { addCondition(editor, JSON.parse(raw)); render(); } catch { /* Ignore invalid external drops. */ } });
  document.querySelector('[data-script-drop]')?.addEventListener('dragover', (event) => event.preventDefault());
  document.querySelector('[data-script-drop]')?.addEventListener('drop', (event) => { event.preventDefault(); const target = event.target.closest('[data-script-action]'); const to = target ? Number(target.dataset.scriptAction) : editor.script.actions.length - 1; if (dragIndex >= 0 && to >= 0 && dragIndex !== to) { const [action] = editor.script.actions.splice(dragIndex, 1); editor.script.actions.splice(to, 0, action); editor.selectedAction = to; render(); } });
  document.querySelectorAll('[data-script-field]').forEach((input) => input.oninput = () => { const key = input.dataset.scriptField; editor.script[key] = input.type === 'number' ? Number(input.value) : input.value; });
  document.querySelector('[data-close-tiles]')?.addEventListener('input', (event) => { editor.script.when.closeTo.maxTiles = Math.max(0, Number(event.target.value) || 0); });
  document.querySelector('[data-preview-tags]')?.addEventListener('input', (event) => { editor.previewTags = event.target.value; render(); }); document.querySelector('[data-preview-distance]')?.addEventListener('input', (event) => { editor.previewDistance = Number(event.target.value); render(); });
  document.querySelectorAll('[data-action-field]').forEach((input) => {
    const updateAction = () => { const action = editor.script.actions[editor.selectedAction]; const key = input.dataset.actionField; if (key === 'text') action.text = input.value; else action[key] = input.type === 'number' ? Number(input.value) : input.value; if (key === 'action') render(); };
    input.oninput = updateAction;
    input.onchange = updateAction;
  });
  document.querySelector('[data-script-action-remove]')?.addEventListener('click', () => { editor.script.actions.splice(editor.selectedAction, 1); editor.selectedAction = Math.max(0, Math.min(editor.selectedAction, editor.script.actions.length - 1)); render(); });
  document.querySelectorAll('[data-script-add]').forEach((button) => button.onclick = () => { editor.script.actions.push({ action: button.dataset.scriptAdd }); editor.selectedAction = editor.script.actions.length - 1; render(); });
  document.querySelector('[data-text-body]')?.addEventListener('input', (event) => { selectedText(editor).body = event.target.value; });
  document.querySelectorAll('[data-variable]').forEach((button) => button.onclick = () => insertVariable(editor, button.dataset.variable, render));
  document.querySelectorAll('[data-text-field]').forEach((input) => input.oninput = () => { selectedText(editor)[input.dataset.textField] = input.type === 'number' ? Number(input.value) : input.value; });
}
