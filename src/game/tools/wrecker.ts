import * as THREE from 'three';
import { vec3, quat, clamp } from 'math';
import type { b3ShapeId, b3JointId } from 'box3d.js';
import type { Vec3, Quat, ToolReadout } from '../../types';
import { b3, world, ground, CAT, ALL, filter, register, unregister, raycast, overlapAABB, stepCount, type PhysEntity } from '../../physics/physics';
import { pieceOf, kinetic } from '../../destruction/structure';
import { cables, makeWreckingBall } from '../../render/cables';
import { getProjectileMaterial } from '../../render/materials';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { hitmarker } from '../../ui/ui';
import { player, addTrauma } from '../player';
import { NO_HIT, PIECES, GROUND_Y, interpPoint, slerpDir, ropeSag } from './common';

const RADIUS = 0.55;
const MASS = 2000;
const RANGE = 60;
const LEAD = 6;          // boom tip sits this far in front of the target, toward the player
const OUTREACH = 9;      // crane's slewing centre stands this much further back from the boom tip
const LUFF = [8, 24];    // boom-tip height range above the aim point (wheel)
const MIN_AIM_Y = 2.2;   // keeps the bottom of the arc off the ground
const RESWING_NEAR = 7;  // a new aim point closer than this to the last one re-swings the same rig
const HAUL = 7;          // m/s average along the arc while the crane drags the ball back
const HAUL_MAX = 12;     // m/s steering clamp (smoothstep peaks at 1.5× the average)
const HOLD = 0.35;       // settle at the release point before letting go
const HOLD_MAX = 2;
/* Pull-back angles from vertical, tried in order until the release point is clear of structure.
   From 69° on a ~15 m rope the ball arrives at the target at ~12 m/s (~150 kJ). */
const RELEASE = [1.2, 1.0, 0.8, 0.6];

interface Ball extends PhysEntity { kind: 'projectile'; shape: b3ShapeId }

interface Rig {
  ball: Ball;
  /** crane base on the ground (boom foot) */
  base: Vec3;
  crane: THREE.Object3D;
  boom: number;
  /** drop-ball: held hoisted under the tip for this long, then the clutch is let go */
  hoist: number;
  drop: boolean;
  joint: b3JointId;
  anchor: Vec3;
  /** anchor → ball centre with the rope taut and the ball hanging shackle-up */
  len: number;
  /** cable length, anchor → shackle eye */
  rope: number;
  /** ball-local Y of the shackle eye the cable is tied to */
  eye: Vec3;
  target: Vec3;
  side: Vec3;
  mesh: THREE.Object3D;
  cable: number;
  wind: { u0: Vec3; u1: Vec3; s: number; dur: number; hold: number } | null;
  lastHit: number;
  lastKinetic: number;
  lastCreak: number;
}

let scene: THREE.Scene;
let rig: Rig | null = null;
let t = 0;
let tip = 14;
let lastHitE = 0;

/** Wheel: luff the boom up or down (boom-tip height over the target) for the next rig. */
export function luffBoom(dir: number): number {
  tip = clamp(tip + dir * 2, LUFF[0], LUFF[1]);
  return tip;
}

function makeCrane(): THREE.Object3D {
  const g = new THREE.Group();
  const yellow = getProjectileMaterial('yellow'), dark = getProjectileMaterial('iron');
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 4.2), yellow);
  body.position.y = 2.2;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 1.4), dark);
  cab.position.set(1.1, 3.9, 1.2);
  const cw = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.2, 1.1), dark);
  cw.position.set(0, 2.6, -2.4);
  g.add(body, cab, cw);
  for (const x of [-1.25, 1.25]) {
    const tr = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1, 5.2), dark);
    tr.position.set(x, 0.5, 0);
    g.add(tr);
  }
  g.traverse(o => { o.castShadow = true; });
  return g;
}

export function initWrecker(s: THREE.Scene): void { scene = s; }

function releasePoint(out: Vec3, anchor: Vec3, len: number, side: Vec3, angle: number): Vec3 {
  const s = Math.sin(angle) * len, c = Math.cos(angle) * len;
  return vec3.set(out, anchor[0] + side[0] * s, anchor[1] - c, anchor[2] + side[2] * s);
}

