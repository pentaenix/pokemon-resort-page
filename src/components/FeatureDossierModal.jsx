import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { routeHref } from '../lib/data.js';
import { collectDossierGalleryImages, normalizeFeatureDossier } from '../lib/featureDossier.js';
import { lockBodyScroll } from '../lib/scrollLock.js';
import { DossierBlockView } from './dossier/blockViews.jsx';
import { ImageGalleryModal } from './ImageGalleryModal.jsx';
import { InlineMarkdown } from '../lib/inlineMarkdown.jsx';
import { ProgressBar, StatusPill } from './StatusPill.jsx';

const DOSSIER_LAYER = 210;
const GALLERY_LAYER = 400;

export function FeatureDossierModal({ feature, bugs = [], onClose }) {
  const dossier = useMemo(() => normalizeFeatureDossier(feature), [feature]);
  const [gallery, setGallery] = useState(null);
  const galleryOpenRef = useRef(false);
  galleryOpenRef.current = Boolean(gallery);

  const tasksDone = (feature.tasks || []).filter((task) => task.done).length;
  const tasksTotal = (feature.tasks || []).length;

  useEffect(() => {
    const unlock = lockBodyScroll();
    return unlock;
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !galleryOpenRef.current) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const linkedBugRecords = (feature.linkedBugs || [])
    .map((id) => bugs.find((bug) => bug.id === id))
    .filter(Boolean);

  const allImages = collectDossierGalleryImages(dossier);
  const openGallery = (images, startIndex = 0) => setGallery({ images, index: startIndex });

  const dossierUi = (
    <div
      className="feature-dossier-backdrop"
      style={{ zIndex: DOSSIER_LAYER }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="feature-dossier-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Research dossier: ${feature.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="feature-dossier-sticky-top">
          <header className="feature-dossier-header">
            <div>
              <p className="eyebrow">{feature.area} · {feature.priority}</p>
              <h2>{feature.title}</h2>
              <p className="feature-dossier-summary">{feature.summary}</p>
            </div>
            <button type="button" className="feature-dossier-close" onClick={onClose} aria-label="Close dossier">×</button>
          </header>

          <div className="feature-dossier-meta">
            <StatusPill status={feature.stage} label={feature.stage} />
            <span className="feature-dossier-progress"><strong>{feature.progress}%</strong><ProgressBar value={feature.progress} /></span>
            {allImages.length > 0 && (
              <button
                type="button"
                className="button small ghost feature-dossier-all-photos"
                onClick={() => openGallery(allImages, 0)}
              >
                All photos ({allImages.length})
              </button>
            )}
          </div>
        </div>

        <div className="feature-dossier-body">
          {tasksTotal > 0 && (
            <section className="feature-dossier-section feature-dossier-tasks">
              <h3>Tasks <span className="feature-dossier-task-count">{tasksDone}/{tasksTotal} done</span></h3>
              <ul className="checklist">
                {feature.tasks.map((task) => (
                  <li key={task.label} className={task.done ? 'done' : ''}>{task.label}</li>
                ))}
              </ul>
            </section>
          )}

          {dossier.overview && (
            <section className="feature-dossier-section">
              <h3>Overview</h3>
              <p className="feature-dossier-overview"><InlineMarkdown>{dossier.overview}</InlineMarkdown></p>
            </section>
          )}

          {dossier.map && (
            <section className="feature-dossier-section feature-dossier-map">
              <h3>Map & location</h3>
              {dossier.map.label && <p><strong>{dossier.map.label}</strong></p>}
              {dossier.map.note && <p>{dossier.map.note}</p>}
              {dossier.map.position?.length >= 2 && (
                <p className="soft-label">Position: {dossier.map.position.join(', ')}</p>
              )}
              {dossier.map.pinId || dossier.map.poiId ? (
                <a className="button small" href={routeHref('/atlas', { pin: dossier.map.pinId || dossier.map.poiId })}>View on Island Atlas</a>
              ) : null}
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

          {!dossier.overview && !dossier.sections.length && !dossier.map && !dossier.researchMilestones.length && tasksTotal === 0 && (
            <p className="feature-dossier-empty">No research dossier content yet. Add sections, media, and notes from the Operations Desk.</p>
          )}

          {(linkedBugRecords.length > 0 || feature.linkedRoutes?.length > 0) && (
            <section className="feature-dossier-section feature-dossier-links">
              <h3>Linked work</h3>
              {linkedBugRecords.length > 0 && (
                <div className="linked-list">
                  <strong>Bugs</strong>
                  {linkedBugRecords.map((bug) => (
                    <a key={bug.id} href={routeHref('/board', { q: bug.id })}>{bug.id} — {bug.title}</a>
                  ))}
                </div>
              )}
              {feature.linkedRoutes?.length > 0 && (
                <div className="linked-list">
                  <strong>Routes</strong>
                  {feature.linkedRoutes.map((route) => (
                    <a key={route} href={routeHref('/ontology', { route })}>{route}</a>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(dossierUi, document.body)}
      {gallery && createPortal(
        <ImageGalleryModal
          title={feature.title}
          images={gallery.images}
          startIndex={gallery.index}
          onClose={() => setGallery(null)}
          zIndex={GALLERY_LAYER}
        />,
        document.body,
      )}
    </>
  );
}
