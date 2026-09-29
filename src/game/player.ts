import * as THREE from 'three';
import { clamp, lerp } from 'math';
import { spring } from 'math/time';
import { simplex3d } from 'math/noise';
import type { b3BodyId, b3Capsule, b3QueryFilter, b3ShapeId, Contact, ContactsBuffer, PlaneResult, PlaneResultBuffer } from 'box3d.js';
import type { Vec3 } from '../types';
import {
  b3, world, CAT, ALL, filter, register, copy3, entityOfBody, type PhysEntity,
} from '../physics/physics';
import { input } from '../core/input';
import { audio } from '../audio/audio';
import { surfaceAt } from '../terrain/terrain';
import { SURFACE } from '../terrain/surface';
import type { Surface } from '../destruction/materials';
import type { Piece } from '../destruction/structure';

/* Kinematic capsule mover (collide-and-slide on Box3D's mover queries). The player owns a dynamic body that
   collides with nothing: it exists so queries and blasts (b3World_Explode on CAT.player) still find the player, and
   whatever velocity a blast leaves on it is read back as a throw. Nothing the player touches gets a solver contact,
   so walking can never load a weld, a service link or a sleeping building; loose light things are shoved by
   explicit, capped impulses instead. */

const R = 0.36;
const STAND = 1.8, CROUCH = 1.2;
const EYE = 1.62, EYE_CROUCH = 1.04;
const STEP = 0.35;
const SNAP = 0.32;
const WALKABLE = Math.cos((45.5 * Math.PI) / 180);
const MASS = 80;
const GRAVITY = 9.81 * 1.5;
/* Human pace: a brisk walk-jog and a real sprint, and a ~0.6 m jump. Faster values made streets feel
   like a scale model and let the player hop onto walls. */
const WALK = 3.0, SPRINT = 6.2, CRAWL = 1.4, FLY = 16, JUMP = 3.5;
const GROUND_ACCEL = 55, AIR_ACCEL = 11;
const SLOP = 0.005;
/** below this a loose piece is kicked aside rather than blocking */
const LIGHT = 4;
/** above this a loose piece is too heavy to shove: static for the player */
const HEAVY = 150;
/** sustained push a braced person manages, N */
const PUSH_FORCE = 450;
/** shoved things never move fast enough to raise a damaging hit event (hitEventThreshold 2.5 m/s) */
const PUSH_SPEED = 2.2;
const MAX_THROW = 15;

export const player = {
  e: null as PhysEntity | null,
  yaw: 0,
  pitch: 0,
  vel: [0, 0, 0] as Vec3,
  grounded: false,
  wasGrounded: false,
  /** what the player stands on (for vehicles / platforms), undefined on static ground or in the air */
  ground: undefined as PhysEntity | undefined,
  coyote: 0,
  jumpBuffer: 0,
  knock: 0,
  fly: false,
  sprint: false,
  crouch: false,
  stamina: 1,
  move: 0,
  /** true while something else (a vehicle seat) positions the player: no walking, no gravity */
  locked: false,
  spawn: [0, 0, 26] as Vec3,
  spawnYaw: 0,
  lastVy: 0,
  stride: 0,
  surface: 'dirt' as Surface,
  sensitivity: 1,
  invertY: false,
  baseFov: 100,
  /** camera-shake multiplier from settings (0 = off) */
  shake: 1,
  lookDelta: [0, 0] as [number, number],
  /** cost of the last mover step, ms */
  moverMs: 0,
};

const dip = spring.create(0);
const recoil = spring.create(0);
const fovKick = spring.create(0);
const tilt = spring.create(0);
const eyeH = spring.create(EYE);
const noise = simplex3d.create(7);
let trauma = 0;
let t = 0;
let bob = 0;
let exhausted = false;
let restT = 0;
let stepOff = 0;
let prevEye = EYE, curEye = EYE;
let stuckT = 0;
let groundBody: b3BodyId | null = null;

const pos: Vec3 = [0, 0, 0];
const from: Vec3 = [0, 0, 0];
const vset: Vec3 = [0, 0, 0];
const platV: Vec3 = [0, 0, 0];
const capStand: b3Capsule = { center1: [0, R, 0], center2: [0, STAND - R, 0], radius: R };
const capCrouch: b3Capsule = { center1: [0, R, 0], center2: [0, CROUCH - R, 0], radius: R };
let cap = capStand;
let shape: b3ShapeId | null = null;
const moveFilter: b3QueryFilter = { categoryBits: CAT.player, maskBits: ALL & ~(CAT.player | CAT.projectile), id: 0n };

const Cls = { Static: 0, Anchored: 1, Push: 2, Soft: 3 } as const;
type Cls = (typeof Cls)[keyof typeof Cls];

