let ready = false;
let renderCounter = 0;
/** @type {Promise<any> | null} */
let mermaidLoadPromise = null;

function loadMermaidBundle() {
  if (mermaidLoadPromise) return mermaidLoadPromise;
  if (globalThis.mermaid) {
    mermaidLoadPromise = Promise.resolve(globalThis.mermaid);
    return mermaidLoadPromise;
  }
  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/mermaid/dist/mermaid.min.js';
    script.async = true;
    script.onload = () => {
      if (globalThis.mermaid) resolve(globalThis.mermaid);
      else reject(new Error('Mermaid bundle loaded but global was missing.'));
    };
    script.onerror = () => reject(new Error('Failed to load Mermaid bundle.'));
    document.head.appendChild(script);
  });
  return mermaidLoadPromise;
}

async function ensureMermaid() {
  const mermaid = await loadMermaidBundle();
  if (ready) return mermaid;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'neutral',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  });
  ready = true;
  return mermaid;
}

export const DIAGRAM_TEMPLATES = {
  'pokemon-ai-state': {
    label: 'Pokémon AI — state machine',
    source: `stateDiagram-v2
    direction LR
    [*] --> Idle
    Idle --> Following: player moves
    Following --> Idle: player stops
    Idle --> Summoned: summon action
    Summoned --> Following: latch complete
    Following --> IdleBehaviour: player idle
    IdleBehaviour --> Following: player moves
    IdleBehaviour --> Idle: behaviour ends`,
  },
  'uml-class': {
    label: 'UML class diagram',
    source: `classDiagram
    class FollowerController {
      +update(dt)
      +setTarget(entity)
      -state: FollowerState
    }
    class NatureIdleConfig {
      +pickBehaviour(species)
    }
    class FollowerState {
      <<enumeration>>
      Idle
      Following
      Summoned
    }
    FollowerController --> NatureIdleConfig
    FollowerController --> FollowerState`,
  },
  'uml-sequence': {
    label: 'UML sequence diagram',
    source: `sequenceDiagram
    participant Player
    participant Follower
    participant AI as IdleBehaviour
    Player->>Follower: move input
    Follower->>Follower: enter Following
    Player->>Follower: stop moving
    Follower->>AI: pick idle behaviour
    AI-->>Follower: play animation`,
  },
  flowchart: {
    label: 'Flowchart',
    source: `flowchart TD
    A[Perceive player] --> B{In range?}
    B -->|yes| C[Follow path]
    B -->|no| D[Idle behaviour]
    C --> E{Player stopped?}
    E -->|yes| D
    E -->|no| C`,
  },
};

export function defaultDiagramSource() {
  return DIAGRAM_TEMPLATES['pokemon-ai-state'].source;
}

export async function renderDiagramSvg(source, idPrefix = 'desk') {
  const text = String(source || '').trim();
  if (!text) return '';
  const mermaid = await ensureMermaid();
  const id = `${idPrefix}-${++renderCounter}`;
  try {
    const { svg } = await mermaid.render(id, text);
    return svg;
  } catch (error) {
    const message = String(error?.message || 'Could not render diagram.').slice(0, 200);
    return `<div class="diagram-render-error"><strong>Diagram error</strong><p>${message}</p></div>`;
  }
}

let modalHost = null;
let previewTimer = 0;

function closeModal() {
  modalHost?.remove();
  modalHost = null;
  window.clearTimeout(previewTimer);
}

function templateOptionsHtml(selected = '') {
  return Object.entries(DIAGRAM_TEMPLATES).map(([key, tpl]) => (
    `<option value="${key}" ${key === selected ? 'selected' : ''}>${tpl.label}</option>`
  )).join('');
}

function schedulePreview(sourceTextarea, previewEl) {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(async () => {
    const svg = await renderDiagramSvg(sourceTextarea.value, 'desk-modal');
    previewEl.innerHTML = svg || '<p class="hint">Enter Mermaid source to preview.</p>';
  }, 320);
}

/**
 * @param {{ source?: string, title?: string, onSave: (payload: { source: string }) => void, esc: Function }} opts
 */
