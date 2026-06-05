import { normalizeFeatureDossier, collectDossierGalleryImages } from './featureDossier.js';
import { normalizeImages } from './images.js';
import { routeHref } from './data.js';

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return Math.abs(h);
}

function dailySeed() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateScore(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  const daysSince = (Date.now() - t) / 86_400_000;
  return Math.max(0, 0.35 - daysSince / 400);
}

function listPositionScore(index, total, { newestFirst = false } = {}) {
  if (total <= 1) return 0.2;
  const ratio = index / (total - 1);
  const rank = newestFirst ? 1 - ratio : ratio;
  return 0.08 + rank * 0.28;
}

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
    score: candidate.score || 0,
  });
}

function collectSpotlightCandidates(data) {
  const candidates = [];

  const pins = data.atlasPins?.pins || [];
  pins.forEach((pin, index) => {
    const image = firstImageFromRecord(pin);
    pushCandidate(candidates, {
      id: `pin:${pin.id}`,
      eyebrow: 'Pinned on the map',
      title: pin.name,
      summary: pin.summary || normalizeFeatureDossier(pin).overview,
      href: routeHref('/atlas', { pin: pin.id }),
      cta: 'Open on the atlas',
      image,
      score: listPositionScore(index, pins.length, { newestFirst: true }) + (image ? 0.22 : 0.08),
    });
  });

  const research = data.research?.entries || [];
  research.forEach((entry, index) => {
    const image = firstImageFromRecord(entry);
    pushCandidate(candidates, {
      id: `research:${entry.id}`,
      eyebrow: entry.category || 'Research note',
      title: entry.title,
      summary: entry.summary,
      href: routeHref('/research', { entry: entry.id }),
      cta: 'Read the note',
      image,
      score: listPositionScore(index, research.length) + dateScore(entry.updatedAt) + (image ? 0.18 : 0.05),
    });
  });

  const features = data.features?.features || [];
  features.forEach((feature, index) => {
    const image = firstImageFromRecord(feature);
    const onFlight = ['On-Flight', 'Testing'].includes(feature.stage) ? 0.08 : 0;
    pushCandidate(candidates, {
      id: `feature:${feature.id}`,
      eyebrow: feature.stage || 'Workshop',
      title: feature.title,
      summary: feature.summary || normalizeFeatureDossier(feature).overview,
      href: routeHref('/board'),
      cta: 'See the feature',
      image,
      score: listPositionScore(index, features.length) + onFlight + (image ? 0.16 : 0.04),
    });
  });

  const ideas = data.ideas?.items || [];
  ideas.forEach((idea, index) => {
    pushCandidate(candidates, {
      id: `idea:${idea.id}`,
      eyebrow: 'Spark board',
      title: idea.title,
      summary: idea.summary,
      href: routeHref('/plan'),
      cta: 'View the idea',
      image: null,
      score: listPositionScore(index, ideas.length) + 0.06,
    });
  });

  const milestones = data.roadmap?.milestones || [];
  milestones.forEach((item, index) => {
    const isCurrent = item.id === data.roadmap?.currentMilestoneId || item.status === 'current';
    pushCandidate(candidates, {
      id: `milestone:${item.id}`,
      eyebrow: isCurrent ? 'Current milestone' : 'On the timeline',
      title: item.title,
      summary: item.summary,
      href: routeHref('/milestones'),
      cta: 'Follow the arc',
      image: firstImageFromRecord(item),
      score: listPositionScore(index, milestones.length) + (isCurrent ? 0.2 : 0.05),
    });
  });

  const docs = data.docs?.articles || [];
  docs.forEach((article, index) => {
    const image = article.heroImage?.path || article.coverImage?.path || firstImageFromRecord(article);
    pushCandidate(candidates, {
      id: `doc:${article.slug || article.id}`,
      eyebrow: 'From the docs desk',
      title: article.title,
      summary: article.summary,
      href: routeHref('/docs', { article: article.slug }),
      cta: 'Open the article',
      image,
      score: listPositionScore(index, docs.length) + dateScore(article.updatedAt) + (image ? 0.12 : 0.03),
    });
  });

  return candidates;
}

function pickWeightedDaily(pool) {
  if (!pool.length) return null;
  const seed = hashString(`resort-spotlight:${dailySeed()}`);
  const totalWeight = pool.reduce((sum, item) => sum + item.score + 0.12, 0);
  let cursor = (seed % 10_000) / 10_000 * totalWeight;
  for (const item of pool) {
    cursor -= item.score + 0.12;
    if (cursor <= 0) return item;
  }
  return pool[pool.length - 1];
}

/** One bulletin-style highlight for the homepage — stable for the day, biased toward recent + visual items. */
export function pickResortSpotlight(data) {
  const candidates = collectSpotlightCandidates(data);
  if (!candidates.length) return null;

  candidates.sort((a, b) => b.score - a.score);
  const pool = candidates.slice(0, Math.min(10, candidates.length));
  const featured = pickWeightedDaily(pool);

  const alternates = pool
    .filter((item) => item.id !== featured?.id)
    .slice(0, 2);

  return featured ? { featured, alternates } : null;
}
