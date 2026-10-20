import { NextRequest, NextResponse } from "next/server";
import { resolvePluginToken } from "@/lib/connectorTokens";
import { MODULES, OVERLAY_KEY, ackPending, applySync, clearCommand, getCommand, getPending, loadModel, mediaFile, previewSync, uploadFromFigma, getCampaign, listCampaigns } from "@/lib/sitemapSync";
import { cardsForArt, linkCardArt, setCardArtHash, setCardImage } from "@/lib/teamCards";

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
        const r = await setCardImage(x.card, new Blob([bytes], { type: "image/jpeg" }), x.name || `${x.card}.jpg`, rec.email, "the Figma Team Cards board (plugin)");
        if (x.hash) await setCardArtHash(x.card, x.hash);
        console.log(`[figma] ${rec.email} card image ${x.card} from Figma`);
        return json(r);
      }
      return json({ error: "unknown action" }, 400);
    }
    if (b?.action === "check") return json(await previewSync(campaign, b.figma ?? {}));
    if (b?.action === "ack-command") {
      await clearCommand(campaign);
      return json({ ok: true });
    }
    if (b?.action === "ack") return json({ remaining: await ackPending(campaign, b.keys ?? []) });
    if (b?.action === "upload") {
      if (!b.data) return json({ error: "no image data" }, 400);
      const id = await uploadFromFigma(campaign, b.name ?? "figma-image", Uint8Array.from(Buffer.from(b.data, "base64")), b.mime ?? "image/jpeg", b.alt ?? "");
      console.log(`[sitemap] ${rec.email} uploaded image from Figma → ${id}`);
      return json({ id });
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
