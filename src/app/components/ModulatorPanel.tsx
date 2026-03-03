// SOUND SCULPTOR Panel — 3-column knob layout, expanded by default
// Per-section Reset and Randomize buttons
// Section order: DYNAMICS → FILTER → MODULATION → SPACE → GRANULAR CLOUD → LFO
// Mobile: 3-tab navigation (SHAPE | FX | LFO) with fixed header + scrollable content

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ModulatorSettings, ReverbType, FilterType, LfoShape, LfoTarget, DEFAULT_MOD } from '../utils/audioEngine';
import { ChevronRight, ChevronLeft, RotateCcw, Dice5, Minus, Power } from 'lucide-react';
import type { PlayMode } from '../utils/audioEngine';
import { EnvelopeDisplay } from './EnvelopeDisplay';

interface Props {
  modulators: ModulatorSettings;
  onUpdate: (s: Partial<ModulatorSettings>) => void;
  playMode?: PlayMode;
  isOpen?: boolean;
  onToggle?: (v: boolean) => void;
  mobileMode?: boolean;
  isTouch?: boolean;
  onScroll?: (scrollTop: number) => void;
}

// ─── Knob ───
// sizePx prop: mobile renders responsive knobs, desktop 44px.
// SVG viewBox stays "0 0 44 44" so arc math is unchanged — only rendered size changes.
function Knob({
  id, label, min, max, value, disabled, onValueChange, onDragStart, onDragEnd, sizePx = 44,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  disabled?: boolean;
  sizePx?: number;
  onValueChange: (val: number) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
}) {
  const safeValue = isFinite(value) ? value : 0;
  const norm = Math.max(0, Math.min(1, (safeValue - min) / (max - min) || 0));
  const circ = 2 * Math.PI * 17;
  const arcLen = circ * (270 / 360);
  const valLen = norm * arcLen;
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);
  const lastEmitRef = useRef<number>(0);
  const pendingRafRef = useRef<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [displayVal, setDisplayVal] = useState(value);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startVal: value };
    lastEmitRef.current = 0;
    setIsDragging(true);
    setDisplayVal(value);
    onDragStart?.(id);
  }, [disabled, value, id, onDragStart]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - e.clientY;
    const range = max - min;
    const nv = Math.max(min, Math.min(max, dragRef.current.startVal + (delta / 200) * range));
    const now = performance.now();
    if (now - lastEmitRef.current < 16) {
      cancelAnimationFrame(pendingRafRef.current);
      pendingRafRef.current = requestAnimationFrame(() => {
        lastEmitRef.current = performance.now();
        onValueChange(nv);
        setDisplayVal(nv);
      });
      return;
    }
    lastEmitRef.current = now;
    onValueChange(nv);
    setDisplayVal(nv);
  }, [min, max, onValueChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    cancelAnimationFrame(pendingRafRef.current);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    dragRef.current = null;
    setIsDragging(false);
    onDragEnd?.();
  }, [onDragEnd]);

  const containerW = sizePx + 12;

  return (
    <div className="flex flex-col items-center gap-1" style={{ width: containerW, pointerEvents: 'all', position: 'relative' }}>
      {isDragging && (
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '4px',
            fontSize: '9px',
            color: 'var(--fm-accent)',
            backgroundColor: 'var(--fm-panel-bg)',
            border: '1px solid var(--fm-panel-border)',
            borderRadius: '0',
            padding: '2px 5px',
            whiteSpace: 'nowrap',
            zIndex: 100,
          }}
        >
          {Math.round(displayVal * 100) / 100}
        </div>
      )}
      <div
        className={`rounded-full relative knob-element ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-ns-resize'}`}
        role="slider"
        aria-label={label.replace(/\n/g, ' ')}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(safeValue * 100) / 100}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          width: sizePx,
          height: sizePx,
          touchAction: 'none',
          pointerEvents: disabled ? 'none' : 'all',
          background: 'radial-gradient(circle at 35% 35%, var(--fm-knob-bg-highlight, rgba(255,255,255,0.06)) 0%, var(--fm-knob-bg) 60%)',
          border: '1px solid var(--fm-knob-border)',
          boxShadow: disabled ? 'none' : 'var(--fm-knob-shadow)',
        }}
      >
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 44 44"
          style={{ transform: 'rotate(135deg)' }}
        >
          <circle cx="22" cy="22" r="17" fill="none" stroke="var(--fm-knob-track)"
            strokeWidth="2.5" strokeDasharray={`${arcLen} 1000`} strokeLinecap="round" />
          <circle cx="22" cy="22" r="17" fill="none" stroke="var(--fm-accent)"
            strokeWidth="2.5" strokeDasharray={`${isFinite(valLen) ? valLen : 0} 1000`}
            strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 3px var(--fm-accent))' }} />
        </svg>
        {!disabled && norm > 0 && (
          <div className="absolute inset-0 pointer-events-none">
            <svg className="w-full h-full" viewBox="0 0 44 44"
              style={{ transform: `rotate(${225 + norm * 270}deg)` }}>
              <circle cx="22" cy="5" r="1.5" fill="var(--fm-accent)"
                style={{ filter: 'drop-shadow(0 0 2px var(--fm-accent))' }} />
            </svg>
          </div>
        )}
      </div>
      <div
        className="tracking-wider text-center whitespace-pre-line leading-tight"
        style={{ fontSize: '10px', color: 'var(--fm-text-secondary)', cursor: 'default' }}
      >
        {label}
      </div>
    </div>
  );
}

// ─── Shared styles ───
const gridBtnStyle = (on: boolean, mobile?: boolean): React.CSSProperties => ({
  width: '100%',
  height: mobile ? '36px' : '26px',
  fontSize: mobile ? '10px' : '9px',
  letterSpacing: '0.05em',
  borderRadius: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: on ? 'var(--fm-accent)' : 'var(--fm-text-secondary)',
  backgroundColor: on ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-btn-bg)',
  border: on ? '1.5px solid var(--fm-accent)' : '1px solid var(--fm-btn-border)',
  filter: 'none',
  transition: 'all 150ms',
  cursor: 'pointer',
});

const grid3Style: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '6px',
};

const grid2Style: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '6px',
};

