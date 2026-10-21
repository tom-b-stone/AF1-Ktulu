"use client";

// AF1 Asset Tool: the Asset Uploader on the MacBook notch. Download, install,
// connect. The app only collects (images + Grand Prix + folder); the Asset
// Uploader here does the rest.
import { useEffect, useState } from "react";

const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function NotchApp() {
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/assets/notch-token")
      .then((r) => r.json())
      .then((j) => setConnectedAt(j.createdAt ?? null))
      .catch(() => {});
  }, []);

  // a new token goes straight into the app through its link (af1notch://), nothing to paste
  const connect = async () => {
    setBusy(true);
    const j = await fetch("/api/assets/notch-token", { method: "POST" }).then((r) => r.json()).catch(() => ({}));
    setBusy(false);
    if (!j.token) return;
    setToken(j.token);
    setConnectedAt(new Date().toISOString());
    window.location.href = `af1notch://connect?token=${encodeURIComponent(j.token)}`;
  };

  const step: React.CSSProperties = { display: "grid", gridTemplateColumns: "32px minmax(0,1fr)", gap: 14, padding: "16px 0", borderTop: "1px solid var(--border)" };
  const num: React.CSSProperties = { width: 28, height: 28, borderRadius: 99, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, background: "var(--surface)", border: "1px solid var(--border-2)" };
  const p: React.CSSProperties = { margin: "4px 0 0", color: "var(--muted)", fontSize: 14, lineHeight: 1.55 };

  return (
    <div style={{ maxWidth: 760, display: "grid", gap: 20 }}>
      <section className="page-head">
        <div>
          <div className="section-label" style={{ marginBottom: 8 }}>Asset Uploader · Mac app</div>
          <h1>AF1 Asset Tool</h1>
          <p>Drag photos onto the notch of your MacBook, pick the Grand Prix and the folder, and the Asset Uploader opens with everything in place: WebP, alt texts by Claude, names and tags as always.</p>
        </div>
      </section>

      <div>
        <div style={step}>
          <span style={num}>1</span>
          <div>
            <b>Download</b>
            <p style={p}>For Macs with Apple silicon (M1 or newer), macOS 14 or newer.</p>
            <a className="btn btn-primary" href="/downloads/af1-asset-tool.zip" download style={{ marginTop: 10 }}>
              Download AF1 Asset Tool (.zip)
            </a>
          </div>
        </div>
        <div style={step}>
          <span style={num}>2</span>
          <div>
            <b>Install</b>
            <p style={p}>Open the .zip and drag <i>AF1 Asset Tool</i> into your Applications folder.</p>
          </div>
        </div>
        <div style={step}>
          <span style={num}>3</span>
          <div>
            <b>Allow it once</b>
            <p style={p}>
              The app is not from the App Store, so macOS stops it the first time. Open it, click <i>Done</i> in the warning, then go to System Settings → Privacy &amp; Security, scroll down to “AF1 Asset Tool was blocked” and click <i>Open Anyway</i>. From then on it starts normally.
            </p>
          </div>
        </div>
        <div style={step}>
          <span style={num}>4</span>
          <div>
            <b>Connect</b>
            <p style={p}>With the app running, click the button. Your browser hands the app its key; nothing to copy or paste. {connectedAt && <>Last connected {when(connectedAt)}. Connecting again replaces the old key.</>}</p>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
              <button className="btn btn-primary" onClick={() => void connect()} disabled={busy}>
                {busy ? "Connecting …" : connectedAt ? "Connect again" : "Connect the app"}
              </button>
              {token && (
                <button
                  className="btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(token);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Didn't work? Copy the key"}
                </button>
              )}
            </div>
            {token && <p style={{ ...p, fontSize: 13 }}>If the browser asks to open AF1 Asset Tool, allow it. Otherwise copy the key and use “Token …” in the AF1 menu at the top right of your screen.</p>}
          </div>
        </div>
        <div style={step}>
          <span style={num}>5</span>
          <div>
            <b>Use it</b>
            <p style={p}>
              Hover the notch or drag photos onto it. Pick the Grand Prix and the session folder, click <i>Continue in Ktulu</i>. The photos open here in a new batch; Claude writes the alt texts, names follow the rule, then you upload as usual.
            </p>
            <p style={p}>Tip: add the app to System Settings → General → Login Items so it is always there.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
