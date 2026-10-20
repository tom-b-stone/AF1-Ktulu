"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { currentTool } from "./ToolHeader";
import { useSidebarSlot } from "./SidebarSlot";

// In-tool navigation. Switching between tools happens in the header's Tools
// menu; this column only knows about the tool you're in: its views, its
// settings, its help. Each tool registers its entries here.
type Entry = { href: string; label: string; note?: string; hint?: string; exact?: boolean };
type Section = { title: string; entries: Entry[] };

const SIDEBARS: Record<string, Section[]> = {
  "/seo": [
    {
      title: "Help",
      entries: [{ href: "https://staging.audif1team.com/cms/admin", label: "Open the CMS", note: "↗" }],
    },
  ],
  "/assets": [
    {
      title: "Asset Uploader",
      entries: [
        { href: "/assets", label: "New batch", exact: true },
        { href: "/assets/batches", label: "Batches", note: "7 days" },
        { href: "/assets/knowledge", label: "Team knowledge", note: "people, cues" },
        { href: "/assets/learn", label: "Learn from the library", note: "Claude" },
      ],
    },
    {
      title: "Help",
      entries: [{ href: "https://staging.audif1team.com/cms/admin/collections/media/payload-folders", label: "CMS: Media folders", note: "↗" }],
    },
  ],
  "/photobook": [
    {
      title: "GP Mini-Zine",
      entries: [
        { href: "/photobook", label: "All zines", exact: true },
        { href: "/pitch/gp-mini-zine.html", label: "Pitch deck", note: "full screen" },
        { href: "https://slashlens.netlify.app/", label: "SlashLens", note: "↗" },
      ],
    },
  ],
  "/teamcards": [
    {
      title: "Team Cards",
      entries: [
        { href: "/teamcards", label: "All cards", hint: "Edit texts and see the whole journey", exact: true },
        { href: "/figma", label: "Figma Sync", hint: "Figma ↔ CMS changes, boards, plugin" },
      ],
    },
    {
      title: "Open elsewhere",
      entries: [
        { href: "https://www.figma.com/design/rGxt5J0qhiK759uEbaKgTO/WorkingDoc?node-id=692-56", label: "Figma file", note: "↗", hint: "Opens in the Figma app" },
        { href: "https://staging.audif1team.com/cms/admin/collections/badges", label: "Cards in the CMS", note: "↗", hint: "Staging admin" },
      ],
    },
  ],
  "/figma": [
    {
      title: "Figma Sync",
      entries: [
        { href: "/figma", label: "Changes", hint: "What changed where; approve it", exact: true },
        { href: "/figma#boards", label: "Campaign boards", hint: "One Figma board per campaign" },
        { href: "/figma#plugin", label: "Install the plugin", hint: "Figma desktop, 2 minutes" },
      ],
    },
  ],
  "/images": [{ title: "CRM Images", entries: [{ href: "/images", label: "Overview", exact: true }] }],
  "/connector": [{ title: "Claude connector", entries: [{ href: "/connector", label: "Setup", exact: true }] }],
  "/suggest": [{ title: "Suggestion box", entries: [{ href: "/suggest", label: "Write a suggestion", exact: true }] }],
  "/admin": [
    {
      title: "Admin",
      entries: [
        { href: "/admin/access", label: "Access", note: "test users" },
        { href: "/admin/messages", label: "Message board", note: "suggestions" },
        { href: "/admin/credentials", label: "CMS credentials" },
        { href: "/admin/anthropic", label: "Claude API", note: "in-tool generation" },
      ],
    },
  ],
};

export default function Sidebar() {
  const pathname = usePathname() ?? "/";
  const { data: session } = useSession();
  const slot = useSidebarSlot();
  if (pathname === "/login" || pathname === "/" || !session) return null;

  const tool = currentTool(pathname);
  const sections = (tool && SIDEBARS[tool.key]) ?? [];
  if (sections.length === 0 && !slot) return null;

  return (
    <nav
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        padding: "22px 14px",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      {slot}
      {sections.map((sec) => (
        <div key={sec.title}>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--muted)",
              padding: "0 10px",
              marginBottom: 6,
            }}
          >
            {sec.title}
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 2 }}>
            {sec.entries.map((e) => {
              const external = e.href.startsWith("http") || e.href.startsWith("/api/");
              const active = e.exact ? pathname === e.href : !external && pathname.startsWith(e.href.split("?")[0]) && e.href.split("?")[0] !== tool?.key;
              const style = {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "7px 10px",
                borderRadius: 8,
                textDecoration: "none",
                fontSize: 13,
                color: active ? "#fff" : "var(--fg)",
                background: active ? "var(--surface)" : "transparent",
                border: `1px solid ${active ? "var(--border-2)" : "transparent"}`,
              } as const;
              const inner = (
                <>
                  <span style={{ display: "grid", gap: 1 }}>
                    <span>{e.label}</span>
                    {e.hint && <span style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.3 }}>{e.hint}</span>}
                  </span>
                  {e.note && <span style={{ color: "var(--muted)", fontSize: 11 }}>{e.note}</span>}
                </>
              );
              return (
                <li key={e.href + e.label}>
                  {e.href.endsWith(".html") ? (
                    // static page (e.g. a full-screen pitch deck): plain navigation, same tab
                    <a href={e.href} style={style}>
                      {inner}
                    </a>
                  ) : external ? (
                    <a href={e.href} target="_blank" rel="noreferrer" style={style}>
                      {inner}
                    </a>
                  ) : (
                    <Link href={e.href} style={style}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div style={{ marginTop: "auto", fontSize: 11, color: "var(--muted)", padding: "0 10px" }}>
        env: {process.env.NEXT_PUBLIC_APP_ENV ?? "staging"}
      </div>
    </nav>
  );
}
