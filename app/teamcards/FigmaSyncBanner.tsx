"use client";

// Floating note in the Team Card tool: Figma only updates while the AF1 Ktulu
// Sync plugin is open, so when the CMS has changes the Figma board doesn't show
// yet, it offers to open Figma. Only a note: staging is already up to date and
// nothing in the tool waits for Figma. Not shown on a card's own page (Get from
// production, edits …), only in the overview and Figma Sync.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type S = { diffs: { state: string }[]; pending: number; figma: { reportedAt: string } | null; campaign: { key?: string; name?: string; figmaFile: string; figmaPage: string } };

export default function FigmaSyncBanner() {
  const path = usePathname() ?? "";
  const onCard = /^\/teamcards\/(?!figma|lexicon)[^/]+/.test(path);
  const [s, setS] = useState<S | null>(null);
  // "Later" holds for four hours in this browser, so the note doesn't follow you from page to page
  const [hidden, setHidden] = useState(() => {
    try {
      return Date.now() < Number(window.localStorage.getItem("af1-figma-banner-later") || 0);
    } catch {
      return false;
    }
  });
  const later = () => {
    setHidden(true);
    try {
      window.localStorage.setItem("af1-figma-banner-later", String(Date.now() + 4 * 3600_000));
    } catch {}
  };
  // every campaign with a Figma board; the first one that is out of step
  const load = useCallback(async () => {
    const list = await fetch("/api/sitemap/campaigns").then((r) => r.json()).then((j) => (j.campaigns ?? []) as { key: string; figmaFile?: string }[]).catch(() => []);
    for (const c of list.filter((x) => x.figmaFile)) {
      const j = await fetch(`/api/sitemap/${c.key}`).then((r) => r.json()).catch(() => null);
      if (!j?.diffs || !j.figma) continue;
      const n = j.pending + j.diffs.filter((d: { state: string }) => ["cms-newer", "figma-newer", "conflict"].includes(d.state)).length;
      if (n) return setS(j);
    }
    setS(null);
  }, []);
  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("af1:changed", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("af1:changed", onFocus);
    };
  }, [load]);
  if (onCard || !s || hidden || !s.figma) return null;
  const toFigma = s.diffs.filter((d) => d.state === "cms-newer").length + s.pending;
  const fromFigma = s.diffs.filter((d) => d.state === "figma-newer").length;
  const conflicts = s.diffs.filter((d) => d.state === "conflict").length;
  if (!toFigma && !fromFigma && !conflicts) return null;
  const figma = `https://www.figma.com/design/${s.campaign.figmaFile}/WorkingDoc?node-id=${s.campaign.figmaPage.replace(":", "-")}`;
  return (
    <div role="status" style={{ position: "fixed", left: 210, bottom: 24, zIndex: 50, width: 320, padding: 14, borderRadius: 14, background: "var(--bg, #141313)", border: "1px solid var(--accent)", boxShadow: "0 12px 40px rgba(0,0,0,.35)", display: "grid", gap: 10, fontSize: 13 }}>
      <strong>{s.campaign.name ?? "The"} Figma board is behind</strong>
      <div style={{ color: "var(--muted)" }}>
        {toFigma > 0 && <div>{toFigma} change{toFigma === 1 ? "" : "s"} on staging {toFigma === 1 ? "is" : "are"} not on the Figma board yet. Staging is fine; this only keeps the design in step. When you have Figma open, run AF1 Ktulu Sync.</div>}
        {fromFigma > 0 && <div>{fromFigma} change{fromFigma === 1 ? "" : "s"} made in Figma {fromFigma === 1 ? "is" : "are"} waiting for the CMS.</div>}
        {conflicts > 0 && <div>{conflicts} text{conflicts === 1 ? "" : "s"} changed on both sides and need{conflicts === 1 ? "s" : ""} a decision.</div>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {toFigma > 0 && (
          <a className="btn btn-primary" href={figma} target="_blank" rel="noreferrer">
            Open in Figma
          </a>
        )}
        {(fromFigma > 0 || conflicts > 0) && (
          <Link className="btn" href="/teamcards/figma">
            Review
          </Link>
        )}
        <button className="btn" onClick={later}>
          Later
        </button>
      </div>
    </div>
  );
}
