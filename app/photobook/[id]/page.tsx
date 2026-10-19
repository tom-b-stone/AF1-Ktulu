"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import JSZip from "jszip";
import { signIn } from "next-auth/react";
import Modal from "@/app/components/Modal";
import ZineFlip from "../ZineFlip";
import { bookStore } from "@/lib/photobookStore";
import { BOOK_PAGES, INSIDE_PHOTOS, SHEETS, gpHashtag, pageContent, shareUrl, slugFor, zinePageUrl, type Book, type BookPhoto } from "@/lib/photobook";
import { ZINE_VARIANTS, buildPdf, renderPage, type ZineVariant } from "@/lib/photobookRender";
import { zineMockup } from "@/lib/zineMockup";
import { compressImage, thumbnail } from "@/lib/imageCompress";
import { newId } from "@/lib/batchStore";

type SlPick = { id: string; name: string; sub: string; tags: string[]; desc?: string; slot: string; thumb: string };
type SlResult = {
  ok: boolean;
  error?: string;
  weekend?: string;
  count?: number;
  source?: { type: "auto" } | { type: "collection"; id: string; name: string };
  cover?: SlPick | null;
  inside?: SlPick[];
  collections?: { id: string; name: string; n: number }[];
};
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const baseName = (n: string) => n.replace(/\.[^.]+$/, "").toLowerCase();

type Race = { round: number; label: string; country: string; city: string; start?: string; end?: string; loc: string; year: number };

const STEPS = ["Grand Prix & photos", "Arrange", "Print file", "Microsite"];

// Official race names ("Japanese Grand Prix", not "Suzuka Grand Prix").
const GP_BY_CITY: Record<string, string> = {
  Melbourne: "Australian", Shanghai: "Chinese", Suzuka: "Japanese", Miami: "Miami", "Montréal": "Canadian", Montreal: "Canadian",
  Jeddah: "Saudi Arabian", "Monte Carlo": "Monaco", Barcelona: "Barcelona-Catalunya", Madrid: "Spanish", Spielberg: "Austrian",
  Silverstone: "British", Spa: "Belgian", Budapest: "Hungarian", Zandvoort: "Dutch", Monza: "Italian", Baku: "Azerbaijan",
  "Kuala Lumpur": "Malaysian", "Marina Bay": "Singapore", Singapore: "Singapore", Austin: "United States", "Mexico City": "Mexico City",
  "São Paulo": "São Paulo", "Las Vegas": "Las Vegas", Doha: "Qatar", Lusail: "Qatar", "Abu Dhabi": "Abu Dhabi", Sakhir: "Bahrain",
};
function gpTitle(r: { city: string; country: string }) {
  return GP_BY_CITY[r.city] ?? (r.city === r.country || !r.city ? r.country : r.city);
}

function dateLabel(start?: string, end?: string): string {
  if (!start) return "";
  const s = new Date(start);
  const e = end ? new Date(end) : s;
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long" });
  if (s.getMonth() === e.getMonth()) return `${s.getDate()} to ${e.getDate()} ${month(e)} ${e.getFullYear()}`;
  return `${s.getDate()} ${month(s)} to ${e.getDate()} ${month(e)} ${e.getFullYear()}`;
}

