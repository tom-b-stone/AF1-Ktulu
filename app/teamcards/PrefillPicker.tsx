"use client";
// "Prefill the texts": the cards that work most like this one (same engagement,
// campaign, card type). Picking one copies its texts into the empty fields and
// swaps its name for this card's name. Nothing goes to staging.
import { useEffect, useState } from "react";

type Similar = { id: string; name: string; why: string; texts: number };

export default function PrefillPicker({ cardId, onDone, compact }: { cardId: string; onDone: (r: { filled: string[]; from: string }) => void; compact?: boolean }) {
  const [list, setList] = useState<Similar[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "similar", id: cardId }) })
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setList(j.cards ?? [])))
      .catch(() => setErr("Could not find similar cards"));
  }, [cardId]);

  const take = async (from: string) => {
    setBusy(from);
    const j = await fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prefill", id: cardId, from }) })
      .then((r) => r.json())
      .catch(() => ({ error: "Network error" }));
    setBusy(null);
    if (j.error) return setErr(j.error);
    onDone({ filled: j.filled ?? [], from });
  };

  if (err) return <div role="alert" style={{ color: "#e06c5b", fontSize: 13 }}>{err}</div>;
  if (!list) return <div style={{ color: "var(--muted)", fontSize: 13 }}>Looking for similar cards …</div>;
  if (!list.length) return <div style={{ color: "var(--muted)", fontSize: 13 }}>No card with texts to start from yet.</div>;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {list.map((c) => (
        <button
          key={c.id}
          disabled={!!busy}
          onClick={() => void take(c.id)}
          style={{ all: "unset", cursor: busy ? "wait" : "pointer", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: compact ? "8px 12px" : "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: busy === c.id ? "rgba(255,45,0,.08)" : "transparent" }}
        >
          <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.name} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}>{c.id}</span>
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {c.why} · {c.texts} texts
            </span>
          </span>
          <span style={{ fontSize: 12.5, color: "var(--fg)" }}>{busy === c.id ? "Copying …" : "Use these texts"}</span>
        </button>
      ))}
    </div>
  );
}
