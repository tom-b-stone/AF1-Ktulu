import { NextRequest, NextResponse } from "next/server";
import { CORS, registerClient } from "@/lib/oauth";

// RFC 7591 dynamic client registration (public clients, PKCE)
export const dynamic = "force-dynamic";
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const c = await registerClient(body ?? {});
    return NextResponse.json(
      { client_id: c.client_id, client_id_issued_at: Math.floor(Date.parse(c.created_at) / 1000), client_name: c.client_name, redirect_uris: c.redirect_uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
      { status: 201, headers: CORS },
    );
  } catch (e) {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: e instanceof Error ? e.message : "invalid" }, { status: 400, headers: CORS });
  }
}
