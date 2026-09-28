import type { Vec3, Quat, VehicleModel } from '../types';
import type { b3JointId, b3ShapeId } from 'box3d.js';
import { b3, world, CAT, entityOfShape, stepCount, drive, type PhysEntity } from '../physics/physics';
import type { Piece } from '../destruction/structure';
import { spill } from '../destruction/services';
import { surfaceOfHit } from '../terrain/terrain';
import { SURFACE } from '../terrain/surface';
import { fx } from '../render/fx';
import { audio } from '../audio/audio';
import * as D from '../render/deform';
import { preset, engineTorque, engineDrag, type Preset } from './presets';
import { newTyre, tyreStep, thermalGrip, U_PEAK, type TyreState } from './tyre';
import { shellDamage, flushDents, notePanels, checkBuckling, clearShells } from './shell';
import { rot, invRot, qmul, axisAngle, between, dot, cross, norm, integrate } from './math';

/* Road vehicles as raycast vehicles. Each wheel casts a ray down its strut from the chassis; the suspension spring
   and damper and the tyre's road forces are applied to the chassis at the contact patch every step, and the wheel
   pieces become kinematic bodies posed from the suspension travel, steer and spin (so they still stop shells and
   take blast and shot damage). A raycast vehicle keeps the heavy chassis out of a joint chain with 20 kg wheels
   (a 70:1 mass ratio the joint solver handles badly at 60 Hz), gives the tyre model direct access to slip, load and
   surface, and costs one ray per wheel. Parked vehicles sleep with the chassis: no rays, wake on contact.

   The rest of the vehicle is real structure: the shell stays welded to the chassis (doors and glass come away as welds
   fail), crumple members ride on it through plastic crush joints (Coulomb-limited prismatic joints: they hold under
   driving loads and give way at the crush force, absorbing F·δ and spreading the crash over the crush depth), and the
   chassis twist, anti-roll bars, drivetrain, fluids and tyre state live here. */

const G = 9.81;
const SUB = 6;
/** steps between real suspension casts per wheel (staggered); in between the wheel follows the plane it found */
const RECAST = 3;
let tick = 0;
const MU_GROUND = 0.8;
const MU: Partial<Record<Piece['mat'], number>> = {
  asphalt: 0.9, concrete: 0.8, rconcrete: 0.8, stone: 0.75, marble: 0.6, brick: 0.7, cinderblock: 0.7, sandstone: 0.65,
  steel: 0.55, metal: 0.55, castiron: 0.5, aluminum: 0.5, copper: 0.5, machine: 0.55, wood: 0.6, oak: 0.6, plywood: 0.55,
  glass: 0.4, tempered: 0.4, ceramic: 0.5, terracotta: 0.6, adobe: 0.55, plaster: 0.55, drywall: 0.5, roof: 0.6, pvc: 0.5,
};
const SHARP = new Set<Piece['mat']>(['glass', 'tempered', 'metal', 'steel', 'aluminum']);
const RAY_MASK = CAT.ground | CAT.structure | CAT.debris | CAT.prop;
/** mounted road wheels: out of the suspension rays and blast queries (the vehicle handles those), still hit by shots */
const WHEEL = 1n << 12n;

export interface Controls { throttle: number; brake: number; steer: number; hand: boolean }

export interface Wheel {
  p: Piece;
  hub: Vec3;               // chassis body frame
  x: number; z: number;    // vehicle frame (forward, right)
  r: number; rim: number; mass: number;
  drive: boolean; steer: number; park: boolean; crr: number;
  q0: Quat;                // wheel rotation in the chassis frame at rest
  axle: Vec3;              // spin axis at link, world
  filter0: { categoryBits: bigint; maskBits: bigint; groupIndex: number };
  omega: number; spin: number; angle: number;
  delta: number; deltaPrev: number; contact: boolean; force: number;
  k: number; c: number; F0: number; fzNom: number;
  tyre: TyreState; flat: boolean; mu: number; surface: string;
  cp: Vec3; n: Vec3; smokeT: number;
  /** the road under the wheel from its last real cast; between casts the ray meets this plane */
  plane: boolean; sharp: boolean;
  attached: boolean;
}

interface Crumple {
  root: Piece; members: Piece[];
  joint: b3JointId | null;
  axisW0: Vec3;            // crush direction at link, world (for the chassis-frame copy)
  axisC: Vec3;             // crush direction in the chassis frame
  axisP: Map<Piece, Vec3>; // …in each member's frame
  F0: number; depth: number; d: number; drawn: number; over: number; front: boolean;
}

export interface Vehicle {
  id: number; model: VehicleModel; pre: Preset;
  chassis: Piece; body: Piece[]; wheels: Wheel[]; crumples: Crumple[];
  fL: Vec3; uL: Vec3; rL: Vec3; oL: Vec3;
  mass: number; md0: ReturnType<typeof b3.b3Body_GetMassData>;
  axles: { x: number; L: Wheel | null; R: Wheel | null }[];
  xRef: number; wheelbase: number;
  controls: Controls; driven: boolean;
  gear: number; shiftT: number; rpm: number; engineOn: boolean; steerNow: number;
  asleep: boolean; group: number;
  fuel: number; hole: number; leaked: number; spillT: number; sparkT: number; fuelPiece: Piece | null;
  /** the leak has caught: every further spill feeds a burning pool */
  lit: boolean;
  coolant: number; radiator: boolean; overheat: number; health: number; smokeT: number;
  crushE: number; alive: boolean;
  speed: number;
  /** traction control activity, 1 = idle (HUD) */
  tc: number;
  /** body joints sized for road loads yet */
  rated: boolean;
  /** chassis centre of mass, body frame */
  comL: Vec3;
  /** seconds since the last blow: crush joints are watched closely meanwhile */
  hitT: number;
}

export const vehicles: Vehicle[] = [];
const of = new WeakMap<Piece, Vehicle>();
const wheelOf = new WeakMap<Piece, Wheel>();
let nextId = 1;
let tickT = 0, buckleT = 0;
let wet = 0;
export const vehicleCost = { ms: 0, steps: 0, rays: 0 };

/** Road wetness 0..1 (rain, hoses, sprinklers): up to −30 % grip, more on worn tread. */
export function setRoadWet(k: number): void { wet = Math.min(1, Math.max(0, k)); }

export function vehicleOf(p: Piece | null | undefined): Vehicle | null {
  return p ? of.get(p) ?? null : null;
}

/* ---------------- linking ---------------- */

function aabb(p: Piece): number[] {
  return b3.b3Body_ComputeAABB([0, 0, 0, 0, 0, 0], p.body) as unknown as number[];
}

function shapesOf(p: Piece): b3ShapeId[] {
  return p.parts ? p.parts.map(q => q.shape) : [p.shape];
}

function setGroup(p: Piece, g: number): void {
  for (const s of shapesOf(p)) {
    if (!b3.b3Shape_IsValid(s)) continue;
    const f = b3.b3Shape_GetFilter(s);
    b3.b3Shape_SetFilter(s, { ...f, groupIndex: g }, false);
  }
}

function localExtents(p: Piece): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of p.poly.faces) for (let i = 0; i < f.pts.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], f.pts[i + k]); hi[k] = Math.max(hi[k], f.pts[i + k]);
  }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

/* The chassis and everything carried on it: its welded body and the machine parts riding on that (a mixer drum, a
   tipping body), but not the ground or anything standing on it. */
