// Landing pages from the Figma design → draft pages on STAGING.
//
// The designer builds a campaign's landing pages in Figma from the same
// library modules the CMS has (Hero, Gallery Grid, Single Card Showcase,
// Badge Engagement Teaser, Carousel, Teaser Big, Hotspot, Team Cards Grid,
// Call to Action …). The AF1 Ktulu Sync plugin reads the newest version of
// every page on the board (the right-most section of that name) and sends:
//   page   → name, Figma node, modules top to bottom
//   module → block type, texts by layer, images (already uploaded, media ids)
// This module turns that into draft pages on staging:
//   - every block starts from a module of the same type on staging (the
//     Singapore pages first), so all required CMS settings are there
//   - every text of the template is cleared, then the Figma texts go in:
//     nothing from another campaign stays on the page
//   - links point inside the campaign (hub ↔ landing pages), hotspots are left
//     empty for the editor, the Team Card of the page sits in its modules
//   - pages stay drafts; a page Ktulu did not build is never touched
import { kvGet, kvSet } from "./kv";
import { listContentTags } from "./payloadClient";
import { blockFields, getCampaign, MODULES } from "./sitemapSync";
import { listCards, saveCardsPublic, type CardRecord } from "./teamCards";
import { campaignOfCard } from "./teamCardCreate";
import { loyaltyTag, stg, type CopyStep } from "./teamCardCopy";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ADMIN = "https://staging.audif1team.com/cms/admin/collections";

export type BlueprintField = { path: string; layer: string; kind: "text" | "image" };
export type Blueprints = Record<string, { name: string; fields: BlueprintField[] }>;
export type FigmaModule = { blockType: string; name: string; texts: Record<string, string>; images: Record<string, string> };
export type FigmaPage = { name: string; node: string; hub: boolean; modules: FigmaModule[] };
export type BuiltPage = { name: string; id: string; url: string; admin: string; created: boolean; card?: string };

const plain = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const kebab = (t: string) => plain(t).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const noIds = (v: Json): Json => (Array.isArray(v) ? v.map(noIds) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "id").map(([k, x]) => [k, noIds(x)])) : v);
function setPath(o: Json, path: string, v: unknown) {
  const p = path.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
  let cur = o;
  for (let i = 0; i < p.length - 1; i++) {
    if (cur[p[i]] == null) cur[p[i]] = typeof p[i + 1] === "number" ? [] : {};
    cur = cur[p[i]];
  }
  cur[p[p.length - 1]] = v;
}

// ---- templates: one staging module per block type ---------------------------
const BLOCK_TYPES = Object.keys(MODULES).filter((k) => !["logged-out-badge-reveal", "list-section", "iframe-embed"].includes(k));
async function templates(): Promise<Record<string, Json>> {
  const out: Record<string, Json> = {};
  const take = (docs: Json[]) => {
    for (const d of docs) for (const s of d.sections ?? []) if (BLOCK_TYPES.includes(s.blockType) && !out[s.blockType] && s.authRequirement !== "HIDDEN") out[s.blockType] = s;
  };
  const sg = await stg(`/pages?where[url][like]=unlock-singapore&limit=50&depth=0&draft=true&locale=en`).catch(() => ({ docs: [] }));
  take(sg.docs ?? []);
  if (BLOCK_TYPES.some((t) => !out[t])) {
    const more = await stg(`/pages?limit=60&depth=0&draft=true&locale=en&sort=-updatedAt`).catch(() => ({ docs: [] }));
    take(more.docs ?? []);
  }
  return out;
}

// What the plugin reads per block type: the layers the sync knows for it,
// plus the first two buttons.
export async function blueprints(tplIn?: Record<string, Json>): Promise<Blueprints> {
  const tpl = tplIn ?? (await templates());
  const out: Blueprints = {};
  for (const [type, s] of Object.entries(tpl)) {
    const fields: BlueprintField[] = [];
    const seen = new Set<string>();
    for (const f of blockFields("t", s)) {
      if (f.readonly && !/^_figma\.(category|headline|subline|copy)$/.test(f.path)) continue;
      const path = f.path.replace(/^_figma\./, "");
      if (seen.has(f.layer)) continue;
      seen.add(f.layer);
      fields.push({ path, layer: f.layer, kind: f.kind });
    }
    for (const i of [0, 1]) if (!seen.has(`@btn:${i}`) && Array.isArray(s.ctas)) fields.push({ path: `ctas.${i}.label`, layer: `@btn:${i}`, kind: "text" });
    // carousels: up to five tiles, even when the template has fewer
    if (type === "carousel")
      for (let i = 0; i < 5; i++)
        for (const [p, l] of [["headline", "Headline"], ["copy", "Copy"]] as const)
          if (!seen.has(`Tile ${i + 1} · ${l}`)) fields.push({ path: `carouselItems.${i}.carouselImage.${p}`, layer: `Tile ${i + 1} · ${l}`, kind: "text" });
    out[type] = { name: MODULES[type]?.name ?? type, fields };
  }
  return out;
}

