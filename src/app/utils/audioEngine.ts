// FORMLESS — Global Master Bus Audio Engine
// Chain: strokeSources → envelope → sourceAmpGain(FLAVOR_SOURCE_AMPLITUDE) → flavorGain(duck/mute) → panner → flavorBusGain(fader) → [SAW/METAL: tanhClipper] → flavorLimiter(ceiling) → masterBus → Filter → Delay → Reverb → Chorus → Phaser → Flanger → HighShelf → Compressor(transparent) → OutputGain(0.92) → SoftClipper → Destination
// All effect nodes instantiated ONCE on load. Max 16 simultaneous strokes.

import { findNearestScaleFreq, mapYToScaleFreq, type ScaleNote } from '../components/ScaleSelector';

function createBufferSource(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBufferSourceNode | null {
  if ((ctx as AudioContext).state === 'closed') return null;
  try {
    return new AudioBufferSourceNode(ctx, { buffer });
  } catch (_) {
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
  isDrone?: boolean;
  targetVol?: number;
  yPosition?: number;
  isReleasing?: boolean;
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
  reverbMix: number;
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
  envAttack: number;
  envRelease: number;
}

const FLAVOR_SOURCE_AMPLITUDE: Record<SoundFlavor, number> = {
  sine:    0.95,
  saw:     0.04,
  sub:     0.90,
  grain:   0.85,
  noise:   0.88,
  metal:   0.03,
  flutter: 0.85,
  crystal: 0.88,
};

// Ceilings reducidos 6dB: con 8+ voces en drone, cada voz al techo anterior
// sumaba hasta +10dBFS en masterBus → softClipper saturable → pedorretas.
// A -14dBFS por voz, 8 voces suman +4dBFS → compressor lo maneja limpio.
const FLAVOR_CEILINGS: Record<SoundFlavor, number> = {
  sine:    -14,
  saw:     -30,
  sub:     -16,
  grain:   -15,
  noise:   -16,
  metal:   -32,
  flutter: -15,
  crystal: -15,
};

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
  reverbMix: 25,          // clean default — was 65
  delayTime: 0.353,
  delayFeedback: 0.45,
  delayMix: 0.35,
  chorusRate: 0.3,
  chorusDepth: 0.3,
  chorusMix: 0,           // off by default — was 0.4
  phaserRate: 0.5,
  phaserDepth: 0.5,
  phaserMix: 0,           // off by default — was 0.35
  flangerRate: 0.2,
  flangerDepth: 0,        // off by default — was 0.3
  flangerFeedback: 0,     // off by default — was 0.6
  detune: 0,
  detuneSpread: 10,
  detuneMix: 0.3,
  filterCutoff: 100,
  filterResonance: 0,
  filterDrive: 0,
  filterType: 'LP',
  lfo1Rate: 0.08,
  lfo1Depth: 0,           // off by default — was 0.2
  lfo1Phase: 0,
  lfo1Shape: 'SINE',
  lfo1Target: 'PITCH',
  lfo1Sync: false,
  lfo2Rate: 0.15,
  lfo2Depth: 0,           // off by default — was 0.15
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
  envAttack: 46,
  envRelease: 63,
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private readonly MAX_STROKES = 24;

  private masterBus: GainNode | null = null;
  private masterVolGain: GainNode | null = null;
  private analyzer: AnalyserNode | null = null;
  private preCompAnalyzer: AnalyserNode | null = null;
  private freqAnalyzer: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private softClipper: WaveShaperNode | null = null;
  private preCompHighShelf: BiquadFilterNode | null = null;
  private postCompGain: GainNode | null = null;
  private flavorSoftClippers: Partial<Record<SoundFlavor, WaveShaperNode>> = {};
  private flavorLimiters: Partial<Record<SoundFlavor, DynamicsCompressorNode>> = {};

  private filterNode: BiquadFilterNode | null = null;
  private ladderDriveNode: WaveShaperNode | null = null;
  private semAllpassNode: BiquadFilterNode | null = null;
  private filterDryGain: GainNode | null = null;
  private filterOutGain: GainNode | null = null;

  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayDry: GainNode | null = null;
  private delayWet: GainNode | null = null;
  private delayMixer: GainNode | null = null;

  private convolver: ConvolverNode | null = null;
  private reverbPreDelay: DelayNode | null = null;
  private reverbDry: GainNode | null = null;
  private reverbWet: GainNode | null = null;
  private reverbMixer: GainNode | null = null;

  private chorusDry: GainNode | null = null;
  private chorusWet: GainNode | null = null;
  private chorusMixer: GainNode | null = null;
  private chorusLfos: OscillatorNode[] = [];
  private chorusDelays: DelayNode[] = [];
  private chorusLfoGains: GainNode[] = [];

  private phaserDry: GainNode | null = null;
  private phaserWet: GainNode | null = null;
  private phaserMixer: GainNode | null = null;
  private phaserFilters: BiquadFilterNode[] = [];
  private phaserLfo: OscillatorNode | null = null;
  private phaserLfoGain: GainNode | null = null;

  private flangerDry: GainNode | null = null;
  private flangerWet: GainNode | null = null;
  private flangerMixer: GainNode | null = null;
  private flangerDelay: DelayNode | null = null;
  private flangerFeedback: GainNode | null = null;
  private flangerLfo: OscillatorNode | null = null;
  private flangerLfoGain: GainNode | null = null;

  private lofiLowpass: BiquadFilterNode | null = null;
  private lofiHighpass: BiquadFilterNode | null = null;
  private lofiWowDelay: DelayNode | null = null;
  private lofiWowLfo: OscillatorNode | null = null;
  private lofiWowLfoGain: GainNode | null = null;
  private lofiCrusher: WaveShaperNode | null = null;

  private grainCloudGain: GainNode | null = null;
  private grainCloudActive = false;
  private grainCloudInterval: ReturnType<typeof setInterval> | null = null;
  private grainCloudNodes: AudioNode[] = [];
  private grainCloudBuffer: AudioBuffer | null = null;
  private grainCloudFrozenBuffer: AudioBuffer | null = null;

  private masterPanner: StereoPannerNode | null = null;

  private flavorBusGains: Partial<Record<SoundFlavor, GainNode>> = {};
  private disconnectedBuses: Set<SoundFlavor> = new Set();

  private lfo1Osc: OscillatorNode | null = null;
  private lfo1Gain: GainNode | null = null;
  private lfo2Osc: OscillatorNode | null = null;
  private lfo2Gain: GainNode | null = null;
  private lfo1SHInterval: ReturnType<typeof setInterval> | null = null;
  private lfo2SHInterval: ReturnType<typeof setInterval> | null = null;

  // Recording state
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: BlobPart[] = [];
  private recordingStreamDest: MediaStreamAudioDestinationNode | null = null;

  private resonancePad: OscillatorNode | null = null;
  private resonancePadGain: GainNode | null = null;
  private resonanceActive = false;
  private rootFrequency = 261.63;

  private currentOctave = 3;

  private strokePool: ActiveSound[] = [];
  private activeSounds: Map<string, ActiveSound> = new Map();

  private mod: ModulatorSettings = { ...DEFAULT_MOD };
  private droneMode = false;
  private playMode: PlayMode = 'gate';

  private scaleTable: ScaleNote[] = [];

  private flavorVolumes: Record<SoundFlavor, number> = {
    sine: 0.75, saw: 0.75, sub: 0.65, grain: 0.75,
    noise: 0.90, metal: 0.75, flutter: 0.75, crystal: 0.75,
  };

  initialize() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const c = this.ctx;
    const now = c.currentTime;

    this.masterBus = c.createGain();
    this.masterBus.gain.value = 1;

    this.filterNode = c.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.setValueAtTime(AudioEngine.mapCutoffFreq(this.mod.filterCutoff), now);
    this.filterNode.Q.setValueAtTime(Math.max(0.001, AudioEngine.mapResonanceQ(this.mod.filterResonance)), now);
    this.filterDryGain = c.createGain();
    this.filterDryGain.gain.value = 1;
    this.filterOutGain = c.createGain();
    this.filterOutGain.gain.value = 1;
    this.ladderDriveNode = c.createWaveShaper();
    this.ladderDriveNode.oversample = '2x';
    this.updateDriveCurve(0);
    this.semAllpassNode = c.createBiquadFilter();
    this.semAllpassNode.type = 'allpass';
    this.semAllpassNode.frequency.setValueAtTime(AudioEngine.mapCutoffFreq(this.mod.filterCutoff), now);
    this.semAllpassNode.Q.setValueAtTime(0.5, now);
    this.connectFilterChain();

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
    this.lofiCrusher = c.createWaveShaper();
    this.lofiCrusher.oversample = 'none';
    this.updateLofiCrusherCurve(this.mod.reverbParam1);

    this.reverbPreDelay.connect(this.convolver);
    this.connectReverbOutput();
    this.reverbDry.connect(this.reverbMixer);
    this.reverbWet.connect(this.reverbMixer);

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
    if (this.phaserFilters.length > 0) {
      this.phaserFilters[this.phaserFilters.length - 1].connect(this.phaserWet);
    }
    this.phaserDry.connect(this.phaserMixer);
    this.phaserWet.connect(this.phaserMixer);

    this.flangerDry = c.createGain();
    this.flangerDry.gain.value = 1 - this.mod.flangerDepth * 0.3;
    this.flangerWet = c.createGain();
    this.flangerWet.gain.value = this.mod.flangerDepth;  // was hardcoded 0.3 — caused permanent comb filter even at depth=0
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

    this.masterPanner = c.createStereoPanner();
    this.masterPanner.pan.value = 0;

    this.masterVolGain = c.createGain();
    this.masterVolGain.gain.value = this.mod.masterVolume;

    this.preCompHighShelf = c.createBiquadFilter();
    this.preCompHighShelf.type = 'highshelf';
    this.preCompHighShelf.frequency.value = 6000;
    this.preCompHighShelf.gain.value = -4;

    this.compressor = c.createDynamicsCompressor();
    this.compressor.threshold.value = -3;
    this.compressor.ratio.value = 2;
    this.compressor.knee.value = 6;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.3;

    this.postCompGain = c.createGain();
    this.postCompGain.gain.value = 0.92;

    this.softClipper = c.createWaveShaper();
    this.softClipper.oversample = '2x';
    const scCurve = new Float32Array(8192);
    const thresh = 0.89;
    for (let i = 0; i < 8192; i++) {
      const x = (i * 2) / 8192 - 1;
      scCurve[i] = Math.abs(x) < thresh ? x : Math.sign(x) * (thresh + (1 - thresh) * Math.tanh((Math.abs(x) - thresh) / (1 - thresh)));
    }
    this.softClipper.curve = scCurve;

    this.analyzer = c.createAnalyser();
    this.analyzer.fftSize = 2048;
    this.analyzer.smoothingTimeConstant = 0.85;

    this.masterBus.connect(this.filterDryGain);
    this.filterOutGain.connect(this.delayDry);
    this.filterOutGain.connect(this.delayNode);
    this.delayMixer.connect(this.reverbDry);
    this.delayMixer.connect(this.reverbPreDelay);
    this.reverbMixer.connect(this.chorusDry);
    this.chorusDelays.forEach(d => this.reverbMixer!.connect(d));
    this.chorusMixer.connect(this.phaserDry);
    if (this.phaserFilters.length > 0) this.chorusMixer.connect(this.phaserFilters[0]);
    this.phaserMixer.connect(this.flangerDry);
    this.phaserMixer.connect(this.flangerDelay);
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

    // Per-flavor tanhClipper REMOVED for saw/metal.
    // tanh(200x) with 256 samples clips at ±0.008, but saw signals are at ~0.001
    // amplitude after FLAVOR_SOURCE_AMPLITUDE=0.04 scaling. The WaveShaper operates
    // in its quantization zone → rectangular harmonic aliasing → pedorretas.
    // The flavorLimiter (20:1 at -30dBFS) and master softClipper handle any peaks.

    const allFlavors: SoundFlavor[] = ['sine', 'saw', 'sub', 'grain', 'noise', 'metal', 'flutter', 'crystal'];
    for (const fl of allFlavors) {
      const g = c.createGain();
      g.gain.setValueAtTime(this.flavorVolumes[fl], now);
      this.flavorBusGains[fl] = g;

      const limiter = c.createDynamicsCompressor();
      limiter.threshold.value = FLAVOR_CEILINGS[fl];
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.05;
      if (fl === 'saw' || fl === 'metal') {
        limiter.attack.value = 0.0001;
        limiter.threshold.value = -30;
      }
      this.flavorLimiters[fl] = limiter;

      const clipper = this.flavorSoftClippers[fl];
      if (clipper) {
        g.connect(clipper);
        clipper.connect(limiter);
      } else {
        g.connect(limiter);
      }
      limiter.connect(this.masterBus);
    }

    this.buildLFO(1);
    this.buildLFO(2);
    this.connectLFO(1);
    this.connectLFO(2);

    this.grainCloudGain = c.createGain();
    this.grainCloudGain.gain.value = 0.25;
    this.grainCloudGain.connect(this.masterBus);

    this.resonancePadGain = c.createGain();
    this.resonancePadGain.gain.value = 0;
    this.resonancePadGain.connect(this.masterBus);
  }

  private connectFilterChain() {
    if (!this.filterDryGain || !this.filterNode || !this.filterOutGain || !this.ladderDriveNode || !this.semAllpassNode) return;
    try { this.filterDryGain.disconnect(); } catch (_) {}
    try { this.filterNode.disconnect(); } catch (_) {}
    try { this.ladderDriveNode.disconnect(); } catch (_) {}
    try { this.semAllpassNode.disconnect(); } catch (_) {}

    const type = this.mod.filterType;
    this.applyFilterType();

    if (type === 'LADDER') {
      this.filterDryGain.connect(this.filterNode);
      this.filterNode.connect(this.ladderDriveNode);
      this.ladderDriveNode.connect(this.filterOutGain);
    } else if (type === 'SEM') {
      this.filterDryGain.connect(this.filterNode);
      this.filterNode.connect(this.semAllpassNode);
      this.semAllpassNode.connect(this.filterOutGain);
    } else {
      this.filterDryGain.connect(this.filterNode);
      this.filterNode.connect(this.filterOutGain);
    }
  }

  private static readonly CUTOFF_MIN = 80;
  private static readonly CUTOFF_MAX = 18000;
  private static readonly CUTOFF_RATIO = AudioEngine.CUTOFF_MAX / AudioEngine.CUTOFF_MIN;

  static mapCutoffFreq(knobValue: number): number {
    return AudioEngine.CUTOFF_MIN * Math.pow(AudioEngine.CUTOFF_RATIO, knobValue / 100);
  }

  static mapResonanceQ(knobValue: number): number {
    return 0.5 + (knobValue / 100) * 18;
  }

  private static readonly ATK_MIN = 0.005;
  private static readonly ATK_MAX = 2.0;
  private static readonly ATK_RATIO = AudioEngine.ATK_MAX / AudioEngine.ATK_MIN;

  static mapAttackSec(knobValue: number): number {
    const raw = AudioEngine.ATK_MIN * Math.pow(AudioEngine.ATK_RATIO, knobValue / 100);
    return Math.max(0.015, raw);
  }

  private static readonly REL_MIN = 0.05;
  private static readonly REL_MAX = 4.0;
  private static readonly REL_RATIO = AudioEngine.REL_MAX / AudioEngine.REL_MIN;

  static mapReleaseSec(knobValue: number): number {
    return AudioEngine.REL_MIN * Math.pow(AudioEngine.REL_RATIO, knobValue / 100);
  }

  private applyFilterType() {
    if (!this.filterNode || !this.ctx) return;
    const now = this.ctx.currentTime;
    const { filterCutoff: coKnob, filterResonance: resKnob, filterType: type, filterDrive: drive } = this.mod;

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
          this.semAllpassNode.frequency.cancelScheduledValues(now);
          this.semAllpassNode.frequency.setValueAtTime(this.semAllpassNode.frequency.value, now);
          this.semAllpassNode.frequency.exponentialRampToValueAtTime(mappedFreq, now + 0.025);
          this.semAllpassNode.Q.cancelScheduledValues(now);
          this.semAllpassNode.Q.setValueAtTime(this.semAllpassNode.Q.value, now);
          this.semAllpassNode.Q.exponentialRampToValueAtTime(Math.max(0.001, 0.5 + mappedQ * 0.3), now + 0.02);
        }
        break;
    }

    let qForType: number;
    switch (type) {
      case 'LADDER': qForType = mappedQ * 3.5; break;
      case 'SEM': qForType = Math.min(mappedQ, 8); break;
      default: qForType = mappedQ; break;
    }
    const safeQ = Math.max(0.001, qForType);
    this.filterNode.Q.cancelScheduledValues(now);
    this.filterNode.Q.setValueAtTime(Math.max(0.001, this.filterNode.Q.value), now);
    this.filterNode.Q.exponentialRampToValueAtTime(safeQ, now + 0.02);

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

  private updateLofiCrusherCurve(crushVal: number) {
    if (!this.lofiCrusher) return;
    const bitDepth = 16 - crushVal * 13;
    const step = 2 / Math.pow(2, Math.floor(bitDepth));
    const samples = 8192;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1;
      curve[i] = Math.round(x / step) * step;
    }
    this.lofiCrusher.curve = curve;
  }

  private ensureReverbChain() {
    if (!this.delayMixer || !this.reverbDry || !this.reverbPreDelay || !this.reverbWet || !this.reverbMixer) return;
    try { this.delayMixer.connect(this.reverbDry); } catch (_) {}
    try { this.delayMixer.connect(this.reverbPreDelay); } catch (_) {}
    try { this.reverbDry.connect(this.reverbMixer); } catch (_) {}
    try { this.reverbWet.connect(this.reverbMixer); } catch (_) {}
  }

  private connectReverbOutput() {
    if (!this.convolver || !this.reverbWet || !this.lofiLowpass || !this.lofiHighpass || !this.lofiWowDelay) return;
    try { this.convolver.disconnect(); } catch (_) {}
    try { this.lofiLowpass.disconnect(); } catch (_) {}
    try { this.lofiHighpass.disconnect(); } catch (_) {}
    try { this.lofiWowDelay.disconnect(); } catch (_) {}
    try { this.lofiCrusher?.disconnect(); } catch (_) {}

    if (this.mod.reverbType === 'LOFI') {
      this.convolver.connect(this.lofiCrusher!);
      this.lofiCrusher!.connect(this.lofiLowpass);
      this.lofiLowpass.connect(this.lofiHighpass);
      this.lofiHighpass.connect(this.lofiWowDelay);
      this.lofiWowDelay.connect(this.reverbWet);
      this.updateLofiCrusherCurve(this.mod.reverbParam1);
      if (this.lofiWowLfoGain && this.ctx) {
        const depth = this.mod.reverbParam2 * 0.015;
        this.lofiWowLfoGain.gain.setValueAtTime(depth, this.ctx.currentTime);
      }
    } else {
      this.convolver.connect(this.reverbWet);
    }
  }

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
    const bigVerb = type === 'HALL' || type === 'MASSIVE' || type === 'GRANULAR';
    const isLofi = type === 'LOFI';
    const baseGain = isLofi ? 0.7 : bigVerb ? 0.75 : 0.5;

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const tNorm = i / len;
        let s = Math.random() * 2 - 1;
        switch (type) {
          case 'ROOM':
            s *= Math.exp(-tNorm * 4);
            break;
          case 'HALL': {
            const hallDecay = Math.exp(-t * (3.0 / dur));
            s *= hallDecay;
            if (ch === 1) s *= 1.25;
            const hallERTimes = ch === 0 ? [0.017, 0.043, 0.089] : [0.023, 0.061, 0.097];
            for (const erT of hallERTimes) {
              const erSample = Math.floor(erT * rate);
              if (i >= erSample && i < erSample + Math.floor(0.003 * rate)) {
                s += (Math.random() * 2 - 1) * 0.4;
              }
            }
            break;
          }
          case 'GRANULAR': {
            const grainDur = 0.060;
            const gapDur = 0.015;
            const cycleDur = grainDur * 2.5 + gapDur;
            const cycleSamples = Math.floor(cycleDur * rate);
            const grainSamples = Math.floor(grainDur * rate);
            const gapSamples = Math.floor(gapDur * rate);
            const posInCycle = i % cycleSamples;
            const grainBlock2End = grainSamples * 2;
            if (posInCycle >= grainBlock2End && posInCycle < grainBlock2End + gapSamples) {
              s = 0;
            } else {
              const grainIdx = Math.floor(i / grainSamples);
              const grainAmp = 0.2 + ((grainIdx * 7919 + ch * 1013) % 100) / 125.0;
              const pitchFactor = 0.85 + ((grainIdx * 3571 + ch * 997) % 100) / 333.0;
              const envPos = (posInCycle % grainSamples) / grainSamples;
              const grainEnv = envPos < 0.1 ? envPos / 0.1 : envPos > 0.9 ? (1 - envPos) / 0.1 : 1;
              s *= grainAmp * grainEnv * pitchFactor;
            }
            s *= Math.exp(-t / 1.5);
            break;
          }
          case 'LOFI': {
            const crushVal = this.mod.reverbParam1;
            const bitDepth = 16 - crushVal * 13;
            const crushStep = 2 / Math.pow(2, Math.floor(bitDepth));
            s *= Math.exp(-t / (0.8 + this.mod.reverbDecay * 1.5));
            s = Math.round(s / crushStep) * crushStep;
            if (crushVal > 0.6) {
              const gritAmount = (crushVal - 0.6) / 0.4;
              s += (Math.random() * 2 - 1) * 0.03 * gritAmount;
            }
            s += (Math.random() * 2 - 1) * 0.005 * crushVal;
            break;
          }
          case 'SPATIAL': {
            // ROOT CAUSE of L-bias: any amplitude-modulation approach (cos/sin rotation)
            // starts at sin(0)=0 on one channel → that channel is silent for the first
            // ~100ms of the impulse → convolution result is perceptually hard-left at attack.
            //
            // FIX: equal amplitude envelope on both channels. Stereo width comes exclusively
            // from DECORRELATION (different noise samples per channel) and asymmetric early
            // reflections. Both channels always have the same loudness → perfectly centered.
            const spatialDecay = Math.exp(-t * (1.8 / dur));
            s *= spatialDecay;

            // Early reflections — completely different time patterns per channel.
            // These are the primary psychoacoustic cue for stereo width.
            const erL = [0.008, 0.019, 0.037, 0.059, 0.083, 0.112];
            const erR = [0.013, 0.028, 0.051, 0.074, 0.097, 0.131];
            for (const erT of (ch === 0 ? erL : erR)) {
              const erS = Math.floor(erT * rate);
              const erW = Math.floor(0.004 * rate);
              if (i >= erS && i < erS + erW) {
                const erAmp = 0.6 * Math.exp(-(t - erT) * 5);
                s += (Math.random() * 2 - 1) * erAmp;
              }
            }
            break;
          }
          case 'MASSIVE': {
            if (t < 0.1) {
              s = 0;
            } else if (t < 3.1) {
              s *= ((t - 0.1) / 3.0);
            } else if (t < 4.1) {
              s *= 1.0;
            } else {
              s *= Math.exp(-((t - 4.1) / 4.0) * 3.0);
            }
            if (t < 1.0 && t >= 0.1) {
              const roomDecay = Math.exp(-(t - 0.1) * 6.0);
              s += (Math.random() * 2 - 1) * 0.15 * roomDecay;
            }
            break;
          }
        }
        d[i] = s * baseGain;
      }
    }

    if (type === 'HALL') {
      const shelfFreq = 6000;
      const shelfAlpha = Math.min(1, (2 * Math.PI * shelfFreq) / rate);
      const boostLin = Math.pow(10, 3 / 20);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let prev = 0;
        for (let i = 0; i < len; i++) {
          const low = prev + shelfAlpha * (d[i] - prev);
          const high = d[i] - low;
          prev = low;
          d[i] = low + high * boostLin;
        }
      }
    }

    if (type === 'SPATIAL') {
      const dL = buf.getChannelData(0);
      const dR = buf.getChannelData(1);
      const height = this.mod.reverbParam2 ?? 0.7;

      // ── Haas delay on R: 12–28ms controlled by HEIGHT knob ──────────────────
      // This is the dominant psychoacoustic width cue: the brain perceives the
      // earlier signal as the source direction. With L arriving first, the image
      // is centered-to-slightly-left. Haas range 12–28ms is the "precedence zone"
      // where the brain fuses both signals into one wide image instead of an echo.
      const haasMs = 12 + height * 16;
      const haasSamples = Math.floor((haasMs / 1000) * rate);
      const tempR = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        tempR[i] = i >= haasSamples ? dR[i - haasSamples] : 0;
      }
      dR.set(tempR);

      // ── All-pass phase scatter on R ──────────────────────────────────────────
      // A first-order all-pass at ~800Hz shifts the phase of R without changing
      // its frequency content. Perceptually transparent but maximally decorrelates
      // L and R → the brain can't collapse them to mono → extreme perceived width.
      // coefficient a = (tan(π*fc/fs) - 1) / (tan(π*fc/fs) + 1)
      const fc = 800;
      const tanVal = Math.tan(Math.PI * fc / rate);
      const apCoeff = (tanVal - 1) / (tanVal + 1);
      let apPrev = 0;
      for (let i = 0; i < len; i++) {
        const x = dR[i];
        const y = apCoeff * x + apPrev;
        apPrev = x - apCoeff * y;
        dR[i] = y;
      }

      // ── Normalize both channels to equal RMS ─────────────────────────────────
      // All-pass and Haas delay can slightly change RMS balance.
      // Normalize so both channels have equal perceived loudness → centered image.
      let rmsL = 0, rmsR = 0;
      for (let i = 0; i < len; i++) { rmsL += dL[i] * dL[i]; rmsR += dR[i] * dR[i]; }
      rmsL = Math.sqrt(rmsL / len) || 1;
      rmsR = Math.sqrt(rmsR / len) || 1;
      const normFactor = rmsL / rmsR;
      for (let i = 0; i < len; i++) { dR[i] *= normFactor; }
    }

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
    this.ensureReverbChain();

    if (!applyDefaults) return;

    const now = this.ctx.currentTime;
    const rt = this.mod.reverbType;

    const defaultMix: Record<ReverbType, number> = {
      ROOM: 60, HALL: 72, GRANULAR: 68, LOFI: 65, SPATIAL: 75, MASSIVE: 82,
    };
    this.mod.reverbMix = defaultMix[rt];
    const mix = this.mod.reverbMix / 100;
    this.reverbWet.gain.setValueAtTime(mix, now);
    this.reverbDry!.gain.setValueAtTime(1 - mix, now);

    if (rt === 'HALL') {
      this.mod.reverbSize = 0.85;
      this.mod.reverbDecay = 0.80;
      this.mod.reverbPreDelay = 55;
      this.reverbPreDelay.delayTime.setValueAtTime(0.055, now);
    } else if (rt === 'SPATIAL') {
      this.mod.reverbParam1 = 0.90;
      this.mod.reverbParam2 = 0.70;
    } else if (rt === 'MASSIVE') {
      this.mod.reverbSize = 0.98;
      this.mod.reverbDecay = 0.92;
      this.mod.reverbParam1 = 0.70;
    } else if (rt === 'LOFI') {
      this.mod.reverbSize = 0.75;
      this.mod.reverbDecay = 0.6;
      this.mod.reverbParam1 = 0.7;
      this.mod.reverbParam2 = 0.6;
      this.mod.reverbPreDelay = 15;
      this.reverbPreDelay.delayTime.setValueAtTime(0.015, now);
      if (this.lofiWowLfoGain) {
        this.lofiWowLfoGain.gain.setValueAtTime(0.6 * 0.015, now);
      }
      this.updateLofiCrusherCurve(0.7);
    }
  }

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

  getAnalyzer() { return this.analyzer; }
  getPreCompAnalyzer() { return this.preCompAnalyzer; }
  getFreqAnalyzer() { return this.freqAnalyzer; }
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
    const clamped = Math.max(0, Math.min(1, value));
    this.flavorVolumes[flavor] = clamped < 0.005 ? 0 : clamped;
    if (!this.ctx || !this.masterBus) return;
    const busGain = this.flavorBusGains[flavor];
    if (!busGain) return;

    const clipper = this.flavorSoftClippers[flavor];
    const limiter = this.flavorLimiters[flavor];
    if (this.flavorVolumes[flavor] === 0) {
      if (!this.disconnectedBuses.has(flavor)) {
        try { busGain.disconnect(); } catch (_) {}
        this.disconnectedBuses.add(flavor);
      }
    } else {
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

  setScaleTable(table: ScaleNote[]) { this.scaleTable = table; }
  getScaleTable(): ScaleNote[] { return this.scaleTable; }

  retuneActiveStrokes() {
    if (!this.ctx || this.scaleTable.length === 0) return;
    const now = this.ctx.currentTime;
    const glideTime = 0.3;
    const canvasHeight = window.innerHeight;

    this.activeSounds.forEach(s => {
      if (s.flavor === 'noise') return;
      if (s.isReleasing) return;

      let newFreq: number;
      if (s.yPosition != null) {
        const scaleNote = mapYToScaleFreq(s.yPosition, canvasHeight, this.scaleTable);
        newFreq = scaleNote.freq;
      } else {
        const nearest = findNearestScaleFreq(s.baseFrequency, this.scaleTable);
        newFreq = nearest.freq;
      }

      if (Math.abs(newFreq - s.baseFrequency) < 0.01) return;

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

      if (s.liveOctaveOsc) glideOscFreq(s.liveOctaveOsc.frequency, newFreq * 2);
      if (s.liveFifthOsc) glideOscFreq(s.liveFifthOsc.frequency, newFreq * Math.pow(2, 7 / 12));
      if (s.live2ndOctaveOsc) glideOscFreq(s.live2ndOctaveOsc.frequency, newFreq * 4);

      s.baseFrequency = newFreq;
      s.quantizedFreq = newFreq;
    });
  }

  retuneForOctaveChange(oldOctave: number, newOctave: number) {
    if (!this.ctx) return;
    if (oldOctave === newOctave) return;
    this.currentOctave = newOctave;
    const ratio = Math.pow(2, newOctave - oldOctave);
    const now = this.ctx.currentTime;
    const glideTime = 0.3;

    this.activeSounds.forEach(s => {
      if (s.isLive) return;
      if (!s.locked && !this.droneMode) return;

      const newBaseFreq = s.baseFrequency * ratio;

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
    this.clearAllStrokes(0.15);
  }

  setDroneMode(on: boolean) {
    this.setPlayMode(on ? 'drone' : 'gate');
  }

  fadeAllStrokes(duration: number): string[] {
    const faded: string[] = [];
    this.strokePool.forEach(s => {
      this.releaseStroke(s.id, duration);
      faded.push(s.id);
    });
    return faded;
  }

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
      s.envelope.gain.cancelScheduledValues(now);
      s.envelope.gain.setTargetAtTime(0.0001, now, Math.max(0.01, fadeSec / 3));
    }
    const cleanupMs = fadeSec * 1000 + 50;
    setTimeout(() => {
      for (const s of pool) {
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

  // ─────────────────────────────────────────────────────────────────────────
  // smoothParam — FIX v2
  //
  // Root cause of the previous broken fix:
  //   param.value returns the INTRINSIC value (set by the last setValueAtTime
  //   call), NOT the current automation-computed value. After a linearRamp to 0
  //   completes, param.value still returns the start-of-ramp value (e.g. 0.35).
  //   Re-anchoring with setValueAtTime(0.35, now) caused a visible gain jump
  //   from 0 → 0.35 before the next ramp, silencing the dry path.
  //
  // Fix: use setTargetAtTime exclusively.
  //   After cancelScheduledValues the parameter holds its current COMPUTED value.
  //   setTargetAtTime approaches the target from that computed value with no
  //   start-anchor needed — no param.value read, no jump, works from any value
  //   including 0.
  //   timeConstant = rampSec/3 → reaches ~95% of target at rampSec.
  // ─────────────────────────────────────────────────────────────────────────
  private smoothParam(param: AudioParam, targetVal: number, rampSec: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    // setTargetAtTime exponentially approaches target from the current computed
    // value without requiring an explicit start anchor. Works from any value
    // including 0 (from-zero exponential approach is well-defined here because
    // setTargetAtTime uses: v(t) = target + (v0 - target) * exp(-t/tc)).
    const tc = Math.max(0.001, rampSec / 3);
    param.setTargetAtTime(targetVal > 0 ? targetVal : 1e-5, now, tc);
  }

  setModulators(settings: Partial<ModulatorSettings>) {
    const prev = { ...this.mod };
    this.mod = { ...this.mod, ...settings };
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (settings.masterVolume !== undefined && this.masterVolGain) {
      this.smoothParam(this.masterVolGain.gain, this.mod.masterVolume, 0.02);
    }

    if (settings.filterType !== undefined && settings.filterType !== prev.filterType) {
      this.connectFilterChain();
      this.connectLFO(1); this.connectLFO(2);
    } else if (settings.filterCutoff !== undefined || settings.filterResonance !== undefined || settings.filterDrive !== undefined) {
      this.applyFilterType();
    }

    if (settings.chorusRate !== undefined || settings.chorusDepth !== undefined) {
      const rates = [this.mod.chorusRate, this.mod.chorusRate * 1.08];
      this.chorusLfos.forEach((lfo, i) => { try { this.smoothParam(lfo.frequency, rates[i], 0.02); } catch (_) {} });
      this.chorusLfoGains.forEach(g => this.smoothParam(g.gain, this.mod.chorusDepth * 0.004, 0.02));
    }
    if (settings.chorusMix !== undefined) {
      if (this.chorusWet) this.smoothParam(this.chorusWet.gain, this.mod.chorusMix, 0.02);
      if (this.chorusDry) this.smoothParam(this.chorusDry.gain, 1 - this.mod.chorusMix * 0.5, 0.02);
    }

    if (settings.phaserRate !== undefined && this.phaserLfo) this.smoothParam(this.phaserLfo.frequency, this.mod.phaserRate, 0.02);
    if (settings.phaserDepth !== undefined && this.phaserLfoGain) this.smoothParam(this.phaserLfoGain.gain, this.mod.phaserDepth * 800, 0.02);
    if (settings.phaserMix !== undefined) {
      if (this.phaserWet) this.smoothParam(this.phaserWet.gain, this.mod.phaserMix, 0.02);
      if (this.phaserDry) this.smoothParam(this.phaserDry.gain, 1 - this.mod.phaserMix * 0.5, 0.02);
    }

    if (settings.flangerRate !== undefined && this.flangerLfo) this.smoothParam(this.flangerLfo.frequency, this.mod.flangerRate, 0.02);
    if (settings.flangerDepth !== undefined && this.flangerLfoGain) this.smoothParam(this.flangerLfoGain.gain, this.mod.flangerDepth * 0.002, 0.02);
    if (settings.flangerFeedback !== undefined && this.flangerFeedback) this.smoothParam(this.flangerFeedback.gain, this.mod.flangerFeedback, 0.02);

    if (settings.delayTime !== undefined && this.delayNode) this.smoothParam(this.delayNode.delayTime, this.mod.delayTime, 0.03);
    if (settings.delayFeedback !== undefined && this.delayFeedback) this.smoothParam(this.delayFeedback.gain, Math.min(this.mod.delayFeedback, 0.92), 0.02);
    if (settings.delayMix !== undefined) {
      if (this.delayWet) this.smoothParam(this.delayWet.gain, this.mod.delayMix, 0.02);
      if (this.delayDry) this.smoothParam(this.delayDry.gain, 1 - this.mod.delayMix * 0.3, 0.02);
    }

    if (settings.reverbType !== undefined && settings.reverbType !== prev.reverbType) {
      this.rebuildReverb();
    }
    if (settings.reverbMix !== undefined) {
      const mix = Math.max(0, Math.min(100, this.mod.reverbMix)) / 100;
      if (this.reverbWet) this.smoothParam(this.reverbWet.gain, mix, 0.02);
      if (this.reverbDry) this.smoothParam(this.reverbDry.gain, 1 - mix, 0.02);
      this.ensureReverbChain();
    }
    if (settings.reverbPreDelay !== undefined && this.reverbPreDelay) this.smoothParam(this.reverbPreDelay.delayTime, this.mod.reverbPreDelay / 1000, 0.03);
    if (settings.reverbParam2 !== undefined && this.mod.reverbType === 'LOFI' && this.lofiWowLfoGain) {
      const depth = this.mod.reverbParam2 * 0.015;
      this.smoothParam(this.lofiWowLfoGain.gain, depth, 0.02);
    }
    if (settings.reverbParam1 !== undefined && this.mod.reverbType === 'LOFI') {
      this.updateLofiCrusherCurve(this.mod.reverbParam1);
    }

    if (settings.grainCloudActive !== undefined) {
      if (settings.grainCloudActive && !this.grainCloudActive) {
        this.startGrainCloud();
      } else if (!settings.grainCloudActive && this.grainCloudActive) {
        this.stopGrainCloud();
      }
    }
    if (settings.grainFreeze !== undefined && this.grainCloudActive) {
      if (settings.grainFreeze) {
        this.freezeGrainCloud();
      } else {
        this.unfreezeGrainCloud();
      }
    }
    if (this.grainCloudActive && (
      settings.grainSize !== undefined || settings.grainDensity !== undefined ||
      settings.grainScatter !== undefined || settings.grainPitchSpread !== undefined ||
      settings.grainReverse !== undefined
    )) {
      this.restartGrainCloud();
    }

    if (settings.detune !== undefined) {
      this.activeSounds.forEach(s => {
        [...s.oscillators, ...(s.harmonicOscs || [])].forEach(o => { try { this.smoothParam(o.detune, this.mod.detune, 0.02); } catch (_) {} });
      });
    }

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

    if (settings.envAttack !== undefined || settings.envRelease !== undefined) {
      this.retroactiveEnvelopeUpdate();
    }

    if (settings.tempo !== undefined || settings.pulseLength !== undefined ||
        settings.envAttack !== undefined || settings.envRelease !== undefined) {
      this.activeSounds.forEach(s => {
        if (s.pulseInterval && !s.isDrone) {
          this.startPulseEnvelope(s, s.targetVol ?? 0.15);
        }
      });
    }
  }

  private retroactiveEnvelopeUpdate() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const newAttack = AudioEngine.mapAttackSec(this.mod.envAttack);

    this.activeSounds.forEach(s => {
      if (s.isDrone || s.pulseInterval || s.isLive) return;

      const elapsed = now - s.startTime;
      const vol = s.targetVol ?? 0.15;

      if (elapsed < newAttack) {
        const remaining = Math.max(0.005, newAttack - elapsed);
        // cancelScheduledValues freezes at current computed value.
        // setTargetAtTime ramps to vol from there — no param.value read.
        s.envelope.gain.cancelScheduledValues(now);
        s.envelope.gain.setTargetAtTime(vol, now, Math.max(0.005, remaining / 3));
      }
    });
  }

  private evictOldest(): string | null {
    if (this.strokePool.length < this.MAX_STROKES) return null;
    const oldest = this.strokePool[0];
    if (!oldest) return null;
    this.removeStroke(oldest.id);
    return oldest.id;
  }

  private applyVoiceDucking() {
    if (!this.ctx) return;
    const count = this.strokePool.length;
    const now = this.ctx.currentTime;
    // Duck desde 2 voces: en drone con 4-8 voces el masterBus saturaba el softClipper.
    // Cada voz adicional reduce ~7% para mantener la suma bajo -3dBFS.
    // Duck from 2 voices. Target: ~0.28 at 24 voices (max).
    // factor = (1 - floor) / (MAX - 2) = (1 - 0.28) / 22 ≈ 0.0327
    const duckGain = Math.max(0.28, 1 - Math.max(0, count - 2) * 0.0327);
    this.strokePool.forEach(s => {
      if (!s.muted) {
        s.flavorGain.gain.setTargetAtTime(duckGain, now, 0.05);
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
    // cancelScheduledValues freezes param at current COMPUTED value.
    // setTargetAtTime approaches 0 from that value — no param.value read needed.
    s.envelope.gain.cancelScheduledValues(now);
    s.envelope.gain.setTargetAtTime(0.0001, now, 0.03); // ~90ms to near-zero
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

  playStroke(stroke: StrokeData, id: string, locked: boolean, quantizedFrequency?: number): string | null {
    if (!this.ctx || !this.masterBus) return null;

    if (this.flavorVolumes[stroke.flavor] === 0 || this.disconnectedBuses.has(stroke.flavor)) return null;

    const evictedId = this.evictOldest();

    const c = this.ctx;
    const now = c.currentTime;
    const freq = quantizedFrequency || this.mapYToFreq(stroke.avgY);
    const isDrone = this.droneMode;

    const dur = isDrone ? 86400 : (locked ? (60 / this.mod.tempo) * 4 : this.mapLengthToDur(stroke.length));
    const vol = this.mapSpeedToVol(stroke.speed);
    const endTime = isDrone ? now + 86400 : (locked ? now + dur : now + dur * this.mod.drift);

    const envelope = c.createGain();
    const flavorGain = c.createGain();
    flavorGain.gain.value = 1;
    const oscillators: OscillatorNode[] = [];
    const allNodes: AudioNode[] = [envelope, flavorGain];
    const harmonicOscs: OscillatorNode[] = [];
    let noiseDeepRumbleInterval: ReturnType<typeof setInterval> | undefined;

    const avgX = stroke.points.reduce((s, p) => s + p.x, 0) / stroke.points.length;
    const pan = (avgX / window.innerWidth) * 2 - 1;
    const panner = c.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    allNodes.push(panner);

    switch (stroke.flavor) {
      case 'sine': {
        const osc = c.createOscillator();
        osc.type = 'sine'; osc.frequency.setValueAtTime(freq, now);
        const sinePeak = c.createBiquadFilter();
        sinePeak.type = 'peaking'; sinePeak.frequency.value = 2000; sinePeak.gain.value = 1.5; sinePeak.Q.value = 0.8;  // was +3dB
        osc.connect(sinePeak); sinePeak.connect(envelope); osc.start(now);
        if (!isDrone) osc.stop(endTime + 1);
        oscillators.push(osc); allNodes.push(osc, sinePeak);
        break;
      }
      case 'saw': {
        const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(freq, now);
        const osc2 = c.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.setValueAtTime(freq * 1.004, now);
        const mix = c.createGain(); mix.gain.value = 0.10;
        osc.connect(mix); osc2.connect(mix); mix.connect(envelope);
        osc.start(now); osc2.start(now);
        if (!isDrone) { osc.stop(endTime + 1); osc2.stop(endTime + 1); }
        oscillators.push(osc); harmonicOscs.push(osc2); allNodes.push(osc, osc2, mix);
        break;
      }
      case 'sub': {
        const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(freq * 0.5, now);
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 30; hp.Q.value = 0.7;
        const subShelf = c.createBiquadFilter();
        subShelf.type = 'lowshelf'; subShelf.frequency.value = 200; subShelf.gain.value = 2;  // was +4dB
        osc.connect(hp); hp.connect(subShelf); subShelf.connect(envelope);
        osc.start(now);
        if (!isDrone) osc.stop(endTime + 1);
        oscillators.push(osc); allNodes.push(osc, hp, subShelf);
        break;
      }
      case 'grain': {
        if (isDrone) {
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
          const grainAmp = Math.min(0.3, 2.5 / Math.max(1, density)) * 1.3;
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
        const yNorm = stroke.avgY / window.innerHeight;
        // noiseMul reducido 2.5→0.65: antes max amplitude = 1.45*2.5 = 3.6 → limiter
        // lo aplastaba a -9dBFS pero con distorsion agresiva. Ahora max = 0.95,
        // el limiter apenas toca. Rango percibido igual, sin artifacts.
        const noiseMul = 0.65;
        const l1Base = 0.45 * noiseMul;
        const l2Gain = (0.25 + (1 - yNorm) * 0.35) * noiseMul;
        const l3Gain = (0.15 + yNorm * 0.25) * noiseMul;

        const oceanMix = c.createGain();
        oceanMix.gain.value = 1.0;
        oceanMix.connect(envelope);
        allNodes.push(oceanMix);

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
        const whiteLen = c.sampleRate * 10;
        const whiteBuf = c.createBuffer(1, whiteLen, c.sampleRate);
        const whiteData = whiteBuf.getChannelData(0);
        for (let i = 0; i < whiteLen; i++) whiteData[i] = Math.random() * 2 - 1;

        const surge = createBufferSource(c, pinkBuf);
        if (!surge) break;
        surge.loop = true; surge.start(now);
        const surgeLP = c.createBiquadFilter();
        surgeLP.type = 'lowpass'; surgeLP.frequency.value = 400; surgeLP.Q.value = 1.8;
        const surgeGain = c.createGain();
        surgeGain.gain.value = l1Base;
        const surgeLfo = c.createOscillator();
        surgeLfo.type = 'sine'; surgeLfo.frequency.value = 0.12;
        const surgeLfoGain = c.createGain();
        surgeLfoGain.gain.value = l1Base * 0.6;
        surgeLfo.connect(surgeLfoGain);
        surgeLfoGain.connect(surgeGain.gain);
        surgeLfo.start(now);
        if (!isDrone) { surge.stop(endTime + 1); surgeLfo.stop(endTime + 1); }
        surge.connect(surgeLP); surgeLP.connect(surgeGain); surgeGain.connect(oceanMix);
        allNodes.push(surge, surgeLP, surgeGain, surgeLfo, surgeLfoGain);

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
        surfaceLfoGain.gain.value = l2Gain * 0.4;
        surfaceLfo.connect(surfaceLfoGain);
        surfaceLfoGain.connect(surfaceGain.gain);
        surfaceLfo.start(now);
        if (!isDrone) { surface.stop(endTime + 1); surfaceLfo.stop(endTime + 1); }
        surface.connect(surfaceBP); surfaceBP.connect(surfaceGain); surfaceGain.connect(oceanMix);
        allNodes.push(surface, surfaceBP, surfaceGain, surfaceLfo, surfaceLfoGain);

        const rumble = createBufferSource(c, pinkBuf);
        if (!rumble) break;
        rumble.loop = true;
        rumble.playbackRate.value = 0.5;
        rumble.start(now);
        const rumbleLP = c.createBiquadFilter();
        rumbleLP.type = 'lowpass'; rumbleLP.frequency.value = 80; rumbleLP.Q.value = 0.7;
        const rumbleGain = c.createGain();
        rumbleGain.gain.value = l3Gain;
        if (!isDrone) rumble.stop(endTime + 1);
        rumble.connect(rumbleLP); rumbleLP.connect(rumbleGain); rumbleGain.connect(oceanMix);
        allNodes.push(rumble, rumbleLP, rumbleGain);

        const scheduleRumbleVar = () => {
          if (!this.ctx) return;
          const targetVal = l3Gain * (0.4 + Math.random() * 0.6);
          const rampTime = 1.5 + Math.random() * 2;
          try { rumbleGain.gain.setTargetAtTime(targetVal, this.ctx.currentTime, rampTime); } catch (_) {}
        };
        scheduleRumbleVar();
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
        carrier.frequency.setValueAtTime(freq, now); mod.frequency.setValueAtTime(freq * 3.73, now);
        modG.gain.setValueAtTime(freq * 0.4, now);
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

    if (!['noise', 'grain', 'crystal'].includes(stroke.flavor)) {
      const octOsc = c.createOscillator();
      octOsc.type = 'sine';
      octOsc.frequency.setValueAtTime(freq * 2, now);
      const octG = c.createGain(); octG.gain.value = stroke.flavor === 'saw' ? 0.05 : 0.15;  // was 0.35 — too hot
      octOsc.connect(octG); octG.connect(envelope);
      octOsc.start(now);
      if (!isDrone) octOsc.stop(endTime + 1);
      harmonicOscs.push(octOsc); allNodes.push(octOsc, octG);
      const fifthOsc = c.createOscillator(); fifthOsc.type = 'sine';
      fifthOsc.frequency.setValueAtTime(freq * Math.pow(2, 7/12), now);
      const fifthG = c.createGain(); fifthG.gain.value = stroke.flavor === 'saw' ? 0.03 : 0.04;  // was 0.08
      fifthOsc.connect(fifthG); fifthG.connect(envelope);
      fifthOsc.start(now);
      if (!isDrone) fifthOsc.stop(endTime + 1);
      harmonicOscs.push(fifthOsc); allNodes.push(fifthOsc, fifthG);
    }

    if (isDrone) {
      const droneAtk = Math.max(0.015, AudioEngine.mapAttackSec(this.mod.envAttack));
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(vol, now + Math.max(0.01, droneAtk));
    } else if (locked) {
      const { attack, release, sustain } = this.getEnvParams(stroke.flavor);
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(vol, now + attack);
      envelope.gain.setValueAtTime(vol * sustain, now + attack + 0.05);
      envelope.gain.setValueAtTime(vol * sustain, now + dur - release);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + dur);
    } else {
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

    const flavorBus = this.flavorBusGains[stroke.flavor];
    if (flavorBus && !this.disconnectedBuses.has(stroke.flavor)) {
      flavorBus.gain.cancelScheduledValues(now);
      flavorBus.gain.setValueAtTime(this.flavorVolumes[stroke.flavor], now);
    }

    const sourceAmpGain = c.createGain();
    sourceAmpGain.gain.value = FLAVOR_SOURCE_AMPLITUDE[stroke.flavor];
    envelope.connect(sourceAmpGain);
    sourceAmpGain.connect(flavorGain);
    flavorGain.connect(panner);
    panner.connect(flavorBus || this.masterBus);
    allNodes.push(sourceAmpGain);

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

    [this.lfo1Gain, this.lfo2Gain].forEach((lg, i) => {
      const target = i === 0 ? this.mod.lfo1Target : this.mod.lfo2Target;
      const depth = i === 0 ? this.mod.lfo1Depth : this.mod.lfo2Depth;
      if (!lg || depth <= 0 || target !== 'PITCH') return;
      oscillators.forEach(o => { try { lg.connect(o.detune); } catch (_) {} });
      harmonicOscs.forEach(o => { try { lg.connect(o.detune); } catch (_) {} });
    });

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

    if (isDrone) {
      // nothing
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

  releaseStroke(id: string, fadeDuration?: number) {
    const s = this.activeSounds.get(id);
    if (!s || !this.ctx) return;
    s.locked = false;
    s.isReleasing = true;
    if (s.loopTimeout) clearTimeout(s.loopTimeout);
    if (s.pulseInterval) { clearInterval(s.pulseInterval); s.pulseInterval = undefined; }
    const now = this.ctx.currentTime;
    const fade = fadeDuration ?? AudioEngine.mapReleaseSec(this.mod.envRelease);
    // cancelScheduledValues freezes param at current COMPUTED value (not intrinsic param.value).
    // setTargetAtTime from that frozen value — works even if we're mid-attack (value > 0).
    s.envelope.gain.cancelScheduledValues(now);
    s.envelope.gain.setTargetAtTime(0.0001, now, Math.max(0.05, fade / 5));
    s.cleanupTimeout = setTimeout(() => this.removeStroke(id), fade * 1000 + 200);
  }

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
    const ids = this.strokePool.map(s => s.id);
    ids.forEach(id => this.removeStroke(id));
    this.checkResonance();
  }

  toggleMute(id: string) {
    const s = this.activeSounds.get(id);
    if (s && this.ctx) {
      s.muted = !s.muted;
      const now = this.ctx.currentTime;
      s.flavorGain.gain.cancelScheduledValues(now);
      s.flavorGain.gain.setTargetAtTime(s.muted ? 0.02 : 1, now, 0.03);
    }
  }

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

  private getEnvParams(_f: SoundFlavor) {
    const attack = AudioEngine.mapAttackSec(this.mod.envAttack);
    const release = AudioEngine.mapReleaseSec(this.mod.envRelease);
    return { attack, release, sustain: 0.8 };
  }

  private mapYToFreq(y: number) {
    if (this.scaleTable.length > 0) {
      const h = window.innerHeight;
      const normalized = 1 - (y / h);
      const index = Math.round(normalized * (this.scaleTable.length - 1));
      const clamped = Math.max(0, Math.min(this.scaleTable.length - 1, index));
      return this.scaleTable[clamped].freq;
    }
    return 55 * Math.pow(880/55, 1 - y/window.innerHeight);
  }
  private mapLengthToDur(l: number) { return 4 + Math.min(l/800, 1) * 4; }
  private mapSpeedToVol(s: number) { return 0.12 + Math.min(s/15, 1) * 0.25; }

  // ─────────────────────────────────────────────────────────────────────────
  // startLiveStroke
  //
  // Signal chain: sources → envelope → liveFilter → sourceAmpGain → ...
  // (envelope gates signal BEFORE liveFilter to prevent filter-state transients)
  //
  // Onset click fix:
  //   osc.start(now + 0.003) — 3ms offset from the envelope gain=0 anchor.
  //   Chrome processes audio in 128-sample blocks (~3ms at 44.1kHz). When
  //   osc.start(now) and setValueAtTime(0, now) land in the same block, the
  //   osc can produce 1 block of full-amplitude signal before the gain takes
  //   effect. Offsetting by 3ms guarantees the gain=0 event is in an earlier
  //   block than the first oscillator sample.
  // ─────────────────────────────────────────────────────────────────────────
  startLiveStroke(id: string, freq: number, flavor: SoundFlavor, panX: number, yPosition?: number): string | null {
    if (!this.ctx || !this.masterBus) return null;

    if (this.flavorVolumes[flavor] === 0 || this.disconnectedBuses.has(flavor)) return null;

    const evictedId = this.evictOldest();
    const c = this.ctx;
    const now = c.currentTime;
    const vol = 0.15;

    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0, now);
    const liveAttack = Math.max(0.015, AudioEngine.mapAttackSec(this.mod.envAttack));
    envelope.gain.linearRampToValueAtTime(vol, now + liveAttack);

    const flavorGain = c.createGain();
    flavorGain.gain.value = 1;

    // Per-stroke local filter: horizontal velocity modulates cutoff
    const liveFilter = c.createBiquadFilter();
    liveFilter.type = 'lowpass';
    liveFilter.frequency.setValueAtTime(18000, now);  // fully open — transparent at startup
    liveFilter.Q.setValueAtTime(0.1, now);            // no resonance — eliminates filter-state transient

    const panner = c.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, panX * 2 - 1)), now);

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
        const surgeG = c.createGain(); surgeG.gain.value = 0.4 * 0.65;  // noiseMul 2.5→0.65
        surgeNs.connect(surgeLP); surgeLP.connect(surgeG); surgeG.connect(envelope);
        allNodes.push(surgeNs, surgeLP, surgeG);
      }
      if (surfNs) {
        surfNs.loop = true; surfNs.start(now);
        const surfBP = c.createBiquadFilter(); surfBP.type = 'bandpass'; surfBP.frequency.value = 1200; surfBP.Q.value = 0.6;
        const surfG = c.createGain(); surfG.gain.value = 0.3 * 0.65;  // noiseMul 2.5→0.65
        surfNs.connect(surfBP); surfBP.connect(surfG); surfG.connect(envelope);
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
        sinePeak.type = 'peaking'; sinePeak.frequency.value = 2000; sinePeak.gain.value = 1.5; sinePeak.Q.value = 0.8;  // was +3dB
        osc.connect(sinePeak); oscOut = sinePeak; allNodes.push(sinePeak);
      }
      if (flavor === 'sub') {
        const subShelf = c.createBiquadFilter();
        subShelf.type = 'lowshelf'; subShelf.frequency.value = 200; subShelf.gain.value = 2;  // was +4dB
        osc.connect(subShelf); oscOut = subShelf; allNodes.push(subShelf);
      }
      if (oscOut === osc) osc.connect(envelope); else oscOut.connect(envelope);
      // ── ONSET CLICK FIX ──
      // Start 3ms after 'now'. The envelope gain=0 anchor is scheduled at 'now'.
      // Chrome audio blocks are ~128 samples (~3ms). If osc.start(now) and
      // setValueAtTime(0, now) are in the same block, the oscillator emits
      // 1 block at full amplitude before the gain takes effect → audible click.
      // The 3ms offset pushes the osc start into the NEXT block, after the
      // gain=0 is guaranteed to be in effect.
      osc.start(now + 0.003);
      oscillators.push(osc);
      allNodes.push(osc);
    }

    const flavorBus = this.flavorBusGains[flavor];
    if (flavorBus && !this.disconnectedBuses.has(flavor)) {
      flavorBus.gain.cancelScheduledValues(now);
      flavorBus.gain.setValueAtTime(this.flavorVolumes[flavor], now);
    }

    // Chain: sources → envelope → liveFilter → sourceAmpGain → flavorGain → panner → flavorBus
    const sourceAmpGain = c.createGain();
    sourceAmpGain.gain.value = FLAVOR_SOURCE_AMPLITUDE[flavor];
    envelope.connect(liveFilter);
    liveFilter.connect(sourceAmpGain);
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
    const now = this.ctx.currentTime;

    if (s.liveFilter) {
      const cutoff = 400 + Math.min(params.hVelocity / 800, 1) * 7600;
      s.liveFilter.frequency.setTargetAtTime(cutoff, now, 0.05);
    }

    const vol = (0.1 + Math.min(params.pointerVelocity / 1200, 1) * 0.25);
    s.targetVol = vol;  // keep targetVol in sync — finalizeLiveStroke reads it
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
      oGain.gain.linearRampToValueAtTime(0.15, now + 0.2);  // was 0.3 — bypassed envelope
      // Route through envelope (not liveFilter directly) so harmonics
      // follow volume modulation and don't bypass the gain envelope.
      oOsc.connect(oGain); oGain.connect(s.envelope);
      oOsc.start(now);
      s.liveOctaveOsc = oOsc; s.liveOctaveGain = oGain;
      s.allNodes.push(oOsc, oGain);
      s.harmonicOscs?.push(oOsc);
    }

    if (params.accLength > 200 && !s.liveFifthOsc) {
      const fOsc = c.createOscillator(); fOsc.type = 'sine';
      fOsc.frequency.setValueAtTime(s.baseFrequency * Math.pow(2, 7 / 12), now);
      const fGain = c.createGain(); fGain.gain.setValueAtTime(0, now);
      fGain.gain.linearRampToValueAtTime(0.04, now + 0.2);  // was 0.2
      fOsc.connect(fGain); fGain.connect(s.envelope);
      fOsc.start(now);
      s.liveFifthOsc = fOsc; s.liveFifthGain = fGain;
      s.allNodes.push(fOsc, fGain);
      s.harmonicOscs?.push(fOsc);
    }

    if (params.accLength > 300 && !s.live2ndOctaveOsc) {
      const o2 = c.createOscillator(); o2.type = 'sine';
      o2.frequency.setValueAtTime(s.baseFrequency * 4, now);
      const o2G = c.createGain(); o2G.gain.setValueAtTime(0, now);
      o2G.gain.linearRampToValueAtTime(0.02, now + 0.2);  // was 0.15
      o2.connect(o2G); o2G.connect(s.envelope);
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

    if (mode === 'drone') {
      s.locked = true;
      s.isDrone = true;
      // Don't read param.value (intrinsic, not computed).
      // Let the attack ramp complete naturally — it will reach targetVol.
      // Anchor at targetVol right after attack completes so gain stays frozen.
      const targetVol = s.targetVol ?? 0.15;
      const liveAtk = Math.max(0.015, AudioEngine.mapAttackSec(this.mod.envAttack));
      const holdAt = Math.max(now + 0.005, s.startTime + liveAtk + 0.01);
      s.envelope.gain.setValueAtTime(targetVol, holdAt);
      // No cancelScheduledValues — let the attack ramp run to completion
    } else if (mode === 'pulse') {
      s.locked = true;
      const curVol = s.targetVol ?? 0.15;
      this.startPulseEnvelope(s, curVol);
    } else if (locked) {
      s.locked = true;
      const dur = (60 / this.mod.tempo) * 4;
      s.duration = dur;
      const { release } = this.getEnvParams(s.flavor);
      // cancelScheduledValues freezes envelope at current COMPUTED value
      // (whatever modulateLiveStroke left it at — could be 0.35, not 0.15).
      // setTargetAtTime approaches 0 starting at (dur - release), effectively
      // holding at the frozen value and then fading. No setValueAtTime anchor
      // needed — avoids any jump.
      s.envelope.gain.cancelScheduledValues(now);
      const releaseStart = Math.max(now + 0.1, now + dur - release);
      s.envelope.gain.setTargetAtTime(0.0001, releaseStart, Math.max(0.05, release / 4));
      s.loopTimeout = setTimeout(() => {
        const ss = this.activeSounds.get(id);
        if (ss?.locked && ss.strokeData && this.ctx) {
          this.removeStroke(id);
          this.playStroke(ss.strokeData, id + '_loop', true, ss.quantizedFreq);
        }
      }, dur * 1000);
    } else {
      // Gate release — unlocked, not drone, not pulse.
      //
      // ROOT CAUSE OF THE CUT (definitive):
      //   modulateLiveStroke does setTargetAtTime(vol, t, 0.05) on every pointer-move.
      //   tc=0.05s means the gain takes ~250ms (5*tc) to converge to the target.
      //   If the user releases 10ms after the last modulate call, the COMPUTED gain
      //   is only ~18% of targetVol (e.g., 0.036 when targetVol=0.2).
      //   Any approach that starts the fade from the computed value (cancelScheduledValues
      //   then fade) effectively fades from ~0 → imperceptible → sounds like a cut.
      //
      // FIX:
      //   1. cancelScheduledValues(now) — stops all pending automation
      //   2. setTargetAtTime(peakVol, now, 0.01) — fast 10ms tc approach to tracked peak.
      //      Gain rises smoothly from current ~0 to peakVol without a step-pop.
      //      At 5*tc = 50ms, gain is 99.3% of peakVol — inaudible approach time.
      //   3. setTargetAtTime(0.0001, now+0.06, fadeTc) — audible fade from peak.
      //      Starts 60ms after release (after step 2 has converged), fades to silence.
      //
      // Result: always audible release regardless of when the pointer was lifted.
      const { release } = this.getEnvParams(s.flavor);
      const fadeTc = Math.max(0.2, release / 3);
      const peakVol = s.targetVol ?? 0.15;
      s.envelope.gain.cancelScheduledValues(now);
      s.envelope.gain.setTargetAtTime(peakVol, now, 0.01);         // fast rise to peak (no pop)
      s.envelope.gain.setTargetAtTime(0.0001, now + 0.06, fadeTc); // audible fade to silence
      // Cleanup: 60ms approach + fadeTc*6 covers decay to 0.25% of peak
      const totalMs = (0.06 + fadeTc * 6 + 0.4) * 1000;
      s.cleanupTimeout = setTimeout(() => this.removeStroke(id), totalMs);
    }
  }

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
      const atkTime = Math.min(AudioEngine.mapAttackSec(this.mod.envAttack), onDur * 0.4);
      const relTime = Math.min(AudioEngine.mapReleaseSec(this.mod.envRelease), onDur * 0.5);
      const holdEnd = Math.max(atkTime, onDur - relTime);

      s.envelope.gain.cancelScheduledValues(now);
      s.envelope.gain.setValueAtTime(0.001, now);
      s.envelope.gain.linearRampToValueAtTime(peakVol, now + atkTime);
      if (holdEnd > atkTime) {
        s.envelope.gain.setValueAtTime(peakVol, now + holdEnd);
      }
      s.envelope.gain.linearRampToValueAtTime(0.001, now + onDur);
    };

    schedulePulse();
    const beatMs = (60 / this.mod.tempo) * 1000;
    s.pulseInterval = setInterval(schedulePulse, beatMs);
  }

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
    this.grainCloudNodes.forEach(n => {
      try { if ('stop' in n && typeof (n as any).stop === 'function') (n as any).stop(); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    });
    this.grainCloudNodes = [];
  }

  private restartGrainCloud() {
    if (!this.grainCloudActive) return;
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
    const dur = 2;
    const len = Math.floor(rate * dur);
    const buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);

    const freq = this.rootFrequency;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
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
      const grainDurMs = 20 + (this.mod.grainSize / 500) * 380;
      const grainDur = grainDurMs / 1000;

      const maxOffset = Math.max(0, buf.duration - grainDur);
      const startOffset = this.mod.grainScatter * Math.random() * maxOffset;

      const pitchVar = (Math.random() - 0.5) * 2 * this.mod.grainPitchSpread;
      const playbackRate = Math.pow(2, pitchVar / 12);

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

      const env = this.ctx.createGain();
      const rampTime = grainDur * 0.3;
      const grainPeakAmp = 0.3 * 1.3;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(grainPeakAmp, now + rampTime);
      env.gain.setValueAtTime(grainPeakAmp, now + grainDur - rampTime);
      env.gain.linearRampToValueAtTime(0, now + grainDur);

      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime((Math.random() - 0.5) * 1.4, now);

      source.connect(env);
      env.connect(panner);
      panner.connect(this.grainCloudGain!);

      source.start(now, startOffset, grainDur + 0.01);

      this.grainCloudNodes.push(source, env, panner);

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

    const intervalMs = Math.max(16, 1000 / Math.max(4, Math.min(60, this.mod.grainDensity)));
    this.grainCloudInterval = setInterval(spawnGrain, intervalMs);
    spawnGrain();
  }

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

  // ─── Recording ───────────────────────────────────────────────────────────
  startRecording(): void {
    if (!this.ctx || !this.analyzer) return;
    if (this.mediaRecorder?.state === 'recording') return;

    this.recordingStreamDest = this.ctx.createMediaStreamDestination();
    this.analyzer.connect(this.recordingStreamDest);

    this.recordingChunks = [];
    this.mediaRecorder = new MediaRecorder(this.recordingStreamDest.stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordingChunks.push(e.data);
    };

    this.mediaRecorder.start(100);
  }

  stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No active recording'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordingChunks, { type: 'audio/webm' });
        this.recordingChunks = [];

        if (this.recordingStreamDest && this.analyzer) {
          try { this.analyzer.disconnect(this.recordingStreamDest); } catch (_) {}
          this.recordingStreamDest = null;
        }

        resolve(blob);
      };

      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    });
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }
}