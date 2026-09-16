import { REST_ANGLE, TILT_ANGLE } from "./types";

export interface Point2 { x: number; y: number }
export interface Point3 extends Point2 { z: number }
export interface Polyhedron { vertices: Point3[]; faces: number[][] }
export const CHAMBER_RADIUS = 0.44;
export const CHAMBER_BACK = 0.10;
export const CHAMBER_END = 1.60;
export const BEVEL_SLOPE = 1.8;
export const LIP_HEIGHT = -0.15;
export const CHAMBER_SEGMENTS = 40;
export const CHAMBER_CAPACITY = 2.25;
export const CHAMBER_DEPTH = CHAMBER_RADIUS * 2;
export const PIVOT_HEIGHT = 1.62;
export const FEED_X = 1.20;
export const FEED_Z = 0;
export const FEED_Y = 2.72;
export const COUNTERWEIGHT_MASS = 1.6;
export const EMPTY_CHAMBER_MOMENT = 0.18;
export const OUTLET: Point3 = { x: CHAMBER_END + BEVEL_SLOPE * CHAMBER_RADIUS, y: -CHAMBER_RADIUS, z: 0 };
export const SLOW_OUTLET: Point3 = { x: CHAMBER_BACK, y: -CHAMBER_RADIUS, z: 0 };
export const RIM_SPILL_POINT: Point3 = { x: CHAMBER_END - BEVEL_SLOPE * LIP_HEIGHT, y: LIP_HEIGHT, z: 0 };

export function rotatePoint<T extends Point2>(point: T, angle: number): T {
  const bodyAngle = REST_ANGLE - angle;
  const c = Math.cos(bodyAngle), s = Math.sin(bodyAngle);
  return { ...point, x: c * point.x - s * point.y, y: s * point.x + c * point.y };
}

function localGeometry() {
  const vertices: Point3[] = [];
  for (const front of [false, true]) {
    for (let i = 0; i < CHAMBER_SEGMENTS; i++) {
      const theta = 2 * Math.PI * i / CHAMBER_SEGMENTS;
      const y = CHAMBER_RADIUS * Math.cos(theta), z = CHAMBER_RADIUS * Math.sin(theta);
      vertices.push({ x: front ? CHAMBER_END - BEVEL_SLOPE * y : CHAMBER_BACK, y, z });
    }
  }
  const faces: number[][] = [];
  faces.push(Array.from({ length: CHAMBER_SEGMENTS }, (_, i) => CHAMBER_SEGMENTS - 1 - i));
  for (let i = 0; i < CHAMBER_SEGMENTS; i++) {
    const next = (i + 1) % CHAMBER_SEGMENTS;
    faces.push([i, next, next + CHAMBER_SEGMENTS, i + CHAMBER_SEGMENTS]);
  }
  const mouth = vertices.slice(CHAMBER_SEGMENTS);
  const lip = clipFace(mouth, p => p.y - LIP_HEIGHT).polygon;
  const opening = clipFace(mouth, p => LIP_HEIGHT - p.y).polygon;
  return { vertices, faces, mouth, lip, opening,
    closedFaces: [...faces, Array.from({ length: CHAMBER_SEGMENTS }, (_, i) => i + CHAMBER_SEGMENTS)] };
}

function clipFace(face: readonly Point3[], distance: (p: Point3) => number) {
  const polygon: Point3[] = [], cut: Point3[] = [];
  for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    const da = distance(a), db = distance(b);
    if (da <= 0) polygon.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      const intersection = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
      polygon.push(intersection);
      cut.push(intersection);
    }
  }
  return { polygon, cut };
}

const LOCAL = localGeometry();
/** Open shell faces exclude the virtual mouth plane; lip closes its lower part. */
export function chamberGeometry() { return LOCAL; }

function measure(faces: readonly Point3[][]) {
  let volume = 0, x = 0, y = 0, z = 0;
  for (const face of faces) {
    const a = face[0];
    if (!a) continue;
    for (let i = 1; i < face.length - 1; i++) {
      const b = face[i], c = face[i + 1];
      const tetra = (a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x)) / 6;
      volume += tetra;
      x += tetra * (a.x + b.x + c.x) / 4;
      y += tetra * (a.y + b.y + c.y) / 4;
      z += tetra * (a.z + b.z + c.z) / 4;
    }
  }
  return { volume, centroid: volume > 1e-15 ? { x: x / volume, y: y / volume, z: z / volume } : { x: 0, y: 0, z: 0 } };
}
const LOCAL_VOLUME = measure(LOCAL.closedFaces.map(f => f.map(i => LOCAL.vertices[i]))).volume;
const NORMALIZED_PER_GEOMETRIC = CHAMBER_CAPACITY / LOCAL_VOLUME;

