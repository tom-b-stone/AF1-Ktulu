import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { saveSetup, stagingLinks, type CardSetup } from "@/lib/teamCards";

// PUT { setup?, brief? } → saves the card's setup (engagement, module, reward, back image) and briefing (type, Grand Prix, campaign)
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { setup?: CardSetup; brief?: Record<string, string> } | null;
  if (!b) return NextResponse.json({ error: "no data" }, { status: 400 });
  try {
    const c = await saveSetup(params.id, b, session.user.email);
    return NextResponse.json({ card: { ...c, links: stagingLinks(c) } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
