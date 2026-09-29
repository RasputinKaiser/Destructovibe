import type { MaterialId, PieceSpec, Vec3 } from '../../types.ts';
import { block, hull, hullVolume, weldParts, type Range } from '../../levels/kit.ts';
import { masonry, type Slab } from '../../levels/layers.ts';
import { effectiveDensity } from '../../destruction/materials.ts';

/* Square boiler-house chimney, local frame: shaft on the Y axis, the boiler house (and the flue inlet) toward +X.
   Every level is a whole number of 75 mm brick courses so the courses of neighbouring lifts line up. */

export const C = 0.075;
export const BRICK = 0x9a5a44, SOOT = 0x5e4a40, BLUE = 0x4e4a4c, STONE = 0xc9bfa8, IRON = 0x2f3134;
export const PED = { half: 2.0, wall: 0.68, low: 16 * C, top: 60 * C };
export const CAPSTONE: Range = [PED.top, PED.top + 4 * C];
/** the shaft's lifts: courses in each and its wall (set off inside at each lift) */
export const SHAFT = { y0: CAPSTONE[1], base: 1.3, top: 0.8, courses: [59, 58, 58, 59, 58, 59], walls: [0.56, 0.56, 0.45, 0.45, 0.34, 0.23] };
/** bottom and top of shaft lift j */
export const liftY = (j: number): Range => {
  let y = SHAFT.y0;
  for (let k = 0; k < j; k++) y += SHAFT.courses[k] * C;
  return [y, y + SHAFT.courses[j] * C];
};
export const SHAFT_TOP = liftY(SHAFT.courses.length - 1)[1];
export const CAP = { h: 16 * C, corbel: 6, out: 0.3 };
/** outer half-width of the battered shaft at height y */
export const outer = (y: number): number => SHAFT.base + (SHAFT.top - SHAFT.base) * (y - SHAFT.y0) / (SHAFT_TOP - SHAFT.y0);

const J = 0.01, FACE = 0.012;

/** A face of the square: which way it looks and which axis runs along it. */
export interface Side { axis: 'x' | 'z'; s: 1 | -1 }
export const SIDES: Side[] = [{ axis: 'z', s: 1 }, { axis: 'z', s: -1 }, { axis: 'x', s: 1 }, { axis: 'x', s: -1 }];

export interface WallOpts {
  mat?: MaterialId;
  tint?: number;
  /** units' material and tint by course index (from the builder origin) */
  course?: (k: number) => { mat?: MaterialId; tint?: number; out?: number } | null;
  /** iron band in this course (a 75 × 12 mm flat round the shaft) */
  band?: (k: number) => boolean;
  /** copper down-tape on this face at u */
  tape?: number;
  /** a cast-iron plate (soot door) in the face skin: along-wall range and height range */
  plate?: { u: Range; y: Range };
  /** an opening kept clear of units: along-wall range `u` up to height `y` */
  gap?: { u: Range; y: number };
  /** only this stretch of the wall along the face (a wall split into lengths); default the whole ±end */
  span?: Range;
  bond?: 'english' | 'flemish';
}

/** One wall of a square lift from y0 to y1: its outer face at `o(y)` (a batter or a corbel), its inner face at `inner`,
    running along the face over ±`end(y)` (the lapping walls run to the outer corner, the others stop at the inner face).
    One hull member whose dormant detail is the brickwork, course by course, 12 mm behind the envelope (the bands and
    the conductor tape sit in that skin). */
export function wall(side: Side, y: Range, o: (y: number) => number, inner: number, end: (y: number) => number, w: WallOpts = {}): PieceSpec {
  const ys = profileYs(y, o, end);
  const pts: Vec3[] = [];
  const along = (yy: number): Range => (w.span ? [Math.max(-end(yy), w.span[0]), Math.min(end(yy), w.span[1])] : [-end(yy), end(yy)]);
  for (const yy of ys) for (const u of along(yy)) for (const t of [inner, o(yy)]) pts.push(pt(side, u, yy, t));
  const p = hull(w.mat ?? 'brick', pts, { tint: w.tint ?? BRICK });
  const units: PieceSpec[] = [];
  const k0 = Math.floor(y[0] / C + 1e-6), k1 = Math.ceil(y[1] / C - 1e-6);
  for (let k = k0; k < k1; k++) {
    const v: Range = [Math.max(k * C, y[0]), Math.min((k + 1) * C, y[1])];
    if (v[1] - v[0] < 0.02) continue;
    const top = Math.min(o(v[0]), o(v[1])), a0 = along(v[0]), a1 = along(v[1]), ext: Range = [Math.max(a0[0], a1[0]), Math.min(a0[1], a1[1])];
    const cw = w.course?.(k) ?? {};
    const face = top - FACE - (cw.out ?? 0);
    const U: Range[] = w.gap && v[1] <= w.gap.y + 1e-6 ? split(ext, w.gap.u) : [ext];
    for (const uu of U) {
      const s = slab(side, uu, v, [inner, face]);
      units.push(...masonry(s, s.T, { mat: cw.mat ?? 'brick', tint: cw.tint ?? w.tint ?? BRICK, unit: [0.215, 0.065, (face - inner - J) / 2], joint: J, kind: w.bond ?? 'english' }));
      if (w.band?.(k)) units.push(cell(side, 'steel', uu, [v[0] + 0.004, v[1] - 0.004], [face, top], IRON));
    }
    if (w.tape !== undefined && !w.band?.(k)) units.push(cell(side, 'copper', [w.tape - 0.0125, w.tape + 0.0125], v, [face, face + 0.005], 0x7a5a3a));
  }
  if (w.plate) units.push(cell(side, 'castiron', w.plate.u, w.plate.y, [o(w.plate.y[0]) - FACE, o(w.plate.y[0]) - 0.002], IRON));
  return withUnits(p, units, pts);
}

