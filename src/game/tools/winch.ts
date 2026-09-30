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
  LINES, makeLine, makeStake, faceStake, dropStake, anchorOn, releaseLine, reanchor, setRest, setParts, lineJointDef, currentLength,
  breakLoad, inSnapZone, strainEnergy, lineBar, GROUND, type Line,
} from './lines';

/* Tow lines from a ground stake (8 t hydraulic planetary winch, 13 mm wire rope) or made fast to a vehicle. Reeving the rope
   through snatch blocks divides the speed and multiplies the pull at the hook by the parts of line, while each
   part still carries only the line's own tension up to its rating. Up to three lines; holding fire runs every stake
   winch at once, so three lines on one wall come tight together. The line itself (tension, fraying, parting and its
   snap-back, being cut) is the shared rigging line. */
export const WINCH_RANGE = 35;
export const MAX_TOWS = 3;
/* An 18,000 lb hydraulic recovery winch on ½" rope: 80 kN rated pull, 23 ft/min at full oil flow, 165 ft (50 m) of
   rope on the drum; on the ground it sits on a buried log deadman (~120 kN before it ploughs out) with the petrol power
   pack that drives it (~9.4 kW of hydraulics at full pull and speed). Oil flow sets the speed and the relief valve the
   pull, so it holds its speed up to the rated pull (an electric winch's falls away). The pull is rated on the first
   layer: with more rope on the drum each layer has more leverage against the motor (100 / 83 / 71 / 62 % by the
   fourth), and runs that much faster. Each snatch block loses ~5 % to sheave friction. */
const PULL = 80.1e3;      // N, rated line pull, first layer
const REEL = 0.117;       // m/s, single line, first layer
const DRUM = 50;          // m of rope on the drum
const WRAPS = 3;          // m kept on the drum (five wraps)
/* rope on the drum at the end of each layer (Smittybilt 17.5K proportions: 19.7 / 45.9 / 75.4 / 93.5 of 94 ft) */
const LAYERS = [0.21, 0.49, 0.81, 1].map(k => k * DRUM), LAYER_PULL = [1, 0.83, 0.71, 0.62];
const SHEAVE = 0.95;
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
/* how much rope is on the drum with this line out, and what the drum then pulls (N at the hook) and at what speed */
function drumLoad(L: Line): { pull: number; speed: number; layer: number } {
  const onDrum = DRUM - L.rest * L.parts;
  let layer = 0;
  while (layer < 3 && onDrum > LAYERS[layer]) layer++;
  const k = LAYER_PULL[layer];
  return { pull: PULL * k * L.parts * SHEAVE ** (L.parts - 1), speed: REEL / k / L.parts, layer: layer + 1 };
}

function motorJoint(L: Line): b3JointId {
  const jd = lineJointDef(L);
  const d = drumLoad(L);
  jd.minLength = 0.2;
  jd.maxMotorForce = d.pull;
  jd.motorSpeed = -d.speed;
  jd.enableMotor = false;
  return b3.b3CreateDistanceJoint(world, jd);
}

/** Wheel: reeve through more or fewer snatch blocks (1-3 parts of line) for the next rig and any stake winch. */
export function setWinchParts(n: number): number {
  parts = clamp(Math.round(n), 1, 3);
  for (const w of tows) if (!w.truck) {
    setParts(w.line, parts);
    const d = drumLoad(w.line);
    b3.b3DistanceJoint_SetMaxMotorForce(w.line.joint, d.pull);
    b3.b3DistanceJoint_SetMotorSpeed(w.line.joint, -d.speed);
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
  // the drum holds 50 m: reeved through blocks, each part takes its share of it
  const reach = (DRUM - WRAPS) / parts;
  if (len > reach) return `${Math.round(len)} m away: ${parts} part${parts > 1 ? 's' : ''} of line on a ${DRUM} m drum reach ${reach.toFixed(0)} m`;
  const w: Tow = { line: null!, truck: false, reeling: false, audioT: -9 };
  const stake = makeStake(anchor, true);
  faceStake(stake, point);
  w.line = makeLine(KIND, 'winch', anchorOn(null, anchor, GROUND.deadman), anchorOn(piece, point), len, {
    parts, make: motorJoint, stake, onGone: () => gone(w),
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
    if (next < L.rest - 1e-3) {
      setRest(L, next);
      // the drum fills: the next layer pulls less and runs faster
      const d = drumLoad(L);
      b3.b3DistanceJoint_SetMaxMotorForce(j, d.pull);
      b3.b3DistanceJoint_SetMotorSpeed(j, -d.speed);
    }
    b3.b3Joint_WakeBodies(j);
  }
}

export function winchAfterStep(dt: number): void {
  t += dt;
  for (const w of tows) {
    if (!w.reeling || t - w.audioT < 0.1) continue;
    w.audioT = t;
    audio.winch(true, clamp((w.line.tension * w.line.parts) / drumLoad(w.line).pull, 0, 1));
  }
}

export function syncWinch(_alpha?: number): void {}

export function winchStatus(): ToolReadout {
  const zone = inSnapZone();
  if (!tows.length) {
    const reach = (DRUM - WRAPS) / parts;
    return { title: `Tow winch · ${parts} part${parts > 1 ? 's' : ''} of line`, progress: null, detail: `LMB hook a structure (within ${reach.toFixed(0)} m) · wheel snatch blocks: ${Math.round((PULL * parts * SHEAVE ** (parts - 1)) / 1000)} kN at the hook, ${((REEL / parts) * 60).toFixed(1)} m/min · then LMB a vehicle to tow with it`, warn: false };
  }
  const worst = tows.reduce((a, b) => (b.line.tension / breakLoad(b.line) > a.line.tension / breakLoad(a.line) ? b : a));
  const u = worst.line.tension / breakLoad(worst.line);
  const one = (w: Tow): string => {
    const L = w.line, T = L.tension;
    if (w.truck) return `truck: line ${(T / 1000).toFixed(0)} kN`;
    const d = drumLoad(L);
    return `line pull ${(T / 1000).toFixed(0)}/${Math.round(d.pull / L.parts / 1000)} kN (layer ${d.layer}) · hook ${((T * L.parts) / 1000).toFixed(0)} kN · anchor ${((T * L.parts) / 1000).toFixed(0)}/${Math.round(GROUND.deadman / 1000)} kN`;
  };
  return {
    title: `Tow winch · ${tows.length} line${tows.length > 1 ? 's' : ''}`,
    progress: clamp(u, 0, 1),
    detail: zone
      ? `in the snap-back path: ${Math.round((strainEnergy(zone.L, breakLoad(zone.L)) * zone.L.spec.recoil) / 1000)} kJ comes back down that line if it parts — get out of line with it`
      : tows.map(one).join(' · ') + ` · rope WLL ${Math.round(LINES[KIND].wll / 1000)} kN, break ${Math.round(LINES[KIND].mbl / 1000)} kN · RMB cast off`,
    warn: u > 0.6 || !!zone,
    lines: tows.map(w => lineBar(w.line, w.truck ? 'truck' : `${w.line.parts}× line`)),
  };
}

export function winchDebug(): { tension: number[]; parts: number[]; truck: boolean[] } {
  return { tension: tows.map(w => w.line.tension), parts: tows.map(w => w.line.parts), truck: tows.map(w => w.truck) };
}

export function clearWinch(): void {
  for (const w of tows) if (w.reeling) audio.winch(false, 0);
  tows.length = 0;
}
