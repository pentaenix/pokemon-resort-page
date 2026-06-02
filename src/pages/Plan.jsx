import React, { useMemo, useState } from 'react';
import { PageTitle } from '../components/Layout.jsx';
import { PlanMilestoneEras } from '../components/PlanMilestoneEras.jsx';
import { RichContentModal } from '../components/RichContentModal.jsx';
import { StatusPill } from '../components/StatusPill.jsx';
import { assetUrl } from '../lib/data.js';
import { recordHasRichContent } from '../lib/richContent.js';

function PlanCard({ item, kind, onOpen }) {
  const hasRich = recordHasRichContent(item);
  return (
    <article className={`plan-card plan-card--${kind}`}>
      <button type="button" className="plan-card-main" onClick={() => onOpen(item)}>
        <div className="plan-card-top">
          <StatusPill status={item.status} label={item.status} />
          {hasRich && <span className="plan-card-rich" title="Extended details">◇</span>}
        </div>
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
        {item.tags?.length > 0 && (
          <div className="pill-row">
            {item.tags.map((tag) => <span key={tag} className="soft-label">{tag}</span>)}
          </div>
        )}
        {item.image && (
          <img className="plan-card-thumb" src={assetUrl(item.image)} alt="" loading="lazy" />
        )}
      </button>
    </article>
  );
}

export default function Plan({ data }) {
  const ideas = data.ideas?.items || [];
  const milestones = data.roadmap?.milestones || [];
  const currentId = data.roadmap?.currentMilestoneId;
  const [modal, setModal] = useState(null);

  const current = useMemo(
    () => milestones.find((m) => m.id === currentId) || milestones.find((m) => m.status === 'current'),
    [milestones, currentId],
  );
  const excludeFromGroups = useMemo(
    () => new Set(current ? [current.id] : []),
    [current],
  );

  return (
    <main className="plan-page">
      <PageTitle
        eyebrow="Ideas & milestones"
        title="Where sparks become the path forward."
      >
        Ideas stay visible early; milestones track the resort’s build story. Open any card for the full brief.
      </PageTitle>

      <section className="plan-section" id="plan-ideas">
        <div className="plan-section-head">
          <h2>Ideas</h2>
          <p className="hint">Sparks and promising concepts — not yet committed to the board.</p>
        </div>
        <div className="plan-grid">
          {ideas.map((idea) => (
            <PlanCard key={idea.id} item={idea} kind="idea" onOpen={(item) => setModal({ kind: 'idea', item })} />
          ))}
        </div>
      </section>

      {current && (
        <section className="current-milestone-card plan-current">
          <p className="eyebrow">Current milestone</p>
          <h2>{current.title}</h2>
          <p>{current.summary}</p>
          <button type="button" className="button small" onClick={() => setModal({ kind: 'milestone', item: current })}>
            Open milestone brief
          </button>
        </section>
      )}

      <section className="plan-section" id="plan-milestones">
        <div className="plan-section-head">
          <h2>Milestones</h2>
          <p className="hint">Grouped by past, now, and ahead — collapse long lists when you only need the current focus.</p>
        </div>
        <PlanMilestoneEras
          milestones={milestones}
          currentId={currentId}
          excludeIds={excludeFromGroups}
          onOpen={(item) => setModal({ kind: 'milestone', item })}
        />
      </section>

      {modal && (
        <RichContentModal
          record={modal.item}
          title={modal.item.title}
          summary={modal.item.summary}
          eyebrow={modal.kind === 'idea' ? 'Idea' : 'Milestone'}
          status={modal.item.status}
          onClose={() => setModal(null)}
        />
      )}
    </main>
  );
}
