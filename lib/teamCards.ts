// Server-only: Team Card records for the configurator.
//
// The tool record is the source of truth while the team edits. One record
// per card holds every editable text (EN + DE) and setting of the three CMS
// objects: badge, engagement, module (badge-engagement-teaser on a page).
// Changes are previewed first (before/after per card, field, language);
// nothing reaches staging until they are applied. Applying writes the
// record, pushes the changed fields to staging per locale and logs it.
import { kvGet, kvSet, kvSetEx } from "./kv";
import { stagingRequest } from "./payloadClient";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
import { FIELDS, fieldByKey, fieldIssues, type DocKind, type FieldDef, type Loc, type LocValue } from "./teamCardFields";
export { FIELDS, STEPS, fieldByKey, fieldIssues } from "./teamCardFields";
export type { DocKind, FieldDef, Loc, LocValue } from "./teamCardFields";

export type CardRecord = {
  id: string; // TC-037
  name: string;
  status: string; // tracker status: Briefed … Staging … Live
  staging: { badgeId: string; engagementId?: string; pageId?: string; blockId?: string };
  imageUrl?: string; // card artwork for the previews (public file)
  engagementImageUrl?: string; // engagement background, for the previews
  badgeTypeLabel?: string; // shown on the card's back ("Badge Details")
  raceLabel?: string;
  mechanic?: string; // q-and-a, survey, hot-or-not, page, link
  rewardType?: string; // noReward, raffleSignup, couponCode
  placement?: string; // where the module sits, in words
  values: Record<string, LocValue | string | boolean | undefined>;
  // briefing from the Team Cards Tracker (one-way import); trackerId links a card to its tracker row
  brief?: { source?: string; trackerId?: string } & Record<string, string | undefined>;
  updatedAt: string;
  log: { at: string; by: string; summary: string }[];
};

const KEY = "teamcards:v1";

// The Nuvolari card rebuilt on staging on 15 Oct 2026 (demo seed).
const SEED: Omit<CardRecord, "values" | "updatedAt" | "log">[] = [
  {
    id: "TC-037",
    name: "Nico's Nuvolari Helmet",
    status: "Staging",
    staging: { badgeId: "6ad0c51507a2e8280072e0e5", engagementId: "6ad0c38407a2e8280072df55", pageId: "6aa965d96840acd28673c7ff", blockId: "6ad0c5176f63cb0001129801" },
    imageUrl: "https://www.audif1.com/cms/api/media/file/AF1_Exclusive_Card_Monaco26_HUL_Nuvolari_Helmet-1400x1747.webp",
    engagementImageUrl: "https://www.audif1.com/cms/api/media/file/audif1_2026_MCO_qualifying_gallery_18-1441x2161.webp",
    mechanic: "q-and-a",
    badgeTypeLabel: "Exclusive",
    raceLabel: "Monaco",
    rewardType: "noReward",
    placement: "Production: Monaco race page, under the first widget set. Staging: end of the Badge Teaser Test Page.",
  },
];

