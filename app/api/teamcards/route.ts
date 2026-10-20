import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { applyChanges, badgeTypes, cardCheck, cardMeta, diff, listCards, setCardType, stagingLinks, type Change } from "@/lib/teamCards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const cards = await listCards();
    const meta = await cardMeta(cards).catch(() => ({}) as Awaited<ReturnType<typeof cardMeta>>);
    return NextResponse.json({ cards: cards.map((c) => ({ ...c, links: stagingLinks(c), meta: meta[c.staging.badgeId] ?? { core: false, type: c.brief?.badgeType || undefined, campaign: c.brief?.campaign || undefined, race: c.brief?.race, partner: c.brief?.partner }, check: cardCheck(c, meta[c.staging.badgeId]) })) });
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
  const b = (await req.json().catch(() => null)) as { action?: string; changes?: Change[]; ids?: string[]; type?: { id: string; title: string } } | null;
  const changes = b?.changes ?? [];
  try {
    // { action: "types" } → card types in use · { action: "set-type", ids, type } → set on several cards
    if (b?.action === "types") return NextResponse.json({ types: await badgeTypes() });
    if (b?.action === "set-type") {
      if (!b.type?.id || !b.ids?.length) return NextResponse.json({ error: "cards and type required" }, { status: 400 });
      const r = await setCardType(b.ids, b.type, session.user.email);
      console.log(`[teamcards] ${session.user.email} set type ${b.type.title} on ${r.done.length} cards`);
      return NextResponse.json(r);
    }
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
