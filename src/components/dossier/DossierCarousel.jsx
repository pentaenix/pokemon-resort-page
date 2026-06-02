import React, { useState } from 'react';
import { DossierImage } from './DossierImage.jsx';

export function DossierCarousel({ images, caption, onOpenGallery }) {
  const [index, setIndex] = useState(0);
  const total = images.length;
  const current = images[index];

  const go = (delta) => setIndex((prev) => (prev + delta + total) % total);

  return (
    <figure className="dossier-block dossier-block-carousel dossier-block--media">
      {caption && <figcaption className="dossier-block-label">{caption}</figcaption>}
      <div className="dossier-carousel">
        <button type="button" className="dossier-carousel-nav" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous slide">‹</button>
        <button
          type="button"
          className="dossier-carousel-slide"
          onClick={() => onOpenGallery(images, index)}
          aria-label={`View slide ${index + 1} full size`}
        >
          <DossierImage path={current.path} alt={current.caption || ''} />
          {current.caption && <span className="dossier-carousel-caption">{current.caption}</span>}
        </button>
        <button type="button" className="dossier-carousel-nav" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next slide">›</button>
      </div>
      <div className="dossier-carousel-dots" role="tablist" aria-label="Carousel slides">
        {images.map((img, dotIndex) => (
          <button
            key={`${img.path}-${dotIndex}`}
            type="button"
            role="tab"
            aria-selected={dotIndex === index}
            className={dotIndex === index ? 'active' : ''}
            onClick={() => setIndex(dotIndex)}
            aria-label={`Slide ${dotIndex + 1}`}
          />
        ))}
      </div>
      <p className="dossier-carousel-counter">{index + 1} / {total}</p>
    </figure>
  );
}
