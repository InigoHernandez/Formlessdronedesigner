// FORMLESS — Drawing Canvas
// 30fps throttled, max 16 simultaneous strokes, unified pointer events
// Real-time sound modulation during drawing, Gate/Pulse/Drone mode
// Left vertical strip layout, centered elements

import { useEffect, useRef, useState, useCallback } from 'react';
import { AudioEngine, SoundFlavor, PlayMode } from '../utils/audioEngine';
import { StrokeAnalyzer, Point } from '../utils/strokeAnalyzer';
import { WaveformVisualizer } from './WaveformVisualizer';
import { AmbientGrid } from './AmbientGrid';
import { RadialPulse } from './RadialPulse';
import { FlavorSelector } from './FlavorSelector';
import { ModulatorPanel } from './ModulatorPanel';
import { ScaleSelector, RootNote, ScaleType, getRootFrequency, getScaleIntervals, buildScaleTable, mapYToScaleFreq, type ScaleNote } from './ScaleSelector';
import { CRTEffect } from './CRTEffect';
import { FLAVOR_COLORS } from '../utils/flavorColors';
import { FLAVOR_COLORS_LIGHT } from '../utils/flavorColors';
import { Eye, EyeOff, Trash2, Sun, Moon } from 'lucide-react';
import { useTheme } from './ThemeContext';

interface Stroke {
  id: string;
  points: Point[];
  color: string;
  startTime: number;
  duration: number;
  avgY: number;
  flavor: SoundFlavor;
  locked: boolean;
  muted: boolean;
  fadeOutStart?: number;
  isPulse?: boolean;
}

interface VisualPulse {
  x: number;
  y: number;
  startTime: number;
  duration: number;
}

const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
const LEFT_STRIP_WIDTH = 88;
const FX_PANEL_WIDTH = 220;
const FLAVOR_BAR_WIDTH = 400;

