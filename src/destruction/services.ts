import { vec3, quat, clamp } from 'math';
import type { b3JointId, b3MassData, b3ShapeId } from 'box3d.js';
import type { FixtureKind, MaterialId, MechMotor, PieceSpec, SvcPart, UtilityKind, Vec3, Quat } from '../types';
import { b3, world, ground, CAT, overlapAABB, entityOfShape, stepCount } from '../physics/physics';
import { coverAt, groundAt, dig, mound } from '../terrain/terrain';
import { fx } from '../render/fx';
import { audio } from '../audio/audio';
import { lampLights } from '../render/lights';
import { setPieceHeat } from './batches';
import { flammable } from './materials';
import { explode, heat, ignite, douse, burningPieces, live, releaseGround, type Piece } from './structure';
import * as fields from '../sim/fields/index';
import {
  supplyOf, memberR, ropeR, lampW, device, tripTime, stdRating, arcVolts, arcHolds, ARC_GAP, arcEnergy, arcBlast, contactR, ageOf, dirtOf, leakage, exposedGear,
  gridWeather, stepWeather, stepMagnets, magnets, clearElectrical, U0, U0_HV, HV_RATIO, R_EARTH, BASE_A, A_PER_KW, RC0, RTH, TAU_C, K_OX, OX_DOUBLE,
  TRACK_K, DRY_TAU, type Device,
} from './electrical';

/* Building services: power / gas / water / steam members conduct to same-kind members they touch
   (and power through wires). Conduction is a link graph of its own, not the welds: two service members
   need no joint between them, so a site-wide grid does not tie every building into one solver island.
   Networks are re-flooded from live sources only when the topology, a source or a protective device
   changes, on a 0.25 s tick — never per body per step.

   A joint (link) fails by its material: copper and steel bend at a plastic hinge, weeping and kinking
   (less flow past it) before they tear; cast iron cracks, then snaps; cold PVC / PE splits then shatters,
   and melts through in a fire; a cable stretches and pulls out of its gland. Elbows and tees give first.
   Every pressurised network has a supply pressure and a capacity: open breaks share it, so each extra
   break weakens every jet, and water loses head with height. Consumer units (MCB + RCD) trip on an arcing
   fault, transformer protection on a bolted one; gas meters and governors shut on sustained over-flow.
   Unlit gas vents into the room it leaks in; an arc or flame in a room between the LEL and UEL deflagrates. */

export type Grade = 'ductile' | 'brittle' | 'plastic' | 'cable';

export interface Member {
  kind: UtilityKind;
  fixture: FixtureKind | null;
  part: SvcPart | null;
  grade: Grade;
  bore: number;             // nominal bore (pipes) or supply orifice (sources), m
  source: boolean;
  lamp: boolean;
  glows: boolean;
  frag: boolean;
  on: boolean;
  live: boolean;
  net: number;
  gate: Piece | null;       // nearest protective device (or the source) upstream
  up: Piece | null;         // a device's own upstream device
  flow: number;             // share of full bore reaching here past kinked joints, 0..1
  closed: boolean;          // tripped breaker, shut EFV or valve: live on its line side only
  fault: number;            // gate: seconds of fault current seen
  hit: number;              // gate: fault seen this tick (several arcs on one circuit are one fault)
  over: number;             // gas gate: seconds above its trip flow
  draw: number;             // gate: open area downstream this tick, m²
  scorched: boolean;        // power: insulation has failed in a fire
  hotT: number;             // plastic: seconds above its melting point
  emit: number;
  blown: boolean;
  vented: boolean;
  links: SvcLink[];
  /* power: the circuit (electrical.ts) */
  r: number;                // own conductor loop resistance, Ω
  ez: number;               // loop impedance from the source to here, Ω
  par: Piece | null;        // next member towards the source
  pl: SvcLink | null;       // the joint to it (null across a wire span)
  dev: Device | null;       // protective device (gates)
  ib: number;               // gate: design current downstream, A
  mot: boolean;             // gate: motors downstream
  hv: boolean;              // on the 11 kV side of a substation transformer
  wet: number;              // exposed gear: surface wetness 0..1
  track: number;            // carbon tracking across its surface, 1 = flashover
  fp: Piece | null;         // next member towards the source along the flood (every kind)
  standby: boolean;         // standby generator behind a transfer switch
  run: boolean;             // standby: started and on load
  startT: number;           // standby: seconds its bus has been dead (it starts at START_DELAY) or live again
  batt: number;             // emergency lamp: battery left, s (-1: none)
}

interface Lim { leakD: number; leakA: number; cutD: number; cutA: number }

/** Conducting contact between two same-kind members: the contact point and normal in `a`'s frame, the point in
 * `b`'s frame and their relative rotation when made, to tell when they have come apart or bent. */
export interface SvcLink {
  a: Piece; b: Piece; la: Vec3; lb: Vec3; n: Vec3; q0: Quat; alive: boolean;
  t: number;                // clock when made
  lim: Lim;
  k: number;                // open area past the joint (a kink restricts it)
  sev: number;              // permanent deformation, 0 (sound) .. 1 (about to tear)
  leak: Break | null;
  /* power joints */
  rc: number;               // contact resistance, Ω
  loose: number;            // 0 tight .. 1 barely touching
  ox: number;               // oxidation of the contact faces
  ct: number;               // contact temperature, °C
  i: number;                // load current through it, A
  down: Piece[] | null;     // lamps fed through it
  dl: number;               // drift at the contact on the last step it was watched, m
}

interface Break {
  p: Piece;
  kind: UtilityKind;
  lp: Vec3;
  ld: Vec3;
  t0: number;
  fxT: number;
  auT: number;
  size: number;
  active: boolean;
  area: number;             // orifice, m²
  full: boolean;            // full-bore rupture rather than a weep / crack / split
  link: SvcLink | null;     // a leak at a joint that still holds
  spr: boolean;             // an opened sprinkler head
  lit: boolean;             // gas: burning
  q: number;                // flow, m³/s (real time)
  arcT: number;             // power: longest a drawn arc could last, s (it goes out when its gap outgrows the supply)
  arcing: boolean;
  contact: 0 | 1 | 2;       // power: 0 air, 1 earth / structure, 2 bolted to metal or water
  chk: number;              // step the contact was last checked
  enc: Enclosure | null | undefined;
  gone: boolean;
  ins: boolean;             // power: failed insulation or a flashover, bolted to earth where it stands
  hv: boolean;
  ia: number;               // power: arcing current, A
  ua: number;               // power: arc voltage, V
  vp: number;               // power: speed the parting ends draw the arc out, m/s
  ec: number;               // contact class its arc energy was last assessed at
}

interface Net { kind: UtilityKind; src: Piece; y: number; cap: number; area: number; P: number; u0: number; load: number; S: number }

interface Enclosure { group: string; min: Vec3; max: Vec3; vol: number; gas: number; burnt: number }

export interface Mech {
  joint: b3JointId;
  part: Piece;
  host: Piece | null;
  bound: boolean;           // anchored to the static world as a stand-in for the resting host
  qa: Quat;
  groundAt: Vec3;
  fa: { position: Vec3; quaternion: Quat } | null;   // in the host's frame, from its rest pose
  fb: { position: Vec3; quaternion: Quat };
  forceT: number;
  torqueT: number;
  hinge: boolean;
  axis: Vec3;
  motor: MechMotor | null;
  drive: Drive | null;
  couple: Couple | null;
  lower: number | undefined;
  upper: number | undefined;
  dir: number;
  running: boolean;
  active: boolean;          // stepped every physics step (running, coasting or coupled, near the viewer)
  roped: boolean;
  brakesFailed: boolean;
  ready: number;
  alive: boolean;
  lastOver: number;
  overSteps: number;
  rate: number;
  fric: number;             // bearing / guide / seal / gearbox loss, N·m or N
  roll: number;             // rolling resistance at the current axle load
  dragK: number;            // windage, N·m per (rad/s)²
  brake: number;
  crr: number;
  radius: number;
  w: number;                // measured joint speed along the axis
  ang: number;
  spd: number;              // motor target and torque last sent to the solver
  tq: number;
  mass0: b3MassData | null; // part's own mass data before the geared rotor's inertia was added
  tyre: b3ShapeId | null;   // round road-contact shape of a wheel
  cmd?: number;             // operator's lever, -1..1 of the flow-limited speed; undefined = the machine's own cycle
  near: boolean;            // inside the working range of the viewer (or under an operator)
  hold: boolean;            // a one-way axis at its end stop: valve centred, load held, the part free to sleep
  cyc: Cycle | null;        // the machine's own work cycle for this axis
  spin: Spin | null;        // out of range: a turning rotor drawn turning while its body sleeps
  trips: number;            // electric: overload trips in the last few minutes (a winding cooked three times burns out)
  burnt: number;            // electric: clock the winding burnt out (smoking), 0 = sound
  load: number;             // digging bucket: spoil aboard, m³
  evT: number;              // clock of its last cycle event
}

type Cycle = NonNullable<NonNullable<PieceSpec['mech']>['cycle']>;

/* Beyond the working range a rotor keeps turning on screen at its running speed without a body: its pose is the
   joint's rotation about the pivot from the pose it had when it went to sleep. */
interface Spin { w: number; ang: number; pivot: Vec3; axis: Vec3; pos0: Vec3; rot0: Quat; live: boolean }

type DriveKind = 'electric' | 'diesel' | 'hydraulic';

interface Drive {
  kind: DriveKind;
  wS: [number, number];     // no-load (electric/diesel) or flow-limited (hydraulic) speed, forward / reverse
  Tmax: [number, number];   // breakdown / peak / relief torque (force), forward / reverse
  Tr: number;               // rated torque (force)
  wR: number;               // rated speed
  heat: number;             // electric: thermal image of the winding, (I/Ir)²
  tau: number;
  tripped: boolean;
  idle: number;
  lugT: number;             // diesel: time lugged below idle
  downUntil: number;        // diesel: stalled, cranking again at this clock
  cut: boolean;             // hydraulic: line severed
  tank: number;             // fuel, L
}

interface Couple { driver: Mech; ratio: number; sign: number; limit: number; kind: 'belt' | 'chain' | 'gear'; over: number }

/* ---------------- constants ---------------- */

const IMPLIED: Record<FixtureKind, UtilityKind> = {
  transformer: 'power', generator: 'power', lamp: 'power', motor: 'power',
  gasmain: 'gas', watermain: 'water', boiler: 'steam', radiator: 'steam',
};
const SOURCE: Partial<Record<FixtureKind, true>> = { transformer: true, generator: true, gasmain: true, watermain: true, boiler: true };
const TICK = 0.25;
const MAX_ACTIVE = 16;
const BOILER_BLOW = 350;
const MECH_RANGE = 120;
/* Box3D tests joint thresholds against per-substep peaks, well above the step-averaged force a
   motor applies (measured ~2-4x on a spinning fan); without this every fast fan tears off. */
const SUBSTEP_PEAK = 4;
const MAX_SPIN = 60;         // rad/s: render slerps between steps, faster reads as backwards
const LAMP_LIGHTS = 6;
const DEFAULT_LIGHT = { color: 0xffe2b0, intensity: 1.2, range: 7 };

const DEG = Math.PI / 180;
/* Joint deformation limits, drift in m at the contact and relative rotation in rad: past `leak` the joint weeps
   (and a ductile one kinks), past `cut` it tears open. Ductile copper / steel joints take a plastic hinge of
   tens of degrees; grey cast iron cracks at a couple (strain to failure < 1 %); unplasticised PVC and PE at 20 °C
   split at a few; a cable is flexible and only pulls out of its gland once stretched. */
const LIM: Record<Grade, Lim> = {
  ductile: { leakD: 0.025, leakA: 8 * DEG, cutD: 0.12, cutA: 45 * DEG },
  brittle: { leakD: 0.008, leakA: 2 * DEG, cutD: 0.03, cutA: 6 * DEG },
  plastic: { leakD: 0.015, leakA: 4 * DEG, cutD: 0.045, cutA: 12 * DEG },
  // a cable termination worked loose (strain() loosens a power joint rather than weeping), then pulled out of its gland
  cable: { leakD: 0.015, leakA: Infinity, cutD: 0.25, cutA: Infinity },
};
/* Two ductile lengths still welded together are one bent pipe, however far the yielding weld has let the far
   length move: it weeps and kinks, and only tears open with the weld or once folded right over. */
const BENT: Lim = { leakD: 0.025, leakA: 8 * DEG, cutD: 0.6, cutA: 80 * DEG };
const FIT_WEAK = 0.6;        // elbows and tees concentrate the bending: they give at 60 % of a straight coupling
const GRADE: Partial<Record<MaterialId, Grade>> = {
  copper: 'ductile', steel: 'ductile', metal: 'ductile', aluminum: 'ductile', machine: 'ductile', lamp: 'ductile', pvc: 'plastic',
};

/* Supply: a network's pressure falls as its open area approaches the supply orifice `cap`. Water loses 1 m of
   head per metre it climbs from a 3.5 bar (~35 m) main; gas is held by its governor until the flow outruns it. */
const HEAD = 35;
const A_REF = (Math.PI / 4) * 0.05 * 0.05;           // a 50 mm full bore at full pressure: jet size ~1.4
const CV: Record<UtilityKind, number> = { power: 0, gas: 45, water: 15, steam: 120 };   // Cd·√(2ΔP/ρ), m/s
const SPRINKLER_BORE = 0.015;                         // K80 head orifice
const BULB = 68;                                      // °C, standard-response glass bulb
const BULB_LAG = 1 - Math.exp(-TICK / 6);
const EFV_DELAY = 2.5;                                // s over the trip flow before an EFV / slam-shut closes
/* Gas: a leak's flow goes into the gas field (sim/fields), which holds the room's gas and lights it. Leak
   build-up runs GAS_TIME× real time, as the pool fires do, or a cracked pipe would take an hour to matter. */
const GAS_TIME = 40;

const members = new Set<Piece>();
const sources = new Set<Piece>();
const lamps = new Set<Piece>();
const gates = new Set<Piece>();
const sprinklers = new Set<Piece>();
const breaks: Break[] = [];
const blowouts: { pos: Vec3; fixture: FixtureKind; volume: number }[] = [];
const flicker = new Map<Piece, number>();
const mechs = new Map<number, Mech>();
const svcLinks = new Set<SvcLink>();
const nets: Net[] = [];
const encs = new Map<string, Enclosure | null>();
const badLinks = new Set<SvcLink>();       // power joints loose, oxidised or hot
const wetGear = new Set<Piece>();          // exposed live gear with water on it
const exposed: Piece[] = [];               // live exposed gear, sampled for standing water and rain
const hvGear: Piece[] = [];
const faults: { p: Piece; I: number; leak: number; b: Break | null }[] = [];
let exposedAt = 0;
let pstamp = 0;
let coronaT = 0;
let crackleT = 0;
let linkStep = -1;
const viewer: Vec3 = [0, 1.7, 26];
let topoDirty = true;
let clock = 0;
let tickT = 0;
let lightT = 0;
let lampsLit = 0;
let running = 0;
let activeCount = { power: 0, gas: 0, water: 0, steam: 0 };
const tally = { leaks: 0, ruptures: 0, trips: 0, shut: 0, deflagrations: 0, sprinklers: 0, flashovers: 0, insulation: 0, contactFires: 0, surges: 0,
  dug: 0, strokes: 0, burnouts: 0, tipped: 0, hoses: 0, atsStarts: 0, hammers: 0, alarms: 0 };

const _v: Vec3 = [0, 0, 0], _d: Vec3 = [0, 0, 0], _w: Vec3 = [0, 0, 0], _c: Vec3 = [0, 0, 0];

