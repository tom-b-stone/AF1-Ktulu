import { DEFAULT_TESTERS, type Role } from "./toolAccess";

// Mirrors UTM Studio's access model (github.com/tom-b-stone/UTM-Studio):
// Google sign-in restricted to the slash.digital domain, with a bootstrap
// admin (tma@slash.digital) and other @slash.digital accounts opened up
// later. Here that "later" is a single env flag instead of a code change.

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "tma@slash.digital")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// The test group: may sign in and use the tools that are live or ready to test.
const TESTER_EMAILS = (process.env.TESTER_EMAILS ? process.env.TESTER_EMAILS.split(",") : DEFAULT_TESTERS).map((e) => e.trim().toLowerCase()).filter(Boolean);

export function isTesterEmail(email: string | null | undefined): boolean {
  return !!email && TESTER_EMAILS.includes(email.toLowerCase());
}

export function roleOf(email: string | null | undefined): Role {
  return isAdminEmail(email) ? "admin" : isTesterEmail(email) ? "tester" : "editor";
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
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  if (emailDomain(email) !== ALLOWED_DOMAIN) return false;
  if (isAdminEmail(email) || isTesterEmail(email)) return true;
  return ALLOW_ALL_SLASH_DIGITAL;
}

export { ALLOWED_DOMAIN };
