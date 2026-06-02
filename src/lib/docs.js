import { assetUrl } from './data.js';
import { docArticleRelativePath } from './docArticlePath.js';

export async function loadDocArticle(articleOrSlug, manifest) {
  const base = import.meta.env.BASE_URL || './';
  const cacheBust = import.meta.env.DEV ? `?v=${Date.now()}` : '';
  const card = typeof articleOrSlug === 'string'
    ? findDocArticle(manifest, articleOrSlug)
    : articleOrSlug;
  const rel = docArticleRelativePath(card);
  if (!rel) throw new Error('Missing article path');
  const response = await fetch(`${base}docs/articles/${rel}${cacheBust}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load docs/articles/${rel}`);
  return response.json();
}

export function docArticleHref(slug) {
  const params = new URLSearchParams({ article: slug });
  return `#/docs?${params.toString()}`;
}

export function findDocArticle(manifest, slug) {
  const articles = manifest?.articles || [];
  return articles.find((a) => a.slug === slug || a.id === slug);
}

export function docHeroUrl(article) {
  const path = article?.heroImage?.path || article?.heroImage;
  if (typeof path === 'string') return assetUrl(path);
  if (path?.path) return assetUrl(path.path);
  return '';
}
