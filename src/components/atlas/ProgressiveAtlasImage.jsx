import React from 'react';
import { useProgressiveImage } from '../../lib/atlasImageLoader.js';

export function ProgressiveAtlasImage({
  path,
  alt = '',
  className = '',
  imgClassName = '',
}) {
  const { status, src, isPreview } = useProgressiveImage(path);
  const loading = status === 'loading' && !src;
  const upgrading = status === 'loading' && src;

  return (
    <div
      className={`progressive-atlas-image${loading ? ' is-loading' : ''}${className ? ` ${className}` : ''}`}
      aria-busy={status === 'loading'}
    >
      {loading ? (
        <span className="loader progressive-atlas-image-spinner" aria-label="Loading image" />
      ) : null}
      {src ? (
        <img
          src={src}
          alt={alt}
          className={`${imgClassName}${isPreview ? ' is-preview' : ''}${upgrading ? ' is-upgrading' : ''}`.trim()}
          decoding="async"
        />
      ) : null}
      {upgrading ? (
        <span className="progressive-atlas-image-upgrade" aria-hidden="true">
          <span className="loader progressive-atlas-image-spinner progressive-atlas-image-spinner--small" />
        </span>
      ) : null}
      {status === 'error' ? (
        <span className="progressive-atlas-image-error">Image unavailable</span>
      ) : null}
    </div>
  );
}
