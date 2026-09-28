import type { MaterialId, PieceSpec, Vec3 } from '../types.ts';
import { effectiveDensity } from '../destruction/materials.ts';
import { hullPoly, contains, type Poly } from '../destruction/polytope.ts';
import type { Range } from './kit.ts';

/* Layered construction as dormant detail. Every helper returns ONE coarse parent (the member physics sees) whose
   `detail` holds the real layers and units it is built from, world-space inside it: the parent keeps being a
   single body carrying their mass until damage releases the units near a hit (src/destruction/detail.ts).
   `layer` numbers the leaves a fracture may part (outer leaf 0, inner leaf 1; 255 = wall ties across the cavity).
   Courses and board grids are anchored on the builder's origin so neighbouring panels line up across openings. */

type Ax = 0 | 1 | 2;

/** A rectangular member in builder coordinates: `u` runs along it, `v` across its face, `t` through its thickness.
    Layers stack from the `out` face of t inwards (walls: out = the weather side; floors: out = +1, the top). */
export interface Slab { u: Ax; v: Ax; t: Ax; U: Range; V: Range; T: Range; out: 1 | -1 }

const snap = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
const EPS = 1e-6;

/** wall slab from a box along X (axis 'x') or Z, standing from y[0] to y[1] */
export function wallSlab(axis: 'x' | 'z', along: Range, y: Range, thick: Range, out: 1 | -1): Slab {
  return axis === 'x' ? { u: 0, v: 1, t: 2, U: along, V: y, T: thick, out } : { u: 2, v: 1, t: 0, U: along, V: y, T: thick, out };
}

/** floor slab: spans X × Z, layers stacked down from the top */
export function floorSlab(x: Range, z: Range, y: Range): Slab {
  return { u: 0, v: 2, t: 1, U: x, V: z, T: y, out: 1 };
}

interface UnitOpts { tint?: number; layer?: number; density?: number; finish?: PieceSpec['finish'] }

function cell(s: Slab, mat: MaterialId, u: Range, v: Range, t: Range, o: UnitOpts = {}): PieceSpec {
  const lo: number[] = [0, 0, 0], hi: number[] = [0, 0, 0];
  lo[s.u] = u[0]; hi[s.u] = u[1]; lo[s.v] = v[0]; hi[s.v] = v[1]; lo[s.t] = t[0]; hi[s.t] = t[1];
  const p: PieceSpec = { mat, size: [snap(hi[0] - lo[0]), snap(hi[1] - lo[1]), snap(hi[2] - lo[2])], pos: [snap((lo[0] + hi[0]) / 2), snap((lo[1] + hi[1]) / 2), snap((lo[2] + hi[2]) / 2)] };
  if (o.tint !== undefined) p.tint = o.tint;
  if (o.layer) p.layer = o.layer;
  if (o.density !== undefined) p.density = o.density;
  if (o.finish) p.finish = o.finish;
  return p;
}

const clipR = (a: Range, b: Range): Range | null => {
  const r: Range = [Math.max(a[0], b[0]), Math.min(a[1], b[1])];
  return r[1] - r[0] > EPS ? r : null;
};

/** the thickness range of a layer `depth` deep from the out face, `th` thick */
function band(s: Slab, depth: number, th: number): Range {
  return s.out > 0 ? [s.T[1] - depth - th, s.T[1] - depth] : [s.T[0] + depth, s.T[0] + depth + th];
}

/* deterministic per-course variation */
function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/* ---------------- masonry ---------------- */

export interface Bond {
  mat: MaterialId;
  tint?: number;
  /** unit length and height, joints excluded (headers are half a stretcher module) */
  unit: [number, number] | [number, number, number];
  joint: number;
  kind: 'stretcher' | 'flemish' | 'english' | 'random';
  /** random bond: unit lengths to pick from */
  lengths?: number[];
  seed?: number;
}

export const BRICK: [number, number, number] = [0.215, 0.065, 0.1025];
export const BLOCK: [number, number, number] = [0.44, 0.215, 0.1];
const J = 0.01;

/** One masonry leaf across `T` in the given bond. Each unit is laid as its module — the unit with half of every joint
    round it — so the leaf is filled solid, the mortar's mass rides in its units and the joints are drawn by the
    unit's texture cell (brick 225 × 75, block 450 × 225 modules) instead of costing a unit of their own.
    One-brick walls lay stretchers in pairs across the thickness. */
