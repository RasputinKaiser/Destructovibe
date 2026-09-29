import { vec3 } from 'math';
import { quickhull3 } from 'math/geometry';
import type { MaterialId, Vec3 } from '../types';
import { randomStream } from '../physics/physics.ts';

/* Convex polyhedra as explicit face lists (CCW from outside). Fracture = clipping the
   parent by Voronoi bisector planes, which keeps faces exact and lets every face remember
   whether it is original surface (exterior) or a fresh break (interior). */

export interface Face {
  pts: number[];      // flat xyz, CCW seen from outside
  n: Vec3;            // outward unit normal
  d: number;          // n·x = d on the face
  ext: boolean;
  tag: number;        // -1 original/parent surface, otherwise neighbouring seed index
}

export interface Poly { faces: Face[] }

export interface Cell {
  poly: Poly;
  volume: number;
  centroid: Vec3;
  /** index of the seed that owns this cell */
  seed: number;
  /** neighbouring seed index → shared face area */
  shared: Map<number, number>;
}

const EPS = 1e-6;
/* fracture seeds draw from a stream that restarts with each world, so a level replays its breaks */
export const rand = randomStream(0x5eed1234);

export function boxPoly(hx: number, hy: number, hz: number): Poly {
  const f = (n: Vec3, d: number, pts: number[]): Face => ({ pts, n, d, ext: true, tag: -1 });
  return {
    faces: [
      f([1, 0, 0], hx, [hx, -hy, -hz, hx, hy, -hz, hx, hy, hz, hx, -hy, hz]),
      f([-1, 0, 0], hx, [-hx, -hy, -hz, -hx, -hy, hz, -hx, hy, hz, -hx, hy, -hz]),
      f([0, 1, 0], hy, [-hx, hy, -hz, -hx, hy, hz, hx, hy, hz, hx, hy, -hz]),
      f([0, -1, 0], hy, [-hx, -hy, -hz, hx, -hy, -hz, hx, -hy, hz, -hx, -hy, hz]),
      f([0, 0, 1], hz, [-hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz]),
      f([0, 0, -1], hz, [-hx, -hy, -hz, -hx, hy, -hz, hx, hy, -hz, hx, -hy, -hz]),
    ],
  };
}

export function cylinderPoly(r: number, h: number, sides = 16): Poly {
  const hy = h / 2;
  const faces: Face[] = [];
  const top: number[] = [], bot: number[] = [];
  const rc = r / Math.cos(Math.PI / sides);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
    const x0 = Math.cos(a0) * rc, z0 = Math.sin(a0) * rc, x1 = Math.cos(a1) * rc, z1 = Math.sin(a1) * rc;
    faces.push({
      pts: [x0, -hy, z0, x0, hy, z0, x1, hy, z1, x1, -hy, z1],
      n: [Math.cos(am), 0, Math.sin(am)], d: r, ext: true, tag: -1,
    });
    top.push(x0, hy, z0);
    bot.unshift(x0, -hy, z0);
  }
  faces.push({ pts: reverseLoop(top), n: [0, 1, 0], d: hy, ext: true, tag: -1 });
  faces.push({ pts: reverseLoop(bot), n: [0, -1, 0], d: hy, ext: true, tag: -1 });
  return { faces };
}

/* Convex hull of arbitrary points (voussoirs, wedges, spire facets). Coplanar hull triangles are
   merged into single polygon faces so fracture UVs and exterior tagging stay clean. */
export function hullPoly(points: number[]): Poly | null {
  if (points.length < 12) return null;
  const tris = quickhull3(points);
  if (tris.length < 12) return null;
  let cx = 0, cy = 0, cz = 0;
  const m = points.length / 3;
  for (let i = 0; i < m; i++) { cx += points[i * 3]; cy += points[i * 3 + 1]; cz += points[i * 3 + 2]; }
  cx /= m; cy /= m; cz /= m;
  const planes: { n: Vec3; d: number; pts: number[] }[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = points[b] - points[a], uy = points[b + 1] - points[a + 1], uz = points[b + 2] - points[a + 2];
    const vx = points[c] - points[a], vy = points[c + 1] - points[a + 1], vz = points[c + 2] - points[a + 2];
    const n: Vec3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-12) continue;
    vec3.scale(n, n, 1 / l);
    if (n[0] * (points[a] - cx) + n[1] * (points[a + 1] - cy) + n[2] * (points[a + 2] - cz) < 0) vec3.negate(n, n);
    const d = n[0] * points[a] + n[1] * points[a + 1] + n[2] * points[a + 2];
    let pl = planes.find(q => vec3.dot(q.n, n) > 1 - 1e-6 && Math.abs(q.d - d) < 1e-5);
    if (!pl) { pl = { n, d, pts: [] }; planes.push(pl); }
    for (const k of [a, b, c]) pl.pts.push(points[k], points[k + 1], points[k + 2]);
  }
  const faces: Face[] = planes.map(q => ({ pts: orderLoop(dedupe(q.pts), q.n), n: q.n, d: q.d, ext: true, tag: -1 }));
  return faces.length >= 4 ? { faces } : null;
}

export function wedgePoly(hx: number, hy: number, hz: number): Poly | null {
  return hullPoly([-hx, -hy, -hz, hx, -hy, -hz, -hx, hy, -hz, -hx, -hy, hz, hx, -hy, hz, -hx, hy, hz]);
}

function reverseLoop(p: number[]): number[] {
  const o: number[] = [];
  for (let i = p.length - 3; i >= 0; i -= 3) o.push(p[i], p[i + 1], p[i + 2]);
  return o;
}

/* Keep the half-space n·x <= d. */
export function clip(poly: Poly, n: Vec3, d: number, tag: number): Poly {
  const faces: Face[] = [];
  const cap: number[] = [];
  let cut = false;
  for (const f of poly.faces) {
    const p = f.pts, m = p.length / 3;
    const out: number[] = [];
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2];
      const bx = p[j * 3], by = p[j * 3 + 1], bz = p[j * 3 + 2];
      const da = n[0] * ax + n[1] * ay + n[2] * az - d;
      const db = n[0] * bx + n[1] * by + n[2] * bz - d;
      if (da <= EPS) out.push(ax, ay, az);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        const t = da / (da - db);
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
        out.push(x, y, z);
        cap.push(x, y, z);
        cut = true;
      } else if (Math.abs(da) <= EPS) {
        cap.push(ax, ay, az);
      }
      if (da > EPS) cut = true;
    }
    if (out.length >= 9) faces.push({ pts: out, n: f.n, d: f.d, ext: f.ext, tag: f.tag });
  }
  if (!cut) return poly;
  const capPts = dedupe(cap);
  if (capPts.length >= 9) faces.push({ pts: orderLoop(capPts, n), n: [n[0], n[1], n[2]], d, ext: false, tag });
  return { faces };
}

