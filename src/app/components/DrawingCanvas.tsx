// FORMLESS — Drawing Canvas
// 30fps throttled, max 16 simultaneous strokes, unified pointer events
// Real-time sound modulation during drawing, Gate/Pulse/Drone mode
// Left sidebar + right FX panel layout

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AudioEngine, SoundFlavor, PlayMode } from '../utils/audioEngine';
import { StrokeAnalyzer, Point } from '../utils/strokeAnalyzer';
import { WaveformVisualizer } from './WaveformVisualizer';
import { AmbientGrid } from './AmbientGrid';
import { RadialPulse } from './RadialPulse';
import { FlavorSelector } from './FlavorSelector';
import { ModulatorPanel } from './ModulatorPanel';
import { RootNote, ScaleType, getRootFrequency, getScaleIntervals, buildScaleTable, mapYToScaleFreq, type ScaleNote } from './ScaleSelector';
import { CRTEffect } from './CRTEffect';
import { FLAVOR_COLORS } from '../utils/flavorColors';
import { FLAVOR_COLORS_LIGHT } from '../utils/flavorColors';
import { Eye, Sun, Moon, Circle, ZapIcon, Waves, Sparkles, Wind, Hexagon, Disc, Diamond, Trash2 } from 'lucide-react';
import { useTheme } from './ThemeContext';
import { RecordButton } from './RecordButton';
import { LeftSidebar } from './LeftSidebar';
import { drawStroke as drawStrokeExternal } from '../utils/strokeRenderers';

// ─── WAV converter ───
async function webmBlobToWav(webmBlob: Blob): Promise<Blob> {
  const arrayBuffer = await webmBlob.arrayBuffer();
  const offlineCtx = new OfflineAudioContext(2, 1, 44100);
  const decoded = await offlineCtx.decodeAudioData(arrayBuffer);

  const numChannels = decoded.numberOfChannels;
  const sampleRate = decoded.sampleRate;
  const length = decoded.length;

  const offline = new OfflineAudioContext(numChannels, length, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();

  const numSamples = rendered.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, rendered.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

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

const LEFT_SIDEBAR_WIDTH = 220;
const FX_PANEL_WIDTH = 224;
const FLAVOR_BAR_WIDTH = 420;

// ── Smooth curve helper — Catmull-Rom spline through points ──
const smoothCurvePath = (ctx: CanvasRenderingContext2D, points: Point[], tension: number = 0.3) => {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
};

// Smooth offset curve (for 3D shadows/ribbons)
const smoothCurvePathOffset = (ctx: CanvasRenderingContext2D, points: Point[], ox: number, oy: number, tension: number = 0.3) => {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x + ox, points[0].y + oy);
  if (points.length === 2) {
    ctx.lineTo(points[1].x + ox, points[1].y + oy);
    return;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + ox + (p2.x - p0.x) * tension;
    const cp1y = p1.y + oy + (p2.y - p0.y) * tension;
    const cp2x = p2.x + ox - (p3.x - p1.x) * tension;
    const cp2y = p2.y + oy - (p3.y - p1.y) * tension;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x + ox, p2.y + oy);
  }
};

// Breakpoints
const BREAKPOINT_TABLET = 1024;
const BREAKPOINT_MOBILE = 640;

// Multi-touch pointer state
interface PointerState {
  points: Point[];
  liveStrokeId: string;
  accPathLen: number;
}

// Mobile flavor data (icons + labels)
const MOBILE_FLAVORS: Array<{ type: SoundFlavor; icon: (s: number) => React.ReactNode; label: string }> = [
  { type: 'sine', icon: (s) => <Circle size={s} />, label: 'SINE' },
  { type: 'saw', icon: (s) => <ZapIcon size={s} />, label: 'SAW' },
  { type: 'sub', icon: (s) => <Waves size={s} />, label: 'SUB' },
  { type: 'grain', icon: (s) => <Sparkles size={s} />, label: 'GRAIN' },
  { type: 'noise', icon: (s) => <Wind size={s} />, label: 'NOISE' },
  { type: 'metal', icon: (s) => <Hexagon size={s} />, label: 'METAL' },
  { type: 'flutter', icon: (s) => <Disc size={s} />, label: 'FLUTTER' },
  { type: 'crystal', icon: (s) => <Diamond size={s} />, label: 'CRYSTAL' },
];

