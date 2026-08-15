// Generates the LINE rich-menu image (2500x843, N tappable panels) as a PNG
// buffer. Uses @napi-rs/canvas with a registered Thai font so labels render.
//
// Design: a single unified dark surface (not four clashing solid-color
// blocks) with each panel differentiated by a floating gradient "icon chip"
// — the same visual language as a modern app's bottom nav / home screen
// rather than 2015-era flat-color rectangles.

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

// Register Thai-capable fonts under explicit family names. Leelawadee UI
// reads as noticeably more modern than Tahoma for Thai text (it's what
// public/dashboard.html and public/teacher.html already use), so the rich
// menu now matches the rest of the app's typography.
GlobalFonts.registerFromPath('C:/Windows/Fonts/LeelawUI.ttf', 'LeelawR');
GlobalFonts.registerFromPath('C:/Windows/Fonts/LeelaUIb.ttf', 'LeelawB');

const W = 2500;
const H = 843;

// Each panel's chip is a two-stop gradient (not a flat fill) — brighter,
// more contemporary than a single flat hue per panel.
const PANELS = [
  { title: 'ค้นหาโรงเรียน', sub: 'เปรียบเทียบสายการเรียน', icon: 'search', from: '#6d8bff', to: '#3d5af1' },
  { title: 'แนะแนว', sub: 'ด้วย AI (Gemini)', icon: 'cap', from: '#ffb454', to: '#f2861f' },
  { title: 'แดชบอร์ด', sub: 'ครู/นักเรียน', icon: 'grid', from: '#c68bff', to: '#9c4dff' },
];

// Filled (not stroked) icons read cleaner at small size and match a modern
// icon-chip aesthetic better than outline icons.
function drawIcon(ctx, kind, cx, cy, r) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = r * 0.16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'search') {
    ctx.beginPath();
    ctx.arc(cx - r * 0.12, cy - r * 0.12, r * 0.62, 0, Math.PI * 2);
    ctx.lineWidth = r * 0.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.32, cy + r * 0.32);
    ctx.lineTo(cx + r * 0.78, cy + r * 0.78);
    ctx.lineWidth = r * 0.24;
    ctx.stroke();
  } else if (kind === 'cap') {
    // Mortarboard: filled diamond top + a hanging tassel.
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.62);
    ctx.lineTo(cx + r * 0.95, cy - r * 0.05);
    ctx.lineTo(cx, cy + r * 0.52);
    ctx.lineTo(cx - r * 0.95, cy - r * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.5, cy + r * 0.12);
    ctx.lineTo(cx + r * 0.5, cy + r * 0.72);
    ctx.lineWidth = r * 0.12;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + r * 0.5, cy + r * 0.78, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'grid') {
    // 2x2 rounded dashboard tiles.
    const s = r * 0.68;
    const gap = r * 0.24;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dy]) => {
      const tx = cx + dx * (s / 2 + gap / 2) - s / 2;
      const ty = cy + dy * (s / 2 + gap / 2) - s / 2;
      ctx.beginPath();
      ctx.roundRect(tx, ty, s, s, s * 0.28);
      ctx.fill();
    });
  }
}

export function buildRichMenuPng() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const n = PANELS.length;
  const pw = W / n;

  // Unified dark surface with a very subtle diagonal gradient for depth,
  // instead of four unrelated solid colors — this is what makes it read as
  // one cohesive product rather than a row of clashing buttons.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#12162c');
  bg.addColorStop(1, '#1a2040');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const chipR = n > 3 ? 130 : 150; // chip radius (rounded-square half-size)
  const titleSize = n > 3 ? 72 : 96;
  const subSize = n > 3 ? 38 : 48;

  PANELS.forEach((p, i) => {
    const cx = i * pw + pw / 2;
    const chipCy = H * 0.36;

    // Soft drop shadow under the chip.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 18;
    const grad = ctx.createLinearGradient(cx, chipCy - chipR, cx, chipCy + chipR);
    grad.addColorStop(0, p.from);
    grad.addColorStop(1, p.to);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(cx - chipR, chipCy - chipR, chipR * 2, chipR * 2, chipR * 0.42);
    ctx.fill();
    ctx.restore();

    // Icon inside the chip.
    drawIcon(ctx, p.icon, cx, chipCy, chipR * 0.52);

    // Title.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4f6ff';
    ctx.font = `${titleSize}px LeelawB`;
    ctx.fillText(p.title, cx, H * 0.72);

    // Subtitle, muted.
    ctx.fillStyle = 'rgba(226,230,255,0.62)';
    ctx.font = `${subSize}px LeelawR`;
    ctx.fillText(p.sub, cx, H * 0.83);

    // Small accent pill under the subtitle, tying the label back to the chip color.
    const pillW = chipR * 0.9;
    const pillY = H * 0.9;
    const pillGrad = ctx.createLinearGradient(cx - pillW / 2, 0, cx + pillW / 2, 0);
    pillGrad.addColorStop(0, p.from);
    pillGrad.addColorStop(1, p.to);
    ctx.fillStyle = pillGrad;
    ctx.beginPath();
    ctx.roundRect(cx - pillW / 2, pillY - 6, pillW, 12, 6);
    ctx.fill();
  });

  // Thin inset dividers between panels — subtler than a full-height hard line.
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 3;
  for (let i = 1; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * pw, 70);
    ctx.lineTo(i * pw, H - 70);
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
