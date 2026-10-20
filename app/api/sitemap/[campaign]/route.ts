import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { applySync, cardsForConfigurator, getCampaign, status } from "@/lib/sitemapSync";
import { importCampaignCards } from "@/lib/teamCards";
import { isAdminEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: { campaign: string } };

// GET → pages, last Figma report, open differences (runs on every tool load)
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { campaign } = ctx.params;
  try {
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
    if (b?.action === "import-cards") return NextResponse.json(await importCampaignCards(campaign.toUpperCase(), await cardsForConfigurator(campaign), (await getCampaign(campaign))?.race || campaign));
    const r = await applySync(campaign, session.user.email, { decisions: b?.decisions ?? {}, only: Array.isArray(b?.only) ? b.only : undefined });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
