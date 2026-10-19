// GP Mini-Zine fan page on the staging CMS: the block layout, built from the
// blocks audif1.com already uses (hero, teaser, carousel, call-to-action
// with link buttons, share-to-button-list). Pure data, no I/O, so the
// publish route and one-off scripts produce the same page.

export type ZineMeta = {
  slug: string; // "2026-chn"
  gpName: string; // "Chinese Grand Prix"
  city: string; // "Shanghai"
  loc: string; // "CHN"
  year: number;
  dateLabel: string;
  hashtags: string[]; // ["#ARF1", "#ChineseGP"]
  instagram: string; // handle without @
};

// media ids; fans = inspiration photos (fans with their zines), share = video behind the share box
export type ZineAssets = { teaser: string; steps: string[]; preview?: string; fans?: { id: string; gp: string }[]; share?: string };

// Inspiration gallery: fans with their zines from different Grand Prix. AI-generated examples
// for the demo, to be replaced by real fan posts (with permission) once the series runs.
export const ZINE_FANS: { slug: string; gp: string; alt: string }[] = [
  { slug: "monaco", gp: "Monaco", alt: "A fan in a Monaco café holds up her coloured-in GP Mini-Zine" },
  { slug: "silverstone", gp: "Silverstone", alt: "A Silverstone GP Mini-Zine on a desk with coloured pencils" },
  { slug: "monza", gp: "Monza", alt: "A fan holds his customised Monza GP Mini-Zine in the grandstand" },
  { slug: "suzuka", gp: "Suzuka", alt: "A fan shows her collection of GP Mini-Zines, Suzuka in front" },
  { slug: "las-vegas", gp: "Las Vegas", alt: "A Las Vegas GP Mini-Zine held up against the lights of the Strip" },
  { slug: "singapore", gp: "Singapore", alt: "A boy shows the Singapore GP Mini-Zine he coloured in" },
];

// pdfs: one media id per edition (photo zine, DIY cover, colouring book)
export type ZineIds = { coverMedia: string; pageUrl: string; pdfs: { photo?: string; diy?: string; colouring?: string } };

// One edition in "The collection" slider: a zine page already on the CMS.
export type ZineEntry = { pageId: string; slug: string; gpName: string; year: string; coverMedia: string };

// Same wording on the website slider and in the PDF folding guide.
export const ZINE_STEPS: { headline: string; copy: string }[] = [
  { headline: "Print", copy: "Print both sheets on A4, landscape, at 100 % (not \"fit to page\"), single-sided." },
  { headline: "Fold lengthwise", copy: "Fold each sheet in half along the long side, crease it, then open it again." },
  { headline: "Fold eight panels", copy: "Fold it in half along the short side, then into quarters, and open it flat again: eight equal panels." },
  { headline: "One cut", copy: "Cut along the red dashed line in the middle of each sheet. Only that line." },
  { headline: "Push together", copy: "Fold along the long side again and push both ends towards the centre, so the cut opens into a cross." },
  { headline: "Flatten it", copy: "Flatten it into a little book with the cover on the front." },
  { headline: "Nest", copy: "Open sheet 1 at its centre pages and slide sheet 2 inside. Staple or stitch the spine if you like." },
  { headline: "Make it yours", copy: "Make it yours, then scan the code on the back and share it." },
];

export const COLLECTION_ANCHOR = "collection";

const btn = (label: string, target: { url: string } | { anchor: string } | { page: string }, variant: "primary" | "secondary" | "quaternary" = "primary", newTab = false) => ({
  blockType: "link-button",
  appearance: { variant, size: "sm", hug: true },
  label,
  iconPlacement: "after",
  ...("url" in target
    ? { linkType: "external", url: target.url }
    : "page" in target
      ? { linkType: "internal", doc: { relationTo: "pages", value: target.page } }
      : { linkType: "anchor", anchor: target.anchor }),
  openNewTab: newTab,
});

export function zinePageTitle(m: ZineMeta) {
  return `GP Mini-Zine | ${m.gpName} ${m.year}`;
}

export function zinePageSlug(m: ZineMeta) {
  return `gp-mini-zine-${m.slug}`;
}

