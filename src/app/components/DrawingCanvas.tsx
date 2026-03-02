// FORMLESS — Drawing Canvas
// 30fps throttled, max 16 simultaneous strokes, unified pointer events
// Real-time sound modulation during drawing, Gate/Pulse/Drone mode
// Left vertical strip layout, centered elements

import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import { Eye, EyeOff, Trash2, Sun, Moon, Circle, ZapIcon, Waves, Sparkles, Wind, Hexagon, Disc, Diamond } from 'lucide-react';
import { useTheme } from './ThemeContext';
import { RecordButton } from './RecordButton';

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

const LEFT_STRIP_WIDTH = 88;
const FX_PANEL_WIDTH = 220;
const FLAVOR_BAR_WIDTH = 400;

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
    setStrokes([]);
    setPulses([]);
    audioEngineRef.current.clearAll();
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

  // DRAWING — flavor-specific stroke rendering
  const drawStroke = (
    ctx: CanvasRenderingContext2D, points: Point[], color: string,
    opacity: number, flavor: SoundFlavor, locked: boolean, muted: boolean
  ) => {
    if (points.length < 2) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const a = muted ? opacity * 0.2 : opacity;
    const now = Date.now();
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
            px += nx * wave; py += ny * wave;
          }
          wavePoints.push({ x: px, y: py });
        }
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
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
        ctx.strokeStyle = `rgba(184,169,201,${a * 0.15})`; ctx.lineWidth = 14;
        ctx.shadowBlur = useShadow ? 12 : 0; ctx.globalAlpha = a * 0.5;
        ctx.beginPath(); ctx.moveTo(wavePoints[0].x, wavePoints[0].y);
        for (let i = 1; i < wavePoints.length - 1; i++) {
          const cpx = (wavePoints[i].x + wavePoints[i + 1].x) / 2;
          const cpy = (wavePoints[i].y + wavePoints[i + 1].y) / 2;
          ctx.quadraticCurveTo(wavePoints[i].x, wavePoints[i].y, cpx, cpy);
        }
        ctx.lineTo(wavePoints[wavePoints.length - 1].x, wavePoints[wavePoints.length - 1].y);
        ctx.stroke();
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

  const drawStrokeWithCA = (
    ctx: CanvasRenderingContext2D, points: Point[], color: string,
    opacity: number, flavor: SoundFlavor, locked: boolean, muted: boolean,
    applyCA: boolean
  ) => {
    if (applyCA && points.length >= 2) {
      ctx.save();
      ctx.translate(1, 0);
      ctx.globalCompositeOperation = 'lighter';
      drawStroke(ctx, points, 'rgba(180,40,40,0.12)', opacity * 0.6, flavor, locked, muted);
      ctx.restore();
      ctx.save();
      ctx.translate(-1, 0);
      ctx.globalCompositeOperation = 'lighter';
      drawStroke(ctx, points, 'rgba(40,40,180,0.12)', opacity * 0.6, flavor, locked, muted);
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
    borderRadius: '16px 16px 0 0',
    backgroundColor: 'var(--fm-panel-bg)',
    backdropFilter: 'blur(12px)',
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
    fontFamily: 'monospace',
    fontSize: '9px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    borderRadius: '6px',
    color: isActive ? color : 'var(--fm-text-secondary)',
    backgroundColor: isActive ? `${color}18` : 'var(--fm-btn-bg)',
    border: isActive ? `1.5px solid ${color}40` : '1px solid var(--fm-btn-border)',
    filter: isActive ? `drop-shadow(0 0 4px ${color})` : 'none',
    cursor: 'pointer',
    transition: 'all 150ms',
  });

  const mobileModeBtn = (mode: PlayMode): React.CSSProperties => ({
    flex: 1,
    height: '44px',
    fontFamily: 'monospace',
    fontSize: '9px',
    letterSpacing: '0.05em',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px',
    color: playMode === mode ? 'var(--fm-accent)' : 'var(--fm-text-secondary)',
    backgroundColor: playMode === mode ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-btn-bg)',
    border: playMode === mode ? '1.5px solid var(--fm-accent)' : '1px solid var(--fm-btn-border)',
    cursor: 'pointer',
    transition: 'all 150ms',
  });

  const compactSelectStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '9px',
    letterSpacing: '0.05em',
    padding: '8px 6px',
    borderRadius: '6px',
    color: 'var(--fm-text-secondary)',
    backgroundColor: 'var(--fm-btn-bg)',
    border: '1px solid var(--fm-btn-border)',
    outline: 'none',
    width: '100%',
    appearance: 'none' as const,
    textAlign: 'center' as const,
    cursor: 'pointer',
  };

  const leftStripW = isTablet ? 72 : LEFT_STRIP_WIDTH;
  const oscWidth = isTablet ? 320 : FLAVOR_BAR_WIDTH;

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

      <div className="absolute inset-0" style={{ perspective: '1200px', perspectiveOrigin: '50% 50%', backgroundColor: 'var(--fm-canvas-bg)', transition: 'background-color 300ms ease' }}>
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

      {/* DESKTOP + TABLET: Left Strip */}
      {!isMobile && (
        <div
          className="fixed top-0 left-0 z-20 pointer-events-none transition-opacity duration-200"
          style={{ padding: '16px', opacity: performanceMode ? 0 : 1 }}
        >
          <div className="font-mono opacity-45 tracking-widest select-none"
            style={{ fontSize: '12px', width: leftStripW, marginBottom: '16px', color: 'var(--fm-accent)' }}>
            FORMLESS
          </div>
          <div className="flex flex-col items-center flex-shrink-0 pointer-events-auto"
            style={{ width: leftStripW, gap: '8px' }}>
            <div className="flex w-full" style={{ gap: '6px' }}>
              <button onClick={() => setPerformanceMode(!performanceMode)}
                className="flex items-center justify-center backdrop-blur-sm border rounded transition-all duration-200"
                style={{ flex: 1, minHeight: isTouch ? '44px' : undefined, height: isTouch ? undefined : '40px', color: 'var(--fm-text-secondary)', borderColor: 'var(--fm-panel-border)', backgroundColor: 'var(--fm-panel-bg)', cursor: 'pointer' }}
                aria-label="Toggle performance mode" title="Performance mode">
                <EyeOff size={16} />
              </button>
              <button onClick={toggleTheme}
                className="flex items-center justify-center backdrop-blur-sm border rounded transition-all duration-200"
                style={{ flex: 1, minHeight: isTouch ? '44px' : undefined, height: isTouch ? undefined : '40px', color: 'var(--fm-text-secondary)', borderColor: 'var(--fm-panel-border)', backgroundColor: 'var(--fm-panel-bg)', cursor: 'pointer' }}
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
                {isDark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
            <div className="flex flex-col font-mono tracking-wider rounded overflow-hidden border backdrop-blur-sm transition-all duration-200"
              style={{ width: '100%', borderColor: 'var(--fm-panel-border)', borderRadius: '4px', backgroundColor: 'var(--fm-panel-bg)' }}>
              {modeOptions.map(mode => (
                <button key={mode} onClick={() => handlePlayModeChange(mode)}
                  className="flex items-center justify-center py-1 transition-all duration-200"
                  style={{ fontSize: '9px', minHeight: isTouch ? '36px' : undefined, color: playMode === mode ? 'var(--fm-accent)' : 'var(--fm-text-secondary)', backgroundColor: playMode === mode ? 'var(--fm-btn-bg-active)' : 'transparent', cursor: 'pointer' }}>
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Desktop RecordButton — stable imported component */}
            <RecordButton {...recordButtonProps} />

            <button onClick={handleClear}
              className="flex items-center justify-center backdrop-blur-sm border rounded transition-all duration-200"
              style={{ width: '100%', minHeight: isTouch ? '44px' : undefined, height: isTouch ? undefined : '40px', color: 'var(--fm-text-secondary)', borderColor: 'var(--fm-panel-border)', backgroundColor: 'var(--fm-panel-bg)', cursor: 'pointer' }}
              aria-label="Clear all strokes" title="Clear all">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}

      {!isMobile && performanceMode && (
        <button onClick={() => setPerformanceMode(false)}
          className="fixed top-4 left-4 w-10 h-10 flex items-center justify-center backdrop-blur-sm border rounded transition-all duration-200 z-30"
          style={{ color: 'var(--fm-accent)', borderColor: 'var(--fm-btn-border-active)', backgroundColor: 'var(--fm-panel-bg)', cursor: 'pointer' }}
          aria-label="Show panels">
          <Eye size={16} />
        </button>
      )}

      {!isMobile && activeCount > 0 && (
        <div className="absolute top-5 font-mono opacity-65 pointer-events-none tracking-wider z-20"
          style={{ fontSize: '10px', color: 'var(--fm-accent)', right: sculptorOpen ? 'calc(220px + 40px)' : '40px', transition: 'right 300ms ease-out' }}>
          {activeCount.toString().padStart(2, '0')}/24
        </div>
      )}
      {!isMobile && activeCount > 0 && (
        <div className="absolute top-5 flex items-center gap-2 pointer-events-none z-20"
          style={{ right: sculptorOpen ? 'calc(220px + 90px)' : '90px', transition: 'right 300ms ease-out' }}>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--fm-accent)' }} />
        </div>
      )}

      {/* Desktop/tablet oscilloscope */}
      {!isMobile && (
        <div className="z-20 transition-opacity duration-200"
          style={{ position: 'absolute', top: '16px', left: '50%', transform: `translateX(calc(-50% + ${(leftStripW + 16 - FX_PANEL_WIDTH) / 2}px))`, width: `${oscWidth}px`, opacity: performanceMode ? 0 : 1, pointerEvents: performanceMode ? 'none' : 'auto' }}>
          <WaveformVisualizer audioEngine={audioEngineRef.current} />
        </div>
      )}

      {!isMobile && (
        <div className="transition-opacity duration-200"
          style={{ opacity: performanceMode ? 0 : 1, pointerEvents: performanceMode ? 'none' : 'auto' }}>
          <FlavorSelector activeFlavor={activeFlavor} onSelectFlavor={setActiveFlavor}
            flavorVolumes={flavorVolumes}
            onFlavorVolumeChange={(flavor, value) => { audioEngineRef.current.setFlavorVolume(flavor, value); setFlavorVolumes(audioEngineRef.current.getFlavorVolumes()); }}
            isDark={isDark} />
        </div>
      )}

      {!isMobile && (
        <div className="transition-opacity duration-200"
          style={{ opacity: performanceMode ? 0 : 1, pointerEvents: performanceMode ? 'none' : 'auto' }}>
          <ModulatorPanel modulators={modulators} onUpdate={handleModulatorUpdate} playMode={playMode} isOpen={sculptorOpen} onToggle={setSculptorOpen} isTouch={isTouch} />
        </div>
      )}

      {!isMobile && (
        <div className="fixed bottom-6 left-4 z-20 pointer-events-auto transition-opacity duration-200"
          style={{ opacity: performanceMode ? 0 : 1, pointerEvents: performanceMode ? 'none' : 'auto' }}>
          <ScaleSelector rootNote={rootNote} scaleType={scale}
            onRootChange={handleRootChange} onScaleChange={handleScaleChange}
            stripWidth={leftStripW} octave={octave} onOctaveChange={handleOctaveChange} />
        </div>
      )}

      {/* MOBILE-ONLY UI */}

      {isMobile && (
        <div className="fixed top-3 left-3 font-mono tracking-widest select-none pointer-events-none z-20"
          style={{ fontSize: '9px', color: 'var(--fm-accent)', opacity: 0.45 }}>
          FORMLESS
        </div>
      )}

      {isMobile && activeCount > 0 && (
        <div className="fixed top-3.5 right-3.5 flex items-center gap-1.5 pointer-events-none z-20">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--fm-accent)' }} />
          <span className="font-mono opacity-65 tracking-wider" style={{ fontSize: '10px', color: 'var(--fm-accent)' }}>
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
          className="fixed z-40 flex items-center justify-center font-mono tracking-wider"
          style={{ bottom: '24px', left: '16px', width: '52px', height: '52px', backgroundColor: instSheetOpen ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-panel-bg)', border: instSheetOpen ? '1.5px solid var(--fm-accent)' : '1px solid var(--fm-panel-border)', borderRadius: '8px', color: instSheetOpen ? 'var(--fm-accent)' : 'var(--fm-text-secondary)', backdropFilter: 'blur(8px)', fontSize: '9px', cursor: 'pointer' }}
          aria-label="Open instrument panel">
          INST
        </button>
      )}

      {isMobile && (
        <button onClick={() => { setFxSheetOpen(v => !v); setInstSheetOpen(false); }}
          className="fixed z-40 flex items-center justify-center font-mono tracking-wider"
          style={{ bottom: '24px', right: '16px', width: '52px', height: '52px', backgroundColor: fxSheetOpen ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-panel-bg)', border: fxSheetOpen ? '1.5px solid var(--fm-accent)' : '1px solid var(--fm-panel-border)', borderRadius: '8px', color: fxSheetOpen ? 'var(--fm-accent)' : 'var(--fm-text-secondary)', backdropFilter: 'blur(8px)', fontSize: '9px', cursor: 'pointer' }}
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
            style={{ width: '52px', height: '52px', backgroundColor: 'var(--fm-panel-bg)', border: '1px solid var(--fm-panel-border)', borderRadius: '8px', color: 'var(--fm-text-secondary)', backdropFilter: 'blur(8px)', flexShrink: 0, cursor: 'pointer' }}
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
          <div className="font-mono tracking-widest" style={{ fontSize: '9px', color: 'var(--fm-text-muted)', marginBottom: '12px' }}>SOUND GENERATOR</div>
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
          <div className="font-mono tracking-widest" style={{ fontSize: '9px', color: 'var(--fm-text-muted)', marginTop: '16px', marginBottom: '12px' }}>MODE</div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {modeOptions.map(mode => (
              <button key={mode} onClick={() => handlePlayModeChange(mode)} style={mobileModeBtn(mode)}>
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <div style={{ flex: 1 }}>
              <div className="font-mono tracking-widest" style={{ fontSize: '8px', color: 'var(--fm-text-muted)', marginBottom: '4px' }}>SCALE</div>
              <select value={scale} onChange={(e) => handleScaleChange(e.target.value as ScaleType)} style={compactSelectStyle}>
                {SCALE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ flex: 0.6 }}>
              <div className="font-mono tracking-widest" style={{ fontSize: '8px', color: 'var(--fm-text-muted)', marginBottom: '4px' }}>ROOT</div>
              <select value={rootNote} onChange={(e) => handleRootChange(e.target.value as RootNote)} style={compactSelectStyle}>
                {ROOT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ flex: 0.4 }}>
              <div className="font-mono tracking-widest" style={{ fontSize: '8px', color: 'var(--fm-text-muted)', marginBottom: '4px' }}>OCT</div>
              <select value={octave} onChange={(e) => handleOctaveChange(Number(e.target.value))} style={compactSelectStyle}>
                {OCTAVE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: '16px', display: 'flex', gap: '6px' }}>
            <button onClick={toggleTheme}
              style={{ flex: 1, height: '36px', fontFamily: 'monospace', fontSize: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', borderRadius: '6px', color: 'var(--fm-text-secondary)', backgroundColor: 'var(--fm-btn-bg)', border: '1px solid var(--fm-btn-border)', cursor: 'pointer' }}>
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
                ? 'linear-gradient(to top, rgba(13,15,20,1) 0%, rgba(13,15,20,1) 10%, rgba(13,15,20,0) 100%)'
                : 'linear-gradient(to top, rgba(237,234,226,1) 0%, rgba(237,234,226,1) 10%, rgba(237,234,226,0) 100%)',
              pointerEvents: 'none', zIndex: 10,
            }}
          />
        </div>
      </div>

      {/* Root change radial pulse */}
      {rootPulse && (
        <div className="fixed inset-0 pointer-events-none flex items-center justify-center" style={{ zIndex: 15 }}>
          <div style={{ width: 0, height: 0, borderRadius: '50%', background: `radial-gradient(circle, rgba(var(--fm-accent-rgb),0.15) 0%, transparent 70%)`, transform: isMobile ? 'none' : `translateX(${(leftStripW + 16 - FX_PANEL_WIDTH) / 2}px)`, animation: 'rootPulseAnim 600ms ease-out forwards' }} />
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
                <span className="absolute font-mono select-none" style={{ left: '8px', top: '-5px', fontSize: '9px', color: 'var(--fm-text-muted)', lineHeight: 1 }}>
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
