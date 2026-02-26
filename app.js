// ── Canvas setup ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d', { alpha: true });
canvas.style.background = 'transparent';

const SIZE    = Math.min(window.innerWidth * 0.95, 560);
canvas.width  = SIZE;

// PAD_TOP gives room for the tip hover label drawn inside canvas below the tip
const PAD_TOP  = 48;
const PAD_BOT  = 60;
const PAD_SIDE = 44;
canvas.height = Math.round(SIZE * 0.866) + PAD_TOP + PAD_BOT;

const W = canvas.width;
const H = canvas.height;

// Vertices — NB = top-center | "male" key = bottom-LEFT | "fem" key = bottom-RIGHT
const V = {
  nb:   { x: W / 2,        y: PAD_TOP + 4      },
  male: { x: PAD_SIDE,     y: H - PAD_BOT - 4  },  // LEFT corner
  fem:  { x: W - PAD_SIDE, y: H - PAD_BOT - 4  },  // RIGHT corner
};

// ── IMPORTANT color mapping ──────────────────────────────────────────────────
// The barycentric formula below gives:  wFem = 1  at V.male (left corner)
//                                       wMale = 1  at V.fem  (right corner)  — yes, swapped!
// (wNb=0, wMale=0 at the male vertex because both numerator terms are 0;
//  therefore wFem = 1-0-0 = 1 there.)
// So to get BLUE on the LEFT we assign COL_FEM = blue, COL_MALE = pink.
const COL_NB   = [155, 111, 212];  // purple
const COL_FEM  = [ 74, 144, 217];  // blue  → applied at LEFT (male) corner
const COL_MALE = [232, 126, 161];  // pink  → applied at RIGHT (fem) corner

// ── Maths helpers ─────────────────────────────────────────────────────────────

function bary(px, py) {
  const { nb, male, fem } = V;
  const d     = (fem.y - male.y) * (nb.x - male.x) + (male.x - fem.x) * (nb.y - male.y);
  const wNb   = ((fem.y - male.y) * (px - male.x) + (male.x - fem.x) * (py - male.y)) / d;
  const wMale = ((male.y - nb.y)  * (px - male.x) + (nb.x - male.x)  * (py - male.y)) / d;
  const wFem  = 1 - wNb - wMale;
  return { nb: wNb, male: wMale, fem: wFem };
}

function insideTri(px, py) {
  const b = bary(px, py);
  return b.nb >= -0.001 && b.male >= -0.001 && b.fem >= -0.001;
}

function blendRGB(b) {
  return [
    Math.round(COL_NB[0]*b.nb + COL_MALE[0]*b.male + COL_FEM[0]*b.fem),
    Math.round(COL_NB[1]*b.nb + COL_MALE[1]*b.male + COL_FEM[1]*b.fem),
    Math.round(COL_NB[2]*b.nb + COL_MALE[2]*b.male + COL_FEM[2]*b.fem),
  ];
}

// For the bottom bar shortcut we need correct left=blue, right=pink gradient
// The bar goes left→right so x=V.male.x is blue side, x=V.fem.x is pink side
const BAR_COLOR_LEFT  = [74,  144, 217];  // blue
const BAR_COLOR_RIGHT = [232, 126, 161];  // pink

// Ray-casting point-in-polygon
function insidePoly(pts, px, py) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// ── Pre-render gradient (cached) ─────────────────────────────────────────────
const baseImg = ctx.createImageData(W, H);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!insideTri(x, y)) { baseImg.data[(y*W+x)*4+3] = 0; continue; }
    const b          = bary(x, y);
    const [r, g, bl] = blendRGB(b);
    const i          = (y * W + x) * 4;
    baseImg.data[i]     = r;
    baseImg.data[i + 1] = g;
    baseImg.data[i + 2] = bl;
    baseImg.data[i + 3] = 215;
  }
}

// ── Shortcut zone constants ───────────────────────────────────────────────────
const BAR_H        = 18;
const BAR_THICK    = 10;
const TIP_RADIUS   = 20;
const TIP_SIZE_DEF = 13;
const TIP_SIZE_HOV = 18;

function insideBottomBar(px, py) {
  if (Math.abs(py - V.male.y) > BAR_H) return false;
  return px >= V.male.x && px <= V.fem.x;
}

