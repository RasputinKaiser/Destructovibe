/* 84 mm recoilless rifle, HEAT (Carl Gustaf FFV551 pattern): 255 m/s, a shaped charge that perforates ~400 mm of
   armour steel. Its jet is copper; in the hydrodynamic limit it goes P = L·√(ρjet/ρtarget), so the same jet that
   stops in 0.4 m of steel goes ~0.7 m into concrete (the M67 90 mm's 0.8 m of reinforced concrete) and further into
   brick. What it perforates it leaves holed, not blown in: a narrow tunnel with a shallow cone on the face and the
   back face spalled, a spray of behind-armour debris into the space beyond. A man-sized breach in brick takes 3-5
   rounds (FM 3-06.11); rebar survives. Unlike the rocket's tandem it has no follow-through charge: the jet is the
   weapon, and there is no blast inside. */
import { vec3, clamp } from 'math';
import type { Vec3 } from '../../types';
import type { b3ShapeId } from 'box3d.js';
import { b3, raycast, randomStream, stepCount, type PhysEntity } from '../../physics/physics';
import { explode, damagePiece, pieceOf, cutRebarNear, applyImpulseAt, type Piece } from '../../destruction/structure';
import { isFragile } from '../../sim/fields/index';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { strikes } from '../../render/strikes';
import { NO_HIT, fillOf, chord } from '../tools/common';
import { punchHole } from '../tools/machining';

export const HEAT84 = {
  v0: 255, mass: 3.2, d: 0.084,
  jet: 0.375,          // m of jet: 400 mm RHA = L·√(8960/7850)
  rhoJet: 8960,
  hole: 0.045,         // m: the tunnel a jet leaves in masonry and concrete (~½ calibre)
  crater: 0.28,        // m across the cone on the struck face
  tnt: 0.44 * 1.7,     // 440 g octol (RE ~1.7), most of it spent forming the jet
  bad: 14,             // behind-armour debris directions traced
  badReach: 8,
  standoff: 1.2,       // m past which the particulated jet is spent
};

const rnd = randomStream(0x8484);

/* Where a line entering a convex solid at `pos` along `dir` leaves it. */
function exitOf(shape: b3ShapeId, pos: Vec3, dir: Vec3): Vec3 {
  const far: Vec3 = [pos[0] + dir[0] * 8, pos[1] + dir[1] * 8, pos[2] + dir[2] * 8];
  const r = b3.b3Shape_RayCast(shape, far, [pos[0] - far[0], pos[1] - far[1], pos[2] - far[2]]);
  return r.hit ? [r.point[0], r.point[1], r.point[2]] : [...pos];
}

export interface JetResult { layers: number; perforated: number; spent: number; exits: Vec3[] }
export const heatLog: JetResult[] = [];

