import { NextRequest, NextResponse } from "next/server";
import { CORS, OAuthError, exchangeCode, refreshGrant } from "@/lib/oauth";

// Token endpoint: authorization_code (with PKCE) and refresh_token
export const dynamic = "force-dynamic";
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
export async function POST(req: NextRequest) {
  const type = req.headers.get("content-type") ?? "";
  let p: Record<string, string> = {};
  if (type.includes("application/json")) p = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, string>;
  else p = Object.fromEntries(new URLSearchParams(await req.text()));
  // client_secret_basic is not used (public clients) but take the client id from it if sent
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (basic && !p.client_id) p.client_id = decodeURIComponent(Buffer.from(basic, "base64").toString().split(":")[0]);
  const headers = { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" };
  try {
    if (p.grant_type === "authorization_code") return NextResponse.json(await exchangeCode(p), { headers });
    if (p.grant_type === "refresh_token") return NextResponse.json(await refreshGrant(p), { headers });
    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400, headers });
  } catch (e) {
    const code = e instanceof OAuthError ? e.code : "server_error";
    return NextResponse.json({ error: code, error_description: e instanceof Error ? e.message : "failed" }, { status: code === "server_error" ? 500 : 400, headers });
  }
}
