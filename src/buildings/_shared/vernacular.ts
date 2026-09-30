import type { MaterialId, PieceSpec, Vec3 } from '../../types.ts';
import { block, extrude, hull, wallRun, weldParts, type Opening, type PieceOpts, type Range, type WallRunOpts } from '../../levels/kit.ts';
import { boards, layered, masonry, wallSlab, withDetail, BRICK, type Slab } from '../../levels/layers.ts';
import { roofUnits, type Covering } from './roofs.ts';
import { hash3, shadeTint, vary } from './tints.ts';
import { inscribe, letters, type SignFace } from './lettering.ts';

/* British vernacular joinery and roof pieces shared by the Clearance Zone houses and shops. Everything is written in
   builder coordinates; the fine members (sash stiles, glazing bars, door panels, lites) are dormant detail on one
   coarse member, so a window or door costs one simulated piece but reads as joinery up close. */

export const PAINT = { white: 0xf2efe6, cream: 0xe9e0c8, black: 0x1f2124, green: 0x2f4f3a, blue: 0x2c3e5c, red: 0x7a2222, maroon: 0x4a1f24, teal: 0x2f6f6a };

type Cell = (mat: MaterialId, u: Range, y: Range, t: Range, o?: { tint?: number; finish?: PieceSpec['finish'] }) => PieceSpec;

/* the member's plan axis (the long horizontal one), its thickness axis and ranges */
function frameOf(p: PieceSpec): { U: Range; Y: Range; T: Range; cell: Cell } {
  const ax = p.size[0] >= p.size[2] ? 0 : 2;
  const r = (k: number): Range => [p.pos[k] - p.size[k] / 2, p.pos[k] + p.size[k] / 2];
  const cell: Cell = (mat, u, y, t, o = {}) => {
    const q = ax === 0 ? block(mat, u, y, t) : block(mat, t, y, u);
    if (o.tint !== undefined) q.tint = o.tint;
    if (o.finish) q.finish = o.finish;
    return q;
  };
  return { U: r(ax), Y: r(1), T: r(ax === 0 ? 2 : 0), cell };
}

export interface GlazeOpts {
  /** joinery paint */
  tint?: number;
  /** frame (stile / head) width */
  frame?: number;
  /** bottom rail height */
  bottom?: number;
  /** horizontal rails (meeting rail of a sash, transom of a shopfront) as fractions of the height */
  rails?: number[];
  railH?: number;
  /** lites across (vertical glazing bars = bars - 1) */
  bars?: number;
  barW?: number;
}

/** Keep a member's units `e` inside its bounds, so no face of a unit lies in the plane of a neighbouring member's face
    (a window stile flush with the brick reveal flickers red along the edge). */
export function inset(p: PieceSpec): PieceSpec {
  if (!p.detail) return p;
  const e = 0.002, lo = p.pos.map((v, i) => v - p.size[i] / 2 + e), hi = p.pos.map((v, i) => v + p.size[i] / 2 - e);
  const d = p.detail.map((u) => {
    if (u.shape && u.shape !== 'box') return u;
    const a = u.pos.map((v, i) => Math.max(v - u.size[i] / 2, lo[i])), b = u.pos.map((v, i) => Math.min(v + u.size[i] / 2, hi[i]));
    if (b.some((v, i) => v - a[i] < 0.001)) return u;
    const q = block(u.mat, [a[0], b[0]], [a[1], b[1]], [a[2], b[2]]);
    return { ...u, size: q.size, pos: q.pos };
  });
  return { ...p, detail: d };
}

/** Dress a plain pane (a thin glass box from wallRun) as a timber window: frame, rails, glazing bars and lites. */
export function glaze(p: PieceSpec, o: GlazeOpts = {}): PieceSpec {
  if ((p.shape && p.shape !== 'box') || p.detail || (p.mat !== 'glass' && p.mat !== 'tempered')) return p;
  const { U, Y, T, cell } = frameOf(p);
  const fw = o.frame ?? 0.055, bot = o.bottom ?? 0.075, rh = o.railH ?? 0.045, bw = o.barW ?? 0.024, tm = (T[0] + T[1]) / 2;
  const wood = { tint: o.tint ?? PAINT.white, finish: 'joinery' as const }, lite = { finish: 'smoked' as const };
  const Ui: Range = [U[0] + fw, U[1] - fw];
  if (Ui[1] - Ui[0] < 0.1 || Y[1] - Y[0] < 0.3) return p;
  const d: PieceSpec[] = [
    cell('wood', [U[0], Ui[0]], Y, T, wood), cell('wood', [Ui[1], U[1]], Y, T, wood),
    cell('wood', Ui, [Y[1] - fw, Y[1]], T, wood), cell('wood', Ui, [Y[0], Y[0] + bot], T, wood),
  ];
  const bands: Range[] = [];
  let y = Y[0] + bot;
  for (const f of o.rails ?? []) {
    const r = Y[0] + f * (Y[1] - Y[0]);
    d.push(cell('wood', Ui, [r - rh / 2, r + rh / 2], T, wood));
    bands.push([y, r - rh / 2]);
    y = r + rh / 2;
  }
  bands.push([y, Y[1] - fw]);
  const n = Math.max(1, o.bars ?? 1), W = Ui[1] - Ui[0];
  const cols: Range[] = [];
  let u = Ui[0];
  for (let i = 1; i < n; i++) { const c = Ui[0] + (i * W) / n; cols.push([u, c - bw / 2]); u = c + bw / 2; }
  cols.push([u, Ui[1]]);
  for (const b of bands) {
    if (b[1] - b[0] < 0.02) continue;
    for (let i = 1; i < n; i++) { const c = Ui[0] + (i * W) / n; d.push(cell('wood', [c - bw / 2, c + bw / 2], b, [tm - 0.016, tm + 0.016], wood)); }
    for (const c of cols) d.push(cell(p.mat, c, b, [tm - 0.003, tm + 0.003], lite));
  }
  return inset(withDetail({ ...p, finish: 'smoked' }, d));
}

/** A two-over-two (or one-over-one) vertical sliding sash. */
export const sash = (p: PieceSpec, tint?: number, bars = 2): PieceSpec => glaze(p, { tint, rails: [0.5], bars });

