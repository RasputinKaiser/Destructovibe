import * as THREE from 'three';
import { vec3, quat, clamp, lerp } from 'math';
import type { b3ShapeId, b3JointId } from 'box3d.js';
import type { Blueprint, MaterialId, PieceSpec, Vec3, Quat } from '../types';
import {
  b3, world, ground, CAT, ALL, filter, register, unregister, stepCount, overlapAABB, explodeImpulse,
  entityOfShape, copy3, copy4, step as physicsStep, runawayQueue, randomStream, raycast, type PhysEntity, type StepHandlers,
} from '../physics/physics';
import { MATS, pieceHp, flammable, strengthAt, grainShare, charTime, rebarTie, effectiveDensity, autoSectionInertia, REAL_SCALE, type PhysMat } from './materials';
import * as P from './polytope';
import * as J from './joints';
import {
  analysisPartition, analysisStep, analysisTouch, analysisReset, analysed, analysisStale, analysisUrgent, solveOfPiece, memberAxial, type AnalysisOut, type Solve, type ExtraLoads, type Tie,
} from './analysis';
import { specParts, type PartSpec } from './compound';
import { hull2, clip2, area2, type P2 } from './hinge';
export { sectionParts, sectionProps, specParts, specDensity } from './compound';
import {
  initBatches, addPieceGfx, pieceFinish, setPieceTransform, setPieceColor, setPieceHeat, removePieceGfx, clearBatches, setBatchesXray, type PieceGfx,
} from './batches';
import { fx, setFxFloor } from '../render/fx';
import { rebar as rebarGfx } from '../render/rebar';
import { initRopes, ropes as ropeGfx } from '../render/ropes';
import { xrayDots, stressColor, thermalColor } from '../render/xray';
import { audio } from '../audio/audio';
import { createSoftFor, stepSoft, clearSoft, softExplosion, softExtinguish } from '../sim/soft';
import { initSoftGfx, syncSoftGfx, clearSoftGfx } from '../render/soft';
import * as fields from '../sim/fields/index';
import { panelLoad, type Survey } from '../sim/fields/blast';
import * as scoring from '../game/scoring';
import {
  memberFor, svcAdd, svcRemove, svcLink, svcLinkLost, svcHarm, servicesStep, refreshServices, clearServices,
  serviceStats, serviceColor, serviceDots, linkMechs, mechBroken, killMech, mechPartsOf, svcHostMoved, machineRoot, mechHarm, mechState, drawStandIns, svcRig, svcCarry,
  type Member, type Mech,
} from './services';
import {
  setDetailHost, attachDetail, detachDetail, clearDetail, syncDetail, detailDamage, detailFracture, detailSever, detailCrack, detailHeat,
  hasDetail, setDetailCamera, detailShatter, detailUnits, detailDropOut, detailCarveDeferred,
} from './detail';
import { setServiceViewer as svcViewer } from './services';
import { linkVehicles, stepVehicles, clearVehicles, pieceDamaged } from '../vehicles/vehicle';
import { buildTerrain, ensureTerrain, bury, blastShield, crater, settleBuried, setTerrainHooks, groundAt, groundLost } from '../terrain/terrain';
export { detailStats, setDetailQuality, detailOf } from './detail';
/** the camera, each frame: services pick their nearest faults by it, dormant detail its level of detail */
export function setServiceViewer(p: ArrayLike<number>): void {
  svcViewer(p);
  setDetailCamera(p);
}

/* ---------------- tuning ---------------- */
const MIN_BODY_VOL = 0.006;      // smaller Voronoi cells become particles only
const RUBBLE_VOL = 0.02;         // chunks below this count as demolished rubble at birth
const MIN_FRACTURE_VOL = 0.012;
const BLOCK_VOL = 0.06;           // a fragment this big breaks again whatever its depth
const MAX_DEPTH = 2;
let BUDGET = 800;                // bodies made by breakage before old rubble is culled
const IMPACT_GRACE = 0.4;        // fresh fragments ignore collision damage while they fly apart
const FRAG_TOUGHEN = 1.2;        // fragment hp × (1 + depth × this): sounder than the parent, but a hard landing still breaks them
const LOAD_SAFETY = 2.6;         // joint capacity ≥ measured static load × this
const FRACTURE_PER_STEP = 3;
const BLAST_FRACTURES = 14;      // beyond this a blast only pre-damages pieces
const MAX_BURNING = 60;
const MAX_REBAR = 260;
const ULTIMATE = 1.6;            // ductile joints: ultimate / yield
const DESIGN_SAFETY = 1.8;       // ductile joints: capacity / measured load
const DESIGN_FLOOR = 0.12;       // …but never below this share of the material's own strength
const DISPLACED = 0.75;          // metres from rest pose → demolished
const TILTED = Math.cos(0.2);    // |q·q0| below this (≈23°) → demolished
const DMG_SOFTEN = 0.6;          // a damaged joint keeps 1 − this × damage of its capacity
const FATIGUE_U = 0.55;          // moving joints above this utilisation accumulate damage…
const FATIGUE_RATE = 0.1;        // …at this rate per poll per unit of excess
const MOVING_STEP = 0.006;       // m per step (0.36 m/s): below this a joint is resting, not working
const MOVING_TURN = Math.cos(0.003);
const JOLT = 0.5;                // share of an impact's energy absorbed by the struck piece's connections
const SHOCK_FAIL = 4;            // single-step overstress that fails a joint outright
const SHOCK_DAMAGE = 0.2;        // damage per unit of overstress from a shorter spike
const CRACK_CHANCE = 0.7;        // share of brittle joint failures that crack the member instead of the seam
const CRACK_MIN_VOL = 0.08;
const CRACK_PER_STEP = 2;
const HEAD_BOND = 3;              // bonded brickwork across its courses vs a bed joint (EN 1996 fxk2/fxk1 ~3-4)
const SUPPORT_FAILS = 6;         // statically overloaded joints allowed to fail per step…
const GROSS_FAILS = 48;          // …and joints overloaded past DAF× capacity, which no redistribution can save
const PER_SOLVE = 60;            // …and per analysis solve of their structure: the next go once the load has redistributed
const DAF = 2;                   // dynamic amplification of a suddenly applied static load (GSA 2016 linear static)
const TRANSIENT_POLLS = 6;       // …a joint the analysis clears must stay overloaded this long (~0.1–0.2 s) to fail
const UNMODELLED_POLLS = 40;     // …unless it stays overloaded for ~1 s: loads the analysis cannot see (rubble resting on a floor)
const AGED_SAFETY = 2;           // ageing eats a joint's margin down to this multiple of its static load, not below
const HEAT_TICK = 0.25;
const AMBIENT = 20;
const STEEL_DIF = 1.3;
const chance = randomStream(0x57a0c7);

export interface Root {
  spec: PieceSpec;
  volume: number;
  value: number;
  protected: boolean;
  prop: boolean;            // loose furniture: not part of the demolition job
  demolishedVol: number;
  penalized: boolean;
  density: number;          // kg/m³ the body is built with: spec.density, else the section's real kg/m over the modelled area
  /** the member this body was carved or released from: what comes down of it counts toward that member too */
  parent?: Root;
}

interface Caps { comp: number; ten: number; shear: number; torque: number }
interface Frame { position: Vec3; quaternion: Quat }

/* A welded connection with a real failure envelope: crushing and bending are Box3D thresholds;
   tension and Mohr–Coulomb shear (cohesion + μ·compression) are checked from the measured joint force. */
export interface Weld {
  joint: b3JointId;
  a: Piece;
  b: Piece | null;          // null = ground
  local: Vec3;              // anchor in a's frame
  n: Vec3;                  // contact normal A→B, in a's frame
  area: number;
  mu: number;
  base: Caps;               // calibrated, at ambient temperature
  cap: Caps;                // after heat softening / yielding
  ductile: boolean;         // yields into a plastic hinge before rupturing (steel, aluminium, reinforced concrete)
  metal: boolean;           // designed-for-load steel connection
  yielded: boolean;
  plastic: number;          // accumulated plastic rotation, rad
  limit: number;            // rotation capacity before rupture, rad
  rebar: boolean;
  fa: Frame;
  fb: Frame;
  lastOver: number;
  overSteps: number;
  polled: number;
  util: number;
  quiet: number;
  reyields: number;
  calib: boolean;           // capacities still being measured (freshly spawned)
  alive: boolean;
  supportForce: number;      // static demand from the frame analysis: |force| (N)
  supportTorque: number;     // …|moment| with P-δ amplification (Nm)
  sN: number;                // …axial force, + compression (N)
  sV: number;                // …shear (N)
  /** …the force and moment it puts on its b side at its anchor (world frame), and the P-δ factor on the moment */
  sF?: Float64Array;
  dmg: number;               // accumulated dynamic damage (shock, cyclic overstress), 1 = failed
  real: Caps;                // the connection's real (unscaled) strength, for the static check of real demands
  sd0: number;               // static demand / capacity when calibrated: what it carried before anything changed
  calm: number;              // step before which a lightly loaded, barely moving joint need not be polled again
  j: J.Joint;                // what the connection physically is: mortar, bolts, glue… (joints.ts)
}

interface Rebar {
  joint: b3JointId;
  a: Piece;
  b: Piece | null;
  la: Vec3;
  lb: Vec3;
  side: Vec3;               // bar spacing direction, in a's frame
  rest: number;
  max: number;              // elongation at which the bars snap
  vis: [number, number];
  lastOver: number;
  overSteps: number;
  alive: boolean;
}

interface Rope {
  joint: b3JointId;
  kind: 'rope' | 'wire' | 'chain';
  a: Piece;
  b: Piece;
  la: Vec3;
  lb: Vec3;
  rest: number;
  maxLength: number;
  slack: number;
  strength: number;
  proxy: boolean;           // b end held by a static stand-in anchor while b rests
  vis: number;
  alive: boolean;
}

export interface Piece extends PhysEntity {
  kind: 'piece';
  id: number;
  shape: b3ShapeId;
  mat: MaterialId;
  pm: PhysMat;
  tint: number | undefined;
  /** the body's solid; for a compound, the convex envelope of its parts (bounds and extents only) */
  poly: P.Poly;
  /** compound (non-convex) body: one convex shape per part, in the body frame; null for a single convex solid */
  parts: Part[] | null;
  volume: number;
  hp: number;
  damage: number;
  root: Root;
  uvOrigin: Vec3;
  cyl: P.CylInfo | null;
  depth: number;
  gfx: PieceGfx;
  welds: Weld[];
  rebars: Rebar[];
  ropes: Rope[];
  spawnPos: Vec3;
  spawnRot: Quat;
  demolished: boolean;
  dead: boolean;
  dirty: boolean;
  queued: boolean;
  born: number;
  fade: number;
  fuse: number;
  char: number;             // 0 fresh .. 1 burnt through
  burning: boolean;
  fireT: number;
  temp: number;             // °C
  heatK: number;            // strength factor from temperature
  glow: number;
  sleepT: number;
  svc: Member | null;       // building-services network membership
  mechs: Mech[] | null;     // hinges/sliders this piece hosts or rides on
  hinged: boolean;          // moving machine part: its motion is not demolition
  debris: boolean;          // made by breakage, counts against the debris budget
  proxied: number;          // machine joints/ropes anchored to the world in this resting member's place
}

export interface PartGeo { poly: P.Poly; cyl: P.CylInfo | null }
export interface Part extends PartGeo { shape: b3ShapeId }

export const live = new Set<Piece>();
const dirty: Piece[] = [];
/* The pieces the last step moved, in the solver's event order. The simulation walks this, never `dirty` (the
   renderer's list, drained and reordered once a drawn frame): what the joints see must not depend on the frame rate. */
const movedNow: Piece[] = [];
let movedAt = -1;
const welds = new Map<number, Weld>();
const rebars = new Map<number, Rebar>();
const ropeJoints = new Map<number, Rope>();
const fractureQueue: { p: Piece; point: Vec3; intensity: number; blast: boolean }[] = [];
const fusing: Piece[] = [];
const fading: Piece[] = [];
const burning = new Set<Piece>();
const hot = new Set<Piece>();
const yielding = new Set<Weld>();
const supportPressure = new Set<Weld>();
let supportDirty = true;
let roots: Root[] = [];
let totalVol = 0;
let totalValueSum = 0;
let demolishedVol = 0;
let nextId = 1;
let debrisCount = 0;
let clock = 0;
let building = false;
let maintainT = 0;
let heatT = 0;
let fxBudget = 0;
let groanT = 0;
let jointMul = 1;
let fireSpread = true;
let windStrength = 0;
let windT = 0;
let quakeT = -1;
let quakeDur = 0;
let quakeMag = 1;

export type XrayMode = 'off' | 'stress' | 'thermal' | 'services' | 'fields';
let xray: XrayMode = 'off';
let xrayT = 0;
let xrayCursor = 0;

export const counters = {
  explosions: 0, fractures: 0, snaps: 0, props: 0, eventSnaps: 0, yields: 0, rebars: 0, spalls: 0, cracks: 0, buckles: 0,
  slips: 0, fatigue: 0, creepFails: 0, melts: 0, delams: 0, crushes: 0, frozen: 0, hangs: 0, relieved: 0, hinges: 0,
};

export let onExplosion: (pos: Vec3, radius: number) => void = () => {};
export let onProtectedHit: (pos: Vec3) => void = () => {};
export function setStructureHooks(explosion: typeof onExplosion, protectedHit: typeof onProtectedHit): void {
  onExplosion = explosion;
  onProtectedHit = protectedHit;
}

export function initStructures(s: THREE.Scene): void {
  setFxFloor((x, y, z) => { const h = raycast([x, y, z], [0, -40, 0], CAT.ground | CAT.structure | CAT.debris); return h ? h.point[1] : 0; });
  initBatches(s);
  initRopes(s);
  initSoftGfx(s);
}

/* ---------------- math scratch ---------------- */
const _q: Quat = [0, 0, 0, 1];
const _q2: Quat = [0, 0, 0, 1];
const _v: Vec3 = [0, 0, 0];
const _w: Vec3 = [0, 0, 0];
const _n: Vec3 = [0, 0, 0];
const _jf: Vec3 = [0, 0, 0];
const _aabb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
const _aabb2: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
const GROUND_POS: Vec3 = [0, -0.5, 0];

function toLocal(out: Vec3, pos: Vec3, rot: Quat, pt: ArrayLike<number>): Vec3 {
  quat.conjugate(_q, rot);
  vec3.set(_v, pt[0] - pos[0], pt[1] - pos[1], pt[2] - pos[2]);
  return vec3.transformQuat(out, _v, _q);
}

function toWorld(out: Vec3, pos: Vec3, rot: Quat, local: Vec3): Vec3 {
  vec3.transformQuat(out, local, rot);
  return vec3.add(out, out, pos);
}

function dirLocal(out: Vec3, rot: Quat, dir: Vec3): Vec3 {
  quat.conjugate(_q, rot);
  return vec3.transformQuat(out, dir, _q);
}

/* ---------------- creation ---------------- */

interface NewPiece {
  mat: MaterialId;
  tint?: number;
  poly: P.Poly;
  box?: Vec3;
  cyl: P.CylInfo | null;
  pos: Vec3;
  rot: Quat;
  lin?: Vec3;
  ang?: Vec3;
  uvOrigin: Vec3;
  depth: number;
  root: Root;
  demolished: boolean;
  awake: boolean;
  volume?: number;
  char?: number;
  burning?: boolean;
  temp?: number;
  frag?: boolean;
  /** negative collision group: shards of one pane never collide with each other */
  group?: number;
  /** compound: its convex parts in the body frame (`poly` is then their envelope) */
  parts?: PartGeo[];
}

function hullShape(body: PhysEntity['body'], sd: ReturnType<typeof b3.b3DefaultShapeDef>, poly: P.Poly): b3ShapeId | null {
  const verts = P.uniqueVerts(poly);
  const hull = verts.length >= 12 && P.minWidth(poly) > 0.035 ? b3.b3CreateHull(verts) : null;
  if (!hull) return null;
  const shape = b3.b3CreateHullShape(body, sd, hull);
  b3.b3DestroyHull(hull);
  return shape;
}

function createPiece(o: NewPiece): Piece | null {
  const pm = MATS[o.mat];
  const volume = o.volume ?? (o.parts ? o.parts.reduce((v, q) => v + P.volumeCentroid(q.poly, _w), 0) : P.volumeCentroid(o.poly, _w));
  const small = volume < RUBBLE_VOL;

  const bd = b3.b3DefaultBodyDef();
  bd.type = b3.b3BodyType.b3_dynamicBody;
  bd.position = o.pos;
  bd.rotation = o.rot;
  if (o.lin) bd.linearVelocity = o.lin;
  if (o.ang) bd.angularVelocity = o.ang;
  bd.isAwake = o.awake;
  const fast = o.depth > 0 && !!o.lin && vec3.squaredLength(o.lin) > BULLET_SPEED * BULLET_SPEED && (o.volume ?? 1) < BULLET_VOL && bullets.size < MAX_BULLETS;
  bd.isBullet = fast;
  /* No artificial drag on anything heavy: a falling wall must fall at g. Small rubble keeps a
     little spin damping and rolling resistance so it beds into a pile instead of rolling off. */
  bd.linearDamping = 0;
  bd.angularDamping = small ? 0.1 : o.depth > 0 ? 0.02 : 0;
  if (o.depth > 0) bd.sleepThreshold = small ? 0.1 : 0.07;
  const body = b3.b3CreateBody(world, bd);

  const sd = b3.b3DefaultShapeDef();
  sd.density = o.root.density;
  sd.baseMaterial.friction = o.root.spec.friction ?? pm.friction;
  sd.baseMaterial.restitution = pm.restitution;
  sd.baseMaterial.rollingResistance = rolling(pm, o, small);
  const cat = small ? CAT.debris : pm.explosive || o.mat === 'crate' ? CAT.prop : CAT.structure;
  /* Service runs laid end to end never touch each other: a resting contact would join a whole mains
     network into one solver island (they conduct through service links, not contacts). */
  sd.filter = filter(cat, small ? ALL & ~CAT.player : ALL, o.group ?? (o.depth === 0 && serviceRun(o.root.spec) ? -1 : 0));
  sd.enableContactEvents = false;
  sd.enableHitEvents = volume > 0.006;

  let shape: b3ShapeId;
  let poly = o.poly, cyl = o.cyl, parts: Part[] | null = null;
  if (o.parts) {
    /* One convex shape per part; the body's mass and inertia come from all of them at once. */
    sd.updateBodyMass = false;
    parts = [];
    for (const q of o.parts) {
      const s = hullShape(body, sd, q.poly);
      if (s) parts.push({ poly: q.poly, cyl: q.cyl, shape: s });
    }
    if (!parts.length) { b3.b3DestroyBody(body); return null; }
    b3.b3Body_ApplyMassFromShapes(body);
    shape = parts[0].shape;
    if (parts.length === 1) { poly = parts[0].poly; cyl = parts[0].cyl; parts = null; }
    else if (parts.length < o.parts.length) poly = P.hullOf(parts.map(q => q.poly)) ?? poly;
  } else if (o.box) {
    shape = b3.b3CreateBoxShape(body, sd, o.box[0], o.box[1], o.box[2]);
  } else {
    const s = hullShape(body, sd, o.poly);
    if (!s) { b3.b3DestroyBody(body); return null; }
    shape = s;
  }

  const sz = o.root.spec.size, grain = sz[0] >= sz[1] && sz[0] >= sz[2] ? 0 : sz[1] >= sz[2] ? 1 : 2;
  const md = parts ? P.mergeMeshes(parts.map(q => P.buildMesh(q.poly, o.uvOrigin, q.cyl, o.mat, grain))) : P.buildMesh(poly, o.uvOrigin, cyl, o.mat, grain);
  const gfx = addPieceGfx(o.mat, o.tint, md, pieceFinish(o.root.spec));
  setPieceTransform(gfx, o.pos, o.rot);

  /* a blow breaks the part it lands on, not the whole casting: a compound is as tough as its biggest part */
  const hpVol = parts ? Math.max(...parts.map(q => P.volumeCentroid(q.poly, _w))) : volume;
  const p: Piece = {
    kind: 'piece', body, mass: b3.b3Body_GetMass(body),
    prevPos: [...o.pos], prevRot: [...o.rot], curPos: [...o.pos], curRot: [...o.rot], movedStep: -1,
    id: nextId++, shape, mat: o.mat, pm, tint: o.tint, poly, parts, volume,
    hp: pieceHp(pm, hpVol) * (1 + o.depth * FRAG_TOUGHEN), damage: 0, root: o.root, uvOrigin: o.uvOrigin, cyl, depth: o.depth,
    gfx, welds: [], rebars: [], ropes: [], spawnPos: [...o.pos], spawnRot: [...o.rot], demolished: o.demolished,
    dead: false, dirty: false, queued: false, born: clock, fade: 0, fuse: -1, sleepT: 0,
    char: o.char ?? 0, burning: false, fireT: 0, temp: o.temp ?? AMBIENT, heatK: 1, glow: 0,
    svc: memberFor(o.root.spec, !!o.frag), mechs: null, hinged: false, proxied: 0, debris: !building,
  };
  if (p.debris) debrisCount++;
  if (o.frag && lateBlasts.length) latePending.push(p);
  p.onMove = () => pieceMoved(p);
  register(p);
  if (fast) bullets.add(p);
  if (o.depth === 0 && !parts) sectionInertia(p);
  live.add(p);
  if (p.svc) svcAdd(p);
  if (!o.frag && o.root.spec.outriggers) svcRig(p);
  if (!o.frag && o.root.spec.carry) svcCarry(p);
  if (p.char > 0) applyChar(p);
  if (p.temp > 60) hot.add(p);
  if (o.burning) ignite(p);
  bury(p);
  return p;
}

/* A slender steel box taken to be a rolled section is a thinned solid with the section's real mass. While it is
   welded into a frame it keeps its solid envelope's inertia: Box3D's joint solver goes unstable when a member with
   a tenth of the rotational inertia links 40 t slabs. Once it breaks free it tumbles with its real inertia. */
const realInertia = new WeakMap<Piece, [number, number, number]>();

function sectionInertia(p: Piece): void {
  const I = autoSectionInertia(p.root.spec, p.mass);
  if (!I) return;
  realInertia.set(p, I);
  const md = b3.b3Body_GetMassData(p.body), k = p.pm.density / p.root.density, J = md.inertia;
  md.inertia = { cx: [J.cx[0] * k, J.cx[1] * k, J.cx[2] * k], cy: [J.cy[0] * k, J.cy[1] * k, J.cy[2] * k], cz: [J.cz[0] * k, J.cz[1] * k, J.cz[2] * k] };
  b3.b3Body_SetMassData(p.body, md);
}

function freeSection(p: Piece): void {
  const I = realInertia.get(p);
  if (!I || p.dead) return;
  realInertia.delete(p);
  const md = b3.b3Body_GetMassData(p.body);
  md.inertia = { cx: [I[0], 0, 0], cy: [0, I[1], 0], cz: [0, 0, I[2]] };
  b3.b3Body_SetMassData(p.body, md);
}

/* Rolling resistance (torque = coefficient × normal force × radius): angular rubble beds in rather than rolling
   away, powdery lumps crumble to a stop, flat shards and dice slide; an intact drum, pipe or column rolls freely. */
function rolling(pm: PhysMat, o: NewPiece, small: boolean): number {
  if (o.depth === 0) return o.cyl ? 0.01 : 0.02;
  const k = pm.style === 'crumble' ? 0.35 : pm.style === 'shards' || pm.style === 'dice' ? 0.12 : pm.style === 'splinter' ? 0.15 : 0.2;
  return small ? k : k * 0.4;
}

/* Continuous collision: debris flung faster than ~8 m/s crosses a 60 mm pane or a 40 mm plate in one step, and
   Box3D only sweeps dynamic-vs-dynamic for bullets. Fast fragments are bullets until they slow below 4 m/s. */
const BULLET_SPEED = 8, BULLET_VOL = 1, MAX_BULLETS = 64;
const bullets = new Set<Piece>();
function makeBullet(p: Piece): void {
  if (bullets.has(p) || bullets.size >= MAX_BULLETS || p.volume >= BULLET_VOL || p.dead) return;
  b3.b3Body_SetBullet(p.body, true);
  bullets.add(p);
}
let shardGroups = 0;

export function specPoly(spec: Pick<PieceSpec, 'size' | 'shape' | 'sides' | 'verts'>): P.Poly | null {
  const [sx, sy, sz] = spec.size;
  switch (spec.shape ?? 'box') {
    case 'cylinder': return P.cylinderPoly(sx / 2, sy);
    case 'prism': return P.cylinderPoly(sx / 2, sy, clamp(Math.round(spec.sides ?? 8), 3, 24));
    case 'wedge': return P.wedgePoly(sx / 2, sy / 2, sz / 2);
    case 'hull': return spec.verts && spec.verts.length >= 4 ? P.hullPoly(spec.verts.flat()) : null;
    default: return P.boxPoly(sx / 2, sy / 2, sz / 2);
  }
}

/* A compound's (or section's) convex parts as polytopes in the piece frame, built once per spec. */
const geoCache = new WeakMap<PieceSpec, PartGeo[] | null>();
export function specGeo(spec: PieceSpec): PartGeo[] | null {
  let g = geoCache.get(spec);
  if (g !== undefined) return g;
  const ps = specParts(spec);
  g = ps ? ps.map(partGeo).filter((q): q is PartGeo => !!q) : null;
  if (g && !g.length) g = null;
  geoCache.set(spec, g);
  return g;
}

function partGeo(q: PartSpec): PartGeo | null {
  const poly = specPoly(q);
  if (!poly) return null;
  const cyl = q.shape === 'cylinder' ? { r: q.size[0] / 2, ax: q.pos[0], az: q.pos[2] } : null;
  return { poly: P.placePoly(poly, q.rotY ?? 0, q.pos), cyl };
}

export function specVolume(spec: PieceSpec): number {
  const [sx, sy, sz] = spec.size;
  const geo = specGeo(spec);
  if (geo) return geo.reduce((v, q) => v + P.volumeCentroid(q.poly, _w), 0);
  if ((spec.shape ?? 'box') === 'box') return sx * sy * sz;
  if (spec.shape === 'cylinder') return Math.PI * (sx / 2) ** 2 * sy;
  const poly = specPoly(spec);
  return poly ? P.volumeCentroid(poly, _w) : 0;
}

function spawnSpec(spec: PieceSpec, root: Root): Piece | null {
  const rot: Quat = [0, 0, 0, 1];
  if (spec.rotY) quat.setAxisAngle(rot, [0, 1, 0], spec.rotY);
  const shape = spec.shape ?? 'box';
  const [sx, sy, sz] = spec.size;
  const uvOrigin = toLocal([0, 0, 0], [0, 0, 0], rot, spec.pos);
  const geo = specGeo(spec);
  if (geo) {
    const env = geo.length > 1 ? P.hullOf(geo.map(q => q.poly)) : geo[0].poly;
    if (!env) return null;
    return createPiece({
      mat: spec.mat, tint: spec.tint, poly: env, parts: geo.length > 1 ? geo : undefined, cyl: geo.length > 1 ? null : geo[0].cyl,
      pos: [...spec.pos], rot, uvOrigin, depth: 0, root, demolished: false, awake: true, volume: root.volume,
    });
  }
  const poly = specPoly(spec);
  if (!poly) return null;
  return createPiece({
    mat: spec.mat, tint: spec.tint, poly, box: shape === 'box' ? [sx / 2, sy / 2, sz / 2] : undefined,
    cyl: shape === 'cylinder' ? { r: sx / 2, ax: 0, az: 0 } : null,
    pos: [...spec.pos], rot, uvOrigin, depth: 0, root, demolished: false, awake: true, volume: root.volume,
  });
}

/* ---------------- joints: capacities ---------------- */

function armFor(area: number): number {
  return clamp(Math.sqrt(area), 0.2, 1.5);
}

/* The weaker side governs each failure mode; the ground acts as a foundation twice the piece's strength.
   Timber and plywood are judged at their angle to the grain: a connection pulled across it splits the
   member at about a third of its along-grain strength. */
function jointCaps(a: PhysMat, b: PhysMat | null, area: number, ga = ISO_GRAIN, gb = ISO_GRAIN): Caps {
  const ten = Math.min(a.bond * ga.ten, b ? b.bond * gb.ten : a.bond * ga.ten * 2) * area;
  const comp = Math.min(a.crush * ga.comp, b ? b.crush * gb.comp : a.crush * ga.comp * 2) * area;
  return {
    ten,
    comp,
    shear: Math.min(a.cohesion, b ? b.cohesion : a.cohesion * 2) * area,
    torque: (ten + 0.12 * comp) * armFor(area) * 0.5,
  };
}

const ISO_GRAIN = { comp: 1, ten: 1 };
const _g: Vec3 = [0, 0, 0];

/* Share of the along-grain strength a member offers at a face with world normal n. */
function grainAt(p: Piece, n: Vec3): { comp: number; ten: number } {
  const perp = p.pm.eng.perp;
  if (!perp) return ISO_GRAIN;
  const s = p.root.spec.size;
  const k = perp.along === 'axis'
    ? (s[0] >= s[1] && s[0] >= s[2] ? 0 : s[1] >= s[2] ? 1 : 2)
    : (s[0] <= s[1] && s[0] <= s[2] ? 0 : s[1] <= s[2] ? 1 : 2);
  const c = dirLocal(_g, p.curRot, n)[k];
  return grainShare(p.pm, perp.along === 'axis' ? c * c : 1 - c * c);
}

/* Real strength of a connection: the material envelope in real units (masonry bond ~0.3 MPa, C30 crushing
   38 MPa), which the calibrated game capacities deliberately sit far below. */
function realCaps(a: Piece, b: Piece | null, area: number, n: Vec3): Caps {
  const c = jointCaps(a.pm, b ? b.pm : null, area, grainAt(a, n), b ? grainAt(b, n) : ISO_GRAIN);
  const ten = c.ten * REAL_SCALE.ten, comp = c.comp * REAL_SCALE.comp;
  return { ten, comp, shear: c.shear * REAL_SCALE.shear, torque: (ten + 0.12 * comp) * armFor(area) * 0.5 };
}

function isRebar(a: PhysMat, b: PhysMat | null): boolean {
  if (!a.rebar && !(b && b.rebar)) return false;
  return !b || (a.rebar && b.rebar) || (a.rebar && b.ductile) || (b.rebar && a.ductile);
}

function applyCaps(w: Weld): void {
  const k = Math.min(w.a.heatK, w.b ? w.b.heatK : 1) * (w.yielded ? overstrength(w) : 1) * jointMul * (1 - DMG_SOFTEN * w.dmg) * w.j.heatK;
  w.cap.comp = w.base.comp * k;
  w.cap.ten = w.base.ten * k;
  w.cap.shear = w.base.shear * k;
  w.cap.torque = w.base.torque * k;
  if (building || w.calib) return;
  b3.b3Joint_SetForceThreshold(w.joint, w.cap.comp);
  b3.b3Joint_SetTorqueThreshold(w.joint, w.cap.torque + thrustMoment(w, w.sN));
}

/* Steel strain-hardens well past yield; a cracked RC hinge has little reserve once its bars yield. */
function overstrength(w: Weld): number {
  return w.metal ? ULTIMATE : 1.12;
}

function sideOf(p: Piece): J.Side {
  return { mat: p.mat, pm: p.pm, spec: p.root.spec, dims: pieceDims(p), vol: p.volume, mass: p.mass };
}

/* `fresh`: caps are the members' own contact envelope (autoWeld), to be scaled to what the connection really holds. */
function createWeld(a: Piece, b: Piece | null, pt: Vec3, normalWorld: Vec3, area: number, caps: Caps, fresh = false): Weld | null {
  if (a === b || a.dead || b?.dead) return null;
  const env = realCaps(a, b, area, normalWorld);
  const sa = sideOf(a), sb = b ? sideOf(b) : null;
  const kind = J.inferKind(sa, sb, !!b && a.root === b.root);
  const { j, real } = J.makeJoint(kind, sa, sb, area, env);
  if (fresh) {
    const r = J.connRatio(real, env, kind, !!(a.root.spec.joint?.kind ?? b?.root.spec.joint?.kind));
    caps = { comp: caps.comp, ten: caps.ten * r.ten, shear: caps.shear * r.shear, torque: caps.torque * r.torque };
  }
  /* Bonded brickwork has no continuous vertical joint: a plane across the courses runs through staggered units and
     head joints, so it holds several times what a bed does (EN 1996 fxk2 ≈ 3-4 × fxk1). The members' vertical faces
     are that plane cut coarse, not a mortar joint. */
  if (b && kind === 'mortar' && ARCH_MATS.has(a.mat) && ARCH_MATS.has(b.mat) && Math.abs(normalWorld[1]) < 0.5)
    caps = { comp: caps.comp, ten: caps.ten * HEAD_BOND, shear: caps.shear * HEAD_BOND, torque: caps.torque * HEAD_BOND };
  j.t = j.t0 = clock;
  J.updateHeatK(j, Math.max(a.temp, b ? b.temp : AMBIENT));
  const jd = b3.b3DefaultWeldJointDef();
  jd.base.bodyIdA = a.body;
  jd.base.bodyIdB = b ? b.body : ground;
  const la = toLocal([0, 0, 0], a.curPos, a.curRot, pt);
  const fa: Frame = { position: la, quaternion: quat.conjugate([0, 0, 0, 1], a.curRot) as Quat };
  const fb: Frame = b
    ? { position: toLocal([0, 0, 0], b.curPos, b.curRot, pt), quaternion: quat.conjugate([0, 0, 0, 1], b.curRot) as Quat }
    : { position: [pt[0] - GROUND_POS[0], pt[1] - GROUND_POS[1], pt[2] - GROUND_POS[2]], quaternion: [0, 0, 0, 1] };
  jd.base.localFrameA = fa;
  jd.base.localFrameB = fb;
  jd.base.forceThreshold = building ? 3e38 : caps.comp;
  jd.base.torqueThreshold = building ? 3e38 : caps.torque;
  jd.base.collideConnected = false;
  const joint = b3.b3CreateWeldJoint(world, jd);
  const metal = a.pm.ductile && (b ? b.pm.ductile : true);
  const rebar = isRebar(a.pm, b ? b.pm : null);
  /* Nailed and pegged timber joints rack a little before they pull out or the member snaps. */
  const timber = a.pm.style === 'splinter' && (!b || b.pm.style === 'splinter');
  /* a capillary socket outholds its tube cold, so a bent copper line hinges in the tube beside it; only heat-softened
     solder lets go (failWeld) */
  const ductile = (metal || rebar || timber) && kind !== 'glue';
  const w: Weld = {
    joint, a, b, local: la, n: dirLocal([0, 0, 0], a.curRot, normalWorld), area,
    mu: Math.min(a.pm.eng.mu, b ? b.pm.eng.mu : a.pm.eng.mu),
    base: { ...caps }, cap: { ...caps }, ductile, metal, yielded: false, plastic: 0,
    limit: metal ? clamp(Math.min(a.pm.eng.ductility, b ? b.pm.eng.ductility : 1) * 4.5, 0.35, 0.9) : rebar ? 0.22 : timber ? 0.12 : 0,
    rebar, fa, fb, lastOver: -9, overSteps: 0, polled: -1, util: 0, quiet: 0, reyields: 0, calib: false, alive: true,
    supportForce: 0, supportTorque: 0, sN: 0, sV: 0, sd0: 0, calm: 0, dmg: 0, real, j,
  };
  welds.set(joint.index1, w);
  a.welds.push(w);
  b?.welds.push(w);
  supportDirty = true;
  analysisTouch(a); analysisTouch(b);
  if (b && a.svc && b.svc) svcLink(a, b, pt, normalWorld);
  if (kind === 'mount') mountSpring(w);
  if (!building && (a.heatK < 1 || (b && b.heatK < 1) || j.heatK < 1)) applyCaps(w);
  return w;
}

/* A bonded rubber mount is a soft, damped spring rather than a rigid weld: what sits on it bounces at a few hertz. */
function mountSpring(w: Weld): void {
  const r = w.a.mat === 'rubber' ? w.a : w.b?.mat === 'rubber' ? w.b : null;
  const load = r === w.a ? w.b : w.a;
  if (!r || !load || load.mat === 'rubber') return;
  const d = pieceDims(r), k = (r.pm.eng.E * 1e9 * w.area) / Math.max(0.01, Math.min(d[0], d[1], d[2]));
  const fn = clamp(Math.sqrt(k / Math.max(load.mass, 1)) / (2 * Math.PI), 2, 30);
  b3.b3WeldJoint_SetLinearHertz(w.joint, fn);
  b3.b3WeldJoint_SetLinearDampingRatio(w.joint, 0.3);
  b3.b3WeldJoint_SetAngularHertz(w.joint, fn * 0.7);
  b3.b3WeldJoint_SetAngularDampingRatio(w.joint, 0.3);
}

