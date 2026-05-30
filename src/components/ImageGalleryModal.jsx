import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { assetUrl } from '../lib/data.js';
import { lockBodyScroll } from '../lib/scrollLock.js';

export function ImageGalleryModal({ title, images, startIndex = 0, onClose, elevated = false, zIndex }) {
  const layer = zIndex ?? (elevated ? 400 : 200);
  const [index, setIndex] = useState(startIndex);
  const total = images.length;
  const current = images[index];

  const go = useCallback((delta) => {
    setIndex((prev) => (prev + delta + total) % total);
  }, [total]);

  useEffect(() => {
    setIndex(startIndex);
  }, [startIndex, images]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', onKeyDown);
    const unlockScroll = lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unlockScroll();
    };
  }, [onClose, go]);

  if (!current || !total) return null;

  return createPortal(
    <div
      className={`image-gallery-backdrop${elevated ? ' image-gallery-backdrop--elevated' : ''}`}
      style={{ zIndex: layer }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="image-gallery-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title ? `Images for ${title}` : 'Image gallery'}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="image-gallery-close" onClick={onClose} aria-label="Close gallery">×</button>
        {total > 1 && (
          <>
            <button type="button" className="image-gallery-nav image-gallery-prev" onClick={() => go(-1)} aria-label="Previous image">‹</button>
            <button type="button" className="image-gallery-nav image-gallery-next" onClick={() => go(1)} aria-label="Next image">›</button>
          </>
        )}
        <figure className="image-gallery-figure">
          <img src={assetUrl(current.path)} alt={current.caption || title || 'Evidence image'} />
          <figcaption>
            <div className="image-gallery-caption-row">
              <strong>{title}</strong>
              {total > 1 && <span className="image-gallery-counter">{index + 1} / {total}</span>}
            </div>
            {current.caption && <p>{current.caption}</p>}
          </figcaption>
        </figure>
        {total > 1 && (
          <div className="image-gallery-dots" role="tablist" aria-label="Image thumbnails">
            {images.map((img, dotIndex) => (
              <button
                key={`${img.path}-${dotIndex}`}
                type="button"
                role="tab"
                aria-selected={dotIndex === index}
                aria-label={`Image ${dotIndex + 1}${img.caption ? `: ${img.caption}` : ''}`}
                className={dotIndex === index ? 'active' : ''}
                onClick={() => setIndex(dotIndex)}
              >
                <img src={assetUrl(img.path)} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
