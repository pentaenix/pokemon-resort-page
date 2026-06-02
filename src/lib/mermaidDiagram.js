import mermaid from 'mermaid';

let ready = false;
let renderCounter = 0;

export const DIAGRAM_SOURCE_MAX = 32000;

export async function ensureMermaid() {
  if (ready) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'neutral',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  });
  ready = true;
}

export function normalizeDiagramSource(source) {
  const text = String(source || '').trim();
  if (!text || text.length > DIAGRAM_SOURCE_MAX) return '';
  return text;
}

export async function renderMermaidSvg(source, idPrefix = 'mmd') {
  const normalized = normalizeDiagramSource(source);
  if (!normalized) return '';
  await ensureMermaid();
  const id = `${idPrefix}-${++renderCounter}`;
  try {
    const { svg } = await mermaid.render(id, normalized);
    return svg;
  } catch (error) {
    const message = error?.message || 'Diagram could not be rendered.';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 80" role="img" aria-label="Diagram error"><rect width="420" height="80" fill="#fff5f5" stroke="#e57373" rx="8"/><text x="16" y="34" fill="#8b1a1a" font-family="system-ui,sans-serif" font-size="14">Diagram error</text><text x="16" y="56" fill="#8b1a1a" font-family="ui-monospace,monospace" font-size="11">${escapeSvgText(message.slice(0, 120))}</text></svg>`;
  }
}

function escapeSvgText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const DEFAULT_DIAGRAM_TEMPLATES = {
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
  'flowchart': {
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
  return DEFAULT_DIAGRAM_TEMPLATES['pokemon-ai-state'].source;
}
