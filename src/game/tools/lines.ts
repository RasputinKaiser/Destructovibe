import * as THREE from 'three';
import { vec3, clamp } from 'math';
import type { b3JointId } from 'box3d.js';
import type { Vec3 } from '../../types';
import { b3, world, ground } from '../../physics/physics';
import type { Piece } from '../../destruction/structure';
import { vehicleOf } from '../../vehicles/vehicle';
import { lines as gfx, initLines, hangLine, setLineFloor, type LineLook } from '../../render/ropes';
import { groundAt } from '../../terrain/terrain';
import { getProjectileMaterial } from '../../render/materials';
import { fx } from '../../render/fx';
import { tags } from '../../render/tags';
import { audio } from '../../audio/audio';
import { viewmodel } from '../../render/viewmodel';
import { player, addTrauma, eyePosition } from '../player';
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
  /** share of the strain energy that comes back as recoil: all of it on wire rope; nylon's hysteresis soaks up a good
   *  part; HMPE on its own barely snaps back (MAIB, Zarga); a parting chain link is plastic and the chain just drops */
  recoil: number;
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
  wire13: { name: '13 mm wire rope', look: 'wire', d: 0.013, mbl: 117.9e3, wll: 23.6e3, ea: 7.81e6, kg: 0.691, stretch: 0.015, spring: false, color: 0x8d9093, recoil: 1, cut: { grinder: 4, shears: 0.6, plasma: 2.5, torch: 6 } },
  wire16: { name: '16 mm wire rope', look: 'wire', d: 0.016, mbl: 178.6e3, wll: 35.7e3, ea: 11.83e6, kg: 1.047, stretch: 0.015, spring: false, color: 0x9a9da0, recoil: 1, cut: { grinder: 6, shears: 0.8, plasma: 3.5, torch: 8 } },
  nylon: { name: '22 mm nylon kinetic rope', look: 'fibre', d: 0.022, mbl: 127.2e3, wll: 25.4e3, ea: 424e3, kg: 0.25, stretch: 0.3, spring: true, color: 0xd9a21b, recoil: 0.6, cut: { grinder: 1.2, saw: 0.8, shears: 0.4, plasma: 1, torch: 1.5 } },
  dyneema: { name: '10 mm HMPE line', look: 'fibre', d: 0.0095, mbl: 78.3e3, wll: 15.7e3, ea: 2.72e6, kg: 0.051, stretch: 0.035, spring: true, color: 0xe1e3df, recoil: 0.15, cut: { grinder: 0.6, saw: 0.4, shears: 0.3, plasma: 0.5, torch: 0.6 } },
  chain10: { name: '10 mm G80 chain', look: 'chain', d: 0.010, mbl: 126e3, wll: 30.9e3, ea: 15.7e6, kg: 2.2, stretch: 0.2, spring: false, color: 0x2e3033, recoil: 0.1, cut: { grinder: 7, shears: 1, plasma: 4, torch: 9 } },
  chain13: { name: '13 mm G80 chain', look: 'chain', d: 0.013, mbl: 212e3, wll: 52e3, ea: 26.5e6, kg: 3.7, stretch: 0.2, spring: false, color: 0x4a3a34, recoil: 0.1, cut: { grinder: 10, shears: 1.4, plasma: 5, torch: 12 } },
};

/** A grapple's purchase on what it caught: it holds up to `cap` N, and a hook over an edge only while the line runs
 *  over that edge (local face normal n, edge outward e). */
export interface Bite { cap: number; n: Vec3 | null; e: Vec3 | null; slip: number; axis?: Vec3 }

export interface Anchor {
  /** the member or vehicle chassis it is made fast to; null for a ground anchor */
  piece: Piece | null;
  /** body-local on the piece, world for the ground */
  local: Vec3;
  bite?: Bite;
  /** a ground anchor's holding power, N: past it the anchor ploughs out of the ground */
  hold?: number;
  over?: number;
}

