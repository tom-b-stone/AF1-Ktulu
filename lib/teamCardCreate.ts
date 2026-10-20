// Server-only: builds a Team Card that exists only in Ktulu (e.g. imported
// from the tracker) on the STAGING CMS, as a DISABLED badge.
//
// A badge has many required fields, so a card already on staging serves as
// the template (same card type if possible). Everything the card defines
// replaces the template: title, every badge text in EN and DE, the card
// image, card type, Grand Prix, campaign, partner. Links point to the
// campaign's hub page when it is on staging. Engagement and module on a page
// are the next step; the card stays disabled until someone switches it on.
import { listCards, saveCardsPublic, type CardRecord } from "./teamCards";
import { FIELDS } from "./teamCardFields";
import { badgeType, loyaltyTag, stg, upsertLocalised, type CopyStep } from "./teamCardCopy";
import { listCampaigns } from "./sitemapSync";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ADMIN = "https://staging.audif1team.com/cms/admin/collections";

function setPath(o: Json, p: (string | number)[], v: unknown) {
  let cur = o;
  for (let i = 0; i < p.length - 1; i++) {
    if (cur[p[i]] == null) cur[p[i]] = typeof p[i + 1] === "number" ? [] : {};
    cur = cur[p[i]];
  }
  cur[p[p.length - 1]] = v;
}
const idOf = (v: Json) => (v && typeof v === "object" ? v.id : v);

export async function campaignOfCard(c: CardRecord): Promise<{ name: string; root: string } | null> {
  if (c.brief?.campaign) return { name: String(c.brief.campaign), root: "" };
  const plain = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const race = plain(String(c.brief?.race || c.raceLabel || ""));
  if (!race) return null;
  const hit = (await listCampaigns()).find((x) => x.race && plain(x.race) === race);
  return hit ? { name: hit.name, root: hit.root } : null;
}

export async function createOnStaging(id: string, by: string): Promise<{ ok: boolean; steps: CopyStep[]; badgeId?: string }> {
  const steps: CopyStep[] = [];
  const cards = await listCards();
  const card = cards.find((c) => c.id.toLowerCase() === id.toLowerCase());
  if (!card) return { ok: false, steps: [{ step: "card not found", ok: false }] };
  if (card.staging.badgeId) return { ok: true, steps: [{ step: "already on staging", ok: true, link: `${ADMIN}/badges/${card.staging.badgeId}` }], badgeId: card.staging.badgeId };
  try {
    // 1 template: a staging card of the same type, else any staging card
    const onStg = cards.filter((c) => c.staging.badgeId);
    if (!onStg.length) throw new Error("No card on staging to use as a template.");
    let template: Json = null;
    const wantType = String(card.brief?.badgeType ?? "").toLowerCase();
    for (const c of onStg) {
      const b = await stg(`/badges/${c.staging.badgeId}?depth=1&locale=all&fallback-locale=none&draft=true`).catch(() => null);
      if (!b) continue;
      if (!template) template = b;
      const t = b.badgeType && typeof b.badgeType === "object" ? String(b.badgeType.title?.en ?? b.badgeType.title ?? "").toLowerCase() : "";
      if (wantType && t === wantType) { template = b; break; }
    }
    if (!template) throw new Error("Could not read a template card on staging.");
    steps.push({ step: `template: ${template.title?.en ?? template.title}`, ok: true });

    // 2 the card's own content over the template
    const doc: Json = JSON.parse(JSON.stringify(template));
    // staging titles read "TC-037 | EXCLUSIVE | Nico's Nuvolari Helmet"
    const typeWord = String(card.brief?.badgeType || "").toUpperCase();
    const title = [card.id, typeWord, card.name].filter(Boolean).join(" | ");
    doc.title = { en: title, de: title };
    const deFallback: string[] = [];
    for (const f of FIELDS) {
      if (f.doc !== "badge") continue;
      const v = card.values[f.key];
      if (v === undefined || v === "") continue;
      if (f.localized) {
        const lv = v as { en?: string; de?: string };
        if (!lv.en && !lv.de) continue;
        // the CMS needs every text in both languages: a missing German text gets the English one for now
        if (!lv.de && lv.en) deFallback.push(f.label);
        setPath(doc, f.path, { en: lv.en || lv.de || "", de: lv.de || lv.en || "" });
      } else setPath(doc, f.path, v);
    }
    if (deFallback.length) steps.push({ step: `German missing, English used for now: ${deFallback.join(", ")}`, ok: true });
    if (card.brief?.imageId) doc.badgeImage = card.brief.imageId;
    else steps.push({ step: "no card image yet: the template image stays until one is set", ok: true });
    const tagType = (t: Json, d: string) => (t && typeof t === "object" && t.type ? t.type : d);
    if (card.brief?.badgeType) doc.badgeType = await badgeType({ title: card.brief.badgeType }, steps);
    else doc.badgeType = idOf(doc.badgeType);
    const race = String(card.brief?.race ?? card.raceLabel ?? "");
    doc.raceTag = race ? await loyaltyTag({ title: race, type: tagType(template.raceTag, "race") }, steps) : idOf(doc.raceTag);
    const camp = await campaignOfCard(card);
    doc.campaignTitle = camp ? await loyaltyTag({ title: camp.name, type: tagType(template.campaignTitle, "campaign") }, steps) : undefined;
    doc.partnerTag = card.brief?.partner ? await loyaltyTag({ title: card.brief.partner, type: tagType(template.partnerTag, "partner") }, steps) : undefined;
    doc.passionfieldTag = card.brief?.passionfield ? await loyaltyTag({ title: card.brief.passionfield, type: tagType(template.passionfieldTag, "passionfield") }, steps) : idOf(doc.passionfieldTag);
    doc.season = idOf(doc.season);

    // 3 links: the campaign hub when it is on staging
    const hub = camp?.root ? (await stg(`/pages?where[url][equals]=${encodeURIComponent(camp.root)}&limit=1&depth=0&draft=true`).catch(() => ({ docs: [] }))).docs?.[0] : null;
    doc.mechanics = hub ? [{ targetOriginType: "page", targetOriginPage: hub.id }] : (doc.mechanics ?? []).filter((m: Json) => m.targetOriginType !== "engagement").map((m: Json) => ({ ...m, targetOriginPage: idOf(m.targetOriginPage) }));
    const linkTo = (cta: Json) => (hub ? { ...cta, linkType: cta.linkType ?? "internal", doc: { relationTo: "pages", value: hub.id } } : { ...cta, doc: undefined, linkType: "external", url: "https://staging.audif1team.com" });
    doc.unearnedBadgeCTA = (doc.unearnedBadgeCTA ?? []).slice(0, 1).map(linkTo);
    doc.rewardCTA = [];
    doc.raffleConfirmedCTA = [];
    doc.clusters = [];
    doc.isDraft = true; // disabled until someone switches it on
    for (const k of ["badgeBackImage"]) doc[k] = idOf(doc[k]);
    steps.push({ step: hub ? `links go to the campaign hub /${camp?.root}` : "campaign hub not on staging: links left generic", ok: true });

    // 4 create (idempotent by title)
    const badgeId = await upsertLocalised("badges", doc, `where[or][0][title][equals]=${encodeURIComponent(title)}&where[or][1][title][equals]=${encodeURIComponent(card.name)}&locale=en`, steps, "card (disabled)");
    card.staging = { ...card.staging, badgeId };
    card.status = "Staging";
    card.updatedAt = new Date().toISOString();
    card.log = [{ at: card.updatedAt, by, summary: "Built on staging (disabled)" }, ...card.log].slice(0, 50);
    await saveCardsPublic(cards);
    return { ok: true, steps, badgeId };
  } catch (e) {
    steps.push({ step: "stopped", ok: false, detail: e instanceof Error ? e.message : String(e) });
    return { ok: false, steps };
  }
}

