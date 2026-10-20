// Team Card writing rules: one list the team keeps and extends on the Lexicon
// page (Team Cards → Lexicon). They are for Claude and the copy check, not
// shown next to every field. A rule applies to all texts or to one field.
import { kvGet, kvSet } from "./kv";

export type Rule = { id: string; text: string; field?: string; by: string; at: string };
const KEY = "teamcards:rules:v1";

// the starting set (from the old per-field hints and the team rules)
const SEED: Omit<Rule, "id" | "by" | "at">[] = [
  { text: "Audi Revolut F1® Team, always with ®, never shortened" },
  { text: "Team Card, never Badge or Card alone" },
  { text: "No em dash, no exclamation marks, no \"amazing\" or \"incredible\"" },
  { text: "DE headlines end with a period" },
  { text: "CTAs without arrows" },
  { text: "Never \"sign up\"", field: "revealButton" },
  { text: "Usually the race, e.g. R17 | Singapore GP", field: "modCategory" },
  { text: "Sentence case, no exclamation marks on the website", field: "modHeadline" },
  { text: "Short verb first", field: "submitLabel" },
  { text: "One short sentence", field: "overlayTitle" },
  { text: "One line, doesn't repeat the title", field: "description" },
];

const id = () => Math.random().toString(36).slice(2, 10);

export async function listRules(): Promise<Rule[]> {
  const raw = await kvGet(KEY).catch(() => null);
  if (raw) return JSON.parse(raw) as Rule[];
  const at = new Date().toISOString();
  return SEED.map((r) => ({ ...r, id: id(), by: "setup", at }));
}

async function save(list: Rule[]) {
  await kvSet(KEY, JSON.stringify(list.slice(0, 500)));
  return list;
}

export async function addRule(text: string, field: string | undefined, by: string) {
  const t = text.trim();
  if (!t) throw new Error("Write the rule first");
  const list = await listRules();
  list.push({ id: id(), text: t, field: field || undefined, by, at: new Date().toISOString() });
  return save(list);
}

export async function updateRule(ruleId: string, text: string, field: string | undefined, by: string) {
  const list = await listRules();
  const r = list.find((x) => x.id === ruleId);
  if (!r) throw new Error("Rule not found");
  r.text = text.trim() || r.text;
  r.field = field || undefined;
  r.by = by;
  r.at = new Date().toISOString();
  return save(list);
}

export async function removeRule(ruleId: string) {
  return save((await listRules()).filter((x) => x.id !== ruleId));
}

// for Claude: the rules as plain lines, field rules marked with their field
export function rulesText(rules: Rule[], label: (k: string) => string = (k) => k) {
  return rules.map((r) => `- ${r.field ? `[${label(r.field)}] ` : ""}${r.text}`).join("\n");
}