function insideTopTip(px, py) {
  const dx = px - V.nb.x, dy = py - V.nb.y;
  return Math.sqrt(dx*dx + dy*dy) <= TIP_RADIUS;
}

function insideMaleTip(px, py) {
  const dx = px - V.male.x, dy = py - V.male.y;
  return Math.sqrt(dx*dx + dy*dy) <= TIP_RADIUS;
}

function insideFemTip(px, py) {
  const dx = px - V.fem.x, dy = py - V.fem.y;
  return Math.sqrt(dx*dx + dy*dy) <= TIP_RADIUS;
}

function bottomBarWeights(px) {
  // t=0 at left (blue/male), t=1 at right (pink/female)
  const t = Math.max(0, Math.min(1, (px - V.male.x) / (V.fem.x - V.male.x)));
  return { nb: 0, male: t, fem: 1 - t };
  // male=t, fem=1-t maps: left → female=1 (but we want left=blue=male visually)
  // Actually for showBottomBar we just use t directly for display:
}

// ── App state ─────────────────────────────────────────────────────────────────
let mode     = 'point';
let selected = null;
let lasso    = null;
let drawing  = false;
let stroke   = [];
let hovering = null;   // 'tip'|'male-tip'|'fem-tip'|'bar'|'left-edge'|'right-edge'|null
let selectedTip = null; // 'nb'|'male'|'fem'|null — which vertex tip is currently selected

// ── Mode toggle ───────────────────────────────────────────────────────────────
function setMode(m) {
  mode = m;
  document.getElementById('btn-point').classList.toggle('active', m === 'point');
  document.getElementById('btn-zone' ).classList.toggle('active', m === 'zone');
  if (m === 'point') { lasso = null; stroke = []; if (!selected) resetCard(); }
  else               { selected = null; if (!lasso) resetCard(); }
  draw();
}

// ── Curve helpers ─────────────────────────────────────────────────────────────

function smoothPts(pts, segments = 8) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[Math.min(i + 1, pts.length - 1)];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    for (let t = 0; t < segments; t++) {
      const s = t/segments, s2 = s*s, s3 = s2*s;
      out.push({
        x: 0.5*((2*p1.x)+(-p0.x+p2.x)*s+(2*p0.x-5*p1.x+4*p2.x-p3.x)*s2+(-p0.x+3*p1.x-3*p2.x+p3.x)*s3),
        y: 0.5*((2*p1.y)+(-p0.y+p2.y)*s+(2*p0.y-5*p1.y+4*p2.y-p3.y)*s2+(-p0.y+3*p1.y-3*p2.y+p3.y)*s3),
      });
    }
  }
  return out;
}

function subsample(pts, minDist = 4) {
  if (!pts.length) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const last = out[out.length - 1];
    const dx = pts[i].x - last.x, dy = pts[i].y - last.y;
    if (Math.sqrt(dx*dx + dy*dy) >= minDist) out.push(pts[i]);
  }
  return out;
}

// ── Canvas drawing ────────────────────────────────────────────────────────────

function triPath() {
  ctx.beginPath();
  ctx.moveTo(V.nb.x,   V.nb.y);
  ctx.lineTo(V.male.x, V.male.y);
  ctx.lineTo(V.fem.x,  V.fem.y);
  ctx.closePath();
}

