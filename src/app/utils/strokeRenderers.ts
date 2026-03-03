// FORMLESS — Stroke Renderers
// 8 distinct visual flavors with unique textures, shapes, and thicknesses
// Categories: GLOW (sine/sub), GEOMETRIC (saw/crystal), DITHER (grain/noise), GLITCH (metal/flutter)

import { Point } from './strokeAnalyzer';
import { SoundFlavor } from './audioEngine';

// Catmull-Rom spline
const smoothCurvePath = (ctx: CanvasRenderingContext2D, points: Point[], tension: number = 0.3) => {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 2) { ctx.lineTo(points[1].x, points[1].y); return; }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) * tension, p1.y + (p2.y - p0.y) * tension,
      p2.x - (p3.x - p1.x) * tension, p2.y - (p3.y - p1.y) * tension,
      p2.x, p2.y
    );
  }
};

// Build normal vectors along path
const buildNormals = (points: Point[]) => {
  const normals: { nx: number; ny: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(points.length - 1, i + 1);
    const dx = points[i1].x - points[i0].x, dy = points[i1].y - points[i0].y;
    const dl = Math.sqrt(dx * dx + dy * dy) || 1;
    normals.push({ nx: -dy / dl, ny: dx / dl });
  }
  return normals;
};

// ASCII dither field helper
const DITHER_CHARS = '.:-=+*#%@';
const DITHER_CELL = 12;

const drawAsciiDither = (
  ctx: CanvasRenderingContext2D, points: Point[], color: string,
  alpha: number, radius: number, animated: boolean, t: number
) => {
  if (points.length < 2) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  minX -= radius; minY -= radius; maxX += radius; maxY += radius;
  const gx0 = Math.floor(minX / DITHER_CELL) * DITHER_CELL;
  const gy0 = Math.floor(minY / DITHER_CELL) * DITHER_CELL;
  const gx1 = Math.ceil(maxX / DITHER_CELL) * DITHER_CELL;
  const gy1 = Math.ceil(maxY / DITHER_CELL) * DITHER_CELL;
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = color;
  const step = Math.max(1, Math.floor(points.length / 60));
  const sub: Point[] = [];
  for (let i = 0; i < points.length; i += step) sub.push(points[i]);
  sub.push(points[points.length - 1]);
  for (let gy = gy0; gy <= gy1; gy += DITHER_CELL) {
    for (let gx = gx0; gx <= gx1; gx += DITHER_CELL) {
      const cx = gx + DITHER_CELL / 2, cy = gy + DITHER_CELL / 2;
      let minDist = Infinity;
      for (const p of sub) { const dx = cx - p.x, dy = cy - p.y; const d = Math.sqrt(dx * dx + dy * dy); if (d < minDist) minDist = d; }
      if (minDist > radius) continue;
      let intensity = 1.0 - (minDist / radius);
      intensity = intensity * intensity;
      if (animated) {
        const wave = Math.sin(gx * 0.05 + gy * 0.03 + t * 1.2) * 0.3;
        intensity = Math.max(0, Math.min(1, intensity + wave * intensity));
      }
      const ci = Math.floor(intensity * (DITHER_CHARS.length - 1));
      const ch = DITHER_CHARS[Math.max(0, Math.min(ci, DITHER_CHARS.length - 1))];
      if (ch === '.' && intensity < 0.08) continue;
      ctx.globalAlpha = alpha * (0.15 + intensity * 0.65);
      ctx.fillText(ch, cx, cy);
    }
  }
};

