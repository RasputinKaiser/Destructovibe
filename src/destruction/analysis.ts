/* Linear-elastic 3D frame analysis of the welded structures.

   Nodes are pieces (rigid bodies, 6 DOF). Each weld is an element: two flexible beam segments, one
   from each member's centroid to the contact point with that member's own E and section (A, I, J,
   shear area), in series with a thin bearing layer over the contact patch. With loads at centroids
   this is exact Euler–Bernoulli/Timoshenko beam theory for members built from any number of pieces,
   and a small contact patch acts as the partial hinge it is. Ropes and rebar ties are tension-only
   axial elements. Static equilibrium under gravity (plus hung machinery) is solved per ground-founded
   component by block-Jacobi preconditioned CG, warm-started from the last solution, time-sliced. */

import { b3 } from '../physics/physics';
import type { MaterialId, Vec3, Quat } from '../types';
import { sectionOf, solidSection, type Section } from './materials';
import type { Piece, Weld } from './structure';

export const GRAVITY = 9.81;
const LAYER = 0.01;            // bearing / mortar / weld layer across a contact, m
const SLENDER = 25;            // KL/r above which a compression member is checked for buckling

/* ---------------- dense 6×6 helpers ---------------- */

const _aug = new Float64Array(72);
/** Inverse of a 6×6 (row-major) by Gauss–Jordan with partial pivoting. */
function inv6(a: ArrayLike<number>, ao: number, out: Float64Array, oo: number): boolean {
  const m = _aug;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 12; j++) m[i * 12 + j] = j < 6 ? a[ao + i * 6 + j] : j - 6 === i ? 1 : 0;
  for (let c = 0; c < 6; c++) {
    let piv = c, best = Math.abs(m[c * 12 + c]);
    for (let r = c + 1; r < 6; r++) { const v = Math.abs(m[r * 12 + c]); if (v > best) { best = v; piv = r; } }
    if (!(best > 0) || !Number.isFinite(best)) return false;
    if (piv !== c) for (let j = 0; j < 12; j++) { const t = m[c * 12 + j]; m[c * 12 + j] = m[piv * 12 + j]; m[piv * 12 + j] = t; }
    const d = 1 / m[c * 12 + c];
    for (let j = 0; j < 12; j++) m[c * 12 + j] *= d;
    for (let r = 0; r < 6; r++) {
      if (r === c) continue;
      const f = m[r * 12 + c];
      if (f !== 0) for (let j = 0; j < 12; j++) m[r * 12 + j] -= f * m[c * 12 + j];
    }
  }
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) out[oo + i * 6 + j] = m[i * 12 + 6 + j];
  return true;
}

/* ---------------- the solver ---------------- */

/** A frame of rigid nodes joined by 6×6 joint springs. Element e joins node ei to node ej (−1 = ground)
 * through arms ra, rb from each node's reference point to its attachment point. */
export class Frame {
  readonly pos: Float64Array;
  readonly load: Float64Array;
  x: Float64Array;
  readonly ei: Int32Array;
  readonly ej: Int32Array;
  readonly ra: Float64Array;
  readonly rb: Float64Array;
  readonly K: Float64Array;
  /** tension-only axial elements: their unit axis a→b; `off` while slack */
  readonly tonly: Uint8Array;
  readonly off: Uint8Array;
  readonly axis: Float64Array;
  private readonly Minv: Float64Array;
  private readonly reg: Float64Array;
  private readonly r: Float64Array;
  private readonly z: Float64Array;
  private readonly p: Float64Array;
  private readonly q: Float64Array;
  private rz = 0;
  private f0 = 0;
  private passes = 0;
  iterations = 0;
  /** relative residual (preconditioned norm) to converge to */
  tol = 2e-5;
  /** fine-level smoother weight, reused from the previous frame of the same structure */
  omega: number | undefined;
  started = false;
  done = false;
  residual = 1;

  readonly n: number;
  readonly ne: number;

  constructor(n: number, ne: number) {
    this.n = n;
    this.ne = ne;
    this.pos = new Float64Array(3 * n);
    this.load = new Float64Array(6 * n);
    this.x = new Float64Array(6 * n);
    this.ei = new Int32Array(ne);
    this.ej = new Int32Array(ne);
    this.ra = new Float64Array(3 * ne);
    this.rb = new Float64Array(3 * ne);
    this.K = new Float64Array(36 * ne);
    this.tonly = new Uint8Array(ne);
    this.off = new Uint8Array(ne);
    this.axis = new Float64Array(3 * ne);
    this.Minv = new Float64Array(36 * n);
    this.reg = new Float64Array(2 * n);
    this.r = new Float64Array(6 * n);
    this.z = new Float64Array(6 * n);
    this.p = new Float64Array(6 * n);
    this.q = new Float64Array(6 * n);
  }

  /** y = K·x (plus a vanishing spring to ground on every node, so a node that loses every element stays finite). */
  mul(x: Float64Array, y: Float64Array): void {
    y.fill(0);
    const { ei, ej, ra, rb, K, off, reg } = this;
    for (let e = 0; e < this.ne; e++) {
      if (off[e]) continue;
      const i = ei[e], j = ej[e], i6 = i * 6, e3 = e * 3, e36 = e * 36;
      const ax = ra[e3], ay = ra[e3 + 1], az = ra[e3 + 2];
      // jump at the joint: (u_j + θ_j × rb) − (u_i + θ_i × ra), θ_j − θ_i
      let s0 = -(x[i6] + x[i6 + 4] * az - x[i6 + 5] * ay);
      let s1 = -(x[i6 + 1] + x[i6 + 5] * ax - x[i6 + 3] * az);
      let s2 = -(x[i6 + 2] + x[i6 + 3] * ay - x[i6 + 4] * ax);
      let s3 = -x[i6 + 3], s4 = -x[i6 + 4], s5 = -x[i6 + 5];
      let bx = 0, by = 0, bz = 0, j6 = 0;
      if (j >= 0) {
        j6 = j * 6; bx = rb[e3]; by = rb[e3 + 1]; bz = rb[e3 + 2];
        s0 += x[j6] + x[j6 + 4] * bz - x[j6 + 5] * by;
        s1 += x[j6 + 1] + x[j6 + 5] * bx - x[j6 + 3] * bz;
        s2 += x[j6 + 2] + x[j6 + 3] * by - x[j6 + 4] * bx;
        s3 += x[j6 + 3]; s4 += x[j6 + 4]; s5 += x[j6 + 5];
      }
      const f0 = K[e36] * s0 + K[e36 + 1] * s1 + K[e36 + 2] * s2 + K[e36 + 3] * s3 + K[e36 + 4] * s4 + K[e36 + 5] * s5;
      const f1 = K[e36 + 6] * s0 + K[e36 + 7] * s1 + K[e36 + 8] * s2 + K[e36 + 9] * s3 + K[e36 + 10] * s4 + K[e36 + 11] * s5;
      const f2 = K[e36 + 12] * s0 + K[e36 + 13] * s1 + K[e36 + 14] * s2 + K[e36 + 15] * s3 + K[e36 + 16] * s4 + K[e36 + 17] * s5;
      const f3 = K[e36 + 18] * s0 + K[e36 + 19] * s1 + K[e36 + 20] * s2 + K[e36 + 21] * s3 + K[e36 + 22] * s4 + K[e36 + 23] * s5;
      const f4 = K[e36 + 24] * s0 + K[e36 + 25] * s1 + K[e36 + 26] * s2 + K[e36 + 27] * s3 + K[e36 + 28] * s4 + K[e36 + 29] * s5;
      const f5 = K[e36 + 30] * s0 + K[e36 + 31] * s1 + K[e36 + 32] * s2 + K[e36 + 33] * s3 + K[e36 + 34] * s4 + K[e36 + 35] * s5;
      y[i6] -= f0; y[i6 + 1] -= f1; y[i6 + 2] -= f2;
      y[i6 + 3] -= ay * f2 - az * f1 + f3;
      y[i6 + 4] -= az * f0 - ax * f2 + f4;
      y[i6 + 5] -= ax * f1 - ay * f0 + f5;
      if (j >= 0) {
        y[j6] += f0; y[j6 + 1] += f1; y[j6 + 2] += f2;
        y[j6 + 3] += by * f2 - bz * f1 + f3;
        y[j6 + 4] += bz * f0 - bx * f2 + f4;
        y[j6 + 5] += bx * f1 - by * f0 + f5;
      }
    }
    for (let i = 0; i < this.n; i++) {
      const i6 = i * 6, t = reg[2 * i], w = reg[2 * i + 1];
      y[i6] += t * x[i6]; y[i6 + 1] += t * x[i6 + 1]; y[i6 + 2] += t * x[i6 + 2];
      y[i6 + 3] += w * x[i6 + 3]; y[i6 + 4] += w * x[i6 + 4]; y[i6 + 5] += w * x[i6 + 5];
    }
  }

