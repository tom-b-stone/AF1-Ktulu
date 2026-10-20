import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { createOnStaging } from "@/lib/teamCardCreate";

// POST → builds a Ktulu-only card on staging as a disabled badge
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await createOnStaging(params.id, session.user.email);
  console.log(`[teamcards] ${session.user.email} create on staging ${params.id}: ${r.ok ? r.badgeId : "failed"}`);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
