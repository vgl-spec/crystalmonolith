// The hero world: everything that lives above ground and the air around it. The engine adds each
// module's root to the scene and updates them in this order, so the atmosphere (which publishes
// the shared fog state) must come first.
import type { SceneContext, SceneModule } from '../../contracts';
import { createAtmosphere } from './atmosphere';
import { createBrackets } from './brackets';
import { createDust } from './dust';
import { createIntroExtras } from './intro-extras';
import { createLandscape } from './landscape';
import { createMist } from './mist';
import { createMonolith, type MonolithModule } from './monolith';
import { createRidges } from './ridges';
import { createSky } from './sky';
import { createStreaks } from './streaks';
import { createTerrain } from './terrain';

const LANDSCAPE_SEED = 7;

export interface World {
  /** In update order. */
  modules: SceneModule[];
  monolith: MonolithModule;
}

export function createWorld(ctx: SceneContext): World {
  const atmosphere = createAtmosphere(ctx);
  const landscape = createLandscape(LANDSCAPE_SEED);
  const monolith = createMonolith(ctx);

  return {
    monolith,
    modules: [
      atmosphere,
      createSky(ctx, atmosphere.state),
      createTerrain(ctx, landscape, atmosphere.state),
      createRidges(),
      createMist(ctx, atmosphere.state),
      monolith,
      createBrackets(ctx, monolith.crystal),
      createDust(ctx),
      createIntroExtras(),
      createStreaks(ctx),
    ],
  };
}
