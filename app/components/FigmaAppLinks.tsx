"use client";

// Figma links open in the Figma desktop app (the AF1 Ktulu Sync plugin only
// runs there). Every click on a figma.com/design|file link is sent to the
// figma:// protocol; when the app does not take it (no blur within 1.5 s),
// the link opens in the browser as before.
import { useEffect } from "react";

export function figmaAppUrl(href: string): string | null {
  try {
    const u = new URL(href);
    if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/(design|file|board|proto)\/([^/]+)(\/[^?]*)?/);
    if (!m) return null;
    return `figma://${m[1] === "board" ? "board" : "file"}/${m[2]}${m[3] ?? ""}${u.search}`;
  } catch {
    return null;
  }
}

export default function FigmaAppLinks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const app = figmaAppUrl(a.href);
      if (!app) return;
      e.preventDefault();
      let left = false;
      const gone = () => (left = true);
      window.addEventListener("blur", gone, { once: true });
      document.addEventListener("visibilitychange", gone, { once: true });
      window.location.href = app;
      setTimeout(() => {
        window.removeEventListener("blur", gone);
        document.removeEventListener("visibilitychange", gone);
        if (!left) window.open(a.href, "_blank", "noopener");
      }, 1500);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