/* Where the structure last changed: the members of a lost connection, the step it went. */
const lostAt = new WeakMap<Piece, number>();
const RECENT = 30;
function recentlyLost(p: Piece | null): boolean {
  const t = p ? lostAt.get(p) : undefined;
  return t !== undefined && stepCount - t <= RECENT;
}
/** A connection of p's or of a member welded to it was lost in the last half second. */
function besideChange(p: Piece | null): boolean {
  if (!p) return false;
  if (recentlyLost(p)) return true;
  for (const v of p.welds) if (recentlyLost(v.a === p ? v.b : v.a)) return true;
  return false;
}

function killWeld(w: Weld, destroyJoint: boolean): void {
  if (!w.alive) return;
  lostAt.set(w.a, stepCount);
  if (w.b) lostAt.set(w.b, stepCount);
  w.alive = false;
  yielding.delete(w);
  supportPressure.delete(w);
  supportDirty = true;
  analysisTouch(w.a); analysisTouch(w.b);
  if (welds.get(w.joint.index1) === w) welds.delete(w.joint.index1);
  const ia = w.a.welds.indexOf(w);
  if (ia >= 0) w.a.welds.splice(ia, 1);
  if (w.b) {
    const ib = w.b.welds.indexOf(w);
    if (ib >= 0) w.b.welds.splice(ib, 1);
    if (!w.b.welds.length) { freeSection(w.b); rubble(w.b); }
  }
  if (!w.a.welds.length) { freeSection(w.a); rubble(w.a); }
  if (destroyJoint && b3.b3Joint_IsValid(w.joint)) b3.b3DestroyJoint(w.joint, true);
  if (!w.b && !w.a.dead) groundLost(w.a);
  // the member that lost what it stood on: is it left hanging off its sides?
  if (!building) {
    weldNormal(w, _hn);
    if (_hn[1] <= -0.5) queueHang(w.a);
    else if (_hn[1] >= 0.5 && w.b) queueHang(w.b);
    // a deck's bearings are its edges, whichever way their joints face
    if (!w.a.dead && isDeck(w.a)) queueHang(w.a);
    if (w.b && !w.b.dead && isDeck(w.b)) queueHang(w.b);
  }
}

/* A timber floor, ceiling or roof deck: flat, lying level. It bears on its edges (joists in pockets, plates on the
   walls), so its joints face sideways; what it cannot do is cantilever. */
