import type { MaterialId, PieceSpec, Vec3 } from '../types.ts';
import { block, cyl, extrude, hull, splitRange, swapXZ, wedge, type PieceOpts, type Range } from './kit.ts';

/* Facade articulation. Every helper works on one wall face written along X — the face plane at z = `face`,
   projecting toward `out` — and `axis: 'z'` mirrors it onto a wall running along Z (like wallRun). Every piece
   bears on the face it dresses, so ornament welds to its host and falls with it. */

export interface FaceRun { axis?: 'x' | 'z'; face: number; out?: 1 | -1 }

const off = (f: FaceRun, d0: number, d1: number): Range => ((f.out ?? 1) > 0 ? [f.face + d0, f.face + d1] : [f.face - d1, f.face - d0]);
const onAxis = (f: FaceRun, ps: PieceSpec[]) => (f.axis === 'z' ? swapXZ(ps) : ps);

export interface BandOpts extends FaceRun, PieceOpts {
  mat: MaterialId;
  from: number;
  to: number;
  y: Range;
  depth: number;
  /** square band, cornice (chamfered soffit), or drip / sill (weathered top) */
  profile?: 'square' | 'cornice' | 'drip';
  maxW?: number;
}

/** String course, plinth, cornice, coping, gutter or fascia along a face. */
export function band(b: BandOpts): PieceSpec[] {
  const o: PieceOpts = { tint: b.tint, group: b.group, protected: b.protected };
  const s = b.out ?? 1, [y0, y1] = b.y, d = b.depth, h = y1 - y0, v = (k: number) => b.face + s * k;
  const ps = splitRange(b.from, b.to, b.maxW ?? 4.5).map((u) => {
    if (!b.profile || b.profile === 'square') return block(b.mat, u, b.y, off(b, 0, d), o);
    const prof: [number, number][] = b.profile === 'cornice'
      ? [[v(0), y0], [v(0), y1], [v(d), y1], [v(d), y1 - 0.45 * h], [v(0.35 * d), y0]]
      : [[v(0), y0], [v(0), y1], [v(d), y1 - 0.5 * h], [v(d), y0]];
    return extrude(b.mat, prof, 'x', u, o);
  });
  return onAxis(b, ps);
}

/** Rainwater downpipe against the face from y[0] (ground, a plinth or band top) up to the gutter underside. */
export function downpipe(f: FaceRun, u: number, y: Range, o: PieceOpts = {}, d = 0.1): PieceSpec[] {
  // a 16-gon's corner radius is r / cos(pi / 16): sit it exactly on the face
  const r = d / 2 / Math.cos(Math.PI / 16);
  const v = f.face + (f.out ?? 1) * r;
  return onAxis(f, [cyl('pvc', d, y, u, v, { tint: 0x3a3d40, ...o })]);
}

/** Sloping canopy (door hood, shop awning) keyed into the face along its back edge, with optional brackets. */
export function canopy(f: FaceRun, u: Range, y: number, depth: number, o: PieceOpts & { mat?: MaterialId; t?: number; brackets?: boolean } = {}): PieceSpec[] {
  const t = o.t ?? 0.22, mat = o.mat ?? 'metal', s = f.out ?? 1;
  const opts: PieceOpts = { tint: o.tint, group: o.group, protected: o.protected };
  const ps: PieceSpec[] = [wedge(mat, u, [y, y + t], off(f, 0, depth), s > 0 ? '-z' : '+z', opts)];
  if (o.brackets) {
    for (const x of [u[0] + 0.12, u[1] - 0.12]) {
      ps.push(wedge('steel', [x - 0.05, x + 0.05], [y - 0.4, y], off(f, 0, Math.min(0.45, depth * 0.6)), s > 0 ? '-z' : '+z', { tint: 0x3c4044, group: o.group, protected: o.protected }));
    }
  }
  return onAxis(f, ps);
}

/** Corner quoins: `n` blocks up the face from y0 to y1, alternately long and short, running from the corner
    at u = `corner` in direction `dir`. */
export function quoins(f: FaceRun, corner: number, dir: 1 | -1, y: Range, n: number, o: PieceOpts & { mat?: MaterialId; depth?: number } = {}): PieceSpec[] {
  const mat = o.mat ?? 'stone', d = o.depth ?? 0.08, h = (y[1] - y[0]) / n;
  const ps: PieceSpec[] = [];
  for (let i = 0; i < n; i++) {
    const w = i % 2 ? 0.32 : 0.6;
    const u: Range = dir > 0 ? [corner, corner + w] : [corner - w, corner];
    ps.push(block(mat, u, [y[0] + i * h, y[0] + (i + 1) * h], off(f, 0, d), { tint: o.tint ?? 0xe6dcc6, group: o.group, protected: o.protected }));
  }
  return onAxis(f, ps);
}

/** Pilaster strip with a projecting cap. */
export function pilaster(f: FaceRun, u: number, w: number, y: Range, o: PieceOpts & { mat?: MaterialId; depth?: number; cap?: MaterialId } = {}): PieceSpec[] {
  const mat = o.mat ?? 'stone', d = o.depth ?? 0.12;
  const opts: PieceOpts = { tint: o.tint, group: o.group, protected: o.protected };
  const ps = [block(mat, [u - w / 2, u + w / 2], [y[0], y[1] - 0.2], off(f, 0, d), opts)];
  ps.push(block(o.cap ?? mat, [u - w / 2 - 0.06, u + w / 2 + 0.06], [y[1] - 0.2, y[1]], off(f, 0, d + 0.06), opts));
  return onAxis(f, ps);
}

