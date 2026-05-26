import { useMemo, useState } from 'react';
import { statusText } from '../lib/data.js';

const routeClass = {
  broken: 'route-broken',
  edge: 'route-edge',
  testing: 'route-testing',
  working: 'route-working'
};

function curvePath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lift = Math.max(8, Math.abs(dx) * 0.2 + Math.abs(dy) * 0.18);
  const c1 = { x: from.x + dx * 0.32, y: from.y - lift };
  const c2 = { x: from.x + dx * 0.68, y: to.y - lift };
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
}

export function CompatibilityLab({ compatibility, bugs }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [genFilter, setGenFilter] = useState('all');
  const [selectedRouteId, setSelectedRouteId] = useState(compatibility.routes[0]?.id);

  const games = useMemo(() => new Map(compatibility.games.map((game) => [game.id, game])), [compatibility.games]);
  const bugMap = useMemo(() => new Map(bugs.items.map((bug) => [bug.id, bug])), [bugs.items]);

  const filteredRoutes = compatibility.routes.filter((route) => {
    const from = games.get(route.from);
    const matchesStatus = statusFilter === 'all' || route.status === statusFilter;
    const matchesGen = genFilter === 'all' || String(from?.gen) === genFilter;
    return matchesStatus && matchesGen;
  });
  const selectedCandidate = compatibility.routes.find((route) => route.id === selectedRouteId);
  const selectedRoute = filteredRoutes.find((route) => route.id === selectedRouteId) || filteredRoutes[0] || selectedCandidate || compatibility.routes[0];
  const selectedFrom = selectedRoute ? games.get(selectedRoute.from) : null;
  const selectedTo = selectedRoute ? games.get(selectedRoute.to) : null;

  return (
    <section className="section-wrap compatibility-lab" id="compatibility-lab" aria-labelledby="compatibility-title">
      <div className="section-heading split-heading">
        <div>
          <p className="eyebrow">Compatibility Lab</p>
          <h2 id="compatibility-title">Every route tells a test story.</h2>
          <p>
            The chart is driven by route data, not a static image. Filter by status or generation, then select a line to see the round-trip notes.
          </p>
        </div>
        <div className="filter-row" aria-label="Compatibility filters">
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {compatibility.legend.map((item) => <option value={item.status} key={item.status}>{item.label}</option>)}
            </select>
          </label>
          <label>
            Generation
            <select value={genFilter} onChange={(event) => setGenFilter(event.target.value)}>
              <option value="all">All gens</option>
              {compatibility.games.filter((game) => game.gen > 0).map((game) => (
                <option value={game.gen} key={game.id}>{game.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="compat-layout">
        <div className="graph-panel glass-panel">
          <svg viewBox="0 0 100 100" role="img" aria-label="Interactive compatibility graph">
            <defs>
              <filter id="routeGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {filteredRoutes.map((route) => {
              const from = games.get(route.from);
              const to = games.get(route.to);
              if (!from || !to) return null;
              const selected = route.id === selectedRoute?.id;
              return (
                <g key={route.id} className={`compat-route ${routeClass[route.status]} ${selected ? 'selected' : ''}`}>
                  <path d={curvePath(from, to)} onClick={() => setSelectedRouteId(route.id)} />
                  <circle cx={(from.x + to.x) / 2} cy={(from.y + to.y) / 2 - 4} r={selected ? 1.9 : 1.3} onClick={() => setSelectedRouteId(route.id)} />
                </g>
              );
            })}
            {compatibility.games.map((game) => (
              <g key={game.id} className={`game-node ${game.id === 'resort' ? 'resort-node' : ''}`} transform={`translate(${game.x} ${game.y})`}>
                <rect x="-7" y="-4" width="14" height="8" rx="2.4" />
                <text y="0.9" textAnchor="middle">{game.label}</text>
              </g>
            ))}
          </svg>
          <div className="legend-row">
            {compatibility.legend.map((item) => <span className={`legend ${routeClass[item.status]}`} key={item.status}>{item.label}</span>)}
          </div>
        </div>

        {selectedRoute && (
          <aside className="route-panel stack-panel">
            <span className={`status-pill ${routeClass[selectedRoute.status]}`}>{statusText[selectedRoute.status]}</span>
            <h3>{selectedFrom?.label} → Resort → {selectedFrom?.label}</h3>
            <p className="poi-type">{selectedFrom?.title} · {selectedFrom?.platform}</p>
            <p>{selectedRoute.summary}</p>
            <dl className="detail-list">
              <div><dt>Route target</dt><dd>{selectedTo?.title}</dd></div>
              <div><dt>Round trip</dt><dd>{selectedRoute.roundTrip ? 'Yes' : 'No'}</dd></div>
              <div><dt>Test coverage</dt><dd>{selectedRoute.testCoverage}</dd></div>
              <div><dt>Last updated</dt><dd>{selectedRoute.lastUpdated}</dd></div>
            </dl>
            <h4>Known issues</h4>
            {selectedRoute.knownIssues?.length ? (
              <ul className="link-list bug-links">{selectedRoute.knownIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
            ) : <p className="quiet-note">No active issue notes on this route.</p>}
            {selectedRoute.relatedBugs?.length ? (
              <>
                <h4>Linked tickets</h4>
                <ul className="link-list bug-links">
                  {selectedRoute.relatedBugs.map((id) => <li key={id}>{bugMap.get(id)?.title || id}</li>)}
                </ul>
              </>
            ) : null}
          </aside>
        )}
      </div>
    </section>
  );
}
