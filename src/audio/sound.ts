import type { ChapterId, CreateSound, SoundCue } from '../contracts';

// Everything is synthesised at runtime: no audio files, nothing to load, nothing to license.

const MASTER_VOLUME = 0.35;
/** setTargetAtTime time constant: ~95% of the way in three of these, so 0.2 s ramps in about 0.6 s. */
const MASTER_RAMP_TC = 0.2;
const SUSPEND_AFTER_MS = 900;
/** Ambient parameters are re-aimed at most this often; they glide, so per-frame updates would add nothing. */
const AMBIENT_UPDATE_S = 0.05;
const AMBIENT_GLIDE_TC = 0.35;
const HOVER_MIN_GAP_S = 0.06;
/** Scroll speed (virtual px/s) at which the wind is at full strength. */
const WIND_FULL_VELOCITY = 1500;

/** Pad lowpass cutoff per chapter: darker underground, brighter on the links platform. */
const CHAPTER_CUTOFF: Record<ChapterId, number> = {
  hero: 520,
  descent: 340,
  projects: 700,
  portal: 260,
  links: 900,
  return: 600,
};

/** A, E and the A above: an open fifth with an octave, detuned so the oscillators beat slowly. */
const PAD_VOICES = [
  { frequency: 55, detune: -7 },
  { frequency: 82.41, detune: 5 },
  { frequency: 110, detune: 9 },
] as const;

interface Graph {
  context: AudioContext;
  master: GainNode;
  cues: GainNode;
  padFilter: BiquadFilterNode;
  windGain: GainNode;
  windFilter: BiquadFilterNode;
  sources: AudioScheduledSourceNode[];
}

interface ToneSpec {
  type: OscillatorType;
  from: number;
  to?: number;
  duration: number;
  peak: number;
  attack?: number;
  delay?: number;
  /** Optional lowpass sweep, for the open and close cues. */
  filter?: { from: number; to: number };
}

function createNoiseBuffer(context: AudioContext): AudioBuffer {
  const length = context.sampleRate * 2;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function buildGraph(): Graph {
  const context = new AudioContext();

  // A compressor behind the master guards against stacked cues clipping.
  const limiter = context.createDynamicsCompressor();
  limiter.connect(context.destination);
  const master = context.createGain();
  master.gain.value = 0;
  master.connect(limiter);

  const ambient = context.createGain();
  ambient.connect(master);
  const cues = context.createGain();
  cues.connect(master);
  const sources: AudioScheduledSourceNode[] = [];

  // Pad: detuned oscillators through a lowpass whose cutoff breathes with a slow LFO.
  const padFilter = context.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = CHAPTER_CUTOFF.hero;
  padFilter.Q.value = 0.7;
  const padGain = context.createGain();
  padGain.gain.value = 0.11;
  padFilter.connect(padGain).connect(ambient);
  for (const voice of PAD_VOICES) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = voice.frequency;
    oscillator.detune.value = voice.detune;
    oscillator.connect(padFilter);
    oscillator.start();
    sources.push(oscillator);
  }
  const lfo = context.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = context.createGain();
  lfoDepth.gain.value = 140;
  lfo.connect(lfoDepth).connect(padFilter.frequency);
  lfo.start();
  sources.push(lfo);

  // Wind: looping noise, band-limited; its level and brightness follow the scroll speed.
  const noise = context.createBufferSource();
  noise.buffer = createNoiseBuffer(context);
  noise.loop = true;
  const windFilter = context.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 350;
  windFilter.Q.value = 0.5;
  const windGain = context.createGain();
  windGain.gain.value = 0.01;
  noise.connect(windFilter).connect(windGain).connect(ambient);
  noise.start();
  sources.push(noise);

  return { context, master, cues, padFilter, windGain, windFilter, sources };
}

