// Projects chapter: one dark-glass crystal per project, each holding the project's landing page as
// a glowing hologram. Everything here is a pure function of the frame state (scroll, time, pointer),
// so scrubbing the scroll backwards replays the exact same motion.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { chapterLengths, PALETTE, PROJECT_SLOT, WORLD } from '../../contracts';
import type { FrameState, Project, ProjectAnchorsWorld, ProjectShardsModule, ScrollState, SceneContext } from '../../contracts';
import { createRandom } from '../engine/random';
import { createDisposer } from '../shared/disposer';
import { hashString } from '../shared/hash';

/** Half extents of the crystal's ellipsoid: 2.4 wide, 3.6 tall, 2.0 deep. */
const HALF_EXTENT = { x: 1.2, y: 1.8, z: 1.0 } as const;

/** The screenshot area keeps the 8:5 ratio of the captures. */
const HOLOGRAM_IMAGE = { width: 1.9, height: 1.19 } as const;
/** The plane is larger than the image so the soft glow has room to fade out around it. */
const HOLOGRAM_PLANE = { width: 2.2, height: 1.5 } as const;

/**
 * Linear gain applied to the page. 0.5 keeps even a pure white page below the bloom luminance
 * threshold (0.7), so the screenshot reads as a screenshot instead of a light source.
 */
const HOLOGRAM_IMAGE_GAIN = 0.5;

/**
 * Distance from the slot centre, in world units, past which a shard cannot be on screen from the
 * projects camera: half the view height at 10 units (3.64) + half a shard (1.8) + a margin.
 */
const OFF_SCREEN_DISTANCE = 6.6;

/** Brightness of the shard whose detail panel is open; the overlay supplies the rest of the dimming. */
const OPEN_BRIGHTNESS = 0.3;

const EDGE_OPACITY = 0.3;

const CYAN = new THREE.Color(PALETTE.cyan);
const GLASS_TINT = new THREE.Color(PALETTE.navy).multiplyScalar(0.3);

