import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { acceptSuggested, applyChanges, deleteCard, diff, engagementPreview, getCard, listCards, rawDocs, reloadCard, stagingLinks, type Change } from "@/lib/teamCards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const card = await getCard(params.id);
  if (!card) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [preview, raw] = await Promise.all([engagementPreview(card).catch(() => null), rawDocs(card).catch(() => null)]);
  return NextResponse.json({ card: { ...card, links: stagingLinks(card), preview, raw } });
}

// { action: "preview", changes } → before/after + rule issues, nothing written
// { action: "apply", changes }   → record + staging updated, report
// { action: "reload" }           → record re-read from staging
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { action?: string; changes?: Change[] } | null;
  try {
    // { action: "accept", keys? } → suggested texts kept as they are · { action: "delete" } → card removed
    if (b?.action === "accept") {
      const card = await acceptSuggested(params.id, (b as unknown as { keys?: string[] }).keys ?? null, session.user.email);
      return NextResponse.json({ card: { ...card, links: stagingLinks(card) } });
    }
    if (b?.action === "delete") return NextResponse.json(await deleteCard(params.id, session.user.email));
    if (b?.action === "reload") {
      const card = await reloadCard(params.id);
      return card ? NextResponse.json({ card: { ...card, links: stagingLinks(card) } }) : NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const changes = (b?.changes ?? []).map((c) => ({ ...c, card: params.id }));
    if (b?.action === "apply") {
      const r = await applyChanges(changes, session.user.email);
      console.log(`[teamcards] ${session.user.email} applied ${r.applied.length} changes to ${params.id}`);
      const card = await getCard(params.id);
      return NextResponse.json({ ...r, card: card ? { ...card, links: stagingLinks(card) } : null });
    }
    return NextResponse.json(diff(await listCards(), changes));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
