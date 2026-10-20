import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { listCampaigns } from "@/lib/sitemapSync";
import { applyChanges, badgeTypes, cardCheck, cardMeta, diff, listCards, setCardType, stagingLinks, type Change, createCard, prefillFrom, similarCards } from "@/lib/teamCards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const cards = await listCards();
    const meta = await cardMeta(cards).catch(() => ({}) as Awaited<ReturnType<typeof cardMeta>>);
    // a card without a campaign tag belongs to the campaign of its Grand Prix (e.g. São Paulo → Unlock São Paulo)
    const camps = await listCampaigns().catch(() => []);
    const plain = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const campOf = (race?: string) => (race ? camps.find((x) => x.race && plain(x.race) === plain(race))?.name : undefined);
    return NextResponse.json({ cards: cards.map((c) => ({ ...c, links: stagingLinks(c), meta: meta[c.staging.badgeId] ?? { core: false, type: c.brief?.badgeType || undefined, campaign: c.brief?.campaign || campOf(c.brief?.race) || undefined, race: c.brief?.race, partner: c.brief?.partner }, check: cardCheck(c, meta[c.staging.badgeId]) })) });
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
    // { action: "similar", id } → cards to take texts from · { action: "prefill", id, from } → texts copied into the empty fields
    if (b?.action === "similar") return NextResponse.json({ cards: await similarCards(String((b as unknown as { id?: string }).id ?? "")) });
    if (b?.action === "prefill") {
      const x = b as unknown as { id?: string; from?: string };
      return NextResponse.json(await prefillFrom(String(x.id ?? ""), String(x.from ?? ""), session.user.email));
    }
    // { action: "new", name, badgeType?, campaign?, race? } → a new card, set up step by step
    if (b?.action === "new") {
      const n = b as unknown as { name?: string; badgeType?: string; campaign?: string; race?: string };
      const card = await createCard({ name: n.name ?? "", badgeType: n.badgeType, campaign: n.campaign, race: n.race }, session.user.email);
      console.log(`[teamcards] ${session.user.email} created ${card.id}`);
      return NextResponse.json({ card });
    }
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