  /* Diagonal 6×6 blocks Bᵀ·K·B, B = [[I, −[r]×], [0, I]], inverted for the smoother. */
  prepare(): void {
    const D = new Float64Array(36 * this.n), KB = _kb, K = this.K;
    for (let e = 0; e < this.ne; e++) {
      if (this.off[e]) continue;
      const o = e * 36;
      for (let end = 0; end < 2; end++) {
        const node = end ? this.ej[e] : this.ei[e];
        if (node < 0) continue;
        const arm = end ? this.rb : this.ra, rx = arm[e * 3], ry = arm[e * 3 + 1], rz = arm[e * 3 + 2];
        // K·B with B = [[I, X], [0, I]], X = [[0, rz, −ry], [−rz, 0, rx], [ry, −rx, 0]]
        for (let r = 0; r < 6; r++) {
          const k0 = K[o + r * 6], k1 = K[o + r * 6 + 1], k2 = K[o + r * 6 + 2];
          KB[r * 6] = k0; KB[r * 6 + 1] = k1; KB[r * 6 + 2] = k2;
          KB[r * 6 + 3] = -rz * k1 + ry * k2 + K[o + r * 6 + 3];
          KB[r * 6 + 4] = rz * k0 - rx * k2 + K[o + r * 6 + 4];
          KB[r * 6 + 5] = -ry * k0 + rx * k1 + K[o + r * 6 + 5];
        }
        // Bᵀ·(K·B): rows 0–2 unchanged, rows 3–5 = Xᵀ·rows 0–2 + rows 3–5
        const d = node * 36;
        for (let c = 0; c < 6; c++) {
          const a0 = KB[c], a1 = KB[6 + c], a2 = KB[12 + c];
          D[d + c] += a0; D[d + 6 + c] += a1; D[d + 12 + c] += a2;
          D[d + 18 + c] += -rz * a1 + ry * a2 + KB[18 + c];
          D[d + 24 + c] += rz * a0 - rx * a2 + KB[24 + c];
          D[d + 30 + c] += -ry * a0 + rx * a1 + KB[30 + c];
        }
      }
    }
    for (let i = 0; i < this.n; i++) {
      const d = i * 36;
      const t = (D[d] + D[d + 7] + D[d + 14]) / 3, w = (D[d + 21] + D[d + 28] + D[d + 35]) / 3;
      this.reg[2 * i] = 1e-9 * t + 1e-6;
      this.reg[2 * i + 1] = 1e-9 * w + 1e-6;
      for (let k = 0; k < 3; k++) { D[d + k * 7] += this.reg[2 * i]; D[d + 21 + k * 7] += this.reg[2 * i + 1]; }
      if (!inv6(D, d, this.Minv, d)) {
        this.Minv.fill(0, d, d + 36);
        for (let k = 0; k < 6; k++) this.Minv[d + k * 7] = 1 / Math.max(D[d + k * 7], 1e-6);
      }
    }
  }

  private mg: Multigrid | null = null;
  private dense: Float64Array | null = null;

  private applyM(r: Float64Array, z: Float64Array): number {
    if (!this.mg) return this.jacobi(r, z);
    this.mg.vcycle(0, r, z);
    let dot = 0;
    for (let k = 0; k < 6 * this.n; k++) dot += r[k] * z[k];
    return dot;
  }

  /** z = D⁻¹·r (block Jacobi); returns r·z. */
  jacobi(r: Float64Array, z: Float64Array): number {
    const M = this.Minv;
    let dot = 0;
    for (let i = 0; i < this.n; i++) {
      const i6 = i * 6, d = i * 36;
      for (let a = 0; a < 6; a++) {
        const o = d + a * 6;
        const v = M[o] * r[i6] + M[o + 1] * r[i6 + 1] + M[o + 2] * r[i6 + 2] + M[o + 3] * r[i6 + 3] + M[o + 4] * r[i6 + 4] + M[o + 5] * r[i6 + 5];
        z[i6 + a] = v;
        dot += v * r[i6 + a];
      }
    }
    return dot;
  }

  /** (Re)start CG from the current x. */
  start(): void {
    this.started = true;
    this.prepare();
    this.mg = this.n > DIRECT ? new Multigrid(this, this.omega) : null;
    if (this.mg && !this.mg.levels.length) this.mg = null;
    if (this.mg) this.omega = this.mg.levels[0].omega;
    this.dense = !this.mg && this.n <= DIRECT ? denseFactor(this) : null;
    if (this.dense) {
      denseSolve(this.dense, this.load, this.x);
      this.residual = 0;
      this.done = !this.settleTies() || this.passes++ >= 6;
      if (!this.done) this.start();
      return;
    }
    this.mul(this.x, this.q);
    for (let k = 0; k < 6 * this.n; k++) this.r[k] = this.load[k] - this.q[k];
    this.f0 = Math.sqrt(Math.max(this.applyM(this.load, this.z), 1e-30));
    this.rz = this.applyM(this.r, this.z);
    this.p.set(this.z);
    this.residual = Math.sqrt(Math.max(this.rz, 0)) / this.f0;
    this.done = this.residual < this.tol;
  }

