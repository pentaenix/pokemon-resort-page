const STATUS_LABELS = {
  current: 'Up to date',
  stale: 'May be outdated',
  unknown: 'Not verified',
};

export async function loadDocsFreshness() {
  const base = import.meta.env.BASE_URL || './';
  const cacheBust = import.meta.env.DEV ? `?v=${Date.now()}` : '';
  try {
    const response = await fetch(`${base}data/docs-freshness.json${cacheBust}`, { cache: 'no-store' });
    if (!response.ok) return { computedAt: null, articles: {} };
    return response.json();
  } catch {
    return { computedAt: null, articles: {} };
  }
}

export function getArticleFreshness(freshness, slug) {
  return freshness?.articles?.[slug] || null;
}

export function freshnessLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.unknown;
}

/** Split dossier: primary tabs section renders under the article title. */
export function splitDocsDossier(dossier) {
  const sections = dossier?.sections || [];
  const primaryIndex = sections.findIndex(
    (section) => section.layout === 'tabs-primary'
      || (section.blocks?.length === 1 && section.blocks[0]?.type === 'tabs'),
  );
  if (primaryIndex < 0) {
    return { primarySection: null, bodyDossier: dossier };
  }
  const primarySection = sections[primaryIndex];
  return {
    primarySection,
    bodyDossier: {
      ...dossier,
      sections: sections.filter((_, index) => index !== primaryIndex),
    },
  };
}

export function mergeArticleApps(card, freshnessEntry, appCatalog) {
  const ids = new Set([...(card.apps || []), ...(freshnessEntry?.apps || [])]);
  return [...ids]
    .map((id) => appCatalog.find((a) => a.id === id))
    .filter(Boolean);
}
