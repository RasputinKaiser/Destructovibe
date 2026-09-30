import * as THREE from 'three';
import { vec3, clamp } from 'math';
import type { b3JointId } from 'box3d.js';
import type { Vec3, ToolReadout, MaterialId } from '../../types';
import { b3, world, ground, raycast } from '../../physics/physics';
import { pieceOf, type Piece } from '../../destruction/structure';
import { vehicleOf } from '../../vehicles/vehicle';
import { getProjectileMaterial } from '../../render/materials';
import { lines as gfx, hangLine } from '../../render/ropes';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { hitmarker } from '../../ui/ui';
import { viewmodel } from '../../render/viewmodel';
import { player, harness, HARNESS_H, eyePosition } from '../player';
import { NO_HIT, GROUND_Y, interpPoint, localBounds, fillOf, toolHooks } from './common';
import { LINES, SEAT, makeLine, makeStake, anchorOn, anchorWorld, type Anchor, type Bite } from './lines';

/* Pneumatic grapple launcher: a compressed-air tube throws a four-tine grapnel (22 cm across) trailing 10 mm HMPE line
   from a line canister, and a powered reel (an ascender's drive) takes it back in; the launcher is clipped to the
   operator's harness, so the line hauls his harness, not his grip. What the hook does depends on what it lands on:
   - a thin member (tube, pipe, rail, rebar: under ~15 cm) the tines close round, or the flange of an open section
     (I, H, channel, lattice) a tine hooks: it holds while the line pulls across the member; pulled along it, it slides
     to the next stop (a joint, a cross member) and holds there, or runs off the end;
   - near an edge (a parapet, a sill, a window jamb, a slab's lip): it holds only while the line runs back over that
     edge; pulled any other way it skids off;
   - a flat top (a roof, a slab): it lies there, and the line drags it back across until it catches the near edge;
   - a sheer face or the ground: no purchase; reel it back and throw again.
   Edges crush or spall under the tines past what their material bears; the hook tears out. Held on the reel, the line
   works both ways: whatever is loose and light comes to you, and whatever holds hauls you to it (lift off, swing, climb).
   Wheel pays line out or takes it in a metre at a time (a controlled descent), RMB makes the line fast (to a vehicle
   you aim at, else a ground anchor at your feet) so it becomes a rigging line and the launcher is free again. */
export const GRAPPLE = {
  /** muzzle speed, m/s, and line on the reel, m (a pneumatic pick-up grapple carries ~85 m) */
  speed: 34, line: 60,
  /** reel: line pull N and line speed m/s (a powered rope ascender: 66 m/min, 250 kg heavy-duty) */
  pull: 2.45e3, reel: 1.1,
  /** grapnel: all tines round a member ~17 kN (a five-tine steel hook's break); one tine over an edge ~8.9 kN */
  cap: 17.3e3, tine: 8.9e3,
  /** the reel's slip clutch: above this the drum pays out rather than tear the harness (a load falling away), N */
  clutch: 2.6e3,
  /** loose pieces heavier than this won't come, however hard the reel pulls (kg) */
  heavy: 2500,
};

/* What an edge bears under one tine before it crushes or spalls, N: the tine's own rating on steel, less on what
   crumbles (judgement from the materials' strength). */
function edgeCap(m: MaterialId): number {
  switch (m) {
    case 'steel': case 'castiron': case 'metal': case 'machine': case 'aluminum': case 'copper': return GRAPPLE.tine;
    case 'wood': case 'oak': case 'plywood': case 'crate': return 8e3;
    case 'concrete': case 'stone': case 'marble': return 6e3;
    case 'glass': case 'tempered': case 'lamp': return 400;
    case 'drywall': case 'plaster': return 600;
    default: return 3.5e3;
  }
}

type State = 'ready' | 'flying' | 'loose' | 'hooked';
let state: State = 'ready';
const pos: Vec3 = [0, 0, 0], vel: Vec3 = [0, 0, 0], prev: Vec3 = [0, 0, 0];
let paid = 0;
let len = 0;
let hook: { piece: Piece; local: Vec3; bite: Bite | null; slide: boolean; n: Vec3 } | null = null;
let joint: b3JointId | null = null;
let reeling = false, heldNow = false;
let tugOver = 0;
let limitOn = true;
let tension = 0;
let vis = -1;
let mesh: THREE.Group | null = null;
let scene: THREE.Scene;
let lastBite = '';

