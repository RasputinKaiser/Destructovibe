/* Bunker buster: a laser-designated 250 lb-class penetrating bomb (GBU-39 SDB pattern: 129 kg, 190 mm, 16 kg of
   AFX-757, "greater than 3 ft of steel reinforced concrete"), arriving near-vertical at ~260 m/s. Each solid on its
   line takes the Young/Sandia depth D = 1.8e-5·S·N·(m/A)^0.7·(V − 30.5) it would need; a slab thinner than that is
   perforated (thin slabs go easily: a slab less than ~1.3 calibres thick is punched through, NDRC perforation), the
   speed left is what reaches the rest of D. The fuze counts the voids it passes (a hard-target smart fuze counts
   floors) and fires in the Nth, or where the bomb comes to rest. The designator sets N on the wheel. */
import { vec3, clamp } from 'math';
import type { Vec3 } from '../../types';
import type { b3ShapeId } from 'box3d.js';
import { b3, raycast, type PhysEntity } from '../../physics/physics';
import { explode, damagePiece, pieceOf, cutRebarNear } from '../../destruction/structure';
import { groundAt } from '../../terrain/terrain';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { NO_HIT, fillOf } from '../tools/common';
import { punchHole } from '../tools/machining';
import { young, youngSpeed, PEN_S, GROUND_S } from './penetration';

export const PEN = {
  mass: 129, d: 0.19, N: 1.05,
  v: 260,              // m/s at impact
  dive: 78,            // degrees below the horizon
  tnt: 16 * 1.3,       // 16 kg AFX-757 (aluminised, RE ~1.3 assumed)
  radio: 4,            // s from the laser spot to impact
  alt: 320,            // m above the target it is first seen
  voids: [0, 4],       // floors to count (0: fire where it stops)
  gap: 0.6,            // m of open space that counts as a void
};
const A = Math.PI * (PEN.d / 2) ** 2;
const S_REF = 0.9;

export interface PenLayer { mat: string; entry: Vec3; exit: Vec3 | null; thick: number; left: number }
export interface PenResult { layers: PenLayer[]; det: Vec3; voids: number; stopped: boolean; v: number }
export const penLog: PenResult[] = [];

interface Burst { at: number; pos: Vec3 }
const bursts: Burst[] = [];
const punches: { at: number; pos: Vec3; dir: Vec3; chips: number; dust: number; up: boolean }[] = [];
let now = 0;

export function clearPenetrator(): void { bursts.length = 0; punches.length = 0; now = 0; penLog.length = 0; }
export function penetratorPending(): number { return bursts.length; }

function exitOf(shape: b3ShapeId, pos: Vec3, dir: Vec3): Vec3 {
  const far: Vec3 = [pos[0] + dir[0] * 12, pos[1] + dir[1] * 12, pos[2] + dir[2] * 12];
  const r = b3.b3Shape_RayCast(shape, far, [pos[0] - far[0], pos[1] - far[1], pos[2] - far[2]]);
  return r.hit ? [r.point[0], r.point[1], r.point[2]] : [...pos];
}

/** Capacity left, in metres of reference concrete (S 0.9), at speed V. */
const capacity = (V: number): number => young(PEN.mass, A, V, S_REF, PEN.N);