  /* Ties went slack or taut: the operator changed by a few axial springs, so the existing preconditioner is
     still a good one and only the Krylov state restarts. */
  private restart(): void {
    if (this.dense) { this.start(); return; }
    this.mul(this.x, this.q);
    for (let k = 0; k < 6 * this.n; k++) this.r[k] = this.load[k] - this.q[k];
    this.rz = this.applyM(this.r, this.z);
    this.p.set(this.z);
    this.residual = Math.sqrt(Math.max(this.rz, 0)) / this.f0;
    this.done = this.residual < this.tol;
  }

  /** Up to `max` CG iterations; true once converged (tension-only elements settled). */
  run(max: number): boolean {
    const { x, r, z, p, q } = this;
    const N = 6 * this.n;
    for (let it = 0; it < max && !this.done; it++) {
      this.mul(p, q);
      let pq = 0;
      for (let k = 0; k < N; k++) pq += p[k] * q[k];
      if (!(pq > 0)) { this.residual = 0; this.done = true; break; }
      const a = this.rz / pq;
      for (let k = 0; k < N; k++) { x[k] += a * p[k]; r[k] -= a * q[k]; }
      const rz = this.applyM(r, z);
      const b = rz / this.rz;
      this.rz = rz;
      for (let k = 0; k < N; k++) p[k] = z[k] + b * p[k];
      this.iterations++;
      this.residual = Math.sqrt(Math.max(rz, 0)) / this.f0;
      if (this.residual < this.tol) this.done = true;
    }
    if (this.done && this.passes < 6 && this.settleTies()) { this.passes++; stats.restarts++; this.restart(); return this.done; }
    return this.done;
  }

  solve(maxIter = 20000): boolean {
    this.passes = 0;
    this.start();
    while (!this.run(256) && this.iterations < maxIter) { /* keep going */ }
    return this.done;
  }

  /** Slack ropes/ties carry nothing; taut ones come back. True if any changed. */
  private settleTies(): boolean {
    let changed = false;
    const s = _s6;
    for (let e = 0; e < this.ne; e++) {
      if (!this.tonly[e]) continue;
      this.jump(e, s);
      const el = s[0] * this.axis[e * 3] + s[1] * this.axis[e * 3 + 1] + s[2] * this.axis[e * 3 + 2];
      const slack = el < 0;
      if (slack !== !!this.off[e]) { this.off[e] = slack ? 1 : 0; changed = true; }
    }
    return changed;
  }

  jump(e: number, s: Float64Array): void {
    const x = this.x, i6 = this.ei[e] * 6, j = this.ej[e], e3 = e * 3;
    const ax = this.ra[e3], ay = this.ra[e3 + 1], az = this.ra[e3 + 2];
    s[0] = -(x[i6] + x[i6 + 4] * az - x[i6 + 5] * ay);
    s[1] = -(x[i6 + 1] + x[i6 + 5] * ax - x[i6 + 3] * az);
    s[2] = -(x[i6 + 2] + x[i6 + 3] * ay - x[i6 + 4] * ax);
    s[3] = -x[i6 + 3]; s[4] = -x[i6 + 4]; s[5] = -x[i6 + 5];
    if (j < 0) return;
    const j6 = j * 6, bx = this.rb[e3], by = this.rb[e3 + 1], bz = this.rb[e3 + 2];
    s[0] += x[j6] + x[j6 + 4] * bz - x[j6 + 5] * by;
    s[1] += x[j6 + 1] + x[j6 + 5] * bx - x[j6 + 3] * bz;
    s[2] += x[j6 + 2] + x[j6 + 3] * by - x[j6 + 4] * bx;
    s[3] += x[j6 + 3]; s[4] += x[j6 + 4]; s[5] += x[j6 + 5];
  }

  /** Force and moment element e exerts on its j side, at the attachment point (N, N·m). */
  force(e: number, out: Float64Array): Float64Array {
    if (this.off[e]) { out.fill(0); return out; }
    const s = _s6;
    this.jump(e, s);
    const o = e * 36;
    for (let r = 0; r < 6; r++) {
      let v = 0;
      for (let k = 0; k < 6; k++) v += this.K[o + r * 6 + k] * s[k];
      out[r] = -v;
    }
    return out;
  }
}
const _s6 = new Float64Array(6), _kb = new Float64Array(36);

/* ---------------- aggregation multigrid ---------------- */

const DIRECT = 24;             // frames up to this many nodes are factorised outright

/* Dense Cholesky of a small frame's stiffness (assembled column by column through mul). */
function denseFactor(f: Frame): Float64Array {
  const N = 6 * f.n, A = new Float64Array(N * N), e = new Float64Array(N), col = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    e.fill(0); e[k] = 1;
    f.mul(e, col);
    for (let i = 0; i < N; i++) A[i * N + k] = col[i];
  }
  for (let j = 0; j < N; j++) {
    let d = A[j * N + j];
    for (let k = 0; k < j; k++) d -= A[j * N + k] ** 2;
    d = Math.sqrt(Math.max(d, 1e-300));
    A[j * N + j] = d;
    for (let i = j + 1; i < N; i++) {
      let v = A[i * N + j];
      for (let k = 0; k < j; k++) v -= A[i * N + k] * A[j * N + k];
      A[i * N + j] = v / d;
    }
  }
  return A;
}

function denseSolve(L: Float64Array, b: Float64Array, x: Float64Array): void {
  const N = b.length;
  for (let i = 0; i < N; i++) {
    let v = b[i];
    for (let k = 0; k < i; k++) v -= L[i * N + k] * x[k];
    x[i] = v / L[i * N + i];
  }
  for (let i = N - 1; i >= 0; i--) {
    let v = x[i];
    for (let k = i + 1; k < N; k++) v -= L[k * N + i] * x[k];
    x[i] = v / L[i * N + i];
  }
}

interface Level {
  f: Frame;
  /** fine node → aggregate on the next level */
  agg: Int32Array;
  /** fine node offset from its aggregate's centre */
  d: Float64Array;
  omega: number;
  res: Float64Array;
  tmp: Float64Array;
  rc: Float64Array;
  zc: Float64Array;
}

/* Nodes are rigid bodies, so an aggregate's rigid motions are the exact near-null space: restricting
   through them turns the coarse operator into another frame whose nodes are the aggregates and whose
   elements are the joints between aggregates, with arms re-measured from the aggregate centres. */
export class Multigrid {
  levels: Level[] = [];
  coarse: Frame;
  L: Float64Array | null = null;
  cw = 1;

