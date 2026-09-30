import * as THREE from 'three';
import { clamp, lerp } from 'math';
import { spring } from 'math/time';
import { simplex3d } from 'math/noise';
import type { b3BodyId, b3Capsule, b3QueryFilter, b3ShapeId, Contact, ContactsBuffer, PlaneResult, PlaneResultBuffer } from 'box3d.js';
import type { Vec3 } from '../types';
import {
  b3, world, CAT, ALL, filter, register, copy3, entityOfBody, entityOfShape, type PhysEntity,
} from '../physics/physics';
import { input, held, hit, consume, moveAxes, pad } from '../core/input';
import { audio } from '../audio/audio';
import { surfaceAt } from '../terrain/terrain';
import { SURFACE, type SurfaceId } from '../terrain/surface';
import type { Surface } from '../destruction/materials';
import type { Piece } from '../destruction/structure';
import * as K from './move/kinematics';

/* Kinematic capsule mover (collide-and-slide on Box3D's mover queries). The player owns a dynamic body that
   collides with nothing: it exists so queries and blasts (b3World_Explode on CAT.player) still find the player, and
   whatever velocity a blast leaves on it is read back as a throw. Nothing the player touches gets a solver contact,
   so walking can never load a weld, a service link or a sleeping building; loose light things are shoved by
   explicit, capped impulses instead. The feet (speed-up, braking, jump arc, what a landing does to a body) are the pure
   math in move/kinematics.ts. */

const R = 0.36;
const STAND = 1.8, CROUCH = 1.2;
const EYE = 1.62, EYE_CROUCH = 1.04, EYE_DOWN = 0.42;
const STEP = 0.35;
const SNAP = 0.32;
const WALKABLE = Math.cos((45.5 * Math.PI) / 180);
/** broken lumps are rough and interlock: a boot finds purchase on a steeper face of rubble than of a smooth slab */
const RUBBLE_WALKABLE = Math.cos((58 * Math.PI) / 180);
const footing = (ny: number, rough: boolean): boolean => ny >= (rough ? RUBBLE_WALKABLE : WALKABLE);
/** broken or loose: a fracture fragment, or anything light enough to shift underfoot */
const isRough = (e: PhysEntity | undefined, cls: number): boolean => e?.kind === 'piece' && ((e as Piece).depth > 0 || cls === 2 || cls === 3);
const MASS = 80;
const FLY = 16;
const SLOP = 0.005;
/** below this a loose piece is kicked aside rather than blocking */
const LIGHT = 4;
/** above this a loose piece is too heavy to shove: static for the player */
const HEAVY = 150;
/** sustained push a braced person manages, N */
const PUSH_FORCE = 450;
/** shoved things never move fast enough to raise a damaging hit event (hitEventThreshold 2.5 m/s) */
const PUSH_SPEED = 2.2;
/** a blast throws a person a few metres, it does not launch him across the site */
const MAX_THROW = 9;
/** what a moving member can impart before the body just folds (knocked down, not thrown) */
const MAX_SHOVE = 3.5;
const COYOTE = 0.12, BUFFER = 0.15;
/** climbing: a hand on anything up to chest height from the ground, a bit less from a jump; walking into anything up
    to thigh height scrambles over it */
const MANTLE_MAX = 1.25, MANTLE_AIR = 0.9, SCRAMBLE_MAX = 0.75;
const LEAN = 0.32, LEAN_ROLL = 0.12;
const ZOOM_FOV = 30;

export type Impacts = 'off' | 'stumble' | 'real';

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
  /** holding the careful key: slow walk, A/D lean */
  careful: false,
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
  /** head bob on/off (settings) */
  headBob: true,
  crouchToggle: false,
  sprintToggle: false,
  /** what falls and blows do: nothing past a stagger, knockdowns, or knockdowns and a blackout at the extremes */
  impacts: 'real' as Impacts,
  lookDelta: [0, 0] as [number, number],
  /** cost of the last mover step, ms */
  moverMs: 0,
  /** 0..1 climbing progress, -1 when not climbing */
  mantle: -1,
  /** seconds left lying on the ground after a knockdown */
  downed: 0,
  /** seconds of a stagger (slowed, no sprint or jump) */
  stagger: 0,
  /** seconds of limping after a hard fall */
  limp: 0,
  /** 0..1 how rattled: drives the screen's hurt vignette */
  daze: 0,
  /** 0..1 blackout fade (a fatal impact, before the respawn) */
  black: 0,
  /** -1..1 lean, and 0..1 zoom, as the camera shows them */
  lean: 0,
  zoom: 0,
  /** last landing, for the playtest hooks */
  lastLanding: null as K.Landing | null,
};

const dip = spring.create(0);
const recoil = spring.create(0);
const fovKick = spring.create(0);
const tilt = spring.create(0);
const eyeH = spring.create(EYE);
const stepSp = spring.create(0);
const leanSp = spring.create(0);
const zoomSp = spring.create(0);
const climbSp = spring.create(0);
const downRoll = spring.create(0);
const noise = simplex3d.create(7);
let trauma = 0;
let t = 0;
let bobPhase = 0;
let exhausted = false;
let restT = 0;
let prevEye = EYE, curEye = EYE;
let stuckT = 0;
let groundBody: b3BodyId | null = null;
let crouchLatch = false, sprintLatch = false;
/** a duck the mover chose (a beam, a soffit): held a moment, and only given up with headroom ahead too */
let autoLow = 0;
let recoverT = 0, recoverKeep = 1, recoverSpan = 1;
let sinceLand = 1, sinceJump = 9, pushT = 0, hitCool = 0, blackT = -1;
let leanMax = LEAN;
let gScale = 1;

const pos: Vec3 = [0, 0, 0];
const from: Vec3 = [0, 0, 0];
const vset: Vec3 = [0, 0, 0];
const platV: Vec3 = [0, 0, 0];
const capStand: b3Capsule = { center1: [0, R, 0], center2: [0, STAND - R, 0], radius: R };
const capCrouch: b3Capsule = { center1: [0, R, 0], center2: [0, CROUCH - R, 0], radius: R };
/** a head-sized probe for the lean */
const capHead: b3Capsule = { center1: [0, -0.08, 0], center2: [0, 0.08, 0], radius: 0.14 };
let cap = capStand;
let shape: b3ShapeId | null = null;
const moveFilter: b3QueryFilter = { categoryBits: CAT.player, maskBits: ALL & ~(CAT.player | CAT.projectile), id: 0n };

