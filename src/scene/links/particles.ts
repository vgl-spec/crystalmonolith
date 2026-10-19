// Links chapter: a tiered dark platform and a cloud of particles that is a bright core while the
// camera falls down the portal, then forms the selected link's shape (mark, GitHub, "in", "@").
// Shapes are rasterised once to a small 2D canvas and sampled into target points; a CPU spring
// simulation in preallocated typed arrays moves the particles toward whichever target is active.
import * as THREE from 'three';
import { FONT_FAMILY, PALETTE, WORLD } from '../../contracts';
import type { FrameState, ParticleShape, QualityTier, SceneContext, SceneModule } from '../../contracts';
import { createRandom } from '../engine/random';
import { createDisposer } from '../shared/disposer';
import type { Own } from '../shared/disposer';

const PARTICLE_COUNT: Record<QualityTier, number> = { high: 14000, medium: 9000, low: 5000 };

const RASTER_SIZE = 256;
/** The longest side of a figure, in world units, at full size. */
const FIGURE_SIZE = 4.6;
/**
 * Lowest edge of a full-size figure relative to the cloud centre. In the side view the platform's
 * far rim crosses the screen just below this, so the figure stands clear of it with a small gap.
 */
const FIGURE_FLOOR = -1.3;
/** Share of the visible width a figure may fill; portrait screens shrink the figure to fit. */
const FIGURE_WIDTH_FILL = 0.9;
const MIN_FIGURE_SCALE = 0.3;
const DEPTH_JITTER = 0.35;
const IDLE_RADIUS = 1.2;

/** Links progress at which the core lands and bursts into the selected figure. */
const IDLE_UNTIL = 0.25;
/** Return progress over which the figure drifts upward and fades out. */
const DISSOLVE_END = 0.3;
/** The platform stays until the engine's return flash has covered the cut. */
const PLATFORM_LINGER_UNTIL = 0.5;

/** Spring constants in 1/s^2; critically damped, a particle settles in about 1.2 s. */
const STIFFNESS = 14;
const DAMPING_RATIO = 0.85;
/** The simulation never integrates a step longer than this, which keeps the springs stable. */
const MAX_STEP = 1 / 30;
const SHIMMER_FORCE = 0.9;
const SHIMMER_RATE = 1.3;

const BURST_SPEED = 3;
const BURST_SPEED_SPREAD = 5;
const BURST_SWIRL = 3.5;
/** Seconds the springs take to come back to full strength after a burst. */
const BURST_RECOVERY = 0.9;
const BURST_MIN_STRENGTH = 0.06;
const BURST_GLOW_DECAY = 2.5;

const POINTER_RADIUS = 1.2;
const POINTER_PUSH = 70;

/** Particle speed (units/s) that counts as fully hot (white). */
const HOT_SPEED = 6;
const BASE_POINT_SIZE = 0.052;
const BASE_POINT_COUNT = 14000;

/** Resting colour of every particle that is not part of the multi-tone mark: a dim steel blue. */
const STEEL = new THREE.Color('#5a82a8');

const PARTICLE_VERTEX = /* glsl */ `
  attribute float aSpeed;
  attribute vec3 aColor;
  attribute vec4 aSeed;
  uniform float uSize;
  uniform float uScale;
  uniform float uDissolve;
  uniform float uBurst;
  uniform float uHotSpeed;
  varying float vHeat;
  varying vec3 vColor;
  varying float vFade;

  void main() {
    float random = aSeed.w * 0.5 + 0.5;
    vec3 displaced = position;
    // Dissolve: every particle drifts up and sideways at its own pace, then fades at its own time.
    displaced.y += uDissolve * (2.0 + 6.0 * random);
    displaced.xz += aSeed.xz * uDissolve * 1.6;
    vFade = 1.0 - smoothstep(random * 0.55, random * 0.55 + 0.45, uDissolve);

    vHeat = clamp(aSpeed / uHotSpeed + uBurst * 0.7, 0.0, 1.0);
    vColor = aColor;

    vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);
    gl_PointSize = clamp(uSize * uScale / -viewPosition.z * (1.0 + vHeat * 0.5), 1.0, 48.0);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const PARTICLE_FRAGMENT = /* glsl */ `
  uniform vec3 uHot;
  uniform vec3 uWhite;
  varying float vHeat;
  varying vec3 vColor;
  varying float vFade;

  void main() {
    float distanceFromCentre = length(gl_PointCoord - 0.5) * 2.0;
    if (distanceFromCentre > 1.0) discard;
    float sprite = smoothstep(1.0, 0.35, distanceFromCentre);

    vec3 hot = mix(uHot, uWhite, vHeat * vHeat);
    vec3 color = mix(vColor, hot, smoothstep(0.0, 0.8, vHeat));

    gl_FragColor = vec4(color, sprite * vFade * (0.5 + 0.4 * vHeat));
    #include <colorspace_fragment>
  }
