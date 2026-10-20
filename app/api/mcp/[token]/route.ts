import { NextRequest, NextResponse } from "next/server";
import { resolveConnectorToken } from "@/lib/connectorTokens";
import { rpcError, serveMcp } from "@/lib/mcpServer";

// Personal connector link (the older way): the per-user token in the path
// (minted on /connector). The company connector is /api/mcp (OAuth).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const record = await resolveConnectorToken(params.token);
  if (!record) return NextResponse.json({ error: "invalid connector token" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  return serveMcp(body, record.email);
}

// Stateless server: no SSE stream to open, nothing to tear down.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 200 });
}
