import { useMemo, useState } from 'react';
import { statusText } from '../lib/data.js';

function ProgressRing({ value }) {
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, value)) / 100) * circumference;
  return (
    <svg className="progress-ring" viewBox="0 0 44 44" aria-label={`${value}% complete`}>
      <circle cx="22" cy="22" r={radius} className="ring-track" />
      <circle cx="22" cy="22" r={radius} className="ring-fill" strokeDasharray={circumference} strokeDashoffset={offset} />
      <text x="22" y="24" textAnchor="middle">{value}%</text>
    </svg>
  );
}

function FeatureCard({ feature, bugMap, poiMap }) {
  return (
    <article className={`feature-card stage-${feature.stage}`}>
      <div className="feature-card-header">
        <div>
          <span className="feature-category">{feature.category}</span>
          <h3>{feature.title}</h3>
        </div>
        <ProgressRing value={feature.progress} />
      </div>
      <p>{feature.summary}</p>
      <div className="feature-meta">
        <span className="status-pill">{statusText[feature.stage] || feature.stage}</span>
        <span className={`priority priority-${feature.priority}`}>{feature.priority} priority</span>
      </div>
      <ul className="task-list">
        {feature.tasks.map((task) => (
          <li key={task.id} className={task.done ? 'done' : ''}>
            <span>{task.done ? '✓' : '○'}</span>
            {task.label}
          </li>
        ))}
      </ul>
      {feature.linkedBugs?.length ? (
        <div className="mini-links">
          <strong>Linked bugs</strong>
          {feature.linkedBugs.map((id) => <span key={id}>{bugMap.get(id)?.title || id}</span>)}
        </div>
      ) : null}
      {feature.linkedResearch?.length ? (
        <div className="mini-links">
          <strong>Research</strong>
          {feature.linkedResearch.map((id) => <span key={id}>{poiMap.get(id)?.name || id}</span>)}
        </div>
      ) : null}
    </article>
  );
}

export function FlightBoard({ features, bugs, atlas }) {
  const [stageFilter, setStageFilter] = useState('all');
  const bugMap = useMemo(() => new Map(bugs.items.map((bug) => [bug.id, bug])), [bugs.items]);
  const poiMap = useMemo(() => new Map(atlas.pois.map((poi) => [poi.id, poi])), [atlas.pois]);
  const stages = features.stages;

  return (
    <section className="section-wrap flight-board" id="on-flight-board" aria-labelledby="flight-title">
      <div className="section-heading split-heading">
        <div>
          <p className="eyebrow">On-Flight Board</p>
          <h2 id="flight-title">A production board that feels like resort operations.</h2>
          <p>
            Features move through boarding, on-flight, testing, landed, and blocked. Each card can link back to bugs and research POIs.
          </p>
        </div>
        <div className="filter-row">
          <label>
            Stage
            <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
              <option value="all">All stages</option>
              {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="stage-grid">
        {stages
          .filter((stage) => stageFilter === 'all' || stage.id === stageFilter)
          .map((stage) => {
            const items = features.items.filter((item) => item.stage === stage.id);
            return (
              <section className="stage-column" key={stage.id} aria-labelledby={`stage-${stage.id}`}>
                <div className="stage-heading">
                  <h3 id={`stage-${stage.id}`}>{stage.label}</h3>
                  <span>{items.length}</span>
                </div>
                <p>{stage.description}</p>
                <div className="feature-stack">
                  {items.map((feature) => <FeatureCard key={feature.id} feature={feature} bugMap={bugMap} poiMap={poiMap} />)}
                </div>
              </section>
            );
          })}
      </div>
    </section>
  );
}
