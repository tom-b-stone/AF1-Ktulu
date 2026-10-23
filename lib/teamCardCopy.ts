// Server-only: copies one Team Card from production to staging.
//
// A Team Card is three CMS objects: the badge, its engagement (when the
// mechanic is an engagement) and the badge-engagement-teaser block on the
// page where fans meet it. Badge and engagement point at each other
// (mechanics[].targetOriginEngagement ↔ engagement.loggedOutBadge).
//
// Production is read through its public REST API (read only). Staging is
// written with the stored service login (lib/payloadClient). Order:
//   1. media (card image, backside, engagement images) re-uploaded
//   2. loyalty tags + badge type matched by title (created when missing)
//   3. engagement created (no back link yet)
//   4. badge created ACTIVE (isDraft = "Disable this badge" off): the CMS
//      only links badge, engagement and module while the card is active
//   5. engagement → loggedOutBadge = new badge
//   6. teaser block inserted into the staging page as a DRAFT version
// Every step is idempotent: running it again updates the same documents.
// Localised fields are written per locale (EN, then DE) with
// fallback-locale=none, so no EN text lands in DE fields.
import { listMediaFolders, createMediaFolder, stagingRequest } from "./payloadClient";

const PROD_API = (process.env.PRODUCTION_CMS_API_URL ?? "https://www.audif1.com/cms/api").replace(/\/$/, "");
const PROD_SITE = PROD_API.replace(/\/cms\/api$/, "");
const STAGING_ADMIN = "https://staging.audif1team.com/cms/admin/collections";
const LOCALES = ["en", "de"] as const;
type Loc = (typeof LOCALES)[number];
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type CopyStep = { step: string; ok: boolean; detail?: string; link?: string };
export type CopyResult = { ok: boolean; steps: CopyStep[]; badgeId?: string; engagementId?: string; prodEngagementId?: string; pageId?: string };

