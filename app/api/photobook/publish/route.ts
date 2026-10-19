import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { upsertDraftPage } from "@/lib/payloadClient";
import { refreshCollections, setZineMockup } from "@/lib/zineCollection";
import {
  buildZineBottom,
  buildZineMeta,
  buildZineSections,
  zinePageSlug,
  zinePageTitle,
  type ZineAssets,
  type ZineIds,
  type ZineMeta,
} from "@/lib/zinePage";
import { ensureZineAssets } from "@/lib/zineAssets";
import { ZINE_SITE } from "@/lib/photobook";

// Builds the GP Mini-Zine fan page as a DRAFT on the staging CMS from media
// already uploaded via /api/photobook/upload (cover + the three PDFs):
// hero, login-gated download teaser with the preview video, how-to slider,
// share buttons and "The collection" slider with every zine page built so
// far. The slider is refreshed on the other zine pages too. Nothing is
// published; an editor reviews it in the CMS.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = { meta: ZineMeta; coverId: string; mockupId?: string; pdfs: ZineIds["pdfs"] };

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b?.meta?.slug || !b.coverId) return NextResponse.json({ error: "meta and coverId required" }, { status: 400 });
  const steps: string[] = [];
  try {
    let assets: ZineAssets | null = null;
    try {
      assets = await ensureZineAssets(req.nextUrl.origin);
      steps.push("how-to media ready");
    } catch (e) {
      steps.push(`how-to media missing (${e instanceof Error ? e.message.slice(0, 80) : "error"})`);
    }
    const m = b.meta;
    const zids = { coverMedia: b.coverId, pdfs: b.pdfs, pageUrl: `${ZINE_SITE}/${zinePageSlug(m)}` };
    const sections = [...buildZineSections(m, assets, zids), ...buildZineBottom(m, assets, zids)];
    const page = await upsertDraftPage(zinePageSlug(m), {
      title: zinePageTitle(m),
      authRequirement: "PUBLIC",
      sections,
      meta: buildZineMeta(m, b.coverId),
    });
    steps.push(page.created ? "draft page created" : "draft page updated");

    // The collection: every zine page on the CMS (this one included), newest first.
    try {
      if (b.mockupId) await setZineMockup(zinePageSlug(m), b.mockupId);
      const n = await refreshCollections({ id: page.id, slug: zinePageSlug(m), sections, entry: { pageId: page.id, slug: zinePageSlug(m), gpName: m.gpName, year: String(m.year), coverMedia: b.mockupId ?? b.coverId } });
      steps.push(`collection slider: ${n} edition${n === 1 ? "" : "s"}`);
    } catch (e) {
      steps.push(`collection slider skipped (${e instanceof Error ? e.message.slice(0, 80) : "error"})`);
    }

    console.log(`[zine] ${session.user.email} built draft page ${page.id} for ${m.slug}`);
    return NextResponse.json({ ok: true, steps, pageId: page.id, pageAdminUrl: page.adminUrl, pageUrl: `${ZINE_SITE}/${zinePageSlug(m)}` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed", steps }, { status: 502 });
  }
}
