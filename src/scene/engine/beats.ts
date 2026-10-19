// Timing constants and beat curves that more than one system must agree on. The camera cut, the
// flash and the monolith rebuild all hinge on the same return-chapter moments, so they live here
// once instead of being repeated as magic numbers.
import type { FrameState } from '../../contracts';
import { clamp01, smoothstep } from './curves';

/** Return progress at which the camera cuts from the links view to the hero area. */
export const RETURN_CUT = 0.25;

/** Return progress at which the monolith segments begin flying back together. */
export const RETURN_ASSEMBLE_START = 0.3;

/** introProgress by which the camera has arrived at the hero framing. */
export const INTRO_CAMERA_END = 0.9;

/** introProgress from which the HUD constellation may attach to the monolith. */
export const INTRO_HUD_START = 0.85;

/**
 * Flash intensity 0..1 for the return chapter: a short build squared so it ignites late, exactly 1
 * at the cut, then a quick clear so the reassembling monolith is visible for most of the chapter.
 */
export function returnFlash(returnProgress: number): number {
  if (returnProgress < RETURN_CUT) {
    const build = smoothstep(0.14, RETURN_CUT, returnProgress);
    return build * build;
  }
  return 1 - smoothstep(RETURN_CUT, 0.37, returnProgress);
}

/** Ripple build-up before the cut: 0 at the start of return, 1 at the cut, gone by 0.5. */
export function returnRipple(returnProgress: number): number {
  if (returnProgress < RETURN_CUT) return clamp01(returnProgress / RETURN_CUT);
  return 1 - smoothstep(RETURN_CUT, 0.5, returnProgress);
}

/** Time for ambient animation (drifting mist, pulses, twinkle): frozen with reduced motion. */
export function idleTime(frame: FrameState): number {
  return frame.reducedMotion ? 0 : frame.time;
}

/** True while the hero stage (terrain, monolith, ridges) can be on screen. */
export function isHeroStageVisible(frame: FrameState): boolean {
  const { chapter, chapterProgress } = frame.scroll;
  switch (chapter) {
    case 'hero':
      return true;
    case 'descent':
      // The camera has sunk below the ground and the whiteout covers it from here on.
      return chapterProgress < 0.55;
    case 'return':
      return chapterProgress >= RETURN_CUT;
    default:
      return false;
  }
}
