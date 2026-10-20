"use client";

// New Team Card as a short dialog: one question at a time, answered with a tap.
// The card exists in Ktulu right after the first answer (name → next free TC
// number); every later answer is saved straight away and can be skipped for
// now. At the end: prefill the texts from a similar card, then write them in
// the editor (guided) or build the card on staging.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PrefillPicker from "../PrefillPicker";

type Camp = { key: string; name: string; race: string; root: string; figmaFile?: string };
type Page = { id: string; url: string; title: string };
type Answer = { q: string; a: string };

const ENG = [
  { key: "page", label: "Page visit", hint: "Open the page, get the card" },
  { key: "hot-or-not", label: "Hot or Not", hint: "Swipe and rate pictures" },
  { key: "survey", label: "Survey", hint: "Any answer counts" },
  { key: "quiz", label: "Quiz", hint: "The right answer counts" },
  { key: "q-and-a", label: "Q&A", hint: "An answer in their own words" },
];
const REWARD = [
  { key: "noReward", label: "Just the card" },
  { key: "raffleSignup", label: "Raffle" },
  { key: "couponCode", label: "Voucher code" },
  { key: "downloadAsset", label: "Download" },
];
const STEPS = ["name", "type", "campaign", "image", "engagement", "reward", "module", "texts", "done"] as const;
type Step = (typeof STEPS)[number];

