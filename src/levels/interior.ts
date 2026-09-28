import type { MaterialId, PieceSpec, Vec3 } from '../types.ts';
import { block, carton, cyl, duvet, extrude, flight, hull, place, raise, splitRange, strut, swapXZ, type Opening, type PieceOpts, type Range } from './kit.ts';

/* Construction systems and interiors. Frames are real members (plates, studs, noggins, joists, rafters) welded
   face to face; furniture is loose (noWeld) and rests on the floor it stands on, so a tilting floor sheds it;
   built-in fittings (kitchen runs, sanitaryware, counters, racking) weld to the floor or wall they are fixed to. */

export const FURN = {
  oak: 0x8a6a4a, pine: 0xc9b596, white: 0xeeebe4, fabric: 0x5f6f7f, red: 0x8e4a3f, green: 0x5d7258, grey: 0x8d949b,
  ply: 0xd8c7a4, plaster: 0xf1ece2, board: 0xe9e4da, laminate: 0xb9a489, tile: 0xe6e3dc, slate: 0x5f656e, steel: 0x6d7479,
};

const loose = (o: PieceOpts): PieceOpts => ({ ...o, noWeld: true });
/* 0.06 m members and sheets: at 0.05 a flush contact sits exactly on the core's 0.05 m weld-overlap threshold */
export const LIN = 0.06;

/* ---------------- timber stud walls ---------------- */

export interface Lining { mat?: MaterialId; tint?: number; from?: number; to?: number }

export interface StudWallOpts extends PieceOpts {
  axis?: 'x' | 'z';
  from: number;
  to: number;
  /** centre line of the studs on the thickness axis */
  at: number;
  y0: number;
  h: number;
  /** stud depth (wall thickness without linings) */
  t?: number;
  pitch?: number;
  openings?: Opening[];
  /** plasterboard on the -side / +side of the studs */
  liningNeg?: Lining | null;
  liningPos?: Lining | null;
  /** lining sheets span only this part of the run (so they stop at crossing walls) */
  liningFrom?: number;
  liningTo?: number;
  noggins?: boolean;
  frame?: MaterialId;
}

/* Platform-frame wall: sole and top plates, studs at `pitch`, a noggin row, king studs, a solid header over each
   opening and a sill trimmer on a cripple under each window; lining sheets are cut round the openings. */
