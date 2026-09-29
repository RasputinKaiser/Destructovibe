import * as THREE from 'three';
import { vec3, clamp } from 'math';
import type { b3JointId, b3BodyId } from 'box3d.js';
import type { Vec3, ToolReadout } from '../../types';
import { b3, world, ground, raycast } from '../../physics/physics';
import type { Piece } from '../../destruction/structure';
import { vehicleOf } from '../../vehicles/vehicle';
import { cables } from '../../render/cables';
import { getProjectileMaterial } from '../../render/materials';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { hitmarker } from '../../ui/ui';
import { player, addTrauma, kickRecoil } from '../player';
import { hitstop } from '../timefx';
import { NO_HIT, GROUND_Y, interpPoint, nearestPiece, ropeSag, toolHooks } from './common';

/* Tow lines from a ground stake (8 t planetary winch, 13 mm wire rope) or made fast to a vehicle. Reeving the rope
   through snatch blocks divides the speed and multiplies the pull at the hook by the parts of line, while each
   part still carries only the line's own tension up to its rating. */
export const WINCH_RANGE = 35;
export const MAX_TOWS = 3;
const PULL = 110e3;       // N, motor line pull
const REEL = 1.6;         // m/s, single line
const BREAK = 250e3;      // N, 13 mm 6×36 IWRC minimum breaking load ≈ 25 t
const MIN_LEN = 1.2;
const BEHIND = 3;

interface Tow {
  piece: Piece;
  joint: b3JointId;
  anchor: Vec3;
  /** vehicle chassis the rope is made fast to, null for a ground stake */
  truck: Piece | null;
  hitch: Vec3;
  local: Vec3;
  at: Vec3;
  maxLen: number;
  parts: number;
  cables: number[];
  stake: THREE.Object3D | null;
  reeling: boolean;
  over: number;
  tension: number;
  peak: number;
  creakT: number;
  audioT: number;
}

let scene: THREE.Scene;
const tows: Tow[] = [];
let t = 0;
let parts = 1;

export function initWinch(s: THREE.Scene): void { scene = s; }

export function winchTargets(): Piece[] { return tows.map(w => w.piece); }
export function winchActive(): boolean { return tows.length > 0; }
export function winchParts(): number { return parts; }
/** Wheel: reeve through more or fewer snatch blocks (1-3 parts of line) for the next rig and any stake winch. */
export function setWinchParts(n: number): number {
  parts = clamp(Math.round(n), 1, 3);
  for (const w of tows) if (!w.truck) {
    w.parts = parts;
    b3.b3DistanceJoint_SetMaxMotorForce(w.joint, PULL * parts);
    b3.b3DistanceJoint_SetMotorSpeed(w.joint, -REEL / parts);
  }
  return parts;
}

function makeStake(): THREE.Object3D {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.9, 8), getProjectileMaterial('iron'));
  post.position.y = -0.2;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.28, 14), getProjectileMaterial('rocket'));
  drum.rotation.z = Math.PI / 2;
  drum.position.y = 0.05;
  g.add(post, drum);
  g.traverse(o => { o.castShadow = true; });
  return g;
}

/* Soft (zero-hertz spring) below the limit so the cable can go slack; the max-length limit is the ratchet that
   holds whatever the motor (or the truck) has won. collideConnected keeps the towed piece colliding with what the
   rope is anchored to. */
function hook(piece: Piece, point: Vec3, body: b3BodyId, frameA: Vec3, len: number, n: number): { joint: b3JointId; local: Vec3 } {
  const local: Vec3 = [0, 0, 0];
  b3.b3Body_GetLocalPoint(local, piece.body, point);
  const jd = b3.b3DefaultDistanceJointDef();
  jd.base.bodyIdA = body;
  jd.base.localFrameA = { position: frameA, quaternion: [0, 0, 0, 1] };
  jd.base.bodyIdB = piece.body;
  jd.base.localFrameB = { position: local, quaternion: [0, 0, 0, 1] };
  jd.base.collideConnected = true;
  jd.length = len;
  jd.enableSpring = true;
  jd.hertz = 0;
  jd.dampingRatio = 0;
  jd.enableLimit = true;
  jd.minLength = 0.2;
  jd.maxLength = len;
  jd.enableMotor = false;
  jd.maxMotorForce = PULL * n;
  jd.motorSpeed = -REEL / n;
  return { joint: b3.b3CreateDistanceJoint(world, jd), local };
}

