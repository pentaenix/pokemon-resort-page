import React, { useState } from 'react';
import { assetUrl } from '../../lib/data.js';

export function DossierImage({ path, alt = '', className = '' }) {
  const [failed, setFailed] = useState(false);
  const src = path ? assetUrl(path) : '';

  if (!src || failed) {
    return (
      <div className={`dossier-image-fallback${className ? ` ${className}` : ''}`} role="img" aria-label={alt || 'Image unavailable'}>
        <span>Image unavailable</span>
        {path && <small>{path}</small>}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