/* Seeded per world, so a scenario plays out the same way twice (tests, replays). */
let seed = 1;
function rnd(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const _q: Quat = [0, 0, 0, 1];

export function setServiceViewer(pos: ArrayLike<number>): void {
  viewer[0] = pos[0]; viewer[1] = pos[1]; viewer[2] = pos[2];
}
export const svcViewerPos: Readonly<Vec3> = viewer;

/* ---------------- membership ---------------- */

export function memberFor(spec: PieceSpec, frag: boolean): Member | null {
  const fixture = spec.fixture ?? null;
  const kind = spec.util ?? (fixture ? IMPLIED[fixture] : spec.mat === 'lamp' ? 'power' : undefined);
  if (!kind) return null;
  const lamp = !frag && (fixture === 'lamp' || spec.mat === 'lamp');
  const s = [...spec.size].sort((x, y) => x - y);
  const source = !frag && !!fixture && !!SOURCE[fixture];
  return {
    kind, fixture, part: frag ? null : spec.svcPart ?? null, grade: kind === 'power' ? 'cable' : GRADE[spec.mat] ?? 'brittle',
    bore: spec.bore ?? (source ? supplyBore(kind, spec) : s[1] * 0.7), source, lamp, glows: lamp && spec.mat === 'lamp', frag,
    on: false, live: false, net: -1, gate: null, up: null, flow: 0, closed: false, fault: 0, hit: 0, over: 0, draw: 0, scorched: false, hotT: 0,
    emit: 0, blown: false, vented: false, links: [],
    r: 0, ez: Infinity, par: null, pl: null, dev: null, ib: 0, mot: false, hv: false, wet: 0, track: 0,
    fp: null, standby: source && fixture === 'generator' && !!spec.standby, run: false, startT: 0,
    batt: lamp && spec.emergency ? spec.emergency * 3600 : -1,
  };
}

/* An unannotated source: a wall meter or stopcock feeds one house, anything bigger a district. */
function supplyBore(kind: UtilityKind, spec: PieceSpec): number {
  const v = spec.size[0] * spec.size[1] * spec.size[2];
  if (kind === 'gas') return v < 1 ? 0.012 : 0.1;
  if (kind === 'water') return v < 0.5 ? 0.02 : 0.15;
  if (kind === 'steam') return v < 1.5 ? 0.025 : 0.08;
  return 0;
}

const isGate = (m: Member) => m.source || m.part === 'breaker' || m.part === 'fuse' || m.part === 'efv' || m.part === 'valve';

export function svcAdd(p: Piece): void {
  const m = p.svc!;
  members.add(p);
  if (m.source) sources.add(p);
  if (m.lamp) lamps.add(p);
  if (isGate(m)) gates.add(p);
  if (m.part === 'sprinkler') sprinklers.add(p);
  if (m.kind === 'power') {
    m.r = memberR(p);
    if (p.root.spec.magnet && !m.frag) magnets.add(p);
  }
  topoDirty = true;
}

export function svcRemove(p: Piece, record: boolean): void {
  if (p.svc) for (const l of p.svc.links.slice()) killLink(l, record);
  members.delete(p);
  sources.delete(p);
  lamps.delete(p);
  gates.delete(p);
  sprinklers.delete(p);
  flicker.delete(p);
  magnets.delete(p);
  wetGear.delete(p);
  topoDirty = true;
}

function toLocal(out: Vec3, p: Piece, w: ArrayLike<number>): Vec3 {
  quat.conjugate(_q, p.curRot);
  vec3.set(out, w[0] - p.curPos[0], w[1] - p.curPos[1], w[2] - p.curPos[2]);
  return vec3.transformQuat(out, out, _q) as Vec3;
}

function toWorld(out: Vec3, p: Piece, l: Vec3): Vec3 {
  vec3.transformQuat(out, l, p.curRot);
  return vec3.add(out, out, p.curPos) as Vec3;
}

function limFor(a: Member, b: Member): Lim {
  const A = LIM[a.grade], B = LIM[b.grade];
  const w = a.part === 'fitting' || b.part === 'fitting' ? FIT_WEAK : a.fixture || b.fixture ? 0.8 : 1;
  return { leakD: Math.min(A.leakD, B.leakD) * w, leakA: Math.min(A.leakA, B.leakA) * w, cutD: Math.min(A.cutD, B.cutD) * w, cutA: Math.min(A.cutA, B.cutA) * w };
}

/* A supply into a machine that moves on its own (a motor, an arm, a slewing crane) is made through a flexible tail
   and gland: the machine rocking on its mounts or swinging its parts takes up the slack, it does not work the
   termination loose. Only pulling it out (the cable's cut drift) breaks it. */
const FLEX: Lim = { leakD: 0.2, leakA: Infinity, cutD: 0.25, cutA: Infinity };
function flexTail(a: Piece, b: Piece): boolean {
  if (a.svc!.kind !== 'power') return false;
  const moving = (p: Piece) => p.svc!.fixture === 'motor' || !!p.root.spec.mech || !!p.mechs?.length;
  return moving(a) || moving(b);
}

/** Two service members touch at `pt` (world, normal `n` from a to b): same-kind members conduct. */
export function svcLink(a: Piece, b: Piece, pt: Vec3, n: Vec3): void {
  const ma = a.svc, mb = b.svc;
  if (!ma || !mb || a === b || ma.kind !== mb.kind || a.dead || b.dead) return;
  for (const l of ma.links) if (l.a === b || l.b === b) return;
  const qa = quat.conjugate([0, 0, 0, 1], a.curRot) as Quat;
  const l: SvcLink = {
    a, b, la: toLocal([0, 0, 0], a, pt), lb: toLocal([0, 0, 0], b, pt), n: vec3.transformQuat([0, 0, 0], n, qa) as Vec3,
    q0: quat.multiply(qa, qa, b.curRot) as Quat, alive: true, t: clock, lim: flexTail(a, b) ? FLEX : limFor(ma, mb), k: 1, sev: 0, leak: null,
    rc: RC0, loose: 0, ox: 0, ct: 20, i: 0, down: null, dl: -1,
  };
  if (ma.kind === 'power') {
    const ox = Math.min(0.6, Math.max(ageOf(a).years, ageOf(b).years) / 200);
    if (ox > 0) { l.ox = ox; l.rc = contactR(0, ox); }
  }
  ma.links.push(l);
  mb.links.push(l);
  svcLinks.add(l);
  topoDirty = true;
}

function killLink(l: SvcLink, record: boolean): void {
  if (!l.alive) return;
  l.alive = false;
  svcLinks.delete(l);
  badLinks.delete(l);
  if (l.leak) { l.leak.gone = true; l.leak = null; }
  for (const p of [l.a, l.b]) {
    const ls = p.svc?.links, i = ls ? ls.indexOf(l) : -1;
    if (i >= 0) ls!.splice(i, 1);
  }
  toWorld(_w, l.a, l.la);
  vec3.transformQuat(_c, l.n, l.a.curRot);
  svcLinkLost(l.a, l.b, [_w[0], _w[1], _w[2]], [_c[0], _c[1], _c[2]], record);
}

/* Links whose ends moved since the last look: bent, pulled apart or twisted off. The moving ones are also watched every
   step until the next tick, so an impact that pulls a joint apart and lets it spring back between ticks still tears it. */
const watch: SvcLink[] = [];
function checkLinks(): void {
  watch.length = 0;
  for (const l of svcLinks) {
    if (l.a.movedStep <= linkStep && l.b.movedStep <= linkStep) continue;
    if (watch.length < 512) { l.dl = -1; watch.push(l); }
    toWorld(_v, l.a, l.la);
    toWorld(_d, l.b, l.lb);
    const d = vec3.distance(_v, _d);
    const q = quat.multiply(_q, quat.conjugate(_q, l.a.curRot), l.b.curRot);
    const th = 2 * Math.acos(Math.min(1, Math.abs(quat.dot(q, l.q0))));
    const L = warmLim(l);
    if (d > L.cutD || th > L.cutA) { killLink(l, true); continue; }
    if (d > L.leakD || th > L.leakA) strain(l, clamp(Math.max((d - L.leakD) / (L.cutD - L.leakD), (th - L.leakA) / (L.cutA - L.leakA)), 0, 1));
  }
  linkStep = stepCount;
}

/* A still-welded bent pipe may drift as far as its yielding weld lets it creep, but a coupling snatched apart at speed
   (an impact stretching the joint faster than plastic flow can follow) pulls out past a plain joint's tear drift. */
const SNATCH = 0.5;          // m/s
function stepLinks(dt: number): void {
  for (const l of watch) {
    if (!l.alive || (l.a.movedStep !== stepCount && l.b.movedStep !== stepCount)) continue;
    toWorld(_v, l.a, l.la);
    toWorld(_d, l.b, l.lb);
    const d = vec3.distance(_v, _d), L = warmLim(l);
    const fast = l.dl >= 0 && (d - l.dl) / dt > SNATCH;
    l.dl = d;
    if (d > L.cutD || (L === BENT && fast && d > LIM.ductile.cutD)) killLink(l, true);
  }
}

/* Warm PVC / PE goes soft and bends like copper instead of splitting. */
function warmLim(l: SvcLink): Lim {
  const ga = l.a.svc!.grade, gb = l.b.svc!.grade;
  if (ga === 'ductile' && gb === 'ductile') {
    for (const w of l.a.welds) if (w.alive && (w.a === l.b || w.b === l.b)) return BENT;
    return l.lim;
  }
  if (ga !== 'plastic' && gb !== 'plastic') return l.lim;
  return Math.max(l.a.temp, l.b.temp) > 45 ? LIM.ductile : l.lim;
}

/* A joint deformed past its leak limit: it weeps (and a ductile one kinks, restricting the flow past it). The
   deformation is permanent, so the leak only ever grows. */
function strain(l: SvcLink, s: number): void {
  if (l.a.svc!.kind === 'power') { loosen(l, s); return; }
  if (l.leak && s <= l.sev + 0.02) return;
  l.sev = Math.max(l.sev, s);
  const a = l.a.svc!, b = l.b.svc!;
  const g = a.grade === 'ductile' && b.grade === 'ductile' ? 'ductile' : a.grade === 'plastic' || b.grade === 'plastic' ? 'plastic' : 'brittle';
  const bore = Math.min(a.bore, b.bore);
  const area = (g === 'ductile' ? 0.02 + 0.08 * l.sev : g === 'brittle' ? 0.06 + 0.1 * l.sev : 0.1 + 0.12 * l.sev) * (Math.PI / 4) * bore * bore;
  if (g === 'ductile') {
    const k = 1 - 0.75 * l.sev;
    if (Math.abs(k - l.k) > 0.05) { l.k = k; topoDirty = true; }
  }
  if (l.leak) { l.leak.area = area; return; }
  toWorld(_w, l.a, l.la);
  vec3.transformQuat(_c, l.n, l.a.curRot);
  /* a split sprays out sideways from the joint */
  vec3.cross(_d, _c, Math.abs(_c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  if (vec3.length(_d) < 1e-3) vec3.set(_d, 0, 1, 0);
  const bk = addBreak(l.a, _w, _d, area, false);
  if (bk) { bk.link = l; l.leak = bk; tally.leaks++; }
}

/* A same-kind connection was lost: each surviving end becomes an open break, venting (or arcing)
   along the old contact normal for as long as its side of the network stays live. A wire's far end
   breaks where it is (`posB`), not at the near insulator. */
export function svcLinkLost(a: Piece, b: Piece, pos: Vec3, n: Vec3, record: boolean, posB?: Vec3): void {
  topoDirty = true;
  if (!record) return;
  for (const [p, s] of [[a, 1], [b, -1]] as const) {
    if (p.dead || breaks.length > 400) continue;
    vec3.set(_d, n[0] * s, n[1] * s, n[2] * s);
    const m = p.svc!, o = (p === a ? b : a).svc;
    const bore = o ? Math.min(m.bore, o.bore) : m.bore;
    if (addBreak(p, s < 0 && posB ? posB : pos, _d, (Math.PI / 4) * bore * bore, true)) tally.ruptures++;
  }
}

function addBreak(p: Piece, pos: Vec3, dir: Vec3, area: number, full: boolean): Break | null {
  const m = p.svc!;
  const lp = b3.b3Body_GetLocalPoint([0, 0, 0], p.body, pos) as Vec3;
  quat.conjugate(_q, p.curRot);
  const ld = vec3.transformQuat([0, 0, 0], dir, _q) as Vec3;
  vec3.normalize(ld, ld);
  if (!Number.isFinite(ld[0])) vec3.set(ld, 0, 1, 0);
  /* a torn steel or cast-iron main can strike its own spark; a hot pipe lights what it lets out */
  const lit = m.kind === 'gas' && (p.temp > 450 || (full && (p.mat === 'steel' || p.mat === 'castiron') && rnd() < 0.15));
  const b: Break = { p, kind: m.kind, lp, ld, t0: clock, fxT: rnd() * 0.1, auT: rnd() * 0.25, size: 0, active: false,
    area, full, link: null, spr: false, lit, q: 0, arcT: m.kind === 'power' && m.on ? 3 : 0, arcing: false,
    contact: 0, chk: -1, enc: undefined, gone: false, ins: false, hv: m.hv, ia: 0, ua: 0, vp: 0.1 + rnd() * 0.2, ec: -1 };
  breaks.push(b);
  return b;
}

/* Heavy damage or destruction of a source fixture: arc flash, fireball or steam explosion. */
export function svcHarm(p: Piece, fatal: boolean): void {
  const m = p.svc;
  if (!m || !m.source || m.blown || (!fatal && p.damage < p.hp * 0.5)) return;
  m.blown = true;
  topoDirty = true;
  blowouts.push({ pos: [p.curPos[0], p.curPos[1], p.curPos[2]], fixture: m.fixture!, volume: p.root.volume });
}

function sourceLive(p: Piece): boolean {
  const m = p.svc!;
  return !p.dead && !m.blown && !m.closed && (!m.standby || m.run) && p.damage < p.hp * 0.5 && (m.fixture !== 'boiler' || p.temp < BOILER_BLOW);
}

/* ---------------- protection & isolation ---------------- */

/* rcd: a consumer unit's MCBs and RCD open on any earth fault; fuse: a cut-out or feeder fuse blows on a bolted fault
   only, quickly; relay: transformer protection, bolted faults only, graded slower so the fuses nearer the fault go first */
type GateKind = 'rcd' | 'fuse' | 'relay' | 'efv' | 'valve';
function gateKind(p: Piece): GateKind {
  const m = p.svc!;
  if (m.part === 'valve') return 'valve';
  if (m.kind === 'power') return m.part === 'breaker' || (m.source && p.root.volume < 0.5) ? 'rcd' : m.part === 'fuse' ? 'fuse' : 'relay';
  return m.kind === 'gas' ? 'efv' : 'valve';
}

/** Open a protective device or shut a valve (or reset / reopen it): its downstream side goes dead. */
export function svcIsolate(p: Piece, closed: boolean): boolean {
  const m = p.svc;
  if (!m || !isGate(m) || m.closed === closed) return false;
  m.closed = closed;
  m.fault = 0;
  m.over = 0;
  if (m.dev) { m.dev.H = 0; m.dev.armed = false; }
  if (m.source) m.live = sourceLive(p);
  topoDirty = true;
  return true;
}

function trip(g: Piece): void {
  if (!svcIsolate(g, true)) return;
  const k = gateKind(g);
  if (k === 'efv') tally.shut++; else tally.trips++;
  audio.snap(g.curPos, k === 'relay' ? 0.5 : 0.15);
}

/* A live power break draws (U0 − Uarc) / Z through the loop impedance to it: an arc against metal or water across a
   short gap, a cable end parting in air along an arc that lengthens until it goes out, and a live end on damp masonry
   or soil only what the earth path lets through (enough for an RCD, nothing like enough for a fuse). */
function faultAt(b: Break): void {
  const m = b.p.svc!, n = nets[m.net];
  b.arcing = false;
  if (!n || n.kind !== 'power') return;
  const u0 = b.hv ? U0_HV : n.u0, z = Math.max(Number.isFinite(m.ez) ? m.ez : 0.05, 1e-3);
  let I: number, leak: number;
  if (b.contact === 1) { I = u0 / (z + R_EARTH); leak = I; b.ua = 0; }
  else {
    const drawn = b.contact === 0 && !b.ins;
    const U = arcVolts(drawn ? 5 + 1000 * b.vp * (clock - b.t0) : ARC_GAP, b.hv);
    if (drawn && !arcHolds(U, u0)) { b.arcT = 0; return; }
    b.ua = U;
    I = Math.max(0, (u0 - U) / z);
    leak = b.contact === 2 ? I : 0.3 * I;
  }
  b.arcing = I > 0;
  b.ia = I;
  if (b.arcing) faults.push({ p: b.p, I: b.hv ? I * HV_RATIO : I, leak, b });
}

/* Insulation failed where it stands (heat, crushing, a flashover): a bolted fault to earth that arcs until cleared. */
function insulationFault(p: Piece, flash: boolean): void {
  const m = p.svc!;
  if (!m.on || p.dead) return;
  for (const b of breaks) if (b.ins && b.p === p && !b.gone) return;
  const b = addBreak(p, [p.curPos[0], p.curPos[1], p.curPos[2]], [0, 1, 0], 0, false);
  if (!b) return;
  b.ins = true;
  b.contact = 2;
  b.arcT = 0;
  if (flash) tally.flashovers++; else tally.insulation++;
  fx.arc(p.curPos, flash ? 1.2 : 0.6);
  audio.arc(p.curPos, flash ? 1 : 0.6);
}

/* ---------------- network flood ---------------- */

const queue: Piece[] = [];
function recompute(): void {
  topoDirty = false;
  for (const p of members) { const m = p.svc!; m.on = false; m.net = -1; m.gate = null; m.up = null; m.flow = 0; m.ez = Infinity; m.par = null; m.pl = null; m.ib = 0; m.mot = false; m.fp = null; }
  nets.length = 0;
  /* the grid (and every ordinary source) claims its members first: a standby set only takes what is left dead */
  for (const s of [...sources].sort((a, b) => +a.svc!.standby - +b.svc!.standby)) {
    const sm = s.svc!;
    if (sm.net >= 0 || !sm.live) continue;
    const net = nets.length;
    nets.push({ kind: sm.kind, src: s, y: s.curPos[1], cap: (Math.PI / 4) * sm.bore * sm.bore, area: 0, P: 1, u0: U0, load: 0, S: 0 });
    sm.net = net; sm.on = true; sm.gate = s; sm.flow = 1;
    queue.length = 0;
    queue.push(s);
    /* breadth first, so each member takes the nearest device upstream; a kinked joint lowers what passes it,
       and a better path found later raises it again */
    for (let h = 0; h < queue.length; h++) {
      const p = queue[h], pm = p.svc!;
      if (pm.closed && p !== s) continue;
      for (const l of pm.links) {
        const o = l.a === p ? l.b : l.a, om = o.svc;
        if (!om || om.kind !== sm.kind) continue;
        const f = Math.min(pm.flow, l.k);
        if (om.net >= 0) {
          if (om.net === net && f > om.flow + 0.05) { om.flow = f; om.fp = p; queue.push(o); }
          continue;
        }
        om.net = net; om.on = true; om.flow = f; om.fp = p;
        if (isGate(om)) { om.gate = o; om.up = pm.gate; } else om.gate = pm.gate;
        queue.push(o);
      }
      if (sm.kind === 'power') for (const r of p.ropes) {
        if (r.kind !== 'wire') continue;
        const o = r.a === p ? r.b : r.a, om = o.svc;
        if (!om || om.net >= 0 || om.kind !== 'power') continue;
        om.net = net; om.on = true; om.flow = 1; om.fp = p;
        if (isGate(om)) { om.gate = o; om.up = pm.gate; } else om.gate = pm.gate;
        queue.push(o);
      }
    }
  }
  solveCircuits();
  let down: Piece | null = null, dd = Infinity;
  for (const p of lamps) {
    const m = p.svc!;
    if (m.batt > 0 && !m.on && !m.blown) { if (!flicker.has(p)) setEmit(p, EMERG); continue; }
    if (m.on && !m.blown && m.emit !== 1 && !flicker.has(p)) setEmit(p, 1);
    else if ((!m.on || m.blown) && m.emit > 0 && !flicker.has(p)) {
      flicker.set(p, 0.25 + rnd() * 0.35);
      const d = vec3.squaredDistance(p.curPos, viewer);
      if (d < dd) { dd = d; down = p; }
    }
  }
  if (down) audio.powerDown(down.curPos);
  for (const p of members) {
    const m = p.svc!;
    if (m.frag && m.on && !m.vented) {
      m.vented = true;
      const l = m.links[0];
      if (!l) continue;
      toWorld(_w, l.a, l.la);
      vec3.sub(_d, p.curPos, _w);
      if (vec3.length(_d) < 1e-3) vec3.set(_d, 0, 1, 0);
      vec3.normalize(_d, _d);
      vec3.scaleAndAdd(_v, p.curPos, _d, Math.cbrt(p.volume) * 0.5);
      addBreak(p, _v, _d, (Math.PI / 4) * m.bore * m.bore, true);
    }
  }
}

/* An emergency luminaire on its battery runs its lamp at a fraction of its mains output (the inverter's rating). */
const EMERG = 0.35;
const lampLevel = (m: Member): number => m.blown ? 0 : m.on ? 1 : m.batt > 0 ? EMERG : 0;

function setEmit(p: Piece, k: number): void {
  const m = p.svc!;
  m.emit = k;
  if (m.glows) setPieceHeat(p.gfx, k);
}

/* ---------------- circuits ---------------- */

/* Each power network as a radial circuit: the loop impedance from its source to every member (source %Z, each
   conductor's resistance, every joint's contact resistance, overhead spans), shortest path first; the load current
   each joint carries (lamps, running motors, the unmodelled load behind each consumer unit); and a protective device
   for each gate, sized for what it feeds, downstream devices smaller than those above them. */
const cq: Piece[] = [];
const upIn = new Map<Piece, number>();
const netBig: boolean[] = [];
function solveCircuits(): void {
  for (const l of svcLinks) if (l.a.svc!.kind === 'power') { l.i = 0; l.down = null; }
  exposed.length = 0;
  hvGear.length = 0;
  netBig.length = 0;
  let any = false;
  for (let ni = 0; ni < nets.length; ni++) {
    const n = nets[ni];
    netBig.push(false);
    if (n.kind !== 'power') continue;
    any = true;
    const s = n.src, sm = s.svc!, sup = supplyOf(s);
    n.u0 = sup.u0; n.S = sup.S; n.load = 0;
    netBig[ni] = sup.big && sm.fixture === 'transformer';
    sm.ez = sup.z;
    cq.length = 0;
    cq.push(s);
    for (let h = 0; h < cq.length && h < 50000; h++) {
      const p = cq[h], pm = p.svc!;
      if (pm.closed && p !== s) continue;
      for (const l of pm.links) {
        const o = l.a === p ? l.b : l.a, om = o.svc;
        if (!om || om.net !== ni) continue;
        const z = pm.ez + (pm.r + om.r) / 2 + l.rc;
        if (z < om.ez - 1e-9) { om.ez = z; om.par = p; om.pl = l; cq.push(o); }
      }
      for (const r of p.ropes) {
        if (r.kind !== 'wire') continue;
        const o = r.a === p ? r.b : r.a, om = o.svc;
        if (!om || om.net !== ni) continue;
        const z = pm.ez + (pm.r + om.r) / 2 + ropeR(r.rest);
        if (z < om.ez - 1e-9) { om.ez = z; om.par = p; om.pl = null; cq.push(o); }
      }
    }
  }
  if (!any) return;
  for (const p of members) {
    const m = p.svc!;
    if (m.kind !== 'power' || m.net < 0) continue;
    const n = nets[m.net], s = n.src;
    /* the 11 kV side of a pad transformer: bushings, droppers and line insulators above its tank */
    m.hv = netBig[m.net] && p.curPos[1] > s.curPos[1] + s.root.spec.size[1] / 2 + 0.05
      && Math.hypot(p.curPos[0] - s.curPos[0], p.curPos[2] - s.curPos[2]) < 1.6 && (p.mat === 'ceramic' || p.mat === 'copper');
    if (m.hv) { m.ez = 0.48; hvGear.push(p); }
    if (!m.source && !m.lamp && exposedGear(p)) exposed.push(p);
    if (m.lamp && !m.blown) addLoad(p, lampW(p) / U0, false, n);
    else if (m.part === 'breaker' && !m.closed) addLoad(p, BASE_A, false, n);
  }
  for (const mc of mechs.values()) {
    const d = mc.drive, h = mc.host, hm = h?.svc;
    if (!d || d.kind !== 'electric' || !mc.alive || !hm || hm.kind !== 'power' || hm.net < 0) continue;
    addLoad(h!, (mc.motor!.kW ?? (d.Tr * d.wR) / 900) * A_PER_KW, true, nets[hm.net]);
  }
  /* devices, farthest first, so each fuse knows the largest device it feeds */
  upIn.clear();
  const gl = [...gates].filter((g) => g.svc!.kind === 'power' && g.svc!.net >= 0).sort((a, b) => b.svc!.ez - a.svc!.ez);
  for (const g of gl) {
    const m = g.svc!;
    if (!m.dev) m.dev = makeDevice(g, upIn.get(g) ?? 0, netBig[m.net]);
    if (m.up) upIn.set(m.up, Math.max(upIn.get(m.up) ?? 0, m.dev.In));
  }
}

function addLoad(p: Piece, I: number, motor: boolean, n: Net): void {
  n.load += I;
  for (let q: Piece | null = p, h = 0; q && h < 2000; q = q.svc!.par, h++) {
    const qm = q.svc!;
    if (qm.pl) qm.pl.i += I;
    if (isGate(qm)) { qm.ib += I; if (motor) qm.mot = true; }
  }
}

function makeDevice(g: Piece, childIn: number, big: boolean): Device {
  const m = g.svc!, k = gateKind(g);
  // transformer protection: picks up at twice full load, graded above the LV fuses it backs up
  if (k === 'relay') return device('EI', 2 * (supplyOf(g).S / (Math.sqrt(3) * 400)), false);
  if (k === 'rcd') return device(m.mot ? 'C' : 'B', stdRating(Math.min(100, Math.max(32, 1.25 * m.ib))), true);
  // a service cut-out feeds a consumer unit; a feeder way (>= 250 A off a substation board) feeds cut-outs
  const In = childIn > 0 ? stdRating(Math.max(1.6 * childIn, 2 * m.ib, 100, big && childIn >= 63 ? 250 : 0, big && m.up?.svc?.source ? 400 : 0))
    : stdRating(Math.max(10, 2 * m.ib, big && m.up?.svc?.source ? 400 : 0));
  return device('gG', In, false);
}

/* ---------------- tick ---------------- */

/** Accumulated per-step network time, machines excluded (debug overlay, benchmarks). */
export const svcCost = { ms: 0, steps: 0 };

export function servicesStep(dt: number): void {
  const t0 = performance.now();
  clock += dt;
  if (!fieldHooked) { fieldHooked = true; fields.onDeflagration(roomDeflagrated); }
  if (blowouts.length) for (const b of blowouts.splice(0)) blowout(b.pos, b.fixture, b.volume);
  tickT += dt;
  if (tickT >= TICK) { tickT -= TICK; tick(); }
  if (watch.length) stepLinks(dt);
  stepBreaks(dt);
  stepMagnets();
  stepWeather(dt);
  if (flicker.size) {
    for (const [p, t] of flicker) {
      const left = t - dt;
      if (left <= 0 || p.dead) {
        flicker.delete(p);
        if (!p.dead) setEmit(p, lampLevel(p.svc!));
      } else {
        flicker.set(p, left);
        setEmit(p, rnd() < 0.45 ? 0 : 0.35 + rnd() * 0.65);
      }
    }
    lightT -= dt;
    if (lightT <= 0) { lightT = 0.05; pushLights(); }
  }
  svcCost.ms += performance.now() - t0;
  svcCost.steps++;
  if (!mechList.length && spinning.length) stepSpins(dt);
  if (carried.size) stepCarry();
  if (mechList.length) {
    const t1 = performance.now();
    for (const m of mechList) stepMech(m, dt);
    if (spinning.length) stepSpins(dt);
    mechCost.ms += performance.now() - t1;
    mechCost.steps++;
  }
}

/** Accumulated per-step machine update time (debug overlay, benchmarks). */
export const mechCost = { ms: 0, steps: 0 };

function tick(): void {
  for (const s of sources) {
    const m = s.svc!;
    if (m.fixture === 'boiler' && !m.blown && !s.dead && s.temp >= BOILER_BLOW) svcHarm(s, true);
    const live = sourceLive(s);
    if (live !== m.live) { m.live = live; topoDirty = true; }
    if (live && m.fixture === 'boiler' && s.temp < 160) heat(s, 160 - s.temp);
  }
  checkLinks();
  thermal();
  if (topoDirty) recompute();
  standbys();
  batteries();
  contacts();
  tracking();
  corona();
  updateBreaks();
  protect();
  if (sprinklers.size) sprinklerHeat();
  gasRooms();
  alarmsTick();
  pushLights();
  updateMechs();
  updatePools();
  hum();
}

/* Heat on the services: steam members warm to their line temperature; PVC / PE softens and melts through; cable
   insulation smoulders, then fails to earth; burning plastic pours black smoke. */
function thermal(): void {
  let smoke = 3;
  for (const p of members) {
    const m = p.svc!;
    if (m.kind === 'steam' && m.on && !m.source) {
      const t = Math.min(m.fixture === 'radiator' ? 70 : 95, (p.pm.thermal.soften?.[0] ?? 999) - 5);
      if (p.temp < t - 3) heat(p, t - p.temp);
      continue;
    }
    /* a cable crushed under debris: its insulation splits and the cores short to the armour */
    if (m.kind === 'power' && !m.fixture && !m.scorched && m.on && p.damage > 0.35 * p.hp) { m.scorched = true; insulationFault(p, false); }
    if (p.temp < 120) continue;
    if (p.burning && p.mat === 'pvc' && smoke > 0 && rnd() < 0.3) { smoke--; fx.dust(p.curPos, 0.5, 0x161616); }
    /* PVC / PE sags, then its joints and walls melt through after a few seconds in the flames */
    if (m.grade === 'plastic' && m.links.length && p.temp > (p.pm.thermal.soften?.[0] ?? 75) + 40 && (m.hotT += TICK) > 3) {
      for (const l of m.links.slice()) killLink(l, true);
      continue;
    }
    if (m.kind !== 'power' || m.fixture) continue;
    if (!p.burning && smoke > 0 && rnd() < 0.15) { smoke--; fx.dust(p.curPos, 0.3, 0x5a5652); }
    /* PVC insulation breaks down between ~150 and 250 °C (each length at its own point) and the cores fault to earth */
    if (p.temp > 150 + ((p.id * 7919) % 100) && !m.scorched) {
      m.scorched = true;
      if (m.on) insulationFault(p, false);
    }
  }
}

/* ---------------- standby supplies ---------------- */

/* Automatic transfer: a standby set watches the bus it is wired to. Dead for START_DELAY (the NFPA 110 type-10 start:
   crank, run up, voltage and frequency settle) and the set takes the load; once the normal supply is back on the bus
   for RETRANSFER s it hands back and stops. The grid claims its members first in the flood, so the set only ever
   feeds what the grid is not feeding. */
const START_DELAY = 10, RETRANSFER = 5;
function standbys(): void {
  for (const s of sources) {
    const m = s.svc!;
    if (!m.standby || s.dead || m.blown || !m.links.length) continue;
    let bus = false;
    for (const l of m.links) {
      const o = (l.a === s ? l.b : l.a).svc!;
      if (o.on && nets[o.net]?.src !== s) { bus = true; break; }
    }
    if (!m.run) {
      if (bus) { m.startT = 0; continue; }
      if (m.startT === 0) audio.utility('crank', s.curPos);
      m.startT += TICK;
      if (m.startT < START_DELAY) continue;
      m.run = true;
      m.startT = 0;
      tally.atsStarts++;
      audio.utility('genstart', s.curPos);
      fx.dust([s.curPos[0], s.curPos[1] + 1, s.curPos[2]], 0.8, 0x2a2a2a);
    } else if (bus) {
      if ((m.startT += TICK) < RETRANSFER) continue;
      m.run = false;
      m.startT = 0;
    } else { m.startT = 0; continue; }
    m.live = sourceLive(s);
    topoDirty = true;
  }
}

/* Emergency luminaires: on mains the battery charges (24 h from flat, as BS EN 60598-2-22); off it the lamp runs on the
   battery for its rated duration, then goes out. */
function batteries(): void {
  for (const p of lamps) {
    const m = p.svc!, full = (p.root.spec.emergency ?? 0) * 3600;
    if (m.batt < 0 || m.blown) continue;
    if (m.on) { m.batt = Math.min(full, m.batt + (TICK * full) / 86400); continue; }
    if (m.batt <= 0) continue;
    m.batt -= TICK;
    if (m.batt <= 0) { m.batt = 0; if (!flicker.has(p)) setEmit(p, 0); }
  }
}

/* ---------------- operating the services ---------------- */

const GAUGE: Record<UtilityKind, number> = { power: 0, gas: 2100, water: 3.5e5, steam: 1e6 };   // Pa at the source
const RHO: Record<UtilityKind, number> = { power: 0, gas: 0.8, water: 1000, steam: 5 };

/* Pressure at a member: the network's supply share, less the friction head lost (Darcy, f 0.02) along its path from the
   source in carrying the flow of every open break beyond each length, and for water the static head it has climbed. */
function pressureAt(p: Piece): number {
  const m = p.svc!, n = nets[m.net];
  if (!n || n.kind === 'power' || !m.on) return 0;
  const Q = new Map<Piece, number>();
  for (const b of breaks) {
    if (b.gone || b.p.svc!.net !== m.net || b.q <= 0) continue;
    for (let q: Piece | null = b.p, h = 0; q && h < 400; q = q.svc!.fp, h++) Q.set(q, (Q.get(q) ?? 0) + b.q);
  }
  let loss = 0;
  for (let q: Piece | null = p, h = 0; q && h < 400; q = q.svc!.fp, h++) {
    const f = Q.get(q);
    if (!f) continue;
    const D = Math.max(0.01, q.svc!.bore), v = f / ((Math.PI / 4) * D * D), L = Math.max(...q.root.spec.size);
    loss += 0.02 * (L / D) * 0.5 * RHO[n.kind] * v * v;
  }
  let P = n.P - loss / GAUGE[n.kind];
  if (n.kind === 'water') P -= (p.curPos[1] - n.y) / HEAD;
  return clamp(P, 0, 1);
}

/* Members downstream of a gate: everything whose own chain of devices passes through it. */
function fedBy(g: Piece): { members: number; lamps: number; motors: number; heads: number; consumers: number } {
  const out = { members: 0, lamps: 0, motors: 0, heads: 0, consumers: 0 };
  const gm = g.svc!;
  for (const p of members) {
    const m = p.svc!;
    if (p === g || m.kind !== gm.kind) continue;
    let hit = false;
    if (m.on) { for (let q = m.gate, h = 0; q && h < 8; q = q.svc!.up, h++) if (q === g) { hit = true; break; } }
    else if (gm.closed || !gm.on) for (let q: Piece | null = p, h = 0; q && h < 400; q = q.svc!.fp, h++) if (q === g) { hit = true; break; }
    if (!hit) continue;
    out.members++;
    if (m.lamp) out.lamps++;
    if (m.fixture === 'motor') out.motors++;
    if (m.part === 'sprinkler') out.heads++;
    if (m.fixture || m.part === 'sprinkler') out.consumers++;
  }
  return out;
}

/** What a player aiming at a service member is told: kind, whether it is live, its pressure or voltage, what it is and
    what it feeds, and what a hand on it would do. */
export function svcInfo(p: Piece): { kind: UtilityKind; live: boolean; title: string; detail: string; action: string | null } | null {
  const m = p.svc;
  if (!m || p.dead) return null;
  const k = m.kind, n = nets[m.net];
  const what = m.source ? (m.standby ? 'standby generator' : ({ transformer: k === 'power' && p.root.volume < 0.5 ? 'consumer unit' : 'transformer', generator: 'generator', gasmain: 'gas supply', watermain: 'water supply', boiler: 'boiler' } as Record<string, string>)[m.fixture!] ?? 'supply')
    : m.part === 'breaker' ? 'breaker / RCD' : m.part === 'fuse' ? 'fuse' : m.part === 'efv' ? (k === 'gas' ? 'meter / excess-flow valve' : 'excess-flow valve')
    : m.part === 'valve' ? 'isolating valve' : m.part === 'sprinkler' ? 'sprinkler head' : m.lamp ? (p.root.spec.emergency ? 'emergency luminaire' : 'lamp')
    : m.fixture === 'motor' ? 'motor' : m.fixture === 'radiator' ? 'radiator' : k === 'power' ? 'cable' : 'pipe';
  const label = { power: 'POWER', gas: 'GAS', water: 'WATER', steam: 'STEAM' }[k];
  const parts: string[] = [];
  const live = m.on && !m.blown;
  if (k === 'power') {
    const c = svcCircuit(p);
    if (m.on && c) parts.push(`${c.hv ? '11 kV' : Math.round(c.u0) + ' V'} · Zs ${c.ez.toFixed(2)} Ω · fault ${c.ibf > 1000 ? (c.ibf / 1000).toFixed(1) + ' kA' : Math.round(c.ibf) + ' A'}`);
    else parts.push('0 V');
    if (m.dev) parts.push(`${m.dev.curve}${m.dev.In} A${m.dev.rcd ? ' + RCD' : ''}`);
    if (m.lamp && m.batt >= 0) parts.push(m.on ? 'battery charging' : m.batt > 0 ? `on battery ${Math.ceil(m.batt / 60)} min` : 'battery flat');
    if (m.standby) parts.push(m.run ? 'RUNNING on load' : m.startT > 0 ? `cranking ${m.startT.toFixed(1)} s` : 'standing by, mains healthy');
  } else if (m.on && n) {
    const P = pressureAt(p);
    parts.push(k === 'gas' ? `${(P * GAUGE.gas / 100).toFixed(1)} mbar` : `${(P * GAUGE[k] / 1e5).toFixed(2)} bar`);
    parts.push(`${Math.round(P * 100)} % supply`);
    if (m.flow < 0.95) parts.push(`kinked: ${Math.round(m.flow * 100)} % bore`);
  } else parts.push('no pressure');
  if (isGate(m)) {
    const f = fedBy(p);
    parts.push(`feeds ${f.members} member${f.members === 1 ? '' : 's'}` + (f.lamps ? ` · ${f.lamps} lamp${f.lamps > 1 ? 's' : ''}` : '') + (f.motors ? ` · ${f.motors} motor${f.motors > 1 ? 's' : ''}` : '') + (f.heads ? ` · ${f.heads} sprinklers` : ''));
  }
  const leaks = breaks.filter((b) => !b.gone && b.p.svc!.net === m.net && m.net >= 0 && (b.q > 0 || b.arcing)).length;
  if (leaks) parts.push(`${leaks} open break${leaks > 1 ? 's' : ''} on this network`);
  let action: string | null = null;
  if (isGate(m) && !p.dead) {
    if (m.standby) action = m.run ? 'stop the set' : 'start the set';
    else if (k === 'power') action = m.closed ? (m.fault > 0 || m.dev?.H ? 'reset' : 'switch on') : 'switch off';
    else action = m.closed ? 'open' : 'close';
  }
  const state = m.closed ? (k === 'power' ? 'OFF / TRIPPED' : 'SHUT') : live ? 'LIVE' : 'DEAD';
  return { kind: k, live, title: `${label} · ${what} · ${state}`, detail: parts.join(' · '), action };
}

/** The operable service member nearest `pos` within `r` m: a breaker, fuse, valve, meter or supply (its switch). Buried
    valves are reached through their surface box, straight down. */
export function svcNearestGate(pos: ArrayLike<number>, r = 1.2): Piece | null {
  let best: Piece | null = null, bd = r * r;
  for (const g of gates) {
    if (g.dead) continue;
    const dx = g.curPos[0] - pos[0], dz = g.curPos[2] - pos[2], dy = g.curPos[1] - pos[1];
    const d = dx * dx + dz * dz + (dy < 0 && dy > -2.5 && coverAt(g.curPos[0], g.curPos[1], g.curPos[2]) > 0 ? 0 : dy * dy);
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}

/** A hand on the gear: throw a breaker (or reset a tripped one), close or open a valve, start or stop a standby set.
    Shutting a valve on a flowing water line fast stops the column dead: the surge (Joukowsky, ρ·c·Δv) runs back up the
    line and can crack a brittle or strained joint upstream. Returns what happened. */
export function svcOperate(p: Piece): string | null {
  const m = p.svc;
  if (!m || !isGate(m) || p.dead) return null;
  if (m.standby) {
    m.run = !m.run;
    m.startT = 0;
    m.live = sourceLive(p);
    topoDirty = true;
    audio.utility(m.run ? 'genstart' : 'breaker', p.curPos);
    return m.run ? 'Standby set started by hand' : 'Standby set stopped';
  }
  if (m.blown) return 'It is wrecked';
  const closing = !m.closed;
  let surge = 0;
  if (closing && m.kind === 'water' && m.on && m.draw > 0) {
    const n = nets[m.net];
    const q = CV.water * m.draw * Math.sqrt(n ? n.P : 1), A = (Math.PI / 4) * Math.max(0.01, m.bore) ** 2;
    const c = p.mat === 'pvc' ? 400 : 1200;
    surge = 1000 * c * Math.min(q / A, 5);
  }
  svcIsolate(p, closing);
  audio.utility(m.kind === 'power' ? 'breaker' : 'valve', p.curPos);
  if (surge > 0) waterHammer(p, surge);
  const what = m.kind === 'power' ? (closing ? 'switched off' : 'switched on') : closing ? 'shut' : 'opened';
  return `${m.kind === 'power' ? 'Breaker' : 'Valve'} ${what}${surge > 0 ? ` · water hammer ${(surge / 1e5).toFixed(1)} bar` : ''}`;
}

/* The surge meets the joints on the supply side, nearest first; a joint whose strength is already spent or a brittle /
   plastic one past half its margin cracks. A pipe rated PN16 takes ~16 bar over its working pressure. */
function waterHammer(v: Piece, dp: number): void {
  tally.hammers++;
  audio.impact(v.curPos, 'castiron', clamp(dp / 2e6, 0.3, 1));
  fx.dust(v.curPos, 0.3, 0x6d6a66);
  const k = dp / 1.6e6;
  if (k < 0.5) return;
  const up = v.svc!.fp;
  for (let q: Piece | null = up, h = 0; q && h < 12; q = q.svc!.fp, h++) {
    const at = 1 - h / 12;
    for (const l of q.svc!.links) {
      if (!l.alive || l.a.svc!.grade === 'ductile' && l.b.svc!.grade === 'ductile') continue;
      if (k * at > 1 - l.sev * 0.8) { strain(l, clamp(l.sev + 0.4 * k * at, 0, 1)); return; }
    }
  }
}

/* ---------------- alarms ---------------- */

/* A fire alarm system in each building with a supply: heat detectors (fixed 58 °C) and smoke across the ceiling, or a
   fire in the room, set its sounders going; the sprinkler installation's water-motor gong rings whenever a head flows. */
const alarms = new Map<string, { pos: Vec3; t: number; bell: boolean }>();
let alarmT = 0;
function alarmsTick(): void {
  alarmT -= TICK;
  if (alarmT > 0) return;
  alarmT = 1;
  const fire = burningPieces();
  if (fire.size) {
    let n = 0;
    for (const q of fire) {
      if (++n > 60) break;
      const g = q.root.spec.group;
      if (!g || alarms.has(g)) continue;
      const e = enclosureOf(q);
      if (!e || !inside(e, q.curPos)) continue;
      alarms.set(g, { pos: [(e.min[0] + e.max[0]) / 2, e.max[1] - 0.5, (e.min[2] + e.max[2]) / 2], t: 0, bell: false });
      tally.alarms++;
    }
  }
  for (const b of breaks) if (b.spr && b.q > 0 && !b.gone) {
    const g = b.p.root.spec.group ?? 'sprinklers';
    const a = alarms.get(g);
    if (a) a.bell = true; else alarms.set(g, { pos: [b.p.curPos[0], b.p.curPos[1], b.p.curPos[2]], t: 0, bell: true });
  }
  for (const [g, a] of alarms) {
    a.t += 1;
    if (a.t > 600) { alarms.delete(g); continue; }
    if (vec3.squaredDistance(a.pos, viewer) > 90 * 90) continue;
    audio.utility('alarm', a.pos);
    if (a.bell) audio.utility('bell', a.pos);
  }
}

/** Buildings whose fire alarm is sounding (group, position, sprinkler gong). */
export function svcAlarms(): { group: string; pos: Vec3; bell: boolean }[] {
  return [...alarms].map(([group, a]) => ({ group, pos: a.pos, bell: a.bell }));
}

/* ---------------- contacts, tracking, corona ---------------- */

/* A power joint deformed past its limit works loose. */
function loosen(l: SvcLink, s: number): void {
  if (s <= l.loose + 0.02) return;
  l.loose = s;
  l.rc = contactR(l.loose, l.ox);
  badLinks.add(l);
}

/* A loose or oxidised joint heats by I²R; heat oxidises it faster (doubling every 10 K), which raises its resistance
   again: the runaway of a bad termination. It cooks the insulation either side (thermal() then fails it to earth),
   lights what burns against it and, hot enough, burns the joint open. A loose joint also makes and breaks under load:
   the lamps it feeds flicker and it spits sparks, which light gas. */
function contacts(): void {
  if (!badLinks.size) return;
  const lag = 1 - Math.exp(-TICK / TAU_C);
  for (const l of badLinks) {
    if (!l.alive) { badLinks.delete(l); continue; }
    const am = l.a.svc!, bm = l.b.svc!, on = am.on && bm.on;
    const I = on ? l.i : 0;
    l.rc = contactR(l.loose, l.ox);
    let P = I * I * l.rc;
    if (on && I > 0.2 && l.loose > 0.25 && rnd() < (l.loose - 0.2) * 0.8) { chatter(l); P += 0.5 * I; }
    l.ct += (20 + P * RTH - l.ct) * lag;
    l.ox = Math.min(3, l.ox + TICK * K_OX * Math.pow(2, Math.min(60, (l.ct - 20) / OX_DOUBLE)) * ageOf(l.a).wet * (1 + 3 * Math.max(am.wet, bm.wet)));
    if (l.ct > 60) {
      // the lengths either side run well below the joint itself: about half its rise, averaged along them
      const T = 20 + 0.5 * (l.ct - 20);
      if (T > l.a.temp + 3) heat(l.a, (T - l.a.temp) * 0.3);
      if (T > l.b.temp + 3) heat(l.b, (T - l.b.temp) * 0.3);
      if (l.ct > 300) contactFire(l);
      // copper melts: the joint burns open, and its live side arcs
      if (l.ct > 1050) { tally.contactFires++; killLink(l, true); continue; }
    }
    if (l.loose < 0.02 && l.ct < 25 && P < 0.01) badLinks.delete(l);
  }
}

function chatter(l: SvcLink): void {
  if (!l.down) {
    l.down = [];
    const net = l.a.svc!.net;
    for (const p of lamps) {
      if (p.svc!.net !== net) continue;
      for (let q: Piece | null = p, h = 0; q && h < 2000; q = q.svc!.par, h++) if (q.svc!.pl === l) { l.down.push(p); break; }
    }
  }
  for (const p of l.down) if (p.svc!.on && !p.svc!.blown && !flicker.has(p)) flicker.set(p, 0.06 + rnd() * 0.12);
  if (rnd() < 0.35) {
    toWorld(_w, l.a, l.la);
    fx.arc(_w, 0.12);
    audio.arc(_w, 0.1);
    fields.spark(_w, 0.2);
  }
}

function contactFire(l: SvcLink): void {
  if (rnd() > 0.25) return;
  toWorld(_c, l.a, l.la);
  const r = 0.4, T = l.ct;
  if (rnd() < 0.4) fx.dust(_c, 0.25, 0x3a3836);
  overlapAABB([_c[0] - r, _c[1] - r, _c[2] - r], [_c[0] + r, _c[1] + r, _c[2] + r], CAT.structure | CAT.debris | CAT.prop, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const q = e as Piece;
    if (q.dead || q.burning) return;
    if (T > q.temp) heat(q, (T - q.temp) * 0.1);
    if (flammable(q.pm) && T > (q.pm.thermal.ignite ?? 300) && rnd() < 0.4) ignite(q);
  });
}

/* Water on exposed live gear: the film carries a leakage current across its surface to earth; above ~1 mA dry bands
   form and scintillate (a crackle), cutting a carbon track that grows until it bridges and the gear flashes over. An
   RCD upstream sees the leakage and usually opens first; gear behind fuses tracks on to the flashover. */
function tracking(): void {
  sampleWet();
  if (!wetGear.size) return;
  const w = gridWeather();
  let fxn = 3;
  crackleT -= TICK;
  for (const p of wetGear) {
    const m = p.svc!;
    if (p.dead) { wetGear.delete(p); continue; }
    m.wet = Math.max(p.curPos[1] > 2.5 ? w.rain * 0.8 : 0, m.wet - (TICK * m.wet) / DRY_TAU);
    if (m.on && !m.closed) {
      const I = leakage(m.hv ? U0_HV : U0, m.wet, dirtOf(p), m.hv);
      if (I > 1e-3) {
        m.track += TICK * TRACK_K * (I / 1e-3 - 1);
        faults.push({ p, I, leak: I, b: null });
        if (fxn > 0 && rnd() < 0.6) {
          fxn--;
          const k = clamp(Math.log10(I / 1e-3) / 2, 0.1, 1);
          fx.tracking(p.curPos, k);
          if (crackleT <= 0 && vec3.squaredDistance(p.curPos, viewer) < 900) { crackleT = 0.2; audio.crackle(p.curPos, k); }
        }
        if (m.track >= 1) { m.track = 0; m.wet *= 0.6; insulationFault(p, true); }
      }
    }
    if (m.wet < 0.01) { m.wet = 0; wetGear.delete(p); }
  }
}

/* Standing water up to live gear (it is immersed: the film is the whole pool) and rain on outdoor gear. */
function sampleWet(): void {
  const n = exposed.length;
  if (!n) return;
  const w = gridWeather(), pools = fields.waterTiles.size > 0;
  if (!pools && w.rain <= 0) return;
  for (let k = 0; k < 12 && k < n; k++) {
    exposedAt = (exposedAt + 1) % n;
    const p = exposed[exposedAt];
    if (p.dead) continue;
    const m = p.svc!;
    let wv = w.rain > 0 && p.curPos[1] > 2.5 ? w.rain * 0.8 : 0;
    if (pools && fields.depthAt(p.curPos[0], p.curPos[2], p.curPos[1] - p.root.spec.size[1] / 2 + 0.3) > 0.01) wv = 1.2;
    if (wv > m.wet) { m.wet = wv; wetGear.add(p); }
  }
}

/* HV gear in damp air discharges into it: a violet glow at the bushings and line insulators, seen in the dark, and a
   hiss and buzz that rise with humidity and rain. */
function corona(): void {
  coronaT -= TICK;
  if (coronaT > 0) return;
  coronaT = 0.5;
  const w = gridWeather();
  const k = clamp(0.8 * w.rain + Math.max(0, w.humid - 0.5) * 1.2, 0, 1);
  let best: Piece | null = null, bd = 80 * 80, n = 0;
  if (k > 0.05) for (const p of hvGear) {
    const m = p.svc!;
    if (!m.on || p.dead) continue;
    const d = vec3.squaredDistance(p.curPos, viewer);
    if (d < bd) { bd = d; best = p; }
    if (d < 3600 && n < 6 && w.dark > 0.2) { n++; fx.corona(p.curPos, clamp(k + m.wet, 0, 1.5) * w.dark); }
  }
  if (best || coronaOn) audio.corona(best ? best.curPos : viewer, best ? k : 0);
  coronaOn = !!best;
}
let coronaOn = false;

function breakWorld(b: Break): void {
  /* an arc flash or blowout earlier in the same tick can have destroyed the piece and freed its body */
  if (b.p.dead) { vec3.copy(_v, b.p.curPos); vec3.transformQuat(_d, b.ld, b.p.curRot); return; }
  b3.b3Body_GetWorldPoint(_v, b.p.body, b.lp);
  vec3.transformQuat(_d, b.ld, b.p.curRot);
  /* a break in the ground vents up through the soil (or out of the crater over it): the gas, water or steam
     comes out at the surface above it */
  if (coverAt(_v[0], _v[1], _v[2]) > 0.05) { _v[1] = groundAt(_v[0], _v[2]) + 0.05; vec3.set(_d, 0, 1, 0); }
}

/* Flow at every open break: what the network's supply can push through all of them at once. */
function updateBreaks(): void {
  for (const n of nets) n.area = 0;
  for (const g of gates) g.svc!.draw = 0;
  for (let i = breaks.length - 1; i >= 0; i--) {
    const b = breaks[i], m = b.p.svc!;
    b.active = false;
    /* the device's own terminals are its load side: dead once it has opened. A weep stays with its joint while the
       network is off, so a strained joint does not open a fresh one every tick */
    if (b.gone || b.p.dead || (!b.link && (!m.on || (m.closed && !m.source) || healed(b)))) { if (b.link?.leak === b) b.link.leak = null; breaks.splice(i, 1); continue; }
    if (!m.on) { b.q = 0; b.size = 0; continue; }
    if (b.kind === 'power') continue;
    const A = b.area * m.flow;
    const n = nets[m.net];
    if (n) n.area += A;
    /* every device upstream sees the flow: a meter's EFV sees a break beyond an appliance valve */
    for (let g = m.gate, hops = 0; g && hops < 8; g = g.svc!.up, hops++) g.svc!.draw += A;
  }
  for (const n of nets) {
    const r = n.area / Math.max(n.cap, 1e-6);
    n.P = n.kind === 'gas' ? (r <= 1 ? 1 : 1 / (r * r)) : 1 / (1 + r * r);
  }
  const byKind: Record<UtilityKind, Break[]> = { power: [], gas: [], water: [], steam: [] };
  for (const b of breaks) {
    const m = b.p.svc!;
    if (!m.on) continue;
    if (b.kind === 'power') {
      arcState(b);
      if (b.arcing) byKind.power.push(b);
      continue;
    }
    const n = nets[m.net];
    breakWorld(b);
    let drive = n ? n.P : 0;
    if (b.kind === 'water' && n) drive = Math.max(0, n.P - (_v[1] - n.y) / HEAD);
    const A = b.area * m.flow;
    b.q = CV[b.kind] * A * Math.sqrt(drive);
    b.size = drive > 0 ? clamp(1.4 * Math.sqrt((A / A_REF) * drive), 0.08, 2.5) : 0;
    if (b.kind === 'gas' && !b.lit) igniteCheck(b);
    if (b.size >= 0.1) byKind[b.kind].push(b);
  }
  for (const k of ['power', 'gas', 'water', 'steam'] as const) {
    const list = byKind[k];
    if (list.length > MAX_ACTIVE) {
      list.sort((a, b) => vec3.squaredDistance(a.p.curPos, viewer) - vec3.squaredDistance(b.p.curPos, viewer));
      list.length = MAX_ACTIVE;
    }
    activeCount[k] = list.length;
    for (const b of list) b.active = true;
  }
}

/* A fragment re-welded where its parent broke closes the gap again. */
function healed(b: Break): boolean {
  if (b.link || b.spr || b.ins) return false;
  breakWorld(b);
  for (const l of b.p.svc!.links) if (l.t > b.t0 && vec3.squaredDistance(toWorld(_w, l.a, l.la), _v) < 0.35 * 0.35) return true;
  return false;
}

const CONDUCT = new Set<MaterialId>(['steel', 'castiron', 'copper', 'metal', 'machine', 'aluminum', 'lamp']);
const INSULATE = new Set<MaterialId>(['wood', 'oak', 'plywood', 'pvc', 'glass', 'tempered', 'ceramic']);

/* A live end draws an arc as it parts; after that it arcs only where it touches something that carries the
   fault away: earthed structure (enough for an RCD) or metal and water (a bolted fault, enough for anything). */
function arcState(b: Break): void {
  b.arcT -= TICK;
  if (b.ins) b.contact = 2;
  else if (b.p.movedStep > b.chk || b.chk < 0) {
    b.chk = stepCount;
    breakWorld(b);
    let c: 0 | 1 | 2 = _v[1] < 0.15 ? 1 : 0;
    const r = 0.22, src = b.p;
    overlapAABB([_v[0] - r, _v[1] - r, _v[2] - r], [_v[0] + r, _v[1] + r, _v[2] + r], CAT.structure | CAT.debris | CAT.prop, shape => {
      if (c === 2) return;
      const e = entityOfShape(shape);
      if (!e || e.kind !== 'piece') return;
      const q = e as Piece;
      if (q.dead || q === src || (q.svc?.kind === 'power' && q.svc.on)) return;
      if (CONDUCT.has(q.mat)) c = 2; else if (!INSULATE.has(q.mat)) c = 1;
    });
    if (c < 2) for (const o of breaks) if (o.kind === 'water' && o.size > 0.1 && vec3.squaredDistance(o.p.curPos, b.p.curPos) < 2.25) { c = 2; break; }
    b.contact = c;
  }
  if (b.arcT > 0 || b.contact > 0) faultAt(b); else b.arcing = false;
}

/* Protective devices act on the fault currents of this tick. Every device between a fault and the source carries its
   current; each integrates it against its own curve (a fuse's melting integral, a breaker's thermal image), for as long
   as the fault lasts: until the fastest of them would have opened. That one, the nearest on a tie, clears it, so the
   devices above it see only the moment it took. Protection runs on the 0.25 s service tick and a device opens on the
   tick after it saw its fault, so sub-tick clearing times show as one tick of arcing; arc energies use the curve times. */
function protectPower(): void {
  pstamp++;
  if (faults.length > 1) faults.sort((a, b) => b.I - a.I);
  for (const f of faults) {
    let rmin = Infinity;
    for (let g = f.p.svc!.gate, h = 0; g && h < 8; g = g.svc!.up, h++) {
      const d = g.svc!.dev;
      if (!d || g.svc!.closed || g.dead) continue;
      d.t = tripTime(d, f.I, f.leak);
      rmin = Math.min(rmin, (1 - d.H) * d.t);
    }
    if (f.b && f.b.contact > f.b.ec) arcOnset(f.b, rmin);
    const dt = Math.min(TICK, Math.max(0, rmin));
    for (let g = f.p.svc!.gate, h = 0; g && h < 8; g = g.svc!.up, h++) {
      const d = g.svc!.dev;
      if (!d || g.svc!.closed || g.dead || d.stamp === pstamp) continue;
      d.stamp = pstamp;
      if (Number.isFinite(d.t)) d.H += d.t > 0 ? dt / d.t : 1;
    }
  }
  faults.length = 0;
  for (const g of gates) {
    const m = g.svc!, d = m.dev;
    if (!d || m.closed || g.dead) continue;
    const seen = d.stamp === pstamp;
    if (d.H >= 1 - 1e-9 && d.armed) { trip(g); continue; }
    d.armed = seen || (d.armed && d.H >= 1);
    if (!seen) d.H *= 0.97;
  }
}

/* The arc a fault strikes: its energy is the arc voltage × arcing current for as long as the protection lets it burn
   (a parting cable end's drawn arc goes out on its own sooner). A long clearing time is a big arc flash. */
function arcOnset(b: Break, tclr: number): void {
  b.ec = b.contact;
  // a drawn arc burns until its gap outgrows the supply
  const left = b.contact === 0 && !b.ins ? ((0.9 * Math.SQRT2 * (b.hv ? U0_HV : U0) - b.ua) / 1.8) / (1000 * b.vp) : Infinity;
  const t = Math.min(tclr, Math.max(left, 0.02));
  const E = arcEnergy(b.ua, b.ia, Number.isFinite(t) ? t : 2);
  if (E > lastArc.E) { lastArc.E = E; lastArc.I = b.ia; lastArc.t = t; }
  if (E < 3e4) return;
  breakWorld(b);
  arcBlast([_v[0], _v[1], _v[2]], E, b.p);
}
/** The largest arc since this was last zeroed: incident energy J, arcing current A, burn time s (tools, tests). */
export const lastArc = { E: 0, I: 0, t: 0 };

/* Protective devices act on what they saw this tick. */
function protect(): void {
  protectPower();
  for (const g of gates) {
    const m = g.svc!;
    if (m.closed || g.dead) continue;
    const k = gateKind(g);
    if (m.kind === 'power') continue;
    if (k !== 'efv') continue;
    /* an excess-flow valve (or a governor's slam-shut) closes on a sustained flow well above its rating: a torn pipe,
       not a weep. It is set at ~2× the peak load it serves, about a quarter of what its own bore passes wide open,
       so any line torn open behind it (a 22 mm copper tail behind a 32 mm service) trips it, however many breaks
       share the flow */
    const rating = 0.25 * (Math.PI / 4) * m.bore * m.bore;
    m.over = m.draw >= rating ? m.over + TICK : 0;
    if (m.over >= EFV_DELAY) trip(g);
  }
}

/* An unlit gas leak catches from an arc or flame near it. */
function igniteCheck(b: Break): void {
  if (b.p.temp > 450) { b.lit = true; return; }
  for (const o of breaks) {
    if (o.kind === 'power' && o.arcing && vec3.squaredDistance(o.p.curPos, _v) < 9) { b.lit = true; return; }
    if (o.kind === 'gas' && o.lit && o !== b && vec3.squaredDistance(o.p.curPos, _v) < 4) { b.lit = true; return; }
  }
  const fire = burningPieces();
  if (!fire.size) return;
  let n = 0;
  for (const q of fire) {
    if (++n > 200) break;
    if (vec3.squaredDistance(q.curPos, _v) < 2.25) { b.lit = true; return; }
  }
}

/* ---------------- gas in rooms ---------------- */

/* The building a member belongs to, as an enclosure: the box round its (non-service) structure. */
function enclosureOf(p: Piece): Enclosure | null {
  const g = p.root.spec.group;
  if (!g) return null;
  let e = encs.get(g);
  if (e !== undefined) return e;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (const q of live) {
    if (q.root.spec.group !== g || q.svc || q.debris || q.dead || q.root.spec.noWeld) continue;
    n++;
    const s = q.root.spec.size, h = Math.max(s[0], s[1], s[2]) / 2;
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q.spawnPos[k] - Math.min(h, s[k] / 2 + 0.3)); max[k] = Math.max(max[k], q.spawnPos[k] + Math.min(h, s[k] / 2 + 0.3)); }
  }
  const dx = max[0] - min[0], dy = max[1] - min[1], dz = max[2] - min[2];
  e = n >= 8 && dy > 2 && dx * dz < 3000 ? { group: g, min, max, vol: dx * dy * dz * 0.7, gas: 0, burnt: -99 } : null;
  encs.set(g, e);
  return e;
}

function inside(e: Enclosure, v: ArrayLike<number>, pad = 0): boolean {
  return v[0] > e.min[0] - pad && v[0] < e.max[0] + pad && v[1] > e.min[1] - pad && v[1] < e.max[1] + pad && v[2] > e.min[2] - pad && v[2] < e.max[2] + pad;
}

/* Leaks feed the gas field, which carries the room's gas: it layers under the ceiling, vents through whatever
   has opened, and deflagrates where a spark or flame meets a flammable mixture (roomDeflagrated). Lit jets are
   pilot flames; burst water mains flood; steam and sprinkler spray go into the gas and onto the surfaces. */
let fieldHooked = false;
const GAS_KG = 0.72;                                  // kg/m³ natural gas at the meter
function gasRooms(): void {
  for (const b of breaks) {
    if (!b.active && !(b.kind === 'gas' && b.q > 0)) continue;
    breakWorld(b);
    if (b.kind === 'gas') {
      if (b.q <= 0) continue;
      if (b.lit) { fields.spark(_v, TICK * 1.5); fields.addHeat(_v, b.q * GAS_KG * 50e6, TICK); continue; }
      if (b.enc === undefined) {
        const e = enclosureOf(b.p);
        b.enc = e && inside(e, _v, -0.1) ? e : null;
      }
      vec3.scaleAndAdd(_c, _v, _d, 0.3);
      /* the compressed clock stands in for the hour a room takes to fill; in the open there is nothing to fill, the
         gas leaves as fast as it comes, so it goes out at its real rate */
      fields.addGas(_c, b.q * (b.enc ? GAS_TIME : 1) * GAS_KG, 'methane', TICK);
    } else if (b.kind === 'water') {
      const kg = Math.min(400, b.q * 1000);
      if (b.spr) fields.addWaterSpray(_v, _d, kg, TICK);
      else {
        /* a jet lands a few metres out; a weep runs down the pipe */
        const L = b.size * 1.5;
        vec3.scaleAndAdd(_c, _v, _d, L);
        fields.addWater(_c, kg, TICK);
      }
    } else if (b.kind === 'steam') fields.addGas(_v, Math.min(20, b.q * 0.6), 'steam', TICK);
  }
  for (const e of encs.values()) {
    if (!e) continue;
    const g = roomGas(e);
    e.gas = g.mean * g.vol;
    /* the leak's clock is compressed GAS_TIME×, so is the stirring that spreads it through a room (~a minute) */
    if (g.mean > 1e-4) fields.mixIn(_lo, _hi, 'methane', 1 - Math.exp(-(GAS_TIME * TICK) / 60));
  }
}

/* The enclosure's box runs to the outside of its walls: sample the cells well inside them. */
const _lo: Vec3 = [0, 0, 0], _hi: Vec3 = [0, 0, 0];
function roomGas(e: Enclosure): { mean: number; vol: number } {
  _lo[0] = e.min[0] + 0.8; _lo[1] = e.min[1]; _lo[2] = e.min[2] + 0.8;
  _hi[0] = e.max[0] - 0.8; _hi[1] = e.max[1] - 0.8; _hi[2] = e.max[2] - 0.8;
  return fields.meanIn(_lo, _hi, 'methane');
}

/* A field deflagration: the services' account of it, and the leaks in that room catch. */
function roomDeflagrated(pos: Vec3, m3: number, backdraft: boolean): void {
  if (backdraft) return;
  tally.deflagrations++;
  igniteAround(pos, Math.min(6, 1.5 + Math.cbrt(m3) * 2), 0.35);
  for (const b of breaks) if (b.kind === 'gas' && b.enc && inside(b.enc, pos, 1)) b.lit = true;
  /* The field deals the front it resolved in its first half-second; a room stirred to a flammable mean burns right
     through behind it (a 4 m room in a second or two), and the pressure of all of that is what the walls see. */
  for (const e of encs.values()) if (e && inside(e, pos, 1)) roomBurn(e, m3);
}

/* The rest of a stirred room's premixed gas burns through: one vented-deflagration blast at the room's centre from
   the methane left in it, if the room stood between the LEL and UEL. Once per room per fill. */
function roomBurn(e: Enclosure, burnt: number): boolean {
  if (clock - e.burnt < 20) return false;
  const g = roomGas(e), V = g.mean * g.vol, before = (V + burnt) / Math.max(1, g.vol);
  if (before < 0.05 || before > 0.15 || V <= 0) return false;
  e.burnt = clock;
  const c: Vec3 = [(e.min[0] + e.max[0]) / 2, (e.min[1] + e.max[1]) / 2, (e.min[2] + e.max[2]) / 2];
  const power = Math.min(160e3, 18e3 * V);
  if (power >= 1.5e3) explode(c, clamp(2 + 1.5 * Math.cbrt(10 * V), 3, 10), power, clamp(700 * V, 150, 6000), 1.2);
  return true;
}

/* ---------------- sprinklers ---------------- */

/* Ceiling-jet temperature over a fire (Alpert): ~17·Q^(2/3)/H^(5/3) inside r = 0.18 H, 5.4·(Q/r)^(2/3)/H beyond,
   with Q the fire's heat release, kW. A standard-response bulb lags the gas by RTI/√u, a minute or two in a real
   ceiling jet; played on the fires' own compressed clock, a few seconds. */
function sprinklerHeat(): void {
  const fire = burningPieces();
  if (!fire.size && !fields.fieldsActive()) return;
  for (const h of sprinklers) {
    const m = h.svc!;
    if (!m.on || h.temp >= BULB) continue;
    let dT = 0, n = 0;
    for (const q of fire) {
      if (++n > 200) break;
      const H = h.curPos[1] - q.curPos[1];
      if (H < 0.3 || H > 12) continue;
      const r = Math.hypot(h.curPos[0] - q.curPos[0], h.curPos[2] - q.curPos[2]);
      if (r > 8) continue;
      const Q = 300 * clamp(q.volume * 4, 0.3, 4);
      dT += r <= 0.18 * H ? (16.9 * Q ** (2 / 3)) / H ** (5 / 3) : (5.38 * (Q / r) ** (2 / 3)) / H;
    }
    /* the ceiling jet from the fires this model knows of, or the gas field's own hot layer if that is hotter */
    const Tg = Math.max(20 + dT, fields.sampleField(h.curPos, 'T'));
    if (Tg > h.temp) heat(h, (Tg - h.temp) * BULB_LAG);
  }
  for (const h of sprinklers) if (h.svc!.on && h.temp >= BULB && !h.dead) openSprinkler(h);
}

function openSprinkler(h: Piece): void {
  const m = h.svc!;
  sprinklers.delete(h);
  b3.b3Body_ComputeAABB(_aabb, h.body);
  const b = addBreak(h, [h.curPos[0], _aabb[1], h.curPos[2]], [0, -1, 0], (Math.PI / 4) * SPRINKLER_BORE * SPRINKLER_BORE, false);
  if (b) { b.spr = true; tally.sprinklers++; }
  m.part = null;
}
const _aabb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

/** Open a sprinkler head as if its bulb had burst. */
export function svcOpenSprinkler(p: Piece): boolean {
  if (!sprinklers.has(p)) return false;
  openSprinkler(p);
  return true;
}

/* ---------------- per-step jets ---------------- */

function stepBreaks(dt: number): void {
  for (const b of breaks) {
    if (!b.active || b.p.dead) continue;
    b.fxT -= dt;
    b.auT -= dt;
    if (b.fxT > 0 && b.auT > 0) continue;
    breakWorld(b);
    if (b.kind === 'power') {
      if (b.fxT > 0) continue;
      b.fxT = 0.15 + rnd() * 0.25;
      // a sputtering earth fault of a few amps to a bolted fault of kiloamps
      const k = clamp(0.3 + 0.28 * Math.log10(Math.max(b.ia, 10) / 30), 0.25, 1.4);
      arc(b, k * (b.contact === 2 ? 1 + rnd() * 0.5 : 0.7 + rnd() * 0.5));
      continue;
    }
    if (b.fxT <= 0) {
      b.fxT += 0.1;
      if (b.kind === 'gas') { if (b.lit) fx.gasJet(_v, _d, b.size); else fx.gasVent(_v, _d, b.size); }
      else if (b.kind === 'water') fx.waterSpray(_v, _d, b.spr ? Math.max(b.size, 0.5) : b.size);
      else fx.steamJet(_v, _d, b.size);
    }
    if (b.auT <= 0) {
      b.auT += 0.25;
      if (b.kind === 'gas') { if (b.lit) audio.gasJet(_v, b.size); else audio.gasHiss(_v, b.size); }
      else if (b.kind === 'water') audio.waterSpray(_v, b.size);
      else audio.steamJet(_v, b.size);
      jetEffect(b);
    }
  }
}

function arc(b: Break, strength: number): void {
  fx.arc(_v, strength);
  audio.arc(_v, strength);
  fields.spark(_v, 0.3);
  /* molten copper spatter flies a metre or so every way (and the plasma plume climbs): either lights a flammable
     pocket beside the arc that the arc itself is not in */
  for (let k = strength > 0.3 ? 4 : 0; k > 0; k--) {
    const r = 0.3 + 1.2 * rnd(), a = rnd() * 2 * Math.PI;
    fields.spark([_v[0] + r * Math.cos(a), _v[1] - 0.5 + 1.5 * rnd(), _v[2] + r * Math.sin(a)], 0.25);
  }
  /* an arc inside a room whose stirred gas is flammable lights all of it */
  const e = enclosureOf(b.p);
  if (e && inside(e, _v) && clock - e.burnt >= 20 && e.gas > 0) {
    const g = roomGas(e);
    if (g.mean >= 0.05 && g.mean <= 0.15) {
      tally.deflagrations++;
      igniteAround(_v, 2.5, 0.35);
      for (const o of breaks) if (o.kind === 'gas' && o.enc === e) o.lit = true;
      breakWorld(b);
      roomBurn(e, 0);
    }
  }
  const net = b.p.svc!.net;
  for (const p of lamps) if (p.svc!.net === net && p.svc!.on && !flicker.has(p)) flicker.set(p, 0.08 + rnd() * 0.12);
  const r = 0.8;
  const src = b.p;
  overlapAABB([_v[0] - r, _v[1] - r, _v[2] - r], [_v[0] + r, _v[1] + r, _v[2] + r], CAT.structure | CAT.debris | CAT.prop, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const q = e as Piece;
    if (q.dead || q === src) return;
    // the arc's heat goes into what is next to it: a long member's lumped temperature rises by its share
    heat(q, 70 * strength * clamp(0.01 / q.volume, 0.02, 1));
    if (flammable(q.pm) && rnd() < 0.06 * strength) ignite(q);
  });
}

