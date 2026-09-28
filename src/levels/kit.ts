import { quickhull3 } from 'math/geometry';
import type { AgeSpec, FixtureKind, JointSpec, MaterialId, PieceSpec, UtilityKind, Vec3 } from '../types.ts';
import { sectionParts, sectionFrame, mirrorParts, mirrorSection, type PartSpec } from '../destruction/compound.ts';

export type Range = [number, number];

export interface PieceOpts {
  tint?: number;
  group?: string;
  protected?: boolean;
  noWeld?: boolean;
  anchored?: boolean;
  util?: UtilityKind;
  fixture?: FixtureKind;
  finish?: PieceSpec['finish'];
  /** connection override (bolted, glued, riveted…) for joints this piece makes */
  joint?: JointSpec;
  /** service life and exposure: corrosion, carbonation, weathered mortar (also given to the member's detail) */
  age?: AgeSpec;
}

/* The core's weld test needs >= 0.05 m of face overlap on both tangent axes, so a 0.04 m pane
   would never weld into its opening; 0.06 keeps windows attached until something hits them. */
export const GLASS_T = 0.06;
const QUARTER = Math.PI / 2;

// micron grid removes float drift from chained arithmetic; + 0 folds -0 so JSON stays stable
const snap = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

function withOpts(p: PieceSpec, o: PieceOpts): PieceSpec {
  if (o.tint !== undefined) p.tint = o.tint;
  if (o.group !== undefined) p.group = o.group;
  if (o.protected) p.protected = true;
  if (o.noWeld) p.noWeld = true;
  if (o.anchored) p.anchored = true;
  if (o.util) p.util = o.util;
  if (o.fixture) p.fixture = o.fixture;
  if (o.finish) p.finish = o.finish;
  if (o.joint) p.joint = o.joint;
  if (o.age && !p.age) {
    p.age = o.age;
    if (p.detail) for (const d of p.detail) d.age ??= o.age;
  }
  return p;
}

export function box(mat: MaterialId, size: Vec3, pos: Vec3, o: PieceOpts = {}): PieceSpec {
  return withOpts({ mat, size: size.map(snap) as Vec3, pos: pos.map(snap) as Vec3 }, o);
}

/** Axis-aligned box from world ranges — the safest way to make faces meet exactly. */
export function block(mat: MaterialId, x: Range, y: Range, z: Range, o: PieceOpts = {}): PieceSpec {
  return box(mat, [x[1] - x[0], y[1] - y[0], z[1] - z[0]], [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2], o);
}

/** Upright cylinder standing on y[0]. */
export function cyl(mat: MaterialId, d: number, y: Range, x: number, z: number, o: PieceOpts = {}): PieceSpec {
  const p = box(mat, [d, y[1] - y[0], d], [x, (y[0] + y[1]) / 2, z], o);
  p.shape = 'cylinder';
  return p;
}

/** Capped, destructible service pipe, split into weldable lengths. Horizontal runs use
 * an eight-sided hull because cylinders in the physics/render pipeline only stand on Y.
 * `centre` supplies the two fixed coordinates; `span` replaces the coordinate on `axis`.
 * End caps meet face-to-face, so a severed length can fall independently. */
export function pipeRun(mat: 'copper' | 'steel' | 'castiron' | 'metal' | 'pvc', axis: 'x' | 'y' | 'z', span: Range,
  centre: Vec3, diameter: number, o: PieceOpts = {}, maxL = 4.5): PieceSpec[] {
  const r = diameter / 2;
  return splitRange(span[0], span[1], maxL).map(([a, b]) => {
    if (axis === 'y') return cyl(mat, diameter, [a, b], centre[0], centre[2], o);
    const pts: Vec3[] = [];
    for (const end of [a, b]) for (let i = 0; i < 8; i++) {
      const u = r * Math.cos(i * Math.PI / 4), v = r * Math.sin(i * Math.PI / 4);
      pts.push(axis === 'x' ? [end, centre[1] + u, centre[2] + v] : [centre[0] + u, centre[1] + v, end]);
    }
    return hull(mat, pts, o);
  });
}

/** Split [a, b] into equal parts no wider than maxW. */
export function splitRange(a: number, b: number, maxW: number): Range[] {
  const n = Math.max(1, Math.ceil((b - a) / maxW - 1e-9));
  const w = (b - a) / n;
  return Array.from({ length: n }, (_, i) => [a + i * w, i === n - 1 ? b : a + (i + 1) * w] as Range);
}

/** A block cut into a grid so no piece exceeds the given per-axis maximum. */
export function grid(mat: MaterialId, x: Range, y: Range, z: Range, max: { x?: number; y?: number; z?: number }, o: PieceOpts = {}): PieceSpec[] {
  const out: PieceSpec[] = [];
  for (const xr of splitRange(x[0], x[1], max.x ?? Infinity)) {
    for (const yr of splitRange(y[0], y[1], max.y ?? Infinity)) {
      for (const zr of splitRange(z[0], z[1], max.z ?? Infinity)) out.push(block(mat, xr, yr, zr, o));
    }
  }
  return out;
}

/** Panels between explicit seam lines, e.g. slabs whose joints must land on beams. */
export function panels(mat: MaterialId, xs: number[], y: Range, zs: number[], o: PieceOpts = {}): PieceSpec[] {
  const out: PieceSpec[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) out.push(block(mat, [xs[i], xs[i + 1]], y, [zs[j], zs[j + 1]], o));
  }
  return out;
}

/** Envelope finishes a building gets unless a piece names its own: plain grey sheet (roof sheets, flashings) galvanised,
    other sheet steel (cladding, doors, fascias) powder-coated satin, aluminium framing satin. Services keep theirs. */
export function envelopeFinish(ps: PieceSpec[]): PieceSpec[] {
  for (const q of ps) {
    if (q.finish || q.util || q.fixture) continue;
    if (q.mat === 'metal') {
      if (q.tint === undefined || q.tint === 0x8d949b) { q.finish = 'galv'; delete q.tint; } else q.finish = 'satin';
    } else if (q.mat === 'aluminum') q.finish = 'satin';
  }
  return ps;
}

export function tag(ps: PieceSpec[], o: PieceOpts): PieceSpec[] {
  return ps.map((p) => withOpts(p, o));
}

function normYaw(p: PieceSpec): PieceSpec {
  if (p.rotY === undefined || (p.shape && p.shape !== 'box' && p.shape !== 'cylinder')) return p;
  const k = p.rotY / QUARTER;
  const q = Math.round(k);
  if (Math.abs(k - q) > 1e-6) return p;
  if (q % 2 !== 0 && p.shape !== 'cylinder') p.size = [p.size[2], p.size[1], p.size[0]];
  delete p.rotY;
  return p;
}

/* Quarter turns are baked into hull verts (and x/z swapped), so hulls stay rotY-free with an exact size box. */
function turnHull(p: PieceSpec, q: number): PieceSpec {
  const c = [1, 0, -1, 0][q], s = [0, 1, 0, -1][q];
  const verts = (p.verts ?? []).map((v) => [snap(v[0] * c + v[2] * s), v[1], snap(-v[0] * s + v[2] * c)] as Vec3);
  return { ...p, verts, size: q % 2 === 1 ? [p.size[2], p.size[1], p.size[0]] : [...p.size] };
}

/* Compounds (explicit parts or an expanded section) are turned part by part, so they stay rotY-free like boxes;
   the section frame is made explicit because its tie-broken default would not turn with it. */
function turnParts(p: PieceSpec, q: number): PieceSpec {
  const c = [1, 0, -1, 0][q], s = [0, 1, 0, -1][q], odd = q % 2 === 1;
  const t = (v: Vec3): Vec3 => [snap(v[0] * c + v[2] * s), v[1], snap(-v[0] * s + v[2] * c)];
  const sw = (v: Vec3): Vec3 => (odd ? [v[2], v[1], v[0]] : [...v]);
  const parts = (p.parts?.length ? p.parts : sectionParts(p) ?? []).map((r): PartSpec => {
    const out: PartSpec = { ...r, pos: t(r.pos) };
    if (r.shape === 'hull') { out.verts = (r.verts ?? []).map(t); out.size = sw(r.size); }
    else if (r.shape === 'wedge' || r.shape === 'prism' || r.rotY !== undefined) out.rotY = (r.rotY ?? 0) + q * QUARTER;
    else if (r.shape !== 'cylinder') out.size = sw(r.size);
    return out;
  });
  const out: PieceSpec = { ...p, size: sw(p.size), parts };
  if (p.section) {
    const f = sectionFrame(p), ax = (k: 0 | 1 | 2): 0 | 1 | 2 => (odd && k !== 1 ? (2 - k) as 0 | 2 : k);
    out.section = { ...p.section, axis: ax(f.axis), depth: ax(f.depth) };
  }
  delete out.rotY;
  return out;
}

