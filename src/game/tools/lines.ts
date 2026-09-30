import * as THREE from 'three';
import { vec3, clamp } from 'math';
import type { b3JointId } from 'box3d.js';
import type { Vec3 } from '../../types';
import { b3, world, ground } from '../../physics/physics';
import type { Piece } from '../../destruction/structure';
import { vehicleOf } from '../../vehicles/vehicle';
import { lines as gfx, initLines, hangLine, type LineLook } from '../../render/ropes';
import { getProjectileMaterial } from '../../render/materials';
import { fx } from '../../render/fx';
import { tags } from '../../render/tags';
import { audio } from '../../audio/audio';
import { viewmodel } from '../../render/viewmodel';
import { player, addTrauma } from '../player';
import { hitstop } from '../timefx';
import { GROUND_Y, interpPoint, nearestPiece, toolHooks } from './common';

/* Rigging lines: steel wire rope, fibre rope and chain made fast between two things (a member, a vehicle, the ground).
   A line is a tension-only distance constraint. Wire and chain hold rigidly at their length (their elastic stretch is
   a percent or less); fibre rope is sprung by its own axial stiffness EA/L, so a nylon kinetic rope stretches a
   quarter of its length and stores the energy a vehicle's run-up puts into it. Every line reports its tension against
   its minimum breaking load; worked near that, it frays at its weak spot, and past it, it parts: the stored strain
   energy U = T²L/2EA throws both halves back past their anchors (snap-back), which is what kills riggers. */

export type LineKind = 'wire13' | 'wire16' | 'nylon' | 'dyneema' | 'chain10' | 'chain13';
export type CutTool = 'grinder' | 'saw' | 'shears' | 'plasma' | 'torch';

export interface LineSpec {
  name: string;
  look: LineLook;
  /** nominal diameter, m */
  d: number;
  /** minimum breaking load, N */
  mbl: number;
  /** working load limit, N */
  wll: number;
  /** axial stiffness EA, N (secant to the breaking load) */
  ea: number;
  /** mass, kg/m */
  kg: number;
  /** strain at the breaking load */
  stretch: number;
  /** stretchy enough to store a vehicle's run-up and snatch (nylon, HMPE); wire and chain are stiff */
  spring: boolean;
  color: number;
  /** seconds to cut through, per tool (missing: that tool won't) */
  cut: Partial<Record<CutTool, number>>;
}

const G = 9.81;
/* Wire rope: 6×36 WS IWRC, 1960 grade (13 mm 117.9 kN, 0.691 kg/m; 16 mm 178.6 kN, 1.047 kg/m), apparent modulus
   ~58.8 GPa on the nominal area (EA 7.81 / 11.83 MN), ~1.5 % elastic stretch at break. Nylon kinetic rope 7/8": 127 kN,
   ~20 % stretch in use, ~30 % at break (secant EA from that). HMPE (Dyneema) 3/8" winch line: 78.3 kN, 0.051 kg/m,
   0.96 % at 30 % of break. Grade 80 chain (EN 818-2): 10 mm WLL 3.15 t / 126 kN / 2.2 kg/m, 13 mm 5.3 t / 212 kN /
   3.7 kg/m, practically inextensible below proof load (EA taken as both legs of a link, E 200 GPa, halved for the
   links' bending: 15.7 / 26.5 MN). Sources in docs/references/REFERENCES.md (rigging/*). */
