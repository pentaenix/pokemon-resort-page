const SAFE_SEGMENT = /^[a-z0-9-]+$/;

/** Relative path from public/ideas/articles/ to the idea JSON file. Default: {slug}.json */
export function ideaArticleRelativePath(idea) {
  if (!idea || typeof idea !== 'object') return null;
  const slug = String(idea.slug || idea.id || '').trim();
  if (!slug || !SAFE_SEGMENT.test(slug)) return null;
  return `${slug}.json`;
}
