// Tools the AF1 Tools connector exposes to Claude. Keep each one small and
// safe: every write goes through the same validation and publish path the
// SEO Studio UI uses, so nothing the connector can do is a new capability —
// it just removes a click. New tools for other apps (asset uploader, CRM
// images) belong in this file too, prefixed by tool name.
import { getHomeMetaImageId } from "./payloadClient";
import { validateSeoField } from "./seoBrand";
import { SEO_RULES, SEO_WRITE_RECIPE } from "./seoHandoff";
import { SCENE_TAGS, peopleInText, uniqueTags, type Scene } from "./contentTags";
import { readBatch, readPreview, writeBatch } from "./assetBatchStore";
import { readKnowledge, KNOWLEDGE_KEY } from "./knowledgeStore";
import { kvSet } from "./kv";
import { listRules, rulesText } from "./teamCardRules";
import { searchLibrary, fetchLibraryImage } from "./library";
import { addExample, readExamples } from "./examplesStore";
import { addReference, listReferences, readReferenceImage } from "./referenceStore";
import { readCorrections } from "./feedbackStore";
import { learnPerson } from "./learnRun";
import { rulebook } from "./assetPrompt";
import { cleanDescriptor, validateAlt, knowledgeIssues, ALT_MAX } from "./assetNaming";
import { copyTeamCard } from "./teamCardCopy";
import { jobSummary, readJob, startJob, stepJob } from "./siteCopy";
import { status as sitemapStatus, cardsForConfigurator, queueCommand, resetSync } from "./sitemapSync";
import { compareCampaign, loadIssues, repairCampaign, saveIssues } from "./siteCompare";
import { importCampaignCards } from "./teamCards";
import { FIELDS, applyChanges, diff, getCard, listCards, readChangeset, saveChangeset, stagingLinks, type Change, type LocValue } from "./teamCards";

export type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };

type JsonSchema = Record<string, unknown>;

// MCP tool annotations (2025-03-26 spec). Clients use them to decide how
// much to ask: a read-only tool can run without a per-call approval, a
// non-destructive, idempotent write is a lower bar than a destructive one.
// claude.ai still shows its own "Allow once / Always allow" prompt for the
// first call; "Always allow" is what removes the clicks for the user.
export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  run: (args: Record<string, unknown>, actor: string) => Promise<ToolResult>;
};

// "Publication date untouched: 12 Sep 2026, still published" — or a loud
// warning if Payload moved it, which is the one thing this flow must never do.
export function describeDate(r: { publishedAtBefore: string | null; publishedAtAfter: string | null; status: string }): string {
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "none";
  const same = (r.publishedAtBefore ?? "") === (r.publishedAtAfter ?? "");
  if (same) return `Publication date: untouched, ${fmt(r.publishedAtAfter)}, still ${r.status}`;
  return `WARNING: publication date changed from ${fmt(r.publishedAtBefore)} to ${fmt(r.publishedAtAfter)} (status ${r.status}). Tell the user.`;
}

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], isError });


