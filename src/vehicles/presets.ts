import type { VehicleModel } from '../types';

/* Real-vehicle numbers per model. Local positions are vehicle-frame metres: x forward from the wheelbase centre,
   y up from the ground, z to the right. */
export interface Preset {
  /** engine: rated power kW at rpmP, peak torque N·m at rpmT, redline and idle rpm, flywheel + crank inertia kg·m² */
  kW: number; rpmP: number; Tpk: number; rpmT: number; redline: number; idle: number; Ie: number;
  fuel: 'petrol' | 'diesel'; tank: number;
  gears: number[]; final: number; reverse: number; shift: number; eff: number;
  /** viscous limited-slip coupling across a driven axle, N·m per rad/s (0 = open differential) */
  lsd: number;
  /** body bounce frequency, Hz (front, rear), damping ratio, travel above and below the ride height, m */
  hz: [number, number]; zeta: number; bump: number; droop: number;
  /** anti-roll bars as a share of one corner's spring rate (front, rear): more roll stiffness in front for stable understeer */
  arb: [number, number];
  /** chassis torsional stiffness, N·m/rad (front axle line against the rear) */
  torsion: number;
  /** service brake capacity per wheel, N·m (front, rear); handbrake per rear wheel; parking brake per park wheel */
  brake: [number, number]; hand: number;
  /** tyre: longitudinal / cornering stiffness per unit load, relaxation lengths (m), nominal pressure (bar), rim / tyre radius */
  cx: number; cy: number; relax: [number, number]; bar: number; rim: number;
  /** tyre compound: peak grip over the surface's reference friction (car tyres ~1.1 on dry asphalt, truck tyres ~0.85) */
  grip: number;
  /** aerodynamic drag area Cd·A, m² */
  CdA: number;
  /** max road-wheel steer, rad */
  steer: number;
  /** crumple members: mean crush force (N, whole front or rear) and crush depth (m) */
  crush: { F: number; depth: number };
  /** components in the vehicle frame: engine bay, radiator, fuel tank (when no tank piece), driver's eye */
  engine: [number, number, number]; radiator: [number, number, number]; tankAt: [number, number, number]; eye: [number, number, number];
}

const car: Preset = {
  kW: 100, rpmP: 5500, Tpk: 200, rpmT: 2200, redline: 6300, idle: 800, Ie: 0.18, fuel: 'petrol', tank: 50,
  gears: [3.45, 1.95, 1.3, 1.0, 0.8], final: 4.06, reverse: 3.3, shift: 0.25, eff: 0.9, lsd: 0,
  hz: [1.35, 1.5], zeta: 0.3, bump: 0.08, droop: 0.1, arb: [0.9, 0.15], torsion: 1.2e6,
  brake: [2200, 1000], hand: 1500,
  cx: 20, cy: 16, relax: [0.15, 0.4], bar: 2.3, rim: 0.62, grip: 1.1, CdA: 0.66, steer: 0.6,
  crush: { F: 1.6e5, depth: 0.55 },
  engine: [1.55, 0.7, 0], radiator: [1.95, 0.55, 0], tankAt: [-1.1, 0.35, 0.3], eye: [-0.1, 1.2, 0.38],
};