export function studWall(w: StudWallOpts): PieceSpec[] {
  const t = w.t ?? 0.1, pl = 0.06, sw = 0.06, pitch = w.pitch ?? 0.6, fm = w.frame ?? 'wood';
  const o: PieceOpts = { tint: w.tint ?? FURN.pine, group: w.group, protected: w.protected };
  const v: Range = [w.at - t / 2, w.at + t / 2];
  const y0 = w.y0, y1 = w.y0 + w.h, sy: Range = [y0 + pl, y1 - pl];
  const ps: PieceSpec[] = [];
  for (const u of splitRange(w.from, w.to, 4.8)) ps.push(block(fm, u, [y0, y0 + pl], v, o), block(fm, u, [y1 - pl, y1], v, o));
  const ops = [...(w.openings ?? [])].sort((a, b) => a.c - b.c);
  const inOp = (a: number, b: number) => ops.find((op) => b > op.c - op.w / 2 - 1e-6 && a < op.c + op.w / 2 + 1e-6);
  const studs: number[] = [];
  const addStud = (c: number) => { if (!studs.some((s) => Math.abs(s - c) < sw - 1e-6)) studs.push(c); };
  for (const op of ops) { addStud(op.c - op.w / 2 - sw / 2); addStud(op.c + op.w / 2 + sw / 2); }
  addStud(w.from + sw / 2);
  addStud(w.to - sw / 2);
  for (let c = w.from + pitch; c < w.to - sw; c += pitch) if (!inOp(c - sw / 2, c + sw / 2)) addStud(c);
  studs.sort((a, b) => a - b);
  for (const c of studs) ps.push(block(fm, [c - sw / 2, c + sw / 2], sy, v, o));
  const nogY: Range = [y0 + w.h / 2 - 0.03, y0 + w.h / 2 + 0.03];
  for (let i = 0; i + 1 < studs.length; i++) {
    const a = studs[i] + sw / 2, b = studs[i + 1] - sw / 2;
    if (b - a < 0.1 || inOp(a, b) || w.noggins === false) continue;
    ps.push(block(fm, [a, b], nogY, v, o));
  }
  for (const op of ops) {
    const u: Range = [op.c - op.w / 2, op.c + op.w / 2];
    const top = y0 + op.y0 + op.h;
    if (top < y1 - pl - 0.04) ps.push(block(fm, u, [top, y1 - pl], v, o));
    if (op.y0 > pl + 0.1) {
      ps.push(block(fm, u, [y0 + op.y0 - 0.06, y0 + op.y0], v, o));
      ps.push(block(fm, [op.c - sw / 2, op.c + sw / 2], [y0 + pl, y0 + op.y0 - 0.06], v, o));
    }
    if (op.glass ?? op.y0 > 0) ps.push(block('glass', u, [y0 + op.y0, top], [w.at - 0.03, w.at + 0.03], { group: w.group, protected: w.protected }));
  }
  for (const [side, L] of [[-1, w.liningNeg], [1, w.liningPos]] as const) {
    if (!L) continue;
    const lf = L.from ?? w.liningFrom ?? w.from, lt = L.to ?? w.liningTo ?? w.to;
    const lv: Range = side < 0 ? [v[0] - LIN, v[0]] : [v[1], v[1] + LIN];
    const lo: PieceOpts = { tint: L.tint ?? FURN.plaster, group: w.group, protected: w.protected };
    const lm = L.mat ?? 'drywall';
    let cursor = lf;
    const sheet = (a: number, b: number, y: Range) => {
      for (const u of splitRange(a, b, 1.2)) if (u[1] - u[0] > 0.06 && y[1] - y[0] > 0.06) ps.push(block(lm, u, y, lv, lo));
    };
    for (const op of ops) {
      const a = Math.max(lf, op.c - op.w / 2), b = Math.min(lt, op.c + op.w / 2);
      if (b <= a) continue;
      sheet(cursor, a, [y0, y1]);
      if (op.y0 > 0.06) sheet(a, b, [y0, y0 + op.y0]);
      sheet(a, b, [y0 + op.y0 + op.h, y1]);
      cursor = b;
    }
    sheet(cursor, lt, [y0, y1]);
  }
  return w.axis === 'z' ? swapXZ(ps) : ps;
}

/* ---------------- timber floors ---------------- */

export interface JoistFloorOpts extends PieceOpts {
  /** plan extent between the bearing faces; joists span along `span` */
  x: Range;
  z: Range;
  span: 'x' | 'z';
  /** top of the subfloor */
  y: number;
  depth?: number;
  pitch?: number;
  width?: number;
  deck?: { mat?: MaterialId; t?: number; tint?: number };
  /** plasterboard under the joists, over this plan extent (default the whole floor) */
  ceiling?: { mat?: MaterialId; tint?: number; x?: Range; z?: Range } | null;
  /** stair well: joists are cut short and a trimmer spans between the full-length joists either side */
  well?: { x: Range; z: Range };
  /** extend joist ends into the bearing walls (pocketed), at the low / high end */
  bear?: number | [number, number];
  /** subfloor sheet size */
  sheet?: number;
}

