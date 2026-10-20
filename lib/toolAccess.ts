// Release status of every tool and who may open it. Shared by the
// middleware (blocks pages and APIs), the home tiles, the tool header and
// the Claude connector (filters its tools).
//
//   live  – in production use, everyone who can sign in
//   test  – ready to test, open to the test group
//   dev   – in development, admins only
//   plan  – planned, admins only

export type ReleaseStatus = "live" | "test" | "dev" | "plan";
export type Role = "admin" | "tester" | "editor";

export const STATUS_LABEL: Record<ReleaseStatus, string> = {
  live: "Live · Production",
  test: "Ready to test · Staging",
  dev: "In development",
  plan: "Planned",
};

// Tool key → status, the paths it owns and the connector tools it uses.
export const RELEASE: Record<string, { status: ReleaseStatus; paths: string[]; mcp?: RegExp }> = {
  "/utm": { status: "live", paths: ["/utm"] },
  "/assets": { status: "test", paths: ["/assets", "/api/assets"], mcp: /^(asset_|library_|knowledge_|learn_person$)/ },
  "/seo": { status: "test", paths: ["/seo", "/api/seo"], mcp: /^seo_/ },
  "/photobook": { status: "test", paths: ["/photobook", "/api/photobook", "/api/zine"] },
  "/teamcards": { status: "dev", paths: ["/teamcards", "/api/teamcards", "/api/sitemap", "/api/captures"], mcp: /^(teamcard_|sitemap_|sitecopy_)/ },
  "/images": { status: "plan", paths: ["/images"] },
};

// The test group (Oct 2026). TESTER_EMAILS (comma-separated) replaces it on the server.
export const DEFAULT_TESTERS = ["bpi@slash.digital", "hvb@slash.digital", "jko@slash.digital", "el@slash.digital"];

export function canUseStatus(role: Role | undefined, status: ReleaseStatus): boolean {
  if (role === "admin") return true;
  return status === "live" || status === "test";
}

export function canUseTool(role: Role | undefined, key: string): boolean {
  const r = RELEASE[key];
  return r ? canUseStatus(role, r.status) : role === "admin";
}

// For the middleware: is this path part of a tool the role may not open?
export function blockedPath(role: Role | undefined, pathname: string): boolean {
  if (role === "admin") return false;
  for (const r of Object.values(RELEASE))
    if (r.paths.some((p) => pathname === p || pathname.startsWith(p + "/"))) return !canUseStatus(role, r.status);
  return false;
}

// For the connector: may this role call that MCP tool? Tools no release claims stay admin-only.
export function canUseMcpTool(role: Role | undefined, name: string): boolean {
  if (role === "admin") return true;
  const r = Object.values(RELEASE).find((x) => x.mcp?.test(name));
  return r ? canUseStatus(role, r.status) : false;
}
