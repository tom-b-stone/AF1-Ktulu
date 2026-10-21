// Race Coverage: placeholder for the planned tool (not built yet).
export default function Page() {
  return (
    <div style={{ maxWidth: 720, display: "grid", gap: 12 }}>
      <section className="page-head">
        <div>
          <div className="section-label" style={{ marginBottom: 8 }}>Planned</div>
          <h1>Race Coverage</h1>
          <p>Race weekend coverage in one flow: from the session results to the news articles, then the updates on the race page and the home page. Planned, not built yet.</p>
          <ol style={{ margin: "12px 0 0", paddingLeft: 20, color: "var(--muted)", lineHeight: 1.7, fontSize: 14 }}>
            <li>Session results</li>
            <li>News articles</li>
            <li>Race page updates</li>
            <li>Home page updates</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
