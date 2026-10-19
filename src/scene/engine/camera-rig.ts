// The camera rig. The camera pose is a pure function of the FrameState: the same frame always
// yields the same pose, so scrubbing the scroll (or the lab sliders) in either direction replays
// the same shot and the loop wrap from return(1) to hero(0) is seamless by construction.
//
// Orientation is stored as yaw and pitch (Euler order YXZ) rather than a lookAt up-vector. That
// makes the straight-down portal shot well defined with no gimbal flip: pitch -90 degrees maps
// the camera's up vector to -Z by itself, and every blend between shots is a plain interpolation.
import * as THREE from 'three';
import { WORLD, type FrameState, type Vec3 } from '../../contracts';
import { INTRO_CAMERA_END, RETURN_CUT } from './beats';
import { framingFor } from './framing';
import { clamp01, easeInOutCubic, easeInOutSine, easeOutCubic, lerp, smoothstep } from './curves';

const PARALLAX_X = 0.35;
const PARALLAX_Y = 0.2;

/** The hero camera drifts this far toward the monolith over the hero chapter. */
const HERO_PUSH_IN = { y: -0.25, z: -1.6, targetY: -0.1 };

/** How far below the camera the view tilts at the midpoint of the descent. */
const DESCENT_TILT = 14;

/** Portal: the camera is on the Y axis, looking straight down, falling between these heights. */
const PORTAL_CAMERA_Y = { start: -95, end: -146 } as const;
/** Fraction of the portal chapter spent gliding from the projects shot into the top-down view. */
const PORTAL_ENTRY = 0.14;

/** Links: the swing from top-down to side view finishes at this chapter progress. */
const LINKS_SWING_END = 0.3;

const INTRO_START: { position: Vec3; target: Vec3 } = { position: [0, 2.8, 7.5], target: [0, 1.6, 0] };
/** After the cut the camera starts low and far, looking up at the scattered segments. */
const RETURN_START: { position: Vec3; target: Vec3 } = { position: [0, 1.8, 27], target: [0, 5, 0] };

/** Positions are cheaper to reason about as a centre plus a polar swing around it. */
interface Orbit {
  readonly centre: THREE.Vector3;
  readonly radiusStart: number;
  readonly radiusEnd: number;
  /** Angle from +Y toward +Z. */
  readonly tiltStart: number;
  readonly tiltEnd: number;
}

function orbitFromStations(topDown: { position: Vec3; target: Vec3 }, side: { position: Vec3; target: Vec3 }): Orbit {
  const centre = new THREE.Vector3(...topDown.target);
  const polar = (position: Vec3) => {
    const dy = position[1] - centre.y;
    const dz = position[2] - centre.z;
    return { radius: Math.hypot(dy, dz), tilt: Math.atan2(dz, dy) };
  };
  const start = polar(topDown.position);
  const end = polar(side.position);
  return { centre, radiusStart: start.radius, radiusEnd: end.radius, tiltStart: start.tilt, tiltEnd: end.tilt };
}

const LINKS_ORBIT = orbitFromStations(WORLD.links.cameraTopDown, WORLD.links.cameraSide);

/** A camera position and the point it looks at. */
class Pose {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();

  setStation(station: { position: Vec3; target: Vec3 }): this {
    this.position.set(...station.position);
    this.target.set(...station.target);
    return this;
  }

  mix(from: Pose, to: Pose, t: number): this {
    this.position.lerpVectors(from.position, to.position, t);
    this.target.lerpVectors(from.target, to.target, t);
    return this;
  }
}

export interface CameraRig {
  /** Sizes the camera's projection for the viewport: aspect, field of view and dolly distance. */
  setAspect(aspect: number): void;
  apply(frame: FrameState): void;
}

