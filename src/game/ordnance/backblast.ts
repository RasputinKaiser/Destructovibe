/* Backblast of a recoilless or rocket launcher: the propellant gas (and a recoilless gun's whole counter-mass) goes
   out of the back of the tube in a cone. Behind the firer it throws what is loose, scorches what burns and raises a
   sheet of dust; a wall close behind reflects it back onto the firer (RPG-7: keep 2-3 m clear; AT4: 5 m), and fired
   from inside a room it fills the room: FM 3-06.11 allows it only from a sturdy room of ≥ 4.6 × 3.7 × 2.1 m
   (≈ 36 m³) with ≥ 1.86 m² of openings behind or beside, and even then expects concussion, dust and broken glass. */
import { vec3, clamp } from 'math';
import type { Vec3 } from '../../types';
import { b3, raycast, randomStream, stepCount } from '../../physics/physics';
import { heat, ignite, applyImpulseAt, damagePiece } from '../../destruction/structure';
import { flammable } from '../../destruction/materials';
import { isFragile } from '../../sim/fields/index';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { blastVignette } from '../../ui/ui';
import { player, addTrauma, kickFov, knockback } from '../player';
import { NO_HIT, piecesNear } from '../tools/common';

export interface BackblastSpec {
  cone: number;   // half-angle, rad
  reach: number;  // m it throws loose things
  clear: number;  // m that must be clear behind
  kick: number;   // m/s it can throw the firer forward off a wall right behind
  gas: number;    // relative gas volume (a rocket's motor 1, a recoilless rifle's whole charge ~3)
}
export const BB_ROCKET: BackblastSpec = { cone: 0.6, reach: 8, clear: 2.2, kick: 6, gas: 1 };
export const BB_RECOILLESS: BackblastSpec = { cone: 0.78, reach: 14, clear: 5, kick: 9.5, gas: 3 };
export const BB_THERMOBARIC: BackblastSpec = { cone: 0.6, reach: 8, clear: 2.5, kick: 6.5, gas: 1.2 };
const ROOM = { volume: 36, vents: 1.86 };

const rnd = randomStream(0xbb01);