/** Dress every pane in a list (wallRun output) with `f`. */
export function glazeAll(ps: PieceSpec[], f: (p: PieceSpec) => PieceSpec): PieceSpec[] {
  return ps.map((p) => ((p.mat === 'glass' || p.mat === 'tempered') && !p.detail ? f(p) : p));
}

export interface DoorOpts {
  tint?: number;
  /** fanlight / top-light height above the leaf */
  fan?: number;
  /** upper part of the leaf glazed (shop and pub doors), as a fraction of the leaf height */
  glazed?: number;
  panels?: 2 | 4;
}

/** Panelled front door with its frame and fanlight, filling a door opening u × y in a wall whose thickness is t.
    The leaf stands in the inner half of the reveal; one simulated member welded to both jambs and the threshold. */
export function door(axis: 'x' | 'z', u: Range, y: Range, t: Range, out: 1 | -1, o: DoorOpts = {}): PieceSpec {
  const th = 0.07;
  const tv: Range = out > 0 ? [t[0] + 0.02, t[0] + 0.02 + th] : [t[1] - 0.02 - th, t[1] - 0.02];
  const leafTint = o.tint ?? PAINT.green, frameTint = PAINT.white;
  const cell: Cell = (mat, uu, yy, tt, oo = {}) => {
    const q = axis === 'x' ? block(mat, uu, yy, tt) : block(mat, tt, yy, uu);
    if (oo.tint !== undefined) q.tint = oo.tint;
    if (oo.finish) q.finish = oo.finish;
    return q;
  };
  // a 30 mm gap under the head: the frame is wedged in the opening, it does not carry the wall over it
  y = [y[0], y[1] - 0.03];
  const p = cell('wood', u, y, tv, { tint: leafTint, finish: 'joinery' });
  const fw = 0.06, fan = o.fan ?? 0, top = y[1] - fan;
  const fr = { tint: frameTint, finish: 'joinery' as const }, lf = { tint: leafTint, finish: 'joinery' as const };
  const dk = { tint: shade(leafTint, 0.8), finish: 'joinery' as const };
  const L: Range = [u[0] + fw, u[1] - fw], tm = (tv[0] + tv[1]) / 2;
  const d: PieceSpec[] = [cell('wood', [u[0], L[0]], y, tv, fr), cell('wood', [L[1], u[1]], y, tv, fr)];
  if (fan > 0.1) {
    d.push(cell('wood', L, [top, top + 0.06], tv, fr), cell('wood', L, [y[1] - 0.05, y[1]], tv, fr));
    d.push(cell('glass', L, [top + 0.06, y[1] - 0.05], [tm - 0.003, tm + 0.003], { finish: 'smoked' }));
  }
  // the leaf: stiles, top, lock and bottom rails, and recessed (thinner) panels between them
  const sw = 0.11, H: Range = [y[0], top], Li: Range = [L[0] + sw, L[1] - sw];
  const lock = H[0] + 0.95, bot = 0.22, tr = 0.11;
  d.push(cell('wood', [L[0], Li[0]], H, tv, lf), cell('wood', [Li[1], L[1]], H, tv, lf));
  d.push(cell('wood', Li, [H[0], H[0] + bot], tv, lf), cell('wood', Li, [lock - 0.08, lock + 0.08], tv, lf), cell('wood', Li, [H[1] - tr, H[1]], tv, lf));
  const recess: Range = [tm - 0.012, tm + 0.012];
  const lower: Range = [H[0] + bot, lock - 0.08], upper: Range = [lock + 0.08, H[1] - tr];
  const glazedFrom = o.glazed ? H[1] - o.glazed * (H[1] - H[0]) : Infinity;
  const panel = (uu: Range, yy: Range) => {
    if (yy[1] > glazedFrom + 1e-6) d.push(cell('glass', uu, yy, [tm - 0.003, tm + 0.003], { finish: 'smoked' }));
    else d.push(cell('wood', uu, yy, recess, dk));
  };
  if ((o.panels ?? 4) === 4) {
    const mid = (Li[0] + Li[1]) / 2, mw = 0.04;
    for (const yy of [lower, upper]) {
      if (yy[1] > glazedFrom + 1e-6) { panel(Li, yy); continue; }
      d.push(cell('wood', [mid - mw, mid + mw], yy, tv, lf));
      panel([Li[0], mid - mw], yy); panel([mid + mw, Li[1]], yy);
    }
  } else { panel(Li, lower); panel(Li, upper); }
  return inset(withDetail(p, d));
}

export function shade(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k)), g = Math.min(255, Math.round(((c >> 8) & 255) * k)), b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/* ---------------- hipped roof ---------------- */

type P2 = [number, number];

function clipAxis(poly: P2[], k: 0 | 1, a: number, b: number): P2[] {
  const cut = (pts: P2[], keep: (p: P2) => boolean, c: number): P2[] => {
    const out: P2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], kp = keep(p), kq = keep(q);
      if (kp) out.push(p);
      if (kp !== kq) {
        const t = (c - p[k]) / (q[k] - p[k]);
        out.push(k === 0 ? [c, p[1] + t * (q[1] - p[1])] : [p[0] + t * (q[0] - p[0]), c]);
      }
    }
    return out;
  };
  return cut(cut(poly, (p) => p[k] >= a - 1e-9, a), (p) => p[k] <= b + 1e-9, b);
}

export interface HipRoofOpts {
  /** eave line in plan (overhang included) */
  x: Range;
  z: Range;
  /** underside of the eave (the wall-top / soffit level) */
  y: number;
  /** rise per unit run */
  k: number;
  /** vertical thickness of the slope */
  thick: number;
  /** flat bearing strip in from the eave line (overhang + wall thickness) */
  seat: number;
  mat?: MaterialId;
  tint?: number;
  ridgeTint?: number;
  maxW?: number;
  /** a stack rising through the ridge: the slopes are cut back to ±sz from the ridge line over x */
  hole?: { x: Range; sz: number };
  cover?: Covering;
  group?: string;
}

/** Hipped roof on a rectangle (x longer than z): two trapezoidal slopes and two hip triangles meeting on vertical
    planes through the hips and the ridge, each sitting flat on the wall tops through a seat strip, covered course by
    course (roofUnits); ridge and hip tiles. Returns the slabs, the top-surface height function and the ridge height. */
