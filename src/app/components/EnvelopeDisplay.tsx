// Envelope visualizer canvas — ADSR-style curve per mode
// GATE: convex attack → sustain → concave release
// PULSE: 3 miniature GATE cycles at tempo spacing
// DRONE: attack → infinite sustain (flat line to right edge, ∞ label)

import { useRef, useEffect, useCallback, useState } from 'react';
import { AudioEngine } from '../utils/audioEngine';
import type { PlayMode } from '../utils/audioEngine';
import { useTheme } from './ThemeContext';

function getAccentRgb(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--fm-accent-rgb').trim();
  return raw || '245, 149, 70';
}

interface Props {
  envAttack: number;   // 0-100 knob value
  envRelease: number;  // 0-100 knob value
  playMode?: PlayMode;
  tempo?: number;
  onChange: (attack: number, release: number) => void;
}

export function EnvelopeDisplay({ envAttack, envRelease, playMode = 'gate', tempo = 85, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [hoverPoint, setHoverPoint] = useState<'peak' | 'tail' | null>(null);
  const dragRef = useRef<{ point: 'peak' | 'tail'; startX: number; startVal: number } | null>(null);
  const { isDark } = useTheme();

  // Convert knob 0-100 to seconds for display
  const atkSec = AudioEngine.mapAttackSec(envAttack);
  const relSec = AudioEngine.mapReleaseSec(envRelease);
  const isDrone = playMode === 'drone';

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const accentRgb = getAccentRgb();

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Clear + rounded background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = isDark ? 'rgba(28,14,6,0.4)' : 'rgba(210,225,245,0.6)';
    ctx.beginPath();
    const r = 4;
    ctx.moveTo(r, 0); ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r); ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h); ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r); ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.fill();

    const pad = 8;
    const drawW = w - pad * 2;
    const drawH = h - pad * 2;
    const baseline = pad + drawH;
    const peak = pad + 4;
    const sustainWidth = drawW * 0.08; // 8% sustain segment

    // Gradient fill
    const grad = ctx.createLinearGradient(0, peak, 0, baseline);
    grad.addColorStop(0, isDark ? `rgba(${accentRgb},0.15)` : `rgba(37,99,235,0.22)`);
    grad.addColorStop(1, isDark ? `rgba(${accentRgb},0)` : `rgba(37,99,235,0)`);

    // Helper: draw convex attack bezier (fast initial rise, gentle approach to peak)
    // Control point is high up and early: creates upward-bowing curve
    const drawAttack = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
      const cpX = x0 + (x1 - x0) * 0.25;
      const cpY = y1; // control point at peak height, positioned early
      ctx.bezierCurveTo(cpX, y0, cpX, cpY, x1, y1);
    };

    // Helper: draw concave release bezier (gentle initial fall, faster approach to zero)
    // Control point is near the top-right: creates downward-bowing curve
    const drawRelease = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) => {
      const cpX = x0 + (x1 - x0) * 0.75;
      const cpY = y0; // control point at peak height, positioned late
      ctx.bezierCurveTo(cpX, cpY, cpX, y1, x1, y1);
    };

    if (isDrone) {
      // ── DRONE: attack rise → flat sustain to right edge ──
      const atkFrac = Math.min(atkSec / 3, 0.4);
      const atkX = pad + atkFrac * drawW;
      const endX = w - pad;

      // Fill
      ctx.beginPath();
      ctx.moveTo(pad, baseline);
      drawAttack(ctx, pad, baseline, atkX, peak);
      ctx.lineTo(endX, peak);
      ctx.lineTo(endX, baseline);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Stroke line
      ctx.beginPath();
      ctx.moveTo(pad, baseline);
      drawAttack(ctx, pad, baseline, atkX, peak);
      ctx.lineTo(endX, peak);
      ctx.strokeStyle = `rgba(${accentRgb},0.7)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // ∞ label at right end of sustain line
      ctx.font = "12px 'JetBrains Mono', monospace";
      ctx.fillStyle = `rgba(${accentRgb},0.5)`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('∞', endX - 2, peak - 2);

      // Draggable peak point (attack)
      drawPoint(ctx, atkX, peak, hoverPoint === 'peak' || dragRef.current?.point === 'peak');

    } else if (playMode === 'pulse') {
      // ── PULSE: 3 miniature GATE cycles ──
      const beatDur = 60 / tempo;
      const totalTime = beatDur * 3;
      const pxPerSec = drawW / totalTime;

      // Fill path
      ctx.beginPath();
      ctx.moveTo(pad, baseline);
      for (let cycle = 0; cycle < 3; cycle++) {
        const cycleStart = pad + cycle * beatDur * pxPerSec;
        const atkTime = Math.min(atkSec, beatDur * 0.35);
        const relTime = Math.min(relSec, beatDur * 0.45);
        const atkEndX = cycleStart + atkTime * pxPerSec;
        const susW = Math.max(0, (beatDur - atkTime - relTime) * pxPerSec * 0.3);
        const susEndX = atkEndX + susW;
        const relEndX = susEndX + relTime * pxPerSec;
        const cycleEndX = Math.min(cycleStart + beatDur * pxPerSec, pad + drawW);

        drawAttack(ctx, cycleStart, baseline, atkEndX, peak);
        if (susW > 0) ctx.lineTo(susEndX, peak);
        drawRelease(ctx, susEndX, peak, Math.min(relEndX, cycleEndX), baseline);
        if (relEndX < cycleEndX) ctx.lineTo(cycleEndX, baseline);
      }
      ctx.lineTo(pad + drawW, baseline);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Stroke path
      ctx.beginPath();
      ctx.moveTo(pad, baseline);
      for (let cycle = 0; cycle < 3; cycle++) {
        const cycleStart = pad + cycle * beatDur * pxPerSec;
        const atkTime = Math.min(atkSec, beatDur * 0.35);
        const relTime = Math.min(relSec, beatDur * 0.45);
        const atkEndX = cycleStart + atkTime * pxPerSec;
        const susW = Math.max(0, (beatDur - atkTime - relTime) * pxPerSec * 0.3);
        const susEndX = atkEndX + susW;
        const relEndX = susEndX + relTime * pxPerSec;
        const cycleEndX = Math.min(cycleStart + beatDur * pxPerSec, pad + drawW);

        drawAttack(ctx, cycleStart, baseline, atkEndX, peak);
        if (susW > 0) ctx.lineTo(susEndX, peak);
        drawRelease(ctx, susEndX, peak, Math.min(relEndX, cycleEndX), baseline);
        if (relEndX < cycleEndX) ctx.lineTo(cycleEndX, baseline);
      }
      ctx.strokeStyle = `rgba(${accentRgb},0.7)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Peak point on first cycle
      const firstAtkTime = Math.min(atkSec, beatDur * 0.35);
      const firstAtkEndX = pad + firstAtkTime * pxPerSec;
      drawPoint(ctx, firstAtkEndX, peak, hoverPoint === 'peak' || dragRef.current?.point === 'peak');

    } else {
      // ── GATE: attack → sustain → release ──
      const totalVis = atkSec + relSec;
      // Distribute canvas: attack portion, 8% sustain, release portion
      const atkPortion = totalVis > 0 ? atkSec / totalVis : 0.5;
      const availW = drawW - sustainWidth;
      const atkW = availW * atkPortion;
      const relW = availW * (1 - atkPortion);

      const atkX = pad + atkW;
      const susEndX = atkX + sustainWidth;
      const relEndX = susEndX + relW;

      // Fill
      ctx.beginPath();
      ctx.moveTo(pad, baseline);
      drawAttack(ctx, pad, baseline, atkX, peak);
      ctx.lineTo(susEndX, peak);
      drawRelease(ctx, susEndX, peak, relEndX, baseline);
      ctx.lineTo(relEndX, baseline);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Stroke line
      ctx.beginPath();
      ctx.moveTo(pad, baseline);
      drawAttack(ctx, pad, baseline, atkX, peak);
      ctx.lineTo(susEndX, peak);
      drawRelease(ctx, susEndX, peak, relEndX, baseline);
      ctx.strokeStyle = `rgba(${accentRgb},0.7)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draggable points
      drawPoint(ctx, atkX, peak, hoverPoint === 'peak' || dragRef.current?.point === 'peak');
      drawPoint(ctx, relEndX, baseline, hoverPoint === 'tail' || dragRef.current?.point === 'tail');
    }
  }, [envAttack, envRelease, playMode, tempo, hoverPoint, atkSec, relSec, isDrone, isDark]);

  function drawPoint(ctx: CanvasRenderingContext2D, x: number, y: number, active: boolean) {
    const accentRgb = getAccentRgb();
    ctx.beginPath();
    ctx.arc(x, y, active ? 5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = active ? `rgba(${accentRgb},0.9)` : `rgba(${accentRgb},0.5)`;
    ctx.fill();
    if (active) {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${accentRgb},0.2)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [envAttack, envRelease, playMode, tempo, draw, hoverPoint]);

  // Hit-test for draggable points
  const getPointPositions = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { peakX: 0, peakY: 0, tailX: 0, tailY: 0 };
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pad = 8;
    const drawW = w - pad * 2;
    const drawH = h - pad * 2;
    const baseline = pad + drawH;
    const peakY = pad + 4;
    const sustainWidth = drawW * 0.08;

    if (isDrone) {
      const atkFrac = Math.min(atkSec / 3, 0.4);
      return { peakX: pad + atkFrac * drawW, peakY, tailX: 0, tailY: 0 };
    } else if (playMode === 'pulse') {
      const beatDur = 60 / tempo;
      const pxPerSec = drawW / (beatDur * 3);
      const firstAtkTime = Math.min(atkSec, beatDur * 0.35);
      return { peakX: pad + firstAtkTime * pxPerSec, peakY, tailX: 0, tailY: 0 };
    } else {
      const totalVis = atkSec + relSec;
      const atkPortion = totalVis > 0 ? atkSec / totalVis : 0.5;
      const availW = drawW - sustainWidth;
      const atkW = availW * atkPortion;
      const relW = availW * (1 - atkPortion);
      const atkX = pad + atkW;
      const susEndX = atkX + sustainWidth;
      const relEndX = susEndX + relW;
      return { peakX: atkX, peakY, tailX: relEndX, tailY: baseline };
    }
  }, [atkSec, relSec, playMode, tempo, isDrone]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pts = getPointPositions();
    const distPeak = Math.hypot(x - pts.peakX, y - pts.peakY);
    const distTail = Math.hypot(x - pts.tailX, y - pts.tailY);

    if (distPeak < 14) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      dragRef.current = { point: 'peak', startX: e.clientX, startVal: envAttack };
    } else if (playMode === 'gate' && distTail < 14) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      dragRef.current = { point: 'tail', startX: e.clientX, startVal: envRelease };
    }
  }, [envAttack, envRelease, playMode, getPointPositions]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (dragRef.current) {
      const delta = e.clientX - dragRef.current.startX;
      const newVal = Math.max(0, Math.min(100, dragRef.current.startVal + delta * 0.5));
      if (dragRef.current.point === 'peak') {
        onChange(newVal, envRelease);
      } else {
        onChange(envAttack, newVal);
      }
      return;
    }

    // Hover detection
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pts = getPointPositions();
    const distPeak = Math.hypot(x - pts.peakX, y - pts.peakY);
    const distTail = Math.hypot(x - pts.tailX, y - pts.tailY);

    if (distPeak < 14) setHoverPoint('peak');
    else if (playMode === 'gate' && distTail < 14) setHoverPoint('tail');
    else setHoverPoint(null);
  }, [envAttack, envRelease, playMode, onChange, getPointPositions]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch (_) {}
    dragRef.current = null;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full cursor-default"
      style={{
        height: '80px',
        borderRadius: '4px',
        touchAction: 'none',
        cursor: hoverPoint || dragRef.current ? 'col-resize' : 'default',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => { if (!dragRef.current) setHoverPoint(null); }}
    />
  );
}