export function initGrapple(s: THREE.Scene): void { scene = s; }
export const grappleState = (): State => state;
export const grappleOut = (): boolean => state !== 'ready';

function grapnel(): THREE.Group {
  const g = new THREE.Group();
  const iron = getProjectileMaterial('iron');
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 8), iron);
  shank.position.y = 0.13;
  g.add(shank);
  for (let i = 0; i < 4; i++) {
    const tine = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.011, 6, 12, Math.PI * 0.7), iron);
    tine.rotation.set(0, (i / 4) * Math.PI * 2, Math.PI * 1.15);
    tine.position.set(0, 0.06, 0);
    g.add(tine);
  }
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 12), iron);
  eye.position.y = 0.27;
  g.add(eye);
  g.traverse(o => { o.castShadow = true; });
  return g;
}

function hand(out: Vec3): Vec3 {
  const e = player.e!;
  return vec3.set(out, e.curPos[0], e.curPos[1] + HARNESS_H, e.curPos[2]) as Vec3;
}

/** LMB press with nothing out: throw the hook. */
export function grappleFire(eye: Vec3, fwd: Vec3, muzzle: Vec3, pv: Vec3): string | null {
  if (state !== 'ready') return null;
  vec3.copy(pos, muzzle);
  vec3.copy(prev, muzzle);
  vec3.set(vel, fwd[0] * GRAPPLE.speed + pv[0], fwd[1] * GRAPPLE.speed + pv[1], fwd[2] * GRAPPLE.speed + pv[2]);
  paid = 0;
  state = 'flying';
  if (!mesh) { mesh = grapnel(); scene.add(mesh); }
  mesh.visible = true;
  if (vis < 0) vis = gfx.add('fibre', LINES.dyneema.d / 2, LINES.dyneema.color);
  audio.grapple(muzzle);
  void eye;
  return null;
}

/* ---------------- purchase ---------------- */

const _mn: Vec3 = [0, 0, 0], _mx: Vec3 = [0, 0, 0], _lp: Vec3 = [0, 0, 0], _ln: Vec3 = [0, 0, 0], _w: Vec3 = [0, 0, 0];

/* The hook has struck `p` at `point` (face normal `n`): what it can hold on by. */
function purchase(p: Piece, point: Vec3, n: Vec3): { bite: Bite | null; slide: boolean; what: string; at?: Vec3 } {
  localBounds(p, _mn, _mx);
  b3.b3Body_GetLocalPoint(_lp, p.body, point);
  b3.b3Body_GetLocalVector(_ln, p.body, n);
  const dims = [_mx[0] - _mn[0], _mx[1] - _mn[1], _mx[2] - _mn[2]];
  const s = [...dims].sort((x, y) => x - y);
  // a post, tube or rail the tines close round, or an open section (I, H, channel, lattice) whose flanges they hook
  const open = fillOf(p) < 0.6;
  if (s[2] >= 2.5 * s[1] && (s[1] <= 0.15 || (open && s[1] <= 0.8))) {
    // the member's long axis, in its own frame: the hook seats against a pull across it
    const long = dims.indexOf(s[2]);
    const ax: Vec3 = [0, 0, 0];
    ax[long] = 1;
    if (s[1] <= 0.15) return { bite: { cap: Math.min(GRAPPLE.cap, edgeCap(p.mat) * 2), n: null, e: null, slip: 0, axis: ax }, slide: false, what: 'round the member' };
    // on an open section one tine hooks the nearest flange tip (a corner of the section), and bears alone: rated as
    // one tine on that edge, not the whole hook
    const at: Vec3 = [..._lp];
    for (let i = 0; i < 3; i++) if (i !== long) at[i] = _lp[i] - _mn[i] < _mx[i] - _lp[i] ? _mn[i] : _mx[i];
    return { bite: { cap: Math.min(GRAPPLE.tine, edgeCap(p.mat)), n: null, e: null, slip: 0, axis: ax }, slide: false, what: 'on the flange', at };
  }
  if (p.rebars.length) return { bite: { cap: GRAPPLE.cap, n: null, e: null, slip: 0 }, slide: false, what: 'on the exposed rebar' };
  // the face it struck, and how near the hit is to that face's nearest edge
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(_ln[i]) > Math.abs(_ln[k])) k = i;
  let best = Infinity, e: Vec3 | null = null;
  for (let i = 0; i < 3; i++) {
    if (i === k) continue;
    const lo = _lp[i] - _mn[i], hi = _mx[i] - _lp[i];
    if (lo < best) { best = lo; e = [0, 0, 0]; e[i] = -1; }
    if (hi < best) { best = hi; e = [0, 0, 0]; e[i] = 1; }
  }
  const face: Vec3 = [0, 0, 0];
  face[k] = Math.sign(_ln[k]) || 1;
  if (best <= 0.3 && e) return { bite: { cap: edgeCap(p.mat), n: face, e, slip: 0 }, slide: false, what: 'over the edge' };
  if (n[1] > 0.6) return { bite: null, slide: true, what: 'on top' };
  return { bite: null, slide: false, what: '' };
}