function island(c: Piece): Piece[] {
  const seen = new Set<Piece>([c]), q = [c];
  const add = (o: Piece) => {
    if (o.root.spec.vpart === 'crumple' || o.root.spec.wheel || seen.has(o) || o.welds.some(w => !w.b)) return;
    seen.add(o); q.push(o);
  };
  for (let i = 0; i < q.length && q.length < 200; i++) {
    for (const w of q[i].welds) if (w.b && w.alive) add(w.a === q[i] ? w.b : w.a);
    if (q[i].mechs) for (const m of q[i].mechs!) if (m.host === q[i]) add(m.part);
  }
  return q;
}

function cluster(p: Piece, taken: Set<Piece>): Piece[] {
  const q = [p];
  taken.add(p);
  for (let i = 0; i < q.length; i++) for (const w of q[i].welds) {
    if (!w.b || !w.alive) continue;
    const o = w.a === q[i] ? w.b : w.a;
    if (o.root.spec.vpart !== 'crumple' || taken.has(o)) continue;
    taken.add(o); q.push(o);
  }
  return q;
}

function nearestChassis(p: Piece, cands: { v: Vehicle; box: number[] }[]): Vehicle | null {
  let best: Vehicle | null = null, bd = Infinity;
  const c = p.curPos;
  for (const { v, box } of cands) {
    const pad = 0.6;
    if (c[0] < box[0] - pad || c[0] > box[3] + pad || c[1] < box[1] - pad || c[1] > box[4] + pad || c[2] < box[2] - pad || c[2] > box[5] + pad) continue;
    const d = (c[0] - v.chassis.curPos[0]) ** 2 + (c[2] - v.chassis.curPos[2]) ** 2;
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

/** Called by the structure layer after welding a batch of new pieces (level build, spawn palette). */
export function linkVehicles(list: Piece[]): void {
  notePanels(list);
  const cands: { v: Vehicle; box: number[] }[] = [];
  for (const c of list) {
    const spec = c.root.spec.vehicle;
    if (!spec || c.dead) continue;
    const pre = preset(spec.model);
    const v: Vehicle = {
      id: nextId++, model: spec.model, pre, chassis: c, body: island(c), wheels: [], crumples: [],
      fL: [1, 0, 0], uL: [0, 1, 0], rL: [0, 0, 1], oL: [0, 0, 0], mass: 0, md0: b3.b3Body_GetMassData(c.body),
      axles: [], xRef: 0, wheelbase: 1,
      controls: { throttle: 0, brake: 0, steer: 0, hand: false }, driven: false,
      gear: 0, shiftT: 0, rpm: 0, engineOn: false, steerNow: 0, asleep: false, group: 0,
      fuel: pre.tank, hole: 0, leaked: 0, spillT: 0, sparkT: 0, fuelPiece: null, lit: false,
      coolant: pre.tank > 100 ? 30 : 8, radiator: false, overheat: 0, health: 1, smokeT: 0,
      crushE: 0, alive: true, speed: 0, tc: 1, rated: false, comL: [0, 0, 0], hitT: 9,
    };
    v.group = -(1000 + v.id);
    const box = aabb(c);
    for (const q of v.body) {
      const b = aabb(q);
      for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], b[k]); box[k + 3] = Math.max(box[k + 3], b[k + 3]); }
    }
    cands.push({ v, box });
  }
  if (!cands.length) return;
  for (const p of list) {
    if (p.dead || !p.root.spec.wheel) continue;
    const v = nearestChassis(p, cands);
    if (v) addWheel(v, p);
  }
  const taken = new Set<Piece>();
  for (const p of list) {
    if (p.dead || p.root.spec.vpart !== 'crumple' || taken.has(p)) continue;
    const v = nearestChassis(p, cands);
    const members = cluster(p, taken);
    if (v) v.crumples.push({ root: members.reduce((a, b) => (b.mass > a.mass ? b : a)), members, joint: null, axisW0: [0, 0, 0], axisC: [0, 0, 0], axisP: new Map(), F0: 0, depth: 0, d: 0, drawn: 0, over: 0, front: true });
  }
  for (const { v } of cands) finish(v);
}

function addWheel(v: Vehicle, p: Piece): void {
  const spec = p.root.spec.wheel!, ext = localExtents(p);
  const r = Math.max(...ext) / 2;
  const f = b3.b3Shape_GetFilter(p.shape);
  const w: Wheel = {
    p, hub: b3.b3Body_GetLocalPoint([0, 0, 0], v.chassis.body, p.curPos) as Vec3, x: 0, z: 0,
    r, rim: r * v.pre.rim, mass: p.mass,
    drive: !!spec.drive, steer: spec.steer ?? 0, park: !!spec.park, crr: spec.crr ?? 0.012,
    axle: [0, 0, 1], q0: qmul([0, 0, 0, 1], [-v.chassis.curRot[0], -v.chassis.curRot[1], -v.chassis.curRot[2], v.chassis.curRot[3]], p.curRot),
    filter0: { categoryBits: f.categoryBits, maskBits: f.maskBits, groupIndex: f.groupIndex },
    omega: 0, spin: 0, angle: 0, delta: 0, deltaPrev: 0, contact: false, force: 0,
    k: 0, c: 0, F0: 0, fzNom: 0, tyre: newTyre(v.pre.bar), flat: false, mu: MU_GROUND, surface: 'ground',
    cp: [0, 0, 0], n: [0, 1, 0], smokeT: 0, attached: true, plane: false, sharp: false,
  };
  /* axle direction: the disc's thin axis */
  const k = ext.indexOf(Math.min(...ext));
  const ax: Vec3 = [0, 0, 0];
  ax[k] = 1;
  w.axle = rot([0, 0, 0], p.curRot, ax);
  v.wheels.push(w);
  wheelOf.set(p, w);
}