const DECK_MATS = new Set<MaterialId>(['wood', 'plywood', 'roof']);
const _dmn: Vec3 = [0, 0, 0], _dmx: Vec3 = [0, 0, 0], _dax: Vec3 = [0, 0, 0];
function deckAxes(p: Piece): number {
  P.bounds(p.poly, _dmn, _dmx);
  const d = [_dmx[0] - _dmn[0], _dmx[1] - _dmn[1], _dmx[2] - _dmn[2]];
  const t = d[0] <= d[1] && d[0] <= d[2] ? 0 : d[1] <= d[2] ? 1 : 2;
  const o = [d[(t + 1) % 3], d[(t + 2) % 3]];
  if (d[t] > 0.35 || Math.min(o[0], o[1]) < 1.2) return -1;
  return t;
}
function isDeck(p: Piece): boolean {
  if (!DECK_MATS.has(p.mat) || p.volume < 0.05) return false;
  const t = deckAxes(p);
  if (t < 0) return false;
  vec3.set(_dax, t === 0 ? 1 : 0, t === 1 ? 1 : 0, t === 2 ? 1 : 0);
  vec3.transformQuat(_dax, _dax, p.curRot);
  return Math.abs(_dax[1]) > 0.85;
}
/* the joints left on a deck hold it up only from both sides of its centre, along one span or the other */
const _dw: Vec3 = [0, 0, 0], _du: Vec3 = [0, 0, 0];
function deckHeld(p: Piece): boolean {
  const t = deckAxes(p);
  for (const k of [(t + 1) % 3, (t + 2) % 3]) {
    const half = (_dmx[k] - _dmn[k]) / 2;
    vec3.set(_du, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
    vec3.transformQuat(_du, _du, p.curRot);
    let lo = Infinity, hi = -Infinity;
    for (const w of p.welds) {
      weldPos(w, _dw);
      const s = (_dw[0] - p.curPos[0]) * _du[0] + (_dw[1] - p.curPos[1]) * _du[1] + (_dw[2] - p.curPos[2]) * _du[2];
      lo = Math.min(lo, s); hi = Math.max(hi, s);
    }
    if (lo < -0.25 * half && hi > 0.25 * half) return true;
  }
  return false;
}

/* Brickwork, stone and timber stand on what is below them. A member that has lost every connection beneath it and is
   left held only by its sides or from above (a wall lift over a blown-out storey, a floor whose far bearing went, a
   window frame over a lost sill) is hanging on mortar in shear and nails in withdrawal: it does not hang for seconds,
   it shears off and drops. Steel and reinforced members can hang off their connections and are left to them. */
/* what bears on what is below it: masonry, and timber floors, joists and roofs (glazing, cladding, fittings and
   steel hang off their fixings by design) */
const HANG_MATS = new Set<MaterialId>(['brick', 'stone', 'sandstone', 'cinderblock', 'adobe', 'terracotta', 'wood', 'plywood', 'roof']);
const hangQueue = new Map<Piece, number>();   // piece -> the step to look at it
const hangLooks = new WeakMap<Piece, number>();
const HANG_PER_STEP = 24, HANG_RELOOK = 15, HANG_LOOKS = 4;
const _hn: Vec3 = [0, 0, 0], _hb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
function queueHang(p: Piece, at = stepCount): void {
  if (p.dead || building) return;
  const due = hangQueue.get(p);
  if (due === undefined || due > at) hangQueue.set(p, at);
}
function checkHanging(): void {
  let n = 0;
  for (const [p, due] of hangQueue) {
    if (due > stepCount) continue;
    if (++n > HANG_PER_STEP) break;
    hangQueue.delete(p);
    if (p.dead || !HANG_MATS.has(p.mat) || p.root.prop || p.mechs || p.ropes.length || p.hinged || hingeOf.get(p)?.live) continue;
    // what it stood on may still be falling away when its joints go: look again a few times
    const looks = (hangLooks.get(p) ?? 0) + 1;
    hangLooks.set(p, looks);
    if (looks < HANG_LOOKS && hasDetail(p)) queueHang(p, stepCount + HANG_RELOOK);
    if (p.welds.length) {
      let below = false, metal = false;
      for (const w of p.welds) {
        if (w.metal) { metal = true; break; }
        weldNormal(w, _hn);
        if ((w.a === p ? _hn[1] : -_hn[1]) <= -0.5) { below = true; break; }
      }
      if (metal) continue;
      if (isDeck(p)) below = deckHeld(p);
      else if (!below) below = spansGap(p);
      /* a cracked bed still bears: a unit sitting on what is under it is not hanging, however its mortar went */
      if (!below && bearsOnContact(p)) {
        below = true;
        const n = (bearLooks.get(p) ?? 0) + 1;
        bearLooks.set(p, n);
        if (n < BEAR_LOOKS) queueHang(p, stepCount + BEAR_RELOOK);
      }
      if (!below) {
        counters.hangs++;
        for (const w of p.welds.slice()) failWeld(w, 'overload', false);
      }
    }
    if (!p.dead && hasDetail(p) && ARCH_MATS.has(p.mat)) relieve(p);
  }
}

const _hbn: Vec3 = [0, 0, 0];
function heldBelow(p: Piece): boolean {
  for (const w of p.welds) {
    weldNormal(w, _hbn);
    if ((w.a === p ? _hbn[1] : -_hbn[1]) <= -0.5) return true;
  }
  return false;
}
/* A short unit bonded on both sides to neighbours in its own course that still stand on something spans the gap
   under it as a lintel or a flat arch: the course over a notch cut in a chimney shaft, a ring closed on itself, stays
   up and carries the stack to the remaining arc of the section, as brickwork over a felling notch does. A long lift
   over a lost storey is not one (checkHanging drops it, relieve() arches what is over the gap). */
const bearLooks = new WeakMap<Piece, number>();
const BEAR_LOOKS = 12, BEAR_RELOOK = 30;
const _bb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
/** Something lies right under the middle of the member's bed (its outer 30% each way is left out, so the neighbours
    of a unit over a gap do not count as its support). */
function bearsOnContact(p: Piece): boolean {
  b3.b3Body_ComputeAABB(_hb, p.body);
  const y0 = _hb[1];
  if (y0 < 0.05) return true;
  const mx = (_hb[3] - _hb[0]) * 0.3, mz = (_hb[5] - _hb[2]) * 0.3;
  let found = false;
  overlapAABB([_hb[0] + mx, y0 - 0.08, _hb[2] + mz], [_hb[3] - mx, y0 + 0.05, _hb[5] - mz], CAT.structure | CAT.debris | CAT.prop, shape => {
    if (found) return;
    const e = entityOfShape(shape);
    if (!e || e === p || e.kind !== 'piece' || (e as Piece).dead) return;
    b3.b3Shape_GetAABB(_bb, shape);
    if (_bb[4] > y0 - 0.08 && _bb[4] < y0 + 0.1) found = true;
  });
  return found;
}
const SPAN_MAX = 2.4;
const _abut: number[] = [];
function spansGap(p: Piece): boolean {
  if (!ARCH_MATS.has(p.mat)) return false;
  const d = pieceDims(p);
  if (Math.max(d[0], d[1], d[2]) > SPAN_MAX) return false;
  _abut.length = 0;
  for (const w of p.welds) {
    const q = w.a === p ? w.b : w.a;
    if (!q || q.dead) continue;
    weldNormal(w, _hn);
    if (Math.abs(_hn[1]) > 0.5 || !heldBelow(q)) continue;
    const s = w.a === p ? 1 : -1, l = Math.hypot(_hn[0], _hn[2]) || 1;
    const x = (_hn[0] * s) / l, z = (_hn[2] * s) / l;
    for (let k = 0; k < _abut.length; k += 2) if (x * _abut[k] + z * _abut[k + 1] < -0.3) return true;
    _abut.push(x, z);
  }
  return false;
}

/* ---------------- felling hinge ---------------- */

/* A free-standing masonry stack (a chimney, a boiler stack) with part of its section cut or blown out of one side
   stands or goes over as a whole section, not joint by joint: a bed round a ring of brickwork is one continuous
   bonded section, and a unit overloaded next to a notch hands its load round the ring. Whether it goes is the
   section's limit: the stack's weight must be carried by a compression zone at the crushing capacity of the bed
   (the capacity its joints were built with), and the furthest the weight can move off centre is the centroid of the
   smallest such zone at the edge of what it still bears on. While its weight lies inside that, the stack stands;
   once a notch has moved the bearing far enough from under the weight, the stack turns about that compression zone,
   which is the hinge: the brickwork over the notch crushes and the stack sits down into it, the uncut side opens in
   tension, and the hinge holds the stack in shear and against turning sideways, by its width, until the notch closes
   on it or it is well over; then it tears free and the stack falls on along that line. The shaft over the hinge is a
   tube and turns as one until then. (collapse/chimney-felling: the stack rotates about the hinge at the notch as a
   stiff rod, sits down first, and lands along the fall line.) */
const HINGE = { tall: 4, slender: 1.5, release: 0.8, closed: 0.1, turning: 0.001, back: -0.03, limit: 1.1, tol: 0.12, island: 800, masonry: 0.7, watch: 150, look: 2, dirs: 36, reserve: 1.5, zone: 0.6, early: 0.1, still: 0.03, veer: 0.05, relook: 10, jam: 3 };
interface FellHinge {
  joints: { j: b3JointId; q: Piece }[]; pieces: Piece[]; welds: Weld[]; axis: Vec3; qa: Quat; P0: Vec3; R: number; t0: number; live: boolean;
  /** the way it is going, a member of it to look from, the step it was last looked at */
  peak: number; d: P2; seed: Piece; look: number;
  /** its heaviest member and how that stood when the hinge formed: the stack's turn is read off it */
  ref: Piece; ref0: Quat;
  /** its turn at the last step, the most it has turned in one, and for how many steps it has been checked */
  prev: number; wmax: number; stall: number;
}
const hinges: FellHinge[] = [];
const hingeOf = new WeakMap<Piece, FellHinge>();
const hingeJoints = new Map<number, FellHinge>();
/** pieces whose support was blown out from under them: the step to look at them again, until when */
const hingeWatch = new Map<Piece, { at: number; until: number }>();
const _hy: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

/** Plan outlines of a piece's (or each of a compound's parts') faces lying on the level y0. */
function planeFaces(p: Piece, y0: number, tol: number): P2[][] {
  const out: P2[][] = [];
  for (const poly of p.parts ? p.parts.map(q => q.poly) : [p.poly]) {
    const pts: P2[] = [];
    for (const f of worldPoly(p, poly).faces) {
      for (let i = 0; i < f.pts.length; i += 3) if (Math.abs(f.pts[i + 1] - y0) < tol) pts.push([f.pts[i], f.pts[i + 2]]);
    }
    const h = hull2(pts);
    if (h.length >= 3 && area2(h).a > 1e-4) out.push(h);
  }
  return out;
}

/** Still standing where it was built: not shifted, tilted or moving (a stack that is already falling is past hinging). */
function standing(p: Piece): boolean {
  if (vec3.squaredDistance(p.curPos, p.spawnPos) > 0.5 * 0.5 || Math.abs(quat.dot(p.curRot, p.spawnRot)) < STAND_TILT) return false;
  b3.b3Body_GetLinearVelocity(_sv, p.body);
  return vec3.squaredLength(_sv) < 1;
}
const STAND_TILT = Math.cos(0.1 / 2), _sv: Vec3 = [0, 0, 0];

/** Part of the base, bearing: a member (or a broken piece of one) still where it was made and not moving (one a blast
    has knocked loose is on its way out, not bearing), and not about to break. */
function founded(p: Piece): boolean {
  if (p.dead || p.queued || vec3.squaredDistance(p.curPos, p.spawnPos) > 0.1 * 0.1) return false;
  b3.b3Body_GetLinearVelocity(_sv, p.body);
  return vec3.squaredLength(_sv) < 0.5 * 0.5;
}

/** The welded island of members over the level y0 that `seed` belongs to, and its welds to what is under the level;
    null when it is held any other way (welded to the ground, part of a stack already felled, or too big to be one). */
const heldAt = new WeakMap<Piece, number>();
function islandOver(seed: Piece, y0: number, own?: FellHinge): { pieces: Piece[]; set: Set<Piece>; cross: Weld[] } | null {
  if (!own && heldAt.get(seed) === stepCount) return null;
  const set = new Set<Piece>([seed]), pieces = [seed], cross: Weld[] = [];
  const held = (): null => { for (const q of pieces) heldAt.set(q, stepCount); return null; };
  for (let i = 0; i < pieces.length; i++) {
    const q = pieces[i];
    if ((hingeOf.has(q) && hingeOf.get(q) !== own) || (!own && heldAt.get(q) === stepCount)) return held();
    for (const v of q.welds) {
      if (!v.alive) continue;
      const o = v.a === q ? v.b : v.a;
      if (!o) return held();
      if (set.has(o)) continue;
      if (o.curPos[1] <= y0) { cross.push(v); continue; }
      if (pieces.length >= HINGE.island) return held();
      set.add(o);
      pieces.push(o);
    }
  }
  return { pieces, set, cross };
}

interface Section {
  pieces: Piece[]; set: Set<Piece>; cross: Weld[]; M: number; C: P2; y0: number;
  /** where it still bears (plan polygons) and their area; its own full bearing footprint; the bed's crushing stress */
  regions: P2[][]; A: number; A0: number; sigma: number; R: number;
  /** the member under each region */
  under: Piece[];
}

/** The stack over the level y0 under `seed` and what it bears on there; null if it is not a free-standing stack. */
function stackSection(seed: Piece, y0: number, lower: Set<Piece>, own?: FellHinge): Section | null {
  if (!own && !standing(seed)) return null;
  const isl = islandOver(seed, y0, own);
  if (!isl) return null;
  const { pieces, set, cross } = isl;
  let M = 0, mm = 0, cx = 0, cz = 0, top = -Infinity;
  for (const q of pieces) {
    M += q.mass;
    if (ARCH_MATS.has(q.mat)) mm += q.mass;
    cx += q.mass * q.curPos[0]; cz += q.mass * q.curPos[2];
    b3.b3Body_ComputeAABB(_hy, q.body);
    top = Math.max(top, _hy[4]);
  }
  if (M <= 0 || mm < HINGE.masonry * M || top - y0 < HINGE.tall) return null;
  // only a free-standing stack as built (a pier or a wall standing loose in a wreck is left to its contacts)
  let sm = 0;
  for (const q of pieces) if (inStack(q)) sm += q.mass;
  if (sm < 0.5 * M) return null;
  // its own bed: the faces of its lowest members lying on the level
  const base = pieces.filter(q => { b3.b3Body_ComputeAABB(_hy, q.body); return _hy[1] < y0 + HINGE.tol; });
  const ups = base.flatMap(q => planeFaces(q, y0, HINGE.tol));
  if (!ups.length) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, A0 = 0;
  for (const u of ups) {
    A0 += area2(u).a;
    for (const [x, z] of u) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  }
  if (top - y0 < HINGE.slender * Math.max(x1 - x0, z1 - z0)) return null;
  // what it bears on: founded members whose tops lie on the level under its bed (its welds across the level, and any
  // it only rests on)
  for (const v of cross) { const o = set.has(v.a) ? v.b : v.a; if (o) lower.add(o); }
  overlapAABB([x0, y0 - 0.15, z0], [x1, y0 + 0.05, z1], CAT.structure, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece' || set.has(e as Piece)) return;
    b3.b3Shape_GetAABB(_bb, shape);
    if (Math.abs(_bb[4] - y0) < HINGE.tol) lower.add(e as Piece);
  });
  /* where it bears, in plan: under its bed on the level, and at each of its joints to the founded members under it,
     wherever they are (a notch cut part way up a course leaves the bed stepped) */
  const regions: P2[][] = [], under: Piece[] = [];
  let A = 0;
  const add = (us: P2[][], ds: P2[][], o: Piece) => {
    for (const u of us) for (const d of ds) {
      const c = clip2(u, d);
      if (c.length < 3) continue;
      const a = area2(c).a;
      if (a < 1e-4) continue;
      regions.push(c);
      under.push(o);
      A += a;
    }
  };
  const ok = new Map<Piece, boolean>(), isFounded = (q: Piece) => { let f = ok.get(q); if (f === undefined) ok.set(q, f = !set.has(q) && founded(q)); return f; };
  for (const q of lower) if (isFounded(q)) add(ups, planeFaces(q, y0, HINGE.tol), q);
  const pairs = new Set<string>();
  for (const v of cross) {
    const u = set.has(v.a) ? v.a : v.b!, o = u === v.a ? v.b! : v.a;
    const y = weldPos(v, _v)[1];
    if (Math.abs(y - y0) < HINGE.tol || !isFounded(o)) continue;
    const key = `${u.id}:${o.id}:${Math.round(y * 10)}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    add(planeFaces(u, y, HINGE.tol), planeFaces(o, y, HINGE.tol), o);
  }
  /* the bed's crushing stress, at the game's scale of masonry strength: the reserve an old stack's beds keep over
     its own weight on its full bed (the calibration's ~2x, over a crushing stress block ~0.7-0.9 of the peak) */
  const sigma = (HINGE.reserve * M * 9.81) / A0;
  const C: P2 = [cx / M, cz / M];
  const R = Math.max(x1 - x0, z1 - z0) / 2;
  return { pieces, set, cross, M, C, y0, regions, A, A0, sigma, R, under };
}

/** Area and centroid of the part of the regions beyond the line x·d = t. */
function beyond(regions: P2[][], d: P2, t: number): { a: number; c: P2 } {
  // clip each polygon to the half-plane x·d ≥ t: a huge square on that side of the line
  const n: P2 = [-d[1], d[0]], big = 1e4;
  const o: P2 = [d[0] * t, d[1] * t];
  const half: P2[] = [
    [o[0] - n[0] * big, o[1] - n[1] * big], [o[0] - n[0] * big + d[0] * big, o[1] - n[1] * big + d[1] * big],
    [o[0] + n[0] * big + d[0] * big, o[1] + n[1] * big + d[1] * big], [o[0] + n[0] * big, o[1] + n[1] * big],
  ];
  let a = 0, cx = 0, cz = 0;
  for (const r of regions) {
    const c = clip2(r, half);
    if (c.length < 3) continue;
    const s = area2(c);
    a += s.a; cx += s.a * s.c[0]; cz += s.a * s.c[1];
  }
  return a > 0 ? { a, c: [cx / a, cz / a] } : { a: 0, c: [o[0], o[1]] };
}

/** The smallest compression zone at the edge of the bearing along d that carries the weight (area Ac), its centroid,
    and how far the weight lies past it. */
function zoneAlong(s: Section, d: P2, Ac: number): { d: P2; zone: P2; margin: number } {
  let lo = Infinity, hi = -Infinity;
  for (const r of s.regions) for (const p of r) { const t = p[0] * d[0] + p[1] * d[1]; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  let a0 = lo, a1 = hi;
  for (let it = 0; it < 22; it++) {
    const m = (a0 + a1) / 2;
    if (beyond(s.regions, d, m).a > Ac) a0 = m; else a1 = m;
  }
  const z = beyond(s.regions, d, a0);
  return { d, zone: z.c, margin: s.C[0] * d[0] + s.C[1] * d[1] - (z.c[0] * d[0] + z.c[1] * d[1]) };
}

/** Is the stack's weight beyond what its bearing can carry, and which way: the direction in which the weight lies
    furthest past the centroid of the smallest compression zone at the bearing's edge, and that zone. */
function tipping(s: Section): { d: P2; zone: P2; margin: number } | 'stands' | 'crushes' {
  const Ac = (s.M * 9.81) / Math.max(s.sigma, 1);
  // overloaded over all it bears on: it crushes where it stands (its joints go), it does not turn over a notch
  if (s.A <= 0 || !s.regions.length || Ac >= 0.9 * s.A) return 'crushes';
  const at = (th: number) => zoneAlong(s, [Math.cos(th), Math.sin(th)], Ac);
  let best = at(0), bth = 0;
  for (let k = 1; k < HINGE.dirs; k++) {
    const th = (2 * Math.PI * k) / HINGE.dirs, r = at(th);
    if (r.margin > best.margin) { best = r; bth = th; }
  }
  if (best.margin <= 0) return 'stands';
  // refine to a degree either side
  for (let dth = -5; dth <= 5; dth++) {
    if (!dth) continue;
    const r = at(bth + (dth * Math.PI) / 180);
    if (r.margin > best.margin) best = r;
  }
  return best;
}

/** The hinge: the stack's welds across the level go; its members over the compression zone are pinned to the founded
    base on an axis through the zone, square to the way it is going. */
function formHinge(s: Section, t: { d: P2; zone: P2 }): void {
  const [dx, dz] = t.d;
  const axis: Vec3 = [dz, 0, -dx];
  const qa = quat.rotationTo([0, 0, 0, 1], [0, 0, 1], axis) as Quat;
  const P0: Vec3 = [t.zone[0], s.y0, t.zone[1]];
  for (const v of s.cross) killWeld(v, true);
  crushAhead(s, t.d, t.zone);
  // the shaft turns as one tube while it is on its hinge: its own joints are held until it tears free
  const welds: Weld[] = [];
  for (const q of s.pieces) for (const v of q.welds) if (v.alive && !v.calib && v.a === q && v.b && s.set.has(v.b)) {
    v.calib = true;
    b3.b3Joint_SetForceThreshold(v.joint, 3e38);
    b3.b3Joint_SetTorqueThreshold(v.joint, 3e38);
    welds.push(v);
  }
  const ref = s.pieces.reduce((a, b) => (b.mass > a.mass ? b : a));
  const hg: FellHinge = {
    joints: [], pieces: s.pieces, welds, axis, qa, P0, R: s.R, t0: clock, live: true, peak: 0, d: t.d, seed: s.pieces[0],
    look: stepCount, ref, ref0: [...ref.curRot] as Quat, prev: 0, wmax: 0, stall: 0,
  };
  for (const q of s.pieces) hingeOf.set(q, hg);
  hinges.push(hg);
  counters.hinges++;
  pinHinge(hg, 2);
}

/* The brickwork it bears on ahead of the hinge takes the whole weight at the edge of the notch and crushes: the stack
   sits down into its notch as it starts to turn. */
function crushAhead(s: Section, d: P2, zone: P2): void {
  const tz = zone[0] * d[0] + zone[1] * d[1];
  for (let i = 0; i < s.regions.length; i++) {
    const low = s.under[i], c = area2(s.regions[i]).c;
    if (c[0] * d[0] + c[1] * d[1] <= tz + 0.05 * s.R || low.dead || low.queued || low.pm.style === 'none') continue;
    low.queued = true;
    fractureQueue.push({ p: low, point: [c[0], s.y0, c[1]], intensity: 1.5, blast: false });
  }
}

/* While a stack has barely begun to turn, what it bears on keeps changing under it (the toe crushing through, more of
   the notch shot or blown out). Before it has moved the section is judged afresh, the way it goes too; once it is
   turning, the compression zone and the hinge with it only move back from the notch, never forward. */
function rezone(hg: FellHinge): void {
  if (hg.seed.dead) {
    const alive = hg.pieces.filter(q => !q.dead);
    if (!alive.length) return;
    hg.seed = alive.reduce((a, b) => (Math.abs(b.curPos[1] - hg.P0[1]) < Math.abs(a.curPos[1] - hg.P0[1]) ? b : a));
  }
  const s = stackSection(hg.seed, hg.P0[1], new Set(), hg);
  if (!s) return;
  let d = hg.d, z: P2 | null;
  if (hg.peak < HINGE.still) {
    const t = tipping(s);
    if (t === 'stands' || t === 'crushes') return;
    d = t.d;
    z = t.zone;
  } else {
    const Ac = (s.M * 9.81) / Math.max(s.sigma, 1);
    z = s.A > Ac ? zoneAlong(s, d, Ac).zone : s.regions.length ? area2(hull2(s.regions.flat())).c : null;
  }
  if (!z) return;
  const turned = d[0] * hg.d[0] + d[1] * hg.d[1] < Math.cos(HINGE.veer);
  const back = (hg.P0[0] - z[0]) * d[0] + (hg.P0[2] - z[1]) * d[1];
  if (!turned && back < 0.1) return;
  crushAhead(s, d, z);
  // pinned afresh on the new line
  for (const { j } of hg.joints) if (b3.b3Joint_IsValid(j)) { hingeJoints.delete(j.index1); b3.b3DestroyJoint(j, true); }
  hg.joints.length = 0;
  hg.d = d;
  hg.axis = [d[1], 0, -d[0]];
  hg.qa = quat.rotationTo([0, 0, 0, 1], [0, 0, 1], hg.axis) as Quat;
  hg.P0 = [z[0], hg.P0[1], z[1]];
  hg.ref0 = [...hg.ref.curRot] as Quat;
  hg.prev = hg.peak = hg.wmax = 0;
  hg.t0 = clock;
  pinHinge(hg, 2);
}

/** Pin the members of the stack nearest the hinge axis to the base (at least `min`; more over the zone). */
function pinHinge(hg: FellHinge, min: number): void {
  const [ax, , az] = hg.axis, P0 = hg.P0;
  const off = (q: Piece) => Math.abs((q.curPos[0] - P0[0]) * az - (q.curPos[2] - P0[2]) * ax) + Math.max(0, q.curPos[1] - P0[1] - 1.5);
  const have = new Set(hg.joints.map(x => x.q));
  // members of the tube itself (not a loose unit or a sliver caught in the island)
  const cand = hg.pieces.filter(q => !q.dead && !have.has(q) && q.curPos[1] > P0[1] - 0.3 && q.volume >= 0.05 && q.welds.length >= 2).sort((a, b) => off(a) - off(b));
  const want = cand.filter((q, k) => k < min || off(q) < HINGE.zone * hg.R).slice(0, 8);
  for (const q of want) {
    const t = (q.curPos[0] - P0[0]) * ax + (q.curPos[2] - P0[2]) * az;
    const at: Vec3 = [P0[0] + ax * t, P0[1], P0[2] + az * t];
    const jd = b3.b3DefaultRevoluteJointDef();
    jd.base.bodyIdA = ground;
    jd.base.bodyIdB = q.body;
    jd.base.localFrameA = { position: [at[0] - GROUND_POS[0], at[1] - GROUND_POS[1], at[2] - GROUND_POS[2]], quaternion: hg.qa };
    jd.base.localFrameB = { position: toLocal([0, 0, 0], q.curPos, q.curRot, at), quaternion: quat.multiply([0, 0, 0, 1], quat.conjugate([0, 0, 0, 1], q.curRot), hg.qa) as Quat };
    jd.base.forceThreshold = 3e38;
    jd.base.torqueThreshold = 3e38;
    jd.base.collideConnected = true;
    jd.enableLimit = true;
    jd.lowerAngle = HINGE.back;
    jd.upperAngle = HINGE.limit;
    const j = b3.b3CreateRevoluteJoint(world, jd);
    hg.joints.push({ j, q });
    hingeJoints.set(j.index1, hg);
    b3.b3Body_SetAwake(q.body, true);
  }
}

/** Judge the stack over the level y0 under `seed`; if it goes, it goes over the bed of the course above the seed's when
    that bed also fails the check (a notch inside the lowest course is spanned by the one over it, which turns over it). */
function judgeStack(seed: Piece, y0: number, lower: Set<Piece>, seen?: Set<Piece>): 'formed' | 'stands' | 'crushes' | null {
  const s = stackSection(seed, y0, lower);
  if (!s) return null;
  if (seen) for (const q of s.pieces) seen.add(q);
  const t = tipping(s);
  if (t === 'stands' || t === 'crushes') return t;
  b3.b3Body_ComputeAABB(_hy, seed.body);
  const top = _hy[4];
  for (const w of seed.welds) {
    const o = w.a === seed ? w.b : w.a;
    if (!o || !s.set.has(o) || o.curPos[1] <= top) continue;
    b3.b3Body_ComputeAABB(_hy, o.body);
    if (Math.abs(_hy[1] - top) > HINGE.tol) continue;
    const s2 = stackSection(o, top, new Set());
    const t2 = s2 && tipping(s2);
    if (s2 && t2 && t2 !== 'stands' && t2 !== 'crushes') { formHinge(s2, t2); return 'formed'; }
    break;
  }
  formHinge(s, t);
  return 'formed';
}

/** A masonry bed under a free-standing stack about to give way: if the section can no longer carry the stack, it goes
    over on its hinge instead (true). */
function hingeBed(w: Weld): boolean {
  if (building || w.calib || !w.b || (!inStack(w.a) && !inStack(w.b)) || !masonryBed(w) || hingeOf.has(w.a) || hingeOf.has(w.b)) return false;
  const up = w.a.curPos[1] > w.b.curPos[1] ? w.a : w.b;
  return judgeStack(up, weldPos(w, _v)[1], new Set([up === w.a ? w.b : w.a])) === 'formed';
}

/* The units under a stack blown or broken out from under it: watch what stood on them for a couple of seconds. */
function watchAbove(p: Piece): void {
  if (building || !ARCH_MATS.has(p.mat) || !b3.b3Body_IsValid(p.body)) return;
  b3.b3Body_ComputeAABB(_hy, p.body);
  const top = _hy[4];
  overlapAABB([_hy[0], top - 0.05, _hy[2]], [_hy[3], top + 0.15, _hy[5]], CAT.structure, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece' || e === p) return;
    const q = e as Piece;
    if (q.dead || !q.welds.length || !inStack(q) || hingeOf.has(q)) return;
    const w = hingeWatch.get(q);
    if (w) w.until = stepCount + HINGE.watch;
    else hingeWatch.set(q, { at: stepCount + HINGE.look, until: stepCount + HINGE.watch });
  });
}

function stepHinges(): void {
  const seen = new Set<Piece>();
  for (const [q, wt] of hingeWatch) {
    if (wt.at > stepCount) continue;
    if (q.dead || hingeOf.has(q) || stepCount > wt.until) { hingeWatch.delete(q); continue; }
    wt.at = stepCount + HINGE.look;
    if (seen.has(q)) continue;
    b3.b3Body_ComputeAABB(_hy, q.body);
    if (judgeStack(q, _hy[1], new Set(), seen) === 'formed') hingeWatch.delete(q);
  }
  for (let i = hinges.length - 1; i >= 0; i--) {
    const hg = hinges[i];
    hg.joints = hg.joints.filter(x => {
      if (!b3.b3Joint_IsValid(x.j) || x.q.dead) { hingeJoints.delete(x.j.index1); return false; }
      return true;
    });
    const ang = hg.ref.dead ? hg.peak : turnOf(hg);
    if (hg.peak < HINGE.early && stepCount - hg.look >= HINGE.relook) { hg.look = stepCount; rezone(hg); }
    /* it tears free once well over, or when the notch closes and the stack comes down on its front edge (its turn is
       checked hard): from there it goes on over that edge, or settles back, on its own */
    const w = ang - hg.prev;
    hg.prev = ang;
    hg.wmax = Math.max(hg.wmax, w);
    hg.stall = ang > HINGE.closed && hg.wmax > HINGE.turning && w < 0.5 * hg.wmax ? hg.stall + 1 : 0;
    const go = ang > HINGE.release || hg.stall >= 2;
    /* jammed: pinned over the wrong bed (a notch inside the members it was pinned by), it cannot turn; it stands on what
       it bears on until the section is judged again */
    if (!go && hg.joints.length && hg.peak < HINGE.still / 3 && clock - hg.t0 > HINGE.jam) {
      releaseHinge(hg);
      for (const q of hg.pieces) if (hingeOf.get(q) === hg) hingeOf.delete(q);
      continue;
    }
    hg.peak = Math.max(hg.peak, ang);
    // a pinned member broken off the hinge: the rest of the bearing carries on
    if (!go && hg.joints.length < 2) pinHinge(hg, 2 - hg.joints.length);
    if (go || !hg.joints.length) releaseHinge(hg);
  }
}

/** How far the stack has turned about its hinge axis since the hinge formed (its heaviest member's rotation). */
function turnOf(hg: FellHinge): number {
  quat.multiply(_tq, hg.ref.curRot as Quat, quat.conjugate(_tq0, hg.ref0));
  const s = _tq[0] * hg.axis[0] + _tq[1] * hg.axis[1] + _tq[2] * hg.axis[2];
  return 2 * Math.atan2(s, Math.abs(_tq[3])) * Math.sign(_tq[3] || 1);
}
const _tq: Quat = [0, 0, 0, 1], _tq0: Quat = [0, 0, 0, 1];

function releaseHinge(hg: FellHinge): void {
  const i = hinges.indexOf(hg);
  if (i < 0) return;
  hinges.splice(i, 1);
  for (const { j } of hg.joints) {
    hingeJoints.delete(j.index1);
    if (b3.b3Joint_IsValid(j)) b3.b3DestroyJoint(j, true);
  }
  hg.joints.length = 0;
  for (const v of hg.welds) if (v.alive) { v.calib = false; applyCaps(v); }
  hg.live = false;
}

/* Masonry over a lost support does not bridge it as a rigid beam: the units over the gap, inside the relieving arch
   (a half-disc on the gap), fall out, and what is left stands as an arch on the supports either side - or, with too
   little left to arch, comes down. Supports are whatever lies under the member's bed, found by overlap. */
const ARCH_MATS = new Set<MaterialId>(['brick', 'stone', 'sandstone', 'cinderblock', 'adobe']);
const ARCH_GAP = 0.35;
function relieve(p: Piece): void {
  b3.b3Body_ComputeAABB(_hb, p.body);
  const y0 = _hb[1];
  if (y0 < 0.1) return;
  b3.b3Body_GetLinearVelocity(_v, p.body);
  if (vec3.squaredLength(_v) > 0.25) return;
  const ax = _hb[3] - _hb[0] >= _hb[5] - _hb[2] ? 0 : 2, lo = _hb[ax], hi = _hb[ax + 3];
  if (hi - lo < 2 * ARCH_GAP) return;
  const cover: [number, number][] = [];
  const bb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  overlapAABB([_hb[0] + 0.02, y0 - 0.1, _hb[2] + 0.02], [_hb[3] - 0.02, y0 + 0.06, _hb[5] - 0.02], CAT.structure | CAT.debris | CAT.prop, shape => {
    const e = entityOfShape(shape);
    if (!e || e === p || e.kind !== 'piece' || (e as Piece).dead) return;
    b3.b3Shape_GetAABB(bb, shape);
    if (bb[4] < y0 - 0.1 || bb[4] > y0 + 0.12) return;
    const a = Math.max(lo, bb[ax]), b = Math.min(hi, bb[ax + 3]);
    if (b - a > 0.02) cover.push([a, b]);
  });
  if (!cover.length) return;
  cover.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const gaps: [number, number][] = [];
  let at = lo;
  for (const [a, b] of cover) { if (a - at >= ARCH_GAP) gaps.push([at, a]); at = Math.max(at, b); }
  if (hi - at >= ARCH_GAP) gaps.push([at, hi]);
  const c: Vec3 = [(_hb[0] + _hb[3]) / 2, y0, (_hb[2] + _hb[5]) / 2];
  for (const [a, b] of gaps) {
    // a gap at the member's end is an overhang: what is over it drops, out to the width of the overhang
    const end = a <= lo + 1e-6 || b >= hi - 1e-6;
    const r = end ? b - a : (b - a) / 2;
    c[ax] = end ? (a <= lo + 1e-6 ? a : b) : (a + b) / 2;
    if (detailDropOut(p, [c[0], c[1], c[2]], Math.min(r, 2.4))) counters.relieved++;
    if (p.dead) return;
  }
}

export function weldPos(w: Weld, out: Vec3): Vec3 {
  return toWorld(out, w.a.curPos, w.a.curRot, w.local);
}

export function weldNormal(w: Weld, out: Vec3): Vec3 {
  return vec3.transformQuat(out, w.n, w.a.curRot);
}

interface Contact { area: number; c: Vec3; axis: number; sign: number }
const _contact: Contact = { area: 0, c: [0, 0, 0], axis: 0, sign: 1 };

/* Face contact between two AABBs: nearly zero gap on one axis, real overlap on the other two. */
function touching(a: ArrayLike<number>, b: ArrayLike<number>, tol: number, minOverlap: number): Contact | null {
  let axis = -1, best = Infinity;
  const ov: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const gap = Math.max(a[k] - b[k + 3], b[k] - a[k + 3]);
    if (gap > tol) return null;
    ov[k] = -gap;
    if (Math.abs(gap) < best) { best = Math.abs(gap); axis = k; }
  }
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  if (ov[u] < minOverlap || ov[v] < minOverlap) return null;
  _contact.area = ov[u] * ov[v];
  _contact.axis = axis;
  _contact.sign = b[axis] + b[axis + 3] >= a[axis] + a[axis + 3] ? 1 : -1;
  for (let k = 0; k < 3; k++) {
    const lo = Math.max(a[k], b[k]), hi = Math.min(a[k + 3], b[k + 3]);
    _contact.c[k] = (lo + hi) / 2;
  }
  return _contact;
}

function axisNormal(c: Contact): Vec3 {
  const n: Vec3 = [0, 0, 0];
  n[c.axis] = c.sign;
  return n;
}

const DOWN: Vec3 = [0, -1, 0];

function autoWeld(list: Piece[]): void {
  const boxes = list.map(p => b3.b3Body_ComputeAABB([0, 0, 0, 0, 0, 0], p.body));
  const CELL = 2.5;
  const grid = new Map<string, number[]>();
  boxes.forEach((bb, i) => {
    for (let x = Math.floor((bb[0] - 0.05) / CELL); x <= Math.floor((bb[3] + 0.05) / CELL); x++)
      for (let y = Math.floor((bb[1] - 0.05) / CELL); y <= Math.floor((bb[4] + 0.05) / CELL); y++)
        for (let z = Math.floor((bb[2] - 0.05) / CELL); z <= Math.floor((bb[5] + 0.05) / CELL); z++) {
          const k = `${x},${y},${z}`;
          const cell = grid.get(k);
          if (cell) cell.push(i); else grid.set(k, [i]);
        }
  });
  const seen = new Set<number>();
  const n = list.length;
  /* Two service members touching conduct through a service link. They weld only as each other's support:
     never across structures (a grid main and a building's riser) or between runs lying on the ground (a
     buried main's segments) when each is already held by something else. */
  const deferred: { a: number; b: number; c: Vec3; n: Vec3; area: number }[] = [];
  const held = new Uint8Array(n), onGround = new Uint8Array(n);
  const join = (a: number, b: number, c: Vec3, nrm: Vec3, area: number): void => {
    const pa = list[a], pb = list[b];
    if (pa.svc && pb.svc) { deferred.push({ a, b, c: [c[0], c[1], c[2]], n: nrm, area }); return; }
    if (!createWeld(pa, pb, c, nrm, area, jointCaps(pa.pm, pb.pm, area, grainAt(pa, nrm), grainAt(pb, nrm)), true)) return;
    if (!pb.svc) held[a] = 1;
    if (!pa.svc) held[b] = 1;
  };
  for (const cell of grid.values()) {
    for (let i = 0; i < cell.length; i++) for (let j = i + 1; j < cell.length; j++) {
      const a = Math.min(cell[i], cell[j]), b = Math.max(cell[i], cell[j]);
      const key = a * n + b;
      if (seen.has(key)) continue;
      seen.add(key);
      const pa = list[a], pb = list[b];
      if (pa.root.spec.noWeld || pb.root.spec.noWeld || pa.root.spec.mech || pb.root.spec.mech) continue;
      if ((pa.root.spec.vpart === 'crumple') !== (pb.root.spec.vpart === 'crumple')) continue;   // crumple members ride on crush joints
      if (sloped(pa) || sloped(pb)) {
        const ba = boxes[a], bb = boxes[b];
        if (ba[0] > bb[3] + 0.03 || bb[0] > ba[3] + 0.03 || ba[1] > bb[4] + 0.03 || bb[1] > ba[4] + 0.03 || ba[2] > bb[5] + 0.03 || bb[2] > ba[5] + 0.03) continue;
        const h = hullContact(pa, pb);
        if (h) join(a, b, h.c, h.n, h.area);
        continue;
      }
      if (pa.parts || pb.parts) {
        const h = partsContact(pa, pb, 0.025, 0.05, boxes[a], boxes[b]);
        if (h) join(a, b, h.c, h.n, h.area);
        continue;
      }
      const c = touching(boxes[a], boxes[b], 0.025, 0.05);
      if (!c) continue;
      join(a, b, c.c, axisNormal(c), c.area);
    }
  }
  list.forEach((p, i) => {
    const bb = boxes[i];
    if (p.root.spec.noWeld || p.root.spec.mech || (bb[1] > 0.03 && !p.root.spec.anchored)) return;
    const f = footprint(p, bb, 1);
    if (createWeld(p, null, f.c, DOWN, f.area, jointCaps(p.pm, null, f.area, grainAt(p, DOWN)), true)) held[i] = onGround[i] = 1;
  });
  for (const d of deferred) {
    const pa = list[d.a], pb = list[d.b];
    svcLink(pa, pb, d.c, d.n);
    if (held[d.a] && held[d.b] && (pa.root.spec.group !== pb.root.spec.group || (onGround[d.a] && onGround[d.b] && run(pa) && run(pb)))) continue;
    createWeld(pa, pb, d.c, d.n, d.area, jointCaps(pa.pm, pb.pm, d.area, grainAt(pa, d.n), grainAt(pb, d.n)), true);
  }
}

/* Pipe, conduit, cable or duct: two of its three extents are slender. */
function run(p: Piece): boolean {
  return slender(p.root.spec);
}

function slender(s: PieceSpec): boolean {
  const z = s.size, a = Math.min(z[0], z[1], z[2]), c = Math.max(z[0], z[1], z[2]);
  return z[0] + z[1] + z[2] - a - c <= 0.35;
}

function serviceRun(s: PieceSpec): boolean {
  return !!s.util && !s.fixture && !s.mech && slender(s);
}

/* Hulls, wedges and skewed boxes can't be judged by their bounding boxes: a rafter's box overlaps
   the wall plate, the ridge and the tiles whatever it actually touches. */
function sloped(p: Piece): boolean {
  const sp = p.root.spec, sh = sp.shape ?? 'box';
  if (sp.util || sp.fixture) return false;   // service runs are hung from their hosts, not bedded on them
  return sh === 'hull' || sh === 'wedge' || (!!sp.rotY && Math.abs(Math.sin(2 * sp.rotY)) > 0.02);
}

function worldPoly(p: Piece, poly = p.poly): P.Poly {
  const faces = poly.faces.map(f => {
    const pts: number[] = [];
    for (let i = 0; i < f.pts.length; i += 3) {
      vec3.set(_v, f.pts[i], f.pts[i + 1], f.pts[i + 2]);
      toWorld(_w, p.curPos, p.curRot, _v);
      pts.push(_w[0], _w[1], _w[2]);
    }
    const n = vec3.transformQuat([0, 0, 0], f.n, p.curRot) as Vec3;
    return { pts, n, d: vec3.dot(n, p.curPos) + f.d, ext: f.ext, tag: f.tag };
  });
  return { faces };
}

/* Convex polygon overlap in a face plane (Sutherland–Hodgman), area and centroid. */
function faceOverlap(a: number[], b: number[], n: Vec3, out: Vec3): number {
  const u = vec3.perpendicular([0, 0, 0], n) as Vec3, v = vec3.cross([0, 0, 0], n, u) as Vec3;
  const to2 = (p: number[]) => {
    const o: number[] = [];
    for (let i = 0; i < p.length; i += 3) o.push(p[i] * u[0] + p[i + 1] * u[1] + p[i + 2] * u[2], p[i] * v[0] + p[i + 1] * v[1] + p[i + 2] * v[2]);
    return o;
  };
  let poly = to2(a);
  const clipB = to2(b);
  const m = clipB.length / 2;
  const cw = (() => { let s2 = 0; for (let i = 0; i < m; i++) { const j = (i + 1) % m; s2 += clipB[i * 2] * clipB[j * 2 + 1] - clipB[j * 2] * clipB[i * 2 + 1]; } return s2 < 0; })();
  for (let e = 0; e < m && poly.length >= 6; e++) {
    const i0 = cw ? (m - e) % m : e, i1 = cw ? (m - e - 1 + m) % m : (e + 1) % m;
    const ax = clipB[i0 * 2], ay = clipB[i0 * 2 + 1], ex = clipB[i1 * 2] - ax, ey = clipB[i1 * 2 + 1] - ay;
    const side = (x: number, y: number) => ex * (y - ay) - ey * (x - ax);
    const next: number[] = [];
    const k = poly.length / 2;
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      const px = poly[i * 2], py = poly[i * 2 + 1], qx = poly[j * 2], qy = poly[j * 2 + 1];
      const sp = side(px, py), sq = side(qx, qy);
      if (sp >= 0) next.push(px, py);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); next.push(px + (qx - px) * t, py + (qy - py) * t); }
    }
    poly = next;
  }
  const k = poly.length / 2;
  if (k < 3) return 0;
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    const cr = poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
    area += cr; cx += (poly[i * 2] + poly[j * 2]) * cr; cy += (poly[i * 2 + 1] + poly[j * 2 + 1]) * cr;
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) return 0;
  cx /= 6 * area; cy /= 6 * area;
  const h = a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
  for (let q = 0; q < 3; q++) out[q] = u[q] * cx + v[q] * cy + n[q] * h;
  return Math.abs(area);
}

interface HullContact { c: Vec3; n: Vec3; area: number }

/* A real face-to-face contact between two convex pieces (a birdsmouth on a plate, a tread on a
   stair waist); failing that, pieces that actually interpenetrate (or all but touch) along an edge
   get a small weld there. Pieces whose boxes merely overlap get none. */
function hullContact(pa: Piece, pb: Piece): HullContact | null {
  if (!pa.parts && !pb.parts) return polyContact(worldPoly(pa), worldPoly(pb));
  let best: HullContact | null = null;
  for (const qa of pa.parts ?? [pa]) for (const qb of pb.parts ?? [pb]) {
    const h = polyContact(worldPoly(pa, qa.poly), worldPoly(pb, qb.poly));
    if (h && (!best || h.area > best.area)) best = h;
  }
  return best;
}

function polyContact(A: P.Poly, B: P.Poly): HullContact | null {
  let best: HullContact | null = null;
  const c: Vec3 = [0, 0, 0];
  for (const fa of A.faces) for (const fb of B.faces) {
    if (vec3.dot(fa.n, fb.n) > -0.97 || Math.abs(fa.d + fb.d) > 0.03) continue;
    const area = faceOverlap(fa.pts, fb.pts, fa.n, c);
    if (area > 0.0025 && (!best || area > best.area)) best = { c: [c[0], c[1], c[2]], n: [fa.n[0], fa.n[1], fa.n[2]], area };
  }
  if (best) return best;
  let x: P.Poly = A;
  for (const fb of B.faces) {
    x = P.clip(x, fb.n, fb.d + 0.02, -2);
    if (x.faces.length < 4) return null;
  }
  const vol = P.volumeCentroid(x, c);
  if (vol < 2e-5) return null;
  let nearest = B.faces[0], gap = Infinity;
  for (const fb of B.faces) {
    const g = Math.abs(fb.d - vec3.dot(fb.n, c));
    if (g < gap) { gap = g; nearest = fb; }
  }
  return { c: [c[0], c[1], c[2]], n: [-nearest.n[0], -nearest.n[1], -nearest.n[2]], area: clamp(Math.cbrt(vol) ** 2, 0.01, 0.25) };
}

/* ---------------- compound contacts ---------------- */

/* World AABBs of a compound's parts (exact for the quarter-turned frames compounds are built in). */
function partBoxes(p: Piece): number[][] {
  return p.parts!.map(q => {
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const f of q.poly.faces) for (let i = 0; i < f.pts.length; i += 3) {
      vec3.set(_v, f.pts[i], f.pts[i + 1], f.pts[i + 2]);
      toWorld(_w, p.curPos, p.curRot, _v);
      for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], _w[k]); bb[k + 3] = Math.max(bb[k + 3], _w[k]); }
    }
    return bb;
  });
}

/* The face contact test run part against part: one weld per piece pair, carrying the summed contact area at
   its area-weighted centre, normal from the largest contact. */
function partsContact(pa: Piece, pb: Piece, tol: number, minOverlap: number, boxA?: ArrayLike<number>, boxB?: ArrayLike<number>): HullContact | null {
  const A = pa.parts ? partBoxes(pa) : [boxA ?? b3.b3Body_ComputeAABB([0, 0, 0, 0, 0, 0], pa.body)];
  const B = pb.parts ? partBoxes(pb) : [boxB ?? b3.b3Body_ComputeAABB([0, 0, 0, 0, 0, 0], pb.body)];
  let area = 0, big = 0;
  const c: Vec3 = [0, 0, 0], n: Vec3 = [0, 0, 0];
  for (const a of A) for (const b of B) {
    const t = touching(a, b, tol, minOverlap);
    if (!t) continue;
    area += t.area;
    vec3.scaleAndAdd(c, c, t.c, t.area);
    if (t.area > big) { big = t.area; vec3.set(n, 0, 0, 0); n[t.axis] = t.sign; }
  }
  return area > 0 ? { c: vec3.scale(c, c, 1 / area) as Vec3, n, area } : null;
}

/* Contact with any member, compound or not (re-welding fragments to what they still touch). */
function pieceTouch(a: Piece, b: Piece, tol: number, minOverlap: number): HullContact | null {
  if (a.parts || b.parts) return partsContact(a, b, tol, minOverlap);
  b3.b3Body_ComputeAABB(_aabb, a.body);
  b3.b3Body_ComputeAABB(_aabb2, b.body);
  const t = touching(_aabb, _aabb2, tol, minOverlap);
  return t ? { c: [t.c[0], t.c[1], t.c[2]], n: axisNormal(t), area: t.area } : null;
}

/* Ground bearing of a piece whose AABB is `bb`: a compound bears on the parts at its underside only. */
function footprint(p: Piece, bb: ArrayLike<number>, share: number): { c: Vec3; area: number } {
  if (!p.parts) return { c: [(bb[0] + bb[3]) / 2, Math.max(0, bb[1]), (bb[2] + bb[5]) / 2], area: Math.max(0.01, (bb[3] - bb[0]) * (bb[5] - bb[2]) * share) };
  let area = 0;
  const c: Vec3 = [0, 0, 0];
  for (const q of partBoxes(p)) {
    if (q[1] > bb[1] + 0.03) continue;
    const a = (q[3] - q[0]) * (q[5] - q[2]);
    area += a;
    c[0] += (q[0] + q[3]) / 2 * a; c[2] += (q[2] + q[5]) / 2 * a;
  }
  return { c: [c[0] / area, Math.max(0, bb[1]), c[2] / area], area: Math.max(0.01, area * share) };
}

/* Connected groups of parts (local frame): parts that share a face stay one body. */
function groupParts(parts: PartGeo[]): PartGeo[][] {
  const boxes = parts.map(q => {
    const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
    P.bounds(q.poly, lo, hi);
    return [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]];
  });
  const id = parts.map((_, i) => i);
  const find = (i: number): number => (id[i] === i ? i : (id[i] = find(id[i])));
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (touching(boxes[i], boxes[j], 0.01, 0.01)) id[find(i)] = find(j);
  }
  const out = new Map<number, PartGeo[]>();
  parts.forEach((q, i) => { const r = find(i); (out.get(r) ?? out.set(r, []).get(r)!).push(q); });
  return [...out.values()];
}

/* A rope is a tension-only distance constraint between two ordinary destructible members.
   Its steel/wood eyelets are welded by autoWeld; when either eyelet breaks, the rope drops.
   Looking up endpoints only when a blueprint is spawned avoids per-frame spatial searches. */
function linkRopes(list: Piece[]): void {
  for (const owner of list) {
    const spec = owner.root.spec.ropeTo;
    if (!spec) continue;
    let end: Piece | null = null, nearest = 0.45;
    for (const candidate of list) {
      if (candidate === owner) continue;
      const d = vec3.distance(candidate.curPos, spec.end);
      if (d < nearest) { nearest = d; end = candidate; }
    }
    if (!end || ropeJoints.size >= 128) continue;
    /* A machine part's rope hangs from a stand-in static anchor while the member it hangs from rests,
       for the same island reason as mech joints: `a` is the moving end, `b` the resting one. So does a
       service wire: an overhead drop must not tie a house and a pole line into one island. */
    const ownerMech = !!owner.root.spec.mech, endMech = !!end.root.spec.mech;
    const a = endMech && !ownerMech ? end : owner, b = a === owner ? end : owner;
    /* a hook block or slung load hanging loose on a machine's line is not a resting member: it rides the line */
    const proxy = (ownerMech !== endMech && !b.root.spec.noWeld) || (spec.kind === 'wire' && !ownerMech);
    const rest = vec3.distance(a.curPos, b.curPos);
    if (rest < 0.35) continue;
    const slack = clamp(spec.slack ?? 0.35, 0, 2);
    const maxLength = rest + Math.max(0.03, slack * 0.6);
    const kind = spec.kind ?? 'rope';
    const strength = spec.strength ?? (kind === 'wire' ? 350 : kind === 'chain' ? 90e3 : 35e3);
    const rope: Rope = { joint: null!, kind, a, b, la: [0, 0, 0], lb: [0, 0, 0], rest, maxLength, slack, strength, proxy,
      vis: ropeGfx.add(kind), alive: true };
    rope.joint = ropeJoint(rope);
    if (proxy) b.proxied++;
    ropeJoints.set(rope.joint.index1, rope);
    a.ropes.push(rope);
    b.ropes.push(rope);
    ropeGfx.set(rope.vis, a.curPos, b.curPos, slack);
  }
}

function ropeJoint(r: Rope): b3JointId {
  const jd = b3.b3DefaultDistanceJointDef();
  jd.base.bodyIdA = r.a.body;
  jd.base.bodyIdB = r.proxy ? ground : r.b.body;
  jd.base.localFrameA = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  jd.base.localFrameB = { position: r.proxy ? b3.b3Body_GetLocalPoint([0, 0, 0], ground, r.b.curPos) : [0, 0, 0], quaternion: [0, 0, 0, 1] };
  jd.length = r.maxLength;
  /* A zero-rate spring makes the joint free below maxLength; without it Box3D holds a rigid rod. */
  jd.enableSpring = true;
  jd.hertz = 0;
  jd.enableLimit = true;
  jd.minLength = 0;
  jd.maxLength = r.maxLength;
  jd.base.forceThreshold = r.strength;
  jd.base.collideConnected = true;
  return b3.b3CreateDistanceJoint(world, jd);
}

/* A resting member that anchors machinery by proxy has moved for real: hand its joints back to it. */
function hostMoved(p: Piece): void {
  const dx = p.curPos[0] - p.spawnPos[0], dy = p.curPos[1] - p.spawnPos[1], dz = p.curPos[2] - p.spawnPos[2];
  if (dx * dx + dy * dy + dz * dz < 0.03 * 0.03 && Math.abs(quat.dot(p.curRot, p.spawnRot)) > 0.9999) return;
  for (const r of p.ropes) {
    if (!r.proxy || r.b !== p || !r.alive) continue;
    r.proxy = false;
    p.proxied--;
    const old = r.joint;
    r.joint = ropeJoint(r);
    ropeJoints.delete(old.index1);
    ropeJoints.set(r.joint.index1, r);
    if (b3.b3Joint_IsValid(old)) b3.b3DestroyJoint(old, true);
  }
  svcHostMoved(p);
}

function killRope(rope: Rope, destroyJoint: boolean): void {
  if (!rope.alive) return;
  rope.alive = false;
  if (rope.proxy) { rope.proxy = false; rope.b.proxied--; }
  if (ropeJoints.get(rope.joint.index1) === rope) ropeJoints.delete(rope.joint.index1);
  analysisTouch(rope.a); analysisTouch(rope.b); supportDirty = true;
  ropeGfx.remove(rope.vis);
  if (!building) {
    vec3.lerp(_v, rope.a.curPos, rope.b.curPos, 0.5);
    audio.ropeSnap([_v[0], _v[1], _v[2]], rope.kind);
  }
  if (rope.kind === 'wire' && rope.a.svc?.kind === 'power' && rope.b.svc?.kind === 'power') {
    vec3.sub(_w, rope.b.curPos, rope.a.curPos);
    vec3.normalize(_w, _w);
    svcLinkLost(rope.a, rope.b, rope.a.curPos, _w, !building, rope.b.curPos);
  }
  for (const p of [rope.a, rope.b]) {
    const index = p.ropes.indexOf(rope);
    if (index >= 0) p.ropes.splice(index, 1);
  }
  if (destroyJoint && b3.b3Joint_IsValid(rope.joint)) b3.b3DestroyJoint(rope.joint, true);
}

const NOOP: StepHandlers = { hit() {}, begin() {}, jointBroken() {} };

/* ---------------- static analysis ---------------- */

/* Quasi-static demand comes from a linear-elastic frame analysis of every founded structure (analysis.ts),
   re-solved in slices after each topology change; Box3D's joint forces remain the dynamic and impact check. */
const ANALYSIS_WORK = 20e3;      // element evaluations per step for the background re-solve (~2 ms while anything is pending)
/* A frame whose connections are overloaded while its analysis is out of date is failing now, and a real one has
   redistributed its load within milliseconds: its re-solve gets this many times the work for the next half second, so
   the new load path is known in a few tenths of a second rather than seconds. Continuous (ductile) frames only, like
   the load shedding below: masonry arrests on thrust lines the analysis finds slowly, and keeps its pace. */
const ANALYSIS_BOOST = 5, URGENT_STEPS = 30;
const analysisOut: AnalysisOut = { welds: [], buckled: [] };
const buckledOnce = new WeakSet<Piece>();
let designCheck = false;
/** members that buckle under their own static load while a structure is being built (a design fault, not acted on) */
export const designIssues: { spec: PieceSpec; N: number; Pcr: number }[] = [];

/** How close the static demand from the frame analysis is to failing the joint in its worst mode, 1 = at its
 * calibrated capacity (degraded by heat and damage). Failures it drives are paced by settleFailures. */
function staticRatio(w: Weld): number {
  return staticDemand(w);
}

/* Loads the analysis cannot see arrive through contacts: something landed on one of the joint's members. */
const struck = new WeakMap<Piece, number>();
const STRUCK_MEMORY = 5;
function loadedByContact(w: Weld): boolean {
  const ta = struck.get(w.a), tb = w.b ? struck.get(w.b) : undefined;
  return (ta !== undefined && clock - ta < STRUCK_MEMORY) || (tb !== undefined && clock - tb < STRUCK_MEMORY);
}

/* Joints failing because the structure can no longer carry its load, statically (the analysis queue) or
   dynamically in a way the analysis confirms, go worst first, a few per step and a few per solve of their
   structure: each failure sheds load that must redistribute (a fresh solve) before the next is judged, so a
   collapse progresses through the structure instead of every overloaded joint letting go in the same step. */
const offers = new Map<Weld, { sev: number; quota: boolean }>();
let spent = new WeakMap<Solve, number>();
function offerFailure(w: Weld, sev: number, quota: boolean): void {
  const o = offers.get(w);
  if (!o || o.sev < sev) offers.set(w, { sev, quota: quota || !!o?.quota });
}

function settleFailures(): void {
  if (!offers.size) return;
  /* worst first; exact ties by place, not by the order the offers came in */
  const list = [...offers].sort((a, b) => b[1].sev - a[1].sev || weldKey(a[0]) - weldKey(b[0]));
  offers.clear();
  let n = 0, gross = 0;
  for (const [w, o] of list) {
    if (!w.alive || w.calib) continue;
    /* Past DAF× capacity no redistribution can save it: it goes without waiting for the next solve, and in a
       continuous (ductile) frame without waiting its turn behind the others either (their load arrives within the
       ~10 ms a stress wave takes to cross the frame, well inside a step); the bound there is only the cost of a
       step. Masonry keeps its turn: a vault that loses a pier can still find a thrust line through its neighbours. */
    if (o.sev >= DAF && w.ductile) {
      if (gross >= GROSS_FAILS) continue;
      gross++;
      counters.eventSnaps++;
      failWeld(w, 'overload');
      continue;
    }
    if (n >= SUPPORT_FAILS) continue;
    const id = o.quota && o.sev < DAF ? solveOfPiece(w.a) : undefined;
    if (id !== undefined) {
      const used = spent.get(id) ?? 0;
      if (used >= PER_SOLVE) continue;
      spent.set(id, used + 1);
    }
    if (hingeBed(w)) continue;
    counters.eventSnaps++;
    crushBed(w);
    failWeld(w, 'overload');
    n++;
  }
}

/* A masonry bed failing in compression is the brickwork under it crushing: the unit below crumbles and the load
   settles onto what is left, so a stack bearing on part of its section sinks on the side it is crushing into (a
   felled chimney sits down into its notch) instead of standing at full height on dry-stacked units. */
function crushBed(w: Weld): void {
  if (!w.b) return;
  if (!ARCH_MATS.has(w.a.mat) || !ARCH_MATS.has(w.b.mat)) return;
  weldNormal(w, _cbn);
  if (Math.abs(_cbn[1]) < 0.5 || w.sN <= 0) return;
  const c = w.cap;
  const crush = w.supportForce / c.comp;
  if (crush < 1 || crush < -w.sN / c.ten || crush < w.sV / (c.shear + w.mu * w.sN)) return;
  const low = w.a.curPos[1] < w.b.curPos[1] ? w.a : w.b;
  if (low.dead || low.queued || low.depth >= MAX_DEPTH || low.pm.style === 'none') return;
  low.queued = true;
  fractureQueue.push({ p: low, point: weldPos(w, [0, 0, 0]), intensity: 1.5, blast: false });
}
const _cbn: Vec3 = [0, 0, 0];

/** A weld's place as one number (mm grid), for ordering that does not depend on how the structure was listed. */
function weldKey(w: Weld): number {
  weldPos(w, _fk);
  return (Math.round(_fk[1] * 1000) * 2e5 + Math.round(_fk[0] * 1000)) * 2e5 + Math.round(_fk[2] * 1000);
}

/** Barely moving this step (well under the "working" threshold). */
function resting(p: Piece): boolean {
  const dx = p.curPos[0] - p.prevPos[0], dy = p.curPos[1] - p.prevPos[1], dz = p.curPos[2] - p.prevPos[2];
  return dx * dx + dy * dy + dz * dz < 0.25 * MOVING_STEP * MOVING_STEP && Math.abs(quat.dot(p.curRot, p.prevRot)) > MOVING_TURN;
}

/** Static demand from the analysis against the joint's current (calibrated, degraded) capacity alone. */
function staticDemand(w: Weld): number {
  const c = w.cap;
  return Math.max(w.supportForce / c.comp, w.supportTorque / (c.torque + thrustMoment(w, w.sN)), -w.sN / c.ten, w.sV / (c.shear + w.mu * Math.max(0, w.sN)));
}

/** A mortar bed between masonry units (a horizontal joint through brickwork or stonework). */
function masonryBed(w: Weld): boolean {
  if (!w.b || w.metal || (w.j.kind !== 'mortar' && w.j.kind !== 'bearing') || !ARCH_MATS.has(w.a.mat) || !ARCH_MATS.has(w.b.mat)) return false;
  weldNormal(w, _mbn);
  return Math.abs(_mbn[1]) >= 0.5;
}
const _mbn: Vec3 = [0, 0, 0];

/* A masonry bed under compression N does not open until the line of thrust leaves it: it resists a moment of about
   N·t/2 on top of its bond (rocking about the compressed edge), so a stack bearing on part of its section carries the
   eccentric load through the arc that is left instead of every course unzipping at its bond strength. */
function thrustMoment(w: Weld, n: number): number {
  if (n <= 0 || w.metal || !ARCH_MATS.has(w.a.mat) || (w.b && !ARCH_MATS.has(w.b.mat))) return 0;
  return n * armFor(w.area) * 0.5;
}

function refreshSupportPressure(): void {
  supportPressure.clear();
  if (building) return;
  for (const w of welds.values()) if (!w.calib && staticRatio(w) > 1.05) supportPressure.add(w);
}

/* B500B bars crossing a crack (~8 × 16 mm) and rope/cable at ~1.2% strain to break, as tension-only links. */
const REBAR_EA = 200e9 * 1.6e-3;
function analysisTies(): Tie[] {
  const out: Tie[] = [];
  for (const r of rebars.values()) {
    if (!r.alive) continue;
    out.push({ a: r.a, b: r.b, la: r.la, lb: r.b ? r.lb : [r.lb[0] + GROUND_POS[0], r.lb[1] + GROUND_POS[1], r.lb[2] + GROUND_POS[2]], alive: true, ea: REBAR_EA, bears: true });
  }
  for (const r of ropeJoints.values()) if (r.alive) out.push({ a: r.a, b: r.b, la: r.la, lb: r.lb, alive: true, ea: r.strength / 0.012 });
  return out;
}

/* Machinery hangs its weight on the member that carries it, even while its joint rests on a stand-in. */
let hingedList: Piece[] = [];
let hingedScan = -Infinity;
function hungLoads(): ExtraLoads {
  const out: ExtraLoads = new Map();
  /* machines are rigged at build and spawn; between those the list only needs an occasional refresh */
  if (building || calibs.length || stepCount - hingedScan >= 60) {
    hingedScan = stepCount;
    hingedList = [];
    for (const p of live) if (p.hinged) hingedList.push(p);
  }
  for (const p of hingedList) {
    const h = p.hinged && !p.dead ? machineRoot(p) : null;
    if (!h || h === p || h.dead) continue;
    const l = out.get(h), load = { m: p.mass, at: [p.curPos[0], p.curPos[1], p.curPos[2]] as Vec3 };
    if (l) l.push(load); else out.set(h, [load]);
  }
  return out;
}

function rebuildSupportPaths(): void {
  supportDirty = false;
  analysisPartition(live, analysisTies(), hungLoads(), building ? 1e-4 : 2e-3, bearings);
}

/** What the frame analysis is given besides the welds: tension-only ties and hung machinery (for reports/tests). */
export function analysisInputs(): { ties: Tie[]; extra: ExtraLoads } {
  return { ties: analysisTies(), extra: hungLoads() };
}

/* A slice of the analysis; fresh demands feed the progressive-collapse queue. */
/* A collapsing structure changes every step; tracing it again every few steps batches those changes at no cost in
   response, since its next solve waits for the one in progress anyway (analysisStale covers the gap). */
const PARTITION_EVERY = 4;
let partitioned = -Infinity;
function stepAnalysis(budget: number, only?: Set<Piece>): void {
  if (supportDirty && (budget === Infinity || stepCount - partitioned >= PARTITION_EVERY)) { partitioned = stepCount; rebuildSupportPaths(); }
  analysisStep(budget, analysisOut, only, ANALYSIS_BOOST);
  for (const w of analysisOut.welds) {
    if (!w.alive || w.calib || building) continue;
    if (staticRatio(w) > 1.05) supportPressure.add(w); else supportPressure.delete(w);
  }
  for (const b of analysisOut.buckled) buckle(b.p, b.N, b.Pcr);
}

/* A strut past its Euler load bows out and hinges: steel yields at its most stressed end, timber snaps
   across the grain, brittle members crack at the joint. */
function buckle(p: Piece, N: number, Pcr: number): void {
  if (p.dead || buckledOnce.has(p)) return;
  if (building || designCheck) { if (!designIssues.some(d => d.spec === p.root.spec)) designIssues.push({ spec: p.root.spec, N, Pcr }); return; }
  buckledOnce.add(p);
  counters.buckles++;
  b3.b3Body_SetAwake(p.body, true);
  if (p.pm.style === 'splinter' && !p.queued && p.depth < MAX_DEPTH) {
    p.queued = true;
    fractureQueue.push({ p, point: [p.curPos[0], p.curPos[1], p.curPos[2]], intensity: 1.2, blast: false });
    return;
  }
  let worst: Weld | null = null, u = -1;
  for (const w of p.welds) { const r = w.supportTorque / w.cap.torque; if (r > u) { u = r; worst = w; } }
  if (worst) failWeld(worst, 'overload');
}

/* Settle once and measure every joint's static load in each mode, so structures stand on their own
   but losing a support overloads the neighbours (progressive collapse). */
interface Calib { list: Weld[]; pieces: Piece[]; ten: Float64Array; shear: Float64Array; mag: Float64Array; tor: Float64Array; step: number }
const calibs: Calib[] = [];
const CALIB_SETTLE = 10, CALIB_END = 34;

function newCalib(list: Weld[], pieces: Piece[]): Calib {
  const n = list.length;
  return { list, pieces, ten: new Float64Array(n), shear: new Float64Array(n), mag: new Float64Array(n), tor: new Float64Array(n), step: 0 };
}

function sampleCalib(c: Calib): void {
  const f: Vec3 = [0, 0, 0], n: Vec3 = [0, 0, 0];
  for (let i = 0; i < c.list.length; i++) {
    const w = c.list[i];
    if (!w.alive) continue;
    b3.b3Joint_GetConstraintForce(f, w.joint);
    b3.b3Body_GetRotation(w.a.curRot, w.a.body);
    weldNormal(w, n);
    const fn = vec3.dot(f, n);
    const sh = Math.sqrt(Math.max(0, vec3.squaredLength(f) - fn * fn));
    c.ten[i] = Math.max(c.ten[i], -fn);
    c.shear[i] = Math.max(c.shear[i], sh - w.mu * Math.max(0, fn));
    c.mag[i] = Math.max(c.mag[i], vec3.length(f));
    b3.b3Joint_GetConstraintTorque(f, w.joint);
    c.tor[i] = Math.max(c.tor[i], vec3.length(f));
  }
}

function calibrate(): void {
  const c = newCalib([...welds.values()], [...live]);
  for (let s = 0; s < CALIB_END; s++) {
    stepVehicles(1 / 60);   // vehicles stand on their suspension while the build settles
    physicsStep(NOOP);
    if (s >= CALIB_SETTLE) sampleCalib(c);
  }
  stepAnalysis(Infinity);
  finishCalib(c, true);
}

/* A spawned structure, once it has settled, rests like a built one: put to sleep as soon as none of it is still
   moving (a whole island sleeps at once), rather than waiting out Box3D's own timer on every last tremor. */
const SETTLE_WATCH = 600;
const settling: { pieces: Piece[]; until: number }[] = [];
function watchSettling(): void {
  for (let i = settling.length - 1; i >= 0; i--) {
    const s = settling[i];
    const done = s.pieces.every(p => p.dead || resting(p));
    if (done) for (const p of s.pieces) if (!p.dead) b3.b3Body_SetAwake(p.body, false);
    if (done || stepCount > s.until) settling.splice(i, 1);
  }
}

/* Free-standing masonry stacks (a chimney, a boiler stack, a brick stack): the shaft is a bonded tube, far stronger
   than its coarse courses of a few big members joined at points suggest, and a notch at its foot does not unzip it
   joint by joint (the section decides whether it goes: see the felling hinge). The joints within one keep brickwork's
   real strength; its units still break as any do. A stack is the masonry island of one building group standing at
   least STACK.tall high and STACK.slender times as high as it is wide. */
const STACK = { tall: 6, slender: 2.5 };
const stackRoots = new WeakSet<Root>();
/** A member of a free-standing stack, or a piece broken from one. */
function inStack(p: Piece): boolean {
  for (let r: Root | undefined = p.root; r; r = r.parent) if (stackRoots.has(r)) return true;
  return false;
}
function findStacks(list: Piece[]): Set<Piece> {
  const out = new Set<Piece>(), seen = new Set<Piece>(), inGroup = new Map<string | undefined, number>();
  for (const p of list) if (!p.dead) inGroup.set(p.root.spec.group, (inGroup.get(p.root.spec.group) ?? 0) + 1);
  for (const p of list) {
    if (seen.has(p) || p.dead || !ARCH_MATS.has(p.mat)) continue;
    const g = p.root.spec.group, isl = [p];
    seen.add(p);
    for (let i = 0; i < isl.length; i++) for (const w of isl[i].welds) {
      const o = w.a === isl[i] ? w.b : w.a;
      if (o && !seen.has(o) && !o.dead && o.root.spec.group === g) { seen.add(o); isl.push(o); }
    }
    let M = 0, mm = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of isl) {
      M += q.mass;
      if (ARCH_MATS.has(q.mat)) mm += q.mass;
      b3.b3Body_ComputeAABB(_hy, q.body);
      x0 = Math.min(x0, _hy[0]); y0 = Math.min(y0, _hy[1]); z0 = Math.min(z0, _hy[2]);
      x1 = Math.max(x1, _hy[3]); y1 = Math.max(y1, _hy[4]); z1 = Math.max(z1, _hy[5]);
    }
    // the whole of its building: a tower that is part of a church is not free-standing
    const h = y1 - y0;
    if (isl.length === inGroup.get(g) && mm >= HINGE.masonry * M && h >= STACK.tall && h >= STACK.slender * Math.max(x1 - x0, z1 - z0)) {
      for (const q of isl) { out.add(q); stackRoots.add(q.root); }
    }
  }
  return out;
}

function finishCalib(c: Calib, settle: boolean): void {
  designCheck = true;
  stepAnalysis(Infinity, new Set(c.pieces));
  designCheck = false;
  const { list, ten: mTen, shear: mShear, mag: mMag, tor: mTor } = c;
  const stacks = findStacks(c.pieces);
  for (let i = 0; i < list.length; i++) {
    const w = list[i], b = w.base;
    if (!w.alive) continue;
    w.calib = false;
    /* Steel connections are designed for their load (~55% utilisation), not for the bulk strength
       of steel — that is what lets a fire-softened frame fail at a realistic ~550–650 °C. */
    const k = w.metal ? DESIGN_FLOOR : 1, s = w.metal ? DESIGN_SAFETY : LOAD_SAFETY;
    b.comp = Math.max(b.comp * k, mMag[i] * s + 3000, w.supportForce * s + 3000);
    b.ten = Math.max(b.ten * k, mTen[i] * s + 800, -w.sN * s + 800);
    b.shear = Math.max(b.shear * k, mShear[i] * s + 800, (w.sV - w.mu * Math.max(0, w.sN)) * s + 800);
    b.torque = Math.max(b.torque * k, mTor[i] * s + 1500, w.supportTorque * s + 1500);
    /* Ageing eats into the design margin rather than the design: an old building stands with less to spare,
       but it has stood decades of wind and imposed load well above its self-weight, so it keeps twice that. */
    const ak = w.metal ? Math.max(w.j.ageK, 0.65) : w.j.ageK;
    if (ak < 1) {
      b.comp = Math.max(b.comp * Math.max(ak, w.j.ageC), Math.max(mMag[i], w.supportForce) * AGED_SAFETY + 3000);
      b.ten = Math.max(b.ten * ak, Math.max(mTen[i], -w.sN) * AGED_SAFETY + 800);
      b.shear = Math.max(b.shear * ak, Math.max(mShear[i], w.sV - w.mu * Math.max(0, w.sN)) * AGED_SAFETY + 800);
      b.torque = Math.max(b.torque * ak, Math.max(mTor[i], w.supportTorque) * AGED_SAFETY + 1500);
    }
    if (stacks.has(w.a) && (!w.b || stacks.has(w.b)) && !w.metal && (w.j.kind === 'mortar' || w.j.kind === 'bearing')) {
      b.comp = Math.max(b.comp, w.real.comp); b.ten = Math.max(b.ten, w.real.ten);
      b.shear = Math.max(b.shear, w.real.shear); b.torque = Math.max(b.torque, w.real.torque);
    }
    w.cap = { ...b };
    applyCaps(w);
    w.sd0 = staticDemand(w);
    if (building) {
      b3.b3Joint_SetForceThreshold(w.joint, w.cap.comp);
      b3.b3Joint_SetTorqueThreshold(w.joint, w.cap.torque);
    }
  }
  refreshSupportPressure();
  if (!settle) {
    for (const p of c.pieces) if (!p.dead) { copy3(p.spawnPos, p.curPos); copy4(p.spawnRot, p.curRot); }
    settling.push({ pieces: c.pieces, until: stepCount + SETTLE_WATCH });
    return;
  }
  for (const p of c.pieces) {
    b3.b3Body_SetLinearVelocity(p.body, [0, 0, 0]);
    b3.b3Body_SetAngularVelocity(p.body, [0, 0, 0]);
    b3.b3Body_GetPosition(p.curPos, p.body);
    b3.b3Body_GetRotation(p.curRot, p.body);
    copy3(p.prevPos, p.curPos); copy4(p.prevRot, p.curRot);
    copy3(p.spawnPos, p.curPos); copy4(p.spawnRot, p.curRot);
    setPieceTransform(p.gfx, p.curPos, p.curRot);
    p.movedStep = -1;
  }
  for (const p of c.pieces) b3.b3Body_SetAwake(p.body, false);
}

/* ---------------- level lifecycle ---------------- */

/* Call before physics.createWorld(): the old world (and every body) is destroyed wholesale. */
export function clearStructures(): void {
  for (const p of live) p.dead = true;
  clearDetail();
  clearBatches();
  rebarGfx.clear();
  ropeGfx.clear();
  clearSoft();
  clearSoftGfx();
  fields.clearFields();
  live.clear();
  debrisCount = 0;
  burning.clear();
  hot.clear();
  yielding.clear();
  supportPressure.clear();
  supportDirty = true;
  offers.clear();
  spent = new WeakMap();
  bullets.clear();
  stressHot.clear();
  stressIter = null;
  jointIter = null;
  jointT = 0;
  shake.clear();
  analysisReset();
  designIssues.length = 0;
  crackQueue.length = 0;
  cracking.clear();
  rebars.clear();
  ropeJoints.clear();
  clearServices();
  clearVehicles();
  calibs.length = 0;
  hingedList = [];
  hingedScan = -Infinity;
  partitioned = -Infinity;
  bearings.clear();
  shocks.length = 0;
  settling.length = 0;
  quakeT = -1;
  for (const k of Object.keys(counters) as (keyof typeof counters)[]) counters[k] = 0;
  dirty.length = 0;
  movedNow.length = 0;
  movedAt = -1;
  welds.clear();
  fractureQueue.length = 0;
  shatterQueue.length = 0;
  lateBlasts.length = 0;
  latePending.length = 0;
  fusing.length = 0;
  fading.length = 0;
  hangQueue.clear();
  hinges.length = 0;
  hingeJoints.clear();
  hingeWatch.clear();
  frozenList.length = 0;
  roots = [];
  totalVol = 0; totalValueSum = 0; demolishedVol = 0; clock = 0;
}

function newRoot(spec: PieceSpec, volume: number): Root {
  const prop = !!spec.noWeld && !spec.mech && !MATS[spec.mat].explosive;
  const root: Root = {
    spec, volume, value: MATS[spec.mat].value, protected: !!spec.protected, prop, demolishedVol: 0, penalized: false,
    density: effectiveDensity(spec, volume),
  };
  roots.push(root);
  if (!root.protected && !prop) { totalVol += volume; totalValueSum += volume * root.value; }
  return root;
}

/* Pieces are made in an order of their own (bottom up by place, then by shape and material), not the order a level or
   building happened to list them in: body and joint creation order sets the order Box3D solves them in, and a
   re-listed but identical structure must come down the same way. Machine parts are the exception: each finds its host
   by overlap among the parts already rigged (services.ts findHost), so they keep their authored order, after
   everything else. A test turns the sort off to measure the rest. */
export const spawnOrder = { canonical: true };
const mm = (v: number) => Math.round(v * 1000);
function specKey(s: PieceSpec): string {
  return `${mm(s.pos[1])},${mm(s.pos[0])},${mm(s.pos[2])}|${mm(s.size[0])},${mm(s.size[1])},${mm(s.size[2])}|${mm(s.rotY ?? 0)}|${s.mat}|${s.shape ?? ''}${s.sides ?? ''}|${s.verts ? s.verts.map(v => v.map(mm).join(',')).join(';') : ''}`;
}
function canonical(specs: readonly PieceSpec[]): readonly PieceSpec[] {
  if (!spawnOrder.canonical) return specs;
  const keyed = specs.map((s, i) => ({ s, i, k: specKey(s) }));
  keyed.sort((a, b) => {
    const ma = a.s.mech ? 1 : 0, mb = b.s.mech ? 1 : 0;
    if (ma !== mb) return ma - mb;
    if (ma) return a.i - b.i;
    return a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i;
  });
  return keyed.map(x => x.s);
}

export function buildBlueprint(bp: Blueprint): void {
  if (bp.terrain) buildTerrain(bp.terrain); else ensureTerrain();
  building = true;
  const list: Piece[] = [];
  for (const spec of canonical(bp.pieces)) {
    const volume = specVolume(spec);
    if (volume <= 0) continue;
    const root = newRoot(spec, volume);
    const p = spawnSpec(spec, root);
    if (p) { list.push(p); if (spec.detail) attachDetail(p); }
  }
  autoWeld(list);
  ageInit(list);
  linkRopes(list);
  linkMechs(list, 0);
  linkVehicles(list);
  calibrate();
  building = false;
  refreshSupportPressure();
  refreshServices();
  createSoftFor(list);
}

export function demolitionFraction(): number {
  return totalVol > 0 ? Math.min(1, demolishedVol / totalVol) : 0;
}

export function totalValue(): number {
  return totalValueSum;
}

export function stats(): { pieces: number; welds: number; ropes: number; queued: number; burning: number; hot: number; rebar: number; yielding: number }
  & typeof counters & ReturnType<typeof serviceStats> {
  return {
    pieces: live.size, welds: welds.size, ropes: ropeJoints.size, queued: fractureQueue.length, burning: burning.size, hot: hot.size,
    rebar: rebars.size, yielding: yielding.size, ...counters, ...serviceStats(),
  };
}

/* ---------------- demolition accounting ---------------- */

function credit(root: Root, vol: number, pos: Vec3): void {
  if (vol <= 0 || building || (root.prop && !root.protected)) return;
  root.demolishedVol += vol;
  for (let r = root.parent; r; r = r.parent) r.demolishedVol += vol;
  if (root.protected) {
    if (!root.penalized) {
      root.penalized = true;
      scoring.addPenalty(Math.round(400 + root.volume * root.value * 4));
      onProtectedHit(pos);
    }
    return;
  }
  demolishedVol += vol;
  scoring.addDemolition(vol * root.value);
}

function markDemolished(p: Piece): void {
  if (p.demolished) return;
  p.demolished = true;
  credit(p.root, p.volume, p.curPos);
  rubble(p);
}

/* A member brought down and free of the structure is rubble: it settles into its pile like the fragments do, instead of
   one last creeping block keeping thousands awake in the pile's solver island. */
function rubble(p: Piece): void {
  if (p.depth === 0 && !p.dead && p.demolished && !p.welds.length) b3.b3Body_SetSleepThreshold(p.body, p.volume < RUBBLE_VOL ? 0.1 : 0.07);
}

function pieceMoved(p: Piece): void {
  if (!p.dirty) { p.dirty = true; dirty.push(p); }
  if (movedAt !== stepCount) { movedAt = stepCount; movedNow.length = 0; }
  movedNow.push(p);
  p.sleepT = 0;
  if (p.proxied > 0 && !building) hostMoved(p);
  if (p.demolished || building || p.hinged) return;
  const dx = p.curPos[0] - p.spawnPos[0], dy = p.curPos[1] - p.spawnPos[1], dz = p.curPos[2] - p.spawnPos[2];
  if (dx * dx + dy * dy + dz * dz > DISPLACED * DISPLACED || Math.abs(quat.dot(p.curRot, p.spawnRot)) < TILTED) markDemolished(p);
}

/* ---------------- joint failure ---------------- */

type FailMode = 'overload' | 'blast' | 'kinetic' | 'rupture';

/* Brittle joints crack. Ductile joints first yield into a plastic hinge and only rupture once their
   rotation capacity is used up. Cracked reinforced concrete stays tied by its rebar. */
function failWeld(w: Weld, mode: FailMode, crack = true): void {
  if (!w.alive) return;
  if (mode === 'overload' && hingeBed(w)) return;
  weldPos(w, _fk);
  chance.at(_fk[0], _fk[1], _fk[2], stepCount, 1);
  if (cracking.has(w)) {
    if (crack) return;
    cracking.delete(w);
  }
  if (mode === 'overload' && laminaStep(w)) return;
  if (mode === 'overload' && opens(w)) {
    breakWeld(w);
    if (bearings.size < MAX_BEARINGS) bearings.add(w);
    return;
  }
  const hotSolder = (w.j.kind === 'solder' || w.j.kind === 'braze') && w.j.heatK < 0.5;
  if (w.ductile && !hotSolder && !yielding.has(w) && w.plastic < w.limit && w.reyields < 2 && mode !== 'rupture' && mode !== 'blast') {
    if (w.yielded) w.reyields++;
    yieldWeld(w);
    return;
  }
  if (crack && mode !== 'blast' && !w.metal && tryCrack(w)) return;
  const pos = weldPos(w, [0, 0, 0]);
  const nrm = weldNormal(w, [0, 0, 0]);
  const a = w.a, b = w.b, area = w.area, reinforced = w.rebar;
  breakWeld(w, mode === 'rupture');
  if (reinforced && (mode === 'rupture' || mode === 'kinetic' || chance() < 0.45)) addRebar(a, b, pos, nrm, area, 0.12, w.j.anch);
  if (mode !== 'overload' && !(mode === 'rupture' && a.pm.style === 'splinter')) return;
  for (const q of [a, b]) {
    if (!q || q.dead || q.queued || q.pm.style !== 'splinter' || q.depth >= MAX_DEPTH || q.volume < 0.02 || chance() > 0.55) continue;
    q.queued = true;
    fractureQueue.push({ p: q, point: pos, intensity: 1.2, blast: false });
  }
}

/* A connection that lets go drops the static load it carried on the members it held, and each must stay in
   equilibrium: until the structure is solved again its other connections take that force (and its moment, carried
   to their own anchors) in proportion to their area. That is the first hop of the redistribution a real frame makes
   within milliseconds; if it overloads them they go in turn, so a failure runs through a frame at a member a step
   rather than a solve at a time, and the next solve finds where the load really settles. Only continuous (ductile)
   frames: masonry finds its way to a thrust line through arching across many blocks, which one hop cannot see, so
   its joints wait for the solve as before. */
const _sd: Vec3 = [0, 0, 0], _sm: Vec3 = [0, 0, 0], _sp: Vec3 = [0, 0, 0], _sn: Vec3 = [0, 0, 0];
function shedLoad(w: Weld, at: Vec3): void {
  const F = w.sF;
  if (!F || !w.ductile || building || w.calib || !analysed(w.a)) return;
  for (let side = 0; side < 2; side++) {
    const m = side ? w.b : w.a;
    if (!m || m.dead) continue;
    // what w put on m: +F on its b side, −F on its a side
    const s = side ? 1 : -1;
    let area = 0;
    for (const v of m.welds) if (v.alive && !v.calib && v.sF && v.ductile) area += v.area;
    if (area <= 0) continue;
    for (const v of m.welds) {
      const G = v.sF;
      if (!v.alive || v.calib || !G || !v.ductile) continue;
      const k = (s * v.area) / area;
      weldPos(v, _sp);
      vec3.sub(_sd, at, _sp);
      _sm[0] = F[3] + _sd[1] * F[2] - _sd[2] * F[1];
      _sm[1] = F[4] + _sd[2] * F[0] - _sd[0] * F[2];
      _sm[2] = F[5] + _sd[0] * F[1] - _sd[1] * F[0];
      // v now supplies that share on m: on its b side if m is v's b, else the opposite on its b side
      const t = v.b === m ? k : -k;
      for (let q = 0; q < 3; q++) { G[q] += t * F[q]; G[3 + q] += t * _sm[q]; }
      weldNormal(v, _sn);
      const N = G[0] * _sn[0] + G[1] * _sn[1] + G[2] * _sn[2];
      v.sN = N;
      v.sV = Math.sqrt(Math.max(0, G[0] * G[0] + G[1] * G[1] + G[2] * G[2] - N * N));
      v.supportForce = Math.hypot(G[0], G[1], G[2]);
      v.supportTorque = Math.hypot(G[3], G[4], G[5]) * G[6];
      if (staticRatio(v) > 1.05) supportPressure.add(v);
    }
  }
}

const _fk: Vec3 = [0, 0, 0];
/** Restart the structure's and the fracture's chance from where and when a piece breaks. */
function seedAt(p: Piece, at: ArrayLike<number>, salt: number): void {
  chance.at(p.spawnPos[0], p.spawnPos[1], p.spawnPos[2], at[0], at[1], at[2], stepCount, salt);
  P.rand.at(p.spawnPos[0], p.spawnPos[1], p.spawnPos[2], at[0], at[1], at[2], stepCount, salt);
}

/* Mortar and dry bearing joints have next to no tensile strength: statically pulled apart they open along the joint
   (not through the stone), and the blocks still bear on each other wherever the load comes back into compression.
   The frame analysis keeps such an opened joint as a compression-only bearing, as Box3D's contacts do, so a vault
   that cracks finds its way to a thrust line instead of unzipping joint by joint. */
const MAX_BEARINGS = 600;
const bearings = new Set<Weld>();
function opens(w: Weld): boolean {
  if (w.ductile || (w.j.kind !== 'mortar' && w.j.kind !== 'bearing')) return false;
  const c = w.cap, ten = -w.sN / c.ten;
  return ten >= 1 && ten >= w.supportForce / c.comp && ten >= w.supportTorque / c.torque && ten >= w.sV / (c.shear + w.mu * Math.max(0, w.sN));
}

/* A bearing lasts while its blocks stay together: once they have moved apart they no longer touch there. */
const BEAR_GAP = 0.05;
function checkBearings(): void {
  for (const w of bearings) {
    const a = w.a, b = w.b;
    let gone = a.dead || !!b?.dead;
    if (!gone && (a.movedStep >= stepCount - 10 || (b && b.movedStep >= stepCount - 10))) {
      toWorld(_v, a.curPos, a.curRot, w.fa.position);
      if (b) toWorld(_w, b.curPos, b.curRot, w.fb.position);
      else vec3.add(_w, w.fb.position, GROUND_POS);
      gone = vec3.squaredDistance(_v, _w) > BEAR_GAP * BEAR_GAP;
    }
    if (!gone) continue;
    bearings.delete(w);
    analysisTouch(a); analysisTouch(b); supportDirty = true;
  }
}

function breakWeld(w: Weld, ductileRupture = false): void {
  if (!w.alive) return;
  const pos = weldPos(w, [0, 0, 0]);
  counters.snaps++;
  killWeld(w, true);
  shedLoad(w, pos);
  if (ductileRupture) audio.steelGroan(pos, 1);
  snapFx(pos, w);
}

function snapFx(pos: Vec3, w: Weld): void {
  audio.snap(pos, clamp(w.base.comp / 900e3, 0.1, 1));
  if (fxBudget > 0) {
    fxBudget--;
    fx.dust(pos, 0.7, w.a.pm.dust);
    fx.debris(pos, 5, w.a.pm.chips, 2.5);
    if (w.a.pm.surface === 'metal') fx.sparks(pos, [0, 1, 0], 10);
  }
}

function scaleWeld(w: Weld, k: number, wake = true): void {
  const b = w.base;
  b.comp *= k; b.ten *= k; b.shear *= k; b.torque *= k;
  applyCaps(w);
  if (wake) b3.b3Joint_WakeBodies(w.joint);
}

/* Energy a connection absorbs before it lets go: the weaker side's fracture energy over a damage
   zone behind the contact face. Steel connections tear rather than crack. */
function jointToughness(w: Weld): number {
  const t = Math.min(w.a.pm.toughness, w.b ? w.b.pm.toughness : Infinity);
  return clamp(t, 5e3, 250e3) * Math.max(w.area, 0.02) * 0.35;
}

function damageWeld(w: Weld, d: number): void {
  if (!w.alive || w.calib || building || d < 0.01) return;
  w.dmg = Math.min(1, w.dmg + d);
  if (w.dmg >= 1) {
    failWeld(w, 'kinetic');
    if (w.alive) { w.dmg = 0.5; applyCaps(w); }
    return;
  }
  applyCaps(w);
}

/* A welded island moving as one: its mass, or Infinity once any member is still founded. */
const islandMassOf = new Map<Piece, number>();
let islandStep = -1;
function islandMass(p: Piece): number {
  if (!p.welds.length) return p.mass;
  if (islandStep !== stepCount) { islandMassOf.clear(); islandStep = stepCount; }
  const known = islandMassOf.get(p);
  if (known !== undefined) return known;
  const seen = [p], set = new Set(seen);
  let m = 0, grounded = false;
  for (let i = 0; i < seen.length && seen.length < 160; i++) {
    const q = seen[i];
    m += q.mass;
    for (const w of q.welds) {
      if (!w.b) { grounded = true; break; }
      const o = w.a === q ? w.b : w.a;
      if (!set.has(o)) { set.add(o); seen.push(o); }
    }
    if (grounded) break;
  }
  if (grounded) m = Infinity;
  for (const q of seen) islandMassOf.set(q, m);
  return m;
}

/* The shock of a hit runs through the struck piece into its connections, nearest first. */
function jolt(p: Piece, point: Vec3, e: number): void {
  if (!p.welds.length || e < 1500) return;
  const share = (e * JOLT) / p.welds.length;
  for (const w of p.welds.slice()) {
    weldPos(w, _v);
    damageWeld(w, (share / (1 + vec3.distance(_v, point))) / jointToughness(w));
  }
}

function yieldWeld(w: Weld): void {
  w.yielded = true;
  w.quiet = 0;
  counters.yields++;
  b3.b3WeldJoint_SetAngularHertz(w.joint, w.metal ? 2.2 : 1.2);
  b3.b3WeldJoint_SetAngularDampingRatio(w.joint, 1.2);
  b3.b3WeldJoint_SetLinearHertz(w.joint, w.metal ? 9 : 5);
  b3.b3WeldJoint_SetLinearDampingRatio(w.joint, 1);
  applyCaps(w);
  yielding.add(w);
  b3.b3Joint_WakeBodies(w.joint);
  if (groanT <= 0) { groanT = 0.35; audio.steelGroan(weldPos(w, _v), 0.6); }
}

const _fbq: Quat = [0, 0, 0, 1];
const _anchor: Vec3 = [0, 0, 0];
const _tor: Vec3 = [0, 0, 0];

/* Plastic flow, resolved every other step by return mapping: a yielded hinge loaded past yield has its rest pose moved
   just far enough that the elastic hinge carries its yield moment (and force) again, so steel stays bent and a
   mechanism turns as fast as its load outweighs the hinges. The rotation it accumulates is its ductility budget. */
const YIELD_EVERY = 2;
const HARDEN_POLLS = 45;         // …a hinge that has not been loaded for ~1.5 s work-hardens
function updateYield(): void {
  for (const w of yielding) {
    if (!w.alive) { yielding.delete(w); continue; }
    const a = w.a, b = w.b;
    let loaded = a.movedStep >= stepCount - 1 || (!!b && b.movedStep >= stepCount - 1);
    let flowR = 0, flowL = 0;
    if (loaded) {
      const os = overstrength(w);
      b3.b3Joint_GetConstraintTorque(_tor, w.joint);
      b3.b3Joint_GetConstraintForce(_jf, w.joint);
      const rt = (vec3.length(_tor) * os) / w.cap.torque, rf = (vec3.length(_jf) * os) / w.cap.comp;
      loaded = rt > 0.9 || rf > 0.9;
      flowR = rt > 1 ? Math.min(0.9, 1 - 1 / rt) : 0;
      flowL = rf > 1 ? Math.min(0.9, 1 - 1 / rf) : 0;
    }
    if (!loaded) {
      /* A hinge that has stopped turning work-hardens in its bent shape: stiff again, so the island
         can sleep; it re-yields if overloaded later, until its rotation capacity is spent. */
      if (++w.quiet >= HARDEN_POLLS) {
        yielding.delete(w);
        b3.b3WeldJoint_SetAngularHertz(w.joint, 0);
        b3.b3WeldJoint_SetLinearHertz(w.joint, 0);
      }
      continue;
    }
    w.quiet = 0;
    if (flowR <= 0 && flowL <= 0) continue;
    toWorld(_anchor, a.curPos, a.curRot, w.fa.position);
    quat.multiply(_q2, a.curRot, w.fa.quaternion);
    if (b) {
      quat.conjugate(_q, b.curRot);
      quat.multiply(_fbq, _q, _q2);
      toLocal(_w, b.curPos, b.curRot, _anchor);
    } else {
      quat.copy(_fbq, _q2);
      vec3.set(_w, _anchor[0] - GROUND_POS[0], _anchor[1] - GROUND_POS[1], _anchor[2] - GROUND_POS[2]);
    }
    const step = quat.getAngle(w.fb.quaternion, _fbq) * flowR;
    if (flowR > 0) quat.slerp(w.fb.quaternion, w.fb.quaternion, _fbq, flowR);
    if (flowL > 0) vec3.lerp(w.fb.position, w.fb.position, _w, flowL);
    b3.b3Joint_SetLocalFrameB(w.joint, w.fb);
    w.plastic += step;
    if (step > 0.004 && groanT <= 0) { groanT = 0.5; audio.steelGroan(_anchor, clamp(step * 25, 0.2, 1)); }
    if (w.plastic > w.limit) failWeld(w, 'rupture');
  }
}

/* Tension and shear aren't Box3D thresholds, so awake joints are checked here against their envelope. */
function pollJoints(): void {
  if (movedAt !== stepCount) return;
  for (const p of movedNow) {
    if (p.dead || p.movedStep !== stepCount) continue;
    const dx = p.curPos[0] - p.prevPos[0], dy = p.curPos[1] - p.prevPos[1], dz = p.curPos[2] - p.prevPos[2];
    const moving = dx * dx + dy * dy + dz * dz > MOVING_STEP * MOVING_STEP || Math.abs(quat.dot(p.curRot, p.prevRot)) < MOVING_TURN;
    for (let i = p.welds.length - 1; i >= 0; i--) {
      const w = p.welds[i];
      if (!w || w.polled === stepCount || w.calib || (!moving && w.calm > stepCount)) continue;
      w.polled = stepCount;
      b3.b3Joint_GetConstraintForce(_jf, w.joint);
      weldNormal(w, _n);
      const fn = vec3.dot(_jf, _n);
      const sh = Math.sqrt(Math.max(0, vec3.squaredLength(_jf) - fn * fn));
      const ratio = Math.max(-fn / w.cap.ten, sh / (w.cap.shear + w.mu * Math.max(0, fn)));
      if (ratio > 1) { overload(w, ratio); continue; }
      /* a joint far inside its envelope on a member that is only settling cannot reach it within a few steps */
      if (!moving && ratio < 0.35) w.calm = stepCount + 8;
      /* friction-grip bolts slip into bearing at the same share of their capacity as the real joint */
      if (w.j.kind === 'bolt' && !w.j.slipped && sh > (J.slipResistance(w.j) * w.cap.shear) / Math.max(w.real.shear, 1)) boltSlip(w);
      /* Below the static envelope a moving connection still degrades: repeated dynamic peaks
         open microcracks, so a swaying or toppling assembly loosens and breaks up as it goes.
         Steel details count them against their S-N curve (and bolts back off). */
      if (!moving) continue;
      b3.b3Joint_GetConstraintTorque(_tor, w.joint);
      const u = Math.max(ratio, vec3.length(_jf) / w.cap.comp, vec3.length(_tor) / w.cap.torque);
      if (w.j.dsc > 0 && u > 0.3 && J.addCycles(w.j, u * w.j.Fr, 1)) { fatigueFail(w); continue; }
      if (w.metal) continue;
      if (u > FATIGUE_U) damageWeld(w, (u - FATIGUE_U) * FATIGUE_RATE);
    }
  }
}

function overload(w: Weld, ratio: number): void {
  /* A topology change (a piece swapped for fragments) spikes neighbours for a step or two,
     so only sustained or gross overload fails a joint. */
  if (w.lastOver === stepCount) return;
  if (w.lastOver < stepCount - 2) w.overSteps = 0;
  w.lastOver = stepCount;
  w.overSteps++;
  /* A rigid welded island hands an impact to every joint on the load path within one step, where a
     real frame would absorb it over milliseconds and fail locally. A one-step spike therefore only
     damages a joint in proportion to the overstress; the joints nearest the blow, which see the
     largest share, still go at once. */
  const remote = remoteFromShock(w);
  if (analysed(w.a)) {
    /* In a founded structure a Box3D spike is mostly the rigid island passing a release or a blow on at once,
       not a load this joint must carry. A real blow still breaks the joints it lands next to outright and
       damages the rest in proportion. Beyond that the joint must carry the frame analysis's static
       redistribution, and a sudden release can overshoot only the *change* in its load, by at most DAF
       (undamped step load): peak = before + DAF·(after − before). A joint with that reserve rides the transient
       out; one without it fails once the overload has lasted ~0.1 s. While the structure has changed since its
       last solve the analysis cannot vouch for the joint either way: a ductile joint beside the change that stays
       overloaded as long, with nothing striking its members, is carrying the new load path and yields (a frame that
       lost its columns comes down at the speed of its hinges, not of the solver). Further off, or in brittle
       masonry, a rigid island's share of the change is not to be trusted (a collapsing nave drags on a tower's
       footings through stone that would tear first) and waits for the solve. A joint that stays overloaded while its
       members have come to rest after being struck is carrying something the analysis cannot see (rubble
       landed on a floor bears on it through contacts) and fails after ~1 s regardless. */
    if (!remote && w.overSteps === 1 && ratio >= SHOCK_FAIL) { counters.eventSnaps++; failWeld(w, 'overload'); return; }
    const sd = staticDemand(w), peak = sd + (DAF - 1) * Math.max(0, sd - w.sd0);
    if (w.overSteps === 1 && ratio > 1.5) damageWeld(w, Math.min(0.4, (ratio - 1) * SHOCK_DAMAGE * (remote ? Math.min(1, peak) : 1)));
    if (!w.alive) return;
    if (peak >= 1) { if (w.overSteps >= TRANSIENT_POLLS) offerFailure(w, peak, true); }
    else if (w.ductile && w.overSteps >= TRANSIENT_POLLS && analysisStale(w.a) && !loadedByContact(w) && (besideChange(w.a) || besideChange(w.b))) offerFailure(w, ratio, false);
    else if (w.overSteps >= UNMODELLED_POLLS && resting(w.a) && (!w.b || resting(w.b)) && loadedByContact(w)) offerFailure(w, ratio, false);
    else if (w.ductile && analysisStale(w.a)) analysisUrgent(w.a, URGENT_STEPS);
    return;
  } else if (w.overSteps < 4 && (ratio < SHOCK_FAIL || (w.overSteps === 1 && remote))) {
    if (w.overSteps === 1 && ratio > 1.5) damageWeld(w, Math.min(0.4, (ratio - 1) * SHOCK_DAMAGE));
    return;
  }
  counters.eventSnaps++;
  failWeld(w, 'overload');
}

/* ---------------- connections over time (joints.ts) ---------------- */

const JOINT_TICK = 0.5, JOINT_SCAN = 60;      // machine pass period, s; connections revisited per step
/* Game-time acceleration of slow processes: each second of play counts this many seconds of machine and wind
   cycles, days of sustained load (creep) and hours of adhesive cure. Fire keeps its own clock (a minute a second). */
const VIB_TIME = 200, CREEP_DAYS = 1, CURE_HOURS = 1;
let jointT = 0;
let jointIter: IterableIterator<Weld> | null = null;
const shake = new Map<Piece, [number, number]>();          // render jitter: amplitude m, frequency Hz
const stains = new WeakMap<Piece, number>();
const crushOf = new WeakMap<Piece, number>();
const lams = new WeakMap<Piece, J.Laminate | null>();
/** Last machine-vibration pass: running machines, the worst dynamic amplification and floor amplitude (m). */
export const vibration = { machines: 0, peakDAF: 0, peakRatio: 0, peakAmp: 0 };

function fatigueFail(w: Weld): void {
  if (!w.alive) return;
  counters.fatigue++;
  breakWeld(w);
}

/* Past its friction grip a bolted joint jumps its hole clearance into bearing: stiff again once the bolts bear, but
   in the weaker bearing-type fatigue class and loosening faster. */
function boltSlip(w: Weld): void {
  w.j.slipped = true;
  counters.slips++;
}

/** Local axis of p closest to world up. */
function upAxis(p: Piece): number {
  dirLocal(_g, p.curRot, [0, 1, 0]);
  const x = Math.abs(_g[0]), y = Math.abs(_g[1]), z = Math.abs(_g[2]);
  return x >= y && x >= z ? 0 : y >= z ? 1 : 2;
}

/** A member as a beam spanning its longest horizontal extent: span, E, second moment of its depth. */
function beamOf(q: Piece): { L: number; E: number; I: number } {
  const d = pieceDims(q), k = upAxis(q), h = d[k], u = d[(k + 1) % 3], v = d[(k + 2) % 3];
  const fill = Math.min(1, (3 * q.root.density) / q.pm.density);
  return { L: Math.max(u, v, 0.3), E: q.pm.eng.E * 1e9 * Math.max(0.05, q.heatK), I: ((Math.min(u, v) * h ** 3) / 12) * fill };
}

/* Running machines shake what carries them: the rotor's residual unbalance (ISO 21940, worse once battered) passes
   through any rubber mount (transmissibility), and the floor member amplifies it by its dynamic response at the
   machine's speed against its own first mode. The cycles load the machine's holding-down and the floor's supports;
   a member near resonance hums and visibly shakes. */
function machineVibration(dt: number): void {
  for (const p of shake.keys()) if (!p.dead && !p.dirty) setPieceTransform(p.gfx, p.curPos, p.curRot, fadeScale(p));
  shake.clear();
  vibration.machines = 0; vibration.peakDAF = 0; vibration.peakRatio = 0; vibration.peakAmp = 0;
  let loud: Piece | null = null, loudA = 0;
  for (const p of live) {
    if (!p.hinged || p.dead) continue;
    const st = mechState(p), om = st ? Math.abs(st.speed) : 0;
    if (om < 5) continue;
    const host = machineRoot(p);
    if (!host || host.dead) continue;
    vibration.machines++;
    const f = om / (2 * Math.PI), n = f * dt * VIB_TIME;
    const worn = Number.isFinite(p.hp) && p.hp > 0 ? clamp(p.damage / p.hp, 0, 1) : 0;
    const F0 = J.unbalance(p.mass, om, 6.3e-3 * (1 + 15 * worn));
    for (const w of host.welds.slice()) {
      let q: Piece | null = w.a === host ? w.b : w.a, F = F0;
      if (q && q.mat === 'rubber') {
        const d = pieceDims(q), k = (q.pm.eng.E * 1e9 * J.rubberStiffening(f) * w.area) / Math.max(0.01, Math.min(d[0], d[1], d[2]));
        F *= J.transmissibility(f / (Math.sqrt(k / Math.max(host.mass, 1)) / (2 * Math.PI)), J.materialDamping('rubber'));
        let next: Piece | null = null;
        for (const v of q.welds) { const o: Piece | null = v.a === q ? v.b : v.a; if (o && o !== host && (!next || o.mass > next.mass)) next = o; }
        q = next;
      }
      if (J.addCycles(w.j, 2 * F, n)) { fatigueFail(w); continue; }
      if (!q || q.hinged || q.dead || !q.welds.length) continue;
      const bm = beamOf(q), f1 = J.firstMode(bm.E, bm.I, (q.mass + host.mass) / bm.L, bm.L);
      let z = J.materialDamping(q.mat);
      for (const v of q.welds) z += v.j.zeta / q.welds.length;
      const r = f / f1, amp = J.amplification(r, Math.min(0.2, z)), Fd = F * amp;
      const x = (Fd * bm.L ** 3) / (48 * bm.E * bm.I);
      if (amp > vibration.peakDAF) { vibration.peakDAF = amp; vibration.peakRatio = r; }
      vibration.peakAmp = Math.max(vibration.peakAmp, x);
      const share = (2 * Fd) / q.welds.length;
      for (const v of q.welds.slice()) if (v !== w && J.addCycles(v.j, share, n)) fatigueFail(v);
      if (x > 1e-4) {
        shake.set(q, [Math.min(0.012, x * 4), f]);
        if (x > loudA) { loudA = x; loud = q; }
      }
    }
  }
  if (loud) audio.structureStress(loud.curPos, clamp(0.45 + (0.55 * loudA) / 2e-3, 0.45, 1), loud.mat);
}

const wetOf = (w: Weld) => Math.max(w.a.mat === 'cardboard' ? fields.recOf(w.a).wet : 0, w.b?.mat === 'cardboard' ? fields.recOf(w.b).wet : 0);

/* One connection's slow life since its last visit: bolts slipping under static shear once their clamp has gone,
   glue curing, board going soft in the wet, gust cycles high on tall structures, creep. */
function jointVisit(w: Weld): void {
  const j = w.j, el = clock - j.t;
  j.t = clock;
  if (el <= 0 || w.calib) return;
  const T = Math.max(w.a.temp, w.b ? w.b.temp : AMBIENT);
  if (j.kind === 'bolt' && !j.slipped && w.sV > J.slipResistance(j)) boltSlip(w);
  if (j.adhesive && j.cure < 1) J.cureStep(j, el * CURE_HOURS, T);
  if ((j.adhesive || w.a.mat === 'cardboard' || w.b?.mat === 'cardboard') && J.updateHeatK(j, T, wetOf(w))) applyCaps(w);
  if (windStrength > 0.2) {
    weldPos(w, _v);
    if (_v[1] > 12) {
      /* gust buffeting at the structure's sway frequency, n₁ ≈ 46 / h (EN 1991-1-4 F.2) */
      const n1 = 46 / (_v[1] * 1.5), S = 0.12 * windStrength * windStrength * Math.min(1, _v[1] / 60);
      if (J.addCycles(j, S * j.Fr * j.ageK * (1 + DMG_SOFTEN * w.dmg), n1 * el * VIB_TIME)) { fatigueFail(w); return; }
    }
  }
  const age = w.a.root.spec.age ?? w.b?.root.spec.age;
  const wet = age?.exposure === 'wet' || age?.exposure === 'salt', out = age?.exposure === 'outdoor';
  const pa = J.creepFinal(w.a.mat, wet, out), pb = w.b ? J.creepFinal(w.b.mat, wet, out) : 0;
  if ((pa > 0 || pb > 0) && w.supportTorque > 0) {
    const phi = J.creepPhi(Math.max(pa, pb), (clock - j.t0) * CREEP_DAYS, pa >= pb ? w.a.mat : w.b!.mat);
    const dphi = phi - j.phi;
    j.phi = phi;
    if (dphi > 0) creepSag(w, dphi);
  }
  if (j.soft && T < j.soft[0]) {
    j.creepD += J.creepRupture(j, staticRatio(w), T, el * CREEP_DAYS * 24, false);
    if (j.creepD >= 1) { counters.creepFails++; breakWeld(w); }
  }
}

/* Creep shows where a member hangs off a single connection (a cantilever, a bracket): its rest pose droops by
   φ × its elastic rotation M·L/(2EI). Elsewhere rigid bodies cannot bend, so the creep is carried in j.phi. */
function creepSag(w: Weld, dphi: number): void {
  const b = w.b;
  if (!b) return;
  weldNormal(w, _n);
  if (Math.abs(_n[1]) > 0.5) return;
  const beam = hangsOff(w.a, w) ? w.a : hangsOff(b, w) ? b : null;
  if (!beam) return;
  const bm = beamOf(beam);
  w.j.pend += (dphi * w.supportTorque * bm.L) / (2 * bm.E * bm.I);
  if (w.j.pend < 1e-3 || w.j.sag >= 0.05) return;
  const da = Math.min(w.j.pend, 0.05 - w.j.sag);
  w.j.sag += da;
  w.j.pend = 0;
  /* rotating A by +da about n × up about the anchor droops whichever side overhangs: fb' = q̄B·R·qB·fb */
  vec3.cross(_w, _n, [0, 1, 0]);
  vec3.normalize(_w, _w);
  quat.setAxisAngle(_q, _w, da);
  quat.conjugate(_fbq, b.curRot);
  quat.multiply(_fbq, _fbq, _q);
  quat.multiply(_fbq, _fbq, b.curRot);
  quat.multiply(_q2, _fbq, w.fb.quaternion);
  quat.copy(w.fb.quaternion, _q2);
  b3.b3Joint_SetLocalFrameB(w.joint, w.fb);
  b3.b3Joint_WakeBodies(w.joint);
}

/* q is held only by w: its other connections all carry things resting on top of it. */
function hangsOff(q: Piece, w: Weld): boolean {
  for (const v of q.welds) {
    if (v === w) continue;
    weldNormal(v, _ext3);
    if ((v.a === q ? _ext3[1] : -_ext3[1]) < 0.5) return false;
  }
  return true;
}
const _ext3: Vec3 = [0, 0, 0];

/** Cost of the slow connection processes (vibration, fatigue, creep, cure), for profiling. */
export const jointCost = { ms: 0, ticks: 0 };

function jointsStep(dt: number): void {
  if (building) return;
  const t0 = performance.now();
  jointT += dt;
  if (jointT >= JOINT_TICK) { jointT -= JOINT_TICK; machineVibration(JOINT_TICK); }
  for (let n = 0; n < JOINT_SCAN; n++) {
    if (!jointIter) jointIter = welds.values();
    const r = jointIter.next();
    if (r.done) { jointIter = null; break; }
    if (r.value.alive) jointVisit(r.value);
  }
  jointCost.ms += performance.now() - t0;
  jointCost.ticks++;
}

/* Solder runs, adhesives let go past their glass transition, fire overages a weld's heat-affected zone, and a
   loaded steel connection creeps once it is past ~400 °C (on the fire clock). */
function heatJoints(p: Piece): void {
  for (const w of p.welds.slice()) {
    const j = w.j;
    if (!j.soft && j.kind !== 'weld' && !(w.metal && p.temp > 400)) continue;
    const T = Math.max(w.a.temp, w.b ? w.b.temp : AMBIENT);
    if (T >= j.melt) { counters.melts++; breakWeld(w); continue; }
    if (J.updateHeatK(j, T, wetOf(w))) applyCaps(w);
    if (w.calib || building) continue;
    j.creepD += J.creepRupture(j, staticRatio(w), T, HEAT_TICK / 60, w.metal);
    if (j.creepD >= 1) { j.creepD = 0; counters.creepFails++; failWeld(w, 'overload'); }
  }
}

function lamOf(p: Piece): J.Laminate | null {
  let l = lams.get(p);
  if (l === undefined) { l = p.depth === 0 ? J.laminateOf(p.root.spec, p.mat) : null; lams.set(p, l); }
  return l;
}

/* A laminate fails a layer at a time: the plies first part (each then bends alone, so the section keeps 1/n of its
   bending strength), then shed one by one; the joint only lets go once the few plies left give up too. */
function laminaStep(w: Weld): boolean {
  for (const q of [w.a, w.b]) {
    const l = q ? lamOf(q) : null;
    if (!q || !l || l.intact <= 1 || l.plies - l.intact >= 3) continue;
    if (!l.delam) {
      l.delam = true;
      counters.delams++;
      for (const v of q.welds) { v.base.torque /= l.intact; applyCaps(v); }
    } else {
      const k = (l.intact - 1) / l.intact;
      l.intact--;
      for (const v of q.welds.slice()) scaleWeld(v, k, false);
    }
    weldPos(w, _v);
    audio.snap(_v, 0.25);
    if (fxBudget > 0) { fxBudget--; fx.debris(_v, 4, q.pm.chips, 1.5); }
    b3.b3Joint_WakeBodies(w.joint);
    return true;
  }
  return false;
}

/* Pre-aged buildings wear their service: rust-stained steel and cast iron, cracked cover over corroding bars. */
function ageInit(list: Piece[]): void {
  for (const p of list) {
    const age = p.root.spec.age;
    if (!age) continue;
    if (p.mat === 'rconcrete' && J.carbonation(age).cracked) p.damage = Math.max(p.damage, p.hp * 0.15);
    const st = J.stainOf(p.mat, age, p.root.spec.finish === 'galv');
    if (st > 0.02) stains.set(p, st);
    if (st > 0.02 || p.damage > 0) refreshColor(p);
  }
}

/** The connection model behind a weld (tools and tests). */
export function jointOf(w: Weld): J.Joint {
  return w.j;
}

/** Drive n load cycles of force range ΔF (N) through a connection, as traffic or plant would. True once it has failed. */
export function cycleJoint(w: Weld, dF: number, n: number): boolean {
  if (!w.alive) return true;
  if (J.addCycles(w.j, dF, n)) { fatigueFail(w); return true; }
  if (w.j.kind === 'bolt' && !w.j.slipped && w.sV > J.slipResistance(w.j)) boltSlip(w);
  return false;
}

/** Permanent crush strain of a foam or board piece. */
export function crushOfPiece(p: Piece): number {
  return crushOf.get(p) ?? 0;
}

/** Laminate state of a piece (plies intact, delaminated), or null. */
export function laminateOfPiece(p: Piece): J.Laminate | null {
  return lamOf(p);
}

/* ---------------- rebar ---------------- */

/* anch: bond/anchorage as a share of the bars' yield; bars that pull out of corroded or short anchorages hold less. */
function addRebar(a: Piece, b: Piece | null, at: Vec3, n: Vec3, area: number, d = 0.12, anch = 1): void {
  if (rebars.size >= MAX_REBAR || a.dead || b?.dead || building) return;
  const pa: Vec3 = [at[0] - n[0] * d, at[1] - n[1] * d, at[2] - n[2] * d];
  const pb: Vec3 = [at[0] + n[0] * d, at[1] + n[1] * d, at[2] + n[2] * d];
  const jd = b3.b3DefaultDistanceJointDef();
  jd.base.bodyIdA = a.body;
  jd.base.bodyIdB = b ? b.body : ground;
  const la = toLocal([0, 0, 0], a.curPos, a.curRot, pa);
  const lb: Vec3 = b ? toLocal([0, 0, 0], b.curPos, b.curRot, pb) : [pb[0] - GROUND_POS[0], pb[1] - GROUND_POS[1], pb[2] - GROUND_POS[2]];
  jd.base.localFrameA = { position: la, quaternion: [0, 0, 0, 1] };
  jd.base.localFrameB = { position: lb, quaternion: [0, 0, 0, 1] };
  const rest = 2 * d;
  /* The bars are an elastic spring that yields at their capacity (force-capped, then stretches
     plastically) and snap at their elongation limit, checked in checkTies: B500B's ~5–8% over a
     debonded length of a few hundred mm plus pull-out slip is 0.1–0.3 m of opening. No rigid length limit: at
     its limit a tie between a light member and a heavy slab is a stiff lever the solver blows up on. */
  const cap = Math.max(rebarTie(a.pm.rebar || !b ? a.pm : b.pm) * area * anch, 6000);
  jd.length = rest;
  jd.enableSpring = true;
  jd.hertz = 6;
  jd.dampingRatio = 0.9;
  jd.lowerSpringForce = -0.2 * cap;
  jd.upperSpringForce = cap;
  jd.enableLimit = false;
  jd.base.forceThreshold = 3e38;
  jd.base.collideConnected = true;
  const joint = b3.b3CreateDistanceJoint(world, jd);
  const side = dirLocal([0, 0, 0], a.curRot, vec3.perpendicular([0, 0, 0], n));
  const r: Rebar = { joint, a, b, la, lb, side, rest, max: rest + 0.12 + chance() * 0.18, vis: [rebarGfx.add(), rebarGfx.add()],
    lastOver: -9, overSteps: 0, alive: true };
  rebars.set(joint.index1, r);
  analysisTouch(a); analysisTouch(b); supportDirty = true;
  a.rebars.push(r);
  b?.rebars.push(r);
  counters.rebars++;
}

/* Bars stretched past their elongation limit snap; crack faces driven together until the anchors
   nearly meet buckle them (and would leave the tie's axis undefined). */
const TIE_CRUSHED = 0.1;
function checkTies(): void {
  for (const r of rebars.values()) {
    if (r.a.movedStep !== stepCount && (!r.b || r.b.movedStep !== stepCount)) continue;
    toWorld(_v, r.a.curPos, r.a.curRot, r.la);
    if (r.b) toWorld(_w, r.b.curPos, r.b.curRot, r.lb);
    else vec3.add(_w, r.lb, GROUND_POS);
    const l2 = vec3.squaredDistance(_v, _w);
    if (l2 > r.max * r.max) killRebar(r, true, true);
    else if (l2 < TIE_CRUSHED * TIE_CRUSHED) killRebar(r, true, false);
  }
}

function killRebar(r: Rebar, destroyJoint: boolean, snapped: boolean): void {
  if (!r.alive) return;
  r.alive = false;
  if (rebars.get(r.joint.index1) === r) rebars.delete(r.joint.index1);
  analysisTouch(r.a); analysisTouch(r.b); supportDirty = true;
  for (const id of r.vis) if (id >= 0) rebarGfx.remove(id);
  const ia = r.a.rebars.indexOf(r);
  if (ia >= 0) r.a.rebars.splice(ia, 1);
  if (r.b) {
    const ib = r.b.rebars.indexOf(r);
    if (ib >= 0) r.b.rebars.splice(ib, 1);
  }
  if (destroyJoint && b3.b3Joint_IsValid(r.joint)) b3.b3DestroyJoint(r.joint, true);
  if (snapped) {
    toWorld(_v, r.a.curPos, r.a.curRot, r.la);
    audio.rebarTwang(_v, 0.8);
    fx.sparks(_v, [0, 1, 0], 6);
  }
}

const _ra: Vec3 = [0, 0, 0], _rb: Vec3 = [0, 0, 0], _rs: Vec3 = [0, 0, 0], _ia: Vec3 = [0, 0, 0], _ib: Vec3 = [0, 0, 0];
const _qi = new THREE.Quaternion(), _qj = new THREE.Quaternion();
let strainT = 0;

function interp(p: Piece, alpha: number, pos: Vec3, rot: Quat): void {
  if (p.movedStep === stepCount) {
    vec3.lerp(pos, p.prevPos, p.curPos, alpha);
    _qi.fromArray(p.prevRot); _qj.fromArray(p.curRot); _qi.slerp(_qj, alpha);
    rot[0] = _qi.x; rot[1] = _qi.y; rot[2] = _qi.z; rot[3] = _qi.w;
  } else {
    copy3(pos, p.curPos); copy4(rot, p.curRot);
  }
}

const _rqa: Quat = [0, 0, 0, 1], _rqb: Quat = [0, 0, 0, 1], _rpa: Vec3 = [0, 0, 0], _rpb: Vec3 = [0, 0, 0];
function syncRebar(alpha: number): void {
  if (!rebars.size) return;
  for (const r of rebars.values()) {
    interp(r.a, alpha, _rpa, _rqa);
    toWorld(_ra, _rpa, _rqa, r.la);
    if (r.b) { interp(r.b, alpha, _rpb, _rqb); toWorld(_rb, _rpb, _rqb, r.lb); }
    else vec3.add(_rb, GROUND_POS, r.lb);
    vec3.transformQuat(_rs, r.side, _rqa);
    for (let k = 0; k < 2; k++) {
      const o = (k === 0 ? -0.07 : 0.07);
      vec3.scaleAndAdd(_ia, _ra, _rs, o);
      vec3.scaleAndAdd(_ib, _rb, _rs, o);
      rebarGfx.set(r.vis[k], _ia, _ib);
    }
    if (strainT <= 0 && vec3.distance(_ra, _rb) > r.rest + 0.3) { strainT = 0.6; audio.rebarStrain(_ra, 0.5); }
  }
}

/* ---------------- destruction ---------------- */

function destroyPiece(p: Piece): void {
  if (p.dead) return;
  watchAbove(p);
  p.dead = true;
  for (const w of p.welds.slice()) killWeld(w, false);
  for (const r of p.rebars.slice()) killRebar(r, false, false);
  for (const r of p.ropes.slice()) killRope(r, true);
  if (p.mechs) for (const m of p.mechs.slice()) killMech(m, true);
  if (p.svc) svcRemove(p, !building);
  burning.delete(p);
  hot.delete(p);
  unregister(p);
  if (b3.b3Body_IsValid(p.body)) b3.b3DestroyBody(p.body);
  detachDetail(p);
  removePieceGfx(p.gfx);
  live.delete(p);
  if (p.debris) debrisCount--;
}

export function damagePiece(p: Piece, point: Vec3, energy: number, blast: boolean): void {
  if (p.dead || p.fade > 0) return;
  energy = pieceDamaged(p, point, energy, blast);
  const pm = p.pm;
  if (pm.explosive) {
    if (energy > p.hp * 0.35) armFuse(p, blast ? 0.08 + chance() * 0.22 : 0.04);
    return;
  }
  if (!Number.isFinite(pm.toughness)) {
    /* Rate-sensitive metals are stronger at impact strain rates; tuned against mild steel's DIF. */
    if (energy > 25e3) strainWelds(p, point, 1.5, (energy * STEEL_DIF) / (120e3 * (pm.eng.dif ?? 1)));
    if (p.mechs) mechHarm(p, energy);
    return;
  }
  if (J.crushable(p.mat)) {
    /* foam and board crush to a plateau and stay crushed, soaking up the blow instead of breaking */
    /* soaked board has lost most of its crush strength */
    const wet = p.mat === 'cardboard' ? Math.min(1, fields.recOf(p).wet) : 0;
    const e0 = crushOf.get(p) ?? 0, c = J.crushFoam(p.mat, e0, energy, Math.min(p.volume, 0.05) * (1 - 0.7 * wet));
    if (c.e > e0 + 0.005) {
      crushOf.set(p, c.e);
      counters.crushes++;
      for (const w of p.welds.slice()) scaleWeld(w, Math.max(0.3, 1 - (c.e - e0)), false);
      refreshColor(p);
    }
    energy -= c.absorbed;
    if (energy <= 0) return;
  }
  const hp = p.hp * (1 - 0.8 * p.char);
  if (!blast && (energy < hp * 0.3 || clock - p.born < IMPACT_GRACE)) return;
  if (energy < hp * 0.05) return;
  if (hasDetail(p)) energy = Math.max(0, energy - detailDamage(p, point, energy, blast));
  p.damage += energy;
  if (p.svc?.source) svcHarm(p, false);
  if (p.mechs) mechHarm(p, energy);
  if (p.damage >= hp && !p.queued) {
    p.queued = true;
    fractureQueue.push({ p, point: [point[0], point[1], point[2]], intensity: p.damage / hp, blast });
  } else {
    refreshColor(p);
  }
}

/* A heavy hit on an unbreakable member overloads the connections near the hit: ductile ones yield
   and bend, brittle ones crack. */
function strainWelds(p: Piece, point: Vec3, radius: number, amount: number): void {
  for (const w of p.welds.slice()) {
    weldPos(w, _v);
    const d = vec3.distance(_v, point);
    if (d > radius) continue;
    const f = amount * (1 - d / radius);
    if (f >= 0.8) failWeld(w, 'kinetic', false);
    else if (f > 0.05) scaleWeld(w, 1 - f * 0.6);
  }
}

/* A brick or a stone that lands hard breaks across, into a bat and a half with rough faces and a puff of its own grit,
   instead of vanishing: brick rubble is whole bricks, bats and halves in a bed of crushed mortar and fines. */
const UNIT_MATS = new Set<MaterialId>(['brick', 'stone', 'sandstone', 'cinderblock', 'terracotta', 'adobe', 'concrete']);
function snapUnit(p: Piece, point: Vec3): boolean {
  const pos: Vec3 = [0, 0, 0], rot: Quat = [0, 0, 0, 1], lin: Vec3 = [0, 0, 0], ang: Vec3 = [0, 0, 0];
  b3.b3Body_GetTransform(pos, rot, p.body);
  b3.b3Body_GetLinearVelocity(lin, p.body);
  b3.b3Body_GetAngularVelocity(ang, p.body);
  const bmin: Vec3 = [0, 0, 0], bmax: Vec3 = [0, 0, 0];
  P.bounds(p.poly, bmin, bmax);
  const d: Vec3 = [bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]];
  const k = d[0] >= d[1] && d[0] >= d[2] ? 0 : d[1] >= d[2] ? 1 : 2;
  if (d[k] < 0.08) return false;
  // where it breaks: toward the struck end, a third to a half along (fixed per body, so a replay breaks it the same way)
  const h = Math.sin(p.id * 78.233) * 43758.5453, u = h - Math.floor(h);
  const li = toLocal([0, 0, 0], pos, rot, point);
  const fromLo = li[k] - bmin[k] < bmax[k] - li[k];
  const f = 0.33 + 0.17 * u, at = fromLo ? bmin[k] + f * d[k] : bmax[k] - f * d[k];
  const n: Vec3 = [0, 0, 0];
  n[k] = 1;
  const nt = tilted(n, 0.5);
  const c: Vec3 = [(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2];
  c[k] = at;
  const off = vec3.dot(nt, c);
  const A = P.clip(p.poly, nt, off - 0.002, -2), B = P.clip(p.poly, [-nt[0], -nt[1], -nt[2]], -(off + 0.002), -2);
  if (A.faces.length < 4 || B.faces.length < 4 || P.minWidth(A) < 0.02 || P.minWidth(B) < 0.02) return false;
  if (!p.demolished) credit(p.root, p.volume, p.curPos);
  destroyPiece(p);
  counters.fractures++;
  for (const [poly, sg] of [[A, -1], [B, 1]] as const) {
    const cc: Vec3 = [0, 0, 0];
    const vol = P.volumeCentroid(poly, cc);
    const r: Vec3 = [0, 0, 0], wc: Vec3 = [0, 0, 0];
    vec3.transformQuat(r, cc, rot);
    vec3.add(wc, pos, r);
    const v: Vec3 = [lin[0] + ang[1] * r[2] - ang[2] * r[1], lin[1] + ang[2] * r[0] - ang[0] * r[2], lin[2] + ang[0] * r[1] - ang[1] * r[0]];
    const nw: Vec3 = [0, 0, 0];
    vec3.transformQuat(nw, nt, rot);
    vec3.scaleAndAdd(v, v, nw, sg * 0.35);
    createPiece({
      mat: p.mat, tint: p.tint, poly: P.translate(poly, [-cc[0], -cc[1], -cc[2]]), cyl: null,
      pos: wc, rot: [...rot], lin: v, ang: [ang[0] + sg * 0.8, ang[1], ang[2] - sg * 0.8],
      uvOrigin: [p.uvOrigin[0] + cc[0], p.uvOrigin[1] + cc[1], p.uvOrigin[2] + cc[2]],
      depth: Math.min(MAX_DEPTH, p.depth + 1), root: p.root, demolished: true, awake: true, volume: vol,
      char: p.char, burning: p.burning, temp: p.temp, frag: true,
    });
  }
  fx.dust(point, 0.35, p.pm.dust);
  fx.debris(point, 6, p.pm.chips, 1.8);
  fx.fines(point, p.volume * 0.15, p.pm.dust, 0.35);
  return true;
}

function pulverize(p: Piece, point: Vec3): void {
  if (!p.demolished) credit(p.root, p.volume, p.curPos);
  p.demolished = true;
  destroyPiece(p);
  fx.debris(point, 10, p.pm.chips, 3);
  fx.dust(point, 0.8, p.pm.dust);
  if (UNIT_MATS.has(p.mat)) fx.fines(point, p.volume, p.pm.dust, 0.45);
}

function fracture(p: Piece, point: Vec3, intensity: number, blast: boolean): void {
  p.queued = false;
  if (p.dead) return;
  seedAt(p, point, 2);
  const pm = p.pm;
  const style = pm.style;
  if (style === 'none') return;
  if (detailFracture(p, point, intensity, blast)) return;
  if (p.parts) { splitCompound(p, point, intensity, blast); return; }
  if (p.svc) svcHarm(p, true);
  // a unit landing hard snaps into a bat and a half while there is room for the bodies (a blast's shattering reduces it)
  if (p.volume < MIN_FRACTURE_VOL && p.volume > 4e-4 && p.depth < MAX_DEPTH && UNIT_MATS.has(p.mat) && intensity < 4 && debrisCount < BUDGET * 1.1 && snapUnit(p, point)) return;
  /* past the fracture depth a chunk still big enough to be a block (a quarter of a wall lift, a slab corner) keeps
     breaking into a few pieces: only rubble-sized fragments stop at the depth limit and grind to fines */
  if (p.volume < MIN_FRACTURE_VOL || (p.depth >= MAX_DEPTH && p.volume < BLOCK_VOL) || (debrisCount > BUDGET * 0.85 && p.depth >= 1)) {
    if (p.volume < BLOCK_VOL) pulverize(p, point);
    else p.damage = p.hp * 0.5;
    return;
  }

  const pos: Vec3 = [0, 0, 0], rot: Quat = [0, 0, 0, 1], lin: Vec3 = [0, 0, 0], ang: Vec3 = [0, 0, 0];
  b3.b3Body_GetTransform(pos, rot, p.body);
  b3.b3Body_GetLinearVelocity(lin, p.body);
  b3.b3Body_GetAngularVelocity(ang, p.body);

  const bmin: Vec3 = [0, 0, 0], bmax: Vec3 = [0, 0, 0];
  P.bounds(p.poly, bmin, bmax);
  const li = toLocal([0, 0, 0], pos, rot, point);
  for (let k = 0; k < 3; k++) li[k] = clamp(li[k], bmin[k] + 0.01, bmax[k] - 0.01);

  const extent = Math.cbrt(p.volume);
  const sizeF = clamp(extent / 1.1, 0.25, 1);
  let n = Math.round(lerp(pm.cells[0], pm.cells[1], sizeF) * clamp(0.75 + 0.2 * intensity, 0.8, 1.5) * (blast ? 0.75 : 1));
  if (style !== 'dice') n = Math.min(n, Math.max(2, Math.floor(p.volume / 0.012)));
  if (p.depth > 0) n = Math.min(n, style === 'dice' ? 12 : 4);
  n = clamp(n, 2, style === 'dice' ? 40 : 14);
  const crowded = debrisCount > BUDGET * 0.6;
  if (crowded) n = Math.min(n, debrisCount > BUDGET * 0.85 ? 3 : 5);
  const clusterR = clamp(extent * (blast ? 0.5 : 0.32) * Math.sqrt(Math.min(intensity, 4)), 0.08, 1.4);

  const metric: Vec3 = [1, 1, 1];
  const dims: Vec3 = [bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]];
  const axis = dims[0] >= dims[1] && dims[0] >= dims[2] ? 0 : dims[1] >= dims[2] ? 1 : 2;
  if (pm.grain !== 1) metric[axis] = pm.grain;
  const sorted = [...dims].sort((a, b) => b - a);
  const elongated = sorted[0] > sorted[1] * 2.5;
  /* Timber snaps across the grain into jagged halves plus splinters; cast iron and stone members
     break clean in two; glass runs radial cracks from the impact; tempered glass lets go all at once. */
  const snap = (style === 'splinter' || style === 'clean') && elongated && (!blast || intensity < 1.6);
  let seeds: Vec3[];
  const course = style === 'voronoi' && !snap ? pm.course : undefined;
  if (course) {
    seeds = courseSeeds(p.poly, bmin, bmax, li, course, crowded ? n : clamp(n + 4, 6, 12), clusterR * 1.3);
    metric[1] = (1.6 * course[1]) / course[0];
  } else if (snap) seeds = snapSeeds(p.poly, bmin, bmax, li, axis, style === 'splinter' ? 2 + Math.floor(chance() * 3) : 0);
  else if (style === 'shards') seeds = shardSeeds(p.poly, bmin, bmax, li, n);
  else if (style === 'clean' || style === 'dice') seeds = P.makeSeeds(p.poly, li, n, 0, clusterR);
  else seeds = P.makeSeeds(p.poly, li, n, blast ? 0.45 : 0.6, clusterR);
  const coreSnap = clamp(sorted[1] * 0.6, 0.05, 0.3);
  const cells = seeds.length >= 2 ? P.voronoi(p.poly, seeds, metric) : [];
  if (cells.length < 2) { pulverize(p, point); return; }
  const minBody = style === 'crumble' ? 0.025 : style === 'dice' ? 0.012 : MIN_BODY_VOL;

  /* Surviving slabs inherit the parent's calibrated stress (capacity per m² of contact), so the
     wall that was carrying a roof still carries it once holed — only the core breaks free. */
  const neighbours = new Map<Piece | null, Caps & { area: number; at: Vec3 }>();
  const sMax: Caps = { comp: pm.crush, ten: pm.bond, shear: pm.cohesion, torque: pm.bond * 0.3 };
  for (const w of p.welds) {
    const o = w.a === p ? w.b : w.a;
    const ar = Math.max(w.area, 0.01);
    const s = { comp: w.base.comp / ar, ten: w.base.ten / ar, shear: w.base.shear / ar, torque: w.base.torque / ar, area: ar, at: weldPos(w, [0, 0, 0]) };
    const prev = neighbours.get(o);
    if (!prev || s.comp > prev.comp) neighbours.set(o, s);
    sMax.comp = Math.max(sMax.comp, s.comp); sMax.ten = Math.max(sMax.ten, s.ten);
    sMax.shear = Math.max(sMax.shear, s.shear); sMax.torque = Math.max(sMax.torque, s.torque);
  }
  const perArea = (s: Caps, area: number, k: number): Caps =>
    ({ comp: s.comp * area * k, ten: s.ten * area * k, shear: s.shear * area * k, torque: s.torque * area * k });
  const wasDemolished = p.demolished;
  counters.fractures++;
  destroyPiece(p);

  let credited = 0;
  const made: { chunk: Piece; cell: P.Cell; core: number }[] = [];
  const bySeed = new Map<number, Piece>();
  const shardGroup = style === 'shards' || style === 'dice' ? -2 - (shardGroups++ % 30000) : undefined;
  const wc: Vec3 = [0, 0, 0], r: Vec3 = [0, 0, 0], kick: Vec3 = [0, 0, 0];
  for (const cell of cells) {
    if (cell.volume < minBody) { credited += cell.volume; continue; }
    const c = cell.centroid;
    vec3.transformQuat(r, c, rot);
    vec3.add(wc, pos, r);
    const v: Vec3 = [lin[0] + ang[1] * r[2] - ang[2] * r[1], lin[1] + ang[2] * r[0] - ang[0] * r[2], lin[2] + ang[0] * r[1] - ang[1] * r[0]];
    const core = vec3.distance(c, li);
    if (!blast) {
      vec3.sub(kick, c, li);
      const l = vec3.length(kick) || 1;
      const s = clamp(intensity, 0, 3) * 1.4 * Math.max(0, 1 - core / (clusterR * 2.5)) / l;
      vec3.scaleAndAdd(v, v, kick, s);
    }
    const rubble = cell.volume < RUBBLE_VOL;
    const chunk = createPiece({
      mat: p.mat, tint: p.tint, poly: P.translate(cell.poly, [-c[0], -c[1], -c[2]]),
      cyl: p.cyl ? { r: p.cyl.r, ax: p.cyl.ax - c[0], az: p.cyl.az - c[2] } : null,
      pos: [wc[0], wc[1], wc[2]], rot: [...rot], lin: v, ang: [...ang],
      uvOrigin: [p.uvOrigin[0] + c[0], p.uvOrigin[1] + c[1], p.uvOrigin[2] + c[2]],
      depth: p.depth + 1, root: p.root, demolished: wasDemolished || rubble, awake: true, volume: cell.volume,
      char: p.char, burning: p.burning, temp: p.temp, frag: true, group: shardGroup,
    });
    if (!chunk) { credited += cell.volume; continue; }
    if (rubble) credited += cell.volume;
    made.push({ chunk, cell, core });
    bySeed.set(cell.seed, chunk);
  }

  const coreR = snap ? coreSnap : clusterR * (blast ? 1.7 : 1.15);
  const keep = style === 'dice' || style === 'crumble' && blast ? [] : made.filter(m => m.chunk.volume >= 0.03 && m.core > coreR);
  const keepSet = new Set(keep.map(m => m.chunk));
  const mid: Vec3 = [0, 0, 0], nrm: Vec3 = [0, 0, 0];
  let tied = 0;
  for (const m of made) {
    const kept = keepSet.has(m.chunk);
    if (!snap || pm.rebar) for (const [seed, area] of m.cell.shared) {
      const other = bySeed.get(seed);
      if (!other || other.id < m.chunk.id || area < 0.01) continue;
      vec3.lerp(mid, m.chunk.curPos, other.curPos, 0.5);
      vec3.sub(nrm, other.curPos, m.chunk.curPos);
      vec3.normalize(nrm, nrm);
      if (kept && keepSet.has(other) && !snap) {
        createWeld(m.chunk, other, mid, nrm, area, perArea(sMax, area, 1));
      } else if (pm.rebar && tied < 10 && chance() < 0.6) {
        addRebar(m.chunk, other, mid, nrm, area);
        tied++;
      }
    }
    b3.b3Body_ComputeAABB(_aabb, m.chunk.body);
    for (const [o, s] of neighbours) {
      if (o && (o.dead || !live.has(o))) continue;
      if (!o) {
        if (_aabb[1] > 0.06) continue;
        const area = Math.max(0.01, (_aabb[3] - _aabb[0]) * (_aabb[5] - _aabb[2]) * 0.5);
        const at: Vec3 = [(_aabb[0] + _aabb[3]) / 2, Math.max(0, _aabb[1]), (_aabb[2] + _aabb[5]) / 2];
        if (kept) createWeld(m.chunk, null, at, DOWN, area, perArea(s, area, 1));
        else if (pm.rebar && tied < 10) { addRebar(m.chunk, null, at, DOWN, area); tied++; }
        continue;
      }
      const c = pieceTouch(m.chunk, o, 0.05, 0.04);
      if (!c) continue;
      if (kept) createWeld(m.chunk, o, c.c, c.n, c.area, perArea(s, c.area, 1));
      else if (pm.rebar && tied < 10 && chance() < 0.5) { addRebar(m.chunk, o, c.c, c.n, c.area); tied++; }
    }
  }

  if (!wasDemolished) credit(p.root, credited, point);

  /* A hard hit on brittle material doesn't stop at the panel edge: the excess runs on as a crack
     into whatever it was bonded to. */
  if (!blast && intensity > 1.3 && (style === 'voronoi' || style === 'clean' || style === 'crumble')) {
    for (const [o, s] of neighbours) {
      if (!o || o.dead || o.queued || o.pm.style === 'none' || o.pm.style === 'splinter' || chance() > 0.6) continue;
      const e = (intensity - 1) * o.hp * 0.45;
      o.born = Math.min(o.born, clock - IMPACT_GRACE);
      damagePiece(o, s.at, e, false);
    }
  }

  const size = clamp(extent * 1.4, 0.5, 4.5);
  switch (style) {
    case 'shards': fx.shards(point, 40); break;
    case 'dice': fx.dice(point, 90); break;
    case 'crumble': fx.powder(point, size * 1.3, pm.dust); break;
    case 'splinter': fx.splinters(point, snap ? 24 : 14, p.char > 0.3 ? 0x2a1f16 : pm.chips); break;
    default: break;
  }
  if (style !== 'dice' && style !== 'shards') fx.dust(point, style === 'crumble' ? size * 1.4 : size, pm.dust);
  fx.debris(point, Math.round(8 + size * 10), pm.chips, blast ? 7 : 4);
  if (p.mat === 'castiron') fx.sparks(point, [0, 1, 0], 12);
  audio.fracture(point, p.mat, clamp(p.volume, 0.05, 2));
}

/* Masonry lets go along its mortar: units near the hit come out whole along their courses (running
   bond), the rest of the panel breaks into a few larger pieces along bed joints. */
function courseSeeds(poly: P.Poly, bmin: Vec3, bmax: Vec3, li: Vec3, course: [number, number], units: number, radius: number): Vec3[] {
  const dims: Vec3 = [bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]];
  const ax = dims[0] >= dims[2] ? 0 : 2, th = 2 - ax;
  const rows = Math.max(1, Math.round(dims[1] / course[0])), h = dims[1] / rows, l = course[1];
  const ry = Math.max(radius, h * 1.2), rx = Math.max(radius * 1.4, l * 1.2);
  const near: { q: Vec3; d: number }[] = [];
  for (let i = 0; i < rows; i++) {
    const y = bmin[1] + (i + 0.5) * h;
    const dy = (y - li[1]) / ry;
    if (Math.abs(dy) > 1) continue;
    for (let x = bmin[ax] + ((i % 2) - 0.5) * l * 0.5 + l * 0.5; x < bmax[ax]; x += l) {
      const dx = (x - li[ax]) / rx;
      if (dx * dx + dy * dy > 1) continue;
      const q: Vec3 = [0, 0, 0];
      q[1] = y;
      q[ax] = clamp(x + (chance() - 0.5) * l * 0.1, bmin[ax] + 0.02, bmax[ax] - 0.02);
      q[th] = (bmin[th] + bmax[th]) / 2;
      if (P.contains(poly, q, 0.002)) near.push({ q, d: dx * dx + dy * dy });
    }
  }
  near.sort((a, b) => a.d - b.d);
  const seeds = near.slice(0, units).map(u => u.q);
  for (let t = 0, far = 0; t < 40 && far < 3; t++) {
    const q: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) q[k] = bmin[k] + chance() * dims[k];
    q[th] = (bmin[th] + bmax[th]) / 2;
    const dx = (q[ax] - li[ax]) / rx, dy = (q[1] - li[1]) / ry;
    if (dx * dx + dy * dy < 2.2 || !P.contains(poly, q, 0.005)) continue;
    seeds.push(q);
    far++;
  }
  return seeds;
}

function snapSeeds(poly: P.Poly, bmin: Vec3, bmax: Vec3, li: Vec3, axis: number, splinters: number): Vec3[] {
  const len = bmax[axis] - bmin[axis];
  const x0 = clamp(li[axis], bmin[axis] + len * 0.12, bmax[axis] - len * 0.12);
  const a = Math.min(x0 - bmin[axis], bmax[axis] - x0) * 0.85;
  const seeds: Vec3[] = [];
  for (const side of [-1, 1]) {
    const q: Vec3 = [(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2];
    q[axis] = x0 + side * a;
    for (let k = 0; k < 3; k++) if (k !== axis) q[k] += (chance() - 0.5) * (bmax[k] - bmin[k]) * (splinters ? 0.6 : 0.25);
    seeds.push(q);
  }
  for (let i = 0; i < splinters; i++) {
    const q: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) q[k] = bmin[k] + chance() * (bmax[k] - bmin[k]);
    q[axis] = x0 + (chance() - 0.5) * Math.min(0.5, len * 0.15);
    if (P.contains(poly, q, 0.005)) seeds.push(q);
  }
  return seeds;
}

/* Radial crack pattern: seeds strung along rays from the impact give long wedge-shaped shards. */
function shardSeeds(poly: P.Poly, bmin: Vec3, bmax: Vec3, li: Vec3, n: number): Vec3[] {
  const dims = [bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]];
  const thin = dims[0] <= dims[1] && dims[0] <= dims[2] ? 0 : dims[1] <= dims[2] ? 1 : 2;
  const u = (thin + 1) % 3, v = (thin + 2) % 3;
  const reach = Math.max(dims[u], dims[v]);
  const rays = clamp(Math.round(n * 0.6), 5, 9);
  const seeds: Vec3[] = [[li[0], li[1], li[2]]];
  const off = chance() * Math.PI * 2;
  for (let r = 0; r < rays; r++) {
    const a = off + (r / rays) * Math.PI * 2 + (chance() - 0.5) * 0.4;
    for (const d of [0.22, 0.8]) {
      const q: Vec3 = [li[0], li[1], li[2]];
      q[u] += Math.cos(a) * reach * d * (0.8 + chance() * 0.4);
      q[v] += Math.sin(a) * reach * d * (0.8 + chance() * 0.4);
      q[thin] = (bmin[thin] + bmax[thin]) / 2;
      if (P.contains(poly, q, 0.002)) seeds.push(q);
    }
  }
  return seeds;
}

/* ---------------- member cracking ---------------- */

interface CrackJob { p: Piece; at: Vec3; into: Vec3; w: Weld }
const crackQueue: CrackJob[] = [];
const cracking = new Set<Weld>();
const _ext: [number, number] = [0, 0];

function crackable(q: Piece | null): q is Piece {
  if (!q || q.dead || q.queued || q.fade > 0 || q.hinged || q.root.spec.mech || q.pm.explosive) return false;
  const st = q.pm.style;
  return (st === 'voronoi' || st === 'clean' || st === 'crumble') && q.volume >= CRACK_MIN_VOL && q.depth < MAX_DEPTH;
}

function extentAlong(poly: P.Poly, n: Vec3, out: [number, number]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const f of poly.faces) {
    const p = f.pts;
    for (let i = 0; i < p.length; i += 3) {
      const d = n[0] * p[i] + n[1] * p[i + 1] + n[2] * p[i + 2];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  }
  out[0] = lo; out[1] = hi;
  return out;
}

/* Length of member `q` running away from joint point `at` along world direction `into`. */
function runLength(q: Piece, at: Vec3, into: Vec3): number {
  const nl = dirLocal([0, 0, 0], q.curRot, into);
  const ai = toLocal([0, 0, 0], q.curPos, q.curRot, at);
  extentAlong(q.poly, nl, _ext);
  return _ext[1] - vec3.dot(nl, ai);
}

/* A connection that gives way under bending or shock rarely fails exactly at the construction
   joint: the member cracks a short way in, leaving a stub on its neighbour and shedding the
   crushed band between the crack faces as rubble. */
function tryCrack(w: Weld): boolean {
  if (crackQueue.length >= 6 || debrisCount > BUDGET * 0.7 || chance() > CRACK_CHANCE) return false;
  const nrm = weldNormal(w, [0, 0, 0]);
  const at = weldPos(w, [0, 0, 0]);
  let best: Piece | null = null, bestL = 0;
  const into: Vec3 = [0, 0, 0];
  for (const q of [w.a, w.b]) {
    if (!crackable(q)) continue;
    const dir: Vec3 = q === w.a ? [-nrm[0], -nrm[1], -nrm[2]] : [nrm[0], nrm[1], nrm[2]];
    /* Masonry cracks run along bed joints; head-joint failures step through the mortar instead. */
    if (q.pm.course && Math.abs(dirLocal(_n, q.curRot, dir)[1]) < 0.7) continue;
    const L = runLength(q, at, dir);
    if (L > bestL) { bestL = L; best = q; copy3(into, dir); }
  }
  if (!best || bestL < 0.7) return false;
  best.queued = true;
  cracking.add(w);
  crackQueue.push({ p: best, at, into, w });
  return true;
}

function processCracks(): void {
  for (let n = 0; n < CRACK_PER_STEP && crackQueue.length; n++) {
    const job = crackQueue.shift()!;
    cracking.delete(job.w);
    job.p.queued = false;
    if (job.p.dead || !job.w.alive) continue;
    if (!crackMember(job.p, job.at, job.into)) failWeld(job.w, 'kinetic', false);
  }
}

function tilted(n: Vec3, amount: number): Vec3 {
  const t: Vec3 = [n[0] + (chance() - 0.5) * amount, n[1] + (chance() - 0.5) * amount, n[2] + (chance() - 0.5) * amount];
  return vec3.normalize(t, t);
}

function snapAxis(n: Vec3): Vec3 {
  const k = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
  const o: Vec3 = [0, 0, 0];
  o[k] = Math.sign(n[k]) || 1;
  return o;
}

type Neighbour = Caps & { area: number };

function neighbourCaps(p: Piece): Map<Piece | null, Neighbour> {
  const out = new Map<Piece | null, Neighbour>();
  for (const w of p.welds) {
    const o = w.a === p ? w.b : w.a;
    const ar = Math.max(w.area, 0.01);
    const s = { comp: w.base.comp / ar, ten: w.base.ten / ar, shear: w.base.shear / ar, torque: w.base.torque / ar, area: ar };
    const prev = out.get(o);
    if (!prev || s.comp > prev.comp) out.set(o, s);
  }
  return out;
}

/* Re-attach a piece carved from a welded member to whichever of the member's neighbours it still touches. */
function reweld(chunk: Piece, neighbours: Map<Piece | null, Neighbour>): void {
  b3.b3Body_ComputeAABB(_aabb, chunk.body);
  for (const [o, s] of neighbours) {
    if (o && (o.dead || !live.has(o))) continue;
    if (!o) {
      if (_aabb[1] > 0.06) continue;
      const { c, area } = footprint(chunk, _aabb, 0.5);
      createWeld(chunk, null, c, DOWN, area, { comp: s.comp * area, ten: s.ten * area, shear: s.shear * area, torque: s.torque * area });
      continue;
    }
    const ct = pieceTouch(chunk, o, 0.05, 0.04);
    if (!ct) continue;
    createWeld(chunk, o, ct.c, ct.n, ct.area,
      { comp: s.comp * ct.area, ten: s.ten * ct.area, shear: s.shear * ct.area, torque: s.torque * ct.area });
  }
}

function crackMember(p: Piece, at: Vec3, into: Vec3): boolean {
  seedAt(p, at, 3);
  if (hasDetail(p)) return detailCrack(p, at, into);
  if (p.parts) return crackCompound(p, at, into);
  const pm = p.pm;
  const pos: Vec3 = [0, 0, 0], rot: Quat = [0, 0, 0, 1], lin: Vec3 = [0, 0, 0], ang: Vec3 = [0, 0, 0];
  b3.b3Body_GetTransform(pos, rot, p.body);
  b3.b3Body_GetLinearVelocity(lin, p.body);
  b3.b3Body_GetAngularVelocity(ang, p.body);
  const course = pm.course;
  let nl = vec3.normalize([0, 0, 0], dirLocal([0, 0, 0], rot, into));
  if (course) nl = snapAxis(nl);
  const ai = toLocal([0, 0, 0], pos, rot, at);
  extentAlong(p.poly, nl, _ext);
  const s0 = clamp(vec3.dot(nl, ai), _ext[0], _ext[1]), L = _ext[1] - s0;
  const bmin: Vec3 = [0, 0, 0], bmax: Vec3 = [0, 0, 0];
  P.bounds(p.poly, bmin, bmax);
  const dims = [bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]].sort((a, b) => a - b);
  const width = dims[1];
  let lateral = 0;
  for (let k = 0; k < 3; k++) lateral = Math.max(lateral, (bmax[k] - bmin[k]) * (1 - Math.abs(nl[k])));
  const half = course ? course[0] / 2 : clamp(width * 0.18, 0.06, 0.2);
  /* Faces tilted apart by more than the band is thick would cross inside the member. */
  const tilt = course ? 0 : Math.min(0.45, (1.2 * half) / Math.max(lateral, 0.1));
  const reach = half + lateral * 0.5 * tilt + 0.1;
  if (L < reach * 2 + 0.15) return false;
  let off = clamp(L * (0.1 + 0.3 * chance()), reach, L - reach);
  if (course) off = clamp(Math.round(off / course[0]) * course[0], reach, L - reach);
  /* Two independently tilted crack faces bound a crushed band: the stub keeps the joint, the rest
     of the member goes, and the band between them breaks into rubble (units, for masonry). */
  const n0 = tilt ? tilted(nl, tilt) : nl, n1 = tilt ? tilted(nl, tilt) : nl;
  const cp: Vec3 = [ai[0] + nl[0] * off, ai[1] + nl[1] * off, ai[2] + nl[2] * off];
  const stub = P.clip(p.poly, n0, vec3.dot(n0, cp) - half, -2);
  const far = P.clip(p.poly, [-n1[0], -n1[1], -n1[2]], -(vec3.dot(n1, cp) + half), -2);
  if (stub === p.poly || far === p.poly) return false;
  const band = P.clip(P.clip(p.poly, [-n0[0], -n0[1], -n0[2]], -(vec3.dot(n0, cp) - half), -2), n1, vec3.dot(n1, cp) + half, -2);
  const cs: Vec3 = [0, 0, 0], cf: Vec3 = [0, 0, 0], cb: Vec3 = [0, 0, 0];
  const vs = P.volumeCentroid(stub, cs), vf = P.volumeCentroid(far, cf);
  const vb = band.faces.length >= 4 ? P.volumeCentroid(band, cb) : 0;
  if (vs < 0.02 || vf < 0.02 || P.minWidth(stub) < 0.05 || P.minWidth(far) < 0.05) return false;

  const neighbours = neighbourCaps(p);
  const wasDemolished = p.demolished, hp = p.hp, damage = p.damage;
  if (p.svc) svcHarm(p, true);
  counters.cracks++;
  destroyPiece(p);

  const r: Vec3 = [0, 0, 0];
  const spawn = (poly: P.Poly, c: Vec3, vol: number, depth: number, demolished: boolean): Piece | null => {
    vec3.transformQuat(r, c, rot);
    return createPiece({
      mat: p.mat, tint: p.tint, poly: P.translate(poly, [-c[0], -c[1], -c[2]]),
      cyl: p.cyl ? { r: p.cyl.r, ax: p.cyl.ax - c[0], az: p.cyl.az - c[2] } : null,
      pos: [pos[0] + r[0], pos[1] + r[1], pos[2] + r[2]], rot: [...rot],
      lin: [lin[0] + ang[1] * r[2] - ang[2] * r[1], lin[1] + ang[2] * r[0] - ang[0] * r[2], lin[2] + ang[0] * r[1] - ang[1] * r[0]],
      ang: [...ang], uvOrigin: [p.uvOrigin[0] + c[0], p.uvOrigin[1] + c[1], p.uvOrigin[2] + c[2]],
      depth, root: p.root, demolished, awake: true, volume: vol,
      char: p.char, burning: p.burning, temp: p.temp, frag: true,
    });
  };
  const halves: Piece[] = [];
  for (const [poly, c, vol] of [[stub, cs, vs], [far, cf, vf]] as const) {
    const chunk = spawn(poly, c, vol, p.depth, wasDemolished);
    if (!chunk) continue;
    chunk.hp = hp;
    chunk.damage = damage * 0.5;
    chunk.born = clock - IMPACT_GRACE;
    reweld(chunk, neighbours);
    halves.push(chunk);
  }

  let credited = 0;
  const bits: Piece[] = [];
  if (vb > MIN_BODY_VOL) {
    const u = [0, 1, 2].filter(k => Math.abs(nl[k]) < 0.7).sort((a, b) => (bmax[b] - bmin[b]) - (bmax[a] - bmin[a]));
    const ua = u[0] ?? 0;
    const unit = course ? course[1] : clamp(width * 0.5, 0.2, 0.45);
    const k = clamp(Math.round((bmax[ua] - bmin[ua]) / unit), 1, 6);
    const seeds: Vec3[] = [];
    for (let i = 0; i < k; i++) {
      const q: Vec3 = [cb[0], cb[1], cb[2]];
      q[ua] = bmin[ua] + (bmax[ua] - bmin[ua]) * ((i + 0.5 + (chance() - 0.5) * (course ? 0.15 : 0.6)) / k);
      const side = (i % 2 ? 1 : -1) * half * (course ? 0.05 : 0.4);
      q[0] += nl[0] * side; q[1] += nl[1] * side; q[2] += nl[2] * side;
      if (P.contains(band, q, 0.002)) seeds.push(q);
    }
    const cells = seeds.length >= 2 ? P.voronoi(band, seeds, [1, 1, 1])
      : [{ poly: band, volume: vb, centroid: cb, seed: 0, shared: new Map<number, number>() }];
    for (const cell of cells) {
      if (cell.volume < MIN_BODY_VOL) { credited += cell.volume; continue; }
      const bit = spawn(cell.poly, cell.centroid, cell.volume, p.depth + 1, wasDemolished || cell.volume < RUBBLE_VOL);
      if (!bit) { credited += cell.volume; continue; }
      if (cell.volume < RUBBLE_VOL) credited += cell.volume;
      bits.push(bit);
    }
  } else credited += vb;
  if (!wasDemolished) credit(p.root, credited, at);

  const mid = toWorld([0, 0, 0], pos, rot, cp);
  const nw = vec3.transformQuat([0, 0, 0], nl, rot);
  if (pm.rebar && halves.length === 2) {
    const area = Math.max(0.02, width * dims[0]);
    addRebar(halves[0], halves[1], mid, nw, area, half + 0.06);
    for (const bit of bits.slice(0, 2)) addRebar(bit, halves[chance() < 0.5 ? 0 : 1], bit.curPos, nw, area * 0.3, 0.08);
  }
  const size = clamp(Math.cbrt(Math.max(vb, 0.02)) * 2.2, 0.5, 2.5);
  fx.dust(mid, size, pm.dust);
  fx.debris(mid, Math.round(6 + size * 8), pm.chips, 3);
  audio.fracture(mid, p.mat, clamp(p.volume * 0.4, 0.05, 1.2));
  return true;
}

function processFractures(max: number): void {
  let n = 0;
  /* the hardest-hit first, then by place: which pieces break this step and which wait must not follow the order the
     blows happened to be handled in */
  if (fractureQueue.length > max) fractureQueue.sort((a, b) => b.intensity - a.intensity || pieceKey(a.p) - pieceKey(b.p));
  while (fractureQueue.length && n < max) {
    const f = fractureQueue.shift()!;
    fracture(f.p, f.point, f.intensity, f.blast);
    n++;
  }
}

function pieceKey(p: Piece): number {
  const s = p.spawnPos;
  return (Math.round(s[1] * 1000) * 2e5 + Math.round(s[0] * 1000)) * 2e5 + Math.round(s[2] * 1000);
}

/* ---------------- explosives ---------------- */

function armFuse(p: Piece, delay: number): void {
  if (p.fuse >= 0 || p.dead) return;
  p.fuse = delay;
  fusing.push(p);
}

function detonateProp(p: Piece): void {
  if (p.dead) return;
  const ex = p.pm.explosive!;
  const pos: Vec3 = [...p.curPos];
  b3.b3Body_GetPosition(pos, p.body);
  if (!p.demolished) credit(p.root, p.volume, pos);
  p.demolished = true;
  destroyPiece(p);
  scoring.score.explosives++;
  counters.props++;
  if (scoring.score.explosives > 1) scoring.addBonus(150 * Math.min(scoring.score.explosives, 10), 'CHAIN REACTION');
  explode(pos, ex.radius, ex.power, ex.impulse, 1);
  fx.fire(pos, 6 + chance() * 4, ex.radius * 0.22);
}

/** gasPower: what a room it goes off in is pressurised by, when not the same as the shock's power (a fuel-air charge's
 * whole energy; 0 for a blast whose room pressure is dealt elsewhere: the breach half of a contact charge, a gas
 * deflagration). cloud: a fuel-air cloud, which holes nothing round itself. face: the outward normal of the face a planted
 * charge sits on. */
export function explode(pos: Vec3, radius: number, power: number, impulse: number, weldReach = 1, maxFractures = BLAST_FRACTURES, gasPower = power, cloud = false, face: Vec3 | null = null): void {
  counters.explosions++;
  chance.at(pos[0], pos[1], pos[2], stepCount, 4);
  fx.explosion(pos, radius);
  if (pos[1] < 1.6) fx.scorch([pos[0], 0.01, pos[2]], radius * 0.5);
  audio.explosion(pos, radius / 3);
  onExplosion(pos, radius);
  /* the wave lands on the next steps' solve */
  noteShock(pos, power, radius * 2, 3);
  softExplosion(pos, radius, power, impulse);
  crater(pos, power / 60e3);

  /* The wave, not just the distance: in plain view in the open a piece takes the calibrated fall-off below; a wall
     between shadows it (the wave diffracts round, weaker); inside a room the gas pressure and the reflections load
     every surface that bounds it, however far from the charge. */
  const bl = fields.survey(pos, radius, power, gasPower, cloud, stepCount / 60, face);
  /* the room's walls the gas blows out vent the rest of its blow-down: what its floors, columns and joints take */
  if (bl.confined) { const b = blownOut(bl, pos); fields.vent(bl, b.A, b.t); }
  const lo: Vec3 = [pos[0] - radius, pos[1] - radius, pos[2] - radius], hi: Vec3 = [pos[0] + radius, pos[1] + radius, pos[2] + radius];
  if (bl.confined) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], bl.roomMin[k] - 1); hi[k] = Math.max(hi[k], bl.roomMax[k] + 1); }
  const near = new Map<Piece, { p: Piece; d: number; cp: Vec3 }>();
  overlapAABB(lo, hi, CAT.structure | CAT.debris | CAT.prop, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const p = e as Piece;
    if (p.dead) return;
    const prev = near.get(p);
    if (prev && !p.parts) return;
    const cp: Vec3 = [0, 0, 0];
    b3.b3Shape_GetClosestPoint(cp, shape, pos);
    const d = vec3.distance(cp, pos);
    if ((d < radius || fields.inRoom(bl, cp)) && (!prev || d < prev.d)) near.set(p, { p, d, cp });
  });
  const hits = [...near.values()].sort((a, b) => a.d - b.d || pieceKey(a.p) - pieceKey(b.p));
  let broke = 0;
  for (let i = 0; i < hits.length && i < Math.max(48, maxFractures * 3); i++) {
    const h = hits[i];
    const f = Math.max(0, 1 - h.d / radius);
    const lf = fields.loadFactors(bl, h.cp, h.d);
    // the ground over a buried member takes most of the blow, and all of the fireball
    const sh = blastShield(h.cp, power / 60e3);
    let e = power * (f * f * lf.shadow) / h.p.pm.blastResist * sh;
    if (broke >= maxFractures && !h.p.pm.explosive) e = Math.min(e, Math.max(0, h.p.hp - h.p.damage) * 0.9);
    /* a blast held to no fresh breaking holds its shock to that, not its room's gas; a masonry panel's gas load is the
       SDOF verdict's (blastPanels), which throws it out whole rather than shattering it where it stands */
    if (lf.gas > 0 && !panelGeom(h.p)) e += gasPower * lf.gas / h.p.pm.blastResist * sh;
    const was = h.p.queued;
    damagePiece(h.p, h.cp, e, true);
    if (h.p.queued && !was) broke++;
    if (sh < 0.5) continue;
    /* a high-explosive fireball lasts milliseconds: it scorches and chars what it touches, but only what sits in it,
       thin or finely divided, keeps burning (a gas explosion or a firebomb is another matter) */
    heat(h.p, 300 * f * f * lf.shadow);
    if (h.p.pm.thermal.ignite !== undefined && f * lf.shadow > 0.6 && chance() < 0.25) ignite(h.p);
  }
  /* glass well beyond the fireball: it goes at a few kPa */
  const glassR = fields.glassRange(bl.W);
  for (const p of live) {
    if (p.dead || p.queued || !fields.isFragile(p)) continue;
    const d = vec3.distance(p.curPos, pos);
    if (d < glassR && fields.glassBreaks(bl, p)) damagePiece(p, p.curPos, p.hp * 1.5, true);
  }
  processFractures(Math.max(10, maxFractures));
  blastPanels(bl, pos);

  const reach = radius * weldReach;
  /* Ductile compounds never fracture: a blast that would rupture the weld between two separate plates tears the
     nearest plate off the member instead. */
  let torn = 0;
  for (const h of hits) {
    if (torn >= maxFractures) break;
    if (h.p.dead || !h.p.parts || Number.isFinite(h.p.pm.toughness)) continue;
    const hit = (1 - h.d / reach) * Math.sqrt(power / 60e3);
    if (hit > 1.1) { splitCompound(h.p, h.cp, hit, true); torn++; }
  }
  const wp: Vec3 = [0, 0, 0];
  const kW = Math.sqrt(power / 60e3), kWg = Math.sqrt(gasPower / 60e3);
  for (const w of [...welds.values()]) {
    weldPos(w, wp);
    const d = vec3.distance(wp, pos);
    const inside = bl.confined && fields.inRoom(bl, wp);
    if (d > reach && !inside) continue;
    const lf = fields.loadFactors(bl, wp, d);
    /* a joint fails on the room's whole gas, not only what this charge added to it; what it is weakened by is what
       this charge added (the earlier ones have weakened it already) */
    const shock = Math.max(0, 1 - d / reach) * kW * Math.sqrt(lf.shadow), sh = blastShield(w.b ? wp : w.a.curPos, power / 60e3);
    const hit = (shock + Math.sqrt(lf.gasAll) * 0.9 * kWg) * sh;
    if (hit > 0.75) failWeld(w, w.ductile && hit < 1.1 ? 'overload' : 'blast');
    else {
      const rise = lf.gasAll === lf.gas ? hit : (shock + Math.sqrt(lf.gas) * 0.9 * kWg) * sh;
      if (rise > 0.1) scaleWeld(w, 1 - rise * 0.35);
    }
  }
  if (bl.confined) gasPush(bl, pos, hits);
  fields.fieldsBlast(pos, radius, power, bl);
  explodeImpulse(pos, radius, impulse, CAT.player | CAT.projectile);
  pushFree(pos, radius, impulse);
  lateBlasts.push({ pos: [pos[0], pos[1], pos[2]], radius, impulse, step: stepCount });
}

/* The wave is past in milliseconds, but much of what it broke only comes free over the next steps (queued fractures,
   units knocked out of a member, panels breaking up in flight). Each such body still gets the push the wave gives a
   free body where it is - at least that speed away from the charge - instead of dropping in place at the speed of the
   member it came out of and propping up whatever stood on it. */
const LATE_STEPS = 12;
const lateBlasts: { pos: Vec3; radius: number; impulse: number; step: number }[] = [];
const latePending: Piece[] = [];
const _lc: Vec3 = [0, 0, 0], _ld: Vec3 = [0, 0, 0], _lv: Vec3 = [0, 0, 0];
function lateBlastPush(): void {
  while (lateBlasts.length && stepCount - lateBlasts[0].step > LATE_STEPS) lateBlasts.shift();
  if (!latePending.length) return;
  const list = latePending.splice(0);
  for (const p of list) {
    if (p.dead || p.welds.length || p.rebars.length) continue;
    for (const b of lateBlasts) {
      b3.b3Body_GetWorldCenterOfMass(_lc, p.body);
      vec3.sub(_ld, _lc, b.pos);
      const d = vec3.length(_ld);
      const k = 1 - d / b.radius;
      if (k <= 0) continue;
      if (d > 1e-4) vec3.scale(_ld, _ld, 1 / d); else vec3.set(_ld, 0, 1, 0);
      _ld[1] += 0.35;
      vec3.normalize(_ld, _ld);
      // the speed pushFree gives a free body of this size here
      const want = Math.min(b.impulse * Math.cbrt(p.volume) ** 2 * k, p.mass * 22) / p.mass;
      b3.b3Body_GetLinearVelocity(_lv, p.body);
      const along = vec3.dot(_lv, _ld);
      if (along >= want) continue;
      const j = (want - along) * p.mass;
      b3.b3Body_ApplyLinearImpulseToCenter(p.body, [_ld[0] * j, _ld[1] * j, _ld[2] * j], true);
      if (want > BULLET_SPEED) makeBullet(p);
      // a tumble about an axis across the throw (fixed per body, so a replay throws it the same way)
      const a = j * Math.cbrt(p.volume) * 0.2, h = Math.sin(p.id * 12.9898) * 43758.5453, u = h - Math.floor(h);
      b3.b3Body_ApplyAngularImpulse(p.body, [(u - 0.5) * a, (0.5 - u) * a * 0.5, ((u * 2) % 1 - 0.5) * a], true);
    }
  }
}

/* The gas phase and the reverberations push every plate that bounds the charge's room outward: a floor or roof slab
   over it takes (gas impulse + reverberation) × its area upward, a sheet wall or a door outward. A plate with the room on
   both sides (a partition) is pushed equally both ways; masonry panels are the SDOF verdict's (blastPanels). What its
   joints make of the momentum is theirs. */
const _gn: Vec3 = [0, 0, 0], _gq: Vec3 = [0, 0, 0], _gb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
function gasPush(bl: Survey, pos: Vec3, hits: { p: Piece; d: number; cp: Vec3 }[]): void {
  for (const h of hits) {
    const p = h.p;
    if (p.dead || fields.isFragile(p) || !fields.inRoom(bl, h.cp)) continue;
    if (PANEL_MATS.has(p.mat) && !p.pm.rebar) continue;
    const mn: Vec3 = [0, 0, 0], mx: Vec3 = [0, 0, 0];
    P.bounds(p.poly, mn, mx);
    const dims: Vec3 = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    const t = dims[0] <= dims[1] && dims[0] <= dims[2] ? 0 : dims[1] <= dims[2] ? 1 : 2;
    const th = dims[t], a = dims[(t + 1) % 3], b = dims[(t + 2) % 3];
    if (th > 0.5 * Math.min(a, b)) continue;
    vec3.set(_gn, t === 0 ? 1 : 0, t === 1 ? 1 : 0, t === 2 ? 1 : 0);
    vec3.transformQuat(_gn, _gn, p.curRot);
    const side = (h.cp[0] - pos[0]) * _gn[0] + (h.cp[1] - pos[1]) * _gn[1] + (h.cp[2] - pos[2]) * _gn[2] >= 0 ? 1 : -1;
    vec3.scaleAndAdd(_gq, p.curPos, _gn, side * (th / 2 + 0.6));
    if (fields.inRoom(bl, _gq, 0)) continue;
    const I = bl.iGas + bl.held * fields.reverb(bl, h.d);
    // only the part of the plate over this room is loaded (a slab spanning several rooms)
    b3.b3Body_ComputeAABB(_gb, p.body);
    const ax = Math.abs(_gn[0]) >= Math.abs(_gn[1]) && Math.abs(_gn[0]) >= Math.abs(_gn[2]) ? 0 : Math.abs(_gn[1]) >= Math.abs(_gn[2]) ? 1 : 2;
    let area = 1;
    for (let k = 0; k < 3; k++) if (k !== ax) area *= Math.max(0, Math.min(_gb[k + 3], bl.roomMax[k]) - Math.max(_gb[k], bl.roomMin[k]));
    const j = Math.min(I * Math.min(a * b, area), p.mass * 22);
    if (j <= 0) continue;
    b3.b3Body_ApplyLinearImpulseToCenter(p.body, [_gn[0] * side * j, _gn[1] * side * j, _gn[2] * side * j], true);
  }
}

/* ---------------- blast on wall panels ----------------
   Unreinforced masonry fails out of plane: a panel spanning a storey cracks along a bed joint at its flexural
   tensile strength (plus whatever precompression the load above puts on it) and then rocks out as two leaves until it
   passes its own thickness. As a single-degree-of-freedom system it has a quasi-static capacity R (Pa) and an
   impulsive one I0 = √(m·R·t) (Pa·s, m the panel's mass per m²); it goes when the load's pressure–impulse pair lies
   past the P–I hyperbola (P/R − 1)(I/I0 − 1) ≥ ¼. A 1.5 kg charge in a terrace front room loads every wall of that
   room with ~0.2–0.3 MPa of gas for tens of milliseconds, far past a 9 in wall's few kPa: its walls blow out and what
   they carried comes down. In the open the shock's impulse falls off fast and only the nearby wall goes. A panel that
   goes loses every connection, takes the momentum the load left over, and breaks up along its joints in flight. */
const PANEL_MATS = new Set<MaterialId>(['brick', 'cinderblock', 'stone', 'sandstone', 'adobe', 'plaster', 'concrete']);
const MAX_PANELS = 40, SHATTER_PER_STEP = 4;
const shatterQueue: { p: Piece; at: Vec3; step: number; blast: boolean; kick?: Vec3 }[] = [];
const _pn: Vec3 = [0, 0, 0], _pu: Vec3 = [0, 0, 0], _pc: Vec3 = [0, 0, 0];
/** last blast's panel verdicts (harness / tests) */
export const panelLog: { id: number; mat: MaterialId; P: number; I: number; R: number; I0: number; gas: boolean; failed: boolean; v: number }[] = [];

export const lastBlast: { survey: Survey | null } = { survey: null };
function panelCands(bl: Survey, pos: Vec3): Piece[] {
  const g = bl.n, lo: Vec3 = [bl.x0, Math.max(bl.y0, -0.5), bl.z0], hi: Vec3 = [bl.x0 + g, bl.y0 + g, bl.z0 + g];
  const cand: { p: Piece; d: number }[] = [];
  const seen = new Set<Piece>();
  overlapAABB(lo, hi, CAT.structure, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const p = e as Piece;
    if (seen.has(p) || p.dead || p.queued || p.depth > 0 || !p.welds.length || !PANEL_MATS.has(p.mat) || p.pm.rebar) return;
    // a remnant carved out of a massive member (a pier, a buttress) is not a wall panel
    if (Math.min(...p.root.spec.size) > 0.8) return;
    seen.add(p);
    cand.push({ p, d: vec3.distance(p.curPos, pos) });
  });
  cand.sort((a, b) => a.d - b.d || pieceKey(a.p) - pieceKey(b.p));
  return cand.map(c => c.p);
}

/* A storey-high masonry panel the SDOF model below judges: its thickness, height and length, with its normal left in
   _pn; null for anything else. */
function panelGeom(p: Piece): { th: number; h: number; L: number } | null {
  if (p.dead || p.queued || p.depth > 0 || !p.welds.length || !PANEL_MATS.has(p.mat) || p.pm.rebar) return null;
  if (Math.min(...p.root.spec.size) > 0.8) return null;
  const mn: Vec3 = [0, 0, 0], mx: Vec3 = [0, 0, 0];
  P.bounds(p.poly, mn, mx);
  const dims: Vec3 = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const t = dims[0] <= dims[1] && dims[0] <= dims[2] ? 0 : dims[1] <= dims[2] ? 1 : 2;
  const th = dims[t];
  vec3.set(_pn, t === 0 ? 1 : 0, t === 1 ? 1 : 0, t === 2 ? 1 : 0);
  vec3.transformQuat(_pn, _pn, p.curRot);
  if (Math.abs(_pn[1]) > 0.5 || th > 0.8) return null;
  // the in-plane axis nearest vertical spans the storey
  const u = (t + 1) % 3, v = (t + 2) % 3;
  vec3.set(_pu, u === 0 ? 1 : 0, u === 1 ? 1 : 0, u === 2 ? 1 : 0);
  vec3.transformQuat(_pu, _pu, p.curRot);
  const vert = Math.abs(_pu[1]) >= 0.7 ? u : v;
  const h = dims[vert], L = dims[vert === u ? v : u];
  if (h < 0.6 || L < 0.4 || h * L < 0.5) return null;
  return { th, h, L };
}

/* A panel's verdict under this blast, no side effects (leaves its normal in _pn and its nearest point in _pc). */
function judgePanel(bl: Survey, pos: Vec3, p: Piece): { ld: { P: number; I: number; gas: boolean }; R: number; I0: number; m: number; h: number; L: number; over: boolean } | null {
  const g = bl.n;
  const pg = panelGeom(p);
  if (!pg) return null;
  const { th, h, L } = pg;
  // load point: halfway from the face's nearest point to its middle (the SDOF sees the face's mean load)
  b3.b3Shape_GetClosestPoint(_pc, p.shape, pos);
  const c: Vec3 = [(_pc[0] + p.curPos[0]) / 2, (_pc[1] + p.curPos[1]) / 2, (_pc[2] + p.curPos[2]) / 2];
  if (Math.abs(c[0] - bl.pos[0]) > g / 2 || Math.abs(c[1] - bl.pos[1]) > g / 2 || Math.abs(c[2] - bl.pos[2]) > g / 2) return null;
  const ld = panelLoad(bl, c, _pn);
  const area = h * L, m = p.mass / area;
  // precompression at mid-height: what the bed below carries, less half the panel's own weight
  let Nb = 0;
  for (const w of p.welds) {
    weldPos(w, _v);
    weldNormal(w, _pu);
    if (Math.abs(_pu[1]) > 0.7 && _v[1] < p.curPos[1]) Nb += Math.max(0, w.sN);
  }
  const sd = Math.max(p.pm.density * 9.81 * h / 2, (Nb - p.mass * 9.81 / 2) / Math.max(0.01, th * L));
  const M = (p.pm.eng.ft * 1e6 + Math.min(sd, 0.4e6)) * th * th / 6;
  // one-way over the storey, with some two-way help from the returns and arching between floors
  const R = 1.5 * 8 * M / (h * h);
  const I0 = Math.sqrt(m * R * th);
  const over = ld.P > R && ld.I > I0 && (ld.P / R - 1) * (ld.I / I0 - 1) >= 0.25;
  return { ld, R, I0, m, h, L, over };
}

/* Wall area (m²) of the charge's room that its gas phase blows out (a dry run of the panel verdicts below, before
   anything has moved), and when it has opened: a panel driven out by the gas at Pqs has opened a gap round itself as
   wide as its own face once it has moved hL / 2(h + L), which takes √(2·x·m / Pqs). Those walls vent the rest of the
   blow-down. */
function blownOut(bl: Survey, pos: Vec3): { A: number; t: number } {
  let A = 0, n = 0, tA = 0;
  const Pg = Math.max(1, bl.Pqs * bl.held);
  for (const p of panelCands(bl, pos)) {
    if (n >= MAX_PANELS) break;
    const v = judgePanel(bl, pos, p);
    if (!v || !v.over || !v.ld.gas) continue;
    const a = v.h * v.L;
    A += a; n++;
    tA += a * Math.sqrt(2 * (a / (2 * (v.h + v.L))) * v.m / Pg);
  }
  return { A, t: A > 0 ? tA / A : Infinity };
}

function blastPanels(bl: Survey, pos: Vec3): void {
  panelLog.length = 0;
  lastBlast.survey = bl;
  let failed = 0;
  for (const p of panelCands(bl, pos)) {
    if (failed >= MAX_PANELS) break;
    if (p.dead || !p.welds.length) continue;
    const j = judgePanel(bl, pos, p);
    if (!j) continue;
    const { ld, R, I0, m, h, over } = j;
    let vel = 0;
    if (over) {
      failed++;
      vel = Math.min(25, Math.sqrt(Math.max(0, ld.I * ld.I - I0 * I0)) / m);
      const side = (p.curPos[0] - pos[0]) * _pn[0] + (p.curPos[1] - pos[1]) * _pn[1] + (p.curPos[2] - pos[2]) * _pn[2] >= 0 ? 1 : -1;
      for (const w of p.welds.slice()) failWeld(w, 'blast', false);
      const lin: Vec3 = [0, 0, 0];
      b3.b3Body_GetLinearVelocity(lin, p.body);
      const up = Math.min(vel * 0.25, 3);
      const kick: Vec3 = [_pn[0] * side * vel, up, _pn[2] * side * vel];
      b3.b3Body_SetLinearVelocity(p.body, [lin[0] + kick[0], lin[1] + kick[1], lin[2] + kick[2]]);
      // it hinges out about its base: the top leads
      const spin = vel / Math.max(1, h);
      b3.b3Body_SetAngularVelocity(p.body, [_pn[2] * side * spin * (chance() - 0.3), (chance() - 0.5) * 0.4, -_pn[0] * side * spin * (chance() - 0.3)]);
      b3.b3Body_SetAwake(p.body, true);
      shattering.add(p);
      shatterQueue.push({ p, at: [_pc[0], _pc[1], _pc[2]], step: stepCount + 2 + Math.floor(chance() * 6), blast: true, kick });
    } else {
      // cracked bed joints: what is left stands on weakened mortar
      const k = Math.min(ld.I / I0, ld.P / Math.max(R, 1));
      if (k > 0.5) for (const w of p.welds) if (!w.metal) scaleWeld(w, Math.max(0.35, 1 - 0.8 * (k - 0.5)));
    }
    if (panelLog.length < 200) panelLog.push({ id: p.id, mat: p.mat, P: ld.P, I: ld.I, R, I0, gas: ld.gas, failed: over, v: vel });
  }
}

/* Loose brickwork that lands hard does not bounce as a block: lime and weak cement mortar hold a course together with
   a few J/m² of joint, and a clump falling a storey carries hundreds of times what its joints can absorb. Anything
   bigger than a few units comes apart where it lands, into clumps, and a clump into its bricks. */
const LAND_J_PER_KG = 3;
const shattering = new WeakSet<Piece>();
/* a slate or tile roof slab lands as slates, battens and rafters, a timber floor as its boards and joists (nailed
   timber takes a harder landing than a mortar joint to come apart) */
const BREAKUP_MATS = new Set<MaterialId>([...PANEL_MATS, 'roof', 'terracotta', 'wood', 'plywood']);
const landJ = (p: Piece): number => (p.mat === 'wood' || p.mat === 'plywood' ? 12 : LAND_J_PER_KG) * p.mass;
function landing(p: Piece, at: Vec3, e: number): void {
  if (p.dead || p.welds.length || shattering.has(p) || !BREAKUP_MATS.has(p.mat) || e < landJ(p) || detailUnits(p) < 6) return;
  if (clock - p.born < 0.15) return;
  shattering.add(p);
  shatterQueue.push({ p, at: [at[0], at[1], at[2]], step: stepCount, blast: false });
}

/* A wall that has come down whole (toppled, or dropped a storey onto what was below) and lies there: a toppling panel
   slaps down along its length, which the contact events see only as a string of slow hits, but no unreinforced wall
   lands on its face from a storey up in one piece. Once it has stopped, it lies as the clumps and bricks it broke into. */
const _fq: Quat = [0, 0, 0, 1];
function fallen(p: Piece): void {
  if (detailUnits(p) < 40) return;
  const drop = p.spawnPos[1] - p.curPos[1];
  const tilt = Math.abs(quat.dot(p.curRot, p.spawnRot));
  if (drop < 1.2 && tilt > Math.cos(0.5 * 0.7)) return;
  b3.b3Body_GetLinearVelocity(_v, p.body);
  if (vec3.squaredLength(_v) > 1) return;
  void _fq;
  b3.b3Body_ComputeAABB(_aabb2, p.body);
  shattering.add(p);
  shatterQueue.push({ p, at: [p.curPos[0], _aabb2[1] + 0.1, p.curPos[2]], step: stepCount, blast: false });
}

/* A blown-out panel breaks up along its joints in flight, a few panels a step. */
function processShatter(): void {
  let n = 0;
  for (let i = 0; i < shatterQueue.length && n < SHATTER_PER_STEP; ) {
    const e = shatterQueue[i];
    if (e.p.dead) { shatterQueue.splice(i, 1); continue; }
    if (e.step > stepCount) { i++; continue; }
    shatterQueue.splice(i, 1);
    n++;
    if (hasDetail(e.p)) { if (detailShatter(e.p, e.at, e.kick) || !e.blast) continue; }
    if (e.blast && !e.p.dead && !e.p.queued) damagePiece(e.p, e.p.curPos, e.p.hp * 2.5, true);
  }
}

/* A heavy blunt hit: overloads joints around the impact (strength scales with energy / perJoule) and
   shoves whatever is now loose along the shot, so a cannonball knocks a section out rather than
   just cratering it. */
export function kinetic(point: Vec3, dir: Vec3, energy: number, reach: number, perJoule = 25e3): void {
  const wp: Vec3 = [0, 0, 0];
  for (const w of [...welds.values()]) {
    weldPos(w, wp);
    const d = vec3.distance(wp, point);
    if (d > reach) continue;
    const hit = (1 - d / reach) * (energy / perJoule);
    if (hit > 0.6) failWeld(w, 'kinetic', false);
    else if (hit > 0.08) scaleWeld(w, 1 - hit * 0.5);
  }
  processFractures(4);
  const seen = new Set<Piece>();
  const r = reach * 1.25;
  overlapAABB([point[0] - r, point[1] - r, point[2] - r], [point[0] + r, point[1] + r, point[2] + r], CAT.structure | CAT.debris | CAT.prop, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const p = e as Piece;
    if (seen.has(p) || p.dead || p.welds.length) return;
    seen.add(p);
    const k = 1 - vec3.distance(p.curPos, point) / (r + Math.cbrt(p.volume));
    if (k <= 0) return;
    const j = Math.min(p.mass * 9, Math.sqrt(energy) * 18 * k);
    /* Through the centre: the hit point can lie metres outside a small fragment, and an impulse
       levered about it spins the fragment up until contact flings it off at tens of m/s. */
    b3.b3Body_ApplyLinearImpulseToCenter(p.body, [dir[0] * j, dir[1] * j + j * 0.15, dir[2] * j], true);
  });
}

/* Blast momentum goes only to bodies nothing holds: fresh fragments, props, rubble. Pushing a
   welded island would force every joint to cancel that momentum inside one step and the whole
   building would unzip at once; structural damage comes from fracture and joint cutting instead. */
function pushFree(pos: Vec3, radius: number, impulse: number): void {
  const com: Vec3 = [0, 0, 0], dir: Vec3 = [0, 0, 0];
  const seen = new Set<Piece>();
  overlapAABB([pos[0] - radius, pos[1] - radius, pos[2] - radius], [pos[0] + radius, pos[1] + radius, pos[2] + radius],
    CAT.structure | CAT.debris | CAT.prop, shape => {
      const e = entityOfShape(shape);
      if (!e || e.kind !== 'piece') return;
      const p = e as Piece;
      if (seen.has(p) || p.dead || p.welds.length) return;
      seen.add(p);
      b3.b3Body_GetWorldCenterOfMass(com, p.body);
      vec3.sub(dir, com, pos);
      const d = vec3.length(dir);
      const k = 1 - d / radius;
      if (k <= 0) return;
      if (d > 1e-4) vec3.scale(dir, dir, 1 / d); else vec3.set(dir, 0, 1, 0);
      dir[1] += 0.35;
      vec3.normalize(dir, dir);
      const j = Math.min(impulse * Math.cbrt(p.volume) ** 2 * k, p.mass * (p.rebars.length ? 8 : 22));
      b3.b3Body_ApplyLinearImpulseToCenter(p.body, [dir[0] * j, dir[1] * j, dir[2] * j], true);
      if (j > p.mass * BULLET_SPEED) makeBullet(p);
      const a = j * Math.cbrt(p.volume) * 0.25;
      b3.b3Body_ApplyAngularImpulse(p.body, [(chance() - 0.5) * a, (chance() - 0.5) * a, (chance() - 0.5) * a], true);
    });
}

/* ---------------- step integration ---------------- */

export function onHit(a: PhysEntity | undefined, b: PhysEntity | undefined, point: Vec3, normal: Vec3, speed: number): void {
  const pa = a && a.kind === 'piece' ? (a as Piece) : null;
  const pb = b && b.kind === 'piece' ? (b as Piece) : null;
  // the player is a mover with no solver contacts; should one ever appear it is never an impact
  if (!pa && !pb || a?.kind === 'player' || b?.kind === 'player') return;
  const ma = a ? a.mass : Infinity, mb = b ? b.mass : Infinity;
  const mu = Number.isFinite(ma) && Number.isFinite(mb) ? (ma * mb) / (ma + mb) : Math.min(ma, mb);
  if (!Number.isFinite(mu)) return;
  const projA = a?.kind === 'projectile', projB = b?.kind === 'projectile';
  /* A welded island lands with far more than one member's momentum behind the contact. */
  const ea = pa ? effMass(pa) : ma, eb = pb ? effMass(pb) : mb;
  const me = Number.isFinite(ea) && Number.isFinite(eb) ? (ea * eb) / (ea + eb) : Math.min(ea, eb);
  const e = 0.5 * (Number.isFinite(me) ? me : mu) * speed * speed;
  noteShock(point, e);
  if (pa) struck.set(pa, clock);
  if (pb) struck.set(pb, clock);
  const qa = pa?.queued, qb = pb?.queued;
  if (pa) { landing(pa, point, e * (projB ? 1 : 0.55)); damagePiece(pa, point, e * (projB ? 1 : 0.55), false); }
  if (pb) { landing(pb, point, e * (projA ? 1 : 0.55)); damagePiece(pb, point, e * (projA ? 1 : 0.55), false); }
  if (pb && !qb && pb.queued && a) punchThrough(pb, a, normal, speed, e * (projA ? 1 : 0.55));
  if (pa && !qa && pa.queued && b) punchThrough(pa, b, [-normal[0], -normal[1], -normal[2]], speed, e * (projB ? 1 : 0.55));
  if (!projA && !projB && speed > 3) {
    if (pa && !pa.dead) jolt(pa, point, e);
    if (pb && !pb.dead) jolt(pb, point, e);
  }
  if ((projA || projB) && speed > 12) {
    const proj = (projA ? a : b)!;
    b3.b3Body_GetLinearVelocity(_jf, proj.body);
    const l = vec3.length(_jf) || 1;
    kinetic(point, [_jf[0] / l, _jf[1] / l, _jf[2] / l], 0.5 * proj.mass * speed * speed, 1.6);
  }
  const src = pa ?? pb!;
  if (e > 500) audio.impact(point, src.mat, clamp(e / 40e3, 0.04, 1), pieceDims(src));
  if (e > 6000 && fxBudget > 0) { fxBudget--; fx.impact(point, normal, src.mat, clamp(e / 80e3, 0.1, 1)); }
  const heavy = Math.max(pa?.mass ?? 0, pb?.mass ?? 0);
  if (heavy > 1200 && speed > 4.5 && fxBudget > 2) {
    fxBudget -= 3;
    audio.collapse(point, heavy);
    fx.dust(point, clamp(Math.cbrt(heavy) / 4, 1, 6), src.pm.dust);
  }
}

const dimsOf = new WeakMap<Piece, Vec3>();
/** A piece's extents in its own frame (m). */
function pieceDims(p: Piece): Vec3 {
  let d = dimsOf.get(p);
  if (!d) {
    const lo: Vec3 = [0, 0, 0], hi: Vec3 = [0, 0, 0];
    P.bounds(p.poly, lo, hi);
    d = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    dimsOf.set(p, d);
  }
  return d;
}

/* A structure groans before it fails: the few joints nearest capacity under their static load (from the
   frame analysis; a yielding hinge counts as at capacity) are voiced several times a second. The scan is
   round-robin so a big map costs a slice per tick. */
const STRESS_TICK = 0.15, STRESS_SCAN = 1500, STRESS_VOICES = 4;
let stressT = 0;
let stressIter: IterableIterator<Weld> | null = null;
const stressHot = new Set<Weld>();
const _stressTop: Weld[] = [];
const _stressU: number[] = [];

function stressSounds(): void {
  if (building) return;
  for (let n = 0; n < STRESS_SCAN; n++) {
    if (!stressIter) stressIter = welds.values();
    const r = stressIter.next();
    if (r.done) { stressIter = null; break; }
    const w = r.value;
    if (w.alive && !w.calib && (w.yielded || staticRatio(w) > 0.5)) stressHot.add(w);
  }
  _stressTop.length = 0;
  _stressU.length = 0;
  for (const w of stressHot) {
    const u = w.alive ? (yielding.has(w) ? 1 : staticRatio(w)) : 0;
    if (u < 0.45) { stressHot.delete(w); continue; }
    let i = _stressTop.length;
    if (i === STRESS_VOICES && u <= _stressU[i - 1]) continue;
    if (i === STRESS_VOICES) i--;
    while (i > 0 && _stressU[i - 1] < u) { _stressTop[i] = _stressTop[i - 1]; _stressU[i] = _stressU[i - 1]; i--; }
    _stressTop[i] = w; _stressU[i] = u;
    if (_stressTop.length > STRESS_VOICES) { _stressTop.length = STRESS_VOICES; _stressU.length = STRESS_VOICES; }
  }
  for (let i = 0; i < _stressTop.length; i++) {
    const w = _stressTop[i];
    audio.structureStress(weldPos(w, [0, 0, 0]), _stressU[i], w.b && w.b.pm.bond < w.a.pm.bond ? w.b.mat : w.a.mat);
  }
}

/* The solver stops a hitter dead against a member that is about to break, as if it were rigid.
   A body that smashes what it hits keeps what the fracture didn't absorb and carries on through:
   a wrecking ball punches a hole instead of bouncing, a falling slab drives through the floor below. */
function punchThrough(p: Piece, hitter: PhysEntity, n: Vec3, speed: number, e: number): void {
  if (hitter.kind !== 'piece' && hitter.kind !== 'projectile') return;
  if (b3.b3Body_GetType(hitter.body) !== b3.b3BodyType.b3_dynamicBody) return;
  const f = Math.sqrt(Math.max(0, 1 - (p.hp * (1 - 0.8 * p.char)) / Math.max(e, 1)));
  if (f < 0.2) return;
  b3.b3Body_GetLinearVelocity(_w, hitter.body);
  /* it keeps its own way, not the contact's closing speed: a piece the solver shoves into a jammed neighbour, or one
     struck by something faster, has nothing of its own to carry through */
  const own = hitter.vel ? vec3.dot(hitter.vel, n) : speed;
  const vn = vec3.dot(_w, n), target = Math.min(speed, Math.max(0, own)) * f * 0.85;
  if (vn >= target) return;
  vec3.scaleAndAdd(_w, _w, n, target - vn);
  b3.b3Body_SetLinearVelocity(hitter.body, _w);
}

/* Blows landing now (impacts this step, a blast for the step or two its wave takes): a joint far from all of them
   that spikes past its capacity is feeling the rigid-island shortcut, not the blow itself. With no blow landing at
   all, a spike is the island passing on a release elsewhere (a support letting go), and is remote everywhere. */
const shocks: { at: Vec3; r: number; until: number }[] = [];
function noteShock(point: ArrayLike<number>, e: number, r = clamp(Math.cbrt(e / 1000) * 0.5, 1, 4), steps = 1): void {
  if (e < 5000) return;
  for (let i = shocks.length - 1; i >= 0; i--) if (shocks[i].until < stepCount) shocks.splice(i, 1);
  if (shocks.length < 24) shocks.push({ at: [point[0], point[1], point[2]], r, until: stepCount + steps - 1 });
}

function remoteFromShock(w: Weld): boolean {
  weldPos(w, _v);
  for (const s of shocks) if (s.until >= stepCount && vec3.distance(_v, s.at) < s.r) return false;
  return true;
}

function effMass(p: Piece): number {
  const m = islandMass(p);
  return Number.isFinite(m) ? Math.min(p.mass + 0.4 * (m - p.mass), p.mass * 10) : m;
}

export function onJointBroken(id: b3JointId): void {
  // a felling hinge twisted sideways past what its width holds tears free
  const hg = hingeJoints.get(id.index1);
  if (hg && hg.joints.some(({ j }) => j.index1 === id.index1 && j.generation === id.generation)) { releaseHinge(hg); return; }
  const rope = ropeJoints.get(id.index1);
  if (rope && rope.joint.generation === id.generation) { killRope(rope, true); return; }
  if (mechBroken(id, stepCount)) return;
  const r = rebars.get(id.index1);
  if (r && r.joint.generation === id.generation) {
    if (r.lastOver < stepCount - 2) r.overSteps = 0;
    r.lastOver = stepCount;
    if (++r.overSteps >= 3) killRebar(r, true, true);
    return;
  }
  const w = welds.get(id.index1);
  if (!w || w.joint.generation !== id.generation) return;
  b3.b3Joint_GetConstraintForce(_jf, w.joint);
  const f = vec3.length(_jf) / w.cap.comp;
  const fn = vec3.dot(_jf, weldNormal(w, _n));
  b3.b3Joint_GetConstraintTorque(_jf, w.joint);
  const u = Math.max(f, vec3.length(_jf) / (w.cap.torque + thrustMoment(w, fn)));
  if (u > 1) overload(w, u);
}

export function afterStep(dt: number): void {
  clock += dt;
  if (stepCount % 30 === 7) settleBuried();
  if (runawayQueue.length) for (const e of runawayQueue.splice(0)) {
    const p = e as Piece;
    if (e.kind !== 'piece' || p.dead) continue;
    for (const r of p.rebars.slice()) killRebar(r, true, false);
    for (const r of p.ropes.slice()) killRope(r, true);
    for (const w of p.welds.slice()) killWeld(w, true);
    if (p.mechs) for (const m of p.mechs.slice()) killMech(m, true);
  }
  checkTies();
  if (hangQueue.size) checkHanging();
  if (bearings.size && stepCount % 10 === 3) checkBearings();
  if (settling.length && stepCount % 15 === 5) watchSettling();
  groanT -= dt;
  strainT -= dt;
  fxBudget = Math.min(24, fxBudget + 1.5);
  if (stepCount % 2 === 0) pollJoints();
  if (stepCount % YIELD_EVERY === 1) updateYield();
  processFractures(FRACTURE_PER_STEP);
  if (shatterQueue.length) processShatter();
  detailCarveDeferred();
  lateBlastPush();
  stepAnalysis(ANALYSIS_WORK);
  /* Only overstressed paths are revisited each step; a snapped column redistributes weight
     to surviving connections and can start a cascade even when the solver island is asleep.
     The worst few go first and the load is re-routed before the next: failure travels through
     the structure over time instead of every overstressed joint in the building letting go at once. */
  for (const w of supportPressure) {
    if (!w.alive) continue;
    const ratio = staticRatio(w);
    if (ratio > 1.05) offerFailure(w, ratio, true);
  }
  settleFailures();
  if (hinges.length || hingeWatch.size) stepHinges();
  processCracks();
  updateFire(dt);
  heatT += dt;
  if (heatT >= HEAT_TICK) { heatT -= HEAT_TICK; updateHeat(); refreshSupportPressure(); }
  for (let i = calibs.length - 1; i >= 0; i--) {
    const c = calibs[i];
    c.step++;
    if (c.step >= CALIB_SETTLE) sampleCalib(c);
    if (c.step >= CALIB_END) { calibs.splice(i, 1); finishCalib(c, false); }
  }
  updateWind(dt);
  updateQuake(dt);
  jointsStep(dt);
  stressT += dt;
  if (stressT >= STRESS_TICK) { stressT -= STRESS_TICK; stressSounds(); }
  servicesStep(dt);
  stepVehicles(dt);
  for (let i = fusing.length - 1; i >= 0; i--) {
    const p = fusing[i];
    p.fuse -= dt;
    if (p.fuse <= 0 || p.dead) {
      fusing.splice(i, 1);
      detonateProp(p);
    }
  }
  stepSoft(dt);
  housekeeping(dt);
}

/** Once a drawn frame: the shrinking pieces' transforms. Everything that changes the simulation (fades ending, rubble
    set in place, fallen walls breaking up) runs on the step clock in afterStep, so the frame rate, slow motion or a
    render budget can never change what happens. */
export function maintain(_dt: number): void {
  for (const p of fading) if (!p.dead && !p.dirty) setPieceTransform(p.gfx, p.curPos, p.curRot, fadeScale(p));
}

function housekeeping(dt: number): void {
  for (let i = fading.length - 1; i >= 0; i--) {
    const p = fading[i];
    p.fade -= dt;
    if (p.fade <= 0 || p.dead) {
      fading.splice(i, 1);
      destroyPiece(p);
    }
  }
  maintainT -= dt;
  if (maintainT > 0) return;
  maintainT = 0.5;
  for (const p of bullets) {
    b3.b3Body_GetLinearVelocity(_v, p.body);
    if (p.dead || vec3.squaredLength(_v) < 16) { if (!p.dead) b3.b3Body_SetBullet(p.body, false); bullets.delete(p); }
  }
  const doomed: Piece[] = [];
  for (const p of live) {
    if (p.curPos[1] < -15) { if (!p.demolished) markDemolished(p); doomed.push(p); continue; }
    if (p.depth === 0 && !p.welds.length && p.demolished && !shattering.has(p) && BREAKUP_MATS.has(p.mat)) fallen(p);
    if (p.welds.length && p.demolished && !p.dead) looseCluster(p);
    if (!p.dead && p.movedStep >= stepCount - 1) creep(p);
    if (p.fade > 0 || !p.demolished || p.depth === 0 || p.rebars.length || frozenSet.has(p)) continue;
    if (p.movedStep < stepCount - 2) p.sleepT += 0.5;
    if (p.volume < 0.012 && p.sleepT > 30) { if (canFreeze(p) && onRubble(p)) freezeRubble(p); else startFade(p); }
  }
  for (const p of doomed) destroyPiece(p);
  /* The limit is on bodies breakage made: intact structure costs nothing while it sleeps, and
     culling against the whole site would erase every rubble pile on a large level. Rubble that has come to rest
     is set in place first (a heap of whole bricks stays a heap); only what is still moving fades. */
  if (debrisCount > BUDGET * 0.8) {
    const cap = debrisCount > BUDGET * 1.15 ? 0.4 : 0.1;
    const cands = [...live].filter(p => p.debris && p.demolished && p.fade <= 0 && p.volume < cap && !p.rebars.length)
      .map(p => ({ p, still: canFreeze(p) }))
      .sort((a, b) => (a.still === b.still ? a.p.volume * 100 - a.p.born * 0.01 - (b.p.volume * 100 - b.p.born * 0.01) : a.still ? -1 : 1));
    let excess = debrisCount - Math.floor(BUDGET * 0.75);
    for (let i = 0; i < cands.length && excess > 0 && cands[i].still; i++) if (onRubble(cands[i].p)) { freezeRubble(cands[i].p); excess--; }
    // what is still flying fades only well past the limit: a collapse in progress keeps its bricks
    excess = debrisCount - Math.floor(BUDGET * 1.25);
    for (let i = 0; i < cands.length && excess > 0; i++) if (!cands[i].still && cands[i].p.fade <= 0) { startFade(cands[i].p); excess--; }
  }
}

/* Members that came down still joined to each other (a door frame on its lump of wall, two lifts of a pier) and lie
   free of everything standing are rubble: the joints between them hold nothing up any more, and a light member
   jointed to a heavy one rocks on the heap for as long as the solver runs, keeping the whole pile awake. Once the
   cluster has slowed, its joints go and each piece settles on its own. */
const LOOSE_MAX = 8;
const _lcv: Vec3 = [0, 0, 0];
function looseCluster(p: Piece): void {
  const seen = new Set<Piece>([p]), stack = [p];
  while (stack.length) {
    const q = stack.pop()!;
    if (q.rebars.length || q.ropes.length || q.mechs || q.hinged) return;
    for (const w of q.welds) {
      if (!w.b) return;
      const o = w.a === q ? w.b : w.a;
      if (seen.has(o)) continue;
      if (!o.demolished || o.dead || seen.size >= LOOSE_MAX) return;
      seen.add(o); stack.push(o);
    }
  }
  for (const q of seen) { b3.b3Body_GetLinearVelocity(_lcv, q.body); if (vec3.squaredLength(_lcv) > 1) return; }
  for (const q of seen) for (const w of q.welds.slice()) killWeld(w, true);
  for (const q of seen) rubble(q);
}

/* Box3D sleeps a whole solver island or none of it, and a rubble pile is one island: a single fragment the contacts keep
   creeping or rocking (a panel inching down the heap, a brick spinning in a crevice) keeps every body in the pile awake
   and solved, long after the collapse is over (a terrace blast: 1735 awake bodies held by 2 creepers, ~40 ms a step).
   A loose piece that has spent CREEP_T seconds awake and slower than CREEP_V is taken to be at rest, as a real heap's
   friction would have it, and allowed to sleep at that speed; a knock that sets it moving faster gives it back its own
   threshold (loose props on a tilted floor too). Welded, rigged and machine pieces are left to the solver (a sagging member
   is not rubble). */
const CREEP_V = 0.4, CREEP_T = 3;
const creeping = new WeakMap<Piece, { t: number; thr0: number }>();
const _cw: Vec3 = [0, 0, 0];
function creep(p: Piece): void {
  if (p.welds.length || p.rebars.length || p.ropes.length || p.mechs || p.hinged || p.fade > 0 || frozenSet.has(p)) return;
  b3.b3Body_GetLinearVelocity(_v, p.body);
  b3.b3Body_GetAngularVelocity(_cw, p.body);
  const v = Math.max(vec3.length(_v), vec3.length(_cw) * 0.6 * Math.cbrt(p.volume));
  let c = creeping.get(p);
  if (v > CREEP_V) {
    if (c && c.t >= CREEP_T) b3.b3Body_SetSleepThreshold(p.body, c.thr0);
    if (c) c.t = 0;
    return;
  }
  if (!c) creeping.set(p, c = { t: 0, thr0: b3.b3Body_GetSleepThreshold(p.body) });
  c.t += 0.5;
  if (c.t === CREEP_T) b3.b3Body_SetSleepThreshold(p.body, Math.max(c.thr0, CREEP_V));
}

/* Settled rubble: a static body where it came to rest, still drawn and still solid underfoot, but no longer solved
   and no longer counted against the debris limit. The oldest go once there are too many. */
const FROZEN_MAX = 9000;
const frozenSet = new WeakSet<Piece>();
const frozenList: Piece[] = [];
const slowSince = new WeakMap<Piece, number>();
/* at rest: barely moving on two looks half a second apart (one slow sample may be the top of a bounce) */
function canFreeze(p: Piece): boolean {
  if (p.dead || p.welds.length || p.rebars.length || p.ropes.length || p.mechs || p.svc || hasDetail(p) || p.burning || p.curPos[1] < -1) return false;
  if (p.movedStep < stepCount - 30) return true;
  b3.b3Body_GetLinearVelocity(_v, p.body);
  if (vec3.squaredLength(_v) > 0.3 * 0.3) { slowSince.delete(p); return false; }
  const t = slowSince.get(p);
  if (t === undefined) { slowSince.set(p, clock); return false; }
  return clock - t >= 0.45;
}
/* Only what lies on the ground or on other rubble: a static brick left on a standing member would pin it. */
function onRubble(p: Piece): boolean {
  b3.b3Body_ComputeAABB(_aabb2, p.body);
  let ok = true;
  overlapAABB([_aabb2[0] - 0.05, _aabb2[1] - 0.05, _aabb2[2] - 0.05], [_aabb2[3] + 0.05, _aabb2[4] + 0.05, _aabb2[5] + 0.05], CAT.structure | CAT.debris | CAT.prop, shape => {
    if (!ok) return;
    const e = entityOfShape(shape);
    if (!e || e === p) return;
    if (e.kind !== 'piece') { ok = false; return; }
    const q = e as Piece;
    if (q.welds.length || q.rebars.length || q.ropes.length || q.mechs) ok = false;
  });
  return ok;
}

/* Box3D's SetType wakes the body's whole island and drops its contacts, so setting one resting brick in place used to
   wake the resting heap it lies in (and the heap re-settled on cold contacts, jolting more of it). A brick asleep in
   an asleep heap is at rest, and so is everything round it: after the swap, whatever lay asleep against it is put back
   to sleep as it lay (a static brick in the same place bears the same). */
const _frz: Piece[] = [];
function freezeRubble(p: Piece): void {
  if (frozenSet.has(p)) return;
  frozenSet.add(p);
  const resting = !b3.b3Body_IsAwake(p.body);
  if (resting) {
    b3.b3Body_ComputeAABB(_aabb2, p.body);
    overlapAABB([_aabb2[0] - 0.05, _aabb2[1] - 0.05, _aabb2[2] - 0.05], [_aabb2[3] + 0.05, _aabb2[4] + 0.05, _aabb2[5] + 0.05], CAT.structure | CAT.debris | CAT.prop, shape => {
      const e = entityOfShape(shape);
      if (!e || e === p || e.kind !== 'piece') return;
      const q = e as Piece;
      if (!q.dead && !_frz.includes(q) && b3.b3Body_GetType(q.body) === b3.b3BodyType.b3_dynamicBody && !b3.b3Body_IsAwake(q.body)) _frz.push(q);
    });
  }
  b3.b3Body_SetType(p.body, b3.b3BodyType.b3_staticBody);
  for (const q of _frz) b3.b3Body_SetAwake(q.body, false);
  _frz.length = 0;
  if (p.debris) { p.debris = false; debrisCount--; }
  frozenList.push(p);
  counters.frozen++;
  while (frozenList.length > FROZEN_MAX) { const q = frozenList.shift()!; if (!q.dead) startFade(q); }
}
/** settled rubble held static (harness) */
export function frozenRubble(): number { return frozenList.length; }

function fadeScale(p: Piece): number {
  return p.fade > 0 ? Math.max(0.02, p.fade / 0.7) : 1;
}

function startFade(p: Piece): void {
  if (p.fade > 0) return;
  p.fade = 0.7;
  fading.push(p);
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _pos: Vec3 = [0, 0, 0];
export function syncMeshes(alpha: number): void {
  for (let i = dirty.length - 1; i >= 0; i--) {
    const p = dirty[i];
    let drop = p.dead;
    if (!drop) {
      if (p.movedStep === stepCount) {
        _pos[0] = p.prevPos[0] + (p.curPos[0] - p.prevPos[0]) * alpha;
        _pos[1] = p.prevPos[1] + (p.curPos[1] - p.prevPos[1]) * alpha;
        _pos[2] = p.prevPos[2] + (p.curPos[2] - p.prevPos[2]) * alpha;
        _qa.fromArray(p.prevRot); _qb.fromArray(p.curRot);
        _qa.slerp(_qb, alpha);
        setPieceTransform(p.gfx, _pos, _qa, fadeScale(p));
      } else {
        setPieceTransform(p.gfx, p.curPos, p.curRot, fadeScale(p));
        drop = true;
      }
    }
    if (drop) {
      p.dirty = false;
      dirty[i] = dirty[dirty.length - 1];
      dirty.pop();
    }
  }
  for (const [p, [a, f]] of shake) {
    if (p.dead || p.dirty) continue;
    _pos[0] = p.curPos[0]; _pos[1] = p.curPos[1] + a * Math.sin(clock * f * 2 * Math.PI); _pos[2] = p.curPos[2];
    setPieceTransform(p.gfx, _pos, p.curRot);
  }
  drawStandIns(alpha, standIn);
  syncDetail(alpha);
  syncRebar(alpha);
  rebarGfx.flush();
  syncSoftGfx(alpha);
  for (const rope of ropeJoints.values()) {
    interp(rope.a, alpha, _rpa, _rqa);
    interp(rope.b, alpha, _rpb, _rqb);
    toWorld(_ra, _rpa, _rqa, rope.la);
    toWorld(_rb, _rpb, _rqb, rope.lb);
    const available = rope.maxLength - vec3.distance(_ra, _rb);
    const sag = rope.slack * clamp(available / Math.max(0.03, rope.maxLength - rope.rest), 0, 1);
    ropeGfx.set(rope.vis, _ra, _rb, sag);
  }
}

const standIn = (p: Piece, pos: Vec3, rot: Quat): void => { if (!p.dirty) setPieceTransform(p.gfx, pos, rot); };

/** Run the hoist of the rope `p` hangs a load from (a crane's line off its trolley or sheave): `speed` m/s, + pays out,
    − hauls in, 0 holds; called once a frame. Hauling in is the drum's motor winding at up to its line pull; the rope's
    length limit follows it in so the load stays where it has been lifted to. Returns the line's working length. */
export function hoistRope(p: Piece, speed: number, dt = 1 / 60): number | null {
  const r = p.ropes.find((x) => x.alive && x.kind !== 'wire' && (x.a === p ? x.b : x.a).curPos[1] < p.curPos[1]);
  if (!r) return null;
  const cur = b3.b3DistanceJoint_GetCurrentLength(r.joint);
  if (speed < 0) {
    b3.b3DistanceJoint_EnableMotor(r.joint, true);
    b3.b3DistanceJoint_SetMaxMotorForce(r.joint, 0.5 * r.strength);
    b3.b3DistanceJoint_SetMotorSpeed(r.joint, speed);
    r.maxLength = clamp(Math.min(r.maxLength, cur + 0.01), 0.8, 60);
  } else {
    b3.b3DistanceJoint_EnableMotor(r.joint, false);
    r.maxLength = clamp(speed > 0 ? r.maxLength + speed * dt : Math.min(r.maxLength, cur + 0.01), 0.8, 60);
  }
  r.rest = Math.min(r.rest, r.maxLength);
  b3.b3DistanceJoint_SetLengthRange(r.joint, 0, r.maxLength);
  b3.b3Joint_WakeBodies(r.joint);
  return r.maxLength;
}

/** The hook (or load) hanging from `p`'s hoist rope, its line length and whether the line is taut. */
export function hoistOf(p: Piece): { hook: Piece; length: number; taut: boolean } | null {
  const r = p.ropes.find((x) => x.alive && x.kind !== 'wire' && (x.a === p ? x.b : x.a).curPos[1] < p.curPos[1]);
  if (!r) return null;
  const hook = r.a === p ? r.b : r.a;
  return { hook, length: r.maxLength, taut: vec3.distance(r.a.curPos, r.b.curPos) > r.maxLength - 0.05 };
}

export function applyImpulseAt(p: Piece, impulse: Vec3, point: Vec3): void {
  if (!p.dead) b3.b3Body_ApplyLinearImpulse(p.body, impulse, point, true);
}

export function pieceOf(e: PhysEntity | undefined): Piece | null {
  return e && e.kind === 'piece' && !(e as Piece).dead ? (e as Piece) : null;
}

/* ---------------- heat & fire ---------------- */

const CHAR = new THREE.Color(0x140e0a);
const RUST = new THREE.Color(0x7a4526);
const _col = new THREE.Color();

/* Instance colour = paint × crack-darkening, burnt toward charcoal. */
function refreshColor(p: Piece): void {
  if (xray !== 'off') return;
  const dmg = clamp(p.damage / Math.max(1, p.hp), 0, 1);
  _col.setHex(p.tint ?? 0xffffff);
  const st = stains.get(p);
  if (st) _col.lerp(RUST, st * 0.45);
  _col.multiplyScalar((1 - 0.32 * dmg) * (1 - 0.4 * (crushOf.get(p) ?? 0))).lerp(CHAR, Math.min(1, p.char * 1.3));
  setPieceColor(p.gfx, _col);
}

function applyChar(p: Piece): void {
  refreshColor(p);
}

export function heat(p: Piece, dT: number): void {
  if (p.dead || dT <= 0) return;
  p.temp += dT;
  hot.add(p);
}

/* Under intact made-ground surfacing (a duct, a main or a pole butt in the sub-base) there is no air to burn in: the
   heat still cooks it, but it cannot flame and carry a fire along the run. */
const _cover: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
function buried(p: Piece): boolean {
  b3.b3Body_ComputeAABB(_cover, p.body);
  const top = _cover[4];
  const cx = (_cover[0] + _cover[3]) / 2, cz = (_cover[2] + _cover[5]) / 2;
  // wholly below the terrain surface (a cable or pipe in the soil; over a dug hole groundAt is -Infinity)
  if (top < groundAt(cx, cz) - 0.05) return true;
  if (top > 0.65) return false;
  let sealed = false;
  overlapAABB([cx - 0.05, top + 0.02, cz - 0.05], [cx + 0.05, top + 0.6, cz + 0.05], CAT.structure, shape => {
    if (sealed) return;
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece' || e === p) return;
    const q = e as Piece;
    if (!q.dead && q.root.spec.anchored && !flammable(q.pm)) sealed = true;
  });
  return sealed;
}

/* Timber burns; explosive props cook off a few seconds after catching. */
export function ignite(p: Piece): void {
  if (p.dead || p.burning || p.fade > 0 || !flammable(p.pm)) return;
  if (p.pm.explosive) {
    if (p.fuse < 0) { armFuse(p, 2.5 + chance() * 3.5); fx.fire(p.curPos, 5, 0.5); }
    return;
  }
  if (burning.size >= MAX_BURNING || buried(p)) return;
  p.burning = true;
  p.temp = Math.max(p.temp, 600);
  p.fireT = chance() * 0.25;
  burning.add(p);
  hot.add(p);
}

function burnTime(p: Piece): number {
  const least = Math.min(...p.root.spec.size) * Math.min(1, Math.cbrt(p.volume / p.root.volume));
  const t = charTime(p.pm, least);
  if (t !== undefined) return clamp(t, 8, 90);
  const base = p.pm.thermal.burn ?? 26;
  return clamp(base * (0.4 + Math.cbrt(p.volume)), 8, 60);
}

function updateFire(dt: number): void {
  for (const p of burning) {
    if (p.dead) { burning.delete(p); continue; }
    p.char = Math.min(1, p.char + (dt / burnTime(p)) * fields.charRate(p));
    p.fireT -= dt;
    if (p.fireT > 0) continue;
    p.fireT = 0.2;
    applyChar(p);
    const size = clamp(Math.cbrt(p.volume) * 1.6, 0.4, 1.8);
    /* an oxygen-starved fire smoulders: no flame, just the glow and smoke the gas field carries */
    const flame = (p.char < 0.85 ? 1 : (1 - p.char) / 0.15) * fields.flameOf(p);
    if (flame > 0.05) fx.flames(p.curPos, size, 0.4 + flame * 0.6);
    for (const w of p.welds) scaleWeld(w, 0.985, false);
    // a burning member is nudged awake to find out whether its weakening joints still hold; loose burning rubble is
    // not, or it would keep its whole pile awake for as long as it burns
    if (p.welds.length && chance() < 0.1) heatWake(p);
    if (chance() < 0.18) audio.burn(p.curPos, size * flame);
    if (p.char >= 1) disintegrate(p);
  }
  fields.stepFields(dt);
}

/* Waking a sleeping member wakes its whole solver island: a burning beam under a rubble heap wakes the heap, every time.
   The solver can only break a heat-weakened joint whose load comes near what the joint now holds, and a sleeping joint
   still carries the load it last carried, so a member whose joints all sit well inside their reduced capacity holds as
   it lies and stays asleep. Failure from the static load itself (settleFailures, creep rupture) runs on the analysis,
   awake or not. */
const HEAT_WAKE = 0.6;
function heatWake(p: Piece): void {
  if (b3.b3Body_IsAwake(p.body)) return;
  for (const w of p.welds) {
    if (!w.alive) continue;
    b3.b3Joint_GetConstraintForce(_jf, w.joint);
    let r = vec3.length(_jf) / w.cap.comp;
    b3.b3Joint_GetConstraintTorque(_jf, w.joint);
    r = Math.max(r, vec3.length(_jf) / w.cap.torque, staticRatio(w));
    if (r >= HEAT_WAKE) { b3.b3Body_SetAwake(p.body, true); return; }
  }
}

const INCANDESCENT = new Set<MaterialId>(['steel', 'castiron', 'aluminum', 'metal', 'copper', 'machine']);

/* Heat moves from burning timber into whatever touches it (hot gas rises, so more above);
   ignition, cook-off, steel softening, spalling and glass cracking all follow from temperature. */
const starved: Piece[] = [];
function updateHeat(): void {
  for (const p of burning) {
    if (p.dead) continue;
    /* flames lick what touches them; a smouldering ember only glows against it */
    const fl = fields.flameOf(p);
    p.temp = 650 + 200 * fl;
    const T = p.temp, k = 0.25 + 0.75 * fl;
    b3.b3Body_ComputeAABB(_aabb, p.body);
    const m = 0.45;
    const selfExt = (p.pm.thermal.loi ?? 0) > 0.21;
    const lick = fields.surfaceArea(p);
    let fed = !selfExt;
    overlapAABB([_aabb[0] - m, _aabb[1] - m, _aabb[2] - m], [_aabb[3] + m, _aabb[4] + m + 0.7 * fl, _aabb[5] + m],
      CAT.structure | CAT.debris | CAT.prop, shape => {
        const e = entityOfShape(shape);
        if (!e || e.kind !== 'piece' || e === p) return;
        const q = e as Piece;
        if (!q.dead && q.burning && !((q.pm.thermal.loi ?? 0) > 0.21)) fed = true;
        if (q.dead || q.burning || !fireSpread || q.temp >= T) return;
        /* a lump warms by the share of its surface the flames lick: a burning post barely warms a 20 m verge slab */
        q.temp += (T - q.temp) * q.pm.thermal.absorb * k * Math.min(1, lick / fields.surfaceArea(q));
        hot.add(q);
      });
    /* a self-extinguishing plastic (PVC-U) only burns in another fire's heat: alone, or end to end with more of
       itself along a buried run, it goes out, hot and pyrolysing */
    if (!fed) starved.push(p);
  }
  for (const p of starved.splice(0)) {
    p.burning = false;
    burning.delete(p);
    p.temp = Math.min(p.temp, (p.pm.thermal.ignite ?? 400) * 0.75);
  }
  spallBudget = 4;
  /* gas-field exchange, conduction, radiation, drying, flashover; the quenched crack */
  for (const p of fields.fieldsHeatTick(HEAT_TICK, burning, hot, fireSpread)) {
    if (p.dead || p.queued) continue;
    if (p.pm.thermal.spall !== undefined && p.pm.style !== 'shards' && p.pm.style !== 'dice') { spall(p); continue; }
    p.queued = true;
    audio.glassCrack(p.curPos);
    fractureQueue.push({ p, point: [...p.curPos], intensity: 1.1, blast: false });
  }
  for (const p of hot) {
    if (p.dead) { hot.delete(p); continue; }
    const th = p.pm.thermal;
    if (th.ignite !== undefined && !p.burning && p.temp >= th.ignite) ignite(p);
    if (th.cookOff !== undefined && p.temp >= th.cookOff) ignite(p);
    if (th.soften) {
      const k = strengthAt(p.pm, p.temp);
      if (Math.abs(k - p.heatK) > 0.03) {
        p.heatK = k;
        for (const w of p.welds) applyCaps(w);
        if (p.welds.length) heatWake(p);
        /* softening sheds load to cooler members; a hot strut loses stiffness and buckles long before it yields */
        analysisTouch(p);
        supportDirty = true;
        const ma = memberAxial.get(p);
        if (ma && ma.N >= ma.Pcr * k) buckle(p, ma.N, ma.Pcr * k);
      }
      /* incandescence is a metal thing: gypsum and plastics soften too but char or melt long before they glow */
      const g = INCANDESCENT.has(p.mat) ? clamp((p.temp - 420) / 680, 0, 1) : 0;
      if (Math.abs(g - p.glow) > 0.03) {
        p.glow = g;
        setPieceHeat(p.gfx, g);
        if (g > 0.2 && chance() < 0.1) audio.sizzle(p.curPos, g);
      }
    }
    if (th.spall !== undefined && p.temp > th.spall && chance() < 0.05) spall(p);
    if (p.welds.length) heatJoints(p);
    if (p.temp > 250) detailHeat(p);
    if (th.shock !== undefined && p.temp > th.shock && !p.queued) {
      p.queued = true;
      audio.glassCrack(p.curPos);
      fractureQueue.push({ p, point: [...p.curPos], intensity: 1.1, blast: false });
    }
    if (!p.burning && p.temp < 60) {
      if (p.glow > 0) { p.glow = 0; setPieceHeat(p.gfx, 0); }
      hot.delete(p);
    }
  }
}

/* Moisture in hot concrete flashes to steam and blows flakes off the surface. */
/* Spalling is surface loss, a few times per heated face, not a slow shattering of the whole member;
   left unbounded, a house fire fractured every wall touching it within a minute. */
const spallCount = new WeakMap<Piece, number>();
let spallBudget = 0;
function spall(p: Piece): void {
  const n = spallCount.get(p) ?? 0;
  if (n >= 3 || spallBudget <= 0) return;
  spallCount.set(p, n + 1);
  spallBudget--;
  counters.spalls++;
  audio.spall(p.curPos);
  fx.debris(p.curPos, 6, p.pm.chips, 4);
  fx.dust(p.curPos, 0.5, p.pm.dust);
  p.damage = Math.min(p.hp * 0.9, p.damage + p.hp * 0.12);
}

/* Burnt through: the piece crumbles to embers and ash. */
function disintegrate(p: Piece): void {
  const pos: Vec3 = [...p.curPos];
  if (!p.demolished) credit(p.root, p.volume, pos);
  p.demolished = true;
  const size = clamp(Math.cbrt(p.volume) * 1.6, 0.4, 2.5);
  destroyPiece(p);
  fx.debris(pos, Math.round(6 + size * 8), 0x1d1611, 1.5);
  fx.dust(pos, size, 0x3b3632);
  fx.sparks(pos, [0, 1, 0], Math.round(8 + size * 10));
  audio.fracture(pos, 'wood', 0.15);
}

/* Water on a fire: flames out, and the soaked member won't re-ignite at once. */
export function douse(p: Piece): void {
  if (p.burning) { p.burning = false; burning.delete(p); }
  p.temp = Math.min(p.temp, 90);
  const r = fields.recOf(p);
  r.wet = Math.max(r.wet, 1);
  r.moist = Math.max(r.moist, 0.05);
}

export function burningCount(): number {
  return burning.size;
}

export function burningPieces(): ReadonlySet<Piece> {
  return burning;
}

/* ---------------- engineer's x-ray ---------------- */

export function xrayMode(): XrayMode {
  return xray;
}

export function setXrayMode(m: XrayMode): void {
  xray = m;
  xrayT = 0;
  setBatchesXray(m !== 'off');
  if (m === 'off') {
    xrayDots.hide();
    for (const p of live) refreshColor(p);
  }
}

/* How close a joint is to failing in its worst mode: 1 = at capacity. */
function utilization(w: Weld): number {
  b3.b3Joint_GetConstraintForce(_jf, w.joint);
  weldNormal(w, _n);
  const fn = vec3.dot(_jf, _n);
  const sh = Math.sqrt(Math.max(0, vec3.squaredLength(_jf) - fn * fn));
  b3.b3Joint_GetConstraintTorque(_tor, w.joint);
  return Math.max(
    Math.max(fn, 0) / w.cap.comp,
    -fn / w.cap.ten,
    sh / (w.cap.shear + w.mu * Math.max(0, fn)),
    vec3.length(_tor) / w.cap.torque,
  );
}

const _sc: [number, number, number] = [0, 0, 0];
const _xp: Vec3 = [0, 0, 0];
let pulse = 0;

export function updateXray(dt: number): void {
  if (xray === 'off') return;
  pulse += dt;
  xrayT -= dt;
  const refresh = xrayT <= 0;
  if (refresh) xrayT = 0.1;
  const arr = [...welds.values()];
  if (refresh && xray === 'stress' && arr.length) {
    const n = Math.min(arr.length, 900);
    for (let i = 0; i < n; i++) {
      const w = arr[(xrayCursor + i) % arr.length];
      if (!w.alive) continue;
      /* the analysis gives the clean static picture; Box3D's forces add what motion and impacts do */
      const moving = w.a.movedStep >= stepCount - 2 || (w.b !== null && w.b.movedStep >= stepCount - 2);
      w.util = moving ? Math.max(staticRatio(w), utilization(w)) : staticRatio(w);
    }
    xrayCursor = (xrayCursor + n) % arr.length;
  }
  if (refresh) {
    for (const p of live) {
      if (xray === 'thermal') thermalColor(p.temp, _sc);
      else if (xray === 'services') serviceColor(p, _sc);
      else if (xray === 'fields') { _sc[0] = _sc[1] = _sc[2] = 0.16; }
      else if (!p.welds.length) { _sc[0] = _sc[1] = _sc[2] = 0.12; }
      else {
        let u = 0;
        for (const w of p.welds) u = Math.max(u, w.util);
        stressColor(u, _sc);
      }
      _col.setRGB(_sc[0], _sc[1], _sc[2]);
      setPieceColor(p.gfx, _col);
    }
  }
  xrayDots.begin();
  if (xray === 'stress') {
    const beat = 0.6 + 0.4 * Math.sin(pulse * 9);
    for (const w of arr) {
      if (!w.alive) continue;
      weldPos(w, _xp);
      const r = clamp(0.05 + Math.sqrt(w.area) * 0.07, 0.05, 0.16);
      if (w.yielded) xrayDots.push(_xp, r * 1.4, beat, 0.15 * beat, beat);
      else {
        stressColor(w.util, _sc);
        xrayDots.push(_xp, r, _sc[0], _sc[1], _sc[2]);
      }
    }
    for (const rb of rebars.values()) {
      toWorld(_xp, rb.a.curPos, rb.a.curRot, rb.la);
      xrayDots.push(_xp, 0.05, 1, 0.45, 0.1);
    }
  } else if (xray === 'services') {
    serviceDots(xrayDots.push, pulse);
  } else if (xray === 'fields') {
    fields.fieldDots(xrayDots.push, thermalColor);
  } else {
    for (const p of hot) if (p.temp > 150) xrayDots.push(p.curPos, 0.06, 1, 0.6, 0.2);
  }
  xrayDots.end();
}

/* ---------------- tools & free-play runtime ---------------- */

/* Drop new structure into a running world. Its joints are measured over the next ~0.5 s of play
   instead of in a blocking settle, so the rest of the site keeps simulating undisturbed. */
export function spawnPieces(specs: PieceSpec[]): Piece[] {
  building = true;
  const list: Piece[] = [], made = new Map<PieceSpec, Piece>();
  for (const spec of canonical(specs)) {
    const volume = specVolume(spec);
    if (volume <= 0) continue;
    const root = newRoot(spec, volume);
    const p = spawnSpec(spec, root);
    if (p) { list.push(p); made.set(spec, p); if (spec.detail) attachDetail(p); }
  }
  const before = new Set(welds.values());
  autoWeld(list);
  ageInit(list);
  linkRopes(list);
  linkMechs(list, (CALIB_END + 4) / 60);
  linkVehicles(list);
  building = false;
  const fresh = [...welds.values()].filter(w => !before.has(w));
  for (const w of fresh) {
    w.calib = true;
    b3.b3Joint_SetForceThreshold(w.joint, 3e38);
    b3.b3Joint_SetTorqueThreshold(w.joint, 3e38);
  }
  calibs.push(newCalib(fresh, list));
  refreshServices();
  createSoftFor(list);
  // handed back in the caller's order
  const out: Piece[] = [];
  for (const spec of specs) { const p = made.get(spec); if (p) { out.push(p); made.delete(spec); } }
  return out;
}

/* Cut a member clean through along a plane (shaped charge, thermite burn-through). Both halves keep
   the joints on their own side; nothing ties them to each other. */
export function sever(p: Piece, point: Vec3, normal: Vec3): boolean {
  if (p.dead) return false;
  if (hasDetail(p)) return detailSever(p, point, normal);
  const pos: Vec3 = [0, 0, 0], rot: Quat = [0, 0, 0, 1], lin: Vec3 = [0, 0, 0], ang: Vec3 = [0, 0, 0];
  b3.b3Body_GetTransform(pos, rot, p.body);
  b3.b3Body_GetLinearVelocity(lin, p.body);
  b3.b3Body_GetAngularVelocity(ang, p.body);
  const nl = vec3.normalize([0, 0, 0], dirLocal([0, 0, 0], rot, normal));
  const d = vec3.dot(nl, toLocal([0, 0, 0], pos, rot, point));
  if (p.parts) return !!sliceCompound(p, nl, d);
  const halves = [P.clip(p.poly, nl, d, -2), P.clip(p.poly, [-nl[0], -nl[1], -nl[2]], -d, -2)];
  const cents = halves.map(() => [0, 0, 0] as Vec3);
  const vols = halves.map((h, i) => P.volumeCentroid(h, cents[i]));
  if (halves[0] === p.poly || halves[1] === p.poly || vols[0] < MIN_BODY_VOL || vols[1] < MIN_BODY_VOL) return false;

  const neighbours: { o: Piece | null; s: Caps }[] = [];
  for (const w of p.welds) {
    const o = w.a === p ? w.b : w.a;
    const ar = Math.max(w.area, 0.01);
    neighbours.push({ o, s: { comp: w.base.comp / ar, ten: w.base.ten / ar, shear: w.base.shear / ar, torque: w.base.torque / ar } });
  }
  const wasDemolished = p.demolished, hp = p.hp;
  if (p.svc) svcHarm(p, true);
  counters.fractures++;
  destroyPiece(p);
  const r: Vec3 = [0, 0, 0];
  for (let i = 0; i < 2; i++) {
    const c = cents[i];
    vec3.transformQuat(r, c, rot);
    const chunk = createPiece({
      mat: p.mat, tint: p.tint, poly: P.translate(halves[i], [-c[0], -c[1], -c[2]]),
      cyl: p.cyl ? { r: p.cyl.r, ax: p.cyl.ax - c[0], az: p.cyl.az - c[2] } : null,
      pos: [pos[0] + r[0], pos[1] + r[1], pos[2] + r[2]], rot: [...rot],
      lin: [lin[0] + ang[1] * r[2] - ang[2] * r[1], lin[1] + ang[2] * r[0] - ang[0] * r[2], lin[2] + ang[0] * r[1] - ang[1] * r[0]],
      ang: [...ang], uvOrigin: [p.uvOrigin[0] + c[0], p.uvOrigin[1] + c[1], p.uvOrigin[2] + c[2]],
      depth: p.depth, root: p.root, demolished: wasDemolished, awake: true, volume: vols[i],
      char: p.char, burning: p.burning, temp: p.temp, frag: true,
    });
    if (!chunk) continue;
    chunk.hp = hp;
    b3.b3Body_ComputeAABB(_aabb, chunk.body);
    for (const { o, s } of neighbours) {
      if (o && (o.dead || !live.has(o))) continue;
      if (!o) {
        if (_aabb[1] > 0.06) continue;
        const area = Math.max(0.01, (_aabb[3] - _aabb[0]) * (_aabb[5] - _aabb[2]) * 0.5);
        createWeld(chunk, null, [(_aabb[0] + _aabb[3]) / 2, Math.max(0, _aabb[1]), (_aabb[2] + _aabb[5]) / 2], DOWN, area,
          { comp: s.comp * area, ten: s.ten * area, shear: s.shear * area, torque: s.torque * area });
        continue;
      }
      const ct = pieceTouch(chunk, o, 0.05, 0.04);
      if (!ct) continue;
      createWeld(chunk, o, ct.c, ct.n, ct.area,
        { comp: s.comp * ct.area, ten: s.ten * ct.area, shear: s.shear * ct.area, torque: s.torque * ct.area });
    }
  }
  return true;
}

/* ---------------- compound members ---------------- */

interface Motion { pos: Vec3; rot: Quat; lin: Vec3; ang: Vec3 }

function motionOf(p: Piece): Motion {
  const m: Motion = { pos: [0, 0, 0], rot: [0, 0, 0, 1], lin: [0, 0, 0], ang: [0, 0, 0] };
  b3.b3Body_GetTransform(m.pos, m.rot, p.body);
  b3.b3Body_GetLinearVelocity(m.lin, p.body);
  b3.b3Body_GetAngularVelocity(m.ang, p.body);
  return m;
}

/* A body of some of `p`'s parts (polys in p's frame), re-centred on their centroid and moving with p. */
function spawnParts(p: Piece, m: Motion, parts: PartGeo[], depth: number, demolished: boolean): Piece | null {
  let vol = 0;
  const c: Vec3 = [0, 0, 0], pc: Vec3 = [0, 0, 0];
  for (const q of parts) { const v = P.volumeCentroid(q.poly, pc); vol += v; vec3.scaleAndAdd(c, c, pc, v); }
  if (vol < MIN_BODY_VOL) { if (!demolished) credit(p.root, vol, m.pos); return null; }
  vec3.scale(c, c, 1 / vol);
  const back: Vec3 = [-c[0], -c[1], -c[2]];
  const geo = parts.map(q => ({ poly: P.translate(q.poly, back), cyl: q.cyl ? { r: q.cyl.r, ax: q.cyl.ax - c[0], az: q.cyl.az - c[2] } : null }));
  const env = geo.length > 1 ? P.hullOf(geo.map(q => q.poly)) : geo[0].poly;
  if (!env) return null;
  const r = vec3.transformQuat([0, 0, 0], c, m.rot) as Vec3, { lin, ang } = m;
  return createPiece({
    mat: p.mat, tint: p.tint, poly: env, parts: geo.length > 1 ? geo : undefined, cyl: geo.length > 1 ? null : geo[0].cyl,
    pos: [m.pos[0] + r[0], m.pos[1] + r[1], m.pos[2] + r[2]], rot: [...m.rot],
    lin: [lin[0] + ang[1] * r[2] - ang[2] * r[1], lin[1] + ang[2] * r[0] - ang[0] * r[2], lin[2] + ang[0] * r[1] - ang[1] * r[0]],
    ang: [...ang], uvOrigin: [p.uvOrigin[0] + c[0], p.uvOrigin[1] + c[1], p.uvOrigin[2] + c[2]],
    depth, root: p.root, demolished, awake: true, volume: vol,
    char: p.char, burning: p.burning, temp: p.temp, frag: true,
  });
}

/* A compound comes apart at its seams before anything cracks: the part nearest the hit lets go of the
   rest (held back only by rebar), the others stay welded where they were, one body per group of parts still
   joined to each other. A hard enough hit then breaks the freed part like any convex member. */
function splitCompound(p: Piece, point: Vec3, intensity: number, blast: boolean): void {
  const m = motionOf(p), parts = p.parts!, pm = p.pm;
  const li = toLocal([0, 0, 0], m.pos, m.rot, point);
  let hit = 0, best = Infinity;
  parts.forEach((q, i) => {
    let d = -Infinity;
    for (const f of q.poly.faces) d = Math.max(d, vec3.dot(f.n, li) - f.d);
    if (d < best) { best = d; hit = i; }
  });
  const neighbours = neighbourCaps(p);
  const wasDemolished = p.demolished;
  if (p.svc) svcHarm(p, true);
  counters.fractures++;
  destroyPiece(p);
  const kept: Piece[] = [];
  for (const g of groupParts(parts.filter((_, i) => i !== hit))) {
    const q = spawnParts(p, m, g, p.depth, wasDemolished);
    if (!q) continue;
    reweld(q, neighbours);
    kept.push(q);
  }
  const free = spawnParts(p, m, [parts[hit]], p.depth, wasDemolished);
  if (free && pm.rebar) for (const q of kept) {
    const t = pieceTouch(free, q, 0.02, 0.02);
    if (t) addRebar(free, q, t.c, t.n, t.area);
  }
  const size = clamp(Math.cbrt(p.volume) * 1.2, 0.5, 3);
  fx.dust(point, size, pm.dust);
  fx.debris(point, Math.round(6 + size * 6), pm.chips, blast ? 6 : 3);
  if (!Number.isFinite(pm.toughness)) fx.sparks(point, [0, 1, 0], 14);
  audio.fracture(point, p.mat, clamp(p.volume * 0.5, 0.05, 2));
  if (free && pm.style !== 'none' && (blast || intensity > 1.25)) {
    free.born = clock - IMPACT_GRACE;
    fracture(free, point, intensity, blast);
  }
}

/* Cut a compound along the local plane nl·x = d: every part the plane crosses is clipped, and each side
   becomes one body per group of parts still joined, re-welded to whatever it still touches. */
function sliceCompound(p: Piece, nl: Vec3, d: number): Piece[] | null {
  const sides: PartGeo[][] = [[], []];
  const back: Vec3 = [-nl[0], -nl[1], -nl[2]];
  for (const q of p.parts!) {
    const a = P.clip(q.poly, nl, d, -2);
    if (a === q.poly) { sides[0].push(q); continue; }
    if (a.faces.length < 4) { sides[1].push(q); continue; }
    sides[0].push({ poly: a, cyl: q.cyl });
    const b = P.clip(q.poly, back, -d, -2);
    if (b.faces.length >= 4) sides[1].push({ poly: b, cyl: q.cyl });
  }
  const vol = (g: PartGeo[]) => g.reduce((v, q) => v + P.volumeCentroid(q.poly, _w), 0);
  if (!sides[0].length || !sides[1].length || vol(sides[0]) < MIN_BODY_VOL || vol(sides[1]) < MIN_BODY_VOL) return null;
  const m = motionOf(p), neighbours = neighbourCaps(p), wasDemolished = p.demolished, hp = p.hp;
  if (p.svc) svcHarm(p, true);
  counters.fractures++;
  destroyPiece(p);
  const out: Piece[] = [];
  for (const side of sides) for (const g of groupParts(side)) {
    const q = spawnParts(p, m, g, p.depth, wasDemolished);
    if (!q) continue;
    q.hp = hp;
    reweld(q, neighbours);
    out.push(q);
  }
  return out;
}

/* crackMember for a compound: the crack runs a short way in from the failing joint, square across every part. */
function crackCompound(p: Piece, at: Vec3, into: Vec3): boolean {
  const pos: Vec3 = [0, 0, 0], rot: Quat = [0, 0, 0, 1];
  b3.b3Body_GetTransform(pos, rot, p.body);
  const nl = vec3.normalize([0, 0, 0], dirLocal([0, 0, 0], rot, into)) as Vec3;
  const ai = toLocal([0, 0, 0], pos, rot, at);
  extentAlong(p.poly, nl, _ext);
  const s0 = clamp(vec3.dot(nl, ai), _ext[0], _ext[1]), L = _ext[1] - s0;
  if (L < 1) return false;
  const off = clamp(L * (0.1 + 0.3 * chance()), 0.3, L - 0.3);
  const pm = p.pm, vol = p.volume, mat = p.mat;
  const made = sliceCompound(p, nl, s0 + off);
  if (!made) return false;
  counters.cracks++;
  const mid = toWorld([0, 0, 0], pos, rot, [ai[0] + nl[0] * off, ai[1] + nl[1] * off, ai[2] + nl[2] * off]);
  if (pm.rebar) {
    let tied = 0;
    for (let i = 0; i < made.length && tied < 2; i++) for (let j = i + 1; j < made.length && tied < 2; j++) {
      const t = pieceTouch(made[i], made[j], 0.02, 0.02);
      if (t) { addRebar(made[i], made[j], t.c, t.n, t.area, 0.18); tied++; }
    }
  }
  fx.dust(mid, clamp(Math.cbrt(vol), 0.5, 2.5), pm.dust);
  fx.debris(mid, 12, pm.chips, 3);
  audio.fracture(mid, mat, clamp(vol * 0.4, 0.05, 1.2));
  return true;
}

/* Everything joined to `p` (free-play delete tool). */
export function removeConnected(p: Piece, limit = 4000): number {
  const seen = new Set<Piece>([p]);
  const q = [p];
  while (q.length && seen.size < limit) {
    const c = q.pop()!;
    for (const w of c.welds) for (const o of [w.a, w.b]) if (o && !seen.has(o)) { seen.add(o); q.push(o); }
    for (const o of mechPartsOf(c)) if (!seen.has(o)) { seen.add(o); q.push(o); }
  }
  for (const x of seen) destroyPiece(x);
  return seen.size;
}

export function clearDebris(): number {
  const doomed = [...live].filter(p => p.depth > 0 && !p.welds.length && !p.rebars.length);
  for (const p of doomed) destroyPiece(p);
  return doomed.length;
}

export function extinguish(): void {
  softExtinguish();
  for (const p of burning) { p.burning = false; p.temp = Math.min(p.temp, 120); }
  burning.clear();
  for (const p of hot) p.temp = Math.min(p.temp, 120);
}

export function setFrozen(frozen: boolean): void {
  for (const p of live) {
    if (p.dead || frozenSet.has(p)) continue;
    b3.b3Body_SetType(p.body, frozen ? b3.b3BodyType.b3_staticBody : b3.b3BodyType.b3_dynamicBody);
    if (!frozen) b3.b3Body_SetAwake(p.body, true);
  }
}

export function setJointStrength(k: number): void {
  jointMul = clamp(k, 0.1, 5);
  for (const w of welds.values()) applyCaps(w);
}

export function setFireSpread(on: boolean): void { fireSpread = on; }
export function setDebrisLimit(n: number): void { BUDGET = clamp(Math.round(n), 400, 6000); }
export function setWind(strength: number): void { windStrength = clamp(strength, 0, 1); }

const _wind: Vec3 = [0, 0, 0];
function updateWind(dt: number): void {
  if (windStrength <= 0) { _wind[0] = _wind[1] = _wind[2] = 0; return; }
  windT += dt;
  const gust = 0.65 + 0.35 * Math.sin(windT * 0.7) * Math.sin(windT * 1.9 + 1.3);
  const speed = windStrength * 38 * gust;
  vec3.set(_wind, speed * 0.92, 0, speed * 0.38);
  if (movedAt === stepCount) for (const p of movedNow) if (!p.dead && p.movedStep === stepCount) {
    if (p.parts) for (const q of p.parts) b3.b3Shape_ApplyWind(q.shape, _wind, 1, 0.25, 60, false);
    else b3.b3Shape_ApplyWind(p.shape, _wind, 1, 0.25, 60, false);
  }
  if (windStrength > 0.45 && stepCount % 15 === 0) {
    let n = 0;
    for (const p of live) {
      if (chance() > 0.04 || p.dead) continue;
      b3.b3Shape_ApplyWind(p.shape, _wind, 1, 0.25, 60, true);
      if (++n > 60) break;
    }
  }
}

export function windVector(): Vec3 { return _wind; }

/* Earthquake: the ground slab becomes a kinematic shake table for a few seconds and returns home. */
export function startQuake(seconds = 9, magnitude = 1): void {
  quakeT = 0;
  quakeDur = seconds;
  quakeMag = magnitude;
  b3.b3Body_SetType(ground, b3.b3BodyType.b3_kinematicBody);
  for (const p of live) if (p.welds.some(w => w.b === null)) b3.b3Body_SetAwake(p.body, true);
}

function quakeDisp(t: number, out: Vec3): Vec3 {
  const env = Math.min(1, t / 1.2) * Math.min(1, Math.max(0, (quakeDur - t) / 2.5));
  const a = 0.07 * quakeMag * env;
  out[0] = a * (Math.sin(t * 11.3) + 0.5 * Math.sin(t * 17.9 + 0.7));
  out[1] = a * 0.25 * Math.sin(t * 23.1 + 2.1);
  out[2] = a * (0.8 * Math.sin(t * 8.7 + 1.9) + 0.4 * Math.sin(t * 21.7));
  return out;
}

const _qd0: Vec3 = [0, 0, 0], _qd1: Vec3 = [0, 0, 0];
function updateQuake(dt: number): void {
  if (quakeT < 0) return;
  quakeDisp(quakeT, _qd0);
  quakeT += dt;
  if (quakeT >= quakeDur) {
    quakeT = -1;
    b3.b3Body_SetLinearVelocity(ground, [0, 0, 0]);
    b3.b3Body_SetTransform(ground, [0, -0.5, 0], [0, 0, 0, 1]);
    b3.b3Body_SetType(ground, b3.b3BodyType.b3_staticBody);
    return;
  }
  quakeDisp(quakeT, _qd1);
  b3.b3Body_SetLinearVelocity(ground, [(_qd1[0] - _qd0[0]) / dt, (_qd1[1] - _qd0[1]) / dt, (_qd1[2] - _qd0[2]) / dt]);
  quakeLoose(dt);
}

/* box3d heightfields collide only on a static body, so the terrain cannot itself be a shake table: what stands on it
   loose feels the ground's acceleration as the inertial load it would in the ground's frame (it slides or topples
   when friction or its base cannot hold it), while everything fixed to the anchor is driven through its welds. */
const _qacc: Vec3 = [0, 0, 0], _qf: Vec3 = [0, 0, 0];
function quakeLoose(dt: number): void {
  quakeDisp(quakeT + dt, _qacc);
  for (let k = 0; k < 3; k++) _qacc[k] = (_qacc[k] - 2 * _qd1[k] + _qd0[k]) / (dt * dt);
  for (const p of live) {
    if (p.dead || p.welds.length || p.mass <= 0) continue;
    const g = groundAt(p.curPos[0], p.curPos[2]);
    if (!(p.curPos[1] - g < 1.5)) continue;
    vec3.scale(_qf, _qacc, -p.mass);
    b3.b3Body_ApplyForceToCenter(p.body, _qf, true);
  }
}

export function quakeActive(): number {
  return quakeT < 0 ? 0 : Math.min(1, quakeT / 1.2) * Math.min(1, Math.max(0, (quakeDur - quakeT) / 2.5)) * quakeMag;
}

/** Break everything holding p to the ground anchor (a footing undermined by a crater). */
export function releaseGround(p: Piece): void {
  for (const w of p.welds.slice()) if (w.alive && w.b === null) failWeld(w, 'rupture');
  for (const r of p.rebars.slice()) if (!r.b) killRebar(r, true, false);
}
setTerrainHooks({ unground: releaseGround });

/* ---------------- machining helpers (tools/machining.ts) ---------------- */

/** Net-section loss from a partial cut or drilled holes: every connection of p and its hit points scale by k (0..1). */
export function weakenPiece(p: Piece, k: number): void {
  if (p.dead || !(k > 0) || k >= 1) return;
  for (const w of p.welds.slice()) if (w.alive) scaleWeld(w, k);
  p.hp *= k;
  analysisTouch(p);
  supportDirty = true;
}

/** Jaws or a disc through exposed bars: cuts p's rebar ties anchored within r of point. Returns bars cut. */
export function cutRebarNear(p: Piece, point: Vec3, r: number): number {
  let n = 0;
  for (const bar of p.rebars.slice()) {
    toWorld(_v, bar.a.curPos, bar.a.curRot, bar.la);
    if (vec3.distance(_v, point) > r) continue;
    killRebar(bar, true, true);
    n++;
  }
  return n;
}

/** A kerf's ligament caps what the member can pass on: every connection of p rated above `comp` N in
 *  compression is derated (all modes, proportionally) to it. */
export function limitPiece(p: Piece, comp: number): void {
  if (p.dead || !(comp >= 0)) return;
  let hit = false;
  for (const w of p.welds.slice()) {
    if (!w.alive || w.cap.comp <= comp) continue;
    scaleWeld(w, Math.max(comp, 1) / w.cap.comp);
    hit = true;
  }
  if (!hit) return;
  analysisTouch(p);
  supportDirty = true;
}

/* ---------------- dormant detail (detail.ts) ---------------- */

setDetailHost({
  createPiece: (o) => createPiece(o),
  createWeld,
  jointCaps: (a, b, area) => jointCaps(a, b, area),
  neighbourCaps,
  reweld,
  destroyPiece,
  damagePiece,
  credit,
  setDebris(p, d) { if (p.debris !== d) { p.debris = d; debrisCount += d ? 1 : -1; } },
  clock: () => clock,
  debris: () => debrisCount,
  budget: () => BUDGET,
  burning: () => burning,
  counters,
});