/* A hook on a member seats while the line pulls square across it (within ~20 degrees: steel on steel slides past that). */
function seated(b: Bite, p: Piece, from: Vec3, to: Vec3): boolean {
  if (!b.axis) return true;
  vec3.sub(_w, to, from);
  vec3.normalize(_w, _w);
  b3.b3Body_GetWorldVector(_ln, p.body, b.axis);
  return Math.abs(vec3.dot(_w, _ln)) <= SEAT;
}

/* Pulled along the member, the hook runs along it toward the pull until something stops it: past the member's end,
   another piece within reach (a joint, a cross member, a floor) holds it; nothing there and it comes off the end. */
function slideAlong(hk: NonNullable<typeof hook>, dt: number): 'held' | 'sliding' | 'off' {
  const ax = hk.bite!.axis!;
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(ax[i]) > Math.abs(ax[k])) k = i;
  localBounds(hk.piece, _mn, _mx);
  vec3.sub(_w, _h, _hk);
  b3.b3Body_GetLocalVector(_w, hk.piece.body, _w);
  const dir = Math.sign(_w[k]) || -1;
  hk.local[k] += dir * Math.min(3 * dt, 0.2);
  const end = dir > 0 ? _mx[k] : _mn[k];
  if (dir > 0 ? hk.local[k] < end : hk.local[k] > end) {
    b3.b3Joint_SetLocalFrameB(joint!, { position: hk.local, quaternion: [0, 0, 0, 1] });
    return 'sliding';
  }
  hk.local[k] = end;
  b3.b3Joint_SetLocalFrameB(joint!, { position: hk.local, quaternion: [0, 0, 0, 1] });
  // what is beyond the end: a stop, or thin air
  const at = anchorWorld([0, 0, 0], { piece: hk.piece, local: hk.local });
  b3.b3Body_GetWorldVector(_ln, hk.piece.body, [k === 0 ? dir : 0, k === 1 ? dir : 0, k === 2 ? dir : 0]);
  const hit = raycast(at, [_ln[0] * 0.35, _ln[1] * 0.35, _ln[2] * 0.35], NO_HIT);
  return hit ? 'held' : 'off';
}

function holds(b: Bite, p: Piece, from: Vec3, to: Vec3): boolean {
  if (!b.n || !b.e) return true;
  vec3.sub(_w, to, from);
  vec3.normalize(_w, _w);
  b3.b3Body_GetWorldVector(_ln, p.body, b.n);
  const along = vec3.dot(_w, _ln);
  b3.b3Body_GetWorldVector(_ln, p.body, b.e);
  return !(along > 0.35 || vec3.dot(_w, _ln) < -0.2);
}