function dedupe(p: number[]): number[] {
  const o: number[] = [];
  outer: for (let i = 0; i < p.length; i += 3) {
    for (let j = 0; j < o.length; j += 3) {
      if (Math.abs(o[j] - p[i]) < 1e-5 && Math.abs(o[j + 1] - p[i + 1]) < 1e-5 && Math.abs(o[j + 2] - p[i + 2]) < 1e-5) continue outer;
    }
    o.push(p[i], p[i + 1], p[i + 2]);
  }
  return o;
}

const _u: Vec3 = [0, 0, 0], _v: Vec3 = [0, 0, 0], _c: Vec3 = [0, 0, 0];
function orderLoop(p: number[], n: Vec3): number[] {
  const m = p.length / 3;
  vec3.set(_c, 0, 0, 0);
  for (let i = 0; i < m; i++) { _c[0] += p[i * 3]; _c[1] += p[i * 3 + 1]; _c[2] += p[i * 3 + 2]; }
  vec3.scale(_c, _c, 1 / m);
  vec3.perpendicular(_u, n);
  vec3.cross(_v, n, _u);
  const idx = Array.from({ length: m }, (_, i) => i);
  const ang = idx.map(i => {
    const x = p[i * 3] - _c[0], y = p[i * 3 + 1] - _c[1], z = p[i * 3 + 2] - _c[2];
    return Math.atan2(x * _v[0] + y * _v[1] + z * _v[2], x * _u[0] + y * _u[1] + z * _u[2]);
  });
  idx.sort((a, b) => ang[a] - ang[b]);
  const o: number[] = [];
  for (const i of idx) o.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  return o;
}

export function uniqueVerts(poly: Poly): number[] {
  const all: number[] = [];
  for (const f of poly.faces) for (const x of f.pts) all.push(x);
  return dedupe(all);
}

export function volumeCentroid(poly: Poly, out: Vec3): number {
  let ox = 0, oy = 0, oz = 0, cnt = 0;
  for (const f of poly.faces) for (let i = 0; i < f.pts.length; i += 3) { ox += f.pts[i]; oy += f.pts[i + 1]; oz += f.pts[i + 2]; cnt++; }
  ox /= cnt; oy /= cnt; oz /= cnt;
  let vol = 0, cx = 0, cy = 0, cz = 0;
  for (const f of poly.faces) {
    const p = f.pts;
    for (let i = 1; i + 1 < p.length / 3; i++) {
      const ax = p[0] - ox, ay = p[1] - oy, az = p[2] - oz;
      const bx = p[i * 3] - ox, by = p[i * 3 + 1] - oy, bz = p[i * 3 + 2] - oz;
      const qx = p[i * 3 + 3] - ox, qy = p[i * 3 + 4] - oy, qz = p[i * 3 + 5] - oz;
      const v = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
      vol += v;
      cx += v * (ax + bx + qx) / 4; cy += v * (ay + by + qy) / 4; cz += v * (az + bz + qz) / 4;
    }
  }
  if (vol > 1e-12) vec3.set(out, ox + cx / vol, oy + cy / vol, oz + cz / vol);
  else vec3.set(out, ox, oy, oz);
  return vol;
}

export function translate(poly: Poly, t: Vec3): Poly {
  return {
    faces: poly.faces.map(f => {
      const pts = f.pts.slice();
      for (let i = 0; i < pts.length; i += 3) { pts[i] += t[0]; pts[i + 1] += t[1]; pts[i + 2] += t[2]; }
      return { pts, n: f.n, d: f.d + vec3.dot(f.n, t), ext: f.ext, tag: f.tag };
    }),
  };
}