// ─── ToggleRow ───
function ToggleRow({
  options, active, onChange, ariaLabel, mobileMode,
}: {
  options: string[];
  active: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  mobileMode?: boolean;
}) {
  return (
    <div style={grid3Style} role="radiogroup" aria-label={ariaLabel}>
      {options.map(opt => {
        const on = active === opt;
        return (
          <button
            key={opt}
            role="radio"
            aria-checked={on}
            onClick={() => { if (opt !== active) onChange(opt); }}
            style={gridBtnStyle(on, mobileMode)}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function ToggleBtn({
  label, active, onChange, disabled, mobileMode,
}: {
  label: string;
  active: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  mobileMode?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!active)}
      style={{ ...gridBtnStyle(active, mobileMode), opacity: disabled ? 0.3 : 1, cursor: disabled ? 'default' : 'pointer' }}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

// ─── SectionHeader ───
function SectionHeader({
  label, onReset, onRandomize, powerActive, onPowerToggle, mobileMode,
}: {
  label: string;
  onReset?: () => void;
  onRandomize?: () => void;
  powerActive?: boolean;
  onPowerToggle?: (v: boolean) => void;
  mobileMode?: boolean;
}) {
  const btnClass = `${mobileMode ? 'w-9 h-9' : 'w-7 h-7'} flex items-center justify-center border transition-all duration-150 active:opacity-60`;
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="tracking-widest" style={{ fontSize: mobileMode ? '11px' : '10px', color: 'var(--fm-text-muted)' }}>
          {label}
        </div>
        <div className="flex gap-1">
          {onReset && (
            <button
              onClick={onReset}
              title={`Reset ${label}`}
              className={btnClass}
              style={{ color: 'var(--fm-text-muted)', backgroundColor: 'var(--fm-section-btn-bg)', borderColor: 'var(--fm-section-btn-border)', cursor: 'pointer' }}
            >
              <RotateCcw size={mobileMode ? 16 : 14} />
            </button>
          )}
          {onRandomize && (
            <button
              onClick={onRandomize}
              title={`Randomize ${label}`}
              className={btnClass}
              style={{ color: 'var(--fm-text-muted)', backgroundColor: 'var(--fm-section-btn-bg)', borderColor: 'var(--fm-section-btn-border)', cursor: 'pointer' }}
            >
              <Dice5 size={mobileMode ? 16 : 14} />
            </button>
          )}
          {onPowerToggle && (
            <button
              onClick={() => onPowerToggle(!powerActive)}
              title={powerActive ? `Disable ${label}` : `Enable ${label}`}
              className={btnClass}
              style={{
                color: powerActive ? 'var(--fm-accent)' : 'var(--fm-text-muted)',
                borderColor: powerActive ? 'var(--fm-accent)' : 'var(--fm-section-btn-border)',
                backgroundColor: powerActive ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-section-btn-bg)',
                border: powerActive ? '1.5px solid var(--fm-accent)' : '1px solid var(--fm-section-btn-border)',
                filter: 'none',
                cursor: 'pointer',
              }}
            >
              <Power size={mobileMode ? 16 : 14} />
            </button>
          )}
        </div>
      </div>
      <div className="h-px mt-1" style={{ backgroundColor: 'var(--fm-divider)' }} />
    </div>
  );
}

// ─── TabBar (mobile only) ───
function TabBar({
  active,
  onChange,
}: {
  active: 0 | 1 | 2;
  onChange: (tab: 0 | 1 | 2) => void;
}) {
  const tabs: { label: string; index: 0 | 1 | 2 }[] = [
    { label: 'SHAPE', index: 0 },
    { label: 'FX', index: 1 },
    { label: 'LFO', index: 2 },
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: '4px',
        padding: '0 0 12px 0',
        borderBottom: '1px solid var(--fm-divider)',
        marginBottom: '4px',
      }}
    >
      {tabs.map(({ label, index }) => {
        const isActive = active === index;
        return (
          <button
            key={index}
            onClick={() => onChange(index)}
            style={{
              flex: 1,
              height: '32px',
              fontSize: '10px',
              letterSpacing: '0.08em',
              borderRadius: '0',
              border: isActive
                ? '1.5px solid var(--fm-accent)'
                : '1px solid var(--fm-btn-border)',
              color: isActive ? 'var(--fm-accent)' : 'var(--fm-text-secondary)',
              backgroundColor: isActive
                ? 'rgba(var(--fm-accent-rgb), 0.12)'
                : 'var(--fm-btn-bg)',
              transition: 'all 150ms ease',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

const REVERB_LABELS: Record<ReverbType, [string, string]> = {
  ROOM: ['EARLY', 'DIFFUSE'],
  HALL: ['WIDTH', 'PRE-DLY'],
  GRANULAR: ['GR SIZE', 'DENSITY'],
  LOFI: ['CRUSH', 'WOW'],
  SPATIAL: ['SPREAD', 'HEIGHT'],
  MASSIVE: ['SWELL', 'DEPTH'],
};

const LFO_SHAPES: LfoShape[] = ['SINE', 'TRI', 'SQR', 'S&H', 'RAMP_UP', 'RAMP_DN'];
const LFO_ICONS: Record<LfoShape, string> = {
  SINE: '∿', TRI: '△', SQR: '▢', 'S&H': '⊞', RAMP_UP: '⟋', RAMP_DN: '⟍',
};
const LFO_TARGETS: LfoTarget[] = ['PITCH', 'FILTER', 'VOLUME', 'PAN', 'REVERB', 'DELAY'];

function rand(min: number, max: number) { return min + Math.random() * (max - min); }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── Main export ───
export function ModulatorPanel({
  modulators: m, onUpdate, playMode, isOpen: isOpenProp, onToggle, mobileMode, isTouch, onScroll,
}: Props) {
  const [isOpenInternal, setIsOpenInternal] = useState(isOpenProp ?? true);
  const isOpen = isOpenProp !== undefined ? isOpenProp : isOpenInternal;

  const handleToggle = useCallback((v: boolean) => {
    setIsOpenInternal(v);
    onToggle?.(v);
  }, [onToggle]);

  const [activeKnob, setActiveKnob] = useState<string | null>(null);
  const [tempVal, setTempVal] = useState<number | null>(null);
  const [zeroPulse, setZeroPulse] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrollHintedRef = useRef(false);
  const userHasScrolledRef = useRef(false);

  // Mobile tab state
  const [activeTab, setActiveTab] = useState<0 | 1 | 2>(0);
  const [scrollFaded, setScrollFaded] = useState(false);

  const handleTabChange = useCallback((tab: 0 | 1 | 2) => {
    setActiveTab(tab);
    setScrollFaded(false);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, []);

  // Reset to tab 0 when panel re-opens
  useEffect(() => {
    if (isOpen) setActiveTab(0);
  }, [isOpen]);

  const [filterType, setFilterType] = useState<string>(m.filterType || 'LP');
  const [reverbType, setReverbType] = useState<string>(m.reverbType || 'ROOM');
  const [lfo1Shape, setLfo1Shape] = useState<string>(m.lfo1Shape || 'SINE');
  const [lfo1Target, setLfo1Target] = useState<string>(m.lfo1Target || 'PITCH');
  const [lfo2Shape, setLfo2Shape] = useState<string>(m.lfo2Shape || 'SINE');
  const [lfo2Target, setLfo2Target] = useState<string>(m.lfo2Target || 'FILTER');
  const [lfo1Sync, setLfo1Sync] = useState(m.lfo1Sync || false);
  const [lfo2Sync, setLfo2Sync] = useState(m.lfo2Sync || false);
  const [grainFreeze, setGrainFreeze] = useState(m.grainFreeze || false);
  const [grainReverse, setGrainReverse] = useState(m.grainReverse || false);
  const [grainCloudActive, setGrainCloudActive] = useState(m.grainCloudActive || false);

  useEffect(() => {
    if (hasScrollHintedRef.current) return;
    const el = scrollRef.current;
    if (!el || !isOpen) return;
    const timer = setTimeout(() => {
      if (userHasScrolledRef.current || hasScrollHintedRef.current) return;
      hasScrollHintedRef.current = true;
      el.scrollTo({ top: 50, behavior: 'smooth' });
      setTimeout(() => el.scrollTo({ top: 0, behavior: 'smooth' }), 750);
    }, 800);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => { setFilterType(m.filterType || 'LP'); }, [m.filterType]);
  useEffect(() => { setReverbType(m.reverbType || 'ROOM'); }, [m.reverbType]);
  useEffect(() => { setLfo1Target(m.lfo1Target || 'PITCH'); }, [m.lfo1Target]);
  useEffect(() => { setLfo2Target(m.lfo2Target || 'FILTER'); }, [m.lfo2Target]);

  const handleKnobDragStart = useCallback((id: string) => {
    setActiveKnob(id);
    if (scrollRef.current) {
      scrollRef.current.style.overflowY = 'hidden';
      scrollRef.current.style.touchAction = 'none';
    }
  }, []);

  const handleKnobDragEnd = useCallback(() => {
    setActiveKnob(null);
    setTimeout(() => setTempVal(null), 1200);
    if (scrollRef.current) {
      scrollRef.current.style.overflowY = 'auto';
      scrollRef.current.style.touchAction = '';
    }
  }, []);

  // Responsive knob sizing: on mobile, fill 1/3 of panel width minus padding and gaps.
  // Panel padding: 14px each side = 28px. Gap between 3 knobs: 6px x 2 = 12px. Extra chrome: ~4px.
  // Cap at 72px so it doesn't get huge on tablets. Min 52px.
  const knobSizePx = mobileMode
    ? Math.min(72, Math.max(52, Math.floor((window.innerWidth - 44 - 12) / 3)))
    : 44;
  const sectionGap = mobileMode ? '36px' : '20px';

  // Knob grid style helper — consistent across all sections
  const knobGrid = (extra?: React.CSSProperties): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: mobileMode ? 'repeat(3, 1fr)' : 'repeat(3, 56px)',
    justifyItems: 'center',
    gap: mobileMode ? '6px' : '12px',
    marginTop: mobileMode ? '20px' : '12px',
    marginBottom: mobileMode ? '4px' : '0',
    ...extra,
  });

  const K = (
    key: keyof ModulatorSettings,
    label: string,
    min: number,
    max: number,
    val: number,
    dis?: boolean,
  ) => (
    <Knob
      key={key}
      id={key}
      label={label}
      min={min}
      max={max}
      value={val}
      disabled={dis}
      sizePx={knobSizePx}
      onValueChange={(nv) => { setTempVal(nv); onUpdate({ [key]: nv } as Partial<ModulatorSettings>); }}
      onDragStart={handleKnobDragStart}
      onDragEnd={handleKnobDragEnd}
    />
  );

  const [p1Label, p2Label] = REVERB_LABELS[(reverbType as ReverbType) || 'ROOM'];

  const spacer = <div style={{ width: mobileMode ? '100%' : knobSizePx + 12 }} />;

  // ── Reset / Randomize ──
  const resetDynamics = () => onUpdate({
    masterVolume: DEFAULT_MOD.masterVolume, tempo: DEFAULT_MOD.tempo, drift: DEFAULT_MOD.drift,
    pulseLength: DEFAULT_MOD.pulseLength, pulseSmooth: DEFAULT_MOD.pulseSmooth,
    envAttack: DEFAULT_MOD.envAttack, envRelease: DEFAULT_MOD.envRelease,
  });
  const randDynamics = () => onUpdate({
    masterVolume: rand(0.3, 1), drift: rand(0.3, 1.5),
    pulseLength: rand(0.1, 0.9), pulseSmooth: rand(0, 1),
    envAttack: rand(10, 80), envRelease: rand(20, 90),
  });

  const resetSpace = () => {
    setReverbType(DEFAULT_MOD.reverbType);
    onUpdate({
      reverbType: DEFAULT_MOD.reverbType, reverbSize: DEFAULT_MOD.reverbSize,
      reverbDecay: DEFAULT_MOD.reverbDecay, reverbPreDelay: DEFAULT_MOD.reverbPreDelay,
      reverbParam1: DEFAULT_MOD.reverbParam1, reverbParam2: DEFAULT_MOD.reverbParam2,
      reverbMix: DEFAULT_MOD.reverbMix, delayTime: DEFAULT_MOD.delayTime,
      delayFeedback: DEFAULT_MOD.delayFeedback, delayMix: DEFAULT_MOD.delayMix,
    });
  };
  const randSpace = () => {
    const rt = pick<ReverbType>(['ROOM', 'HALL', 'GRANULAR', 'LOFI', 'SPATIAL', 'MASSIVE']);
    setReverbType(rt);
    onUpdate({
      reverbType: rt, reverbSize: rand(0.4, 0.9), reverbDecay: rand(0.3, 0.8),
      reverbPreDelay: rand(0, 60), reverbParam1: rand(0.2, 0.8), reverbParam2: rand(0.2, 0.8),
      reverbMix: rand(20, 100), delayTime: rand(0.1, 0.8),
      delayFeedback: rand(0.2, 0.7), delayMix: rand(0.1, 0.6),
    });
  };

  const resetMod = () => onUpdate({
    chorusRate: DEFAULT_MOD.chorusRate, chorusDepth: DEFAULT_MOD.chorusDepth, chorusMix: DEFAULT_MOD.chorusMix,
    phaserRate: DEFAULT_MOD.phaserRate, phaserDepth: DEFAULT_MOD.phaserDepth, phaserMix: DEFAULT_MOD.phaserMix,
    flangerRate: DEFAULT_MOD.flangerRate, flangerDepth: DEFAULT_MOD.flangerDepth,
    flangerFeedback: DEFAULT_MOD.flangerFeedback,
    detune: DEFAULT_MOD.detune, detuneSpread: DEFAULT_MOD.detuneSpread, detuneMix: DEFAULT_MOD.detuneMix,
  });
  const randMod = () => onUpdate({
    chorusRate: rand(0.1, 2), chorusDepth: rand(0.1, 0.6), chorusMix: rand(0.1, 0.6),
    phaserRate: rand(0.1, 3), phaserDepth: rand(0.2, 0.7), phaserMix: rand(0.1, 0.5),
    flangerRate: rand(0.1, 1), flangerDepth: rand(0.1, 0.5), flangerFeedback: rand(0.2, 0.7),
    detune: rand(0, 30), detuneSpread: rand(0, 30), detuneMix: rand(0.1, 0.5),
  });

  const resetFilter = () => {
    setFilterType(DEFAULT_MOD.filterType);
    onUpdate({
      filterCutoff: DEFAULT_MOD.filterCutoff, filterResonance: DEFAULT_MOD.filterResonance,
      filterDrive: DEFAULT_MOD.filterDrive, filterType: DEFAULT_MOD.filterType,
    });
  };
  const randFilter = () => {
    const ft = pick<FilterType>(['LP', 'HP', 'BP', 'NOTCH']);
    setFilterType(ft);
    onUpdate({ filterCutoff: rand(24, 85), filterResonance: rand(0, 77), filterDrive: rand(0, 0.5), filterType: ft });
  };

  const resetLfo = () => {
    setLfo1Shape('SINE'); setLfo1Target('PITCH'); setLfo1Sync(false);
    setLfo2Shape('SINE'); setLfo2Target('FILTER'); setLfo2Sync(false);
    onUpdate({
      lfo1Rate: DEFAULT_MOD.lfo1Rate, lfo1Depth: DEFAULT_MOD.lfo1Depth, lfo1Phase: DEFAULT_MOD.lfo1Phase,
      lfo1Shape: DEFAULT_MOD.lfo1Shape, lfo1Target: DEFAULT_MOD.lfo1Target, lfo1Sync: DEFAULT_MOD.lfo1Sync,
      lfo2Rate: DEFAULT_MOD.lfo2Rate, lfo2Depth: DEFAULT_MOD.lfo2Depth, lfo2Phase: DEFAULT_MOD.lfo2Phase,
      lfo2Shape: DEFAULT_MOD.lfo2Shape, lfo2Target: DEFAULT_MOD.lfo2Target, lfo2Sync: DEFAULT_MOD.lfo2Sync,
    });
  };
  const randLfo = () => {
    const t1 = pick<LfoTarget>(['PITCH', 'FILTER', 'VOLUME']);
    const t2 = pick<LfoTarget>(['PITCH', 'FILTER', 'VOLUME']);
    setLfo1Target(t1); setLfo2Target(t2);
    onUpdate({
      lfo1Rate: rand(0.05, 4), lfo1Depth: rand(0.1, 0.7), lfo1Target: t1,
      lfo2Rate: rand(0.05, 4), lfo2Depth: rand(0.1, 0.7), lfo2Target: t2,
    });
  };

  const zeroAllFx = () => {
    setZeroPulse(true);
    setTimeout(() => setZeroPulse(false), 200);
    onUpdate({
      reverbSize: 0, reverbDecay: 0, reverbPreDelay: 0,
      reverbParam1: 0, reverbParam2: 0, reverbMix: 0,
      delayFeedback: 0, delayMix: 0,
      chorusMix: 0, phaserMix: 0,
      flangerFeedback: 0, flangerDepth: 0,
      detune: 0, detuneSpread: 0, detuneMix: 0,
      filterCutoff: 100, filterResonance: 0, filterDrive: 0,
      lfo1Depth: 0, lfo2Depth: 0,
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE TAB CONTENT — three separate blocks, only active one renders
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Tab 0: SHAPE (Dynamics + Filter) ──
  const tabShape = (
    <div className="flex flex-col" style={{ gap: sectionGap }}>
      {/* ═══ DYNAMICS ═══ */}
      <div>
        <SectionHeader label="DYNAMICS" onReset={resetDynamics} onRandomize={randDynamics} mobileMode={true} />
        <div style={knobGrid()}>
          {K('masterVolume', 'VOLUME', 0, 1, m.masterVolume)}
          {K('tempo', 'TEMPO', 40, 200, m.tempo)}
          {K('drift', 'DRIFT', 0.1, 2, m.drift)}
        </div>
        <div style={{
          marginTop: '16px',
          marginBottom: '8px',
          height: '100px',
        }}>
          <EnvelopeDisplay
            envAttack={m.envAttack}
            envRelease={m.envRelease}
            playMode={playMode}
            tempo={m.tempo}
            onChange={(atk, rel) => onUpdate({ envAttack: atk, envRelease: rel })}
          />
        </div>
        <div style={knobGrid({ marginTop: '8px' })}>
          {K('envAttack', 'ATTACK', 0, 100, m.envAttack)}
          {K('envRelease', 'RELEASE', 0, 100, m.envRelease, playMode === 'drone')}
          {spacer}
        </div>
        <div style={knobGrid()}>
          {K('pulseLength', 'PULSE\nLEN', 0.1, 0.9, m.pulseLength, playMode !== 'pulse')}
          {K('pulseSmooth', 'SMOOTH', 0, 1, m.pulseSmooth, playMode !== 'pulse')}
          {spacer}
        </div>
      </div>

      {/* ═══ FILTER ═══ */}
      <div>
        <SectionHeader label="FILTER" onReset={resetFilter} onRandomize={randFilter} mobileMode={true} />
        <div style={knobGrid()}>
          {K('filterCutoff', 'CUTOFF', 0, 100, m.filterCutoff)}
          {K('filterResonance', 'RES', 0, 100, m.filterResonance)}
          {K('filterDrive', 'DRIVE', 0, 1, m.filterDrive)}
        </div>
        <div style={{ marginTop: '12px' }}>
          <ToggleRow
            options={['LP', 'HP', 'BP', 'NOTCH', 'LADDER', 'SEM']}
            active={filterType}
            ariaLabel="Filter type"
            onChange={v => { setFilterType(v); onUpdate({ filterType: v as FilterType }); }}
            mobileMode={true}
          />
        </div>
      </div>

      <div className="h-8" />
    </div>
  );

  // ── Tab 1: FX (Modulation + Space + Granular Cloud) ──
  const tabFx = (
    <div className="flex flex-col" style={{ gap: sectionGap }}>
      {/* ═══ MODULATION ═══ */}
      <div>
        <SectionHeader label="MODULATION" onReset={resetMod} onRandomize={randMod} mobileMode={true} />
        <div style={knobGrid()}>
          {K('chorusRate', 'CHR\nRATE', 0.1, 8, m.chorusRate)}
          {K('chorusDepth', 'CHR\nDEPTH', 0, 1, m.chorusDepth)}
          {K('chorusMix', 'CHR\nMIX', 0, 1, m.chorusMix)}
        </div>
        <div style={knobGrid()}>
          {K('phaserRate', 'PH\nRATE', 0.05, 4, m.phaserRate)}
          {K('phaserDepth', 'PH\nDEPTH', 0, 1, m.phaserDepth)}
          {K('phaserMix', 'PH\nMIX', 0, 1, m.phaserMix)}
        </div>
        <div style={knobGrid()}>
          {K('flangerRate', 'FL\nRATE', 0.05, 4, m.flangerRate)}
          {K('flangerDepth', 'FL\nDEPTH', 0, 1, m.flangerDepth)}
          {K('flangerFeedback', 'FL\nFDBK', 0, 0.95, m.flangerFeedback)}
        </div>
        <div style={knobGrid()}>
          {K('detune', 'DETUNE', 0, 50, m.detune)}
          {K('detuneSpread', 'DET\nSPREAD', 0, 50, m.detuneSpread)}
          {K('detuneMix', 'DET\nMIX', 0, 1, m.detuneMix)}
        </div>
      </div>

      {/* ═══ SPACE ═══ */}
      <div>
        <SectionHeader label="SPACE" onReset={resetSpace} onRandomize={randSpace} mobileMode={true} />
        <div style={{ marginTop: '12px' }}>
          <ToggleRow
            options={['ROOM', 'HALL', 'GRANULAR', 'LOFI', 'SPATIAL', 'MASSIVE']}
            active={reverbType}
            ariaLabel="Reverb type"
            onChange={v => { setReverbType(v); onUpdate({ reverbType: v as ReverbType }); }}
            mobileMode={true}
          />
        </div>
        <div style={knobGrid()}>
          {K('reverbSize', 'SIZE', 0, 1, m.reverbSize)}
          {K('reverbDecay', 'DECAY', 0, 1, m.reverbDecay)}
          {K('reverbPreDelay', 'PRE-DLY', 0, 80, m.reverbPreDelay)}
        </div>
        <div style={knobGrid()}>
          {K('reverbParam1', p1Label, 0, 1, m.reverbParam1)}
          {K('reverbParam2', p2Label, 0, 1, m.reverbParam2)}
          {K('reverbMix', 'MIX', 0, 100, m.reverbMix)}
        </div>
        <div style={knobGrid()}>
          {K('delayTime', 'DLY TIME', 0.01, 1.5, m.delayTime)}
          {K('delayFeedback', 'DLY FDBK', 0, 0.92, m.delayFeedback)}
          {K('delayMix', 'DLY MIX', 0, 1, m.delayMix)}
        </div>
      </div>

      {/* ═══ GRANULAR CLOUD ═══ */}
      <div>
        <SectionHeader
          label="GRANULAR CLOUD"
          onReset={() => {
            setGrainFreeze(false);
            setGrainReverse(false);
            onUpdate({
              grainSize: DEFAULT_MOD.grainSize, grainScatter: DEFAULT_MOD.grainScatter,
              grainDensity: DEFAULT_MOD.grainDensity, grainPitchSpread: DEFAULT_MOD.grainPitchSpread,
              grainFreeze: false, grainReverse: false,
            });
          }}
          onRandomize={() => {
            onUpdate({
              grainSize: rand(10, 500), grainScatter: rand(0, 1),
              grainDensity: rand(4, 60), grainPitchSpread: rand(0, 24),
            });
          }}
          powerActive={grainCloudActive}
          onPowerToggle={v => { setGrainCloudActive(v); onUpdate({ grainCloudActive: v }); }}
          mobileMode={true}
        />
        <div style={knobGrid()}>
          {K('grainSize', 'SIZE', 10, 500, m.grainSize, !grainCloudActive)}
          {K('grainScatter', 'SCATTER', 0, 1, m.grainScatter, !grainCloudActive)}
          {K('grainDensity', 'DENSITY', 4, 60, m.grainDensity, !grainCloudActive)}
        </div>
        <div style={knobGrid()}>
          {K('grainPitchSpread', 'PITCH\nSPRD', 0, 24, m.grainPitchSpread, !grainCloudActive)}
          {spacer}
          {spacer}
        </div>
        <div style={{ marginTop: '12px', ...grid2Style }}>
          <ToggleBtn
            label="FREEZE" active={grainFreeze} disabled={!grainCloudActive}
            onChange={v => { if (!grainCloudActive) return; setGrainFreeze(v); onUpdate({ grainFreeze: v }); }}
            mobileMode={true}
          />
          <ToggleBtn
            label="REV" active={grainReverse} disabled={!grainCloudActive}
            onChange={v => { if (!grainCloudActive) return; setGrainReverse(v); onUpdate({ grainReverse: v }); }}
            mobileMode={true}
          />
        </div>
      </div>

      <div className="h-8" />
    </div>
  );

  // ── Tab 2: LFO ──
  const tabLfo = (
    <div className="flex flex-col" style={{ gap: sectionGap }}>
      <SectionHeader label="LFO" onReset={resetLfo} onRandomize={randLfo} mobileMode={true} />

      {/* LFO 1 */}
      <div>
        <div className="tracking-widest" style={{ fontSize: '10px', color: 'var(--fm-text-secondary)', marginBottom: '8px' }}>LFO 1</div>
        <div style={knobGrid({ marginTop: '0' })}>
          {K('lfo1Rate', 'RATE', 0.01, 20, m.lfo1Rate)}
          {K('lfo1Depth', 'DEPTH', 0, 1, m.lfo1Depth)}
          {K('lfo1Phase', 'PHASE', 0, 360, m.lfo1Phase)}
        </div>
        <div style={{ marginTop: '12px' }}>
          <div style={grid3Style} role="radiogroup" aria-label="LFO 1 shape">
            {LFO_SHAPES.map(s => {
              const on = lfo1Shape === s;
              return (
                <button
                  key={s} role="radio" aria-checked={on} title={s}
                  onClick={e => { e.stopPropagation(); setLfo1Shape(s); onUpdate({ lfo1Shape: s as LfoShape }); }}
                  style={{ ...gridBtnStyle(on, true), fontSize: '14px', cursor: 'pointer' }}
                >
                  {LFO_ICONS[s as LfoShape]}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: '6px' }}>
          <button
            onClick={e => { e.stopPropagation(); setLfo1Sync(prev => { const next = !prev; onUpdate({ lfo1Sync: next }); return next; }); }}
            style={{ ...gridBtnStyle(lfo1Sync, true), width: '100%', cursor: 'pointer' }}
            aria-pressed={lfo1Sync}
          >
            SYNC
          </button>
        </div>
        <div style={{ marginTop: '8px', marginBottom: '4px' }}>
          <div style={grid3Style} role="radiogroup" aria-label="LFO 1 target">
            {LFO_TARGETS.map(t => {
              const on = lfo1Target === t;
              return (
                <button
                  key={t} role="radio" aria-checked={on}
                  onClick={e => { e.stopPropagation(); setLfo1Target(t); onUpdate({ lfo1Target: t as LfoTarget }); }}
                  style={{ ...gridBtnStyle(on, true), cursor: 'pointer' }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-px" style={{ backgroundColor: 'var(--fm-divider)' }} />

      {/* LFO 2 */}
      <div>
        <div className="tracking-widest" style={{ fontSize: '10px', color: 'var(--fm-text-secondary)', marginBottom: '8px' }}>LFO 2</div>
        <div style={knobGrid({ marginTop: '0' })}>
          {K('lfo2Rate', 'RATE', 0.01, 20, m.lfo2Rate)}
          {K('lfo2Depth', 'DEPTH', 0, 1, m.lfo2Depth)}
          {K('lfo2Phase', 'PHASE', 0, 360, m.lfo2Phase)}
        </div>
        <div style={{ marginTop: '12px' }}>
          <div style={grid3Style} role="radiogroup" aria-label="LFO 2 shape">
            {LFO_SHAPES.map(s => {
              const on = lfo2Shape === s;
              return (
                <button
                  key={s} role="radio" aria-checked={on} title={s}
                  onClick={e => { e.stopPropagation(); setLfo2Shape(s); onUpdate({ lfo2Shape: s as LfoShape }); }}
                  style={{ ...gridBtnStyle(on, true), fontSize: '14px', cursor: 'pointer' }}
                >
                  {LFO_ICONS[s as LfoShape]}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: '6px' }}>
          <button
            onClick={e => { e.stopPropagation(); setLfo2Sync(prev => { const next = !prev; onUpdate({ lfo2Sync: next }); return next; }); }}
            style={{ ...gridBtnStyle(lfo2Sync, true), width: '100%', cursor: 'pointer' }}
            aria-pressed={lfo2Sync}
          >
            SYNC
          </button>
        </div>
        <div style={{ marginTop: '8px', marginBottom: '4px' }}>
          <div style={grid3Style} role="radiogroup" aria-label="LFO 2 target">
            {LFO_TARGETS.map(t => {
              const on = lfo2Target === t;
              return (
                <button
                  key={t} role="radio" aria-checked={on}
                  onClick={e => { e.stopPropagation(); setLfo2Target(t); onUpdate({ lfo2Target: t as LfoTarget }); }}
                  style={{ ...gridBtnStyle(on, true), cursor: 'pointer' }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-8" />
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // DESKTOP panelContent — single scrollable column (unchanged)
  // ═══════════════════════════════════════════════════════════════════════════

  const panelContent = (
    <div className="flex flex-col" style={{ minWidth: '200px', gap: sectionGap }}>

      {/* Header + zero button */}
      <div className="flex items-center justify-between">
        <div className="tracking-widest" style={{ fontSize: '10px', color: 'var(--fm-accent)', opacity: 0.55 }}>
          SOUND SCULPTOR
        </div>
        <button
          onClick={zeroAllFx}
          title="Zero all parameters"
          className="w-7 h-7 flex items-center justify-center border transition-all duration-200 active:opacity-60"
          style={{
            color: zeroPulse ? 'var(--fm-accent)' : 'var(--fm-text-muted)',
            border: zeroPulse ? '1.5px solid var(--fm-accent)' : '1px solid var(--fm-section-btn-border)',
            backgroundColor: zeroPulse ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-section-btn-bg)',
            filter: 'none',
            cursor: 'pointer',
          }}
        >
          <Minus size={14} />
        </button>
      </div>

      {/* Knob value HUD — desktop only */}
      {activeKnob && tempVal !== null && (
        <div
          className="fixed top-2 right-[240px] px-2 py-1 border whitespace-nowrap z-50"
          style={{ fontSize: '10px', backgroundColor: 'var(--fm-panel-bg)', borderColor: 'var(--fm-section-btn-border)', color: 'var(--fm-accent)' }}
        >
          {activeKnob.toUpperCase()}: {Math.round((tempVal ?? 0) * 100) / 100}
        </div>
      )}

      {/* ═══ DYNAMICS ═══ */}
      <div>
        <SectionHeader label="DYNAMICS" onReset={resetDynamics} onRandomize={randDynamics} />
        <div style={knobGrid()}>
          {K('masterVolume', 'VOLUME', 0, 1, m.masterVolume)}
          {K('tempo', 'TEMPO', 40, 200, m.tempo)}
          {K('drift', 'DRIFT', 0.1, 2, m.drift)}
        </div>
        <div style={{ marginTop: '12px' }}>
          <EnvelopeDisplay
            envAttack={m.envAttack}
            envRelease={m.envRelease}
            playMode={playMode}
            tempo={m.tempo}
            onChange={(atk, rel) => onUpdate({ envAttack: atk, envRelease: rel })}
          />
        </div>
        <div style={knobGrid({ marginTop: '8px' })}>
          {K('envAttack', 'ATTACK', 0, 100, m.envAttack)}
          {K('envRelease', 'RELEASE', 0, 100, m.envRelease, playMode === 'drone')}
          {spacer}
        </div>
        <div style={knobGrid()}>
          {K('pulseLength', 'PULSE\nLEN', 0.1, 0.9, m.pulseLength, playMode !== 'pulse')}
          {K('pulseSmooth', 'SMOOTH', 0, 1, m.pulseSmooth, playMode !== 'pulse')}
          {spacer}
        </div>
      </div>

      {/* ═══ FILTER ═══ */}
      <div>
        <SectionHeader label="FILTER" onReset={resetFilter} onRandomize={randFilter} />
        <div style={knobGrid()}>
          {K('filterCutoff', 'CUTOFF', 0, 100, m.filterCutoff)}
          {K('filterResonance', 'RES', 0, 100, m.filterResonance)}
          {K('filterDrive', 'DRIVE', 0, 1, m.filterDrive)}
        </div>
        <div style={{ marginTop: '10px', marginBottom: '4px' }}>
          <ToggleRow
            options={['LP', 'HP', 'BP', 'NOTCH', 'LADDER', 'SEM']}
            active={filterType}
            ariaLabel="Filter type"
            onChange={v => { setFilterType(v); onUpdate({ filterType: v as FilterType }); }}
          />
        </div>
      </div>

      {/* ═══ MODULATION ═══ */}
      <div>
        <SectionHeader label="MODULATION" onReset={resetMod} onRandomize={randMod} />
        <div style={knobGrid()}>
          {K('chorusRate', 'CHR\nRATE', 0.1, 8, m.chorusRate)}
          {K('chorusDepth', 'CHR\nDEPTH', 0, 1, m.chorusDepth)}
          {K('chorusMix', 'CHR\nMIX', 0, 1, m.chorusMix)}
        </div>
        <div style={knobGrid()}>
          {K('phaserRate', 'PH\nRATE', 0.05, 4, m.phaserRate)}
          {K('phaserDepth', 'PH\nDEPTH', 0, 1, m.phaserDepth)}
          {K('phaserMix', 'PH\nMIX', 0, 1, m.phaserMix)}
        </div>
        <div style={knobGrid()}>
          {K('flangerRate', 'FL\nRATE', 0.05, 4, m.flangerRate)}
          {K('flangerDepth', 'FL\nDEPTH', 0, 1, m.flangerDepth)}
          {K('flangerFeedback', 'FL\nFDBK', 0, 0.95, m.flangerFeedback)}
        </div>
        <div style={knobGrid()}>
          {K('detune', 'DETUNE', 0, 50, m.detune)}
          {K('detuneSpread', 'DET\nSPREAD', 0, 50, m.detuneSpread)}
          {K('detuneMix', 'DET\nMIX', 0, 1, m.detuneMix)}
        </div>
      </div>

      {/* ═══ SPACE ═══ */}
      <div style={{ pointerEvents: 'all' }}>
        <SectionHeader label="SPACE" onReset={resetSpace} onRandomize={randSpace} />
        <div style={{ marginTop: '10px', marginBottom: '4px' }}>
          <ToggleRow
            options={['ROOM', 'HALL', 'GRANULAR', 'LOFI', 'SPATIAL', 'MASSIVE']}
            active={reverbType}
            ariaLabel="Reverb type"
            onChange={v => { setReverbType(v); onUpdate({ reverbType: v as ReverbType }); }}
          />
        </div>
        <div style={knobGrid({ pointerEvents: 'all' })}>
          {K('reverbSize', 'SIZE', 0, 1, m.reverbSize)}
          {K('reverbDecay', 'DECAY', 0, 1, m.reverbDecay)}
          {K('reverbPreDelay', 'PRE-DLY', 0, 80, m.reverbPreDelay)}
        </div>
        <div style={knobGrid({ pointerEvents: 'all' })}>
          {K('reverbParam1', p1Label, 0, 1, m.reverbParam1)}
          {K('reverbParam2', p2Label, 0, 1, m.reverbParam2)}
          {K('reverbMix', 'MIX', 0, 100, m.reverbMix)}
        </div>
        <div style={knobGrid({ pointerEvents: 'all' })}>
          {K('delayTime', 'DLY TIME', 0.01, 1.5, m.delayTime)}
          {K('delayFeedback', 'DLY FDBK', 0, 0.92, m.delayFeedback)}
          {K('delayMix', 'DLY MIX', 0, 1, m.delayMix)}
        </div>
      </div>

      {/* ═══ GRANULAR CLOUD ═══ */}
      <div>
        <SectionHeader
          label="GRANULAR CLOUD"
          onReset={() => {
            setGrainFreeze(false);
            setGrainReverse(false);
            onUpdate({
              grainSize: DEFAULT_MOD.grainSize, grainScatter: DEFAULT_MOD.grainScatter,
              grainDensity: DEFAULT_MOD.grainDensity, grainPitchSpread: DEFAULT_MOD.grainPitchSpread,
              grainFreeze: false, grainReverse: false,
            });
          }}
          onRandomize={() => {
            onUpdate({
              grainSize: rand(10, 500), grainScatter: rand(0, 1),
              grainDensity: rand(4, 60), grainPitchSpread: rand(0, 24),
            });
          }}
          powerActive={grainCloudActive}
          onPowerToggle={v => { setGrainCloudActive(v); onUpdate({ grainCloudActive: v }); }}
        />
        <div style={knobGrid()}>
          {K('grainSize', 'SIZE', 10, 500, m.grainSize, !grainCloudActive)}
          {K('grainScatter', 'SCATTER', 0, 1, m.grainScatter, !grainCloudActive)}
          {K('grainDensity', 'DENSITY', 4, 60, m.grainDensity, !grainCloudActive)}
        </div>
        <div style={knobGrid()}>
          {K('grainPitchSpread', 'PITCH\nSPRD', 0, 24, m.grainPitchSpread, !grainCloudActive)}
          {spacer}
          {spacer}
        </div>
        <div style={{ marginTop: '10px', marginBottom: '4px', ...grid2Style }}>
          <ToggleBtn
            label="FREEZE" active={grainFreeze} disabled={!grainCloudActive}
            onChange={v => { if (!grainCloudActive) return; setGrainFreeze(v); onUpdate({ grainFreeze: v }); }}
          />
          <ToggleBtn
            label="REV" active={grainReverse} disabled={!grainCloudActive}
            onChange={v => { if (!grainCloudActive) return; setGrainReverse(v); onUpdate({ grainReverse: v }); }}
          />
        </div>
      </div>

      {/* ═══ LFO ═══ */}
      <div style={{ pointerEvents: 'all' }}>
        <SectionHeader label="LFO" onReset={resetLfo} onRandomize={randLfo} />

        <div className="tracking-widest mt-3" style={{ fontSize: '10px', color: 'var(--fm-text-secondary)' }}>LFO 1</div>
        <div style={knobGrid({ marginTop: '8px' })}>
          {K('lfo1Rate', 'RATE', 0.01, 20, m.lfo1Rate)}
          {K('lfo1Depth', 'DEPTH', 0, 1, m.lfo1Depth)}
          {K('lfo1Phase', 'PHASE', 0, 360, m.lfo1Phase)}
        </div>
        <div style={{ marginTop: '8px' }}>
          <div style={grid3Style} role="radiogroup" aria-label="LFO 1 shape">
            {LFO_SHAPES.map(s => {
              const on = lfo1Shape === s;
              return (
                <button
                  key={s} role="radio" aria-checked={on} title={s}
                  onClick={e => { e.stopPropagation(); setLfo1Shape(s); onUpdate({ lfo1Shape: s as LfoShape }); }}
                  style={{ ...gridBtnStyle(on), fontSize: '14px', pointerEvents: 'all', cursor: 'pointer' }}
                >
                  {LFO_ICONS[s as LfoShape]}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: '6px' }}>
          <button
            onClick={e => { e.stopPropagation(); setLfo1Sync(prev => { const next = !prev; onUpdate({ lfo1Sync: next }); return next; }); }}
            style={{ ...gridBtnStyle(lfo1Sync), width: '100%', pointerEvents: 'all', cursor: 'pointer' }}
            aria-pressed={lfo1Sync}
          >
            SYNC
          </button>
        </div>
        <div style={{ marginTop: '8px', marginBottom: '4px' }}>
          <div style={grid3Style} role="radiogroup" aria-label="LFO 1 target">
            {LFO_TARGETS.map(t => {
              const on = lfo1Target === t;
              return (
                <button
                  key={t} role="radio" aria-checked={on}
                  onClick={e => { e.stopPropagation(); setLfo1Target(t); onUpdate({ lfo1Target: t as LfoTarget }); }}
                  style={{ ...gridBtnStyle(on), pointerEvents: 'all', cursor: 'pointer' }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-px my-3" style={{ backgroundColor: 'var(--fm-divider)' }} />

        <div className="tracking-widest" style={{ fontSize: '10px', color: 'var(--fm-text-secondary)' }}>LFO 2</div>
        <div style={knobGrid({ marginTop: '8px' })}>
          {K('lfo2Rate', 'RATE', 0.01, 20, m.lfo2Rate)}
          {K('lfo2Depth', 'DEPTH', 0, 1, m.lfo2Depth)}
          {K('lfo2Phase', 'PHASE', 0, 360, m.lfo2Phase)}
        </div>
        <div style={{ marginTop: '8px' }}>
          <div style={grid3Style} role="radiogroup" aria-label="LFO 2 shape">
            {LFO_SHAPES.map(s => {
              const on = lfo2Shape === s;
              return (
                <button
                  key={s} role="radio" aria-checked={on} title={s}
                  onClick={e => { e.stopPropagation(); setLfo2Shape(s); onUpdate({ lfo2Shape: s as LfoShape }); }}
                  style={{ ...gridBtnStyle(on), fontSize: '14px', pointerEvents: 'all', cursor: 'pointer' }}
                >
                  {LFO_ICONS[s as LfoShape]}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: '6px' }}>
          <button
            onClick={e => { e.stopPropagation(); setLfo2Sync(prev => { const next = !prev; onUpdate({ lfo2Sync: next }); return next; }); }}
            style={{ ...gridBtnStyle(lfo2Sync), width: '100%', pointerEvents: 'all', cursor: 'pointer' }}
            aria-pressed={lfo2Sync}
          >
            SYNC
          </button>
        </div>
        <div style={{ marginTop: '8px', marginBottom: '4px' }}>
          <div style={grid3Style} role="radiogroup" aria-label="LFO 2 target">
            {LFO_TARGETS.map(t => {
              const on = lfo2Target === t;
              return (
                <button
                  key={t} role="radio" aria-checked={on}
                  onClick={e => { e.stopPropagation(); setLfo2Target(t); onUpdate({ lfo2Target: t as LfoTarget }); }}
                  style={{ ...gridBtnStyle(on), pointerEvents: 'all', cursor: 'pointer' }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-8" />
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE RETURN — fixed header with tab bar + scrollable tab content
  // ═══════════════════════════════════════════════════════════════════════════

  if (mobileMode) {
    const tabContent = [tabShape, tabFx, tabLfo][activeTab];

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <style>{`
          .knob-element:not(.opacity-30):active {
            box-shadow: var(--fm-knob-shadow-active) !important;
            transform: scale(0.97);
          }
          .knob-element {
            transition: transform 80ms ease, box-shadow 80ms ease;
          }
        `}</style>

        {/* ── Fixed header: title + zero button + tab bar ── */}
        <div style={{ padding: '0 14px 0', flexShrink: 0 }}>
          {/* Title row */}
          <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
            <div className="tracking-widest"
              style={{ fontSize: '10px', color: 'var(--fm-accent)', opacity: 0.55 }}>
              SOUND SCULPTOR
            </div>
            <button
              onClick={zeroAllFx}
              title="Zero all parameters"
              className="w-9 h-9 flex items-center justify-center border transition-all duration-200 active:opacity-60"
              style={{
                color: zeroPulse ? 'var(--fm-accent)' : 'var(--fm-text-muted)',
                border: zeroPulse ? '1.5px solid var(--fm-accent)' : '1px solid var(--fm-section-btn-border)',
                backgroundColor: zeroPulse ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-section-btn-bg)',
                filter: 'none',
                cursor: 'pointer',
              }}
            >
              <Minus size={16} />
            </button>
          </div>

          {/* Tab bar */}
          <TabBar active={activeTab} onChange={handleTabChange} />
        </div>

        {/* ── Scrollable tab content with top fade gradient ── */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          {/* Top scroll fade gradient — sits below tab bar */}
          <div
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '32px',
              background: 'linear-gradient(to bottom, var(--fm-panel-bg) 0%, var(--fm-panel-bg) 20%, transparent 100%)',
              pointerEvents: 'none', zIndex: 10,
              opacity: scrollFaded ? 1 : 0,
              transition: 'opacity 200ms ease',
            }}
          />
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const top = (e.target as HTMLElement).scrollTop;
              setScrollFaded(top > 8);
              onScroll?.(top);
            }}
            style={{
              height: '100%',
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: '16px 14px 24px',
              scrollbarWidth: 'thin',
              scrollbarColor: 'var(--fm-scrollbar-thumb) var(--fm-scrollbar-track)',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {tabContent}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DESKTOP RETURN — fixed right sidebar (unchanged)
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="fixed top-0 right-0 h-full z-30 flex" style={{ pointerEvents: 'none' }}>
      <style>{`
        .knob-element:not(.opacity-30):active {
          box-shadow: var(--fm-knob-shadow-active) !important;
          transform: scale(0.97);
        }
        .knob-element {
          transition: transform 80ms ease, box-shadow 80ms ease;
        }
      `}</style>
      <div className="flex flex-col items-end self-start mt-4 gap-1" style={{ pointerEvents: 'auto' }}>
        <button
          onClick={() => handleToggle(!isOpen)}
          className="w-7 h-10 flex items-center justify-center backdrop-blur-sm border border-r-0 transition-all duration-300"
          style={{ backgroundColor: 'var(--fm-panel-bg)', borderColor: 'var(--fm-section-btn-border)' }}
          aria-label={isOpen ? 'Collapse Sound Sculptor panel' : 'Expand Sound Sculptor panel'}
        >
          {isOpen
            ? <ChevronRight size={12} style={{ color: 'var(--fm-text-muted)' }} />
            : <ChevronLeft size={12} style={{ color: 'var(--fm-text-muted)' }} />
          }
        </button>
      </div>
      <div
        className="h-full border-l transition-all duration-300 ease-out overflow-y-auto overflow-x-hidden sculptor-scroll"
        ref={scrollRef}
        style={{
          width: isOpen ? '220px' : '0px',
          padding: isOpen ? '16px 10px' : '16px 0',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--fm-scrollbar-thumb) var(--fm-scrollbar-track)',
          backgroundColor: 'var(--fm-panel-bg)',
          borderColor: 'var(--fm-panel-border)',
          ...(isTouch ? { WebkitOverflowScrolling: 'touch' } : {}),
        }}
      >
        {panelContent}
      </div>
    </div>
  );
}