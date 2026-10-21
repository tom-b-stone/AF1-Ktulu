// Server-only: copies a set of production pages (a campaign) to staging,
// with everything they reference: images, Team Cards (badge + engagement),
// standalone engagements, content tags and links between the pages.
//
// Runs as a resumable job in steps of ~40 s (Vercel time limit): state and
// id maps live in KV, every step continues where the last one stopped.
//   1. shells: every page created (or found by URL) on staging, parents first
//   2. per page: referenced media, Team Cards, engagements, tags copied;
//      sections remapped to staging ids; EN + DE written; page published
// Links to pages outside the copied set: resolved on staging by URL, else
// turned into an external link to the production page. loyaltyId fields
// (private collection on production) get new loyalty IDs on staging.
import { kvGet, kvSet } from "./kv";
import { createContentTag, listContentTags } from "./payloadClient";
import { copyMedia, copyTeamCard, hasDe, isId, isLoc, MEDIA_KEYS, project, prod, setMediaFolder, stagingPageByUrl, stg, upsertLocalised, withIds, type CopyStep } from "./teamCardCopy";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PROD_SITE = (process.env.PRODUCTION_CMS_API_URL ?? "https://www.audif1.com/cms/api").replace(/\/cms\/api\/?$/, "");
const ADMIN = "https://staging.audif1team.com/cms/admin/collections";

export type JobPage = { prodId: string; url: string; title: string; slug?: string; parentProd?: string | null; stg?: string; live?: boolean; done?: boolean; note?: string };
export type Job = {
  id: string;
  name: string;
  folder: string; // staging media folder
  pages: JobPage[];
  media: Record<string, string>;
  badges: Record<string, string>;
  engagements: Record<string, string>;
  tags: Record<string, string>;
  loyalty?: Record<string, string>;
  keyword?: string; // for content tag fallback
  relinked?: string[]; // badges copied again after all pages were live // production loyaltyId → new staging loyalty-id
  log: string[];
  finished: boolean;
  updatedAt: string;
};

const key = (id: string) => `sitecopy:${id}`;
export async function readJob(id: string): Promise<Job | null> {
  const raw = await kvGet(key(id)).catch(() => null);
  return raw ? (JSON.parse(raw) as Job) : null;
}
async function saveJob(j: Job) {
  j.updatedAt = new Date().toISOString();
  j.log = j.log.slice(-400);
  await kvSet(key(j.id), JSON.stringify(j));
}

