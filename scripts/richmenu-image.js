// Generates the LINE rich-menu image (2500x843) as a PNG buffer, by
// compositing pre-made panel illustrations (scripts/assets/richmenu/) into a
// 2-column layout: dashboard as one big panel on the left, the other two
// stacked vertically in a narrower column on the right.
//
//   +----------------+------------+
//   |                |  school    |
//   |    dashboard   +------------+
//   |                |  course    |
//   +----------------+------------+

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, 'assets', 'richmenu');

const W = 2500;
const H = 843;

const LEFT_W = 1500; // dashboard column — the "biggest" panel
const RIGHT_W = W - LEFT_W;
const ROW_H = H / 2; // school/course stacked in the right column

// Order matches ACTIONS in setup-richmenu.js (school, course, dashboard),
// each carrying its own explicit rect since the layout isn't uniform columns.
const PANELS = [
  { file: 'school.png', x: LEFT_W, y: 0, w: RIGHT_W, h: ROW_H }, // ค้นหา/แนะนำโรงเรียน
  { file: 'course.png', x: LEFT_W, y: ROW_H, w: RIGHT_W, h: H - ROW_H }, // แนะแนวสายการเรียน
  { file: 'dashboard.png', x: 0, y: 0, w: LEFT_W, h: H }, // แดชบอร์ด
];

/** Draw `img` into the rect (x, y, w, h), scaled+cropped to fill it
 * completely (`object-fit: cover`), but anchored to the TOP/center of the
 * source instead of its true center. Every source card has its title at the
 * very top, so a top-anchored crop keeps that title legible even in the
 * short, wide right-column panels where a centered crop would slice right
 * through it. */
function drawTopCover(ctx, img, x, y, w, h) {
  const destAspect = w / h;
  const srcAspect = img.width / img.height;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (srcAspect > destAspect) {
    // Source relatively wider than dest — crop its width, centered.
    sw = img.height * destAspect;
    sx = (img.width - sw) / 2;
  } else {
    // Source relatively taller than dest — crop its height, anchored to top.
    sh = img.width / destAspect;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

export async function buildRichMenuPng() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const images = await Promise.all(
    PANELS.map((p) => loadImage(path.join(ASSETS_DIR, p.file))),
  );

  images.forEach((img, i) => {
    const p = PANELS[i];
    drawTopCover(ctx, img, p.x, p.y, p.w, p.h);
  });

  // Thin dividers between panels so the tap zones stay legible even where
  // two source images land on similar background colors.
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(LEFT_W, 0);
  ctx.lineTo(LEFT_W, H);
  ctx.moveTo(LEFT_W, ROW_H);
  ctx.lineTo(W, ROW_H);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

export const PANEL_BOUNDS = PANELS.map((p) => ({
  x: Math.round(p.x),
  y: Math.round(p.y),
  width: Math.round(p.w),
  height: Math.round(p.h),
}));

export const MENU_SIZE = { width: W, height: H };
