import React from 'react';
import { isValidPublicHref } from '../../lib/linkUtils.js';
import { assetUrl } from '../../lib/data.js';
import { InlineMarkdown } from '../../lib/inlineMarkdown.jsx';
import { DossierCarousel } from './DossierCarousel.jsx';
import { DossierDiagram } from './DossierDiagram.jsx';
import { DossierImage } from './DossierImage.jsx';
import { DossierTabs } from './DossierTabs.jsx';

const CODE_REPOS = {
  'pokemon-resort': 'Pokémon Resort (game)',
  'pokemon-resort-page': 'Resort site & admin',
  spmk: 'SPMK tooling',
  'island-dreamforge': 'Island Dreamforge',
  'pokemon-ds-map-studio': 'Pokémon DS Map Studio',
};

function codeLocationLabel(block) {
  const loc = `${block.repo}/${block.path}`;
  return block.lines ? `${loc}:${block.lines}` : loc;
}

/** Map block type → React component. Add custom blocks here after registerDossierBlock(). */
export const dossierBlockViews = {
  text({ block }) {
    return (
      <div className="dossier-block dossier-block-text">
        <p><InlineMarkdown>{block.body}</InlineMarkdown></p>
      </div>
    );
  },

  image({ block, onOpenGallery }) {
    return (
      <figure className="dossier-block dossier-block-image dossier-block--media">
        <button type="button" className="dossier-media-open" onClick={() => onOpenGallery([{ path: block.path, caption: block.caption }], 0)}>
          <DossierImage path={block.path} alt={block.caption || ''} />
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
                <DossierImage path={item.path} alt={item.label || item.caption || ''} />
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
              <DossierImage path={img.path} alt={img.caption || ''} />
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
            <li key={`${item.label}-${item.href}`}>
              {isValidPublicHref(item.href) ? (
                <a href={item.href} target="_blank" rel="noreferrer noopener">{item.label}</a>
              ) : (
                <span className="dossier-link-invalid">{item.label} <em>(invalid URL)</em></span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  },

  figure({ block, onOpenGallery }) {
    const layoutClass = block.layout === 'side' ? ' dossier-block-figure--side' : '';
    return (
      <figure className={`dossier-block dossier-block-figure dossier-block--media${layoutClass}`}>
        <div className="dossier-figure-body">
          {block.body && <p className="dossier-figure-text"><InlineMarkdown>{block.body}</InlineMarkdown></p>}
          <button
            type="button"
            className="dossier-media-open dossier-figure-media"
            onClick={() => onOpenGallery([{ path: block.path, caption: block.caption || block.body }], 0)}
          >
            <DossierImage path={block.path} alt={block.caption || block.body || ''} />
          </button>
        </div>
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    );
  },

  html({ block }) {
    return (
      <div
        className="dossier-block dossier-block-html"
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    );
  },

  diagram({ block }) {
    return <DossierDiagram block={block} />;
  },

  code({ block }) {
    const langClass = block.language ? ` language-${block.language}` : '';
    return (
      <figure className="dossier-block dossier-block-code">
        <figcaption className="dossier-code-header">
          <code className="dossier-code-location">{codeLocationLabel(block)}</code>
          {block.language && <span className="soft-label dossier-code-lang">{block.language}</span>}
          {CODE_REPOS[block.repo] && (
            <span className="soft-label dossier-code-repo">{CODE_REPOS[block.repo]}</span>
          )}
        </figcaption>
        <pre className={`dossier-code-body${langClass}`}><code>{block.body}</code></pre>
        {block.caption && <p className="dossier-code-caption">{block.caption}</p>}
      </figure>
    );
  },

  tabs({ block, onOpenGallery }) {
    return <DossierTabs block={block} onOpenGallery={onOpenGallery} variant={block.variant} />;
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