export function hipRoof(r: HipRoofOpts): { pieces: PieceSpec[]; top: (x: number, z: number) => number; ridge: number } {
  const [x0, x1] = r.x, [z0, z1] = r.z, hz = (z1 - z0) / 2, zc = (z0 + z1) / 2;
  if (x1 - x0 < z1 - z0) throw new Error('hipRoof: x must be the long side');
  if (r.thick - r.k * r.seat < 0.06) throw new Error('hipRoof: slab too thin at the eave');
  const topD = (d: number) => r.y + r.thick - r.k * r.seat + r.k * d;
  const botD = (d: number) => Math.max(r.y, r.y + r.k * (d - r.seat));
  const o: PieceOpts = { tint: r.tint, group: r.group };
  const mat = r.mat ?? 'roof';
  const slab = (poly: P2[], dist: (p: P2) => number): PieceSpec => {
    const pts: Vec3[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], dp = dist(p), dq = dist(q);
      pts.push([p[0], topD(dp), p[1]], [p[0], botD(dp), p[1]]);
      if ((dp - r.seat) * (dq - r.seat) < 0) {
        const t = (r.seat - dp) / (dq - dp), m: P2 = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
        pts.push([m[0], topD(r.seat), m[1]], [m[0], r.y, m[1]]);
      }
    }
    return roofUnits(hull(mat, pts, o), { cover: r.cover ?? 'plain', tint: r.tint });
  };
  const ps: PieceSpec[] = [];
  const ra = x0 + hz, rb = x1 - hz;
  const front: P2[] = [[x0, z1], [x1, z1], [rb, zc], [ra, zc]], back: P2[] = [[x0, z0], [ra, zc], [rb, zc], [x1, z0]];
  const n = Math.max(1, Math.ceil((x1 - x0) / (r.maxW ?? 4.2)));
  const xs = new Set<number>();
  for (let i = 0; i <= n; i++) xs.add(x0 + ((x1 - x0) * i) / n);
  if (r.hole) { xs.add(r.hole.x[0]); xs.add(r.hole.x[1]); }
  const cuts = [...xs].sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 0.05);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1];
    const inHole = r.hole && a >= r.hole.x[0] - 1e-9 && b <= r.hole.x[1] + 1e-9;
    let f = clipAxis(front, 0, a, b), bk = clipAxis(back, 0, a, b);
    if (inHole) { f = clipAxis(f, 1, zc + r.hole!.sz, z1); bk = clipAxis(bk, 1, z0, zc - r.hole!.sz); }
    ps.push(slab(f, (p) => z1 - p[1]), slab(bk, (p) => p[1] - z0));
  }
  ps.push(slab([[x0, z0], [x0, z1], [ra, zc]], (p) => p[0] - x0));
  ps.push(slab([[x1, z1], [x1, z0], [rb, zc]], (p) => x1 - p[0]));
  /* ridge and hip tiles: each line is capped by two half-strips, one bedded flat on each slope it divides, meeting
     on the vertical plane through the line (a convex tile cannot sit astride a convex ridge) */
  const c = 0.13, ht = 0.1, tile: PieceOpts = { tint: r.ridgeTint ?? r.tint, group: r.group };
  const rt = topD(hz), s2 = Math.SQRT1_2;
  const strip = (a: P2, b: P2, m: P2, da: number, db: number, drop: number) => {
    const pts: Vec3[] = [];
    for (const [p, dp] of [[a, da], [b, db]] as const) {
      const q: P2 = [p[0] + m[0] * c, p[1] + m[1] * c], dq = dp - drop;
      pts.push([p[0], topD(dp), p[1]], [p[0], topD(dp) + ht, p[1]], [q[0], topD(dq), q[1]], [q[0], topD(dq) + ht * 0.35, q[1]]);
    }
    ps.push(hull('terracotta', pts, tile));
  };
  const runs: Range[] = r.hole ? [[ra, r.hole.x[0]], [r.hole.x[1], rb]] : [[ra, rb]];
  for (const [xa, xb] of runs) {
    if (xb - xa < 0.2) continue;
    for (const sz of [1, -1]) strip([xa, zc], [xb, zc], [0, sz], hz, hz, c);
  }
  for (const [cx, cz, ex, ez] of [[x0, z0, ra, zc], [x0, z1, ra, zc], [x1, z0, rb, zc], [x1, z1, rb, zc]] as const) {
    const dx = Math.sign(ex - cx), dz = Math.sign(ez - cz), sa = 0.1, sb = hz - 0.25;
    const pa: P2 = [cx + dx * sa, cz + dz * sa], pb: P2 = [cx + dx * sb, cz + dz * sb];
    for (const sg of [1, -1]) strip(pa, pb, [sg * dx * s2, -sg * dz * s2], sa, sb, c * s2);
  }
  const top = (x: number, z: number) => topD(Math.min(x - x0, x1 - x, z - z0, z1 - z));
  return { pieces: ps, top, ridge: rt };
}

/* ---------------- plastered solid brick ---------------- */

export interface LimeOpts {
  /** plaster both faces (party walls, internal walls) instead of the inside face only */
  both?: boolean;
  plaster?: number;
  bond?: 'flemish' | 'english' | 'stretcher';
  /** render the outside face instead of exposing the brick (painted render); the reveals of the run's openings are
      rendered too */
  render?: number;
  /** the render's paint at a point (a house's own colour, a painted plinth); default `render` */
  renderTint?: (x: number, y: number, z: number) => number;
  /** heights where the render's cells are split (the top of a painted plinth) */
  renderSplit?: number[];
  /** positions along the run where the render's cells are split (party lines, where one house's paint stops) */
  renderSplitAlong?: number[];
  /** how far the room-face plaster stops short of the run's ends (default: the wall's thickness) */
  inset?: number;
  /** no plaster at all (a garden or outbuilding wall seen from both sides) */
  bare?: boolean;
  /** Flemish headers fired darker (the grey-blue header ends of a Victorian facing) */
  burnt?: boolean;
  /** run-off stains below these sills (u range along the wall, sill height) */
  stains?: { u: Range; y: number }[];
  /** height of the ground at the wall's foot (splash dirt above it); default the wall base */
  foot?: number;
  /** lintels over openings built into the courses (stone or concrete units bearing 110 mm each side), so the member
      over an opening needs no separate lintel piece */
  heads?: Head[];
  /** the run's plan axis; without it each member's longer side is taken (wrong for a pier narrower than the wall is
      thick, such as the columns beside a service patch) */
  axis?: 'x' | 'z';
}

