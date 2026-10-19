// The one place that reads the viewport size. Per-frame code reads the cached numbers; layout is
// only asked a question inside the resize handler.

const GUTTER_MIN = 16;
const GUTTER_MAX = 50;
const GUTTER_PER_VIEWPORT_WIDTH = 0.034;

export interface Viewport {
  width: number;
  height: number;
  /** Space kept clear at every screen edge, in CSS px. Also published to the stylesheet as --gutter. */
  gutter: number;
}

export interface ViewportTracker {
  /** Mutated in place on resize, so holders of this reference always see the current size. */
  readonly viewport: Viewport;
  dispose(): void;
}

export function trackViewport(root: HTMLElement): ViewportTracker {
  const viewport: Viewport = { width: 0, height: 0, gutter: GUTTER_MIN };

  const measure = (): void => {
    viewport.width = window.innerWidth;
    viewport.height = window.innerHeight;
    viewport.gutter = Math.round(Math.min(GUTTER_MAX, Math.max(GUTTER_MIN, viewport.width * GUTTER_PER_VIEWPORT_WIDTH)));
    // The stylesheet's corners and the JS clamping must agree on the gutter, so JS owns the number.
    root.style.setProperty('--gutter', `${viewport.gutter}px`);
  };

  measure();
  window.addEventListener('resize', measure);
  return {
    viewport,
    dispose() {
      window.removeEventListener('resize', measure);
    },
  };
}

/** How far a span [start, start + size) sticks out of [gutter, limit - gutter]; 0 when it fits. */
export function overflowOf(start: number, size: number, limit: number, gutter: number): number {
  return Math.max(0, gutter - start) + Math.max(0, start + size - (limit - gutter));
}
