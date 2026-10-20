// Sitemap sync: keeps one campaign in the same state in Figma, in the AF1
// Tool and in the staging CMS.
//
// What syncs (EN):
//   page modules : kicker/category, headline, subline, copy, CTA label,
//                  carousel/list items, images (media ids)
//   Team Cards   : the badge texts and images shown in the card journey
//                  (announced, logged out, not earned, earned, back)
// Rich text (free text) and iFrame URLs are shown in Figma but only change
// in the CMS (read-only fields).
//
// Three-way compare per field:
//   base  = the value both sides agreed on at the last sync (KV snapshot)
//   cms   = staging now (latest draft)
//   figma = what the Figma plugin last reported (KV), or sends right now
// figma == cms             → in sync
// figma changed, cms not   → Figma is newer → write to the CMS
// cms changed, figma not   → CMS is newer → plugin updates the layer
// both changed differently → conflict → the person decides
//
// Field keys: "<pageId>|<blockId>|<path>" for page modules,
//             "badge:<badgeId>|card|<path>" for Team Card fields.
import { kvGet, kvSet } from "./kv";
import { listContentTags, listMediaFolders, stagingRequest, uploadMedia } from "./payloadClient";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export type Group = { key: string; title: string; urls: string[]; card: boolean; note?: string; col: "left" | "center" | "right" };
export type Campaign = {
  key: string;
  name: string;
  root: string; // page url prefix on staging
  figmaFile: string;
  figmaPage: string;
  mediaFolder: RegExp; // staging media folder for images placed in Figma
  contentTag: RegExp; // content tag for those uploads
  groups: Group[]; // one activation = one section in Figma
  race: string; // shown on the card back
  season: string;
};

const S = (u: string) => (u ? `unlock-singapore/${u}` : "unlock-singapore");
export const CAMPAIGNS: Record<string, Campaign> = {
  sin: {
    key: "sin",
    name: "Unlock Singapore",
    root: "unlock-singapore",
    figmaFile: "rGxt5J0qhiK759uEbaKgTO",
    figmaPage: "692:56",
    mediaFolder: /sin|singapore/i,
    contentTag: /singapore gp/i,
    race: "Singapore",
    season: "2026",
    groups: [
      { key: "hub", title: "Campaign Hub", urls: [S("")], card: false, col: "center", note: "Entry from paid social. Shows every card, the Vegas raffle and the map." },
      { key: "vegas", title: "Vegas Grand Prize", urls: [S("vegas-grand-prize-2026")], card: true, col: "center", note: "Raffle card · Page view on the Hub" },
      { key: "adidas-drop", title: "adidas Singapore Special Drop", urls: [S("adidas-singapore-special-drop"), S("adidas-singapore-special-drop/burnt-ends")], card: true, col: "left", note: "Hot or Not · QR code at Burnt Ends & adidas pop-up" },
      { key: "helmets", title: "Mini Helmets", urls: [S("mini-helmets"), S("mini-helmets/birds-of-paradise")], card: true, col: "left", note: "Hot or Not · QR code at Birds of Paradise" },
      { key: "mascot", title: "Spot the Mascot", urls: [S("spot-the-driver")], card: true, col: "left", note: "Page view · QR code on the mascot, hotspot on the map" },
      { key: "livery", title: "Reveal the Livery", urls: [S("reveal-the-livery"), S("ar-experience")], card: true, col: "left", note: "Reveal · AR experience (JIG)" },
      { key: "rs5", title: "Audi RS 5 · Singapore's Most Wanted", urls: [S("audi-rs5-singapores-most-wanted"), S("audi-rs5-singapores-most-wanted/funan-mall")], card: true, col: "right", note: "Hot or Not · QR code at Funan Mall" },
      { key: "run", title: "adidas Community Race", urls: [S("adidas-5km-run"), S("adidas-5km-run/done")], card: true, col: "right", note: "Page view with parameter · QR code in the goodie bag, email link" },
      { key: "paulaner", title: "Paulaner Pro", urls: [S("paulaner-pro"), S("paulaner-pro/brewery")], card: true, col: "right", note: "Survey · QR code in the Paulaner Bräuhaus" },
      { key: "revolut", title: "Revolut Titanium", urls: [S("revolut-titanium")], card: true, col: "right", note: "Hotspots · online only" },
      { key: "onground", title: "On Ground Activations", urls: [S("singapore-activations")], card: false, col: "center", note: "Info page, reached from the map CTA" },
    ],
  },
};

// ---- campaign boards ----------------------------------------------------------
// One Figma board per campaign. Singapore is configured above; more campaigns
// (and the Figma board of any campaign) are set in the AF1 Tool on /figma and
// stored in KV. A campaign without groups gets them from its staging pages:
// the root page is the hub, every page one level below is an activation
// (its deeper pages, e.g. QR landing pages, join it).
export type CampaignSettings = { key: string; name: string; root: string; race: string; season: string; figmaUrl?: string; figmaFile?: string; figmaPage?: string; updatedAt?: string; by?: string };
const kCampaigns = "sitemap:campaigns:v1";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// https://www.figma.com/design/<fileKey>/<name>?node-id=692-56 → file + page/node id
export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
  const m = /figma\.com\/(?:design|file)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/.exec(url ?? "");
  if (!m) return null;
  const node = /[?&]node-id=([0-9]+)[-:]([0-9]+)/.exec(url);
  return { fileKey: m[2] ?? m[1], nodeId: node ? `${node[1]}:${node[2]}` : undefined };
}

async function campaignSettings(): Promise<Record<string, CampaignSettings>> {
  const raw = await kvGet(kCampaigns).catch(() => null);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, CampaignSettings>;
  } catch {
    return {};
  }
}

function fromSettings(s: CampaignSettings, base?: Campaign): Campaign {
  const words = [s.race, s.name].filter(Boolean).map(esc).join("|") || esc(s.key);
  return {
    key: s.key,
    name: s.name || base?.name || s.key,
    root: s.root || base?.root || "",
    figmaFile: s.figmaFile ?? base?.figmaFile ?? "",
    figmaPage: s.figmaPage ?? base?.figmaPage ?? "",
    mediaFolder: base?.mediaFolder ?? new RegExp(words, "i"),
    contentTag: base?.contentTag ?? new RegExp(words, "i"),
    groups: base?.groups ?? [],
    race: s.race || base?.race || "",
    season: s.season || base?.season || "",
  };
}

