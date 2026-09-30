import type {
  Box3DModule, b3WorldId, b3BodyId, b3ShapeId, b3JointId, b3QueryFilter, b3Filter,
  EventsBuffer, ContactHitEvent, ContactTouchEvent, JointEvent, BodyMoveEvent,
} from 'box3d.js';
import { mulberry32 } from 'math/random';
import type { Vec3, Quat } from '../types';

export type { b3BodyId, b3ShapeId, b3JointId };

export const CAT = {
  ground: 1n,
  structure: 2n,
  debris: 4n,
  player: 8n,
  projectile: 16n,
  prop: 32n,
} as const;
export const ALL = 0xffffffffffffffffn;

export const FIXED_DT = 1 / 60;
export const SUBSTEPS = 4;

export let b3: Box3DModule;
export let world: b3WorldId;
export let ground: b3BodyId;
/** the anchor's stand-in ground, removed when the terrain is laid */
export let groundSlab: b3ShapeId | null = null;
let hasWorld = false;

/* Anything simulated registers here so events (which only carry ids) can be routed back. */
export interface PhysEntity {
  kind: 'piece' | 'projectile' | 'player' | 'ground';
  body: b3BodyId;
  mass: number;
  prevPos: Vec3; prevRot: Quat;
  curPos: Vec3; curRot: Quat;
  movedStep: number;
  onMove?(): void;
  /** energy governor state (heavy pieces): specific energy last step, consecutive over-driven steps */
  gE?: number;
  gRun?: number;
  /** its velocity over the step before this one (what it brought into this step's contacts) */
  vel?: Vec3;
  /** step it was last driven on purpose (a tool, a motor): the governor leaves it be */
  drivenStep?: number;
  /** runaways caught in the last second, and the step of the latest */
  runs?: number;
  runStep?: number;
  /* hosted joints that may drive it (structure pieces) */
  ropes?: readonly unknown[];
  mechs?: readonly unknown[] | null;
}

/** A tool or machine is moving `e` on purpose this step. */
export function drive(e: PhysEntity): void { e.drivenStep = stepCount; }

const byBody = new Map<number, PhysEntity>();
export let stepCount = 0;
/** the last step that moved any body (a move event got through), so per-step scans of the moved can stop early */
export let lastMoveStep = -1;
/* the entities whose move event got through this step and the step before, in event order: a per-step scan for what
   moved can walk these instead of every live piece */
let movedNow: PhysEntity[] = [], movedPrev: PhysEntity[] = [];
/** [moved this step, moved the step before] (an entity that moved in both is in both) */
export function recentlyMoved(): readonly [readonly PhysEntity[], readonly PhysEntity[]] { return [movedNow, movedPrev]; }

let events: EventsBuffer;
let hitEv: ContactHitEvent;
let beginEv: ContactTouchEvent;
let jointEv: JointEvent;
let moveEv: BodyMoveEvent;

export let threads = 0;

/* Chance in the simulation draws from seeded streams that restart with each world, so the same shot on the same
   level replays the same collapse. Each system keeps its own stream, so how often one system draws (soft bodies,
   services) never reshuffles how the structure breaks. */
const streams: { state: mulberry32.Mulberry32; seed: number }[] = [];
/** A seeded stream; `at(...)` restarts it from a key (a place, a step), so an event draws the same numbers however many
 * other events were handled before it in the step: the order things are listed or visited in stays out of the result. */
export interface Stream { (): number; at(...key: number[]): void }
export function randomStream(seed: number): Stream {
  const st = { state: mulberry32.create(seed), seed };
  streams.push(st);
  const f = (() => mulberry32.sample(st.state)) as Stream;
  f.at = (...key: number[]) => {
    let h = seed >>> 0;
    for (const k of key) {
      h = Math.imul(h ^ (Math.round(k * 1000) | 0), 0x5bd1e995);
      h ^= h >>> 15;
    }
    st.state = mulberry32.create(h >>> 0);
  };
  return f;
}