export function masonry(s: Slab, T: Range, b: Bond, layer = 0): PieceSpec[] {
  const out: PieceSpec[] = [];
  const [L, H] = b.unit, j = b.joint, C = H + j, SL = L + j, HL = SL / 2;
  const two = T[1] - T[0] >= 0.18 && (b.kind === 'flemish' || b.kind === 'english');
  const tm = (T[0] + T[1]) / 2;
  const o: UnitOpts = { tint: b.tint, layer };
  for (let k = Math.floor(s.V[0] / C + EPS); k * C < s.V[1] - EPS; k++) {
    const v = clipR([k * C, (k + 1) * C], s.V);
    if (!v) continue;
    const els: { u: Range; head: boolean }[] = [];
    const add = (a: number, len: number, head: boolean): void => { const u = clipR([a, a + len], s.U); if (u) els.push({ u, head }); };
    let x: number;
    if (b.kind === 'flemish') {
      const P = SL + HL;
      x = Math.floor((s.U[0] - (k & 1) * P / 2) / P) * P + (k & 1) * P / 2;
      for (let i = 0; x < s.U[1]; i++) { const head = i % 2 === 1, len = head ? HL : SL; add(x, len, head); x += len; }
    } else if (b.kind === 'random') {
      const ls = b.lengths ?? [L];
      x = Math.floor(s.U[0]) - hash(k, 7) * (ls[0] + j);
      for (let i = 0; x < s.U[1]; i++) { const len = ls[Math.floor(hash(k, i, b.seed ?? 0) * ls.length)] + j; add(x, len, false); x += len; }
    } else {
      const head = b.kind === 'english' && (k & 1) === 1, M = head ? HL : SL, off = head ? (k & 2 ? M / 2 : 0) : (k & 1) * M / 2;
      for (x = Math.floor((s.U[0] - off) / M) * M + off; x < s.U[1]; x += M) add(x, M, head);
    }
    // sliver closers merge into their neighbour
    for (let i = 0; i < els.length && els.length > 1; i++) {
      if (els[i].u[1] - els[i].u[0] >= 0.04) continue;
      const n = i + 1 < els.length ? i + 1 : i - 1;
      els[n].u = [Math.min(els[n].u[0], els[i].u[0]), Math.max(els[n].u[1], els[i].u[1])];
      els.splice(i--, 1);
    }
    for (const e of els) {
      if (two && !e.head) out.push(cell(s, b.mat, e.u, v, [T[0], tm], o), cell(s, b.mat, e.u, v, [tm, T[1]], o));
      else out.push(cell(s, b.mat, e.u, v, T, o));
    }
  }
  return out;
}

/* ---------------- sheet layers ---------------- */

/** boards on a grid (plasterboard, insulation, OSB, screed bays), `gap` between them, anchored on the builder's origin */
export function boards(s: Slab, T: Range, mat: MaterialId, size: [number, number], gap: number, o: UnitOpts = {}, vOff = 0): PieceSpec[] {
  const out: PieceSpec[] = [];
  const [bu, bv] = size;
  for (let x = Math.floor(s.U[0] / bu) * bu; x < s.U[1] - EPS; x += bu) {
    const u = clipR([x + gap / 2, x + bu - gap / 2], s.U);
    if (!u || u[1] - u[0] < 0.05) continue;
    for (let y = Math.floor((s.V[0] - vOff) / bv) * bv + vOff; y < s.V[1] - EPS; y += bv) {
      const v = clipR([y + gap / 2, y + bv - gap / 2], s.V);
      if (v && v[1] - v[0] >= 0.05) out.push(cell(s, mat, u, v, T, o));
    }
  }
  return out;
}

/** stainless wall ties across the cavity at 900 × 450, in the joints between the insulation boards */
export function ties(s: Slab, T: Range, vOff = 0): PieceSpec[] {
  const out: PieceSpec[] = [];
  for (let m = Math.ceil((s.V[0] - vOff) / 0.45); vOff + m * 0.45 < s.V[1] - 0.05; m++) {
    const y = vOff + m * 0.45;
    if (y < s.V[0] + 0.05) continue;
    for (let x = Math.ceil(s.U[0] / 0.9) * 0.9 + (m & 1) * 0.45; x < s.U[1] - 0.05; x += 0.9) {
      if (x < s.U[0] + 0.05) continue;
      out.push(cell(s, 'steel', [x - 0.002, x + 0.002], [y - 0.002, y + 0.002], T, { layer: 255, tint: 0xb9bdc2 }));
    }
  }
  return out;
}

/** timber studs at 600 centres with sole and head plates and a row of noggins at mid height */
export function studs(s: Slab, T: Range, o: UnitOpts = {}, w = 0.047, spacing = 0.6): PieceSpec[] {
  const out: PieceSpec[] = [];
  const V0 = s.V[0] + w, V1 = s.V[1] - w;
  out.push(cell(s, 'wood', s.U, [s.V[0], V0], T, o), cell(s, 'wood', s.U, [V1, s.V[1]], T, o));
  const xs: number[] = [s.U[0]];
  for (let x = Math.ceil((s.U[0] + w + 0.1) / spacing) * spacing; x < s.U[1] - w - 0.1; x += spacing) xs.push(x - w / 2);
  xs.push(s.U[1] - w);
  const mid = (V0 + V1) / 2;
  for (let i = 0; i < xs.length; i++) {
    out.push(cell(s, 'wood', [xs[i], xs[i] + w], [V0, V1], T, o));
    if (i + 1 < xs.length && xs[i + 1] - xs[i] - w > 0.1) {
      out.push(cell(s, 'wood', [xs[i] + w, xs[i + 1]], [mid - w / 2, mid + w / 2], T, o));
    }
  }
  return out;
}

