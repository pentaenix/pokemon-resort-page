import React, { useEffect, useMemo, useState } from 'react';
import { assetUrl } from '../lib/data.js';
import { normalizeImages } from '../lib/images.js';
import { ImageGalleryModal } from './ImageGalleryModal.jsx';

function PhotosFallbackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="6" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="11" r="1.25" fill="currentColor" />
      <path d="M6.5 17.5 10 13.5l2.5 2 3.5-4 3.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EvidencePhotosButton({ images, title, className = '' }) {
  const normalized = useMemo(() => normalizeImages(images), [images]);
  const [open, setOpen] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const [thumbError, setThumbError] = useState(false);
  const preview = normalized[0];

  useEffect(() => {
    setThumbError(false);
  }, [preview?.path]);

  if (!normalized.length) return null;

  const openGallery = (event, index = 0) => {
    event.preventDefault();
    event.stopPropagation();
    setStartIndex(index);
    setOpen(true);
  };

  const count = normalized.length;
  const countLabel = count === 1 ? '1 photo' : `${count} photos`;
  const showThumb = preview?.path && !thumbError;

  return (
    <>
      <button
        type="button"
        className={`evidence-photos-btn ${className}`.trim()}
        onClick={(event) => openGallery(event, 0)}
        aria-label={`View ${countLabel} for ${title}`}
        title={`View ${countLabel}`}
      >
        <span className="evidence-photos-deck" aria-hidden="true">
          {count > 1 && <span className="evidence-photos-deck-shadow" />}
          <span className="evidence-photos-thumb">
            {showThumb ? (
              <img
                src={assetUrl(preview.path)}
                alt=""
                loading="lazy"
                onError={() => setThumbError(true)}
              />
            ) : (
              <span className="evidence-photos-thumb-fallback"><PhotosFallbackIcon /></span>
            )}
            <span className="evidence-photos-lens">
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M6.2 10.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z" stroke="currentColor" strokeWidth="1.3" />
                <path d="M9.4 9.4 13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </span>
          </span>
        </span>
        <span className="evidence-photos-count">{count}</span>
      </button>
      {open && (
        <ImageGalleryModal
          title={title}
          images={normalized}
          startIndex={startIndex}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