function clear(p: Vec3): boolean {
  const r = RADIUS + 0.35;
  let hit = false;
  overlapAABB([p[0] - r, p[1] - r, p[2] - r], [p[0] + r, p[1] + r, p[2] + r], PIECES, () => { hit = true; });
  return !hit && p[1] > RADIUS + 0.2;
}

function pickRelease(out: Vec3, anchor: Vec3, len: number, side: Vec3): Vec3 {
  for (const a of RELEASE) if (clear(releasePoint(out, anchor, len, side, a))) return out;
  return releasePoint(out, anchor, len, side, RELEASE[RELEASE.length - 1]);
}

/* Fire: aim → (re)build the rig or drag the existing ball back and let it go. Returns a deny message. */
export function fireWrecker(eye: Vec3, fwd: Vec3): string | null {
  const hit = raycast(eye, [fwd[0] * RANGE, fwd[1] * RANGE, fwd[2] * RANGE], NO_HIT);
  if (!hit) return 'Wrecking ball — aim at something within 60 m';
  const target: Vec3 = [hit.point[0], Math.max(hit.point[1], MIN_AIM_Y), hit.point[2]];
  if (rig && !valid(rig)) destroyRig();
  if (rig && !rig.drop && vec3.distance(target, rig.target) < RESWING_NEAR) {
    if (rig.wind) return 'Wrecking ball is still being hauled back';
    const fx0 = eye[0] - rig.anchor[0], fz0 = eye[2] - rig.anchor[2], fl = Math.hypot(fx0, fz0);
    if (fl > 1) vec3.set(rig.side, fx0 / fl, 0, fz0 / fl);
    startWind(rig);
    return null;
  }
  let hx = eye[0] - target[0], hz = eye[2] - target[2], hl = Math.hypot(hx, hz);
  if (hl < 0.5) { hx = -fwd[0]; hz = -fwd[2]; hl = Math.hypot(hx, hz); }
  if (hl < 1e-3) { hx = 1; hz = 0; hl = 1; }
  const side: Vec3 = [hx / hl, 0, hz / hl];
  const anchor: Vec3 = [target[0] + side[0] * LEAD, target[1] + tip, target[2] + side[2] * LEAD];
  const len = vec3.distance(anchor, target);
  const start = pickRelease([0, 0, 0], anchor, len, side);
  if (rig) destroyRig();
  rig = buildRig(anchor, len, start, target, side, false);
  fx.dust(start, 1.2, 0x9a958c);
  audio.cableCreak(start, 0.7);
  return null;
}

/* Drop ball: the tip slews over the aim point, the ball is hoisted to the sheave and the clutch let go. It falls
   free and the rope is paid out long enough for it to land: the energy is m·g·h, which is what breaks slabs. */
export function dropBall(eye: Vec3, fwd: Vec3): string | null {
  const hit = raycast(eye, [fwd[0] * RANGE, fwd[1] * RANGE, fwd[2] * RANGE], NO_HIT);
  if (!hit) return 'Drop ball — aim at something within 60 m';
  const target: Vec3 = [hit.point[0], hit.point[1], hit.point[2]];
  let hx = eye[0] - target[0], hz = eye[2] - target[2], hl = Math.hypot(hx, hz);
  if (hl < 0.5) { hx = -fwd[0]; hz = -fwd[2]; hl = Math.hypot(hx, hz) || 1; }
  const side: Vec3 = [hx / hl, 0, hz / hl];
  const anchor: Vec3 = [target[0], target[1] + tip, target[2]];
  const len = tip - RADIUS + 0.35;
  const start: Vec3 = [anchor[0], anchor[1] - RADIUS * 2.4, anchor[2]];
  if (!clear(start)) return 'No room to hoist the ball under the boom tip';
  if (rig) destroyRig();
  rig = buildRig(anchor, len, start, target, side, true);
  rig.hoist = 0.9;
  audio.cableCreak(start, 0.8);
  return null;
}

