import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { applyApproved, checkSync, heldArt, lastSync, type Approval } from "@/lib/teamCardSync";

// Sync status of the Team Cards across Staging, Ktulu and Figma.
//   GET              → checks all three now (a few seconds)
//   GET ?cached=1    → the last check
//   GET ?art=<card>  → a card image from Figma that waits for approval
//   POST { staging, figma, art } → applies what the person approved
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const art = req.nextUrl.searchParams.get("art");
  if (art) {
    const h = await heldArt(art);
    if (!h) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(Buffer.from(h.data, "base64")), { headers: { "Content-Type": h.mime, "Cache-Control": "private, max-age=300" } });
  }
  try {
    if (req.nextUrl.searchParams.get("cached")) return NextResponse.json(await lastSync());
    return NextResponse.json(await checkSync());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Approval | null;
  if (!b) return NextResponse.json({ error: "nothing approved" }, { status: 400 });
  try {
    const r = await applyApproved(b, session.user.email);
    console.log(`[teamcards] ${session.user.email} sync approved: ${r.done.length} done, ${r.errors.length} errors`);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
