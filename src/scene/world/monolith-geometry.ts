// Procedural geometry for the monolith: ONE irregular crystal, cut into slices. The body is the
// convex hull of a few strongly jittered rings (widest about a third of the way up, narrowing to
// an asymmetric tip), so its facets are long, uneven and never a regular prism. It is then cut by
// slightly tilted planes into slices of uneven height. Each slice is the exact piece of the body
// between two cuts, nudged and turned a hair at rest so the edges of neighbouring slices do not
// line up, which is what makes the stack read as a split crystal rather than a tower of blocks.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { createRandom } from '../engine/random';

/** Slice heights from the base up. Uneven on purpose; the last one holds the tip. */
const SLICE_HEIGHTS = [0.62, 1.0, 0.72, 0.92, 0.6, 0.86, 0.7, 1.1] as const;
/** Gap between neighbouring slices at rest: a hairline the cyan seam light shows through. */
const REST_GAP = 0.045;
/** Largest slope of a cut plane, so seams are never perfectly horizontal. */
const SEAM_TILT = 0.22;

/**
 * Body outline as rings, bottom to top. `y` is a fraction of the total height; the widest ring sits
 * a third of the way up. Rings are offset from the axis so the crystal leans a little.
 */
const BODY_RINGS: readonly { y: number; radius: number; jitter: number; count: number; twist: number; centre: readonly [number, number] }[] = [
  { y: 0, radius: 0.95, jitter: 0.32, count: 5, twist: 0, centre: [0, 0] },
  { y: 0.33, radius: 1.25, jitter: 0.4, count: 5, twist: 0.45, centre: [0.18, -0.1] },
  { y: 0.62, radius: 0.8, jitter: 0.38, count: 5, twist: 0.9, centre: [-0.2, 0.12] },
  { y: 0.86, radius: 0.34, jitter: 0.3, count: 4, twist: 1.3, centre: [0.18, 0.05] },
];
/** Single points pushed out of the body at [x, y fraction, z]: broken-off spurs that make it lopsided. */
const SPURS: readonly (readonly [number, number, number])[] = [
  [1.35, 0.2, 0.35],
  [-1.1, 0.52, -0.45],
];
/** The tip, off the axis: a sharp, asymmetric point. */
const TIP_OFFSET: readonly [number, number] = [0.42, -0.26];

/** Quantisation used to drop duplicate points before hulling. */
const POINT_PRECISION = 1e4;

export interface MonolithSlice {
  /** Hull geometry centred on its own centroid, so a slice can turn in place. */
  geometry: THREE.BufferGeometry;
  /** Where the centroid sits when the monolith is assembled. */
  restPosition: THREE.Vector3;
  /** The slice's small resting turn; identity would line every edge up with its neighbours. */
  restQuaternion: THREE.Quaternion;
}

export interface MonolithShape {
  slices: MonolithSlice[];
  height: number;
}

/** A half-space as a signed value: >= 0 means the point is kept. */
type HalfSpace = (p: THREE.Vector3) => number;

function buildBodyPoints(random: () => number, height: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (const ring of BODY_RINGS) {
    for (let i = 0; i < ring.count; i++) {
      const angle = ring.twist + ((i + (random() - 0.5) * 0.75) / ring.count) * Math.PI * 2;
      const radius = ring.radius * (1 - ring.jitter + random() * ring.jitter * 2);
      points.push(
        new THREE.Vector3(
          ring.centre[0] + Math.cos(angle) * radius,
          ring.y * height + (random() - 0.5) * 0.5,
          ring.centre[1] + Math.sin(angle) * radius,
        ),
      );
    }
  }
  for (const [x, y, z] of SPURS) points.push(new THREE.Vector3(x, y * height, z));
  points.push(new THREE.Vector3(TIP_OFFSET[0], height, TIP_OFFSET[1]));
  return points;
}

/** Triangle corner positions of a non-indexed hull geometry. */
function triangles(geometry: THREE.BufferGeometry): THREE.Vector3[][] {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const result: THREE.Vector3[][] = [];
  for (let i = 0; i < position.count; i += 3) {
    result.push([0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(position, i + k)));
  }
  return result;
}

/**
 * The part of a convex body inside every half-space, as the points of its hull: body vertices that
 * pass, plus where body edges cross each cutting plane (kept only if they pass the others).
 */
function clipPoints(body: THREE.Vector3[][], keep: HalfSpace[]): THREE.Vector3[] {
  const EPS = 1e-6;
  const inside = (p: THREE.Vector3) => keep.every((g) => g(p) >= -EPS);
  const unique = new Map<string, THREE.Vector3>();
  const add = (p: THREE.Vector3) => {
    const key = `${Math.round(p.x * POINT_PRECISION)},${Math.round(p.y * POINT_PRECISION)},${Math.round(p.z * POINT_PRECISION)}`;
    if (!unique.has(key)) unique.set(key, p.clone());
  };

  for (const triangle of body) {
    for (let e = 0; e < 3; e++) {
      const a = triangle[e]!;
      const b = triangle[(e + 1) % 3]!;
      if (inside(a)) add(a);
      for (const g of keep) {
        const ga = g(a);
        const gb = g(b);
        if ((ga < 0) !== (gb < 0)) {
          const crossing = a.clone().lerp(b, ga / (ga - gb));
          if (inside(crossing)) add(crossing);
        }
      }
    }
  }
  return [...unique.values()];
}

export function buildMonolithShape(seed: number): MonolithShape {
  const random = createRandom(seed);
  const count = SLICE_HEIGHTS.length;
  const height = SLICE_HEIGHTS.reduce((sum, h) => sum + h, 0) + REST_GAP * (count - 1);

  const body = triangles(new ConvexGeometry(buildBodyPoints(random, height)));

  // Cut plane k separates slice k-1 from slice k: y = centre + slopeX * x + slopeZ * z.
  const cuts: { centre: number; slopeX: number; slopeZ: number }[] = [];
  let cursor = 0;
  for (let k = 0; k < count - 1; k++) {
    cursor += SLICE_HEIGHTS[k]!;
    cuts.push({
      centre: cursor + REST_GAP / 2,
      slopeX: (random() * 2 - 1) * SEAM_TILT,
      slopeZ: (random() * 2 - 1) * SEAM_TILT,
    });
    cursor += REST_GAP;
  }
  const planeHeight = (cut: (typeof cuts)[number], p: THREE.Vector3) => cut.centre + cut.slopeX * p.x + cut.slopeZ * p.z;

  const slices: MonolithSlice[] = [];
  for (let i = 0; i < count; i++) {
    const keep: HalfSpace[] = [];
    const below = cuts[i - 1];
    const above = cuts[i];
    if (below) keep.push((p) => p.y - planeHeight(below, p) - REST_GAP / 2);
    if (above) keep.push((p) => planeHeight(above, p) - p.y - REST_GAP / 2);

    const points = clipPoints(body, keep);
    const centroid = new THREE.Vector3();
    for (const p of points) centroid.add(p);
    centroid.divideScalar(points.length);
    for (const p of points) p.sub(centroid);

    const restPosition = centroid.clone();
    restPosition.x += (random() - 0.5) * 0.16;
    restPosition.z += (random() - 0.5) * 0.16;
    const restQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((random() - 0.5) * 0.08, (random() - 0.5) * 0.34, (random() - 0.5) * 0.08),
    );
    slices.push({ geometry: new ConvexGeometry(points), restPosition, restQuaternion });
  }

  return { slices, height };
}
