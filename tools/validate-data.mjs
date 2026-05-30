import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const dataRoot = join(root, 'public/data');
const load = async (file) => JSON.parse(await readFile(join(dataRoot, file), 'utf8'));
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const unique = (items, label) => {
  const seen = new Set();
  for (const item of items) {
    assert(item.id, `${label} is missing id`);
    assert(!seen.has(item.id), `Duplicate ${label} id: ${item.id}`);
    seen.add(item.id);
  }
  return seen;
};

try {
  const [site, homepage, theme, research, compatibility, features, bugs, gallery, models, characters, roadmap, ideas] = await Promise.all([
    'site.json','homepage.json','theme.json','research-pois.json','compatibility.json','features.json','bugs.json','gallery.json','models.json','characters.json','roadmap.json','ideas.json'
  ].map(load));

  assert(site.projectName && site.logo, 'site.json requires projectName and logo');
  assert(Array.isArray(site.legalFull) && site.legalFull.length >= 4, 'site.json legalFull needs the full legal notice');
  assert(homepage.hero?.headline && homepage.navCards?.length, 'homepage.json needs hero and navCards');
  assert(theme.motion, 'theme.json requires motion');

  const genIds = unique(compatibility.generations || [], 'generation');
  unique(compatibility.games || [], 'game');
  for (const game of compatibility.games) {
    assert(genIds.has(game.generation), `Game ${game.id} points to unknown generation ${game.generation}`);
    assert(game.boxArt, `Game ${game.id} needs a boxArt path`);
  }
  const routeIds = unique(compatibility.routes || [], 'route');
  for (const route of compatibility.routes) {
    assert(genIds.has(route.from), `Route ${route.id} has unknown from ${route.from}`);
    assert(genIds.has(route.to), `Route ${route.id} has unknown to ${route.to}`);
    assert(compatibility.statuses[route.status], `Route ${route.id} has unknown status ${route.status}`);
    assert(Array.isArray(route.tests), `Route ${route.id} requires tests`);
  }
  for (const from of genIds) for (const to of genIds) assert(routeIds.has(`${from}-${to}`), `Missing route ${from}-${to}`);

  const featureIds = unique(features.features || [], 'feature');
  assert(Array.isArray(features.stages) && features.stages.length, 'features.json requires stages');
  for (const feature of features.features) {
    assert(features.stages.includes(feature.stage), `Feature ${feature.id} uses unknown stage ${feature.stage}`);
    assert(Number.isFinite(Number(feature.progress)) && feature.progress >= 0 && feature.progress <= 100, `Feature ${feature.id} progress must be 0–100`);
    assert(Array.isArray(feature.tasks), `Feature ${feature.id} requires tasks`);
    for (const route of feature.linkedRoutes || []) assert(routeIds.has(route), `Feature ${feature.id} links to unknown route ${route}`);
    if (feature.images) {
      assert(Array.isArray(feature.images), `Feature ${feature.id} images must be an array`);
      for (const image of feature.images) {
        const path = typeof image === 'string' ? image : image?.path;
        assert(path, `Feature ${feature.id} image entry needs a path`);
      }
    }
    if (feature.dossier) {
      assert(typeof feature.dossier === 'object', `Feature ${feature.id} dossier must be an object`);
      for (const section of feature.dossier.sections || []) {
        for (const block of section.blocks || []) {
          const type = block?.type;
          assert(type, `Feature ${feature.id} dossier block needs a type`);
          if (type === 'image' || type === 'video') assert(block.path, `Feature ${feature.id} ${type} block needs path`);
          if (type === 'compare') assert((block.items || []).length >= 2, `Feature ${feature.id} compare block needs 2+ items`);
          if (type === 'carousel') assert((block.images || []).length >= 2, `Feature ${feature.id} carousel block needs 2+ images`);
          if (type === 'gallery') assert((block.images || []).length, `Feature ${feature.id} gallery block needs images`);
        }
      }
    }
  }

  const bugIds = unique(bugs.bugs || [], 'bug');
  assert(Array.isArray(bugs.statuses), 'bugs.json requires statuses');
  assert(Array.isArray(bugs.severities), 'bugs.json requires severities');
  for (const bug of bugs.bugs) {
    assert(bugs.statuses.includes(bug.status), `Bug ${bug.id} uses unknown status ${bug.status}`);
    assert(bugs.severities.includes(bug.severity), `Bug ${bug.id} uses unknown severity ${bug.severity}`);
    if (bug.linkedFeature) assert(featureIds.has(bug.linkedFeature), `Bug ${bug.id} links to unknown feature ${bug.linkedFeature}`);
    for (const route of bug.linkedRoutes || []) assert(routeIds.has(route), `Bug ${bug.id} links to unknown route ${route}`);
    assert(Array.isArray(bug.checklist), `Bug ${bug.id} requires checklist`);
    if (bug.images) {
      assert(Array.isArray(bug.images), `Bug ${bug.id} images must be an array`);
      for (const image of bug.images) {
        const path = typeof image === 'string' ? image : image?.path;
        assert(path, `Bug ${bug.id} image entry needs a path`);
      }
    }
  }

  const poiIds = unique(research.pois || [], 'POI');
  for (const feature of features.features) {
    if (feature.dossier?.map?.poiId) assert(poiIds.has(feature.dossier.map.poiId), `Feature ${feature.id} dossier map links to unknown POI ${feature.dossier.map.poiId}`);
  }
  for (const poi of research.pois) {
    assert(Array.isArray(poi.position) && poi.position.length === 3, `POI ${poi.id} position must be [x,y,z]`);
    assert(Array.isArray(poi.assetNeeds), `POI ${poi.id} assetNeeds must be an array`);
    for (const id of poi.linkedFeatures || []) assert(featureIds.has(id), `POI ${poi.id} links to unknown feature ${id}`);
    for (const id of poi.relatedBugs || []) assert(bugIds.has(id), `POI ${poi.id} links to unknown bug ${id}`);
  }

  unique(gallery.items || [], 'gallery item');
  for (const item of gallery.items || []) {
    assert(item.title && item.src, `Gallery item ${item.id} needs title and src`);
  }

  assert(models.mainModel?.file, 'models.json requires mainModel.file');
  unique(models.submodels || [], 'submodel');
  for (const model of models.submodels || []) {
    if (model.relatedPoi) assert(poiIds.has(model.relatedPoi), `Model ${model.id} links to unknown POI ${model.relatedPoi}`);
  }

  unique(characters.seriesCharacters || [], 'series character');
  unique(characters.plannedVisitors || [], 'planned visitor');
  assert(Array.isArray(characters.spriteRequirements), 'characters.json requires spriteRequirements');

  const roadmapItems = Array.isArray(roadmap.milestones) ? roadmap.milestones : (roadmap.horizons || []).flatMap((horizon) => horizon.items || []);
  assert(Array.isArray(roadmapItems), 'roadmap.json requires milestones or horizons');
  const milestoneIds = unique(roadmapItems.map((item, index) => ({ ...item, id: item.id || `roadmap-${index}` })), 'roadmap milestone');
  if (roadmap.currentMilestoneId) assert(milestoneIds.has(roadmap.currentMilestoneId), `currentMilestoneId points to unknown milestone ${roadmap.currentMilestoneId}`);
  unique(ideas.items || [], 'idea');

  console.log('Data validation passed.');
} catch (error) {
  console.error(`Data validation failed: ${error.message}`);
  process.exit(1);
}