interface Plane {
  nx: number; ny: number; nz: number; off: number;
  px: number; py: number; pz: number;
  limit: number; clip: boolean; push: number;
  e: PhysEntity | undefined; body: b3BodyId | null; mass: number; cls: Cls;
}
const MAX_PLANES = 48;
const planes: Plane[] = Array.from({ length: MAX_PLANES }, () => ({
  nx: 0, ny: 0, nz: 0, off: 0, px: 0, py: 0, pz: 0, limit: 0, clip: true, push: 0, e: undefined, body: null, mass: 0, cls: Cls.Static,
}));
let nPlanes = 0;
let flatten = false;
let pr: PlaneResult | null = null;
const origin: Vec3 = [0, 0, 0];

interface Touch { e: PhysEntity | undefined; body: b3BodyId; mass: number; cls: Cls; nx: number; ny: number; nz: number; px: number; py: number; pz: number }
const touches: Touch[] = Array.from({ length: 8 }, () => ({ e: undefined, body: null as unknown as b3BodyId, mass: 0, cls: Cls.Static, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0 }));
let nTouch = 0;

function anchored(p: Piece): boolean {
  return p.dead || p.welds.length > 0 || p.svc !== null || p.proxied > 0 || p.mechs !== null || p.rebars.length > 0 || p.ropes.length > 0 || p.hinged;
}

function classify(body: b3BodyId, e: PhysEntity | undefined): Cls {
  const type = b3.b3Body_GetType(body);
  if (type === b3.b3BodyType.b3_staticBody || e?.kind === 'ground') return Cls.Static;
  if (type !== b3.b3BodyType.b3_dynamicBody || e?.kind !== 'piece' || anchored(e as Piece) || e.mass > HEAVY) return Cls.Anchored;
  return e.mass < LIGHT ? Cls.Soft : Cls.Push;
}

let curE: PhysEntity | undefined;
let curBody: b3BodyId | null = null;
let curMass = 0;
let curCls: Cls = Cls.Static;
const onPlanes = (s: b3ShapeId, buf: PlaneResultBuffer): boolean => {
  curBody = b3.b3Shape_GetBody(s);
  curE = entityOfBody(curBody);
  curCls = classify(curBody, curE);
  curMass = curCls === Cls.Static ? Infinity : curE ? curE.mass : b3.b3Body_GetMass(curBody);
  const n = b3.getNumPlaneResults(buf);
  for (let i = 0; i < n && nPlanes < MAX_PLANES; i++) {
    b3.getPlaneResultAt(pr!, buf, i);
    const q = planes[nPlanes++], nn = pr!.plane.normal;
    q.nx = nn[0]; q.ny = nn[1]; q.nz = nn[2]; q.off = pr!.plane.offset;
    q.px = pr!.point[0] + origin[0]; q.py = pr!.point[1] + origin[1]; q.pz = pr!.point[2] + origin[2];
    q.e = curE; q.body = curBody; q.mass = curMass; q.cls = curCls;
    q.limit = curCls === Cls.Soft ? 0 : Infinity;
    // a shoved object must not also cancel the walk: the player keeps leaning into it
    q.clip = curCls === Cls.Static || curCls === Cls.Anchored;
    if (flatten && q.ny < WALKABLE && q.ny > -0.2) {
      const h = Math.hypot(q.nx, q.nz);
      if (h > 1e-4) { q.off /= h; q.nx /= h; q.nz /= h; q.ny = 0; }
    }
  }
  return true;
};

function collide(p: Vec3, dy = 0): void {
  nPlanes = 0;
  origin[0] = p[0]; origin[1] = p[1] + dy; origin[2] = p[2];
  b3.b3World_CollideMover(world, origin, cap, moveFilter, onPlanes);
}

const castSkip = (): boolean => true;
const tr: Vec3 = [0, 0, 0];
const IDQ: [number, number, number, number] = [0, 0, 0, 1];
function cast(p: Vec3, dx: number, dy: number, dz: number, c: b3Capsule = cap): number {
  if (dx * dx + dy * dy + dz * dz < 1e-12) return 1;
  tr[0] = dx; tr[1] = dy; tr[2] = dz;
  return b3.b3World_CastMover(world, p, c, tr, moveFilter, castSkip);
}

const sol: Vec3 = [0, 0, 0];
/* b2SolvePlanes, in JS so the accumulated pushes come back for velocity clipping (and no marshalling of plane arrays). */
function solve(dx: number, dy: number, dz: number): void {
  for (let i = 0; i < nPlanes; i++) planes[i].push = 0;
  for (let it = 0; it < 20; it++) {
    let total = 0;
    for (let i = 0; i < nPlanes; i++) {
      const q = planes[i];
      const sep = q.nx * dx + q.ny * dy + q.nz * dz - q.off + SLOP;
      const acc = q.push;
      q.push = clamp(acc - sep, 0, q.limit);
      const push = q.push - acc;
      dx += push * q.nx; dy += push * q.ny; dz += push * q.nz;
      total += Math.abs(push);
    }
    if (total < SLOP) break;
  }
  sol[0] = dx; sol[1] = dy; sol[2] = dz;
}

function clipVel(v: Vec3): void {
  for (let i = 0; i < nPlanes; i++) {
    const q = planes[i];
    if (q.push <= 0 || !q.clip) continue;
    const d = v[0] * q.nx + v[1] * q.ny + v[2] * q.nz;
    if (d < 0) { v[0] -= d * q.nx; v[1] -= d * q.ny; v[2] -= d * q.nz; }
  }
}

