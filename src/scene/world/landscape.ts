// The shape of the ground, as one pure height function shared by everything that sits on it
// (terrain mesh, dust, anything placed on the surface). Seeded, so it is identical every visit.
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { smoothstep } from '../engine/curves';
import { createRandom } from '../engine/random';

/** Radius around the monolith that stays almost flat, so it stands on solid ground. */
const FLAT_RADIUS = 8;
/** Radius by which the ground has risen to full rolling hills. */
const HILLS_RADIUS = 30;

export interface Landscape {
  heightAt(x: number, z: number): number;
}

export function createLandscape(seed: number): Landscape {
  const noise = new SimplexNoise({ random: createRandom(seed) });

  return {
    heightAt(x, z) {
      const r = Math.hypot(x, z);
      const rise = smoothstep(FLAT_RADIUS, HILLS_RADIUS, r);
      const far = smoothstep(26, 72, r);

      const rolling = noise.noise(x * 0.05 + 11, z * 0.05 - 4) * 0.5 + 0.5;
      const grit = noise.noise(x * 0.22, z * 0.22) * 0.5 + noise.noise(x * 0.55, z * 0.55) * 0.12;
      // Ridged noise: 1 - |n| folds the noise into sharp crest lines, the basalt-ridge look.
      const ridge = Math.pow(1 - Math.abs(noise.noise(x * 0.021 - 9, z * 0.021 + 5)), 2.4);

      let h = rise * (rolling * 2.6 + grit * 0.6) + far * ridge * 7.5;
      h += (1 - rise) * grit * 0.07;
      // The rim of the plane sinks so its edge is always buried in mist.
      h -= smoothstep(84, 108, r) * 9;
      return h;
    },
  };
}
