// The Team Card journey as fans see it on audif1.com, station by station.
// Each station is one captured site screen (public/af1-live/templates.json,
// captured on staging) filled with the card's content. Lanes follow the
// journey board in Figma (05-1 AF1 Design Loyalty): on the page → the task →
// logged out / logged in → the collection.

export type TemplateKind = "survey" | "qa" | "hot";
export type Lane = "page" | "out" | "in" | "collection";
export type Station = { id: string; lane: Lane; label: string; note: string; tpl: string; side?: "front" | "back"; anchor?: string };
export type Step = { key: string; title: string; lanes: Lane[]; talk: string };

export const LANES: Record<Lane, { title: string; text: string; tint: string; edge: string }> = {
  page: { title: "On the page", text: "The module on the activation page and the task inside it.", tint: "rgba(245,242,242,.04)", edge: "rgba(245,242,242,.18)" },
  out: { title: "Logged out", text: "A visitor without an account does the task. The card is shown, collecting needs a login.", tint: "rgba(255,45,0,.07)", edge: "rgba(255,45,0,.45)" },
  in: { title: "Logged in", text: "A member does the task. The card goes straight into the collection.", tint: "rgba(111,207,124,.07)", edge: "rgba(111,207,124,.45)" },
  collection: { title: "In the collection", text: "The profile shows the card before and after it is collected.", tint: "rgba(127,184,255,.07)", edge: "rgba(127,184,255,.45)" },
};

export const STEPS: Step[] = [
  { key: "overview", title: "Overview", lanes: [], talk: "Where this card stands: what it is, what is missing and where to start." },
  { key: "setup", title: "Setup", lanes: [], talk: "What the card is, how fans earn it, where it sits and what they get." },
  { key: "page", title: "Page", lanes: ["page"], talk: "Where fans meet the card: the module on the activation page with the task inside." },
  { key: "out", title: "Logged out", lanes: ["out"], talk: "What a visitor without an account sees after the task, and the card that asks them to log in." },
  { key: "in", title: "Logged in", lanes: ["in"], talk: "What a member sees after the task, and the moment the card is collected." },
  { key: "collection", title: "Collection", lanes: ["collection"], talk: "The card in the profile: before it is collected and afterwards." },
  { key: "review", title: "Review", lanes: [], talk: "Everything you changed, checked against the rules, ready for staging." },
];

export function kindOf(engagementType?: string): TemplateKind {
  if (engagementType === "q-and-a") return "qa";
  if (engagementType === "hot-or-not") return "hot";
  return "survey";
}

// stations per engagement type, in journey order
export function stationsFor(kind: TemplateKind): Station[] {
  const task: Station[] =
    kind === "qa"
      ? [
          { id: "module", lane: "page", label: "On the page", note: "Module with the question", tpl: "qa/module" },
          { id: "typing", lane: "page", label: "Typing the answer", note: "Character counter, submit button", tpl: "qa/typing", anchor: "question" },
        ]
      : kind === "hot"
        ? [
            { id: "module", lane: "page", label: "On the page", note: "Module with the hot-or-not slider", tpl: "hot/module" },
            { id: "voted", lane: "page", label: "Rated", note: "Share of fans who said hot", tpl: "hot/voted", anchor: "question" },
          ]
        : [{ id: "module", lane: "page", label: "On the page", note: "Module with the question and answers", tpl: "survey/module" }];
  const out: Station[] = [
    ...(kind !== "hot" ? [{ id: "answered-out", lane: "out" as Lane, label: "Answered", note: "Overlay asks to log in", tpl: `${kind}/answered-out`, anchor: "overlayTitle" }] : []),
    { id: "reveal-front", lane: "out", label: "Card reveal", note: "Front · Payload: Logged Out Reveal", tpl: `${kind}/reveal-front`, side: "front" },
    { id: "reveal-back", lane: "out", label: "Card reveal, back", note: "Back · card description", tpl: kind === "survey" ? "survey/reveal-back" : `${kind}/reveal-front`, side: "back" },
  ];
  const inn: Station[] = [
    { id: "answered-in", lane: "in", label: "Answered", note: "Message after the answer", tpl: "survey/answered-in", anchor: "postMessage" },
    { id: "collected-front", lane: "in", label: "Collected", note: "Front · popup title + reward description", tpl: "survey/collected-front", side: "front" },
    { id: "collected-back", lane: "in", label: "Collected, back", note: "Back · card description", tpl: "survey/collected-back", side: "back" },
  ];
  const col: Station[] = [
    { id: "unearned-front", lane: "collection", label: "Not collected yet", note: "Front · teaser + button", tpl: "any/unearned-front", side: "front" },
    { id: "unearned-back", lane: "collection", label: "Not collected, back", note: "Back · card description", tpl: "any/unearned-back", side: "back" },
    { id: "earned-front", lane: "collection", label: "Collected", note: "Front · reward description", tpl: "any/earned-front", side: "front" },
    { id: "earned-back", lane: "collection", label: "Collected, back", note: "Back · card description", tpl: "any/earned-back", side: "back" },
  ];
  return [...task, ...out, ...inn, ...col];
}

// field hints: what a field is, shown in the text panel. The writing rules live in
// Team Cards → Lexicon (lib/teamCardRules), for Claude and the copy check.
export const HINTS: Record<string, { what: string }> = {
  modCategory: { what: "Small line above the module headline." },
  modHeadline: { what: "Headline of the module on the page." },
  modSubline: { what: "Text under the module headline." },
  modCopy: { what: "Longer text in the module, under the headline." },
  question: { what: "The task: what fans answer or rate." },
  submitLabel: { what: "Button that sends the answer." },
  overlayTitle: { what: "Overlay after answering while logged out." },
  overlaySubtitle: { what: "Line under the overlay title: why logging in is worth it." },
  postTitle: { what: "Title after answering while logged in." },
  postMessage: { what: "Message after answering while logged in (on a quiz: the right answer)." },
  revealTitle: { what: "Title of the card popup for logged-out visitors." },
  revealDescription: { what: "Text on the logged-out card popup." },
  revealButton: { what: "Button on the logged-out card popup." },
  badgePopupTitle: { what: "Title of the popup when the card is collected." },
  rewardDescription: { what: "What the fan got. Front of the collected card." },
  rewardTeaser: { what: "How to get the card. Front of the card before it is collected." },
  description: { what: "Back of the card (all states)." },
  publicTitle: { what: "Name of the card in the collection." },
  ctaLabel: { what: "Button on the card before it is collected, goes to the activation." },
};