/* Jet cone: a gas flame torches what it hits, water cools and douses (and shorts live gear), steam scalds and
   shoves debris. A sprinkler throws a wide umbrella down to the floor. */
function jetEffect(b: Break): void {
  /* unlit gas neither heats nor lights anything: it goes into the gas field */
  if (b.kind === 'gas' && !b.lit) return;
  breakWorld(b);
  const L = b.spr ? Math.max(3.5, _v[1] + 0.5) : 1 + b.size * (b.kind === 'water' ? 3 : 2.2);
  vec3.scaleAndAdd(_c, _v, _d, L / 2);
  const pos: Vec3 = [_v[0], _v[1], _v[2]], dir: Vec3 = [_d[0], _d[1], _d[2]];
  const spread = b.spr ? 0.4 : 0.35, base = b.spr ? 0.5 : 0.3;
  const h = L / 2 + 0.5, w = b.spr ? spread * L + base + 0.5 : h;
  overlapAABB([_c[0] - w, _c[1] - h, _c[2] - w], [_c[0] + w, _c[1] + h, _c[2] + w], CAT.structure | CAT.debris | CAT.prop, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const q = e as Piece;
    if (q.dead || q === b.p) return;
    vec3.sub(_w, q.curPos, pos);
    const along = vec3.dot(_w, dir);
    const reach = Math.cbrt(q.volume) * 0.6;
    if (along < -reach || along > L + reach) return;
    const lateral = Math.sqrt(Math.max(0, vec3.squaredLength(_w) - along * along));
    if (lateral > spread * Math.max(along, 0) + base + reach) return;
    const f = clamp(1 - along / L, 0.2, 1);
    if (b.kind === 'gas') {
      heat(q, 160 * f);
      if (flammable(q.pm) && rnd() < 0.3 * f) ignite(q);
    } else if (b.kind === 'water') {
      q.temp = 20 + (q.temp - 20) * 0.5;
      if (q.burning) douse(q);
      /* water wets exposed live gear (terminals, boards, busbars, insulators), not a sheathed cable or its conduit: it
         tracks across the wet surface (tracking()) */
      const qm = q.svc;
      if (qm?.kind === 'power' && qm.on && !qm.source && exposedGear(q)) {
        qm.wet = Math.min(1.1, qm.wet + 0.35 * f);
        wetGear.add(q);
      }
    } else {
      if (q.temp < 140) heat(q, 35 * f);
      if (!q.welds.length && !q.hinged) {
        const j = Math.min(q.mass * 0.6, 40 * b.size * f);
        b3.b3Body_ApplyLinearImpulseToCenter(q.body, [dir[0] * j, dir[1] * j, dir[2] * j], true);
      }
    }
  });
}