export const LINES: Record<LineKind, LineSpec> = {
  wire13: { name: '13 mm wire rope', look: 'wire', d: 0.013, mbl: 117.9e3, wll: 23.6e3, ea: 7.81e6, kg: 0.691, stretch: 0.015, spring: false, color: 0x6e7378, cut: { grinder: 4, shears: 0.6, plasma: 2.5, torch: 6 } },
  wire16: { name: '16 mm wire rope', look: 'wire', d: 0.016, mbl: 178.6e3, wll: 35.7e3, ea: 11.83e6, kg: 1.047, stretch: 0.015, spring: false, color: 0x7a8085, cut: { grinder: 6, shears: 0.8, plasma: 3.5, torch: 8 } },
  nylon: { name: '22 mm nylon kinetic rope', look: 'fibre', d: 0.022, mbl: 127.2e3, wll: 25.4e3, ea: 424e3, kg: 0.25, stretch: 0.3, spring: true, color: 0xd9a21b, cut: { grinder: 1.2, saw: 0.8, shears: 0.4, plasma: 1, torch: 1.5 } },
  dyneema: { name: '10 mm HMPE line', look: 'fibre', d: 0.0095, mbl: 78.3e3, wll: 15.7e3, ea: 2.72e6, kg: 0.051, stretch: 0.035, spring: true, color: 0xe1e3df, cut: { grinder: 0.6, saw: 0.4, shears: 0.3, plasma: 0.5, torch: 0.6 } },
  chain10: { name: '10 mm G80 chain', look: 'chain', d: 0.010, mbl: 126e3, wll: 30.9e3, ea: 15.7e6, kg: 2.2, stretch: 0.2, spring: false, color: 0x2e3033, cut: { grinder: 7, shears: 1, plasma: 4, torch: 9 } },
  chain13: { name: '13 mm G80 chain', look: 'chain', d: 0.013, mbl: 212e3, wll: 52e3, ea: 26.5e6, kg: 3.7, stretch: 0.2, spring: false, color: 0x7a1c16, cut: { grinder: 10, shears: 1.4, plasma: 5, torch: 12 } },
};

/** A grapple's purchase on what it caught: it holds up to `cap` N, and a hook over an edge only while the line runs
 *  over that edge (local face normal n, edge outward e). */
export interface Bite { cap: number; n: Vec3 | null; e: Vec3 | null; slip: number }

export interface Anchor {
  /** the member or vehicle chassis it is made fast to; null for a ground anchor */
  piece: Piece | null;
  /** body-local on the piece, world for the ground */
  local: Vec3;
  bite?: Bite;
}

export type LineOwner = 'tether' | 'hoist' | 'grapple' | 'winch';
export type GoneWhy = 'break' | 'cut' | 'rip' | 'slip' | 'loose' | 'off';

export interface Line {
  kind: LineKind;
  spec: LineSpec;
  owner: LineOwner;
  a: Anchor;
  b: Anchor;
  joint: b3JointId;
  /** unstretched length paid out, m */
  rest: number;
  /** parts of line through blocks (drawn side by side, each carrying the tension) */
  parts: number;
  /** tension in each part, N */
  tension: number;
  peak: number;
  over: number;
  /** 0..1 broken wires / cut yarns: grows while worked above ~70 % of the breaking load, costs up to 15 % of strength */
  fray: number;
  pa: Vec3;
  pb: Vec3;
  vis: number[];
  stake: THREE.Object3D | null;
  dead: boolean;
  /** an owner that drives the joint itself (the winch's motor) builds it: the same def, its motor set */
  make: ((L: Line) => b3JointId) | null;
  onGone: ((why: GoneWhy) => void) | null;
  creakT: number;
}

let scene: THREE.Scene;
export const rig: Line[] = [];
let t = 0;

export function initRigging(s: THREE.Scene): void {
  scene = s;
  initLines(s);
}

/* ---------------- anchors ---------------- */

/** A ground anchor: a driven steel picket with an eye (drawn), made fast at `at` (world). */
export function makeStake(at: Vec3, big = false): THREE.Object3D {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(big ? 0.05 : 0.03, 0.025, 0.9, 8), getProjectileMaterial('iron'));
  post.position.y = -0.35;
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 14), getProjectileMaterial('iron'));
  eye.position.y = 0.12;
  g.add(post, eye);
  if (big) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.28, 14), getProjectileMaterial('rocket'));
    drum.rotation.z = Math.PI / 2;
    drum.position.y = 0.05;
    g.add(drum);
  }
  g.traverse(o => { o.castShadow = true; });
  g.position.set(at[0], at[1] - 0.1, at[2]);
  scene.add(g);
  return g;
}

export function dropStake(o: THREE.Object3D | null): void {
  if (!o) return;
  scene.remove(o);
  o.traverse(m => { if (m instanceof THREE.Mesh) m.geometry.dispose(); });
}

export function anchorWorld(out: Vec3, a: Anchor): Vec3 {
  if (!a.piece) return vec3.copy(out, a.local) as Vec3;
  return b3.b3Body_GetWorldPoint(out, a.piece.body, a.local) as Vec3;
}

