import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { setCardImage } from "@/lib/teamCards";

// POST multipart { file, source? } → the card's new artwork (staging media)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || !file.size) return NextResponse.json({ error: "no image" }, { status: 400 });
  if (!/^image\//.test(file.type)) return NextResponse.json({ error: "images only" }, { status: 400 });
  if (file.size > 4_000_000) return NextResponse.json({ error: "image over 4 MB" }, { status: 400 });
  try {
    const name = (file as File).name || `${params.id}.jpg`;
    const r = await setCardImage(params.id, file, name, session.user.email, String(form?.get("source") ?? "upload"));
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