const same = (a: b3BodyId, b: b3BodyId): boolean => a.index1 === b.index1 && a.generation === b.generation;
function note(): void {
  for (let i = 0; i < nPlanes; i++) {
    const q = planes[i];
    if (q.cls === Cls.Static || !q.body) continue;
    let k = 0;
    while (k < nTouch && !same(touches[k].body, q.body)) k++;
    if (k === nTouch) { if (nTouch === touches.length) continue; nTouch++; }
    const tc = touches[k];
    tc.e = q.e; tc.body = q.body; tc.mass = q.mass; tc.cls = q.cls; tc.nx = q.nx; tc.ny = q.ny; tc.nz = q.nz; tc.px = q.px; tc.py = q.py; tc.pz = q.pz;
  }
}

const tgt: Vec3 = [0, 0, 0];
/** Collide-and-slide from p by delta; p is moved in place. `vel` (when given) is clipped against what stopped it. */
function slide(p: Vec3, dx: number, dy: number, dz: number, vel: Vec3 | null): void {
  tgt[0] = p[0] + dx; tgt[1] = p[1] + dy; tgt[2] = p[2] + dz;
  for (let it = 0; it < 4; it++) {
    collide(p);
    note();
    solve(tgt[0] - p[0], tgt[1] - p[1], tgt[2] - p[2]);
    if (vel) {
      clipVel(vel);
      // overlap the planes could not resolve between them (pinned between a body and the floor)
      deep = 0;
      for (let i = 0; i < nPlanes; i++) {
        const q = planes[i], r = q.off - (q.nx * sol[0] + q.ny * sol[1] + q.nz * sol[2]);
        if (q.limit > 0 && r > deep) { deep = r; deepX = q.nx; deepZ = q.nz; }
        if (q.push > 0 && q.clip && q.ny < WALKABLE) lowBlock = Math.min(lowBlock, q.py - p[1]);
      }
    }
    const f = cast(p, sol[0], sol[1], sol[2]);
    p[0] += sol[0] * f; p[1] += sol[1] * f; p[2] += sol[2] * f;
    // a clear sweep leaves no new contact to solve against
    if (f >= 1 || (sol[0] * sol[0] + sol[1] * sol[1] + sol[2] * sol[2]) * f * f < 1e-6) break;
  }
}

interface Ground { ny: number; e: PhysEntity | undefined; body: b3BodyId | null; cls: Cls; px: number; py: number; pz: number; top: number }
const gnd: Ground = { ny: -1, e: undefined, body: null, cls: Cls.Static, px: 0, py: 0, pz: 0, top: 0 };
/** Best supporting plane just under p. */
function probeGround(p: Vec3): Ground {
  const was = flatten;
  flatten = false;
  collide(p, -0.03);
  flatten = was;
  gnd.ny = -1; gnd.e = undefined; gnd.body = null;
  for (let i = 0; i < nPlanes; i++) {
    const q = planes[i];
    if (q.ny > gnd.ny) { gnd.ny = q.ny; gnd.e = q.e; gnd.body = q.body; gnd.cls = q.cls; gnd.px = q.px; gnd.py = q.py; gnd.pz = q.pz; gnd.top = q.py; }
  }
  // the rounded foot resting on a step's nosing reports the edge's tilted normal: judge the tread itself
  if (gnd.ny < WALKABLE && gnd.ny > 0.2) {
    const q = planes.find(x => x.ny === gnd.ny)!;
    const h = Math.hypot(q.nx, q.nz);
    const r = b3.b3World_CastRayClosest(world, [q.px - (q.nx / h) * 0.04, q.py + 0.06, q.pz - (q.nz / h) * 0.04], [0, -0.12, 0], moveFilter);
    if (r.hit && r.normal[1] >= WALKABLE) { gnd.ny = r.normal[1]; gnd.top = r.point[1]; }
  }
  return gnd;
}

export function createPlayer(p: Vec3, yaw: number): void {
  copy3(player.spawn, p);
  player.spawnYaw = yaw;
  pr ??= b3.createPlaneResult();
  const bd = b3.b3DefaultBodyDef();
  bd.type = b3.b3BodyType.b3_dynamicBody;
  bd.position = [p[0], p[1] + 0.02, p[2]];
  bd.motionLocks = { linearX: false, linearY: false, linearZ: false, angularX: true, angularY: true, angularZ: true };
  bd.enableSleep = false;
  bd.gravityScale = 0;
  const body = b3.b3CreateBody(world, bd);
  const sd = b3.b3DefaultShapeDef();
  const vol = Math.PI * R * R * (STAND - 2 * R) + (4 / 3) * Math.PI * R * R * R;
  sd.density = MASS / vol;
  sd.filter = filter(CAT.player, CAT.player);
  sd.enableContactEvents = false;
  sd.enableHitEvents = false;
  cap = capStand;
  shape = b3.b3CreateCapsuleShape(body, sd, capStand);
  const e: PhysEntity = {
    kind: 'player', body, mass: b3.b3Body_GetMass(body),
    prevPos: [...bd.position], prevRot: [0, 0, 0, 1], curPos: [...bd.position], curRot: [0, 0, 0, 1], movedStep: -1,
  };
  register(e);
  player.e = e;
  player.yaw = yaw;
  player.pitch = -0.04;
  player.fly = false;
  player.locked = false;
  player.knock = 0;
  player.stamina = 1;
  player.crouch = false;
  trauma = 0;
  place(bd.position);
}

