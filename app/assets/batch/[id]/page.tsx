"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import JSZip from "jszip";
import { Table, type TableColumn } from "@/components/ui/table-editable";
import { batchStore, type AssetRow, type Batch } from "@/lib/batchStore";
import { fmtBytes } from "@/lib/imageCompress";
import { ALT_MAX, CONTEXTS, cleanDescriptor, descriptorFromAlt, knowledgeIssues, proposeFileName, validateAlt, type Context } from "@/lib/assetNaming";
import type { KnowledgeEntry } from "@/lib/teamKnowledge";
import FolderPicker from "@/app/components/FolderPicker";
import Modal from "@/app/components/Modal";
import { SideButton, SideSection, useSidebarContent } from "@/app/components/SidebarSlot";
import Steps from "@/app/components/Steps";
import TagPicker from "@/app/components/TagPicker";
import { SCENE_TAGS, isPersonTag, missingPersonTags, oneScene, peopleInText, proposeBatchTags, proposeRowTags, tagIssues, uniqueTags, withPeople, type ContentTag } from "@/lib/contentTags";
import { compressImage } from "@/lib/imageCompress";

type Row = AssetRow & { key: string; thumb?: string; issues: string[]; nn: number };
type Described = { alt: string; descriptor?: string; people?: string[]; scene?: string };

// What comes back from Claude (claude.ai via the connector, or the in-tool
// API) lands on a row here: people also from the alt text (car number,
// name), the descriptor with the driver in front, a descriptive file name
// right away (number set at upload), and the people + scene content tags.
function applyDescribed(b: Batch, r: AssetRow, out: Described, knowledge: KnowledgeEntry[], tagTitles: string[]): AssetRow {
  const alt = out.alt;
  const base = cleanDescriptor(out.descriptor || "") || r.descriptor || descriptorFromAlt(alt);
  const people = uniqueTags(out.people, peopleInText(`${alt} ${base}`, knowledge));
  const descriptor = withPeople(base, people);
  const proposed = proposeRowTags({ people, scene: out.scene ?? r.scene }, tagTitles);
  return {
    ...r,
    alt,
    descriptor,
    fileName: proposeFileName({ year: b.year, loc: b.loc, context: r.context as Context | "", descriptor, nn: 0, ext: r.mime === "image/webp" ? "webp" : "jpg" }),
    people,
    scene: out.scene ?? r.scene,
    tags: oneScene(uniqueTags(r.tags, proposed), out.scene ?? r.scene),
    ai: { people, scene: out.scene ?? r.scene, tags: proposed },
  };
}

