// Scale character FX presets — each scale applies soft defaults to FX sections
// These only apply if the user has not manually adjusted parameters in that section.

import type { ModulatorSettings } from './audioEngine';
import type { ScaleType } from '../components/ScaleSelector';

// Which FX section a preset parameter belongs to
export type FxSection = 'SPACE' | 'MODULATION' | 'FILTER' | 'LFO';

export const SECTION_KEYS: Record<FxSection, (keyof ModulatorSettings)[]> = {
  SPACE: ['reverbType', 'reverbSize', 'reverbDecay', 'reverbPreDelay', 'reverbParam1', 'reverbParam2', 'reverbMix',
          'delayTime', 'delayFeedback', 'delayMix'],
  MODULATION: ['chorusRate', 'chorusDepth', 'chorusMix', 'phaserRate', 'phaserDepth', 'phaserMix',
               'flangerRate', 'flangerDepth', 'flangerFeedback', 'detune', 'detuneSpread', 'detuneMix'],
  FILTER: ['filterType', 'filterCutoff', 'filterResonance', 'filterDrive'],
  LFO: ['lfo1Rate', 'lfo1Depth', 'lfo1Phase', 'lfo1Shape', 'lfo1Target', 'lfo1Sync',
        'lfo2Rate', 'lfo2Depth', 'lfo2Phase', 'lfo2Shape', 'lfo2Target', 'lfo2Sync'],
};

// Determine which section a key belongs to
export function getSectionForKey(key: keyof ModulatorSettings): FxSection | null {
  for (const [section, keys] of Object.entries(SECTION_KEYS) as [FxSection, (keyof ModulatorSettings)[]][]) {
    if (keys.includes(key)) return section;
  }
  return null;
}

// Scale FX presets: Partial<ModulatorSettings> per scale
// Only keys listed here get auto-applied. Unlisted keys stay unchanged.
export const SCALE_FX_PRESETS: Record<ScaleType, Partial<ModulatorSettings>> = {
  CHROMATIC: {},
  MINOR: {
    reverbType: 'HALL' as any,
    reverbSize: 0.7,
    reverbDecay: 0.65,
  },
  MAJOR: {
    reverbType: 'ROOM' as any,
    reverbSize: 0.55,
    delayFeedback: 0.35,
  },
  PENTATONIC: {
    reverbType: 'SPATIAL' as any,
    reverbSize: 0.8,
  },
  DORIAN: {
    chorusRate: 0.3,
    chorusDepth: 0.4,
  },
  PHRYGIAN: {
    filterType: 'LP' as any,
    filterCutoff: 50,         // ~1200Hz on exponential curve (0-100 → 80-18000Hz)
    filterResonance: 33,      // Q ≈ 6.4 on new 0-100 → Q 0.5-18.5 mapping
  },
  LYDIAN: {
    reverbType: 'MASSIVE' as any,
    reverbSize: 0.85,
    lfo1Target: 'PITCH' as any,
    lfo1Depth: 0.15,
  },
  LOCRIAN: {
    filterType: 'BP' as any,
    filterCutoff: 42,         // ~800Hz on exponential curve
    filterResonance: 78,      // Q ≈ 14.5 on new 0-100 mapping
    detune: 15,
  },
  'WHOLE TONE': {
    lfo1Rate: 0.1,
    lfo1Depth: 0.25,
    lfo1Target: 'FILTER' as any,
  },
  DIMINISHED: {
    delayFeedback: 0.55,
    delayTime: 0.0625, // 1/16 note at ~60bpm
  },
};

/**
 * Determine which FX sections a scale preset affects.
 */
export function getPresetSections(scaleType: ScaleType): Set<FxSection> {
  const preset = SCALE_FX_PRESETS[scaleType];
  const sections = new Set<FxSection>();
  for (const key of Object.keys(preset) as (keyof ModulatorSettings)[]) {
    const section = getSectionForKey(key);
    if (section) sections.add(section);
  }
  return sections;
}
