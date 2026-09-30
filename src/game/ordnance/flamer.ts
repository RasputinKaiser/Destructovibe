/* Portable flamethrower (M2-2 pattern): 15 L of thickened fuel in the back tanks, pushed by compressed air out of the
   gun at ~1.8 L/s, lit at the nozzle by the igniter. The stream is a rope of burning gel that flies ~37 m on the
   best elevation and ~15-20 m nearly flat, sags, splashes and clings where it lands (fuel.ts). A tank is ~8 s of
   trigger time; then the pack is swapped. RMB closes the igniter for a wet shot: unlit fuel soaks the target and
   goes up when a lit burst (or any flame) reaches it. */
import { vec3, clamp } from 'math';
import type { Vec3, ToolReadout } from '../../types';
import { raycast, randomStream, stepCount } from '../../physics/physics';
import { pieceOf } from '../../destruction/structure';
import { audio } from '../../audio/audio';
import { NO_HIT } from '../tools/common';
import { launchFuel, GEL, fuelStats, fuelBurning } from './fuel';

export const FLAMER = {
  tank: 15.1,      // L of thickened fuel (M2-2: 4 US gal)
  flow: 1.8,       // L/s: a load in 8-9 s of trigger (TM 3-376A)
  v0: 34,          // m/s leaving the nozzle
  drag: 0.03,      // 1/m: a coherent rope of gel, slowed and stretched by the air
  swap: 6,         // s to change the pack
};

export const flamerHooks = {
  /** take a spare pack from the loadout; false when none is left */
  consume: (): boolean => true,
  kick: (_k: number): void => {},
};

let tank: number = FLAMER.tank;
let lit = true;
let heldAt = -9, now = 0, swapUntil = -1, startedAt = -9, sfxT = 0, burst = 0;
const eye: Vec3 = [0, 0, 0], dir: Vec3 = [0, 0, 1], nozzle: Vec3 = [0, 0, 0], pv: Vec3 = [0, 0, 0];
const rnd = randomStream(0xf1a3);

export function clearFlamer(): void {
  tank = FLAMER.tank;
  lit = true;
  heldAt = -9; now = 0; swapUntil = -1; startedAt = -9; burst = 0;
}

export function flamerLit(): boolean { return lit; }
export function toggleIgniter(): boolean { lit = !lit; return lit; }
export function flamerOn(): boolean { return now - heldAt < 0.05 && tank > 0 && swapUntil < 0; }
export function flamerTank(): number { return tank; }

/** Trigger held this frame: where the gun is and where it points (and the carrier's own velocity). */
export function flamerHold(eyePos: Vec3, fwd: Vec3, muzzle: Vec3, vel: ArrayLike<number>): string | null {
  vec3.copy(eye, eyePos);
  vec3.copy(dir, fwd);
  vec3.copy(nozzle, muzzle);
  pv[0] = vel[0]; pv[1] = vel[1]; pv[2] = vel[2];
  if (swapUntil >= 0) return null;
  if (tank <= 0) {
    if (!flamerHooks.consume()) return 'Flamethrower: fuel pack empty and no spare issued';
    swapUntil = now + FLAMER.swap;
    audio.toolEvent('swap', eye);
    return null;
  }
  if (now - heldAt > 0.1) { startedAt = now; burst++; }
  heldAt = now;
  return null;
}

/** One physics step: one glob of fuel per step while the trigger is held. */
export function flamerStep(dt: number): void {
  now += dt;
  if (swapUntil >= 0 && now >= swapUntil) { swapUntil = -1; tank = FLAMER.tank; }
  const on = flamerOn();
  sfxT -= dt;
  if (sfxT <= 0) {
    sfxT = 0.1;
    audio.rig('flamer', nozzle, on ? 1 : 0, on ? 1 : 0);
    if (on && lit) audio.gasJet(nozzle, 1.6);
  }
  if (!on) return;
  const L = Math.min(tank, FLAMER.flow * dt);
  tank -= L;
  // the gun wanders a little in the hands under the reaction (≈ ṁ·v ≈ 60 N), and the stream's own wobble
  rnd.at(stepCount, burst);
  const w = 0.012, t = now - startedAt;
  const a = 0.6 * Math.sin(t * 13) + (rnd() - 0.5), b = 0.6 * Math.cos(t * 9) + (rnd() - 0.5);
  const d: Vec3 = [dir[0] + a * w, dir[1] + b * w, dir[2] - a * w];
  vec3.normalize(d, d);
  // the first ~0.15 s of a burst leaves at low pressure while the valve opens
  const v = FLAMER.v0 * clamp(0.4 + (t / 0.15) * 0.6, 0.4, 1);
  launchFuel(nozzle, [d[0] * v + pv[0], d[1] * v + pv[1], d[2] * v + pv[2]], L * GEL.rho / 1000, GEL, lit, FLAMER.drag);
  flamerHooks.kick(0.012);
}

/** Aim preview: the stream's path from the nozzle to what it lands on. */
export function traceFlame(from: Vec3, aim: Vec3, pts: number[]): { point: Vec3; normal: Vec3; dist: number; mat: string | null } | null {
  const p: Vec3 = [...from], v: Vec3 = [aim[0] * FLAMER.v0, aim[1] * FLAMER.v0, aim[2] * FLAMER.v0];
  const h = 1 / 30, k = FLAMER.drag;
  pts.length = 0;
  pts.push(p[0], p[1], p[2]);
  let dist = 0;
  for (let i = 0; i < 120; i++) {
    const s = vec3.length(v);
    v[0] -= k * s * v[0] * h; v[1] -= (k * s * v[1] + 9.81) * h; v[2] -= k * s * v[2] * h;
    const t: Vec3 = [v[0] * h, v[1] * h, v[2] * h];
    const r = raycast(p, t, NO_HIT);
    if (r) {
      pts.push(r.point[0], r.point[1], r.point[2]);
      return { point: [r.point[0], r.point[1], r.point[2]], normal: [r.normal[0], r.normal[1], r.normal[2]], dist: dist + vec3.length(t) * r.fraction, mat: pieceOf(r.entity)?.mat ?? null };
    }
    dist += vec3.length(t);
    vec3.add(p, p, t);
    pts.push(p[0], p[1], p[2]);
    if (p[1] < -5) break;
  }
  return null;
}

export function flamerStatus(landing: { dist: number; mat: string | null } | null, spare: number): ToolReadout {
  if (swapUntil >= 0) {
    return { title: 'Flamethrower · changing the pack', progress: 1 - (swapUntil - now) / FLAMER.swap, detail: `fresh ${FLAMER.tank} L pack going on${spare >= 0 ? ` · ${spare} spare` : ''}`, warn: true };
  }
  const on = flamerOn();
  const reach = landing ? `stream lands ${Math.round(landing.dist)} m${landing.mat ? ` on ${landing.mat}` : ''}` : 'stream: no landing in range';
  const fires = fuelBurning();
  return {
    title: `Flamethrower · ${tank.toFixed(1)} L${lit ? '' : ' · WET SHOT (igniter off)'}`,
    progress: tank / FLAMER.tank,
    detail: `${reach} · ${(tank / FLAMER.flow).toFixed(1)} s of fuel${spare >= 0 ? ` · ${spare} spare pack${spare === 1 ? '' : 's'}` : ''} · RMB igniter${fires ? ` · ${fires} fire${fires === 1 ? '' : 's'}, ${fuelStats.MW.toFixed(1)} MW` : ''}`,
    warn: !on && tank < FLAMER.flow * 1.5,
  };
}
