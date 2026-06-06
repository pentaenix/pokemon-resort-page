import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { docArticleRelativePath } from './docs/article-path.mjs';
import { ideaArticleRelativePath } from './ideas/article-path.mjs';
import {
  assertUiCopyClean,
  lintAtlasPinBlurbs,
  lintCompatibilityBlurbs,
  lintDocsHubBlurbs,
  lintFeatureSummaries,
  lintHomepage,
  lintIdeas,
  lintJsxUiFiles,
  lintResearchSummaries,
  lintRoadmapSummaries,
  lintSiteChrome,
  resetUiCopyLint,
} from './ui-copy-lint.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const dataRoot = join(root, 'public/data');
const docsArticlesRoot = join(root, 'public/docs/articles');
const ideasArticlesRoot = join(root, 'public/ideas/articles');
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
  const [site, homepage, theme, research, atlasPins, compatibility, features, bugs, gallery, models, characters, roadmap, ideas, docs] = await Promise.all([
    'site.json','homepage.json','theme.json','research.json','atlas-pins.json','compatibility.json','features.json','bugs.json','gallery.json','models.json','characters.json','roadmap.json','ideas.json','docs.json'
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
          if (type === 'figure') {
            assert(block.path, `Feature ${feature.id} figure block needs path`);
            assert(block.body || block.caption, `Feature ${feature.id} figure block needs body or caption`);
          }
          if (type === 'html') assert(block.html, `Feature ${feature.id} html block needs html`);
          if (type === 'diagram') assert(block.source, `Feature ${feature.id} diagram block needs source`);
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

  const pinIds = unique(atlasPins.pins || [], 'atlas pin');
  const pinColorIds = new Set((atlasPins.pinColors || []).map((c) => c.id));
  const researchIds = unique(research.entries || [], 'research entry');
  const researchCategories = new Set(research.categories || []);
  for (const feature of features.features) {
    const mapPin = feature.dossier?.map?.pinId || feature.dossier?.map?.poiId;
    if (mapPin) assert(pinIds.has(mapPin), `Feature ${feature.id} dossier map links to unknown atlas pin ${mapPin}`);
  }
  function assertDossierBlocks(ownerLabel, dossier) {
    if (!dossier) return;
    assert(typeof dossier === 'object', `${ownerLabel} dossier must be an object`);
    function walkBlocks(blocks) {
      for (const block of blocks || []) {
        const type = block?.type;
        assert(type, `${ownerLabel} dossier block needs a type`);
        if (type === 'image' || type === 'video') assert(block.path, `${ownerLabel} ${type} block needs path`);
        if (type === 'compare') assert((block.items || []).length >= 2, `${ownerLabel} compare block needs 2+ items`);
        if (type === 'carousel') assert((block.images || []).length >= 2, `${ownerLabel} carousel block needs 2+ images`);
        if (type === 'gallery') assert((block.images || []).length, `${ownerLabel} gallery block needs images`);
        if (type === 'figure') {
          assert(block.path, `${ownerLabel} figure block needs path`);
          assert(block.body || block.caption, `${ownerLabel} figure block needs body or caption`);
        }
        if (type === 'html') assert(block.html, `${ownerLabel} html block needs html`);
        if (type === 'diagram') assert(block.source, `${ownerLabel} diagram block needs source`);
        if (type === 'code') {
          assert(block.repo, `${ownerLabel} code block needs repo`);
          assert(block.path, `${ownerLabel} code block needs path`);
          assert(block.body, `${ownerLabel} code block needs body`);
        }
        if (type === 'tabs') {
          assert((block.tabs || []).length >= 2, `${ownerLabel} tabs block needs 2+ tabs`);
          for (const tab of block.tabs || []) {
            assert(tab.label, `${ownerLabel} tabs entry needs label`);
            assert((tab.blocks || []).length, `${ownerLabel} tab "${tab.label || tab.id}" needs blocks`);
            walkBlocks(tab.blocks);
          }
        }
      }
    }
    for (const section of dossier.sections || []) {
      walkBlocks(section.blocks);
    }
  }

  assert(atlasPins.map?.layers?.terrain, 'atlas-pins.json requires map.layers.terrain');

  for (const pin of atlasPins.pins || []) {
    assert(typeof pin.x === 'number' && pin.x >= 0 && pin.x <= 1, `Atlas pin ${pin.id} x must be 0–1`);
    assert(typeof pin.y === 'number' && pin.y >= 0 && pin.y <= 1, `Atlas pin ${pin.id} y must be 0–1`);
    assert(pinColorIds.has(pin.color), `Atlas pin ${pin.id} uses unknown color ${pin.color}`);
    assert(pin.summary, `Atlas pin ${pin.id} needs summary`);
    for (const id of pin.linkedFeatures || []) assert(featureIds.has(id), `Atlas pin ${pin.id} links to unknown feature ${id}`);
    for (const id of pin.linkedResearch || []) assert(researchIds.has(id), `Atlas pin ${pin.id} links to unknown research ${id}`);
    assertDossierBlocks(`Atlas pin ${pin.id}`, pin.dossier);
  }

  for (const entry of research.entries || []) {
    assert(entry.title, `Research entry ${entry.id} needs title`);
    assert(entry.category, `Research entry ${entry.id} needs category`);
    if (researchCategories.size) assert(researchCategories.has(entry.category), `Research entry ${entry.id} uses unknown category ${entry.category}`);
    assert(Array.isArray(entry.tags), `Research entry ${entry.id} tags must be an array`);
    const linkedPins = entry.linkedPins || entry.linkedPois || [];
    assert(Array.isArray(linkedPins), `Research entry ${entry.id} linkedPins must be an array`);
    for (const id of linkedPins) assert(pinIds.has(id), `Research entry ${entry.id} links to unknown atlas pin ${id}`);
    for (const id of entry.linkedFeatures || []) assert(featureIds.has(id), `Research entry ${entry.id} links to unknown feature ${id}`);
    for (const id of entry.relatedBugs || []) assert(bugIds.has(id), `Research entry ${entry.id} links to unknown bug ${id}`);
    assertDossierBlocks(`Research entry ${entry.id}`, entry.dossier);
  }

  unique(gallery.items || [], 'gallery item');
  for (const item of gallery.items || []) {
    assert(item.title && item.src, `Gallery item ${item.id} needs title and src`);
  }

  assert(models.mainModel?.file, 'models.json requires mainModel.file');
  unique(models.submodels || [], 'submodel');
  for (const model of models.submodels || []) {
    if (model.relatedPin || model.relatedPoi) {
      const pinRef = model.relatedPin || model.relatedPoi;
      assert(pinIds.has(pinRef), `Model ${model.id} links to unknown atlas pin ${pinRef}`);
    }
  }

  unique(characters.seriesCharacters || [], 'series character');
  unique(characters.plannedVisitors || [], 'planned visitor');
  assert(Array.isArray(characters.spriteRequirements), 'characters.json requires spriteRequirements');

  const roadmapItems = Array.isArray(roadmap.milestones) ? roadmap.milestones : (roadmap.horizons || []).flatMap((horizon) => horizon.items || []);
  assert(Array.isArray(roadmapItems), 'roadmap.json requires milestones or horizons');
  const milestoneIds = unique(roadmapItems.map((item, index) => ({ ...item, id: item.id || `roadmap-${index}` })), 'roadmap milestone');
  if (roadmap.currentMilestoneId) assert(milestoneIds.has(roadmap.currentMilestoneId), `currentMilestoneId points to unknown milestone ${roadmap.currentMilestoneId}`);
  const ideaSlugs = unique((ideas.items || []).map((item) => ({ ...item, id: item.slug || item.id })), 'idea');
  for (const idea of ideas.items || []) {
    assert(idea.slug || idea.id, `Idea ${idea.id || '(missing id)'} needs slug`);
    assert(idea.title, `Idea ${idea.id} needs title`);
    assert(idea.summary, `Idea ${idea.id} needs summary`);
    const rel = ideaArticleRelativePath(idea);
    assert(rel, `Idea ${idea.id} could not resolve storage path`);
    assert(rel === `${idea.slug || idea.id}.json`, `Idea ${idea.id} must live at public/ideas/articles/${idea.slug || idea.id}.json`);
    const articlePath = join(ideasArticlesRoot, rel);
    assert(existsSync(articlePath), `Idea ${idea.id} missing file public/ideas/articles/${rel}`);
    const body = JSON.parse(await readFile(articlePath, 'utf8'));
    assertDossierBlocks(`Idea ${idea.id}`, body.dossier);
  }
  for (const item of roadmapItems) assertDossierBlocks(`Milestone ${item.id}`, item.dossier);

  const docCategoryIds = new Set((docs.categories || []).map((c) => c.id));
  unique(docs.categories || [], 'docs category');
  const docSlugs = unique(docs.articles || [], 'docs article');
  for (const article of docs.articles || []) {
    assert(article.slug, `Docs article ${article.id} needs slug`);
    assert(article.title, `Docs article ${article.id} needs title`);
    assert(article.summary, `Docs article ${article.id} needs summary`);
    assert(docCategoryIds.has(article.category), `Docs article ${article.id} uses unknown category ${article.category}`);
    const rel = docArticleRelativePath(article);
    assert(rel, `Docs article ${article.id} could not resolve storage path`);
    if (!article.path) {
      assert(
        rel === `${article.category}/${article.slug}.json`,
        `Docs article ${article.id} must live at public/docs/articles/${article.category}/${article.slug}.json (or set an explicit path)`,
      );
    }
    const articlePath = join(docsArticlesRoot, rel);
    assert(existsSync(articlePath), `Docs article ${article.id} missing file public/docs/articles/${rel}`);
    const body = JSON.parse(await readFile(articlePath, 'utf8'));
    assertDossierBlocks(`Docs article ${article.id}`, body.dossier);
  }

  resetUiCopyLint();
  lintHomepage(homepage);
  lintIdeas(ideas);
  lintFeatureSummaries(features);
  lintResearchSummaries(research);
  lintRoadmapSummaries(roadmap);
  lintCompatibilityBlurbs(compatibility);
  lintAtlasPinBlurbs(atlasPins);
  lintDocsHubBlurbs(docs);
  lintSiteChrome(site);
  await lintJsxUiFiles(root, readFile);
  assertUiCopyClean();

  console.log('Data validation passed.');
} catch (error) {
  console.error(`Data validation failed: ${error.message}`);
  process.exit(1);
}
