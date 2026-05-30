import React, { useMemo, useState } from 'react';
import { PageTitle } from '../components/Layout.jsx';
import { StatusPill } from '../components/StatusPill.jsx';
import { routeHref } from '../lib/data.js';

function BugCard({ bug }) {
  return (
    <article className="bug-card">
      <div className="bug-card-top">
        <div><span className="soft-label">{bug.id}</span><h3>{bug.title}</h3></div>
        <div className="pill-row"><StatusPill status={bug.status} label={bug.status} /><StatusPill status={bug.severity} label={bug.severity} /></div>
      </div>
      <p>{bug.summary}</p>
      <div className="route-summary-grid"><span><strong>Area</strong>{bug.area}</span><span><strong>Feature</strong>{bug.linkedFeature}</span><span><strong>Updated</strong>{bug.lastUpdated}</span></div>
      <ul className="checklist">{bug.checklist.map((item) => <li key={item.label} className={item.done ? 'done' : ''}>{item.label}</li>)}</ul>
      {bug.linkedRoutes?.length > 0 && <div className="linked-list"><strong>Routes</strong>{bug.linkedRoutes.map((route) => <a key={route} href={routeHref('/ontology', { route })}>{route}</a>)}</div>}
    </article>
  );
}

export default function Issues({ data, query }) {
  const bugs = data.bugs.bugs || [];
  const [status, setStatus] = useState('All');
  const [area, setArea] = useState('All');
  const [search, setSearch] = useState(query.q || '');
  const statuses = ['All', ...data.bugs.statuses];
  const areas = ['All', ...Array.from(new Set(bugs.map((b) => b.area)))];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bugs.filter((bug) => {
      if (status !== 'All' && bug.status !== status) return false;
      if (area !== 'All' && bug.area !== area) return false;
      if (!q) return true;
      return [bug.id, bug.title, bug.summary, bug.area, bug.linkedFeature, ...(bug.linkedRoutes || [])].join(' ').toLowerCase().includes(q);
    });
  }, [bugs, status, area, search]);
  return (
    <main>
      <PageTitle eyebrow="Issue Desk" title="Curated bugs and blockers without public comment clutter.">
        The public tracker is designed for clarity: status, severity, area, checklists, and route/feature links.
      </PageTitle>
      <section className="issue-toolbar">
        <div className="segmented">{statuses.map((value) => <button key={value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{value}</button>)}</div>
        <div className="segmented">{areas.map((value) => <button key={value} className={area === value ? 'active' : ''} onClick={() => setArea(value)}>{value}</button>)}</div>
        <label className="search-box"><span>Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="bug ID, route, area…" /></label>
      </section>
      <section className="bug-grid">{filtered.map((bug) => <BugCard key={bug.id} bug={bug} />)}</section>
    </main>
  );
}
