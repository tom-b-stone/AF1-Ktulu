import { NextRequest, NextResponse } from "next/server";
import { CORS, originOf, resourceMetadata } from "@/lib/oauth";

// RFC 9728 protected resource metadata: /api/mcp is signed in through this app
export const dynamic = "force-dynamic";
export function GET(req: NextRequest) {
  return NextResponse.json(resourceMetadata(originOf(req)), { headers: CORS });
}
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
