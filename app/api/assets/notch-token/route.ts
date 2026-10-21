import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { createNotchToken, notchTokenStatus } from "@/lib/connectorTokens";

// The AF1 Notch Mac app's personal token. GET → when the current one was made · POST → a new one (replaces it)
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ createdAt: await notchTokenStatus(session.user.email) });
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ token: await createNotchToken(session.user.email) });
}