/* Joists on edge between two bearing walls, a subfloor on top and plasterboard under, with a trimmed well. */
export function joistFloor(f: JoistFloorOpts): PieceSpec[] {
  const d = f.depth ?? 0.2, jw = f.width ?? 0.075, pitch = f.pitch ?? 0.45, sheet = f.sheet ?? 2.4;
  const bear: [number, number] = typeof f.bear === 'number' ? [f.bear, f.bear] : f.bear ?? [0, 0];
  const dt = f.deck?.t ?? 0.06;
  const o: PieceOpts = { tint: f.tint ?? FURN.pine, group: f.group, protected: f.protected };
  // write for span along X, then mirror
  const sx = f.span === 'x';
  const sp: Range = sx ? f.x : f.z, cr: Range = sx ? f.z : f.x;
  const well = f.well ? (sx ? f.well : { x: f.well.z, z: f.well.x }) : null;
  const jy: Range = [f.y - dt - d, f.y - dt];
  const ps: PieceSpec[] = [];
  const pos: number[] = [];
  const n = Math.max(1, Math.round((cr[1] - cr[0] - jw) / pitch));
  for (let i = 0; i <= n; i++) pos.push(cr[0] + jw / 2 + (i * (cr[1] - cr[0] - jw)) / n);
  const full: Range = [sp[0] - bear[0], sp[1] + bear[1]];
  const trimmed = (c: number) => !!well && c + jw / 2 > well.z[0] && c - jw / 2 < well.z[1];
  for (const c of pos) {
    const cz: Range = [c - jw / 2, c + jw / 2];
    if (!trimmed(c)) { ps.push(block('wood', full, jy, cz, o)); continue; }
    if (well!.x[0] - jw - full[0] > 0.1) ps.push(block('wood', [full[0], well!.x[0] - jw], jy, cz, o));
    if (full[1] - well!.x[1] - jw > 0.1) ps.push(block('wood', [well!.x[1] + jw, full[1]], jy, cz, o));
  }
  if (well) {
    const outer = pos.filter((c) => !trimmed(c));
    const lo = Math.max(...outer.filter((c) => c < well.z[0]), cr[0] - 1), hi = Math.min(...outer.filter((c) => c > well.z[1]), cr[1] + 1);
    const tz: Range = [Math.max(cr[0], lo + jw / 2), Math.min(cr[1], hi - jw / 2)];
    for (const x of [well.x[0] - jw, well.x[1]]) if (x > full[0] && x + jw < full[1]) ps.push(block('wood', [x, x + jw], jy, tz, o));
  }
  const deckM = f.deck?.mat ?? 'plywood', deckO: PieceOpts = { tint: f.deck?.tint ?? FURN.ply, group: f.group, protected: f.protected };
  const cut = (y: Range, mat: MaterialId, oo: PieceOpts, a: Range = sp, b: Range = cr) => {
    for (const u of splitRange(a[0], a[1], sheet)) for (const w of splitRange(b[0], b[1], sheet)) {
      if (!well) { ps.push(block(mat, u, y, w, oo)); continue; }
      const add = (a: Range, b: Range) => { if (a[1] - a[0] >= 0.1 && b[1] - b[0] >= 0.1) ps.push(block(mat, a, y, b, oo)); };
      for (const a of subtract(u, well.x)) add(a, w);
      const mid: Range = [Math.max(u[0], well.x[0]), Math.min(u[1], well.x[1])];
      if (mid[1] - mid[0] > 1e-6) for (const b of subtract(w, well.z)) add(mid, b);
    }
  };
  cut([f.y - dt, f.y], deckM, deckO);
  if (f.ceiling) {
    const c = f.ceiling, cx = c.x ?? f.x, cz = c.z ?? f.z;
    cut([jy[0] - LIN, jy[0]], c.mat ?? 'drywall', { tint: c.tint ?? FURN.plaster, group: f.group, protected: f.protected }, sx ? cx : cz, sx ? cz : cx);
  }
  return sx ? ps : swapXZ(ps);
}

function subtract(r: Range, h: Range): Range[] {
  const out: Range[] = [];
  if (h[0] - r[0] > 1e-6) out.push([r[0], Math.min(r[1], h[0])]);
  if (r[1] - h[1] > 1e-6) out.push([Math.max(r[0], h[1]), r[1]]);
  if (h[1] <= r[0] || h[0] >= r[1]) return [r];
  return out.filter((q) => q[1] - q[0] > 1e-6);
}

/* ---------------- cut timber roof ---------------- */

export interface RafterRoofOpts extends PieceOpts {
  /** along the ridge: the roof covering's extent */
  x: Range;
  /** gable end walls: rafters and purlins run between their inner faces; each gets a sheathed gable triangle */
  gables: Range[];
  /** outer faces of the two eave walls */
  z: Range;
  /** top of the eave wall (under the wall plate) */
  y: number;
  rise: number;
  pitch?: number;
  covering?: { mat?: MaterialId; tint?: number };
  gableMat?: MaterialId;
  gableTint?: number;
  overhang?: number;
  purlins?: boolean;
  /** ceiling joists on the plates, with a plasterboard ceiling between the plates' inner faces (z), or none */
  ceiling?: { z: Range; tint?: number } | null;
}

