"use client";

// Floating prompt in the Team Card tool: Figma only updates while the AF1
// Ktulu Sync plugin is open, so when the tool or the CMS changed something
// that Figma doesn't show yet, ask the person to open Figma.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type S = { diffs: { state: string }[]; pending: number; figma: { reportedAt: string } | null; campaign: { figmaFile: string; figmaPage: string } };

export default function FigmaSyncBanner() {
  const [s, setS] = useState<S | null>(null);
  const [hidden, setHidden] = useState(false);
  const load = useCallback(() => {
    fetch("/api/sitemap/sin")
      .then((r) => r.json())
      .then((j) => (j.diffs ? setS(j) : null))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("af1:changed", onFocus);
    const t = setInterval(load, 60000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("af1:changed", onFocus);
      clearInterval(t);
    };
  }, [load]);
  if (!s || hidden || !s.figma) return null;
  const toFigma = s.diffs.filter((d) => d.state === "cms-newer").length + s.pending;
  const fromFigma = s.diffs.filter((d) => d.state === "figma-newer").length;
  const conflicts = s.diffs.filter((d) => d.state === "conflict").length;
  if (!toFigma && !fromFigma && !conflicts) return null;
  const figma = `https://www.figma.com/design/${s.campaign.figmaFile}/WorkingDoc?node-id=${s.campaign.figmaPage.replace(":", "-")}`;
  return (
    <div role="status" style={{ position: "fixed", right: 24, bottom: 24, zIndex: 50, width: 360, padding: 16, borderRadius: 14, background: "var(--bg, #141313)", border: "1px solid var(--accent)", boxShadow: "0 12px 40px rgba(0,0,0,.35)", display: "grid", gap: 10, fontSize: 13 }}>
      <strong>Figma isn&apos;t in sync</strong>
      <div style={{ color: "var(--muted)" }}>
        {toFigma > 0 && <div>{toFigma} change{toFigma === 1 ? "" : "s"} from the tool or the CMS {toFigma === 1 ? "is" : "are"} not in Figma yet. Open Figma and run AF1 Ktulu Sync. It applies them right away and stays live while it&apos;s open.</div>}
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
        <button className="btn" onClick={() => setHidden(true)}>
          Later
        </button>
      </div>
    </div>
  );
}