export function anchorOn(piece: Piece | null, point: Vec3): Anchor {
  if (!piece) return { piece: null, local: [...point] };
  const local: Vec3 = [0, 0, 0];
  b3.b3Body_GetLocalPoint(local, piece.body, point);
  return { piece, local };
}

/* ---------------- lines ---------------- */

function effMass(L: Line): number {
  const ma = L.a.piece ? L.a.piece.mass : Infinity, mb = L.b.piece ? L.b.piece.mass : Infinity;
  return 1 / (1 / ma + 1 / mb);
}

/* Every line is a tension-only spring of its own axial stiffness EA/L (an upper spring-force bound of 0 lets it go
   slack) with a hard stop at its breaking elongation. Held rigid, a wire rope would stop a moving lorry within one
   step and read a snatch of hundreds of kN; its real ~1.5 % stretch at break is what spreads that over a fraction of a
   second (F = v·√(k·m)). Nylon's 30 % makes it a kinetic rope. Box3D's soft spring takes a frequency against the
   joint's effective mass; above ~30 Hz it is held at 30 Hz for the solver (softer than the real rope only on light
   pieces). collideConnected keeps what is tied colliding with what it is tied to. */
export function lineJointDef(L: Line): ReturnType<typeof b3.b3DefaultDistanceJointDef> {
  const jd = b3.b3DefaultDistanceJointDef();
  jd.base.bodyIdA = L.a.piece ? L.a.piece.body : ground;
  jd.base.localFrameA = { position: L.a.piece ? L.a.local : [L.a.local[0], L.a.local[1] - GROUND_Y, L.a.local[2]], quaternion: [0, 0, 0, 1] };
  jd.base.bodyIdB = L.b.piece ? L.b.piece.body : ground;
  jd.base.localFrameB = { position: L.b.piece ? L.b.local : [L.b.local[0], L.b.local[1] - GROUND_Y, L.b.local[2]], quaternion: [0, 0, 0, 1] };
  jd.base.collideConnected = true;
  jd.length = L.rest;
  jd.enableSpring = true;
  // the spring's force is negative in tension: no upper (compressive) force leaves a tension-only line
  jd.lowerSpringForce = -1e12;
  jd.upperSpringForce = 0;
  jd.dampingRatio = L.spec.stretch > 0.1 ? 0.3 : 0.1;   // nylon soaks up a good share of each stretch as heat
  jd.hertz = springHz(L);
  jd.enableLimit = true;
  jd.minLength = 0.05;
  jd.maxLength = L.rest * (1 + L.spec.stretch * 1.15);
  jd.enableMotor = false;
  return jd;
}

function makeJoint(L: Line): b3JointId {
  return L.make ? L.make(L) : b3.b3CreateDistanceJoint(world, lineJointDef(L));
}

function springHz(L: Line): number {
  const k = (L.spec.ea * L.parts) / Math.max(0.2, L.rest);
  const m = effMass(L);
  return Math.min(30, Math.sqrt(k / (Number.isFinite(m) ? m : 1e6)) / (2 * Math.PI));
}

/** Make a line fast between a and b with `rest` metres paid out. `make` builds the joint for an owner that drives it. */
export function makeLine(kind: LineKind, owner: LineOwner, a: Anchor, b: Anchor, rest: number, opts: { parts?: number; make?: (L: Line) => b3JointId; stake?: THREE.Object3D | null; onGone?: (why: GoneWhy) => void } = {}): Line {
  const spec = LINES[kind];
  const L: Line = {
    kind, spec, owner, a, b, joint: null!, rest, parts: opts.parts ?? 1, tension: 0, peak: 0, over: 0, fray: 0,
    pa: [0, 0, 0], pb: [0, 0, 0], vis: [], stake: opts.stake ?? null, dead: false, make: opts.make ?? null, onGone: opts.onGone ?? null, creakT: -9,
  };
  L.joint = makeJoint(L);
  anchorWorld(L.pa, a);
  anchorWorld(L.pb, b);
  setParts(L, L.parts);
  rig.push(L);
  return L;
}

