// Server-only: who may sign in as a tester and which tools each person sees.
// Edited on /admin/access; stored in KV. Admins come from ADMIN_EMAILS and
// always see everything. Seeded once from DEFAULT_TESTERS.
import { kvGet, kvSet } from "./kv";
import { DEFAULT_TESTERS, RELEASE, defaultTesterTools, type Role } from "./toolAccess";

const KEY = "access:users:v1";
export type AccessUser = { email: string; tools: string[]; addedAt: string; addedBy: string };

const norm = (e: string) => e.trim().toLowerCase();

// Tools released to everyone after the board was set up are added to every
// listed person once; after that the board decides (remove it per person).
const ADDED_LATER = ["/figma"];

export async function listAccess(): Promise<AccessUser[]> {
  const raw = await kvGet(KEY).catch(() => null);
  if (raw) {
    const list = JSON.parse(raw) as AccessUser[];
    for (const t of ADDED_LATER) {
      const flag = `access:added:${t}`;
      if (await kvGet(flag).catch(() => "x")) continue;
      list.forEach((u) => { if (!u.tools.includes(t)) u.tools.push(t); });
      await kvSet(KEY, JSON.stringify(list)).catch(() => {});
      await kvSet(flag, new Date().toISOString()).catch(() => {});
    }
    return list;
  }
  const now = new Date().toISOString();
  const seeded = DEFAULT_TESTERS.map((email) => ({ email: norm(email), tools: defaultTesterTools(), addedAt: now, addedBy: "seed" }));
  await kvSet(KEY, JSON.stringify(seeded)).catch(() => {});
  return seeded;
}

export async function saveAccess(email: string, tools: string[], by: string): Promise<AccessUser[]> {
  const e = norm(email);
  if (!/^[^@\s]+@slash\.digital$/.test(e)) throw new Error("Only @slash.digital addresses");
  const valid = tools.filter((t) => t in RELEASE);
  const list = await listAccess();
  const hit = list.find((u) => u.email === e);
  if (hit) hit.tools = valid;
  else list.push({ email: e, tools: valid, addedAt: new Date().toISOString(), addedBy: by });
  list.sort((a, b) => a.email.localeCompare(b.email));
  await kvSet(KEY, JSON.stringify(list));
  return list;
}

export async function removeAccess(email: string): Promise<AccessUser[]> {
  const list = (await listAccess()).filter((u) => u.email !== norm(email));
  await kvSet(KEY, JSON.stringify(list));
  return list;
}

// role + tool list for a signed-in address (tools null = decided by release status)
export async function accessOf(email: string | null | undefined, isAdmin: boolean): Promise<{ role: Role; tools: string[] | null; listed: boolean }> {
  if (isAdmin) return { role: "admin", tools: null, listed: true };
  const hit = email ? (await listAccess()).find((u) => u.email === norm(email)) : undefined;
  return hit ? { role: "tester", tools: hit.tools, listed: true } : { role: "editor", tools: null, listed: false };
}
