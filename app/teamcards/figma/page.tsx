"use client";

// Figma Sync: is a campaign the same in Figma and on staging? Lists only what
// changed, in which direction, before → after, and lets you approve it.
// Below: one Figma board per campaign (paste the Figma link) and how to
// install the plugin. Open to everyone who can sign in.
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

type Campaign = { key: string; name: string; root: string; race: string; season: string; figmaUrl: string; figmaFile: string; figmaPage: string; custom: boolean };

type Diff = { key: string; pageId: string; page: string; block: string; layer: string; kind?: string; base?: string; cms?: string; figma?: string; state: string };
type Status = {
  campaign: { key: string; name: string; figmaFile: string; figmaPage: string };
  pages: { id: string; url: string; title: string }[];
  diffs: Diff[];
  syncedAt: string | null;
  figma: { reportedAt: string; by: string; nodes: Record<string, string> } | null;
  pending: number;
  log: { at: string; by: string; summary: string }[];
};

const DIR: Record<string, { label: string; tone: string }> = {
  "figma-newer": { label: "Figma → CMS", tone: "#7fb8ff" },
  "cms-newer": { label: "CMS → Figma", tone: "#6fcf7c" },
  conflict: { label: "Changed on both", tone: "var(--accent)" },
};
const when = (s?: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const short = (v?: string) => (v ?? "").trim() || "(empty)";

export default function Page() {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = useState<Record<string, "figma" | "cms">>({});
  const [result, setResult] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenAt, setTokenAt] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [ck, setCk] = useState<string>("sin");
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("c");
    if (q) setCk(q);
    void loadCampaigns();
  }, []);
  const loadCampaigns = () =>
    fetch("/api/sitemap/campaigns")
      .then((r) => r.json())
      .then((j) => j.campaigns && setCampaigns(j.campaigns))
      .catch(() => {});
  const pick = (k: string) => {
    setCk(k);
    setS(null);
    setError(null);
    window.history.replaceState(null, "", `/teamcards/figma?c=${k}`);
  };

  const load = () =>
    fetch(`/api/sitemap/${ck}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setError(j.error);
        setS(j);
        // non-conflicting changes are pre-selected, conflicts need a decision first
        setSel(Object.fromEntries((j.diffs as Diff[]).filter((d) => DIR[d.state]).map((d) => [d.key, d.state !== "conflict"])));
      })
      .catch(() => setError("Could not load the campaign"));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ck]);
  useEffect(() => {
    fetch("/api/sitemap/token").then((r) => r.json()).then((j) => setTokenAt(j.createdAt ?? null)).catch(() => {});
  }, []);

  const changes = useMemo(() => (s?.diffs ?? []).filter((d) => DIR[d.state]), [s]);
  const titleOf = useMemo(() => Object.fromEntries((s?.pages ?? []).map((p) => [p.id, p.title.replace(/^[A-Z]{2,4} \| /, "")])), [s]);
  const chosen = changes.filter((d) => sel[d.key] && (d.state !== "conflict" || decisions[d.key]));
  const figmaLink = (node?: string) => (s ? `https://www.figma.com/design/${s.campaign.figmaFile}/Board?node-id=${(node ?? s.campaign.figmaPage ?? "0:1").replace(":", "-")}` : "#");

  async function approve() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch(`/api/sitemap/${ck}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ only: chosen.map((d) => d.key), decisions }) }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setResult(`${r.summary}.` + (r.toFigma?.length ? " Figma takes the CMS changes the next time the plugin runs." : ""));
      setDecisions({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1100 }}>
      <div>
        <h1 style={{ margin: "0 0 4px" }}>Figma Sync{s ? ` · ${s.campaign.name}` : ""}</h1>
        {campaigns.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 8px" }}>
            {campaigns.map((c) => (
              <button key={c.key} className={c.key === ck ? "btn btn-primary" : "btn"} style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => pick(c.key)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          Texts and images edited in Figma or in the staging CMS. Approve a change and it is copied to the other side.
          {s && <> Last checked {when(s.figma?.reportedAt)}{s.campaign.figmaFile ? <> · <a href={figmaLink()} target="_blank" rel="noreferrer">Open the Figma board ↗</a></> : <> · <a href="#boards">No Figma board yet</a></>}</>}
        </div>
      </div>

      {error && <div style={{ color: "#e06c5b" }}>{error}</div>}
      {!s && !error && <div style={{ color: "var(--muted)" }}>Checking Figma and the staging CMS…</div>}

      {s && changes.length === 0 && (
        <div style={{ padding: 22, borderRadius: 14, border: "1px solid rgba(111,207,124,.4)", background: "rgba(111,207,124,.08)", fontSize: 16 }}>
          ✓ <b>In sync.</b> Figma and the staging CMS show the same content.
          {s.pending > 0 && <span style={{ color: "var(--muted)", fontSize: 13 }}> {s.pending} approved change{s.pending === 1 ? " is" : "s are"} waiting for the Figma plugin.</span>}
        </div>
      )}

      {s && changes.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <b style={{ fontSize: 16 }}>
              {changes.length} change{changes.length === 1 ? "" : "s"} to approve
            </b>
            <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setSel(Object.fromEntries(changes.map((d) => [d.key, true])))}>
              Select all
            </button>
            <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setSel({})}>
              None
            </button>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {changes.map((d, i) => {
              const dir = DIR[d.state];
              const after = d.state === "figma-newer" ? d.figma : d.cms;
              return (
                <label key={d.key} style={{ display: "grid", gridTemplateColumns: "28px 150px minmax(0,1fr)", gap: 12, padding: "12px 14px", borderTop: i ? "1px solid var(--border)" : undefined, alignItems: "start", cursor: "pointer", background: sel[d.key] ? "rgba(255,255,255,.02)" : undefined }}>
                  <input type="checkbox" checked={!!sel[d.key]} onChange={(e) => setSel({ ...sel, [d.key]: e.target.checked })} style={{ marginTop: 3 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: dir.tone }}>{dir.label}</span>
                  <span style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {titleOf[d.pageId] ?? d.page} · {d.block} · {d.layer}
                    </span>
                    {d.kind === "image" ? (
                      <span style={{ fontSize: 13 }}>Image {d.state === "figma-newer" ? "replaced in Figma" : d.state === "cms-newer" ? "changed in the CMS" : "changed on both sides"}</span>
                    ) : d.state === "conflict" ? (
                      <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {(["figma", "cms"] as const).map((side) => (
                          <span
                            key={side}
                            onClick={(e) => {
                              e.preventDefault();
                              setDecisions({ ...decisions, [d.key]: side });
                              setSel({ ...sel, [d.key]: true });
                            }}
                            style={{ padding: 8, borderRadius: 8, fontSize: 13, whiteSpace: "pre-wrap", border: `1px solid ${decisions[d.key] === side ? "var(--accent)" : "var(--border)"}` }}
                          >
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>Keep {side === "figma" ? "Figma" : "CMS"}</span>
                            <br />
                            {short(side === "figma" ? d.figma : d.cms)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                        <span style={{ color: "var(--muted)", textDecoration: "line-through" }}>{short(d.base)}</span>
                        <span style={{ color: "var(--muted)" }}> → </span>
                        {short(after)}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn btn-primary" disabled={busy || chosen.length === 0} onClick={() => void approve()}>
              {busy ? "Copying…" : `Approve ${chosen.length} change${chosen.length === 1 ? "" : "s"}`}
            </button>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>Figma → CMS is published on staging right away. CMS → Figma arrives with the next plugin run.</span>
          </div>
        </div>
      )}
      {result && <div style={{ fontSize: 13 }}>{result}</div>}

      <Boards campaigns={campaigns} current={ck} onSaved={(l) => { setCampaigns(l); void load(); }} />

      <section id="plugin" style={{ display: "grid", gap: 10, fontSize: 13, padding: 18, border: "1px solid var(--border)", borderRadius: 14 }}>
        <b style={{ fontSize: 15 }}>Install the Figma plugin</b>
        <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>
            <a href="/downloads/af1-ktulu-sync.zip" download>Download the plugin (zip)</a> and unzip it anywhere on your computer.
          </li>
          <li>Figma desktop app → menu Plugins → Development → <i>Import plugin from manifest…</i> → pick <code>manifest.json</code> in the unzipped folder.</li>
          <li>Create your plugin token below and paste it into the plugin once (it stays saved in your Figma).</li>
          <li>Open the campaign&apos;s Figma board and run Plugins → Development → AF1 Ktulu Sync. The plugin picks the campaign of that board by itself.</li>
        </ol>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          Keep the plugin open while you work: it checks every 20 seconds. A text you change on a mobile screen goes to the CMS and from there to the desktop screen.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={async () => { const r = await fetch("/api/sitemap/token", { method: "POST" }).then((x) => x.json()); setToken(r.token); setTokenAt(new Date().toISOString()); }}>
            {tokenAt ? "New plugin token" : "Create plugin token"}
          </button>
          {tokenAt && !token && <span style={{ color: "var(--muted)", fontSize: 12 }}>Token created {when(tokenAt)}. A new one replaces it.</span>}
          {token && <code style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 6, userSelect: "all" }}>{token}</code>}
          {isAdmin && (
            <>
              <button className="btn" onClick={async () => { setImported("Updating …"); const r = await fetch(`/api/sitemap/${ck}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import-cards" }) }).then((x) => x.json()); setImported(r.error ? r.error : `${r.added.length} new, ${r.total} cards in total.`); }}>
                Update the card list
              </button>
              {imported && <span style={{ color: "var(--muted)" }}>{imported}</span>}
            </>
          )}
        </div>
      </section>

      <details style={{ fontSize: 13 }}>
        <summary style={{ cursor: "pointer", color: "var(--muted)" }}>History</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {!s?.log.length && <div style={{ color: "var(--muted)", fontSize: 12 }}>No syncs yet.</div>}
          {s?.log.slice(0, 10).map((l, i) => (
            <div key={i} style={{ color: "var(--muted)", fontSize: 12 }}>
              {when(l.at)} · {l.by} · {l.summary}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// One Figma board per campaign: paste the link of the Figma file (or of the
// page in it) and the plugin builds that campaign there, and only there.
function Boards({ campaigns, current, onSaved }: { campaigns: Campaign[]; current: string; onSaved: (l: Campaign[]) => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ name: "", root: "", race: "", season: String(new Date().getFullYear()), figmaUrl: "" });
  useEffect(() => setUrls(Object.fromEntries(campaigns.map((c) => [c.key, c.figmaUrl]))), [campaigns]);

  async function save(body: Record<string, string>, k: string) {
    setMsg({ ...msg, [k]: "Saving …" });
    const r = await fetch("/api/sitemap/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
    if (r.error) return setMsg({ ...msg, [k]: r.error });
    setMsg({ ...msg, [k]: "Saved. Open the board and run the plugin." });
    onSaved(r.campaigns);
    return true;
  }

  const input = { padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "inherit", fontSize: 13, minWidth: 0 } as const;
  return (
    <section id="boards" style={{ display: "grid", gap: 10, fontSize: 13, padding: 18, border: "1px solid var(--border)", borderRadius: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 15 }}>Campaign boards</b>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>One Figma board per campaign. Paste the Figma link; with a page selected in Figma the link points to that page.</span>
      </div>
      {campaigns.map((c) => (
        <div key={c.key} style={{ display: "grid", gridTemplateColumns: "minmax(140px,200px) minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
          <span>
            <b style={{ color: c.key === current ? "var(--accent)" : undefined }}>{c.name}</b>
            <br />
            <span style={{ color: "var(--muted)", fontSize: 12 }}>/{c.root}</span>
          </span>
          <span style={{ display: "grid", gap: 4 }}>
            <input style={input} placeholder="https://www.figma.com/design/…" value={urls[c.key] ?? ""} onChange={(e) => setUrls({ ...urls, [c.key]: e.target.value })} />
            {msg[c.key] && <span style={{ fontSize: 12, color: /Saved/.test(msg[c.key]) ? "#8fdc98" : "var(--muted)" }}>{msg[c.key]}</span>}
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <button className="btn" disabled={(urls[c.key] ?? "") === c.figmaUrl} onClick={() => void save({ key: c.key, figmaUrl: urls[c.key] ?? "" }, c.key)}>
              Save
            </button>
            {c.figmaUrl && (
              <a className="btn" href={c.figmaUrl} target="_blank" rel="noreferrer">
                Open ↗
              </a>
            )}
          </span>
        </div>
      ))}
      {!adding ? (
        <div>
          <button className="btn" onClick={() => setAdding(true)}>
            + Add a campaign
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>
            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Name</span>
              <input style={input} placeholder="Unlock São Paulo" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} />
            </label>
            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Page URL on staging</span>
              <input style={input} placeholder="unlock-sao-paulo" value={n.root} onChange={(e) => setN({ ...n, root: e.target.value })} />
            </label>
            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Race (card back)</span>
              <input style={input} placeholder="São Paulo" value={n.race} onChange={(e) => setN({ ...n, race: e.target.value })} />
            </label>
            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Season</span>
              <input style={input} value={n.season} onChange={(e) => setN({ ...n, season: e.target.value })} />
            </label>
          </div>
          <label style={{ display: "grid", gap: 3 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Figma board (link)</span>
            <input style={input} placeholder="https://www.figma.com/design/…" value={n.figmaUrl} onChange={(e) => setN({ ...n, figmaUrl: e.target.value })} />
          </label>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>The hub is the page at that URL; every page one level below becomes an activation with its Team Card, deeper pages (e.g. QR pages) join it.</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" disabled={!n.name || !n.root} onClick={async () => { if (await save(n, "_new")) { setAdding(false); setN({ name: "", root: "", race: "", season: n.season, figmaUrl: "" }); } }}>
              Add campaign
            </button>
            <button className="btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            {msg._new && <span style={{ fontSize: 12, color: "var(--muted)" }}>{msg._new}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
