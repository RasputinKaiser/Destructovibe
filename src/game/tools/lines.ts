import * as THREE from 'three';
import { vec3, clamp } from 'math';
import type { b3JointId } from 'box3d.js';
import type { Vec3 } from '../../types';
import { b3, world, ground, raycast } from '../../physics/physics';
import { pieceOf, type Piece } from '../../destruction/structure';
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
import { GROUND_Y, NO_HIT, interpPoint, interpRot, localBounds, nearestPiece, piecesNear, toolHooks } from './common';

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
  wire13: { name: '13 mm wire rope', look: 'wire', d: 0.013, mbl: 117.9e3, wll: 23.6e3, ea: 7.81e6, kg: 0.691, stretch: 0.015, spring: false, color: 0xadaaa4, recoil: 1, cut: { grinder: 4, shears: 0.6, plasma: 2.5, torch: 6 } },
  wire16: { name: '16 mm wire rope', look: 'wire', d: 0.016, mbl: 178.6e3, wll: 35.7e3, ea: 11.83e6, kg: 1.047, stretch: 0.015, spring: false, color: 0xb8b5ae, recoil: 1, cut: { grinder: 6, shears: 0.8, plasma: 3.5, torch: 8 } },
  nylon: { name: '22 mm nylon kinetic rope', look: 'fibre', d: 0.022, mbl: 127.2e3, wll: 25.4e3, ea: 424e3, kg: 0.25, stretch: 0.3, spring: true, color: 0xd9a21b, recoil: 0.6, cut: { grinder: 1.2, saw: 0.8, shears: 0.4, plasma: 1, torch: 1.5 } },
  dyneema: { name: '10 mm HMPE line', look: 'fibre', d: 0.0095, mbl: 78.3e3, wll: 15.7e3, ea: 2.72e6, kg: 0.051, stretch: 0.035, spring: true, color: 0xe1e3df, recoil: 0.15, cut: { grinder: 0.6, saw: 0.4, shears: 0.3, plasma: 0.5, torch: 0.6 } },
  chain10: { name: '10 mm G80 chain', look: 'chain', d: 0.010, mbl: 126e3, wll: 30.9e3, ea: 15.7e6, kg: 2.2, stretch: 0.2, spring: false, color: 0x2e3033, recoil: 0.1, cut: { grinder: 7, shears: 1, plasma: 4, torch: 9 } },
  chain13: { name: '13 mm G80 chain', look: 'chain', d: 0.013, mbl: 212e3, wll: 52e3, ea: 26.5e6, kg: 3.7, stretch: 0.2, spring: false, color: 0x3d3f42, recoil: 0.1, cut: { grinder: 10, shears: 1.4, plasma: 5, torch: 12 } },
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
  /** how it is made fast to the member (drawn in the member's frame) */
  fit?: THREE.Object3D;
  /** a needle's bearing plate on masonry units: the other units behind the plate, which take their share of the pull */
  bear?: Piece[];
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
  /** reeved: the snatch block at the load end, slung to the load */
  block: THREE.Object3D | null;
  /** a needle's plate spreads the pull over the units behind it: one leg of the line to each */
  legs: { joint: b3JointId; piece: Piece }[];
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
  // near the terrain, what the line lies on may be a road, a kerb or a slab over it: the first surface under the point
  setLineFloor((x, y, z) => {
    const g = groundAt(x, z);
    if (y > g + 0.8) return g;
    const y0 = Math.max(y, g) + 0.5;
    const hit = raycast([x, y0, z], [0, g - y0 - 0.3, 0], NO_HIT);
    return hit ? Math.max(g, hit.point[1]) : g;
  });
}

/* ---------------- anchors ---------------- */

/* a round bar between two points, in the group's frame */
function rod(g: THREE.Group, a: [number, number, number], b: [number, number, number], r: number, mat: THREE.Material): void {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), mat);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.add(m);
}

/** A ground anchor, drawn. A 3-2-1 picket holdfast (FM 5-125): 1.5 m steel pickets driven 0.9 m, leaning back from
 *  the pull, three in the front group that takes the line, two behind, one at the back, 0.9 m apart; each group lashed
 *  from the tops of its pickets down to the foot of the group behind, so the rear groups hold the front one's head.
 *  Or, `big`, a hydraulic recovery winch on its frame, slung back to a log deadman buried across a trench, with the
 *  petrol power pack that drives it set off to the side. */
