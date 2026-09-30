/* Pure movement math for the on-foot player: how the feet change the body's horizontal velocity, the jump's ballistic
   arc, and what a landing does to a person. No physics queries, no state: player.ts owns those. Numbers are a fit
   person in work boots on a site (walk-jog 3 m/s, sprint 6.2, a 0.45-0.5 m standing jump, ~0.55 s in the air). */

export const G = 9.81;
/** rising and falling gravity multipliers: a touch over 1 g going up, heavier coming down, so a jump has a real
    human arc (~0.55 s) but lands with weight instead of floating */
export const RISE_G = 1.15, FALL_G = 1.35;
/** terminal speed of a falling person, m/s */
export const TERMINAL = 50;

export const SPEED = { careful: 1.5, crouch: 1.45, jog: 3.0, sprint: 6.2 } as const;

export interface FootParams {
  /** speeding up below jog pace, m/s² */
  accel: number;
  /** speeding up past jog pace (a sprint builds over ~0.6 s), m/s² */
  accelHigh: number;
  /** braking: constant part and the part that grows with speed (a sprinter plants a foot hard), m/s² and 1/s */
  brake: number;
  brakeK: number;
}
export const FOOT: FootParams = { accel: 14, accelHigh: 6.5, brake: 12, brakeK: 1.6 };
/** in the air the only steering is what the body can twist and swing: a little, never more than takeoff speed */
export const AIR_ACCEL = 2.4;

export const clampN = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/**
 * One ground step of horizontal velocity (relative to whatever the player stands on). `wx, wz` is the wished
 * direction (unit, or zero), `target` the speed for this gait. Progress along the wish accelerates at the gait's rate;
 * everything else (sideways drift when turning, overspeed, the old direction on a reversal) brakes at the braking
 * rate, which grows with speed. Returns [vx, vz] in `out`.
 */
export function footStep(out: [number, number], vx: number, vz: number, wx: number, wz: number, target: number, dt: number, p: FootParams = FOOT): [number, number] {
  const wl = Math.hypot(wx, wz);
  let along = 0;
  if (wl > 1e-6) { wx /= wl; wz /= wl; along = vx * wx + vz * wz; } else { wx = wz = 0; }
  const fwd = Math.max(0, along);
  // what is not forward progress along the wish
  let lx = vx - wx * fwd, lz = vz - wz * fwd;
  const ll = Math.hypot(lx, lz), speed = Math.hypot(vx, vz);
  const brake = (p.brake + p.brakeK * speed) * dt;
  if (ll <= brake) { lx = lz = 0; } else { lx -= (lx / ll) * brake; lz -= (lz / ll) * brake; }
  let a = fwd;
  if (a < target) {
    const rate = a < SPEED.jog ? p.accel : p.accelHigh;
    a = Math.min(target, a + rate * dt);
  } else if (a > target) {
    a = Math.max(target, a - brake);
  }
  out[0] = wx * a + lx; out[1] = wz * a + lz;
  return out;
}

/** Air steering: a small push toward the wish, never raising horizontal speed past max(takeoff, target). */
export function airStep(out: [number, number], vx: number, vz: number, wx: number, wz: number, cap: number, dt: number, accel = AIR_ACCEL): [number, number] {
  const before = Math.hypot(vx, vz);
  let ax = vx + wx * accel * dt, az = vz + wz * accel * dt;
  const after = Math.hypot(ax, az), lim = Math.max(before, cap);
  if (after > lim) { ax *= lim / after; az *= lim / after; }
  out[0] = ax; out[1] = az;
  return out;
}

/** vertical acceleration this step, m/s² (negative down); `g` is the world's gravity (sandbox slider) in m/s² */
export function gravityAt(vy: number, g = G): number {
  return -(vy > 0 ? RISE_G : FALL_G) * g;
}

/** takeoff speed for a jump that lifts the feet `h` metres under the rising gravity */
export function jumpSpeed(h: number, g = G): number {
  return Math.sqrt(2 * RISE_G * g * h);
}

/** apex height and total airtime (back to the takeoff height) of a jump with takeoff speed v */
export function jumpArc(v: number, g = G): { height: number; air: number; apex: number } {
  const up = RISE_G * g, down = FALL_G * g;
  const height = (v * v) / (2 * up), apex = v / up;
  return { height, air: apex + Math.sqrt((2 * height) / down), apex };
}

/** the standing jump: 0.48 m of lift */
export const JUMP_H = 0.48;

export type LandTier = 'soft' | 'hard' | 'stumble' | 'knockdown' | 'fatal';
export interface Landing {
  /** equivalent free-fall drop, m: the height a straight fall needs for this impact speed */
  drop: number;
  tier: LandTier;
  /** camera dip, m (down) */
  dip: number;
  /** seconds of slowed recovery after touching down (legs soak it up) */
  recover: number;
  /** speed kept through the recovery, 0..1 */
  keep: number;
  /** seconds knocked down (0 = stays on his feet) */
  down: number;
  /** seconds of limping afterwards */
  limp: number;
}

/**
 * What a landing at vertical impact speed `v` (m/s, positive) does to a person. The drop is measured in the game's
 * own falling gravity, so it is the height actually fallen. Tuck-and-roll (crouch held) takes a fifth off.
 * `mode`: 'off' never hurts (dip and a short recovery only), 'stumble' knocks down but never kills, 'real' blacks out
 * past ~9 m.
 */
export function landing(v: number, crouched: boolean, mode: 'off' | 'stumble' | 'real', g = G): Landing {
  let drop = (v * v) / (2 * FALL_G * g);
  if (crouched) drop *= 0.8;
  const dip = Math.min(0.32, 0.018 + drop * 0.07);
  if (drop < 1.2) return { drop, tier: 'soft', dip, recover: 0.08 + drop * 0.12, keep: 0.8 - drop * 0.15, down: 0, limp: 0 };
  if (drop < 2.5 || mode === 'off') return { drop, tier: 'hard', dip, recover: 0.3 + Math.min(drop, 4) * 0.05, keep: 0.45, down: 0, limp: 0 };
  if (drop < 4.5) return { drop, tier: 'stumble', dip, recover: 0.8, keep: 0.35, down: 0, limp: drop > 3.5 ? 3 : 0 };
  if (drop < 9 || mode === 'stumble') return { drop, tier: 'knockdown', dip, recover: 0.6, keep: 0.4, down: Math.min(4, 1.1 + (drop - 4.5) * 0.35), limp: Math.min(12, 4 + (drop - 4.5)) };
  return { drop, tier: 'fatal', dip, recover: 0, keep: 0, down: 3, limp: 0 };
}

export type HitTier = 'none' | 'stagger' | 'knockdown' | 'fatal';
/**
 * A blow from a moving body: `impulse` N·s delivered to the player, `fromAbove` when it came down on the head and
 * shoulders (a lump off a parapet, a slab), `mass` of the striking body in kg.
 */
export function hitTier(impulse: number, fromAbove: boolean, mass: number, mode: 'off' | 'stumble' | 'real'): HitTier {
  if (mode === 'off') return impulse > 80 ? 'stagger' : 'none';
  const j = fromAbove ? impulse * 1.6 : impulse;
  if (mode === 'real' && fromAbove && mass > 250 && impulse > 400) return 'fatal';
  if (j > 320) return 'knockdown';
  if (j > 45) return 'stagger';
  return 'none';
}
