// Generates the LINE rich-menu image (2500x843, N tappable panels) as a PNG
// buffer. Uses @napi-rs/canvas with a registered Thai font so labels render.

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

// Register Thai-capable fonts under explicit family names.
GlobalFonts.registerFromPath('C:/Windows/Fonts/tahoma.ttf', 'TahomaR');
GlobalFonts.registerFromPath('C:/Windows/Fonts/tahomabd.ttf', 'TahomaB');

const W = 2500;
const H = 843;
const PANELS = [
  { color: '#06a94b', title: 'เข้าสู่ระบบ', sub: 'เริ่มใช้งาน Jump', icon: 'check' },
  { color: '#2f4bd6', title: 'ค้นหาโรงเรียน', sub: 'เปรียบเทียบสายการเรียน', icon: 'search' },
  { color: '#c8770a', title: 'แนะแนว', sub: 'ด้วย AI (Typhoon)', icon: 'cap' },
  { color: '#8a3fd6', title: 'แดชบอร์ด', sub: 'ครู/นักเรียน', icon: 'grid' },
];

function drawIcon(ctx, kind, cx, cy, r) {
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'check') {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
    ctx.lineTo(cx - r * 0.1, cy + r * 0.4);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.4);
    ctx.stroke();
  } else if (kind === 'search') {
    ctx.beginPath();
    ctx.arc(cx - r * 0.15, cy - r * 0.15, r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.35, cy + r * 0.35);
    ctx.lineTo(cx + r * 0.85, cy + r * 0.85);
    ctx.stroke();
  } else if (kind === 'cap') {
    // mortarboard: a diamond + a tassel line
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.55);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r * 0.55);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.55, cy + r * 0.28);
    ctx.lineTo(cx + r * 0.55, cy + r * 0.8);
    ctx.stroke();
  } else if (kind === 'grid') {
    // 2x2 dashboard tiles
    const s = r * 0.62;
    const gap = r * 0.28;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dy]) => {
      const tx = cx + dx * (s / 2 + gap / 2) - s / 2;
      const ty = cy + dy * (s / 2 + gap / 2) - s / 2;
      ctx.strokeRect(tx, ty, s, s);
    });
  }
}

export function buildRichMenuPng() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const n = PANELS.length;
  const pw = W / n;
  // Narrower columns (4 panels) need smaller type than the original 3-panel layout.
  const titleSize = n > 3 ? 78 : 104;
  const subSize = n > 3 ? 40 : 52;
  const iconR = n > 3 ? 68 : 78;

  PANELS.forEach((p, i) => {
    const x = i * pw;
    ctx.fillStyle = p.color;
    ctx.fillRect(x, 0, pw, H);

    const cx = x + pw / 2;
    drawIcon(ctx, p.icon, cx, H * 0.34, iconR);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#ffffff';
    ctx.font = `${titleSize}px TahomaB`;
    ctx.fillText(p.title, cx, H * 0.62);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `${subSize}px TahomaR`;
    ctx.fillText(p.sub, cx, H * 0.78);
  });

  // Thin white dividers between panels.
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 4;
  for (let i = 1; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * pw, 60);
    ctx.lineTo(i * pw, H - 60);
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