export async function prod(path: string): Promise<Json> {
  const res = await fetch(`${PROD_API}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`production ${path.split("?")[0]}: ${res.status}`);
  return res.json();
}

export async function stg(path: string, init: RequestInit = {}): Promise<Json> {
  const res = await stagingRequest(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`staging ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 900)}`);
  return text ? JSON.parse(text) : {};
}

// ---- locale helpers -------------------------------------------------------
export const isLoc = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => k === "en" || k === "de");

// internalId is the key the loyalty backend registers a document under; a
// copied production internalId is unknown there and makes every update fail
const DROP = new Set(["id", "createdAt", "updatedAt", "createdBy", "updatedBy", "internalId", "sortingTime", "_status", "slug", "generateSlug"]);

// One locale's view of a locale=all document: {en, de} leaves → the value
// for `loc` (undefined drops the key), ids and system fields removed.
export function project(v: Json, loc: Loc): Json {
  if (isLoc(v)) {
    const x = v[loc];
    return x === undefined || x === null || x === "" ? (loc === "en" ? x : undefined) : project(x, loc);
  }
  if (Array.isArray(v)) return v.map((x) => project(x, loc));
  if (v && typeof v === "object") {
    const out: Json = {};
    for (const [k, x] of Object.entries(v)) {
      if (DROP.has(k)) continue;
      const p = project(x, loc);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  return v;
}

// Array rows and blocks keep their ids between the EN write and the DE
// write, otherwise Payload treats DE rows as new ones.
export function withIds(target: Json, saved: Json): Json {
  if (Array.isArray(target) && Array.isArray(saved)) return target.map((t, i) => withIds(t, saved[i]));
  if (target && typeof target === "object" && saved && typeof saved === "object" && !Array.isArray(target)) {
    const out: Json = { ...target };
    if (saved.id && typeof saved.id === "string" && !("id" in out)) out.id = saved.id;
    for (const k of Object.keys(out)) if (k in saved) out[k] = withIds(out[k], saved[k]);
    return out;
  }
  return target;
}

export const hasDe = (v: Json): boolean => {
  if (isLoc(v)) return v.de !== undefined && v.de !== null && v.de !== "";
  if (Array.isArray(v)) return v.some(hasDe);
  if (v && typeof v === "object") return Object.values(v).some(hasDe);
  return false;
};

// Create or update a document in both locales. `find` = where query for
// an existing copy (idempotency).
export async function upsertLocalised(collection: string, all: Json, findWhere: string, steps: CopyStep[], label: string): Promise<string> {
  const found = await stg(`/${collection}?${findWhere}&limit=10&depth=0&sort=-createdAt`);
  const en = project(all, "en");
  // reuse an earlier copy when it can still be updated; a broken one (unknown
  // to the loyalty backend) is skipped and a fresh document created
  let existing: string | undefined;
  let saved: Json;
  for (const d of (found.docs ?? []) as Json[]) {
    try {
      saved = (await stg(`/${collection}/${d.id}?locale=en`, { method: "PATCH", body: JSON.stringify(en) })).doc;
      existing = d.id;
      break;
    } catch (e) {
      steps.push({ step: `${label}: earlier copy ${d.id} cannot be updated, skipped`, ok: true, detail: e instanceof Error ? e.message.slice(0, 120) : undefined });
    }
  }
  if (!existing) saved = (await stg(`/${collection}?locale=en`, { method: "POST", body: JSON.stringify(en) })).doc;
  if (hasDe(all)) {
    const de = withIds(project(all, "de"), saved);
    await stg(`/${collection}/${saved.id}?locale=de`, { method: "PATCH", body: JSON.stringify(de) });
  }
  steps.push({ step: `${label} ${existing ? "updated" : "created"}`, ok: true, link: `${STAGING_ADMIN}/${collection}/${saved.id}` });
  return saved.id;
}

// ---- media ---------------------------------------------------------------
const folderIds = new Map<string, string | null>();
let mediaFolderName = "Team Cards";
export function setMediaFolder(name: string) {
  mediaFolderName = name;
}
async function teamCardFolder(): Promise<string | null> {
  const name = mediaFolderName;
  if (folderIds.has(name)) return folderIds.get(name)!;
  let id: string | null = null;
  try {
    const all = await listMediaFolders();
    id = all.find((f) => f.name === name && !f.parent)?.id ?? (await createMediaFolder(name, null)).id;
  } catch {
    id = null;
  }
  folderIds.set(name, id);
  return id;
}

export const isId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{24}$/.test(v);

export async function copyMedia(prodId: string, cache: Map<string, string>, steps: CopyStep[]): Promise<string> {
  if (cache.has(prodId)) return cache.get(prodId)!;
  const m = await prod(`/media/${prodId}?depth=0&locale=en`);
  const there = await stg(`/media?where[filename][equals]=${encodeURIComponent(m.filename)}&limit=1&depth=0`);
  let id: string | undefined = there.docs?.[0]?.id;
  if (!id) {
    const file = await fetch(`${PROD_SITE}${m.url}`, { cache: "no-store" });
    if (!file.ok) throw new Error(`download ${m.filename}: ${file.status}`);
    const blob = await file.blob();
    const form = new FormData();
    form.append("file", blob, m.filename);
    const folder = await teamCardFolder();
    form.append("_payload", JSON.stringify({ alt: m.alt || m.filename, ...(folder ? { folder } : {}) }));
    id = (await stg(`/media`, { method: "POST", body: form })).doc.id as string;
    steps.push({ step: `image uploaded: ${m.filename}`, ok: true, link: `${STAGING_ADMIN}/media/${id}` });
  } else {
    steps.push({ step: `image already on staging: ${m.filename}`, ok: true, link: `${STAGING_ADMIN}/media/${id}` });
  }
  cache.set(prodId, id);
  return id;
}

export const MEDIA_KEYS = new Set(["media", "image", "assetId", "postSubmissionMedia", "asset", "mobileMedia", "badgeImage", "badgeBackImage", "imagePreview", "video", "poster", "thumbnail", "dialogImage", "mobileImage", "desktopImage", "backgroundImage", "logo", "icon"]);

// Walks a document and swaps every production media id for its staging copy.
export async function remapMedia(v: Json, cache: Map<string, string>, steps: CopyStep[]): Promise<Json> {
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) out.push(await remapMedia(x, cache, steps));
    return out;
  }
  if (v && typeof v === "object") {
    const out: Json = {};
    for (const [k, x] of Object.entries(v)) {
      if (MEDIA_KEYS.has(k) && isId(x)) out[k] = await copyMedia(x, cache, steps);
      else if (MEDIA_KEYS.has(k) && x && typeof x === "object" && isId((x as Json).id) && (x as Json).filename) out[k] = await copyMedia((x as Json).id, cache, steps);
      else out[k] = await remapMedia(x, cache, steps);
    }
    return out;
  }
  return v;
}

// ---- vocabulary ---------------------------------------------------------
export async function loyaltyTag(t: Json, steps: CopyStep[]): Promise<string | undefined> {
  if (!t) return undefined;
  const title = typeof t.title === "string" ? t.title : t.title?.en;
  if (!title) return undefined;
  // titles are unique on staging across all tag types: same title (any type, any case) = the same tag
  const lookup = async () => {
    const exact = await stg(`/loyalty-category-tags?where[title][equals]=${encodeURIComponent(title)}&limit=5&depth=0`).catch(() => ({ docs: [] }));
    const loose = exact.docs?.length ? exact : await stg(`/loyalty-category-tags?where[title][like]=${encodeURIComponent(title)}&limit=20&depth=0`).catch(() => ({ docs: [] }));
    const docs: Json[] = (loose.docs ?? []).filter((d: Json) => String(typeof d.title === "string" ? d.title : d.title?.en ?? "").trim().toLowerCase() === String(title).trim().toLowerCase());
    return docs.find((d) => d.type === t.type) ?? docs[0];
  };
  const hit = await lookup();
  if (hit) {
    if (hit.type !== t.type) steps.push({ step: `tag "${title}" exists on staging as ${hit.type} (production: ${t.type}), used as it is`, ok: true });
    return hit.id;
  }
  try {
    const doc = (await stg(`/loyalty-category-tags`, { method: "POST", body: JSON.stringify({ title, type: t.type }) })).doc;
    steps.push({ step: `tag created: ${t.type} "${title}"`, ok: true });
    return doc.id;
  } catch (e) {
    // made a moment ago by another step, or a title the lookup missed: use that one
    const again = /unique/i.test(e instanceof Error ? e.message : "") ? await lookup() : null;
    if (again) return again.id;
    throw e;
  }
}

export async function badgeType(t: Json, steps: CopyStep[]): Promise<string | undefined> {
  if (!t) return undefined;
  const title = typeof t.title === "string" ? t.title : t.title?.en;
  if (!title) return undefined;
  const found = await stg(`/badge-types?where[title][equals]=${encodeURIComponent(title)}&limit=1&depth=0&locale=en`);
  if (found.docs?.[0]) return found.docs[0].id;
  const doc = (await stg(`/badge-types?locale=en`, { method: "POST", body: JSON.stringify({ title }) })).doc;
  steps.push({ step: `badge type created: ${title}`, ok: true });
  return doc.id;
}

export async function stagingPageByUrl(url: string, slug: string): Promise<Json | null> {
  const byUrl = await stg(`/pages?where[url][equals]=${encodeURIComponent(url)}&limit=1&depth=0&draft=true`);
  if (byUrl.docs?.[0]) return byUrl.docs[0];
  const bySlug = await stg(`/pages?where[slug][equals]=${encodeURIComponent(slug)}&limit=5&depth=0&draft=true`);
  return bySlug.docs?.length === 1 ? bySlug.docs[0] : null;
}

// ---- main -----------------------------------------------------------------
export type CopyOptions = { badgeId: string; keepDraft?: boolean; withPageBlock?: boolean; targetPageId?: string; media?: Map<string, string> };

export async function copyTeamCard(opts: CopyOptions): Promise<CopyResult> {
  const steps: CopyStep[] = [];
  const media = opts.media ?? new Map<string, string>();
  const res: CopyResult = { ok: false, steps };
  try {
    const b = await prod(`/badges/${opts.badgeId}?depth=1&locale=all&fallback-locale=none`);
    const title: string = typeof b.title === "string" ? b.title : b.title?.en;
    steps.push({ step: `read from production: ${title}`, ok: true, link: `${PROD_SITE}/cms/admin/collections/badges/${b.id}` });

    // 1 engagement (when the mechanic is one)
    const mech = (b.mechanics ?? []) as Json[];
    const engIdx = mech.findIndex((m) => m.targetOriginType === "engagement" && m.targetOriginEngagement);
    let engagementId: string | undefined;
    let engagementAll: Json | null = null;
    if (engIdx >= 0) {
      const prodEngId = typeof mech[engIdx].targetOriginEngagement === "string" ? mech[engIdx].targetOriginEngagement : mech[engIdx].targetOriginEngagement.id;
      engagementAll = await prod(`/engagements/${prodEngId}?depth=0&locale=all&fallback-locale=none`);
      const { loggedOutBadge: _drop, ...rest } = engagementAll;
      const mapped = await remapMedia(rest, media, steps);
      const engTitle = typeof engagementAll.title === "string" ? engagementAll.title : engagementAll.title?.en;
      engagementId = await upsertLocalised("engagements", mapped, `where[title][equals]=${encodeURIComponent(engTitle)}&locale=en`, steps, `engagement "${engTitle}"`);
      res.engagementId = engagementId;
      res.prodEngagementId = prodEngId;
    }

    // 2 page targets of the CTAs (internal links) → staging page ids
    const pageMap = new Map<string, string>();
    for (const cta of [...(b.unearnedBadgeCTA ?? []), ...(b.rewardCTA ?? []), ...(b.raffleConfirmedCTA ?? [])] as Json[]) {
      const docs = isLoc(cta.doc) ? Object.values(cta.doc) : cta.doc ? [cta.doc] : [];
      for (const d of docs as Json[]) {
        const v = d?.value;
        if (v?.id && !pageMap.has(v.id)) {
          const sp = await stagingPageByUrl(v.url, v.slug);
          if (sp) pageMap.set(v.id, sp.id);
          else if (opts.targetPageId) {
            pageMap.set(v.id, opts.targetPageId);
            steps.push({ step: `${v.url} is not on staging: CTA and module go to the chosen staging page`, ok: true, link: `${STAGING_ADMIN}/pages/${opts.targetPageId}` });
          } else steps.push({ step: `CTA target not on staging: ${v.url}`, ok: false, detail: "Pass targetPageId (a staging page) to link and place it there." });
        }
      }
    }
    const remapDoc = (cta: Json) => {
      if (!cta.doc) return cta;
      const one = (d: Json) => (d?.value?.id && pageMap.has(d.value.id) ? { relationTo: d.relationTo, value: pageMap.get(d.value.id) } : undefined);
      const doc = isLoc(cta.doc) ? Object.fromEntries(Object.entries(cta.doc).map(([l, d]) => [l, one(d)])) : one(cta.doc);
      const missing = isLoc(doc) ? Object.values(doc).every((x) => !x) : !doc;
      if (missing) {
        // target not on staging: link to the production page instead
        const v = (isLoc(cta.doc) ? (cta.doc as Json).en : cta.doc)?.value;
        const { doc: _d, ...rest } = cta;
        return { ...rest, linkType: "external", url: `${PROD_SITE}/en/${v?.url ?? ""}` };
      }
      return { ...cta, doc };
    };

    // 3 badge
    const badge: Json = await remapMedia(
      {
        ...b,
        partnerTag: await loyaltyTag(b.partnerTag, steps),
        passionfieldTag: await loyaltyTag(b.passionfieldTag, steps),
        raceTag: await loyaltyTag(b.raceTag, steps),
        season: await loyaltyTag(b.season, steps),
        campaignTitle: await loyaltyTag(b.campaignTitle, steps),
        badgeType: await badgeType(b.badgeType, steps),
        mechanics: await Promise.all(
          mech.map(async (m, i) => {
            if (i === engIdx) return { ...m, targetOriginEngagement: engagementId };
            const pg = m.targetOriginPage;
            if (pg && typeof pg === "object" && pg.id) {
              const sp = pageMap.get(pg.id) ?? (await stagingPageByUrl(pg.url, pg.slug))?.id;
              if (!sp) steps.push({ step: `mechanic page not on staging: ${pg.url}`, ok: false, detail: "Set it in the CMS." });
              return { ...m, targetOriginPage: sp ?? null };
            }
            return m;
          })
        ),
        unearnedBadgeCTA: (b.unearnedBadgeCTA ?? []).map(remapDoc),
        rewardCTA: (b.rewardCTA ?? []).map(remapDoc),
        raffleConfirmedCTA: (b.raffleConfirmedCTA ?? []).map(remapDoc),
        clusters: [],
        isDraft: opts.keepDraft === true,
      },
      media,
      steps
    );
    const badgeId = await upsertLocalised("badges", badge, `where[title][equals]=${encodeURIComponent(title)}&locale=en`, steps, "badge");
    res.badgeId = badgeId;

    // 4 back link
    if (engagementId) {
      await stg(`/engagements/${engagementId}`, { method: "PATCH", body: JSON.stringify({ loggedOutBadge: badgeId }) });
      steps.push({ step: "engagement linked back to the badge", ok: true });
    }

    // 5 page block (badge-engagement-teaser) as a draft version of the page
    if (opts.withPageBlock !== false) {
      const target = [...(b.unearnedBadgeCTA ?? [])].map((c: Json) => (isLoc(c.doc) ? c.doc.en : c.doc)?.value).find((v: Json) => v?.id);
      if (!target) steps.push({ step: "page block skipped", ok: false, detail: "The card has no internal CTA page to look for its teaser." });
      else {
        const pp = await prod(`/pages/${target.id}?depth=0&locale=all&fallback-locale=none`);
        const idx = (pp.sections ?? []).findIndex((s: Json) => s.blockType === "badge-engagement-teaser" && s.badge === opts.badgeId);
        const sp = pageMap.get(target.id);
        if (idx < 0) steps.push({ step: "page block skipped", ok: false, detail: `No teaser for this card on ${target.url} in production.` });
        else if (!sp) steps.push({ step: "page block skipped", ok: false, detail: `${target.url} is not on staging.` });
        else {
          const block: Json = await remapMedia(pp.sections[idx], media, steps);
          block.badge = badgeId;
          block.children = (block.children ?? []).map((c: Json) => (c.blockType === "engagement" ? { ...c, engagement: engagementId } : c));
          const isOurs = (s: Json) => s.blockType === "badge-engagement-teaser" && (s.badge === badgeId || s.badge?.id === badgeId);
          for (const loc of LOCALES) {
            const cur = await stg(`/pages/${sp}?locale=${loc}&fallback-locale=none&depth=0&draft=true`);
            const sections: Json[] = cur.sections ?? [];
            const mine = project(block, loc);
            const at = sections.findIndex(isOurs);
            if (loc === "en") {
              if (at >= 0) sections[at] = { ...mine, id: sections[at].id };
              else sections.splice(sp === opts.targetPageId ? sections.length : Math.min(idx, sections.length), 0, mine);
            } else {
              if (at < 0) break;
              sections[at] = withIds(mine, sections[at]);
            }
            await stg(`/pages/${sp}?locale=${loc}&draft=true`, { method: "PATCH", body: JSON.stringify({ sections, _status: "draft" }) });
          }
          res.pageId = sp;
          steps.push({ step: `module placed${sp === opts.targetPageId ? " at the end of the chosen staging page" : ` on ${target.url} at position ${idx + 1}`} (draft version)`, ok: true, link: `${STAGING_ADMIN}/pages/${sp}` });
        }
      }
    }
    res.ok = steps.every((s) => s.ok || s.step.includes("skipped") || s.step.includes("not on staging"));
  } catch (e) {
    steps.push({ step: "stopped", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
  return res;
}

// Production cards for the picker.
export async function listProdCards(): Promise<{ id: string; title: string; type?: string; mechanic?: string; updatedAt: string }[]> {
  const j = await prod(`/badges?limit=200&depth=0&locale=en&sort=-updatedAt`);
  return (j.docs ?? []).map((d: Json) => ({
    id: d.id,
    title: d.title,
    mechanic: d.mechanics?.[0]?.targetOriginType,
    updatedAt: d.updatedAt,
  }));
}