  constructor(fine: Frame, omega0?: number) {
    let f = fine;
    for (;;) {
      const { agg, nc } = aggregate(f);
      if (nc >= f.n * 0.75 || nc < 1) break;
      const X = new Float64Array(3 * nc), cnt = new Float64Array(nc);
      for (let i = 0; i < f.n; i++) { const a = agg[i]; cnt[a]++; for (let k = 0; k < 3; k++) X[a * 3 + k] += f.pos[i * 3 + k]; }
      for (let a = 0; a < nc; a++) for (let k = 0; k < 3; k++) X[a * 3 + k] /= cnt[a];
      const d = new Float64Array(3 * f.n);
      for (let i = 0; i < f.n; i++) for (let k = 0; k < 3; k++) d[i * 3 + k] = f.pos[i * 3 + k] - X[agg[i] * 3 + k];
      let ne = 0;
      for (let e = 0; e < f.ne; e++) if (!f.off[e] && (f.ej[e] < 0 || agg[f.ei[e]] !== agg[f.ej[e]])) ne++;
      const c = new Frame(nc, ne);
      c.pos.set(X);
      let q = 0;
      for (let e = 0; e < f.ne; e++) {
        if (f.off[e]) continue;
        const i = f.ei[e], j = f.ej[e];
        if (j >= 0 && agg[i] === agg[j]) continue;
        c.ei[q] = agg[i]; c.ej[q] = j >= 0 ? agg[j] : -1;
        for (let k = 0; k < 3; k++) {
          c.ra[q * 3 + k] = f.ra[e * 3 + k] + d[i * 3 + k];
          if (j >= 0) c.rb[q * 3 + k] = f.rb[e * 3 + k] + d[j * 3 + k];
        }
        c.K.set(f.K.subarray(e * 36, e * 36 + 36), q * 36);
        q++;
      }
      c.prepare();
      this.levels.push({ f, agg, d, omega: f === fine && omega0 ? omega0 : smootherWeight(f), res: new Float64Array(6 * f.n), tmp: new Float64Array(6 * f.n), rc: new Float64Array(6 * nc), zc: new Float64Array(6 * nc) });
      f = c;
      if (nc <= DIRECT) break;
    }
    this.coarse = f;
    if (!this.levels.length) return;
    // coarsening can stall on odd graphs; a big coarsest level just gets a damped Jacobi sweep
    if (f.n <= DIRECT) this.L = denseFactor(f);
    else this.cw = smootherWeight(f);
  }

  /** Symmetric V-cycle: z ≈ K⁻¹·r at level l. */
  vcycle(l: number, r: Float64Array, z: Float64Array): void {
    if (l === this.levels.length) {
      if (this.L) denseSolve(this.L, r, z);
      else { this.coarse.jacobi(r, z); for (let k = 0; k < z.length; k++) z[k] *= this.cw; }
      return;
    }
    const lv = this.levels[l], f = lv.f, N = 6 * f.n, w = lv.omega;
    f.jacobi(r, z);
    for (let k = 0; k < N; k++) z[k] *= w;
    f.mul(z, lv.tmp);
    for (let k = 0; k < N; k++) lv.res[k] = r[k] - lv.tmp[k];
    restrict(lv, lv.res, lv.rc);
    this.vcycle(l + 1, lv.rc, lv.zc);
    prolongAdd(lv, lv.zc, z);
    f.mul(z, lv.tmp);
    for (let k = 0; k < N; k++) lv.res[k] = r[k] - lv.tmp[k];
    f.jacobi(lv.res, lv.tmp);
    for (let k = 0; k < N; k++) z[k] += w * lv.tmp[k];
  }
}

function restrict(lv: Level, r: Float64Array, rc: Float64Array): void {
  rc.fill(0);
  const { agg, d } = lv;
  for (let i = 0; i < lv.f.n; i++) {
    const a = agg[i] * 6, i6 = i * 6, i3 = i * 3;
    const fx = r[i6], fy = r[i6 + 1], fz = r[i6 + 2], dx = d[i3], dy = d[i3 + 1], dz = d[i3 + 2];
    rc[a] += fx; rc[a + 1] += fy; rc[a + 2] += fz;
    rc[a + 3] += r[i6 + 3] + dy * fz - dz * fy;
    rc[a + 4] += r[i6 + 4] + dz * fx - dx * fz;
    rc[a + 5] += r[i6 + 5] + dx * fy - dy * fx;
  }
}

function prolongAdd(lv: Level, zc: Float64Array, z: Float64Array): void {
  const { agg, d } = lv;
  for (let i = 0; i < lv.f.n; i++) {
    const a = agg[i] * 6, i6 = i * 6, i3 = i * 3;
    const wx = zc[a + 3], wy = zc[a + 4], wz = zc[a + 5], dx = d[i3], dy = d[i3 + 1], dz = d[i3 + 2];
    z[i6] += zc[a] + wy * dz - wz * dy;
    z[i6 + 1] += zc[a + 1] + wz * dx - wx * dz;
    z[i6 + 2] += zc[a + 2] + wx * dy - wy * dx;
    z[i6 + 3] += wx; z[i6 + 4] += wy; z[i6 + 5] += wz;
  }
}

/* Greedy aggregation over the joint graph: seeds with their whole free neighbourhood, then stragglers
   join a neighbouring aggregate. */
function aggregate(f: Frame): { agg: Int32Array; nc: number } {
  const n = f.n, deg = new Int32Array(n + 1);
  for (let e = 0; e < f.ne; e++) if (!f.off[e] && f.ej[e] >= 0) { deg[f.ei[e]]++; deg[f.ej[e]]++; }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
  const adj = new Int32Array(start[n]), fill = start.slice(0, n);
  for (let e = 0; e < f.ne; e++) if (!f.off[e] && f.ej[e] >= 0) { const i = f.ei[e], j = f.ej[e]; adj[fill[i]++] = j; adj[fill[j]++] = i; }
  const agg = new Int32Array(n).fill(-1);
  let nc = 0;
  for (let i = 0; i < n; i++) {
    if (agg[i] >= 0) continue;
    let free = true;
    for (let k = start[i]; k < start[i + 1]; k++) if (agg[adj[k]] >= 0) { free = false; break; }
    if (!free) continue;
    agg[i] = nc;
    for (let k = start[i]; k < start[i + 1]; k++) agg[adj[k]] = nc;
    nc++;
  }
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
    if (agg[i] >= 0) continue;
    for (let k = start[i]; k < start[i + 1]; k++) if (agg[adj[k]] >= 0) { agg[i] = agg[adj[k]]; break; }
  }
  for (let i = 0; i < n; i++) if (agg[i] < 0) agg[i] = nc++;
  return { agg, nc };
}

/* Damped block Jacobi, ω = 4 / (3·λmax(D⁻¹K)) with λmax from a few power iterations. */
function smootherWeight(f: Frame): number {
  const N = 6 * f.n, v = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
  let seed = 12345;
  for (let k = 0; k < N; k++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; v[k] = seed / 0x7fffffff - 0.5; }
  let lam = 1;
  for (let it = 0; it < 8; it++) {
    f.mul(v, y);
    f.jacobi(y, z);
    let nz = 0, nv = 0;
    for (let k = 0; k < N; k++) { nz += z[k] * z[k]; nv += v[k] * v[k]; }
    lam = Math.sqrt(nz / Math.max(nv, 1e-300));
    const s = 1 / Math.sqrt(Math.max(nz, 1e-300));
    for (let k = 0; k < N; k++) v[k] = z[k] * s;
  }
  return 4 / (3 * Math.max(lam, 1e-6));
}

