"use client";

// Team Card editor. The whole fan journey as real audif1.com screens (captured
// on staging, filled with this card's content) on one canvas; texts are edited
// in place or in the drawer that slides in from the right. Steps stay fixed in
// the header. Changing a text that appears elsewhere asks where else it should
// change (this journey → the campaign → all cards). Nothing is written before Review.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FIELDS, fieldByKey, fieldIssues, type FieldDef, type Loc } from "@/lib/teamCardFields";
import { SitePhone } from "../SitePhone";
import { cardTemplate } from "@/lib/cardTemplate";
import { HINTS, LANES, STEPS, TEAM_RULES, kindOf, stationsFor, type Lane, type Station } from "../journey";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type LV = { en: string; de: string };
type Values = Record<string, LV>;
type Card = {
  id: string;
  name: string;
  status: string;
  rewardType?: string;
  imageUrl?: string;
  badgeTypeLabel?: string;
  raceLabel?: string;
  values: Record<string, Json>;
  links: { badge: string; engagement?: string; page?: string };
  preview?: { type?: string } | null;
  raw?: Record<Loc, { badge: Json; engagement: Json; module: Json }> | null;
};
type OtherCard = { id: string; name: string; values: Record<string, Json> };
type LexEntry = { id: string; field: string; en: string; de: string; uses: number; saved: boolean; cards: string[] };
type Templates = Record<string, Record<string, { label: string; html: string; popup: boolean }>>;
type Mode = "en" | "de" | "stack" | "side";
type Hit = { id: string; card: string | null; cardName: string; key: string; locale: Loc; before: string; after: string; group: 0 | 1 | 2 };
type Ask = { key: string; lang: Loc; from: string; to: string; oldP: string; newP: string; hits: Hit[]; stage: 0 | 1 | 2 };
type Cross = Record<string, { key: string; locale: Loc; value: string }[]>;

