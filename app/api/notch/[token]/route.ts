import { NextRequest, NextResponse } from "next/server";
import { resolvePluginToken } from "@/lib/connectorTokens";
import { listRaces } from "@/lib/races";
import { listContentTags, nextNumberInFolder, payloadFetchPublic, uploadMedia } from "@/lib/payloadClient";
import { ALT_MAX, CONTEXTS, cleanDescriptor, proposeFileName, type Context } from "@/lib/assetNaming";

// Endpoint for the AF1 Notch app (mac-notch/ in this repo): drop images on the
// MacBook notch, they arrive here as WebP and go to the staging media library
// with the Asset Uploader's naming rule, folder and content tags.
// Auth: the personal plugin token (Team Cards → Figma Sync → Setup) in the path.
//   GET  → races of the season with their folders, content tags, contexts
//   POST { action: "upload", data, round, folder?, context?, descriptor, alt, tags[] }
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: { token: string } };
const NO_TOKEN = "Unknown token. Create one in Ktulu under Team Cards → Figma Sync → Setup.";

export async function GET(_req: NextRequest, ctx: Ctx) {
  const rec = await resolvePluginToken(ctx.params.token);
  if (!rec) return NextResponse.json({ error: NO_TOKEN }, { status: 401 });
  try {
    const [races, tags] = await Promise.all([listRaces(payloadFetchPublic), listContentTags()]);
    return NextResponse.json({
      user: rec.email,
      races: races.map((r) => ({ round: r.round, label: r.label, country: r.country, city: r.city, start: r.start ?? null, end: r.end ?? null, loc: r.loc, year: r.year, folderId: r.folderId ?? null, folderPath: r.folderPath ?? null, sessions: r.sessions })),
      tags: tags.map((t) => t.title).sort(),
      contexts: CONTEXTS,
      altMax: ALT_MAX,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const rec = await resolvePluginToken(ctx.params.token);
  if (!rec) return NextResponse.json({ error: NO_TOKEN }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { action?: string; data?: string; round?: number; folder?: string; context?: string; descriptor?: string; alt?: string; tags?: string[] } | null;
  if (b?.action !== "upload") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  try {
    const bytes = Buffer.from(String(b.data ?? ""), "base64");
    if (!bytes.byteLength) return NextResponse.json({ error: "no image" }, { status: 400 });
    if (bytes.byteLength > 4_000_000) return NextResponse.json({ error: "image over 4 MB" }, { status: 400 });
    if (bytes.subarray(8, 12).toString("ascii") !== "WEBP") return NextResponse.json({ error: "WebP only" }, { status: 400 });
    const alt = String(b.alt ?? "").trim();
    if (!alt) return NextResponse.json({ error: "alt text required" }, { status: 400 });
    if (alt.length > ALT_MAX) return NextResponse.json({ error: `alt text over ${ALT_MAX} characters` }, { status: 400 });
    const race = (await listRaces(payloadFetchPublic)).find((r) => r.round === Number(b.round));
    if (!race) return NextResponse.json({ error: "pick the Grand Prix" }, { status: 400 });
    const folder = b.folder || race.folderId;
    if (!folder) return NextResponse.json({ error: `no media folder for ${race.label} yet: create it in the Asset Uploader` }, { status: 400 });
    const context = (CONTEXTS as readonly string[]).includes(String(b.context)) ? (b.context as Context) : "";
    const descriptor = cleanDescriptor(String(b.descriptor ?? ""));
    // the number continues per folder: audif1_2026_BRA_GP_gallery_paddock-walk_07.webp
    const prefix = proposeFileName({ year: race.year, loc: race.loc, context, descriptor, nn: 0 }).replace(/_00\.webp$/, "");
    const nn = await nextNumberInFolder(folder, prefix);
    const filename = proposeFileName({ year: race.year, loc: race.loc, context, descriptor, nn });
    const all = await listContentTags();
    const wanted = (b.tags ?? []).map((t) => String(t).toLowerCase());
    const tagIds = all.filter((t) => wanted.includes(t.title.toLowerCase())).map((t) => t.id);
    const doc = await uploadMedia(new Blob([bytes], { type: "image/webp" }), filename, alt, folder, tagIds);
    console.log(`[notch] ${rec.email} uploaded ${doc.filename} → ${folder}`);
    return NextResponse.json({ ok: true, id: doc.id, filename: doc.filename, url: doc.url, admin: `https://staging.audif1team.com/cms/admin/collections/media/${doc.id}` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "upload failed" }, { status: 502 });
  }
}