function makeJoint(p: Piece, local: Vec3, at: Vec3): b3JointId {
  const jd = b3.b3DefaultDistanceJointDef();
  jd.base.bodyIdA = ground;
  jd.base.localFrameA = { position: [at[0], at[1] - GROUND_Y, at[2]], quaternion: [0, 0, 0, 1] };
  jd.base.bodyIdB = p.body;
  jd.base.localFrameB = { position: local, quaternion: [0, 0, 0, 1] };
  jd.base.collideConnected = true;
  jd.length = len;
  jd.enableSpring = true;
  jd.hertz = 0;
  jd.enableLimit = true;
  jd.minLength = 0.05;
  jd.maxLength = len;
  jd.enableMotor = false;
  jd.maxMotorForce = GRAPPLE.pull;
  jd.motorSpeed = -GRAPPLE.reel;
  return b3.b3CreateDistanceJoint(world, jd);
}

const _h: Vec3 = [0, 0, 0], _hk: Vec3 = [0, 0, 0];

/* The grapnel's tines span ~22 cm: five rays over that disc, square to the flight, the first to strike wins (a thin
   column the centre ray would slip past still catches a tine). */
const SPAN = 0.11;
function sweep(from: Vec3, d: Vec3): ReturnType<typeof raycast> {
  const l = vec3.length(d);
  if (l < 1e-6) return null;
  const u: Vec3 = Math.abs(d[1]) < 0.9 * l ? [d[2], 0, -d[0]] : [1, 0, 0];
  vec3.normalize(u, u);
  const w: Vec3 = vec3.cross([0, 0, 0], d, u) as Vec3;
  vec3.normalize(w, w);
  let best: ReturnType<typeof raycast> = null;
  for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const o: Vec3 = [from[0] + (u[0] * a + w[0] * b) * SPAN, from[1] + (u[1] * a + w[1] * b) * SPAN, from[2] + (u[2] * a + w[2] * b) * SPAN];
    const h = raycast(o, d, NO_HIT);
    if (h && (!best || h.fraction < best.fraction)) best = h;
  }
  return best;
}

function strike(point: Vec3, n: Vec3, entity: Parameters<typeof pieceOf>[0]): void {
  const p = pieceOf(entity);
  vec3.copy(pos, point);
  if (!p || vehicleOf(p)) {
    // the ground, or a vehicle's panels: nothing to bite; it drops where it lands
    state = 'loose';
    audio.hookBite(point, p ? 'metal' : 'ground');
    toolHooks.notify('No purchase — hold LMB to reel the hook back');
    return;
  }
  const pr = purchase(p, point, n);
  audio.hookBite(point, p.pm.surface);
  fx.sparks(point, n, Number.isFinite(p.pm.toughness) ? 2 : 6);
  if (!pr.bite && !pr.slide) {
    state = 'loose';
    vec3.set(vel, n[0] * 1.5, 0, n[2] * 1.5);
    toolHooks.notify('It skittered off the face — no edge or member to catch');
    return;
  }
  const local: Vec3 = pr.at ?? [0, 0, 0];
  if (!pr.at) b3.b3Body_GetLocalPoint(local, p.body, point);
  hook = { piece: p, local, bite: pr.bite, slide: pr.slide, n: [...n] };
  len = Math.min(GRAPPLE.line, vec3.distance(hand(_h), point) + 0.3);
  joint = makeJoint(p, local, _h);
  limitOn = true;
  state = 'hooked';
  lastBite = pr.what;
  hitmarker(0.35);
  toolHooks.notify(pr.slide ? 'Hook down on top — reel in and it will drag back to catch the edge' : `Hooked ${pr.what} — hold LMB to reel in`);
}

/* ---------------- stepping ---------------- */

