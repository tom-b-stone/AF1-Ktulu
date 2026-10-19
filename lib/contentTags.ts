// Content tags for the Asset Uploader. Pure functions + the production
// vocabulary (audif1.com `content-tags`, Oct 2026, 105 titles), used in the
// browser (batch page), the upload route and the connector tools.
//
// How production tags its photos (3,000 newest media analysed):
//   every GP photo:   "2026" + "gp | <gp> | <circuit>" + weekday + session
//   plus per photo:   people ("nico hulkenberg", "mattia binotto", …) and a
//                     scene: "on-track & garage" | "team" | "off-track"
//   wallpapers:       "2026 | <city> | wallpaper" / "… | premium wallpaper"
//   DDP / academy:    "driver development program" + the driver's tag
// Tags are stored on a batch/row by TITLE (ids differ between staging and
// production); they are resolved to staging ids at upload.

export const PROD_TAG_TITLES: string[] = [
  "2026",
  "2026 | baku | premium wallpaper",
  "2026 | baku | wallpaper",
  "2026 | barcelona | wallpaper",
  "2026 | best-of | wallpaper",
  "2026 | budapest | wallpaper",
  "2026 | madrid | premium wallpaper",
  "2026 | madrid | wallpaper",
  "2026 | monaco | wallpaper",
  "2026 | monza | premium wallpaper",
  "2026 | monza | wallpaper",
  "2026 | sepang | premium wallpaper",
  "2026 | silverstone | wallpaper",
  "2026 | singapore | premium wallpaper",
  "2026 | spa | wallpaper",
  "2026 | spielberg | wallpaper",
  "2026 | zandvoort | premium wallpaper",
  "2026 | zandvoort | wallpaper",
  "adidas miami collection",
  "adidas singapore collection",
  "adidas-elevated-fanwear-collection",
  "all-in-series",
  "allan mcnish",
  "arrival",
  "audi nuvolari",
  "bahrain testweeks",
  "barcelona shakedown",
  "burnt ends",
  "carrie schreiner",
  "coffee+sweets",
  "do not use – delete f1 academy",
  "driver development program",
  "dutch gp arrival",
  "dutch gp driver arrival",
  "dutch gp fan forum",
  "dutch_gp_arrival",
  "dutch_gp_qualifying",
  "dutch_gp_sprint_race",
  "emma felbermayr",
  "featured",
  "ff",
  "first moments",
  "fp1",
  "fp2",
  "fp3",
  "freddie slater",
  "friday",
  "gabriel bortoleto",
  "gp | austrailian gp | melbourne",
  "gp | austrian gp | spielberg",
  "gp | azerbaijan gp | baku",
  "gp | bahrain gp | sepang",
  "gp | barcelona gp | barcelona-catalunya",
  "gp | belgian gp | spa",
  "gp | british gp | silverstone",
  "gp | canadian gp | montreal",
  "gp | chinese gp | shanghai",
  "gp | dutch gp | zandvoort",
  "gp | hungarian gp | hungaroring",
  "gp | italian gp | monza",
  "gp | japanese gp | suzuka",
  "gp | miami gp | miami",
  "gp | monaco gp | monte carlo",
  "gp | singapore gp | marina bay",
  "gp | spanish gp | madrid",
  "james key",
  "jonathan wheatley",
  "lockedwp",
  "mad fri",
  "mad sat",
  "mad sun",
  "mad thu",
  "mattia binotto",
  "miami-wallpaper-2026",
  "ned_gp",
  "ned_gp_fp1",
  "nico hulkenberg",
  "nogallery",
  "off-track",
  "on-track & garage",
  "partnerlogo",
  "paul aron",
  "pit stop practice",
  "premium wallpaper",
  "r16_bahrain_gp",
  "race",
  "race qualifying",
  "revolut",
  "saturday",
  "sin food guide",
  "singapore campaign",
  "sinsuit2",
  "slater season finale",
  "special race suites",
  "sprint qualifying",
  "sprint race",
  "sunday",
  "team",
  "the-challenge-series",
  "thursday",
  "tuesday",
  "video",
  "wallpaper",
  "wednesday",
  "wip - do not use",
];

export type ContentTag = { id: string; title: string };

export const SCENE_TAGS = ["on-track & garage", "team", "off-track"] as const;
export type Scene = (typeof SCENE_TAGS)[number];

// Team rule (Tom, Oct 2026): a photo is EITHER "team" OR "on-track & garage", never both.
//   "team"              = one or two people are the focus of the picture
//   "on-track & garage" = the car, the crew at work or the action on track is the subject
export const SCENE_RULE =
  'Never "team" and "on-track & garage" together, it is one or the other: "team" when one or two people are the focus of the picture, "on-track & garage" when the car, the crew at work or the action on track is the subject.';

