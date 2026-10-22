"use client";

// Sync status on top of the Team Cards overview: 01 Staging ⇄ 02 Ktulu ⇄ 03 Figma.
// Checked every time the tool opens. A change shows on its arrow with a button;
// the review sheet lists every field (old → new, EN/DE, where it came from),
// the person ticks what to take over, picks a side for conflicts, approves.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Dir = "to-ktulu" | "to-staging" | "conflict";
type TextRow = { id: string; card: string; cardName: string; key: string; label: string; locale: "en" | "de" | null; kind: "text" | "setting" | "image"; ktulu: string; staging: string; dir: Dir; stagingAt?: string };
type FigmaRow = { id: string; campaign: string; page: string; block: string; layer: string; kind: "text" | "image"; cms: string; figma: string; dir: "from-figma" | "conflict" };
type ArtRow = { id: string; card: string; cardName: string; art: string; at: string; preview: string };
export type SyncStatus = { checkedAt: string; staging: TextRow[]; onlyKtulu: { id: string; name: string }[]; figma: FigmaRow[]; figmaPending: { campaign: string; name: string; count: number; figmaUrl: string; reportedAt: string | null }[]; art: ArtRow[]; errors: string[] };

const when = (s?: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const time = (s?: string | null) => (s ? new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
const TONE = { ok: "#7fd6a2", change: "#f0b35a", conflict: "#ff7a66" } as const;

export function cardSyncState(s: SyncStatus | null, id: string): "ok" | "change" | "conflict" | null {
  if (!s) return null;
  const mine = [...s.staging.filter((r) => r.card === id), ...s.art.filter((r) => r.card === id)];
  if (!mine.length) return "ok";
  return mine.some((r) => "dir" in r && r.dir === "conflict") ? "conflict" : "change";
}

// headless: no bar of its own (the "Where we are" panel shows the result); it still checks and opens the review sheet
export default function SyncBar({ onStatus, onSynced, openFor, onCloseFor, headless, request, recheck, onChecking }: { onStatus?: (s: SyncStatus | null) => void; onSynced?: () => void; openFor?: string | null; onCloseFor?: () => void; headless?: boolean; request?: { only?: "staging" | "figma"; n: number } | null; recheck?: number; onChecking?: (b: boolean) => void }) {
  const [s, setS] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sheet, setSheet] = useState<null | { only?: "staging" | "figma"; card?: string }>(null);

  const check = useCallback(async () => {
    setBusy(true);
    setErr("");
    // the last result right away, then a fresh check
    const cached = await fetch("/api/teamcards/sync?cached=1").then((r) => r.json()).catch(() => null);
    if (cached?.checkedAt) setS(cached);
    const j = await fetch("/api/teamcards/sync").then((r) => r.json()).catch(() => ({ error: "Network error" }));
    setBusy(false);
    if (j.error) return setErr(j.error);
    setS(j);
  }, []);
  useEffect(() => void check(), [check, recheck]);
  useEffect(() => onChecking?.(busy), [busy, onChecking]);
  useEffect(() => {
    if (request) setSheet({ only: request.only });
  }, [request]);
  useEffect(() => onStatus?.(s), [s, onStatus]);
  useEffect(() => {
    if (openFor) setSheet({ card: openFor });
  }, [openFor]);

  const n = useMemo(() => {
    if (!s) return null;
    const st = s.staging;
    return {
      toKtulu: st.filter((r) => r.dir === "to-ktulu").length,
      toStaging: st.filter((r) => r.dir === "to-staging").length,
      conflicts: st.filter((r) => r.dir === "conflict").length,
      fromFigma: s.figma.filter((r) => r.dir === "from-figma").length + s.art.length,
      figmaConflicts: s.figma.filter((r) => r.dir === "conflict").length,
      toFigma: s.figmaPending.reduce((a, p) => a + p.count, 0),
      cards: new Set([...st.map((r) => r.card), ...s.art.map((r) => r.card)]).size,
    };
  }, [s]);
  const left = n ? n.toKtulu + n.toStaging + n.conflicts : 0;
  const right = n ? n.fromFigma + n.figmaConflicts + n.toFigma : 0;
  const allGood = !!n && !left && !right && !s?.errors.length;

  const dot = (tone: keyof typeof TONE | "wait") => <span aria-hidden style={{ width: 9, height: 9, borderRadius: 99, background: tone === "wait" ? "var(--muted)" : TONE[tone], boxShadow: tone === "wait" ? undefined : `0 0 0 3px ${TONE[tone]}22`, flexShrink: 0 }} />;
  const station = (no: string, name: string, tone: keyof typeof TONE | "wait", note: string) => (
    <div style={{ display: "grid", gap: 2, padding: "10px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-2)", minWidth: 150 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {dot(tone)}
        <span style={{ fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{no}</span>
        <b style={{ fontSize: 14 }}>{name}</b>
      </div>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{note}</span>
    </div>
  );
  const arrow = (children: React.ReactNode) => <div style={{ display: "grid", justifyItems: "center", gap: 6, padding: "0 6px", minWidth: 190 }}>{children}</div>;
  const pill = (label: string, tone: keyof typeof TONE, onClick?: () => void, href?: string) =>
    href ? (
      <a className="btn" href={href} target="_blank" rel="noreferrer" style={{ fontSize: 12, padding: "4px 10px", borderColor: TONE[tone], color: "var(--fg)" }}>
        {label}
      </a>
    ) : (
      <button className="btn" onClick={onClick} style={{ fontSize: 12, padding: "4px 10px", borderColor: TONE[tone] }}>
        {label}
      </button>
    );

  if (headless) return sheet && s ? <Review s={s} only={sheet.only} card={sheet.card} onClose={() => { setSheet(null); onCloseFor?.(); }} onDone={(fresh) => { if (fresh) setS(fresh); onSynced?.(); }} /> : null;
  if (allGood && !sheet)
    return (
      <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--muted)" }}>
        {dot("ok")}
        <span>
          <b style={{ color: "var(--fg)" }}>Staging, Ktulu and Figma are in sync</b> · checked {time(s?.checkedAt)}
          {s && s.onlyKtulu.length > 0 && ` · ${s.onlyKtulu.length} card${s.onlyKtulu.length === 1 ? "" : "s"} only in Ktulu (not built on staging)`}
        </span>
        <button onClick={() => void check()} disabled={busy} style={{ all: "unset", cursor: "pointer", textDecoration: "underline" }}>
          {busy ? "Checking …" : "Check again"}
        </button>
      </div>
    );

  return (
    <section aria-label="Sync status" style={{ display: "grid", gap: 10, padding: 14, borderRadius: 14, border: `1px solid ${n && (n.conflicts || n.figmaConflicts) ? TONE.conflict : n && (left || right) ? TONE.change : "var(--border)"}`, background: "rgba(255,255,255,.02)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>Sync status</b>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {busy ? "Checking staging, Ktulu and Figma …" : s ? `Checked ${time(s.checkedAt)}${n?.cards ? ` · ${n.cards} card${n.cards === 1 ? "" : "s"} affected` : ""}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {(left || right) > 0 && (
          <button className="btn btn-primary" onClick={() => setSheet({})} style={{ height: 30 }}>
            Review and sync all
          </button>
        )}
        <button className="btn" onClick={() => void check()} disabled={busy} style={{ height: 30 }}>
          {busy ? "Checking …" : "Check again"}
        </button>
      </div>
      {err && <div role="alert" style={{ color: TONE.conflict, fontSize: 13 }}>{err}</div>}
      {n && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, overflowX: "auto" }}>
          {station("01", "Staging", n.conflicts ? "conflict" : n.toStaging ? "change" : "ok", n.toStaging ? `${n.toStaging} from Ktulu not on staging` : "CMS · staging.audif1team.com")}
          {arrow(
            left ? (
              <>
                {n.toKtulu > 0 && pill(`${n.toKtulu} staging → Ktulu`, "change", () => setSheet({ only: "staging" }))}
                {n.toStaging > 0 && pill(`${n.toStaging} Ktulu → staging`, "change", () => setSheet({ only: "staging" }))}
                {n.conflicts > 0 && pill(`${n.conflicts} conflict${n.conflicts === 1 ? "" : "s"}: pick a side`, "conflict", () => setSheet({ only: "staging" }))}
              </>
            ) : (
              <span style={{ fontSize: 12, color: TONE.ok }}>⇄ in sync</span>
            ),
          )}
          {station("02", "Ktulu", n.conflicts ? "conflict" : n.toKtulu ? "change" : "ok", s && s.onlyKtulu.length ? `${s.onlyKtulu.length} only in Ktulu` : "Card records")}
          {arrow(
            right ? (
              <>
                {n.fromFigma > 0 && pill(`${n.fromFigma} Figma → staging + Ktulu`, "change", () => setSheet({ only: "figma" }))}
                {n.figmaConflicts > 0 && pill(`${n.figmaConflicts} conflict${n.figmaConflicts === 1 ? "" : "s"}: pick a side`, "conflict", () => setSheet({ only: "figma" }))}
                {s!.figmaPending.map((p) => (
                  <span key={p.campaign} style={{ display: "grid", justifyItems: "center", gap: 2 }}>
                    {pill(`${p.count} → ${p.name} board: open Figma`, "change", undefined, p.figmaUrl)}
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>run AF1 Ktulu Sync there{p.reportedAt ? ` · last ${when(p.reportedAt)}` : ""}</span>
                  </span>
                ))}
              </>
            ) : (
              <span style={{ fontSize: 12, color: TONE.ok }}>⇄ in sync</span>
            ),
          )}
          {station("03", "Figma", n.figmaConflicts ? "conflict" : n.fromFigma || n.toFigma ? "change" : "ok", n.toFigma ? "Waits for the plugin" : "Board + plugin")}
        </div>
      )}
      {s && s.errors.length > 0 && (
        <details style={{ fontSize: 12, color: "var(--muted)" }}>
          <summary style={{ cursor: "pointer" }}>{s.errors.length} could not be checked</summary>
          {s.errors.map((e, i) => <div key={i}>{e}</div>)}
        </details>
      )}
      {sheet && s && <Review s={s} only={sheet.only} card={sheet.card} onClose={() => { setSheet(null); onCloseFor?.(); }} onDone={(fresh) => { if (fresh) setS(fresh); onSynced?.(); }} />}
    </section>
  );
}

function Review({ s, only, card, onClose, onDone }: { s: SyncStatus; only?: "staging" | "figma"; card?: string; onClose: () => void; onDone: (fresh: SyncStatus | null) => void }) {
  const staging = s.staging.filter((r) => (!card || r.card === card) && only !== "figma");
  const figma = only === "staging" || card ? [] : s.figma;
  const art = only === "staging" ? [] : s.art.filter((r) => !card || r.card === card);
  // ticked by default; conflicts start without a side
  const [pick, setPick] = useState<Record<string, string>>(() => {
    const p: Record<string, string> = {};
    for (const r of staging) p[r.id] = r.dir === "conflict" ? "" : r.dir;
    for (const r of figma) p[r.id] = r.dir === "conflict" ? "" : "figma";
    for (const r of art) p[r.id] = "take";
    return p;
  });
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ done: string[]; errors: string[] } | null>(null);
  const chosen = Object.values(pick).filter(Boolean).length;
  const open = [...staging, ...figma].filter((r) => r.dir === "conflict" && !pick[r.id]).length;

  async function approve() {
    setBusy(true);
    const body = {
      staging: staging.filter((r) => pick[r.id]).map((r) => ({ id: r.id, dir: pick[r.id] })),
      figma: figma.filter((r) => pick[r.id]).map((r) => ({ id: r.id, side: pick[r.id] })),
      art: art.filter((r) => pick[r.id]).map((r) => r.card),
    };
    const j = await fetch("/api/teamcards/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ errors: ["Network error"], done: [] }));
    setBusy(false);
    setReport({ done: j.done ?? [], errors: j.errors ?? (j.error ? [j.error] : []) });
    onDone(j.status ?? null);
  }

  const set = (id: string, v: string) => setPick((p) => ({ ...p, [id]: p[id] === v ? "" : v }));
  const box: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,.03)", fontSize: 13, display: "grid", gap: 4 };
  const val = (v: string, tone?: string) => <span style={{ color: tone, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{v || <i style={{ color: "var(--muted)" }}>empty</i>}</span>;
  const side = (id: string, v: string, label: string) => (
    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer", fontSize: 12 }}>
      <input type="radio" name={id} checked={pick[id] === v} onChange={() => set(id, v)} /> {label}
    </label>
  );
  const groups: [string, TextRow[]][] = [
    ["Changed on staging → take into Ktulu", staging.filter((r) => r.dir === "to-ktulu")],
    ["Changed in Ktulu → write to staging", staging.filter((r) => r.dir === "to-staging")],
    ["Changed on both sides → pick one", staging.filter((r) => r.dir === "conflict")],
  ];

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Review and sync" onClick={(e) => e.target === e.currentTarget && !busy && onClose()} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card" style={{ width: "min(880px, 100%)", maxHeight: "88vh", overflow: "auto", padding: 22, background: "var(--bg-2)", display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Review and sync{card ? ` · ${card}` : ""}</h2>
          <button className="btn" style={{ padding: "3px 10px" }} onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>
        {report ? (
          <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
            <b>{report.errors.length ? "Synced with problems" : "Synced"}</b>
            {report.done.map((d, i) => <div key={i} style={{ color: TONE.ok }}>✓ {d}</div>)}
            {report.errors.map((d, i) => <div key={i} style={{ color: TONE.conflict }}>✗ {d}</div>)}
            {!report.done.length && !report.errors.length && <div style={{ color: "var(--muted)" }}>Nothing to do.</div>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={onClose}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Ticked changes are applied, each logged on its card with your name. Untick what should stay as it is. Figma itself only changes when the plugin runs on the board.</p>
            {groups.map(([title, list]) =>
              list.length ? (
                <div key={title} style={{ display: "grid", gap: 6 }}>
                  <b style={{ fontSize: 13 }}>{title} ({list.length})</b>
                  {list.map((r) => (
                    <div key={r.id} style={box}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        {r.dir !== "conflict" && <input type="checkbox" aria-label={`Apply ${r.label}`} checked={!!pick[r.id]} onChange={() => set(r.id, r.dir)} />}
                        <b>{r.card}</b>
                        <span style={{ color: "var(--muted)" }}>{r.cardName}</span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 12 }}>
                          {r.label}
                          {r.locale ? ` ${r.locale.toUpperCase()}` : ""}
                        </span>
                        {r.stagingAt && <span style={{ fontSize: 11, color: "var(--muted)" }}>staging {when(r.stagingAt)}</span>}
                      </div>
                      {r.kind === "image" ? (
                        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/sitemap/media/${r.ktulu}`} alt="Ktulu" style={{ width: 48, aspectRatio: "4/5", objectFit: "cover", borderRadius: 4 }} />
                          <span>Ktulu</span>
                          <span>⇄</span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/sitemap/media/${r.staging}`} alt="Staging" style={{ width: 48, aspectRatio: "4/5", objectFit: "cover", borderRadius: 4 }} />
                          <span>Staging</span>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: "2px 10px", fontSize: 12.5 }}>
                          <span style={{ color: "var(--muted)" }}>Ktulu</span>
                          {val(r.ktulu, r.dir === "to-ktulu" ? "#ff9a84" : r.dir === "to-staging" ? TONE.ok : undefined)}
                          <span style={{ color: "var(--muted)" }}>Staging</span>
                          {val(r.staging, r.dir === "to-ktulu" ? TONE.ok : r.dir === "to-staging" ? "#ff9a84" : undefined)}
                        </div>
                      )}
                      {r.dir === "conflict" && (
                        <div style={{ display: "flex", gap: 16 }}>
                          {side(r.id, "to-ktulu", "Keep staging")}
                          {side(r.id, "to-staging", "Keep Ktulu")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : null,
            )}
            {figma.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                <b style={{ fontSize: 13 }}>From Figma ({figma.length})</b>
                {figma.map((r) => (
                  <div key={r.id} style={box}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      {r.dir !== "conflict" && <input type="checkbox" aria-label={`Apply ${r.layer}`} checked={!!pick[r.id]} onChange={() => set(r.id, "figma")} />}
                      <b>{r.page}</b>
                      <span style={{ color: "var(--muted)" }}>{r.block}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 12 }}>{r.layer}</span>
                    </div>
                    {r.kind === "image" ? (
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>Image changed in Figma</div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: "2px 10px", fontSize: 12.5 }}>
                        <span style={{ color: "var(--muted)" }}>Staging</span>
                        {val(r.cms, r.dir === "from-figma" ? "#ff9a84" : undefined)}
                        <span style={{ color: "var(--muted)" }}>Figma</span>
                        {val(r.figma, r.dir === "from-figma" ? TONE.ok : undefined)}
                      </div>
                    )}
                    {r.dir === "conflict" && (
                      <div style={{ display: "flex", gap: 16 }}>
                        {side(r.id, "cms", "Keep staging")}
                        {side(r.id, "figma", "Keep Figma")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {art.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                <b style={{ fontSize: 13 }}>Card images changed in Figma ({art.length})</b>
                {art.map((r) => (
                  <label key={r.id} style={{ ...box, gridTemplateColumns: "auto 48px 1fr", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!pick[r.id]} onChange={() => set(r.id, "take")} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.preview} alt={`New artwork for ${r.cardName}`} style={{ width: 48, aspectRatio: "4/5", objectFit: "cover", borderRadius: 4 }} />
                    <span>
                      <b>{r.card}</b> {r.cardName}
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                        {r.art} · {when(r.at)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {!staging.length && !figma.length && !art.length && <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing waiting{card ? " for this card" : ""}.</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, position: "sticky", bottom: -22, padding: "12px 0", background: "var(--bg-2)" }}>
              {open > 0 && <span style={{ fontSize: 12, color: TONE.conflict }}>{open} conflict{open === 1 ? "" : "s"} without a side stay as they are</span>}
              <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void approve()} disabled={busy || !chosen}>
                {busy ? "Syncing …" : `Approve and sync ${chosen}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