/* Wall plates, a ridge board, rafters birdsmouthed onto the plates and plumb-cut against the ridge, purlins
   under mid-slope, battens across the rafters, a tiled covering on the battens and a ridge cap. Ceiling joists
   tie the feet of the rafters. */
export function rafterRoof(r: RafterRoofOpts): PieceSpec[] {
  const [z0, z1] = r.z, mid = (z0 + z1) / 2, half = (z1 - z0) / 2;
  const pw = 0.15, ph = 0.1, rd = 0.15, rw = 0.06, bt = 0.065, tt = 0.07, ov = r.overhang ?? 0.3, rb = 0.03;
  const y1 = r.y + ph, k = r.rise / half;
  const under = (u: number) => y1 + k * (half - u);
  const top = (u: number) => under(u) + rd;
  const o: PieceOpts = { tint: r.tint ?? FURN.pine, group: r.group, protected: r.protected };
  const g = [...r.gables].sort((a, b) => a[0] - b[0]);
  const inner: Range = [g[0][1], g[g.length - 1][0]];
  const ps: PieceSpec[] = [];
  const zz = (s: number, u: number) => mid + s * u;
  // plates on both eave walls
  for (const s of [-1, 1]) for (const u of splitRange(g[0][0], g[g.length - 1][1], 4.8)) {
    ps.push(block('wood', u, [r.y, y1], s > 0 ? [z1 - pw, z1] : [z0, z0 + pw], o));
  }
  // ridge board between the gables
  const ridgeTop = top(rb) + 0.04;
  for (const u of splitRange(inner[0], inner[1], 4.8)) ps.push(block('wood', u, [under(rb) - 0.06, ridgeTop], [mid - rb, mid + rb], o));
  // rafters
  const n = Math.max(1, Math.round((inner[1] - inner[0] - rw) / (r.pitch ?? 0.6)));
  const xs: number[] = [];
  for (let i = 0; i <= n; i++) xs.push(inner[0] + rw / 2 + (i * (inner[1] - inner[0] - rw)) / n);
  for (const s of [-1, 1]) {
    for (const x of xs) {
      const prof: [number, number][] = [[zz(s, rb), under(rb)], [zz(s, rb), top(rb)], [zz(s, half + ov), top(half + ov)], [zz(s, half + ov), under(half + ov)]];
      ps.push(extrude('wood', prof, 'x', [x - rw / 2, x + rw / 2], o));
    }
  }
  // ceiling joists beside each rafter (tie at plate level) and a plasterboard ceiling under them
  if (r.ceiling !== null) {
    const cz = r.ceiling?.z ?? [z0 + pw, z1 - pw];
    for (const x of xs.slice(0, -1)) {
      const cx = x + rw / 2 + rw / 2 + 0.02;
      if (cx + rw / 2 > inner[1]) continue;
      ps.push(block('wood', [cx - rw / 2, cx + rw / 2], [y1, y1 + 0.15], [z0 + 0.02, z1 - 0.02], o));
    }
    if (r.ceiling) for (const u of splitRange(inner[0], inner[1], 2.4)) for (const w of splitRange(cz[0], cz[1], 2.4)) {
      ps.push(block('drywall', u, [y1 - LIN, y1], w, { tint: r.ceiling.tint ?? FURN.plaster, group: r.group, protected: r.protected }));
    }
  }
  // purlins under mid-slope, bearing on the gables
  if (r.purlins !== false) {
    const up = half * 0.5;
    for (const s of [-1, 1]) {
      const a = up - 0.1, b = up + 0.1;
      const prof: [number, number][] = [[zz(s, a), under(a) - 0.2], [zz(s, a), under(a)], [zz(s, b), under(b)], [zz(s, b), under(a) - 0.2]];
      for (const u of splitRange(inner[0], inner[1], 4.8)) ps.push(extrude('wood', prof, 'x', u, o));
    }
  }
  // gable triangles (sheathing) between the plates, under the rafter plane
  for (const gx of g) {
    for (const s of [-1, 1]) {
      ps.push(extrude(r.gableMat ?? 'plywood', [[zz(s, 0), r.y], [zz(s, half - pw), r.y], [zz(s, half - pw), under(half - pw)], [zz(s, 0), under(0)]], 'x', gx,
        { tint: r.gableTint ?? r.tint, group: r.group, protected: r.protected }));
    }
  }
  // battens across the rafters, covering on the battens, ridge cap
  const cov = r.covering?.mat ?? 'roof', covO: PieceOpts = { tint: r.covering?.tint ?? FURN.slate, group: r.group, protected: r.protected };
  for (const s of [-1, 1]) {
    for (const f of [0.15, 0.5, 0.85]) {
      const a = rb + f * (half + ov - rb) - 0.03, b = a + 0.06;
      const prof: [number, number][] = [[zz(s, a), top(a)], [zz(s, a), top(a) + bt], [zz(s, b), top(b) + bt], [zz(s, b), top(b)]];
      for (const u of splitRange(r.x[0], r.x[1], 4.8)) ps.push(extrude('wood', prof, 'x', u, o));
    }
    const prof: [number, number][] = [[zz(s, rb), top(rb) + bt], [zz(s, rb), top(rb) + bt + tt], [zz(s, half + ov), top(half + ov) + bt + tt], [zz(s, half + ov), top(half + ov) + bt]];
    for (const u of splitRange(r.x[0], r.x[1], 3.6)) ps.push(extrude(cov, prof, 'x', u, covO));
  }
  const capY = top(rb) + bt + tt;
  for (const u of splitRange(r.x[0], r.x[1], 4.8)) ps.push(block(cov, u, [ridgeTop, capY + 0.06], [mid - rb, mid + rb], covO));
  return ps;
}

