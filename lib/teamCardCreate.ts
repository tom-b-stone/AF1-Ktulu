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
  // a card Ktulu built may be built again (updates it); a card from elsewhere is left alone
  const builtHere = !!card.brief?.builtOnStaging || card.log.some((l) => /^Built on staging/.test(l.summary));
  if (card.staging.badgeId && !builtHere) return { ok: true, steps: [{ step: "already on staging", ok: true, link: `${ADMIN}/badges/${card.staging.badgeId}` }], badgeId: card.staging.badgeId };
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
      if (v === undefined || v === "") {
        // nothing set on the card: clear the template's text instead of keeping it (e.g. another card's button label)
        if (f.localized) setPath(doc, f.path, f.key === "publicTitle" ? { en: card.name, de: card.name } : { en: "", de: "" });
        continue;
      }
      if (f.localized) {
        const lv = v as { en?: string; de?: string };
        if (!lv.en && !lv.de) { setPath(doc, f.path, { en: "", de: "" }); continue; }
        // the CMS needs every text in both languages: a missing German text gets the English one for now
        if (!lv.de && lv.en) deFallback.push(f.label);
        setPath(doc, f.path, { en: lv.en || lv.de || "", de: lv.de || lv.en || "" });
      } else setPath(doc, f.path, v);
    }
    if (deFallback.length) steps.push({ step: `German missing, English used for now: ${deFallback.join(", ")}`, ok: true });
    if (card.brief?.imageId) doc.badgeImage = card.brief.imageId;
    else steps.push({ step: "no card image yet: the template image stays until one is set", ok: true });
    const tagType = (t: Json, d: string) => (t && typeof t === "object" && t.type ? t.type : d);
    // a tag that can't be found or created is skipped (noted), never fatal
    const tag = async (title: string, type: string) => {
      try {
        return await loyaltyTag({ title, type }, steps);
      } catch (e) {
        steps.push({ step: `tag "${title}" (${type}) skipped`, ok: true, detail: e instanceof Error ? e.message.slice(0, 160) : undefined });
        return undefined;
      }
    };
    if (card.brief?.badgeType) doc.badgeType = await badgeType({ title: card.brief.badgeType }, steps);
    else doc.badgeType = idOf(doc.badgeType);
    const race = String(card.brief?.race ?? card.raceLabel ?? "");
    doc.raceTag = race ? (await tag(race, tagType(template.raceTag, "race"))) ?? idOf(doc.raceTag) : idOf(doc.raceTag);
    const camp = await campaignOfCard(card);
    // campaign tags read like the Singapore one: "singapore 2026"
    const season = String(card.brief?.season || "2026");
    doc.campaignTitle = camp ? await tag(`${camp.name.toLowerCase()} ${season}`, tagType(template.campaignTitle, "campaign")) : undefined;
    doc.partnerTag = card.brief?.partner ? await tag(card.brief.partner, tagType(template.partnerTag, "partner")) : undefined;
    doc.passionfieldTag = card.brief?.passionfield ? (await tag(card.brief.passionfield, tagType(template.passionfieldTag, "passionfield"))) ?? idOf(doc.passionfieldTag) : idOf(doc.passionfieldTag);
    doc.season = idOf(doc.season);

    // 3 setup: reward, back image, engagement, where the module sits
    const setup = card.setup ?? {};
    doc.rewardType = setup.reward?.type || card.rewardType || "noReward";
    if (doc.rewardType === "raffleSignup" && !(doc.raffleSubmitLabel?.en)) doc.raffleSubmitLabel = { en: "Enter the raffle", de: "Am Gewinnspiel teilnehmen" };
    doc.badgeBackImage = setup.backImageId || idOf(doc.badgeBackImage);
    const hub = camp?.root ? (await stg(`/pages?where[url][equals]=${encodeURIComponent(camp.root)}&limit=1&depth=0&draft=true`).catch(() => ({ docs: [] }))).docs?.[0] : null;
    const pageId: string | undefined = setup.module?.pageId || hub?.id;
    const engagementId = await upsertEngagement(card, steps);
    if (engagementId) doc.mechanics = [{ targetOriginType: "engagement", targetOriginEngagement: engagementId }];
    else doc.mechanics = pageId ? [{ targetOriginType: "page", targetOriginPage: pageId }] : [];
    const linkTo = (cta: Json) => (pageId ? { ...cta, linkType: "internal", url: undefined, doc: { relationTo: "pages", value: pageId } } : { ...cta, doc: undefined, linkType: "external", url: "https://staging.audif1team.com" });
    doc.unearnedBadgeCTA = (doc.unearnedBadgeCTA ?? []).slice(0, 1).map(linkTo);
    doc.rewardCTA = [];
    doc.raffleConfirmedCTA = [];
    doc.clusters = [];
    doc.isDraft = true; // disabled until someone switches it on
    steps.push({ step: pageId ? `links go to ${setup.module?.pageUrl ? "/" + setup.module.pageUrl : "the campaign hub /" + camp?.root}` : "no page on staging yet: links left generic", ok: true });

    // 4 create (idempotent by title)
    // the card's own staging badge first (by id), so a changed title never creates a second one
    const find = card.staging.badgeId ? `where[id][equals]=${card.staging.badgeId}` : `where[or][0][title][equals]=${encodeURIComponent(title)}&where[or][1][title][equals]=${encodeURIComponent(card.name)}&locale=en`;
    const badgeId = await upsertLocalised("badges", doc, find, steps, "card (disabled)");
    // earlier duplicates with the same title, disabled, left by a run that stopped: removed
    const dups = await stg(`/badges?where[title][equals]=${encodeURIComponent(title)}&where[isDraft][equals]=true&limit=10&depth=0&locale=en`).catch(() => ({ docs: [] }));
    for (const d of (dups.docs ?? []) as Json[]) if (d.id !== badgeId) { await stg(`/badges/${d.id}`, { method: "DELETE" }).catch(() => null); steps.push({ step: `duplicate card ${d.id} removed`, ok: true }); }
    if (engagementId) {
      // the CMS only links an engagement to an ACTIVE card: the back link follows when the card is switched on
      try {
        await stg(`/engagements/${engagementId}`, { method: "PATCH", body: JSON.stringify({ loggedOutBadge: badgeId }) });
        steps.push({ step: "engagement linked to the card", ok: true });
      } catch {
        steps.push({ step: "engagement links back to the card once the card is switched on", ok: true });
      }
    }
    let blockId: string | undefined;
    if (setup.module?.fromFigma) blockId = setup.module.blockId;
    else if (setup.module?.pageId) blockId = await placeModule(card, badgeId, engagementId, setup.module.pageId, steps).catch((e) => { steps.push({ step: "module not placed", ok: false, detail: e instanceof Error ? e.message.slice(0, 300) : String(e) }); return undefined; });
    card.staging = { ...card.staging, badgeId, ...(engagementId ? { engagementId } : {}), ...(blockId ? { pageId: setup.module!.pageId, blockId } : {}) };
    card.brief = { ...(card.brief ?? {}), builtOnStaging: new Date().toISOString() };
    card.status = "Staging";
    card.updatedAt = new Date().toISOString();
    card.log = [{ at: card.updatedAt, by, summary: builtHere ? "Built on staging again (disabled, updated)" : "Built on staging (disabled)" }, ...card.log].slice(0, 50);
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