export function drawStroke(
  ctx: CanvasRenderingContext2D, points: Point[], color: string,
  opacity: number, flavor: SoundFlavor, locked: boolean, muted: boolean,
  isDark: boolean
) {
  if (points.length < 2) return;
  const a = muted ? opacity * 0.2 : opacity;
  const now = Date.now();
  const poly = () => { smoothCurvePath(ctx, points); };

  switch (flavor) {

    // ═══ GLOW: SINE — flowing undulating ribbon with breathing width ═══
    case 'sine': {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const sineN = buildNormals(points);
      const sineWidth = (i: number) => {
        const t = i / (points.length - 1);
        const breath = 0.7 + 0.3 * Math.sin(now * 0.002);
        const wave = Math.sin(t * Math.PI * 4 + now * 0.0018) * 0.4 + 0.6;
        return (5 + wave * 7) * breath;
      };
      // Outer glow aura
      ctx.save();
      if (isDark) { ctx.shadowBlur = 28; ctx.shadowColor = color; }
      ctx.globalAlpha = a * 0.06;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const w = sineWidth(i) + 8;
        i === 0 ? ctx.moveTo(points[i].x + sineN[i].nx * w, points[i].y + sineN[i].ny * w) : ctx.lineTo(points[i].x + sineN[i].nx * w, points[i].y + sineN[i].ny * w);
      }
      for (let i = points.length - 1; i >= 0; i--) {
        const w = sineWidth(i) + 8;
        ctx.lineTo(points[i].x - sineN[i].nx * w, points[i].y - sineN[i].ny * w);
      }
      ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore();
      // Main filled ribbon body
      ctx.save(); ctx.globalAlpha = a * 0.25;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const w = sineWidth(i);
        i === 0 ? ctx.moveTo(points[i].x + sineN[i].nx * w, points[i].y + sineN[i].ny * w) : ctx.lineTo(points[i].x + sineN[i].nx * w, points[i].y + sineN[i].ny * w);
      }
      for (let i = points.length - 1; i >= 0; i--) {
        const w = sineWidth(i);
        ctx.lineTo(points[i].x - sineN[i].nx * w, points[i].y - sineN[i].ny * w);
      }
      ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore();
      // Inner bright core
      ctx.save();
      if (isDark) { ctx.shadowBlur = 8; ctx.shadowColor = color; }
      ctx.globalAlpha = a * 0.9; ctx.lineWidth = 3;
      const sineLast = points[points.length - 1];
      const sineGrad = ctx.createLinearGradient(points[0].x, points[0].y, sineLast.x, sineLast.y);
      if (isDark) { sineGrad.addColorStop(0, color); sineGrad.addColorStop(0.3, '#FFFFFFCC'); sineGrad.addColorStop(0.7, '#FFFFFFCC'); sineGrad.addColorStop(1, color); }
      else { sineGrad.addColorStop(0, color); sineGrad.addColorStop(1, color); }
      ctx.strokeStyle = sineGrad; poly(); ctx.stroke(); ctx.restore();
      // Parallel breathing waves
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const d of [8, -8, 15, -15]) {
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.globalAlpha = a * Math.max(0.03, 0.12 - Math.abs(d) * 0.005);
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const t = i / (points.length - 1);
          const w = Math.sin(t * Math.PI * 3 + now * 0.0015) * d;
          i === 0 ? ctx.moveTo(points[i].x + sineN[i].nx * w, points[i].y + sineN[i].ny * w) : ctx.lineTo(points[i].x + sineN[i].nx * w, points[i].y + sineN[i].ny * w);
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
      break;
    }

    // ═══ GLOW: SUB — deep pulsing bass worm with thick filled body ═══
    case 'sub': {
      ctx.save();
      const subPulse = 0.7 + 0.3 * Math.sin(now * 0.002);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const subN = buildNormals(points);
      const subWidth = (i: number) => {
        const t = i / (points.length - 1);
        const pulse = 0.8 + 0.2 * Math.sin(now * 0.003 + t * 6);
        const taper = Math.sin(t * Math.PI);
        return (7 + 5 * taper) * pulse * subPulse;
      };
      // 3D depth shadow
      const subDepth = 7;
      ctx.save();
      if (isDark) { ctx.shadowBlur = 16; ctx.shadowColor = 'rgba(0,0,0,0.4)'; }
      ctx.globalAlpha = a * 0.15 * subPulse;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const w = subWidth(i);
        i === 0 ? ctx.moveTo(points[i].x + subN[i].nx * w + subDepth, points[i].y + subN[i].ny * w + subDepth) : ctx.lineTo(points[i].x + subN[i].nx * w + subDepth, points[i].y + subN[i].ny * w + subDepth);
      }
      for (let i = points.length - 1; i >= 0; i--) {
        const w = subWidth(i);
        ctx.lineTo(points[i].x - subN[i].nx * w + subDepth, points[i].y - subN[i].ny * w + subDepth);
      }
      ctx.closePath();
      ctx.fillStyle = isDark ? 'rgba(60,15,100,0.5)' : 'rgba(100,30,160,0.25)';
      ctx.fill(); ctx.restore();
      // Wide aura (dark only)
      if (isDark) {
        ctx.save(); ctx.shadowBlur = 50; ctx.shadowColor = color;
        ctx.strokeStyle = color; ctx.lineWidth = 20; ctx.globalAlpha = a * 0.035 * subPulse;
        poly(); ctx.stroke(); ctx.restore();
      }
      // Main filled worm body
      ctx.save(); ctx.globalAlpha = a * 0.35 * subPulse;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const w = subWidth(i);
        i === 0 ? ctx.moveTo(points[i].x + subN[i].nx * w, points[i].y + subN[i].ny * w) : ctx.lineTo(points[i].x + subN[i].nx * w, points[i].y + subN[i].ny * w);
      }
      for (let i = points.length - 1; i >= 0; i--) {
        const w = subWidth(i);
        ctx.lineTo(points[i].x - subN[i].nx * w, points[i].y - subN[i].ny * w);
      }
      ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore();
      // Worm outline edges
      ctx.save(); ctx.globalAlpha = a * 0.5 * subPulse; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) { const w = subWidth(i); i === 0 ? ctx.moveTo(points[i].x + subN[i].nx * w, points[i].y + subN[i].ny * w) : ctx.lineTo(points[i].x + subN[i].nx * w, points[i].y + subN[i].ny * w); }
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) { const w = subWidth(i); i === 0 ? ctx.moveTo(points[i].x - subN[i].nx * w, points[i].y - subN[i].ny * w) : ctx.lineTo(points[i].x - subN[i].nx * w, points[i].y - subN[i].ny * w); }
      ctx.stroke(); ctx.restore();
      // Hot core gradient
      ctx.save();
      if (isDark) { ctx.shadowBlur = 6; ctx.shadowColor = '#FFFFFF'; }
      ctx.lineWidth = 3; ctx.globalAlpha = a * 0.85;
      const subLast = points[points.length - 1];
      const subGrad = ctx.createLinearGradient(points[0].x, points[0].y, subLast.x, subLast.y);
      if (isDark) { subGrad.addColorStop(0, color); subGrad.addColorStop(0.25, '#FFFFFFBB'); subGrad.addColorStop(0.5, color); subGrad.addColorStop(0.75, '#FFFFFFBB'); subGrad.addColorStop(1, color); }
      else { subGrad.addColorStop(0, color); subGrad.addColorStop(0.5, '#44006680'); subGrad.addColorStop(1, color); }
      ctx.strokeStyle = subGrad; poly(); ctx.stroke(); ctx.restore();
      // Pulsing node orbs
      ctx.save();
      let accSub = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y;
        accSub += Math.sqrt(dx * dx + dy * dy);
        if (accSub >= 35) {
          accSub -= 35;
          const br = 0.4 + 0.6 * Math.abs(Math.sin(now * 0.003 + i * 1.1));
          const nodeR = 3 + br * 3 * subPulse;
          if (isDark) {
            const rg = ctx.createRadialGradient(points[i].x, points[i].y, 0, points[i].x, points[i].y, nodeR + 4);
            rg.addColorStop(0, `rgba(255,255,255,${0.5 * br * subPulse})`); rg.addColorStop(0.5, color + '60'); rg.addColorStop(1, 'transparent');
            ctx.globalAlpha = a * 0.6; ctx.fillStyle = rg;
            ctx.fillRect(points[i].x - nodeR - 4, points[i].y - nodeR - 4, (nodeR + 4) * 2, (nodeR + 4) * 2);
          } else {
            ctx.globalAlpha = a * 0.5 * br * subPulse; ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(points[i].x, points[i].y, nodeR, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.restore();
      ctx.restore();
      break;
    }

    // ═══ GEOMETRIC: SAW — bold zigzag with filled teeth ═══
    case 'saw': {
      ctx.save();
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      const sawN = buildNormals(points);
      const toothSpacing = 14, toothHeight = 16;
      let sawAcc = 0;
      const sawTeeth: number[] = [0];
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y;
        sawAcc += Math.sqrt(dx * dx + dy * dy);
        if (sawAcc >= toothSpacing) { sawAcc -= toothSpacing; sawTeeth.push(i); }
      }
      if (sawTeeth[sawTeeth.length - 1] !== points.length - 1) sawTeeth.push(points.length - 1);
      // Shadow zigzag
      const sawD = 4;
      ctx.save(); ctx.globalAlpha = a * 0.15;
      ctx.strokeStyle = isDark ? 'rgba(200,100,20,0.2)' : 'rgba(200,100,20,0.08)'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let t = 0; t < sawTeeth.length; t++) {
        const si = sawTeeth[t]; const th = (t % 2 === 0 ? 1 : -1) * toothHeight;
        if (t === 0) { ctx.moveTo(points[si].x + sawD, points[si].y + sawD); continue; }
        const midI = Math.min(Math.floor((sawTeeth[t - 1] + si) / 2), points.length - 1);
        ctx.lineTo(points[midI].x + sawD + sawN[midI].nx * th, points[midI].y + sawD + sawN[midI].ny * th);
        ctx.lineTo(points[si].x + sawD, points[si].y + sawD);
      }
      ctx.stroke(); ctx.restore();
      // Filled sawtooth triangles
      ctx.save(); ctx.globalAlpha = a * 0.12; ctx.fillStyle = color;
      for (let t = 1; t < sawTeeth.length; t++) {
        const i0s = sawTeeth[t - 1], i1s = sawTeeth[t];
        const th = (t % 2 === 0 ? 1 : -1) * toothHeight;
        const midI = Math.min(Math.floor((i0s + i1s) / 2), points.length - 1);
        ctx.beginPath();
        ctx.moveTo(points[i0s].x, points[i0s].y);
        ctx.lineTo(points[midI].x + sawN[midI].nx * th, points[midI].y + sawN[midI].ny * th);
        ctx.lineTo(points[i1s].x, points[i1s].y);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // Main thick zigzag
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.globalAlpha = a * 0.85;
      ctx.beginPath();
      for (let t = 0; t < sawTeeth.length; t++) {
        const si = sawTeeth[t];
        if (t === 0) { ctx.moveTo(points[si].x, points[si].y); continue; }
        const th = (t % 2 === 0 ? 1 : -1) * toothHeight * 0.5;
        const midI = Math.min(Math.floor((sawTeeth[t - 1] + si) / 2), points.length - 1);
        ctx.lineTo(points[midI].x + sawN[midI].nx * th, points[midI].y + sawN[midI].ny * th);
        ctx.lineTo(points[si].x, points[si].y);
      }
      ctx.stroke(); ctx.restore();
      // Baseline guide
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = a * 0.3;
      poly(); ctx.stroke(); ctx.restore();
      // Nodes
      let sawNodeAcc = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y;
        sawNodeAcc += Math.sqrt(dx * dx + dy * dy);
        if (sawNodeAcc >= 28) {
          sawNodeAcc -= 28;
          const r = 4 + (i % 3) * 1.5;
          ctx.fillStyle = isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)'; ctx.globalAlpha = a * 0.5;
          ctx.beginPath(); ctx.arc(points[i].x + 2, points[i].y + 2, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = color; ctx.globalAlpha = a * 0.85;
          ctx.beginPath(); ctx.arc(points[i].x, points[i].y, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = a * 0.5;
          ctx.beginPath(); ctx.arc(points[i].x - 1.5, points[i].y - 1.5, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      for (const ep of [points[0], points[points.length - 1]]) {
        ctx.fillStyle = isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)'; ctx.globalAlpha = a * 0.5;
        ctx.beginPath(); ctx.arc(ep.x + 2, ep.y + 2, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(ep.x, ep.y, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      break;
    }

    // ═══ GEOMETRIC: CRYSTAL — large prismatic faceted diamonds ═══
    case 'crystal': {
      ctx.save();
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      // Wider ghost line
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = a * 0.15;
      poly(); ctx.stroke(); ctx.restore();
      const czD = 7;
      let cpl = 0, clastD = 0;
      let cprev: { x: number; y: number } | null = null;
      for (let i = 1; i < points.length; i++) {
        cpl += Math.sqrt((points[i].x - points[i - 1].x) ** 2 + (points[i].y - points[i - 1].y) ** 2);
        if (cpl - clastD >= 28) {
          clastD = cpl;
          const cx2 = points[i].x, cy2 = points[i].y;
          const sz = 8 + (i % 3) * 3;
          if (cprev) {
            ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = a * 0.15;
            const mx = (cprev.x + cx2) / 2, my = (cprev.y + cy2) / 2 - 8;
            ctx.beginPath(); ctx.moveTo(cprev.x, cprev.y); ctx.quadraticCurveTo(mx, my, cx2, cy2); ctx.stroke(); ctx.restore();
          }
          // Shadow back face
          ctx.save();
          ctx.strokeStyle = isDark ? 'rgba(100,200,250,0.12)' : 'rgba(50,100,200,0.06)';
          ctx.lineWidth = 1; ctx.globalAlpha = a * 0.12;
          ctx.beginPath();
          ctx.moveTo(cx2 + czD, cy2 - sz + czD); ctx.lineTo(cx2 + sz + czD, cy2 + czD);
          ctx.lineTo(cx2 + czD, cy2 + sz + czD); ctx.lineTo(cx2 - sz + czD, cy2 + czD);
          ctx.closePath(); ctx.stroke();
          ctx.fillStyle = isDark ? 'rgba(100,230,250,0.04)' : 'rgba(50,150,200,0.03)';
          ctx.globalAlpha = a * 0.18; ctx.fill(); ctx.restore();
          // 3D edges
          ctx.save(); ctx.lineWidth = 0.6; ctx.globalAlpha = a * 0.12; ctx.strokeStyle = color;
          for (const [vx, vy] of [[cx2, cy2 - sz], [cx2 + sz, cy2], [cx2, cy2 + sz], [cx2 - sz, cy2]] as [number, number][]) {
            ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(vx + czD, vy + czD); ctx.stroke();
          }
          ctx.restore();
          // Front face — filled
          ctx.save();
          const cfGrad = ctx.createLinearGradient(cx2 - sz, cy2 - sz, cx2 + sz, cy2 + sz);
          cfGrad.addColorStop(0, color + '18'); cfGrad.addColorStop(0.5, color + '08'); cfGrad.addColorStop(1, color + '18');
          ctx.fillStyle = cfGrad; ctx.globalAlpha = a * 0.5;
          ctx.beginPath();
          ctx.moveTo(cx2, cy2 - sz); ctx.lineTo(cx2 + sz, cy2); ctx.lineTo(cx2, cy2 + sz); ctx.lineTo(cx2 - sz, cy2);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.globalAlpha = a * 0.75; ctx.stroke();
          ctx.restore();
          // Internal refraction
          ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 0.6; ctx.globalAlpha = a * 0.15;
          ctx.beginPath(); ctx.moveTo(cx2, cy2 - sz); ctx.lineTo(cx2, cy2 + sz); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx2 - sz, cy2); ctx.lineTo(cx2 + sz, cy2); ctx.stroke();
          ctx.restore();
          // Vertex dots
          ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = a * 0.65;
          for (const [vx, vy] of [[cx2, cy2 - sz], [cx2 + sz, cy2], [cx2, cy2 + sz], [cx2 - sz, cy2]] as [number, number][]) {
            ctx.beginPath(); ctx.arc(vx, vy, 2.2, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = a * 0.4;
          ctx.beginPath(); ctx.arc(cx2, cy2, 1.8, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          cprev = { x: cx2, y: cy2 };
        }
      }
      ctx.restore();
      break;
    }

    // ═══ DITHER: GRAIN — dense stipple cloud with varying dot sizes ═══
    case 'grain': {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.globalAlpha = a * 0.2;
      poly(); ctx.stroke(); ctx.restore();
      drawAsciiDither(ctx, points, color, a * 0.75, 48, false, 0);
      // Dense stipple cloud
      ctx.save(); ctx.fillStyle = color;
      const grainStep = Math.max(1, Math.floor(points.length / 80));
      const grainSub: Point[] = [];
      for (let i = 0; i < points.length; i += grainStep) grainSub.push(points[i]);
      grainSub.push(points[points.length - 1]);
      for (const gp of grainSub) {
        const cc = 8 + Math.floor(Math.random() * 6);
        for (let c = 0; c < cc; c++) {
          const ang = Math.random() * Math.PI * 2;
          const dist = Math.random() * 22 + 2;
          const dotR = 0.8 + Math.random() * 2.8;
          ctx.globalAlpha = a * (0.15 + Math.random() * 0.45);
          ctx.beginPath(); ctx.arc(gp.x + Math.cos(ang) * dist, gp.y + Math.sin(ang) * dist, dotR, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      // Spine characters
      ctx.save();
      ctx.font = "13px 'JetBrains Mono', monospace";
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = color;
      let accGr = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y;
        accGr += Math.sqrt(dx * dx + dy * dy);
        if (accGr >= 20) { accGr -= 20; const ch = DITHER_CHARS[5 + Math.floor(Math.random() * 4)]; ctx.globalAlpha = a * (0.4 + Math.random() * 0.4); ctx.fillText(ch, points[i].x, points[i].y); }
      }
      ctx.restore();
      ctx.restore();
      break;
    }

    // ═══ DITHER: NOISE — wide static interference band ═══
    case 'noise': {
      ctx.save();
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      const noiseAnim = locked;
      const noisePh = noiseAnim ? now * 0.0006 : 0;
      const noiseN = buildNormals(points);
      drawAsciiDither(ctx, points, color, a * 0.45, 55, noiseAnim, now * 0.001);
      // Static noise blocks
      ctx.save();
      let nbAcc = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y;
        nbAcc += Math.sqrt(dx * dx + dy * dy);
        if (nbAcc >= 5) {
          nbAcc -= 5;
          const bw = 8 + Math.random() * 20, bh = 1 + Math.random() * 3;
          const off = (Math.random() - 0.5) * 30;
          const px = points[i].x + noiseN[i].nx * off, py = points[i].y + noiseN[i].ny * off;
          const anim = noiseAnim ? Math.sin(i * 0.3 + now * 0.004) * 4 : 0;
          ctx.globalAlpha = a * (0.06 + Math.random() * 0.22); ctx.fillStyle = color;
          ctx.fillRect(px - bw / 2 + anim, py - bh / 2, bw, bh);
        }
      }
      ctx.restore();
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.globalAlpha = a * 0.35;
      poly(); ctx.stroke(); ctx.restore();
      // Dense hatching
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.2;
      let accNo = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y;
        accNo += Math.sqrt(dx * dx + dy * dy);
        if (accNo >= 6) {
          accNo -= 6;
          const hl = 10 + Math.sin(i * 0.35 + noisePh) * 14;
          const off = noiseAnim ? Math.sin(i * 0.4 + noisePh * 2.5) * 4 : 0;
          ctx.globalAlpha = a * (0.08 + Math.abs(Math.sin(i * 0.25 + noisePh)) * 0.35);
          ctx.beginPath();
          ctx.moveTo(points[i].x + noiseN[i].nx * (hl + off), points[i].y + noiseN[i].ny * (hl + off));
          ctx.lineTo(points[i].x - noiseN[i].nx * hl, points[i].y - noiseN[i].ny * hl);
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.restore();
      break;
    }

    // ═══ GLITCH: METAL — heavy fractured industrial shards ═══
    case 'metal': {
      ctx.save();
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      const mt = now * 0.001;
      const mi = locked ? (0.65 + 0.35 * Math.sin(mt * 1.9)) : 0.7;
      const metalN = buildNormals(points);
      // Chromatic aberration — thick
      ctx.save(); ctx.globalAlpha = a * 0.35 * mi; ctx.strokeStyle = '#FF4466'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) { const s = locked ? Math.sin(i * 0.08 + mt * 4) * 3.5 : -2.5; i === 0 ? ctx.moveTo(points[i].x + s - 2, points[i].y - 2) : ctx.lineTo(points[i].x + s - 2, points[i].y - 2); }
      ctx.stroke(); ctx.restore();
      ctx.save(); ctx.globalAlpha = a * 0.35 * mi; ctx.strokeStyle = '#4488FF'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) { const s = locked ? Math.sin(i * 0.08 + mt * 4 + 2) * 3.5 : 2.5; i === 0 ? ctx.moveTo(points[i].x + s + 2, points[i].y + 2) : ctx.lineTo(points[i].x + s + 2, points[i].y + 2); }
      ctx.stroke(); ctx.restore();
      // Main thick core
      ctx.save(); ctx.globalAlpha = a * 0.9; ctx.strokeStyle = color; ctx.lineWidth = 4;
      poly(); ctx.stroke(); ctx.restore();
      // Angular shard fragments
      ctx.save();
      let accMe = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y;
        accMe += Math.sqrt(dx * dx + dy * dy);
        if (accMe >= 18) {
          accMe -= 18;
          const shardLen = 8 + Math.sin(i * 0.5 + mt * 2) * 12;
          const shardW = 2 + Math.random() * 4;
          const side = (i % 2 === 0 ? 1 : -1);
          const sx = points[i].x + metalN[i].nx * shardLen * side;
          const sy = points[i].y + metalN[i].ny * shardLen * side;
          ctx.globalAlpha = a * 0.2 * mi;
          ctx.fillStyle = i % 3 === 0 ? '#FF4466' : i % 3 === 1 ? '#4488FF' : color;
          ctx.beginPath(); ctx.moveTo(points[i].x, points[i].y); ctx.lineTo(sx + shardW, sy); ctx.lineTo(sx - shardW, sy); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = a * 0.4 * mi;
          ctx.beginPath(); ctx.moveTo(points[i].x, points[i].y); ctx.lineTo(sx, sy); ctx.stroke();
        }
      }
      ctx.restore();
      // Data corruption rectangles
      ctx.save();
      let accMe2 = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y;
        accMe2 += Math.sqrt(dx * dx + dy * dy);
        if (accMe2 >= 16) {
          accMe2 -= 16;
          const tw = 16 + Math.sin(i * 0.5 + mt * 2) * 22, th = 2 + Math.random() * 3;
          const tx = points[i].x + (locked ? Math.sin(i * 0.25 + mt * 5) * 6 : Math.sin(i) * 4);
          ctx.globalAlpha = a * 0.15 * mi;
          ctx.fillStyle = i % 2 === 0 ? '#FF4466' : '#4488FF';
          ctx.fillRect(tx - tw / 2, points[i].y - th / 2, tw, th);
        }
      }
      ctx.restore();
      // Debris pixels
      ctx.save();
      for (let i = 0; i < points.length; i += 8) {
        const f = Math.sin(i * 0.7 + mt * 8);
        if (f > 0.15) {
          ctx.globalAlpha = a * 0.25 * mi; ctx.fillStyle = f > 0.5 ? '#FF4466' : '#4488FF';
          const ps = 2 + Math.random() * 3;
          ctx.fillRect(points[i].x + Math.sin(i) * 8 - ps / 2, points[i].y + Math.cos(i * 1.1) * 7 - ps / 2, ps, ps);
        }
      }
      ctx.restore();
      ctx.restore();
      break;
    }

    // ═══ GLITCH: FLUTTER — warped VHS tape with scan-line texture ═══
    case 'flutter': {
      ctx.save();
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      const ft = now * 0.001;
      const fsp = Math.sin(ft * 1.5);
      const flutterN = buildNormals(points);
      const FSL = 18;
      let faf = 0, fss = 0;
      const fsg: { s: number; e: number; ox: number; oy: number }[] = [];
      for (let i = 1; i < points.length; i++) {
        faf += Math.sqrt((points[i].x - points[i - 1].x) ** 2 + (points[i].y - points[i - 1].y) ** 2);
        if (faf >= FSL || i === points.length - 1) {
          const j = locked ? Math.sin(fsg.length * 1.8 + ft * 4) * 9 * fsp : Math.sin(fsg.length * 1.4) * 5;
          fsg.push({ s: fss, e: i, ox: j, oy: Math.sin(fsg.length * 0.6) * 2 });
          fss = i; faf = 0;
        }
      }
      // Chromatic ghosts — thick
      ctx.save(); ctx.globalAlpha = a * 0.25; ctx.strokeStyle = '#FF6B6B'; ctx.lineWidth = 3;
      for (const s of fsg) { ctx.beginPath(); for (let i = s.s; i <= s.e; i++) i === s.s ? ctx.moveTo(points[i].x + s.ox + 3, points[i].y + s.oy - 2) : ctx.lineTo(points[i].x + s.ox + 3, points[i].y + s.oy - 2); ctx.stroke(); }
      ctx.restore();
      ctx.save(); ctx.globalAlpha = a * 0.2; ctx.strokeStyle = '#6BE8FF'; ctx.lineWidth = 3;
      for (const s of fsg) { ctx.beginPath(); for (let i = s.s; i <= s.e; i++) i === s.s ? ctx.moveTo(points[i].x - s.ox - 2, points[i].y - s.oy + 2) : ctx.lineTo(points[i].x - s.ox - 2, points[i].y - s.oy + 2); ctx.stroke(); }
      ctx.restore();
      // Filled tape body per segment
      ctx.save();
      for (const s of fsg) {
        ctx.globalAlpha = a * 0.08; ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = s.s; i <= s.e; i++) { const ni = Math.min(i, flutterN.length - 1); i === s.s ? ctx.moveTo(points[i].x + s.ox + flutterN[ni].nx * 8, points[i].y + s.oy + flutterN[ni].ny * 8) : ctx.lineTo(points[i].x + s.ox + flutterN[ni].nx * 8, points[i].y + s.oy + flutterN[ni].ny * 8); }
        for (let i = s.e; i >= s.s; i--) { const ni = Math.min(i, flutterN.length - 1); ctx.lineTo(points[i].x + s.ox - flutterN[ni].nx * 8, points[i].y + s.oy - flutterN[ni].ny * 8); }
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // Main displaced segments — thick
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3;
      for (const s of fsg) {
        ctx.globalAlpha = a * (0.65 + Math.sin(s.s * 0.2 + ft) * 0.15);
        ctx.beginPath(); for (let i = s.s; i <= s.e; i++) i === s.s ? ctx.moveTo(points[i].x + s.ox, points[i].y + s.oy) : ctx.lineTo(points[i].x + s.ox, points[i].y + s.oy); ctx.stroke();
      }
      ctx.restore();
      // Scan-line texture
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 0.8;
      for (let si = 0; si < fsg.length; si += 2) {
        const s = fsg[si]; const mid = Math.min(Math.floor((s.s + s.e) / 2), points.length - 1);
        for (let sl = -2; sl <= 2; sl++) { ctx.globalAlpha = a * 0.06; ctx.beginPath(); ctx.moveTo(points[mid].x + s.ox - 14, points[mid].y + s.oy + sl * 3); ctx.lineTo(points[mid].x + s.ox + 14, points[mid].y + s.oy + sl * 3); ctx.stroke(); }
      }
      ctx.restore();
      // Glitch bars
      ctx.save();
      for (let i = 0; i < fsg.length; i += 2) {
        const s = fsg[i]; const pt = points[Math.min(s.e, points.length - 1)];
        const bw = 18 + Math.sin(i * 1.1 + ft * 3) * 14, bh = 2 + Math.random() * 2;
        ctx.globalAlpha = a * 0.14; ctx.fillStyle = i % 2 === 0 ? '#FF6B6B' : '#6BE8FF';
        ctx.fillRect(pt.x + s.ox - bw / 2, pt.y - bh / 2, bw, bh);
      }
      ctx.restore();
      ctx.restore();
      break;
    }
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
