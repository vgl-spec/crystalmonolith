// Intro-only set dressing: a cyan wireframe lattice floating around the spot where the monolith is
// about to form, and a glowing disc on the ground. Both fade out as the monolith crystallises and
// are removed from the render list entirely once the intro is over.
import * as THREE from 'three';
import { PALETTE, type FrameState, type SceneModule } from '../../contracts';
import { idleTime } from '../engine/beats';
import { smoothstep } from '../engine/curves';
import { createRandom } from '../engine/random';

const LATTICE_SPACING = 2.3;
const LATTICE_RADIUS = 9;
const LATTICE_FLOOR = -0.5;
const LATTICE_CEILING = 10.5;
/** Chance that a lattice edge between two neighbouring nodes exists. */
const EDGE_CHANCE = 0.38;

const DISC_RADIUS = 2.6;
/** introProgress from which none of the extras are visible any more. */
const GONE_AT = 0.9;

const DISC_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DISC_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float r = length(vUv * 2.0 - 1.0);
    float body = pow(smoothstep(1.0, 0.0, r), 1.7);
    float rim = exp(-pow((r - 0.9) / 0.06, 2.0));
    float ripple = 0.5 + 0.5 * sin(r * 34.0 - uTime * 2.2);
    float strength = (body * (1.1 + 0.25 * ripple) + rim * 1.4) * uOpacity;
    gl_FragColor = vec4(uColor * strength, strength);
  }
`;

interface Lattice {
  lines: THREE.LineSegments;
  dots: THREE.Points;
}

/** Random 3D lattice: a jittered grid whose neighbouring nodes are joined by chance. */
function buildLattice(seed: number): Lattice {
  const random = createRandom(seed);
  const span = Math.ceil(LATTICE_RADIUS / LATTICE_SPACING);
  const nodes = new Map<string, THREE.Vector3>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  for (let x = -span; x <= span; x++) {
    for (let y = 0; y <= Math.ceil(LATTICE_CEILING / LATTICE_SPACING); y++) {
      for (let z = -span; z <= span; z++) {
        const node = new THREE.Vector3(
          (x + (random() - 0.5) * 0.6) * LATTICE_SPACING,
          LATTICE_FLOOR + (y + (random() - 0.5) * 0.6) * LATTICE_SPACING,
          (z + (random() - 0.5) * 0.6) * LATTICE_SPACING,
        );
        // Nodes in front of the intro camera would sit on the lens; keep the lattice behind z = 3.
        if (Math.hypot(node.x, node.z) <= LATTICE_RADIUS && node.z < 3) nodes.set(key(x, y, z), node);
      }
    }
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const cyan = new THREE.Color(PALETTE.cyan);
  const tint = new THREE.Color();
  // Brightness falls off with distance from the monolith axis; with additive blending that reads as fading out.
  const pushVertex = (v: THREE.Vector3) => {
    const falloff = Math.pow(Math.max(0, 1 - Math.hypot(v.x, v.z, (v.y - 3.5) * 0.6) / LATTICE_RADIUS), 1.3);
    tint.copy(cyan).multiplyScalar(0.2 + falloff * 1.3);
    positions.push(v.x, v.y, v.z);
    colors.push(tint.r, tint.g, tint.b);
  };

  const dotPositions: number[] = [];
  for (const [id, node] of nodes) {
    const [x, y, z] = id.split(',').map(Number) as [number, number, number];
    dotPositions.push(node.x, node.y, node.z);
    for (const next of [key(x + 1, y, z), key(x, y + 1, z), key(x, y, z + 1)]) {
      const other = nodes.get(next);
      if (other && random() < EDGE_CHANCE) {
        pushVertex(node);
        pushVertex(other);
      }
    }
  }

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const lines = new THREE.LineSegments(
    lineGeometry,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );

  const dotGeometry = new THREE.BufferGeometry();
  dotGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dotPositions, 3));
  const dots = new THREE.Points(
    dotGeometry,
    new THREE.PointsMaterial({
      color: new THREE.Color(PALETTE.ink),
      size: 0.045,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  return { lines, dots };
}

export function createIntroExtras(): SceneModule {
  const root = new THREE.Group();
  root.name = 'intro-extras';

  const lattice = buildLattice(1337);
  root.add(lattice.lines, lattice.dots);

  const discUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color(PALETTE.cyan).lerp(new THREE.Color(PALETTE.ink), 0.55).multiplyScalar(1.6) },
  };
  const discMaterial = new THREE.ShaderMaterial({
    uniforms: discUniforms,
    vertexShader: DISC_VERTEX,
    fragmentShader: DISC_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(DISC_RADIUS, 64), discMaterial);
  disc.name = 'intro-disc';
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.05;
  root.add(disc);

  return {
    root,
    async init() {},
    update(frame: FrameState) {
      const intro = frame.introProgress;
      root.visible = intro < GONE_AT;
      if (!root.visible) return;

      // Appear early, hold while the circuits ignite, fade as the monolith crystallises.
      const latticeOpacity = smoothstep(0.03, 0.22, intro) * (1 - smoothstep(0.5, 0.86, intro));
      (lattice.lines.material as THREE.LineBasicMaterial).opacity = latticeOpacity * 0.55;
      (lattice.dots.material as THREE.PointsMaterial).opacity = latticeOpacity;
      lattice.lines.visible = lattice.dots.visible = latticeOpacity > 0.002;
      root.rotation.y = intro * 0.7;

      discUniforms.uTime.value = idleTime(frame);
      discUniforms.uOpacity.value = smoothstep(0.06, 0.2, intro) * (1 - smoothstep(0.42, 0.78, intro));
    },
    dispose() {
      for (const part of [lattice.lines, lattice.dots, disc]) {
        part.geometry.dispose();
        (part.material as THREE.Material).dispose();
      }
    },
  };
}
