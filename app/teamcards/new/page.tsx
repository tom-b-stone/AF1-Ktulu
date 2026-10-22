"use client";

// New Team Card as a short dialog: one question at a time. Pick an answer, then
// Continue in the action bar that always sits at the bottom of the page
// (Back and Cancel on the left, Skip and Continue on the right).
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
  const [test, setTest] = useState(false);

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

  // the answer picked on the current step, applied with Continue
  const [sel, setSel] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const next = (q: string, a: string) => {
    setAnswers((x) => [...x, { q, a }]);
    setErr("");
    setSel("");
    setFile(null);
    setStep(STEPS[STEPS.indexOf(step) + 1]);
  };
  // back one question (the name step can't be undone: the card exists then)
  const back = () => {
    const i = STEPS.indexOf(step);
    if (i <= 1) return;
    setAnswers((x) => x.slice(0, -1));
    setErr("");
    setSel("");
    setFile(null);
    setStep(STEPS[i - 1]);
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
    const j = await fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "new", name, test }) })
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
  const chip = (on = false): React.CSSProperties => ({ padding: "10px 16px", borderRadius: 12, fontSize: 14, cursor: "pointer", border: `1px solid ${on ? "var(--accent)" : "var(--border-2)"}`, background: on ? "rgba(255,45,0,.14)" : "var(--bg-2)", color: "var(--fg)", textAlign: "left", boxShadow: on ? "0 0 0 1px var(--accent) inset" : undefined });
  const pick = (v: string) => setSel((x) => (x === v ? "" : v));

  // every question: what it shows, and what Continue does
  type Q = { q: string; sub?: string; body: React.ReactNode; ready: boolean; go?: () => Promise<void> | void; goLabel?: string; skip?: boolean };
  const question = useMemo((): Q | null => {
    switch (step) {
      case "name":
        return {
          q: "What should the card be called?",
          sub: "It gets the next free number and is created in Ktulu right away. Nothing goes to staging yet.",
          ready: !!name.trim(),
          go: create,
          goLabel: busy ? "Creating …" : "Create the card",
          body: (
            <div style={{ display: "grid", gap: 10 }}>
              <input
                className="input"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && !busy && void create()}
                placeholder="e.g. Gabi's Las Vegas Helmet"
                style={{ fontSize: 15 }}
              />
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "var(--muted)" }}>
                <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
                Test card: gets TC-000, delete it on its overview when you are done
              </label>
            </div>
          ),
        };
      case "type":
        return {
          q: "What kind of card is it?",
          ready: !!sel,
          skip: true,
          go: async () => {
            if (await save({ brief: { badgeType: sel } })) next("What kind of card is it?", sel);
          },
          body: (
            <div role="radiogroup" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(types.length ? types : ["Exclusive", "Limited", "Race"]).map((t) => (
                <button key={t} role="radio" aria-checked={sel === t} style={chip(sel === t)} onClick={() => pick(t)}>
                  {t}
                </button>
              ))}
            </div>
          ),
        };
      case "campaign": {
        const c = camps.find((x) => x.key === sel);
        return {
          q: "Which campaign does it belong to?",
          sub: "The Grand Prix comes with the campaign.",
          ready: !!sel,
          skip: true,
          go: async () => {
            if (sel === "none") return next("Which campaign does it belong to?", "No campaign");
            if (c && (await save({ brief: { campaign: c.name, race: c.race } }))) {
              setCamp(c);
              next("Which campaign does it belong to?", `${c.name}${c.race && c.race !== c.name ? ` · ${c.race} GP` : ""}`);
            }
          },
          body: (
            <div role="radiogroup" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {camps.map((x) => (
                <button key={x.key} role="radio" aria-checked={sel === x.key} style={chip(sel === x.key)} onClick={() => pick(x.key)}>
                  {x.name}
                </button>
              ))}
              <button role="radio" aria-checked={sel === "none"} style={chip(sel === "none")} onClick={() => pick("none")}>
                No campaign
              </button>
            </div>
          ),
        };
      }
      case "image":
        return {
          q: "Is there a card image in Figma?",
          sub: "In Figma, the plugin keeps the image in sync with the design. Or upload one now.",
          ready: sel === "figma" || sel === "later" || (sel === "upload" && !!file),
          goLabel: sel === "upload" ? (busy ? "Uploading …" : "Upload and continue") : undefined,
          go: async () => {
            if (sel === "upload" && file) return upload(file);
            if (sel === "figma" && (await save({ brief: { imageSource: "figma" } }))) {
              setFigmaImage(true);
              next("Is there a card image in Figma?", "Yes, in Figma");
            }
            if (sel === "later") next("Is there a card image in Figma?", "Not yet");
          },
          body: (
            <div style={{ display: "grid", gap: 10 }}>
              <div role="radiogroup" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button role="radio" aria-checked={sel === "figma"} style={chip(sel === "figma")} onClick={() => pick("figma")}>
                  Yes, it&apos;s in Figma
                </button>
                <label role="radio" aria-checked={sel === "upload"} style={{ ...chip(sel === "upload"), display: "inline-block" }}>
                  {file ? `Upload: ${file.name}` : "Upload it now"}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setFile(f);
                        setSel("upload");
                      }
                    }}
                  />
                </label>
                <button role="radio" aria-checked={sel === "later"} style={chip(sel === "later")} onClick={() => pick("later")}>
                  Not yet
                </button>
              </div>
            </div>
          ),
        };
      case "engagement": {
        const e = ENG.find((x) => x.key === sel);
        return {
          q: "How do fans earn the card?",
          sub: "The engagement. Items and pictures for the task are added in the editor.",
          ready: !!e,
          skip: true,
          go: async () => {
            if (e && (await save({ setup: { engagement: { type: e.key, items: [] } } }))) next("How do fans earn the card?", e.label);
          },
          body: (
            <div role="radiogroup" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {ENG.map((x) => (
                <button key={x.key} role="radio" aria-checked={sel === x.key} style={{ ...chip(sel === x.key), display: "grid", gap: 2 }} onClick={() => pick(x.key)}>
                  <b style={{ fontWeight: 600 }}>{x.label}</b>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{x.hint}</span>
                </button>
              ))}
            </div>
          ),
        };
      }
      case "reward": {
        const r = REWARD.find((x) => x.key === sel);
        return {
          q: "What do fans get?",
          ready: !!r,
          skip: true,
          go: async () => {
            if (r && (await save({ setup: { reward: { type: r.key } } }))) next("What do fans get?", r.label);
          },
          body: (
            <div role="radiogroup" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {REWARD.map((x) => (
                <button key={x.key} role="radio" aria-checked={sel === x.key} style={chip(sel === x.key)} onClick={() => pick(x.key)}>
                  {x.label}
                </button>
              ))}
            </div>
          ),
        };
      }
      case "module": {
        const pg = (pages ?? []).find((x) => x.id === sel);
        return {
          q: "Which page does the card sit on?",
          sub: camp ? `The module with the task goes on one of the ${camp.name} pages.` : "The module with the task goes on this page.",
          ready: !!pg,
          skip: true,
          go: async () => {
            if (pg && (await save({ setup: { module: { pageId: pg.id, pageUrl: pg.url, pageTitle: pg.title } } }))) next("Which page does the card sit on?", pg.title || `/${pg.url}`);
          },
          body: (
            <div style={{ display: "grid", gap: 8 }}>
              {pages === null && <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading the pages …</span>}
              {pages?.length === 0 && (
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  No pages on staging yet{camp?.figmaFile ? ". They can be built from the Figma design on Figma Sync." : "."} Skip for now: the card then goes on the campaign&apos;s WiP page.
                </span>
              )}
              <div role="radiogroup" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(pages ?? []).slice(0, 12).map((x) => (
                  <button key={x.id} role="radio" aria-checked={sel === x.id} style={chip(sel === x.id)} onClick={() => pick(x.id)}>
                    {x.title || x.url}
                  </button>
                ))}
              </div>
            </div>
          ),
        };
      }
      case "texts":
        return {
          q: "Prefill the texts from a similar card?",
          sub: "Pick a card: its texts go into the empty fields. You check and change them in the editor.",
          ready: true,
          goLabel: "Continue without prefill",
          go: () => next("Prefill the texts from a similar card?", "I'll write them myself"),
          body: card ? <PrefillPicker cardId={card.id} onDone={(r) => next("Prefill the texts from a similar card?", `${r.filled.length} texts from ${r.from}`)} /> : null,
        };
      default:
        return null;
    }
  }, [step, name, busy, types, camps, camp, pages, card, test, sel, file]); // eslint-disable-line react-hooks/exhaustive-deps

  const actionBar: React.CSSProperties = { position: "sticky", bottom: 0, zIndex: 20, display: "flex", gap: 10, alignItems: "center", padding: "14px 0", marginTop: 8, borderTop: "1px solid var(--border)", background: "var(--bg)" };

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto", gap: 18, maxWidth: 720, minHeight: "calc(100dvh - 140px)" }}>
      <header style={{ display: "grid", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          New Team Card{card ? ` · ${card.id}` : ""} · step {Math.min(progress + 1, STEPS.length - 1)} of {STEPS.length - 1}
        </span>
        <div aria-hidden style={{ display: "flex", gap: 4 }}>
          {STEPS.slice(0, -1).map((s, i) => (
            <span key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= progress ? "var(--accent)" : "var(--border)", transition: "background .2s" }} />
          ))}
        </div>
      </header>

      <div style={{ display: "grid", gap: 18, alignContent: "start" }}>
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
          </section>
        )}
      </div>

      {/* actions always at the bottom: back and cancel left, skip and the main action right */}
      <footer style={actionBar}>
        {step === "done" && card ? (
          <>
            <Link className="btn" href="/teamcards">
              All cards
            </Link>
            <span style={{ flex: 1 }} />
            <Link className="btn" href={`/teamcards/${card.id}`}>
              Open the card
            </Link>
            <Link className="btn btn-primary" href={`/teamcards/${card.id}?guided=page`}>
              Write the texts, step by step
            </Link>
          </>
        ) : (
          <>
            {progress > 1 && (
              <button className="btn" onClick={back} disabled={busy}>
                Back
              </button>
            )}
            <Link className="btn" href={card ? `/teamcards/${card.id}` : "/teamcards"} style={{ border: "none", background: "transparent", color: "var(--muted)" }}>
              {card ? "Stop here, continue in the editor" : "Cancel"}
            </Link>
            <span style={{ flex: 1 }} />
            {question?.skip && (
              <button className="btn" onClick={() => question && next(question.q, "Skipped for now")} disabled={busy}>
                Skip for now
              </button>
            )}
            {question?.go && (
              <button className="btn btn-primary" onClick={() => void question.go!()} disabled={!question.ready || busy}>
                {question.goLabel ?? (busy ? "Saving …" : "Continue")}
              </button>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