export function DrawingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioEngineRef = useRef<AudioEngine>(new AudioEngine());
  const strokePointsRef = useRef<Point[]>([]);
  const isDrawingRef = useRef(false);
  const activePointerRef = useRef<number | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const [pulses, setPulses] = useState<VisualPulse[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [activeFlavor, setActiveFlavor] = useState<SoundFlavor>('sine');
  const activeFlavorRef = useRef<SoundFlavor>('sine');
  const [showScanlineGlitch, setShowScanlineGlitch] = useState(false);
  const [currentPitch, setCurrentPitch] = useState<string | null>(null);
  const currentStrokeRef = useRef<Point[]>([]);
  const [currentStrokeForUI, setCurrentStrokeForUI] = useState<Point[]>([]);
  const [modulators, setModulators] = useState(audioEngineRef.current.getModulators());
  const animationRef = useRef<number>();
  const lastFrameRef = useRef(0);
  const [scale, setScale] = useState<ScaleType>('MAJOR');
  const scaleRef = useRef<ScaleType>('MAJOR');
  const [rootNote, setRootNote] = useState<RootNote>('C');
  const rootNoteRef = useRef<RootNote>('C');
  const [performanceMode, setPerformanceMode] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>('gate');
  const playModeRef = useRef<PlayMode>('gate');
  const [flavorVolumes, setFlavorVolumes] = useState(audioEngineRef.current.getFlavorVolumes());

  // Octave selector state (default 3, range 1-6)
  const [octave, setOctave] = useState(3);
  const octaveRef = useRef(3);

  // Scale frequency table
  const scaleTableRef = useRef<ScaleNote[]>(buildScaleTable('C', 'MAJOR', 3));
  // Guide lines: rAF-driven fade envelope (no CSS transitions)
  const [guideVisibleNotes, setGuideVisibleNotes] = useState<ScaleNote[]>([]);
  const guideStartRef = useRef<number | null>(null);
  const guideAnimRef = useRef<number>(0);
  const guideContainerRef = useRef<HTMLDivElement>(null);
  const triggerGuideLinesRef = useRef<(table: ScaleNote[], scaleType: ScaleType) => void>(() => {});
  const [rootPulse, setRootPulse] = useState<{ startTime: number } | null>(null);

  // Live stroke tracking
  const liveStrokeIdRef = useRef<string | null>(null);
  const accPathLenRef = useRef(0);
  const isDarkRef = useRef(true);

  // Theme
  const { isDark, toggle: toggleTheme } = useTheme();
  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);
  const colorMap = isDark ? FLAVOR_COLORS : FLAVOR_COLORS_LIGHT;
  const flavorColor = colorMap[activeFlavor];

  // Keep refs in sync
  useEffect(() => { activeFlavorRef.current = activeFlavor; }, [activeFlavor]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { rootNoteRef.current = rootNote; }, [rootNote]);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);
  useEffect(() => { octaveRef.current = octave; }, [octave]);

  useEffect(() => {
    audioEngineRef.current.initialize();
    // Set initial scale table
    const table = buildScaleTable('C', 'MAJOR', 3);
    scaleTableRef.current = table;
    audioEngineRef.current.setScaleTable(table);
  }, []);

  // Root note change — retune + radial pulse
  const handleRootChange = useCallback((note: RootNote) => {
    const prevRoot = rootNoteRef.current;
    setRootNote(note);
    rootNoteRef.current = note;
    audioEngineRef.current.setRootFrequency(getRootFrequency(note, octaveRef.current));

    // Rebuild scale table
    const table = buildScaleTable(note, scaleRef.current, octaveRef.current);
    scaleTableRef.current = table;
    audioEngineRef.current.setScaleTable(table);

    // Retune active strokes with 300ms glide
    audioEngineRef.current.retuneActiveStrokes();

    // Visual: soft radial pulse from center
    if (prevRoot !== note) {
      setRootPulse({ startTime: Date.now() });
      setTimeout(() => setRootPulse(null), 650);
    }

    // Visual: show guide lines with fade
    triggerGuideLinesRef.current(table, scaleRef.current);
  }, []);

  // ═══════════════════════════════════════════
  // GUIDE LINES — rAF-driven fade envelope
  // Fade in 400ms, hold 2500ms, fade out 800ms
  // ═══════════════════════════════════════════
  const GUIDE_FADE_IN = 400;
  const GUIDE_HOLD = 2500;
  const GUIDE_FADE_OUT = 800;
  const GUIDE_TOTAL = GUIDE_FADE_IN + GUIDE_HOLD + GUIDE_FADE_OUT; // 3700ms

  const NATURAL_NOTES = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

  const filterGuideNotes = useCallback((table: ScaleNote[], scaleType: ScaleType): ScaleNote[] => {
    if (scaleType === 'CHROMATIC') {
      // For chromatic, only show natural notes (no sharps/flats) to avoid crowding
      return table.filter(n => {
        const noteName = n.name.replace(/\d+$/, ''); // strip octave number
        return NATURAL_NOTES.has(noteName);
      });
    }
    return table;
  }, []);

  const updateGuideLines = useCallback(() => {
    if (guideStartRef.current === null) return;
    const elapsed = Date.now() - guideStartRef.current;

    let opacity: number;
    if (elapsed < GUIDE_FADE_IN) {
      // Fade in: 0 → 1 over 400ms
      opacity = elapsed / GUIDE_FADE_IN;
    } else if (elapsed < GUIDE_FADE_IN + GUIDE_HOLD) {
      // Hold at full
      opacity = 1;
    } else if (elapsed < GUIDE_TOTAL) {
      // Fade out: 1 → 0 over 800ms
      opacity = 1 - (elapsed - GUIDE_FADE_IN - GUIDE_HOLD) / GUIDE_FADE_OUT;
    } else {
      // Done — clear
      opacity = 0;
      guideStartRef.current = null;
      setGuideVisibleNotes([]);
      return;
    }

    if (guideContainerRef.current) {
      guideContainerRef.current.style.opacity = String(opacity);
    }
    guideAnimRef.current = requestAnimationFrame(updateGuideLines);
  }, []);

  const triggerGuideLines = useCallback((table: ScaleNote[], scaleType: ScaleType) => {
    // Cancel any running animation
    if (guideAnimRef.current) cancelAnimationFrame(guideAnimRef.current);
    // Filter notes for display density
    const filtered = filterGuideNotes(table, scaleType);
    setGuideVisibleNotes(filtered);
    guideStartRef.current = Date.now();
    // Kick off rAF loop (container opacity starts at 0, will be set by updateGuideLines)
    guideAnimRef.current = requestAnimationFrame(updateGuideLines);
  }, [filterGuideNotes, updateGuideLines]);

  // Keep ref in sync so handleRootChange/handleScaleChange can call it
  triggerGuideLinesRef.current = triggerGuideLines;

  // Cleanup guide animation on unmount
  useEffect(() => {
    return () => { if (guideAnimRef.current) cancelAnimationFrame(guideAnimRef.current); };
  }, []);

  // Scale change — retune + guide lines
  const handleScaleChange = useCallback((newScale: ScaleType) => {
    setScale(newScale);
    scaleRef.current = newScale;

    // Rebuild scale table
    const table = buildScaleTable(rootNoteRef.current, newScale, octaveRef.current);
    scaleTableRef.current = table;
    audioEngineRef.current.setScaleTable(table);

    // Retune active strokes
    audioEngineRef.current.retuneActiveStrokes();

    // Visual: show guide lines with rAF fade
    triggerGuideLinesRef.current(table, newScale);
  }, []);

  // Octave change — rebuild scale table, retune active strokes with 300ms glide
  const handleOctaveChange = useCallback((newOctave: number) => {
    const oldOctave = octaveRef.current;
    setOctave(newOctave);
    octaveRef.current = newOctave;
    audioEngineRef.current.setRootFrequency(getRootFrequency(rootNoteRef.current, newOctave));

    // Rebuild scale table with new octave range
    const table = buildScaleTable(rootNoteRef.current, scaleRef.current, newOctave);
    scaleTableRef.current = table;
    audioEngineRef.current.setScaleTable(table);

    // Retune active strokes with direct octave ratio shift (300ms glide)
    audioEngineRef.current.retuneForOctaveChange(oldOctave, newOctave);

    // Visual: show guide lines with fade
    triggerGuideLinesRef.current(table, scaleRef.current);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setActiveCount(audioEngineRef.current.getActiveCount()), 100);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Stroke expiry
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setStrokes(prev => prev.map(s => {
        if (s.locked || s.isPulse) return s;
        if (s.duration !== Infinity && now - s.startTime >= s.duration && !s.fadeOutStart) return { ...s, fadeOutStart: now };
        return s;
      }).filter(s => {
        if (s.locked || s.isPulse) return true;
        if (s.fadeOutStart) return now - s.fadeOutStart < 600;
        if (s.duration === Infinity) return true;
        return now - s.startTime < s.duration;
      }));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setPulses(prev => prev.filter(p => Date.now() - p.startTime < p.duration));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const handleModulatorUpdate = useCallback((settings: Partial<typeof modulators>) => {
    audioEngineRef.current.setModulators(settings);
    setModulators(audioEngineRef.current.getModulators());
  }, []);

  const freqToNote = (freq: number): string => {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const c0 = 440 * Math.pow(2, -4.75);
    const hs = Math.round(12 * Math.log2(freq / c0));
    return `${names[((hs % 12) + 12) % 12]}${Math.floor(hs / 12)}`;
  };

  const getNextScaleDegree = (freq: number, direction: number): number => {
    const a4 = 440;
    const midi = 69 + 12 * Math.log2(freq / a4);
    const notesList: RootNote[] = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const rootOffset = notesList.indexOf(rootNoteRef.current);
    const intervals = getScaleIntervals(scaleRef.current);
    const scaleNotes = intervals.map(i => (rootOffset + i) % 12);
    const octave = Math.floor(midi / 12);
    const noteInOctave = Math.round(midi % 12);
    const idx = scaleNotes.indexOf(noteInOctave);
    if (idx >= 0) {
      const nextIdx = idx + direction;
      if (nextIdx >= 0 && nextIdx < scaleNotes.length) {
        return a4 * Math.pow(2, (octave * 12 + scaleNotes[nextIdx] - 69) / 12);
      } else if (nextIdx >= scaleNotes.length) {
        return a4 * Math.pow(2, ((octave + 1) * 12 + scaleNotes[0] - 69) / 12);
      } else {
        return a4 * Math.pow(2, ((octave - 1) * 12 + scaleNotes[scaleNotes.length - 1] - 69) / 12);
      }
    }
    return freq;
  };

  const detectDirectionChange = (pts: Point[]): number => {
    if (pts.length < 3) return 0;
    const p1 = pts[pts.length - 3], p2 = pts[pts.length - 2], p3 = pts[pts.length - 1];
    const a1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const a2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
    let diff = Math.abs(a2 - a1);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff > Math.PI / 3) return a2 > a1 ? 1 : -1;
    return 0;
  };

  const handlePlayModeChange = useCallback((mode: PlayMode) => {
    setPlayMode(mode);
    // Clean break: audio engine fades all strokes over 150ms
    audioEngineRef.current.setPlayMode(mode);
    // Immediately fade out ALL visual strokes — locked, pulse, and in-flight gate strokes
    setStrokes(prev => prev.map(s => ({
      ...s, locked: false, isPulse: false, fadeOutStart: Date.now(),
    })));
    // Also clear any in-progress pulses
    setPulses([]);
  }, []);

  // ═══════════════════════════════════════════
  // POINTER EVENTS — real-time sound modulation
  // ═══════════════════════════════════════════
  const handlePointerDown = useCallback(async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDrawingRef.current) return;
    await audioEngineRef.current.resume();
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.setPointerCapture(e.pointerId);
    activePointerRef.current = e.pointerId;
    isDrawingRef.current = true;
    accPathLenRef.current = 0;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    strokePointsRef.current = [{ x, y, time: Date.now() }];
    currentStrokeRef.current = [{ x, y, time: Date.now() }];
    setCurrentStrokeForUI([{ x, y, time: Date.now() }]);

    const isNoiseFlavor = activeFlavorRef.current === 'noise';
    const scaleNote = mapYToScaleFreq(y, canvas.height, scaleTableRef.current);
    const freq = isNoiseFlavor ? 440 : scaleNote.freq;
    setCurrentPitch(isNoiseFlavor ? null : scaleNote.name);

    const liveId = `live_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    liveStrokeIdRef.current = liveId;
    const panX = x / canvas.width;
    const evictedId = audioEngineRef.current.startLiveStroke(liveId, freq, activeFlavorRef.current, panX, y);
    if (evictedId) {
      setStrokes(prev => prev.filter(s => s.id !== evictedId));
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || e.pointerId !== activePointerRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const now = Date.now();
    const point: Point = { x, y, time: now };
    strokePointsRef.current.push(point);
    currentStrokeRef.current = [...strokePointsRef.current];
    setCurrentStrokeForUI([...strokePointsRef.current]);

    const isNoiseFlavor = activeFlavorRef.current === 'noise';
    const scaleNote = mapYToScaleFreq(y, canvas.height, scaleTableRef.current);
    const freq = isNoiseFlavor ? 440 : scaleNote.freq;
    if (!isNoiseFlavor) setCurrentPitch(scaleNote.name);

    const pts = strokePointsRef.current;
    if (pts.length >= 2 && liveStrokeIdRef.current) {
      const prev = pts[pts.length - 2];
      const dx = x - prev.x;
      const dy = y - prev.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      accPathLenRef.current += segLen;
      const dt = (now - prev.time) / 1000 || 0.016;
      const hVelocity = Math.abs(dx) / dt;
      const pointerVelocity = segLen / dt;

      const dirChange = detectDirectionChange(pts);
      let freqTarget: number | undefined;
      if (dirChange !== 0) {
        freqTarget = getNextScaleDegree(freq, dirChange);
      }

      audioEngineRef.current.modulateLiveStroke(liveStrokeIdRef.current, {
        hVelocity,
        accLength: accPathLenRef.current,
        pointerVelocity,
        directionChange: dirChange !== 0,
        freqTarget,
      });
    }
  }, []);

  const finalizeStroke = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    activePointerRef.current = null;
    setCurrentPitch(null);

    const points = strokePointsRef.current;
    strokePointsRef.current = [];
    currentStrokeRef.current = [];
    setCurrentStrokeForUI([]);

    if (points.length < 2) {
      if (liveStrokeIdRef.current) {
        audioEngineRef.current.finalizeLiveStroke(liveStrokeIdRef.current, false);
        liveStrokeIdRef.current = null;
      }
      return;
    }

    const analyzed = StrokeAnalyzer.analyze(points);
    const flavor = activeFlavorRef.current;
    const color = (isDarkRef.current ? FLAVOR_COLORS : FLAVOR_COLORS_LIGHT)[flavor];
    const mode = playModeRef.current;
    const isLocked = mode === 'drone' || mode === 'pulse';
    const isPulse = mode === 'pulse';

    if (liveStrokeIdRef.current) {
      audioEngineRef.current.finalizeLiveStroke(liveStrokeIdRef.current, isLocked);
    }
    const strokeId = liveStrokeIdRef.current || `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    liveStrokeIdRef.current = null;

    setPulses(prev => [...prev, {
      x: analyzed.startPoint.x, y: analyzed.startPoint.y,
      startTime: Date.now(), duration: 800,
    }]);

    const normalized = Math.min(analyzed.length / 800, 1);
    const duration = (mode === 'drone' || mode === 'pulse') ? Infinity : (4 + normalized * 4) * 1000;

    setStrokes(prev => [...prev, {
      id: strokeId, points, color, startTime: Date.now(), duration,
      avgY: analyzed.avgY, flavor, locked: isLocked, muted: false, isPulse,
    }]);
  }, []);

  const handlePointerFinish = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== activePointerRef.current) return;
    finalizeStroke();
  }, [finalizeStroke]);

  const handleClear = useCallback(() => {
    setShowScanlineGlitch(true);
    setTimeout(() => setShowScanlineGlitch(false), 350);
    setStrokes([]);
    setPulses([]);
    audioEngineRef.current.clearAll();
  }, []);

  // ═══════════════════════════════════════════
  // DRAWING — flavor-specific stroke rendering
  // ═══════════════════════════════════════════
  const drawStroke = (
    ctx: CanvasRenderingContext2D, points: Point[], color: string,
    opacity: number, flavor: SoundFlavor, locked: boolean, muted: boolean
  ) => {
    if (points.length < 2) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const a = muted ? opacity * 0.2 : opacity;
    const now = Date.now();
    // Light mode: disable all shadowBlur for GPU performance
    const useShadow = isDarkRef.current;

    switch (flavor) {
      case 'sine': {
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.shadowBlur = useShadow ? (locked ? 25 : 15) : 0;
        ctx.shadowColor = useShadow ? color : 'transparent';
        ctx.globalAlpha = a * 0.4;
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
          const cx = (points[i].x + points[i+1].x) / 2;
          const cy = (points[i].y + points[i+1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, cx, cy);
        }
        ctx.lineTo(points[points.length-1].x, points[points.length-1].y);
        ctx.stroke();
        ctx.shadowBlur = useShadow ? 6 : 0; ctx.globalAlpha = a; ctx.stroke();
        break;
      }
      case 'saw': {
        ctx.strokeStyle = color; ctx.lineWidth = 2.5;
        ctx.shadowBlur = useShadow ? 12 : 0;
        ctx.shadowColor = useShadow ? '#FF8C00' : 'transparent';
        ctx.globalAlpha = a;
        ctx.beginPath();
        for (let i = 0; i < points.length - 1; i++) {
          const dx = points[i+1].x - points[i].x;
          const dy = points[i+1].y - points[i].y;
          const len = Math.sqrt(dx*dx + dy*dy);
          if (len < 1) continue;
          const nx = -dy/len, ny = dx/len;
          const zigOff = (i % 2 === 0 ? 3 : -3);
          const mx = (points[i].x + points[i+1].x) / 2 + nx * zigOff;
          const my = (points[i].y + points[i+1].y) / 2 + ny * zigOff;
          if (i === 0) ctx.moveTo(points[i].x, points[i].y);
          ctx.lineTo(mx, my); ctx.lineTo(points[i+1].x, points[i+1].y);
        }
        ctx.stroke();
        break;
      }
      case 'sub': {
        const pulse = 0.7 + 0.3 * Math.sin(now * 0.003);
        ctx.strokeStyle = color; ctx.lineWidth = 10;
        ctx.shadowBlur = useShadow ? 32 : 0;
        ctx.shadowColor = useShadow ? color : 'transparent';
        ctx.globalAlpha = a * 0.35 * pulse;
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
        ctx.lineWidth = 5; ctx.shadowBlur = useShadow ? 14 : 0; ctx.globalAlpha = a * pulse; ctx.stroke();
        break;
      }
      case 'grain': {
        ctx.shadowBlur = useShadow ? 6 : 0;
        ctx.shadowColor = useShadow ? '#F5E6C8' : 'transparent';
        // Light mode: cap total particles at 30 for performance
        const maxPoints = useShadow ? points.length : Math.min(points.length, 30);
        for (let i = 0; i < maxPoints; i++) {
          const pi = useShadow ? i : Math.floor(i * points.length / maxPoints);
          const pc = 3 + Math.floor(Math.random() * 3);
          for (let j = 0; j < pc; j++) {
            const ox = (Math.random() - 0.5) * 24, oy = (Math.random() - 0.5) * 24;
            const sz = 1 + Math.random() * 3;
            ctx.globalAlpha = a * (0.2 + Math.random() * 0.6);
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(points[pi].x + ox, points[pi].y + oy, sz, 0, Math.PI * 2); ctx.fill();
          }
        }
        break;
      }
      case 'noise': {
        const isAnimated = locked;
        const undulationPhase = isAnimated ? (now * 0.001 * 0.3 * Math.PI * 2) : 0;
        const undulationAmp = isAnimated ? 4 : 0;

        const wavePoints: { x: number; y: number }[] = [];
        let accDist = 0;
        for (let i = 0; i < points.length; i++) {
          let px = points[i].x, py = points[i].y;
          if (isAnimated && i > 0) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            const segLen = Math.sqrt(dx * dx + dy * dy) || 1;
            accDist += segLen;
            const nx = -dy / segLen, ny = dx / segLen;
            const wave = Math.sin(undulationPhase + accDist * 0.02) * undulationAmp;
            px += nx * wave;
            py += ny * wave;
          }
          wavePoints.push({ x: px, y: py });
        }

        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        // Outer glow layer
        ctx.strokeStyle = `rgba(184,169,201,${a * 0.08})`;
        ctx.lineWidth = 24;
        ctx.shadowBlur = useShadow ? 20 : 0;
        ctx.shadowColor = useShadow ? 'rgba(184,169,201,0.3)' : 'transparent';
        ctx.globalAlpha = a * 0.3;
        ctx.beginPath(); ctx.moveTo(wavePoints[0].x, wavePoints[0].y);
        for (let i = 1; i < wavePoints.length - 1; i++) {
          const cpx = (wavePoints[i].x + wavePoints[i + 1].x) / 2;
          const cpy = (wavePoints[i].y + wavePoints[i + 1].y) / 2;
          ctx.quadraticCurveTo(wavePoints[i].x, wavePoints[i].y, cpx, cpy);
        }
        ctx.lineTo(wavePoints[wavePoints.length - 1].x, wavePoints[wavePoints.length - 1].y);
        ctx.stroke();
        // Mid layer
        ctx.strokeStyle = `rgba(184,169,201,${a * 0.15})`;
        ctx.lineWidth = 14;
        ctx.shadowBlur = useShadow ? 12 : 0;
        ctx.globalAlpha = a * 0.5;
        ctx.beginPath(); ctx.moveTo(wavePoints[0].x, wavePoints[0].y);
        for (let i = 1; i < wavePoints.length - 1; i++) {
          const cpx = (wavePoints[i].x + wavePoints[i + 1].x) / 2;
          const cpy = (wavePoints[i].y + wavePoints[i + 1].y) / 2;
          ctx.quadraticCurveTo(wavePoints[i].x, wavePoints[i].y, cpx, cpy);
        }
        ctx.lineTo(wavePoints[wavePoints.length - 1].x, wavePoints[wavePoints.length - 1].y);
        ctx.stroke();
        // Core bright line
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.shadowBlur = useShadow ? 8 : 0;
        ctx.shadowColor = useShadow ? color : 'transparent';
        ctx.globalAlpha = a * 0.6;
        ctx.beginPath(); ctx.moveTo(wavePoints[0].x, wavePoints[0].y);
        for (let i = 1; i < wavePoints.length - 1; i++) {
          const cpx = (wavePoints[i].x + wavePoints[i + 1].x) / 2;
          const cpy = (wavePoints[i].y + wavePoints[i + 1].y) / 2;
          ctx.quadraticCurveTo(wavePoints[i].x, wavePoints[i].y, cpx, cpy);
        }
        ctx.lineTo(wavePoints[wavePoints.length - 1].x, wavePoints[wavePoints.length - 1].y);
        ctx.stroke();
        break;
      }
      case 'metal': {
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        ctx.shadowBlur = useShadow ? 4 : 0;
        ctx.shadowColor = useShadow ? color : 'transparent';
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
        ctx.lineWidth = 1; ctx.shadowBlur = 0;
        let accLen = 0;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i-1].x, dy = points[i].y - points[i-1].y;
          accLen += Math.sqrt(dx*dx + dy*dy);
          if (accLen > 20 + Math.random() * 15) {
            accLen = 0;
            const angle = Math.random() * Math.PI * 2;
            const shardLen = 10 + Math.random() * 12;
            ctx.globalAlpha = a * 0.7; ctx.beginPath();
            ctx.moveTo(points[i].x, points[i].y);
            ctx.lineTo(points[i].x + Math.cos(angle) * shardLen, points[i].y + Math.sin(angle) * shardLen);
            ctx.stroke();
          }
        }
        break;
      }
      case 'flutter': {
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        ctx.shadowBlur = useShadow ? 14 : 0;
        ctx.shadowColor = useShadow ? color : 'transparent';
        ctx.globalAlpha = a;
        ctx.beginPath();
        let totalLen = 0;
        for (let i = 0; i < points.length; i++) {
          if (i > 0) totalLen += Math.sqrt((points[i].x-points[i-1].x)**2 + (points[i].y-points[i-1].y)**2);
          const dx2 = i < points.length-1 ? points[i+1].x-points[i].x : points[i].x-points[i-1].x;
          const dy2 = i < points.length-1 ? points[i+1].y-points[i].y : points[i].y-points[i-1].y;
          const l = Math.sqrt(dx2*dx2+dy2*dy2)||1;
          const nx=-dy2/l, ny=dx2/l;
          const wave = Math.sin(totalLen/40*Math.PI*2)*8;
          if (i===0) ctx.moveTo(points[i].x+nx*wave, points[i].y+ny*wave);
          else ctx.lineTo(points[i].x+nx*wave, points[i].y+ny*wave);
        }
        ctx.stroke();
        break;
      }
      case 'crystal': {
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.shadowBlur = useShadow ? 16 : 0;
        ctx.shadowColor = useShadow ? color : 'transparent';
        let pathLen = 0, lastDiamond = 0;
        for (let i = 1; i < points.length; i++) {
          pathLen += Math.sqrt((points[i].x-points[i-1].x)**2 + (points[i].y-points[i-1].y)**2);
          if (pathLen - lastDiamond >= 14) {
            lastDiamond = pathLen;
            const cx2 = points[i].x, cy2 = points[i].y;
            const sz = 6 + Math.sin(pathLen * 0.15) * 2;
            ctx.globalAlpha = a * 0.15; ctx.fillStyle = color;
            ctx.beginPath(); ctx.moveTo(cx2, cy2-sz); ctx.lineTo(cx2+sz, cy2);
            ctx.lineTo(cx2, cy2+sz); ctx.lineTo(cx2-sz, cy2); ctx.closePath(); ctx.fill();
            ctx.globalAlpha = a * 0.8; ctx.stroke();
          }
        }
        ctx.globalAlpha = a * 0.3; ctx.lineWidth = 0.5;
        ctx.shadowBlur = useShadow ? 4 : 0;
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
        break;
      }
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  };

  // Chromatic aberration helper — light mode only
  // Draws two extra offset passes: R channel +1px, B channel -1px, at 60% intensity
  const drawStrokeWithCA = (
    ctx: CanvasRenderingContext2D, points: Point[], color: string,
    opacity: number, flavor: SoundFlavor, locked: boolean, muted: boolean,
    applyCA: boolean
  ) => {
    if (applyCA && points.length >= 2) {
      // Red channel offset: +1px X
      ctx.save();
      ctx.translate(1, 0);
      ctx.globalCompositeOperation = 'lighter';
      drawStroke(ctx, points, 'rgba(180,40,40,0.12)', opacity * 0.6, flavor, locked, muted);
      ctx.restore();
      // Blue channel offset: -1px X
      ctx.save();
      ctx.translate(-1, 0);
      ctx.globalCompositeOperation = 'lighter';
      drawStroke(ctx, points, 'rgba(40,40,180,0.12)', opacity * 0.6, flavor, locked, muted);
      ctx.restore();
    }
    // Normal pass (always)
    ctx.globalCompositeOperation = 'source-over';
    drawStroke(ctx, points, color, opacity, flavor, locked, muted);
  };

  // Dynamic FPS animation loop: dark=60fps, light=30fps
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas || canvas.width === 0) return;

    const LIGHT_INTERVAL = 1000 / 30;
    const DARK_INTERVAL = 1000 / 60;

    const loop = (timestamp: number) => {
      animationRef.current = requestAnimationFrame(loop);
      const frameInterval = isDarkRef.current ? DARK_INTERVAL : LIGHT_INTERVAL;
      if (timestamp - lastFrameRef.current < frameInterval) return;
      lastFrameRef.current = timestamp;

      ctx.fillStyle = isDarkRef.current ? '#08080E' : '#EDEAE2';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const now = Date.now();
      const beatDurMs = 60000 / modulators.tempo;
      const beatPhase = (now % beatDurMs) / beatDurMs;

      strokesRef.current.forEach(stroke => {
        let opacity: number;
        if (stroke.fadeOutStart) {
          opacity = 0.04 * Math.max(0, 1 - (now - stroke.fadeOutStart) / 600);
        } else if (stroke.isPulse) {
          // PULSE visual sync: pulse glow brightens on beat
          const pulseLen = modulators.pulseLength;
          const phase = beatPhase;
          opacity = phase < pulseLen
            ? 0.6 + 0.7 * Math.sin((phase / pulseLen) * Math.PI)
            : 0.15;
        } else if (stroke.locked) {
          opacity = 1.15 + Math.sin(beatPhase * Math.PI * 2) * 0.15;
        } else if (stroke.duration === Infinity) {
          opacity = 1;
        } else {
          opacity = Math.max(0, 1 - (now - stroke.startTime) / stroke.duration);
        }
        if (opacity > 0) {
          drawStrokeWithCA(ctx, stroke.points, stroke.color, opacity, stroke.flavor, stroke.locked || !!stroke.isPulse, stroke.muted, !isDarkRef.current);
          if ((stroke.locked || stroke.isPulse) && !stroke.fadeOutStart) {
            ctx.fillStyle = stroke.color; ctx.globalAlpha = 0.6;
            ctx.beginPath(); ctx.arc(stroke.points[0].x, stroke.points[0].y, 4, 0, Math.PI*2); ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      });

      const curStroke = currentStrokeRef.current;
      if (curStroke.length > 1) {
        const curMap = isDarkRef.current ? FLAVOR_COLORS : FLAVOR_COLORS_LIGHT;
        drawStroke(ctx, curStroke, curMap[activeFlavorRef.current], 1, activeFlavorRef.current, false, false);
      }
    };

    animationRef.current = requestAnimationFrame(loop);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [modulators.tempo, modulators.pulseLength]);

  const modeOptions: PlayMode[] = ['gate', 'pulse', 'drone'];

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: 'var(--fm-bg)', transition: 'background-color 300ms ease' }}>
      <AmbientGrid bpm={modulators.tempo} isDark={isDark} />

      <div className="absolute inset-0" style={{ perspective: '1200px', perspectiveOrigin: '50% 50%', backgroundColor: 'var(--fm-canvas-bg)', transition: 'background-color 300ms ease' }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerFinish}
          onPointerCancel={handlePointerFinish}
          onLostPointerCapture={handlePointerFinish}
          style={{
            touchAction: 'none', cursor: 'crosshair',
            width: '100%', height: '100%',
            transform: 'rotateX(0.3deg) rotateY(0deg) scale(1.01)',
            transformOrigin: '50% 50%',
          }}
          aria-label="Drawing canvas - draw gestures to create ambient sounds"
          role="application"
        />
      </div>

      <RadialPulse pulses={pulses} />

      {showScanlineGlitch && (
        <div className="fixed inset-0 pointer-events-none" style={{
          zIndex: 99, background: 'transparent',
          backgroundImage: `repeating-linear-gradient(0deg,transparent 0px,transparent 2px,rgba(255,255,255,0.06) 2px,rgba(255,255,255,0.06) 3px),linear-gradient(180deg,transparent 20%,rgba(0,255,209,0.03) 30%,transparent 40%,rgba(255,255,255,0.04) 60%,transparent 70%)`,
        }} />
      )}

      {/* Pitch indicator */}
      {currentPitch && currentStrokeForUI.length > 0 && (
        <div
          className="absolute pointer-events-none px-3 py-1 backdrop-blur-sm border rounded font-mono tracking-wider z-30"
          style={{
            left: currentStrokeForUI[currentStrokeForUI.length - 1].x + 20,
            top: currentStrokeForUI[currentStrokeForUI.length - 1].y - 30,
            color: flavorColor, borderColor: `${flavorColor}40`, fontSize: '10px',
            backgroundColor: 'var(--fm-panel-bg)',
          }}
        >
          {currentPitch}
        </div>
      )}

      {/* ═══ TOP ROW: Left Strip + FORMLESS wordmark ═══ */}
      <div
        className="fixed top-0 left-0 z-20 pointer-events-none transition-opacity duration-200"
        style={{
          padding: '16px',
          opacity: performanceMode ? 0 : 1,
        }}
      >
        {/* FORMLESS wordmark — left-aligned with buttons */}
        <div
          className="font-mono opacity-45 tracking-widest select-none"
          style={{ fontSize: '9px', width: LEFT_STRIP_WIDTH, marginBottom: '8px', color: 'var(--fm-accent)' }}
        >
          FORMLESS
        </div>

        {/* Left Strip — column of controls */}
        <div
          className="flex flex-col items-center flex-shrink-0 pointer-events-auto"
          style={{ width: LEFT_STRIP_WIDTH, gap: '8px' }}
        >
          {/* Hide/show toggle */}
          <button
            onClick={() => setPerformanceMode(!performanceMode)}
            className="h-10 flex items-center justify-center backdrop-blur-sm border rounded transition-all duration-200"
            style={{
              width: '100%',
              color: 'var(--fm-text-secondary)',
              borderColor: 'var(--fm-panel-border)',
              backgroundColor: 'var(--fm-panel-bg)',
            }}
            aria-label="Toggle performance mode"
            title="Performance mode"
          >
            <EyeOff size={16} />
          </button>

          {/* Theme toggle — sun (in dark) / moon (in light) */}
          <button
            onClick={toggleTheme}
            className="h-10 flex items-center justify-center backdrop-blur-sm border rounded transition-all duration-200"
            style={{
              width: '100%',
              color: 'var(--fm-text-secondary)',
              borderColor: 'var(--fm-panel-border)',
              backgroundColor: 'var(--fm-panel-bg)',
            }}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* GATE / PULSE / DRONE — vertical stack */}
          <div
            className="flex flex-col font-mono tracking-wider rounded overflow-hidden border backdrop-blur-sm transition-all duration-200"
            style={{
              width: '100%',
              borderColor: 'var(--fm-panel-border)',
              borderRadius: '4px',
              backgroundColor: 'var(--fm-panel-bg)',
            }}
          >
            {modeOptions.map(mode => (
              <button
                key={mode}
                onClick={() => handlePlayModeChange(mode)}
                className="flex items-center justify-center py-1 transition-all duration-200"
                style={{
                  fontSize: '9px',
                  color: playMode === mode ? 'var(--fm-accent)' : 'var(--fm-text-secondary)',
                  backgroundColor: playMode === mode ? 'var(--fm-btn-bg-active)' : 'transparent',
                }}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Clear button */}
          <button
            onClick={handleClear}
            className="h-10 flex items-center justify-center backdrop-blur-sm border rounded transition-all duration-200"
            style={{ width: '100%', color: 'var(--fm-text-secondary)', borderColor: 'var(--fm-panel-border)', backgroundColor: 'var(--fm-panel-bg)' }}
            aria-label="Clear all strokes"
            title="Clear all"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Performance mode restore button (always visible) */}
      {performanceMode && (
        <button
          onClick={() => setPerformanceMode(false)}
          className="fixed top-4 left-4 w-10 h-10 flex items-center justify-center backdrop-blur-sm border rounded transition-all duration-200 z-30"
          style={{ color: 'var(--fm-accent)', borderColor: 'var(--fm-btn-border-active)', backgroundColor: 'var(--fm-panel-bg)' }}
          aria-label="Show panels"
          title="Show panels"
        >
          <Eye size={16} />
        </button>
      )}

      {/* Stroke counter */}
      {activeCount > 0 && (
        <div className="absolute top-5 right-[260px] font-mono opacity-65 pointer-events-none tracking-wider z-20"
          style={{ fontSize: '10px', color: 'var(--fm-accent)' }}>
          {activeCount.toString().padStart(2, '0')}/16
        </div>
      )}
      {activeCount > 0 && (
        <div className="absolute top-5 right-[310px] flex items-center gap-2 pointer-events-none z-20">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--fm-accent)' }} />
        </div>
      )}

      {/* Oscilloscope — centered, same width as flavor selector */}
      <div
        className="z-20 transition-opacity duration-200"
        style={{
          position: 'absolute',
          top: '16px',
          left: '50%',
          transform: `translateX(calc(-50% + ${(LEFT_STRIP_WIDTH + 16 - FX_PANEL_WIDTH) / 2}px))`,
          width: `${FLAVOR_BAR_WIDTH}px`,
          opacity: performanceMode ? 0 : 1,
          pointerEvents: performanceMode ? 'none' : 'auto',
        }}
      >
        <WaveformVisualizer
          audioEngine={audioEngineRef.current}
        />
      </div>

      {/* Flavor selector */}
      <div className="transition-opacity duration-200"
        style={{ opacity: performanceMode ? 0 : 1, pointerEvents: performanceMode ? 'none' : 'auto' }}>
        <FlavorSelector
          activeFlavor={activeFlavor}
          onSelectFlavor={setActiveFlavor}
          flavorVolumes={flavorVolumes}
          onFlavorVolumeChange={(flavor, value) => {
            audioEngineRef.current.setFlavorVolume(flavor, value);
            setFlavorVolumes(audioEngineRef.current.getFlavorVolumes());
          }}
          isDark={isDark}
        />
      </div>

      {/* Sound Sculptor Panel */}
      <div className="transition-opacity duration-200"
        style={{ opacity: performanceMode ? 0 : 1, pointerEvents: performanceMode ? 'none' : 'auto' }}>
        <ModulatorPanel modulators={modulators} onUpdate={handleModulatorUpdate} playMode={playMode} />
      </div>

      {/* ═══ Root change radial pulse ═══ */}
      {rootPulse && (
        <div
          className="fixed inset-0 pointer-events-none flex items-center justify-center"
          style={{ zIndex: 15 }}
        >
          <div
            style={{
              width: 0,
              height: 0,
              borderRadius: '50%',
              background: `radial-gradient(circle, rgba(var(--fm-accent-rgb),0.15) 0%, transparent 70%)`,
              transform: `translateX(${(LEFT_STRIP_WIDTH + 16 - FX_PANEL_WIDTH) / 2}px)`,
              animation: 'rootPulseAnim 600ms ease-out forwards',
            }}
          />
          <style>{`
            @keyframes rootPulseAnim {
              0% { width: 100px; height: 100px; opacity: 0; }
              50% { opacity: 1; }
              100% { width: 500px; height: 500px; opacity: 0; }
            }
          `}</style>
        </div>
      )}

      {/* ═══ Scale change guide lines ═══ */}
      {guideVisibleNotes.length > 0 && (
        <div
          className="fixed inset-0 pointer-events-none"
          ref={guideContainerRef}
          style={{ opacity: 0, zIndex: 15 }}
        >
          {guideVisibleNotes.map((note, i) => {
            const total = guideVisibleNotes.length;
            const yNorm = total > 1 ? 1 - (i / (total - 1)) : 0.5;
            const yPos = yNorm * window.innerHeight;
            const labelWidth = note.name.length * 5.4 + 8;
            const lineLeft = labelWidth + 12;
            return (
              <div
                key={`${note.name}-${i}`}
                className="absolute left-0 right-0"
                style={{ top: yPos }}
              >
                <div
                  className="absolute right-0"
                  style={{
                    left: `${lineLeft}px`,
                    height: '1px',
                    backgroundColor: 'var(--fm-divider)',
                  }}
                />
                <span
                  className="absolute font-mono select-none"
                  style={{
                    left: '8px',
                    top: '-5px',
                    fontSize: '9px',
                    color: 'var(--fm-text-muted)',
                    lineHeight: 1,
                  }}
                >
                  {note.name}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ BOTTOM-LEFT: Root note + Scale selector ═══ */}
      <div
        className="fixed bottom-6 left-4 z-20 pointer-events-auto transition-opacity duration-200"
        style={{
          opacity: performanceMode ? 0 : 1,
          pointerEvents: performanceMode ? 'none' : 'auto',
        }}
      >
        <ScaleSelector
          rootNote={rootNote} scaleType={scale}
          onRootChange={handleRootChange} onScaleChange={handleScaleChange}
          stripWidth={LEFT_STRIP_WIDTH}
          octave={octave}
          onOctaveChange={handleOctaveChange}
        />
      </div>

      <CRTEffect isDark={isDark} />
    </div>
  );
}