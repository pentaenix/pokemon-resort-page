import React, { useMemo, useState } from 'react';
import { PageTitle } from '../components/Layout.jsx';
import { PlanMilestoneEras } from '../components/PlanMilestoneEras.jsx';
import { RichContentModal } from '../components/RichContentModal.jsx';
import { routeHref } from '../lib/data.js';

export default function Milestones({ data }) {
  const roadmap = data.roadmap || {};
  const milestones = roadmap.milestones || [];
  const currentId = roadmap.currentMilestoneId;
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
    <main className="plan-page milestones-page">
      <PageTitle
        eyebrow="Build timeline"
        title="Milestones on the resort build"
      >
        Named steps from the first idea to a public demo. Grouped into now, past, and ahead. Open a row for a longer brief.
      </PageTitle>

      <p className="docs-intro-actions">
        <a className="button small ghost" href={routeHref('/milestones')}>← Ideas and milestones</a>
        <a className="button small ghost" href={routeHref('/ideas')}>Spark board</a>
      </p>

      {current && (
        <section className="current-milestone-card plan-current">
          <p className="eyebrow">Current build step</p>
          <h2>{current.title}</h2>
          <p>{current.summary}</p>
          <button type="button" className="button small" onClick={() => setModal({ item: current })}>
            Open milestone brief
          </button>
        </section>
      )}

      <section className="plan-section" id="build-milestones">
        <div className="plan-section-head">
          <h2>All milestones</h2>
          <p className="hint">Past steps stay collapsed by default. Present shows the current step and the next one up.</p>
        </div>
        <PlanMilestoneEras
          milestones={milestones}
          currentId={currentId}
          excludeIds={excludeFromGroups}
          onOpen={(item) => setModal({ item })}
        />
      </section>

      {modal && (
        <RichContentModal
          record={modal.item}
          title={modal.item.title}
          summary={modal.item.summary}
          eyebrow="Milestone"
          status={modal.item.status}
          onClose={() => setModal(null)}
        />
      )}
    </main>
  );
}
