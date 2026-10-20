import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { createCode, getClient, originOf } from "@/lib/oauth";
import { isAllowedEmail } from "@/lib/auth";

// The Allow / Cancel of /oauth/authorize: hands Claude a one-time code for
// the signed-in person, or the refusal.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  const f = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  const client = await getClient(f.client_id ?? "");
  if (!client || !client.redirect_uris.includes(f.redirect_uri ?? "")) return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  const back = new URL(f.redirect_uri);
  if (f.state) back.searchParams.set("state", f.state);
  back.searchParams.set("iss", originOf(req));
  if (f.action !== "allow") {
    back.searchParams.set("error", "access_denied");
    return NextResponse.redirect(back, 303);
  }
  if (!email || !(await isAllowedEmail(email))) {
    back.searchParams.set("error", "access_denied");
    return NextResponse.redirect(back, 303);
  }
  if (!f.code_challenge || f.code_challenge_method !== "S256") return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const code = await createCode({ email, client_id: client.client_id, redirect_uri: f.redirect_uri, challenge: f.code_challenge, scope: f.scope || "tools", resource: f.resource || undefined });
  console.log(`[oauth] ${email} connected ${client.client_name ?? client.client_id}`);
  back.searchParams.set("code", code);
  return NextResponse.redirect(back, 303);
}