export function createCameraRig(camera: THREE.PerspectiveCamera): CameraRig {
  camera.rotation.order = 'YXZ';

  const pose = new Pose();
  const from = new Pose();
  const to = new Pose();
  let pullBack = 1;

  function heroPose(out: Pose, progress: number): void {
    out.setStation(WORLD.hero.camera);
    out.position.y += HERO_PUSH_IN.y * progress;
    out.position.z += HERO_PUSH_IN.z * progress;
    out.target.y += HERO_PUSH_IN.targetY * progress;
  }

  function linksPose(out: Pose, swing: number): void {
    const radius = lerp(LINKS_ORBIT.radiusStart, LINKS_ORBIT.radiusEnd, swing);
    const tilt = lerp(LINKS_ORBIT.tiltStart, LINKS_ORBIT.tiltEnd, swing);
    out.target.copy(LINKS_ORBIT.centre);
    out.position.set(LINKS_ORBIT.centre.x, LINKS_ORBIT.centre.y + radius * Math.cos(tilt), LINKS_ORBIT.centre.z + radius * Math.sin(tilt));
  }

  function chapterPose(frame: FrameState): void {
    const { chapter, chapterProgress: p } = frame.scroll;
    switch (chapter) {
      case 'hero':
        heroPose(pose, p);
        break;
      case 'descent':
        heroPose(from, 1);
        to.setStation(WORLD.projects.camera);
        pose.mix(from, to, easeInOutCubic(p));
        // Tilting down while sinking sells the fall; it levels out again as the shard slot arrives.
        pose.target.y -= DESCENT_TILT * Math.sin(Math.PI * p);
        break;
      case 'projects':
        pose.setStation(WORLD.projects.camera);
        break;
      case 'portal': {
        from.setStation(WORLD.projects.camera);
        const y = lerp(PORTAL_CAMERA_Y.start, PORTAL_CAMERA_Y.end, easeInOutSine(p));
        to.position.set(0, y, 0);
        to.target.set(0, y - 10, 0);
        pose.mix(from, to, smoothstep(0, PORTAL_ENTRY, p));
        break;
      }
      case 'links':
        linksPose(pose, easeInOutCubic(clamp01(p / LINKS_SWING_END)));
        break;
      case 'return':
        if (p < RETURN_CUT) {
          linksPose(pose, 1);
        } else {
          // Ends on the exact hero(0) pose, so wrapping to the hero chapter shows no seam.
          from.setStation(RETURN_START);
          heroPose(to, 0);
          pose.mix(from, to, easeOutCubic((p - RETURN_CUT) / (1 - RETURN_CUT)));
        }
        break;
    }
  }

  /** How much of the pointer parallax applies: 1 in the shots that hold still, 0 mid-move. */
  function parallaxWeight(frame: FrameState): number {
    const { chapter, chapterProgress: p } = frame.scroll;
    let weight = 1;
    switch (chapter) {
      case 'descent':
        weight = Math.max(1 - smoothstep(0, 0.3, p), smoothstep(0.7, 1, p));
        break;
      case 'portal':
        weight = 1 - smoothstep(0, PORTAL_ENTRY, p);
        break;
      case 'links':
        weight = smoothstep(LINKS_SWING_END, 0.6, p);
        break;
    }
    return weight * smoothstep(0.6, 1, frame.introProgress);
  }

  return {
    setAspect(aspect) {
      const framing = framingFor(aspect);
      camera.aspect = aspect;
      camera.fov = framing.fov;
      camera.updateProjectionMatrix();
      pullBack = framing.pullBack;
    },

    apply(frame) {
      chapterPose(frame);

      if (frame.introProgress < 1) {
        // The intro dolly lands on whatever the chapter shot is (the hero shot at scroll 0).
        const arrive = easeOutCubic(clamp01(frame.introProgress / INTRO_CAMERA_END));
        from.setStation(INTRO_START);
        pose.position.lerpVectors(from.position, pose.position, arrive);
        pose.target.lerpVectors(from.target, pose.target, arrive);
      }

      // Narrow screens dolly back along the line of sight, whatever the shot, so the subject fits.
      if (pullBack !== 1) pose.position.sub(pose.target).multiplyScalar(pullBack).add(pose.target);

      const parallax = parallaxWeight(frame);
      pose.position.x += frame.pointer.x * PARALLAX_X * parallax;
      pose.position.y += frame.pointer.y * PARALLAX_Y * parallax;

      camera.position.copy(pose.position);
      const dx = pose.target.x - pose.position.x;
      const dy = pose.target.y - pose.position.y;
      const dz = pose.target.z - pose.position.z;
      const horizontal = Math.hypot(dx, dz);
      // Straight down has no meaningful heading; pinning yaw to 0 keeps up = -Z at the portal.
      const yaw = horizontal < 1e-4 ? 0 : Math.atan2(-dx, -dz);
      camera.rotation.set(Math.atan2(dy, horizontal), yaw, 0);
    },
  };
}
