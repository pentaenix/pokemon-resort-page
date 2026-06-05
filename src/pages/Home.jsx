import React, { useState } from 'react';
import { assetUrl } from '../lib/data.js';
import { pickResortSpotlight } from '../lib/resortSpotlight.js';
import { StatusPill } from '../components/StatusPill.jsx';

function computeDigest(data) {
  const routes = data.compatibility?.routes || [];
  const bugs = data.bugs?.bugs || [];
  const features = data.features?.features || [];
  const redRoutes = routes.filter((r) => r.status === 'red').length;
  const blueRoutes = routes.filter((r) => r.status === 'blue').length;
  const grayRoutes = routes.filter((r) => r.status === 'gray').length;
  const activeFeatures = features.filter((f) => ['On-Flight', 'Testing'].includes(f.stage)).length;
  const openBugs = bugs.filter((b) => ['Open', 'Blocked'].includes(b.status)).length;
  return { redRoutes, blueRoutes, grayRoutes, activeFeatures, openBugs, routeCount: routes.length };
}


function HomeCarousel({ items = [] }) {
  if (!items.length) return null;
  return (
    <section className="home-carousel-section" aria-label="Pokémon Resort overview media">
      <div className="section-intro compact">
        <p className="eyebrow">Resort preview</p>
        <h2>What we're building toward.</h2>
      </div>
      <div className="media-carousel home-media-carousel">
        {items.map((item) => (
          <figure key={item.id || item.src} className="carousel-card home-carousel-card">
            {item.type === 'video' ? (
              <video src={assetUrl(item.src)} muted loop playsInline controls={false} aria-label={item.title || item.caption} />
            ) : (
              <img src={assetUrl(item.src)} alt={item.title || item.caption || 'Pokémon Resort media'} />
            )}
            <figcaption>
              <strong>{item.title}</strong>
              <span>{item.caption}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

export default function Home({ data }) {
  const { site, homepage } = data;
  const digest = computeDigest(data);
  const [spotlight] = useState(() => pickResortSpotlight(data));
  const hero = homepage.hero;
  return (
    <main className="home-page">
      <section className="hero-shell">
        <div className="hero-bg-orb one" />
        <div className="hero-bg-orb two" />
        <div className="hero-copy">
          <p className="eyebrow">{hero.eyebrow}</p>
          <img className="hero-logo" src={assetUrl(site.logo)} alt="Pokémon Resort logo" />
          <h1>{hero.headline}</h1>
          <p>{hero.subheadline}</p>
          <div className="hero-actions">
            <a className="button primary" href={hero.primaryCta.href}>{hero.primaryCta.label}</a>
            <a className="button ghost" href={hero.secondaryCta.href}>{hero.secondaryCta.label}</a>
          </div>
        </div>
        <div className="hero-media" aria-label="Project planning images">
          {(hero.featuredMedia || []).map((media, index) => (
            <figure key={media.src} className={`media-card card-${index + 1}`}>
              <img src={assetUrl(media.src)} alt={media.caption} />
              <figcaption>{media.caption}</figcaption>
            </figure>
          ))}
          <div className="floating-status-card">
            <span>Resort Status</span>
            <strong>{digest.activeFeatures} operations active</strong>
            <small>{digest.routeCount} compatibility routes · {digest.openBugs} open/blocking issues</small>
          </div>
        </div>
      </section>

      {homepage.about && (
        <section className="about-resort-section">
          <div>
            <p className="eyebrow">{homepage.about.eyebrow}</p>
            <h2>{homepage.about.title}</h2>
          </div>
          <div className="about-resort-copy">
            {homepage.about.body?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </section>
      )}

      <HomeCarousel items={homepage.carousel || []} />

      <section className="status-strip" aria-label="Project status">
        {(homepage.statusCards || []).map((card) => (
          <article key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </article>
        ))}
      </section>

      <section className="lobby-grid">
        <div className="section-intro">
          <p className="eyebrow">Front desk</p>
          <h2>Where to check in.</h2>
        </div>
        <div className="nav-card-grid">
          {(homepage.navCards || []).map((card) => (
            <a key={card.href} className="nav-card" href={card.href}>
              <span className="nav-card-icon">{card.icon}</span>
              <strong>{card.title}</strong>
              <p>{card.description}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="digest-panel">
        <div className="digest-spotlight-copy">
          <p className="eyebrow">This week at the resort</p>
          {spotlight?.featured ? (
            <>
              <p className="digest-spotlight-kind">{spotlight.featured.eyebrow}</p>
              <h2>{spotlight.featured.title}</h2>
              <p>{spotlight.featured.summary}</p>
              <a className="button ghost small" href={spotlight.featured.href}>{spotlight.featured.cta}</a>
              {spotlight.alternates?.length ? (
                <div className="digest-spotlight-also">
                  <span className="soft-label">Also noted</span>
                  {spotlight.alternates.map((item) => (
                    <a key={item.id} href={item.href}>{item.title}</a>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <h2>A quiet week on the island.</h2>
              <p>The cork board is waiting for its next pin.</p>
            </>
          )}
        </div>
        <div className="digest-spotlight-side">
          {spotlight?.featured?.image ? (
            <a className="digest-spotlight-media" href={spotlight.featured.href}>
              <img src={assetUrl(spotlight.featured.image)} alt="" loading="lazy" />
            </a>
          ) : null}
          <div className="digest-cards">
            <article><StatusPill status="red" label="Needs care" /><strong>{digest.redRoutes}</strong><span>failing routes</span></article>
            <article><StatusPill status="gray" label="Untested" /><strong>{digest.grayRoutes}</strong><span>routes still open</span></article>
            <article><StatusPill status="on-flight" label="On-Flight" /><strong>{digest.activeFeatures}</strong><span>features in motion</span></article>
            <article><StatusPill status="open" label="Issue desk" /><strong>{digest.openBugs}</strong><span>open threads</span></article>
          </div>
        </div>
      </section>
    </main>
  );
}
