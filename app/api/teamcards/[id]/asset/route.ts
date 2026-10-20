import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { uploadCardAsset } from "@/lib/teamCards";

// POST multipart { file, purpose } → staging media for the card's setup
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || !file.size || !/^image\//.test(file.type)) return NextResponse.json({ error: "an image, please" }, { status: 400 });
  if (file.size > 4_000_000) return NextResponse.json({ error: "image over 4 MB" }, { status: 400 });
  try {
    return NextResponse.json(await uploadCardAsset(params.id, file, String(form?.get("purpose") ?? "image")));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
