// The sky dome: a gradient from the mist at the horizon up to the void at the zenith, a faint teal
// and blue aurora band, and a sparse star field. It is centred on the camera every frame so it is
// always infinitely far away. Below the terrain (projects, portal, links) it collapses to a plain
// dark mist gradient, which is what the crystals and the portal are lit against.
import * as THREE from 'three';
import { PALETTE, type SceneContext, type SceneModule } from '../../contracts';
import { idleTime } from '../engine/beats';
import type { AtmosphereState } from './atmosphere';
import { GLSL_NOISE } from './shader-patch';

const DOME_RADIUS = 450;

const VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uUnderworld;
  uniform float uFlat;
  uniform vec3 uMist;
  uniform vec3 uZenith;
  uniform vec3 uAuroraA;
  uniform vec3 uAuroraB;
  uniform vec3 uForward;
  uniform vec3 uGlow;
  varying vec3 vDirection;

  ${GLSL_NOISE}

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += valueNoise(p) * amp;
      p *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float h = dir.y;

    // Mist at the horizon, void overhead. The mist is the fog colour so distant terrain melts in.
    vec3 col = mix(uMist, uZenith, pow(smoothstep(0.0, 0.55, h), 0.75));
    col += uMist * 0.55 * exp(-max(h, 0.0) * 9.0);

    // Below the terrain the mist glows softly where the camera looks: the backlight for the crystals.
    vec3 under = mix(uZenith * 1.6, uMist, smoothstep(-0.6, 0.5, h));
    under += uGlow * pow(max(dot(dir, uForward), 0.0), 4.0);

    if (uUnderworld < 0.999) {
      // Aurora: a soft curtain whose height wavers with the azimuth.
      float azimuth = atan(dir.x, dir.z);
      float band = exp(-pow((h - 0.2) / 0.1, 2.0));
      float curtain = fbm(vec2(azimuth * 2.4 + uTime * 0.02, h * 7.0 - uTime * 0.012));
      float rays = smoothstep(0.3, 0.85, fbm(vec2(azimuth * 11.0 + uTime * 0.035, h * 1.4)));
      col += mix(uAuroraA, uAuroraB, curtain) * band * curtain * (0.35 + 0.65 * rays) * 0.5;

      // A teal halo low behind the monolith separates its silhouette from the ridges.
      col += uAuroraA * 0.12 * pow(max(dot(dir, normalize(vec3(0.0, 0.14, -1.0))), 0.0), 40.0);

      // Stars: one point per jittered cell, twinkling, only above the horizon haze.
      vec3 cellPos = dir * 170.0;
      vec3 cell = floor(cellPos);
      float chance = hash31(cell);
      float twinkle = 0.65 + 0.35 * sin(uTime * (1.0 + chance * 3.0) + chance * 60.0);
      float star = step(0.9965, chance) * smoothstep(0.38, 0.0, length(fract(cellPos) - 0.5));
      col += vec3(0.55, 0.8, 1.0) * star * twinkle * smoothstep(0.04, 0.35, h) * 0.8;
    }

    // The descent whiteout flattens the sky to the mist colour, so nothing but streaks is left to see.
    col = mix(col, uMist, uFlat);
    gl_FragColor = vec4(mix(col, under, uUnderworld), 1.0);
  }
`;

export function createSky(ctx: SceneContext, atmosphere: AtmosphereState): SceneModule {
  const uniforms = {
    uTime: { value: 0 },
    uUnderworld: { value: 0 },
    uFlat: { value: 0 },
    uMist: { value: atmosphere.color.clone() },
    uZenith: { value: new THREE.Color(PALETTE.void) },
    uAuroraA: { value: new THREE.Color(PALETTE.teal).multiplyScalar(0.55) },
    uAuroraB: { value: new THREE.Color(PALETTE.blue).multiplyScalar(0.5) },
    uForward: { value: new THREE.Vector3(0, 0, -1) },
    uGlow: { value: new THREE.Color(PALETTE.navy).multiplyScalar(0.55) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 48, 32), material);
  dome.name = 'sky';
  // Drawn first and never culled: it is centred on the camera, so it is always around it.
  dome.renderOrder = -1000;
  dome.frustumCulled = false;

  const root = new THREE.Group();
  root.name = 'sky-root';
  root.add(dome);

  return {
    root,
    async init() {},
    update(frame) {
      dome.position.copy(ctx.camera.position);
      uniforms.uTime.value = idleTime(frame);
      uniforms.uUnderworld.value = atmosphere.underworld;
      uniforms.uFlat.value = atmosphere.whiteout;
      // The horizon blends toward the live fog colour so terrain and sky never show a seam.
      uniforms.uMist.value.copy(atmosphere.color);
      ctx.camera.getWorldDirection(uniforms.uForward.value);
    },
    dispose() {
      dome.geometry.dispose();
      material.dispose();
    },
  };
}