export async function startJob(name: string, prodIds: string[], folder: string, seed: { badges?: Record<string, string>; engagements?: Record<string, string>; keyword?: string } = {}): Promise<Job> {
  const pages: JobPage[] = [];
  for (const id of prodIds) {
    const p = await prod(`/pages/${id}?depth=0&locale=en&draft=false`);
    if (p._status && p._status !== "published") continue;
    pages.push({ prodId: p.id, url: p.url ?? "", title: p.title, slug: p.slug, parentProd: typeof p.parent === "object" ? p.parent?.id : p.parent ?? null });
  }
  // parents before children
  pages.sort((a, b) => a.url.split("/").length - b.url.split("/").length);
  const job: Job = { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`, name, folder, pages, media: {}, badges: { ...(seed.badges ?? {}) }, engagements: { ...(seed.engagements ?? {}) }, tags: {}, log: [], finished: false, updatedAt: "", ...(seed.keyword ? { keyword: seed.keyword } : {}) };
  await saveJob(job);
  return job;
}

// ---- remapping -----------------------------------------------------------
type Ctx = { job: Job; steps: CopyStep[]; media: Map<string, string>; deadline: number; pageUrl?: string };

async function mapDoc(ctx: Ctx, d: Json): Promise<Json | { external: string }> {
  if (!d || typeof d !== "object" || !isId(d.value)) return d;
  const { job } = ctx;
  if (d.relationTo === "pages") {
    const inJob = job.pages.find((p) => p.prodId === d.value);
    if (inJob?.stg) return { relationTo: "pages", value: inJob.stg };
    const pp = await prod(`/pages/${d.value}?depth=0&locale=en`).catch(() => null);
    if (pp) {
      const sp = await stagingPageByUrl(pp.url ?? "", pp.slug ?? "").catch(() => null);
      if (sp) return { relationTo: "pages", value: sp.id };
      return { external: `${PROD_SITE}/en/${pp.url ?? ""}` };
    }
  }
  if (d.relationTo === "news") {
    const pn = await prod(`/news/${d.value}?depth=0&locale=en`).catch(() => null);
    if (pn?.slug) {
      const sn = await stg(`/news?where[slug][equals]=${encodeURIComponent(pn.slug)}&limit=1&depth=0`).catch(() => null);
      if (sn?.docs?.[0]) return { relationTo: "news", value: sn.docs[0].id };
      return { external: `${PROD_SITE}/en/news/${pn.slug}` };
    }
  }
  return { external: PROD_SITE };
}

// Content tags are private on production (403), so their titles can't be
// read. Fallback: the staging tags whose title contains the campaign
// keyword (e.g. "singapore"), so tag-driven carousels still fill on staging.
async function tagId(ctx: Ctx, prodId: string): Promise<string | null> {
  if (ctx.job.tags[prodId]) return ctx.job.tags[prodId];
  const t = await prod(`/content-tags/${prodId}?depth=0`).catch(() => null);
  if (t?.title) {
    const s = await createContentTag(t.title);
    ctx.job.tags[prodId] = s.id;
    return s.id;
  }
  const kw = (ctx.job.keyword ?? "singapore").toLowerCase();
  const tags = await listContentTags().catch(() => []);
  const hit = tags.find((x) => x.title.toLowerCase().startsWith("gp |") && x.title.toLowerCase().includes(kw)) ?? tags.find((x) => x.title.toLowerCase().includes(kw));
  if (!hit) return null;
  ctx.job.tags[prodId] = hit.id;
  ctx.job.log.push(`content tag ${prodId} is private on production: used staging tag "${hit.title}"`);
  return hit.id;
}

async function badgeId(ctx: Ctx, prodId: string): Promise<string | null> {
  if (ctx.job.badges[prodId]) return ctx.job.badges[prodId];
  const r = await copyTeamCard({ badgeId: prodId, withPageBlock: false, media: ctx.media });
  for (const s of r.steps) if (!s.ok) ctx.job.log.push(`card ${prodId}: ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  if (!r.badgeId) return null;
  ctx.job.badges[prodId] = r.badgeId;
  ctx.job.log.push(`Team Card copied: ${r.steps[0]?.step.replace("read from production: ", "") ?? prodId} → ${r.badgeId}`);
  return r.badgeId;
}

async function engagementId(ctx: Ctx, prodId: string): Promise<string | null> {
  if (ctx.job.engagements[prodId]) return ctx.job.engagements[prodId];
  const e = await prod(`/engagements/${prodId}?depth=0&locale=all&fallback-locale=none`).catch(() => null);
  if (!e) return null;
  const { loggedOutBadge, ...rest } = e;
  const mapped = await remap(ctx, rest);
  const t = typeof e.title === "string" ? e.title : e.title?.en;
  const id = await upsertLocalised("engagements", mapped, `where[title][equals]=${encodeURIComponent(t)}&locale=en`, ctx.steps, `engagement "${t}"`);
  if (loggedOutBadge) {
    const b = await badgeId(ctx, typeof loggedOutBadge === "string" ? loggedOutBadge : loggedOutBadge.id);
    if (b) await stg(`/engagements/${id}`, { method: "PATCH", body: JSON.stringify({ loggedOutBadge: b }) }).catch(() => null);
  }
  ctx.job.engagements[prodId] = id;
  return id;
}

// walks a production structure and swaps every reference for staging's
async function remap(ctx: Ctx, v: Json, k = ""): Promise<Json> {
  if (Array.isArray(v)) {
    if (k === "contentTags" && v.every(isId)) return [...new Set((await Promise.all(v.map((x) => tagId(ctx, x)))).filter(Boolean))];
    if ((k === "badges" || k === "badgeList") && v.every(isId)) return (await Promise.all(v.map((x) => badgeId(ctx, x)))).filter(Boolean);
    const out = [];
    for (const x of v) out.push(await remap(ctx, x));
    return out;
  }
  if (!v || typeof v !== "object") {
    if (isId(v)) {
      if (MEDIA_KEYS.has(k)) {
        const id = await copyMedia(v, ctx.media, ctx.steps);
        ctx.job.media[v] = id;
        return id;
      }
      if (k === "badge" || k === "loggedOutBadge") return badgeId(ctx, v);
      if (k === "engagement") return engagementId(ctx, v);
    }
    return v;
  }
  const out: Json = {};
  let forced: string | null = null; // linkType decided by an unresolved doc
  for (const [kk, x] of Object.entries(v)) {
    if (kk === "linkType" && forced) continue;
    if (kk === "loyaltyId") {
      // production loyalty IDs are private: create a new one on staging,
      // named after the page and the button, so tracking works there
      if (isId(x)) {
        ctx.job.loyalty ??= {};
        if (!ctx.job.loyalty[x]) {
          const slug = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const label = typeof v.label === "string" ? v.label : v.label?.en ?? "";
          const value = `stg-${slug((ctx.pageUrl ?? "page").split("/").pop() ?? "page")}-${slug(label) || "cta"}`.slice(0, 80);
          const found = await stg(`/loyalty-ids?where[value][equals]=${encodeURIComponent(value)}&limit=1&depth=0`).catch(() => null);
          ctx.job.loyalty[x] = found?.docs?.[0]?.id ?? (await stg(`/loyalty-ids`, { method: "POST", body: JSON.stringify({ value }) })).doc.id;
          ctx.job.log.push(`new staging loyalty ID "${value}"`);
        }
        out[kk] = ctx.job.loyalty[x];
      }
      continue;
    }
    if (kk === "doc" && x && typeof x === "object") {
      if (isLoc(x)) {
        const per: Json = {};
        let ext: string | null = null;
        for (const [l, d] of Object.entries(x)) {
          const m = await mapDoc(ctx, d);
          if (m && "external" in m) ext = m.external as string;
          else per[l] = m;
        }
        if (ext && !Object.keys(per).length) {
          out.linkType = forced = k === "fields" ? "custom" : "external";
          out.url = ext;
        } else out.doc = per;
      } else {
        const m = await mapDoc(ctx, x);
        if (m && "external" in m) {
          // rich-text links call it "custom", link buttons "external"
          out.linkType = forced = k === "fields" ? "custom" : "external";
          out.url = m.external;
        } else out.doc = m;
      }
      continue;
    }
    // populated media objects (depth > 0)
    if (MEDIA_KEYS.has(kk) && x && typeof x === "object" && isId((x as Json).id) && (x as Json).filename) {
      out[kk] = await copyMedia((x as Json).id, ctx.media, ctx.steps);
      continue;
    }
    out[kk] = await remap(ctx, x, kk);
  }
  // a link whose doc became external
  if ((out.linkType === "external" || out.linkType === "custom") && out.doc !== undefined) delete out.doc;
  return out;
}

// ---- step -----------------------------------------------------------------
export async function stepJob(id: string, budgetMs = 40_000): Promise<Job> {
  const job = await readJob(id);
  if (!job) throw new Error("job not found");
  setMediaFolder(job.folder);
  const ctx: Ctx = { job, steps: [], media: new Map(Object.entries(job.media)), deadline: Date.now() + budgetMs };
  const left = () => ctx.deadline - Date.now();
  try {
    // 1 shells
    for (const p of job.pages) {
      if (p.stg) continue;
      if (left() < 5000) return job;
      const found = await stg(`/pages?where[url][equals]=${encodeURIComponent(p.url)}&limit=1&depth=0&draft=true`);
      if (found.docs?.[0]) {
        p.stg = found.docs[0].id;
        job.log.push(`page exists on staging, will be updated: /${p.url}`);
        continue;
      }
      // staging strips "/" from slugs: "paulaner-pro/brewery" becomes slug
      // "brewery" under the page at the parent URL, so the URL stays the same
      const parentUrl = p.url.split("/").slice(0, -1).join("/");
      const byUrl = parentUrl ? job.pages.find((x) => x.url === parentUrl)?.stg : undefined;
      const parent = byUrl ?? (p.parentProd ? job.pages.find((x) => x.prodId === p.parentProd)?.stg : undefined);
      if (p.slug?.includes("/")) p.slug = p.slug.split("/").pop();
      const make = (slug?: string) => stg(`/pages?locale=en&draft=true`, { method: "POST", body: JSON.stringify({ title: p.title, slug, ...(parent ? { parent } : {}), sections: [], _status: "draft" }) });
      let created: Json;
      try {
        created = await make(p.slug);
        job.log.push(`page created: /${p.url}`);
      } catch (e) {
        // slugs are unique across staging; an older test page may hold it
        if (!/unique/i.test(e instanceof Error ? e.message : "")) throw e;
        created = await make(`${p.slug}-2026`);
        p.note = `slug taken on staging, created as ${p.slug}-2026`;
        job.log.push(`page created with slug ${p.slug}-2026 (slug taken on staging by an older page): /${p.url}`);
      }
      p.stg = created.doc.id;
    }
    // 1b shells published, so rich-text links between the pages validate
    //    (Payload refuses links to documents that exist only as drafts)
    for (const p of job.pages) {
      if (p.live || !p.stg) continue;
      if (left() < 5000) return job;
      await stg(`/pages/${p.stg}?locale=en`, { method: "PATCH", body: JSON.stringify({ _status: "published" }) }).catch(() => null); // empty pages may not validate; fine
      p.live = true;
    }
    // 2 contents
    for (const p of job.pages) {
      if (p.done) continue;
      if (left() < 15000) return job;
      const all = await prod(`/pages/${p.prodId}?depth=0&locale=all&fallback-locale=none&draft=false`);
      ctx.pageUrl = p.url;
      const { sections, meta, title, authRequirement, logoStyle, shouldDefaultToTransparent, iconColorInTransparentHeader } = all;
      const mapped = await remap(ctx, { sections, meta, title, authRequirement, logoStyle, shouldDefaultToTransparent, iconColorInTransparentHeader });
      for (const [k, v] of ctx.media) job.media[k] = v;
      if (left() < 6000) {
        // references are copied; write the page in the next step
        await saveJob(job);
        return job;
      }
      const en = project(mapped, "en");
      const saved = (await stg(`/pages/${p.stg}?locale=en&draft=true`, { method: "PATCH", body: JSON.stringify({ ...en, _status: "draft" }) })).doc;
      if (hasDe(mapped)) {
        const de = withIds(project(mapped, "de"), saved);
        await stg(`/pages/${p.stg}?locale=de&draft=true`, { method: "PATCH", body: JSON.stringify({ ...de, _status: "draft" }) });
      }
      await stg(`/pages/${p.stg}?locale=en`, { method: "PATCH", body: JSON.stringify({ _status: "published" }) });
      p.done = true;
      job.log.push(`published on staging: /${p.url} (${(sections ?? []).length} sections) ${ADMIN}/pages/${p.stg}`);
      await saveJob(job);
    }
    // 3 Team Cards again, now that every page is live: page mechanics and
    //   CTA targets that pointed at not-yet-published pages resolve now
    if (job.pages.every((p) => p.done)) {
      job.relinked ??= [];
      for (const prodBadge of Object.keys(job.badges)) {
        if (job.relinked.includes(prodBadge)) continue;
        if (left() < 12000) return job;
        const r = await copyTeamCard({ badgeId: prodBadge, withPageBlock: false, media: ctx.media });
        const bad = r.steps.filter((x) => !x.ok);
        job.log.push(`Team Card relinked: ${r.steps[0]?.step.replace("read from production: ", "") ?? prodBadge}${bad.length ? ` (${bad.map((b) => b.step).join("; ")})` : ""}`);
        job.relinked.push(prodBadge);
      }
    }
    job.finished = job.pages.every((p) => p.done) && Object.keys(job.badges).every((b) => job.relinked?.includes(b));
  } catch (e) {
    job.log.push(`error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    for (const s of ctx.steps) if (!s.ok) job.log.push(`${s.step}${s.detail ? ` (${s.detail})` : ""}`);
    for (const [k, v] of ctx.media) job.media[k] = v;
    await saveJob(job);
  }
  return job;
}

export function jobSummary(j: Job): string {
  const done = j.pages.filter((p) => p.done).length;
  return `${j.name} (${j.id}): ${done}/${j.pages.length} pages published on staging · ${Object.keys(j.media).length} images · ${Object.keys(j.badges).length} Team Cards · ${Object.keys(j.engagements).length} engagements${j.finished ? " · finished" : " · not finished, run again"}`;
}