// ---- build ----------------------------------------------------------------
const TEXT_KEYS = new Set(["category", "headline", "subline", "copy", "copy2", "caption", "label", "description", "disclaimer"]);
// every text of the template goes, so nothing of another campaign stays
function blank(v: Json): Json {
  if (Array.isArray(v)) return v.map(blank);
  if (!v || typeof v !== "object") return v;
  const o: Json = {};
  for (const [k, x] of Object.entries(v)) {
    if (TEXT_KEYS.has(k) && typeof x === "string") o[k] = "";
    else if (k === "content" && x && typeof x === "object" && (x as Json).root) o[k] = null;
    else if (k === "loyaltyId") continue;
    else o[k] = blank(x);
  }
  return o;
}
// every link button points inside the campaign
function relink(v: Json, to: (path: string) => string, path = ""): Json {
  if (Array.isArray(v)) return v.map((x, i) => relink(x, to, `${path}${i}.`));
  if (!v || typeof v !== "object") return v;
  if (v.blockType === "link-button") return { ...v, linkType: "internal", url: undefined, doc: { relationTo: "pages", value: to(path) } };
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, relink(x, to, `${path}${k}.`)]));
}
const linkButton = (label: string) => ({ blockType: "link-button", appearance: { variant: "primary", size: "sm", hug: true }, label, iconPlacement: "after", linkType: "internal", openNewTab: false });

type Ctx = { hubId: string; pageIds: string[]; card?: CardRecord; campaignTagId?: string; contentTagId?: string; isHub: boolean };
function buildBlock(tpl: Json, bp: Blueprints[string], m: FigmaModule, ctx: Ctx, notes: string[]): Json | null {
  const s: Json = blank(noIds(clone(tpl)));
  delete s.blockName;
  s.authRequirement = "PUBLIC";
  // carousels: as many tiles as the design shows
  if (m.blockType === "carousel" && Array.isArray(s.carouselItems) && s.carouselItems.length) {
    let n = 0;
    for (let i = 0; i < 5; i++) if (["Headline", "Copy"].some((l) => m.texts[`Tile ${i + 1} · ${l}`]) || Object.keys(m.images).some((k) => k.startsWith(`ImageItem${i + 1}>`))) n = i + 1;
    n = Math.max(1, n);
    const base = s.carouselItems[0];
    s.carouselItems = Array.from({ length: n }, (_, i) => clone(s.carouselItems[i] ?? base));
  }
  if (Array.isArray(s.ctas)) s.ctas = [];
  for (const f of bp.fields) {
    if (f.kind === "image") {
      const id = m.images[f.layer];
      if (id) setPath(s, f.path, id);
      continue;
    }
    const v = (m.texts[f.layer] ?? "").trim();
    const btn = /^@btn:(\d+)$/.exec(f.layer);
    if (btn) {
      if (!v) continue;
      const arr = f.path.split(".")[0];
      if (!Array.isArray(s[arr])) s[arr] = [];
      const src = tpl[arr]?.[Number(btn[1])] ?? tpl[arr]?.[0];
      s[arr][Number(btn[1])] = { ...(src ? blank(noIds(clone(src))) : linkButton(v)), label: v };
      continue;
    }
    const idx = /^carouselItems\.(\d+)\./.exec(f.path);
    if (idx && !(s.carouselItems?.[Number(idx[1])])) continue;
    setPath(s, f.path, v);
  }
  for (const k of ["ctas", "unearnedBadgeCTA", "earnedBadgeCTA"]) if (Array.isArray(s[k])) s[k] = s[k].filter((x: Json) => x && x.label);
  // per type
  const t = m.blockType;
  if (t === "hot-spot") {
    s.hotspots = [];
    notes.push("hotspots left empty: set them in the CMS");
  }
  if (t === "single-card-showcase" || t === "badge-engagement-teaser") {
    if (!ctx.card?.staging.badgeId) {
      notes.push(`${MODULES[t]?.name ?? t} skipped: no Team Card for this page yet`);
      return null;
    }
    s.badge = ctx.card.staging.badgeId;
  }
  if (t === "badge-engagement-teaser") {
    const kids: Json[] = (s.children ?? []).filter((c: Json) => c.blockType !== "engagement");
    if (ctx.card?.staging.engagementId) kids.push({ blockType: "engagement", engagement: ctx.card.staging.engagementId });
    s.children = kids;
  }
  if (t === "badges-grid") s.loyaltyCategoryTagsList = ctx.campaignTagId ? [{ loyaltyCategoryTags: [{ relationTo: "loyalty-category-tags", value: ctx.campaignTagId }] }] : [];
  if (t === "carousel-tags" && s.carouselItems) s.carouselItems.contentTagsList = ctx.contentTagId ? [{ contentTags: [ctx.contentTagId] }] : [];
  if (typeof s.backgroundColor === "string" && /singapore/i.test(s.backgroundColor)) s.backgroundColor = "graphite";
  // links: tiles on the hub lead to the landing pages in order, everything else to the hub
  return relink(s, (path) => {
    const tile = /^carouselItems\.(\d+)\./.exec(path);
    if (ctx.isHub && tile && ctx.pageIds[Number(tile[1])]) return ctx.pageIds[Number(tile[1])];
    return ctx.isHub && ctx.pageIds[0] && t === "single-card-showcase" ? ctx.pageIds[0] : ctx.hubId;
  });
}