// ---- engagement and module ------------------------------------------------------
const both = (v?: { en?: string; de?: string }) => ({ en: v?.en || v?.de || "", de: v?.de || v?.en || "" });
const DEFAULTS: Record<string, { en: string; de: string }> = {
  overlayTitle: { en: "Successfully unlocked.", de: "Erfolgreich freigeschaltet." },
  overlaySubtitle: { en: "Collect your Team Card now.", de: "Hol dir jetzt deine Team Card." },
  submitLabel: { en: "Submit", de: "Absenden" },
};

// the card's engagement from its setup: created once, updated after (title "Name | TC-0xx")
async function upsertEngagement(card: CardRecord, steps: CopyStep[]): Promise<string | undefined> {
  const e = card.setup?.engagement;
  if (!e || e.type === "page") return undefined;
  if (!e.items.length) {
    steps.push({ step: "engagement skipped: add at least one item or question in Setup", ok: false });
    return undefined;
  }
  const doc: Json = {
    title: both({ en: `${card.name} | ${card.id}` }),
    engagementType: e.type,
    background: e.bg?.type === "image" && e.bg.mediaId ? { type: "image", imageSettings: { media: e.bg.mediaId, shouldHaveOverlay: true } } : { type: "color", color: e.bg?.color || "grey-01", imageSettings: { shouldHaveOverlay: false } },
    questions: e.items.map((it) => ({
      text: both(it.text),
      options: e.type === "survey" || e.type === "quiz" ? (it.options ?? []).filter((o) => o.en || o.de).map((o) => ({ text: both(o) })) : [],
      ...(it.mediaId ? { assetId: it.mediaId } : {}),
      shouldHaveOverlay: false,
    })),
  };
  for (const f of FIELDS) {
    if (f.doc !== "engagement" || f.key === "engTitle" || f.key === "question") continue;
    const v = card.values[f.key] as { en?: string; de?: string } | undefined;
    const val = v && (v.en || v.de) ? both(v) : DEFAULTS[f.key];
    if (val) setPath(doc, f.path, val);
  }
  const find = card.staging.engagementId ? `where[id][equals]=${card.staging.engagementId}` : `where[title][equals]=${encodeURIComponent(`${card.name} | ${card.id}`)}&locale=en`;
  return upsertLocalised("engagements", doc, find, steps, `engagement (${e.type})`);
}