async function stg(path: string, init: RequestInit = {}): Promise<Json> {
  const res = await stagingRequest(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`staging ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : {};
}

const getPath = (o: Json, p: (string | number)[]) => p.reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o: Json, p: (string | number)[], v: unknown) {
  let cur = o;
  for (let i = 0; i < p.length - 1; i++) {
    if (cur[p[i]] == null) cur[p[i]] = typeof p[i + 1] === "number" ? [] : {};
    cur = cur[p[i]];
  }
  cur[p[p.length - 1]] = v;
}

async function readDoc(rec: CardRecord, doc: DocKind, loc: Loc): Promise<Json> {
  if (!rec.staging.badgeId) return null;
  const q = `locale=${loc}&fallback-locale=none&depth=0`;
  if (doc === "badge") return stg(`/badges/${rec.staging.badgeId}?${q}`);
  if (doc === "engagement") return rec.staging.engagementId ? stg(`/engagements/${rec.staging.engagementId}?${q}`) : null;
  if (!rec.staging.pageId) return null;
  const page = await stg(`/pages/${rec.staging.pageId}?${q}&draft=true`);
  return (page.sections ?? []).find((s: Json) => s.id === rec.staging.blockId) ?? null;
}

// What the previews need beyond the editable texts: the question type and its
// answer options (EN/DE), read live from the staging engagement.
export type EngagementPreview = { type?: string; options: { en: string[]; de: string[] }; image?: string; postImage?: string; overlay?: boolean; category?: { en: string; de: string } };
export async function engagementPreview(rec: CardRecord): Promise<EngagementPreview | null> {
  if (!rec.staging.engagementId) return null;
  const label = (o: Json) => (typeof o === "string" ? o : String(o?.text ?? o?.label ?? o?.answer ?? o?.title ?? o?.value ?? ""));
  const opts = (d: Json): string[] => {
    const q = d?.questions?.[0];
    const list = q?.options ?? q?.answers ?? q?.choices ?? q?.answerOptions ?? [];
    return Array.isArray(list) ? list.map(label).filter(Boolean) : [];
  };
  const [en, de] = await Promise.all((["en", "de"] as Loc[]).map((l) => readDoc(rec, "engagement", l).catch(() => null)));
  const q = en?.questions?.[0];
  const mid = (m: Json) => (m && typeof m === "object" ? m.id : m) as string | undefined;
  const bg = en?.background?.imageSettings ?? {};
  const img = mid(bg.media ?? bg.mobileMedia ?? en?.assetId);
  const post = mid(en?.postSubmissionMedia);
  return {
    type: String(en?.engagementType ?? q?.type ?? ""),
    options: { en: opts(en), de: opts(de) },
    image: img ? `/api/sitemap/media/${img}` : undefined,
    postImage: post ? `/api/sitemap/media/${post}` : undefined,
    overlay: bg.shouldHaveOverlay !== false,
    category: { en: String(en?.category ?? ""), de: String(de?.category ?? en?.category ?? "") },
  };
}

// The card's documents as they are on staging (EN + DE): the editor fills the captured
// site templates from them, so every text on the screens shows the real content.
export type RawDocs = Record<Loc, { badge: Json; engagement: Json; module: Json }>;
export async function rawDocs(rec: CardRecord): Promise<RawDocs> {
  const out = {} as RawDocs;
  await Promise.all(
    (["en", "de"] as Loc[]).map(async (l) => {
      const [badge, engagement, module] = await Promise.all((["badge", "engagement", "module"] as DocKind[]).map((d) => readDoc(rec, d, l).catch(() => null)));
      out[l] = { badge, engagement, module };
    }),
  );
  return out;
}

// Reads every field of a card from staging (both locales).
export async function loadFromStaging(rec: CardRecord): Promise<CardRecord> {
  if (!rec.staging.badgeId) return rec;
  const docs: Record<string, Json> = {};
  for (const d of ["badge", "engagement", "module"] as DocKind[]) for (const l of ["en", "de"] as Loc[]) docs[`${d}:${l}`] = await readDoc(rec, d, l);
  const values: CardRecord["values"] = {};
  for (const f of FIELDS) {
    if (f.localized) values[f.key] = { en: getPath(docs[`${f.doc}:en`], f.path) ?? "", de: getPath(docs[`${f.doc}:de`], f.path) ?? "" };
    else values[f.key] = getPath(docs[`${f.doc}:en`], f.path);
  }
  return { ...rec, values, updatedAt: new Date().toISOString() };
}

export async function listCards(): Promise<CardRecord[]> {
  const raw = await kvGet(KEY).catch(() => null);
  // static facts from the seed (images, mechanic) win over stored ones
  if (raw) return (JSON.parse(raw) as CardRecord[]).map((c) => ({ ...c, ...(SEED.find((s) => s.id === c.id) ?? {}), values: c.values, log: c.log, status: c.status }));
  const seeded: CardRecord[] = [];
  for (const s of SEED) {
    const base: CardRecord = { ...s, values: {}, updatedAt: new Date().toISOString(), log: [{ at: new Date().toISOString(), by: "setup", summary: "Imported from staging (rebuilt from production)" }] };
    seeded.push(await loadFromStaging(base).catch(() => base));
  }
  await kvSet(KEY, JSON.stringify(seeded));
  return seeded;
}

async function saveCards(cards: CardRecord[]) {
  await kvSet(KEY, JSON.stringify(cards));
}
export const saveCardsPublic = saveCards;

// A card imported from the tracker that has no badge on staging yet.
export const onStaging = (c: CardRecord) => !!c.staging.badgeId;

export async function getCard(id: string): Promise<CardRecord | undefined> {
  return (await listCards()).find((c) => c.id.toLowerCase() === id.toLowerCase());
}

// ---- changes -------------------------------------------------------------
export type Change = { card: string; key: string; locale?: Loc | null; value: string | boolean };
export type DiffRow = { card: string; key: string; label: string; locale: Loc | null; before: unknown; after: unknown; issues: string[] };

export function diff(cards: CardRecord[], changes: Change[]): { rows: DiffRow[]; errors: string[] } {
  const rows: DiffRow[] = [];
  const errors: string[] = [];
  for (const c of changes) {
    const card = cards.find((x) => x.id.toLowerCase() === c.card.toLowerCase());
    const f = fieldByKey(c.key);
    if (!card) { errors.push(`Unknown card ${c.card}`); continue; }
    if (!f) { errors.push(`Unknown field ${c.key}`); continue; }
    if (card.staging.badgeId && f.doc === "engagement" && !card.staging.engagementId) { errors.push(`${card.id} has no engagement`); continue; }
    if (card.staging.badgeId && f.doc === "module" && !card.staging.blockId) { errors.push(`${card.id} has no module`); continue; }
    if (f.localized && c.locale !== "en" && c.locale !== "de") { errors.push(`${card.id} ${f.label}: say which language (en or de)`); continue; }
    if (f.options && !f.options.includes(String(c.value))) { errors.push(`${card.id} ${f.label}: one of ${f.options.join(", ")}`); continue; }
    const cur = card.values[f.key];
    const before = f.localized ? (cur as LocValue | undefined)?.[c.locale as Loc] ?? "" : cur;
    if (before === c.value) continue;
    const otherLoc = c.locale === "en" ? "de" : "en";
    const pendingOther = changes.find((x) => x.card === c.card && x.key === c.key && x.locale === otherLoc)?.value;
    const otherNow = f.localized ? String(pendingOther ?? (cur as LocValue | undefined)?.[otherLoc] ?? "") : undefined;
    rows.push({ card: card.id, key: f.key, label: f.label, locale: f.localized ? (c.locale as Loc) : null, before, after: c.value, issues: fieldIssues(f, f.localized ? (c.locale as Loc) : null, c.value, c.locale === "en" ? otherNow : undefined) });
  }
  return { rows, errors };
}

// Pending change sets (for the connector: propose → user confirms → apply).
export async function saveChangeset(changes: Change[]): Promise<string> {
  const id = `cs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await kvSetEx(`teamcards:cs:${id}`, JSON.stringify(changes), 60 * 60 * 24);
  return id;
}
export async function readChangeset(id: string): Promise<Change[] | null> {
  const raw = await kvGet(`teamcards:cs:${id}`).catch(() => null);
  return raw ? (JSON.parse(raw) as Change[]) : null;
}

// Writes the changes into the records and pushes them to staging, one
// PATCH per document and locale. Staging is the test system, so the page
// with the module is published there after the update.
export async function applyChanges(changes: Change[], by: string): Promise<{ applied: DiffRow[]; pushed: string[]; errors: string[] }> {
  const cards = await listCards();
  const { rows, errors } = diff(cards, changes);
  const pushed: string[] = [];
  const byCard = new Map<string, DiffRow[]>();
  for (const r of rows) byCard.set(r.card, [...(byCard.get(r.card) ?? []), r]);
  for (const [cardId, list] of byCard) {
    const card = cards.find((c) => c.id === cardId)!;
    try {
      for (const doc of card.staging.badgeId ? (["badge", "engagement", "module"] as DocKind[]) : []) {
        const mine = list.filter((r) => fieldByKey(r.key)!.doc === doc);
        if (!mine.length) continue;
        const locs = [...new Set(mine.map((r) => r.locale ?? "en"))] as Loc[];
        for (const loc of locs) {
          const forLoc = mine.filter((r) => (r.locale ?? "en") === loc);
          if (doc === "module") {
            const page = await stg(`/pages/${card.staging.pageId}?locale=${loc}&fallback-locale=none&depth=0&draft=true`);
            const block = (page.sections ?? []).find((s: Json) => s.id === card.staging.blockId);
            if (!block) throw new Error("module not found on the page");
            for (const r of forLoc) setPath(block, fieldByKey(r.key)!.path, r.after);
            await stg(`/pages/${card.staging.pageId}?locale=${loc}&draft=true`, { method: "PATCH", body: JSON.stringify({ sections: page.sections, _status: "draft" }) });
          } else {
            const coll = doc === "badge" ? "badges" : "engagements";
            const id = doc === "badge" ? card.staging.badgeId : card.staging.engagementId!;
            const cur = await stg(`/${coll}/${id}?locale=${loc}&fallback-locale=none&depth=0`);
            const body: Json = {};
            for (const r of forLoc) {
              const f = fieldByKey(r.key)!;
              const top = f.path[0] as string;
              if (!(top in body)) body[top] = JSON.parse(JSON.stringify(cur[top] ?? (typeof f.path[1] === "number" ? [] : null)));
              if (f.path.length === 1) body[top] = r.after;
              else setPath(body, f.path, r.after);
            }
            await stg(`/${coll}/${id}?locale=${loc}`, { method: "PATCH", body: JSON.stringify(body) });
          }
          pushed.push(`${card.id} ${doc} ${loc.toUpperCase()}: ${forLoc.map((r) => r.label).join(", ")}`);
        }
        if (doc === "module") await stg(`/pages/${card.staging.pageId}?locale=en`, { method: "PATCH", body: JSON.stringify({ _status: "published" }) });
      }
      for (const r of list) {
        const f = fieldByKey(r.key)!;
        if (f.localized) card.values[f.key] = { ...((card.values[f.key] as LocValue) ?? {}), [r.locale as Loc]: String(r.after) };
        else card.values[f.key] = r.after as string | boolean;
      }
      card.updatedAt = new Date().toISOString();
      card.log = [{ at: card.updatedAt, by, summary: `${list.length} change${list.length === 1 ? "" : "s"}: ${[...new Set(list.map((r) => r.label + (r.locale ? ` ${r.locale.toUpperCase()}` : "")))].join(", ")}` }, ...card.log].slice(0, 50);
    } catch (e) {
      errors.push(`${card.id}: ${e instanceof Error ? e.message : "push failed"} (record not changed)`);
      byCard.set(cardId, []);
    }
  }
  await saveCards(cards);
  return { applied: [...byCard.values()].flat(), pushed, errors };
}

export async function reloadCard(id: string): Promise<CardRecord | undefined> {
  const cards = await listCards();
  const i = cards.findIndex((c) => c.id === id);
  if (i < 0) return undefined;
  cards[i] = await loadFromStaging(cards[i]);
  cards[i].log = [{ at: new Date().toISOString(), by: "reload", summary: "Reloaded from staging" }, ...cards[i].log].slice(0, 50);
  await saveCards(cards);
  return cards[i];
}

export function stagingLinks(c: CardRecord) {
  const base = "https://staging.audif1team.com/cms/admin/collections";
  return {
    badge: c.staging.badgeId ? `${base}/badges/${c.staging.badgeId}` : undefined,
    engagement: c.staging.engagementId ? `${base}/engagements/${c.staging.engagementId}` : undefined,
    page: c.staging.pageId ? `${base}/pages/${c.staging.pageId}` : undefined,
  };
}

// After Figma (or anything else) wrote to a card's badge on staging.
export async function reloadCardsByBadge(badgeIds: string[]) {
  const cards = await listCards();
  let n = 0;
  for (let i = 0; i < cards.length; i++) {
    if (!badgeIds.includes(cards[i].staging.badgeId)) continue;
    cards[i] = await loadFromStaging(cards[i]);
    cards[i].log = [{ at: new Date().toISOString(), by: "figma sync", summary: "Updated from Figma via staging" }, ...cards[i].log].slice(0, 50);
    n++;
  }
  if (n) await saveCards(cards);
  return n;
}

// Adds (or refreshes) a campaign's Team Cards in the configurator list.
export async function importCampaignCards(
  prefix: string,
  list: { badgeId: string; title: string; rewardType: string; pageId?: string; blockId?: string; engagementId?: string; mechanic?: string; imageId?: string; placement: string }[],
  raceLabel: string,
) {
  const cards = await listCards();
  const added: string[] = [];
  let n = cards.filter((c) => c.id.startsWith(prefix + "-")).length;
  for (const it of list) {
    let rec = cards.find((c) => c.staging.badgeId === it.badgeId);
    if (!rec) {
      n++;
      rec = { id: `${prefix}-${String(n).padStart(2, "0")}`, name: it.title, status: "Staging", staging: { badgeId: it.badgeId }, values: {}, updatedAt: new Date().toISOString(), log: [{ at: new Date().toISOString(), by: "setup", summary: "Imported from the Singapore campaign on staging" }] };
      cards.push(rec);
      added.push(rec.id);
    }
    rec.name = it.title;
    rec.staging = { badgeId: it.badgeId, engagementId: it.engagementId, pageId: it.pageId, blockId: it.blockId };
    rec.rewardType = it.rewardType;
    rec.mechanic = it.mechanic ?? rec.mechanic;
    rec.raceLabel = raceLabel;
    rec.placement = it.placement;
    if (it.imageId) rec.imageUrl = `/api/sitemap/media/${it.imageId}`;
    const fresh = await loadFromStaging(rec).catch(() => rec!);
    Object.assign(rec, fresh);
  }
  await saveCards(cards);
  return { added, total: cards.length };
}

// ---- overview: what a card is and what it still needs ---------------------
export type CardMeta = { type?: string; core: boolean; campaign?: string; race?: string; partner?: string; season?: string };
export type CardCheck = { missing: string[]; quick: "Ready" | "Missing" | "Disabled" };

const tagTitle = (t: Json): string | undefined => (t && typeof t === "object" ? String(t.title ?? t.name ?? t.label ?? "") || undefined : undefined);

// One staging read for all cards: badge type and loyalty tags (campaign, race, partner, season).
export async function cardMeta(cards: CardRecord[]): Promise<Record<string, CardMeta>> {
  const ids = [...new Set(cards.map((c) => c.staging.badgeId).filter(Boolean))];
  if (!ids.length) return {};
  const w = encodeURIComponent(JSON.stringify({ id: { in: ids } }));
  const r = await stg(`/badges?where=${w}&limit=200&depth=1&locale=en&draft=true`).catch(() => ({ docs: [] }));
  const out: Record<string, CardMeta> = {};
  for (const b of (r.docs ?? []) as Json[]) {
    const type = tagTitle(b.badgeType);
    out[b.id] = { type, core: /core/i.test(type ?? ""), campaign: tagTitle(b.campaignTitle), race: tagTitle(b.raceTag), partner: tagTitle(b.partnerTag), season: tagTitle(b.season) };
  }
  return out;
}

const ENGAGED = new Set(["q-and-a", "survey", "hot-or-not"]);
// Texts every card needs; engagement and reward texts only where the card has them.
export function cardCheck(c: CardRecord, meta?: CardMeta): CardCheck {
  if (c.values.disabled === true) return { missing: [], quick: "Disabled" };
  const missing: string[] = [];
  const need = (key: string) => {
    const f = fieldByKey(key);
    if (!f) return;
    const v = c.values[key];
    if (!f.localized) {
      if (v === undefined || v === "") missing.push(f.label);
      return;
    }
    const lv = (v ?? {}) as LocValue;
    const en = String(lv.en ?? "").trim(), de = String(lv.de ?? "").trim();
    if (!en && !de) missing.push(f.label);
    else if (!en) missing.push(`EN ${f.label}`);
    else if (!de) missing.push(`DE ${f.label}`);
  };
  if (!c.imageUrl) missing.push("Card image");
  if (!c.mechanic) missing.push("Unlock mechanic");
  if (!c.rewardType) missing.push("Reward type");
  ["publicTitle", "description", "badgePopupTitle", "revealTitle", "revealDescription", "revealButton", "ctaLabel"].forEach(need);
  if (c.rewardType && c.rewardType !== "noReward") ["rewardDescription", "rewardTeaser"].forEach(need);
  if (ENGAGED.has(c.mechanic ?? "")) {
    if (c.staging.badgeId && !c.staging.engagementId) missing.push("Engagement");
    else ["question", "submitLabel", "postTitle", "postMessage"].forEach(need);
  }
  if (!c.staging.badgeId) missing.push("Not built on staging yet");
  if (meta && c.staging.badgeId && !meta.campaign) missing.push("Campaign tag");
  if (meta && c.staging.badgeId && !meta.type) missing.push("Card type");
  if (c.staging.badgeId) {
    if (!c.staging.pageId || !c.staging.blockId) missing.push("Placement on a page");
    else need("modHeadline");
  }
  return { missing, quick: missing.length ? "Missing" : "Ready" };
}

// ---- bulk: card type ----------------------------------------------------------
// The card types in use on staging (badgeType relation), so the overview can
// offer them without knowing the tag collection.
export async function badgeTypes(): Promise<{ id: string; title: string }[]> {
  const r = await stg(`/badges?limit=300&depth=1&locale=en&draft=true`).catch(() => ({ docs: [] }));
  const out = new Map<string, string>();
  for (const b of (r.docs ?? []) as Json[]) {
    const t = b.badgeType;
    if (t && typeof t === "object" && t.id) out.set(String(t.id), tagTitle(t) ?? String(t.id));
  }
  return [...out].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title));
}

