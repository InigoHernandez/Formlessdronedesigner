// Scale selector for pitch quantization — embedded in left strip

export type RootNote = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
export type ScaleType = 'CHROMATIC' | 'MINOR' | 'MAJOR' | 'PENTATONIC' | 'DORIAN' | 'PHRYGIAN' | 'LYDIAN' | 'LOCRIAN' | 'WHOLE TONE' | 'DIMINISHED';

interface ScaleSelectorProps {
  rootNote: RootNote;
  scaleType: ScaleType;
  onRootChange: (note: RootNote) => void;
  onScaleChange: (scale: ScaleType) => void;
  stripWidth: number;
  octave: number;
  onOctaveChange: (octave: number) => void;
}

const notes: RootNote[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const scales: ScaleType[] = ['CHROMATIC', 'MINOR', 'MAJOR', 'PENTATONIC', 'DORIAN', 'PHRYGIAN', 'LYDIAN', 'LOCRIAN', 'WHOLE TONE', 'DIMINISHED'];
const octaves = [6, 5, 4, 3, 2, 1]; // top=high, bottom=low

const BOX_H = 24;
const HEADER_H = 28;
const COL_PAD = 4;
const COL_GAP = 2;
const ROOT_W = 40;

export function ScaleSelector({ rootNote, scaleType, onRootChange, onScaleChange, stripWidth, octave, onOctaveChange }: ScaleSelectorProps) {
  // Root column is tallest (12 items) — all columns match its height
  const rootContentH = notes.length * BOX_H + (notes.length - 1) * COL_GAP;
  const rootColH = rootContentH + COL_PAD * 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '3px', overflow: 'hidden' }}>
      {/* Root note column */}
      <div style={{ display: 'flex', flexDirection: 'column', height: 'fit-content' }}>
        <span className="select-none"
          style={{
            fontSize: '8px',
            letterSpacing: '0.15em',
            height: `${HEADER_H}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--fm-text-muted)',
          }}>ROOT</span>
        <div
          className="flex flex-col border"
          role="radiogroup"
          aria-label="Root note"
          style={{ padding: `${COL_PAD}px`, gap: `${COL_GAP}px`, background: 'var(--fm-panel-bg)', borderColor: 'var(--fm-panel-border)' }}
        >
          {notes.map((note) => {
            const isSharp = note.includes('#');
            const isActive = rootNote === note;
            return (
              <button
                key={note}
                role="radio"
                aria-checked={isActive}
                onClick={() => onRootChange(note)}
                className="flex items-center justify-center transition-all duration-200 text-center"
                style={{
                  width: `${ROOT_W}px`,
                  height: `${BOX_H}px`,
                  padding: 0,
                  boxSizing: 'border-box',
                  fontSize: '9px',
                  color: isActive ? 'var(--fm-accent)' : isSharp ? 'var(--fm-text-muted)' : 'var(--fm-text-secondary)',
                  backgroundColor: isActive ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'transparent',
                  border: isActive ? '1.5px solid var(--fm-accent)' : '1px solid transparent',
                  filter: 'none',
                }}
              >
                {note}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scale type column */}
      <div style={{ display: 'flex', flexDirection: 'column', height: 'fit-content' }}>
        <span className="select-none"
          style={{
            fontSize: '8px',
            letterSpacing: '0.15em',
            height: `${HEADER_H}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--fm-text-muted)',
          }}>SCALE</span>
        <div
          className="flex flex-col border"
          role="radiogroup"
          aria-label="Scale type"
          style={{
            padding: `${COL_PAD}px`,
            height: `${rootColH}px`,
            boxSizing: 'border-box',
            justifyContent: 'space-between',
            gap: `${COL_GAP}px`,
            background: 'var(--fm-panel-bg)',
            borderColor: 'var(--fm-panel-border)',
          }}
        >
          {scales.map((scale) => {
            const isActive = scaleType === scale;
            return (
              <button
                key={scale}
                role="radio"
                aria-checked={isActive}
                onClick={() => onScaleChange(scale)}
                className="transition-all duration-200 text-center whitespace-nowrap"
                style={{
                  fontSize: '9px',
                  height: `${BOX_H}px`,
                  padding: '0 12px',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isActive ? 'var(--fm-accent)' : 'var(--fm-text-secondary)',
                  backgroundColor: isActive ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'transparent',
                  border: isActive ? '1.5px solid var(--fm-accent)' : '1px solid transparent',
                }}
              >
                {scale}
              </button>
            );
          })}
        </div>
      </div>

      {/* Octave column */}
      <div style={{ display: 'flex', flexDirection: 'column', height: 'fit-content' }}>
        <span className="select-none"
          style={{
            fontSize: '8px',
            letterSpacing: '0.15em',
            height: `${HEADER_H}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--fm-text-muted)',
          }}>OCT</span>
        <div
          className="flex flex-col border"
          role="radiogroup"
          aria-label="Octave"
          style={{
            padding: `${COL_PAD}px`,
            height: `${rootColH}px`,
            boxSizing: 'border-box',
            justifyContent: 'center',
            gap: `${COL_GAP}px`,
            background: 'var(--fm-panel-bg)',
            borderColor: 'var(--fm-panel-border)',
          }}
        >
          {octaves.map((oct) => {
            const isActive = octave === oct;
            return (
              <button
                key={oct}
                role="radio"
                aria-checked={isActive}
                onClick={() => onOctaveChange(oct)}
                className="transition-all duration-200"
                style={{
                  width: `${ROOT_W}px`,
                  flex: 1,
                  boxSizing: 'border-box',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px',
                  color: isActive ? 'var(--fm-accent)' : 'var(--fm-text-secondary)',
                  backgroundColor: isActive ? 'rgba(var(--fm-accent-rgb), 0.15)' : 'var(--fm-knob-track)',
                  border: isActive ? '1.5px solid var(--fm-accent)' : `1px solid var(--fm-panel-border)`,
                  filter: 'none',
                  opacity: isActive ? 1 : 0.85,
                }}
              >
                {oct}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Scale interval definitions
// ═══════════════════════════════════════════════════

const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  CHROMATIC:   [0,1,2,3,4,5,6,7,8,9,10,11],
  MINOR:       [0,2,3,5,7,8,10],
  MAJOR:       [0,2,4,5,7,9,11],
  PENTATONIC:  [0,2,4,7,9],
  DORIAN:      [0,2,3,5,7,9,10],
  PHRYGIAN:    [0,1,3,5,7,8,10],
  LYDIAN:      [0,2,4,6,7,9,11],
  LOCRIAN:     [0,1,3,5,6,8,10],
  'WHOLE TONE':[0,2,4,6,8,10],
  DIMINISHED:  [0,2,3,5,6,8,9,11],
};

export function getScaleIntervals(scale: ScaleType): number[] {
  return SCALE_INTERVALS[scale] || SCALE_INTERVALS.MAJOR;
}

export function getRootFrequency(root: RootNote, octave: number = 3): number {
  const noteIndex = notes.indexOf(root);
  // C3 = MIDI 48 → freq
  const midi = (octave + 1) * 12 + noteIndex;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface ScaleNote {
  freq: number;
  name: string;
  midi: number;
}

export function buildScaleTable(root: RootNote, scale: ScaleType, octave: number): ScaleNote[] {
  const intervals = getScaleIntervals(scale);
  const rootIdx = notes.indexOf(root);
  const result: ScaleNote[] = [];
  // Span 4 octaves centered on the selected octave
  const startOct = Math.max(0, octave - 1);
  const endOct = octave + 2;
  for (let o = startOct; o <= endOct; o++) {
    for (const interval of intervals) {
      const noteIdx = (rootIdx + interval) % 12;
      const midi = (o + 1) * 12 + noteIdx;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const name = `${notes[noteIdx]}${o}`;
      result.push({ freq, name, midi });
    }
  }
  // Sort by frequency
  result.sort((a, b) => a.freq - b.freq);
  return result;
}

export function mapYToScaleFreq(y: number, canvasHeight: number, table: ScaleNote[]): ScaleNote {
  if (table.length === 0) return { freq: 440, name: 'A4', midi: 69 };
  // Y=0 is top (highest freq), Y=canvasHeight is bottom (lowest freq)
  const norm = 1 - (y / canvasHeight); // 0=bottom(low) to 1=top(high)
  const idx = Math.round(norm * (table.length - 1));
  const clamped = Math.max(0, Math.min(table.length - 1, idx));
  return table[clamped];
}

export function findNearestScaleFreq(freq: number, table: ScaleNote[]): ScaleNote {
  if (table.length === 0) return { freq, name: '?', midi: 69 };
  let closest = table[0];
  let minDist = Math.abs(freq - closest.freq);
  for (let i = 1; i < table.length; i++) {
    const d = Math.abs(freq - table[i].freq);
    if (d < minDist) { minDist = d; closest = table[i]; }
  }
  return closest;
}