const Cls = { Static: 0, Anchored: 1, Push: 2, Soft: 3 } as const;
type Cls = (typeof Cls)[keyof typeof Cls];

interface Plane {
  nx: number; ny: number; nz: number; off: number;
  px: number; py: number; pz: number;
  limit: number; clip: boolean; push: number;
  e: PhysEntity | undefined; body: b3BodyId | null; mass: number; cls: Cls; rough: boolean;
}
const MAX_PLANES = 48;
const planes: Plane[] = Array.from({ length: MAX_PLANES }, () => ({
  nx: 0, ny: 0, nz: 0, off: 0, px: 0, py: 0, pz: 0, limit: 0, clip: true, push: 0, e: undefined, body: null, mass: 0, cls: Cls.Static, rough: false,
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
    q.e = curE; q.body = curBody; q.mass = curMass; q.cls = curCls; q.rough = isRough(curE, curCls);
    q.limit = curCls === Cls.Soft ? 0 : Infinity;
    // a shoved object must not also cancel the walk: the player keeps leaning into it (one lying asleep in a heap
    // stops him like anything solid until a push wakes it)
    q.clip = curCls === Cls.Static || curCls === Cls.Anchored || (curCls === Cls.Push && !b3.b3Body_IsAwake(curBody));
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

interface Ground { ny: number; e: PhysEntity | undefined; body: b3BodyId | null; cls: Cls; rough: boolean; px: number; py: number; pz: number; top: number }
const gnd: Ground = { ny: -1, e: undefined, body: null, cls: Cls.Static, rough: false, px: 0, py: 0, pz: 0, top: 0 };
/** Best supporting plane just under p. */
function probeGround(p: Vec3): Ground {
  const was = flatten;
  flatten = false;
  collide(p, -0.03);
  flatten = was;
  gnd.ny = -1; gnd.e = undefined; gnd.body = null;
  for (let i = 0; i < nPlanes; i++) {
    const q = planes[i];
    if (q.ny > gnd.ny) { gnd.ny = q.ny; gnd.e = q.e; gnd.body = q.body; gnd.cls = q.cls; gnd.rough = q.rough; gnd.px = q.px; gnd.py = q.py; gnd.pz = q.pz; gnd.top = q.py; }
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
  player.stamina = 1;
  player.crouch = false;
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
  stepSp.value = stepSp.velocity = 0;
  clearState();
}

/** Everything a fresh start on the feet should not carry over: climbs, knockdowns, limps, lingering landings. */
function clearState(): void {
  mantle.on = false; player.mantle = -1;
  player.downed = player.stagger = player.limp = player.knock = 0;
  player.daze = 0;
  recoverT = 0; recoverKeep = 1;
  hitCool = 0; pushT = 0; autoLow = 0;
  blackT = -1;
  trauma = 0;
  player.lastVy = 0;
}

function place(p: Vec3): void { teleport(p, player.yaw, player.pitch); }

/** Takes the player out of the world (seated in a vehicle: no queries, blasts or movement) or puts him back. */
export function setPlayerEnabled(on: boolean): void {
  const e = player.e;
  if (!e) return;
  if (on) b3.b3Body_Enable(e.body); else b3.b3Body_Disable(e.body);
  player.locked = !on;
}

/** zoomed in, the same hand movement turns the view by as much of the picture as it did before */
function lookScale(): number {
  const z = player.zoom;
  if (z < 1e-3) return 1;
  const h = lerp(player.baseFov, ZOOM_FOV, z);
  return Math.tan((h * Math.PI) / 360) / Math.tan((player.baseFov * Math.PI) / 360);
}

export function applyLook(dx: number, dy: number): void {
  if (player.black > 0.5) return;
  const k = 0.0022 * player.sensitivity * lookScale();
  player.yaw -= dx * k;
  player.pitch = clamp(player.pitch - dy * k * (player.invertY ? -1 : 1), -1.54, 1.54);
  player.lookDelta[0] += dx;
  player.lookDelta[1] += dy;
}

export function toggleFly(): boolean {
  player.fly = !player.fly;
  player.vel[1] = 0;
  if (player.fly) { if (player.crouch) setCrouch(false, true); clearState(); }
  return player.fly;
}

export function addTrauma(a: number): void { trauma = Math.min(1, trauma + a); }
/* With camera shake off the aim still kicks a little (it says the shot went off), the lens punch not at all. */
export function kickRecoil(a: number): void { recoil.velocity += a * (0.35 + 0.65 * player.shake); }
export function kickFov(a: number): void { fovKick.velocity += a * player.shake; }
export function knockback(seconds: number): void { player.knock = Math.max(player.knock, seconds); }

function setCrouch(on: boolean, force = false): boolean {
  if (on === player.crouch) return true;
  if (!on && !force && !headroom(pos)) return false;
  player.crouch = on;
  cap = on ? capCrouch : capStand;
  if (shape) b3.b3Shape_SetCapsule(shape, cap);
  return true;
}

function headroom(p: Vec3): boolean { return cast(p, 0, STAND - CROUCH, 0, capCrouch) >= 1; }

const ahead: Vec3 = [0, 0, 0];
/** Room to stand here and a stride on (so a duck under a beam is not given up on the approach). */
function canStand(): boolean {
  if (!headroom(pos)) return false;
  const vx = player.vel[0] - platV[0], vz = player.vel[2] - platV[2], v = Math.hypot(vx, vz);
  if (v < 0.3) return true;
  const d = 0.25 + v * 0.15, ux = vx / v, uz = vz / v;
  const f = cast(pos, ux * d, 0, uz * d, capCrouch);
  ahead[0] = pos[0] + ux * d * f; ahead[1] = pos[1]; ahead[2] = pos[2] + uz * d * f;
  return headroom(ahead);
}

function knockDown(seconds: number, limp = 0): void {
  if (player.impacts === 'off') { player.stagger = Math.max(player.stagger, 0.6); return; }
  player.downed = Math.max(player.downed, seconds);
  player.limp = Math.max(player.limp, limp);
  player.stagger = 0;
  mantle.on = false; player.mantle = -1;
  downRoll.velocity += (Math.random() < 0.5 ? -1 : 1) * 2.2;
  addTrauma(0.55);
  audio.land(1, player.surface);
}

function stagger(seconds: number): void {
  player.stagger = Math.max(player.stagger, seconds);
  tilt.velocity += (Math.random() - 0.5) * 0.6;
  addTrauma(0.25);
}

/** a fatal impact (with 'real' impacts): the screen goes dark, then the player is back at the spawn */
function blackout(): void {
  if (player.impacts !== 'real') { knockDown(3.5, 10); return; }
  if (blackT >= 0) return;
  knockDown(3);
  blackT = 0;
}

const bodyP: Vec3 = [0, 0, 0];
const bodyV: Vec3 = [0, 0, 0];
const tmp: Vec3 = [0, 0, 0];
const axes: [number, number] = [0, 0];
const hv: [number, number] = [0, 0];
const gv: Vec3 = [0, 0, 0];

/* What the player stands on sets how sure the footing is: loose spoil and rubble slow a stride a little. */
const SURF_PACE: Partial<Record<SurfaceId, number>> = { soil: 0.95, rubble: 0.9, gravel: 0.97 };
let pace = 1;

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
    stepSp.value = stepSp.velocity = 0;
    mantle.on = false; player.mantle = -1;
  } else {
    // a blast (or any impulse) since the last step shows up as velocity we did not set
    let ix = bodyV[0] - vset[0], iy = bodyV[1] - vset[1], iz = bodyV[2] - vset[2];
    const il = Math.hypot(ix, iy, iz);
    if (il > 0.3) {
      if (il > MAX_THROW) { ix *= MAX_THROW / il; iy *= MAX_THROW / il; iz *= MAX_THROW / il; }
      vel[0] += ix; vel[1] += iy; vel[2] += iz;
      if (iy > 0.5) player.grounded = false;
      player.knock = Math.max(player.knock, 0.25 + il * 0.03);
      mantle.on = false; player.mantle = -1;
      if (il > 7) knockDown(1.2 + Math.min(il, 12) * 0.08, 2); else if (il > 3.5) stagger(0.5 + il * 0.05);
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

  b3.b3World_GetGravity(gv, world);
  gScale = Math.max(0.05, -gv[1] / K.G);
  const g = K.G * gScale;

  player.wasGrounded = player.grounded;
  player.jumpBuffer -= dt;
  player.knock -= dt;
  player.stagger = Math.max(0, player.stagger - dt);
  player.limp = Math.max(0, player.limp - dt);
  player.downed = Math.max(0, player.downed - dt);
  hitCool -= dt;
  sinceLand += dt; sinceJump += dt;
  if (recoverT > 0) recoverT = Math.max(0, recoverT - dt);
  if (player.grounded) player.coyote = COYOTE; else player.coyote -= dt;
  const out = blackT >= 0;
  if (out) {
    blackT += dt;
    if (blackT > 1.6) { respawn(); finish(e, dt, t0); return; }
  }
  const ko = player.downed > 0 || out;

  moveAxes(axes);
  let f = ko ? 0 : axes[0], s = ko ? 0 : axes[1];
  const careful = !ko && held('careful');
  player.careful = careful;
  // careful: A/D lean instead of stepping sideways
  const leanWant = careful && !player.fly ? s : 0;
  if (careful) s = 0;
  const mag = Math.min(1, Math.hypot(f, s));
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  player.move = wl > 0 ? mag : 0;
  leanTarget = leanWant;

  if (player.fly) {
    player.sprint = held('sprint') && f > 0;
    const up = (held('jump') ? 1 : 0) - (held('crouch') ? 1 : 0);
    const sp = player.sprint ? FLY * 2 : FLY;
    const cp = Math.cos(player.pitch), spp = Math.sin(player.pitch);
    const tx = (-sy * cp * f + cy * s) * sp, tz = (-cy * cp * f - sy * s) * sp, ty = (spp * f + up) * sp;
    const k = Math.min(1, dt * 8);
    vel[0] = lerp(vel[0], tx, k); vel[1] = lerp(vel[1], ty, k); vel[2] = lerp(vel[2], tz, k);
    flatten = false;
    slide(pos, vel[0] * dt, vel[1] * dt, vel[2] * dt, vel);
    player.grounded = false;
    player.ground = undefined;
    consume('jump'); consume('crouch');
    finish(e, dt, t0);
    return;
  }

  if (mantle.on) {
    stepMantle(dt);
    consume('jump'); consume('crouch'); consume('sprint');
    finish(e, dt, t0);
    return;
  }

  // crouch: held, or latched by a tap; a duck the mover chose; always while down
  if (player.crouchToggle && hit('crouch')) crouchLatch = !crouchLatch;
  consume('crouch');
  autoLow -= dt;
  const wantLow = (player.crouchToggle ? crouchLatch : held('crouch')) || ko;
  if (wantLow || autoLow > 0) setCrouch(true); else if (player.crouch) { if (canStand()) setCrouch(false); }

  // sprint: held, or latched by a tap until the player stops going forward
  if (player.sprintToggle) { if (hit('sprint')) sprintLatch = !sprintLatch; if (f <= 0.3) sprintLatch = false; }
  consume('sprint');
  const sprintKey = player.sprintToggle ? sprintLatch : held('sprint');
  // stamina: sprint drains it; once empty it must recover a third before sprinting again
  const wantSprint = sprintKey && f > 0.3 && !player.crouch && !careful && !exhausted && player.stamina > 0 && player.limp <= 0 && player.stagger <= 0 && !ko;
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

  let target: number = player.crouch ? K.SPEED.crouch : careful ? K.SPEED.careful : player.sprint ? K.SPEED.sprint : K.SPEED.jog;
  target *= mag * pace;
  if (player.limp > 0) target = Math.min(target, 1.7);
  if (player.stagger > 0) target *= 0.45;
  if (recoverT > 0) target *= lerp(1, recoverKeep, recoverT / recoverSpan);
  const rx = vel[0] - platV[0], rz = vel[2] - platV[2];
  if (player.grounded && player.knock <= 0 && !ko) {
    K.footStep(hv, rx, rz, wx, wz, target, dt);
    vel[0] = hv[0] + platV[0]; vel[2] = hv[1] + platV[2];
  } else if (player.grounded) {
    // thrown or down: the body skids to a stop on its own friction
    K.footStep(hv, rx, rz, 0, 0, 0, dt, SKID);
    vel[0] = hv[0] + platV[0]; vel[2] = hv[1] + platV[2];
  } else if (wl > 0 && !ko) {
    K.airStep(hv, rx, rz, wx, wz, target, dt);
    vel[0] = hv[0] + platV[0]; vel[2] = hv[1] + platV[2];
  }
  if (player.grounded && vel[1] - platV[1] < 0.5) vel[1] = platV[1];
  else vel[1] = Math.max(-K.TERMINAL, vel[1] + K.gravityAt(vel[1] - platV[1], g) * dt);

  let jumped = false;
  if (hit('jump') && !ko) player.jumpBuffer = BUFFER;
  consume('jump');
  const mx = wl > 0 ? wx : -sy, mz = wl > 0 ? wz : -cy;
  // a jump at something climbable climbs it instead
  if (player.jumpBuffer > 0 && player.stagger <= 0 && (player.coyote > 0 || sinceJump < 0.6)) {
    const air = !(player.coyote > 0);
    if (tryMantle(mx, mz, air ? MANTLE_AIR : MANTLE_MAX, air ? 0.12 : 0.36)) { player.jumpBuffer = 0; finish(e, dt, t0); return; }
  }
  if (player.jumpBuffer > 0 && player.coyote > 0 && player.stagger <= 0) {
    // from a crouch: stand up into the jump when there is room, else stay put (the press waits in the buffer)
    if (!player.crouch || (autoLow <= 0 && canStand() && setCrouch(false))) {
      crouchLatch = false;
      let v = K.jumpSpeed(K.JUMP_H, g);
      // straight back up off a landing, or out of breath: the legs have less in them
      if (sinceLand < 0.25) v *= 0.85;
      if (player.stamina < 0.15) v *= 0.85;
      if (player.limp > 0) v *= 0.6;
      vel[1] = Math.max(vel[1], platV[1]) + v;
      player.stamina = Math.max(0, player.stamina - (player.sprint ? 0.08 : 0.04));
      restT = 0;
      player.jumpBuffer = 0;
      player.coyote = 0;
      player.grounded = false;
      jumped = true;
      sinceJump = 0;
      audio.jump();
    }
  }

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
  let blocked = false;
  if (walking && dh > 1e-4) {
    const ux = dx / dh, uz = dz / dh;
    const got = (pos[0] - from[0]) * ux + (pos[2] - from[2]) * uz;
    // pressing on against something already found unclimbable from this very spot: don't re-probe every step
    const same = Math.abs(from[0] - noStep[0]) + Math.abs(from[1] - noStep[1]) + Math.abs(from[2] - noStep[2]) < 0.01 && ux * noStep[3] + uz * noStep[4] > 0.98;
    if (got < dh * 0.9 && !same) {
      // the blocked slide already clipped the walk to nothing: step with the intended stride
      const w = Math.max(dh, Math.hypot(wx, wz) * target * dt);
      if (stepUp(ux, uz, ux * w, dy, uz * w, got)) copy3(vel, v0);
      // stopped at head height (a soffit, a beam, the trimmer over a stair going down) with room lower down: duck under it
      else if (got < dh * 0.5 && lowBlock > 0.5 && (player.crouch || cast(from, ux * w, 0, uz * w, capCrouch) > 0.9)) { setCrouch(true); autoLow = 0.4; }
      else { noStep[0] = from[0]; noStep[1] = from[1]; noStep[2] = from[2]; noStep[3] = ux; noStep[4] = uz; blocked = got < dh * 0.4; }
    } else if (same) blocked = got < dh * 0.4;
  } else if (walking && wl > 0 && f > 0.3 && Math.hypot(vel[0] - platV[0], vel[2] - platV[2]) < 0.2) blocked = true;
  // pressed against something that is not giving: the legs stop, no walking on the spot
  if (walking && dh > 1e-4 && blocked) {
    const k = Math.min(1, dt * 12);
    vel[0] += ((pos[0] - from[0]) / dt - vel[0]) * k; vel[2] += ((pos[2] - from[2]) / dt - vel[2]) * k;
  }
  // walking into something knee-to-thigh high for a moment: scramble up it
  // (a stride that gets nowhere every other step is still getting nowhere: the count only fades)
  pushT = blocked && f > 0.3 && !ko ? pushT + dt : Math.max(0, pushT - dt * 0.5);
  // (holding jump against it: anything the arms can haul up onto)
  const haul = held('jump') && !player.crouch;
  if (pushT > 0.22 || (haul && pushT > 0.08)) { pushT = 0; if (tryMantle(mx, mz, haul ? MANTLE_MAX : SCRAMBLE_MAX, STEP - 0.02)) { finish(e, dt, t0); return; } }
  // in the air against a ledge, still pushing on: grab it
  if (!walking && !player.grounded && f > 0.3 && sinceJump < 0.8 && vel[1] < 1.2 && dh > 1e-4 && !ko) {
    const got = ((pos[0] - from[0]) * dx + (pos[2] - from[2]) * dz) / dh;
    if (got < dh * 0.5 && tryMantle(mx, mz, MANTLE_AIR, 0.12)) { finish(e, dt, t0); return; }
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
      const gg = probeGround(tmp);
      if (footing(gg.ny, gg.rough)) {
        pos[1] -= drop;
        if (walking && drop > 0.04) stepSp.value += drop;
        player.grounded = true;
        player.ground = gg.cls === Cls.Static ? undefined : gg.e;
        groundBody = gg.cls === Cls.Static ? null : gg.body;
        const ent = gg.e;
        if (ent && ent.kind === 'piece') {
          player.surface = (ent as Piece).pm.surface;
          pace = gg.cls === Cls.Push || gg.cls === Cls.Soft || (ent as Piece).welds.length === 0 ? 0.85 : 1;
        } else {
          const sid = surfaceAt(pos[0], pos[2]);
          player.surface = SURFACE[sid].audio;
          pace = SURF_PACE[sid] ?? 1;
        }
      }
    }
    rubbleFloor(walking ? SNAP : 0.04, walking);
  }
  flatten = false;

  if (!ko) debrisHits();
  if (player.grounded) {
    if (!player.wasGrounded) land(player.lastVy, g);
    if (relVy < 0) vel[1] = platV[1];
    const speed = Math.hypot(vel[0] - platV[0], vel[2] - platV[2]);
    // one bob cycle is two strides; a footfall at each half turn
    const len = player.sprint ? 2.6 : player.crouch ? 1.2 : player.careful ? 1.3 : 2.0;
    const before = Math.floor(bobPhase / Math.PI);
    if (speed > 0.25) bobPhase += (speed * dt * Math.PI) / (len * 0.5);
    player.stride += speed * dt;
    if (Math.floor(bobPhase / Math.PI) !== before && speed > 0.8) audio.footstep(player.surface);
  }
  player.lastVy = relVy;

  if (!ko) interact(dt, wx * target, wz * target);
  else interact(dt, 0, 0);
  unstick(dt);
  finish(e, dt, t0);
}

const SKID: K.FootParams = { accel: 0, accelHigh: 0, brake: 5, brakeK: 0.6 };

/* Touching down: the dip, the legs soaking it up, and past a couple of metres what a fall does to a person. */
function land(vy: number, g: number): void {
  sinceLand = 0;
  const v = -vy;
  if (v < 1) return;
  const L = K.landing(v, player.crouch, player.impacts, g);
  player.lastLanding = L;
  dip.velocity -= L.dip * 26;
  recoverT = recoverSpan = Math.max(L.recover, 1e-3);
  recoverKeep = L.keep;
  const strength = clamp(L.drop / 3, 0, 1);
  if (L.drop > 0.12) audio.land(Math.max(0.08, strength), player.surface);
  else audio.footstep(player.surface);
  if (L.tier === 'hard') addTrauma(0.12 + L.drop * 0.04);
  else if (L.tier === 'stumble') { stagger(L.recover); player.limp = Math.max(player.limp, L.limp); }
  else if (L.tier === 'knockdown') knockDown(L.down, L.limp);
  else if (L.tier === 'fatal') blackout();
}

/* ---------------- climbing ---------------- */

const mantle = { on: false, t: 0, rise: 0, over: 0, p0: [0, 0, 0] as Vec3, h: 0, d: 0, ux: 0, uz: 0, vault: false, exit: 0 };
const probe: Vec3 = [0, 0, 0];

/**
 * A ledge in front (direction u) whose top is between minH and maxH above the feet, with room to haul up and over:
 * starts the climb and returns true. Fast enough at a thin wall with a floor beyond, it is a vault instead.
 */
function tryMantle(ux: number, uz: number, maxH: number, minH: number): boolean {
  const ul = Math.hypot(ux, uz);
  if (ul < 1e-4) return false;
  ux /= ul; uz /= ul;
  // the face: sweep a crouched body forward just clear of the ground
  const REACH = 0.8;
  probe[0] = pos[0]; probe[1] = pos[1] + 0.1; probe[2] = pos[2];
  const fw = cast(probe, ux * REACH, 0, uz * REACH, capCrouch) * REACH;
  if (fw >= REACH - 1e-3) return false;
  // its top at the lip, just past the face
  const face = fw + R;
  const h = topAt(ux, uz, face + 0.07, maxH, minH);
  if (h === null || h < minH || h > maxH) return false;
  // room to rise (crouched)
  const rise = h + 0.03;
  if (cast(pos, 0, rise, 0, capCrouch) < 1) return false;
  probe[0] = pos[0]; probe[1] = pos[1] + rise; probe[2] = pos[2];
  // where the body will stand: on top, or (a thin wall, a rail, a lump, a skip's side) over it and down the far side
  const d = face + 0.16;
  const hs = topAt(ux, uz, d, maxH, minH - 0.6);
  const onTop = hs !== null && Math.abs(hs - h) < 0.2;
  const speed = Math.hypot(player.vel[0] - platV[0], player.vel[2] - platV[2]);
  let vault = false;
  if (!onTop || (speed > 3.4 && h < 1.15)) {
    // over: the far side must have a floor within a fall a person takes on purpose
    const far = face + 2 * R + 0.3;
    const r2 = b3.b3World_CastRayClosest(world, [pos[0] + ux * far, pos[1] + rise + 0.05, pos[2] + uz * far], [0, -(rise + 2.2), 0], moveFilter);
    if (r2.hit && r2.point[1] < pos[1] + h - 0.25 && cast(probe, ux * (far + 0.1), 0, uz * (far + 0.1), capCrouch) >= 1) {
      vault = true;
      mantle.d = far;
    } else if (!onTop) return false;
  }
  if (!vault) {
    if (cast(probe, ux * d, 0, uz * d, capCrouch) < 1) return false;
    mantle.d = d;
  }
  setCrouch(true, true);
  mantle.on = true;
  mantle.t = 0;
  mantle.vault = vault;
  mantle.h = rise;
  mantle.ux = ux; mantle.uz = uz;
  mantle.exit = vault ? Math.max(1.2, speed * 0.85) : 0.8;
  copy3(mantle.p0, pos);
  // hauling up takes longer the higher the lip; a vault is one fluid move
  mantle.rise = vault ? 0.14 + 0.18 * (h / 1.1) : 0.16 + 0.34 * (h / MANTLE_MAX);
  mantle.over = vault ? 0.2 : 0.2;
  player.mantle = 0;
  player.grounded = false;
  player.vel[0] = player.vel[1] = player.vel[2] = 0;
  climbSp.velocity -= vault ? 0.8 : 1.4;
  audio.footstep(player.surface);
  sinceJump = 9;
  return true;
}

/** height above the feet of a walkable top at distance d ahead, looked for from maxH down to minH, or null */
function topAt(ux: number, uz: number, d: number, maxH: number, minH: number): number | null {
  const y0 = pos[1] + maxH + 0.35;
  const r = b3.b3World_CastRayClosest(world, [pos[0] + ux * d, y0, pos[2] + uz * d], [0, -(maxH + 0.35 - minH + 0.05), 0], moveFilter);
  if (!r.hit) return null;
  const e = entityOfShape(r.shapeId);
  if (!footing(r.normal[1], e?.kind === 'piece' && (e as Piece).depth > 0)) return null;
  return r.point[1] - pos[1];
}

/* Small rubble (below the structure's RUBBLE_VOL) never collides with the player's body: a heap of bricks would
   otherwise snag every stride. The feet still stand on it: a foot-sized probe finds the heap's surface under the
   capsule and the body rides up onto it (or down it) a step at a time, the eye following on its spring. */
const capFoot: b3Capsule = { center1: [0, 0.2, 0], center2: [0, 0.2, 0], radius: 0.2 };
const rubbleFilter: b3QueryFilter = { categoryBits: CAT.projectile, maskBits: CAT.debris, id: 0n };
const footO: Vec3 = [0, 0, 0], footT: Vec3 = [0, 0, 0];
function rubbleFloor(dist: number, walking: boolean): void {
  footO[0] = pos[0]; footO[1] = pos[1] + STEP; footO[2] = pos[2];
  footT[0] = 0; footT[1] = -(STEP + dist); footT[2] = 0;
  const f = b3.b3World_CastMover(world, footO, capFoot, footT, rubbleFilter, castSkip);
  if (f >= 1 || f <= 1e-4) return;
  const lift = STEP - f * (STEP + dist);
  if (player.grounded && lift <= 0.01) return;
  if (lift > 0) {
    if (cast(pos, 0, lift, 0) < 1) return;
    pos[1] += lift;
    stepSp.value -= lift;
  } else {
    pos[1] += lift;
    if (walking && -lift > 0.04) stepSp.value -= lift;
  }
  player.grounded = true;
  player.ground = undefined;
  groundBody = null;
  pace = 0.85;
}

/* Rubble coming down on the player: small pieces are below the body's collision, so a separate look at what of it
   is inside the upper body and moving into it. A lump off a parapet staggers, a big one floors him. */
const capUpper: b3Capsule = { center1: [0, 0.9, 0], center2: [0, STAND - R, 0], radius: R };
let hitJ = 0, hitM = 0, hitAbove = false, hitNx = 0, hitNz = 0;
const hv3: Vec3 = [0, 0, 0];
const onDebris = (sh: b3ShapeId, buf: PlaneResultBuffer): boolean => {
  const body = b3.b3Shape_GetBody(sh);
  b3.b3Body_GetLinearVelocity(hv3, body);
  const n = b3.getNumPlaneResults(buf);
  for (let i = 0; i < n; i++) {
    b3.getPlaneResultAt(pr!, buf, i);
    const nn = pr!.plane.normal;
    const vn = hv3[0] * nn[0] + hv3[1] * nn[1] + hv3[2] * nn[2];
    if (vn < 3) continue;
    const m = b3.b3Body_GetMass(body), J = ((m * MASS) / (m + MASS)) * vn;
    if (J > hitJ) { hitJ = J; hitM = m; hitAbove = nn[1] < -0.5; hitNx = nn[0]; hitNz = nn[2]; }
  }
  return true;
};
function debrisHits(): void {
  if (hitCool > 0) return;
  hitJ = 0;
  capUpper.center2[1] = (player.crouch ? CROUCH : STAND) - R;
  b3.b3World_CollideMover(world, pos, capUpper, rubbleFilter, onDebris);
  if (hitJ < 20) return;
  const tier = K.hitTier(hitJ, hitAbove, hitM, player.impacts);
  addTrauma(Math.min(0.4, hitJ / 300));
  if (tier === 'none') return;
  hitCool = 0.4;
  player.vel[0] += (hitNx * hitJ) / MASS; player.vel[2] += (hitNz * hitJ) / MASS;
  if (tier === 'stagger') stagger(0.35 + Math.min(0.4, hitJ / 400));
  else if (tier === 'knockdown') knockDown(1.2 + Math.min(1.2, hitJ / 600));
  else blackout();
}

const ease = (x: number): number => x * x * (3 - 2 * x);
function stepMantle(dt: number): void {
  const m = mantle, vel = player.vel;
  m.t += dt;
  const T = m.rise + m.over;
  const a = clamp(m.t / m.rise, 0, 1), b = clamp((m.t - m.rise * 0.7) / (m.over + m.rise * 0.3), 0, 1);
  // up first; the body starts over the lip before the hands have finished pushing
  const ty = m.p0[1] + m.h * ease(a);
  const k = b * (2 - b);
  const tx = m.p0[0] + m.ux * m.d * k, tz = m.p0[2] + m.uz * m.d * k;
  const ddx = tx - pos[0], ddy = ty - pos[1], ddz = tz - pos[2];
  const fr = cast(pos, ddx, ddy, ddz);
  pos[0] += ddx * fr; pos[1] += ddy * fr; pos[2] += ddz * fr;
  vel[0] = (ddx * fr) / dt; vel[1] = (ddy * fr) / dt; vel[2] = (ddz * fr) / dt;
  player.mantle = clamp(m.t / T, 0, 1);
  player.grounded = false;
  if (fr < 0.5 || m.t >= T) {
    // done (or something moved into the way): let go onto the ledge with a little of the move left in the legs
    m.on = false;
    player.mantle = -1;
    vel[0] = m.ux * m.exit; vel[1] = m.vault ? 0.6 : 0; vel[2] = m.uz * m.exit;
    autoLow = 0.15;
    player.coyote = 0;
    sinceLand = 0;
    if (!m.vault) {
      const fr2 = cast(pos, 0, -0.08, 0);
      if (fr2 < 1) { pos[1] -= fr2 * 0.08; player.grounded = true; player.lastVy = 0; }
    }
    audio.footstep(player.surface);
  }
}

const v0: Vec3 = [0, 0, 0];
const sp: Vec3 = [0, 0, 0];
const noStep = [0, 0, 0, 0, 0];
function stepUp(ux: number, uz: number, dx: number, dy: number, dz: number, got: number): boolean {
  let up = cast(from, 0, STEP, 0) * STEP - SLOP;
  // head against a low ceiling over a stair or a sill: duck (standing up again resumes once clear)
  if (up < STEP * 0.9 && !player.crouch && setCrouch(true)) { autoLow = 0.4; up = cast(from, 0, STEP, 0) * STEP - SLOP; }
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
  if (rise > STEP + 0.01 || (!footing(g.ny, g.rough) && !treadAhead(ux, uz))) return false;
  // the body is up the step at once; the eye follows on a spring
  stepSp.value -= sp[1] - pos[1];
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
/* Contacts with moving or loose bodies: a moving body shoves the player (momentum shared by mass) and, hard enough,
   staggers or floors him; the player shoves loose light things with a capped impulse. Welded, service-run and heavy
   pieces never receive anything. */
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
    const vn = pv[0] * tc.nx + pv[1] * tc.ny + pv[2] * tc.nz;
    const vp = vel[0] * tc.nx + vel[1] * tc.ny + vel[2] * tc.nz;
    const vs = loose ? (m * vn + MASS * vp) / (m + MASS) : vn;
    if (vn > 0.3 && vs > vp) {
      const dv = vs - vp;
      // what the blow delivers: a loose lump shares its momentum, a member driven by the whole structure does not give
      const J = MASS * dv;
      const fromAbove = tc.ny < -0.5;
      if (hitCool <= 0 && J > 40) {
        const tier = K.hitTier(J, fromAbove, Number.isFinite(m) ? m : 1e4, player.impacts);
        if (tier !== 'none') hitCool = 0.4;
        if (tier === 'stagger') stagger(0.4 + Math.min(0.5, J / 600));
        else if (tier === 'knockdown') knockDown(1.2 + Math.min(1.5, J / 800), J > 700 ? 4 : 0);
        else if (tier === 'fatal') blackout();
        addTrauma(Math.min(0.5, J / 900));
      }
      vel[0] += dv * tc.nx; vel[1] += dv * tc.ny; vel[2] += dv * tc.nz;
      if (!loose) {
        // a body folds and goes down; it is not batted across the site
        const h = Math.hypot(vel[0] - platV[0], vel[2] - platV[2]);
        if (h > MAX_SHOVE) { vel[0] = platV[0] + ((vel[0] - platV[0]) * MAX_SHOVE) / h; vel[2] = platV[2] + ((vel[2] - platV[2]) * MAX_SHOVE) / h; }
        if (vel[1] - platV[1] > 2.5) vel[1] = platV[1] + 2.5;
      }
      if (dv > 2.5) knockback(0.15 + Math.min(dv, 6) * 0.03);
      if (tc.ny < -0.3 && player.grounded && !loose) {
        // pinned from above against the floor: nothing vertical can give, so the player is shoved out from under it
        b3.b3Body_GetWorldCenterOfMass(imp, body);
        let ex = pos[0] - imp[0], ez = pos[2] - imp[2];
        const el = Math.hypot(ex, ez);
        if (el < 0.05) { ex = Math.sin(player.yaw); ez = Math.cos(player.yaw); } else { ex /= el; ez /= el; }
        const kick = Math.min(MAX_SHOVE, Math.max(2.2, vn * 0.5)) - (vel[0] * ex + vel[2] * ez);
        if (kick > 0) {
          vel[0] += ex * kick; vel[2] += ez * kick;
          knockback(0.3);
          addTrauma(0.4);
          setCrouch(true);
          autoLow = Math.max(autoLow, 0.5);
        }
      }
      if (loose) {
        imp[0] = -dv * MASS * tc.nx; imp[1] = -dv * MASS * tc.ny; imp[2] = -dv * MASS * tc.nz;
        b3.b3Body_ApplyLinearImpulse(body, imp, pp, true);
      }
      continue;
    }
    if (!loose) continue;
    const h = Math.hypot(tc.nx, tc.nz);
    // a boot through light debris underfoot scuffs it along
    if (tc.cls === Cls.Soft && tc.ny > 0.3 && player.grounded) {
      const sx = vel[0] - platV[0], sz = vel[2] - platV[2], sv = Math.hypot(sx, sz);
      if (sv > 1 && pushable(tc.e as Piece, body, m)) {
        const want = Math.min(1.2, sv * 0.35), have = (pv[0] * sx + pv[2] * sz) / sv;
        if (have < want) {
          const j = Math.min(m * (want - have), 60 * dt);
          imp[0] = (sx / sv) * j; imp[1] = 0; imp[2] = (sz / sv) * j;
          b3.b3Body_ApplyLinearImpulse(body, imp, pp, true);
        }
      }
      continue;
    }
    // push: horizontal, toward the object, up to the shared walking speed and the player's push force
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
/* Only what a shove can actually slide, and never something whose push would wake a structure: a sleeping piece
   resting on or against anything but static ground or other loose lumps (a floor, a paving course, a member still
   held in place) is left alone. A lump in a spoil heap can be kicked aside: the heap settles again. */
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
    if (b3.b3Body_GetType(other) === b3.b3BodyType.b3_staticBody) continue;
    const oe = entityOfBody(other);
    if (oe?.kind !== 'piece' || anchored(oe as Piece) || oe.mass > HEAVY) return false;
  }
  return true;
}

/* Squeezed between a body and the floor the planes contradict each other: duck, then give way sideways. */
let deep = 0, deepX = 0, deepZ = 0, lowBlock = Infinity;
function unstick(dt: number): void {
  if (deep < 0.06) { stuckT = 0; return; }
  stuckT += dt;
  if (!player.crouch) { setCrouch(true); autoLow = 0.4; return; }
  autoLow = Math.max(autoLow, 0.2);
  if (stuckT < 0.2) return;
  let hx = deepX, hz = deepZ;
  const h = Math.hypot(hx, hz);
  if (h < 0.2) { hx = -Math.sin(player.yaw); hz = -Math.cos(player.yaw); } else { hx /= h; hz /= h; }
  const d = Math.min(deep + 0.02, 0.2);
  const fr = cast(pos, hx * d, 0, hz * d);
  pos[0] += hx * d * fr; pos[2] += hz * d * fr;
}

let leanTarget = 0;
const eyeSide: Vec3 = [0, 0, 0];
function finish(e: PhysEntity, dt: number, t0: number): void {
  if (pos[1] < -25 || Math.abs(pos[0]) > 380 || Math.abs(pos[2]) > 380) { respawn(); player.moverMs = performance.now() - t0; return; }
  // the eye: standing, crouched, or lying where he fell; changes of height take a moment, never a frame
  const eyeT = player.downed > 0 ? EYE_DOWN : player.crouch ? EYE_CROUCH : EYE;
  spring.damp(eyeH, eyeT, player.downed > 0 ? 0.1 : 0.13, dt);
  spring.damp(stepSp, 0, 0.1, dt);
  if (Math.abs(stepSp.value) < 1e-4 && Math.abs(stepSp.velocity) < 1e-3) stepSp.value = stepSp.velocity = 0;
  stepSp.value = clamp(stepSp.value, -0.45, 0.45);
  curEye = eyeH.value + stepSp.value;
  // lean: how far the head can go sideways before it meets a wall
  if (Math.abs(leanTarget) > 0.01 || Math.abs(leanSp.value) > 0.01) {
    const side = leanTarget !== 0 ? Math.sign(leanTarget) : Math.sign(leanSp.value);
    const rx = Math.cos(player.yaw) * side, rz = -Math.sin(player.yaw) * side;
    eyeSide[0] = pos[0]; eyeSide[1] = pos[1] + curEye; eyeSide[2] = pos[2];
    leanMax = Math.max(0, cast(eyeSide, rx * (LEAN + 0.12), 0, rz * (LEAN + 0.12), capHead) * (LEAN + 0.12) - 0.12);
  } else leanMax = LEAN;
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
  crouchLatch = sprintLatch = false;
  const out = blackT >= 0;
  teleport([player.spawn[0], player.spawn[1] + 0.02, player.spawn[2]], player.spawnYaw, -0.04);
  if (out) player.black = 1;
  eyeH.value = EYE; eyeH.velocity = 0;
  downRoll.value = downRoll.velocity = 0;
  player.stamina = 1;
  exhausted = false;
}

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
let leanOffX = 0, leanOffZ = 0, leanOffY = 0;

export function eyePosition(out: Vec3, alpha: number): Vec3 {
  const e = player.e!;
  out[0] = lerp(e.prevPos[0], e.curPos[0], alpha) + leanOffX;
  out[1] = lerp(e.prevPos[1], e.curPos[1], alpha) + lerp(prevEye, curEye, alpha) + leanOffY;
  out[2] = lerp(e.prevPos[2], e.curPos[2], alpha) + leanOffZ;
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
  spring.update(climbSp, 0, 0.14, 0.6, dt);
  const strafe = player.careful ? 0 : clamp(moveAxes(axes)[1], -1, 1);
  spring.damp(tilt, player.fly ? 0 : -strafe * 0.012, 0.12, dt);
  spring.damp(leanSp, clamp(leanTarget, -1, 1), 0.11, dt);
  // zoom: its key, or the middle mouse button held
  spring.damp(zoomSp, (held('zoom') || (input.buttons & 2) !== 0) && player.black < 0.5 ? 1 : 0, 0.09, dt);
  spring.update(downRoll, player.downed > 0 ? Math.sign(downRoll.value || 1) * 0.32 : 0, 0.25, 0.7, dt);
  player.lean = leanSp.value;
  player.zoom = clamp(zoomSp.value, 0, 1);

  // hurt: rattled by a stagger or a knockdown, fading as he comes round; dark on a blackout
  const dz = player.downed > 0 ? 0.85 : player.stagger > 0 ? 0.45 : player.limp > 0 ? 0.18 : 0;
  player.daze += (dz - player.daze) * Math.min(1, dt * (dz > player.daze ? 8 : 1.2));
  if (blackT >= 0) player.black = Math.min(1, player.black + dt / 0.6);
  else player.black = Math.max(0, player.black - dt / 0.9);

  // lean: the head goes sideways (as far as the wall allows) and the view rolls into it
  const side = clamp(leanSp.value, -1, 1);
  const off = side * Math.min(LEAN, leanMax);
  leanOffX = Math.cos(player.yaw) * off; leanOffZ = -Math.sin(player.yaw) * off; leanOffY = -Math.abs(side) * 0.05;

  const v = player.vel;
  const speed = player.grounded ? Math.hypot(v[0] - platV[0], v[2] - platV[2]) : 0;
  const gait = player.sprint ? 0.034 : player.crouch ? 0.014 : player.careful ? 0.01 : 0.022;
  const bobAmp = player.headBob && player.grounded ? clamp(speed / K.SPEED.jog, 0, 1.4) * gait : 0;

  eyePosition(eye, alpha);
  const sh = trauma * trauma * player.shake;
  const n = (o: number): number => simplex3d.sample(noise, t * 18, o, 0);
  // head bob: lowest as each foot strikes, a small sway over the stance foot
  const bobY = (Math.abs(Math.sin(bobPhase)) - 0.6) * bobAmp;
  const bobX = Math.sin(bobPhase) * bobAmp * 0.35;
  const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  camera.position.set(
    eye[0] + n(10) * sh * 0.12 + rx * bobX,
    eye[1] + dip.value + climbSp.value * 0.05 + bobY + n(20) * sh * 0.12,
    eye[2] + n(30) * sh * 0.12 + rz * bobX,
  );
  const wobble = player.stagger > 0 ? Math.sin(t * 7) * 0.03 * Math.min(1, player.stagger * 2) : 0;
  euler.set(
    player.pitch + recoil.value + climbSp.value * 0.12 + n(40) * sh * 0.09,
    player.yaw + n(50) * sh * 0.09,
    tilt.value - side * LEAN_ROLL + downRoll.value + wobble + n(60) * sh * 0.07 + (player.headBob ? Math.sin(bobPhase) * bobAmp * 0.2 : 0),
  );
  camera.quaternion.setFromEuler(euler);
  const kick = player.fly ? 0 : clamp((speed - K.SPEED.jog) / (K.SPEED.sprint - K.SPEED.jog), 0, 1) * 4;
  /* the setting is horizontal FOV at 16:9 (the convention players know); three.js wants vertical. Applying 80
     as vertical gave ~110° horizontal, a wide-angle lens that made the world read as miniature. Hor+: the
     vertical angle is fixed, so wider windows see more at the sides instead of zooming in */
  const hf = lerp(player.baseFov + kick + fovKick.value, ZOOM_FOV, player.zoom);
  const fov = vfov(hf);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = player.zoom > 0.01 ? fov : lerp(camera.fov, fov, Math.min(1, dt * 10));
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

/** gamepad right stick → look, turning at up to ~200°/s at full deflection (scaled by the mouse sensitivity) */
export function padLook(dt: number): void {
  if (!pad.connected || (!pad.lookX && !pad.lookY)) return;
  const rate = 3.5 / 0.0022;
  applyLook(pad.lookX * rate * dt, pad.lookY * rate * dt);
}

