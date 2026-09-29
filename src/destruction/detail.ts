import { clamp } from 'math';
import type { MaterialId, PieceSpec, Quat, Quality, Vec3 } from '../types';
import { b3, world, stepCount, randomStream } from '../physics/physics';
import { MATS, effectiveDensity, type PhysMat } from './materials';
import * as P from './polytope';
import {
  detailPool, poolAdd, poolRemove, poolRebind, poolWrite, poolFlush, poolStats, batchesXray, setPieceVisible, pieceFinish,
  type DetailPool, type PoolOwner, type SurfaceFinish,
} from './batches';
import { fx } from '../render/fx';
import { audio } from '../audio/audio';
import type { Piece, Root, Weld, PartGeo } from './structure';

/* Dormant detail. A member keeps being one rigid body while the units it is built from (bricks and mortar
   courses, cavity leaves, boards, joists, tiles…) ride on it as instances, costing the solver nothing. The body's
   geometry is a set of convex parts in its own frame — at first just its envelope — and every dormant unit belongs
   to it. Damage releases the units near the hit as real pieces and carves the parts around the hole, so the rest
   stays one body with a real hole in it; a fracture does the same and also lets the leaves of a layered wall go
   their own way; a cut or crack splits the parts along its plane. Units are never Voronoi-shattered: a wall
   comes apart as the bricks it is made of. */

export interface Caps { comp: number; ten: number; shear: number; torque: number }
type Neighbours = Map<Piece | null, Caps & { area: number }>;

export interface SpawnOpts {
  mat: MaterialId; tint?: number; poly: P.Poly; box?: Vec3; cyl: P.CylInfo | null; pos: Vec3; rot: Quat; lin?: Vec3; ang?: Vec3;
  uvOrigin: Vec3; depth: number; root: Root; demolished: boolean; awake: boolean; volume?: number; char?: number; burning?: boolean;
  temp?: number; frag?: boolean; parts?: PartGeo[];
}

/** what structure.ts lends the detail layer (kept internal there) */
export interface DetailHost {
  createPiece(o: SpawnOpts): Piece | null;
  createWeld(a: Piece, b: Piece | null, pt: Vec3, n: Vec3, area: number, caps: Caps): Weld | null;
  jointCaps(a: PhysMat, b: PhysMat | null, area: number): Caps;
  neighbourCaps(p: Piece): Neighbours;
  reweld(chunk: Piece, n: Neighbours): void;
  destroyPiece(p: Piece): void;
  damagePiece(p: Piece, point: Vec3, energy: number, blast: boolean): void;
  credit(root: Root, vol: number, pos: Vec3): void;
  setDebris(p: Piece, debris: boolean): void;
  clock(): number;
  debris(): number;
  budget(): number;
  burning(): ReadonlySet<Piece>;
  counters: { fractures: number; cracks: number; spalls: number };
}

let host: DetailHost | null = null;
/* its own stream: which units a hit knocks out must not shift the fracture seeds (or depend on what is drawn) */
const rand = randomStream(0xde7a11);
export function setDetailHost(h: DetailHost): void { host = h; }

/* ---------------- tuning ---------------- */
const RUBBLE_VOL = 0.02;
const GRACE = 0.4;
const STEP_CAP = 40;             // bodies detail may create per physics step
const CARVE_VOL = 0.008;         // released volume (≈6 bricks) before the body is re-cut round the hole
const MAX_PARTS = 24;
const CARVES_PER_STEP = 6;       // re-cutting a body costs a few ms; a collapse defers the rest to later hits
const TOUCH = 0.016;             // unit faces this close touch (a 10 mm mortar joint between them)
const MIN_PART = 0.04;           // thinner parts make bad hulls
const TIE_PER_M2 = 2.5;          // BS EN 845-1 ties at 900 × 450
const TIE_KN = 2000;

export interface DetailPreset { near: number; cap: number; add: number; move: number }
/** LOD: detail draws within `near` m of the camera (hidden again past 1.2 × near), at most `cap` instances;
    `add` / `move` bound the instances written per frame for sets coming into view and for moving members. */
export const DETAIL_QUALITY: Record<Quality, DetailPreset> = {
  low: { near: 20, cap: 30_000, add: 12_000, move: 16_000 },
  medium: { near: 40, cap: 110_000, add: 40_000, move: 45_000 },
  high: { near: 70, cap: 250_000, add: 80_000, move: 70_000 },
};
let qualityOverride: Quality | null = null;
export function setDetailQuality(q: Quality | null): void { qualityOverride = q; }
function preset(): DetailPreset {
  return DETAIL_QUALITY[qualityOverride ?? (['low', 'medium', 'high'] as const)[P.meshDetail()]];
}

/* ---------------- unit kinds ---------------- */

interface Kind {
  key: string;
  mat: MaterialId;
  finish: SurfaceFinish | undefined;
  poly: P.Poly;
  box: Vec3 | null;
  cyl: P.CylInfo | null;
  parts: P.Poly[] | null;
  lo: Vec3;
  hi: Vec3;
  vol: number;
  rho: number;
  cosmetic: boolean;
  uv: Vec3;
  pool: DetailPool | null;
  /** boxes draw as a shared canonical box scaled per instance, so closers and cut boards cost no extra draw call */
  rkey: string;
  scale: Vec3;
  rsize: Vec3 | null;
}

const kinds: Kind[] = [];
const kindIndex = new Map<string, number>();
const r5 = (v: number): number => Math.round(v * 2000);

function shapePoly(s: Pick<PieceSpec, 'size' | 'shape' | 'sides' | 'verts'>): P.Poly | null {
  const [sx, sy, sz] = s.size;
  switch (s.shape ?? 'box') {
    case 'cylinder': return P.cylinderPoly(sx / 2, sy);
    case 'prism': return P.cylinderPoly(sx / 2, sy, clamp(Math.round(s.sides ?? 8), 3, 24));
    case 'wedge': return P.wedgePoly(sx / 2, sy / 2, sz / 2);
    case 'hull': return s.verts && s.verts.length >= 4 ? P.hullPoly(s.verts.flat()) : null;
    default: return P.boxPoly(sx / 2, sy / 2, sz / 2);
  }
}

function kindKey(c: PieceSpec): string {
  const s = c.size;
  let k = `${c.mat}|${c.finish ?? ''}|${c.shape ?? 'b'}${c.sides ?? ''}|${r5(s[0])},${r5(s[1])},${r5(s[2])}|${c.density ?? ''}`;
  if (c.shape === 'hull' && c.verts) for (const v of c.verts) k += `;${r5(v[0])},${r5(v[1])},${r5(v[2])}`;
  if (c.parts) for (const q of c.parts) {
    k += `/${q.shape ?? 'b'}${r5(q.size[0])},${r5(q.size[1])},${r5(q.size[2])}@${r5(q.pos[0])},${r5(q.pos[1])},${r5(q.pos[2])}`;
    if (q.verts) for (const v of q.verts) k += `;${r5(v[0])},${r5(v[1])},${r5(v[2])}`;
  }
  return k;
}