export function bounds(poly: Poly, min: Vec3, max: Vec3): void {
  vec3.set(min, Infinity, Infinity, Infinity);
  vec3.set(max, -Infinity, -Infinity, -Infinity);
  for (const f of poly.faces) for (let i = 0; i < f.pts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = f.pts[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
}

export function contains(poly: Poly, p: Vec3, margin = 0): boolean {
  for (const f of poly.faces) if (vec3.dot(f.n, p) > f.d - margin) return false;
  return true;
}

function faceArea(f: Face): number {
  const p = f.pts;
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i + 1 < p.length / 3; i++) {
    const ux = p[i * 3] - p[0], uy = p[i * 3 + 1] - p[1], uz = p[i * 3 + 2] - p[2];
    const wx = p[i * 3 + 3] - p[0], wy = p[i * 3 + 4] - p[1], wz = p[i * 3 + 5] - p[2];
    ax += uy * wz - uz * wy; ay += uz * wx - ux * wz; az += ux * wy - uy * wx;
  }
  return Math.hypot(ax, ay, az) / 2;
}

/* Seeds: a cluster around the impact (small shards there) plus uniform fill (big slabs away from it).
   Thin walls, floor slabs and sheet metal need planar cracks: isotropic 3-D sampling rejects
   most impact seeds outside their narrow thickness and silently turns a local hole into a
   uniform whole-panel shatter. Keep the through-thickness scatter inside the solid instead. */
export function makeSeeds(poly: Poly, impact: Vec3, count: number, clusterFrac: number, clusterRadius: number): Vec3[] {
  const min: Vec3 = [0, 0, 0], max: Vec3 = [0, 0, 0];
  bounds(poly, min, max);
  const seeds: Vec3[] = [];
  const p: Vec3 = [0, 0, 0];
  const nCluster = Math.round(count * clusterFrac);
  const span: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const scatter: Vec3 = span.map(w => Math.min(clusterRadius, w * 0.3)) as Vec3;
  const centre: Vec3 = impact.map((x, k) => Math.max(min[k] + span[k] * 0.12, Math.min(max[k] - span[k] * 0.12, x))) as Vec3;
  const separated = (): boolean => seeds.every(s => vec3.squaredDistance(s, p) > 0.0016);
  const uniform = (): boolean => {
    for (let t = 0; t < 30; t++) {
      vec3.set(p, min[0] + rand() * (max[0] - min[0]), min[1] + rand() * (max[1] - min[1]), min[2] + rand() * (max[2] - min[2]));
      if (contains(poly, p, 0.005) && separated()) return true;
    }
    return false;
  };
  for (let i = 0; i < count; i++) {
    let ok = false;
    if (i < nCluster) {
      for (let t = 0; t < 24 && !ok; t++) {
        const g = gauss3(1);
        vec3.set(p, centre[0] + g[0] * scatter[0], centre[1] + g[1] * scatter[1], centre[2] + g[2] * scatter[2]);
        ok = contains(poly, p, 0.005) && separated();
      }
    }
    if (!ok) ok = uniform();
    if (ok) seeds.push([p[0], p[1], p[2]]);
  }
  return seeds;
}

function gauss3(s: number): Vec3 {
  const g = (): number => {
    const u = Math.max(1e-9, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return [g() * s, g() * s, g() * s];
}

/* metric scales each local axis before measuring distance; <1 on an axis stretches cells along it. */
export function voronoi(parent: Poly, seeds: Vec3[], metric: Vec3): Cell[] {
  /* Faces inherited from an earlier fracture still carry that fracture's seed tags; they must not
     read as shared faces of this one, or fragments get welded to strangers (or themselves). */
  const poly: Poly = { faces: parent.faces.map(f => (f.tag === -1 ? f : { ...f, tag: -1 })) };
  const cells: Cell[] = [];
  const sc = seeds.map(s => [s[0] * metric[0], s[1] * metric[1], s[2] * metric[2]] as Vec3);
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < seeds.length; i++) {
    const order = seeds.map((_, j) => j).filter(j => j !== i)
      .sort((a, b) => vec3.squaredDistance(sc[i], sc[a]) - vec3.squaredDistance(sc[i], sc[b]));
    let cell = poly;
    for (const j of order) {
      const np0 = sc[j][0] - sc[i][0], np1 = sc[j][1] - sc[i][1], np2 = sc[j][2] - sc[i][2];
      const dp = np0 * (sc[i][0] + sc[j][0]) / 2 + np1 * (sc[i][1] + sc[j][1]) / 2 + np2 * (sc[i][2] + sc[j][2]) / 2;
      vec3.set(n, np0 * metric[0], np1 * metric[1], np2 * metric[2]);
      const len = vec3.length(n);
      if (len < 1e-9) continue;
      cell = clip(cell, [n[0] / len, n[1] / len, n[2] / len], dp / len, j);
      if (cell.faces.length < 4) break;
    }
    if (cell.faces.length < 4) continue;
    const centroid: Vec3 = [0, 0, 0];
    const volume = volumeCentroid(cell, centroid);
    if (volume < 1e-7) continue;
    const shared = new Map<number, number>();
    for (const f of cell.faces) if (f.tag >= 0) shared.set(f.tag, (shared.get(f.tag) ?? 0) + faceArea(f));
    cells.push({ poly: cell, volume, centroid, seed: i, shared });
  }
  return cells;
}

/* ---------------- render mesh ----------------
   Render geometry only: physics keeps the plain hull. Exterior edges get a small chamfer whose
   vertex normals blend the neighbouring faces (reads as a rounded arris under GTAO/specular);
   fracture faces are tessellated and displaced by a height field evaluated in the parent's texture
   frame along a sign-canonical normal, so the two cells either side of a crack carry the same
   surface and the exterior lip of the crack comes out jagged. */

export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  /** 1 on bevel strips (edge-wear mask), 0 elsewhere */
  wear: Float32Array;
  index: Uint32Array;
  extCount: number;   // vertices in group 0
  intCount: number;   // vertices in group 1 (stored after group 0)
  extIndex: number;   // indices in group 0
  intIndex: number;   // indices in group 1, relative to the group's first vertex
  /** present when built without a material, so the batch layer can rebuild it with one */
  src?: { poly: Poly; uvOrigin: Vec3; cyl: CylInfo | null };
}

export interface CylInfo { r: number; ax: number; az: number }

export type MeshDetail = 0 | 1 | 2;
let detail: MeshDetail = 1;
/** low = flat hulls, medium = bevels + coarse fracture relief, high = full relief */
export function setMeshDetail(q: 'low' | 'medium' | 'high'): void {
  detail = q === 'high' ? 2 : q === 'medium' ? 1 : 0;
}
export function meshDetail(): MeshDetail { return detail; }

const ROCK = 0, FIBER = 1, CONCH = 2, TEAR = 3;
interface Surf { bevel: number; amp: number; freq: number; kind: number }
const sf = (bevel: number, amp: number, freq: number, kind: number): Surf => ({ bevel, amp, freq, kind });
/* bevel = chamfer leg (m), amp = fracture relief amplitude (m), freq = relief features per metre */
const SURF: Record<MaterialId, Surf> = {
  concrete: sf(0.015, 0.022, 5, ROCK),
  rconcrete: sf(0.015, 0.022, 5, ROCK),
  brick: sf(0.01, 0.018, 7, ROCK),
  cinderblock: sf(0.008, 0.02, 6, ROCK),
  stone: sf(0.022, 0.02, 3.5, ROCK),
  sandstone: sf(0.018, 0.025, 6, ROCK),
  marble: sf(0.008, 0.012, 3, CONCH),
  terracotta: sf(0.008, 0.012, 6, CONCH),
  ceramic: sf(0.004, 0.006, 6, CONCH),
  asphalt: sf(0.004, 0.015, 7, ROCK),
  copper: sf(0.003, 0.006, 12, TEAR),
  adobe: sf(0.025, 0.03, 4, ROCK),
  plaster: sf(0.008, 0.012, 6, ROCK),
  drywall: sf(0.003, 0.008, 9, ROCK),
  wood: sf(0.006, 0.03, 9, FIBER),
  oak: sf(0.008, 0.028, 8, FIBER),
  plywood: sf(0.003, 0.018, 10, FIBER),
  steel: sf(0.004, 0.008, 12, TEAR),
  castiron: sf(0.005, 0.012, 5, CONCH),
  aluminum: sf(0.003, 0.007, 12, TEAR),
  metal: sf(0.002, 0.005, 12, TEAR),
  glass: sf(0.003, 0, 6, CONCH),
  tempered: sf(0.003, 0, 10, ROCK),
  roof: sf(0.005, 0.012, 7, ROCK),
  crate: sf(0.006, 0.025, 9, FIBER),
  barrel: sf(0.008, 0.006, 12, TEAR),
  propane: sf(0.008, 0.006, 12, TEAR),
  tnt: sf(0.006, 0.02, 9, FIBER),
  pvc: sf(0.003, 0.006, 10, TEAR),
  insulation: sf(0.004, 0.01, 8, ROCK),
  frp: sf(0.002, 0.004, 14, FIBER),
  cardboard: sf(0.002, 0.006, 10, TEAR),
  rubber: sf(0.006, 0.004, 6, TEAR),
  lamp: sf(0.002, 0.003, 10, CONCH),
  machine: sf(0.008, 0.01, 8, TEAR),
};

/* fixed lattice tables (deterministic across sessions so crack faces never change) */
const PERM = new Uint8Array(512), LAT = new Float32Array(256);
{
  let h = 0x9e3779b9;
  const next = (): number => { h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) LAT[i] = next() * 2 - 1;
}
const hash3 = (x: number, y: number, z: number): number => LAT[PERM[PERM[PERM[x & 255] + (y & 255)] + (z & 255)]];

const lerp1 = (a: number, b: number, t: number): number => a + (b - a) * t;

/* value noise in [-1, 1] */
function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = lerp1;
  return l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy),
    fz);
}