/** Rotate by quarter turns about the origin (three.js yaw convention), then translate. Keeps boxes axis-aligned.
    Rope anchors, machinery joint frames (`mech.at` / `mech.axis`) and dormant `detail` move with the piece. */
export function place(ps: PieceSpec[], x: number, z: number, quarter = 0): PieceSpec[] {
  const out = placeFlat(ps, x, z, quarter);
  ps.forEach((p, i) => { if (p.detail) out[i].detail = placeFlat(p.detail, x, z, quarter); });
  return out;
}

function placeFlat(ps: PieceSpec[], x: number, z: number, quarter: number): PieceSpec[] {
  const q = ((quarter % 4) + 4) % 4;
  const c = [1, 0, -1, 0][q], s = [0, 1, 0, -1][q];
  const turn = (v: Vec3, dx: number, dz: number): Vec3 => [snap(v[0] * c + v[2] * s + dx), v[1], snap(-v[0] * s + v[2] * c + dz)];
  return ps.map((p) => {
    const pos = turn(p.pos, x, z);
    const extra: Partial<PieceSpec> = {};
    if (p.ropeTo) extra.ropeTo = { ...p.ropeTo, end: turn(p.ropeTo.end, x, z) };
    if (p.mech) extra.mech = { ...p.mech, at: turn(p.mech.at, x, z), axis: turn(p.mech.axis, 0, 0) };
    if (p.carry) extra.carry = { from: turn(p.carry.from, x, z), to: turn(p.carry.to, x, z) };
    if (p.soft) extra.soft = softMap(p.soft, (v) => turn(v, x, z));
    if (p.shape === 'hull' && !p.rotY) return { ...turnHull(p, q), pos, ...extra };
    if (p.parts?.length || sectionParts(p)) {
      const k = (p.rotY ?? 0) / QUARTER + q, kq = Math.round(k);
      if (Math.abs(k - kq) < 1e-6) {
        const r = ((kq % 4) + 4) % 4;
        if (r) return { ...turnParts(p, r), pos, ...extra };
        const out: PieceSpec = { ...p, pos, size: [...p.size], ...extra };
        delete out.rotY;
        return out;
      }
    }
    const out: PieceSpec = { ...p, pos, size: [...p.size], ...extra };
    const free = p.shape === 'wedge' || p.shape === 'prism' || p.shape === 'hull';
    if (p.rotY !== undefined || (free && q)) out.rotY = (p.rotY ?? 0) + q * QUARTER;
    else if (q % 2 === 1 && p.shape !== 'cylinder') out.size = [p.size[2], p.size[1], p.size[0]];
    return normYaw(out);
  });
}

/** Mirror across the x = z plane: lets every builder be written once for runs along X. */
export function swapXZ(ps: PieceSpec[]): PieceSpec[] {
  const sw = (v: Vec3): Vec3 => [v[2], v[1], v[0]];
  return ps.map((p) => {
    const src = p.shape === 'wedge' ? wedgeAsHull(p) : p;
    const out: PieceSpec = { ...src, pos: sw(src.pos), size: sw(src.size) };
    if (src.ropeTo) out.ropeTo = { ...src.ropeTo, end: sw(src.ropeTo.end) };
    if (src.mech) out.mech = { ...src.mech, at: sw(src.mech.at), axis: sw(src.mech.axis) };
    if (src.carry) out.carry = { from: sw(src.carry.from), to: sw(src.carry.to) };
    if (src.soft) out.soft = softMap(src.soft, sw);
    if (src.verts) out.verts = src.verts.map(sw);
    if (src.parts) out.parts = mirrorParts(src.parts);
    if (src.section) out.section = mirrorSection(src);
    if (src.detail) out.detail = swapXZ(src.detail);
    if (src.rotY !== undefined) out.rotY = -src.rotY;
    return out;
  });
}

