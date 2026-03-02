// Oscilloscope — complete rebuild from zero
// Post-chain analyser, centered waveform, 3-pass glow

import { useEffect, useRef, useCallback } from 'react';
import type { AudioEngine } from '../utils/audioEngine';

interface WaveformVisualizerProps {
  audioEngine: AudioEngine | null;
}

export function WaveformVisualizer({ audioEngine }: WaveformVisualizerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Float32Array | null>(null);
  const configuredRef = useRef(false);

  // Step 1: Get or create analyser from the END of the audio chain
  const ensureAnalyser = useCallback(() => {
    if (configuredRef.current && analyserRef.current) return analyserRef.current;
    // Use the post-chain analyzer (sits after softClipper, before destination)
    const analyser = audioEngine?.getAnalyzer() ?? null;
    if (analyser) {
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      analyserRef.current = analyser;
      dataArrayRef.current = new Float32Array(analyser.fftSize);
      configuredRef.current = true;
    }
    return analyser;
  }, [audioEngine]);

  // Step 3 + 4: Sync size and draw
  const draw = useCallback(() => {
    animRef.current = requestAnimationFrame(draw);

    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Sync canvas pixel size to its CSS display size
    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const W = canvas.width;
    const H = canvas.height;

    // THE CRITICAL LINE: center is exactly half the canvas height
    const CENTER_Y = H * 0.4;
    const AMPLITUDE = CENTER_Y * 0.80;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Get audio data
    const analyser = ensureAnalyser();
    const dataArray = dataArrayRef.current;
    const bufferLength = analyser?.fftSize ?? 0;

    if (analyser && dataArray) {
      analyser.getFloatTimeDomainData(dataArray);
    }

    // Detect if audio is playing
    let sum = 0;
    if (dataArray && bufferLength > 0) {
      for (let i = 0; i < bufferLength; i++) sum += Math.abs(dataArray[i]);
    }
    const hasAudio = bufferLength > 0 && (sum / bufferLength) > 0.001;

    // Choose color based on theme
    const isDark = document.documentElement.classList.contains('theme-dark') ||
                   !document.documentElement.classList.contains('theme-light');
    const idleColor = isDark ? '#F9D6B6' : '#2563EB';
    const activeColor = isDark ? '#F59546' : '#2563EB';
    const color = hasAudio ? activeColor : idleColor;

    if (!isDark) {
      // Light mode: single pass, no shadow — ~60% cheaper rendering
      ctx.beginPath();
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.lineJoin = 'round';

      if (!hasAudio) {
        ctx.moveTo(0, CENTER_Y);
        ctx.lineTo(W, CENTER_Y);
      } else if (dataArray) {
        const step = W / bufferLength;
        for (let i = 0; i < bufferLength; i++) {
          const sample = Math.max(-1.0, Math.min(1.0, dataArray[i]));
          const y = CENTER_Y - (sample * AMPLITUDE);
          const x = i * step;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    } else {
      // Dark mode: three-pass glow render
      const passes = [
        { alpha: 0.10, blur: 10, lw: 4 },
        { alpha: 0.30, blur: 4,  lw: 2 },
        { alpha: 1.00, blur: 0,  lw: 1.5 },
      ];

      for (const pass of passes) {
        ctx.beginPath();
        ctx.globalAlpha = pass.alpha;
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = pass.blur;
        ctx.lineWidth = pass.lw;
        ctx.lineJoin = 'round';

        if (!hasAudio) {
          ctx.moveTo(0, CENTER_Y);
          ctx.lineTo(W, CENTER_Y);
        } else if (dataArray) {
          const step = W / bufferLength;
          for (let i = 0; i < bufferLength; i++) {
            const sample = Math.max(-1.0, Math.min(1.0, dataArray[i]));
            const y = CENTER_Y - (sample * AMPLITUDE);
            const x = i * step;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;
  }, [ensureAnalyser]);

  // Start/stop animation loop
  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [draw]);

  // Handle resize
  useEffect(() => {
    const onResize = () => {
      const wrapper = wrapperRef.current;
      const canvas = canvasRef.current;
      if (wrapper && canvas) {
        const w = wrapper.clientWidth;
        const h = wrapper.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      }
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Reset analyser ref when engine changes
  useEffect(() => {
    configuredRef.current = false;
    analyserRef.current = null;
    dataArrayRef.current = null;
  }, [audioEngine]);

  return (
    <div
      ref={wrapperRef}
      id="osc-wrapper"
      style={{
        position: 'relative',
        width: '100%',
        height: '56px',
        background: 'var(--fm-osc-bg, rgba(0, 0, 0, 0.25))',
        border: '1px solid var(--fm-osc-border, rgba(255, 255, 255, 0.10))',
        borderRadius: '6px',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <canvas
        ref={canvasRef}
        id="osc-canvas"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
}