/* ---------------- whole constructions ---------------- */

/** the parent: a box over the slab with its units as detail, carrying their mass */
export function layered(mat: MaterialId, s: Slab, detail: PieceSpec[], o: { tint?: number; finish?: PieceSpec['finish'] } = {}): PieceSpec {
  const p = cell(s, mat, s.U, s.V, s.T, { tint: o.tint, finish: o.finish });
  return withDetail(p, detail);
}

/** attach units to an existing parent and give it their mass (sum of volumes × densities over the envelope) */
export function withDetail(p: PieceSpec, detail: PieceSpec[]): PieceSpec {
  let mass = 0;
  for (const c of detail) {
    const v = unitVolume(c);
    mass += v * effectiveDensity(c, v);
  }
  const env = p.size[0] * p.size[1] * p.size[2];
  if (detail.length) {
    p.detail = detail;
    p.density = Math.round((mass / env) * 1000) / 1000;
  }
  return p;
}

function unitVolume(c: PieceSpec): number {
  if (c.parts) return c.parts.reduce((v, q) => v + q.size[0] * q.size[1] * q.size[2], 0);
  if (c.shape === 'hull' && c.verts) {
    const poly = hullPoly(c.verts.flat());
    return poly ? polyVolume(poly) : 0;
  }
  return c.size[0] * c.size[1] * c.size[2];
}

function polyVolume(p: Poly): number {
  let v = 0;
  for (const f of p.faces) {
    const q = f.pts;
    for (let i = 1; i + 1 < q.length / 3; i++) {
      v += (q[0] * (q[i * 3 + 1] * q[i * 3 + 5] - q[i * 3 + 2] * q[i * 3 + 4]) - q[1] * (q[i * 3] * q[i * 3 + 5] - q[i * 3 + 2] * q[i * 3 + 3])
        + q[2] * (q[i * 3] * q[i * 3 + 4] - q[i * 3 + 1] * q[i * 3 + 3])) / 6;
    }
  }
  return Math.abs(v);
}

export interface CavityOpts {
  brickTint?: number;
  /** clear cavity 50–100 mm, half of it (up to 50 mm) PIR board against the inner leaf */
  cavity?: number;
  blockTint?: number;
  /** 'skim' 13 mm plaster on the blocks, or 'dry' plasterboard on dabs */
  finish?: 'skim' | 'dry' | 'none';
  finishTint?: number;
}

/** Modern cavity wall: facing brick in stretcher bond, cavity with PIR boards and ties, 100 mm blockwork, plaster.
    Needs ≥ 0.29 m; whatever is left over widens the cavity. */
export function cavityWall(s: Slab, o: CavityOpts = {}): PieceSpec {
  return layered('brick', s, cavityUnits(s, o), { tint: o.brickTint });
}

function cavityUnits(s: Slab, o: CavityOpts): PieceSpec[] {
  const T = s.T[1] - s.T[0], fin = o.finish ?? 'dry';
  const fth = fin === 'skim' ? 0.013 : fin === 'dry' ? 0.0255 : 0;
  const cav = T - BRICK[2] - BLOCK[2] - fth;
  const out: PieceSpec[] = [];
  const outer = band(s, 0, BRICK[2]);
  out.push(...masonry(s, outer, { mat: 'brick', tint: o.brickTint, unit: BRICK, joint: J, kind: 'stretcher' }, 0));
  const pir = Math.min(0.05, cav / 2);
  const clear = band(s, BRICK[2], cav - pir), board = band(s, BRICK[2] + cav - pir, pir);
  out.push(...boards(s, board, 'insulation', [1.2, 0.45], 0.008, { layer: 1, tint: 0xd8c38a }));
  const all: Range = [Math.min(clear[0], board[0]), Math.max(clear[1], board[1])];
  out.push(...ties(s, all));
  const inner = band(s, BRICK[2] + cav, BLOCK[2]);
  out.push(...masonry(s, inner, { mat: 'cinderblock', tint: o.blockTint ?? 0xc9c6bd, unit: BLOCK, joint: J, kind: 'stretcher' }, 1));
  out.push(...finishes(s, BRICK[2] + cav + BLOCK[2], fin, o.finishTint, 1));
  return out;
}

