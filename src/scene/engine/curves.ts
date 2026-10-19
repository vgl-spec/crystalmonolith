// Small pure easing and interpolation helpers shared by the camera rig, post-processing and the
// world modules, so every chapter beat is written with the same vocabulary.

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep with the edges swapped in, so it also works for falling ramps. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

/** A key of a piecewise curve: [progress, value]. */
export type CurveKey = readonly [number, number];

/**
 * Samples a piecewise curve whose keys are sorted by progress. Segments are smoothstepped so
 * values ease into every key instead of changing slope sharply at it.
 */
export function sampleKeys(keys: readonly CurveKey[], t: number): number {
  const first = keys[0]!;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const next = keys[i]!;
    if (t <= next[0]) {
      const prev = keys[i - 1]!;
      return lerp(prev[1], next[1], smoothstep(prev[0], next[0], t));
    }
  }
  return keys[keys.length - 1]![1];
}
