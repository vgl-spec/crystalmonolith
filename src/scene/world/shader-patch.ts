// Helpers for extending three.js built-in materials through onBeforeCompile. Built-in shaders are
// assembled from named chunks; we splice our code in next to a chunk. If a three.js upgrade renames
// a chunk the splice throws at compile time instead of silently dropping the effect.
import type * as THREE from 'three';

type Stage = 'vertexShader' | 'fragmentShader';

function insert(shader: THREE.WebGLProgramParametersWithUniforms, stage: Stage, chunk: string, code: string, where: 'after' | 'before'): void {
  const marker = `#include <${chunk}>`;
  const source = shader[stage];
  if (!source.includes(marker)) throw new Error(`Shader chunk <${chunk}> not found in ${stage}`);
  const replacement = where === 'after' ? `${marker}\n${code}` : `${code}\n${marker}`;
  shader[stage] = source.replace(marker, replacement);
}

export function insertAfter(shader: THREE.WebGLProgramParametersWithUniforms, stage: Stage, chunk: string, code: string): void {
  insert(shader, stage, chunk, code, 'after');
}

export function insertBefore(shader: THREE.WebGLProgramParametersWithUniforms, stage: Stage, chunk: string, code: string): void {
  insert(shader, stage, chunk, code, 'before');
}

/** GLSL value noise shared by the patched materials. Declared once per shader that needs it. */
export const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

float valueNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
`;
