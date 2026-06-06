import { assetUrl, routeHref } from './data.js';
import { ideaArticleRelativePath } from './ideaArticlePath.js';

export async function loadIdeaArticle(ideaOrSlug, manifest) {
  const base = import.meta.env.BASE_URL || './';
  const cacheBust = import.meta.env.DEV ? `?v=${Date.now()}` : '';
  const card = typeof ideaOrSlug === 'string'
    ? findIdeaArticle(manifest, ideaOrSlug)
    : ideaOrSlug;
  const rel = ideaArticleRelativePath(card);
  if (!rel) throw new Error('Missing idea path');
  const response = await fetch(`${base}ideas/articles/${rel}${cacheBust}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load ideas/articles/${rel}`);
  return response.json();
}

export function ideaArticleHref(slug) {
  return routeHref('/ideas', { idea: slug });
}

export function findIdeaArticle(manifest, slug) {
  const items = manifest?.items || [];
  return items.find((item) => item.slug === slug || item.id === slug);
}

export function ideaHeroUrl(idea) {
  const path = idea?.heroImage?.path || idea?.heroImage || idea?.image;
  if (typeof path === 'string') return assetUrl(path);
  if (path?.path) return assetUrl(path.path);
  return '';
}
