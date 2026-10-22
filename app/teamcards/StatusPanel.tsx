"use client";

// "Where we are": one short summary of all Team Cards and a few next steps in
// plain words, each with one button. Built from the card checks and the sync
// check (Staging ⇄ Ktulu ⇄ Figma); the detailed review sheet sits behind it.
import { useState } from "react";
import type { SyncStatus } from "./SyncBar";

type Card = { id: string; name: string; status: string; links: { badge?: string }; check: { missing: string[]; quick: "Ready" | "Missing" | "Disabled" } };
type Step = { key: string; tone: "red" | "orange" | "blue"; text: string; detail?: string; action?: { label: string; run: () => void | Promise<void>; primary?: boolean }; show?: string[] };

const TONE = { red: "#ff7a66", orange: "#f0b35a", blue: "#8fb8ff" };
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export default function StatusPanel({ cards, sync, checking, onShow, onReview, onDone }: { cards: Card[]; sync: SyncStatus | null; checking: boolean; onShow: (label: string, ids: string[]) => void; onReview: (only?: "staging" | "figma") => void; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const total = cards.length;
  const ready = cards.filter((c) => c.check.quick === "Ready").length;
  const disabled = cards.filter((c) => c.check.quick === "Disabled").length;
  const notBuilt = cards.filter((c) => !c.links.badge);
  const live = notBuilt.filter((c) => /live/i.test(c.status));
  const toBuild = notBuilt.filter((c) => !/live/i.test(c.status));
  const has = (m: RegExp) => cards.filter((c) => c.links.badge && c.check.missing.some((x) => m.test(x)));
  const noImage = has(/card image/i);
  const noSetup = has(/mechanic|reward type|placement/i);
  const noTexts = cards.filter((c) => c.links.badge && c.check.missing.some((x) => !/card image|mechanic|reward type|placement|campaign tag|not built/i.test(x)));

  // sync: gaps (Ktulu empty, staging has it) are safe to take over in one go
  const rows = sync?.staging ?? [];
  const gaps = rows.filter((r) => r.dir === "to-ktulu" && !r.ktulu.trim());
  const changes = rows.filter((r) => !(r.dir === "to-ktulu" && !r.ktulu.trim()));
  const conflicts = rows.filter((r) => r.dir === "conflict").length + (sync?.figma ?? []).filter((r) => r.dir === "conflict").length;
  const fromFigma = (sync?.figma ?? []).filter((r) => r.dir === "from-figma").length + (sync?.art ?? []).length;

  async function takeGaps() {
    setBusy("gaps");
    const j = await fetch("/api/teamcards/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staging: gaps.map((r) => ({ id: r.id, dir: "to-ktulu" })) }) }).then((r) => r.json()).catch(() => ({ errors: ["Network error"] }));
    setBusy(null);
    setNote(j.errors?.length ? `Not everything worked: ${j.errors.join("; ")}` : `Done: ${plural(gaps.length, "value")} taken over from staging.`);
    onDone();
  }

  const steps: Step[] = [];
  if (conflicts) steps.push({ key: "conflicts", tone: "red", text: `${plural(conflicts, "text")} changed in two places. Pick which one stays.`, action: { label: "Decide", run: () => onReview(), primary: true } });
  if (gaps.length) steps.push({ key: "gaps", tone: "orange", text: `Staging has ${plural(gaps.length, "value")} that Ktulu doesn't know yet (${[...new Set(gaps.map((r) => r.label))].slice(0, 3).join(", ")}${new Set(gaps.map((r) => r.label)).size > 3 ? " …" : ""}).`, detail: "Safe: only fills empty fields in Ktulu.", action: { label: busy === "gaps" ? "Taking over …" : "Take over", run: takeGaps, primary: true }, show: [...new Set(gaps.map((r) => r.card))] });
  if (changes.filter((r) => r.dir !== "conflict").length) steps.push({ key: "changes", tone: "orange", text: `${plural(changes.filter((r) => r.dir !== "conflict").length, "text")} differ between staging and Ktulu.`, detail: "Check old and new before syncing.", action: { label: "Review", run: () => onReview("staging") } });
  if (fromFigma) steps.push({ key: "figma-in", tone: "orange", text: `${plural(fromFigma, "change")} made in Figma ${fromFigma === 1 ? "is" : "are"} waiting for staging.`, action: { label: "Review", run: () => onReview("figma") } });
  for (const p of sync?.figmaPending ?? []) steps.push({ key: `figma-${p.campaign}`, tone: "blue", text: `The ${p.name} Figma board is ${plural(p.count, "change")} behind.`, detail: "Open the board in the Figma app and run AF1 Ktulu Sync once.", action: { label: "Open Figma", run: () => void window.open(p.figmaUrl, "_blank") } });
  if (live.length) steps.push({ key: "live", tone: "blue", text: `${plural(live.length, "card")} ${live.length === 1 ? "is" : "are"} live on production but not on staging.`, detail: "Select them below and use “Get from production”.", show: live.map((c) => c.id) });
  if (noTexts.length) steps.push({ key: "texts", tone: "orange", text: `${plural(noTexts.length, "card")} on staging ${noTexts.length === 1 ? "misses" : "miss"} texts.`, show: noTexts.map((c) => c.id) });
  if (noSetup.length) steps.push({ key: "setup", tone: "orange", text: `${plural(noSetup.length, "card")} ${noSetup.length === 1 ? "has" : "have"} no unlock mechanic, reward or page yet.`, detail: "Open a card and finish its Setup step.", show: noSetup.map((c) => c.id) });
  if (noImage.length) steps.push({ key: "image", tone: "orange", text: `${plural(noImage.length, "card")} ${noImage.length === 1 ? "has" : "have"} no card image.`, show: noImage.map((c) => c.id) });
  if (toBuild.length) steps.push({ key: "build", tone: "blue", text: `${plural(toBuild.length, "card")} ${toBuild.length === 1 ? "is" : "are"} briefed but not built on staging yet.`, show: toBuild.map((c) => c.id) });

  const synced = sync && !rows.length && !fromFigma && !(sync.figmaPending ?? []).length;
  return (
    <section aria-label="Where we are" style={{ display: "grid", gap: 12, padding: 16, borderRadius: 14, border: "1px solid var(--border)", background: "rgba(255,255,255,.02)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <b style={{ fontSize: 16 }}>Where we are</b>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {total} cards · <span style={{ color: "#7fd6a2" }}>{ready} ready</span> · {disabled} switched off on staging · {total - ready - disabled} in progress
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: synced ? "#7fd6a2" : "var(--muted)" }}>{checking ? "Checking Staging, Ktulu and Figma …" : synced ? "Staging, Ktulu and Figma match" : sync ? `Checked ${new Date(sync.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
      </div>
      {steps.length === 0 ? (
        <div style={{ fontSize: 14, color: "#7fd6a2" }}>Nothing to do. Everything is in sync and complete.</div>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
          {steps.slice(0, 7).map((s, i) => (
            <li key={s.key} style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,.03)" }}>
              <span aria-hidden style={{ width: 22, height: 22, borderRadius: 99, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: "#0c0d0e", background: TONE[s.tone] }}>{i + 1}</span>
              <span style={{ fontSize: 14, lineHeight: 1.4 }}>
                {s.text}
                {s.detail && <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{s.detail}</span>}
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                {s.show && (
                  <button className="btn" style={{ height: 30, fontSize: 12.5 }} onClick={() => onShow(s.text, s.show!)}>
                    Show {s.show.length === 1 ? "it" : "them"}
                  </button>
                )}
                {s.action && (
                  <button className={s.action.primary ? "btn btn-primary" : "btn"} style={{ height: 30, fontSize: 12.5 }} disabled={!!busy} onClick={() => void s.action!.run()}>
                    {s.action.label}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {note && <div role="status" style={{ fontSize: 13, color: /Not everything/.test(note) ? "#ff9a84" : "#7fd6a2" }}>{note}</div>}
    </section>
  );
}
