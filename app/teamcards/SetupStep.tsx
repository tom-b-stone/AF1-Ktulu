"use client";

// Setup step of the Team Card editor: everything a card needs beyond its
// texts, as five short sections that fold away once done:
//   1 Card        type, Grand Prix, campaign, front and back image
//   2 Engagement  how fans earn it: page visit, Hot or Not, survey, quiz or Q&A, with its items and background
//   3 Module      the staging page the card's module sits on
//   4 Reward      what fans get
//   5 Status      active / disabled
// In the guided setup (only = section number) one section shows at a time and
// is saved when the guide moves on.
// "Save" keeps it in Ktulu; "Save and update staging" builds card, engagement
// and module on staging (the parent asks first).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import BuildPages from "./BuildPages";

type LV = { en?: string; de?: string };
type Item = { id: string; text: LV; mediaId?: string; imageUrl?: string; options?: LV[] };
type EngType = "page" | "hot-or-not" | "survey" | "quiz" | "q-and-a";
export type Setup = {
  engagement?: { type: EngType; items: Item[]; bg?: { type: "color" | "image"; color?: string; mediaId?: string; imageUrl?: string } };
  module?: { pageId?: string; pageUrl?: string; pageTitle?: string; fromFigma?: boolean; blockId?: string };
  reward?: { type: "noReward" | "raffleSignup" | "couponCode" | "downloadAsset" };
  backImageId?: string;
  backImageUrl?: string;
};
type Brief = Record<string, string | undefined>;

const C = { panel: "#141417", line: "#26262b", line2: "#34343b", fg: "#e7e5e4", mute: "#8b8a91", lava: "#ff2d00", ok: "#6fcf7c" };
const ENG: { key: EngType; title: string; text: string }[] = [
  { key: "page", title: "Page visit", text: "Fans open the page and get the card. No task." },
  { key: "hot-or-not", title: "Hot or Not", text: "Fans swipe through pictures and rate each one." },
  { key: "survey", title: "Survey", text: "Fans pick an answer, any answer counts." },
  { key: "quiz", title: "Quiz", text: "Fans pick an answer to a knowledge question." },
  { key: "q-and-a", title: "Q&A", text: "Fans write an answer in their own words." },
];
const REWARD: { key: NonNullable<Setup["reward"]>["type"]; title: string; text: string }[] = [
  { key: "noReward", title: "Just the card", text: "No extra reward." },
  { key: "raffleSignup", title: "Raffle", text: "Collecting the card enters a raffle." },
  { key: "couponCode", title: "Voucher code", text: "Fans get a code." },
  { key: "downloadAsset", title: "Download", text: "Fans download a file, e.g. a wallpaper." },
];
const BG = ["grey-01", "chalk", "graphite", "lava"];
const BG_HEX: Record<string, string> = { "grey-01": "#e0dddd", chalk: "#f5f2f2", graphite: "#2b2929", lava: "#ff2d00" };
const uid = () => Math.random().toString(36).slice(2, 9);

const input: CSSProperties = { height: 34, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.line2}`, background: "#0f0f12", color: C.fg, fontSize: 13, minWidth: 0, width: "100%", boxSizing: "border-box" };
const pill = (on: boolean): CSSProperties => ({ padding: "8px 12px", borderRadius: 10, border: `1px solid ${on ? C.lava : C.line2}`, background: on ? "rgba(255,45,0,.12)" : "transparent", color: C.fg, cursor: "pointer", textAlign: "left", display: "grid", gap: 2, fontSize: 13 });
const smallBtn: CSSProperties = { height: 30, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.line2}`, background: "transparent", color: C.fg, fontSize: 12.5, cursor: "pointer" };

async function compress(f: File): Promise<File> {
  try {
    const { compressImage } = await import("@/lib/imageCompress");
    const c = await compressImage(f, 1600, 0.85);
    return new File([c.blob], f.name.replace(/\.[a-z0-9]+$/i, c.mime === "image/webp" ? ".webp" : ".jpg"), { type: c.mime });
  } catch {
    return f;
  }
}