function finishes(s: Slab, depth: number, fin: 'skim' | 'dry' | 'none', tint: number | undefined, layer: number): PieceSpec[] {
  if (fin === 'none') return [];
  if (fin === 'skim') return boards(s, band(s, depth, 0.013), 'plaster', [1.2, 1.2], 0, { layer, tint });
  // plasterboard on dabs: 10 mm adhesive gap with dabs, 12.5 mm board, 3 mm skim
  const out: PieceSpec[] = [];
  const gap = band(s, depth, 0.01);
  for (const b of boards(s, gap, 'plaster', [0.3, 0.4], 0.24, { layer, tint: 0xcfc6b4 })) out.push(b);
  out.push(...boards(s, band(s, depth + 0.01, 0.0125), 'drywall', [1.2, 2.4], 0.002, { layer, tint }));
  out.push(...boards(s, band(s, depth + 0.0225, 0.003), 'plaster', [1.2, 2.4], 0.002, { layer, tint }));
  return out;
}

/** Solid Victorian one-brick (or thicker) wall in Flemish bond with lime mortar, lime plaster inside. */
export function solidBrickWall(s: Slab, o: { tint?: number; plaster?: number; bond?: 'flemish' | 'english' } = {}): PieceSpec {
  const T = s.T[1] - s.T[0], pl = o.plaster !== undefined && T > 0.2 ? 0.015 : 0;
  const d: PieceSpec[] = masonry(s, band(s, 0, T - pl), { mat: 'brick', tint: o.tint, unit: [BRICK[0], BRICK[1], (T - pl - J) / 2], joint: J, kind: o.bond ?? 'flemish' });
  if (pl) d.push(...boards(s, band(s, T - pl, pl), 'plaster', [1.2, 1.2], 0, { tint: o.plaster }));
  return layered('brick', s, d, { tint: o.tint });
}

/** Half-brick leaf (garden walls, infill, chimneys' faces) in stretcher bond. */
export function brickLeaf(s: Slab, o: { tint?: number; lime?: boolean } = {}): PieceSpec {
  return layered('brick', s, masonry(s, s.T, { mat: 'brick', tint: o.tint, unit: [BRICK[0], BRICK[1], s.T[1] - s.T[0]], joint: J, kind: 'stretcher' }), { tint: o.tint });
}

/** Blockwork: 440 × 215 dense blocks in half bond, optional render / plaster faces. */
export function blockWall(s: Slab, o: { tint?: number; render?: number; plaster?: number } = {}): PieceSpec {
  const T = s.T[1] - s.T[0];
  const r = o.render !== undefined ? 0.015 : 0, pl = o.plaster !== undefined ? 0.013 : 0;
  const d: PieceSpec[] = masonry(s, band(s, r, T - r - pl), { mat: 'cinderblock', tint: o.tint ?? 0xc9c6bd, unit: [BLOCK[0], BLOCK[1], T - r - pl], joint: J, kind: 'stretcher' });
  if (r) d.push(...boards(s, band(s, 0, r), 'plaster', [1.5, 1.2], 0, { tint: o.render }));
  if (pl) d.push(...boards(s, band(s, T - pl, pl), 'plaster', [1.2, 1.2], 0, { tint: o.plaster }));
  return layered('cinderblock', s, d, { tint: o.render ?? o.tint });
}

/** Stone: coursed ashlar face 150 mm deep, random rubble core in lime behind it. */
export function stoneWall(s: Slab, o: { mat?: 'stone' | 'sandstone'; tint?: number; face?: number } = {}): PieceSpec {
  const mat = o.mat ?? 'stone', T = s.T[1] - s.T[0], f = Math.min(o.face ?? 0.15, T);
  const d = masonry(s, band(s, 0, f), { mat, tint: o.tint, unit: [0.6, 0.29, f], joint: J, kind: 'random', lengths: [0.45, 0.6, 0.75], seed: 3 });
  if (T - f >= 0.1) {
    d.push(...masonry(s, band(s, f, T - f), { mat, tint: o.tint === undefined ? 0xb8b0a0 : o.tint, unit: [0.3, 0.19, T - f], joint: J, kind: 'random', lengths: [0.22, 0.3, 0.38], seed: 11 }));
  }
  return layered(mat, s, d, { tint: o.tint });
}

/** Stud partition: timber studs and noggins, 12.5 mm plasterboard both faces. */
export function studPartition(s: Slab, o: { tint?: number } = {}): PieceSpec {
  const T = s.T[1] - s.T[0], bd = Math.min(0.0125, T / 5);
  const d = [
    ...boards(s, band(s, 0, bd), 'drywall', [1.2, 2.4], 0.002, { tint: o.tint }),
    ...studs(s, band(s, bd, T - 2 * bd)),
    ...boards(s, band(s, T - bd, bd), 'drywall', [1.2, 2.4], 0.002, { tint: o.tint }),
  ];
  return layered('drywall', s, d, { tint: o.tint });
}

