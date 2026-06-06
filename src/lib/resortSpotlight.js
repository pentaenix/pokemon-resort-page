import { normalizeFeatureDossier, collectDossierGalleryImages } from './featureDossier.js';
import { normalizeImages } from './images.js';
import { routeHref } from './data.js';
import { ideaArticleHref } from './ideas.js';

function firstImageFromDossier(rawDossier) {
  const dossier = normalizeFeatureDossier({ dossier: rawDossier });
  const fromGallery = collectDossierGalleryImages(dossier);
  if (fromGallery[0]?.path) return fromGallery[0].path;
  return null;
}

function firstImageFromRecord(record) {
  const top = normalizeImages(record?.images);
  if (top[0]?.path) return top[0].path;
  const evidence = record?.evidence || [];
  for (const item of evidence) {
    const path = typeof item === 'string' ? item : (item?.path || item?.image || item?.src);
    if (path) return String(path).trim();
  }
  return firstImageFromDossier(record?.dossier);
}

function pushCandidate(list, candidate) {
  const summary = String(candidate.summary || '').trim();
  const title = String(candidate.title || '').trim();
  if (!title || !summary) return;
  list.push({
    ...candidate,
    title,
    summary: summary.length > 220 ? `${summary.slice(0, 217)}…` : summary,
  });
}

function collectSpotlightCandidates(data) {
  const candidates = [];

  const pins = data.atlasPins?.pins || [];
  pins.forEach((pin) => {
    pushCandidate(candidates, {
      id: `pin:${pin.id}`,
      eyebrow: 'Pinned on the map',
      title: pin.name,
      summary: pin.summary || normalizeFeatureDossier(pin).overview,
      href: routeHref('/atlas', { pin: pin.id }),
      cta: 'Open on the atlas',
      image: firstImageFromRecord(pin),
    });
  });

  const research = data.research?.entries || [];
  research.forEach((entry) => {
    pushCandidate(candidates, {
      id: `research:${entry.id}`,
      eyebrow: entry.category || 'Research note',
      title: entry.title,
      summary: entry.summary,
      href: routeHref('/research', { entry: entry.id }),
      cta: 'Read the note',
      image: firstImageFromRecord(entry),
    });
  });

  const features = data.features?.features || [];
  features.forEach((feature) => {
    pushCandidate(candidates, {
      id: `feature:${feature.id}`,
      eyebrow: feature.stage || 'Workshop',
      title: feature.title,
      summary: feature.summary || normalizeFeatureDossier(feature).overview,
      href: routeHref('/board'),
      cta: 'Open feature',
      image: firstImageFromRecord(feature),
    });
  });

  const ideas = data.ideas?.items || [];
  ideas.forEach((idea) => {
    pushCandidate(candidates, {
      id: `idea:${idea.id}`,
      eyebrow: 'Spark board',
      title: idea.title,
      summary: idea.summary,
      href: ideaArticleHref(idea.slug || idea.id),
      cta: 'Open idea',
      image: null,
    });
  });

  const milestones = data.roadmap?.milestones || [];
  milestones.forEach((item) => {
    const isCurrent = item.id === data.roadmap?.currentMilestoneId || item.status === 'current';
    pushCandidate(candidates, {
      id: `milestone:${item.id}`,
      eyebrow: isCurrent ? 'Current milestone' : 'On the timeline',
      title: item.title,
      summary: item.summary,
      href: routeHref('/build'),
      cta: 'Open milestone',
      image: firstImageFromRecord(item),
    });
  });

  const docs = data.docs?.articles || [];
  docs.forEach((article) => {
    pushCandidate(candidates, {
      id: `doc:${article.slug || article.id}`,
      eyebrow: 'From the docs desk',
      title: article.title,
      summary: article.summary,
      href: routeHref('/docs', { article: article.slug }),
      cta: 'Open the article',
      image: article.heroImage?.path || article.coverImage?.path || firstImageFromRecord(article),
    });
  });

  return candidates;
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** One bulletin-style highlight for the homepage — random on each visit. */
export function pickResortSpotlight(data) {
  const candidates = collectSpotlightCandidates(data);
  if (!candidates.length) return null;

  const shuffled = shuffleInPlace([...candidates]);
  const featured = shuffled[0];
  const alternates = shuffled.slice(1, 3);

  return featured ? { featured, alternates } : null;
}
