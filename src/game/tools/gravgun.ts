import { vec3, clamp } from 'math';
import type { b3Filter, b3ShapeId } from 'box3d.js';
import type { Vec3 } from '../../types';
import { b3, CAT, ALL, raycast, entityOfBody, drive, type PhysEntity } from '../../physics/physics';
import { pieceOf, applyImpulseAt, kinetic, type Piece } from '../../destruction/structure';
import { fx } from '../../render/fx';
import { viewmodelGrip } from '../../render/viewmodel';
import { audio } from '../../audio/audio';
import { hitmarker } from '../../ui/ui';
import { player, kickRecoil, addTrauma, knockback } from '../player';

const RANGE = 12;
const MAX_MASS = 2500;
const HOLD = 3;
const THROW = 25;         // m/s cap for light things
const THROW_E = 20e3;     // J the launch can put into a throw: v = √(2E/m)
const GAIN = 10;          // 1/s: how hard the hold point is chased
const MAX_SPEED = 22;
const MAX_ACCEL = 70;     // m/s², light objects
/* N the field can exert. Holding a load up spends m·g of it, so a 2 t slab has ~16 kN left to steer
   with: it lags, swings and sags below the crosshair; a crate goes where it's pointed. */
const MAX_FORCE = 60e3;
const SNAG = 6;           // m from the hold point before the grip is lost

interface Held { e: PhysEntity; piece: Piece | null; shape: b3ShapeId; filter: b3Filter; dist: number }
let held: Held | null = null;

export function heldEntity(): PhysEntity | null { return held?.e ?? null; }

function shapeOf(e: PhysEntity): b3ShapeId | null {
  const s = (e as { shape?: b3ShapeId }).shape;
  return s && b3.b3Shape_IsValid(s) ? s : null;
}

function grab(e: PhysEntity, piece: Piece | null, dist: number): void {
  const shape = shapeOf(e);
  if (!shape) return;
  const f = b3.b3Shape_GetFilter(shape);
  /* A held object that can touch the player lets you stand on it and lift yourself. */
  for (const s of piece?.parts ? piece.parts.map(q => q.shape) : [shape]) b3.b3Shape_SetFilter(s, { categoryBits: f.categoryBits, maskBits: f.maskBits & ~CAT.player, groupIndex: f.groupIndex }, true);
  held = { e, piece, shape, filter: f, dist };
  b3.b3Body_SetAwake(e.body, true);
  viewmodelGrip(true);
  audio.gravGrab();
  audio.gravHold(true);
}

export function dropHeld(): void {
  if (!held) return;
  const h = held;
  held = null;
  for (const s of h.piece?.parts ? h.piece.parts.map(q => q.shape) : [h.shape]) if (b3.b3Shape_IsValid(s)) b3.b3Shape_SetFilter(s, h.filter, true);
  viewmodelGrip(false);
  audio.gravHold(false);
}

function stillHeld(h: Held): boolean {
  if (entityOfBody(h.e.body) !== h.e || !b3.b3Body_IsValid(h.e.body)) return false;
  if (h.piece) return !h.piece.dead && h.piece.welds.length === 0;
  return !(h.e as { dead?: boolean }).dead;
}

