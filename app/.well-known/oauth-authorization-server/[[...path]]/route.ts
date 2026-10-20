import { NextRequest, NextResponse } from "next/server";
import { CORS, originOf, serverMetadata } from "@/lib/oauth";

// RFC 8414 authorization server metadata for the AF1 Tools connector
export const dynamic = "force-dynamic";
export function GET(req: NextRequest) {
  return NextResponse.json(serverMetadata(originOf(req)), { headers: CORS });
}
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
