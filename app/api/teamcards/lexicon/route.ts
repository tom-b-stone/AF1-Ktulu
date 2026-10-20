import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { kvGet, kvSet } from "@/lib/kv";
import { addRule, listRules, removeRule, updateRule } from "@/lib/teamCardRules";

// Team Card lexicon: approved wordings (EN + DE) per field, learned from what
// gets applied and from what people save on purpose. Hints in the editor use it.
export const dynamic = "force-dynamic";
const KEY = "teamcards:lexicon";
type Entry = { id: string; field: string; en: string; de: string; note?: string; uses: number; cards: string[]; saved: boolean; by: string; at: string };
const load = async (): Promise<Entry[]> => JSON.parse((await kvGet(KEY).catch(() => null)) ?? "[]");
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [entries, rules] = await Promise.all([load(), listRules()]);
  return NextResponse.json({ entries, rules });
}

// { action: "save", field, en, de, note }      → saved on purpose
// { action: "learn", items: [{ field, en, de, card }] } → counted from applied changes
// { action: "remove", id }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const by = session.user.email;
  const b = (await req.json().catch(() => null)) as { action?: string; field?: string; en?: string; de?: string; note?: string; id?: string; text?: string; items?: { field: string; en: string; de: string; card: string }[] } | null;
  // rules: { action: "rule-add", text, field? } · { action: "rule-update", id, text, field? } · { action: "rule-remove", id }
  try {
    if (b?.action === "rule-add") return NextResponse.json({ rules: await addRule(b.text ?? "", b.field, by) });
    if (b?.action === "rule-update" && b.id) return NextResponse.json({ rules: await updateRule(b.id, b.text ?? "", b.field, by) });
    if (b?.action === "rule-remove" && b.id) return NextResponse.json({ rules: await removeRule(b.id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
  const list = await load();
  const upsert = (field: string, en: string, de: string, card: string | null, saved: boolean, note?: string) => {
    if (!en.trim() && !de.trim()) return;
    const hit = list.find((e) => e.field === field && norm(e.en) === norm(en));
    if (hit) {
      hit.uses += card ? 1 : 0;
      if (de.trim()) hit.de = de;
      if (card && !hit.cards.includes(card)) hit.cards.push(card);
      if (saved) hit.saved = true;
      if (note) hit.note = note;
      hit.at = new Date().toISOString();
    } else list.push({ id: Math.random().toString(36).slice(2, 10), field, en, de, note, uses: card ? 1 : 0, cards: card ? [card] : [], saved, by, at: new Date().toISOString() });
  };
  if (b?.action === "save" && b.field) upsert(b.field, b.en ?? "", b.de ?? "", null, true, b.note);
  else if (b?.action === "learn") for (const it of b.items ?? []) upsert(it.field, it.en ?? "", it.de ?? "", it.card, false);
  else if (b?.action === "remove" && b.id) list.splice(list.findIndex((e) => e.id === b.id), 1);
  else return NextResponse.json({ error: "unknown action" }, { status: 400 });
  await kvSet(KEY, JSON.stringify(list.slice(-2000)));
  return NextResponse.json({ ok: true, entries: list });
}
