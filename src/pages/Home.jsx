import React, { useEffect, useRef, useState } from 'react';
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


function LazyHomeVideo({ video, className = '' }) {
  const [active, setActive] = useState(false);
  const videoRef = useRef(null);
  const label = video.title || video.caption || 'Pokémon Resort video';

  useEffect(() => {
    if (!active || !videoRef.current) return;
    const el = videoRef.current;
    el.src = assetUrl(video.src);
    el.load();
    el.play().catch(() => {});
  }, [active, video.src]);

  return (
    <div className={`home-lazy-video ${className}`.trim()}>
      {!active ? (
        <button
          type="button"
          className="home-lazy-video-poster"
          onClick={() => setActive(true)}
          aria-label={`Play ${label}`}
        >
          <img
            src={assetUrl(video.poster)}
            alt=""
            loading="lazy"
            decoding="async"
          />
          <span className="home-lazy-video-play-badge" aria-hidden="true">
            <span className="home-lazy-video-play-icon">▶</span>
            <span>Play clip</span>
          </span>
        </button>
      ) : (
        <video
          ref={videoRef}
          className="home-lazy-video-player"
          controls
          playsInline
          preload="none"
          aria-label={label}
        />
      )}
    </div>
  );
}

function HomePreviewVideo({ video }) {
  if (!video?.src || !video?.poster) return null;
  return (
    <section className="home-preview-video-section" aria-label={video.title || 'Resort preview clip'}>
      <div className="home-preview-video-copy">
        {video.eyebrow && <p className="eyebrow">{video.eyebrow}</p>}
        {video.title && <h2>{video.title}</h2>}
        {video.caption && <p>{video.caption}</p>}
      </div>
      <figure className="home-preview-video-frame">
        <LazyHomeVideo video={video} className="home-preview-video-media" />
      </figure>
    </section>
  );
}

function HomeCarouselHoverGif({ item }) {
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef(null);
  const delay = item.hoverPlayDelayMs ?? 300;

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  const startHoverPlay = () => {
    clearTimer();
    timerRef.current = setTimeout(() => setPlaying(true), delay);
  };

  const stopHoverPlay = () => {
    clearTimer();
    setPlaying(false);
  };

  return (
    <img
      src={assetUrl(playing ? item.src : item.poster)}
      alt={item.title || item.caption || 'Pokémon Resort media'}
      loading="lazy"
      decoding="async"
      onMouseEnter={startHoverPlay}
      onMouseLeave={stopHoverPlay}
      onFocus={startHoverPlay}
      onBlur={stopHoverPlay}
    />
  );
}

function HomeCarouselItem({ item }) {
  return (
    <figure className="carousel-card home-carousel-card">
      {item.type === 'video' ? (
        <video src={assetUrl(item.src)} muted loop playsInline controls={false} aria-label={item.title || item.caption} />
      ) : item.hoverPlay && item.poster ? (
        <HomeCarouselHoverGif item={item} />
      ) : (
        <img src={assetUrl(item.src)} alt={item.title || item.caption || 'Pokémon Resort media'} loading="lazy" decoding="async" />
      )}
      <figcaption>
        <strong>{item.title}</strong>
        <span>{item.caption}</span>
      </figcaption>
    </figure>
  );
}

function HomeCarousel({ items = [] }) {
  if (!items.length) return null;
  return (
    <section className="home-carousel-section" aria-label="Pokémon Resort overview media">
      <div className="section-intro compact">
        <p className="eyebrow">Resort preview</p>
        <h2>What we are building toward</h2>
      </div>
      <div className="media-carousel home-media-carousel">
        {items.map((item) => (
          <HomeCarouselItem key={item.id || item.src} item={item} />
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
            <strong>{digest.activeFeatures} features in progress</strong>
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

      {homepage.previewVideo && <HomePreviewVideo video={homepage.previewVideo} />}

      <section className="status-strip" aria-label="Project status">
        {(homepage.statusCards || []).map((card) => (
          <article key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </article>
        ))}
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
              <h2>Quiet week at the resort.</h2>
              <p>Nothing pinned yet. Add a pin from the desk when you have one.</p>
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
            <article><StatusPill status="on-flight" label="On-Flight" /><strong>{digest.activeFeatures}</strong><span>on-flight features</span></article>
            <article><StatusPill status="open" label="Issue desk" /><strong>{digest.openBugs}</strong><span>open bugs</span></article>
          </div>
        </div>
      </section>
    </main>
  );
}
