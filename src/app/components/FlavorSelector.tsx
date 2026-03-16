// Flavor selector — bottom-center
// 8 flavors in a clean horizontal grid with expandable per-flavor volume mixer
// Sutéra/Swiss-inspired: generous spacing, clean alignment, Inter font

import { useState, useRef, useCallback, useEffect } from 'react';
import { SoundFlavor } from '../utils/audioEngine';
import { FLAVOR_COLORS, FLAVOR_COLORS_LIGHT } from '../utils/flavorColors';
import { Circle, ZapIcon, Waves, Sparkles, Wind, Hexagon, Disc, Diamond, ChevronUp } from 'lucide-react';

interface FlavorSelectorProps {
  activeFlavor: SoundFlavor;
  onSelectFlavor: (flavor: SoundFlavor) => void;
  flavorVolumes: Record<SoundFlavor, number>;
  onFlavorVolumeChange: (flavor: SoundFlavor, value: number) => void;
  isDark?: boolean;
  leftOffset?: number;
  rightOffset?: number;
}

const flavors: Array<{ type: SoundFlavor; icon: (size: number) => React.ReactNode; label: string }> = [
  { type: 'sine', icon: (s) => <Circle size={s} />, label: 'SINE' },
  { type: 'saw', icon: (s) => <ZapIcon size={s} />, label: 'SAW' },
  { type: 'sub', icon: (s) => <Waves size={s} />, label: 'SUB' },
  { type: 'grain', icon: (s) => <Sparkles size={s} />, label: 'GRAIN' },
  { type: 'noise', icon: (s) => <Wind size={s} />, label: 'NOISE' },
  { type: 'metal', icon: (s) => <Hexagon size={s} />, label: 'METAL' },
  { type: 'flutter', icon: (s) => <Disc size={s} />, label: 'FLUTTER' },
  { type: 'crystal', icon: (s) => <Diamond size={s} />, label: 'CRYSTAL' },
];

// Vertical fader component
function VolumeFader({ color, value, onChange }: { color: string; value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const TRACK_H = 72;
  const HANDLE_H = 5;
  const HANDLE_W = 18;

  const valueToY = (v: number) => (1 - v) * (TRACK_H - HANDLE_H);
  const yToValue = (y: number) => Math.max(0, Math.min(1, 1 - y / (TRACK_H - HANDLE_H)));
  const handleY = valueToY(value);
  const pct = Math.round(value * 100);

  const updateFromEvent = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    onChange(yToValue(clientY - rect.top - HANDLE_H / 2));
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => { if (draggingRef.current) { e.preventDefault(); updateFromEvent(e.clientY); } };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [updateFromEvent]);

  return (
    <div className="flex flex-col items-center" style={{ gap: '6px' }}>
      <span className="select-none" style={{ fontSize: '9px', color: 'var(--fm-text-muted)', lineHeight: 1 }}>
        {pct}
      </span>
      <div
        ref={trackRef}
        className="relative cursor-pointer flex justify-center"
        style={{ width: 24, height: TRACK_H, touchAction: 'none' }}
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); draggingRef.current = true; updateFromEvent(e.clientY); }}
      >
        <div className="relative" style={{ width: 2, height: TRACK_H }}>
          <div className="absolute left-0 right-0 top-0" style={{ height: handleY, backgroundColor: 'var(--fm-knob-track)' }} />
          <div className="absolute left-0 right-0 bottom-0" style={{ height: TRACK_H - handleY - HANDLE_H, backgroundColor: color, opacity: 0.5 }} />
        </div>
        <div
          className="absolute"
          style={{
            top: handleY,
            left: '50%',
            transform: 'translateX(-50%)',
            width: HANDLE_W,
            height: HANDLE_H,
            backgroundColor: color,
            cursor: 'grab',
          }}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); draggingRef.current = true; }}
        />
      </div>
    </div>
  );
}

export function FlavorSelector({ activeFlavor, onSelectFlavor, flavorVolumes, onFlavorVolumeChange, isDark = true, leftOffset = 0, rightOffset = 0 }: FlavorSelectorProps) {
  const [mixerOpen, setMixerOpen] = useState(false);
  const colorMap = isDark ? FLAVOR_COLORS : FLAVOR_COLORS_LIGHT;

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 56px)',
    justifyItems: 'center',
    gap: '1px',
  };

  return (
    <div className="fixed bottom-5 z-20" style={{ left: `calc(50% + ${(leftOffset - rightOffset) / 2}px)`, transform: 'translateX(-50%)', transition: 'left 300ms ease-out' }}>
      {/* Mixer panel */}
      <div
        className="overflow-hidden transition-all duration-200 ease-out"
        style={{ maxHeight: mixerOpen ? 120 : 0, opacity: mixerOpen ? 1 : 0 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            paddingTop: 10,
            paddingBottom: 6,
            paddingLeft: 0,
            paddingRight: 36,
            background: 'var(--fm-panel-bg)',
            borderTop: '1px solid var(--fm-panel-border)',
            borderLeft: '1px solid var(--fm-panel-border)',
            borderRight: '1px solid var(--fm-panel-border)',
            borderTopLeftRadius: 'var(--fm-radius-lg)',
            borderTopRightRadius: 'var(--fm-radius-lg)',
          }}
        >
          <div style={gridStyle}>
            {flavors.map(({ type }) => (
              <VolumeFader key={type} color={colorMap[type]} value={flavorVolumes[type]} onChange={(v) => onFlavorVolumeChange(type, v)} />
            ))}
          </div>
        </div>
      </div>

      {/* Flavor selector row */}
      <div
        className="relative"
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--fm-panel-bg)',
          border: '1px solid var(--fm-panel-border)',
          borderRadius: mixerOpen ? '0 0 var(--fm-radius-lg) var(--fm-radius-lg)' : 'var(--fm-radius-lg)',
          paddingRight: 36,
          boxShadow: 'var(--fm-shadow-md)',
        }}
        role="radiogroup"
        aria-label="Sound flavor"
      >
        <div style={gridStyle}>
          {flavors.map(({ type, icon, label }) => {
            const isActive = activeFlavor === type;
            const color = colorMap[type];
            return (
              <button
                key={type}
                role="radio"
                aria-checked={isActive}
                aria-label={label}
                onClick={() => onSelectFlavor(type)}
                className="relative flex flex-col items-center justify-center transition-all duration-150"
                style={{
                  width: 56,
                  height: 52,
                  gap: '5px',
                  color: isActive ? color : 'var(--fm-text-secondary)',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  opacity: isActive ? 1 : 0.5,
                }}
              >
                {icon(15)}
                <span style={{ fontSize: '8px', letterSpacing: '0.1em', opacity: isActive ? 1 : 0.6 }}>
                  {label}
                </span>
                {/* Active indicator — bottom bar */}
                {isActive && (
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 20,
                    height: 2,
                    backgroundColor: color,
                    borderRadius: '2px',
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Mixer toggle */}
        <button
          onClick={() => setMixerOpen(prev => !prev)}
          className="absolute flex items-center justify-center transition-all duration-200"
          style={{
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 20,
            height: 20,
            backgroundColor: 'transparent',
            border: 'none',
            color: 'var(--fm-text-muted)',
            padding: 0,
            cursor: 'pointer',
          }}
          aria-label={mixerOpen ? 'Collapse mixer' : 'Expand mixer'}
        >
          <ChevronUp
            size={12}
            style={{
              transition: 'transform 200ms ease',
              transform: mixerOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </button>
      </div>
    </div>
  );
}