function buildRig(anchor: Vec3, len: number, start: Vec3, target: Vec3, side: Vec3, drop: boolean): Rig {
  const mesh = makeWreckingBall(RADIUS);
  const attach = typeof mesh.userData.attach === 'number' ? (mesh.userData.attach as number) : RADIUS * 1.7;
  const eye: Vec3 = [0, attach, 0];
  const rope = len - attach;
  const up = vec3.normalize([0, 0, 0], [anchor[0] - start[0], anchor[1] - start[1], anchor[2] - start[2]]) as Vec3;
  const rot = quat.rotationTo([0, 0, 0, 1], [0, 1, 0], up) as Quat;
  const bd = b3.b3DefaultBodyDef();
  bd.type = b3.b3BodyType.b3_dynamicBody;
  bd.position = [start[0], start[1], start[2]];
  bd.rotation = rot;
  bd.linearDamping = 0.03;
  bd.angularDamping = 0.4;
  const body = b3.b3CreateBody(world, bd);
  const sd = b3.b3DefaultShapeDef();
  sd.density = MASS / ((4 / 3) * Math.PI * RADIUS ** 3);
  sd.filter = filter(CAT.projectile, ALL & ~(CAT.player | CAT.projectile));
  sd.enableContactEvents = false;
  sd.enableHitEvents = true;
  sd.baseMaterial.friction = 0.5;
  sd.baseMaterial.restitution = 0.12;
  sd.baseMaterial.rollingResistance = 0.05;
  const shape = b3.b3CreateSphereShape(body, sd, { center: [0, 0, 0], radius: RADIUS });

  /* Rope, not rod: a zero-stiffness spring keeps the joint soft below the limit, so the cable goes
     slack when the ball bounces toward the anchor and only the max-length limit ever pulls. The
     anchor lives on the ground body, so collideConnected must stay on or the ball ghosts through the ground. */
  const jd = b3.b3DefaultDistanceJointDef();
  jd.base.bodyIdA = ground;
  jd.base.localFrameA = { position: [anchor[0], anchor[1] - GROUND_Y, anchor[2]], quaternion: [0, 0, 0, 1] };
  jd.base.bodyIdB = body;
  jd.base.localFrameB = { position: eye, quaternion: [0, 0, 0, 1] };
  jd.base.collideConnected = true;
  jd.length = rope;
  jd.enableSpring = true;
  jd.hertz = 0;
  jd.dampingRatio = 0;
  jd.enableLimit = true;
  jd.minLength = 0.05;
  jd.maxLength = rope;
  jd.enableMotor = false;
  const joint = b3.b3CreateDistanceJoint(world, jd);

  const ball: Ball = {
    kind: 'projectile', body, shape, mass: b3.b3Body_GetMass(body),
    prevPos: [...start], prevRot: [...rot], curPos: [...start], curRot: [...rot], movedStep: -1,
  };
  register(ball);
  mesh.position.fromArray(start);
  mesh.quaternion.fromArray(rot);
  scene.add(mesh);
  // the crane stands back from the tip, away from the target, on whatever is below
  const bx = anchor[0] + side[0] * OUTREACH, bz = anchor[2] + side[2] * OUTREACH;
  const down = raycast([bx, anchor[1], bz], [0, -anchor[1] - 20, 0], NO_HIT);
  const base: Vec3 = [bx, (down ? down.point[1] : 0), bz];
  const crane = makeCrane();
  crane.position.fromArray(base);
  crane.rotation.y = Math.atan2(-side[0], -side[2]);
  scene.add(crane);
  return {
    ball, base, crane, boom: cables.add(0.2, 0xd9a21b), hoist: 0, drop,
    joint, anchor, len, rope, eye, target, side, mesh, cable: cables.add(),
    wind: null, lastHit: -9, lastKinetic: -9, lastCreak: -9,
  };
}

function startWind(r: Rig): void {
  const pos = r.ball.curPos;
  const u0 = vec3.normalize([0, 0, 0], [pos[0] - r.anchor[0], pos[1] - r.anchor[1], pos[2] - r.anchor[2]]) as Vec3;
  const rel = pickRelease([0, 0, 0], r.anchor, r.len, r.side);
  const u1 = vec3.normalize([0, 0, 0], [rel[0] - r.anchor[0], rel[1] - r.anchor[1], rel[2] - r.anchor[2]]) as Vec3;
  const om = Math.acos(clamp(vec3.dot(u0, u1), -1, 1));
  r.wind = { u0, u1, s: 0, dur: clamp((om * r.len) / HAUL, 0.8, 5), hold: 0 };
  b3.b3Body_SetAwake(r.ball.body, true);
  audio.cableCreak(pos, 0.9);
}

