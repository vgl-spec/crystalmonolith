// Low ground mist: a few translucent noise sheets hovering just above the terrain, drifting at
// different speeds. They soften the horizon, give the ground depth, and leave a clearing around
// the monolith so its base and the circuit traces stay readable.
import * as THREE from 'three';
import type { SceneContext, SceneModule } from '../../contracts';
import { idleTime, isHeroStageVisible } from '../engine/beats';
import type { AtmosphereState } from './atmosphere';
import { GLSL_NOISE } from './shader-patch';

const SIZE = 220;

interface SheetSpec {
  height: number;
  /** Noise frequency in cycles per world unit. */
  scale: number;
  drift: readonly [number, number];
  opacity: number;
}

const SHEETS: readonly SheetSpec[] = [
  { height: 0.3, scale: 0.035, drift: [0.12, 0.04], opacity: 0.26 },
  { height: 0.7, scale: 0.05, drift: [-0.08, 0.1], opacity: 0.2 },
  { height: 1.2, scale: 0.027, drift: [0.05, -0.07], opacity: 0.14 },
];

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uOpacity;
  uniform vec2 uDrift;
  uniform vec3 uColor;
  uniform vec3 uCamera;
  varying vec3 vWorld;

  ${GLSL_NOISE}

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
      sum += valueNoise(p) * amp;
      p = p * 2.07 + 11.3;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    float cloud = smoothstep(0.36, 0.78, fbm(vWorld.xz * uScale + uDrift * uTime));
    float fromCamera = length(vWorld.xz - uCamera.xz);
    // Mist only builds up beyond the monolith's distance from the camera, so it never veils the crystal.
    float fade = smoothstep(17.0, 36.0, fromCamera) * (1.0 - smoothstep(60.0, 105.0, fromCamera));
    float clearing = smoothstep(2.5, 10.0, length(vWorld.xz));
    gl_FragColor = vec4(uColor, cloud * fade * clearing * uOpacity);
  }
`;

export function createMist(ctx: SceneContext, atmosphere: AtmosphereState): SceneModule {
  const specs = ctx.quality === 'low' ? SHEETS.slice(0, 2) : SHEETS;
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE);
  geometry.rotateX(-Math.PI / 2);

  const root = new THREE.Group();
  root.name = 'mist';
  const materials = specs.map((spec) => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: spec.scale },
        uOpacity: { value: spec.opacity },
        uDrift: { value: new THREE.Vector2(...spec.drift) },
        uColor: { value: new THREE.Color() },
        uCamera: { value: new THREE.Vector3() },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const sheet = new THREE.Mesh(geometry, material);
    sheet.position.y = spec.height;
    sheet.frustumCulled = false;
    root.add(sheet);
    return material;
  });

  return {
    root,
    async init() {},
    update(frame) {
      root.visible = isHeroStageVisible(frame);
      if (!root.visible) return;

      // Mist is the fog colour, lifted: lit from within by the glow of the world above it.
      const time = idleTime(frame);
      for (const material of materials) {
        material.uniforms.uTime!.value = time;
        (material.uniforms.uColor!.value as THREE.Color).copy(atmosphere.color).multiplyScalar(2.6);
        (material.uniforms.uCamera!.value as THREE.Vector3).copy(ctx.camera.position);
      }
    },
    dispose() {
      geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
