import { NextRequest, NextResponse } from "next/server";
import { CORS, originOf, resolveAccessToken } from "@/lib/oauth";
import { rpcError, serveMcp } from "@/lib/mcpServer";
import { isAllowedEmail } from "@/lib/auth";

// The company connector: one URL for everyone. Claude sends the person's
// OAuth access token (Google sign-in on /oauth/authorize); without one the
// 401 points Claude to the sign-in (RFC 9728 protected resource metadata).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized(req: NextRequest, why = "invalid_token") {
  const meta = `${originOf(req)}/.well-known/oauth-protected-resource/api/mcp`;
  return NextResponse.json(
    { error: why, error_description: "Sign in with Google to use AF1 Tools." },
    { status: 401, headers: { ...CORS, "WWW-Authenticate": `Bearer resource_metadata="${meta}"${why === "invalid_token" ? ', error="invalid_token"' : ""}` } },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  if (!token) return unauthorized(req, "unauthorized");
  const who = await resolveAccessToken(token);
  if (!who) return unauthorized(req);
  // removed from the team / access board → the connector stops at once
  if (!(await isAllowedEmail(who.email))) return NextResponse.json({ error: "access_denied" }, { status: 403, headers: CORS });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400, headers: CORS });
  }
  const res = await serveMcp(body, who.email);
  Object.entries(CORS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

export async function GET(req: NextRequest) {
  if (!req.headers.get("authorization")) return unauthorized(req, "unauthorized");
  return new NextResponse(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 200, headers: CORS });
}
