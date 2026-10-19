// Post-processing chain: scene render -> bloom -> finish (aberration, glitch, flash, grain,
// vignette) -> tone mapping and sRGB output. All motion-driven effects are derived from the frame
// state, so they scrub exactly like the camera does.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { WORLD, type FrameState } from '../../contracts';
import { returnFlash, returnRipple } from './beats';
import { clamp01, smoothstep } from './curves';
import { FINISH_SHADER } from './finish-shader';
import type { TierSettings } from './quality';

/** Scroll speed (virtual px/s) at which the velocity fringing reaches full strength. */
const FULL_ABERRATION_VELOCITY = 4000;
const GLITCH_DURATION = 0.9;
const GRAIN = 0.07;
const VIGNETTE = 0.55;

/** How close (world units) the camera must be to a portal ring for the aberration beat to fire. */
const RING_PASS_WIDTH = 2.4;

const FLASH_BRIGHT: readonly [number, number, number] = [0.85, 1.6, 1.9];
/** With reduced motion the "flash" is a slow dip to dark navy instead of a bright strobe. */
const FLASH_REDUCED: readonly [number, number, number] = [0.01, 0.03, 0.05];

export interface PostFx {
  /** CSS pixel size and the device pixel ratio the buffers should use. */
  setSize(width: number, height: number, pixelRatio: number): void;
  applyTier(settings: TierSettings): void;
  /** Derives every effect uniform from the frame; call after the camera rig has posed the camera. */
  update(frame: FrameState): void;
  render(): void;
  dispose(): void;
}

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  tier: TierSettings,
  reducedMotion: boolean,
): PostFx {
  const size = renderer.getSize(new THREE.Vector2());
  const pixelRatio = renderer.getPixelRatio();
  // Multisampling has to live on the composer's own targets: the canvas antialias flag only
  // affects the final blit, never the offscreen scene render.
  const target = new THREE.WebGLRenderTarget(size.x * pixelRatio, size.y * pixelRatio, {
    type: THREE.HalfFloatType,
    samples: tier.samples,
  });
  const composer = new EffectComposer(renderer, target);

  const bloom = new UnrealBloomPass(size, 0.5, 0.6, 1.0);
  bloom.enabled = tier.bloom;

  const finish = new ShaderPass(FINISH_SHADER);
  const uniforms = finish.uniforms as Record<string, { value: unknown }>;
  const flashColor = uniforms.uFlashColor!.value as number[];
  flashColor.splice(0, 3, ...(reducedMotion ? FLASH_REDUCED : FLASH_BRIGHT));
  uniforms.uVignette!.value = VIGNETTE;

  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(finish);
  composer.addPass(new OutputPass());

  let previousOpenProject: string | null = null;
  let glitchStart = -Infinity;

  /** Pulses as the camera flies through each ring of the portal stack. */
  function ringPassBeat(cameraY: number): number {
    let beat = 0;
    for (const ringY of WORLD.portal.rings) {
      const d = (cameraY - ringY) / RING_PASS_WIDTH;
      beat += Math.exp(-d * d);
    }
    return beat;
  }

  function aberrationFor(frame: FrameState): number {
    const { chapter, chapterProgress: p } = frame.scroll;
    let amount = 0.8 * clamp01(Math.abs(frame.scroll.velocity) / FULL_ABERRATION_VELOCITY);
    switch (chapter) {
      case 'descent':
        amount += 0.55 * smoothstep(0.05, 0.3, p) * (1 - smoothstep(0.55, 0.95, p));
        break;
      case 'portal':
        amount += 0.7 * ringPassBeat(camera.position.y);
        break;
      case 'return':
        amount += 0.9 * returnRipple(p);
        break;
    }
    return Math.min(amount, 1.4);
  }

  /** A 0 -> 1 -> 0 spike over GLITCH_DURATION, started when a project opens. */
  function glitchFor(frame: FrameState): number {
    if (previousOpenProject === null && frame.openProjectId !== null) glitchStart = frame.time;
    previousOpenProject = frame.openProjectId;
    const t = (frame.time - glitchStart) / GLITCH_DURATION;
    return t >= 0 && t <= 1 ? Math.sin(Math.PI * t) : 0;
  }

  return {
    setSize(width, height, ratio) {
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
      uniforms.uAspect!.value = width / height;
    },

    applyTier(settings) {
      bloom.enabled = settings.bloom;
      // Samples are baked into the GL render buffers; disposing makes the next frame reallocate.
      for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
        rt.samples = settings.samples;
        rt.dispose();
      }
    },

    update(frame) {
      // Reduced motion: no fringing, glitch or grain at all (the flash is handled by its colour).
      const motion = frame.reducedMotion ? 0 : 1;
      uniforms.uTime!.value = frame.time;
      uniforms.uAberration!.value = motion * aberrationFor(frame);
      uniforms.uGlitch!.value = motion * glitchFor(frame);
      uniforms.uGrain!.value = motion * GRAIN;
      uniforms.uFlash!.value = frame.scroll.chapter === 'return' ? returnFlash(frame.scroll.chapterProgress) : 0;
    },

    render() {
      composer.render();
    },

    dispose() {
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
    },
  };
}