function valid(r: Rig): boolean {
  return b3.b3Body_IsValid(r.ball.body) && b3.b3Joint_IsValid(r.joint);
}

function destroyRig(): void {
  if (!rig) return;
  const r = rig;
  rig = null;
  if (b3.b3Joint_IsValid(r.joint)) b3.b3DestroyJoint(r.joint, true);
  unregister(r.ball);
  if (b3.b3Body_IsValid(r.ball.body)) b3.b3DestroyBody(r.ball.body);
  dropVisuals(r);
}

function dropVisuals(r: Rig): void {
  scene.remove(r.mesh, r.crane);
  r.mesh.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  r.crane.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  cables.remove(r.cable);
  cables.remove(r.boom);
}

const _v: Vec3 = [0, 0, 0], _d: Vec3 = [0, 0, 0], _f: Vec3 = [0, 0, 0], _y: Vec3 = [0, 0, 0];
const UP: Vec3 = [0, 1, 0];

/* While being hauled back the ball is steered along its own arc (rope stays taut), then held a beat and let go. */
export function wreckerPreStep(dt: number): void {
  if (!rig) return;
  if (!valid(rig)) { destroyRig(); return; }
  if (rig.hoist > 0) {
    rig.hoist -= dt;
    b3.b3Body_SetLinearVelocity(rig.ball.body, [0, 9.81 * dt, 0]);
    b3.b3Body_SetAngularVelocity(rig.ball.body, [0, 0, 0]);
    if (rig.hoist <= 0) audio.cableCreak(rig.ball.curPos, 1);
    return;
  }
  const w = rig.wind;
  if (!w) return;
  const body = rig.ball.body;
  if (w.s < 1) w.s = Math.min(1, w.s + dt / w.dur);
  else w.hold += dt;
  const e = w.s * w.s * (3 - 2 * w.s);
  slerpDir(_d, w.u0, w.u1, e);
  const pos = rig.ball.curPos;
  vec3.set(_v, rig.anchor[0] + _d[0] * rig.len - pos[0], rig.anchor[1] + _d[1] * rig.len - pos[1], rig.anchor[2] + _d[2] * rig.len - pos[2]);
  const err = vec3.length(_v);
  vec3.scale(_v, _v, 9);
  _v[1] += 9.81 * dt;
  const sp = vec3.length(_v);
  if (sp > HAUL_MAX) vec3.scale(_v, _v, HAUL_MAX / sp);
  if ((w.hold >= HOLD && err < 0.4) || w.hold >= HOLD_MAX) {
    rig.wind = null;
    vec3.set(_v, 0, 0, 0);
    audio.cableCreak(pos, 0.6);
  }
  b3.b3Body_SetLinearVelocity(body, _v);
  /* turn the shackle toward the anchor so the cable eye stays where the steering assumes it is */
  vec3.transformQuat(_y, UP, rig.ball.curRot);
  vec3.normalize(_d, vec3.sub(_d, rig.anchor, pos));
  vec3.scale(_d, vec3.cross(_d, _y, _d), 8);
  b3.b3Body_SetAngularVelocity(body, _d);
}

export function wreckerAfterStep(dt: number): void {
  t += dt;
  if (!rig) return;
  if (!valid(rig) || rig.ball.curPos[1] < -20) { destroyRig(); return; }
  if (rig.wind) return;
  b3.b3Body_GetLinearVelocity(_v, rig.ball.body);
  const sp = vec3.length(_v);
  if (sp > 2) audio.swing(rig.ball.curPos, sp);
  b3.b3Joint_GetConstraintForce(_f, rig.joint);
  const tension = vec3.length(_f);
  if (tension > MASS * 9.81 * 1.8 && t - rig.lastCreak > 1.1) {
    rig.lastCreak = t;
    audio.cableCreak(rig.ball.curPos, clamp(tension / (MASS * 9.81 * 4), 0, 1));
  }
}

/* The core already turns projectile hits into damage (and kinetic above 12 m/s); this adds the
   feedback, and joint overload for slower swings that still carry tens of kJ. */