function fbm(x: number, y: number, z: number, oct: number): number {
  let s = 0, a = 0.6, t = 0;
  for (let o = 0; o < oct; o++) {
    s += a * vnoise(x, y, z); t += a;
    x = x * 2.03 + 11.7; y = y * 2.03 - 5.3; z = z * 2.03 + 3.1; a *= 0.5;
  }
  return s / t;
}

const spike = (v: number, e: number): number => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));

/* Height in [-1, 1] at texture-frame point p. c is the crack's canonical normal (shared by both
   sides), g the grain axis for timber. */
function reliefAt(s: Surf, x: number, y: number, z: number, c: Vec3, g: number): number {
  const f = s.freq;
  switch (s.kind) {
    case FIBER: {
      const sx = g === 0 ? 0.1 : 1, sy = g === 1 ? 0.1 : 1, sz = g === 2 ? 0.1 : 1;
      const n = fbm(x * f * sx, y * f * sy, z * f * sz, 3) * 2.2;
      // across the grain the break is splinters (spiky); along it, stretched ridges
      return Math.max(-1, Math.min(1, spike(n, Math.abs(c[g]) > 0.6 ? 0.5 : 0.8)));
    }
    case CONCH: {
      const lo = fbm(x * f, y * f, z * f, 2) * 1.8;
      return Math.max(-1, Math.min(1, 0.6 * lo + 0.4 * Math.sin(lo * 9 + 1.3)));
    }
    case TEAR:
      return Math.max(-1, Math.min(1, spike(fbm(x * f, y * f, z * f, 2) * 2.2, 0.6)));
    default: {
      const n = fbm(x * f, y * f, z * f, 3) * 2;
      const r = 1 - 2 * Math.abs(vnoise(x * f * 2.3 + 17, y * f * 2.3 - 9, z * f * 2.3 + 4));
      return Math.max(-1, Math.min(1, 0.75 * n + 0.3 * r));
    }
  }
}

const BEVEL_TAG = -2;

const len3 = (x: number, y: number, z = 0): number => Math.sqrt(x * x + y * y + z * z);

/* Chamfer every exterior-exterior edge sharper than ~20° with a plane at leg length b. The result
   is the intersection of half-spaces, so it stays convex whatever order the cuts go in. */
function bevelPoly(poly: Poly, b: number): Poly {
  const fs = poly.faces, cuts: number[] = [];
  const e: Vec3 = [0, 0, 0], t: Vec3 = [0, 0, 0];
  for (let i = 0; i < fs.length; i++) {
    const fi = fs[i];
    if (!fi.ext) continue;
    for (let j = i + 1; j < fs.length; j++) {
      const fj = fs[j];
      if (!fj.ext || vec3.dot(fi.n, fj.n) > 0.94) continue;
      const p = fi.pts;
      let a = -1, hits = 0;
      for (let k = 0; k < p.length; k += 3) {
        if (Math.abs(fj.n[0] * p[k] + fj.n[1] * p[k + 1] + fj.n[2] * p[k + 2] - fj.d) < 1e-4) { if (a < 0) a = k; hits++; }
      }
      if (hits < 2) continue;
      vec3.cross(e, fi.n, fj.n);
      vec3.cross(t, fi.n, e);
      if (vec3.dot(t, fj.n) > 0) vec3.negate(t, t);
      vec3.normalize(t, t);
      let mx = fi.n[0] + fj.n[0], my = fi.n[1] + fj.n[1], mz = fi.n[2] + fj.n[2];
      const ml = len3(mx, my, mz);
      if (ml < 1e-6) continue;
      mx /= ml; my /= ml; mz /= ml;
      const depth = -b * (mx * t[0] + my * t[1] + mz * t[2]);
      cuts.push(mx, my, mz, mx * p[a] + my * p[a + 1] + mz * p[a + 2] - depth);
    }
  }
  if (!cuts.length) return poly;
  let out = poly;
  for (let i = 0; i < cuts.length; i += 4) {
    out = clip(out, [cuts[i], cuts[i + 1], cuts[i + 2]], cuts[i + 3], BEVEL_TAG);
    if (out.faces.length < 4) return poly;
  }
  for (const f of out.faces) if (f.tag === BEVEL_TAG) f.ext = true;
  return out;
}

/* Intact level pieces repeat a handful of shapes; only their UVs differ, so reuse the cut poly. */
const bevelCache = new Map<string, Poly>();
function bevelCached(poly: Poly, b: number): Poly {
  if (poly.faces.some(f => !f.ext)) return bevelPoly(poly, b);
  let key = `${Math.round(b * 1e5)}`;
  for (const f of poly.faces) {
    key += '|';
    for (const x of f.pts) key += `${Math.round(x * 1e5)},`;
  }
  let rp = bevelCache.get(key);
  if (!rp) {
    if (bevelCache.size > 2048) bevelCache.clear();
    rp = bevelPoly(poly, b);
    bevelCache.set(key, rp);
  }
  return rp;
}

function folds(vp: number[], tri: number[], n: Vec3): boolean {
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const wx = vp[c] - vp[a], wy = vp[c + 1] - vp[a + 1], wz = vp[c + 2] - vp[a + 2];
    if ((uy * wz - uz * wy) * n[0] + (uz * wx - ux * wz) * n[1] + (ux * wy - uy * wx) * n[2] <= 1e-12) return true;
  }
  return false;
}

/* Ear clipping of a CCW (about n) loop projected onto its plane; null if it is not simple. */
function earClip(p: number[], n: Vec3): number[] | null {
  const m = p.length / 3, u: Vec3 = [0, 0, 0], v: Vec3 = [0, 0, 0];
  vec3.perpendicular(u, n);
  vec3.cross(v, n, u);
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < m; i++) {
    x.push(p[i * 3] * u[0] + p[i * 3 + 1] * u[1] + p[i * 3 + 2] * u[2]);
    y.push(p[i * 3] * v[0] + p[i * 3 + 1] * v[1] + p[i * 3 + 2] * v[2]);
  }
  const area2 = (a: number, b: number, c: number): number => (x[b] - x[a]) * (y[c] - y[a]) - (y[b] - y[a]) * (x[c] - x[a]);
  const live = Array.from({ length: m }, (_, i) => i), out: number[] = [];
  let guard = m * m;
  while (live.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < live.length; i++) {
      const a = live[(i + live.length - 1) % live.length], b = live[i], c = live[(i + 1) % live.length];
      if (area2(a, b, c) <= 1e-14) continue;
      let inside = false;
      for (const q of live) {
        if (q === a || q === b || q === c) continue;
        if (area2(a, b, q) >= 0 && area2(b, c, q) >= 0 && area2(c, a, q) >= 0) { inside = true; break; }
      }
      if (inside) continue;
      out.push(a, b, c);
      live.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null;
  }
  if (live.length === 3) {
    if (area2(live[0], live[1], live[2]) <= 1e-14) return null;
    out.push(live[0], live[1], live[2]);
  }
  return out;
}

