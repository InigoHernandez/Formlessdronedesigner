// Flavor-specific color palette
// Each flavor owns its color completely — pitch-to-color mapping is retired

import { SoundFlavor } from './audioEngine';

export const FLAVOR_COLORS: Record<SoundFlavor, string> = {
  sine:    '#00FFD1',
  saw:     '#FFB347',
  sub:     '#6B00FF',
  grain:   '#F5E6C8',
  noise:   '#B8A9C9',
  metal:   '#C8E6FF',
  flutter: '#FF9EC8',
  crystal: '#E8F4FF',
};

// Light-theme stroke trail colors — saturated for legibility on warm cream bg
export const FLAVOR_COLORS_LIGHT: Record<SoundFlavor, string> = {
  sine:    '#00897B',
  saw:     '#D4820A',
  sub:     '#5C35CC',
  grain:   '#9B7820',
  noise:   '#8A7499',
  metal:   '#5588AA',
  flutter: '#CC4D88',
  crystal: '#5577BB',
};