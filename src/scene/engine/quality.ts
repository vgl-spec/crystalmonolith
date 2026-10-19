// Adaptive quality. The governor measures real frame rate in fixed windows and steps the quality
// tier down when the device cannot keep up. It never steps back up within a session: a device that
// dipped once will dip again, and oscillating between tiers is worse than staying on the lower one.
//
// Only renderer-level settings change (pixel ratio, multisampling, bloom). Geometry is built once
// at the tier the scene started with, so a drop is instant and never triggers a rebuild hitch.
import type { QualityTier } from '../../contracts';

export interface TierSettings {
  /** Upper bound for the renderer pixel ratio. */
  pixelRatioCap: number;
  /** MSAA samples on the post-processing render targets. */
  samples: number;
  bloom: boolean;
}

export const TIER_SETTINGS: Record<QualityTier, TierSettings> = {
  high: { pixelRatioCap: 1.75, samples: 4, bloom: true },
  medium: { pixelRatioCap: 1.5, samples: 2, bloom: false },
  low: { pixelRatioCap: 1, samples: 0, bloom: false },
};

const LOWER_TIER: Record<QualityTier, QualityTier> = { high: 'medium', medium: 'low', low: 'low' };

const WINDOW_MS = 2000;
const MIN_FPS = 45;
/** A gap this long means the tab was hidden or the page stalled, not that rendering is slow. */
const STALL_MS = 1000;

export interface QualityGovernor {
  readonly tier: QualityTier;
  /** Call once per rendered frame with a monotonic timestamp in milliseconds. */
  observe(nowMs: number): void;
}

export function createQualityGovernor(initial: QualityTier, onChange: (tier: QualityTier) => void): QualityGovernor {
  let tier = initial;
  let windowStart = -1;
  let lastFrame = -1;
  let frames = 0;
  // The first window always contains shader uploads and first-draw buffer creation; judging the
  // device by it would downgrade every visitor.
  let warmingUp = true;

  return {
    get tier() {
      return tier;
    },
    observe(nowMs) {
      if (lastFrame >= 0 && nowMs - lastFrame > STALL_MS) windowStart = -1;
      lastFrame = nowMs;

      if (windowStart < 0) {
        windowStart = nowMs;
        frames = 0;
        return;
      }
      frames++;
      const elapsed = nowMs - windowStart;
      if (elapsed < WINDOW_MS) return;

      const fps = (frames * 1000) / elapsed;
      windowStart = nowMs;
      frames = 0;
      if (warmingUp) {
        warmingUp = false;
        return;
      }
      if (fps < MIN_FPS && tier !== 'low') {
        tier = LOWER_TIER[tier];
        onChange(tier);
      }
    },
  };
}
