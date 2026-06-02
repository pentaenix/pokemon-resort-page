import React from 'react';
import { assetUrl } from '../../lib/data.js';

export function ShowReferencePreview({ showReference, onOpen }) {
  if (!showReference?.path) return null;

  return (
    <div className="atlas-show-reference-preview">
      <p className="atlas-show-reference-preview-label">{showReference.label}</p>
      <button
        type="button"
        className="atlas-show-reference-preview-open"
        onClick={onOpen}
        aria-label={`Open full ${showReference.label}`}
      >
        <span className="atlas-show-reference-preview-frame">
          <img
            src={assetUrl(showReference.path)}
            alt="Pokémon Concierge island map from the show"
            loading="lazy"
            decoding="async"
          />
          <span className="atlas-show-reference-preview-lens" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M6.2 10.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z" stroke="currentColor" strokeWidth="1.3" />
              <path d="M9.4 9.4 13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span>Open full frame</span>
          </span>
        </span>
      </button>
      {showReference.caption ? (
        <p className="atlas-show-reference-preview-caption">{showReference.caption}</p>
      ) : null}
    </div>
  );
}