const HOLOGRAM_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HOLOGRAM_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uTint;
  uniform vec2 uImageHalf;
  uniform vec2 uPlaneSize;
  uniform float uTime;
  uniform float uSeed;
  uniform float uBrightness;
  uniform float uImageGain;
  varying vec2 vUv;

  void main() {
    // Work in world units so the accents are the same size on every shard.
    vec2 p = (vUv - 0.5) * uPlaneSize;
    vec2 d = abs(p) - uImageHalf;
    // Signed distance to the image border: negative inside, positive outside.
    float border = max(d.x, d.y);
    float outsideDistance = length(max(d, 0.0));

    // A rare horizontal tear that nudges a band of the image sideways, like a failing projector.
    float tear = smoothstep(0.985, 1.0, sin(vUv.y * 7.0 - uTime * 0.6 + uSeed * 6.2831));
    vec2 imageUv = clamp(p / uImageHalf * 0.5 + 0.5, 0.0, 1.0);
    imageUv.x += tear * 0.01;
    vec3 page = texture2D(uMap, imageUv).rgb;

    // The page stays near its true colours and is capped by uImageGain: a white page must land
    // below the bloom threshold, otherwise the whole plane blows out into one white rectangle.
    // Only the thin accents below are allowed to exceed it.
    vec3 image = mix(page, page * uTint, 0.12) * uImageGain;
    float imageMask = smoothstep(0.0, 0.05, -border);
    float scan = 0.9 + 0.1 * sin(gl_FragCoord.y * 2.0);
    float flicker = 0.96 + 0.04 * sin(uTime * 41.0 + uSeed * 9.0) * sin(uTime * 13.0 + uSeed * 4.0);

    // Accents: a hairline frame, a thin line climbing the page, and a short falloff outside the frame.
    float hairline = exp(-border * border / 0.0002);
    float sweepOffset = fract(vUv.y * 0.8 - uTime * 0.1) - 0.5;
    float sweep = exp(-sweepOffset * sweepOffset * 900.0) * imageMask;
    float planeEdge = min(uPlaneSize.x * 0.5 - abs(p.x), uPlaneSize.y * 0.5 - abs(p.y));
    float halo = exp(-outsideDistance * 18.0) * smoothstep(0.0, 0.1, planeEdge) * (1.0 - imageMask);

    vec3 accents = uTint * (hairline * 1.2 + sweep * 0.35 + halo * 0.12);
    vec3 color = (image * scan * imageMask + accents) * flicker * uBrightness;

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Per-shard uniforms the frame loop writes; held by reference so nothing is looked up per frame. */
interface ShardUniforms {
  glassBrightness: THREE.IUniform<number>;
  hologramBrightness: THREE.IUniform<number>;
  hologramTime: THREE.IUniform<number>;
}

interface Shard {
  project: Project;
  group: THREE.Group;
  crystal: THREE.Mesh;
  edgeMaterial: THREE.LineBasicMaterial;
  dotMaterial: THREE.PointsMaterial;
  uniforms: ShardUniforms;
  /** Hull vertices (shard-local) the HUD callouts attach to; picked once, moved by matrixWorld. */
  titleLocal: THREE.Vector3;
  readoutLocal: THREE.Vector3;
  ctaLocal: THREE.Vector3;
  swayPhase: number;
  /** 1 normally, eased toward OPEN_BRIGHTNESS while this project's panel is open. */
  brightness: number;
}

export function createProjectShards(ctx: SceneContext): ProjectShardsModule {
  const root = new THREE.Group();
  root.name = 'project-shards';
  const { own, disposeAll } = createDisposer();

  const projectCount = ctx.content.projects.length;
  // Scrolling on past the last slot keeps the final shard moving at the same speed until it is gone.
  const exitRate = chapterLengths(projectCount).portal / PROJECT_SLOT;
  const [centerX, centerY, centerZ] = WORLD.projects.center;

  const shards: Shard[] = [];
  const projectIdByMesh = new Map<THREE.Object3D, string>();
  const pickTargets: THREE.Object3D[] = [];
  const pickHits: THREE.Intersection[] = [];
  /** Slot position (the contract's projectFloat, extended into descent and portal) of the last update. */
  let slot = Number.NEGATIVE_INFINITY;

  const anchors: ProjectAnchorsWorld = {
    id: null,
    presence: 0,
    center: new THREE.Vector3(),
    title: new THREE.Vector3(),
    readout: new THREE.Vector3(),
    cta: new THREE.Vector3(),
  };

  /**
   * projectFloat is -1 outside the projects chapter, which would make the first shard pop in and
   * the last pop out at the chapter edges. Extending it a little into the neighbouring chapters
   * lets them glide in from below and out through the top instead.
   */
  function slotOf(scroll: ScrollState): number {
    switch (scroll.chapter) {
      case 'descent':
        return scroll.chapterProgress - 1;
      case 'projects':
        return scroll.projectFloat;
      case 'portal':
        return projectCount + scroll.chapterProgress * exitRate;
      default:
        return Number.NEGATIVE_INFINITY;
    }
  }

  function buildShard(project: Project, texture: THREE.Texture, index: number): Shard {
    const random = createRandom(hashString(project.id));

    const hull = own(new ConvexGeometry(crystalPoints(random)));
    const uniqueVertices = uniqueHullVertices(hull);

    const uniforms: ShardUniforms = {
      glassBrightness: { value: 1 },
      hologramBrightness: { value: 1 },
      hologramTime: { value: 0 },
    };

    const crystal = new THREE.Mesh(hull, own(createGlassMaterial(ctx.environment, uniforms.glassBrightness)));
    crystal.renderOrder = 1;

    const edgeMaterial = own(
      new THREE.LineBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: EDGE_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const edges = new THREE.LineSegments(own(new THREE.EdgesGeometry(hull, 12)), edgeMaterial);
    edges.renderOrder = 2;

    const dotGeometry = own(new THREE.BufferGeometry());
    dotGeometry.setFromPoints(uniqueVertices);
    const dotMaterial = own(
      new THREE.PointsMaterial({
        color: CYAN,
        size: 0.07,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const dots = new THREE.Points(dotGeometry, dotMaterial);
    dots.renderOrder = 2;

    const hologram = new THREE.Mesh(
      own(new THREE.PlaneGeometry(HOLOGRAM_PLANE.width, HOLOGRAM_PLANE.height)),
      own(createHologramMaterial(texture, random(), uniforms)),
    );
    hologram.position.set(0, (random() - 0.5) * 0.3, 0);
    hologram.renderOrder = 3;

    const group = new THREE.Group();
    group.name = `shard-${project.id}`;
    group.scale.setScalar(0.92 + random() * 0.18);
    group.visible = false;
    group.add(crystal, edges, dots, hologram);

    projectIdByMesh.set(crystal, project.id);

    return {
      project,
      group,
      crystal,
      edgeMaterial,
      dotMaterial,
      uniforms,
      titleLocal: extremeVertex(uniqueVertices, (v) => -v.x + v.y),
      readoutLocal: extremeVertex(uniqueVertices, (v) => v.x),
      ctaLocal: extremeVertex(uniqueVertices, (v) => v.x - v.y),
      // Offset by index too so neighbouring shards never sway in lockstep.
      swayPhase: random() * Math.PI * 2 + index,
      brightness: 1,
    };
  }

  function updateShard(shard: Shard, index: number, frame: FrameState): void {
    const offset = slot - (index + 0.5);
    const distance = offset * WORLD.projects.shardSpacing;
    const onScreen = Math.abs(distance) <= OFF_SCREEN_DISTANCE;
    shard.group.visible = onScreen;
    if (!onScreen) return;

    const motion = frame.reducedMotion ? 0 : 1;
    const { group } = shard;
    group.position.set(centerX, centerY + distance, centerZ);

    // The sway is bounded on purpose: a full turn would show the screenshot from behind, and the
    // callout vertices would travel to the far side of the crystal.
    const sway = Math.sin(frame.time * 0.32 + shard.swayPhase) * 0.4 * motion;
    group.rotation.set(
      -frame.pointer.y * 0.12 * motion + Math.sin(frame.time * 0.41 + shard.swayPhase * 1.7) * 0.05 * motion,
      sway + offset * 0.9 + frame.pointer.x * 0.15 * motion,
      Math.sin(frame.time * 0.27 + shard.swayPhase) * 0.04 * motion,
    );

    const targetBrightness = frame.openProjectId === shard.project.id ? OPEN_BRIGHTNESS : 1;
    shard.brightness = THREE.MathUtils.damp(shard.brightness, targetBrightness, 6, frame.dt);
    shard.uniforms.glassBrightness.value = shard.brightness;
    shard.uniforms.hologramBrightness.value = shard.brightness;
    shard.uniforms.hologramTime.value = frame.reducedMotion ? 0 : frame.time;
    shard.edgeMaterial.opacity = EDGE_OPACITY * shard.brightness;
    shard.dotMaterial.opacity = 0.9 * shard.brightness;

    // Raycasting and the HUD anchors read matrixWorld, which the renderer would only refresh later.
    group.updateWorldMatrix(true, false);
  }

  return {
    root,

    async init() {
      const loader = new THREE.TextureLoader(ctx.manager);
      const anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
      const textures = await Promise.all(
        ctx.content.projects.map(async (project) => {
          const texture = own(await loader.loadAsync(project.image));
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = anisotropy;
          return texture;
        }),
      );
      ctx.content.projects.forEach((project, index) => {
        const shard = buildShard(project, textures[index]!, index);
        shards.push(shard);
        root.add(shard.group);
      });
    },

    update(frame) {
      slot = slotOf(frame.scroll);
      if (slot === Number.NEGATIVE_INFINITY) {
        for (const shard of shards) shard.group.visible = false;
        return;
      }
      for (let index = 0; index < shards.length; index++) updateShard(shards[index]!, index, frame);
    },

    pick(raycaster) {
      pickTargets.length = 0;
      for (const shard of shards) {
        if (shard.group.visible) pickTargets.push(shard.crystal);
      }
      pickHits.length = 0;
      raycaster.intersectObjects(pickTargets, false, pickHits);
      const hit = pickHits[0];
      return hit ? (projectIdByMesh.get(hit.object) ?? null) : null;
    },

    getAnchorsWorld() {
      const index = THREE.MathUtils.clamp(Math.round(slot - 0.5), 0, projectCount - 1);
      const shard = shards[index];
      if (!shard) {
        anchors.id = null;
        anchors.presence = 0;
        return anchors;
      }
      anchors.presence = THREE.MathUtils.clamp(1 - Math.abs(slot - (index + 0.5)) * 2, 0, 1);
      anchors.id = anchors.presence > 0 ? shard.project.id : null;

      shard.group.updateWorldMatrix(true, false);
      const matrix = shard.group.matrixWorld;
      anchors.center.setFromMatrixPosition(matrix);
      anchors.title.copy(shard.titleLocal).applyMatrix4(matrix);
      anchors.readout.copy(shard.readoutLocal).applyMatrix4(matrix);
      anchors.cta.copy(shard.ctaLocal).applyMatrix4(matrix);
      return anchors;
    },

    dispose() {
      root.clear();
      projectIdByMesh.clear();
      shards.length = 0;
      disposeAll();
    },
  };
}

/**
 * 12-18 points on a jittered, elongated ellipsoid: a belt of points around the middle plus two
 * apex tips. Hashing the project id into the seed makes every crystal different but stable.
 */
function crystalPoints(random: () => number): THREE.Vector3[] {
  const count = 12 + Math.floor(random() * 7);
  const widthScale = 0.9 + random() * 0.2;
  const depthScale = 0.9 + random() * 0.2;
  // Shear along y so crystals lean differently instead of all standing upright.
  const lean = (random() - 0.5) * 0.3;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const startAngle = random() * Math.PI * 2;

  const beltCount = count - 2;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < beltCount; i++) {
    const heightFraction = ((i + 0.5 + (random() - 0.5) * 0.6) / beltCount) * 2 - 1;
    const y = heightFraction * 0.8;
    const ringRadius = Math.sqrt(1 - y * y) * (0.88 + random() * 0.24);
    const angle = startAngle + i * goldenAngle + (random() - 0.5) * 0.5;
    points.push(
      new THREE.Vector3(
        Math.cos(angle) * ringRadius * HALF_EXTENT.x * widthScale,
        y * HALF_EXTENT.y,
        Math.sin(angle) * ringRadius * HALF_EXTENT.z * depthScale,
      ),
    );
  }
  points.push(
    new THREE.Vector3((random() - 0.5) * 0.5, HALF_EXTENT.y * (0.92 + random() * 0.12), (random() - 0.5) * 0.4),
    new THREE.Vector3((random() - 0.5) * 0.5, -HALF_EXTENT.y * (0.92 + random() * 0.12), (random() - 0.5) * 0.4),
  );
  for (const point of points) point.x += lean * point.y;
  return points;
}

/** The hull geometry is non-indexed (three vertices per face), so shared corners repeat; fold them. */
function uniqueHullVertices(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const position = geometry.getAttribute('position');
  const seen = new Set<string>();
  const vertices: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(position, i);
    const key = `${vertex.x.toFixed(4)},${vertex.y.toFixed(4)},${vertex.z.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    vertices.push(vertex);
  }
  return vertices;
}

function extremeVertex(vertices: readonly THREE.Vector3[], score: (vertex: THREE.Vector3) => number): THREE.Vector3 {
  let best = vertices[0]!;
  let bestScore = score(best);
  for (const vertex of vertices) {
    const value = score(vertex);
    if (value > bestScore) {
      best = vertex;
      bestScore = value;
    }
  }
  return best.clone();
}

/** Dark navy glass with a cyan fresnel rim; the rim also raises opacity so it survives transparency. */
function createGlassMaterial(environment: THREE.Texture, brightness: THREE.IUniform<number>): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: GLASS_TINT,
    flatShading: true,
    transparent: true,
    opacity: 0.6,
    roughness: 0.16,
    metalness: 0.15,
    envMap: environment,
    envMapIntensity: 0.7,
    side: THREE.DoubleSide,
    // Writing depth would hide the hologram and edges that sit inside the glass.
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: CYAN };
    shader.uniforms.uBrightness = brightness;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uBrightness;')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
          float rim = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.2);
          outgoingLight += uRimColor * rim * 0.55;
          diffuseColor.a = min(1.0, diffuseColor.a + rim * 0.35);
          outgoingLight *= uBrightness;
          #include <opaque_fragment>
        `,
      );
  };
  material.customProgramCacheKey = () => 'project-shard-glass';
  return material;
}

function createHologramMaterial(texture: THREE.Texture, seed: number, uniforms: ShardUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uTint: { value: new THREE.Vector3(0.55, 0.92, 1.0) },
      uImageHalf: { value: new THREE.Vector2(HOLOGRAM_IMAGE.width / 2, HOLOGRAM_IMAGE.height / 2) },
      uPlaneSize: { value: new THREE.Vector2(HOLOGRAM_PLANE.width, HOLOGRAM_PLANE.height) },
      uTime: uniforms.hologramTime,
      uSeed: { value: seed },
      uBrightness: uniforms.hologramBrightness,
      uImageGain: { value: HOLOGRAM_IMAGE_GAIN },
    },
    vertexShader: HOLOGRAM_VERTEX,
    fragmentShader: HOLOGRAM_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
