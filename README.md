# FORMLESS

**Draw sound. Hear your gesture.**

FORMLESS is a gesture-based ambient music instrument built for the web. Instead of pressing keys or turning knobs, you draw strokes on a canvas — each gesture becomes a living sound. The shape, speed, direction, and position of your drawing directly shape the timbre, pitch, and character of what you hear.

Built as a submission for the Figma Make Hackathon (Category #1: Creative use of new interaction).

---

## Concept

Most music software separates composition from performance. FORMLESS collapses that distinction. Drawing *is* composition. Every stroke is both a visual mark and an audio event — the canvas becomes a score, and the score is always playing.

The instrument is designed for ambient, drone, and textural music. It rewards slow exploration over rapid input.

---

## Features

### Eight Sound Generators (Flavors)

Each flavor has a distinct synthesis architecture, visual trail style, and color:

| Flavor | Character | Synthesis |
|--------|-----------|-----------|
| **SINE** | Pure, clean tone | Sine oscillator + 2kHz presence boost |
| **SAW** | Warm analog string | Dual detuned sawtooth + lowpass 1200Hz |
| **SUB** | Deep bass texture | Sine at -1 octave + low shelf boost |
| **GRAIN** | Granular scatter | Per-grain oscillators with windowed envelopes |
| **NOISE** | Ocean wave texture | Three-layer pink/white noise synthesis |
| **METAL** | Inharmonic bell | FM synthesis with 3.73× inharmonic ratio |
| **FLUTTER** | Warbling tone | Triangle oscillator with dual LFO detuning |
| **CRYSTAL** | Shimmer harmonics | 6 harmonic partial oscillators with shimmer |

### Three Play Modes

- **GATE** — Strokes sound while you draw, then fade with natural release
- **PULSE** — Strokes repeat rhythmically at the current tempo with configurable attack/release
- **DRONE** — Strokes sustain indefinitely until cleared, building layered textures

### Musical Pitch System

- **Root note** selector (12 chromatic pitches)
- **Scale** selector (10 scales: Chromatic, Minor, Major, Pentatonic, Dorian, Phrygian, Lydian, Locrian, Whole Tone, Diminished)
- **Octave** selector (6 octaves, direct access)
- Vertical canvas position maps to scale degrees across 3 octaves
- Live retune: changing root or scale glides all active drone strokes to new pitches over 300ms

### Sound Sculptor Panel

A comprehensive per-section FX panel with Reset and Randomize per section:

**DYNAMICS** — Volume, Tempo, Drift, Attack/Release envelope with visual display, Pulse controls

**FILTER** — Cutoff, Resonance, Drive with 6 filter types: LP, HP, BP, NOTCH, LADDER (4-pole with feedback), SEM (allpass blend)

**MODULATION** — Chorus (2 LFOs), Phaser (4 allpass filters), Flanger, Detune/Spread

**SPACE** — 6 reverb types with unique impulse responses:
- ROOM (1.2s), HALL (6s concert hall with early reflections and stereo width)
- GRANULAR (fragmented grain reverb), LOFI (bit-crush + wow/flutter)
- SPATIAL (frequency-split L/R with slow rotation), MASSIVE (8s cathedral bloom)
- Delay with time, feedback, mix

**GRANULAR CLOUD** — Independent ambient texture generator with density, scatter, pitch spread, freeze and reverse

**LFO 1 & 2** — Independent low-frequency oscillators with 6 shapes, 6 targets, BPM sync

### Real-Time Gesture Modulation

While drawing, your gesture modulates sound in real time:
- Horizontal velocity → per-stroke filter cutoff
- Drawing speed → envelope gain (fast = louder)
- Direction changes → pitch glide ±1 scale degree
- Stroke length accumulation → progressive harmonic layering (octave at 100px, fifth at 200px, second octave at 300px)

### Oscilloscope

Live waveform display connected post-chain, with 3-pass glow rendering and reactive color, amplitude, and line thickness.

---

## Audio Architecture

```
Stroke sources (max 16 voices)
  → source amplitude gain (per-flavor intrinsic level)
  → envelope gain (attack/release)
  → flavor ducking gain (voice management)
  → stereo panner
  → flavor bus gain (user fader)
  → [SAW/METAL: tanh soft clipper]
  → per-flavor limiter (brick-wall DynamicsCompressor)
  → master bus
  → BiquadFilter (LP/HP/BP/NOTCH/LADDER/SEM)
  → Delay (with feedback loop)
  → Reverb (ConvolverNode, 6 types)
  → Chorus (2 modulated delays)
  → Phaser (4 allpass filters with LFO)
  → Flanger (short delay + feedback)
  → Stereo Panner (LFO target)
  → Master Volume
  → High-Shelf EQ (-4dB @ 6kHz)
  → Compressor (transparent, 2:1 ratio)
  → Output Gain (0.92)
  → Soft Clipper (tanh waveshaper)
  → Analyser (oscilloscope tap)
  → Destination
```

All FX nodes instantiated **once on load** and shared across all voices. Maximum 16 simultaneous voices with oldest-first eviction and soft ducking above 12 voices.

---

## Design System

- **Dark theme:** `#08080E` background, `#00FFD1` teal accent, monospaced typography throughout
- **Light theme:** `#E8E4DC` warm cream, `#00897B` deeper teal, CRT effect disabled for performance
- **CRT overlay:** CSS scanlines, crawling band, phosphor vignette (dark mode only)
- **Per-flavor colors:** Each sound generator has a unique color applied to both the canvas trail and UI active states
- All colors use CSS custom properties for instant theme switching with 300ms transitions

---

## Running Locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in a Chromium-based browser for best Web Audio API performance.

---

## Tech Stack

- **React** + **TypeScript** (Vite)
- **Web Audio API** — all synthesis and signal processing
- **Canvas API** — stroke rendering and oscilloscope
- **Pointer Events API** — unified mouse/touch/stylus input with pointer capture
- **CSS Custom Properties** — theme system
- Built and iterated using **Figma Make**

---

## Browser Support

| Browser | Status |
|---------|--------|
| Chrome / Edge | ✅ Full support |
| Firefox | ✅ Full support |
| Safari | ⚠️ Partial (Web Audio API differences) |
| Mobile | 🔜 Coming soon |
| Tablet | ✅ Touch optimized |

---

## Hackathon Context

Submitted to the **Figma Make Hackathon** under Category #1: Creative use of new interaction patterns.

The core design argument: in ambient and drone music, the gesture that creates sound *is* the composition. There is no separation between performance interface and score. FORMLESS is an attempt to make that idea literal — every mark you leave on the canvas is simultaneously visual art and music.

---

## Project Structure

```
src/
  components/
    DrawingCanvas.tsx       # Stroke capture, rendering, gesture modulation
    ModulatorPanel.tsx      # Sound Sculptor FX panel
    FlavorSelector.tsx      # Sound generator selector + per-flavor faders
    ScaleSelector.tsx       # Root / Scale / Octave selectors
    WaveformVisualizer.tsx  # Oscilloscope component
    EnvelopeDisplay.tsx     # Attack/Release visual envelope
  utils/
    audioEngine.ts          # Complete Web Audio API engine
    flavorColors.ts         # Per-flavor color palettes (dark + light)
```

---

## License

MIT

---

*FORMLESS — draw without form, hear without effort.*