const noIds = (v: Json): Json => (Array.isArray(v) ? v.map(noIds) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "id").map(([k, x]) => [k, noIds(x)])) : v);

// the badge-engagement-teaser module on the chosen staging page, as a DRAFT version
async function placeModule(card: CardRecord, badgeId: string, engagementId: string | undefined, pageId: string, steps: CopyStep[]): Promise<string | undefined> {
  const cards = await listCards();
  const withBlock = cards.filter((c) => c.staging.pageId && c.staging.blockId && c.id !== card.id);
  const tplCard = withBlock.find((c) => c.mechanic === card.mechanic) ?? withBlock[0];
  if (!tplCard) throw new Error("no module on staging to use as a template");
  const tplPage = await stg(`/pages/${tplCard.staging.pageId}?locale=en&fallback-locale=none&depth=0&draft=true`);
  const tb = (tplPage.sections ?? []).find((x: Json) => x.id === tplCard.staging.blockId);
  if (!tb) throw new Error("template module not found");
  const block: Json = noIds(tb);
  block.badge = badgeId;
  const kids: Json[] = (block.children ?? []).filter((c: Json) => c.blockType !== "engagement");
  if (engagementId) kids.push({ blockType: "engagement", engagement: engagementId });
  block.children = kids;
  const mods = FIELDS.filter((f) => f.doc === "module");
  const valOf = (k: string, l: "en" | "de") => { const v = card.values[k]; return v && typeof v === "object" ? String((v as Json)[l] || (v as Json).en || "") : typeof v === "string" ? v : undefined; };
  for (const f of mods) { const v = valOf(f.key, "en"); if (v !== undefined) setPath(block, f.path, v); }
  const isOurs = (x: Json) => x.blockType === "badge-engagement-teaser" && idOf(x.badge) === badgeId;
  const en = await stg(`/pages/${pageId}?locale=en&fallback-locale=none&depth=0&draft=true`);
  const sections: Json[] = en.sections ?? [];
  const at = sections.findIndex(isOurs);
  if (at >= 0) sections[at] = { ...block, id: sections[at].id };
  else sections.push(block);
  await stg(`/pages/${pageId}?locale=en&draft=true`, { method: "PATCH", body: JSON.stringify({ sections, _status: "draft" }) });
  const de = await stg(`/pages/${pageId}?locale=de&fallback-locale=none&depth=0&draft=true`);
  const ds: Json[] = de.sections ?? [];
  const k = ds.findIndex(isOurs);
  if (k >= 0) {
    for (const f of mods) { const v = valOf(f.key, "de"); if (v !== undefined && f.localized) setPath(ds[k], f.path, v); }
    await stg(`/pages/${pageId}?locale=de&draft=true`, { method: "PATCH", body: JSON.stringify({ sections: ds, _status: "draft" }) });
  }
  const again = await stg(`/pages/${pageId}?locale=en&depth=0&draft=true`);
  const blockId = (again.sections ?? []).find(isOurs)?.id;
  steps.push({ step: `module ${at >= 0 ? "updated" : "placed"} on /${en.url ?? pageId} (draft version, not published)`, ok: true, link: `${ADMIN}/pages/${pageId}` });
  return blockId;
}
