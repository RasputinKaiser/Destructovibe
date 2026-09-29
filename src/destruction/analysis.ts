/* Linear-elastic 3D frame analysis of the welded structures.

   Nodes are pieces (rigid bodies, 6 DOF). Each weld is an element: two flexible beam segments, one
   from each member's centroid to the contact point with that member's own E and section (A, I, J,
   shear area), in series with a thin bearing layer over the contact patch. With loads at centroids
   this is exact Euler–Bernoulli/Timoshenko beam theory for members built from any number of pieces,
   and a small contact patch acts as the partial hinge it is. Ropes are tension-only axial elements, rebar
   ties across a crack axial ones (the closed crack bears), and mortar joints that have opened compression-only
   bearings. Static equilibrium under gravity (plus hung machinery) is solved per ground-founded
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
  /** one-way elements: tension-only ties (+1) and compression-only bearings (−1), with their unit axis a→b; `off`
   * while slack or open */
  readonly tonly: Int8Array;
  readonly off: Uint8Array;
  readonly axis: Float64Array;
  readonly Minv: Float64Array;
  readonly reg: Float64Array;
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
    this.tonly = new Int8Array(ne);
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
  get multigrid(): boolean { return !!this.mg; }
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

  private setup: Iterator<void, Multigrid> | null = null;

  /** (Re)start CG from the current x. */
  start(): void {
    while (!this.startSlice()) { /* all phases now */ }
  }

  /** One phase of (re)starting: the multigrid is set up a level at a time. True once CG has started. */
  startSlice(): boolean {
    if (!this.setup) {
      this.prepare();
      if (this.n > DIRECT) { this.setup = new Multigrid().setup(this, this.omega); return false; }
      this.mg = null;
    } else {
      const r = this.setup.next();
      if (!r.done) return false;
      this.setup = null;
      this.mg = r.value.levels.length ? r.value : null;
    }
    this.started = true;
    if (this.mg) this.omega = this.mg.levels[0].omega;
    this.dense = !this.mg && this.n <= DIRECT ? denseFactor(this) : null;
    if (this.dense) {
      denseSolve(this.dense, this.load, this.x);
      this.residual = 0;
      this.done = !this.settleTies() || this.passes++ >= 6;
      if (!this.done) this.start();
      return true;
    }
    this.mul(this.x, this.q);
    for (let k = 0; k < 6 * this.n; k++) this.r[k] = this.load[k] - this.q[k];
    this.f0 = Math.sqrt(Math.max(this.applyM(this.load, this.z), 1e-30));
    this.rz = this.applyM(this.r, this.z);
    // a warm start from a structure that has since changed shape can be further off than no guess at all
    if (this.rz > this.f0 * this.f0) { this.x.fill(0); this.r.set(this.load); this.rz = this.applyM(this.r, this.z); }
    this.p.set(this.z);
    this.residual = Math.sqrt(Math.max(this.rz, 0)) / this.f0;
    this.done = this.residual < this.tol;
    return true;
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

  /** Slack ropes/ties and open bearings carry nothing; taut and closed ones come back. True if any changed. */
  private settleTies(): boolean {
    let changed = false;
    const s = _s6;
    for (let e = 0; e < this.ne; e++) {
      if (!this.tonly[e]) continue;
      this.jump(e, s);
      const el = s[0] * this.axis[e * 3] + s[1] * this.axis[e * 3 + 1] + s[2] * this.axis[e * 3 + 2];
      const slack = el * this.tonly[e] < 0;
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

/* ---------------- smoothed-aggregation multigrid ---------------- */

const DIRECT = 24;             // frames up to this many nodes are factorised outright

/** What a multigrid level needs of its operator: y = A·x and z = D⁻¹·r (block Jacobi, returning r·z). */
interface Operator { readonly n: number; mul(x: Float64Array, y: Float64Array): void; jacobi(r: Float64Array, z: Float64Array): number }

/* Dense Cholesky of a small operator (assembled column by column through mul). */
function denseFactor(f: Operator): Float64Array {
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

/* 6×6 block products (row-major): C (+)= A·B, C (+)= Aᵀ·B. */
function mm6(A: Float64Array, ao: number, B: Float64Array, bo: number, C: Float64Array, co: number, s: number): void {
  for (let r = 0; r < 6; r++) {
    const a0 = A[ao + r * 6], a1 = A[ao + r * 6 + 1], a2 = A[ao + r * 6 + 2], a3 = A[ao + r * 6 + 3], a4 = A[ao + r * 6 + 4], a5 = A[ao + r * 6 + 5];
    if (a0 === 0 && a1 === 0 && a2 === 0 && a3 === 0 && a4 === 0 && a5 === 0) continue;
    for (let c = 0; c < 6; c++) {
      C[co + r * 6 + c] += s * (a0 * B[bo + c] + a1 * B[bo + 6 + c] + a2 * B[bo + 12 + c] + a3 * B[bo + 18 + c] + a4 * B[bo + 24 + c] + a5 * B[bo + 30 + c]);
    }
  }
}
function mtm6(A: Float64Array, ao: number, B: Float64Array, bo: number, C: Float64Array, co: number, s: number): void {
  for (let r = 0; r < 6; r++) {
    const a0 = A[ao + r], a1 = A[ao + 6 + r], a2 = A[ao + 12 + r], a3 = A[ao + 18 + r], a4 = A[ao + 24 + r], a5 = A[ao + 30 + r];
    if (a0 === 0 && a1 === 0 && a2 === 0 && a3 === 0 && a4 === 0 && a5 === 0) continue;
    for (let c = 0; c < 6; c++) {
      C[co + r * 6 + c] += s * (a0 * B[bo + c] + a1 * B[bo + 6 + c] + a2 * B[bo + 12 + c] + a3 * B[bo + 18 + c] + a4 * B[bo + 24 + c] + a5 * B[bo + 30 + c]);
    }
  }
}
/** The transfer from a node's (u, θ) to the motion of a point at arm r from it: [[I, −[r]×], [0, I]]. */
function transfer(rx: number, ry: number, rz: number, out: Float64Array, o: number): void {
  out.fill(0, o, o + 36);
  for (let k = 0; k < 6; k++) out[o + k * 7] = 1;
  out[o + 4] = rz; out[o + 5] = -ry;
  out[o + 9] = -rz; out[o + 11] = rx;
  out[o + 15] = ry; out[o + 16] = -rx;
}

/** Growable block rows, filled one row at a time: a marker per column finds the row's block for it. */
class RowBuilder {
  ptr: Int32Array;
  col = new Int32Array(256);
  val = new Float64Array(256 * 36);
  nnz = 0;
  private readonly mark: Int32Array;
  private row = 0;
  constructor(readonly n: number, readonly m: number) {
    this.ptr = new Int32Array(n + 1);
    this.mark = new Int32Array(m).fill(-1);
  }
  /** Offset of block (current row, j), zeroed when first touched. */
  at(j: number): number {
    const s = this.mark[j];
    if (s >= this.ptr[this.row]) return s * 36;
    if (this.nnz === this.col.length) {
      const c = new Int32Array(this.nnz * 2); c.set(this.col); this.col = c;
      const v = new Float64Array(this.nnz * 72); v.set(this.val); this.val = v;
    }
    const k = this.nnz++;
    this.mark[j] = k;
    this.col[k] = j;
    this.val.fill(0, k * 36, k * 36 + 36);
    return k * 36;
  }
  next(): void { this.ptr[++this.row] = this.nnz; }
  done(): BSR { return new BSR(this.n, this.m, this.ptr, this.col.slice(0, this.nnz), this.val.slice(0, this.nnz * 36)); }
}

/** C = A·B for block rows (n×m · m×p). */
function spmm(A: BSR, B: BSR): BSR {
  const C = new RowBuilder(A.n, B.m);
  for (let i = 0; i < A.n; i++) {
    for (let k = A.ptr[i]; k < A.ptr[i + 1]; k++) {
      const j = A.col[k];
      for (let q = B.ptr[j]; q < B.ptr[j + 1]; q++) { const o = C.at(B.col[q]); mm6(A.val, k * 36, B.val, q * 36, C.val, o, 1); }
    }
    C.next();
  }
  return C.done();
}

/** Aᵀ with each block transposed (m×n). */
function transposeBlocks(A: BSR): BSR {
  const ptr = new Int32Array(A.m + 1), nnz = A.ptr[A.n];
  for (let k = 0; k < nnz; k++) ptr[A.col[k] + 1]++;
  for (let j = 0; j < A.m; j++) ptr[j + 1] += ptr[j];
  const fill = ptr.slice(0, A.m), col = new Int32Array(nnz), val = new Float64Array(36 * nnz);
  for (let i = 0; i < A.n; i++) for (let k = A.ptr[i]; k < A.ptr[i + 1]; k++) {
    const t = fill[A.col[k]]++;
    col[t] = i;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) val[t * 36 + c * 6 + r] = A.val[k * 36 + r * 6 + c];
  }
  return new BSR(A.m, A.n, ptr, col, val);
}

class BSR implements Operator {
  Dinv: Float64Array | null = null;
  constructor(readonly n: number, readonly m: number, readonly ptr: Int32Array, readonly col: Int32Array, readonly val: Float64Array) {}
  mul(x: Float64Array, y: Float64Array): void {
    const { ptr, col, val } = this;
    for (let i = 0; i < this.n; i++) {
      let y0 = 0, y1 = 0, y2 = 0, y3 = 0, y4 = 0, y5 = 0;
      for (let k = ptr[i]; k < ptr[i + 1]; k++) {
        const j6 = col[k] * 6, o = k * 36;
        const x0 = x[j6], x1 = x[j6 + 1], x2 = x[j6 + 2], x3 = x[j6 + 3], x4 = x[j6 + 4], x5 = x[j6 + 5];
        y0 += val[o] * x0 + val[o + 1] * x1 + val[o + 2] * x2 + val[o + 3] * x3 + val[o + 4] * x4 + val[o + 5] * x5;
        y1 += val[o + 6] * x0 + val[o + 7] * x1 + val[o + 8] * x2 + val[o + 9] * x3 + val[o + 10] * x4 + val[o + 11] * x5;
        y2 += val[o + 12] * x0 + val[o + 13] * x1 + val[o + 14] * x2 + val[o + 15] * x3 + val[o + 16] * x4 + val[o + 17] * x5;
        y3 += val[o + 18] * x0 + val[o + 19] * x1 + val[o + 20] * x2 + val[o + 21] * x3 + val[o + 22] * x4 + val[o + 23] * x5;
        y4 += val[o + 24] * x0 + val[o + 25] * x1 + val[o + 26] * x2 + val[o + 27] * x3 + val[o + 28] * x4 + val[o + 29] * x5;
        y5 += val[o + 30] * x0 + val[o + 31] * x1 + val[o + 32] * x2 + val[o + 33] * x3 + val[o + 34] * x4 + val[o + 35] * x5;
      }
      const i6 = i * 6;
      y[i6] = y0; y[i6 + 1] = y1; y[i6 + 2] = y2; y[i6 + 3] = y3; y[i6 + 4] = y4; y[i6 + 5] = y5;
    }
  }
  /** y = Aᵀ·x (y has m blocks) */
  mulT(x: Float64Array, y: Float64Array): void {
    const { ptr, col, val } = this;
    y.fill(0);
    for (let i = 0; i < this.n; i++) {
      const i6 = i * 6, x0 = x[i6], x1 = x[i6 + 1], x2 = x[i6 + 2], x3 = x[i6 + 3], x4 = x[i6 + 4], x5 = x[i6 + 5];
      for (let k = ptr[i]; k < ptr[i + 1]; k++) {
        const j6 = col[k] * 6, o = k * 36;
        for (let c = 0; c < 6; c++) y[j6 + c] += val[o + c] * x0 + val[o + 6 + c] * x1 + val[o + 12 + c] * x2 + val[o + 18 + c] * x3 + val[o + 24 + c] * x4 + val[o + 30 + c] * x5;
      }
    }
  }
  /** y += A·x */
  mulAdd(x: Float64Array, y: Float64Array): void {
    const { ptr, col, val } = this;
    for (let i = 0; i < this.n; i++) {
      const i6 = i * 6;
      for (let k = ptr[i]; k < ptr[i + 1]; k++) {
        const j6 = col[k] * 6, o = k * 36;
        for (let r = 0; r < 6; r++) y[i6 + r] += val[o + r * 6] * x[j6] + val[o + r * 6 + 1] * x[j6 + 1] + val[o + r * 6 + 2] * x[j6 + 2] + val[o + r * 6 + 3] * x[j6 + 3] + val[o + r * 6 + 4] * x[j6 + 4] + val[o + r * 6 + 5] * x[j6 + 5];
      }
    }
  }
  prepare(): void {
    const D = new Float64Array(36 * this.n);
    for (let i = 0; i < this.n; i++) for (let k = this.ptr[i]; k < this.ptr[i + 1]; k++) {
      if (this.col[k] !== i) continue;
      if (!inv6(this.val, k * 36, D, i * 36)) for (let q = 0; q < 6; q++) D[i * 36 + q * 7] = 1 / Math.max(this.val[k * 36 + q * 7], 1e-6);
    }
    this.Dinv = D;
  }
  jacobi(r: Float64Array, z: Float64Array): number {
    return blockJacobi(this.Dinv!, this.n, r, z);
  }
}

function blockJacobi(M: Float64Array, n: number, r: Float64Array, z: Float64Array): number {
  let dot = 0;
  for (let i = 0; i < n; i++) {
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

/** A frame's stiffness as block rows: element e adds Tᵢᵀ K Tᵢ, −Tᵢᵀ K Tⱼ, … through the transfers to its attachment. */
function assemble(f: Frame): BSR {
  const n = f.n, deg = new Int32Array(n + 1);
  for (let e = 0; e < f.ne; e++) {
    if (f.off[e]) continue;
    deg[f.ei[e] + 1]++;
    if (f.ej[e] >= 0) deg[f.ej[e] + 1]++;
  }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const els = new Int32Array(deg[n]), fill = deg.slice(0, n);
  for (let e = 0; e < f.ne; e++) {
    if (f.off[e]) continue;
    els[fill[f.ei[e]]++] = e;
    if (f.ej[e] >= 0) els[fill[f.ej[e]]++] = e;
  }
  const B = new RowBuilder(n, n), Ti = new Float64Array(36), To = new Float64Array(36), KT = new Float64Array(36);
  for (let i = 0; i < n; i++) {
    let o = B.at(i);
    const v = B.val, t = f.reg[2 * i], w = f.reg[2 * i + 1];
    for (let k = 0; k < 3; k++) { v[o + k * 7] += t; v[o + 21 + k * 7] += w; }
    for (let q = deg[i]; q < deg[i + 1]; q++) {
      const e = els[q], e3 = e * 3, first = f.ei[e] === i, j = first ? f.ej[e] : f.ei[e];
      const arm = first ? f.ra : f.rb;
      transfer(arm[e3], arm[e3 + 1], arm[e3 + 2], Ti, 0);
      KT.fill(0); mm6(f.K, e * 36, Ti, 0, KT, 0, 1);
      o = B.at(i); mtm6(Ti, 0, KT, 0, B.val, o, 1);
      if (j < 0) continue;
      const oa = first ? f.rb : f.ra;
      transfer(oa[e3], oa[e3 + 1], oa[e3 + 2], To, 0);
      KT.fill(0); mm6(f.K, e * 36, To, 0, KT, 0, 1);
      o = B.at(j); mtm6(Ti, 0, KT, 0, B.val, o, -1);
    }
    B.next();
  }
  return B.done();
}

/* Nodes by position (mm grid), bottom up: the structure's own order, independent of how its pieces were listed, so the
   same structure gets the same hierarchy (and the same converged demands) however it was assembled. */
function spatialOrder(pos: Float64Array, n: number): Int32Array {
  const key = new Float64Array(3 * n), order = new Int32Array(n);
  for (let i = 0; i < n; i++) { order[i] = i; for (let k = 0; k < 3; k++) key[i * 3 + k] = Math.round(pos[i * 3 + k] * 1000); }
  order.sort((a, b) => key[a * 3 + 1] - key[b * 3 + 1] || key[a * 3] - key[b * 3] || key[a * 3 + 2] - key[b * 3 + 2] || a - b);
  return order;
}

/* Greedy aggregation over the block graph: seeds with their whole free neighbourhood, then stragglers join a
   neighbouring aggregate. */
function aggregate(A: BSR, pos: Float64Array): { agg: Int32Array; nc: number } {
  const n = A.n, order = spatialOrder(pos, n), agg = new Int32Array(n).fill(-1);
  let nc = 0;
  for (let t = 0; t < n; t++) {
    const i = order[t];
    if (agg[i] >= 0) continue;
    let free = true;
    for (let k = A.ptr[i]; k < A.ptr[i + 1]; k++) if (agg[A.col[k]] >= 0) { free = false; break; }
    if (!free) continue;
    for (let k = A.ptr[i]; k < A.ptr[i + 1]; k++) agg[A.col[k]] = nc;
    nc++;
  }
  for (let pass = 0; pass < 2; pass++) for (let t = 0; t < n; t++) {
    const i = order[t];
    if (agg[i] >= 0) continue;
    for (let k = A.ptr[i]; k < A.ptr[i + 1]; k++) if (agg[A.col[k]] >= 0) { agg[i] = agg[A.col[k]]; break; }
  }
  for (let t = 0; t < n; t++) if (agg[order[t]] < 0) agg[order[t]] = nc++;
  return { agg, nc };
}

/* Damped block Jacobi, ω = 4 / (3·λmax(D⁻¹K)) with λmax from a few power iterations. */
function smootherWeight(f: Operator): number {
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

interface Level {
  op: Operator;
  /** prolongation from the next level: fine node rows × aggregate columns */
  P: BSR;
  omega: number;
  res: Float64Array;
  tmp: Float64Array;
  rc: Float64Array;
  zc: Float64Array;
}

/* Smoothed aggregation. Nodes are rigid bodies, so an aggregate's rigid motions are the exact near-null space; the
   tentative prolongator moves each node with its aggregate, and one damped-Jacobi pass over it (P = (I − ωD⁻¹K)·P₀)
   lets neighbouring aggregates bend into each other, which is what the frame's slow error looks like. The coarse
   operator is Pᵀ·K·P. A floor hanging off a cracked core converges in a quarter of the iterations the plain
   aggregation took, which is the difference between a load path found in tenths of a second and in seconds. */
export class Multigrid {
  levels: Level[] = [];
  coarse: Operator | null = null;
  L: Float64Array | null = null;
  cw = 1;

  /** Builds the hierarchy under `fine`, yielding between phases (assembly, and each level's prolongator and coarse
   * operator) so a big structure's setup spreads over a few steps instead of stalling one. */
  *setup(fine: Frame, omega0?: number): Generator<void, Multigrid> {
    let op: Operator = fine, A = assemble(fine), pos = fine.pos, Dinv = fine.Minv;
    yield;
    for (let depth = 0; ; depth++) {
      const { agg, nc } = aggregate(A, pos);
      if (nc >= op.n * 0.75 || nc < 1) break;
      const omega = depth === 0 && omega0 ? omega0 : smootherWeight(op);
      // tentative transfer of each node to its aggregate's centre, smoothed by one Jacobi pass
      const X = new Float64Array(3 * nc), cnt = new Float64Array(nc);
      for (let i = 0; i < op.n; i++) { const a = agg[i]; cnt[a]++; for (let k = 0; k < 3; k++) X[a * 3 + k] += pos[i * 3 + k]; }
      for (let a = 0; a < nc; a++) for (let k = 0; k < 3; k++) X[a * 3 + k] /= cnt[a];
      const T0 = new Float64Array(36 * op.n);
      for (let i = 0; i < op.n; i++) { const a = agg[i] * 3; transfer(pos[i * 3] - X[a], pos[i * 3 + 1] - X[a + 1], pos[i * 3 + 2] - X[a + 2], T0, i * 36); }
      const T = new RowBuilder(op.n, nc);
      for (let i = 0; i < op.n; i++) { const o = T.at(agg[i]); T.val.set(T0.subarray(i * 36, i * 36 + 36), o); T.next(); }
      const P = spmm(A, T.done()), tmp = new Float64Array(36);
      for (let i = 0; i < op.n; i++) {
        for (let k = P.ptr[i]; k < P.ptr[i + 1]; k++) {
          tmp.fill(0); mm6(Dinv, i * 36, P.val, k * 36, tmp, 0, -omega);
          if (P.col[k] === agg[i]) for (let q = 0; q < 36; q++) tmp[q] += T0[i * 36 + q];
          P.val.set(tmp, k * 36);
        }
      }
      yield;
      // Galerkin coarse operator Pᵀ·(A·P)
      const Ac = spmm(transposeBlocks(P), spmm(A, P));
      Ac.prepare();
      yield;
      this.levels.push({ op, P, omega, res: new Float64Array(6 * op.n), tmp: new Float64Array(6 * op.n), rc: new Float64Array(6 * nc), zc: new Float64Array(6 * nc) });
      op = Ac; A = Ac; pos = X; Dinv = Ac.Dinv!;
      if (nc <= DIRECT) break;
    }
    this.coarse = op;
    if (!this.levels.length) return this;
    // coarsening can stall on odd graphs; a big coarsest level just gets a damped Jacobi sweep
    if (op.n <= DIRECT) this.L = denseFactor(op);
    else this.cw = smootherWeight(op);
    return this;
  }

  /** Symmetric V-cycle: z ≈ K⁻¹·r at level l. */
  vcycle(l: number, r: Float64Array, z: Float64Array): void {
    if (l === this.levels.length) {
      if (this.L) denseSolve(this.L, r, z);
      else { this.coarse!.jacobi(r, z); for (let k = 0; k < z.length; k++) z[k] *= this.cw; }
      return;
    }
    const lv = this.levels[l], f = lv.op, N = 6 * f.n, w = lv.omega;
    f.jacobi(r, z);
    for (let k = 0; k < N; k++) z[k] *= w;
    f.mul(z, lv.tmp);
    for (let k = 0; k < N; k++) lv.res[k] = r[k] - lv.tmp[k];
    lv.P.mulT(lv.res, lv.rc);
    this.vcycle(l + 1, lv.rc, lv.zc);
    lv.P.mulAdd(lv.zc, z);
    f.mul(z, lv.tmp);
    for (let k = 0; k < N; k++) lv.res[k] = r[k] - lv.tmp[k];
    f.jacobi(lv.res, lv.tmp);
    for (let k = 0; k < N; k++) z[k] += w * lv.tmp[k];
  }
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

/** Axial link (rope, rebar tie) between two pieces' local anchor points; b null = the ground (lb world). Tension-only
 * unless `bears`: bars across a closed crack also push, as the crack faces bear on each other. */
export interface Tie { a: Piece; b: Piece | null; la: Vec3; lb: Vec3; alive: boolean; ea: number; bears?: boolean }

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
  /** pieces hanging off it by ropes or bars alone: their weight is among `extra`, they are not nodes */
  hung: Piece[];
  /** touched since it was partitioned: superseded at the next partition */
  changed: boolean;
  /** opened joints that still bear in compression */
  bearings: Weld[];
  /** analysis step until which its re-solve is urgent (a continuous frame failing now) */
  urgent: number;
  /** share of its welds that are ductile (a continuous frame), from its last frame */
  ductile: number;
}

const compOf = new WeakMap<Piece, Comp>();
const hungOn = new WeakMap<Piece, Comp>();
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

export const stats = { stalls: 0, comps: 0, nodes: 0, elements: 0, solves: 0, iterations: 0, restarts: 0, buildMax: 0, setupMax: 0, iterMax: 0, publishMax: 0, ms: 0, lastMs: 0, maxMs: 0, pending: 0, built: 0, cached: 0 };

export function analysisReset(): void {
  comps = [];
  finishing = [];
  debt = 0;
  touched.clear();
  topologyDirty = true;
  omegaHint = new WeakMap();
  for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] = 0;
}

/** A weld, tie, load or stiffness changed at p: its component must be re-solved. */
export function analysisTouch(p: Piece | null): void {
  topologyDirty = true;
  if (!p) return;
  touched.add(p);
  const c = compOf.get(p) ?? hungOn.get(p);
  if (c) c.changed = true;
}

/** Hung machinery: extra (mass, point) loads on a host member. */
export type ExtraLoads = Map<Piece, { m: number; at: Vec3 }[]>;

interface Island { pieces: Piece[]; founded: boolean; comp: number }

const _at: Vec3 = [0, 0, 0];
function tieEnd(t: Tie, p: Piece, out: Vec3): Vec3 {
  const l = t.a === p ? t.la : t.lb;
  rotate(out, p.curRot, l);
  out[0] += p.curPos[0]; out[1] += p.curPos[1]; out[2] += p.curPos[2];
  return out;
}

/* Ground-founded welded components; each keeps its frame (and solution) until something in it changes. Only the
   components a change touched are traced again: a collapsing tower re-partitions itself, not the whole site.
   A welded island founded on the ground is a structure; ties between two such islands join them. An island held up
   by ropes or bars alone (a cracked chunk dangling on its rebar, a load on a sling) is a pendulum, statically just
   its weight on the anchor: as nodes on tension-only links it would be a mechanism the solver crawls through. */
export function analysisPartition(live: Iterable<Piece>, ties: Iterable<Tie>, extra: ExtraLoads, tol = 1e-4, bearings: Iterable<Weld> = []): void {
  if (!topologyDirty) return;
  topologyDirty = false;
  const bearOf = new Map<Piece, Weld[]>();
  for (const w of bearings) {
    if (w.a.dead || w.b?.dead) continue;
    for (const p of w.b ? [w.a, w.b] : [w.a]) { const l = bearOf.get(p); if (l) l.push(w); else bearOf.set(p, [w]); }
  }
  const tieOf = new Map<Piece, Tie[]>();
  for (const t of ties) {
    if (!t.alive) continue;
    for (const p of t.b ? [t.a, t.b] : [t.a]) { const l = tieOf.get(p); if (l) l.push(t); else tieOf.set(p, [t]); }
  }
  const list: Piece[] = [];
  let gone: Set<Comp> | null = null;
  const drop = (c: Comp) => {
    if (gone!.has(c)) return;
    gone!.add(c);
    for (const q of c.pieces) list.push(q);
    for (const q of c.hung) list.push(q);
  };
  const owner = (p: Piece): Comp | undefined => {
    const c = compOf.get(p) ?? hungOn.get(p);
    return c && current.has(c) ? c : undefined;
  };
  if (comps.length) {
    gone = new Set();
    for (const p of touched) { const c = owner(p); if (c) drop(c); else list.push(p); }
  } else for (const p of live) list.push(p);

  /* welded islands, and the ties between them */
  const islandOf = new Map<Piece, Island>();
  const islands: Island[] = [];
  for (let s = 0; s < list.length; s++) {
    const root = list[s];
    if (root.dead || islandOf.has(root)) continue;
    const isl: Island = { pieces: [root], founded: false, comp: -1 };
    islandOf.set(root, isl);
    islands.push(isl);
    for (let i = 0; i < isl.pieces.length; i++) {
      const p = isl.pieces[i];
      for (const w of p.welds) {
        if (!w.alive) continue;
        const o = w.a === p ? w.b : w.a;
        if (!o) { isl.founded = true; continue; }
        if (!o.dead && !islandOf.has(o)) { islandOf.set(o, isl); isl.pieces.push(o); }
      }
      const bl = bearOf.get(p);
      if (bl) for (const w of bl) {
        const o = w.a === p ? w.b : w.a;
        if (!o) { isl.founded = true; continue; }
        if (!islandOf.has(o)) { islandOf.set(o, isl); isl.pieces.push(o); }
      }
      const tl = tieOf.get(p);
      if (tl) for (const t of tl) { const o = t.a === p ? t.b : t.a; if (o && !o.dead && !islandOf.has(o)) list.push(o); }
    }
    // a new connection can join an untouched structure to a changed one: that one is superseded too
    if (gone) for (const p of isl.pieces) { const c = owner(p); if (c) drop(c); }
  }
  /* o: the island at the tie's far end; undefined for the ground, null for a piece that is gone */
  const others = (isl: Island, visit: (t: Tie, from: Piece, o: Island | null | undefined) => void) => {
    for (const p of isl.pieces) {
      const tl = tieOf.get(p);
      if (tl) for (const t of tl) { const o = t.a === p ? t.b : t.a; visit(t, p, o ? islandOf.get(o) ?? null : undefined); }
    }
  };

  const next: Comp[] = [];
  for (const seed of islands) {
    if (!seed.founded || seed.comp >= 0) continue;
    seed.comp = next.length;
    const group = [seed];
    for (let g = 0; g < group.length; g++) others(group[g], (_t, _p, o) => { if (o && o.founded && o.comp < 0) { o.comp = seed.comp; group.push(o); } });
    const pieces: Piece[] = [];
    for (const isl of group) for (const p of isl.pieces) pieces.push(p);
    const cextra: ExtraLoads = new Map();
    for (const p of pieces) { const h = extra.get(p); if (h) cextra.set(p, h.slice()); }
    /* what hangs off it, and what hangs off that: each island's weight goes to the anchors holding it up */
    const hangs: { isl: Island; parent: number; mass: number; anchors: { p: Piece; at: Vec3 }[] }[] = [];
    const hangIdx = new Map<Island, number>();
    for (let g = 0; g < group.length + hangs.length; g++) {
      const from = g < group.length ? group[g] : hangs[g - group.length].isl, fi = g < group.length ? -1 : g - group.length;
      others(from, (t, p, o) => {
        if (!o || o.founded) return;
        let k = hangIdx.get(o);
        if (k === undefined) {
          if (o.comp >= 0) return;
          o.comp = seed.comp;
          k = hangs.length;
          hangIdx.set(o, k);
          hangs.push({ isl: o, parent: fi, mass: o.pieces.reduce((m, q) => m + q.mass, 0), anchors: [] });
        }
        if (fi < 0) hangs[k].anchors.push({ p, at: [...tieEnd(t, p, _at)] as Vec3 });
      });
    }
    const hung: Piece[] = [];
    for (let k = hangs.length - 1; k >= 0; k--) {
      const h = hangs[k];
      for (const q of h.isl.pieces) hung.push(q);
      if (!h.anchors.length) { if (h.parent >= 0) hangs[h.parent].mass += h.mass; continue; }
      for (const an of h.anchors) {
        const l = cextra.get(an.p), load = { m: h.mass / h.anchors.length, at: an.at };
        if (l) l.push(load); else cextra.set(an.p, [load]);
      }
    }
    const cties: Tie[] = [], tset = new Set<Tie>();
    for (const isl of group) others(isl, (t, _p, o) => { if ((o === undefined || o && o.comp === seed.comp && o.founded) && !tset.has(t)) { tset.add(t); cties.push(t); } });

    const old = compOf.get(pieces[0]);
    let fresh = false;
    for (const p of pieces) if (touched.has(p) || compOf.get(p) !== old) { fresh = true; break; }
    if (!fresh) for (const p of hung) if (touched.has(p) || hungOn.get(p) !== old) { fresh = true; break; }
    if (old && !fresh && old.pieces.length === pieces.length && old.hung.length === hung.length) { next.push(old); continue; }
    let pred: Comp | null = null;
    /* a frame already built is solved to the end even if it is not yet started: dropping it would restart a
       structure that changes every step (a collapse) from scratch forever, and it would never be analysed */
    if (old && old.frame && !old.frame.done) { if (!finishing.includes(old)) finishing.push(old); pred = old; }
    else if (old && !old.frame) pred = old.pred;
    const cbear: Weld[] = [];
    for (const isl of group) for (const p of isl.pieces) { const bl = bearOf.get(p); if (bl) for (const w of bl) if (w.a === p || !islandOf.has(w.a)) cbear.push(w); }
    const c: Comp = { pieces, ties: cties, extra: cextra, frame: null, welds: [], dirty: true, tol, pred, hung, changed: false, bearings: cbear, urgent: old ? old.urgent : -1, ductile: old ? old.ductile : 0 };
    for (const p of pieces) { compOf.set(p, c); hungOn.delete(p); }
    for (const p of hung) { hungOn.set(p, c); compOf.delete(p); }
    next.push(c);
  }
  comps = gone ? comps.filter(c => !gone.has(c)).concat(next) : next;
  current = new Set(comps);
  touched.clear();
  stats.comps = comps.length;
  stats.nodes = comps.reduce((s, c) => s + c.pieces.length, 0);
}

/* Joint stiffness is cached per weld and reused while neither member has turned or changed temperature. */
interface KCache { K: Float64Array; qa: Quat; qb: Quat | null; ka: number; kb: number; kf: number }
const kcache = new WeakMap<Weld, KCache>();
/* a body's centre of mass in its own frame: fixed by its shapes, which never change after creation */
const localCom = new WeakMap<Piece, Vec3>();
const sameRot = (a: Quat, b: Quat) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 0.99995;

function buildFrame(c: Comp): Frame {
  const { pieces, ties, extra } = c;
  const index = new Map<Piece, number>();
  pieces.forEach((p, i) => index.set(p, i));
  const welds: Weld[] = [];
  for (const p of pieces) for (const w of p.welds) if (w.alive && w.a === p && (!w.b || index.has(w.b))) welds.push(w);
  const live = ties.filter(t => t.alive && index.has(t.a) && (!t.b || index.has(t.b)));
  const bear = c.bearings.filter(w => index.has(w.a) && (!w.b || index.has(w.b)));
  const n = pieces.length, ne = welds.length + live.length + bear.length;
  const f = new Frame(n, ne);
  const com = f.pos;
  const c3: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const p = pieces[i];
    let lc = localCom.get(p);
    if (!lc) { lc = b3.b3Body_GetLocalCenterOfMass([0, 0, 0], p.body) as Vec3; localCom.set(p, lc); }
    rotate(c3, p.curRot, lc);
    c3[0] += p.curPos[0]; c3[1] += p.curPos[1]; c3[2] += p.curPos[2];
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
  const e0 = welds.length + live.length;
  for (let q = 0; q < welds.length + bear.length; q++) {
    const e = q < welds.length ? q : e0 + q - welds.length;
    const w = q < welds.length ? welds[q] : bear[q - welds.length], a = w.a, b = w.b;
    if (q >= welds.length) {
      rotate(nw, a.curRot, w.n);
      f.axis.set(nw, e * 3);
      f.tonly[e] = -1;
    }
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
    f.tonly[e] = tie.bears ? 0 : 1;
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) f.K[e * 36 + r * 6 + q] = k * v[r] * v[q];
  }
  f.tol = c.tol;
  f.omega = omegaHint.get(pieces[0]);
  c.welds = welds;
  let duct = 0;
  for (const w of welds) if (w.ductile) duct++;
  c.ductile = welds.length ? duct / welds.length : 0;
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
   cached), each phase of setting up the multigrid 30, one multigrid-preconditioned CG iteration 8 (5 plain). An iteration that overruns a step's
   budget (a big structure) is paid back from the next steps', so the average holds. */
let work = 0;
let debt = 0;

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
  while (!f.started) {
    const ts = performance.now();
    const up = f.startSlice();
    stats.setupMax = Math.max(stats.setupMax, performance.now() - ts);
    // a dense factorisation costs ~N³/3 flops (≈ 40 flops per work unit); each multigrid phase ~30 per element
    work += f.n <= DIRECT ? (6 * f.n) ** 3 / 120 + 6 * f.n * f.ne * 3 : 30 * f.ne;
    if (!up) { if (budget !== Infinity) { work = budget; return false; } continue; }
    if (f.omega !== undefined) omegaHint.set(c.pieces[0], f.omega);
    if (budget !== Infinity && !f.done) { work = budget; return false; }
  }
  const ti = performance.now(), per = f.multigrid ? 8 : 5;
  while (!f.done && work < budget) {
    const it = f.iterations;
    f.run(budget === Infinity ? 512 : 1);
    work += per * f.ne * Math.max(1, f.iterations - it);
  }
  stats.iterMax = Math.max(stats.iterMax, performance.now() - ti);
  if (!f.done && budget !== Infinity && f.iterations >= MAX_ITERS) {
    /* A frame that will not settle is a mechanism or all but one: it is coming down, and Box3D is already moving it.
       A superseded solve is dropped; a current one publishes if it is close, else keeps its last demands. */
    stats.stalls++;
    if (finishing.includes(c) || f.residual > STALL_PUBLISH) { c.dirty = false; return true; }
    return finish(c, out);
  }
  return f.done && finish(c, out);
}
const MAX_ITERS = 250, STALL_PUBLISH = 0.02;

function finish(c: Comp, out: AnalysisOut): boolean {
  c.dirty = false;
  stats.solves++;
  stats.iterations += c.frame!.iterations;
  const tp = performance.now();
  publish(c, out);
  stats.publishMax = Math.max(stats.publishMax, performance.now() - tp);
  return true;
}

/** A continuous frame holding p is failing now: its re-solve (and the superseded one it waits on) gets `boost`× the
 * work for the next `steps` analysis steps. Frames that are mostly masonry are left at their own pace. */
export function analysisUrgent(p: Piece, steps: number): void {
  const c = compOf.get(p);
  if (!c || !current.has(c) || c.ductile < 0.5) return;
  c.urgent = clock + steps;
  if (c.pred) c.pred.urgent = clock + steps;
}
let clock = 0;

/** Works through changed components within `budget` element evaluations (to convergence when Infinity), and up to
 * `boost`× that for urgent ones. */
export function analysisStep(budget: number, out: AnalysisOut, only?: Set<Piece>, boost = 1): void {
  out.welds.length = 0;
  out.buckled.length = 0;
  clock++;
  const t0 = performance.now();
  work = budget === Infinity ? 0 : debt;
  let limit = budget;
  const room = (c: Comp) => { const r = c.urgent >= clock ? budget * boost : budget; if (r > limit) limit = r; return r; };
  while (finishing.length && work < room(finishing[0])) {
    if (advance(finishing[0], room(finishing[0]), out)) finishing.shift();
    else break;
  }
  let pending = finishing.length;
  for (const c of comps) {
    if (!c.dirty || (only && !c.pieces.some(p => only.has(p)))) continue;
    if (c.pred && finishing.includes(c.pred) && budget !== Infinity) { pending++; continue; }
    // superseded at the next partition (some of its pieces may be gone): not worth building
    if (c.changed && !c.frame) { pending++; continue; }
    if (work >= room(c) || !advance(c, room(c), out)) pending++;
  }
  if (budget !== Infinity) debt = Math.max(0, work - limit);
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
  const id: Solve = { id: ++solveSeq };
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
    const sF = w.sF ?? (w.sF = new Float64Array(7));
    sF.set(_f6); sF[6] = k;
    out.welds.push(w);
  }
}

let solveSeq = 0;
/** One published component solve; it lives as long as some piece's latest solve is this one. */
export interface Solve { readonly id: number }
const solveOf = new WeakMap<Piece, Solve>();
/** The last published solve that covered p (one per component solve), or undefined. */
export function solveOfPiece(p: Piece): Solve | undefined {
  return solveOf.get(p);
}

/** Whether p stands in a founded structure, so its welds carry the analysis's static demands (the last solve's
 * while a re-solve is pending), rather than being part of a falling or loose body. */
export function analysed(p: Piece): boolean {
  const c = compOf.get(p);
  return c && current.has(c) ? true : bornInto(p);
}

/* A piece made since the last partition (a fragment rewelded where its parent stood) stands with the structure it
   is welded to until the next partition places it. */
function bornInto(p: Piece): boolean {
  if (!touched.has(p)) return false;
  for (const w of p.welds) {
    if (!w.alive) continue;
    const o = w.a === p ? w.b : w.a;
    if (!o) return true;
    const oc = compOf.get(o);
    if (oc && current.has(oc)) return true;
  }
  return false;
}

/** Whether p's structure has changed since its last published solve, so its static demands are out of date. */
export function analysisStale(p: Piece): boolean {
  const c = compOf.get(p);
  return c && current.has(c) ? c.dirty || c.changed : bornInto(p);
}

/** Components still waiting for a converged solution. */
export function analysisPending(): number {
  return finishing.length + comps.reduce((s, c) => s + (c.dirty ? 1 : 0), 0);
}

export function analysisComponents(): readonly { pieces: Piece[]; frame: Frame | null; welds: Weld[] }[] {
  return comps;
}
