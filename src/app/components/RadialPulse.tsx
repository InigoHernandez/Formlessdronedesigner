// Radial pulse effect that emanates from stroke start points

import { useEffect, useRef } from 'react';

interface Pulse {
  x: number;
  y: number;
  startTime: number;
  duration: number;
}

interface RadialPulseProps {
  pulses: Pulse[];
}

export function RadialPulse({ pulses }: RadialPulseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

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

    const draw = () => {
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const now = Date.now();

      pulses.forEach((pulse) => {
        const elapsed = now - pulse.startTime;
        if (elapsed > pulse.duration) return;

        const progress = elapsed / pulse.duration;
        const radius = progress * 150;
        const opacity = (1 - progress) * 0.4;

        ctx.beginPath();
        ctx.arc(pulse.x, pulse.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 255, 209, ${opacity})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener('resize', updateSize);
    };
  }, [pulses]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ mixBlendMode: 'screen' }}
    />
  );
}
