import React, { useState } from 'react';
import { assetUrl } from '../../lib/data.js';

export function DossierImage({ path, alt = '', className = '', fit, pixelScale = 1 }) {
  const [failed, setFailed] = useState(false);
  const [naturalSize, setNaturalSize] = useState(null);
  const src = path ? assetUrl(path) : '';
  const scale = fit === 'pixel' && Number(pixelScale) > 1 ? Number(pixelScale) : 1;
  const scaledStyle = naturalSize && scale > 1
    ? { width: naturalSize.w * scale, height: naturalSize.h * scale }
    : undefined;

  if (!src || failed) {
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

  return (
    <img
      src={src}
      alt={alt}
      className={`${className}${fitClass}`.trim()}
      style={scaledStyle}
      loading="lazy"
      onLoad={(event) => {
        const img = event.currentTarget;
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      }}
      onError={() => setFailed(true)}
    />
  );
}
