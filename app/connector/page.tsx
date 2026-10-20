"use client";

import ConnectorOnboarding from "@/app/components/ConnectorOnboarding";

import { useEffect, useState } from "react";

type Status = { active: boolean; createdAt: string | null; persistent: boolean };

// Setup page for the "AF1 Tools" Claude connector. Mints a personal URL the
// user pastes into claude.ai once; after that Claude can publish SEO (and,
// later, use the other tools) by itself instead of handing back a link.
export default function ConnectorPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [replay, setReplay] = useState(false);
  const [copiedCo, setCopiedCo] = useState(false);
  const [companyUrl, setCompanyUrl] = useState("https://af1-ktulu.vercel.app/api/mcp");
  useEffect(() => setCompanyUrl(`${window.location.origin}/api/mcp`), []);

  const refresh = () =>
    fetch("/api/connector")
      .then((r) => r.json())
      .then(setStatus);

  useEffect(() => {
    refresh();
  }, []);

  async function mint() {
    if (status?.active && !confirm("You already have a connector URL. Making a new one stops the old one working. Continue?")) return;
    setBusy(true);
    const res = await fetch("/api/connector", { method: "POST" });
    const json = await res.json();
    setUrl(json.url ?? null);
    setBusy(false);
    refresh();
  }

  async function revoke() {
    if (!confirm("Stop the connector? Claude will no longer be able to publish for you until you make a new URL.")) return;
    setBusy(true);
    await fetch("/api/connector", { method: "DELETE" });
    setUrl(null);
    setBusy(false);
    refresh();
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the URL is visible to select by hand.
    }
  }

  const code = { background: "#161617", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", fontSize: 12, wordBreak: "break-all" as const };
  const btn = (primary: boolean) => ({
    padding: "8px 14px",
    borderRadius: 6,
    border: primary ? "none" : "1px solid var(--border)",
    background: primary ? "var(--accent)" : "none",
    color: primary ? "#fff" : "var(--fg)",
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.6 : 1,
    fontSize: 13,
  });

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ marginBottom: 4 }}>Claude connector</h1>
      <button className="btn" onClick={() => setReplay(true)} style={{ marginBottom: 12 }}>
        Open the step-by-step setup
      </button>
      {replay && <ConnectorOnboarding force onClose={() => setReplay(false)} />}
      <p style={{ opacity: 0.7, fontSize: 13, marginTop: 0 }}>
        Lets Claude (claude.ai) use the AF1 tools directly. With it, &quot;Generate SEO title&quot; ends with Claude
        publishing the text itself, no link to click.
      </p>

      {status && !status.persistent && (
        <div style={{ border: "1px solid #a36a00", background: "#2a1f00", color: "#ffc670", padding: "10px 12px", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          No KV store is configured — a connector URL made here will stop working on the next redeploy.
        </div>
      )}

      <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", margin: "20px 0 8px", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <b style={{ fontSize: 15 }}>Company connector</b>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>One connector for everyone at SLASH, sign in with Google</span>
        </div>
        <div style={code}>{companyUrl}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => void navigator.clipboard.writeText(companyUrl).then(() => { setCopiedCo(true); setTimeout(() => setCopiedCo(false), 2000); }).catch(() => {})} style={btn(false)}>
            {copiedCo ? "Copied" : "Copy"}
          </button>
        </div>
        <ol style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
          <li>
            <b>Owner, once:</b> claude.ai → Organization settings → Connectors → Add → Custom → Web. Name <b>AF1 Tools</b>, URL above, authentication: sign in when needed. Claude finds the sign-in by itself.
          </li>
          <li>
            <b>Everyone:</b> claude.ai → Customize → Connectors → AF1 Tools → <b>Connect</b>, sign in with Google, click Allow.
          </li>
          <li>Each person gets their own tools from the access board, and every action is logged under their email.</li>
        </ol>
      </section>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>Personal link instead (the older way, still works)</summary>
      <h2 style={{ fontSize: 15, marginTop: 24 }}>1. Make your personal connector URL</h2>
      {status?.active && !url && (
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          You have an active connector URL{status.createdAt ? ` (made ${new Date(status.createdAt).toLocaleString()})` : ""}. It is
          only shown once; if you lost it, make a new one.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={mint} disabled={busy} style={btn(true)}>
          {status?.active ? "Make a new URL" : "Make my URL"}
        </button>
        {status?.active && (
          <button onClick={revoke} disabled={busy} style={btn(false)}>
            Stop connector
          </button>
        )}
      </div>
      {url && (
        <div>
          <div style={code}>{url}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <button onClick={copy} style={btn(false)}>
              {copied ? "Copied" : "Copy"}
            </button>
            <span style={{ fontSize: 12, opacity: 0.6 }}>This is personal, like a password. It is shown only now.</span>
          </div>
        </div>
      )}

      <h2 style={{ fontSize: 15, marginTop: 28 }}>2. Add it in claude.ai</h2>
      <ol style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 20 }}>
        <li>
          Open <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer">claude.ai → Settings → Connectors</a>.
        </li>
        <li>
          Click <strong>Add custom connector</strong>. Name: <strong>AF1 Tools</strong>. URL: paste the one from step 1. Click Add.
        </li>
        <li>No sign-in window appears — the URL itself is your key.</li>
      </ol>

      <h2 style={{ fontSize: 15, marginTop: 28 }}>3. Use it</h2>
      <p style={{ fontSize: 13, lineHeight: 1.7 }}>
        In SEO Studio, click <strong>Generate SEO title</strong> as before. Claude opens, writes the text and publishes it itself —
        the chat says &quot;Done. SEO written to …&quot;. The first time, claude.ai asks whether to allow &quot;AF1 Tools&quot;:
        choose <strong>Always allow</strong>, not &quot;Allow once&quot;, otherwise every single page needs a click in bulk
        runs. You can change that later under Settings → Connectors → AF1 Tools. People without the connector keep getting
        the Publish link instead; nothing breaks for them.
      </p>
      <p style={{ fontSize: 12, opacity: 0.6 }}>
        What Claude can do through it: list pages missing SEO, read a page&apos;s content, publish SEO text (same brand-rule
        checks as the edit drawer, publication date always preserved). Every action is logged under your email.
      </p>
      </details>
    </div>
  );
}