/** Reeve through more or fewer blocks: one drawn strand per part. */
export function setParts(L: Line, n: number): void {
  L.parts = n;
  while (L.vis.length < n) L.vis.push(gfx.add(L.spec.look, L.spec.d / 2, L.spec.color));
  while (L.vis.length > n) gfx.remove(L.vis.pop()!);
}

/** Pay the line in (or out) to `rest` m: the ratchet that holds what a hoist or a truck has won. */
export function setRest(L: Line, rest: number): void {
  L.rest = Math.max(0.3, rest);
  if (!b3.b3Joint_IsValid(L.joint)) return;
  b3.b3DistanceJoint_SetLength(L.joint, L.rest);
  b3.b3DistanceJoint_SetLengthRange(L.joint, 0.05, L.rest * (1 + L.spec.stretch * 1.15));
  b3.b3DistanceJoint_SetSpringHertz(L.joint, springHz(L));
  b3.b3Joint_WakeBodies(L.joint);
}

/** Re-make the joint to a new end (a rehook onto the fragment that holds the eye, a hitch onto a vehicle); `make`
 *  swaps the joint builder (a stake winch's motor off for a truck's pull). */
export function reanchor(L: Line, which: 'a' | 'b', to: Anchor, rest = L.rest, make: ((L: Line) => b3JointId) | null | undefined = undefined): void {
  if (b3.b3Joint_IsValid(L.joint)) b3.b3DestroyJoint(L.joint, true);
  L[which] = to;
  L.rest = rest;
  if (make !== undefined) L.make = make;
  L.joint = makeJoint(L);
  anchorWorld(L.pa, L.a);
  anchorWorld(L.pb, L.b);
}

/* The member an eye was on broke up under the pull: the fragment that now holds the eye takes the line (a hook's
   purchase went with the member, a vehicle's wreck doesn't take a line). */
function rehook(L: Line): boolean {
  const deadA = !!L.a.piece?.dead, deadB = !!L.b.piece?.dead;
  if (deadA === deadB) return false;
  const w = deadA ? 'a' : 'b';
  const e = L[w];
  if (e.bite || vehicleOf(e.piece)) return false;
  const at = w === 'a' ? L.pa : L.pb;
  const q = nearestPiece(at, 0.6);
  if (!q || q.volume < 0.02 || q === L[w === 'a' ? 'b' : 'a'].piece) return false;
  reanchor(L, w, anchorOn(q, at), Math.max(0.3, Math.min(L.rest, vec3.distance(L.pa, L.pb) + 0.05)));
  return true;
}

export function currentLength(L: Line): number {
  return vec3.distance(anchorWorld(L.pa, L.a), anchorWorld(L.pb, L.b));
}

/** Strain energy in the line at tension T (J): U = T²L/2EA over the parts. */
export function strainEnergy(L: Line, T = L.tension): number {
  return (T * T * L.rest * L.parts) / (2 * L.spec.ea);
}

/** Effective breaking load: broken wires and cut yarns take their share (ISO 4309 discards a rope long before that). */
export const breakLoad = (L: Line): number => L.spec.mbl * (1 - 0.15 * L.fray);

/* ---------------- parting ---------------- */

const _h: Vec3 = [0, 0, 0], _q: Vec3 = [0, 0, 0];

/* Distance from p to the segment a→b. */
function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l2 = dx * dx + dy * dy + dz * dz;
  const s = l2 > 1e-9 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - dx * s, p[1] - a[1] - dy * s, p[2] - a[2] - dz * s);
}

/** Recoil speed of a parted line's free end: the strain wave's particle speed, v = T/√(EA·μ). */
export const recoilSpeed = (L: Line, T: number): number => T / Math.sqrt(L.spec.ea * L.spec.kg);

/** Radius round the recoil path inside which a parting line is dangerous, m (grows with the energy let go). */
export const snapZone = (U: number): number => clamp(0.8 + 0.5 * Math.sqrt(U / 1000), 0.8, 4.5);

/* Where a line parts: at its weak spot, 15 % in from the load end (the eye or splice, where lines usually go). */
const PART_AT = 0.85;

/* The line lets go: both halves run back past their anchors at the recoil speed. Anyone standing in their path is hit
   by what the line carries: a share of the strain energy, felt as a shove the mover turns into a stagger or a
   knockdown. */