export const createSound: CreateSound = () => {
  let graph: Graph | null = null;
  let wanted = false;
  let suspendTimer = 0;
  let lastHoverAt = Number.NEGATIVE_INFINITY;
  let lastChapter: ChapterId | null = null;
  let lastAmbientAt = Number.NEGATIVE_INFINITY;

  /** Plays one short enveloped tone and frees its nodes when it ends. */
  const tone = (spec: ToneSpec): void => {
    if (!graph || graph.context.state !== 'running') return;
    const { context, cues } = graph;
    const start = context.currentTime + (spec.delay ?? 0);
    const end = start + spec.duration;
    const attack = spec.attack ?? 0.005;

    const oscillator = context.createOscillator();
    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.from, start);
    if (spec.to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(spec.to, end);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(spec.peak, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);

    let tail: AudioNode = oscillator;
    if (spec.filter) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(spec.filter.from, start);
      filter.frequency.exponentialRampToValueAtTime(spec.filter.to, end);
      oscillator.connect(filter);
      tail = filter;
    }
    tail.connect(envelope).connect(cues);

    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
      if (tail !== oscillator) tail.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  };

  const CUES: Record<SoundCue, () => void> = {
    hover: () => {
      const now = graph?.context.currentTime ?? 0;
      if (now - lastHoverAt < HOVER_MIN_GAP_S) return;
      lastHoverAt = now;
      tone({ type: 'sine', from: 2600, to: 3400, duration: 0.05, peak: 0.05 });
    },
    click: () => {
      tone({ type: 'triangle', from: 880, to: 440, duration: 0.09, peak: 0.16 });
      tone({ type: 'sine', from: 1760, to: 1320, duration: 0.05, peak: 0.05 });
    },
    open: () => {
      tone({ type: 'sawtooth', from: 110, to: 880, duration: 0.7, peak: 0.12, attack: 0.15, filter: { from: 250, to: 3200 } });
      tone({ type: 'sine', from: 220, to: 1320, duration: 0.7, peak: 0.07, attack: 0.2 });
    },
    close: () => {
      tone({ type: 'sawtooth', from: 880, to: 110, duration: 0.55, peak: 0.1, attack: 0.04, filter: { from: 3000, to: 220 } });
      tone({ type: 'sine', from: 1100, to: 220, duration: 0.55, peak: 0.06, attack: 0.04 });
    },
    link: () => {
      [1320, 1760, 2637].forEach((frequency, i) => tone({ type: 'sine', from: frequency, duration: 0.45, peak: 0.05, attack: 0.01, delay: i * 0.045 }));
    },
    chapter: () => {
      tone({ type: 'sine', from: 96, to: 44, duration: 0.7, peak: 0.34, attack: 0.02 });
    },
  };

  const rampMaster = (target: number): void => {
    if (!graph) return;
    const { context, master } = graph;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(target, context.currentTime, MASTER_RAMP_TC);
  };

  const apply = async (): Promise<void> => {
    clearTimeout(suspendTimer);
    if (wanted) {
      try {
        graph ??= buildGraph();
        await graph.context.resume();
      } catch {
        // No Web Audio, or the browser refused: stay silent and report as off.
        wanted = false;
        return;
      }
      // The visitor may have toggled off while the context was resuming.
      if (wanted) rampMaster(MASTER_VOLUME);
      return;
    }
    if (!graph) return;
    rampMaster(0);
    // Once the fade has finished the context is suspended so it stops costing CPU.
    suspendTimer = window.setTimeout(() => {
      if (!wanted) void graph?.context.suspend();
    }, SUSPEND_AFTER_MS);
  };

  const onVisibility = (): void => {
    if (!graph || !wanted) return;
    if (document.hidden) void graph.context.suspend();
    else void graph.context.resume();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    get enabled() {
      return wanted;
    },

    setEnabled(enabled) {
      wanted = enabled;
      return apply();
    },

    update(frame) {
      if (!graph || !wanted || graph.context.state !== 'running') return;
      if (frame.time - lastAmbientAt < AMBIENT_UPDATE_S) return;
      lastAmbientAt = frame.time;

      const { context, padFilter, windGain, windFilter } = graph;
      const now = context.currentTime;
      const speed = Math.min(1, Math.abs(frame.scroll.velocity) / WIND_FULL_VELOCITY);
      windGain.gain.setTargetAtTime(0.012 + 0.32 * speed ** 1.2, now, AMBIENT_GLIDE_TC);
      windFilter.frequency.setTargetAtTime(350 + 1500 * speed, now, AMBIENT_GLIDE_TC);

      if (frame.scroll.chapter !== lastChapter) {
        lastChapter = frame.scroll.chapter;
        padFilter.frequency.setTargetAtTime(CHAPTER_CUTOFF[lastChapter], now, 1.2);
      }
    },

    cue(name) {
      if (wanted) CUES[name]();
    },

    dispose() {
      clearTimeout(suspendTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      wanted = false;
      if (!graph) return;
      for (const source of graph.sources) source.stop();
      void graph.context.close();
      graph = null;
    },
  };
};
