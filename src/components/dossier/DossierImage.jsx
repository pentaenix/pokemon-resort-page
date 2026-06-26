import React, { useState } from 'react';
import { useProgressiveImage } from '../../lib/atlasImageLoader.js';

export function DossierImage({ path, alt = '', className = '', fit, pixelScale = 1 }) {
  const [failed, setFailed] = useState(false);
  const [naturalSize, setNaturalSize] = useState(null);
  const { status, src, isPreview } = useProgressiveImage(path);
  const scale = fit === 'pixel' && Number(pixelScale) > 1 ? Number(pixelScale) : 1;
  const scaledStyle = naturalSize && scale > 1
    ? { width: naturalSize.w * scale, height: naturalSize.h * scale }
    : undefined;

  if (!path || failed) {
    return (
      <div className={`dossier-image-fallback${className ? ` ${className}` : ''}`} role="img" aria-label={alt || 'Image unavailable'}>
        <span>Image unavailable</span>
        {path && <small>{path}</small>}
      </div>
    );
  }

  const fitClass = fit === 'pixel'
    ? ' dossier-image--pixel'
    : fit === 'contain'
      ? ' dossier-image--contain'
      : '';

  if (status === 'loading' && !src) {
    return (
      <div className={`dossier-image-loading${className ? ` ${className}` : ''}`} aria-busy="true" aria-label="Loading image">
        <span className="loader dossier-image-spinner" />
      </div>
    );
  }

  if (status === 'error' && !src) {
    return (
      <div className={`dossier-image-fallback${className ? ` ${className}` : ''}`} role="img" aria-label={alt || 'Image unavailable'}>
        <span>Image unavailable</span>
        <small>{path}</small>
      </div>
    );
  }

  return (
    <div className={`dossier-image-wrap${status === 'loading' ? ' is-upgrading' : ''}${className ? ` ${className}` : ''}`}>
      <img
        src={src}
        alt={alt}
        className={`dossier-image${fitClass}${isPreview ? ' is-preview' : ''}`.trim()}
        style={scaledStyle}
        decoding="async"
        onLoad={(event) => {
          const img = event.currentTarget;
          setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        }}
        onError={() => setFailed(true)}
      />
      {status === 'loading' ? (
        <span className="dossier-image-upgrade" aria-hidden="true">
          <span className="loader dossier-image-spinner dossier-image-spinner--small" />
        </span>
      ) : null}
    </div>
  );
}
