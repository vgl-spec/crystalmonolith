// Portal chapter: the camera falls down the -Y axis through five thick faceted rings. The first
// ring assembles from scattered segments as the chapter opens, every ring flares as the camera
// crosses its height, and a soft glow waits below where the particle core sits.
import * as THREE from 'three';
import { PALETTE, WORLD } from '../../contracts';
import type { SceneContext, SceneModule } from '../../contracts';
import { createRandom } from '../engine/random';
import { createDisposer } from '../shared/disposer';

/** Segments per ring, cycled over WORLD.portal.rings; varied so the rings do not read as copies of each other. */
const SEGMENTS_PER_RING = [14, 12, 16, 13, 15] as const;
const INNER_RADIUS = 4.2;
const OUTER_RADIUS = 5.4;
const RING_DEPTH = 0.6;
const TAU = Math.PI * 2;
/** Chamfer on every edge: it catches the environment light, which is what makes the metal read as faceted. */
const BEVEL = 0.12;
/** Angular gap between neighbouring segments (radians), so the seams read as separate blocks. */
const SEAM_GAP = 0.03;
/** Curve steps per segment arc: low on purpose, the faceting is part of the look. */
const ARC_STEPS = 3;

/** Portal progress over which the first ring's segments fly in. */
const ASSEMBLE_END = 0.2;
/** Share of the assembly timeline a segment may wait before it starts flying. */
const MAX_DELAY = 0.5;
/** Links progress below which the portal still draws (the camera is still swinging round). */
const LINKS_VISIBLE_UNTIL = 0.2;
/** The rings fade to black between these two links progress values, so they never pop out. */
const LINKS_FADE_START = 0.1;

/** Emissive strength at rest, and the extra added at the peak of a flare. */
const RING_REST_GLOW = 0.55;
const RING_FLARE_GLOW = 4.5;
/** Vertical distance (world units) over which a flare rises and falls around the camera's height. */
const FLARE_SPREAD = 2.6;

const GLOW_DISC_RADIUS = 4.5;
/** The disc floats this far above the particle core, between the core and the falling camera. */
const GLOW_DISC_LIFT = 2.5;

const RING_VERTEX_PATCH = /* glsl */ `
  #include <begin_vertex>
  vRingLocal = position;
`;

const RING_FRAGMENT_PATCH = /* glsl */ `
  // Distance from the ring axis in the segment's own space: the inner wall and its lip glow.
  float ringRadius = length(vRingLocal.xz);
  float innerEdge = 1.0 - smoothstep(uInnerRadius, uInnerRadius + 0.3, ringRadius);
  outgoingLight += uGlowColor * (innerEdge * (uRestGlow + uFlare) + uFlare * 0.12);
  outgoingLight *= uFade;
  #include <opaque_fragment>
`;

const DISC_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DISC_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float halo = pow(max(1.0 - r, 0.0), 2.4);
    float core = exp(-r * r * 22.0);
    vec3 color = uColor * halo * 0.9 + vec3(1.0) * core;
    gl_FragColor = vec4(color * uIntensity, 1.0);
    #include <colorspace_fragment>
  }