function anchorWorld(w: Tow, out: Vec3): Vec3 {
  if (!w.truck) return vec3.copy(out, w.anchor) as Vec3;
  return b3.b3Body_GetWorldPoint(out, w.truck.body, w.hitch) as Vec3;
}

function attach(w: Tow, piece: Piece, point: Vec3, len: number): void {
  const h = w.truck
    ? hook(piece, point, w.truck.body, w.hitch, len, w.parts)
    : hook(piece, point, ground, [w.anchor[0], w.anchor[1] - GROUND_Y, w.anchor[2]], len, w.parts);
  w.piece = piece;
  w.joint = h.joint;
  w.local = h.local;
  w.maxLen = len;
  w.reeling = false;
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
  const stake = makeStake();
  stake.position.fromArray(anchor);
  scene.add(stake);
  const w: Tow = {
    piece, joint: null!, anchor, truck: null, hitch: [0, 0, 0], local: [0, 0, 0], at: [...point], maxLen: len, parts,
    cables: [], stake, reeling: false, over: 0, tension: 0, peak: 0, creakT: -9, audioT: -9,
  };
  attach(w, piece, point, len);
  for (let i = 0; i < parts; i++) w.cables.push(cables.add());
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
  if (b3.b3Joint_IsValid(w.joint)) b3.b3DestroyJoint(w.joint, true);
  if (w.stake) { scene.remove(w.stake); w.stake.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); w.stake = null; }
  if (w.reeling) audio.winch(false, 0);
  w.truck = veh.chassis;
  b3.b3Body_GetLocalPoint(w.hitch, veh.chassis.body, point);
  const at: Vec3 = [0, 0, 0];
  b3.b3Body_GetWorldPoint(at, w.piece.body, w.local);
  // made fast with the slack pulled out by hand, then a metre of rope to take up before it bites
  const len = Math.max(MIN_LEN, vec3.distance(point, at) + 1);
  w.parts = 1;
  attach(w, w.piece, at, len);
  for (const c of w.cables.splice(1)) cables.remove(c);
  audio.chargeStick(point);
  hitmarker(0.4);
  return null;
}

/* The hooked piece broke up under the pull: grab whichever fragment now holds the hook point. */
function rehook(w: Tow): boolean {
  if (!w.piece.dead) return false;
  const q = nearestPiece(w.at, 0.6);
  if (!q || q.volume < 0.02) return false;
  if (b3.b3Joint_IsValid(w.joint)) b3.b3DestroyJoint(w.joint, false);
  attach(w, q, w.at, Math.max(MIN_LEN, vec3.distance(anchorWorld(w, _p), w.at)));
  return true;
}

function alive(w: Tow): boolean {
  return !w.piece.dead && b3.b3Joint_IsValid(w.joint) && (!w.truck || !w.truck.dead);
}