function kindOf(c: PieceSpec): number {
  const key = kindKey(c);
  const hit = kindIndex.get(key);
  if (hit !== undefined) return hit;
  let parts: P.Poly[] | null = null, poly: P.Poly | null;
  if (c.parts?.length) {
    parts = c.parts.map((q) => shapePoly(q)).map((q, i) => q && P.placePoly(q, c.parts![i].rotY ?? 0, c.parts![i].pos)).filter((q): q is P.Poly => !!q);
    poly = parts.length ? P.hullOf(parts) ?? parts[0] : null;
  } else poly = shapePoly(c);
  if (!poly) poly = P.boxPoly(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2);
  const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
  P.bounds(poly, lo, hi);
  const w: Vec3 = [0, 0, 0];
  const vol = parts ? parts.reduce((v, q) => v + P.volumeCentroid(q, w), 0) : P.volumeCentroid(poly, w);
  const thin = Math.min(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const shape = c.shape ?? 'box';
  const K: Kind = {
    key, mat: c.mat, finish: pieceFinish(c), poly, parts, lo, hi, vol,
    box: shape === 'box' && !parts ? [c.size[0] / 2, c.size[1] / 2, c.size[2] / 2] : null,
    cyl: shape === 'cylinder' ? { r: c.size[0] / 2, ax: 0, az: 0 } : null,
    rho: effectiveDensity(c, vol),
    /* joints, skims, membranes and wire ties crumble or tear rather than fly as bodies */
    cosmetic: !!parts || vol < 1.5e-4 || thin < 0.012,
    // a unit's min corner sits on a texture cell corner: a brick module shows one brick with its joints round it
    uv: [-lo[0], -lo[1], -lo[2]],
    pool: null, rkey: key, scale: [1, 1, 1], rsize: null,
  };
  if (K.box) {
    // sheets, skims and anything with a hairline arris draw as one flat unit cube per material, scaled
    const flat = K.cosmetic || thin < 0.03 || FLAT.has(c.mat);
    const fine = c.mat === 'brick' || c.mat === 'cinderblock';
    const rs = (flat ? [1, 1, 1] : c.size.map((v) => bucket(v, fine))) as Vec3;
    K.rsize = rs;
    K.scale = [c.size[0] / rs[0], c.size[1] / rs[1], c.size[2] / rs[2]];
    K.rkey = `${c.mat}|${K.finish ?? ''}|${flat ? 'f' : 'b'}|${rs.map(r5).join(',')}`;
  }
  kinds.push(K);
  kindIndex.set(key, kinds.length - 1);
  return kinds.length - 1;
}

/* canonical draw sizes: masonry modules (37.5 mm steps: 225, 112.5, 75) exact; boards, joists and sheets in steps of
   √2 (their textures are plain enough to stretch); anything thinner than a module shares one flat size */
function bucket(v: number, fine: boolean): number {
  if (v < 0.03) return 0.02;
  if (v <= 0.3 && fine) return Math.max(0.0375, Math.round(v / 0.0375) * 0.0375);
  return 0.3 * Math.SQRT2 ** Math.round(Math.log2(v / 0.3) * 2);
}

const FLAT = new Set<MaterialId>(['drywall', 'plywood', 'pvc', 'metal', 'aluminum', 'steel', 'glass', 'tempered', 'ceramic']);

/* texture cell / masonry module: the block texture's cells are 400 × 200 for a 450 × 225 module */
const UV_SCALE: Partial<Record<MaterialId, number>> = { cinderblock: 0.4 / 0.45 };
const rpools = new Map<string, DetailPool>();

function kindPool(K: Kind): DetailPool {
  if (K.pool) return K.pool;
  let pool = rpools.get(K.rkey);
  if (!pool) {
    let md: P.MeshData;
    if (K.rsize) {
      const [x, y, z] = K.rsize;
      md = P.buildMesh(P.boxPoly(x / 2, y / 2, z / 2), [x / 2, y / 2, z / 2], null, K.rkey.includes('|f|') ? undefined : K.mat);
    } else if (K.parts) md = P.mergeMeshes(K.parts.map((q) => P.buildMesh(q, K.uv, null)));
    else md = P.buildMesh(K.poly, K.uv, K.cyl, K.cosmetic ? undefined : K.mat);
    const k = UV_SCALE[K.mat];
    if (k) for (let i = 0; i < md.uv.length; i++) md.uv[i] *= k;
    pool = detailPool(K.rkey, K.mat, K.finish, md);
    rpools.set(K.rkey, pool);
  }
  return (K.pool = pool);
}

/* ---------------- sets ---------------- */

interface Part { poly: P.Poly; leaf: number; side: number }

interface DetailSet extends PoolOwner {
  p: Piece;
  n: number;
  spec: PieceSpec[];
  kind: Int32Array;
  lt: Float64Array;       // local pos + quat in the body frame, 7 per unit
  box: Float64Array;      // local AABB, 6 per unit
  gone: Uint8Array;
  layer: Uint8Array;
  vol: Float32Array;
  mass: Float32Array;
  live: number;
  k: number;              // credited volume per unit volume (the envelope's air shares out over the units)
  shown: boolean;
  pose: Float64Array;     // last drawn transform
  cen: Vec3;
  rad: number;
  parts: Part[] | null;
  pending: number[];
  pendingVol: number;
  carved: number;
  hit: { step: number; at: Vec3; r: number };
  grid: Map<number, number[]> | null;
  d: number;
  chunk: boolean;
  lm: Float32Array | null; // unit matrices in the body frame (3 × 4 each, scale folded in), built on first redraw
  drawn: number;           // frame the units were last posed
}

const sets = new Map<Piece, DetailSet>();
let camera: Vec3 | null = null;
let frame = 0;
let budgetStep = -1, spent = 0, spawned = 0, peakStep = 0;
const DEAD_POSE = (): Float64Array => new Float64Array(7).fill(NaN);

function newSet(p: Piece, n: number): DetailSet {
  return {
    p, n, spec: new Array<PieceSpec>(n), kind: new Int32Array(n), lt: new Float64Array(n * 7), box: new Float64Array(n * 6),
    slots: new Int32Array(n).fill(-1), gone: new Uint8Array(n), layer: new Uint8Array(n), vol: new Float32Array(n), mass: new Float32Array(n),
    live: 0, k: 1, shown: false, pose: DEAD_POSE(), cen: [0, 0, 0], rad: 0, parts: null, pending: [], pendingVol: 0, carved: -1,
    hit: { step: -9, at: [0, 0, 0], r: 0 }, grid: null, d: Infinity, chunk: false, lm: null, drawn: 0,
  };
}

/* quaternion helpers on plain arrays (x, y, z, w) */
function qmul(o: Float64Array | number[], a: ArrayLike<number>, b: ArrayLike<number>, oi = 0): void {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  o[oi] = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
function qrot(o: number[] | Float64Array, q: ArrayLike<number>, x: number, y: number, z: number, oi = 0): void {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  o[oi] = x + qw * tx + qy * tz - qz * ty;
  o[oi + 1] = y + qw * ty + qz * tx - qx * tz;
  o[oi + 2] = z + qw * tz + qx * ty - qy * tx;
}
const conj = (q: ArrayLike<number>): Quat => [-q[0], -q[1], -q[2], q[3]];
function toLocal(p: Vec3, pos: ArrayLike<number>, rot: ArrayLike<number>): Vec3 {
  const o: Vec3 = [0, 0, 0];
  qrot(o, conj(rot), p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]);
  return o;
}
function toWorld(l: ArrayLike<number>, pos: ArrayLike<number>, rot: ArrayLike<number>): Vec3 {
  const o: Vec3 = [0, 0, 0];
  qrot(o, rot, l[0], l[1], l[2]);
  o[0] += pos[0]; o[1] += pos[1]; o[2] += pos[2];
  return o;
}

/** A spawned member whose spec carries `detail`: index its units in the body frame and give the body their mass. */
export function attachDetail(p: Piece): void {
  const ch = p.root.spec.detail;
  if (!ch?.length || sets.has(p)) return;
  const n = ch.length, s = newSet(p, n), inv = conj(p.curRot);
  const lq = [0, 0, 0, 1], cq: Quat = [0, 0, 0, 1], c: Vec3 = [0, 0, 0];
  let vol = 0, mass = 0;
  for (let i = 0; i < n; i++) {
    const u = ch[i], ob = orientedBox(u), ki = kindOf(ob ? ob.spec : u), K = kinds[ki];
    s.spec[i] = u; s.kind[i] = ki; s.layer[i] = u.layer ?? 0;
    qrot(s.lt, inv, u.pos[0] - p.curPos[0], u.pos[1] - p.curPos[1], u.pos[2] - p.curPos[2], i * 7);
    const a = (u.rotY ?? 0) / 2;
    cq[0] = 0; cq[1] = Math.sin(a); cq[2] = 0; cq[3] = Math.cos(a);
    qmul(lq, inv, cq);
    if (ob) qmul(lq, [...lq], ob.q);
    s.lt.set(lq, i * 7 + 3);
    unitBox(s, i, K, lq);
    s.vol[i] = K.vol;
    s.mass[i] = K.vol * K.rho;
    vol += K.vol; mass += s.mass[i];
  }
  s.live = n;
  s.k = vol > 0 ? Math.max(1, p.volume / vol) : 1;
  bounds(s, c);
  sets.set(p, s);
  if (mass > 0 && Math.abs(p.mass - mass) > 0.02 * mass) setMass(p, mass);
}

/* A hull that is a box laid at an angle (tiles, battens and rafters square to a roof slope) is drawn and simulated
   as that box turned: it shares the canonical box of its size instead of being a shape of its own. */
const oboxes = new WeakMap<PieceSpec, { spec: PieceSpec; q: Quat } | null>();
function orientedBox(c: PieceSpec): { spec: PieceSpec; q: Quat } | null {
  if (c.shape !== 'hull' || c.verts?.length !== 8) return null;
  const hit = oboxes.get(c);
  if (hit !== undefined) return hit;
  let out: { spec: PieceSpec; q: Quat } | null = null;
  const v = c.verts, o = v[0];
  const d = v.slice(1).map((w) => [w[0] - o[0], w[1] - o[1], w[2] - o[2]]).sort((x, y) => Math.hypot(...x) - Math.hypot(...y));
  const len = (x: number[]): number => Math.hypot(x[0], x[1], x[2]);
  const dot = (x: number[], y: number[]): number => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const sq = (x: number[], y: number[]): boolean => Math.abs(dot(x, y)) < 4e-6 * (len(x) + len(y)) + 1e-4 * len(x) * len(y);
  // edges from the first corner: the shortest vector, then the shortest square to it, then to both
  const e1 = d[0], e2 = d.find((x) => sq(x, e1)), e3 = e2 && d.find((x) => x !== e2 && sq(x, e1) && sq(x, e2));
  const L = [len(e1), e2 ? len(e2) : 0, e3 ? len(e3) : 0];
  if (e2 && e3 && L[0] > 1e-4
    && v.every((w) => [0, 1, 2, 3, 4, 5, 6, 7].some((m) => [0, 1, 2].every((k) => Math.abs(o[k] + (m & 1 ? e1[k] : 0) + (m & 2 ? e2[k] : 0) + (m & 4 ? e3[k] : 0) - w[k]) < 1e-4)))) {
    const x = e1.map((t) => t / L[0]), y = e2.map((t) => t / L[1]);
    let z = e3.map((t) => t / L[2]);
    const cz = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    if (dot(cz, z) < 0) z = z.map((t) => -t);
    // rotation matrix columns x, y, z → quaternion
    const m00 = x[0], m11 = y[1], m22 = z[2], tr = m00 + m11 + m22;
    let q: Quat;
    if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; q = [(y[2] - z[1]) / S, (z[0] - x[2]) / S, (x[1] - y[0]) / S, 0.25 * S]; }
    else if (m00 > m11 && m00 > m22) { const S = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * S, (y[0] + x[1]) / S, (z[0] + x[2]) / S, (y[2] - z[1]) / S]; }
    else if (m11 > m22) { const S = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(y[0] + x[1]) / S, 0.25 * S, (z[1] + y[2]) / S, (z[0] - x[2]) / S]; }
    else { const S = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(z[0] + x[2]) / S, (z[1] + y[2]) / S, 0.25 * S, (x[1] - y[0]) / S]; }
    const spec: PieceSpec = { mat: c.mat, size: [L[0], L[1], L[2]], pos: c.pos };
    if (c.finish) spec.finish = c.finish;
    if (c.density !== undefined) spec.density = c.density;
    out = { spec, q };
  }
  oboxes.set(c, out);
  return out;
}

function unitBox(s: DetailSet, i: number, K: Kind, q: ArrayLike<number>): void {
  const o = i * 7, b = i * 6, t = [0, 0, 0];
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let c = 0; c < 8; c++) {
    qrot(t, q, c & 1 ? K.hi[0] : K.lo[0], c & 2 ? K.hi[1] : K.lo[1], c & 4 ? K.hi[2] : K.lo[2]);
    x0 = Math.min(x0, t[0]); y0 = Math.min(y0, t[1]); z0 = Math.min(z0, t[2]);
    x1 = Math.max(x1, t[0]); y1 = Math.max(y1, t[1]); z1 = Math.max(z1, t[2]);
  }
  s.box[b] = s.lt[o] + x0; s.box[b + 1] = s.lt[o + 1] + y0; s.box[b + 2] = s.lt[o + 2] + z0;
  s.box[b + 3] = s.lt[o] + x1; s.box[b + 4] = s.lt[o + 1] + y1; s.box[b + 5] = s.lt[o + 2] + z1;
}

function bounds(s: DetailSet, cen: Vec3): void {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < s.n; i++) {
    if (s.gone[i]) continue;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s.box[i * 6 + k]); hi[k] = Math.max(hi[k], s.box[i * 6 + 3 + k]); }
  }
  if (lo[0] > hi[0]) { s.rad = 0; return; }
  for (let k = 0; k < 3; k++) cen[k] = (lo[k] + hi[k]) / 2;
  s.cen = cen;
  s.rad = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
}

