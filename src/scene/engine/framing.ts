// Aspect-ratio framing. The vertical field of view is fixed at CAMERA_FOV, so on a narrow screen the
// horizontal view shrinks until the monolith overfills the frame and the bracket shards fall off
// the sides. Below a floor on the horizontal field of view we first widen the vertical angle (to a
// limit, since very wide lenses distort) and then pull the camera back along its line of sight.
// Desktop and tablet-landscape aspects are untouched.
import { CAMERA_FOV } from '../../contracts';

/**
 * tan of half the horizontal field of view that is always kept. 0.37 is about 41 degrees across,
 * enough for the monolith, both bracket shards and a margin; the 16:10 desktop view is about 60.
 */
const MIN_HALF_TAN_HORIZONTAL = 0.37;
/** Widest vertical field of view used before the camera starts to dolly back instead. */
const MAX_FOV = 60;

export interface Framing {
  /** Vertical field of view in degrees. */
  fov: number;
  /** Multiplier on the distance between the camera and what it looks at; 1 = the authored shot. */
  pullBack: number;
}

export function framingFor(aspect: number): Framing {
  const baseHalfTan = Math.tan((CAMERA_FOV * Math.PI) / 360);
  if (baseHalfTan * aspect >= MIN_HALF_TAN_HORIZONTAL) return { fov: CAMERA_FOV, pullBack: 1 };

  const maxHalfTan = Math.tan((MAX_FOV * Math.PI) / 360);
  const halfTan = Math.min(maxHalfTan, MIN_HALF_TAN_HORIZONTAL / aspect);
  return {
    fov: (2 * Math.atan(halfTan) * 180) / Math.PI,
    // Authored distances assumed baseHalfTan; the wider lens already shows halfTan / baseHalfTan
    // more, and the rest of the shortfall is made up by dollying back.
    pullBack: Math.max(1, MIN_HALF_TAN_HORIZONTAL / (halfTan * aspect)),
  };
}
