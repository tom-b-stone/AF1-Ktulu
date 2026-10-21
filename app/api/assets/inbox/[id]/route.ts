import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { readFile, readInbox } from "@/lib/assetInbox";

// Images handed over by the AF1 Notch Mac app.
//   GET            → { round, session, files: [{ id, name, mime, complete }] }
//   GET ?file=<id> → the image itself
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const fileId = req.nextUrl.searchParams.get("file");
  if (fileId) {
    const f = await readFile(params.id, fileId);
    if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(f.bytes), { headers: { "Content-Type": f.mime, "Cache-Control": "private, max-age=600" } });
  }
  const box = await readInbox(params.id);
  if (!box) return NextResponse.json({ error: "This hand-over expired (one day) or doesn't exist." }, { status: 404 });
  return NextResponse.json({ round: box.round ?? null, session: box.session ?? "", by: box.owner, files: box.files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, complete: f.received === f.parts })) });
}
