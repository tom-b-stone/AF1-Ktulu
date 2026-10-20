// OAuth 2.1 for the company-wide "AF1 Tools" connector (MCP authorization).
//
// One connector URL for everyone (https://<app>/api/mcp). An organisation
// owner adds it once in Claude (Organization settings → Connectors); each
// person clicks Connect, signs in with Google here (the same login as the
// website) and Claude gets a token that stands for that person. Tool rights
// come from the access board on every call, as with the personal links.
//
// Pieces: client registration (dynamic, or a client ID metadata document
// URL), authorization code with PKCE (S256), access tokens (8 h) and
// rotating refresh tokens (90 days). Only SHA-256 hashes of codes and tokens
// are stored in KV.
import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { kvDel, kvGet, kvSet, kvSetEx } from "./kv";

export const ACCESS_TTL = 8 * 3600;
const REFRESH_TTL = 90 * 24 * 3600;
const CODE_TTL = 300;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const b64url = (b: Buffer) => b.toString("base64url");
const rand = () => randomBytes(32).toString("base64url");

export function originOf(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
};

export function serverMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["tools"],
    client_id_metadata_document_supported: true,
    service_documentation: `${origin}/connector`,
  };
}

export function resourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["tools"],
    resource_name: "AF1 Tools",
    resource_documentation: `${origin}/connector`,
  };
}

// ---- clients -------------------------------------------------------------------
export type Client = { client_id: string; client_name?: string; redirect_uris: string[]; created_at: string };
const kClient = (id: string) => `oauth:client:${id}`;

const okRedirect = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || ((x.protocol === "http:") && (x.hostname === "localhost" || x.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
};

export async function registerClient(body: { redirect_uris?: unknown; client_name?: unknown }): Promise<Client> {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || !uris.every(okRedirect)) throw new Error("redirect_uris must be https URLs");
  const c: Client = { client_id: `af1_${rand().slice(0, 24)}`, client_name: typeof body.client_name === "string" ? body.client_name.slice(0, 80) : undefined, redirect_uris: uris, created_at: new Date().toISOString() };
  await kvSet(kClient(c.client_id), JSON.stringify(c));
  return c;
}

// a registered client, or a client whose ID is the URL of its metadata document
export async function getClient(id: string): Promise<Client | null> {
  if (!id) return null;
  if (/^https:\/\//.test(id)) {
    const cached = await kvGet(kClient(sha(id)));
    if (cached) return JSON.parse(cached) as Client;
    try {
      const r = await fetch(id, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!r.ok) return null;
      const d = (await r.json()) as { client_id?: string; client_name?: string; redirect_uris?: string[] };
      if (d.client_id !== id || !Array.isArray(d.redirect_uris)) return null;
      const c: Client = { client_id: id, client_name: d.client_name, redirect_uris: d.redirect_uris.filter(okRedirect), created_at: new Date().toISOString() };
      await kvSetEx(kClient(sha(id)), JSON.stringify(c), 24 * 3600);
      return c;
    } catch {
      return null;
    }
  }
  const raw = await kvGet(kClient(id));
  return raw ? (JSON.parse(raw) as Client) : null;
}

// ---- authorization codes ----------------------------------------------------------
type Code = { email: string; client_id: string; redirect_uri: string; challenge: string; scope: string; resource?: string };
const kCode = (c: string) => `oauth:code:${sha(c)}`;

export async function createCode(c: Code): Promise<string> {
  const code = rand();
  await kvSetEx(kCode(code), JSON.stringify(c), CODE_TTL);
  return code;
}

// ---- tokens --------------------------------------------------------------------
type Grant = { email: string; client_id: string; scope: string; exp: number };
const kAccess = (t: string) => `oauth:access:${sha(t)}`;
const kRefresh = (t: string) => `oauth:refresh:${sha(t)}`;

async function issue(email: string, client_id: string, scope: string) {
  const access = rand();
  const refresh = rand();
  const now = Math.floor(Date.now() / 1000);
  await kvSetEx(kAccess(access), JSON.stringify({ email, client_id, scope, exp: now + ACCESS_TTL } satisfies Grant), ACCESS_TTL);
  await kvSetEx(kRefresh(refresh), JSON.stringify({ email, client_id, scope, exp: now + REFRESH_TTL } satisfies Grant), REFRESH_TTL);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope };
}

export class OAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function exchangeCode(p: { code?: string; code_verifier?: string; redirect_uri?: string; client_id?: string }) {
  if (!p.code || !p.code_verifier) throw new OAuthError("invalid_request", "code and code_verifier are required");
  const raw = await kvGet(kCode(p.code));
  if (!raw) throw new OAuthError("invalid_grant", "unknown or expired code");
  await kvDel(kCode(p.code)); // single use
  const c = JSON.parse(raw) as Code;
  if (p.client_id && p.client_id !== c.client_id) throw new OAuthError("invalid_grant", "client mismatch");
  if (p.redirect_uri && p.redirect_uri !== c.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri mismatch");
  if (b64url(createHash("sha256").update(p.code_verifier).digest()) !== c.challenge) throw new OAuthError("invalid_grant", "PKCE check failed");
  return issue(c.email, c.client_id, c.scope);
}

export async function refreshGrant(p: { refresh_token?: string; client_id?: string }) {
  if (!p.refresh_token) throw new OAuthError("invalid_request", "refresh_token is required");
  const raw = await kvGet(kRefresh(p.refresh_token));
  if (!raw) throw new OAuthError("invalid_grant", "unknown or expired refresh token");
  const g = JSON.parse(raw) as Grant;
  if (p.client_id && p.client_id !== g.client_id) throw new OAuthError("invalid_grant", "client mismatch");
  await kvDel(kRefresh(p.refresh_token)); // rotate
  return issue(g.email, g.client_id, g.scope);
}

export async function resolveAccessToken(token: string): Promise<{ email: string } | null> {
  if (!token || token.length < 20) return null;
  const raw = await kvGet(kAccess(token));
  if (!raw) return null;
  const g = JSON.parse(raw) as Grant;
  return g.exp > Date.now() / 1000 ? { email: g.email } : null;
}
