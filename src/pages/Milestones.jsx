import React, { useEffect, useMemo, useRef } from 'react';
import { PageTitle } from '../components/Layout.jsx';
import { StatusPill } from '../components/StatusPill.jsx';
import { assetUrl } from '../lib/data.js';

function statusLabel(status) {
  return ({ past: 'Completed', current: 'Current', next: 'Next', future: 'Future', paused: 'Paused' }[status] || status);
}

export default function Milestones({ data }) {
  const roadmap = data.roadmap || {};
  const milestones = roadmap.milestones || [];
  const currentId = roadmap.currentMilestoneId || milestones.find((m) => m.status === 'current')?.id;
  const currentRef = useRef(null);
  const current = useMemo(() => milestones.find((m) => m.id === currentId) || milestones.find((m) => m.status === 'current'), [milestones, currentId]);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    currentRef.current?.scrollIntoView({ block: 'center', behavior: prefersReduced ? 'auto' : 'smooth' });
  }, []);

  return (
    <main className="milestones-page">
      <PageTitle eyebrow="Milestones" title="A vertical path through the resort’s development.">
        No dates required: the timeline follows meaningful project milestones from the first idea to long-term demo goals.
      </PageTitle>
      {current && (
        <section className="current-milestone-card">
          <p className="eyebrow">You are here</p>
          <h2>{current.title}</h2>
          <p>{current.summary}</p>
        </section>
      )}
      <section className="milestone-timeline" aria-label="Project milestones">
        {milestones.map((item, index) => {
          const active = item.id === currentId || item.status === 'current';
          return (
            <article key={item.id} ref={active ? currentRef : null} className={`milestone-item ${item.status || ''} ${active ? 'active' : ''}`}>
              <div className="milestone-marker" aria-hidden="true"><span>{index + 1}</span></div>
              <div className="milestone-card">
                <div className="milestone-card-top">
                  <StatusPill status={item.status} label={active ? 'Current step' : statusLabel(item.status)} />
                  {['next', 'future'].includes(item.status) && <span className="sparkle-trail" aria-hidden="true">✦ ✧ ✦</span>}
                </div>
                <h2>{item.title}</h2>
                <p>{item.summary}</p>
                {item.image && <img src={assetUrl(item.image)} alt={`${item.title} reference`} />}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