export async function initPhysics(): Promise<void> {
  const isolated = globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';
  let factory: (o?: unknown) => Promise<Box3DModule>;
  if (isolated) {
    try {
      factory = (await import('box3d.js/mt')).default;
      threads = Math.min(8, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));
    } catch {
      factory = (await import('box3d.js/inline')).default;
    }
  } else {
    factory = (await import('box3d.js/inline')).default;
  }
  b3 = await factory();
  events = b3.createEventsBuffer();
  hitEv = b3.createContactHitEvent();
  beginEv = b3.createContactTouchEvent();
  jointEv = b3.createJointEvent();
  moveEv = b3.createBodyMoveEvent();
}

export function createWorld(): void {
  if (hasWorld) b3.b3DestroyWorld(world);
  byBody.clear();
  blasts.length = 0;
  stepCount = 0;
  lastMoveStep = -1;
  movedNow.length = movedPrev.length = 0;
  for (const st of streams) st.state = mulberry32.create(st.seed);
  const wd = b3.b3DefaultWorldDef();
  wd.gravity = [0, -9.81, 0];
  wd.hitEventThreshold = 2.5;
  wd.restitutionThreshold = 2;
  wd.maximumLinearSpeed = MAX_SPEED;
  /* Contacts as stiff as the 240 Hz substep allows (Box2D's ¼-rate limit): heavy slabs and rubble piles sink and
     rock less and settle sooner. Overdamped, and a gentler push-out so fragments spawned slightly overlapping
     separate instead of spitting apart. */
  wd.contactHertz = 60;
  wd.contactDampingRatio = 10;
  wd.contactSpeed = 2;
  wd.workerCount = threads;
  world = b3.b3CreateWorld(wd);
  hasWorld = true;

  /* The anchor everything fixed in the ground welds to. It has no shape: the ground surface is the terrain's
     (terrain/terrain.ts, laid by buildBlueprint), whose heightfields box3d allows only on static bodies, so a quake
     drives the anchor as a kinematic shake table and the structures through their welds. Until then it carries the
     old ground slab. */
  const gd = b3.b3DefaultBodyDef();
  gd.position = [0, -0.5, 0];
  ground = b3.b3CreateBody(world, gd);
  // a plain slab until the terrain is laid (a world built without a blueprint keeps it)
  const sd = b3.b3DefaultShapeDef();
  sd.baseMaterial.friction = 0.8;
  sd.filter = filter(CAT.ground, ALL);
  sd.enableContactEvents = false;
  sd.enableHitEvents = false;
  groundSlab = b3.b3CreateBoxShape(ground, sd, 400, 0.5, 400);
  const e: PhysEntity = {
    kind: 'ground', body: ground, mass: Infinity,
    prevPos: [0, -0.5, 0], prevRot: [0, 0, 0, 1], curPos: [0, -0.5, 0], curRot: [0, 0, 0, 1], movedStep: -1,
  };
  register(e);
}

export function filter(category: bigint, mask: bigint, groupIndex = 0): b3Filter {
  return { categoryBits: category, maskBits: mask, groupIndex };
}

export function queryFilter(mask: bigint): b3QueryFilter {
  return { categoryBits: ALL, maskBits: mask, id: 0n };
}

export function register(e: PhysEntity): void {
  byBody.set(e.body.index1, e);
}

export function unregister(e: PhysEntity): void {
  const cur = byBody.get(e.body.index1);
  if (cur === e) byBody.delete(e.body.index1);
}

export function entityOfBody(id: b3BodyId): PhysEntity | undefined {
  const e = byBody.get(id.index1);
  return e && e.body.generation === id.generation ? e : undefined;
}

export function entityOfShape(id: b3ShapeId): PhysEntity | undefined {
  if (!b3.b3Shape_IsValid(id)) return undefined;
  return entityOfBody(b3.b3Shape_GetBody(id));
}

