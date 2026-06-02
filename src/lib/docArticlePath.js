const SAFE_SEGMENT = /^[a-z0-9-]+$/;
const SAFE_REL_PATH = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.json$/;

/** Category folders under public/docs/articles/ — must match docs.json categories[].id */
export const DOC_ARTICLE_CATEGORY_IDS = ['meta', 'formats', 'gameplay', 'design', 'apps'];

/**
 * Relative path from public/docs/articles/ to the article JSON file.
 * Default: {category}/{slug}.json
 * Override: optional card.path for nested topics, e.g. gameplay/overworld/follower-ai.json
 */
export function docArticleRelativePath(article) {
  if (!article || typeof article !== 'object') return null;

  if (article.path) {
    const normalized = String(article.path).replace(/^\/+/, '').replace(/\\/g, '/');
    if (!SAFE_REL_PATH.test(normalized)) {
      throw new Error(`Invalid docs article path "${article.path}"`);
    }
    return normalized;
  }

  const category = String(article.category || '').trim();
  const slug = String(article.slug || '').trim();
  if (!category || !slug) return null;
  if (!SAFE_SEGMENT.test(category) || !SAFE_SEGMENT.test(slug)) return null;
  return `${category}/${slug}.json`;
}

export function docArticlePublicUrl(article, base = './') {
  const rel = docArticleRelativePath(article);
  if (!rel) return null;
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}docs/articles/${rel}`;
}