/* ---------------- blowouts ---------------- */

function blowout(pos: Vec3, fixture: FixtureKind, volume: number): void {
  switch (fixture) {
    case 'transformer':
    case 'generator': {
      /* The same fixture tag covers a wall-mounted consumer unit and a ground transformer: the
         fault energy (and so the flash) scales with the unit's size. */
      const k = clamp(Math.sqrt(volume / 0.6), 0.3, 1);
      fx.arcFlash(pos, (fixture === 'generator' ? 5 : 4) * k);
      audio.arcFlash(pos);
      explode(pos, 3 * k, 30e3 * k * k, 1200 * k);
      if (fixture === 'generator') { igniteAround(pos, 5 * k, 0.8); spill(pos, 400 * k, true); }
      else igniteAround(pos, 4 * k, 0.5);
      break;
    }
    case 'gasmain': {
      /* a crushed meter lets its gas go; a district governor's inventory burns as a fireball */
      const k = clamp(Math.sqrt(volume / 2), 0.25, 1);
      explode(pos, 4.5 * k, 60e3 * k * k, 2500 * k);
      fx.fire(pos, 5 * k, 1.8 * k);
      igniteAround(pos, 5.5 * k, 0.7);
      break;
    }
    case 'boiler': {
      /* the blast is the flash of the hot water it holds, so it scales with the vessel: a works shell boiler's tonnes
         of water at 10 bar, not the litre or two in a domestic combi, whose casing splits and vents */
      const k = clamp(volume / 2, 0.02, 1);
      audio.boilerBlast(pos);
      if (k >= 0.1) explode(pos, 5.5 * Math.cbrt(k), 95e3 * k, 3600 * k);
      for (let i = 0; i < 8; i++) {
        vec3.set(_d, rnd() - 0.5, rnd() * 0.8, rnd() - 0.5);
        vec3.normalize(_d, _d);
        fx.steamJet(pos, _d, 3 * Math.sqrt(k));
      }
      break;
    }
    case 'watermain':
      fx.waterSpray(pos, [0, 1, 0], 2.5);
      break;
    default: break;
  }
}

