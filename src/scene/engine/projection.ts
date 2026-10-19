// World point -> CSS pixel projection for the HUD anchors. Writes into caller-owned objects so the
// per-frame anchor pass allocates nothing.
import * as THREE from 'three';
import type { ScreenPoint } from '../../contracts';

const scratch = new THREE.Vector3();

export function projectToScreen(
  world: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  out: ScreenPoint,
): void {
  // View space first: after the perspective divide a point behind the camera looks like one in
  // front of it, so "in front" has to be decided before projecting.
  scratch.copy(world).applyMatrix4(camera.matrixWorldInverse);
  const inFront = scratch.z < -camera.near;
  scratch.applyMatrix4(camera.projectionMatrix);
  out.x = (scratch.x * 0.5 + 0.5) * width;
  out.y = (-scratch.y * 0.5 + 0.5) * height;
  out.visible = inFront && Math.abs(scratch.x) <= 1 && Math.abs(scratch.y) <= 1;
}