/** Per step before the solver: the hook's flight, the reel. `held`: LMB down with the launcher in hand. */
export function grapplePreStep(held: boolean, dt: number): void {
  heldNow = held;
  if (state === 'ready') return;
  if (!player.e || player.locked) { cut(); return; }
  hand(_h);
  if (state === 'flying') {
    vec3.copy(prev, pos);
    vel[1] -= 9.81 * dt;
    const hit = sweep(pos, [vel[0] * dt, vel[1] * dt, vel[2] * dt]);
    if (hit) { strike(hit.point as Vec3, hit.normal as Vec3, hit.entity); return; }
    vec3.scaleAndAdd(pos, pos, vel, dt);
    paid = vec3.distance(pos, _h);
    if (paid > GRAPPLE.line) {
      // out of line: it comes up short and drops
      state = 'loose';
      vec3.set(vel, 0, 0, 0);
      toolHooks.notify(`Out of line at ${GRAPPLE.line} m`);
    }
    return;
  }
  if (state === 'loose') {
    // falls to the ground, then the reel drags it back along it
    const down = raycast(pos, [0, -Math.max(0.05, -vel[1] * dt + 0.05), 0], NO_HIT);
    if (!down) { vel[1] -= 9.81 * dt; pos[0] += vel[0] * dt; pos[1] += vel[1] * dt; pos[2] += vel[2] * dt; }
    else { pos[1] = down.point[1] + 0.03; vel[0] = vel[1] = vel[2] = 0; }
    if (held) {
      const d = vec3.distance(pos, _h);
      if (d < 1.5) { stow(); return; }
      vec3.lerp(pos, pos, [_h[0], down ? pos[1] : _h[1], _h[2]], Math.min(1, (GRAPPLE.reel * dt) / d));
    }
    return;
  }
  // hooked
  const hk = hook!;
  if (hk.piece.dead || !joint || !b3.b3Joint_IsValid(joint)) { lose('The member the hook was on broke up'); return; }
  b3.b3Joint_SetLocalFrameA(joint, { position: [_h[0], _h[1] - GROUND_Y, _h[2]], quaternion: [0, 0, 0, 1] });
  const d = vec3.distance(_h, anchorWorld(_hk, { piece: hk.piece, local: hk.local }));
  // lying on top: the line drags it across toward the near edge, where it catches
  if (hk.slide && (held || tension > 200)) slideHook(hk, dt);
  /* The line's limit only holds what can move: on a member still built in, the operator's end of the line is his
     harness alone (its anchor here trails him by a step, and a rigid stop against a welded member would read his
     every sway as kilonewtons). */
  const free = !hk.piece.welds.length && !hk.piece.hinged;
  if (free !== limitOn) { limitOn = free; b3.b3DistanceJoint_EnableLimit(joint, free); }
  const run = held && d > 1.1;
  if (run !== reeling) {
    reeling = run;
    b3.b3DistanceJoint_EnableMotor(joint, run);
    audio.reel(run, 0);
  }
  if (run) {
    /* On something that holds, the reel winds the line in at its speed while the pull it takes stays within the
       reel's rating: the line hauls the operator (off his feet once it lifts more than he weighs). On something
       loose the motor pulls it in instead and the line only follows it. */
    const stalled = harness.tension > GRAPPLE.pull * 1.05;
    const wind = free || stalled ? 0 : harness.speed * dt;
    len = Math.max(1.0, Math.min(len, d + 0.02) - wind);
    b3.b3DistanceJoint_SetLengthRange(joint, 0.05, len);
    b3.b3Joint_WakeBodies(joint);
  }
}

function slideHook(hk: NonNullable<typeof hook>, dt: number): void {
  localBounds(hk.piece, _mn, _mx);
  // toward the operator, in the top face's plane, in the member's frame
  vec3.sub(_w, _h, _hk);
  b3.b3Body_GetLocalVector(_w, hk.piece.body, _w);
  b3.b3Body_GetLocalVector(_ln, hk.piece.body, hk.n);
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(_ln[i]) > Math.abs(_ln[k])) k = i;
  _w[k] = 0;
  const l = vec3.length(_w);
  if (l < 1e-3) return;
  const step = GRAPPLE.reel * 0.5 * dt;
  let edge = -1, sgn = 0;
  for (let i = 0; i < 3; i++) {
    if (i === k) continue;
    hk.local[i] += (_w[i] / l) * step;
    if (hk.local[i] >= _mx[i] - 0.02) { hk.local[i] = _mx[i] - 0.02; edge = i; sgn = 1; }
    if (hk.local[i] <= _mn[i] + 0.02) { hk.local[i] = _mn[i] + 0.02; edge = i; sgn = -1; }
  }
  b3.b3Joint_SetLocalFrameB(joint!, { position: hk.local, quaternion: [0, 0, 0, 1] });
  if (edge >= 0) {
    const e: Vec3 = [0, 0, 0]; e[edge] = sgn;
    const n: Vec3 = [0, 0, 0]; n[k] = Math.sign(_ln[k]) || 1;
    hk.slide = false;
    hk.bite = { cap: edgeCap(hk.piece.mat), n, e, slip: 0 };
    lastBite = 'over the edge';
    audio.hookBite(anchorWorld(_hk, { piece: hk.piece, local: hk.local }), hk.piece.pm.surface);
    toolHooks.notify('It caught the edge');
  }
}

