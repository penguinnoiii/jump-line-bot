// Generates the LINE rich-menu image (2500x843, N tappable panels) as a PNG
// buffer, by compositing pre-made panel illustrations (scripts/assets/richmenu/)
// side by side — each source image already carries its own title/subtitle/
// caption text, so this file just contain-fits each one into its panel slot.

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, 'assets', 'richmenu');

const W = 2500;
const H = 843;

// One entry per panel, left to right — file order must match ACTIONS in
// setup-richmenu.js.
const PANELS = [
  { file: 'school.png' }, // ค้นหา/แนะนำโรงเรียน
  { file: 'course.png' }, // แนะแนวสายการเรียน
  { file: 'dashboard.png' }, // แดชบอร์ด
];

/** Draw `img` into the rect (x, y, w, h), scaled to fit entirely inside it
 * (CSS `object-fit: contain` behavior) so the title/caption text baked into
 * each source image never gets cropped — these panels are noticeably
 * taller-than-wide relative to the menu's panel slots, so a `cover` crop
 * would shave text off the top and bottom. */
function drawContain(ctx, img, x, y, w, h) {
  const scale = Math.min(w / img.width, h / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const dx = x + (w - drawW) / 2;
  const dy = y + (h - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

/** Sample a pixel just inside the image's corner so the letterboxing left
 * behind by drawContain reads as an extension of the card, not a hard seam. */
function cornerColor(img) {
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const { data } = cx.getImageData(10, 10, 1, 1);
  return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
}

export async function buildRichMenuPng() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const n = PANELS.length;
  const pw = W / n;

  const images = await Promise.all(
    PANELS.map((p) => loadImage(path.join(ASSETS_DIR, p.file))),
  );

  images.forEach((img, i) => {
    const x = i * pw;
    ctx.fillStyle = cornerColor(img);
    ctx.fillRect(x, 0, pw, H);
    drawContain(ctx, img, x, 0, pw, H);
  });

  // Thin dividers between panels so the tap zones stay legible even where
  // two source images land on similar background colors.
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 3;
  for (let i = 1; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * pw, 0);
    ctx.lineTo(i * pw, H);
    ctx.stroke();
  }

  return canvas.toBuffer('image/png');
}

// Panel bounds map to the same N columns, for the rich menu areas.
export const PANEL_BOUNDS = PANELS.map((_, i) => ({
  x: Math.round((W / PANELS.length) * i),
  y: 0,
  width: Math.round(W / PANELS.length),
  height: H,
}));

export const MENU_SIZE = { width: W, height: H };
