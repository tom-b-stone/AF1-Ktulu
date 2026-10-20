import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { blockedPath, type Role } from "./lib/toolAccess";

// /api/mcp is the Claude connector endpoint: called by Anthropic's servers,
// never by a browser with a session cookie. It authenticates itself with the
// per-user token in its path (lib/connectorTokens.ts).
// /p/<slug> is the public photobook share page (QR code on the printed book).
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/mcp", "/api/figma", "/api/capture", "/p", "/zine", "/af1-live", "/bg", "/slash-logo.png", "/videos"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    // Remember where they were going (e.g. the /seo/apply link Claude
    // handed back) so sign-in returns them there instead of the dashboard.
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?callbackUrl=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/admin") && token.role !== "admin") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Tools in development are closed to the test group (pages and their APIs).
  if (blockedPath(token.role as Role | undefined, pathname, token.tools as string[] | null | undefined)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "This tool is still in development." }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "?locked=1";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
