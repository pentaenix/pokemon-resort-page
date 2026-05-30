export function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((item) => {
      if (typeof item === 'string') return { path: item.trim(), caption: '' };
      return {
        path: String(item?.path || '').trim(),
        caption: String(item?.caption || '').trim(),
      };
    })
    .filter((item) => item.path);
}