export function makeStake(at: Vec3, big = false): THREE.Object3D {
  const g = new THREE.Group();
  const iron = getProjectileMaterial('iron');
  const lash = new THREE.MeshStandardMaterial({ color: 0x8c7a55, roughness: 0.95 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x5b4634, roughness: 1 });
  if (!big) {
    // the line comes from +z in the group's frame; the group's origin is on the ground under the front group
    const rows = [[-0.3, 0, 0.3], [-0.18, 0.18], [0]], lean = 0.26, up = 0.6;
    const top = (x: number, r: number): [number, number, number] => [x, up * Math.cos(lean), -r * 0.9 - up * Math.sin(lean)];
    // each group in its own frame pivoting where it enters the ground, so a holdfast that ploughs out lays its groups over
    const groups = rows.map((xs, r) => {
      const rg = new THREE.Group();
      rg.position.z = -r * 0.9;
      xs.forEach(x => {
        rod(rg, [x, -0.9 * Math.cos(lean), 0.9 * Math.sin(lean)], [x, up * Math.cos(lean), -up * Math.sin(lean)], 0.014, iron);
        // the driven head, mushroomed
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.03, 6), iron);
        cap.position.set(x, up * Math.cos(lean), -up * Math.sin(lean));
        rg.add(cap);
      });
      g.add(rg);
      return rg;
    });
    const lashes = new THREE.Group();
    for (let r = 0; r < 2; r++) {
      const tops = rows[r], feet = rows[r + 1];
      for (const x of tops) for (const x2 of feet) rod(lashes, top(x, r), [x2, 0.03, -(r + 1) * 0.9], 0.008, lash);
    }
    g.add(lashes);
    // the line's eye: a sling round the front group, low
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 14), iron);
    eye.position.set(0, 0.12, 0.06);
    groups[0].add(eye);
    rod(groups[0], [-0.3, 0.1, 0.02], [0.3, 0.1, 0.02], 0.01, lash);
    g.userData.rows = groups;
    g.userData.lashes = lashes;
    g.position.set(at[0], at[1] - 0.12, at[2]);
  } else {
    const olive = getProjectileMaterial('rocket');
    const rope = new THREE.MeshStandardMaterial({ color: 0x9fa3a6, roughness: 0.55, metalness: 0.35 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.5), iron);
    frame.position.y = 0.04;
    // the drum between its flanges, the rope wrapped side by side on it, the gearbox at one end and the motor at the other
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 16).rotateZ(Math.PI / 2), olive);
    barrel.position.y = 0.3;
    g.add(barrel);
    for (let k = 0; k < 22; k++) {
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.0068, 5, 18).rotateY(Math.PI / 2), rope);
      wrap.position.set(-0.143 + k * 0.0136, 0.3, 0);
      g.add(wrap);
    }
    for (const x of [-0.16, 0.16]) {
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.018, 20).rotateZ(Math.PI / 2), olive);
      fl.position.set(x, 0.3, 0);
      g.add(fl);
      rod(g, [x, 0.08, -0.2], [x, 0.3, 0], 0.03, olive);
      rod(g, [x, 0.08, 0.2], [x, 0.3, 0], 0.03, olive);
    }
    const gear = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.26), olive);
    gear.position.set(-0.24, 0.26, 0);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 12).rotateZ(Math.PI / 2), iron);
    motor.position.set(0.26, 0.3, 0);
    // the power pack stands off to the side, its control valve toward the operator; hoses run to the motor
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.5), new THREE.MeshStandardMaterial({ color: 0xc99a1e, roughness: 0.6, metalness: 0.2 }));
    pack.position.set(1.6, 0.28, -0.3);
    const hoseM = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
    rod(g, [0.33, 0.28, 0.02], [1.25, 0.1, -0.2], 0.014, hoseM);
    rod(g, [0.33, 0.32, -0.02], [1.25, 0.14, -0.3], 0.014, hoseM);
    const valve = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.08), iron);
    valve.position.set(1.6, 0.6, 0);
    rod(g, [1.6, 0.65, 0], [1.6, 0.85, 0.04], 0.008, iron);
    // the deadman: a log across the bottom of a backfilled trench 2 m behind, its sling rising to the frame
    const mound = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.7), soil);
    mound.position.set(0, 0.03, -2.2);
    g.userData.mound = mound;
    rod(g, [-0.2, 0.06, -0.25], [-0.25, -0.05, -2.0], 0.011, rope);
    rod(g, [0.2, 0.06, -0.25], [0.25, -0.05, -2.0], 0.011, rope);
    g.add(frame, gear, motor, pack, valve, mound);
    g.position.set(at[0], at[1] - 0.3, at[2]);
  }
  g.traverse(o => { o.castShadow = true; });
  g.userData.big = big;
  scene.add(g);
  return g;
}

/** Turn a ground anchor to face the line it holds. */
export function faceStake(o: THREE.Object3D | null, toward: Vec3): void {
  if (!o) return;
  o.rotation.y = Math.atan2(toward[0] - o.position.x, toward[2] - o.position.z);
}

