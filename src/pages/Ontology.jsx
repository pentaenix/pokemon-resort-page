import React, { useEffect, useMemo, useState } from 'react';
import { routeHref, statusClass } from '../lib/data.js';
import { PageTitle } from '../components/Layout.jsx';
import { GameCardGrid } from '../components/GameCard.jsx';
import { StatusPill } from '../components/StatusPill.jsx';

const WIDTH = 1040;
const HEIGHT = 720;
const VIEW_PAD = 90;
const VIEW_BOX = `${-VIEW_PAD} ${-VIEW_PAD} ${WIDTH + VIEW_PAD * 2} ${HEIGHT + VIEW_PAD * 2}`;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const NODE_R = 50;
const ROUTE_LANE_GAP = 2.5;
const ARROW_SIZE = 7;

const ROMAN_NUMERALS = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix'];
const REGION_GENERATIONS = {
  kanto: ['gen1', 'gen3', 'gen7'],
  johto: ['gen2', 'gen4'],
  hoenn: ['gen3', 'gen6'],
  sinnoh: ['gen4', 'gen8'],
  hisui: ['gen8'],
  unova: ['gen5'],
  kalos: ['gen6', 'gen9'],
  lumiose: ['gen9'],
  alola: ['gen7'],
  galar: ['gen8'],
  paldea: ['gen9'],
};

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function genName(gens, id) { return gens.find((g) => g.id === id)?.label || id.replace('gen', 'Gen '); }
function regionsForGeneration(genId) {
  return Object.entries(REGION_GENERATIONS)
    .filter(([, genIds]) => genIds.includes(genId))
    .map(([region]) => region);
}
function buildRegionIndex(generations) {
  const index = Object.entries(REGION_GENERATIONS).map(([region, genIds]) => ({
    region: normalizeSearchText(region),
    genIds: [...new Set(genIds)],
  }));
  generations.forEach((gen) => {
    const primary = normalizeSearchText(gen.era.split('/')[0].trim());
    const entry = index.find((item) => item.region === primary);
    if (entry) {
      if (!entry.genIds.includes(gen.id)) entry.genIds.push(gen.id);
      return;
    }
    index.push({ region: primary, genIds: [gen.id] });
  });
  return index;
}
function generationSearchTerms(gen) {
  const roman = ROMAN_NUMERALS[gen.number] || String(gen.number);
  return [
    gen.id,
    gen.label,
    gen.shortLabel,
    gen.era,
    ...regionsForGeneration(gen.id),
    `gen${gen.number}`,
    `gen ${gen.number}`,
    `generation ${gen.number}`,
    `generation ${roman}`,
    `gen ${roman}`,
  ].map(normalizeSearchText);
}
function buildSearchContext(generations, games, statuses) {
  const gamesByGen = games.reduce((acc, game) => {
    if (!acc[game.generation]) acc[game.generation] = [];
    acc[game.generation].push(game);
    return acc;
  }, {});
  const genEntries = generations.map((gen) => ({
    id: gen.id,
    terms: generationSearchTerms(gen),
    games: (gamesByGen[gen.id] || []).flatMap((game) => [
      game.id,
      game.title,
      game.shortTitle,
      game.family,
      game.platform,
    ].map(normalizeSearchText)),
  }));
  return { genEntries, gamesByGen, games, regionIndex: buildRegionIndex(generations), statuses };
}
function termMatchesQuery(term, query) {
  if (!term) return false;
  if (term === query) return true;
  if (query.length >= 3 && term.includes(query)) return true;
  if (term.length >= 3 && query.includes(term)) return true;
  return false;
}
function matchGenerations(query, { genEntries, games, regionIndex }) {
  const matched = new Set();
  genEntries.forEach(({ id, terms, games: gameTerms }) => {
    const hit = [...terms, ...gameTerms].some((term) => termMatchesQuery(term, query));
    if (hit) matched.add(id);
  });
  games.forEach((game) => {
    const id = normalizeSearchText(game.id);
    const title = normalizeSearchText(game.title);
    const short = normalizeSearchText(game.shortTitle);
    const hit = [id, title, short, ...id.split('-')].some((term) => termMatchesQuery(term, query));
    if (hit) matched.add(game.generation);
  });
  regionIndex.forEach(({ region, genIds }) => {
    if (termMatchesQuery(region, query)) genIds.forEach((id) => matched.add(id));
  });
  return matched;
}
function findExactGame(query, games) {
  return games.find((game) => {
    const id = normalizeSearchText(game.id);
    const title = normalizeSearchText(game.title);
    const short = normalizeSearchText(game.shortTitle);
    return id === query || title === query || short === query;
  }) || null;
}
function parseSearchQuery(rawQuery, searchContext) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return { mode: 'empty' };

  const exactGame = findExactGame(query, searchContext.games);
  if (exactGame) return { mode: 'game', game: exactGame };

  const segments = query.split('-').filter(Boolean);
  if (segments.length >= 2) {
    const partGens = segments.map((part) => matchGenerations(part, searchContext));
    if (partGens.every((set) => set.size > 0)) return { mode: 'pair', partGens };
  }

  return { mode: 'single', query };
}
function routeMatchesPairSearch(route, partGens) {
  for (let i = 0; i < partGens.length; i += 1) {
    for (let j = i + 1; j < partGens.length; j += 1) {
      const a = partGens[i];
      const b = partGens[j];
      const connects = [...a].some((fromGen) => [...b].some((toGen) => (
        (route.from === fromGen && route.to === toGen) || (route.from === toGen && route.to === fromGen)
      )));
      if (connects) return true;
    }
  }
  return false;
}
function buildRouteSearchBlob(route, generations, gamesByGen, statuses) {
  const from = generations.find((g) => g.id === route.from);
  const to = generations.find((g) => g.id === route.to);
  const fromGames = gamesByGen[route.from] || [];
  const toGames = gamesByGen[route.to] || [];
  return normalizeSearchText([
    route.id,
    route.summary,
    route.status,
    statuses[route.status]?.label,
    routeTitle(route, generations),
    routeLegLabel(route, generations),
    from?.label,
    from?.shortLabel,
    from?.era,
    to?.label,
    to?.shortLabel,
    to?.era,
    ...generationSearchTerms(from || { id: route.from, number: 0, label: '', shortLabel: '', era: '' }),
    ...generationSearchTerms(to || { id: route.to, number: 0, label: '', shortLabel: '', era: '' }),
    ...fromGames.flatMap((g) => [g.id, g.title, g.shortTitle]),
    ...toGames.flatMap((g) => [g.id, g.title, g.shortTitle]),
    ...(route.relatedBugs || []),
  ].join(' '));
}
function routeMatchesSearch(route, rawQuery, searchContext, routeBlobs) {
  const parsed = parseSearchQuery(rawQuery, searchContext);
  if (parsed.mode === 'empty') return true;
  if (parsed.mode === 'game') {
    const generation = parsed.game.generation;
    return route.from === generation || route.to === generation;
  }
  if (parsed.mode === 'pair') return routeMatchesPairSearch(route, parsed.partGens);

  const blob = routeBlobs.get(route.id) || '';
  if (blob.includes(parsed.query)) return true;
  const genHits = matchGenerations(parsed.query, searchContext);
  return genHits.size > 0 && (genHits.has(route.from) || genHits.has(route.to));
}
function routeTitle(route, gens) {
  if (route.from === route.to) return `${genName(gens, route.from)} → Resort → ${genName(gens, route.from)}`;
  return `${genName(gens, route.from)} → ${genName(gens, route.to)} → ${genName(gens, route.from)}`;
}
function circlePositions(generations) {
  return Object.fromEntries(generations.map((gen, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / generations.length;
    return [gen.id, { x: CENTER.x + Math.cos(angle) * 270, y: CENTER.y + Math.sin(angle) * 270, angle }];
  }));
}
function focusPositions(generations, focusedId) {
  const positions = { [focusedId]: { ...CENTER, angle: -Math.PI / 2 } };
  const others = generations.filter((g) => g.id !== focusedId);
  others.forEach((gen, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / others.length;
    positions[gen.id] = { x: CENTER.x + Math.cos(angle) * 280, y: CENTER.y + Math.sin(angle) * 280, angle };
  });
  return positions;
}
function unitVector(dx, dy) {
  const distance = Math.hypot(dx, dy) || 1;
  return { ux: dx / distance, uy: dy / distance };
}
function arrowHeadPath(tip, dir) {
  const wing = ARROW_SIZE * 0.55;
  const base = { x: tip.x - dir.ux * ARROW_SIZE, y: tip.y - dir.uy * ARROW_SIZE };
  const nx = -dir.uy;
  const ny = dir.ux;
  const left = { x: base.x - nx * wing, y: base.y - ny * wing };
  const right = { x: base.x + nx * wing, y: base.y + ny * wing };
  return `M ${left.x.toFixed(2)} ${left.y.toFixed(2)} L ${tip.x.toFixed(2)} ${tip.y.toFixed(2)} L ${right.x.toFixed(2)} ${right.y.toFixed(2)}`;
}
function nodeRadius(genId, focusedId) {
  return focusedId === genId ? 62 : NODE_R;
}
function selfLoopPath(p) {
  if (!p) return { line: '', arrow: '' };
  let ux = p.x - CENTER.x;
  let uy = p.y - CENTER.y;
  const distance = Math.hypot(ux, uy);
  if (distance < 8) { ux = 0; uy = -1; } else { ux /= distance; uy /= distance; }
  const nx = -uy;
  const ny = ux;
  const start = { x: p.x + nx * 32 + ux * 42, y: p.y + ny * 32 + uy * 42 };
  const end = { x: p.x - nx * 32 + ux * 42, y: p.y - ny * 32 + uy * 42 };
  const c1 = { x: p.x + nx * 118 + ux * 142, y: p.y + ny * 118 + uy * 142 };
  const c2 = { x: p.x - nx * 118 + ux * 142, y: p.y - ny * 118 + uy * 142 };
  const line = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}, ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  const endDir = unitVector(end.x - c2.x, end.y - c2.y);
  return { line, arrow: arrowHeadPath(end, endDir) };
}
function pairPerpendicular(fromPos, toPos) {
  const { ux, uy } = unitVector(toPos.x - fromPos.x, toPos.y - fromPos.y);
  return { ux, uy, nx: -uy, ny: ux };
}
function routeLaneOffset(route) {
  if (route.from === route.to) return 0;
  return route.from < route.to ? ROUTE_LANE_GAP : -ROUTE_LANE_GAP;
}
function straightRoutePath(fromPos, toPos, route, focusedId) {
  if (!fromPos || !toPos) return { line: '', arrow: '' };
  if (route.from === route.to) return selfLoopPath(fromPos);
  const travel = pairPerpendicular(fromPos, toPos);
  const lowPos = route.from < route.to ? fromPos : toPos;
  const highPos = route.from < route.to ? toPos : fromPos;
  const pair = pairPerpendicular(lowPos, highPos);
  const lane = routeLaneOffset(route);
  const fromR = nodeRadius(route.from, focusedId) + 4;
  const toR = nodeRadius(route.to, focusedId) + 12;
  const start = {
    x: fromPos.x + travel.ux * fromR + pair.nx * lane,
    y: fromPos.y + travel.uy * fromR + pair.ny * lane,
  };
  const end = {
    x: toPos.x - travel.ux * toR + pair.nx * lane,
    y: toPos.y - travel.uy * toR + pair.ny * lane,
  };
  const line = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  return { line, arrow: arrowHeadPath(end, travel) };
}
function routeLegLabel(route, gens) {
  if (route.from === route.to) return `${genName(gens, route.from)} → Resort`;
  return `${genName(gens, route.from)} → ${genName(gens, route.to)}`;
}
function routeLegParts(route, gens) {
  if (route.from === route.to) return [genName(gens, route.from), 'Resort'];
  return [genName(gens, route.from), genName(gens, route.to)];
}
function routeTitleParts(route, gens) {
  if (route.from === route.to) return [genName(gens, route.from), 'Resort', genName(gens, route.from)];
  return [genName(gens, route.from), genName(gens, route.to), genName(gens, route.from)];
}
function RoutePhraseList({ parts, className = '' }) {
  return (
    <span className={className}>
      {parts.map((part, index) => (
        <React.Fragment key={`${part}-${index}`}>
          {index > 0 && <span className="route-leg-arrow"> → </span>}
          <span className="route-gen-phrase">{part}</span>
        </React.Fragment>
      ))}
    </span>
  );
}
function generationStats(genId, routes) {
  const connected = routes.filter((r) => r.from === genId || r.to === genId);
  return ['green', 'blue', 'yellow', 'red', 'gray'].reduce((acc, status) => {
    acc[status] = connected.filter((r) => r.status === status).length;
    return acc;
  }, { total: connected.length });
}
function nodeHealthBadges(stats) {
  return [
    stats.green ? { letter: 'P', count: stats.green, className: 'node-badge-passed' } : null,
    stats.gray ? { letter: 'U', count: stats.gray, className: 'node-badge-untested' } : null,
    stats.red ? { letter: 'F', count: stats.red, className: 'node-badge-failing' } : null,
  ].filter(Boolean);
}
function nodeHealthLabel(stats) {
  return nodeHealthBadges(stats).map((badge) => `${badge.count}${badge.letter}`).join(' ');
}
function NodeHealthText({ stats }) {
  const badges = nodeHealthBadges(stats);
  if (!badges.length) return <text y="18" textAnchor="middle" className="node-subtitle">-</text>;
  const gap = 26;
  const startX = -((badges.length - 1) * gap) / 2;
  return (
    <text y="18" className="node-subtitle">
      {badges.map((badge, index) => (
        <tspan key={badge.letter} x={startX + index * gap} className={badge.className}>
          {badge.count}{badge.letter}
        </tspan>
      ))}
    </text>
  );
}
function OntologyGraph({
  generations,
  routes,
  statuses,
  positions,
  selectedRoute,
  focusedId,
  onFocus,
  onSelectRoute,
  onClearRoute,
  onClearFocus,
  filter,
}) {
  const visibleRoutes = routes.filter((route) => {
    if (focusedId && !(route.from === focusedId || route.to === focusedId)) return false;
    if (filter !== 'all' && route.status !== filter) return false;
    return true;
  });
  const routePaths = visibleRoutes.map((route) => {
    const { line, arrow } = straightRoutePath(positions[route.from], positions[route.to], route, focusedId);
    return { route, line, arrow, hit: `${line} ${arrow}`.trim() };
  });
  return (
    <div className={`ontology-graph-wrap ${focusedId ? 'is-focused' : ''}`}>
      {focusedId && (
        <button type="button" className="ontology-graph-back button small ghost" onClick={onClearFocus}>
          ← Back
        </button>
      )}
      <svg viewBox={VIEW_BOX} className="ontology-graph" role="img" aria-label="Compatibility ontology graph" onClick={onClearRoute}>
        <defs>
          <filter id="nodeShadowV5" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#0b3b50" floodOpacity=".22" /></filter>
        </defs>
        <rect className="graph-surface" x={-VIEW_PAD} y={-VIEW_PAD} width={WIDTH + VIEW_PAD * 2} height={HEIGHT + VIEW_PAD * 2} fill="transparent" aria-hidden="true" />
        <g className="routes-layer">
          {routePaths.map(({ route, line, hit }) => {
            const active = selectedRoute?.id === route.id;
            return (
              <g key={route.id} className={`route-group ${statusClass(route.status)} ${active ? 'active' : ''}`}>
                <path d={hit} className="route-hit-area" onClick={(e) => { e.stopPropagation(); onSelectRoute(route); }} tabIndex="0" role="button" aria-label={`${routeLegLabel(route, generations)}: ${statuses[route.status]?.label || route.status}`} onKeyDown={(e) => e.key === 'Enter' && onSelectRoute(route)} />
                <path d={line} className={`route-line route-line-body ${statusClass(route.status)} ${active ? 'active' : ''}`} />
              </g>
            );
          })}
        </g>
        <g className="nodes-layer">
          {generations.map((gen) => {
            const p = positions[gen.id] || CENTER;
            const active = focusedId === gen.id;
            const stats = generationStats(gen.id, routes);
            const nodeLabel = `${gen.label}. ${nodeHealthLabel(stats) || 'No routes'}. P passed, U untested, F failing.`;
            return (
              <g key={gen.id} transform={`translate(${p.x}, ${p.y})`} className={`generation-node ${active ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onFocus(gen.id); }} tabIndex="0" role="button" aria-label={`Focus ${nodeLabel}`} onKeyDown={(e) => e.key === 'Enter' && onFocus(gen.id)}>
                <circle className="node-aura" r={active ? 72 : 58} fill={gen.accent} />
                <circle r={active ? 62 : 50} fill={gen.accent} filter="url(#nodeShadowV5)" />
                <circle r={active ? 54 : 42} fill="rgba(255,255,255,.22)" stroke="rgba(255,255,255,.72)" strokeWidth="2" />
                <text y="-4" textAnchor="middle" className="node-title">{gen.shortLabel}</text>
                <NodeHealthText stats={stats} />
              </g>
            );
          })}
        </g>
        <g className="routes-arrows-layer">
          {routePaths.map(({ route, arrow }) => {
            if (!arrow) return null;
            const active = selectedRoute?.id === route.id;
            return (
              <path
                key={`${route.id}-arrow`}
                d={arrow}
                className={`route-line route-arrow-head ${statusClass(route.status)} ${active ? 'active' : ''}`}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
function SearchHelpModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="ontology-help-backdrop" onClick={onClose} role="presentation">
      <div className="ontology-help-modal" role="dialog" aria-modal="true" aria-labelledby="ontology-search-help-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ontology-help-close" onClick={onClose} aria-label="Close search help">×</button>
        <h3 id="ontology-search-help-title">How route search works</h3>
        <p>Search filters which arrows stay visible on the graph. It does not move or focus generations by itself.</p>
        <ul className="ontology-help-list">
          <li><strong>One term</strong>: match a game (<em>yellow</em>), generation (<em>gen 3</em>, <em>Gen III</em>), region (<em>hoenn</em>, <em>johto</em>), route id, bug id, or status word.</li>
          <li><strong>Regions span remakes</strong>: <em>hoenn</em> includes Gen III and Gen VI; <em>johto</em> includes Gen II and Gen IV.</li>
          <li><strong>Two terms with a hyphen</strong>: <em>alpha-emerald</em> shows only routes between those games&apos; generations (Alpha Sapphire → Gen VI, Emerald → Gen III).</li>
          <li><strong>Exact game ids</strong>: <em>alpha-sapphire</em> (hyphenated) stays one game, not a pair.</li>
        </ul>
        <p className="ontology-help-note">Status filters above still apply. Clear the field to show everything again.</p>
        <button type="button" className="button small" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
function RouteList({ routes, statuses, onSelectRoute, selectedRoute, generations }) {
  return <div className="mobile-route-list">{routes.map((route) => <button key={route.id} className={`route-list-item ${selectedRoute?.id === route.id ? 'active' : ''}`} onClick={() => onSelectRoute(route)}><span className={`route-dot ${statusClass(route.status)}`} /><strong>{routeLegLabel(route, generations)}</strong><small>{statuses[route.status]?.label}</small></button>)}</div>;
}
function OntologyPanel({ generations, games, routes, statuses, focusedId, selectedRoute, onSelectRoute }) {
  const focused = generations.find((g) => g.id === focusedId);
  if (selectedRoute) {
    const from = generations.find((g) => g.id === selectedRoute.from);
    const to = generations.find((g) => g.id === selectedRoute.to);
    return <aside className="ontology-panel route-panel"><div className="panel-header"><p className="eyebrow">Selected Route</p><h2 className="route-leg-title"><RoutePhraseList parts={routeLegParts(selectedRoute, generations)} /></h2><p className="soft-label route-roundtrip-label"><RoutePhraseList parts={routeTitleParts(selectedRoute, generations)} /></p><StatusPill status={selectedRoute.status} label={statuses[selectedRoute.status]?.label} /></div><p>{selectedRoute.summary}</p><div className="route-summary-grid"><span><strong>Origin</strong>{from?.label}</span><span><strong>Target</strong>{selectedRoute.from === selectedRoute.to ? 'Resort' : to?.label}</span><span><strong>Coverage</strong>{selectedRoute.coverage}</span><span><strong>Updated</strong>{selectedRoute.lastUpdated}</span></div><h3>Checklist</h3><ul className="checklist">{selectedRoute.tests.map((test) => <li key={test.label} className={test.done ? 'done' : ''}>{test.label}</li>)}</ul>{selectedRoute.relatedBugs?.length > 0 && <div className="linked-list"><strong>Linked bugs</strong>{selectedRoute.relatedBugs.map((bug) => <a key={bug} href={routeHref('/board', { q: bug })}>{bug}</a>)}</div>}{focusedId && <p className="route-panel-hint">Click a generation circle to open that era&apos;s game library.</p>}</aside>;
  }
  if (focused) {
    const focusRoutes = routes.filter((r) => r.from === focused.id || r.to === focused.id);
    const stats = generationStats(focused.id, routes);
    return <aside className="ontology-panel"><div className="panel-header"><p className="eyebrow">Focused Generation</p><h2 className="route-leg-title"><span className="route-gen-phrase">{focused.label}</span></h2><span className="soft-label">{focused.era}</span></div><p>{focused.summary}</p><div className="health-grid">{['green','blue','yellow','red','gray'].map((key) => <button key={key} onClick={() => onSelectRoute(focusRoutes.find((r) => r.status === key))} disabled={!stats[key]}><StatusPill status={key} label={statuses[key]?.label} /><strong>{stats[key] || 0}</strong></button>)}</div><h3>Game library</h3><GameCardGrid games={games.filter((g) => g.generation === focused.id)} compact /></aside>;
  }
  return <aside className="ontology-panel"><div className="panel-header"><p className="eyebrow">Compatibility Lab</p><h2>Focus and inspect.</h2></div><p>Each generation pair has two parallel arrows, one per direction. Click an arrow to inspect that route in this panel. Click a generation circle to focus that generation&apos;s game library and route health. Node badges use <strong>P</strong> passed, <strong>U</strong> untested, and <strong>F</strong> failing.</p><div className="legend-stack">{Object.entries(statuses).map(([key, value]) => <span key={key}><i className={`route-dot ${key}`} /> <strong>{value.label}</strong> {value.description}</span>)}</div></aside>;
}
export default function Ontology({ data, query }) {
  const { generations, routes, games, statuses } = data.compatibility;
  const [focusedId, setFocusedId] = useState(query.gen || '');
  const [filter, setFilter] = useState(query.status || 'all');
  const [selectedRouteId, setSelectedRouteId] = useState(query.route || '');
  const [search, setSearch] = useState(query.q || '');
  const [searchHelpOpen, setSearchHelpOpen] = useState(false);
  const selectedRoute = routes.find((r) => r.id === selectedRouteId) || null;
  const searchContext = useMemo(() => buildSearchContext(generations, games, statuses), [generations, games, statuses]);
  const routeBlobs = useMemo(() => new Map(
    routes.map((route) => [route.id, buildRouteSearchBlob(route, generations, searchContext.gamesByGen, statuses)]),
  ), [routes, generations, searchContext, statuses]);
  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      if (focusedId && !(r.from === focusedId || r.to === focusedId)) return false;
      if (filter !== 'all' && r.status !== filter) return false;
      return routeMatchesSearch(r, search, searchContext, routeBlobs);
    });
  }, [routes, focusedId, filter, search, searchContext, routeBlobs]);
  const positions = useMemo(
    () => (focusedId ? focusPositions(generations, focusedId) : circlePositions(generations)),
    [focusedId, generations],
  );
  useEffect(() => {
    if (!search.trim() || !selectedRouteId) return;
    if (!filteredRoutes.some((route) => route.id === selectedRouteId)) setSelectedRouteId('');
  }, [search, selectedRouteId, filteredRoutes]);
  useEffect(() => {
    if (query.route) {
      const route = routes.find((r) => r.id === query.route);
      if (route) setSelectedRouteId(route.id);
    }
  }, [query.route]);
  useEffect(() => {
    if (query.gen) setFocusedId(query.gen);
  }, [query.gen]);
  function selectRoute(route) {
    if (!route) return;
    setSelectedRouteId(route.id);
  }
  function clearRoute() {
    setSelectedRouteId('');
  }
  function focus(id) {
    setFocusedId(id);
    setSelectedRouteId('');
  }
  function clearFocus() {
    setFocusedId('');
    setSelectedRouteId('');
  }
  return (
    <main>
      <PageTitle eyebrow="Compatibility Ontology" title="Transfer routes between generations">
        Each generation pair has two parallel arrows, one per direction. Click an arrow to inspect that route in the side panel. Click a generation circle to focus that era&apos;s game library.
      </PageTitle>
      <section className="ontology-toolbar">
        <div className="segmented" role="group" aria-label="Route status filters">
          {['all', 'red', 'yellow', 'blue', 'green', 'gray'].map((value) => (
            <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
              {value === 'all' ? 'All routes' : statuses[value]?.label}
            </button>
          ))}
        </div>
        <div className="search-box-group">
          <label className="search-box">
            <span>Search</span>
            <div className="search-box-field">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="game, route, bug ID…" />
              {search && <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="Clear search">×</button>}
            </div>
          </label>
          <button type="button" className="search-help-trigger" onClick={() => setSearchHelpOpen(true)} aria-label="How route search works">?</button>
        </div>
        <SearchHelpModal open={searchHelpOpen} onClose={() => setSearchHelpOpen(false)} />
      </section>
      <section className="ontology-layout">
        <div className="ontology-main-card">
          <OntologyGraph
            generations={generations}
            routes={filteredRoutes}
            statuses={statuses}
            positions={positions}
            selectedRoute={selectedRoute}
            focusedId={focusedId}
            onFocus={focus}
            onClearRoute={clearRoute}
            onClearFocus={clearFocus}
            filter="all"
            onSelectRoute={selectRoute}
          />
          <RouteList routes={filteredRoutes.slice(0, 60)} statuses={statuses} selectedRoute={selectedRoute} generations={generations} onSelectRoute={selectRoute} />
        </div>
        <OntologyPanel
          generations={generations}
          games={games}
          routes={routes}
          statuses={statuses}
          focusedId={focusedId}
          selectedRoute={selectedRoute}
          onSelectRoute={selectRoute}
        />
      </section>
    </main>
  );
}
