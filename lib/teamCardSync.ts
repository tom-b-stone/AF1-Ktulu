// Server-only: where the Team Cards stand across the three systems
//   01 Staging (the CMS)  ⇄  02 Ktulu (the card records)  ⇄  03 Figma (board + plugin)
// and syncing them after a person approved each change. The side that changed
// last is proposed; when both changed since the last sync it is a conflict and
// the person picks. Texts (EN/DE), settings, card images and page modules.
import { kvDel, kvGet, kvSet, kvSetEx } from "./kv";
import { stg } from "./teamCardCopy";
import { FIELDS, type Loc, type LocValue } from "./teamCardFields";
import { applyChanges, listCards, saveCardsPublic, setCardArtHash, setCardImage, type CardRecord, type Change } from "./teamCards";
import { applySync, listCampaigns, status } from "./sitemapSync";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const getPath = (o: Json, p: (string | number)[]) => p.reduce((a: Json, k) => (a == null ? undefined : a[k]), o);
const t = (s?: string) => (s ? Date.parse(s) : 0);
const SLACK = 3000; // ms: writes by the tool itself land a moment after its own timestamp

export type Dir = "to-ktulu" | "to-staging" | "conflict";
export type TextRow = { id: string; card: string; cardName: string; key: string; label: string; locale: Loc | null; kind: "text" | "setting" | "image"; ktulu: string; staging: string; dir: Dir; stagingAt?: string; ktuluAt?: string };
export type FigmaRow = { id: string; campaign: string; key: string; page: string; block: string; layer: string; kind: "text" | "image"; cms: string; figma: string; dir: "to-figma" | "from-figma" | "conflict" };
export type ArtRow = { id: string; card: string; cardName: string; art: string; at: string; preview: string };
export type SyncStatus = {
  checkedAt: string;
  staging: TextRow[]; // Staging ⇄ Ktulu
  onlyKtulu: { id: string; name: string }[]; // cards not built on staging yet
  figma: FigmaRow[]; // Figma ⇄ Staging (page modules and Team Card texts the board shows)
  figmaPending: { campaign: string; name: string; count: number; figmaUrl: string; reportedAt: string | null }[]; // waiting for the plugin
  art: ArtRow[]; // card images changed in Figma, waiting for approval
  errors: string[];
};

const KEY = "teamcards:sync";
const artKey = (card: string) => `teamcards:art:${card}`;
const shown = (v: unknown) => (v == null ? "" : typeof v === "object" ? "" : String(v));

// a little parallelism, so 50 cards are checked in a few seconds
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function stagingSide(c: CardRecord, pages: Map<string, Promise<Json>>) {
  const q = (l: Loc) => `locale=${l}&fallback-locale=none&depth=0`;
  const page = (l: Loc) => {
    if (!c.staging.pageId) return Promise.resolve(null);
    const k = `${c.staging.pageId}:${l}`;
    if (!pages.has(k)) pages.set(k, stg(`/pages/${c.staging.pageId}?${q(l)}&draft=true`).catch(() => null));
    return pages.get(k)!;
  };
  const docs: Record<string, Json> = {};
  for (const l of ["en", "de"] as Loc[]) {
    const [b, e, p] = await Promise.all([
      stg(`/badges/${c.staging.badgeId}?${q(l)}`).catch(() => null),
      c.staging.engagementId ? stg(`/engagements/${c.staging.engagementId}?${q(l)}`).catch(() => null) : null,
      page(l),
    ]);
    docs[`badge:${l}`] = b;
    docs[`engagement:${l}`] = e;
    docs[`module:${l}`] = (p?.sections ?? []).find((s: Json) => s.id === c.staging.blockId) ?? null;
    docs[`page:${l}`] = p;
  }
  return docs;
}

