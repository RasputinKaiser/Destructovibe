import type { b3ShapeId } from 'box3d.js';
import { b3, world, CAT, stepCount, queryFilter, entityOfShape, type PhysEntity } from '../physics/physics';
import type { Piece } from '../destruction/structure';
import type { Poly } from '../destruction/polytope';
import { pool, ALIVE, CUT, PINNED, FROZEN } from './particles';
import { grainLoosened } from './grains';

/* Rigid pieces near a soft body, gathered once per step from its AABB and moved along their prev→cur
   step motion each substep. Particles are pushed out of each piece's convex polytope (in the body frame)
   along the face they entered through; the momentum that takes is returned to the piece at step end. */

export const MAXC = 64;
const T = 12; // per transform: row-major R (9) + t (3)

const planeCache = new WeakMap<Poly, Float64Array>();
export function planesOf(poly: Poly): Float64Array {
  let pl = planeCache.get(poly);
  if (pl) return pl;
  pl = new Float64Array(poly.faces.length * 4);
  poly.faces.forEach((f, k) => { pl![k * 4] = f.n[0]; pl![k * 4 + 1] = f.n[1]; pl![k * 4 + 2] = f.n[2]; pl![k * 4 + 3] = f.d; });
  planeCache.set(poly, pl);
  return pl;
}

export class Candidates {
  n = 0;
  ent: (PhysEntity | null)[] = new Array(MAXC).fill(null);
  planes: (Float64Array | null)[] = new Array(MAXC).fill(null);
  sphere = new Float64Array(MAXC);
  /** step-start and step-end pose: pos(3) quat(4) pos(3) quat(4) */
  pose = new Float64Array(MAXC * 14);
  /** substep transforms: current and previous */
  cur = new Float64Array(MAXC * T);
  prev = new Float64Array(MAXC * T);
  box = new Float64Array(MAXC * 6);
  mu = new Float64Array(MAXC);
  dyn = new Uint8Array(MAXC);
  /** reaction impulse on the piece this step, and its impulse-weighted application point */
  J = new Float64Array(MAXC * 3);
  JP = new Float64Array(MAXC * 3);
  JW = new Float64Array(MAXC);
  touched = new Uint8Array(MAXC);
  /** the piece rests on the soft body (penalty bearing): its reaction is capped to stop it, never launch it */
  bear = new Uint8Array(MAXC);
  /** bearing friction impulse (kept apart: it may only brake the piece's slide) */
  JF = new Float64Array(MAXC * 3);
  // cell lists over the body's AABB
  gx = 0; gy = 0; gz = 0; cs = 1; ox = 0; oy = 0; oz = 0;
  cellStart = new Int32Array(1);
  cellItems = new Int16Array(64);
}

const _aabb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
const _shapeBox: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
const filt = queryFilter(CAT.structure | CAT.debris | CAT.prop | CAT.projectile);
let _fill: Candidates | null = null;
let _skip: PhysEntity | null = null;
const visit = (s: b3ShapeId): boolean => {
  const c = _fill!;
  if (c.n >= MAXC) return false;
  const e = entityOfShape(s);
  if (!e || e === _skip) return true;
  // a compound piece is one candidate per convex part (its shapes), so particles can enter an I-beam's recess
  if (!(e as Piece).parts) for (let k = 0; k < c.n; k++) if (c.ent[k] === e) return true;
  if (e.kind === 'piece') {
    const p = e as Piece;
    if (p.dead) return true;
    c.planes[c.n] = planesOf(p.parts ? (p.parts.find(q => q.shape.index1 === s.index1) ?? p.parts[0]).poly : p.poly);
    c.mu[c.n] = p.root.spec.friction ?? p.pm.friction;
  } else if (e.kind === 'projectile') {
    b3.b3Shape_GetAABB(_shapeBox, s);
    c.planes[c.n] = null;
    c.sphere[c.n] = Math.max(0.05, (_shapeBox[3] - _shapeBox[0]) * 0.5);
    c.mu[c.n] = 0.3;
  } else return true;
  const k = c.n++;
  c.ent[k] = e;
  c.dyn[k] = b3.b3Body_GetType(e.body) === b3.b3BodyType.b3_dynamicBody ? 1 : 0;
  const o = k * 14, moved = e.movedStep === stepCount;
  const a = moved ? e.prevPos : e.curPos, q = moved ? e.prevRot : e.curRot;
  c.pose[o] = a[0]; c.pose[o + 1] = a[1]; c.pose[o + 2] = a[2];
  c.pose[o + 3] = q[0]; c.pose[o + 4] = q[1]; c.pose[o + 5] = q[2]; c.pose[o + 6] = q[3];
  c.pose[o + 7] = e.curPos[0]; c.pose[o + 8] = e.curPos[1]; c.pose[o + 9] = e.curPos[2];
  c.pose[o + 10] = e.curRot[0]; c.pose[o + 11] = e.curRot[1]; c.pose[o + 12] = e.curRot[2]; c.pose[o + 13] = e.curRot[3];
  // swept world box: the shape's current AABB grown by its step motion
  b3.b3Shape_GetAABB(_shapeBox, s);
  const dx = e.curPos[0] - a[0], dy = e.curPos[1] - a[1], dz = e.curPos[2] - a[2];
  const b = k * 6;
  c.box[b] = _shapeBox[0] + Math.min(0, -dx); c.box[b + 1] = _shapeBox[1] + Math.min(0, -dy); c.box[b + 2] = _shapeBox[2] + Math.min(0, -dz);
  c.box[b + 3] = _shapeBox[3] + Math.max(0, -dx); c.box[b + 4] = _shapeBox[4] + Math.max(0, -dy); c.box[b + 5] = _shapeBox[5] + Math.max(0, -dz);
  c.J[k * 3] = c.J[k * 3 + 1] = c.J[k * 3 + 2] = 0;
  c.JP[k * 3] = c.JP[k * 3 + 1] = c.JP[k * 3 + 2] = 0;
  c.JW[k] = 0;
  c.touched[k] = 0;
  c.bear[k] = 0;
  c.JF[k * 3] = c.JF[k * 3 + 1] = c.JF[k * 3 + 2] = 0;
  return true;
};

