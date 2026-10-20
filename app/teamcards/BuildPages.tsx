"use client";
// "Build the pages from Figma": asks the AF1 Ktulu Sync plugin to turn the
// landing pages designed on the campaign's Figma board into draft pages on
// staging (modules, texts, images, the Team Card of each page). The plugin
// does it the next time it runs on the board; this box waits and then shows
// what was built.
import { useCallback, useEffect, useRef, useState } from "react";

type Built = { name: string; id: string; url: string; admin: string; created: boolean; card?: string };
type Last = { at: string; by: string; pages: Built[]; steps: { step: string; ok: boolean }[] } | null;

const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function BuildPages({ campaign, campaignName, figmaUrl, hasPages, compact, onBuilt }: { campaign: string; campaignName?: string; figmaUrl?: string; hasPages: boolean; compact?: boolean; onBuilt?: () => void }) {
  const [waiting, setWaiting] = useState<{ at: string; by: string } | null>(null);
  const [last, setLast] = useState<Last>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const built = useRef(onBuilt);
  built.current = onBuilt;

  const load = useCallback(async () => {
    const j = await fetch(`/api/sitemap/${campaign}?pages=1`).then((r) => r.json()).catch(() => null);
    if (!j || j.error) return;
    setWaiting((prev) => {
      if (prev && !j.waiting) built.current?.();
      return j.waiting;
    });
    setLast(j.last);
  }, [campaign]);
  useEffect(() => {
    void load();
  }, [load]);
  // while the plugin has the job, check every 8 s
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [waiting, load]);

  const queue = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/sitemap/${campaign}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "queue-pages" }) }).then((x) => x.json()).catch(() => ({ error: "Network error" }));
    setBusy(false);
    if (r.error) return setErr(r.error);
    setWaiting({ at: new Date().toISOString(), by: "you" });
  };

  const label = hasPages ? "Update the pages from Figma" : "Build the pages from Figma";
  const box: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: compact ? 12 : 16, display: "grid", gap: 10, background: hasPages ? "transparent" : "rgba(255,45,0,.05)" };

  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{hasPages ? "Landing pages" : `No ${campaignName ?? ""} pages on staging yet`}</div>
          <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
            {hasPages
              ? "Built from the Figma design. Run it again after design changes; pages someone made by hand are never touched."
              : "The pages are designed in Figma. One click builds them as drafts: modules, texts, images and the Team Card of each page."}
          </div>
        </div>
        {!waiting && (
          <button className={hasPages ? "btn" : "btn btn-primary"} disabled={busy} onClick={queue}>
            {busy ? "Asking …" : label}
          </button>
        )}
      </div>
      {waiting && (
        <div role="status" style={{ fontSize: 13, display: "grid", gap: 6, padding: "10px 12px", borderRadius: 10, background: "rgba(127,184,255,.08)", border: "1px solid rgba(127,184,255,.3)" }}>
          <b>Waiting for Figma.</b>
          <span style={{ color: "var(--muted)" }}>
            Open the board in the Figma desktop app and run AF1 Ktulu Sync (Plugins → Development). It builds the pages right away and this box updates by itself.
          </span>
          {figmaUrl && (
            <a href={figmaUrl} target="_blank" rel="noreferrer" style={{ justifySelf: "start" }}>
              Open the Figma board ↗
            </a>
          )}
        </div>
      )}
      {err && <div style={{ color: "#e06c5b", fontSize: 13 }}>{err}</div>}
      {last && !waiting && (
        <div style={{ fontSize: 13, display: "grid", gap: 6 }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            Last built {when(last.at)} by {last.by} · {last.pages.length} draft page{last.pages.length === 1 ? "" : "s"}
            {" · "}
            <button onClick={() => setOpen(!open)} style={{ all: "unset", cursor: "pointer", textDecoration: "underline" }}>
              {open ? "Hide report" : "Show report"}
            </button>
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            {last.pages.map((p) => (
              <a key={p.id} href={p.admin} target="_blank" rel="noreferrer" style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none", color: "inherit" }}>
                <span>
                  {p.name}
                  {p.card && <span style={{ color: "var(--muted)" }}> · {p.card}</span>}
                </span>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>/{p.url} ↗</span>
              </a>
            ))}
          </div>
          {open && (
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
              {last.steps.map((s, i) => (
                <li key={i} style={{ color: s.ok ? undefined : "#e06c5b" }}>
                  {s.step.trim()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
