// Scene entry point. Builds the renderer, camera, shared context and post-processing, assembles the
// world (this folder) and the zone modules (projects, portal, links), and exposes the SceneAPI the
// rest of the site drives. Everything drawn is a pure function of the FrameState handed to update().
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CAMERA_FOV,
  type CreateScene,
  type FrameState,
  type QualityTier,
  type SceneAnchors,
  type SceneContext,
  type SceneModule,
  type ScreenPoint,
} from '../contracts';
import { createLinkParticles } from './links/particles';
import { createPortal } from './portal/portal';
import { createProjectShards } from './projects/shards';
import { INTRO_HUD_START } from './engine/beats';
import { createCameraRig } from './engine/camera-rig';
import { trackLoadProgress } from './engine/load-progress';
import { createPostFx } from './engine/postfx';
import { projectToScreen } from './engine/projection';
import { TIER_SETTINGS, createQualityGovernor } from './engine/quality';
import { MIST_COLORS } from './world/atmosphere';
import { createWorld } from './world';

const CAMERA_NEAR = 0.1;
/** Far enough for the sky dome (radius 450) and the whole terrain. */
const CAMERA_FAR = 900;
const HERO_ANCHOR_COUNT = 5;

function createScreenPoint(): ScreenPoint {
  return { x: 0, y: 0, visible: false };
}

/** Pre-filtered room lighting used for reflections. The source scene and generator are freed at once. */
function createEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const target = generator.fromScene(room, 0.04);
  room.dispose();
  generator.dispose();
  return target;
}

export const createScene: CreateScene = (canvas, content, options) => {
  const { reducedMotion } = options;
  let tier: QualityTier = options.quality;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: tier !== 'low',
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(MIST_COLORS.hero);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  const manager = new THREE.LoadingManager();
  const environmentTarget = createEnvironment(renderer);
  const environment = environmentTarget.texture;

  const ctx: SceneContext = { renderer, scene, camera, content, quality: tier, reducedMotion, manager, environment };

  const world = createWorld(ctx);
  const shards = createProjectShards(ctx);
  const portal = createPortal(ctx);
  const particles = createLinkParticles(ctx);
  const modules: SceneModule[] = [...world.modules, shards, portal, particles];
  for (const module of modules) scene.add(module.root);

  const rig = createCameraRig(camera);
  const postfx = createPostFx(renderer, scene, camera, TIER_SETTINGS[tier], reducedMotion);

  let width = canvas.clientWidth || window.innerWidth;
  let height = canvas.clientHeight || window.innerHeight;
  let lastChapter: FrameState['scroll']['chapter'] = 'hero';

  const heroWorld = Array.from({ length: HERO_ANCHOR_COUNT }, () => new THREE.Vector3());
  const heroScreen = Array.from({ length: HERO_ANCHOR_COUNT }, createScreenPoint);
  const noHeroPoints: ScreenPoint[] = [];
  const anchors: SceneAnchors = {
    heroPoints: noHeroPoints,
    project: {
      id: null,
      presence: 0,
      center: createScreenPoint(),
      title: createScreenPoint(),
      readout: createScreenPoint(),
      cta: createScreenPoint(),
    },
  };

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  function applySize(): void {
    const pixelRatio = Math.min(window.devicePixelRatio, TIER_SETTINGS[tier].pixelRatioCap);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    rig.setAspect(width / height);
    postfx.setSize(width, height, pixelRatio);
  }

  const governor = createQualityGovernor(tier, (next) => {
    tier = next;
    ctx.quality = next;
    postfx.applyTier(TIER_SETTINGS[next]);
    applySize();
  });

  /** Projects the HUD anchors with the matrices the frame was just rendered with. */
  function updateAnchors(frame: FrameState): void {
    const { chapter } = frame.scroll;
    const heroReady = chapter === 'hero' && frame.introProgress >= INTRO_HUD_START;
    if (heroReady) {
      world.monolith.getAnchorsWorld(heroWorld);
      for (let i = 0; i < HERO_ANCHOR_COUNT; i++) projectToScreen(heroWorld[i]!, camera, width, height, heroScreen[i]!);
      anchors.heroPoints = heroScreen;
    } else {
      anchors.heroPoints = noHeroPoints;
    }

    const project = anchors.project;
    if (chapter === 'projects') {
      const source = shards.getAnchorsWorld();
      project.id = source.id;
      project.presence = source.presence;
      projectToScreen(source.center, camera, width, height, project.center);
      projectToScreen(source.title, camera, width, height, project.title);
      projectToScreen(source.readout, camera, width, height, project.readout);
      projectToScreen(source.cta, camera, width, height, project.cta);
    } else {
      project.id = null;
      project.presence = 0;
    }
  }

  applySize();

  return {
    async load(onProgress) {
      const tracker = trackLoadProgress(manager, modules.length, onProgress);
      try {
        await Promise.all(modules.map((module) => module.init().then(tracker.moduleReady)));
        await renderer.compileAsync(scene, camera);
        tracker.compiled();
      } finally {
        tracker.dispose();
      }
    },

    update(frame) {
      governor.observe(performance.now());
      lastChapter = frame.scroll.chapter;

      rig.apply(frame);
      camera.updateMatrixWorld();
      for (const module of modules) module.update(frame);
      postfx.update(frame);
      postfx.render();
      updateAnchors(frame);
    },

    getAnchors: () => anchors,

    pickProject(ndcX, ndcY) {
      if (lastChapter !== 'projects') return null;
      pointer.set(ndcX, ndcY);
      raycaster.setFromCamera(pointer, camera);
      return shards.pick(raycaster);
    },

    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      applySize();
    },

    get quality() {
      return tier;
    },

    dispose() {
      for (const module of modules) {
        module.dispose();
        scene.remove(module.root);
      }
      postfx.dispose();
      environmentTarget.dispose();
      renderer.dispose();
    },
  };
};
