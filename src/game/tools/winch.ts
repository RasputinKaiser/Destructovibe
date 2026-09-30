import { vec3, clamp } from 'math';
import type { b3JointId } from 'box3d.js';
import type { Vec3, ToolReadout } from '../../types';
import { b3, world, raycast } from '../../physics/physics';
import type { Piece } from '../../destruction/structure';
import { vehicleOf } from '../../vehicles/vehicle';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { hitmarker } from '../../ui/ui';
import { player } from '../player';
import { NO_HIT, toolHooks } from './common';
import {
  LINES, makeLine, makeStake, dropStake, anchorOn, releaseLine, reanchor, setRest, setParts, lineJointDef, currentLength,
  breakLoad, inSnapZone, strainEnergy, type Line,
} from './lines';

/* Tow lines from a ground stake (8 t hydraulic planetary winch, 13 mm wire rope) or made fast to a vehicle. Reeving the rope
   through snatch blocks divides the speed and multiplies the pull at the hook by the parts of line, while each
   part still carries only the line's own tension up to its rating. Up to three lines; holding fire runs every stake
   winch at once, so three lines on one wall come tight together. The line itself (tension, fraying, parting and its
   snap-back, being cut) is the shared rigging line. */
export const WINCH_RANGE = 35;
export const MAX_TOWS = 3;
/* An 18,000 lb hydraulic recovery winch on ½" rope: 80 kN rated pull, 23 ft/min at full oil flow. Oil flow sets the
   speed and the relief valve the pull, so it holds its speed up to the rated pull (an electric winch's falls away). */
const PULL = 80.1e3;      // N, rated line pull, first layer
const REEL = 0.117;       // m/s, single line
const MIN_LEN = 1.2;
const BEHIND = 3;
const KIND = 'wire13' as const;

interface Tow {
  line: Line;
  truck: boolean;
  reeling: boolean;
  audioT: number;
}

const tows: Tow[] = [];
let t = 0;
let parts = 1;

export function initWinch(_s?: unknown): void {}

export function winchTargets(): Piece[] { return tows.map(w => w.line.b.piece!).filter(Boolean); }
export function winchActive(): boolean { return tows.length > 0; }
export function winchParts(): number { return parts; }

/* The stake winch's joint: the line's own def with the motor rated for the reeving. Soft (zero-hertz spring) below
   the limit so the cable can go slack; the max-length limit is the ratchet that holds whatever the motor has won. */
function motorJoint(L: Line): b3JointId {
  const jd = lineJointDef(L);
  jd.minLength = 0.2;
  jd.maxMotorForce = PULL * L.parts;
  jd.motorSpeed = -REEL / L.parts;
  jd.enableMotor = false;
  return b3.b3CreateDistanceJoint(world, jd);
}

/** Wheel: reeve through more or fewer snatch blocks (1-3 parts of line) for the next rig and any stake winch. */
export function setWinchParts(n: number): number {
  parts = clamp(Math.round(n), 1, 3);
  for (const w of tows) if (!w.truck) {
    setParts(w.line, parts);
    b3.b3DistanceJoint_SetMaxMotorForce(w.line.joint, PULL * parts);
    b3.b3DistanceJoint_SetMotorSpeed(w.line.joint, -REEL / parts);
  }
  return parts;
}

function gone(w: Tow): void {
  if (w.reeling) audio.winch(false, 0);
  const i = tows.indexOf(w);
  if (i >= 0) tows.splice(i, 1);
}

/** Hook `piece` at `point`: a new line to a stake driven in behind the player. */
export function rigWinch(piece: Piece, point: Vec3, fwd: Vec3): string | null {
  if (tows.length >= MAX_TOWS) return `${MAX_TOWS} tow lines rigged — right-click casts one off`;
  const feet = player.e ? player.e.curPos : point;
  let hx = -fwd[0], hz = -fwd[2], hl = Math.hypot(hx, hz);
  if (hl < 0.1) { hx = Math.sin(player.yaw); hz = Math.cos(player.yaw); hl = 1; }
  // side by side: each extra stake goes a metre and a half to the side of the last
  const side = (tows.length % 2 ? 1 : -1) * Math.ceil(tows.length / 2) * 1.5;
  const bx = feet[0] + (hx / hl) * BEHIND + (hz / hl) * side, bz = feet[2] + (hz / hl) * BEHIND - (hx / hl) * side;
  const down = raycast([bx, feet[1] + 1.5, bz], [0, -(feet[1] + 4), 0], NO_HIT);
  const anchor: Vec3 = [bx, (down ? down.point[1] : 0) + 0.3, bz];
  const len = Math.max(MIN_LEN + 0.1, vec3.distance(anchor, point));
  const w: Tow = { line: null!, truck: false, reeling: false, audioT: -9 };
  w.line = makeLine(KIND, 'winch', anchorOn(null, anchor), anchorOn(piece, point), len, {
    parts, make: motorJoint, stake: makeStake(anchor, true), onGone: () => gone(w),
  });
  tows.push(w);
  fx.sparks(point, [0, 1, 0], 6);
  audio.chargeStick(point);
  hitmarker(0.4);
  return null;
}

