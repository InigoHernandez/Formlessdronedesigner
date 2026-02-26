// FORMLESS — Global Master Bus Audio Engine
// Chain: AudioWorkletNode(per-voice) → flavorBusGain(fader) → [SAW/METAL: tanhClipper] → flavorLimiter(ceiling) → masterBus → Filter → Delay → Reverb → Chorus → Phaser → Flanger → HighShelf → Compressor(transparent) → OutputGain(0.92) → SoftClipper → Destination
// Per-voice synthesis + envelope runs on audio thread via AudioWorklet.
// Fallback to native Web Audio nodes if worklet fails to load.
// All effect nodes instantiated ONCE on load. Max 16 simultaneous strokes.

import { findNearestScaleFreq, mapYToScaleFreq, type ScaleNote } from '../components/ScaleSelector';
import { SYNTH_PROCESSOR_CODE } from './synthProcessorCode';

/**
 * Safely create an AudioBufferSourceNode with its buffer pre-set.
 *
 * CRITICAL: We NEVER call the `.buffer` setter on an AudioBufferSourceNode.
 * Chrome throws InvalidStateError when the setter is invoked on a node whose
 * buffer is already non-null — and in some edge cases (rapid grain spawning,
 * context state transitions) the setter-based fallback triggers the
 * "already set" guard even on seemingly-fresh nodes.
 *
 * Strategy: constructor-only. The options-bag sets the buffer atomically
 * during construction. If that fails the node is unusable and we return
 * null (all callers already handle null).
 */