// the campaign's Team Card for a page, by the words of its name
const STOP = new Set(["special", "sao", "paulo", "the", "s", "team", "card", "of", "and", "page", "landing", "collection", "design", "2026"]);
const words = (t: string) => new Set(plain(t).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
function matchCard(name: string, cards: CardRecord[]): CardRecord | undefined {
  const want = words(name);
  let best: { c: CardRecord; n: number } | undefined;
  for (const c of cards) {
    const n = [...words(c.name)].filter((w) => want.has(w)).length;
    if (n && (!best || n > best.n)) best = { c, n };
  }
  return best?.c;
}

const kBuilt = (c: string) => `figpages:${c}:v1`;
const kLast = (c: string) => `figpages:${c}:last`;
export type PagesBuild = { at: string; by: string; pages: BuiltPage[]; steps: CopyStep[] };
export async function lastPagesBuild(campaign: string): Promise<PagesBuild | null> {
  const raw = await kvGet(kLast(campaign)).catch(() => null);
  return raw ? (JSON.parse(raw) as PagesBuild) : null;
}
export async function buildPagesFromFigma(campaign: string, pages: FigmaPage[], by: string): Promise<{ steps: CopyStep[]; pages: BuiltPage[]; cards: string[] }> {
  const steps: CopyStep[] = [];
  const c = await getCampaign(campaign);
  if (!c) throw new Error("unknown campaign");
  if (!c.root) throw new Error("The campaign has no page URL on staging yet (Figma Sync → Setup, step 3).");
  if (!pages.length) throw new Error("No landing pages found on this Figma page.");
  const tpl = await templates();
  const bps = await blueprints(tpl);
  const built: Record<string, string> = JSON.parse((await kvGet(kBuilt(campaign)).catch(() => null)) || "{}");
  const prefix = plain(c.name).replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();

  // the campaign's cards
  const all = await listCards();
  const campCards: CardRecord[] = [];
  for (const card of all) {
    const camp = await campaignOfCard(card).catch(() => null);
    if (camp && plain(camp.name) === plain(c.name)) campCards.push(card);
  }
  // tags for the Team Cards grid and the tag carousel
  let campaignTagId: string | undefined;
  try {
    campaignTagId = await loyaltyTag({ title: `${c.name.toLowerCase()} ${c.season || "2026"}`, type: "campaign" }, steps);
  } catch {
    steps.push({ step: "campaign tag not found: the Team Cards grid shows no filter yet", ok: true });
  }
  const contentTagId = (await listContentTags().catch(() => [])).find((t) => c.contentTag.test(t.title))?.id;

  // 1 make sure every page exists (hub first), so links can point at them
  const hubPage = pages.find((p) => p.hub) ?? null;
  const order = [...(hubPage ? [hubPage] : []), ...pages.filter((p) => p !== hubPage)];
  const ids: Record<string, string> = {};
  const urls: Record<string, string> = {};
  const created: Record<string, boolean> = {};
  const skip = new Set<string>();
  const hubSlug = c.root.split("/").pop()!;
  const parentOfRoot = c.root.includes("/") ? c.root.split("/").slice(0, -1).join("/") : "";
  for (const p of order) {
    const slug = p === hubPage ? hubSlug : kebab(p.name);
    const url = p === hubPage ? c.root : `${c.root}/${slug}`;
    urls[p.name] = url;
    const found = (await stg(`/pages?where[url][equals]=${encodeURIComponent(url)}&limit=1&depth=0&draft=true`).catch(() => ({ docs: [] }))).docs?.[0];
    if (found) {
      if (built[url] !== found.id) {
        skip.add(p.name);
        steps.push({ step: `/${url} exists and was not built here: left alone`, ok: true, link: `${ADMIN}/pages/${found.id}` });
      }
      ids[p.name] = found.id;
      continue;
    }
    const parent = p === hubPage ? (parentOfRoot ? (await stg(`/pages?where[url][equals]=${encodeURIComponent(parentOfRoot)}&limit=1&depth=0&draft=true`)).docs?.[0]?.id : undefined) : ids[hubPage?.name ?? ""];
    if (p !== hubPage && !parent) {
      skip.add(p.name);
      steps.push({ step: `${p.name}: no hub page to sit under, skipped`, ok: false });
      continue;
    }
    const title = `${prefix} | ${p === hubPage ? "Campaign Hub" : p.name}`;
    const doc = (await stg(`/pages?draft=true&locale=en`, { method: "POST", body: JSON.stringify({ title, slug, ...(parent ? { parent } : {}), authRequirement: "PUBLIC", sections: [], _status: "draft" }) })).doc;
    ids[p.name] = doc.id;
    created[p.name] = true;
    built[doc.url ?? url] = doc.id;
    built[url] = doc.id;
  }
  await kvSet(kBuilt(campaign), JSON.stringify(built));

  // 2 the modules
  const hubId = hubPage ? ids[hubPage.name] : order.map((p) => ids[p.name]).find(Boolean)!;
  const landing = order.filter((p) => p !== hubPage).map((p) => ids[p.name]).filter(Boolean);
  const out: BuiltPage[] = [];
  const cardIds: string[] = [];
  for (const p of order) {
    const id = ids[p.name];
    if (!id || skip.has(p.name)) continue;
    const card = p === hubPage ? undefined : matchCard(p.name, campCards);
    const notes: string[] = [];
    const sections: Json[] = [];
    for (const m of p.modules) {
      const t = tpl[m.blockType];
      const bp = bps[m.blockType];
      if (!t || !bp) {
        notes.push(`${m.name}: no ${m.blockType} module on staging to start from, skipped`);
        continue;
      }
      const s = buildBlock(t, bp, m, { hubId, pageIds: landing, card, campaignTagId, contentTagId, isHub: p === hubPage }, notes);
      if (s) sections.push(s);
    }
    await stg(`/pages/${id}?draft=true&locale=en`, { method: "PATCH", body: JSON.stringify({ sections, _status: "draft" }) });
    out.push({ name: p.name, id, url: urls[p.name], admin: `${ADMIN}/pages/${id}`, created: !!created[p.name], card: card?.id });
    steps.push({ step: `/${urls[p.name]} ${created[p.name] ? "created" : "updated"}: ${sections.length} modules${card ? `, Team Card ${card.id}` : ""} (draft)`, ok: true, link: `${ADMIN}/pages/${id}` });
    for (const n of [...new Set(notes)]) steps.push({ step: `  ${n}`, ok: true });
    // the card now sits on this page: Setup → Where it sits, built from Figma
    if (card) {
      const again = await stg(`/pages/${id}?locale=en&depth=0&draft=true`);
      const block = (again.sections ?? []).find((x: Json) => x.blockType === "badge-engagement-teaser" && x.badge === card.staging.badgeId) ?? (again.sections ?? []).find((x: Json) => x.badge === card.staging.badgeId);
      card.setup = { ...(card.setup ?? {}), module: { pageId: id, pageUrl: urls[p.name], pageTitle: p.name, fromFigma: true, blockId: block?.id } };
      card.staging = { ...card.staging, pageId: id, ...(block?.id ? { blockId: block.id } : {}) };
      card.placement = `${c.name} · ${p.name} (/${urls[p.name]})`;
      card.log = [{ at: new Date().toISOString(), by, summary: `Placed on /${urls[p.name]} from the Figma design` }, ...card.log].slice(0, 50);
      cardIds.push(card.id);
    }
  }
  await saveCardsPublic(all);
  const missing = pages.filter((p) => !p.hub && !matchCard(p.name, campCards)).map((p) => p.name);
  if (missing.length) steps.push({ step: `no Team Card found for: ${missing.join(", ")}`, ok: true });
  steps.push({ step: "German texts still to add; pages stay drafts until someone publishes them", ok: true });
  await kvSet(kLast(campaign), JSON.stringify({ at: new Date().toISOString(), by, pages: out, steps }));
  return { steps, pages: out, cards: cardIds };
}