class Out {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; wear: number[] = []; idx: number[] = [];
  get n(): number { return this.pos.length / 3; }
}

/* uvOrigin: this poly's origin expressed in the texture frame, so textures (and fracture relief)
   stay continuous across fragments and neighbouring pieces. cyl: exterior side faces get smooth
   radial normals and wrapped UVs around the axis at (ax, az) in this poly's local frame.
   mat selects bevel size and fracture character; without it the mesh is flat and carries `src`.
   grain: timber grain axis in the local frame (defaults to the poly's longest extent). */
export function buildMesh(poly: Poly, uvOrigin: Vec3, cyl: CylInfo | null, mat?: MaterialId, grain?: number): MeshData {
  const s = mat ? SURF[mat] : null;
  const md = s && detail > 0 ? detailed(poly, uvOrigin, cyl, s, grain) : flatMesh(poly, uvOrigin, cyl);
  if (!mat) md.src = { poly, uvOrigin, cyl };
  return md;
}

/* low quality: one fan per face, straight into typed arrays */
function flatMesh(poly: Poly, uo: Vec3, cyl: CylInfo | null): MeshData {
  const cylR = cyl ? cyl.r : 0, cax = cyl ? cyl.ax : 0, caz = cyl ? cyl.az : 0;
  let nv = 0, ni = 0, ne = 0, nei = 0;
  for (const f of poly.faces) {
    const m = f.pts.length / 3;
    nv += m; ni += (m - 2) * 3;
    if (f.ext) { ne += m; nei += (m - 2) * 3; }
  }
  const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const index = new Uint32Array(ni);
  let w = 0, k = 0;
  for (const ext of [true, false]) {
    const v0 = w;
    for (const f of poly.faces) {
      if (f.ext !== ext) continue;
      const p = f.pts, m = p.length / 3, base = w - v0;
      const ax = Math.abs(f.n[0]), ay = Math.abs(f.n[1]), az = Math.abs(f.n[2]);
      const side = cylR > 0 && ext && ay < 0.5;
      let midAng = 0;
      if (side) {
        let sx = 0, sz = 0;
        for (let i = 0; i < m; i++) { sx += p[i * 3] - cax; sz += p[i * 3 + 2] - caz; }
        midAng = Math.atan2(sz, sx);
      }
      for (let i = 0; i < m; i++, w++) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        const rx = x + uo[0], ry = y + uo[1], rz = z + uo[2];
        position[w * 3] = x; position[w * 3 + 1] = y; position[w * 3 + 2] = z;
        if (side) {
          const qx = x - cax, qz = z - caz, l = Math.sqrt(qx * qx + qz * qz) || 1;
          normal[w * 3] = qx / l; normal[w * 3 + 1] = 0; normal[w * 3 + 2] = qz / l;
          let a = Math.atan2(qz, qx);
          if (a - midAng > Math.PI) a -= Math.PI * 2;
          else if (midAng - a > Math.PI) a += Math.PI * 2;
          uv[w * 2] = a * cylR; uv[w * 2 + 1] = ry;
        } else {
          normal[w * 3] = f.n[0]; normal[w * 3 + 1] = f.n[1]; normal[w * 3 + 2] = f.n[2];
          if (ax >= ay && ax >= az) { uv[w * 2] = f.n[0] > 0 ? -rz : rz; uv[w * 2 + 1] = ry; }
          else if (ay >= az) { uv[w * 2] = rx; uv[w * 2 + 1] = f.n[1] > 0 ? -rz : rz; }
          else { uv[w * 2] = f.n[2] > 0 ? rx : -rx; uv[w * 2 + 1] = ry; }
        }
      }
      for (let t = 1; t + 1 < m; t++) { index[k++] = base; index[k++] = base + t; index[k++] = base + t + 1; }
    }
  }
  return { position, normal, uv, wear: new Float32Array(nv), index, extCount: ne, intCount: nv - ne, extIndex: nei, intIndex: ni - nei };
}

function detailed(poly: Poly, uvOrigin: Vec3, cyl: CylInfo | null, s: Surf, grain?: number): MeshData {
  /* Sizes step instead of scaling with the fragment, so neighbouring cells almost always agree and
     their shared crack faces tessellate and displace identically. */
  const mw = minWidth(poly);
  const b = mw >= 8 * s.bevel ? s.bevel : mw >= 4 * s.bevel ? s.bevel * 0.5 : 0;
  const rp = b >= 0.0015 ? bevelCached(poly, b) : poly;
  let amp = 0;
  if (rp.faces.some(f => !f.ext)) {
    const a0 = s.amp * (detail === 2 ? 1 : 0.8);
    amp = mw >= 7 * a0 ? a0 : mw >= 3.5 * a0 ? a0 * 0.5 : 0;
    if (amp < 0.0015) amp = 0;
  }
  let g = grain ?? -1;
  if (g < 0 && s.kind === FIBER) {
    const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
    bounds(poly, lo, hi);
    const dx = hi[0] - lo[0], dy = hi[1] - lo[1], dz = hi[2] - lo[2];
    g = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2;
  }
  return emitMesh(poly, rp, uvOrigin, cyl, b, amp, Math.max(g, 0), detail, s);
}

