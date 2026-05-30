import React from 'react';
import { PageTitle } from '../components/Layout.jsx';

const tree = `pokemon-resort/
  public/
    data/                 # JSON source of truth for the static site
    assets/               # logo and project planning images included now
    media/                # you add box art, screenshots, models, sprites, gifs, video
  src/                    # public React/Vite site
  tools/admin/            # local-only Operations Desk
  tools/validate-data.mjs # schema guard before publishing
  RESOURCE-TO-ADD.md      # exact media paths to fill in next`;

export default function SourceGuide() {
  return (
    <main>
      <PageTitle eyebrow="Source Code Guide" title="The public page stays static; the local tool edits the data.">
        There are no download links here. This page explains how the source is structured and where your real media resources belong.
      </PageTitle>
      <section className="source-layout">
        <article className="source-card"><h2>Repo structure</h2><pre>{tree}</pre></article>
        <article className="source-card"><h2>Data-driven pages</h2><p>The site reads JSON files from <code>public/data</code>. Features, bugs, routes, game cards, research POIs, galleries, models, characters, roadmap items, and idea cards can be updated without editing React components.</p></article>
        <article className="source-card"><h2>Local Operations Desk</h2><p>Run <code>npm run admin</code> to open the local editor. It writes JSON files, validates them, shows git status, and can commit/push using your own local Git credentials.</p></article>
        <article className="source-card"><h2>Resource checklist</h2><p>Open <code>RESOURCE-TO-ADD.md</code> for the exact box-art, gallery, model, and sprite paths to add. The app does not hotlink fragile external images.</p></article>
      </section>
    </main>
  );
}
