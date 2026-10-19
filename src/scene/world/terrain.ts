// The ground: a big displaced plane of dark basalt with faint cyan circuit traces and pulse rings
// that travel outward from the monolith. The circuitry is drawn in the fragment shader in world
// space, so it needs no textures and never stretches on the hills.
import * as THREE from 'three';
import { PALETTE, type FrameState, type SceneContext, type SceneModule } from '../../contracts';
import { idleTime, isHeroStageVisible } from '../engine/beats';
import { yieldToMain } from '../engine/async';
import { smoothstep } from '../engine/curves';
import type { AtmosphereState } from './atmosphere';
import type { Landscape } from './landscape';
import { GLSL_NOISE, insertAfter } from './shader-patch';

const SIZE = 220;
/** Rows displaced between yields to the browser. */
const ROWS_PER_SLICE = 32;

const VERTEX_PARS = /* glsl */ `varying vec3 vWorldPos;`;
const VERTEX_WORLD = /* glsl */ `vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

const FRAGMENT_PARS = /* glsl */ `
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform float uIgnite;
  uniform float uVeil;
  uniform vec3 uTrace;
  uniform float uBaseGlow;
  ${GLSL_NOISE}
`;

// Cells of CELL metres each may carry a horizontal and a vertical run through their middle.
// Neighbouring runs line up, so the lines read as routed copper that breaks wherever the random
// draw says so; cells with both runs get a solder pad.
const FRAGMENT_EMISSIVE = /* glsl */ `
  {
    vec2 wp = vWorldPos.xz;
    float r = length(wp);

    const float CELL = 1.7;
    vec2 id = floor(wp / CELL);
    vec2 local = fract(wp / CELL) - 0.5;
    float carryH = step(0.7, hash21(id));
    float carryV = step(0.7, hash21(id + 31.7));
    float width = 0.008;
    float lineH = carryH * (1.0 - smoothstep(width, width * 1.8, abs(local.y)));
    float lineV = carryV * (1.0 - smoothstep(width, width * 1.8, abs(local.x)));
    float pad = carryH * carryV * (1.0 - smoothstep(0.045, 0.075, length(local)));
    float trace = max(max(lineH, lineV), pad);

    // Islands of circuitry rather than a uniform grid. Traces gather around the monolith, thin out
    // with distance from it, and vanish near the camera so the foreground stays quiet.
    float patches = smoothstep(0.46, 0.66, valueNoise(wp * 0.07 + 3.0));
    float reach = smoothstep(2.5, 6.0, r) * (1.0 - smoothstep(20.0, 46.0, r));
    float nearCamera = smoothstep(8.0, 22.0, length(vWorldPos - cameraPosition));
    float towardBase = mix(0.3, 1.0, exp(-r * 0.1));
    trace *= patches * reach * nearCamera * towardBase;

    // Intro: the circuits ignite outward from the monolith behind a hot front.
    float front = uIgnite * 90.0;
    float lit = 1.0 - smoothstep(front - 8.0, front, r);
    float frontGlow = exp(-pow((r - front) / 1.8, 2.0)) * step(0.001, uIgnite) * (1.0 - smoothstep(0.92, 1.0, uIgnite));

    // Two pulse rings share the 9 s cycle, half a cycle apart.
    float phaseA = fract(uTime / 9.0) * 75.0;
    float phaseB = fract(uTime / 9.0 + 0.5) * 75.0;
    float pulse = exp(-pow((r - phaseA) / 2.2, 2.0)) * (1.0 - phaseA / 75.0)
                + exp(-pow((r - phaseB) / 2.2, 2.0)) * (1.0 - phaseB / 75.0);

    // Light from the monolith pooling on the ground around its base.
    totalEmissiveRadiance += uTrace * uBaseGlow * (0.3 * exp(-r * 0.5) + 0.05 * exp(-r * 0.12));
    totalEmissiveRadiance += uTrace * (trace * lit * (0.22 + pulse * 1.1 + frontGlow * 3.0) + frontGlow * 0.12 + pulse * lit * 0.025);
  }
`;

// The camera dives through this plane during the descent. Blending the ground into the mist
// beforehand means the crossing happens inside the whiteout instead of showing the ground's edge.
const FRAGMENT_VEIL = /* glsl */ `gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, uVeil);`;

export function createTerrain(ctx: SceneContext, landscape: Landscape, atmosphere: AtmosphereState): SceneModule {
  const uniforms = {
    uTime: { value: 0 },
    uIgnite: { value: 0 },
    uBaseGlow: { value: 0 },
    uVeil: { value: 0 },
    uTrace: { value: new THREE.Color(PALETTE.cyan) },
  };

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.surface).lerp(new THREE.Color(PALETTE.navy), 0.22),
    roughness: 0.86,
    metalness: 0.2,
    flatShading: true,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    insertAfter(shader, 'vertexShader', 'common', VERTEX_PARS);
    insertAfter(shader, 'vertexShader', 'begin_vertex', VERTEX_WORLD);
    insertAfter(shader, 'fragmentShader', 'common', FRAGMENT_PARS);
    insertAfter(shader, 'fragmentShader', 'emissivemap_fragment', FRAGMENT_EMISSIVE);
    insertAfter(shader, 'fragmentShader', 'fog_fragment', FRAGMENT_VEIL);
  };
  material.customProgramCacheKey = () => 'terrain-circuits';

  const root = new THREE.Group();
  root.name = 'terrain';
  let geometry: THREE.PlaneGeometry | null = null;

  return {
    root,

    async init() {
      const segments = ctx.quality === 'low' ? 128 : 256;
      const plane = new THREE.PlaneGeometry(SIZE, SIZE, segments, segments);
      plane.rotateX(-Math.PI / 2);

      const position = plane.getAttribute('position') as THREE.BufferAttribute;
      const rowLength = segments + 1;
      for (let row = 0; row <= segments; row += ROWS_PER_SLICE) {
        const end = Math.min(row + ROWS_PER_SLICE, segments + 1);
        for (let i = row * rowLength; i < end * rowLength; i++) {
          position.setY(i, landscape.heightAt(position.getX(i), position.getZ(i)));
        }
        await yieldToMain();
      }
      position.needsUpdate = true;
      plane.computeBoundingSphere();
      plane.computeBoundingBox();

      geometry = plane;
      const mesh = new THREE.Mesh(plane, material);
      mesh.name = 'terrain-mesh';
      root.add(mesh);
    },

    update(frame: FrameState) {
      root.visible = isHeroStageVisible(frame);
      if (!root.visible) return;
      uniforms.uTime.value = idleTime(frame);
      uniforms.uIgnite.value = smoothstep(0.12, 0.7, frame.introProgress);
      // The glow rises with the crystal, and after the return cut only once it is rebuilt.
      const rebuilt = frame.scroll.chapter === 'return' ? smoothstep(0.55, 0.95, frame.scroll.chapterProgress) : 1;
      uniforms.uBaseGlow.value = smoothstep(0.3, 0.75, frame.introProgress) * rebuilt * (0.85 + 0.15 * Math.sin(idleTime(frame) * ((Math.PI * 2) / 6)));
      uniforms.uVeil.value = atmosphere.groundVeil;
    },

    dispose() {
      geometry?.dispose();
      material.dispose();
    },
  };
}
