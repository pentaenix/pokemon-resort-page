export function Footer({ legal, site }) {
  return (
    <footer className="site-footer">
      <div>
        <h2>{site.projectName}</h2>
        <p>{legal.fullNotice}</p>
      </div>
      <div className="footer-pills">
        <span>No donations accepted</span>
        <span>Unofficial fan project</span>
        <span>Original code/assets reusable with credit</span>
      </div>
    </footer>
  );
}
