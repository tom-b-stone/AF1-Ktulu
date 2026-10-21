// Naming rules for the Asset Uploader. Pure functions, used in the browser
// (table) and later by the connector tools, so they live outside app/.
//
// Observed CMS convention (production media, Oct 2026):
//   audif1_2026_MCO_FP1_gallery_26.webp
//   audif1_2026_BEL_GP_day_03_race_quote_03.webp
//   audif1_2026_SIN_GP_burnt-ends-bakery-barista-team-cap.webp
// → audif1_{year}_{LOC}_GP_{context}_{descriptor}_{nn}.webp
// Folder convention: 10_Media-Galleries/2026_R{nn}_{LOC}-GP/{SESSION}

export type ParsedCameraName = {
  round?: number; // R14 → 14
  test?: number; // T02 → 2 (pre-season test)
  loc?: string; // MAD, MONZ, SIN …
  date?: string; // ISO yyyy-mm-dd when derivable
  seq?: string; // trailing counter / time
  raw: string;
};

const LOC_ALIASES: Record<string, string> = {
  MONZ: "ITA",
  MAD: "ESP",
  MEL: "AUS",
  SHA: "CHN",
  SUZ: "JPN",
  MIA: "USA",
  MON: "MCO",
  MTL: "CAN",
  SIL: "GBR",
  SPA: "BEL",
  ZAN: "NED",
  BUD: "HUN",
  BAK: "AZE",
  KUL: "MYS",
};

// R14_MAD_ARF1T_2026_09_12_154409A  |  T02_MONZ_ARF1T04_17_26_013418
export function parseCameraName(filename: string): ParsedCameraName {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  const out: ParsedCameraName = { raw: base };
  const m = base.match(/^([RT])(\d{1,2})_([A-Z]{2,5})_/i);
  if (m) {
    if (m[1].toUpperCase() === "R") out.round = Number(m[2]);
    else out.test = Number(m[2]);
    out.loc = m[3].toUpperCase();
  }
  // ISO-ish date: _2026_09_12_
  const iso = base.match(/_(20\d{2})_(\d{2})_(\d{2})(?:_|$)/);
  if (iso) out.date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else {
    // US-ish date glued to a tag: ARF1T04_17_26 → 2026-04-17
    const us = base.match(/(\d{2})_(\d{2})_(\d{2})_\d{4,}/);
    if (us) out.date = `20${us[3]}-${us[1]}-${us[2]}`;
  }
  const seq = base.match(/_(\d{4,}[A-Z]?)$/i);
  if (seq) out.seq = seq[1];
  return out;
}

export function canonicalLoc(loc?: string): string | undefined {
  if (!loc) return undefined;
  const u = loc.toUpperCase();
  return LOC_ALIASES[u] ?? u;
}

export const CONTEXTS = ["gallery", "hero", "teaser", "quote", "recap", "wallpaper", "postcard", "racetrack"] as const;
export type Context = (typeof CONTEXTS)[number];

// lowercase, hyphens, 2–6 words, ascii only (no umlaut transcription: ü stays
// out, so "Hulkenberg" not "Huelkenberg")
export function cleanDescriptor(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
}

// Context (hero, teaser, quote …) is an optional add-on: only in the name
// when the image is made for that slot. Picked up from the original file
// name when it carries one ("…_hero_02.jpg").
export function contextFromName(filename: string): Context | "" {
  const m = filename.toLowerCase().match(/(?:^|[_\-\s])(gallery|hero|teaser|quote|recap|wallpaper|postcard|racetrack)(?:[_\-\s.]|$)/);
  return (m?.[1] as Context) ?? "";
}

// Fallback descriptor from an alt text when Claude didn't give one: the
// first meaningful words, team name and filler dropped.
const STOP = new Set(["a", "an", "the", "of", "in", "on", "at", "to", "and", "with", "for", "from", "by", "his", "her", "their", "its", "during", "before", "after", "while", "audi", "revolut", "f1", "team", "grand", "prix", "gp"]);
export function descriptorFromAlt(alt: string): string {
  const words = alt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  return cleanDescriptor(words.slice(0, 5).join("-"));
}

export function proposeFileName(opts: { year: number; loc: string; context?: Context | ""; descriptor?: string; nn: number; ext?: string }): string {
  const parts = ["audif1", String(opts.year), opts.loc.toUpperCase(), "GP"];
  if (opts.context) parts.push(opts.context);
  const d = opts.descriptor ? cleanDescriptor(opts.descriptor) : "";
  if (d) parts.push(d);
  // the number only when a name would repeat (same name in the folder or twice in a batch); 0 = none
  if (opts.nn > 0) parts.push(String(opts.nn).padStart(2, "0"));
  return `${parts.join("_")}.${opts.ext ?? "webp"}`;
}

export function proposeFolder(opts: { year: number; round?: number; test?: number; loc: string; session?: string }): string {
  const base =
    opts.round != null
      ? `${opts.year}_R${String(opts.round).padStart(2, "0")}_${opts.loc.toUpperCase()}-GP`
      : opts.test != null
        ? `${opts.year}_R00_Pre-Season/T${String(opts.test).padStart(2, "0")}_${opts.loc.toUpperCase()}`
        : `${opts.year}_General_Topics`;
  return opts.session ? `${base}/${opts.session}` : base;
}

export const SESSIONS = ["THU", "FRI", "FP1", "FP2", "FP3", "Qualifying", "Sprint", "Race", "Postcards", "Challenge", "Wallpaper", "Off-Track"] as const;

export const ALT_MAX = 125;

export function validateAlt(alt: string): string[] {
  const issues: string[] = [];
  if (!alt.trim()) issues.push("Alt text is empty");
  if (alt.length > ALT_MAX) issues.push(`Alt text is ${alt.length} chars (max ${ALT_MAX})`);
  if (/—/.test(alt)) issues.push("Em-dash not allowed");
  // Team name: exactly "Audi Revolut F1® Team", nothing else, ever.
  if (/\bAudi F1 Team\b|\bAF1 Team\b|\bAF1\b|Audi-F1|\bARF1T\b|\bAudi Revolut Team\b|\bAudi F1\b(?! ®)/.test(alt)) issues.push('Team name is only "Audi Revolut F1® Team"');
  if (/Audi Revolut F1 Team/.test(alt)) issues.push('Missing ® : "Audi Revolut F1® Team"');
  if (/Hülkenberg|Huelkenberg/.test(alt)) issues.push('Use "Nico Hulkenberg" (no umlaut in English alt text)');
  return issues;
}

// Spelling checks driven by team knowledge: an alias that is a known wrong
// form (multi-word, or with non-ASCII letters) found in the alt text while
// the official name is absent. Single-word nicknames ("Nico") are left alone.
export function knowledgeIssues(alt: string, entries: { name: string; aliases?: string[]; active: boolean; kind: string }[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (!e.active || !e.aliases) continue;
    for (const a of e.aliases) {
      const suspicious = a.includes(" ") || /[^\x00-\x7f]/.test(a);
      if (!suspicious || a === e.name) continue;
      if (alt.includes(a) && !alt.includes(e.name)) out.push(`Use "${e.name}" not "${a}"`);
    }
  }
  return out;
}
