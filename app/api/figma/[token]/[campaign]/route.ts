import { NextRequest, NextResponse } from "next/server";
import { resolvePluginToken } from "@/lib/connectorTokens";
import { MODULES, OVERLAY_KEY, ackPending, applySync, clearCommand, getCommand, getPending, loadModel, mediaFile, previewSync, uploadFromFigma, getCampaign, listCampaigns, mediaAlt, setMediaAlt } from "@/lib/sitemapSync";
import { describeFigmaImage, placeholderAlt } from "@/lib/figmaImageAlt";
import { blueprints, buildPagesFromFigma, type FigmaPage } from "@/lib/pagesFromFigma";
import { createOnStaging } from "@/lib/teamCardCreate";
import { canonicalLoc } from "@/lib/assetNaming";
import { stagingRequest } from "@/lib/payloadClient";
// "São Paulo" → "BRA" via the race list, else the first three letters
const LOCS: Record<string, string> = { "sao paulo": "BRA", singapore: "SIN", "las vegas": "LVG", qatar: "QAT", "abu dhabi": "UAE", mexico: "MEX", austin: "USA" };
const plainLoc = (t: string) => { const k = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(); return LOCS[k] ?? k.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase(); };
import { cardsForArt, linkCardArt, setArtPending, setCardArtHash, setCardImage } from "@/lib/teamCards";
import { holdArt } from "@/lib/teamCardSync";

// Endpoint for the "AF1 Ktulu Sync" Figma plugin (figma-plugin/ in this
// repo). The plugin runs in Figma's sandbox (origin "null"), so it can't
// carry the session cookie: it authenticates with a personal plugin token in
// the path (Team Cards → Figma Sync → "Create plugin token").

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS });
const NO_TOKEN = "Unknown token. Create one in the AF1 Tool under Team Cards → Figma Sync.";

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

type Ctx = { params: { token: string; campaign: string } };

export async function GET(req: NextRequest, ctx: Ctx) {
  const rec = await resolvePluginToken(ctx.params.token);
  if (!rec) return json({ error: NO_TOKEN }, 401);
  const campaign = ctx.params.campaign;
  // "_campaigns" → every campaign and its Figma board, so the plugin can pick the one of the open file
  if (campaign === "_campaigns") return json({ campaigns: await listCampaigns(), user: rec.email });
  // "_cards" → every Team Card with its linked Figma artwork (card images)
  if (campaign === "_cards") return json({ cards: await cardsForArt(), user: rec.email });
  const c = await getCampaign(campaign);
  if (!c) return json({ error: "unknown campaign" }, 404);
  // ?media=<id> → the image itself (for the plugin's image fills)
  const media = req.nextUrl.searchParams.get("media");
  if (media) {
    const f = await mediaFile(media).catch(() => null);
    if (!f) return json({ error: "media not found" }, 404);
    return new NextResponse(f.body, { headers: { ...CORS, "Content-Type": f.type, "Cache-Control": "private, max-age=3600" } });
  }
  // ?light=1 → the plugin's background tick: only what's waiting and a marker for "staging changed"
  if (req.nextUrl.searchParams.get("light")) {
    const where = encodeURIComponent(JSON.stringify({ url: { like: c.root } }));
    const [pending, command, last] = await Promise.all([
      getPending(campaign),
      getCommand(campaign),
      stagingRequest(`/pages?where=${where}&limit=1&sort=-updatedAt&depth=0&draft=true&select[updatedAt]=true`).then((r) => r.json()).catch(() => null),
    ]);
    return json({ pending, command, stamp: last?.docs?.[0]?.updatedAt ?? null });
  }
  try {
    const [m, pending, command] = await Promise.all([loadModel(c), getPending(campaign), getCommand(campaign)]);
    const { mediaFolder: _a, contentTag: _b, ...pub } = c;
    void _a;
    void _b;
    return json({ campaign: pub, pages: m.pages, cards: m.cards, groups: m.groups, media: m.media, modules: MODULES, overlayKey: OVERLAY_KEY, pending, command, user: rec.email });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "failed" }, 502);
  }
}

