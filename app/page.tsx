"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { toolLink } from "./components/ToolHeader";
import { RELEASE, STATUS_LABEL, canUseTool, type ReleaseStatus, type Role } from "@/lib/toolAccess";
import HomeBackground, { useBackgroundChoice } from "./components/HomeBackground";
import HomeFooter from "./components/HomeFooter";
import HomeTile from "./components/HomeTile";
import SuggestionTile from "./components/SuggestionTile";
import Wordmark from "./components/Wordmark";

// Tag colours: AF1 lava red for what's live, the vapor palette (purple /
// pink from the background image) for the rest. Same tokens in globals.css.
// The status itself comes from lib/toolAccess (one place for every tool).
const STATUS: Record<ReleaseStatus, { label: string; bg: string; fg: string; border: string }> = {
  live: { label: STATUS_LABEL.live, bg: "rgba(255,45,0,0.14)", fg: "var(--accent)", border: "rgba(255,45,0,0.4)" },
  test: { label: STATUS_LABEL.test, bg: "rgba(111,207,124,0.12)", fg: "#8fdc98", border: "rgba(111,207,124,0.4)" },
  dev: { label: STATUS_LABEL.dev, bg: "rgba(200,117,181,0.14)", fg: "var(--vapor-pink)", border: "rgba(200,117,181,0.4)" },
  plan: { label: STATUS_LABEL.plan, bg: "rgba(112,86,167,0.16)", fg: "var(--vapor-lilac)", border: "rgba(112,86,167,0.45)" },
};

const TILES: { title: string; href: string; key: string; external?: boolean; text: string }[] = [
  {
    title: "SEO Studio",
    href: "/seo",
    key: "/seo",
    text: "Meta titles and descriptions for news and pages, EN and DE. Your Claude writes, the tool publishes.",
  },
  {
    title: "Asset Uploader",
    href: "/assets",
    key: "/assets",
    text: "Drop photos, compress, name, alt text, upload to the right CMS folder.",
  },
  {
    title: "GP Mini-Zine",
    href: "/photobook",
    key: "/photobook",
    text: "GP Mini-Zine: print, fold, colour in, share via QR. Prototype.",
  },
  {
    title: "Team Card Configurator",
    href: "/teamcards",
    key: "/teamcards",
    text: "All Team Cards, guided editing with a live journey preview, and a helper for bulk changes in EN and DE.",
  },
  {
    title: "CRM Images",
    href: "/images",
    key: "/images",
    text: "Cropped, rounded variants for the CRM email templates.",
  },
  {
    title: "UTM Studio",
    href: "https://af1-utm-studio.vercel.app/",
    key: "/utm",
    external: true,
    text: "Campaign links with UTM tags. Opens in its own tab for now.",
  },
];

export default function Home() {
  const [bg, setBg] = useBackgroundChoice();
  const { data: session } = useSession();
  const role = (session?.user as { role?: Role } | undefined)?.role;
  const tools = (session?.user as { tools?: string[] | null } | undefined)?.tools ?? null;
  return (
    <div style={{ maxWidth: 880, margin: "0 auto", paddingTop: 8, position: "relative", zIndex: 1 }}>
      <HomeBackground choice={bg} />
      {/* Everything after the background sits in its own layer: the fixed
          canvas is a positioned z-0 element inside this container, so
          unpositioned text would otherwise paint underneath it. */}
      <div style={{ position: "relative", zIndex: 2 }}>

      <div style={{ textAlign: "center", marginTop: 24 }}>
        <div
          role="img"
          aria-label="Audi Revolut F1 Team"
          className="af1-logo"
          style={{ width: 48, height: 44, margin: "0 auto", background: "var(--accent)" }}
        />
      </div>

      <Wordmark />
      <div
        aria-hidden
        style={{
          textAlign: "center",
          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          fontSize: 20,
          fontWeight: 300,
          color: "var(--vapor-rose)",
          letterSpacing: "0.1em",
          opacity: 0.9,
          margin: "0 0 6px",
        }}
      >
        ^(;,;)^
      </div>
      <p style={{ textAlign: "center", margin: 0, opacity: 0.85, fontSize: 14, textShadow: "0 1px 12px rgba(0,0,0,0.9)" }}>
        Internal tools for audif1.com
      </p>

      <div className="section-label reveal" style={{ marginTop: 48, marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
        <span>Tools</span>
        <span>{TILES.length}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 26, rowGap: 34 }}>
        {TILES.map((t, i) => {
          const full = canUseTool(role, t.key, tools);
          // Team Cards: people with only Figma Sync open that part
          const figmaOnly = !full && t.key === "/teamcards" && !!toolLink({ href: t.href, key: t.key, name: t.title, status: "staging", text: t.text }, role, tools);
          return (
            <div key={t.key} className={`reveal reveal-d${(i % 6) + 1}`} style={{ display: "flex" }}>
              <HomeTile
                title={t.title}
                href={full ? t.href : figmaOnly ? "/teamcards/figma" : undefined}
                tileKey={t.key}
                external={t.external}
                status={STATUS[RELEASE[figmaOnly ? "/figma" : t.key]?.status ?? "dev"]}
                text={full ? t.text : figmaOnly ? "Figma Sync: the Figma plugin and campaign boards. The card editor opens for the test group once it is ready to test." : `${t.text} Opens for the test group once it is ready to test.`}
              />
            </div>
          );
        })}
      </div>
      <div className="reveal reveal-d5" style={{ marginTop: 34 }}>
        <SuggestionTile />
      </div>

      <p
        style={{
          fontSize: 13,
          color: "rgba(245,245,245,0.8)",
          lineHeight: 1.7,
          margin: "28px auto 0",
          maxWidth: "100%",
          textAlign: "center",
          background: "rgba(4,6,14,0.7)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "12px 16px",
          backdropFilter: "blur(2px)",
        }}
      >
        <span style={{ color: "var(--vapor-rose)" }}>*</span> <strong>Ktulu</strong> (n.), short, simplified spelling of{" "}
        <em>Cthulhu</em>: an ancient, god-like cosmic entity that sleeps in the sunken city of R&apos;lyeh. It reaches into
        the dreams of humans and is worshipped by a cult spread across the world. Its existence exceeds human
        understanding, and those who witness it are often driven to madness.
      </p>
      <HomeFooter bg={bg} onBg={setBg} />
      </div>
    </div>
  );
}
