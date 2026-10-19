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

export type ZineAssets = { teaser: string; steps: string[]; preview?: string }; // media ids

// pdfs: one media id per edition (photo zine, DIY cover, colouring book)
export type ZineIds = { coverMedia: string; pageUrl: string; pdfs: { photo?: string; diy?: string; colouring?: string } };

export const ZINE_STEPS: { headline: string; copy: string }[] = [
  { headline: "Print", copy: "Both sheets on A4, landscape, at 100 %. Single-sided." },
  { headline: "Fold lengthwise", copy: "In half along the long side, crease, open again." },
  { headline: "Fold eight panels", copy: "Fold into eight equal panels, open it flat." },
  { headline: "One cut", copy: "Cut only the red dashed line in the middle." },
  { headline: "Push together", copy: "Fold lengthwise again and push both ends to the centre." },
  { headline: "Flatten it", copy: "The cut opens into a cross. Fold it into a little book." },
  { headline: "Nest", copy: "Slide sheet 2 into sheet 1. Staple the spine if you like." },
  { headline: "Make it yours", copy: "Scan the code on the back, share your zine." },
];

const btn = (label: string, target: { url: string } | { anchor: string }, variant: "primary" | "secondary" | "quaternary" = "primary", newTab = false) => ({
  blockType: "link-button",
  appearance: { variant, size: "sm", hug: true },
  label,
  iconPlacement: "after",
  ...("url" in target ? { linkType: "external", url: target.url } : { linkType: "anchor", anchor: target.anchor }),
  openNewTab: newTab,
});

export function zinePageTitle(m: ZineMeta) {
  return `GP Mini-Zine | ${m.gpName} ${m.year}`;
}

export function zinePageSlug(m: ZineMeta) {
  return `gp-mini-zine-${m.slug}`;
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

// Compact page: hero → download teaser (logged out: log in / register;
// logged in: the three PDFs) with the preview video → how-to slider → share.
export function buildZineSections(m: ZineMeta, a: ZineAssets | null, ids: ZineIds) {
  const tags = m.hashtags.join(" ");
  const video = a?.preview ?? a?.teaser;
  const copy = `Thirteen moments from the ${m.gpName}, 16 pages, two A4 sheets. Pick your edition: the photo zine, a DIY cover to colour in, or the whole zine as a colouring book.`;
  const downloads = [
    ids.pdfs.photo && download("Photo zine (PDF)", ids.pdfs.photo, "primary"),
    ids.pdfs.diy && download("DIY cover (PDF)", ids.pdfs.diy, "secondary"),
    ids.pdfs.colouring && download("Colouring book (PDF)", ids.pdfs.colouring, "secondary"),
  ].filter(Boolean);
  const teaser = (auth: "LOGGED_OUT" | "AUTHENTICATED", headline: string, ctas: unknown[]) => ({
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
      headline: `Your ${m.city} weekend. In your pocket.`,
      subline: `${m.gpName} ${m.year}`,
      copy: "Print it, fold it, colour it in. A zine from the race weekend, made by the team, finished by you.",
      ctas: [btn("Get your zine", { anchor: "#download" })],
      container: {
        contentPosition: "bottom",
        horizontalPosition: "left",
        size: "large",
        background: { type: "image", imageSettings: { media: ids.coverMedia, shouldHaveOverlay: true, bgColor: "graphite" } },
      },
      authRequirement: "PUBLIC",
    },
    teaser("LOGGED_OUT", "Log in. Download. Fold.", [signIn("Log in to download", false, "primary"), signIn("Register now", true, "quaternary")]),
    teaser("AUTHENTICATED", "Your zine is ready.", downloads),
    {
      blockType: "carousel",
      category: "How it works",
      headline: "Eight folds. Ten minutes.",
      copy: "Printer, scissors, a stapler if you like.",
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
    {
      blockType: "call-to-action",
      category: "Share",
      headline: "Show us your zine.",
      copy: `Post it with ${tags} and tag @${m.instagram}.`,
      ctas: [],
      container: {
        contentPosition: "center",
        size: "fit",
        background: { type: "color", color: "chalk", imageSettings: { shouldHaveOverlay: false, bgColor: "graphite" } },
      },
      children: [
        {
          blockType: "share-to-button-list",
          variant: "tertiary",
          url: ids.pageUrl,
          shareMessage: `My ${m.city} GP Mini-Zine from the Audi Revolut F1® Team: photos from the ${m.gpName} to print, fold and colour in. ${tags}`,
          shareButtons: ["whatsapp", "facebook", "twitter", "copy"].map((social) => ({ shareButton: { social } })),
        },
      ],
      anchorId: "share",
      authRequirement: "PUBLIC",
    },
  ];
}

export function buildZineMeta(m: ZineMeta, coverMedia: string) {
  return {
    title: `${m.gpName} ${m.year} GP Mini-Zine | Audi Revolut F1® Team`,
    description: `Print, fold and colour in your own GP Mini-Zine of the ${m.gpName} ${m.year}: thirteen moments from the Audi Revolut F1® Team weekend.`,
    image: coverMedia,
  };
}