/* A mirrored wedge is no longer a 'wedge' (its slope would run along Z), so it becomes the equivalent hull. */
function wedgeAsHull(p: PieceSpec): PieceSpec {
  const [hx, hy, hz] = p.size.map((v) => v / 2);
  const verts: Vec3[] = [[-hx, -hy, -hz], [hx, -hy, -hz], [-hx, hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [-hx, hy, hz]];
  return { ...p, shape: 'hull', verts };
}

/* ---------------- walls ---------------- */

export interface Opening {
  /** centre along the run */
  c: number;
  w: number;
  /** bottom, relative to the wall base */
  y0: number;
  h: number;
  /** default: true for windows (y0 > 0), false for doors */
  glass?: boolean;
}

export interface WallRunOpts extends PieceOpts {
  mat: MaterialId;
  axis?: 'x' | 'z';
  from: number;
  to: number;
  /** centre of the wall thickness on the other horizontal axis */
  at: number;
  t: number;
  y0: number;
  h: number;
  /** which side is outside (+1 / -1 along the thickness axis): sills project that way, lining goes the other */
  out?: 1 | -1;
  openings?: Opening[];
  maxW?: number;
  lintel?: MaterialId;
  lintelH?: number;
  sill?: MaterialId;
  /** pane material, e.g. 'tempered' for shopfronts (default annealed 'glass') */
  glazing?: MaterialId;
  /** glazed openings at least 1 m wide get a central mullion of this material between two panes */
  mullion?: MaterialId;
  mullionTint?: number;
  lining?: { mat: MaterialId; t: number; from: number; to: number; tint?: number };
  /** chamfer this big on the outer vertical arris at both ends of the run (external corners: bullnose brick, stone) */
  arris?: number;
}

/** One storey of wall along X (or Z) with window/door openings, glass, lintels, sills and an optional interior lining. */
export function wallRun(w: WallRunOpts): PieceSpec[] {
  const { mat, at, t, y0, h } = w;
  const out = w.out ?? 1;
  const maxW = w.maxW ?? 2.4;
  const lintelH = w.lintelH ?? 0.15;
  const sillH = 0.08, sillLip = 0.05;
  const o: PieceOpts = { tint: w.tint, group: w.group, protected: w.protected };
  const v: Range = [at - t / 2, at + t / 2];
  const vSill: Range = out > 0 ? [v[0], v[1] + sillLip] : [v[0] - sillLip, v[1]];
  const ps: PieceSpec[] = [];
  // lining sheets: one per masonry column, full height of that column (sill/lintel/head merged)
  const sheets: { u: Range; y: Range }[] = [];

  const solid = (u: Range, y: Range) => {
    if (y[1] - y[0] < 1e-6 || u[1] - u[0] < 1e-6) return;
    for (const ur of splitRange(u[0], u[1], maxW)) {
      const ends = w.arris ? [ur[0] === w.from ? 0 : -1, ur[1] === w.to ? 1 : -1].filter((e) => e >= 0) : [];
      ps.push(ends.length ? cutEdges(mat, ur, [y0 + y[0], y0 + y[1]], v, ends.map((e) => [e, out > 0 ? 1 : 0] as [number, number]), w.arris!, o)
        : block(mat, ur, [y0 + y[0], y0 + y[1]], v, o));
    }
  };
  const solidWithSheet = (u: Range, y: Range) => {
    solid(u, y);
    if (y[1] - y[0] > 1e-6 && u[1] - u[0] > 1e-6) for (const ur of splitRange(u[0], u[1], maxW)) sheets.push({ u: ur, y });
  };

  let cursor = w.from;
  for (const op of [...(w.openings ?? [])].sort((a, b) => a.c - b.c)) {
    const a = op.c - op.w / 2, b = op.c + op.w / 2;
    if (a < cursor - 1e-6 || b > w.to + 1e-6) throw new Error(`wallRun: opening at ${op.c} does not fit`);
    solidWithSheet([cursor, a], [0, h]);
    cursor = b;
    const top = op.y0 + op.h;
    const spans = splitRange(a, b, maxW);
    if (op.y0 > 0) {
      const withSill = w.sill !== undefined && op.y0 >= sillH + 0.08;
      solid([a, b], [0, withSill ? op.y0 - sillH : op.y0]);
      // splayed sill: flat bed under the pane, weathered lip outside
      if (withSill) for (const ur of spans) ps.push(sillPiece(w.sill!, ur, [y0 + op.y0 - sillH, y0 + op.y0], v, out, sillLip, { ...o, tint: undefined }));
      for (const ur of spans) sheets.push({ u: ur, y: [0, op.y0] });
    }
    if (op.glass ?? op.y0 > 0) {
      const gy: Range = [y0 + op.y0, y0 + top], gz: Range = [at - GLASS_T / 2, at + GLASS_T / 2], go = { group: w.group, protected: w.protected };
      if (w.mullion && b - a >= 1 - 1e-9) {
        const c = (a + b) / 2;
        ps.push(block(w.glazing ?? 'glass', [a, c - 0.04], gy, gz, go), block(w.glazing ?? 'glass', [c + 0.04, b], gy, gz, go));
        ps.push(block(w.mullion, [c - 0.04, c + 0.04], gy, [at - 0.05, at + 0.05], { ...go, tint: w.mullionTint }));
      } else ps.push(block(w.glazing ?? 'glass', [a, b], gy, gz, go));
    }
    if (top < h - 1e-6) {
      let lt = w.lintel ? Math.min(lintelH, h - top) : 0;
      if (h - top - lt < 0.08) lt = w.lintel ? h - top : 0;
      if (lt > 0) for (const ur of spans) ps.push(block(w.lintel!, ur, [y0 + top, y0 + top + lt], v, { ...o, tint: undefined }));
      solid([a, b], [top + lt, h]);
      for (const ur of spans) sheets.push({ u: ur, y: [top, h] });
    }
  }
  solidWithSheet([cursor, w.to], [0, h]);

  if (w.lining) {
    const L = w.lining;
    const lv: Range = out > 0 ? [v[0] - L.t, v[0]] : [v[1], v[1] + L.t];
    for (const sh of sheets) {
      const u: Range = [Math.max(sh.u[0], L.from), Math.min(sh.u[1], L.to)];
      if (u[1] - u[0] >= 0.08) ps.push(block(L.mat, u, [y0 + sh.y[0], y0 + sh.y[1]], lv, { ...o, tint: L.tint }));
    }
  }
  return w.axis === 'z' ? swapXZ(ps) : ps;
}

/** Box with some of its vertical edges chamfered by r; an edge is [x side, z side] (0 = min, 1 = max). */
export function cutEdges(mat: MaterialId, x: Range, y: Range, z: Range, edges: [number, number][], r: number, o: PieceOpts = {}): PieceSpec {
  const pts: Vec3[] = [];
  for (const i of [0, 1]) for (const k of [0, 1]) for (const yy of y) {
    if (edges.some(([a, b]) => a === i && b === k)) pts.push([x[i] + (i ? -r : r), yy, z[k]], [x[i], yy, z[k] + (k ? -r : r)]);
    else pts.push([x[i], yy, z[k]]);
  }
  return hull(mat, pts, o);
}

function sillPiece(mat: MaterialId, u: Range, y: Range, v: Range, out: number, lip: number, o: PieceOpts): PieceSpec {
  const [ya, yb] = y, drop = Math.min(0.035, (yb - ya) / 2);
  const prof: [number, number][] = out > 0
    ? [[v[0], ya], [v[0], yb], [v[1], yb], [v[1] + lip, yb - drop], [v[1] + lip, ya]]
    : [[v[1], ya], [v[1], yb], [v[0], yb], [v[0] - lip, yb - drop], [v[0] - lip, ya]];
  return extrude(mat, prof, 'x', u, o);
}

/* ---------------- frames ---------------- */

export function column(mat: MaterialId, x: number, z: number, y: Range, w: number, o: PieceOpts = {}, maxH = 4): PieceSpec[] {
  return grid(mat, [x - w / 2, x + w / 2], y, [z - w / 2, z + w / 2], { y: maxH }, o);
}

/** Beam along X or Z between two coordinates, split into welded segments. */
export function beam(mat: MaterialId, axis: 'x' | 'z', span: Range, y: Range, at: number, w: number, o: PieceOpts = {}, maxL = 6): PieceSpec[] {
  const cross: Range = [at - w / 2, at + w / 2];
  return axis === 'x' ? grid(mat, span, y, cross, { x: maxL }, o) : grid(mat, cross, y, span, { z: maxL }, o);
}

/* ---------------- roofs ---------------- */

export interface GableRoofOpts extends PieceOpts {
  mat: MaterialId;
  /** extent along the ridge, overhangs included */
  x: Range;
  /** eave to eave, overhangs included */
  z: Range;
  /** underside of the first course */
  y: number;
  levels: number;
  /** how far each course laps onto the one below; narrower laps make a lighter roof (default: one step) */
  bearing?: number;
  /** total height from y to the top of the ridge course */
  rise: number;
  ridgeMat?: MaterialId;
  maxW?: number;
  axis?: 'x' | 'z';
  /** stepped gable infill between the courses, one per end-wall x-range */
  gables?: { mat: MaterialId; x: Range[]; tint?: number };
  /** timber purlins spanning between the first and last gable under this course */
  purlins?: { mat: MaterialId; level: number; size: number };
}

/* Stepped courses: course i is a pair of strips (s + b) wide stepped in by s, each lapping b onto the one
   below; the last pair meets at the centre line and a ridge course caps the join. */
export function gableRoof(r: GableRoofOpts): PieceSpec[] {
  const n = r.levels;
  const [z0, z1] = r.z;
  const half = (z1 - z0) / 2, mid = (z0 + z1) / 2;
  const b = r.bearing ?? half / (n + 1);
  const s = (half - b) / n;
  const h = r.rise / (n + 1);
  const maxW = r.maxW ?? 3.6;
  const o: PieceOpts = { tint: r.tint, group: r.group, protected: r.protected };
  const ps: PieceSpec[] = [];
  for (let i = 0; i < n; i++) {
    const y: Range = [r.y + i * h, r.y + (i + 1) * h];
    for (const xr of splitRange(r.x[0], r.x[1], maxW)) {
      ps.push(block(r.mat, xr, y, [z0 + i * s, z0 + (i + 1) * s + b], o));
      ps.push(block(r.mat, xr, y, [z1 - (i + 1) * s - b, z1 - i * s], o));
    }
    if (r.gables && i <= n - 2) {
      for (const gx of r.gables.x) ps.push(block(r.gables.mat, gx, y, [z0 + (i + 1) * s + b, z1 - (i + 1) * s - b], { ...o, tint: r.gables.tint }));
    }
  }
  for (const xr of splitRange(r.x[0], r.x[1], maxW)) {
    ps.push(block(r.ridgeMat ?? r.mat, xr, [r.y + n * h, r.y + (n + 1) * h], [mid - (s + b) / 2, mid + (s + b) / 2], o));
  }
  if (r.purlins && r.gables && r.gables.x.length >= 2) {
    const { mat, level, size } = r.purlins;
    const gx = [...r.gables.x].sort((a, b) => a[0] - b[0]);
    const span: Range = [gx[0][1], gx[gx.length - 1][0]];
    const top = r.y + (level + 1) * h;
    const ph = Math.min(size, h);
    const zl = z0 + (level + 1) * s + b, zr = z1 - (level + 1) * s - b;
    for (const xr of splitRange(span[0], span[1], 5)) {
      ps.push(block(mat, xr, [top - ph, top], [zl, zl + size], { group: r.group, protected: r.protected }));
      ps.push(block(mat, xr, [top - ph, top], [zr - size, zr], { group: r.group, protected: r.protected }));
    }
  }
  return r.axis === 'z' ? swapXZ(ps) : ps;
}

/* ---------------- round & stacked masonry ---------------- */

export interface RingCourse { h: number; r: number; t: number; mat?: MaterialId; tint?: number }

/** Polygonal ring of tangential staves (chimneys, silos, tanks). r is the mid-thickness radius. */
export function ringWall(mat: MaterialId, cx: number, cz: number, y0: number, n: number, courses: RingCourse[], o: PieceOpts = {}, twist = true): PieceSpec[] {
  const ps: PieceSpec[] = [];
  let y = y0;
  courses.forEach((c, k) => {
    // widest stave whose inner corners clear the neighbours, minus a hair so the exact check never sees contact
    const w = 2 * (c.r - c.t / 2) * Math.tan(Math.PI / n) - 0.01;
    const phase = twist && k % 2 === 1 ? Math.PI / n : 0;
    for (let i = 0; i < n; i++) {
      const phi = (2 * Math.PI * i) / n + phase;
      const p = box(c.mat ?? mat, [w, c.h, c.t], [cx + c.r * Math.cos(phi), y + c.h / 2, cz + c.r * Math.sin(phi)], { ...o, tint: c.tint ?? o.tint });
      p.rotY = snap(Math.PI / 2 - phi);
      ps.push(normYaw(p));
    }
    y += c.h;
  });
  return ps;
}

/** Square hollow stack laid in alternating courses (bonded corners); each course ring is one body of four walls. */
export function hollowStack(mat: MaterialId, cx: number, cz: number, y0: number, outer: number, wall: number, courseH: number, courses: number, o: PieceOpts = {}): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const a = outer / 2, b = outer / 2 - wall;
  for (let k = 0; k < courses; k++) {
    const y: Range = [y0 + k * courseH, y0 + (k + 1) * courseH];
    const long: Range = [-a, a], short: Range = [-b, b];
    const faces: [Range, Range][] = k % 2 === 0
      ? [[long, [b, a]], [long, [-a, -b]], [[b, a], short], [[-a, -b], short]]
      : [[[b, a], long], [[-a, -b], long], [short, [b, a]], [short, [-a, -b]]];
    ps.push(weldParts(faces.map(([x, z]) => block(mat, [cx + x[0], cx + x[1]], y, [cz + z[0], cz + z[1]], o))));
  }
  return ps;
}

