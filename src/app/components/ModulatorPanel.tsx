// SOUND SCULPTOR Panel — 3-column knob layout, expanded by default
// Per-section Reset and Randomize buttons
// Section order: DYNAMICS → FILTER → MODULATION → SPACE → GRANULAR CLOUD → LFO

import { useState, useCallback, useEffect, useRef } from 'react';
import { ModulatorSettings, ReverbType, FilterType, LfoShape, LfoTarget, DEFAULT_MOD } from '../utils/audioEngine';
import { ChevronRight, ChevronLeft, RotateCcw, Dice5, Minus, Power } from 'lucide-react';
import type { PlayMode } from '../utils/audioEngine';
import { EnvelopeDisplay } from './EnvelopeDisplay';

interface Props {
  modulators: ModulatorSettings;
  onUpdate: (s: Partial<ModulatorSettings>) => void;
  playMode?: PlayMode;
}

// ─── Knob ───
// Universal pointer-capture drag system: every knob uses identical interaction logic.
// Pointer capture ensures drag continues even when pointer leaves the element.
// Sensitivity: 1px vertical drag = 0.5% of knob range.
function Knob({ id, label, min, max, value, disabled, onValueChange, onDragStart, onDragEnd }: {
  id: string; label: string; min: number; max: number; value: number;
  disabled?: boolean;
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

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startVal: value };
    lastEmitRef.current = 0;
    onDragStart?.(id);
  }, [disabled, value, id, onDragStart]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - e.clientY;
    // 1px = 0.5% of range → 200px = full range
    const range = max - min;
    const nv = Math.max(min, Math.min(max, dragRef.current.startVal + (delta / 200) * range));
    // 16ms debounce: skip intermediate values, only process most recent per frame
    const now = performance.now();
    if (now - lastEmitRef.current < 16) {
      cancelAnimationFrame(pendingRafRef.current);
      pendingRafRef.current = requestAnimationFrame(() => {
        lastEmitRef.current = performance.now();
        onValueChange(nv);
      });
      return;
    }
    lastEmitRef.current = now;
    onValueChange(nv);
  }, [min, max, onValueChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    cancelAnimationFrame(pendingRafRef.current);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    dragRef.current = null;
    onDragEnd?.();
  }, [onDragEnd]);

  return (
    <div className="flex flex-col items-center gap-1" style={{ width: '56px', pointerEvents: 'all' }}>
      <div className="relative" style={{ pointerEvents: 'all' }}>
        <div
          className={`w-11 h-11 rounded-full relative ${disabled ? 'opacity-30' : 'cursor-ns-resize'}`}
          role="slider" aria-label={label.replace(/\n/g, ' ')}
          aria-valuemin={min} aria-valuemax={max}
          aria-valuenow={Math.round(safeValue * 100) / 100}
          tabIndex={disabled ? -1 : 0}
          data-min={min} data-max={max} data-value={safeValue}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ touchAction: 'none', pointerEvents: disabled ? 'none' : 'all', backgroundColor: 'var(--fm-knob-bg)', border: '1px solid var(--fm-knob-border)' }}
        >
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 44 44"
            style={{ transform: 'rotate(135deg)' }}>
            <circle cx="22" cy="22" r="17" fill="none" stroke="var(--fm-knob-track)"
              strokeWidth="2" strokeDasharray={`${arcLen} 1000`} strokeLinecap="round"
              style={{ strokeWidth: 'var(--fm-knob-arc-width, 2)' }} />
            <circle cx="22" cy="22" r="17" fill="none" stroke="var(--fm-accent)"
              strokeWidth="2" strokeDasharray={`${isFinite(valLen) ? valLen : 0} 1000`}
              strokeLinecap="round" style={{ strokeWidth: 'var(--fm-knob-arc-width, 2)', filter: 'drop-shadow(0 0 3px var(--fm-accent))' }} />
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
      </div>
      <div className="font-mono tracking-wider text-center whitespace-pre-line leading-tight"
        style={{ fontSize: '10px', color: 'var(--fm-text-secondary)' }}>
        {label}
      </div>
    </div>
  );
}

