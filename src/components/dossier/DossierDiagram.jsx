import React, { useEffect, useId, useState } from 'react';
import { DiagramExplorerModal } from '../DiagramExplorerModal.jsx';

export function DossierDiagram({ block }) {
  const reactId = useId().replace(/:/g, '');
  const [svgHtml, setSvgHtml] = useState('');
  const [explorerOpen, setExplorerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('../../lib/mermaidDiagram.js').then(({ renderMermaidSvg }) => renderMermaidSvg(block.source, `public-${reactId}`)).then((svg) => {
      if (!cancelled) setSvgHtml(svg);
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
      {svgHtml && (
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
