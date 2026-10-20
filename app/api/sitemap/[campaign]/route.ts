import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { applySync, cardsForConfigurator, getCampaign, getCommand, queueCommand, status } from "@/lib/sitemapSync";
import { blueprints, buildPagesFromFigma, lastPagesBuild, type FigmaPage } from "@/lib/pagesFromFigma";
import { importCampaignCards } from "@/lib/teamCards";
import { isAdminEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: { campaign: string } };

// GET → pages, last Figma report, open differences (runs on every tool load)
export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { campaign } = ctx.params;
  try {
    // ?pages=1 → light: is a "build the pages from Figma" waiting for the plugin, and the last result
    if (req.nextUrl.searchParams.get("blueprints")) return NextResponse.json({ blueprints: await blueprints() });
    if (req.nextUrl.searchParams.get("pages")) {
      const [command, last] = await Promise.all([getCommand(campaign), lastPagesBuild(campaign)]);
      return NextResponse.json({ waiting: command?.command === "pages-from-figma" ? command : null, last });
    }
    return NextResponse.json(await status(campaign));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}

// POST { decisions } → newer side wins, conflicts as decided. Figma-side
// changes go to staging now; CMS-side changes wait for the plugin.
export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { campaign } = ctx.params;
  const b = (await req.json().catch(() => null)) as { action?: string; decisions?: Record<string, "figma" | "cms">; only?: string[] } | null;
  try {
    // { action: "import-cards" } → the campaign's Team Cards into the card list
    if (b?.action === "import-cards" && !isAdminEmail(session.user.email)) return NextResponse.json({ error: "admins only" }, { status: 403 });
    // { action: "build-pages", pages } → same as the plugin's call (pages read from Figma elsewhere, e.g. by Claude)
    if (b?.action === "build-pages") return NextResponse.json(await buildPagesFromFigma(campaign, ((b as unknown as { pages?: FigmaPage[] }).pages ?? []) as FigmaPage[], session.user.email));
    // { action: "queue-pages" } → the Figma plugin builds the campaign's landing pages on staging next time it runs
    if (b?.action === "queue-pages") {
      await queueCommand(campaign, "pages-from-figma", session.user.email);
      return NextResponse.json({ queued: true });
    }
    if (b?.action === "import-cards") return NextResponse.json(await importCampaignCards(campaign.toUpperCase(), await cardsForConfigurator(campaign), (await getCampaign(campaign))?.race || campaign));
    const r = await applySync(campaign, session.user.email, { decisions: b?.decisions ?? {}, only: Array.isArray(b?.only) ? b.only : undefined });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
