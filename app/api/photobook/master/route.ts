import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { upsertDraftPage } from "@/lib/payloadClient";
import { ensureZineAssets } from "@/lib/zineAssets";
import { collectionEntries } from "@/lib/zineCollection";
import { buildCollectionSection, buildZineBottom, buildZineMeta, buildZineSections, withCollection, type ZineIds, type ZineMeta } from "@/lib/zinePage";
import { ZINE_SITE } from "@/lib/photobook";

// The master preview of the GP Mini-Zine fan page (draft "gp-mini-zine-master"):
// the current template filled with the newest zine (its cover, PDFs, city,
// hashtags), so the pitch deck always links to the latest layout.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const SLUG = "gp-mini-zine-master";
const idOf = (m: Json): string | undefined => (typeof m === "string" ? m : m?.id);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { pages, entries } = await collectionEntries();
    const src = pages.find((p) => entries.some((e) => e.pageId === p.id));
    const e = entries.find((x) => x.pageId === src?.id);
    if (!src || !e) return NextResponse.json({ error: "no zine page on staging yet" }, { status: 404 });
    const secs = (src.sections ?? []) as Json[];
    const hero = secs.find((s) => s.blockType === "hero");
    const out = secs.find((s) => s.blockType === "teaser" && s.authRequirement === "LOGGED_OUT");
    const inn = secs.find((s) => s.blockType === "teaser" && s.authRequirement === "AUTHENTICATED");
    const share = secs.find((s) => s.anchorId === "share");
    const city = String(out?.headline ?? "").match(/^Your (.+?) (edition|zine)/)?.[1] ?? e.gpName.replace(/ Grand Prix$/, "");
    const tagLine = String(share?.copy ?? "").match(/post it with (.+?) and tag @([\w.]+)/);
    const pdf = (label: RegExp) => idOf((inn?.ctas ?? []).find((c: Json) => label.test(String(c.label)))?.asset);
    const meta: ZineMeta = {
      slug: src.slug.replace(/^gp-mini-zine-/, ""),
      gpName: e.gpName,
      city,
      loc: (src.slug.split("-").pop() ?? "").toUpperCase(),
      year: Number(e.year),
      dateLabel: "",
      hashtags: tagLine ? tagLine[1].split(/\s+/) : ["#ARF1"],
      instagram: tagLine?.[2] ?? "audif1",
    };
    const ids: ZineIds = {
      coverMedia: idOf(hero?.container?.background?.imageSettings?.media) ?? e.coverMedia,
      pageUrl: `${ZINE_SITE}/${src.slug}`,
      pdfs: { photo: pdf(/photo/i), diy: pdf(/diy/i), colouring: pdf(/colouring/i) },
    };
    const assets = await ensureZineAssets(req.nextUrl.origin).catch(() => null);
    const sections = withCollection([...buildZineSections(meta, assets, ids), ...buildZineBottom(meta, assets, ids)], buildCollectionSection(entries, e.pageId));
    const page = await upsertDraftPage(SLUG, { title: "GP Mini-Zine | Master preview", authRequirement: "PUBLIC", sections, meta: buildZineMeta(meta, ids.coverMedia) });
    return NextResponse.json({ ok: true, from: src.slug, pageId: page.id, adminUrl: page.adminUrl, previewUrl: `${ZINE_SITE}/${SLUG}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 502 });
  }
}