export const TOOLS: ToolDef[] = [
  // ---- SEO Studio -----------------------------------------------------
  // Reads and writes now go through the team's "AF1 Payload Staging MCP"
  // (per-user CMS login). This connector keeps what that one doesn't have:
  // the brand rules, the check, and the home meta-image fallback.
  {
    name: "seo_rules",
    annotations: { title: "SEO rules + write recipe", readOnlyHint: true, openWorldHint: false },
    description:
      "The audif1.com SEO meta rules (lengths, title patterns, brand spellings), the home page meta image ids to use when a doc has none, and the exact recipe for writing meta with the AF1 Payload Staging MCP without changing the publication date. Call once before writing SEO.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const [en, de] = await Promise.all([getHomeMetaImageId("en").catch(() => null), getHomeMetaImageId("de").catch(() => null)]);
      return text(`${SEO_RULES}

HOME META IMAGE (use when the doc's meta.image is empty in that locale)
en: ${en ?? "(none found)"}
de: ${de ?? en ?? "(none found)"}

${SEO_WRITE_RECIPE}`);
    },
  },
  {
    name: "seo_check",
    annotations: { title: "Check SEO texts", readOnlyHint: true, openWorldHint: false },
    description:
      "Check EN and DE SEO title + description against the audif1.com brand rules before writing them with the Payload MCP. Returns OK or the issues to fix. Does not write anything.",
    inputSchema: {
      type: "object",
      required: ["en_title", "en_description"],
      properties: {
        en_title: { type: "string" },
        en_description: { type: "string" },
        de_title: { type: "string" },
        de_description: { type: "string" },
      },
    },
    async run(args) {
      const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
      const errors: string[] = [];
      const warnings: string[] = [];
      for (const [label, kind, key] of [
        ["EN title", "title", "en_title"],
        ["EN description", "description", "en_description"],
        ["DE title", "title", "de_title"],
        ["DE description", "description", "de_description"],
      ] as const) {
        const v = str(key);
        if (!v) {
          if (key.startsWith("en")) errors.push(`${label}: empty`);
          continue;
        }
        const r = validateSeoField(kind, v);
        errors.push(...r.errors.map((e) => `${label}: ${e}`));
        warnings.push(...r.warnings.map((w) => `${label}: ${w}`));
      }
      if (errors.length) return text(`NOT OK — fix and check again:\n${errors.join("\n")}`, true);
      return text(`OK${warnings.length ? ` (warnings: ${warnings.join("; ")})` : ""}`);
    },
  },
  // ---- Asset Uploader -------------------------------------------------
  {
    name: "asset_rulebook",
    annotations: { title: "Alt text rulebook", readOnlyHint: true, openWorldHint: false },
    description: "The rules for audif1.com image alt texts and file-name descriptors: people (official spellings), terms, rules, patterns. Call once before writing alt texts.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      return text(rulebook(await readKnowledge(), await readExamples(), await listReferences(), await readCorrections()));
    },
  },
  {
    name: "asset_list_batch",
    annotations: { title: "List a photo batch", readOnlyHint: true, openWorldHint: false },
    description: "List the photos of an Asset Uploader batch: row ids, original file names, what is known (Grand Prix, session, date, people), and the current descriptor / alt text.",
    inputSchema: { type: "object", required: ["batchId"], properties: { batchId: { type: "string" } } },
    async run(args) {
      const b = await readBatch(String(args.batchId ?? ""));
      if (!b) return text("Batch not found on the server (previews expire after 7 days; open the batch and click Generate alt text again).", true);
      const head = `Batch ${b.id} · ${b.rows.length} photos · folder ${b.folderPath} · ${b.race ?? ""} ${b.year} ${b.loc}${b.session ? ` · session ${b.session}` : ""}`;
      const rows = b.rows.map((r) => `${r.id} · ${r.originalName}${r.date ? ` · ${r.date}` : ""}${r.context ? ` · slot ${r.context}` : ""}${r.people?.length ? ` · people: ${r.people.join(", ")}` : ""} · descriptor: ${r.descriptor || "(none)"} · alt: ${r.alt || "(none)"}`);
      return text(`${head}\n${rows.join("\n")}`);
    },
  },
  {
    name: "asset_get_image",
    annotations: { title: "See a photo", readOnlyHint: true, openWorldHint: false },
    description: "Returns a preview of one photo in a batch so you can describe it.",
    inputSchema: { type: "object", required: ["batchId", "rowId"], properties: { batchId: { type: "string" }, rowId: { type: "string" } } },
    async run(args) {
      const p = await readPreview(String(args.batchId ?? ""), String(args.rowId ?? ""));
      if (!p) return text("No preview for this photo on the server.", true);
      return { content: [{ type: "image", data: p.data, mimeType: p.mime }, { type: "text", text: `Photo ${args.rowId} of batch ${args.batchId}.` }] };
    },
  },
  {
    name: "asset_set_meta",
    annotations: { title: "Write descriptor + alt text", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: `Write the file-name descriptor and the English alt text for one photo, plus what is in it for the content tags: "people" (official names of team people you can identify with evidence, empty if none) and "scene" (exactly one of "team" = one or two people are the focus of the picture; "on-track & garage" = the car, the crew at work or the action on track is the subject; "off-track" = paddock, fans, city, events; never "team" and "on-track & garage" together). Validates: alt under ${ALT_MAX} chars, team name only "Audi Revolut F1® Team", no em-dash, official spellings. Returns the issues if any; fix and call again.`,
    inputSchema: {
      type: "object",
      required: ["batchId", "rowId", "descriptor", "alt", "scene"],
      properties: {
        batchId: { type: "string" },
        rowId: { type: "string" },
        descriptor: { type: "string" },
        alt: { type: "string" },
        people: { type: "array", items: { type: "string" }, description: "Official names, e.g. [\"Nico Hulkenberg\"]. Only with evidence (car number, helmet, suit name, clear face)." },
        scene: { type: "string", enum: ["on-track & garage", "team", "off-track"] },
      },
    },
    async run(args, actor) {
      const b = await readBatch(String(args.batchId ?? ""));
      if (!b) return text("Batch not found on the server.", true);
      const row = b.rows.find((r) => r.id === String(args.rowId));
      if (!row) return text("Row not found in this batch.", true);
      const alt = String(args.alt ?? "").trim().replace(/\s+/g, " ");
      const descriptor = cleanDescriptor(String(args.descriptor ?? ""));
      const issues = [...validateAlt(alt), ...knowledgeIssues(alt, await readKnowledge())];
      if (issues.length) return text(`NOT written — fix and call again:\n${issues.join("\n")}`, true);
      if (!descriptor) return text("NOT written — descriptor is empty after cleaning (2–6 lowercase words, hyphens).", true);
      row.alt = alt;
      row.descriptor = descriptor;
      if (Array.isArray(args.people)) row.people = (args.people as unknown[]).map(String).filter(Boolean);
      // a driver named in the alt text (or by car number) counts too
      row.people = uniqueTags(row.people, peopleInText(`${alt} ${descriptor}`, await readKnowledge()));
      if (typeof args.scene === "string" && SCENE_TAGS.includes(args.scene as Scene)) row.scene = args.scene;
      b.updatedAt = new Date().toISOString();
      await writeBatch(b);
      console.log(`[connector] ${actor} wrote alt for ${b.id}/${row.id}`);
      return text(`Written. ${row.originalName} → ${descriptor} · "${alt}" (${alt.length} chars)${row.scene ? ` · ${row.scene}` : ""}${row.people?.length ? ` · ${row.people.join(", ")}` : ""}`);
    },
  },
  // ---- Learning session (production library, read-only) ---------------
  {
    name: "library_search",
    annotations: { title: "Search the live media library", readOnlyHint: true, openWorldHint: false },
    description: "Search the production audif1.com media library by alt text (e.g. 'Nico Hulkenberg', 'R26', 'garage'). Returns id, file name, alt text and date, newest first. Read-only.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 }, page: { type: "integer", minimum: 1 } } },
    async run(args) {
      const r = await searchLibrary(String(args.query ?? ""), Number(args.limit ?? 12), Number(args.page ?? 1));
      return text(`${r.total} photos match.\n${r.items.map((i) => `${i.id} · ${i.filename} · ${i.createdAt.slice(0, 10)} · "${i.alt}"`).join("\n")}`);
    },
  },
  {
    name: "library_get_image",
    annotations: { title: "See a library photo", readOnlyHint: true, openWorldHint: false },
    description: "Returns a preview of one production library photo plus its alt text, so you can compare what is in the picture with how it was described.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    async run(args) {
      const p = await fetchLibraryImage(String(args.id ?? ""));
      if (!p) return text("Photo not available.", true);
      return { content: [{ type: "image", data: p.data, mimeType: p.mime }, { type: "text", text: `${p.filename}\nalt: "${p.alt}"` }] };
    },
  },
  {
    name: "knowledge_update",
    annotations: { title: "Update a person's cue", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Write or replace the visual cue (and optionally a note or extra alias) of a person or term in Team knowledge. Match by exact name as listed in asset_rulebook.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" }, cue: { type: "string", description: "How to recognise them in a photo, under 400 chars" }, note: { type: "string" }, add_alias: { type: "string" } },
    },
    async run(args, actor) {
      const entries = await readKnowledge();
      const e = entries.find((x) => x.name.toLowerCase() === String(args.name ?? "").toLowerCase());
      if (!e) return text(`No entry named "${args.name}". Names in the rulebook: ${entries.filter((x) => x.kind === "person").map((x) => x.name).join(", ")}`, true);
      if (typeof args.cue === "string" && args.cue.trim()) e.cue = args.cue.trim().slice(0, 400);
      if (typeof args.note === "string" && args.note.trim()) e.note = args.note.trim().slice(0, 800);
      if (typeof args.add_alias === "string" && args.add_alias.trim()) e.aliases = Array.from(new Set([...(e.aliases ?? []), args.add_alias.trim()])).slice(0, 12);
      await kvSet(KNOWLEDGE_KEY, JSON.stringify(entries));
      console.log(`[connector] ${actor} updated knowledge for ${e.name}`);
      return text(`Updated ${e.name}.${e.cue ? ` Cue: ${e.cue}` : ""}`);
    },
  },
  {
    name: "knowledge_add_example",
    annotations: { title: "Save a good alt text example", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: "Save an alt text from the library as a style example (subject: driver name, car, garage, pit wall, fans, portrait, partner). Validated against the rules first.",
    inputSchema: { type: "object", required: ["subject", "alt"], properties: { subject: { type: "string" }, alt: { type: "string" }, source: { type: "string", description: "library photo id or file name" } } },
    async run(args, actor) {
      const alt = String(args.alt ?? "").trim();
      const issues = [...validateAlt(alt), ...knowledgeIssues(alt, await readKnowledge())];
      if (issues.length) return text(`Not saved, it breaks the rules: ${issues.join("; ")}`, true);
      const all = await addExample({ subject: String(args.subject ?? "general").slice(0, 40), alt, source: typeof args.source === "string" ? args.source : undefined });
      console.log(`[connector] ${actor} saved example (${all.length} total)`);
      return text(`Saved. ${all.length} examples in the rulebook.`);
    },
  },
  {
    name: "knowledge_references",
    annotations: { title: "List reference photos", readOnlyHint: true, openWorldHint: false },
    description: "List the saved reference photos per person (id, person, note). Look at them with knowledge_reference_image to learn faces, helmets and suits before naming people.",
    inputSchema: { type: "object", properties: { person: { type: "string", description: "optional filter" } } },
    async run(args) {
      const refs = await listReferences();
      const f = typeof args.person === "string" ? args.person.toLowerCase() : "";
      const list = f ? refs.filter((r) => r.person.toLowerCase().includes(f)) : refs;
      if (!list.length) return text("No reference photos saved yet.");
      return text(list.map((r) => `${r.id} · ${r.person}${r.note ? ` · ${r.note}` : ""}`).join("\n"));
    },
  },
  {
    name: "knowledge_reference_image",
    annotations: { title: "Show a reference photo", readOnlyHint: true, openWorldHint: false },
    description: "Returns one saved reference photo of a person (id from knowledge_references or asset_rulebook).",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    async run(args) {
      const refs = await listReferences();
      const meta = refs.find((r) => r.id === String(args.id));
      const img = meta ? await readReferenceImage(meta.id) : null;
      if (!meta || !img) return text("No reference photo with that id.", true);
      return { content: [{ type: "image", data: img.data, mimeType: img.mime }, { type: "text", text: `${meta.person}${meta.note ? ` — ${meta.note}` : ""}` }] };
    },
  },
  {
    name: "knowledge_add_reference",
    annotations: { title: "Save a reference photo", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Save a production library photo (id from library_search) as a reference photo of a person, with a short note on what identifies them in it (helmet colours, suit, face). Max 8 per person; oldest is dropped.",
    inputSchema: { type: "object", required: ["libraryId", "person"], properties: { libraryId: { type: "string" }, person: { type: "string", description: "official name as in asset_rulebook" }, note: { type: "string" } } },
    async run(args, actor) {
      const img = await fetchLibraryImage(String(args.libraryId ?? ""));
      if (!img) return text("Library photo not found.", true);
      const known = (await readKnowledge()).filter((e) => e.kind === "person" && e.active).map((e) => e.name);
      const person = String(args.person ?? "").trim();
      const match = known.find((n) => n.toLowerCase() === person.toLowerCase());
      if (!match) return text(`Unknown person "${person}". Known: ${known.join(", ")}`, true);
      const refs = await addReference({ person: match, note: typeof args.note === "string" ? args.note.slice(0, 200) : undefined, source: `library:${args.libraryId}`, mime: img.mime, data: img.data });
      console.log(`[connector] ${actor} saved a reference for ${match}`);
      return text(`Saved. ${refs.filter((r) => r.person === match).length} reference photos for ${match}.`);
    },
  },
  {
    name: "learn_person",
    annotations: { title: "Learn a person from the library", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: "Runs the tool's own learning for one person (needs the Anthropic API key set in the app): looks at up to 8 production library photos that name them, saves the unmistakable ones as reference photos (up to 6 per person) and writes a recognition cue into Team knowledge. Call once per person from asset_rulebook's PEOPLE list.",
    inputSchema: { type: "object", required: ["person"], properties: { person: { type: "string", description: "official name" } } },
    async run(args, actor) {
      try {
        const r = await learnPerson(String(args.person ?? ""), { maxLook: 8, wantRefs: 6 });
        console.log(`[connector] ${actor} learned ${r.person}: ${r.saved} refs`);
        return text(`${r.person}: looked at ${r.looked} photos, saved ${r.saved} reference photos${r.cue ? `, cue: ${r.cue}` : ""}${r.skipped ? ` (${r.skipped})` : ""}`);
      } catch (e) {
        return text(e instanceof Error ? e.message : "failed", true);
      }
    },
  },
  // ---- Team Card Configurator --------------------------------------------
  {
    name: "teamcard_copy_to_staging",
    annotations: { title: "Copy a Team Card from production to staging", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description:
      "ONE-OFF for the demo, not part of the regular flow (the configurator builds cards on staging from its own content, then on production after approval). Copies one live Team Card from production to the STAGING CMS: card images, loyalty tags, badge type, the engagement, the badge (active, because a disabled badge does not link to its engagement and module; keepDraft=true disables it) and its badge-engagement-teaser block on the linked staging page (saved as a draft version, not published). Production is only read. Running it again updates the same staging documents.",
    inputSchema: {
      type: "object",
      required: ["badgeId"],
      properties: {
        badgeId: { type: "string", description: "Production badge id or its CMS admin link" },
        keepDraft: { type: "boolean", description: "Disable the staging card (default false; a disabled card loses the link to engagement and module)" },
        withPageBlock: { type: "boolean", description: "Place the teaser on its staging page as a draft (default true)" },
        targetPageId: { type: "string", description: "Staging page id to use when the production page does not exist on staging (CTA link + module placement)" },
      },
    },
    async run(args, actor) {
      // passthrough to any action (claude.ai caches the tool list; this
      // existing tool reaches new actions without reconnecting)
      if (args.ktulu_action) {
        const t = TOOLS.find((x) => x.name === String(args.ktulu_action));
        if (!t) return text(`Unknown action ${String(args.ktulu_action)}`, true);
        let a: unknown = args.ktulu_args ?? {};
        if (typeof a === "string") {
          try {
            a = JSON.parse(a);
          } catch {
            a = {};
          }
        }
        return t.run(a as Record<string, unknown>, actor);
      }
      const id = String(args.badgeId ?? "").match(/[a-f0-9]{24}/)?.[0];
      if (!id) return text("badgeId missing", true);
      const r = await copyTeamCard({ badgeId: id, keepDraft: args.keepDraft as boolean | undefined, withPageBlock: args.withPageBlock as boolean | undefined, targetPageId: (String(args.targetPageId ?? "").match(/[a-f0-9]{24}/) ?? [])[0] });
      console.log(`[connector] ${actor} copied team card ${id} to staging: ${r.ok}`);
      const lines = r.steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.step}${s.detail ? ` (${s.detail})` : ""}${s.link ? ` ${s.link}` : ""}`);
      return text(`${r.ok ? "Done" : "Finished with issues"}\n${lines.join("\n")}`, !r.ok);
    },
  },
  {
    name: "sitemap_import_cards",
    annotations: { title: "Add a campaign's Team Cards to the card list", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: "Adds (or refreshes) the Team Cards of a campaign (staging badges, engagements, modules) to the Team Card Configurator list. Campaign key: sin.",
    inputSchema: { type: "object", properties: { campaign: { type: "string" } } },
    async run(args, actor) {
      try {
        const c = String(args.campaign ?? "sin");
        const list = await cardsForConfigurator(c);
        const r = await importCampaignCards(c.toUpperCase(), list, "Singapore");
        console.log(`[connector] ${actor} imported ${list.length} cards for ${c}`);
        return text(`${list.length} cards: ${list.map((x) => x.title).join(", ")}. New records: ${r.added.join(", ") || "none"}. List now has ${r.total} cards.`);
      } catch (e) {
        return text(e instanceof Error ? e.message : "failed", true);
      }
    },
  },
  {
    name: "sitecopy_compare",
    annotations: { title: "Compare production pages with their staging copies", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: "Compares a copied campaign (production vs staging, EN + DE): modules, images (same file, focal point/crop), engagements, Team Cards and texts that are empty on staging. Saves the issue list for sitecopy_repair. Run with root (e.g. unlock-singapore); continue with from=<next> until next is null.",
    inputSchema: { type: "object", properties: { root: { type: "string" }, from: { type: "number" } } },
    async run(args) {
      try {
        const root = String(args.root ?? "unlock-singapore");
        const from = Number(args.from ?? 0);
        const r = await compareCampaign(root, { from });
        await saveIssues(root, r.issues, from > 0);
        const all = await loadIssues(root);
        const lines = r.issues.map((x) => `- ${x.page} · ${x.where} · ${x.kind}: ${x.detail}${x.fix ? " [fixable]" : ""}`);
        return text(`Pages ${from + 1}–${r.next ?? r.pages} of ${r.pages}: ${r.issues.length} issues (${all.length} saved so far). next=${r.next ?? "null"}\n${lines.join("\n").slice(0, 14000)}`);
      } catch (e) {
        return text(e instanceof Error ? e.message : "failed", true);
      }
    },
  },
  {
    name: "sitecopy_repair",
    annotations: { title: "Repair the staging copy from the saved compare", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: "Fixes the issues saved by sitecopy_compare on STAGING: copies missing/wrong images again, sets focal points, copies incomplete engagements again, fills empty texts, then republishes the pages on staging. Production is only read. Run again while issues are left.",
    inputSchema: { type: "object", properties: { root: { type: "string" } } },
    async run(args, actor) {
      try {
        const root = String(args.root ?? "unlock-singapore");
        const issues = await loadIssues(root);
        const r = await repairCampaign(issues);
        await saveIssues(root, r.left, false);
        console.log(`[connector] ${actor} sitecopy repair ${root}: ${r.done.length} done, ${r.failed.length} failed`);
        return text(`${r.done.length} fixed, ${r.failed.length} failed, ${r.left.length} left.\nFixed:\n${r.done.join("\n").slice(0, 8000)}\nFailed:\n${r.failed.join("\n")}`);
      } catch (e) {
        return text(e instanceof Error ? e.message : "failed", true);
      }
    },
  },
  {
    name: "sitemap_queue_build",
    annotations: { title: "Queue a full Figma rebuild for the sitemap plugin", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: "Queues a full rebuild of all sitemap screens for the AF1 Ktulu Sync Figma plugin: the next time the plugin opens it builds every page and card journey from staging and records the state. reset=true also forgets the last sync state (use when Figma was cleared).",
    inputSchema: { type: "object", properties: { campaign: { type: "string" }, reset: { type: "boolean" } } },
    async run(args, actor) {
      const c = String(args.campaign ?? "sin");
      if (args.reset) await resetSync(c);
      await queueCommand(c, "build-v4", actor); // only the v4 plugin (São Paulo layout) picks this up
      return text(`Queued: the plugin rebuilds all ${c} screens the next time it opens${args.reset ? " (sync state reset)" : ""}.`);
    },
  },
  {
    name: "sitemap_status",
    annotations: { title: "Sitemap sync status (Figma ↔ tool ↔ staging)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: "Shows a campaign's sitemap sync state: staging pages with their modules and synced texts, the last Figma plugin report and the open differences (Figma newer, CMS newer, conflicts). Campaign key: sin.",
    inputSchema: { type: "object", properties: { campaign: { type: "string", description: "Campaign key, default sin" } } },
    async run(args) {
      try {
        const s = await sitemapStatus(String(args.campaign ?? "sin"));
        const pages = s.pages.map((p) => `- /${p.url} (${p.id}) · ${p.blocks.length} modules · ${p.blocks.reduce((n, b) => n + b.fields.length, 0)} texts`).join("\n");
        const diffs = s.diffs.filter((d) => d.state !== "missing-in-figma").slice(0, 40).map((d) => `- ${d.state} · /${d.page} · ${d.block} · ${d.layer}: figma=${JSON.stringify(d.figma)} cms=${JSON.stringify(d.cms)}`).join("\n");
        return text(`${s.campaign.name}: ${s.pages.length} pages, ${s.inSync}/${s.total} texts in sync, last sync ${s.syncedAt ?? "never"}, Figma report ${s.figma?.reportedAt ?? "none"}, ${s.pending} pending for Figma.\n${pages}\n\nDifferences:\n${diffs || "none"}`);
      } catch (e) {
        return text(e instanceof Error ? e.message : "failed", true);
      }
    },
  },
  {
    name: "sitecopy_run",
    annotations: { title: "Copy production pages to staging (resumable)", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description:
      "Copies a set of PRODUCTION pages (a campaign) to the STAGING CMS with everything they reference (images, Team Cards with engagements, engagements, content tags, links between the pages) and publishes them on staging. Start with name + pageIds (production page ids); continue with jobId until it says finished (each call works ~40 s). Production is only read.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Continue this job" },
        name: { type: "string", description: "Job name for a new job, e.g. SIN Campaign" },
        pageIds: { type: "array", items: { type: "string" }, description: "Production page ids for a new job" },
        folder: { type: "string", description: "Staging media folder for copied images (default: job name)" },
      },
    },
    async run(args, actor) {
      try {
        let id = String(args.jobId ?? "");
        if (!id) {
          const ids = ((args.pageIds as string[]) ?? []).map(String).filter((x) => /^[a-f0-9]{24}$/.test(x));
          if (!ids.length) return text("pageIds required for a new job", true);
          const j = await startJob(String(args.name ?? "Site copy"), ids, String(args.folder ?? args.name ?? "Site copy"));
          id = j.id;
        } else if (!(await readJob(id))) return text("job not found", true);
        const j = await stepJob(id);
        console.log(`[connector] ${actor} sitecopy ${id}: ${jobSummary(j)}`);
        return text(`${jobSummary(j)}\nLast log:\n${j.log.slice(-25).join("\n")}`);
      } catch (e) {
        return text(e instanceof Error ? e.message : "failed", true);
      }
    },
  },
  {
    name: "teamcard_list",
    annotations: { title: "List Team Cards", readOnlyHint: true, openWorldHint: false },
    description: "Team Cards in the configurator: id, name, status, mechanic, reward type, where the module sits, staging links. Start here for questions or bulk changes.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const cards = await listCards();
      return text(cards.map((c) => `${c.id} · ${c.name} · ${c.status} · mechanic ${c.mechanic ?? "?"} · reward ${c.rewardType ?? "?"} · ${c.placement ?? ""} · ${stagingLinks(c).badge}`).join("\n") || "No cards yet.");
    },
  },
  {
    name: "teamcard_get",
    annotations: { title: "Read a Team Card", readOnlyHint: true, openWorldHint: false },
    description: "All editable fields of one Team Card with their keys, EN and DE values, the step they belong to (Card, Logged-out reveal, Reward and CTA, Engagement, Module, Settings), limits and options. Use the keys in teamcard_propose.",
    inputSchema: { type: "object", required: ["card"], properties: { card: { type: "string", description: "e.g. TC-037" } } },
    async run(args) {
      const c = await getCard(String(args.card ?? ""));
      if (!c) return text("Card not found. Call teamcard_list.", true);
      const lines = FIELDS.map((f) => {
        const v = c.values[f.key];
        const val = f.localized ? `EN: ${JSON.stringify((v as LocValue)?.en ?? "")} | DE: ${JSON.stringify((v as LocValue)?.de ?? "")}` : `value: ${JSON.stringify(v)}`;
        return `[${f.step}] ${f.key} (${f.label}${f.maxWords ? `, max ${f.maxWords} words` : ""}${f.options ? `, one of ${f.options.join("/")}` : ""}${f.localized ? "" : ", not per language"}) ${val}`;
      });
      const rules = rulesText(await listRules(), (k) => FIELDS.find((f) => f.key === k)?.label ?? k);
      return text(`${c.id} · ${c.name} · status ${c.status}\n${lines.join("\n")}\n\nWriting rules (follow them in every text you propose; the team keeps them in Team Cards → Lexicon):\n${rules}\nLast changes: ${c.log.slice(0, 3).map((l) => `${l.at.slice(0, 16)} ${l.summary}`).join("; ")}`);
    },
  },
  {
    name: "teamcard_propose",
    annotations: { title: "Preview Team Card changes", readOnlyHint: true, openWorldHint: false },
    description:
      "Preview changes to one or many Team Cards WITHOUT writing anything. changes = [{card, key, locale (\"en\"|\"de\", omit for fields that are not per language), value}]. Before calling: ask the user which cards and fields, and whether to change English AND German (write the German as a transcreation). Returns a before/after table with rule issues and a changeset id. Show the table, fix issues, and only call teamcard_apply after the user says yes.",
    inputSchema: {
      type: "object",
      required: ["changes"],
      properties: {
        changes: {
          type: "array",
          items: { type: "object", required: ["card", "key", "value"], properties: { card: { type: "string" }, key: { type: "string" }, locale: { type: "string", enum: ["en", "de"] }, value: { type: ["string", "boolean"] } } },
        },
      },
    },
    async run(args) {
      const changes = (args.changes as Change[]) ?? [];
      const { rows, errors } = diff(await listCards(), changes);
      if (!rows.length) return text(`Nothing to change.${errors.length ? `\n${errors.join("\n")}` : ""}`, errors.length > 0);
      const id = await saveChangeset(changes);
      const table = rows.map((r) => `| ${r.card} | ${r.label}${r.locale ? ` ${r.locale.toUpperCase()}` : ""} | ${JSON.stringify(r.before)} | ${JSON.stringify(r.after)} | ${r.issues.join("; ") || "ok"} |`);
      return text(`Changeset ${id} (nothing written yet)\n| Card | Field | Before | After | Check |\n|---|---|---|---|---|\n${table.join("\n")}${errors.length ? `\nNot included:\n${errors.join("\n")}` : ""}\nAsk the user to confirm, then call teamcard_apply with changeset "${id}".`);
    },
  },
  {
    name: "teamcard_apply",
    annotations: { title: "Apply Team Card changes to staging", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description: "Applies a changeset from teamcard_propose AFTER the user confirmed it: updates the card records and pushes the changed fields to the STAGING CMS (badge, engagement, module; the module's page is republished on staging). Returns what was written and any errors.",
    inputSchema: { type: "object", required: ["changeset"], properties: { changeset: { type: "string" } } },
    async run(args, actor) {
      const changes = await readChangeset(String(args.changeset ?? ""));
      if (!changes) return text("Changeset not found or expired. Run teamcard_propose again.", true);
      const r = await applyChanges(changes, actor);
      const cards = await listCards();
      const links = [...new Set(r.applied.map((a) => a.card))].map((id) => { const c = cards.find((x) => x.id === id)!; const l = stagingLinks(c); return `${id}: ${[l.badge, l.engagement, l.page].filter(Boolean).join(" · ")}`; });
      return text(`Applied ${r.applied.length} change(s).\n${r.pushed.map((p) => `✓ ${p}`).join("\n")}${r.errors.length ? `\n✗ ${r.errors.join("\n✗ ")}` : ""}\nStaging: ${links.join("\n")}\nNow suggest the next step to the user.`, r.errors.length > 0 && r.applied.length === 0);
    },
  },
];

// One generic entry point so new actions work without reconnecting the
// connector (claude.ai caches the tool list): ktulu_run {action, args}
// runs any tool above by name.
TOOLS.push({
  name: "ktulu_run",
  annotations: { title: "Run an AF1 Tools action", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: "Runs any AF1 Tools action by name with its arguments, including actions added after the connector was connected. action = tool name (e.g. sitecopy_run), args = its arguments. Call with action \"list\" to see all actions.",
  inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" }, args: { type: "object" } } },
  async run(args, actor) {
    const name = String(args.action ?? "");
    if (name === "list") return text(TOOLS.filter((t) => t.name !== "ktulu_run").map((t) => `${t.name}: ${t.description.slice(0, 160)}`).join("\n"));
    const t = TOOLS.find((x) => x.name === name && x.name !== "ktulu_run");
    if (!t) return text(`Unknown action ${name}. Call with action "list".`, true);
    return t.run((args.args as Record<string, unknown>) ?? {}, actor);
  },
});

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