export interface FlightOpts extends PieceOpts {
  mat: MaterialId;
  axis: 'x' | 'z';
  /** where the flight leaves the lower level and where its top step meets the upper level's edge */
  from: number;
  to: number;
  /** extent across the flight */
  cross: Range;
  y0: number;
  steps: number;
  rise: number;
  /** lap of each tread onto the one below (default one run) */
  lap?: number;
  /** push the first tread one run back past `from` so it sits on a landing rather than beside it */
  seat?: boolean;
}

/* Open stair or ramp built like the roof courses: tread j laps onto tread j-1, the first rests on the level
   below and the last ends flush against the upper level's edge, so the flight is carried at both ends. */
export function flight(f: FlightOpts): PieceSpec[] {
  const d = Math.sign(f.to - f.from);
  const span = Math.abs(f.to - f.from);
  const run = span / (f.seat ? f.steps - 1 : f.steps);
  const start = f.seat ? f.from - d * run : f.from;
  const lap = f.lap ?? run;
  const o: PieceOpts = { tint: f.tint, group: f.group, protected: f.protected };
  const ps: PieceSpec[] = [];
  for (let j = 0; j < f.steps; j++) {
    const a = j * run, b = Math.min(j * run + run + lap, run * f.steps);
    const u: Range = d > 0 ? [start + a, start + b] : [start - b, start - a];
    const y: Range = [f.y0 + j * f.rise, f.y0 + (j + 1) * f.rise];
    ps.push(f.axis === 'x' ? block(f.mat, u, y, f.cross, o) : block(f.mat, f.cross, y, u, o));
  }
  return ps;
}

export function raise(ps: PieceSpec[], dy: number): PieceSpec[] {
  const up = (v: Vec3): Vec3 => [v[0], snap(v[1] + dy), v[2]];
  return ps.map((p) => {
    const out: PieceSpec = { ...p, pos: up(p.pos) };
    if (p.ropeTo) out.ropeTo = { ...p.ropeTo, end: up(p.ropeTo.end) };
    if (p.mech) out.mech = { ...p.mech, at: up(p.mech.at) };
    if (p.carry) out.carry = { from: up(p.carry.from), to: up(p.carry.to) };
    if (p.soft) out.soft = softMap(p.soft, up);
    if (p.detail) out.detail = raise(p.detail, dy);
    return out;
  });
}

/** Solid stepped flight rising along +X from x0: each step is a block from y0 to its tread. */
export function stairs(mat: MaterialId, x0: number, z: Range, y0: number, steps: number, rise: number, run: number, o: PieceOpts = {}): PieceSpec[] {
  return Array.from({ length: steps }, (_, i) => block(mat, [x0 + i * run, x0 + (i + 1) * run], [y0, y0 + (i + 1) * rise], z, o));
}

/* ---------------- non-box shapes ---------------- */

/** Convex hull from world points, centred on its bounding box so `pos ± size/2` is its true AABB. */
export function hull(mat: MaterialId, pts: Vec3[], o: PieceOpts = {}): PieceSpec {
  const min = [0, 1, 2].map((k) => Math.min(...pts.map((q) => q[k])));
  const max = [0, 1, 2].map((k) => Math.max(...pts.map((q) => q[k])));
  const c = min.map((v, k) => snap((v + max[k]) / 2)) as Vec3;
  const verts = pts.map((q) => [snap(q[0] - c[0]), snap(q[1] - c[1]), snap(q[2] - c[2])] as Vec3);
  return withOpts({ mat, shape: 'hull', size: max.map((v, k) => snap(v - min[k])) as Vec3, pos: c, verts }, o);
}

/** One rigid, non-convex member from convex pieces of one material that meet face to face (an L-wall, a built-up
    girder, a machine casting): it takes the first piece's options, and `extra` can add e.g. a `section` for its
    real mass and capacity. Pieces must be yaw-free. */
export function weldParts(ps: PieceSpec[], extra: Partial<PieceSpec> = {}): PieceSpec {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const q of ps) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], q.pos[k] - q.size[k] / 2);
    hi[k] = Math.max(hi[k], q.pos[k] + q.size[k] / 2);
  }
  const c = lo.map((v, k) => snap((v + hi[k]) / 2)) as Vec3;
  const parts = ps.map((q): PartSpec => {
    const part: PartSpec = { size: [...q.size], pos: [snap(q.pos[0] - c[0]), snap(q.pos[1] - c[1]), snap(q.pos[2] - c[2])] };
    if (q.shape && q.shape !== 'box') part.shape = q.shape;
    if (q.sides !== undefined) part.sides = q.sides;
    if (q.verts) part.verts = q.verts.map((v) => [...v] as Vec3);
    return part;
  });
  const { shape: _s, sides: _n, verts: _v, rotY: _r, ...base } = ps[0];
  return { ...base, size: hi.map((v, k) => snap(v - lo[k])) as Vec3, pos: c, parts, ...extra };
}

/** Convex 2D profile [u, y] extruded along X (u = z) or along Z (u = x) over `range`. */
export function extrude(mat: MaterialId, profile: [number, number][], axis: 'x' | 'z', range: Range, o: PieceOpts = {}): PieceSpec {
  const pts: Vec3[] = [];
  for (const [u, y] of profile) for (const a of range) pts.push(axis === 'x' ? [a, y, u] : [u, y, a]);
  return hull(mat, pts, o);
}

/** Upright regular n-gon prism standing on y[0]; turned half a side so flats face ±X/±Z and the AABB is the across-flats. */
export function prism(mat: MaterialId, across: number, y: Range, x: number, z: number, sides = 8, o: PieceOpts = {}): PieceSpec {
  const p = box(mat, [across, y[1] - y[0], across], [x, (y[0] + y[1]) / 2, z], o);
  p.shape = 'prism';
  p.sides = sides;
  if (sides % 4 === 0) p.rotY = snap(Math.PI / sides);
  return p;
}

/** Right-triangle wedge (full height on the `high` side, zero at the opposite edge) filling the given world box. */
export function wedge(mat: MaterialId, x: Range, y: Range, z: Range, high: '-x' | '+x' | '-z' | '+z', o: PieceOpts = {}): PieceSpec {
  const alongX = high === '-x' || high === '+x';
  const size: Vec3 = alongX ? [x[1] - x[0], y[1] - y[0], z[1] - z[0]] : [z[1] - z[0], y[1] - y[0], x[1] - x[0]];
  const p = box(mat, size, [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2], o);
  p.shape = 'wedge';
  // local -X is the tall side; yaw maps local +X to world (cos, -sin)
  const yaw = { '-x': 0, '+x': Math.PI, '+z': Math.PI / 2, '-z': -Math.PI / 2 }[high];
  if (yaw) p.rotY = snap(yaw);
  return p;
}

/** One course of an n-sided ring (chimney, tank, dome, spire) as annular-sector hulls; radii are to the polygon corners.
    Inner/outer radii may differ bottom to top, so courses taper; adjacent sectors share exact radial faces. */
