"use client";

// Sign-in in SLASH.DIGITAL's look (as the Xmas calendar gate): near-black
// ground, light headline, one red accent, a glass card bottom left. Behind
// it the living Ktulu ASCII field; the AF1-KTULU wordmark flickers through
// fonts and settles. Covers the app chrome (header, sidebar) while signed out.
import { Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import KtuluLogo from "../components/KtuluLogo";
import Wordmark from "../components/Wordmark";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "That account isn't allowed in yet. Sign-in is for slash.digital accounts on the access list.",
};

// Only ever bounce back to a path on this app, never to an absolute URL
// someone could plant in the query string.
function safeCallback(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function SignIn() {
  const params = useSearchParams();
  const callbackUrl = safeCallback(params.get("callbackUrl"));
  const error = params.get("error");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setBusy(true);
          void signIn("google", { callbackUrl });
        }}
        disabled={busy}
        className="ktulu-google"
      >
        <GoogleIcon />
        {busy ? "Opening Google…" : "Sign in with Google"}
      </button>
      <p role="alert" style={{ marginTop: 10, fontSize: 12, minHeight: 18, color: error ? "#ff6b5b" : "transparent" }}>
        {error ? ERROR_MESSAGES[error] ?? "Couldn't sign you in." : "."}
      </p>
    </>
  );
}

export default function LoginPage() {
  const [h, setH] = useState(0);
  // rendered into <body>: <main> animates with a transform, which would turn
  // position:fixed into "fixed inside main" and leave a strip at the bottom
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  if (!host) return null;
  return createPortal(
    <div className="ktulu-gate">
      <style>{`
        .ktulu-gate { position: fixed; inset: 0; z-index: 2000; display: flex; flex-direction: column; overflow: hidden; background: #000; color: #f5f5f5; font-family: "DM Sans", "Archivo", system-ui, sans-serif; }
        .ktulu-gate .bg { position: absolute; inset: 0; pointer-events: none; }
        .ktulu-gate .bg canvas { position: absolute; inset: 0; border-radius: 0 !important; opacity: .7; mix-blend-mode: screen; width: 100% !important; height: 100% !important; }
        .ktulu-gate .film { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .ktulu-gate .filmshade { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
        .ktulu-gate .shade { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(80% 75% at 25% 75%, rgba(0,0,0,.82), rgba(0,0,0,.35) 70%, rgba(0,0,0,.15)); }
        .ktulu-gate header, .ktulu-gate main, .ktulu-gate footer { position: relative; padding-left: 48px; padding-right: 48px; }
        .ktulu-gate header { display: flex; align-items: center; justify-content: space-between; padding-top: 26px; padding-bottom: 26px; }
        .ktulu-gate main { flex: 1; display: flex; align-items: flex-end; padding-bottom: 18px; }
        .ktulu-gate .card { width: 100%; max-width: 460px; border-radius: 16px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.06); padding: 28px; backdrop-filter: blur(6px) saturate(1.25); -webkit-backdrop-filter: blur(6px) saturate(1.25); box-shadow: 0 30px 80px -30px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.08); }
        .ktulu-gate .eyebrow { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #8c8c8c; }
        .ktulu-gate .mark { margin: 14px 0 6px; transform-origin: left; }
        .ktulu-gate .mark h1 { margin: 0 !important; font-size: 44px !important; }
        .ktulu-gate .lead { font-size: 14px; line-height: 1.6; color: #d6d6d6; margin: 10px 0 20px; }
        .ktulu-gate .ktulu-google { display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: 46px; width: 100%; border-radius: 4px; border: 0; background: #f5f5f5; color: #121212; font-size: 14px; font-weight: 600; cursor: pointer; transition: background .15s, transform .1s; }
        .ktulu-gate .ktulu-google:hover { background: #fff; }
        .ktulu-gate .ktulu-google:active { transform: scale(.98); }
        .ktulu-gate .ktulu-google:focus-visible { outline: 2px solid #e61a1a; outline-offset: 3px; }
        .ktulu-gate .ktulu-google:disabled { opacity: .6; cursor: progress; }
        .ktulu-gate .red { color: #e61a1a; }
        .ktulu-gate footer { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 22px; padding-bottom: 24px; font-size: 12px; color: #8c8c8c; }
        @media (max-width: 640px) { .ktulu-gate header, .ktulu-gate main, .ktulu-gate footer { padding-left: 16px; padding-right: 16px; } .ktulu-gate .mark h1 { font-size: 34px !important; } .ktulu-gate .card { padding: 22px; } }
      `}</style>
      {/* the slash.digital hero film, with the Vapor ASCII field layered on top (screen blend: its black drops out) */}
      <div className="bg" aria-hidden>
        <video className="film" autoPlay muted loop playsInline preload="auto">
          <source src="/videos/slash-hero-mobile.mp4" type="video/mp4" media="(max-width: 767px)" />
          <source src="/videos/slash-hero-desktop.mp4" type="video/mp4" />
        </video>
        <div className="filmshade" />
        {h > 0 && <KtuluLogo source={{ src: "/bg/vapor.jpg", gamma: 1.5, gain: 1.15, fit: "cover" }} height={h} />}
      </div>
      <div className="shade" aria-hidden />

      <header>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/slash-logo.png" alt="SLASH" width={124} height={25} style={{ height: 24, width: "auto" }} />
        <span style={{ fontSize: 12, color: "#8c8c8c", letterSpacing: "0.08em" }}>^(;,;)^ internal tools</span>
      </header>

      <main>
        <div className="card">
          <div className="eyebrow">SLASH.DIGITAL · Audi Revolut F1® Team</div>
          <div className="mark">
            <Wordmark />
          </div>
          <p className="lead">
            The team&apos;s tools for audif1.com: UTM Studio, Asset Uploader, SEO Studio, GP Mini-Zine and more. Sign in with your <span className="red">slash.digital</span> Google account.
          </p>
          <Suspense fallback={null}>
            <SignIn />
          </Suspense>
        </div>
      </main>

      <footer>
        <span>© {new Date().getFullYear()} SLASH.DIGITAL · München</span>
        <span>Internal, not for distribution. All trademarks belong to their owners.</span>
      </footer>
    </div>,
    host
  );
}
