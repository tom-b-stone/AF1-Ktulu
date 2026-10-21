"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import KtuluLogo from "./KtuluLogo";
import MorphIcon, { MORPH_PRESETS } from "./MorphIcon";
import { canUseTool, type Role } from "@/lib/toolAccess";

// The app header (Neuron-style sticky bar): AF1-KTULU wordmark on a strip
// of the living ASCII field, a Tools menu in the middle that switches
// between tools, environment + account on the right. Switching tools lives
// here; the sidebar is reserved for navigation inside the current tool.
export const TOOLS: { href: string; key: string; name: string; status: "working" | "staging" | "planned" | "external"; external?: boolean; text: string }[] = [
  { href: "/seo", key: "/seo", name: "SEO Studio", status: "staging", text: "Meta titles + descriptions, EN/DE" },
  { href: "/assets", key: "/assets", name: "Asset Uploader", status: "working", text: "Compress, name, alt text, upload" },
  { href: "/photobook", key: "/photobook", name: "GP Mini-Zine", status: "staging", text: "GP zine to print, fold and colour in + fan page" },
  { href: "/teamcards", key: "/teamcards", name: "Team Card Configurator", status: "staging", text: "Cards, guided edit, journey preview, helper" },
  { href: "/images", key: "/images", name: "CRM Images", status: "planned", text: "Email template image variants" },
  { href: "/coverage", key: "/coverage", name: "Race Coverage", status: "planned", text: "Race weekend coverage (placeholder)" },
  { href: "https://af1-utm-studio.vercel.app/", key: "/utm", name: "UTM Studio", status: "external", external: true, text: "Campaign links (own app)" },
];

export const STATUS_STYLE: Record<string, { fg: string; border: string; bg: string }> = {
  working: { fg: "var(--accent)", border: "rgba(255,45,0,0.4)", bg: "rgba(255,45,0,0.12)" },
  staging: { fg: "var(--vapor-pink)", border: "rgba(200,117,181,0.4)", bg: "rgba(200,117,181,0.12)" },
  planned: { fg: "var(--vapor-lilac)", border: "rgba(112,86,167,0.45)", bg: "rgba(112,86,167,0.14)" },
  external: { fg: "var(--vapor-lilac)", border: "rgba(112,86,167,0.45)", bg: "rgba(112,86,167,0.14)" },
};

// Team Cards also opens for people who only have Figma Sync: straight to that page
export function toolLink(t: (typeof TOOLS)[number], role: Role | undefined, tools: string[] | null) {
  if (canUseTool(role, t.key, tools)) return t;
  if (t.key === "/teamcards" && canUseTool(role, "/figma", tools)) return { ...t, href: "/teamcards/figma" };
  return null;
}

export function currentTool(pathname: string) {
  if (pathname.startsWith("/admin")) return { href: "/admin", key: "/admin", name: "Admin", status: "working" as const, text: "" };
  if (pathname.startsWith("/connector")) return { href: "/connector", key: "/connector", name: "Claude connector", status: "working" as const, text: "" };
  return TOOLS.find((t) => !t.external && (pathname === t.key || pathname.startsWith(t.key + "/"))) ?? null;
}

export default function ToolHeader() {
  const pathname = usePathname() ?? "/";
  const { data: session } = useSession();
  if (pathname === "/" || pathname === "/login" || !session) return null;

  const tool = currentTool(pathname);
  const isAdmin = (session.user as { role?: string } | undefined)?.role === "admin";

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 64,
        overflow: "visible",
        borderBottom: "1px solid var(--border)",
        background: "#000",
      }}
    >
      <div style={{ position: "absolute", inset: 0, opacity: 0.5, overflow: "hidden" }}>
        <KtuluLogo source={{ src: "/bg/vapor.jpg", gamma: 1.5, gain: 1.2, fit: "cover" }} height={64} />
      </div>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(90deg, rgba(12,13,14,0.95) 0%, rgba(12,13,14,0.7) 40%, rgba(12,13,14,0.55) 100%)",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 32px",
        }}
      >
        {/* Wordmark */}
        <Link
          href="/"
          style={{
            textDecoration: "none",
            color: "#fff",
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "0.14em" }}>
            AF1<span style={{ color: "var(--accent)" }}>-</span>KTULU
          </span>
          <span style={{ fontSize: 12, color: "var(--vapor-rose)", letterSpacing: "0.08em" }}>^(;,;)^</span>
        </Link>

        {/* Tools: a row of rotating 3D icons. Hover extends the pill
            horizontally and reveals the name; the current tool stays open. */}
        <nav aria-label="Tools" style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 10 }}>
          {TOOLS.map((t) => toolLink(t, (session.user as { role?: Role } | undefined)?.role, (session.user as { tools?: string[] | null } | undefined)?.tools ?? null)).filter((t): t is (typeof TOOLS)[number] => !!t).map((t) => {
            const active = tool?.key === t.key;
            const preset = MORPH_PRESETS[t.key] ?? {};
            const inner = (
              <>
                <MorphIcon size={30} {...preset} />
                <span className="tool-pill-label">
                  {t.name}
                  {t.external && <span style={{ opacity: 0.5, marginLeft: 4 }}>↗</span>}
                </span>
              </>
            );
            const cls = `tool-pill${active ? " is-active" : ""}`;
            return t.external ? (
              <a key={t.key} href={t.href} target="_blank" rel="noreferrer" className={cls} title={t.name}>
                {inner}
              </a>
            ) : (
              <Link key={t.key} href={t.href} className={cls} title={t.name}>
                {inner}
              </Link>
            );
          })}
        </nav>

        {/* Right: environment + account */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, fontSize: 12 }}>
          <span style={{ color: "var(--muted)", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11 }}>
            CMS: staging.audif1team.com
          </span>
          <Link
            href={`/suggest?from=${encodeURIComponent(pathname)}`}
            title="Missing something or found a bug? Tell us."
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(255,45,0,0.45)", background: "rgba(255,45,0,0.12)", color: "#fff", textDecoration: "none", fontSize: 12 }}
          >
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z" />
            </svg>
            Add an idea
          </Link>
          <Link href="/connector" className="link-line" style={{ color: "var(--muted)" }}>
            Connector
          </Link>
          {isAdmin && (
            <Link href="/admin/credentials" className="link-line" style={{ color: "var(--muted)" }}>
              Admin
            </Link>
          )}
          <span
            title={session.user?.email ?? ""}
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: "var(--surface)",
              border: "1px solid var(--border-2)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-heading)",
              fontSize: 12,
              textTransform: "uppercase",
            }}
          >
            {(session.user?.email ?? "?").slice(0, 2)}
          </span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, fontSize: 12 }}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
