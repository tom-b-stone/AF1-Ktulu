// In-tool alt text generation: one photo per call to the Anthropic Messages
// API. The prefix (rulebook + reference photos) is identical for every photo
// of a run and marked for prompt caching, so a 100-photo batch pays for the
// references once. Same validation as the connector's asset_set_meta.
import { ALT_MAX, cleanDescriptor, knowledgeIssues, validateAlt } from "./assetNaming";
import { rulebook } from "./assetPrompt";
import { SCENE_TAGS, type Scene } from "./contentTags";
import type { Correction } from "./feedbackStore";
import type { AltExample } from "./examplesStore";
import type { RefMeta } from "./referenceStore";
import type { KnowledgeEntry } from "./teamKnowledge";
import type { ServerBatch, ServerRow } from "./assetBatchStore";

export type Described = { descriptor: string; alt: string; people: string[]; scene: Scene; usage?: { input: number; output: number; cached: number } };

type Block =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string }; cache_control?: { type: "ephemeral" } };

const SYSTEM = `You write English alt texts and file-name descriptors for photos of the Audi Revolut F1® Team (audif1.com). You follow the rulebook exactly. You answer with one JSON object only, no prose, no code fence:
{"descriptor": "...", "alt": "...", "people": ["..."], "scene": "..."}
- alt: one sentence, under ${ALT_MAX} characters, only what is visible, team name exactly "Audi Revolut F1® Team" when the team is mentioned, no em-dash.
- descriptor: 2–6 lowercase ASCII words joined with hyphens, what the picture shows, no team name.
- people: official names from the rulebook, only with evidence (car number, name on suit or helmet, a face that matches a reference photo). Otherwise [].
- scene: exactly one of "team" (one or two people are the focus of the picture), "on-track & garage" (the car, the crew at work or the action on track is the subject) or "off-track" (paddock, fans, city, events). Never "team" and "on-track & garage" together.`;

export async function describePhoto(opts: {
  apiKey: string;
  model: string;
  batch: ServerBatch;
  row: ServerRow;
  preview: { mime: string; data: string };
  knowledge: KnowledgeEntry[];
  examples: AltExample[];
  refs: { meta: RefMeta; image: { mime: string; data: string } }[];
  corrections: Correction[];
}): Promise<Described> {
  const { batch, row } = opts;
  const prefix: Block[] = [{ type: "text", text: `RULEBOOK\n${rulebook(opts.knowledge, opts.examples, opts.refs.map((r) => r.meta), opts.corrections)}` }];
  for (const r of opts.refs) {
    prefix.push({ type: "text", text: `Reference photo of ${r.meta.person}${r.meta.note ? ` — ${r.meta.note}` : ""}:` });
    prefix.push({ type: "image", source: { type: "base64", media_type: r.image.mime, data: r.image.data } });
  }
  // cache boundary: everything above is the same for every photo of the run
  prefix[prefix.length - 1].cache_control = { type: "ephemeral" };

  const facts = [
    `Grand Prix: ${batch.race ?? batch.loc}${batch.round ? ` (round ${batch.round})` : ""}, ${batch.year}`,
    batch.session ? `Session / day: ${batch.session}` : "",
    row.date ? `Date: ${row.date}` : "",
    `Original file name: ${row.originalName}`,
    row.people?.length ? `Known people in this photo: ${row.people.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const ask = (extra: string): Block[] => [
    ...prefix,
    { type: "text", text: `PHOTO TO DESCRIBE\n${facts}${extra ? `\n\n${extra}` : ""}` },
    { type: "image", source: { type: "base64", media_type: opts.preview.mime, data: opts.preview.data } },
    { type: "text", text: "Answer with the JSON object only." },
  ];

  let extra = "";
  let last: Described | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model, max_tokens: 400, system: SYSTEM, messages: [{ role: "user", content: ask(extra) }] }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as { content: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number } };
    const textOut = json.content.map((c) => c.text ?? "").join("");
    const m = textOut.match(/\{[\s\S]*\}/);
    if (!m) {
      extra = "Your last answer was not a JSON object. Answer with the JSON object only.";
      continue;
    }
    let parsed: { descriptor?: string; alt?: string; people?: unknown; scene?: string };
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      extra = "Your last answer was not valid JSON. Answer with the JSON object only.";
      continue;
    }
    const alt = String(parsed.alt ?? "").trim().replace(/\s+/g, " ");
    const descriptor = cleanDescriptor(String(parsed.descriptor ?? ""));
    const people = Array.isArray(parsed.people) ? parsed.people.map(String).filter(Boolean) : [];
    const scene = (SCENE_TAGS as readonly string[]).includes(String(parsed.scene)) ? (parsed.scene as Scene) : "on-track & garage";
    const issues = [...validateAlt(alt), ...knowledgeIssues(alt, opts.knowledge), ...(descriptor ? [] : ["Descriptor is empty"])];
    last = {
      descriptor,
      alt,
      people,
      scene,
      usage: json.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens, cached: json.usage.cache_read_input_tokens ?? 0 } : undefined,
    };
    if (issues.length === 0) return last;
    extra = `Your previous answer broke these rules, fix them:\n${issues.join("\n")}\nPrevious: ${JSON.stringify({ descriptor: parsed.descriptor, alt: parsed.alt })}`;
  }
  if (!last) throw new Error("No usable answer from Claude");
  return last; // second attempt still has issues: hand it back, the table flags them
}
