/* Round shot striking a structure (the hand cannon's ball): the modified NDRC formula gives how deep a blunt hard
   missile of this mass, calibre and speed goes into the material, how thick a wall it goes through and how thick a
   one it still scabs off the back of. Glancing blows below ~33° to the face bounce off masonry (Gibbon). A wall it
   perforates is holed where it struck and throws its back face out ahead of the ball, which goes on with what
   speed the wall left it; one it only scabs keeps it and spalls behind; a thick one takes a funnel crater ~5 ball
   diameters across. Metal members are not penetrated this way: they ring and throw it back. */
import { vec3, clamp } from 'math';
import type { Vec3 } from '../../types';
import type { b3ShapeId } from 'box3d.js';
import { b3, raycast } from '../../physics/physics';
import { damagePiece, cutRebarNear, pieceOf, type Piece } from '../../destruction/structure';
import { fx } from '../../render/fx';
import { strikes } from '../../render/strikes';
import { NO_HIT, fillOf } from '../tools/common';
import { ndrc, residual, PEN_FC } from './penetration';

export type ShotOutcome = 'perforated' | 'scabbed' | 'crater' | 'glance' | 'none';
export interface ShotResult { outcome: ShotOutcome; v: number; exit: Vec3 | null; x: number; thick: number; perforate: number; scab: number }
export const shotLog: ShotResult[] = [];
const GLANCE = Math.sin((33 * Math.PI) / 180);

function exitOf(shape: b3ShapeId, pos: Vec3, dir: Vec3): Vec3 {
  const far: Vec3 = [pos[0] + dir[0] * 8, pos[1] + dir[1] * 8, pos[2] + dir[2] * 8];
  const r = b3.b3Shape_RayCast(shape, far, [pos[0] - far[0], pos[1] - far[1], pos[2] - far[2]]);
  return r.hit ? [r.point[0], r.point[1], r.point[2]] : [...pos];
}

/** A ball of mass M (kg), diameter d (m) arriving along unit `dir` at V (m/s) on piece q at `point`. */
export function shotStrike(q: Piece, point: Vec3, dir: Vec3, V: number, M: number, d: number): ShotResult {
  const res: ShotResult = { outcome: 'none', v: V, exit: null, x: 0, thick: 0, perforate: 0, scab: 0 };
  const fc = PEN_FC[q.mat];
  if (fc === undefined || !Number.isFinite(q.pm.toughness)) return res;
  const ray = raycast([point[0] - dir[0] * 0.2, point[1] - dir[1] * 0.2, point[2] - dir[2] * 0.2], [dir[0] * 0.5, dir[1] * 0.5, dir[2] * 0.5], NO_HIT);
  if (!ray || pieceOf(ray.entity) !== q) return res;
  const n = ray.normal as Vec3, entry: Vec3 = [ray.point[0], ray.point[1], ray.point[2]];
  const c = -vec3.dot(dir, n);
  if (c < GLANCE) {
    res.outcome = 'glance';
    strikes.add(q, entry, n, clamp(d * 1.2, 0.1, 0.3));
    fx.impact(entry, n, q.mat, 0.4);
    shotLog.push(res);
    return res;
  }
  const exit = exitOf(ray.shape, entry, dir);
  const thick = vec3.distance(exit, entry) * (q.parts ? 1 : fillOf(q));
  const p = ndrc(M, d, V * c, fc);
  res.x = p.x; res.thick = thick; res.perforate = p.perforate; res.scab = p.scab;
  const KE = 0.5 * M * V * V;
  if (thick < p.perforate) {
    res.outcome = 'perforated';
    res.v = residual(V, thick, p.perforate);
    res.exit = exit;
    cutRebarNear(q, entry, d);
    damagePiece(q, entry, Math.max(q.hp * 1.1, KE * 0.5), true);
    fx.debris(exit, 22, q.pm.chips, 6 + res.v * 0.1, dir);
    fx.dust(exit, 0.9, q.pm.dust);
  } else if (thick < p.scab) {
    res.outcome = 'scabbed';
    res.v = 0;
    damagePiece(q, entry, Math.min(q.hp * 0.45, KE * 0.4), true);
    if (!q.dead) {
      strikes.add(q, entry, n, clamp(d * 2.5, 0.15, 0.6));
      damagePiece(q, exit, Math.min(q.hp * 0.3, KE * 0.3), true);
      if (!q.dead) strikes.add(q, exit, dir, clamp(d * 3, 0.2, 0.8));
    }
    fx.debris(exit, 14, q.pm.chips, 4, dir);
    fx.powder(exit, 0.6, q.pm.dust);
  } else {
    res.outcome = 'crater';
    res.v = 0;
    damagePiece(q, entry, Math.min(q.hp * 0.25, KE * 0.3), true);
    if (!q.dead) strikes.add(q, entry, n, clamp(d * (1 + 4 * Math.min(1, p.x / d / 5)), 0.12, 0.8));
  }
  fx.debris(entry, 10, q.pm.chips, 4, n);
  fx.powder(entry, 0.4, q.pm.dust);
  shotLog.push(res);
  if (shotLog.length > 16) shotLog.shift();
  return res;
}