// ---- from production ----------------------------------------------------------
// A card that already lives on production: copy it to staging (overwrites the
// staging copy) and point the Ktulu card at it.
import { copyTeamCard, listProdCards } from "./teamCardCopy";
import { reloadCard } from "./teamCards";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export async function prodMatch(card: CardRecord): Promise<{ id: string; title: string } | null> {
  const link = String(card.brief?.cmsProd ?? "");
  const m = /badges\/([a-f0-9]{24})/.exec(link);
  const list = await listProdCards().catch(() => []);
  if (m) {
    const hit = list.find((x) => x.id === m[1]);
    return { id: m[1], title: hit?.title ?? card.name };
  }
  const hit = list.find((x) => norm(String(x.title)) === norm(card.name));
  return hit ? { id: hit.id, title: String(hit.title) } : null;
}

export async function fromProduction(id: string, by: string) {
  const cards = await listCards();
  const card = cards.find((c) => c.id.toLowerCase() === id.toLowerCase());
  if (!card) return { ok: false, steps: [{ step: "card not found", ok: false }] as CopyStep[] };
  const p = await prodMatch(card);
  if (!p) return { ok: false, steps: [{ step: "not found on production", ok: false, detail: "No production card with this name or link." }] as CopyStep[] };
  const r = await copyTeamCard({ badgeId: p.id, targetPageId: card.staging.pageId });
  if (r.badgeId) {
    const fresh = await listCards();
    const c = fresh.find((x) => x.id === card.id)!;
    c.staging = { ...c.staging, badgeId: r.badgeId, ...(r.engagementId ? { engagementId: r.engagementId } : {}), ...(r.pageId ? { pageId: r.pageId } : {}) };
    c.status = "Staging";
    c.log = [{ at: new Date().toISOString(), by, summary: `Copied from production (${p.title}), staging overwritten` }, ...c.log].slice(0, 50);
    await saveCardsPublic(fresh);
    await reloadCard(card.id).catch(() => undefined);
  }
  return { ok: r.ok, steps: r.steps, badgeId: r.badgeId, prod: p };
}