let cachedFacesAngle = NaN, cachedFaces: { vertices: Point3[]; faces: Point3[][] } | undefined;
function worldFaces(angle: number) {
  if (cachedFaces && angle === cachedFacesAngle) return cachedFaces;
  const vertices = LOCAL.vertices.map(p => rotatePoint(p, angle));
  cachedFaces = { vertices, faces: LOCAL.closedFaces.map(face => face.map(i => vertices[i])) };
  cachedFacesAngle = angle;
  return cachedFaces;
}

function clipped(faces: readonly Point3[][], level: number) {
  const result: Point3[][] = [];
  const cut = new Map<string, Point3>();
  for (const face of faces) {
    const section = clipFace(face, p => p.y - level);
    if (section.polygon.length >= 3) result.push(section.polygon);
    for (const p of section.cut) cut.set(`${Math.round(p.x * 1e10)},${Math.round(p.z * 1e10)}`, { ...p, y: level });
  }
  const surface = [...cut.values()];
  if (surface.length >= 3) {
    const cx = surface.reduce((sum, p) => sum + p.x, 0) / surface.length;
    const cz = surface.reduce((sum, p) => sum + p.z, 0) / surface.length;
    surface.sort((a, b) => Math.atan2(b.z - cz, b.x - cx) - Math.atan2(a.z - cz, a.x - cx));
    result.push(surface);
  }
  return { faces: result, surface };
}

function indexed(faces: Point3[][]): Polyhedron {
  const vertices: Point3[] = [];
  const indices = faces.map(face => face.map(p => { vertices.push(p); return vertices.length - 1; }));
  return { vertices, faces: indices };
}

/** Water is a clipped faceted cylinder, with a WORLD-horizontal free surface. */
export function waterSection(volume: number, angle: number) {
  if (!Number.isFinite(volume) || volume < 0 || volume > CHAMBER_CAPACITY + 1e-12)
    throw new RangeError(`Stored volume ${volume} is outside the chamber capacity.`);
  const world = worldFaces(angle);
  let low = Math.min(...world.vertices.map(p => p.y));
  let high = Math.max(...world.vertices.map(p => p.y));
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (measure(clipped(world.faces, middle).faces).volume * NORMALIZED_PER_GEOMETRIC < volume) low = middle;
    else high = middle;
  }
  const level = (low + high) / 2;
  const water = volume === 0 ? { faces: [], surface: [] } : clipped(world.faces, level);
  const metric = measure(water.faces);
  const mesh = indexed(water.faces);
  return { ...mesh, surface: water.surface, level, centroid: metric.centroid,
    volume: metric.volume * NORMALIZED_PER_GEOMETRIC };
}

/** Waterline of a stored volume as it sits on the vessel in the receiving pose,
 * returned in the vessel's own frame so a drawn mark tilts with the reservoir. */
export function receivingWaterline(volume: number): Point3[] {
  const phi = REST_ANGLE, c = Math.cos(phi), s = Math.sin(phi);
  return waterSection(volume, 0).surface.map(p =>
    ({ x: c * p.x + s * p.y, y: c * p.y - s * p.x, z: p.z }));
}

