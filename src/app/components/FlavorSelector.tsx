// Flavor selector — bottom-center
// 8 flavors in a horizontal row, with expandable per-flavor volume mixer
// Both mixer and selector rows use the same 8-column grid for perfect alignment

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

// Vertical fader component — centers itself in its grid cell
function VolumeFader({
  flavor,
  color,
  value,
  onChange,
}: {
  flavor: SoundFlavor;
  color: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const TRACK_H = 80;
  const HANDLE_H = 6;
  const HANDLE_W = 16;

  const valueToY = (v: number) => (1 - v) * (TRACK_H - HANDLE_H);
  const yToValue = (y: number) => Math.max(0, Math.min(1, 1 - y / (TRACK_H - HANDLE_H)));

  const handleY = valueToY(value);
  const pct = Math.round(value * 100);

  const updateFromEvent = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const y = clientY - rect.top - HANDLE_H / 2;
    onChange(yToValue(y));
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      updateFromEvent(e.clientY);
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [updateFromEvent]);

  return (
    <div className="flex flex-col items-center">
      {/* Percentage label */}
      <span
        className="font-mono text-center select-none"
        style={{ fontSize: '8px', color: 'var(--fm-text-secondary)', marginBottom: '4px', lineHeight: 1 }}
      >
        {pct}%
      </span>

      {/* Track container */}
      <div
        ref={trackRef}
        className="relative cursor-pointer flex justify-center"
        style={{ width: 20, height: TRACK_H, touchAction: 'none' }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          draggingRef.current = true;
          updateFromEvent(e.clientY);
        }}
      >
        {/* Visual track (3px centered) */}
        <div className="relative" style={{ width: 3, height: TRACK_H }}>
          {/* Inactive portion (above handle) */}
          <div
            className="absolute left-0 right-0 top-0"
            style={{
              height: handleY,
              backgroundColor: 'var(--fm-knob-track)',
              borderRadius: 2,
            }}
          />
          {/* Active portion (below handle) */}
          <div
            className="absolute left-0 right-0 bottom-0"
            style={{
              height: TRACK_H - handleY - HANDLE_H,
              backgroundColor: color,
              opacity: 0.6,
              borderRadius: 2,
            }}
          />
        </div>
        {/* Handle */}
        <div
          className="absolute"
          style={{
            top: handleY,
            left: '50%',
            transform: 'translateX(-50%)',
            width: HANDLE_W,
            height: HANDLE_H,
            backgroundColor: color,
            borderRadius: 3,
            boxShadow: `0 0 6px ${color}80`,
            cursor: 'grab',
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            draggingRef.current = true;
          }}
        />
      </div>
    </div>
  );
}

export function FlavorSelector({ activeFlavor, onSelectFlavor, flavorVolumes, onFlavorVolumeChange, isDark = true }: FlavorSelectorProps) {
  const [mixerOpen, setMixerOpen] = useState(false);
  const colorMap = isDark ? FLAVOR_COLORS : FLAVOR_COLORS_LIGHT;

  // Shared grid definition — identical for both rows so columns are mathematically equal
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 1fr)',
    justifyItems: 'center',
    padding: '0 12px',
  };

  return (
    <div
      className="fixed bottom-6 z-20"
      style={{ left: '50%', transform: 'translateX(-50%)' }}
    >
      {/* Mixer panel — slides up from above the selector */}
      <div
        className="overflow-hidden transition-all duration-200 ease-out"
        style={{
          maxHeight: mixerOpen ? 120 : 0,
          opacity: mixerOpen ? 1 : 0,
        }}
      >
        <div
          className="relative backdrop-blur-sm border border-b-0 rounded-t"
          style={{ paddingTop: 8, paddingBottom: 4, paddingRight: 40, background: 'var(--fm-panel-bg)', borderColor: 'var(--fm-panel-border)' }}
        >
          {/* 8-column grid — identical definition to flavor row */}
          <div style={gridStyle}>
            {flavors.map(({ type }) => {
              const color = colorMap[type];
              return (
                <VolumeFader
                  key={type}
                  flavor={type}
                  color={color}
                  value={flavorVolumes[type]}
                  onChange={(v) => onFlavorVolumeChange(type, v)}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Flavor selector row */}
      <div
        className="relative backdrop-blur-sm border"
        style={{
          borderRadius: mixerOpen ? '0 0 6px 6px' : '6px',
          paddingTop: 8,
          paddingBottom: 8,
          paddingRight: 40,
          background: 'var(--fm-panel-bg)',
          borderColor: 'var(--fm-panel-border)',
        }}
        role="radiogroup"
        aria-label="Sound flavor"
      >
        {/* 8-column grid — identical definition to mixer row */}
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
                className="relative flex flex-col items-center justify-center transition-all duration-200"
                style={{
                  gap: '6px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  color: isActive ? color : 'var(--fm-text-secondary)',
                  backgroundColor: isActive ? `${color}18` : 'transparent',
                  border: isActive ? `1px solid ${color}30` : '1px solid transparent',
                  filter: isActive ? `drop-shadow(0 0 6px ${color})` : 'none',
                  fontSize: '10px',
                }}
              >
                {icon(18)}
                <span className="font-mono tracking-wider" style={{ fontSize: '10px', opacity: isActive ? 1 : 0.5 }}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Chevron — absolutely positioned outside the grid */}
        <button
          onClick={() => setMixerOpen(prev => !prev)}
          className="absolute flex items-center justify-center transition-all duration-200"
          style={{
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 24,
            height: 24,
            borderRadius: '4px',
            backgroundColor: mixerOpen ? 'var(--fm-btn-bg)' : 'transparent',
            border: '1px solid var(--fm-panel-border)',
            color: 'var(--fm-text-muted)',
            padding: 0,
          }}
          aria-label={mixerOpen ? 'Collapse mixer' : 'Expand mixer'}
        >
          <ChevronUp
            size={14}
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
