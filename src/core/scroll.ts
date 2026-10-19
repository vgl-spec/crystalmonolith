// Virtual scroll for the endless loop. The page never scrolls natively: wheel, touch and keyboard
// input move a `target` that accumulates without bound, and `current` chases it with exponential
// smoothing. The loop wraps at the chapter map's length; `absolute` keeps the unwrapped distance so
// the scene can tell which way the visitor crossed the seam.
import { resolvePosition, wrapPosition, type ChapterMap, type ScrollState } from '../contracts';

// Measured on the reference (docs/experience-spec.md): a 300 px wheel notch peaks at ~0.5 s and has
// settled by ~2.4 s, a deliberately heavy, floaty feel. For an exponential chase 2.4 s is about four
// time constants, so TAU = 0.6 s reproduces it. Reduced motion keeps the scroll but drops the float.
const SMOOTHING_TAU = 0.6;
const SMOOTHING_TAU_REDUCED = 0.15;
/** Smooths the reported velocity so the sound and the aberration do not flicker with frame jitter. */
const VELOCITY_TAU = 0.08;
/** Below this gap `current` snaps onto `target`, so a settled scroll is exactly still. */
const SETTLE_EPSILON = 0.05;

const LINE_HEIGHT_PX = 16;
/** A single trackpad or free-spin wheel event can report thousands of px; clamp so one flick stays sane. */
const WHEEL_EVENT_LIMIT = 400;

const TOUCH_GAIN = 1.6;
/** Time constant of the release fling, in seconds. */
const FLING_TAU = 0.4;
/** A finger that paused this long before lifting does not fling. */
const FLING_MAX_IDLE_MS = 100;
/** Weight of the newest touchmove in the fling velocity estimate. */
const FLING_VELOCITY_BLEND = 0.4;
const FLING_STOP_SPEED = 1;

const KEY_STEP = 300;
const KEY_PAGE_STEP = 800;
/** The loop starts on the hero by definition (buildChapterMap lays it first). */
const HERO_START = 0;

/** Keys on these elements already mean something (activate, type, move a caret); leave them alone. */
const KEY_OWNING_TARGETS = 'button, a[href], input, select, textarea, [contenteditable]';

export interface ScrollOptions {
  reducedMotion: boolean;
  /** Starting position inside the loop, in virtual px. Defaults to the hero. */
  start?: number;
}

export interface ScrollController {
  /** Mutated in place by update(); the same object for the controller's whole life. */
  readonly state: ScrollState;
  update(dt: number): ScrollState;
  /** While locked all input is ignored (intro, open project panel). Smoothing keeps running. */
  setLocked(locked: boolean): void;
  setReducedMotion(reduced: boolean): void;
  /** Smoothly travels to a loop position by the shorter way round, or teleports when `immediate`. */
  jumpTo(position: number, immediate?: boolean): void;
  dispose(): void;
}

