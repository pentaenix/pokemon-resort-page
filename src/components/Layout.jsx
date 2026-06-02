import React, { useState } from 'react';
import { assetUrl } from '../lib/data.js';

const nav = [
  ['/', 'Home'],
  ['/atlas', 'Island Atlas'],
  ['/ontology', 'Compatibility'],
  ['/board', 'Operations'],
  ['/milestones', 'Ideas & Milestones'],
  ['/research', 'Concierge Research'],
  ['/docs', 'Docs'],
  ['/source', 'Source Guide'],
  ['/legal', 'Legal'],
];

export function LegalBanner({ site }) {
  return (
    <div className="legal-banner" role="note">
      <strong>Unofficial fan project.</strong>
      <span>{site?.legalShort || 'Non-commercial fan research and development project. No donations accepted.'}</span>
    </div>
  );
}

export function Header({ site, route }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <a href="#/" className="brand" aria-label="Go home" onClick={() => setOpen(false)}>
        <img src={assetUrl(site?.logo)} alt="Pokémon Resort logo" />
        <div>
          <span className="brand-kicker">Fan Research Atlas</span>
          <strong>Resort Operations</strong>
        </div>
      </a>
      <button className="nav-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Open navigation">☰</button>
      <nav className={`site-nav ${open ? 'open' : ''}`} aria-label="Main navigation">
        {nav.map(([href, label]) => (
          <a key={href} href={`#${href}`} className={route === href ? 'active' : ''} onClick={() => setOpen(false)}>{label}</a>
        ))}
      </nav>
    </header>
  );
}

export function Footer({ site }) {
  return (
    <footer className="footer">
      <div>
        <strong>Made by fans, for fans.</strong>
        <p>{site?.legalFull?.[3] || 'We do not accept donations, payments, crowdfunding, sponsorships, or financial support.'}</p>
      </div>
      <div className="footer-links">
        <a href="#/legal">Legal & Credits</a>
        <a href="#/source">Source Guide</a>
        <a href="#/board">Operations</a>
      </div>
    </footer>
  );
}

export function PageTitle({ eyebrow, title, children }) {
  return (
    <section className="page-title">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </section>
  );
}

export function EmptyState({ title, children, actionHref, actionLabel }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{children}</p>
      {actionHref && <a className="button small" href={actionHref}>{actionLabel || 'Open guide'}</a>}
    </div>
  );
}
