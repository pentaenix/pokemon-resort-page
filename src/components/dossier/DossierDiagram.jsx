import React, { useEffect, useId, useState } from 'react';
import { renderMermaidSvg } from '../../lib/mermaidDiagram.js';
import { DiagramExplorerModal } from '../DiagramExplorerModal.jsx';

const LOAD_ERROR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 96" role="img" aria-label="Diagram load error"><rect width="420" height="96" fill="#fff5f5" stroke="#e57373" rx="8"/><text x="16" y="34" fill="#8b1a1a" font-family="system-ui,sans-serif" font-size="14">Diagram could not load</text><text x="16" y="56" fill="#8b1a1a" font-family="ui-monospace,monospace" font-size="11">Restart dev server: npm run dev -- --force</text><text x="16" y="76" fill="#8b1a1a" font-family="ui-monospace,monospace" font-size="11">Then hard-refresh the page</text></svg>`;

export function DossierDiagram({ block }) {
  const reactId = useId().replace(/:/g, '');
  const [svgHtml, setSvgHtml] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setSvgHtml('');

    renderMermaidSvg(block.source, `public-${reactId}`)
      .then((svg) => {
        if (!cancelled) setSvgHtml(svg || LOAD_ERROR_SVG);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
          setSvgHtml(LOAD_ERROR_SVG);
        }
      });

    return () => { cancelled = true; };
  }, [block.source, reactId]);

  const title = block.title || block.caption || 'Diagram';

  return (
    <figure className="dossier-block dossier-block-diagram">
      {(block.title || block.caption) && (
        <figcaption className="dossier-block-label">
          {block.title && <strong>{block.title}</strong>}
          {block.caption && <span>{block.caption}</span>}
        </figcaption>
      )}
      <div className="dossier-diagram-frame">
        {svgHtml
          ? <div className="diagram-svg-host diagram-svg-host--inline" dangerouslySetInnerHTML={{ __html: svgHtml }} />
          : <p className="hint">Rendering diagram…</p>}
      </div>
      {loadError && (
        <p className="hint dossier-diagram-error">
          Mermaid failed to load (often a stale Vite cache). Stop the dev server, run{' '}
          <code>npm run dev -- --force</code>, then hard-refresh.
        </p>
      )}
      {svgHtml && !loadError && (
        <button type="button" className="button small ghost dossier-diagram-open" onClick={() => setExplorerOpen(true)}>
          Open diagram explorer
        </button>
      )}
      {explorerOpen && svgHtml && (
        <DiagramExplorerModal
          title={block.title || 'Diagram'}
          caption={block.caption}
          svgHtml={svgHtml}
          onClose={() => setExplorerOpen(false)}
        />
      )}
    </figure>
  );
}