const SCALE_OPTIONS: ScaleType[] = ['CHROMATIC', 'MINOR', 'MAJOR', 'PENTATONIC', 'DORIAN', 'PHRYGIAN', 'LYDIAN', 'LOCRIAN', 'WHOLE TONE', 'DIMINISHED'];
const ROOT_OPTIONS: RootNote[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OCTAVE_OPTIONS = [1, 2, 3, 4, 5, 6];

const MAX_RECORD_SECONDS = 20;

export function DrawingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioEngineRef = useRef<AudioEngine>(new AudioEngine());
  const activePointersRef = useRef<Map<number, PointerState>>(new Map());
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
  const [playMode, setPlayMode] = useState<PlayMode>('drone');
  const playModeRef = useRef<PlayMode>('drone');
  const [flavorVolumes, setFlavorVolumes] = useState(audioEngineRef.current.getFlavorVolumes());
  const [sculptorOpen, setSculptorOpen] = useState(true);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const undoStackRef = useRef<Stroke[]>([]);
  const redoStackRef = useRef<Stroke[]>([]);
  const [undoRedoVersion, setUndoRedoVersion] = useState(0);

  // Responsive breakpoints
  const [screenWidth, setScreenWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  useEffect(() => {
    const handler = () => setScreenWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  const isDesktop = screenWidth >= BREAKPOINT_TABLET;
  const isTablet = screenWidth >= BREAKPOINT_MOBILE && screenWidth < BREAKPOINT_TABLET;
  const isMobile = screenWidth < BREAKPOINT_MOBILE;
  const isTouch = isTablet || isMobile;

  // Mobile sheets
  const [instSheetOpen, setInstSheetOpen] = useState(false);
  const [fxSheetOpen, setFxSheetOpen] = useState(false);
  const sheetDragRef = useRef<{ startY: number; sheet: 'inst' | 'fx' } | null>(null);

  // Recording
  type RecordState = 'idle' | 'recording' | 'recorded';
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handleRecordStopRef = useRef<() => Promise<void>>(async () => {});

  const handleSheetDragStart = useCallback((e: React.PointerEvent, sheet: 'inst' | 'fx') => {
    sheetDragRef.current = { startY: e.clientY, sheet };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const handleSheetDragMove = useCallback((e: React.PointerEvent) => {
    if (!sheetDragRef.current) return;
    const dy = e.clientY - sheetDragRef.current.startY;
    if (dy > 60) {
      if (sheetDragRef.current.sheet === 'inst') setInstSheetOpen(false);
      else setFxSheetOpen(false);
      sheetDragRef.current = null;
    }
  }, []);
  const handleSheetDragEnd = useCallback(() => {
    sheetDragRef.current = null;
  }, []);

  const [octave, setOctave] = useState(3);
  const octaveRef = useRef(3);

  const scaleTableRef = useRef<ScaleNote[]>(buildScaleTable('C', 'MAJOR', 3));
  const [guideVisibleNotes, setGuideVisibleNotes] = useState<ScaleNote[]>([]);
  const guideStartRef = useRef<number | null>(null);
  const guideAnimRef = useRef<number>(0);
  const guideContainerRef = useRef<HTMLDivElement>(null);
  const triggerGuideLinesRef = useRef<(table: ScaleNote[], scaleType: ScaleType) => void>(() => {});
  const [rootPulse, setRootPulse] = useState<{ startTime: number } | null>(null);

  const isDarkRef = useRef(true);
  const { isDark, toggle: toggleTheme } = useTheme();
  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);
  const colorMap = isDark ? FLAVOR_COLORS : FLAVOR_COLORS_LIGHT;
  const flavorColor = colorMap[activeFlavor];

  useEffect(() => { activeFlavorRef.current = activeFlavor; }, [activeFlavor]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { rootNoteRef.current = rootNote; }, [rootNote]);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);
  useEffect(() => { octaveRef.current = octave; }, [octave]);

  useEffect(() => {
    audioEngineRef.current.initialize();
    audioEngineRef.current.setPlayMode(playMode); // sync initial mode — fixes drone not locking on first load
    const table = buildScaleTable('C', 'MAJOR', 3);
    scaleTableRef.current = table;
    audioEngineRef.current.setScaleTable(table);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        audioEngineRef.current.resume().catch(() => {});
        if (activePointersRef.current.size > 0) {
          activePointersRef.current.forEach((ps) => {
            audioEngineRef.current.finalizeLiveStroke(ps.liveStrokeId, false);
          });
          activePointersRef.current.clear();
          currentStrokeRef.current = [];
          setCurrentStrokeForUI([]);
          setCurrentPitch(null);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const handleRootChange = useCallback((note: RootNote) => {
    const prevRoot = rootNoteRef.current;
    setRootNote(note);
    rootNoteRef.current = note;
    audioEngineRef.current.setRootFrequency(getRootFrequency(note, octaveRef.current));
    const table = buildScaleTable(note, scaleRef.current, octaveRef.current);
    scaleTableRef.current = table;
    audioEngineRef.current.setScaleTable(table);
    audioEngineRef.current.retuneActiveStrokes();
    if (prevRoot !== note) {
      setRootPulse({ startTime: Date.now() });
      setTimeout(() => setRootPulse(null), 650);
    }
    triggerGuideLinesRef.current(table, scaleRef.current);
  }, []);

  const GUIDE_FADE_IN = 400;
  const GUIDE_HOLD = 2500;
  const GUIDE_FADE_OUT = 800;
  const GUIDE_TOTAL = GUIDE_FADE_IN + GUIDE_HOLD + GUIDE_FADE_OUT;
  const NATURAL_NOTES = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

  const filterGuideNotes = useCallback((table: ScaleNote[], scaleType: ScaleType): ScaleNote[] => {
    if (scaleType === 'CHROMATIC') {
      return table.filter(n => {
        const noteName = n.name.replace(/\d+$/, '');
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
      opacity = elapsed / GUIDE_FADE_IN;
    } else if (elapsed < GUIDE_FADE_IN + GUIDE_HOLD) {
      opacity = 1;
    } else if (elapsed < GUIDE_TOTAL) {
      opacity = 1 - (elapsed - GUIDE_FADE_IN - GUIDE_HOLD) / GUIDE_FADE_OUT;
    } else {
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
    if (guideAnimRef.current) cancelAnimationFrame(guideAnimRef.current);
    const filtered = filterGuideNotes(table, scaleType);
    setGuideVisibleNotes(filtered);
    guideStartRef.current = Date.now();
    guideAnimRef.current = requestAnimationFrame(updateGuideLines);
  }, [filterGuideNotes, updateGuideLines]);

  triggerGuideLinesRef.current = triggerGuideLines;

  useEffect(() => {
    return () => { if (guideAnimRef.current) cancelAnimationFrame(guideAnimRef.current); };
  }, []);

  const handleScaleChange = useCallback((newScale: ScaleType) => {
    setScale(newScale);
    scaleRef.current = newScale;
    const table = buildScaleTable(rootNoteRef.current, newScale, octaveRef.current);
    scaleTableRef.current = table;
    audioEngineRef.current.setScaleTable(table);
    audioEngineRef.current.retuneActiveStrokes();
    triggerGuideLinesRef.current(table, newScale);
  }, []);

  const handleOctaveChange = useCallback((newOctave: number) => {
    const oldOctave = octaveRef.current;
    setOctave(newOctave);
    octaveRef.current = newOctave;
    audioEngineRef.current.setRootFrequency(getRootFrequency(rootNoteRef.current, newOctave));
    const table = buildScaleTable(rootNoteRef.current, scaleRef.current, newOctave);
    scaleTableRef.current = table;
    audioEngineRef.current.setScaleTable(table);
    audioEngineRef.current.retuneForOctaveChange(oldOctave, newOctave);
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
    audioEngineRef.current.setPlayMode(mode);
    setStrokes(prev => prev.map(s => ({
      ...s, locked: false, isPulse: false, fadeOutStart: Date.now(),
    })));
    setPulses([]);
  }, []);

  const handlePointerDown = useCallback(async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointersRef.current.size >= 3) return;
    await audioEngineRef.current.resume();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const now = Date.now();
    const isNoiseFlavor = activeFlavorRef.current === 'noise';
    const scaleNote = mapYToScaleFreq(y, canvas.height, scaleTableRef.current);
    const freq = isNoiseFlavor ? 440 : scaleNote.freq;
    if (!isNoiseFlavor) setCurrentPitch(scaleNote.name);
    const liveId = `live_${now}_${Math.random().toString(36).slice(2, 6)}`;
    const panX = x / canvas.width;
    const evictedId = audioEngineRef.current.startLiveStroke(liveId, freq, activeFlavorRef.current, panX, y);
    if (evictedId) setStrokes(prev => prev.filter(s => s.id !== evictedId));
    activePointersRef.current.set(e.pointerId, {
      points: [{ x, y, time: now }],
      liveStrokeId: liveId,
      accPathLen: 0,
    });
    currentStrokeRef.current = [{ x, y, time: now }];
    setCurrentStrokeForUI([{ x, y, time: now }]);
  }, []);

  const handleCanvasPointerDownMobile = useCallback(async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (instSheetOpen || fxSheetOpen) {
      setInstSheetOpen(false);
      setFxSheetOpen(false);
      return;
    }
    return handlePointerDown(e);
  }, [instSheetOpen, fxSheetOpen, handlePointerDown]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const ps = activePointersRef.current.get(e.pointerId);
    if (!ps) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const now = Date.now();
    const point: Point = { x, y, time: now };
    ps.points.push(point);
    const firstPid = activePointersRef.current.keys().next().value;
    if (firstPid === e.pointerId) {
      currentStrokeRef.current = [...ps.points];
      setCurrentStrokeForUI([...ps.points]);
    }
    const isNoiseFlavor = activeFlavorRef.current === 'noise';
    const scaleNote = mapYToScaleFreq(y, canvas.height, scaleTableRef.current);
    const freq = isNoiseFlavor ? 440 : scaleNote.freq;
    if (!isNoiseFlavor) setCurrentPitch(scaleNote.name);
    if (ps.points.length >= 2) {
      const prev = ps.points[ps.points.length - 2];
      const dx = x - prev.x;
      const dy = y - prev.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      ps.accPathLen += segLen;
      const dt = (now - prev.time) / 1000 || 0.016;
      const hVelocity = Math.abs(dx) / dt;
      const pointerVelocity = segLen / dt;
      const dirChange = detectDirectionChange(ps.points);
      let freqTarget: number | undefined;
      if (dirChange !== 0) freqTarget = getNextScaleDegree(freq, dirChange);
      audioEngineRef.current.modulateLiveStroke(ps.liveStrokeId, {
        hVelocity,
        accLength: ps.accPathLen,
        pointerVelocity,
        directionChange: dirChange !== 0,
        freqTarget,
      });
    }
  }, []);

  const finalizeStroke = useCallback((pointerId: number) => {
    const ps = activePointersRef.current.get(pointerId);
    if (!ps) return;
    activePointersRef.current.delete(pointerId);
    if (activePointersRef.current.size === 0) {
      setCurrentPitch(null);
      currentStrokeRef.current = [];
      setCurrentStrokeForUI([]);
    }
    const points = ps.points;
    if (points.length < 2) {
      audioEngineRef.current.finalizeLiveStroke(ps.liveStrokeId, false);
      return;
    }
    const analyzed = StrokeAnalyzer.analyze(points);
    const flavor = activeFlavorRef.current;
    const color = (isDarkRef.current ? FLAVOR_COLORS : FLAVOR_COLORS_LIGHT)[flavor];
    const mode = playModeRef.current;
    const isLocked = mode === 'drone' || mode === 'pulse';
    const isPulse = mode === 'pulse';
    audioEngineRef.current.finalizeLiveStroke(ps.liveStrokeId, isLocked);
    setPulses(prev => [...prev, {
      x: analyzed.startPoint.x, y: analyzed.startPoint.y,
      startTime: Date.now(), duration: 800,
    }]);
    const normalized = Math.min(analyzed.length / 800, 1);
    const duration = isLocked ? Infinity : (4 + normalized * 4) * 1000;
    redoStackRef.current = [];
    setUndoRedoVersion(v => v + 1);
    setStrokes(prev => [...prev, {
      id: ps.liveStrokeId, points, color, startTime: Date.now(), duration,
      avgY: analyzed.avgY, flavor, locked: isLocked, muted: false, isPulse,
    }]);
  }, []);

  const handlePointerFinish = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    finalizeStroke(e.pointerId);
  }, [finalizeStroke]);

  const handleClear = useCallback(() => {
    setShowScanlineGlitch(true);
    setTimeout(() => setShowScanlineGlitch(false), 350);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoRedoVersion(v => v + 1);
    setStrokes([]);
    setPulses([]);
    audioEngineRef.current.clearAll();
  }, []);

  const handleUndo = useCallback(() => {
    setStrokes(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      redoStackRef.current = [...redoStackRef.current, last];
      setUndoRedoVersion(v => v + 1);
      audioEngineRef.current.releaseStroke(last.id, 0.08);
      return prev.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const stroke = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, stroke];
    setUndoRedoVersion(v => v + 1);
    const newId = stroke.id + '_redo_' + Date.now();
    const restoredStroke: Stroke = { ...stroke, id: newId, startTime: Date.now(), fadeOutStart: undefined, locked: true, duration: Infinity };
    setStrokes(prev => [...prev, restoredStroke]);
    // Re-play audio for the restored stroke
    const analyzed = StrokeAnalyzer.analyze(stroke.points);
    const h = typeof window !== 'undefined' ? window.innerHeight : 900;
    const freq = mapYToScaleFreq(analyzed.avgY, h, scaleTableRef.current).freq;
    audioEngineRef.current.playStroke(
      { points: stroke.points, speed: analyzed.speed, avgY: analyzed.avgY, length: analyzed.length, curvature: analyzed.curvature, startPoint: analyzed.startPoint, flavor: stroke.flavor },
      newId, true, freq
    );
  }, []);

  // ─── Recording handlers ───
  const handleRecordStop = useCallback(async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try {
      const webmBlob = await audioEngineRef.current.stopRecording();
      const wavBlob = await webmBlobToWav(webmBlob);
      setRecordedBlob(wavBlob);
      setRecordState('recorded');
    } catch (err) {
      console.error('[FORMLESS] Recording stop failed:', err);
      setRecordState('idle');
    }
  }, []);

  // Keep ref in sync so setInterval closure never goes stale
  useEffect(() => {
    handleRecordStopRef.current = handleRecordStop;
  }, [handleRecordStop]);

  const handleRecordStart = useCallback(async () => {
    if (playModeRef.current === 'gate') return;

    // Set state FIRST so button updates immediately
    setRecordState('recording');
    setRecordSeconds(0);
    setRecordedBlob(null);

    try {
      await audioEngineRef.current.resume();
      audioEngineRef.current.startRecording();
    } catch (err) {
      console.error('[FORMLESS] Could not start recording:', err);
      setRecordState('idle');
      return;
    }

    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    recordTimerRef.current = setInterval(() => {
      setRecordSeconds(prev => {
        const next = prev + 1;
        if (next >= MAX_RECORD_SECONDS) {
          handleRecordStopRef.current();
        }
        return next;
      });
    }, 1000);
  }, []);

  const handleRecordDownload = useCallback(() => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `formless_${Date.now()}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setRecordedBlob(null);
    setRecordState('idle');
    setRecordSeconds(0);
  }, [recordedBlob]);

  const handleRecordClear = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (audioEngineRef.current.isRecording()) {
      audioEngineRef.current.stopRecording().catch(() => {});
    }
    setRecordedBlob(null);
    setRecordState('idle');
    setRecordSeconds(0);
  }, []);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (audioEngineRef.current.isRecording()) audioEngineRef.current.stopRecording();
    };
  }, []);

  useEffect(() => {
    if (playMode === 'gate' && recordState !== 'idle') {
      if (recordState === 'recording') {
        handleRecordStop();
      } else {
        handleRecordClear();
      }
    }
  }, [playMode]);

  // ── ASCII dither field helper ──
  // Renders a grid of density-mapped ASCII glyphs around the stroke path
  const DITHER_CHARS = '.:-=+*#%@';
  const DITHER_CELL = 12;
  const DITHER_RADIUS = 48;

  const drawAsciiDither = (
    ctx: CanvasRenderingContext2D, points: Point[], color: string,
    alpha: number, radius: number = DITHER_RADIUS, animated: boolean = false, t: number = 0
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
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;

    const step = Math.max(1, Math.floor(points.length / 60));
    const sub: Point[] = [];
    for (let i = 0; i < points.length; i += step) sub.push(points[i]);
    sub.push(points[points.length - 1]);

    for (let gy = gy0; gy <= gy1; gy += DITHER_CELL) {
      for (let gx = gx0; gx <= gx1; gx += DITHER_CELL) {
        const cx = gx + DITHER_CELL / 2;
        const cy = gy + DITHER_CELL / 2;
        let minDist = Infinity;
        for (const p of sub) {
          const dx = cx - p.x, dy = cy - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < minDist) minDist = d;
        }
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

  // DRAWING — 4-category stroke rendering (delegated to strokeRenderers.ts)
  const drawStroke = (
    ctx: CanvasRenderingContext2D, points: Point[], color: string,
    opacity: number, flavor: SoundFlavor, locked: boolean, muted: boolean
  ) => {
    drawStrokeExternal(ctx, points, color, opacity, flavor, locked, muted, isDarkRef.current);
  };

  /* Old inline stroke renderers removed — now in /src/app/utils/strokeRenderers.ts */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  void smoothCurvePath; void smoothCurvePathOffset; // keep used by drawStrokeWithCA
  /* eslint-enable */

  /* Old renderers purged — see git history or strokeRenderers.ts for new implementations */
  if (false as boolean) { // dead-code fence to prevent stale references from old renderers below
    switch ('sine' as SoundFlavor) { case 'sine': {
        ctx.save();
        const darkSine = isDarkRef.current;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (darkSine) {
          // Dark mode: full shadow-based bloom
          ctx.save(); ctx.shadowBlur = 32; ctx.shadowColor = color;
          ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.globalAlpha = a * 0.06;
          poly(); ctx.stroke(); ctx.restore();
          ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = color;
          ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.globalAlpha = a * 0.2;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          poly(); ctx.stroke(); ctx.restore();
        } else {
          // Light mode: lightweight bloom layers — no shadowBlur
          ctx.save();
          ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.globalAlpha = a * 0.08;
          poly(); ctx.stroke(); ctx.restore();
          ctx.save();
          ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.globalAlpha = a * 0.2;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          poly(); ctx.stroke(); ctx.restore();
        }
        ctx.save();
        if (darkSine) { ctx.shadowBlur = 6; ctx.shadowColor = color; }
        ctx.lineWidth = 1.5; ctx.globalAlpha = a * 0.9;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const last = points[points.length - 1];
        const grad = ctx.createLinearGradient(points[0].x, points[0].y, last.x, last.y);
        if (darkSine) {
          grad.addColorStop(0, color); grad.addColorStop(0.35, '#FFFFFFCC');
          grad.addColorStop(0.65, '#FFFFFFCC'); grad.addColorStop(1, color);
        } else {
          grad.addColorStop(0, color); grad.addColorStop(0.5, color);
          grad.addColorStop(1, color);
        }
        ctx.strokeStyle = grad;
        poly(); ctx.stroke(); ctx.restore();
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const d of [5, -5, 10, -10]) {
          ctx.strokeStyle = color; ctx.lineWidth = 0.6;
          ctx.globalAlpha = a * Math.max(0.02, 0.08 - Math.abs(d) * 0.004);
          ctx.beginPath();
          for (let i = 0; i < points.length; i++) {
            const t = i / (points.length - 1);
            const w = Math.sin(t * Math.PI * 3 + now * 0.0015) * d;
            const i0 = Math.max(0, i-1), i1 = Math.min(points.length-1, i+1);
            const ddx = points[i1].x - points[i0].x, ddy = points[i1].y - points[i0].y;
            const dl = Math.sqrt(ddx*ddx + ddy*ddy) || 1;
            const px = points[i].x + (-ddy/dl)*w, py = points[i].y + (ddx/dl)*w;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        ctx.restore();
        ctx.restore(); // outer sine save
        break;
      }

      // ═══ GLOW: SUB — 3D ribbon with depth + atmospheric bloom ═══
      case 'sub': {
        ctx.save();
        const p = 0.7 + 0.3 * Math.sin(now * 0.002);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const darkMode = isDarkRef.current;
        // 3D depth shadow — offset copy creates ribbon illusion (deeper)
        const depthOff = 8;
        const depthOff2 = 4;
        // Far shadow layer
        ctx.save();
        if (darkMode) { ctx.shadowBlur = 24; ctx.shadowColor = 'rgba(0,0,0,0.35)'; }
        ctx.strokeStyle = darkMode ? 'rgba(60,15,100,0.25)' : 'rgba(100,30,160,0.18)';
        ctx.lineWidth = darkMode ? 8 : 6; ctx.globalAlpha = a * 0.18 * p;
        smoothCurvePathOffset(ctx, points, depthOff, depthOff);
        ctx.stroke(); ctx.restore();
        // Mid shadow layer
        ctx.save();
        if (darkMode) { ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(0,0,0,0.2)'; }
        ctx.strokeStyle = darkMode ? 'rgba(80,20,120,0.3)' : 'rgba(120,40,180,0.22)';
        ctx.lineWidth = 5; ctx.globalAlpha = a * 0.22 * p;
        smoothCurvePathOffset(ctx, points, depthOff2, depthOff2);
        ctx.stroke(); ctx.restore();
        // 3D connecting lines between front and back layers
        ctx.save();
        let accD = 0;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i-1].x, dy = points[i].y - points[i-1].y;
          accD += Math.sqrt(dx*dx + dy*dy);
          if (accD >= 32) {
            accD -= 32;
            ctx.strokeStyle = color; ctx.lineWidth = 0.5;
            ctx.globalAlpha = a * 0.08 * p;
            ctx.beginPath();
            ctx.moveTo(points[i].x, points[i].y);
            ctx.lineTo(points[i].x + depthOff, points[i].y + depthOff);
            ctx.stroke();
          }
        }
        ctx.restore();
        if (darkMode) {
          // Wide atmospheric bloom — dark mode only (heavy shadowBlur)
          ctx.save(); ctx.shadowBlur = 60; ctx.shadowColor = color;
          ctx.strokeStyle = color; ctx.lineWidth = 18; ctx.globalAlpha = a * 0.035 * p;
          poly(); ctx.stroke(); ctx.restore();
          // Mid bloom — dark mode only
          ctx.save(); ctx.shadowBlur = 24; ctx.shadowColor = color;
          ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.globalAlpha = a * 0.1 * p;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          poly(); ctx.stroke(); ctx.restore();
          // Inner glow — dark mode only
          ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = color;
          ctx.strokeStyle = color; ctx.lineWidth = 2.8; ctx.globalAlpha = a * 0.4 * p;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          poly(); ctx.stroke(); ctx.restore();
        } else {
          // Light mode: lightweight bloom substitute — no shadowBlur
          ctx.save();
          ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.globalAlpha = a * 0.10 * p;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          poly(); ctx.stroke(); ctx.restore();
          ctx.save();
          ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.globalAlpha = a * 0.35 * p;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          poly(); ctx.stroke(); ctx.restore();
        }
        // Hot core gradient
        ctx.save();
        if (darkMode) { ctx.shadowBlur = 4; ctx.shadowColor = '#FFFFFF'; }
        ctx.lineWidth = 1.2; ctx.globalAlpha = a * 0.85;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const last2 = points[points.length - 1];
        const g = ctx.createLinearGradient(points[0].x, points[0].y, last2.x, last2.y);
        if (darkMode) {
          g.addColorStop(0, color); g.addColorStop(0.25, '#FFFFFFBB');
          g.addColorStop(0.5, color); g.addColorStop(0.75, '#FFFFFFBB');
          g.addColorStop(1, color);
        } else {
          g.addColorStop(0, color); g.addColorStop(0.3, color);
          g.addColorStop(0.5, '#44006680'); g.addColorStop(0.7, color);
          g.addColorStop(1, color);
        }
        ctx.strokeStyle = g;
        poly(); ctx.stroke(); ctx.restore();
        // Radial glow orbs
        ctx.save();
        let accS = 0;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i-1].x, dy = points[i].y - points[i-1].y;
          accS += Math.sqrt(dx*dx + dy*dy);
          if (accS >= 28) {
            accS -= 28;
            const br = 0.3 + 0.7 * Math.abs(Math.sin(now * 0.003 + i * 1.1));
            if (darkMode) {
              const rg = ctx.createRadialGradient(points[i].x, points[i].y, 0, points[i].x, points[i].y, 10);
              rg.addColorStop(0, `rgba(255,255,255,${0.45 * br * p})`);
              rg.addColorStop(0.4, color + '50');
              rg.addColorStop(1, 'transparent');
              ctx.globalAlpha = a * 0.55;
              ctx.fillStyle = rg;
              ctx.fillRect(points[i].x - 10, points[i].y - 10, 20, 20);
            } else {
              // Light mode: simple dots instead of radial gradients
              ctx.globalAlpha = a * 0.4 * br * p;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(points[i].x, points[i].y, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        ctx.restore();
        ctx.restore(); // outer save
        break;
      }

      // ═══════════════════════════════════════════════
      // GEOMETRIC (SAW + CRYSTAL) — clean Swiss/Bauhaus
      // ═══════════════════════════════════════════════

      // ═══ GEOMETRIC: SAW — 3D node-graph network ═══
      case 'saw': {
        ctx.save();
        ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        // Shadow staircase (depth offset — deeper)
        const sawD = 5;
        ctx.strokeStyle = isDarkRef.current ? 'rgba(200,100,20,0.12)' : 'rgba(200,100,20,0.06)';
        ctx.lineWidth = 2; ctx.globalAlpha = a * 0.3;
        ctx.beginPath(); ctx.moveTo(points[0].x + sawD, points[0].y + sawD);
        for (let i = 1; i < points.length; i++) {
          if (i % 2 === 0) { ctx.lineTo(points[i].x + sawD, points[i-1].y + sawD); ctx.lineTo(points[i].x + sawD, points[i].y + sawD); }
          else { ctx.lineTo(points[i-1].x + sawD, points[i].y + sawD); ctx.lineTo(points[i].x + sawD, points[i].y + sawD); }
        }
        ctx.stroke();
        // Ghost guide line
        ctx.strokeStyle = color; ctx.lineWidth = 0.8;
        ctx.globalAlpha = a * 0.15;
        poly(); ctx.stroke();
        // Main staircase
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        ctx.globalAlpha = a * 0.8;
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          if (i % 2 === 0) { ctx.lineTo(points[i].x, points[i-1].y); ctx.lineTo(points[i].x, points[i].y); }
          else { ctx.lineTo(points[i-1].x, points[i].y); ctx.lineTo(points[i].x, points[i].y); }
        }
        ctx.stroke();
        // Nodes with 3D shadow
        let accSaw = 0;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i-1].x, dy = points[i].y - points[i-1].y;
          accSaw += Math.sqrt(dx*dx + dy*dy);
          if (accSaw >= 22) {
            accSaw -= 22;
            const r = 3 + (i % 3);
            // Shadow circle
            ctx.fillStyle = isDarkRef.current ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)';
            ctx.globalAlpha = a * 0.5;
            ctx.beginPath(); ctx.arc(points[i].x + 2, points[i].y + 2, r, 0, Math.PI * 2); ctx.fill();
            // Main circle
            ctx.fillStyle = color; ctx.globalAlpha = a * 0.85;
            ctx.beginPath(); ctx.arc(points[i].x, points[i].y, r, 0, Math.PI * 2); ctx.fill();
            // Highlight dot
            ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = a * 0.6;
            ctx.beginPath(); ctx.arc(points[i].x - 1, points[i].y - 1, 1.2, 0, Math.PI * 2); ctx.fill();
          }
        }
        // Endpoints
        ctx.fillStyle = isDarkRef.current ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)';
        ctx.globalAlpha = a * 0.5;
        ctx.beginPath(); ctx.arc(points[0].x + 2, points[0].y + 2, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(points[0].x, points[0].y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = isDarkRef.current ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)';
        ctx.globalAlpha = a * 0.5;
        ctx.beginPath(); ctx.arc(points[points.length-1].x + 2, points[points.length-1].y + 2, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(points[points.length-1].x, points[points.length-1].y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }

      // ═══ GEOMETRIC: CRYSTAL — 3D isometric diamonds with enhanced depth ═══
      case 'crystal': {
        ctx.save();
        ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        // Ghost construction line — smooth curve
        ctx.strokeStyle = color; ctx.lineWidth = 0.5;
        ctx.globalAlpha = a * 0.12;
        poly(); ctx.stroke();
        // 3D isometric diamonds with deeper depth
        const dz = 6; // depth offset for 3D
        const dz2 = 3; // secondary depth layer
        let pl = 0, lastD = 0;
        let prev: {x:number;y:number}|null = null;
        for (let i = 1; i < points.length; i++) {
          pl += Math.sqrt((points[i].x-points[i-1].x)**2 + (points[i].y-points[i-1].y)**2);
          if (pl - lastD >= 22) {
            lastD = pl;
            const cx2 = points[i].x, cy2 = points[i].y;
            const sz = 5 + (i % 3) * 2.5;
            // Smooth connector curve between diamonds
            if (prev) {
              ctx.strokeStyle = color; ctx.lineWidth = 0.5;
              ctx.globalAlpha = a * 0.08;
              const mx = (prev.x + cx2) / 2, my = (prev.y + cy2) / 2 - 6;
              ctx.beginPath(); ctx.moveTo(prev.x, prev.y);
              ctx.quadraticCurveTo(mx, my, cx2, cy2); ctx.stroke();
            }
            // Deep shadow layer (furthest back)
            ctx.strokeStyle = isDarkRef.current ? 'rgba(100,200,250,0.08)' : 'rgba(50,100,200,0.04)';
            ctx.lineWidth = 0.6; ctx.globalAlpha = a * 0.1;
            ctx.beginPath();
            ctx.moveTo(cx2 + dz, cy2 - sz + dz); ctx.lineTo(cx2 + sz + dz, cy2 + dz);
            ctx.lineTo(cx2 + dz, cy2 + sz + dz); ctx.lineTo(cx2 - sz + dz, cy2 + dz);
            ctx.closePath(); ctx.stroke();
            // Fill back face with subtle tint
            ctx.fillStyle = isDarkRef.current ? 'rgba(100,230,250,0.03)' : 'rgba(50,150,200,0.02)';
            ctx.globalAlpha = a * 0.15;
            ctx.fill();
            // Mid-depth layer
            ctx.strokeStyle = color; ctx.lineWidth = 0.6;
            ctx.globalAlpha = a * 0.12;
            ctx.beginPath();
            ctx.moveTo(cx2 + dz2, cy2 - sz + dz2); ctx.lineTo(cx2 + sz + dz2, cy2 + dz2);
            ctx.lineTo(cx2 + dz2, cy2 + sz + dz2); ctx.lineTo(cx2 - sz + dz2, cy2 + dz2);
            ctx.closePath(); ctx.stroke();
            // 3D connecting edges (front to back)
            ctx.lineWidth = 0.4; ctx.globalAlpha = a * 0.1;
            ctx.strokeStyle = color;
            for (const [vx,vy] of [[cx2,cy2-sz],[cx2+sz,cy2],[cx2,cy2+sz],[cx2-sz,cy2]] as [number,number][]) {
              ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(vx + dz, vy + dz); ctx.stroke();
            }
            // Front face — bright
            ctx.strokeStyle = color; ctx.lineWidth = 1.2;
            ctx.globalAlpha = a * 0.7;
            ctx.beginPath();
            ctx.moveTo(cx2, cy2 - sz); ctx.lineTo(cx2 + sz, cy2);
            ctx.lineTo(cx2, cy2 + sz); ctx.lineTo(cx2 - sz, cy2);
            ctx.closePath(); ctx.stroke();
            // Front face subtle fill
            ctx.fillStyle = color; ctx.globalAlpha = a * 0.04;
            ctx.fill();
            // Vertex dots
            ctx.fillStyle = color; ctx.globalAlpha = a * 0.55;
            for (const [vx,vy] of [[cx2,cy2-sz],[cx2+sz,cy2],[cx2,cy2+sz],[cx2-sz,cy2]] as [number,number][]) {
              ctx.beginPath(); ctx.arc(vx, vy, 1.4, 0, Math.PI * 2); ctx.fill();
            }
            // Center crosshair
            ctx.strokeStyle = color; ctx.lineWidth = 0.5; ctx.globalAlpha = a * 0.18;
            ctx.beginPath(); ctx.moveTo(cx2-3,cy2); ctx.lineTo(cx2+3,cy2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx2,cy2-3); ctx.lineTo(cx2,cy2+3); ctx.stroke();
            prev = {x:cx2, y:cy2};
          }
        }
        ctx.restore();
        break;
      }

      // ═══════════════════════════════════════════════
      // ASCII DITHER (GRAIN + NOISE) — typographic texture
      // ═══════════════════════════════════════════════

      // ═══ DITHER: GRAIN — ASCII density field ═══
      case 'grain': {
        ctx.save();
        ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        ctx.strokeStyle = color; ctx.lineWidth = 0.5;
        ctx.globalAlpha = a * 0.15;
        poly(); ctx.stroke();
        drawAsciiDither(ctx, points, color, a * 0.75, 32, false, 0);
        ctx.font = "11px 'JetBrains Mono', monospace";
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.fillStyle = color;
        let accG = 0;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i-1].x, dy = points[i].y - points[i-1].y;
          accG += Math.sqrt(dx*dx + dy*dy);
          if (accG >= 16) {
            accG -= 16;
            const ch = DITHER_CHARS[5 + Math.floor(Math.random() * 4)];
            ctx.globalAlpha = a * (0.45 + Math.random() * 0.35);
            ctx.fillText(ch, points[i].x, points[i].y);
          }
        }
        ctx.restore();
        break;
      }

      // ═══ DITHER: NOISE — interference scan field ═══
      case 'noise': {
        ctx.save();
        ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        const isAnim = locked;
        const ph = isAnim ? now * 0.0006 : 0;
        drawAsciiDither(ctx, points, color, a * 0.5, 40, isAnim, now * 0.001);
        ctx.strokeStyle = color; ctx.lineWidth = 0.8;
        ctx.globalAlpha = a * 0.25;
        poly(); ctx.stroke();
        ctx.lineWidth = 0.8;
        let accN = 0;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i-1].x, dy = points[i].y - points[i-1].y;
          const sl = Math.sqrt(dx*dx + dy*dy);
          accN += sl;
          if (accN >= 7) {
            accN -= 7;
            const len = sl || 1;
            const nx = -dy / len, ny = dx / len;
            const hl = 6 + Math.sin(i * 0.35 + ph) * 10;
            const off = isAnim ? Math.sin(i * 0.4 + ph * 2.5) * 3 : 0;
            ctx.globalAlpha = a * (0.1 + Math.abs(Math.sin(i * 0.25 + ph)) * 0.4);
            ctx.beginPath();
            ctx.moveTo(points[i].x + nx * (hl + off), points[i].y + ny * (hl + off));
            ctx.lineTo(points[i].x - nx * hl, points[i].y - ny * hl);
            ctx.stroke();
          }
        }
        ctx.restore();
        break;
      }

      // ═══════════════════════════════════════════════
      // GLITCH (METAL + FLUTTER) — digital corruption
      // ═══════════════════════════════════════════════

      // ═══ GLITCH: METAL — chromatic aberration + data corruption ═══
      case 'metal': {
        ctx.save();
        ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        const gt = now * 0.001;
        const gi = locked ? (0.65 + 0.35 * Math.sin(gt * 1.9)) : 0.7;
        ctx.save(); ctx.globalAlpha = a * 0.3 * gi;
        ctx.strokeStyle = '#FF4466'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const s = locked ? Math.sin(i * 0.08 + gt * 4) * 2 : -1.5;
          i === 0 ? ctx.moveTo(points[i].x + s - 1, points[i].y - 1) : ctx.lineTo(points[i].x + s - 1, points[i].y - 1);
        }
        ctx.stroke(); ctx.restore();
        ctx.save(); ctx.globalAlpha = a * 0.3 * gi;
        ctx.strokeStyle = '#4488FF'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const s = locked ? Math.sin(i * 0.08 + gt * 4 + 2) * 2 : 1.5;
          i === 0 ? ctx.moveTo(points[i].x + s + 1, points[i].y + 1) : ctx.lineTo(points[i].x + s + 1, points[i].y + 1);
        }
        ctx.stroke(); ctx.restore();
        ctx.save(); ctx.globalAlpha = a * 0.85;
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        poly(); ctx.stroke(); ctx.restore();
        ctx.save();
        let accM = 0;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x-points[i-1].x, dy = points[i].y-points[i-1].y;
          accM += Math.sqrt(dx*dx + dy*dy);
          if (accM >= 22) {
            accM -= 22;
            const tw = 12 + Math.sin(i * 0.5 + gt * 2) * 16;
            const tx = points[i].x + (locked ? Math.sin(i * 0.25 + gt * 5) * 5 : Math.sin(i) * 3);
            ctx.globalAlpha = a * 0.18 * gi;
            ctx.fillStyle = i % 2 === 0 ? '#FF4466' : '#4488FF';
            ctx.fillRect(tx - tw/2, points[i].y - 0.5, tw, 1);
          }
        }
        ctx.restore();
        ctx.save();
        for (let i = 0; i < points.length; i += 10) {
          const f = Math.sin(i * 0.7 + gt * 8);
          if (f > 0.2) {
            ctx.globalAlpha = a * 0.22 * gi;
            ctx.fillStyle = f > 0.6 ? '#FF4466' : '#4488FF';
            ctx.fillRect(points[i].x + Math.sin(i)*6 - 1, points[i].y + Math.cos(i*1.1)*5 - 1, 2, 2);
          }
        }
        ctx.restore();
        ctx.restore(); // outer metal save
        break;
      }

      // ═══ GLITCH: FLUTTER — VHS tracking displacement ═══
      case 'flutter': {
        ctx.save();
        ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        const ft = now * 0.001;
        const sp = Math.sin(ft * 1.5);
        const SL = 16;
        let af = 0, ss = 0;
        const sg: {s:number;e:number;ox:number;oy:number}[] = [];
        for (let i = 1; i < points.length; i++) {
          af += Math.sqrt((points[i].x-points[i-1].x)**2 + (points[i].y-points[i-1].y)**2);
          if (af >= SL || i === points.length-1) {
            const j = locked ? Math.sin(sg.length * 1.8 + ft * 4) * 6 * sp : Math.sin(sg.length * 1.4) * 3.5;
            sg.push({s:ss, e:i, ox:j, oy:Math.sin(sg.length*0.6)*1});
            ss = i; af = 0;
          }
        }
        ctx.save(); ctx.globalAlpha = a * 0.2;
        ctx.strokeStyle = '#FF6B6B'; ctx.lineWidth = 1.5;
        for (const s of sg) {
          ctx.beginPath();
          for (let i = s.s; i <= s.e; i++) {
            i === s.s ? ctx.moveTo(points[i].x + s.ox + 2, points[i].y + s.oy - 1.5) : ctx.lineTo(points[i].x + s.ox + 2, points[i].y + s.oy - 1.5);
          }
          ctx.stroke();
        }
        ctx.restore();
        ctx.save(); ctx.globalAlpha = a * 0.15;
        ctx.strokeStyle = '#6BE8FF'; ctx.lineWidth = 1.5;
        for (const s of sg) {
          ctx.beginPath();
          for (let i = s.s; i <= s.e; i++) {
            i === s.s ? ctx.moveTo(points[i].x - s.ox - 1.5, points[i].y - s.oy + 1.5) : ctx.lineTo(points[i].x - s.ox - 1.5, points[i].y - s.oy + 1.5);
          }
          ctx.stroke();
        }
        ctx.restore();
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        for (const s of sg) {
          ctx.globalAlpha = a * (0.65 + Math.sin(s.s * 0.2 + ft) * 0.15);
          ctx.beginPath();
          for (let i = s.s; i <= s.e; i++) {
            i === s.s ? ctx.moveTo(points[i].x + s.ox, points[i].y + s.oy) : ctx.lineTo(points[i].x + s.ox, points[i].y + s.oy);
          }
          ctx.stroke();
        }
        ctx.restore();
        ctx.save();
        for (let i = 0; i < sg.length; i += 3) {
          const s = sg[i]; const pt = points[s.e];
          const bw = 14 + Math.sin(i * 1.1 + ft * 3) * 10;
          ctx.globalAlpha = a * 0.12;
          ctx.fillStyle = i % 2 === 0 ? '#FF6B6B' : '#6BE8FF';
          ctx.fillRect(pt.x + s.ox - bw/2, pt.y - 0.5, bw, 1);
        }
        ctx.restore();
        ctx.save(); ctx.globalAlpha = a * 0.08;
        ctx.strokeStyle = color; ctx.lineWidth = 0.8;
        for (let i = 0; i < sg.length; i += 4) {
          const s = sg[i];
          ctx.beginPath();
          for (let j = s.s; j <= s.e; j++) {
            j === s.s ? ctx.moveTo(points[j].x + s.ox + 4, points[j].y + s.oy + 3) : ctx.lineTo(points[j].x + s.ox + 4, points[j].y + s.oy + 3);
          }
          ctx.stroke();
        }
        ctx.restore();
        ctx.restore(); // outer flutter save
        break;
      }
    }
    _deadCtx.globalAlpha = 1; _deadCtx.shadowBlur = 0;
  } /* DEAD_CODE_MARKER_END */

  const drawStrokeWithCA = (
    ctx: CanvasRenderingContext2D, points: Point[], color: string,
    opacity: number, flavor: SoundFlavor, locked: boolean, muted: boolean,
    applyCA: boolean
  ) => {
    if (applyCA && points.length >= 2) {
      // Light-mode CA: lightweight offset paths only (NOT full drawStroke).
      // Use 'multiply' so the tint is visible on white backgrounds.
      // This avoids the catastrophic cost of rendering 3× full drawStroke
      // with heavy shadow/blur passes (especially for SUB/SINE).
      const caAlpha = opacity * 0.18;
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = caAlpha;
      ctx.strokeStyle = 'rgba(220,60,60,0.35)';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      smoothCurvePathOffset(ctx, points, 1.5, 0);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = caAlpha;
      ctx.strokeStyle = 'rgba(60,60,220,0.35)';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      smoothCurvePathOffset(ctx, points, -1.5, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    drawStroke(ctx, points, color, opacity, flavor, locked, muted);
  };

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

      ctx.fillStyle = isDarkRef.current ? '#060608' : '#FAFAFA';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const now = Date.now();
      const beatDurMs = 60000 / modulators.tempo;
      const beatPhase = (now % beatDurMs) / beatDurMs;

      strokesRef.current.forEach(stroke => {
        let opacity: number;
        if (stroke.fadeOutStart) {
          opacity = 0.04 * Math.max(0, 1 - (now - stroke.fadeOutStart) / 600);
        } else if (stroke.isPulse) {
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
            ctx.fillStyle = stroke.color; ctx.globalAlpha = 0.7;
            ctx.fillRect(stroke.points[0].x - 3, stroke.points[0].y - 3, 6, 6);
            ctx.globalAlpha = 1;
          }
        }
      });

      const curMap = isDarkRef.current ? FLAVOR_COLORS : FLAVOR_COLORS_LIGHT;
      activePointersRef.current.forEach((ps) => {
        if (ps.points.length > 1) {
          drawStroke(ctx, ps.points, curMap[activeFlavorRef.current], 1, activeFlavorRef.current, false, false);
        }
      });
    };

    animationRef.current = requestAnimationFrame(loop);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [modulators.tempo, modulators.pulseLength]);

  const modeOptions: PlayMode[] = ['drone', 'pulse', 'gate'];

  const sheetBaseStyle = (open: boolean): React.CSSProperties => ({
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    transform: open ? 'translateY(0)' : 'translateY(100%)',
    transition: open
      ? 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)'
      : 'transform 250ms cubic-bezier(0.4, 0, 1, 1)',
    zIndex: 50,
    borderRadius: '0',
    backgroundColor: 'var(--fm-panel-bg)',
    borderTop: '1px solid var(--fm-panel-border)',
  });

  const dragHandle = (sheet: 'inst' | 'fx') => {
    const open = sheet === 'inst' ? instSheetOpen : fxSheetOpen;
    return (
      <div
        style={{ padding: '12px 0 8px', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(e) => handleSheetDragStart(e, sheet)}
        onPointerMove={handleSheetDragMove}
        onPointerUp={handleSheetDragEnd}
        onPointerCancel={handleSheetDragEnd}
      >
        <div style={{
          width: 32, height: 4, borderRadius: 2,
          backgroundColor: 'var(--fm-text-muted)',
          opacity: open ? 0.7 : 0.4,
          transition: 'opacity 400ms ease',
          margin: '0 auto',
        }} />
      </div>
    );
  };

  const mobileFlavorBtnStyle = (isActive: boolean, color: string): React.CSSProperties => ({
    width: 'calc(25% - 6px)',
    height: '44px',
    fontSize: '9px',
    letterSpacing: '0.05em',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '3px',
    color: isActive ? color : 'var(--fm-text-secondary)',
    backgroundColor: isActive ? `${color}10` : 'var(--fm-btn-bg)',
    border: isActive ? `1px solid ${color}60` : '1px solid var(--fm-btn-border)',
    opacity: isActive ? 1 : 0.6,
    cursor: 'pointer',
    transition: 'all 150ms',
  });

  const mobileModeBtn = (mode: PlayMode): React.CSSProperties => ({
    flex: 1,
    height: '44px',
    fontSize: '10px',
    letterSpacing: '0.1em',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: playMode === mode ? 'var(--fm-accent)' : 'var(--fm-text-muted)',
    backgroundColor: playMode === mode ? 'rgba(var(--fm-accent-rgb), 0.1)' : 'var(--fm-btn-bg)',
    border: playMode === mode ? '1px solid var(--fm-accent)' : '1px solid var(--fm-btn-border)',
    cursor: 'pointer',
    transition: 'all 150ms',
  });

  const compactSelectStyle: React.CSSProperties = {
    fontSize: '9px',
    letterSpacing: '0.08em',
    padding: '8px 6px',
    color: 'var(--fm-text-secondary)',
    backgroundColor: 'var(--fm-btn-bg)',
    border: '1px solid var(--fm-btn-border)',
    outline: 'none',
    width: '100%',
    appearance: 'none' as const,
    textAlign: 'center' as const,
    cursor: 'pointer',
  };

  const leftSidebarW = leftSidebarOpen ? (isTablet ? 180 : LEFT_SIDEBAR_WIDTH) : 0;
  const oscWidth = isTablet ? 340 : FLAVOR_BAR_WIDTH;

  // Shared props object for both desktop and mobile RecordButton instances
  const recordButtonProps = {
    recordState,
    recordSeconds,
    maxSeconds: MAX_RECORD_SECONDS,
    isMobile,
    isGateMode: playMode === 'gate',
    onStart: handleRecordStart,
    onStop: handleRecordStop,
    onDownload: handleRecordDownload,
    onClear: handleRecordClear,
  };

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: 'var(--fm-bg)', transition: 'background-color 300ms ease' }}>
      <style>{`@keyframes formless-rec-pulse { 0%,100%{box-shadow:0 0 6px rgba(239,68,68,0.2)} 50%{box-shadow:0 0 16px rgba(239,68,68,0.55)} }`}</style>
      <AmbientGrid bpm={modulators.tempo} isDark={isDark} />

      <div className="absolute inset-0" style={{ backgroundColor: 'var(--fm-canvas-bg)', transition: 'background-color 300ms ease' }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none"
          onPointerDown={isMobile ? handleCanvasPointerDownMobile : handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerFinish}
          onPointerCancel={handlePointerFinish}
          onLostPointerCapture={handlePointerFinish}
          style={{
            touchAction: 'none', cursor: 'crosshair',
            width: '100%', height: '100%',
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

      {currentPitch && currentStrokeForUI.length > 0 && (
        <div
          className="absolute pointer-events-none px-3 py-1 border tracking-wider z-30"
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

      {/* DESKTOP + TABLET: Left Sidebar */}
      {!isMobile && !performanceMode && (
        <LeftSidebar
          audioEngine={audioEngineRef.current}
          isOpen={leftSidebarOpen}
          onToggle={setLeftSidebarOpen}
          playMode={playMode}
          onPlayModeChange={handlePlayModeChange}
          rootNote={rootNote}
          scale={scale}
          octave={octave}
          onRootChange={handleRootChange}
          onScaleChange={handleScaleChange}
          onOctaveChange={handleOctaveChange}
          onClear={handleClear}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={strokes.length > 0}
          canRedo={redoStackRef.current.length > 0}
          recordState={recordState}
          recordSeconds={recordSeconds}
          maxRecordSeconds={MAX_RECORD_SECONDS}
          isGateMode={playMode === 'gate'}
          onRecordStart={handleRecordStart}
          onRecordStop={handleRecordStop}
          onRecordDownload={handleRecordDownload}
          onRecordClear={handleRecordClear}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          performanceMode={performanceMode}
          onTogglePerformanceMode={() => setPerformanceMode(!performanceMode)}
          isTouch={isTouch}
          isMobile={isMobile}
        />
      )}

      {!isMobile && performanceMode && (
        <button onClick={() => setPerformanceMode(false)}
          className="fixed flex items-center justify-center transition-all duration-200 z-30"
          style={{ top: '12px', left: '12px', width: '36px', height: '36px', color: 'var(--fm-accent)', border: '1px solid var(--fm-accent)', backgroundColor: 'var(--fm-panel-bg)', cursor: 'pointer' }}
          aria-label="Show panels">
          <Eye size={14} />
        </button>
      )}

      {!isMobile && activeCount > 0 && (
        <div className="absolute flex items-center gap-2 pointer-events-none z-20"
          style={{ top: '16px', fontSize: '9px', letterSpacing: '0.1em', right: performanceMode ? '20px' : sculptorOpen ? `calc(${FX_PANEL_WIDTH}px + 40px)` : '40px', transition: 'right 300ms ease-out' }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--fm-accent)' }} />
          <span style={{ color: 'var(--fm-accent)', opacity: 0.6 }}>
            {activeCount.toString().padStart(2, '0')}/24
          </span>
        </div>
      )}

      {/* Desktop/tablet oscilloscope removed — now in LeftSidebar */}

      {!isMobile && (
        <div className="transition-opacity duration-200"
          style={{ opacity: performanceMode ? 0 : 1, pointerEvents: performanceMode ? 'none' : 'auto' }}>
          <FlavorSelector activeFlavor={activeFlavor} onSelectFlavor={setActiveFlavor}
            flavorVolumes={flavorVolumes}
            onFlavorVolumeChange={(flavor, value) => { audioEngineRef.current.setFlavorVolume(flavor, value); setFlavorVolumes(audioEngineRef.current.getFlavorVolumes()); }}
            isDark={isDark}
            leftOffset={performanceMode ? 0 : leftSidebarW}
            rightOffset={performanceMode ? 0 : (sculptorOpen ? FX_PANEL_WIDTH : 0)} />
        </div>
      )}

      {!isMobile && (
        <div className="transition-opacity duration-200"
          style={{ opacity: performanceMode ? 0 : 1, pointerEvents: performanceMode ? 'none' : 'auto' }}>
          <ModulatorPanel modulators={modulators} onUpdate={handleModulatorUpdate} playMode={playMode} isOpen={sculptorOpen} onToggle={setSculptorOpen} isTouch={isTouch} />
        </div>
      )}

      {/* ScaleSelector removed from here — now in LeftSidebar */}

      {/* MOBILE-ONLY UI */}

      {isMobile && (
        <div className="fixed top-3 left-3 select-none pointer-events-none z-20"
          style={{ fontSize: '8px', color: 'var(--fm-accent)', opacity: 0.45, letterSpacing: '0.25em' }}>
          FORMLESS
        </div>
      )}

      {isMobile && activeCount > 0 && (
        <div className="fixed top-3.5 right-3.5 flex items-center gap-1.5 pointer-events-none z-20">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--fm-accent)' }} />
          <span style={{ fontSize: '9px', color: 'var(--fm-accent)', opacity: 0.6, letterSpacing: '0.1em' }}>
            {activeCount.toString().padStart(2, '0')}/24
          </span>
        </div>
      )}

      {isMobile && (
        <div className="z-20" style={{
          position: 'fixed', top: '28px', left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc((100vw - 80px) * 0.7)', maxWidth: '196px',
          pointerEvents: 'none',
        }}>
          <WaveformVisualizer audioEngine={audioEngineRef.current} />
        </div>
      )}

      {isMobile && (
        <button onClick={() => { setInstSheetOpen(v => !v); setFxSheetOpen(false); }}
          className="fixed z-40 flex items-center justify-center"
          style={{ bottom: '24px', left: '16px', width: '52px', height: '52px', backgroundColor: instSheetOpen ? 'rgba(var(--fm-accent-rgb), 0.12)' : 'var(--fm-panel-bg)', border: instSheetOpen ? '1px solid var(--fm-accent)' : '1px solid var(--fm-panel-border)', color: instSheetOpen ? 'var(--fm-accent)' : 'var(--fm-text-secondary)', fontSize: '10px', letterSpacing: '0.08em', cursor: 'pointer' }}
          aria-label="Open instrument panel">
          INST
        </button>
      )}

      {isMobile && (
        <button onClick={() => { setFxSheetOpen(v => !v); setInstSheetOpen(false); }}
          className="fixed z-40 flex items-center justify-center"
          style={{ bottom: '24px', right: '16px', width: '52px', height: '52px', backgroundColor: fxSheetOpen ? 'rgba(var(--fm-accent-rgb), 0.12)' : 'var(--fm-panel-bg)', border: fxSheetOpen ? '1px solid var(--fm-accent)' : '1px solid var(--fm-panel-border)', color: fxSheetOpen ? 'var(--fm-accent)' : 'var(--fm-text-secondary)', fontSize: '10px', letterSpacing: '0.08em', cursor: 'pointer' }}
          aria-label="Open Sound Sculptor">
          FX
        </button>
      )}

      {isMobile && (
        <div className="fixed z-40 flex items-center gap-4" style={{ bottom: '24px', left: '50%', transform: 'translateX(-50%)' }}>
          <div style={{
            width: recordState === 'idle' ? '84px' : recordState === 'recording' ? '150px' : '140px',
            transition: 'width 200ms ease',
          }}>
            {/* Mobile RecordButton — stable imported component */}
            <RecordButton {...recordButtonProps} />
          </div>
          <button onClick={handleClear}
            className="flex items-center justify-center"
            style={{ width: '52px', height: '52px', backgroundColor: 'var(--fm-panel-bg)', border: '1px solid var(--fm-panel-border)', borderRadius: '0', color: 'var(--fm-text-secondary)', flexShrink: 0, cursor: 'pointer' }}
            aria-label="Clear all strokes">
            <Trash2 size={16} />
          </button>
        </div>
      )}

      {/* MOBILE: Instrument Sheet */}
      <div style={sheetBaseStyle(isMobile && instSheetOpen)}>
        {dragHandle('inst')}
        <div style={{
          padding: '0 16px 24px',
          opacity: instSheetOpen ? 1 : 0,
          transform: instSheetOpen ? 'scale(1)' : 'scale(0.98)',
          transition: instSheetOpen
            ? 'opacity 200ms ease 80ms, transform 200ms ease 80ms'
            : 'opacity 150ms ease, transform 150ms ease',
        }}>
          <div className="tracking-widest" style={{ fontSize: '9px', color: 'var(--fm-text-muted)', marginBottom: '12px' }}>SOUND GENERATOR</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {MOBILE_FLAVORS.map(({ type, icon, label }) => {
              const isAct = activeFlavor === type;
              const c = colorMap[type];
              return (
                <button key={type} onClick={() => setActiveFlavor(type)} style={mobileFlavorBtnStyle(isAct, c)}>
                  {icon(14)}
                  <span style={{ fontSize: '8px' }}>{label}</span>
                </button>
              );
            })}
          </div>
          <div className="tracking-widest" style={{ fontSize: '9px', color: 'var(--fm-text-muted)', marginTop: '16px', marginBottom: '12px' }}>MODE</div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {modeOptions.map(mode => (
              <button key={mode} onClick={() => handlePlayModeChange(mode)} style={mobileModeBtn(mode)}>
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <div style={{ flex: 1 }}>
              <div className="tracking-widest" style={{ fontSize: '8px', color: 'var(--fm-text-muted)', marginBottom: '4px' }}>SCALE</div>
              <select value={scale} onChange={(e) => handleScaleChange(e.target.value as ScaleType)} style={compactSelectStyle}>
                {SCALE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ flex: 0.6 }}>
              <div className="tracking-widest" style={{ fontSize: '8px', color: 'var(--fm-text-muted)', marginBottom: '4px' }}>ROOT</div>
              <select value={rootNote} onChange={(e) => handleRootChange(e.target.value as RootNote)} style={compactSelectStyle}>
                {ROOT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ flex: 0.4 }}>
              <div className="tracking-widest" style={{ fontSize: '8px', color: 'var(--fm-text-muted)', marginBottom: '4px' }}>OCT</div>
              <select value={octave} onChange={(e) => handleOctaveChange(Number(e.target.value))} style={compactSelectStyle}>
                {OCTAVE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: '16px', display: 'flex', gap: '6px' }}>
            <button onClick={toggleTheme}
              style={{ flex: 1, height: '36px', fontFamily: 'monospace', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', borderRadius: '0', color: 'var(--fm-text-secondary)', backgroundColor: 'var(--fm-btn-bg)', border: '1px solid var(--fm-btn-border)', cursor: 'pointer' }}>
              {isDark ? <Sun size={12} /> : <Moon size={12} />}
              {isDark ? 'LIGHT' : 'DARK'}
            </button>
          </div>
        </div>
      </div>

      {/* MOBILE: FX Sheet */}
      <div style={{ ...sheetBaseStyle(isMobile && fxSheetOpen), height: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {dragHandle('fx')}
        <div style={{
          flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative',
          opacity: fxSheetOpen ? 1 : 0,
          transform: fxSheetOpen ? 'scale(1)' : 'scale(0.98)',
          transition: fxSheetOpen
            ? 'opacity 200ms ease 80ms, transform 200ms ease 80ms'
            : 'opacity 150ms ease, transform 150ms ease',
        }}>
          <ModulatorPanel modulators={modulators} onUpdate={handleModulatorUpdate} playMode={playMode} isOpen={true} mobileMode={true} />
          <div
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: '48px',
              background: isDark
                ? 'linear-gradient(to top, rgba(10,10,11,1) 0%, rgba(10,10,11,1) 10%, rgba(10,10,11,0) 100%)'
                : 'linear-gradient(to top, rgba(250,250,250,1) 0%, rgba(250,250,250,1) 10%, rgba(250,250,250,0) 100%)',
              pointerEvents: 'none', zIndex: 10,
            }}
          />
        </div>
      </div>

      {/* Root change radial pulse */}
      {rootPulse && (
        <div className="fixed inset-0 pointer-events-none flex items-center justify-center" style={{ zIndex: 15 }}>
          <div style={{ width: 0, height: 0, borderRadius: '50%', background: `radial-gradient(circle, rgba(var(--fm-accent-rgb),0.15) 0%, transparent 70%)`, transform: isMobile ? 'none' : `translateX(${(leftSidebarW - FX_PANEL_WIDTH) / 2}px)`, animation: 'rootPulseAnim 600ms ease-out forwards' }} />
          <style>{`
            @keyframes rootPulseAnim {
              0% { width: 100px; height: 100px; opacity: 0; }
              50% { opacity: 1; }
              100% { width: 500px; height: 500px; opacity: 0; }
            }
          `}</style>
        </div>
      )}

      {/* Scale change guide lines */}
      {guideVisibleNotes.length > 0 && (
        <div className="fixed inset-0 pointer-events-none" ref={guideContainerRef} style={{ opacity: 0, zIndex: 15 }}>
          {guideVisibleNotes.map((note, i) => {
            const total = guideVisibleNotes.length;
            const yNorm = total > 1 ? 1 - (i / (total - 1)) : 0.5;
            const yPos = yNorm * window.innerHeight;
            const labelWidth = note.name.length * 5.4 + 8;
            const lineLeft = labelWidth + 12;
            return (
              <div key={`${note.name}-${i}`} className="absolute left-0 right-0" style={{ top: yPos }}>
                <div className="absolute right-0" style={{ left: `${lineLeft}px`, height: '1px', backgroundColor: 'var(--fm-divider)' }} />
                <span className="absolute select-none" style={{ left: '8px', top: '-5px', fontSize: '9px', color: 'var(--fm-text-muted)', lineHeight: 1 }}>
                  {note.name}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <CRTEffect isDark={isDark} />
    </div>
  );
}