function polyPath(pts) {
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function drawBottomBar() {
  const y       = V.male.y;
  const x0      = V.male.x;
  const x1      = V.fem.x;
  const hovered = hovering === 'bar';

  // ── Outer white line — always visible, thick and clear ──
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${hovered ? 0.95 : 0.75})`;
  ctx.lineWidth   = hovered ? 4 : 3;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();

  // ── Inner thin colored line (blue → pink) centered inside the white line ──
  ctx.save();
  const innerGrad = ctx.createLinearGradient(x0, 0, x1, 0);
  innerGrad.addColorStop(0, 'rgba(74,144,217,0.9)');
  innerGrad.addColorStop(1, 'rgba(232,126,161,0.9)');
  ctx.strokeStyle = innerGrad;
  ctx.lineWidth   = 1;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

// ── Edge lines: left = 0% Female (NB→Male), right = 0% Male (NB→Female) ──────

const EDGE_HIT = 12;  // px either side of the edge line counts as a hit

function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.sqrt((px-ax)**2 + (py-ay)**2);
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / lenSq));
  return Math.sqrt((px - (ax + t*dx))**2 + (py - (ay + t*dy))**2);
}

function insideLeftEdge(px, py) {
  return pointToSegmentDist(px, py, V.nb.x, V.nb.y, V.male.x, V.male.y) <= EDGE_HIT;
}

function insideRightEdge(px, py) {
  return pointToSegmentDist(px, py, V.nb.x, V.nb.y, V.fem.x, V.fem.y) <= EDGE_HIT;
}

function drawEdgeLine(ax, ay, bx, by, colorStart, colorEnd, hoverKey) {
  const hovered = hovering === hoverKey;

  // White outer line
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${hovered ? 0.95 : 0.75})`;
  ctx.lineWidth   = hovered ? 4 : 3;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();

  // Thin inner colored line
  ctx.save();
  const g = ctx.createLinearGradient(ax, ay, bx, by);
  g.addColorStop(0, colorStart);
  g.addColorStop(1, colorEnd);
  ctx.strokeStyle = g;
  ctx.lineWidth   = 1;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

// Corner tip: same diamond shape as drawTopTip, rotated to point outward
function drawCornerTip(corner, colorRGB, hoverKey, label) {
  const hovered = hovering === hoverKey;
  const sz      = hovered ? TIP_SIZE_HOV : TIP_SIZE_DEF;
  const cx      = corner.x;
  const cy      = corner.y;
  const alpha   = hovered ? 1.0 : 0.65;

  // Outward direction = away from centroid
  const centX = (V.nb.x + V.male.x + V.fem.x) / 3;
  const centY = (V.nb.y + V.male.y + V.fem.y) / 3;
  const ddx   = cx - centX, ddy = cy - centY;
  const len   = Math.sqrt(ddx*ddx + ddy*ddy);
  const nx    = ddx / len,  ny = ddy / len;  // outward unit vector
  const px    = -ny,        py = nx;         // perpendicular

  // Same proportions as drawTopTip diamond:
  // tip=+1.5, sides at -0.4 outward ±1.0 perp, notch=+0.15 outward
  const tipX   = cx + nx * sz * 1.5;
  const tipY   = cy + ny * sz * 1.5;
  const leftX  = cx - px * sz - nx * sz * 0.4;
  const leftY  = cy - py * sz - ny * sz * 0.4;
  const notchX = cx + nx * sz * 0.15;
  const notchY = cy + ny * sz * 0.15;
  const rightX = cx + px * sz - nx * sz * 0.4;
  const rightY = cy + py * sz - ny * sz * 0.4;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tipX,   tipY);
  ctx.lineTo(leftX,  leftY);
  ctx.lineTo(notchX, notchY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();

  const [r, g, b] = colorRGB.split(',').map(Number);
  const grad = ctx.createRadialGradient(cx + nx * sz * 0.5, cy + ny * sz * 0.5, 0, cx, cy, sz * 2);
  grad.addColorStop(0, `rgba(${Math.min(r+80,255)},${Math.min(g+80,255)},${Math.min(b+80,255)},${alpha})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},${alpha})`);
  ctx.fillStyle   = grad;
  ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.45})`;
  ctx.lineWidth   = 1.5;
  ctx.stroke();
  ctx.restore();

}

function drawTopTip() {
  const hovered = hovering === 'tip';
  const sz      = hovered ? TIP_SIZE_HOV : TIP_SIZE_DEF;
  const cx      = V.nb.x;
  const cy      = V.nb.y;
  const alpha   = hovered ? 1.0 : 0.65;

  // ── Glow clipped to triangle ──
  ctx.save();
  triPath();
  ctx.clip();
  try { ctx.filter = 'blur(12px)'; } catch(e) { /* unsupported */ }
  ctx.fillStyle = `rgba(155,111,212,${hovered ? 0.7 : 0.35})`;
  ctx.beginPath();
  ctx.arc(cx, cy, sz + 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = 'none';  // explicitly reset before restore — ctx.restore() does NOT reset filter in all browsers
  ctx.restore();

  // ── Arrow/diamond shape ──
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx,        cy - sz * 1.5);
  ctx.lineTo(cx - sz,   cy + sz * 0.4);
  ctx.lineTo(cx,        cy - sz * 0.15);
  ctx.lineTo(cx + sz,   cy + sz * 0.4);
  ctx.closePath();
  const tipGrad = ctx.createRadialGradient(cx, cy - sz * 0.5, 0, cx, cy, sz * 2);
  tipGrad.addColorStop(0, `rgba(215,190,255,${alpha})`);
  tipGrad.addColorStop(1, `rgba(105,50,195,${alpha})`);
  ctx.fillStyle   = tipGrad;
  ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.45})`;
  ctx.lineWidth   = 1.5;
  ctx.stroke();
  ctx.restore();

}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.putImageData(baseImg, 0, 0);

  triPath();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  if (lasso && lasso.length > 2) {
    const smooth = smoothPts(lasso);
    ctx.save(); triPath(); ctx.clip();
    polyPath(smooth);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  if (drawing && stroke.length > 1) {
    const sub = subsample(stroke, 1);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sub[0].x, sub[0].y);
    for (let i = 1; i < sub.length; i++) ctx.lineTo(sub[i].x, sub[i].y);
    ctx.lineTo(sub[0].x, sub[0].y);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  drawBottomBar();
  // Left edge: NB → Male = 0% Female line (purple → blue)
  drawEdgeLine(V.nb.x, V.nb.y, V.male.x, V.male.y, 'rgba(155,111,212,0.9)', 'rgba(74,144,217,0.9)', 'left-edge');
  // Right edge: NB → Female = 0% Male line (purple → pink)
  drawEdgeLine(V.nb.x, V.nb.y, V.fem.x, V.fem.y, 'rgba(155,111,212,0.9)', 'rgba(232,126,161,0.9)', 'right-edge');
  drawTopTip();
  drawCornerTip(V.male, '74,144,217',  'male-tip', '100% Male',   'right');
  drawCornerTip(V.fem,  '232,126,161', 'fem-tip',  '100% Female', 'left');

  if (selected) {
    const b          = bary(selected.x, selected.y);
    const [cr, cg, cb] = blendRGB(b);
    // Outer glow
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 30, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.12)`;
    ctx.fill();
    // Mid ring
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 20, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.22)`;
    ctx.fill();
    // Main dot
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    ctx.fill();
    // White ring
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 13, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // White centre dot
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
}

