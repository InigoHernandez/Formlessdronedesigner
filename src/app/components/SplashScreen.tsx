// SplashScreen.tsx — FORMLESS intro splash
// Popup modal with cyberpunk dark + amber/orange sunset palette
// Smooth scale-down + fade-out dismiss animation

import React, { useEffect, useRef, useState, useCallback } from 'react';
import formlessLogo from 'figma:asset/5c2d1a5cfb5061941897dfcfb30ab4d196e31f3f.png';

interface Props {
  onEnter: () => void;
}

// ── Glyph pool for text scramble ──
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const TARGET = 'INITIALIZE SESSION';

// ASCII Dither background — grid of monospaced characters with drift + pulse
function AsciiDither() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf: number;

    // Dither charset — ordered from lightest to heaviest
    const CHARS = ' .:-=+*#%@';
    const CELL = 10; // px per character cell
    const FONT_SIZE = 9;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const cols = Math.ceil(w / CELL);
      const rows = Math.ceil(h / CELL);
      const t = Date.now() * 0.001;

      ctx.font = `${FONT_SIZE}px 'JetBrains Mono', monospace`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cx = col * CELL + CELL / 2;
          const cy = row * CELL + CELL / 2;

          // Normalized position
          const nx = col / cols;
          const ny = row / rows;

          // Radial distance from center
          const dx = nx - 0.5;
          const dy = ny - 0.5;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Animated noise field — layered sine waves
          const n1 = Math.sin(nx * 12.0 + t * 0.4) * Math.cos(ny * 8.0 - t * 0.3);
          const n2 = Math.sin((nx + ny) * 6.0 + t * 0.7) * 0.5;
          const n3 = Math.cos(dist * 14.0 - t * 0.8) * 0.3;
          const noise = (n1 + n2 + n3) * 0.5 + 0.5; // 0..1

          // Vignette — darker at edges, brighter at center
          const vignette = 1.0 - Math.min(dist * 1.6, 1.0);
          const intensity = noise * vignette;

          // Pick character from density ramp
          const ci = Math.floor(intensity * (CHARS.length - 1));
          const ch = CHARS[Math.max(0, Math.min(ci, CHARS.length - 1))];
          if (ch === ' ') continue;

          // Color: orange-amber tones
          const brightness = 0.3 + intensity * 0.7;
          const r = Math.floor(255 * brightness);
          const g = Math.floor(107 * brightness);
          const b = Math.floor(43 * brightness * 0.5);
          const alpha = (0.04 + intensity * 0.14) * vignette;

          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.fillText(ch, cx, cy);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}

// Minimal noise canvas — grain overlay
function useNoise(canvasRef: React.RefObject<HTMLCanvasElement>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf: number;
    let frame = 0;

    const draw = () => {
      frame++;
      if (frame % 3 !== 0) { raf = requestAnimationFrame(draw); return; }
      const w = canvas.width = canvas.offsetWidth;
      const h = canvas.height = canvas.offsetHeight;
      if (w === 0 || h === 0) { raf = requestAnimationFrame(draw); return; }
      const img = ctx.createImageData(w, h);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 28;
        data[i] = v; data[i+1] = v * 0.6; data[i+2] = v * 0.2;
        data[i+3] = Math.random() * 18;
      }
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
}