export async function checkSync(): Promise<SyncStatus> {
  const errors: string[] = [];
  const cards = await listCards();
  const pages = new Map<string, Promise<Json>>();
  const onStaging = cards.filter((c) => c.staging.badgeId);
  const rows: TextRow[] = [];
  await pool(onStaging, 6, async (c) => {
    try {
      const docs = await stagingSide(c, pages);
      if (!docs["badge:en"]) return errors.push(`${c.id}: card not found on staging`);
      const synced = t(c.syncedAt ?? c.updatedAt);
      const ktuluChanged = t(c.updatedAt) > synced + SLACK;
      const docAt = (d: string) => (d === "module" ? docs["page:en"]?.updatedAt : docs[`${d}:en`]?.updatedAt) as string | undefined;
      const dirOf = (doc: string): Dir => {
        const stagingChanged = t(docAt(doc)) > synced + SLACK;
        if (stagingChanged && ktuluChanged) return "conflict";
        if (ktuluChanged && !stagingChanged) return "to-staging";
        return "to-ktulu";
      };
      for (const f of FIELDS) {
        if (f.doc === "engagement" && !c.staging.engagementId) continue;
        if (f.doc === "module" && !c.staging.blockId) continue;
        for (const l of (f.localized ? ["en", "de"] : ["en"]) as Loc[]) {
          const s = shown(getPath(docs[`${f.doc}:${l}`], f.path));
          const v = c.values[f.key];
          const k = f.localized ? shown((v as LocValue | undefined)?.[l]) : shown(v);
          if (s.trim() === k.trim()) continue;
          if (f.kind === "boolean" && (s === "" || s === "false") && (k === "" || k === "false")) continue;
          rows.push({ id: `${c.id}|${f.key}|${f.localized ? l : "-"}`, card: c.id, cardName: c.name, key: f.key, label: f.label, locale: f.localized ? l : null, kind: f.localized ? "text" : "setting", ktulu: k, staging: s, dir: dirOf(f.doc), stagingAt: docAt(f.doc), ktuluAt: c.updatedAt });
        }
      }
      // card image: the media on the staging card vs the one Ktulu knows
      const img = getPath(docs["badge:en"], ["badgeImage"]);
      const imgId = typeof img === "object" && img ? img.id : img;
      const mine = String(c.brief?.imageId ?? "");
      if (imgId && mine && imgId !== mine) rows.push({ id: `${c.id}|image|-`, card: c.id, cardName: c.name, key: "image", label: "Card image", locale: null, kind: "image", ktulu: mine, staging: String(imgId), dir: dirOf("badge"), stagingAt: docAt("badge"), ktuluAt: c.updatedAt });
    } catch (e) {
      errors.push(`${c.id}: ${e instanceof Error ? e.message.slice(0, 120) : "check failed"}`);
    }
  });

  // Figma: every campaign with a board
  const figma: FigmaRow[] = [];
  const figmaPending: SyncStatus["figmaPending"] = [];
  for (const camp of (await listCampaigns().catch(() => [])).filter((x) => x.figmaFile)) {
    try {
      const s = await status(camp.key);
      const ds = (s.diffs ?? []).filter((d: Json) => d.state !== "missing-in-figma");
      for (const d of ds) {
        if (d.state === "cms-newer") continue; // counted below: only the plugin can write into Figma
        figma.push({ id: `${camp.key}|${d.key}`, campaign: camp.key, key: d.key, page: d.page, block: d.block, layer: d.layer, kind: d.kind, cms: d.cms ?? "", figma: d.figma ?? "", dir: d.state === "figma-newer" ? "from-figma" : "conflict" });
      }
      const toFigma = ds.filter((d: Json) => d.state === "cms-newer").length + (s.pending ?? 0);
      if (toFigma) figmaPending.push({ campaign: camp.key, name: camp.name, count: toFigma, figmaUrl: camp.figmaUrl, reportedAt: s.figma?.reportedAt ?? null });
    } catch (e) {
      errors.push(`Figma ${camp.name}: ${e instanceof Error ? e.message.slice(0, 120) : "check failed"}`);
    }
  }

  // card images the plugin found changed on the board
  const art: ArtRow[] = [];
  for (const c of cards) {
    const raw = await kvGet(artKey(c.id)).catch(() => null);
    if (!raw) continue;
    const a = JSON.parse(raw) as { art: string; at: string; mime: string; thumb?: string };
    art.push({ id: `art|${c.id}`, card: c.id, cardName: c.name, art: a.art, at: a.at, preview: `/api/teamcards/sync?art=${encodeURIComponent(c.id)}` });
  }

  const out: SyncStatus = { checkedAt: new Date().toISOString(), staging: rows, onlyKtulu: cards.filter((c) => !c.staging.badgeId).map((c) => ({ id: c.id, name: c.name })), figma, figmaPending, art, errors };
  await kvSet(KEY, JSON.stringify(out)).catch(() => {});
  return out;
}

export async function lastSync(): Promise<SyncStatus | null> {
  const raw = await kvGet(KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as SyncStatus) : null;
}

