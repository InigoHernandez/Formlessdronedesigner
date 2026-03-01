# FORMLESS

> A gesture-driven ambient sound instrument for the browser.

Draw on the canvas. Each stroke becomes sound. The longer you draw, the richer it gets.

---

## What it is

FORMLESS is a web-based instrument where drawing gestures generate and modulate audio in real time. There are no buttons to press or sequences to program — every sound is a direct response to how you move.

Vertical position maps to pitch. Horizontal velocity shapes the filter. Stroke length grows harmonics. The shape of the gesture influences the envelope. It is designed to be played without knowing anything about synthesis.

---

## Features

### Drawing modes
- **Gate** — each stroke plays once and fades
- **Pulse** — strokes repeat on a tempo grid
- **Drone** — strokes sustain indefinitely until cleared

### Sound flavors
Eight synthesis engines, each with its own visual rendering:

| Flavor | Synthesis | Visual |
|--------|-----------|--------|
| SINE | Pure sine with 2kHz presence peak | Smooth glowing curve |
| SAW | Dual detuned sawtooth | Jagged zigzag line |
| SUB | Sine at half frequency + low shelf | Wide pulse breathing |
| GRAIN | Granular cloud or oscillator bank | Scattered particles |
| NOISE | Layered pink/white noise (ocean model) | Animated undulating wave |
| METAL | FM synthesis with inharmonic ratio 3.73x | Shard fragments |
| FLUTTER | Triangle with wow + flutter LFOs | Sinusoidal wave |
| CRYSTAL | 6-partial additive with shimmer | Diamond markers |

### Sound Sculptor panel
Per-section modulation controls with reset and randomize:

- **Dynamics** — master volume, tempo, drift, envelope attack/release
- **Filter** — cutoff, resonance, drive, type (LP / HP / BP / NOTCH / LADDER / SEM)
- **Modulation** — chorus, phaser, flanger, detune with spread
- **Space** — six reverb types (ROOM / HALL / GRANULAR / LOFI / SPATIAL / MASSIVE) + delay
- **Granular Cloud** — independent grain engine with size, scatter, density, pitch spread, freeze, reverse
- **LFO x2** — six shapes, six targets, tempo sync

### Scale system
Root note, scale type, and octave selectors with live retuning. Changing scale glides all active strokes to the nearest in-scale frequency over 300ms. Guide lines appear briefly on change.

Supported scales: Chromatic, Minor, Major, Pentatonic, Dorian, Phrygian, Lydian, Locrian, Whole Tone, Diminished.

### Other
- Light and dark themes
- Performance mode (hides all UI)
- Per-flavor volume faders
- Up to 24 simultaneous voices with automatic gain ducking
- Waveform oscilloscope display

---

## Audio engine

The signal chain runs entirely in the Web Audio API:

```
stroke sources → envelope → filter → sourceAmpGain → flavorGain (duck)
  → panner → flavorBus → [flavorLimiter] → masterBus
  → Filter → Delay → Reverb → Chorus → Phaser → Flanger
  → HighShelf → Compressor → OutputGain → SoftClipper → Destination
```

Key design decisions:

**Live stroke modulation** — while drawing, horizontal velocity controls a per-stroke lowpass filter, pointer velocity controls gain, and accumulated path length progressively adds harmonics (octave at 100px, fifth at 200px, second octave at 300px).

**Envelope scheduling** — all gain automation uses `setTargetAtTime` exclusively. `param.value` (intrinsic) is never read mid-automation; only scheduled values are used to avoid discontinuities when cancelling.

**Gate release** — on pointer up, a fast `setTargetAtTime(peak, now, 0.01)` rises to the tracked peak in ~50ms before the release fade. This guarantees an audible decay even when the pointer is released during the attack phase.

**Voice ducking** — gain reduction begins at 2 simultaneous voices, scaling linearly to 0.28 at 24 voices. Prevents the master bus from accumulating unchecked amplitude at high polyphony.

**SPATIAL reverb** — uses asymmetric early reflections (different timing per channel), a Haas delay of 12–28ms on the right channel, and a first-order all-pass filter at 800Hz for phase decorrelation. Both channels are RMS-normalized after processing to guarantee a centered image at any mix level.

---

## Tech stack

- **React** + **TypeScript** — UI and state
- **Web Audio API** — all synthesis and processing (no audio libraries)
- **Canvas 2D** — gesture rendering at 60fps (dark) / 30fps (light)
- **Tailwind CSS** — layout and utility classes
- **Vite** — build tooling

---

## Getting started

```bash
git clone https://github.com/yourname/formless
cd formless
npm install
npm run dev
```

Open `http://localhost:5173` and draw.

---

## Project structure

```
src/
├── components/
│   ├── DrawingCanvas.tsx      # Main canvas, pointer events, rendering loop
│   ├── ModulatorPanel.tsx     # Sound Sculptor sidebar
│   ├── FlavorSelector.tsx     # Flavor + per-flavor volume controls
│   ├── ScaleSelector.tsx      # Root / scale / octave pickers
│   ├── WaveformVisualizer.tsx # Oscilloscope display
│   ├── EnvelopeDisplay.tsx    # Attack/release visual
│   ├── AmbientGrid.tsx        # Background grid animation
│   ├── RadialPulse.tsx        # Stroke onset pulse visual
│   ├── CRTEffect.tsx          # Scanline overlay
│   └── ThemeContext.tsx       # Light/dark theme
├── utils/
│   ├── audioEngine.ts         # Web Audio synthesis engine
│   ├── strokeAnalyzer.ts      # Gesture analysis (speed, length, curvature)
│   └── flavorColors.ts        # Per-flavor color maps for both themes
```

---

## Browser support

Requires Web Audio API and Pointer Events — all modern browsers. Safari requires a user gesture before the audio context can start (a tap or click on the canvas will initialize it).

No mobile-specific layout at this time. Tablet input works well.

---

## License

MIT