function finish(v: Vehicle): void {
  const c = v.chassis, cr = c.curRot;
  if (v.wheels.length < 3) { v.alive = false; return; }
  /* vehicle frame from the wheels: forward is across the axles, toward the steered wheels (away from rear steer) */
  const fW = norm(cross([0, 0, 0], v.wheels[0].axle, [0, 1, 0]));
  const cen = (ws: Wheel[]) => ws.reduce((s, w) => s + dot(w.p.curPos, fW), 0) / Math.max(1, ws.length);
  const front = v.wheels.filter(w => w.steer > 0), rearSteer = v.wheels.filter(w => w.steer < 0), plain = v.wheels.filter(w => w.steer === 0);
  const s = front.length ? cen(front) - cen(plain) : rearSteer.length ? cen(plain) - cen(rearSteer) : 1;
  if (s < 0) { fW[0] = -fW[0]; fW[1] = -fW[1]; fW[2] = -fW[2]; }
  v.fL = invRot([0, 0, 0], cr, fW);
  v.uL = invRot([0, 0, 0], cr, [0, 1, 0]);
  v.rL = norm(cross([0, 0, 0], v.fL, v.uL));
  const o: Vec3 = [0, 0, 0];
  for (const w of v.wheels) for (let i = 0; i < 3; i++) o[i] += w.hub[i] / v.wheels.length;
  const rAvg = v.wheels.reduce((a, w) => a + w.r, 0) / v.wheels.length;
  v.oL = [o[0] - v.uL[0] * rAvg, o[1] - v.uL[1] * rAvg, o[2] - v.uL[2] * rAvg];
  for (const w of v.wheels) {
    const d: Vec3 = [w.hub[0] - v.oL[0], w.hub[1] - v.oL[1], w.hub[2] - v.oL[2]];
    w.x = dot(d, v.fL); w.z = dot(d, v.rL);
  }
  /* axles: wheels grouped by x */
  for (const w of [...v.wheels].sort((a, b) => b.x - a.x)) {
    let a = v.axles.find(q => Math.abs(q.x - w.x) < 0.3);
    if (!a) { a = { x: w.x, L: null, R: null }; v.axles.push(a); }
    if (w.z > 0) a.R = w; else a.L = w;
  }
  const plainX = plain.length ? plain.reduce((s2, w) => s2 + w.x, 0) / plain.length : 0;
  v.xRef = front.length || rearSteer.length ? plainX : 0;
  v.wheelbase = Math.max(0.5, Math.max(...v.wheels.map(w => Math.abs(w.x - v.xRef))));

  /* wheels become kinematic, their mass rides on the chassis (unsprung mass folded into the body) */
  const pieces = new Set<Piece>([...v.body, ...v.wheels.map(w => w.p), ...v.crumples.flatMap(q => q.members)]);
  for (const p of pieces) { of.set(p, v); setGroup(p, v.group); }
  for (const w of v.wheels) {
    b3.b3Body_SetType(w.p.body, b3.b3BodyType.b3_kinematicBody);
    for (const s of shapesOf(w.p)) b3.b3Shape_SetFilter(s, { categoryBits: WHEEL, maskBits: CAT.projectile | CAT.player, groupIndex: v.group }, false);
    w.p.hinged = true;
  }
  applyWheelMass(v);

  let m = 0;
  const com: Vec3 = [0, 0, 0], pc: Vec3 = [0, 0, 0];
  for (const p of [...v.body, ...v.crumples.flatMap(q => q.members)]) {
    const mp = b3.b3Body_GetMass(p.body);
    b3.b3Body_GetWorldCenterOfMass(pc, p.body);
    m += mp; com[0] += pc[0] * mp; com[1] += pc[1] * mp; com[2] += pc[2] * mp;
  }
  v.mass = m;
  const comL = b3.b3Body_GetLocalPoint([0, 0, 0], c.body, [com[0] / m, com[1] / m, com[2] / m]) as Vec3;
  const cd: Vec3 = [comL[0] - v.oL[0], comL[1] - v.oL[1], comL[2] - v.oL[2]];
  const xc = dot(cd, v.fL), zc = dot(cd, v.rL);
  /* static corner loads: least-norm split meeting the weight and both moments; springs preloaded to hold the
     authored ride height exactly */
  const W = m * G, n = v.wheels.length;
  let sx = 0, sz = 0, sxx = 0, sxz = 0, szz = 0;
  for (const w of v.wheels) { sx += w.x; sz += w.z; sxx += w.x * w.x; sxz += w.x * w.z; szz += w.z * w.z; }
  const lam = solve3([[n, sx, sz], [sx, sxx, sxz], [sz, sxz, szz]], [W, W * xc, W * zc]);
  for (const w of v.wheels) {
    const F = Math.max(0.05 * W / n, lam[0] + lam[1] * w.x + lam[2] * w.z);
    const hz = w.x >= 0 ? v.pre.hz[0] : v.pre.hz[1];
    w.F0 = F; w.fzNom = F;
    w.k = (F / G) * (2 * Math.PI * hz) ** 2;
    w.c = 2 * v.pre.zeta * Math.sqrt(w.k * F / G);
  }
  for (const q of v.crumples) linkCrumple(v, q);
  v.fuelPiece = v.body.find(p => p.root.spec.vpart === 'fuel') ?? null;
  v.engineOn = false;
  vehicles.push(v);
}

function applyWheelMass(v: Vehicle): void {
  const md = v.md0, M = md.mass;
  let m = M;
  const c: Vec3 = [md.center[0] * M, md.center[1] * M, md.center[2] * M];
  const on = v.wheels.filter(w => w.attached);
  for (const w of on) { m += w.mass; for (let i = 0; i < 3; i++) c[i] += w.hub[i] * w.mass; }
  c[0] /= m; c[1] /= m; c[2] /= m;
  const I = [[md.inertia.cx[0], md.inertia.cy[0], md.inertia.cz[0]], [md.inertia.cx[1], md.inertia.cy[1], md.inertia.cz[1]], [md.inertia.cx[2], md.inertia.cy[2], md.inertia.cz[2]]];
  const add = (mass: number, p: ArrayLike<number>) => {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] += mass * ((i === j ? dd : 0) - d[i] * d[j]);
  };
  add(M, md.center);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] -= M * 0;
  /* the original inertia is about the old centre: shift it with the parallel-axis term added above */
  for (const w of on) add(w.mass, w.hub);
  b3.b3Body_SetMassData(v.chassis.body, { mass: m, center: c, inertia: { cx: [I[0][0], I[1][0], I[2][0]], cy: [I[0][1], I[1][1], I[2][1]], cz: [I[0][2], I[1][2], I[2][2]] } });
  v.chassis.mass = m;
  v.comL = [c[0], c[1], c[2]];
}

