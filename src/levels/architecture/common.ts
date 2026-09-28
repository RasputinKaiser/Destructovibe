import type { AgeSpec, MaterialId, PieceSpec, Vec3 } from '../../types.ts';
import { MATS } from '../../destruction/materials.ts';
import { MIN_PLATE } from '../../destruction/compound.ts';
import { block, envelopeFinish, hull, place, tag, weldParts, type PieceOpts, type Range } from '../kit.ts';
import { gridFeed, type Placement } from '../structures.ts';
import { detailCount, stoneWall, wallSlab } from '../layers.ts';

/* Shared helpers for the landmark buildings. Landmarks are authored like every other structure: local metres
   round their own origin, front facing +Z, finished with `finish` (envelope finishes, placement, group, age). */

export type { Placement };

export function finish(ps: PieceSpec[], p: Placement, group: string, age?: AgeSpec): PieceSpec[] {
  return gridFeed(tag(place(envelopeFinish(ps), p.x, p.z, p.rot ?? 0), { group: p.group ?? group, ...(age ? { age } : {}) }), p.gridFed);
}

/* ---------------- vectors ---------------- */

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/* ---------------- profiled members ---------------- */

/** Rolled or built-up section: depth D (web direction), width B, flange/wall t, web tw (real sizes, metres). */
export interface Prof { kind: 'I' | 'channel' | 'angle' | 'tee' | 'box' | 'bar'; D: number; B: number; t: number; tw?: number }

export const PROF = {
  /** riveted wrought-iron lattice bar / flat pair */
  flat: (D: number, B = 0.1): Prof => ({ kind: 'bar', D, B, t: 0 }),
  I: (D: number, B: number, t = D / 18, tw = D / 30): Prof => ({ kind: 'I', D, B, t, tw }),
  tee: (D: number, B: number, t = 0.014): Prof => ({ kind: 'tee', D, B, t, tw: t }),
  angle: (D: number, t = D / 10): Prof => ({ kind: 'angle', D, B: D, t, tw: t }),
  channel: (D: number, B: number, t = 0.012): Prof => ({ kind: 'channel', D, B, t, tw: t }),
  box: (D: number, B: number, t: number): Prof => ({ kind: 'box', D, B, t, tw: t }),
};

type Rect = [number, number, number, number]; // d0 d1 w0 w1

function plates(p: Prof, t: number, tw: number): Rect[] {
  const hd = p.D / 2, hb = p.B / 2;
  switch (p.kind) {
    case 'I': return [[hd - t, hd, -hb, hb], [-hd, -hd + t, -hb, hb], [-hd + t, hd - t, -tw / 2, tw / 2]];
    case 'channel': return [[-hd, hd, -hb, -hb + tw], [hd - t, hd, -hb + tw, hb], [-hd, -hd + t, -hb + tw, hb]];
    case 'angle': return [[-hd, hd, -hb, -hb + t], [-hd, -hd + t, -hb + t, hb]];
    case 'tee': return [[hd - t, hd, -hb, hb], [-hd, hd - t, -tw / 2, tw / 2]];
    case 'box': return [[hd - t, hd, -hb, hb], [-hd, -hd + t, -hb, hb], [-hd + t, hd - t, -hb, -hb + t], [-hd + t, hd - t, hb - t, hb]];
    default: return [[-hd, hd, -hb, hb]];
  }
}

const area = (rs: Rect[]): number => rs.reduce((s, r) => s + (r[1] - r[0]) * (r[3] - r[2]), 0);

export interface Cut { at: Vec3; n: Vec3 }
export interface MemberOpts extends PieceOpts {
  /** direction the section depth (web) lies along; default: world up squared to the member (a truss in a vertical
      plane gets its web in that plane) */
  depth?: Vec3;
  /** end planes; default square to the member. 'level' cuts both ends horizontally (members landing on chords),
      'plumb' vertically (members butting a post or column face). */
  cut?: 'square' | 'level' | 'plumb' | [Cut | null, Cut | null];
}

/**
 * A straight member of any direction with its real section profile: ONE body whose convex parts are the section's
 * plates (drawn at least MIN_PLATE thick, the density corrected so the member weighs its real kg/m). Its ends are
 * cut to planes, so a diagonal lands flat on the chord or post it meets and welds face to face.
 */
export function member(mat: MaterialId, a: Vec3, b: Vec3, prof: Prof, o: MemberOpts = {}): PieceSpec {
  const t = unit(sub(b, a));
  let dh = o.depth ?? [0, 1, 0];
  if (Math.abs(dot(unit(dh), t)) > 0.98) dh = Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const d = unit(sub(dh, mul(t, dot(dh, t)))), w = cross(t, d);
  const hor = Math.hypot(t[0], t[2]);
  const cutAt = (p: Vec3): Cut => {
    if (o.cut === 'level') return { at: p, n: [0, 1, 0] };
    if (o.cut === 'plumb' && hor > 1e-6) return { at: p, n: [t[0] / hor, 0, t[2] / hor] };
    return { at: p, n: t };
  };
  const cuts: [Cut, Cut] = Array.isArray(o.cut) ? [o.cut[0] ?? cutAt(a), o.cut[1] ?? cutAt(b)] : [cutAt(a), cutAt(b)];
  const tm = prof.kind === 'bar' ? 0 : Math.min(Math.max(prof.t, MIN_PLATE), (prof.D - MIN_PLATE) / 2);
  const twm = prof.kind === 'bar' ? 0 : Math.min(Math.max(prof.tw ?? prof.t, MIN_PLATE), prof.B / 2);
  const model = plates(prof, tm, twm), real = plates(prof, prof.t, prof.tw ?? prof.t);
  const pieces = model.map((r) => {
    const pts: Vec3[] = [];
    for (const [dd, ww] of [[r[0], r[2]], [r[0], r[3]], [r[1], r[2]], [r[1], r[3]]]) {
      const base = add(a, add(mul(d, dd), mul(w, ww)));
      for (const c of cuts) {
        const den = dot(t, c.n);
        const s = Math.abs(den) < 1e-6 ? 0 : dot(sub(c.at, base), c.n) / den;
        pts.push(add(base, mul(t, s)));
      }
    }
    return hull(mat, pts, o);
  });
  const rho = MATS[mat].density;
  const dens = prof.kind === 'bar' ? undefined : Math.round(rho * Math.min(1, area(real) / area(model)));
  const out = pieces.length === 1 ? pieces[0] : weldParts(pieces);
  if (dens !== undefined && dens < rho) out.density = dens;
  return out;
}