export default function PhotobookEditor() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [book, setBook] = useState<Book | null | undefined>(undefined);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [races, setRaces] = useState<Race[] | null>(null);
  const [step, setStep] = useState(0);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  type Pdf = { url: string; blob: Blob; size: number };
  const [pdfs, setPdfs] = useState<Partial<Record<ZineVariant, Pdf>>>({});
  const [pdfView, setPdfView] = useState<ZineVariant>("photo");
  const pdf = pdfs.photo ?? null;
  const [building, setBuilding] = useState<{ done: number; total: number } | null>(null);
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);
  const [flip, setFlip] = useState<{ variant: ZineVariant; pages: string[] | null } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sl, setSl] = useState<SlResult | null>(null);
  const [slBusy, setSlBusy] = useState<"" | "pick" | "save" | "import">("");
  const [driveMissing, setDriveMissing] = useState(false);
  const [slOff, setSlOff] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set()); // step 1: photos picked for deleting
  const [confirmDel, setConfirmDel] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    bookStore.get(params.id).then(async (b) => {
      setBook(b ?? null);
      if (!b) return;
      const t: Record<string, string> = {};
      for (const p of b.photos) {
        const blob = await bookStore.getPhoto(b.id, p.id);
        if (blob) t[p.id] = await thumbnail(blob, 200);
      }
      setThumbs(t);
    });
    fetch("/api/assets/races")
      .then((r) => r.json())
      .then((j) => setRaces(j.races ?? []))
      .catch(() => setRaces([]));
  }, [params.id]);

  const save = useCallback(async (next: Book) => {
    setBook(next);
    await bookStore.put(next);
  }, []);

  const getPhoto = useCallback((photoId: string) => bookStore.getPhoto(params.id, photoId), [params.id]);

  // ---- step 1: race + photos -------------------------------------------
  function pickRace(r: Race) {
    if (!book) return;
    const gpName = `${gpTitle(r)} Grand Prix`;
    void save({
      ...book,
      round: r.round,
      gpName,
      city: r.city || r.country,
      loc: r.loc,
      year: r.year,
      dateLabel: dateLabel(r.start, r.end),
      slug: slugFor(r.year, r.loc),
      hashtags: ["#ARF1", gpHashtag(gpTitle(r))],
    });
  }

  async function addFiles(list: FileList | File[], base?: Book) {
    const bk = base ?? book;
    if (!bk) return;
    let files: File[] = Array.from(list);
    // a SlashLens collection download arrives as a ZIP: unpack the images
    const zips = files.filter((f) => /\.zip$/i.test(f.name));
    for (const z of zips) {
      const zip = await JSZip.loadAsync(z);
      const entries = Object.values(zip.files).filter((e) => !e.dir && /\.(jpe?g|png|webp|heic|tiff?)$/i.test(e.name) && !e.name.startsWith("__MACOSX"));
      for (const e of entries) files.push(new File([await e.async("blob")], e.name.split("/").pop() ?? e.name));
    }
    files = files.filter((f) => !/\.zip$/i.test(f.name) && (/^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|tiff?)$/i.test(f.name)));
    if (!files.length) return;
    setImporting({ done: 0, total: files.length });
    const photos: BookPhoto[] = [...bk.photos];
    const t = { ...thumbs };
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        // 2400 px long edge: enough for 300 dpi on a 74 × 105 mm page with room to crop
        const c = await compressImage(f, 2400, 0.86);
        const id = newId();
        await bookStore.putPhoto(bk.id, id, c.blob);
        photos.push({ id, name: f.name, width: c.width, height: c.height });
        t[id] = await thumbnail(c.blob, 200);
      } catch {
        /* skip unreadable files */
      }
      setImporting({ done: i + 1, total: files.length });
    }
    setThumbs(t);
    // first import: cover = first landscape-free (portrait) shot, inside = the rest in order
    let coverId = bk.coverId ?? (photos.find((p) => p.height >= p.width) ?? photos[0])?.id;
    let order = bk.order.length ? bk.order : photos.filter((p) => p.id !== coverId).slice(0, INSIDE_PHOTOS).map((p) => p.id);
    // photos from a SlashLens pick: cover and reading order as picked
    if (bk.pick && !bk.order.length) {
      const byName = new Map(photos.map((p) => [baseName(p.name), p.id]));
      const cov = bk.pick.coverName ? byName.get(baseName(bk.pick.coverName)) : undefined;
      if (cov) coverId = cov;
      const picked = bk.pick.names.map((n) => byName.get(baseName(n))).filter((x): x is string => !!x && x !== coverId);
      if (picked.length) order = picked.slice(0, INSIDE_PHOTOS);
    }
    await save({ ...bk, photos, coverId, order });
    setImporting(null);
  }

  // ---- SlashLens: auto pick ----------------------------------------------
  async function slashlensPick(auto = false, seed = 0) {
    if (!book) return;
    const r = races?.find((x) => x.round === book.round && x.year === book.year);
    setSlBusy("pick");
    setSlOff(new Set());
    try {
      const q = new URLSearchParams({ round: String(book.round ?? ""), city: book.city, country: r?.country ?? "", ...(auto ? { auto: "1" } : {}), ...(seed ? { seed: String(seed) } : {}) });
      const j = (await (await fetch(`/api/zine/slashlens?${q}`)).json()) as SlResult;
      setSl(j);
    } catch {
      setSl({ ok: false, error: "SlashLens not reachable" });
    } finally {
      setSlBusy("");
    }
  }
  async function slashlensImport() {
    if (!book || !sl?.weekend) return;
    const chosen = slChosen(sl);
    const coverName = sl.cover && !slOff.has(sl.cover.id) ? sl.cover.name : undefined;
    const next: Book = { ...book, order: [], source: `SlashLens › ${sl.weekend.replace(/_/g, " ")} › ${sl.source?.type === "collection" ? sl.source.name : "auto-select"}`, pick: { weekend: sl.weekend, coverName, names: chosen.map((p) => p.name) } };
    await save(next);
    setSlBusy("import");
    setImporting({ done: 0, total: chosen.length });
    const files: File[] = [];
    try {
      for (let i = 0; i < chosen.length; i++) {
        const p = chosen[i];
        if (next.photos.some((x) => x.name === p.name)) continue;
        const res = await fetch(`/api/zine/slashlens/photo?id=${encodeURIComponent(p.id)}`);
        if (res.status === 401) {
          setDriveMissing(true);
          throw new Error("Connect Google Drive first (button below), then import again.");
        }
        if (!res.ok) throw new Error(`${p.name}: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
        files.push(new File([await res.blob()], p.name, { type: "image/jpeg" }));
        setImporting({ done: i + 1, total: chosen.length });
      }
      setImporting(null);
      await addFiles(files, next);
      setNotice({ tone: "ok", text: `${files.length} photos from SlashLens are in the zine. Cover and order as picked; change them in step 2.` });
    } catch (e) {
      setImporting(null);
      setNotice({ tone: "err", text: e instanceof Error ? e.message : "Import failed" });
    } finally {
      setSlBusy("");
    }
  }
  const slChosen = (s: SlResult | null) => [...(s?.cover ? [s.cover] : []), ...(s?.inside ?? [])].filter((p) => !slOff.has(p.id));
  async function slashlensSave() {
    if (!book || !sl?.weekend) return;
    const chosen = slChosen(sl);
    let collectionId = sl.source?.type === "collection" ? sl.source.id : undefined;
    setSlBusy("save");
    try {
      if (!collectionId) {
        const res = await fetch("/api/zine/slashlens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekend: sl.weekend, name: `GP Mini-Zine ${book.loc}`, photoIds: chosen.map((p) => p.id) }) });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "save failed");
        collectionId = j.id;
      }
      await save({ ...book, source: `SlashLens › ${sl.weekend} › GP Mini-Zine ${book.loc}`, pick: { weekend: sl.weekend, coverName: sl.cover && !slOff.has(sl.cover.id) ? sl.cover.name : undefined, names: chosen.map((p) => p.name), collectionId } });
      setNotice({ tone: "ok", text: `Saved in SlashLens as "GP Mini-Zine ${book.loc}" under ${sl.weekend.replace(/_/g, " ")}.` });
    } catch (e) {
      setNotice({ tone: "err", text: `SlashLens: ${e instanceof Error ? e.message : "failed"}` });
    } finally {
      setSlBusy("");
    }
  }

  // ---- step 2: arrange --------------------------------------------------
  function toggleInside(id: string) {
    if (!book) return;
    const order = book.order.includes(id) ? book.order.filter((x) => x !== id) : book.order.length < INSIDE_PHOTOS ? [...book.order, id] : book.order;
    void save({ ...book, order });
  }
  function move(i: number, d: -1 | 1) {
    if (!book) return;
    const order = [...book.order];
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    void save({ ...book, order });
  }
  async function removePhoto(id: string) {
    await removePhotos([id]);
  }
  async function removePhotos(ids: string[]) {
    if (!book || !ids.length) return;
    const gone = new Set(ids);
    for (const id of ids) await bookStore.deletePhoto(book.id, id);
    await save({
      ...book,
      photos: book.photos.filter((p) => !gone.has(p.id)),
      order: book.order.filter((x) => !gone.has(x)),
      coverId: book.coverId && gone.has(book.coverId) ? undefined : book.coverId,
    });
    setSel(new Set());
    setConfirmDel(false);
    setNotice({ tone: "ok", text: `${ids.length} photo${ids.length === 1 ? "" : "s"} removed from this zine.` });
  }
  function toggleSel(id: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function previewPage(n: number) {
    if (!book) return;
    const c = await renderPage(book, n, getPhoto, origin);
    setPreview({ title: `Page ${n}`, url: c.toDataURL("image/jpeg", 0.85) });
  }

  async function openFlip(variant: ZineVariant) {
    if (!book) return;
    setFlip({ variant, pages: null });
    const pages: string[] = [];
    for (let n = 1; n <= BOOK_PAGES; n++) pages.push((await renderPage(book, n, getPhoto, origin, variant)).toDataURL("image/jpeg", 0.8));
    setFlip({ variant, pages });
  }

  // ---- step 3: PDFs (three editions) -------------------------------------
  async function makePdf() {
    if (!book) return;
    const total = BOOK_PAGES * ZINE_VARIANTS.length;
    setBuilding({ done: 0, total });
    setNotice(null);
    try {
      const next: Partial<Record<ZineVariant, Pdf>> = {};
      for (let i = 0; i < ZINE_VARIANTS.length; i++) {
        const v = ZINE_VARIANTS[i].key;
        const bytes = await buildPdf(book, getPhoto, origin, (done) => setBuilding({ done: i * BOOK_PAGES + done, total }), v);
        const blob = new Blob([bytes], { type: "application/pdf" });
        next[v] = { url: URL.createObjectURL(blob), blob, size: blob.size };
      }
      Object.values(pdfs).forEach((p) => p && URL.revokeObjectURL(p.url));
      setPdfs(next);
    } catch (e) {
      setNotice({ tone: "err", text: `PDF failed: ${e instanceof Error ? e.message : "error"}` });
    }
    setBuilding(null);
  }

  // ---- step 4: fan page -------------------------------------------------
  async function upload(file: Blob, name: string, alt: string): Promise<string> {
    const form = new FormData();
    form.append("file", file, name);
    form.append("name", name);
    form.append("alt", alt);
    const res = await fetch("/api/photobook/upload", { method: "POST", body: form });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${name}: ${j.error ?? res.status}`);
    return j.id as string;
  }
  async function publish() {
    if (!book || !pdfs.photo || !book.coverId) return;
    setPublishing(true);
    setNotice(null);
    try {
      const cover = await getPhoto(book.coverId);
      if (!cover) throw new Error("cover photo missing in this browser");
      const base = `audif1_${book.year}_${book.loc.toUpperCase()}_GP_mini-zine`;
      const coverId = await upload(cover, `${base}_cover.jpg`, `Cover of the Audi Revolut F1® Team GP Mini-Zine for the ${book.gpName} ${book.year}`);
      // collection slider image: the rendered cover on a slightly 3D booklet
      let mockupId: string | undefined;
      try {
        const mock = await zineMockup(await renderPage(book, 1, getPhoto, origin));
        mockupId = await upload(mock, `${base}_collection.jpg`, `The Audi Revolut F1® Team GP Mini-Zine for the ${book.gpName} ${book.year}, cover on a booklet`);
      } catch {
        /* the slider falls back to the cover photo */
      }
      const ids: Partial<Record<ZineVariant, string>> = {};
      for (const v of ZINE_VARIANTS) {
        const p = pdfs[v.key];
        if (p) ids[v.key] = await upload(p.blob, `${base}_${v.file}.pdf`, `GP Mini-Zine ${book.gpName} ${book.year}, ${v.label} (print PDF)`);
      }
      const meta = { slug: book.slug, gpName: book.gpName, city: book.city, loc: book.loc, year: book.year, dateLabel: book.dateLabel, hashtags: book.hashtags, instagram: book.instagram };
      const res = await fetch("/api/photobook/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meta, coverId, mockupId, pdfs: ids }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${j.error ?? res.status}${j.steps?.length ? ` (done: ${j.steps.join(", ")})` : ""}`);
      await save({ ...book, stagingPageId: j.pageId, stagingPageUrl: j.pageAdminUrl });
      setNotice({ tone: "ok", text: `Done. Draft page on staging with cover and three PDFs. ${j.steps.join(", ")}.` });
    } catch (e) {
      setNotice({ tone: "err", text: `Not published: ${e instanceof Error ? e.message : "error"}` });
    }
    setPublishing(false);
  }

  const ready1 = Boolean(book?.slug && book.photos.length >= 2);
  const insideCount = book?.order.length ?? 0;
  const pages = useMemo(() => (book ? Array.from({ length: BOOK_PAGES }, (_, i) => ({ n: i + 1, c: pageContent(book, i + 1) })) : []), [book]);

  if (book === undefined) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (book === null) return <p>GP Mini-Zine not found in this browser.</p>;

  return (
    <div style={{ maxWidth: 1080 }}>
      <section className="page-head reveal">
        <div>
          <div className="section-label" style={{ marginBottom: 8 }}>GP Mini-Zine · prototype</div>
          <h1>{book.gpName ? `${book.gpName} ${book.year}` : "New GP Mini-Zine"}</h1>
          <p>16 pages on two A4 sheets: cover, intro, {INSIDE_PHOTOS} photos, back with QR code to the share page.</p>
        </div>
        <button
          className="btn"
          onClick={async () => {
            await bookStore.remove(book.id);
            router.push("/photobook");
          }}
          style={{ color: "#e06c5b" }}
        >
          Delete
        </button>
      </section>

      <ol style={{ display: "flex", gap: 8, listStyle: "none", padding: 0, margin: "0 0 22px" }}>
        {STEPS.map((s, i) => (
          <li key={s} style={{ flex: 1 }}>
            <button
              onClick={() => setStep(i)}
              disabled={i > 0 && !ready1}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${step === i ? "var(--accent)" : "var(--border)"}`,
                background: step === i ? "rgba(255,45,0,0.08)" : "var(--bg-2)",
                color: "inherit",
                cursor: "pointer",
                opacity: i > 0 && !ready1 ? 0.45 : 1,
                fontFamily: "var(--font-heading)",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              <span style={{ color: "var(--accent)", marginRight: 8 }}>{i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      {notice && (
        <div role="status" style={{ background: notice.tone === "ok" ? "#122a18" : "#2a1512", border: `1px solid ${notice.tone === "ok" ? "#2e7d4f" : "#c0392b"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
          {notice.text}
        </div>
      )}

      {step === 0 && (
        <div style={{ display: "grid", gap: 14 }}>
          <div className="card" style={{ padding: 16 }}>
            <div className="section-label" style={{ marginBottom: 10 }}>Grand Prix</div>
            {!races && <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading the race calendar…</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 6 }}>
              {races?.map((r) => {
                const active = book.round === r.round && book.year === r.year;
                return (
                  <button
                    key={r.round}
                    onClick={() => pickRace(r)}
                    style={{ textAlign: "left", padding: "8px 10px", borderRadius: 8, border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, background: active ? "rgba(255,45,0,0.1)" : "transparent", color: "inherit", cursor: "pointer", fontSize: 12 }}
                  >
                    <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}>
                      R{String(r.round).padStart(2, "0")} {r.country}
                    </div>
                    <div style={{ color: "var(--muted)" }}>{r.city} · {r.start?.slice(0, 10)}</div>
                  </button>
                );
              })}
            </div>
            {book.slug && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                  Dates (cover + intro)
                  <input className="input" value={book.dateLabel} onChange={(e) => void save({ ...book, dateLabel: e.target.value })} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                  Hashtags
                  <input className="input" value={book.hashtags.join(" ")} onChange={(e) => void save({ ...book, hashtags: e.target.value.split(/\s+/).filter(Boolean) })} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                  Instagram handle (confirm)
                  <input className="input" value={book.instagram} onChange={(e) => void save({ ...book, instagram: e.target.value.replace(/^@/, "") })} />
                </label>
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
            <div className="section-label">Photos from SlashLens</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary" disabled={!book.round || slBusy !== ""} onClick={() => void slashlensPick(false)}>
                {slBusy === "pick" ? "Looking in SlashLens…" : "Auto-select 14 from SlashLens"}
              </button>
              {sl?.ok && (
                <button className="btn" disabled={slBusy !== ""} onClick={() => void slashlensPick(true, Date.now() % 100000)} title="New automatic selection from the same weekend">
                  ↻ Reload auto-selection
                </button>
              )}
              <a className="btn" href="https://slashlens.netlify.app/" target="_blank" rel="noreferrer">
                Open SlashLens ↗
              </a>
              {!book.round && <span style={{ fontSize: 12, color: "var(--muted)" }}>Choose the Grand Prix first.</span>}
            </div>
            {sl && !sl.ok && <div style={{ fontSize: 12, color: "#e9c46a" }}>{sl.error}</div>}
            {sl?.ok && (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {sl.weekend?.replace(/_/g, " ")} · {sl.count} photos in SlashLens ·{" "}
                  {sl.source?.type === "collection" ? <>team collection &quot;{sl.source.name}&quot;</> : "automatic pick: car on track, both drivers, details, garage, atmosphere; one shot per burst, race days first"}
                  {" "}· click a photo to leave it out
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
                  {[...(sl.cover ? [sl.cover] : []), ...(sl.inside ?? [])].map((p, i) => {
                    const off = slOff.has(p.id);
                    return (
                      <button
                        key={p.id}
                        title={`${p.name}\n${p.desc ?? ""}\n${p.tags.join(", ")}`}
                        onClick={() => setSlOff((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                        style={{ padding: 0, border: `2px solid ${i === 0 && sl.cover ? "var(--vapor-rose)" : off ? "transparent" : "var(--accent)"}`, borderRadius: 8, overflow: "hidden", background: "var(--surface)", cursor: "pointer", position: "relative", opacity: off ? 0.35 : 1 }}
                      >
                        {/* Drive thumbnail, loads with the viewer's Google session */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.thumb} alt="" referrerPolicy="no-referrer" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                        <span style={{ position: "absolute", left: 4, bottom: 4, fontSize: 10, background: "rgba(0,0,0,0.65)", color: "#fff", borderRadius: 4, padding: "1px 5px" }}>
                          {i === 0 && sl.cover ? "cover" : p.slot}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="btn btn-primary" disabled={slBusy !== "" || !slChosen(sl).length} onClick={() => void slashlensImport()}>
                    {slBusy === "import" ? `Loading photos ${importing?.done ?? 0}/${importing?.total ?? 0}…` : `Use these ${slChosen(sl).length} in the zine`}
                  </button>
                  {sl.source?.type === "auto" && (
                    <button className="btn" disabled={slBusy !== "" || !slChosen(sl).length} onClick={() => void slashlensSave()}>
                      {slBusy === "save" ? "Saving…" : "Also save as SlashLens collection"}
                    </button>
                  )}
                  {driveMissing && (
                    <button
                      className="btn"
                      onClick={() => void signIn("google", { callbackUrl: window.location.href }, { scope: `openid email profile ${DRIVE_SCOPE}`, access_type: "offline", prompt: "consent", include_granted_scopes: "true" })}
                    >
                      Connect Google Drive (read only)
                    </button>
                  )}
                </div>
                {driveMissing && (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    The photos are read with your own Google account, the same access you have in SlashLens. One-time permission, read only.
                  </div>
                )}
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
              Or pick by hand: collect the photos in a SlashLens collection under the race weekend and download it (↓).
            </div>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              SlashLens collection (name or link, for the record)
              <input className="input" value={book.source} onChange={(e) => void save({ ...book, source: e.target.value })} placeholder="R17 Singapore › GP Mini-Zine" />
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className="card"
              style={{ minHeight: 160, display: "grid", placeItems: "center", textAlign: "center", cursor: "pointer", borderStyle: "dashed", borderWidth: 2, borderColor: dragging ? "var(--accent)" : "var(--border-2)", background: dragging ? "rgba(255,45,0,0.06)" : "var(--bg-2)" }}
            >
              <input ref={inputRef} type="file" accept="image/*,.zip" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
              <div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 20, fontWeight: 800 }}>
                  {importing ? `Importing ${importing.done}/${importing.total}…` : "Drop the SlashLens selection"}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>ZIP or photos · 14 is ideal (1 cover + 13 inside)</div>
              </div>
            </div>
            {book.photos.length > 0 && (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12, color: "var(--muted)" }}>
                  <span style={{ marginRight: "auto" }}>
                    {book.photos.length} photos{sel.size ? ` · ${sel.size} selected` : " · click photos to select them"}
                  </span>
                  <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setSel(sel.size === book.photos.length ? new Set() : new Set(book.photos.map((p) => p.id)))}>
                    {sel.size === book.photos.length ? "Select none" : "Select all"}
                  </button>
                  <button
                    className="btn"
                    disabled={!sel.size}
                    style={{ padding: "4px 10px", fontSize: 12, borderColor: sel.size ? "#c0392b" : undefined, color: sel.size ? "#ff8a7a" : undefined }}
                    onClick={() => (confirmDel ? void removePhotos([...sel]) : setConfirmDel(true))}
                    onBlur={() => setConfirmDel(false)}
                  >
                    {confirmDel ? `Yes, delete ${sel.size}` : `Delete selected${sel.size ? ` (${sel.size})` : ""}`}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6 }}>
                  {book.photos.map((p) => {
                    const on = sel.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          setConfirmDel(false);
                          toggleSel(p.id);
                        }}
                        aria-pressed={on}
                        title={p.name}
                        style={{ padding: 0, position: "relative", border: `2px solid ${on ? "#ff5a3c" : "transparent"}`, borderRadius: 8, overflow: "hidden", background: "var(--surface)", cursor: "pointer", aspectRatio: "1" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbs[p.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: on ? 0.55 : 1 }} />
                        <span
                          aria-hidden
                          style={{ position: "absolute", top: 4, left: 4, width: 18, height: 18, borderRadius: 999, border: "1.5px solid #fff", background: on ? "#ff5a3c" : "rgba(0,0,0,0.35)", color: "#fff", fontSize: 11, lineHeight: "15px", textAlign: "center" }}
                        >
                          {on ? "\u2713" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" disabled={!ready1} onClick={() => setStep(1)}>
                Next: Arrange
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={{ display: "grid", gap: 14 }}>
          <div className="card" style={{ padding: 16 }}>
            <div className="section-label" style={{ marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
              <span>The book, page by page</span>
              <span>click a page for a print preview</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 8 }}>
              {pages.map(({ n, c }) => {
                const pid = c.kind === "cover" || c.kind === "photo" ? c.photoId : undefined;
                return (
                  <button key={n} onClick={() => void previewPage(n)} style={{ padding: 0, border: "1px solid var(--border)", borderRadius: 6, background: c.kind === "back" ? "#E33E1A" : c.kind === "intro" ? "#2B2929" : "#F5F2F2", aspectRatio: "74 / 105", position: "relative", overflow: "hidden", cursor: "pointer" }}>
                    {pid && thumbs[pid] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbs[pid]} alt="" style={{ position: "absolute", inset: c.kind === "cover" ? 0 : "6% 6% 14% 6%", width: c.kind === "cover" ? "100%" : "88%", height: c.kind === "cover" ? "100%" : "80%", objectFit: "cover", ...(c.kind === "cover" && (book.coverStyle ?? "outline") === "outline" ? { filter: "grayscale(1) contrast(3) brightness(1.6)", opacity: 0.5 } : {}) }} />
                    )}
                    <span style={{ position: "absolute", left: 4, bottom: 2, fontSize: 10, fontWeight: 800, color: c.kind === "photo" ? "#E33E1A" : "#F5F2F2", textShadow: c.kind === "cover" ? "0 1px 3px #000" : "none" }}>
                      {c.kind === "cover" ? "Cover" : c.kind === "intro" ? "Intro" : c.kind === "back" ? "QR" : String(n).padStart(2, "0")}
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
              Print layout: {SHEETS.map((s) => `${s.name}: pages ${s.bookPages.join(", ")}`).join(" · ")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <span className="section-label">Cover</span>
              {([
                ["outline", "Line drawing to colour in"],
                ["photo", "Full photo"],
              ] as const).map(([v, label]) => (
                <button key={v} className={`btn ${(book.coverStyle ?? "outline") === v ? "btn-primary" : ""}`} style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => void save({ ...book, coverStyle: v })}>
                  {label}
                </button>
              ))}
              <button className="btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => void previewPage(1)}>
                Preview cover
              </button>
              <button className="btn btn-primary" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => void openFlip(book.coverStyle === "photo" ? "photo" : "diy")}>
                ▶ Flip through
              </button>
              {(book.coverStyle ?? "outline") === "outline" && (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Clear shapes work best: a helmet, a driver portrait, a car side-on. Busy crowd shots get messy.</span>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
            <div className="card" style={{ padding: 16 }}>
              <div className="section-label" style={{ marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
                <span>All photos</span>
                <span>☆ cover · click to add / remove inside ({insideCount}/{INSIDE_PHOTOS})</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
                {book.photos.map((p) => {
                  const idx = book.order.indexOf(p.id);
                  const isCover = book.coverId === p.id;
                  return (
                    <div key={p.id} style={{ position: "relative" }}>
                      <button
                        onClick={() => toggleInside(p.id)}
                        style={{ padding: 0, border: `2px solid ${idx >= 0 ? "var(--accent)" : isCover ? "var(--vapor-rose)" : "transparent"}`, borderRadius: 8, overflow: "hidden", width: "100%", aspectRatio: "1", cursor: "pointer", background: "var(--surface)" }}
                        title={p.name}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumbs[p.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: idx >= 0 || isCover ? 1 : 0.55 }} />
                      </button>
                      {idx >= 0 && <span style={{ position: "absolute", top: 4, left: 4, background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "1px 7px" }}>{String(idx + 3).padStart(2, "0")}</span>}
                      <button onClick={() => void save({ ...book, coverId: p.id, order: book.order.filter((x) => x !== p.id) })} title="Use as cover" style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", border: "none", color: isCover ? "#ffd166" : "#fff", borderRadius: 999, width: 22, height: 22, cursor: "pointer", fontSize: 12 }}>
                        {isCover ? "★" : "☆"}
                      </button>
                      <button onClick={() => void removePhoto(p.id)} title="Remove" style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", borderRadius: 999, width: 22, height: 22, cursor: "pointer", fontSize: 12 }}>
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div className="section-label" style={{ marginBottom: 10 }}>Inside order</div>
              <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
                {book.order.map((id, i) => (
                  <li key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 22, color: "var(--accent)", fontWeight: 700 }}>{String(i + 3).padStart(2, "0")}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbs[id]} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 4 }} />
                    <span className="truncate" style={{ flex: 1, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.photos.find((p) => p.id === id)?.name}</span>
                    <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => move(i, 1)} disabled={i === book.order.length - 1}>↓</button>
                  </li>
                ))}
              </ol>
              {insideCount < INSIDE_PHOTOS && <div style={{ fontSize: 12, color: "#e9c46a", marginTop: 8 }}>{INSIDE_PHOTOS - insideCount} pages left empty: they repeat photos from the start.</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button className="btn btn-primary" onClick={() => setStep(2)} disabled={!book.coverId}>
                  Next: Print file
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
          <div className="section-label">Print files (PDF)</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--muted)" }}>
            Three editions, each two A4 landscape sheets at 300 dpi plus a folding guide: <b>Photo zine</b>, <b>DIY cover</b> (light grey line drawing to colour in, photos inside) and the <b>Colouring book</b> (every page a line drawing). Top rows print upside down on purpose; cut only the red dashed line.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={makePdf} disabled={Boolean(building)}>
              {building ? `Rendering ${building.done}/${building.total}…` : pdf ? "Rebuild the 3 PDFs" : "Build the 3 PDFs"}
            </button>
            {ZINE_VARIANTS.map((v) => {
              const p = pdfs[v.key];
              return p ? (
                <a key={v.key} className="btn" href={p.url} download={`${book.slug || "zine"}_gp-mini-zine_${v.file}.pdf`}>
                  {v.label} ({(p.size / 1024 / 1024).toFixed(1)} MB)
                </a>
              ) : null;
            })}
            {pdf && (
              <button className="btn btn-primary" onClick={() => setStep(3)} style={{ marginLeft: "auto" }}>
                Next: Fan page
              </button>
            )}
          </div>
          {pdf && (
            <div style={{ display: "flex", gap: 6 }}>
              {ZINE_VARIANTS.map((v) => (
                <button key={v.key} className={`btn ${pdfView === v.key ? "btn-primary" : ""}`} style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setPdfView(v.key)}>
                  PDF: {v.label}
                </button>
              ))}
              {ZINE_VARIANTS.map((v) => (
                <button key={`f-${v.key}`} className="btn" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => void openFlip(v.key)}>
                  ▶ Flip: {v.label}
                </button>
              ))}
            </div>
          )}
          {pdfs[pdfView] && <iframe title="PDF preview" src={pdfs[pdfView]!.url} style={{ width: "100%", height: 560, border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }} />}
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="card" style={{ padding: 16, display: "grid", gap: 10, alignContent: "start" }}>
            <div className="section-label">Fan page on staging (draft)</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--muted)" }}>
              Uploads the cover and the three PDFs to the staging media library (folder &quot;GP Mini-Zine&quot;) and builds the draft page <code>gp-mini-zine-{book.slug}</code>: hero, download teaser with the preview video (logged out: log in / register; logged in: three download buttons), how-to slider, share buttons.
            </div>
            {!pdf && <div style={{ fontSize: 12, color: "#e9c46a" }}>Build the PDFs first (step 3).</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={publish} disabled={!pdf || publishing}>
                {publishing ? "Uploading to staging…" : book.stagingPageId ? "Update draft page" : "Create draft page"}
              </button>
              {book.stagingPageUrl && (
                <a className="btn" href={book.stagingPageUrl} target="_blank" rel="noreferrer">
                  Edit in the CMS ↗
                </a>
              )}
            </div>
          </div>
          <div className="card" style={{ padding: 16, display: "grid", gap: 10, alignContent: "start" }}>
            <div className="section-label">Fan page (QR + share target)</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--muted)" }}>
              The QR code on the back and the share buttons open the fan page on the website. It shows once the page is published on staging. Tracking: utm_source=gp_mini_zine, utm_medium=print_qr.
            </div>
            <code style={{ fontSize: 11, wordBreak: "break-all" }}>{shareUrl(origin, book)}</code>
            <div style={{ display: "flex", gap: 8 }}>
              <a className="btn" href={zinePageUrl(book)} target="_blank" rel="noreferrer">
                Open fan page ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {flip && (
        <Modal title={`Flip through: ${ZINE_VARIANTS.find((v) => v.key === flip.variant)?.label}`} onClose={() => setFlip(null)} width={760}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {ZINE_VARIANTS.map((v) => (
              <button key={v.key} className={`btn ${flip.variant === v.key ? "btn-primary" : ""}`} style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => void openFlip(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
          {flip.pages ? <ZineFlip key={flip.variant} pages={flip.pages} height={440} /> : <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Rendering the 16 pages…</div>}
        </Modal>
      )}

      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)} width={420}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt="" style={{ width: "100%", borderRadius: 6, display: "block" }} />
        </Modal>
      )}
    </div>
  );
}
