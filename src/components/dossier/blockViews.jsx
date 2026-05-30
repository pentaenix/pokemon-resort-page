import React from 'react';
import { assetUrl } from '../../lib/data.js';
import { DossierCarousel } from './DossierCarousel.jsx';

/** Map block type → React component. Add custom blocks here after registerDossierBlock(). */
export const dossierBlockViews = {
  text({ block }) {
    return <div className="dossier-block dossier-block-text"><p>{block.body}</p></div>;
  },

  image({ block, onOpenGallery }) {
    return (
      <figure className="dossier-block dossier-block-image dossier-block--media">
        <button type="button" className="dossier-media-open" onClick={() => onOpenGallery([{ path: block.path, caption: block.caption }], 0)}>
          <img src={assetUrl(block.path)} alt={block.caption || ''} loading="lazy" />
        </button>
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    );
  },

  video({ block }) {
    return (
      <figure className="dossier-block dossier-block-video dossier-block--media">
        <video controls preload="metadata" poster={block.poster ? assetUrl(block.poster) : undefined}>
          <source src={assetUrl(block.path)} />
        </video>
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    );
  },

  compare({ block, onOpenGallery }) {
    const fixed = block.variant === 'fixed';
    const cols = Math.max(2, block.items.length);
    const galleryItems = block.items.map((entry) => ({ path: entry.path, caption: entry.caption || entry.label }));
    return (
      <figure className={`dossier-block dossier-block-compare dossier-block--media${fixed ? ' dossier-block-compare--fixed' : ''}`}>
        {block.caption && <figcaption className="dossier-block-label">{block.caption}</figcaption>}
        <div
          className={`dossier-compare-grid${fixed ? ' dossier-compare-grid--fixed' : ''}`}
          style={{ '--compare-cols': cols }}
        >
          {block.items.map((item, index) => (
            <button
              key={`${item.path}-${index}`}
              type="button"
              className="dossier-compare-item"
              onClick={() => onOpenGallery(galleryItems, index)}
            >
              <span className="dossier-compare-frame">
                <img src={assetUrl(item.path)} alt={item.label || item.caption || ''} loading="lazy" />
              </span>
              {item.label && <span className="dossier-compare-label">{item.label}</span>}
            </button>
          ))}
        </div>
      </figure>
    );
  },

  carousel({ block, onOpenGallery }) {
    return (
      <DossierCarousel
        images={block.images}
        caption={block.caption}
        onOpenGallery={onOpenGallery}
      />
    );
  },

  gallery({ block, onOpenGallery }) {
    return (
      <figure className="dossier-block dossier-block-gallery dossier-block--media">
        {block.caption && <figcaption className="dossier-block-label">{block.caption}</figcaption>}
        <div className="dossier-gallery-grid">
          {block.images.map((img, index) => (
            <button
              key={`${img.path}-${index}`}
              type="button"
              className="dossier-gallery-thumb"
              onClick={() => onOpenGallery(block.images, index)}
            >
              <img src={assetUrl(img.path)} alt={img.caption || ''} loading="lazy" />
            </button>
          ))}
        </div>
      </figure>
    );
  },

  links({ block }) {
    return (
      <div className="dossier-block dossier-block-links">
        <ul>
          {block.items.map((item) => (
            <li key={item.href}>
              <a href={item.href} target="_blank" rel="noreferrer">{item.label}</a>
            </li>
          ))}
        </ul>
      </div>
    );
  },
};

export function DossierBlockView({ block, onOpenGallery }) {
  const View = dossierBlockViews[block.type];
  if (!View) {
    return (
      <div className="dossier-block dossier-block-unknown">
        <p>Unknown block type: <code>{block.type}</code></p>
      </div>
    );
  }
  return <View block={block} onOpenGallery={onOpenGallery} />;
}