/** The bomb strikes at `point` along `dir` at speed V: trace it down through what it meets and set the fuze. */
export function penetrate(point: Vec3, dir: Vec3, V: number, entity: PhysEntity | undefined, voidsWanted: number): PenResult {
  let cap = capacity(V);
  const res: PenResult = { layers: [], det: [...point], voids: 0, stopped: false, v: V };
  let at = pieceOf(entity) ? raycast([point[0] - dir[0] * 0.3, point[1] - dir[1] * 0.3, point[2] - dir[2] * 0.3], [dir[0] * 0.6, dir[1] * 0.6, dir[2] * 0.6], NO_HIT) : null;
  let pos: Vec3 = [...point];
  let t = 0;
  for (let n = 0; n < 12; n++) {
    const piece = at ? pieceOf(at.entity) : null;
    if (!at || !piece) {
      // the ground: it buries itself in the fill (S ≈ 6) and goes off there
      const gy = groundAt(pos[0], pos[2]);
      const d = cap * (GROUND_S / S_REF);
      const depth = Math.min(d, 6) * Math.abs(dir[1]);
      res.det = [pos[0] + dir[0] * Math.min(d, 6), Math.max(gy - depth, gy - 4), pos[2] + dir[2] * Math.min(d, 6)];
      res.stopped = true;
      punches.push({ at: now + t, pos: [pos[0], gy, pos[2]], dir, chips: 0x6b5a45, dust: 0x9c8a70, up: true });
      break;
    }
    const entry: Vec3 = [at.point[0], at.point[1], at.point[2]];
    const exit = exitOf(at.shape, entry, dir);
    const fill = piece.parts ? 1 : fillOf(piece);
    const thick = vec3.distance(exit, entry) * fill;
    const S = PEN_S[piece.mat] ?? 1;
    // metres of reference concrete this layer costs: its NDRC perforation thickness at this calibre, not less than a third of it
    const need = Math.max(thick * 0.6, (thick - 1.32 * PEN.d) / 1.24) * (S_REF / S);
    const layer: PenLayer = { mat: piece.mat, entry, exit: null, thick, left: 0 };
    res.layers.push(layer);
    t += vec3.distance(entry, pos) / Math.max(V, 1);
    /* a punched hole a few calibres across, the bars in it cut, the slab cracked round it: not the whole slab shattered */
    cutRebarNear(piece, entry, 0.3);
    if (Number.isFinite(piece.pm.toughness)) punchHole(piece, entry, [-dir[0], -dir[1], -dir[2]], PEN.d * 2.5);
    if (!piece.dead) damagePiece(piece, entry, Math.min(piece.hp * 0.35, 2e5), true);
    punches.push({ at: now + t, pos: entry, dir, chips: piece.pm.chips, dust: piece.pm.dust, up: true });
    if (need >= cap) {
      // it stops in this layer
      const into = (cap / Math.max(need, 1e-6)) * vec3.distance(exit, entry);
      res.det = [entry[0] + dir[0] * into, entry[1] + dir[1] * into, entry[2] + dir[2] * into];
      res.stopped = true;
      layer.left = 0;
      break;
    }
    cap -= need;
    V = youngSpeed(PEN.mass, A, cap, S_REF, PEN.N);
    layer.exit = exit;
    layer.left = cap;
    t += vec3.distance(exit, entry) / Math.max(V, 1);
    punches.push({ at: now + t, pos: exit, dir, chips: piece.pm.chips, dust: piece.pm.dust, up: false });
    // what is below: another solid close under (a screed, a beam on the slab) or a void (a storey)
    at = raycast([exit[0] + dir[0] * 0.02, exit[1] + dir[1] * 0.02, exit[2] + dir[2] * 0.02], [dir[0] * 40, dir[1] * 40, dir[2] * 40], NO_HIT);
    const gy = groundAt(exit[0], exit[2]);
    const toGround = dir[1] < -1e-3 ? (exit[1] - gy) / -dir[1] : Infinity;
    const gap = Math.min(at ? at.fraction * 40 : Infinity, toGround);
    if (gap > PEN.gap) {
      res.voids++;
      if (voidsWanted > 0 && res.voids >= voidsWanted) {
        const k = Math.min(gap * 0.5, 1.5);
        res.det = [exit[0] + dir[0] * k, exit[1] + dir[1] * k, exit[2] + dir[2] * k];
        break;
      }
    }
    pos = exit;
    if (!at || at.fraction * 40 > toGround) at = null;
  }
  res.v = V;
  bursts.push({ at: now + t + 0.012, pos: res.det });
  penLog.push(res);
  if (penLog.length > 8) penLog.shift();
  return res;
}

/** Per physics step: the holes it punches appear as it passes, then the charge. */
export function penetratorStep(dt: number): void {
  now += dt;
  for (let i = punches.length - 1; i >= 0; i--) {
    const p = punches[i];
    if (now < p.at) continue;
    punches.splice(i, 1);
    const up: Vec3 = p.up ? [-p.dir[0], -p.dir[1], -p.dir[2]] : p.dir;
    fx.debris(p.pos, 18, p.chips, p.up ? 7 : 5, up);
    fx.dust(p.pos, 1.4, p.dust);
    audio.punch(p.pos, 1);
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    if (now < b.at) continue;
    bursts.splice(i, 1);
    /* buried: the soil over it contains the burst (a camouflet past ~1.2 m/kg^⅓ of cover); what vents is the share its
       scaled depth leaves (the crater the explosion digs is the terrain's own business) */
    const W = PEN.tnt, gy = groundAt(b.pos[0], b.pos[2]);
    const depth = Math.max(0, gy - b.pos[1]), lam = depth / Math.cbrt(W);
    const k = lam <= 0 ? 1 : Math.max(0.05, 1 - lam / 1.2);
    const at: Vec3 = depth > 0 ? [b.pos[0], gy + 0.2, b.pos[2]] : b.pos;
    explode(at, 3.1 * Math.cbrt(W * k), 60e3 * W * k, 2150 * Math.sqrt(W * k), 1.3, 60);
  }
}

/** Where the designator puts the bomb in: from high on the far side of the target, diving at PEN.dive. */
export function approach(target: Vec3, from: Vec3): { start: Vec3; vel: Vec3 } {
  let hx = target[0] - from[0], hz = target[2] - from[2];
  const hl = Math.hypot(hx, hz) || 1;
  hx /= hl; hz /= hl;
  const a = (PEN.dive * Math.PI) / 180;
  const dir: Vec3 = [hx * Math.cos(a), -Math.sin(a), hz * Math.cos(a)];
  const L = PEN.alt / Math.sin(a);
  const start: Vec3 = [target[0] - dir[0] * L, target[1] - dir[1] * L, target[2] - dir[2] * L];
  // it falls the last few hundred metres ballistically: aim it so the drop over the flight lands it on the spot
  const tof = L / PEN.v;
  return { start, vel: [dir[0] * PEN.v, dir[1] * PEN.v + 0.5 * 9.81 * tof, dir[2] * PEN.v] };
}

export const penClamp = (n: number): number => clamp(Math.round(n), PEN.voids[0], PEN.voids[1]);