`;

interface RingUniforms {
  flare: THREE.IUniform<number>;
  fade: THREE.IUniform<number>;
}

interface Ring {
  mesh: THREE.InstancedMesh;
  /** World height of the ring's centre plane. */
  height: number;
  uniforms: RingUniforms;
  /** Spin direction and speed (rad/s); alternating signs keep the tunnel from looking rigid. */
  spin: number;
}

/** Where one segment of the first ring rests, and where it starts before it flies in. */
interface SegmentFlight {
  restPosition: THREE.Vector3;
  restQuaternion: THREE.Quaternion;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  /** 0..MAX_DELAY: later segments start flying later, so they arrive in a ripple rather than together. */
  delay: number;
}

export function createPortal(ctx: SceneContext): SceneModule {
  const root = new THREE.Group();
  root.name = 'portal';
  root.visible = false;
  const { own, disposeAll } = createDisposer();

  const rings: Ring[] = [];
  const flight: SegmentFlight[] = [];
  let glowIntensity: THREE.IUniform<number> | null = null;
  /** Last assemble value written to the first ring's instances, to skip redundant matrix uploads. */
  let renderedAssemble = -1;

  // Scratch objects reused by every frame so the update loop allocates nothing.
  const scratchPosition = new THREE.Vector3();
  const scratchQuaternion = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3(1, 1, 1);
  const scratchMatrix = new THREE.Matrix4();

  function placeFirstRingSegments(assemble: number): void {
    const first = rings[0];
    if (!first || assemble === renderedAssemble) return;
    renderedAssemble = assemble;
    for (let index = 0; index < flight.length; index++) {
      const segment = flight[index]!;
      const local = THREE.MathUtils.clamp((assemble - segment.delay) / (1 - MAX_DELAY), 0, 1);
      const eased = 1 - Math.pow(1 - local, 3);
      scratchPosition.lerpVectors(segment.startPosition, segment.restPosition, eased);
      scratchQuaternion.slerpQuaternions(segment.startQuaternion, segment.restQuaternion, eased);
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
      first.mesh.setMatrixAt(index, scratchMatrix);
    }
    first.mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    root,

    async init() {
      const random = createRandom(0x70a1);
      WORLD.portal.rings.forEach((height, k) => {
        const segmentCount = SEGMENTS_PER_RING[k % SEGMENTS_PER_RING.length]!;
        const geometry = own(createSegmentGeometry(segmentCount));
        const uniforms: RingUniforms = { flare: { value: 0 }, fade: { value: 1 } };
        // InstancedMesh owns the GPU buffer of its instance matrices, so it needs disposing itself.
        const mesh = own(new THREE.InstancedMesh(geometry, own(createRingMaterial(ctx.environment, uniforms)), segmentCount));
        mesh.frustumCulled = false;
        mesh.position.y = height;

        const step = TAU / segmentCount;
        for (let s = 0; s < segmentCount; s++) {
          const angle = s * step;
          const restQuaternion = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
          if (k === 0) {
            // Segments rest on the ring: the radial position is baked into the geometry.
            flight.push({
              restPosition: new THREE.Vector3(),
              restQuaternion,
              startPosition: scatterOffset(random),
              startQuaternion: new THREE.Quaternion().setFromEuler(
                new THREE.Euler(random() * TAU, random() * TAU, random() * TAU),
              ),
              delay: random() * MAX_DELAY,
            });
          } else {
            mesh.setMatrixAt(s, scratchMatrix.compose(scratchPosition.set(0, 0, 0), restQuaternion, scratchScale));
          }
        }
        mesh.instanceMatrix.needsUpdate = true;

        rings.push({ mesh, height, uniforms, spin: (k % 2 === 0 ? 1 : -1) * (0.06 + 0.02 * k) });
        root.add(mesh);
      });

      const discMaterial = own(createGlowDiscMaterial());
      glowIntensity = discMaterial.uniforms.uIntensity as THREE.IUniform<number>;
      const disc = new THREE.Mesh(own(new THREE.PlaneGeometry(GLOW_DISC_RADIUS * 2, GLOW_DISC_RADIUS * 2)), discMaterial);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(WORLD.links.center[0], WORLD.links.center[1] + GLOW_DISC_LIFT, WORLD.links.center[2]);
      disc.frustumCulled = false;
      root.add(disc);
    },

    update(frame) {
      const { chapter, chapterProgress } = frame.scroll;
      const inPortal = chapter === 'portal';
      const inLinksStart = chapter === 'links' && chapterProgress < LINKS_VISIBLE_UNTIL;
      root.visible = inPortal || inLinksStart;
      if (!root.visible) return;

      const portalProgress = inPortal ? chapterProgress : 1;
      placeFirstRingSegments(THREE.MathUtils.smoothstep(portalProgress, 0, ASSEMBLE_END));

      // Fading to black (not to transparent) hides the rings against the dark void without a blend pass.
      const fade = inLinksStart
        ? 1 - THREE.MathUtils.smoothstep(chapterProgress, LINKS_FADE_START, LINKS_VISIBLE_UNTIL)
        : 1;
      const cameraY = ctx.camera.position.y;
      const spinTime = frame.reducedMotion ? 0 : frame.time;
      for (const ring of rings) {
        const distance = (cameraY - ring.height) / FLARE_SPREAD;
        ring.uniforms.flare.value = RING_FLARE_GLOW * Math.exp(-distance * distance);
        ring.uniforms.fade.value = fade;
        ring.mesh.rotation.y = spinTime * ring.spin;
      }

      if (glowIntensity) {
        // The core brightens as the tunnel closes in and burns off once the particles take over.
        const rise = THREE.MathUtils.smoothstep(portalProgress, 0.1, 1);
        glowIntensity.value = (0.25 + 0.9 * rise) * fade;
      }
    },

    dispose() {
      root.clear();
      rings.length = 0;
      flight.length = 0;
      glowIntensity = null;
      disposeAll();
    },
  };
}

/** One extruded annular sector centred on angle 0, lying in the XZ plane and centred on y = 0. */
function createSegmentGeometry(segmentCount: number): THREE.ExtrudeGeometry {
  const half = TAU / segmentCount / 2 - SEAM_GAP / 2;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, OUTER_RADIUS, -half, half, false);
  shape.absarc(0, 0, INNER_RADIUS, half, -half, true);
  shape.closePath();

  // The bevel adds BEVEL of thickness to each face, so the straight part is shorter.
  const straightDepth = RING_DEPTH - 2 * BEVEL;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: straightDepth,
    curveSegments: ARC_STEPS,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    // Starting the bevel inside the outline keeps the footprint at the stated radii.
    bevelOffset: -BEVEL,
    bevelSegments: 1,
  });
  // Extrusion runs along +Z; stand the ring on the XZ plane so the camera looks through the hole.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -straightDepth / 2, 0);
  return geometry;
}

/** A point in the shell around the ring, biased downward so segments are in view as they arrive. */
function scatterOffset(random: () => number): THREE.Vector3 {
  const direction = new THREE.Vector3(random() * 2 - 1, (random() - 0.65) * 1.2, random() * 2 - 1).normalize();
  return direction.multiplyScalar(7 + random() * 7);
}

/** Dark metal whose inner lip glows cyan; flare and fade are per-ring uniforms. */
function createRingMaterial(environment: THREE.Texture, uniforms: RingUniforms): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(PALETTE.deep).multiplyScalar(1.4),
    metalness: 0.92,
    roughness: 0.32,
    flatShading: true,
    envMap: environment,
    envMapIntensity: 1.1,
  });
  const glowColor = new THREE.Color(PALETTE.cyan);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlare = uniforms.flare;
    shader.uniforms.uFade = uniforms.fade;
    shader.uniforms.uGlowColor = { value: glowColor };
    shader.uniforms.uInnerRadius = { value: INNER_RADIUS };
    shader.uniforms.uRestGlow = { value: RING_REST_GLOW };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRingLocal;')
      .replace('#include <begin_vertex>', RING_VERTEX_PATCH);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRingLocal;\nuniform vec3 uGlowColor;\nuniform float uInnerRadius;\nuniform float uRestGlow;\nuniform float uFlare;\nuniform float uFade;',
      )
      .replace('#include <opaque_fragment>', RING_FRAGMENT_PATCH);
  };
  material.customProgramCacheKey = () => 'portal-ring';
  return material;
}

function createGlowDiscMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(PALETTE.cyan) },
      uIntensity: { value: 0 },
    },
    vertexShader: DISC_VERTEX,
    fragmentShader: DISC_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