export interface Head { u: Range; y: number; h?: number; mat?: MaterialId; tint?: number }

/** heads for the openings of a wallRun (built without `lintel`) */
export function headsOf(ops: Opening[], y0: number, o: { mat?: MaterialId; tint?: number; h?: number } = {}): Head[] {
  return ops.map((q) => ({ u: [q.c - q.w / 2, q.c + q.w / 2] as Range, y: y0 + q.y0 + q.h, h: o.h ?? 0.15, mat: o.mat ?? 'stone', tint: o.tint ?? 0xe6dcc6 }));
}

/* a unit box minus a zone box, as up to six boxes outside it (along u, then y, then t) */
function subtract(u: PieceSpec, zl: number[], zh: number[]): PieceSpec[] {
  const lo = u.pos.map((v, i) => v - u.size[i] / 2), hi = u.pos.map((v, i) => v + u.size[i] / 2);
  if ([0, 1, 2].some((k) => hi[k] <= zl[k] + 1e-6 || lo[k] >= zh[k] - 1e-6)) return [u];
  const out: PieceSpec[] = [];
  const cur = { lo: [...lo], hi: [...hi] };
  for (const k of [0, 2, 1]) {
    if (cur.lo[k] < zl[k] - 1e-6) { const l = [...cur.lo], h = [...cur.hi]; h[k] = zl[k]; out.push(boxLike(u, l, h)); cur.lo[k] = zl[k]; }
    if (cur.hi[k] > zh[k] + 1e-6) { const l = [...cur.lo], h = [...cur.hi]; l[k] = zh[k]; out.push(boxLike(u, l, h)); cur.hi[k] = zh[k]; }
  }
  return out.filter((q) => Math.min(...q.size) >= 0.012);
}
function boxLike(u: PieceSpec, lo: number[], hi: number[]): PieceSpec {
  const q = block(u.mat, [lo[0], hi[0]], [lo[1], hi[1]], [lo[2], hi[2]]);
  if (u.tint !== undefined) q.tint = u.tint;
  if (u.layer !== undefined) q.layer = u.layer;
  return q;
}

const PL = 0.0115;

/* a skin over the whole face of a member in near-square cells of about `step`, fitted to its edges so no strip of
   the brick behind shows at the member's ends, head or foot; `splits` are heights where a row of cells must end */
function tiles(s: Slab, T: Range, mat: MaterialId, step: number, tint: number, splits: number[] = [], along: number[] = [], jitter = false): PieceSpec[] {
  const out: PieceSpec[] = [];
  const bands = (r: Range, at: number[]): Range[] => {
    const c = [r[0], ...at.filter((y) => y > r[0] + 0.05 && y < r[1] - 0.05).sort((a, b) => a - b), r[1]], o: Range[] = [];
    for (let k = 0; k + 1 < c.length; k++) o.push([c[k], c[k + 1]]);
    return o;
  };
  const even = (r: Range): Range[] => {
    const n = Math.max(1, Math.round((r[1] - r[0]) / step)), w = (r[1] - r[0]) / n;
    return Array.from({ length: n }, (_, i) => [r[0] + i * w, r[0] + (i + 1) * w] as Range);
  };
  /* a jittered row: cell widths 0.7-1.3 × step, so the skin's joints do not line up course to course and no two
     neighbouring cells are the same size (a flat skin cell draws its texture scaled to the cell) */
  const ragged = (r: Range, row: number): Range[] => {
    const o: Range[] = [];
    let a = r[0];
    for (let k = 0; r[1] - a > 1.35 * step; k++) { const w = step * (0.7 + 0.6 * hash3(row, k, r[0], 29)); o.push([a, a + w]); a += w; }
    if (r[1] - a > 0.9 * step || !o.length) o.push([a, r[1]]);
    else { const last = o.pop()!, m = (last[0] + r[1]) / 2; o.push([last[0], m], [m, r[1]]); }
    return o;
  };
  for (const V of bands(s.V, splits)) for (const [j, v] of even(V).entries()) for (const U of bands(s.U, along)) {
    for (const u of jitter ? ragged(U, Math.round(v[0] * 100) + j) : even(U)) {
      const q = s.u === 0 ? block(mat, u, v, T) : block(mat, T, v, u);
      q.tint = tint;
      out.push(q);
    }
  }
  return out;
}

/* painted render weathers as a whole wall, not cell by cell: a faint, slow variation over metres (so neighbouring
   cells differ by a percent or so and their edges do not show) and a soft darkening toward the foot */
function renderShade(x: number, y: number, z: number, foot: number): number {
  const slow = 0.02 * Math.sin(x * 0.83 + z * 0.61 + 1.3) * Math.cos(y * 0.57 - 0.4) + 0.01 * Math.sin(x * 1.7 - z * 1.3 + y * 1.1);
  return (1 + slow) * (1 - 0.1 * Math.exp(-Math.max(0, y - foot) / 0.35));
}

/** Give the brick members of one wallRun their units: solid brick in bond with lime plaster on the room face(s) and,
    optionally, render outside. `out` is the weather side along the wall's thickness axis. Every brick is fired a
    little differently; the foot of the wall and the brick under each sill are dirtier. Plaster and render are laid as
    thin skins that crumble rather than fly as sheets. */