/** Gather the pieces overlapping `box` (min xyz, max xyz) and bin them over it. */
export function gather(c: Candidates, box: Float64Array, margin: number, skip: PhysEntity | null = null): void {
  c.n = 0;
  _fill = c; _skip = skip;
  _aabb[0] = box[0] - margin; _aabb[1] = box[1] - margin; _aabb[2] = box[2] - margin;
  _aabb[3] = box[3] + margin; _aabb[4] = box[4] + margin; _aabb[5] = box[5] + margin;
  b3.b3World_OverlapAABB(world, _aabb, filt, visit);
  _fill = null; _skip = null;
  bin(c);
}

function bin(c: Candidates): void {
  if (c.n <= 4) { c.gx = 0; return; }
  const ex = _aabb[3] - _aabb[0], ey = _aabb[4] - _aabb[1], ez = _aabb[5] - _aabb[2];
  const cs = Math.max(0.35, Math.max(ex, ey, ez) / 14);
  const gx = Math.min(16, Math.ceil(ex / cs) || 1), gy = Math.min(16, Math.ceil(ey / cs) || 1), gz = Math.min(16, Math.ceil(ez / cs) || 1);
  c.gx = gx; c.gy = gy; c.gz = gz; c.cs = cs; c.ox = _aabb[0]; c.oy = _aabb[1]; c.oz = _aabb[2];
  const nCells = gx * gy * gz;
  if (c.cellStart.length < nCells + 2) c.cellStart = new Int32Array(nCells + 2);
  const st = c.cellStart;
  st.fill(0, 0, nCells + 2);
  let total = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < c.n; k++) {
      const b = k * 6;
      const x0 = cl(Math.floor((c.box[b] - c.ox) / cs), gx), x1 = cl(Math.floor((c.box[b + 3] - c.ox) / cs), gx);
      const y0 = cl(Math.floor((c.box[b + 1] - c.oy) / cs), gy), y1 = cl(Math.floor((c.box[b + 4] - c.oy) / cs), gy);
      const z0 = cl(Math.floor((c.box[b + 2] - c.oz) / cs), gz), z1 = cl(Math.floor((c.box[b + 5] - c.oz) / cs), gz);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const cell = (x * gy + y) * gz + z;
        if (pass === 0) { st[cell + 2]++; total++; } else c.cellItems[st[cell + 1]++] = k;
      }
    }
    if (pass === 0) {
      for (let i = 2; i < nCells + 2; i++) st[i] += st[i - 1];
      if (c.cellItems.length < total) c.cellItems = new Int16Array(total * 2);
    }
  }
}

function cl(v: number, n: number): number { return v < 0 ? 0 : v >= n ? n - 1 : v; }

/** substep poses at fractions t0 (previous) and t1 (current) of the step motion */
export function poseAt(c: Candidates, t0: number, t1: number): void {
  for (let k = 0; k < c.n; k++) {
    writeT(c.cur, k, c.pose, k * 14, t1);
    writeT(c.prev, k, c.pose, k * 14, t0);
  }
}

