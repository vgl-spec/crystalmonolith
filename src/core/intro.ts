// The intro timeline clock. It only measures time; what the intro looks like belongs to the scene.

/** Seconds from the end of loading to the hero framing. */
export const INTRO_DURATION = 7;

export interface IntroClock {
  /** 0 until start() is called, then 0..1 linear over INTRO_DURATION; always 1 when skipped. */
  readonly progress: number;
  start(): void;
  update(dt: number): void;
}

export function createIntroClock(skip: boolean): IntroClock {
  let progress = skip ? 1 : 0;
  let started = false;

  return {
    get progress() {
      return progress;
    },
    start() {
      started = true;
    },
    // Driven by the frame's dt rather than wall time, so a backgrounded tab pauses the intro instead of skipping it.
    update(dt) {
      if (!started) return;
      progress = Math.min(1, progress + dt / INTRO_DURATION);
    },
  };
}