// Oscilloscope waveform — ambient animation
function WaveBar() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf: number;
    let t = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      t += 0.008;
      const mid = h / 2;

      const buildWave = (phase: number, amp: number) => {
        const pts: number[] = [];
        for (let x = 0; x <= w; x++) {
          const nx = x / w;
          const env = Math.sin(nx * Math.PI);
          const y = mid
            + (Math.sin(nx * 9 + t * 1.1 + phase) * 12
            + Math.sin(nx * 4.3 + t * 1.6 + phase) * 7
            + Math.sin(nx * 16 + t * 2.4 + phase) * 3.5
            + Math.sin(nx * 22 + t * 0.7 + phase) * 2) * env * amp;
          pts.push(y);
        }
        return pts;
      };

      // Glow layers
      const glowLayers = [
        { phase: 0.5, amp: 0.6, alpha: 0.06, blur: 18 },
        { phase: 0.3, amp: 0.75, alpha: 0.1, blur: 10 },
      ];
      for (const layer of glowLayers) {
        const pts = buildWave(layer.phase, layer.amp);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, mid);
        for (let x = 0; x <= w; x++) ctx.lineTo(x, pts[x]);
        ctx.lineTo(w, mid);
        ctx.closePath();
        const gFill = ctx.createLinearGradient(0, 0, w, 0);
        gFill.addColorStop(0, 'rgba(255,107,43,0)');
        gFill.addColorStop(0.25, `rgba(255,140,0,${layer.alpha})`);
        gFill.addColorStop(0.5, `rgba(255,173,0,${layer.alpha * 1.6})`);
        gFill.addColorStop(0.75, `rgba(255,140,0,${layer.alpha})`);
        gFill.addColorStop(1, 'rgba(255,107,43,0)');
        ctx.fillStyle = gFill;
        ctx.shadowBlur = layer.blur;
        ctx.shadowColor = 'rgba(255,120,30,0.4)';
        ctx.fill();
        // Mirror
        ctx.save();
        ctx.translate(0, mid * 2);
        ctx.scale(1, -1);
        ctx.beginPath();
        ctx.moveTo(0, mid);
        for (let x = 0; x <= w; x++) ctx.lineTo(x, pts[x]);
        ctx.lineTo(w, mid);
        ctx.closePath();
        const mFill = ctx.createLinearGradient(0, 0, w, 0);
        mFill.addColorStop(0, 'rgba(255,107,43,0)');
        mFill.addColorStop(0.3, `rgba(255,140,0,${layer.alpha * 0.4})`);
        mFill.addColorStop(0.5, `rgba(255,173,0,${layer.alpha * 0.6})`);
        mFill.addColorStop(0.7, `rgba(255,140,0,${layer.alpha * 0.4})`);
        mFill.addColorStop(1, 'rgba(255,107,43,0)');
        ctx.fillStyle = mFill;
        ctx.shadowBlur = 0;
        ctx.fill();
        ctx.restore();
        ctx.restore();
      }

      // Secondary trailing wave
      const pts2 = buildWave(1.8, 0.45);
      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        if (x === 0) ctx.moveTo(x, pts2[x]);
        else ctx.lineTo(x, pts2[x]);
      }
      const g2 = ctx.createLinearGradient(0, 0, w, 0);
      g2.addColorStop(0, 'rgba(255,80,20,0)');
      g2.addColorStop(0.2, 'rgba(255,120,50,0.25)');
      g2.addColorStop(0.5, 'rgba(255,173,0,0.35)');
      g2.addColorStop(0.8, 'rgba(255,120,50,0.25)');
      g2.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.strokeStyle = g2;
      ctx.lineWidth = 1;
      ctx.shadowBlur = 6;
      ctx.shadowColor = 'rgba(255,140,0,0.3)';
      ctx.stroke();

      // Primary main wave
      const pts1 = buildWave(0, 1);
      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        if (x === 0) ctx.moveTo(x, pts1[x]);
        else ctx.lineTo(x, pts1[x]);
      }
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(255,107,43,0)');
      grad.addColorStop(0.15, 'rgba(255,107,43,0.8)');
      grad.addColorStop(0.5, 'rgba(255,200,60,1)');
      grad.addColorStop(0.85, 'rgba(255,107,43,0.8)');
      grad.addColorStop(1, 'rgba(255,107,43,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 16;
      ctx.shadowColor = 'rgba(255,160,20,0.7)';
      ctx.stroke();

      // Bright center hot-spot
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      const cxStart = Math.floor(w * 0.3);
      const cxEnd = Math.floor(w * 0.7);
      for (let x = cxStart; x <= cxEnd; x++) {
        if (x === cxStart) ctx.moveTo(x, pts1[x]);
        else ctx.lineTo(x, pts1[x]);
      }
      const hGrad = ctx.createLinearGradient(cxStart, 0, cxEnd, 0);
      hGrad.addColorStop(0, 'rgba(255,220,120,0)');
      hGrad.addColorStop(0.5, 'rgba(255,230,160,0.45)');
      hGrad.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.strokeStyle = hGrad;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'rgba(255,200,80,0.5)';
      ctx.stroke();
      ctx.restore();

      // Floating particle dots
      ctx.save();
      const particleCount = 12;
      for (let i = 0; i < particleCount; i++) {
        const px = ((i / particleCount) + t * 0.04 + Math.sin(i * 2.3) * 0.05) % 1;
        const ix = Math.floor(px * w);
        const py = pts1[Math.min(ix, w)];
        if (py === undefined) continue;
        const env = Math.sin(px * Math.PI);
        const flicker = 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + i * 1.7));
        const r = (1.2 + Math.sin(t * 2 + i) * 0.6) * env;
        if (r < 0.3) continue;
        ctx.beginPath();
        ctx.arc(ix, py, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,210,100,${0.7 * env * flicker})`;
        ctx.shadowBlur = 10;
        ctx.shadowColor = `rgba(255,180,50,${0.5 * env * flicker})`;
        ctx.fill();
      }
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={canvasRef} style={{ width: '100%', height: '60px', display: 'block' }} />;
}

export function SplashScreen({ onEnter }: Props) {
  const noiseRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<'in' | 'idle' | 'out'>('in');
  const [glitch, setGlitch] = useState(false);
  const [ctaText, setCtaText] = useState(TARGET);
  const [ctaReady, setCtaReady] = useState(false); // true once entrance anim is done
  const scrambleTimers = useRef<number[]>([]);
  useNoise(noiseRef);

  // Entry animation
  useEffect(() => {
    const t = setTimeout(() => setPhase('idle'), 80);
    return () => clearTimeout(t);
  }, []);

  // Mark CTA entrance animation as complete (~1.3s = 550ms delay + 700ms anim)
  useEffect(() => {
    const t = setTimeout(() => setCtaReady(true), 1400);
    return () => clearTimeout(t);
  }, []);

  // Occasional glitch on title
  useEffect(() => {
    const loop = () => {
      const delay = 2800 + Math.random() * 5000;
      return setTimeout(() => {
        setGlitch(true);
        setTimeout(() => setGlitch(false), 180);
        timerRef.current = loop();
      }, delay);
    };
    const timerRef = { current: loop() };
    return () => clearTimeout(timerRef.current);
  }, []);

  // ── CTA hover scramble logic ──
  const clearScramble = useCallback(() => {
    scrambleTimers.current.forEach(t => clearTimeout(t));
    scrambleTimers.current = [];
  }, []);

  const startScramble = useCallback(() => {
    clearScramble();
    setCtaText(
      TARGET.split('').map(ch =>
        ch === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      ).join('')
    );

    // Phase 1: rapid full-text scramble (0–200ms)
    const scrambleCount = 5;
    const scrambleInterval = 40;
    for (let s = 0; s < scrambleCount; s++) {
      const tid = window.setTimeout(() => {
        setCtaText(
          TARGET.split('').map(ch =>
            ch === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
          ).join('')
        );
      }, s * scrambleInterval);
      scrambleTimers.current.push(tid);
    }

    // Phase 2: resolve characters left-to-right (200–500ms)
    const resolveStart = scrambleCount * scrambleInterval;
    const perChar = 18; // ms between each char locking in
    for (let i = 0; i <= TARGET.length; i++) {
      const tid = window.setTimeout(() => {
        setCtaText(prev => {
          const locked = TARGET.slice(0, i);
          const remaining = prev.slice(i).split('').map((ch, j) => {
            const actualIdx = i + j;
            if (actualIdx >= TARGET.length) return '';
            return TARGET[actualIdx] === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          }).join('');
          return locked + remaining;
        });
      }, resolveStart + i * perChar);
      scrambleTimers.current.push(tid);
    }

    // Phase 3: end glitch state
    const totalDuration = resolveStart + TARGET.length * perChar + 50;
    const endTid = window.setTimeout(() => {
      setCtaText(TARGET);
    }, totalDuration);
    scrambleTimers.current.push(endTid);
  }, [clearScramble]);

  const stopScramble = useCallback(() => {
    clearScramble();
    setCtaText(TARGET);
  }, [clearScramble]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearScramble();
  }, [clearScramble]);

  const handleEnter = useCallback(() => {
    setPhase('out');
    setTimeout(onEnter, 700);
  }, [onEnter]);

  const isIn = phase === 'in';
  const isOut = phase === 'out';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isOut ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.75)',
        backdropFilter: isOut ? 'blur(0px)' : 'blur(6px)',
        WebkitBackdropFilter: isOut ? 'blur(0px)' : 'blur(6px)',
        transition: 'background-color 700ms cubic-bezier(0.4,0,0.2,1), backdrop-filter 700ms cubic-bezier(0.4,0,0.2,1)',
        padding: '24px',
      }}
    >
      {/* Keyframes + styles */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=VT323&display=swap');

        @keyframes fm-flicker {
          0%,100%{opacity:1} 92%{opacity:1} 93%{opacity:0.85} 94%{opacity:1} 96%{opacity:0.9} 97%{opacity:1}
        }
        @keyframes fm-scan {
          0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)}
        }
        @keyframes fm-glitch-1 {
          0%,100%{clip-path:inset(0 0 100% 0);transform:translate(0)} 
          20%{clip-path:inset(20% 0 60% 0);transform:translate(-4px,1px)} 
          40%{clip-path:inset(50% 0 30% 0);transform:translate(3px,-1px)} 
          60%{clip-path:inset(70% 0 10% 0);transform:translate(-2px,2px)} 
          80%{clip-path:inset(0 0 80% 0);transform:translate(2px,-2px)}
        }
        @keyframes fm-glitch-2 {
          0%,100%{clip-path:inset(100% 0 0% 0);transform:translate(0)} 
          20%{clip-path:inset(60% 0 20% 0);transform:translate(4px,-1px)} 
          40%{clip-path:inset(30% 0 50% 0);transform:translate(-3px,1px)} 
          60%{clip-path:inset(10% 0 70% 0);transform:translate(2px,-2px)} 
          80%{clip-path:inset(80% 0 0% 0);transform:translate(-2px,2px)}
        }
        @keyframes fm-pulse-ring {
          0%{transform:scale(0.9);opacity:0.8} 50%{transform:scale(1.05);opacity:0.3} 100%{transform:scale(0.9);opacity:0.8}
        }
        @keyframes fm-cta-hover {
          0%,100%{box-shadow:0 0 12px rgba(255,107,43,0.4)} 50%{box-shadow:0 0 24px rgba(255,173,0,0.6)}
        }
        @keyframes fm-fade-up {
          from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)}
        }
        @keyframes fm-fade-in {
          from{opacity:0} to{opacity:1}
        }
        @keyframes fm-modal-in {
          from{opacity:0;transform:scale(0.92) translateY(20px)} to{opacity:1;transform:scale(1) translateY(0)}
        }
        .fm-splash-cta {
          /* base transition for non-hover state */
        }
        .fm-splash-cta:hover {
          background: linear-gradient(135deg, #E8550A 0%, #FF8C00 50%, #E8550A 100%) !important;
          letter-spacing: 0.25em !important;
          box-shadow: 0 0 32px rgba(255,140,0,0.6), 0 0 64px rgba(255,107,43,0.3) !important;
        }
        .fm-splash-cta:active {
          transform: scale(0.97) !important;
        }
      `}</style>

      {/* Modal card */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          backgroundColor: '#06050A',
          borderRadius: '20px',
          border: '1px solid rgba(255,107,43,0.18)',
          boxShadow: '0 25px 80px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: isOut ? 0 : (isIn ? 0 : 1),
          transform: isOut ? 'scale(0.88) translateY(30px)' : (isIn ? 'scale(0.92) translateY(20px)' : 'scale(1) translateY(0)'),
          transition: isOut
            ? 'opacity 600ms cubic-bezier(0.4,0,1,1), transform 600ms cubic-bezier(0.4,0,1,1)'
            : 'opacity 600ms cubic-bezier(0.16,1,0.3,1), transform 600ms cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* Inner background effects container */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: '20px', pointerEvents: 'none' }}>
          {/* Deep radial gradient background */}
          <div style={{
            position: 'absolute', inset: 0,
            background: `
              radial-gradient(ellipse 80% 60% at 50% 110%, rgba(180,60,0,0.45) 0%, rgba(100,30,0,0.2) 40%, transparent 70%),
              radial-gradient(ellipse 60% 40% at 50% 100%, rgba(255,107,43,0.12) 0%, transparent 60%),
              radial-gradient(ellipse 100% 80% at 50% 120%, rgba(50,10,0,0.6) 0%, transparent 60%)
            `,
          }} />

          {/* ASCII Dither layer */}
          <AsciiDither />

          {/* Grid floor */}
          <div style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0,
            height: '55%',
            backgroundImage: `
              linear-gradient(to bottom, transparent 0%, rgba(255,90,0,0.06) 100%),
              linear-gradient(rgba(255,90,0,0.12) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,90,0,0.08) 1px, transparent 1px)
            `,
            backgroundSize: '100% 100%, 100% 40px, 60px 100%',
            maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.7) 30%, black 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.7) 30%, black 100%)',
            transform: 'perspective(400px) rotateX(40deg)',
            transformOrigin: 'top center',
          }} />

          {/* Scanline sweep */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', left: 0, right: 0, height: '120px',
              background: 'linear-gradient(to bottom, transparent, rgba(255,120,40,0.04) 50%, transparent)',
              animation: 'fm-scan 6s linear infinite',
            }} />
          </div>

          {/* CRT scanlines static */}
          <div className="rounded-[48px]" style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 3px)',
            animation: 'fm-flicker 8s ease-in-out infinite',
          }} />

          {/* Noise grain */}
          <canvas ref={noiseRef} style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            mixBlendMode: 'screen',
          }} />
        </div>

        {/* Corner brackets — relative to the modal card */}
        {[
          { top: 12, left: 12, borderTop: '1px solid', borderLeft: '1px solid' },
          { top: 12, right: 12, borderTop: '1px solid', borderRight: '1px solid' },
          { bottom: 12, left: 12, borderBottom: '1px solid', borderLeft: '1px solid' },
          { bottom: 12, right: 12, borderBottom: '1px solid', borderRight: '1px solid' },
        ].map((s, i) => (
          null
        ))}

        {/* Content */}
        <div style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '40px 32px 36px',
          overflowY: 'auto',
          maxHeight: '90vh',
        }}>
          {/* Status bar */}
          <div style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: '9px',
            letterSpacing: '0.2em',
            color: 'rgba(255,107,43,0.5)',
            marginBottom: '28px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            animation: isIn ? 'none' : 'fm-fade-in 600ms 400ms both ease',
          }}>
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              backgroundColor: '#FF6B2B',
              boxShadow: '0 0 8px rgba(255,107,43,0.8)',
              animation: 'fm-pulse-ring 2s ease-in-out infinite',
            }} />
            SYS.INIT // AUDIO_ENGINE READY // v1.0.0
          </div>

          {/* Logo */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px', marginBottom: '28px' }}>
            <img
              src={formlessLogo}
              alt="FORMLESS logo"
              style={{ width: '80px', height: '80px', borderRadius: '18px', border: '1px solid rgba(255,107,43,0.18)' }}
            />
          </div>

          {/* FORMLESS title with glitch layers */}
          <div className="fm-splash-title" style={{
            position: 'relative',
            fontFamily: "'Orbitron', sans-serif",
            fontSize: 'clamp(26px, 7vw, 44px)',
            fontWeight: 800,
            lineHeight: 0.9,
            letterSpacing: '0.12em',
            color: '#FFF5E0',
            textShadow: '0 0 40px rgba(255,140,0,0.4), 0 0 80px rgba(255,90,0,0.2)',
            userSelect: 'none',
            marginBottom: '12px',
            filter: glitch ? 'brightness(1.3)' : 'none',
            transition: 'filter 80ms',
          }}>
            FORMLESS
            {glitch && (
              <div className="fm-splash-title" style={{
                position: 'absolute', inset: 0,
                fontFamily: "'Orbitron', sans-serif",
                fontSize: 'inherit', lineHeight: 'inherit', letterSpacing: 'inherit',
                fontWeight: 'inherit',
                color: '#FF4500',
                animation: 'fm-glitch-1 180ms steps(2) forwards',
                pointerEvents: 'none',
              }}>FORMLESS</div>
            )}
            {glitch && (
              <div className="fm-splash-title" style={{
                position: 'absolute', inset: 0,
                fontFamily: "'Orbitron', sans-serif",
                fontSize: 'inherit', lineHeight: 'inherit', letterSpacing: 'inherit',
                fontWeight: 'inherit',
                color: '#00FFD1',
                animation: 'fm-glitch-2 180ms steps(2) forwards',
                pointerEvents: 'none',
              }}>FORMLESS</div>
            )}
          </div>

          {/* Subtitle */}
          <div style={{
            fontFamily: "'Inter', sans-serif",
            fontWeight: 300,
            fontSize: '12px',
            letterSpacing: '0.35em',
            color: 'rgba(255,173,0,0.7)',
            marginBottom: '28px',
            textTransform: 'uppercase',
            animation: isIn ? 'none' : 'fm-fade-up 700ms 200ms both ease',
          }}>
            Drone Sound Designer
          </div>

          {/* Waveform */}
          <div style={{
            width: '100%',
            marginBottom: '28px',
            opacity: 0.8,
            animation: isIn ? 'none' : 'fm-fade-in 900ms 300ms both ease',
          }}>
            <WaveBar />
          </div>

          {/* Description */}
          <p style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: '12px',
            lineHeight: 1.8,
            letterSpacing: '0.04em',
            color: 'rgba(255,220,160,0.65)',
            textAlign: 'center',
            margin: '0 0 32px',
            maxWidth: '380px',
            animation: isIn ? 'none' : 'fm-fade-up 700ms 450ms both ease',
          }}>
            Draw gestures. Shape sound.{' '}
            <span style={{ color: 'rgba(255,173,0,0.5)' }}>
              FORMLESS turns every stroke into a living drone — real time modulation, spatial FX, and scale-locked pitch.
              No rules. No loops. Just pure gesture.
            </span>
          </p>

          {/* CTA button */}
          <button
            className="fm-splash-cta"
            onClick={handleEnter}
            onMouseEnter={startScramble}
            onMouseLeave={stopScramble}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: '12px',
              letterSpacing: '0.2em',
              color: '#0A0608',
              background: 'linear-gradient(135deg, #CC4A08 0%, #FF8C00 50%, #CC4A08 100%)',
              border: 'none',
              borderRadius: '8px',
              padding: '0 44px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              textTransform: 'uppercase',
              transition: 'all 220ms cubic-bezier(0.16,1,0.3,1)',
              animation: isIn
                ? 'none'
                : ctaReady
                  ? 'fm-cta-hover 3s ease-in-out infinite'
                  : 'fm-fade-up 700ms 550ms both ease, fm-cta-hover 3s 1500ms ease-in-out infinite',
              boxShadow: '0 0 12px rgba(255,107,43,0.4)',
              marginBottom: '24px',
              position: 'relative',
              overflow: 'hidden',
              minWidth: '240px',
            }}
          >
            {/* Scan sweep overlay */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%)',
              transform: 'translateX(-100%)',
              animation: 'fm-scan 2.5s ease-in-out infinite',
              pointerEvents: 'none',
            }} />

            {/* Main text */}
            <span style={{ position: 'relative', zIndex: 1 }}>{ctaText}</span>
          </button>

          {/* Made by */}
          <div style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: '10px',
            letterSpacing: '0.1em',
            color: 'rgba(255,107,43,0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: isIn ? 'none' : 'fm-fade-in 800ms 700ms both ease',
          }}>
            <span>MADE BY</span>
            <a
              href="https://www.youtube.com/@sequencist"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'rgba(255,173,0,0.65)',
                textDecoration: 'none',
                borderBottom: '1px solid rgba(255,173,0,0.25)',
                paddingBottom: '1px',
                transition: 'color 200ms, border-color 200ms',
                letterSpacing: '0.12em',
              }}
              onMouseEnter={e => {
                (e.target as HTMLElement).style.color = 'rgba(255,173,0,1)';
                (e.target as HTMLElement).style.borderColor = 'rgba(255,173,0,0.8)';
              }}
              onMouseLeave={e => {
                (e.target as HTMLElement).style.color = 'rgba(255,173,0,0.65)';
                (e.target as HTMLElement).style.borderColor = 'rgba(255,173,0,0.25)';
              }}
            >
              SEQUENCIST
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}