/** Puts the player at p at rest (respawn, teleport, vehicle exit). */
export function teleport(p: Vec3, yaw = player.yaw, pitch = player.pitch): void {
  const e = player.e;
  if (!e) return;
  copy3(pos, p); copy3(from, p);
  player.vel[0] = player.vel[1] = player.vel[2] = 0;
  vset[0] = vset[1] = vset[2] = 0;
  b3.b3Body_SetTransform(e.body, pos, IDQ);
  b3.b3Body_SetLinearVelocity(e.body, vset);
  copy3(e.curPos, pos); copy3(e.prevPos, pos);
  player.yaw = yaw; player.pitch = pitch;
  player.grounded = player.wasGrounded = false;
  player.ground = undefined;
  groundBody = null;
  stepOff = 0;
}

function place(p: Vec3): void { teleport(p, player.yaw, player.pitch); }

/** Takes the player out of the world (seated in a vehicle: no queries, blasts or movement) or puts him back. */
export function setPlayerEnabled(on: boolean): void {
  const e = player.e;
  if (!e) return;
  if (on) b3.b3Body_Enable(e.body); else b3.b3Body_Disable(e.body);
  player.locked = !on;
}

export function applyLook(dx: number, dy: number): void {
  const k = 0.0022 * player.sensitivity;
  player.yaw -= dx * k;
  player.pitch = clamp(player.pitch - dy * k * (player.invertY ? -1 : 1), -1.54, 1.54);
  player.lookDelta[0] += dx;
  player.lookDelta[1] += dy;
}

export function toggleFly(): boolean {
  player.fly = !player.fly;
  player.vel[1] = 0;
  if (player.fly && player.crouch) setCrouch(false, true);
  return player.fly;
}

export function addTrauma(a: number): void { trauma = Math.min(1, trauma + a); }
/* With camera shake off the aim still kicks a little (it says the shot went off), the lens punch not at all. */
export function kickRecoil(a: number): void { recoil.velocity += a * (0.35 + 0.65 * player.shake); }
export function kickFov(a: number): void { fovKick.velocity += a * player.shake; }
export function knockback(seconds: number): void { player.knock = Math.max(player.knock, seconds); }

function setCrouch(on: boolean, force = false): boolean {
  if (on === player.crouch) return true;
  if (!on && !force && cast(pos, 0, STAND - CROUCH, 0, capCrouch) < 1) return false;
  player.crouch = on;
  cap = on ? capCrouch : capStand;
  if (shape) b3.b3Shape_SetCapsule(shape, cap);
  return true;
}

const bodyP: Vec3 = [0, 0, 0];
const bodyV: Vec3 = [0, 0, 0];
const tmp: Vec3 = [0, 0, 0];