// Applies the rule to a tag list: when both are set, the scene Claude saw wins;
// without one, one or two people tagged → "team", otherwise "on-track & garage".
export function oneScene(tags: string[], scene?: string): string[] {
  if (!(tags.includes("team") && tags.includes("on-track & garage"))) return tags;
  const people = tags.filter((t) => isPersonTag(t)).length;
  const keep = scene === "team" || scene === "on-track & garage" ? scene : people >= 1 && people <= 2 ? "team" : "on-track & garage";
  return tags.filter((t) => !((t === "team" || t === "on-track & garage") && t !== keep));
}

export const WEEKDAY_TAGS = ["tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export const SESSION_TAGS = ["fp1", "fp2", "fp3", "race qualifying", "sprint qualifying", "sprint race", "race"];

// Batch session (lib/assetNaming SESSIONS) → weekday + session tags as
// production uses them.
const SESSION_MAP: Record<string, string[]> = {
  THU: ["thursday"],
  FRI: ["friday"],
  FP1: ["friday", "fp1"],
  FP2: ["friday", "fp2"],
  FP3: ["saturday", "fp3"],
  Qualifying: ["saturday", "race qualifying"],
  Sprint: ["saturday", "sprint race"],
  "Sprint Qualifying": ["friday", "sprint qualifying"],
  Race: ["sunday", "race"],
  Postcards: [],
  Challenge: ["the-challenge-series"],
  Wallpaper: ["wallpaper"],
  "Off-Track": ["off-track"],
};

// Grand Prix tag by the 3-letter LOC the tool uses in file names. ESP is
// ambiguous (Madrid vs Barcelona) and is resolved from the race name.
const GP_BY_LOC: Record<string, string> = {
  AUS: "gp | austrailian gp | melbourne",
  AUT: "gp | austrian gp | spielberg",
  AZE: "gp | azerbaijan gp | baku",
  BHR: "gp | bahrain gp | sepang",
  BAH: "gp | bahrain gp | sepang",
  BEL: "gp | belgian gp | spa",
  GBR: "gp | british gp | silverstone",
  CAN: "gp | canadian gp | montreal",
  CHN: "gp | chinese gp | shanghai",
  NED: "gp | dutch gp | zandvoort",
  HUN: "gp | hungarian gp | hungaroring",
  ITA: "gp | italian gp | monza",
  JPN: "gp | japanese gp | suzuka",
  MIA: "gp | miami gp | miami",
  USA: "gp | miami gp | miami",
  MCO: "gp | monaco gp | monte carlo",
  MON: "gp | monaco gp | monte carlo",
  SIN: "gp | singapore gp | marina bay",
  SGP: "gp | singapore gp | marina bay",
  MAD: "gp | spanish gp | madrid",
  BCN: "gp | barcelona gp | barcelona-catalunya",
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Find the production GP tag for a batch: by race name first ("Spanish
// Grand Prix", "Madrid"), then by LOC. Returns the title or undefined.
export function gpTagFor(opts: { loc?: string; race?: string }, available: string[]): string | undefined {
  const gpTags = available.filter((t) => t.startsWith("gp | "));
  if (opts.race) {
    const r = norm(opts.race);
    for (const t of gpTags) {
      const [, gp, circuit] = t.split("|").map((x) => norm(x));
      const gpWord = gp.replace(/ gp$/, "");
      if (gpWord && r.includes(gpWord)) return t;
      if (circuit && r.includes(circuit.split(" ")[0]) && circuit.split(" ")[0].length > 3) return t;
    }
  }
  const byLoc = opts.loc ? GP_BY_LOC[opts.loc.toUpperCase()] : undefined;
  if (byLoc && available.includes(byLoc)) return byLoc;
  return undefined;
}

// Batch-wide proposal: year + GP + weekday + session, limited to tags that
// exist on the target CMS.
export function proposeBatchTags(opts: { year: number; loc?: string; race?: string; session?: string }, available: string[]): string[] {
  const out: string[] = [];
  const year = String(opts.year);
  if (available.includes(year)) out.push(year);
  const gp = gpTagFor(opts, available);
  if (gp) out.push(gp);
  for (const t of SESSION_MAP[opts.session ?? ""] ?? []) if (available.includes(t) && !out.includes(t)) out.push(t);
  return out;
}

// People named in an alt text or descriptor, even when Claude left the
// "people" list empty: official names, surnames, longer aliases from team
// knowledge, and the car numbers of the two race drivers.
const CAR_NUMBERS: Record<string, string> = { "27": "Nico Hulkenberg", "5": "Gabriel Bortoleto" };
export function peopleInText(text: string, entries: { name: string; aliases?: string[]; active: boolean; kind: string }[]): string[] {
  const out: string[] = [];
  if (!text) return out;
  const plain = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const low = ` ${plain.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  // case-sensitive in prose ("Key" the person, not "key"); descriptors are
  // lowercase, so names of 5+ letters also match there
  const hit = (word: string) => {
    const w = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z])${esc}([^A-Za-z]|$)`).test(plain)) return true;
    return w.length >= 5 && low.includes(` ${w.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `);
  };
  for (const e of entries) {
    if (!e.active || e.kind !== "person") continue;
    const surname = e.name.split(" ").pop() ?? "";
    // short or everyday words ("Key", "Nico", "HUL") are too ambiguous on their own
    const cues = [e.name, ...(surname.length >= 5 ? [surname] : []), ...(e.aliases ?? []).filter((a) => a.length >= 4 && a !== "Gabriel" && a !== "Nico")];
    if (cues.some(hit) && !out.includes(e.name)) out.push(e.name);
  }
  const car = plain.match(/(?:car|#|car number)\s*(27|5)\b/i);
  if (car && !out.includes(CAR_NUMBERS[car[1]])) out.push(CAR_NUMBERS[car[1]]);
  return out;
}

// Descriptors read better with the driver in them ("hulkenberg-pit-stop"):
// put the surname of up to two recognised people in front when missing.
export function withPeople(descriptor: string, people: string[] | undefined): string {
  const words = descriptor.split("-").filter(Boolean);
  const names = (people ?? [])
    .slice(0, 2)
    .map((p) => (p.split(" ").pop() ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, ""))
    .filter((n) => n && !words.includes(n));
  return [...names, ...words].slice(0, 6).join("-");
}

// Per-photo proposal from what Claude saw: people → their tags, scene → tag.
export function proposeRowTags(opts: { people?: string[]; scene?: string }, available: string[]): string[] {
  const out: string[] = [];
  for (const p of opts.people ?? []) {
    const t = personTag(p, available);
    if (t && !out.includes(t)) out.push(t);
  }
  if (opts.scene && available.includes(opts.scene)) out.push(opts.scene);
  return oneScene(out, opts.scene);
}

// "Nico Hulkenberg" / "Nico Hülkenberg" / "Hulkenberg" → "nico hulkenberg"
export function personTag(name: string, available: string[]): string | undefined {
  const n = norm(name.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  if (!n) return undefined;
  const exact = available.find((t) => norm(t) === n);
  if (exact) return exact;
  const last = n.split(" ").pop()!;
  if (last.length < 4) return undefined;
  return available.find((t) => !t.includes("|") && norm(t).split(" ").includes(last));
}

// Pre-upload check. A GP batch wants the year, the GP and a day/session; a
// photo wants a scene or a person so it can be found later. Returns one
// line per problem, empty when fine.
export function tagIssues(batchTags: string[], rowTags: string[], opts: { isGp: boolean }): string[] {
  const all = [...batchTags, ...rowTags];
  const issues: string[] = [];
  if (!all.some((t) => /^\d{4}$/.test(t))) issues.push("No year tag (2026)");
  if (opts.isGp && !all.some((t) => t.startsWith("gp | "))) issues.push("No Grand Prix tag");
  if (opts.isGp && !all.some((t) => WEEKDAY_TAGS.includes(t) || SESSION_TAGS.includes(t))) issues.push("No day or session tag");
  if (!all.some((t) => (SCENE_TAGS as readonly string[]).includes(t)) && !all.some((t) => isPersonTag(t))) issues.push("No scene (on-track & garage / team / off-track) or person tag");
  if (all.includes("team") && all.includes("on-track & garage")) issues.push('Both "team" and "on-track & garage": use one (team = one or two people in focus, on-track & garage = car, crew at work, track action)');
  if (all.some((t) => /do not use|wip/.test(t))) issues.push("Uses a tag marked 'do not use'");
  return issues;
}

const PERSON_WORDS = ["nico hulkenberg", "gabriel bortoleto", "mattia binotto", "allan mcnish", "james key", "jonathan wheatley", "emma felbermayr", "freddie slater", "carrie schreiner", "paul aron"];
// Team people whose tag is not in the vocabulary yet ("gabriel bortoleto"
// on a fresh staging): the batch page creates them so the tag can be set.
export function missingPersonTags(people: string[] | undefined, available: string[]): string[] {
  const out: string[] = [];
  for (const p of people ?? []) {
    const t = p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (PERSON_WORDS.includes(t) && !personTag(p, available) && !out.includes(t)) out.push(t);
  }
  return out;
}
export function isPersonTag(t: string): boolean {
  return PERSON_WORDS.includes(t);
}

export function uniqueTags(...lists: (string[] | undefined)[]): string[] {
  const out: string[] = [];
  for (const l of lists) for (const t of l ?? []) if (t && !out.includes(t)) out.push(t);
  return out;
}
