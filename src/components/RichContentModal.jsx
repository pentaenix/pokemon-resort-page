import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '../lib/scrollLock.js';
import { recordHasRichContent } from '../lib/richContent.js';
import { RichContentBody } from './RichContentBody.jsx';
import { StatusPill } from './StatusPill.jsx';

const MODAL_LAYER = 210;

export function RichContentModal({
  record,
  title,
  summary,
  eyebrow,
  status,
  statusLabel,
  onClose,
  children,
  showMapLink = false,
}) {
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

  const hasRich = recordHasRichContent(record);

  const ui = (
    <div
      className="feature-dossier-backdrop"
      style={{ zIndex: MODAL_LAYER }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="feature-dossier-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="feature-dossier-sticky-top">
          <header className="feature-dossier-header">
            <div>
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              <h2>{title}</h2>
              {summary && <p className="feature-dossier-summary">{summary}</p>}
            </div>
            <button type="button" className="feature-dossier-close" onClick={onClose} aria-label="Close">×</button>
          </header>
          {(status || statusLabel) && (
            <div className="feature-dossier-meta">
              {status && <StatusPill status={status} label={statusLabel || status} />}
            </div>
          )}
        </div>

        <div className="feature-dossier-body">
          {children}
          {hasRich && <RichContentBody record={record} title={title} showMapLink={showMapLink} />}
          {!hasRich && !children && (
            <p className="feature-dossier-empty">No details published yet.</p>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}