function snapBack(L: Line, T: number): void {
  const U = strainEnergy(L, T);
  const v = recoilSpeed(L, T);
  const brk: Vec3 = [L.pa[0] + (L.pb[0] - L.pa[0]) * PART_AT, L.pa[1] + (L.pb[1] - L.pa[1]) * PART_AT, L.pa[2] + (L.pb[2] - L.pa[2]) * PART_AT];
  for (const id of L.vis) gfx.snap(id, L.pa, L.pb, PART_AT, v);
  L.vis.length = 0;
  if (L.spec.look === 'chain') audio.ropeSnap(brk, 'chain');
  else if (L.spec.look === 'wire') { audio.ropeSnap(brk, 'wire'); audio.snap(brk, clamp(U / 20e3, 0.3, 1)); }
  else audio.ropeSnap(brk, 'rope');
  fx.sparks(brk, [0, 1, 0], L.spec.look === 'fibre' ? 0 : 14);
  if (!player.e) return;
  const chest: Vec3 = [player.e.curPos[0], player.e.curPos[1] + 1.1, player.e.curPos[2]];
  let worst = 0;
  for (const [end, share] of [[L.pa, PART_AT], [L.pb, 1 - PART_AT]] as [Vec3, number][]) {
    // the half runs from the break back to its anchor and a quarter of its length beyond it
    vec3.lerp(_q, brk, end, 1.25);
    const d = segDist(chest, brk, _q);
    const r = snapZone(U * share);
    if (d < r) worst = Math.max(worst, U * share * (1 - d / r) ** 2);
  }
  const dist = Math.hypot(chest[0] - brk[0], chest[1] - brk[1], chest[2] - brk[2]);
  if (worst > 50) {
    /* a whipping line lays its energy into what it strikes over a short length: a few percent reaches the body */
    const E = worst * 0.04;
    const dv = Math.min(14, Math.sqrt((2 * E) / 90));
    vec3.sub(_h, chest, brk);
    _h[1] = Math.abs(_h[1]) + 0.5;
    vec3.normalize(_h, _h);
    const vel: Vec3 = [0, 0, 0];
    b3.b3Body_GetLinearVelocity(vel, player.e.body);
    b3.b3Body_SetLinearVelocity(player.e.body, [vel[0] + _h[0] * dv, vel[1] + _h[1] * dv, vel[2] + _h[2] * dv]);
    hitstop(0.08);
    addTrauma(clamp(0.3 + dv / 12, 0, 1));
    toolHooks.notify(`Snap-back! The ${L.spec.name} whipped through you at ${Math.round(v)} m/s — stand clear of loaded lines`);
  } else if (dist < 30) {
    hitstop(0.04);
    addTrauma(0.25 * (1 - dist / 30) * clamp(U / 20e3, 0.2, 1));
  }
}

/** Let the line go. Breaks and cuts under load snap back; the owner hears why. */
export function releaseLine(L: Line, why: GoneWhy): void {
  if (L.dead) return;
  L.dead = true;
  const T = L.tension * L.parts;
  if (b3.b3Joint_IsValid(L.joint)) b3.b3DestroyJoint(L.joint, true);
  // a line can't hold more than it breaks at: a solver spike on the parting step isn't energy it stored
  if ((why === 'break' || why === 'cut' || why === 'rip') && T > 0.02 * L.spec.mbl) snapBack(L, Math.min(L.tension, breakLoad(L) * 1.05));
  else {
    for (const id of L.vis) gfx.remove(id);
    L.vis.length = 0;
    if (why !== 'off') audio.cableCreak(L.pb, 0.3);
  }
  dropStake(L.stake);
  L.stake = null;
  const i = rig.indexOf(L);
  if (i >= 0) rig.splice(i, 1);
  if (why === 'break') toolHooks.notify(`${L.spec.name} parted at ${Math.round(L.peak / 1000)} kN (rated ${Math.round(L.spec.mbl / 1000)} kN to break)`);
  L.onGone?.(why);
}

/* ---------------- stepping ---------------- */

const _f: Vec3 = [0, 0, 0], _u: Vec3 = [0, 0, 0], _n: Vec3 = [0, 0, 0];

function alive(L: Line): boolean {
  return b3.b3Joint_IsValid(L.joint) && !(L.a.piece?.dead) && !(L.b.piece?.dead);
}

