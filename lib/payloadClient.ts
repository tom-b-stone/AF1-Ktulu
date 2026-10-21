// Server-only client for the audif1.com Payload CMS REST API.
//
// Auth: logs in as a dedicated service-account user (the staging login saved
// via /admin/credentials, see lib/settings.ts — Tom already created this user
// in the staging CMS; we never create one ourselves) using Payload's
// local-jwt strategy (`POST /users/login`), then sends the returned JWT as
// `Authorization: JWT <token>` on every request. The token is cached
// in-memory per serverless instance and refreshed on expiry or a 401.
//
// API shape (locales, draft mode, lock override, the two-step publish trick)
// follows the audif1-seo-sync skill's reference notes — same CMS, same rules.
import { getStagingCredentials } from "./settings";

const DEFAULT_BASE_URL = "https://staging.audif1team.com/cms/api";

function baseUrl(): string {
  return (process.env.PAYLOAD_API_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

type TokenCache = { token: string; exp: number } | null;
let tokenCache: TokenCache = null;

async function login(): Promise<string> {
  const creds = await getStagingCredentials();
  if (!creds) {
    throw new Error("No staging CMS login saved yet — set one at /admin/credentials first.");
  }
  const res = await fetch(`${baseUrl()}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Payload login failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { token: string; exp: number };
  tokenCache = { token: json.token, exp: json.exp };
  return json.token;
}

async function getToken(forceRefresh = false): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (!forceRefresh && tokenCache && tokenCache.exp - 60 > now) {
    return tokenCache.token;
  }
  return login();
}

async function payloadFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getToken();
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `JWT ${token}`,
      ...(init.body && !isForm ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (res.status === 401 && retry) {
    await getToken(true);
    return payloadFetch(path, init, false);
  }
  return res;
}

// Exposed for modules that only need to read (races calendar).
export const payloadFetchPublic = (path: string) => payloadFetch(path);

export type Collection = "news" | "pages";

export type SeoLocaleMeta = { title: string; description: string };

export type SeoListItem = {
  id: string;
  collection: Collection;
  internalTitle: string;
  slug: string;
  status: "published" | "draft";
  publishedDate: string | null;
  // Per-locale links straight into the Payload CMS admin edit page for this
  // doc (not the public site) — same link shape the AF1-SEO Google Sheet's
  // own HYPERLINK formulas use, so clicking takes Tom straight to where he
  // can see and edit the meta title/description, not the live page.
  urls: { en: string; de: string };
  en: SeoLocaleMeta;
  de: SeoLocaleMeta;
};

// The CMS admin root always matches whichever Payload instance this
// deployment's PAYLOAD_API_URL points at (derived, not hardcoded) — staging
// while this tool is being tried out, production later for the same reason
// PAYLOAD_API_URL itself switches per the README. Never hardcode a domain
// here: a hardcoded prod link is exactly the bug that was caught testing
// this against staging.
function cmsAdminBaseUrl(): string {
  return `${baseUrl().replace(/\/cms\/api$/, "")}/cms/admin`;
}

// https://.../cms/admin/collections/{collection}/{id}?locale={loc} — opens
// that document's edit page in the CMS admin, already on the right locale.
export function cmsAdminUrlFor(collection: Collection, id: string, locale: "en" | "de"): string {
  return `${cmsAdminBaseUrl()}/collections/${collection}/${id}?locale=${locale}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllDocs(collection: Collection, locale: "en" | "de"): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  const sort = collection === "news" ? "-publishedAt" : "slug";
  // Hard cap so a misbehaving collection can't hang the request forever.
  while (page <= 20) {
    const res = await payloadFetch(
      `/${collection}?limit=200&depth=0&draft=true&locale=${locale}&page=${page}&sort=${sort}`
    );
    if (!res.ok) {
      throw new Error(`Payload list fetch failed for ${collection}/${locale} (${res.status})`);
    }
    const json = await res.json();
    out.push(...(json.docs ?? []));
    if (!json.totalPages || json.totalPages <= page) break;
    page++;
  }
  return out;
}

export async function listSeoItems(): Promise<SeoListItem[]> {
  const [newsEn, newsDe, pagesEn, pagesDe] = await Promise.all([
    fetchAllDocs("news", "en"),
    fetchAllDocs("news", "de"),
    fetchAllDocs("pages", "en"),
    fetchAllDocs("pages", "de"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function zip(collection: Collection, en: any[], de: any[]): SeoListItem[] {
    const deById = new Map(de.map((d) => [d.id, d]));
    return en.map((doc) => {
      const deDoc = deById.get(doc.id);
      const status: "published" | "draft" = doc._status === "published" ? "published" : "draft";
      return {
        id: doc.id,
        collection,
        internalTitle: doc.title ?? "(untitled)",
        slug: doc.slug ?? "",
        status,
        publishedDate: (status === "published" ? doc.publishedAt : doc.createdAt) ?? null,
        urls: {
          en: cmsAdminUrlFor(collection, doc.id, "en"),
          de: cmsAdminUrlFor(collection, doc.id, "de"),
        },
        en: { title: doc.meta?.title ?? "", description: doc.meta?.description ?? "" },
        de: { title: deDoc?.meta?.title ?? "", description: deDoc?.meta?.description ?? "" },
      };
    });
  }

  return [...zip("news", newsEn, newsDe), ...zip("pages", pagesEn, pagesDe)];
}

export async function getSeoDoc(collection: Collection, id: string) {
  const [en, de] = await Promise.all([
    payloadFetch(`/${collection}/${id}?locale=en&depth=0&draft=true`).then((r) => r.json()),
    payloadFetch(`/${collection}/${id}?locale=de&depth=0&draft=true`).then((r) => r.json()),
  ]);
  return { en, de };
}

// Text fields worth pulling out of a doc/section when building generation
// source content — keys that reliably hold human-written copy rather than
// ids, urls, dates, or media technical metadata. Deliberately generic since
// `sections` is a blocks array whose shape varies per blockType and there's
// no single shared schema to rely on.
const CONTENT_TEXT_KEYS = new Set([
  "title",
  "teaserTitle",
  "shortSummary",
  "longSummary",
  "heading",
  "subheading",
  "headline",
  "text",
  "body",
  "description",
  "caption",
  "label",
  "quote",
  "name",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectContentText(value: any, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 60) return; // cheap guards against pathological docs
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectContentText(item, out, depth + 1);
    return;
  }
  for (const [key, val] of Object.entries(value)) {
    // Never pull from the existing meta block itself — regenerating from
    // the current SEO title/description would just echo it back instead of
    // drafting fresh copy from the article's real content.
    if (key === "meta") continue;
    if (typeof val === "string") {
      const trimmed = val.trim();
      // Keep alt text (hero/media captions) even though "alt" isn't in the
      // generic key list, since Tom specifically wants the hero image's
      // description considered as context.
      if ((CONTENT_TEXT_KEYS.has(key) || key === "alt") && trimmed && trimmed.length < 2000) {
        out.push(trimmed);
      }
    } else if (typeof val === "object") {
      collectContentText(val, out, depth + 1);
    }
  }
}

export type SeoGenerationSource = {
  internalTitle: string;
  slug: string;
  contentText: { en: string; de: string };
};

// Fetches the doc's real content (depth=1 so cover/media resolve) in both
// locales and extracts whatever human-written copy it holds — never invent
// facts the generator doesn't have, same rule the audif1-seo-sync skill
// follows when drafting SEO by hand.
export async function getSeoGenerationSource(
  collection: Collection,
  id: string
): Promise<SeoGenerationSource> {
  const [en, de] = await Promise.all([
    payloadFetch(`/${collection}/${id}?locale=en&depth=1&draft=true`).then((r) => r.json()),
    payloadFetch(`/${collection}/${id}?locale=de&depth=1&draft=true`).then((r) => r.json()),
  ]);
  const enText: string[] = [];
  const deText: string[] = [];
  collectContentText(en, enText);
  collectContentText(de, deText);
  return {
    internalTitle: en.title ?? "(untitled)",
    slug: en.slug ?? "",
    contentText: {
      en: Array.from(new Set(enText)).join("\n").slice(0, 6000),
      de: Array.from(new Set(deText)).join("\n").slice(0, 6000),
    },
  };
}

const LOCALE_WRITE_GAP_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- meta image rule -------------------------------------------------------
// Tom's rule: a page or article with no meta image of its own gets the
// home page's meta image. Applied on every save/publish, per locale. The
// home page is the `pages` doc with slug HOME_PAGE_SLUG (default "home").
const HOME_PAGE_SLUG = process.env.HOME_PAGE_SLUG || "home";
const homeImageCache: Record<string, { id: string | null; at: number }> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function imageIdOf(meta: any): string | null {
  const img = meta?.image;
  if (!img) return null;
  if (typeof img === "string") return img;
  if (typeof img === "object" && typeof img.id === "string") return img.id;
  return null;
}

export async function getHomeMetaImageId(locale: "en" | "de"): Promise<string | null> {
  const cached = homeImageCache[locale];
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.id;
  const res = await payloadFetch(
    `/pages?where[slug][equals]=${encodeURIComponent(HOME_PAGE_SLUG)}&depth=0&draft=true&locale=${locale}&limit=1`
  );
  let id: string | null = null;
  if (res.ok) {
    const json = await res.json();
    id = imageIdOf(json.docs?.[0]?.meta);
  }
  // DE without an image of its own falls back to the EN home image.
  if (!id && locale === "de") id = await getHomeMetaImageId("en");
  homeImageCache[locale] = { id, at: Date.now() };
  return id;
}

// Builds the `meta` body for one locale: the new title/description plus
// the image — the doc's own if it has one, otherwise the home page's.
// Always sending `image` also stops a partial meta PATCH from nulling it.
async function metaBodyFor(
  collection: Collection,
  id: string,
  locale: "en" | "de",
  meta: SeoLocaleMeta
): Promise<{ title: string; description: string; image?: string }> {
  const current = await payloadFetch(`/${collection}/${id}?locale=${locale}&depth=0&draft=true`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const own = imageIdOf(current?.meta);
  const image = own ?? (await getHomeMetaImageId(locale));
  return { title: meta.title, description: meta.description, ...(image ? { image } : {}) };
}

export async function saveSeoDraft(
  collection: Collection,
  id: string,
  locales: { en?: SeoLocaleMeta; de?: SeoLocaleMeta }
): Promise<void> {
  if (locales.de) {
    const res = await payloadFetch(`/${collection}/${id}?locale=de&draft=true&overrideLock=true`, {
      method: "PATCH",
      body: JSON.stringify({ meta: await metaBodyFor(collection, id, "de", locales.de) }),
    });
    if (!res.ok) throw new Error(`DE draft save failed (${res.status}): ${await res.text()}`);
    if (locales.en) await sleep(LOCALE_WRITE_GAP_MS);
  }
  if (locales.en) {
    const res = await payloadFetch(`/${collection}/${id}?locale=en&draft=true&overrideLock=true`, {
      method: "PATCH",
      body: JSON.stringify({ meta: await metaBodyFor(collection, id, "en", locales.en) }),
    });
    if (!res.ok) throw new Error(`EN draft save failed (${res.status}): ${await res.text()}`);
  }
}

// The two-step publish trick: PATCH DE as a draft first (so unrelated DE
// validation errors never block publishing), wait for Payload's versions
// collection to settle, then PATCH EN with _status: 'published'. publishedAt
// is read back and re-sent so promoting the draft doesn't reset it to "now"
// (which would reorder the news feed).
export type PublishResult = {
  internalTitle: string;
  cmsUrl: string;
  // publishedAt before and after, so the UI / connector can show that the
  // date really is untouched (and shout if it isn't).
  publishedAtBefore: string | null;
  publishedAtAfter: string | null;
  status: "published" | "draft";
};

export async function publishSeo(
  collection: Collection,
  id: string,
  locales: { en: SeoLocaleMeta; de?: SeoLocaleMeta }
): Promise<PublishResult> {
  const current = await payloadFetch(`/${collection}/${id}?locale=en&depth=0&draft=true`).then((r) => r.json());
  const publishedAt = current?.publishedAt;

  if (locales.de) {
    const res = await payloadFetch(`/${collection}/${id}?locale=de&draft=true&overrideLock=true`, {
      method: "PATCH",
      body: JSON.stringify({ meta: await metaBodyFor(collection, id, "de", locales.de) }),
    });
    if (!res.ok) throw new Error(`DE draft save failed (${res.status}): ${await res.text()}`);
    await sleep(LOCALE_WRITE_GAP_MS);
  }

  const res = await payloadFetch(`/${collection}/${id}?locale=en&overrideLock=true`, {
    method: "PATCH",
    body: JSON.stringify({
      _status: "published",
      meta: await metaBodyFor(collection, id, "en", locales.en),
      ...(publishedAt ? { publishedAt } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Publish failed (${res.status}): ${await res.text()}`);

  const after = await payloadFetch(`/${collection}/${id}?locale=en&depth=0`).then((r) => r.json());
  return {
    internalTitle: after?.title ?? current?.title ?? "(untitled)",
    cmsUrl: cmsAdminUrlFor(collection, id, "en"),
    publishedAtBefore: publishedAt ?? null,
    publishedAtAfter: after?.publishedAt ?? null,
    status: after?._status === "published" ? "published" : "draft",
  };
}


// ---------------------------------------------------------------------
// Media folders + uploads (Asset Uploader). Payload's folders feature:
// collection `payload-folders` (name, folder = parent id, folderType), and
// `media` docs carry `folder` (id). Upload = multipart POST /media with
// `file` + `_payload` (JSON of the other fields).

export type MediaFolder = { id: string; name: string; parent: string | null; path: string };

export async function listMediaFolders(): Promise<MediaFolder[]> {
  const out: { id: string; name: string; folder: string | null }[] = [];
  let page = 1;
  for (;;) {
    const res = await payloadFetch(`/payload-folders?limit=500&page=${page}&depth=0&sort=name`);
    if (!res.ok) throw new Error(`Folders failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { docs: { id: string; name: string; folder?: string | { id: string } | null }[]; hasNextPage: boolean };
    for (const d of json.docs) out.push({ id: d.id, name: d.name, folder: typeof d.folder === "object" && d.folder ? d.folder.id : (d.folder as string | null) ?? null });
    if (!json.hasNextPage) break;
    page++;
  }
  const byId = new Map(out.map((f) => [f.id, f]));
  const pathOf = (f: { id: string; name: string; folder: string | null }): string => {
    const parts = [f.name];
    let p = f.folder;
    let guard = 0;
    while (p && byId.has(p) && guard++ < 12) {
      const pf = byId.get(p)!;
      parts.unshift(pf.name);
      p = pf.folder;
    }
    return parts.join("/");
  };
  return out.map((f) => ({ id: f.id, name: f.name, parent: f.folder, path: pathOf(f) })).sort((a, b) => a.path.localeCompare(b.path));
}

export async function createMediaFolder(name: string, parent: string | null): Promise<MediaFolder> {
  const res = await payloadFetch(`/payload-folders`, {
    method: "POST",
    body: JSON.stringify({ name, folder: parent, folderType: ["media"] }),
  });
  if (!res.ok) throw new Error(`Create folder failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { doc: { id: string; name: string; folder?: string | null } };
  return { id: json.doc.id, name: json.doc.name, parent: json.doc.folder ?? parent, path: name };
}

// Highest trailing _NN among files in a folder named `prefix`_NN (e.g.
// audif1_2026_ESP_GP_gallery_paddock_03), so numbering continues per folder.
// A file named exactly `prefix`.ext (no number) counts as 1. Returns 1 when
// the name is still free.
export async function nextNumberInFolder(folderId: string, prefix: string): Promise<number> {
  prefix = prefix.replace(/_$/, "");
  const res = await payloadFetch(`/media?limit=500&depth=0&where[folder][equals]=${encodeURIComponent(folderId)}`);
  if (!res.ok) return 1;
  const json = (await res.json()) as { docs: { filename?: string }[] };
  let max = 0;
  for (const d of json.docs) {
    const f = d.filename ?? "";
    if (f.replace(/\.[a-z0-9]+$/i, "") === prefix) { max = Math.max(max, 1); continue; }
    if (!f.startsWith(prefix + "_")) continue;
    const m = f.slice(prefix.length).match(/^_(\d{2,3})\.[a-z0-9]+$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// ---- content tags (staging). Titles are the identity; ids are per CMS.
export type ContentTag = { id: string; title: string };
let tagCache: { at: number; tags: ContentTag[] } | null = null;

export async function listContentTags(fresh = false): Promise<ContentTag[]> {
  if (!fresh && tagCache && Date.now() - tagCache.at < 60_000) return tagCache.tags;
  const out: ContentTag[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await payloadFetch(`/content-tags?limit=100&sort=title&depth=0&page=${page}`);
    if (!res.ok) throw new Error(`content-tags failed (${res.status})`);
    const json = (await res.json()) as { docs: { id: string; title: string }[]; hasNextPage?: boolean };
    out.push(...json.docs.map((d) => ({ id: d.id, title: d.title })));
    if (!json.hasNextPage) break;
  }
  tagCache = { at: Date.now(), tags: out };
  return out;
}

export async function createContentTag(title: string): Promise<ContentTag> {
  const t = title.trim();
  const existing = (await listContentTags()).find((x) => x.title.toLowerCase() === t.toLowerCase());
  if (existing) return existing;
  const res = await payloadFetch(`/content-tags`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t }) });
  if (!res.ok) throw new Error(`Create tag failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { doc: { id: string; title: string } };
  tagCache = null;
  return { id: json.doc.id, title: json.doc.title };
}

export async function uploadMedia(file: Blob, filename: string, alt: string, folderId: string | null, contentTagIds: string[] = []): Promise<{ id: string; url: string; filename: string }> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("_payload", JSON.stringify({ alt, ...(folderId ? { folder: folderId } : {}), ...(contentTagIds.length ? { contentTags: contentTagIds } : {}) }));
  const res = await payloadFetch(`/media`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { doc: { id: string; url: string; filename: string } };
  return { id: json.doc.id, url: json.doc.url, filename: json.doc.filename };
}

// ---- Photobook (staging) --------------------------------------------------
// Upload any file into an upload collection (media first; PDFs may need the
// `files` collection depending on the CMS's mime rules).
export async function uploadToCollection(
  collection: "media" | "files",
  file: Blob,
  filename: string,
  data: Record<string, unknown>
): Promise<{ id: string; url: string; filename: string }> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("_payload", JSON.stringify(data));
  const res = await payloadFetch(`/${collection}`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`${collection} upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { doc: { id: string; url: string; filename: string } };
  return { id: json.doc.id, url: json.doc.url, filename: json.doc.filename };
}

// Creates (or updates, by slug) a draft page on staging. Returns id + admin link.
export async function upsertDraftPage(slug: string, body: Record<string, unknown>): Promise<{ id: string; adminUrl: string; created: boolean }> {
  const found = await payloadFetch(`/pages?where[slug][equals]=${encodeURIComponent(slug)}&depth=0&draft=true&limit=1`);
  const existing = found.ok ? ((await found.json()) as { docs: { id: string }[] }).docs?.[0] : undefined;
  const res = existing
    ? await payloadFetch(`/pages/${existing.id}?draft=true&locale=en`, { method: "PATCH", body: JSON.stringify({ ...body, _status: "draft" }) })
    : await payloadFetch(`/pages?draft=true&locale=en`, { method: "POST", body: JSON.stringify({ ...body, slug, _status: "draft" }) });
  if (!res.ok) throw new Error(`Page ${existing ? "update" : "create"} failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  const json = (await res.json()) as { doc: { id: string } };
  const id = json.doc.id;
  return { id, adminUrl: cmsAdminUrlFor("pages", id, "en"), created: !existing };
}

// Draft pages whose slug contains `part` (EN sections, depth 0), newest first.
export type DraftPage = { id: string; slug: string; title?: string; createdAt: string; sections?: Record<string, unknown>[] };
export async function listDraftPages(part: string, limit = 50): Promise<DraftPage[]> {
  const res = await payloadFetch(`/pages?where[slug][like]=${encodeURIComponent(part)}&depth=0&draft=true&locale=en&limit=${limit}&sort=-createdAt`);
  if (!res.ok) throw new Error(`Page list failed (${res.status})`);
  return ((await res.json()) as { docs: DraftPage[] }).docs ?? [];
}

// Replaces the EN sections of a draft page (stays a draft).
export async function patchDraftSections(id: string, sections: unknown[]): Promise<void> {
  const res = await payloadFetch(`/pages/${id}?draft=true&locale=en`, { method: "PATCH", body: JSON.stringify({ sections, _status: "draft" }) });
  if (!res.ok) throw new Error(`Page update failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

export function stagingFileUrl(path: string): string {
  return path.startsWith("http") ? path : `${baseUrl().replace(/\/cms\/api$/, "")}${path}`;
}

// Generic authenticated staging request (Team Card copy needs badges,
// engagements, loyalty tags and badge types, not only pages and media).
export const stagingRequest = (path: string, init: RequestInit = {}) => payloadFetch(path, init);
