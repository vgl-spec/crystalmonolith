// Visual test bench for the zone modules (project shards, portal, link particles), independent of
// the real engine. It builds its own renderer, environment and a simple stand-in for the camera
// rig, then drives the modules from query parameters and a scroll slider:
//
//   zone-lab.html?pos=<virtual px>&link=<index>&open=<project id>&q=<high|medium|low>&hud=0&bloom=0
//
// Bloom uses the engine's settings (strength 0.7, radius 0.65, threshold 0.7) so emissive levels can
// be judged here the way they will look in the real app; bloom=0 turns it off.
//
// Dev tool only: nothing in the shipped site imports this file.
import '@fontsource-variable/jetbrains-mono';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { buildChapterMap, CAMERA_FOV, PALETTE, resolvePosition, WORLD } from '../contracts';
import type { FrameState, QualityTier, SceneContext, SceneModule } from '../contracts';
import { SITE } from '../content/site';
import { createLinkParticles } from './links/particles';
import { createPortal } from './portal/portal';
import { createProjectShards } from './projects/shards';

/** Links progress over which the camera swings from top-down to the side view. */
const LINKS_SWING_END = 0.3;

const TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`zone-lab.html is missing #${id}`);
  return element as T;
}

const params = new URLSearchParams(window.location.search);
const map = buildChapterMap(SITE.projects.length);
const quality = TIERS.find((tier) => tier === params.get('q')) ?? 'high';
const openProjectId = SITE.projects.find((project) => project.id === params.get('open'))?.id ?? null;
let activeLinkIndex = THREE.MathUtils.clamp(Number.parseInt(params.get('link') ?? '0', 10) || 0, 0, SITE.links.length - 1);
let position = THREE.MathUtils.clamp(Number(params.get('pos') ?? 0) || 0, 0, map.loopLength - 1);

const canvas = requireElement<HTMLCanvasElement>('lab-canvas');
const hud = requireElement<HTMLElement>('lab-hud');
const readout = requireElement<HTMLElement>('lab-readout');
const slider = requireElement<HTMLInputElement>('lab-slider');
hud.hidden = params.get('hud') === '0';
slider.max = String(map.loopLength - 1);
slider.value = String(position);
slider.addEventListener('input', () => {
  position = Number(slider.value);
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.void);
scene.fog = new THREE.FogExp2(PALETTE.void, 0.01);
scene.add(new THREE.HemisphereLight(0x6fa8d8, 0x05070a, 0.5));
const keyLight = new THREE.DirectionalLight(0xbfe8ff, 1.2);
keyLight.position.set(3, 5, 6);
scene.add(keyLight);

const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 400);

const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.65, 0.7);
bloom.enabled = params.get('bloom') !== '0';
composer.addPass(bloom);
composer.addPass(new OutputPass());

const environmentGenerator = new THREE.PMREMGenerator(renderer);
const environmentScene = new RoomEnvironment();
const environment = environmentGenerator.fromScene(environmentScene, 0.04).texture;
environmentScene.dispose();
environmentGenerator.dispose();

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => {
  readout.textContent = `loading ${loaded}/${total}`;
};

const context: SceneContext = {
  renderer,
  scene,
  camera,
  content: SITE,
  quality,
  reducedMotion: false,
  manager,
  environment,
};

const shards = createProjectShards(context);
const portal = createPortal(context);
const particles = createLinkParticles(context);
const modules: SceneModule[] = [shards, portal, particles];

const frame: FrameState = {
  time: 0,
  dt: 0,
  scroll: { ...resolvePosition(map, position), position, absolute: position, velocity: 0 },
  pointer: { x: 0, y: 0 },
  introProgress: 1,
  openProjectId,
  activeLinkIndex,
  reducedMotion: false,
};

const pointerTarget = { x: 0, y: 0 };
window.addEventListener('pointermove', (event) => {
  pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointerTarget.y = -((event.clientY / window.innerHeight) * 2 - 1);
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') activeLinkIndex = (activeLinkIndex + 1) % SITE.links.length;
  if (event.key === 'ArrowLeft') activeLinkIndex = (activeLinkIndex + SITE.links.length - 1) % SITE.links.length;
});

