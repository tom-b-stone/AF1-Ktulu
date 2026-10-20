import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { listAccess, removeAccess, saveAccess } from "@/lib/accessStore";
import { RELEASE, STATUS_LABEL, TOOL_LABEL } from "@/lib/toolAccess";

// Access board: test users and the tools each one sees. Admin only.
export const dynamic = "force-dynamic";

async function admin() {
  const s = await getServerSession(authOptions);
  return (s?.user as { role?: string } | undefined)?.role === "admin" ? s!.user!.email! : null;
}

const tools = () => Object.entries(RELEASE).map(([key, r]) => ({ key, label: TOOL_LABEL[key] ?? key, status: STATUS_LABEL[r.status] }));

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ users: await listAccess(), tools: tools(), admins: (process.env.ADMIN_EMAILS ?? "tma@slash.digital").split(",").map((e) => e.trim()) });
}

// { email, tools } → add or update
export async function POST(req: NextRequest) {
  const by = await admin();
  if (!by) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { email?: string; tools?: string[] } | null;
  try {
    return NextResponse.json({ users: await saveAccess(String(b?.email ?? ""), Array.isArray(b?.tools) ? b!.tools!.map(String) : [], by) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}

// ?email= → remove
export async function DELETE(req: NextRequest) {
  if (!(await admin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const email = req.nextUrl.searchParams.get("email") ?? "";
  return NextResponse.json({ users: await removeAccess(email) });
}
