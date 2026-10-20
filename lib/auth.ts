import type { Role } from "./toolAccess";
import { accessOf } from "./accessStore";

// Mirrors UTM Studio's access model (github.com/tom-b-stone/UTM-Studio):
// Google sign-in restricted to the slash.digital domain, with a bootstrap
// admin (tma@slash.digital) and other @slash.digital accounts opened up
// later. Here that "later" is a single env flag instead of a code change.

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "tma@slash.digital")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Role and tool list from the access board (/admin/access).
export async function accessFor(email: string | null | undefined): Promise<{ role: Role; tools: string[] | null; listed: boolean }> {
  return accessOf(email, isAdminEmail(email));
}

const ALLOW_ALL_SLASH_DIGITAL = process.env.ALLOW_ALL_SLASH_DIGITAL === "true";

const ALLOWED_DOMAIN = "slash.digital";

export function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// Whether this @slash.digital account may sign in at all. While
// ALLOW_ALL_SLASH_DIGITAL is off (the default), only admins can get in —
// flip that env var once ready to open it to the rest of the team.
export async function isAllowedEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  if (emailDomain(email) !== ALLOWED_DOMAIN) return false;
  if (isAdminEmail(email)) return true;
  if ((await accessFor(email)).listed) return true;
  return ALLOW_ALL_SLASH_DIGITAL;
}

export { ALLOWED_DOMAIN };