// Sets the card type on several cards: the badge on staging, and the tracker
// briefing for cards that are not on staging yet.
export async function setCardType(ids: string[], type: { id: string; title: string }, by: string) {
  const cards = await listCards();
  const done: string[] = [];
  const errors: string[] = [];
  for (const id of ids) {
    const card = cards.find((c) => c.id === id);
    if (!card) { errors.push(`Unknown card ${id}`); continue; }
    try {
      if (card.staging.badgeId) await stg(`/badges/${card.staging.badgeId}`, { method: "PATCH", body: JSON.stringify({ badgeType: type.id }) });
      card.brief = { ...(card.brief ?? {}), badgeType: type.title };
      card.updatedAt = new Date().toISOString();
      card.log = [{ at: card.updatedAt, by, summary: `Card type: ${type.title}${card.staging.badgeId ? "" : " (not on staging yet)"}` }, ...card.log].slice(0, 50);
      done.push(id);
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  await saveCards(cards);
  return { done, errors };
}

// ---- card image ------------------------------------------------------------------
// A card artwork (exported from Figma or uploaded) goes through the Asset
// Uploader rules: WebP, file name like the production card files
// (AF1_Exclusive_Card_Monaco26_HUL_Nuvolari_Helmet.webp, the Figma layer name
// when it follows that pattern), an alt text checked against the brand rules,
// the year and Grand Prix content tags, folder "Team Cards". A card that is on
// staging gets it as its badge image too.
const pascal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join("");
const under = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function cardImageName(card: CardRecord, artName?: string, ext = "webp"): string {
  if (artName && /^AF1_[A-Za-z]+_Card_/.test(artName)) return `${under(artName)}.${ext}`;
  const type = pascal(String(card.brief?.badgeType ?? card.badgeTypeLabel ?? "Team")) || "Team";
  const race = pascal(String(card.brief?.race ?? card.raceLabel ?? "Season"));
  const yy = String(card.brief?.season ?? "2026").slice(-2);
  const name = under(card.name.replace(new RegExp(String(card.brief?.race ?? "~~"), "i"), ""));
  return `AF1_${type}_Card_${race}${yy}_${name}.${ext}`;
}

export function cardImageAlt(card: CardRecord): string {
  const type = String(card.brief?.badgeType ?? card.badgeTypeLabel ?? "").trim();
  const race = String(card.brief?.race ?? card.raceLabel ?? "").trim();
  const long = `Team Card "${card.name}"${type ? `, ${type} card` : ""}${race ? `, ${race} Grand Prix 2026` : ""}, Audi Revolut F1® Team`;
  return long.length <= 125 ? long : `Team Card "${card.name}"${type ? `, ${type} card` : ""}`.slice(0, 125);
}

export async function setCardImage(id: string, file: Blob, _filename: string, by: string, source = "upload", artName?: string) {
  const { listMediaFolders, uploadMedia, listContentTags } = await import("./payloadClient");
  const { gpTagFor } = await import("./contentTags");
  const cards = await listCards();
  const card = cards.find((c) => c.id.toLowerCase() === id.toLowerCase());
  if (!card) throw new Error("card not found");
  const ext = /webp/.test(file.type) ? "webp" : /png/.test(file.type) ? "png" : "jpg";
  const name = cardImageName(card, artName, ext);
  const alt = cardImageAlt(card);
  const folders = await listMediaFolders().catch(() => []);
  const folder = folders.find((f) => f.name === "Team Cards") || folders.find((f) => /team ?card|badge/i.test(f.name)) || null;
  const tags = await listContentTags().catch(() => []);
  const titles = tags.map((t) => t.title);
  const want = [titles.includes("2026") ? "2026" : undefined, gpTagFor({ race: String(card.brief?.race ?? card.raceLabel ?? "") }, titles)].filter(Boolean) as string[];
  const tagIds = tags.filter((t) => want.includes(t.title)).map((t) => t.id);
  const media = await uploadMedia(file, name, alt, folder?.id ?? null, tagIds);
  if (card.staging.badgeId) await stg(`/badges/${card.staging.badgeId}`, { method: "PATCH", body: JSON.stringify({ badgeImage: media.id }) });
  card.imageUrl = `/api/sitemap/media/${media.id}`;
  card.brief = { ...(card.brief ?? {}), imageId: media.id };
  card.updatedAt = new Date().toISOString();
  card.log = [{ at: card.updatedAt, by, summary: `Card image ${name} from ${source}${card.staging.badgeId ? " (also on the staging card)" : ""}` }, ...card.log].slice(0, 50);
  await saveCards(cards);
  return { imageUrl: card.imageUrl, mediaId: media.id, folder: folder?.name ?? null, fileName: name, alt, tags: want };
}

// ---- card artwork in Figma -------------------------------------------------------
// A card can be linked to its artwork on the Figma Team Cards board. The Figma
// plugin then exports the artwork and keeps the card image current by itself
// (it uploads again when the design changes; figmaArtHash is what it last sent).
export async function linkCardArt(id: string, art: { file: string; node: string } | null, by: string) {
  const cards = await listCards();
  const card = cards.find((c) => c.id.toLowerCase() === id.toLowerCase());
  if (!card) throw new Error("card not found");
  const brief = { ...(card.brief ?? {}) };
  if (art) {
    brief.figmaFile = art.file;
    brief.figmaNode = art.node;
  } else {
    delete brief.figmaFile;
    delete brief.figmaNode;
    delete brief.figmaArtHash;
  }
  card.brief = brief;
  card.updatedAt = new Date().toISOString();
  card.log = [{ at: card.updatedAt, by, summary: art ? `Linked to its Figma artwork (${art.node})` : "Figma artwork link removed" }, ...card.log].slice(0, 50);
  await saveCards(cards);
  return { id: card.id, figmaFile: brief.figmaFile, figmaNode: brief.figmaNode };
}

export async function setCardArtHash(id: string, hash: string) {
  const cards = await listCards();
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  card.brief = { ...(card.brief ?? {}), figmaArtHash: hash };
  await saveCards(cards);
}

// what the plugin needs to link and refresh artworks
export async function cardsForArt() {
  return (await listCards()).map((c) => ({
    id: c.id,
    name: c.name,
    race: String(c.brief?.race ?? c.raceLabel ?? ""),
    hasImage: !!c.imageUrl,
    figmaFile: c.brief?.figmaFile ?? null,
    figmaNode: c.brief?.figmaNode ?? null,
    hash: c.brief?.figmaArtHash ?? null,
  }));
}