/* A hook over an edge holds while the line runs back over that edge; pulled the other way it skids off the face. */
function biteHolds(L: Line, end: Anchor, from: Vec3, to: Vec3): boolean {
  const bt = end.bite!;
  if (!bt.n || !bt.e || !end.piece) return true;
  vec3.sub(_u, to, from);
  vec3.normalize(_u, _u);
  b3.b3Body_GetWorldVector(_n, end.piece.body, bt.n);
  const along = vec3.dot(_u, _n);
  b3.b3Body_GetWorldVector(_n, end.piece.body, bt.e);
  const over = vec3.dot(_u, _n);
  return !(along > 0.35 || over < -0.2);
}

/** After each physics step: tensions, fraying, breaking, hooks losing their purchase, a fragment taking the eye. */
export function rigAfterStep(dt: number): void {
  if (!rig.length) return;
  t += dt;
  for (const L of [...rig]) {
    if (L.dead) continue;
    if (!alive(L) && !rehook(L)) { releaseLine(L, 'loose'); continue; }
    anchorWorld(L.pa, L.a);
    anchorWorld(L.pb, L.b);
    b3.b3Joint_GetConstraintForce(_f, L.joint);
    const F = vec3.length(_f);
    L.tension = F / L.parts;
    L.peak = Math.max(L.peak * Math.exp(-dt / 2), L.tension);
    const util = L.tension / L.spec.mbl;
    /* held past ~70 % of the breaking load, wires start to go (yarns cut through each other), and they stay broken:
       a second or two at the break load and the line has lost its reserve */
    if (util > 0.7) L.fray = Math.min(1, L.fray + dt * 0.8 * ((util - 0.7) / 0.3));
    /* two consecutive steps over the (worn) breaking load, so one solver contact spike doesn't part it; far over it (a
       falling mass brought up against the line's hard stop) it goes at once */
    L.over = L.tension > breakLoad(L) ? L.over + 1 : 0;
    if (L.over >= 2 || L.tension > 1.5 * breakLoad(L)) { L.peak = Math.min(L.peak, breakLoad(L) * 1.5); releaseLine(L, 'break'); continue; }
    for (const [end, from, to] of [[L.a, L.pa, L.pb], [L.b, L.pb, L.pa]] as [Anchor, Vec3, Vec3][]) {
      if (!end.bite) continue;
      if (F > end.bite.cap) { ripOut(L, end, from); break; }
      end.bite.slip = F > 200 && !biteHolds(L, end, from, to) ? end.bite.slip + dt : 0;
      if (end.bite.slip > 0.2) { releaseLine(L, 'slip'); toolHooks.notify('The hook skidded off — it needs an edge the line runs back over, or a member to wrap'); break; }
    }
    if (L.dead) continue;
    if (L.tension > 0.25 * L.spec.mbl && t - L.creakT > 0.9) {
      L.creakT = t;
      audio.cableCreak(L.pb, clamp(util, 0, 1));
    }
  }
}

function ripOut(L: Line, end: Anchor, at: Vec3): void {
  fx.impact(at, [0, 1, 0], end.piece?.mat ?? 'concrete', 0.5);
  toolHooks.notify(`The hook tore out of the ${end.piece?.mat ?? 'edge'} at ${Math.round((L.tension * L.parts) / 1000)} kN`);
  releaseLine(L, 'rip');
}

/* ---------------- cutting a line ---------------- */

interface Cutting { L: Line; tool: CutTool; done: number; at: Vec3; frame: number }
let cutting: Cutting | null = null;
let cutFrame = -9;
const _pts = new Float32Array(17 * 3);

/** The line (and where on it) the aim ray passes within ~12 cm of, inside `reach`. */
export function pickLine(eye: Vec3, fwd: Vec3, reach: number): { L: Line; at: Vec3; s: number } | null {
  let best: { L: Line; at: Vec3; s: number } | null = null, bd = 0.12;
  for (const L of rig) {
    if (L.dead) continue;
    hangLine(_pts, L.pa, L.pb, L.rest, L.tension, L.spec.kg * G, 16);
    for (let i = 0; i < 16; i++) {
      const a: Vec3 = [_pts[i * 3], _pts[i * 3 + 1], _pts[i * 3 + 2]], b: Vec3 = [_pts[i * 3 + 3], _pts[i * 3 + 4], _pts[i * 3 + 5]];
      // closest approach of the ray (eye + fwd·s, 0 < s < reach) and the segment
      const r = rayToSeg(eye, fwd, reach, a, b);
      if (r && r.d < bd) { bd = r.d; best = { L, at: r.p, s: r.s }; }
    }
  }
  return best;
}