function emitMesh(orig: Poly, rp: Poly, uo: Vec3, cyl: CylInfo | null, bevel: number, amp: number, grain: number, lod: number, s: Surf): MeshData {
  const cylR = cyl ? cyl.r : 0, cax = cyl ? cyl.ax : 0, caz = cyl ? cyl.az : 0;
  const cell = lod === 2 ? 0.09 : 0.18, kMax = lod === 2 ? 6 : 3, rMax = lod === 2 ? 4 : 2;
  const faces = rp.faces, F = faces.length;

  /* weld face corners so shared edges resolve to the same vertex ids (only relief needs edges) */
  const W: number[] = [];
  const weld = (x: number, y: number, z: number): number => {
    if (amp > 0) for (let i = 0; i < W.length; i += 3) {
      if (Math.abs(W[i] - x) < 1e-5 && Math.abs(W[i + 1] - y) < 1e-5 && Math.abs(W[i + 2] - z) < 1e-5) return i / 3;
    }
    W.push(x, y, z);
    return W.length / 3 - 1;
  };
  const loops: number[][] = [];
  for (const f of faces) {
    const p = f.pts, raw: number[] = [];
    for (let i = 0; i < p.length; i += 3) {
      const id = weld(p[i], p[i + 1], p[i + 2]);
      if (raw[raw.length - 1] !== id) raw.push(id);
    }
    while (raw.length > 1 && raw[0] === raw[raw.length - 1]) raw.pop();
    // drop collinear corners: they would leave T-junctions against the neighbouring face
    const L: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      const a = raw[(i + raw.length - 1) % raw.length] * 3, m = raw[i] * 3, c = raw[(i + 1) % raw.length] * 3;
      const ux = W[m] - W[a], uy = W[m + 1] - W[a + 1], uz = W[m + 2] - W[a + 2];
      const vx = W[c] - W[m], vy = W[c + 1] - W[m + 1], vz = W[c + 2] - W[m + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (len3(cx, cy, cz) > 1e-7 * len3(ux, uy, uz) * len3(vx, vy, vz) + 1e-14) L.push(raw[i]);
    }
    loops.push(L.length >= 3 ? L : []);
  }

  /* per-face frame: centroid, inradius, canonical normal (sign-fixed so both sides of a crack agree) */
  const cen = new Float64Array(F * 3), rin = new Float64Array(F), cn = new Float64Array(F * 3), rings = new Float64Array(F).fill(1);
  const disp: boolean[] = [];
  for (let fi = 0; fi < F && amp > 0; fi++) {
    const L = loops[fi], f = faces[fi];
    let cx = 0, cy = 0, cz = 0;
    for (const v of L) { cx += W[v * 3]; cy += W[v * 3 + 1]; cz += W[v * 3 + 2]; }
    const m = L.length || 1;
    cx /= m; cy /= m; cz /= m;
    cen[fi * 3] = cx; cen[fi * 3 + 1] = cy; cen[fi * 3 + 2] = cz;
    let r = Infinity;
    for (let i = 0; i < L.length; i++) {
      const a = L[i] * 3, c = L[(i + 1) % L.length] * 3;
      const ex = W[c] - W[a], ey = W[c + 1] - W[a + 1], ez = W[c + 2] - W[a + 2];
      const qx = cx - W[a], qy = cy - W[a + 1], qz = cz - W[a + 2];
      const el = len3(ex, ey, ez);
      if (el > 1e-9) r = Math.min(r, len3(qy * ez - qz * ey, qz * ex - qx * ez, qx * ey - qy * ex) / el);
    }
    rin[fi] = Number.isFinite(r) ? r : 0;
    const n = f.n, flip = n[0] < -1e-9 || (Math.abs(n[0]) <= 1e-9 && (n[1] < -1e-9 || (Math.abs(n[1]) <= 1e-9 && n[2] < 0)));
    cn[fi * 3] = flip ? -n[0] : n[0]; cn[fi * 3 + 1] = flip ? -n[1] : n[1]; cn[fi * 3 + 2] = flip ? -n[2] : n[2];
    disp.push(amp > 0 && !f.ext && L.length >= 3);
    if (disp[fi]) rings[fi] = Math.max(1, Math.min(rMax, Math.round(rin[fi] / cell)));
  }

  /* edges; any non-manifold result (clip slop) falls back to flat faces rather than risk cracks */
  interface Edge { a: number; b: number; f0: number; f1: number; k: number; pts: number[] }
  const edges = new Map<number, Edge>();
  const edgeOf = (u: number, v: number): Edge | undefined => edges.get(u < v ? u * 65536 + v : v * 65536 + u);
  let manifold = true;
  /* sine of each face corner (key face * 65536 + vertex): jag near an acute corner must shrink or
     the fan triangles there fold over */
  const cornerSin = new Map<number, number>();
  if (amp > 0) {
    for (let fi = 0; fi < F; fi++) {
      const L = loops[fi];
      for (let i = 0; i < L.length; i++) {
        const u = L[i], v = L[(i + 1) % L.length], key = u < v ? u * 65536 + v : v * 65536 + u;
        const e = edges.get(key);
        if (!e) edges.set(key, { a: u, b: v, f0: fi, f1: -1, k: 1, pts: [] });
        else if (e.f1 < 0 && e.a === v) e.f1 = fi;
        else manifold = false;
      }
    }
    for (const e of edges.values()) if (e.f1 < 0) manifold = false;
    for (let fi = 0; fi < F; fi++) {
      const L = loops[fi], m = L.length;
      for (let i = 0; i < m; i++) {
        const a = L[(i + m - 1) % m] * 3, v = L[i] * 3, c = L[(i + 1) % m] * 3;
        const ux = W[a] - W[v], uy = W[a + 1] - W[v + 1], uz = W[a + 2] - W[v + 2];
        const wx = W[c] - W[v], wy = W[c + 1] - W[v + 1], wz = W[c + 2] - W[v + 2];
        const sn = len3(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / (len3(ux, uy, uz) * len3(wx, wy, wz) || 1);
        cornerSin.set(fi * 65536 + L[i], sn);
      }
    }
    if (!manifold) for (let fi = 0; fi < F; fi++) disp[fi] = false;
  }

  const hn: Vec3 = [0, 0, 0];
  const height = (fi: number, x: number, y: number, z: number): number => {
    hn[0] = cn[fi * 3]; hn[1] = cn[fi * 3 + 1]; hn[2] = cn[fi * 3 + 2];
    return amp * reliefAt(s, x + uo[0], y + uo[1], z + uo[2], hn, grain);
  };

  if (amp > 0 && manifold) {
    const lineD: Vec3 = [0, 0, 0], lineU: Vec3 = [0, 0, 0], lineW: Vec3 = [0, 0, 0];
    for (const e of edges.values()) {
      const f = e.f0, g = e.f1, df = disp[f], dg = disp[g];
      if (!df && !dg) continue;
      const A = e.a * 3, B = e.b * 3;
      const ex = W[B] - W[A], ey = W[B + 1] - W[A + 1], ez = W[B + 2] - W[A + 2];
      const len = len3(ex, ey, ez);
      e.k = Math.max(1, Math.min(kMax, Math.ceil(len / cell - 0.25)));
      const tl = Math.min(0.5 * len, 3 * amp);
      if (df && dg) {
        let dx = ex / len, dy = ey / len, dz = ez / len;
        if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && (dy < -1e-9 || (Math.abs(dy) <= 1e-9 && dz < 0)))) { dx = -dx; dy = -dy; dz = -dz; }
        vec3.set(lineD, dx, dy, dz);
        const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
        vec3.set(lineW, ax <= ay && ax <= az ? 1 : 0, ay < ax && ay <= az ? 1 : 0, az < ax && az < ay ? 1 : 0);
        vec3.cross(lineU, lineD, lineW);
        vec3.normalize(lineU, lineU);
        vec3.cross(lineW, lineD, lineU);
      }
      // in-plane jag must stay short of each face's first inner ring or the grid folds
      const lim = Math.min(1.5 * amp, 0.3 * rin[f] / rings[f], 0.3 * rin[g] / rings[g]);
      for (let j = 1; j < e.k; j++) {
        const t = j / e.k;
        const x = W[A] + ex * t, y = W[A + 1] + ey * t, z = W[A + 2] + ez * t;
        const q = Math.min(1, Math.min(t, 1 - t) * len / tl), taper = q * q * (3 - 2 * q);
        let ox = 0, oy = 0, oz = 0;
        if (df && dg) {
          /* A crack line where three cells meet: each cell sees a different pair of faces here, so
             the jag is a function of the line alone (noise in a canonical frame around it). */
          const h1 = amp * taper * reliefAt(s, x + uo[0], y + uo[1], z + uo[2], lineD, grain);
          const h2 = amp * taper * reliefAt(s, x + uo[0] + 37.1, y + uo[1] - 11.3, z + uo[2] + 5.7, lineD, grain);
          ox = h1 * lineU[0] + h2 * lineW[0]; oy = h1 * lineU[1] + h2 * lineW[1]; oz = h1 * lineU[2] + h2 * lineW[2];
        } else {
          const fd = df ? f : g, ng = faces[df ? g : f].n;
          const cx = cn[fd * 3], cy = cn[fd * 3 + 1], cz = cn[fd * 3 + 2];
          const cg = cx * ng[0] + cy * ng[1] + cz * ng[2], den = 1 - cg * cg;
          if (den > 0.25) {
            const h = height(fd, x, y, z) * taper / den;
            ox = h * (cx - cg * ng[0]); oy = h * (cy - cg * ng[1]); oz = h * (cz - cg * ng[2]);
          }
        }
        const ol = len3(ox, oy, oz);
        const sa = Math.min(cornerSin.get(f * 65536 + e.a) ?? 1, cornerSin.get(g * 65536 + e.a) ?? 1);
        const sb = Math.min(cornerSin.get(f * 65536 + e.b) ?? 1, cornerSin.get(g * 65536 + e.b) ?? 1);
        const cl = Math.min(lim, 0.3 * len * Math.min(t * sa, (1 - t) * sb));
        if (ol > cl) { const sc = cl / ol; ox *= sc; oy *= sc; oz *= sc; }
        e.pts.push(x + ox, y + oy, z + oz);
      }
    }
  }

  /* bevel strips shade as rounded arrises: vertex normals blend the original faces they touch */
  const origExt = bevel > 0 ? orig.faces.filter(f => f.ext) : [];
  const isSide = (f: Face): boolean => cylR > 0 && f.ext && f.tag !== BEVEL_TAG && Math.abs(f.n[1]) < 0.5;
  const nrmOut: Vec3 = [0, 0, 0];
  const extNormal = (f: Face, x: number, y: number, z: number): Vec3 => {
    if (f.tag === BEVEL_TAG) {
      let sx = 0, sy = 0, sz = 0;
      for (const o of origExt) {
        if (o.n[0] * x + o.n[1] * y + o.n[2] * z - o.d < -0.55 * bevel) continue;
        if (isSide(o)) {
          const qx = x - cax, qz = z - caz, l = len3(qx, qz) || 1;
          sx += qx / l; sz += qz / l;
        } else { sx += o.n[0]; sy += o.n[1]; sz += o.n[2]; }
      }
      const l = len3(sx, sy, sz);
      if (l > 1e-6) { vec3.set(nrmOut, sx / l, sy / l, sz / l); return nrmOut; }
    } else if (isSide(f)) {
      const qx = x - cax, qz = z - caz, l = len3(qx, qz) || 1;
      vec3.set(nrmOut, qx / l, 0, qz / l);
      return nrmOut;
    }
    vec3.set(nrmOut, f.n[0], f.n[1], f.n[2]);
    return nrmOut;
  };

  const ext = new Out(), int = new Out();
  const bx: number[] = [], b0: number[] = [];
  for (let fi = 0; fi < F; fi++) {
    const L = loops[fi], f = faces[fi];
    if (!L.length) continue;
    const o = f.ext ? ext : int, base = o.n;
    const side = isSide(f), wear = f.tag === BEVEL_TAG ? 1 : 0;
    let midAng = 0;
    if (side) {
      let sx = 0, sz = 0;
      for (const v of L) { sx += W[v * 3] - cax; sz += W[v * 3 + 2] - caz; }
      midAng = Math.atan2(sz, sx);
    }
    const an = [Math.abs(f.n[0]), Math.abs(f.n[1]), Math.abs(f.n[2])];
    const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number): void => {
      o.pos.push(x, y, z);
      o.nrm.push(nx, ny, nz);
      o.wear.push(wear);
      const rx = x + uo[0], ry = y + uo[1], rz = z + uo[2];
      if (side) {
        let a = Math.atan2(z - caz, x - cax);
        if (a - midAng > Math.PI) a -= Math.PI * 2;
        else if (midAng - a > Math.PI) a += Math.PI * 2;
        o.uv.push(a * cylR, ry);
      } else if (an[0] >= an[1] && an[0] >= an[2]) o.uv.push(f.n[0] > 0 ? -rz : rz, ry);
      else if (an[1] >= an[2]) o.uv.push(rx, f.n[1] > 0 ? -rz : rz);
      else o.uv.push(f.n[2] > 0 ? rx : -rx, ry);
    };
    const putExt = (x: number, y: number, z: number): void => {
      if (f.ext) { const n = extNormal(f, x, y, z); put(x, y, z, n[0], n[1], n[2]); }
      else put(x, y, z, f.n[0], f.n[1], f.n[2]);
    };

    /* boundary with subdivided edges: displaced (bx) and on-plane (b0) positions */
    bx.length = 0; b0.length = 0;
    let split = false;
    for (let i = 0; i < L.length; i++) {
      const u = L[i], v = L[(i + 1) % L.length];
      bx.push(W[u * 3], W[u * 3 + 1], W[u * 3 + 2]);
      b0.push(W[u * 3], W[u * 3 + 1], W[u * 3 + 2]);
      const e = edges.size ? edgeOf(u, v) : undefined;
      if (!e || e.k < 2) continue;
      split = true;
      const fwd = e.a === u;
      for (let j = 1; j < e.k; j++) {
        const jj = fwd ? j : e.k - j, p = (jj - 1) * 3, t = j / e.k;
        bx.push(e.pts[p], e.pts[p + 1], e.pts[p + 2]);
        b0.push(W[u * 3] + (W[v * 3] - W[u * 3]) * t, W[u * 3 + 1] + (W[v * 3 + 1] - W[u * 3 + 1]) * t, W[u * 3 + 2] + (W[v * 3 + 2] - W[u * 3 + 2]) * t);
      }
    }
    const N = bx.length / 3;
    const cx = cen[fi * 3], cy = cen[fi * 3 + 1], cz = cen[fi * 3 + 2];

    let vp: number[], tri: number[] = [];
    if (disp[fi]) {
      const R = rings[fi];
      const nx = cn[fi * 3], ny = cn[fi * 3 + 1], nz = cn[fi * 3 + 2];
      vp = bx.slice();
      for (let j = 1; j <= R; j++) {
        const t = j / R, lim = Math.min(1.2 * amp, 0.4 * t * rin[fi]);
        const cnt = j === R ? 1 : N;
        for (let i = 0; i < cnt; i++) {
          const x = j === R ? cx : b0[i * 3] + (cx - b0[i * 3]) * t;
          const y = j === R ? cy : b0[i * 3 + 1] + (cy - b0[i * 3 + 1]) * t;
          const z = j === R ? cz : b0[i * 3 + 2] + (cz - b0[i * 3 + 2]) * t;
          const h = Math.max(-lim, Math.min(lim, height(fi, x, y, z)));
          vp.push(x + nx * h, y + ny * h, z + nz * h);
        }
      }
      for (let j = 0; j < R - 1; j++) {
        for (let i = 0; i < N; i++) {
          const i1 = (i + 1) % N, a = j * N + i, b = j * N + i1, c = (j + 1) * N + i1, d = (j + 1) * N + i;
          tri.push(a, b, c, a, c, d);
        }
      }
      for (let i = 0; i < N; i++) tri.push((R - 1) * N + i, (R - 1) * N + (i + 1) % N, R * N);
    } else if (split) {
      vp = bx.slice();
      vp.push(cx, cy, cz);
      for (let i = 0; i < N; i++) tri.push(i, (i + 1) % N, N);
    } else {
      vp = bx;
      for (let t = 1; t + 1 < N; t++) tri.push(0, t, t + 1);
    }
    // a jagged outline can still fold a fan triangle; the boundary itself stays simple, so ear-clip it
    if ((disp[fi] || split) && folds(vp, tri, f.n)) {
      const ear = earClip(bx, f.n);
      if (ear) { vp = bx; tri = ear; }
    }
    const V = vp.length / 3;
    if (disp[fi]) {
      const acc = new Float64Array(V * 3);
      for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
        const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
        const wx = vp[c] - vp[a], wy = vp[c + 1] - vp[a + 1], wz = vp[c + 2] - vp[a + 2];
        const qx = uy * wz - uz * wy, qy = uz * wx - ux * wz, qz = ux * wy - uy * wx;
        acc[a] += qx; acc[a + 1] += qy; acc[a + 2] += qz;
        acc[b] += qx; acc[b + 1] += qy; acc[b + 2] += qz;
        acc[c] += qx; acc[c + 1] += qy; acc[c + 2] += qz;
      }
      for (let i = 0; i < V; i++) {
        let qx = acc[i * 3], qy = acc[i * 3 + 1], qz = acc[i * 3 + 2];
        const l = len3(qx, qy, qz);
        if (l > 1e-12 && (qx * f.n[0] + qy * f.n[1] + qz * f.n[2]) > 0.2 * l) { qx /= l; qy /= l; qz /= l; }
        else { qx = f.n[0]; qy = f.n[1]; qz = f.n[2]; }
        put(vp[i * 3], vp[i * 3 + 1], vp[i * 3 + 2], qx, qy, qz);
      }
    } else for (let i = 0; i < V; i++) putExt(vp[i * 3], vp[i * 3 + 1], vp[i * 3 + 2]);
    for (const t of tri) o.idx.push(base + t);
  }

  const nv = ext.n + int.n;
  const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const wear = new Float32Array(nv), index = new Uint32Array(ext.idx.length + int.idx.length);
  position.set(ext.pos); position.set(int.pos, ext.pos.length);
  normal.set(ext.nrm); normal.set(int.nrm, ext.nrm.length);
  uv.set(ext.uv); uv.set(int.uv, ext.uv.length);
  wear.set(ext.wear);
  index.set(ext.idx); index.set(int.idx, ext.idx.length);
  return { position, normal, uv, wear, index, extCount: ext.n, intCount: int.n, extIndex: ext.idx.length, intIndex: int.idx.length };
}