export default function NewCard() {
  const [step, setStep] = useState<Step>("name");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [card, setCard] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [camp, setCamp] = useState<Camp | null>(null);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [figmaImage, setFigmaImage] = useState(false);

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
  // the campaign's pages for the module question
  useEffect(() => {
    if (step !== "module") return;
    setPages(null);
    fetch(`/api/teamcards/pages?q=${encodeURIComponent(camp?.root ?? "")}`)
      .then((r) => r.json())
      .then((j) => setPages(j.pages ?? []))
      .catch(() => setPages([]));
  }, [step, camp?.root]);

  const next = (q: string, a: string) => {
    setAnswers((x) => [...x, { q, a }]);
    setErr("");
    setStep(STEPS[STEPS.indexOf(step) + 1]);
  };
  const save = async (body: { setup?: unknown; brief?: Record<string, string> }) => {
    if (!card) return false;
    setBusy(true);
    const j = await fetch(`/api/teamcards/${card.id}/setup`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => ({ error: "Network error" }));
    setBusy(false);
    if (j.error) {
      setErr(j.error);
      return false;
    }
    return true;
  };

  const create = async () => {
    setBusy(true);
    setErr("");
    const j = await fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "new", name }) })
      .then((r) => r.json())
      .catch(() => ({ error: "Network error" }));
    setBusy(false);
    if (j.error || !j.card) return setErr(j.error ?? "Could not create the card");
    setCard({ id: j.card.id, name: j.card.name });
    next("What should the card be called?", `${j.card.name} · created as ${j.card.id}`);
  };

  const upload = async (f: File) => {
    if (!card) return;
    setBusy(true);
    const { compressImage } = await import("@/lib/imageCompress");
    const c = await compressImage(f, 1600, 0.85).catch(() => null);
    const fd = new FormData();
    fd.append("file", c ? new File([c.blob], f.name.replace(/\.[a-z0-9]+$/i, c.mime === "image/webp" ? ".webp" : ".jpg"), { type: c.mime }) : f);
    const j = await fetch(`/api/teamcards/${card.id}/image`, { method: "POST", body: fd })
      .then((r) => r.json())
      .catch(() => ({ error: "Upload failed" }));
    setBusy(false);
    if (j.error) return setErr(j.error);
    next("Is there a card image?", "Uploaded");
  };

  const progress = STEPS.indexOf(step);
  const chip = (on = false): React.CSSProperties => ({ padding: "10px 16px", borderRadius: 12, fontSize: 14, cursor: "pointer", border: `1px solid ${on ? "var(--accent)" : "var(--border-2)"}`, background: on ? "rgba(255,45,0,.14)" : "var(--bg-2)", color: "var(--fg)", textAlign: "left" });
  const skip = (q: string) => (
    <button onClick={() => next(q, "Skipped for now")} style={{ all: "unset", cursor: "pointer", fontSize: 13, color: "var(--muted)", textDecoration: "underline" }}>
      Skip for now
    </button>
  );

  const question = useMemo((): { q: string; sub?: string; body: React.ReactNode } | null => {
    switch (step) {
      case "name":
        return {
          q: "What should the card be called?",
          sub: "It gets the next free number and is created in Ktulu right away. Nothing goes to staging yet.",
          body: (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void create();
              }}
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gabi's Las Vegas Helmet" style={{ flex: "1 1 280px", fontSize: 15 }} />
              <button className="btn btn-primary" disabled={!name.trim() || busy}>
                {busy ? "Creating …" : "Create the card"}
              </button>
            </form>
          ),
        };
      case "type":
        return {
          q: "What kind of card is it?",
          body: (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {(types.length ? types : ["Exclusive", "Limited", "Race"]).map((t) => (
                <button key={t} style={chip()} disabled={busy} onClick={async () => (await save({ brief: { badgeType: t } })) && next("What kind of card is it?", t)}>
                  {t}
                </button>
              ))}
              {skip("What kind of card is it?")}
            </div>
          ),
        };
      case "campaign":
        return {
          q: "Which campaign does it belong to?",
          sub: "The Grand Prix comes with the campaign.",
          body: (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {camps.map((c) => (
                <button
                  key={c.key}
                  style={chip()}
                  disabled={busy}
                  onClick={async () => {
                    if (await save({ brief: { campaign: c.name, race: c.race } })) {
                      setCamp(c);
                      next("Which campaign does it belong to?", `${c.name}${c.race && c.race !== c.name ? ` · ${c.race} GP` : ""}`);
                    }
                  }}
                >
                  {c.name}
                </button>
              ))}
              <button style={chip()} onClick={() => next("Which campaign does it belong to?", "No campaign")}>
                No campaign
              </button>
              {skip("Which campaign does it belong to?")}
            </div>
          ),
        };
      case "image":
        return {
          q: "Is there a card image in Figma?",
          sub: "In Figma, the plugin keeps the image in sync with the design. Or upload one now.",
          body: (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                style={chip()}
                disabled={busy}
                onClick={async () => {
                  if (await save({ brief: { imageSource: "figma" } })) {
                    setFigmaImage(true);
                    next("Is there a card image in Figma?", "Yes, in Figma");
                  }
                }}
              >
                Yes, it&apos;s in Figma
              </button>
              <label style={{ ...chip(), display: "inline-block" }}>
                {busy ? "Uploading …" : "Upload it now"}
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              </label>
              <button style={chip()} onClick={() => next("Is there a card image in Figma?", "Not yet")}>
                Not yet
              </button>
            </div>
          ),
        };
      case "engagement":
        return {
          q: "How do fans earn the card?",
          sub: "The engagement. Items and pictures for the task are added in the editor.",
          body: (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {ENG.map((e) => (
                <button key={e.key} style={{ ...chip(), display: "grid", gap: 2 }} disabled={busy} onClick={async () => (await save({ setup: { engagement: { type: e.key, items: [] } } })) && next("How do fans earn the card?", e.label)}>
                  <b style={{ fontWeight: 600 }}>{e.label}</b>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{e.hint}</span>
                </button>
              ))}
              <span style={{ alignSelf: "center" }}>{skip("How do fans earn the card?")}</span>
            </div>
          ),
        };
      case "reward":
        return {
          q: "What do fans get?",
          body: (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {REWARD.map((r) => (
                <button key={r.key} style={chip()} disabled={busy} onClick={async () => (await save({ setup: { reward: { type: r.key } } })) && next("What do fans get?", r.label)}>
                  {r.label}
                </button>
              ))}
              {skip("What do fans get?")}
            </div>
          ),
        };
      case "module":
        return {
          q: "Which page does the card sit on?",
          sub: camp ? `The module with the task goes on one of the ${camp.name} pages.` : "The module with the task goes on this page.",
          body: (
            <div style={{ display: "grid", gap: 8 }}>
              {pages === null && <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading the pages …</span>}
              {pages?.length === 0 && (
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  No pages on staging yet{camp?.figmaFile ? ". They can be built from the Figma design on Figma Sync." : "."}
                </span>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(pages ?? []).slice(0, 12).map((p) => (
                  <button key={p.id} style={chip()} disabled={busy} onClick={async () => (await save({ setup: { module: { pageId: p.id, pageUrl: p.url, pageTitle: p.title } } })) && next("Which page does the card sit on?", p.title || `/${p.url}`)}>
                    {p.title || p.url}
                  </button>
                ))}
              </div>
              <span>{skip("Which page does the card sit on?")}</span>
            </div>
          ),
        };
      case "texts":
        return {
          q: "Prefill the texts from a similar card?",
          sub: "Its texts go into the empty fields and its name becomes this card's name. You check and change them in the editor.",
          body: card ? (
            <div style={{ display: "grid", gap: 10 }}>
              <PrefillPicker cardId={card.id} onDone={(r) => next("Prefill the texts from a similar card?", `${r.filled.length} texts from ${r.from}`)} />
              <span>
                <button onClick={() => next("Prefill the texts from a similar card?", "I'll write them myself")} style={{ all: "unset", cursor: "pointer", fontSize: 13, color: "var(--muted)", textDecoration: "underline" }}>
                  No, I&apos;ll write them myself
                </button>
              </span>
            </div>
          ) : null,
        };
      default:
        return null;
    }
  }, [step, name, busy, types, camps, camp, pages, card]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "grid", gap: 18, maxWidth: 720 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>New Team Card{card ? ` · ${card.id}` : ""}</span>
        <div aria-hidden style={{ display: "flex", gap: 4 }}>
          {STEPS.map((s, i) => (
            <span key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= progress ? "var(--accent)" : "var(--border)", transition: "background .2s" }} />
          ))}
        </div>
      </header>

      {/* what was answered so far */}
      {answers.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {answers.map((x, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ color: "var(--muted)" }}>{x.q}</span>
              <span style={{ color: x.a === "Skipped for now" ? "var(--muted)" : "var(--fg)", fontWeight: 500 }}>{x.a}</span>
            </div>
          ))}
        </div>
      )}

      {question && (
        <section aria-live="polite" style={{ display: "grid", gap: 12, padding: 20, borderRadius: 16, border: "1px solid var(--border-2)", background: "var(--bg-2)" }}>
          <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.25 }}>{question.q}</h1>
          {question.sub && <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5 }}>{question.sub}</p>}
          {question.body}
          {err && <div role="alert" style={{ color: "#e06c5b", fontSize: 13 }}>{err}</div>}
        </section>
      )}

      {step === "done" && card && (
        <section style={{ display: "grid", gap: 12, padding: 20, borderRadius: 16, border: "1px solid rgba(111,207,124,.4)", background: "rgba(111,207,124,.06)" }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{card.name} is set up in Ktulu.</h1>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5 }}>
            Next come the texts, screen by screen, then a review and the build on staging (it stays disabled).
            {figmaImage ? " For the image: run AF1 Ktulu Sync on the Team Cards board in Figma and link the artwork (Setup, step 3); it uploads by itself." : ""}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn btn-primary" href={`/teamcards/${card.id}?guided=page`}>
              Write the texts, step by step
            </Link>
            <Link className="btn" href={`/teamcards/${card.id}`}>
              Open the card
            </Link>
            <Link className="btn" href="/teamcards">
              All cards
            </Link>
          </div>
        </section>
      )}
      {step !== "done" && (
        <Link href={card ? `/teamcards/${card.id}` : "/teamcards"} style={{ fontSize: 13, color: "var(--muted)" }}>
          {card ? "Stop here, continue in the editor" : "Cancel"}
        </Link>
      )}
    </div>
  );
}