function writeT(out: Float64Array, k: number, p: Float64Array, o: number, t: number): void {
  const s = 1 - t;
  let qx = p[o + 3] * s, qy = p[o + 4] * s, qz = p[o + 5] * s, qw = p[o + 6] * s;
  const dot = p[o + 3] * p[o + 10] + p[o + 4] * p[o + 11] + p[o + 5] * p[o + 12] + p[o + 6] * p[o + 13];
  const tt = dot < 0 ? -t : t;
  qx += p[o + 10] * tt; qy += p[o + 11] * tt; qz += p[o + 12] * tt; qw += p[o + 13] * tt;
  const l = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
  qx *= l; qy *= l; qz *= l; qw *= l;
  const b = k * T;
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  out[b] = 1 - 2 * (yy + zz); out[b + 1] = 2 * (xy - wz); out[b + 2] = 2 * (xz + wy);
  out[b + 3] = 2 * (xy + wz); out[b + 4] = 1 - 2 * (xx + zz); out[b + 5] = 2 * (yz - wx);
  out[b + 6] = 2 * (xz - wy); out[b + 7] = 2 * (yz + wx); out[b + 8] = 1 - 2 * (xx + yy);
  out[b + 9] = p[o] * s + p[o + 7] * t; out[b + 10] = p[o + 1] * s + p[o + 8] * t; out[b + 11] = p[o + 2] * s + p[o + 9] * t;
}

/** Particles [p0, p0+n) against the candidates and the ground plane, one substep of length h.
    `cutSpeed`: a piece crossing the sheet faster than this marks the particle as cut. */
/** `goal`/`kc`: solid bodies push back on a piece with stiffness kc (N/m per particle) on the particle's
    deviation from its shape-matching goal, or on the overlap for jammed (frozen) grain. Light particles
    alone cannot hold a heavy piece up through momentum exchange once per step. */
/** `cn` (ropes): per particle, the normal and friction coefficient of the rigid surface it rests on (the caller clears it).
    `skip` (ropes): per particle, a piece it passes through (the one its end is tied into). */