/** Suspended timber floor: chipboard decking on joists at 400 centres (spanning along v), plasterboard ceiling. */
export function timberFloor(s: Slab, o: { tint?: number; ceiling?: number | false } = {}): PieceSpec {
  const T = s.T[1] - s.T[0], deck = 0.022, ceil = o.ceiling === false ? 0 : 0.0155, jd = Math.min(0.22, T - deck - ceil);
  const d: PieceSpec[] = [...boards(s, band(s, 0, deck), 'plywood', [0.6, 2.4], 0.002, { tint: o.tint ?? 0xc9b48e })];
  const jt = band(s, deck, jd);
  for (let x = Math.ceil(s.U[0] / 0.4) * 0.4; x < s.U[1] - 0.03; x += 0.4) {
    const u = clipR([x - 0.025, x + 0.025], s.U);
    if (u && u[1] - u[0] > 0.03) d.push(cell(s, 'wood', u, s.V, jt));
  }
  if (ceil) {
    d.push(...boards(s, band(s, T - ceil, 0.0125), 'drywall', [1.2, 2.4], 0.002, { tint: o.ceiling as number | undefined }));
    d.push(...boards(s, band(s, T - 0.003, 0.003), 'plaster', [1.2, 2.4], 0.002, { tint: o.ceiling as number | undefined }));
  }
  return layered('wood', s, d);
}

/** RC slab in cast bays, 50 mm sand-cement screed, floor finish ('tile' 600 mm porcelain, 'vinyl' sheet, or none). */
export function rcSlab(s: Slab, o: { tint?: number; finish?: 'tile' | 'vinyl' | 'none'; finishTint?: number; bay?: number } = {}): PieceSpec {
  const T = s.T[1] - s.T[0], fin = o.finish ?? 'vinyl';
  const ft = fin === 'tile' ? 0.012 : fin === 'vinyl' ? 0.003 : 0, sc = Math.min(0.05, T * 0.25);
  const d: PieceSpec[] = [];
  if (fin === 'tile') d.push(...boards(s, band(s, 0, ft), 'ceramic', [0.6, 0.6], 0.003, { tint: o.finishTint ?? 0xd9d4ca }));
  else if (fin === 'vinyl') d.push(...boards(s, band(s, 0, ft), 'pvc', [2, 2], 0.001, { tint: o.finishTint ?? 0x8c8f8a, density: 1400 }));
  d.push(...boards(s, band(s, ft, sc), 'concrete', [2.4, 2.4], 0, { tint: 0xc4bfb3 }));
  const b = o.bay ?? 1.5;
  d.push(...boards(s, band(s, ft + sc, T - ft - sc), 'rconcrete', [b, b], 0, { tint: o.tint }));
  return layered('rconcrete', s, d, { tint: o.tint });
}

/** Curtain-wall bay (pane line of a storey): mullion edges, transom at sill height, spandrel below (outer lite, PIR,
    steel backpan), double-glazed vision above, intumescent fire stop along the head under the slab. */
export function curtainBay(s: Slab, o: { tint?: number; frame?: number; sill?: number } = {}): PieceSpec {
  const T = s.T[1] - s.T[0], fr = o.frame ?? 0x6f8fae;
  const sill = s.V[0] + (o.sill ?? 0.9);
  const m = 0.05, tr = 0.06, fsH = 0.03;
  const U: Range = [s.U[0] + m, s.U[1] - m];
  const al: UnitOpts = { tint: fr, finish: 'satin' };
  const d: PieceSpec[] = [
    cell(s, 'aluminum', [s.U[0], U[0]], s.V, s.T, al), cell(s, 'aluminum', [U[1], s.U[1]], s.V, s.T, al),
    cell(s, 'aluminum', U, [sill, sill + tr], s.T, al),
    cell(s, 'drywall', U, [s.V[1] - fsH, s.V[1]], s.T, { tint: 0x9a8f7a }),
  ];
  const lite = Math.min(0.008, T / 6);
  // spandrel
  const sp: Range = [s.V[0], sill];
  d.push(cell(s, 'tempered', U, sp, band(s, 0, lite), { tint: o.tint, finish: 'smoked' }));
  d.push(cell(s, 'insulation', U, sp, band(s, lite + 0.004, Math.max(0.012, T - lite - 0.01)), { tint: 0xd8c38a }));
  d.push(cell(s, 'metal', U, sp, band(s, T - 0.002, 0.002), { tint: 0x5c6064 }));
  // vision: outer and inner lites either side of a sealed cavity
  const vis: Range = [sill + tr, s.V[1] - fsH];
  d.push(cell(s, 'tempered', U, vis, band(s, 0, lite), { tint: o.tint }), cell(s, 'glass', U, vis, band(s, T - lite, lite), { tint: o.tint }));
  return layered('tempered', s, d, { tint: o.tint });
}