export interface StepHandlers {
  hit(a: PhysEntity | undefined, b: PhysEntity | undefined, point: Vec3, normal: Vec3, speed: number): void;
  begin(a: PhysEntity | undefined, b: PhysEntity | undefined): void;
  jointBroken(joint: b3JointId): void;
}

export function step(h: StepHandlers): void {
  b3.b3World_Step(world, FIXED_DT, SUBSTEPS);
  stepCount++;
  b3.getEvents(events, world);
  const t = movedPrev; movedPrev = movedNow; movedNow = t; movedNow.length = 0;

  const nMove = b3.getNumBodyMoveEvents(events);
  for (let i = 0; i < nMove; i++) {
    b3.getBodyMoveEventAt(moveEv, events, i);
    const e = entityOfBody(moveEv.bodyId);
    if (!e) continue;
    const v0 = e.vel ??= [0, 0, 0];
    if (e.movedStep === stepCount - 1) for (let k = 0; k < 3; k++) v0[k] = (e.curPos[k] - e.prevPos[k]) / FIXED_DT;
    else v0[0] = v0[1] = v0[2] = 0;
    copy3(e.prevPos, e.curPos); copy4(e.prevRot, e.curRot);
    copy3(e.curPos, moveEv.position);
    copy4(e.curRot, moveEv.rotation);
    if (runaway(e) || (e.kind === 'piece' && (e.mass >= GOV_MASS ? governed(e) : overspeed(e)))) continue;
    e.movedStep = stepCount;
    lastMoveStep = stepCount;
    movedNow.push(e);
    e.onMove?.();
  }

  const nBegin = b3.getNumContactBeginEvents(events);
  for (let i = 0; i < nBegin; i++) {
    b3.getContactBeginEventAt(beginEv, events, i);
    h.begin(entityOfShape(beginEv.shapeIdA), entityOfShape(beginEv.shapeIdB));
  }

  const nHit = b3.getNumContactHitEvents(events);
  for (let i = 0; i < nHit; i++) {
    b3.getContactHitEventAt(hitEv, events, i);
    h.hit(entityOfShape(hitEv.shapeIdA), entityOfShape(hitEv.shapeIdB), hitEv.point, hitEv.normal, hitEv.approachSpeed);
  }

  const nJoint = b3.getNumJointEvents(events);
  for (let i = 0; i < nJoint; i++) {
    b3.getJointEventAt(jointEv, events, i);
    h.jointBroken(jointEv.jointId);
  }
}

/* A stiff joint cluster can go numerically unstable in a violent collapse: its spin doubles every few
   steps until the state is NaN and the solver never returns. Nothing real turns faster than ~2 rad or
   is driven into the solver's speed cap outside a blast, so a body that does is put back where it was and
   stopped (cheap: judged from the transforms the move event already carries), and the structure
   layer cuts it loose from the joints that drove it. */
const MAX_SPEED = 120;
const RUNAWAY_TURN = Math.cos(2 / 2), RUNAWAY_MOVE = MAX_SPEED * FIXED_DT * 0.97;
export let runaways = 0;
/** caught runaways, for the structure layer to cut loose from whatever joint drove them */
export const runawayQueue: PhysEntity[] = [];
const _z: Vec3 = [0, 0, 0];