// ── Result card ───────────────────────────────────────────────────────────────

function resetCard() {
  document.getElementById('blend').innerHTML     = '<div class="hint">Click or draw inside the triangle</div>';
  document.getElementById('card').classList.remove('active');
  document.getElementById('zone-info').textContent  = '';
  document.getElementById('card-label').textContent = 'Your position';
  document.getElementById('export-row').style.display = 'none';
}

function styleExportButtons(dominantColor) {
  const expBtn  = document.getElementById('export-btn');
  const copyBtn = document.getElementById('copy-btn');
  [expBtn, copyBtn].forEach(btn => {
    btn.style.background  = dominantColor;
    btn.style.borderColor = dominantColor;
    btn.style.color       = '#fff';
    btn.style.boxShadow   = `0 0 18px 4px ${dominantColor}88, 0 0 6px 1px ${dominantColor}`;
    btn.style.fontWeight  = '600';
  });
}

function renderBlend(b, label, info) {
  // Remap for display: bary wFem=1 at left (male visual), wMale=1 at right (female visual)
  // So for display purposes: displayMale = b.fem, displayFemale = b.male
  const total = (b.nb + b.male + b.fem) || 1;
  const items = [
    { name: 'Non-Binary', val: b.nb   / total, color: '#9b6fd4' },
    { name: 'Male',       val: b.fem  / total, color: '#4a90d9' },  // wFem → male display
    { name: 'Female',     val: b.male / total, color: '#e87ea1' },  // wMale → female display
  ].sort((a, z) => z.val - a.val);

  document.getElementById('card-label').textContent = label;
  document.getElementById('blend').innerHTML = items.map(item => {
    const pct = Math.round(item.val * 100);
    return `<div class="blend-item">
      <div class="blend-name" style="color:${item.color}">${item.name}</div>
      <div class="blend-pct"  style="color:${item.color}">${pct}%</div>
      <div class="blend-bar-wrap">
        <div class="blend-bar-fill" style="width:${pct}%;background:${item.color}"></div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('zone-info').textContent = info || '';
  document.getElementById('card').classList.add('active');
  document.getElementById('export-row').style.display = 'flex';
  styleExportButtons(items[0].color);
}

function showPoint(x, y) {
  renderBlend(bary(x, y), 'Your point', '');
}

function showBottomBar(px) {
  // t = 0 at left (blue = male), t = 1 at right (pink = female)
  const t       = Math.max(0, Math.min(1, (px - V.male.x) / (V.fem.x - V.male.x)));
  const malePct = Math.round((1 - t) * 100);
  const femPct  = 100 - malePct;
  const items   = [
    { name: 'Male',   pct: malePct, color: '#4a90d9' },
    { name: 'Female', pct: femPct,  color: '#e87ea1' },
  ].sort((a, z) => z.pct - a.pct);

  document.getElementById('card-label').textContent = '0% Non-Binary';
  document.getElementById('blend').innerHTML = items.map(item => `
    <div class="blend-item">
      <div class="blend-name" style="color:${item.color}">${item.name}</div>
      <div class="blend-pct"  style="color:${item.color}">${item.pct}%</div>
      <div class="blend-bar-wrap">
        <div class="blend-bar-fill" style="width:${item.pct}%;background:${item.color}"></div>
      </div>
    </div>`).join('');
  document.getElementById('card').classList.add('active');
  document.getElementById('export-row').style.display = 'flex';
  styleExportButtons(items[0].color);
}

function showTopTip() {
  document.getElementById('card-label').textContent = '0% Male · 0% Female';
  document.getElementById('blend').innerHTML = `
    <div class="blend-item">
      <div class="blend-name" style="color:#9b6fd4">Non-Binary</div>
      <div class="blend-pct"  style="color:#9b6fd4">100%</div>
      <div class="blend-bar-wrap">
        <div class="blend-bar-fill" style="width:100%;background:#9b6fd4"></div>
      </div>
    </div>`;
  document.getElementById('card').classList.add('active');
  document.getElementById('export-row').style.display = 'flex';
  styleExportButtons('#9b6fd4');
}

function showCornerTip(corner) {
  const isMale  = corner === 'male';
  const name    = isMale ? 'Male'    : 'Female';
  const color   = isMale ? '#4a90d9' : '#e87ea1';
  const other   = isMale ? 'Female'  : 'Male';
  document.getElementById('card-label').textContent = `0% Non-Binary · 0% ${other}`;
  document.getElementById('blend').innerHTML = `
    <div class="blend-item">
      <div class="blend-name" style="color:${color}">${name}</div>
      <div class="blend-pct"  style="color:${color}">100%</div>
      <div class="blend-bar-wrap">
        <div class="blend-bar-fill" style="width:100%;background:${color}"></div>
      </div>
    </div>`;
  document.getElementById('card').classList.add('active');
  document.getElementById('export-row').style.display = 'flex';
  styleExportButtons(color);
}

function showEdge(side, px, py) {
  // Left edge (NB→Male) = 0% Female anywhere on it
  // Right edge (NB→Female) = 0% Male anywhere on it
  const zeroName  = side === 'left' ? 'Female' : 'Male';
  const zeroColor = side === 'left' ? '#e87ea1' : '#4a90d9';
  const varName   = side === 'left' ? 'Male'    : 'Female';
  const varColor  = side === 'left' ? '#4a90d9' : '#e87ea1';

  // Project click onto the edge segment to get t (0=NB tip, 1=corner)
  const ax = V.nb.x, ay = V.nb.y;
  const bx = side === 'left' ? V.male.x : V.fem.x;
  const by = side === 'left' ? V.male.y : V.fem.y;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx*dx + dy*dy;
  const t = Math.max(0, Math.min(1, ((px - ax)*dx + (py - ay)*dy) / lenSq));

  // t=0 → 100% NB, t=1 → 100% Male (or Female)
  const nbPct  = Math.round((1 - t) * 100);
  const varPct = 100 - nbPct;

  const items = [
    { name: 'Non-Binary', pct: nbPct,  color: '#9b6fd4' },
    { name: varName,      pct: varPct, color: varColor   },
  ].sort((a, z) => z.pct - a.pct);

  document.getElementById('card-label').textContent = `0% ${zeroName}`;
  document.getElementById('blend').innerHTML = items.map(item => `
    <div class="blend-item">
      <div class="blend-name" style="color:${item.color}">${item.name}</div>
      <div class="blend-pct"  style="color:${item.color}">${item.pct}%</div>
      <div class="blend-bar-wrap"><div class="blend-bar-fill" style="width:${item.pct}%;background:${item.color}"></div></div>
    </div>`).join('');
  document.getElementById('zone-info').textContent = '';
  document.getElementById('card').classList.add('active');
  document.getElementById('export-row').style.display = 'flex';
  styleExportButtons(items[0].color);
}

function showLasso(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(W, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(H, Math.ceil(Math.max(...ys)));

  const step = 3;
  let sNb = 0, sMale = 0, sFem = 0, n = 0;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (!insideTri(x, y) || !insidePoly(pts, x, y)) continue;
      const b = bary(x, y);
      sNb += b.nb; sMale += b.male; sFem += b.fem; n++;
    }
  }
  if (!n) { resetCard(); return; }
  renderBlend(
    { nb: sNb/n, male: sMale/n, fem: sFem/n },
    'Zone average',
    `Sampled ${n} points within your selection`
  );
}

// ── Input events ──────────────────────────────────────────────────────────────

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * (W / rect.width),
    y: (src.clientY - rect.top)  * (H / rect.height),
  };
}

// Project a point onto a segment, returning the clamped point on that segment
function projectOntoSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t  = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy)));
  return { x: ax + t*dx, y: ay + t*dy };
}

canvas.addEventListener('selectstart', e => e.preventDefault());
canvas.addEventListener('dragstart',   e => e.preventDefault());

canvas.addEventListener('mousedown', e => {
  e.preventDefault();
  const p = getPos(e);
  if (insideTopTip(p.x, p.y)) {
    lasso = null; stroke = [];
    selected = { x: V.nb.x, y: V.nb.y }; selectedTip = 'nb';
    showTopTip(); draw(); return;
  }
  if (insideMaleTip(p.x, p.y)) {
    lasso = null; stroke = [];
    selected = { x: V.male.x, y: V.male.y }; selectedTip = 'male';
    showCornerTip('male'); draw(); return;
  }
  if (insideFemTip(p.x, p.y)) {
    lasso = null; stroke = [];
    selected = { x: V.fem.x, y: V.fem.y }; selectedTip = 'fem';
    showCornerTip('fem'); draw(); return;
  }
  if (insideBottomBar(p.x, p.y)) {
    lasso = null; stroke = [];
    selected = projectOntoSegment(p.x, p.y, V.male.x, V.male.y, V.fem.x, V.fem.y); selectedTip = null;
    showBottomBar(p.x); draw(); return;
  }
  if (insideLeftEdge(p.x, p.y)) {
    lasso = null; stroke = [];
    selected = projectOntoSegment(p.x, p.y, V.nb.x, V.nb.y, V.male.x, V.male.y); selectedTip = null;
    showEdge('left', p.x, p.y); draw(); return;
  }
  if (insideRightEdge(p.x, p.y)) {
    lasso = null; stroke = [];
    selected = projectOntoSegment(p.x, p.y, V.nb.x, V.nb.y, V.fem.x, V.fem.y); selectedTip = null;
    showEdge('right', p.x, p.y); draw(); return;
  }
  if (mode === 'zone' && !insideTri(p.x, p.y)) return;
  drawing = true; lasso = null; selected = null; stroke = [{ ...p }];
  draw();
});

canvas.addEventListener('mousemove', e => {
  const p = getPos(e);
  const wasHovering = hovering;

  if (insideTopTip(p.x, p.y))         { hovering = 'tip';        canvas.style.cursor = 'pointer'; }
  else if (insideMaleTip(p.x, p.y))   { hovering = 'male-tip';   canvas.style.cursor = 'pointer'; }
  else if (insideFemTip(p.x, p.y))    { hovering = 'fem-tip';    canvas.style.cursor = 'pointer'; }
  else if (insideBottomBar(p.x, p.y)) { hovering = 'bar';        canvas.style.cursor = 'pointer'; }
  else if (insideLeftEdge(p.x, p.y))  { hovering = 'left-edge';  canvas.style.cursor = 'pointer'; }
  else if (insideRightEdge(p.x, p.y)) { hovering = 'right-edge'; canvas.style.cursor = 'pointer'; }
  else {
    hovering = null;
    canvas.style.cursor = mode === 'zone' ? (drawing ? 'crosshair' : 'cell') : 'crosshair';
  }
  if (hovering !== wasHovering) draw();
  if (!drawing) return;
  if (mode === 'zone') { stroke.push({ ...p }); draw(); }
});

canvas.addEventListener('mouseup', e => {
  if (!drawing) return;
  drawing = false;
  const p = getPos(e);
  if (mode === 'zone') {
    stroke.push({ ...p });
    const sub = subsample(stroke, 3);
    stroke = [];
    if (sub.length < 4) { draw(); return; }
    const clipped = clipPolygonToTriangle(sub);
    if (clipped.length < 3) { draw(); return; }
    lasso = clipped; draw(); showLasso(lasso);
  } else {
    const start = stroke[0]; stroke = [];
    const dx = p.x - start.x, dy = p.y - start.y;
    if (Math.sqrt(dx*dx + dy*dy) < 8 && insideTri(start.x, start.y)) {
      selected = { ...start }; selectedTip = null; lasso = null; draw(); showPoint(selected.x, selected.y);
    } else { draw(); }
  }
});

canvas.addEventListener('mouseleave', () => {
  if (!drawing) return;
  drawing = false;
  if (mode === 'zone' && stroke.length > 4) {
    const sub     = subsample(stroke, 3);
    const clipped = clipPolygonToTriangle(sub);
    stroke = [];
    if (clipped.length >= 3) { lasso = clipped; draw(); showLasso(lasso); return; }
    draw();
  } else { stroke = []; draw(); }
});

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.touches[0];
  canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY }));
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY }));
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: t.clientX, clientY: t.clientY }));
}, { passive: false });


// ── Export ────────────────────────────────────────────────────────────────────

function buildExportCanvas() {
  const EW = 900;
  const scale = EW / W;
  const EH = Math.round(H * scale);

  const ec = document.createElement('canvas');
  ec.width  = EW;
  ec.height = EH;
  const ex = ec.getContext('2d');

  ex.fillStyle = '#0d0d12';
  ex.fillRect(0, 0, EW, EH);

  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  tmp.getContext('2d').putImageData(baseImg, 0, 0);
  ex.drawImage(tmp, 0, 0, EW, EH);

  ex.scale(scale, scale);

  ex.beginPath();
  ex.moveTo(V.nb.x, V.nb.y);
  ex.lineTo(V.male.x, V.male.y);
  ex.lineTo(V.fem.x, V.fem.y);
  ex.closePath();
  ex.strokeStyle = 'rgba(255,255,255,0.18)';
  ex.lineWidth = 1.5;
  ex.stroke();

  if (lasso && lasso.length > 2) {
    const smooth = smoothPts(lasso);
    ex.save();
    ex.beginPath();
    ex.moveTo(V.nb.x, V.nb.y);
    ex.lineTo(V.male.x, V.male.y);
    ex.lineTo(V.fem.x, V.fem.y);
    ex.closePath();
    ex.clip();
    ex.beginPath();
    ex.moveTo(smooth[0].x, smooth[0].y);
    for (let i = 1; i < smooth.length; i++) ex.lineTo(smooth[i].x, smooth[i].y);
    ex.closePath();
    ex.fillStyle = 'rgba(255,255,255,0.15)';
    ex.fill();
    ex.setLineDash([5, 4]);
    ex.strokeStyle = 'rgba(255,255,255,0.7)';
    ex.lineWidth = 1.5;
    ex.stroke();
    ex.restore();
  }

  if (selected) {
    const b = bary(selected.x, selected.y);
    const [cr, cg, cb] = blendRGB(b);
    ex.beginPath();
    ex.arc(selected.x, selected.y, 30, 0, Math.PI * 2);
    ex.fillStyle = `rgba(${cr},${cg},${cb},0.12)`;
    ex.fill();
    ex.beginPath();
    ex.arc(selected.x, selected.y, 20, 0, Math.PI * 2);
    ex.fillStyle = `rgba(${cr},${cg},${cb},0.22)`;
    ex.fill();
    ex.beginPath();
    ex.arc(selected.x, selected.y, 13, 0, Math.PI * 2);
    ex.fillStyle = `rgb(${cr},${cg},${cb})`;
    ex.fill();
    ex.beginPath();
    ex.arc(selected.x, selected.y, 13, 0, Math.PI * 2);
    ex.strokeStyle = 'rgba(255,255,255,0.7)';
    ex.lineWidth = 2;
    ex.stroke();
    ex.beginPath();
    ex.arc(selected.x, selected.y, 4, 0, Math.PI * 2);
    ex.fillStyle = '#fff';
    ex.fill();
  }

  ex.save();
  ex.font = '600 18px Cormorant Garamond, serif';
  ex.letterSpacing = '0.14em';

  ex.fillStyle = '#9b6fd4';
  ex.textAlign = 'center';
  ex.textBaseline = 'bottom';
  ex.fillText('NON-BINARY', V.nb.x, V.nb.y - 8 - (selectedTip === 'nb' ? 22 : 0));

  ex.fillStyle = '#4a90d9';
  ex.textAlign = 'left';
  ex.textBaseline = 'top';
  ex.fillText('MALE', V.male.x - (selectedTip === 'male' ? 8 : 0), V.male.y + 8 + (selectedTip === 'male' ? 18 : 0));

  ex.fillStyle = '#e87ea1';
  ex.textAlign = 'right';
  ex.textBaseline = 'top';
  ex.fillText('FEMALE', V.fem.x + (selectedTip === 'fem' ? 8 : 0), V.fem.y + 8 + (selectedTip === 'fem' ? 18 : 0));
  ex.restore();

  return ec;
}

function exportImage() {
  const ec = buildExportCanvas();
  const link = document.createElement('a');
  link.download = 'gender-triangle.png';
  link.href = ec.toDataURL('image/png');
  link.click();
}

async function copyImage() {
  const ec = buildExportCanvas();
  ec.toBlob(async blob => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      const btn = document.getElementById('copy-btn');
      btn.style.color = '#9b6fd4';
      btn.title = 'Copied!';
      setTimeout(() => { btn.style.color = ''; btn.title = 'Copy to clipboard'; }, 1500);
    } catch (e) {
      console.error('Copy failed', e);
    }
  }, 'image/png');
}

// ── Init ──────────────────────────────────────────────────────────────────────
draw();

// ── Label positioning: pin labels right beside the triangle vertices ──────────
(function positionLabels() {
  const nbEl   = document.querySelector('.label.nb');
  const maleEl = document.querySelector('.label.male');
  const femEl  = document.querySelector('.label.fem');

  nbEl.style.left      = '50%';
  nbEl.style.transform = 'translateX(-50%)';
  nbEl.style.top       = (V.nb.y - 36) + 'px';
  nbEl.style.bottom    = '';

  maleEl.style.left   = '0';
  maleEl.style.bottom = (H - V.male.y - 30) + 'px';
  maleEl.style.top    = '';

  femEl.style.right  = '0';
  femEl.style.bottom = (H - V.fem.y - 30) + 'px';
  femEl.style.top    = '';
})();

// ── Sutherland-Hodgman polygon clip to triangle ───────────────────────────────
function clipPolygonToTriangle(poly) {
  const edges = [
    [V.nb,   V.male],
    [V.male, V.fem ],
    [V.fem,  V.nb  ],
  ];

  // In canvas coords (y-down), centroid gives negative cross for these edges
  function inside(p, a, b) {
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0;
  }

  function intersect(s, e, a, b) {
    const dx1 = e.x - s.x, dy1 = e.y - s.y;
    const dx2 = b.x - a.x, dy2 = b.y - a.y;
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-10) return s;
    const t = ((a.x - s.x) * dy2 - (a.y - s.y) * dx2) / denom;
    return { x: s.x + t * dx1, y: s.y + t * dy1 };
  }

  let output = poly;
  for (const [a, b] of edges) {
    if (!output.length) return [];
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const cur  = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn  = inside(cur,  a, b);
      const prevIn = inside(prev, a, b);
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur, a, b));
      }
    }
  }
  return output;
}
