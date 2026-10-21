// Images from the Figma sync and the page builder go through the Asset
// Uploader's alt-text step: Claude describes each image with the same rulebook,
// people references, examples and corrections as in the Asset Uploader, and the
// descriptor names the file (audif1_{year}_{LOC}_GP_{context}_{descriptor}_{nn}).
import { getAnthropicSettings } from "./settings";
import { readKnowledge } from "./knowledgeStore";
import { readExamples } from "./examplesStore";
import { listReferences, readReferenceImage } from "./referenceStore";
import { readCorrections } from "./feedbackStore";
import { describePhoto } from "./claudeDescribe";
import type { ServerBatch, ServerRow } from "./assetBatchStore";

const REFS_PER_PERSON = 3;

export type FigmaImageText = { alt: string; descriptor: string; scene?: string };

// null when no Claude key is set (Admin → Claude API): the caller keeps its fallback
export async function describeFigmaImage(opts: {
  preview: { mime: string; data: string };
  race: string;
  loc: string;
  year: number;
  label: string; // where the image sits, e.g. "Hub · hero"
}): Promise<FigmaImageText | null> {
  const s = await getAnthropicSettings();
  if (!s) return null;
  const [knowledge, examples, allRefs, corrections] = await Promise.all([readKnowledge(), readExamples(), listReferences(), readCorrections()]);
  const picked: typeof allRefs = [];
  for (const r of [...allRefs].reverse()) if (picked.filter((p) => p.person === r.person).length < REFS_PER_PERSON) picked.push(r);
  picked.reverse();
  const refs = (await Promise.all(picked.map(async (meta) => ({ meta, image: await readReferenceImage(meta.id) })))).filter(
    (r): r is { meta: (typeof picked)[number]; image: { mime: string; data: string } } => Boolean(r.image),
  );
  const row: ServerRow = { id: "figma", originalName: `Figma landing page image (${opts.label})`, fileName: "", context: "", descriptor: "", alt: "", width: 0, height: 0 };
  const batch: ServerBatch = { id: "figma", owner: "figma", updatedAt: new Date().toISOString(), folderPath: "", year: opts.year, loc: opts.loc, race: opts.race, rows: [row] };
  const out = await describePhoto({ apiKey: s.key, model: s.model, batch, row, preview: opts.preview, knowledge, examples, refs, corrections });
  return { alt: out.alt, descriptor: out.descriptor, scene: out.scene };
}

// alt texts the page builder wrote before Claude did it ("Hub, hero image") or a bare layer/frame name
export const placeholderAlt = (alt: string | undefined) => !alt || /, (gallery|hero|teaser|quote|recap|wallpaper|postcard|racetrack) image$/i.test(alt) || /^(Rectangle|Frame|Image|Mobile)\b/i.test(alt);
