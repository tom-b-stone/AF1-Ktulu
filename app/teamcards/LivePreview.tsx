"use client";

// Mobile preview of a Team Card in the real audif1.com frontend: the page is
// rendered in an iframe with the production CSS (public/af1-live/site.css) and
// the production markup of the modules (badge engagement teaser with the
// engagement widget, badge coin with its flip). Card popups are client-only on
// the site, so they are composed from the same CSS classes after the final
// Figma designs. Texts update live from the editor; clicking a text in the
// preview selects its field on the left.
import { useEffect, useMemo, useRef } from "react";
import type { Loc } from "@/lib/teamCardFields";
import { NOT_DEFINED, cardTemplate } from "@/lib/cardTemplate";

type Vals = Record<string, { en?: string; de?: string } | string | boolean | undefined>;
export type PreviewCard = {
  imageUrl?: string;
  engagementImageUrl?: string;
  badgeTypeLabel?: string;
  raceLabel?: string;
  rewardType?: string;
  preview?: { type?: string; options: { en: string[]; de: string[] }; image?: string; postImage?: string; overlay?: boolean; category?: { en: string; de: string } } | null;
};

const BACKSIDE = "https://www.audif1.com/_next/image?url=%2Fbadge-backside.png&w=1200&q=75";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const abs = (u?: string) => (!u ? "" : u.startsWith("/") && typeof window !== "undefined" ? window.location.origin + u : u);

export function textOf(vals: Vals, k: string, lang: Loc) {
  const v = vals[k];
  if (v && typeof v === "object") return v[lang] ?? "";
  return typeof v === "string" ? v : "";
}