export function ringCourse(mat: MaterialId, cx: number, cz: number, y: Range, inner: Range, outer: Range, n: number, o: PieceOpts = {}, phase = 0): PieceSpec[] {
  const ps: PieceSpec[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = phase + (2 * Math.PI * i) / n, a1 = a0 + (2 * Math.PI) / n;
    const pts: Vec3[] = [];
    for (const [yy, ri, ro] of [[y[0], inner[0], outer[0]], [y[1], inner[1], outer[1]]]) {
      for (const a of [a0, a1]) for (const r of ri > 1e-6 ? [ri, ro] : [ro]) pts.push([cx + r * Math.cos(a), yy, cz + r * Math.sin(a)]);
      if (ri <= 1e-6) pts.push([cx, yy, cz]);
    }
    ps.push(hull(mat, pts, o));
  }
  return ps;
}

/** Exact volume of a convex hull (envelopeVolume only bounds it from above), so shaped bodies weigh what they should. */
export function hullVolume(verts: Vec3[]): number {
  const p = verts.flat(), t = quickhull3(p);
  let v = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return Math.abs(v) / 6;
}

/** Hull through cross-sections across X: each station is [x, half-profile of (z >= 0, y) points], mirrored to -z.
    Bodywork panels, bonnets, cabs and tapered booms; stations that share a profile at a common x weld face to face. */
export function loft(mat: MaterialId, stations: [number, [number, number][]][], o: PieceOpts = {}): PieceSpec {
  const pts: Vec3[] = [];
  for (const [x, prof] of stations) for (const [z, y] of prof) { pts.push([x, y, z]); if (z > 1e-9) pts.push([x, y, -z]); }
  return hull(mat, pts, o);
}

/** Box with its edges chamfered by r: all twelve, only the four vertical ones ('vert'), or only the four top ones ('top').
    The flat faces keep their planes, so it still beds and welds like the box it replaces. */
export function chamfer(mat: MaterialId, x: Range, y: Range, z: Range, r: number, o: PieceOpts = {}, edges: 'all' | 'vert' | 'top' = 'all'): PieceSpec {
  const pts: Vec3[] = [];
  for (const [xc, sx] of [[x[0], 1], [x[1], -1]]) for (const [yc, sy] of [[y[0], 1], [y[1], -1]]) for (const [zc, sz] of [[z[0], 1], [z[1], -1]]) {
    if (edges === 'all') pts.push([xc + sx * r, yc, zc], [xc, yc + sy * r, zc], [xc, yc, zc + sz * r]);
    else if (edges === 'vert') pts.push([xc + sx * r, yc, zc], [xc, yc, zc + sz * r]);
    else if (sy < 0) pts.push([xc + sx * r, yc, zc + sz * r], [xc, yc - r, zc]);
    else pts.push([xc, yc, zc]);
  }
  return hull(mat, pts, o);
}

/** Horizontal tank or drum along X with dished ends: one hull, n-gon shell of radius r, heads bulging `dish` beyond x. */
export function tankX(mat: MaterialId, x: Range, cy: number, cz: number, r: number, dish = r * 0.3, o: PieceOpts = {}, n = 12): PieceSpec {
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / n, u = Math.cos(a), v = Math.sin(a);
    for (const xe of [x[0] + dish, x[1] - dish]) pts.push([xe, cy + r * v, cz + r * u]);
    for (const xe of x) pts.push([xe, cy + 0.6 * r * v, cz + 0.6 * r * u]);
  }
  return hull(mat, pts, o);
}

/** Upright vessel with a dished head: n-gon shell from y[0] to y[1], the head rising `dish` above it; flat base to stand on. */
export function vessel(mat: MaterialId, d: number, y: Range, x: number, z: number, dish = d * 0.18, o: PieceOpts = {}, n = 12): PieceSpec {
  const pts: Vec3[] = [], r = d / 2;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / n, u = Math.cos(a), v = Math.sin(a);
    for (const [yy, k] of [[y[0], 1], [y[1], 1], [y[1] + dish * 0.65, 0.75], [y[1] + dish, 0.4]]) pts.push([x + k * r * u, yy, z + k * r * v]);
  }
  return hull(mat, pts, o);
}

/** Round bar between two points (hydraulic rams, rods, handrails), an n-gon section square to its axis. */
export function rod(mat: MaterialId, a: Vec3, b: Vec3, d: number, o: PieceOpts = {}, n = 8): PieceSpec {
  const ax: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(...ax), t: Vec3 = [ax[0] / l, ax[1] / l, ax[2] / l];
  const ref: Vec3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u0: Vec3 = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
  const ul = Math.hypot(...u0), u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v: Vec3 = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
  const pts: Vec3[] = [];
  for (const q of [a, b]) for (let i = 0; i < n; i++) {
    const c = (d / 2) * Math.cos((2 * Math.PI * (i + 0.5)) / n), s = (d / 2) * Math.sin((2 * Math.PI * (i + 0.5)) / n);
    pts.push([q[0] + c * u[0] + s * v[0], q[1] + c * u[1] + s * v[1], q[2] + c * u[2] + s * v[2]]);
  }
  return hull(mat, pts, o);
}

/** Straight square-section member between two points: steep members get level end caps (so they stack and bed),
    shallow ones get upright caps. */
export function strut(mat: MaterialId, a: Vec3, b: Vec3, w: number, o: PieceOpts = {}): PieceSpec {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const h = w / 2, l = Math.hypot(d[0], d[1], d[2]), hl = Math.hypot(d[0], d[2]);
  const steep = Math.abs(d[1]) > 0.7 * l || hl < 1e-6;
  const u: Vec3 = steep ? [h, 0, 0] : [(-d[2] / hl) * h, 0, (d[0] / hl) * h];
  const v: Vec3 = steep ? [0, 0, h] : [0, h, 0];
  const pts: Vec3[] = [];
  for (const q of [a, b]) for (const su of [-1, 1]) for (const sv of [-1, 1]) pts.push([q[0] + su * u[0] + sv * v[0], q[1] + su * u[1] + sv * v[1], q[2] + su * u[2] + sv * v[2]]);
  return hull(mat, pts, o);
}

export interface PitchedRoofOpts extends PieceOpts {
  mat: MaterialId;
  /** along the ridge, gable overhangs included */
  x: Range;
  /** outer faces of the two eave walls */
  z: Range;
  /** wall-top (seat) height */
  y: number;
  /** underside rise from the seat to the ridge */
  rise: number;
  /** vertical thickness of each slope */
  thick: number;
  /** width of the flat bearing on each eave wall top */
  seat?: number;
  maxW?: number;
  ridgeMat?: MaterialId;
  ridgeTint?: number;
  gables?: { mat: MaterialId; x: Range[]; tint?: number };
  /** bargeboards on the verges (both ends, or only the low / high x end), fixed to the slab ends */
  barge?: { mat?: MaterialId; tint?: number; ends?: 'lo' | 'hi' };
  axis?: 'x' | 'z';
}

/* Two sloped slabs per bay: each sits flat on its eave wall through a seat at its foot, leans on its partner
   along the ridge and on the gable triangles beneath (flush sloped contact); a flat strip at the top of each
   carries a ridge cap. Every profile is convex, so each slab is a single hull. */