export function wreckerHit(a: PhysEntity | undefined, b: PhysEntity | undefined, point: Vec3, speed: number): boolean {
  if (!rig || (a !== rig.ball && b !== rig.ball)) return false;
  if (speed < 2.5) return true;
  const other = a === rig.ball ? b : a;
  const piece = pieceOf(other);
  const s = clamp(speed / 13, 0, 1);
  if (speed > 3) lastHitE = Math.max(t - rig.lastHit > 0.5 ? 0 : lastHitE, 0.5 * rig.ball.mass * speed * speed);
  if (t - rig.lastHit > 0.12) {
    rig.lastHit = t;
    audio.wreckingHit(point, s);
    const d = player.e ? vec3.distance(player.e.curPos, point) : 99;
    addTrauma(clamp(0.4 * s * (1 - d / 45), 0, 0.4));
  }
  if (piece) {
    hitmarker(clamp(speed / 12, 0.3, 1));
    if (speed > 4 && speed <= 12 && t - rig.lastKinetic > 0.15) {
      rig.lastKinetic = t;
      b3.b3Body_GetLinearVelocity(_v, rig.ball.body);
      const l = vec3.length(_v) || 1;
      kinetic(point, [_v[0] / l, _v[1] / l, _v[2] / l], 0.5 * rig.ball.mass * speed * speed, 1.3);
    }
  } else if (speed > 4) {
    fx.impact(point, [0, 1, 0], 'concrete', s * 0.7);
    fx.dust(point, 0.8 + s * 1.5, 0x9a8f80);
  }
  return true;
}

export function wreckerBusy(): boolean {
  if (!rig) return false;
  if (rig.wind) return true;
  if (!b3.b3Body_IsValid(rig.ball.body)) return false;
  b3.b3Body_GetLinearVelocity(_v, rig.ball.body);
  return vec3.length(_v) > 1.5;
}

const _p: Vec3 = [0, 0, 0], _e: Vec3 = [0, 0, 0], _q = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const ORIGIN: Vec3 = [0, 0, 0];

export function syncWrecker(alpha: number): void {
  if (!rig) return;
  const ball = rig.ball;
  interpPoint(_p, ball, ORIGIN, alpha);
  rig.mesh.position.fromArray(_p);
  const a = ball.movedStep === stepCount ? alpha : 1;
  _q.fromArray(ball.prevRot); _qb.fromArray(ball.curRot);
  rig.mesh.quaternion.slerpQuaternions(_q, _qb, a);
  interpPoint(_e, ball, rig.eye, alpha);
  cables.set(rig.cable, rig.anchor, _e, ropeSag(rig.rope, vec3.distance(rig.anchor, _e)));
  cables.set(rig.boom, [rig.base[0], rig.base[1] + 2.6, rig.base[2]], rig.anchor, 0);
  b3.b3Body_GetLinearVelocity(_fv, ball.body);
  audio.flyby(_p, _fv, RADIUS * 2);
}
const _fv: Vec3 = [0, 0, 0];

/* Level teardown: the world goes with it, so only visuals need releasing. */
export function clearWrecker(): void {
  if (rig) dropVisuals(rig);
  rig = null;
}

export function wreckerStatus(): ToolReadout {
  const boomDeg = (r: Rig) => Math.round((Math.atan2(r.anchor[1] - r.base[1] - 2.6, Math.hypot(r.anchor[0] - r.base[0], r.anchor[2] - r.base[2])) * 180) / Math.PI);
  if (!rig) return { title: `Crawler crane · tip ${tip} m over target`, progress: null, detail: 'LMB rig and swing · wheel luff the boom · RMB drop ball', warn: false };
  const period = 2 * Math.PI * Math.sqrt(rig.len / 9.81);
  const mode = rig.drop ? `drop ball from ${tip} m (${Math.round((rig.ball.mass * 9.81 * tip) / 1000)} kJ)` : `swing T ${period.toFixed(1)} s`;
  return {
    title: `Crawler crane · boom ${boomDeg(rig)}°`,
    progress: null,
    detail: `${(rig.ball.mass / 1000).toFixed(1)} t ball · rope ${rig.rope.toFixed(1)} m · ${mode}${lastHitE > 1000 ? ` · last hit ${Math.round(lastHitE / 1000)} kJ` : ''} · wheel luff (next rig ${tip} m)`,
    warn: false,
  };
}

export function wreckerDebug(): { hitE: number; drop: boolean; ball: Vec3 | null } {
  return { hitE: lastHitE, drop: rig?.drop ?? false, ball: rig ? [...rig.ball.curPos] : null };
}