function igniteAround(pos: Vec3, r: number, chance: number): void {
  overlapAABB([pos[0] - r, pos[1] - r, pos[2] - r], [pos[0] + r, pos[1] + r, pos[2] + r], CAT.structure | CAT.debris | CAT.prop, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const q = e as Piece;
    if (q.dead || vec3.distance(q.curPos, pos) > r) return;
    heat(q, 250);
    if (flammable(q.pm) && rnd() < chance) ignite(q);
  });
}

/* ---------------- lamps & hum ---------------- */

const nearest: { p: Piece; d: number }[] = [];
function pushLights(): void {
  nearest.length = 0;
  lampsLit = 0;
  for (const p of lamps) {
    if (p.svc!.on && !p.svc!.blown) lampsLit++;
    if (p.svc!.emit <= 0) continue;
    const d = vec3.squaredDistance(p.curPos, viewer);
    if (nearest.length < LAMP_LIGHTS) nearest.push({ p, d });
    else {
      let worst = 0;
      for (let i = 1; i < nearest.length; i++) if (nearest[i].d > nearest[worst].d) worst = i;
      if (d < nearest[worst].d) nearest[worst] = { p, d };
    }
  }
  nearest.sort((a, b) => a.d - b.d);
  lampLights.set(nearest.map(({ p }) => {
    const l = p.root.spec.light ?? DEFAULT_LIGHT;
    return { pos: [p.curPos[0], p.curPos[1], p.curPos[2]] as Vec3, color: l.color, intensity: l.intensity * p.svc!.emit, range: l.range };
  }));
}

function hum(): void {
  let best: Piece | null = null, bd = Infinity;
  for (const s of sources) {
    const m = s.svc!;
    if (!m.live || (m.fixture !== 'transformer' && m.fixture !== 'generator')) continue;
    const d = vec3.squaredDistance(s.curPos, viewer);
    if (d < bd) { bd = d; best = s; }
  }
  /* the core hums with its flux; the load current's winding forces (∝ I²) add to it */
  const n = best ? nets[best.svc!.net] : undefined;
  const load = n && n.kind === 'power' && n.S > 0 ? Math.min(1.5, n.load / (n.S / (Math.sqrt(3) * 400))) : 0;
  audio.mainsHum(best ? best.curPos : viewer, best ? (best.svc!.fixture === 'generator' ? 1 : 0.7) * (0.6 + 0.4 * load * load) : 0);
  let mb: Mech | null = null;
  bd = Infinity;
  for (const m of mechs.values()) {
    if (!m.running) continue;
    const d = vec3.squaredDistance(m.part.curPos, viewer);
    if (d < bd) { bd = d; mb = m; }
  }
  audio.motor(mb ? mb.part.curPos : viewer, mb ? mb.rate : 0);
}

/* ---------------- machinery ---------------- */

const Z: Vec3 = [0, 0, 1], X: Vec3 = [1, 0, 0];
const G = 9.81;
const ETA = 0.9;             // motor × gearbox efficiency
const ILR = 6;               // locked-rotor current / rated (IEC design N)
const TRIP_AT = 1.15 * 1.15; // class-10 overload relays trip on a sustained 1.15 × Ir
const TRIP_RESET = 0.5;      // …and reset once the winding has cooled to this thermal image
const LUG_GRACE = 3;         // s a diesel may run below idle before it stalls
const RESTART = 6;           // s to crank a stalled engine
const BEARING_MU = 0.002;    // rolling bearings with seals
const GEAR_LOSS = 0.02;      // no-load gearbox / transmission loss, share of rated torque
const SEAL_LOSS = 0.03;      // hydraulic cylinder seal friction, share of relief force
const GUIDE_MU = 0.02;       // lubricated slideways
const AIR = 1.2 * 1.2 / 4;   // ρ_air · C_d(flat blade) / 4: windage k = AIR · h · (R⁴ − r⁴)
const REFLECT_CAP = 20;      // geared rotor inertia at the output capped at this × the part's own

const LOOSE_ROLLING = 0.02;   // what structure gives an intact piece
const mechList: Mech[] = [];
const pools: { pos: Vec3; t: number; r: number; lit: boolean }[] = [];

function findHost(p: Piece, at: Vec3): Piece | null {
  let best: Piece | null = null, bd = 0.03, bv = 0;
  const e = 0.03;
  const cp: Vec3 = [0, 0, 0];
  overlapAABB([at[0] - e, at[1] - e, at[2] - e], [at[0] + e, at[1] + e, at[2] + e], CAT.structure | CAT.debris | CAT.prop, shape => {
    const ent = entityOfShape(shape);
    if (!ent || ent.kind !== 'piece' || ent === p) return;
    const q = ent as Piece;
    if (q.dead || (q.root.spec.mech && !q.hinged)) return;
    b3.b3Shape_GetClosestPoint(cp, shape, at);
    const d = vec3.distance(cp, at);
    if (d < bd - 1e-4 || (d <= bd + 1e-4 && q.volume > bv)) { bd = d; bv = q.volume; best = q; }
  });
  return best;
}

/* The drive a motor spec stands for. Old specs keep their numbers: `always` becomes a pressure-compensated
   hydraulic drive (full force up to the flow-limited speed), a grid motor an induction motor stalling at `force`. */
function makeDrive(mo: MechMotor, hinge: boolean): Drive {
  const kind: DriveKind = mo.drive ?? (mo.always || mo.bore || mo.cc || mo.bar ? 'hydraulic' : 'electric');
  const F = Math.abs(mo.force);
  let s = Math.max(Math.abs(mo.speed), 1e-3);
  const d: Drive = { kind, wS: [s, s], Tmax: [F, F], Tr: F, wR: s, heat: 0, tau: 1, tripped: false, idle: mo.idle ?? 0.35,
    lugT: 0, downUntil: 0, cut: false, tank: mo.tank ?? 0 };
  if (kind === 'hydraulic') {
    const p = (mo.bar ?? 0) * 1e5, q = (mo.lpm ?? 0) / 60000;
    if (p > 0 && mo.cc) {
      const V = (mo.cc * 1e-6) / (2 * Math.PI);           // m³ per radian
      d.Tmax = [p * V, p * V];
      if (q > 0) d.wS = [q / V, q / V];
    } else if (p > 0 && mo.bore) {
      const A = (Math.PI / 4) * mo.bore ** 2, Ar = A - (Math.PI / 4) * (mo.rod ?? 0) ** 2, arm = hinge ? mo.arm ?? 1 : 1;
      d.Tmax = [p * A * arm, p * Ar * arm];
      d.wS = q > 0 ? [q / A / arm, q / Ar / arm] : [s, (s * A) / Ar];
    }
    if (hinge) d.wS = [Math.min(d.wS[0], MAX_SPIN), Math.min(d.wS[1], MAX_SPIN)];
    d.Tr = d.Tmax[0];
    d.wR = d.wS[0];
    return d;
  }
  const slip = kind === 'electric' ? clamp(mo.slip ?? 0.04, 0.005, 0.9) : 0.05;   // diesel: governor droop
  if (hinge) s = Math.min(s, MAX_SPIN * (1 - slip));
  d.wR = s;
  if (mo.kW) {
    d.Tr = (mo.kW * 1000 * ETA) / s;
    const peak = (mo.stall ?? (kind === 'electric' ? 2.5 : 1.3)) * d.Tr;
    d.Tmax = F > 0 ? [Math.min(peak, F), Math.min(peak, F)] : [peak, peak];
  } else d.Tr = F / (kind === 'electric' ? 2.5 : 1.3);
  d.wS = [s / (1 - slip), s / (1 - slip)];
  d.tau = (mo.trip ?? 10) / -Math.log(1 - TRIP_AT / (ILR * ILR));
  return d;
}

