"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bookStore } from "@/lib/photobookStore";
import type { Book } from "@/lib/photobook";
import { newId } from "@/lib/batchStore";
import { renderPage } from "@/lib/photobookRender";
import { zineMockup } from "@/lib/zineMockup";

// Photobook (prototype): after a Grand Prix the team turns its SlashLens
// selection into a printable 16-page mini book (two A4 sheets) plus a fan
// microsite (draft page on the staging CMS) and a share page for the QR.
export default function PhotobookList() {
  const router = useRouter();
  const [books, setBooks] = useState<Book[] | null>(null);
  useEffect(() => {
    bookStore.list().then(setBooks);
  }, []);

  const [busy, setBusy] = useState<string | null>(null);
  // "The collection" slider: every published zine's cover as a 3D booklet
  async function refreshCollection() {
    const list = (books ?? []).filter((b) => b.stagingPageId && b.slug && b.photos.length);
    if (!list.length) return;
    const mockups: { pageSlug: string; mediaId: string }[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        setBusy(`Cover ${i + 1} of ${list.length}: ${b.gpName}`);
        const canvas = await renderPage(b, 1, (id) => bookStore.getPhoto(b.id, id), window.location.origin);
        const blob = await zineMockup(canvas);
        const name = `audif1_${b.year}_${b.loc.toUpperCase()}_GP_mini-zine_collection.jpg`;
        const form = new FormData();
        form.append("file", blob, name);
        form.append("name", name);
        form.append("alt", `The Audi Revolut F1® Team GP Mini-Zine for the ${b.gpName} ${b.year}, cover on a booklet`);
        const up = await fetch("/api/photobook/upload", { method: "POST", body: form }).then((r) => r.json());
        if (up.id) mockups.push({ pageSlug: `gp-mini-zine-${b.slug}`, mediaId: up.id });
      }
      setBusy("Updating the collection slider on all zine pages…");
      const r = await fetch("/api/photobook/collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mockups }) }).then((x) => x.json());
      setBusy(r.ok ? `Done: ${mockups.length} covers, slider updated on ${r.editions} zine pages.` : `Failed: ${r.error}`);
    } catch (e) {
      setBusy(`Failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  async function updateMaster() {
    setBusy("Building the master preview from the newest zine…");
    const r = await fetch("/api/photobook/master", { method: "POST" }).then((x) => x.json()).catch(() => ({ error: "network" }));
    setBusy(r.ok ? `Done: master preview built from ${r.from}. ${r.previewUrl}` : `Failed: ${r.error}`);
  }

  async function create() {
    const now = new Date().toISOString();
    const b: Book = {
      id: newId(),
      slug: "",
      createdAt: now,
      updatedAt: now,
      gpName: "",
      city: "",
      loc: "",
      year: new Date().getFullYear(),
      dateLabel: "",
      hashtags: ["#ARF1"],
      instagram: "audif1",
      source: "",
      photos: [],
      order: [],
    };
    await bookStore.put(b);
    router.push(`/photobook/${b.id}`);
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <section className="page-head reveal">
        <div>
          <div className="section-label" style={{ marginBottom: 8 }}>GP Mini-Zine · prototype</div>
          <h1>GP Mini-Zine</h1>
          <p>
            The SlashLens selection of a Grand Prix becomes a printable 16-page GP Mini-Zine (two A4 sheets, one cut each, no glue) with a QR
            code on the back, plus a fan page on the staging CMS to download it.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => void refreshCollection()} disabled={!!busy && !/^(Done|Failed)/.test(busy)} title="Renders each published zine's cover as a 3D booklet and updates the collection slider on all zine pages">
            Update collection images
          </button>
          <button className="btn" onClick={() => void updateMaster()} title="Fills the master preview page (gp-mini-zine-master) with the newest zine">
            Update master preview
          </button>
          <button className="btn btn-primary" onClick={create}>
            New photobook
          </button>
        </div>
      </section>

      {busy && <div role="status" className="card" style={{ padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>{busy}</div>}
      {books === null && <p style={{ color: "var(--muted)" }}>Loading…</p>}
      {books?.length === 0 && <div className="card" style={{ padding: 18, color: "var(--muted)", fontSize: 13 }}>No photobooks yet. Books live in this browser until a page is published to the CMS.</div>}
      <div style={{ display: "grid", gap: 10 }}>
        {books?.map((b) => (
          <Link key={b.id} href={`/photobook/${b.id}`} className="card reveal" style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", textDecoration: "none", color: "inherit" }}>
            <span>
              <strong style={{ fontFamily: "var(--font-heading)" }}>{b.gpName || "Untitled zine"}</strong>
              <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 10 }}>
                {b.photos.length} photos{b.stagingPageUrl ? " · page on staging" : ""}
              </span>
            </span>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>{new Date(b.updatedAt).toLocaleString("en-GB")}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
