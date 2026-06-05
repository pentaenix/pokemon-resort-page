import React from 'react';
import { assetUrl } from '../../lib/data.js';

export function AtlasFramePreview({ image, label, caption, onOpen, openLabel = 'Open full frame' }) {
  if (!image?.path) return null;

  return (
    <div className="atlas-show-reference-preview">
      {label ? <p className="atlas-show-reference-preview-label">{label}</p> : null}
      <button
        type="button"
        className="atlas-show-reference-preview-open"
        onClick={onOpen}
        aria-label={openLabel}
      >
        <span className="atlas-show-reference-preview-frame">
          <img
            src={assetUrl(image.path)}
            alt={caption || label || 'Atlas frame'}
            loading="lazy"
            decoding="async"
          />
          {onOpen ? (
            <span className="atlas-show-reference-preview-lens" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M6.2 10.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z" stroke="currentColor" strokeWidth="1.3" />
                <path d="M9.4 9.4 13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <span>{openLabel}</span>
            </span>
          ) : null}
        </span>
      </button>
      {caption ? (
        <p className="atlas-show-reference-preview-caption">{caption}</p>
      ) : null}
    </div>
  );
}
