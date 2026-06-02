import React, { useEffect, useMemo, useState } from 'react';
import { EmptyState, PageTitle } from '../components/Layout.jsx';
import { RichContentBody } from '../components/RichContentBody.jsx';
import { DossierTabs } from '../components/dossier/DossierTabs.jsx';
import {
  freshnessLabel,
  getArticleFreshness,
  loadDocsFreshness,
  mergeArticleApps,
  splitDocsDossier,
} from '../lib/docCatalog.js';
import { docArticleHref, docHeroUrl, findDocArticle, loadDocArticle } from '../lib/docs.js';
import { routeHref } from '../lib/data.js';
import { recordHasRichContent } from '../lib/richContent.js';

function FreshnessBadge({ status, compact = false }) {
  if (!status || status === 'current') {
    return compact ? null : (
      <span className="doc-freshness doc-freshness--current">{freshnessLabel('current')}</span>
    );
  }
  return (
    <span className={`doc-freshness doc-freshness--${status}`}>
      {freshnessLabel(status)}
    </span>
  );
}

function DocCard({ article, categoryLabel, apps, freshnessEntry, onOpen }) {
  const hero = docHeroUrl(article);

  return (
    <article className="doc-card">
      <button type="button" className="doc-card-main" onClick={() => onOpen(article)}>
        {hero && (
          <div className="doc-card-media">
            <img src={hero} alt="" loading="lazy" />
          </div>
        )}
        <div className="doc-card-body">
          <div className="doc-card-top">
            <span className="soft-label">{categoryLabel}</span>
            {article.featured && <span className="doc-card-featured">Featured</span>}
            <FreshnessBadge status={freshnessEntry?.status} compact />
          </div>
          <h3>{article.title}</h3>
          <p>{article.summary}</p>
          {apps.length > 0 && (
            <div className="doc-card-apps">
              {apps.map((app) => (
                <span key={app.id} className="doc-app-pill">{app.shortLabel || app.label}</span>
              ))}
            </div>
          )}
          {article.tags?.length > 0 && (
            <div className="pill-row">
              {article.tags.map((tag) => (
                <span key={tag} className="soft-label">{tag}</span>
              ))}
            </div>
          )}
          <div className="doc-card-foot">
            {article.updatedAt && (
              <time className="doc-card-date" dateTime={article.updatedAt}>Updated {article.updatedAt}</time>
            )}
          </div>
        </div>
      </button>
    </article>
  );
}