/* What a line leaves behind when it goes: the anchor stays where it was driven (a holdfast that ploughed out lies
   over toward the pull in a furrow of turned soil). The oldest are cleared past a dozen. */
const left: THREE.Object3D[] = [];
function leaveStake(o: THREE.Object3D | null, ripped: boolean, slide = 0.8): void {
  if (!o) return;
  if (ripped && o.userData.big) {
    // the deadman torn out of its trench: the winch dragged most of a metre toward the pull on its skids; the trench
    // stays where it was, torn open
    const mound = o.userData.mound as THREE.Object3D | undefined;
    if (mound) { scene.attach(mound); mound.scale.set(1, 2.5, 1.4); left.push(mound); }
    o.position.x += Math.sin(o.rotation.y) * slide;
    o.position.z += Math.cos(o.rotation.y) * slide;
  } else if (ripped) {
    /* the front group, which took the line, is laid over toward the pull; the ones behind less, as their lashings
       tore; the lashings hang slack (drawn gone) and the soil in front is turned up */
    const rows = (o.userData.rows as THREE.Object3D[] | undefined) ?? [];
    [0.75, 0.35, 0.12].forEach((a, r) => { if (rows[r]) rows[r].rotation.x = a; });
    const lashes = o.userData.lashes as THREE.Object3D | undefined;
    if (lashes) lashes.visible = false;
    const furrow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 1.1), new THREE.MeshStandardMaterial({ color: 0x4e3b2b, roughness: 1 }));
    furrow.position.set(0, 0.02, 0.45);
    o.add(furrow);
  }
  left.push(o);
  while (left.length > 12) dropStake(left.shift()!);
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

/* ---------------- hitches ---------------- */

/* A line isn't shackled to a bare face: it is made fast round something. On a slender member (a post, a column, a beam,
   a pier) a wire-rope choker round it; through a wall or a slab (up to 0.6 m) a hole is drilled and a timber needle
   put through it, bearing on a timber plate on the far face from the pull, the line on its near end (NSW demolition
   COP: ropes attached to each section); round a block of up to 3 m a sling girths it; steel plate or a steel block
   takes a lug welded on. Bigger than that, nothing goes round it. */
type Hitch = 'choker' | 'needle' | 'sling' | 'lug';
const METAL = new Set(['steel', 'castiron', 'metal', 'machine', 'aluminum', 'copper']);
const _mn: Vec3 = [0, 0, 0], _mx: Vec3 = [0, 0, 0];
export function hitchOn(p: Piece): { kind: Hitch; name: string } | { kind: null; why: string } {
  if (vehicleOf(p)) return { kind: 'choker', name: 'its towing eye' };
  localBounds(p, _mn, _mx);
  const s = [_mx[0] - _mn[0], _mx[1] - _mn[1], _mx[2] - _mn[2]].sort((x, y) => x - y);
  if (s[2] >= 2.5 * s[1] && s[1] <= 0.8) return { kind: 'choker', name: 'a choker round it' };
  // steel plate and blocks take a lifting lug welded on where the line pulls
  if (METAL.has(p.mat)) return { kind: 'lug', name: 'a lug welded on' };
  if (s[0] <= 0.6) return { kind: 'needle', name: 'a needle through a drilled hole' };
  if (s[1] <= 3) return { kind: 'sling', name: 'a sling round it' };
  return { kind: null, why: `Nothing goes round that (${s[1].toFixed(1)} m through): rig to a pier, a column, a wall or a section cut from it` };
}

let timber: THREE.MeshStandardMaterial | null = null, slingM: THREE.MeshStandardMaterial | null = null;
/* Build how end `e` is made fast (the line pulling toward world point `to`), in the member's frame; a needle moves the
   line's end out to the needle's near end. */
