// Distant faceted ridges: a ring of tall, jagged, flat-shaded mountains around radius 56-104 that
// gives the horizon its layered silhouette. They are low-poly on purpose; the faceting echoes the
// crystal language of the monolith, and distance hides how few triangles there are.
import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { PALETTE, type SceneModule } from '../../contracts';
import { isHeroStageVisible } from '../engine/beats';
import { smoothstep } from '../engine/curves';
import { createRandom } from '../engine/random';
import { insertAfter } from './shader-patch';

const INNER_RADIUS = 56;
const OUTER_RADIUS = 104;
const ANGULAR_STEPS = 168;
const RADIAL_STEPS = 9;
const MAX_HEIGHT = 24;
const BASE_HEIGHT = -4;
/** Fog depth multiplier: ridges read as nearer than they are, so they keep a visible silhouette. */
const HAZE_SCALE = 0.42;
const FOG_HAZE = `
  #ifdef USE_FOG
    vFogDepth *= ${HAZE_SCALE};
  #endif
`;

function buildRidgeGeometry(seed: number): THREE.BufferGeometry {
  const noise = new SimplexNoise({ random: createRandom(seed) });
  const random = createRandom(seed ^ 0x9e3779b9);

  // Jitter is generated per (ring, column) and the last column reuses column 0's, so the ring
  // closes without a crack. Jitter is what makes the triangles read as irregular facets.
  const jitterTheta = new Float32Array(ANGULAR_STEPS * (RADIAL_STEPS + 1));
  const jitterRadius = new Float32Array(ANGULAR_STEPS * (RADIAL_STEPS + 1));
  const jitterTint = new Float32Array(ANGULAR_STEPS * (RADIAL_STEPS + 1));
  for (let k = 0; k < jitterTheta.length; k++) {
    jitterTheta[k] = (random() - 0.5) * 0.7;
    jitterRadius[k] = (random() - 0.5) * 0.7;
    jitterTint[k] = 0.6 + random() * 0.4;
  }

  const vertexCount = (ANGULAR_STEPS + 1) * (RADIAL_STEPS + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const base = new THREE.Color(PALETTE.void).lerp(new THREE.Color(PALETTE.navy), 0.35);
  const crest = new THREE.Color(PALETTE.navy).lerp(new THREE.Color(PALETTE.blue), 0.35);
  const tint = new THREE.Color();

  let v = 0;
  for (let j = 0; j <= RADIAL_STEPS; j++) {
    const edgeRing = j === 0 || j === RADIAL_STEPS;
    for (let i = 0; i <= ANGULAR_STEPS; i++) {
      const k = j * ANGULAR_STEPS + (i % ANGULAR_STEPS);
      const theta = ((i + jitterTheta[k]!) / ANGULAR_STEPS) * Math.PI * 2;
      const t = (j + (edgeRing ? 0 : jitterRadius[k]!)) / RADIAL_STEPS;
      const radius = INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) * t;
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;

      // Ridged noise (1 - |n| folds it into crest lines) plus sharper secondary peaks.
      const broad = Math.pow(1 - Math.abs(noise.noise(x * 0.016, z * 0.016)), 2.2);
      const fine = Math.abs(noise.noise(x * 0.07 + 40, z * 0.07 - 25));
      const envelope = smoothstep(INNER_RADIUS, INNER_RADIUS + 14, radius) * (1 - smoothstep(OUTER_RADIUS - 16, OUTER_RADIUS, radius));
      const height = BASE_HEIGHT + envelope * (broad * MAX_HEIGHT + fine * 7);

      positions[v * 3] = x;
      positions[v * 3 + 1] = height;
      positions[v * 3 + 2] = z;
      tint.copy(base).lerp(crest, smoothstep(2, 26, height) * jitterTint[k]!);
      colors[v * 3] = tint.r;
      colors[v * 3 + 1] = tint.g;
      colors[v * 3 + 2] = tint.b;
      v++;
    }
  }

  const indices: number[] = [];
  const row = ANGULAR_STEPS + 1;
  for (let j = 0; j < RADIAL_STEPS; j++) {
    for (let i = 0; i < ANGULAR_STEPS; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      // The diagonal flips with parity so facets do not all lean the same way.
      if ((i + j) % 2 === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, c, d, a, d, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createRidges(): SceneModule {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.1,
    flatShading: true,
  });
  material.onBeforeCompile = (shader) => {
    insertAfter(shader, 'vertexShader', 'fog_vertex', FOG_HAZE);
  };
  material.customProgramCacheKey = () => 'ridges-haze';

  const root = new THREE.Group();
  root.name = 'ridges';
  let geometry: THREE.BufferGeometry | null = null;

  return {
    root,
    async init() {
      geometry = buildRidgeGeometry(4217);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'ridge-ring';
      root.add(mesh);
    },
    update(frame) {
      root.visible = isHeroStageVisible(frame);
    },
    dispose() {
      geometry?.dispose();
      material.dispose();
    },
  };
}
