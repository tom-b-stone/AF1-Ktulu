"use client";

// One-way import from the ARF1 Team Cards Tracker: preview with duplicate
// check, pick the new cards, import. Never writes to the tracker.
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { createPortal } from "react-dom";
import { SideButton } from "@/app/components/SidebarSlot";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
type Card = { id: string; name: string; status: string; copyStatus: string; race?: string; match?: { cardId: string; reason: string } };

export default function TrackerImport({ onDone, side }: { onDone: () => void; side?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needGoogle, setNeedGoogle] = useState(false);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [tracker, setTracker] = useState("");

  async function preview() {
    setOpen(true);
    setBusy(true);
    setMsg(null);
    setNeedGoogle(false);
    const r = await fetch("/api/teamcards/tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview" }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.error === "google_not_connected") return setNeedGoogle(true);
    if (!r.ok) return setMsg({ tone: "err", text: j.error ?? "Could not read the tracker" });
    setTracker(j.tracker);
    setCards(j.cards);
    setPick(new Set((j.cards as Card[]).filter((c) => !c.match).map((c) => c.id)));
  }

  // back from the Google consent screen with ?import=1
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("import") === "1") void preview();
  }, []);

  async function run() {
    setBusy(true);
    const r = await fetch("/api/teamcards/tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", ids: [...pick] }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "err", text: j.error ?? "Import failed" });
    setMsg({ tone: "ok", text: `Imported ${j.added.length} card${j.added.length === 1 ? "" : "s"}${j.added.length ? `: ${j.added.join(", ")}` : ""}.${j.linked.length ? ` Linked to their tracker row: ${j.linked.join(", ")}.` : ""}${j.skipped.length ? ` Skipped as duplicates: ${j.skipped.join(", ")}.` : ""}` });
    setCards(null);
    onDone();
  }

  const fresh = (cards ?? []).filter((c) => !c.match);
  const dups = (cards ?? []).filter((c) => c.match);

  return (
    <>
      {side ? (
        <SideButton onClick={() => void preview()} note="one way">
          Import from tracker
        </SideButton>
      ) : (
        <button className="btn" onClick={() => void preview()} title="Reads the ARF1 Team Cards Tracker (read only) and adds cards that are not in Ktulu yet">
          Import from tracker
        </button>
      )}
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Import from the Team Cards Tracker" onClick={(e) => e.target === e.currentTarget && !busy && setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: 16 }}>
          <div className="card" style={{ width: "min(760px, 100%)", maxHeight: "86vh", overflow: "auto", padding: 22, background: "var(--bg-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Import from the Team Cards Tracker</h2>
              <button className="btn" style={{ padding: "3px 10px" }} onClick={() => setOpen(false)} disabled={busy} aria-label="Close">
                ✕
              </button>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 14px" }}>
              One way: the tracker is only read, never changed. New cards land in Ktulu with their copy from the tracker and are not on staging yet. Cards that already exist are not touched.
              {tracker && (
                <>
                  {" "}
                  <a href={tracker} target="_blank" rel="noreferrer">
                    Open tracker ↗
                  </a>
                </>
              )}
            </p>
            {busy && <p style={{ color: "var(--muted)" }}>Reading the tracker…</p>}
            {needGoogle && (
              <div style={{ display: "grid", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 13 }}>Ktulu needs read access to Google Drive to open the tracker with your account.</p>
                <button className="btn btn-primary" onClick={() => void signIn("google", { callbackUrl: "/teamcards?import=1" }, { scope: `openid email profile ${DRIVE_SCOPE}`, access_type: "offline", prompt: "consent", include_granted_scopes: "true" })}>
                  Connect Google Drive (read only)
                </button>
              </div>
            )}
            {msg && <div role="status" style={{ fontSize: 13, margin: "8px 0", color: msg.tone === "ok" ? "#7fd6a2" : "#ff9a84" }}>{msg.text}</div>}
            {cards && !busy && (
              <>
                <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 6px" }}>
                  {fresh.length} new · {dups.length} already in Ktulu
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  {fresh.map((c) => (
                    <label key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 8px", borderRadius: 6, background: "rgba(255,255,255,.03)", fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={pick.has(c.id)} onChange={() => setPick((p) => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                      <strong style={{ width: 64 }}>{c.id}</strong>
                      <span style={{ flex: 1 }}>{c.name}</span>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>{[c.race, c.status].filter(Boolean).join(" · ")}</span>
                    </label>
                  ))}
                  {fresh.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing new in the tracker.</div>}
                </div>
                {dups.length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer", fontSize: 13 }}>Duplicates, not imported ({dups.length})</summary>
                    <div style={{ display: "grid", gap: 2, marginTop: 6 }}>
                      {dups.map((c) => (
                        <div key={c.id} style={{ fontSize: 12, color: "var(--muted)" }}>
                          <strong style={{ color: "var(--fg)" }}>{c.id}</strong> {c.name} → {c.match!.cardId} ({c.match!.reason})
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                  <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
                  <button className="btn btn-primary" disabled={!pick.size} onClick={() => void run()}>
                    Import {pick.size} card{pick.size === 1 ? "" : "s"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        , document.body)}
    </>
  );
}