/** Make the newest stake line fast to the vehicle `v` at `point` instead: the truck does the pulling. */
export function hitchWinch(vp: Piece, point: Vec3): string | null {
  const veh = vehicleOf(vp);
  if (!veh) return 'That is not a vehicle';
  const w = [...tows].reverse().find(x => !x.truck);
  if (!w) return 'Hook a structure first, then the truck';
  if (w.reeling) audio.winch(false, 0);
  w.reeling = false;
  w.truck = true;
  dropStake(w.line.stake);
  w.line.stake = null;
  setParts(w.line, 1);
  // made fast with the slack pulled out by hand, then a metre of rope to take up before it bites
  const len = Math.max(MIN_LEN, vec3.distance(point, w.line.pb) + 1);
  reanchor(w.line, 'a', anchorOn(veh.chassis, point), len, null);
  audio.chargeStick(point);
  hitmarker(0.4);
  return null;
}

/** Cast off the newest line (right-click). */
export function castOff(): boolean {
  const w = tows[tows.length - 1];
  if (!w) return false;
  releaseLine(w.line, 'off');
  audio.cableCreak(w.line.pb, 0.4);
  return true;
}

/* Motors reel in at a capped force; the upper limit ratchets down behind them, so letting go of fire holds the
   length gained instead of paying the cable back out. */
export function winchPreStep(reeling: boolean): void {
  for (const w of tows) {
    if (w.truck || w.line.dead || !b3.b3Joint_IsValid(w.line.joint)) continue;
    const L = w.line, j = L.joint;
    const cur = currentLength(L);
    const run = reeling && cur > MIN_LEN;
    if (run !== w.reeling) {
      w.reeling = run;
      b3.b3DistanceJoint_EnableMotor(j, run);
      audio.winch(run, 0);
      if (run) b3.b3Joint_WakeBodies(j);
    }
    if (!run) continue;
    const next = Math.max(MIN_LEN, Math.min(L.rest, cur + 0.01 / L.parts));
    if (next < L.rest - 1e-3) setRest(L, next);
    b3.b3Joint_WakeBodies(j);
  }
}

export function winchAfterStep(dt: number): void {
  t += dt;
  for (const w of tows) {
    if (!w.reeling || t - w.audioT < 0.1) continue;
    w.audioT = t;
    audio.winch(true, clamp((w.line.tension * w.line.parts) / (PULL * w.line.parts), 0, 1));
  }
}

export function syncWinch(_alpha?: number): void {}

export function winchStatus(): ToolReadout {
  const zone = inSnapZone();
  if (!tows.length) return { title: `Tow winch · ${parts} part${parts > 1 ? 's' : ''} of line`, progress: null, detail: `LMB hook a structure · wheel snatch blocks (pull ${Math.round((PULL * parts) / 1000)} kN at ${((REEL / parts) * 60).toFixed(1)} m/min) · then LMB a vehicle to tow with it`, warn: false };
  const worst = tows.reduce((a, b) => (b.line.tension / breakLoad(b.line) > a.line.tension / breakLoad(a.line) ? b : a));
  const u = worst.line.tension / breakLoad(worst.line);
  return {
    title: `Tow winch · ${tows.length} line${tows.length > 1 ? 's' : ''}`,
    progress: clamp(u, 0, 1),
    detail: zone
      ? `in the snap-back zone: ${Math.round(strainEnergy(zone.L, breakLoad(zone.L)) / 1000)} kJ comes back down that line if it parts — step out of line with it`
      : tows.map(w => `${w.truck ? 'truck' : `${w.line.parts}×`} ${Math.round(w.line.tension / 1000)} kN`).join(' · ') + ` of ${Math.round(LINES[KIND].mbl / 1000)} kN break · RMB cast off`,
    warn: u > 0.8 || !!zone,
    lines: tows.map(w => ({ label: w.truck ? 'truck' : `${w.line.parts}×`, util: w.line.tension / breakLoad(w.line) })),
  };
}

export function winchDebug(): { tension: number[]; parts: number[]; truck: boolean[] } {
  return { tension: tows.map(w => w.line.tension), parts: tows.map(w => w.line.parts), truck: tows.map(w => w.truck) };
}

export function clearWinch(): void {
  for (const w of tows) if (w.reeling) audio.winch(false, 0);
  tows.length = 0;
}