/** Lowest point of the genuinely OPEN part of the mouth, above the retaining lip. */
export function rimSpillPoint(angle: number): Point3 {
  return LOCAL.opening.map(p => rotatePoint(p, angle)).reduce((lowest, p) => p.y < lowest.y ? p : lowest);
}
const rimCache = new Map<number, number>();
// Place the tetrahedral origin on the spill plane. The closing cap then has
// identically zero signed volume, so capacity needs no surface sort or rotation.
const RIM_RELATIVE_FACES = LOCAL.closedFaces.map(face => face.map(i => ({
  x: LOCAL.vertices[i].x - RIM_SPILL_POINT.x,
  y: LOCAL.vertices[i].y - RIM_SPILL_POINT.y,
  z: LOCAL.vertices[i].z,
})));
export function rimCapacity(angle: number): number {
  const cached = rimCache.get(angle);
  if (cached !== undefined) return cached;
  const phi = REST_ANGLE - angle, c = Math.cos(phi), s = Math.sin(phi);
  let volume = 0;
  for (const face of RIM_RELATIVE_FACES) {
    const polygon = clipFace(face, p => s * p.x + c * p.y).polygon;
    const a = polygon[0];
    if (!a) continue;
    for (let i = 1; i < polygon.length - 1; i++) {
      const b = polygon[i], d = polygon[i + 1];
      volume += (a.x * (b.y * d.z - b.z * d.y) + a.y * (b.z * d.x - b.x * d.z) + a.z * (b.x * d.y - b.y * d.x)) / 6;
    }
  }
  const capacity = volume * NORMALIZED_PER_GEOMETRIC;
  if (angle === 0 || angle === TILT_ANGLE) rimCache.set(angle, capacity);
  return capacity;
}

/** A fixed vertical ray intersects the bevel in its open region, above the lip. */
export function inletCapture(angle: number, x = FEED_X, z = FEED_Z) {
  const phi = REST_ANGLE - angle, c = Math.cos(phi), s = Math.sin(phi);
  const y = (CHAMBER_END * c - x) / (BEVEL_SLOPE * c + s);
  const local = { x: CHAMBER_END - BEVEL_SLOPE * y, y, z };
  const point = rotatePoint(local, angle);
  // Use the actual faceted aperture cross section, not an idealized circle.
  let inside = y >= LIP_HEIGHT - 1e-12;
  for (let i = 0; i < CHAMBER_SEGMENTS; i++) {
    const a = LOCAL.mouth[i], b = LOCAL.mouth[(i + 1) % CHAMBER_SEGMENTS];
    if ((b.y - a.y) * (z - a.z) - (b.z - a.z) * (y - a.y) < -1e-12) inside = false;
  }
  return { captured: inside && FEED_Y > point.y + PIVOT_HEIGHT, point, local };
}

/** Front drain is dry while the mouth points upwards, so its gate opens only
 * after the cylinder passes horizontal. The full tipped coefficient is still κ.
 */
export function openingForAngle(angle: number): number {
  return Math.max(0, Math.min(1, (angle - REST_ANGLE) / (TILT_ANGLE - REST_ANGLE)));
}

/** Fixed slow-leak pore: the lowest visible point of the closed end of the chamber. */
export const SLOW_LEAK_LOCAL: Point3 = { x: CHAMBER_BACK + 0.13, y: -CHAMBER_RADIUS + 0.012, z: 0.085 };

/** The perforated underside leaks from one fixed pore, not from a moving wetted line. */
export function slowLeakPoint(angle: number): Point3 {
  return rotatePoint(SLOW_LEAK_LOCAL, angle);
}

/** The drip is only drawn while its fixed pore stays below the free surface. */
export function slowLeakWet(level: number, angle: number): boolean {
  return level > slowLeakPoint(angle).y + 1e-9;
}

const weightCache = new Map<number, number>();
export function counterweightPosition(threshold: number): number {
  const cached = weightCache.get(threshold);
  if (cached !== undefined) return cached;
  const centroid = waterSection(threshold, 0).centroid;
  const x = -(threshold * centroid.x + EMPTY_CHAMBER_MOMENT) / (COUNTERWEIGHT_MASS * Math.cos(REST_ANGLE));
  if (weightCache.size >= 256) weightCache.delete(weightCache.keys().next().value!);
  weightCache.set(threshold, x);
  return x;
}

export function thresholdFromCounterweight(x: number): number {
  let low = 0.55, high = 1.65;
  let xLow = counterweightPosition(low), xHigh = counterweightPosition(high);
  if (x >= xLow) return low;
  if (x <= xHigh) return high;
  for (let i = 0; i < 20; i++) {
    const fraction = Math.max(0.05, Math.min(0.95, (x - xLow) / (xHigh - xLow)));
    const mid = low + (high - low) * fraction;
    const xMid = counterweightPosition(mid);
    if (Math.abs(xMid - x) < 1e-10) return mid;
    if (xMid > x) { low = mid; xLow = xMid; } else { high = mid; xHigh = xMid; }
  }
  return (low + high) / 2;
}
export const thresholdForCounterweight = thresholdFromCounterweight;
