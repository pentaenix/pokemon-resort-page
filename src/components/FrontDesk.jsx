function StatCard({ label, value, detail }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export function FrontDesk({ data }) {
  const openBugs = data.bugs.items.filter((bug) => ['open', 'blocked'].includes(bug.status)).length;
  const fixedBugs = data.bugs.items.filter((bug) => bug.status === 'fixed').length;
  const poisNeedingEvidence = data.atlas.pois.filter((poi) => ['Possible', 'Speculative'].includes(poi.confidence)).length;
  const workingRoutes = data.compatibility.routes.filter((route) => route.status === 'working').length;
  const totalRoutes = data.compatibility.routes.length;
  const activeFeatures = data.features.items.filter((feature) => ['on-flight', 'testing'].includes(feature.stage)).length;

  return (
    <section className="section-wrap front-desk" aria-labelledby="front-desk-title">
      <div className="section-heading">
        <p className="eyebrow">Front Desk</p>
        <h2 id="front-desk-title">A public dashboard without the chaos.</h2>
        <p>
          The resort page is static, curated, and data-driven. Everything below is powered by JSON files that can be edited locally and pushed to GitHub.
        </p>
      </div>
      <div className="stat-grid">
        <StatCard label="Active features" value={activeFeatures} detail="Currently on-flight or in testing." />
        <StatCard label="Open issue desk tickets" value={openBugs} detail={`${fixedBugs} fixed issues are archived in the data.`} />
        <StatCard label="Working routes" value={`${workingRoutes}/${totalRoutes}`} detail="Round-trip compatibility routes marked green." />
        <StatCard label="POIs needing evidence" value={poisNeedingEvidence} detail="Places labeled Possible or Speculative." />
      </div>
    </section>
  );
}