export function playerPreStep(dt: number): void {
  const e = player.e;
  if (!e) return;
  const t0 = performance.now();
  b3.b3Body_GetPosition(bodyP, e.body);
  b3.b3Body_GetLinearVelocity(bodyV, e.body);
  const vel = player.vel;
  if (Math.hypot(bodyP[0] - pos[0], bodyP[1] - pos[1], bodyP[2] - pos[2]) > 0.05) {
    // moved by someone else (a debug teleport, a vehicle seat): take it as a fresh start
    copy3(pos, bodyP);
    // or the physics step reads the jump as a runaway body and puts it back
    copy3(e.prevPos, pos); copy3(e.curPos, pos);
    vel[0] = vel[1] = vel[2] = 0;
    player.grounded = false;
    stepOff = 0;
  } else {
    // a blast (or any impulse) since the last step shows up as velocity we did not set
    let ix = bodyV[0] - vset[0], iy = bodyV[1] - vset[1], iz = bodyV[2] - vset[2];
    const il = Math.hypot(ix, iy, iz);
    if (il > 0.3) {
      if (il > MAX_THROW) { ix *= MAX_THROW / il; iy *= MAX_THROW / il; iz *= MAX_THROW / il; }
      vel[0] += ix; vel[1] += iy; vel[2] += iz;
      if (iy > 0.5) player.grounded = false;
      player.knock = Math.max(player.knock, 0.25 + il * 0.03);
    }
  }
  copy3(from, pos);
  prevEye = curEye;
  nTouch = 0;

  if (player.locked) {
    vel[0] = vel[1] = vel[2] = 0;
    finish(e, dt, t0);
    return;
  }

  player.wasGrounded = player.grounded;
  player.jumpBuffer -= dt;
  player.knock -= dt;
  if (player.grounded) player.coyote = 0.12; else player.coyote -= dt;

  const f = (input.down.has('KeyW') || input.down.has('ArrowUp') ? 1 : 0) - (input.down.has('KeyS') || input.down.has('ArrowDown') ? 1 : 0);
  const s = (input.down.has('KeyD') || input.down.has('ArrowRight') ? 1 : 0) - (input.down.has('KeyA') || input.down.has('ArrowLeft') ? 1 : 0);
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const low = input.down.has('KeyC') || input.down.has('ControlLeft') || input.down.has('ControlRight');
  const shift = input.down.has('ShiftLeft') || input.down.has('ShiftRight');
  player.move = wl > 0 ? 1 : 0;

  if (player.fly) {
    player.sprint = shift && f > 0;
    const up = (input.down.has('Space') ? 1 : 0) - (low ? 1 : 0);
    const sp = player.sprint ? FLY * 2 : FLY;
    const cp = Math.cos(player.pitch), spp = Math.sin(player.pitch);
    const tx = (-sy * cp * f + cy * s) * sp, tz = (-cy * cp * f - sy * s) * sp, ty = (spp * f + up) * sp;
    const k = Math.min(1, dt * 8);
    vel[0] = lerp(vel[0], tx, k); vel[1] = lerp(vel[1], ty, k); vel[2] = lerp(vel[2], tz, k);
    flatten = false;
    slide(pos, vel[0] * dt, vel[1] * dt, vel[2] * dt, vel);
    player.grounded = false;
    player.ground = undefined;
    input.pressed.delete('Space');
    finish(e, dt, t0);
    return;
  }

  if (low) setCrouch(true); else if (player.crouch) setCrouch(false);

  // stamina: sprint drains it; once empty it must recover a third before sprinting again
  const wantSprint = shift && f > 0 && !player.crouch && !exhausted && player.stamina > 0;
  player.sprint = wantSprint;
  if (wantSprint && player.grounded) { player.stamina = Math.max(0, player.stamina - dt / 7); restT = 0; if (player.stamina === 0) exhausted = true; }
  else if ((restT += dt) > 0.8) player.stamina = Math.min(1, player.stamina + dt / 3.5);
  if (exhausted && player.stamina > 0.35) exhausted = false;

  // platform the player stood on at the end of the last step
  platV[0] = platV[1] = platV[2] = 0;
  const gb = player.grounded ? groundBody : null;
  if (gb && b3.b3Body_IsValid(gb)) {
    b3.b3Body_GetWorldPointVelocity(platV, gb, pos);
    b3.b3Body_GetAngularVelocity(tmp, gb);
    player.yaw += tmp[1] * dt;
  }

  const target = player.crouch ? CRAWL : player.sprint ? SPRINT : WALK;
  if (player.grounded && player.knock <= 0) {
    const dx = wx * target + platV[0] - vel[0], dz = wz * target + platV[2] - vel[2];
    const dl = Math.hypot(dx, dz), maxD = GROUND_ACCEL * dt;
    if (dl > maxD) { vel[0] += (dx / dl) * maxD; vel[2] += (dz / dl) * maxD; } else { vel[0] += dx; vel[2] += dz; }
  } else if (wl > 0) {
    const rx = vel[0] - platV[0], rz = vel[2] - platV[2];
    const before = Math.hypot(rx, rz);
    let ax = rx + wx * AIR_ACCEL * dt, az = rz + wz * AIR_ACCEL * dt;
    const after = Math.hypot(ax, az), capV = Math.max(before, target);
    if (after > capV) { ax *= capV / after; az *= capV / after; }
    vel[0] = ax + platV[0]; vel[2] = az + platV[2];
  }
  if (player.grounded && vel[1] - platV[1] < 0.5) vel[1] = platV[1];
  else vel[1] -= GRAVITY * dt;

  let jumped = false;
  if (input.pressed.has('Space')) player.jumpBuffer = 0.14;
  if (player.jumpBuffer > 0 && player.coyote > 0 && !player.crouch) {
    vel[1] = Math.max(vel[1], platV[1]) + JUMP;
    player.jumpBuffer = 0;
    player.coyote = 0;
    player.grounded = false;
    jumped = true;
    audio.jump();
  }
  input.pressed.delete('Space');

  // move: plain slide, then (on the ground) the same move lifted by a step, kept only if it gets further
  const dx = vel[0] * dt, dy = vel[1] * dt, dz = vel[2] * dt;
  const walking = player.grounded && !jumped;
  flatten = walking;
  copy3(v0, vel);
  lowBlock = Infinity;
  slide(pos, dx, dy, dz, vel);
  // on the ground height comes from snapping, not from velocity: a ramp or nosing must not launch the player
  if (walking) vel[1] = v0[1];
  const dh = Math.hypot(dx, dz);
  if (walking && dh > 1e-4) {
    const ux = dx / dh, uz = dz / dh;
    const got = (pos[0] - from[0]) * ux + (pos[2] - from[2]) * uz;
    // pressing on against something already found unclimbable from this very spot: don't re-probe every step
    const same = Math.abs(from[0] - noStep[0]) + Math.abs(from[1] - noStep[1]) + Math.abs(from[2] - noStep[2]) < 0.01 && ux * noStep[3] + uz * noStep[4] > 0.98;
    if (got < dh * 0.9 && !same) {
      // the blocked slide already clipped the walk to nothing: step with the intended stride
      const w = Math.max(dh, Math.hypot(wx, wz) * target * dt);
      if (stepUp(ux, uz, ux * w, dy, uz * w, got)) copy3(vel, v0);
      // stopped at head height (a soffit, the trimmer over a stair going down) with room lower down: duck under it
      else if (got < dh * 0.5 && !player.crouch && lowBlock > 0.5 && cast(from, ux * w, 0, uz * w, capCrouch) > 0.9) setCrouch(true);
      else { noStep[0] = from[0]; noStep[1] = from[1]; noStep[2] = from[2]; noStep[3] = ux; noStep[4] = uz; }
    }
  }

  // ground: snap down stairs and ramps while walking, otherwise just look for a landing
  const relVy = vel[1] - platV[1];
  player.grounded = false;
  player.ground = undefined;
  groundBody = null;
  if (!jumped && relVy <= 0.5) {
    const dist = walking ? SNAP : 0.04;
    const fr = cast(pos, 0, -dist, 0);
    if (fr < 1) {
      const drop = fr * dist;
      tmp[0] = pos[0]; tmp[1] = pos[1] - drop; tmp[2] = pos[2];
      const g = probeGround(tmp);
      if (g.ny >= WALKABLE) {
        pos[1] -= drop;
        if (walking && drop > 0.04) stepOff += drop;
        player.grounded = true;
        player.ground = g.cls === Cls.Static ? undefined : g.e;
        groundBody = g.cls === Cls.Static ? null : g.body;
        const ent = g.e;
        player.surface = ent && ent.kind === 'piece' ? (ent as Piece).pm.surface : SURFACE[surfaceAt(pos[0], pos[2])].audio;
      }
    }
  }
  flatten = false;

  if (player.grounded) {
    const landV = relVy;
    if (!player.wasGrounded && player.lastVy < -3) {
      const strength = clamp((-player.lastVy - 3) / 9, 0, 1);
      dip.velocity -= 0.6 + strength * 2.2;
      audio.land(strength);
      if (strength > 0.4) addTrauma(strength * 0.25);
    }
    if (landV < 0) vel[1] = platV[1];
    const speed = Math.hypot(vel[0] - platV[0], vel[2] - platV[2]);
    player.stride += speed * dt;
    const len = player.sprint ? 2.7 : player.crouch ? 1.4 : 2.1;
    if (player.stride > len && speed > 1) { player.stride = 0; audio.footstep(player.surface); }
  }
  player.lastVy = relVy;

  interact(dt, wx * target, wz * target);
  unstick(dt);
  finish(e, dt, t0);
}

