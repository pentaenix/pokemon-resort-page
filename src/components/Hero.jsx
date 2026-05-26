import { assetUrl } from '../lib/data.js';

export function Hero({ site, homepage, pulse }) {
  const hero = homepage.hero;
  return (
    <section className="hero-section section-wrap" id="front-desk" aria-labelledby="hero-title">
      <div className="hero-sky" aria-hidden="true">
        <span className="sun-disc" />
        <span className="cloud cloud-one" />
        <span className="cloud cloud-two" />
        <span className="wave wave-one" />
        <span className="wave wave-two" />
      </div>
      <div className="hero-grid">
        <div className="hero-copy glass-panel">
          <p className="eyebrow">{hero.eyebrow}</p>
          <img className="hero-logo" src={assetUrl(hero.logo)} alt={site.projectName} />
          <h1 id="hero-title">{hero.headline}</h1>
          <p className="hero-subheadline">{hero.subheadline}</p>
          <div className="hero-actions">
            <a className="button primary" href={hero.primaryAction.href}>{hero.primaryAction.label}</a>
            <a className="button secondary" href={hero.secondaryAction.href}>{hero.secondaryAction.label}</a>
          </div>
        </div>
        <div className="hero-status stack-panel">
          <div className="status-ticket">
            <p>{hero.statusLabel}</p>
            <strong>{hero.statusValue}</strong>
          </div>
          <div className="pulse-board">
            <h2>This week at the resort</h2>
            <ul>
              {pulse.slice(0, 5).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="media-strip">
            {homepage.featuredMedia.slice(0, 2).map((media) => (
              <figure key={media.src}>
                <img src={assetUrl(media.src)} alt={media.caption} />
                <figcaption>{media.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
      <div className="resort-card-grid entrance-grid" aria-label="Main site entrances">
        {homepage.cards.map((card) => (
          <a className="entrance-card" href={card.href} key={card.id}>
            <span>{card.kicker}</span>
            <h2>{card.title}</h2>
            <p>{card.summary}</p>
          </a>
        ))}
      </div>
    </section>
  );
}
