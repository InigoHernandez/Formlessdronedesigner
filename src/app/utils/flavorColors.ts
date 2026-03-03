// Flavor-specific color palette
// Each flavor owns its color completely — pitch-to-color mapping is retired

import { SoundFlavor } from './audioEngine';

export const FLAVOR_COLORS: Record<SoundFlavor, string> = {
  sine:    '#00E5A0',
  saw:     '#F97316',
  sub:     '#A855F7',
  grain:   '#FACC15',
  noise:   '#D4A0C8',
  metal:   '#3B82F6',
  flutter: '#EF4444',
  crystal: '#67E8F9',
};

// Light-theme stroke trail colors — saturated for legibility on white bg
export const FLAVOR_COLORS_LIGHT: Record<SoundFlavor, string> = {
  sine:    '#059669',
  saw:     '#C2410C',
  sub:     '#7C3AED',
  grain:   '#B45309',
  noise:   '#9D4F8A',
  metal:   '#2563EB',
  flutter: '#DC2626',
  crystal: '#0891B2',
};