import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { refreshCollections, setZineMockup } from "@/lib/zineCollection";

// { mockups: [{ pageSlug, mediaId }] } → stores the collection images and
// rebuilds "The collection" slider on every GP Mini-Zine page (drafts).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { mockups?: { pageSlug: string; mediaId: string }[] } | null;
  try {
    for (const m of b?.mockups ?? []) if (/^gp-mini-zine-\d{4}-[a-z]+$/.test(m.pageSlug) && m.mediaId) await setZineMockup(m.pageSlug, m.mediaId);
    const n = await refreshCollections();
    return NextResponse.json({ ok: true, editions: n });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
