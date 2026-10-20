import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { stagingPages } from "@/lib/teamCards";

// GET ?q= → staging pages for the module picker
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ pages: await stagingPages(req.nextUrl.searchParams.get("q") ?? "") });
}
