export function SourceGuide({ site }) {
  return (
    <section className="section-wrap source-guide" id="source-guide" aria-labelledby="source-title">
      <div className="section-heading">
        <p className="eyebrow">Source Code Guide</p>
        <h2 id="source-title">Open source, no downloads from this page.</h2>
        <p>
          The website explains the repo structure and the project data model. It does not provide game download links, donation links, or user submission forms.
        </p>
      </div>
      <div className="guide-grid">
        <article className="guide-card">
          <h3>Public site</h3>
          <pre>{`src/
  components/
  lib/
public/
  data/
  assets/`}</pre>
          <p>The static site reads JSON files from <code>public/data</code> and renders the atlas, compatibility graph, feature board, and issue desk.</p>
        </article>
        <article className="guide-card">
          <h3>Local admin tool</h3>
          <pre>{`npm run admin
http://localhost:8787`}</pre>
          <p>The local tool edits JSON data, validates it, previews a summary of changes, and can commit/push through your local Git setup.</p>
        </article>
        <article className="guide-card">
          <h3>Data as the database</h3>
          <pre>{`public/data/
  bugs.json
  features.json
  compatibility.json
  research-pois.json
  homepage.json
  theme.json`}</pre>
          <p>Git history becomes the audit trail. The public page stays static, fast, and safe to host on GitHub Pages.</p>
        </article>
      </div>
      <div className="notice-card">
        <strong>Repository target:</strong>
        <span>{site.repoUrl}</span>
        <p>Update <code>public/data/site.json</code> with your real repository URL when you create the public repo.</p>
      </div>
    </section>
  );
}