/* ---------------- stairs ---------------- */

export interface StairOpts extends PieceOpts {
  axis: 'x' | 'z';
  /** foot of the flight and the edge of the upper level it lands against */
  from: number;
  to: number;
  cross: Range;
  y0: number;
  y1: number;
  steps?: number;
  mat?: MaterialId;
  /** side of `cross` that is open (gets newels and a handrail) */
  open?: 'lo' | 'hi' | null;
  seat?: boolean;
  /** inclined waist (stringer) under the treads, bearing on the lower floor: long flights */
  waist?: boolean;
}

/* A flight of lapped treads (each bears on the one below; the first on the floor, the last against the upper
   edge), with newels on the bottom and top treads and a raking handrail between them. */
export function stair(s: StairOpts): PieceSpec[] {
  const steps = s.steps ?? Math.max(3, Math.round((s.y1 - s.y0) / 0.19));
  const rise = (s.y1 - s.y0) / steps, mat = s.mat ?? 'wood';
  const o: PieceOpts = { tint: s.tint ?? FURN.oak, group: s.group, protected: s.protected };
  const ps = flight({ mat, axis: s.axis, from: s.from, to: s.to, cross: s.cross, y0: s.y0, steps, rise, seat: s.seat, ...o });
  if (s.waist) {
    // top edge runs two risers under the tread corners, so it never touches a tread; the AABB welds tie it in
    const d = Math.sign(s.to - s.from), run = Math.abs(s.to - s.from) / steps, L = steps * run;
    const pr: [number, number][] = [[2 * run, s.y0], [L, s.y1 - 2 * rise], [L, s.y1 - 2 * rise - 0.25], [2 * run + (0.25 * run) / rise, s.y0]];
    const w = (s.cross[1] - s.cross[0]) * 0.3, cc = (s.cross[0] + s.cross[1]) / 2;
    const prof = pr.map(([u, y]) => [s.from + d * u, y] as [number, number]);
    const pts: Vec3[] = [];
    for (const [u, y] of prof) for (const c of [cc - w, cc + w]) pts.push(s.axis === 'x' ? [u, y, c] : [c, y, u]);
    ps.push(hull(mat, pts, o));
  }
  if (s.open) {
    const c = s.open === 'lo' ? s.cross[0] + 0.05 : s.cross[1] - 0.05;
    const d = Math.sign(s.to - s.from), run = Math.abs(s.to - s.from) / (s.seat ? steps - 1 : steps);
    const start = s.seat ? s.from - d * run : s.from;
    const newel = (along: number, j: number) => {
      const y: Range = [s.y0 + (j + 1) * rise, s.y0 + (j + 1) * rise + 0.95];
      const u: Range = [along - 0.05, along + 0.05];
      return s.axis === 'x' ? block('wood', u, y, [c - 0.05, c + 0.05], o) : block('wood', [c - 0.05, c + 0.05], y, u, o);
    };
    const a0 = start + d * run * 0.5, a1 = start + d * run * (steps - 0.5);
    ps.push(newel(a0, 0), newel(a1, steps - 1));
    const ya = s.y0 + rise + 0.9, yb = s.y0 + steps * rise + 0.9;
    const pa: Vec3 = s.axis === 'x' ? [a0 + d * 0.05, ya, c] : [c, ya, a0 + d * 0.05];
    const pb: Vec3 = s.axis === 'x' ? [a1 - d * 0.05, yb, c] : [c, yb, a1 - d * 0.05];
    ps.push(strut('wood', pa, pb, 0.08, o));
  }
  return ps;
}

