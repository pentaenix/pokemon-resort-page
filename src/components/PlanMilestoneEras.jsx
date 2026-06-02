import React from 'react';
import { StatusPill } from './StatusPill.jsx';
import { recordHasRichContent } from '../lib/richContent.js';
import { MILESTONE_ERAS, eraStatusLabel, groupMilestonesByEra } from '../lib/milestoneEras.js';

function MilestoneCompactRow({ item, active, onOpen }) {
  return (
    <button type="button" className="plan-milestone-row" onClick={() => onOpen(item)}>
      <StatusPill status={item.status} label={active ? 'Current step' : eraStatusLabel(item.status)} />
      <div className="plan-milestone-row-text">
        <strong>{item.title}</strong>
        <span>{item.summary}</span>
      </div>
      {recordHasRichContent(item) && <span className="plan-card-rich" title="Extended details">◇</span>}
    </button>
  );
}

function MilestoneFeaturedCard({ item, active, onOpen }) {
  return (
    <article className={`plan-milestone-featured ${item.status || ''} ${active ? 'active' : ''}`}>
      <button type="button" className="plan-milestone-featured-btn" onClick={() => onOpen(item)}>
        <div className="plan-milestone-featured-top">
          <StatusPill status={item.status} label={active ? 'Current step' : eraStatusLabel(item.status)} />
          {recordHasRichContent(item) && <span className="plan-card-rich" title="Extended details">◇</span>}
          {item.status === 'next' && <span className="sparkle-trail" aria-hidden="true">✦ ✧ ✦</span>}
        </div>
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
      </button>
    </article>
  );
}

export function PlanMilestoneEras({ milestones, currentId, onOpen, excludeIds = new Set() }) {
  const groups = groupMilestonesByEra(milestones);

  return (
    <div className="plan-era-groups">
      {MILESTONE_ERAS.map((era) => {
        const items = groups[era.id].filter((m) => !excludeIds.has(m.id));
        if (!items.length) return null;

        const body = (
          <div className={`plan-era-body plan-era-body--${era.id}`}>
            {era.id === 'present'
              ? items.map((item) => {
                  const active = item.id === currentId || item.status === 'current';
                  return (
                    <MilestoneFeaturedCard
                      key={item.id}
                      item={item}
                      active={active}
                      onOpen={onOpen}
                    />
                  );
                })
              : items.map((item) => {
                  const active = item.id === currentId || item.status === 'current';
                  return (
                    <MilestoneCompactRow
                      key={item.id}
                      item={item}
                      active={active}
                      onOpen={onOpen}
                    />
                  );
                })}
          </div>
        );

        if (!era.collapsible) {
          return (
            <section key={era.id} className={`plan-era plan-era--${era.id}`} aria-labelledby={`plan-era-${era.id}`}>
              <header className="plan-era-head" id={`plan-era-${era.id}`}>
                <div className="plan-era-head-text">
                  <h3>{era.title}</h3>
                  <p>{era.subtitle}</p>
                </div>
                <span className="plan-era-count">{items.length}</span>
              </header>
              {body}
            </section>
          );
        }

        return (
          <details
            key={era.id}
            className={`plan-era plan-era--${era.id}`}
            open={era.defaultOpen}
          >
            <summary className="plan-era-summary">
              <span className="plan-era-head-text">
                <strong>{era.title}</strong>
                <span>{era.subtitle}</span>
              </span>
              <span className="plan-era-count">{items.length}</span>
            </summary>
            {body}
          </details>
        );
      })}
    </div>
  );
}