/** Returns a warning for the firer, or null. eye/fwd: the firer's eye and aim. */
export function backblast(eye: Vec3, fwd: Vec3, spec: BackblastSpec): string | null {
  const back: Vec3 = [-fwd[0], -fwd[1], -fwd[2]];
  const rear: Vec3 = [eye[0] + back[0] * 0.5, eye[1] - 0.1 + back[1] * 0.5, eye[2] + back[2] * 0.5];
  rnd.at(rear[0], rear[1], rear[2], stepCount);
  fx.muzzle(rear, back, 'rocket');
  fx.backblast(rear, back, spec.reach, spec.gas);
  let msg: string | null = null;
  let hurt = 0;
  const wall = raycast(rear, [back[0] * spec.clear, back[1] * spec.clear, back[2] * spec.clear], NO_HIT);
  if (wall && wall.entity?.kind !== 'ground') {
    const k = 1 - wall.fraction;
    hurt = Math.max(hurt, (0.35 + 0.65 * k) * spec.kick);
    msg = 'Backblast came straight back off the wall behind you';
  }
  // the room round the firer: its size along the six axes and how much of it is open
  const room = enclosure(eye);
  if (room.covered && (room.volume < ROOM.volume * spec.gas || room.vents < ROOM.vents)) {
    const k = clamp((ROOM.volume * spec.gas) / Math.max(room.volume, 4), 0.5, 2.5) * (room.vents < ROOM.vents ? 1.3 : 1);
    hurt = Math.max(hurt, spec.kick * 0.45 * k);
    msg = `Fired from a ${room.volume < ROOM.volume ? 'small' : 'closed'} room (${Math.round(room.volume)} m³, ${room.vents.toFixed(1)} m² open): the backblast filled it`;
    addTrauma(0.35 * k);
    blastVignette(clamp(0.25 * k, 0, 0.8));
    audio.setMuffle(clamp(0.5 * k, 0, 1));
    fx.dust(eye, 2.5 * k, 0xc9c0ae);
    // glass, loose plaster and light things in the room go
    for (const { p: q } of piecesNear(eye, Math.min(6, Math.cbrt(room.volume)))) {
      if (isFragile(q)) damagePiece(q, q.curPos, q.hp * 1.5, true);
      else if (!q.welds.length && !q.hinged && q.mass < 20) {
        const v: Vec3 = [q.curPos[0] - eye[0], q.curPos[1] - eye[1] + 0.5, q.curPos[2] - eye[2]];
        const d = vec3.length(v) || 1;
        const J = q.mass * 3 * spec.gas / (1 + d);
        applyImpulseAt(q, [(v[0] / d) * J, (v[1] / d) * J, (v[2] / d) * J], q.curPos);
      }
    }
  }
  if (hurt > 0 && player.e) {
    // the reflected gas slams the firer forward off his feet (the player's own stagger/knockdown thresholds judge it)
    const m = b3.b3Body_GetMass(player.e.body);
    const dir: Vec3 = [fwd[0], 0.15, fwd[2]];
    vec3.normalize(dir, dir);
    b3.b3Body_ApplyLinearImpulseToCenter(player.e.body, [dir[0] * hurt * m, dir[1] * hurt * m, dir[2] * hurt * m], true);
    addTrauma(0.3 + 0.05 * hurt);
    kickFov(8 + 1.5 * hurt);
    knockback(0.25 + 0.04 * hurt);
  }
  // behind: throws what is loose, scorches what burns
  const c: Vec3 = [rear[0] + back[0] * spec.reach * 0.5, rear[1] + back[1] * spec.reach * 0.5, rear[2] + back[2] * spec.reach * 0.5];
  for (const { p: q, cp } of piecesNear(c, spec.reach * 0.5)) {
    const v: Vec3 = [cp[0] - rear[0], cp[1] - rear[1], cp[2] - rear[2]];
    const d = vec3.length(v);
    if (d < 1e-3 || vec3.dot(v, back) / d < Math.cos(spec.cone)) continue;
    const f = clamp(1 - d / spec.reach, 0, 1);
    if (!q.welds.length && !q.hinged) {
      const J = Math.min(q.mass * 12, 900 * spec.gas * f * f);
      applyImpulseAt(q, [(v[0] / d) * J, (v[1] / d) * J + J * 0.2, (v[2] / d) * J], q.curPos);
    }
    if (isFragile(q) && f > 0.4) damagePiece(q, q.curPos, q.hp * 1.5, true);
    if (d < 3 * Math.sqrt(spec.gas)) {
      heat(q, 90 * f);
      if (flammable(q.pm) && q.volume < 0.2 && rnd() < 0.5 * f) ignite(q);
    }
  }
  return msg;
}

/* A quick survey of the space round the firer: rays along the axes and the diagonals. Covered when something is
   within 5 m overhead; volume from the extents; open area from the horizontal rays that find nothing in 12 m. */
function enclosure(eye: Vec3): { covered: boolean; volume: number; vents: number } {
  const L = 12;
  const len = (d: Vec3): number => { const h = raycast(eye, [d[0] * L, d[1] * L, d[2] * L], NO_HIT); return h ? h.fraction * L : Infinity; };
  const up = len([0, 1, 0]);
  if (up > 5) return { covered: false, volume: Infinity, vents: Infinity };
  const down = Math.min(len([0, -1, 0]), 2.5);
  const H = up + down;
  let open = 0, n = 0;
  const ext: number[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = len([Math.cos(a), 0, Math.sin(a)]);
    n++;
    if (!Number.isFinite(r)) open++;
    ext.push(Math.min(r, L));
  }
  // floor area from the 12 radii (a polygon), walls' share left open as the vents
  let area = 0;
  for (let i = 0; i < 12; i++) area += 0.5 * ext[i] * ext[(i + 1) % 12] * Math.sin((Math.PI * 2) / 12);
  const perim = ext.reduce((s, r) => s + r, 0) * ((Math.PI * 2) / 12);
  return { covered: true, volume: area * H, vents: (open / n) * perim * Math.min(H, 2.1) };
}
