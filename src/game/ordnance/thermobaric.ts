/* Thermobaric rocket (RPO-A Shmel pattern): 93 mm, 125 m/s, a capsule of fuel that a small burster (1-2 % of the fuel
   mass) throws out as a cloud, lit ~0.1-0.15 s later. The cloud goes into the gas field as fuel vapour (propane-
   equivalent, 46 MJ/kg): it spreads through the open air round the burst, so a room holds it and fills with it and
   an opening lets it out. Lit, the part of it inside its flammable limits burns as a front and the rest as far as the
   air in it allows; the blast is that energy at an explosive efficiency under 40 % (IMAS TNMA 09.30/04), which for
   2.1 kg of fuel is ~5.5 kg of TNT (the RPO-M's quoted equivalence). Inside a room the survey then loads every wall
   with the gas pressure held for the room's blow-down: a push that blows walls out and doors and windows through,
   rather than a point charge's crater; in the open it is a big fireball and a modest blast. */
import { vec3, clamp } from 'math';
import type { Vec3 } from '../../types';
import { randomStream, stepCount } from '../../physics/physics';
import { explode, ignite, lastBlast, type Piece } from '../../destruction/structure';
import { flammable } from '../../destruction/materials';
import { disperseFuel, burnCloud, spark, type Cloud, type CloudBurn } from '../../sim/fields/index';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { piecesNear } from '../tools/common';
import { heatSkin } from './fuel';

export const TBX = {
  v0: 125, d: 0.093, mass: 4.5,
  fuel: 2.1,           // kg of fuel in the capsule
  burster: 0.03,       // kg TNT-eq: ~1.5 % of the fuel
  x: 0.045,            // mole fraction the burster throws it out at (propane: stoichiometric 4.0 %, limits 2.1-9.5 %)
  reach: 7,            // m the cloud can spread from the burst
  delay: 0.12,         // s from dispersal to ignition
  etaFront: 0.26,      // explosive efficiency of what burns premixed
  etaRest: 0.06,       // …and of what burns only as far as its air goes (the afterburn)
  tntJ: 4.6e6,         // J per kg TNT
  fireFlux: 150e3,     // W/m² on what the fireball engulfs, for ~0.4 s
};

interface Pending { at: number; cloud: Cloud; pos: Vec3 }
const pending: Pending[] = [];
let now = 0;
const rnd = randomStream(0x7b9a);
export const tbxLog: { cloud: Cloud; burn: CloudBurn; W: number; radius: number; confined?: boolean; Pqs?: number; V?: number }[] = [];

export function clearThermobaric(): void { pending.length = 0; now = 0; tbxLog.length = 0; }
export function thermobaricPending(): number { return pending.length; }

/** Stage 1, on impact (or at the end of its flight): the burster opens the capsule and throws the fuel out. */
export function thermobaricBurst(pos: Vec3, normal: Vec3): void {
  const at: Vec3 = [pos[0] + normal[0] * 0.25, pos[1] + normal[1] * 0.25, pos[2] + normal[2] * 0.25];
  explode(at, 1.0, TBX.burster * 60e3, 150, 0.2, 1);
  // the fuel goes out on the side it arrived from, not through the face it struck
  const cloud = disperseFuel(at, TBX.fuel, TBX.x, TBX.reach, normal);
  pending.push({ at: now + TBX.delay, cloud, pos: at });
  fx.fuelCloud(cloud.min, cloud.max, at, TBX.delay);
  audio.thermobaric(at, 2.2, TBX.delay);
}

/** Per physics step: light the clouds whose time has come. */
export function thermobaricStep(dt: number): void {
  now += dt;
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i];
    if (now < p.at) continue;
    pending.splice(i, 1);
    ignition(p);
  }
}

function ignition(p: Pending): void {
  const b = burnCloud(p.cloud.min, p.cloud.max);
  const E = b.premixed + b.diffusion;
  const W = (TBX.etaFront * b.premixed + TBX.etaRest * b.diffusion) / TBX.tntJ;
  const c: Vec3 = E > 0 ? [b.x, b.y, b.z] : p.pos;
  const ext = Math.max(p.cloud.max[0] - p.cloud.min[0], p.cloud.max[1] - p.cloud.min[1], p.cloud.max[2] - p.cloud.min[2]);
  // the push comes from the whole cloud, not a point: reach the cloud's own extent past the charge's radius
  /* the push reaches the cloud's own extent past the charge's radius; only a cloud held under cover (a room) keeps its
     pressure up for the long push; in the open it vents as it burns and the shock is all there is */
  const held = b.covered;
  const radius = Math.max(3.1 * Math.cbrt(Math.max(W * (0.5 + 0.5 * held), 0.05)), ext * 0.6 + 1);
  tbxLog.push({ cloud: p.cloud, burn: b, W, radius });
  if (tbxLog.length > 8) tbxLog.shift();
  fx.fuelFireball(p.cloud.min, p.cloud.max, c);
  if (W > 0.01) {
    /* a longer positive phase than a point charge of the same energy: ~1.6× the impulse on what is free to move */
    /* a fuel-air burn peaks at ~20 bar, not a high explosive's 10⁵: little brisance, a crushing push. The shock is dealt at
       half the TNT equivalent; a room it fills is pressurised by all of it (the survey's gas phase) */
    explode(c, radius, W * 0.5 * 60e3, 2150 * Math.sqrt(W * 0.5) * (1 + 0.6 * held), 1.3, 24, W * 60e3);
    const sv = lastBlast.survey, log = tbxLog[tbxLog.length - 1];
    if (sv && log) { log.confined = sv.confined; log.Pqs = sv.Pqs; log.V = sv.V; }
  }
  // the fireball: every surface inside the cloud takes the flame for a fraction of a second
  rnd.at(c[0], c[1], c[2], stepCount);
  const R = ext * 0.5 + 0.5;
  for (const { p: q, d } of piecesNear(c, R)) {
    const k = clamp(1 - d / R, 0.2, 1);
    heatSkin(q, TBX.fireFlux * k, Math.min(4, q.volume > 0 ? 2 * Math.cbrt(q.volume) ** 2 : 1), 0.4);
    if (flammable(q.pm) && (q.volume < 0.05 || rnd() < 0.15 * k)) ignite(q as Piece);
  }
  // what is left rich in the cloud burns on as it mixes: keep a pilot in it
  spark(c, 1.5);
  vec3.copy(p.pos, c);
}