function setMass(p: Piece, m: number): void {
  const md = b3.b3Body_GetMassData(p.body);
  if (!(md.mass > 0)) return;
  const k = m / md.mass, J = md.inertia;
  md.mass = m;
  md.inertia = { cx: [J.cx[0] * k, J.cx[1] * k, J.cx[2] * k], cy: [J.cy[0] * k, J.cy[1] * k, J.cy[2] * k], cz: [J.cz[0] * k, J.cz[1] * k, J.cz[2] * k] };
  b3.b3Body_SetMassData(p.body, md);
  p.mass = m;
}

export function hasDetail(p: Piece): boolean {
  return sets.has(p);
}

/** dormant units a member still carries (0 without detail) */
export function detailUnits(p: Piece): number {
  return sets.get(p)?.live ?? 0;
}

/** remaining dormant units of a member (tests, HUD) */
export function detailOf(p: Piece): { units: number; mass: number; parts: number; chunk: boolean } | null {
  const s = sets.get(p);
  if (!s) return null;
  let mass = 0;
  for (let i = 0; i < s.n; i++) if (!s.gone[i]) mass += s.mass[i];
  return { units: s.live, mass, parts: s.parts?.length ?? 1, chunk: s.chunk };
}

/** The member is gone wholesale (pulverised, burnt out, deleted): its dormant units go with it. */
export function detachDetail(p: Piece): void {
  const s = sets.get(p);
  if (!s) return;
  sets.delete(p);
  hide(s);
}

export function clearDetail(): void {
  sets.clear();
  for (const K of kinds) K.pool = null;
  rpools.clear();
  budgetStep = -1; spent = 0; spawned = 0; peakStep = 0;
}

/* ---------------- drawing ---------------- */

export function setDetailCamera(pos: ArrayLike<number> | null): void {
  camera = pos ? [pos[0], pos[1], pos[2]] : null;
}

const _m = new Float32Array(16);
const _wq = [0, 0, 0, 1], _wp = [0, 0, 0];

function compose(px: number, py: number, pz: number, q: ArrayLike<number>): Float32Array {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  _m[0] = 1 - (yy + zz); _m[1] = xy + wz; _m[2] = xz - wy; _m[3] = 0;
  _m[4] = xy - wz; _m[5] = 1 - (xx + zz); _m[6] = yz + wx; _m[7] = 0;
  _m[8] = xz + wy; _m[9] = yz - wx; _m[10] = 1 - (xx + yy); _m[11] = 0;
  _m[12] = px; _m[13] = py; _m[14] = pz; _m[15] = 1;
  return _m;
}

const _hq = [0, 0, 0, 1];
function unitMatrix(s: DetailSet, i: number, pose: ArrayLike<number>): Float32Array {
  const o = i * 7;
  _hq[0] = pose[3]; _hq[1] = pose[4]; _hq[2] = pose[5]; _hq[3] = pose[6];
  qrot(_wp, _hq, s.lt[o], s.lt[o + 1], s.lt[o + 2]);
  qmul(_wq, _hq, s.lt.subarray(o + 3, o + 7));
  const m = compose(pose[0] + _wp[0], pose[1] + _wp[1], pose[2] + _wp[2], _wq);
  const sc = kinds[s.kind[i]].scale;
  if (sc[0] !== 1 || sc[1] !== 1 || sc[2] !== 1) for (let c = 0; c < 3; c++) { m[c * 4] *= sc[c]; m[c * 4 + 1] *= sc[c]; m[c * 4 + 2] *= sc[c]; }
  return m;
}

const _pose = new Float64Array(7);
const _qa = [0, 0, 0, 1];
function drawPose(p: Piece, alpha: number): Float64Array {
  if (p.movedStep === stepCount) {
    for (let k = 0; k < 3; k++) _pose[k] = p.prevPos[k] + (p.curPos[k] - p.prevPos[k]) * alpha;
    let a = p.prevRot, b = p.curRot, d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const sg = d < 0 ? -1 : 1;
    d *= sg;
    let l = 0;
    for (let k = 0; k < 4; k++) { _qa[k] = a[k] * (1 - alpha) + sg * b[k] * alpha; l += _qa[k] * _qa[k]; }
    l = Math.sqrt(l) || 1;
    for (let k = 0; k < 4; k++) _pose[3 + k] = _qa[k] / l;
    void d; void a; void b;
  } else {
    for (let k = 0; k < 3; k++) _pose[k] = p.curPos[k];
    for (let k = 0; k < 4; k++) _pose[3 + k] = p.curRot[k];
  }
  return _pose;
}

function show(s: DetailSet, pose: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < s.n; i++) {
    if (s.gone[i] || s.slots[i] >= 0) continue;
    const K = kinds[s.kind[i]];
    poolAdd(kindPool(K), s, i, unitMatrix(s, i, pose), s.spec[i].tint);
    n++;
  }
  s.shown = true;
  s.pose.set(pose);
  setPieceVisible(s.p.gfx, false);
  return n;
}

function hide(s: DetailSet): void {
  for (let i = 0; i < s.n; i++) {
    const sl = s.slots[i];
    if (sl >= 0) poolRemove(kinds[s.kind[i]].pool!, sl);
  }
  if (s.shown && !s.p.dead) setPieceVisible(s.p.gfx, true);
  s.shown = false;
}

const IDQ = [0, 0, 0, 1], ZERO = [0, 0, 0, 0, 0, 0, 1];
function localMatrices(s: DetailSet): Float32Array {
  if (s.lm) return s.lm;
  const lm = new Float32Array(s.n * 12);
  for (let i = 0; i < s.n; i++) {
    const m = unitMatrix(s, i, ZERO);
    const o = i * 12;
    lm[o] = m[0]; lm[o + 1] = m[1]; lm[o + 2] = m[2]; lm[o + 3] = m[4]; lm[o + 4] = m[5]; lm[o + 5] = m[6];
    lm[o + 6] = m[8]; lm[o + 7] = m[9]; lm[o + 8] = m[10]; lm[o + 9] = m[12]; lm[o + 10] = m[13]; lm[o + 11] = m[14];
  }
  void IDQ;
  return (s.lm = lm);
}

/* body pose × unit's own matrix: one 3×3 product per unit instead of re-deriving it from quaternions */
const _om = new Float32Array(16);
function redraw(s: DetailSet, pose: ArrayLike<number>): number {
  const lm = localMatrices(s);
  const x = pose[3], y = pose[4], z = pose[5], w = pose[6];
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  const r00 = 1 - (yy + zz), r10 = xy + wz, r20 = xz - wy, r01 = xy - wz, r11 = 1 - (xx + zz), r21 = yz + wx, r02 = xz + wy, r12 = yz - wx, r22 = 1 - (xx + yy);
  const tx = pose[0], ty = pose[1], tz = pose[2];
  _om[15] = 1;
  let n = 0;
  for (let i = 0; i < s.n; i++) {
    const sl = s.slots[i];
    if (sl < 0) continue;
    const o = i * 12;
    for (let c = 0; c < 3; c++) {
      const a = lm[o + c * 3], b = lm[o + c * 3 + 1], d = lm[o + c * 3 + 2];
      _om[c * 4] = r00 * a + r01 * b + r02 * d;
      _om[c * 4 + 1] = r10 * a + r11 * b + r12 * d;
      _om[c * 4 + 2] = r20 * a + r21 * b + r22 * d;
    }
    const a = lm[o + 9], b = lm[o + 10], d = lm[o + 11];
    _om[12] = tx + r00 * a + r01 * b + r02 * d;
    _om[13] = ty + r10 * a + r11 * b + r12 * d;
    _om[14] = tz + r20 * a + r21 * b + r22 * d;
    poolWrite(kinds[s.kind[i]].pool!, sl, _om);
    n++;
  }
  s.pose.set(pose);
  s.drawn = frame;
  return n;
}

const order: DetailSet[] = [];

/** Every rendered frame, after the pieces are synced: LOD, and unit transforms for members that moved. */
export function syncDetail(alpha: number): void {
  if (!sets.size) return;
  frame++;
  const q = preset(), xr = batchesXray(), cam = camera;
  order.length = 0;
  for (const s of sets.values()) {
    const p = s.p;
    if (!cam || xr || s.live === 0) { s.d = Infinity; continue; }
    const c = toWorld(s.cen, p.curPos, p.curRot);
    s.d = Math.max(0, Math.hypot(c[0] - cam[0], c[1] - cam[1], c[2] - cam[2]) - s.rad);
    if (s.d < q.near * (s.shown ? 1.2 : 1)) order.push(s);
  }
  order.sort((a, b) => a.d - b.d);
  let total = 0, added = 0, moved = 0, cut = order.length;
  for (let i = 0; i < order.length; i++) {
    total += order[i].live;
    if (total > q.cap) { cut = i; break; }
  }
  const want = new Set(order.slice(0, cut));
  for (const s of sets.values()) if (s.shown && !want.has(s)) hide(s);
  movers.length = 0;
  for (const s of want) {
    const pose = drawPose(s.p, alpha);
    if (!s.shown) {
      if (added + s.live > q.add && added > 0) continue;
      added += show(s, pose);
      s.drawn = frame;
      continue;
    }
    const pv = s.pose;
    if (pv[0] === pose[0] && pv[1] === pose[1] && pv[2] === pose[2] && pv[3] === pose[3] && pv[4] === pose[4] && pv[5] === pose[5] && pv[6] === pose[6]) { s.drawn = frame; continue; }
    movers.push(s);
  }
  /* Too many members moving at once: the nearest go first, and a set passed over waits a frame or two at its last
     pose (it climbs the queue as it waits) rather than falling back to its plain envelope; only one left behind for
     several frames shows its envelope until it is posed again. */
  if (movers.length > 1) movers.sort((a, b) => a.d / (1 + frame - a.drawn) - b.d / (1 + frame - b.drawn));
  for (const s of movers) {
    if (moved + s.live > q.move && moved > 0) {
      if (frame - s.drawn > STALE_FRAMES) hide(s);
      continue;
    }
    moved += redraw(s, drawPose(s.p, alpha));
  }
  poolFlush();
}
const movers: DetailSet[] = [];
const STALE_FRAMES = 4;

/* ---------------- motion & neighbourhood ---------------- */

interface Motion { pos: Vec3; rot: Quat; lin: Vec3; ang: Vec3 }

function motionOf(p: Piece): Motion {
  const m: Motion = { pos: [0, 0, 0], rot: [0, 0, 0, 1], lin: [0, 0, 0], ang: [0, 0, 0] };
  b3.b3Body_GetTransform(m.pos, m.rot, p.body);
  b3.b3Body_GetLinearVelocity(m.lin, p.body);
  b3.b3Body_GetAngularVelocity(m.ang, p.body);
  return m;
}

function velocityAt(m: Motion, r: ArrayLike<number>): Vec3 {
  const { lin, ang } = m;
  return [lin[0] + ang[1] * r[2] - ang[2] * r[1], lin[1] + ang[2] * r[0] - ang[0] * r[2], lin[2] + ang[0] * r[1] - ang[1] * r[0]];
}