/** After each step: what the line carries, what the hook and the operator's grip make of it, the harness for the next
 *  step's mover. */
export function grappleAfterStep(dt: number): void {
  if (state !== 'hooked' || !hook || !joint || !player.e) { harness.on = false; return; }
  if (!b3.b3Joint_IsValid(joint) || hook.piece.dead) { lose('The member the hook was on broke up'); return; }
  const f: Vec3 = [0, 0, 0];
  b3.b3Joint_GetConstraintForce(f, joint);
  const F = vec3.length(f);
  // the line carries the larger of what the piece pulls and what the operator hangs or swings on it
  tension = Math.max(F, harness.tension);
  hand(_h);
  anchorWorld(_hk, { piece: hook.piece, local: hook.local });
  // the operator's side of the line: the reel's pull on him when it stalls on something that holds
  harness.on = true;
  vec3.copy(harness.at, _hk);
  // a fall onto the line slipped the reel's clutch last step: the line it paid out stays out
  if (harness.slipped) { harness.slipped = false; len = Math.min(GRAPPLE.line, Math.max(len, harness.len)); b3.b3DistanceJoint_SetLengthRange(joint, 0.05, len); }
  harness.len = len;
  harness.slip = GRAPPLE.clutch;
  // the reel's pull on him: while it runs, or while something loose hangs on the line; hanging still, only his weight
  const free = !hook.piece.welds.length && !hook.piece.hinged;
  harness.pull = free && F > 50 ? Math.min(F, GRAPPLE.clutch) : 0;
  // the drum slows under load (a powered ascender's full speed is with a light load)
  harness.speed = GRAPPLE.reel * (1 - 0.5 * clamp(F / GRAPPLE.pull, 0, 1));
  // his weight on the line pulls on what it is hooked to
  if (harness.tension > 60) {
    vec3.sub(_w, _h, _hk);
    vec3.normalize(_w, _w);
    b3.b3Body_ApplyForce(hook.piece.body, [_w[0] * harness.tension, _w[1] * harness.tension, _w[2] * harness.tension], _hk, harness.tension > 400);
  }
  // a load falling away on the line: the slip clutch pays line out rather than drag the operator off his feet
  tugOver = F > GRAPPLE.clutch ? tugOver + 1 : 0;
  if (tugOver >= 3) {
    len = Math.min(GRAPPLE.line, len + 2.5 * dt);
    b3.b3DistanceJoint_SetLengthRange(joint, 0.05, len);
    if (len >= GRAPPLE.line) { lose('The line ran off the drum'); return; }
  }
  const b = hook.bite;
  if (b?.axis) {
    const ok = seated(b, hook.piece, _hk, _h);
    if (!ok && tension > 150) {
      const r = slideAlong(hook, dt);
      if (r === 'off') { lose('The hook ran off the end of the member — it needs a pull across it, or a stop to catch on'); return; }
      if (r === 'held') b.axis = undefined;
    }
  }
  if (b) {
    if (tension > b.cap) {
      fx.impact(_hk, hook.n, hook.piece.mat, 0.4);
      lose(`The hook tore out of the ${hook.piece.mat} at ${(tension / 1000).toFixed(1)} kN`);
      return;
    }
    b.slip = tension > 150 && !holds(b, hook.piece, _hk, _h) ? b.slip + dt : 0;
    if (b.slip > 0.2) { lose('The hook skidded off the edge — the line has to run back over it'); return; }
  }
  if (reeling) audio.reel(true, clamp(F / GRAPPLE.pull, 0, 1));
}