export function pitchedRoof(r: PitchedRoofOpts): PieceSpec[] {
  const [z0, z1] = r.z;
  const mid = (z0 + z1) / 2, half = (z1 - z0) / 2;
  const seat = r.seat ?? 0.2, c = 0.12, cap = 0.14;
  const k = r.rise / (half - seat);
  const under = (dz: number) => r.y + k * (half - seat - dz);
  const ridgeTop = under(c) + r.thick;
  if (r.thick - k * seat < 0.08) throw new Error('pitchedRoof: slab too thin at the eave for this pitch and seat');
  const o: PieceOpts = { tint: r.tint, group: r.group, protected: r.protected };
  // profile of the +Z slope in (distance from ridge line, y)
  const profile: [number, number][] = [
    [half, r.y], [half - seat, r.y], [0, under(0)], [0, ridgeTop], [c, ridgeTop], [half, r.y + r.thick - k * seat],
  ];
  const ps: PieceSpec[] = [];
  for (const xr of splitRange(r.x[0], r.x[1], r.maxW ?? 3.6)) {
    for (const s of [1, -1]) ps.push(extrude(r.mat, profile.map(([d, y]) => [mid + s * d, y] as [number, number]), 'x', xr, o));
    // half-round ridge tile
    ps.push(extrude(r.ridgeMat ?? r.mat, [[mid - c, ridgeTop], [mid + c, ridgeTop], [mid + 0.9 * c, ridgeTop + 0.45 * cap], [mid + 0.55 * c, ridgeTop + 0.85 * cap],
      [mid, ridgeTop + cap], [mid - 0.55 * c, ridgeTop + 0.85 * cap], [mid - 0.9 * c, ridgeTop + 0.45 * cap]], 'x', xr, { ...o, tint: r.ridgeTint ?? r.tint }));
  }
  if (r.barge) {
    const eaveTop = r.y + r.thick - k * seat, bd = r.thick + 0.12;
    const ends: Range[] = [[r.x[0] - 0.06, r.x[0]], [r.x[1], r.x[1] + 0.06]];
    for (const [xa, xb] of r.barge.ends === 'lo' ? [ends[0]] : r.barge.ends === 'hi' ? [ends[1]] : ends) for (const s of [1, -1]) {
      ps.push(extrude(r.barge.mat ?? 'wood', ([[0, ridgeTop], [c, ridgeTop], [half, eaveTop], [half, eaveTop - bd], [0, ridgeTop - bd]] as [number, number][])
        .map(([d, y]) => [mid + s * d, y] as [number, number]), 'x', [xa, xb], { group: r.group, protected: r.protected, tint: r.barge.tint ?? 0xf1ece2 }));
    }
  }
  // gable triangles, halved on the ridge line so each half is a right-angled slab under one roof slope
  for (const gx of r.gables?.x ?? []) {
    for (const e of [z0 + seat, z1 - seat]) ps.push(extrude(r.gables!.mat, [[e, r.y], [mid, r.y], [mid, under(0)]], 'x', gx, { ...o, tint: r.gables!.tint }));
  }
  return r.axis === 'z' ? swapXZ(ps) : ps;
}

export interface SpiralOpts extends PieceOpts {
  mat: MaterialId;
  cx: number;
  cz: number;
  y0: number;
  steps: number;
  rise: number;
  /** radius of the post's corners and of the tread tips */
  rIn: number;
  rOut: number;
  /** turn per step and angular width of each tread (width > turn so treads lap and bear on each other) */
  turn: number;
  width: number;
  start?: number;
  post?: MaterialId;
}

/** Spiral stair: sector treads round an n-gon post, each lapping onto the one below. */
export function spiralStair(s: SpiralOpts): PieceSpec[] {
  const o: PieceOpts = { tint: s.tint, group: s.group, protected: s.protected };
  const ps: PieceSpec[] = [];
  const top = s.y0 + s.steps * s.rise;
  const sides = 16;
  for (const y of splitRange(0, top + 1.0, 4)) ps.push(prism(s.post ?? s.mat, 2 * s.rIn * Math.cos(Math.PI / sides), y, s.cx, s.cz, sides, o));
  for (let j = 0; j < s.steps; j++) {
    const a0 = (s.start ?? 0) + j * s.turn;
    const pts: Vec3[] = [];
    for (const y of [s.y0 + j * s.rise, s.y0 + (j + 1) * s.rise]) {
      for (const a of [a0, a0 + s.width]) pts.push([s.cx + s.rIn * Math.cos(a), y, s.cz + s.rIn * Math.sin(a)]);
      for (const f of [0, 0.5, 1]) {
        const a = a0 + f * s.width;
        pts.push([s.cx + s.rOut * Math.cos(a), y, s.cz + s.rOut * Math.sin(a)]);
      }
    }
    ps.push(hull(s.mat, pts, o));
  }
  return ps;
}

/* ---------------- intricate assemblies ---------------- */

export interface TimberWallOpts extends PieceOpts {
  axis?: 'x' | 'z';
  from: number;
  to: number;
  /** outer face of the wall on the thickness axis */
  face: number;
  out?: 1 | -1;
  y0: number;
  h: number;
  /** post centres along the run */
  posts: number[];
  frame: MaterialId;
  infill: MaterialId;
  frameTint?: number;
  /** mid rail height above y0 (bottom of the rail); omitted = no rail */
  rail?: number;
  /** braced bays: rising from the rail at post `bay` (dir +1) or post `bay + 1` (dir -1) up to the plate */
  braces?: { bay: number; dir: 1 | -1 }[];
  openings?: Opening[];
  glazing?: MaterialId;
  sole?: boolean;
  /** frame members span only this part of the run (corner posts belong to the crossing wall) */
  frameFrom?: number;
  frameTo?: number;
  mullion?: MaterialId;
}

/* Box-frame wall in two layers: an oak frame (sole, posts, rail, braces, plate) standing proud on the outside
   and a daub/plaster infill sheet behind it, so every member is visible and welds flat onto the infill. */
export function timberWall(w: TimberWallOpts): PieceSpec[] {
  const out = w.out ?? 1, ft = 0.18, it = 0.12, pw = 0.2, bh = 0.2;
  const fv: Range = out > 0 ? [w.face - ft, w.face] : [w.face, w.face + ft];
  const iv: Range = out > 0 ? [fv[0] - it, fv[0]] : [fv[1], fv[1] + it];
  const o: PieceOpts = { tint: w.frameTint, group: w.group, protected: w.protected };
  const f0 = w.frameFrom ?? w.from, f1 = w.frameTo ?? w.to;
  const y0 = w.y0, y1 = w.y0 + w.h;
  const ps: PieceSpec[] = [];
  const member = (u: Range, y: Range) => ps.push(block(w.frame, u, y, fv, o));
  const sole = w.sole ?? true;
  const postY: Range = [sole ? y0 + bh : y0, y1 - bh];
  if (sole) for (const u of splitRange(f0, f1, 4)) member(u, [y0, y0 + bh]);
  for (const u of splitRange(f0, f1, 4)) member(u, [y1 - bh, y1]);
  const posts = [...w.posts].sort((a, b) => a - b);
  for (const c of posts) member([c - pw / 2, c + pw / 2], postY);
  const blocked = (a: number, b: number, y: number) => (w.openings ?? []).some((op) => op.c + op.w / 2 > a && op.c - op.w / 2 < b && y0 + op.y0 < y && y0 + op.y0 + op.h > y);
  if (w.rail !== undefined) {
    const ry: Range = [y0 + w.rail, y0 + w.rail + 0.15];
    for (let i = 0; i + 1 < posts.length; i++) {
      const u: Range = [posts[i] + pw / 2, posts[i + 1] - pw / 2];
      if (!blocked(u[0], u[1], ry[0] + 0.07)) member(u, ry);
    }
    for (const br of w.braces ?? []) {
      const from = br.dir > 0 ? posts[br.bay] + pw / 2 : posts[br.bay + 1] - pw / 2;
      const span = Math.min(1.1, (posts[br.bay + 1] - posts[br.bay] - pw) / 2);
      ps.push(...flight({ mat: w.frame, axis: 'x', from, to: from + br.dir * span, cross: fv, y0: ry[1], steps: 2,
        rise: (y1 - bh - ry[1]) / 2, lap: 0.12, ...o }));
    }
  }
  const infill = wallRun({ mat: w.infill, from: w.from, to: w.to, at: (iv[0] + iv[1]) / 2, t: it, y0, h: w.h, out,
    openings: w.openings, glazing: w.glazing, mullion: w.mullion, mullionTint: w.frameTint, maxW: 2.4, tint: w.tint, group: w.group, protected: w.protected });
  ps.push(...infill);
  return w.axis === 'z' ? swapXZ(ps) : ps;
}

export interface ScaffoldOpts extends PieceOpts {
  axis?: 'x' | 'z';
  from: number;
  to: number;
  /** building face the scaffold stands against */
  face: number;
  out?: 1 | -1;
  height: number;
  lift?: number;
  bay?: number;
  /** tie a standard back to the face at every Nth lift */
  tieEvery?: number;
  /** sheeting hung off the outer guard rails, one sheet per bay: debris netting (default), PVC tarp, or none */
  wrap?: 'net' | 'tarp' | false;
}

/* Tube-and-board scaffold: standards (round tubes) in two lines, ledgers clamped to their board side, plywood
   boards across the ledgers, guard rails outside, and ties back to the facade. */
