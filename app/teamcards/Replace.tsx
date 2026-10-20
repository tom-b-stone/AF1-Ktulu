"use client";

// Search and replace across all Team Cards: find a word or phrase, pick the
// language(s) and the hits to change, preview before/after, then apply to
// staging. Asks back before it writes.
import { useMemo, useState } from "react";
import { FIELDS, STEPS, type Loc, type LocValue } from "@/lib/teamCardFields";

type Card = { id: string; name: string; values: Record<string, LocValue | string | boolean | undefined> };
type Hit = { id: string; card: string; key: string; label: string; step: string; locale: Loc; before: string; after: string };
type DiffRow = { card: string; label: string; locale: Loc | null; before: unknown; after: unknown; issues: string[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default function Replace({ cards, onApplied }: { cards: Card[]; onApplied: () => void }) {
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const [langs, setLangs] = useState<Loc[]>(["en", "de"]);
  const [step, setStep] = useState<string>("");
  const [cs, setCs] = useState(false);
  const [whole, setWhole] = useState(false);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [review, setReview] = useState<{ rows: DiffRow[]; errors: string[] } | null>(null);
  const [result, setResult] = useState<{ pushed: string[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [askLang, setAskLang] = useState(false);

  const hits = useMemo<Hit[]>(() => {
    if (!find.trim()) return [];
    const re = new RegExp(whole ? `\\b${esc(find)}\\b` : esc(find), cs ? "g" : "gi");
    const out: Hit[] = [];
    for (const c of cards)
      for (const f of FIELDS) {
        if (!f.localized || (step && f.step !== step)) continue;
        for (const l of langs) {
          const v = ((c.values[f.key] as LocValue | undefined)?.[l] ?? "") as string;
          if (v && re.test(v)) {
            re.lastIndex = 0;
            out.push({ id: `${c.id}|${f.key}|${l}`, card: c.id, key: f.key, label: f.label, step: f.step, locale: l, before: v, after: v.replace(re, repl) });
          }
          re.lastIndex = 0;
        }
      }
    return out;
  }, [find, repl, langs, step, cs, whole, cards]);

  const chosen = hits.filter((h) => !off[h.id]);
  const changes = chosen.map((h) => ({ card: h.card, key: h.key, locale: h.locale, value: h.after }));
  const enOnly = langs.length === 1;

  async function preview() {
    if (enOnly && !askLang) {
      setAskLang(true);
      return;
    }
    setAskLang(false);
    setBusy(true);
    setResult(null);
    const j = await fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", changes }) }).then((r) => r.json());
    setReview(j.rows ? j : { rows: [], errors: [j.error ?? "failed"] });
    setBusy(false);
  }
  async function apply() {
    setBusy(true);
    const j = await fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", changes }) }).then((r) => r.json());
    window.dispatchEvent(new Event("af1:changed"));
    setResult({ pushed: j.pushed ?? [], errors: j.errors ?? (j.error ? [j.error] : []) });
    setReview(null);
    setBusy(false);
    onApplied();
  }

  const mark = (text: string) => {
    if (!find) return text;
    const re = new RegExp(`(${whole ? `\\b${esc(find)}\\b` : esc(find)})`, cs ? "g" : "gi");
    return text.split(re).map((p, i) => (i % 2 ? <mark key={i} style={{ background: "rgba(227,62,26,.25)", color: "inherit" }}>{p}</mark> : p));
  };

  return (
    <section id="replace" aria-label="Search and replace" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", display: "grid", gap: 10, background: "var(--bg-2)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span className="section-label">Search and replace</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>Change wording on every card at once. Pick the hits, check, apply to staging.</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
        <input className="input" placeholder="Find…" value={find} onChange={(e) => { setFind(e.target.value); setReview(null); setResult(null); }} aria-label="Find" />
        <input className="input" placeholder="Replace with…" value={repl} onChange={(e) => { setRepl(e.target.value); setReview(null); }} aria-label="Replace with" />
      </div>
      <div style={{ display: "flex", gap: "8px 16px", flexWrap: "wrap", fontSize: 12, alignItems: "center" }}>
        <span style={{ color: "var(--muted)" }}>Languages</span>
        {(["en", "de"] as Loc[]).map((l) => (
          <label key={l} style={{ display: "flex", gap: 4 }}>
            <input type="checkbox" checked={langs.includes(l)} onChange={(e) => setLangs((cur) => (e.target.checked ? [...cur, l] : cur.filter((x) => x !== l)))} /> {l === "en" ? "English" : "German"}
          </label>
        ))}
        <span style={{ color: "var(--muted)" }}>In</span>
        <select className="input" style={{ width: "auto", padding: "4px 8px" }} value={step} onChange={(e) => setStep(e.target.value)}>
          <option value="">all texts</option>
          {STEPS.filter((s) => s !== "Settings" && s !== "Reward").map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", gap: 4 }}>
          <input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Match case
        </label>
        <label style={{ display: "flex", gap: 4 }}>
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Whole words
        </label>
      </div>

      {find.trim() && (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {hits.length ? `${hits.length} hit${hits.length === 1 ? "" : "s"} on ${new Set(hits.map((h) => h.card)).size} card${new Set(hits.map((h) => h.card)).size === 1 ? "" : "s"}. Untick what should stay.` : "No hits."}
        </div>
      )}
      {hits.length > 0 && (
        <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <tbody>
            {hits.map((h) => (
              <tr key={h.id} style={{ borderBottom: "1px solid var(--border)", verticalAlign: "top", opacity: off[h.id] ? 0.45 : 1 }}>
                <td style={{ padding: 6, width: 24 }}>
                  <input type="checkbox" checked={!off[h.id]} onChange={(e) => setOff((o) => ({ ...o, [h.id]: !e.target.checked }))} />
                </td>
                <td style={{ padding: 6, width: 180 }}>
                  <div>{h.card}</div>
                  <div style={{ color: "var(--muted)" }}>
                    {h.step} · {h.label} · {h.locale.toUpperCase()}
                  </div>
                </td>
                <td style={{ padding: 6 }}>{mark(h.before)}</td>
                <td style={{ padding: 6 }}>{repl || find ? h.after : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {askLang && (
        <div style={{ fontSize: 13, border: "1px solid rgba(227,62,26,0.35)", borderRadius: 10, padding: 10, display: "grid", gap: 8 }}>
          <div>You&apos;re only changing the {langs[0] === "en" ? "English" : "German"}. Should the {langs[0] === "en" ? "German" : "English"} change too?</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" style={{ padding: "4px 12px" }} onClick={() => { setLangs(["en", "de"]); setAskLang(false); }}>
              Yes, search both
            </button>
            <button className="btn" style={{ padding: "4px 12px" }} onClick={() => void preview()}>
              No, only {langs[0] === "en" ? "English" : "German"}
            </button>
          </div>
        </div>
      )}

      {chosen.length > 0 && !review && !askLang && (
        <div>
          <button className="btn btn-primary" disabled={busy} onClick={() => void preview()}>
            Check {chosen.length} change{chosen.length === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {review && (
        <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
          {review.rows.some((r) => r.issues.length) && (
            <div style={{ color: "#e06c5b" }}>
              Rule issues after the change: {review.rows.flatMap((r) => r.issues.map((i) => `${r.card} ${i}`)).join(" · ")}
            </div>
          )}
          {review.errors.length > 0 && <div style={{ color: "#e06c5b" }}>{review.errors.join(" · ")}</div>}
          <div>
            {review.rows.length} change{review.rows.length === 1 ? "" : "s"} on {new Set(review.rows.map((r) => r.card)).size} card(s) ready. Apply them to staging?
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => void apply()}>
              Yes, apply
            </button>
            <button className="btn" onClick={() => setReview(null)}>
              Not yet
            </button>
          </div>
        </div>
      )}

      {result && (
        <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
          {result.pushed.map((p, i) => (
            <div key={i}>✓ {p}</div>
          ))}
          {result.errors.map((p, i) => (
            <div key={i} style={{ color: "#e06c5b" }}>
              ✗ {p}
            </div>
          ))}
          <div style={{ color: "var(--muted)", marginTop: 4 }}>Next: open a changed card and look at it in the preview, or search for related wording (singular and plural, the German form).</div>
        </div>
      )}
    </section>
  );
}