// Reads a zine page from the CMS back into a slider entry (null = not a usable zine page).
export function zineEntryOf(p: { id: string; slug: string; title?: string; sections?: Record<string, unknown>[] }): ZineEntry | null {
  if (!/^gp-mini-zine-\d{4}-[a-z]+$/.test(p.slug)) return null;
  const hero = p.sections?.find((s) => s.blockType === "hero") as { container?: { background?: { imageSettings?: { media?: unknown } } } } | undefined;
  const media = hero?.container?.background?.imageSettings?.media;
  const coverMedia = typeof media === "string" ? media : (media as { id?: string } | undefined)?.id;
  const t = (p.title ?? "").match(/\|\s*(.+?)\s+(\d{4})\s*$/);
  if (!coverMedia || !t) return null;
  return { pageId: p.id, slug: p.slug, gpName: t[1], year: t[2], coverMedia };
}

// "The collection": every GP Mini-Zine built so far, newest first.
export function buildCollectionSection(entries: ZineEntry[], currentPageId?: string) {
  return {
    blockType: "carousel",
    category: "The collection",
    headline: "Start the collection.",
    copy: "Every Grand Prix gets its own edition. These are all of them so far.",
    hasControls: true,
    aspectRatio: "aspect-square",
    ctas: [],
    carouselItems: entries.map((e) => ({
      carouselImage: {
        imagePreview: e.coverMedia,
        shouldHaveOverlay: false,
        security: "public",
        ctas: [],
        hasFullScreenMode: false,
        isSameAsFullScreen: true,
        subline: e.pageId === currentPageId ? `${e.year} · New` : e.year,
        headline: e.gpName,
        copy: "Photo, DIY Cover and Colouring Editions.",
        contentCtas: [btn("Get this edition", e.pageId === currentPageId ? { anchor: "#download" } : { page: e.pageId }, "quaternary")],
        links: [],
      },
    })),
    anchorId: COLLECTION_ANCHOR,
    authRequirement: "PUBLIC",
    blockName: "The collection",
  };
}

// Puts the collection slider after the how-to (replaces an older one); the
// inspiration gallery and the share box stay at the very bottom.
const BOTTOM = new Set(["inspiration", "share"]);
const isBottom = (s: Record<string, unknown>) => BOTTOM.has(String(s.anchorId ?? "")) || String(s.blockName ?? "").startsWith("Inspiration");
export function withCollection(sections: Record<string, unknown>[], collection: ReturnType<typeof buildCollectionSection>) {
  const rest = sections.filter((s) => s.anchorId !== COLLECTION_ANCHOR);
  return [...rest.filter((s) => !isBottom(s)), collection, ...rest.filter(isBottom)];
}

const signIn = (label: string, isSignup: boolean, variant: "primary" | "quaternary") => ({
  blockType: "sign-in-button",
  appearance: { variant, size: "sm", hug: true },
  label,
  ...(isSignup ? {} : { icon: "lock" }),
  iconPlacement: "after",
  isSignup,
});
const download = (label: string, asset: string, variant: "primary" | "secondary" | "quaternary") => ({
  blockType: "download-asset-button",
  appearance: { variant, size: "sm", hug: true },
  label,
  iconPlacement: "after",
  asset,
});

// Page: hero → download teaser (logged out: log in / register; logged in:
// the three PDFs) with the preview video → how-to slider → share → the
// collection slider (added by the publish route once the page id exists).
export function buildZineSections(m: ZineMeta, a: ZineAssets | null, ids: ZineIds) {
  const video = a?.preview ?? a?.teaser;
  const downloads = [
    ids.pdfs.photo && download("Photo Edition (PDF)", ids.pdfs.photo, "primary"),
    ids.pdfs.diy && download("DIY Cover Edition (PDF)", ids.pdfs.diy, "secondary"),
    ids.pdfs.colouring && download("Colouring Edition (PDF)", ids.pdfs.colouring, "secondary"),
  ].filter(Boolean);
  const teaser = (auth: "LOGGED_OUT" | "AUTHENTICATED", headline: string, copy: string, ctas: unknown[]) => ({
    blockType: "teaser",
    headline,
    copy,
    ...(video ? { image: video } : {}),
    oriontation: "ltr",
    size: "large",
    ctas,
    children: [],
    anchorId: "download",
    authRequirement: auth,
    blockName: auth === "LOGGED_OUT" ? "Download (logged out)" : "Download (logged in)",
  });
  return [
    {
      blockType: "hero",
      category: "GP Mini-Zine",
      headline: `The ${m.gpName}. Yours to keep.`,
      subline: "A new edition every Grand Prix.",
      copy: `A printable fan collectible with official team photography from the ${m.city} weekend. Print it, fold it and make it your own.`,
      ctas: [btn("Get your edition", { anchor: "#download" })],
      container: {
        contentPosition: "bottom",
        horizontalPosition: "left",
        size: "large",
        background: { type: "image", imageSettings: { media: ids.coverMedia, shouldHaveOverlay: true, bgColor: "graphite" } },
      },
      authRequirement: "PUBLIC",
    },
    teaser(
      "LOGGED_OUT",
      `Your ${m.city} edition is waiting.`,
      "Log in to download all three editions. Photo Edition: the race weekend through official team photography. DIY Cover Edition: our photos inside, a cover for you to personalise. Colouring Edition: the whole weekend as illustrations to colour.",
      [signIn("Log in to download", false, "primary"), signIn("Register now", true, "quaternary")]
    ),
    teaser(
      "AUTHENTICATED",
      `Your ${m.city} edition is ready.`,
      `The newest addition to your collection: thirteen moments from the ${m.gpName}, captured by the team. Pick your edition, print it at home and keep it with the rest of your season.`,
      downloads
    ),
    {
      blockType: "carousel",
      category: "How it works",
      headline: "Eight folds. Ten minutes.",
      copy: "All you need: a printer, scissors and, if you like, a stapler.",
      hasControls: true,
      aspectRatio: "aspect-square",
      ctas: [],
      carouselItems: ZINE_STEPS.map((s, i) => ({
        carouselImage: {
          ...(a?.steps[i] ? { imagePreview: a.steps[i] } : {}),
          shouldHaveOverlay: false,
          security: "public",
          ctas: [],
          hasFullScreenMode: false,
          isSameAsFullScreen: true,
          subline: `STEP ${String(i + 1).padStart(2, "0")}`,
          headline: s.headline,
          copy: s.copy,
          contentCtas: [],
          links: [],
        },
      })),
      anchorId: "how-to",
      authRequirement: "PUBLIC",
    },
    // inspiration + share go to the bottom, after the collection slider (see withCollection)
  ];
}

