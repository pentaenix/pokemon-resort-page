export function ensureCharacterEditorState(state) {
  if (!state.characterEditor) {
    state.characterEditor = { running: false, starting: false, error: '', charactersDirectory: '' };
  }
  return state.characterEditor;
}

export async function pollCharacterEditorStatus(api) {
  return api('/api/character-editor/status');
}

export async function initCharacterEditorTab(state, api) {
  const ce = ensureCharacterEditorState(state);
  try {
    const status = await pollCharacterEditorStatus(api);
    ce.running = Boolean(status.running && status.healthy);
    ce.starting = false;
    ce.error = status.error || '';
    ce.charactersDirectory = status.charactersDirectory || '';
  } catch (e) {
    ce.error = e.message;
    ce.running = false;
  }
}

export function characterEditorHtml(state, esc) {
  const ce = ensureCharacterEditorState(state);
  let body = '';
  if (ce.starting) {
    body = '<div class="character-editor-placeholder">Starting character editor…</div>';
  } else if (!ce.running) {
    body = `<div class="character-editor-placeholder">
      <p>Character editor is not running. Click below to start the local editor process.</p>
      <button type="button" class="btn" id="characterEditorStart">Start character editor</button>
      ${ce.error ? `<p class="character-editor-error">${esc(ce.error)}</p>` : ''}
    </div>`;
  } else {
    body = '<iframe id="characterEditorFrame" class="character-editor-frame" src="/character-editor/?embed=1" title="Character Editor"></iframe>';
  }
  const dirHint = ce.charactersDirectory
    ? `<span class="character-dir-hint" title="${esc(ce.charactersDirectory)}">Charbin library</span>`
    : '';
  return `<section class="character-editor-page">
    <section class="toolbar character-editor-commandbar">
      <div class="character-workbench-brand">
        <button type="button" class="character-menu-btn" id="characterExitWorkbench">Back to Admin</button>
        <span class="character-menu-title">Character Editor</span>
        ${ce.running ? '<span class="character-running-pill">Running</span>' : ''}
        ${dirHint}
      </div>
      <div class="actions">
        <button type="button" class="btn ghost" id="characterEditorEnd" ${ce.running ? '' : 'disabled'}>End editor</button>
      </div>
    </section>
    ${body}
  </section>`;
}

export function bindCharacterEditor(state, deps) {
  const { api, log, render, navigateToTab } = deps;
  const ce = ensureCharacterEditorState(state);

  if (!window.__spmkLogBridge) {
    window.__spmkLogBridge = true;
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'spmk-log') return;
      log(data.message, data.tone || '');
    });
  }

  const frame = document.getElementById('characterEditorFrame');
  if (frame && !frame.dataset.logBridgeBound) {
    frame.dataset.logBridgeBound = '1';
    frame.addEventListener('load', () => log('Character editor UI loaded.', 'ok'));
  }

  const backBtn = document.getElementById('characterExitWorkbench');
  if (backBtn) {
    backBtn.onclick = () => navigateToTab(state.deskReturnTab || 'Dashboard');
  }

  const startBtn = document.getElementById('characterEditorStart');
  if (startBtn) {
    startBtn.onclick = async () => {
      ce.starting = true;
      ce.error = '';
      render();
      try {
        const res = await api('/api/character-editor/start', { method: 'POST' });
        ce.running = Boolean(res.running && res.healthy);
        ce.charactersDirectory = res.charactersDirectory || ce.charactersDirectory;
        ce.error = res.error || '';
        log(ce.running ? 'Character editor started.' : (ce.error || 'Character editor failed to start.'), ce.running ? 'ok' : 'error');
      } catch (e) {
        ce.error = e.message;
        log(e.message, 'error');
      } finally {
        ce.starting = false;
        render();
      }
    };
  }

  const endBtn = document.getElementById('characterEditorEnd');
  if (endBtn) {
    endBtn.onclick = async () => {
      try {
        await api('/api/character-editor/stop', { method: 'POST' });
        ce.running = false;
        log('Character editor stopped.', 'ok');
        render();
      } catch (e) {
        log(e.message, 'error');
      }
    };
  }
}

/** Standard module API for editor-host.js */
export const initEditorTab = initCharacterEditorTab;
export const editorHtml = characterEditorHtml;
export const bindEditor = bindCharacterEditor;