/** the heights where the outer profile turns (ends and the corbel's knee) */
function profileYs(y: Range, o: (y: number) => number, end: (y: number) => number): number[] {
  const ys = [y[0], y[1]];
  for (let k = Math.round(y[0] / C) + 1; k < Math.round(y[1] / C); k++) {
    const a = (k - 1) * C, b = k * C, c = (k + 1) * C;
    const bend = (f: (y: number) => number) => Math.abs((f(c) - f(b)) - (f(b) - f(a))) > 1e-6;
    if (bend(o) || bend(end)) ys.push(b);
  }
  return ys.sort((a, b) => a - b);
}

function pt(side: Side, u: number, y: number, t: number): Vec3 {
  return side.axis === 'z' ? [u, y, side.s * t] : [side.s * t, y, u];
}

function slab(side: Side, U: Range, V: Range, T: Range): Slab {
  const t: Range = side.s > 0 ? T : [-T[1], -T[0]];
  return side.axis === 'z' ? { u: 0, v: 1, t: 2, U, V, T: t, out: side.s } : { u: 2, v: 1, t: 0, U, V, T: t, out: side.s };
}

function cell(side: Side, mat: MaterialId, U: Range, V: Range, T: Range, tint: number): PieceSpec {
  const t: Range = side.s > 0 ? T : [-T[1], -T[0]];
  return side.axis === 'z' ? block(mat, U, V, t, { tint }) : block(mat, t, V, U, { tint });
}

function split(r: Range, gap: Range): Range[] {
  return ([[r[0], gap[0]], [gap[1], r[1]]] as Range[]).filter(([a, b]) => b - a > 0.05);
}

/** give a hull member its units and their mass over the hull's true volume */
export function withUnits(p: PieceSpec, units: PieceSpec[], pts: Vec3[]): PieceSpec {
  let mass = 0;
  for (const c of units) { const v = c.size[0] * c.size[1] * c.size[2]; mass += v * effectiveDensity(c, v); }
  p.detail = units;
  p.density = Math.round((mass / hullVolume(pts)) * 1000) / 1000;
  return p;
}

/** One lift as one body: its walls (hull or box members carrying their units) as the convex parts of a compound, so
    the lift's bed joints are whole rings of courses and only a fracture parts its walls. */
export function ring(ws: PieceSpec[]): PieceSpec {
  let mass = 0, vol = 0;
  for (const q of ws) {
    const v = q.verts ? hullVolume(q.verts) : q.size[0] * q.size[1] * q.size[2];
    vol += v; mass += v * (q.density ?? effectiveDensity(q, v));
  }
  const out = weldParts(ws.map((q) => ({ ...q, detail: undefined })));
  out.detail = ws.flatMap((q) => q.detail ?? []);
  out.density = Math.round((mass / vol) * 1000) / 1000;
  return out;
}

/** The flue duct: a solid brick box along x (bricks laid through its width), from the pedestal to the boiler house. */
export function duct(x: Range, y: Range, z: Range, o: { tint?: number; course?: WallOpts['course'] }): PieceSpec {
  const side: Side = { axis: 'z', s: 1 }, units: PieceSpec[] = [];
  for (let k = Math.round(y[0] / C); k < Math.round(y[1] / C); k++) {
    const v: Range = [k * C, (k + 1) * C], cw = o.course?.(k) ?? {};
    units.push(...masonry(slab(side, x, v, z), z, { mat: cw.mat ?? 'brick', tint: cw.tint ?? o.tint ?? BRICK, unit: [0.215, 0.065, (z[1] - z[0] - J) / 2], joint: J, kind: 'english' }));
  }
  const pts: Vec3[] = [];
  for (const a of x) for (const b of y) for (const c of z) pts.push([a, b, c]);
  return withUnits(hull('brick', pts, { tint: o.tint ?? BRICK }), units, pts);
}

/** Below grade (not part of the package's pieces, for a site with real ground), in the building's local frame: a
    mass-concrete pad 1.5 m deep and 0.3 m wider than the pedestal all round, and a strip footing under the flue duct
    stopping 0.35 m short of the boiler house's wall `wall` (clear of its own footing). */
export function foundationLocal(wall: number): PieceSpec[] {
  const h = PED.half + 0.3, end = wall - 0.35, tint = 0xa9a59b;
  return [
    block('concrete', [-h, h], [-1.5, 0], [-h, h], { tint }),
    ...(end - h > 0.3 ? [block('concrete', [h, end], [-0.6, 0], [-0.95, 0.95], { tint })] : []),
  ];
}