function drop(w: Tow): void {
  if (w.reeling) audio.winch(false, 0);
  if (b3.b3Joint_IsValid(w.joint)) b3.b3DestroyJoint(w.joint, true);
  if (w.stake) { scene.remove(w.stake); w.stake.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
  for (const c of w.cables) cables.remove(c);
  const i = tows.indexOf(w);
  if (i >= 0) tows.splice(i, 1);
}

/** Cast off the newest line (right-click). */
export function castOff(): boolean {
  const w = tows[tows.length - 1];
  if (!w) return false;
  drop(w);
  audio.cableCreak(w.at, 0.4);
  return true;
}

export function releaseWinch(snapped: boolean, w = tows[tows.length - 1]): void {
  if (!w) return;
  drop(w);
  if (snapped) {
    fx.sparks(w.at, [0, 1, 0], 18);
    audio.snap(w.at, 1);
    // a parting wire rope is violent: the stored stretch lets go all at once
    const d = player.e ? Math.hypot(player.e.curPos[0] - w.at[0], player.e.curPos[2] - w.at[2]) : 99;
    if (d < 40) { hitstop(0.06); addTrauma(0.35 * (1 - d / 40)); kickRecoil(0.5); }
    toolHooks.notify(`Tow cable snapped at ${Math.round(w.peak / 1000)} kN`);
  }
}

/* Motors reel in at a capped force; the upper limit ratchets down behind them, so letting go of fire holds the
   length gained instead of paying the cable back out. */
export function winchPreStep(reeling: boolean): void {
  for (const w of [...tows]) {
    if (!alive(w) && !rehook(w)) { drop(w); toolHooks.notify('Tow cable came loose'); continue; }
    if (w.truck) continue;
    const j = w.joint;
    const cur = b3.b3DistanceJoint_GetCurrentLength(j);
    const run = reeling && cur > MIN_LEN;
    if (run !== w.reeling) {
      w.reeling = run;
      b3.b3DistanceJoint_EnableMotor(j, run);
      audio.winch(run, 0);
      if (run) b3.b3Joint_WakeBodies(j);
    }
    if (!run) continue;
    const next = Math.max(MIN_LEN, Math.min(w.maxLen, cur + 0.04 / w.parts));
    if (next < w.maxLen - 1e-3) {
      w.maxLen = next;
      b3.b3DistanceJoint_SetLengthRange(j, 0.2, next);
    }
    b3.b3Joint_WakeBodies(j);
  }
}

const _f: Vec3 = [0, 0, 0];

export function winchAfterStep(dt: number): void {
  t += dt;
  for (const w of [...tows]) {
    if (!alive(w)) continue;
    b3.b3Body_GetWorldPoint(w.at, w.piece.body, w.local);
    b3.b3Joint_GetConstraintForce(_f, w.joint);
    const f = vec3.length(_f);
    w.tension = f / w.parts;
    w.peak = Math.max(w.peak * Math.exp(-dt / 2), f);
    /* two consecutive over-rated steps, so a single contact spike doesn't cut the cable */
    w.over = w.tension > BREAK ? w.over + 1 : 0;
    if (w.over >= 2) { releaseWinch(true, w); continue; }
    if (w.tension > 40e3 && t - w.creakT > 0.9) {
      w.creakT = t;
      audio.cableCreak(w.at, clamp(w.tension / BREAK, 0, 1));
    }
    if (w.reeling && t - w.audioT > 0.1) {
      w.audioT = t;
      audio.winch(true, clamp(f / (PULL * w.parts), 0, 1));
    }
  }
}

const _p: Vec3 = [0, 0, 0], _a: Vec3 = [0, 0, 0], _o: Vec3 = [0, 0, 0], _b: Vec3 = [0, 0, 0];
export function syncWinch(alpha: number): void {
  for (const w of tows) {
    if (w.piece.dead) continue;
    interpPoint(_p, w.piece, w.local, alpha);
    if (w.truck) interpPoint(_a, w.truck, w.hitch, alpha); else vec3.copy(_a, w.anchor);
    const d = vec3.distance(_p, _a);
    const sag = ropeSag(w.maxLen, d);
    // reeved lines run side by side through the blocks, a hand's width apart
    vec3.sub(_o, _p, _a);
    vec3.set(_o, -_o[2], 0, _o[0]);
    vec3.normalize(_o, _o);
    w.cables.forEach((c, i) => {
      const s = (i - (w.cables.length - 1) / 2) * 0.12;
      vec3.scaleAndAdd(_b, _a, _o, s);
      cables.set(c, _b, [_p[0] + _o[0] * s * 0.3, _p[1], _p[2] + _o[2] * s * 0.3], sag);
    });
  }
}

export function winchStatus(): ToolReadout {
  if (!tows.length) return { title: `Tow winch · ${parts} part${parts > 1 ? 's' : ''} of line`, progress: null, detail: `LMB hook a structure · wheel snatch blocks (pull ${Math.round((PULL * parts) / 1000)} kN at ${(REEL / parts).toFixed(1)} m/s) · then LMB a vehicle to tow with it`, warn: false };
  const worst = tows.reduce((a, b) => (b.tension > a.tension ? b : a));
  return {
    title: `Tow winch · ${tows.length} line${tows.length > 1 ? 's' : ''}`,
    progress: clamp(worst.tension / BREAK, 0, 1),
    detail: tows.map(w => `${w.truck ? 'truck' : `${w.parts}×`} ${Math.round(w.tension / 1000)} kN`).join(' · ') + ` of ${Math.round(BREAK / 1000)} kN rating · RMB cast off`,
    warn: worst.tension > BREAK * 0.8,
  };
}

export function winchDebug(): { tension: number[]; parts: number[]; truck: boolean[] } {
  return { tension: tows.map(w => w.tension), parts: tows.map(w => w.parts), truck: tows.map(w => !!w.truck) };
}

export function clearWinch(): void {
  for (const w of tows) {
    if (w.reeling) audio.winch(false, 0);
    if (w.stake) { scene.remove(w.stake); w.stake.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
    for (const c of w.cables) cables.remove(c);
  }
  tows.length = 0;
}