/* ---------------- joint stiffness ---------------- */

/** A flexible length of member from its node to a joint. */
export interface Segment {
  /** arm from the node to the joint, world m */
  r: ArrayLike<number>;
  E: number;
  G: number;
  sec: Section;
  /** world direction of the section's local u axis */
  u: ArrayLike<number>;
}

const _C = new Float64Array(36), _R = new Float64Array(9), _L = new Float64Array(36);

/* Tip compliance of the segment as a cantilever clamped at its node, rotated to world axes and added
   into C (rows: displacement, rotation; columns: force, moment). */
function addSegment(C: Float64Array, s: Segment): void {
  const rx = s.r[0], ry = s.r[1], rz = s.r[2], L = Math.hypot(rx, ry, rz);
  if (L < 1e-5) return;
  // local frame: e along the arm, p = u ⟂ e, q = e × p
  const ex = rx / L, ey = ry / L, ez = rz / L;
  let px = s.u[0], py = s.u[1], pz = s.u[2];
  let d = px * ex + py * ey + pz * ez;
  px -= d * ex; py -= d * ey; pz -= d * ez;
  let pl = Math.hypot(px, py, pz);
  if (pl < 0.3) {
    // u nearly along the arm: any perpendicular will do; the section is then read across the wrong cut anyway
    if (Math.abs(ex) < 0.9) { px = 0; py = -ez; pz = ey; } else { px = ez; py = 0; pz = -ex; }
    d = px * ex + py * ey + pz * ez; px -= d * ex; py -= d * ey; pz -= d * ez; pl = Math.hypot(px, py, pz);
  }
  px /= pl; py /= pl; pz /= pl;
  const qx = ey * pz - ez * py, qy = ez * px - ex * pz, qz = ex * py - ey * px;
  const { E, G, sec } = s;
  // bending in the e–p plane is resisted about q; p's projection of u means Iu is about p
  const Ip = sec.Iu, Iq = sec.Iv;
  _L.fill(0);
  _L[0] = L / (E * sec.A);                                        // axial
  _L[7] = L ** 3 / (3 * E * Iq) + L / (G * sec.As);               // δp from Fp
  _L[14] = L ** 3 / (3 * E * Ip) + L / (G * sec.As);              // δq from Fq
  _L[21] = L / (G * sec.J);                                       // torsion
  _L[28] = L / (E * Ip);                                          // θp from Mp
  _L[35] = L / (E * Iq);                                          // θq from Mq
  const cq = (L * L) / (2 * E * Iq), cp = (L * L) / (2 * E * Ip);
  _L[1 * 6 + 5] = cq; _L[5 * 6 + 1] = cq;                         // δp–Mq, θq–Fp
  _L[2 * 6 + 4] = -cp; _L[4 * 6 + 2] = -cp;                       // δq–Mp, θp–Fq
  _R[0] = ex; _R[1] = px; _R[2] = qx;
  _R[3] = ey; _R[4] = py; _R[5] = qy;
  _R[6] = ez; _R[7] = pz; _R[8] = qz;
  rotateAdd(C, _L);
}

/* C += R·L·Rᵀ blockwise (R acts on both the translational and rotational halves). */
function rotateAdd(C: Float64Array, Lm: Float64Array): void {
  for (let bi = 0; bi < 2; bi++) for (let bj = 0; bj < 2; bj++) {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      let s = 0;
      for (let k = 0; k < 3; k++) {
        const rak = _R[a * 3 + k];
        if (rak === 0) continue;
        for (let l = 0; l < 3; l++) s += rak * Lm[(bi * 3 + k) * 6 + bj * 3 + l] * _R[b * 3 + l];
      }
      C[(bi * 3 + a) * 6 + bj * 3 + b] += s;
    }
  }
}

/** 6×6 world stiffness of a joint: segments a and b (null = rigid ground) in series with the contact layer. */
export function jointStiffness(out: Float64Array, off: number, a: Segment | null, b: Segment | null,
  n: ArrayLike<number>, area: number, Eint: number): boolean {
  _C.fill(0);
  if (a) addSegment(_C, a);
  if (b) addSegment(_C, b);
  // contact layer: patch taken square
  const A = Math.max(area, 1e-4), I = (A * A) / 12, Gint = Eint / 2.5;
  const nx = n[0], ny = n[1], nz = n[2];
  let tx = Math.abs(nx) < 0.9 ? 0 : nz, ty = Math.abs(nx) < 0.9 ? -nz : 0, tz = Math.abs(nx) < 0.9 ? ny : -nx;
  const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
  _L.fill(0);
  _L[0] = LAYER / (Eint * A);
  _L[7] = _L[14] = LAYER / (Gint * A);
  _L[21] = LAYER / (Gint * 0.141 * A * A);
  _L[28] = _L[35] = LAYER / (Eint * I);
  _R[0] = nx; _R[1] = tx; _R[2] = ny * tz - nz * ty;
  _R[3] = ny; _R[4] = ty; _R[5] = nz * tx - nx * tz;
  _R[6] = nz; _R[7] = tz; _R[8] = nx * ty - ny * tx;
  rotateAdd(_C, _L);
  // symmetrise against round-off before inverting
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) { const m = (_C[i * 6 + j] + _C[j * 6 + i]) / 2; _C[i * 6 + j] = _C[j * 6 + i] = m; }
  return inv6(_C, 0, out as Float64Array, off);
}

/* ---------------- members ---------------- */

interface MemberInfo {
  /** local extents */
  dims: Vec3;
  /** section across the member axis (rolled/hollow), or null for a solid envelope */
  sec: Section | null;
  fill: number;
  axis: 0 | 1 | 2;
}

const infoOf = new WeakMap<Piece, MemberInfo>();

function memberInfo(p: Piece): MemberInfo {
  let m = infoOf.get(p);
  if (m) return m;
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const f of p.poly.faces) for (let i = 0; i < f.pts.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = f.pts[i + k];
    if (v < lo[k]) lo[k] = v;
    if (v > hi[k]) hi[k] = v;
  }
  const dims: Vec3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const spec = p.root.spec;
  const sec = p.depth === 0 ? sectionOf(spec) : null;
  const fill = sec ? sec.fill : Math.min(1, p.volume / Math.max(dims[0] * dims[1] * dims[2], 1e-9));
  const axis = sec ? sec.axis : dims[0] >= dims[1] && dims[0] >= dims[2] ? 0 : dims[1] >= dims[2] ? 1 : 2;
  m = { dims, sec, fill, axis };
  infoOf.set(p, m);
  return m;
}

function rotate(out: number[] | Float64Array, q: Quat, v: ArrayLike<number>): void {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  out[0] = v[0] + w * tx + (y * tz - z * ty);
  out[1] = v[1] + w * ty + (z * tx - x * tz);
  out[2] = v[2] + w * tz + (x * ty - y * tx);
}

function toLocalDir(out: number[], q: Quat, v: ArrayLike<number>): void {
  rotate(out, [-q[0], -q[1], -q[2], q[3]], v);
}

