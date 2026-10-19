// The hero: the Zelarion monolith. Eight faceted slices of dark crystal stacked into one ~6.5 unit
// tall obelisk with a cyan core. It has three lives, all pure functions of the frame state:
//   - intro: it crystallises bottom-to-top out of a hot dissolve edge,
//   - idle: the slices "breathe" apart in a staggered wave, lighting the seams between them,
//   - return: the slices start scattered through the sky and fly back together into the hero pose.
import * as THREE from 'three';
import type { FrameState, SceneContext, SceneModule } from '../../contracts';
import { RETURN_ASSEMBLE_START, isHeroStageVisible } from '../engine/beats';
import { clamp01, easeInOutSine, easeOutCubic, lerp } from '../engine/curves';
import { createRandom } from '../engine/random';
import {
  createCoreHaloMaterial,
  createCoreMaterial,
  createCrystalMaterial,
  createCrystalUniforms,
  createEdgeMaterial,
  dissolveFrontFor,
  type CrystalUniforms,
} from './crystal-material';
import { buildMonolithShape } from './monolith-geometry';

const SEED = 20260;

/** Seconds per breathing cycle, and the fraction of the cycle the lift is "active" for. */
const BREATHE_PERIOD = 6;
const BREATHE_ACTIVE = 0.55;
/** Phase delay between neighbouring seams, as a fraction of the cycle. */
const BREATHE_STAGGER = 0.04;
/** Maximum extra gap a seam opens, and the outward slide of a slice, in world units. */
const BREATHE_GAP = 0.14;
const BREATHE_RADIAL = 0.05;

/** The intro dissolve front sweeps between these world heights (noise bends it by ~0.65). */
const DISSOLVE_BOTTOM = -1.4;
const DISSOLVE_TOP = 8.8;

/** Hero anchor rays: [height on the monolith, sideways offset]. These feed the HUD constellation. */
const ANCHOR_RAYS: readonly (readonly [number, number])[] = [
  [1.3, -0.35],
  [2.7, 0.4],
  [3.9, -0.25],
  [5.1, 0.3],
  [6.0, 0.15],
];

/** Return chapter: each slice starts its flight this much later than the one below, and flies this long. */
const ASSEMBLE_STAGGER = 0.04;
const ASSEMBLE_DURATION = 0.34;

const SWAY_AMPLITUDE = 0.1;
const SWAY_SPEED = 0.16;

export interface MonolithModule extends SceneModule {
  /** Shared by the bracket shards so the whole hero dissolves and glows as one object. */
  readonly crystal: CrystalUniforms;
  /** Writes the five HUD anchor points into `out`. Valid once the frame has rendered. */
  getAnchorsWorld(out: THREE.Vector3[]): void;
}

interface SliceState {
  mesh: THREE.Mesh;
  rest: THREE.Vector3;
  /** The slice's small resting turn, so edges of neighbours do not line up. */
  restQuaternion: THREE.Quaternion;
  /** Horizontal direction the slice slides while breathing. */
  radial: THREE.Vector2;
  scatterPosition: THREE.Vector3;
  scatterQuaternion: THREE.Quaternion;
  spinAxis: THREE.Vector3;
  spinRate: number;
  seam: { value: number };
}

interface HeroAnchor {
  slice: number;
  /** Point on the slice surface in the slice's own space, so it rides the slice as it moves. */
  local: THREE.Vector3;
}

/** A 0 -> 1 -> 0 bump over the active part of the cycle, flat afterwards. */
function breatheBump(time: number, seamIndex: number): number {
  const phase = time / BREATHE_PERIOD - seamIndex * BREATHE_STAGGER;
  const t = (phase - Math.floor(phase)) / BREATHE_ACTIVE;
  if (t >= 1) return 0;
  const s = Math.sin(Math.PI * t);
  return s * s;
}

