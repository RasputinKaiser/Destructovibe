import { vec3, quat } from 'math';
import type { Vec3, Quat } from '../../types';
import { b3, CAT, ALL, overlapAABB, entityOfShape, stepCount, type PhysEntity } from '../../physics/physics';
import type { Piece } from '../../destruction/structure';
import * as P from '../../destruction/polytope';

export const PIECES = CAT.structure | CAT.debris | CAT.prop;
export const NO_HIT = ALL & ~(CAT.player | CAT.projectile);
/* Ground body origin sits half a slab below the surface; static joint frames on it are relative to that. */
export const GROUND_Y = -0.5;

export const toolHooks = { notify: (_msg: string): void => {} };

const _iq: Quat = [0, 0, 0, 1];
/* Render-interpolated world position of a body-local point. */
export function interpPoint(out: Vec3, e: PhysEntity, local: Vec3, alpha: number): Vec3 {
  const a = e.movedStep === stepCount ? alpha : 1;
  quat.slerp(_iq, e.prevRot, e.curRot, a);
  vec3.transformQuat(out, local, _iq);
  out[0] += e.prevPos[0] + (e.curPos[0] - e.prevPos[0]) * a;
  out[1] += e.prevPos[1] + (e.curPos[1] - e.prevPos[1]) * a;
  out[2] += e.prevPos[2] + (e.curPos[2] - e.prevPos[2]) * a;
  return out;
}

export interface Near { p: Piece; d: number; cp: Vec3 }

/* Live pieces whose surface lies within r of pos, nearest first. Collected before anyone acts on
   them so callers can heat/ignite/push without mutating the world inside a broadphase query. */
export function piecesNear(pos: Vec3, r: number): Near[] {
  const out: Near[] = [];
  const seen = new Set<Piece>();
  overlapAABB([pos[0] - r, pos[1] - r, pos[2] - r], [pos[0] + r, pos[1] + r, pos[2] + r], PIECES, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const p = e as Piece;
    if (p.dead || seen.has(p)) return;
    seen.add(p);
    const cp: Vec3 = [0, 0, 0];
    b3.b3Shape_GetClosestPoint(cp, shape, pos);
    const d = vec3.distance(cp, pos);
    if (d <= r) out.push({ p, d, cp });
  });
  return out.sort((a, b) => a.d - b.d);
}

export function nearestPiece(pos: Vec3, r: number): Piece | null {
  return piecesNear(pos, r)[0]?.p ?? null;
}

const _mn: Vec3 = [0, 0, 0], _mx: Vec3 = [0, 0, 0], _rq: Quat = [0, 0, 0, 1];
const _axes: { v: Vec3; len: number }[] = [0, 1, 2].map(() => ({ v: [0, 0, 0] as Vec3, len: 0 }));

/* The member's long axis in world space and the direction a cut runs across the face `normal`.
   The axis that goes through the face is skipped: a plane normal to it would peel a layer off the
   member instead of cutting it in two. Returns the member's width along the cut line. */
export function memberAxis(p: Piece, normal: Vec3, axisOut: Vec3, acrossOut: Vec3): number {
  P.bounds(p.poly, _mn, _mx);
  b3.b3Body_GetRotation(_rq, p.body);
  for (let k = 0; k < 3; k++) {
    const a = _axes[k];
    vec3.set(a.v, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
    vec3.transformQuat(a.v, a.v, _rq);
    a.len = _mx[k] - _mn[k];
  }
  const order = [..._axes].sort((a, b) => b.len - a.len);
  const pick = order.find(a => Math.abs(vec3.dot(a.v, normal)) < 0.7) ?? order[0];
  vec3.copy(axisOut, pick.v);
  vec3.cross(acrossOut, pick.v, normal);
  if (vec3.length(acrossOut) < 1e-3) {
    const other = order.find(a => a !== pick)!;
    vec3.copy(acrossOut, other.v);
  }
  vec3.normalize(acrossOut, acrossOut);
  let best = 0, width = 0.5;
  for (const a of _axes) {
    const d = Math.abs(vec3.dot(a.v, acrossOut));
    if (d > best) { best = d; width = a.len; }
  }
  return width;
}

const _m: [number, number, number, number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/* Rotation whose local X, Y map to world `x`, `y` (orthonormal). */
export function basisQuat(out: Quat, x: Vec3, y: Vec3): Quat {
  const z: Vec3 = vec3.cross([0, 0, 0], x, y);
  _m[0] = x[0]; _m[1] = x[1]; _m[2] = x[2];
  _m[3] = y[0]; _m[4] = y[1]; _m[5] = y[2];
  _m[6] = z[0]; _m[7] = z[1]; _m[8] = z[2];
  return quat.fromMat3(out, _m);
}

/* Spherical interpolation between unit directions. */
export function slerpDir(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  const c = Math.min(1, Math.max(-1, vec3.dot(a, b)));
  const om = Math.acos(c);
  if (om < 1e-4) return vec3.copy(out, b);
  const s = Math.sin(om);
  const ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
  return vec3.set(out, a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb);
}

/* Mid-span sag of a cable of length `len` hung between points `d` apart (parabolic approximation). */
export function ropeSag(len: number, d: number): number {
  return Math.min(len * 0.5, Math.sqrt((3 * d * Math.max(0, len - d)) / 8));
}

const _lo: Vec3 = [0, 0, 0], _ld: Vec3 = [0, 0, 0], _cq: Quat = [0, 0, 0, 1];

/* Solid path length through a piece from a surface point along dir (the convex envelope, thinned by how
   much of the envelope is actually material: an I-beam or a hollow section is mostly air). */
export function chord(p: Piece, point: Vec3, dir: Vec3): number {
  quat.conjugate(_cq, p.curRot as Quat);
  vec3.sub(_lo, point, p.curPos);
  vec3.transformQuat(_lo, _lo, _cq);
  vec3.transformQuat(_ld, dir, _cq);
  let t = Infinity;
  for (const f of p.poly.faces) {
    const dn = vec3.dot(f.n, _ld);
    if (dn <= 1e-6) continue;
    t = Math.min(t, (f.d - vec3.dot(f.n, _lo)) / dn);
  }
  return Number.isFinite(t) ? Math.max(0, t) * fillOf(p) : 0;
}

/** share of the envelope's bounding box that is material */
export function fillOf(p: Piece): number {
  P.bounds(p.poly, _mn, _mx);
  return Math.min(1, Math.max(0.02, p.volume / Math.max((_mx[0] - _mn[0]) * (_mx[1] - _mn[1]) * (_mx[2] - _mn[2]), 1e-9)));
}

/** local bounds of a piece (its envelope) */
export function localBounds(p: Piece, mn: Vec3, mx: Vec3): void {
  P.bounds(p.poly, mn, mx);
}

/** Area of the member's section cut by the plane through it normal to world `axis` (bounds × fill). */
export function sectionArea(p: Piece, axis: Vec3): { A: number; dims: Vec3; k: number } {
  P.bounds(p.poly, _mn, _mx);
  quat.conjugate(_cq, p.curRot as Quat);
  vec3.transformQuat(_ld, axis, _cq);
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(_ld[i]) > Math.abs(_ld[k])) k = i;
  const dims: Vec3 = [_mx[0] - _mn[0], _mx[1] - _mn[1], _mx[2] - _mn[2]];
  return { A: dims[(k + 1) % 3] * dims[(k + 2) % 3] * fillOf(p), dims, k };
}