// ---- card images from Figma wait here until someone approves them
export async function holdArt(card: string, a: { data: string; mime: string; hash: string; art: string; by: string }) {
  await kvSetEx(artKey(card), JSON.stringify({ ...a, at: new Date().toISOString() }), 14 * 24 * 3600);
}
export async function heldArt(card: string): Promise<{ data: string; mime: string; hash: string; art: string } | null> {
  const raw = await kvGet(artKey(card)).catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

// ---- apply what the person approved
export type Approval = { staging?: { id: string; dir: "to-ktulu" | "to-staging" }[]; figma?: { id: string; side: "figma" | "cms" }[]; art?: string[] };

export async function applyApproved(a: Approval, by: string) {
  const done: string[] = [];
  const errors: string[] = [];
  const last = await lastSync();
  const rows = new Map((last?.staging ?? []).map((r) => [r.id, r]));

  // Staging → Ktulu: take the staging value into the record
  const take = (a.staging ?? []).filter((x) => x.dir === "to-ktulu").map((x) => rows.get(x.id)).filter(Boolean) as TextRow[];
  if (take.length) {
    const cards = await listCards();
    const now = new Date().toISOString();
    for (const [cardId, list] of groupBy(take, (r) => r.card)) {
      const c = cards.find((x) => x.id === cardId);
      if (!c) continue;
      for (const r of list) {
        if (r.kind === "image") {
          c.brief = { ...(c.brief ?? {}), imageId: r.staging };
          c.imageUrl = `/api/sitemap/media/${r.staging}`;
          continue;
        }
        const f = FIELDS.find((x) => x.key === r.key)!;
        if (f.localized) c.values[f.key] = { ...((c.values[f.key] as LocValue) ?? {}), [r.locale as Loc]: r.staging };
        else c.values[f.key] = f.kind === "boolean" ? r.staging === "true" : r.staging;
        if (c.suggested) delete c.suggested[`${f.key}:${r.locale ?? "en"}`];
      }
      c.updatedAt = now;
      c.syncedAt = now;
      c.log = [{ at: now, by, summary: `Taken from staging (approved): ${[...new Set(list.map((r) => r.label + (r.locale ? ` ${r.locale.toUpperCase()}` : "")))].join(", ")}` }, ...c.log].slice(0, 50);
      done.push(`${cardId}: ${list.length} from staging into Ktulu`);
    }
    await saveCardsPublic(cards);
  }

  // Ktulu → Staging: push the record's value
  const push = (a.staging ?? []).filter((x) => x.dir === "to-staging").map((x) => rows.get(x.id)).filter(Boolean) as TextRow[];
  const changes: Change[] = push.filter((r) => r.kind !== "image").map((r) => {
    const f = FIELDS.find((x) => x.key === r.key)!;
    return { card: r.card, key: r.key, locale: r.locale, value: f.kind === "boolean" ? r.ktulu === "true" : r.ktulu };
  });
  if (changes.length) {
    // applyChanges skips values it thinks are already there: the record matches, so compare against staging
    const res = await applyChanges(changes, `${by} (sync, approved)`, { force: true });
    done.push(...res.pushed);
    errors.push(...res.errors);
  }

  // Figma ⇄ Staging: newer side or the person's pick, per campaign
  for (const [campaign, list] of groupBy(a.figma ?? [], (x) => x.id.split("|")[0])) {
    const keys = list.map((x) => x.id.slice(campaign.length + 1));
    const decisions = Object.fromEntries(list.map((x) => [x.id.slice(campaign.length + 1), x.side]));
    const r = await applySync(campaign, by, { decisions, only: keys }).catch((e) => ({ written: [], error: e instanceof Error ? e.message : "failed" }) as Json);
    if (r.error) errors.push(`Figma ${campaign}: ${r.error}`);
    else done.push(...(r.written ?? []).map((w: string) => `Figma → staging: ${w}`), ...(r.toFigma?.length ? [`${r.toFigma.length} change(s) wait for the Figma plugin`] : []));
  }

  // card images from Figma
  for (const card of a.art ?? []) {
    const h = await heldArt(card);
    if (!h) continue;
    try {
      await setCardImage(card, new Blob([Buffer.from(h.data, "base64")], { type: h.mime }), `${card}.webp`, `${by} (from Figma, approved)`, "the Figma Team Cards board", h.art);
      await setCardArtHash(card, h.hash);
      await kvDel(artKey(card));
      done.push(`${card}: card image from Figma`);
    } catch (e) {
      errors.push(`${card} image: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  const fresh = await checkSync().catch(() => null);
  return { done, errors, status: fresh };
}

function groupBy<T>(xs: T[], k: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(k(x), [...(m.get(k(x)) ?? []), x]);
  return m;
}
