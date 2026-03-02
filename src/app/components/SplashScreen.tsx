// SplashScreen.tsx — FORMLESS intro splash
// Popup modal with cyberpunk dark + amber/orange sunset palette
// Smooth scale-down + fade-out dismiss animation

import React, { useEffect, useRef, useState, useCallback } from 'react';
import formlessLogo from 'figma:asset/5c2d1a5cfb5061941897dfcfb30ab4d196e31f3f.png';

interface Props {
  onEnter: () => void;
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
      const w = canvas.width = canvas.offsetWidth;
      const h = canvas.height = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);
      t += 0.012;
      const mid = h / 2;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (let x = 0; x < w; x++) {
        const nx = x / w;
        const y = mid
          + Math.sin(nx * 8 + t) * 10
          + Math.sin(nx * 3.2 + t * 1.4) * 6
          + Math.sin(nx * 14 + t * 2.1) * 3;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(255,107,43,0)');
      grad.addColorStop(0.2, 'rgba(255,107,43,0.7)');
      grad.addColorStop(0.5, 'rgba(255,173,0,0.9)');
      grad.addColorStop(0.8, 'rgba(255,107,43,0.7)');
      grad.addColorStop(1, 'rgba(255,107,43,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 12;
      ctx.shadowColor = 'rgba(255,140,0,0.6)';
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={canvasRef} style={{ width: '100%', height: '40px', display: 'block' }} />;
}

export function SplashScreen({ onEnter }: Props) {
  const noiseRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<'in' | 'idle' | 'out'>('in');
  const [glitch, setGlitch] = useState(false);
  useNoise(noiseRef);

  // Entry animation
  useEffect(() => {
    const t = setTimeout(() => setPhase('idle'), 80);
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
            fontFamily: "Menlo, 'Courier New', monospace",
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

          {/* FORMLESS title with glitch layers */}
          {/* Logo */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px', marginBottom: '28px' }}>
            <img
              src={formlessLogo}
              alt="FORMLESS logo"
              style={{ width: '80px', height: '80px', borderRadius: '18px', border: '1px solid rgba(255,107,43,0.18)' }}
            />
          </div>

          <div style={{
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
              <div style={{
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
              <div style={{
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
            fontFamily: "Menlo, 'Courier New', monospace",
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
            fontFamily: "Menlo, 'Courier New', monospace",
            fontSize: '11px',
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
              FORMLESS turns every stroke into a living drone — real-time granular synthesis, spatial FX, and scale-locked pitch.
              No rules. No loops. Just pure gesture.
            </span>
          </p>

          {/* CTA button */}
          <button
            className="fm-splash-cta"
            onClick={handleEnter}
            style={{
              fontFamily: "Menlo, 'Courier New', monospace",
              fontSize: '12px',
              letterSpacing: '0.2em',
              color: '#0A0608',
              background: 'linear-gradient(135deg, #CC4A08 0%, #FF8C00 50%, #CC4A08 100%)',
              border: 'none',
              borderRadius: '8px',
              padding: '13px 44px',
              cursor: 'pointer',
              textTransform: 'uppercase',
              transition: 'all 220ms cubic-bezier(0.16,1,0.3,1)',
              animation: isIn ? 'none' : 'fm-fade-up 700ms 550ms both ease, fm-cta-hover 3s 1500ms ease-in-out infinite',
              boxShadow: '0 0 12px rgba(255,107,43,0.4)',
              marginBottom: '24px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%)',
              transform: 'translateX(-100%)',
              animation: 'fm-scan 2.5s ease-in-out infinite',
              pointerEvents: 'none',
            }} />
            INITIALIZE SESSION
          </button>

          {/* Made by */}
          <div style={{
            fontFamily: "Menlo, 'Courier New', monospace",
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