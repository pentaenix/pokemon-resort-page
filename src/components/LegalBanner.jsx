export function LegalBanner({ legal }) {
  return (
    <aside className="legal-banner" role="note" aria-label="Fan project notice">
      <strong>Fan project notice:</strong>
      <span>{legal.shortNotice}</span>
    </aside>
  );
}