/** Cantilevered balcony: deck slab keyed into the face at floor level y, a front balustrade and two side panels. */
export function balcony(f: FaceRun, u: Range, y: number, depth: number, o: PieceOpts & { deck?: MaterialId; rail?: MaterialId; railTint?: number } = {}): PieceSpec[] {
  const opts: PieceOpts = { tint: o.tint, group: o.group, protected: o.protected };
  const rail: PieceOpts = { tint: o.railTint ?? 0x3c4044, group: o.group, protected: o.protected };
  const deck: Range = [y - 0.15, y], top = y + 1.0, r = o.rail ?? 'metal';
  return onAxis(f, [
    block(o.deck ?? 'rconcrete', u, deck, off(f, 0, depth), opts),
    block(r, u, [y, top], off(f, depth - 0.08, depth), rail),
    block(r, [u[0], u[0] + 0.08], [y, top], off(f, 0, depth - 0.08), rail),
    block(r, [u[1] - 0.08, u[1]], [y, top], off(f, 0, depth - 0.08), rail),
  ]);
}

/** Dormer on a pitched-roof slope whose top surface is y = yAt(d) (d = distance from the ridge line, eave at `eave`).
    One hull sits flush on the slope with a vertical front at distance `front` and a flat top; a pane sits on its face. */
export function dormer(x: Range, mid: number, side: 1 | -1, front: number, back: number, top: number, yAt: (d: number) => number,
  o: PieceOpts & { mat?: MaterialId } = {}): PieceSpec[] {
  const z = (d: number) => mid + side * d;
  const pts: Vec3[] = [];
  for (const xx of x) pts.push([xx, yAt(front), z(front)], [xx, top, z(front)], [xx, top, z(back)], [xx, yAt(back), z(back)]);
  return [hull(o.mat ?? 'roof', pts, { tint: o.tint, group: o.group, protected: o.protected })];
}

/** Segmental hood mould over an opening of span u whose head is at y: flat underside, arched top rising `rise`,
    standing `depth` proud of the face (Victorian stone and gauged-brick heads). */
export function hood(f: FaceRun, u: Range, y: number, o: PieceOpts & { mat?: MaterialId; rise?: number; depth?: number } = {}): PieceSpec[] {
  const w = u[1] - u[0] + 0.24, c = (u[0] + u[1]) / 2, rise = o.rise ?? 0.08 + 0.14 * w, band = 0.14, d = o.depth ?? 0.06;
  const prof: [number, number][] = [[c - w / 2, y], [c + w / 2, y]];
  for (let i = 0; i <= 6; i++) {
    const t = -1 + i / 3;
    prof.push([c + (t * w) / 2, y + band + rise * (1 - t * t)]);
  }
  const [v0, v1] = off(f, 0, d);
  const pts: Vec3[] = prof.flatMap(([uu, yy]) => [[uu, yy, v0], [uu, yy, v1]] as Vec3[]);
  return onAxis(f, [hull(o.mat ?? 'stone', pts, { tint: o.tint ?? 0xe6dcc6, group: o.group, protected: o.protected })]);
}

/** Canted bay window in front of a glassless opening spanning u (sill y[0], head y[1]): a brick base on the ground
    against the face, a front light and two canted side lights standing on it, and a lean-to roof on the lights and
    the face. */
export function bay(f: FaceRun, u: Range, y: Range, o: PieceOpts & { depth?: number; roofTint?: number } = {}): PieceSpec[] {
  const s = f.out ?? 1, D = o.depth ?? 0.55, v = (d: number) => f.face + s * d;
  const u0 = u[0] - 0.2, u1 = u[1] + 0.2, fu: Range = [u0 + 0.3, u1 - 0.3], ys = y[0] - 0.12;
  const g = { group: o.group, protected: o.protected };
  const plan: [number, number][] = [[u0, v(0)], [u1, v(0)], [fu[1], v(D)], [fu[0], v(D)]];
  const prism = (mat: MaterialId, pl: [number, number][], y0: number, y1: number, op: PieceOpts) =>
    hull(mat, pl.flatMap(([uu, vv]) => [[uu, y0, vv], [uu, y1, vv]] as Vec3[]), op);
  const front: [number, number][] = [[fu[0], v(D - 0.1)], [fu[1], v(D - 0.1)], [fu[1], v(D - 0.04)], [fu[0], v(D - 0.04)]];
  const side = (e: number, k: 1 | -1): [number, number][] => [[e + k * 0.04, v(0)], [e + k * 0.12, v(0)], [fu[k > 0 ? 0 : 1], v(D - 0.1)], [fu[k > 0 ? 0 : 1], v(D - 0.04)]];
  const ps: PieceSpec[] = [
    prism('brick', plan, 0, ys, { ...g, tint: o.tint ?? 0xa3553f }),
    prism('glass', front, ys, y[1], g), prism('glass', side(u0, 1), ys, y[1], g), prism('glass', side(u1, -1), ys, y[1], g),
    hull('roof', [...plan.map(([uu, vv]) => [uu, y[1], vv] as Vec3), [u0, y[1] + 0.4, v(0)], [u1, y[1] + 0.4, v(0)], [fu[1], y[1] + 0.12, v(D)], [fu[0], y[1] + 0.12, v(D)]],
      { ...g, tint: o.roofTint ?? 0x5f656e }),
  ];
  return onAxis(f, ps);
}