/* Non-structural members sit on gaskets, clips and deflection heads, so a stiff pane or pipe welded into a
   wall carries its own weight and not the building's: glazing on EPDM setting blocks (~0.5 MPa over the
   layer), services on clips and hangers, partitions and tiles on soft fixings. */
const SOFT_BED: Partial<Record<MaterialId, number>> = { glass: 1e5, tempered: 1e5, lamp: 1e5, pvc: 1e5, copper: 1e5, drywall: 1e6, ceramic: 1e6, roof: 1e6 };
function bedding(p: Piece): number | undefined {
  const s = p.root.spec;
  return s.util || s.fixture || s.svcPart ? 1e5 : SOFT_BED[p.mat];
}

/* Struts that fail by elastic buckling: metal and timber members. Masonry, adobe and plain concrete crush or rock
   long before their Euler load, and services, glazing and plates are not struts. */
const STRUTS = new Set<MaterialId>(['steel', 'aluminum', 'castiron', 'wood', 'oak', 'rconcrete']);
function strut(p: Piece): boolean {
  const s = p.root.spec;
  return STRUTS.has(p.mat) && !s.util && !s.fixture && !s.svcPart && !s.mech;
}

/** Young's modulus (Pa) of member p along local axis k, softened by heat. */
function modulus(p: Piece, k: number): number {
  const e = p.pm.eng;
  let E = e.E;
  if (e.perp) {
    const m = memberInfo(p), d = m.dims;
    const grain = e.perp.along === 'axis' ? m.axis : d[0] <= d[1] && d[0] <= d[2] ? 0 : d[1] <= d[2] ? 1 : 2;
    if (e.perp.along === 'axis' ? k !== grain : k === grain) E = e.perp.E;
  }
  return E * 1e9 * Math.max(0.05, p.heatK);
}

const _loc = [0, 0, 0], _uw = [0, 0, 0], _ew: number[] = [0, 0, 0];

/** The flexible length of member p between its centroid and the world point c. */
function segment(p: Piece, c: ArrayLike<number>, com: ArrayLike<number>): Segment {
  const r = [c[0] - com[0], c[1] - com[1], c[2] - com[2]];
  toLocalDir(_loc, p.curRot, r);
  const k = Math.abs(_loc[0]) >= Math.abs(_loc[1]) && Math.abs(_loc[0]) >= Math.abs(_loc[2]) ? 0 : Math.abs(_loc[1]) >= Math.abs(_loc[2]) ? 1 : 2;
  const m = memberInfo(p);
  const ku = (k + 1) % 3, kv = (k + 2) % 3;
  const sec = m.sec && m.sec.axis === k ? m.sec : solidSection(k as 0 | 1 | 2, m.dims[ku], m.dims[kv], m.fill);
  _ew[0] = _ew[1] = _ew[2] = 0; _ew[ku] = 1;
  const u = [0, 0, 0];
  rotate(u, p.curRot, _ew);
  const E = modulus(p, k);
  return { r, E, G: p.pm.eng.perp ? (p.pm.eng.E * 1e9 * Math.max(0.05, p.heatK)) / 16 : E / 2.6, sec, u };
}

/** Euler critical load of a pin-ended strut, N. */
export function eulerLoad(E: number, sec: Section, L: number): number {
  return (Math.PI ** 2 * E * Math.min(sec.Iu, sec.Iv)) / (L * L);
}

/** Second-order moment amplification of a strut under axial load N (uniform first-order moment):
 * (1 + 0.234·α)/(1 − α), α = N/Pcr — within 2% of the secant formula up to α = 0.8. */
export function pDelta(N: number, Pcr: number): number {
  const a = Math.min(N / Pcr, 0.92);
  return a <= 0 ? 1 : (1 + 0.234 * a) / (1 - a);
}

/* ---------------- structures → frames ---------------- */

/** Tension-only link (rope, rebar tie) between two pieces' local anchor points; b null = the ground (lb world). */
export interface Tie { a: Piece; b: Piece | null; la: Vec3; lb: Vec3; alive: boolean; ea: number }

interface Comp {
  pieces: Piece[];
  ties: Tie[];
  /** hung loads on this component's members */
  extra: ExtraLoads;
  frame: Frame | null;
  welds: Weld[];
  dirty: boolean;
  tol: number;
  /** the same structure's previous solve, still running: this one waits for it (changes are batched) */
  pred: Comp | null;
}

const compOf = new WeakMap<Piece, Comp>();
const warm = new WeakMap<Piece, Float64Array>();
let comps: Comp[] = [];
let current = new Set<Comp>();
/* superseded components already part-way through a solve: finished first, so a structure changing every
   step still gets results (at most one solve old) instead of restarting forever */
let finishing: Comp[] = [];
const touched = new Set<Piece>();
let topologyDirty = true;
let omegaHint = new WeakMap<Piece, number>();

/** member axial compression (N, + compression), its Euler load at ambient (N) and length, from the last solve */
export const memberAxial = new WeakMap<Piece, { N: number; Pcr: number; L: number; heatK: number }>();

export const stats = { comps: 0, nodes: 0, elements: 0, solves: 0, iterations: 0, restarts: 0, buildMax: 0, setupMax: 0, iterMax: 0, publishMax: 0, ms: 0, lastMs: 0, maxMs: 0, pending: 0, built: 0, cached: 0 };

export function analysisReset(): void {
  comps = [];
  finishing = [];
  touched.clear();
  topologyDirty = true;
  omegaHint = new WeakMap();
  for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] = 0;
}

/** A weld, tie, load or stiffness changed at p: its component must be re-solved. */
export function analysisTouch(p: Piece | null): void {
  topologyDirty = true;
  if (p) touched.add(p);
}

/** Hung machinery: extra (mass, point) loads on a host member. */
export type ExtraLoads = Map<Piece, { m: number; at: Vec3 }[]>;

const founded = (p: Piece, groundTies: Set<Piece>) => groundTies.has(p) || p.welds.some(w => w.alive && !w.b);

