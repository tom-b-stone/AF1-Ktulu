// Browser-only: renders the 16 book pages as 300 dpi canvases and imposes
// them onto two A4 landscape sheets (+ a folding guide) with pdf-lib.
// Fonts come from the page (Archivo is loaded in app/layout.tsx).
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import QRCode from "qrcode";
import {
  BOOK_PAGES,
  PANEL_H,
  PANEL_PX_H,
  PANEL_PX_W,
  PANEL_W,
  SHEETS,
  SHEET_H,
  SHEET_W,
  ZINE_SLOTS,
  pageContent,
  shareUrl,
  type Book,
} from "./photobook";
import { lineArt } from "./lineArt";
import { ZINE_STEPS } from "./zinePage";

const LAVA = "#E33E1A";
const CHALK = "#F5F2F2";
const GRAPHITE = "#2B2929";
const FRAME = 34; // ≈ 3 mm white frame: home printers can't print to the edge
const TEAM = "Audi Revolut F1® Team";

type PhotoSource = (photoId: string) => Promise<Blob | undefined>;

// Three editions of the same zine:
//  photo     – photo cover, photo pages
//  diy       – cover as a light grey line drawing to colour in, photo pages
//  colouring – the whole zine as a colouring book (all pages line drawings)
export type ZineVariant = "photo" | "diy" | "colouring";
export const ZINE_VARIANTS: { key: ZineVariant; label: string; file: string }[] = [
  { key: "photo", label: "Photo zine", file: "photo" },
  { key: "diy", label: "DIY cover", file: "diy" },
  { key: "colouring", label: "Colouring book", file: "colouring" },
];
const LIGHT_LINE = "#B9B4B4";

async function bitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

function cover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number) {
  const k = Math.max(w / img.width, h / img.height);
  const sw = w / k;
  const sh = h / k;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): number {
  const words = text.split(" ");
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lh;
      line = w;
    } else line = t;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lh;
}

let logoCache: HTMLImageElement | null = null;
async function logo(): Promise<HTMLImageElement | null> {
  if (logoCache) return logoCache;
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      logoCache = img;
      res(img);
    };
    img.onerror = () => res(null);
    img.src = "/af1-logo.svg";
  });
}

async function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string) {
  const img = await logo();
  if (!img) return;
  const w = (img.width / img.height) * h || h;
  const off = document.createElement("canvas");
  off.width = Math.ceil(w);
  off.height = Math.ceil(h);
  const o = off.getContext("2d")!;
  o.drawImage(img, 0, 0, w, h);
  o.globalCompositeOperation = "source-in";
  o.fillStyle = color;
  o.fillRect(0, 0, w, h);
  ctx.drawImage(off, x, y);
}

export async function ensureFonts() {
  try {
    await Promise.all([document.fonts.load('800 80px "Archivo"'), document.fonts.load('600 30px "Archivo"'), document.fonts.load('400 30px "Archivo"')]);
  } catch {
    /* falls back to the system sans */
  }
}

const F = (weight: number, px: number) => `${weight} ${px}px "Archivo", "Helvetica Neue", Arial, sans-serif`;

