// Server-only: "The collection" slider on every GP Mini-Zine fan page.
// Each zine can have a mockup image (its rendered cover on a slightly 3D
// booklet, made in the zine tool); without one the tile shows the cover photo.
import { kvGet, kvSet } from "./kv";
import { listDraftPages, patchDraftSections } from "./payloadClient";
import { buildCollectionSection, withCollection, zineEntryOf, type ZineEntry } from "./zinePage";

const mockKey = (pageSlug: string) => `zine:mockup:${pageSlug}`;

export async function setZineMockup(pageSlug: string, mediaId: string) {
  await kvSet(mockKey(pageSlug), mediaId);
}

// Rebuilds the slider on all zine pages. `fresh` = a page just written whose
// sections the list may not show yet (draft read-after-write).
// All zine pages (newest first) with their slider entries, mockups applied.
export async function collectionEntries() {
  const pages = await listDraftPages("gp-mini-zine-");
  const entries = pages.map(zineEntryOf).filter((e): e is ZineEntry => !!e);
  for (const e of entries) {
    const m = await kvGet(mockKey(e.slug)).catch(() => null);
    if (m) e.coverMedia = m;
  }
  return { pages, entries };
}

export async function refreshCollections(fresh?: { id: string; slug: string; sections: Record<string, unknown>[]; entry: ZineEntry }) {
  const { pages, entries } = await collectionEntries();
  if (fresh && !entries.some((e) => e.pageId === fresh.id)) entries.unshift(fresh.entry);
  const targets = [...(fresh ? [{ id: fresh.id, sections: fresh.sections }] : []), ...pages.filter((x) => x.id !== fresh?.id && zineEntryOf(x)).map((x) => ({ id: x.id, sections: (x.sections ?? []) as Record<string, unknown>[] }))];
  for (const t of targets) await patchDraftSections(t.id, withCollection(t.sections, buildCollectionSection(entries, t.id)));
  return entries.length;
}
