import React, { useMemo } from 'react';
import { PageTitle } from '../components/Layout.jsx';
import { routeHref } from '../lib/data.js';

export default function Plan({ data }) {
  const ideas = data.ideas?.items || [];
  const milestones = data.roadmap?.milestones || [];
  const currentId = data.roadmap?.currentMilestoneId;

  const current = useMemo(
    () => milestones.find((m) => m.id === currentId) || milestones.find((m) => m.status === 'current'),
    [milestones, currentId],
  );

  return (
    <main className="plan-page plan-hub-page">
      <PageTitle
        eyebrow="Resort planning"
        title="Ideas and milestones"
      >
        Two boards on the desk: sparks we have not committed yet, and build steps we have already named.
      </PageTitle>

      <div className="plan-hub-grid nav-card-grid">
        <a className="nav-card plan-hub-card" href={routeHref('/ideas')}>
          <span className="nav-card-icon" aria-hidden="true">◇</span>
          <strong>Spark board</strong>
          <p>
            {ideas.length} idea{ideas.length === 1 ? '' : 's'} with optional dossiers. Not on the operations board yet.
          </p>
          <span className="plan-hub-cta soft-label">Open spark board →</span>
        </a>
        <a className="nav-card plan-hub-card" href={routeHref('/build')}>
          <span className="nav-card-icon" aria-hidden="true">✦</span>
          <strong>Build timeline</strong>
          <p>
            {milestones.length} named step{milestones.length === 1 ? '' : 's'} from first idea to public demo. No fixed dates.
          </p>
          <span className="plan-hub-cta soft-label">Open build timeline →</span>
        </a>
      </div>

      {current && (
        <section className="current-milestone-card plan-hub-teaser">
          <p className="eyebrow">Current build step</p>
          <h2>{current.title}</h2>
          <p>{current.summary}</p>
          <a className="button small" href={routeHref('/build')}>Open build timeline</a>
        </section>
      )}
    </main>
  );
}