/* ---------------- letting go ---------------- */

function dropJoint(): void {
  if (joint && b3.b3Joint_IsValid(joint)) b3.b3DestroyJoint(joint, true);
  joint = null;
  if (reeling) audio.reel(false, 0);
  reeling = false;
  harness.on = false;
  harness.pull = 0;
}

/* The hook has come free: it drops, and the reel can take it back. */
function lose(msg: string): void {
  if (hook) anchorWorld(pos, { piece: hook.piece, local: hook.local });
  dropJoint();
  hook = null;
  state = 'loose';
  vec3.set(vel, 0, 0, 0);
  toolHooks.notify(msg);
}

function stow(): void {
  dropJoint();
  hook = null;
  state = 'ready';
  if (mesh) mesh.visible = false;
  if (vis >= 0) { gfx.remove(vis); vis = -1; }
}

/** Put away: the line is dropped (switching tools, getting into a vehicle). */
export function cut(): void {
  if (state === 'ready') return;
  stow();
}

/** Wheel: pay line out (dir 1) or take it in a metre. */
export function grappleWheel(dir: number): string | null {
  if (state !== 'hooked' || !joint) return null;
  len = clamp(len + dir, 1, GRAPPLE.line);
  b3.b3DistanceJoint_SetLengthRange(joint, 0.05, len);
  b3.b3Joint_WakeBodies(joint);
  audio.ratchet(hand(_h), 0.2);
  return `${len.toFixed(0)} m of line out`;
}

/** RMB: make the line fast (to the vehicle aimed at, else a ground anchor at your feet); hanging in the air, let go. */
export function grappleSecondary(eye: Vec3, fwd: Vec3): boolean {
  if (state === 'ready') return false;
  if (state !== 'hooked' || !hook) { stow(); audio.ui('click'); return true; }
  if (!player.grounded) { lose('Let go of the line'); return true; }
  const hit = raycast(eye, [fwd[0] * 8, fwd[1] * 8, fwd[2] * 8], NO_HIT);
  const hp = hit ? pieceOf(hit.entity) : null;
  const veh = hp ? vehicleOf(hp) : null;
  let a: Anchor, what: string;
  let stake: THREE.Object3D | null = null;
  if (veh && hit) { a = anchorOn(veh.chassis, hit.point as Vec3); what = 'the vehicle'; }
  else {
    const feet: Vec3 = [player.e!.curPos[0], player.e!.curPos[1] + 0.12, player.e!.curPos[2]];
    a = anchorOn(null, feet);
    stake = makeStake(feet);
    what = 'a ground anchor';
  }
  const b: Anchor = { piece: hook.piece, local: [...hook.local], bite: hook.bite ?? { cap: GRAPPLE.cap, n: null, e: null, slip: 0 } };
  const rest = vec3.distance(anchorWorld(_h, a), anchorWorld(_hk, b)) + 0.1;
  dropJoint();
  makeLine('dyneema', 'grapple', a, b, rest, { stake });
  hook = null;
  state = 'ready';
  if (mesh) mesh.visible = false;
  if (vis >= 0) { gfx.remove(vis); vis = -1; }
  audio.chargeStick(anchorWorld(_h, a));
  toolHooks.notify(`Line made fast to ${what} — the launcher is free (the rigging kit casts it off)`);
  return true;
}

/* ---------------- per frame ---------------- */

