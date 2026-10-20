import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { linkCardArt } from "@/lib/teamCards";
import { parseFigmaUrl } from "@/lib/sitemapSync";

// POST { url } or { file, node } → link the card to its artwork on the Figma
// Team Cards board (the plugin keeps the image current); { url: "" } unlinks.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { url?: string; file?: string; node?: string } | null;
  let art: { file: string; node: string } | null = null;
  if (b?.url) {
    const f = parseFigmaUrl(b.url);
    if (!f?.nodeId) return NextResponse.json({ error: "Paste the link of the artwork itself (select it in Figma, then copy link)" }, { status: 400 });
    art = { file: f.fileKey, node: f.nodeId };
  } else if (b?.file && b?.node) art = { file: b.file, node: b.node };
  try {
    return NextResponse.json(await linkCardArt(params.id, art, session.user.email));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