// ─── Universal grid button style ───
const gridBtnStyle = (on: boolean): React.CSSProperties => ({
  width: '100%',
  height: '26px',
  fontSize: '9px',
  fontFamily: 'monospace',
  letterSpacing: '0.05em',
  borderRadius: '3px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: on ? 'var(--fm-accent)' : 'var(--fm-text-secondary)',
  backgroundColor: on ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-btn-bg)',
  border: on ? '1.5px solid var(--fm-accent)' : '1px solid var(--fm-btn-border)',
  filter: on ? 'drop-shadow(0 0 4px var(--fm-accent))' : 'none',
  transition: 'all 150ms',
  cursor: 'pointer',
});

const grid3Style: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' };
const grid2Style: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' };

// ─── Toggle Row ───
function ToggleRow({ options, active, onChange, ariaLabel }: {
  options: string[]; active: string; onChange: (v: string) => void; ariaLabel: string;
}) {
  return (
    <div style={grid3Style} role="radiogroup" aria-label={ariaLabel}>
      {options.map(opt => {
        const on = active === opt;
        return (
          <button key={opt} role="radio" aria-checked={on}
            onClick={() => { if (opt !== active) onChange(opt); }}
            style={gridBtnStyle(on)}>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function ToggleBtn({ label, active, onChange, disabled }: { label: string; active: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button onClick={() => !disabled && onChange(!active)}
      style={{
        ...gridBtnStyle(active),
        opacity: disabled ? 0.3 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
      aria-pressed={active}>{label}</button>
  );
}

// ─── Section Header with Reset / Randomize / Power toggle ───
function SectionHeader({ label, onReset, onRandomize, powerActive, onPowerToggle }: {
  label: string; onReset?: () => void; onRandomize?: () => void;
  powerActive?: boolean; onPowerToggle?: (v: boolean) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="font-mono tracking-widest" style={{ fontSize: '10px', color: 'var(--fm-text-muted)' }}>{label}</div>
        </div>
        <div className="flex gap-1">
          {onReset && (
            <button onClick={onReset} title={`Reset ${label}`}
              className="w-7 h-7 flex items-center justify-center rounded border transition-all duration-150 active:opacity-60"
              style={{ color: 'var(--fm-text-muted)', backgroundColor: 'var(--fm-section-btn-bg)', borderColor: 'var(--fm-section-btn-border)' }}>
              <RotateCcw size={14} />
            </button>
          )}
          {onRandomize && (
            <button onClick={onRandomize} title={`Randomize ${label}`}
              className="w-7 h-7 flex items-center justify-center rounded border transition-all duration-150 active:opacity-60"
              style={{ color: 'var(--fm-text-muted)', backgroundColor: 'var(--fm-section-btn-bg)', borderColor: 'var(--fm-section-btn-border)' }}>
              <Dice5 size={14} />
            </button>
          )}
          {onPowerToggle && (
            <button onClick={() => onPowerToggle(!powerActive)} title={powerActive ? `Disable ${label}` : `Enable ${label}`}
              className="w-7 h-7 flex items-center justify-center rounded border transition-all duration-150 active:opacity-60"
              style={{
                color: powerActive ? 'var(--fm-accent)' : 'var(--fm-text-muted)',
                borderColor: powerActive ? 'var(--fm-accent)' : 'var(--fm-section-btn-border)',
                backgroundColor: powerActive ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-section-btn-bg)',
                border: powerActive ? '1.5px solid var(--fm-accent)' : '1px solid var(--fm-section-btn-border)',
                filter: powerActive ? 'drop-shadow(0 0 4px var(--fm-accent))' : 'none',
              }}>
              <Power size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="h-px mt-1" style={{ backgroundColor: 'var(--fm-divider)' }} />
    </div>
  );
}

const REVERB_LABELS: Record<ReverbType, [string, string]> = {
  ROOM: ['EARLY', 'DIFFUSE'], HALL: ['WIDTH', 'PRE-DLY'],
  GRANULAR: ['GR SIZE', 'DENSITY'], LOFI: ['CRUSH', 'WOW'],
  SPATIAL: ['SPREAD', 'HEIGHT'], MASSIVE: ['SWELL', 'DEPTH'],
};

const LFO_SHAPES: LfoShape[] = ['SINE', 'TRI', 'SQR', 'S&H', 'RAMP_UP', 'RAMP_DN'];
const LFO_ICONS: Record<LfoShape, string> = {
  'SINE': '∿', 'TRI': '△', 'SQR': '▢', 'S&H': '⊞', 'RAMP_UP': '⟋', 'RAMP_DN': '⟍',
};
const LFO_TARGETS: LfoTarget[] = ['PITCH', 'FILTER', 'VOLUME', 'PAN', 'REVERB', 'DELAY'];

function rand(min: number, max: number) { return min + Math.random() * (max - min); }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export function ModulatorPanel({ modulators: m, onUpdate, playMode }: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeKnob, setActiveKnob] = useState<string | null>(null);
  const [tempVal, setTempVal] = useState<number | null>(null);
  const [zeroPulse, setZeroPulse] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrollHintedRef = useRef(false);
  const userHasScrolledRef = useRef(false);

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

  // One-time scroll hint animation on first load
  useEffect(() => {
    if (hasScrollHintedRef.current) return;
    const el = scrollRef.current;
    if (!el || !isOpen) return;
    const timer = setTimeout(() => {
      if (userHasScrolledRef.current || hasScrollHintedRef.current) return;
      hasScrollHintedRef.current = true;
      el.scrollTo({ top: 50, behavior: 'smooth' });
      setTimeout(() => {
        el.scrollTo({ top: 0, behavior: 'smooth' });
      }, 750);
    }, 800);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Sync local toggle/selector state
  useEffect(() => { setFilterType(m.filterType || 'LP'); }, [m.filterType]);
  useEffect(() => { setReverbType(m.reverbType || 'ROOM'); }, [m.reverbType]);
  useEffect(() => { setLfo1Target(m.lfo1Target || 'PITCH'); }, [m.lfo1Target]);
  useEffect(() => { setLfo2Target(m.lfo2Target || 'FILTER'); }, [m.lfo2Target]);

  // Knob drag callbacks — lightweight wrappers for the HUD display.
  // All actual drag logic is inside the Knob component via pointer capture.
  // Also disables scroll on the panel container during knob drag to prevent interference.
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

  const K = (key: keyof ModulatorSettings, label: string, min: number, max: number, val: number, dis?: boolean) => (
    <Knob key={key} id={key} label={label} min={min} max={max} value={val} disabled={dis}
      onValueChange={(nv) => { setTempVal(nv); onUpdate({ [key]: nv } as any); }}
      onDragStart={handleKnobDragStart}
      onDragEnd={handleKnobDragEnd} />
  );

  const [p1Label, p2Label] = REVERB_LABELS[(reverbType as ReverbType) || 'ROOM'];

  // ── Reset/Randomize handlers ──
  const resetDynamics = () => onUpdate({ masterVolume: DEFAULT_MOD.masterVolume, tempo: DEFAULT_MOD.tempo, drift: DEFAULT_MOD.drift, pulseLength: DEFAULT_MOD.pulseLength, pulseSmooth: DEFAULT_MOD.pulseSmooth, envAttack: DEFAULT_MOD.envAttack, envRelease: DEFAULT_MOD.envRelease });
  const randDynamics = () => onUpdate({ masterVolume: rand(0.3, 1), drift: rand(0.3, 1.5), pulseLength: rand(0.1, 0.9), pulseSmooth: rand(0, 1), envAttack: rand(10, 80), envRelease: rand(20, 90) }); // never randomize tempo

  const resetSpace = () => {
    setReverbType(DEFAULT_MOD.reverbType);
    onUpdate({
      reverbType: DEFAULT_MOD.reverbType, reverbSize: DEFAULT_MOD.reverbSize, reverbDecay: DEFAULT_MOD.reverbDecay,
      reverbPreDelay: DEFAULT_MOD.reverbPreDelay, reverbParam1: DEFAULT_MOD.reverbParam1, reverbParam2: DEFAULT_MOD.reverbParam2,
      reverbMix: DEFAULT_MOD.reverbMix,
      delayTime: DEFAULT_MOD.delayTime, delayFeedback: DEFAULT_MOD.delayFeedback, delayMix: DEFAULT_MOD.delayMix,
    });
  };
  const randSpace = () => {
    const rt = pick<ReverbType>(['ROOM','HALL','GRANULAR','LOFI','SPATIAL','MASSIVE']);
    setReverbType(rt);
    onUpdate({
      reverbType: rt, reverbSize: rand(0.4, 0.9), reverbDecay: rand(0.3, 0.8),
      reverbPreDelay: rand(0, 60), reverbParam1: rand(0.2, 0.8), reverbParam2: rand(0.2, 0.8), reverbMix: rand(20, 100),
      delayTime: rand(0.1, 0.8), delayFeedback: rand(0.2, 0.7), delayMix: rand(0.1, 0.6),
    });
  };

  const resetMod = () => onUpdate({
    chorusRate: DEFAULT_MOD.chorusRate, chorusDepth: DEFAULT_MOD.chorusDepth, chorusMix: DEFAULT_MOD.chorusMix,
    phaserRate: DEFAULT_MOD.phaserRate, phaserDepth: DEFAULT_MOD.phaserDepth, phaserMix: DEFAULT_MOD.phaserMix,
    flangerRate: DEFAULT_MOD.flangerRate, flangerDepth: DEFAULT_MOD.flangerDepth, flangerFeedback: DEFAULT_MOD.flangerFeedback,
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
    const ft = pick<FilterType>(['LP','HP','BP','NOTCH']);
    setFilterType(ft);
    onUpdate({
      filterCutoff: rand(24, 85), filterResonance: rand(0, 77),
      filterDrive: rand(0, 0.5), filterType: ft,
    });
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
    const t1 = pick<LfoTarget>(['PITCH','FILTER','VOLUME']);
    const t2 = pick<LfoTarget>(['PITCH','FILTER','VOLUME']);
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



  return (
    <div className="fixed top-0 right-0 h-full z-30 flex" style={{ pointerEvents: 'none' }}>
      <div className="flex flex-col items-end self-start mt-4 gap-1" style={{ pointerEvents: 'auto' }}>
        <button onClick={() => setIsOpen(!isOpen)}
          className="w-7 h-10 flex items-center justify-center backdrop-blur-sm border border-r-0 rounded-l transition-all duration-300"
          style={{ backgroundColor: 'var(--fm-panel-bg)', borderColor: 'var(--fm-section-btn-border)' }}
          aria-label={isOpen ? 'Collapse Sound Sculptor panel' : 'Expand Sound Sculptor panel'}>
          {isOpen ? <ChevronRight size={12} style={{ color: 'var(--fm-text-muted)' }} /> : <ChevronLeft size={12} style={{ color: 'var(--fm-text-muted)' }} />}
        </button>
      </div>

      <div className="h-full backdrop-blur-sm border-l transition-all duration-300 ease-out overflow-y-auto overflow-x-hidden sculptor-scroll"
        style={{
          width: isOpen ? '220px' : '0px',
          padding: isOpen ? '16px 10px' : '16px 0',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--fm-scrollbar-thumb) var(--fm-scrollbar-track)',
          backgroundColor: 'var(--fm-panel-bg)',
          borderColor: 'var(--fm-panel-border)',
        }}
        ref={scrollRef}>
        <div className="flex flex-col" style={{ minWidth: '200px', gap: '20px' }}>
          <div className="flex items-center justify-between">
            <div className="font-mono tracking-widest" style={{ fontSize: '10px', color: 'var(--fm-accent)', opacity: 0.55 }}>SOUND SCULPTOR</div>
            <button
              onClick={zeroAllFx}
              title="Zero all parameters"
              className="w-7 h-7 flex items-center justify-center rounded border transition-all duration-200 active:opacity-60"
              style={{
                color: zeroPulse ? 'var(--fm-accent)' : 'var(--fm-text-muted)',
                border: zeroPulse ? '1.5px solid var(--fm-accent)' : '1px solid var(--fm-section-btn-border)',
                backgroundColor: zeroPulse ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-section-btn-bg)',
                filter: zeroPulse ? 'drop-shadow(0 0 6px var(--fm-accent))' : 'none',
              }}
            >
              <Minus size={14} />
            </button>
          </div>

          {activeKnob && tempVal !== null && (
            <div className="fixed top-2 right-[240px] px-2 py-1 border rounded font-mono whitespace-nowrap z-50"
              style={{ fontSize: '10px', backgroundColor: 'var(--fm-panel-bg)', borderColor: 'var(--fm-section-btn-border)', color: 'var(--fm-accent)' }}>
              {activeKnob.toUpperCase()}: {Math.round(tempVal * 100) / 100}
            </div>
          )}

          {/* ═══ DYNAMICS ═══ */}
          <div>
            <SectionHeader label="DYNAMICS" onReset={resetDynamics} onRandomize={randDynamics} />
            <div className="grid grid-cols-3 mt-3" style={{ gap: '12px' }}>
              {K('masterVolume', 'VOLUME', 0, 1, m.masterVolume)}
              {K('tempo', 'TEMPO', 40, 200, m.tempo)}
              {K('drift', 'DRIFT', 0.1, 2, m.drift)}
            </div>
            {/* Envelope visualizer */}
            <div style={{ marginTop: '12px' }}>
              <EnvelopeDisplay
                envAttack={m.envAttack}
                envRelease={m.envRelease}
                playMode={playMode}
                tempo={m.tempo}
                onChange={(atk, rel) => onUpdate({ envAttack: atk, envRelease: rel })}
              />
            </div>
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '8px' }}>
              {K('envAttack', 'ATTACK', 0, 100, m.envAttack)}
              {K('envRelease', 'RELEASE', 0, 100, m.envRelease, playMode === 'drone')}
              <div style={{ width: 56 }} />
            </div>
            {/* PULSE knobs — active only in PULSE mode */}
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px' }}>
              {K('pulseLength', 'PULSE\nLEN', 0.1, 0.9, m.pulseLength, playMode !== 'pulse')}
              {K('pulseSmooth', 'SMOOTH', 0, 1, m.pulseSmooth, playMode !== 'pulse')}
              <div style={{ width: 56 }} />
            </div>
          </div>

          {/* ═══ FILTER ═══ */}
          <div>
            <SectionHeader label="FILTER" onReset={resetFilter} onRandomize={randFilter} />
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px' }}>
              {K('filterCutoff', 'CUTOFF', 0, 100, m.filterCutoff)}
              {K('filterResonance', 'RES', 0, 100, m.filterResonance)}
              {K('filterDrive', 'DRIVE', 0, 1, m.filterDrive)}
            </div>
            <div style={{ marginTop: '10px', marginBottom: '4px' }}>
              <ToggleRow options={['LP','HP','BP','NOTCH','LADDER','SEM']}
                active={filterType} ariaLabel="Filter type"
                onChange={v => { setFilterType(v); onUpdate({ filterType: v as FilterType }); }} />
            </div>
          </div>

          {/* ═══ MODULATION ═══ */}
          <div>
            <SectionHeader label="MODULATION" onReset={resetMod} onRandomize={randMod} />
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px' }}>
              {K('chorusRate', 'CHR\nRATE', 0.1, 8, m.chorusRate)}
              {K('chorusDepth', 'CHR\nDEPTH', 0, 1, m.chorusDepth)}
              {K('chorusMix', 'CHR\nMIX', 0, 1, m.chorusMix)}
            </div>
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px' }}>
              {K('phaserRate', 'PH\nRATE', 0.05, 4, m.phaserRate)}
              {K('phaserDepth', 'PH\nDEPTH', 0, 1, m.phaserDepth)}
              {K('phaserMix', 'PH\nMIX', 0, 1, m.phaserMix)}
            </div>
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px' }}>
              {K('flangerRate', 'FL\nRATE', 0.05, 4, m.flangerRate)}
              {K('flangerDepth', 'FL\nDEPTH', 0, 1, m.flangerDepth)}
              {K('flangerFeedback', 'FL\nFDBK', 0, 0.95, m.flangerFeedback)}
            </div>
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px' }}>
              {K('detune', 'DETUNE', 0, 50, m.detune)}
              {K('detuneSpread', 'DET\nSPREAD', 0, 50, m.detuneSpread)}
              {K('detuneMix', 'DET\nMIX', 0, 1, m.detuneMix)}
            </div>
          </div>

          {/* ═══ SPACE ═══ */}
          <div style={{ pointerEvents: 'all' }}>
            <SectionHeader label="SPACE" onReset={resetSpace} onRandomize={randSpace} />
            <div style={{ marginTop: '10px', marginBottom: '4px' }}>
              <ToggleRow options={['ROOM','HALL','GRANULAR','LOFI','SPATIAL','MASSIVE']}
                active={reverbType} ariaLabel="Reverb type"
                onChange={v => { setReverbType(v); onUpdate({ reverbType: v as ReverbType }); }} />
            </div>
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px', pointerEvents: 'all' }}>
              {K('reverbSize', 'SIZE', 0, 1, m.reverbSize)}
              {K('reverbDecay', 'DECAY', 0, 1, m.reverbDecay)}
              {K('reverbPreDelay', 'PRE-DLY', 0, 80, m.reverbPreDelay)}
            </div>
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px', pointerEvents: 'all' }}>
              {K('reverbParam1', p1Label, 0, 1, m.reverbParam1)}
              {K('reverbParam2', p2Label, 0, 1, m.reverbParam2)}
              {K('reverbMix', 'MIX', 0, 100, m.reverbMix)}
            </div>
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px', pointerEvents: 'all' }}>
              {K('delayTime', 'DLY TIME', 0.01, 1.5, m.delayTime)}
              {K('delayFeedback', 'DLY FDBK', 0, 0.92, m.delayFeedback)}
              {K('delayMix', 'DLY MIX', 0, 1, m.delayMix)}
            </div>
          </div>

          {/* ═══ GRANULAR CLOUD ═══ */}
          <div>
            <SectionHeader label="GRANULAR CLOUD"
              onReset={() => {
                setGrainFreeze(false); setGrainReverse(false);
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
              onPowerToggle={v => {
                setGrainCloudActive(v);
                onUpdate({ grainCloudActive: v });
              }}
            />
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px' }}>
              {K('grainSize', 'SIZE', 10, 500, m.grainSize, !grainCloudActive)}
              {K('grainScatter', 'SCATTER', 0, 1, m.grainScatter, !grainCloudActive)}
              {K('grainDensity', 'DENSITY', 4, 60, m.grainDensity, !grainCloudActive)}
            </div>
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '12px' }}>
              {K('grainPitchSpread', 'PITCH\nSPRD', 0, 24, m.grainPitchSpread, !grainCloudActive)}
              <div style={{ width: 56 }} />
              <div style={{ width: 56 }} />
            </div>
            <div style={{ marginTop: '10px', marginBottom: '4px', ...grid2Style }}>
              <ToggleBtn label="FREEZE" active={grainFreeze} disabled={!grainCloudActive}
                onChange={v => { if (!grainCloudActive) return; setGrainFreeze(v); onUpdate({ grainFreeze: v }); }} />
              <ToggleBtn label="REV" active={grainReverse} disabled={!grainCloudActive}
                onChange={v => { if (!grainCloudActive) return; setGrainReverse(v); onUpdate({ grainReverse: v }); }} />
            </div>
          </div>

          {/* ═══ LFO ═══ */}
          <div style={{ pointerEvents: 'all' }}>
            <SectionHeader label="LFO" onReset={resetLfo} onRandomize={randLfo} />
            <div className="font-mono tracking-widest mt-3" style={{ fontSize: '10px', color: 'var(--fm-text-secondary)' }}>LFO 1</div>
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '8px' }}>
              {K('lfo1Rate', 'RATE', 0.01, 20, m.lfo1Rate)}
              {K('lfo1Depth', 'DEPTH', 0, 1, m.lfo1Depth)}
              {K('lfo1Phase', 'PHASE', 0, 360, m.lfo1Phase)}
            </div>
            <div style={{ marginTop: '8px' }}>
              <div style={grid3Style} role="radiogroup" aria-label="LFO 1 shape">
                {LFO_SHAPES.map(s => {
                  const on = lfo1Shape === s;
                  return (
                    <button key={s} role="radio" aria-checked={on} title={s}
                      onClick={(e) => { e.stopPropagation(); setLfo1Shape(s); onUpdate({ lfo1Shape: s as LfoShape }); }}
                      style={{ ...gridBtnStyle(on), fontSize: '14px', pointerEvents: 'all', cursor: 'pointer' }}>
                      {LFO_ICONS[s]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop: '6px' }}>
              <button
                onClick={(e) => { e.stopPropagation(); setLfo1Sync(prev => { const next = !prev; onUpdate({ lfo1Sync: next }); return next; }); }}
                style={{ ...gridBtnStyle(lfo1Sync), width: '100%', pointerEvents: 'all', cursor: 'pointer' }}
                aria-pressed={lfo1Sync}>SYNC</button>
            </div>
            <div style={{ marginTop: '8px', marginBottom: '4px' }}>
              <div style={grid3Style} role="radiogroup" aria-label="LFO 1 target">
                {LFO_TARGETS.map(t => {
                  const on = lfo1Target === t;
                  return (
                    <button key={t} role="radio" aria-checked={on}
                      onClick={(e) => { e.stopPropagation(); setLfo1Target(t); onUpdate({ lfo1Target: t as LfoTarget }); }}
                      style={{ ...gridBtnStyle(on), pointerEvents: 'all', cursor: 'pointer' }}>
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-px my-3" style={{ backgroundColor: 'var(--fm-divider)' }} />

            <div className="font-mono tracking-widest" style={{ fontSize: '10px', color: 'var(--fm-text-secondary)' }}>LFO 2</div>
            <div className="grid grid-cols-3" style={{ gap: '12px', marginTop: '8px' }}>
              {K('lfo2Rate', 'RATE', 0.01, 20, m.lfo2Rate)}
              {K('lfo2Depth', 'DEPTH', 0, 1, m.lfo2Depth)}
              {K('lfo2Phase', 'PHASE', 0, 360, m.lfo2Phase)}
            </div>
            <div style={{ marginTop: '8px' }}>
              <div style={grid3Style} role="radiogroup" aria-label="LFO 2 shape">
                {LFO_SHAPES.map(s => {
                  const on = lfo2Shape === s;
                  return (
                    <button key={s} role="radio" aria-checked={on} title={s}
                      onClick={(e) => { e.stopPropagation(); setLfo2Shape(s); onUpdate({ lfo2Shape: s as LfoShape }); }}
                      style={{ ...gridBtnStyle(on), fontSize: '14px', pointerEvents: 'all', cursor: 'pointer' }}>
                      {LFO_ICONS[s]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop: '6px' }}>
              <button
                onClick={(e) => { e.stopPropagation(); setLfo2Sync(prev => { const next = !prev; onUpdate({ lfo2Sync: next }); return next; }); }}
                style={{ ...gridBtnStyle(lfo2Sync), width: '100%', pointerEvents: 'all', cursor: 'pointer' }}
                aria-pressed={lfo2Sync}>SYNC</button>
            </div>
            <div style={{ marginTop: '8px', marginBottom: '4px' }}>
              <div style={grid3Style} role="radiogroup" aria-label="LFO 2 target">
                {LFO_TARGETS.map(t => {
                  const on = lfo2Target === t;
                  return (
                    <button key={t} role="radio" aria-checked={on}
                      onClick={(e) => { e.stopPropagation(); setLfo2Target(t); onUpdate({ lfo2Target: t as LfoTarget }); }}
                      style={{ ...gridBtnStyle(on), pointerEvents: 'all', cursor: 'pointer' }}>
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="h-8" />
        </div>
      </div>
    </div>
  );
}