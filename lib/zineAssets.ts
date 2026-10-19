// Server-only: the GP Mini-Zine how-to illustrations and the teaser
// animation live in /public/zine/media. They are uploaded to the staging
// media library once (folder "GP Mini-Zine") and the ids cached in KV, so
// every GP page reuses the same media.
import { kvGet, kvSet } from "./kv";
import { createMediaFolder, listMediaFolders, uploadToCollection } from "./payloadClient";
import { ZINE_STEPS, type ZineAssets } from "./zinePage";

const KEY = "zine:assets:v3"; // v3: how-to steps as photos (hands folding the zine)
const KEY_V2 = "zine:assets:v2";
const KEY_V1 = "zine:assets:v1";
const FOLDER = "GP Mini-Zine";

export async function zineFolder(): Promise<string | null> {
  try {
    const all = await listMediaFolders();
    const hit = all.find((f) => f.name === FOLDER && !f.parent);
    if (hit) return hit.id;
    return (await createMediaFolder(FOLDER, null)).id;
  } catch {
    return null;
  }
}

export async function ensureZineAssets(origin: string, force = false): Promise<ZineAssets> {
  if (!force) {
    const raw = await kvGet(KEY).catch(() => null);
    if (raw) return JSON.parse(raw) as ZineAssets;
  }
  const folder = await zineFolder();
  const up = async (file: string, alt: string) => {
    const res = await fetch(`${origin}/zine/media/${file}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`asset ${file}: ${res.status}`);
    const blob = await res.blob();
    return (await uploadToCollection("media", blob, file, { alt, ...(folder ? { folder } : {}) })).id;
  };
  const photoSteps = async () => {
    const out: string[] = [];
    for (let i = 0; i < ZINE_STEPS.length; i++) {
      const n = String(i + 1).padStart(2, "0");
      out.push(await up(`audif1_gp-mini-zine_photo-step-${n}.jpg`, `GP Mini-Zine how-to, step ${i + 1}: ${ZINE_STEPS[i].headline}. Hands folding the printed zine (AI-generated photo).`));
    }
    return out;
  };
  // v2 assets (teaser, preview video) are reused; only the how-to photos are new
  const v2raw = force ? null : await kvGet(KEY_V2).catch(() => null);
  if (v2raw) {
    const v2 = JSON.parse(v2raw) as ZineAssets;
    const assets = { ...v2, steps: await photoSteps() };
    await kvSet(KEY, JSON.stringify(assets));
    return assets;
  }
  const preview = await up("audif1_gp-mini-zine_preview.mp4", "Animation: the Audi Revolut F1® Team GP Mini-Zine opens and turns its pages, from the colour-in cover to the colouring book pages");
  // v1 assets (how-to illustrations, fold animation) are reused, not uploaded twice
  const v1raw = force ? null : await kvGet(KEY_V1).catch(() => null);
  if (v1raw) {
    const v1 = JSON.parse(v1raw) as ZineAssets;
    const assets = { ...v1, preview, steps: await photoSteps() };
    await kvSet(KEY, JSON.stringify(assets));
    return assets;
  }
  const teaser = await up("audif1_gp-mini-zine_teaser.mp4", "Animation: an A4 sheet of Grand Prix photos is cut and folded into the Audi Revolut F1® Team GP Mini-Zine");
  const steps = await photoSteps();
  const assets = { teaser, steps, preview };
  await kvSet(KEY, JSON.stringify(assets));
  return assets;
}
