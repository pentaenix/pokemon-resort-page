import React, { useEffect, useMemo, useState } from 'react';
import { PageTitle } from '../components/Layout.jsx';
import { EvidencePhotosButton } from '../components/EvidencePhotosButton.jsx';
import { FeatureDossierModal } from '../components/FeatureDossierModal.jsx';
import { ProgressBar, StatusPill } from '../components/StatusPill.jsx';
import { boardSectionHref, routeHref, scrollToSection } from '../lib/data.js';
import { sortBugsForDisplay, sortFeaturesForDisplay } from '../lib/boardSort.js';

const FEATURES_PREVIEW_COUNT = 4;
const BUGS_PREVIEW_COUNT = 6;

function FeatureCard({ feature, bugs }) {
  const [open, setOpen] = useState(false);
  const [dossierOpen, setDossierOpen] = useState(false);
  return (
    <article className="feature-card">
      <div className="feature-card-shell">
        <button className="feature-card-main" onClick={() => setOpen(!open)} aria-expanded={open}>
          <div>
            <span className="soft-label">{feature.area} · {feature.priority}</span>
            <h3>{feature.title}</h3>
            <p>{feature.summary}</p>
          </div>
          <div className="feature-progress"><strong>{feature.progress}%</strong><ProgressBar value={feature.progress} /></div>
        </button>
        <button
          type="button"
          className="feature-dossier-open"
          onClick={(event) => {
            event.stopPropagation();
            setDossierOpen(true);
          }}
          aria-label={`Open full details for ${feature.title}`}
          title="Full feature details"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 5.5h9a1.5 1.5 0 0 1 1.5 1.5v11H9V5.5Z" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9 5.5H7.5A1.5 1.5 0 0 0 6 7v11h3V5.5Z" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 9.5h5M11 12h5M11 14.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="feature-card-detail">
          <ul className="checklist">{feature.tasks.map((task) => <li key={task.label} className={task.done ? 'done' : ''}>{task.label}</li>)}</ul>
          {(feature.linkedBugs?.length || feature.linkedRoutes?.length) && (
            <div className="linked-list"><strong>Linked</strong>{feature.linkedBugs?.map((bug) => <a key={bug} href={routeHref('/board', { q: bug, section: 'operations-bugs' })}>{bug}</a>)}{feature.linkedRoutes?.map((route) => <a key={route} href={routeHref('/ontology', { route })}>{route}</a>)}</div>
          )}
        </div>
      )}
      {dossierOpen && <FeatureDossierModal feature={feature} bugs={bugs} onClose={() => setDossierOpen(false)} />}
    </article>
  );
}

function BugCard({ bug }) {
  return (
    <article className="bug-card" id={bug.id}>
      <div className="bug-card-top"><span className="bug-id">{bug.id}</span><StatusPill status={bug.status} label={bug.status} /></div>
      <h3>{bug.title}</h3>
      <p>{bug.summary}</p>
      <div className="pill-row"><StatusPill status={bug.severity} label={bug.severity} /><span className="soft-label">{bug.area}</span></div>
      <ul className="checklist compact-list">{bug.checklist.map((item) => <li key={item.label} className={item.done ? 'done' : ''}>{item.label}</li>)}</ul>
      {(bug.linkedRoutes?.length || bug.linkedFeature) && (
        <div className="linked-list"><strong>Linked</strong>{bug.linkedFeature && <a href={boardSectionHref('operations-board')}>{bug.linkedFeature}</a>}{bug.linkedRoutes?.map((route) => <a key={route} href={routeHref('/ontology', { route })}>{route}</a>)}</div>
      )}
      <EvidencePhotosButton images={bug.images} title={bug.title} className="evidence-photos-btn--corner" />
    </article>
  );
}

function CommunityIssueCard({ issue }) {
  return (
    <article className="bug-card community-issue-card">
      <div className="bug-card-top"><span className="bug-id">#{issue.number}</span><StatusPill status={issue.state || 'open'} label={issue.state || 'open'} /></div>
      <h3>{issue.title}</h3>
      <p>{issue.summary}</p>
      <div className="pill-row">{issue.labels?.map((label) => <span key={label} className="soft-label">{label}</span>)}</div>
      {issue.url && <a className="button small ghost" href={issue.url} target="_blank" rel="noreferrer">Open in GitHub</a>}
      {issue.linkedBug && <div className="linked-list"><strong>Linked internal bug</strong><a href={routeHref('/board', { q: issue.linkedBug, section: 'operations-bugs' })}>{issue.linkedBug}</a></div>}
    </article>
  );
}