function runaway(e: PhysEntity, force = false): boolean {
  const p = e.curPos, q = e.curRot, dx = p[0] - e.prevPos[0], dy = p[1] - e.prevPos[1], dz = p[2] - e.prevPos[2];
  const dot = Math.abs(q[0] * e.prevRot[0] + q[1] * e.prevRot[1] + q[2] * e.prevRot[2] + q[3] * e.prevRot[3]);
  if (!force && dot >= RUNAWAY_TURN && (dx * dx + dy * dy + dz * dz <= RUNAWAY_MOVE * RUNAWAY_MOVE || (blasts.length && inBlast(p)))) return false;
  runaways++;
  if (runawayQueue.length < 64) runawayQueue.push(e);
  /* Caught again and again, the place it keeps being put back to is itself the trouble (inside the ground or another
     body, which throws it out at the solver's speed every step): from the third time in a second it keeps the ground it
     gained and only loses its speed, so it works its way clear instead of being reset sixty times a second. */
  e.runs = stepCount - (e.runStep ?? -999) < 60 ? (e.runs ?? 0) + 1 : 1;
  e.runStep = stepCount;
  const sane = Number.isFinite(p[0] + p[1] + p[2] + q[0] + q[1] + q[2] + q[3]);
  if (e.runs < 3 || !sane) { copy3(e.curPos, e.prevPos); copy4(e.curRot, e.prevRot); }
  else { copy3(e.prevPos, e.curPos); copy4(e.prevRot, e.curRot); }
  b3.b3Body_SetTransform(e.body, e.curPos, e.curRot);
  b3.b3Body_SetLinearVelocity(e.body, _z);
  b3.b3Body_SetAngularVelocity(e.body, _z);
  // drop its contacts too: their warm-start impulses carry the blow-up into the next step
  b3.b3Body_Disable(e.body);
  b3.b3Body_Enable(e.body);
  return true;
}

/* A heavy body jammed among others (a fragment wedged between anchored blocks, lapped treads between rakers, a slab
   settling onto what passes through it) can be fed energy by the contact solver step after step until tonnes fly at
   100+ m/s. A backstop, not the physics: past 15 m/s, outside a blast and unless a tool, motor or rope drives it,
   nothing on a site pushes a body of 100 kg or more harder than about 3 g (a toppling chimney's crown, a vehicle's
   launch) for more than a step, where the pump runs at 8 g and up. One step of it is an impact, capped at what an
   inelastic knock can give; from the second step on the unexplained gain is taken back out; and a heavy body faster
   than anything falls here (60 m/s, ~180 m) with no blast about is a runaway. */
const GOV_MASS = 100, GOV_SPEED = 15, GOV_MAX = 60, GOV_SLACK = 0.5, GOV_G = 3, GOV_JUMP = 20, GOV_HIT = 30;
export let pumped = 0;
const blasts: { x: number; y: number; z: number; r2: number; until: number }[] = [];
const _gv: Vec3 = [0, 0, 0];

function inBlast(p: Vec3): boolean {
  for (let i = blasts.length - 1; i >= 0; i--) {
    const b = blasts[i];
    if (b.until < stepCount) { blasts.splice(i, 1); continue; }
    const dx = p[0] - b.x, dy = p[1] - b.y, dz = p[2] - b.z;
    if (dx * dx + dy * dy + dz * dz < b.r2) return true;
  }
  return false;
}

/* A light body (a wheel off a parked bus, a fragment wedged in a joint cluster) past GOV_MAX with no blast about and
   nothing driving it is the solver spitting it out, not a throw: nothing on a site flings a wheel at 125 m/s. */
function overspeed(e: PhysEntity): boolean {
  const dx = e.curPos[0] - e.prevPos[0], dy = e.curPos[1] - e.prevPos[1], dz = e.curPos[2] - e.prevPos[2];
  if (dx * dx + dy * dy + dz * dz <= (GOV_MAX * FIXED_DT) ** 2 || stepCount - (e.drivenStep ?? -99) < 30 || (blasts.length && inBlast(e.curPos))) return false;
  return runaway(e, true);
}

