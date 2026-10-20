import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { DriveNotConnected, driveToken } from "@/lib/googleDrive";
import { previewImport, runImport, TRACKER_URL } from "@/lib/trackerImport";

// One-way import from the Team Cards Tracker (read only, never writes to it).
// { action: "preview" } → tracker cards with duplicate check
// { action: "import", ids } → adds the chosen new cards to Ktulu
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { action?: string; ids?: string[] } | null;
  try {
    const token = await driveToken(req);
    if (b?.action === "import") return NextResponse.json({ ok: true, ...(await runImport(token, (b.ids ?? []).map(String), session.user.email)) });
    return NextResponse.json({ ok: true, tracker: TRACKER_URL, ...(await previewImport(token)) });
  } catch (e) {
    if (e instanceof DriveNotConnected || (e instanceof Error && e.message === "google_denied")) return NextResponse.json({ error: "google_not_connected" }, { status: 401 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