/* ---------------- arcs ---------------- */

/** Point on a circle in the XY plane (centre cx, cy), at angle a from +X. */
export const arcPt = (cx: number, cy: number, r: number, a: number, z: number): Vec3 => [cx + r * Math.cos(a), cy + r * Math.sin(a), z];

/** Voussoir / arch-rib segment in the XY plane between angles a0 and a1, radii r0..r1, extruded over z. */
export function voussoir(mat: MaterialId, cx: number, cy: number, r: Range, a: Range, z: Range, o: PieceOpts = {}, extra: Vec3[] = []): PieceSpec {
  const pts: Vec3[] = [...extra];
  for (const ang of a) for (const rr of r) for (const zz of z) pts.push(arcPt(cx, cy, rr, ang, zz));
  return hull(mat, pts, o);
}

/** Box in an arbitrary frame: corners o + e0·r0 + e1·r1 + e2·r2 (e's orthonormal), as a hull. */
export function obox(mat: MaterialId, o: Vec3, e: [Vec3, Vec3, Vec3], r: [Range, Range, Range], opts: PieceOpts = {}): PieceSpec {
  const pts: Vec3[] = [];
  for (const a of r[0]) for (const b of r[1]) for (const c of r[2]) pts.push(add(o, add(mul(e[0], a), add(mul(e[1], b), mul(e[2], c)))));
  return hull(mat, pts, opts);
}

/* ---------------- misc ---------------- */

/** Tall members split into lengths no longer than maxH, as the column/pier courses of a real building. */
export function lifts(y: Range, maxH: number): Range[] {
  const n = Math.max(1, Math.ceil((y[1] - y[0]) / maxH - 1e-9));
  return Array.from({ length: n }, (_, i) => [y[0] + ((y[1] - y[0]) * i) / n, y[0] + ((y[1] - y[0]) * (i + 1)) / n] as Range);
}

/** Axis-aligned box with a structural section (I, channel…) along its longest axis unless `axis` says otherwise. */
export function sect(mat: MaterialId, x: Range, y: Range, z: Range, section: NonNullable<PieceSpec['section']>, o: PieceOpts = {}): PieceSpec {
  return { ...block(mat, x, y, z, o), section };
}

/** Give thick masonry walls (which layerize leaves alone past 0.62 m) their ashlar face and rubble core as detail.
    `c` is the building's plan centre, so the dressed face goes outside. */
export function ashlar(ps: PieceSpec[], c: [number, number], o: { maxUnits?: number; face?: number } = {}): PieceSpec[] {
  const max = o.maxUnits ?? 3000;
  return ps.map((p) => {
    if ((p.mat !== 'stone' && p.mat !== 'sandstone') || p.detail || p.parts || p.section || p.noWeld || p.rotY || (p.shape && p.shape !== 'box')) return p;
    const [sx, sy, sz] = p.size, t = Math.min(sx, sz);
    if (sy < 0.9 || t < 0.3 || t > 2.2 || Math.max(sx, sz) < 0.5) return p;
    const rng = (k: number): Range => [p.pos[k] - p.size[k] / 2, p.pos[k] + p.size[k] / 2];
    const alongX = sx >= sz, tk = alongX ? 2 : 0, out: 1 | -1 = p.pos[tk] >= (tk === 2 ? c[1] : c[0]) ? 1 : -1;
    const q = stoneWall(wallSlab(alongX ? 'x' : 'z', rng(alongX ? 0 : 2), rng(1), rng(tk), out), { mat: p.mat, tint: p.tint, face: o.face });
    return q.detail && q.detail.length <= max ? { ...p, detail: q.detail, density: q.density } : p;
  });
}

/** A compound whose parts were edited (a doorway taken out of a course ring): re-centre it on its parts' extents. */
export function refit(q: PieceSpec): PieceSpec {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const r of q.parts ?? []) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], r.pos[k] - r.size[k] / 2); hi[k] = Math.max(hi[k], r.pos[k] + r.size[k] / 2); }
  const c = lo.map((v, k) => (v + hi[k]) / 2) as Vec3;
  return { ...q, pos: add(q.pos, c), size: hi.map((v, k) => v - lo[k]) as Vec3, parts: q.parts!.map((r) => ({ ...r, pos: sub(r.pos, c) })) };
}

export function stats(ps: PieceSpec[]): { pieces: number; detail: number } {
  return { pieces: ps.length, detail: detailCount(ps) };
}