/* Ground-founded welded components; each keeps its frame (and solution) until something in it changes. */
export function analysisPartition(live: Iterable<Piece>, ties: Iterable<Tie>, extra: ExtraLoads, tol = 1e-4): void {
  if (!topologyDirty) return;
  topologyDirty = false;
  const tieOf = new Map<Piece, Tie[]>(), groundTies = new Set<Piece>();
  for (const t of ties) {
    if (!t.alive) continue;
    if (!t.b) { groundTies.add(t.a); }
    for (const p of t.b ? [t.a, t.b] : [t.a]) { const l = tieOf.get(p); if (l) l.push(t); else tieOf.set(p, [t]); }
  }
  const seen = new Set<Piece>();
  const next: Comp[] = [];
  for (const root of live) {
    if (seen.has(root) || root.dead || !founded(root, groundTies)) continue;
    const pieces: Piece[] = [root];
    seen.add(root);
    let fresh = touched.has(root);
    const old = compOf.get(root);
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!fresh && (touched.has(p) || compOf.get(p) !== old)) fresh = true;
      for (const w of p.welds) {
        if (!w.alive) continue;
        const o = w.a === p ? w.b : w.a;
        if (o && !o.dead && !seen.has(o)) { seen.add(o); pieces.push(o); }
      }
      const tl = tieOf.get(p);
      if (tl) for (const t of tl) {
        const o = t.a === p ? t.b : t.a;
        if (o && !o.dead && !seen.has(o)) { seen.add(o); pieces.push(o); }
      }
    }
    if (old && !fresh && old.pieces.length === pieces.length) { next.push(old); continue; }
    let pred: Comp | null = null;
    if (old && old.frame?.started && !old.frame.done) { if (!finishing.includes(old)) finishing.push(old); pred = old; }
    else if (old && !old.frame) pred = old.pred;
    const cties: Tie[] = [], tset = new Set<Tie>(), cextra: ExtraLoads = new Map();
    for (const p of pieces) {
      const tl = tieOf.get(p);
      if (tl) for (const t of tl) if (!tset.has(t)) { tset.add(t); cties.push(t); }
      const h = extra.get(p);
      if (h) cextra.set(p, h);
    }
    const c: Comp = { pieces, ties: cties, extra: cextra, frame: null, welds: [], dirty: true, tol, pred };
    for (const p of pieces) compOf.set(p, c);
    next.push(c);
  }
  comps = next;
  current = new Set(next);
  touched.clear();
  stats.comps = comps.length;
  stats.nodes = comps.reduce((s, c) => s + c.pieces.length, 0);
}

/* Joint stiffness is cached per weld and reused while neither member has turned or changed temperature. */
interface KCache { K: Float64Array; qa: Quat; qb: Quat | null; ka: number; kb: number; kf: number }
const kcache = new WeakMap<Weld, KCache>();
const sameRot = (a: Quat, b: Quat) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 0.99995;

function buildFrame(c: Comp): Frame {
  const { pieces, ties, extra } = c;
  const index = new Map<Piece, number>();
  pieces.forEach((p, i) => index.set(p, i));
  const welds: Weld[] = [];
  for (const p of pieces) for (const w of p.welds) if (w.alive && w.a === p && (!w.b || index.has(w.b))) welds.push(w);
  const live = ties.filter(t => t.alive && index.has(t.a) && (!t.b || index.has(t.b)));
  const n = pieces.length, ne = welds.length + live.length;
  const f = new Frame(n, ne);
  const com = f.pos;
  const c3: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const p = pieces[i];
    b3.b3Body_GetWorldCenterOfMass(c3, p.body);
    com.set(c3, i * 3);
    f.load[i * 6 + 1] = -p.mass * GRAVITY;
    const hung = extra.get(p);
    if (hung) for (const h of hung) {
      const w = h.m * GRAVITY;
      f.load[i * 6 + 1] -= w;
      f.load[i * 6 + 3] += (h.at[2] - c3[2]) * w;   // (at − com) × (0, −w, 0)
      f.load[i * 6 + 5] -= (h.at[0] - c3[0]) * w;
    }
    const x0 = warm.get(p);
    if (x0) f.x.set(x0, i * 6);
  }
  const pt: Vec3 = [0, 0, 0], nw: Vec3 = [0, 0, 0];
  for (let e = 0; e < welds.length; e++) {
    const w = welds[e], a = w.a, b = w.b;
    const i = index.get(a)!, j = b ? index.get(b)! : -1;
    rotate(pt, a.curRot, w.local);
    pt[0] += a.curPos[0]; pt[1] += a.curPos[1]; pt[2] += a.curPos[2];
    f.ei[e] = i; f.ej[e] = j;
    for (let k = 0; k < 3; k++) f.ra[e * 3 + k] = pt[k] - com[i * 3 + k];
    if (j >= 0) for (let k = 0; k < 3; k++) f.rb[e * 3 + k] = pt[k] - com[j * 3 + k];
    const kc = kcache.get(w);
    if (kc && kc.ka === a.heatK && kc.kb === (b ? b.heatK : 1) && kc.kf === w.j.kf && sameRot(kc.qa, a.curRot) && (!b || sameRot(kc.qb!, b.curRot))) {
      f.K.set(kc.K, e * 36);
      stats.cached++;
      continue;
    }
    rotate(nw, a.curRot, w.n);
    const sa = segment(a, pt, com.subarray(i * 3, i * 3 + 3));
    const sb = b ? segment(b, pt, com.subarray(j * 3, j * 3 + 3)) : null;
    // w.j.kf: a nailed or slipped bolted connection is far softer than the members it joins
    if (!jointStiffness(f.K, e * 36, sa, sb, nw, w.area, Math.min(bedding(a) ?? sa.E, b ? bedding(b) ?? sb!.E : 30e9) * w.j.kf)) { f.off[e] = 1; continue; }
    kcache.set(w, { K: f.K.slice(e * 36, e * 36 + 36), qa: [...a.curRot] as Quat, qb: b ? [...b.curRot] as Quat : null, ka: a.heatK, kb: b ? b.heatK : 1, kf: w.j.kf });
    stats.built++;
  }
  const pa: Vec3 = [0, 0, 0], pb: Vec3 = [0, 0, 0];
  for (let t = 0; t < live.length; t++) {
    const tie = live[t], e = welds.length + t;
    const i = index.get(tie.a)!, j = tie.b ? index.get(tie.b)! : -1;
    rotate(pa, tie.a.curRot, tie.la); pa[0] += tie.a.curPos[0]; pa[1] += tie.a.curPos[1]; pa[2] += tie.a.curPos[2];
    if (tie.b) { rotate(pb, tie.b.curRot, tie.lb); pb[0] += tie.b.curPos[0]; pb[1] += tie.b.curPos[1]; pb[2] += tie.b.curPos[2]; }
    else { pb[0] = tie.lb[0]; pb[1] = tie.lb[1]; pb[2] = tie.lb[2]; }
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2], L = Math.max(Math.hypot(dx, dy, dz), 0.05);
    const v = [dx / L, dy / L, dz / L], k = tie.ea / L;
    f.ei[e] = i; f.ej[e] = j;
    for (let q = 0; q < 3; q++) { f.ra[e * 3 + q] = pa[q] - com[i * 3 + q]; if (j >= 0) f.rb[e * 3 + q] = pb[q] - com[j * 3 + q]; }
    f.axis.set(v, e * 3);
    f.tonly[e] = 1;
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) f.K[e * 36 + r * 6 + q] = k * v[r] * v[q];
  }
  f.tol = c.tol;
  f.omega = omegaHint.get(pieces[0]);
  c.welds = welds;
  return f;
}

/* ---------------- solving ---------------- */

export interface Buckle { p: Piece; N: number; Pcr: number }

export interface AnalysisOut {
  /** welds whose static demand was just updated */
  welds: Weld[];
  /** members whose compression reached their Euler load */
  buckled: Buckle[];
}

const _f6 = new Float64Array(6);