export async function getCampaign(key: string): Promise<Campaign | null> {
  const set = (await campaignSettings())[key];
  const base = CAMPAIGNS[key];
  if (!set) return base ?? null;
  return fromSettings(set, base);
}

export async function listCampaigns(): Promise<(Omit<Campaign, "mediaFolder" | "contentTag" | "groups"> & { figmaUrl: string; custom: boolean })[]> {
  const set = await campaignSettings();
  const keys = [...new Set([...Object.keys(CAMPAIGNS), ...Object.keys(set)])];
  const out = [];
  for (const k of keys) {
    const c = (await getCampaign(k))!;
    const url = set[k]?.figmaUrl || (c.figmaFile ? `https://www.figma.com/design/${c.figmaFile}/Board${c.figmaPage ? `?node-id=${c.figmaPage.replace(":", "-")}` : ""}` : "");
    out.push({ key: c.key, name: c.name, root: c.root, figmaFile: c.figmaFile, figmaPage: c.figmaPage, race: c.race, season: c.season, figmaUrl: url, custom: !CAMPAIGNS[k] });
  }
  return out;
}

export async function saveCampaign(input: Partial<CampaignSettings> & { key?: string }, by: string) {
  const all = await campaignSettings();
  const key = (input.key || input.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  if (!key) throw new Error("Name the campaign first");
  const prev = all[key];
  const base = CAMPAIGNS[key];
  const next: CampaignSettings = {
    key,
    name: (input.name ?? prev?.name ?? base?.name ?? key).trim(),
    root: (input.root ?? prev?.root ?? base?.root ?? "").trim().replace(/^\/+|\/+$/g, ""),
    race: (input.race ?? prev?.race ?? base?.race ?? "").trim(),
    season: (input.season ?? prev?.season ?? base?.season ?? "").trim(),
    figmaUrl: prev?.figmaUrl,
    figmaFile: prev?.figmaFile,
    figmaPage: prev?.figmaPage,
    updatedAt: new Date().toISOString(),
    by,
  };
  if (!next.root) throw new Error("Add the page URL on staging (e.g. unlock-sao-paulo)");
  if (input.figmaUrl !== undefined) {
    const u = input.figmaUrl.trim();
    if (u) {
      const f = parseFigmaUrl(u);
      if (!f) throw new Error("That is not a Figma file link");
      next.figmaUrl = u;
      next.figmaFile = f.fileKey;
      next.figmaPage = f.nodeId ?? "";
    } else {
      next.figmaUrl = next.figmaFile = next.figmaPage = undefined;
    }
  }
  // another campaign on the same board? one board per campaign
  for (const c of await listCampaigns())
    if (c.key !== key && next.figmaFile && c.figmaFile === next.figmaFile && (c.figmaPage || "") === (next.figmaPage || "")) throw new Error(`That Figma page already belongs to ${c.name}. Use another file or page.`);
  all[key] = next;
  await kvSet(kCampaigns, JSON.stringify(all));
  return listCampaigns();
}

// groups for a campaign without a fixed sitemap, from its staging pages
function autoGroups(c: Campaign, urls: string[]): Group[] {
  const kids = urls.filter((u) => u !== c.root && u.split("/").length === c.root.split("/").length + 1).sort();
  const groups: Group[] = [{ key: "hub", title: "Campaign Hub", urls: urls.includes(c.root) ? [c.root] : [], card: false, col: "center" }];
  kids.forEach((u, i) => {
    const deeper = urls.filter((x) => x.startsWith(u + "/")).sort();
    const slug = u.split("/").pop()!;
    groups.push({ key: slug, title: slug.replace(/-/g, " ").replace(/\b\w/g, (x) => x.toUpperCase()), urls: [u, ...deeper], card: true, col: i % 2 ? "right" : "left" });
  });
  return groups.filter((g) => g.urls.length);
}

// Mobile modules (375 px) per CMS block type. "local" modules are built by the
// plugin as components in the working file (not in the 07 library).
export type ModuleDef = { key?: string; variant?: string; variantByBg?: Record<string, string>; local?: string; name: string; desktop?: { key?: string; variant?: string; variantByBg?: Record<string, string>; local?: string } };
export const OVERLAY_KEY = "6d6338d5b2a8bdfb03935037a19dec6672f80baa"; // Team_Card_Overlay_Mobile
export const OVERLAY_DESKTOP_KEY = "2eaae66507bb063ee94a050f0cbdc26977be6dad"; // Team_Card_Overlay_Desktop
const CAROUSEL_D = { key: "a472202a414cb600298f98531f9167a06fc7e274", variant: "Tile Variation=4, State=Unlocked, Ratio=4x5, Background=Grey 01" };
export const MODULES: Record<string, ModuleDef> = {
  hero: { key: "92f328fd4f4868c2c96ee2bc66df76f37909f02b", variant: "Position=Text bottom centered, Color Variant=Light, Size=XL", name: "Hero Image Mobile", desktop: { key: "5ee339e839dcb119149a0f67fb900b965958f0da", variant: "Position=Text bottom centered, Color Variant=Light, Height=XL" } },
  "single-card-showcase": { key: "37a990fda306c3ff11d7c56a8a251fa685b60cc4", variant: "Background=Grey 01", name: "Single Card Showcase Mobile", desktop: { key: "5b16f307e24c2273a71bed42d8f0baf2fc58dbc7", variant: "Background=Grey 01" } },
  "badges-grid": { key: "63028e426d41adf48eaf96ba5a717c66a7eb1853", variant: "Background=Chalk, Items=6", name: "Team Cards Grid Mobile", desktop: { key: "5a8692c17f16afbd94ea9716e184f483fbf51de3", variant: "Background=Chalk, Items=8" } },
  carousel: { key: "e98001eeafb9f5cc5920c3304af8c30a462fa620", variant: "Tile Variation=4, State=Unlocked, Ratio=4x5, Background=Grey 01", name: "Carousel Mobile", desktop: CAROUSEL_D },
  "carousel-tags": { key: "e98001eeafb9f5cc5920c3304af8c30a462fa620", variant: "Tile Variation=4, State=Unlocked, Ratio=4x5, Background=Grey 01", name: "Carousel Mobile (tags)", desktop: CAROUSEL_D },
  "call-to-action": { key: "918553ca6aa8215213e716b9e9af6d0ea64daa49", variant: "Alignment=Center, Background=Image, Width=Boxed, Text=Light", name: "Call to Action Mobile", desktop: { key: "bda814cd828f23d94c33acd3e3bf8dca0a223fbb", variant: "Alignment=Centred, Background=Image, Width=Boxed, Text=Light" } },
  "hot-spot": { key: "b267359bc26e0f4056e099e7db30d3772cbe4707", name: "Hotspot Mobile", desktop: { key: "d4b790f9da77978870d8ee5d43750f439f2dd5bd", variant: "Text Position=Text Top, Image Ratio=Landscape, Variation=Boxed, Background=Light" } },
  teaser: { key: "291e2a3471c882c11668c7c763b6cc0e96b95b87", name: "Teaser Big Mobile", desktop: { key: "30d2d414d9eda328c7dcc125ac5c0d26ce9ad468", variant: "Position=Text left /Image right, Height=XL, Background=Light" } },
  gallery: { key: "67bef93065cdc55535cd9b95add968beffebf056", name: "Gallery Grid Mobile", desktop: { key: "f74a16f28ec70216258a0e33044806a32849f51e", variant: "Tile Variation=3, Color Variant=Light, Background=Chalk" } },
  "badge-engagement-teaser": { key: "680bea534dcfc57a2242dbe732252c4f895e6894", variant: "Background=Chalk", name: "Badge Engagement Teaser Mobile", desktop: { key: "098eeeb4e031255abcdc974d6a4030c72a031a46", variant: "Background=Chalk" } },
  "logged-out-badge-reveal": { key: OVERLAY_KEY, variant: "State=Logged Out", name: "Team Card Overlay · Logged out", desktop: { key: OVERLAY_DESKTOP_KEY, variant: "State=Logged Out" } },
  "free-text": { key: "9cbc66e968681b26d36710315219542bff3405e2", variant: "Alignment=Left, Background=Light, Width=Full Witdh", variantByBg: { graphite: "Alignment=Left, Background=Black, Width=Full Witdh", chalk: "Alignment=Left, Background=Light, Width=Full Witdh" }, name: "Text Only Mobile", desktop: { key: "e1d29b6ab91578bc48c0c61d2e622c9eff6f7308", variant: "Alignment=Left, Background=Light, Width=Full Width", variantByBg: { graphite: "Alignment=Left, Background=Dark, Width=Full Width", chalk: "Alignment=Left, Background=Light, Width=Full Width" } } },
  "list-section": { local: "List Section Mobile", name: "List Section Mobile", desktop: { local: "List Section Desktop" } },
  "iframe-embed": { local: "iFrame Mobile", name: "iFrame Mobile", desktop: { local: "iFrame Desktop" } },
};
export const SKIP_BLOCKS = new Set(["spacer"]);

export type Field = { key: string; path: string; layer: string; value: string; kind: "text" | "image"; readonly?: boolean };
export type Block = { id: string; blockType: string; hidden: boolean; auth?: string; name?: string; badge?: string; engagement?: string; bg?: string; fields: Field[] };
export type SyncPage = { id: string; url: string; title: string; updatedAt: string; status: string; blocks: Block[] };
export type CardState = { state: string; label: string; note: string; fields: Field[] };
export type SyncCard = { badgeId: string; title: string; rewardType: string; isTimebound: boolean; group: string; states: CardState[] };
export type FieldMap = Record<string, string>;
export type Model = { pages: SyncPage[]; cards: SyncCard[]; groups: (Group & { badgeId?: string })[]; badges: Record<string, Json>; media: Record<string, { fx: number; fy: number }> };

async function stg(path: string, init: RequestInit = {}): Promise<Json> {
  const res = await stagingRequest(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`staging ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : {};
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const idOf = (v: Json) => (v && typeof v === "object" ? v.id ?? v.value ?? "" : str(v));

function lexicalText(rt: Json): string {
  const out: string[] = [];
  const walk = (n: Json, acc: string[]) => {
    if (!n) return;
    if (n.type === "text") acc.push(n.text ?? "");
    else if (n.type === "linebreak") acc.push("\n");
    for (const c of n.children ?? []) walk(c, acc);
  };
  for (const p of rt?.root?.children ?? []) {
    const acc: string[] = [];
    walk(p, acc);
    out.push(acc.join(""));
  }
  return out.join("\n\n").trim();
}

// ---- field extraction per block -------------------------------------------
function blockFields(pageId: string, s: Json): Field[] {
  const out: Field[] = [];
  const k = (path: string) => `${pageId}|${s.id}|${path}`;
  const text = (path: string, layer: string, value: unknown, readonly = false) => out.push({ key: k(path), path, layer, value: str(value), kind: "text", readonly });
  const image = (path: string, layer: string, value: unknown) => out.push({ key: k(path), path, layer, value: idOf(value), kind: "image" });
  const t = s.blockType;
  if (t === "iframe-embed") {
    text("url", "URL", s.url, true);
    return out;
  }
  if (t === "logged-out-badge-reveal") return out; // card fields come from the badge
  // the standard texts of every module; empty ones hide the sample text
  // Text Only: four layers all called "text" → told apart by their exact parent frame (^) and order (@n)
  const ft = t === "free-text";
  for (const [p, layer] of [
    ["category", ft ? "^Category / Logo>text" : "Kicker"],
    ["headline", ft ? "^HL + Sl>text@0" : t === "gallery" ? "Typography/Headline>text" : "Headline"],
    ["subline", ft ? "^HL + Sl>text@1" : t === "badge-engagement-teaser" ? "Description|Subline" : "Subline"],
    ["copy", ft ? "" : t === "gallery" ? "Typography/Copy>text" : "Copy"],
  ] as const) {
    if (!layer) continue;
    if (typeof s[p] === "string") text(p, layer, s[p]);
    else text(`_figma.${p}`, layer, "", true);
  }
  if (ft) text("content", "^Copy>text", lexicalText(s.content), true);
  // buttons: label i → the i-th visible button of the module; buttons without a label are hidden
  const arr = Array.isArray(s.ctas) && s.ctas.length ? "ctas" : Array.isArray(s.unearnedBadgeCTA) && s.unearnedBadgeCTA.length ? "unearnedBadgeCTA" : null;
  if (arr)
    (s[arr] as Json[]).slice(0, 2).forEach((c, i) => {
      if (c && typeof c.label === "string") text(`${arr}.${i}.label`, `@btn:${i}`, c.label);
    });
  if (Array.isArray(s.carouselItems))
    s.carouselItems.slice(0, 5).forEach((it: Json, i: number) => {
      const ci = it?.carouselImage;
      if (!ci) return;
      const n = i + 1;
      if (typeof ci.headline === "string") text(`carouselItems.${i}.carouselImage.headline`, `Tile ${n} · Headline`, ci.headline);
      if (typeof ci.copy === "string") text(`carouselItems.${i}.carouselImage.copy`, `Tile ${n} · Copy`, ci.copy);
      const l = ci.contentCtas?.[0]?.label;
      if (typeof l === "string") text(`carouselItems.${i}.carouselImage.contentCtas.0.label`, `Tile ${n} · Link 1`, l);
      if (ci.imagePreview) image(`carouselItems.${i}.carouselImage.imagePreview`, `ImageItem${n}>ImageContainer`, ci.imagePreview);
    });
  if (Array.isArray(s.listItems))
    s.listItems.slice(0, 6).forEach((it: Json, i: number) => {
      const li = it?.listItem ?? {};
      text(`listItems.${i}.listItem.label`, `Item ${i + 1} · Label`, li.label);
      text(`listItems.${i}.listItem.caption`, `Item ${i + 1} · Caption`, li.caption);
    });
  const bgMedia = s.container?.background?.imageSettings?.media;
  if (bgMedia && s.container?.background?.type === "image") {
    if (t === "hero") image("container.background.imageSettings.media", "Rectangle 9:16|Heroimage 16:9 Fullsize", bgMedia);
    if (t === "call-to-action") image("container.background.imageSettings.media", "Frame 48099931|Frame", bgMedia);
  }
  if (t === "teaser" && s.image) image("image", "Rectangle 28", s.image);
  if (t === "hot-spot" && (s.mobileImage || s.image)) image(s.mobileImage ? "mobileImage" : "image", "Images", s.mobileImage || s.image);
  if (t === "gallery" && Array.isArray(s.images))
    s.images.slice(0, 6).forEach((im: Json, i: number) => {
      const m = im?.image?.background?.imageSettings?.media;
      if (m) image(`images.${i}.image.background.imageSettings.media`, `Rectangle 16:9@${i}`, m);
    });
  return out;
}

// Team Card fields as they appear in the card journey.
const getPath = (o: Json, path: string) => path.split(".").reduce((a: Json, k) => (a == null ? a : a[/^\d+$/.test(k) ? Number(k) : k]), o);
function badgeField(badgeId: string, b: Json, path: string, layer: string, kind: "text" | "image" = "text", readonly = false): Field {
  const v = getPath(b, path);
  return { key: `badge:${badgeId}|card|${path}`, path, layer, value: kind === "image" ? idOf(v) : str(v), kind, readonly };
}
// texts the overlay shows that are not a plain badge text (rich text, fixed site labels): Figma shows them, the CMS owns them
function badgeShown(badgeId: string, name: string, layer: string, value: string): Field {
  return { key: `badge:${badgeId}|card|_figma.${name}`, path: `_figma.${name}`, layer, value, kind: "text", readonly: true };
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function cardStates(badgeId: string, b: Json, race: string, season: string): CardState[] {
  const name = badgeField(badgeId, b, "badgePopupTitle", "Badge Name");
  // one image layer per state: the plugin picks the visible one of the two
  const img = [badgeField(badgeId, b, "badgeImage", "Badge/Image|Badge mobile big", "image")];
  const btn = (path: string | null, fixed?: string) => (path ? badgeField(badgeId, b, path, "@btn:0") : badgeShown(badgeId, "btn." + (fixed ?? "none").toLowerCase(), "@btn:0", fixed ?? ""));
  const states: CardState[] = [];
  const push = (state: string, label: string, note: string, extra: Field[]) => states.push({ state, label, note, fields: [name, ...img, ...extra] });
  if (b.isTimebound) push("Announced", "Card announced", "Countdown · Payload: Is Timebound + Start Date", [badgeField(badgeId, b, "description", "Bottom Content>Description"), btn(null)]);
  push("Logged Out", "Logged out", "Payload: Logged Out Reveal title, description + button", [badgeField(badgeId, b, "loggedOutRevealTitle", "Logged Out · Title"), badgeField(badgeId, b, "loggedOutRevealDescription", "Logged Out · Description"), btn("loggedOutRevealButtonLabel")]);
  push("Default", "Not earned yet", "Payload: Reward Teaser Description + Unearned CTA", [badgeField(badgeId, b, "rewardTeaserDescription", "Bottom Content>Description"), btn(b.unearnedBadgeCTA?.[0] ? "unearnedBadgeCTA.0.label" : null)]);
  const earned = (state: string, label: string, note: string, extra: Field[] = []) => push(state, label, note, [badgeField(badgeId, b, "rewardDescription", "Bottom Content>Description"), ...extra]);
  const rt = str(b.rewardType);
  if (rt === "couponCode") earned("Code", "Earned · voucher code", "Reward Type: Coupon Code", [badgeField(badgeId, b, "couponCode", "Code")]);
  else if (rt === "raffleSignup") {
    earned("Raffle", "Earned · raffle sign-up", "Reward Type: Raffle Signup · Payload: T&C checkbox, submit label, footer note", [badgeShown(badgeId, "raffleTerms", "Checkbox Text", lexicalText(b.raffleTermsAndConditions)), badgeShown(badgeId, "raffleFooter", "Legal Text", lexicalText(b.raffleFooterNote)), btn("raffleSubmitLabel")]);
    earned("Raffle Entered", "Raffle entered", "After the submit · Payload: Raffle Confirmed CTA", [btn(b.raffleConfirmedCTA?.[0] ? "raffleConfirmedCTA.0.label" : null)]);
    earned("Raffle Closed", "Raffle closed", "After the end date", [btn(null)]);
  } else if (/download/i.test(rt)) earned("Download", "Earned · download", "Reward Type: Download Asset", [btn(null, "Download")]);
  else earned("Link", "Earned · no reward / link", "Reward Type: No Reward (+ Reward CTA)", [btn(b.rewardCTA?.[0] ? "rewardCTA.0.label" : null)]);
  states.push({
    state: "Back",
    label: "Card back",
    note: "Flip from any earned state · Payload: Description, back image",
    fields: [
      name,
      badgeField(badgeId, b, "description", "Back · Info Text"),
      badgeField(badgeId, b, "description", "Bottom Content>Description"),
      badgeField(badgeId, b, "badgeBackImage", "Badge/Image|Badge mobile big", "image"),
      badgeShown(badgeId, "back.season", "Back · Season", season),
      badgeShown(badgeId, "back.status", "Back · Status", "Earned"),
      badgeShown(badgeId, "back.race", "Back · Race", race),
      badgeShown(badgeId, "back.type", "Back · Type", cap(str(b.type))),
      btn(null),
    ],
  });
  return states;
}

// ---- model ------------------------------------------------------------------
export async function loadModel(c: Campaign): Promise<Model> {
  const where = encodeURIComponent(JSON.stringify({ url: { like: c.root } }));
  const r = await stg(`/pages?where=${where}&limit=100&depth=0&draft=true&locale=en&fallback-locale=none`);
  const docs: Json[] = (r.docs ?? []).filter((d: Json) => d.url === c.root || str(d.url).startsWith(c.root + "/"));
  const badgeIds = new Set<string>();
  const pages: SyncPage[] = docs.map((d) => ({
    id: d.id,
    url: d.url,
    title: d.title,
    updatedAt: d.updatedAt,
    status: d._status,
    blocks: (d.sections ?? [])
      .filter((s: Json) => !SKIP_BLOCKS.has(s.blockType) && s.authRequirement !== "HIDDEN")
      .map((s: Json) => {
        const badge = s.badge ? idOf(s.badge) : undefined;
        if (badge) badgeIds.add(badge);
        const eng = (s.children ?? []).find((x: Json) => x?.engagement)?.engagement;
        return { id: s.id, blockType: s.blockType, hidden: false, auth: s.authRequirement, name: s.blockName, badge, engagement: eng ? idOf(eng) : undefined, bg: s.background?.imageSettings?.bgColor ?? s.backgroundColor, fields: blockFields(d.id, s) };
      }),
  }));
  // badges
  const badges: Record<string, Json> = {};
  if (badgeIds.size) {
    const bw = encodeURIComponent(JSON.stringify({ id: { in: [...badgeIds] } }));
    const br = await stg(`/badges?where=${bw}&limit=100&depth=0&locale=en&fallback-locale=none`);
    for (const b of br.docs ?? []) badges[b.id] = b;
  }
  // card fields inside page modules
  for (const p of pages)
    for (const b of p.blocks) {
      const bd = b.badge ? badges[b.badge] : null;
      if (!bd) continue;
      if (b.blockType === "logged-out-badge-reveal")
        b.fields.push(badgeField(b.badge!, bd, "badgePopupTitle", "Badge Name"), badgeField(b.badge!, bd, "loggedOutRevealTitle", "Logged Out · Title"), badgeField(b.badge!, bd, "loggedOutRevealDescription", "Logged Out · Description"), badgeField(b.badge!, bd, "badgeImage", "Badge/Image|Badge mobile big", "image"), badgeField(b.badge!, bd, "loggedOutRevealButtonLabel", "@btn:0"));
      if (b.blockType === "single-card-showcase") b.fields.push(badgeField(b.badge!, bd, "publicTitle", "Name / Year"), badgeField(b.badge!, bd, "badgeImage", "Badge/Image", "image"));
      if (b.blockType === "badge-engagement-teaser") b.fields.push(badgeField(b.badge!, bd, "badgeImage", "Badge Image", "image"));
    }
  // tag carousels show the newest images with the module's content tags (read-only in Figma)
  for (const p of pages)
    for (const b of p.blocks) {
      if (b.blockType !== "carousel-tags") continue;
      const sec = (docs.find((d) => d.id === p.id)?.sections ?? []).find((x: Json) => x.id === b.id);
      const tags = [...new Set(((sec?.carouselItems?.contentTagsList ?? []) as Json[]).flatMap((x) => (x.contentTags ?? []).map(idOf)))];
      if (!tags.length) continue;
      const tw = encodeURIComponent(JSON.stringify({ and: [{ contentTags: { in: tags } }, { mimeType: { like: "image" } }] }));
      const tr = await stg(`/media?where=${tw}&sort=-createdAt&limit=5&depth=0`).catch(() => ({ docs: [] }));
      (tr.docs ?? []).forEach((m: Json, i: number) => b.fields.push({ key: `${p.id}|${b.id}|_figma.tagImage.${i}`, path: `_figma.tagImage.${i}`, layer: `ImageItem${i + 1}>ImageContainer`, value: m.id, kind: "image", readonly: true }));
    }
  // the engagement inside the teaser module: its question replaces the sample Hot or Not
  const engIds = [...new Set(pages.flatMap((p) => p.blocks.map((b) => b.engagement).filter(Boolean) as string[]))];
  if (engIds.length) {
    const ew = encodeURIComponent(JSON.stringify({ id: { in: engIds } }));
    const er = await stg(`/engagements?where=${ew}&limit=100&depth=0&locale=en&fallback-locale=none`).catch(() => ({ docs: [] }));
    const engs: Record<string, Json> = Object.fromEntries((er.docs ?? []).map((e: Json) => [e.id, e]));
    const TYPE: Record<string, string> = { "hot-or-not": "Hot or Not", survey: "Survey", "q-and-a": "Q&A", quiz: "Quiz" };
    for (const p of pages)
      for (const b of p.blocks) {
        const e = b.engagement ? engs[b.engagement] : null;
        if (!e) continue;
        const sh = (name: string, layer: string, value: string): Field => ({ key: `engagement:${e.id}|eng|_figma.${name}`, path: `_figma.${name}`, layer, value, kind: "text", readonly: true });
        b.fields.push(sh("question", "Would you wear those Shoes to the paddock?", str(e.questions?.[0]?.text)), sh("tag", "Stylecheck", ""), sh("type", "Hot or Not", TYPE[str(e.engagementType)] ?? cap(str(e.engagementType))));
        const bg = e.background?.imageSettings?.media;
        if (bg) b.fields.push({ key: `engagement:${e.id}|eng|_figma.background`, path: "_figma.background", layer: "HoN Desktop 799 - 1199px - Dark", value: idOf(bg), kind: "image", readonly: true });
      }
  }
  // groups, one card per group (the badge most used on its pages)
  const groupDefs = c.groups.length ? c.groups : autoGroups(c, docs.map((d) => str(d.url)));
  const groups: (Group & { badgeId?: string })[] = groupDefs.map((g) => {
    if (!g.card) return { ...g };
    const count: Record<string, number> = {};
    for (const p of pages.filter((p) => g.urls.includes(p.url))) for (const b of p.blocks) if (b.badge) count[b.badge] = (count[b.badge] ?? 0) + 1;
    const badgeId = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
    return { ...g, badgeId };
  });
  const cards: SyncCard[] = groups
    .filter((g) => g.badgeId && badges[g.badgeId])
    .map((g) => {
      const b = badges[g.badgeId!];
      return { badgeId: g.badgeId!, title: str(b.publicTitle || b.title), rewardType: str(b.rewardType), isTimebound: Boolean(b.isTimebound), group: g.key, states: cardStates(g.badgeId!, b, c.race, c.season) };
    });
  // the Team Cards grid shows the campaign's cards
  const gridCards = cards.slice(0, 8);
  for (const p of pages)
    for (const b of p.blocks)
      if (b.blockType === "badges-grid")
        gridCards.forEach((cd, i) => {
          const bd = badges[cd.badgeId];
          const n = String(i + 1).padStart(2, "0");
          b.fields.push(badgeField(cd.badgeId, bd, "badgeImage", `Card ${n}>Badge/Image`, "image"), badgeField(cd.badgeId, bd, "publicTitle", `Card ${n}>Name / Year`));
        });
  pages.sort((a, b) => (a.url === c.root ? -1 : b.url === c.root ? 1 : a.url.localeCompare(b.url)));
  // focal points, so Figma crops images like the site does
  const media: Model["media"] = {};
  const ids = new Set<string>();
  for (const p of pages) for (const b of p.blocks) for (const f of b.fields) if (f.kind === "image" && f.value) ids.add(f.value);
  for (const cd of cards) for (const st of cd.states) for (const f of st.fields) if (f.kind === "image" && f.value) ids.add(f.value);
  const all = [...ids];
  for (let i = 0; i < all.length; i += 100) {
    const mw = encodeURIComponent(JSON.stringify({ id: { in: all.slice(i, i + 100) } }));
    const mr = await stg(`/media?where=${mw}&limit=100&depth=0`).catch(() => ({ docs: [] }));
    for (const d of mr.docs ?? []) media[d.id] = { fx: d.focalX ?? 50, fy: d.focalY ?? 50 };
  }
  return { pages, cards, groups, badges, media };
}

export function allFields(m: Model): (Field & { page: string; block: string })[] {
  const out: (Field & { page: string; block: string })[] = [];
  const seen = new Set<string>();
  const add = (f: Field, page: string, block: string) => {
    if (seen.has(f.key)) return;
    seen.add(f.key);
    out.push({ ...f, page, block });
  };
  for (const p of m.pages) for (const b of p.blocks) for (const f of b.fields) add(f, p.url, b.name || b.blockType);
  for (const cd of m.cards) for (const s of cd.states) for (const f of s.fields) add(f, `Team Card · ${cd.title}`, s.label);
  return out;
}

export function cmsMap(m: Model): FieldMap {
  const out: FieldMap = {};
  for (const f of allFields(m)) out[f.key] = f.value;
  return out;
}

// ---- KV state
type Snapshot = { base: FieldMap; syncedAt: string | null };
export type FigmaReport = { values: FieldMap; nodes: Record<string, string>; reportedAt: string; by: string };
type Pending = Record<string, string>;

const kSnap = (c: string) => `sitemap:${c}:snapshot`;
const kFigma = (c: string) => `sitemap:${c}:figma`;
const kPending = (c: string) => `sitemap:${c}:pending`;
const kLog = (c: string) => `sitemap:${c}:log`;

async function getJson<T>(k: string, d: T): Promise<T> {
  const raw = await kvGet(k);
  if (!raw) return d;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return d;
  }
}
export const getSnapshot = (c: string) => getJson<Snapshot>(kSnap(c), { base: {}, syncedAt: null });
export const getFigmaReport = (c: string) => getJson<FigmaReport | null>(kFigma(c), null);
export const getPending = (c: string) => getJson<Pending>(kPending(c), {});
export const getLog = (c: string) => getJson<{ at: string; by: string; summary: string }[]>(kLog(c), []);
async function addLog(c: string, by: string, summary: string) {
  const l = await getLog(c);
  l.unshift({ at: new Date().toISOString(), by, summary });
  await kvSet(kLog(c), JSON.stringify(l.slice(0, 50)));
}

// ---- compare
export type Diff = {
  key: string;
  pageId: string;
  blockId: string;
  path: string;
  page: string;
  block: string;
  layer: string;
  kind: "text" | "image";
  base?: string;
  cms?: string;
  figma?: string;
  state: "figma-newer" | "cms-newer" | "conflict" | "missing-in-figma";
};
// Figma text layers turn "\n" into line separators; compare loosely.
const norm = (s?: string) => (s ?? "").replace(/\u2028|\r/g, "\n").replace(/[ \t]+\n/g, "\n").trim();

export function compare(m: Model, base: FieldMap, figma: FieldMap | null): { diffs: Diff[]; inSync: number; total: number } {
  const diffs: Diff[] = [];
  let inSync = 0;
  let total = 0;
  for (const f of allFields(m)) {
    total++;
    const [docId, blockId] = f.key.split("|");
    const cms = f.value;
    const fg = figma ? figma[f.key] : undefined;
    const bs = base[f.key];
    const meta = { key: f.key, pageId: docId, blockId, path: f.path, page: f.page, block: f.block, layer: f.layer, kind: f.kind, base: bs, cms, figma: fg };
    if (fg === undefined) {
      if (figma) diffs.push({ ...meta, state: "missing-in-figma" });
      continue;
    }
    if (norm(fg) === norm(cms)) {
      inSync++;
      continue;
    }
    if (f.readonly) {
      // only the CMS changes these; a local Figma edit is overwritten
      if (bs === undefined || norm(cms) !== norm(bs)) diffs.push({ ...meta, state: "cms-newer" });
      else inSync++;
      continue;
    }
    if (bs === undefined) diffs.push({ ...meta, state: "conflict" });
    else if (norm(cms) === norm(bs)) diffs.push({ ...meta, state: "figma-newer" });
    else if (norm(fg) === norm(bs)) diffs.push({ ...meta, state: "cms-newer" });
    else diffs.push({ ...meta, state: "conflict" });
  }
  return { diffs, inSync, total };
}

export async function status(campaign: string) {
  const c = await getCampaign(campaign);
  if (!c) throw new Error("unknown campaign");
  const [m, snap, figma, pending, log] = await Promise.all([loadModel(c), getSnapshot(campaign), getFigmaReport(campaign), getPending(campaign), getLog(campaign)]);
  const cmp = compare(m, snap.base, figma?.values ?? null);
  const { mediaFolder: _a, contentTag: _b, ...pub } = c;
  void _a;
  void _b;
  return { campaign: pub, pages: m.pages, cards: m.cards.map((x) => ({ badgeId: x.badgeId, title: x.title, group: x.group })), ...cmp, syncedAt: snap.syncedAt, figma: figma ? { reportedAt: figma.reportedAt, by: figma.by, nodes: figma.nodes } : null, pending: Object.keys(pending).length, log };
}

// ---- apply
const splitPath = (p: string) => p.split(".").map((x) => (/^\d+$/.test(x) ? Number(x) : x));

export async function applySync(campaign: string, by: string, opts: { figma?: FieldMap; nodes?: Record<string, string>; decisions?: Record<string, "figma" | "cms">; only?: string[] }) {
  const c = await getCampaign(campaign);
  if (!c) throw new Error("unknown campaign");
  if (opts.figma) {
    const prev = await getFigmaReport(campaign);
    await kvSet(kFigma(campaign), JSON.stringify({ values: opts.figma, nodes: { ...(prev?.nodes ?? {}), ...(opts.nodes ?? {}) }, reportedAt: new Date().toISOString(), by }));
  }
  const figma = opts.figma ?? (await getFigmaReport(campaign))?.values ?? null;
  const m = await loadModel(c);
  const snap = await getSnapshot(campaign);
  const { diffs } = compare(m, snap.base, figma);
  const dec = opts.decisions ?? {};
  const toCms: Diff[] = [];
  const toFigma: Diff[] = [];
  const open: Diff[] = [];
  for (const d of diffs) {
    if (d.state === "missing-in-figma") continue;
    if (opts.only && !opts.only.includes(d.key)) {
      open.push(d);
      continue;
    }
    const choice = dec[d.key] ?? (d.state === "figma-newer" ? "figma" : d.state === "cms-newer" ? "cms" : undefined);
    if (choice === "figma") toCms.push(d);
    else if (choice === "cms") toFigma.push(d);
    else open.push(d);
  }
  const written: string[] = [];
  const byDoc = new Map<string, Diff[]>();
  for (const d of toCms) byDoc.set(d.pageId, [...(byDoc.get(d.pageId) ?? []), d]);
  const touchedBadges: string[] = [];
  for (const [docId, list] of byDoc) {
    if (docId.startsWith("badge:")) {
      const id = docId.slice(6);
      const body: Json = {};
      // nested paths (e.g. unearnedBadgeCTA.0.label) patch the whole top-level field
      const nested = list.some((d) => d.path.includes("."));
      const cur = nested ? await stg(`/badges/${id}?locale=en&fallback-locale=none&depth=0&draft=true`) : null;
      for (const d of list) {
        if (!d.path.includes(".")) body[d.path] = d.figma ?? "";
        else {
          const top = d.path.split(".")[0];
          if (!(top in body)) body[top] = cur?.[top] ?? [];
          setPath(body, splitPath(d.path), d.figma ?? "");
        }
      }
      await stg(`/badges/${id}?locale=en`, { method: "PATCH", body: JSON.stringify(body) });
      touchedBadges.push(id);
      written.push(`Team Card ${list[0].page.replace("Team Card · ", "")}: ${list.length} field${list.length === 1 ? "" : "s"}`);
      continue;
    }
    const page = await stg(`/pages/${docId}?locale=en&fallback-locale=none&depth=0&draft=true`);
    for (const d of list) {
      const block = (page.sections ?? []).find((s: Json) => s.id === d.blockId);
      if (block) setPath(block, splitPath(d.path), d.figma ?? "");
    }
    await stg(`/pages/${docId}?locale=en&draft=true`, { method: "PATCH", body: JSON.stringify({ sections: page.sections, _status: "draft" }) });
    await stg(`/pages/${docId}?locale=en`, { method: "PATCH", body: JSON.stringify({ _status: "published" }) });
    written.push(`${list[0].page}: ${list.length} field${list.length === 1 ? "" : "s"}`);
  }
  // keep the Team Card list in the tool current
  if (touchedBadges.length) {
    const { reloadCardsByBadge } = await import("./teamCards");
    await reloadCardsByBadge(touchedBadges).catch(() => {});
  }
  const pending = await getPending(campaign);
  for (const d of toFigma) pending[d.key] = d.cms ?? "";
  await kvSet(kPending(campaign), JSON.stringify(pending));
  const base = { ...snap.base };
  const cm = cmsMap(m);
  for (const k of Object.keys(cm)) if (figma && figma[k] !== undefined && norm(figma[k]) === norm(cm[k])) base[k] = cm[k];
  for (const d of toCms) base[d.key] = d.figma ?? "";
  for (const d of toFigma) base[d.key] = d.cms ?? "";
  await kvSet(kSnap(campaign), JSON.stringify({ base, syncedAt: new Date().toISOString() }));
  const summary = `${toCms.length} Figma → CMS, ${toFigma.length} CMS → Figma, ${open.length} open`;
  if (toCms.length || toFigma.length) await addLog(campaign, by, summary);
  return { toCms, toFigma, open, written, pending, summary };
}

export async function ackPending(campaign: string, keys: string[]) {
  const p = await getPending(campaign);
  for (const k of keys) delete p[k];
  await kvSet(kPending(campaign), JSON.stringify(p));
  return Object.keys(p).length;
}

function setPath(o: Json, p: (string | number)[], v: unknown) {
  let cur = o;
  for (let i = 0; i < p.length - 1; i++) {
    if (cur[p[i]] == null) cur[p[i]] = typeof p[i + 1] === "number" ? [] : {};
    cur = cur[p[i]];
  }
  cur[p[p.length - 1]] = v;
}

export async function previewSync(campaign: string, figma: FieldMap) {
  const c = await getCampaign(campaign);
  if (!c) throw new Error("unknown campaign");
  const [m, snap] = await Promise.all([loadModel(c), getSnapshot(campaign)]);
  return { ...compare(m, snap.base, figma), syncedAt: snap.syncedAt };
}

// ---- media for the plugin
// Proxy a staging image (a size ≤ 1600 px wide when there is one).
export async function mediaFile(id: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  const doc = await stg(`/media/${id}?depth=0`).catch(() => null);
  if (!doc) return null;
  const sizes = Object.values(doc.sizes ?? {}) as Json[];
  // only sizes with the original's aspect ratio (some sizes are cropped)
  const ratio = doc.width && doc.height ? doc.width / doc.height : 0;
  // the smallest size of at least 1000 px with the original's ratio, else the biggest below 2600 px
  const same = sizes.filter((s) => s?.url && s.width && s.height && s.width <= 2600 && (!ratio || Math.abs(s.width / s.height - ratio) / ratio < 0.02));
  const pick = [...same].sort((a, b) => a.width - b.width).find((s) => s.width >= 1000) ?? [...same].sort((a, b) => b.width - a.width)[0];
  // videos/animations: use a still (thumbnail or any image size) so Figma gets a picture
  const isImage = !doc.mimeType || /^image\//.test(doc.mimeType);
  const still = sizes.filter((s) => s?.url && (!s.mimeType || /^image\//.test(s.mimeType)) && (s.width ?? 0) <= 2600).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  // the original last: full-size uploads (Asset Uploader) can be bigger than a function response allows
  const urls = [pick?.url, still?.url, doc.thumbnailURL, isImage ? doc.url : null, doc.url].filter(Boolean) as string[];
  for (const url of [...new Set(urls)]) {
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/^\/cms\/api/, "");
    const res = await stagingRequest(path).catch(() => null);
    const type = res?.headers.get("content-type") ?? "image/webp";
    if (!res?.ok || !/^image\//.test(type)) continue;
    const body = await res.arrayBuffer();
    if (body.byteLength > 4_000_000) continue; // over the 4.5 MB response limit
    return { body, type };
  }
  return null;
}

// An image placed in Figma → staging media (campaign folder + tag).
export async function uploadFromFigma(campaign: string, name: string, bytes: Uint8Array, mime: string, alt: string) {
  const c = await getCampaign(campaign);
  if (!c) throw new Error("unknown campaign");
  const [folders, tags] = await Promise.all([listMediaFolders().catch(() => []), listContentTags().catch(() => [])]);
  const folder = folders.find((f) => c.mediaFolder.test(f.name) || c.mediaFolder.test(f.path));
  const tag = tags.find((t) => c.contentTag.test(t.title));
  const ext = mime.includes("png") ? "png" : "jpg";
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "figma-image";
  const blob = new Blob([bytes], { type: mime });
  const r = await uploadMedia(blob, `${safe}-${Date.now().toString(36)}.${ext}`, alt || name, folder?.id ?? null, tag ? [tag.id] : []);
  return r.id;
}

// ---- Team Card list in the tool: one record per campaign card
export async function cardsForConfigurator(campaign: string) {
  const c = await getCampaign(campaign);
  if (!c) throw new Error("unknown campaign");
  const m = await loadModel(c);
  return m.cards.map((cd) => {
    const g = m.groups.find((x) => x.key === cd.group)!;
    const pagesOfGroup = m.pages.filter((p) => g.urls.includes(p.url));
    let pageId: string | undefined, blockId: string | undefined, engagementId: string | undefined, mechanic: string | undefined;
    for (const p of pagesOfGroup) {
      const b = p.blocks.find((x) => x.badge === cd.badgeId && x.blockType === "badge-engagement-teaser") ?? p.blocks.find((x) => x.badge === cd.badgeId);
      if (b) {
        pageId = p.id;
        blockId = b.id;
        engagementId = b.engagement;
        break;
      }
    }
    const bd = m.badges[cd.badgeId];
    if (!engagementId) mechanic = "page";
    return { badgeId: cd.badgeId, title: cd.title, rewardType: cd.rewardType, pageId, blockId, engagementId, mechanic, imageId: idOf(bd?.badgeImage), placement: `${c.race || c.name} · ${g.title} (${g.urls.map((u) => "/" + u).join(", ")})` };
  });
}

// ---- one-off commands for the plugin (e.g. "build": rebuild every screen)
const kCmd = (c: string) => `sitemap:${c}:command`;
export async function queueCommand(campaign: string, command: string, by: string) {
  await kvSet(kCmd(campaign), JSON.stringify({ command, by, at: new Date().toISOString() }));
}
export async function getCommand(campaign: string): Promise<{ command: string; by: string; at: string } | null> {
  const raw = await kvGet(kCmd(campaign));
  return raw ? JSON.parse(raw) : null;
}
export async function clearCommand(campaign: string) {
  const { kvDel } = await import("./kv");
  await kvDel(kCmd(campaign));
}
// a fresh build: forget the last agreed state and Figma's report
export async function resetSync(campaign: string) {
  await kvSet(kSnap(campaign), JSON.stringify({ base: {}, syncedAt: null }));
  const { kvDel } = await import("./kv");
  await kvDel(kFigma(campaign));
  await kvDel(kPending(campaign));
}
