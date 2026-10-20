// Server-only: one-way import from the ARF1 Team Cards Tracker (Google Sheet)
// into Ktulu's card records. Reads with the signed-in user's own Google token
// (read-only Drive scope). Never writes to the tracker.
import { listCards, saveCardsPublic, type CardRecord, type LocValue } from "./teamCards";

export const TRACKER_ID = "1btT2Ih9bB4y8rBmWKqYIQUSzDTnqWAAqY8HKLVNU7KM";
export const TRACKER_URL = `https://docs.google.com/spreadsheets/d/${TRACKER_ID}/edit`;

type Row = Record<string, string>;
export type TrackerCard = {
  id: string;
  name: string;
  status: string;
  copyStatus: string;
  race?: string;
  partner?: string;
  mechanic?: string;
  rewardType?: string;
  values: CardRecord["values"];
  brief: NonNullable<CardRecord["brief"]>;
};
export type ImportPreview = {
  cards: (TrackerCard & { match?: { cardId: string; reason: string } })[];
  newCount: number;
  dupCount: number;
};

async function sheet(token: string, name: string, headerRow: number): Promise<Row[]> {
  const url = `https://docs.google.com/spreadsheets/d/${TRACKER_ID}/gviz/tq?tqx=out:json&headers=0&sheet=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new Error("google_denied");
  const text = await res.text();
  const start = text.indexOf("{");
  let rows: string[][];
  if (res.ok && start >= 0) {
    const j = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) as { table: { rows: { c: ({ v: unknown } | null)[] }[] } };
    rows = j.table.rows.map((r) => r.c.map((c) => (c && c.v != null ? String(c.v) : "")));
  } else {
    // fallback: Sheets API (needs the Sheets API enabled for the OAuth project)
    const api = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${TRACKER_ID}/values/${encodeURIComponent(`'${name}'!A1:CC800`)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (api.status === 401) throw new Error("google_denied");
    if (!api.ok) throw new Error(`Could not read the tracker sheet "${name}" (${res.status}/${api.status}): ${(await api.text()).slice(0, 160)}`);
    rows = ((await api.json()) as { values?: string[][] }).values ?? [];
  }
  const head = rows[headerRow] ?? [];
  return rows.slice(headerRow + 1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const loc = (en?: string, de?: string): LocValue => ({ en: en ?? "", de: de ?? "" });
const MECH: [RegExp, string][] = [
  [/hot ?or ?not/i, "hot-or-not"],
  [/survey/i, "survey"],
  [/q ?& ?a|question/i, "q-and-a"],
  [/page ?view|visit/i, "page"],
  [/link/i, "link"],
];
const REWARD: Record<string, string> = { "no reward": "noReward", "raffle entry": "raffleSignup", raffle: "raffleSignup", voucher: "couponCode" };
const VARIANT: Record<string, string> = { primary: "primary", secondary: "secondary", tertiary: "tertiary", quaternary: "quaternary" };
const SIZE: Record<string, string> = { small: "sm", medium: "md", large: "lg" };

export async function readTracker(token: string): Promise<TrackerCard[]> {
  const [cards, engs] = await Promise.all([sheet(token, "Team Cards", 1), sheet(token, "Engagements", 0).catch(() => [] as Row[])]);
  const engBy = new Map(engs.filter((e) => /^TC-\d+/.test(e["Card ID"] ?? "")).map((e) => [e["Card ID"], e]));
  return cards
    .filter((r) => /^TC-\d+/.test(r["Card ID"] ?? ""))
    .map((r) => {
      const e = engBy.get(r["Card ID"]);
      const mechText = `${e?.["Mechanic"] ?? ""} ${r["Engagement"] ?? ""} ${r["Mechanics"] ?? ""}`;
      const mechanic = MECH.find(([rx]) => rx.test(mechText))?.[1];
      const values: CardRecord["values"] = {
        publicTitle: loc(r["Public Title EN"], r["Public Title DE"]),
        description: loc(r["Badge description EN"], r["Badge description DE"]),
        badgePopupTitle: loc(r["Badge Popup title override EN"], r["Badge Popup title override DE"]),
        revealTitle: loc(r["Reveal title EN"], r["Reveal title DE"]),
        revealDescription: loc(r["Reveal description EN"], r["Reveal description DE"]),
        revealButton: loc(r["Reveal button label EN"], r["Reveal button label DE"]),
        rewardDescription: loc(r["Reward Description EN"], r["Reward Description DE"]),
        rewardTeaser: loc(r["Reward Teaser Description EN"], r["Reward Teaser Description DE"]),
        ctaLabel: loc(r["CTA Label EN"], r["CTA Label DE"]),
        ctaA11y: loc(r["CTA Accessibility Label EN"], r["CTA Accessibility Label DE"]),
        ...(VARIANT[(r["CTA Variant"] ?? "").toLowerCase()] ? { ctaVariant: VARIANT[r["CTA Variant"].toLowerCase()] } : {}),
        ...(SIZE[(r["CTA Size"] ?? "").toLowerCase()] ? { ctaSize: SIZE[r["CTA Size"].toLowerCase()] } : {}),
        ...(e
          ? {
              engTitle: loc(e["CMS Title EN"], e["CMS Title DE"]),
              question: loc(e["Question EN"], e["Question DE"]),
              overlayTitle: loc(e["CMS Overlay Title EN"] || e["Login Overlay Title EN"], e["CMS Overlay Title DE"] || e["Login Overlay Title DE"]),
              overlaySubtitle: loc(e["CMS Overlay Subtitle EN"], e["CMS Overlay Subtitle DE"]),
              shareTitle: loc(e["CMS Share Title EN"], e["CMS Share Title DE"]),
              shareText: loc(e["CMS Share Text EN"], e["CMS Share Text DE"]),
              submitLabel: loc(e["CMS Submit Button EN"], e["CMS Submit Button DE"]),
              postTitle: loc(e["CMS Post-Submission Title EN"], e["CMS Post-Submission Title DE"]),
              postMessage: loc(e["After the engagement EN"], e["After the engagement DE"]),
            }
          : {}),
      };
      return {
        id: r["Card ID"],
        name: r["Internal Title"] || r["Public Title EN"] || r["Card ID"],
        status: r["Status"] || "Briefed",
        copyStatus: r["Copy Status"] ?? "",
        race: r["Race Tag"] || undefined,
        partner: r["Partner Tag"] || undefined,
        mechanic,
        rewardType: REWARD[(r["Reward"] || r["Reward Type"] || "").toLowerCase()],
        values,
        brief: {
          source: "tracker",
          trackerId: r["Card ID"],
          copyStatus: r["Copy Status"] ?? "",
          assignment: r["Assignment"] ?? "",
          shortDescription: r["Short description"] ?? "",
          conditions: r["Conditions"] ?? "",
          engagement: r["Engagement"] ?? "",
          reward: r["Reward"] ?? "",
          rewardDetails: r["Reward details"] ?? "",
          legal: r["Legal / T&Cs"] ?? "",
          goLive: r["Go-live"] ?? "",
          endDate: r["End date"] ?? "",
          race: r["Race Tag"] ?? "",
          partner: r["Partner Tag"] ?? "",
          passionfield: r["Passionfield Tag"] ?? "",
          badgeType: r["Badge Type"] ?? "",
          campaign: r["Campaign title"] ?? "",
          openQuestions: r["Open questions"] ?? "",
          cmsStaging: r["CMS Staging"] ?? "",
          cmsProd: r["CMS Prod"] ?? "",
          figma: r["Figma"] ?? "",
          importedAt: new Date().toISOString(),
        },
      };
    });
}

const normName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Duplicate check: same card ID, a card already linked to that tracker row,
// the same staging badge (from the tracker's CMS Staging link) or the same name.
function matchOf(t: TrackerCard, cards: CardRecord[]): { cardId: string; reason: string } | undefined {
  const byId = cards.find((c) => c.id.toLowerCase() === t.id.toLowerCase());
  if (byId) return { cardId: byId.id, reason: "same card ID" };
  const linked = cards.find((c) => c.brief?.trackerId === t.id);
  if (linked) return { cardId: linked.id, reason: "already linked to this tracker row" };
  const badge = (t.brief.cmsStaging ?? "").match(/badges\/([a-f0-9]{24})/)?.[1];
  const sameBadge = badge ? cards.find((c) => c.staging.badgeId === badge) : undefined;
  if (sameBadge) return { cardId: sameBadge.id, reason: "same staging badge" };
  const names = [t.name, typeof t.values.publicTitle === "object" ? (t.values.publicTitle as LocValue).en ?? "" : ""].map((x) => normName(x)).filter(Boolean);
  const sameName = cards.find((c) => names.includes(normName(c.name)));
  if (sameName) return { cardId: sameName.id, reason: `same name ("${sameName.name}")` };
  return undefined;
}

export async function previewImport(token: string): Promise<ImportPreview> {
  const [tracker, cards] = await Promise.all([readTracker(token), listCards()]);
  const out = tracker.map((t) => ({ ...t, match: matchOf(t, cards) }));
  return { cards: out, newCount: out.filter((c) => !c.match).length, dupCount: out.filter((c) => c.match).length };
}

// Adds the chosen new cards (never overwrites an existing one) and links
// duplicates to their tracker row on the Ktulu side.
export async function runImport(token: string, ids: string[], by: string) {
  const [tracker, cards] = await Promise.all([readTracker(token), listCards()]);
  const added: string[] = [];
  const linked: string[] = [];
  const skipped: string[] = [];
  const now = new Date().toISOString();
  for (const t of tracker) {
    const m = matchOf(t, cards);
    if (m) {
      const c = cards.find((x) => x.id === m.cardId);
      if (c && !c.brief?.trackerId) {
        c.brief = { ...(c.brief ?? {}), trackerId: t.id } as CardRecord["brief"];
        linked.push(`${t.id} → ${c.id}`);
      }
      if (ids.includes(t.id)) skipped.push(`${t.id} (${m.reason}: ${m.cardId})`);
      continue;
    }
    if (!ids.includes(t.id)) continue;
    cards.push({
      id: t.id,
      name: t.name,
      status: t.status,
      staging: { badgeId: "" },
      raceLabel: t.race,
      mechanic: t.mechanic,
      rewardType: t.rewardType,
      values: t.values,
      brief: t.brief,
      updatedAt: now,
      log: [{ at: now, by, summary: "Imported from the Team Cards Tracker (not on staging yet)" }],
    });
    added.push(t.id);
  }
  await saveCardsPublic(cards);
  return { added, linked, skipped };
}