/* ---------------- furniture & fittings ----------------
   Each is authored at the origin on the floor (y = 0), facing +Z (its back to -Z), then placed with fit(). */

export function fit(ps: PieceSpec[], x: number, z: number, y: number, quarter = 0): PieceSpec[] {
  return raise(place(ps, x, z, quarter), y);
}

export function table(w = 1.4, d = 0.8, o: PieceOpts = {}): PieceSpec[] {
  const t = { tint: FURN.oak, ...o };
  return [
    // dining height 0.74 m (BS EN 1729 / 527 range 0.72–0.76)
    block('wood', [-w / 2 + 0.1, -w / 2 + 0.2], [0, 0.69], [-d / 2 + 0.08, d / 2 - 0.08], loose(t)),
    block('wood', [w / 2 - 0.2, w / 2 - 0.1], [0, 0.69], [-d / 2 + 0.08, d / 2 - 0.08], loose(t)),
    block('wood', [-w / 2, w / 2], [0.69, 0.74], [-d / 2, d / 2], loose(t)),
  ];
}

export function bed(double = true, o: PieceOpts = {}): PieceSpec[] {
  const w = double ? 1.4 : 0.9;
  return [
    block('wood', [-w / 2, w / 2], [0, 0.3], [-1.0, 1.0], loose({ tint: FURN.oak, ...o })),
    { ...block('plywood', [-w / 2 + 0.05, w / 2 - 0.05], [0.3, 0.5], [-0.95, 0.95], loose({ tint: FURN.white, ...o })), soft: duvet([-w / 2 + 0.05, w / 2 - 0.05], [-0.75, 0.95], 0.5) },
    block('wood', [-w / 2, w / 2], [0, 0.95], [-1.1, -1.0], loose({ tint: FURN.oak, ...o })),
  ];
}

/** Upholstered sofa: seat, raked back and rolled front in one convex profile. */
export function sofa(w = 2.0, o: PieceOpts = {}): PieceSpec[] {
  const f = { tint: o.tint ?? FURN.fabric, group: o.group, protected: o.protected };
  return [extrude('plywood', [[-0.45, 0], [0.45, 0], [0.45, 0.36], [0.4, 0.43], [-0.2, 0.47], [-0.36, 0.86], [-0.45, 0.85]], 'x', [-w / 2, w / 2], loose(f))];
}

export function wardrobe(w = 1.0, h = 1.9, o: PieceOpts = {}): PieceSpec[] {
  return [block('wood', [-w / 2, w / 2], [0, h], [-0.3, 0.3], loose({ tint: FURN.oak, ...o }))];
}

export function bookcase(w = 0.9, h = 1.8, o: PieceOpts = {}): PieceSpec[] {
  return [block('wood', [-w / 2, w / 2], [0, h], [-0.16, 0.16], loose({ tint: FURN.oak, ...o }))];
}

export function desk(o: PieceOpts = {}): PieceSpec[] {
  const t = { tint: FURN.laminate, ...o };
  return [
    block('wood', [-0.75, -0.35], [0, 0.7], [-0.35, 0.35], loose(t)),
    block('wood', [0.6, 0.72], [0, 0.7], [-0.35, 0.35], loose(t)),
    // a stack of paper on the top: loose sheets only once something blasts or wrecks the desk
    { ...block('wood', [-0.8, 0.8], [0.7, 0.75], [-0.4, 0.4], loose(t)), soft: { kind: 'paper', count: 25, pts: [[0.1, 0.75, -0.25], [0.4, 0.78, -0.03]] } },
  ];
}