/** Profiled steel cladding sheets (1 m cover) on cold-rolled sheeting rails at 1.8 m. */
export function cladding(s: Slab, o: { tint?: number; finish?: PieceSpec['finish'] } = {}): PieceSpec {
  const T = s.T[1] - s.T[0], sh = Math.min(0.02, T / 3);
  const d: PieceSpec[] = boards(s, band(s, 0, sh), 'metal', [1.0, 12], 0.004, { tint: o.tint, finish: o.finish ?? 'satin' });
  const rt = band(s, sh, T - sh);
  for (let y = Math.ceil((s.V[0] + 0.3) / 1.8) * 1.8; y < s.V[1] - 0.2; y += 1.8) d.push(cell(s, 'steel', s.U, [y - 0.07, y + 0.07], rt, { tint: 0x8d949b, finish: 'galv' }));
  return layered('metal', s, d, { tint: o.tint, finish: o.finish ?? 'satin' });
}

/* ---------------- sloped roofs ---------------- */

type V3 = [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Detail for a pitched roof slab (a convex hull with a sloped top face): rafters at 400 centres, breathable felt,
    25 × 50 battens at the tile gauge and interlocking tiles (or slates) in rows, all square to the slope. Units that
    would poke out of the slab near its seat or ridge are left out. */
export function roofDetail(p: PieceSpec, o: { tile?: 'tile' | 'slate'; tint?: number } = {}): PieceSpec {
  if (p.shape !== 'hull' || !p.verts) return p;
  const world: V3[] = p.verts.map((v) => [v[0] + p.pos[0], v[1] + p.pos[1], v[2] + p.pos[2]]);
  const poly = hullPoly(world.flat());
  if (!poly) return p;
  let top: V3 | null = null, topD = 0, area = 0;
  for (const f of poly.faces) {
    if (f.n[1] < 0.3 || f.n[1] > 0.97) continue;
    const a = faceArea(f.pts);
    if (a > area) { area = a; top = [...f.n] as V3; topD = f.d; }
  }
  if (!top) return p;
  const e = norm(cross([0, 1, 0], top)), dn = norm(cross(top, e));   // along the ridge, and down the slope
  const pe = world.map((w) => dot(w, e)), ps = world.map((w) => dot(w, dn));
  const E: Range = [Math.min(...pe), Math.max(...pe)], S: Range = [Math.min(...ps), Math.max(...ps)];
  const at = (a: number, b: number, c: number): V3 => [e[0] * a + dn[0] * b + top![0] * c, e[1] * a + dn[1] * b + top![1] * c, e[2] * a + dn[2] * b + top![2] * c];
  const out: PieceSpec[] = [];
  const inside = (a: Range, bb: number, c: Range): boolean => {
    for (const x of a) for (const z of c) if (!contains(poly, at(x, bb, z), 0.0005)) return false;
    return true;
  };
  const unit = (mat: MaterialId, a: Range, b: Range, c: Range, uo: UnitOpts = {}, shrink = false): void => {
    if (shrink) {
      b = [b[0], b[1]];
      while (b[1] - b[0] > 0.3 && !inside(a, b[0], c)) b[0] += 0.02;
      while (b[1] - b[0] > 0.3 && !inside(a, b[1], c)) b[1] -= 0.02;
    }
    const corners: V3[] = [];
    for (const x of a) for (const y of b) for (const z of c) corners.push(at(x, y, z));
    for (const q of corners) if (!contains(poly, q, 0.0005)) return;
    const mid = at((a[0] + a[1]) / 2, (b[0] + b[1]) / 2, (c[0] + c[1]) / 2).map(snap) as V3;
    const verts = corners.map((q) => [snap(q[0] - mid[0]), snap(q[1] - mid[1]), snap(q[2] - mid[2])] as Vec3);
    const lo = [0, 1, 2].map((k) => Math.min(...verts.map((v) => v[k]))), hi = [0, 1, 2].map((k) => Math.max(...verts.map((v) => v[k])));
    const s: PieceSpec = { mat, shape: 'hull', verts, size: [snap(hi[0] - lo[0]), snap(hi[1] - lo[1]), snap(hi[2] - lo[2])], pos: mid };
    if (uo.tint !== undefined) s.tint = uo.tint;
    if (uo.density !== undefined) s.density = uo.density;
    out.push(s);
  };
  const slate = o.tile === 'slate';
  const tt = slate ? 0.012 : 0.016, bt = 0.025, felt = 0.002, gauge = slate ? 0.25 : 0.34, cover = slate ? 0.3 : 0.3;
  const c0 = topD, cTile: Range = [c0 - tt - 0.001, c0 - 0.001], cBat: Range = [cTile[0] - bt, cTile[0]], cFelt: Range = [cBat[0] - felt, cBat[0]];
  const cRaf: Range = [cFelt[0] - 0.15, cFelt[0] - 0.001];
  for (let a = Math.ceil(E[0] / 0.4) * 0.4; a < E[1]; a += 0.4) unit('wood', [a - 0.024, a + 0.024], [S[0] + 0.02, S[1] - 0.02], cRaf, {}, true);
  // the rafters are what fits; everything above them is laid in strips so they stay inside the slab too
  for (let b = Math.ceil(S[0] / 1.2) * 1.2 - 1.2; b < S[1]; b += 1.2) {
    for (let a = Math.floor(E[0] / 2.4) * 2.4; a < E[1]; a += 2.4) unit('pvc', [Math.max(a, E[0]) + 0.001, Math.min(a + 2.4, E[1]) - 0.001], [Math.max(b, S[0]) + 0.001, Math.min(b + 1.2, S[1]) - 0.001], cFelt, { tint: 0x3a3d42 }, true);
  }
  let row = 0;
  for (let b = Math.ceil(S[0] / gauge) * gauge; b < S[1]; b += gauge, row++) {
    for (let a = Math.floor(E[0] / 3.6) * 3.6; a < E[1]; a += 3.6) unit('wood', [Math.max(a, E[0]) + 0.002, Math.min(a + 3.6, E[1]) - 0.002], [b - 0.05, b], cBat, { tint: 0xb89b72 });
    const off = (row & 1) * cover / 2;
    for (let a = Math.floor((E[0] - off) / cover) * cover + off; a < E[1]; a += cover) {
      unit('roof', [a + 0.002, a + cover - 0.002], [b - gauge + 0.004, b], cTile, { tint: o.tint ?? p.tint });
    }
  }
  return withDetail({ ...p }, out);
}

function faceArea(q: number[]): number {
  let ax = 0, ay = 0, az = 0;
  for (let i = 1; i + 1 < q.length / 3; i++) {
    const ux = q[i * 3] - q[0], uy = q[i * 3 + 1] - q[1], uz = q[i * 3 + 2] - q[2];
    const wx = q[i * 3 + 3] - q[0], wy = q[i * 3 + 4] - q[1], wz = q[i * 3 + 5] - q[2];
    ax += uy * wz - uz * wy; ay += uz * wx - ux * wz; az += ux * wy - uy * wx;
  }
  return Math.hypot(ax, ay, az) / 2;
}

/* ---------------- retrofit ---------------- */

export interface LayerRules {
  /** brick walls ≥ 0.28 m thick: 'cavity' (modern) or 'solid' (Flemish) */
  brick?: 'cavity' | 'solid' | 'english';
  /** plaster walls ≥ 0.15 m are rendered blockwork */
  render?: boolean;
  lining?: boolean;
  partitions?: boolean;
  /** 'rc' slabs get screed and a finish */
  floors?: 'tile' | 'vinyl' | false;
  /** plywood decks become joisted timber floors */
  timber?: boolean;
  roofs?: 'tile' | 'slate' | false;
  curtain?: boolean;
  cladding?: boolean;
  stone?: boolean;
  /** skip members whose detail would exceed this many units */
  maxUnits?: number;
}

/** Give a builder's coarse wall, floor and roof members their layered detail in place: the members (and so their
    welds, calibration and openings — wallRun already leaves the openings and lintels) are unchanged, only their
    mass becomes that of what they are made of. Run on the builder's pieces before place(). */
export function layerize(ps: PieceSpec[], r: LayerRules): PieceSpec[] {
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const p of ps) { lo[0] = Math.min(lo[0], p.pos[0]); hi[0] = Math.max(hi[0], p.pos[0]); lo[1] = Math.min(lo[1], p.pos[2]); hi[1] = Math.max(hi[1], p.pos[2]); }
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[1] + hi[1]) / 2;
  const max = r.maxUnits ?? 4000;
  return ps.map((p) => {
    /* these buildings have real rooms behind their windows: untinted 'smoked' is clear glass without the
       parallax fake-office interior, which would paint over the real one */
    if ((p.mat === 'glass' || p.mat === 'tempered') && !p.finish && !p.tint) return { ...p, finish: 'smoked' };
    if (p.detail || p.parts || p.section || p.util || p.fixture || p.mech || p.noWeld || p.rotY) return p;
    if (p.shape === 'hull' && p.mat === 'roof' && r.roofs) return cap(roofDetail(p, { tile: r.roofs }), p, max);
    if (p.shape && p.shape !== 'box') return p;
    const [sx, sy, sz] = p.size;
    const rng = (k: number): Range => [p.pos[k] - p.size[k] / 2, p.pos[k] + p.size[k] / 2];
    const horiz = sy <= 0.4 && Math.min(sx, sz) >= 0.9;
    if (horiz) {
      const s = floorSlab(rng(0), rng(2), rng(1));
      if (sz > sx) { s.u = 2; s.v = 0; s.U = rng(2); s.V = rng(0); }
      if (p.mat === 'rconcrete' && r.floors && sy >= 0.1) return cap(merge(p, rcSlab(s, { tint: p.tint, finish: r.floors })), p, max);
      if (p.mat === 'plywood' && r.timber && sy >= 0.15) return cap(merge(p, timberFloor(s, { tint: p.tint })), p, max);
      return p;
    }
    const alongX = sx >= sz, t = Math.min(sx, sz), len = Math.max(sx, sz);
    if (t > 0.62 || sy < 0.25 || len < 0.3) return p;
    const axis: 'x' | 'z' = alongX ? 'x' : 'z';
    const tk = alongX ? 2 : 0, c = tk === 2 ? cz : cx;
    const out: 1 | -1 = p.pos[tk] >= c ? 1 : -1;
    const s = wallSlab(axis, rng(alongX ? 0 : 2), rng(1), rng(tk), out);
    let q: PieceSpec | null = null;
    switch (p.mat) {
      case 'brick':
        if (t >= 0.28 && r.brick === 'cavity') q = cavityWall(s, { brickTint: p.tint });
        else if (t >= 0.18) q = solidBrickWall(s, { tint: p.tint, bond: r.brick === 'english' ? 'english' : 'flemish' });
        else if (t >= 0.09) q = brickLeaf(s, { tint: p.tint });
        break;
      case 'cinderblock': if (t >= 0.09) q = blockWall(s, { tint: p.tint }); break;
      case 'stone': case 'sandstone': if (r.stone && t >= 0.15) q = stoneWall(s, { mat: p.mat, tint: p.tint }); break;
      case 'plaster':
        if (t >= 0.15 && r.render) q = blockWall(s, { render: p.tint ?? 0xf1e6cf, plaster: 0xf4f1ea });
        else if (t <= 0.1 && r.lining && sy >= 1) q = drylining(s, p.tint);
        break;
      case 'drywall': if (r.partitions && t >= 0.07 && t <= 0.16 && sy >= 1.5) q = studPartition(s, { tint: p.tint }); break;
      case 'tempered': case 'glass': if (r.curtain && t <= 0.08 && sy >= 2 && len >= 0.8) q = curtainBay(s, { tint: p.tint }); break;
      case 'metal': if (r.cladding && t <= 0.12 && sy >= 1) q = cladding(s, { tint: p.tint, finish: p.finish }); break;
      default: break;
    }
    return q ? cap(merge(p, q), p, max) : p;
  });
}