function governed(e: PhysEntity): boolean {
  b3.b3Body_GetLinearVelocity(_gv, e.body);
  const v2 = _gv[0] * _gv[0] + _gv[1] * _gv[1] + _gv[2] * _gv[2];
  const E = 0.5 * v2 + 9.81 * e.curPos[1], E0 = e.gE ?? E;
  e.gE = E;
  if (v2 < GOV_SPEED * GOV_SPEED || (blasts.length && inBlast(e.curPos)) || stepCount - (e.drivenStep ?? -99) < 30
    || e.ropes?.length || e.mechs?.length) { e.gRun = 0; return false; }
  const v = Math.sqrt(v2);
  if (v > GOV_MAX) { e.gRun = 0; e.gE = undefined; return runaway(e, true); }
  const allowed = E0 + GOV_G * 9.81 * v * FIXED_DT + GOV_SLACK;
  if (E <= allowed) { e.gRun = 0; return false; }
  const v0 = Math.sqrt(Math.max(0, 2 * (E0 - 9.81 * e.prevPos[1])));
  if ((e.gRun = (e.gRun ?? 0) + 1) < 2) {
    /* one step of it is an impact, but no inelastic knock on a site sends tonnes off much faster than what hit them:
       a jump past GOV_JUMP over its old speed (and past GOV_HIT) is the solver spitting it out */
    if (v <= Math.max(v0 + GOV_JUMP, GOV_HIT)) return false;
    const k = Math.max(v0 + GOV_JUMP, GOV_HIT) / v;
    b3.b3Body_SetLinearVelocity(e.body, [_gv[0] * k, _gv[1] * k, _gv[2] * k]);
    e.gE = 0.5 * v * v * k * k + 9.81 * e.curPos[1];
    pumped++;
    return false;
  }
  /* once it is being pumped, none of the gain is real */
  const k2 = 2 * (E0 - 9.81 * e.curPos[1]);
  const k = k2 > 0 ? Math.sqrt(k2) / v : 0;
  b3.b3Body_SetLinearVelocity(e.body, [_gv[0] * k, _gv[1] * k, _gv[2] * k]);
  e.gE = E0;
  pumped++;
  return false;
}

/* Reads the live transform straight from the solver (for freshly created bodies / one-off queries). */
export function readTransform(e: PhysEntity): void {
  b3.b3Body_GetPosition(e.curPos, e.body);
  b3.b3Body_GetRotation(e.curRot, e.body);
  copy3(e.prevPos, e.curPos);
  copy4(e.prevRot, e.curRot);
}

export function copy3(o: Vec3, a: ArrayLike<number>): Vec3 { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; }
export function copy4(o: Quat, a: ArrayLike<number>): Quat { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; o[3] = a[3]; return o; }

export interface RayHit { entity: PhysEntity | undefined; shape: b3ShapeId; point: Vec3; normal: Vec3; fraction: number }

export function raycast(origin: Vec3, translation: Vec3, mask: bigint): RayHit | null {
  const r = b3.b3World_CastRayClosest(world, origin, translation, queryFilter(mask));
  if (!r.hit) return null;
  return { entity: entityOfShape(r.shapeId), shape: r.shapeId, point: r.point, normal: r.normal, fraction: r.fraction };
}

export function overlapAABB(min: Vec3, max: Vec3, mask: bigint, visit: (shape: b3ShapeId) => void): void {
  b3.b3World_OverlapAABB(world, [min[0], min[1], min[2], max[0], max[1], max[2]], queryFilter(mask), (s: b3ShapeId) => {
    visit(s);
    return true;
  });
}

export function explodeImpulse(pos: Vec3, radius: number, impulsePerArea: number, mask: bigint = ALL): void {
  const d = b3.b3DefaultExplosionDef();
  d.position = pos;
  d.radius = radius * 0.55;
  d.falloff = radius * 0.6;
  d.impulsePerArea = impulsePerArea;
  d.maskBits = mask;
  b3.b3World_Explode(world, d);
  /* what a blast throws is legitimately fast for a while: the governor leaves it be */
  if (blasts.length < 64) blasts.push({ x: pos[0], y: pos[1], z: pos[2], r2: (radius * 3) ** 2, until: stepCount + 90 });
}

export function setGravity(scale: number): void {
  b3.b3World_SetGravity(world, [0, -9.81 * scale, 0]);
}