function Upload({ label, url, onFile, busy }: { label: string; url?: string; onFile: (f: File) => void; busy?: boolean }) {
  return (
    <label style={{ display: "grid", gap: 6, justifyItems: "start", cursor: "pointer" }}>
      <div style={{ width: 96, aspectRatio: "4 / 5", borderRadius: 8, border: `1px dashed ${url ? C.line2 : "#ff1fd2"}`, background: url ? `center/cover url(${url})` : "rgba(255,31,210,.08)", display: "grid", placeItems: "center", fontSize: 11, color: C.mute, textAlign: "center", padding: 4 }}>
        {busy ? "Uploading …" : url ? "" : "Add image"}
      </div>
      <span style={{ fontSize: 12, color: C.mute }}>{label}</span>
      <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

function Section({ n, title, lead, done, open, onToggle, children }: { n: number; title: string; lead: string; done: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${open ? C.line2 : C.line}`, borderRadius: 14, background: open ? C.panel : "transparent" }}>
      <button onClick={onToggle} aria-expanded={open} style={{ all: "unset", cursor: "pointer", display: "flex", gap: 12, alignItems: "center", width: "100%", boxSizing: "border-box", padding: "14px 16px" }}>
        <span style={{ width: 24, height: 24, borderRadius: 99, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, background: done ? "#2e7d4f" : "#27272a", color: "#fff" }}>{done ? "✓" : n}</span>
        <span style={{ display: "grid", flex: 1 }}>
          <span style={{ fontWeight: 650, fontSize: 14 }}>{title}</span>
          {!open && <span style={{ fontSize: 12, color: C.mute }}>{lead}</span>}
        </span>
        <span style={{ fontSize: 12, color: C.mute }}>{open ? "" : done ? "Done" : "Open"}</span>
      </button>
      {open && <div style={{ padding: "0 16px 16px 52px", display: "grid", gap: 14, fontSize: 13 }}>{children}</div>}
    </div>
  );
}

function LocInputs({ value, onChange, ph }: { value: LV; onChange: (v: LV) => void; ph: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      <input style={input} placeholder={`${ph} (EN)`} value={value.en ?? ""} onChange={(e) => onChange({ ...value, en: e.target.value })} />
      <input style={input} placeholder={`${ph} (DE)`} value={value.de ?? ""} onChange={(e) => onChange({ ...value, de: e.target.value })} />
    </div>
  );
}

export default function SetupStep({
  cardId, cardName, imageUrl, onStaging, canBuild, initialSetup, initialBrief, disabled, onToggleDisabled, onImage, onSaved, onBuild, only,
}: {
  only?: number;
  cardId: string; cardName: string; imageUrl?: string; onStaging: boolean; canBuild: boolean;
  initialSetup?: Setup; initialBrief?: Brief; disabled: boolean; onToggleDisabled: (v: boolean) => void;
  onImage: (f: File) => Promise<void>; onSaved: () => void; onBuild: () => void;
}) {
  const [setup, setSetup] = useState<Setup>(initialSetup ?? {});
  const [brief, setBrief] = useState<Brief>({ badgeType: initialBrief?.badgeType ?? "", race: initialBrief?.race ?? "", campaign: initialBrief?.campaign ?? "" });
  const [open, setOpen] = useState(only ?? 0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<{ key: string; name: string; root: string; race: string; figmaUrl?: string; figmaFile?: string }[]>([]);
  const [pages, setPages] = useState<{ id: string; url: string; title: string }[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/teamcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "types" }) }).then((r) => r.json()).then((j) => setTypes((j.types ?? []).map((t: { title: string }) => t.title))).catch(() => {});
    fetch("/api/sitemap/campaigns").then((r) => r.json()).then((j) => setCampaigns(j.campaigns ?? [])).catch(() => {});
  }, []);
  const camp = campaigns.find((c) => c.name === brief.campaign);
  useEffect(() => {
    const term = q || camp?.root || "";
    const t = setTimeout(() => fetch(`/api/teamcards/pages?q=${encodeURIComponent(term)}`).then((r) => r.json()).then((j) => setPages(j.pages ?? [])).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, camp?.root]);

  const up = (fn: (s: Setup) => Setup) => { setSetup((s) => fn(s)); setDirty(true); };
  const eng = setup.engagement ?? { type: "page" as EngType, items: [] };
  const setEng = (e: Partial<NonNullable<Setup["engagement"]>>) => up((s) => ({ ...s, engagement: { ...eng, ...e } }));
  const setItem = (id: string, patch: Partial<Item>) => setEng({ items: eng.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  async function asset(f: File, purpose: string): Promise<{ id: string; url: string } | null> {
    setBusy(purpose);
    const fd = new FormData();
    fd.append("file", await compress(f));
    fd.append("purpose", purpose);
    const j = await fetch(`/api/teamcards/${cardId}/asset`, { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ error: "upload failed" }));
    setBusy(null);
    if (j.error) { setMsg({ text: j.error, err: true }); return null; }
    return { id: j.id, url: j.url };
  }

  async function save(thenBuild = false) {
    setBusy("save");
    const j = await fetch(`/api/teamcards/${cardId}/setup`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setup, brief }) }).then((r) => r.json()).catch(() => ({ error: "save failed" }));
    setBusy(null);
    if (j.error) return setMsg({ text: j.error, err: true });
    setDirty(false);
    setMsg({ text: "Saved." });
    onSaved();
    if (thenBuild) onBuild();
  }

  const done = useMemo(() => [
    !!(brief.badgeType && (brief.race || brief.campaign) && imageUrl),
    eng.type === "page" || eng.items.length > 0,
    !!setup.module?.pageId,
    !!setup.reward?.type,
    true,
  ], [brief, imageUrl, eng, setup]);
  const S = (i: number) => ({ n: i + 1, done: done[i], open: only !== undefined ? true : open === i, onToggle: () => (only !== undefined ? undefined : setOpen(open === i ? -1 : i)) });
  // guided: the section the guide is on; a change is saved when the guide moves on
  const shown = (i: number) => only === undefined || only === i;
  const latest = useRef({ dirty, save });
  latest.current = { dirty, save };
  useEffect(() => () => {
    if (only !== undefined && latest.current.dirty) void latest.current.save(false);
  }, [only]);

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 900, paddingBottom: 90 }}>
      {shown(0) && (
      <Section {...S(0)} title="Card" lead={[brief.badgeType || "No type", brief.race || "No Grand Prix", brief.campaign || "No campaign"].join(" · ")}>
        <div style={{ display: "grid", gap: 6 }}>
          <span style={{ color: C.mute, fontSize: 12 }}>Card type</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(types.length ? types : ["Core", "Exclusive", "Limited", "Special"]).map((t) => (
              <button key={t} style={{ ...pill(brief.badgeType === t), padding: "6px 12px", borderRadius: 999 }} onClick={() => { setBrief({ ...brief, badgeType: t }); setDirty(true); }}>{t}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: C.mute, fontSize: 12 }}>Grand Prix</span>
            <input style={input} placeholder="e.g. São Paulo" value={brief.race ?? ""} onChange={(e) => { setBrief({ ...brief, race: e.target.value }); setDirty(true); }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: C.mute, fontSize: 12 }}>Campaign</span>
            <select style={input} value={brief.campaign ?? ""} onChange={(e) => { setBrief({ ...brief, campaign: e.target.value }); setDirty(true); }}>
              <option value="">No campaign</option>
              {campaigns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          <Upload label="Front" url={imageUrl} busy={busy === "front"} onFile={async (f) => { setBusy("front"); await onImage(f); setBusy(null); }} />
          <Upload label="Back (flipped card)" url={setup.backImageUrl} busy={busy === "back side"} onFile={async (f) => { const a = await asset(f, "back side"); if (a) up((s) => ({ ...s, backImageId: a.id, backImageUrl: a.url })); }} />
        </div>
      </Section>
      )}

      {shown(1) && (
      <Section {...S(1)} title="Engagement · how fans earn it" lead={ENG.find((x) => x.key === eng.type)?.title + (eng.items.length ? ` · ${eng.items.length} item${eng.items.length === 1 ? "" : "s"}` : "")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6 }}>
          {ENG.map((x) => (
            <button key={x.key} style={pill(eng.type === x.key)} onClick={() => setEng({ type: x.key, items: x.key === "q-and-a" ? eng.items.slice(0, 1) : eng.items })}>
              <b style={{ fontWeight: 600 }}>{x.title}</b>
              <span style={{ fontSize: 11.5, color: C.mute }}>{x.text}</span>
            </button>
          ))}
        </div>
        {eng.type !== "page" && (
          <div style={{ display: "grid", gap: 10 }}>
            <span style={{ color: C.mute, fontSize: 12 }}>{eng.type === "hot-or-not" ? "Pictures to rate" : eng.type === "q-and-a" ? "The question" : "Questions and answers"}</span>
            {eng.items.map((it, i) => (
              <div key={it.id} style={{ display: "grid", gridTemplateColumns: eng.type === "hot-or-not" ? "96px 1fr auto" : "1fr auto", gap: 12, alignItems: "start", border: `1px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
                {eng.type === "hot-or-not" && <Upload label={`Picture ${i + 1}`} url={it.imageUrl} busy={busy === `item ${it.id}`} onFile={async (f) => { const a = await asset(f, `item ${it.id}`); if (a) setItem(it.id, { mediaId: a.id, imageUrl: a.url }); }} />}
                <div style={{ display: "grid", gap: 6 }}>
                  <LocInputs value={it.text} onChange={(v) => setItem(it.id, { text: v })} ph={eng.type === "hot-or-not" ? "Label, e.g. Rate the jersey." : "Question"} />
                  {(eng.type === "survey" || eng.type === "quiz") && (
                    <div style={{ display: "grid", gap: 6, paddingLeft: 12, borderLeft: `2px solid ${C.line2}` }}>
                      {(it.options ?? []).map((o, k) => (
                        <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                          <LocInputs value={o} onChange={(v) => setItem(it.id, { options: (it.options ?? []).map((x, j) => (j === k ? v : x)) })} ph={`Answer ${k + 1}`} />
                          <button style={smallBtn} aria-label="Remove answer" onClick={() => setItem(it.id, { options: (it.options ?? []).filter((_, j) => j !== k) })}>✕</button>
                        </div>
                      ))}
                      <button style={{ ...smallBtn, justifySelf: "start" }} onClick={() => setItem(it.id, { options: [...(it.options ?? []), {}] })}>+ Answer</button>
                    </div>
                  )}
                </div>
                <button style={smallBtn} aria-label="Remove" onClick={() => setEng({ items: eng.items.filter((x) => x.id !== it.id) })}>✕</button>
              </div>
            ))}
            {!(eng.type === "q-and-a" && eng.items.length >= 1) && (
              <button style={{ ...smallBtn, justifySelf: "start" }} onClick={() => setEng({ items: [...eng.items, { id: uid(), text: {}, options: eng.type === "survey" || eng.type === "quiz" ? [{}, {}] : undefined }] })}>
                + {eng.type === "hot-or-not" ? "Picture" : "Question"}
              </button>
            )}
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ color: C.mute, fontSize: 12 }}>Background behind the task</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {BG.map((b) => (
                  <button key={b} title={b} aria-label={`Background ${b}`} onClick={() => setEng({ bg: { type: "color", color: b } })} style={{ width: 30, height: 30, borderRadius: 99, background: BG_HEX[b], border: `2px solid ${eng.bg?.type !== "image" && (eng.bg?.color ?? "grey-01") === b ? C.lava : C.line2}`, cursor: "pointer" }} />
                ))}
                <span style={{ color: C.mute, fontSize: 12 }}>or</span>
                <label style={{ ...smallBtn, display: "inline-flex", alignItems: "center", gap: 8, borderColor: eng.bg?.type === "image" ? C.lava : C.line2 }}>
                  {eng.bg?.type === "image" && eng.bg.imageUrl && <span style={{ width: 18, height: 18, borderRadius: 4, background: `center/cover url(${eng.bg.imageUrl})` }} />}
                  {busy === "background" ? "Uploading …" : eng.bg?.type === "image" ? "Change image" : "Image"}
                  <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const a = await asset(f, "background"); if (a) setEng({ bg: { type: "image", mediaId: a.id, imageUrl: a.url } }); }} />
                </label>
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.mute }}>The texts around the task (submit button, after the answer, login overlay) are edited on the screens in the steps Page, Logged out and Logged in.</div>
          </div>
        )}
      </Section>
      )}

      {shown(2) && (
      <Section {...S(2)} title="Module · the page it sits on" lead={setup.module?.pageUrl ? `/${setup.module.pageUrl}` : "No page yet"}>
        <div style={{ color: C.mute, fontSize: 12 }}>The page that shows the card&apos;s module with the task. It is added at the end of the page as a draft; move it in the CMS if needed.</div>
        <input style={input} placeholder={`Search pages${camp?.root ? ` (showing /${camp.root}…)` : ""}`} value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ display: "grid", gap: 4, maxHeight: 220, overflow: "auto" }}>
          {pages.length === 0 && !q && camp?.figmaFile && <BuildPages compact campaign={camp.key} campaignName={camp.name} figmaUrl={camp.figmaUrl} hasPages={false} />}
          {pages.length === 0 && (q || !camp?.figmaFile) && <div style={{ color: C.mute, fontSize: 12 }}>No pages found on staging{camp?.root ? ` under /${camp.root}` : ""}. Search for another one, or create the page in the CMS first.</div>}
          {pages.map((p) => {
            const on = setup.module?.pageId === p.id;
            return (
              <button key={p.id} style={{ ...pill(on), display: "flex", justifyContent: "space-between", gap: 10 }} onClick={() => up((s) => ({ ...s, module: { pageId: p.id, pageUrl: p.url, pageTitle: p.title } }))}>
                <span>{p.title || p.url}</span>
                <span style={{ color: C.mute, fontSize: 12 }}>/{p.url}</span>
              </button>
            );
          })}
        </div>
      </Section>
      )}

      {shown(3) && (
      <Section {...S(3)} title="Reward · what fans get" lead={REWARD.find((x) => x.key === setup.reward?.type)?.title ?? "Not set"}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6 }}>
          {REWARD.map((x) => (
            <button key={x.key} style={pill(setup.reward?.type === x.key)} onClick={() => up((s) => ({ ...s, reward: { type: x.key } }))}>
              <b style={{ fontWeight: 600 }}>{x.title}</b>
              <span style={{ fontSize: 11.5, color: C.mute }}>{x.text}</span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: C.mute }}>Reward texts (teaser, description) are on the screens in the steps Logged in and Collection.</div>
      </Section>
      )}

      {shown(4) && (
      <Section {...S(4)} title="Status · live or disabled" lead={disabled ? "Disabled" : "Active"}>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="checkbox" checked={!disabled} onChange={(e) => onToggleDisabled(!e.target.checked)} />
          Card is active
        </label>
        <div style={{ fontSize: 12, color: C.mute }}>A disabled card loses the link to its engagement and module. Cards built from Ktulu start disabled; switch them on once everything is checked. Goes to staging with Review.</div>
      </Section>
      )}

      <div style={{ position: "sticky", bottom: 0, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "12px 14px", borderRadius: 12, border: `1px solid ${C.line2}`, background: "rgba(20,20,23,.96)", boxShadow: "0 -12px 30px -18px rgba(0,0,0,.8)" }}>
        <button style={{ ...smallBtn, height: 36, background: dirty ? C.lava : "transparent", borderColor: dirty ? C.lava : C.line2, fontWeight: 600 }} disabled={!!busy} onClick={() => void save(false)}>
          {busy === "save" ? "Saving …" : dirty ? "Save setup" : "Saved"}
        </button>
        {canBuild && (
          <button style={{ ...smallBtn, height: 36 }} disabled={!!busy} onClick={() => void save(true)}>
            {onStaging ? "Save and update staging" : "Save and build on staging"}
          </button>
        )}
        {!canBuild && onStaging && <span style={{ fontSize: 12, color: C.mute }}>This card came from staging: engagement and module are changed in the CMS for now.</span>}
        {msg && <span style={{ fontSize: 12.5, color: msg.err ? "#e06c5b" : C.ok }}>{msg.text}</span>}
        <span style={{ marginLeft: "auto", fontSize: 12, color: C.mute }}>{cardName}</span>
      </div>
    </div>
  );
}