function rayToSeg(o: Vec3, d: Vec3, reach: number, a: Vec3, b: Vec3): { d: number; p: Vec3; s: number } | null {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const wx = o[0] - a[0], wy = o[1] - a[1], wz = o[2] - a[2];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], B = d[0] * ux + d[1] * uy + d[2] * uz, C = ux * ux + uy * uy + uz * uz;
  const D = d[0] * wx + d[1] * wy + d[2] * wz, E = ux * wx + uy * wy + uz * wz;
  const den = A * C - B * B;
  let s = den > 1e-9 ? (B * E - C * D) / den : 0, u = den > 1e-9 ? (A * E - B * D) / den : 0;
  u = clamp(u, 0, 1);
  s = clamp((B * u - D) / A, 0, reach);
  if (s <= 0) return null;
  const p: Vec3 = [a[0] + ux * u, a[1] + uy * u, a[2] + uz * u];
  const dd = Math.hypot(o[0] + d[0] * s - p[0], o[1] + d[1] * s - p[1], o[2] + d[2] * s - p[2]);
  return { d: dd, p, s };
}

/** Held with a cutting tool: true when the aim is on a line (the tool works the line, not the member behind it). */
export function lineCutAim(tool: CutTool, eye: Vec3, fwd: Vec3, frame: number): string | null | false {
  const hit = pickLine(eye, fwd, tool === 'shears' ? 2.1 : 1.9);
  if (!hit) { if (cutting && cutting.frame < frame - 1) cutting = null; return false; }
  const secs = hit.L.spec.cut[tool];
  if (secs === undefined) return `A ${tool === 'saw' ? 'chainsaw' : tool} won't go through ${hit.L.spec.name}`;
  if (!cutting || cutting.L !== hit.L || cutting.tool !== tool) cutting = { L: hit.L, tool, done: 0, at: hit.at, frame };
  cutting.at = hit.at;
  cutting.frame = frame;
  cutFrame = frame;
  return null;
}

/** Per step: the cut advances while the tool is held on the line. A loaded line parts before the last strands are cut
 *  (what is left can't carry the load), and it parts with everything the load put into it. */
export function lineCutStep(dt: number, held: boolean, frame: number): void {
  const c = cutting;
  if (!c) return;
  if (c.L.dead) { cutting = null; return; }
  if (!held || cutFrame < frame - 1) return;
  const secs = c.L.spec.cut[c.tool] ?? 1e9;
  c.done += dt / secs;
  const util = (c.L.tension * c.L.parts) / breakLoad(c.L);
  if (c.done >= 1 - 0.8 * clamp(util, 0, 1)) {
    const T = c.L.tension * c.L.parts;
    cutting = null;
    toolHooks.notify(T > 5e3 ? `Cut through the ${c.L.spec.name} under ${Math.round(T / 1000)} kN — it snapped back` : `Cut the ${c.L.spec.name}`);
    releaseLine(c.L, 'cut');
  }
}

export function lineCutting(): { name: string; progress: number; tension: number } | null {
  if (!cutting || cutting.L.dead || cutFrame < 0) return null;
  return { name: cutting.L.spec.name, progress: cutting.done, tension: cutting.L.tension * cutting.L.parts };
}

/* ---------------- per frame ---------------- */

const _a: Vec3 = [0, 0, 0], _b: Vec3 = [0, 0, 0], _o: Vec3 = [0, 0, 0], _pa: Vec3 = [0, 0, 0], _pb: Vec3 = [0, 0, 0];
let cutSound = false;

function endPoint(out: Vec3, e: Anchor, alpha: number): Vec3 {
  if (!e.piece) return vec3.copy(out, e.local) as Vec3;
  return interpPoint(out, e.piece, e.local, alpha);
}

