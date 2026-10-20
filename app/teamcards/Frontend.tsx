"use client";

// Recreations of the audif1.com frontend views a Team Card appears in, built
// from the live site (Monaco race page, Oct 2026): module grey-01 #E0DDDD,
// graphite engagement box, light popup with the lava button. Every text is
// editable in place (WYSIWYG); edits go to the record, not the site.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { Loc } from "@/lib/teamCardFields";
import { NOT_DEFINED, cardTemplate } from "@/lib/cardTemplate";

export const AF = { chalk: "#F5F2F2", grey01: "#E0DDDD", graphite: "#2B2929", graphite2: "#423F3F", lava: "#E33E1A", mute: "#767373", light: "#B3AFAF", popup: "#E6E3E3" };
const BACKSIDE = "https://www.audif1.com/_next/image?url=%2Fbadge-backside.png&w=1200&q=75";

type Vals = Record<string, { en?: string; de?: string } | string | boolean | undefined>;
export type EditCtx = {
  vals: Vals;
  lang: Loc;
  focus?: string;
  issues: Record<string, string[]>; // key → issues for the current language
  onEdit: (key: string, value: string) => void;
  onFocus: (key: string) => void;
  imageUrl?: string;
  engagementImageUrl?: string;
};

const textOf = (c: EditCtx, k: string) => {
  const v = c.vals[k];
  if (v && typeof v === "object") return v[c.lang] ?? "";
  return typeof v === "string" ? v : "";
};

// one editable text on a screen
export function E({ c, k, style, ph, block = true }: { c: EditCtx; k: string; style?: CSSProperties; ph?: string; block?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const value = textOf(c, k);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerText !== value) el.innerText = value;
  }, [value, c.lang]);
  const bad = (c.issues[k] ?? []).length > 0;
  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-ph={ph ?? "Click to write"}
      className="wys"
      onFocus={() => c.onFocus(k)}
      onInput={(e) => c.onEdit(k, (e.currentTarget as HTMLSpanElement).innerText.replace(/\n$/, ""))}
      title={(c.issues[k] ?? []).join(" · ") || undefined}
      style={{
        display: block ? "block" : "inline",
        outline: c.focus === k ? `2px solid ${AF.lava}` : undefined,
        outlineOffset: 3,
        borderRadius: 4,
        whiteSpace: "pre-wrap",
        textDecoration: bad ? `underline wavy ${AF.lava}` : undefined,
        textUnderlineOffset: 4,
        ...style,
      }}
    />
  );
}

export function WysStyles() {
  return (
    <style>{`
      .wys{cursor:text;transition:outline-color .15s}
      .wys:hover{outline:1px dashed rgba(227,62,26,.55)}
      .wys:empty:before{content:attr(data-ph);opacity:.4}
      .af-frame{font-family:var(--font-heading);color:${AF.graphite};border-radius:14px;overflow:hidden;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.25)}
    `}</style>
  );
}

const Pill = ({ children, bg, fg, border }: { children: ReactNode; bg: string; fg: string; border?: string }) => (
  <span style={{ display: "inline-block", padding: "8px 18px", borderRadius: 999, background: bg, color: fg, fontSize: 14, border: border ? `1px solid ${border}` : undefined }}>{children}</span>
);

const CardImg = ({ src, w, tilt = 0, back = false }: { src?: string; w: number; tilt?: number; back?: boolean }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={back ? BACKSIDE : src || cardTemplate()} alt="" style={{ width: w, display: "block", borderRadius: w / 18, transform: `rotate(${tilt}deg)`, boxShadow: "0 30px 40px -20px rgba(0,0,0,.45)" }} />
);