// Bottom of the page: fans' zines from different Grand Prix as inspiration,
// then the boxed share CTA with the fan video behind the share buttons.
export function buildZineBottom(m: ZineMeta, a: ZineAssets | null, ids: ZineIds) {
  const tags = m.hashtags.join(" ");
  const out: Record<string, unknown>[] = [];
  if (a?.fans?.length) {
    out.push(
      {
        blockType: "call-to-action",
        category: "Inspiration",
        headline: "Made by fans.",
        copy: "Coloured in, stickered, signed or collected: GP Mini-Zines from race weekends around the world.",
        ctas: [],
        container: { contentPosition: "center", size: "fit", background: { type: "color", color: "chalk", imageSettings: { shouldHaveOverlay: false, bgColor: "graphite" } } },
        children: [],
        anchorId: "inspiration",
        authRequirement: "PUBLIC",
        blockName: "Inspiration · headline",
      },
      {
        blockType: "gallery",
        images: a.fans.map((f) => ({ image: { ctas: [], background: { type: "image", imageSettings: { media: f.id, shouldHaveOverlay: false, bgColor: "graphite", hasFullScreenMode: true, isSameAsFullScreen: true } } } })),
        authRequirement: "PUBLIC",
        blockName: "Inspiration · fan zines",
      }
    );
  }
  out.push({
    blockType: "call-to-action",
    category: "Share",
    headline: "Show us your edition.",
    copy: `Coloured in, customised or kept as it is: photograph your finished zine, post it with ${tags} and tag @${m.instagram}. See you at the next Grand Prix.`,
    ctas: [],
    container: {
      contentPosition: "center",
      size: "boxed",
      background: a?.share
        ? { type: "image", imageSettings: { media: a.share, shouldHaveOverlay: true, bgColor: "graphite" } }
        : { type: "color", color: "graphite", imageSettings: { shouldHaveOverlay: false, bgColor: "graphite" } },
    },
    children: [
      {
        blockType: "share-to-button-list",
        variant: "tertiary",
        url: ids.pageUrl,
        shareMessage: `My ${m.city} edition of the GP Mini-Zine from the Audi Revolut F1® Team: official photos from the ${m.gpName}, printed, folded and made my own. ${tags}`,
        shareButtons: ["whatsapp", "facebook", "twitter", "copy"].map((social) => ({ shareButton: { social } })),
      },
    ],
    anchorId: "share",
    authRequirement: "PUBLIC",
    blockName: "Share (boxed)",
  });
  return out;
}

export function buildZineMeta(m: ZineMeta, coverMedia: string) {
  return {
    title: `${m.gpName} ${m.year} GP Mini-Zine | Audi Revolut F1® Team`,
    description: `Download the ${m.gpName} ${m.year} GP Mini-Zine: a printable F1 collectible with official Audi Revolut F1® Team photography, in three editions.`,
    image: coverMedia,
  };
}