/** Once a frame: every line along its hanging shape, recoils running, the cutting tool's sparks and sound. */
export function syncRigging(alpha: number, dt: number, frame: number): void {
  gfx.begin(dt);
  for (const L of rig) {
    if (L.dead || !L.vis.length) continue;
    endPoint(_a, L.a, alpha);
    endPoint(_b, L.b, alpha);
    // reeved parts run side by side through the blocks, a hand's width apart
    vec3.sub(_o, _b, _a);
    vec3.set(_o, -_o[2], 0, _o[0]);
    vec3.normalize(_o, _o);
    L.vis.forEach((id, i) => {
      const s = (i - (L.vis.length - 1) / 2) * 0.12;
      vec3.scaleAndAdd(_pa, _a, _o, s);
      vec3.scaleAndAdd(_pb, _b, _o, s * 0.3);
      gfx.set(id, _pa, _pb, L.rest, L.tension, L.spec.kg * G, L.fray);
    });
  }
  gfx.flush();
  const c = cutting && !cutting.L.dead && cutFrame >= frame - 1 ? cutting : null;
  if (c) {
    const load = clamp((c.L.tension * c.L.parts) / c.L.spec.mbl, 0, 1);
    audio.powerTool(c.tool, c.at, 1, 0.3 + 0.5 * load);
    if (c.tool === 'grinder') fx.grindSparks(c.at, [0, -1, 0], 1, 0.6);
    else if (c.tool === 'plasma') fx.plasmaArc(c.at, [0, 1, 0], 1, c.done);
    else if (c.tool === 'torch') fx.torchFlame(c.at, [0, 1, 0], 1, true);
    viewmodel.work(true, load, 0.3, c.tool === 'shears' ? clamp(c.done, 0, 1) : 0, c.tool === 'torch');
    cutSound = true;
  } else if (cutSound) {
    cutSound = false;
    audio.powerTool('off', _a, 0, 0);
  }
}

/* Tension on each line where it can be read: kN and share of the breaking load, amber past 60 %, red past 85 %. */
export function rigTags(): void {
  for (const L of rig) {
    if (L.dead) continue;
    const u = (L.tension * L.parts) / (breakLoad(L) * L.parts);
    const col = u > 0.85 ? '#ff4d3d' : u > 0.6 ? '#ffb020' : '#8fd18f';
    const mid: Vec3 = [(L.pa[0] + L.pb[0]) / 2, (L.pa[1] + L.pb[1]) / 2 + 0.25, (L.pa[2] + L.pb[2]) / 2];
    tags.add(mid, `${Math.round((L.tension * L.parts) / 1000)} kN`, `${Math.round(u * 100)}%`, col, u > 0.85);
  }
}

/** The worst line whose snap-back zone the player is standing in, with how loaded it is. */
export function inSnapZone(): { L: Line; util: number } | null {
  if (!player.e) return null;
  const chest: Vec3 = [player.e.curPos[0], player.e.curPos[1] + 1.1, player.e.curPos[2]];
  let best: { L: Line; util: number } | null = null;
  for (const L of rig) {
    const util = L.tension / breakLoad(L);
    if (L.dead || util < 0.3) continue;
    vec3.lerp(_a, L.pb, L.pa, 1.25);
    vec3.lerp(_b, L.pa, L.pb, 1.25);
    if (segDist(chest, _a, _b) < snapZone(strainEnergy(L, breakLoad(L)) * 0.5) && (!best || util > best.util)) best = { L, util };
  }
  return best;
}

export function linesOf(owner: LineOwner): Line[] {
  return rig.filter(L => L.owner === owner && !L.dead);
}

export function clearRigging(): void {
  for (const L of [...rig]) {
    L.dead = true;
    if (b3.b3Joint_IsValid(L.joint)) b3.b3DestroyJoint(L.joint, false);
    dropStake(L.stake);
  }
  rig.length = 0;
  cutting = null;
  gfx.clear();
  if (cutSound) { cutSound = false; audio.powerTool('off', _a, 0, 0); }
}

export function rigDebug(): { kind: LineKind; owner: LineOwner; tension: number; rest: number; len: number; fray: number }[] {
  return rig.map(L => ({ kind: L.kind, owner: L.owner, tension: L.tension * L.parts, rest: L.rest, len: vec3.distance(L.pa, L.pb), fray: L.fray }));
}