export function lime(ps: PieceSpec[], out: 1 | -1, o: LimeOpts = {}): PieceSpec[] {
  // plaster stops a wall's thickness short of the run's ends, where the cross walls it meets begin
  let lo = Infinity, hi = -Infinity, base = Infinity;
  for (const p of ps) {
    if (p.mat !== 'brick') continue;
    const k = o.axis ? (o.axis === 'x' ? 0 : 2) : p.size[0] >= p.size[2] ? 0 : 2;
    lo = Math.min(lo, p.pos[k] - p.size[k] / 2); hi = Math.max(hi, p.pos[k] + p.size[k] / 2); base = Math.min(base, p.pos[1] - p.size[1] / 2);
  }
  const foot = o.foot ?? base;
  return ps.map((p) => {
    if (p.mat !== 'brick' || p.detail || p.parts || (p.shape && p.shape !== 'box') || p.util || p.fixture) return p;
    const [sx, sy, sz] = p.size, alongX = o.axis ? o.axis === 'x' : sx >= sz, T = alongX ? sz : sx;
    if (T < 0.09 || T > 0.62 || sy < 0.2) return p;
    const r = (k: number): Range => [p.pos[k] - p.size[k] / 2, p.pos[k] + p.size[k] / 2];
    const s = wallSlab(alongX ? 'x' : 'z', r(alongX ? 0 : 2), r(1), r(alongX ? 2 : 0), out);
    const rin = o.bare ? 0 : T > 0.2 || o.both ? PL : 0, rout = o.bare ? 0 : o.both ? PL : o.render !== undefined ? PL : 0;
    const bandT = (depth: number, th: number): Range => (s.out > 0 ? [s.T[1] - depth - th, s.T[1] - depth] : [s.T[0] + depth, s.T[0] + depth + th]);
    const bt = T - rin - rout;
    const kind = bt < 0.18 ? 'stretcher' : o.bond ?? 'flemish';
    const bricks = masonry(s, bandT(rout, bt), { mat: 'brick', tint: p.tint, unit: [BRICK[0], BRICK[1], kind === 'stretcher' ? bt : (bt - 0.01) / 2], joint: 0.01, kind });
    const uk = alongX ? 0 : 2, base0 = p.tint ?? 0xa85a44;
    for (const u of bricks) {
      let k = 1;
      const y = u.pos[1], uu = u.pos[uk], len = u.size[uk];
      if (o.burnt && kind === 'flemish' && len < 0.13 && u.size[alongX ? 2 : 0] > 0.15) k *= 0.72;
      if (y < foot + 0.6) k *= 0.62 + 0.38 * Math.max(0, (y - foot) / 0.6) ** 1.5;
      if (hash3(u.pos[0], u.pos[1], u.pos[2], 21) < 0.05) k *= 0.72;
      for (const st of o.stains ?? []) {
        // run-off from the sill: two streaks under its ends, darkest just below it and fading over 1.2 m
        const sw = st.u[1] - st.u[0], nearEnd = Math.min(Math.abs(uu - (st.u[0] + 0.12 * sw)), Math.abs(uu - (st.u[1] - 0.12 * sw)));
        if (y < st.y && y > st.y - 1.2 && nearEnd < 0.16) k *= 0.6 + 0.4 * ((st.y - y) / 1.2) ** 0.8;
      }
      u.tint = shadeTint(vary(base0, u, 0.24, 11), k);
    }
    let d: PieceSpec[] = bricks;
    const brickT = bandT(rout, bt);
    for (const hd of o.heads ?? []) {
      const zu: Range = [Math.max(hd.u[0] - 0.11, s.U[0]), Math.min(hd.u[1] + 0.11, s.U[1])], zy: Range = [Math.max(hd.y, s.V[0]), Math.min(hd.y + (hd.h ?? 0.15), s.V[1])];
      if (zu[1] - zu[0] < 0.02 || zy[1] - zy[0] < 0.02) continue;
      const zl = [0, 0, 0], zh = [0, 0, 0];
      zl[uk] = zu[0]; zh[uk] = zu[1]; zl[1] = zy[0]; zh[1] = zy[1];
      const tk = alongX ? 2 : 0; zl[tk] = brickT[0]; zh[tk] = brickT[1];
      d = d.flatMap((u) => subtract(u, zl, zh));
      const st = block(hd.mat ?? 'stone', [zl[0], zh[0]], [zl[1], zh[1]], [zl[2], zh[2]]);
      st.tint = hd.tint ?? 0xe6dcc6;
      d.push(st);
    }
    const renderAt = (u: PieceSpec) => shadeTint(o.renderTint?.(u.pos[0], u.pos[1], u.pos[2]) ?? o.render!, renderShade(u.pos[0], u.pos[1], u.pos[2], foot));
    if (o.render !== undefined) {
      /* the reveals of openings: where this member's end is not the run's end and no other member of the run abuts it,
         the render is returned into the opening over the brick's thickness (the bricks there are cut back for it) */
      const tk = alongX ? 2 : 0;
      for (const [end, at] of [[0, s.U[0]], [1, s.U[1]]] as const) {
        if (at < lo + 1e-3 || at > hi - 1e-3) continue;
        const covered: Range[] = [];
        for (const q of ps) {
          if (q === p || q.mat !== 'brick') continue;
          const qa = q.pos[uk] - q.size[uk] / 2, qb = q.pos[uk] + q.size[uk] / 2;
          if (Math.abs((end === 0 ? qb : qa) - at) < 1e-3) covered.push([q.pos[1] - q.size[1] / 2, q.pos[1] + q.size[1] / 2]);
        }
        let open: Range[] = [[s.V[0], s.V[1]]];
        for (const c of covered) open = open.flatMap(([a, b]) => ([[a, Math.min(b, c[0])], [Math.max(a, c[1]), b]] as Range[]).filter(([x, y]) => y - x > 0.05));
        for (const v of open) {
          const zu: Range = end === 0 ? [at, at + PL] : [at - PL, at];
          const zl = [0, 0, 0], zh = [0, 0, 0];
          zl[uk] = zu[0]; zh[uk] = zu[1]; zl[1] = v[0]; zh[1] = v[1]; zl[tk] = brickT[0]; zh[tk] = brickT[1];
          d = d.flatMap((u) => subtract(u, zl, zh));
          const nv = Math.max(1, Math.round((v[1] - v[0]) / 0.6)), dv = (v[1] - v[0]) / nv;
          for (let j = 0; j < nv; j++) {
            const q = block('plaster', [zl[0], zh[0]], [v[0] + j * dv, v[0] + (j + 1) * dv], [zl[2], zh[2]]);
            q.tint = renderAt(q);
            d.push(q);
          }
        }
      }
    }
    const inset = o.inset ?? T, U: Range = [Math.max(s.U[0], lo + inset), Math.min(s.U[1], hi - inset)];
    if (rin && U[1] - U[0] > 0.05) d.push(...tiles({ ...s, U }, bandT(T - rin, rin), 'plaster', 0.6, o.plaster ?? 0xeee7da));
    if (rout) {
      // painted render (plaster cells tinted by a slow whole-wall variation), or a plaster skin
      const skin = tiles(s, bandT(0, rout), 'plaster', 0.6, o.render ?? o.plaster ?? 0xeee7da, o.render !== undefined ? o.renderSplit : [], o.render !== undefined ? o.renderSplitAlong : [], o.render !== undefined);
      if (o.render !== undefined) for (const u of skin) u.tint = renderAt(u);
      d.push(...skin);
    }
    const q = layered('brick', s, d, { tint: p.tint });
    return { ...p, detail: q.detail, density: q.density };
  });
}

