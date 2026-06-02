import React, { useMemo, useState } from 'react';
import { collectRichContentImages, normalizeRichContent } from '../lib/richContent.js';
import { InlineMarkdown } from '../lib/inlineMarkdown.jsx';
import { DossierBlockView } from './dossier/blockViews.jsx';
import { ImageGalleryModal } from './ImageGalleryModal.jsx';

export function RichContentBody({ record, title = 'Details', showMapLink = false }) {
  const dossier = useMemo(() => normalizeRichContent(record), [record]);
  const [gallery, setGallery] = useState(null);
  const allImages = useMemo(() => collectRichContentImages(dossier), [dossier]);
  const openGallery = (images, startIndex = 0) => setGallery({ images, index: startIndex });

  return (
    <>
      {allImages.length > 0 && (
        <div className="rich-content-toolbar">
          <button
            type="button"
            className="button small ghost"
            onClick={() => openGallery(allImages, 0)}
          >
            All photos ({allImages.length})
          </button>
        </div>
      )}

      {dossier.overview && (
        <section className="feature-dossier-section">
          <h3>Overview</h3>
          <p className="feature-dossier-overview"><InlineMarkdown>{dossier.overview}</InlineMarkdown></p>
        </section>
      )}

      {dossier.map && showMapLink && (
        <section className="feature-dossier-section feature-dossier-map">
          <h3>Map & location</h3>
          {dossier.map.label && <p><strong>{dossier.map.label}</strong></p>}
          {dossier.map.note && <p>{dossier.map.note}</p>}
          {dossier.map.position?.length >= 2 && (
            <p className="soft-label">Position: {dossier.map.position.join(', ')}</p>
          )}
        </section>
      )}

      {dossier.researchMilestones.length > 0 && (
        <section className="feature-dossier-section">
          <h3>Research milestones</h3>
          <ul className="checklist compact-list">
            {dossier.researchMilestones.map((item) => (
              <li key={item.label} className={item.done ? 'done' : ''}>{item.label}</li>
            ))}
          </ul>
        </section>
      )}

      {dossier.sections.map((section, sectionIndex) => (
        <section key={`${section.id}-${sectionIndex}`} className="feature-dossier-section">
          <h3>{section.title}</h3>
          {section.summary && (
            <p className="feature-dossier-section-summary"><InlineMarkdown>{section.summary}</InlineMarkdown></p>
          )}
          <div className="feature-dossier-blocks">
            {section.blocks.map((block, index) => (
              <DossierBlockView
                key={`${section.id}-${index}`}
                block={block}
                onOpenGallery={openGallery}
              />
            ))}
          </div>
        </section>
      ))}

      {!dossier.overview && !dossier.sections.length && !dossier.map && !dossier.researchMilestones.length && (
        <p className="feature-dossier-empty">No extended content yet.</p>
      )}

      {gallery && (
        <ImageGalleryModal
          title={title}
          images={gallery.images}
          startIndex={gallery.index}
          onClose={() => setGallery(null)}
          zIndex={420}
        />
      )}
    </>
  );
}
