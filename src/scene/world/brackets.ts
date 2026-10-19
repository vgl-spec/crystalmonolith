// The "<" and ">" bracket shards that hover either side of the monolith: the code brackets of the
// Zelarion mark, as extruded, bevelled crystal chevrons that drift in a slow, short orbit.
import * as THREE from 'three';
import type { FrameState, SceneContext, SceneModule } from '../../contracts';
import { isHeroStageVisible } from '../engine/beats';
import { easeOutCubic, smoothstep } from '../engine/curves';
import { createCrystalMaterial, createEdgeMaterial, type CrystalUniforms } from './crystal-material';

const SCALE = 0.8;
const DEPTH = 0.38;
/** Distance from the monolith axis and height above the ground, in world units. */
const ORBIT_RADIUS = 3.2;
const HOVER_HEIGHT = 3.5;
/** How far (radians) a bracket swings around the axis either way, and how fast. */
const ORBIT_SWING = 0.45;
const ORBIT_SPEED = 0.25;

/**
 * Outline of a "<" in the XY plane, counter-clockwise: an outer tip, two arms, and the inner tip
 * that makes the stroke 0.4 wide. ">" is the same outline mirrored and re-wound.
 */
const CHEVRON: readonly (readonly [number, number])[] = [
  [-0.55, 0],
  [0.05, -0.9],
  [0.45, -0.9],
  [-0.1, 0],
  [0.45, 0.9],
  [0.05, 0.9],
];

function chevronGeometry(direction: 1 | -1): THREE.BufferGeometry {
  const outline = direction === 1 ? CHEVRON : [...CHEVRON].reverse().map(([x, y]) => [-x, y] as const);
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x * SCALE, y * SCALE)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 1,
  });
  geometry.center();
  return geometry;
}

interface Bracket {
  mesh: THREE.Mesh;
  /** Side of the monolith: -1 left ("<"), +1 right (">"). */
  side: -1 | 1;
  phase: number;
}

export function createBrackets(ctx: SceneContext, crystal: CrystalUniforms): SceneModule {
  const root = new THREE.Group();
  root.name = 'brackets';

  const edgeMaterial = createEdgeMaterial(crystal);
  const disposables: { dispose(): void }[] = [edgeMaterial];
  const brackets: Bracket[] = [];

  return {
    root,

    async init() {
      const sides: readonly (readonly [-1 | 1, number])[] = [
        [-1, 0],
        [1, 2.4],
      ];
      for (const [side, phase] of sides) {
        const geometry = chevronGeometry(side === -1 ? 1 : -1);
        const edges = new THREE.EdgesGeometry(geometry, 18);
        const material = createCrystalMaterial(crystal, { environment: ctx.environment, seam: { value: 0.5 } });
        disposables.push(geometry, edges, material);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = side === -1 ? 'bracket-left' : 'bracket-right';
        mesh.add(new THREE.LineSegments(edges, edgeMaterial));
        root.add(mesh);
        brackets.push({ mesh, side, phase });
      }
    },

    update(frame: FrameState) {
      root.visible = isHeroStageVisible(frame);
      if (!root.visible) return;

      const { time, reducedMotion } = frame;
      const { chapter, chapterProgress } = frame.scroll;
      // After the return cut the brackets grow back in once the monolith is nearly assembled.
      const arrival = chapter === 'return' ? easeOutCubic(smoothstep(0.62, 0.95, chapterProgress)) : 1;

      for (const bracket of brackets) {
        const swing = reducedMotion ? 0 : Math.sin(time * ORBIT_SPEED + bracket.phase) * ORBIT_SWING;
        // Angle 0 is +X (the ">" side); the "<" side starts half a turn round at -X.
        const angle = (bracket.side === -1 ? Math.PI : 0) + swing * bracket.side;
        const bob = reducedMotion ? 0 : Math.sin(time * 0.6 + bracket.phase) * 0.18;
        bracket.mesh.position.set(Math.cos(angle) * ORBIT_RADIUS, HOVER_HEIGHT + bob, Math.sin(angle) * ORBIT_RADIUS);
        bracket.mesh.rotation.set(0, reducedMotion ? 0 : Math.sin(time * 0.31 + bracket.phase) * 0.35, 0);
        bracket.mesh.scale.setScalar(Math.max(arrival, 0.0001));
      }
    },

    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