// ---- templates (mobile markup from audif1.com) -----------------------------
export function build(view: string, vals: Vals, lang: Loc, card: PreviewCard) {
  const de = lang === "de";
  const T = (k: string, tag: string, cls: string, opt = false, ph = "") => {
    const v = textOf(vals, k, lang);
    return `<${tag} class="${cls}" data-k="${k}"${opt ? " data-opt" : ""} data-ph="${esc(ph)}"${opt && !v ? " hidden" : ""}>${esc(v)}</${tag}>`;
  };
  const img = abs(card.imageUrl) || cardTemplate(textOf(vals, "publicTitle", lang) || textOf(vals, "publicTitle", "en"), lang);
  const engImg = abs(card.preview?.image || card.engagementImageUrl);
  const postImg = abs(card.preview?.postImage) || engImg;
  const race = esc(card.preview?.category?.[lang] || card.raceLabel || "Audi Revolut F1® Team");
  const options = card.preview?.options?.[lang]?.length ? card.preview.options[lang] : card.preview?.options?.en ?? [];

  const coin = (face: "front" | "back", reveal = false) => `
    <div style="--badge-teaser-reveal-duration:1200ms;--badge-teaser-conceal-duration:650ms" data-face="${face}" data-played="false" class="badge-teaser mx-auto w-fit max-w-full select-none" data-coin>
      <div class="px-space-300 py-space-250"><div class="badge-teaser-coin relative aspect-[4/5] w-[calc(var(--spacing-size-6000)+var(--spacing-size-1200))] max-w-full -rotate-7">
        <div class="badge-coin"${reveal ? ' data-started="true" style="--badge-reveal-duration:1600ms;--badge-reveal-delay:150ms"' : ""}><div class="badge-coin__rotor" data-flipped="true"${reveal ? ' data-spinning="true"' : ""}>
          <div class="badge-coin__face"><img alt="" draggable="false" class="object-cover" style="position:absolute;height:100%;width:100%;inset:0" src="${esc(img)}"></div>
          <div class="badge-coin__face badge-coin__face--back"><img alt="" draggable="false" class="object-cover" style="position:absolute;height:100%;width:100%;inset:0" src="${BACKSIDE}"><span class="badge-coin__shimmer"></span></div>
        </div></div>
      </div></div>
      <div aria-hidden="true" class="badge-teaser-shadow mx-auto h-size-1200 w-size-6000 max-w-full bg-[radial-gradient(closest-side,var(--color-af1-graphite),transparent)] opacity-[0.3] blur-[4px]"></div>
    </div>`;

  const answers = options.length
    ? `<div class="flex flex-col gap-space-200"><div class="flex flex-col gap-space-50">${options
        .map(
          (o) => `<button type="button" aria-pressed="false" data-answer class="relative flex w-full overflow-hidden rounded-sm text-left text-af1-graphite p-space-100 bg-af1-grey-01 cursor-pointer hover:bg-af1-grey-02 transition-colors duration-200 ease-in-out"><span aria-hidden="true" class="absolute inset-y-0 left-0 transition-[width] duration-600 ease-out bg-af1-grey-02" style="width:0%"></span><span class="relative z-10 flex w-full min-w-0 items-center justify-between gap-space-100"><span class="flex min-w-0 items-center gap-space-100"><span class="text-copy-short-2 text-weight-normal truncate">${esc(o)}</span></span></span></button>`,
        )
        .join("")}</div></div>`
    : `<div class="flex flex-col gap-space-100">
        <textarea data-count maxlength="200" rows="3" placeholder="${de ? "Deine Antwort" : "Your answer"}" style="width:100%;border-radius:8px;border:0;padding:12px;font:inherit;background:var(--color-af1-chalk,#f5f2f2);color:var(--color-af1-graphite,#2b2929);resize:none"></textarea>
        <p class="text-copy-3 text-weight-normal text-af1-chalk" style="text-align:right" data-counter>${de ? "200 Zeichen übrig" : "200 characters left"}</p>
        <button type="button" class="button text-copy-2 button-primary px-space-300 py-space-150 gap-space-150 min-h-size-1200 max-md:w-full">${T("submitLabel", "span", "text-copy-short-2 text-weight-normal", false, "Button")}</button>
      </div>`;

  const widget = (inner: string, dim = false, bgImg = engImg) => `
    <section class="af1-container"><div class="widget-grid [--grid-max-col-count:2]!"><div class="@container relative rounded-sm col-span-2 row-span-3 bg-af1-graphite"><div class="@container-[size] aspect-widget-portrait"><div class="h-full">
      <div class="relative w-full h-full overflow-hidden rounded-sm">
        ${bgImg ? `<img alt="" class="object-cover" style="position:absolute;height:100%;width:100%;inset:0" src="${esc(bgImg)}">` : ""}
        <div style="background:linear-gradient(0deg, rgba(0, 0, 0, ${dim ? 0.7 : card.preview?.overlay === false ? 0 : 0.4}) 0%, rgba(0, 0, 0, ${dim ? 0.7 : card.preview?.overlay === false ? 0 : 0.4}) 100%)" class="absolute z-0 w-full h-full top-0 left-0 rounded-sm"></div>
        <div class="relative z-10 flex flex-1 p-space-150 w-full h-full flex-col justify-between">${inner}</div>
      </div>
    </div></div></div></div></section>`;

  const question = widget(`
      <div class="flex flex-col gap-space-100"><div class="flex flex-col gap-space-100"><p class="text-copy-3 text-weight-normal text-af1-chalk">${race}</p>${T("question", "h2", "text-headline-4-fixed text-weight-normal text-af1-chalk", false, "Your question to the fans")}</div></div>
      ${answers}`);

  const bgKey = String(vals.modBackground ?? "grey-01");
  const bgCls = bgKey === "graphite" ? "bg-af1-graphite text-af1-chalk" : bgKey === "chalk" ? "bg-af1-chalk text-af1-graphite" : "bg-af1-grey-01 text-af1-graphite";

  const module = `
    <section class="py-space-700 ${bgCls}"><div class="af1-container grid grid-cols-1">
      <div class="flex flex-col items-center px-space-350 text-center">
        ${T("modCategory", "p", "text-copy-3 text-weight-normal pb-space-150", true)}
        ${T("modHeadline", "h2", "text-headline-1 text-weight-normal pb-space-150", false, "Headline")}
        ${T("modSubline", "p", "text-copy-2 text-weight-normal pb-space-150", true)}
        ${T("modCopy", "p", "text-copy-2 text-weight-normal", true)}
      </div>
      <div class="mt-space-400 w-full">${coin("back")}</div>
      <div class="mt-space-400">${question}</div>
    </div></section>`;

  const popup = (slides: { body: string }[], btn: string) => `
    <div class="bg-af1-graphite text-af1-chalk" style="min-height:100vh;display:flex;flex-direction:column;padding:20px 0 28px;position:relative">
      <span style="position:absolute;right:20px;top:18px;width:30px;height:30px;border-radius:99px;border:1px solid var(--color-af1-chalk,#f5f2f2);display:grid;place-items:center;font-size:13px">✕</span>
      <div data-slides style="display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;flex:1">
        ${slides.map((s) => `<div style="flex:0 0 100%;scroll-snap-align:center;display:flex;flex-direction:column;padding:48px 24px 0">${s.body}</div>`).join("")}
      </div>
      <div style="padding:0 24px">
        <div class="flex items-center gap-space-100" style="justify-content:center;margin:18px 0" data-dots>${slides.map((_, i) => `<span style="width:7px;height:7px;border-radius:9px;background:${i ? "#6b6767" : "#fff"}"></span>`).join("")}</div>
        <button type="button" class="button text-copy-2 button-primary px-space-300 py-space-150 gap-space-150 min-h-size-1200 w-full" style="width:100%">${btn}</button>
      </div>
    </div>`;

  const front = (title: string, text: string, reveal = false) => ({
    body: `<div style="width:230px;max-width:100%;margin:0 auto">${coin("front", reveal)}</div><div style="flex:1"></div>
      ${T(title, "h2", "text-headline-3 text-weight-normal text-center", false, "Title")}
      ${T(text, "p", "text-copy-2 text-weight-normal text-center", false, "Text")}`.replace(/class="text-headline-3/, 'style="margin-top:20px" class="text-headline-3').replace(/class="text-copy-2 text-weight-normal text-center"/, 'style="margin-top:8px;opacity:.9" class="text-copy-2 text-weight-normal text-center"'),
  });
  // a detail the card does not define yet shows a template status instead of an empty cell
  const cell = (h: string, v: string, todo = false) => `<div style="text-align:center"><p class="text-copy-3 text-weight-normal" style="letter-spacing:.04em;opacity:.7">${h}</p><p class="text-copy-2 text-weight-normal" style="margin-top:4px;min-height:20px${!v && todo ? ";opacity:.55;font-style:italic" : ""}">${esc(v || (todo ? NOT_DEFINED[lang] : ""))}</p></div>`;
  const back = (text: string) => ({
    body: `<div style="background:#3D3A3A;border-radius:14px;padding:18px 14px 26px">
        <p class="text-headline-4 text-weight-normal" style="text-align:center">Team Card Details</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
          ${cell(de ? "TYP" : "CARD TYPE", card.badgeTypeLabel ?? "", true)}${cell(de ? "RENNEN" : "RACE", card.raceLabel ?? "", true)}${cell(de ? "EINGELÖST" : "REDEEMED", "")}${cell(de ? "GESAMMELT AM" : "DATE EARNED", "")}
        </div></div><div style="flex:1"></div>
      ${T(text, "p", "text-copy-2 text-weight-normal text-center", false, "Text")}`,
  });
  const btn = (k?: string, fixed?: string) => (k ? T(k, "span", "text-copy-short-2 text-weight-normal", false, "Button") : `<span class="text-copy-short-2 text-weight-normal">${esc(fixed ?? "")}</span>`);
  const toCollection = de ? "Zur Collection" : "Go to Trophy Cabinet";
  const allCards = de ? "Alle Team Cards ansehen" : "Check out all Team Cards";

  const shelf = (earned: boolean) => `
    <section class="bg-af1-chalk text-af1-graphite py-space-700"><div class="af1-container">
      <p class="text-copy-2 text-weight-normal text-af1-lava-red">${de ? "Sammle die Team Cards" : "Collect the Team Cards"}</p>
      <h2 class="text-headline-2-fixed text-weight-normal" style="margin-top:8px">${de ? "Deine Team Card Collection" : "Your Team Card collection"}</h2>
      <div class="bg-af1-graphite text-af1-chalk rounded-md" style="padding:16px;margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${[0, 1]
          .map(
            (i) => `<div><div class="rounded-sm" style="overflow:hidden;background:#3D3A3A;aspect-ratio:300/374"><img alt="" style="width:100%;height:100%;object-fit:cover;${i === 0 && earned ? "" : "filter:grayscale(1) opacity(.6)"}" src="${i === 0 && earned ? esc(img) : BACKSIDE}"></div>
            <div style="display:flex;justify-content:space-between;gap:6px;margin-top:6px">${i === 0 ? T("publicTitle", "p", "text-copy-short-2 text-weight-normal", false, "Card title") : `<p class="text-copy-short-2 text-weight-normal" style="opacity:.6">${de ? "Nächste Team Card" : "Next Team Card"}</p>`}
            <span style="width:18px;height:18px;border-radius:99px;flex-shrink:0;font-size:11px;line-height:18px;text-align:center;${i === 0 && earned ? "background:#ff2d00;color:#fff" : "border:1px solid #ff2d00;color:#ff2d00"}">${i === 0 && earned ? "✓" : "+"}</span></div></div>`,
          )
          .join("")}
      </div></div></section>`;

  const share = `
    <section class="bg-af1-chalk text-af1-graphite py-space-700"><div class="af1-container">
      <div class="rounded-md" style="background:#fff;padding:18px;box-shadow:0 6px 20px rgba(0,0,0,.08)">
        <p class="text-copy-3 text-weight-normal" style="opacity:.6">WhatsApp · Facebook · X · ${de ? "Link kopieren" : "Copy link"}</p>
        ${T("shareTitle", "p", "text-headline-4 text-weight-normal", false, "Share title").replace('class="text-headline-4', 'style="margin-top:10px" class="text-headline-4')}
        ${T("shareText", "p", "text-copy-2 text-weight-normal", false, "Share text")}
        <p class="text-copy-3 text-weight-normal text-af1-lava-red" style="margin-top:8px">audif1.com/…</p>
      </div></div></section>`;

  const overlay = `<div style="position:relative">${question}
    <div style="position:absolute;inset:0;background:rgba(43,41,41,.6);display:flex;align-items:center;justify-content:center;padding:0 24px">
      <div class="bg-af1-chalk text-af1-graphite rounded-md" style="padding:24px;text-align:center;position:relative;width:100%">
        <span style="position:absolute;right:14px;top:12px;width:24px;height:24px;border-radius:99px;border:1px solid currentColor;font-size:12px;line-height:22px">✕</span>
        ${T("overlayTitle", "h3", "text-headline-3 text-weight-normal", false, "Title").replace('class="text-headline-3', 'style="margin-top:14px" class="text-headline-3')}
        <div style="height:1px;background:#b3afaf;margin:12px 0"></div>
        ${T("overlaySubtitle", "p", "text-copy-2 text-weight-normal", false, "One more step: log in…")}
        <div style="margin-top:18px"><button type="button" class="button text-copy-2 button-primary px-space-300 py-space-150 gap-space-150 min-h-size-1200 w-full" style="width:100%"><span class="text-copy-short-2 text-weight-normal">${de ? "Anmelden oder registrieren" : "Login or register"}</span></button></div>
      </div></div></div>`;

  const post = widget(`
      <div class="flex flex-col gap-space-100"><p class="text-copy-3 text-weight-normal text-af1-chalk">${race}</p></div>
      <div class="flex flex-col gap-space-100"><p class="text-headline-3 text-weight-normal text-af1-chalk">✓</p>
      ${T("postTitle", "h2", "text-headline-4-fixed text-weight-normal text-af1-chalk", false, "Title after the answer")}
      ${T("postMessage", "p", "text-copy-2 text-weight-normal text-af1-chalk", false, "Message after the answer")}</div>`, false, postImg);

  const reward = `<section class="bg-af1-chalk text-af1-graphite py-space-700"><div class="af1-container flex flex-col gap-space-200">${(
    [
      ["Raffle", "raffleSignup", "Sign-up form with terms and a confirmation."],
      ["Voucher", "couponCode", "Code shown after collecting."],
      ["Just the card", "noReward", "The card itself is the reward."],
    ] as const
  )
    .map(([t, key, txt]) => {
      const on = (card.rewardType ?? "noReward") === key;
      return `<div class="rounded-md" style="padding:20px;background:${on ? "#fff" : "transparent"};border:1px ${on ? "solid #fff" : "dashed #b3afaf"};opacity:${on ? 1 : 0.55}"><p class="text-headline-4 text-weight-normal">${t}</p><p class="text-copy-2 text-weight-normal" style="margin-top:6px">${on ? txt : "Not part of this card."}</p></div>`;
    })
    .join("")}</div></section>`;

  const screens: Record<string, string> = {
    module,
    question: `<div class="bg-af1-grey-01 py-space-700">${question}</div>`,
    overlay: `<div class="bg-af1-grey-01 py-space-700">${overlay}</div>`,
    post: `<div class="bg-af1-grey-01 py-space-700">${post}</div>`,
    share,
    reveal: popup([front("revealTitle", "revealDescription", true), back("rewardTeaser")], btn("revealButton")),
    collected: popup([front("badgePopupTitle", "rewardDescription", true), back("description")], btn(undefined, toCollection)),
    unearned: popup([front("publicTitle", "rewardTeaser"), back("description")], btn("ctaLabel")),
    earned: popup([front("publicTitle", "description"), back("rewardDescription")], btn(undefined, allCards)),
    shelf: shelf(false) + shelf(true),
    reward,
  };
  return screens[view] ?? module;
}

const RUNTIME = `
const send = (m) => parent.postMessage({ af1: true, ...m }, "*");
document.addEventListener("click", (e) => {
  const k = e.target.closest("[data-k]");
  if (k) { e.preventDefault(); send({ type: "focus", k: k.dataset.k }); }
  const c = e.target.closest("[data-coin]");
  if (c && !k) { c.dataset.played = "true"; c.dataset.face = c.dataset.face === "front" ? "back" : "front"; }
  const a = e.target.closest("[data-answer]");
  if (a) { document.querySelectorAll("[data-answer]").forEach((b) => { b.setAttribute("aria-pressed", String(b === a)); b.firstElementChild.style.width = b === a ? "100%" : "0%"; }); }
});
document.addEventListener("input", (e) => {
  if (e.target.matches("[data-count]")) { const n = 200 - e.target.value.length; document.querySelectorAll("[data-counter]").forEach((x) => (x.textContent = x.textContent.replace(/\\d+/, n))); }
});
const slides = document.querySelector("[data-slides]");
if (slides) slides.addEventListener("scroll", () => {
  const i = Math.round(slides.scrollLeft / slides.clientWidth);
  document.querySelectorAll("[data-dots] span").forEach((d, j) => (d.style.background = i === j ? "#fff" : "#6b6767"));
});
addEventListener("message", (e) => {
  const m = e.data || {};
  if (m.type === "set") document.querySelectorAll('[data-k="' + m.k + '"]').forEach((el) => { el.textContent = m.v; if (el.hasAttribute("data-opt")) el.hidden = !m.v; });
  if (m.type === "focus") {
    document.querySelectorAll(".af-focus").forEach((el) => el.classList.remove("af-focus"));
    const el = document.querySelector('[data-k="' + m.k + '"]');
    if (el) { el.classList.add("af-focus"); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }
});
`;

export function LivePreview({ view, vals, lang, card, focus, onFocus, active = false }: { view: string; vals: Vals; lang: Loc; card: PreviewCard; focus?: string; onFocus: (k: string) => void; active?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const valsRef = useRef(vals);
  valsRef.current = vals;
  // the document is rebuilt only when the screen or language changes; texts are pushed in
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doc = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `<!doctype html><html class="dark" lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${origin}/af1-live/site.css">
<style>
  body{margin:0;background:var(--color-af1-chalk,#f5f2f2)}
  [data-k]{cursor:pointer;border-radius:4px;transition:outline-color .15s}
  [data-k]:hover{outline:1px dashed rgba(255,45,0,.6);outline-offset:2px}
  [data-k]:empty:before{content:attr(data-ph);opacity:.4}
  .af-focus{outline:2px solid #ff2d00 !important;outline-offset:3px}
  ::-webkit-scrollbar{display:none}
</style></head>
<body class="__variable_927525 __variable_db72b4"><main>${build(view, valsRef.current, lang, card)}</main><script>${RUNTIME}</script></body></html>`;
  }, [view, lang, card, String(vals.modBackground ?? "")]);

  // push text changes without reloading
  const sent = useRef<Record<string, string>>({});
  useEffect(() => {
    sent.current = {};
  }, [doc]);
  useEffect(() => {
    const w = ref.current?.contentWindow;
    if (!w) return;
    for (const k of Object.keys(vals)) {
      const v = textOf(vals, k, lang);
      if (sent.current[k] !== v) {
        sent.current[k] = v;
        w.postMessage({ type: "set", k, v }, "*");
      }
    }
  }, [vals, lang]);
  useEffect(() => {
    if (focus) ref.current?.contentWindow?.postMessage({ type: "focus", k: focus }, "*");
  }, [focus, doc]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && e.data?.af1 && e.data.type === "focus") onFocus(String(e.data.k));
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [onFocus]);

  return (
    <div style={{ width: 390, flexShrink: 0, borderRadius: 36, padding: 10, background: "#111", boxShadow: active ? "0 0 0 2px #ff2d00, 0 20px 60px rgba(0,0,0,.35)" : "0 20px 60px rgba(0,0,0,.35)" }}>
      <div style={{ borderRadius: 28, overflow: "hidden", background: "#f5f2f2", height: "max(560px, calc(100vh - 170px))" }}>
        <iframe
          ref={ref}
          title="Mobile preview"
          srcDoc={doc}
          onLoad={() => {
            sent.current = {};
            if (focus) ref.current?.contentWindow?.postMessage({ type: "focus", k: focus }, "*");
          }}
          style={{ width: "100%", height: "100%", border: 0, display: "block" }}
        />
      </div>
    </div>
  );
}