// { action: "check", figma }                      → dry run
// { action: "sync", figma, nodes, decisions? }    → newest side wins
// { action: "ack", keys }                         → plugin wrote pending fields
// { action: "upload", name, mime, data, alt }     → image placed in Figma → staging media id
export async function POST(req: NextRequest, ctx: Ctx) {
  const rec = await resolvePluginToken(ctx.params.token);
  if (!rec) return json({ error: NO_TOKEN }, 401);
  const campaign = ctx.params.campaign;
  const b = (await req.json().catch(() => null)) as {
    action?: string;
    figma?: Record<string, string>;
    nodes?: Record<string, string>;
    decisions?: Record<string, "figma" | "cms">;
    only?: string[];
    keys?: string[];
    name?: string;
    mime?: string;
    data?: string;
    alt?: string;
  } | null;
  try {
    // card artworks (any file): link a card to an artwork, upload its export as the card image
    if (campaign === "_cards") {
      const x = b as unknown as { action?: string; card?: string; file?: string; node?: string; data?: string; hash?: string; name?: string };
      if (x?.action === "link-art") return json(await linkCardArt(String(x.card), x.node ? { file: String(x.file ?? ""), node: String(x.node) } : null, rec.email));
      if (x?.action === "card-image") {
        if (!x.data || !x.card) return json({ error: "card and image required" }, 400);
        const bytes = Buffer.from(x.data, "base64");
        if (bytes.byteLength > 4_000_000) return json({ error: "image over 4 MB" }, 400);
        const mime = (x as { mime?: string }).mime || "image/jpeg";
        // a card without an image takes it right away; a changed artwork waits for approval in the Team Cards sync bar
        const cur = (await cardsForArt()).find((c) => c.id === x.card);
        if (cur?.hasImage) {
          await holdArt(x.card, { data: x.data, mime, hash: x.hash ?? "", art: (x as { art?: string }).art ?? "", by: rec.email });
          await setArtPending(x.card, x.hash ?? "pending");
          console.log(`[figma] ${rec.email} card image ${x.card} from Figma: waiting for approval`);
          return json({ held: true });
        }
        const r = await setCardImage(x.card, new Blob([bytes], { type: mime }), x.name || `${x.card}.jpg`, rec.email, "the Figma Team Cards board (plugin)", (x as { art?: string }).art);
        if (x.hash) await setCardArtHash(x.card, x.hash);
        console.log(`[figma] ${rec.email} card image ${x.card} from Figma`);
        return json(r);
      }
      return json({ error: "unknown action" }, 400);
    }
    if (b?.action === "check") return json(await previewSync(campaign, b.figma ?? {}));
    // landing pages from the design: what to read per module, then build the draft pages, then each card's links
    if (b?.action === "blueprints") return json({ blueprints: await blueprints() });
    if (b?.action === "build-pages") {
      const pages = ((b as unknown as { pages?: FigmaPage[] }).pages ?? []) as FigmaPage[];
      const r = await buildPagesFromFigma(campaign, pages, rec.email);
      console.log(`[figma] ${rec.email} built ${r.pages.length} pages for ${campaign} from Figma`);
      return json(r);
    }
    if (b?.action === "card-links") {
      const id = String((b as unknown as { card?: string }).card ?? "");
      return json(await createOnStaging(id, rec.email));
    }
    if (b?.action === "ack-command") {
      await clearCommand(campaign);
      return json({ ok: true });
    }
    if (b?.action === "ack") return json({ remaining: await ackPending(campaign, b.keys ?? []) });
    if (b?.action === "upload") {
      if (!b.data) return json({ error: "no image data" }, 400);
      // like the Asset Uploader: WebP from the plugin (longest edge 2560, quality 80), Claude writes the alt
      // text and the descriptor, the name follows the rule audif1_{year}_{LOC}_GP_{context}_{descriptor}_{nn}
      const pg = b as unknown as { page?: string; context?: string; nn?: number; preview?: string; previewMime?: string };
      const c = await getCampaign(campaign);
      const loc = canonicalLoc(plainLoc(c?.race || c?.name || campaign)) || plainLoc(c?.race || campaign);
      const year = Number(c?.season) || 2026;
      let described: Awaited<ReturnType<typeof describeFigmaImage>> = null;
      let note = "";
      if (pg.preview) {
        try {
          described = await describeFigmaImage({ preview: { mime: pg.previewMime || "image/jpeg", data: pg.preview }, race: c?.race || c?.name || campaign, loc, year, label: [pg.page, pg.context].filter(Boolean).join(" · ") || (b.name ?? "") });
          if (!described) note = "no Claude key set (Admin → Claude API), placeholder alt text";
        } catch (e) {
          note = `alt text not generated (${e instanceof Error ? e.message : "failed"}), placeholder kept`;
        }
      }
      if (pg.page && pg.context) {
        const desc = described?.descriptor || pg.page.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        b.name = `audif1_${year}_${loc}_GP_${pg.context}_${desc}_${String(pg.nn ?? 1).padStart(2, "0")}`;
      }
      const alt = described?.alt || b.alt || "";
      const id = await uploadFromFigma(campaign, b.name ?? "figma-image", Uint8Array.from(Buffer.from(b.data, "base64")), b.mime ?? "image/webp", alt);
      console.log(`[sitemap] ${rec.email} uploaded image from Figma → ${id}${described ? " (alt by Claude)" : ""}`);
      return json({ id, name: b.name, alt, ...(note ? { note } : {}) });
    }
    // images already on the pages with a placeholder alt text: Claude writes a real one (one image per call)
    if (b?.action === "alt-fix") {
      const id = String((b as unknown as { id?: string }).id ?? "");
      const label = String((b as unknown as { label?: string }).label ?? "");
      const m = id ? await mediaAlt(id) : null;
      if (!m) return json({ id, skipped: "not found" });
      if (!placeholderAlt(m.alt)) return json({ id, skipped: "has an alt text" });
      if (m.mimeType && !/^image\//.test(m.mimeType)) return json({ id, skipped: "not an image" });
      const file = await mediaFile(id);
      if (!file) return json({ id, skipped: "image too large to read" });
      const c = await getCampaign(campaign);
      const loc = canonicalLoc(plainLoc(c?.race || c?.name || campaign)) || plainLoc(c?.race || campaign);
      const d = await describeFigmaImage({ preview: { mime: file.type, data: Buffer.from(file.body).toString("base64") }, race: c?.race || c?.name || campaign, loc, year: Number(c?.season) || 2026, label: label || m.filename });
      if (!d) return json({ id, skipped: "no Claude key set (Admin → Claude API)" });
      await setMediaAlt(id, d.alt);
      console.log(`[sitemap] ${rec.email} alt text by Claude for ${id}`);
      return json({ id, alt: d.alt, before: m.alt });
    }
    if (b?.action === "sync") {
      const r = await applySync(campaign, rec.email, { figma: b.figma ?? {}, nodes: b.nodes, decisions: b.decisions, only: b.only });
      console.log(`[sitemap] ${rec.email} figma sync ${campaign}: ${r.summary}`);
      return json(r);
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "failed" }, 502);
  }
}
