// Descent streaks: thin additive cyan lines rushing upward past the camera while it sinks through
// the mist. They live in a fixed vertical band and the camera falls through it, so most of the
// sense of speed is real parallax; the shader adds a slow upward drift and stretches the lines
// with scroll speed.
import * as THREE from 'three';
import { PALETTE, type FrameState, type SceneContext, type SceneModule } from '../../contracts';
import { smoothstep } from '../engine/curves';
import { createRandom } from '../engine/random';

const BAND = { bottom: -55, top: -5 } as const;
/** The camera falls along the hero camera's vertical line; streaks surround it. */
const CENTRE_Z = 11;
const MIN_RADIUS = 1.2;
const MAX_RADIUS = 16;
/** Scroll speed (virtual px/s) per extra unit of streak stretch. */
const STRETCH_PER_VELOCITY = 1 / 1500;
const MAX_STRETCH = 4;

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uStretch;
  uniform vec2 uBand;
  attribute float aEnd;
  attribute float aSeed;
  attribute float aLength;
  varying float vAlpha;

  void main() {
    float span = uBand.y - uBand.x;
    float y = uBand.x + mod(position.y - uBand.x + uTime * (1.2 + aSeed * 2.4), span);
    vec3 p = vec3(position.x, y + aEnd * aLength * uStretch, position.z);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    // Streaks fade at both ends of the band so they never pop, and brighten toward their head.
    float edge = smoothstep(0.0, 5.0, y - uBand.x) * smoothstep(0.0, 5.0, uBand.y - y);
    vAlpha = edge * uOpacity * (0.35 + aSeed * 0.65) * mix(0.08, 1.0, aEnd);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor * vAlpha, vAlpha);
  }
`;

export function createStreaks(ctx: SceneContext): SceneModule {
  const count = ctx.quality === 'low' ? 260 : 520;
  const random = createRandom(9001);

  const positions = new Float32Array(count * 2 * 3);
  const ends = new Float32Array(count * 2);
  const seeds = new Float32Array(count * 2);
  const lengths = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    // Squaring biases streaks toward the camera line, where they read as fast.
    const radius = MIN_RADIUS + Math.pow(random(), 2) * (MAX_RADIUS - MIN_RADIUS);
    const x = Math.cos(angle) * radius;
    const z = CENTRE_Z + Math.sin(angle) * radius;
    const y = BAND.bottom + random() * (BAND.top - BAND.bottom);
    const seed = random();
    const length = 1.5 + random() * 4.5;
    for (let end = 0; end < 2; end++) {
      const v = i * 2 + end;
      positions.set([x, y, z], v * 3);
      ends[v] = end;
      seeds[v] = seed;
      lengths[v] = length;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aLength', new THREE.BufferAttribute(lengths, 1));

  const uniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uStretch: { value: 1 },
    uBand: { value: new THREE.Vector2(BAND.bottom, BAND.top) },
    uColor: { value: new THREE.Color(PALETTE.cyan).lerp(new THREE.Color(PALETTE.ink), 0.25).multiplyScalar(1.5) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'descent-streaks';
  // The shader moves the vertices, so the static bounds are meaningless.
  lines.frustumCulled = false;

  const root = new THREE.Group();
  root.name = 'streaks';
  root.add(lines);

  return {
    root,
    async init() {},
    update(frame: FrameState) {
      const { chapter, chapterProgress: p } = frame.scroll;
      const opacity = chapter === 'descent' && !frame.reducedMotion ? smoothstep(0.06, 0.3, p) * (1 - smoothstep(0.78, 1, p)) : 0;
      root.visible = opacity > 0.001;
      if (!root.visible) return;

      uniforms.uTime.value = frame.time;
      uniforms.uOpacity.value = opacity;
      uniforms.uStretch.value = Math.min(MAX_STRETCH, 1 + Math.abs(frame.scroll.velocity) * STRETCH_PER_VELOCITY);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