function makeHitch(e: Anchor, to: Vec3): void {
  const p = e.piece;
  if (!p || e.bite || vehicleOf(p)) return;
  const h = hitchOn(p);
  if (!h.kind || h.kind === 'lug') return;
  localBounds(p, _mn, _mx);
  const dims = [_mx[0] - _mn[0], _mx[1] - _mn[1], _mx[2] - _mn[2]];
  const g = new THREE.Group();
  timber ??= new THREE.MeshStandardMaterial({ color: 0x9a7b52, roughness: 0.9 });
  slingM ??= new THREE.MeshStandardMaterial({ color: 0xa9acaf, roughness: 0.6, metalness: 0.3 });
  const axisTo = (k: number, o: THREE.Object3D): void => {
    // geometry built along +z (torus axis) turned onto local axis k
    if (k === 0) o.rotation.y = Math.PI / 2; else if (k === 1) o.rotation.x = Math.PI / 2;
  };
  if (h.kind === 'needle') {
    /* drilled through the wall the way the line pulls (the member's axis nearest the pull); the plate goes on the
       wall's far face, found by looking back through it from beyond (a brick is one unit of a wall that is thicker) */
    const at: Vec3 = [0, 0, 0], dir: Vec3 = [0, 0, 0], dl: Vec3 = [0, 0, 0];
    anchorWorld(at, e);
    vec3.sub(dir, to, at);
    vec3.normalize(dir, dir);
    b3.b3Body_GetLocalVector(dl, p.body, dir);
    const k = [0, 1, 2].reduce((m, i) => (Math.abs(dl[i]) > Math.abs(dl[m]) ? i : m), 0);
    const side = dl[k] > 0 ? 1 : -1;
    // the axis in world, pointing toward the pull
    const ax: Vec3 = [0, 0, 0];
    b3.b3Body_GetWorldVector(ax, p.body, [k === 0 ? side : 0, k === 1 ? side : 0, k === 2 ? side : 0]);
    const from: Vec3 = [at[0] - ax[0] * 1.2, at[1] - ax[1] * 1.2, at[2] - ax[2] * 1.2];
    const back = raycast(from, [ax[0] * 1.2, ax[1] * 1.2, ax[2] * 1.2], NO_HIT);
    // the far face, in the member's frame (at least its own far face)
    const far: Vec3 = [0, 0, 0];
    if (back) b3.b3Body_GetLocalPoint(far, p.body, back.point as Vec3);
    const nearK = side > 0 ? _mx[k] : _mn[k], ownFar = side > 0 ? _mn[k] : _mx[k];
    // no thicker than a wall a needle goes through (0.6 m), and never inside the unit itself
    const farK = !back ? ownFar : side > 0 ? Math.max(Math.min(far[k], ownFar), nearK - 0.6) : Math.min(Math.max(far[k], ownFar), nearK + 0.6);
    const thick = Math.abs(nearK - farK);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, thick + 0.45), timber);
    axisTo(k, needle);
    needle.position.set(e.local[0], e.local[1], e.local[2]);
    needle.position.setComponent(k, (nearK + farK) / 2 + side * 0.1);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.05), timber);
    axisTo(k, plate);
    plate.position.copy(needle.position);
    plate.position.setComponent(k, farK - side * 0.025);
    g.add(needle, plate);
    e.local[k] = nearK + side * 0.2;
    /* in a wall laid of small units (bricks, blocks) the plate bears on the ones round the hole: each takes its share
       of the pull through the plate, as the plate spreads it */
    if (p.volume < 0.05) {
      const pc: Vec3 = [0, 0, 0];
      b3.b3Body_GetWorldPoint(pc, p.body, [plate.position.x, plate.position.y, plate.position.z]);
      e.bear = piecesNear(pc, 0.3).map(n => n.p).filter(q => q !== p && q.mat === p.mat && !vehicleOf(q)).slice(0, 8);
    }
  } else {
    // a choker round a slender member's girth, square to its length; a sling round a block level, the way it would be
    // thrown round a chimney or a pier (square to whichever of its sides stands most upright)
    let k = dims.indexOf(Math.max(...dims));
    if (h.kind === 'sling') {
      const up: Vec3 = [0, 0, 0];
      b3.b3Body_GetLocalVector(up, p.body, [0, 1, 0]);
      k = [0, 1, 2].reduce((m, i) => (Math.abs(up[i]) > Math.abs(up[m]) ? i : m), 0);
    }
    /* drawn tight round the section where it goes on: the member's faces found by feeling in from each side at the hitch's
       height (its bounds can take in a cap plate or a bracket wider than the shaft), a tube along each face */
    const o = [0, 1, 2].filter(i => i !== k);
    const tr = h.kind === 'choker' ? 0.008 : 0.012;
    const mid: Vec3 = [(_mn[0] + _mx[0]) / 2, (_mn[1] + _mx[1]) / 2, (_mn[2] + _mx[2]) / 2];
    mid[k] = e.local[k];
    // the outermost face each side: rays in from that side across the section's width (an H's flange tips, not its web)
    const face = (i: number, sg: number): number => {
      const j = o[0] === i ? o[1] : o[0];
      let best = -Infinity;
      for (let q = -2; q <= 2; q++) {
        const st: Vec3 = [...mid], dl: Vec3 = [0, 0, 0], sw: Vec3 = [0, 0, 0], dw: Vec3 = [0, 0, 0], hl: Vec3 = [0, 0, 0];
        st[i] += sg * (dims[i] / 2 + 0.3);
        st[j] += (q / 2) * dims[j] * 0.45;
        dl[i] = -sg * (dims[i] + 0.6);
        b3.b3Body_GetWorldPoint(sw, p.body, st);
        b3.b3Body_GetWorldVector(dw, p.body, dl);
        const hit = raycast(sw, dw, NO_HIT);
        if (!hit || pieceOf(hit.entity) !== p) continue;
        b3.b3Body_GetLocalPoint(hl, p.body, hit.point as Vec3);
        best = Math.max(best, sg * hl[i]);
      }
      return Number.isFinite(best) ? sg * best : sg > 0 ? _mx[i] : _mn[i];
    };
    const lo0 = face(o[0], -1), hi0 = face(o[0], 1), lo1 = face(o[1], -1), hi1 = face(o[1], 1);
    const hx = (hi0 - lo0) / 2 + tr, hy = (hi1 - lo1) / 2 + tr;
    const c = new THREE.Vector3(...mid);
    c.setComponent(o[0], (lo0 + hi0) / 2);
    c.setComponent(o[1], (lo1 + hi1) / 2);
    const corner = (sx: number, sy: number): THREE.Vector3 => c.clone().setComponent(o[0], c.getComponent(o[0]) + sx * hx).setComponent(o[1], c.getComponent(o[1]) + sy * hy);
    const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let q = 0; q < 4; q++) {
      const A = cs[q], B = cs[(q + 1) % 4];
      rod(g, [A.x, A.y, A.z], [B.x, B.y, B.z], tr, slingM);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(tr, 6, 4), slingM);
      ball.position.copy(A);
      g.add(ball);
    }
    // the line's eye where the sling draws up on the side toward the pull
    const d: Vec3 = [0, 0, 0];
    b3.b3Body_GetLocalPoint(d, p.body, to);
    const dx = d[o[0]] - c.getComponent(o[0]), dy = d[o[1]] - c.getComponent(o[1]);
    const l = Math.hypot(dx, dy);
    if (l > 1e-3) {
      const t = Math.min(hx / Math.max(Math.abs(dx / l), 1e-6), hy / Math.max(Math.abs(dy / l), 1e-6));
      e.local[o[0]] = c.getComponent(o[0]) + (dx / l) * t;
      e.local[o[1]] = c.getComponent(o[1]) + (dy / l) * t;
    }
  }
  g.traverse(m => { m.castShadow = true; });
  scene.add(g);
  e.fit = g;
}