/** Stains for the windows of a wallRun (openings above the floor), for LimeOpts.stains. */
export function sillStains(ops: Opening[], y0: number): { u: Range; y: number }[] {
  return ops.filter((q) => q.y0 > 0.3).map((q) => ({ u: [q.c - q.w / 2, q.c + q.w / 2] as Range, y: y0 + q.y0 - 0.08 }));
}

/** Split the brick member of a wallRun that contains the point (u, y) round a small square patch (half-size h) where a
    service will be sleeved through: the grid's sleeve cuts only the patch and consumes it whole, so the courses of the
    wall round it stay intact. Run before lime(). */
export function servicePatch(ps: PieceSpec[], u: number, y: number, h = 0.085): PieceSpec[] {
  const out: PieceSpec[] = [];
  let done = false;
  for (const p of ps) {
    const alongX = p.size[0] >= p.size[2], k = alongX ? 0 : 2;
    const ul = p.pos[k] - p.size[k] / 2, uh = p.pos[k] + p.size[k] / 2, yl = p.pos[1] - p.size[1] / 2, yh = p.pos[1] + p.size[1] / 2;
    if (done || p.mat !== 'brick' || p.detail || (p.shape && p.shape !== 'box') || u - h < ul + 0.06 || u + h > uh - 0.06 || y - h < yl + 0.06 || y + h > yh - 0.06) { out.push(p); continue; }
    done = true;
    const t = alongX ? [p.pos[2] - p.size[2] / 2, p.pos[2] + p.size[2] / 2] as Range : [p.pos[0] - p.size[0] / 2, p.pos[0] + p.size[0] / 2] as Range;
    const mk = (a: Range, b: Range): PieceSpec => {
      const q = alongX ? block(p.mat, a, b, t) : block(p.mat, t, b, a);
      return { ...p, size: q.size, pos: q.pos };
    };
    out.push(mk([ul, u - h], [yl, yh]), mk([u + h, uh], [yl, yh]), mk([u - h, u + h], [yl, y - h]), mk([u - h, u + h], [y + h, yh]));
    out.push({ ...mk([u - h, u + h], [y - h, y + h]), detail: [] });
  }
  if (!done) throw new Error(`servicePatch: no brick member contains ${u.toFixed(2)}, ${y.toFixed(2)}`);
  return out;
}

/** Face a box member (a timber pub-front pier, a stall riser) with a moulded frame and sunk panels on its `out` side:
    a core, stiles and rails standing proud by `relief`, and the panels recessed between them. */
export function panelled(p: PieceSpec, axis: 'x' | 'z', out: 1 | -1, o: { cols?: number; rails?: number; tint?: number; panelTint?: number; relief?: number; frame?: number } = {}): PieceSpec {
  if (p.detail || (p.shape && p.shape !== 'box')) return p;
  const k = axis === 'x' ? 0 : 2, tk = axis === 'x' ? 2 : 0;
  const U: Range = [p.pos[k] - p.size[k] / 2, p.pos[k] + p.size[k] / 2], Y: Range = [p.pos[1] - p.size[1] / 2, p.pos[1] + p.size[1] / 2];
  const T: Range = [p.pos[tk] - p.size[tk] / 2, p.pos[tk] + p.size[tk] / 2];
  const rel = o.relief ?? 0.02, fw = Math.min(o.frame ?? 0.09, (U[1] - U[0]) / 4, (Y[1] - Y[0]) / 4);
  const face: Range = out > 0 ? [T[1] - rel, T[1]] : [T[0], T[0] + rel], coreT: Range = out > 0 ? [T[0], T[1] - rel] : [T[0] + rel, T[1]];
  const sunk: Range = out > 0 ? [T[1] - rel, T[1] - rel * 0.6] : [T[0] + rel * 0.6, T[0] + rel];
  const cell = (u: Range, y: Range, t: Range, tint: number | undefined) => {
    const q = axis === 'x' ? block(p.mat, u, y, t) : block(p.mat, t, y, u);
    if (tint !== undefined) q.tint = tint;
    q.finish = p.finish ?? 'joinery';
    return q;
  };
  const tint = o.tint ?? p.tint, pt = o.panelTint ?? (tint !== undefined ? shadeTint(tint, 0.82) : undefined);
  const d: PieceSpec[] = [cell(U, Y, coreT, tint)];
  const cols = Math.max(1, o.cols ?? Math.round((U[1] - U[0]) / 0.7)), rows = Math.max(1, o.rails ?? 1);
  const cw = (U[1] - U[0] - fw) / cols, rh = (Y[1] - Y[0] - fw) / rows;
  // stiles and rails of the frame
  for (let i = 0; i <= cols; i++) d.push(cell([U[0] + i * cw, U[0] + i * cw + fw], Y, face, tint));
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) d.push(cell([U[0] + i * cw + fw, U[0] + (i + 1) * cw], [Y[0] + j * rh, Y[0] + j * rh + fw], face, tint));
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) d.push(cell([U[0] + i * cw + fw, U[0] + (i + 1) * cw], [Y[0] + j * rh + fw, Y[0] + (j + 1) * rh], sunk, pt));
  return inset(withDetail({ ...p }, d));
}

/* ---------------- oriented panes (canted bay lights) ---------------- */

/** A thin glazed light standing on the plan segment a→b (its outer face on the segment, `t` thick toward `inward`),
    from y[0] to y[1]: an oriented box with its frame, transom and lites as oriented detail units. */