function CollapsibleList({ items, previewCount, renderItem, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = items;
  const hiddenCount = Math.max(0, sorted.length - previewCount);
  const visible = expanded || hiddenCount === 0 ? sorted : sorted.slice(0, previewCount);

  return (
    <div className={className}>
      {visible.map(renderItem)}
      {hiddenCount > 0 && (
        <button type="button" className="board-show-more" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

function FlightColumn({ stage, features, bugs }) {
  const sorted = useMemo(() => sortFeaturesForDisplay(features), [features]);
  return (
    <div className="flight-column">
      <header>
        <StatusPill status={stage} label={stage} />
        <span>{sorted.length}</span>
      </header>
      <CollapsibleList
        items={sorted}
        previewCount={FEATURES_PREVIEW_COUNT}
        className="flight-column-body"
        renderItem={(feature) => <FeatureCard key={feature.id} feature={feature} bugs={bugs} />}
      />
    </div>
  );
}

function OperationsJumpLink({ sectionId, label }) {
  const href = boardSectionHref(sectionId);
  return (
    <a
      href={href}
      onClick={(event) => {
        const onBoard = window.location.hash.startsWith('#/board');
        if (onBoard) {
          event.preventDefault();
          window.history.replaceState(null, '', href);
          scrollToSection(sectionId);
        }
      }}
    >
      {label}
    </a>
  );
}

export default function Board({ data, query }) {
  const { features, stages } = data.features;
  const { bugs, statuses, severities, communityIssues = [] } = data.bugs;
  const [area, setArea] = useState('All');
  const [stageFilter, setStageFilter] = useState('All');
  const [bugFilter, setBugFilter] = useState(query.q || 'All');

  useEffect(() => {
    if (!query.section) return;
    const timer = window.setTimeout(() => scrollToSection(query.section), 80);
    return () => window.clearTimeout(timer);
  }, [query.section]);

  const areas = ['All', ...Array.from(new Set(features.map((f) => f.area)))];
  const filteredFeatures = useMemo(
    () => features.filter((f) => (area === 'All' || f.area === area) && (stageFilter === 'All' || f.stage === stageFilter)),
    [features, area, stageFilter],
  );
  const filteredBugs = useMemo(() => {
    const list = bugs.filter((bug) => {
      if (bugFilter === 'All') return true;
      return bug.status === bugFilter || bug.severity === bugFilter || bug.area === bugFilter || bug.id === bugFilter || bug.linkedRoutes?.includes(bugFilter);
    });
    return sortBugsForDisplay(list);
  }, [bugs, bugFilter]);

  const sortedFocusedFeatures = useMemo(() => sortFeaturesForDisplay(filteredFeatures), [filteredFeatures]);
  const bugFilters = ['All', ...statuses, ...severities, ...Array.from(new Set(bugs.map((b) => b.area)))];

  return (
    <main>
      <PageTitle eyebrow="Resort Operations" title="Active features, internal bugs, and community issues.">
        What is moving on the resort build, what is broken internally, and what came in from GitHub. Milestones live under Ideas and Milestones.
      </PageTitle>

      <nav className="operations-jumpbar" aria-label="Operations sections">
        <OperationsJumpLink sectionId="operations-board" label="On-Flight Board" />
        <OperationsJumpLink sectionId="operations-bugs" label="Internal Bugs" />
        <OperationsJumpLink sectionId="operations-community" label="Community Issues" />
      </nav>

      <section className="operations-section" id="operations-board">
        <div className="section-intro compact">
          <p className="eyebrow">On-Flight Board</p>
          <h2>What is moving now</h2>
          <p>Sorted by priority, then progress. Only the first few cards show until you hit Show more.</p>
        </div>
        <section className="board-toolbar">
          <div className="segmented">{areas.map((value) => <button key={value} type="button" className={area === value ? 'active' : ''} onClick={() => setArea(value)}>{value}</button>)}</div>
          <div className="segmented wrap">{['All', ...stages].map((stage) => <button key={stage} type="button" className={stageFilter === stage ? 'active' : ''} onClick={() => setStageFilter(stage)}>{stage === 'All' ? 'All stages' : stage}</button>)}</div>
        </section>

        {stageFilter === 'All' ? (
          <section className="flight-board all-stages">
            {stages.map((stage) => (
              <FlightColumn
                key={stage}
                stage={stage}
                features={filteredFeatures.filter((f) => f.stage === stage)}
                bugs={bugs}
              />
            ))}
          </section>
        ) : (
          <section className="flight-board focused-stage">
            <header className="focused-stage-header">
              <StatusPill status={stageFilter} label={stageFilter} />
              <strong>{sortedFocusedFeatures.length} item{sortedFocusedFeatures.length === 1 ? '' : 's'}</strong>
              <button type="button" className="button small ghost" onClick={() => setStageFilter('All')}>Show all stages</button>
            </header>
            <CollapsibleList
              items={sortedFocusedFeatures}
              previewCount={FEATURES_PREVIEW_COUNT * 2}
              className="focused-card-grid"
              renderItem={(feature) => <FeatureCard key={feature.id} feature={feature} bugs={bugs} />}
            />
          </section>
        )}
      </section>

      <section className="operations-section" id="operations-bugs">
        <div className="section-intro compact">
          <p className="eyebrow">Internal Bugs</p>
          <h2>Curated bugs and blockers.</h2>
          <p>Sorted by severity and active status. Expand to see the full list.</p>
        </div>
        <section className="issue-toolbar">
          <div className="segmented wrap">{bugFilters.map((value) => <button key={value} type="button" className={bugFilter === value ? 'active' : ''} onClick={() => setBugFilter(value)}>{value}</button>)}</div>
        </section>
        <CollapsibleList
          items={filteredBugs}
          previewCount={BUGS_PREVIEW_COUNT}
          className="bug-grid"
          renderItem={(bug) => <BugCard key={bug.id} bug={bug} />}
        />
      </section>

      <section className="operations-section" id="operations-community">
        <div className="section-intro compact">
          <p className="eyebrow">Community Issues</p>
          <h2>GitHub issues (separate from internal bugs)</h2>
          <p>When the project is ready, public GitHub issues can be curated here and linked back to internal bugs, routes, or features.</p>
        </div>
        {communityIssues.length ? (
          <section className="bug-grid">{communityIssues.map((issue) => <CommunityIssueCard key={issue.id || issue.number} issue={issue} />)}</section>
        ) : (
          <div className="empty-state">
            <h3>No community issues are currently linked.</h3>
            <p>Internal bugs are above. Link a GitHub issue from the desk when you want it shown here.</p>
          </div>
        )}
      </section>
    </main>
  );
}