function dropHitch(e: Anchor): void {
  if (!e.fit) return;
  dropStake(e.fit);
  e.fit = undefined;
}

const _hq: [number, number, number, number] = [0, 0, 0, 1], _hp3: Vec3 = [0, 0, 0];
function syncHitch(e: Anchor, alpha: number): void {
  if (!e.fit || !e.piece) return;
  interpPoint(_hp3, e.piece, [0, 0, 0], alpha);
  interpRot(_hq, e.piece, alpha);
  e.fit.position.set(_hp3[0], _hp3[1], _hp3[2]);
  e.fit.quaternion.set(_hq[0], _hq[1], _hq[2], _hq[3]);
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

/* One leg of the line to each unit behind a needle's plate: made fast at the needle's end in that unit's frame, with
   the line's own length and stiffness, so the plate shares the pull out among them. */
function makeLegs(L: Line): void {
  for (const [end, far] of [[L.a, 'a'], [L.b, 'b']] as [Anchor, 'a' | 'b'][]) {
    if (!end.bear?.length || !end.piece) continue;
    const at: Vec3 = [0, 0, 0];
    anchorWorld(at, end);
    for (const q of end.bear) {
      if (q.dead) continue;
      const jd = lineJointDef(L);
      const local: Vec3 = [0, 0, 0];
      b3.b3Body_GetLocalPoint(local, q.body, at);
      if (far === 'a') { jd.base.bodyIdA = q.body; jd.base.localFrameA = { position: local, quaternion: [0, 0, 0, 1] }; }
      else { jd.base.bodyIdB = q.body; jd.base.localFrameB = { position: local, quaternion: [0, 0, 0, 1] }; }
      L.legs.push({ joint: b3.b3CreateDistanceJoint(world, jd), piece: q });
    }
  }
}

function dropLegs(L: Line): void {
  for (const g of L.legs) if (b3.b3Joint_IsValid(g.joint)) b3.b3DestroyJoint(g.joint, true);
  L.legs.length = 0;
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
    pa: [0, 0, 0], pb: [0, 0, 0], vis: [], stake: opts.stake ?? null, block: null, legs: [], dead: false, make: opts.make ?? null, onGone: opts.onGone ?? null, creakT: -9,
  };
  anchorWorld(L.pa, a);
  anchorWorld(L.pb, b);
  // made fast round the member, the line's end moves to the hitch: what was paid out between the two points stays
  const d0 = vec3.distance(L.pa, L.pb);
  makeHitch(a, L.pb);
  makeHitch(b, L.pa);
  anchorWorld(L.pa, a);
  anchorWorld(L.pb, b);
  L.rest = Math.max(0.3, rest + vec3.distance(L.pa, L.pb) - d0);
  L.joint = makeJoint(L);
  makeLegs(L);
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
  for (const j of [L.joint, ...L.legs.map(g => g.joint)]) {
    if (!b3.b3Joint_IsValid(j)) continue;
    b3.b3DistanceJoint_SetLength(j, L.rest);
    b3.b3DistanceJoint_SetLengthRange(j, 0.05, L.rest * (1 + L.spec.stretch * 1.15));
    b3.b3DistanceJoint_SetSpringHertz(j, springHz(L));
  }
  b3.b3Joint_WakeBodies(L.joint);
}