export function cantedLight(a: [number, number], b: [number, number], y: Range, t: number, inward: 1 | -1, o: { tint?: number; transom?: number } = {}): PieceSpec {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  const nx = -uz * inward, nz = ux * inward;   // into the bay
  const box = (u: Range, yy: Range, v: Range, mat: 'glass' | 'wood', tint?: number, finish?: PieceSpec['finish']): PieceSpec => {
    const pts: Vec3[] = [];
    for (const uu of u) for (const w of v) for (const h of yy) pts.push([a[0] + ux * uu + nx * w, h, a[1] + uz * uu + nz * w]);
    const q = hull(mat, pts);
    if (tint !== undefined) q.tint = tint;
    if (finish) q.finish = finish;
    return q;
  };
  const p = box([0, L], y, [0, t], 'glass', undefined, 'smoked');
  const fw = 0.055, wood = o.tint ?? PAINT.white, tr = y[0] + (o.transom ?? 0.72) * (y[1] - y[0]), tm = t / 2;
  const d: PieceSpec[] = [
    box([0, fw], y, [0, t], 'wood', wood, 'joinery'), box([L - fw, L], y, [0, t], 'wood', wood, 'joinery'),
    box([fw, L - fw], [y[0], y[0] + 0.075], [0, t], 'wood', wood, 'joinery'), box([fw, L - fw], [y[1] - fw, y[1]], [0, t], 'wood', wood, 'joinery'),
    box([fw, L - fw], [tr - 0.022, tr + 0.022], [0, t], 'wood', wood, 'joinery'),
    box([fw, L - fw], [y[0] + 0.075, tr - 0.022], [tm - 0.003, tm + 0.003], 'glass', undefined, 'smoked'),
    box([fw, L - fw], [tr + 0.022, y[1] - fw], [tm - 0.003, tm + 0.003], 'glass', undefined, 'smoked'),
  ];
  return withDetail(p, d);
}

/* ---------------- shopfront ---------------- */

export interface ShopfrontOpts {
  /** the structural opening in the front wall (glassless, spanned by a bressummer) and its head */
  u: Range;
  head: number;
  /** outer face of the front wall and its thickness */
  face: number;
  t: number;
  /** top of the fascia and cornice */
  fasciaTop: number;
  door: 'lo' | 'hi';
  doorW?: number;
  tint: number;
  fascia?: number;
  riser?: number;
  /** sign-writing on the fascia, and its colour */
  sign?: string;
  signTint?: number;
}

/** Traditional timber shopfront in a wall opening: a panelled stall riser, a display window with transom lights,
    a door post and a half-glazed door with a top light, pilasters (plinth, sunk shaft, capital) with scrolled console
    brackets on the piers either side, and a sign-written fascia board under a moulded cornice with the blind box. */
export function shopfront(o: ShopfrontOpts): PieceSpec[] {
  const Z = o.face, zi = Z - o.t, dw = o.doorW ?? 0.95, pw = 0.1, rh = o.riser ?? 0.5;
  const du: Range = o.door === 'lo' ? [o.u[0], o.u[0] + dw] : [o.u[1] - dw, o.u[1]];
  const post: Range = o.door === 'lo' ? [du[1], du[1] + pw] : [du[0] - pw, du[0]];
  const win: Range = o.door === 'lo' ? [post[1], o.u[1]] : [o.u[0], post[0]];
  const j: PieceOpts = { tint: o.tint, finish: 'joinery' };
  const nb = Math.max(2, Math.round((win[1] - win[0]) / 0.9));
  const top = o.fasciaTop, h = o.head, fz = Z + 0.12;
  const ps: PieceSpec[] = [
    block('wood', post, [0, h - 0.03], [zi + 0.03, Z - 0.03], j),
    panelled(block('wood', win, [0, rh], [zi + 0.05, Z - 0.02], j), 'x', 1, { cols: nb, relief: 0.018 }),
    glaze(block('tempered', win, [rh, h - 0.03], [Z - 0.12, Z - 0.06]), { rails: [0.8], bars: nb, tint: o.tint, frame: 0.07, bottom: 0.09, barW: 0.04 }),
    door('x', du, [0, h], [zi, Z], 1, { tint: o.tint, fan: 0.5, glazed: 0.55, panels: 2 }),
  ];
  for (const [a, b] of [[o.u[0] - 0.3, o.u[0] - 0.02], [o.u[1] + 0.02, o.u[1] + 0.3]] as Range[]) {
    // pilaster: one member, its plinth, sunk-panelled shaft and capital as detail
    const c = (x: Range, y: Range, z: Range, t = o.tint) => block('wood', x, y, z, { tint: t, finish: 'joinery' });
    ps.push(pilasterPiece(a, b, h, Z, o.tint));
    // console bracket: a scroll that swells from the pilaster capital to the cornice
    const cons = block('wood', [a, b], [h, top - 0.14], [Z, Z + 0.24], j);
    const H = top - 0.14 - h, steps = 5, cd: PieceSpec[] = [];
    for (let i = 0; i < steps; i++) {
      const y0 = h + (i * H) / steps, y1 = h + ((i + 1) * H) / steps, dz = 0.1 + (0.14 * (i + 1)) / steps;
      cd.push(c([a, b], [y0, y1], [Z, Z + dz]));
    }
    cd.push(c([a + 0.03, b - 0.03], [h + H * 0.2, h + H * 0.6], [Z + 0.215, Z + 0.24], shadeTint(o.tint, 0.85)));
    ps.push(withDetail(cons, cd));
  }
  // fascia board (sign-written) and the cornice with the blind box over it
  const board = block('wood', [o.u[0], o.u[1]], [h, top - 0.14], [Z, fz], { tint: o.fascia ?? o.tint, finish: 'joinery' });
  const face: SignFace = { axis: 'x', at: fz, out: 1, u: [o.u[0] + 0.2, o.u[1] - 0.2], y: [h + 0.08, top - 0.22] };
  ps.push(...(o.sign ? inscribe([board], letters(o.sign, face, o.signTint ?? 0xe8c872), [face]) : [board]));
  ps.push(extrude('wood', [[Z, top - 0.14], [Z + 0.3, top - 0.14], [Z + 0.34, top - 0.08], [Z + 0.34, top], [Z, top]], 'x', [o.u[0] - 0.32, o.u[1] + 0.32],
    { tint: o.tint, finish: 'joinery' }));
  return ps;
}

/** One brick wallRun as built: openings with their lintels in the courses, service patches, dressed glazing, and
    its courses (lime) with run-off stains under the sills. A steel lintel stays a member of its own. */