// One book page as a 300 dpi canvas (upright).
export async function renderPage(book: Book, bookPage: number, getPhoto: PhotoSource, origin: string, variant?: ZineVariant): Promise<HTMLCanvasElement> {
  const v: ZineVariant = variant ?? (book.coverStyle === "photo" ? "photo" : "diy");
  const c = document.createElement("canvas");
  c.width = PANEL_PX_W;
  c.height = PANEL_PX_H;
  const ctx = c.getContext("2d")!;
  const W = PANEL_PX_W;
  const H = PANEL_PX_H;
  const content = pageContent(book, bookPage);
  const city = book.city.toUpperCase();

  if (content.kind === "cover" && v !== "photo") {
    const line = v === "diy" ? LIGHT_LINE : GRAPHITE;
    // Colour-in cover: logo, outlined type and a line drawing of the cover
    // photo on chalk. Layout borrows from the Team Cards (round pill top
    // left, big location code top right) so it looks finished as it is.
    ctx.fillStyle = CHALK;
    ctx.fillRect(0, 0, W, H);
    const pad = FRAME + 44;
    // round pill
    const pill = book.round ? `R${String(book.round).padStart(2, "0")}` : String(book.year);
    ctx.font = F(600, 34);
    const pw = ctx.measureText(pill).width + 44;
    ctx.strokeStyle = line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(pad, pad, pw, 58, 29);
    ctx.stroke();
    ctx.fillStyle = GRAPHITE;
    ctx.fillText(pill, pad + 22, pad + 41);
    ctx.font = F(500, 26);
    ctx.fillText("GP MINI-ZINE", pad, pad + 104);
    // location code, outlined so it can be coloured in
    const code = book.loc.toUpperCase();
    ctx.font = F(800, 210);
    ctx.textAlign = "right";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = v === "diy" ? LIGHT_LINE : LAVA;
    ctx.strokeText(code, W - pad + 6, pad + 172);
    ctx.textAlign = "left";
    // line drawing
    const top = pad + 220;
    const bottom = H - pad - 120;
    const blob = content.photoId ? await getPhoto(content.photoId) : undefined;
    if (blob) {
      const img = await bitmap(blob);
      const art = lineArt(img, { width: W - 2 * FRAME, height: bottom - top, color: line, detail: 1, pen: 3 });
      img.close();
      // soft fade at top and bottom so the drawing floats instead of being boxed in
      const m = document.createElement("canvas");
      m.width = art.width;
      m.height = art.height;
      const mc = m.getContext("2d")!;
      mc.drawImage(art, 0, 0);
      mc.globalCompositeOperation = "destination-in";
      const fade = mc.createLinearGradient(0, 0, 0, m.height);
      fade.addColorStop(0, "rgba(0,0,0,0)");
      fade.addColorStop(0.08, "rgba(0,0,0,1)");
      fade.addColorStop(0.92, "rgba(0,0,0,1)");
      fade.addColorStop(1, "rgba(0,0,0,0)");
      mc.fillStyle = fade;
      mc.fillRect(0, 0, m.width, m.height);
      ctx.drawImage(m, FRAME, top);
    }
    // footer
    ctx.fillStyle = LAVA;
    ctx.fillRect(pad, H - pad - 96, 70, 8);
    await drawLogo(ctx, pad, H - pad - 62, 56, GRAPHITE);
    ctx.fillStyle = GRAPHITE;
    ctx.font = F(600, 28);
    ctx.textAlign = "right";
    ctx.fillText(book.city.toUpperCase(), W - pad, H - pad - 34);
    ctx.font = F(400, 24);
    ctx.fillText(`Grand Prix ${book.year}`, W - pad, H - pad - 2);
    ctx.textAlign = "left";
    return c;
  }

  if (content.kind === "cover") {
    ctx.fillStyle = GRAPHITE;
    ctx.fillRect(0, 0, W, H);
    const blob = content.photoId ? await getPhoto(content.photoId) : undefined;
    if (blob) {
      const img = await bitmap(blob);
      cover(ctx, img, FRAME, FRAME, W - 2 * FRAME, H - 2 * FRAME);
      img.close();
    }
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, "rgba(20,18,16,0)");
    g.addColorStop(1, "rgba(20,18,16,0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(FRAME, FRAME, W - 2 * FRAME, H - 2 * FRAME);
    await drawLogo(ctx, FRAME + 44, FRAME + 44, 70, CHALK);
    ctx.fillStyle = LAVA;
    ctx.fillRect(FRAME + 44, H - FRAME - 330, 90, 10);
    ctx.fillStyle = CHALK;
    ctx.font = F(800, city.length > 10 ? 84 : 112);
    ctx.fillText(city, FRAME + 44, H - FRAME - 210);
    ctx.font = F(700, 46);
    ctx.fillText(`GRAND PRIX ${book.year}`, FRAME + 44, H - FRAME - 140);
    ctx.font = F(500, 30);
    ctx.globalAlpha = 0.85;
    ctx.fillText(TEAM, FRAME + 44, H - FRAME - 70);
    ctx.globalAlpha = 1;
    return c;
  }

  if (content.kind === "intro") {
    const ink = v === "colouring" ? GRAPHITE : CHALK;
    ctx.fillStyle = v === "colouring" ? CHALK : GRAPHITE;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = LAVA;
    ctx.fillRect(FRAME + 44, FRAME + 90, 90, 10);
    ctx.fillStyle = ink;
    ctx.font = F(800, 70);
    let y = wrap(ctx, "This one's yours.", FRAME + 44, FRAME + 210, W - 2 * FRAME - 88, 80);
    ctx.font = F(400, 32);
    ctx.globalAlpha = 0.85;
    y = wrap(
      ctx,
      `Thirteen moments from the ${book.gpName}${book.dateLabel ? `, ${book.dateLabel}` : ""}, seen through the team's lens. One more edition for your collection.`,
      FRAME + 44,
      y + 30,
      W - 2 * FRAME - 88,
      46
    );
    ctx.globalAlpha = 1;
    await drawLogo(ctx, FRAME + 44, H - FRAME - 140, 56, ink);
    ctx.font = F(500, 26);
    ctx.fillStyle = ink;
    ctx.fillText(TEAM, FRAME + 44, H - FRAME - 50);
    return c;
  }

  if (content.kind === "back") {
    // colouring book: no full-bleed lava (ink), a lava frame instead
    const light = v === "colouring";
    const ink = light ? GRAPHITE : CHALK;
    ctx.fillStyle = light ? CHALK : LAVA;
    ctx.fillRect(0, 0, W, H);
    if (light) {
      ctx.strokeStyle = LAVA;
      ctx.lineWidth = 6;
      ctx.strokeRect(FRAME + 14, FRAME + 14, W - 2 * FRAME - 28, H - 2 * FRAME - 28);
    }
    ctx.fillStyle = ink;
    ctx.font = F(800, 66);
    ctx.fillText("Show us yours.", FRAME + 44, FRAME + 150);
    // QR on a chalk tile
    const qrSize = 470;
    const qx = (W - qrSize) / 2;
    const qy = FRAME + 230;
    ctx.fillStyle = CHALK;
    ctx.fillRect(qx - 30, qy - 30, qrSize + 60, qrSize + 60);
    const qr = document.createElement("canvas");
    await QRCode.toCanvas(qr, shareUrl(origin, book), {
      width: qrSize,
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: GRAPHITE, light: CHALK },
    });
    ctx.drawImage(qr, qx, qy, qrSize, qrSize);
    ctx.fillStyle = ink;
    ctx.font = F(500, 30);
    let y = wrap(ctx, `Scan the code, post your edition, coloured in, customised or as it is, and tag @${book.instagram}. See you at the next Grand Prix.`, FRAME + 44, qy + qrSize + 110, W - 2 * FRAME - 88, 42);
    ctx.font = F(800, 34);
    wrap(ctx, book.hashtags.join(" "), FRAME + 44, y + 10, W - 2 * FRAME - 88, 44);
    await drawLogo(ctx, FRAME + 44, H - FRAME - 110, 52, ink);
    return c;
  }

  // photo page
  ctx.fillStyle = CHALK;
  ctx.fillRect(0, 0, W, H);
  const blob = content.photoId ? await getPhoto(content.photoId) : undefined;
  const top = FRAME;
  const bottomBar = 120;
  if (blob && v === "colouring") {
    const img = await bitmap(blob);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(FRAME, top, W - 2 * FRAME, H - top - bottomBar);
    ctx.drawImage(lineArt(img, { width: W - 2 * FRAME, height: H - top - bottomBar, color: "#3A3737", detail: 1, pen: 3 }), FRAME, top);
    ctx.strokeStyle = LIGHT_LINE;
    ctx.lineWidth = 2;
    ctx.strokeRect(FRAME, top, W - 2 * FRAME, H - top - bottomBar);
    img.close();
  } else if (blob) {
    const img = await bitmap(blob);
    cover(ctx, img, FRAME, top, W - 2 * FRAME, H - top - bottomBar);
    img.close();
  } else {
    ctx.fillStyle = "#E6E3E3";
    ctx.fillRect(FRAME, top, W - 2 * FRAME, H - top - bottomBar);
  }
  ctx.fillStyle = LAVA;
  ctx.font = F(800, 34);
  ctx.fillText(String(content.n).padStart(2, "0"), FRAME + 6, H - 52);
  ctx.fillStyle = GRAPHITE;
  ctx.font = F(600, 24);
  const label = `${city} ${book.year}`;
  ctx.fillText(label, W - FRAME - 6 - ctx.measureText(label).width, H - 54);
  return c;
}

