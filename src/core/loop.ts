// The requestAnimationFrame driver: clamps dt, pauses while the tab is hidden and, on return, starts
// the clock afresh so the first frame never carries the whole time spent away.

/** Longest step the simulation may take; a stalled frame must not teleport the scroll or the camera. */
export const MAX_FRAME_DT = 0.1;
/** dt of the first frame after (re)starting, when there is no previous frame to measure against. */
const FIRST_FRAME_DT = 1 / 60;

export interface FrameLoop {
  start(): void;
  stop(): void;
}

/**
 * @param tick receives the clamped dt and `time`, the sum of all clamped steps (seconds the
 *   experience has actually run; time spent hidden does not count).
 * @param onError called once if `tick` throws; the loop has already stopped, so a broken frame
 *   cannot repeat 60 times a second.
 */
export function createFrameLoop(tick: (dt: number, time: number) => void, onError: (error: unknown) => void): FrameLoop {
  let running = false;
  /** 0 when no frame is scheduled. */
  let frameHandle = 0;
  let previousTimestamp: number | null = null;
  let time = 0;

  function schedule(): void {
    if (frameHandle === 0) frameHandle = requestAnimationFrame(onFrame);
  }

  function cancel(): void {
    if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }

  function onFrame(timestamp: number): void {
    frameHandle = 0;
    schedule();
    const dt = previousTimestamp === null ? FIRST_FRAME_DT : Math.min((timestamp - previousTimestamp) / 1000, MAX_FRAME_DT);
    previousTimestamp = timestamp;
    time += dt;
    try {
      tick(dt, time);
    } catch (error) {
      stop();
      onError(error);
    }
  }

  function onVisibilityChange(): void {
    if (document.hidden) {
      cancel();
    } else if (running) {
      previousTimestamp = null;
      schedule();
    }
  }

  function start(): void {
    if (running) return;
    running = true;
    previousTimestamp = null;
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!document.hidden) schedule();
  }

  function stop(): void {
    running = false;
    cancel();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  return { start, stop };
}