const CELL = 0.3;
const ck = (x: number, y: number, z: number): number => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);

function gridOf(s: DetailSet): Map<number, number[]> {
  if (s.grid) return s.grid;
  const g = new Map<number, number[]>();
  for (let i = 0; i < s.n; i++) {
    const b = i * 6;
    for (let x = Math.floor(s.box[b] / CELL); x <= Math.floor(s.box[b + 3] / CELL); x++)
      for (let y = Math.floor(s.box[b + 1] / CELL); y <= Math.floor(s.box[b + 4] / CELL); y++)
        for (let z = Math.floor(s.box[b + 2] / CELL); z <= Math.floor(s.box[b + 5] / CELL); z++) {
          const key = ck(x, y, z), c = g.get(key);
          if (c) c.push(i); else g.set(key, [i]);
        }
  }
  return (s.grid = g);
}

let stamp = 0;
let stamps = new Uint32Array(0);
function near(s: DetailSet, lo: ArrayLike<number>, hi: ArrayLike<number>, out: number[]): number[] {
  out.length = 0;
  const g = gridOf(s);
  if (stamps.length < s.n) stamps = new Uint32Array(Math.max(s.n, stamps.length * 2));
  stamp++;
  if (stamp === 0xffffffff) { stamps.fill(0); stamp = 1; }
  for (let x = Math.floor((lo[0] - TOUCH) / CELL); x <= Math.floor((hi[0] + TOUCH) / CELL); x++)
    for (let y = Math.floor((lo[1] - TOUCH) / CELL); y <= Math.floor((hi[1] + TOUCH) / CELL); y++)
      for (let z = Math.floor((lo[2] - TOUCH) / CELL); z <= Math.floor((hi[2] + TOUCH) / CELL); z++) {
        const c = g.get(ck(x, y, z));
        if (c) for (const i of c) if (stamps[i] !== stamp) { stamps[i] = stamp; out.push(i); }
      }
  return out;
}

interface Touch { axis: number; sign: number; area: number; c: Vec3 }
/* face contact between local boxes a (at ai) and b (at bi): gap within tol on one axis, overlap on the other two */
function touch(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, tol = TOUCH, minOv = 0.02): Touch | null {
  let axis = -1, best = Infinity;
  const ov = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const gap = Math.max(a[ai + k] - b[bi + k + 3], b[bi + k] - a[ai + k + 3]);
    if (gap > tol) return null;
    ov[k] = -gap;
    if (Math.abs(gap) < best) { best = Math.abs(gap); axis = k; }
  }
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  if (ov[u] < minOv || ov[v] < minOv) return null;
  const c: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) c[k] = (Math.max(a[ai + k], b[bi + k]) + Math.min(a[ai + k + 3], b[bi + k + 3])) / 2;
  const sign = b[bi + axis] + b[bi + axis + 3] >= a[ai + axis] + a[ai + axis + 3] ? 1 : -1;
  return { axis, sign, area: ov[u] * ov[v], c };
}

/* ---------------- releasing units ---------------- */

interface Release {
  m: Motion;
  at: Vec3;              // world
  blast: boolean;
  speed: number;         // outward kick for non-blast releases, m/s
  rim: Set<number>;      // units that stay bonded to what is left, if a carve follows
  filter: Piece | null;  // the body they are released from, when it keeps its envelope
  temp?: number;
  spread?: boolean;      // clumps drift apart too (a member breaking up), not only single units
}

interface Made { i: number; q: Piece }

let carves = 0;
function allowance(): number {
  if (budgetStep !== stepCount) { budgetStep = stepCount; spent = 0; carves = 0; }
  return STEP_CAP - spent;
}

function unitRoot(s: DetailSet, i: number): Root {
  const r = s.p.root, v = s.vol[i];
  return { spec: s.spec[i], volume: v, value: MATS[kinds[s.kind[i]].mat].value, protected: r.protected, prop: false, demolishedVol: 0, penalized: true, density: s.mass[i] / v };
}

function spawnUnit(s: DetailSet, i: number, R: Release): Piece | null {
  const h = host!, K = kinds[s.kind[i]], o = i * 7, p = s.p;
  const rw = [0, 0, 0];
  qrot(rw, R.m.rot, s.lt[o], s.lt[o + 1], s.lt[o + 2]);
  const pos: Vec3 = [R.m.pos[0] + rw[0], R.m.pos[1] + rw[1], R.m.pos[2] + rw[2]];
  const rot = [0, 0, 0, 1];
  qmul(rot, R.m.rot, s.lt.subarray(o + 3, o + 7));
  const lin = velocityAt(R.m, rw);
  if (!R.blast && R.speed > 0 && !R.rim.has(i)) {
    const dx = pos[0] - R.at[0], dy = pos[1] - R.at[1], dz = pos[2] - R.at[2], l = Math.hypot(dx, dy, dz) || 1;
    const k = R.speed * (0.6 + 0.4 * rand()) / l;
    lin[0] += dx * k; lin[1] += dy * k + 0.3 * R.speed; lin[2] += dz * k;
  }
  const vol = s.vol[i], rubble = vol < RUBBLE_VOL;
  const q = h.createPiece({
    mat: K.mat, tint: s.spec[i].tint, poly: K.poly, box: K.box ?? undefined, cyl: K.cyl, pos, rot: rot as Quat, lin, ang: [...R.m.ang],
    uvOrigin: K.uv, depth: 1, root: unitRoot(s, i), demolished: p.demolished || rubble, awake: true, volume: vol,
    char: p.char, temp: R.temp ?? p.temp, burning: p.burning && MATS[K.mat].thermal.ignite !== undefined, frag: true,
  });
  if (!q) return null;
  if (!p.demolished) h.credit(p.root, vol * (rubble ? s.k : s.k - 1), pos);
  if (R.filter && !R.rim.has(i)) {
    const jd = b3.b3DefaultFilterJointDef();
    jd.base.bodyIdA = q.body;
    jd.base.bodyIdB = R.filter.body;
    jd.base.collideConnected = false;
    b3.b3CreateFilterJoint(world, jd);
  }
  return q;
}

/* A block of units released as one body (over budget): its own little host, still drawn as its units. */
function spawnChunk(s: DetailSet, idx: number[], R: Release, cell: [number, number, number, number, number, number]): Piece | null {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let mass = 0, vol = 0;
  for (const i of idx) {
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s.box[i * 6 + k]); hi[k] = Math.max(hi[k], s.box[i * 6 + 3 + k]); }
    mass += s.mass[i]; vol += s.vol[i];
  }
  for (let k = 0; k < 3; k++) { lo[k] = Math.max(lo[k], cell[k]); hi[k] = Math.min(hi[k], cell[k + 3]); if (hi[k] - lo[k] < MIN_PART) { const m = (lo[k] + hi[k]) / 2; lo[k] = m - MIN_PART / 2; hi[k] = m + MIN_PART / 2; } }
  const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const half: Vec3 = [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2];
  const bv = 8 * half[0] * half[1] * half[2];
  const i0 = heaviest(s, idx);
  const r = s.p.root;
  const root: Root = { spec: s.spec[i0], volume: vol, value: r.value, protected: r.protected, prop: false, demolishedVol: 0, penalized: true, density: mass / bv };
  const rw = [0, 0, 0];
  qrot(rw, R.m.rot, c[0], c[1], c[2]);
  const pos: Vec3 = [R.m.pos[0] + rw[0], R.m.pos[1] + rw[1], R.m.pos[2] + rw[2]];
  const lin = velocityAt(R.m, rw);
  if (R.spread) {
    const wc = [pos[0] - R.at[0], pos[1] - R.at[1], pos[2] - R.at[2]], l = Math.hypot(wc[0], wc[1], wc[2]) || 1;
    const k = R.speed * (0.5 + 0.5 * rand()) / l;
    lin[0] += wc[0] * k; lin[1] += wc[1] * k + 0.2 * R.speed; lin[2] += wc[2] * k;
  }
  const K = kinds[s.kind[i0]];
  const q = host!.createPiece({
    mat: K.mat, tint: s.spec[i0].tint, poly: P.boxPoly(half[0], half[1], half[2]), box: half, cyl: null, pos, rot: [...R.m.rot] as Quat, lin,
    ang: [...R.m.ang], uvOrigin: [half[0], half[1], half[2]], depth: 1, root, demolished: true, awake: true, volume: vol,
    char: s.p.char, temp: s.p.temp, frag: true,
  });
  if (!q) return null;
  if (!s.p.demolished) host!.credit(s.p.root, vol * s.k, pos);
  adopt(s, idx, q, c, null).chunk = true;
  return q;
}

function heaviest(s: DetailSet, idx: number[]): number {
  let best = idx[0];
  for (const i of idx) if (s.mass[i] > s.mass[best]) best = i;
  return best;
}

/* Move units of set s into a new set hosted by q, whose origin sits at c in s's frame (same orientation). */
function adopt(s: DetailSet, idx: number[], q: Piece, c: Vec3, parts: Part[] | null): DetailSet {
  const t = newSet(q, idx.length);
  let vol = 0;
  idx.forEach((i, j) => {
    t.spec[j] = s.spec[i]; t.kind[j] = s.kind[i]; t.layer[j] = s.layer[i]; t.vol[j] = s.vol[i]; t.mass[j] = s.mass[i];
    for (let k = 0; k < 7; k++) t.lt[j * 7 + k] = s.lt[i * 7 + k] - (k < 3 ? c[k] : 0);
    for (let k = 0; k < 6; k++) t.box[j * 6 + k] = s.box[i * 6 + k] - c[k % 3];
    const sl = s.slots[i];
    if (sl >= 0) { poolRebind(kinds[s.kind[i]].pool!, sl, t, j); s.slots[i] = -1; }
    s.gone[i] = 1;
    vol += s.vol[i];
  });
  s.live -= idx.length;
  t.live = idx.length;
  t.k = s.k;
  t.parts = parts;
  t.shown = t.slots.some((v) => v >= 0);
  if (t.shown) setPieceVisible(q.gfx, false);
  bounds(t, [0, 0, 0]);
  sets.set(q, t);
  void vol;
  return t;
}

/* Take units out of the body: individually, in chunks when over budget, or as dust when far over.
   Returns the pieces made per unit index (units in chunks or dust are absent). */
