import { clamp01, h } from './dom';
import { prefersReducedMotion } from './motion';

const CELLS = 20;
/** Higher = the bar catches up to the real progress faster. */
const EASE_RATE = 8;
/** If the tab is backgrounded the easing loop pauses; finishing must not wait on it. */
const FINISH_TIMEOUT_MS = 1000;
const FADE_MS = 600;
const FLICKER_MS = 280;

export interface Preloader {
  setProgress(progress: number): void;
  /** Completes the bar, flickers, fades; resolves once the screen behind is fully visible. */
  finish(): Promise<void>;
  dispose(): void;
}

const barText = (shown: number): string => {
  const filled = Math.round(shown * CELLS);
  const percent = String(Math.round(shown * 100)).padStart(3, '0');
  return `[${'='.repeat(filled)}${'-'.repeat(CELLS - filled)}] ${percent}%`;
};

export function createPreloader(parent: HTMLElement): Preloader {
  const root = h('div', 'preloader', { role: 'progressbar', 'aria-label': 'Loading', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' });
  const bar = h('p', 'preloader__bar', { 'aria-hidden': 'true' });
  root.append(bar);
  parent.append(root);

  // The bar only ever moves forward: real loaders report out of order and a bar that steps back reads as a bug.
  let target = 0;
  let shown = 0;
  let lastText = '';
  let lastAnnounced = -1;
  let lastTime = performance.now();
  let rafId = 0;
  let finishPromise: Promise<void> | null = null;
  let onFull: (() => void) | null = null;

  const paint = (): void => {
    const text = barText(shown);
    if (text !== lastText) {
      lastText = text;
      bar.textContent = text;
    }
    // Assistive tech hears 10% steps, not 100 updates.
    const announced = Math.floor(shown * 10) * 10;
    if (announced !== lastAnnounced) {
      lastAnnounced = announced;
      root.setAttribute('aria-valuenow', String(announced));
    }
  };

  const step = (now: number): void => {
    // rAF timestamps can precede the performance.now() taken at creation, so dt is clamped from below too.
    const dt = Math.max(0, Math.min(0.1, (now - lastTime) / 1000));
    lastTime = now;
    shown += (target - shown) * (1 - Math.exp(-dt * EASE_RATE));
    if (target - shown < 0.0005) shown = target;
    paint();
    if (shown >= 1 && onFull) {
      onFull();
      return;
    }
    rafId = requestAnimationFrame(step);
  };

  paint();
  rafId = requestAnimationFrame(step);

  const finish = async (): Promise<void> => {
    target = 1;
    const full = new Promise<void>((resolve) => {
      onFull = resolve;
    });
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, FINISH_TIMEOUT_MS));
    await Promise.race([full, timeout]);
    cancelAnimationFrame(rafId);
    shown = 1;
    paint();

    const reduced = prefersReducedMotion();
    if (!reduced) {
      await root.animate({ opacity: [1, 0.15, 1, 0.45, 1, 0.1, 1] }, { duration: FLICKER_MS }).finished;
    }
    await root.animate({ opacity: [1, 0] }, { duration: reduced ? 200 : FADE_MS, easing: 'ease-out', fill: 'forwards' }).finished;
    root.remove();
  };

  return {
    setProgress(progress) {
      if (Number.isFinite(progress)) target = Math.max(target, clamp01(progress));
    },
    finish() {
      finishPromise ??= finish();
      return finishPromise;
    },
    dispose() {
      cancelAnimationFrame(rafId);
      root.remove();
    },
  };
}
