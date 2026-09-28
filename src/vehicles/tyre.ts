/* Tyre: a brush-like carcass with relaxation lengths. The tread deflections dx, dy (m) are the state: they build
   with slip velocity and relax over the relaxation length as the tyre rolls, so at speed the force follows slip
   ratio and slip angle, and at a standstill the carcass is a spring anchored to the road (no creep, no jitter).
   Combined slip is normalised by each direction's stiffness and passed through one Magic-Formula curve, which is
   the friction ellipse. */

/** Magic Formula shape: sliding friction is sin(C·π/2) ≈ 0.89 of peak, peak at u ≈ 3.4 (normalised slip). */
const C = 1.35, B = 1 / C;
export const U_PEAK = C * Math.tan(Math.PI / 2 / C);
const U_MAX = 7;

export function magic(u: number): number {
  return Math.sin(C * Math.atan(B * u));
}

export interface TyreState {
  dx: number; dy: number;
  /** tread temperature °C, wear 0 new .. 1 bald / failed, pressure bar */
  temp: number; wear: number; bar: number;
  /** last forces and slip (for tests, fx and HUD) */
  fx: number; fy: number; slip: number; slipPower: number;
}

export function newTyre(bar: number): TyreState {
  return { dx: 0, dy: 0, temp: 25, wear: 0, bar, fx: 0, fy: 0, slip: 0, slipPower: 0 };
}

/** Grip multiplier for tread temperature: a road tyre works from ~40 to ~100 °C; frozen or overheated tread loses grip. */
export function thermalGrip(t: number): number {
  const d = t < 10 ? Math.min(1, (10 - t) / 30) : 0;
  return (1 - 0.1 * d) * (t > 110 ? Math.max(0.6, 1 - (t - 110) / 150) : 1);
}

export interface TyreInput {
  /** contact-patch velocity along / across the wheel, m/s */
  vx: number; vy: number;
  fz: number; mu: number;
  /** stiffness N (per unit slip), relaxation lengths m */
  kx: number; ky: number; lx: number; ly: number;
  /** carcass damping at walking pace, N·s/m */
  cx: number; cy: number;
  h: number;
}

/** the wheel the tyre sits on: spin rad/s, inertia, rolling radius, drive torque and Coulomb resistance (brake + rolling) */
export interface WheelSpin { omega: number; I: number; r: number; T: number; R: number }

const out = { fx: 0, fy: 0, u: 0, dx: 0, dy: 0 };

/** Advance tyre and wheel spin by h seconds; returns the road force on the wheel (fx forward, fy to the right) plus the
    carcass damping (dx, dy) that acts on the body at walking pace, where rolling no longer relaxes the tread. The tread
    deflection and the wheel spin are solved together implicitly (a stiff tyre on a light wheel rings otherwise). */
export function tyreStep(t: TyreState, i: TyreInput, w: WheelSpin): typeof out {
  const ax = Math.abs(i.vx), h = i.h, K = i.kx / i.lx;
  t.dx = (t.dx + h * w.r * (w.omega + (h * w.T) / w.I) - h * i.vx) / (1 + (h * ax) / i.lx + (h * h * w.r * w.r * K) / w.I);
  t.dy = (t.dy + h * i.vy) / (1 + (h * ax) / i.ly);
  const cap = i.mu * i.fz;
  out.dx = out.dy = 0;
  if (cap <= 0) {
    t.dx = t.dy = 0; out.fx = out.fy = out.u = 0;
    spin(w, h, 0);
    return out;
  }
  const ux = (K * t.dx) / cap, uy = (i.ky * t.dy) / i.ly / cap;
  let u = Math.hypot(ux, uy);
  const n = u;
  if (u > U_MAX) {
    const k = U_MAX / u;
    t.dx *= k; t.dy *= k;
    u = U_MAX;
  }
  const f = n > 1e-9 ? (cap * magic(u)) / n : 0;
  out.fx = f * ux;
  out.fy = -f * uy;
  out.u = u;
  spin(w, h, out.fx);
  const low = Math.max(0, 1 - ax / 3);
  if (low > 0 && u < 2) {
    out.dx = low * i.cx * (w.omega * w.r - i.vx);
    out.dy = -low * i.cy * i.vy;
    const m = Math.hypot(out.fx + out.dx, out.fy + out.dy);
    if (m > cap) { out.dx *= (0.5 * cap) / m; out.dy *= (0.5 * cap) / m; }
  }
  return out;
}

function spin(w: WheelSpin, h: number, fx: number): void {
  w.omega += (h * (w.T - fx * w.r)) / w.I;
  const d = (h * w.R) / w.I;
  w.omega = Math.abs(w.omega) <= d ? 0 : w.omega - Math.sign(w.omega) * d;
}
