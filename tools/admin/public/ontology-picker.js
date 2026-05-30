const WIDTH = 1040;
const HEIGHT = 520;
const VIEW_PAD = 70;
const VIEW_BOX = `${-VIEW_PAD} ${-VIEW_PAD} ${WIDTH + VIEW_PAD * 2} ${HEIGHT + VIEW_PAD * 2}`;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const NODE_R = 42;
const ROUTE_LANE_GAP = 2.5;
const ARROW_SIZE = 6;

function statusClass(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '-');
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

function circlePositions(generations) {
  return Object.fromEntries(generations.map((gen, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / generations.length;
    return [gen.id, { x: CENTER.x + Math.cos(angle) * 220, y: CENTER.y + Math.sin(angle) * 220 }];
  }));
}

function selfLoopPath(p) {
  let ux = p.x - CENTER.x;
  let uy = p.y - CENTER.y;
  const distance = Math.hypot(ux, uy);
  if (distance < 8) { ux = 0; uy = -1; } else { ux /= distance; uy /= distance; }
  const nx = -uy;
  const ny = ux;
  const start = { x: p.x + nx * 28 + ux * 36, y: p.y + ny * 28 + uy * 36 };
  const end = { x: p.x - nx * 28 + ux * 36, y: p.y - ny * 28 + uy * 36 };
  const c1 = { x: p.x + nx * 100 + ux * 120, y: p.y + ny * 100 + uy * 120 };
  const c2 = { x: p.x - nx * 100 + ux * 120, y: p.y - ny * 100 + uy * 120 };
  const line = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}, ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  const endDir = unitVector(end.x - c2.x, end.y - c2.y);
  return { line, arrow: arrowHeadPath(end, endDir) };
}

function straightRoutePath(fromPos, toPos, route) {
  if (!fromPos || !toPos) return { line: '', arrow: '' };
  if (route.from === route.to) return selfLoopPath(fromPos);
  const travel = unitVector(toPos.x - fromPos.x, toPos.y - fromPos.y);
  const lowPos = route.from < route.to ? fromPos : toPos;
  const highPos = route.from < route.to ? toPos : fromPos;
  const pair = (() => {
    const { ux, uy } = unitVector(highPos.x - lowPos.x, highPos.y - lowPos.y);
    return { nx: -uy, ny: ux };
  })();
  const lane = route.from < route.to ? ROUTE_LANE_GAP : -ROUTE_LANE_GAP;
  const fromR = NODE_R + 4;
  const toR = NODE_R + 10;
  const start = { x: fromPos.x + travel.ux * fromR + pair.nx * lane, y: fromPos.y + travel.uy * fromR + pair.ny * lane };
  const end = { x: toPos.x - travel.ux * toR + pair.nx * lane, y: toPos.y - travel.uy * toR + pair.ny * lane };
  const line = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  return { line, arrow: arrowHeadPath(end, travel) };
}

function routeLegLabel(route, generations) {
  const from = generations.find((g) => g.id === route.from)?.shortLabel || route.from;
  const to = generations.find((g) => g.id === route.to)?.shortLabel || route.to;
  if (route.from === route.to) return `${from} → Resort`;
  return `${from} → ${to}`;
}

export function renderCompatGraphHtml(data, selectedRouteId) {
  const { generations, routes, statuses } = data;
  const positions = circlePositions(generations);
  const routePaths = routes.map((route) => {
    const { line, arrow } = straightRoutePath(positions[route.from], positions[route.to], route);
    return { route, line, arrow, hit: `${line} ${arrow}`.trim() };
  });

  const routeMarkup = routePaths.map(({ route, line, hit, arrow }) => {
    const active = selectedRouteId === route.id;
    const cls = statusClass(route.status);
    const label = statuses[route.status]?.label || route.status;
    return `<g class="route-group ${cls}${active ? ' active' : ''}" data-route-id="${route.id}">
      <path class="route-hit-area" d="${hit}" tabindex="0" role="button" aria-label="${route.id}: ${label}" />
      <path class="route-line route-line-body ${cls}${active ? ' active' : ''}" d="${line}" />
      ${arrow ? `<path class="route-line route-arrow-head ${cls}${active ? ' active' : ''}" d="${arrow}" />` : ''}
    </g>`;
  }).join('');

  const nodeMarkup = generations.map((gen) => {
    const p = positions[gen.id] || CENTER;
    return `<g class="generation-node" transform="translate(${p.x}, ${p.y})" pointer-events="none">
      <circle class="node-aura" r="52" fill="${gen.accent}" opacity=".12" />
      <circle r="42" fill="${gen.accent}" />
      <circle r="34" fill="rgba(255,255,255,.22)" stroke="rgba(255,255,255,.72)" stroke-width="2" />
      <text y="-3" text-anchor="middle" class="node-title">${gen.shortLabel}</text>
    </g>`;
  }).join('');

  return `<svg viewBox="${VIEW_BOX}" class="admin-ontology-graph" role="img" aria-label="Route picker graph">
    <rect class="graph-surface" x="${-VIEW_PAD}" y="${-VIEW_PAD}" width="${WIDTH + VIEW_PAD * 2}" height="${HEIGHT + VIEW_PAD * 2}" fill="transparent" />
    <g class="routes-layer">${routeMarkup}</g>
    <g class="nodes-layer">${nodeMarkup}</g>
  </svg>`;
}

export function bindCompatGraph(host, data, { onSelectRoute }) {
  if (!host) return;
  const byId = new Map(data.routes.map((route) => [route.id, route]));
  host.querySelectorAll('.route-hit-area').forEach((path) => {
    const group = path.closest('[data-route-id]');
    const route = byId.get(group?.dataset.routeId);
    if (!route) return;
    const activate = () => onSelectRoute(route);
    path.addEventListener('click', (event) => {
      event.stopPropagation();
      activate();
    });
    path.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  });
}
