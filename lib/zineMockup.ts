// Browser-only: the zine's rendered cover on a slightly 3D booklet, for the
// "The collection" slider. Square, light studio background, the booklet
// turned a little to the right with page edges, spine shade and a soft shadow.

const SIZE = 1200;

export async function zineMockup(cover: HTMLCanvasElement): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const ctx = c.getContext("2d")!;

  // studio background: chalk with a soft light from the top left
  const bg = ctx.createRadialGradient(SIZE * 0.35, SIZE * 0.3, 50, SIZE * 0.5, SIZE * 0.55, SIZE * 0.85);
  bg.addColorStop(0, "#F7F5F5");
  bg.addColorStop(1, "#D9D5D5");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // booklet geometry (A7 portrait), right edge further away
  const h = 860;
  const w = Math.round((h * 74.25) / 105) * 0.94;
  const x0 = (SIZE - w) / 2 - 10;
  const y0 = (SIZE - h) / 2 - 20;
  const shrink = 0.1; // right edge is 10 % shorter
  const yTop = (x: number) => y0 + (h * shrink * x) / w / 2;
  const colH = (x: number) => h * (1 - (shrink * x) / w);

  // soft contact shadow
  ctx.save();
  ctx.filter = "blur(28px)";
  ctx.fillStyle = "rgba(43,41,41,0.35)";
  ctx.beginPath();
  ctx.moveTo(x0 + 30, y0 + h + 6);
  ctx.lineTo(x0 + w + 46, yTop(w) + colH(w) + 16);
  ctx.lineTo(x0 + w + 60, yTop(w) + colH(w) - 40);
  ctx.lineTo(x0 + 40, y0 + h - 40);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // page edges: a few stacked sheets peeking out at the right and bottom
  for (let i = 5; i >= 1; i--) {
    const d = i * 2.2;
    ctx.fillStyle = i % 2 ? "#ECE9E9" : "#FFFFFF";
    ctx.beginPath();
    ctx.moveTo(x0 + d, y0 + d);
    ctx.lineTo(x0 + w + d, yTop(w) + d);
    ctx.lineTo(x0 + w + d, yTop(w) + colH(w) + d);
    ctx.lineTo(x0 + d, y0 + h + d);
    ctx.closePath();
    ctx.fill();
  }

  // the cover, drawn in 1 px columns for the perspective
  for (let x = 0; x < w; x++) {
    const sx = (x / w) * cover.width;
    ctx.drawImage(cover, sx, 0, Math.max(1, cover.width / w), cover.height, x0 + x, yTop(x), 1.5, colH(x));
  }

  // spine shade on the left and a light sweep across the paper
  const shade = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.22)");
  shade.addColorStop(0.06, "rgba(0,0,0,0.04)");
  shade.addColorStop(0.45, "rgba(255,255,255,0.10)");
  shade.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + w, yTop(w));
  ctx.lineTo(x0 + w, yTop(w) + colH(w));
  ctx.lineTo(x0, y0 + h);
  ctx.closePath();
  ctx.fill();

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("mockup failed"))), "image/jpeg", 0.88));
}