/* What a ground anchor holds before it ploughs out. A single steel picket in loamy soil holds 300-700 lb (1.3-3.1 kN), a
   1-1-1 line of pickets lashed together 1,000-2,000 lb, a 3-2-1 picket holdfast about 4,000 lb (17.8 kN); a log deadman
   buried ~2 m in firm soil some 1,550-3,550 lb per foot of log, so ~120 kN for a 3 m log. */
export const GROUND = { picket: 17.8e3, deadman: 120e3 };

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
  /** chain only: plastic elongation of the links past proof load, 0..0.2 */
  plastic: number;
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

export const rigGfx = gfx;

export function initRigging(s: THREE.Scene): void {
  scene = s;
  initLines(s);
  setLineFloor(groundAt);
}

/* ---------------- anchors ---------------- */

/** A ground anchor, drawn: a 3-2-1 picket holdfast (three pickets lashed behind two behind one, the line on the front
 *  one's eye), or, `big`, a buried log deadman under a hydraulic winch on its frame with the petrol power pack that
 *  drives it. */
export function makeStake(at: Vec3, big = false): THREE.Object3D {
  const g = new THREE.Group();
  const iron = getProjectileMaterial('iron');
  const lash = new THREE.MeshStandardMaterial({ color: 0x8c7a55, roughness: 0.95 });
  if (!big) {
    // 3-2-1: rows 0.9 m apart going away from the pull (the line comes from +z in the group's frame)
    const rows = [[0], [-0.2, 0.2], [-0.35, 0, 0.35]];
    rows.forEach((xs, r) => xs.forEach(x => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.02, 0.5, 6), iron);
      post.position.set(x, 0.05, -r * 0.9);
      post.rotation.x = -0.26;
      g.add(post);
    }));
    for (let r = 0; r < 2; r++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.92, 5).rotateX(Math.PI / 2), lash);
      l.position.set(0, 0.12, -r * 0.9 - 0.45);
      g.add(l);
    }
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 14), iron);
    eye.position.y = 0.22;
    g.add(eye);
  } else {
    const olive = getProjectileMaterial('rocket');
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.5), iron);
    frame.position.y = 0.04;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.36, 18), olive);
    drum.rotation.z = Math.PI / 2;
    drum.position.y = 0.3;
    const wraps = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.3, 18), new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.5, metalness: 0.5 }));
    wraps.rotation.z = Math.PI / 2;
    wraps.position.y = 0.3;
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 12), iron);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(0.28, 0.3, 0);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.4), new THREE.MeshStandardMaterial({ color: 0xc99a1e, roughness: 0.6, metalness: 0.2 }));
    pack.position.set(0.1, 0.23, -0.9);
    const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.95, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 }));
    hose.position.set(0.25, 0.12, -0.45);
    // the deadman's tail: its sling coming out of the backfilled trench
    const trench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.03, 0.6), new THREE.MeshStandardMaterial({ color: 0x5b4634, roughness: 1 }));
    trench.position.set(0, 0.01, -1.8);
    g.add(frame, drum, wraps, motor, pack, hose, trench);
  }
  g.traverse(o => { o.castShadow = true; });
  // the line's eye (the front picket's, or the drum) sits at the anchor point
  g.position.set(at[0], at[1] - (big ? 0.3 : 0.22), at[2]);
  scene.add(g);
  return g;
}