function axisInertia(md: b3MassData, a: Vec3): number {
  const I = md.inertia;
  return a[0] * (I.cx[0] * a[0] + I.cy[0] * a[1] + I.cz[0] * a[2])
    + a[1] * (I.cx[1] * a[0] + I.cy[1] * a[1] + I.cz[1] * a[2])
    + a[2] * (I.cx[2] * a[0] + I.cy[2] * a[1] + I.cz[2] * a[2]);
}

/* A geared motor's rotor is a flywheel seen through the gearbox: J·n² about the output axis. */
function addRotorInertia(m: Mech, aL: Vec3): void {
  const d = m.drive!, mo = m.motor!;
  if (!m.hinge || d.kind === 'hydraulic') return;
  const kW = mo.kW ?? (d.Tr * d.wR) / 1000 / ETA;
  const rpm = mo.rpm ?? (d.kind === 'electric' ? 1480 : 1800);
  const n = (rpm * Math.PI) / 30 / d.wR;
  const J = d.kind === 'electric' ? 0.006 * kW ** 1.2 * (1500 / rpm) : 0.015 * kW;
  const md = b3.b3Body_GetMassData(m.part.body);
  const Jr = Math.min(J * n * n, REFLECT_CAP * axisInertia(md, aL));
  if (!(Jr > 1e-6)) return;
  m.mass0 = md;
  const I = md.inertia;
  const col = (c: Vec3, k: number): Vec3 => [c[0] + Jr * aL[0] * aL[k], c[1] + Jr * aL[1] * aL[k], c[2] + Jr * aL[2] * aL[k]];
  b3.b3Body_SetMassData(m.part.body, { mass: md.mass, center: md.center, inertia: { cx: col(I.cx as Vec3, 0), cy: col(I.cy as Vec3, 1), cz: col(I.cz as Vec3, 2) } });
}

/* Hinges and sliders replace welds for moving parts. The joint frame's local Z (hinge) or X (slider)
   is turned onto the world axis, so limits and motor speeds are about/along `axis` from the spawn pose.
   While the host member rests, the joint is anchored to the static world at the same spot instead:
   a joint to a building body would merge the running machine into the building's solver island and
   keep every weld in it awake. The first real movement of the host rebinds the joint to it. A host
   whose welds never reach the ground (a vehicle body standing on its wheels, a loose machine) is in no
   building's island and is carried by its parts, so it keeps its joints. The machine's weight still reaches the host's welds
   through the support-path model (structure.ts), which sizes them for it at calibration. */
export function linkMechs(list: Piece[], delay: number): void {
  const fresh: Mech[] = [];
  for (const p of list) {
    const spec = p.root.spec.mech;
    if (!spec || p.dead) continue;
    const host = findHost(p, spec.at);
    const axis = vec3.normalize([0, 0, 0], spec.axis) as Vec3;
    if (!Number.isFinite(axis[0]) || vec3.length(axis) < 0.5) vec3.set(axis, 0, 1, 0);
    const hinge = spec.kind === 'hinge';
    const qa = quat.rotationTo([0, 0, 0, 1], hinge ? Z : X, axis) as Quat;
    const motor = spec.motor && !spec.drivenBy ? spec.motor : null;
    const drive = motor ? makeDrive(motor, hinge) : null;
    const weight = p.mass * G;
    const reach = Math.max(...p.root.spec.size) * 0.5;
    const hostK = host ? clamp(host.pm.crush / 2e6, 0.4, 1.5) : 1.5;
    const limited = spec.lower !== undefined && spec.upper !== undefined;
    const brake = spec.brake ?? (drive && ((drive.kind === 'electric' && (limited || !hinge)) || drive.kind === 'hydraulic') ? drive.Tmax[0] : 0);
    const F = Math.max(drive ? Math.max(drive.Tmax[0], drive.Tmax[1]) : 0, brake);
    /* A road wheel's bearing carries its share of the vehicle, with the margin of a real hub (~3 g). */
    const carry = spec.crr && host ? 3 * host.mass * G : 0;

    quat.conjugate(_q, p.curRot);
    const aL = vec3.transformQuat([0, 0, 0], axis, _q) as Vec3;
    const sz = p.root.spec.size;
    const k = Math.abs(aL[0]) >= Math.abs(aL[1]) && Math.abs(aL[0]) >= Math.abs(aL[2]) ? 0 : Math.abs(aL[1]) >= Math.abs(aL[2]) ? 1 : 2;
    const r1 = sz[(k + 1) % 3] / 2, r2 = sz[(k + 2) % 3] / 2, R = Math.max(r1, r2), r = Math.min(r1, r2);
    const loss = drive ? (drive.kind === 'hydraulic' ? SEAL_LOSS * drive.Tmax[0] : GEAR_LOSS * drive.Tr) : 0;
    const fric = spec.friction ?? (hinge ? BEARING_MU * weight * clamp(0.08 * R, 0.015, 0.25) : GUIDE_MU * weight) + loss;

    const proxy = !!host && !host.hinged && grounded(host);
    const m: Mech = {
      joint: null!, part: p, host, bound: proxy, hinge, axis, motor, drive, couple: null,
      lower: spec.lower, upper: spec.upper, dir: 1, running: false, active: false,
      roped: p.ropes.length > 0, brakesFailed: false, ready: clock + delay, alive: true, lastOver: -9, overSteps: 0, rate: 0,
      fric, roll: 0, dragK: hinge ? spec.drag ?? AIR * sz[k] * (R ** 4 - r ** 4) : 0, brake, crr: spec.crr ?? 0, radius: R,
      w: 0, ang: 0, spd: 0, tq: fric + brake, mass0: null, tyre: null,
      near: false, hold: false, cyc: spec.cycle ?? null, spin: null, trips: 0, burnt: 0, load: 0, evT: -9,
      qa, groundAt: b3.b3Body_GetLocalPoint([0, 0, 0], ground, spec.at) as Vec3,
      fa: host ? { position: b3.b3Body_GetLocalPoint([0, 0, 0], host.body, spec.at) as Vec3, quaternion: quat.multiply([0, 0, 0, 1], quat.conjugate(_q, host.curRot), qa) as Quat } : null,
      fb: { position: b3.b3Body_GetLocalPoint([0, 0, 0], p.body, spec.at) as Vec3, quaternion: quat.multiply([0, 0, 0, 1], quat.conjugate(_q, p.curRot), qa) as Quat },
      forceT: Math.max(3 * F, 12 * weight + 2000, carry) * hostK * SUBSTEP_PEAK,
      torqueT: Math.max(3 * F, 8 * weight * reach + 1500, carry * reach) * hostK * SUBSTEP_PEAK,
    };
    if (drive) addRotorInertia(m, aL);
    if (hinge) setRolling(p, 0);   // the joint model carries bearing and rolling losses
    if (hinge && spec.crr) roundTyre(m, R);
    m.joint = mechJoint(m, host && !proxy ? host : null);
    mechs.set(m.joint.index1, m);
    p.hinged = true;
    (p.mechs ??= []).push(m);
    if (host) {
      (host.mechs ??= []).push(m);
      if (proxy) host.proxied++;
    }
    fresh.push(m);
  }
  for (const m of fresh) {
    const db = m.part.root.spec.mech!.drivenBy;
    if (db && m.hinge) couple(m, db);
  }
}