export function createMonolith(ctx: SceneContext): MonolithModule {
  const crystal = createCrystalUniforms();
  const root = new THREE.Group();
  root.name = 'monolith';
  // Sway rotates the body only, so the base light and anchors stay put relative to the ground.
  const body = new THREE.Group();
  body.name = 'monolith-body';
  root.add(body);

  const slices: SliceState[] = [];
  const anchors: HeroAnchor[] = [];
  const disposables: { dispose(): void }[] = [];
  /** openings[k] = how far the seam below slice k is open; 0 for the ground and above the tip. */
  let openings = new Float32Array(0);
  let core: THREE.Mesh | null = null;

  const coreMaterial = createCoreMaterial(crystal);
  const edgeMaterial = createEdgeMaterial(crystal);
  const haloMaterial = createCoreHaloMaterial(crystal);
  disposables.push(coreMaterial, haloMaterial, edgeMaterial);

  /** Finds exact surface points for the HUD by shooting rays at the assembled monolith. */
  function buildAnchors(): void {
    body.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    const meshes = slices.map((s) => s.mesh);
    const origin = new THREE.Vector3();
    const toward = new THREE.Vector3(0, 0, -1);
    for (const [height, sideways] of ANCHOR_RAYS) {
      origin.set(sideways, height, 12);
      raycaster.set(origin, toward);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      const slice = hit ? meshes.indexOf(hit.object as THREE.Mesh) : -1;
      if (hit && slice >= 0) {
        anchors.push({ slice, local: slices[slice]!.mesh.worldToLocal(hit.point.clone()) });
      } else {
        // A miss means the slice is narrower than the ray offset there: pin to the slice axis instead.
        const nearest = slices.reduce((best, s, i) => (Math.abs(s.rest.y - height) < Math.abs(slices[best]!.rest.y - height) ? i : best), 0);
        anchors.push({ slice: nearest, local: new THREE.Vector3(0, height - slices[nearest]!.rest.y, 0.4) });
      }
    }
  }

  return {
    root,
    crystal,

    async init() {
      const shape = buildMonolithShape(SEED);
      const random = createRandom(SEED + 1);

      shape.slices.forEach((slice, i) => {
        const seam = { value: 0 };
        const material = createCrystalMaterial(crystal, { environment: ctx.environment, seam });
        const edgeGeometry = new THREE.EdgesGeometry(slice.geometry, 18);
        disposables.push(material, slice.geometry, edgeGeometry);

        const mesh = new THREE.Mesh(slice.geometry, material);
        mesh.name = `monolith-slice-${i}`;
        mesh.position.copy(slice.restPosition);
        mesh.quaternion.copy(slice.restQuaternion);
        mesh.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));

        const slideAngle = random() * Math.PI * 2;
        const scatterAngle = random() * Math.PI * 2;
        const scatterRadius = 5 + random() * 6;
        slices.push({
          mesh,
          rest: slice.restPosition.clone(),
          restQuaternion: slice.restQuaternion.clone(),
          radial: new THREE.Vector2(Math.cos(slideAngle), Math.sin(slideAngle)),
          scatterPosition: new THREE.Vector3(Math.cos(scatterAngle) * scatterRadius, 3 + random() * 10, Math.sin(scatterAngle) * scatterRadius),
          scatterQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6.28, random() * 6.28, random() * 6.28)),
          spinAxis: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
          spinRate: (random() - 0.5) * 0.8,
          seam,
        });
        body.add(mesh);
      });

      // Tapers to a thread well below the tip so it stays inside the leaning body.
      const coreHeight = shape.height - 1.0;
      const coreGeometry = new THREE.CylinderGeometry(0.02, 0.14, coreHeight, 6, 1);
      disposables.push(coreGeometry);
      // Base at the origin of its own space, so scaling in Y grows the column upward from the ground.
      coreGeometry.translate(0, coreHeight / 2, 0);
      core = new THREE.Mesh(coreGeometry, coreMaterial);
      core.name = 'monolith-core';
      core.position.y = 0.1;

      const haloGeometry = new THREE.CylinderGeometry(0.1, 0.62, coreHeight, 8, 1, true);
      haloGeometry.translate(0, coreHeight / 2, 0);
      disposables.push(haloGeometry);
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      halo.name = 'monolith-core-halo';
      // Additive haze must draw before the glass slices, or their depth writes would hide it.
      halo.renderOrder = -1;
      core.add(halo);
      body.add(core);

      openings = new Float32Array(slices.length + 1);
      buildAnchors();
    },

    update(frame: FrameState) {
      root.visible = isHeroStageVisible(frame);
      if (!root.visible || !core) return;

      const { time, reducedMotion } = frame;
      const { chapter, chapterProgress } = frame.scroll;
      const count = slices.length;

      const crystallise = easeInOutSine(clamp01((frame.introProgress - 0.22) / 0.5));
      crystal.uDissolveFront.value = dissolveFrontFor(crystallise, DISSOLVE_BOTTOM, DISSOLVE_TOP);

      for (let k = 1; k < count; k++) {
        openings[k] = reducedMotion ? 0 : BREATHE_GAP * breatheBump(time, k);
      }

      const returning = chapter === 'return';
      let assembledSum = 0;
      let lift = 0;
      for (let i = 0; i < count; i++) {
        const slice = slices[i]!;
        const mesh = slice.mesh;
        lift += openings[i]!;

        const slide = reducedMotion ? 0 : BREATHE_RADIAL * breatheBump(time, i);
        const assembled = returning
          ? easeOutCubic(clamp01((chapterProgress - RETURN_ASSEMBLE_START - i * ASSEMBLE_STAGGER) / ASSEMBLE_DURATION))
          : 1;
        assembledSum += assembled;

        mesh.position.set(
          lerp(slice.scatterPosition.x, slice.rest.x + slice.radial.x * slide, assembled),
          lerp(slice.scatterPosition.y, slice.rest.y + lift, assembled),
          lerp(slice.scatterPosition.z, slice.rest.z + slice.radial.y * slide, assembled),
        );

        if (assembled < 1) {
          // Scattered pieces tumble until they are pulled in; the slerp lands exactly on the rest turn.
          mesh.quaternion.setFromAxisAngle(slice.spinAxis, time * slice.spinRate).multiply(slice.scatterQuaternion);
          mesh.quaternion.slerp(slice.restQuaternion, assembled);
        } else {
          mesh.quaternion.copy(slice.restQuaternion);
        }

        // A seam glows while it is open, and every slice flares as it locks home.
        const seamOpen = Math.max(openings[i]!, openings[i + 1]!) / BREATHE_GAP;
        slice.seam.value = 0.2 + 0.8 * seamOpen + (1 - assembled) * 0.8;
      }

      const assembly = assembledSum / count;
      core.scale.y = lerp(0.05, 1, assembly);

      body.rotation.y = reducedMotion ? 0 : Math.sin(time * SWAY_SPEED) * SWAY_AMPLITUDE;
    },

    getAnchorsWorld(out) {
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i]!;
        out[i]?.copy(anchor.local).applyMatrix4(slices[anchor.slice]!.mesh.matrixWorld);
      }
    },

    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