const raycaster = new THREE.Raycaster();
let pickedId: string | null = null;
canvas.addEventListener('click', (event) => {
  raycaster.setFromCamera(
    new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1)),
    camera,
  );
  pickedId = shards.pick(raycaster);
});

/** Debug markers on the three HUD anchors, to check getAnchorsWorld() against the picture. */
const anchorMarkers = (['title', 'readout', 'cta'] as const).map((name) => {
  const marker = document.createElement('div');
  marker.className = 'lab-anchor';
  marker.innerHTML = `<span>${name}</span>`;
  marker.hidden = true;
  document.body.append(marker);
  return { name, marker };
});
const projected = new THREE.Vector3();

const projectsStation = {
  position: new THREE.Vector3(...WORLD.projects.camera.position),
  target: new THREE.Vector3(...WORLD.projects.camera.target),
};
const topDownPosition = new THREE.Vector3(...WORLD.links.cameraTopDown.position);
const sidePosition = new THREE.Vector3(...WORLD.links.cameraSide.position);
const linksTarget = new THREE.Vector3(...WORLD.links.cameraSide.target);
const portalLookTarget = new THREE.Vector3();

/** Stand-in for the engine's camera rig: each chapter's station, reproduced as simply as possible. */
function placeCamera(): void {
  const { chapter, chapterProgress } = frame.scroll;
  if (chapter === 'portal') {
    const y = THREE.MathUtils.lerp(WORLD.portal.top, topDownPosition.y, chapterProgress);
    // The small z offset keeps lookAt away from the degenerate straight-down case.
    camera.position.set(0, y, 0.01);
    camera.lookAt(portalLookTarget.set(0, y - 10, 0));
  } else if (chapter === 'links' || chapter === 'return') {
    const swing = chapter === 'return' ? 1 : THREE.MathUtils.smoothstep(chapterProgress, 0, LINKS_SWING_END);
    camera.position.lerpVectors(topDownPosition, sidePosition, swing);
    camera.lookAt(linksTarget);
  } else {
    camera.position.copy(projectsStation.position);
    camera.lookAt(projectsStation.target);
  }
}

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let lastTime = performance.now();
function tick(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  frame.dt = dt;
  frame.time += dt;
  frame.pointer.x = THREE.MathUtils.damp(frame.pointer.x, pointerTarget.x, 5, dt);
  frame.pointer.y = THREE.MathUtils.damp(frame.pointer.y, pointerTarget.y, 5, dt);
  frame.activeLinkIndex = activeLinkIndex;
  Object.assign(frame.scroll, resolvePosition(map, position), { position, absolute: position });

  placeCamera();
  camera.updateMatrixWorld();
  for (const module of modules) module.update(frame);
  composer.render();

  const anchors = shards.getAnchorsWorld();
  for (const { name, marker } of anchorMarkers) {
    projected.copy(anchors[name]).project(camera);
    marker.hidden = anchors.id === null || anchors.presence <= 0 || hud.hidden;
    marker.style.left = `${((projected.x + 1) / 2) * window.innerWidth}px`;
    marker.style.top = `${((1 - projected.y) / 2) * window.innerHeight}px`;
  }

  const { chapter, chapterProgress, projectFloat } = frame.scroll;
  readout.textContent =
    `${chapter} ${chapterProgress.toFixed(3)}  pos ${Math.round(position)}  projectFloat ${projectFloat.toFixed(2)}  ` +
    `link ${activeLinkIndex}  anchor ${anchors.id ?? '-'} (${anchors.presence.toFixed(2)})  picked ${pickedId ?? '-'}  ` +
    `cam y ${camera.position.y.toFixed(1)}  q ${quality}`;
  slider.value = String(Math.round(position));
  requestAnimationFrame(tick);
}

Promise.all(modules.map((module) => module.init())).then(() => {
  for (const module of modules) scene.add(module.root);
  document.body.dataset.ready = 'true';
  requestAnimationFrame(tick);
});