`;

/** One arrangement of the particles: a world-space target and a resting colour per particle. */
interface ShapeBank {
  positions: Float32Array;
  /** Linear RGB triples. */
  colors: Float32Array;
}

/** A rasterised shape: which pixels are lit, their colours, and the lit region's bounds. */
interface ShapeMask {
  litPixels: Uint32Array;
  pixels: Uint8ClampedArray;
  /** True when the particles should take the pixels' own colours (the multi-tone brand mark). */
  keepColors: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function createLinkParticles(ctx: SceneContext): SceneModule {
  const root = new THREE.Group();
  root.name = 'links';
  root.visible = false;
  const { own, disposeAll } = createDisposer();

  const count = PARTICLE_COUNT[ctx.quality];
  const links = ctx.content.links;
  const [centerX, centerY, centerZ] = WORLD.links.center;
  const random = createRandom(0x11c5);

  // Simulation state: everything below is allocated once and mutated in place.
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  /** [stiffness, damping] per particle; the spread staggers the reform so it ripples. */
  const springs = new Float32Array(count * 2);
  /** xyz in -1..1 (shimmer direction, dissolve spread) and w in -1..1 (phase, dissolve order). */
  const seeds = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);

  /** banks[0] is the idle core; banks[1 + i] is content.links[i]. */
  let banks: ShapeBank[] = [];
  let activeBank = -1;
  let burstAge = Number.POSITIVE_INFINITY;
  let wasShowing = false;

  // Distance from the side-view camera to the figure; it sets how much width the screen shows there.
  const sideViewDistance = Math.hypot(
    WORLD.links.cameraSide.position[1] - centerY,
    WORLD.links.cameraSide.position[2] - centerZ,
  );
  let figureScale = 1;

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const figurePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -centerZ);
  const pointerHit = new THREE.Vector3();
  const drawingSize = new THREE.Vector2();

  const uniforms = {
    uSize: { value: BASE_POINT_SIZE * Math.sqrt(BASE_POINT_COUNT / count) },
    uScale: { value: 1 },
    uDissolve: { value: 0 },
    uBurst: { value: 0 },
    uHotSpeed: { value: HOT_SPEED },
    uHot: { value: new THREE.Color(PALETTE.cyan) },
    uWhite: { value: new THREE.Color('#e8f8ff') },
  };

  const geometry = own(new THREE.BufferGeometry());
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const speedAttribute = new THREE.BufferAttribute(speeds, 1).setUsage(THREE.DynamicDrawUsage);
  const colorAttribute = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aSpeed', speedAttribute);
  geometry.setAttribute('aColor', colorAttribute);
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

  const points = new THREE.Points(
    geometry,
    own(
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_VERTEX,
        fragmentShader: PARTICLE_FRAGMENT,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    ),
  );
  // Particles move every frame, so the bounding sphere computed from the initial array is meaningless.
  points.frustumCulled = false;
  points.renderOrder = 4;

  const platform = buildPlatform(ctx.environment, own);
  root.add(platform, points);

  /**
   * Fits the cloud to the screen: shrinks it on narrow (portrait) aspects so the whole figure is
   * visible, and keeps its lowest edge at FIGURE_FLOOR whatever the scale. Scaling about the cloud
   * centre keeps every target in the same space the samples were generated in.
   */
  function fitFigure(): void {
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2) * ctx.camera.aspect * sideViewDistance;
    figureScale = THREE.MathUtils.clamp((2 * halfWidth * FIGURE_WIDTH_FILL) / FIGURE_SIZE, MIN_FIGURE_SCALE, 1);
    const lift = FIGURE_FLOOR + (figureScale * FIGURE_SIZE) / 2;
    points.scale.setScalar(figureScale);
    points.position.set(centerX * (1 - figureScale), centerY * (1 - figureScale) + lift, centerZ * (1 - figureScale));
  }

  function chooseBank(frame: FrameState): number {
    const { chapter, chapterProgress } = frame.scroll;
    const formed = (chapter === 'links' && chapterProgress >= IDLE_UNTIL) || chapter === 'return';
    if (!formed || links.length === 0) return 0;
    // `|| 0` turns a NaN index into the first link instead of an out-of-range bank.
    return 1 + THREE.MathUtils.clamp(Math.round(frame.activeLinkIndex) || 0, 0, links.length - 1);
  }

  /** Jump straight to a bank: used when the module (re)appears so a scrub never shows a stale cloud. */
  function snapTo(bankIndex: number): void {
    const bank = banks[bankIndex]!;
    positions.set(bank.positions);
    colors.set(bank.colors);
    velocities.fill(0);
    speeds.fill(0);
    activeBank = bankIndex;
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  }

  /** Switch the targets and fling every particle outward with a twist; the springs pull them back. */
  function burstTo(bankIndex: number): void {
    activeBank = bankIndex;
    colors.set(banks[bankIndex]!.colors);
    colorAttribute.needsUpdate = true;
    burstAge = 0;
    for (let i = 0, o = 0; i < count; i++, o += 3) {
      const dx = random() * 2 - 1;
      const dy = random() * 2 - 1;
      const dz = random() * 2 - 1;
      const length = Math.hypot(dx, dy, dz) || 1;
      const speed = BURST_SPEED + random() * BURST_SPEED_SPREAD;
      // Tangential kick around the vertical axis through the figure so the scatter swirls.
      const rx = positions[o]! - centerX;
      const rz = positions[o + 2]! - centerZ;
      const swirl = BURST_SWIRL / (Math.hypot(rx, rz) + 1);
      velocities[o] = velocities[o]! + (dx / length) * speed - rz * swirl;
      velocities[o + 1] = velocities[o + 1]! + (dy / length) * speed;
      velocities[o + 2] = velocities[o + 2]! + (dz / length) * speed + rx * swirl;
    }
  }

  /** Where the pointer ray crosses the figure's plane, or false when the pointer should be ignored. */
  function locatePointer(frame: FrameState): boolean {
    // An untouched pointer reports exactly (0, 0); treating it as live would dent the figure's middle.
    const idle = Math.abs(frame.pointer.x) < 1e-4 && Math.abs(frame.pointer.y) < 1e-4;
    if (idle || frame.reducedMotion) return false;
    ctx.camera.updateMatrixWorld();
    raycaster.setFromCamera(pointerNdc.set(frame.pointer.x, frame.pointer.y), ctx.camera);
    return raycaster.ray.intersectPlane(figurePlane, pointerHit) !== null;
  }

  function simulate(frame: FrameState): void {
    const step = Math.min(frame.dt, MAX_STEP);
    if (step <= 0) return;

    burstAge += step;
    // Right after a burst the springs are weak so particles fly out, then ramp back to full strength.
    const strength =
      BURST_MIN_STRENGTH + (1 - BURST_MIN_STRENGTH) * THREE.MathUtils.smoothstep(burstAge / BURST_RECOVERY, 0, 1);
    const damping = Math.sqrt(strength);
    uniforms.uBurst.value = burstAge < 4 ? Math.exp(-burstAge * BURST_GLOW_DECAY) : 0;

    const pointerActive = locatePointer(frame);
    // The pointer lives in world space, the particles in the cloud's own (scaled, lifted) space.
    const pointerX = (pointerHit.x - points.position.x) / figureScale;
    const pointerY = (pointerHit.y - points.position.y) / figureScale;
    const pointerRadius = POINTER_RADIUS / figureScale;
    const motion = frame.reducedMotion ? 0 : 1;
    const targets = banks[activeBank]!.positions;
    const shimmerTime = frame.time * SHIMMER_RATE;

    for (let i = 0, o = 0; i < count; i++, o += 3) {
      const x = positions[o]!;
      const y = positions[o + 1]!;
      const z = positions[o + 2]!;
      let vx = velocities[o]!;
      let vy = velocities[o + 1]!;
      let vz = velocities[o + 2]!;

      const stiffness = springs[i * 2]! * strength;
      const damp = springs[i * 2 + 1]! * damping;
      let ax = (targets[o]! - x) * stiffness - vx * damp;
      let ay = (targets[o + 1]! - y) * stiffness - vy * damp;
      let az = (targets[o + 2]! - z) * stiffness - vz * damp;

      const shimmer = Math.sin(shimmerTime + seeds[i * 4 + 3]! * 12.566) * SHIMMER_FORCE * motion;
      ax += seeds[i * 4]! * shimmer;
      ay += seeds[i * 4 + 1]! * shimmer;
      az += seeds[i * 4 + 2]! * shimmer;

      if (pointerActive) {
        const dx = x - pointerX;
        const dy = y - pointerY;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < pointerRadius * pointerRadius && distanceSquared > 1e-8) {
          const distance = Math.sqrt(distanceSquared);
          const falloff = 1 - distance / pointerRadius;
          const push = (falloff * falloff * POINTER_PUSH) / distance;
          ax += dx * push;
          ay += dy * push;
        }
      }

      vx += ax * step;
      vy += ay * step;
      vz += az * step;
      velocities[o] = vx;
      velocities[o + 1] = vy;
      velocities[o + 2] = vz;
      positions[o] = x + vx * step;
      positions[o + 1] = y + vy * step;
      positions[o + 2] = z + vz * step;
      speeds[i] = Math.sqrt(vx * vx + vy * vy + vz * vz);
    }

    positionAttribute.needsUpdate = true;
    speedAttribute.needsUpdate = true;
  }

  return {
    root,

    async init() {
      const imageLoader = new THREE.ImageLoader(ctx.manager);
      const canvas = document.createElement('canvas');
      canvas.width = RASTER_SIZE;
      canvas.height = RASTER_SIZE;
      const raster = canvas.getContext('2d', { willReadFrequently: true });
      if (!raster) throw new Error('2D canvas is unavailable, so link shapes cannot be sampled');

      // Assets load in parallel, but each shape is drawn and read back synchronously afterwards
      // because they all share one canvas.
      const sources = await Promise.all(links.map((link) => loadShapeSource(link.shape, imageLoader)));
      banks = [createIdleBank(count, random, [centerX, centerY, centerZ])];
      links.forEach((link, index) => {
        const mask = rasterise(raster, link.shape, sources[index], link.id);
        banks.push(createBank(mask, count, random, [centerX, centerY, centerZ]));
      });

      for (let i = 0; i < count; i++) {
        // Spread stiffness 0.75..1.25 so a reform ripples through the cloud instead of snapping.
        const stiffness = STIFFNESS * (0.75 + random() * 0.5);
        springs[i * 2] = stiffness;
        springs[i * 2 + 1] = 2 * Math.sqrt(stiffness) * DAMPING_RATIO;
        seeds[i * 4] = random() * 2 - 1;
        seeds[i * 4 + 1] = random() * 2 - 1;
        seeds[i * 4 + 2] = random() * 2 - 1;
        seeds[i * 4 + 3] = random() * 2 - 1;
      }
      snapTo(0);
    },

    update(frame) {
      const { chapter, chapterProgress } = frame.scroll;
      const platformShown =
        chapter === 'portal' ||
        chapter === 'links' ||
        (chapter === 'return' && chapterProgress < PLATFORM_LINGER_UNTIL);
      const dissolve = chapter === 'return' ? THREE.MathUtils.smoothstep(chapterProgress, 0, DISSOLVE_END) : 0;
      const particlesShown = platformShown && dissolve < 1;

      root.visible = platformShown && banks.length > 0;
      points.visible = particlesShown;
      if (!root.visible || !particlesShown) {
        wasShowing = false;
        return;
      }

      const bank = chooseBank(frame);
      if (!wasShowing) {
        snapTo(bank);
        burstAge = Number.POSITIVE_INFINITY;
      } else if (bank !== activeBank) {
        if (frame.reducedMotion) snapTo(bank);
        else burstTo(bank);
      }
      wasShowing = true;

      ctx.renderer.getDrawingBufferSize(drawingSize);
      uniforms.uScale.value = drawingSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2));
      uniforms.uDissolve.value = dissolve;
      fitFigure();
      simulate(frame);
    },

    dispose() {
      root.clear();
      banks = [];
      disposeAll();
    },
  };
}

type Origin = readonly [number, number, number];

/** Fetch whatever a shape needs before it can be drawn; fonts and images both load asynchronously. */
async function loadShapeSource(shape: ParticleShape, imageLoader: THREE.ImageLoader): Promise<HTMLImageElement | undefined> {
  switch (shape.kind) {
    case 'image':
      return imageLoader.loadAsync(shape.src);
    case 'text':
      // Without this the first fillText can run before the webfont is ready and draw the fallback.
      await document.fonts.load(`${shape.weight} 200px ${FONT_FAMILY}`);
      return undefined;
    case 'path':
      return undefined;
    default:
      return assertNever(shape);
  }
}

/** Draw a shape white-on-transparent (or in its own colours for images) and read back the lit pixels. */
function rasterise(
  raster: CanvasRenderingContext2D,
  shape: ParticleShape,
  image: HTMLImageElement | undefined,
  id: string,
): ShapeMask {
  raster.clearRect(0, 0, RASTER_SIZE, RASTER_SIZE);
  raster.save();
  raster.fillStyle = '#fff';
  switch (shape.kind) {
    case 'image': {
      if (!image) throw new Error(`Link "${id}" has no image`);
      const scale = RASTER_SIZE / Math.max(image.naturalWidth, image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      raster.drawImage(image, (RASTER_SIZE - width) / 2, (RASTER_SIZE - height) / 2, width, height);
      break;
    }
    case 'text': {
      const font = `${shape.weight} 200px ${FONT_FAMILY}`;
      raster.font = font;
      raster.textAlign = 'center';
      raster.textBaseline = 'middle';
      // Long strings shrink to fit so the glyphs are never cropped by the canvas.
      const fit = Math.min(1, (RASTER_SIZE * 0.92) / raster.measureText(shape.text).width);
      raster.font = `${shape.weight} ${200 * fit}px ${FONT_FAMILY}`;
      raster.fillText(shape.text, RASTER_SIZE / 2, RASTER_SIZE / 2);
      break;
    }
    case 'path': {
      const scale = (RASTER_SIZE * 0.96) / shape.viewBox;
      raster.translate(RASTER_SIZE * 0.02, RASTER_SIZE * 0.02);
      raster.scale(scale, scale);
      raster.fill(new Path2D(shape.d));
      break;
    }
    default:
      assertNever(shape);
  }
  raster.restore();

  const { data } = raster.getImageData(0, 0, RASTER_SIZE, RASTER_SIZE);
  const lit: number[] = [];
  let minX = RASTER_SIZE;
  let maxX = 0;
  let minY = RASTER_SIZE;
  let maxY = 0;
  for (let i = 0; i < RASTER_SIZE * RASTER_SIZE; i++) {
    if (data[i * 4 + 3]! <= 128) continue;
    lit.push(i);
    const x = i % RASTER_SIZE;
    const y = Math.floor(i / RASTER_SIZE);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (lit.length === 0) throw new Error(`Link "${id}" rasterised to nothing`);

  return {
    litPixels: Uint32Array.from(lit),
    pixels: data,
    keepColors: shape.kind === 'image',
    minX,
    maxX,
    minY,
    maxY,
  };
}

/** Sample `count` points (with replacement) from the lit pixels, centred on `origin` and FIGURE_SIZE wide. */
function createBank(mask: ShapeMask, count: number, random: () => number, origin: Origin): ShapeBank {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const width = mask.maxX - mask.minX + 1;
  const height = mask.maxY - mask.minY + 1;
  const worldPerPixel = FIGURE_SIZE / Math.max(width, height);
  const middleX = mask.minX + width / 2;
  const middleY = mask.minY + height / 2;

  for (let i = 0; i < count; i++) {
    const pixel = mask.litPixels[Math.floor(random() * mask.litPixels.length)]!;
    // Jitter inside the pixel so the sampling grid never shows through.
    const px = (pixel % RASTER_SIZE) + random();
    const py = Math.floor(pixel / RASTER_SIZE) + random();
    positions[i * 3] = origin[0] + (px - middleX) * worldPerPixel;
    positions[i * 3 + 1] = origin[1] - (py - middleY) * worldPerPixel;
    positions[i * 3 + 2] = origin[2] + (random() * 2 - 1) * DEPTH_JITTER;
    if (mask.keepColors) writePixelColor(mask.pixels, pixel, colors, i * 3);
    else writeSteelColor(random, colors, i * 3);
  }
  return { positions, colors };
}

function writeSteelColor(random: () => number, colors: Float32Array, offset: number): void {
  const shade = 0.8 + random() * 0.2;
  colors[offset] = STEEL.r * shade;
  colors[offset + 1] = STEEL.g * shade;
  colors[offset + 2] = STEEL.b * shade;
}

const pixelColor = new THREE.Color();

/**
 * The mark's facets run from navy to cyan. Navy alone would vanish against the dark scene, so the
 * colour is lifted: scaled up and given a small blue floor.
 */
function writePixelColor(pixels: Uint8ClampedArray, pixel: number, colors: Float32Array, offset: number): void {
  pixelColor.setRGB(pixels[pixel * 4]! / 255, pixels[pixel * 4 + 1]! / 255, pixels[pixel * 4 + 2]! / 255, THREE.SRGBColorSpace);
  colors[offset] = pixelColor.r * 1.6 + 0.03;
  colors[offset + 1] = pixelColor.g * 1.6 + 0.07;
  colors[offset + 2] = pixelColor.b * 1.6 + 0.12;
}

/** A dense ball: the bright core seen at the bottom of the portal. */
function createIdleBank(count: number, random: () => number, origin: Origin): ShapeBank {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const cosTheta = random() * 2 - 1;
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    const phi = random() * Math.PI * 2;
    const radius = IDLE_RADIUS * Math.cbrt(random());
    positions[i * 3] = origin[0] + radius * sinTheta * Math.cos(phi);
    positions[i * 3 + 1] = origin[1] + radius * cosTheta;
    positions[i * 3 + 2] = origin[2] + radius * sinTheta * Math.sin(phi);
    writeSteelColor(random, colors, i * 3);
  }
  return { positions, colors };
}

/** Three stacked cylinders with a glowing rim and faint floor rings; the top face is 3 below the cloud. */
function buildPlatform(environment: THREE.Texture, own: Own): THREE.Group {
  const group = new THREE.Group();
  group.name = 'links-platform';
  const topY = WORLD.links.center[1] - 3;
  const x = WORLD.links.center[0];
  const z = WORLD.links.center[2];

  const stone = own(
    new THREE.MeshPhysicalMaterial({
      color: PALETTE.surface,
      metalness: 0.55,
      roughness: 0.55,
      envMap: environment,
      envMapIntensity: 0.4,
    }),
  );
  const lines = own(
    new THREE.MeshBasicMaterial({
      color: PALETTE.cyan,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  // Tiers from the top down: radius, thickness, and the glow of the rim around its top edge.
  const tiers = [
    { radius: 5.5, thickness: 0.7, rimGlow: 2.6, rings: [2.2, 3.6, 4.6] },
    { radius: 9, thickness: 0.8, rimGlow: 1.1, rings: [6.4, 7.6] },
    { radius: 13.5, thickness: 1.2, rimGlow: 0.7, rings: [10.2, 11.6, 12.6] },
  ];
  let faceY = topY;
  for (const tier of tiers) {
    const body = new THREE.Mesh(
      own(new THREE.CylinderGeometry(tier.radius, tier.radius * 1.03, tier.thickness, 96)),
      stone,
    );
    body.position.set(x, faceY - tier.thickness / 2, z);

    const rimMaterial = own(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.cyan).multiplyScalar(tier.rimGlow),
        toneMapped: false,
      }),
    );
    const rim = new THREE.Mesh(own(new THREE.TorusGeometry(tier.radius, 0.045, 10, 160)), rimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, faceY, z);
    group.add(body, rim);

    for (const radius of tier.rings) {
      const floorRing = new THREE.Mesh(own(new THREE.RingGeometry(radius, radius + 0.05, 128)), lines);
      floorRing.rotation.x = -Math.PI / 2;
      floorRing.position.set(x, faceY + 0.012, z);
      group.add(floorRing);
    }
    faceY -= tier.thickness;
  }
  return group;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled particle shape: ${JSON.stringify(value)}`);
}
