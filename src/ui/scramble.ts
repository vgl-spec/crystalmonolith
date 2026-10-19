import { prefersReducedMotion } from './motion';

// ASCII only on purpose. The self-hosted font subset has no block-element glyphs, so those would
// fall back to another font with a different advance width and make the text reflow while it decodes.
const GLYPHS = '#/\\_-=+<>01ZX$%&*:;|~';
// Characters shown as noise ahead of the settled text; beyond that the text is still blank.
const NOISE_LEAD = 10;
// Glyph churn faster than this reads as static instead of a decode.
const PAINT_INTERVAL_MS = 40;
const BLANK = ' ';

const running = new WeakMap<HTMLElement, () => void>();

function frameText(text: string, progress: number): string {
  const settled = Math.floor(progress * text.length);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (i < settled || /\s/.test(char)) out += char;
    else if (i < settled + NOISE_LEAD) out += GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
    // A non-breaking space keeps the glyph's width, so line breaks fall where the final text breaks.
    else out += BLANK;
  }
  return out;
}

/**
 * Decodes `text` into `el` left to right over `durationMs`. Monospace type keeps every frame the
 * same width as the final text, so nothing reflows. A newer call on the same element supersedes
 * the older one; the older promise still resolves. Reduced motion writes the text immediately.
 */
export function scramble(el: HTMLElement, text: string, durationMs: number): Promise<void> {
  running.get(el)?.();
  if (prefersReducedMotion() || durationMs <= 0 || text.length === 0) {
    el.textContent = text;
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const startedAt = performance.now();
    let lastPaint = Number.NEGATIVE_INFINITY;
    let rafId = 0;

    running.set(el, () => {
      cancelAnimationFrame(rafId);
      resolve();
    });

    const tick = (now: number): void => {
      const progress = (now - startedAt) / durationMs;
      if (progress >= 1) {
        running.delete(el);
        el.textContent = text;
        resolve();
        return;
      }
      if (now - lastPaint >= PAINT_INTERVAL_MS) {
        lastPaint = now;
        el.textContent = frameText(text, progress);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });
}

/** Duration that keeps long paragraphs readable-fast: ~14 ms per character within a sane range. */
export function scrambleDuration(text: string): number {
  return Math.min(1400, Math.max(350, text.length * 14));
}