const sp: Vec3 = [0, 0, 0];
const v0: Vec3 = [0, 0, 0];
const noStep = [0, 0, 0, 0, 0];
function stepUp(ux: number, uz: number, dx: number, dy: number, dz: number, got: number): boolean {
  let up = cast(from, 0, STEP, 0) * STEP - SLOP;
  // head against a low ceiling over a stair or a sill: duck (standing up again resumes once clear)
  if (up < STEP * 0.9 && !player.crouch && setCrouch(true)) up = cast(from, 0, STEP, 0) * STEP - SLOP;
  if (up < 0.05) return false;
  sp[0] = from[0]; sp[1] = from[1] + up; sp[2] = from[2];
  slide(sp, dx, Math.max(0, dy), dz, null);
  const down = up + 0.05;
  const fr = cast(sp, 0, -down, 0);
  if (fr >= 1) return false;
  sp[1] -= fr * down;
  const gotS = (sp[0] - from[0]) * ux + (sp[2] - from[2]) * uz;
  if (sp[1] - from[1] < 0.01 || gotS < got + 0.005) return false;
  const g = probeGround(sp);
  const rise = g.top - from[1];
  if (rise > STEP + 0.01 || (g.ny < WALKABLE && !treadAhead(ux, uz))) return false;
  stepOff -= sp[1] - pos[1];
  copy3(pos, sp);
  return true;
}

/* Lifted onto a pipe's crown or a step's nosing: fine if the next footfall ahead is walkable within a step. */
function treadAhead(ux: number, uz: number): boolean {
  const d = R + 0.12, y0 = from[1] + STEP + 0.05;
  const r = b3.b3World_CastRayClosest(world, [from[0] + ux * d, y0, from[2] + uz * d], [0, -(STEP + 0.2), 0], moveFilter);
  return r.hit && r.normal[1] >= WALKABLE && r.point[1] - from[1] <= STEP + 0.01;
}

const pv: Vec3 = [0, 0, 0];
const pp: Vec3 = [0, 0, 0];
const imp: Vec3 = [0, 0, 0];
/* Contacts with moving or loose bodies: a moving body shoves the player (momentum shared by mass); the player shoves
   loose light things with a capped impulse. Welded, service-run and heavy pieces never receive anything. */
