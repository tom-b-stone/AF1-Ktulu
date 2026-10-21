import { NextRequest, NextResponse } from "next/server";
import { resolveNotchToken } from "@/lib/connectorTokens";
import { listRaces } from "@/lib/races";
import { payloadFetchPublic } from "@/lib/payloadClient";
import { addPart, startInbox } from "@/lib/assetInbox";

// Endpoint for the AF1 Notch Mac app (mac-notch/ in this repo). The app only
// collects: images dropped on the notch plus the Grand Prix and folder. They
// wait in an inbox until the Asset Uploader in the browser takes them over
// (/assets?inbox=…): WebP, alt texts by Claude, names, tags, upload.
// Auth: the app's own token (Asset Uploader → Mac app → Connect) in the path.
//   GET  → races of the season with their session folders
//   POST { action: "start", round, session? }                      → { inbox }
//   POST { action: "add", inbox, file?, name, mime, parts, part, data } → one chunk of one image
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: { token: string } };
const NO_TOKEN = "Unknown token. Create one in Ktulu: Asset Uploader → Mac app.";

export async function GET(_req: NextRequest, ctx: Ctx) {
  const rec = await resolveNotchToken(ctx.params.token);
  if (!rec) return NextResponse.json({ error: NO_TOKEN }, { status: 401 });
  try {
    const races = await listRaces(payloadFetchPublic);
    return NextResponse.json({
      user: rec.email,
      races: races.map((r) => ({ round: r.round, label: r.label, country: r.country, city: r.city, start: r.start ?? null, end: r.end ?? null, loc: r.loc, year: r.year, folderPath: r.folderPath ?? null, sessions: r.sessions.map((s) => s.name) })),
      sessions: ["THU", "FRI", "FP1", "FP2", "FP3", "Qualifying", "Sprint", "Race", "Postcards", "Challenge", "Wallpaper", "Off-Track"],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const rec = await resolveNotchToken(ctx.params.token);
  if (!rec) return NextResponse.json({ error: NO_TOKEN }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { action?: string; round?: number; session?: string; inbox?: string; file?: string; name?: string; mime?: string; parts?: number; part?: number; data?: string } | null;
  try {
    if (b?.action === "start") {
      const box = await startInbox(rec.email, b.round ? Number(b.round) : undefined, b.session || undefined);
      return NextResponse.json({ inbox: box.id, open: `/assets?inbox=${box.id}` });
    }
    if (b?.action === "add") {
      if (!b.inbox || !b.name || !b.data) return NextResponse.json({ error: "inbox, name and data required" }, { status: 400 });
      return NextResponse.json(await addPart(b.inbox, { id: b.file, name: b.name, mime: b.mime || "image/jpeg", parts: Number(b.parts ?? 1) }, Number(b.part ?? 0), b.data));
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