/* One press: throw what is held, else grab a loose piece / ordnance, else yank a welded piece. */
export function gravFire(eye: Vec3, fwd: Vec3, canGrab: (e: PhysEntity) => boolean): string | null {
  if (held) {
    const h = held;
    dropHeld();
    if (!stillHeld(h)) return null;
    const m = h.e.mass;
    const sp = Math.min(THROW, Math.sqrt((2 * THROW_E) / Math.max(m, 1)));
    const pv: Vec3 = [0, 0, 0];
    if (player.e) b3.b3Body_GetLinearVelocity(pv, player.e.body);
    b3.b3Body_SetLinearVelocity(h.e.body, [fwd[0] * sp + pv[0] * 0.5, fwd[1] * sp + 1 + pv[1] * 0.3, fwd[2] * sp + pv[2] * 0.5]);
    const spin = 3 / Math.max(1, Math.cbrt(m) * 0.4);
    b3.b3Body_SetAngularVelocity(h.e.body, [(Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin]);
    audio.gravThrow();
    thrown.push({ e: h.e, until: performance.now() + 3000, size: clamp(Math.cbrt(h.e.mass / 2400), 0.1, 3) });
    // the reaction: the launch's momentum comes back through the player
    const k = clamp((m * sp) / 20e3, 0, 1);
    kickRecoil(0.5 + k);
    addTrauma(0.05 + k * 0.15);
    if (k > 0.5) knockback(0.15 * k);
    return null;
  }
  const hit = raycast(eye, [fwd[0] * RANGE, fwd[1] * RANGE, fwd[2] * RANGE], ALL & ~CAT.player);
  if (!hit || !hit.entity) return 'Gravity gun — nothing in reach';
  const e = hit.entity;
  const piece = pieceOf(e);
  if (piece) {
    if (piece.fade > 0) return 'Nothing to grab';
    if (piece.welds.length === 0) {
      if (piece.mass > MAX_MASS) return `Too heavy to lift (${(piece.mass / 1000).toFixed(1)} t)`;
      grab(piece, piece, HOLD + Math.cbrt(piece.volume) * 0.6);
      return null;
    }
    yank(piece, hit.point, hit.normal, fwd);
    return null;
  }
  if (e.kind === 'projectile' && canGrab(e)) {
    grab(e, null, HOLD - 0.6);
    return null;
  }
  return 'Gravity gun — only loose pieces and ordnance can be lifted';
}

/* A welded piece can't be carried, but a hard pull can tear small ones out of the wall. */
function yank(piece: Piece, point: Vec3, normal: Vec3, fwd: Vec3): void {
  const back: Vec3 = [-fwd[0], -fwd[1] * 0.5 + 0.15, -fwd[2]];
  vec3.normalize(back, back);
  const j = clamp(piece.mass * 4, 500, 12e3);
  applyImpulseAt(piece, [back[0] * j, back[1] * j, back[2] * j], point);
  kinetic(point, back, 28e3, 0.8);
  fx.dust(point, 0.6, piece.pm.dust);
  fx.debris(point, 5, piece.pm.chips, 2.5, normal);
  audio.gravThrow();
  kickRecoil(-0.8);
  addTrauma(0.08);
  hitmarker(0.5);
}

const _c: Vec3 = [0, 0, 0], _t: Vec3 = [0, 0, 0], _v: Vec3 = [0, 0, 0], _pv: Vec3 = [0, 0, 0], _w: Vec3 = [0, 0, 0];

/* Critically-damped chase of the hold point, force-limited by mass, with gravity cancelled. */
export function gravPreStep(eye: Vec3, fwd: Vec3, active: boolean, dt: number): void {
  if (!held) return;
  const h = held;
  if (!active || !stillHeld(h)) { dropHeld(); return; }
  vec3.copy(_eye, eye);
  vec3.copy(_fwd, fwd);
  const body = h.e.body;
  b3.b3Body_GetWorldCenterOfMass(_c, body);
  vec3.scaleAndAdd(_t, eye, fwd, h.dist);
  if (player.e) {
    const feet = player.e.curPos;
    const dx = _t[0] - feet[0], dz = _t[2] - feet[2], r = Math.hypot(dx, dz), keep = 1.1 + h.dist * 0.15;
    if (r < keep) {
      const fx0 = -Math.sin(player.yaw), fz0 = -Math.cos(player.yaw);
      _t[0] = feet[0] + fx0 * keep; _t[2] = feet[2] + fz0 * keep;
    }
    _t[1] = Math.max(_t[1], feet[1] + 0.35);
    b3.b3Body_GetLinearVelocity(_pv, player.e.body);
  } else vec3.set(_pv, 0, 0, 0);
  const d = vec3.distance(_t, _c);
  if (d > SNAG) { dropHeld(); return; }
  b3.b3Body_GetLinearVelocity(_v, body);
  vec3.sub(_w, _t, _c);
  vec3.scale(_w, _w, GAIN);
  const ws = vec3.length(_w);
  if (ws > MAX_SPEED) vec3.scale(_w, _w, MAX_SPEED / ws);
  vec3.add(_w, _w, _pv);
  vec3.sub(_w, _w, _v);
  const m = Math.max(h.e.mass, 1);
  const lift = Math.min(9.81, MAX_FORCE / m);
  const maxDv = Math.min(MAX_ACCEL, Math.max(0, MAX_FORCE - m * lift) / m) * dt;
  const dl = vec3.length(_w);
  if (dl > maxDv) vec3.scale(_w, _w, maxDv / dl);
  _v[0] += _w[0]; _v[1] += _w[1] + lift * dt; _v[2] += _w[2];
  b3.b3Body_SetLinearVelocity(body, _v);
  drive(h.e);
  // spin is damped by what torque the field has left over the load's own inertia: heavy slabs keep turning
  const damp = Math.max(0.85, 1 - 0.15 * (500 / m));
  b3.b3Body_GetAngularVelocity(_w, body);
  b3.b3Body_SetAngularVelocity(body, [_w[0] * damp, _w[1] * damp, _w[2] * damp]);
}

/** Wheel: pull the load in or push it out along the beam. */
export function gravDistance(dir: number): boolean {
  if (!held) return false;
  held.dist = clamp(held.dist + dir * 0.5, 1.6, RANGE - 2);
  return true;
}

/** Right button: set the load down without throwing it. */
export function gravRelease(): boolean {
  if (!held) return false;
  dropHeld();
  return true;
}

export function gravStatus(): { mass: number; dist: number; lag: number } | null {
  if (!held) return null;
  vec3.scaleAndAdd(_t, _eye, _fwd, held.dist);
  b3.b3Body_GetWorldCenterOfMass(_c, held.e.body);
  return { mass: held.e.mass, dist: held.dist, lag: vec3.distance(_t, _c) };
}
const _eye: Vec3 = [0, 0, 0], _fwd: Vec3 = [0, 0, 0];

/* Thrown loads whoosh past for a few seconds after release. */
const thrown: { e: PhysEntity; until: number; size: number }[] = [];
const _fv: Vec3 = [0, 0, 0];
export function gravFlyby(): void {
  const t = performance.now();
  for (let i = thrown.length - 1; i >= 0; i--) {
    const k = thrown[i];
    if (t > k.until || !b3.b3Body_IsValid(k.e.body)) { thrown.splice(i, 1); continue; }
    b3.b3Body_GetLinearVelocity(_fv, k.e.body);
    audio.flyby(k.e.curPos, _fv, k.size);
  }
}

export function clearGrav(): void {
  if (held) { viewmodelGrip(false); audio.gravHold(false); }
  held = null;
  thrown.length = 0;
}