const C = { bg: "#0c0c0e", panel: "#141417", line: "#26262b", line2: "#34343b", fg: "#e7e5e4", mute: "#8b8a91", lava: "#ff2d00", ok: "#6fcf7c" };
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const getPath = (o: Json, p: (string | number)[]) => p.reduce((a: Json, k) => (a == null ? undefined : a[k]), o);
const words = (v: string) => v.trim().split(/\s+/).filter(Boolean).length;
function similar(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const A = new Set(x.split(" ")), B = new Set(y.split(" "));
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(A.size, B.size) >= 0.8;
}
// the part of a text that changed, widened to whole words ("Claim now" → "Collect now": "Claim" → "Collect")
function phraseDiff(a: string, b: string) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const w = (c?: string) => !!c && /[\p{L}\p{N}]/u.test(c);
  while (i > 0 && w(a[i - 1]) && (w(a[i]) || w(b[i]))) i--;
  while (j > 0 && w(a[a.length - j]) && (w(a[a.length - j - 1]) || w(b[b.length - j - 1]))) j--;
  // a short single word ("now") would match far too much: take the word before it as context
  if (!/\s/.test(a.slice(i, a.length - j).trim()) && a.slice(i, a.length - j).trim().length < 5 && i > 0) {
    let k = i;
    while (k > 0 && !w(a[k - 1])) k--;
    while (k > 0 && w(a[k - 1])) k--;
    i = k;
  }
  const oldP = a.slice(i, a.length - j).trim(), newP = b.slice(i, b.length - j).trim();
  return oldP.length >= 2 ? { oldP, newP } : { oldP: a, newP: b };
}
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRe = (p: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(p)}(?=$|[^\\p{L}\\p{N}])`, "giu");
const hasPhrase = (text: string, p: string) => !!p && phraseRe(p).test(text);
const swapPhrase = (text: string, p: string, n: string) => text.replace(phraseRe(p), (_m, pre) => pre + n);
const CTA_KEYS = ["ctaLabel", "revealButton", "submitLabel"];
const keysIn = (html: string) => [...new Set([...html.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]))];
const labelOf = (k: string) => fieldByKey(k)?.label ?? k;
const isText = (f?: FieldDef) => !!f && (f.kind === "text" || f.kind === "textarea");

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const I = { back: "M15 18l-6-6 6-6", left: "M15 18l-6-6 6-6", right: "M9 18l6-6-6-6", plus: "M12 5v14M5 12h14", minus: "M5 12h14", info: "M12 16v-4M12 8h.01M22 12a10 10 0 11-20 0 10 10 0 0120 0z", x: "M18 6L6 18M6 6l12 12", book: "M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14zM20 17v4H6.5" };

const btn = (active = false): CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 8, border: `1px solid ${active ? C.lava : C.line2}`, background: active ? "rgba(255,45,0,.12)" : "transparent", color: C.fg, fontSize: 12.5, cursor: "pointer" });

export default function EditCard() {
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<Card | null>(null);
  const [tpl, setTpl] = useState<Templates | null>(null);
  const [others, setOthers] = useState<OtherCard[]>([]);
  const [row, setRow] = useState<Json | null>(null);
  const [lex, setLex] = useState<LexEntry[]>([]);
  const [initial, setInitial] = useState<Values>({});
  const [vals, setVals] = useState<Values>({});
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState("overview");
  const [whole, setWhole] = useState(false);
  const [mode, setMode] = useState<Mode>("en");
  const [scale, setScale] = useState(0.62);
  const [focus, setFocus] = useState<string | undefined>();
  const [station, setStation] = useState<string | undefined>();
  const [drawer, setDrawer] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [asked, setAsked] = useState<Record<string, boolean>>({});
  const [cross, setCross] = useState<Cross>({});
  const [draft, setDraft] = useState<{ at: string; vals: Values } | null>(null);
  const [review, setReview] = useState<{ rows: Json[]; errors: string[] } | null>(null);
  const [result, setResult] = useState<{ pushed: string[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    Promise.all([
      fetch(`/api/teamcards/${id}`).then((r) => r.json()),
      fetch("/af1-live/templates.json").then((r) => r.json()),
      fetch("/api/teamcards").then((r) => r.json()).catch(() => ({ cards: [] })),
      fetch("/api/teamcards/lexicon").then((r) => r.json()).catch(() => ({ entries: [] })),
    ])
      .then(([c, t, all, lx]) => {
        if (!c.card) throw new Error(c.error ?? "card not found");
        setCard(c.card);
        setTpl(t);
        setOthers((all.cards ?? []).filter((x: OtherCard) => x.id !== c.card.id));
        setRow((all.cards ?? []).find((x: Json) => x.id === c.card.id) ?? null);
        setLex(lx.entries ?? []);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const kind = kindOf(card?.preview?.type);
  const stations = useMemo(() => stationsFor(kind), [kind]);
  const htmlOf = useCallback(
    (s: Station) => {
      const [a, b] = s.tpl.split("/");
      return tpl?.[a]?.[b]?.html ?? tpl?.survey?.[b]?.html ?? "";
    },
    [tpl],
  );
  const allKeys = useMemo(() => [...new Set(stations.flatMap((s) => keysIn(htmlOf(s))))].filter((k) => !k.startsWith("meta:")), [stations, htmlOf]);

  // initial values straight from the staging documents (EN + DE)
  useEffect(() => {
    if (!card || !tpl) return;
    const raw = card.raw;
    const from = (k: string, l: Loc): string => {
      const f = fieldByKey(k);
      if (!f) return "";
      const doc = raw?.[f.localized ? l : "en"]?.[f.doc];
      if (doc) {
        const v = getPath(doc, f.path);
        if (typeof v === "string") return v;
        if (v != null && !f.localized) return String(v);
        if (k.startsWith("raw:")) return "";
      }
      const cv = card.values[k];
      if (cv && typeof cv === "object") return String(cv[l] ?? "");
      return cv != null ? String(cv) : "";
    };
    const keys = [...new Set([...allKeys, ...FIELDS.map((f) => f.key)])];
    const init: Values = Object.fromEntries(keys.map((k) => [k, { en: from(k, "en"), de: from(k, "de") }]));
    setInitial(init);
    setVals(init);
    try {
      const d = JSON.parse(localStorage.getItem(`tc-draft:${card.id}`) ?? "null");
      if (d?.vals) setDraft(d);
    } catch {}
  }, [card, tpl, allKeys]);

  const changed = useMemo(
    () => Object.keys(vals).flatMap((k) => (["en", "de"] as Loc[]).filter((l) => (vals[k]?.[l] ?? "") !== (initial[k]?.[l] ?? "") && (fieldByKey(k)?.localized !== false || l === "en")).map((l) => ({ key: k, locale: l }))),
    [vals, initial],
  );
  // autosave a draft of unsaved edits
  useEffect(() => {
    if (!card || !Object.keys(initial).length) return;
    try {
      if (changed.length) localStorage.setItem(`tc-draft:${card.id}`, JSON.stringify({ at: new Date().toISOString(), vals: Object.fromEntries([...new Set(changed.map((c) => c.key))].map((k) => [k, vals[k]])) }));
      else if (!draft) localStorage.removeItem(`tc-draft:${card.id}`);
    } catch {}
  }, [changed, vals, card, initial, draft]);

  const textOf = useCallback(
    (k: string, l: Loc) => {
      // card details on the back: values from the record where known, otherwise the captured text stays
      if (k === "meta:race") return card?.raceLabel ? `${card.raceLabel}${/GP$/.test(card.raceLabel) ? "" : " GP"}` : "";
      if (k === "meta:type") return card?.badgeTypeLabel ?? "";
      if (k === "meta:season") return "";
      return vals[k]?.[l] ?? "";
    },
    [vals, card],
  );

  const images = useMemo(() => {
    const out: Record<string, string> = {};
    const raw = card?.raw?.en;
    for (const k of ["badge:badgeImage", "badge:badgeBackImage", "engagement:background.imageSettings.media", "engagement:questions.0.assetId"]) {
      const [doc, path] = k.split(":");
      const v = raw ? getPath((raw as Json)[doc], path.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p))) : undefined;
      const mid = v && typeof v === "object" ? v.id : v;
      if (mid) out[k] = `/api/sitemap/media/${mid}`;
    }
    if (!out["badge:badgeImage"] && card?.imageUrl) out["badge:badgeImage"] = card.imageUrl;
    return out;
  }, [card]);

  // ---- editing ------------------------------------------------------------
  const setText = useCallback((k: string, l: Loc, v: string) => setVals((cur) => ({ ...cur, [k]: { ...(cur[k] ?? { en: "", de: "" }), [l]: v } })), []);
  const issuesOf = (k: string, l: Loc) => {
    const f = fieldByKey(k);
    if (!f || !isText(f)) return [];
    return fieldIssues(f, l, textOf(k, l), l === "en" ? textOf(k, "de") : undefined).map((x) => x.replace(`${f.label}: `, ""));
  };

  // after a text change: where else does the changed phrase appear? (this card, the campaign, other campaigns)
  const checkScope = useCallback(
    (k: string, l: Loc) => {
      const from = initial[k]?.[l] ?? "";
      const to = vals[k]?.[l] ?? "";
      const sig = `${k}|${l}|${to}`;
      if (!from.trim() || from === to || asked[sig]) return;
      const { oldP, newP } = phraseDiff(from, to);
      const whole = oldP === from;
      const hits: Hit[] = [];
      const match = (text: string) => (whole ? norm(text) === norm(from) : hasPhrase(text, oldP));
      const next = (text: string) => (whole ? to : swapPhrase(text, oldP, newP));
      // this card: every other text (page, task, popups, card)
      for (const x of Object.keys(vals)) {
        if (x === k || x.startsWith("meta:") || !isText(fieldByKey(x))) continue;
        const t = vals[x]?.[l] ?? "";
        if (t && match(t)) hits.push({ id: `self|${x}`, card: null, cardName: "This card", key: x, locale: l, before: t, after: next(t), group: 0 });
      }
      // other cards: all their text fields
      const prefix = card?.id.split("-")[0] ?? "";
      for (const o of others)
        for (const f of FIELDS) {
          if (!isText(f) || !f.localized) continue;
          const v = o.values[f.key];
          const t = v && typeof v === "object" ? String(v[l] ?? "") : "";
          if (t && match(t)) hits.push({ id: `${o.id}|${f.key}`, card: o.id, cardName: o.name, key: f.key, locale: l, before: t, after: next(t), group: o.id.split("-")[0] === prefix ? 1 : 2 });
        }
      if (!hits.length) return;
      setAsked((a) => ({ ...a, [sig]: true }));
      const first = ([0, 1, 2] as const).find((g) => hits.some((h) => h.group === g))!;
      setAsk({ key: k, lang: l, from, to, oldP, newP, hits, stage: first });
    },
    [initial, vals, asked, others, card],
  );

  const onPhone = useCallback(
    (sid: string, m: { type: string; k?: string; v?: string }) => {
      const [stId, l] = sid.split("~") as [string, Loc];
      if (m.type === "focus" && m.k) {
        setFocus(m.k);
        setStation(stId);
        if (!m.k.startsWith("meta:")) setDrawer(true);
      }
      if (m.type === "edit" && m.k && !m.k.startsWith("meta:")) setText(m.k, l, m.v ?? "");
      if (m.type === "blur" && m.k && !m.k.startsWith("meta:")) setTimeout(() => checkScope(m.k!, l), 60);
    },
    [setText, checkScope],
  );

  // ---- review / apply -------------------------------------------------------
  const changesPayload = () => changed.map((c) => ({ key: c.key, locale: fieldByKey(c.key)?.localized === false ? undefined : c.locale, value: fieldByKey(c.key)?.kind === "boolean" ? vals[c.key][c.locale] === "true" : vals[c.key][c.locale] }));
  async function runPreview() {
    setBusy("Checking your changes…");
    setResult(null);
    const j = await fetch(`/api/teamcards/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", changes: changesPayload() }) }).then((r) => r.json());
    setReview(j.rows ? j : { rows: [], errors: [j.error ?? "failed"] });
    setBusy(null);
  }
  async function apply() {
    if (!card) return;
    setBusy("Writing to staging…");
    const j = await fetch(`/api/teamcards/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", changes: changesPayload() }) }).then((r) => r.json());
    const crossList = Object.entries(cross).flatMap(([cid, list]) => list.map((c) => ({ card: cid, ...c })));
    let cr: Json = { pushed: [], errors: [] };
    if (crossList.length) cr = await fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", changes: crossList }) }).then((r) => r.json());
    // the lexicon learns what was applied
    const learn = [...new Set(changed.map((c) => c.key))].filter((k) => isText(fieldByKey(k))).map((k) => ({ field: k, en: vals[k].en, de: vals[k].de, card: card.id }));
    if (learn.length) fetch("/api/teamcards/lexicon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "learn", items: learn }) }).then((r) => r.json()).then((x) => x.entries && setLex(x.entries)).catch(() => {});
    window.dispatchEvent(new Event("af1:changed"));
    setResult({ pushed: [...(j.pushed ?? []), ...(cr.pushed ?? [])], errors: [...(j.errors ?? (j.error ? [j.error] : [])), ...(cr.errors ?? [])] });
    try {
      localStorage.removeItem(`tc-draft:${card.id}`);
    } catch {}
    setInitial(vals);
    setCross({});
    setReview(null);
    setBusy(null);
  }

  if (error) return <div style={{ color: "#e06c5b", padding: 24 }}>Could not load the card: {error}</div>;
  if (!card || !tpl || !Object.keys(vals).length)
    return (
      <div style={{ display: "grid", gap: 14, padding: 8 }} aria-busy="true">
        <div style={{ height: 22, width: 260, borderRadius: 6, background: C.panel }} />
        <div style={{ display: "flex", gap: 18 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ width: 250, height: 520, borderRadius: 26, background: C.panel, opacity: 1 - i * 0.18 }} />
          ))}
        </div>
      </div>
    );

  const current = STEPS.find((s) => s.key === step)!;
  const lanes: Lane[] = whole ? ["page", "out", "in", "collection"] : current.lanes;
  const langs: Loc[] = mode === "en" ? ["en"] : mode === "de" ? ["de"] : ["en", "de"];
  const stepCount = (key: string) => {
    const s = STEPS.find((x) => x.key === key)!;
    const ks = new Set(stations.filter((st) => s.lanes.includes(st.lane)).flatMap((st) => keysIn(htmlOf(st))));
    return { changed: changed.filter((c) => ks.has(c.key)).length, issues: [...ks].reduce((n, k) => n + issuesOf(k, "en").length + issuesOf(k, "de").length, 0) };
  };
  const focusStation = stations.find((s) => s.id === station) ?? stations.find((s) => lanes.includes(s.lane));
  const drawerKeys = focusStation ? keysIn(htmlOf(focusStation)).filter((k) => !k.startsWith("meta:")) : [];
  const whereUsed = (k: string) => [...new Set(stations.filter((s) => keysIn(htmlOf(s)).includes(k)).map((s) => s.label.replace(/, back$/, "")))];
  const missingDe = allKeys.filter((k) => textOf(k, "en").trim() && !textOf(k, "de").trim());

  // ---- render -------------------------------------------------------------
  const phone = (s: Station, l: Loc, tag?: string) => {
    const keys = keysIn(htmlOf(s));
    return (
      <SitePhone
        key={s.id + l}
        id={`${s.id}~${l}`}
        html={htmlOf(s)}
        side={s.side}
        lang={l}
        tag={tag}
        scale={scale}
        values={Object.fromEntries(keys.flatMap((k) => (k.startsWith("meta:") && !textOf(k, l) ? [] : [[k, textOf(k, l)]])))}
        anchor={s.anchor}
        images={images}
        editable={keys.filter((k) => !k.startsWith("meta:"))}
        missing={l === "de" ? missingDe : undefined}
        focus={focus}
        onEvent={onPhone}
      />
    );
  };

  return (
    <div style={{ margin: "-28px -36px", minHeight: "calc(100dvh - 64px)", background: C.bg, color: C.fg, minWidth: 0, overflowX: "clip" }}>
      {/* ---- fixed header: card, steps, view controls ---- */}
      <div style={{ position: "sticky", top: 64, zIndex: 30, background: "rgba(12,12,14,.92)", backdropFilter: "blur(10px)", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 24px 8px", flexWrap: "wrap" }}>
          <Link href="/teamcards" aria-label="All Team Cards" style={{ ...btn(), padding: "0 8px" }}>
            <Icon d={I.back} />
          </Link>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 650, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.name}</div>
            <div style={{ fontSize: 11.5, color: C.mute }}>
              {card.id} · {kind === "qa" ? "Text answer" : kind === "hot" ? "Hot or not" : "Multiple choice"} · staging{" "}
              <a href={card.links.badge} target="_blank" rel="noreferrer" style={{ color: C.mute }}>card ↗</a>
              {card.links.page && (
                <>
                  {" · "}
                  <a href={card.links.page} target="_blank" rel="noreferrer" style={{ color: C.mute }}>page ↗</a>
                </>
              )}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div role="group" aria-label="Language" style={{ display: "flex", border: `1px solid ${C.line2}`, borderRadius: 8, overflow: "hidden" }}>
            {(["en", "de", "stack", "side"] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} style={{ height: 30, padding: "0 10px", border: 0, background: mode === m ? "rgba(255,45,0,.16)" : "transparent", color: mode === m ? "#fff" : C.mute, fontSize: 12, cursor: "pointer" }}>
                {m === "en" ? "EN" : m === "de" ? "DE" : m === "stack" ? "EN over DE" : "EN | DE"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button aria-label="Smaller screens" style={{ ...btn(), padding: "0 8px" }} onClick={() => setScale((s) => Math.max(0.4, +(s - 0.08).toFixed(2)))}>
              <Icon d={I.minus} />
            </button>
            <span style={{ fontSize: 11, color: C.mute, width: 34, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
            <button aria-label="Bigger screens" style={{ ...btn(), padding: "0 8px" }} onClick={() => setScale((s) => Math.min(1, +(s + 0.08).toFixed(2)))}>
              <Icon d={I.plus} />
            </button>
          </div>
          <button style={btn(whole)} onClick={() => setWhole((w) => !w)} aria-pressed={whole}>
            {whole ? "Whole journey" : "This step"}
          </button>
          <button
            style={{ ...btn(), background: changed.length ? C.lava : "transparent", borderColor: changed.length ? C.lava : C.line2, color: "#fff", fontWeight: 600 }}
            onClick={() => {
              setStep("review");
              void runPreview();
            }}
          >
            Review{changed.length ? ` ${changed.length}` : ""}
          </button>
        </div>
        <nav aria-label="Steps" style={{ display: "flex", gap: 4, padding: "0 24px 10px", overflowX: "auto" }}>
          {STEPS.map((s, i) => {
            const n = s.lanes.length ? stepCount(s.key) : { changed: s.key === "review" ? changed.length : 0, issues: 0 };
            const on = s.key === step;
            return (
              <button
                key={s.key}
                onClick={() => {
                  setStep(s.key);
                  setWhole(false);
                  setStation(undefined);
                  if (s.key === "review") void runPreview();
                }}
                aria-current={on ? "step" : undefined}
                style={{ display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 12px", borderRadius: 999, border: `1px solid ${on ? C.lava : C.line}`, background: on ? "rgba(255,45,0,.1)" : C.panel, color: on ? "#fff" : C.fg, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                <span style={{ width: 18, height: 18, borderRadius: 99, display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 700, background: n.issues ? "rgba(224,108,91,.2)" : n.changed ? "rgba(255,45,0,.25)" : "#27272a", color: n.issues ? "#e06c5b" : "#fff" }}>{n.issues ? "!" : i + 1}</span>
                {s.title}
                {n.changed > 0 && <span style={{ fontSize: 10.5, color: C.lava }}>{n.changed} changed</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {draft && (
        <div role="status" style={{ margin: "14px 24px 0", padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line2}`, background: C.panel, display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
          <Icon d={I.info} /> You have unsaved edits from {new Date(draft.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
          <button style={btn(true)} onClick={() => { setVals((v) => ({ ...v, ...draft.vals })); setDraft(null); }}>Restore</button>
          <button style={btn()} onClick={() => { setDraft(null); try { localStorage.removeItem(`tc-draft:${card.id}`); } catch {} }}>Discard</button>
        </div>
      )}

      {/* ---- canvas ---- */}
      {lanes.length > 0 && (
        <div style={{ padding: "18px 24px 60px", paddingRight: drawer ? 484 : 64, transition: "padding .25s ease-out", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 18, minWidth: 0 }}>
          {!whole && <div style={{ fontSize: 13.5, color: C.mute, maxWidth: 760 }}>{current.talk} Tap any text on a screen to change it.</div>}
          {lanes.map((ln) => {
            const L = LANES[ln];
            const list = stations.filter((s) => s.lane === ln);
            return (
              <section key={ln} aria-label={L.title} style={{ minWidth: 0, borderRadius: 18, background: L.tint, border: `1px solid ${C.line}`, borderLeft: `3px solid ${L.edge}`, padding: "14px 16px 18px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, letterSpacing: ".02em" }}>{L.title}</h2>
                  <span style={{ fontSize: 12, color: C.mute }}>{L.text}</span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14, overflowX: "auto", paddingBottom: 6, paddingTop: 10 }}>
                  {(ln === "out" || ln === "in") && (
                    <div style={{ alignSelf: "center", flexShrink: 0, width: 110, textAlign: "center", fontSize: 11.5, color: C.mute }}>
                      <div style={{ width: 60, height: 60, margin: "0 auto 12px", transform: "rotate(45deg)", border: `1px solid ${L.edge}`, borderRadius: 8, display: "grid", placeItems: "center" }}>
                        <span style={{ transform: "rotate(-45deg)", fontSize: 11.5, color: C.fg, fontWeight: 600 }}>{ln === "out" ? "No" : "Yes"}</span>
                      </div>
                      Logged in?
                    </div>
                  )}
                  {list.map((s, i) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 14, flexShrink: 0 }}>
                      <div style={{ display: "grid", gap: 8, padding: 8, borderRadius: 14, outline: station === s.id ? `1px solid ${C.lava}` : "none", outlineOffset: 2 }} onMouseDown={() => setStation(s.id)}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</div>
                            <div style={{ fontSize: 11, color: C.mute }}>{s.note}</div>
                          </div>
                          {s.side && <span style={{ fontSize: 10, color: C.mute, border: `1px solid ${C.line2}`, borderRadius: 99, padding: "1px 7px", alignSelf: "start" }}>{s.side}</span>}
                        </div>
                        <div style={{ display: "flex", flexDirection: mode === "stack" ? "column" : "row", gap: 14 }}>{langs.map((l) => phone(s, l, langs.length > 1 ? l.toUpperCase() : undefined))}</div>
                      </div>
                      {i < list.length - 1 && (
                        <div aria-hidden style={{ alignSelf: "center", color: C.mute, marginTop: 30 }}>
                          <Icon d={I.right} size={22} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ---- overview: smart summary ---- */}
      {step === "overview" && (() => {
        const MECH: Record<string, string> = { "q-and-a": "text answer", survey: "multiple choice", "hot-or-not": "hot or not", page: "page visit", link: "link" };
        const REWARD: Record<string, string> = { noReward: "no reward", raffleSignup: "a raffle", couponCode: "a voucher" };
        const check: { missing: string[]; quick: string } = row?.check ?? { missing: [], quick: "Ready" };
        const meta: Json = row?.meta ?? {};
        const kindLabel = MECH[row?.mechanic ?? ""] ?? (kind === "qa" ? "text answer" : kind === "hot" ? "hot or not" : "multiple choice");
        const reward = REWARD[row?.rewardType ?? ""];
        const campaign = meta.campaign || row?.raceLabel || "";
        const filledEn = allKeys.filter((k) => textOf(k, "en").trim()).length;
        const filledDe = allKeys.filter((k) => textOf(k, "de").trim()).length;
        const laneSteps = STEPS.filter((x) => x.lanes.length).map((x) => ({ x, ...stepCount(x.key) }));
        const issueTotal = laneSteps.reduce((n, y) => n + y.issues, 0);
        const firstIssue = laneSteps.find((y) => y.issues > 0);
        const tone =
          check.quick === "Ready" ? { bg: "rgba(46,125,79,.18)", fg: "#7fd6a2", label: "Ready" }
          : check.quick === "Disabled" ? { bg: "rgba(255,255,255,.06)", fg: C.mute, label: "Disabled" }
          : { bg: "rgba(227,62,26,.16)", fg: "#ff9a84", label: "Needs attention" };
        const sentences = [
          `${card.name} is a ${kindLabel} card${reward ? ` with ${reward}` : ""}${campaign ? ` in ${campaign}` : ""}.`,
          check.quick === "Disabled"
            ? "It is switched off, so the CMS does not link card, engagement and module yet."
            : check.missing.length
              ? `${check.missing.length === 1 ? "One thing is" : `${check.missing.length} things are`} still missing in the setup: ${check.missing.join(", ")}.`
              : "The setup is complete.",
          `${filledEn} of ${allKeys.length} texts are filled in English and ${filledDe} in German${missingDe.length ? `, so ${missingDe.length} German ${missingDe.length === 1 ? "text is" : "texts are"} still open` : ""}${issueTotal ? `. The copy check flags ${issueTotal} ${issueTotal === 1 ? "issue" : "issues"}` : ""}.`,
          ...(changed.length ? [`You have ${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}.`] : []),
        ];
        const next = firstIssue
          ? { label: `Start with step ${STEPS.indexOf(firstIssue.x) + 1}: ${firstIssue.x.title}`, why: `${firstIssue.issues} ${firstIssue.issues === 1 ? "issue" : "issues"} there.`, go: firstIssue.x.key, de: false }
          : missingDe.length
            ? { label: "Fill the German texts", why: "Opens the page step in German.", go: "page", de: true }
            : check.missing.length
              ? { label: "Fix the setup in the CMS", why: "The missing items above are set in Payload, not in the texts.", go: "", de: false }
              : { label: "Walk through the journey", why: "Nothing urgent. Check the screens, then review and push to staging.", go: "page", de: false };
        const typeLabel = meta.type ?? card.badgeTypeLabel ?? "";
        const where = [campaign, meta.race ?? row?.raceLabel, meta.partner].filter((x, i, arr) => x && arr.indexOf(x) === i).join(" · ");
        const question = textOf("question", "en").trim();
        const about = textOf("description", "en").trim() || textOf("revealDescription", "en").trim();
        const placement: string = row?.placement ?? "";
        const HOW: Record<string, string> = {
          "q-and-a": "answer a question in their own words",
          survey: "pick an answer in a short survey",
          "hot-or-not": "vote hot or not",
          page: "visit the page",
          link: "open the link",
        };
        const how = HOW[row?.mechanic ?? ""] ?? (kind === "qa" ? HOW["q-and-a"] : kind === "hot" ? HOW["hot-or-not"] : row?.mechanic ? HOW.survey : "");
        const earn = how
          ? `Fans ${how}${placement ? ` (${placement.replace(/^[^·]*·\s*/, "")})` : ""}${question && !/^(page|link)$/.test(row?.mechanic ?? "") ? `: "${question.length > 110 ? question.slice(0, 110) + "…" : question}"` : ""}. ${reward ? `They get ${reward}.` : "No reward is set yet."}`
          : "How fans earn this card is not defined yet.";
        const last = row?.log?.[0] ? `${row.log[0].summary} · ${new Date(row.log[0].at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "No changes logged";
        const lbl: CSSProperties = { fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: C.mute };
        return (
          <div style={{ padding: "22px 24px 60px", maxWidth: 1040, display: "grid", gap: 16 }}>
            {/* the card itself: image, name, type, campaign, how to earn, context */}
            <section aria-label="The card" style={{ borderRadius: 18, background: C.panel, border: `1px solid ${C.line}`, padding: 22, display: "grid", gridTemplateColumns: "minmax(140px, 200px) minmax(0, 1fr)", gap: 28, alignItems: "start" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={card.imageUrl || cardTemplate(card.name)} alt={card.imageUrl ? `${card.name} card` : "Card image not defined yet"} style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "cover", borderRadius: 12, transform: "rotate(-3deg)", boxShadow: "0 24px 40px -22px rgba(0,0,0,.8)" }} />
              <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {meta.core && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: C.lava, color: "#fff" }}>CORE</span>}
                  <span style={{ fontSize: 11.5, padding: "2px 9px", borderRadius: 999, border: `1px solid ${C.line2}`, color: typeLabel ? C.fg : C.mute, fontStyle: typeLabel ? undefined : "italic" }}>{typeLabel || "Card type not defined yet"}</span>
                  <span style={{ fontSize: 12, color: C.mute, fontVariantNumeric: "tabular-nums" }}>{card.id}</span>
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  <h2 style={{ margin: 0, fontSize: 26, lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.01em" }}>{card.name}</h2>
                  <div style={{ fontSize: 13, color: where ? C.fg : C.mute, fontStyle: where ? undefined : "italic" }}>{where || "No campaign yet"}</div>
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  <span style={lbl}>How to earn</span>
                  <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, maxWidth: 640 }}>{earn}</p>
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  <span style={lbl}>Context</span>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, maxWidth: 640, color: about ? "#cfcdcc" : C.mute, fontStyle: about ? undefined : "italic", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{about || "No card description yet."}</p>
                </div>
              </div>
            </section>

            {/* status: what is missing, and where to start */}
            <section aria-label="Status" style={{ borderRadius: 18, border: `1px solid ${check.missing.length ? "rgba(227,62,26,.35)" : C.line}`, background: check.missing.length ? "rgba(227,62,26,.05)" : "transparent", padding: "18px 22px", display: "grid", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={lbl}>Status</span>
                <span style={{ fontSize: 11.5, padding: "3px 10px", borderRadius: 999, background: tone.bg, color: tone.fg, fontWeight: 600 }}>
                  {tone.label}{check.quick === "Missing" ? ` · ${check.missing.length}` : ""}
                </span>
                <span style={{ fontSize: 12, color: C.mute }}>Last change: {last}</span>
              </div>
              {check.missing.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {check.missing.map((m) => (
                    <span key={m} style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 8, background: "rgba(227,62,26,.12)", color: "#ffb5a6" }}>{m}</span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13.5 }}>{check.quick === "Disabled" ? "Switched off: the CMS does not link card, engagement and module yet." : "The setup is complete."}</div>
              )}
              <div style={{ fontSize: 13, color: C.mute }}>{sentences.slice(2).join(" ")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button
                  style={{ ...btn(true), height: 36, fontWeight: 600 }}
                  onClick={() => {
                    if (!next.go) { if (card.links.badge) window.open(card.links.badge, "_blank"); return; }
                    if (next.de) setMode("de");
                    setStep(next.go);
                    setWhole(false);
                    setStation(undefined);
                  }}
                >
                  {next.label} <Icon d={I.right} size={14} />
                </button>
                <span style={{ fontSize: 12.5, color: C.mute }}>{next.why}</span>
              </div>
            </section>

            <section aria-label="Journey" style={{ borderRadius: 18, border: `1px solid ${C.line}`, padding: "16px 20px", display: "grid", gap: 10 }}>
              <span style={lbl}>The journey, step by step</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                {laneSteps.map(({ x, issues, changed: ch }) => {
                  const L = LANES[x.lanes[0]];
                  return (
                    <button
                      key={x.key}
                      onClick={() => { setStep(x.key); setWhole(false); setStation(undefined); }}
                      style={{ textAlign: "left", cursor: "pointer", borderRadius: 14, border: `1px solid ${C.line}`, borderLeft: `3px solid ${L.edge}`, background: L.tint, color: C.fg, padding: "12px 14px", display: "grid", gap: 4 }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{STEPS.indexOf(x) + 1}. {x.title}</span>
                      <span style={{ fontSize: 12, color: issues ? "#e06c5b" : C.mute }}>
                        {issues ? `${issues} ${issues === 1 ? "issue" : "issues"}` : "No issues"}{ch ? ` · ${ch} changed` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        );
      })()}

      {/* ---- settings ---- */}
      {step === "settings" && (
        <div style={{ padding: "22px 24px", maxWidth: 720, display: "grid", gap: 14 }}>
          <div style={{ fontSize: 13.5, color: C.mute }}>{current.talk}</div>
          {FIELDS.filter((f) => f.kind === "select" || f.kind === "boolean").map((f) => (
            <label key={f.key} style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, alignItems: "center", fontSize: 13.5 }}>
              <span>
                {f.label}
                {f.help && <span style={{ display: "block", fontSize: 11.5, color: C.mute }}>{f.help}</span>}
              </span>
              {f.kind === "boolean" ? (
                <input type="checkbox" checked={textOf(f.key, "en") === "true"} onChange={(e) => setText(f.key, "en", String(e.target.checked))} />
              ) : (
                <select className="input" value={textOf(f.key, "en")} onChange={(e) => setText(f.key, "en", e.target.value)}>
                  {(f.options ?? []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              )}
            </label>
          ))}
          <div style={{ fontSize: 12.5, color: C.mute }}>Reward type: {card.rewardType ?? "no reward"}. Raffle and voucher fields appear here once a card uses them.</div>
        </div>
      )}

      {/* ---- review ---- */}
      {step === "review" && (
        <div style={{ padding: "22px 24px", maxWidth: 1000, display: "grid", gap: 14 }}>
          {busy && <div style={{ color: C.mute }}>{busy}</div>}
          {review && review.rows.length === 0 && !Object.keys(cross).length && !result && <div style={{ color: C.mute }}>Nothing changed yet. Pick a step and tap a text on a screen.</div>}
          {review && (review.rows.length > 0 || Object.keys(cross).length > 0) && (
            <>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: C.mute, fontSize: 11 }}>
                    <th style={{ padding: 8 }}>Field</th>
                    <th style={{ padding: 8 }}>Before</th>
                    <th style={{ padding: 8 }}>After</th>
                  </tr>
                </thead>
                <tbody>
                  {review.rows.map((r: Json, i: number) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.line}`, verticalAlign: "top" }}>
                      <td style={{ padding: 8 }}>
                        {r.label}
                        {r.locale ? ` · ${String(r.locale).toUpperCase()}` : ""}
                        {r.issues?.length > 0 && <div style={{ color: "#e06c5b", fontSize: 12 }}>{r.issues.join(" · ")}</div>}
                      </td>
                      <td style={{ padding: 8, color: C.mute, whiteSpace: "pre-wrap" }}>{String(initial[r.key]?.[r.locale as Loc] ?? r.before ?? "")}</td>
                      <td style={{ padding: 8, whiteSpace: "pre-wrap" }}>{String(r.after ?? "")}</td>
                    </tr>
                  ))}
                  {Object.entries(cross).flatMap(([cid, list]) =>
                    list.map((c, i) => (
                      <tr key={cid + i} style={{ borderTop: `1px solid ${C.line}`, verticalAlign: "top" }}>
                        <td style={{ padding: 8 }}>
                          {labelOf(c.key)} · {c.locale.toUpperCase()}
                          <div style={{ color: C.mute, fontSize: 11.5 }}>on {cid}</div>
                        </td>
                        <td style={{ padding: 8, color: C.mute, whiteSpace: "pre-wrap" }}>{(() => { const v = others.find((o) => o.id === cid)?.values[c.key]; return v && typeof v === "object" ? String(v[c.locale] ?? "") : ""; })()}</td>
                        <td style={{ padding: 8, whiteSpace: "pre-wrap" }}>{c.value}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
              {review.errors.length > 0 && <div style={{ color: "#e06c5b", fontSize: 13 }}>{review.errors.join(" · ")}</div>}
              <Consistency
                keys={[...new Set([...changed.map((c) => c.key).filter((k) => isText(fieldByKey(k))), ...CTA_KEYS])]}
                mine={(k) => ({ en: textOf(k, "en"), de: textOf(k, "de") })}
                others={others}
                lex={lex}
                cross={cross}
                onUseLex={(k, e) => {
                  setText(k, "en", e.en);
                  if (e.de) setText(k, "de", e.de);
                }}
                onSync={(k, ids) =>
                  setCross((c) => {
                    const out = { ...c };
                    for (const cid of ids)
                      out[cid] = [...(out[cid] ?? []).filter((x) => x.key !== k), ...(["en", "de"] as Loc[]).filter((l) => textOf(k, l)).map((l) => ({ key: k, locale: l, value: textOf(k, l) }))];
                    return out;
                  })
                }
              />
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button style={{ ...btn(), background: C.lava, borderColor: C.lava, color: "#fff", fontWeight: 600, height: 38, padding: "0 18px" }} disabled={!!busy} onClick={() => void apply()}>
                  Apply to staging
                </button>
                <span style={{ fontSize: 12.5, color: C.mute }}>Writes the card, engagement and module on staging and republishes the page. Figma picks it up on its next sync.</span>
              </div>
            </>
          )}
          {result && (
            <div style={{ display: "grid", gap: 6, fontSize: 13.5 }}>
              {result.pushed.map((p, i) => (
                <div key={i} style={{ color: C.ok }}>✓ {p}</div>
              ))}
              {result.errors.map((p, i) => (
                <div key={i} style={{ color: "#e06c5b" }}>✗ {p}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- drawer with notch ---- */}
      <aside
        aria-label="Edit texts"
        style={{ position: "fixed", top: 64, right: 0, bottom: 0, width: 460, zIndex: 40, transform: drawer ? "translateX(0)" : "translateX(100%)", transition: "transform .28s cubic-bezier(.22,1,.36,1)", background: "rgba(20,20,23,.97)", borderLeft: `1px solid ${C.line2}`, boxShadow: drawer ? "-24px 0 60px -30px rgba(0,0,0,.8)" : "none", display: "flex", flexDirection: "column" }}
        onKeyDown={(e) => e.key === "Escape" && setDrawer(false)}
      >
        <button
          onClick={() => setDrawer((d) => !d)}
          aria-expanded={drawer}
          aria-label={drawer ? "Close the text editor" : "Open the text editor"}
          style={{ position: "absolute", left: -34, top: "38%", width: 34, height: 132, borderRadius: "12px 0 0 12px", border: `1px solid ${C.line2}`, borderRight: 0, background: "#1b1b1f", color: C.fg, cursor: "pointer", display: "grid", placeItems: "center", gap: 6, padding: "10px 0" }}
        >
          <Icon d={drawer ? I.right : I.left} />
          <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 11.5, letterSpacing: ".06em" }}>Edit texts{changed.length ? ` · ${changed.length}` : ""}</span>
        </button>
        <div style={{ padding: "16px 18px 10px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: ".08em" }}>{focusStation ? LANES[focusStation.lane].title : ""}</div>
            <div style={{ fontSize: 15, fontWeight: 650 }}>{focusStation?.label ?? "Pick a screen"}</div>
            <div style={{ fontSize: 11.5, color: C.mute }}>{focusStation?.note}</div>
          </div>
          <button aria-label="Close" style={{ ...btn(), padding: "0 8px" }} onClick={() => setDrawer(false)}>
            <Icon d={I.x} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "12px 18px 40px", display: "grid", gap: 12, alignContent: "start" }}>
          {drawerKeys.length === 0 && <div style={{ fontSize: 13, color: C.mute }}>Tap a text on any screen to edit it here.</div>}
          {drawerKeys.map((k) => (
            <FieldBox
              key={k}
              k={k}
              focused={focus === k}
              value={{ en: textOf(k, "en"), de: textOf(k, "de") }}
              initial={initial[k] ?? { en: "", de: "" }}
              where={whereUsed(k)}
              issues={{ en: issuesOf(k, "en"), de: issuesOf(k, "de") }}
              onFocus={() => setFocus(k)}
              onChange={(l, v) => setText(k, l, v)}
              onBlur={(l) => checkScope(k, l)}
              onSave={async () => {
                const r = await fetch("/api/teamcards/lexicon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", field: k, en: textOf(k, "en"), de: textOf(k, "de") }) }).then((x) => x.json());
                if (r.entries) setLex(r.entries);
              }}
            />
          ))}
        </div>
      </aside>

      {/* ---- smart change pop-up ---- */}
      {ask && (
        <ScopeDialog
          ask={ask}
          onClose={() => setAsk(null)}
          onNext={(picked) => {
            const chosen = ask.hits.filter((h) => picked.includes(h.id));
            for (const h of chosen.filter((x) => x.card === null)) setText(h.key, h.locale, h.after);
            if (chosen.some((x) => x.card))
              setCross((c) => {
                const out = { ...c };
                for (const h of chosen.filter((x) => x.card)) out[h.card!] = [...(out[h.card!] ?? []).filter((x) => !(x.key === h.key && x.locale === h.locale)), { key: h.key, locale: h.locale, value: h.after }];
                return out;
              });
            const nx = ([1, 2] as const).find((g) => g > ask.stage && ask.hits.some((h) => h.group === g));
            setAsk(nx ? { ...ask, stage: nx } : null);
          }}
        />
      )}
    </div>
  );
}

// one field in the drawer: label, what it is, EN + DE, counters, rules (lexicon + other cards: in the review)
function FieldBox({
  k, focused, value, initial, where, issues, onFocus, onChange, onBlur, onSave,
}: {
  k: string; focused: boolean; value: LV; initial: LV; where: string[]; issues: Record<Loc, string[]>;
  onFocus: () => void; onChange: (l: Loc, v: string) => void; onBlur: (l: Loc) => void; onSave: () => void;
}) {
  const f = fieldByKey(k);
  const h = HINTS[k];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);
  const long = f?.kind === "textarea" || value.en.length > 60;
  const dirty = value.en !== initial.en || value.de !== initial.de;
  return (
    <div ref={ref} style={{ borderRadius: 12, border: `1px solid ${focused ? C.lava : C.line}`, background: focused ? "rgba(255,45,0,.05)" : "#18181b", padding: 12, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {f?.label ?? k}
          {dirty && <span style={{ color: C.lava, fontWeight: 500, fontSize: 11.5 }}> · changed</span>}
        </div>
        <span style={{ fontSize: 10.5, color: C.mute, textAlign: "right" }}>on {where.join(", ")}</span>
      </div>
      {h && (
        <div style={{ display: "flex", gap: 8, fontSize: 12, color: "#c7c5cb", background: "rgba(127,184,255,.06)", border: "1px solid rgba(127,184,255,.18)", borderRadius: 8, padding: "7px 9px" }}>
          <span style={{ color: "#7fb8ff", marginTop: 1 }}>
            <Icon d={I.info} size={14} />
          </span>
          <span>
            {h.what}
            {h.rules?.length ? <span style={{ color: C.mute }}> {h.rules.join(" · ")}</span> : null}
          </span>
        </div>
      )}
      {(["en", "de"] as Loc[]).map((l) => (
        <div key={l} style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.mute }}>
            <span style={{ fontWeight: 700, letterSpacing: ".06em" }}>{l.toUpperCase()}</span>
            <span style={{ color: f?.maxWords && words(value[l]) > f.maxWords ? "#e06c5b" : C.mute }}>{f?.maxWords ? `${words(value[l])}/${f.maxWords} words` : `${value[l].length} characters`}</span>
          </div>
          <textarea
            aria-label={`${f?.label ?? k} ${l.toUpperCase()}`}
            rows={long ? Math.max(2, Math.ceil(value[l].length / 52)) : 1}
            value={value[l]}
            onFocus={onFocus}
            onChange={(e) => onChange(l, e.target.value)}
            onBlur={() => onBlur(l)}
            style={{ width: "100%", resize: "vertical", fontSize: 14, lineHeight: 1.45, padding: "8px 10px", borderRadius: 8, border: `1px solid ${issues[l].length ? "rgba(224,108,91,.6)" : !value[l].trim() && l === "de" && value.en.trim() ? "rgba(255,45,0,.5)" : C.line2}`, background: "#0f0f12", color: C.fg, fontFamily: "inherit" }}
          />
          {issues[l].length > 0 && (
            <div role="alert" style={{ fontSize: 11.5, color: "#e06c5b" }}>
              {issues[l].join(" · ")}
            </div>
          )}
          {l === "de" && value.en.trim() && !value.de.trim() && <div style={{ fontSize: 11.5, color: C.lava }}>German is missing.</div>}
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <details style={{ fontSize: 11.5, color: C.mute }}>
          <summary style={{ cursor: "pointer" }}>Team rules</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 16, display: "grid", gap: 2 }}>
            {TEAM_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
        <button onClick={onSave} style={{ ...btn(), height: 26, fontSize: 11.5 }} title="Keep this EN/DE wording as an approved phrasing for this field">
          <Icon d={I.book} size={13} /> Save to lexicon
        </button>
      </div>
    </div>
  );
}

function ScopeDialog({ ask, onClose, onNext }: { ask: Ask; onClose: () => void; onNext: (picked: string[]) => void }) {
  const items = ask.hits.filter((h) => h.group === ask.stage);
  const [picked, setPicked] = useState<string[]>(items.map((i) => i.id));
  useEffect(() => setPicked(items.map((i) => i.id)), [ask.stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const phrase = ask.oldP === ask.from ? "text" : `“${ask.oldP}”`;
  const cards = new Set(items.map((i) => i.card)).size;
  const title =
    ask.stage === 0
      ? `${phrase[0].toUpperCase() + phrase.slice(1)} also appears in ${items.length === 1 ? "one more text" : `${items.length} more texts`} of this card. Replace it there too?`
      : ask.stage === 1
        ? `${cards} other card${cards === 1 ? "" : "s"} of this campaign use ${phrase}. Replace it there too?`
        : `${cards} card${cards === 1 ? "" : "s"} in other campaigns use ${phrase}. Is this a global change?`;
  return (
    <div role="dialog" aria-modal="true" aria-label="Where else should this change?" style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 600, maxWidth: "calc(100vw - 32px)", borderRadius: 16, background: "#18181b", border: `1px solid ${C.line2}`, boxShadow: "0 30px 80px -20px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.06)", padding: 20, display: "grid", gap: 14 }}>
        <div style={{ fontSize: 11, color: C.mute, letterSpacing: ".08em", textTransform: "uppercase" }}>
          Search and replace · {ask.lang.toUpperCase()} · step {ask.stage + 1} of 3
        </div>
        <div style={{ fontSize: 16, fontWeight: 650 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.mute }}>
          <span style={{ textDecoration: "line-through" }}>{ask.oldP}</span> → <span style={{ color: C.fg }}>{ask.newP || "(removed)"}</span>
        </div>
        <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto" }}>
          {items.map((i) => (
            <label key={i.id} style={{ display: "flex", gap: 10, alignItems: "start", fontSize: 13, padding: "7px 9px", borderRadius: 8, border: `1px solid ${C.line}` }}>
              <input type="checkbox" checked={picked.includes(i.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i.id] : p.filter((x) => x !== i.id)))} style={{ marginTop: 3 }} />
              <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 11.5, color: C.mute }}>
                  {i.card ? `${i.cardName} · ` : ""}
                  {labelOf(i.key)}
                </span>
                <span style={{ whiteSpace: "pre-wrap" }}>{i.after}</span>
              </span>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn()} onClick={() => onNext([])}>
            Skip
          </button>
          <button style={{ ...btn(), background: C.lava, borderColor: C.lava, color: "#fff", fontWeight: 600 }} onClick={() => onNext(picked)}>
            Replace in {picked.length} text{picked.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

// review summary: is this wording the same on every card? lexicon + other cards, grouped by wording
function Consistency({
  keys, mine, others, lex, cross, onUseLex, onSync,
}: {
  keys: string[]; mine: (k: string) => LV; others: OtherCard[]; lex: LexEntry[]; cross: Cross;
  onUseLex: (k: string, e: LexEntry) => void; onSync: (k: string, ids: string[]) => void;
}) {
  const blocks = keys
    .map((k) => {
      const my = mine(k);
      const val = (o: OtherCard) => {
        const v = o.values[k];
        return v && typeof v === "object" ? { en: String(v.en ?? ""), de: String(v.de ?? "") } : { en: "", de: "" };
      };
      const groups = new Map<string, { en: string; de: string; cards: OtherCard[] }>();
      for (const o of others) {
        const v = val(o);
        if (!v.en.trim()) continue;
        if (!CTA_KEYS.includes(k) && !similar(v.en, my.en)) continue; // texts: only similar expressions; CTAs: every wording
        const g = groups.get(norm(v.en)) ?? { ...v, cards: [] };
        g.cards.push(o);
        groups.set(norm(v.en), g);
      }
      const differ = [...groups.values()].filter((g) => norm(g.en) !== norm(my.en) || norm(g.de) !== norm(my.de)).sort((a, b) => b.cards.length - a.cards.length);
      const same = [...groups.values()].filter((g) => norm(g.en) === norm(my.en) && norm(g.de) === norm(my.de)).reduce((n, g) => n + g.cards.length, 0);
      const lx = lex.filter((e) => e.field === k && norm(e.en) !== norm(my.en)).sort((a, b) => Number(b.saved) - Number(a.saved) || b.uses - a.uses).slice(0, 3);
      return { k, my, differ, same, lx };
    })
    .filter((b) => b.my.en.trim() && (b.differ.length || b.lx.length));
  if (!blocks.length) return null;
  return (
    <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 650 }}>Same wording on every card?</div>
        <div style={{ fontSize: 12.5, color: C.mute }}>Similar texts and every button label on the other cards, plus approved phrasings from the lexicon. Sync them so the same content and function reads the same everywhere.</div>
      </div>
      {blocks.map((b) => (
        <div key={b.k} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, display: "grid", gap: 8, background: "#141417" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {labelOf(b.k)}
              <span style={{ color: C.mute, fontWeight: 400 }}> · this card: “{b.my.en}”{b.my.de ? ` / “${b.my.de}”` : ""}</span>
            </div>
            {b.same > 0 && <span style={{ fontSize: 11.5, color: C.ok }}>same on {b.same} card{b.same === 1 ? "" : "s"}</span>}
          </div>
          {b.differ.map((g) => {
            const ids = g.cards.map((c) => c.id);
            const done = ids.every((id) => (cross[id] ?? []).some((x) => x.key === b.k));
            return (
              <div key={g.en} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", fontSize: 12.5, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
                <span style={{ minWidth: 0 }}>
                  “{g.en}”{g.de ? <span style={{ color: C.mute }}> / “{g.de}”</span> : null}
                  <span style={{ display: "block", fontSize: 11, color: C.mute }}>
                    {g.cards.length} card{g.cards.length === 1 ? "" : "s"}: {g.cards.slice(0, 6).map((c) => c.name).join(", ")}
                    {g.cards.length > 6 ? ` +${g.cards.length - 6}` : ""}
                  </span>
                </span>
                <button style={{ ...btn(done), flexShrink: 0 }} disabled={done} onClick={() => onSync(b.k, ids)}>
                  {done ? "Will be synced" : `Use this card's wording on ${ids.length}`}
                </button>
              </div>
            );
          })}
          {b.lx.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
              <span style={{ fontSize: 11, color: C.mute, alignSelf: "center" }}>Lexicon:</span>
              {b.lx.map((e) => (
                <button key={e.id} onClick={() => onUseLex(b.k, e)} style={{ ...btn(), height: 28, fontSize: 12 }} title="Use this wording on this card">
                  <span style={{ color: e.saved ? C.ok : C.mute, fontSize: 10.5 }}>{e.saved ? "approved" : `used ${e.uses}×`}</span> {e.en}
                  {e.de ? <span style={{ color: C.mute }}> / {e.de}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