function release(s: DetailSet, idx: number[], R: Release): Made[] {
  const h = host!, made: Made[] = [];
  if (!idx.length) return made;
  const solid: number[] = [];
  let dust = 0, dustVol = 0;
  for (const i of idx) {
    if (s.gone[i]) continue;
    if (kinds[s.kind[i]].cosmetic) { dust += s.mass[i]; dustVol += s.vol[i]; drop(s, i); } else solid.push(i);
  }
  const dr = h.debris() / Math.max(1, h.budget());
  let left = allowance();
  let cellSize = dr > 0.85 ? 0.9 : dr > 0.6 || solid.length > left ? 0.45 : 0;
  if (dr > 1) left = 0;
  let groups: number[][] = solid.map((i) => [i]);
  let cells: [number, number, number, number, number, number][] = [];
  if (cellSize > 0) {
    [groups, cells] = cluster(s, solid, cellSize);
    if (groups.length > left && cellSize < 0.9) [groups, cells] = cluster(s, solid, (cellSize = 0.9));
  }
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    if (left <= 0) {
      for (const i of grp) { dust += s.mass[i]; dustVol += s.vol[i]; drop(s, i); }
      continue;
    }
    if (grp.length === 1) {
      const i = grp[0];
      const q = spawnUnit(s, i, R);
      drop(s, i);
      if (q) { made.push({ i, q }); left--; spent++; spawned++; }
    } else {
      const q = spawnChunk(s, grp, R, cells[g]);
      if (q) { left--; spent++; spawned++; } else for (const i of grp) drop(s, i);
    }
  }
  peakStep = Math.max(peakStep, spent);
  if (dustVol > 0 && !s.p.demolished) h.credit(s.p.root, dustVol * s.k, R.at);
  if (dust > 0) {
    const pm = MATS[s.p.mat];
    if (pm.style === 'shards' || pm.style === 'dice') fx.shards(R.at, clamp(Math.round(dustVol * 4000), 8, 60));
    else fx.dust(R.at, clamp(Math.cbrt(dustVol) * 3, 0.4, 3), pm.dust);
  }
  return made;
}

function drop(s: DetailSet, i: number): void {
  if (s.gone[i]) return;
  s.gone[i] = 1;
  s.live--;
  const sl = s.slots[i];
  if (sl >= 0) poolRemove(kinds[s.kind[i]].pool!, sl);
}

function cluster(s: DetailSet, idx: number[], size: number): [number[][], [number, number, number, number, number, number][]] {
  const by = new Map<string, number[]>();
  for (const i of idx) {
    const b = i * 6;
    const key = `${s.layer[i]}:${Math.floor((s.box[b] + s.box[b + 3]) / 2 / size)},${Math.floor((s.box[b + 1] + s.box[b + 4]) / 2 / size)},${Math.floor((s.box[b + 2] + s.box[b + 5]) / 2 / size)}`;
    const g = by.get(key);
    if (g) g.push(i); else by.set(key, [i]);
  }
  const groups = [...by.values()];
  const cells = groups.map((g) => {
    const b = g[0] * 6;
    const x = Math.floor((s.box[b] + s.box[b + 3]) / 2 / size), y = Math.floor((s.box[b + 1] + s.box[b + 4]) / 2 / size), z = Math.floor((s.box[b + 2] + s.box[b + 5]) / 2 / size);
    return [x * size, y * size, z * size, (x + 1) * size, (y + 1) * size, (z + 1) * size] as [number, number, number, number, number, number];
  });
  return [groups, cells];
}

/* ---------------- carving the body ---------------- */

type Op = { holes: { leaf: number; lo: Vec3; hi: Vec3 }[] } | { plane: { n: Vec3; d: number; gap: number } };

function thinAxis(s: DetailSet): number {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < s.n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s.box[i * 6 + k]); hi[k] = Math.max(hi[k], s.box[i * 6 + 3 + k]); }
  const d = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  return d[0] <= d[1] && d[0] <= d[2] ? 0 : d[1] <= d[2] ? 1 : 2;
}

function boxClip(poly: P.Poly, lo: ArrayLike<number>, hi: ArrayLike<number>): P.Poly {
  let out = poly;
  for (let k = 0; k < 3; k++) {
    const n: Vec3 = [0, 0, 0];
    n[k] = 1;
    out = P.clip(out, n, hi[k], -2);
    n[k] = -1;
    out = P.clip(out, n, -lo[k], -2);
    if (out.faces.length < 4) return out;
  }
  return out;
}

const STRUCT = 254, TIES = 255;

/* The body's current parts; a first carve splits the envelope into its leaves along the wall's thickness. */
function currentParts(s: DetailSet): Part[] {
  if (s.parts) return s.parts;
  const leaves = new Map<number, [number, number]>();
  const t = thinAxis(s);
  for (let i = 0; i < s.n; i++) {
    if (s.layer[i] === TIES || kinds[s.kind[i]].cosmetic && s.layer[i] !== 0) continue;
    const r = leaves.get(s.layer[i]) ?? [Infinity, -Infinity];
    r[0] = Math.min(r[0], s.box[i * 6 + t]); r[1] = Math.max(r[1], s.box[i * 6 + 3 + t]);
    leaves.set(s.layer[i], r);
  }
  const env = s.p.parts ? (P.hullOf(s.p.parts.map((q) => q.poly)) ?? s.p.poly) : s.p.poly;
  if (leaves.size < 2) return [{ poly: env, leaf: -1, side: 0 }];
  const out: Part[] = [];
  for (const [leaf, [a, b]] of leaves) {
    const n: Vec3 = [0, 0, 0];
    n[t] = 1;
    let poly = P.clip(env, n, b, -2);
    n[t] = -1;
    poly = P.clip(poly, n, -a, -2);
    if (poly.faces.length >= 4) out.push({ poly, leaf, side: 0 });
  }
  return out;
}

function polyBox(poly: P.Poly): number[] {
  const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
  P.bounds(poly, lo, hi);
  return [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]];
}

interface Body { parts: Part[]; units: number[]; q: Piece | null; set: DetailSet | null; c: Vec3; leaf: number; boxes: number[][] }

/* Re-cut the body's parts by holes or a plane, re-home every dormant unit, and rebuild one body per connected
   group of parts. Everything else about the member (welds to its neighbours, damage, spawn pose) carries over. */