/** Re-make the joint to a new end (a rehook onto the fragment that holds the eye, a hitch onto a vehicle); `make`
 *  swaps the joint builder (a stake winch's motor off for a truck's pull). */
export function reanchor(L: Line, which: 'a' | 'b', to: Anchor, rest = L.rest, make: ((L: Line) => b3JointId) | null | undefined = undefined): void {
  if (b3.b3Joint_IsValid(L.joint)) b3.b3DestroyJoint(L.joint, true);
  dropLegs(L);
  dropHitch(L[which]);
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
function snapBack(L: Line, T: number, at = PART_AT, reach = at > 0 ? 1.9 : 0.85): void {
  const U = strainEnergy(L, T) * L.spec.recoil;
  const v = recoilSpeed(L, T);
  const brk: Vec3 = [L.pa[0] + (L.pb[0] - L.pa[0]) * at, L.pa[1] + (L.pb[1] - L.pa[1]) * at, L.pa[2] + (L.pb[2] - L.pa[2]) * at];
  // parted, both halves fly back past their anchors; an anchor torn out, the whole line flies toward what pulled it
  for (const id of L.vis) gfx.snap(id, L.pa, L.pb, at, v, reach);
  L.vis.length = 0;
  if (L.spec.look === 'chain') audio.ropeSnap(brk, 'chain');
  else if (L.spec.look === 'wire') { audio.ropeSnap(brk, 'wire'); audio.snap(brk, clamp(U / 20e3, 0.3, 1)); }
  else audio.ropeSnap(brk, 'rope');
  fx.sparks(brk, [0, 1, 0], L.spec.look === 'fibre' ? 0 : 14);
  if (!player.e) return;
  const chest: Vec3 = [player.e.curPos[0], player.e.curPos[1] + 1.1, player.e.curPos[2]];
  let worst = 0;
  for (const [end, share] of [[L.pa, at], [L.pb, 1 - at]] as [Vec3, number][]) {
    if (share <= 0) continue;
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
  dropLegs(L);
  // a line can't hold more than it breaks at: a solver spike on the parting step isn't energy it stored
  // a ground anchor ploughed out (end a): the line is whole, its freed end is thrown toward the far end
  const pulled = why === 'rip' && !L.a.piece && (L.a.over ?? 0) > 0.3;
  /* a winch torn off its deadman keeps its rope on the drum: the machine is the freed end, dragged along the line on its
     skids by the energy the rope held, U / (mu m g) with ~150 kg and mu ~0.6, the rope laid slack behind it */
  const Tp = Math.min(L.tension, breakLoad(L) * 1.05);
  const slide = pulled && L.stake?.userData.big ? Math.min((strainEnergy(L, Tp) * L.spec.recoil) / (0.6 * 150 * G), 0.8 * vec3.distance(L.pa, L.pb)) : 0.8;
  if ((why === 'break' || why === 'cut' || why === 'rip') && T > 0.02 * L.spec.mbl) {
    snapBack(L, Tp, pulled ? 0 : PART_AT, pulled && L.stake?.userData.big ? slide / Math.max(0.5, vec3.distance(L.pa, L.pb)) : undefined);
  }
  else {
    for (const id of L.vis) gfx.remove(id);
    L.vis.length = 0;
    if (why !== 'off') audio.cableCreak(L.pb, 0.3);
  }
  dropStake(L.block);
  L.block = null;
  dropHitch(L.a);
  dropHitch(L.b);
  leaveStake(L.stake, pulled, slide);
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

/** sine of how far off square to a member a line may pull before a hook on it slides (20 degrees) */
export const SEAT = Math.sin((20 * Math.PI) / 180);

/* A hook over an edge holds while the line runs back over that edge; pulled the other way it skids off the face. */
function biteHolds(L: Line, end: Anchor, from: Vec3, to: Vec3): boolean {
  const bt = end.bite!;
  if (bt.axis && end.piece) {
    // a hook on a member, made fast: it holds while the line pulls square across the member (within ~20 degrees:
    // steel on steel, friction 0.2-0.4, lets a tine slide once the pull leans further along it)
    vec3.sub(_u, to, from);
    vec3.normalize(_u, _u);
    b3.b3Body_GetWorldVector(_n, end.piece.body, bt.axis);
    return Math.abs(vec3.dot(_u, _n)) <= SEAT;
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
    let F = vec3.length(_f);
    if (L.legs.length) {
      for (const g of L.legs) {
        if (g.piece.dead || !b3.b3Joint_IsValid(g.joint)) continue;
        b3.b3Joint_GetConstraintForce(_f, g.joint);
        F += vec3.length(_f);
      }
      // a unit that broke away takes its leg with it
      if (L.legs.some(g => g.piece.dead)) L.legs = L.legs.filter(g => { if (!g.piece.dead) return true; if (b3.b3Joint_IsValid(g.joint)) b3.b3DestroyJoint(g.joint, true); return false; });
    }
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
const _q3 = new THREE.Quaternion(), _up3 = new THREE.Vector3(0, 1, 0), _v3 = new THREE.Vector3();
/* how far up the line from the load the block's sheave sits (the sling and hook below it) */
const BLOCK_AT = 0.62;
/* A snatch block for 13 mm rope: two side plates round a 150 mm sheave, the swivel hook under it and a sling down to the
   load; local +y runs up the line. */
function blockMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xa8281e, roughness: 0.5, metalness: 0.3 });
  const iron = getProjectileMaterial('iron');
  for (const z of [-0.028, 0.028]) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 18).rotateX(Math.PI / 2), red);
    plate.scale.set(1, 1.3, 1);
    plate.position.set(0, BLOCK_AT, z);
    g.add(plate);
  }
  const sheave = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 18).rotateX(Math.PI / 2), iron);
  sheave.position.y = BLOCK_AT;
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 14, Math.PI * 1.5), iron);
  hook.position.y = BLOCK_AT - 0.2;
  const swivel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.08, 8), iron);
  swivel.position.y = BLOCK_AT - 0.14;
  const slingM = new THREE.MeshStandardMaterial({ color: 0x9fa3a6, roughness: 0.55, metalness: 0.35 });
  for (const x of [-0.03, 0.03]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, BLOCK_AT - 0.22, 6), slingM);
    leg.position.set(x, (BLOCK_AT - 0.22) / 2, 0);
    g.add(leg);
  }
  g.add(sheave, hook, swivel);
  g.traverse(o => { o.castShadow = true; });
  scene.add(g);
  return g;
}
export function syncRigging(alpha: number, _dt: number, frame: number): void {
  // recoils run on simulated time, so bullet time slows a whipping line with everything else
  gfx.begin(Math.max(0, t - drawnT), player.e ? eyePosition(_cam, alpha) : undefined);
  drawnT = t;
  for (const L of rig) {
    if (L.dead || !L.vis.length) continue;
    syncHitch(L.a, alpha);
    syncHitch(L.b, alpha);
    endPoint(_a, L.a, alpha);
    endPoint(_b, L.b, alpha);
    // reeved parts run side by side from the drum to the snatch block slung at the load, a sheave's width apart
    vec3.sub(_o, _b, _a);
    const span = vec3.length(_o);
    if (L.parts > 1 && span > 1.5) {
      const bk = L.block ??= blockMesh();
      bk.visible = true;
      bk.position.set(_b[0], _b[1], _b[2]);
      _q3.setFromUnitVectors(_up3, _v3.set(-_o[0] / span, -_o[1] / span, -_o[2] / span));
      bk.quaternion.copy(_q3);
      vec3.scaleAndAdd(_b, _b, _o, -BLOCK_AT / span);
    } else if (L.block) L.block.visible = false;
    vec3.set(_o, -_o[2], 0, _o[0]);
    vec3.normalize(_o, _o);
    if (L.parts > 1 && L.block?.visible) {
      /* reeved: one rope, off the drum, round the block's sheave and back to a dead end made fast on the winch frame (for
         three parts, round a sheave on the frame and back to a dead end on the block): an eye only at the dead end */
      const S = 0.075, n = L.vis.length;
      L.vis.forEach((id, i) => {
        const up = i % 2 === 0;           // this part runs from the frame end out to the block
        const sa = n === 2 ? (i === 0 ? -0.06 : 0.2) : (i === 0 ? -0.06 : i === 1 ? 0.12 : 0.2);
        const sb = up ? -S : S;
        vec3.scaleAndAdd(_pa, _a, _o, sa);
        vec3.scaleAndAdd(_pb, _b, _o, n === 3 && i === 2 ? 0 : sb);
        const dead = i === n - 1;
        const ends = !dead ? false : n === 2 ? 'a' : 'b';
        gfx.set(id, _pa, _pb, L.rest, L.tension, L.spec.kg * G, L.fray, 0.85, L.plastic, ends);
      });
      continue;
    }
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

/* Tension on each line where it can be read: its number (the same as on its HUD bar), kN, and share of its working load
   limit (a rigger's number), green within the WLL, amber over it, red past 60 % of the breaking load. Each tag sits a
   third of the way along its line from the end nearest the operator; tags that would overlap on screen are stacked. */
const TAG = 1.5;                  // tag size (1 = a charge's tag)
const TAG_H = 0.0525 * TAG * 1.1, TAG_W = TAG_H * (160 / 56);   // on screen, in tan-of-angle units, with a margin
const _tp: { x: number; y: number }[] = [];
export function rigTags(): void {
  if (!player.e) return;
  const eye = eyePosition(_cam, 1);
  const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw), cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  const f: Vec3 = [-sy * cp, sp, -cy * cp], r: Vec3 = [cy, 0, -sy];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  _tp.length = 0;
  const nums = new Map<LineOwner, number>();
  for (const L of rig) {
    if (L.dead) continue;
    const no = (nums.get(L.owner) ?? 0) + 1;
    nums.set(L.owner, no);
    const T = L.tension * L.parts;
    const w = T / (L.spec.wll * L.parts), ub = L.tension / breakLoad(L);
    const col = ub > 0.6 ? '#ff4d3d' : w > 1 ? '#ffb020' : '#8fd18f';
    const near = vec3.distance(eye, L.pa) > vec3.distance(eye, L.pb) ? L.pb : L.pa, far = near === L.pa ? L.pb : L.pa;
    const at: Vec3 = [near[0] + (far[0] - near[0]) / 3, near[1] + (far[1] - near[1]) / 3 + 0.3, near[2] + (far[2] - near[2]) / 3];
    const dx = at[0] - eye[0], dy = at[1] - eye[1], dz = at[2] - eye[2];
    const depth = dx * f[0] + dy * f[1] + dz * f[2];
    if (depth < 0.3) continue;
    const x = (dx * r[0] + dy * r[1] + dz * r[2]) / depth;
    let y = (dx * u[0] + dy * u[1] + dz * u[2]) / depth;
    // stack over any tag already placed where this one would land
    for (let k = 0; k < 8; k++) {
      const hit = _tp.find(p => Math.abs(p.x - x) < TAG_W && Math.abs(p.y - y) < TAG_H);
      if (!hit) break;
      y = hit.y + TAG_H;
    }
    _tp.push({ x, y });
    const lift = y * depth - (dx * u[0] + dy * u[1] + dz * u[2]);
    at[0] += u[0] * lift; at[1] += u[1] * lift; at[2] += u[2] * lift;
    tags.add(at, `#${no} ${Math.round(T / 1000)} kN`, `${Math.round(w * 100)}%`, col, ub > 0.6, TAG);
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
  return { label, util: (L.tension * L.parts) / (breakLoad(L) * L.parts), wll: L.spec.wll / breakLoad(L) };
}

export function linesOf(owner: LineOwner): Line[] {
  return rig.filter(L => L.owner === owner && !L.dead);
}

export function clearRigging(): void {
  for (const L of [...rig]) {
    L.dead = true;
    if (b3.b3Joint_IsValid(L.joint)) b3.b3DestroyJoint(L.joint, false);
    for (const g of L.legs) if (b3.b3Joint_IsValid(g.joint)) b3.b3DestroyJoint(g.joint, false);
    L.legs.length = 0;
    dropStake(L.stake);
    dropStake(L.block);
    dropHitch(L.a);
    dropHitch(L.b);
  }
  for (const o of left) dropStake(o);
  left.length = 0;
  rig.length = 0;
  cutting = null;
  gfx.clear();
  if (cutSound) { cutSound = false; audio.powerTool('off', _a, 0, 0); }
}

export function rigDebug(): { kind: LineKind; owner: LineOwner; tension: number; rest: number; len: number; fray: number }[] {
  return rig.map(L => ({ kind: L.kind, owner: L.owner, tension: L.tension * L.parts, rest: L.rest, len: vec3.distance(L.pa, L.pb), fray: L.fray }));
}