/* Work is budgeted in element evaluations, not wall time, so a solve lands on the same step on any machine
   and at any load: collapses replay identically. Rough costs per element: building its stiffness 10 (1 when
   cached), setting up the multigrid 30, one preconditioned CG iteration 5. */
let work = 0;

/* One slice of work on c; true once it has published. */
function advance(c: Comp, budget: number, out: AnalysisOut): boolean {
  if (!c.frame) {
    const cached = stats.cached, tb = performance.now();
    c.frame = buildFrame(c);
    stats.buildMax = Math.max(stats.buildMax, performance.now() - tb);
    work += c.frame.ne * (stats.cached - cached > c.frame.ne / 2 ? 1 : 10);
    // the unsliceable phases (building the frame, setting up its multigrid) each end the step's slice
    if (budget !== Infinity) { work = budget; return false; }
  }
  const f = c.frame;
  if (!f.started) {
    const ts = performance.now();
    f.start();
    stats.setupMax = Math.max(stats.setupMax, performance.now() - ts);
    // a dense factorisation costs ~N³/3 flops (≈ 40 flops per work unit)
    work += f.n <= DIRECT ? (6 * f.n) ** 3 / 120 + 6 * f.n * f.ne * 3 : 30 * f.ne;
    if (f.omega !== undefined) omegaHint.set(c.pieces[0], f.omega);
    if (budget !== Infinity && !f.done) { work = budget; return false; }
  }
  const ti = performance.now();
  while (!f.done && work < budget) {
    const it = f.iterations;
    f.run(budget === Infinity ? 512 : 1);
    work += 5 * f.ne * Math.max(1, f.iterations - it);
  }
  stats.iterMax = Math.max(stats.iterMax, performance.now() - ti);
  return f.done && finish(c, out);
}

function finish(c: Comp, out: AnalysisOut): boolean {
  c.dirty = false;
  stats.solves++;
  stats.iterations += c.frame!.iterations;
  const tp = performance.now();
  publish(c, out);
  stats.publishMax = Math.max(stats.publishMax, performance.now() - tp);
  return true;
}

/** Works through changed components within `budget` element evaluations (to convergence when Infinity). */
export function analysisStep(budget: number, out: AnalysisOut, only?: Set<Piece>): void {
  out.welds.length = 0;
  out.buckled.length = 0;
  const t0 = performance.now();
  work = 0;
  while (finishing.length && work < budget) {
    if (advance(finishing[0], budget, out)) finishing.shift();
    else break;
  }
  let pending = finishing.length;
  for (const c of comps) {
    if (!c.dirty || (only && !c.pieces.some(p => only.has(p)))) continue;
    if (c.pred && finishing.includes(c.pred) && budget !== Infinity) { pending++; continue; }
    if (work >= budget || !advance(c, budget, out)) pending++;
  }
  const dt = performance.now() - t0;
  stats.ms += dt;
  stats.lastMs = dt;
  stats.maxMs = Math.max(stats.maxMs, dt);
  stats.pending = pending;
  stats.elements = comps.reduce((s, c) => s + (c.frame ? c.frame.ne : 0), 0);
}

const _n: number[] = [0, 0, 0];

function publish(c: Comp, out: AnalysisOut): void {
  const f = c.frame!;
  const id = ++solveSeq;
  for (let i = 0; i < c.pieces.length; i++) { warm.set(c.pieces[i], f.x.slice(i * 6, i * 6 + 6)); solveOf.set(c.pieces[i], id); }
  // member axial force at the centroid cut: joints on the member's −axis side push it along +axis
  const axial = new Float64Array(c.pieces.length);
  const axes = c.pieces.map(p => { const a = [0, 0, 0]; _ew[0] = _ew[1] = _ew[2] = 0; _ew[memberInfo(p).axis] = 1; rotate(a, p.curRot, _ew); return a; });
  for (let e = 0; e < f.ne; e++) {
    f.force(e, _f6);
    const i = f.ei[e], j = f.ej[e];
    for (const [node, arm, sign] of [[i, f.ra, -1], [j, f.rb, 1]] as const) {
      if (node < 0) continue;
      const a = axes[node];
      const side = arm[e * 3] * a[0] + arm[e * 3 + 1] * a[1] + arm[e * 3 + 2] * a[2];
      if (side >= 0) continue;
      axial[node] += sign * (_f6[0] * a[0] + _f6[1] * a[1] + _f6[2] * a[2]);
    }
  }
  const amp = new Float64Array(c.pieces.length).fill(1);
  for (let i = 0; i < c.pieces.length; i++) {
    const p = c.pieces[i], m = memberInfo(p), k = m.axis;
    const L = m.dims[k];
    const sec = m.sec ?? solidSection(k, m.dims[(k + 1) % 3], m.dims[(k + 2) % 3], m.fill);
    const I = Math.min(sec.Iu, sec.Iv), rg = Math.sqrt(I / sec.A);
    const Pcr = eulerLoad(modulus(p, k), sec, L);
    const N = axial[i];
    const d = m.dims, second = Math.max(d[(k + 1) % 3], d[(k + 2) % 3]);
    if (!strut(p) || L < 3 * second || L / rg < SLENDER || N <= 0) { memberAxial.delete(p); continue; }
    memberAxial.set(p, { N, Pcr: Pcr / Math.max(0.05, p.heatK), L, heatK: p.heatK });
    if (N >= Pcr) out.buckled.push({ p, N, Pcr });
    amp[i] = pDelta(N, Pcr);
  }
  for (let e = 0; e < c.welds.length; e++) {
    const w = c.welds[e];
    if (!w.alive) continue;
    f.force(e, _f6);
    rotate(_n, w.a.curRot, w.n);
    const N = _f6[0] * _n[0] + _f6[1] * _n[1] + _f6[2] * _n[2];
    const V = Math.sqrt(Math.max(0, _f6[0] ** 2 + _f6[1] ** 2 + _f6[2] ** 2 - N * N));
    const i = f.ei[e], j = f.ej[e];
    const k = Math.max(amp[i], j >= 0 ? amp[j] : 1);
    w.sN = N;
    w.sV = V;
    w.supportForce = Math.hypot(_f6[0], _f6[1], _f6[2]);
    w.supportTorque = Math.hypot(_f6[3], _f6[4], _f6[5]) * k;
    out.welds.push(w);
  }
}

let solveSeq = 0;
const solveOf = new WeakMap<Piece, number>();
/** Id of the last published solve that covered p (one per component solve), or undefined. */
export function solveId(p: Piece): number | undefined {
  return solveOf.get(p);
}

/** Whether p stands in a founded structure, so its welds carry the analysis's static demands (the last solve's
 * while a re-solve is pending), rather than being part of a falling or loose body. */
export function analysed(p: Piece): boolean {
  const c = compOf.get(p);
  return !!c && current.has(c);
}

/** Components still waiting for a converged solution. */
export function analysisPending(): number {
  return finishing.length + comps.reduce((s, c) => s + (c.dirty ? 1 : 0), 0);
}

export function analysisComponents(): readonly { pieces: Piece[]; frame: Frame | null; welds: Weld[] }[] {
  return comps;
}