function carve(s: DetailSet, op: Op, separateLeaves: boolean): Body[] | null {
  const h = host!, p = s.p;
  const t = thinAxis(s), u = (t + 1) % 3, v = (t + 2) % 3;
  let parts: Part[] = [];
  const start = currentParts(s);
  if ('plane' in op) {
    const { n, d, gap } = op.plane, back: Vec3 = [-n[0], -n[1], -n[2]];
    for (const q of start) {
      const a = P.clip(q.poly, n, d - gap / 2, -2), b = P.clip(q.poly, back, -(d + gap / 2), -2);
      if (a.faces.length >= 4) parts.push({ poly: a, leaf: q.leaf, side: 1 });
      if (b.faces.length >= 4) parts.push({ poly: b, leaf: q.leaf, side: 2 });
    }
  } else {
    parts = start;
    for (const hole of op.holes) {
      const next: Part[] = [];
      for (const q of parts) {
        if (hole.leaf >= 0 && q.leaf >= 0 && q.leaf !== hole.leaf) { next.push(q); continue; }
        const nu: Vec3 = [0, 0, 0], nv: Vec3 = [0, 0, 0];
        nu[u] = 1; nv[v] = 1;
        const neg = (x: Vec3): Vec3 => [-x[0], -x[1], -x[2]];
        const below = P.clip(q.poly, nv, hole.lo[v], -2);
        const above = P.clip(q.poly, neg(nv), -hole.hi[v], -2);
        let band = P.clip(P.clip(q.poly, neg(nv), -hole.lo[v], -2), nv, hole.hi[v], -2);
        const left = band.faces.length >= 4 ? P.clip(band, nu, hole.lo[u], -2) : band;
        const right = band.faces.length >= 4 ? P.clip(band, neg(nu), -hole.hi[u], -2) : band;
        band = { faces: [] };
        for (const g of [below, above, left, right]) if (g.faces.length >= 4 && g !== q.poly) next.push({ poly: g, leaf: q.leaf, side: q.side });
        if ([below, above, left, right].some((g) => g === q.poly)) next.push(q);
      }
      parts = next;
    }
  }
  // re-home units: centre inside a part of the same leaf; the rest (inside holes) become remnant parts
  const own = new Int32Array(s.n).fill(-1);
  const pb = parts.map((q) => polyBox(q.poly));
  const stray: number[] = [];
  const c: Vec3 = [0, 0, 0];
  for (let i = 0; i < s.n; i++) {
    if (s.gone[i]) continue;
    for (let k = 0; k < 3; k++) c[k] = (s.box[i * 6 + k] + s.box[i * 6 + 3 + k]) / 2;
    const lf = s.layer[i];
    for (let j = 0; j < parts.length; j++) {
      const q = parts[j];
      if (q.leaf >= 0 && lf !== q.leaf && lf !== TIES && !(kinds[s.kind[i]].cosmetic && lf !== q.leaf && q.leaf < 0)) continue;
      if (c[0] < pb[j][0] - 1e-4 || c[0] > pb[j][3] + 1e-4 || c[1] < pb[j][1] - 1e-4 || c[1] > pb[j][4] + 1e-4 || c[2] < pb[j][2] - 1e-4 || c[2] > pb[j][5] + 1e-4) continue;
      if (P.contains(q.poly, c, -1e-4)) { own[i] = j; break; }
    }
    if (own[i] < 0) stray.push(i);
  }
  // strays: whatever is left standing in a hole (the back of a wall behind knocked-out facing) keeps a part of its own
  for (const grp of touchingGroups(s, stray)) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let solid = 0, side = 0;
    for (const i of grp) {
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s.box[i * 6 + k]); hi[k] = Math.max(hi[k], s.box[i * 6 + 3 + k]); }
      if (!kinds[s.kind[i]].cosmetic) solid++;
      if ('plane' in op) side = ((s.box[i * 6] + s.box[i * 6 + 3]) * op.plane.n[0] + (s.box[i * 6 + 1] + s.box[i * 6 + 4]) * op.plane.n[1] + (s.box[i * 6 + 2] + s.box[i * 6 + 5]) * op.plane.n[2]) / 2 < op.plane.d ? 1 : 2;
    }
    if (!solid) continue;
    parts.push({ poly: boxPolyAt(lo, hi), leaf: s.layer[grp[0]] === TIES ? -1 : s.layer[grp[0]], side });
    pb.push([...lo, ...hi]);
    for (const i of grp) own[i] = parts.length - 1;
  }
  // tighten every part to its units; drop parts holding nothing solid
  const members: number[][] = parts.map(() => []);
  for (let i = 0; i < s.n; i++) if (!s.gone[i] && own[i] >= 0) members[own[i]].push(i);
  const keep: number[] = [];
  for (let j = 0; j < parts.length; j++) {
    const m = members[j];
    if (!m.some((i) => !kinds[s.kind[i]].cosmetic)) continue;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const i of m) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], s.box[i * 6 + k]); hi[k] = Math.max(hi[k], s.box[i * 6 + 3 + k]); }
    for (let k = 0; k < 3; k++) if (hi[k] - lo[k] < MIN_PART) { const mm = (lo[k] + hi[k]) / 2; lo[k] = mm - MIN_PART / 2; hi[k] = mm + MIN_PART / 2; }
    let poly = boxClip(parts[j].poly, lo, hi);
    if (poly.faces.length < 4 || P.minWidth(poly) < MIN_PART * 0.9) poly = boxPolyAt(lo, hi);
    parts[j] = { ...parts[j], poly };
    pb[j] = polyBox(poly);
    keep.push(j);
  }
  if (!keep.length || keep.length > MAX_PARTS) return null;
  // connected groups of parts become bodies
  const root = keep.map((_, i) => i), find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let a = 0; a < keep.length; a++) for (let b = a + 1; b < keep.length; b++) {
    const A = parts[keep[a]], B = parts[keep[b]], ba = pb[keep[a]], bb = pb[keep[b]];
    if (A.side !== B.side) continue;
    let joined = false;
    if (A.leaf === B.leaf || A.leaf < 0 || B.leaf < 0) joined = !!touch(ba, 0, bb, 0, 0.02, 0.03);
    else if (!separateLeaves) {
      const gap = Math.max(ba[t] - bb[t + 3], bb[t] - ba[t + 3]);
      const ou = Math.min(ba[u + 3], bb[u + 3]) - Math.max(ba[u], bb[u]), ov = Math.min(ba[v + 3], bb[v + 3]) - Math.max(ba[v], bb[v]);
      joined = gap <= 0.3 && ou > 0.1 && ov > 0.1;
    }
    if (joined) root[find(a)] = find(b);
  }
  const groups = new Map<number, number[]>();
  keep.forEach((j, i) => { const r = find(i), g = groups.get(r); if (g) g.push(j); else groups.set(r, [j]); });

  const nb = h.neighbourCaps(p), m = motionOf(p);
  const spawnPos = [...p.spawnPos], spawnRot = [...p.spawnRot];
  const wasDemolished = p.demolished, damage = p.damage, debris = p.debris, born = h.clock() - GRACE;
  sets.delete(p);
  const bodies: Body[] = [];
  for (const js of groups.values()) {
    const units: number[] = [];
    for (const j of js) for (const i of members[j]) units.push(i);
    const w: Vec3 = [0, 0, 0], cen: Vec3 = [0, 0, 0];
    let vol = 0;
    for (const j of js) { const pv = P.volumeCentroid(parts[j].poly, w); vol += pv; for (let k = 0; k < 3; k++) cen[k] += w[k] * pv; }
    if (vol <= 1e-6) continue;
    for (let k = 0; k < 3; k++) cen[k] /= vol;
    const leaves = new Set(js.map((j) => parts[j].leaf));
    bodies.push({ parts: js.map((j) => parts[j]), units, q: null, set: null, c: cen, leaf: leaves.size === 1 ? [...leaves][0] : -1, boxes: js.map((j) => pb[j]) });
  }
  hideEnvelopeOnly(s);
  h.destroyPiece(p);
  for (const B of bodies) {
    let mass = 0, uvol = 0;
    const mats = new Map<MaterialId, number>();
    for (const i of B.units) {
      mass += s.mass[i]; uvol += s.vol[i];
      if (!kinds[s.kind[i]].cosmetic) mats.set(kinds[s.kind[i]].mat, (mats.get(kinds[s.kind[i]].mat) ?? 0) + s.mass[i]);
    }
    const back: Vec3 = [-B.c[0], -B.c[1], -B.c[2]];
    const geo: PartGeo[] = B.parts.map((q) => ({ poly: P.translate(q.poly, back), cyl: null }));
    let pvol = 0;
    const w: Vec3 = [0, 0, 0];
    for (const g of geo) pvol += P.volumeCentroid(g.poly, w);
    const mat = B.leaf < 0 && B.parts.length > 1 && separateLeaves === false ? p.mat : [...mats].sort((a, b) => b[1] - a[1])[0]?.[0] ?? p.mat;
    const tint = mat === p.mat ? p.tint : s.spec[heaviest(s, B.units.filter((i) => kinds[s.kind[i]].mat === mat))].tint;
    const root: Root = { ...p.root, demolishedVol: 0, density: mass / Math.max(pvol, 1e-6) };
    const rw = [0, 0, 0];
    qrot(rw, m.rot, B.c[0], B.c[1], B.c[2]);
    const env = geo.length > 1 ? P.hullOf(geo.map((g) => g.poly)) : geo[0].poly;
    if (!env) continue;
    const q = h.createPiece({
      mat, tint, poly: env, parts: geo.length > 1 ? geo : undefined, cyl: null,
      pos: [m.pos[0] + rw[0], m.pos[1] + rw[1], m.pos[2] + rw[2]], rot: [...m.rot] as Quat, lin: velocityAt(m, rw), ang: [...m.ang],
      uvOrigin: [p.uvOrigin[0] + B.c[0], p.uvOrigin[1] + B.c[1], p.uvOrigin[2] + B.c[2]], depth: p.depth, root, demolished: wasDemolished,
      awake: true, volume: uvol * s.k, char: p.char, temp: p.temp, burning: p.burning, frag: true,
    });
    if (!q) continue;
    q.born = born;
    q.damage = damage * 0.5;
    const sr = [0, 0, 0];
    qrot(sr, spawnRot, B.c[0], B.c[1], B.c[2]);
    q.spawnPos = [spawnPos[0] + sr[0], spawnPos[1] + sr[1], spawnPos[2] + sr[2]];
    q.spawnRot = [...spawnRot] as Quat;
    if (q.debris !== debris) h.setDebris(q, debris);
    B.q = q;
    B.set = adopt(s, B.units, q, B.c, B.parts.map((pt) => ({ ...pt, poly: P.translate(pt.poly, back) })));
    B.set.carved = stepCount;
    h.reweld(q, nb);
  }
  // leaves of a fractured cavity wall stay tied across the cavity
  if (separateLeaves) {
    for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) {
      const A = bodies[a], B = bodies[b];
      if (!A.q || !B.q || A.leaf === B.leaf) continue;
      for (const ba of A.boxes) for (const bb of B.boxes) {
        const gap = Math.max(ba[t] - bb[t + 3], bb[t] - ba[t + 3]);
        const ou = Math.min(ba[u + 3], bb[u + 3]) - Math.max(ba[u], bb[u]), ov = Math.min(ba[v + 3], bb[v + 3]) - Math.max(ba[v], bb[v]);
        if (gap > 0.3 || ou < 0.2 || ov < 0.2) continue;
        const area = ou * ov, n = Math.max(1, Math.round(area * TIE_PER_M2));
        const lc: Vec3 = [0, 0, 0], nl: Vec3 = [0, 0, 0];
        lc[u] = (Math.max(ba[u], bb[u]) + Math.min(ba[u + 3], bb[u + 3])) / 2;
        lc[v] = (Math.max(ba[v], bb[v]) + Math.min(ba[v + 3], bb[v + 3])) / 2;
        lc[t] = (ba[t] + ba[t + 3] + bb[t] + bb[t + 3]) / 4;
        nl[t] = bb[t] > ba[t] ? 1 : -1;
        const nw: Vec3 = [0, 0, 0];
        qrot(nw, m.rot, nl[0], nl[1], nl[2]);
        h.createWeld(A.q, B.q, toWorld(lc, m.pos, m.rot), nw, area, { comp: area * 2e5, ten: n * TIE_KN, shear: n * TIE_KN * 0.75, torque: n * 200 });
      }
    }
  }
  return bodies;
}

