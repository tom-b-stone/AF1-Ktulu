import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { applyChanges, cardCheck, cardMeta, diff, listCards, stagingLinks, type Change } from "@/lib/teamCards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const cards = await listCards();
    const meta = await cardMeta(cards).catch(() => ({}) as Awaited<ReturnType<typeof cardMeta>>);
    return NextResponse.json({ cards: cards.map((c) => ({ ...c, links: stagingLinks(c), meta: meta[c.staging.badgeId] ?? { core: false }, check: cardCheck(c, meta[c.staging.badgeId]) })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}

// Bulk changes across cards (search and replace):
// { action: "preview", changes } → before/after + rule issues, nothing written
// { action: "apply", changes }   → records + staging updated
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { action?: string; changes?: Change[] } | null;
  const changes = b?.changes ?? [];
  try {
    if (b?.action === "apply") {
      const r = await applyChanges(changes, session.user.email);
      console.log(`[teamcards] ${session.user.email} bulk-applied ${r.applied.length} changes`);
      return NextResponse.json(r);
    }
    return NextResponse.json(diff(await listCards(), changes));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