// ---- 1 module on the page ------------------------------------------------
export function ModuleView({ c, earned = false }: { c: EditCtx; earned?: boolean }) {
  const bgKey = String(c.vals.modBackground ?? "grey-01");
  const bg = bgKey === "graphite" ? AF.graphite : bgKey === "chalk" ? AF.chalk : bgKey === "lava" ? AF.lava : AF.grey01;
  const fg = bgKey === "graphite" || bgKey === "lava" ? AF.chalk : AF.graphite;
  return (
    <div style={{ background: bg, color: fg, padding: "48px 40px", display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 32, alignItems: "center" }}>
      <div>
        <E c={c} k="modCategory" ph="Category" style={{ fontSize: 14 }} />
        <E c={c} k="modHeadline" ph="Headline" style={{ fontSize: 34, lineHeight: "46px", marginTop: 10 }} />
        <E c={c} k="modSubline" ph="Subline (optional)" style={{ fontSize: 16, marginTop: 8, opacity: 0.8 }} />
        <E c={c} k="modCopy" ph="Copy" style={{ fontSize: 15, lineHeight: "24px", marginTop: 16, opacity: 0.9 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <CardImg src={c.imageUrl} w={220} tilt={-6} back={!earned} />
      </div>
    </div>
  );
}

// ---- 2 engagement box (Q&A) ----------------------------------------------
export function EngagementView({ c }: { c: EditCtx }) {
  return (
    <div style={{ background: AF.grey01, padding: "8px 40px 48px" }}>
      <div style={{ background: AF.graphite, borderRadius: 14, padding: 40, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, color: AF.chalk }}>
        <div>
          <E c={c} k="question" ph="Your question to the fans" style={{ fontSize: 22, lineHeight: "32px" }} />
          <div style={{ marginTop: 18, height: 100, borderRadius: 10, background: AF.graphite2 }} />
          <div style={{ fontSize: 10, color: AF.light, textAlign: "right", marginTop: 6 }}>{c.lang === "de" ? "200 Zeichen übrig" : "200 characters left"}</div>
          <div style={{ marginTop: 12 }}>
            <Pill bg={AF.grey01} fg={AF.mute}>
              <E c={c} k="submitLabel" ph="Button" block={false} />
            </Pill>
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.engagementImageUrl ? <img src={c.engagementImageUrl} alt="" style={{ width: "100%", height: 220, objectFit: "cover", borderRadius: 10 }} /> : <div style={{ background: AF.graphite2, borderRadius: 10 }} />}
      </div>
    </div>
  );
}

// popup shell, as on the site (light card, close x, lava button)
function Popup({ children, dim = true }: { children: ReactNode; dim?: boolean }) {
  return (
    <div style={{ background: dim ? "rgba(43,41,41,.55)" : AF.grey01, padding: "36px 0", display: "flex", justifyContent: "center" }}>
      <div style={{ width: 320, background: AF.popup, borderRadius: 18, padding: "18px 24px 24px", position: "relative", textAlign: "center" }}>
        <span style={{ position: "absolute", right: 16, top: 14, width: 24, height: 24, borderRadius: 99, border: `1px solid ${AF.graphite}`, fontSize: 12, lineHeight: "22px" }}>✕</span>
        {children}
      </div>
    </div>
  );
}

// ---- after the answer ----------------------------------------------------
export function OverlayView({ c }: { c: EditCtx }) {
  return (
    <Popup>
      <div style={{ height: 8 }} />
      <E c={c} k="overlayTitle" ph="Title" style={{ fontSize: 20, lineHeight: "28px", marginTop: 16 }} />
      <div style={{ height: 1, background: AF.light, margin: "12px 0" }} />
      <E c={c} k="overlaySubtitle" ph="One more step: log in…" style={{ fontSize: 13, lineHeight: "20px" }} />
      <div style={{ marginTop: 18 }}>
        <Pill bg={AF.lava} fg="#fff">{c.lang === "de" ? "Anmelden oder registrieren" : "Login or register"}</Pill>
      </div>
    </Popup>
  );
}

export function PostView({ c }: { c: EditCtx }) {
  return (
    <div style={{ background: AF.grey01, padding: "8px 40px 40px" }}>
      <div style={{ background: AF.graphite, color: AF.chalk, borderRadius: 14, padding: 40 }}>
        <div style={{ fontSize: 26 }}>✓</div>
        <E c={c} k="postTitle" ph="Title after the answer" style={{ fontSize: 22, lineHeight: "32px", marginTop: 8 }} />
        <E c={c} k="postMessage" ph="Message after the answer" style={{ fontSize: 14, lineHeight: "22px", marginTop: 10, color: AF.light }} />
      </div>
    </div>
  );
}

export function ShareView({ c }: { c: EditCtx }) {
  return (
    <div style={{ background: AF.chalk, padding: 28 }}>
      <div style={{ maxWidth: 380, margin: "0 auto", background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 6px 20px rgba(0,0,0,.08)" }}>
        <div style={{ fontSize: 11, color: AF.mute }}>WhatsApp · Facebook · X · Copy link</div>
        <E c={c} k="shareTitle" ph="Share title" style={{ fontSize: 16, fontWeight: 600, marginTop: 10 }} />
        <E c={c} k="shareText" ph="Share text" style={{ fontSize: 13, lineHeight: "20px", marginTop: 6 }} />
        <div style={{ fontSize: 11, color: AF.lava, marginTop: 8 }}>audif1.com/…</div>
      </div>
    </div>
  );
}

// ---- 3 logged-out reveal (the site's popup) ------------------------------
export function RevealView({ c }: { c: EditCtx }) {
  return (
    <Popup>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 26 }}>
        <CardImg src={c.imageUrl} w={210} />
      </div>
      <div style={{ fontSize: 10, color: AF.mute, margin: "10px 0" }}>● ○</div>
      <E c={c} k="revealTitle" ph="Reveal title" style={{ fontSize: 20, lineHeight: "28px" }} />
      <div style={{ height: 1, background: AF.light, margin: "12px 0" }} />
      <E c={c} k="revealDescription" ph="Reveal description" style={{ fontSize: 13, lineHeight: "20px" }} />
      <div style={{ marginTop: 18 }}>
        <Pill bg={AF.lava} fg="#fff">
          <E c={c} k="revealButton" ph="Button" block={false} />
        </Pill>
      </div>
    </Popup>
  );
}

// ---- 4 collected popup ---------------------------------------------------
export function CollectedView({ c }: { c: EditCtx }) {
  return (
    <Popup>
      <E c={c} k="badgePopupTitle" ph="Popup title (max 6 words)" style={{ fontSize: 12, marginTop: 8, color: AF.mute }} />
      <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
        <CardImg src={c.imageUrl} w={200} />
      </div>
      <E c={c} k="publicTitle" ph="Card title" style={{ fontSize: 20, lineHeight: "28px", marginTop: 14 }} />
      <div style={{ height: 1, background: AF.light, margin: "12px 0" }} />
      <E c={c} k="rewardDescription" ph="What the fan got (max 20 words)" style={{ fontSize: 13, lineHeight: "20px" }} />
    </Popup>
  );
}

// ---- 5 profile collection ------------------------------------------------
export function CollectionView({ c, earned }: { c: EditCtx; earned: boolean }) {
  return (
    <div style={{ background: AF.chalk, padding: 32 }}>
      <div style={{ fontSize: 12, color: AF.mute, marginBottom: 14 }}>{c.lang === "de" ? "Meine Team Cards" : "My Team Cards"} · {earned ? (c.lang === "de" ? "gesammelt" : "collected") : c.lang === "de" ? "noch nicht gesammelt" : "not collected yet"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 28, alignItems: "start" }}>
        <CardImg src={c.imageUrl} w={200} back={!earned} />
        <div>
          <E c={c} k="publicTitle" ph="Card title" style={{ fontSize: 24, lineHeight: "32px" }} />
          {earned ? (
            <E c={c} k="description" ph="One line about the card" style={{ fontSize: 15, lineHeight: "24px", marginTop: 10 }} />
          ) : (
            <>
              <E c={c} k="rewardTeaser" ph="How to get it (max 20 words)" style={{ fontSize: 15, lineHeight: "24px", marginTop: 10 }} />
              <div style={{ marginTop: 16 }}>
                <Pill bg={c.vals.ctaVariant === "primary" || !c.vals.ctaVariant ? AF.graphite : "transparent"} fg={c.vals.ctaVariant === "primary" || !c.vals.ctaVariant ? AF.chalk : AF.graphite} border={AF.graphite}>
                  <E c={c} k="ctaLabel" ph="Button" block={false} />
                </Pill>
              </div>
              <div style={{ fontSize: 11, color: AF.mute, marginTop: 10 }}>
                {c.lang === "de" ? "Screenreader liest:" : "Screen reader reads:"} <E c={c} k="ctaA11y" ph="What the button does" block={false} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- 6 reward ------------------------------------------------------------
export function RewardView({ rewardType }: { rewardType?: string }) {
  const t = rewardType ?? "noReward";
  const box = (title: string, on: boolean, text: string) => (
    <div style={{ flex: 1, borderRadius: 14, padding: 22, background: on ? "#fff" : "repeating-linear-gradient(45deg,#f3f0f0,#f3f0f0 10px,#ebe7e7 10px,#ebe7e7 20px)", color: on ? AF.graphite : AF.mute, minHeight: 150 }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 13, marginTop: 8, lineHeight: "20px" }}>{text}</div>
    </div>
  );
  return (
    <div style={{ background: AF.chalk, padding: 28, display: "flex", gap: 16 }}>
      {box("Raffle", t === "raffleSignup", t === "raffleSignup" ? "Sign-up form with terms and a confirmation." : "Not part of this card.")}
      {box("Voucher", t === "couponCode", t === "couponCode" ? "Code shown after collecting." : "Not part of this card.")}
      {box("Just the card", t === "noReward", t === "noReward" ? "The card itself is the reward. This card works this way." : "This card has a reward.")}
    </div>
  );
}

// ---- card popup, as in the final designs (AF1_External_Board, 261001_AF1_Badges:
// Overlay/Badge Default · Congrats · Earned, front and back) ---------------
export function Phone({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
      <div style={{ width: 340, minHeight: 660, background: AF.graphite, borderRadius: 28, padding: "22px 22px 26px", position: "relative", color: AF.chalk, fontFamily: "var(--font-heading)", boxShadow: "0 12px 40px rgba(0,0,0,.35)", display: "flex", flexDirection: "column" }}>
        <span style={{ position: "absolute", right: 20, top: 20, width: 28, height: 28, borderRadius: 99, border: `1px solid ${AF.chalk}`, fontSize: 13, lineHeight: "26px", textAlign: "center" }}>✕</span>
        {children}
      </div>
      <div style={{ fontSize: 11, color: "#b3afaf" }}>{label}</div>
    </div>
  );
}

const Dots = ({ i }: { i: 0 | 1 }) => (
  <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
    {[0, 1].map((n) => (
      <span key={n} style={{ width: 7, height: 7, borderRadius: 9, background: n === i ? "#fff" : "#6b6767" }} />
    ))}
  </div>
);

const BigBtn = ({ children }: { children: ReactNode }) => (
  <div style={{ marginTop: 18, background: "#FF3B13", color: "#fff", borderRadius: 999, padding: "13px 18px", textAlign: "center", fontSize: 16 }}>{children}</div>
);

export function CardFront({ c, title, text, button, buttonText, label, dim = false }: { c: EditCtx; title: string; text: string; button?: string; buttonText?: string; label: string; dim?: boolean }) {
  return (
    <Phone label={label}>
      <div style={{ marginTop: 44, display: "flex", justifyContent: "center" }}>
        <CardImg src={c.imageUrl} w={260} back={dim} />
      </div>
      <div style={{ flex: 1 }} />
      <E c={c} k={title} ph="Title" style={{ fontSize: 24, lineHeight: "32px", textAlign: "center", marginTop: 22 }} />
      <E c={c} k={text} ph="Text" style={{ fontSize: 14, lineHeight: "22px", textAlign: "center", marginTop: 8, color: "#e9e6e6" }} />
      <BigBtn>{button ? <E c={c} k={button} ph="Button" block={false} /> : buttonText}</BigBtn>
      <Dots i={0} />
    </Phone>
  );
}

export function CardBack({ c, text, button, buttonText, label, typeLabel, race }: { c: EditCtx; text: string; button?: string; buttonText?: string; label: string; typeLabel?: string; race?: string }) {
  const de = c.lang === "de";
  const cell = (h: string, v: string, todo = false) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.04em", color: AF.light }}>{h}</div>
      <div style={{ fontSize: 14, marginTop: 4, minHeight: 18, ...(!v && todo ? { opacity: 0.55, fontStyle: "italic" } : {}) }}>{v || (todo ? NOT_DEFINED[de ? "de" : "en"] : "")}</div>
    </div>
  );
  return (
    <Phone label={label}>
      <div style={{ marginTop: 44, background: "#3D3A3A", borderRadius: 14, padding: "18px 14px 26px" }}>
        <div style={{ textAlign: "center", fontSize: 19 }}>{de ? "Team Card Details" : "Team Card Details"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          {cell(de ? "TYP" : "CARD TYPE", typeLabel ?? "", true)}
          {cell(de ? "RENNEN" : "RACE", race ?? "", true)}
          {cell(de ? "EINGELÖST" : "REDEEMED", "")}
          {cell(de ? "GESAMMELT AM" : "DATE EARNED", "")}
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <E c={c} k={text} ph="Text" style={{ fontSize: 14, lineHeight: "22px", textAlign: "center", color: "#e9e6e6" }} />
      <BigBtn>{button ? <E c={c} k={button} ph="Button" block={false} /> : buttonText}</BigBtn>
      <Dots i={1} />
    </Phone>
  );
}

// trophy shelf in the profile (chalk page, graphite panel, 2-column grid)
export function ShelfView({ c, earned }: { c: EditCtx; earned: boolean }) {
  const de = c.lang === "de";
  const tile = (img: ReactNode, name: ReactNode, mark: "check" | "plus") => (
    <div>
      <div style={{ borderRadius: 8, overflow: "hidden", background: "#3D3A3A", aspectRatio: "300/374" }}>{img}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginTop: 6, fontSize: 14 }}>
        <div style={{ flex: 1 }}>{name}</div>
        <span style={{ width: 18, height: 18, borderRadius: 99, flexShrink: 0, background: mark === "check" ? "#FF3B13" : "transparent", border: mark === "check" ? "none" : "1px solid #FF3B13", color: mark === "check" ? "#fff" : "#FF3B13", fontSize: 11, lineHeight: "18px", textAlign: "center" }}>{mark === "check" ? "✓" : "+"}</span>
      </div>
    </div>
  );
  // eslint-disable-next-line @next/next/no-img-element
  const mine = <img src={earned ? c.imageUrl || cardTemplate(undefined, c.lang === "de" ? "de" : "en") : BACKSIDE} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: earned ? undefined : "grayscale(1) blur(2px) opacity(.7)" }} />;
  return (
    <div style={{ background: AF.chalk, padding: "32px 24px", fontFamily: "var(--font-heading)", color: AF.graphite, borderRadius: 14, maxWidth: 420, margin: "0 auto" }}>
      <div style={{ color: "#FF3B13", fontSize: 14 }}>{de ? "Sammle die Team Cards" : "Collect the Team Cards"}</div>
      <div style={{ fontSize: 26, lineHeight: "34px", marginTop: 8 }}>{de ? "Deine Team Card Collection" : "Your Team Card collection"}</div>
      <div style={{ background: AF.graphite, borderRadius: 18, padding: 16, marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, color: AF.chalk }}>
        {tile(mine, <E c={c} k="publicTitle" ph="Card title" />, earned ? "check" : "plus")}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {tile(<img src={BACKSIDE} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.5 }} />, <span style={{ opacity: 0.6 }}>{de ? "Nächste Team Card" : "Next Team Card"}</span>, "plus")}
      </div>
    </div>
  );
}