function boxPolyAt(lo: ArrayLike<number>, hi: ArrayLike<number>): P.Poly {
  return P.translate(P.boxPoly((hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2), [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]);
}

/* the envelope is about to be destroyed; its units' instances are handed on, not removed */
function hideEnvelopeOnly(s: DetailSet): void {
  s.shown = false;
}

function touchingGroups(s: DetailSet, idx: number[]): number[][] {
  if (!idx.length) return [];
  const pos = new Map(idx.map((i, j) => [i, j]));
  const root = idx.map((_, j) => j), find = (j: number): number => (root[j] === j ? j : (root[j] = find(root[j])));
  const buf: number[] = [];
  for (const i of idx) {
    near(s, s.box.subarray(i * 6, i * 6 + 3), s.box.subarray(i * 6 + 3, i * 6 + 6), buf);
    for (const o of buf) {
      const j = pos.get(o);
      if (j === undefined || o === i || s.layer[o] !== s.layer[i]) continue;
      if (touch(s.box, i * 6, s.box, o * 6)) root[find(pos.get(i)!)] = find(j);
    }
  }
  const out = new Map<number, number[]>();
  idx.forEach((i, j) => { const r = find(j), g = out.get(r); if (g) g.push(i); else out.set(r, [i]); });
  return [...out.values()];
}

/* Released units that stay bonded: to each other and to whichever new body now holds the dormant units they touch. */
function bondRims(s: DetailSet, made: Made[], R: Release, bodies: Body[] | null): void {
  const h = host!;
  const rims = made.filter((x) => R.rim.has(x.i));
  if (!rims.length) return;
  const at = new Map(made.map((x) => [x.i, x.q]));
  const holder = new Map<number, Piece>();
  if (bodies) for (const B of bodies) if (B.q) for (const i of B.units) holder.set(i, B.q);
  const buf: number[] = [];
  const nw: Vec3 = [0, 0, 0];
  for (const { i, q } of rims) {
    near(s, s.box.subarray(i * 6, i * 6 + 3), s.box.subarray(i * 6 + 3, i * 6 + 6), buf);
    const toBody = new Map<Piece, { area: number; c: Vec3; axis: number; sign: number }>();
    for (const o of buf) {
      if (o === i) continue;
      const ct = touch(s.box, i * 6, s.box, o * 6);
      if (!ct) continue;
      const other = at.get(o);
      if (other) {
        if (other.id < q.id) continue;
        nw.fill(0); nw[ct.axis] = ct.sign;
        const n: Vec3 = [0, 0, 0];
        qrot(n, R.m.rot, nw[0], nw[1], nw[2]);
        h.createWeld(q, other, toWorld(ct.c, R.m.pos, R.m.rot), n, ct.area, h.jointCaps(q.pm, other.pm, ct.area));
        continue;
      }
      const hb = holder.get(o) ?? (R.filter && !R.filter.dead ? R.filter : null);
      if (!hb || kinds[s.kind[o]].cosmetic) continue;
      const e = toBody.get(hb);
      if (e) e.area += ct.area; else toBody.set(hb, { area: ct.area, c: ct.c, axis: ct.axis, sign: ct.sign });
    }
    for (const [b, e] of toBody) {
      nw.fill(0); nw[e.axis] = e.sign;
      const n: Vec3 = [0, 0, 0];
      qrot(n, R.m.rot, nw[0], nw[1], nw[2]);
      h.createWeld(q, b, toWorld(e.c, R.m.pos, R.m.rot), n, e.area, h.jointCaps(q.pm, b.pm, e.area));
    }
  }
}

/* ---------------- entry points (hooked from structure.ts) ---------------- */

/** energy that dislodges the units within this radius (J per m³ of the member's own fracture toughness) */
function reach(p: Piece, energy: number, blast: boolean): number {
  const tough = Number.isFinite(p.pm.toughness) ? p.pm.toughness : 60e3;
  return clamp(Math.cbrt((3 * energy) / (4 * Math.PI * tough)) * (blast ? 1.25 : 1), 0.06, 2.4);
}

/** damagePiece: knock out the units within reach of the hit; carve the body once enough has gone.
    Returns the energy those units absorbed; only the rest counts toward fracturing the member. */
export function detailDamage(p: Piece, point: Vec3, energy: number, blast: boolean): number {
  const s = sets.get(p);
  if (!s || !host || p.dead || s.live === 0) return 0;
  rand.at(p.spawnPos[0], p.spawnPos[1], p.spawnPos[2], point[0], point[1], point[2], stepCount);
  const r = reach(p, energy, blast);
  const m = motionOf(p);
  const li = toLocal(point, m.pos, m.rot);
  const core: number[] = [], rim = new Set<number>();
  const buf: number[] = [];
  near(s, [li[0] - r, li[1] - r, li[2] - r], [li[0] + r, li[1] + r, li[2] + r], buf);
  for (const i of buf) {
    if (s.gone[i]) continue;
    const b = i * 6;
    const dx = Math.max(s.box[b] - li[0], 0, li[0] - s.box[b + 3]);
    const dy = Math.max(s.box[b + 1] - li[1], 0, li[1] - s.box[b + 4]);
    const dz = Math.max(s.box[b + 2] - li[2], 0, li[2] - s.box[b + 5]);
    const d = Math.hypot(dx, dy, dz);
    if (d > r) continue;
    if (d > 0.7 * r) { if (rand() < 0.5) continue; rim.add(i); }
    core.push(i);
  }
  s.hit = { step: stepCount, at: li, r };
  if (!core.length) return 0;
  const tough = Number.isFinite(p.pm.toughness) ? p.pm.toughness : 60e3;
  const spentE = Math.min(energy, tough * 1.5 * s.k * core.reduce((v, i) => v + s.vol[i], 0) + (r >= 2.4 ? 0 : energy * 0.5));
  let mass = 0;
  for (const i of core) mass += s.mass[i];
  allowance();
  const willCarve = s.carved !== stepCount && carves < CARVES_PER_STEP && s.pendingVol + core.reduce((v, i) => v + s.vol[i], 0) >= CARVE_VOL;
  const R: Release = { m, at: point, blast, speed: blast ? 0 : clamp(0.5 * Math.sqrt((2 * energy) / Math.max(mass, 1)), 0.5, 7), rim: willCarve ? rim : new Set(), filter: willCarve ? null : p };
  const made = release(s, core, R);
  for (const x of made) s.pending.push(x.i);
  for (const i of core) s.pendingVol += s.vol[i];
  fx.debris(point, Math.min(30, 4 + core.length), MATS[p.mat].chips, blast ? 6 : 3);
  if (!willCarve) { shrink(s); return spentE; }
  carves++;
  const hs = holes(s, [...s.pending, ...core]);
  made.push(...fill(s, hs, R));
  const bodies = carve(s, { holes: hs }, false);
  if (!bodies) { shrink(s); return spentE; }
  bondRims(s, made, R, bodies);
  // what the released units did not absorb carries on into whichever new body now stands at the hit
  let best: Piece | null = null, bd = Infinity;
  for (const B of bodies) if (B.q && !B.q.dead) {
    const d = Math.hypot(B.q.curPos[0] - point[0], B.q.curPos[1] - point[1], B.q.curPos[2] - point[2]);
    if (d < bd) { bd = d; best = B.q; }
  }
  if (best && energy > spentE) host.damagePiece(best, point, energy - spentE, blast);
  return energy;
}

/* holes = boxes round clusters of released units, per leaf, through that leaf */
function holes(s: DetailSet, idx: number[]): { leaf: number; lo: Vec3; hi: Vec3 }[] {
  const out: { leaf: number; lo: Vec3; hi: Vec3 }[] = [];
  const uniq = [...new Set(idx)];
  const groups: { leaf: number; lo: number[]; hi: number[] }[] = [];
  for (const i of uniq) {
    if (s.layer[i] === TIES) continue;
    const b = i * 6, lf = s.layer[i];
    let g = groups.find((x) => x.leaf === lf && s.box[b] < x.hi[0] + 0.3 && s.box[b + 3] > x.lo[0] - 0.3 && s.box[b + 1] < x.hi[1] + 0.3 && s.box[b + 4] > x.lo[1] - 0.3 && s.box[b + 2] < x.hi[2] + 0.3 && s.box[b + 5] > x.lo[2] - 0.3);
    if (!g) { g = { leaf: lf, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }; groups.push(g); }
    for (let k = 0; k < 3; k++) { g.lo[k] = Math.min(g.lo[k], s.box[b + k]); g.hi[k] = Math.max(g.hi[k], s.box[b + 3 + k]); }
  }
  const multi = new Set(Array.from(s.layer)).size > 1;
  for (const g of groups) out.push({ leaf: multi ? g.leaf : -1, lo: g.lo as Vec3, hi: g.hi as Vec3 });
  s.pending.length = 0;
  s.pendingVol = 0;
  return out;
}

/* units a hole's box swallows but the hit spared come out too, bonded to the edge, rather than each
   standing in the hole as a part of their own */
function fill(s: DetailSet, hs: { leaf: number; lo: Vec3; hi: Vec3 }[], R: Release): Made[] {
  const idx: number[] = [];
  const t = thinAxis(s);
  for (let i = 0; i < s.n; i++) {
    if (s.gone[i]) continue;
    const b = i * 6;
    for (const h of hs) {
      if (h.leaf >= 0 && s.layer[i] !== h.leaf && s.layer[i] !== TIES) continue;
      let inside = true;
      for (let k = 0; k < 3 && inside; k++) {
        if (k === t && h.leaf >= 0) continue;
        const c = (s.box[b + k] + s.box[b + 3 + k]) / 2;
        inside = c >= h.lo[k] && c <= h.hi[k];
      }
      if (inside) { idx.push(i); R.rim.add(i); break; }
    }
  }
  return release(s, idx, R);
}

/* released units no longer weigh on the body */
function shrink(s: DetailSet): void {
  const p = s.p;
  if (p.dead) return;
  let mass = 0, vol = 0;
  for (let i = 0; i < s.n; i++) if (!s.gone[i]) { mass += s.mass[i]; vol += s.vol[i]; }
  if (s.live === 0) { sets.delete(p); host!.destroyPiece(p); return; }
  p.volume = vol * s.k;
  if (mass > 0 && mass < p.mass * 0.995) setMass(p, mass);
}

/** fracture: instead of Voronoi cells, the units in the struck region come out and the leaves part company. */
export function detailFracture(p: Piece, point: Vec3, intensity: number, blast: boolean): boolean {
  rand.at(p.spawnPos[0], p.spawnPos[1], p.spawnPos[2], point[0], point[1], point[2], stepCount);
  const s = sets.get(p);
  if (!s || !host) return false;
  const h = host;
  allowance();
  if (carves >= CARVES_PER_STEP) { p.damage = Math.min(p.damage, p.hp * 0.95); return true; }
  carves++;
  const m = motionOf(p);
  const li = toLocal(point, m.pos, m.rot);
  const t = thinAxis(s), u = (t + 1) % 3, v = (t + 2) % 3;
  let r = reach(p, Math.max(p.damage, p.hp * Math.min(intensity, 4)), blast) * 0.8;
  if (s.hit.step >= stepCount - 1) r = Math.max(r, s.hit.r);
  const lo: Vec3 = [-Infinity, -Infinity, -Infinity], hi: Vec3 = [Infinity, Infinity, Infinity];
  lo[u] = li[u] - r; hi[u] = li[u] + r; lo[v] = li[v] - r; hi[v] = li[v] + r;
  const core: number[] = [], rim = new Set<number>();
  for (let i = 0; i < s.n; i++) {
    if (s.gone[i]) continue;
    const b = i * 6, cu = (s.box[b + u] + s.box[b + 3 + u]) / 2, cv = (s.box[b + v] + s.box[b + 3 + v]) / 2;
    if (cu < lo[u] || cu > hi[u] || cv < lo[v] || cv > hi[v]) continue;
    core.push(i);
    const e = Math.max(Math.abs(cu - li[u]), Math.abs(cv - li[v]));
    if (e > r - 0.12 && rand() < 0.5) rim.add(i);
  }
  h.counters.fractures++;
  const pm = p.pm, vol0 = p.volume;
  const R: Release = { m, at: point, blast, speed: blast ? 0 : clamp(intensity * 1.2, 0.5, 6), rim, filter: null };
  const made = release(s, core, R);
  const hs = [{ leaf: -1, lo: [...lo] as Vec3, hi: [...hi] as Vec3 }, ...holes(s, s.pending)];
  made.push(...fill(s, hs, R));
  const bodies = carve(s, { holes: hs }, true);
  if (!bodies) {
    // too fragmented to hold together as parts: everything goes
    const rest: number[] = [];
    for (let i = 0; i < s.n; i++) if (!s.gone[i]) rest.push(i);
    release(s, rest, R);
    sets.delete(p);
    h.destroyPiece(p);
  } else bondRims(s, made, R, bodies);
  const size = clamp(Math.cbrt(vol0) * 1.4, 0.5, 4.5);
  fx.dust(point, size, pm.dust);
  fx.debris(point, Math.round(8 + size * 10), pm.chips, blast ? 7 : 4);
  audio.fracture(point, p.mat, clamp(vol0, 0.05, 2));
  return true;
}

const SHATTER_BODIES = 24;
/** A panel blown out of its frame breaks up along its joints in flight: the units nearest the load come out one by
    one, the rest as joint-bounded clumps still drawn as their units (at most SHATTER_BODIES bodies, coarser when the
    debris budget is tight), each drifting apart from the others. The member is gone afterwards. */
export function detailShatter(p: Piece, at: Vec3): boolean {
  const s = sets.get(p);
  if (!s || !host || p.dead || s.live === 0) return false;
  // a clump that lands hard comes apart into its bricks, while the debris budget has room for them
  const fine = s.chunk;
  const room = host.budget() * 1.1 - host.debris();
  const most = fine ? Math.min(18, Math.floor(room / 25)) : clamp(Math.floor(room / 6), 4, SHATTER_BODIES + 8);
  if (fine && most < 3) return false;
  rand.at(p.spawnPos[0], p.spawnPos[1], p.spawnPos[2], at[0], at[1], at[2], stepCount);
  const h = host, m = motionOf(p), li = toLocal(at, m.pos, m.rot);
  // mortar and skims go with the clumps they hold together (brick rubble comes with its mortar on); the rest is dust
  const solid: number[] = [], joints: number[] = [];
  let dustVol = 0;
  for (let i = 0; i < s.n; i++) {
    if (s.gone[i]) continue;
    if (kinds[s.kind[i]].cosmetic) joints.push(i); else solid.push(i);
  }
  const dr = h.debris() / Math.max(1, h.budget());
  const nSingle = Math.min(fine ? Math.ceil(most * 0.6) : 8, Math.floor(most / 4));
  const dist = (i: number): number => {
    const b = i * 6;
    return Math.hypot((s.box[b] + s.box[b + 3]) / 2 - li[0], (s.box[b + 1] + s.box[b + 4]) / 2 - li[1], (s.box[b + 2] + s.box[b + 5]) / 2 - li[2]);
  };
  solid.sort((a, b) => dist(a) - dist(b) || a - b);
  const singles = solid.slice(0, nSingle), rest = solid.slice(nSingle).concat(joints);
  let size = fine ? 0.3 : 0.5;
  let [groups, cells] = cluster(s, rest, size);
  const clumps = most - singles.length;
  while (groups.length > clumps && size < 2.2) [groups, cells] = cluster(s, rest, (size *= 1.3));
  const R: Release = { m, at, blast: false, speed: fine ? 0.8 : 1.4, rim: new Set(), filter: null, spread: true };
  for (const i of singles) {
    const q = spawnUnit(s, i, R);
    drop(s, i);
    if (q) { spent++; spawned++; }
  }
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    const units = grp.filter((i) => !kinds[s.kind[i]].cosmetic);
    if (units.length <= 1) {
      for (const i of grp) if (i !== units[0]) { dustVol += s.vol[i]; drop(s, i); }
      if (units.length) {
        const q = spawnUnit(s, units[0], R);
        drop(s, units[0]);
        if (q) { spent++; spawned++; }
      }
      continue;
    }
    const q = spawnChunk(s, grp, R, cells[g]);
    if (q) { spent++; spawned++; } else for (const i of grp) { dustVol += s.vol[i]; drop(s, i); }
  }
  peakStep = Math.max(peakStep, spent);
  if (dustVol > 0 && !p.demolished) h.credit(p.root, dustVol * s.k, at);
  h.counters.fractures++;
  sets.delete(p);
  h.destroyPiece(p);
  const pm = MATS[p.mat];
  fx.crushDust(at, p.volume, pm.dust);
  fx.debris(at, 24, pm.chips, 6);
  audio.fracture(at, p.mat, clamp(p.volume, 0.05, 2));
  return true;
}

