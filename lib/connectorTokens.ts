// Personal connector tokens for the AF1 Tools MCP endpoint (/api/mcp/<token>).
//
// Each signed-in user mints their own token on /connector and pastes the
// resulting URL into claude.ai (Settings → Connectors → Add custom
// connector). The token stands in for the user: every tool call made
// through it is attributed to their email at the app layer. Only a SHA-256
// of the token is stored, so a KV dump never yields a usable URL.
import { createHash, randomBytes } from "crypto";
import { kvGet, kvSet, kvDel } from "./kv";

type TokenRecord = { email: string; createdAt: string };

const tokenKey = (hash: string) => `connector:token:${hash}`;
const userKey = (email: string) => `connector:user:${email.toLowerCase()}`;

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createConnectorToken(email: string): Promise<string> {
  // Replace any previous token for this user so there's only ever one live.
  await revokeConnectorToken(email);
  const token = randomBytes(24).toString("base64url");
  const record: TokenRecord = { email, createdAt: new Date().toISOString() };
  await kvSet(tokenKey(hash(token)), JSON.stringify(record));
  await kvSet(userKey(email), hash(token));
  return token;
}

export async function revokeConnectorToken(email: string): Promise<void> {
  const existing = await kvGet(userKey(email));
  if (existing) {
    await kvDel(tokenKey(existing));
    await kvDel(userKey(email));
  }
}

export async function connectorStatus(email: string): Promise<{ active: boolean; createdAt: string | null }> {
  const h = await kvGet(userKey(email));
  if (!h) return { active: false, createdAt: null };
  const raw = await kvGet(tokenKey(h));
  if (!raw) return { active: false, createdAt: null };
  return { active: true, createdAt: (JSON.parse(raw) as TokenRecord).createdAt };
}

export async function resolveConnectorToken(token: string): Promise<TokenRecord | null> {
  if (!token || token.length < 16) return null;
  const raw = await kvGet(tokenKey(hash(token)));
  return raw ? (JSON.parse(raw) as TokenRecord) : null;
}

// Figma plugin tokens (AF1 Ktulu Sync). Same idea, separate keys, so minting
// one never breaks the claude.ai connector link.
const pluginTokenKey = (h: string) => `figmaplugin:token:${h}`;
const pluginUserKey = (email: string) => `figmaplugin:user:${email.toLowerCase()}`;

export async function createPluginToken(email: string): Promise<string> {
  const old = await kvGet(pluginUserKey(email));
  if (old) await kvDel(pluginTokenKey(old));
  const token = randomBytes(24).toString("base64url");
  await kvSet(pluginTokenKey(hash(token)), JSON.stringify({ email, createdAt: new Date().toISOString() }));
  await kvSet(pluginUserKey(email), hash(token));
  return token;
}

export async function pluginTokenStatus(email: string): Promise<string | null> {
  const h = await kvGet(pluginUserKey(email));
  if (!h) return null;
  const raw = await kvGet(pluginTokenKey(h));
  return raw ? (JSON.parse(raw) as TokenRecord).createdAt : null;
}

// Accepts a plugin token, or the connector token as a fallback.
export async function resolvePluginToken(token: string): Promise<TokenRecord | null> {
  if (!token || token.length < 16) return null;
  const raw = await kvGet(pluginTokenKey(hash(token)));
  if (raw) return JSON.parse(raw) as TokenRecord;
  return resolveConnectorToken(token);
}

// AF1 Notch Mac app tokens (Asset Uploader). Separate keys again: connecting
// the Mac app never breaks the Figma plugin or the claude.ai connector.
const notchTokenKey = (h: string) => `notch:token:${h}`;
const notchUserKey = (email: string) => `notch:user:${email.toLowerCase()}`;

export async function createNotchToken(email: string): Promise<string> {
  const old = await kvGet(notchUserKey(email));
  if (old) await kvDel(notchTokenKey(old));
  const token = randomBytes(24).toString("base64url");
  await kvSet(notchTokenKey(hash(token)), JSON.stringify({ email, createdAt: new Date().toISOString() }));
  await kvSet(notchUserKey(email), hash(token));
  return token;
}

export async function notchTokenStatus(email: string): Promise<string | null> {
  const h = await kvGet(notchUserKey(email));
  if (!h) return null;
  const raw = await kvGet(notchTokenKey(h));
  return raw ? (JSON.parse(raw) as TokenRecord).createdAt : null;
}

export async function resolveNotchToken(token: string): Promise<TokenRecord | null> {
  if (!token || token.length < 16) return null;
  const raw = await kvGet(notchTokenKey(hash(token)));
  return raw ? (JSON.parse(raw) as TokenRecord) : null;
}
