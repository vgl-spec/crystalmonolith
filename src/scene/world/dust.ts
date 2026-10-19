// Slow drifting dust motes around the monolith: a few hundred soft additive points that rise and
// sway, so the still hero scene always has something alive in it. The motion is entirely in the
// vertex shader; the CPU only advances one time uniform per frame.
import * as THREE from 'three';
import { PALETTE, type SceneContext, type SceneModule } from '../../contracts';
import { idleTime, isHeroStageVisible } from '../engine/beats';
import { createRandom } from '../engine/random';

const VOLUME = { x: 16, z: 13, height: 9 } as const;
const FLOOR = 0.25;
/** Point diameter at one world unit from the camera, in world units. */
const MOTE_SIZE = 0.05;

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uFloor;
  uniform float uScale;
  uniform float uSize;
  attribute float aSeed;
  varying float vAlpha;

  void main() {
    float rise = mod(position.y + uTime * (0.1 + aSeed * 0.22), uHeight);
    vec3 p = vec3(
      position.x + sin(uTime * 0.31 + aSeed * 31.0) * 0.6,
      uFloor + rise,
      position.z + cos(uTime * 0.23 + aSeed * 17.0) * 0.6
    );
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(uSize * uScale / -viewPosition.z, 1.0, 8.0);

    float twinkle = 0.65 + 0.35 * sin(uTime * (0.8 + aSeed * 2.0) + aSeed * 50.0);
    float lifeFade = smoothstep(0.0, 1.5, rise) * (1.0 - smoothstep(uHeight - 2.0, uHeight, rise));
    vAlpha = (0.25 + 0.75 * aSeed) * twinkle * lifeFade;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float disc = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
    float a = disc * vAlpha;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export function createDust(ctx: SceneContext): SceneModule {
  const count = ctx.quality === 'low' ? 120 : 260;
  const random = createRandom(555);

  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (random() * 2 - 1) * VOLUME.x;
    positions[i * 3 + 1] = random() * VOLUME.height;
    positions[i * 3 + 2] = (random() * 2 - 1) * VOLUME.z - 2;
    seeds[i] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uHeight: { value: VOLUME.height },
    uFloor: { value: FLOOR },
    uScale: { value: 1 },
    uSize: { value: MOTE_SIZE },
    uColor: { value: new THREE.Color(PALETTE.cyan).lerp(new THREE.Color(PALETTE.ink), 0.35) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'dust';
  // The shader displaces every point, so the static bounding sphere says nothing about the result.
  points.frustumCulled = false;

  const root = new THREE.Group();
  root.name = 'dust-root';
  root.add(points);

  const bufferSize = new THREE.Vector2();

  return {
    root,
    async init() {},
    update(frame) {
      root.visible = isHeroStageVisible(frame);
      if (!root.visible) return;

      uniforms.uTime.value = idleTime(frame);
      // Pixels per world unit at one unit of distance: keeps motes the same apparent size at any resolution.
      ctx.renderer.getDrawingBufferSize(bufferSize);
      uniforms.uScale.value = bufferSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