/** Turn a ground anchor to face the line it holds. */
export function faceStake(o: THREE.Object3D | null, toward: Vec3): void {
  if (!o) return;
  o.rotation.y = Math.atan2(toward[0] - o.position.x, toward[2] - o.position.z);
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

export function anchorOn(piece: Piece | null, point: Vec3, hold = GROUND.picket): Anchor {
  if (!piece) return { piece: null, local: [...point], hold, over: 0 };
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
    kind, spec, owner, a, b, joint: null!, rest, parts: opts.parts ?? 1, tension: 0, peak: 0, over: 0, fray: 0, plastic: 0,
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

/** Recoil speed of a parted line's free end: the strain wave's particle speed, v = T/√(EA·μ), for the share of the
 *  energy that recoils, and never past what parted lines are reported to reach (wire ~500 km/h, synthetics ~800). */
export const recoilSpeed = (L: Line, T: number): number =>
  Math.min(L.spec.look === 'fibre' ? 222 : 139, (T / Math.sqrt(L.spec.ea * L.spec.kg)) * Math.sqrt(L.spec.recoil));

/** Radius round the recoil path inside which a parting line is dangerous where it parts, m (grows with the energy). */
export const snapZone = (U: number): number => clamp(0.8 + 0.5 * Math.sqrt(U / 1000), 0.8, 4.5);

const CONE = Math.tan((20 * Math.PI) / 180);
/* How far p is inside a half's recoil path: from the break back past its anchor to twice the half's length (a parted
   line can fly back almost its whole remaining length past where it is made fast), widening at ~20 degrees; 1 on the
   line, 0 at the edge. */
function inRecoil(p: Vec3, brk: Vec3, end: Vec3, r0: number): number {
  const dx = end[0] - brk[0], dy = end[1] - brk[1], dz = end[2] - brk[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-3) return 0;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  const px = p[0] - brk[0], py = p[1] - brk[1], pz = p[2] - brk[2];
  const along = px * ux + py * uy + pz * uz;
  if (along < -r0 || along > 2 * len) return 0;
  const lat = Math.hypot(px - ux * along, py - uy * along, pz - uz * along);
  const r = r0 + Math.max(0, along) * CONE;
  return lat < r ? 1 - lat / r : 0;
}

/* Where a line parts: at its weak spot, 15 % in from the load end (the eye or splice, where lines usually go). */
const PART_AT = 0.85;

/* The line lets go: both halves run back past their anchors at the recoil speed. Anyone standing in their path is hit
   by what the line carries: a share of the strain energy, felt as a shove the mover turns into a stagger or a
   knockdown. */
function snapBack(L: Line, T: number): void {
  const U = strainEnergy(L, T) * L.spec.recoil;
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
    const k = inRecoil(chest, brk, end, snapZone(U * share));
    worst = Math.max(worst, U * share * k * k);
  }
  const dist = Math.hypot(chest[0] - brk[0], chest[1] - brk[1], chest[2] - brk[2]);
  if (worst > 50) {
    /* a whipping line lays its energy into what it strikes over a short length: about a sixth of what the half carries
       reaches a body in its path, which for wire rope at its break is an incapacitating blow */
    const E = worst * 0.15;
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
  if (bt.axis && end.piece) {
    // a hook on a member, made fast: it holds while the line pulls across the member
    vec3.sub(_u, to, from);
    vec3.normalize(_u, _u);
    b3.b3Body_GetWorldVector(_n, end.piece.body, bt.axis);
    return Math.abs(vec3.dot(_u, _n)) <= 0.87;
  }
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
  t += dt;
  if (!rig.length) return;
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
    for (const end of [L.a, L.b]) {
      if (end.piece || !end.hold) continue;
      end.over = F > end.hold ? (end.over ?? 0) + dt : 0;
      if ((end.over ?? 0) > 0.3) {
        fx.dust(end.local, 0.8, 0x6b5a45);
        toolHooks.notify(`The ${end.hold >= GROUND.deadman ? 'deadman' : 'picket holdfast'} ploughed out of the ground at ${Math.round(F / 1000)} kN (holds ~${Math.round(end.hold / 1000)} kN) — anchor to structure or a vehicle for more`);
        releaseLine(L, 'rip');
        break;
      }
    }
    if (L.dead) continue;
    // chain past its proof load (2.5 x WLL) yields: the links stretch (up to the 20 % EN 818-2 asks before it breaks),
    // taking the load's energy as they go
    if (L.spec.look === 'chain' && L.tension > 2.5 * L.spec.wll) {
      const dp = dt * 0.4 * ((L.tension - 2.5 * L.spec.wll) / (L.spec.mbl - 2.5 * L.spec.wll));
      if (L.plastic < 0.2) { L.plastic = Math.min(0.2, L.plastic + dp); setRest(L, L.rest * (1 + dp)); }
    }
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

const _a: Vec3 = [0, 0, 0], _b: Vec3 = [0, 0, 0], _o: Vec3 = [0, 0, 0], _pa: Vec3 = [0, 0, 0], _pb: Vec3 = [0, 0, 0], _cam: Vec3 = [0, 0, 0];
let cutSound = false;

function endPoint(out: Vec3, e: Anchor, alpha: number): Vec3 {
  if (!e.piece) return vec3.copy(out, e.local) as Vec3;
  return interpPoint(out, e.piece, e.local, alpha);
}

/** Once a frame: every line along its hanging shape, recoils running, the cutting tool's sparks and sound. */
let drawnT = 0;
export function syncRigging(alpha: number, _dt: number, frame: number): void {
  // recoils run on simulated time, so bullet time slows a whipping line with everything else
  gfx.begin(Math.max(0, t - drawnT), player.e ? eyePosition(_cam, alpha) : undefined);
  drawnT = t;
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
      gfx.set(id, _pa, _pb, L.rest, L.tension, L.spec.kg * G, L.fray, 0.85, L.plastic);
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

/* Tension on each line where it can be read: kN and share of its working load limit (a rigger's number), green
   within the WLL, amber over it, red past 60 % of the breaking load. Each tag sits a third of the way along its line
   from the end nearest the operator, and tags that would land together are stacked. */
export function rigTags(): void {
  const eye: Vec3 | null = player.e ? [player.e.curPos[0], player.e.curPos[1] + 1.6, player.e.curPos[2]] : null;
  const placed: Vec3[] = [];
  for (const L of rig) {
    if (L.dead) continue;
    const T = L.tension * L.parts;
    const w = T / (L.spec.wll * L.parts), u = L.tension / breakLoad(L);
    const col = u > 0.6 ? '#ff4d3d' : w > 1 ? '#ffb020' : '#8fd18f';
    const near = eye && vec3.distance(eye, L.pa) > vec3.distance(eye, L.pb) ? L.pb : L.pa, far = near === L.pa ? L.pb : L.pa;
    const at: Vec3 = [near[0] + (far[0] - near[0]) / 3, near[1] + (far[1] - near[1]) / 3 + 0.3, near[2] + (far[2] - near[2]) / 3];
    for (const q of placed) if (vec3.distance(q, at) < 0.6) at[1] = q[1] + 0.45;
    placed.push(at);
    tags.add(at, `${Math.round(T / 1000)} kN`, `${Math.round(w * 100)}%`, col, u > 0.6);
  }
}

/** The worst loaded line (over a tenth of its working load) whose snap-back path the player is standing in: the line
 *  itself and 2 x each half beyond its anchor, widening at 20 degrees. `util` is the share of its working load limit. */
export function inSnapZone(): { L: Line; util: number } | null {
  if (!player.e) return null;
  const chest: Vec3 = [player.e.curPos[0], player.e.curPos[1] + 1.1, player.e.curPos[2]];
  let best: { L: Line; util: number } | null = null;
  for (const L of rig) {
    const util = L.tension / L.spec.wll;
    if (L.dead || util < 0.1) continue;
    const brk: Vec3 = [L.pa[0] + (L.pb[0] - L.pa[0]) * PART_AT, L.pa[1] + (L.pb[1] - L.pa[1]) * PART_AT, L.pa[2] + (L.pb[2] - L.pa[2]) * PART_AT];
    const r0 = snapZone(strainEnergy(L, breakLoad(L)) * L.spec.recoil * 0.5);
    if ((inRecoil(chest, brk, L.pa, r0) > 0 || inRecoil(chest, brk, L.pb, r0) > 0 || segDist(chest, L.pa, L.pb) < r0) && (!best || util > best.util)) best = { L, util };
  }
  return best;
}

/** HUD entry for a line: tension as a share of its breaking load, and where its working load limit sits on that bar. */
export function lineBar(L: Line, label: string): { label: string; util: number; wll: number } {
  return { label, util: (L.tension * L.parts) / (breakLoad(L) * L.parts), wll: L.spec.wll / L.spec.mbl };
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