export function createScrollController(map: ChapterMap, options: ScrollOptions): ScrollController {
  const loop = map.loopLength;
  const startPosition = wrapPosition(options.start ?? HERO_START, loop);

  let reducedMotion = options.reducedMotion;
  let locked = false;
  let target = startPosition;
  let current = startPosition;
  let previousCurrent = startPosition;
  let velocity = 0;
  /** Extra px/s still being added to `target` after a touch release. */
  let flingVelocity = 0;

  const state: ScrollState = {
    chapter: 'hero',
    chapterProgress: 0,
    projectFloat: -1,
    position: startPosition,
    absolute: startPosition,
    velocity: 0,
  };

  function publish(): void {
    const resolved = resolvePosition(map, current);
    state.chapter = resolved.chapter;
    state.chapterProgress = resolved.chapterProgress;
    state.projectFloat = resolved.projectFloat;
    state.position = wrapPosition(current, loop);
    state.absolute = current;
    state.velocity = velocity;
  }

  function scrollBy(delta: number): void {
    target += delta;
    flingVelocity = 0;
  }

  // --- wheel ---------------------------------------------------------------------------------

  function wheelDeltaPx(event: WheelEvent): number {
    let delta = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= LINE_HEIGHT_PX;
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= window.innerHeight;
    return Math.max(-WHEEL_EVENT_LIMIT, Math.min(WHEEL_EVENT_LIMIT, delta));
  }

  function onWheel(event: WheelEvent): void {
    // Locked: leave the event alone so an open panel can scroll its own text. Ctrl+wheel is browser zoom.
    if (locked || event.ctrlKey) return;
    event.preventDefault();
    scrollBy(wheelDeltaPx(event));
  }

  // --- touch ---------------------------------------------------------------------------------

  let dragging = false;
  let lastTouchY = 0;
  let lastTouchTime = 0;
  let dragVelocity = 0;

  function onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    // A second finger means pinch-zoom: hand the gesture back to the browser.
    if (locked || event.touches.length !== 1 || touch === undefined) {
      dragging = false;
      return;
    }
    dragging = true;
    lastTouchY = touch.clientY;
    lastTouchTime = event.timeStamp;
    dragVelocity = 0;
    flingVelocity = 0;
  }

  function onTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!dragging || touch === undefined) return;
    if (event.touches.length !== 1) {
      dragging = false;
      return;
    }
    event.preventDefault();
    // Dragging the finger up moves forward through the loop, like pushing the page up.
    const delta = (lastTouchY - touch.clientY) * TOUCH_GAIN;
    const elapsed = (event.timeStamp - lastTouchTime) / 1000;
    if (elapsed > 0) dragVelocity += (delta / elapsed - dragVelocity) * FLING_VELOCITY_BLEND;
    lastTouchY = touch.clientY;
    lastTouchTime = event.timeStamp;
    target += delta;
  }

  function onTouchEnd(event: TouchEvent): void {
    if (!dragging) return;
    dragging = false;
    const idleMs = event.timeStamp - lastTouchTime;
    flingVelocity = idleMs > FLING_MAX_IDLE_MS ? 0 : dragVelocity;
  }

  // --- keyboard ------------------------------------------------------------------------------

  function keyStep(event: KeyboardEvent): number | null {
    switch (event.key) {
      case 'ArrowDown':
        return KEY_STEP;
      case 'ArrowUp':
        return -KEY_STEP;
      case 'PageDown':
        return KEY_PAGE_STEP;
      case 'PageUp':
        return -KEY_PAGE_STEP;
      case ' ':
        return event.shiftKey ? -KEY_PAGE_STEP : KEY_PAGE_STEP;
      default:
        // ArrowLeft/ArrowRight are deliberately absent: the links carousel owns them.
        return null;
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (locked || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest(KEY_OWNING_TARGETS) !== null) return;

    if (event.key === 'Home') {
      event.preventDefault();
      jumpTo(HERO_START);
      return;
    }
    const step = keyStep(event);
    if (step === null) return;
    event.preventDefault();
    scrollBy(step);
  }

  // --- public --------------------------------------------------------------------------------

  function jumpTo(position: number, immediate = false): void {
    if (!Number.isFinite(position)) return;
    flingVelocity = 0;
    if (immediate) {
      // Stay in the current lap so a deep link on load keeps `absolute` non-negative.
      target = Math.floor(target / loop) * loop + wrapPosition(position, loop);
      current = target;
      previousCurrent = current;
      velocity = 0;
      publish();
      return;
    }
    const forward = wrapPosition(position - target, loop);
    target += forward > loop / 2 ? forward - loop : forward;
  }

  function update(dt: number): ScrollState {
    if (dt <= 0) return state;

    if (flingVelocity !== 0) {
      target += flingVelocity * dt;
      flingVelocity *= Math.exp(-dt / FLING_TAU);
      if (Math.abs(flingVelocity) < FLING_STOP_SPEED) flingVelocity = 0;
    }

    const gap = target - current;
    const tau = reducedMotion ? SMOOTHING_TAU_REDUCED : SMOOTHING_TAU;
    current = Math.abs(gap) < SETTLE_EPSILON ? target : current + gap * (1 - Math.exp(-dt / tau));

    const instantVelocity = (current - previousCurrent) / dt;
    previousCurrent = current;
    velocity += (instantVelocity - velocity) * (1 - Math.exp(-dt / VELOCITY_TAU));
    if (current === target && Math.abs(velocity) < FLING_STOP_SPEED) velocity = 0;

    publish();
    return state;
  }

  publish();

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });

  return {
    state,
    update,
    setLocked(value) {
      locked = value;
      if (locked) {
        // A drag or fling in flight must not carry on behind an opened panel.
        dragging = false;
        flingVelocity = 0;
      }
    },
    setReducedMotion(reduced) {
      reducedMotion = reduced;
    },
    jumpTo,
    dispose() {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    },
  };
}
