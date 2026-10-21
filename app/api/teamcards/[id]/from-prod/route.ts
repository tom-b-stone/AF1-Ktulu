import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getCard } from "@/lib/teamCards";
import { fromProduction, prodMatch } from "@/lib/teamCardCreate";

// GET → is this card on production? · POST → copy it from production to staging (overwrites staging)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const card = await getCard(params.id);
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });
  return NextResponse.json({ prod: await prodMatch(card).catch(() => null) });
}

// POST {} → card + engagement, starts the page copy · POST { job } → goes on with the page copy
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { job?: string };
  const r = await fromProduction(params.id, session.user.email, b.job || undefined);
  console.log(`[teamcards] ${session.user.email} from production ${params.id}: ${r.ok ? "ok" : "failed"}`);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
