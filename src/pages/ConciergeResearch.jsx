import React, { useMemo, useState } from 'react';
import { PageTitle } from '../components/Layout.jsx';
import { RichContentModal } from '../components/RichContentModal.jsx';
import { StatusPill } from '../components/StatusPill.jsx';
import { assetUrl, routeHref } from '../lib/data.js';
import { recordHasRichContent } from '../lib/richContent.js';

function ResearchCard({ entry, onOpen }) {
  const hasRich = recordHasRichContent(entry);
  const thumb = entry.evidence?.[0]?.image;
  return (
    <article className="research-card">
      <button type="button" className="research-card-main" onClick={() => onOpen(entry)}>
        {thumb && (
          <div className="research-card-media">
            <img src={assetUrl(thumb)} alt="" loading="lazy" />
          </div>
        )}
        <div className="research-card-body">
          <div className="research-card-top">
            <StatusPill status={entry.confidence} label={entry.confidence} />
            <span className="soft-label">{entry.category}</span>
            {hasRich && <span className="plan-card-rich" title="Research brief">◇</span>}
          </div>
          <h3>{entry.title}</h3>
          {entry.subject && <p className="research-card-subject">{entry.subject}</p>}
          <p>{entry.summary}</p>
          {entry.tags?.length > 0 && (
            <div className="pill-row">
              {entry.tags.map((tag) => (
                <span key={tag} className="soft-label">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </button>
    </article>
  );
}

export default function ConciergeResearch({ data }) {
  const entries = data.research?.entries || [];
  const categories = data.research?.categories || [];
  const legend = data.research?.confidenceLegend || [];
  const [category, setCategory] = useState('all');
  const [confidence, setConfidence] = useState('all');
  const [modalEntry, setModalEntry] = useState(null);

  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      if (category !== 'all' && entry.category !== category) return false;
      if (confidence !== 'all' && entry.confidence !== confidence) return false;
      return true;
    });
  }, [entries, category, confidence]);

  return (
    <main className="concierge-research-page">
      <PageTitle
        eyebrow="Concierge Research"
        title="Everything we learn about the series — not just map pins."
      >
        Characters, Pokémon, locations, mechanics, and lore notes curated for the resort project. Cork pins on the Island Atlas mark where each topic lives on the 2D map.
      </PageTitle>

      <div className="concierge-research-actions">
        <a className="button small ghost" href={routeHref('/atlas')}>Open Island Atlas (2D cork map)</a>
      </div>

      {categories.length > 0 && (
        <div className="concierge-filter-bar" role="tablist" aria-label="Filter by category">
          <button
            type="button"
            className={`chip ${category === 'all' ? 'active' : ''}`}
            onClick={() => setCategory('all')}
          >
            All topics ({entries.length})
          </button>
          {categories.map((cat) => {
            const count = entries.filter((e) => e.category === cat).length;
            if (!count) return null;
            return (
              <button
                key={cat}
                type="button"
                className={`chip ${category === cat ? 'active' : ''}`}
                onClick={() => setCategory(cat)}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {legend.length > 0 && (
        <div className="concierge-filter-bar concierge-confidence-bar" role="tablist" aria-label="Filter by confidence">
          <button
            type="button"
            className={`chip ${confidence === 'all' ? 'active' : ''}`}
            onClick={() => setConfidence('all')}
          >
            Any confidence
          </button>
          {legend.map((level) => (
            <button
              key={level}
              type="button"
              className={`chip ${confidence === level ? 'active' : ''}`}
              onClick={() => setConfidence(level)}
            >
              {level}
            </button>
          ))}
        </div>
      )}

      <div className="research-grid">
        {filtered.length ? filtered.map((entry) => (
          <ResearchCard key={entry.id} entry={entry} onOpen={setModalEntry} />
        )) : (
          <p className="hint">No research entries match these filters.</p>
        )}
      </div>

      {modalEntry && (
        <RichContentModal
          record={modalEntry}
          title={modalEntry.title}
          summary={modalEntry.summary}
          eyebrow={`${modalEntry.category}${modalEntry.subject ? ` · ${modalEntry.subject}` : ''}`}
          status={modalEntry.devStatus}
          statusLabel={modalEntry.devStatus}
          onClose={() => setModalEntry(null)}
        >
          <section className="feature-dossier-section">
            <h3>Canon & status</h3>
            <p>{modalEntry.canonStatus}</p>
            {(modalEntry.linkedPins?.length > 0 || modalEntry.linkedPois?.length > 0) && (
              <>
                <p className="soft-label">Atlas cork pins</p>
                <ul className="compact-list">
                  {(modalEntry.linkedPins || modalEntry.linkedPois).map((id) => (
                    <li key={id}>
                      <a href={routeHref('/atlas', { pin: id })}>{id}</a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {modalEntry.evidence?.length > 0 && (
              <>
                <p className="soft-label">Evidence</p>
                <div className="evidence-grid compact">
                  {modalEntry.evidence.map((item) => (
                    <figure key={item.label}>
                      <img src={assetUrl(item.image)} alt={item.label} />
                      <figcaption><strong>{item.label}</strong>{item.note}</figcaption>
                    </figure>
                  ))}
                </div>
              </>
            )}
          </section>
        </RichContentModal>
      )}
    </main>
  );
}
