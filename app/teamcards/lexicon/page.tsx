"use client";

// Lexicon: the team's writing rules for Team Cards (extend them here, Claude and
// the copy check follow them) and the approved wordings per field (saved in the
// text panel or learned from applied changes).
import { useEffect, useMemo, useState } from "react";
import { FIELDS } from "@/lib/teamCardFields";

type Rule = { id: string; text: string; field?: string; by: string; at: string };
type Entry = { id: string; field: string; en: string; de: string; note?: string; uses: number; cards: string[]; saved: boolean; by: string; at: string };

const label = (k?: string) => (k ? FIELDS.find((f) => f.key === k)?.label ?? k : "All texts");
const FIELD_OPTS = FIELDS.filter((f) => f.localized);

async function post(body: unknown) {
  const r = await fetch("/api/teamcards/lexicon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: "Network error" }));
  if (r.error) throw new Error(r.error);
  return r as { rules?: Rule[]; entries?: Entry[] };
}

export default function Lexicon() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState({ text: "", field: "" });
  const [edit, setEdit] = useState<{ id: string; text: string; field: string } | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/teamcards/lexicon")
      .then((r) => r.json())
      .then((j) => {
        setRules(j.rules ?? []);
        setEntries(j.entries ?? []);
      })
      .catch(() => setErr("Could not load the lexicon"));
  }, []);

  const run = async (body: unknown) => {
    setErr("");
    try {
      const r = await post(body);
      if (r.rules) setRules(r.rules);
      if (r.entries) setEntries(r.entries);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
      return false;
    }
  };

  // rules for all texts first, then per field
  const grouped = useMemo(() => {
    const g: Record<string, Rule[]> = {};
    for (const r of rules ?? []) (g[r.field ?? ""] ??= []).push(r);
    return Object.entries(g).sort((a, b) => (a[0] ? 1 : -1) - (b[0] ? 1 : -1) || label(a[0]).localeCompare(label(b[0])));
  }, [rules]);

  const words = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = entries.filter((e) => !n || [e.en, e.de, label(e.field)].join(" ").toLowerCase().includes(n));
    const g: Record<string, Entry[]> = {};
    for (const e of list) (g[e.field] ??= []).push(e);
    for (const k of Object.keys(g)) g[k].sort((a, b) => Number(b.saved) - Number(a.saved) || b.uses - a.uses);
    return Object.entries(g).sort((a, b) => label(a[0]).localeCompare(label(b[0])));
  }, [entries, q]);

  const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--border)" };
  const ghost: React.CSSProperties = { all: "unset", cursor: "pointer", fontSize: 12, color: "var(--muted)" };

  return (
    <div style={{ display: "grid", gap: 28, maxWidth: 900 }}>
      <header style={{ display: "grid", gap: 6 }}>
        <h1 style={{ margin: 0 }}>Lexicon</h1>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 14, lineHeight: 1.5 }}>The rules every Team Card text follows, and the wordings the team approved. Claude and the copy check use both.</p>
      </header>
      {err && <div role="alert" style={{ color: "#e06c5b", fontSize: 13 }}>{err}</div>}

      <section aria-label="Rules" style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Rules</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run({ action: "rule-add", text: draft.text, field: draft.field })) setDraft({ text: "", field: draft.field });
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <input className="input" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="New rule, e.g. Race names in English on DE pages too" aria-label="New rule" style={{ flex: "1 1 320px" }} />
          <select className="input" value={draft.field} onChange={(e) => setDraft({ ...draft, field: e.target.value })} aria-label="Applies to" style={{ width: "auto" }}>
            <option value="">All texts</option>
            {FIELD_OPTS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" disabled={!draft.text.trim()}>
            Add rule
          </button>
        </form>
        {!rules && <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading …</div>}
        {grouped.map(([field, list]) => (
          <div key={field || "all"} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)", background: "var(--bg-2)" }}>{label(field)}</div>
            {list.map((r) =>
              edit?.id === r.id ? (
                <form
                  key={r.id}
                  style={{ ...row, gridTemplateColumns: "minmax(0,1fr) auto auto auto" }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run({ action: "rule-update", id: r.id, text: edit.text, field: edit.field })) setEdit(null);
                  }}
                >
                  <input className="input" autoFocus value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} aria-label="Rule" />
                  <select className="input" value={edit.field} onChange={(e) => setEdit({ ...edit, field: e.target.value })} aria-label="Applies to" style={{ width: "auto" }}>
                    <option value="">All texts</option>
                    {FIELD_OPTS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-primary">Save</button>
                  <button type="button" className="btn" onClick={() => setEdit(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div key={r.id} style={row}>
                  <span style={{ fontSize: 14 }}>{r.text}</span>
                  <span style={{ display: "flex", gap: 14 }}>
                    <button style={ghost} onClick={() => setEdit({ id: r.id, text: r.text, field: r.field ?? "" })}>
                      Edit
                    </button>
                    <button style={ghost} onClick={() => void run({ action: "rule-remove", id: r.id })}>
                      Remove
                    </button>
                  </span>
                </div>
              ),
            )}
          </div>
        ))}
      </section>

      <section aria-label="Approved wordings" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Approved wordings</h2>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Saved with “Save to lexicon” in the text panel, or learned from applied changes.</span>
        </div>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search wordings" aria-label="Search wordings" style={{ width: "min(320px,100%)" }} />
        {words.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>{q ? "Nothing matches." : "No wordings yet. Save one from the text panel of a card."}</div>}
        {words.map(([field, list]) => (
          <div key={field} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)", background: "var(--bg-2)" }}>{label(field)}</div>
            {list.map((e) => (
              <div key={e.id} style={{ ...row, alignItems: "start" }}>
                <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 14 }}>
                    <b style={{ fontSize: 10.5, color: "var(--muted)", marginRight: 8 }}>EN</b>
                    {e.en || <i style={{ color: "var(--muted)" }}>empty</i>}
                  </span>
                  <span style={{ fontSize: 14 }}>
                    <b style={{ fontSize: 10.5, color: "var(--muted)", marginRight: 8 }}>DE</b>
                    {e.de || <i style={{ color: "var(--muted)" }}>empty</i>}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {e.saved ? "Saved on purpose" : "Learned"}
                    {e.uses ? ` · used on ${e.uses} card${e.uses === 1 ? "" : "s"}` : ""}
                  </span>
                </div>
                <button style={ghost} onClick={() => void run({ action: "remove", id: e.id })}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
