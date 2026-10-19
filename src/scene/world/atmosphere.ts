// Atmosphere: the exponential fog, its colour, and the scene lights. The fog is the single source
// of truth for "how misty is it right now"; the sky and the terrain read the shared state it
// publishes each frame instead of re-deriving chapter timing themselves.
import * as THREE from 'three';
import { PALETTE, type FrameState, type SceneContext, type SceneModule } from '../../contracts';
import { RETURN_CUT } from '../engine/beats';
import { sampleKeys, smoothstep, type CurveKey } from '../engine/curves';

/** Colours the sky and fog share, in linear working space. Hero mist is a lifted night navy. */
export const MIST_COLORS = {
  hero: new THREE.Color(PALETTE.deep).lerp(new THREE.Color(PALETTE.navy), 0.42),
  /** Luminous navy: the "whiteout" of the descent, the night version of the reference's snow fog. */
  whiteout: new THREE.Color('#0f3d60'),
  underworld: new THREE.Color(PALETTE.deep),
};

/** Per-frame atmosphere values other world modules read. Mutated in place, never reallocated. */
export interface AtmosphereState {
  density: number;
  /** 0..1 how deep the descent whiteout is. */
  whiteout: number;
  /** 0..1 how far the camera is in the dark world below the terrain. */
  underworld: number;
  /** 0..1 fades the terrain into the mist before the camera passes through it. */
  groundVeil: number;
  readonly color: THREE.Color;
}

export function createAtmosphereState(): AtmosphereState {
  return { density: 0.025, whiteout: 0, underworld: 0, groundVeil: 0, color: MIST_COLORS.hero.clone() };
}

const HERO_DENSITY = 0.025;

const DESCENT_DENSITY: readonly CurveKey[] = [[0, HERO_DENSITY], [0.22, 0.15], [0.55, 0.15], [1, 0.02]];
const DESCENT_WHITEOUT: readonly CurveKey[] = [[0, 0], [0.22, 1], [0.55, 1], [1, 0]];
const PORTAL_DENSITY: readonly CurveKey[] = [[0, 0.02], [0.1, 0.015], [1, 0.015]];
const LINKS_DENSITY: readonly CurveKey[] = [[0, 0.015], [0.15, 0.03], [1, 0.03]];
/** After the return cut the mist starts thick and clears while the monolith rebuilds. */
const RETURN_DENSITY: readonly CurveKey[] = [[RETURN_CUT, 0.045], [0.6, HERO_DENSITY], [1, HERO_DENSITY]];

/** Fills `out` for the given frame. Pure function of the frame, so it scrubs both ways. */
export function resolveAtmosphere(frame: FrameState, out: AtmosphereState): void {
  const { chapter, chapterProgress: p } = frame.scroll;
  let density = HERO_DENSITY;
  let whiteout = 0;
  let underworld = 0;
  let groundVeil = 0;

  switch (chapter) {
    case 'descent':
      density = sampleKeys(DESCENT_DENSITY, p);
      whiteout = sampleKeys(DESCENT_WHITEOUT, p);
      underworld = smoothstep(0.35, 1, p);
      groundVeil = smoothstep(0.08, 0.3, p);
      break;
    case 'projects':
      density = 0.02;
      underworld = 1;
      break;
    case 'portal':
      density = sampleKeys(PORTAL_DENSITY, p);
      underworld = 1;
      break;
    case 'links':
      density = sampleKeys(LINKS_DENSITY, p);
      underworld = 1;
      break;
    case 'return':
      if (p < RETURN_CUT) {
        density = 0.03;
        underworld = 1;
      } else {
        density = sampleKeys(RETURN_DENSITY, p);
        underworld = 1 - smoothstep(RETURN_CUT, 0.7, p);
      }
      break;
  }

  out.density = density;
  out.whiteout = whiteout;
  out.underworld = underworld;
  out.groundVeil = groundVeil;
  out.color.copy(MIST_COLORS.hero).lerp(MIST_COLORS.whiteout, whiteout).lerp(MIST_COLORS.underworld, underworld);
}

export interface AtmosphereModule extends SceneModule {
  readonly state: AtmosphereState;
}

export function createAtmosphere(ctx: SceneContext): AtmosphereModule {
  const state = createAtmosphereState();
  const fog = new THREE.FogExp2(state.color.getHex(), state.density);
  ctx.scene.fog = fog;

  const root = new THREE.Group();
  root.name = 'atmosphere';

  // Cool sky light from above, near-black ground bounce.
  const hemisphere = new THREE.HemisphereLight(0x3d6f9f, 0x04070b, 0.4);
  // A low moon behind the monolith rim-lights every crystal edge toward the camera.
  const moon = new THREE.DirectionalLight(0x9fcbff, 1.0);
  moon.position.set(-22, 26, -34);
  // A weak cyan fill from the camera side keeps the front facets from collapsing to black.
  const fill = new THREE.DirectionalLight(0x35b8e6, 0.4);
  fill.position.set(14, 7, 26);
  // A cool key from the upper left rakes across the facets so each plane catches a different shade.
  const key = new THREE.DirectionalLight(0x7fc4ff, 0.95);
  key.position.set(-14, 12, 18);
  root.add(hemisphere, moon, fill, key);

  return {
    root,
    state,
    async init() {},
    update(frame) {
      resolveAtmosphere(frame, state);
      fog.density = state.density;
      fog.color.copy(state.color);
    },
    dispose() {
      ctx.scene.fog = null;
    },
  };
}