export function scaffold(s: ScaffoldOpts): PieceSpec[] {
  // 0.12 tubes so boards seamed on a standard still overlap it by more than the weld threshold
  const out = s.out ?? 1, lift = s.lift ?? 2.0, d = 0.12;
  const tube = { tint: s.tint, group: s.group, protected: s.protected };
  const at = (off: number): Range => (out > 0 ? [s.face + off, s.face + off + d] : [s.face - off - d, s.face - off]);
  const inner = at(0.25), innerLedger = at(0.25 + d), outerLedger = at(1.25 - d), outer = at(1.25), rail = at(1.25 + d);
  const boards: Range = out > 0 ? [innerLedger[0], outerLedger[1]] : [outerLedger[0], innerLedger[1]];
  const bays = Math.max(1, Math.round((s.to - s.from) / (s.bay ?? 2.4)));
  const xs = Array.from({ length: bays + 1 }, (_, i) => s.from + ((s.to - s.from) * i) / bays);
  const ps: PieceSpec[] = [];
  // standards are spliced half a metre above every second lift, clear of ledgers, boards and rails
  const cuts = [0];
  for (let y = 2 * lift + 0.5; y < s.height - 0.5; y += 2 * lift) cuts.push(y);
  cuts.push(s.height);
  for (const x of xs) {
    for (const line of [inner, outer]) {
      for (let i = 0; i + 1 < cuts.length; i++) ps.push(cyl('steel', d, [cuts[i], cuts[i + 1]], x, (line[0] + line[1]) / 2, tube));
    }
  }
  const run: Range = [xs[0] - d / 2, xs[bays] + d / 2];
  const lifts = Math.floor((s.height - 1.0) / lift);
  const topBoards: PieceSpec[] = [];
  for (let L = 1; L <= lifts; L++) {
    const y = L * lift;
    for (const z of [innerLedger, outerLedger]) for (const u of splitRange(run[0], run[1], 6)) ps.push(block('steel', u, [y - d, y], z, tube));
    for (let i = 0; i < bays; i++) {
      ps.push(block('plywood', [xs[i], xs[i + 1]], [y, y + 0.08], boards, { group: s.group, protected: s.protected }));
      if (L === lifts) topBoards[i] = ps[ps.length - 1];
    }
    for (const u of splitRange(run[0], run[1], 6)) ps.push(block('steel', u, [y + 0.9, y + 1.0], rail, tube));
    if ((s.tieEvery ?? 2) > 0 && L % (s.tieEvery ?? 2) === 0) {
      const tie: Range = out > 0 ? [s.face, inner[0]] : [inner[1], s.face];
      for (let i = 1; i < bays; i += 2) ps.push(block('steel', [xs[i] - d / 2, xs[i] + d / 2], [y - 0.35, y - 0.25], tie, tube));
    }
  }
  if ((s.wrap ?? 'net') && lifts > 0) scaffoldWrap(s.wrap || 'net', xs, (rail[0] + rail[1]) / 2, out > 0 ? rail[1] + 0.05 : rail[0] - 0.05, lift, lifts, topBoards);
  return s.axis === 'z' ? swapXZ(ps) : ps;
}

/** Real-bond masonry: individual bricks in stretcher bond, alternate courses offset half a brick. */
export function brickBond(mat: MaterialId, x: Range, y0: number, courses: number, zc: number, o: PieceOpts = {}, brick: Vec3 = [0.44, 0.14, 0.2]): PieceSpec[] {
  const [L, H, W] = brick;
  const ps: PieceSpec[] = [];
  for (let k = 0; k < courses; k++) {
    let a = x[0];
    let first = k % 2 === 0 ? L : L / 2;
    while (x[1] - a > 1e-6) {
      let b = Math.min(a + first, x[1]);
      // never leave a sliver: fold a short remainder into this brick
      if (x[1] - b < 0.12 && x[1] - b > 1e-6) b = x[1];
      ps.push(block(mat, [a, b], [y0 + k * H, y0 + (k + 1) * H], [zc - W / 2, zc + W / 2], o));
      a = b;
      first = L;
    }
  }
  return ps;
}

/* ---------------- loose props ---------------- */

export const PROP = {
  crate: 1.0,
  barrel: { d: 0.6, h: 0.9 },
  propane: { d: 0.5, h: 1.3 },
  tnt: [0.6, 0.45, 0.4] as Vec3,
};

export function crates(x: number, z: number, y0: number, nx: number, nz: number, layers: number, o: PieceOpts = {}, size = PROP.crate): PieceSpec[] {
  const ps: PieceSpec[] = [];
  for (let l = 0; l < layers; l++) {
    // each layer is one smaller so stacks read as stacks, not cubes
    const cx = Math.max(1, nx - l), cz = Math.max(1, nz - l);
    for (let i = 0; i < cx; i++) {
      for (let j = 0; j < cz; j++) {
        const px = x + (i - (cx - 1) / 2) * size, pz = z + (j - (cz - 1) / 2) * size;
        ps.push(box('crate', [size, size, size], [px, y0 + (l + 0.5) * size, pz], { ...o, noWeld: true }));
      }
    }
  }
  return ps;
}

/** Grid of upright cylinders (barrels or propane), spaced with a small air gap. */
export function drums(kind: 'barrel' | 'propane', x: number, z: number, y0: number, nx: number, nz: number, o: PieceOpts = {}): PieceSpec[] {
  const { d, h } = PROP[kind];
  const pitch = d + 0.04;
  const ps: PieceSpec[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      ps.push(cyl(kind, d, [y0, y0 + h], x + (i - (nx - 1) / 2) * pitch, z + (j - (nz - 1) / 2) * pitch, { ...o, noWeld: true }));
    }
  }
  return ps;
}

export function tnt(x: number, z: number, y0: number, count = 1, o: PieceOpts = {}): PieceSpec[] {
  const [sx, sy, sz] = PROP.tnt;
  return Array.from({ length: count }, (_, i) => box('tnt', [sx, sy, sz], [x, y0 + (i + 0.5) * sy, z], { ...o, noWeld: true }));
}

/* ---------------- soft furnishings (XPBD cloth, netting, rope, foam, grain) ---------------- */

/** A soft body's points move with its host piece (place / swapXZ / raise). */
export function softMap(sf: NonNullable<PieceSpec['soft']>, f: (v: Vec3) => Vec3): NonNullable<PieceSpec['soft']> {
  return { ...sf, pts: sf.pts.map(f), pins: Array.isArray(sf.pins) ? sf.pins.map(f) : sf.pins };
}

/** Curtains drawn open either side of a window: a rail on the inner face of a wall running along X
 * (`face` = inner face z, `into` = +1/-1 toward the room), each half-rail carrying one hanging panel. */
export function curtains(o: { face: number; into: 1 | -1; c: number; w: number; head: number; drop?: number; fabric?: 'cotton' | 'velvet' | 'poly'; tint?: number; group?: string }): PieceSpec[] {
  const x0 = o.c - o.w / 2 - 0.15, x1 = o.c + o.w / 2 + 0.15, zr: Range = o.into > 0 ? [o.face, o.face + 0.05] : [o.face - 0.05, o.face];
  const zc = (zr[0] + zr[1]) / 2, y = o.head + 0.05, drop = o.drop ?? 1.6, pw = Math.min(0.9, o.w * 0.45 + 0.15);
  const panel = (a: number, b: number): PieceSpec => ({
    ...block('wood', [a, b], [y - 0.02, y + 0.02], zr, { tint: 0x6b5a48, group: o.group }),
    soft: { kind: 'cloth', fabric: o.fabric ?? 'cotton', tint: o.tint, pins: 'top', pts: [[a + 0.02, y, zc], [a + pw, y, zc], [a + pw, y - drop, zc], [a + 0.02, y - drop, zc]] },
  });
  const left = panel(x0, o.c), right = panel(o.c, x1);
  // the right panel hangs from the outer end of its half-rail
  right.soft!.pts = [[x1 - pw, y, zc], [x1 - 0.02, y, zc], [x1 - 0.02, y - drop, zc], [x1 - pw, y - drop, zc]];
  return [left, right];
}

