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
export const TOOL_LABEL: Record<string, string> = {
  "/utm": "UTM Studio",
  "/assets": "Asset Uploader",
  "/seo": "SEO Studio",
  "/photobook": "GP Mini-Zine",
  "/teamcards": "Team Cards",
  "/images": "CRM Images",
};

export const RELEASE: Record<string, { status: ReleaseStatus; paths: string[]; mcp?: RegExp }> = {
  "/utm": { status: "live", paths: ["/utm"] },
  "/assets": { status: "test", paths: ["/assets", "/api/assets"], mcp: /^(asset_|library_|knowledge_|learn_person$)/ },
  "/seo": { status: "test", paths: ["/seo", "/api/seo"], mcp: /^seo_/ },
  "/photobook": { status: "test", paths: ["/photobook", "/api/photobook", "/api/zine"] },
  "/teamcards": { status: "dev", paths: ["/teamcards", "/api/teamcards", "/api/sitemap", "/api/captures"], mcp: /^(teamcard_|sitemap_|sitecopy_)/ },
  "/images": { status: "plan", paths: ["/images"] },
};

// The first test group (Oct 2026): seeds the access board in /admin/access once.
// After that the board (KV) is the source of truth.
export const DEFAULT_TESTERS = ["bpi@slash.digital", "hvb@slash.digital", "jko@slash.digital", "el@slash.digital", "ap@slash.digital"];

export function canUseStatus(role: Role | undefined, status: ReleaseStatus): boolean {
  if (role === "admin") return true;
  return status === "live" || status === "test";
}

// tools = the per-person list from the admin access board (testers); without
// one the release status decides. Admins see everything.
export function canUseTool(role: Role | undefined, key: string, tools?: string[] | null): boolean {
  if (role === "admin") return true;
  if (tools) return tools.includes(key);
  const r = RELEASE[key];
  return r ? canUseStatus(role, r.status) : false;
}

// The tools a new tester gets by default: everything live or ready to test.
export function defaultTesterTools(): string[] {
  return Object.entries(RELEASE)
    .filter(([, r]) => r.status === "live" || r.status === "test")
    .map(([k]) => k);
}

// For the middleware: is this path part of a tool the person may not open?
export function blockedPath(role: Role | undefined, pathname: string, tools?: string[] | null): boolean {
  if (role === "admin") return false;
  for (const [key, r] of Object.entries(RELEASE))
    if (r.paths.some((p) => pathname === p || pathname.startsWith(p + "/"))) return !canUseTool(role, key, tools);
  return false;
}

// For the connector: may this person call that MCP tool? Tools no release claims stay admin-only.
export function canUseMcpTool(role: Role | undefined, name: string, tools?: string[] | null): boolean {
  if (role === "admin") return true;
  const hit = Object.entries(RELEASE).find(([, x]) => x.mcp?.test(name));
  return hit ? canUseTool(role, hit[0], tools) : false;
}
