"use client";

// One mobile screen of audif1.com: the captured site markup (staging, real
// CSS) filled with the card's texts and images. Texts are editable in place;
// edits and clicks go back to the editor. The document is built once per
// template; texts and images are pushed in afterwards, so typing doesn't reload.
import { memo, useEffect, useMemo, useRef } from "react";

export type PhoneValues = Record<string, string>;

const RUNTIME = `
const send = (m) => parent.postMessage({ af1phone: window.name, ...m }, "*");
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
let editable = new Set(), timer = null, ph = {}, anchored = false;
function fill(values, images, missing) {
  document.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.dataset.k;
    if (!(k in values)) return;
    const v = values[k] ?? "";
    if (document.activeElement !== el && el.innerText !== v) el.innerHTML = esc(v).replace(/\\n/g, "<br>");
    const opt = k.includes(".options.") ? el.closest("button") : null;
    if (opt) opt.style.display = v ? "" : "none";
    el.classList.toggle("af-empty", !v && !opt);
    el.classList.toggle("af-missing", !!(missing && missing.includes(k)));
    if (!v && !opt) el.setAttribute("data-ph", ph[k] || "Click to write");
  });
  document.querySelectorAll("[data-img]").forEach((img) => { const u = images[img.dataset.img]; if (u && img.getAttribute("src") !== u) img.setAttribute("src", u); });
}
function setEditable(keys) {
  editable = new Set(keys);
  document.querySelectorAll("[data-k]").forEach((el) => {
    const on = editable.has(el.dataset.k);
    el.contentEditable = on ? "true" : "false";
    el.classList.toggle("af-edit", on);
  });
}
document.addEventListener("click", (e) => {
  const k = e.target.closest("[data-k]");
  if (e.target.closest("a,button") && !(k && editable.has(k.dataset.k))) e.preventDefault();
  if (k) send({ type: "focus", k: k.dataset.k });
}, true);
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-k]");
  if (!el) return;
  clearTimeout(timer);
  timer = setTimeout(() => send({ type: "edit", k: el.dataset.k, v: el.innerText.replace(/\\n$/, "") }), 200);
});
document.addEventListener("focusout", (e) => { const el = e.target.closest && e.target.closest("[data-k]"); if (el) send({ type: "blur", k: el.dataset.k }); });
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && e.target.closest("[data-k]") && !/description|Description|copy|Copy|subline|Subline|message|Message/.test(e.target.closest("[data-k]").dataset.k)) { e.preventDefault(); e.target.blur(); } });
addEventListener("message", (e) => {
  const m = e.data || {};
  if (m.type === "fill") {
    ph = m.placeholders || ph; fill(m.values || {}, m.images || {}, m.missing); setEditable(m.editable || []);
    if (m.anchor && !anchored) { const a = [...document.querySelectorAll('[data-k="' + m.anchor + '"]')].find((x) => x.offsetParent); if (a) { anchored = true; a.scrollIntoView({ block: "center" }); } }
  }
  if (m.type === "focus") {
    document.querySelectorAll(".af-focus").forEach((x) => x.classList.remove("af-focus"));
    const el = m.k && document.querySelector('[data-k="' + m.k + '"]');
    if (el) { el.classList.add("af-focus"); if (m.scroll) el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  }
});
send({ type: "ready" });
`;

function flip(html: string, side?: "front" | "back") {
  if (!side) return html;
  return html.replace(/data-flipped="(true|false)"/g, `data-flipped="${side === "back" ? "true" : "false"}"`);
}

export const SitePhone = memo(function SitePhone({
  id,
  html,
  side,
  values,
  images,
  editable,
  missing,
  placeholders,
  focus,
  scale,
  lang,
  tag,
  anchor,
  height = 780,
  onEvent,
}: {
  id: string;
  html: string;
  side?: "front" | "back";
  values: PhoneValues;
  images: Record<string, string>;
  editable: string[];
  missing?: string[];
  placeholders?: Record<string, string>;
  focus?: string;
  scale: number;
  lang: "en" | "de";
  tag?: string;
  anchor?: string;
  height?: number;
  onEvent: (id: string, m: { type: string; k?: string; v?: string }) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const doc = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `<!doctype html><html class="dark" lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=390,initial-scale=1"><base href="${origin}/">
<link rel="stylesheet" href="${origin}/af1-live/site.css">
<style>
  html,body{margin:0;background:var(--color-af1-chalk,#f5f2f2);min-height:100%}
  body{overflow-x:hidden} ::-webkit-scrollbar{display:none}
  dialog{position:fixed;inset:0;margin:0;width:100%;height:100%}
  .af-edit{cursor:text;border-radius:3px;transition:box-shadow .15s ease-out}
  .af-edit:hover{box-shadow:0 0 0 1px rgba(255,45,0,.55)}
  .af-edit:focus{outline:none;box-shadow:0 0 0 2px #ff2d00}
  .af-focus{box-shadow:0 0 0 2px #ff2d00 !important}
  .af-empty{min-width:2em;display:inline-block}
  .af-empty:before{content:attr(data-ph);opacity:.35}
  .af-missing{box-shadow:0 0 0 1px dashed;outline:1px dashed #ff2d00;outline-offset:2px}
</style></head><body class="__variable_927525 __variable_db72b4"><main>${flip(html, side)}</main><script>${RUNTIME}</script></body></html>`;
  }, [html, side, lang]);

  const push = () => {
    const w = ref.current?.contentWindow;
    if (!w || !ready.current) return;
    w.postMessage({ type: "fill", values, images, editable, missing, placeholders, anchor }, "*");
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(push, [values, images, editable, missing]);
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: "focus", k: focus, scroll: true }, "*");
  }, [focus]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || !e.data?.af1phone) return;
      if (e.data.type === "ready") {
        ready.current = true;
        push();
        if (focus) ref.current?.contentWindow?.postMessage({ type: "focus", k: focus, scroll: true }, "*");
        return;
      }
      onEvent(id, e.data);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onEvent, values, images, editable, missing]);

  const w = 390 * scale;
  const h = height * scale;
  return (
    <div style={{ width: w + 16 * scale, flexShrink: 0, position: "relative" }}>
      {tag && <span style={{ position: "absolute", top: -9, left: 14, zIndex: 2, fontSize: 12, fontWeight: 700, letterSpacing: ".06em", padding: "2px 7px", borderRadius: 99, background: "#18181b", border: "1px solid #3f3f46", color: "#d4d4d8" }}>{tag}</span>}
      <div style={{ borderRadius: 34 * scale, padding: 8 * scale, background: "#09090b", boxShadow: "0 18px 50px -18px rgba(0,0,0,.7), inset 0 0 0 1px rgba(255,255,255,.08)" }}>
        <div style={{ width: w, height: h, borderRadius: 27 * scale, overflow: "hidden", background: "#f5f2f2", position: "relative" }}>
          <iframe ref={ref} name={id} title={id} srcDoc={doc} style={{ width: 390, height, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", display: "block" }} />
        </div>
      </div>
    </div>
  );
});