function solve3(A: number[][], b: number[]): number[] {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-9) { M[i][i] = 1e-9; }
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let k = i; k < 4; k++) M[r][k] -= f * M[i][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/* Crush joint: a prismatic joint from the chassis to the crumple cluster along the direction into the vehicle, its
   motor holding zero speed up to the crush force (perfectly plastic, work-hardening with depth), stopped at the
   crush depth. */
function linkCrumple(v: Vehicle, q: Crumple): void {
  const c = v.chassis, cw = rot([0, 0, 0], c.curRot, v.fL);
  const rel = dot([q.root.curPos[0] - c.curPos[0], q.root.curPos[1] - c.curPos[1], q.root.curPos[2] - c.curPos[2]], cw);
  q.front = rel > 0;
  const a: Vec3 = q.front ? [-cw[0], -cw[1], -cw[2]] : cw;
  q.axisW0 = a;
  q.axisC = invRot([0, 0, 0], c.curRot, a);
  for (const m of q.members) q.axisP.set(m, invRot([0, 0, 0], m.curRot, a));
  const share = v.crumples.filter(o => (dot([o.root.curPos[0] - c.curPos[0], o.root.curPos[1] - c.curPos[1], o.root.curPos[2] - c.curPos[2]], cw) > 0) === q.front).length;
  q.F0 = v.pre.crush.F / Math.max(1, share) * (q.front ? 1 : 0.8);
  q.depth = v.pre.crush.depth * (q.front ? 1 : 0.7);
  const qa = between([1, 0, 0], a);
  const jd = b3.b3DefaultPrismaticJointDef();
  jd.base.bodyIdA = c.body;
  jd.base.bodyIdB = q.root.body;
  jd.base.localFrameA = { position: b3.b3Body_GetLocalPoint([0, 0, 0], c.body, q.root.curPos) as Vec3, quaternion: qmul([0, 0, 0, 1], [-c.curRot[0], -c.curRot[1], -c.curRot[2], c.curRot[3]], qa) };
  jd.base.localFrameB = { position: [0, 0, 0], quaternion: qmul([0, 0, 0, 1], [-q.root.curRot[0], -q.root.curRot[1], -q.root.curRot[2], q.root.curRot[3]], qa) };
  jd.base.forceThreshold = 3e38;
  jd.base.torqueThreshold = 3e38;
  jd.base.collideConnected = false;
  jd.enableLimit = true;
  jd.lowerTranslation = 0;
  jd.upperTranslation = q.depth;
  jd.enableMotor = true;
  jd.motorSpeed = 0;
  jd.maxMotorForce = q.F0;
  q.joint = b3.b3CreatePrismaticJoint(world, jd);
}

function dropCrumple(q: Crumple): void {
  if (q.joint && b3.b3Joint_IsValid(q.joint)) b3.b3DestroyJoint(q.joint, true);
  q.joint = null;
  for (const m of q.members) if (!m.dead) { setGroup(m, 0); of.delete(m); }
}

/** A wheel torn off (or its vehicle gone): back to a loose dynamic body that rolls on its own. */
function releaseWheel(v: Vehicle, w: Wheel): void {
  if (!w.attached) return;
  w.attached = false;
  const p = w.p;
  of.delete(p); wheelOf.delete(p);
  if (p.dead) return;
  b3.b3Body_SetType(p.body, b3.b3BodyType.b3_dynamicBody);
  for (const s of shapesOf(p)) b3.b3Shape_SetFilter(s, { ...w.filter0 }, true);
  p.hinged = false;
  for (let i = 0; i < 3; i++) p.spawnPos[i] = p.curPos[i];
  for (let i = 0; i < 4; i++) p.spawnRot[i] = p.curRot[i];
  b3.b3Body_SetAwake(p.body, true);
  if (!v.chassis.dead) applyWheelMass(v);
}

/* Calibration sizes welds for the static load. A vehicle body is built for road loads — about 3 g of bumps and 1 g
   of braking and cornering on every joint — so once calibrated its joints get that margin (crashes still tear them). */
const ROAD_LOAD = 4;
function rate(v: Vehicle): void {
  const ps = [...v.body, ...v.crumples.flatMap(q => q.members)];
  if (ps.some(p => p.welds.some(w => w.calib))) return;
  v.rated = true;
  const done = new Set<unknown>();
  for (const p of ps) for (const w of p.welds) {
    if (done.has(w) || !w.alive) continue;
    done.add(w);
    for (const k of ['comp', 'ten', 'shear', 'torque'] as const) { w.base[k] *= ROAD_LOAD; w.cap[k] *= ROAD_LOAD; }
    b3.b3Joint_SetForceThreshold(w.joint, w.cap.comp);
    b3.b3Joint_SetTorqueThreshold(w.joint, w.cap.torque);
  }
}

function dissolve(v: Vehicle): void {
  v.alive = false;
  for (const w of v.wheels) releaseWheel(v, w);
  for (const q of v.crumples) dropCrumple(q);
  for (const p of v.body) if (!p.dead) { setGroup(p, 0); of.delete(p); }
  if (drivenVehicle === v) drivenVehicle = null;
}

/* ---------------- stepping ---------------- */

const _pos: Vec3 = [0, 0, 0], _rot: Quat = [0, 0, 0, 1], _com: Vec3 = [0, 0, 0], _vel: Vec3 = [0, 0, 0], _w: Vec3 = [0, 0, 0];
const _f: Vec3 = [0, 0, 0], _u: Vec3 = [0, 0, 0], _r: Vec3 = [0, 0, 0], _a: Vec3 = [0, 0, 0];
const _q: Quat = [0, 0, 0, 1], _q2: Quat = [0, 0, 0, 1], _q3: Quat = [0, 0, 0, 1];
const _t: Vec3 = [0, 0, 0];
const _inp = { vx: 0, vy: 0, fz: 0, mu: 0, kx: 0, ky: 0, lx: 1, ly: 1, cx: 0, cy: 0, h: 0 };
const _o: Vec3 = [0, 0, 0], _d: Vec3 = [0, 0, 0], _F: Vec3 = [0, 0, 0], _T: Vec3 = [0, 0, 0], _s: Vec3 = [0, 0, 0];
let drivenVehicle: Vehicle | null = null;
export function setDriven(v: Vehicle | null): void {
  if (drivenVehicle && drivenVehicle !== v) { drivenVehicle.driven = false; drivenVehicle.controls = { throttle: 0, brake: 0, steer: 0, hand: false }; }
  drivenVehicle = v;
  if (v) { v.driven = true; v.engineOn = v.health > 0; if (v.gear === 0) v.gear = 1; b3.b3Body_SetAwake(v.chassis.body, true); }
}

interface Hit { entity: PhysEntity | undefined; shape?: b3ShapeId; point: Vec3; normal: Vec3; fraction: number }
const _hit: Hit = { entity: undefined, point: [0, 0, 0], normal: [0, 0, 0], fraction: 1 };

const RAY_FILTER = { categoryBits: 0xffffffffffffffffn, maskBits: RAY_MASK, id: 0n };
const _ro: Vec3 = [0, 0, 0], _rd: Vec3 = [0, 0, 0];
function castDown(v: Vehicle, o: Vec3, d: Vec3): Hit | null {
  let ox = o[0], oy = o[1], oz = o[2], left = 1;
  for (let i = 0; i < 4; i++) {
    vehicleCost.rays++;
    _ro[0] = ox; _ro[1] = oy; _ro[2] = oz; _rd[0] = d[0] * left; _rd[1] = d[1] * left; _rd[2] = d[2] * left;
    const r = b3.b3World_CastRayClosest(world, _ro, _rd, RAY_FILTER);
    if (!r.hit) return null;
    const e = entityOfShape(r.shapeId);
    if (e && e.kind === 'piece' && of.get(e as Piece) === v) {
      const t = left * r.fraction + 0.01;
      ox = o[0] + d[0] * t; oy = o[1] + d[1] * t; oz = o[2] + d[2] * t;
      left = 1 - t;
      if (left <= 0) return null;
      continue;
    }
    _hit.entity = e;
    _hit.shape = r.shapeId;
    _hit.point[0] = r.point[0]; _hit.point[1] = r.point[1]; _hit.point[2] = r.point[2];
    _hit.normal[0] = r.normal[0]; _hit.normal[1] = r.normal[1]; _hit.normal[2] = r.normal[2];
    _hit.fraction = 1 - left + left * r.fraction;
    return _hit;
  }
  return null;
}

function surfaceOf(e: PhysEntity | undefined, shape?: b3ShapeId, at?: Vec3): { mu: number; sharp: boolean; name: string } {
  // the ground's own surfacing: asphalt grips, setts less, grass and loose gravel least
  if (e?.kind === 'ground' && shape && at) { const s = surfaceOfHit(shape, at); return { mu: SURFACE[s].mu, sharp: false, name: s }; }
  if (!e || e.kind !== 'piece') return { mu: MU_GROUND, sharp: false, name: 'ground' };
  const p = e as Piece;
  const rubble = p.depth > 0 || p.debris;
  const base = MU[p.mat] ?? 0.6;
  return { mu: rubble ? Math.min(base, 0.6) : base, sharp: rubble && SHARP.has(p.mat), name: p.mat };
}

function toWorld(out: Vec3, v: Vehicle, x: number, y: number, z: number): Vec3 {
  const l: Vec3 = [v.oL[0] + v.fL[0] * x + v.uL[0] * y + v.rL[0] * z, v.oL[1] + v.fL[1] * x + v.uL[1] * y + v.rL[1] * z, v.oL[2] + v.fL[2] * x + v.uL[2] * y + v.rL[2] * z];
  rot(out, v.chassis.curRot, l);
  out[0] += v.chassis.curPos[0]; out[1] += v.chassis.curPos[1]; out[2] += v.chassis.curPos[2];
  return out;
}

export function vehiclePoint(v: Vehicle, x: number, y: number, z: number): Vec3 {
  return toWorld([0, 0, 0], v, x, y, z);
}

function gearRatio(v: Vehicle): number {
  const p = v.pre;
  return v.gear > 0 ? p.gears[v.gear - 1] * p.final : v.gear < 0 ? -p.reverse * p.final : 0;
}

function simulate(v: Vehicle, dt: number): void {
  const c = v.chassis, pre = v.pre;
  for (let i = 0; i < 3; i++) _pos[i] = c.curPos[i];
  for (let i = 0; i < 4; i++) _rot[i] = c.curRot[i];
  rot(_com, _rot, v.comL);
  _com[0] += _pos[0]; _com[1] += _pos[1]; _com[2] += _pos[2];
  b3.b3Body_GetLinearVelocity(_vel, c.body);
  /* spin from the last step's turn (one call fewer per vehicle; the turn is tiny at 60 Hz) */
  {
    const q = c.curRot, p = c.prevRot, k = 2 / dt, sg = q[3] * p[3] + q[0] * p[0] + q[1] * p[1] + q[2] * p[2] < 0 ? -1 : 1;
    _w[0] = sg * k * (p[3] * q[0] - p[0] * q[3] - p[1] * q[2] + p[2] * q[1]);
    _w[1] = sg * k * (p[3] * q[1] - p[1] * q[3] - p[2] * q[0] + p[0] * q[2]);
    _w[2] = sg * k * (p[3] * q[2] - p[2] * q[3] - p[0] * q[1] + p[1] * q[0]);
  }
  rot(_f, _rot, v.fL); rot(_u, _rot, v.uL); rot(_r, _rot, v.rL);
  v.speed = dot(_vel, _f);
  const ctl = v.controls;
  const vAbs = Math.hypot(_vel[0], _vel[1], _vel[2]);

  /* steering: rate-limited, and less lock at speed */
  const lock = pre.steer / (1 + (v.speed / 22) ** 2);
  const target = ctl.steer * lock;
  const rate = 2.2 * pre.steer * dt;
  v.steerNow += Math.max(-rate, Math.min(rate, target - v.steerNow));
  const tanD = Math.tan(v.steerNow);
  const Rturn = Math.abs(tanD) > 1e-5 ? v.wheelbase / tanD : Infinity;
  /* suspension */
  const on = v.wheels;
  let wi = 0;
  for (const w of on) {
    if (!w.attached) continue;
    if (w.p.dead) { w.attached = false; continue; }
    const reff = w.flat ? w.rim + 0.015 : w.r;
    const h0 = pre.bump + 0.05;
    rot(_a, _rot, w.hub);
    const ox = _pos[0] + _a[0] + _u[0] * h0, oy = _pos[1] + _a[1] + _u[1] * h0, oz = _pos[2] + _a[2] + _u[2] * h0;
    const len = h0 + pre.droop + reff;
    _o[0] = ox; _o[1] = oy; _o[2] = oz; _d[0] = -_u[0] * len; _d[1] = -_u[1] * len; _d[2] = -_u[2] * len;
    w.deltaPrev = w.delta;
    let frac = -1;
    if (w.plane && (tick + wi) % RECAST !== 0) {
      /* between casts: the ray against the road plane found last time */
      const dn = dot(_d, w.n);
      if (dn < -1e-6) { const t = ((w.cp[0] - ox) * w.n[0] + (w.cp[1] - oy) * w.n[1] + (w.cp[2] - oz) * w.n[2]) / dn; if (t >= 0 && t <= 1) frac = t; }
      if (frac >= 0) { w.cp[0] = ox + _d[0] * frac; w.cp[1] = oy + _d[1] * frac; w.cp[2] = oz + _d[2] * frac; }
    } else {
      const hit = castDown(v, _o, _d);
      w.plane = !!hit;
      if (hit) {
        frac = hit.fraction;
        w.cp[0] = hit.point[0]; w.cp[1] = hit.point[1]; w.cp[2] = hit.point[2];
        w.n[0] = hit.normal[0]; w.n[1] = hit.normal[1]; w.n[2] = hit.normal[2];
        const s = surfaceOf(hit.entity, hit.shape, hit.point);
        w.mu = s.mu; w.surface = s.name; w.sharp = s.sharp;
      }
    }
    wi++;
    if (frac >= 0) {
      const d = frac * len;
      w.delta = h0 - (d - reff);
      w.contact = true;
      if (w.sharp && !w.flat && Math.random() < 0.004 * Math.abs(w.omega * w.r) * dt) puncture(v, w);
    } else {
      w.delta = -pre.droop;
      w.contact = false;
    }
    const rate2 = (w.delta - w.deltaPrev) / dt;
    let F = w.F0 + w.k * w.delta + w.c * Math.max(-3, Math.min(3, rate2));
    if (w.delta > pre.bump) F += 12 * w.k * (w.delta - pre.bump) + 4 * w.c * Math.max(0, rate2);
    w.force = w.contact ? Math.max(0, F) : 0;
  }
  /* anti-roll bars and chassis twist */
  for (const a of v.axles) {
    if (!a.L || !a.R || !a.L.contact || !a.R.contact || !a.L.attached || !a.R.attached) continue;
    const f = pre.arb[a.x > 0 || v.axles.length === 1 ? 0 : 1] * 0.5 * (a.L.k + a.R.k) * (a.L.delta - a.R.delta);
    a.L.force = Math.max(0, a.L.force + f);
    a.R.force = Math.max(0, a.R.force - f);
  }
  if (v.axles.length >= 2) {
    const A = v.axles[0], B = v.axles[v.axles.length - 1];
    if (A.L && A.R && B.L && B.R && A.L.contact && A.R.contact && B.L.contact && B.R.contact) {
      const track = Math.abs(A.R.z - A.L.z), k = (A.L.k + A.R.k + B.L.k + B.R.k) / 4;
      const Kw = (k * track * track) / 4, chi = pre.torsion / (pre.torsion + Kw);
      const relief = ((1 - chi) * k * ((A.L.delta - A.R.delta) - (B.L.delta - B.R.delta))) / 4;
      A.L.force = Math.max(0, A.L.force - relief); A.R.force = Math.max(0, A.R.force + relief);
      B.L.force = Math.max(0, B.L.force + relief); B.R.force = Math.max(0, B.R.force - relief);
    }
  }

  /* drivetrain */
  const driven = on.filter(w => w.attached && w.drive);
  const nd = driven.length;
  const wd = nd ? driven.reduce((s, w) => s + w.omega, 0) / nd : 0;
  if (v.shiftT > 0) v.shiftT -= dt;
  let Tax = 0, coupled = false;
  const Gr = gearRatio(v);
  const nWheel = Math.abs(wd * Gr) * 30 / Math.PI;
  const rAvg = nd ? driven.reduce((s, w) => s + w.r, 0) / nd : 0.3;
  const nRoad = Math.abs((v.speed / rAvg) * Gr) * 30 / Math.PI;
  v.tc = Math.min(1, v.tc + dt * 2);
  if (v.engineOn && v.health > 0 && nd) {
    let n = pre.idle;
    const thr = ctl.throttle;
    if (Gr !== 0 && v.shiftT <= 0) {
      if (thr > 0.01) {
        const launch = pre.idle + (pre.rpmT - pre.idle) * 0.9 * thr;
        n = Math.max(nWheel, launch);
        const T = nWheel > pre.redline ? 0 : engineTorque(pre, n) * thr * (0.3 + 0.7 * v.health);
        Tax = T * Gr * pre.eff;
        coupled = nWheel >= launch;
      } else if (nWheel > pre.idle * 1.1) {
        n = nWheel;
        Tax = -engineDrag(pre, n) * Math.abs(Gr) * pre.eff * Math.sign(wd);
        coupled = true;
      }
    }
    v.rpm = Math.min(pre.redline * 1.02, n);
    if (v.driven && v.gear > 0 && v.shiftT <= 0) {
      const up = (0.55 + 0.38 * thr) * pre.redline, down = (0.25 + 0.15 * thr) * pre.redline;
      if ((nRoad > up || (nWheel > 0.98 * pre.redline && nRoad > 0.8 * up)) && v.gear < pre.gears.length) { v.gear++; v.shiftT = pre.shift; }
      else if (nRoad < down && v.gear > 1 && nRoad * pre.gears[v.gear - 2] / pre.gears[v.gear - 1] < 0.85 * pre.redline) { v.gear--; v.shiftT = pre.shift; }
    }
  } else v.rpm = v.engineOn ? pre.idle : 0;
  const Iref = coupled ? (pre.Ie * Gr * Gr) / Math.max(1, nd) : 0;

  /* tyres */
  const hand = ctl.hand, brake = ctl.brake;
  const parked = !v.driven;
  _F[0] = _F[1] = _F[2] = 0; _T[0] = _T[1] = _T[2] = 0;
  for (const w of on) {
    if (!w.attached) continue;
    const reff = w.flat ? w.rim + 0.015 : w.r;
    /* Ackermann: every steered wheel points at the turn centre on the line of the unsteered axles */
    const target2 = w.steer !== 0 && Rturn !== Infinity ? Math.atan((w.x - v.xRef) / (Rturn - w.z)) : 0;
    w.angle = target2;
    const n = w.n;
    const ca = Math.cos(w.angle), sa = Math.sin(w.angle);
    const hx = _f[0] * ca + _r[0] * sa, hy = _f[1] * ca + _r[1] * sa, hz = _f[2] * ca + _r[2] * sa;
    const hn = hx * n[0] + hy * n[1] + hz * n[2];
    _t[0] = hx - n[0] * hn; _t[1] = hy - n[1] * hn; _t[2] = hz - n[2] * hn;
    const t = norm(_t);
    const s = cross(_s, t, n);
    const I = 0.6 * w.mass * w.r * w.r + (w.drive ? Iref : 0);
    let Tb = 0;
    if (parked) Tb = w.park ? 1.5 * w.fzNom * 1.1 * reff : 0;
    else {
      const front = w.x > 0 || v.axles.length === 1;
      Tb = brake * (front ? pre.brake[0] : pre.brake[1]);
      if (hand && !front) Tb += pre.hand;
    }
    const Td = w.drive && nd ? Tax / nd : 0;
    if (!w.contact) {
      w.omega += (dt * Td) / I;
      const R = Tb + 0.3;
      w.omega = Math.abs(w.omega) <= (dt * R) / I ? 0 : w.omega - Math.sign(w.omega) * (dt * R) / I;
      w.tyre.dx *= 0.5; w.tyre.dy *= 0.5; w.tyre.fx = w.tyre.fy = 0;
      continue;
    }
    const rx = w.cp[0] - _com[0], ry = w.cp[1] - _com[1], rz = w.cp[2] - _com[2];
    const vcx = _vel[0] + _w[1] * rz - _w[2] * ry, vcy = _vel[1] + _w[2] * rx - _w[0] * rz, vcz = _vel[2] + _w[0] * ry - _w[1] * rx;
    const vx = vcx * t[0] + vcy * t[1] + vcz * t[2], vy = vcx * s[0] + vcy * s[1] + vcz * s[2];
    const fz = w.force * Math.max(0, dot(_u, n));
    const ty = w.tyre;
    const pr = Math.max(0.05, ty.bar / pre.bar);
    const load = fz / Math.max(1, w.fzNom);
    const mu = w.mu * pre.grip * Math.max(0.6, Math.min(1.15, 1 - 0.12 * (load - 1))) * thermalGrip(ty.temp) * (1 - 0.3 * wet * (1 + ty.wear)) * (w.flat ? 0.55 : 1)
      * (ty.wear > 0.85 ? 1 - (ty.wear - 0.85) : 1);
    const scale = Math.pow(Math.max(load, 0.05), 0.8) * w.fzNom;
    /* tyre pressure: a soft tyre has a longer, more compliant patch and rolls harder */
    const p1 = pr === 1;
    const kx = pre.cx * scale * (w.flat ? 0.3 : p1 ? 1 : pr ** 0.2), ky = pre.cy * scale * (w.flat ? 0.25 : p1 ? 1 : pr ** 0.4);
    const rl = w.flat ? 1.5 : p1 ? 1 : pr ** -0.3, lx = pre.relax[0] * rl, ly = pre.relax[1] * rl;
    const mc = w.fzNom / G;
    const inp = _inp;
    inp.vx = vx; inp.vy = vy; inp.fz = fz; inp.mu = mu; inp.kx = kx; inp.ky = ky; inp.lx = lx; inp.ly = ly;
    inp.cx = Math.sqrt((kx / lx) * mc); inp.cy = Math.sqrt((ky / ly) * mc); inp.h = dt / SUB;
    const Rr = (w.flat ? 0.15 : w.crr * (p1 ? 1 : pr ** -0.4)) * fz * reff;
    spinner.omega = w.omega; spinner.I = I; spinner.r = reff; spinner.T = Td; spinner.R = Tb + Rr;
    let sfx = 0, sfy = 0, sdx = 0, sdy = 0;
    /* ABS: the modulator holds a braked wheel at the slip of peak grip instead of letting it lock */
    const abs = !parked && brake > 0 && Math.abs(vx) > 1.5 && !(hand && w.x <= 0);
    const kPeak = Math.min(0.2, (0.95 * U_PEAK * mu * fz) / Math.max(1, kx));
    const floor = abs ? ((1 - kPeak) * vx) / reff : 0;
    /* traction control: a driven wheel may not spin up past the slip of peak grip */
    const tcs = v.driven && w.drive && !abs && (Td > 0 ? v.gear > 0 : Td < 0 && v.gear < 0);
    const ceil = !tcs ? 0 : Td > 0 ? (Math.max(vx, 0) * (1 + kPeak) + 0.4) / reff : (Math.min(vx, 0) * (1 + kPeak) - 0.4) / reff;
    for (let k = 0; k < SUB; k++) {
      const o = tyreStep(ty, inp, spinner);
      if (abs && (vx > 0 ? spinner.omega < floor : spinner.omega > floor)) spinner.omega = floor;
      if (tcs && (Td > 0 ? spinner.omega > ceil : spinner.omega < ceil)) { spinner.omega = ceil; v.tc = 0.5; }
      sfx += o.fx; sfy += o.fy; sdx += o.dx; sdy += o.dy;
    }
    w.omega = spinner.omega;
    const fx = sfx / SUB, fy = sfy / SUB, dmx = sdx / SUB, dmy = sdy / SUB;
    ty.fx = fx; ty.fy = fy;
    const kap = (w.omega * reff - vx) / Math.max(Math.abs(vx), 1);
    ty.slip = kap;
    /* tread heat and wear from the power dissipated in slip */
    const P = Math.abs(fx * (w.omega * reff - vx)) + Math.abs(fy * vy);
    ty.slipPower = P;
    ty.temp += dt * ((0.6 * P) / (w.mass * 400) - (0.004 + 0.0012 * Math.abs(vx)) * (ty.temp - 20));
    ty.wear = Math.min(1, ty.wear + dt * 4e-7 * Math.max(0, P - 3000) * (w.mass < 60 ? 1 : 0.2));
    if (ty.wear >= 1 && !w.flat) puncture(v, w);
    if (P > 18e3 && (w.smokeT -= dt) <= 0) { w.smokeT = 0.12; fx_.dust([w.cp[0], w.cp[1] + 0.2, w.cp[2]], 0.4 + P / 1e5, 0xd4d4d0); }
    const Fx = fx + dmx, Fy = fy + dmy;
    const FXw = w.force * _u[0] + Fx * t[0] + Fy * s[0], FYw = w.force * _u[1] + Fx * t[1] + Fy * s[1], FZw = w.force * _u[2] + Fx * t[2] + Fy * s[2];
    _F[0] += FXw; _F[1] += FYw; _F[2] += FZw;
    const px = w.cp[0] - _com[0], py = w.cp[1] - _com[1], pz = w.cp[2] - _com[2];
    _T[0] += py * FZw - pz * FYw; _T[1] += pz * FXw - px * FZw; _T[2] += px * FYw - py * FXw;
  }
  /* limited-slip coupling: the driven wheels relax toward their mean speed (exactly, a viscous coupling is stiff) */
  if (pre.lsd && nd > 1) {
    const m = driven.reduce((s2, w) => s2 + w.omega, 0) / nd;
    for (const w of driven) w.omega += (m - w.omega) * (1 - Math.exp((-pre.lsd * dt) / (0.6 * w.mass * w.r * w.r + Iref)));
  }
  /* aerodynamic drag */
  const q = 0.5 * 1.2 * pre.CdA * vAbs;
  if (vAbs > 0.5) { _F[0] -= q * _vel[0]; _F[1] -= q * _vel[1]; _F[2] -= q * _vel[2]; }
  b3.b3Body_ApplyForceToCenter(c.body, _F, false);
  b3.b3Body_ApplyTorque(c.body, _T, false);
  drive(c);
  poseWheels(v, dt);
  stepCrumples(v, dt);
}
const fx_ = fx;
const spinner = { omega: 0, I: 1, r: 0.3, T: 0, R: 0 };

const _xf = { position: [0, 0, 0] as Vec3, quaternion: [0, 0, 0, 1] as Quat };
function poseWheels(v: Vehicle, dt: number): void {
  const pre = v.pre;
  /* wheels are re-aimed every other step (staggered), two steps ahead: the kinematic body coasts in between */
  const ahead = 2 * dt;
  integrate(_q3, _rot, _w, ahead);
  let i = 0;
  for (const w of v.wheels) {
    if (!w.attached || w.p.dead) continue;
    if ((tick + i++) % 2) { w.spin += Math.max(-1, Math.min(1, w.omega * dt)); continue; }
    const tr = Math.max(-pre.droop, w.delta);
    const loc: Vec3 = [w.hub[0] + v.uL[0] * tr, w.hub[1] + v.uL[1] * tr, w.hub[2] + v.uL[2] * tr];
    w.spin += Math.max(-1, Math.min(1, w.omega * dt));
    if (w.spin > Math.PI * 2) w.spin -= Math.PI * 2; else if (w.spin < -Math.PI * 2) w.spin += Math.PI * 2;
    axisAngle(_q, v.uL, -w.angle);
    axisAngle(_q2, v.rL, -w.spin);
    qmul(_q, _q, _q2);
    qmul(_q, _q, w.q0);
    axisAngle(_q2, v.rL, -Math.max(-1, Math.min(1, w.omega * dt)));
    qmul(_q, _q, _q2);
    const qw = qmul(_xf.quaternion, _q3, _q);
    const pw = rot(_xf.position, _q3, loc);
    pw[0] += _pos[0] + _vel[0] * ahead; pw[1] += _pos[1] + _vel[1] * ahead; pw[2] += _pos[2] + _vel[2] * ahead;
    b3.b3Body_SetTargetTransform(w.p.body, _xf, ahead, true);
  }
}

function stepCrumples(v: Vehicle, dt: number): void {
  v.hitT += dt;
  if (v.hitT > 1 && tick % 4) return;
  for (const q of v.crumples) {
    if (!q.joint) continue;
    if (q.root.dead || !b3.b3Joint_IsValid(q.joint)) { dropCrumple(q); continue; }
    const d = b3.b3PrismaticJoint_GetTranslation(q.joint);
    if (d > q.d) { v.crushE += (d - q.d) * q.F0 * (1 + (1.2 * (q.d + d)) / 2 / q.depth); q.d = d; }
    if (d > q.drawn + 1e-4) b3.b3PrismaticJoint_SetMaxMotorForce(q.joint, q.F0 * (1 + (1.2 * q.d) / q.depth));
    if (q.d - q.drawn > 0.004) {
      q.drawn = q.d;
      for (const m of q.members) if (!m.dead) D.crush(m, q.axisP.get(m)!, q.d);
      if (q.front) {
        if (q.d > 0.12 && !v.radiator) holeRadiator(v);
        if (q.d > 0.3) v.health = Math.max(0, v.health - dt * 2);
      }
      v.sparkT = 1.5;
    }
    if (q.d < 0.8 * q.depth) continue;
    b3.b3Joint_GetConstraintForce(_a, q.joint);
    const F = Math.hypot(_a[0], _a[1], _a[2]);
    if (F > 8 * q.F0) { if (++q.over >= 3) { dropCrumple(q); fx.sparks(q.root.curPos, [0, 1, 0], 16); audio.snap(q.root.curPos, 0.7); } }
    else q.over = 0;
  }
}

/* ---------------- damage, fluids ---------------- */

function puncture(v: Vehicle, w: Wheel): void {
  if (w.flat) return;
  w.flat = true;
  w.tyre.bar = 0.2;
  fx.dust([w.p.curPos[0], w.p.curPos[1], w.p.curPos[2]], 0.5, 0x3a3a3a);
  audio.snap(w.p.curPos, 0.3);
  b3.b3Body_SetAwake(v.chassis.body, true);
}

export function punctureWheel(p: Piece): boolean {
  const w = wheelOf.get(p), v = of.get(p);
  if (!w || !v) return false;
  puncture(v, w);
  return true;
}

function holeTank(v: Vehicle, energy: number, blast: boolean): void {
  if (v.fuel <= 0) return;
  v.hole = Math.max(v.hole, Math.min(2, 0.2 + energy / 30e3));
  if (blast) { v.sparkT = Math.max(v.sparkT, 5); if (energy > 20e3) v.lit = true; }
}

function holeRadiator(v: Vehicle): void {
  v.radiator = true;
}

function ignitionNear(v: Vehicle): boolean {
  if (v.sparkT > 0 && Math.random() < (v.pre.fuel === 'petrol' ? 0.7 : 0.2)) return true;
  for (const p of v.body) if (!p.dead && (p.burning || p.temp > 280)) return true;
  return false;
}

/** Damage routed through the structure layer's damagePiece: returns the energy the piece itself should take. */
export function pieceDamaged(p: Piece, point: Vec3, energy: number, blast: boolean): number {
  const v = of.get(p);
  let e = energy;
  if (v && v.alive) {
    const pre = v.pre;
    if (blast || e > 20e3) v.sparkT = Math.max(v.sparkT, blast ? 2 : 1);
    if (blast && e > 2500) for (const w of v.wheels) if (w.attached && dist(point, w.p.curPos) < 1.5) {
      puncture(v, w);
      if (e > 1.5e5) releaseWheel(v, w);
    }
    const w = wheelOf.get(p);
    if (w) {
      if (e > (blast ? 2500 : 1500)) puncture(v, w);
      if (e > 4e5 || (blast && e > 1.5e5)) releaseWheel(v, w);
    }
    if (p.root.spec.vpart === 'windscreen') {
      const lp = invRot([0, 0, 0], p.curRot, [point[0] - p.curPos[0], point[1] - p.curPos[1], point[2] - p.curPos[2]]);
      let best = Infinity, bn: Vec3 = [0, 0, 1];
      for (const f of p.poly.faces) { const d = Math.abs(dot(f.n, lp) - f.d); if (d < best) { best = d; bn = f.n; } }
      const held = (crackE.get(p) ?? 0) + e;
      crackE.set(p, held);
      if (e > 200) { D.crackGlass(p, lp, bn, Math.min(1.2, 0.35 + Math.sqrt(e) / 400)); audio.glassCrack(point); }
      e = held < 80e3 && !(blast && e > 40e3) ? e * 0.04 : e;
    }
    if (p.root.spec.vpart === 'fuel' || v.fuelPiece === p) { if (e > 5000) holeTank(v, e, blast); }
    else {
      const tank = toWorld([0, 0, 0], v, pre.tankAt[0], pre.tankAt[1], pre.tankAt[2]);
      if (!v.fuelPiece && dist(point, tank) < 0.7 && e > (blast ? 8000 : 6000)) holeTank(v, e, blast);
    }
    if (dist(point, toWorld([0, 0, 0], v, pre.radiator[0], pre.radiator[1], pre.radiator[2])) < 0.7 && e > 3000) holeRadiator(v);
    if (dist(point, toWorld([0, 0, 0], v, pre.engine[0], pre.engine[1], pre.engine[2])) < 0.9 && e > 8000) v.health = Math.max(0, v.health - e / 120e3);
    b3.b3Body_SetAwake(v.chassis.body, true);
    v.hitT = 0;
  }
  return shellDamage(p, point, e, blast);
}
const crackE = new WeakMap<Piece, number>();
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function fluids(v: Vehicle, dt: number): void {
  const pre = v.pre;
  if (v.sparkT > 0) v.sparkT -= dt;
  if (v.hole > 0 && v.fuel > 0) {
    const l = Math.min(v.fuel, v.hole * dt);
    v.fuel -= l; v.leaked += l;
    v.spillT -= dt;
    if ((v.leaked >= 1 && v.spillT <= 0) || (v.fuel <= 0 && v.leaked > 0)) {
      const at = v.fuelPiece && !v.fuelPiece.dead ? v.fuelPiece.curPos : toWorld([0, 0, 0], v, pre.tankAt[0], 0.05, pre.tankAt[2]);
      if (!v.lit && ignitionNear(v)) v.lit = true;
      spill([at[0], 0.05, at[2]], v.leaked, v.lit);
      v.leaked = 0; v.spillT = 3;
    }
  }
  const running = v.engineOn && v.health > 0;
  if (v.radiator) {
    if (v.coolant > 0) {
      v.coolant = Math.max(0, v.coolant - dt * (running ? 0.35 : 0.15));
      const at = toWorld([0, 0, 0], v, pre.radiator[0], pre.radiator[1] + 0.3, pre.radiator[2]);
      fx.steamJet(at, [_f[0] * 0.3, 1, _f[2] * 0.3], 0.5 + v.coolant / 20);
    } else if (running && (v.overheat += dt) > 30) v.health = 0;
  }
  if (v.health < 0.6) {
    const at = toWorld([0, 0, 0], v, pre.engine[0], pre.engine[1] + 0.4, pre.engine[2]);
    fx.dust(at, 0.4 + (0.6 - v.health), 0x2c2c2c);
  }
  if (v.health <= 0 && v.engineOn) v.engineOn = false;
}

/** Called once per physics step by the structure layer (between steps: forces apply to the next one). */
export function stepVehicles(dt: number): void {
  const t0 = performance.now();
  tick++;
  flushDents();
  for (let i = vehicles.length - 1; i >= 0; i--) {
    const v = vehicles[i];
    if (!v.alive) { vehicles.splice(i, 1); continue; }
    if (v.chassis.dead) { dissolve(v); vehicles.splice(i, 1); continue; }
    if (v.driven && (v.controls.throttle > 0 || v.controls.brake > 0 || v.controls.steer !== 0)) b3.b3Body_SetAwake(v.chassis.body, true);
    if (stepCount - v.chassis.movedStep > 1) {
      if (!v.asleep) {
        v.asleep = true;
        for (const w of v.wheels) if (w.attached && !w.p.dead) { b3.b3Body_SetLinearVelocity(w.p.body, [0, 0, 0]); b3.b3Body_SetAngularVelocity(w.p.body, [0, 0, 0]); w.omega = 0; }
      }
      continue;
    }
    v.asleep = false;
    if (!v.rated) rate(v);
    simulate(v, dt);
  }
  tickT += dt;
  if (tickT >= 0.25) {
    for (const v of vehicles) if (v.alive && (v.hole > 0 || v.radiator || v.health < 0.6 || v.sparkT > 0)) fluids(v, tickT);
    tickT = 0;
  }
  buckleT += dt;
  if (buckleT >= 0.5) { buckleT = 0; checkBuckling(); }
  vehicleCost.ms += performance.now() - t0;
  vehicleCost.steps++;
}

export function clearVehicles(): void {
  vehicles.length = 0;
  drivenVehicle = null;
  clearShells();
}

/** HUD / test readout. */
export function vehicleState(v: Vehicle): { speed: number; kmh: number; gear: number; rpm: number; fuel: number; health: number; flat: number; crush: number; tyreTemp: number; wear: number } {
  return {
    speed: v.speed, kmh: v.speed * 3.6, gear: v.gear, rpm: v.rpm, fuel: v.fuel, health: v.health,
    flat: v.wheels.filter(w => w.flat).length, crush: Math.max(0, ...v.crumples.map(q => q.d)),
    tyreTemp: Math.max(...v.wheels.map(w => w.tyre.temp)), wear: Math.max(...v.wheels.map(w => w.tyre.wear)),
  };
}