/** Dining chair: seat at 0.45 m, back to 0.85 m, in one convex seat-and-back profile (facing +Z). */
export function chair(o: PieceOpts = {}): PieceSpec[] {
  return [extrude('plywood', [[-0.22, 0], [0.22, 0], [0.22, 0.45], [-0.14, 0.47], [-0.22, 0.85]], 'x', [-0.21, 0.21], loose({ tint: FURN.fabric, ...o }))];
}

export function filingCabinet(o: PieceOpts = {}): PieceSpec[] {
  return [block('metal', [-0.24, 0.24], [0, 1.32], [-0.31, 0.31], loose({ tint: FURN.grey, ...o }))];
}

/** Office screen: a panel on a weighted foot, welded to the floor (it tears loose, then falls). */
export function screen(w = 1.6, o: PieceOpts = {}): PieceSpec[] {
  return [block('plywood', [-w / 2, w / 2], [0, 1.4], [-0.03, 0.03], { tint: FURN.fabric, ...o })];
}

/** Fitted kitchen along a wall at z = 0 (behind): base units, worktop, wall cupboards, cooker. Units and worktop
    are welded; the wall units are fixed to the wall face. */
export function kitchen(len: number, o: PieceOpts & { wallUnits?: boolean } = {}): PieceSpec[] {
  const u = { tint: o.tint ?? FURN.white, group: o.group, protected: o.protected };
  const ps: PieceSpec[] = [];
  const cooker: Range = [len / 2 - 0.3, len / 2 + 0.3];
  for (const x of [[0, cooker[0]], [cooker[1], len]] as Range[]) if (x[1] - x[0] > 0.2) ps.push(block('wood', x, [0, 0.84], [0, 0.58], u));
  ps.push(block('machine', cooker, [0, 0.9], [0, 0.58], { ...u, tint: 0xdedad2 }));
  for (const x of [[0, cooker[0]], [cooker[1], len]] as Range[]) if (x[1] - x[0] > 0.2) ps.push(block('stone', x, [0.84, 0.9], [0, 0.6], { ...u, tint: 0x4a4a4a }));
  if (o.wallUnits !== false) for (const x of splitRange(0, len, 1.2)) ps.push(block('wood', x, [1.45, 2.15], [0, 0.33], u));
  return ps;
}

/** Bathroom set against a wall at z = 0: bath along the wall, WC (pan + cistern) and basin, all ceramic, welded. */
export function bathroom(o: PieceOpts = {}): PieceSpec[] {
  const c = { tint: FURN.white, group: o.group, protected: o.protected };
  return [
    block('ceramic', [0, 1.7], [0, 0.55], [0, 0.72], c),
    block('ceramic', [1.9, 2.3], [0, 0.4], [0.18, 0.7], c),
    block('ceramic', [1.9, 2.3], [0.4, 0.85], [0, 0.18], c),
    // pedestal basin, rim at 0.85 m
    block('ceramic', [2.5, 3.0], [0.73, 0.85], [0, 0.42], c),
    block('ceramic', [2.66, 2.84], [0, 0.73], [0, 0.2], c),
  ];
}

/** Retail gondola: steel shelving unit (welded) with loose stock boxes on top. */
export function shelving(len = 1.8, o: PieceOpts = {}, seed = 1): PieceSpec[] {
  const ps = [block('metal', [-len / 2, len / 2], [0, 1.5], [-0.25, 0.25], { tint: FURN.grey, ...o })];
  const colours = [0xc8553d, 0x3d7ac8, 0xe0b848, 0x5d9a5d];
  const n = Math.max(1, Math.floor(len / 0.45));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + 0.2 + i * ((len - 0.4) / Math.max(1, n - 1 || 1));
    ps.push(block('crate', [x - 0.16, x + 0.16], [1.5, 1.78], [-0.18, 0.18], loose({ tint: colours[(i + seed) % 4], group: o.group })));
  }
  return ps;
}

