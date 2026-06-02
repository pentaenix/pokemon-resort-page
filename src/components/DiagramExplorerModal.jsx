import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '../lib/scrollLock.js';
import { DiagramPanZoom } from './DiagramPanZoom.jsx';

export function DiagramExplorerModal({ title, caption, svgHtml, onClose }) {
  useEffect(() => {
    const unlock = lockBodyScroll();
    return unlock;
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="diagram-explorer-backdrop" onClick={onClose} role="presentation">
      <div
        className="diagram-explorer-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Diagram explorer'}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="diagram-explorer-head">
          <div>
            {title && <h2>{title}</h2>}
            {caption && <p>{caption}</p>}
          </div>
          <button type="button" className="diagram-explorer-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <DiagramPanZoom className="diagram-explorer-stage">
          <div className="diagram-svg-host" dangerouslySetInnerHTML={{ __html: svgHtml }} />
        </DiagramPanZoom>
      </div>
    </div>,
    document.body,
  );
}