const P: Record<VehicleModel, Preset> = {
  car,
  van: {
    ...car, kW: 100, rpmP: 3800, Tpk: 330, rpmT: 1800, redline: 4500, idle: 750, Ie: 0.3, fuel: 'diesel', tank: 70,
    gears: [4.1, 2.3, 1.45, 1.0, 0.78], final: 3.9, reverse: 3.8,
    hz: [1.4, 1.6], zeta: 0.32, bump: 0.09, droop: 0.1, torsion: 0.9e6, brake: [3000, 1600], hand: 2200,
    cx: 18, cy: 13, relax: [0.18, 0.5], bar: 3.5, rim: 0.66, grip: 1.0, CdA: 1.25, steer: 0.6,
    crush: { F: 2.2e5, depth: 0.5 },
    engine: [1.8, 0.8, 0], radiator: [2.25, 0.65, 0], tankAt: [-0.6, 0.4, 0.4], eye: [0.3, 1.75, 0.5],
  },
  bus: {
    ...car, kW: 220, rpmP: 2000, Tpk: 1200, rpmT: 1200, redline: 2300, idle: 600, Ie: 1.8, fuel: 'diesel', tank: 300,
    gears: [3.5, 2.0, 1.4, 1.0, 0.75], final: 4.8, reverse: 3.5, shift: 0.5, lsd: 0,
    hz: [1.2, 1.25], zeta: 0.3, bump: 0.1, droop: 0.1, arb: [0.8, 0.3], torsion: 2e6, brake: [9000, 9000], hand: 12000,
    cx: 12, cy: 9, relax: [0.3, 0.7], bar: 8.5, rim: 0.7, grip: 0.85, CdA: 4.5, steer: 0.62,
    crush: { F: 6e5, depth: 0.3 },
    engine: [-5, 1, 0], radiator: [-5.3, 1, 0], tankAt: [1.5, 0.7, -1.0], eye: [5.1, 2.2, 0.7],
  },
  lorry: {
    ...car, kW: 240, rpmP: 1900, Tpk: 1500, rpmT: 1200, redline: 2200, idle: 600, Ie: 2.2, fuel: 'diesel', tank: 300,
    gears: [6.5, 4.2, 2.8, 1.9, 1.35, 1.0], final: 3.9, reverse: 6.0, shift: 0.6, lsd: 3000,
    hz: [1.9, 1.8], zeta: 0.35, bump: 0.1, droop: 0.1, arb: [0.8, 0.3], torsion: 3e5, brake: [11000, 11000], hand: 14000,
    cx: 12, cy: 9, relax: [0.3, 0.7], bar: 8.5, rim: 0.7, grip: 0.85, CdA: 6, steer: 0.6,
    crush: { F: 8e5, depth: 0.25 },
    engine: [3.3, 0.9, 0], radiator: [4.1, 0.9, 0], tankAt: [1.65, 0.9, 0.9], eye: [3.8, 2.4, 0.7],
  },
  dumptruck: {
    ...car, kW: 380, rpmP: 2000, Tpk: 2400, rpmT: 1300, redline: 2200, idle: 650, Ie: 3.5, fuel: 'diesel', tank: 400,
    gears: [5.5, 3.5, 2.3, 1.5, 1.0], final: 9, reverse: 5.5, shift: 0.7, lsd: 8000,
    hz: [2.0, 2.2], zeta: 0.4, bump: 0.1, droop: 0.1, arb: [0.5, 0.2], torsion: 1.5e6, brake: [30000, 30000], hand: 40000,
    cx: 10, cy: 8, relax: [0.4, 0.9], bar: 6, rim: 0.65, grip: 0.85, CdA: 9, steer: 0.55,
    crush: { F: 1.5e6, depth: 0.2 },
    engine: [2.2, 1.2, 0], radiator: [2.9, 1.0, 0], tankAt: [0, 1.2, -0.9], eye: [2.3, 2.6, -0.5],
  },
  mixer: {
    ...car, kW: 280, rpmP: 1900, Tpk: 1800, rpmT: 1200, redline: 2200, idle: 600, Ie: 2.5, fuel: 'diesel', tank: 300,
    gears: [6.5, 4.2, 2.8, 1.9, 1.35, 1.0], final: 4.3, reverse: 6.0, shift: 0.6, lsd: 3000,
    hz: [1.9, 1.9], zeta: 0.35, bump: 0.1, droop: 0.1, arb: [0.8, 0.3], torsion: 4e5, brake: [16000, 16000], hand: 20000,
    cx: 12, cy: 9, relax: [0.3, 0.7], bar: 8.5, rim: 0.7, grip: 0.85, CdA: 7, steer: 0.6,
    crush: { F: 1e6, depth: 0.25 },
    engine: [2.8, 0.9, 0], radiator: [3.4, 0.9, 0], tankAt: [0.4, 0.8, 0.8], eye: [2.9, 2.3, 0.6],
  },
  crane: {
    ...car, kW: 400, rpmP: 1900, Tpk: 2500, rpmT: 1200, redline: 2200, idle: 600, Ie: 3.5, fuel: 'diesel', tank: 400,
    gears: [6.5, 4.2, 2.8, 1.9, 1.35, 1.0], final: 5, reverse: 6.0, shift: 0.6, lsd: 6000,
    hz: [2.2, 2.2], zeta: 0.4, bump: 0.08, droop: 0.08, arb: [0.8, 0.3], torsion: 2e6, brake: [20000, 20000], hand: 25000,
    cx: 12, cy: 9, relax: [0.3, 0.7], bar: 9, rim: 0.7, grip: 0.85, CdA: 8, steer: 0.55,
    crush: { F: 1.5e6, depth: 0.2 },
    engine: [2.5, 1.0, 0.5], radiator: [4.3, 0.9, 0], tankAt: [0.5, 0.9, 1.1], eye: [3.9, 2.3, -0.7],
  },
  forklift: {
    ...car, kW: 45, rpmP: 2400, Tpk: 180, rpmT: 1600, redline: 2600, idle: 750, Ie: 0.4, fuel: 'diesel', tank: 60,
    gears: [1.2, 0.8], final: 14.9, reverse: 1.2, shift: 0.4, lsd: 0,
    hz: [4, 4], zeta: 0.45, bump: 0.02, droop: 0.03, arb: [0, 0], torsion: 5e6, brake: [3000, 0], hand: 0,
    cx: 14, cy: 10, relax: [0.12, 0.3], bar: 9, rim: 0.7, grip: 0.85, CdA: 1.6, steer: 1.2,
    crush: { F: 3e5, depth: 0.1 },
    engine: [-0.6, 0.8, 0], radiator: [-1.1, 0.8, 0], tankAt: [-0.3, 0.6, 0.4], eye: [-0.5, 1.9, 0],
  },
};

export function preset(model: VehicleModel): Preset {
  return P[model] ?? car;
}

/** Engine torque (N·m) at crank speed n (rpm), full load: rises from idle to the torque peak, holds it until the rated
    power is reached (a boosted engine's plateau), then constant power to the power peak and a fall to the redline. */
export function engineTorque(p: Preset, n: number): number {
  const Tp = (p.kW * 1000) / ((p.rpmP * Math.PI) / 30);
  if (n <= p.idle) return 0.6 * p.Tpk;
  if (n <= p.rpmT) return p.Tpk * (0.6 + (0.4 * (n - p.idle)) / (p.rpmT - p.idle));
  if (n <= p.rpmP) return Math.min(p.Tpk, (p.kW * 1000) / ((n * Math.PI) / 30));
  if (n <= p.redline) return Tp * (1 - (0.2 * (n - p.rpmP)) / Math.max(1, p.redline - p.rpmP));
  return 0;
}

/** Closed-throttle friction and pumping torque (engine braking), N·m. */
export function engineDrag(p: Preset, n: number): number {
  return p.Tpk * (0.06 + (0.1 * n) / p.redline);
}