export function brickRun(w: WallRunOpts, out: 1 | -1, o: LimeOpts & { patches?: [number, number][]; dress?: (p: PieceSpec) => PieceSpec } = {}): PieceSpec[] {
  /* windows: the opening is 30 mm taller than the frame, so the wall over it bears on the piers (and its built-in
     lintel), never on the glazing */
  const src = w.openings ?? [];
  const ops = src.map((q) => ((q.glass ?? q.y0 > 0) && q.y0 + q.h + 0.03 < w.h - 0.08 ? { ...q, h: q.h + 0.03 } : q));
  const built = w.lintel && w.lintel !== 'steel';
  const heads = built ? headsOf(ops, w.y0, { mat: w.lintel === 'rconcrete' ? 'rconcrete' : 'stone', tint: w.lintel === 'rconcrete' ? 0xbdb8ad : 0xe6dcc6 }) : [];
  let q = wallRun(built ? { ...w, openings: ops, lintel: undefined } : { ...w, openings: ops });
  const grown = ops.filter((x, i) => x !== src[i]);
  q = q.map((p) => {
    if (p.mat !== 'glass' && p.mat !== 'tempered') return p;
    const k = p.size[0] >= p.size[2] ? 0 : 2, c = p.pos[k], top = p.pos[1] + p.size[1] / 2;
    const g = grown.find((x) => Math.abs(c - x.c) < x.w / 2 && Math.abs(w.y0 + x.y0 + x.h - top) < 0.01);
    return g ? { ...p, size: [p.size[0], p.size[1] - 0.03, p.size[2]], pos: [p.pos[0], p.pos[1] - 0.015, p.pos[2]] } : p;
  });
  for (const [u, y] of o.patches ?? []) q = servicePatch(q, u, y);
  if (o.dress) q = glazeAll(q, o.dress);
  return lime(q, out, { stains: sillStains(src, w.y0), foot: 0, axis: w.axis ?? 'x', ...o, heads: [...heads, ...(o.heads ?? [])] });
}

/** Bond members that are built as one (a chimney breast and the wall it is corbelled from): one compound body with
    all their units, standing and falling together. */
export function bond(ps: PieceSpec[]): PieceSpec {
  let mass = 0, vol = 0;
  for (const p of ps) { const v = p.size[0] * p.size[1] * p.size[2]; vol += v; mass += v * (p.density ?? 1900); }
  const q = weldParts(ps.map((p) => { const { detail: _d, density: _e, ...r } = p; return r; }));
  return { ...q, detail: ps.flatMap((p) => p.detail ?? []), density: Math.round((mass / vol) * 1000) / 1000 };
}

/** A Victorian timber floor or ceiling as the units of one member (a box spanning between its walls): 150 × 22 mm
    softwood boards across 50 × 200 mm joists at 400 centres spanning `span`, and a lath-and-plaster ceiling under them
    laid as thin skins that crumble rather than fly as boards. */
export function timberDeck(p: PieceSpec, o: { span: 'x' | 'z'; boards?: boolean; ceiling?: boolean; tint?: number }): PieceSpec {
  const r = (k: number): Range => [p.pos[k] - p.size[k] / 2, p.pos[k] + p.size[k] / 2];
  const X = r(0), Y = r(1), Z = r(2), sk = o.span === 'x' ? 0 : 2, ck = o.span === 'x' ? 2 : 0;
  const S = sk === 0 ? X : Z, C = ck === 0 ? X : Z;
  const bt = o.boards === false ? 0 : 0.022, pl = o.ceiling === false ? 0 : 0.0115;
  const cell = (s0: Range, c0: Range, y: Range, mat: PieceSpec['mat'], tint: number): PieceSpec => {
    const q = sk === 0 ? block(mat, s0, y, c0) : block(mat, c0, y, s0);
    q.tint = tint;
    return q;
  };
  const d: PieceSpec[] = [];
  const jy: Range = [Y[0] + pl, Y[1] - bt];
  for (let c = C[0] + 0.03; c + 0.05 <= C[1] - 0.01; c += 0.4) d.push(cell(S, [c, c + 0.05], jy, 'wood', 0xb89b72));
  if (bt) {
    // boards run across the joists, 150 mm wide, in lengths of up to 3.6 m
    for (let s0 = S[0]; s0 < S[1] - 0.02; s0 += 0.15) {
      const sr: Range = [s0 + 0.001, Math.min(s0 + 0.15, S[1]) - 0.001];
      for (let c = C[0]; c < C[1] - 0.02; c += 3.6) {
        const u = cell(sr, [c + 0.001, Math.min(c + 3.6, C[1]) - 0.001], [Y[1] - bt, Y[1]], 'wood', 0);
        u.tint = vary(o.tint ?? 0x9a7a58, u, 0.2, 31);
        d.push(u);
      }
    }
  }
  if (pl) for (let s0 = S[0]; s0 < S[1] - 0.02; s0 += 0.6) for (let c = C[0]; c < C[1] - 0.02; c += 0.6) {
    d.push(cell([s0, Math.min(s0 + 0.6, S[1])], [c, Math.min(c + 0.6, C[1])], [Y[0], Y[0] + pl], 'plaster', 0xf1ece2));
  }
  return withDetail({ ...p }, d);
}

/** Pilaster on a pier face at z = Z (one member): a plinth, a shaft with a sunk panel lined out in gilt, and a
    moulded capital, as units. */
export function pilasterPiece(a: number, b: number, h: number, Z: number, tint: number, gilt?: number): PieceSpec {
  const c = (x: Range, y: Range, z: Range, t = tint) => block('wood', x, y, z, { tint: t, finish: 'joinery' });
  const p = c([a - 0.02, b + 0.02], [0, h], [Z, Z + 0.12]);
  const d = [
    c([a - 0.02, b + 0.02], [0, 0.35], [Z, Z + 0.12]), c([a, b], [0.35, h - 0.2], [Z, Z + 0.08]),
    c([a, a + 0.05], [0.4, h - 0.25], [Z + 0.08, Z + 0.1]), c([b - 0.05, b], [0.4, h - 0.25], [Z + 0.08, Z + 0.1]),
    c([a + 0.05, b - 0.05], [0.4, h - 0.25], [Z + 0.08, Z + 0.086], shadeTint(tint, 0.8)),
    c([a - 0.02, b + 0.02], [h - 0.2, h - 0.12], [Z, Z + 0.1]), c([a - 0.02, b + 0.02], [h - 0.12, h], [Z, Z + 0.12]),
  ];
  if (gilt !== undefined) d.push(c([a + 0.07, b - 0.07], [0.44, 0.46], [Z + 0.086, Z + 0.09], gilt), c([a + 0.07, b - 0.07], [h - 0.31, h - 0.29], [Z + 0.086, Z + 0.09], gilt));
  return inset(withDetail(p, d));
}
