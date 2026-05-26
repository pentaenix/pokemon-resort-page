import { useMemo, useState } from 'react';
import { statusText } from '../lib/data.js';

function BugCard({ bug, featureMap, routeMap }) {
  const done = bug.checklist.filter((item) => item.done).length;
  return (
    <article className={`bug-card severity-${bug.severity} status-${bug.status}`}>
      <div className="bug-card-top">
        <div>
          <span className="bug-id">{bug.id}</span>
          <h3>{bug.title}</h3>
        </div>
        <span className={`status-pill status-${bug.status}`}>{statusText[bug.status] || bug.status}</span>
      </div>
      <p>{bug.summary}</p>
      <div className="bug-meta">
        <span>{bug.area}</span>
        <span>{bug.severity} severity</span>
        <span>{done}/{bug.checklist.length} checks</span>
      </div>
      <ul className="task-list compact">
        {bug.checklist.map((item) => (
          <li key={item.label} className={item.done ? 'done' : ''}>
            <span>{item.done ? '✓' : '○'}</span>
            {item.label}
          </li>
        ))}
      </ul>
      <div className="mini-links">
        <strong>Linked work</strong>
        {bug.linkedFeature ? <span>{featureMap.get(bug.linkedFeature)?.title || bug.linkedFeature}</span> : null}
        {bug.linkedRoutes?.map((id) => <span key={id}>{routeMap.get(id)?.summary || id}</span>)}
      </div>
    </article>
  );
}

export function IssueDesk({ bugs, features, compatibility }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const featureMap = useMemo(() => new Map(features.items.map((feature) => [feature.id, feature])), [features.items]);
  const routeMap = useMemo(() => new Map(compatibility.routes.map((route) => [route.id, route])), [compatibility.routes]);
  const visible = bugs.items.filter((bug) => {
    const statusMatch = statusFilter === 'all' || bug.status === statusFilter;
    const severityMatch = severityFilter === 'all' || bug.severity === severityFilter;
    return statusMatch && severityMatch;
  });

  return (
    <section className="section-wrap issue-desk" id="issue-desk" aria-labelledby="issue-title">
      <div className="section-heading split-heading">
        <div>
          <p className="eyebrow">Issue Desk</p>
          <h2 id="issue-title">A curated bug tracker, not a comment wall.</h2>
          <p>
            Public issues are readable, linked, and checklist-driven. They are edited from the local admin tool, not submitted through the website.
          </p>
        </div>
        <div className="filter-row">
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {bugs.statuses.map((status) => <option key={status} value={status}>{statusText[status] || status}</option>)}
            </select>
          </label>
          <label>
            Severity
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
              <option value="all">All severities</option>
              {bugs.severities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="bug-grid">
        {visible.map((bug) => <BugCard key={bug.id} bug={bug} featureMap={featureMap} routeMap={routeMap} />)}
      </div>
    </section>
  );
}