/** Bar counter (welded) with loose stools in front; the back bar shelf is fixed to the wall at z = -1.2. */
export function bar(len: number, stools: number, o: PieceOpts = {}): PieceSpec[] {
  const w = { tint: FURN.oak, group: o.group, protected: o.protected };
  const ps = [
    block('wood', [0, len], [0, 1.0], [0, 0.5], w),
    block('oak', [-0.05, len + 0.05], [1.0, 1.06], [-0.05, 0.62], w),
    block('wood', [0, len], [0, 0.95], [-1.2, -0.8], w),
  ];
  for (let i = 0; i < stools; i++) ps.push(cyl('wood', 0.36, [0, 0.72], (len * (i + 0.5)) / stools, 0.95, loose(w)));
  return ps;
}

/** Church pew: one convex seat-and-back profile, loose. */
export function pew(len: number, o: PieceOpts = {}): PieceSpec[] {
  return [extrude('oak', [[-0.25, 0], [0.25, 0], [0.25, 0.45], [-0.1, 0.5], [-0.25, 0.95]], 'x', [-len / 2, len / 2], loose({ tint: FURN.oak, ...o }))];
}

/** Pallet with a loose load of boxes. */
export function pallet(load = 2, o: PieceOpts = {}): PieceSpec[] {
  const ps = [block('wood', [-0.6, 0.6], [0, 0.15], [-0.5, 0.5], loose({ tint: FURN.pine, ...o }))];
  for (let i = 0; i < load; i++) ps.push(block('crate', [-0.55, 0.55], [0.15 + i * 0.5, 0.65 + i * 0.5], [-0.45, 0.45], loose({ tint: i % 2 ? 0xc9a36a : 0xb8905a, ...o })));
  return ps;
}

/** Adjustable pallet racking along X: uprights, two beam levels, loose pallets on the beams. */
export function racking(bays: number, o: PieceOpts = {}): PieceSpec[] {
  const st = { tint: 0x2f5f9f, group: o.group, protected: o.protected }, beam = { tint: 0xe0782a, group: o.group, protected: o.protected };
  const bw = 2.7, ps: PieceSpec[] = [];
  for (let i = 0; i <= bays; i++) for (const z of [[-0.46, -0.38], [0.38, 0.46]] as Range[]) ps.push(block('steel', [i * bw - 0.05, i * bw + 0.05], [0, 4.2], z, st));
  for (let i = 0; i < bays; i++) {
    for (const y of [1.6, 3.2]) {
      for (const z of [[-0.46, -0.38], [0.38, 0.46]] as Range[]) ps.push(block('steel', [i * bw + 0.05, (i + 1) * bw - 0.05], [y - 0.12, y], z, beam));
      for (const x of [i * bw + 0.72, i * bw + 1.98]) ps.push(...raise(place(pallet(1, o), x, 0), y));
      // boxed stock on the lower shelf's loads
      if (y < 2) for (const x of [i * bw + 0.72, i * bw + 1.98]) ps.push(carton(x, 0, y + 0.66, [0.5, 0.35, 0.4], undefined, o.group));
    }
  }
  return ps;
}

/** Workbench (welded) with a loose toolbox. */
export function workbench(o: PieceOpts = {}): PieceSpec[] {
  return [
    block('wood', [-1.0, 1.0], [0, 0.85], [-0.35, 0.35], { tint: FURN.pine, ...o }),
    block('metal', [-0.3, 0.3], [0.85, 1.1], [-0.15, 0.15], loose({ tint: 0xb0493a, ...o })),
  ];
}

/** Heavy loom / machine tool on a cast bed (welded to the floor). */
export function loom(o: PieceOpts = {}): PieceSpec[] {
  const iron = { tint: 0x3c4044, ...o };
  return [
    block('castiron', [-1.1, 1.1], [0, 0.25], [-0.6, 0.6], iron),
    block('castiron', [-1.1, -0.9], [0.25, 1.3], [-0.6, 0.6], iron),
    block('castiron', [0.9, 1.1], [0.25, 1.3], [-0.6, 0.6], iron),
    block('wood', [-0.9, 0.9], [1.1, 1.3], [-0.5, 0.5], { tint: FURN.pine, ...o }),
  ];
}

export { cyl, hull };