/** The round strikes at `point` travelling along `dir`; `back` is just short of the face. */
export function heatImpact(point: Vec3, dir: Vec3, entity: PhysEntity | undefined, back: Vec3): JetResult {
  const res: JetResult = { layers: 0, perforated: 0, spent: 0, exits: [] };
  // the charge's own blast at the face: most of its energy is in the jet, the rest a small blast and the case
  const w = HEAT84.tnt * 0.15;
  explode(back, 3.1 * Math.cbrt(w), w * 60e3, 2150 * Math.sqrt(w), 0.3, 1);
  rnd.at(point[0], point[1], point[2], stepCount);
  let at = pieceOf(entity) ? raycast([point[0] - dir[0] * 0.3, point[1] - dir[1] * 0.3, point[2] - dir[2] * 0.3], [dir[0] * 0.6, dir[1] * 0.6, dir[2] * 0.6], NO_HIT) : null;
  let jet = HEAT84.jet;
  for (let layer = 0; layer < 5 && at; layer++) {
    const piece = pieceOf(at.entity);
    if (!piece) break;
    res.layers++;
    const pos: Vec3 = [at.point[0], at.point[1], at.point[2]];
    const n = at.normal as Vec3;
    const out = exitOf(at.shape, pos, dir);
    const fill = piece.parts ? 1 : fillOf(piece);
    const solid = vec3.distance(out, pos) * fill;
    const k = Math.sqrt(piece.pm.density / HEAT84.rhoJet);
    const need = solid * k;
    const reach = jet / k / Math.max(fill, 0.02);
    cutRebarNear(piece, [pos[0] + dir[0] * Math.min(reach, 0.3), pos[1] + dir[1] * Math.min(reach, 0.3), pos[2] + dir[2] * Math.min(reach, 0.3)], 0.04);
    // the cone on the face: a crater of chips a couple of calibres across
    if (isFragile(piece)) damagePiece(piece, pos, piece.hp * 1.5, true);
    else {
      // what one round takes out of a wall is a crater and a tunnel: its share of the wall goes down with thickness
      damagePiece(piece, pos, Math.min(piece.hp * wear(piece, pos, dir), 40e3), true);
      if (!piece.dead) strikes.add(piece, pos, n, HEAT84.crater);
    }
    fx.debris(pos, 8, piece.pm.chips, 5, [-dir[0], -dir[1], -dir[2]]);
    fx.powder(pos, 0.5, piece.pm.dust);
    if (!Number.isFinite(need) || need > jet) {
      // stopped inside: a deep narrow hole, and the back face scabs if it came within ~30 % of going through
      res.spent = 1;
      if (Number.isFinite(need) && jet > need * 0.7 && !piece.dead) {
        damagePiece(piece, out, Math.min(piece.hp * wear(piece, pos, dir) * 0.75, 40e3), true);
        fx.debris(out, 10, piece.pm.chips, 6, dir);
        fx.powder(out, 0.6, piece.pm.dust);
      }
      if (!piece.dead && Number.isFinite(piece.pm.toughness)) punchHole(piece, pos, n, HEAT84.hole * 0.8);
      break;
    }
    jet -= need;
    res.perforated++;
    res.exits.push(out);
    if (!piece.dead) {
      if (Number.isFinite(piece.pm.toughness)) punchHole(piece, pos, n, HEAT84.hole);
      // the exit face spalls out wider than the tunnel
      if (!piece.dead) {
        damagePiece(piece, out, Math.min(piece.hp * wear(piece, pos, dir) * 0.75, 40e3), true);
        if (!piece.dead) strikes.add(piece, out, [dir[0], dir[1], dir[2]], HEAT84.crater * 2);
      }
    }
    spall(out, dir, piece, need);
    fx.debris(out, 16, piece.pm.chips, 12, dir);
    fx.powder(out, 0.9, piece.pm.dust);
    // the jet runs on down the line; beyond a metre or so of air it has particulated and is spent
    at = raycast([out[0] + dir[0] * 0.02, out[1] + dir[1] * 0.02, out[2] + dir[2] * 0.02], [dir[0] * HEAT84.standoff, dir[1] * HEAT84.standoff, dir[2] * HEAT84.standoff], NO_HIT);
    if (at) jet *= 1 - 0.5 * at.fraction;
  }
  audio.punch(point, clamp(res.perforated * 0.5, 0.3, 1));
  heatLog.push(res);
  if (heatLog.length > 16) heatLog.shift();
  return res;
}

/* share of a wall's strength one round's crater and tunnel take: ~0.2 of a one-brick (0.23 m) wall, so a breach needs a
   few rounds there and proportionally more in thicker walls */
function wear(p: Piece, at: Vec3, dir: Vec3): number {
  const t = Math.max(0.05, chord(p, at, dir));
  return Math.min(0.3, Math.max(0.04, 0.2 * (0.23 / t)));
}

/* Behind-armour debris: the plug and the spalled back face go on as a cone of fast fragments (half-angle ~25°). */
function spall(out: Vec3, dir: Vec3, from: Piece, need: number): void {
  const mass = Math.min(8, from.pm.density * Math.PI * 0.08 * 0.08 * Math.max(0.05, need));
  for (let i = 0; i < HEAT84.bad; i++) {
    const d: Vec3 = [dir[0] + (rnd() - 0.5) * 0.9, dir[1] + (rnd() - 0.5) * 0.9, dir[2] + (rnd() - 0.5) * 0.9];
    vec3.normalize(d, d);
    const hit = raycast([out[0] + d[0] * 0.03, out[1] + d[1] * 0.03, out[2] + d[2] * 0.03], [d[0] * HEAT84.badReach, d[1] * HEAT84.badReach, d[2] * HEAT84.badReach], NO_HIT);
    const end: Vec3 = hit ? [hit.point[0], hit.point[1], hit.point[2]] : [out[0] + d[0] * 3, out[1] + d[1] * 3, out[2] + d[2] * 3];
    fx.fragTrace(out, end, !!hit);
    if (!hit) continue;
    const q = pieceOf(hit.entity);
    if (!q || q === from) continue;
    const v = 400 * Math.exp(-hit.fraction * HEAT84.badReach / 6);
    const E = 0.5 * (mass / HEAT84.bad) * v * v;
    if (isFragile(q)) damagePiece(q, hit.point as Vec3, q.hp * 1.5, true);
    else damagePiece(q, hit.point as Vec3, E, false);
    if (!q.dead) {
      strikes.add(q, hit.point as Vec3, hit.normal as Vec3, 0.08);
      if (!q.welds.length && q.mass < 200) {
        const J = (mass / HEAT84.bad) * v;
        applyImpulseAt(q, [d[0] * J, d[1] * J, d[2] * J], hit.point as Vec3);
      }
    }
  }
}