function rotate180(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width, c.height);
  ctx.rotate(Math.PI);
  ctx.drawImage(src, 0, 0);
  return c;
}

async function jpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
  if (!blob) throw new Error("canvas export failed");
  return new Uint8Array(await blob.arrayBuffer());
}

// Builds the print PDF: sheet 1, sheet 2, folding guide. onProgress gets
// (done, total) as pages render.
export async function buildPdf(book: Book, getPhoto: PhotoSource, origin: string, onProgress?: (done: number, total: number) => void, variant?: ZineVariant): Promise<Uint8Array> {
  await ensureFonts();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${book.gpName} ${book.year} GP Mini-Zine${variant === "colouring" ? " (colouring book)" : variant === "diy" ? " (DIY cover)" : ""}`);
  pdf.setAuthor(TEAM);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
  let done = 0;

  for (const sheet of SHEETS) {
    const page = pdf.addPage([SHEET_W, SHEET_H]);
    for (let z = 1; z <= 8; z++) {
      const bookPage = sheet.bookPages[z - 1];
      const slot = ZINE_SLOTS[z];
      let canvas = await renderPage(book, bookPage, getPhoto, origin, variant);
      if (slot.rotated) canvas = rotate180(canvas);
      const img = await pdf.embedJpg(await jpeg(canvas));
      page.drawImage(img, { x: slot.col * PANEL_W, y: slot.row === "top" ? PANEL_H : 0, width: PANEL_W, height: PANEL_H });
      onProgress?.(++done, BOOK_PAGES);
    }
    // cut line: centre line across the two middle panels
    page.drawLine({
      start: { x: PANEL_W, y: PANEL_H },
      end: { x: PANEL_W * 3, y: PANEL_H },
      thickness: 0.8,
      color: rgb(0.89, 0.24, 0.1),
      dashArray: [5, 4],
    });
    // fold ticks at the sheet edges
    const tick = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: rgb(0.55, 0.55, 0.55) });
    for (const x of [PANEL_W, PANEL_W * 2, PANEL_W * 3]) {
      tick(x, 0, x, 8);
      tick(x, SHEET_H - 8, x, SHEET_H);
    }
    tick(0, PANEL_H, 8, PANEL_H);
    tick(SHEET_W - 8, PANEL_H, SHEET_W, PANEL_H);
    page.drawText(sheet.name.toUpperCase(), { x: 12, y: PANEL_H + 4, size: 5, font: helv, color: rgb(0.6, 0.6, 0.6), rotate: degrees(0) });
  }

  // folding guide
  const g = pdf.addPage([SHEET_W, SHEET_H]);
  const lava = rgb(0.89, 0.24, 0.1);
  const dark = rgb(0.17, 0.16, 0.16);
  g.drawRectangle({ x: 0, y: 0, width: SHEET_W, height: SHEET_H, color: rgb(0.96, 0.95, 0.95) });
  g.drawText("How to fold your GP Mini-Zine", { x: 56, y: SHEET_H - 80, size: 28, font: helvB, color: dark });
  g.drawRectangle({ x: 56, y: SHEET_H - 100, width: 40, height: 4, color: lava });
  const steps = ZINE_STEPS.map((s) => s.copy); // same wording as the website slider
  let y = SHEET_H - 150;
  steps.forEach((s, i) => {
    g.drawText(String(i + 1).padStart(2, "0"), { x: 56, y, size: 14, font: helvB, color: lava });
    g.drawText(s, { x: 96, y, size: 13, font: helv, color: dark, maxWidth: SHEET_W - 160 });
    y -= 38;
  });
  g.drawText(`${TEAM}  ·  ${book.gpName} ${book.year}`, { x: 56, y: 40, size: 10, font: helv, color: rgb(0.4, 0.4, 0.4) });
  return pdf.save();
}