function interact(dt: number, wishX: number, wishZ: number): void {
  const vel = player.vel;
  for (let i = 0; i < nTouch; i++) {
    const tc = touches[i];
    const body = tc.body;
    if (!b3.b3Body_IsValid(body) || (groundBody && same(body, groundBody))) continue;
    pp[0] = tc.px; pp[1] = tc.py; pp[2] = tc.pz;
    b3.b3Body_GetWorldPointVelocity(pv, body, pp);
    const loose = tc.cls === Cls.Push || tc.cls === Cls.Soft;
    const m = tc.mass;
    const share = loose ? m / (m + MASS) : 1;
    const vn = pv[0] * tc.nx + pv[1] * tc.ny + pv[2] * tc.nz;
    const vp = vel[0] * tc.nx + vel[1] * tc.ny + vel[2] * tc.nz;
    const vs = loose ? (m * vn + MASS * vp) / (m + MASS) : vn;
    if (vn > 0.3 && vs > vp) {
      const dv = (vs - vp) * (loose ? 1 : share);
      vel[0] += dv * tc.nx; vel[1] += dv * tc.ny; vel[2] += dv * tc.nz;
      if (dv > 2.5) { knockback(0.15 + dv * 0.03); addTrauma(Math.min(0.5, dv * 0.05)); }
      if (tc.ny < -0.3 && player.grounded && !loose) {
        // pinned from above against the floor: nothing vertical can give, so the player is thrown clear sideways
        b3.b3Body_GetWorldCenterOfMass(imp, body);
        let ex = pos[0] - imp[0], ez = pos[2] - imp[2];
        const el = Math.hypot(ex, ez);
        if (el < 0.05) { ex = Math.sin(player.yaw); ez = Math.cos(player.yaw); } else { ex /= el; ez /= el; }
        const kick = Math.max(4, vn * 1.2) - (vel[0] * ex + vel[2] * ez);
        if (kick > 0) {
          vel[0] += ex * kick; vel[2] += ez * kick;
          knockback(0.3);
          addTrauma(0.4);
          setCrouch(true);
        }
      }
      if (loose) {
        imp[0] = -dv * MASS * tc.nx; imp[1] = -dv * MASS * tc.ny; imp[2] = -dv * MASS * tc.nz;
        b3.b3Body_ApplyLinearImpulse(body, imp, pp, true);
      }
      continue;
    }
    if (!loose) continue;
    // push: horizontal, toward the object, up to the shared walking speed and the player's push force
    const h = Math.hypot(tc.nx, tc.nz);
    if (h < 0.3 || !pushable(tc.e as Piece, body, m)) continue;
    const ix = -tc.nx / h, iz = -tc.nz / h;
    const into = wishX * ix + wishZ * iz;
    if (into <= 0.1) continue;
    const want = Math.min(PUSH_SPEED, into * MASS / (m + MASS));
    const have = pv[0] * ix + pv[2] * iz;
    if (have >= want) continue;
    const j = Math.min(m * (want - have), PUSH_FORCE * dt);
    b3.b3Body_GetWorldCenterOfMass(imp, body);
    pp[1] = Math.min(pp[1], imp[1]);
    imp[0] = ix * j; imp[1] = 0; imp[2] = iz * j;
    b3.b3Body_ApplyLinearImpulse(body, imp, pp, true);
  }
}

let cbuf: ContactsBuffer | null = null;
let cc: Contact | null = null;
/* Only what a shove can actually slide, and never something whose push would wake an island: a sleeping piece
   resting on or against anything but static ground (a floor, a pile, a paving course) is left alone. */
function pushable(p: Piece, body: b3BodyId, m: number): boolean {
  if ((p.root.spec.friction ?? p.pm.friction) * m * 9.81 > PUSH_FORCE) return false;
  if (b3.b3Body_IsAwake(body)) return true;
  cbuf ??= b3.createContactsBuffer();
  cc ??= b3.createContact();
  b3.getBodyContactData(cbuf, body);
  const n = b3.getNumContacts(cbuf);
  for (let i = 0; i < n; i++) {
    b3.getContactAt(cc, cbuf, i);
    if (cc.manifoldCount === 0) continue;
    let other = b3.b3Shape_GetBody(cc.shapeIdA);
    if (same(other, body)) other = b3.b3Shape_GetBody(cc.shapeIdB);
    if (b3.b3Body_GetType(other) !== b3.b3BodyType.b3_staticBody) return false;
  }
  return true;
}

/* Squeezed between a body and the floor the planes contradict each other: duck, then give way sideways. */
let deep = 0, deepX = 0, deepZ = 0, lowBlock = Infinity;
function unstick(dt: number): void {
  if (deep < 0.06) { stuckT = 0; return; }
  stuckT += dt;
  if (!player.crouch) { setCrouch(true); return; }
  if (stuckT < 0.2) return;
  let hx = deepX, hz = deepZ;
  const h = Math.hypot(hx, hz);
  if (h < 0.2) { hx = -Math.sin(player.yaw); hz = -Math.cos(player.yaw); } else { hx /= h; hz /= h; }
  const d = Math.min(deep + 0.02, 0.2);
  const fr = cast(pos, hx * d, 0, hz * d);
  pos[0] += hx * d * fr; pos[2] += hz * d * fr;
}

