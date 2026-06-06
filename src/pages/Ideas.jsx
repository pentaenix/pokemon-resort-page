import React, { useEffect, useMemo, useState } from 'react';
import { EmptyState, PageTitle } from '../components/Layout.jsx';
import { RichContentBody } from '../components/RichContentBody.jsx';
import { DossierTabs } from '../components/dossier/DossierTabs.jsx';
import { StatusPill } from '../components/StatusPill.jsx';
import { splitDocsDossier } from '../lib/docCatalog.js';
import { routeHref } from '../lib/data.js';
import {
  findIdeaArticle,
  ideaArticleHref,
  ideaHeroUrl,
  loadIdeaArticle,
} from '../lib/ideas.js';
import { recordHasRichContent } from '../lib/richContent.js';

function IdeaCard({ idea, onOpen }) {
  const hero = ideaHeroUrl(idea);
  return (
    <article className="doc-card idea-card">
      <button type="button" className="doc-card-main" onClick={() => onOpen(idea)}>
        {hero && (
          <div className="doc-card-media">
            <img src={hero} alt="" loading="lazy" />
          </div>
        )}
        <div className="doc-card-body">
          <div className="doc-card-top">
            <StatusPill status={idea.status} label={idea.status} />
          </div>
          <h3>{idea.title}</h3>
          <p>{idea.summary}</p>
          {idea.tags?.length > 0 && (
            <div className="pill-row">
              {idea.tags.map((tag) => (
                <span key={tag} className="soft-label">{tag}</span>
              ))}
            </div>
          )}
          {idea.updatedAt && (
            <div className="doc-card-foot">
              <time className="doc-card-date" dateTime={idea.updatedAt}>Updated {idea.updatedAt}</time>
            </div>
          )}
        </div>
      </button>
    </article>
  );
}

function IdeasIndex({ manifest, onOpen }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const items = manifest?.items || [];

  const statuses = useMemo(() => {
    const set = new Set(items.map((item) => item.status).filter(Boolean));
    return ['all', ...[...set].sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((idea) => {
      if (status !== 'all' && idea.status !== status) return false;
      if (!q) return true;
      const hay = [idea.title, idea.summary, ...(idea.tags || [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [items, query, status]);

  return (
    <>
      <div className="docs-portal-toolbar">
        <div className="docs-portal-toolbar-row">
          <label className="docs-search docs-search--wide">
            <span className="soft-label">Search ideas</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Title, summary, tags…"
            />
          </label>
        </div>
        <div className="docs-portal-stats">
          <span>{filtered.length} idea{filtered.length === 1 ? '' : 's'}</span>
        </div>
        <div className="docs-filter-group">
          <span className="soft-label docs-filter-label">Status</span>
          <div className="docs-filter-chips">
            {statuses.map((value) => (
              <button
                key={value}
                type="button"
                className={`docs-filter-chip${status === value ? ' is-active' : ''}`}
                onClick={() => setStatus(value)}
              >
                {value === 'all' ? 'All' : value}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="docs-library">
        <h2>{query || status !== 'all' ? `Results (${filtered.length})` : 'All ideas'}</h2>
        {filtered.length ? (
          <div className="docs-grid">
            {filtered.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} onOpen={onOpen} />
            ))}
          </div>
        ) : (
          <EmptyState title="No ideas match">Try another search or status filter.</EmptyState>
        )}
      </section>
    </>
  );
}

function IdeaArticleView({ meta, body, onBack }) {
  const hero = ideaHeroUrl(meta);
  const { primarySection, bodyDossier } = splitDocsDossier(body?.dossier);
  const primaryTabs = primarySection?.blocks?.[0]?.type === 'tabs'
    ? { ...primarySection.blocks[0], variant: 'prominent' }
    : null;
  const record = { dossier: bodyDossier };

  return (
    <article className="docs-article idea-article">
      <nav className="docs-article-nav">
        <button type="button" className="button small ghost" onClick={onBack}>← Back to ideas</button>
        <a className="button small ghost" href={routeHref('/milestones')}>Ideas and milestones</a>
      </nav>

      <header className="docs-article-hero">
        <p className="eyebrow">Idea</p>
        <div className="idea-article-status">
          <StatusPill status={meta.status} label={meta.status} />
        </div>
        <h1>{meta.title}</h1>
        {meta.summary && <p className="docs-article-lede">{meta.summary}</p>}
        {meta.updatedAt && (
          <div className="docs-article-meta">
            <time dateTime={meta.updatedAt}>Updated {meta.updatedAt}</time>
          </div>
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
          !primaryTabs && <p className="feature-dossier-empty">This idea has no extended write-up yet.</p>
        )}
      </div>
    </article>
  );
}

export default function Ideas({ data, query }) {
  const manifest = data.ideas || { items: [] };
  const slug = query?.idea || '';
  const [body, setBody] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(Boolean(slug));

  const meta = useMemo(
    () => (slug ? findIdeaArticle(manifest, slug) : null),
    [manifest, slug],
  );

  useEffect(() => {
    if (!slug) {
      setBody(null);
      setLoadError('');
      setLoading(false);
      return undefined;
    }
    if (!meta) {
      setBody(null);
      setLoadError('Idea not found in ideas.json.');
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    loadIdeaArticle(meta, manifest)
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

  const openIdea = (idea) => {
    window.location.hash = ideaArticleHref(idea.slug || idea.id).replace(/^#/, '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const backToIndex = () => {
    window.location.hash = '#/ideas';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className="docs-page ideas-page">
      {!slug && (
        <PageTitle
          eyebrow="Spark board"
          title="Resort ideas"
        >
          Sparks we have not committed yet. Each card has a one-line summary; open it for tabs, media, and notes.
        </PageTitle>
      )}

      {!slug && (
        <p className="docs-intro-actions">
          <a className="button small ghost" href={routeHref('/milestones')}>← Ideas and milestones</a>
          <a className="button small ghost" href={routeHref('/build')}>Build timeline</a>
        </p>
      )}

      {slug && loading && <p className="hint docs-loading">Loading idea…</p>}
      {slug && loadError && (
        <EmptyState title="Could not load idea" actionHref="#/ideas" actionLabel="Back to ideas">
          {loadError}
        </EmptyState>
      )}
      {slug && meta && body && !loadError && (
        <IdeaArticleView meta={meta} body={body} onBack={backToIndex} />
      )}

      {!slug && <IdeasIndex manifest={manifest} onOpen={openIdea} />}
    </main>
  );
}
