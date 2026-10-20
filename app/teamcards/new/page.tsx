"use client";

// New Team Card: the first step of the guided setup. Name, card type, campaign
// and Grand Prix; then the card opens in the editor and the guide walks
// through the rest (card, engagement, module, reward, texts, review).
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Camp = { key: string; name: string; race: string };

export default function NewCard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [campaign, setCampaign] = useState("");
  const [race, setRace] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "types" }) })
      .then((r) => r.json())
      .then((j) => setTypes((j.types ?? []).map((t: { title: string }) => t.title)))
      .catch(() => {});
    fetch("/api/sitemap/campaigns")
      .then((r) => r.json())
      .then((j) => setCamps(j.campaigns ?? []))
      .catch(() => {});
  }, []);

  const create = async () => {
    setBusy(true);
    setErr("");
    const j = await fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "new", name, badgeType: type, campaign, race }) })
      .then((r) => r.json())
      .catch(() => ({ error: "Network error" }));
    if (j.error || !j.card) {
      setBusy(false);
      return setErr(j.error ?? "Could not create the card");
    }
    router.push(`/teamcards/${j.card.id}?guided=1`);
  };

  const pill = (on: boolean): React.CSSProperties => ({ padding: "7px 14px", borderRadius: 999, fontSize: 13, cursor: "pointer", border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "rgba(255,45,0,.14)" : "transparent", color: on ? "var(--fg)" : "var(--muted)" });
  const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
  const help: React.CSSProperties = { fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 };

  return (
    <div style={{ display: "grid", gap: 24, maxWidth: 640 }}>
      <header style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>New Team Card · step 1 of 11</span>
        <h1 style={{ margin: 0 }}>What is the card?</h1>
        <p style={{ ...help, margin: 0, fontSize: 14 }}>Start with the name and where it belongs. The guide then walks you through the card, the engagement, the module, the reward and every text, one step at a time. Nothing goes to staging until the last step.</p>
      </header>

      <label style={{ display: "grid", gap: 6 }}>
        <span style={lbl}>Name</span>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gabi's Las Vegas Helmet" />
        <span style={help}>The working name in Ktulu and the public title to start with. You can change both later.</span>
      </label>

      <div style={{ display: "grid", gap: 8 }}>
        <span style={lbl}>Card type</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(types.length ? types : ["Exclusive", "Limited", "Race"]).map((t) => (
            <button key={t} type="button" style={pill(type === t)} onClick={() => setType(type === t ? "" : t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={lbl}>Campaign</span>
          <select
            className="input"
            value={campaign}
            onChange={(e) => {
              setCampaign(e.target.value);
              const c = camps.find((x) => x.name === e.target.value);
              if (c?.race && !race) setRace(c.race);
            }}
          >
            <option value="">No campaign</option>
            {camps.map((c) => (
              <option key={c.key} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={lbl}>Grand Prix</span>
          <input className="input" value={race} onChange={(e) => setRace(e.target.value)} placeholder="e.g. Las Vegas" />
        </label>
      </div>

      {err && <div role="alert" style={{ color: "#e06c5b", fontSize: 13 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void create()} style={{ height: 38 }}>
          {busy ? "Creating …" : "Create and continue"}
        </button>
        <a href="/teamcards" style={{ fontSize: 13, color: "var(--muted)" }}>
          Cancel
        </a>
      </div>
    </div>
  );
}