/* Belt, chain or gear drive from the nearest motorised hinge on a parallel shaft. */
function couple(m: Mech, db: NonNullable<NonNullable<PieceSpec['mech']>['drivenBy']>): void {
  let best: Mech | null = null, bd = 16;
  for (const o of mechs.values()) {
    if (o === m || !o.drive || !o.hinge || !o.alive || Math.abs(vec3.dot(o.axis, m.axis)) < 0.98) continue;
    const d = vec3.squaredDistance(o.part.curPos, m.part.curPos);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return;
  const kind = db.kind ?? 'belt', ratio = Math.abs(db.ratio) || 1;
  const along = Math.sign(vec3.dot(best.axis, m.axis));
  m.couple = { driver: best, ratio, sign: kind === 'gear' ? -along : along, kind, over: 0,
    limit: db.slip ?? (kind === 'belt' ? 1.5 * best.drive!.Tr : 4 * best.drive!.Tmax[0]) * ratio };
  m.torqueT = Math.max(m.torqueT, 3 * m.couple.limit * SUBSTEP_PEAK);
}

/* A polygonal wheel must be tipped over each flat: a 16-gon rolls against ~sin(π/16) ≈ 0.2 of its load,
   twenty times a tyre. A massless sphere of the tyre's radius takes the road contact; the disc keeps every
   other contact (the sphere would poke through the wheel arch). */
function roundTyre(m: Mech, r: number): void {
  const p = m.part, f = b3.b3Shape_GetFilter(p.shape), sm = b3.b3Shape_GetSurfaceMaterial(p.shape);
  const sd = b3.b3DefaultShapeDef();
  sd.density = 0;
  sd.baseMaterial.friction = sm.friction;
  sd.baseMaterial.restitution = sm.restitution;
  sd.baseMaterial.rollingResistance = 0;
  sd.filter = { categoryBits: f.categoryBits, maskBits: CAT.ground, groupIndex: f.groupIndex };
  sd.enableContactEvents = false;
  sd.enableHitEvents = false;
  const md = b3.b3Body_GetMassData(p.body);
  m.tyre = b3.b3CreateSphereShape(p.body, sd, { center: md.center, radius: r });
  b3.b3Shape_SetFilter(p.shape, { ...f, maskBits: f.maskBits & ~CAT.ground }, false);
}

function dropTyre(m: Mech): void {
  if (!m.tyre) return;
  if (b3.b3Shape_IsValid(m.tyre)) b3.b3DestroyShape(m.tyre, false);
  m.tyre = null;
  const p = m.part;
  if (!p.dead && b3.b3Shape_IsValid(p.shape)) {
    const f = b3.b3Shape_GetFilter(p.shape);
    b3.b3Shape_SetFilter(p.shape, { ...f, maskBits: f.maskBits | CAT.ground }, true);
  }
}

/* Does this member's welded structure stand on the ground? (A building does; a vehicle body does not.) */
function grounded(p: Piece): boolean {
  const seen = new Set<Piece>([p]), q = [p];
  for (let i = 0; i < q.length && i < 256; i++) for (const w of q[i].welds) {
    if (!w.b) return true;
    const o = w.a === q[i] ? w.b : w.a;
    if (!seen.has(o)) { seen.add(o); q.push(o); }
  }
  return q.length > 256;
}

function setRolling(p: Piece, r: number): void {
  const sm = b3.b3Shape_GetSurfaceMaterial(p.shape);
  sm.rollingResistance = r;
  b3.b3Shape_SetSurfaceMaterial(p.shape, sm);
}

function mechJoint(m: Mech, host: Piece | null): b3JointId {
  const fa = host ? m.fa! : { position: [m.groundAt[0], m.groundAt[1], m.groundAt[2]] as Vec3, quaternion: [m.qa[0], m.qa[1], m.qa[2], m.qa[3]] as Quat };
  const limited = m.lower !== undefined && m.upper !== undefined;
  const jd = m.hinge ? b3.b3DefaultRevoluteJointDef() : b3.b3DefaultPrismaticJointDef();
  jd.base.bodyIdA = host ? host.body : ground;
  jd.base.bodyIdB = m.part.body;
  jd.base.localFrameA = fa;
  jd.base.localFrameB = m.fb;
  jd.base.forceThreshold = m.forceT;
  jd.base.torqueThreshold = m.torqueT;
  jd.base.collideConnected = false;
  /* The motor is always on: driving, it follows the drive's torque curve; idle, it is the bearing
     friction and the brake (target speed 0, torque capped at the resistance). */
  jd.enableMotor = true;
  jd.motorSpeed = m.spd;
  if ('maxMotorTorque' in jd) {
    jd.maxMotorTorque = m.tq;
    if (limited) { jd.enableLimit = true; jd.lowerAngle = m.lower!; jd.upperAngle = m.upper!; }
    const j = b3.b3CreateRevoluteJoint(world, jd);
    m.ang = b3.b3RevoluteJoint_GetAngle(j);
    return j;
  }
  jd.maxMotorForce = m.tq;
  if (limited) { jd.enableLimit = true; jd.lowerTranslation = m.lower!; jd.upperTranslation = m.upper!; }
  return b3.b3CreatePrismaticJoint(world, jd);
}

function rejoint(m: Mech, host: Piece | null, wake: boolean): void {
  const old = m.joint;
  m.joint = mechJoint(m, host);
  mechs.delete(old.index1);
  mechs.set(m.joint.index1, m);
  if (b3.b3Joint_IsValid(old)) b3.b3DestroyJoint(old, wake);
  if (wake) b3.b3Joint_WakeBodies(m.joint);
}

/* The host has really moved (struck, sagging, collapsing): carry the joint over to it, re-seated
   where it sits on the host rather than where the host used to be. */
export function svcHostMoved(host: Piece): void {
  if (!host.mechs) return;
  for (const m of host.mechs) {
    if (m.host !== host || !m.bound || !m.alive) continue;
    m.bound = false;
    host.proxied--;
    rejoint(m, host, true);
  }
}

function powered(host: Piece | null): boolean {
  if (!host || host.dead) return false;
  if (host.svc?.on) return true;
  for (const w of host.welds) {
    const o = w.a === host ? w.b : w.a;
    if (o?.svc?.fixture === 'motor' && o.svc.on) return true;
  }
  if (host.svc) for (const l of host.svc.links) {
    const o = l.a === host ? l.b : l.a;
    if (o.svc?.fixture === 'motor' && o.svc.on) return true;
  }
  return false;
}

function send(m: Mech, speed: number, torque: number): void {
  if (speed !== m.spd) {
    /* A motor target does not wake a sleeping body; a follower whose driver spins up must be nudged. */
    if (speed !== 0 && Math.abs(m.w) < 0.5 * Math.abs(speed) && !b3.b3Body_IsAwake(m.part.body)) b3.b3Joint_WakeBodies(m.joint);
    m.spd = speed;
    if (m.hinge) b3.b3RevoluteJoint_SetMotorSpeed(m.joint, speed); else b3.b3PrismaticJoint_SetMotorSpeed(m.joint, speed);
  }
  if (Math.abs(torque - m.tq) > 0.01 * m.tq + 1e-3) {
    m.tq = torque;
    if (m.hinge) b3.b3RevoluteJoint_SetMaxMotorTorque(m.joint, torque); else b3.b3PrismaticJoint_SetMaxMotorForce(m.joint, torque);
  }
}

function measure(m: Mech, dt: number): number {
  if (!m.hinge) return b3.b3PrismaticJoint_GetSpeed(m.joint);
  const a = b3.b3RevoluteJoint_GetAngle(m.joint);
  let d = a - m.ang;
  m.ang = a;
  if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
  return d / dt;
}

function motorLoad(m: Mech): number {
  return Math.abs(m.hinge ? b3.b3RevoluteJoint_GetMotorTorque(m.joint) : b3.b3PrismaticJoint_GetMotorForce(m.joint));
}

/* One physics step of a machine near the viewer: the drive's torque at the measured speed, less the
   losses, is what the solver may apply to reach the drive's free-running speed. */
function stepMech(m: Mech, dt: number): void {
  if (!m.alive || !b3.b3Joint_IsValid(m.joint)) return;
  const w = measure(m, dt);
  m.w = w;
  const resist = m.fric + m.roll + m.dragK * w * w;
  const c = m.couple;
  if (c) {
    if (!c.driver.alive) { m.couple = null; return; }
    const target = (c.sign * c.driver.w) / c.ratio;
    const T = motorLoad(m);
    /* Power through the belt: what holds this shaft to speed (and its own losses) loads the driver. */
    const react = ((T + resist) * c.sign * Math.sign(target || 1)) / c.ratio;
    vec3.transformQuat(_d, c.driver.axis, c.driver.bound || !c.driver.host ? IDENT : quat.multiply(_q, c.driver.host.curRot, quat.conjugate(_qs, c.driver.host.spawnRot)));
    b3.b3Body_ApplyTorque(c.driver.part.body, [-_d[0] * react, -_d[1] * react, -_d[2] * react], false);
    if (c.kind !== 'belt' && T >= 0.97 * c.limit) {
      if (++c.over > 15) {
        m.couple = null;
        fx.sparks(m.part.curPos, m.axis, 16);
        audio.snap(m.part.curPos, 0.5);
        return;
      }
    } else c.over = 0;
    send(m, target, c.limit);
    m.rate = c.driver.rate;
    return;
  }
  const d = m.drive;
  if (m.running && d && (m.cmd !== undefined || m.cyc)) {
    /* Lever in the valve: flow (speed) in proportion, pressure (torque) up to the relief; centred, the valve
       locks the oil in the ram and the load is held. The machine's own cycle works the same lever. */
    const cmd = m.cmd ?? cycleCmd(m, d);
    const s = Math.sign(cmd), i = s >= 0 ? 0 : 1;
    if (Math.abs(cmd) < 0.02) send(m, 0, d.Tmax[0] + resist);
    else send(m, d.wS[i] * cmd * (m.motor!.speed >= 0 ? 1 : -1), Math.max(0, d.Tmax[i] - resist));
    m.rate = clamp(Math.abs(w) / d.wR, 0, 1);
    return;
  }
  if (m.running && d) {
    const s = (m.motor!.speed >= 0 ? 1 : -1) * m.dir, i = s > 0 ? 0 : 1;
    const wf = w * s;
    const T = d.kind === 'hydraulic' ? d.Tmax[i] : Math.min(d.Tmax[i], (d.Tr * (d.wS[i] - wf)) / (d.wS[i] - d.wR));
    const net = T - (wf >= 0 ? resist : -resist);
    if (net >= 0) send(m, d.wS[i] * s, net); else send(m, 0, -net);
    m.rate = clamp(Math.abs(w) / d.wR, 0, 1);
    if (d.kind === 'electric') {
      const I = Math.max(motorLoad(m) / d.Tr, ILR * clamp(1 - wf / d.wS[i], 0, 1), 0.3);
      d.heat += ((I * I - d.heat) * dt) / d.tau;
      if (d.heat > TRIP_AT) tripMotor(m, d);
    } else if (d.kind === 'diesel') {
      d.lugT = wf < d.idle * d.wR && T >= d.Tmax[i] * 0.98 ? d.lugT + dt : 0;
      if (d.lugT > LUG_GRACE) {
        d.lugT = 0; d.downUntil = clock + RESTART; stop(m);
        // lugged to a stall: a black puff and the engine dies
        fx.dust(m.part.curPos, 0.9, 0x1e1e1e);
        audio.toolEvent('stall', m.part.curPos);
      }
    }
    if (m.motor!.shuttle) shuttle(m);
    else if (m.lower !== undefined && m.upper !== undefined && atStop(m, s)) {
      /* a one-way axis run out to its stop: the valve centres (or the brake sets) and holds it there */
      m.hold = true;
      send(m, 0, d.Tmax[i] + resist);
      m.rate = 0;
    }
    return;
  }
  send(m, 0, resist + (m.brakesFailed ? 0 : m.brake));
}

function jointPos(m: Mech): number {
  return m.hinge ? b3.b3RevoluteJoint_GetAngle(m.joint) : b3.b3PrismaticJoint_GetTranslation(m.joint);
}

function atStop(m: Mech, s: number): boolean {
  const t = jointPos(m), eps = m.hinge ? 0.02 : 0.03;
  return (s > 0 && t >= m.upper! - eps) || (s < 0 && t <= m.lower! + eps);
}

/* Keyframed work cycle: the target position at this moment and its rate, a proportional correction on top; the
   lever is that speed over the drive's flow-limited speed. */
function cycleTarget(c: Cycle, t: number): [number, number] {
  const k = c.keys, T = c.period;
  const u = (((t + (c.phase ?? 0)) % T) + T) % T;
  for (let j = 0; j < k.length; j++) {
    const a = k[j], b = j + 1 < k.length ? k[j + 1] : [k[0][0] + T, k[0][1]] as [number, number];
    if (u >= a[0] && u < b[0]) { const f = (u - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * f, (b[1] - a[1]) / (b[0] - a[0])]; }
  }
  return [k[0][1], 0];
}
const CYCLE_GAIN = 2.5;       // 1/s
function cycleCmd(m: Mech, d: Drive): number {
  const [x, v] = cycleTarget(m.cyc!, clock);
  const e = x - jointPos(m);
  if (Math.abs(e) < (m.hinge ? 0.004 : 0.004) && v === 0) return 0;
  return clamp((v + CYCLE_GAIN * e) / (d.wS[0] * (m.motor!.speed >= 0 ? 1 : -1)), -1, 1);
}
const IDENT: Quat = [0, 0, 0, 1];
const _qs: Quat = [0, 0, 0, 1];

function stop(m: Mech): void {
  m.running = false;
  m.hold = false;
  m.rate = 0;
  send(m, 0, m.fric + m.roll + m.dragK * m.w * m.w + (m.brakesFailed ? 0 : m.brake));
}

/* Idle joint speed, read on the slow tick to decide whether a coasting part still needs stepping. */
function idleSpeed(m: Mech): number {
  if (!m.hinge) return b3.b3PrismaticJoint_GetSpeed(m.joint);
  b3.b3Body_GetAngularVelocity(_v, m.part.body);
  return vec3.dot(_v, m.axis);
}

/* Machines work inside WORK_IN m of the viewer (or while an operator has them) and stand down past WORK_OUT: the drive
   stops and the part sleeps with its load held on the valve or brake. A rotor out there keeps turning on screen only
   (Spin). A part whose body something wakes is handed back to the solver where it is drawn. */
const WORK_IN = 40, WORK_OUT = 48;
const spinning: Mech[] = [];
function updateMechs(): void {
  running = 0;
  mechList.length = 0;
  let followers = 0;
  for (const m of mechs.values()) {
    if (!m.alive) continue;
    const d = m.drive;
    const r = m.near ? WORK_OUT : WORK_IN;
    const near = m.cmd !== undefined || (m.couple ? m.couple.driver.near : vec3.squaredDistance(m.part.curPos, viewer) < r * r);
    m.near = near;
    if (m.roped && !m.brakesFailed && !m.part.ropes.length) m.brakesFailed = true;
    let could = !!m.couple && (m.couple.driver.running || !!m.couple.driver.spin?.live);
    if (d) {
      if (!m.running && d.heat > 0) {
        d.heat *= Math.exp(-TICK / d.tau);
        if (d.tripped && d.heat < TRIP_RESET && !m.burnt) d.tripped = false;
      }
      could = clock >= m.ready && !m.brakesFailed && !d.tripped && !d.cut && clock >= d.downUntil && (!!m.motor!.always || powered(m.host));
      const want = near && could && !m.spin;
      if (want !== m.running) {
        if (want) {
          m.running = true;
          m.hold = false;
          b3.b3Joint_WakeBodies(m.joint);
          // direct-on-line start: locked-rotor current for the first moments
          if (d.kind === 'electric' && m.host?.svc?.kind === 'power') faults.push({ p: m.host, I: ILR * (m.motor!.kW ?? (d.Tr * d.wR) / 900) * A_PER_KW, leak: 0, b: null });
        } else stop(m);
      }
      if (m.running) running++;
      if (m.burnt && clock - m.burnt < 30) {
        fx.dust(m.part.curPos, 0.35, 0x2a2826);
        fields.addSmoke(m.part.curPos, 8, 0.9, TICK);
      }
    }
    /* a rotor on a parked vehicle (a mixer's drum) is drawn turning even close by: run for real it keeps the whole
       vehicle awake; the moment anything wakes the vehicle it is handed back */
    const standIn = !near || (!!m.host && !m.bound && !m.host.hinged);
    if (m.spin) {
      if (!standIn || (m.bound || !m.host ? b3.b3Body_IsAwake(m.part.body) : hostMoving(m))) endSpin(m);
      else m.spin.live = could;
    } else if (standIn && could && spinnable(m)) startSpin(m);
    if (m.cyc && m.running) cycleEvents(m);
    if (m.crr > 0 && near) rolling(m);
    const act = near && ((m.running && !m.hold) || !!m.couple || Math.abs(m.active ? m.w : idleSpeed(m)) > 0.02);
    if (act && !m.active) {
      if (m.hinge) m.ang = b3.b3RevoluteJoint_GetAngle(m.joint);
      b3.b3Joint_WakeBodies(m.joint);
    }
    if (!act && !m.running && m.crr > 0) send(m, 0, m.fric + m.roll + (m.brakesFailed ? 0 : m.brake));
    if (!act && m.active) { m.w = 0; send(m, 0, m.fric + m.roll + (m.brakesFailed ? 0 : m.brake)); }
    m.active = act;
    if (!act) continue;
    if (m.couple) followers++; else mechList.push(m);
  }
  if (followers) for (const m of mechs.values()) if (m.active && m.couple) mechList.push(m);
  if (rigs.size) for (const c of rigs) stability(c);
  if (hoses.length) hoseSpray();
}

function hostMoving(m: Mech): boolean {
  b3.b3Body_GetLinearVelocity(_v, m.host!.body);
  return vec3.squaredLength(_v) > 0.04;
}

/* A free-turning rotor (no limits, not cycling) on an anchored or resting host, whose part is left alone. */
function spinnable(m: Mech): boolean {
  if (!m.hinge || m.lower !== undefined || m.cyc || m.part.ropes.length || m.part.dead) return false;
  if (m.drive ? !!m.motor!.shuttle || m.cmd !== undefined : !m.couple) return false;
  return m.bound || !m.host || !b3.b3Body_IsAwake(m.host.body) || !hostMoving(m);
}

const _sq: Quat = [0, 0, 0, 1], _sp: Vec3 = [0, 0, 0];
function startSpin(m: Mech): void {
  const p = m.part;
  const w = m.couple ? 0 : Math.abs(m.w) > 0.05 ? m.w : (m.drive!.wR * (m.motor!.speed >= 0 ? 1 : -1));
  b3.b3Body_GetWorldPoint(_sp, p.body, m.fb.position);
  quat.multiply(_sq, p.curRot, m.fb.quaternion);
  const axis = vec3.transformQuat([0, 0, 0], Z, _sq) as Vec3;
  m.spin = { w, ang: 0, pivot: [_sp[0], _sp[1], _sp[2]], axis, pos0: [p.curPos[0], p.curPos[1], p.curPos[2]], rot0: [p.curRot[0], p.curRot[1], p.curRot[2], p.curRot[3]], live: true };
  if (m.running) stop(m);
  send(m, 0, m.fric + m.brake);
  m.active = false;
  m.w = 0;
  b3.b3Body_SetAngularVelocity(p.body, [0, 0, 0]);
  b3.b3Body_SetAwake(p.body, false);
  spinning.push(m);
}

function spinPose(sp: Spin, ang: number, pos: Vec3, rot: Quat): void {
  quat.setAxisAngle(_sq, sp.axis, ang);
  vec3.sub(pos, sp.pos0, sp.pivot);
  vec3.transformQuat(pos, pos, _sq);
  vec3.add(pos, pos, sp.pivot);
  quat.multiply(rot, _sq, sp.rot0);
}

function endSpin(m: Mech): void {
  const sp = m.spin!, p = m.part;
  m.spin = null;
  const i = spinning.indexOf(m);
  if (i >= 0) spinning.splice(i, 1);
  if (p.dead) return;
  const pos: Vec3 = [0, 0, 0], rot: Quat = [0, 0, 0, 1];
  spinPose(sp, sp.ang, pos, rot);
  b3.b3Body_SetTransform(p.body, pos, rot);
  b3.b3Body_SetAngularVelocity(p.body, [sp.axis[0] * sp.w, sp.axis[1] * sp.w, sp.axis[2] * sp.w]);
  for (let k = 0; k < 4; k++) {
    if (k < 3) p.curPos[k] = p.prevPos[k] = pos[k];
    p.curRot[k] = p.prevRot[k] = rot[k];
  }
  if (m.hinge && b3.b3Joint_IsValid(m.joint)) m.ang = b3.b3RevoluteJoint_GetAngle(m.joint);
  b3.b3Joint_WakeBodies(m.joint);
}

function stepSpins(dt: number): void {
  for (const m of spinning) {
    const sp = m.spin!;
    if (m.couple) {
      const ds = m.couple.driver.spin;
      sp.w = ds ? (m.couple.sign * ds.w) / m.couple.ratio : sp.w * Math.exp(-dt / 6);
    } else if (!sp.live) sp.w *= Math.exp(-dt / 8);
    sp.ang += sp.w * dt;
    if (sp.ang > 2 * Math.PI) sp.ang -= 2 * Math.PI; else if (sp.ang < -2 * Math.PI) sp.ang += 2 * Math.PI;
  }
}

/** Draw the out-of-range rotors where they have turned to (render sync, between physics steps by `alpha`). */
const _dp: Vec3 = [0, 0, 0], _dq2: Quat = [0, 0, 0, 1];
export function drawStandIns(alpha: number, set: (p: Piece, pos: Vec3, rot: Quat) => void): void {
  for (const m of spinning) {
    const sp = m.spin!;
    if (m.part.dead) continue;
    spinPose(sp, sp.ang + sp.w * alpha * (1 / 60), _dp, _dq2);
    set(m.part, _dp, _dq2);
  }
}

/* A cycling axis passing its marks: a bucket biting below grade digs, tips at its dump position; a press strikes. */
const _bb2: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
function cycleEvents(m: Mech): void {
  const c = m.cyc!, p = m.part;
  const x = jointPos(m);
  if (c.dig !== undefined) {
    b3.b3Body_ComputeAABB(_bb2, p.body);
    const cx = (_bb2[0] + _bb2[3]) / 2, cz = (_bb2[2] + _bb2[5]) / 2, gy = groundAt(cx, cz);
    if (_bb2[1] < gy + 0.12 && m.load < c.dig) {
      // a 20 t machine's ~40 kW at the teeth over ~0.35 MJ/m³ of firm soil
      const want = Math.min(0.11 * TICK, c.dig - m.load), rad = 0.8;
      const got = dig(cx, cz, rad, want / (0.5 * Math.PI * rad * rad));
      m.load += got;
      if (got > 0) fx.dust([cx, gy + 0.1, cz], 0.6, 0x6b5a45);
    }
    if (c.dump !== undefined && m.load > 0.02 && Math.abs(x - c.dump) < 0.08) {
      const laid = mound(cx, cz, 1.3, m.load);
      fx.dust([cx, _bb2[1], cz], 1.0, 0x6b5a45);
      audio.toolEvent('dump', p.curPos);
      tally.dug += laid || m.load;
      m.load = 0;
    }
  }
  if (c.thump !== undefined && (c.thump < 0 ? x <= c.thump : x >= c.thump) && clock - m.evT > 1) {
    m.evT = clock;
    tally.strokes++;
    audio.impact(p.curPos, 'steel', 0.9);
    fx.sparks(p.curPos, [0, 1, 0], 6);
  }
}

/* An electric overload trips; the third trip inside a few minutes (the winding reset hot and loaded again each time)
   burns it out: it smokes, and it stays dead. */
function tripMotor(m: Mech, d: Drive): void {
  d.tripped = true;
  stop(m);
  m.trips = clock - m.evT < 180 ? m.trips + 1 : 1;
  m.evT = clock;
  fx.arc(m.part.curPos, 0.35);
  fx.dust(m.part.curPos, 0.4, 0x3b3b3b);
  if (m.trips >= 3 && !m.burnt) {
    m.burnt = clock;
    tally.burnouts++;
    audio.utility('burnout', m.part.curPos);
  }
}

/* Rolling resistance on a wheel's actual axle load (the chassis weight it carries once it rolls). */
function rolling(m: Mech): void {
  let N = m.part.mass * G;
  if (!m.bound) { b3.b3Joint_GetConstraintForce(_v, m.joint); N += vec3.length(_v); }
  m.roll = m.crr * N * m.radius;
}

function shuttle(m: Mech): void {
  if (m.lower === undefined || m.upper === undefined) return;
  const t = m.hinge ? b3.b3RevoluteJoint_GetAngle(m.joint) : b3.b3PrismaticJoint_GetTranslation(m.joint);
  const s = m.motor!.speed >= 0 ? m.dir : -m.dir;
  const eps = m.hinge ? 0.02 : 0.03;
  if ((s > 0 && t >= m.upper - eps) || (s < 0 && t <= m.lower + eps)) m.dir = -m.dir;
}

/* A hard hit on a machine's host: a burst hydraulic hose drops whatever the ram held; a holed tank spills.
   Steel hosts take no damage of their own, so the blow's energy decides for them. */
const HOSE_CUT = 30e3, TANK_HOLE = 60e3;
export function mechHarm(p: Piece, energy: number): void {
  if (!p.mechs) return;
  for (const m of p.mechs) {
    const d = m.drive;
    if (!d || !m.alive) continue;
    const hurt = (k: number, e: number) => p.damage >= p.hp * k || energy >= e;
    if (d.tank > 0 && hurt(0.6, TANK_HOLE)) rupture(m);
    if (m.host !== p) continue;
    if (d.kind === 'hydraulic' && !d.cut && hurt(0.3, HOSE_CUT)) burstHose(m);
  }
}

/* A burst hose: the oil in the line goes as a mist and a jet (a few seconds of it, ~20 L on the ground), the ram
   loses its pressure and whatever it held comes down under its own weight, the valve no longer locking it. */
const hoses: { m: Mech; t: number; dir: Vec3 }[] = [];
function burstHose(m: Mech): void {
  const d = m.drive!;
  d.cut = true;
  m.brake = 0;
  m.cmd = undefined;
  m.cyc = null;
  stop(m);
  send(m, 0, m.fric);
  b3.b3Joint_WakeBodies(m.joint);
  tally.hoses++;
  const a = rnd() * 2 * Math.PI;
  hoses.push({ m, t: 3 + 2 * rnd(), dir: [Math.cos(a), 0.4, Math.sin(a)] });
  audio.utility('hose', (m.host ?? m.part).curPos);
  const at = m.host ?? m.part;
  spill([at.curPos[0], Math.max(0.05, at.curPos[1] - 0.8), at.curPos[2]], 20, false);
}

function hoseSpray(): void {
  for (let i = hoses.length - 1; i >= 0; i--) {
    const h = hoses[i], at = h.m.host ?? h.m.part;
    h.t -= TICK;
    if (h.t <= 0 || at.dead) { hoses.splice(i, 1); continue; }
    fx.gasVent(at.curPos, h.dir, 0.5);
    fx.dust(at.curPos, 0.5, 0x2b2620);
  }
}

/** Burst the hydraulic line of a machine axis (tools, tests). */
export function mechBurst(p: Piece): boolean {
  const m = p.mechs?.find(x => x.part === p);
  if (!m || m.drive?.kind !== 'hydraulic' || m.drive.cut) return false;
  burstHose(m);
  return true;
}

function rupture(m: Mech): void {
  const d = m.drive!, at = m.host ?? m.part;
  spill([at.curPos[0], Math.max(0.05, at.curPos[1] - 0.5), at.curPos[2]], d.tank, m.running || rnd() < 0.3);
  d.tank = 0;
}

/* Diesel on the ground: a pool fire whose size follows the spill and whose life its burning rate
   (~0.045 kg/m²·s), played ten times faster. */
export function spill(pos: Vec3, litres: number, lit: boolean): void {
  if (litres <= 0 || pools.length > 12) return;
  const area = clamp(litres / 5, 1, 50);
  const r = Math.sqrt(area / Math.PI);
  const t = clamp((litres * 0.84) / (0.045 * area) / 10, 12, 120);
  const pool = { pos: [pos[0], Math.max(0.05, pos[1]), pos[2]] as Vec3, t, r, lit };
  pools.push(pool);
  if (lit) fx.fire(pool.pos, t, clamp(r * 0.8, 0.6, 3));
  else fx.dust(pool.pos, r, 0x2a2622);
}

function updatePools(): void {
  for (let i = pools.length - 1; i >= 0; i--) {
    const f = pools[i];
    f.t -= TICK;
    if (f.t <= 0) { pools.splice(i, 1); continue; }
    if (!f.lit) continue;
    const r = f.r + 1, h = f.r + 2.5;
    overlapAABB([f.pos[0] - r, f.pos[1] - 0.5, f.pos[2] - r], [f.pos[0] + r, f.pos[1] + h, f.pos[2] + r], CAT.structure | CAT.debris | CAT.prop, shape => {
      const e = entityOfShape(shape);
      if (!e || e.kind !== 'piece') return;
      const q = e as Piece;
      if (q.dead || q.burning) return;
      q.temp += (800 - q.temp) * q.pm.thermal.absorb;
      heat(q, 0.01);
      if (flammable(q.pm) && rnd() < 0.05) ignite(q);
    });
  }
}

/* Joint events: only a sustained overload tears the part free (spawn and impact spikes don't). */
export function mechBroken(id: b3JointId, step: number): boolean {
  const m = mechs.get(id.index1);
  if (!m || m.joint.generation !== id.generation) return false;
  if (m.lastOver < step - 2) m.overSteps = 0;
  m.lastOver = step;
  if (++m.overSteps >= 3) {
    b3.b3Body_GetWorldPoint(_v, m.part.body, [0, 0, 0]);
    killMech(m, true);
    fx.sparks(_v, [0, 1, 0], 14);
    audio.snap(_v, 0.6);
  }
  return true;
}

export function killMech(m: Mech, destroyJoint: boolean): void {
  if (!m.alive) return;
  m.alive = false;
  m.running = false;
  m.active = false;
  if (m.drive && m.drive.tank > 0 && (m.host?.dead || m.part.dead)) rupture(m);
  if (mechs.get(m.joint.index1) === m) mechs.delete(m.joint.index1);
  const li = mechList.indexOf(m);
  if (li >= 0) mechList.splice(li, 1);
  for (const q of [m.part, m.host]) {
    if (!q?.mechs) continue;
    const i = q.mechs.indexOf(m);
    if (i >= 0) q.mechs.splice(i, 1);
  }
  if (m.bound && m.host) { m.bound = false; m.host.proxied--; }
  const p = m.part;
  p.hinged = false;
  if (!p.dead) {
    if (m.mass0) b3.b3Body_SetMassData(p.body, m.mass0);
    dropTyre(m);
    if (m.hinge) setRolling(p, LOOSE_ROLLING);
    p.spawnPos[0] = p.curPos[0]; p.spawnPos[1] = p.curPos[1]; p.spawnPos[2] = p.curPos[2];
    p.spawnRot[0] = p.curRot[0]; p.spawnRot[1] = p.curRot[1]; p.spawnRot[2] = p.curRot[2]; p.spawnRot[3] = p.curRot[3];
  }
  if (destroyJoint && b3.b3Joint_IsValid(m.joint)) b3.b3DestroyJoint(m.joint, true);
  else if (!p.dead) b3.b3Body_SetAwake(p.body, true);
}

export function mechPartsOf(p: Piece): Piece[] {
  return p.mechs ? p.mechs.filter(m => m.host === p).map(m => m.part) : [];
}

/** The non-moving member that ultimately carries a machine part (through a chain of moving parts), if any. */
export function machineRoot(p: Piece): Piece | null {
  let q: Piece | null = p;
  for (let i = 0; i < 8 && q?.hinged; i++) q = q.mechs?.find(m => m.part === q)?.host ?? null;
  return q && q !== p && !q.hinged ? q : null;
}

/** Operator control of a machine axis: `cmd` -1..1 drives the part's own motor through its valve (0 holds),
    null hands it back to the machine's own cycle. Returns false when the part has no drive of its own. */
export function mechCommand(p: Piece, cmd: number | null): boolean {
  const m = p.mechs?.find(x => x.part === p);
  if (!m || !m.drive || !m.alive) return false;
  if (cmd === null) { m.cmd = undefined; return true; }
  const c = clamp(cmd, -1, 1);
  if (m.cmd !== c && Math.abs(c) > 0.02 && b3.b3Joint_IsValid(m.joint)) b3.b3Joint_WakeBodies(m.joint);
  m.cmd = c;
  return true;
}

/** The machine `p` belongs to: its welded frame and every part riding on it (`all`), and its driven axes nearest the
    frame first (`axes`), for an operator's controls. */
export function machineParts(p: Piece): { all: Piece[]; axes: Piece[] } {
  const seen = new Set<Piece>([p]), q: Piece[] = [p], out: Piece[] = [];
  for (let i = 0; i < q.length && q.length < 400; i++) {
    const c = q[i];
    for (const w of c.welds) {
      const o = w.b ? (w.a === c ? w.b : w.a) : null;
      if (w.alive && o && !seen.has(o)) { seen.add(o); q.push(o); }
    }
    if (c.mechs) for (const m of c.mechs) {
      if (!m.alive) continue;
      const o = m.part === c ? m.host : m.part;
      if (o && !seen.has(o)) { seen.add(o); q.push(o); }
      if (m.part === c && m.drive && !out.includes(c)) out.push(c);
    }
  }
  return { all: q, axes: out };
}

export function machineAxes(p: Piece): Piece[] { return machineParts(p).axes; }

/** An axis's drive state for an operator's gauges. */
export function mechGauge(p: Piece): { kind: string; running: boolean; cut: boolean; tripped: boolean; burnt: boolean; stalled: boolean; load: number } | null {
  const m = p.mechs?.find(x => x.part === p);
  const d = m?.drive;
  if (!m || !d) return null;
  return { kind: d.kind, running: m.running, cut: d.cut, tripped: d.tripped, burnt: m.burnt > 0, stalled: clock < d.downUntil, load: m.running ? clamp(m.tq / Math.max(1, d.Tmax[0]), 0, 1) : 0 };
}

/** Joint position of a machine axis (rad or m) and its limits. */
export function mechPose(p: Piece): { at: number; lower: number | undefined; upper: number | undefined; hinge: boolean; axis: Vec3; host: Piece | null } | null {
  const m = p.mechs?.find(x => x.part === p);
  if (!m || !b3.b3Joint_IsValid(m.joint)) return null;
  const at = m.hinge ? b3.b3RevoluteJoint_GetAngle(m.joint) : b3.b3PrismaticJoint_GetTranslation(m.joint);
  return { at, lower: m.lower, upper: m.upper, hinge: m.hinge, axis: m.axis, host: m.host };
}

/** Machine state for tools and tests. */
export function mechState(p: Piece): { running: boolean; speed: number; tripped: boolean; heat: number; cut: boolean; stalled: boolean } | null {
  const m = p.mechs?.find(x => x.part === p);
  if (!m) return null;
  const d = m.drive;
  return { running: m.running, speed: m.w, tripped: !!d?.tripped, heat: d?.heat ?? 0, cut: !!d?.cut, stalled: !!d && clock < d.downUntil };
}

/* ---------------- cranes on outriggers ---------------- */

/* A mobile crane stands on its jacks. Its carrier is anchored to the ground while it is sound, the boom's joints to the
   world, so nothing in the solver would ever tip it: this is the load-moment check its computer makes. Every piece of
   the machine, its hook and whatever hangs taut under the hook put their weight where they are; once that centre of
   gravity passes outside the jacks' footprint the overturning moment beats the restoring one about the tipping line,
   and the machine is handed to the solver standing free on its pads, its joints carried by the carrier. */
const rigs = new Set<Piece>();
export function svcRig(p: Piece): void { rigs.add(p); }

interface RigState { mass: number; load: number; cg: Vec3; margin: number; feet: number }
const rigInfo = new Map<Piece, RigState>();

function rigPieces(c: Piece, out: Set<Piece>): Piece[] {
  const q: Piece[] = [c];
  out.add(c);
  const feet: Piece[] = [];
  for (let i = 0; i < q.length && i < 400; i++) {
    const p = q[i];
    for (const w of p.welds) {
      if (!w.alive) continue;
      if (!w.b) { if (!feet.includes(p)) feet.push(p); continue; }
      const o = w.a === p ? w.b : w.a;
      if (!out.has(o)) { out.add(o); q.push(o); }
    }
    if (p.mechs) for (const m of p.mechs) if (m.host === p && m.alive && !out.has(m.part)) { out.add(m.part); q.push(m.part); }
    for (const r of p.ropes) {
      if (!r.alive || r.kind === 'wire') continue;
      const o = r.a === p ? r.b : r.a;
      if (out.has(o) || o.dead) continue;
      // hanging on the line (taut, below): its weight is on the hook, not the ground
      if (vec3.distance(r.a.curPos, r.b.curPos) < r.maxLength - 0.05 || o.curPos[1] > p.curPos[1]) continue;
      out.add(o);
      q.push(o);
    }
  }
  return feet;
}

const _hull: [number, number][] = [];
function stability(c: Piece): void {
  if (c.dead) { rigs.delete(c); return; }
  const set = new Set<Piece>();
  const feet = rigPieces(c, set);
  if (!feet.length) { rigs.delete(c); return; }
  let M = 0, x = 0, y = 0, z = 0, load = 0;
  for (const p of set) {
    if (p.dead) continue;
    M += p.mass; x += p.mass * p.curPos[0]; y += p.mass * p.curPos[1]; z += p.mass * p.curPos[2];
    if (!p.welds.length && !p.hinged) load += p.mass;
  }
  const cg: Vec3 = [x / M, y / M, z / M];
  // the jacks' footprint: the convex hull of their pads
  const pts: [number, number][] = [];
  for (const f of feet) {
    b3.b3Body_ComputeAABB(_bb2, f.body);
    pts.push([_bb2[0], _bb2[2]], [_bb2[3], _bb2[2]], [_bb2[0], _bb2[5]], [_bb2[3], _bb2[5]]);
  }
  hull2(pts, _hull);
  let margin = Infinity;
  for (let i = 0; i < _hull.length; i++) {
    const a = _hull[i], b = _hull[(i + 1) % _hull.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    margin = Math.min(margin, (ex * (cg[2] - a[1]) - ez * (cg[0] - a[0])) / L);
  }
  if (_hull.length < 3) margin = -1;
  rigInfo.set(c, { mass: M, load, cg, margin, feet: feet.length });
  if (margin >= 0) return;
  tally.tipped++;
  rigs.delete(c);
  audio.steelGroan(c.curPos, 1);
  for (const p of set) if (p.proxied) svcHostMoved(p);
  for (const f of feet) { releaseGround(f); b3.b3Body_SetAwake(f.body, true); }
  for (const p of set) if (!p.dead) b3.b3Body_SetAwake(p.body, true);
}

/* counter-clockwise convex hull (monotone chain) */
function hull2(pts: [number, number][], out: [number, number][]): void {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  out.length = 0;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (const p of pts) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); }
  const lo = out.length + 1;
  for (let i = pts.length - 2; i >= 0; i--) { const p = pts[i]; while (out.length >= lo && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); }
  out.pop();
}