export function openDiagramEditorModal(opts) {
  closeModal();
  const { source = defaultDiagramSource(), title = 'Edit UML diagram', onSave, esc } = opts;
  modalHost = document.createElement('div');
  modalHost.className = 'diagram-editor-backdrop';
  modalHost.innerHTML = `<div class="diagram-editor-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="diagram-editor-head">
      <div><h2>${esc(title)}</h2><p class="hint">Mermaid text — class, state, sequence, and flowchart UML-style diagrams.</p></div>
      <button type="button" class="diagram-editor-close" data-diagram-close aria-label="Close">×</button>
    </header>
    <div class="diagram-editor-body">
      <div class="diagram-editor-side diagram-editor-source">
        <label class="diagram-template-picker">Start from template
          <select data-diagram-template>${templateOptionsHtml()}</select>
        </label>
        <label>Diagram source (Mermaid)
          <textarea rows="18" spellcheck="false" data-diagram-source>${esc(source)}</textarea>
        </label>
        <details class="diagram-help">
          <summary>Syntax cheat sheet</summary>
          <ul>
            <li><code>classDiagram</code> — UML classes &amp; relations</li>
            <li><code>stateDiagram-v2</code> — state machines</li>
            <li><code>sequenceDiagram</code> — message flows</li>
            <li><code>flowchart TD</code> — decision trees</li>
          </ul>
        </details>
      </div>
      <div class="diagram-editor-side diagram-editor-preview">
        <div class="diagram-editor-preview-head"><strong>Live preview</strong></div>
        <div class="diagram-editor-preview-stage" data-diagram-preview><p class="hint">Rendering…</p></div>
      </div>
    </div>
    <footer class="diagram-editor-foot">
      <button type="button" class="btn ghost" data-diagram-cancel>Cancel</button>
      <button type="button" class="btn primary" data-diagram-save>Save diagram</button>
    </footer>
  </div>`;
  document.body.appendChild(modalHost);

  const sourceTextarea = modalHost.querySelector('[data-diagram-source]');
  const previewEl = modalHost.querySelector('[data-diagram-preview]');
  const templateSelect = modalHost.querySelector('[data-diagram-template]');

  schedulePreview(sourceTextarea, previewEl);
  sourceTextarea.addEventListener('input', () => schedulePreview(sourceTextarea, previewEl));

  templateSelect.addEventListener('change', () => {
    const tpl = DIAGRAM_TEMPLATES[templateSelect.value];
    if (!tpl) return;
    if (sourceTextarea.value.trim() && !window.confirm('Replace current diagram with this template?')) {
      templateSelect.value = [...templateSelect.options].find((opt) => opt.defaultSelected)?.value || 'pokemon-ai-state';
      return;
    }
    sourceTextarea.value = tpl.source;
    schedulePreview(sourceTextarea, previewEl);
  });

  modalHost.addEventListener('click', (event) => {
    if (event.target === modalHost || event.target.closest('[data-diagram-close], [data-diagram-cancel]')) {
      event.preventDefault();
      closeModal();
    }
    if (event.target.closest('[data-diagram-save]')) {
      event.preventDefault();
      const nextSource = sourceTextarea.value.trim();
      if (!nextSource) {
        window.alert('Diagram source cannot be empty.');
        return;
      }
      onSave({ source: nextSource });
      closeModal();
    }
  });

  document.addEventListener('keydown', function onEsc(event) {
    if (event.key !== 'Escape' || !modalHost) return;
    document.removeEventListener('keydown', onEsc);
    closeModal();
  });

  sourceTextarea.focus();
}

export async function renderDiagramBlockPreview(blockEl) {
  const preview = blockEl?.querySelector('[data-diagram-inline-preview]');
  const source = blockEl?.querySelector('[data-block-diagram-source]')?.value || '';
  if (!preview) return;
  if (!source.trim()) {
    preview.innerHTML = '<p class="hint">No diagram yet — click Edit diagram.</p>';
    return;
  }
  preview.innerHTML = '<p class="hint">Rendering…</p>';
  preview.innerHTML = await renderDiagramSvg(source, 'desk-block');
}

export function renderAllDiagramPreviews(root) {
  root?.querySelectorAll('[data-dossier-block][data-block-kind="diagram"]').forEach((blockEl) => {
    renderDiagramBlockPreview(blockEl);
  });
}

/** @type {Map<string, object>} */
const dossierMountHandlers = new Map();

export function registerDiagramMountHandlers(mountSelector, deps) {
  dossierMountHandlers.set(mountSelector, deps);
}

export function bindDiagramEditorButtons() {
  if (document.body.dataset.diagramEditorBound === '1') return;
  document.body.dataset.diagramEditorBound = '1';

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-diagram-edit-btn]');
    if (!btn) return;
    event.preventDefault();

    const mountEl = btn.closest('[id$="DossierMount"]');
    if (!mountEl?.id) return;
    const mountSelector = `#${mountEl.id}`;
    const deps = dossierMountHandlers.get(mountSelector);
    if (!deps) return;

    const blockEl = btn.closest('[data-dossier-block]');
    const sourceInput = blockEl?.querySelector('[data-block-diagram-source]');
    if (!sourceInput) return;

    openDiagramEditorModal({
      source: sourceInput.value || defaultDiagramSource(),
      title: blockEl.querySelector('[data-block-diagram-title]')?.value?.trim() || 'Edit UML diagram',
      esc: deps.esc,
      onSave: ({ source }) => {
        sourceInput.value = source;
        const record = deps.getRecord?.();
        if (record && deps.readDossierFromDom) {
          record.dossier = deps.readDossierFromDom(deps.$, { keepDrafts: true, mountSelector });
        }
        renderDiagramBlockPreview(blockEl);
        deps.onDirty?.();
      },
    });
  });
}