/* Smallest extent across any face normal — slivers thinner than a few cm make bad hulls. */
export function minWidth(poly: Poly): number {
  let best = Infinity;
  for (const f of poly.faces) {
    let lo = Infinity, hi = -Infinity;
    for (const g of poly.faces) for (let i = 0; i < g.pts.length; i += 3) {
      const d = f.n[0] * g.pts[i] + f.n[1] * g.pts[i + 1] + f.n[2] * g.pts[i + 2];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    best = Math.min(best, hi - lo);
  }
  return best;
}

/* ---------------- compound pieces ---------------- */

/** Yaw by `rotY` about +Y (three.js convention), then translate: a compound part placed in its piece's frame. */
export function placePoly(poly: Poly, rotY: number, t: Vec3): Poly {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return {
    faces: poly.faces.map(f => {
      const pts = f.pts.slice();
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i], z = pts[i + 2];
        pts[i] = x * c + z * s + t[0]; pts[i + 1] += t[1]; pts[i + 2] = -x * s + z * c + t[2];
      }
      const n: Vec3 = [f.n[0] * c + f.n[2] * s, f.n[1], -f.n[0] * s + f.n[2] * c];
      return { pts, n, d: f.d + vec3.dot(n, t), ext: f.ext, tag: f.tag };
    }),
  };
}