const _e: Vec3 = [0, 0, 0], _p: Vec3 = [0, 0, 0], _m = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _hang = new Float32Array(17 * 3);
/** Once a frame: the grapnel where it is, the line from the launcher to it. */
export function syncGrapple(alpha: number): void {
  viewmodel.rig({ hook: state === 'ready', reel: reeling ? 40 : state === 'flying' ? 90 : state === 'loose' && heldNow ? 40 : 0 });
  if (state === 'ready' || !mesh || !player.e) return;
  eyePosition(_e, alpha);
  // the launcher's muzzle, where the viewmodel carries it: right of and below the eye, a half-metre out
  const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw), cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  const fx0 = -sy * cp, fy0 = sp, fz0 = -cy * cp, rx = cy, rz = -sy;
  const muzzle: Vec3 = [_e[0] + fx0 * 0.55 + rx * 0.2, _e[1] + fy0 * 0.55 - 0.16, _e[2] + fz0 * 0.55 + rz * 0.2];
  if (hook) interpPoint(_p, hook.piece, hook.local, alpha); else vec3.lerp(_p, prev, pos, state === 'flying' ? alpha : 1);
  mesh.position.set(_p[0], _p[1], _p[2]);
  /* A hook on a line hangs its shank along the line where the line leaves it: the line is made fast to the eye at the
     end of the shank, and the shank follows the line's own end tangent (with its sag), so the tines lie back over
     what they caught. */
  const d = vec3.distance(muzzle, _p);
  const rest = state === 'hooked' ? Math.max(len, d) : state === 'flying' ? d + 0.3 : d + 2;
  const T = state === 'hooked' ? tension : 0, w = LINES.dyneema.kg * 9.81;
  hangLine(_hang, muzzle, _p, rest, T, w, 16);
  _m.set(_hang[15 * 3] - _p[0], _hang[15 * 3 + 1] - _p[1], _hang[15 * 3 + 2] - _p[2]);
  if (_m.lengthSq() < 1e-8) _m.set(muzzle[0] - _p[0], muzzle[1] - _p[1], muzzle[2] - _p[2]);
  _m.normalize();
  mesh.quaternion.setFromUnitVectors(_up, _m);
  const eyeAt: Vec3 = [_p[0] + _m.x * 0.27, _p[1] + _m.y * 0.27, _p[2] + _m.z * 0.27];
  if (vis >= 0) gfx.set(vis, muzzle, eyeAt, Math.max(0.1, rest - 0.27), T, w, 0, 0.85, 0, false);
}

export function grappleStatus(): ToolReadout {
  const L = LINES.dyneema;
  switch (state) {
    case 'ready': return { title: 'Grapple launcher', progress: null, detail: `LMB throws the grapnel (${GRAPPLE.speed} m/s, ${GRAPPLE.line} m of 10 mm HMPE) · it bites round members, over edges, on rebar`, warn: false };
    case 'flying': return { title: 'Grapple launcher · line running out', progress: null, detail: `${paid.toFixed(0)} m out`, warn: false };
    case 'loose': return { title: 'Grapple launcher · no purchase', progress: null, detail: 'hold LMB to reel the hook back · RMB reels it in at once', warn: false };
    case 'hooked': {
      const hk = hook!;
      const cap = hk.bite ? hk.bite.cap : GRAPPLE.cap;
      return {
        title: `Grapple · hooked ${hk.slide ? 'on top (reel to catch the edge)' : lastBite}`,
        progress: clamp(tension / cap, 0, 1),
        detail: `${(tension / 1000).toFixed(1)} kN of ${(cap / 1000).toFixed(1)} kN purchase · ${len.toFixed(1)} m out · hold LMB reel (${GRAPPLE.pull / 1000} kN, ${GRAPPLE.reel} m/s) · wheel pay out/in · RMB make fast${player.grounded ? '' : ' / let go'}`,
        warn: tension > cap * 0.75,
        // the hook's working load: half its purchase (a design factor of 2 on a bite over an edge of unknown condition)
        lines: [{ label: 'HMPE', util: tension / L.mbl, wll: L.wll / L.mbl }, { label: 'hook', util: tension / cap, wll: 0.5 }],
      };
    }
  }
}

export function grappleDebug(): { state: State; len: number; tension: number; hook: Vec3 | null; bite: string } {
  return { state, len, tension, hook: hook ? anchorWorld([0, 0, 0], { piece: hook.piece, local: hook.local }) : state === 'ready' ? null : [...pos], bite: lastBite };
}

export function clearGrapple(): void {
  stow();
  if (mesh) { scene.remove(mesh); mesh.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); mesh = null; }
  harness.on = false;
  state = 'ready';
}
