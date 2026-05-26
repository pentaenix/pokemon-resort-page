import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'public/data');
const asJson = process.argv.includes('--json');
const errors = [];
const warnings = [];

async function read(name) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, `${name}.json`), 'utf8'));
  } catch (error) {
    errors.push(`Could not parse ${name}.json: ${error.message}`);
    return null;
  }
}

function uniqueIds(items = [], label) {
  const seen = new Set();
  for (const item of items) {
    if (!item.id) errors.push(`${label} is missing an id.`);
    else if (seen.has(item.id)) errors.push(`Duplicate ${label} id: ${item.id}`);
    seen.add(item.id);
  }
}

function requireFields(item, fields, label) {
  for (const field of fields) {
    if (item[field] === undefined || item[field] === null || item[field] === '') {
      errors.push(`${label} ${item.id || item.title || item.name || ''} is missing ${field}.`);
    }
  }
}

const site = await read('site');
const homepage = await read('homepage');
const theme = await read('theme');
const atlas = await read('research-pois');
const compatibility = await read('compatibility');
const features = await read('features');
const bugs = await read('bugs');

if (site) {
  requireFields(site, ['projectName', 'tagline', 'legal'], 'site');
  if (!site.legal?.fullNotice?.includes('No donations') && !site.legal?.noDonations) {
    warnings.push('Legal copy should clearly say no donations are accepted.');
  }
}

if (homepage) {
  requireFields(homepage, ['hero', 'cards'], 'homepage');
  if (!homepage.hero?.logo) errors.push('homepage.hero.logo is required.');
}

if (theme && !theme.customProperties) warnings.push('theme.json has no customProperties object.');

if (atlas) {
  uniqueIds(atlas.pois, 'POI');
  for (const poi of atlas.pois || []) {
    requireFields(poi, ['name', 'type', 'confidence', 'position', 'summary'], 'POI');
    if (!Array.isArray(poi.position) || poi.position.length !== 3 || poi.position.some((n) => Number.isNaN(Number(n)))) {
      errors.push(`POI ${poi.id} must have a numeric [x, y, z] position.`);
    }
    if (!Array.isArray(poi.assetNeeds)) warnings.push(`POI ${poi.id} should include assetNeeds.`);
  }
}

const featureIds = new Set(features?.items?.map((item) => item.id) || []);
const bugIds = new Set(bugs?.items?.map((item) => item.id) || []);
const poiIds = new Set(atlas?.pois?.map((item) => item.id) || []);

if (features) {
  uniqueIds(features.items, 'feature');
  const stages = new Set(features.stages?.map((stage) => stage.id) || []);
  for (const feature of features.items || []) {
    requireFields(feature, ['title', 'stage', 'progress', 'tasks'], 'feature');
    if (!stages.has(feature.stage)) errors.push(`Feature ${feature.id} uses unknown stage: ${feature.stage}`);
    if (Number(feature.progress) < 0 || Number(feature.progress) > 100) errors.push(`Feature ${feature.id} progress must be 0-100.`);
    for (const bugId of feature.linkedBugs || []) if (!bugIds.has(bugId)) warnings.push(`Feature ${feature.id} links to unknown bug ${bugId}.`);
    for (const poiId of feature.linkedResearch || []) if (!poiIds.has(poiId)) warnings.push(`Feature ${feature.id} links to unknown POI ${poiId}.`);
  }
}

if (compatibility) {
  uniqueIds(compatibility.games, 'game');
  uniqueIds(compatibility.routes, 'route');
  const gameIds = new Set(compatibility.games.map((game) => game.id));
  const statuses = new Set(compatibility.legend.map((item) => item.status));
  for (const route of compatibility.routes || []) {
    requireFields(route, ['from', 'to', 'status', 'summary'], 'route');
    if (!gameIds.has(route.from)) errors.push(`Route ${route.id} points from unknown game ${route.from}.`);
    if (!gameIds.has(route.to)) errors.push(`Route ${route.id} points to unknown game ${route.to}.`);
    if (!statuses.has(route.status)) errors.push(`Route ${route.id} uses unknown status ${route.status}.`);
    for (const bugId of route.relatedBugs || []) if (!bugIds.has(bugId)) warnings.push(`Route ${route.id} links to unknown bug ${bugId}.`);
  }
}

if (bugs) {
  uniqueIds(bugs.items, 'bug');
  const statuses = new Set(bugs.statuses || []);
  const severities = new Set(bugs.severities || []);
  for (const bug of bugs.items || []) {
    requireFields(bug, ['title', 'status', 'severity', 'area', 'summary', 'checklist'], 'bug');
    if (!statuses.has(bug.status)) errors.push(`Bug ${bug.id} uses unknown status ${bug.status}.`);
    if (!severities.has(bug.severity)) errors.push(`Bug ${bug.id} uses unknown severity ${bug.severity}.`);
    if (bug.linkedFeature && !featureIds.has(bug.linkedFeature)) warnings.push(`Bug ${bug.id} links to unknown feature ${bug.linkedFeature}.`);
  }
}

const result = { ok: errors.length === 0, errors, warnings };
if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (errors.length) {
    console.error('Data validation failed:');
    errors.forEach((error) => console.error(`- ${error}`));
  }
  if (warnings.length) {
    console.warn('Warnings:');
    warnings.forEach((warning) => console.warn(`- ${warning}`));
  }
  if (!errors.length) console.log('Data validation passed.');
}
process.exit(errors.length ? 1 : 0);