function DocsPortalToolbar({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  app,
  onAppChange,
  sort,
  onSortChange,
  manifest,
  filteredCount,
  staleCount,
}) {
  const categories = manifest?.categories || [];
  const articles = manifest?.articles || [];
  const apps = manifest?.apps || [];

  return (
    <div className="docs-portal-toolbar">
      <div className="docs-portal-toolbar-row">
        <label className="docs-search docs-search--wide">
          <span className="soft-label">Search documentation</span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Formats, systems, charbin, owmap, authoring…"
          />
        </label>
        <label className="docs-sort">
          <span className="soft-label">Sort</span>
          <select value={sort} onChange={(e) => onSortChange(e.target.value)}>
            <option value="updated">Recently updated</option>
            <option value="title">Title A–Z</option>
            <option value="featured">Featured first</option>
          </select>
        </label>
      </div>

      <div className="docs-portal-stats">
        <span>{filteredCount} article{filteredCount === 1 ? '' : 's'}</span>
        {staleCount > 0 && (
          <span className="docs-portal-stale-hint">{staleCount} may need a refresh</span>
        )}
      </div>

      <div className="docs-filter-group">
        <span className="soft-label docs-filter-label">Category</span>
        <div className="docs-category-bar" role="tablist" aria-label="Filter by category">
          <button
            type="button"
            className={`chip ${category === 'all' ? 'active' : ''}`}
            onClick={() => onCategoryChange('all')}
          >
            All ({articles.length})
          </button>
          {categories.map((cat) => {
            const count = articles.filter((a) => a.category === cat.id).length;
            if (!count) return null;
            return (
              <button
                key={cat.id}
                type="button"
                className={`chip ${category === cat.id ? 'active' : ''}`}
                onClick={() => onCategoryChange(cat.id)}
              >
                {cat.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {apps.length > 0 && (
        <div className="docs-filter-group">
          <span className="soft-label docs-filter-label">App</span>
          <div className="docs-app-bar" role="tablist" aria-label="Filter by app">
            <button
              type="button"
              className={`chip chip-app ${app === 'all' ? 'active' : ''}`}
              onClick={() => onAppChange('all')}
            >
              All apps
            </button>
            {apps.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chip chip-app ${app === item.id ? 'active' : ''}`}
                onClick={() => onAppChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DocsIndex({ manifest, freshness, onOpen }) {
  const categories = manifest?.categories || [];
  const articles = manifest?.articles || [];
  const appCatalog = manifest?.apps || [];
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [app, setApp] = useState('all');
  const [sort, setSort] = useState('updated');

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.label])),
    [categories],
  );

  const enriched = useMemo(
    () => articles.map((article) => ({
      article,
      apps: mergeArticleApps(article, getArticleFreshness(freshness, article.slug), appCatalog),
      freshness: getArticleFreshness(freshness, article.slug),
    })),
    [articles, freshness, appCatalog],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = enriched.filter(({ article, apps: articleApps }) => {
      if (category !== 'all' && article.category !== category) return false;
      if (app !== 'all' && !articleApps.some((a) => a.id === app) && !(article.apps || []).includes(app)) {
        return false;
      }
      if (!q) return true;
      const hay = [
        article.title,
        article.summary,
        ...(article.tags || []),
        ...(article.apps || []),
        ...articleApps.map((a) => `${a.label} ${a.shortLabel || ''}`),
        categoryMap[article.category],
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });

    list = [...list].sort((a, b) => {
      if (sort === 'title') return a.article.title.localeCompare(b.article.title);
      if (sort === 'featured') {
        if (a.article.featured !== b.article.featured) return a.article.featured ? -1 : 1;
        return (b.article.updatedAt || '').localeCompare(a.article.updatedAt || '');
      }
      return (b.article.updatedAt || '').localeCompare(a.article.updatedAt || '');
    });
    return list;
  }, [enriched, category, app, query, categoryMap, sort]);

  const featured = filtered.filter(({ article }) => article.featured);
  const staleCount = filtered.filter(({ freshness: f }) => f?.status === 'stale').length;
  const showFeatured = featured.length > 0 && category === 'all' && app === 'all' && !query;

  return (
    <>
      <DocsPortalToolbar
        query={query}
        onQueryChange={setQuery}
        category={category}
        onCategoryChange={setCategory}
        app={app}
        onAppChange={setApp}
        sort={sort}
        onSortChange={setSort}
        manifest={manifest}
        filteredCount={filtered.length}
        staleCount={staleCount}
      />

      {showFeatured && (
        <section className="docs-featured">
          <h2>Featured</h2>
          <div className="docs-grid">
            {featured.map(({ article, apps: articleApps, freshness: f }) => (
              <DocCard
                key={article.id}
                article={article}
                apps={articleApps}
                freshnessEntry={f}
                categoryLabel={categoryMap[article.category] || article.category}
                onOpen={onOpen}
              />
            ))}
          </div>
        </section>
      )}

      <section className="docs-library">
        <h2>{query || app !== 'all' || category !== 'all' ? `Results (${filtered.length})` : 'All articles'}</h2>
        {filtered.length ? (
          <div className="docs-grid">
            {filtered.map(({ article, apps: articleApps, freshness: f }) => (
              <DocCard
                key={article.id}
                article={article}
                apps={articleApps}
                freshnessEntry={f}
                categoryLabel={categoryMap[article.category] || article.category}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No articles match">Try another search, category, or app filter.</EmptyState>
        )}
      </section>
    </>
  );
}

function DocsArticleView({ meta, body, categories, freshness, appCatalog, onBack }) {
  const categoryLabel = categories.find((c) => c.id === meta.category)?.label || meta.category;
  const hero = docHeroUrl(meta);
  const fresh = getArticleFreshness(freshness, meta.slug);
  const apps = mergeArticleApps(meta, fresh, appCatalog);
  const { primarySection, bodyDossier } = splitDocsDossier(body?.dossier);
  const primaryTabs = primarySection?.blocks?.[0]?.type === 'tabs'
    ? { ...primarySection.blocks[0], variant: 'prominent' }
    : null;
  const record = { dossier: bodyDossier };

  return (
    <article className="docs-article">
      <nav className="docs-article-nav">
        <button type="button" className="button small ghost" onClick={onBack}>← Back to docs</button>
      </nav>

      <header className="docs-article-hero">
        <p className="eyebrow">{categoryLabel}</p>
        <h1>{meta.title}</h1>
        {meta.summary && <p className="docs-article-lede">{meta.summary}</p>}
        <div className="docs-article-meta">
          {meta.author && <span>{meta.author}</span>}
          {meta.publishedAt && <time dateTime={meta.publishedAt}>Published {meta.publishedAt}</time>}
          {meta.updatedAt && (
            <time dateTime={meta.updatedAt}>Updated {meta.updatedAt}</time>
          )}
          <FreshnessBadge status={fresh?.status} />
        </div>
        {apps.length > 0 && (
          <div className="docs-article-apps">
            {apps.map((item) => (
              <span key={item.id} className="doc-app-pill doc-app-pill--large">{item.label}</span>
            ))}
          </div>
        )}
        {fresh?.status === 'stale' && fresh.newestCodeChange && (
          <p className="docs-stale-notice">
            Referenced source changed after this article was last updated ({fresh.newestCodeChange}).
            Review linked code blocks and bump <code>updatedAt</code> when done.
          </p>
        )}
        {meta.tags?.length > 0 && (
          <div className="pill-row">
            {meta.tags.map((tag) => <span key={tag} className="soft-label">{tag}</span>)}
          </div>
        )}
      </header>

      {primaryTabs && (
        <section className="docs-article-primary-tabs">
          {primarySection.summary && (
            <p className="docs-article-primary-tabs-summary">{primarySection.summary}</p>
          )}
          <DossierTabs block={primaryTabs} onOpenGallery={() => {}} />
        </section>
      )}

      {hero && (
        <figure className={`docs-article-cover${meta.heroImage?.fit === 'contain' ? ' docs-article-cover--contain' : ''}`}>
          <img src={hero} alt={meta.heroImage?.caption || meta.title} />
          {meta.heroImage?.caption && <figcaption>{meta.heroImage.caption}</figcaption>}
        </figure>
      )}

      <div className="docs-article-body feature-dossier-body">
        {recordHasRichContent(record) ? (
          <RichContentBody record={record} title={meta.title} />
        ) : (
          !primaryTabs && <p className="feature-dossier-empty">This article has no body yet.</p>
        )}
      </div>
    </article>
  );
}

export default function Docs({ data, query }) {
  const manifest = data.docs || { categories: [], articles: [], apps: [] };
  const slug = query?.article || '';
  const [body, setBody] = useState(null);
  const [freshness, setFreshness] = useState({ articles: {} });
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(Boolean(slug));

  const meta = useMemo(
    () => (slug ? findDocArticle(manifest, slug) : null),
    [manifest, slug],
  );

  useEffect(() => {
    loadDocsFreshness().then(setFreshness);
  }, []);

  useEffect(() => {
    if (!slug) {
      setBody(null);
      setLoadError('');
      setLoading(false);
      return undefined;
    }
    if (!meta) {
      setBody(null);
      setLoadError('Article not found in docs.json.');
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    loadDocArticle(meta, manifest)
      .then((payload) => {
        if (!cancelled) {
          setBody(payload);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [slug, meta]);

  const openArticle = (article) => {
    window.location.hash = docArticleHref(article.slug).replace(/^#/, '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const backToIndex = () => {
    window.location.hash = '#/docs';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className="docs-page">
      {!slug && (
        <PageTitle
          eyebrow="Technical documentation"
          title="Resort Docs"
        >
          Formats, systems, and tooling across the monorepo — searchable by topic, category, and app.
        </PageTitle>
      )}

      {!slug && (
        <p className="docs-intro-actions">
          <a className="button small ghost" href={routeHref('/source')}>Source Guide</a>
          <span className="soft-label">Authoring reference in <code>docs/AUTHORING.md</code></span>
        </p>
      )}

      {slug && loading && <p className="hint docs-loading">Loading article…</p>}
      {slug && loadError && (
        <EmptyState title="Could not load article" actionHref="#/docs" actionLabel="Back to docs">
          {loadError}
        </EmptyState>
      )}
      {slug && meta && body && !loadError && (
        <DocsArticleView
          meta={meta}
          body={body}
          categories={manifest.categories || []}
          freshness={freshness}
          appCatalog={manifest.apps || []}
          onBack={backToIndex}
        />
      )}

      {!slug && (
        <DocsIndex manifest={manifest} freshness={freshness} onOpen={openArticle} />
      )}
    </main>
  );
}
