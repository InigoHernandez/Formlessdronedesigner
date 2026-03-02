// Ambient grid component - pulsing rhythmic background at 85 BPM

import { useEffect, useRef } from 'react';

interface AmbientGridProps {
  bpm?: number;
  isDark?: boolean;
}

export function AmbientGrid({ bpm = 85, isDark = true }: AmbientGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const updateSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    updateSize();
    window.addEventListener('resize', updateSize);

    const beatDuration = (60 / bpm) * 1000; // milliseconds per beat

    const draw = () => {
      if (!ctx) return;

      const elapsed = Date.now() - startTimeRef.current;
      const beatPhase = (elapsed % beatDuration) / beatDuration; // 0 to 1

      // Oscillate opacity between 0.02 and 0.08
      const opacity = 0.02 + Math.sin(beatPhase * Math.PI * 2) * 0.03 + 0.03;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = isDark
        ? `rgba(49, 28, 14, ${opacity * 1.5})`
        : `rgba(180, 160, 140, ${opacity * 0.7})`;
      ctx.lineWidth = 1;

      // Draw horizontal grid lines
      const spacing = 40;
      for (let y = 0; y < canvas.height; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener('resize', updateSize);
    };
  }, [bpm, isDark]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ mixBlendMode: isDark ? 'screen' : 'multiply' }}
    />
  );
}