function createBufferSource(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBufferSourceNode | null {
  // Guard: don't attempt node creation on a closed context
  if ((ctx as AudioContext).state === 'closed') return null;
  try {
    return new AudioBufferSourceNode(ctx, { buffer });
  } catch (_) {
    // Constructor failed — do NOT fall back to .buffer setter
    return null;
  }
}

export type SoundFlavor = 'sine' | 'saw' | 'sub' | 'grain' | 'noise' | 'metal' | 'flutter' | 'crystal';
export type ReverbType = 'ROOM' | 'HALL' | 'GRANULAR' | 'LOFI' | 'SPATIAL' | 'MASSIVE';
export type FilterType = 'LP' | 'HP' | 'BP' | 'NOTCH' | 'LADDER' | 'SEM';
export type LfoShape = 'SINE' | 'TRI' | 'SQR' | 'S&H' | 'RAMP_UP' | 'RAMP_DN';
export type LfoTarget = 'PITCH' | 'FILTER' | 'VOLUME' | 'PAN' | 'REVERB' | 'DELAY';
export type PlayMode = 'gate' | 'pulse' | 'drone';

export interface StrokeData {
  points: { x: number; y: number; time: number }[];
  speed: number;
  length: number;
  avgY: number;
  curvature: number;
  startPoint: { x: number; y: number };
  flavor: SoundFlavor;
}

export interface ActiveSound {
  id: string;
  envelope: GainNode;
  flavorGain: GainNode;
  oscillators: OscillatorNode[];
  allNodes: AudioNode[];
  startTime: number;
  duration: number;
  locked: boolean;
  flavor: SoundFlavor;
  baseFrequency: number;
  muted: boolean;
  panner?: StereoPannerNode;
  driftLfo?: OscillatorNode;
  harmonicOscs?: OscillatorNode[];
  loopTimeout?: ReturnType<typeof setTimeout>;
  cleanupTimeout?: ReturnType<typeof setTimeout>;
  strokeData?: StrokeData;
  quantizedFreq?: number;
  // Live stroke modulation fields
  isLive?: boolean;
  liveFilter?: BiquadFilterNode;
  liveOctaveOsc?: OscillatorNode;
  liveOctaveGain?: GainNode;
  liveFifthOsc?: OscillatorNode;
  liveFifthGain?: GainNode;
  live2ndOctaveOsc?: OscillatorNode;
  live2ndOctaveGain?: GainNode;
  accumulatedLength?: number;
  pulseInterval?: ReturnType<typeof setInterval>;
  deepRumbleInterval?: ReturnType<typeof setInterval>;
  isDrone?: boolean;         // true if stroke was created in drone mode
  targetVol?: number;        // peak volume for envelope calculations
  yPosition?: number;        // original canvas Y position for retune mapping
  isReleasing?: boolean;     // true when in release/fade phase
  workletNode?: AudioWorkletNode; // AudioWorklet voice node (when using worklet path)
}

export interface ModulatorSettings {
  masterVolume: number;
  tempo: number;
  drift: number;
  reverbType: ReverbType;
  reverbSize: number;
  reverbDecay: number;
  reverbPreDelay: number;
  reverbParam1: number;
  reverbParam2: number;
  reverbMix: number;   // 0-100: 0=fully dry, 100=fully wet
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  chorusRate: number;
  chorusDepth: number;
  chorusMix: number;
  phaserRate: number;
  phaserDepth: number;
  phaserMix: number;
  flangerRate: number;
  flangerDepth: number;
  flangerFeedback: number;
  detune: number;
  detuneSpread: number;
  detuneMix: number;
  filterCutoff: number;
  filterResonance: number;
  filterDrive: number;
  filterType: FilterType;
  lfo1Rate: number;
  lfo1Depth: number;
  lfo1Phase: number;
  lfo1Shape: LfoShape;
  lfo1Target: LfoTarget;
  lfo1Sync: boolean;
  lfo2Rate: number;
  lfo2Depth: number;
  lfo2Phase: number;
  lfo2Shape: LfoShape;
  lfo2Target: LfoTarget;
  lfo2Sync: boolean;
  grainSize: number;
  grainScatter: number;
  grainDensity: number;
  grainPitchSpread: number;
  grainFreeze: boolean;
  grainReverse: boolean;
  grainCloudActive: boolean;
  pulseLength: number;
  pulseSmooth: number;
  envAttack: number;    // 0-100 knob, mapped exponentially to 5ms-2000ms
  envRelease: number;   // 0-100 knob, mapped exponentially to 50ms-4000ms
}

// Per-flavor source amplitude — applied at synthesis level via GainNode
// immediately after oscillator/source, before envelope and all downstream gain stages.
// Operates independently from limiters and faders.
const FLAVOR_SOURCE_AMPLITUDE: Record<SoundFlavor, number> = {
  sine:    0.95,  // boosted, pure sine is perceptually weak
  saw:     0.04,  // aggressively cut — two detuned saws + harmonics = very loud intrinsically
  sub:     0.90,  // boosted, low frequencies need more amplitude
  grain:   0.85,  // boosted
  noise:   0.88,  // boosted
  metal:   0.03,  // aggressively cut — FM synthesis generates enormous sideband energy
  flutter: 0.85,  // boosted
  crystal: 0.88,  // boosted
};

// Per-flavor hard limiter ceiling in dBFS
// Each flavor gets a DynamicsCompressorNode configured as a brick-wall limiter
// targeting this ceiling. Self-correcting: regardless of source level, output is consistent.
const FLAVOR_CEILINGS: Record<SoundFlavor, number> = {
  sine:    -8,   // boost perceptually quiet pure sine
  saw:     -24,  // aggressively limit harsh sawtooth
  sub:     -10,  // bass needs extra headroom
  grain:   -9,
  noise:   -9,
  metal:   -26,  // aggressively limit harsh FM metal
  flutter: -9,
  crystal: -9,
};

// Default modulator values — exported for reset buttons
export const DEFAULT_MOD: ModulatorSettings = {
  masterVolume: 0.7,
  tempo: 85,
  drift: 0.5,
  reverbType: 'ROOM',
  reverbSize: 0.7,
  reverbDecay: 0.6,
  reverbPreDelay: 20,
  reverbParam1: 0.5,
  reverbParam2: 0.5,
  reverbMix: 65,
  delayTime: 0.353,
  delayFeedback: 0.45,
  delayMix: 0.35,
  chorusRate: 0.3,
  chorusDepth: 0.3,
  chorusMix: 0.4,
  phaserRate: 0.5,
  phaserDepth: 0.5,
  phaserMix: 0.35,
  flangerRate: 0.2,
  flangerDepth: 0.3,
  flangerFeedback: 0.6,
  detune: 0,
  detuneSpread: 10,
  detuneMix: 0.3,
  filterCutoff: 100,       // 0-100 knob range, mapped exponentially to 80-18000Hz
  filterResonance: 0,      // 0-100 knob range, mapped to Q 0.5-18.5
  filterDrive: 0,
  filterType: 'LP',
  lfo1Rate: 0.08,
  lfo1Depth: 0.2,
  lfo1Phase: 0,
  lfo1Shape: 'SINE',
  lfo1Target: 'PITCH',
  lfo1Sync: false,
  lfo2Rate: 0.15,
  lfo2Depth: 0.15,
  lfo2Phase: 0,
  lfo2Shape: 'SINE',
  lfo2Target: 'FILTER',
  lfo2Sync: false,
  grainSize: 120,
  grainScatter: 0.3,
  grainDensity: 8,
  grainPitchSpread: 0,
  grainFreeze: false,
  grainReverse: false,
  grainCloudActive: false,
  pulseLength: 0.5,
  pulseSmooth: 0.3,
  envAttack: 46,    // ~80ms on exponential curve (5-2000ms)
  envRelease: 63,   // ~800ms on exponential curve (50-4000ms)
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private readonly MAX_STROKES = 16;

  // ── Global shared nodes (created ONCE) ──
  private masterBus: GainNode | null = null;
  private masterVolGain: GainNode | null = null;
  private analyzer: AnalyserNode | null = null;
  private preCompAnalyzer: AnalyserNode | null = null;   // tapped before compressor for oscilloscope
  private freqAnalyzer: AnalyserNode | null = null;      // FFT 256 for frequency band detection
  private compressor: DynamicsCompressorNode | null = null;
  private softClipper: WaveShaperNode | null = null;
  private preCompHighShelf: BiquadFilterNode | null = null;
  private postCompGain: GainNode | null = null;
  private flavorSoftClippers: Partial<Record<SoundFlavor, WaveShaperNode>> = {};
  private flavorLimiters: Partial<Record<SoundFlavor, DynamicsCompressorNode>> = {};

  // Filter — single BiquadFilterNode (LP/HP/BP/NOTCH/LADDER/SEM)
  private filterNode: BiquadFilterNode | null = null;
  private ladderDriveNode: WaveShaperNode | null = null; // inserted after filter for LADDER
  private semAllpassNode: BiquadFilterNode | null = null; // inserted in series for SEM
  private filterDryGain: GainNode | null = null;
  private filterOutGain: GainNode | null = null;

  // Delay
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayDry: GainNode | null = null;
  private delayWet: GainNode | null = null;
  private delayMixer: GainNode | null = null;

  // Reverb
  private convolver: ConvolverNode | null = null;
  private reverbPreDelay: DelayNode | null = null;
  private reverbDry: GainNode | null = null;
  private reverbWet: GainNode | null = null;
  private reverbMixer: GainNode | null = null;

  // Chorus: 2 parallel modulated delays
  private chorusDry: GainNode | null = null;
  private chorusWet: GainNode | null = null;
  private chorusMixer: GainNode | null = null;
  private chorusLfos: OscillatorNode[] = [];
  private chorusDelays: DelayNode[] = [];
  private chorusLfoGains: GainNode[] = [];

  // Phaser: 4 allpass filters in series
  private phaserDry: GainNode | null = null;
  private phaserWet: GainNode | null = null;
  private phaserMixer: GainNode | null = null;
  private phaserFilters: BiquadFilterNode[] = [];
  private phaserLfo: OscillatorNode | null = null;
  private phaserLfoGain: GainNode | null = null;

  // Flanger
  private flangerDry: GainNode | null = null;
  private flangerWet: GainNode | null = null;
  private flangerMixer: GainNode | null = null;
  private flangerDelay: DelayNode | null = null;
  private flangerFeedback: GainNode | null = null;
  private flangerLfo: OscillatorNode | null = null;
  private flangerLfoGain: GainNode | null = null;

  // LOFI-specific reverb processing
  private lofiLowpass: BiquadFilterNode | null = null;
  private lofiHighpass: BiquadFilterNode | null = null;
  private lofiWowDelay: DelayNode | null = null;
  private lofiWowLfo: OscillatorNode | null = null;
  private lofiWowLfoGain: GainNode | null = null;
  private lofiCrusher: WaveShaperNode | null = null;

  // Granular Cloud — always-on ambient texture generator
  private grainCloudGain: GainNode | null = null;
  private grainCloudActive = false;
  private grainCloudInterval: ReturnType<typeof setInterval> | null = null;
  private grainCloudNodes: AudioNode[] = [];
  private grainCloudBuffer: AudioBuffer | null = null;
  private grainCloudFrozenBuffer: AudioBuffer | null = null;

  // Panner (LFO pan target)
  private masterPanner: StereoPannerNode | null = null;

  // Per-flavor bus gains — shared by ALL strokes of a flavor, holds fader value
  private flavorBusGains: Partial<Record<SoundFlavor, GainNode>> = {};
  // Tracks which flavor buses are disconnected (fader at zero)
  private disconnectedBuses: Set<SoundFlavor> = new Set();

  // LFOs
  private lfo1Osc: OscillatorNode | null = null;
  private lfo1Gain: GainNode | null = null;
  private lfo2Osc: OscillatorNode | null = null;
  private lfo2Gain: GainNode | null = null;
  private lfo1SHInterval: ReturnType<typeof setInterval> | null = null;
  private lfo2SHInterval: ReturnType<typeof setInterval> | null = null;

  // Resonance pad
  private resonancePad: OscillatorNode | null = null;
  private resonancePadGain: GainNode | null = null;
  private resonanceActive = false;
  private rootFrequency = 261.63;

  // Octave tracking for global octave shift
  private currentOctave = 3;

  // Stroke pool — ordered array for oldest-first eviction
  private strokePool: ActiveSound[] = [];
  private activeSounds: Map<string, ActiveSound> = new Map();

  private mod: ModulatorSettings = { ...DEFAULT_MOD };
  private droneMode = false;
  private playMode: PlayMode = 'gate';

  // AudioWorklet state
  private workletReady = false;
  private workletBlobUrl: string | null = null;

  // Scale frequency table (rebuilt on root/scale change)
  private scaleTable: ScaleNote[] = [];

  // Per-flavor volume mixer (0-1 fader multiplier, feeds into per-flavor limiter)
  private flavorVolumes: Record<SoundFlavor, number> = {
    sine: 0.75, saw: 0.75, sub: 0.65, grain: 0.75,
    noise: 0.90, metal: 0.75, flutter: 0.75, crystal: 0.75,
  };

  // ═══════════════════════════════════════════
  // INIT — build entire master bus ONCE
  // ═══════════════════════════════════════════
  async initialize() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const c = this.ctx;
    const now = c.currentTime;

    // Register AudioWorklet processor (async, non-blocking)
    try {
      const blob = new Blob([SYNTH_PROCESSOR_CODE], { type: 'application/javascript' });
      this.workletBlobUrl = URL.createObjectURL(blob);
      await c.audioWorklet.addModule(this.workletBlobUrl);
      this.workletReady = true;
      console.log('[FORMLESS] AudioWorklet synth registered');
    } catch (e) {
      console.warn('[FORMLESS] AudioWorklet failed to load, using native nodes fallback', e);
      this.workletReady = false;
    }

    // Master bus — all strokes connect here
    this.masterBus = c.createGain();
    this.masterBus.gain.value = 1;

    // ── FILTER (single BiquadFilterNode) ──
    this.filterNode = c.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.setValueAtTime(AudioEngine.mapCutoffFreq(this.mod.filterCutoff), now);
    this.filterNode.Q.setValueAtTime(Math.max(0.001, AudioEngine.mapResonanceQ(this.mod.filterResonance)), now);
    this.filterDryGain = c.createGain();
    this.filterDryGain.gain.value = 1;
    this.filterOutGain = c.createGain();
    this.filterOutGain.gain.value = 1;
    // LADDER drive waveshaper (bypassed unless LADDER)
    this.ladderDriveNode = c.createWaveShaper();
    this.ladderDriveNode.oversample = '2x';
    this.updateDriveCurve(0);
    // SEM allpass (bypassed unless SEM)
    this.semAllpassNode = c.createBiquadFilter();
    this.semAllpassNode.type = 'allpass';
    this.semAllpassNode.frequency.setValueAtTime(AudioEngine.mapCutoffFreq(this.mod.filterCutoff), now);
    this.semAllpassNode.Q.setValueAtTime(0.5, now);
    // Connect filter chain based on current type
    this.connectFilterChain();

    // ── DELAY ──
    this.delayNode = c.createDelay(5);
    this.delayNode.delayTime.value = this.mod.delayTime;
    this.delayFeedback = c.createGain();
    this.delayFeedback.gain.value = Math.min(this.mod.delayFeedback, 0.92);
    this.delayDry = c.createGain();
    this.delayDry.gain.value = 1 - this.mod.delayMix * 0.3;
    this.delayWet = c.createGain();
    this.delayWet.gain.value = this.mod.delayMix;
    this.delayMixer = c.createGain();
    this.delayMixer.gain.value = 1;
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayDry.connect(this.delayMixer);
    this.delayWet.connect(this.delayMixer);

    // ── REVERB ──
    this.reverbPreDelay = c.createDelay(0.1);
    this.reverbPreDelay.delayTime.value = this.mod.reverbPreDelay / 1000;
    try {
      this.convolver = new ConvolverNode(c, { buffer: this.generateImpulse() });
    } catch (_) {
      this.convolver = c.createConvolver();
      try { this.convolver.buffer = this.generateImpulse(); } catch (__) {}
    }
    this.reverbDry = c.createGain();
    this.reverbDry.gain.value = 1 - (this.mod.reverbMix / 100);
    this.reverbWet = c.createGain();
    this.reverbWet.gain.value = this.mod.reverbMix / 100;
    this.reverbMixer = c.createGain();
    this.reverbMixer.gain.value = 1;
    // LOFI processing nodes (created once, only connected when LOFI active)
    this.lofiLowpass = c.createBiquadFilter();
    this.lofiLowpass.type = 'lowpass';
    this.lofiLowpass.frequency.setValueAtTime(2800, now);
    this.lofiLowpass.Q.setValueAtTime(0.7, now);
    this.lofiHighpass = c.createBiquadFilter();
    this.lofiHighpass.type = 'highpass';
    this.lofiHighpass.frequency.setValueAtTime(180, now);
    this.lofiHighpass.Q.setValueAtTime(0.7, now);
    this.lofiWowDelay = c.createDelay(0.05);
    this.lofiWowDelay.delayTime.setValueAtTime(0.01, now);
    this.lofiWowLfo = c.createOscillator();
    this.lofiWowLfo.type = 'sine';
    this.lofiWowLfo.frequency.setValueAtTime(0.8, now);
    this.lofiWowLfoGain = c.createGain();
    this.lofiWowLfoGain.gain.setValueAtTime(this.mod.reverbParam2 * 0.015, now);
    this.lofiWowLfo.connect(this.lofiWowLfoGain);
    this.lofiWowLfoGain.connect(this.lofiWowDelay.delayTime);
    this.lofiWowLfo.start(now);
    // LOFI CRUSH WaveShaperNode — real-time bit-crushing in the reverb path
    this.lofiCrusher = c.createWaveShaper();
    this.lofiCrusher.oversample = 'none'; // no oversampling for aliasing character
    this.updateLofiCrusherCurve(this.mod.reverbParam1);

    this.reverbPreDelay.connect(this.convolver);
    this.connectReverbOutput();
    this.reverbDry.connect(this.reverbMixer);
    this.reverbWet.connect(this.reverbMixer);

    // ── CHORUS: 2 parallel modulated delays ──
    this.chorusDry = c.createGain();
    this.chorusDry.gain.value = 1 - this.mod.chorusMix * 0.5;
    this.chorusWet = c.createGain();
    this.chorusWet.gain.value = this.mod.chorusMix;
    this.chorusMixer = c.createGain();
    this.chorusMixer.gain.value = 1;
    const cRates = [this.mod.chorusRate, this.mod.chorusRate * 1.08];
    const cBaseTimes = [0.007, 0.013];
    for (let i = 0; i < 2; i++) {
      const d = c.createDelay(0.05);
      d.delayTime.value = cBaseTimes[i];
      const lfo = c.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = cRates[i];
      const lg = c.createGain();
      lg.gain.value = this.mod.chorusDepth * 0.004;
      lfo.connect(lg); lg.connect(d.delayTime);
      lfo.start(now);
      d.connect(this.chorusWet);
      this.chorusDelays.push(d);
      this.chorusLfos.push(lfo);
      this.chorusLfoGains.push(lg);
    }
    this.chorusDry.connect(this.chorusMixer);
    this.chorusWet.connect(this.chorusMixer);

    // ── PHASER: 4 allpass filters in series with shared LFO ──
    this.phaserDry = c.createGain();
    this.phaserDry.gain.value = 1 - this.mod.phaserMix * 0.5;
    this.phaserWet = c.createGain();
    this.phaserWet.gain.value = this.mod.phaserMix;
    this.phaserMixer = c.createGain();
    this.phaserMixer.gain.value = 1;
    this.phaserLfo = c.createOscillator();
    this.phaserLfo.type = 'sine';
    this.phaserLfo.frequency.value = this.mod.phaserRate;
    this.phaserLfoGain = c.createGain();
    this.phaserLfoGain.gain.value = this.mod.phaserDepth * 800;
    this.phaserLfo.connect(this.phaserLfoGain);
    this.phaserLfo.start(now);
    let prevPhaser: AudioNode | null = null;
    for (let i = 0; i < 4; i++) {
      const ap = c.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.setValueAtTime(1000 + i * 500, now);
      ap.Q.setValueAtTime(0.5, now);
      this.phaserLfoGain.connect(ap.frequency);
      if (prevPhaser) (prevPhaser as BiquadFilterNode).connect(ap);
      this.phaserFilters.push(ap);
      prevPhaser = ap;
    }
    // Last phaser filter → phaserWet
    if (this.phaserFilters.length > 0) {
      this.phaserFilters[this.phaserFilters.length - 1].connect(this.phaserWet);
    }
    this.phaserDry.connect(this.phaserMixer);
    this.phaserWet.connect(this.phaserMixer);

    // ── FLANGER: short delay + feedback + LFO ──
    this.flangerDry = c.createGain();
    this.flangerDry.gain.value = 1 - this.mod.flangerDepth * 0.3;
    this.flangerWet = c.createGain();
    this.flangerWet.gain.value = 0.3;
    this.flangerMixer = c.createGain();
    this.flangerMixer.gain.value = 1;
    this.flangerDelay = c.createDelay(0.02);
    this.flangerDelay.delayTime.value = 0.003;
    this.flangerFeedback = c.createGain();
    this.flangerFeedback.gain.value = this.mod.flangerFeedback;
    this.flangerLfo = c.createOscillator();
    this.flangerLfo.type = 'sine';
    this.flangerLfo.frequency.value = this.mod.flangerRate;
    this.flangerLfoGain = c.createGain();
    this.flangerLfoGain.gain.value = this.mod.flangerDepth * 0.002;
    this.flangerLfo.connect(this.flangerLfoGain);
    this.flangerLfoGain.connect(this.flangerDelay.delayTime);
    this.flangerLfo.start(now);
    this.flangerDelay.connect(this.flangerFeedback);
    this.flangerFeedback.connect(this.flangerDelay);
    this.flangerDelay.connect(this.flangerWet);
    this.flangerDry.connect(this.flangerMixer);
    this.flangerWet.connect(this.flangerMixer);

    // ── MASTER PANNER ──
    this.masterPanner = c.createStereoPanner();
    this.masterPanner.pan.value = 0;

    // ── MASTER VOLUME ──
    this.masterVolGain = c.createGain();
    this.masterVolGain.gain.value = this.mod.masterVolume;

    // ── PRE-COMPRESSOR HIGH-SHELF (tame highs before limiting) ──
    this.preCompHighShelf = c.createBiquadFilter();
    this.preCompHighShelf.type = 'highshelf';
    this.preCompHighShelf.frequency.value = 6000;
    this.preCompHighShelf.gain.value = -4;

    // ── MASTER COMPRESSOR (transparent — per-flavor limiters handle individual levels) ──
    this.compressor = c.createDynamicsCompressor();
    this.compressor.threshold.value = -3;
    this.compressor.ratio.value = 2;
    this.compressor.knee.value = 6;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.3;

    // ── POST-COMPRESSOR OUTPUT GAIN (just under unity for headroom) ──
    this.postCompGain = c.createGain();
    this.postCompGain.gain.value = 0.92;

    // ── SOFT CLIPPER (tanh at -1dB after compressor) ──
    this.softClipper = c.createWaveShaper();
    this.softClipper.oversample = '2x';
    const scCurve = new Float32Array(8192);
    const thresh = 0.89;
    for (let i = 0; i < 8192; i++) {
      const x = (i * 2) / 8192 - 1;
      scCurve[i] = Math.abs(x) < thresh ? x : Math.sign(x) * (thresh + (1 - thresh) * Math.tanh((Math.abs(x) - thresh) / (1 - thresh)));
    }
    this.softClipper.curve = scCurve;

    // ── ANALYZER ──
    this.analyzer = c.createAnalyser();
    this.analyzer.fftSize = 2048;
    this.analyzer.smoothingTimeConstant = 0.85;

    // ═══ CONNECT MASTER CHAIN ═══
    // masterBus → filterOutGain → [delay dry/wet] → delayMixer → [reverb dry/wet] → reverbMixer
    //   → [chorus dry/wet] → chorusMixer → [phaser dry/wet] → phaserMixer → [flanger dry/wet] → flangerMixer
    //   → masterPanner → masterVolGain → compressor → softClipper → analyzer → destination

    // masterBus → filter
    this.masterBus.connect(this.filterDryGain);
    // filterOutGain → delay
    this.filterOutGain.connect(this.delayDry);
    this.filterOutGain.connect(this.delayNode);
    // delayMixer → reverb
    this.delayMixer.connect(this.reverbDry);
    this.delayMixer.connect(this.reverbPreDelay);
    // reverbMixer → chorus
    this.reverbMixer.connect(this.chorusDry);
    this.chorusDelays.forEach(d => this.reverbMixer!.connect(d));
    // chorusMixer → phaser
    this.chorusMixer.connect(this.phaserDry);
    if (this.phaserFilters.length > 0) this.chorusMixer.connect(this.phaserFilters[0]);
    // phaserMixer → flanger
    this.phaserMixer.connect(this.flangerDry);
    this.phaserMixer.connect(this.flangerDelay);
    // flangerMixer → panner → volume → preCompAnalyzer+freqAnalyzer (tap) → highShelf → compressor → postCompGain(0.92) → softClipper → analyzer → dest
    this.preCompAnalyzer = c.createAnalyser();
    this.preCompAnalyzer.fftSize = 2048;
    this.preCompAnalyzer.smoothingTimeConstant = 0.5;
    this.freqAnalyzer = c.createAnalyser();
    this.freqAnalyzer.fftSize = 256;
    this.freqAnalyzer.smoothingTimeConstant = 0.75;
    this.flangerMixer.connect(this.masterPanner);
    this.masterPanner.connect(this.masterVolGain);
    this.masterVolGain.connect(this.preCompAnalyzer);
    this.masterVolGain.connect(this.freqAnalyzer);
    this.masterVolGain.connect(this.preCompHighShelf);
    this.preCompHighShelf.connect(this.compressor);
    this.compressor.connect(this.postCompGain);
    this.postCompGain.connect(this.softClipper);
    this.softClipper.connect(this.analyzer);
    this.analyzer.connect(c.destination);

    // ── Per-flavor tanh soft-clip curves for SAW and METAL ──
    const tanhCurve = new Float32Array(256);
    const tanhNorm = Math.tanh(200);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      tanhCurve[i] = Math.tanh(200 * x) / tanhNorm;
    }
    for (const fl of ['saw', 'metal'] as SoundFlavor[]) {
      const ws = c.createWaveShaper();
      ws.curve = tanhCurve;
      ws.oversample = '2x';
      this.flavorSoftClippers[fl] = ws;
    }

    // ── Per-flavor bus gains + hard limiters ──
    // Chain per flavor: flavorBusGain(fader) → [softClipper if SAW/METAL] → limiter → masterBus
    const allFlavors: SoundFlavor[] = ['sine', 'saw', 'sub', 'grain', 'noise', 'metal', 'flutter', 'crystal'];
    for (const fl of allFlavors) {
      // Fader gain
      const g = c.createGain();
      g.gain.setValueAtTime(this.flavorVolumes[fl], now);
      this.flavorBusGains[fl] = g;

      // Hard limiter (DynamicsCompressor as brick-wall)
      const limiter = c.createDynamicsCompressor();
      limiter.threshold.value = FLAVOR_CEILINGS[fl];
      limiter.knee.value = 0;       // hard knee, true limiting
      limiter.ratio.value = 20;     // near-brick-wall ratio
      limiter.attack.value = 0.001; // 1ms default
      limiter.release.value = 0.05; // 50ms, transparent release
      // SAW and METAL: tighter attack and lower ceiling to catch transients
      if (fl === 'saw' || fl === 'metal') {
        limiter.attack.value = 0.0001; // 0.1ms — catches brief transients
        limiter.threshold.value = -30;  // aggressive ceiling override
      }
      this.flavorLimiters[fl] = limiter;

      // Wire: busGain → [softClipper] → limiter → masterBus
      const clipper = this.flavorSoftClippers[fl];
      if (clipper) {
        g.connect(clipper);
        clipper.connect(limiter);
      } else {
        g.connect(limiter);
      }
      limiter.connect(this.masterBus);
    }

    // Debug logging removed — loudness balance verified

    // ── LFOs ──
    this.buildLFO(1);
    this.buildLFO(2);
    this.connectLFO(1);
    this.connectLFO(2);

    // ── Granular Cloud output ──
    this.grainCloudGain = c.createGain();
    this.grainCloudGain.gain.value = 0.25;
    this.grainCloudGain.connect(this.masterBus);

    // ── Resonance pad ──
    this.resonancePadGain = c.createGain();
    this.resonancePadGain.gain.value = 0;
    this.resonancePadGain.connect(this.masterBus);
  }

  // ═══════════════════════════════════════════
  // FILTER — single BiquadFilterNode, topology swapped by type
  // ═══════════════════════════════════════════
  private connectFilterChain() {
    if (!this.filterDryGain || !this.filterNode || !this.filterOutGain || !this.ladderDriveNode || !this.semAllpassNode) return;
    // Disconnect previous
    try { this.filterDryGain.disconnect(); } catch (_) {}
    try { this.filterNode.disconnect(); } catch (_) {}
    try { this.ladderDriveNode.disconnect(); } catch (_) {}
    try { this.semAllpassNode.disconnect(); } catch (_) {}

    const type = this.mod.filterType;
    this.applyFilterType();

    if (type === 'LADDER') {
      // filter → ladderDrive → filterOut
      this.filterDryGain.connect(this.filterNode);
      this.filterNode.connect(this.ladderDriveNode);
      this.ladderDriveNode.connect(this.filterOutGain);
    } else if (type === 'SEM') {
      // filter → semAllpass → filterOut
      this.filterDryGain.connect(this.filterNode);
      this.filterNode.connect(this.semAllpassNode);
      this.semAllpassNode.connect(this.filterOutGain);
    } else {
      // filter → filterOut
      this.filterDryGain.connect(this.filterNode);
      this.filterNode.connect(this.filterOutGain);
    }
  }

  // ── Exponential cutoff mapping: 0-100 knob → 80-18000 Hz ──
  // First 50% covers 80-~1200Hz, second 50% covers ~1200-18000Hz
  private static readonly CUTOFF_MIN = 80;
  private static readonly CUTOFF_MAX = 18000;
  private static readonly CUTOFF_RATIO = AudioEngine.CUTOFF_MAX / AudioEngine.CUTOFF_MIN; // 225

  static mapCutoffFreq(knobValue: number): number {
    return AudioEngine.CUTOFF_MIN * Math.pow(AudioEngine.CUTOFF_RATIO, knobValue / 100);
  }

  // ── Resonance mapping: 0-100 knob → Q 0.5-18.5 ──
  static mapResonanceQ(knobValue: number): number {
    return 0.5 + (knobValue / 100) * 18;
  }

  // ── Envelope Attack mapping: 0-100 knob → 0.005s-2.0s ──
  private static readonly ATK_MIN = 0.005;
  private static readonly ATK_MAX = 2.0;
  private static readonly ATK_RATIO = AudioEngine.ATK_MAX / AudioEngine.ATK_MIN; // 400

  static mapAttackSec(knobValue: number): number {
    return AudioEngine.ATK_MIN * Math.pow(AudioEngine.ATK_RATIO, knobValue / 100);
  }

  // ── Envelope Release mapping: 0-100 knob → 0.05s-4.0s ──
  private static readonly REL_MIN = 0.05;
  private static readonly REL_MAX = 4.0;
  private static readonly REL_RATIO = AudioEngine.REL_MAX / AudioEngine.REL_MIN; // 80

  static mapReleaseSec(knobValue: number): number {
    return AudioEngine.REL_MIN * Math.pow(AudioEngine.REL_RATIO, knobValue / 100);
  }

  private applyFilterType() {
    if (!this.filterNode || !this.ctx) return;
    const now = this.ctx.currentTime;
    const { filterCutoff: coKnob, filterResonance: resKnob, filterType: type, filterDrive: drive } = this.mod;

    // Map knob 0-100 to perceptual values
    const mappedFreq = AudioEngine.mapCutoffFreq(coKnob);
    const mappedQ = AudioEngine.mapResonanceQ(resKnob);

    switch (type) {
      case 'LP': this.filterNode.type = 'lowpass'; break;
      case 'HP': this.filterNode.type = 'highpass'; break;
      case 'BP': this.filterNode.type = 'bandpass'; break;
      case 'NOTCH': this.filterNode.type = 'notch'; break;
      case 'LADDER':
        this.filterNode.type = 'lowpass';
        this.updateDriveCurve(drive);
        break;
      case 'SEM':
        this.filterNode.type = 'lowpass';
        if (this.semAllpassNode) {
          // SEM allpass tracks cutoff with smooth ramp
          this.semAllpassNode.frequency.cancelScheduledValues(now);
          this.semAllpassNode.frequency.setValueAtTime(this.semAllpassNode.frequency.value, now);
          this.semAllpassNode.frequency.exponentialRampToValueAtTime(mappedFreq, now + 0.025);
          this.semAllpassNode.Q.cancelScheduledValues(now);
          this.semAllpassNode.Q.setValueAtTime(this.semAllpassNode.Q.value, now);
          this.semAllpassNode.Q.exponentialRampToValueAtTime(Math.max(0.001, 0.5 + mappedQ * 0.3), now + 0.02);
        }
        break;
    }

    // ── Resonance: 20ms exponential ramp (eliminates zipper noise) ──
    let qForType: number;
    switch (type) {
      case 'LADDER': qForType = mappedQ * 3.5; break;
      case 'SEM': qForType = Math.min(mappedQ, 8); break;
      default: qForType = mappedQ; break;
    }
    // Q must be > 0 for exponentialRamp
    const safeQ = Math.max(0.001, qForType);
    this.filterNode.Q.cancelScheduledValues(now);
    this.filterNode.Q.setValueAtTime(Math.max(0.001, this.filterNode.Q.value), now);
    this.filterNode.Q.exponentialRampToValueAtTime(safeQ, now + 0.02);

    // ── Cutoff: 25ms exponential ramp (eliminates zipper noise) ──
    this.filterNode.frequency.cancelScheduledValues(now);
    this.filterNode.frequency.setValueAtTime(this.filterNode.frequency.value, now);
    this.filterNode.frequency.exponentialRampToValueAtTime(mappedFreq, now + 0.025);
  }

  private updateDriveCurve(drive: number) {
    if (!this.ladderDriveNode) return;
    const amt = 1 + drive * 5;
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * amt); }
    this.ladderDriveNode.curve = drive > 0 ? curve : null;
  }

  // Generate WaveShaperNode curve for LOFI bit-crushing
  // crushVal: 0..1 where 0=16-bit (transparent), 1=3-bit (heavy)
  private updateLofiCrusherCurve(crushVal: number) {
    if (!this.lofiCrusher) return;
    const bitDepth = 16 - crushVal * 13; // 16 at 0, 3 at 1
    const step = 2 / Math.pow(2, Math.floor(bitDepth));
    const samples = 8192;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1; // -1..1
      curve[i] = Math.round(x / step) * step;
    }
    this.lofiCrusher.curve = curve;
  }

  // Connect reverb output path: LOFI uses degradation chain + crusher, others go direct
  private connectReverbOutput() {
    if (!this.convolver || !this.reverbWet || !this.lofiLowpass || !this.lofiHighpass || !this.lofiWowDelay) return;
    try { this.convolver.disconnect(); } catch (_) {}
    try { this.lofiLowpass.disconnect(); } catch (_) {}
    try { this.lofiHighpass.disconnect(); } catch (_) {}
    try { this.lofiWowDelay.disconnect(); } catch (_) {}
    try { this.lofiCrusher?.disconnect(); } catch (_) {}

    if (this.mod.reverbType === 'LOFI') {
      // convolver → crusher → lofiLP → lofiHP → wowDelay → reverbWet
      this.convolver.connect(this.lofiCrusher!);
      this.lofiCrusher!.connect(this.lofiLowpass);
      this.lofiLowpass.connect(this.lofiHighpass);
      this.lofiHighpass.connect(this.lofiWowDelay);
      this.lofiWowDelay.connect(this.reverbWet);
      // Update crusher curve and wow depth
      this.updateLofiCrusherCurve(this.mod.reverbParam1);
      if (this.lofiWowLfoGain && this.ctx) {
        const depth = this.mod.reverbParam2 * 0.015;
        this.lofiWowLfoGain.gain.setValueAtTime(depth, this.ctx.currentTime);
      }
    } else {
      // convolver → reverbWet (direct)
      this.convolver.connect(this.reverbWet);
    }
  }

  // ═══════════════════════════════════════════
  // REVERB — stereo impulse response, regenerated on type change
  // HALL/MASSIVE/GRANULAR significantly improved
  // ═══════════════════════════════════════════
  private generateImpulse(): AudioBuffer {
    const rate = this.ctx!.sampleRate;
    const type = this.mod.reverbType;
    let dur: number;
    switch (type) {
      case 'ROOM': dur = 1.2; break;
      case 'HALL': dur = 6.0; break;
      case 'GRANULAR': dur = 3.0; break;
      case 'LOFI': dur = 2.5; break;
      case 'SPATIAL': dur = 5.0; break;
      case 'MASSIVE': dur = 8.0; break;
      default: dur = 2.0;
    }
    const len = Math.floor(rate * dur);
    const buf = this.ctx!.createBuffer(2, len, rate);
    // Base wet gain: HALL/MASSIVE/GRANULAR louder than ROOM
    const bigVerb = type === 'HALL' || type === 'MASSIVE' || type === 'GRANULAR';
    const isLofi = type === 'LOFI';
    const baseGain = isLofi ? 0.7 : bigVerb ? 0.75 : 0.5;

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / rate; // time in seconds
        const tNorm = i / len;
        let s = Math.random() * 2 - 1;
        switch (type) {
          case 'ROOM':
            s *= Math.exp(-tNorm * 4);
            break;

          case 'HALL': {
            // 6s concert hall: exponential decay from 1.0→0.0 over full 6s
            const hallDecay = Math.exp(-t * (3.0 / dur)); // reaches ~0.05 at 6s
            s *= hallDecay;
            // Stereo width: R channel 25% louder throughout
            if (ch === 1) s *= 1.25;
            // Early reflections — L: 17ms, 43ms, 89ms. R: 23ms, 61ms, 97ms
            // Amplitude spikes at 0.4 so reflections are clearly audible
            const hallERTimes = ch === 0
              ? [0.017, 0.043, 0.089]
              : [0.023, 0.061, 0.097];
            for (const erT of hallERTimes) {
              const erSample = Math.floor(erT * rate);
              if (i >= erSample && i < erSample + Math.floor(0.003 * rate)) {
                s += (Math.random() * 2 - 1) * 0.4;
              }
            }
            break;
          }

          case 'GRANULAR': {
            // 3s fragmented, glitchy reverb: 60ms grains, random amplitude, silence gaps
            const grainDur = 0.060; // 60ms
            const gapDur = 0.015; // 15ms gap every 2-3 grains
            const cycleDur = grainDur * 2.5 + gapDur;
            const cycleSamples = Math.floor(cycleDur * rate);
            const grainSamples = Math.floor(grainDur * rate);
            const gapSamples = Math.floor(gapDur * rate);
            const posInCycle = i % cycleSamples;
            // Check if we're in a gap
            const grainBlock2End = grainSamples * 2;
            if (posInCycle >= grainBlock2End && posInCycle < grainBlock2End + gapSamples) {
              s = 0; // silence gap
            } else {
              // Random grain amplitude (20%-100%)
              const grainIdx = Math.floor(i / grainSamples);
              const grainAmp = 0.2 + ((grainIdx * 7919 + ch * 1013) % 100) / 125.0;
              // Random pitch variation: stretch/compress via sample skipping
              const pitchFactor = 0.85 + ((grainIdx * 3571 + ch * 997) % 100) / 333.0;
              const envPos = (posInCycle % grainSamples) / grainSamples;
              const grainEnv = envPos < 0.1 ? envPos / 0.1 : envPos > 0.9 ? (1 - envPos) / 0.1 : 1;
              s *= grainAmp * grainEnv * pitchFactor;
            }
            s *= Math.exp(-t / 1.5); // overall decay
            break;
          }

          case 'LOFI': {
            // LOFI: bit-depth crushing from 16-bit (transparent) to 3-bit (heavy degradation)
            // CRUSH knob (reverbParam1): 0=16-bit, 1=3-bit
            const crushVal = this.mod.reverbParam1; // 0..1
            const bitDepth = 16 - crushVal * 13; // 16 at 0, 3 at 1
            const crushStep = 2 / Math.pow(2, Math.floor(bitDepth));
            s *= Math.exp(-t / (0.8 + this.mod.reverbDecay * 1.5)); // longer decay
            // Quantize to step size (waveshaper-style rounding)
            s = Math.round(s / crushStep) * crushStep;
            // Above 60% crush: add aliasing noise for obvious digital grit
            if (crushVal > 0.6) {
              const gritAmount = (crushVal - 0.6) / 0.4; // 0..1 in the 60-100% range
              s += (Math.random() * 2 - 1) * 0.03 * gritAmount;
            }
            // Subtle noise floor for tape hiss character
            s += (Math.random() * 2 - 1) * 0.005 * crushVal;
            break;
          }

          case 'SPATIAL': {
            // 5s 3D spatial: L=low (<600Hz), R=high (>1800Hz), slow rotation
            const spatialDecay = Math.exp(-t * (2.5 / dur));
            s *= spatialDecay;
            // 0.08Hz amplitude modulation for slow L/R rotation (12s cycle)
            const rotPhase = 2 * Math.PI * 0.08 * t;
            const rotGain = ch === 0
              ? 0.6 + 0.4 * Math.cos(rotPhase)        // L peaks when cos=1
              : 0.6 + 0.4 * Math.cos(rotPhase + Math.PI); // R peaks opposite
            s *= rotGain;
            // Frequency split is applied in post-processing pass below
            break;
          }

          case 'MASSIVE': {
            // 8s cathedral: 100ms silence → 3s ramp → 1s hold → 4s decay
            if (t < 0.1) {
              s = 0; // true pre-delay silence
            } else if (t < 3.1) {
              s *= ((t - 0.1) / 3.0); // slow bloom ramp
            } else if (t < 4.1) {
              s *= 1.0; // peak hold
            } else {
              s *= Math.exp(-((t - 4.1) / 4.0) * 3.0); // long decay
            }
            // Short room impulse layer at 15% for early reflection density
            if (t < 1.0 && t >= 0.1) {
              const roomDecay = Math.exp(-(t - 0.1) * 6.0); // 1s room
              s += (Math.random() * 2 - 1) * 0.15 * roomDecay;
            }
            // LP at 2200Hz applied in post-processing pass below
            break;
          }
        }
        d[i] = s * baseGain;
      }
    }

    // ── Post-processing passes on impulse buffer ──

    // HALL: gentle high-shelf boost at 6kHz (+3dB) for airy bright tail
    if (type === 'HALL') {
      const shelfFreq = 6000;
      const shelfAlpha = Math.min(1, (2 * Math.PI * shelfFreq) / rate);
      const boostLin = Math.pow(10, 3 / 20); // +3dB
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let prev = 0;
        for (let i = 0; i < len; i++) {
          // Split into low and high via 1-pole LP
          const low = prev + shelfAlpha * (d[i] - prev);
          const high = d[i] - low;
          prev = low;
          d[i] = low + high * boostLin;
        }
      }
    }

    // SPATIAL: L channel low-pass <600Hz, R channel high-pass >1800Hz
    if (type === 'SPATIAL') {
      const lpAlpha = Math.min(1, (2 * Math.PI * 600) / rate);
      const hpAlpha = Math.min(1, (2 * Math.PI * 1800) / rate);
      // L channel: low-pass at 600Hz
      const dL = buf.getChannelData(0);
      let lpPrev = 0;
      for (let i = 0; i < len; i++) {
        lpPrev = lpPrev + lpAlpha * (dL[i] - lpPrev);
        dL[i] = lpPrev;
      }
      // R channel: high-pass at 1800Hz
      const dR = buf.getChannelData(1);
      let hpPrev = 0;
      for (let i = 0; i < len; i++) {
        const raw = dR[i];
        hpPrev = hpPrev + hpAlpha * (raw - hpPrev);
        dR[i] = raw - hpPrev; // subtract lowpass to get highpass
      }
    }

    // MASSIVE: low-pass at 2200Hz for dark heavy tail
    if (type === 'MASSIVE') {
      const massLpAlpha = Math.min(1, (2 * Math.PI * 2200) / rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let prev = 0;
        for (let i = 0; i < len; i++) {
          prev = prev + massLpAlpha * (d[i] - prev);
          d[i] = prev;
        }
      }
    }

    return buf;
  }

  private rebuildReverb(applyDefaults = true) {
    if (!this.ctx || !this.convolver || !this.reverbPreDelay || !this.reverbWet) return;
    try { this.reverbPreDelay.disconnect(); } catch (_) {}
    try { this.convolver.disconnect(); } catch (_) {}
    try {
      this.convolver = new ConvolverNode(this.ctx, { buffer: this.generateImpulse() });
    } catch (_) {
      this.convolver = this.ctx.createConvolver();
      try { this.convolver.buffer = this.generateImpulse(); } catch (__) {}
    }
    this.reverbPreDelay.connect(this.convolver);
    this.connectReverbOutput();

    // Per-type defaults only applied on reverb TYPE change, not on param tweaks
    if (!applyDefaults) return;

    const now = this.ctx.currentTime;
    const rt = this.mod.reverbType;

    // Per-type default MIX values — immediately impactful on selection
    const defaultMix: Record<ReverbType, number> = {
      ROOM: 60, HALL: 72, GRANULAR: 68, LOFI: 65, SPATIAL: 75, MASSIVE: 82,
    };
    this.mod.reverbMix = defaultMix[rt];
    const mix = this.mod.reverbMix / 100;
    this.reverbWet.gain.setValueAtTime(mix, now);
    this.reverbDry!.gain.setValueAtTime(1 - mix, now);

    // Per-type recommended defaults
    if (rt === 'HALL') {
      this.mod.reverbSize = 0.85;
      this.mod.reverbDecay = 0.80;
      this.mod.reverbPreDelay = 55;
      this.reverbPreDelay.delayTime.setValueAtTime(0.055, now);
    } else if (rt === 'SPATIAL') {
      this.mod.reverbParam1 = 0.90; // SPREAD
      this.mod.reverbParam2 = 0.70; // HEIGHT
    } else if (rt === 'MASSIVE') {
      this.mod.reverbSize = 0.98;
      this.mod.reverbDecay = 0.92;
      this.mod.reverbParam1 = 0.70; // SWELL
    } else if (rt === 'LOFI') {
      this.mod.reverbSize = 0.75;
      this.mod.reverbDecay = 0.6;
      this.mod.reverbParam1 = 0.7; // CRUSH at 70%
      this.mod.reverbParam2 = 0.6; // WOW at 60%
      this.mod.reverbPreDelay = 15;
      this.reverbPreDelay.delayTime.setValueAtTime(0.015, now);
      if (this.lofiWowLfoGain) {
        this.lofiWowLfoGain.gain.setValueAtTime(0.6 * 0.015, now);
      }
      // Set initial crusher curve to match default
      this.updateLofiCrusherCurve(0.7);
    }
  }

  // ═══════════════════════════════════════════
  // LFOs
  // ══════════════════════════════════════════
  private getLFORate(num: 1 | 2): number {
    const sync = num === 1 ? this.mod.lfo1Sync : this.mod.lfo2Sync;
    const rate = num === 1 ? this.mod.lfo1Rate : this.mod.lfo2Rate;
    if (!sync) return rate;
    const bps = this.mod.tempo / 60;
    const subdivs = [1, 0.5, 0.25, 0.125, 0.0625, 0.03125];
    const idx = Math.min(Math.floor(rate / 3.33), subdivs.length - 1);
    return bps / (subdivs[Math.max(0, idx)] * 4);
  }

  private buildLFO(num: 1 | 2) {
    if (!this.ctx) return;
    const shape = num === 1 ? this.mod.lfo1Shape : this.mod.lfo2Shape;
    const rate = this.getLFORate(num);
    if (num === 1) { try { this.lfo1Osc?.stop(); } catch (_) {}; if (this.lfo1SHInterval) clearInterval(this.lfo1SHInterval); }
    else { try { this.lfo2Osc?.stop(); } catch (_) {}; if (this.lfo2SHInterval) clearInterval(this.lfo2SHInterval); }

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    if (shape === 'SINE') osc.type = 'sine';
    else if (shape === 'TRI') osc.type = 'triangle';
    else if (shape === 'SQR') osc.type = 'square';
    else if (shape === 'RAMP_UP') osc.type = 'sawtooth';
    else if (shape === 'RAMP_DN') { osc.type = 'sawtooth'; osc.frequency.value = -rate; }
    else osc.type = 'sine';
    if (shape !== 'RAMP_DN') osc.frequency.value = rate;
    osc.connect(gain);
    osc.start();

    if (num === 1) { this.lfo1Osc = osc; this.lfo1Gain = gain; }
    else { this.lfo2Osc = osc; this.lfo2Gain = gain; }

    if (shape === 'S&H') {
      const ms = Math.max(50, 1000 / rate);
      const id = setInterval(() => {
        const g = num === 1 ? this.lfo1Gain : this.lfo2Gain;
        const d = num === 1 ? this.mod.lfo1Depth : this.mod.lfo2Depth;
        if (g && this.ctx) g.gain.setValueAtTime((Math.random() * 2 - 1) * d, this.ctx.currentTime);
      }, ms);
      if (num === 1) this.lfo1SHInterval = id;
      else this.lfo2SHInterval = id;
    }
  }

  private connectLFO(num: 1 | 2) {
    const gain = num === 1 ? this.lfo1Gain : this.lfo2Gain;
    const depth = num === 1 ? this.mod.lfo1Depth : this.mod.lfo2Depth;
    const target = num === 1 ? this.mod.lfo1Target : this.mod.lfo2Target;
    const shape = num === 1 ? this.mod.lfo1Shape : this.mod.lfo2Shape;
    if (!gain || !this.ctx) return;
    const now = this.ctx.currentTime;
    try { gain.disconnect(); } catch (_) {}
    if (depth <= 0) return;

    switch (target) {
      case 'PITCH':
        if (shape !== 'S&H') this.smoothParam(gain.gain, depth * 50, 0.02);
        this.activeSounds.forEach(s => {
          s.oscillators.forEach(o => { try { gain.connect(o.detune); } catch (_) {} });
          s.harmonicOscs?.forEach(o => { try { gain.connect(o.detune); } catch (_) {} });
        });
        break;
      case 'FILTER':
        if (shape !== 'S&H') this.smoothParam(gain.gain, AudioEngine.mapCutoffFreq(this.mod.filterCutoff) * depth, 0.02);
        if (this.filterNode) { try { gain.connect(this.filterNode.frequency); } catch (_) {} }
        break;
      case 'VOLUME':
        if (shape !== 'S&H') this.smoothParam(gain.gain, depth * 0.3, 0.02);
        if (this.masterVolGain) { try { gain.connect(this.masterVolGain.gain); } catch (_) {} }
        break;
      case 'PAN':
        if (shape !== 'S&H') this.smoothParam(gain.gain, depth, 0.02);
        if (this.masterPanner) { try { gain.connect(this.masterPanner.pan); } catch (_) {} }
        break;
      case 'REVERB':
        if (shape !== 'S&H') this.smoothParam(gain.gain, depth * 0.5, 0.02);
        if (this.reverbWet) { try { gain.connect(this.reverbWet.gain); } catch (_) {} }
        break;
      case 'DELAY':
        if (shape !== 'S&H') this.smoothParam(gain.gain, depth * 0.3, 0.02);
        if (this.delayNode) { try { gain.connect(this.delayNode.delayTime); } catch (_) {} }
        break;
    }
  }

  // ═══════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════
  getAnalyzer() { return this.analyzer; }
  getPreCompAnalyzer() { return this.preCompAnalyzer; }
  getFreqAnalyzer() { return this.freqAnalyzer; }
  /** Returns a map of flavor → count for currently active (non-muted) sounds */
  getActiveFlavors(): Map<SoundFlavor, number> {
    const counts = new Map<SoundFlavor, number>();
    this.activeSounds.forEach(s => {
      if (!s.muted) counts.set(s.flavor, (counts.get(s.flavor) || 0) + 1);
    });
    return counts;
  }
  async resume() { if (this.ctx?.state === 'suspended') await this.ctx.resume(); }
  getActiveCount() { return this.strokePool.length; }
  getLockedCount() { return this.strokePool.filter(s => s.locked).length; }
  getModulators(): ModulatorSettings { return { ...this.mod }; }
  getDroneMode() { return this.droneMode; }
  getPlayMode() { return this.playMode; }
  getFlavorVolumes(): Record<SoundFlavor, number> { return { ...this.flavorVolumes }; }
  setFlavorVolume(flavor: SoundFlavor, value: number) {
    // Snap to exact zero when display would show 0% (value < 0.005 → rounds to 0%)
    const clamped = Math.max(0, Math.min(1, value));
    this.flavorVolumes[flavor] = clamped < 0.005 ? 0 : clamped;
    if (!this.ctx || !this.masterBus) return;
    const busGain = this.flavorBusGains[flavor];
    if (!busGain) return;

    const clipper = this.flavorSoftClippers[flavor];
    const limiter = this.flavorLimiters[flavor];
    if (this.flavorVolumes[flavor] === 0) {
      // Disconnect bus entirely — guarantees zero audio regardless of timing
      if (!this.disconnectedBuses.has(flavor)) {
        try { busGain.disconnect(); } catch (_) {}
        this.disconnectedBuses.add(flavor);
      }
    } else {
      // Reconnect ONLY if was previously disconnected
      // Chain: busGain → [softClipper] → limiter → masterBus
      if (this.disconnectedBuses.has(flavor)) {
        if (clipper && limiter) {
          try { busGain.connect(clipper); clipper.connect(limiter); limiter.connect(this.masterBus); } catch (_) {}
        } else if (limiter) {
          try { busGain.connect(limiter); limiter.connect(this.masterBus); } catch (_) {}
        } else {
          try { busGain.connect(this.masterBus); } catch (_) {}
        }
        this.disconnectedBuses.delete(flavor);
      }
      busGain.gain.setValueAtTime(this.flavorVolumes[flavor], this.ctx.currentTime);
    }
  }

  setScaleTable(table: ScaleNote[]) {
    this.scaleTable = table;
  }
  getScaleTable(): ScaleNote[] { return this.scaleTable; }

  /**
   * Retune all active strokes to the nearest scale degree in the current table,
   * mapping from each stroke's original canvas Y position. 300ms exponential glide.
   * Skips strokes in release phase and noise strokes (no pitch).
   */
  retuneActiveStrokes() {
    if (!this.ctx || this.scaleTable.length === 0) return;
    const now = this.ctx.currentTime;
    const glideTime = 0.3; // 300ms
    const canvasHeight = window.innerHeight;

    this.activeSounds.forEach(s => {
      // Skip noise strokes (no pitch) and strokes already releasing
      if (s.flavor === 'noise') return;
      if (s.isReleasing) return;

      // Determine new frequency from the stroke's original Y position
      let newFreq: number;
      if (s.yPosition != null) {
        const scaleNote = mapYToScaleFreq(s.yPosition, canvasHeight, this.scaleTable);
        newFreq = scaleNote.freq;
      } else {
        const nearest = findNearestScaleFreq(s.baseFrequency, this.scaleTable);
        newFreq = nearest.freq;
      }

      if (Math.abs(newFreq - s.baseFrequency) < 0.01) return;

      // ── WORKLET PATH ──
      if (s.workletNode) {
        s.workletNode.port.postMessage({ type: 'retune', freq: newFreq, glideRate: 0.001 });
        s.baseFrequency = newFreq;
        s.quantizedFreq = newFreq;
        return;
      }

      // ── FALLBACK: native node path ──
      const glideOscFreq = (param: AudioParam, targetFreq: number) => {
        try {
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          param.exponentialRampToValueAtTime(Math.max(targetFreq, 0.001), now + glideTime);
        } catch (_) {}
      };

      s.oscillators.forEach(osc => {
        const ratio = osc.frequency.value / s.baseFrequency;
        glideOscFreq(osc.frequency, newFreq * ratio);
      });

      if (s.harmonicOscs) {
        s.harmonicOscs.forEach(osc => {
          const ratio = osc.frequency.value / s.baseFrequency;
          glideOscFreq(osc.frequency, newFreq * ratio);
        });
      }

      if (s.liveOctaveOsc) {
        glideOscFreq(s.liveOctaveOsc.frequency, newFreq * 2);
      }
      if (s.liveFifthOsc) {
        glideOscFreq(s.liveFifthOsc.frequency, newFreq * Math.pow(2, 7 / 12));
      }
      if (s.live2ndOctaveOsc) {
        glideOscFreq(s.live2ndOctaveOsc.frequency, newFreq * 4);
      }

      s.baseFrequency = newFreq;
      s.quantizedFreq = newFreq;
    });
  }

  /**
   * Retune all active strokes when octave changes.
   * Applies a direct frequency ratio shift so every octave produces an audible change.
   * Oscillator-based strokes get frequency glide; buffer sources get playbackRate shift.
   */
  retuneForOctaveChange(oldOctave: number, newOctave: number) {
    if (!this.ctx) return;
    if (oldOctave === newOctave) return;
    this.currentOctave = newOctave;
    const ratio = Math.pow(2, newOctave - oldOctave);
    const now = this.ctx.currentTime;
    const glideTime = 0.3; // 300ms

    this.activeSounds.forEach(s => {
      if (s.isLive) return;
      if (!s.locked && !this.droneMode) return;

      const newBaseFreq = s.baseFrequency * ratio;

      // ── WORKLET PATH ──
      if (s.workletNode) {
        s.workletNode.port.postMessage({ type: 'retune', freq: newBaseFreq, glideRate: 0.001 });
        s.baseFrequency = newBaseFreq;
        s.quantizedFreq = newBaseFreq;
        return;
      }

      // ── FALLBACK: native node path ──
      s.oscillators.forEach(osc => {
        try {
          const freqRatio = osc.frequency.value / s.baseFrequency;
          osc.frequency.cancelScheduledValues(now);
          osc.frequency.setValueAtTime(osc.frequency.value, now);
          osc.frequency.exponentialRampToValueAtTime(newBaseFreq * freqRatio, now + glideTime);
        } catch (_) {}
      });

      if (s.harmonicOscs) {
        s.harmonicOscs.forEach(osc => {
          try {
            const freqRatio = osc.frequency.value / s.baseFrequency;
            osc.frequency.cancelScheduledValues(now);
            osc.frequency.setValueAtTime(osc.frequency.value, now);
            osc.frequency.exponentialRampToValueAtTime(newBaseFreq * freqRatio, now + glideTime);
          } catch (_) {}
        });
      }

      if (s.liveOctaveOsc) {
        try {
          s.liveOctaveOsc.frequency.cancelScheduledValues(now);
          s.liveOctaveOsc.frequency.setValueAtTime(s.liveOctaveOsc.frequency.value, now);
          s.liveOctaveOsc.frequency.exponentialRampToValueAtTime(newBaseFreq * 2, now + glideTime);
        } catch (_) {}
      }
      if (s.liveFifthOsc) {
        try {
          s.liveFifthOsc.frequency.cancelScheduledValues(now);
          s.liveFifthOsc.frequency.setValueAtTime(s.liveFifthOsc.frequency.value, now);
          s.liveFifthOsc.frequency.exponentialRampToValueAtTime(newBaseFreq * Math.pow(2, 7 / 12), now + glideTime);
        } catch (_) {}
      }
      if (s.live2ndOctaveOsc) {
        try {
          s.live2ndOctaveOsc.frequency.cancelScheduledValues(now);
          s.live2ndOctaveOsc.frequency.setValueAtTime(s.live2ndOctaveOsc.frequency.value, now);
          s.live2ndOctaveOsc.frequency.exponentialRampToValueAtTime(newBaseFreq * 4, now + glideTime);
        } catch (_) {}
      }

      s.allNodes.forEach(node => {
        if (node instanceof AudioBufferSourceNode) {
          try {
            const param = (node as AudioBufferSourceNode).playbackRate;
            param.cancelScheduledValues(now);
            param.setValueAtTime(param.value, now);
            param.exponentialRampToValueAtTime(param.value * ratio, now + glideTime);
          } catch (_) {}
        }
      });

      s.baseFrequency = newBaseFreq;
      s.quantizedFreq = newBaseFreq;
    });
  }

  getCurrentOctave() { return this.currentOctave; }

  setPlayMode(mode: PlayMode) {
    if (this.playMode === mode) return;
    this.playMode = mode;
    this.droneMode = mode === 'drone';
    // Clean break: fade out and remove ALL strokes from the old mode over 150ms
    this.clearAllStrokes(0.15);
  }

  setDroneMode(on: boolean) {
    this.setPlayMode(on ? 'drone' : 'gate');
  }

  // Fade all active strokes over given duration then remove
  fadeAllStrokes(duration: number): string[] {
    const faded: string[] = [];
    this.strokePool.forEach(s => {
      this.releaseStroke(s.id, duration);
      faded.push(s.id);
    });
    return faded;
  }

  // Hard-clear ALL strokes: fast fade over fadeSec, then stop/disconnect/remove everything.
  // Used on play-mode switches for a clean break.
  clearAllStrokes(fadeSec: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const pool = [...this.strokePool];
    for (const s of pool) {
      if (s.loopTimeout) clearTimeout(s.loopTimeout);
      if (s.cleanupTimeout) clearTimeout(s.cleanupTimeout);
      if (s.pulseInterval) { clearInterval(s.pulseInterval); s.pulseInterval = undefined; }
      if (s.deepRumbleInterval) clearTimeout(s.deepRumbleInterval);
      s.locked = false;

      if (s.workletNode) {
        s.workletNode.port.postMessage({ type: 'startRelease', releaseTime: fadeSec });
      } else {
        s.envelope.gain.cancelScheduledValues(now);
        s.envelope.gain.setValueAtTime(s.envelope.gain.value, now);
        s.envelope.gain.linearRampToValueAtTime(0, now + fadeSec);
      }
    }
    const cleanupMs = fadeSec * 1000 + 50;
    setTimeout(() => {
      for (const s of pool) {
        if (s.workletNode) {
          s.workletNode.port.postMessage({ type: 'kill' });
          try { s.workletNode.disconnect(); } catch (_) {}
        }
        s.allNodes.forEach(n => {
          try { if ('stop' in n && typeof (n as any).stop === 'function') (n as any).stop(); } catch (_) {}
          try { n.disconnect(); } catch (_) {}
        });
        try { s.panner?.disconnect(); } catch (_) {}
        try { s.flavorGain.disconnect(); } catch (_) {}
        try { s.envelope.disconnect(); } catch (_) {}
        this.activeSounds.delete(s.id);
      }
      this.strokePool.length = 0;
      this.applyVoiceDucking();
      this.checkResonance();
    }, cleanupMs);
  }

  setRootFrequency(freq: number) {
    this.rootFrequency = freq;
    if (this.resonancePad && this.ctx) this.resonancePad.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.5);
  }

  // Cancel-anchor-ramp: prevents clicks/pops from conflicting scheduled automation
  private smoothParam(param: AudioParam, targetVal: number, rampSec: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    // exponentialRamp requires value > 0
    if (targetVal > 0.0001) {
      param.exponentialRampToValueAtTime(targetVal, now + rampSec);
    } else {
      param.linearRampToValueAtTime(targetVal, now + rampSec);
    }
  }

  setModulators(settings: Partial<ModulatorSettings>) {
    const prev = { ...this.mod };
    this.mod = { ...this.mod, ...settings };
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (settings.masterVolume !== undefined && this.masterVolGain) {
      this.smoothParam(this.masterVolGain.gain, this.mod.masterVolume, 0.02);
    }

    // Filter
    if (settings.filterType !== undefined && settings.filterType !== prev.filterType) {
      this.connectFilterChain();
      this.connectLFO(1); this.connectLFO(2);
    } else if (settings.filterCutoff !== undefined || settings.filterResonance !== undefined || settings.filterDrive !== undefined) {
      this.applyFilterType();
    }

    // Chorus — cancel/anchor/ramp on all params to prevent clicks
    if (settings.chorusRate !== undefined || settings.chorusDepth !== undefined) {
      const rates = [this.mod.chorusRate, this.mod.chorusRate * 1.08];
      this.chorusLfos.forEach((lfo, i) => { try { this.smoothParam(lfo.frequency, rates[i], 0.02); } catch (_) {} });
      this.chorusLfoGains.forEach(g => this.smoothParam(g.gain, this.mod.chorusDepth * 0.004, 0.02));
    }
    if (settings.chorusMix !== undefined) {
      if (this.chorusWet) this.smoothParam(this.chorusWet.gain, this.mod.chorusMix, 0.02);
      if (this.chorusDry) this.smoothParam(this.chorusDry.gain, 1 - this.mod.chorusMix * 0.5, 0.02);
    }

    // Phaser
    if (settings.phaserRate !== undefined && this.phaserLfo) this.smoothParam(this.phaserLfo.frequency, this.mod.phaserRate, 0.02);
    if (settings.phaserDepth !== undefined && this.phaserLfoGain) this.smoothParam(this.phaserLfoGain.gain, this.mod.phaserDepth * 800, 0.02);
    if (settings.phaserMix !== undefined) {
      if (this.phaserWet) this.smoothParam(this.phaserWet.gain, this.mod.phaserMix, 0.02);
      if (this.phaserDry) this.smoothParam(this.phaserDry.gain, 1 - this.mod.phaserMix * 0.5, 0.02);
    }

    // Flanger
    if (settings.flangerRate !== undefined && this.flangerLfo) this.smoothParam(this.flangerLfo.frequency, this.mod.flangerRate, 0.02);
    if (settings.flangerDepth !== undefined && this.flangerLfoGain) this.smoothParam(this.flangerLfoGain.gain, this.mod.flangerDepth * 0.002, 0.02);
    if (settings.flangerFeedback !== undefined && this.flangerFeedback) this.smoothParam(this.flangerFeedback.gain, this.mod.flangerFeedback, 0.02);

    // Delay
    if (settings.delayTime !== undefined && this.delayNode) this.smoothParam(this.delayNode.delayTime, this.mod.delayTime, 0.03);
    if (settings.delayFeedback !== undefined && this.delayFeedback) this.smoothParam(this.delayFeedback.gain, Math.min(this.mod.delayFeedback, 0.92), 0.02);
    if (settings.delayMix !== undefined) {
      if (this.delayWet) this.smoothParam(this.delayWet.gain, this.mod.delayMix, 0.02);
      if (this.delayDry) this.smoothParam(this.delayDry.gain, 1 - this.mod.delayMix * 0.3, 0.02);
    }

    // Reverb — only rebuild on type change
    if (settings.reverbType !== undefined && settings.reverbType !== prev.reverbType) {
      this.rebuildReverb();
    }
    if (settings.reverbMix !== undefined) {
      const mix = this.mod.reverbMix / 100;
      if (this.reverbWet) this.smoothParam(this.reverbWet.gain, mix, 0.02);
      if (this.reverbDry) this.smoothParam(this.reverbDry.gain, 1 - mix, 0.02);
    }
    if (settings.reverbPreDelay !== undefined && this.reverbPreDelay) this.smoothParam(this.reverbPreDelay.delayTime, this.mod.reverbPreDelay / 1000, 0.03);
    // LOFI WOW depth: reverbParam2 controls wow flutter depth
    // 0 = no pitch modulation, 1 = maximum tape flutter (±0.015s delay modulation at 0.8Hz)
    if (settings.reverbParam2 !== undefined && this.mod.reverbType === 'LOFI' && this.lofiWowLfoGain) {
      const depth = this.mod.reverbParam2 * 0.015;
      this.smoothParam(this.lofiWowLfoGain.gain, depth, 0.02);
    }
    // LOFI CRUSH: update real-time WaveShaperNode curve only (no impulse rebuild — too expensive during drag)
    if (settings.reverbParam1 !== undefined && this.mod.reverbType === 'LOFI') {
      this.updateLofiCrusherCurve(this.mod.reverbParam1);
    }

    // Granular Cloud on/off
    if (settings.grainCloudActive !== undefined) {
      if (settings.grainCloudActive && !this.grainCloudActive) {
        this.startGrainCloud();
      } else if (!settings.grainCloudActive && this.grainCloudActive) {
        this.stopGrainCloud();
      }
    }
    // Handle freeze toggle
    if (settings.grainFreeze !== undefined && this.grainCloudActive) {
      if (settings.grainFreeze) {
        this.freezeGrainCloud();
      } else {
        this.unfreezeGrainCloud();
      }
    }
    // Update grain cloud parameters live
    if (this.grainCloudActive && (
      settings.grainSize !== undefined || settings.grainDensity !== undefined ||
      settings.grainScatter !== undefined || settings.grainPitchSpread !== undefined ||
      settings.grainReverse !== undefined
    )) {
      this.restartGrainCloud();
    }

    // Detune
    if (settings.detune !== undefined) {
      this.activeSounds.forEach(s => {
        [...s.oscillators, ...(s.harmonicOscs || [])].forEach(o => { try { this.smoothParam(o.detune, this.mod.detune, 0.02); } catch (_) {} });
      });
    }

    // LFOs
    if (settings.lfo1Rate !== undefined || settings.lfo1Shape !== undefined || settings.lfo1Sync !== undefined) {
      if (settings.lfo1Shape !== undefined && settings.lfo1Shape !== prev.lfo1Shape) this.buildLFO(1);
      else if (this.lfo1Osc) { try { this.smoothParam(this.lfo1Osc.frequency, this.getLFORate(1), 0.02); } catch (_) {} }
      this.connectLFO(1);
    }
    if (settings.lfo1Depth !== undefined || settings.lfo1Target !== undefined) this.connectLFO(1);
    if (settings.lfo2Rate !== undefined || settings.lfo2Shape !== undefined || settings.lfo2Sync !== undefined) {
      if (settings.lfo2Shape !== undefined && settings.lfo2Shape !== prev.lfo2Shape) this.buildLFO(2);
      else if (this.lfo2Osc) { try { this.smoothParam(this.lfo2Osc.frequency, this.getLFORate(2), 0.02); } catch (_) {} }
      this.connectLFO(2);
    }
    if (settings.lfo2Depth !== undefined || settings.lfo2Target !== undefined) this.connectLFO(2);

    // Envelope knob changes — retroactive update of active strokes
    if (settings.envAttack !== undefined || settings.envRelease !== undefined) {
      this.retroactiveEnvelopeUpdate();
    }

    // Pulse strokes: restart pulse envelope if tempo/pulseLength/attack/release changed
    if (settings.tempo !== undefined || settings.pulseLength !== undefined ||
        settings.envAttack !== undefined || settings.envRelease !== undefined) {
      this.activeSounds.forEach(s => {
        if (s.workletNode && s.locked && !s.isDrone) {
          // Update pulse params on worklet
          s.workletNode.port.postMessage({
            type: 'updatePulse',
            beatDur: 60 / this.mod.tempo,
            pulseLength: this.mod.pulseLength,
            attack: AudioEngine.mapAttackSec(this.mod.envAttack),
            release: AudioEngine.mapReleaseSec(this.mod.envRelease),
          });
        } else if (s.pulseInterval && !s.isDrone) {
          this.startPulseEnvelope(s, s.targetVol ?? 0.15);
        }
      });
    }

    // Envelope changes: propagate to worklet voices
    if (settings.envAttack !== undefined || settings.envRelease !== undefined) {
      this.activeSounds.forEach(s => {
        if (s.workletNode && !s.isDrone) {
          s.workletNode.port.postMessage({
            type: 'setEnvParams',
            attack: AudioEngine.mapAttackSec(this.mod.envAttack),
            release: AudioEngine.mapReleaseSec(this.mod.envRelease),
          });
        }
      });
    }
  }

  // Retroactively adjust envelopes of active non-drone, non-pulse strokes
  private retroactiveEnvelopeUpdate() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const newAttack = AudioEngine.mapAttackSec(this.mod.envAttack);
    const newRelease = AudioEngine.mapReleaseSec(this.mod.envRelease);

    this.activeSounds.forEach(s => {
      // Skip drone strokes (gain is frozen) and pulse strokes (handled separately)
      if (s.isDrone || s.pulseInterval || s.isLive) return;

      const elapsed = now - s.startTime;
      const vol = s.targetVol ?? 0.15;

      // Stroke is in attack phase if elapsed < old attack time
      if (elapsed < newAttack) {
        // Re-ramp to peak over remaining attack time
        const remaining = Math.max(0.005, newAttack - elapsed);
        s.envelope.gain.cancelScheduledValues(now);
        s.envelope.gain.setValueAtTime(Math.max(0.001, s.envelope.gain.value), now);
        s.envelope.gain.linearRampToValueAtTime(vol, now + remaining);
      }
    });
  }

  // ═══════════════════════════════════════════
  // STROKE POOL — max 16, oldest evicted, soft ducking >12
  // ═══════════════════════════════════════════
  private evictOldest(): string | null {
    if (this.strokePool.length < this.MAX_STROKES) return null;
    const oldest = this.strokePool[0];
    if (!oldest) return null;
    this.removeStroke(oldest.id);
    return oldest.id;
  }

  // Soft ducking: when >12 voices active, proportionally reduce all voice gains
  private applyVoiceDucking() {
    if (!this.ctx) return;
    const count = this.strokePool.length;
    const now = this.ctx.currentTime;
    const duckGain = count <= 12 ? 1 : Math.max(0.5, 1 - (count - 12) * 0.125);
    this.strokePool.forEach(s => {
      if (!s.muted) {
        if (s.workletNode) {
          s.workletNode.port.postMessage({ type: 'setDuck', gain: duckGain });
        } else {
          s.flavorGain.gain.setTargetAtTime(duckGain, now, 0.05);
        }
      }
    });
  }

  private removeStroke(id: string) {
    const s = this.activeSounds.get(id);
    if (!s || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (s.loopTimeout) clearTimeout(s.loopTimeout);
    if (s.cleanupTimeout) clearTimeout(s.cleanupTimeout);
    if (s.pulseInterval) clearInterval(s.pulseInterval);
    if (s.deepRumbleInterval) clearTimeout(s.deepRumbleInterval);

    // ── WORKLET PATH: immediate cleanup ──
    if (s.workletNode) {
      s.workletNode.port.postMessage({ type: 'kill' });
      setTimeout(() => {
        try { s.workletNode?.disconnect(); } catch (_) {}
        this.activeSounds.delete(id);
        const idx = this.strokePool.findIndex(x => x.id === id);
        if (idx >= 0) this.strokePool.splice(idx, 1);
        this.applyVoiceDucking();
        this.checkResonance();
      }, 50);
      return;
    }

    // ── FALLBACK: native node cleanup ──
    // Quick fade out
    s.envelope.gain.cancelScheduledValues(now);
    s.envelope.gain.setValueAtTime(s.envelope.gain.value, now);
    s.envelope.gain.linearRampToValueAtTime(0, now + 0.1);
    // After 100ms: stop, disconnect, null
    setTimeout(() => {
      s.allNodes.forEach(n => {
        try { if ('stop' in n && typeof (n as any).stop === 'function') (n as any).stop(); } catch (_) {}
        try { n.disconnect(); } catch (_) {}
      });
      try { s.panner?.disconnect(); } catch (_) {}
      try { s.flavorGain.disconnect(); } catch (_) {}
      try { s.envelope.disconnect(); } catch (_) {}
      this.activeSounds.delete(id);
      const idx = this.strokePool.findIndex(x => x.id === id);
      if (idx >= 0) this.strokePool.splice(idx, 1);
      this.applyVoiceDucking();
      this.checkResonance();
    }, 110);
  }

  // ═════════════════════���═════════════════════
  // PLAY STROKE
  // ═══════════════════════════════════════════
  playStroke(stroke: StrokeData, id: string, locked: boolean, quantizedFrequency?: number): string | null {
    if (!this.ctx || !this.masterBus) return null;

    // Hard gate: if flavor fader is at zero or bus is disconnected, skip all audio
    if (this.flavorVolumes[stroke.flavor] === 0 || this.disconnectedBuses.has(stroke.flavor)) return null;

    // Evict oldest if at limit
    const evictedId = this.evictOldest();

    const c = this.ctx;
    const now = c.currentTime;
    const freq = quantizedFrequency || this.mapYToFreq(stroke.avgY);
    const isDrone = this.droneMode;

    // ── TRY AUDIOWORKLET PATH ──
    const vol = this.mapSpeedToVol(stroke.speed);
    const avgX = stroke.points.reduce((s, p) => s + p.x, 0) / stroke.points.length;
    const pan = (avgX / window.innerWidth) * 2 - 1;

    const workletNode = this.createWorkletVoice(stroke.flavor, freq, vol, pan, {
      isDrone,
      attack: AudioEngine.mapAttackSec(this.mod.envAttack),
      release: AudioEngine.mapReleaseSec(this.mod.envRelease),
      yPosition: stroke.avgY,
      grainSize: this.mod.grainSize,
      grainScatter: this.mod.grainScatter,
      grainPitchSpread: this.mod.grainPitchSpread,
    });

    if (workletNode) {
      const dur = isDrone ? 86400 : (locked ? (60 / this.mod.tempo) * 4 : this.mapLengthToDur(stroke.length));

      // Connect: workletNode → flavorBusGain → [clipper] → limiter → masterBus
      const flavorBus = this.flavorBusGains[stroke.flavor];
      if (flavorBus && !this.disconnectedBuses.has(stroke.flavor)) {
        flavorBus.gain.cancelScheduledValues(now);
        flavorBus.gain.setValueAtTime(this.flavorVolumes[stroke.flavor], now);
      }
      workletNode.connect(flavorBus || this.masterBus);

      // Dummy nodes for compatibility
      const dummyEnvelope = c.createGain();
      dummyEnvelope.gain.value = 0;
      const dummyFlavorGain = c.createGain();
      dummyFlavorGain.gain.value = 1;

      const sound: ActiveSound = {
        id, envelope: dummyEnvelope, flavorGain: dummyFlavorGain,
        oscillators: [], allNodes: [workletNode], startTime: now, duration: dur,
        locked, flavor: stroke.flavor, baseFrequency: freq,
        muted: false, harmonicOscs: [], strokeData: stroke,
        quantizedFreq: quantizedFrequency,
        isDrone, targetVol: vol, yPosition: stroke.avgY,
        workletNode,
      };

      workletNode.port.onmessage = (e) => {
        if (e.data.type === 'done') this.removeStroke(id);
      };

      // Handle drone/pulse/gate modes
      if (isDrone) {
        workletNode.port.postMessage({ type: 'freezeEnvelope' });
      } else if (this.playMode === 'pulse') {
        const beatDur = 60 / this.mod.tempo;
        workletNode.port.postMessage({
          type: 'startPulse', beatDur,
          pulseLength: this.mod.pulseLength,
          attack: AudioEngine.mapAttackSec(this.mod.envAttack),
          release: AudioEngine.mapReleaseSec(this.mod.envRelease),
          vol,
        });
      } else if (!locked) {
        // Gate unlocked: schedule release
        const { release } = this.getEnvParams(stroke.flavor);
        const total = dur * this.mod.drift;
        workletNode.port.postMessage({ type: 'startRelease', releaseTime: release });
        sound.cleanupTimeout = setTimeout(() => this.removeStroke(id), total * 1000 + 200);
      } else {
        // Gate locked: schedule loop
        sound.loopTimeout = setTimeout(() => {
          const ss = this.activeSounds.get(id);
          if (ss?.locked && this.ctx) {
            this.removeStroke(id);
            this.playStroke(stroke, id + '_loop', true, quantizedFrequency);
          }
        }, dur * 1000);
      }

      this.activeSounds.set(id, sound);
      this.strokePool.push(sound);
      this.applyVoiceDucking();
      this.checkResonance();

      // Connect LFOs (PITCH target)
      [this.lfo1Gain, this.lfo2Gain].forEach((lg, i) => {
        const target = i === 0 ? this.mod.lfo1Target : this.mod.lfo2Target;
        const depth = i === 0 ? this.mod.lfo1Depth : this.mod.lfo2Depth;
        if (!lg || depth <= 0 || target !== 'PITCH') return;
        // LFOs can't directly connect to worklet params, but drift is built into the worklet
      });

      return evictedId;
    }

    // ── FALLBACK: native Web Audio nodes (original code) ──

    // TEMPO only affects GATE-locked strokes. Drone mode: TEMPO has zero effect.
    const dur = isDrone ? 86400 : (locked ? (60 / this.mod.tempo) * 4 : this.mapLengthToDur(stroke.length));
    // vol, avgX, pan already computed above
    // Drone: oscillators never scheduled to stop. Gate: finite endTime.
    const endTime = isDrone ? now + 86400 : (locked ? now + dur : now + dur * this.mod.drift);

    const envelope = c.createGain();
    const flavorGain = c.createGain();
    flavorGain.gain.value = 1; // ducking/mute only — fader value lives in flavorBusGains
    const oscillators: OscillatorNode[] = [];
    const allNodes: AudioNode[] = [envelope, flavorGain];
    const harmonicOscs: OscillatorNode[] = [];
    let noiseDeepRumbleInterval: ReturnType<typeof setInterval> | undefined;

    const panner = c.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    allNodes.push(panner);

    // ── FLAVOR SOURCE ──
    // Drone mode: no .stop() calls — oscillators run until explicit removeStroke
    switch (stroke.flavor) {
      case 'sine': {
        const osc = c.createOscillator();
        osc.type = 'sine'; osc.frequency.setValueAtTime(freq, now);
        // Presence EQ: peaking at 2kHz +3dB to compensate for lack of harmonics
        const sinePeak = c.createBiquadFilter();
        sinePeak.type = 'peaking'; sinePeak.frequency.value = 2000; sinePeak.gain.value = 3; sinePeak.Q.value = 0.8;
        osc.connect(sinePeak); sinePeak.connect(envelope); osc.start(now);
        if (!isDrone) osc.stop(endTime + 1);
        oscillators.push(osc); allNodes.push(osc, sinePeak);
        break;
      }
      case 'saw': {
        const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(freq, now);
        const osc2 = c.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.setValueAtTime(freq * 1.004, now);
        const mix = c.createGain(); mix.gain.value = 0.10; // was 0.5→0.18→0.10 — two saws summed need heavy attenuation
        osc.connect(mix); osc2.connect(mix); mix.connect(envelope);
        osc.start(now); osc2.start(now);
        if (!isDrone) { osc.stop(endTime + 1); osc2.stop(endTime + 1); }
        oscillators.push(osc); harmonicOscs.push(osc2); allNodes.push(osc, osc2, mix);
        break;
      }
      case 'sub': {
        const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(freq * 0.5, now);
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 30; hp.Q.value = 0.7;
        // Low shelf boost: +4dB below 200Hz to compensate for Fletcher-Munson equal loudness curves
        const subShelf = c.createBiquadFilter();
        subShelf.type = 'lowshelf'; subShelf.frequency.value = 200; subShelf.gain.value = 4;
        osc.connect(hp); hp.connect(subShelf); subShelf.connect(envelope);
        osc.start(now);
        if (!isDrone) osc.stop(endTime + 1);
        oscillators.push(osc); allNodes.push(osc, hp, subShelf);
        break;
      }
      case 'grain': {
        if (isDrone) {
          // Drone grain: continuous granular texture via looping noise + bandpass
          const bufLen = c.sampleRate * 4;
          const buf = c.createBuffer(1, bufLen, c.sampleRate);
          const data = buf.getChannelData(0);
          const gDur = this.mod.grainSize / 1000;
          const cycleLen = Math.max(1, Math.floor(gDur * c.sampleRate));
          for (let i = 0; i < bufLen; i++) {
            const pos = i % cycleLen;
            const env = pos < cycleLen * 0.3 ? pos / (cycleLen * 0.3) :
                        pos > cycleLen * 0.7 ? (cycleLen - pos) / (cycleLen * 0.3) : 1;
            data[i] = (Math.random() * 2 - 1) * env * 0.5;
          }
          const ns = createBufferSource(c, buf);
          if (!ns) break;
          ns.loop = true;
          ns.playbackRate.value = freq / 440;
          const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 2;
          ns.connect(bp); bp.connect(envelope); ns.start(now);
          allNodes.push(ns, bp);
        } else {
          const { grainSize, grainScatter: scatter, grainDensity: density, grainPitchSpread: pSpread } = this.mod;
          const count = Math.min(Math.floor(dur * density), 100);
          const gDur = grainSize / 1000;
          const grainAmp = Math.min(0.3, 2.5 / Math.max(1, density)) * 1.3; // 1.3x boost to compensate grain windowing losses
          for (let i = 0; i < count; i++) {
            const gStart = now + (dur / count) * i + (Math.random() - 0.5) * scatter * (dur / count);
            const gFreq = freq * Math.pow(2, (Math.random() - 0.5) * pSpread / 12);
            const osc = c.createOscillator();
            osc.type = i % 3 === 0 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(gFreq, gStart);
            const env = c.createGain();
            env.gain.setValueAtTime(0, gStart);
            env.gain.linearRampToValueAtTime(grainAmp, gStart + gDur * 0.4);
            env.gain.linearRampToValueAtTime(grainAmp * 0.5, gStart + gDur * 0.7);
            env.gain.exponentialRampToValueAtTime(0.001, gStart + gDur);
            osc.connect(env); env.connect(envelope);
            osc.start(gStart); osc.stop(gStart + gDur);
            allNodes.push(osc, env);
          }
        }
        break;
      }
      case 'noise': {
        // ═══ OCEAN WAVE TEXTURE GENERATOR ═══
        // Three layers: wave surge + surface texture + deep rumble
        // Y position controls layer mix (top=surface, mid=balanced, bottom=rumble)
        const yNorm = stroke.avgY / window.innerHeight; // 0=top, 1=bottom
        const noiseMul = 2.5; // +8dB boost for ocean presence
        const l1Base = 0.45 * noiseMul; // wave surge base
        const l2Gain = (0.25 + (1 - yNorm) * 0.35) * noiseMul; // surface: louder at top
        const l3Gain = (0.15 + yNorm * 0.25) * noiseMul;        // rumble: louder at bottom

        // Summing node for all three layers
        const oceanMix = c.createGain();
        oceanMix.gain.value = 1.0;
        oceanMix.connect(envelope);
        allNodes.push(oceanMix);

        // ── Generate pink noise buffer (shared) ──
        const pinkLen = c.sampleRate * 10;
        const pinkBuf = c.createBuffer(1, pinkLen, c.sampleRate);
        const pinkData = pinkBuf.getChannelData(0);
        let pb0=0,pb1=0,pb2=0,pb3=0,pb4=0,pb5=0,pb6=0;
        for (let i = 0; i < pinkLen; i++) {
          const w = Math.random()*2-1;
          pb0=.99886*pb0+w*.0555179; pb1=.99332*pb1+w*.0750759; pb2=.96900*pb2+w*.1538520;
          pb3=.86650*pb3+w*.3104856; pb4=.55000*pb4+w*.5329522; pb5=-.7616*pb5-w*.0168980;
          pinkData[i]=(pb0+pb1+pb2+pb3+pb4+pb5+pb6+w*.5362)*.11; pb6=w*.115926;
        }
        // ── Generate white noise buffer ──
        const whiteLen = c.sampleRate * 10;
        const whiteBuf = c.createBuffer(1, whiteLen, c.sampleRate);
        const whiteData = whiteBuf.getChannelData(0);
        for (let i = 0; i < whiteLen; i++) whiteData[i] = Math.random() * 2 - 1;

        // ── LAYER 1: Wave Surge ──
        // Pink noise → LP 400Hz Q=1.8 → surge gain (LFO modulated)
        const surge = createBufferSource(c, pinkBuf);
        if (!surge) break;
        surge.loop = true; surge.start(now);
        const surgeLP = c.createBiquadFilter();
        surgeLP.type = 'lowpass'; surgeLP.frequency.value = 400; surgeLP.Q.value = 1.8;
        const surgeGain = c.createGain();
        surgeGain.gain.value = l1Base;
        // Asymmetric wave surge LFO via ScriptProcessor-free approach:
        // Use sine LFO at 0.12Hz modulating gain
        const surgeLfo = c.createOscillator();
        surgeLfo.type = 'sine'; surgeLfo.frequency.value = 0.12;
        const surgeLfoGain = c.createGain();
        surgeLfoGain.gain.value = l1Base * 0.6; // ±60% amplitude variation
        surgeLfo.connect(surgeLfoGain);
        surgeLfoGain.connect(surgeGain.gain);
        surgeLfo.start(now);
        if (!isDrone) { surge.stop(endTime + 1); surgeLfo.stop(endTime + 1); }
        surge.connect(surgeLP); surgeLP.connect(surgeGain); surgeGain.connect(oceanMix);
        allNodes.push(surge, surgeLP, surgeGain, surgeLfo, surgeLfoGain);

        // ── LAYER 2: Surface Texture ──
        // White noise → BP 1200Hz Q=0.6 → surface gain (faster LFO)
        const surface = createBufferSource(c, whiteBuf);
        if (!surface) break;
        surface.loop = true; surface.start(now);
        const surfaceBP = c.createBiquadFilter();
        surfaceBP.type = 'bandpass'; surfaceBP.frequency.value = 1200; surfaceBP.Q.value = 0.6;
        const surfaceGain = c.createGain();
        surfaceGain.gain.value = l2Gain;
        const surfaceLfo = c.createOscillator();
        surfaceLfo.type = 'sine'; surfaceLfo.frequency.value = 0.7;
        const surfaceLfoGain = c.createGain();
        surfaceLfoGain.gain.value = l2Gain * 0.4; // 40% depth
        surfaceLfo.connect(surfaceLfoGain);
        surfaceLfoGain.connect(surfaceGain.gain);
        surfaceLfo.start(now);
        if (!isDrone) { surface.stop(endTime + 1); surfaceLfo.stop(endTime + 1); }
        surface.connect(surfaceBP); surfaceBP.connect(surfaceGain); surfaceGain.connect(oceanMix);
        allNodes.push(surface, surfaceBP, surfaceGain, surfaceLfo, surfaceLfoGain);

        // ── LAYER 3: Deep Rumble ──
        // Pink noise → LP 80Hz → rumble gain (random setTargetAtTime)
        const rumble = createBufferSource(c, pinkBuf);
        if (!rumble) break;
        rumble.loop = true;
        rumble.playbackRate.value = 0.5; // slower playback for deeper content
        rumble.start(now);
        const rumbleLP = c.createBiquadFilter();
        rumbleLP.type = 'lowpass'; rumbleLP.frequency.value = 80; rumbleLP.Q.value = 0.7;
        const rumbleGain = c.createGain();
        rumbleGain.gain.value = l3Gain;
        if (!isDrone) rumble.stop(endTime + 1);
        rumble.connect(rumbleLP); rumbleLP.connect(rumbleGain); rumbleGain.connect(oceanMix);
        allNodes.push(rumble, rumbleLP, rumbleGain);

        // Deep rumble random amplitude variation (setTargetAtTime every 4-9s)
        const scheduleRumbleVar = () => {
          if (!this.ctx) return;
          const targetVal = l3Gain * (0.4 + Math.random() * 0.6);
          const rampTime = 1.5 + Math.random() * 2;
          try { rumbleGain.gain.setTargetAtTime(targetVal, this.ctx.currentTime, rampTime); } catch (_) {}
        };
        scheduleRumbleVar();
        // Use recursive setTimeout for truly irregular intervals (4-9s)
        const scheduleNext = () => {
          noiseDeepRumbleInterval = setTimeout(() => {
            if (!this.activeSounds.has(id)) return;
            scheduleRumbleVar();
            scheduleNext();
          }, 4000 + Math.random() * 5000) as unknown as ReturnType<typeof setInterval>;
        };
        scheduleNext();

        break;
      }
      case 'metal': {
        const carrier = c.createOscillator(); const mod = c.createOscillator(); const modG = c.createGain();
        carrier.type = 'sine'; mod.type = 'sine';
        carrier.frequency.setValueAtTime(freq, now); mod.frequency.setValueAtTime(freq * 3.73, now); // bell-like ratio
        modG.gain.setValueAtTime(freq * 0.4, now); // was freq*3→0.8→0.4 — minimal modulation index, very contained FM energy
        mod.connect(modG); modG.connect(carrier.frequency);
        const clamp = c.createWaveShaper();
        const clampCurve = new Float32Array(256);
        for (let i = 0; i < 256; i++) { const x = i/128-1; clampCurve[i] = Math.tanh(x * 1.2); }
        clamp.curve = clampCurve;
        carrier.connect(clamp); clamp.connect(envelope);
        mod.start(now); carrier.start(now);
        if (!isDrone) { mod.stop(endTime + 1); carrier.stop(endTime + 1); }
        oscillators.push(carrier, mod); allNodes.push(carrier, mod, modG, clamp);
        break;
      }
      case 'flutter': {
        const osc = c.createOscillator(); osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, now);
        const wowLfo = c.createOscillator(); wowLfo.type = 'sine'; wowLfo.frequency.value = 0.2;
        const wowG = c.createGain(); wowG.gain.value = 20;
        wowLfo.connect(wowG); wowG.connect(osc.detune);
        const flutLfo = c.createOscillator(); flutLfo.type = 'sine'; flutLfo.frequency.value = 6;
        const flutG = c.createGain(); flutG.gain.value = 5;
        flutLfo.connect(flutG); flutG.connect(osc.detune);
        const sat = c.createWaveShaper();
        const satCurve = new Float32Array(256);
        for (let i = 0; i < 256; i++) { const x = i/128-1; satCurve[i] = Math.tanh(x * 1.5); }
        sat.curve = satCurve;
        osc.connect(sat); sat.connect(envelope);
        osc.start(now); wowLfo.start(now); flutLfo.start(now);
        if (!isDrone) { osc.stop(endTime + 1); wowLfo.stop(endTime + 1); flutLfo.stop(endTime + 1); }
        oscillators.push(osc); allNodes.push(osc, wowLfo, wowG, flutLfo, flutG, sat);
        break;
      }
      case 'crystal': {
        const hRatios = [1, 2, 3, 4.02, 5.98, 8.01];
        const hAmps = [1, 0.5, 0.3, 0.15, 0.1, 0.07];
        const hDecay = [1, 1.3, 1.8, 2.5, 3.0, 4.0];
        for (let h = 0; h < hRatios.length; h++) {
          const osc = c.createOscillator(); osc.type = 'sine';
          osc.frequency.setValueAtTime(freq * hRatios[h], now);
          const hG = c.createGain(); const amp = vol * hAmps[h];
          if (isDrone) {
            // Drone crystal: flat gain per harmonic, no decay
            hG.gain.setValueAtTime(amp, now);
          } else {
            hG.gain.setValueAtTime(0, now);
            hG.gain.linearRampToValueAtTime(amp, now + 0.05);
            const hDur = dur / hDecay[h];
            if (hDur > 0.1) { hG.gain.setValueAtTime(amp * 0.8, now + 0.1); hG.gain.exponentialRampToValueAtTime(0.001, now + hDur); }
          }
          const shim = c.createOscillator(); shim.type = 'sine'; shim.frequency.value = 0.5 + Math.random() * 2;
          const shimG = c.createGain(); shimG.gain.value = 3 + h * 2;
          shim.connect(shimG); shimG.connect(osc.detune);
          osc.connect(hG); hG.connect(envelope);
          osc.start(now); shim.start(now);
          if (!isDrone) { osc.stop(endTime + 1); shim.stop(endTime + 1); }
          if (h === 0) oscillators.push(osc); else harmonicOscs.push(osc);
          allNodes.push(osc, hG, shim, shimG);
        }
        break;
      }
    }

    // Harmonic layering — not for noise/grain/crystal
    // Saw octave harmonic uses sine (not sawtooth) to contain energy; gain reduced
    if (!['noise', 'grain', 'crystal'].includes(stroke.flavor)) {
      const octOsc = c.createOscillator();
      octOsc.type = 'sine'; // always sine — sawtooth octave was adding huge energy for saw
      octOsc.frequency.setValueAtTime(freq * 2, now);
      const octG = c.createGain(); octG.gain.value = stroke.flavor === 'saw' ? 0.05 : 0.35;
      octOsc.connect(octG); octG.connect(envelope);
      octOsc.start(now);
      if (!isDrone) octOsc.stop(endTime + 1);
      harmonicOscs.push(octOsc); allNodes.push(octOsc, octG);
      const fifthOsc = c.createOscillator(); fifthOsc.type = 'sine';
      fifthOsc.frequency.setValueAtTime(freq * Math.pow(2, 7/12), now);
      const fifthG = c.createGain(); fifthG.gain.value = stroke.flavor === 'saw' ? 0.03 : 0.08; // saw gets minimal fifth
      fifthOsc.connect(fifthG); fifthG.connect(envelope);
      fifthOsc.start(now);
      if (!isDrone) fifthOsc.stop(endTime + 1);
      harmonicOscs.push(fifthOsc); allNodes.push(fifthOsc, fifthG);
    }

    // ── ENVELOPE ──
    if (isDrone) {
      // DRONE: uses attack from envelope knob, then holds indefinitely.
      // No release scheduling — release only happens on explicit removal.
      const droneAtk = AudioEngine.mapAttackSec(this.mod.envAttack);
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(vol, now + Math.max(0.01, droneAtk));
    } else if (locked) {
      // GATE locked: tempo-quantized loop with attack/release envelope
      const { attack, release, sustain } = this.getEnvParams(stroke.flavor);
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(vol, now + attack);
      envelope.gain.setValueAtTime(vol * sustain, now + attack + 0.05);
      envelope.gain.setValueAtTime(vol * sustain, now + dur - release);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + dur);
    } else {
      // GATE unlocked: natural attack + drift fade
      const { attack, release, sustain } = this.getEnvParams(stroke.flavor);
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(vol, now + attack);
      const total = dur * this.mod.drift;
      const susEnd = now + total - release;
      if (susEnd > now + attack) {
        envelope.gain.setValueAtTime(vol * sustain, now + attack + 0.05);
        envelope.gain.setValueAtTime(vol * sustain * 0.6, susEnd);
      }
      envelope.gain.exponentialRampToValueAtTime(0.001, now + total);
    }

    // Anchor fader value on the AudioContext timeline before connecting sources
    const flavorBus = this.flavorBusGains[stroke.flavor];
    if (flavorBus && !this.disconnectedBuses.has(stroke.flavor)) {
      flavorBus.gain.cancelScheduledValues(now);
      flavorBus.gain.setValueAtTime(this.flavorVolumes[stroke.flavor], now);
    }

    // Connect: envelope → sourceAmpGain → flavorGain(duck/mute) → panner → flavorBusGain(fader) → [limiter] → masterBus
    const sourceAmpGain = c.createGain();
    sourceAmpGain.gain.value = FLAVOR_SOURCE_AMPLITUDE[stroke.flavor];
    envelope.connect(sourceAmpGain);
    sourceAmpGain.connect(flavorGain);
    flavorGain.connect(panner);
    panner.connect(flavorBus || this.masterBus);
    allNodes.push(sourceAmpGain);

    // Pitch drift
    let driftLfo: OscillatorNode | undefined;
    if (isDrone || locked || dur > 3) {
      driftLfo = c.createOscillator(); driftLfo.type = 'sine';
      driftLfo.frequency.value = 0.05 + Math.random() * 0.1;
      const dg = c.createGain(); dg.gain.value = 8;
      driftLfo.connect(dg);
      [...oscillators, ...harmonicOscs].forEach(o => { try { dg.connect(o.detune); } catch (_) {} });
      driftLfo.start(now);
      if (!isDrone) driftLfo.stop(endTime + 1);
      allNodes.push(driftLfo, dg);
    }

    // Connect LFOs (PITCH target)
    [this.lfo1Gain, this.lfo2Gain].forEach((lg, i) => {
      const target = i === 0 ? this.mod.lfo1Target : this.mod.lfo2Target;
      const depth = i === 0 ? this.mod.lfo1Depth : this.mod.lfo2Depth;
      if (!lg || depth <= 0 || target !== 'PITCH') return;
      oscillators.forEach(o => { try { lg.connect(o.detune); } catch (_) {} });
      harmonicOscs.forEach(o => { try { lg.connect(o.detune); } catch (_) {} });
    });

    // Store
    const sound: ActiveSound = {
      id, envelope, flavorGain, oscillators, allNodes, startTime: now, duration: dur,
      locked, flavor: stroke.flavor, baseFrequency: freq, muted: false,
      panner, driftLfo, harmonicOscs, strokeData: stroke, quantizedFreq: quantizedFrequency,
      deepRumbleInterval: noiseDeepRumbleInterval,
      isDrone, targetVol: vol,
      yPosition: stroke.avgY,
    };
    this.activeSounds.set(id, sound);
    this.strokePool.push(sound);
    this.applyVoiceDucking();

    // ── SCHEDULE CLEANUP ──
    // DRONE: no cleanup, no loop timer. Stroke lives until explicit removal
    // (clear, drone→gate switch, or pool eviction).
    if (isDrone) {
      // Nothing. Intentionally empty.
    } else if (locked) {
      sound.loopTimeout = setTimeout(() => {
        const s = this.activeSounds.get(id);
        if (s?.locked && this.ctx) {
          this.removeStroke(id);
          this.playStroke(stroke, id + '_loop', true, quantizedFrequency);
        }
      }, dur * 1000);
    } else {
      const totalMs = dur * this.mod.drift * 1000 + 200;
      sound.cleanupTimeout = setTimeout(() => this.removeStroke(id), totalMs);
    }

    this.checkResonance();
    return evictedId;
  }

  // Release single stroke
  releaseStroke(id: string, fadeDuration?: number) {
    const s = this.activeSounds.get(id);
    if (!s || !this.ctx) return;
    s.locked = false;
    s.isReleasing = true;
    if (s.loopTimeout) clearTimeout(s.loopTimeout);
    if (s.pulseInterval) { clearInterval(s.pulseInterval); s.pulseInterval = undefined; }
    const fade = fadeDuration ?? AudioEngine.mapReleaseSec(this.mod.envRelease);

    if (s.workletNode) {
      s.workletNode.port.postMessage({ type: 'startRelease', releaseTime: fade });
      s.cleanupTimeout = setTimeout(() => this.removeStroke(id), fade * 1000 + 500);
      return;
    }

    const now = this.ctx.currentTime;
    s.envelope.gain.cancelScheduledValues(now);
    s.envelope.gain.setValueAtTime(s.envelope.gain.value, now);
    s.envelope.gain.linearRampToValueAtTime(0, now + fade);
    s.cleanupTimeout = setTimeout(() => this.removeStroke(id), fade * 1000 + 200);
  }

  // Release ALL locked strokes
  releaseAllLocked(): string[] {
    const released: string[] = [];
    const driftDur = (60 / this.mod.tempo) * 2 * this.mod.drift;
    this.strokePool.forEach(s => {
      if (s.locked) {
        this.releaseStroke(s.id, driftDur);
        released.push(s.id);
      }
    });
    return released;
  }

  clearAll() {
    // Remove all strokes
    const ids = this.strokePool.map(s => s.id);
    ids.forEach(id => this.removeStroke(id));
    this.checkResonance();
  }

  toggleMute(id: string) {
    const s = this.activeSounds.get(id);
    if (s && this.ctx) {
      s.muted = !s.muted;
      if (s.workletNode) {
        s.workletNode.port.postMessage({ type: 'setDuck', gain: s.muted ? 0.02 : 1 });
      } else {
        const now = this.ctx.currentTime;
        s.flavorGain.gain.cancelScheduledValues(now);
        s.flavorGain.gain.setValueAtTime(s.flavorGain.gain.value, now);
        s.flavorGain.gain.linearRampToValueAtTime(s.muted ? 0.02 : 1, now + 0.1);
      }
    }
  }

  // Resonance pad
  private checkResonance() {
    if (!this.ctx || !this.resonancePadGain || !this.masterBus) return;
    const lc = this.getLockedCount();
    const now = this.ctx.currentTime;
    if (lc >= 3 && !this.resonanceActive) {
      this.resonanceActive = true;
      this.resonancePad = this.ctx.createOscillator();
      this.resonancePad.type = 'sine'; this.resonancePad.frequency.value = this.rootFrequency;
      const pf = this.ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 400; pf.Q.value = 0.5;
      this.resonancePad.connect(pf); pf.connect(this.resonancePadGain);
      this.resonancePadGain.gain.setTargetAtTime(0.04, now, 1.0);
      this.resonancePad.start(now);
    } else if (lc < 3 && this.resonanceActive) {
      this.resonanceActive = false;
      this.resonancePadGain.gain.setTargetAtTime(0, now, 0.5);
      const pad = this.resonancePad;
      setTimeout(() => { try { pad?.stop(); } catch (_) {} this.resonancePad = null; }, 2000);
    }
  }

  // ═══════════════════════════════════════════
  // AUDIOWORKLET VOICE CREATION
  // ═══════════════════════════════════════════
  private createWorkletVoice(
    flavor: SoundFlavor, freq: number, vol: number, pan: number,
    opts: {
      isDrone?: boolean; attack?: number; release?: number;
      yPosition?: number; filterCutoff?: number;
      grainSize?: number; grainScatter?: number; grainPitchSpread?: number;
    } = {}
  ): AudioWorkletNode | null {
    if (!this.ctx || !this.workletReady) return null;
    try {
      const node = new AudioWorkletNode(this.ctx, 'synth-voice', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          flavor,
          freq,
          vol,
          pan,
          sourceAmp: FLAVOR_SOURCE_AMPLITUDE[flavor],
          isDrone: opts.isDrone || false,
          attack: opts.attack ?? AudioEngine.mapAttackSec(this.mod.envAttack),
          release: opts.release ?? AudioEngine.mapReleaseSec(this.mod.envRelease),
          sustain: 0.8,
          filterCutoff: opts.filterCutoff ?? 8000,
          yPosition: opts.yPosition != null ? opts.yPosition / window.innerHeight : 0.5,
          grainSize: opts.grainSize ?? this.mod.grainSize,
          grainScatter: opts.grainScatter ?? this.mod.grainScatter,
          grainPitchSpread: opts.grainPitchSpread ?? this.mod.grainPitchSpread,
        },
      });
      return node;
    } catch (e) {
      console.warn('[FORMLESS] Failed to create worklet voice', e);
      return null;
    }
  }

  private getEnvParams(_f: SoundFlavor) {
    // Attack and release are now user-controllable via knobs
    const attack = AudioEngine.mapAttackSec(this.mod.envAttack);
    const release = AudioEngine.mapReleaseSec(this.mod.envRelease);
    return { attack, release, sustain: 0.8 };
  }

  private mapYToFreq(y: number) {
    // Use scale table if available
    if (this.scaleTable.length > 0) {
      const h = window.innerHeight;
      const normalized = 1 - (y / h); // 0=bottom(low), 1=top(high)
      const index = Math.round(normalized * (this.scaleTable.length - 1));
      const clamped = Math.max(0, Math.min(this.scaleTable.length - 1, index));
      return this.scaleTable[clamped].freq;
    }
    return 55 * Math.pow(880/55, 1 - y/window.innerHeight);
  }
  private mapLengthToDur(l: number) { return 4 + Math.min(l/800, 1) * 4; }
  private mapSpeedToVol(s: number) { return 0.12 + Math.min(s/15, 1) * 0.25; }

  // ══════════════════════���════════════════════
  // LIVE STROKE — real-time sound during drawing gesture
  // ═══════════════════════════════════════════
  startLiveStroke(id: string, freq: number, flavor: SoundFlavor, panX: number, yPosition?: number): string | null {
    if (!this.ctx || !this.masterBus) return null;

    // Hard gate: if flavor fader is at zero or bus is disconnected, skip all audio
    if (this.flavorVolumes[flavor] === 0 || this.disconnectedBuses.has(flavor)) return null;

    const evictedId = this.evictOldest();
    const c = this.ctx;
    const now = c.currentTime;
    const vol = 0.15;
    const pan = Math.max(-1, Math.min(1, panX * 2 - 1));

    // ── TRY AUDIOWORKLET PATH ──
    const workletNode = this.createWorkletVoice(flavor, freq, vol, pan, {
      isDrone: this.playMode === 'drone',
      yPosition,
      filterCutoff: 2000, // start with warm filter for live stroke
    });

    if (workletNode) {
      // Worklet path: minimal native node overhead
      // Chain: workletNode → flavorBusGain → [clipper] → limiter → masterBus
      const flavorBus = this.flavorBusGains[flavor];
      if (flavorBus && !this.disconnectedBuses.has(flavor)) {
        flavorBus.gain.cancelScheduledValues(now);
        flavorBus.gain.setValueAtTime(this.flavorVolumes[flavor], now);
      }
      workletNode.connect(flavorBus || this.masterBus);

      // Dummy nodes for compatibility with existing cleanup code
      const dummyEnvelope = c.createGain();
      dummyEnvelope.gain.value = 0; // not used in worklet path
      const dummyFlavorGain = c.createGain();
      dummyFlavorGain.gain.value = 1;

      const sound: ActiveSound = {
        id, envelope: dummyEnvelope, flavorGain: dummyFlavorGain,
        oscillators: [], allNodes: [workletNode], startTime: now,
        duration: 86400, locked: false, flavor, baseFrequency: freq,
        muted: false, harmonicOscs: [],
        isLive: true, accumulatedLength: 0,
        isDrone: this.playMode === 'drone', targetVol: vol,
        yPosition, workletNode,
      };

      // Listen for 'done' from worklet
      workletNode.port.onmessage = (e) => {
        if (e.data.type === 'done') {
          this.removeStroke(id);
        }
      };

      this.activeSounds.set(id, sound);
      this.strokePool.push(sound);
      this.applyVoiceDucking();
      return evictedId;
    }

    // ── FALLBACK: native Web Audio nodes ──
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0, now);
    const liveAttack = AudioEngine.mapAttackSec(this.mod.envAttack);
    envelope.gain.linearRampToValueAtTime(vol, now + liveAttack);

    const flavorGain = c.createGain();
    flavorGain.gain.value = 1;

    const liveFilter = c.createBiquadFilter();
    liveFilter.type = 'lowpass';
    liveFilter.frequency.setValueAtTime(2000, now);
    liveFilter.Q.setValueAtTime(1, now);

    const panner = c.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);

    const oscillators: OscillatorNode[] = [];
    const harmonicOscs: OscillatorNode[] = [];
    const allNodes: AudioNode[] = [envelope, flavorGain, liveFilter, panner];

    if (flavor === 'noise') {
      const pinkLen = c.sampleRate * 4;
      const pinkBuf = c.createBuffer(1, pinkLen, c.sampleRate);
      const pd = pinkBuf.getChannelData(0);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < pinkLen; i++) {
        const w = Math.random()*2-1;
        b0=.99886*b0+w*.0555179; b1=.99332*b1+w*.0750759; b2=.96900*b2+w*.1538520;
        b3=.86650*b3+w*.3104856; b4=.55000*b4+w*.5329522; b5=-.7616*b5-w*.0168980;
        pd[i]=(b0+b1+b2+b3+b4+b5+b6+w*.5362)*.11; b6=w*.115926;
      }
      const wLen = c.sampleRate * 4;
      const wBuf = c.createBuffer(1, wLen, c.sampleRate);
      const wd = wBuf.getChannelData(0);
      for (let i = 0; i < wLen; i++) wd[i] = Math.random() * 2 - 1;
      const surgeNs = createBufferSource(c, pinkBuf);
      const surfNs = createBufferSource(c, wBuf);
      if (surgeNs) {
        surgeNs.loop = true; surgeNs.start(now);
        const surgeLP = c.createBiquadFilter(); surgeLP.type = 'lowpass'; surgeLP.frequency.value = 400; surgeLP.Q.value = 1.8;
        const surgeG = c.createGain(); surgeG.gain.value = 0.4 * 2.5;
        surgeNs.connect(surgeLP); surgeLP.connect(surgeG); surgeG.connect(liveFilter);
        allNodes.push(surgeNs, surgeLP, surgeG);
      }
      if (surfNs) {
        surfNs.loop = true; surfNs.start(now);
        const surfBP = c.createBiquadFilter(); surfBP.type = 'bandpass'; surfBP.frequency.value = 1200; surfBP.Q.value = 0.6;
        const surfG = c.createGain(); surfG.gain.value = 0.3 * 2.5;
        surfNs.connect(surfBP); surfBP.connect(surfG); surfG.connect(liveFilter);
        allNodes.push(surfNs, surfBP, surfG);
      }
    } else {
      const osc = c.createOscillator();
      switch (flavor) {
        case 'sine': osc.type = 'sine'; break;
        case 'saw': osc.type = 'sawtooth'; break;
        case 'sub': osc.type = 'sine'; osc.frequency.setValueAtTime(freq * 0.5, now); break;
        case 'flutter': case 'grain': osc.type = 'triangle'; break;
        case 'metal': osc.type = 'square'; break;
        case 'crystal': osc.type = 'sine'; break;
        default: osc.type = 'sine';
      }
      if (flavor !== 'sub') osc.frequency.setValueAtTime(freq, now);
      let oscOut: AudioNode = osc;
      if (flavor === 'sine') {
        const sinePeak = c.createBiquadFilter();
        sinePeak.type = 'peaking'; sinePeak.frequency.value = 2000; sinePeak.gain.value = 3; sinePeak.Q.value = 0.8;
        osc.connect(sinePeak); oscOut = sinePeak; allNodes.push(sinePeak);
      }
      if (flavor === 'sub') {
        const subShelf = c.createBiquadFilter();
        subShelf.type = 'lowshelf'; subShelf.frequency.value = 200; subShelf.gain.value = 4;
        osc.connect(subShelf); oscOut = subShelf; allNodes.push(subShelf);
      }
      if (oscOut === osc) osc.connect(liveFilter); else oscOut.connect(liveFilter);
      osc.start(now);
      oscillators.push(osc);
      allNodes.push(osc);
    }

    const flavorBus = this.flavorBusGains[flavor];
    if (flavorBus && !this.disconnectedBuses.has(flavor)) {
      flavorBus.gain.cancelScheduledValues(now);
      flavorBus.gain.setValueAtTime(this.flavorVolumes[flavor], now);
    }

    const sourceAmpGain = c.createGain();
    sourceAmpGain.gain.value = FLAVOR_SOURCE_AMPLITUDE[flavor];
    liveFilter.connect(envelope);
    envelope.connect(sourceAmpGain);
    sourceAmpGain.connect(flavorGain);
    flavorGain.connect(panner);
    panner.connect(flavorBus || this.masterBus);
    allNodes.push(sourceAmpGain);

    const sound: ActiveSound = {
      id, envelope, flavorGain, oscillators, allNodes, startTime: now,
      duration: 86400, locked: false, flavor, baseFrequency: freq,
      muted: false, panner, harmonicOscs,
      isLive: true, liveFilter, accumulatedLength: 0,
      isDrone: this.playMode === 'drone', targetVol: vol,
      yPosition,
    };
    this.activeSounds.set(id, sound);
    this.strokePool.push(sound);
    this.applyVoiceDucking();
    return evictedId;
  }

  modulateLiveStroke(id: string, params: {
    hVelocity: number;
    accLength: number;
    pointerVelocity: number;
    directionChange: boolean;
    freqTarget?: number;
  }) {
    const s = this.activeSounds.get(id);
    if (!s || !s.isLive || !this.ctx) return;

    // ── WORKLET PATH ──
    if (s.workletNode) {
      const cutoff = 400 + Math.min(params.hVelocity / 800, 1) * 7600;
      const vol = (0.1 + Math.min(params.pointerVelocity / 1200, 1) * 0.25);

      s.workletNode.port.postMessage({ type: 'setFilterCutoff', cutoff });
      s.workletNode.port.postMessage({ type: 'setGain', vol });

      if (s.flavor !== 'noise' && params.directionChange && params.freqTarget) {
        s.workletNode.port.postMessage({ type: 'setFreq', freq: params.freqTarget });
        s.baseFrequency = params.freqTarget;
      }

      // Progressive harmonics via worklet message
      s.accumulatedLength = params.accLength;
      if (s.flavor !== 'noise' && s.flavor !== 'grain') {
        if (params.accLength > 100 && !s.liveOctaveOsc) {
          s.workletNode.port.postMessage({ type: 'addHarmonic', harmonic: 'octave', gain: 0.3 });
          s.liveOctaveOsc = {} as OscillatorNode; // marker
        }
        if (params.accLength > 200 && !s.liveFifthOsc) {
          s.workletNode.port.postMessage({ type: 'addHarmonic', harmonic: 'fifth', gain: 0.2 });
          s.liveFifthOsc = {} as OscillatorNode; // marker
        }
        if (params.accLength > 300 && !s.live2ndOctaveOsc) {
          s.workletNode.port.postMessage({ type: 'addHarmonic', harmonic: '2ndOctave', gain: 0.15 });
          s.live2ndOctaveOsc = {} as OscillatorNode; // marker
        }
      }
      return;
    }

    // ── FALLBACK: native node path ──
    const now = this.ctx.currentTime;

    if (s.liveFilter) {
      const cutoff = 400 + Math.min(params.hVelocity / 800, 1) * 7600;
      s.liveFilter.frequency.setTargetAtTime(cutoff, now, 0.05);
    }

    const vol = (0.1 + Math.min(params.pointerVelocity / 1200, 1) * 0.25);
    s.envelope.gain.setTargetAtTime(vol, now, 0.05);

    if (s.flavor !== 'noise' && params.directionChange && params.freqTarget && s.oscillators.length > 0) {
      s.oscillators.forEach(o => {
        try { o.frequency.setTargetAtTime(params.freqTarget!, now, 0.05); } catch (_) {}
      });
      s.baseFrequency = params.freqTarget;
    }

    s.accumulatedLength = params.accLength;
    if (s.flavor === 'noise') return;
    const c = this.ctx;

    if (params.accLength > 100 && !s.liveOctaveOsc) {
      const oOsc = c.createOscillator(); oOsc.type = 'sine';
      oOsc.frequency.setValueAtTime(s.baseFrequency * 2, now);
      const oGain = c.createGain(); oGain.gain.setValueAtTime(0, now);
      oGain.gain.linearRampToValueAtTime(0.3, now + 0.2);
      oOsc.connect(oGain); oGain.connect(s.liveFilter!);
      oOsc.start(now);
      s.liveOctaveOsc = oOsc; s.liveOctaveGain = oGain;
      s.allNodes.push(oOsc, oGain);
      s.harmonicOscs?.push(oOsc);
    }
    if (params.accLength > 200 && !s.liveFifthOsc) {
      const fOsc = c.createOscillator(); fOsc.type = 'sine';
      fOsc.frequency.setValueAtTime(s.baseFrequency * Math.pow(2, 7 / 12), now);
      const fGain = c.createGain(); fGain.gain.setValueAtTime(0, now);
      fGain.gain.linearRampToValueAtTime(0.2, now + 0.2);
      fOsc.connect(fGain); fGain.connect(s.liveFilter!);
      fOsc.start(now);
      s.liveFifthOsc = fOsc; s.liveFifthGain = fGain;
      s.allNodes.push(fOsc, fGain);
      s.harmonicOscs?.push(fOsc);
    }
    if (params.accLength > 300 && !s.live2ndOctaveOsc) {
      const o2 = c.createOscillator(); o2.type = 'sine';
      o2.frequency.setValueAtTime(s.baseFrequency * 4, now);
      const o2G = c.createGain(); o2G.gain.setValueAtTime(0, now);
      o2G.gain.linearRampToValueAtTime(0.15, now + 0.2);
      o2.connect(o2G); o2G.connect(s.liveFilter!);
      o2.start(now);
      s.live2ndOctaveOsc = o2; s.live2ndOctaveGain = o2G;
      s.allNodes.push(o2, o2G);
      s.harmonicOscs?.push(o2);
    }
  }

  finalizeLiveStroke(id: string, locked: boolean) {
    const s = this.activeSounds.get(id);
    if (!s || !this.ctx) return;
    s.isLive = false;
    const now = this.ctx.currentTime;
    const mode = this.playMode;

    // ── WORKLET PATH ──
    if (s.workletNode) {
      if (mode === 'drone') {
        s.locked = true;
        s.isDrone = true;
        s.workletNode.port.postMessage({ type: 'freezeEnvelope' });
      } else if (mode === 'pulse') {
        s.locked = true;
        const beatDur = 60 / this.mod.tempo;
        s.workletNode.port.postMessage({
          type: 'startPulse',
          beatDur,
          pulseLength: this.mod.pulseLength,
          attack: AudioEngine.mapAttackSec(this.mod.envAttack),
          release: AudioEngine.mapReleaseSec(this.mod.envRelease),
          vol: s.targetVol || 0.15,
        });
      } else if (locked) {
        s.locked = true;
        const dur = (60 / this.mod.tempo) * 4;
        s.duration = dur;
        // Let worklet handle envelope, schedule loop restart from main thread
        const { release } = this.getEnvParams(s.flavor);
        s.workletNode.port.postMessage({
          type: 'startRelease',
          releaseTime: release,
        });
        // Schedule release at end of bar (dur - release)
        s.loopTimeout = setTimeout(() => {
          const ss = this.activeSounds.get(id);
          if (ss?.locked && ss.strokeData && this.ctx) {
            this.removeStroke(id);
            this.playStroke(ss.strokeData, id + '_loop', true, ss.quantizedFreq);
          }
        }, dur * 1000);
      } else {
        // GATE unlocked: fade out via worklet
        const { release } = this.getEnvParams(s.flavor);
        const fadeTime = Math.max(0.5, release * this.mod.drift);
        s.workletNode.port.postMessage({ type: 'startRelease', releaseTime: fadeTime });
        // Worklet will send 'done' message, but add safety cleanup
        s.cleanupTimeout = setTimeout(() => this.removeStroke(id), fadeTime * 1000 + 500);
      }
      return;
    }

    // ── FALLBACK: native node path ──
    if (mode === 'drone') {
      s.locked = true;
      s.isDrone = true;
      const targetVol = s.envelope.gain.value || 0.15;
      s.targetVol = targetVol;
      s.envelope.gain.cancelScheduledValues(now);
      s.envelope.gain.setValueAtTime(targetVol, now);
    } else if (mode === 'pulse') {
      s.locked = true;
      const curVol = s.envelope.gain.value || 0.15;
      this.startPulseEnvelope(s, curVol);
    } else if (locked) {
      s.locked = true;
      const dur = (60 / this.mod.tempo) * 4;
      s.duration = dur;
      const { release, sustain } = this.getEnvParams(s.flavor);
      const curVol = s.envelope.gain.value;
      s.envelope.gain.cancelScheduledValues(now);
      s.envelope.gain.setValueAtTime(curVol, now);
      s.envelope.gain.setValueAtTime(curVol * sustain, now + dur - release);
      s.envelope.gain.exponentialRampToValueAtTime(0.001, now + dur);
      s.loopTimeout = setTimeout(() => {
        const ss = this.activeSounds.get(id);
        if (ss?.locked && ss.strokeData && this.ctx) {
          this.removeStroke(id);
          this.playStroke(ss.strokeData, id + '_loop', true, ss.quantizedFreq);
        }
      }, dur * 1000);
    } else {
      const { release } = this.getEnvParams(s.flavor);
      const fadeTime = Math.max(0.5, release * this.mod.drift);
      const curVol = s.envelope.gain.value;
      s.envelope.gain.cancelScheduledValues(now);
      s.envelope.gain.setValueAtTime(curVol, now);
      s.envelope.gain.exponentialRampToValueAtTime(0.001, now + fadeTime);
      s.cleanupTimeout = setTimeout(() => this.removeStroke(id), fadeTime * 1000 + 200);
    }
  }

  // PULSE envelope: repeating gain on/off at tempo using attack/release knob values
  private startPulseEnvelope(s: ActiveSound, peakVol: number) {
    if (!this.ctx) return;
    if (s.pulseInterval) clearInterval(s.pulseInterval);
    s.targetVol = peakVol;

    const schedulePulse = () => {
      if (!this.ctx || !this.activeSounds.has(s.id)) {
        if (s.pulseInterval) clearInterval(s.pulseInterval);
        return;
      }
      const now = this.ctx.currentTime;
      const beatDur = 60 / this.mod.tempo;
      const onDur = beatDur * this.mod.pulseLength;
      // Use envelope knob values for attack/release, capped to fit within pulse window
      const atkTime = Math.min(AudioEngine.mapAttackSec(this.mod.envAttack), onDur * 0.4);
      const relTime = Math.min(AudioEngine.mapReleaseSec(this.mod.envRelease), onDur * 0.5);
      const holdEnd = Math.max(atkTime, onDur - relTime);

      s.envelope.gain.cancelScheduledValues(now);
      s.envelope.gain.setValueAtTime(0.001, now);
      // Attack ramp
      s.envelope.gain.linearRampToValueAtTime(peakVol, now + atkTime);
      // Hold at peak
      if (holdEnd > atkTime) {
        s.envelope.gain.setValueAtTime(peakVol, now + holdEnd);
      }
      // Release ramp
      s.envelope.gain.linearRampToValueAtTime(0.001, now + onDur);
    };

    // Schedule first pulse immediately
    schedulePulse();
    // Repeat at tempo interval
    const beatMs = (60 / this.mod.tempo) * 1000;
    s.pulseInterval = setInterval(schedulePulse, beatMs);
  }

  // ═══════════════════════════════════════════
  // GRANULAR CLOUD — always-on ambient texture generator
  // ═══════════════════════════════════════════
  getGrainCloudActive() { return this.grainCloudActive; }

  private startGrainCloud() {
    if (!this.ctx || !this.grainCloudGain || this.grainCloudActive) return;
    this.grainCloudActive = true;
    this.generateGrainBuffer();
    this.scheduleGrainCloud();
  }

  private stopGrainCloud() {
    this.grainCloudActive = false;
    if (this.grainCloudInterval) {
      clearInterval(this.grainCloudInterval);
      this.grainCloudInterval = null;
    }
    // Cleanup active grain nodes
    this.grainCloudNodes.forEach(n => {
      try { if ('stop' in n && typeof (n as any).stop === 'function') (n as any).stop(); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    });
    this.grainCloudNodes = [];
  }

  private restartGrainCloud() {
    if (!this.grainCloudActive) return;
    // Only restart scheduling, don't regenerate buffer unless freeze toggled
    if (this.grainCloudInterval) {
      clearInterval(this.grainCloudInterval);
      this.grainCloudInterval = null;
    }
    if (!this.mod.grainFreeze) {
      this.generateGrainBuffer();
    }
    this.scheduleGrainCloud();
  }

  private generateGrainBuffer() {
    if (!this.ctx) return;
    const rate = this.ctx.sampleRate;
    const dur = 2; // 2 second buffer
    const len = Math.floor(rate * dur);
    const buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);

    // Generate a sine tone at the root frequency as base texture
    const freq = this.rootFrequency;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      // Mix of root sine + slight harmonics + subtle noise for texture
      data[i] = Math.sin(2 * Math.PI * freq * t) * 0.5
        + Math.sin(2 * Math.PI * freq * 2 * t) * 0.15
        + Math.sin(2 * Math.PI * freq * 3 * t) * 0.08
        + (Math.random() * 2 - 1) * 0.05;
    }
    this.grainCloudBuffer = buf;
  }

  private scheduleGrainCloud() {
    if (!this.ctx || !this.grainCloudGain) return;

    const spawnGrain = () => {
      if (!this.ctx || !this.grainCloudGain || !this.grainCloudActive) return;
      const buf = this.mod.grainFreeze && this.grainCloudFrozenBuffer
        ? this.grainCloudFrozenBuffer
        : this.grainCloudBuffer;
      if (!buf) return;

      const now = this.ctx.currentTime;
      const grainDurMs = 20 + (this.mod.grainSize / 500) * 380; // 20ms-400ms
      const grainDur = grainDurMs / 1000;

      // Random start position based on scatter
      const maxOffset = Math.max(0, buf.duration - grainDur);
      const startOffset = this.mod.grainScatter * Math.random() * maxOffset;

      // Pitch variation
      const pitchVar = (Math.random() - 0.5) * 2 * this.mod.grainPitchSpread;
      const playbackRate = Math.pow(2, pitchVar / 12);

      // Create grain source with buffer pre-set (buffer can only be assigned once)
      let grainBuf = buf;
      if (this.mod.grainReverse) {
        const revBuf = this.ctx.createBuffer(1, buf.length, buf.sampleRate);
        const srcData = buf.getChannelData(0);
        const revData = revBuf.getChannelData(0);
        for (let i = 0; i < buf.length; i++) {
          revData[i] = srcData[buf.length - 1 - i];
        }
        grainBuf = revBuf;
      }
      const source = createBufferSource(this.ctx, grainBuf);
      if (!source) return;
      source.playbackRate.setValueAtTime(Math.abs(playbackRate), now);

      // Grain envelope: fade in/out with Hann-like shape
      const env = this.ctx.createGain();
      const rampTime = grainDur * 0.3;
      const grainPeakAmp = 0.3 * 1.3; // 1.3x boost to compensate grain windowing losses
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(grainPeakAmp, now + rampTime);
      env.gain.setValueAtTime(grainPeakAmp, now + grainDur - rampTime);
      env.gain.linearRampToValueAtTime(0, now + grainDur);

      // Random panning for stereo spread
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime((Math.random() - 0.5) * 1.4, now);

      source.connect(env);
      env.connect(panner);
      panner.connect(this.grainCloudGain!);

      source.start(now, startOffset, grainDur + 0.01);

      this.grainCloudNodes.push(source, env, panner);

      // Auto-cleanup after grain finishes
      setTimeout(() => {
        try { source.disconnect(); } catch (_) {}
        try { env.disconnect(); } catch (_) {}
        try { panner.disconnect(); } catch (_) {}
        const idx1 = this.grainCloudNodes.indexOf(source);
        if (idx1 >= 0) this.grainCloudNodes.splice(idx1, 1);
        const idx2 = this.grainCloudNodes.indexOf(env);
        if (idx2 >= 0) this.grainCloudNodes.splice(idx2, 1);
        const idx3 = this.grainCloudNodes.indexOf(panner);
        if (idx3 >= 0) this.grainCloudNodes.splice(idx3, 1);
      }, (grainDur + 0.1) * 1000);
    };

    // Schedule grains at density rate
    const intervalMs = Math.max(16, 1000 / Math.max(4, Math.min(60, this.mod.grainDensity)));
    this.grainCloudInterval = setInterval(spawnGrain, intervalMs);
    // Spawn first grain immediately
    spawnGrain();
  }

  // Freeze: capture current buffer state
  freezeGrainCloud() {
    if (this.grainCloudBuffer && this.ctx) {
      const src = this.grainCloudBuffer;
      const frozen = this.ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
      for (let ch = 0; ch < src.numberOfChannels; ch++) {
        frozen.copyToChannel(src.getChannelData(ch), ch);
      }
      this.grainCloudFrozenBuffer = frozen;
    }
  }

  unfreezeGrainCloud() {
    this.grainCloudFrozenBuffer = null;
  }
}