function finish(e: PhysEntity, dt: number, t0: number): void {
  if (pos[1] < -25 || Math.abs(pos[0]) > 380 || Math.abs(pos[2]) > 380) { respawn(); player.moverMs = performance.now() - t0; return; }
  spring.damp(eyeH, player.crouch ? EYE_CROUCH : EYE, 0.09, dt);
  stepOff *= Math.exp(-dt * 13);
  if (Math.abs(stepOff) < 1e-3) stepOff = 0;
  stepOff = clamp(stepOff, -0.45, 0.45);
  curEye = eyeH.value + stepOff;
  // the body lands exactly on the mover's result during the physics step, carrying the player's real velocity
  vset[0] = (pos[0] - from[0]) / dt; vset[1] = (pos[1] - from[1]) / dt; vset[2] = (pos[2] - from[2]) / dt;
  b3.b3Body_SetTransform(e.body, from, IDQ);
  b3.b3Body_SetLinearVelocity(e.body, vset);
  player.moverMs = performance.now() - t0;
}

export function playerPostStep(): void {
  const e = player.e;
  if (!e) return;
  copy3(e.prevPos, from);
  copy3(e.curPos, pos);
}

export function respawn(): void {
  if (!player.e) return;
  if (player.crouch) setCrouch(false, true);
  teleport([player.spawn[0], player.spawn[1] + 0.02, player.spawn[2]], player.spawnYaw, -0.04);
}

const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export function eyePosition(out: Vec3, alpha: number): Vec3 {
  const e = player.e!;
  out[0] = lerp(e.prevPos[0], e.curPos[0], alpha);
  out[1] = lerp(e.prevPos[1], e.curPos[1], alpha) + lerp(prevEye, curEye, alpha);
  out[2] = lerp(e.prevPos[2], e.curPos[2], alpha);
  return out;
}

const eye: Vec3 = [0, 0, 0];
export function updateCamera(camera: THREE.PerspectiveCamera, alpha: number, dt: number): void {
  if (!player.e) return;
  t += dt;
  trauma = Math.max(0, trauma - dt * 0.9);
  spring.update(dip, 0, 0.12, 0.55, dt);
  spring.update(recoil, 0, 0.09, 0.6, dt);
  spring.update(fovKick, 0, 0.14, 0.5, dt);
  const strafe = (input.down.has('KeyD') ? 1 : 0) - (input.down.has('KeyA') ? 1 : 0);
  spring.damp(tilt, player.fly ? 0 : -strafe * 0.012, 0.12, dt);

  const v = player.vel;
  const speed = player.grounded ? Math.hypot(v[0] - platV[0], v[2] - platV[2]) : 0;
  const moving = player.grounded && player.move > 0 && speed > 0.5;
  bob += dt * (moving ? (player.sprint ? 13 : player.crouch ? 7 : 10) : 0);
  const bobAmp = moving ? clamp(speed / WALK, 0, 1.6) * (player.crouch ? 0.02 : 0.03) : 0;

  eyePosition(eye, alpha);
  const sh = trauma * trauma * player.shake;
  const n = (o: number): number => simplex3d.sample(noise, t * 18, o, 0);
  camera.position.set(
    eye[0] + n(10) * sh * 0.12,
    eye[1] + dip.value + Math.abs(Math.sin(bob)) * bobAmp + n(20) * sh * 0.12,
    eye[2] + n(30) * sh * 0.12,
  );
  euler.set(
    player.pitch + recoil.value + n(40) * sh * 0.09,
    player.yaw + n(50) * sh * 0.09,
    tilt.value + n(60) * sh * 0.07 + Math.sin(bob * 0.5) * bobAmp * 0.25,
  );
  camera.quaternion.setFromEuler(euler);
  const kick = player.fly ? 0 : clamp((speed - WALK) / (SPRINT - WALK), 0, 1) * 7;
  /* the setting is horizontal FOV at 16:9 (the convention players know); three.js wants vertical. Applying 80
     as vertical gave ~110° horizontal, a wide-angle lens that made the world read as miniature. Hor+: the
     vertical angle is fixed, so wider windows see more at the sides instead of zooming in */
  const fov = vfov(player.baseFov + kick + fovKick.value);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = lerp(camera.fov, fov, Math.min(1, dt * 10));
    camera.updateProjectionMatrix();
  }
}

export function forward(out: Vec3): Vec3 {
  const cp = Math.cos(player.pitch);
  out[0] = -Math.sin(player.yaw) * cp;
  out[1] = Math.sin(player.pitch);
  out[2] = -Math.cos(player.yaw) * cp;
  return out;
}

export function vfov(hfovDeg: number): number {
  return (2 * Math.atan(Math.tan((hfovDeg * Math.PI) / 360) / (16 / 9)) * 180) / Math.PI;
}
