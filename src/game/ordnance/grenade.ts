/* 40 mm low-velocity grenade (M406 HE pattern): 227 g, 76 m/s, arms after 14-27 m of flight (spin-armed), 32 g of
   Composition B throwing 300+ fragments at ~1500 m/s, lethal to ~5 m. Against a building it is light: the fragments
   pock and chip, break glass and thin boards, and the 43 g TNT-equivalent blast only rattles what stands next to it.
   Fuzed point-detonating, or programmed to burst in the air at a set range (over a wall, into a room). */
import { vec3, clamp } from 'math';
import type { Vec3 } from '../../types';
import { raycast, randomStream, stepCount } from '../../physics/physics';
import { explode, damagePiece, pieceOf, applyImpulseAt } from '../../destruction/structure';
import { isFragile } from '../../sim/fields/index';
import { fx } from '../../render/fx';
import { strikes } from '../../render/strikes';
import { NO_HIT } from '../tools/common';

export const GRENADE = {
  mass: 0.227, d: 0.04, v0: 76, cd: 0.35,
  arm: 18,              // m of flight before the fuze is armed (14-27 m)
  tnt: 0.032 * 1.35,    // kg TNT-eq: 32 g Comp B (RE ~1.35)
  frags: 300, fragMass: 0.00025, fragV: 1524,
  rays: 28,             // fragment directions traced (each carries frags/rays)
  reach: 25,            // m a fragment is traced
  airburst: [10, 150],  // programmable burst range, m
};

const rnd = randomStream(0x40a0);
const blast = { radius: 3.1 * Math.cbrt(GRENADE.tnt), power: 60e3 * GRENADE.tnt, impulse: 2150 * Math.sqrt(GRENADE.tnt) };

/** The burst: the fill's blast and the case's fragments, sprayed about the axis of flight (a nose-on round throws its
 * fragments out sideways and forward; an airburst sprays the ground below). */
export function grenadeBurst(pos: Vec3, vel: Vec3, airburst: boolean): number {
  explode(pos, blast.radius, blast.power, blast.impulse, 0.5, 2);
  rnd.at(pos[0], pos[1], pos[2], stepCount);
  const s = vec3.length(vel) || 1;
  const ax: Vec3 = [vel[0] / s, vel[1] / s, vel[2] / s];
  let hits = 0;
  const per = GRENADE.frags / GRENADE.rays;
  for (let i = 0; i < GRENADE.rays; i++) {
    // uniform over the sphere, weighted toward the belt round the axis where a cylindrical case throws most
    let d: Vec3 = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    const along = vec3.dot(d, ax);
    vec3.scaleAndAdd(d, d, ax, -0.6 * along);
    if (airburst) d[1] -= 0.5;
    if (vec3.length(d) < 1e-3) d = [0, -1, 0];
    vec3.normalize(d, d);
    const hit = raycast(pos, [d[0] * GRENADE.reach, d[1] * GRENADE.reach, d[2] * GRENADE.reach], NO_HIT);
    const end: Vec3 = hit ? [hit.point[0], hit.point[1], hit.point[2]] : [pos[0] + d[0] * 6, pos[1] + d[1] * 6, pos[2] + d[2] * 6];
    fx.fragTrace(pos, end, !!hit);
    if (!hit) continue;
    const dist = hit.fraction * GRENADE.reach;
    // a steel splinter loses speed fast in air: ~ exp(-x / 30 m) for a quarter-gram fragment
    const v = GRENADE.fragV * Math.exp(-dist / 30);
    const E = per * 0.5 * GRENADE.fragMass * v * v;
    const q = pieceOf(hit.entity);
    const n = hit.normal as Vec3;
    if (!q) { fx.impact(hit.point as Vec3, n, 'concrete', 0.15); continue; }
    hits++;
    if (isFragile(q)) damagePiece(q, hit.point as Vec3, q.hp * 1.5, true);
    else {
      damagePiece(q, hit.point as Vec3, E, false);
      if (!q.welds.length && q.mass < 30) applyImpulseAt(q, [d[0] * per * GRENADE.fragMass * v, d[1] * per * GRENADE.fragMass * v, d[2] * per * GRENADE.fragMass * v], hit.point as Vec3);
    }
    if (!q.dead) strikes.add(q, hit.point as Vec3, n, clamp(0.04 + E / 4e4, 0.05, 0.14));
    fx.impact(hit.point as Vec3, n, q.mat, clamp(E / 3000, 0.1, 0.5));
  }
  return hits;
}