/** sever: the units the cut passes through drop out; the parts on either side become separate bodies. */
export function detailSever(p: Piece, point: Vec3, normal: Vec3, kerf = 0.03): boolean {
  rand.at(p.spawnPos[0], p.spawnPos[1], p.spawnPos[2], point[0], point[1], point[2], stepCount);
  const s = sets.get(p);
  if (!s || !host) return false;
  const m = motionOf(p);
  const nl: Vec3 = [0, 0, 0];
  qrot(nl, conj(m.rot), normal[0], normal[1], normal[2]);
  const l = Math.hypot(nl[0], nl[1], nl[2]) || 1;
  nl[0] /= l; nl[1] /= l; nl[2] /= l;
  const li = toLocal(point, m.pos, m.rot);
  return split(s, m, nl, nl[0] * li[0] + nl[1] * li[1] + nl[2] * li[2], kerf, point);
}

function split(s: DetailSet, m: Motion, nl: Vec3, d: number, kerf: number, at: Vec3): boolean {
  const core: number[] = [];
  let a = 0, b = 0;
  for (let i = 0; i < s.n; i++) {
    if (s.gone[i]) continue;
    const o = i * 6;
    let c = 0, e = 0;
    for (let k = 0; k < 3; k++) { c += nl[k] * (s.box[o + k] + s.box[o + 3 + k]) / 2; e += Math.abs(nl[k]) * (s.box[o + 3 + k] - s.box[o + k]) / 2; }
    if (c + e > d - kerf / 2 + 1e-4 && c - e < d + kerf / 2 - 1e-4) core.push(i);
    else if (c < d) a++; else b++;
  }
  if (!a || !b) return false;
  const R: Release = { m, at, blast: false, speed: 0.4, rim: new Set(), filter: null };
  release(s, core, R);
  const bodies = carve(s, { plane: { n: nl, d, gap: kerf } }, false);
  if (!bodies) return false;
  fx.dust(at, 0.8, MATS[s.p.mat].dust);
  return true;
}

/** crackMember: masonry cracks along the nearest bed joint, other members square across, a short way in. */
export function detailCrack(p: Piece, at: Vec3, into: Vec3): boolean {
  rand.at(p.spawnPos[0], p.spawnPos[1], p.spawnPos[2], at[0], at[1], at[2], stepCount);
  const s = sets.get(p);
  if (!s || !host) return false;
  allowance();
  if (carves >= CARVES_PER_STEP) return false;
  carves++;
  const m = motionOf(p);
  const nl: Vec3 = [0, 0, 0];
  qrot(nl, conj(m.rot), into[0], into[1], into[2]);
  const k = Math.abs(nl[0]) >= Math.abs(nl[1]) && Math.abs(nl[0]) >= Math.abs(nl[2]) ? 0 : Math.abs(nl[1]) >= Math.abs(nl[2]) ? 1 : 2;
  const sg = Math.sign(nl[k]) || 1;
  nl.fill(0);
  nl[k] = 1;
  const ai = toLocal(at, m.pos, m.rot);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < s.n; i++) if (!s.gone[i]) { lo = Math.min(lo, s.box[i * 6 + k]); hi = Math.max(hi, s.box[i * 6 + 3 + k]); }
  const L = sg > 0 ? hi - ai[k] : ai[k] - lo;
  if (L < 0.5) return false;
  const want = ai[k] + sg * L * (0.1 + 0.3 * rand());
  // the unit face nearest the target: a bed joint for masonry
  let best = want, bd = Infinity;
  for (let i = 0; i < s.n; i++) {
    if (s.gone[i] || kinds[s.kind[i]].cosmetic) continue;
    const f = s.box[i * 6 + k], dd = Math.abs(f - want);
    if (dd < bd && f > lo + 0.1 && f < hi - 0.1) { bd = dd; best = f; }
  }
  if (!split(s, m, nl, best - 0.005, 0.012, toWorld(ai, m.pos, m.rot))) return false;
  host.counters.cracks++;
  return true;
}

/* Heat works in from whichever face is exposed: gypsum calcines and drops, PIR chars, block and concrete faces spall;
   fired brick shrugs it off. A unit is exposed on the big faces of the member or next to one already gone. */
const HEAT_AT: Partial<Record<MaterialId, number>> = {
  plaster: 320, drywall: 300, pvc: 260, wood: 280, plywood: 270, cinderblock: 620, concrete: 560, rconcrete: 600, sandstone: 650, glass: 180, tempered: 480,
};
let heatBudget = 0, heatStep = -1;

export function detailHeat(p: Piece): void {
  const s = sets.get(p);
  if (!s || !host || p.dead || p.temp < 250 || s.live === 0) return;
  if (heatStep !== stepCount) { heatStep = stepCount; heatBudget = 10; }
  if (heatBudget <= 0) return;
  const t = thinAxis(s);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < s.n; i++) if (!s.gone[i]) { lo = Math.min(lo, s.box[i * 6 + t]); hi = Math.max(hi, s.box[i * 6 + 3 + t]); }
  // which face the fire is on
  let side = 0, best = Infinity;
  for (const f of host.burning()) {
    const d = Math.hypot(f.curPos[0] - p.curPos[0], f.curPos[1] - p.curPos[1], f.curPos[2] - p.curPos[2]);
    if (d < best && d < 6) { best = d; const l = toLocal(f.curPos, p.curPos, p.curRot); side = Math.sign(l[t] - (lo + hi) / 2); }
  }
  const pick: number[] = [];
  const buf: number[] = [];
  for (let i = 0; i < s.n && pick.length < 3; i++) {
    if (s.gone[i]) continue;
    const at = HEAT_AT[kinds[s.kind[i]].mat];
    if (at === undefined || p.temp < at) continue;
    const b = i * 6;
    let exposed = (side >= 0 && s.box[b + 3 + t] >= hi - 0.004) || (side <= 0 && s.box[b + t] <= lo + 0.004);
    if (!exposed) {
      near(s, s.box.subarray(b, b + 3), s.box.subarray(b + 3, b + 6), buf);
      exposed = buf.some((o) => s.gone[o] && o !== i && !!touch(s.box, b, s.box, o * 6) && (s.box[o * 6 + t] > s.box[b + t] + 0.004) === side >= 0);
    }
    if (exposed && rand() < 0.35) pick.push(i);
  }
  if (!pick.length) return;
  heatBudget -= pick.length;
  host.counters.spalls++;
  const m = motionOf(p);
  const at = toWorld(s.box.subarray(pick[0] * 6, pick[0] * 6 + 3), m.pos, m.rot);
  release(s, pick, { m, at, blast: false, speed: 0.6, rim: new Set(), filter: p, temp: p.temp });
  for (const i of pick) { s.pending.push(i); s.pendingVol += s.vol[i]; }
  audio.spall(at);
  shrink(s);
}

/* ---------------- stats ---------------- */

export function detailStats(): { sets: number; units: number; shown: number; kinds: number; pools: number; instances: number; triangles: number; bytes: number; spawned: number; peakStep: number } {
  let units = 0, shown = 0;
  for (const s of sets.values()) { units += s.live; if (s.shown) shown++; }
  const ps = poolStats();
  return { sets: sets.size, units, shown, kinds: kinds.length, pools: ps.pools, instances: ps.instances, triangles: ps.triangles, bytes: ps.bytes, spawned, peakStep };
}