/** Shop awning: canvas from a wall bracket at `top` sloping out `depth` (+Z) to `front`, on two steel arms. */
export function awning(x: Range, face: number, top: number, front: number, depth: number, tint: number, group?: string): PieceSpec[] {
  const o = { tint: 0x2f3336, group };
  const ps: PieceSpec[] = [
    block('steel', [x[0], x[1]], [top - 0.06, top + 0.02], [face, face + 0.06], o),
    block('steel', [x[0], x[0] + 0.05], [front - 0.05, front], [face, face + depth + 0.03], o),
    block('steel', [x[1] - 0.05, x[1]], [front - 0.05, front], [face, face + depth + 0.03], o),
  ];
  const z0 = face + 0.03, z1 = face + depth, pins: Vec3[] = [];
  // every particle of the top edge sits in the bracket, so every one is pinned
  const lu = x[1] - x[0] - 0.06, nu = Math.max(2, Math.round(lu / 0.2) + 1);
  for (let k = 0; k < nu; k++) pins.push([x[0] + 0.03 + (lu * k) / (nu - 1), top - 0.02, z0]);
  pins.push([x[0] + 0.025, front - 0.025, z1], [x[1] - 0.025, front - 0.025, z1]);
  ps[0].soft = { kind: 'cloth', fabric: 'canvas', tint, res: 0.2, pins, pts: [[x[0] + 0.03, top - 0.02, z0], [x[1] - 0.03, top - 0.02, z0], [x[1] - 0.025, front - 0.025, z1], [x[0] + 0.025, front - 0.025, z1]] };
  return ps;
}

/** Flag on a pole (a steel tube standing on `base`), flying toward +X from the pole's top. */
export function flagpole(x: number, z: number, base: number, h: number, flag: [number, number], tint: number, group?: string): PieceSpec {
  const top = base + h, [fw, fh] = flag, y0 = top - 0.1, x0 = x + 0.07;
  // hoisted along its whole edge, just clear of the tube
  const rows = Math.max(2, Math.round(fh / 0.15) + 1), pins: Vec3[] = [];
  for (let k = 0; k < rows; k++) pins.push([x, y0 - (fh * k) / (rows - 1), z]);
  return {
    ...cyl('steel', 0.08, [base, top], x, z, { tint: 0xd8d8d2, group }),
    soft: { kind: 'cloth', fabric: 'poly', tint, res: 0.15, pins, pts: [[x0, y0, z], [x0 + fw, y0, z], [x0 + fw, y0 - fh, z], [x0, y0 - fh, z]] },
  };
}

/** Duvet laid over a bed or mattress top (y), spilling over the sides. */
export function duvet(x: Range, z: Range, y: number, tint = 0xe9e6de): NonNullable<PieceSpec['soft']> {
  return { kind: 'cloth', fabric: 'cotton', tint, res: 0.16, pts: [[x[0] - 0.12, y + 0.04, z[0]], [x[1] + 0.12, y + 0.04, z[0]], [x[1] + 0.12, y + 0.04, z[1]], [x[0] - 0.12, y + 0.04, z[1]]] };
}

/** Courses of sandbags (softbody sand) along X from x0, bags 0.62 × 0.14 × 0.34, on a pallet at `base` y.
 * Each bag's host is a thin slat on the pallet under the bottom course, so it is created and removed with it. */
export function sandbags(x0: number, z: number, base: number, n: number, courses = 2, group?: string): PieceSpec[] {
  const ps: PieceSpec[] = [block('wood', [x0 - 0.05, x0 + n * 0.64 + 0.05], [base, base + 0.1], [z - 0.25, z + 0.25], { tint: 0x9b7a50, noWeld: true, group })];
  for (let k = 0; k < courses; k++) for (let i = 0; i < n - k; i++) {
    const x = x0 + i * 0.64 + k * 0.32, y = base + 0.112 + k * 0.14, sx = x0 + i * 0.64 + (k ? 0.52 : 0.2);
    ps.push({ ...block('wood', [sx, sx + 0.22], [base + 0.1, base + 0.112], [z - 0.05, z + 0.05], { tint: 0x9b7a50, noWeld: true, group }),
      soft: { kind: 'softbody', fabric: 'sand', tint: 0xb9a57a, res: 0.1, pts: [[x, y + 0.002, z - 0.17], [x + 0.62, y + 0.14, z + 0.17]] } });
  }
  return ps;
}

/** Loose aggregate heaped at its angle of repose inside the footprint x × z (sand, gravel or topsoil). */
export function stockpile(fabric: 'sand' | 'gravel' | 'soil', x: Range, z: Range, height: number, group?: string): PieceSpec {
  return { ...block('concrete', [x[0], x[0] + 0.3], [0, 0.05], [z[0], z[0] + 0.3], { tint: 0x9a9a96, group }),
    soft: { kind: 'granular', fabric, pts: [[x[0], 0, z[0]], [x[1], height, z[1]]] } };
}

/* Sheeting tied to the outside of the guard rail (zr: rail centre, zs: sheet plane) at every lift, one sheet
   per bay (each bay's top board is its host); rows are spaced so a row of the sheet meets every rail. */
function scaffoldWrap(kind: 'net' | 'tarp', xs: number[], zr: number, zc: number, lift: number, lifts: number, hosts: PieceSpec[]): void {
  const res = lift / (kind === 'tarp' ? 6 : 5), top = lifts * lift + 0.95;
  const bottom = top - Math.floor((top - 0.15) / res) * res;
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i] + 0.07, b = xs[i + 1] - 0.07, pins: Vec3[] = [];
    for (let L = 1; L <= lifts; L++) for (const x of [a, (a + b) / 2, b]) pins.push([x, L * lift + 0.95, zr]);
    hosts[i].soft = kind === 'tarp'
      ? { kind: 'cloth', fabric: 'tarp', tint: 0xd9dcd6, res, pins, pts: [[a, top, zc], [b, top, zc], [b, bottom, zc], [a, bottom, zc]] }
      : { kind: 'net', fabric: 'mesh', res, pins, pts: [[a, top, zc], [b, top, zc], [b, bottom, zc], [a, bottom, zc]] };
  }
}

/* ---------------- gas bags, board and paper (XPBD membranes) ---------------- */

/** Helium party balloons on strings tied along a batten fixed under a fascia at `y` (running along X from x0). */
export function balloons(x0: number, z: number, y: number, n: number, tints: number[] = [0xd23a3a, 0xf2c230, 0x3a6fd2, 0xf2f2ee], group?: string): PieceSpec[] {
  const ps: PieceSpec[] = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 0.4, top = y + 0.6 + (i % 3) * 0.15;
    ps.push({ ...block('wood', [x - 0.03, x + 0.03], [y - 0.03, y], [z - 0.03, z + 0.03], { tint: 0x3a2418, group }),
      soft: { kind: 'balloon', gas: 'helium', gauge: 2000, tint: tints[i % tints.length], pts: [[x - 0.13, top, z - 0.13], [x + 0.13, top + 0.32, z + 0.13]], pins: [[x, y - 0.015, z]] } });
  }
  return ps;
}

/** Air-supported dome over x × z, `h` high, standing on the ground at y; its blower (a casing by the rim at
 * `blowerAt`) keeps it up while it stands. */
export function airDome(x: Range, z: Range, y: number, h: number, blowerAt: [number, number], o: { tint?: number; gauge?: number; group?: string } = {}): PieceSpec {
  const [bx, bz] = blowerAt;
  return { ...block('metal', [bx - 0.35, bx + 0.35], [y, y + 0.6], [bz - 0.3, bz + 0.3], { tint: 0x4a5a3a, group: o.group }),
    soft: { kind: 'dome', fabric: 'pvc', tint: o.tint, gauge: o.gauge ?? 250, blower: 3, res: 0.45, pts: [[x[0], y + 0.02, z[0]], [x[1], y + h, z[1]]] } };
}

/** Inflatable dunnage bag filling a gap (x × y × z), on a thin slat at its foot that carries it. */
export function dunnageBag(x: Range, y: Range, z: Range, group?: string, gauge?: number): PieceSpec {
  return { ...block('plywood', [x[0] + 0.05, x[1] - 0.05], [y[0], y[0] + 0.012], [z[0] + 0.05, z[1] - 0.05], { tint: 0xa98a5c, noWeld: true, group }),
    soft: { kind: 'inflatable', fabric: 'kraft', res: 0.15, gauge, pts: [[x[0], y[0] + 0.014, z[0]], [x[1], y[1], z[1]]] } };
}

/** Cardboard carton, `s` = [w, h, d], standing on y (on a thin card slat that carries it). */
export function carton(x: number, z: number, y: number, s: Vec3 = [0.4, 0.3, 0.3], tint?: number, group?: string): PieceSpec {
  const [w, h, d] = s;
  return { ...block('cardboard', [x - w / 2 + 0.03, x + w / 2 - 0.03], [y, y + 0.008], [z - d / 2 + 0.03, z + d / 2 - 0.03], { tint: 0xb48a58, noWeld: true, group }),
    soft: { kind: 'carton', tint, res: 0.1, pts: [[x - w / 2, y + 0.01, z - d / 2], [x + w / 2, y + 0.01 + h, z + d / 2]] } };
}