export default function BatchPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [batch, setBatch] = useState<Batch | null | undefined>(undefined);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickFolder, setPickFolder] = useState(false);
  const [confirmUpload, setConfirmUpload] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [dialogRow, setDialogRow] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [teachPerson, setTeachPerson] = useState("");
  const [teachNote, setTeachNote] = useState("");
  const [teaching, setTeaching] = useState(false);
  // Claude hand-off: previews + meta go to the server, claude.ai opens with
  // the prompt, and this page polls the server copy until every alt text
  // is back (or 15 minutes pass).
  const [gen, setGen] = useState<{ phase: "sync" | "waiting" | "api"; done: number; total: number; got: number; failed?: number } | null>(null);
  const [apiMode, setApiMode] = useState<{ configured: boolean; model: string | null } | null>(null);
  const stopRef = useRef(false);
  useEffect(() => {
    fetch("/api/assets/generate")
      .then((r) => r.json())
      .then((j) => setApiMode({ configured: Boolean(j.configured), model: j.model ?? null }))
      .catch(() => setApiMode({ configured: false, model: null }));
  }, []);
  const [hasConnector, setHasConnector] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/connector")
      .then((r) => r.json())
      .then((j) => setHasConnector(Boolean(j.active)))
      .catch(() => setHasConnector(false));
  }, []);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  // content tags: the staging vocabulary (titles are the identity)
  const [tags, setTags] = useState<ContentTag[] | null>(null);
  const [seeding, setSeeding] = useState(false);
  const tagTitles = useMemo(() => (tags ?? []).map((t) => t.title), [tags]);
  // Arriving from Claude's "Back to the batch" link (?step=3): pull what
  // Claude wrote on the server into the local rows once, then show step 3.
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (!batch || synced || tags === null) return;
    if (!new URLSearchParams(window.location.search).has("step")) return;
    setSynced(true);
    (async () => {
      try {
        const srv = await fetch(`/api/assets/batch/${batch.id}`).then((r) => r.json());
        if (!srv?.rows) return;
        let n = 0;
        const fresh = (await batchStore.get(batch.id)) ?? batch;
        const rows = fresh.rows.map((r) => {
          const sr = srv.rows.find((x: { id: string }) => x.id === r.id);
          if (!sr?.alt || r.alt.trim() || r.status === "uploaded") return r;
          n++;
          return applyDescribed(fresh, r, sr, knowledge, tagTitles);
        });
        if (n) {
          await save({ ...fresh, rows });
          setNotice(`Picked up ${n} alt text${n === 1 ? "" : "s"} written by Claude. Check them, then upload.`);
        }
        document.getElementById("batch-steps")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.id, tags]);
  // Rows that already have an alt text (older batches, typed by hand):
  // name the file after it and add the tags of the people in it. A person
  // tag the team removed once is not added again (it stays in row.ai).
  const backfillKey = useRef("");
  const triedCreate = useRef(new Set<string>());
  useEffect(() => {
    if (!batch || tags === null || knowledge.length === 0) return;
    const key = `${batch.id}:${tags.length}:${knowledge.length}`;
    if (backfillKey.current === key) return;
    backfillKey.current = key;
    (async () => {
      const b = (await batchStore.get(batch.id)) ?? batch;
      const found = b.rows.map((r) => (r.alt.trim() ? uniqueTags(r.people, peopleInText(`${r.alt} ${r.descriptor}`, knowledge)) : []));
      // driver / team tags that staging does not have yet: create them once
      const missing = uniqueTags(...found.map((p) => missingPersonTags(p, tagTitles))).filter((t) => !triedCreate.current.has(t));
      if (missing.length) {
        for (const t of missing) {
          triedCreate.current.add(t);
          await createTag(t);
        }
        return; // runs again with the new vocabulary
      }
      let changed = 0;
      const rows = b.rows.map((r, i) => {
        if (!r.alt.trim() || r.status === "uploaded") return r;
        const people = found[i];
        const descriptor = r.descriptor || withPeople(descriptorFromAlt(r.alt), people);
        const fileName = proposeFileName({ year: b.year, loc: b.loc, context: r.context as Context | "", descriptor, nn: 0, ext: r.mime === "image/webp" ? "webp" : "jpg" });
        const seen = r.ai?.tags ?? [];
        const add = proposeRowTags({ people }, tagTitles).filter((t) => !seen.includes(t) && !(r.tags ?? []).includes(t));
        const peopleChanged = people.length !== (r.people ?? []).length;
        if (descriptor === r.descriptor && fileName.replace(/_\d+\./, ".") === r.fileName.replace(/_\d+\./, ".") && !add.length && !peopleChanged) return r;
        changed++;
        return {
          ...r,
          descriptor,
          fileName,
          people,
          tags: oneScene(uniqueTags(r.tags, add), r.scene),
          ai: { people: r.ai?.people ?? people, scene: r.ai?.scene ?? r.scene, tags: uniqueTags(seen, add) },
        };
      });
      if (changed) await save({ ...b, rows });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.id, batch?.rows, tags, knowledge]);
  useEffect(() => {
    fetch("/api/assets/tags")
      .then((r) => r.json())
      .then((j) => setTags(j.tags ?? []))
      .catch(() => setTags([]));
  }, []);
  // first time a batch meets the vocabulary: propose year + GP + day + session
  useEffect(() => {
    if (!batch || !tags || batch.tags !== undefined) return;
    const proposed = proposeBatchTags({ year: batch.year, loc: batch.loc, race: batch.race, session: batch.session }, tagTitles);
    void save({ ...batch, tags: proposed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.id, tags]);
  async function createTag(title: string): Promise<ContentTag | null> {
    const j = await fetch("/api/assets/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }).then((r) => r.json());
    if (j.tags) setTags(j.tags);
    if (!j.tag) setNotice(`Couldn't create the tag: ${j.error ?? "unknown error"}`);
    return j.tag ?? null;
  }
  async function seedTags() {
    setSeeding(true);
    const j = await fetch("/api/assets/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seed: true }) }).then((r) => r.json());
    setSeeding(false);
    if (j.tags) setTags(j.tags);
    setNotice(j.ok ? `Done. ${j.created.length} production tags created on staging, ${j.skipped} were there already.` : `Import failed: ${j.error ?? "unknown error"}`);
  }
  useEffect(() => {
    fetch("/api/assets/knowledge")
      .then((r) => r.json())
      .then((j) => setKnowledge(j.entries ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    batchStore.get(params.id).then(async (b) => {
      if (cancelled) return;
      setBatch(b ?? null);
      if (!b) return;
      const t: Record<string, string> = {};
      for (const r of b.rows) {
        const d = await batchStore.getThumb(b.id, r.id);
        if (d) t[r.id] = d;
      }
      if (!cancelled) setThumbs(t);
    });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const save = useCallback(
    async (next: Batch) => {
      setBatch(next);
      await batchStore.put(next);
    },
    []
  );

  function updateRow(id: string, patch: Partial<AssetRow>) {
    if (!batch) return;
    const rows = batch.rows.map((r, i) => {
      if (r.id !== id) return r;
      const merged = { ...r, ...patch };
      if (patch.descriptor !== undefined || patch.context !== undefined || (patch.alt !== undefined && !merged.descriptor)) {
        merged.fileName = proposeFileName({
          year: batch.year,
          loc: batch.loc,
          context: merged.context as Context | "",
          descriptor: merged.descriptor || descriptorFromAlt(merged.alt),
          nn: 0,
          ext: merged.mime === "image/webp" ? "webp" : "jpg",
        });
      }
      return merged;
    });
    void save({ ...batch, rows });
  }

  const rows = useMemo<Row[]>(
    () =>
      (batch?.rows ?? []).map((r, i) => ({
        ...r,
        key: r.id,
        nn: i + 1,
        thumb: thumbs[r.id],
        issues: [
          ...validateAlt(r.alt),
          ...knowledgeIssues(r.alt, knowledge),
          ...(r.descriptor && cleanDescriptor(r.descriptor) !== r.descriptor ? ["Descriptor was normalised"] : []),
          ...(tags ? tagIssues(batch?.tags ?? [], r.tags ?? [], { isGp: Boolean(batch?.round) }) : []),
        ],
      })),
    [batch, thumbs, knowledge, tags]
  );

  const columns = useMemo<TableColumn<Row>[]>(
    () => [
      {
        key: "thumb",
        header: "",
        width: "64px",
        cell: (r) =>
          r.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.thumb} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, display: "block" }} />
          ) : (
            <span style={{ display: "block", width: 44, height: 44, background: "var(--surface)", borderRadius: 6 }} />
          ),
      },
      { key: "nn", header: "#", width: "44px", align: "right", cell: (r) => <span className="tabular-nums">{String(r.nn).padStart(2, "0")}</span> },
      {
        key: "originalName",
        header: "Original",
        width: "190px",
        cell: (r) => (
          <span title={`${r.originalName} · ${r.srcWidth}×${r.srcHeight} · ${fmtBytes(r.originalBytes)}`} className="block truncate" style={{ color: "var(--muted)", fontSize: 12 }}>
            {r.originalName}
          </span>
        ),
      },
      {
        key: "size",
        header: "Size",
        width: "120px",
        cell: (r) => (
          <span className="tabular-nums" style={{ fontSize: 12 }}>
            {r.width}×{r.height} · {fmtBytes(r.bytes)}
          </span>
        ),
      },
      { key: "descriptor", header: "Descriptor", width: "1fr", editable: true },
      {
        key: "fileName",
        header: "File name",
        width: "260px",
        cell: (r) => (
          r.descriptor || r.alt ? (
            <span className="block truncate" title={`${r.fileName} · final number set at upload`} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
              {r.fileName.replace(/_\d{2,3}(\.[a-z0-9]+)$/i, "_nn$1")}
            </span>
          ) : (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>named after the alt text</span>
          )
        ),
      },
      { key: "alt", header: "Alt text (EN)", width: "1.6fr", editable: true },
      {
        key: "tags",
        header: "Tags (this image)",
        width: "260px",
        cell: (r) =>
          tags ? (
            <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: "100%" }}>
              <TagPicker value={r.tags ?? []} available={tags} onChange={(next) => setRowTags(r.id, next)} onCreate={createTag} compact placeholder={`+ tag (${batch?.tags?.length ?? 0} from batch)`} onOpenChange={setPickerOpen} />
            </div>
          ) : (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>…</span>
          ),
      },
      {
        key: "status",
        header: "CMS",
        width: "90px",
        cell: (r) =>
          r.status === "uploaded" ? (
            <a href={r.cmsId ? `https://staging.audif1team.com/cms/admin/collections/media/${r.cmsId}` : "#"} target="_blank" rel="noreferrer" style={{ color: "#6fcf7c", fontSize: 12 }} title={`${r.uploadedName ?? ""} · open in the staging CMS`}>
              uploaded ↗
            </a>
          ) : r.status === "error" ? (
            <span style={{ color: "#e06c5b", fontSize: 12 }} title={r.note}>
              failed
            </span>
          ) : (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
          ),
      },
      {
        key: "issues",
        header: "Check",
        width: "140px",
        cell: (r) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDialogRow(r.id);
            }}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: r.issues.length ? "#e9c46a" : r.alt ? "#6fcf7c" : "var(--muted)", textDecoration: "underline dotted" }}
            title="Open"
          >
            {r.issues.length ? `${r.issues.length} issue${r.issues.length === 1 ? "" : "s"}` : r.alt ? `ok · ${r.alt.length}/${ALT_MAX}` : "no alt yet"}
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batch?.id, batch?.tags, tags]
  );

  // Per-image tags; the scene tag inside them is mirrored to row.scene so
  // the correction log can compare it with what Claude said.
  function setRowTags(id: string, next: string[]) {
    const scene = next.find((t) => (SCENE_TAGS as readonly string[]).includes(t));
    updateRow(id, { tags: next, scene });
  }
  function bulkTags(fn: (cur: string[]) => string[]) {
    if (!batch) return;
    const rows = batch.rows.map((r) => {
      if (!selectedIds.includes(r.id)) return r;
      const next = fn(r.tags ?? []);
      return { ...r, tags: next, scene: next.find((t) => (SCENE_TAGS as readonly string[]).includes(t)) };
    });
    void save({ ...batch, rows });
  }
  async function teach(r: Row) {
    if (!batch || !teachPerson) return;
    setTeaching(true);
    try {
      const blob = await batchStore.getBlob(batch.id, r.id);
      if (!blob) throw new Error("image data missing in this browser");
      const small = await compressImage(new File([blob], r.fileName, { type: blob.type }), 1568, 0.8);
      const buf = await small.blob.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const j = await fetch("/api/assets/references", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: teachPerson, note: teachNote.trim() || undefined, source: `batch:${batch.id}/${r.originalName}`, mime: small.blob.type || "image/webp", data: btoa(bin) }),
      }).then((x) => x.json());
      if (!j.ok) throw new Error(j.error ?? "failed");
      setNotice(`Saved as a reference photo for ${teachPerson}. Claude looks at it before naming people in the next batch.`);
      setTeachNote("");
    } catch (e) {
      setNotice(`Couldn't save the reference: ${e instanceof Error ? e.message : "failed"}`);
    }
    setTeaching(false);
  }

  function onCellEdit(id: string, columnKey: string, value: string) {
    if (columnKey === "descriptor") updateRow(id, { descriptor: cleanDescriptor(value) });
    if (columnKey === "alt") updateRow(id, { alt: value.trim() });
  }

  async function exportZip() {
    if (!batch) return;
    setBusy("Building ZIP…");
    try {
      const zip = new JSZip();
      const csv: string[] = ["file_name,alt_text,original_name,width,height,bytes"];
      const md: string[] = [`# ${batch.folderPath}`, ""];
      for (const r of batch.rows) {
        const blob = await batchStore.getBlob(batch.id, r.id);
        if (blob) zip.file(r.fileName, blob);
        csv.push([r.fileName, r.alt, r.originalName, r.width, r.height, r.bytes].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
        md.push(`- **${r.fileName}** — ${r.alt || "(no alt text)"}`);
      }
      zip.file("alt-texts.csv", csv.join("\n"));
      zip.file("alt-texts.md", md.join("\n"));
      const out = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(out);
      a.download = `${batch.folderPath.replace(/\//g, "_")}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setNotice(`Done. ZIP with ${batch.rows.length} images + alt-texts.csv + alt-texts.md`);
    } finally {
      setBusy(null);
    }
  }

  // Upload every ready row with an alt text to the chosen CMS folder. A
  // number only where a name repeats (in the folder or in this upload). One request per image; results land on the rows.
  async function uploadAll() {
    if (!batch || !batch.targetFolderId) return;
    setConfirmUpload(false);
    const todo = batch.rows.filter((r) => r.status !== "uploaded" && r.alt.trim());
    if (todo.length === 0) {
      setNotice("Nothing to upload: every image is either uploaded already or has no alt text yet.");
      return;
    }
    setBusy("Uploading…");
    const counters: Record<string, number> = {};
    // a number only where it is needed: the same name twice in this upload, or already in the folder
    const nameOf = (r: (typeof todo)[number]) => proposeFileName({ year: batch.year, loc: batch.loc, context: r.context as Context | "", descriptor: r.descriptor || descriptorFromAlt(r.alt) || "photo", nn: 0, ext: r.mime === "image/webp" ? "webp" : "jpg" }).replace(/\.[a-z0-9]+$/i, "");
    const twice: Record<string, number> = {};
    for (const r of todo) twice[nameOf(r)] = (twice[nameOf(r)] ?? 0) + 1;
    let ok = 0;
    const failures: string[] = [];
    let rows = batch.rows;
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      setProgress({ done: i, total: todo.length, current: r.fileName });
      try {
        // the name is the descriptor (from the alt text if Claude gave none);
        // the number continues per full name in the target folder, so two
        // batches of "bortoleto-garage" never collide on _01
        const descriptor = r.descriptor || descriptorFromAlt(r.alt) || "photo";
        const ext = r.mime === "image/webp" ? "webp" : "jpg";
        const prefix = proposeFileName({ year: batch.year, loc: batch.loc, context: r.context as Context | "", descriptor, nn: 0, ext }).replace(/\.[a-z0-9]+$/i, "");
        if (counters[prefix] == null) {
          const j = await fetch(`/api/assets/next-number?folder=${encodeURIComponent(batch.targetFolderId)}&prefix=${encodeURIComponent(prefix)}`).then((x) => x.json());
          counters[prefix] = Number(j.next ?? 1);
        }
        // free name, used once here: no number; otherwise _01, _02 … continuing in the folder
        const unique = counters[prefix] === 1 && (twice[prefix] ?? 1) === 1;
        const nn = unique ? 0 : counters[prefix]++;
        const finalName = proposeFileName({ year: batch.year, loc: batch.loc, context: r.context as Context | "", descriptor, nn, ext });
        const blob = await batchStore.getBlob(batch.id, r.id);
        if (!blob) throw new Error("image data missing in this browser");
        const form = new FormData();
        form.append("file", blob, finalName);
        form.append("filename", finalName);
        form.append("alt", r.alt);
        form.append("folder", batch.targetFolderId);
        form.append("tags", JSON.stringify(oneScene(uniqueTags(batch.tags, r.tags), r.scene)));
        const res = await fetch("/api/assets/upload", { method: "POST", body: form });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        rows = rows.map((x) => (x.id === r.id ? { ...x, status: "uploaded" as const, cmsId: j.doc.id, cmsUrl: j.doc.url, uploadedName: j.doc.filename, note: undefined } : x));
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "failed";
        rows = rows.map((x) => (x.id === r.id ? { ...x, status: "error" as const, note: msg } : x));
        failures.push(`${r.fileName}: ${msg}`);
      }
      await save({ ...batch, rows });
    }
    // learning: where the team changed Claude's people / scene, log it
    const corrections = todo
      .filter((r) => r.ai)
      .map((r) => {
        const final = rows.find((x) => x.id === r.id) ?? r;
        const finalTags = final.tags ?? [];
        return {
          batchId: batch.id,
          rowId: r.id,
          originalName: r.originalName,
          alt: final.alt,
          ai: { people: r.ai!.tags.filter(isPersonTag), scene: r.ai!.scene },
          final: { people: finalTags.filter(isPersonTag), scene: final.scene, tags: uniqueTags(batch.tags, finalTags) },
        };
      })
      .filter((c) => c.ai.scene !== c.final.scene || c.ai.people.length !== c.final.people.length || !c.ai.people.every((p) => c.final.people.includes(p)));
    if (corrections.length) void fetch("/api/assets/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: corrections }) });
    setProgress(null);
    setBusy(null);
    setNotice(`Done. ${ok} of ${todo.length} uploaded to ${batch.targetFolderPath}${failures.length ? `\nNot uploaded: ${failures.length}\n${failures.join("\n")}` : "."}`);
  }

  async function generateAltText() {
    if (!batch) return;
    if (!apiMode?.configured && hasConnector === false) {
      setNotice("Generate alt text needs the AF1 Tools connector in your Claude. Set it up once from the home page, then click again.");
      return;
    }
    const todo = batch.rows.filter((r) => !r.alt.trim());
    const target = todo.length ? todo : batch.rows;
    setGen({ phase: "sync", done: 0, total: target.length, got: 0 });
    // 1. previews (1024px JPEG) + meta to the server
    for (let i = 0; i < target.length; i++) {
      const r = target[i];
      const blob = await batchStore.getBlob(batch.id, r.id);
      if (!blob) continue;
      const bmp = await createImageBitmap(blob);
      const k = 1568 / Math.max(bmp.width, bmp.height); // Claude looks at up to ~1568px on the long edge
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * Math.min(1, k)));
      c.height = Math.max(1, Math.round(bmp.height * Math.min(1, k)));
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      let prev = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.78));
      if (prev && prev.size > 700_000) prev = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.6));
      if (prev) {
        const form = new FormData();
        form.append("file", prev, "preview.jpg");
        form.append("rowId", r.id);
        await fetch(`/api/assets/batch/${batch.id}/preview`, { method: "POST", body: form });
      }
      setGen({ phase: "sync", done: i + 1, total: target.length, got: 0 });
    }
    await fetch(`/api/assets/batch/${batch.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderPath: batch.targetFolderPath ?? batch.folderPath,
        year: batch.year,
        loc: batch.loc,
        round: batch.round,
        session: batch.session,
        race: batch.round ? `Round ${batch.round}` : undefined,
        tags: batch.tags,
        rows: target.map((r) => ({ id: r.id, originalName: r.originalName, fileName: r.fileName, context: r.context, descriptor: r.descriptor, alt: r.alt, width: r.width, height: r.height, people: r.people, date: r.date, scene: r.scene, tags: r.tags })),
      }),
    });
    // 2a. API key set: describe each photo from here, two at a time
    if (apiMode?.configured) {
      stopRef.current = false;
      let got = 0;
      let failed = 0;
      setGen({ phase: "api", done: 0, total: target.length, got: 0, failed: 0 });
      const queue = [...target];
      const down: { msg: string | null } = { msg: null }; // Anthropic refused (no credits, bad key, model): stop and hand off
      const worker = async () => {
        while (queue.length && !stopRef.current && !down.msg) {
          const r = queue.shift()!;
          try {
            const j = await fetch("/api/assets/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: batch.id, rowId: r.id }) }).then((x) => x.json());
            if (!j.ok) {
              const msg = String(j.error ?? "failed");
              if (/Anthropic (4\d\d)|No Anthropic API key/.test(msg)) {
                down.msg = msg;
                queue.unshift(r);
                return;
              }
              throw new Error(msg);
            }
            const out = j.result as { descriptor: string; alt: string; people: string[]; scene: string };
            const current = await batchStore.get(batch.id);
            if (current) {
              const rows = current.rows.map((x) => (x.id === r.id ? applyDescribed(current, x, out, knowledge, tagTitles) : x));
              const next = { ...current, rows };
              setBatch(next);
              await batchStore.put(next);
            }
            got++;
          } catch (e) {
            failed++;
            const msg = e instanceof Error ? e.message : "failed";
            const current = await batchStore.get(batch.id);
            if (current) {
              const next = { ...current, rows: current.rows.map((x) => (x.id === r.id ? { ...x, note: msg } : x)) };
              setBatch(next);
              await batchStore.put(next);
            }
          }
          setGen((g) => (g ? { ...g, done: got + failed, got, failed } : g));
        }
      };
      await Promise.all([worker(), worker()]);
      if (down.msg && got === 0) {
        // nothing came back: fall through to the claude.ai hand-off
        setNotice(`In-tool generation isn't available right now (${down.msg.replace(/^Anthropic \d+: ?/, "")}). Opening claude.ai instead.`);
      } else {
        setGen(null);
        setNotice(`Done. Alt text and tags written for ${got} image${got === 1 ? "" : "s"}${failed ? `; ${failed} failed (hover the Check column)` : ""}${down.msg ? `; stopped early: ${down.msg}` : ""}. Check them, then upload.`);
        return;
      }
    }
    // 2b. no key: go to claude.ai in this tab; Claude's summary ends with a
    // link back to this page (?step=3), which pulls the results in.
    window.location.assign(`/api/assets/handoff?batch=${batch.id}`);
  }

  async function remove() {
    if (!batch) return;
    await batchStore.remove(batch.id);
    router.push("/assets/batches");
  }

  const readyCount = batch ? batch.rows.filter((r) => r.status !== "uploaded" && r.alt.trim()).length : 0;
  useSidebarContent(
    <SideSection title="This batch">
      <SideButton onClick={exportZip} disabled={Boolean(busy)}>
        Export ZIP + CSV
      </SideButton>
      <SideButton onClick={remove}>Delete batch</SideButton>
    </SideSection>,
    [batch?.id, busy]
  );

  if (batch === undefined) return <p style={{ color: "var(--muted)" }}>Loading batch…</p>;
  if (batch === null) return <p style={{ color: "var(--muted)" }}>Batch not found in this browser. Batches live in the browser they were created in.</p>;

  const withAlt = batch.rows.filter((r) => r.alt).length;
  const issues = rows.reduce((n, r) => n + r.issues.length, 0);
  const allUploaded = batch.rows.every((r) => r.status === "uploaded");
  const tagProblems = rows.filter((r) => r.status !== "uploaded" && tagIssues(batch.tags ?? [], r.tags ?? [], { isGp: Boolean(batch.round) }).length > 0).length;
  const tagsOk = tags != null && tagProblems === 0 && (batch.tags?.length ?? 0) > 0;
  const suggestedBatch = tags ? proposeBatchTags({ year: batch.year, loc: batch.loc, race: batch.race, session: batch.session }, tagTitles) : [];

  return (
    <div>
      <section className="page-head reveal">
        <div>
          <div className="section-label" style={{ marginBottom: 8 }}>Batch · created {new Date(batch.createdAt).toLocaleString("en-GB")}</div>
          <h1 style={{ fontSize: 24 }}>{batch.targetFolderPath ?? `10_Media-Galleries/${batch.folderPath}`}</h1>
        </div>
      </section>
      <Steps
        current={allUploaded ? 5 : withAlt === batch.rows.length ? (tagsOk ? 5 : 4) : 3}
        done={[1, 2, ...(withAlt === batch.rows.length ? [3] : []), ...(tagsOk && withAlt === batch.rows.length ? [4] : []), ...(allUploaded ? [5] : [])]}
      />
      <section className="reveal reveal-d1" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
        {[
          { n: batch.rows.length, l: "Images" },
          { n: fmtBytes(batch.rows.reduce((n, r) => n + r.bytes, 0)), l: `from ${fmtBytes(batch.rows.reduce((n, r) => n + r.originalBytes, 0))}` },
          { n: withAlt, l: "With alt text" },
          { n: issues, l: "Checks open" },
        ].map((st) => (
          <div key={st.l} className="stat">
            <span className="n">{st.n}</span>
            <span className="l">{st.l}</span>
          </div>
        ))}
      </section>

      <section id="batch-steps" className="reveal reveal-d2" style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="card" style={{ padding: 16, display: "grid", gap: 10, alignContent: "start" }}>
          <div className="section-label">Step 3 · Alt text</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {batch.rows.filter((r) => !r.alt.trim()).length === 0
              ? "Every image has an alt text. Review a few by clicking a row's check."
              : `${batch.rows.filter((r) => !r.alt.trim()).length} of ${batch.rows.length} images still need an alt text. Your Claude writes them from the pictures and the team rules; results land here while you wait.`}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={generateAltText} disabled={Boolean(gen) || Boolean(busy) || batch.rows.filter((r) => !r.alt.trim()).length === 0}>
              {gen ? (gen.phase === "sync" ? `Sending ${gen.done}/${gen.total}…` : gen.phase === "api" ? `Writing ${gen.done}/${gen.total}…` : `Waiting for Claude ${gen.got}/${gen.total}…`) : apiMode?.configured ? "Generate alt text & tags" : "Generate alt text"}
            </button>
            {gen?.phase === "api" && (
              <button className="btn" onClick={() => { stopRef.current = true; }}>
                Stop
              </button>
            )}

            {apiMode?.configured ? (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Runs in the tool ({apiMode.model}).</span>
            ) : (
              hasConnector === false && <span style={{ fontSize: 12, color: "#e9c46a" }}>Needs the AF1 Tools connector (home page shows the setup), or an API key in Admin → Claude API.</span>
            )}
          </div>
        </div>
        <div className="card" style={{ padding: 16, display: "grid", gap: 10, alignContent: "start" }}>
          <div className="section-label">Step 4 · Content tags</div>
          {tags === null ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading the CMS tags…</div>
          ) : tags.length === 0 ? (
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              Staging has no content tags yet. Copy the production vocabulary once (105 tags), then they are picked here and applied on upload.
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-primary" onClick={seedTags} disabled={seeding}>
                  {seeding ? "Importing…" : "Import production tags"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                For every image in this batch. Per image, Claude adds the people and the scene (on-track &amp; garage / team / off-track) when it writes the alt text; change them in a row&apos;s dialog.
              </div>
              <TagPicker value={batch.tags ?? []} available={tags} suggestions={suggestedBatch} onChange={(next) => void save({ ...batch, tags: next })} onCreate={createTag} placeholder="Add a batch tag…" />
              <div style={{ fontSize: 12, color: tagProblems ? "#e9c46a" : "#6fcf7c" }}>
                {tagProblems ? `${tagProblems} image${tagProblems === 1 ? "" : "s"} flagged by the tag check (see the Check column).` : batch.tags?.length ? "Tag check passed for every image." : "Pick at least the year and the Grand Prix."}
              </div>
            </>
          )}
        </div>
        <div className="card" style={{ padding: 16, display: "grid", gap: 10, alignContent: "start" }}>
          <div className="section-label">Step 5 · Upload</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            Target: <code>{batch.targetFolderPath ?? "— no folder chosen —"}</code>{" "}
            <button className="btn" onClick={() => setPickFolder(true)} style={{ padding: "3px 10px", fontSize: 12, marginLeft: 6 }}>
              {batch.targetFolderId ? "Change" : "Choose folder"}
            </button>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
              {batch.rows.filter((r) => r.status === "uploaded").length} uploaded · {readyCount} ready · {batch.rows.filter((r) => !r.alt.trim()).length} without alt text (stay here)
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={() => setConfirmUpload(true)} disabled={!batch.targetFolderId || readyCount === 0 || Boolean(busy) || Boolean(gen)}>
              Upload {readyCount || ""} to staging
            </button>
            <button className="btn" onClick={exportZip} disabled={Boolean(busy)}>
              Export ZIP
            </button>
          </div>
        </div>
      </section>
      {gen && (
        <div role="status" style={{ background: "#141416", border: "1px solid var(--vapor-purple)", borderRadius: 8, padding: "10px 14px", margin: "0 0 12px", fontSize: 13 }}>
          {gen.phase === "sync" ? `Sending previews to the server: ${gen.done} of ${gen.total}` : gen.phase === "api" ? `Claude is looking at the photos: ${gen.done} of ${gen.total} done${gen.failed ? `, ${gen.failed} failed` : ""}. Rows fill in as they come back.` : `Claude is writing in the claude.ai tab: ${gen.got} of ${gen.total} back. Press send there if it hasn't started; this page updates on its own.`}
          <div style={{ height: 4, background: "#2a2a2d", borderRadius: 2, marginTop: 8 }}>
            <div style={{ height: 4, width: `${Math.round(((gen.phase === "waiting" ? gen.got : gen.done) / Math.max(1, gen.total)) * 100)}%`, background: "var(--accent)", borderRadius: 2, transition: "width 0.3s" }} />
          </div>
        </div>
      )}
      {progress && (
        <div role="status" style={{ background: "#141416", border: "1px solid var(--vapor-purple)", borderRadius: 8, padding: "10px 14px", margin: "0 0 12px", fontSize: 13 }}>
          Uploading {progress.done + 1} of {progress.total}: {progress.current}
          <div style={{ height: 4, background: "#2a2a2d", borderRadius: 2, marginTop: 8 }}>
            <div style={{ height: 4, width: `${Math.round(((progress.done + 1) / progress.total) * 100)}%`, background: "var(--accent)", borderRadius: 2, transition: "width 0.2s" }} />
          </div>
        </div>
      )}
      {pickFolder && (
        <FolderPicker
          initialPath={batch.folderPath}
          onClose={() => setPickFolder(false)}
          onPick={(f: { id: string; path: string }) => {
            void save({ ...batch, targetFolderId: f.id, targetFolderPath: f.path });
            setPickFolder(false);
          }}
        />
      )}
      {confirmUpload && (
        <Modal title="Upload to staging?" onClose={() => setConfirmUpload(false)} width={520}>
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 12px" }}>
            {batch.rows.filter((r) => r.status !== "uploaded" && r.alt.trim()).length} images go to <code>{batch.targetFolderPath}</code> on staging.audif1team.com, with their alt
            text and content tags ({(batch.tags ?? []).join(", ") || "none"} + per-image tags), numbered after what is already in that folder. Images without alt text stay here.
            {tagProblems > 0 && <><br /><span style={{ color: "#e9c46a" }}>{tagProblems} image{tagProblems === 1 ? "" : "s"} did not pass the tag check; they upload with what they have.</span></>}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setConfirmUpload(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={uploadAll}>
              Upload
            </button>
          </div>
        </Modal>
      )}
      {dialogRow && (() => {
        const r = rows.find((x) => x.id === dialogRow);
        if (!r) return null;
        return (
          <Modal title={r.originalName} onClose={() => setDialogRow(null)} width={720}>
            <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 18, fontSize: 13 }}>
              <div>
                {r.thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumb} alt="" style={{ width: 200, height: 200, objectFit: "cover", borderRadius: 8 }} />
                )}
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                  {r.width}×{r.height} · {fmtBytes(r.bytes)}
                  <br />
                  <code style={{ fontSize: 11 }}>{r.fileName.replace(/_\d{2,3}(\.[a-z0-9]+)$/i, "_nn$1")}</code>
                </div>
              </div>
              <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                  Alt text (English, under {ALT_MAX})
                  <textarea className="input" rows={3} value={r.alt} onChange={(e) => updateRow(r.id, { alt: e.target.value })} />
                  <span style={{ textAlign: "right", color: r.alt.length > ALT_MAX ? "#e06c5b" : "var(--muted)" }}>{r.alt.length}/{ALT_MAX}</span>
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                  Descriptor (2–6 words, goes into the file name)
                  <input className="input" value={r.descriptor} onChange={(e) => updateRow(r.id, { descriptor: e.target.value })} onBlur={(e) => updateRow(r.id, { descriptor: cleanDescriptor(e.target.value) })} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                  Slot in the file name (optional: only when the picture is made for a slot, pre-filled when the original name says so)
                  <select className="input" value={r.context} onChange={(e) => updateRow(r.id, { context: e.target.value })}>
                    <option value="">— none —</option>
                    {CONTEXTS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                  Content tags (batch tags greyed; add people and the scene for this picture)
                  {tags && (
                    <TagPicker
                      value={r.tags ?? []}
                      locked={batch.tags ?? []}
                      available={tags}
                      suggestions={proposeRowTags({ people: r.people, scene: r.scene }, tagTitles)}
                      onChange={(next) => updateRow(r.id, { tags: next })}
                      onCreate={createTag}
                      compact
                      placeholder="Add a tag for this image…"
                    />
                  )}
                </label>
                <div className="card" style={{ padding: "10px 12px", display: "grid", gap: 8, background: "var(--surface)" }}>
                  <div className="section-label">Teach Claude</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                    Wrong or missing person? Fix the tags above, then save this photo as a reference so Claude can compare faces, helmets and suits next time.
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select className="input" value={teachPerson} onChange={(e) => setTeachPerson(e.target.value)} style={{ padding: "5px 8px", fontSize: 12 }}>
                      <option value="">— person in this photo —</option>
                      {knowledge.filter((k) => k.kind === "person" && k.active).map((k) => (
                        <option key={k.id} value={k.name}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                    <input className="input" value={teachNote} onChange={(e) => setTeachNote(e.target.value)} placeholder="what identifies them here (helmet, suit, face…)" style={{ flex: 1, minWidth: 180, padding: "5px 8px", fontSize: 12 }} />
                    <button className="btn btn-primary" style={{ padding: "5px 10px", fontSize: 12 }} disabled={!teachPerson || teaching} onClick={() => teach(r)}>
                      {teaching ? "Saving…" : "Save as reference"}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="section-label" style={{ marginBottom: 6 }}>Checks</div>
                  {r.issues.length === 0 ? (
                    <div style={{ color: "#6fcf7c" }}>{r.alt ? "All good." : "No alt text yet."}</div>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18, color: "#e9c46a", lineHeight: 1.7 }}>
                      {r.issues.map((i, k) => (
                        <li key={k}>{i}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn" onClick={() => { const i = rows.findIndex((x) => x.id === r.id); if (i > 0) setDialogRow(rows[i - 1].id); }} disabled={rows.findIndex((x) => x.id === r.id) === 0}>
                      ← Prev
                    </button>
                    <button className="btn" onClick={() => { const i = rows.findIndex((x) => x.id === r.id); if (i < rows.length - 1) setDialogRow(rows[i + 1].id); }} disabled={rows.findIndex((x) => x.id === r.id) === rows.length - 1}>
                      Next →
                    </button>
                  </div>
                  <button className="btn btn-primary" onClick={() => setDialogRow(null)}>
                    Done
                  </button>
                </div>
              </div>
            </div>
          </Modal>
        );
      })()}
      {notice && (
        <div role="status" style={{ background: notice.includes("Not uploaded") ? "#2a1512" : "#122a18", border: `1px solid ${notice.includes("Not uploaded") ? "#c0392b" : "#2e7d4f"}`, borderRadius: 8, padding: "10px 14px", margin: "0 0 12px", fontSize: 13, display: "flex", justifyContent: "space-between", whiteSpace: "pre-wrap" }}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.6 }}>
            ×
          </button>
        </div>
      )}

      {selectedIds.length > 0 && tags && (
        <div className="card" style={{ padding: "10px 14px", marginBottom: 10, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: 13, borderColor: "var(--accent)" }}>
          <strong>{selectedIds.length} selected</strong>
          <div style={{ minWidth: 260, flex: 1 }}>
            <TagPicker value={[]} available={tags} onChange={(next) => next.length && bulkTags((cur) => uniqueTags(cur, next))} onCreate={createTag} compact placeholder="Add a tag to all selected…" />
          </div>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>Scene:</span>
          {SCENE_TAGS.map((sc) => (
            <button key={sc} className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => bulkTags((cur) => [...cur.filter((t) => !(SCENE_TAGS as readonly string[]).includes(t)), sc])}>
              {sc}
            </button>
          ))}
          <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => bulkTags(() => [])} title="Remove every per-image tag on the selected rows (batch tags stay)">
            Clear tags
          </button>
          <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setSelectedIds([])}>
            Deselect
          </button>
        </div>
      )}
      <div className={`beui beui-compact${pickerOpen ? " is-editing" : ""}`}>
        <Table<Row>
          data={rows}
          columns={columns}
          getRowId={(r) => r.key}
          selectable
          selectedRowIds={selectedIds}
          onSelectionChange={setSelectedIds}
          resizable
          onCellEdit={onCellEdit}
          height={Math.max(360, typeof window !== "undefined" ? window.innerHeight - 300 : 600)}
          rowHeight={56}
          emptyState="No images in this batch."
          className="rounded-lg border border-border"
        />
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
        Descriptor: 2–6 lowercase words, hyphens, no umlauts (Hulkenberg). Alt text: English, under {ALT_MAX} characters, pattern
        “&lt;subject&gt; of the Audi Revolut F1® Team &lt;action&gt; at the &lt;race&gt; Grand Prix”. Final numbering is set per CMS folder at upload.
      </p>
    </div>
  );
}