export function collide(c: Candidates, p0: number, n: number, h: number, mu: number, cutSpeed: number, goal: Float64Array | null = null, kc = 0, cn: Float32Array | null = null, skip: (PhysEntity | null)[] | null = null): number {
  const X = pool.x, PX = pool.px, W = pool.w, M = pool.m, R = pool.r, FL = pool.fl;
  const binned = c.gx > 0;
  let contacts = 0;
  for (let i = p0; i < p0 + n; i++) {
    if (!(FL[i] & ALIVE)) continue;
    const i3 = i * 3, r = R[i];
    // ground: y = 0
    if (cn && X[i3 + 1] < r * 1.6 && X[i3 + 1] >= r) { const q = (i - p0) * 4; cn[q] = 0; cn[q + 1] = 1; cn[q + 2] = 0; cn[q + 3] = mu; }
    if (X[i3 + 1] < r && W[i] > 0) {
      const d = r - X[i3 + 1];
      // overlap the particle did not move into this substep (spawned inside, pushed in by constraints) is
      // resolved without turning into velocity
      const over = d - Math.max(0, PX[i3 + 1] - X[i3 + 1]);
      if (over > 0) PX[i3 + 1] += over;
      X[i3 + 1] = r;
      const tx = X[i3] - PX[i3], tz = X[i3 + 2] - PX[i3 + 2], tl = Math.sqrt(tx * tx + tz * tz);
      const lim = mu * d;
      if (tl <= lim * 1.2) { X[i3] = PX[i3]; X[i3 + 2] = PX[i3 + 2]; }
      else { const k = lim / tl; X[i3] -= tx * k; X[i3 + 2] -= tz * k; }
      if (cn) { const q = (i - p0) * 4; cn[q] = 0; cn[q + 1] = 1; cn[q + 2] = 0; cn[q + 3] = mu; }
      contacts++;
    }
    // pinned particles sit inside their host by construction; jammed grain only matters to pieces bearing on it
    if (c.n === 0 || FL[i] & PINNED || (FL[i] & FROZEN && kc === 0)) continue;
    let from = 0, to = c.n;
    let list: Int16Array | null = null;
    if (binned) {
      const cx = cl(Math.floor((X[i3] - c.ox) / c.cs), c.gx), cy = cl(Math.floor((X[i3 + 1] - c.oy) / c.cs), c.gy), cz = cl(Math.floor((X[i3 + 2] - c.oz) / c.cs), c.gz);
      const cell = (cx * c.gy + cy) * c.gz + cz;
      from = c.cellStart[cell]; to = c.cellStart[cell + 1];
      list = c.cellItems;
    }
    const own = skip ? skip[i - p0] : null;
    for (let q = from; q < to; q++) {
      const k = list ? list[q] : q;
      if (own && c.ent[k] === own) continue;
      const b = k * 6;
      const x = X[i3], y = X[i3 + 1], z = X[i3 + 2];
      if (x < c.box[b] - r || x > c.box[b + 3] + r || y < c.box[b + 1] - r || y > c.box[b + 4] + r || z < c.box[b + 2] - r || z > c.box[b + 5] + r) continue;
      const t = k * T, A = c.cur;
      let nx = 0, ny = 0, nz = 0, depth = 0, lx = 0, ly = 0, lz = 0;
      const pl = c.planes[k];
      if (pl) {
        const dx = x - A[t + 9], dy = y - A[t + 10], dz = z - A[t + 11];
        lx = A[t] * dx + A[t + 3] * dy + A[t + 6] * dz;
        ly = A[t + 1] * dx + A[t + 4] * dy + A[t + 7] * dz;
        lz = A[t + 2] * dx + A[t + 5] * dy + A[t + 8] * dz;
        let best = -1e9, bf = 0;
        const reach = cn ? r * 1.6 : r;
        for (let f = 0; f < pl.length; f += 4) {
          const s = pl[f] * lx + pl[f + 1] * ly + pl[f + 2] * lz - pl[f + 3];
          if (s > best) { best = s; bf = f; if (best >= reach) break; }
        }
        if (best >= reach) continue;
        if (best >= r) {
          // resting just clear of it (a rope lying on a post): a contact for belt friction, nothing to push
          const q = (i - p0) * 4, fx = pl[bf], fy = pl[bf + 1], fz = pl[bf + 2];
          cn![q] = A[t] * fx + A[t + 1] * fy + A[t + 2] * fz; cn![q + 1] = A[t + 3] * fx + A[t + 4] * fy + A[t + 5] * fz; cn![q + 2] = A[t + 6] * fx + A[t + 7] * fy + A[t + 8] * fz;
          cn![q + 3] = Math.max(mu, c.mu[k]) * 0.5 + Math.min(mu, c.mu[k]) * 0.5;
          continue;
        }
        // the face it came in through: judged from where the particle was, in where the piece was
        const B = c.prev;
        const ex = PX[i3] - B[t + 9], ey = PX[i3 + 1] - B[t + 10], ez = PX[i3 + 2] - B[t + 11];
        const qx = B[t] * ex + B[t + 3] * ey + B[t + 6] * ez;
        const qy = B[t + 1] * ex + B[t + 4] * ey + B[t + 7] * ez;
        const qz = B[t + 2] * ex + B[t + 5] * ey + B[t + 8] * ez;
        let pb = -1e9, pf = bf;
        for (let f = 0; f < pl.length; f += 4) {
          const s = pl[f] * qx + pl[f + 1] * qy + pl[f + 2] * qz - pl[f + 3];
          if (s > pb) { pb = s; pf = f; }
        }
        if (pb > 0) bf = pf;
        depth = r - (pl[bf] * lx + pl[bf + 1] * ly + pl[bf + 2] * lz - pl[bf + 3]);
        const fx = pl[bf], fy = pl[bf + 1], fz = pl[bf + 2];
        nx = A[t] * fx + A[t + 1] * fy + A[t + 2] * fz;
        ny = A[t + 3] * fx + A[t + 4] * fy + A[t + 5] * fz;
        nz = A[t + 6] * fx + A[t + 7] * fy + A[t + 8] * fz;
      } else {
        const dx = x - A[t + 9], dy = y - A[t + 10], dz = z - A[t + 11];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz), rr = c.sphere[k] + r;
        if (d >= rr) continue;
        depth = rr - d;
        if (d > 1e-6) { nx = dx / d; ny = dy / d; nz = dz / d; } else ny = 1;
        lx = dx; ly = dy; lz = dz;
      }
      if (depth <= 0) continue;
      // surface motion at the contact over this substep
      const B = c.prev;
      const sx = B[t] * lx + B[t + 1] * ly + B[t + 2] * lz + B[t + 9];
      const sy = B[t + 3] * lx + B[t + 4] * ly + B[t + 5] * lz + B[t + 10];
      const sz = B[t + 6] * lx + B[t + 7] * ly + B[t + 8] * lz + B[t + 11];
      const cx0 = pl ? A[t] * lx + A[t + 1] * ly + A[t + 2] * lz + A[t + 9] : x, cy0 = pl ? A[t + 3] * lx + A[t + 4] * ly + A[t + 5] * lz + A[t + 10] : y, cz0 = pl ? A[t + 6] * lx + A[t + 7] * ly + A[t + 8] * lz + A[t + 11] : z;
      const mx = pl ? cx0 - sx : A[t + 9] - B[t + 9], my = pl ? cy0 - sy : A[t + 10] - B[t + 10], mz = pl ? cz0 - sz : A[t + 11] - B[t + 11];
      let ax = nx * depth, ay = ny * depth, az = nz * depth;
      // friction against the surface's own motion
      const rx = x + ax - PX[i3] - mx, ry = y + ay - PX[i3 + 1] - my, rz = z + az - PX[i3 + 2] - mz;
      const rn = rx * nx + ry * ny + rz * nz;
      const tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const m = Math.max(mu, c.mu[k]) * 0.5 + Math.min(mu, c.mu[k]) * 0.5, lim = m * depth;
      if (tl > 1e-9) {
        const kf = tl <= lim * 1.2 ? 1 : lim / tl;
        ax -= tx * kf; ay -= ty * kf; az -= tz * kf;
      }
      const vn = (mx * nx + my * ny + mz * nz) / h;
      if (FL[i] & FROZEN && vn > 1.2) { FL[i] &= ~FROZEN; W[i] = 1 / M[i]; pool.rest[i] = 0; grainLoosened(); }
      if (W[i] > 0) {
        X[i3] = x + ax; X[i3 + 1] = y + ay; X[i3 + 2] = z + az;
        const into = -((x - PX[i3] - mx) * nx + (y - PX[i3 + 1] - my) * ny + (z - PX[i3 + 2] - mz) * nz);
        const over = depth - Math.max(0, into);
        if (over > 0) { PX[i3] += nx * over; PX[i3 + 1] += ny * over; PX[i3 + 2] += nz * over; ax -= nx * over; ay -= ny * over; az -= nz * over; }
        if (c.dyn[k]) {
          const jm = M[i] / h;
          c.J[k * 3] -= ax * jm; c.J[k * 3 + 1] -= ay * jm; c.J[k * 3 + 2] -= az * jm;
          const wgt = depth * M[i];
          c.JP[k * 3] += x * wgt; c.JP[k * 3 + 1] += y * wgt; c.JP[k * 3 + 2] += z * wgt; c.JW[k] += wgt;
        }
      }
      if (kc > 0 && c.dyn[k]) {
        let dev = 0;
        if (W[i] === 0) dev = depth;
        else if (goal) {
          const g = (i - p0) * 3;
          dev = -((goal[g] - X[i3]) * nx + (goal[g + 1] - X[i3 + 1]) * ny + (goal[g + 2] - X[i3 + 2]) * nz);
        }
        if (dev > 0) {
          // spring on the deviation plus a dashpot on the closing speed (foam and packed grain are lossy)
          const f = Math.max(0, kc * Math.min(dev, pool.r[i]) + kc * 0.03 * vn) * h;
          c.J[k * 3] -= nx * f; c.J[k * 3 + 1] -= ny * f; c.J[k * 3 + 2] -= nz * f;
          // Coulomb friction against the piece sliding over the particle
          const ux = mx - (X[i3] - PX[i3]), uy = my - (X[i3 + 1] - PX[i3 + 1]), uz = mz - (X[i3 + 2] - PX[i3 + 2]);
          const un = ux * nx + uy * ny + uz * nz;
          const sx = ux - un * nx, sy = uy - un * ny, sz = uz - un * nz, sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
          if (sl > 1e-7) { const fr = (m * f) / sl; c.JF[k * 3] -= sx * fr; c.JF[k * 3 + 1] -= sy * fr; c.JF[k * 3 + 2] -= sz * fr; }
          c.bear[k] = 1;
          c.JP[k * 3] += x * f; c.JP[k * 3 + 1] += y * f; c.JP[k * 3 + 2] += z * f; c.JW[k] += f;
        }
      }
      c.touched[k] = 1;
      if (cn) { const q = (i - p0) * 4; cn[q] = nx; cn[q + 1] = ny; cn[q + 2] = nz; cn[q + 3] = m; }
      contacts++;
      if (vn > cutSpeed) FL[i] |= CUT;
    }
  }
  return contacts;
}
