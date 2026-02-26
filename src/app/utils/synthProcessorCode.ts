// FORMLESS — AudioWorklet Synthesizer Processor
// Runs on the audio thread. One processor instance = one voice.
// Handles: per-flavor synthesis, ADSR envelope, live filter, source amplitude.
// Main thread communicates via MessagePort.

export const SYNTH_PROCESSOR_CODE = /* js */ `
'use strict';

// ═══════════════════════════════════════════
// NOISE GENERATORS (stateful, per-voice)
// ═══════════════════════════════════════════
class PinkNoise {
  constructor() { this.b0=0;this.b1=0;this.b2=0;this.b3=0;this.b4=0;this.b5=0;this.b6=0; }
  next() {
    const w = Math.random()*2-1;
    this.b0=.99886*this.b0+w*.0555179;
    this.b1=.99332*this.b1+w*.0750759;
    this.b2=.96900*this.b2+w*.1538520;
    this.b3=.86650*this.b3+w*.3104856;
    this.b4=.55000*this.b4+w*.5329522;
    this.b5=-.7616*this.b5-w*.0168980;
    const out = (this.b0+this.b1+this.b2+this.b3+this.b4+this.b5+this.b6+w*.5362)*.11;
    this.b6 = w*.115926;
    return out;
  }
}

// Simple 1-pole lowpass filter
class OnePoleLP {
  constructor(cutoff, sr) { this.state = 0; this.setCutoff(cutoff, sr); }
  setCutoff(freq, sr) { this.alpha = Math.min(1, 2 * Math.PI * freq / sr); }
  process(x) { this.state += this.alpha * (x - this.state); return this.state; }
}

// Simple 1-pole highpass filter
class OnePoleHP {
  constructor(cutoff, sr) { this.prevIn = 0; this.prevOut = 0; this.setCutoff(cutoff, sr); }
  setCutoff(freq, sr) { this.rc = 1 / (2 * Math.PI * freq); this.dt = 1 / sr; this.alpha = this.rc / (this.rc + this.dt); }
  process(x) { this.prevOut = this.alpha * (this.prevOut + x - this.prevIn); this.prevIn = x; return this.prevOut; }
}

// Biquad bandpass
class BiquadBP {
  constructor(freq, q, sr) { this.x1=0;this.x2=0;this.y1=0;this.y2=0; this.setParams(freq, q, sr); }
  setParams(freq, q, sr) {
    const w0 = 2*Math.PI*freq/sr;
    const alpha = Math.sin(w0)/(2*q);
    const b0 = alpha, b1 = 0, b2 = -alpha;
    const a0 = 1+alpha, a1 = -2*Math.cos(w0), a2 = 1-alpha;
    this.b0=b0/a0; this.b1=b1/a0; this.b2=b2/a0; this.a1=a1/a0; this.a2=a2/a0;
  }
  process(x) {
    const y = this.b0*x + this.b1*this.x1 + this.b2*this.x2 - this.a1*this.y1 - this.a2*this.y2;
    this.x2=this.x1; this.x1=x; this.y2=this.y1; this.y1=y;
    return y;
  }
}

// Biquad lowpass
class BiquadLP {
  constructor(freq, q, sr) { this.x1=0;this.x2=0;this.y1=0;this.y2=0; this.setParams(freq, q, sr); }
  setParams(freq, q, sr) {
    const w0 = 2*Math.PI*Math.min(freq, sr*0.49)/sr;
    const alpha = Math.sin(w0)/(2*Math.max(q, 0.001));
    const cosw = Math.cos(w0);
    const b0 = (1-cosw)/2, b1 = 1-cosw, b2 = (1-cosw)/2;
    const a0 = 1+alpha, a1 = -2*cosw, a2 = 1-alpha;
    this.b0=b0/a0; this.b1=b1/a0; this.b2=b2/a0; this.a1=a1/a0; this.a2=a2/a0;
  }
  process(x) {
    const y = this.b0*x + this.b1*this.x1 + this.b2*this.x2 - this.a1*this.y1 - this.a2*this.y2;
    this.x2=this.x1; this.x1=x; this.y2=this.y1; this.y1=y;
    return y;
  }
}

// Peaking EQ
class PeakingEQ {
  constructor(freq, q, gainDb, sr) { this.x1=0;this.x2=0;this.y1=0;this.y2=0; this.setParams(freq, q, gainDb, sr); }
  setParams(freq, q, gainDb, sr) {
    const A = Math.pow(10, gainDb/40);
    const w0 = 2*Math.PI*freq/sr;
    const alpha = Math.sin(w0)/(2*q);
    const a0 = 1 + alpha/A;
    this.b0 = (1 + alpha*A)/a0;
    this.b1 = (-2*Math.cos(w0))/a0;
    this.b2 = (1 - alpha*A)/a0;
    this.a1 = this.b1;
    this.a2 = (1 - alpha/A)/a0;
  }
  process(x) {
    const y = this.b0*x + this.b1*this.x1 + this.b2*this.x2 - this.a1*this.y1 - this.a2*this.y2;
    this.x2=this.x1; this.x1=x; this.y2=this.y1; this.y1=y;
    return y;
  }
}

// ═══════════════════════════════════════════
// ENVELOPE — sample-accurate ADSR
// ═══════════════════════════════════════════
class Envelope {
  constructor(attack, release, sustain, vol) {
    this.attack = Math.max(0.001, attack);
    this.release = Math.max(0.01, release);
    this.sustain = sustain;
    this.vol = vol;
    this.level = 0;
    this.state = 'attack'; // attack | sustain | release | done
    this.time = 0;
    this.releaseStart = 0;
    this.releaseLevel = 0;
  }

  setAttack(a) { this.attack = Math.max(0.001, a); }
  setRelease(r) { this.release = Math.max(0.01, r); }
  setVol(v) { this.vol = v; }

  startRelease(relTime) {
    if (this.state === 'done') return;
    this.state = 'release';
    this.release = Math.max(0.01, relTime);
    this.releaseStart = 0;
    this.releaseLevel = this.level;
  }

  tick(dt) {
    switch (this.state) {
      case 'attack':
        this.time += dt;
        this.level = Math.min(1, this.time / this.attack) * this.vol;
        if (this.time >= this.attack) {
          this.level = this.vol;
          this.state = 'sustain';
        }
        break;
      case 'sustain':
        this.level = this.vol * this.sustain;
        break;
      case 'release':
        this.releaseStart += dt;
        const t = this.releaseStart / this.release;
        if (t >= 1) {
          this.level = 0;
          this.state = 'done';
        } else {
          // Exponential release curve
          this.level = this.releaseLevel * Math.exp(-5 * t);
          if (this.level < 0.0001) { this.level = 0; this.state = 'done'; }
        }
        break;
      case 'done':
        this.level = 0;
        break;
    }
    return this.level;
  }

  isDone() { return this.state === 'done'; }
}

// ═══════════════════════════════════════════
// SYNTH VOICE PROCESSOR
// ═══════════════════════════════════════════
class SynthVoiceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = options.processorOptions || {};
    this.flavor = p.flavor || 'sine';
    this.freq = p.freq || 440;
    this.targetFreq = this.freq;
    this.pan = p.pan || 0;
    this.sourceAmp = p.sourceAmp || 0.5;
    this.isDrone = p.isDrone || false;
    this.sr = sampleRate;
    this.dt = 1 / sampleRate;
    this.done = false;

    // Envelope
    this.env = new Envelope(
      p.attack || 0.08,
      p.release || 0.8,
      p.sustain || 0.8,
      p.vol || 0.15
    );

    // Live filter (per-voice, for modulation during drawing)
    this.liveFilter = new BiquadLP(p.filterCutoff || 8000, 1, sampleRate);
    this.liveFilterCutoff = p.filterCutoff || 8000;

    // Phase accumulators
    this.phase = 0;
    this.phase2 = 0;
    this.modPhase = 0;
    this.lfoPhase = 0;

    // Frequency smoothing (for glide)
    this.freqSmooth = this.freq;
    this.freqGlideRate = 0.001; // per-sample smoothing coefficient

    // Flavor-specific init
    this._initFlavor(p);

    // Message handling
    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _initFlavor(p) {
    switch (this.flavor) {
      case 'sine':
        this.presenceEQ = new PeakingEQ(2000, 0.8, 3, this.sr);
        break;
      case 'saw':
        this.freq2 = this.freq * 1.004;
        this.mixGain = 0.10;
        break;
      case 'sub':
        this.actualFreq = this.freq * 0.5;
        this.hp = new OnePoleHP(30, this.sr);
        break;
      case 'grain': {
        // Granular: micro-oscillators with random scheduling
        this.grainPhases = [];
        this.grainTimer = 0;
        this.grainInterval = 0.02; // 50Hz grain rate
        this.grainSize = (p.grainSize || 120) / 1000;
        this.grainScatter = p.grainScatter || 0.3;
        this.grainPitchSpread = p.grainPitchSpread || 0;
        // Active micro-grains
        this.activeGrains = [];
        break;
      }
      case 'noise': {
        // Ocean texture: 3 layers
        this.pink = new PinkNoise();
        this.surgeLP = new BiquadLP(400, 1.8, this.sr);
        this.surfaceBP = new BiquadBP(1200, 0.6, this.sr);
        this.rumbleLP = new BiquadLP(80, 0.7, this.sr);
        this.surgeLfoPhase = 0;
        this.surfaceLfoPhase = 0;
        const yNorm = (p.yPosition || 0.5);
        this.surgeBase = 0.45 * 2.5;
        this.surfaceGain = (0.25 + (1-yNorm) * 0.35) * 2.5;
        this.rumbleGain = (0.15 + yNorm * 0.25) * 2.5;
        break;
      }
      case 'metal':
        this.modRatio = 3.73;
        this.modDepth = this.freq * 0.4;
        this.carrierPhase = 0;
        break;
      case 'flutter':
        this.wowLfoPhase = 0;
        this.flutLfoPhase = 0;
        break;
      case 'crystal': {
        this.harmonics = [
          { ratio: 1, amp: 1, phase: 0, shimFreq: 0.5 + Math.random() * 2, shimAmp: 3, shimPhase: 0 },
          { ratio: 2, amp: 0.5, phase: 0, shimFreq: 0.5 + Math.random() * 2, shimAmp: 5, shimPhase: 0 },
          { ratio: 3, amp: 0.3, phase: 0, shimFreq: 0.5 + Math.random() * 2, shimAmp: 7, shimPhase: 0 },
          { ratio: 4.02, amp: 0.15, phase: 0, shimFreq: 0.5 + Math.random() * 2, shimAmp: 9, shimPhase: 0 },
          { ratio: 5.98, amp: 0.1, phase: 0, shimFreq: 0.5 + Math.random() * 2, shimAmp: 11, shimPhase: 0 },
          { ratio: 8.01, amp: 0.07, phase: 0, shimFreq: 0.5 + Math.random() * 2, shimAmp: 13, shimPhase: 0 },
        ];
        break;
      }
    }

    // Progressive harmonics for non-noise flavors (added during live drawing)
    this.hasOctave = false;
    this.hasFifth = false;
    this.has2ndOctave = false;
    this.octavePhase = 0;
    this.fifthPhase = 0;
    this.octave2Phase = 0;
    this.octaveGain = 0;
    this.fifthGain = 0;
    this.octave2Gain = 0;
    this.octaveGainTarget = 0;
    this.fifthGainTarget = 0;
    this.octave2GainTarget = 0;

    // Drift LFO
    this.driftPhase = 0;
    this.driftFreq = 0.05 + Math.random() * 0.1;
    this.driftAmount = 8; // cents
  }

  _handleMessage(data) {
    switch (data.type) {
      case 'setFreq':
        this.targetFreq = data.freq;
        if (this.flavor === 'sub') this.targetFreq = data.freq; // store original, actualFreq computed in render
        if (this.flavor === 'metal') this.modDepth = data.freq * 0.4;
        if (this.flavor === 'saw') this.freq2 = data.freq * 1.004;
        break;
      case 'setFilterCutoff':
        this.liveFilterCutoff = data.cutoff;
        this.liveFilter.setParams(data.cutoff, 1, this.sr);
        break;
      case 'setGain':
        this.env.setVol(data.vol);
        break;
      case 'startRelease':
        this.env.startRelease(data.releaseTime || 0.8);
        break;
      case 'freezeEnvelope':
        // Drone mode: hold at current level
        this.env.state = 'sustain';
        this.env.sustain = 1.0; // full sustain for drone
        break;
      case 'startPulse':
        this.pulseMode = true;
        this.pulseBeatDur = data.beatDur || 0.706;
        this.pulseLength = data.pulseLength || 0.5;
        this.pulseAttack = data.attack || 0.08;
        this.pulseRelease = data.release || 0.2;
        this.pulsePhase = 0;
        this.pulseVol = data.vol || 0.15;
        break;
      case 'updatePulse':
        if (this.pulseMode) {
          this.pulseBeatDur = data.beatDur || this.pulseBeatDur;
          this.pulseLength = data.pulseLength || this.pulseLength;
          this.pulseAttack = data.attack || this.pulseAttack;
          this.pulseRelease = data.release || this.pulseRelease;
        }
        break;
      case 'addHarmonic':
        if (data.harmonic === 'octave') { this.hasOctave = true; this.octaveGainTarget = data.gain || 0.3; }
        if (data.harmonic === 'fifth') { this.hasFifth = true; this.fifthGainTarget = data.gain || 0.2; }
        if (data.harmonic === '2ndOctave') { this.has2ndOctave = true; this.octave2GainTarget = data.gain || 0.15; }
        break;
      case 'setEnvParams':
        if (data.attack != null) this.env.setAttack(data.attack);
        if (data.release != null) this.env.setRelease(data.release);
        break;
      case 'retune':
        this.targetFreq = data.freq;
        this.freqGlideRate = data.glideRate || 0.001;
        if (this.flavor === 'metal') this.modDepth = data.freq * 0.4;
        if (this.flavor === 'saw') this.freq2 = data.freq * 1.004;
        break;
      case 'setDuck':
        this.duckGain = data.gain;
        break;
      case 'kill':
        this.done = true;
        break;
    }
  }

  // Soft tanh saturation
  _tanh(x) { return Math.tanh(x); }

  // ── Per-sample synthesis ──
  _synthesize() {
    const f = this.freqSmooth;
    const dt = this.dt;
    let sample = 0;

    switch (this.flavor) {
      case 'sine': {
        sample = Math.sin(this.phase * 2 * Math.PI);
        sample = this.presenceEQ.process(sample);
        this.phase += f * dt;
        if (this.phase > 1) this.phase -= 1;
        break;
      }
      case 'saw': {
        // Two detuned sawtooth waves
        const s1 = 2 * (this.phase % 1) - 1;
        const f2 = f * 1.004;
        const s2 = 2 * (this.phase2 % 1) - 1;
        sample = (s1 + s2) * this.mixGain;
        this.phase += f * dt;
        this.phase2 += f2 * dt;
        if (this.phase > 1) this.phase -= 1;
        if (this.phase2 > 1) this.phase2 -= 1;
        break;
      }
      case 'sub': {
        const subF = f * 0.5;
        sample = Math.sin(this.phase * 2 * Math.PI);
        sample = this.hp.process(sample);
        this.phase += subF * dt;
        if (this.phase > 1) this.phase -= 1;
        break;
      }
      case 'grain': {
        // Simplified granular: spawn micro-oscillators
        this.grainTimer += dt;
        if (this.grainTimer >= this.grainInterval) {
          this.grainTimer = 0;
          const gFreq = f * Math.pow(2, (Math.random()-0.5) * this.grainPitchSpread / 12);
          this.activeGrains.push({
            phase: 0,
            freq: gFreq,
            age: 0,
            dur: this.grainSize * (0.8 + Math.random() * 0.4),
            amp: 0.3 * 1.3,
            type: Math.random() < 0.33 ? 'tri' : 'sine',
          });
        }
        // Process active grains
        for (let i = this.activeGrains.length - 1; i >= 0; i--) {
          const g = this.activeGrains[i];
          g.age += dt;
          if (g.age >= g.dur) { this.activeGrains.splice(i, 1); continue; }
          // Hann window envelope
          const t = g.age / g.dur;
          const env = t < 0.3 ? t/0.3 : t > 0.7 ? (1-t)/0.3 : 1;
          let gs;
          if (g.type === 'tri') {
            gs = 4 * Math.abs((g.phase % 1) - 0.5) - 1;
          } else {
            gs = Math.sin(g.phase * 2 * Math.PI);
          }
          sample += gs * env * g.amp;
          g.phase += g.freq * dt;
          if (g.phase > 1) g.phase -= 1;
        }
        break;
      }
      case 'noise': {
        // Ocean texture: surge + surface + rumble
        const pink = this.pink.next();
        const white = Math.random() * 2 - 1;

        // Surge: pink → LP 400Hz, LFO modulated
        this.surgeLfoPhase += 0.12 * dt;
        const surgeMod = this.surgeBase * (1 + 0.6 * Math.sin(this.surgeLfoPhase * 2 * Math.PI));
        const surge = this.surgeLP.process(pink) * surgeMod;

        // Surface: white → BP 1200Hz, faster LFO
        this.surfaceLfoPhase += 0.7 * dt;
        const surfMod = this.surfaceGain * (1 + 0.4 * Math.sin(this.surfaceLfoPhase * 2 * Math.PI));
        const surface = this.surfaceBP.process(white) * surfMod;

        // Rumble: pink → LP 80Hz (slowed playback simulated by using pink directly)
        const rumble = this.rumbleLP.process(pink * 0.5) * this.rumbleGain;

        sample = surge + surface + rumble;
        break;
      }
      case 'metal': {
        // FM synthesis: modulator → carrier
        const modF = f * this.modRatio;
        const mod = Math.sin(this.modPhase * 2 * Math.PI) * this.modDepth;
        sample = Math.sin(this.carrierPhase * 2 * Math.PI);
        // Soft clamp
        sample = this._tanh(sample * 1.2);
        this.modPhase += modF * dt;
        this.carrierPhase += (f + mod) * dt;
        if (this.modPhase > 1) this.modPhase -= 1;
        if (this.carrierPhase > 1) this.carrierPhase -= 1;
        break;
      }
      case 'flutter': {
        // Triangle + wow/flutter LFOs on detune
        const wowDetune = Math.sin(this.wowLfoPhase * 2 * Math.PI) * 20; // cents
        const flutDetune = Math.sin(this.flutLfoPhase * 2 * Math.PI) * 5; // cents
        const totalDetune = wowDetune + flutDetune;
        const detuneRatio = Math.pow(2, totalDetune / 1200);
        const actualF = f * detuneRatio;
        // Triangle wave
        sample = 4 * Math.abs((this.phase % 1) - 0.5) - 1;
        // Soft saturation
        sample = this._tanh(sample * 1.5);
        this.phase += actualF * dt;
        if (this.phase > 1) this.phase -= 1;
        this.wowLfoPhase += 0.2 * dt;
        this.flutLfoPhase += 6 * dt;
        break;
      }
      case 'crystal': {
        // 6 harmonics with shimmer detune
        for (const h of this.harmonics) {
          const shimDetune = Math.sin(h.shimPhase * 2 * Math.PI) * h.shimAmp;
          const detuneRatio = Math.pow(2, shimDetune / 1200);
          const hFreq = f * h.ratio * detuneRatio;
          sample += Math.sin(h.phase * 2 * Math.PI) * h.amp;
          h.phase += hFreq * dt;
          if (h.phase > 1) h.phase -= 1;
          h.shimPhase += h.shimFreq * dt;
        }
        break;
      }
    }

    // ── Progressive harmonics (added during live drawing) ──
    if (this.flavor !== 'noise' && this.flavor !== 'grain') {
      if (this.hasOctave) {
        this.octaveGain += (this.octaveGainTarget - this.octaveGain) * 0.001;
        sample += Math.sin(this.octavePhase * 2 * Math.PI) * this.octaveGain;
        this.octavePhase += f * 2 * dt;
        if (this.octavePhase > 1) this.octavePhase -= 1;
      }
      if (this.hasFifth) {
        this.fifthGain += (this.fifthGainTarget - this.fifthGain) * 0.001;
        sample += Math.sin(this.fifthPhase * 2 * Math.PI) * this.fifthGain;
        this.fifthPhase += f * Math.pow(2, 7/12) * dt;
        if (this.fifthPhase > 1) this.fifthPhase -= 1;
      }
      if (this.has2ndOctave) {
        this.octave2Gain += (this.octave2GainTarget - this.octave2Gain) * 0.001;
        sample += Math.sin(this.octave2Phase * 2 * Math.PI) * this.octave2Gain;
        this.octave2Phase += f * 4 * dt;
        if (this.octave2Phase > 1) this.octave2Phase -= 1;
      }
    }

    // ── Pitch drift ──
    this.driftPhase += this.driftFreq * dt;
    const driftCents = Math.sin(this.driftPhase * 2 * Math.PI) * this.driftAmount;
    // Applied via frequency smoothing target
    const driftRatio = Math.pow(2, driftCents / 1200);
    const rawTarget = this.flavor === 'sub' ? this.targetFreq : this.targetFreq;
    this.freqSmooth += (rawTarget * driftRatio - this.freqSmooth) * this.freqGlideRate;

    return sample;
  }

  process(inputs, outputs, parameters) {
    if (this.done) return false;

    const output = outputs[0];
    const left = output[0];
    const right = output[1] || left;
    const blockSize = left.length;
    const dt = this.dt;

    for (let i = 0; i < blockSize; i++) {
      // Envelope
      let envLevel;
      if (this.pulseMode) {
        // Pulse envelope: rhythmic on/off
        this.pulsePhase += dt;
        if (this.pulsePhase >= this.pulseBeatDur) this.pulsePhase -= this.pulseBeatDur;
        const onDur = this.pulseBeatDur * this.pulseLength;
        const atk = Math.min(this.pulseAttack, onDur * 0.4);
        const rel = Math.min(this.pulseRelease, onDur * 0.5);
        const holdEnd = Math.max(atk, onDur - rel);
        const t = this.pulsePhase;
        if (t < atk) {
          envLevel = (t / atk) * this.pulseVol;
        } else if (t < holdEnd) {
          envLevel = this.pulseVol;
        } else if (t < onDur) {
          envLevel = this.pulseVol * Math.max(0, 1 - (t - holdEnd) / rel);
        } else {
          envLevel = 0;
        }
      } else {
        envLevel = this.env.tick(dt);
      }

      if (this.env.isDone() && !this.pulseMode) {
        this.done = true;
        this.port.postMessage({ type: 'done' });
        // Fill rest with silence
        for (let j = i; j < blockSize; j++) { left[j] = 0; if (right !== left) right[j] = 0; }
        return true;
      }

      // Synthesize
      let sample = this._synthesize();

      // Apply source amplitude
      sample *= this.sourceAmp;

      // Apply envelope
      sample *= envLevel;

      // Apply live filter
      sample = this.liveFilter.process(sample);

      // Apply duck gain
      if (this.duckGain != null) sample *= this.duckGain;

      // Stereo pan (constant power)
      const panAngle = this.pan * 0.5 * Math.PI * 0.5;
      const panL = Math.cos(panAngle + 0.25 * Math.PI);
      const panR = Math.sin(panAngle + 0.25 * Math.PI);

      left[i] = sample * panL;
      if (right !== left) right[i] = sample * panR;
    }

    return true;
  }
}

registerProcessor('synth-voice', SynthVoiceProcessor);
`;