/** Convex envelope of several polytopes (a compound's bounds for readers that only need its extent). */
export function hullOf(polys: Poly[]): Poly | null {
  const pts: number[] = [];
  for (const p of polys) for (const x of uniqueVerts(p)) pts.push(x);
  return hullPoly(pts);
}

/** Concatenate part meshes into one instance geometry: exterior groups first, then interior, as buildMesh lays them out. */
export function mergeMeshes(mds: MeshData[]): MeshData {
  if (mds.length === 1) return mds[0];
  let ne = 0, ni = 0, nei = 0, nii = 0;
  for (const m of mds) { ne += m.extCount; ni += m.intCount; nei += m.extIndex; nii += m.intIndex; }
  const nv = ne + ni;
  const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), wear = new Float32Array(nv);
  const index = new Uint32Array(nei + nii);
  let ve = 0, vi = ne, ie = 0, ii = nei;
  for (const m of mds) {
    const copy = (from: number, count: number, to: number): void => {
      position.set(m.position.subarray(from * 3, (from + count) * 3), to * 3);
      normal.set(m.normal.subarray(from * 3, (from + count) * 3), to * 3);
      uv.set(m.uv.subarray(from * 2, (from + count) * 2), to * 2);
      wear.set(m.wear.subarray(from, from + count), to);
    };
    copy(0, m.extCount, ve);
    copy(m.extCount, m.intCount, vi);
    for (let k = 0; k < m.extIndex; k++) index[ie++] = m.index[k] + ve;
    for (let k = 0; k < m.intIndex; k++) index[ii++] = m.index[m.extIndex + k] + vi - ne;
    ve += m.extCount;
    vi += m.intCount;
  }
  return { position, normal, uv, wear, index, extCount: ne, intCount: ni, extIndex: nei, intIndex: nii };
}
