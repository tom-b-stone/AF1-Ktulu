// Inbox for the AF1 Notch Mac app: images dropped on the notch wait here (KV,
// one day) until the Asset Uploader in the browser picks them up and runs its
// usual flow (WebP, Claude alt texts, names, tags, upload). Images arrive in
// chunks so no single KV value or request gets too large.
import { kvGet, kvSetEx } from "./kv";

const TTL = 24 * 3600;
export type InboxFile = { id: string; name: string; mime: string; parts: number; received: number };
export type Inbox = { id: string; owner: string; at: string; round?: number; session?: string; files: InboxFile[] };

const kMeta = (id: string) => `asset:inbox:${id}`;
const kPart = (id: string, file: string, n: number) => `asset:inbox:${id}:${file}:${n}`;
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export async function readInbox(id: string): Promise<Inbox | null> {
  const raw = await kvGet(kMeta(id)).catch(() => null);
  return raw ? (JSON.parse(raw) as Inbox) : null;
}

export async function startInbox(owner: string, round?: number, session?: string): Promise<Inbox> {
  const box: Inbox = { id: rid(), owner, at: new Date().toISOString(), round, session, files: [] };
  await kvSetEx(kMeta(box.id), JSON.stringify(box), TTL);
  return box;
}

// one chunk (base64) of one image; the first chunk registers the file
export async function addPart(id: string, file: { id?: string; name: string; mime: string; parts: number }, part: number, data: string): Promise<{ file: string; complete: boolean }> {
  const box = await readInbox(id);
  if (!box) throw new Error("inbox not found or expired");
  if (data.length > 900_000) throw new Error("chunk too large");
  let f = file.id ? box.files.find((x) => x.id === file.id) : undefined;
  if (!f) {
    if (box.files.length >= 300) throw new Error("300 images per hand-over at most");
    f = { id: rid(), name: file.name.slice(0, 160), mime: file.mime, parts: Math.max(1, Math.min(20, file.parts)), received: 0 };
    box.files.push(f);
  }
  if (part < 0 || part >= f.parts) throw new Error("wrong part");
  await kvSetEx(kPart(id, f.id, part), data, TTL);
  f.received = Math.max(f.received, part + 1);
  await kvSetEx(kMeta(id), JSON.stringify(box), TTL);
  return { file: f.id, complete: f.received === f.parts };
}

export async function readFile(id: string, fileId: string): Promise<{ bytes: Buffer; mime: string; name: string } | null> {
  const box = await readInbox(id);
  const f = box?.files.find((x) => x.id === fileId);
  if (!f) return null;
  const parts: string[] = [];
  for (let n = 0; n < f.parts; n++) {
    const p = await kvGet(kPart(id, fileId, n)).catch(() => null);
    if (!p) return null;
    parts.push(p);
  }
  return { bytes: Buffer.from(parts.join(""), "base64"), mime: f.mime, name: f.name };
}