/** Load-moment state of a crane on outriggers: machine mass, hanging load (kg), centre of gravity and its margin inside
    the footprint (m, negative = tipping). */
export function rigState(p: Piece): RigState | null {
  let c: Piece | null = null;
  for (const r of rigs) if (r === p || r.root.spec.group === p.root.spec.group) c = r;
  if (c) stability(c);
  return c ? rigInfo.get(c) ?? null : null;
}

/* ---------------- material on conveyors ---------------- */

const carried = new Set<Piece>();
export function svcCarry(p: Piece): void { carried.add(p); }

/* Cartons ride the rollers to the end of the line, where they are taken off and fed back on at its head. */
function stepCarry(): void {
  if (stepCount % 15) return;
  for (const p of carried) {
    if (p.dead) { carried.delete(p); continue; }
    const c = p.root.spec.carry!;
    const dx = c.to[0] - c.from[0], dz = c.to[2] - c.from[2], L2 = dx * dx + dz * dz;
    const u = ((p.curPos[0] - c.from[0]) * dx + (p.curPos[2] - c.from[2]) * dz) / L2;
    const off = Math.abs((p.curPos[0] - c.from[0]) * dz - (p.curPos[2] - c.from[2]) * dx) / Math.sqrt(L2);
    if (off > 1.5 || p.curPos[1] < c.to[1] - 1.5) { carried.delete(p); continue; }   // knocked off the line: it is just a box now
    if (u < 1) continue;
    let busy = false;
    for (const q of carried) if (q !== p && vec3.squaredDistance(q.curPos, c.from) < 0.5) busy = true;
    if (busy) continue;
    b3.b3Body_SetTransform(p.body, c.from, [0, 0, 0, 1]);
    b3.b3Body_SetLinearVelocity(p.body, [0, 0, 0]);
    b3.b3Body_SetAngularVelocity(p.body, [0, 0, 0]);
    b3.b3Body_SetAwake(p.body, true);
  }
}

/* ---------------- lifecycle, stats, x-ray ---------------- */

export function refreshServices(): void {
  for (const s of sources) s.svc!.live = sourceLive(s);
  recompute();
  pushLights();
}

export function clearServices(): void {
  members.clear(); sources.clear(); lamps.clear(); gates.clear(); sprinklers.clear(); flicker.clear(); mechs.clear();
  breaks.length = 0; blowouts.length = 0; mechList.length = 0; pools.length = 0; nets.length = 0;
  svcLinks.clear(); encs.clear(); linkStep = -1;
  badLinks.clear(); wetGear.clear(); exposed.length = 0; hvGear.length = 0; faults.length = 0; coronaOn = false;
  watch.length = 0; spinning.length = 0; hoses.length = 0; rigs.clear(); rigInfo.clear(); carried.clear(); alarms.clear(); seed = 1;
  clearElectrical();
  topoDirty = true; clock = 0; tickT = 0; lampsLit = 0; running = 0;
  activeCount = { power: 0, gas: 0, water: 0, steam: 0 };
  for (const k of Object.keys(tally) as (keyof typeof tally)[]) tally[k] = 0;
  svcCost.ms = 0; svcCost.steps = 0;
  lampLights.clear();
}

export function serviceStats(): { services: number; lampsLit: number; arcs: number; jets: number; mechs: number; mechsRunning: number }
  & { [K in keyof typeof tally]: number } {
  return {
    services: members.size, lampsLit, arcs: activeCount.power, jets: activeCount.gas + activeCount.water + activeCount.steam,
    mechs: mechs.size, mechsRunning: running, ...tally,
  };
}

/** Open breaks for tools and tests: where, how big, full-bore or a weep, lit, arcing, the network pressure. */
export function serviceBreaks(): { kind: UtilityKind; pos: Vec3; size: number; q: number; full: boolean; leak: boolean; lit: boolean; arcing: boolean; contact: number; spr: boolean; P: number; piece: Piece; gate: Piece | null; ia: number; ins: boolean }[] {
  return breaks.filter(b => !b.gone && !b.p.dead && b.p.svc!.on).map(b => {
    breakWorld(b);
    return { kind: b.kind, pos: [_v[0], _v[1], _v[2]] as Vec3, size: b.size, q: b.q, full: b.full, leak: !!b.link, lit: b.lit, arcing: b.arcing,
      contact: b.contact, spr: b.spr, P: nets[b.p.svc!.net]?.P ?? 0, piece: b.p, gate: b.p.svc!.gate, ia: b.ia, ins: b.ins };
  });
}

/* ---------------- electrical API ---------------- */

/** Lightning's surge into the power networks around `pos` (kA peak). A direct hit or side flash onto a member puts
    ~kA × 200 Ω (half a line's surge impedance) on its network; elsewhere a conductor h m up at d m picks up
    30·I·h/d kV (Rusck), a buried cable a tenth of that. Past its withstand (~100 kV for an overhead line's insulators
    and outdoor gear, 12 kV for indoor gear behind its surge protection, the 95 kV BIL of the 11 kV side) a network
    flashes over at its most stressed point; lamps near the strike burst, RCDs nuisance-trip on a big surge, and a pad
    transformer whose HV side takes more than its BIL (with arresters, ~150 kV) blows. */
export function svcSurge(pos: ArrayLike<number>, kA: number, direct: Piece | null): { nets: number; flashovers: number; lamps: number; trips: number; blown: number } {
  tally.surges++;
  const res = { nets: 0, flashovers: 0, lamps: 0, trips: 0, blown: 0 };
  const dnet = direct?.svc?.kind === 'power' && direct.svc.on ? direct.svc.net : -1;
  const worst = new Map<number, { p: Piece; U: number; W: number }>();
  const dist = (p: Piece) => Math.max(3, Math.hypot(p.curPos[0] - pos[0], p.curPos[1] - pos[1], p.curPos[2] - pos[2]));
  for (const p of members) {
    const m = p.svc!;
    if (m.kind !== 'power' || !m.on || m.net < 0 || m.source) continue;
    const d = p === direct ? 3 : dist(p), h = p.curPos[1];
    const U = m.net === dnet ? kA * 200 * Math.exp(-d / 300) : ((30 * kA * Math.max(h, 0.3)) / d) * (h < 1 ? 0.1 : 1);
    const W = m.hv ? 95 : h > 2.5 && !m.lamp ? 100 : 12;
    const w = worst.get(m.net);
    if (!w || U / W > w.U / w.W) worst.set(m.net, { p, U, W });
  }
  for (const [ni, w] of worst) {
    if (w.U < 2) continue;
    res.nets++;
    const over = w.U > w.W;
    if (over) { insulationFault(w.p, true); res.flashovers++; }
    for (const g of gates) {
      const gm = g.svc!;
      if (gm.net === ni && gm.dev?.rcd && !gm.closed && w.U > 20 && rnd() < 0.4) { trip(g); res.trips++; }
    }
    const reach = ni === dnet ? 150 : over ? 25 : 0;
    if (reach) for (const p of lamps) {
      const m = p.svc!;
      if (m.net !== ni || m.blown || !m.on || dist(p) > reach) continue;
      m.blown = true;
      setEmit(p, 0);
      fx.shards(p.curPos, 5);
      audio.fracture(p.curPos, 'lamp', 0.3);
      res.lamps++;
    }
    const s = nets[ni].src;
    if (s.svc!.fixture === 'transformer' && netBig[ni] && !s.svc!.blown) {
      const Ut = ni === dnet ? w.U : (30 * kA * 6) / dist(s);
      if (Ut > 150) { svcHarm(s, true); res.blown++; }
    }
  }
  topoDirty = true;
  return res;
}

/** Work a power joint loose (0..1): between `a` and `b`, or `a`'s first power joint. */
export function svcLoosen(a: Piece, b: Piece | null, s: number): boolean {
  const l = a.svc?.links.find((x) => x.a.svc!.kind === 'power' && (!b || x.a === b || x.b === b));
  if (!l) return false;
  loosen(l, s);
  return true;
}

/** Power joints that are loose, oxidised or hot: where, how hot, how bad, what they carry. */
export function svcContacts(): { a: Piece; b: Piece; pos: Vec3; loose: number; ox: number; rc: number; ct: number; i: number }[] {
  return [...badLinks].map((l) => ({ a: l.a, b: l.b, pos: toWorld([0, 0, 0], l.a, l.la), loose: l.loose, ox: l.ox, rc: l.rc, ct: l.ct, i: l.i }));
}

/** Put water on live gear (0..1, >1 immersed). */
export function svcWet(p: Piece, w: number): void {
  const m = p.svc;
  if (!m || m.kind !== 'power') return;
  m.wet = Math.max(m.wet, w);
  wetGear.add(p);
}

/** The circuit at a power member: loop impedance, prospective bolted fault current, and the devices between it and the
    source (nearest first) with their ratings and operating times for that fault. */
export function svcCircuit(p: Piece): { ez: number; u0: number; ibf: number; hv: boolean; wet: number; track: number;
  devices: { piece: Piece; curve: string; In: number; rcd: boolean; t: number; H: number; closed: boolean }[] } | null {
  const m = p.svc;
  if (!m || m.kind !== 'power' || m.net < 0) return null;
  const u0 = m.hv ? U0_HV : nets[m.net].u0, ibf = u0 / Math.max(m.ez, 1e-3), I = m.hv ? ibf * HV_RATIO : ibf;
  const devices: { piece: Piece; curve: string; In: number; rcd: boolean; t: number; H: number; closed: boolean }[] = [];
  for (let g = m.gate, h = 0; g && h < 8; g = g.svc!.up, h++) {
    const d = g.svc!.dev;
    if (d) devices.push({ piece: g, curve: d.curve, In: d.In, rcd: d.rcd, t: tripTime(d, I, I), H: d.H, closed: g.svc!.closed });
  }
  return { ez: m.ez, u0, ibf, hv: m.hv, wet: m.wet, track: m.track, devices };
}

/** Live networks: kind, source, supply pressure share and open area. */
export function serviceNets(): { kind: UtilityKind; src: Piece; P: number; area: number; cap: number }[] {
  return nets.map(n => ({ kind: n.kind, src: n.src, P: n.P, area: n.area, cap: n.cap }));
}

/** Gas collected in buildings: m³ and fraction of the mixing volume. */
export function serviceGas(): { group: string; gas: number; frac: number }[] {
  const out: { group: string; gas: number; frac: number }[] = [];
  for (const e of encs.values()) {
    if (!e) continue;
    const g = roomGas(e);
    if (g.mean > 1e-5) out.push({ group: e.group, gas: g.mean * g.vol, frac: g.mean });
  }
  return out;
}

const KIND_RGB: Record<UtilityKind, [number, number, number]> = {
  power: [1, 0.85, 0.1], gas: [1, 0.45, 0.05], water: [0.15, 0.5, 1], steam: [0.95, 0.95, 0.95],
};

export function serviceColor(p: Piece, out: [number, number, number]): [number, number, number] {
  const m = p.svc;
  if (!m) { out[0] = out[1] = out[2] = 0.07; return out; }
  if (!m.on) { out[0] = out[1] = out[2] = 0.25; return out; }
  const c = KIND_RGB[m.kind];
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}

/* Services x-ray: every member a dot in its network's colour (grey dead), sources large; a bead runs along each live
   length from the member feeding it, so the flow direction and what feeds what can be read at a glance; shut gates
   are red rings (blinking when a fault tripped them), standby sets amber, lamps on battery white, alarms red. */
const _xa: Vec3 = [0, 0, 0];
export function serviceDots(push: (p: Vec3, r: number, cr: number, cg: number, cb: number) => void, pulse: number): void {
  const blink = Math.sin(pulse * 10) > 0;
  for (const p of members) {
    const m = p.svc!;
    const c = KIND_RGB[m.kind];
    if (m.closed) { if (!(m.fault > 0 || m.dev?.H) || blink) push(p.curPos, 0.18, 1, 0.1, 0.1); }
    else if (m.standby) push(p.curPos, 0.24, 1, m.run ? 0.85 : 0.55, m.run || !(m.startT > 0 && blink) ? 0.1 : 0.6);
    else if (m.lamp && !m.on && m.batt > 0) push(p.curPos, 0.12, 0.9, 1, 0.95);
    else if (m.on) push(p.curPos, m.source ? 0.2 : 0.07, c[0], c[1], c[2]);
    else push(p.curPos, m.source ? 0.14 : 0.05, 0.28, 0.28, 0.28);
    const f = m.fp;
    if (!m.on || !f || vec3.squaredDistance(p.curPos, viewer) > 3600) continue;
    const u = (pulse * (m.kind === 'power' ? 1.6 : 0.7) + p.id * 0.618) % 1;
    vec3.lerp(_xa, f.curPos, p.curPos, u);
    push(_xa, 0.045, 0.6 + 0.4 * c[0], 0.6 + 0.4 * c[1], 0.6 + 0.4 * c[2]);
  }
  for (const a of alarms.values()) if (blink) push(a.pos, 0.35, 1, 0.08, 0.05);
  const beat = 0.55 + 0.45 * Math.sin(pulse * 14);
  for (const b of breaks) {
    if (!b.active || b.p.dead) continue;
    breakWorld(b);
    const c = KIND_RGB[b.kind];
    push(_v, 0.12 + 0.14 * beat, c[0] * beat + (1 - beat), c[1] * beat + (1 - beat), c[2] * beat + (1 - beat));
  }
  for (const m of mechs.values()) {
    b3.b3Body_GetWorldPoint(_v, m.part.body, [0, 0, 0]);
    push(_v, 0.1, m.running ? 0.3 : 0.2, m.running ? 1 : 0.35, m.running ? 0.6 : 0.3);
  }
}
