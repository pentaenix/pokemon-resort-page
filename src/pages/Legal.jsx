import React from 'react';
import { PageTitle } from '../components/Layout.jsx';

export default function Legal({ data }) {
  const site = data.site;
  return (
    <main>
      <PageTitle eyebrow="Legal & Credits" title="Legal and credits">
        Same disclaimer on every page; full text is here.
      </PageTitle>
      <section className="legal-page-card">
        {site.legalFull.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </section>
      <section className="source-layout two">
        <article className="source-card"><h2>Original project material</h2><p>Source code, original tools, original models, original sprites, original diagrams, and other original assets created during development may be reused with appropriate credit unless a file says otherwise.</p></article>
        <article className="source-card"><h2>Official/reference material</h2><p>Official names, characters, settings, screenshots, and referenced copyrighted material remain the property of their respective owners and are included only for non-commercial fan research context.</p></article>
      </section>
    </main>
  );
}
