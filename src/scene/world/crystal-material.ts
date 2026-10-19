// Materials for the hero crystals (monolith slices, bracket shards, glowing core, edge lines).
// They are built-in three.js materials extended through onBeforeCompile so they keep the standard
// lighting, environment reflections and fog, and add:
//   - a world-Y dissolve with a hot edge (the intro "crystallise"),
//   - translucency: the shell is see-through dark glass, so the cyan core shows inside it, with a
//     fake thickness glow (brighter toward the core and at grazing angles) and a fresnel rim,
//   - glowing cut faces, so the seams between slices light up when the monolith breathes.
import * as THREE from 'three';
import { PALETTE } from '../../contracts';
import { GLSL_NOISE, insertAfter } from './shader-patch';

/** Dissolve front values at or above this skip the dissolve work entirely. */
const DISSOLVE_OFF = 50;

/** Uniforms shared by every crystal material, so one write drives them all. */
export interface CrystalUniforms {
  /** World height below which the crystal exists. DISSOLVE_OFF or more = fully formed. */
  uDissolveFront: { value: number };
  uRim: { value: THREE.Color };
}

export function createCrystalUniforms(): CrystalUniforms {
  return {
    uDissolveFront: { value: DISSOLVE_OFF },
    uRim: { value: new THREE.Color(PALETTE.cyan) },
  };
}

export function dissolveFrontFor(progress: number, bottom: number, top: number): number {
  return progress >= 1 ? DISSOLVE_OFF : bottom + (top - bottom) * progress;
}

const DISSOLVE_VERTEX_PARS = /* glsl */ `varying vec3 vCrystalWorld;`;
const DISSOLVE_VERTEX = /* glsl */ `vCrystalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

const DISSOLVE_FRAGMENT_PARS = /* glsl */ `
  varying vec3 vCrystalWorld;
  uniform float uDissolveFront;
  uniform vec3 uRim;
  ${GLSL_NOISE}
`;

const DISSOLVE_FRAGMENT = /* glsl */ `
  float dissolveHot = 0.0;
  if (uDissolveFront < ${DISSOLVE_OFF.toFixed(1)}) {
    // Noise bends the front so it crawls up the crystal instead of sweeping like a plane.
    float below = uDissolveFront + (valueNoise3(vCrystalWorld * 2.4) - 0.5) * 1.3 - vCrystalWorld.y;
    if (below < 0.0) discard;
    dissolveHot = 1.0 - smoothstep(0.0, 0.3, below);
  }
`;

function patchDissolve(shader: THREE.WebGLProgramParametersWithUniforms, shared: CrystalUniforms): void {
  shader.uniforms.uDissolveFront = shared.uDissolveFront;
  shader.uniforms.uRim = shared.uRim;
  insertAfter(shader, 'vertexShader', 'common', DISSOLVE_VERTEX_PARS);
  insertAfter(shader, 'vertexShader', 'begin_vertex', DISSOLVE_VERTEX);
  insertAfter(shader, 'fragmentShader', 'common', DISSOLVE_FRAGMENT_PARS);
  insertAfter(shader, 'fragmentShader', 'clipping_planes_fragment', DISSOLVE_FRAGMENT);
}

export interface CrystalMaterialOptions {
  environment: THREE.Texture;
  /** Each slice owns a material so its seam glow can differ; the compiled program is shared. */
  seam: { value: number };
}

const CRYSTAL_EMISSIVE = /* glsl */ `
  {
    vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
    float facing = saturate(dot(normal, normalize(vViewPosition)));
    // Light collects at grazing angles, where a real crystal's thick edges glow.
    float rim = pow(1.0 - facing, 4.5);

    // Fake thickness: the core lights the crystal from inside, so the glow dies off with the
    // distance from the monolith axis, and far walls seen through the near ones catch it too.
    float coreLight = exp(-length(vCrystalWorld.xz) * 1.1);
    float farWall = gl_FrontFacing ? 0.0 : 1.0;
    // Cut faces point straight up or down; they are what you see when a seam opens.
    float cut = smoothstep(0.9, 0.98, abs(worldNormal.y));

    // Each facet catches the inner light differently, which is what makes the body read as faceted.
    float facet = 0.5 + 0.5 * dot(worldNormal, normalize(vec3(-0.5, 0.25, 0.8)));
    float facetGain = 0.15 + 1.6 * facet * facet;

    vec3 glow = uRim * (0.006 + rim * 0.7 * facetGain + coreLight * (0.03 + 0.07 * facetGain) + farWall * coreLight * 0.06 + cut * uSeam * uSeam * (0.08 + 0.55 * coreLight));
    totalEmissiveRadiance += glow + uRim * dissolveHot * 4.0;

    // Glass is clearest face-on and turns opaque at grazing angles, where the rim glow sits.
    diffuseColor.a = mix(diffuseColor.a, 1.0, rim * 0.5);
  }
`;

/** Translucent dark navy glass with a clearcoat, lit by the environment, edged in cyan. */
export function createCrystalMaterial(shared: CrystalUniforms, options: CrystalMaterialOptions): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(PALETTE.void).lerp(new THREE.Color(PALETTE.navy), 0.3),
    metalness: 0.6,
    roughness: 0.2,
    clearcoat: 0.25,
    clearcoatRoughness: 0.1,
    flatShading: true,
    envMap: options.environment,
    envMapIntensity: 0.4,
    transparent: true,
    opacity: 0.74,
    // Three draws the back faces first and the front faces second for double-sided transparency,
    // which is what lets the far walls show through the near ones.
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    patchDissolve(shader, shared);
    shader.uniforms.uSeam = options.seam;
    insertAfter(shader, 'fragmentShader', 'common', 'uniform float uSeam;');
    insertAfter(shader, 'fragmentShader', 'emissivemap_fragment', CRYSTAL_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'crystal';
  return material;
}

/** Unlit, very bright cyan: the filament at the heart of the crystal, seen through the glass. */
export function createCoreMaterial(shared: CrystalUniforms): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.cyan).multiplyScalar(2.6), fog: true });
  material.onBeforeCompile = (shader) => patchDissolve(shader, shared);
  material.customProgramCacheKey = () => 'crystal-core';
  return material;
}

/** A soft haze around the core, so the inside of the glass looks lit rather than empty. */
export function createCoreHaloMaterial(shared: CrystalUniforms): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.cyan).multiplyScalar(0.07),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => patchDissolve(shader, shared);
  material.customProgramCacheKey = () => 'crystal-halo';
  return material;
}

/** Hairline facet edges. Additive so they glow against the dark glass instead of dimming it. */
export function createEdgeMaterial(shared: CrystalUniforms): THREE.LineBasicMaterial {
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(PALETTE.cyan),
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => patchDissolve(shader, shared);
  material.customProgramCacheKey = () => 'crystal-edges';
  return material;
}
