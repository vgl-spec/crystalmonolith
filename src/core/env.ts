// What the visitor's device can and prefers: WebGL2, reduced motion, and the starting quality tier.
import type { QualityTier } from '../contracts';

/** True when a WebGL2 context can be created. The probe context is released straight away. */
export function supportsWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return false;
    // The page is allowed one live context; free the probe's slot before the renderer asks for its own.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export interface ReducedMotionWatch {
  /** Live value of the prefers-reduced-motion media query. */
  readonly reduced: boolean;
  onChange(listener: (reduced: boolean) => void): void;
  dispose(): void;
}

export function watchReducedMotion(): ReducedMotionWatch {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new Set<(reduced: boolean) => void>();
  const handleChange = (event: MediaQueryListEvent): void => {
    for (const listener of listeners) listener(event.matches);
  };
  query.addEventListener('change', handleChange);

  return {
    get reduced() {
      return query.matches;
    },
    onChange(listener) {
      listeners.add(listener);
    },
    dispose() {
      query.removeEventListener('change', handleChange);
      listeners.clear();
    },
  };
}

// navigator.deviceMemory is Chromium-only and not in lib.dom.
interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

const SMALL_SCREEN_PX = 768;
const WEAK_MEMORY_GB = 2;
const WEAK_CORE_COUNT = 4;

/**
 * Picks the starting tier from cheap hints; the scene still drops a tier on its own if the frame rate
 * sags. A constrained device (touch, or a phone-sized screen) starts at medium, and at low when it is
 * also short on memory or cores.
 */
export function detectQuality(override: QualityTier | null): QualityTier {
  if (override !== null) return override;

  const { deviceMemory } = navigator as NavigatorWithMemory;
  const weak =
    (deviceMemory !== undefined && deviceMemory <= WEAK_MEMORY_GB) ||
    (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= WEAK_CORE_COUNT);
  // The physical screen, not the window: a narrow desktop window should not downgrade the visuals.
  const constrained =
    window.matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < SMALL_SCREEN_PX;

  if (weak && constrained) return 'low';
  return weak || constrained ? 'medium' : 'high';
}
