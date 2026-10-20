import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { listCampaigns, saveCampaign } from "@/lib/sitemapSync";

// The campaigns of the Figma sync and the Figma board of each one.
// GET → list · POST { key?, name, root, race, season, figmaUrl } → save
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ campaigns: await listCampaigns() });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { key?: string; name?: string; root?: string; race?: string; season?: string; figmaUrl?: string } | null;
  if (!b) return NextResponse.json({ error: "no data" }, { status: 400 });
  try {
    return NextResponse.json({ campaigns: await saveCampaign(b, session.user.email) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