/* dry lining standing in for a coarse lining sheet: dabs, plasterboard, skim (the rest of the sheet is air) */
function drylining(s: Slab, tint?: number): PieceSpec {
  const T = s.T[1] - s.T[0], d = finishes(s, Math.max(0, T - 0.0255), 'dry', tint, 0);
  return layered('plaster', s, d, { tint });
}

/* keep the original member's identity (group, flags, finish, tint); take the layered detail and mass */
function merge(p: PieceSpec, q: PieceSpec): PieceSpec {
  if (!q.detail) return p;
  return { ...p, detail: q.detail, density: q.density };
}

function cap(q: PieceSpec, p: PieceSpec, max: number): PieceSpec {
  return q.detail && q.detail.length <= max ? q : p;
}

/** After a member is cut into smaller boxes (a service sleeve, a split), each keeps only the units inside it. */
export function trimDetail(q: PieceSpec): PieceSpec {
  if (!q.detail) return q;
  const lo = q.pos.map((v, i) => v - q.size[i] / 2 - 0.002), hi = q.pos.map((v, i) => v + q.size[i] / 2 + 0.002);
  const kept = q.detail.filter((c) => {
    for (let k = 0; k < 3; k++) {
      let a = c.pos[k] - c.size[k] / 2, b = c.pos[k] + c.size[k] / 2;
      if (c.shape === 'hull' && c.verts) { a = c.pos[k] + Math.min(...c.verts.map((v) => v[k])); b = c.pos[k] + Math.max(...c.verts.map((v) => v[k])); }
      if (a < lo[k] || b > hi[k]) return false;
    }
    return true;
  });
  const out: PieceSpec = { ...q };
  delete out.detail;
  delete out.density;
  return kept.length ? withDetail(out, kept) : out;
}

/** units in a blueprint's dormant detail */
export function detailCount(ps: PieceSpec[]): number {
  let n = 0;
  for (const p of ps) n += p.detail?.length ?? 0;
  return n;
}
