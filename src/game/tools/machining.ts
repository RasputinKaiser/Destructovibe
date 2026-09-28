/* Held demolition kit: disc cutter, chainsaw, drill rig, hydraulic jaws, plasma and oxy-fuel.
   Every cut is progressive and energy-limited: time = volume removed × specific energy / (power × η).
   The share of the input that doesn't remove material heats the member near the cut; the rest leaves
   in chips, sparks and slag. */
import { vec3, quat, clamp } from 'math';
import type { Vec3, Quat, MaterialId } from '../../types';
import { b3, raycast } from '../../physics/physics';
import {
  sever, heat, ignite, damagePiece, applyImpulseAt, weakenPiece, limitPiece, cutRebarNear, pieceOf, weldPos, type Piece,
} from '../../destruction/structure';
import { sectionOf } from '../../destruction/materials';
import { memberAxial } from '../../destruction/analysis';
import * as P from '../../destruction/polytope';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { viewmodel } from '../../render/viewmodel';
import { NO_HIT, piecesNear, memberAxis } from './common';

export type MachineTool = 'grinder' | 'saw' | 'drill' | 'shears' | 'plasma' | 'torch';
export const MACHINE_TOOLS: readonly MachineTool[] = ['grinder', 'saw', 'drill', 'shears', 'plasma', 'torch'];
export const isMachineTool = (id: string): id is MachineTool => (MACHINE_TOOLS as readonly string[]).includes(id);

/* Site time: material removal that takes minutes on a real job runs this many times faster, the same
   compression the fire model uses for charring. Hydraulic strokes are human-scale and stay real-time. */
export const SITE_TIME = 12;
const AMBIENT = 20;

type Cls = 'metal' | 'mineral' | 'timber' | 'soft' | 'glass';
interface CutMat {
  /** specific cutting energy, J/mm³ (sharp teeth / diamond; abrasive grinding costs ABRASIVE × this) */
  e: number;
  /** specific heat, J/(kg·K) */
  c: number;
  cls: Cls;
  /** melting point °C and latent heat J/kg: what a plasma or oxy kerf must supply */
  melt?: [number, number];
  /** oxy-fuel cuttable: the oxide melts below the metal and the burn is exothermic */
  ferrous?: boolean;
  /** conductivity W/(m·K), for how fast cut heat spreads along the member */
  k: number;
}
const M = (e: number, c: number, cls: Cls, k: number, melt?: [number, number], ferrous = false): CutMat => ({ e, c, cls, k, melt, ferrous });
const STEEL = M(3, 490, 'metal', 50, [1500, 272e3], true);
const CONCRETE = M(15, 880, 'mineral', 1.6, [1500, 400e3]);
const TIMBER = M(0.1, 1700, 'timber', 0.13);
const CUT: Record<MaterialId, CutMat> = {
  steel: STEEL, metal: STEEL, machine: STEEL, barrel: STEEL, propane: STEEL,
  castiron: M(2.2, 460, 'metal', 50, [1200, 270e3]),
  aluminum: M(0.7, 900, 'metal', 200, [600, 397e3]),
  copper: M(1.6, 385, 'metal', 390, [1085, 205e3]),
  concrete: CONCRETE,
  rconcrete: M(18, 880, 'mineral', 1.8, [1500, 400e3]),
  brick: M(9, 840, 'mineral', 0.8, [1400, 400e3]),
  cinderblock: M(6, 880, 'mineral', 0.6, [1400, 400e3]),
  stone: M(25, 790, 'mineral', 2.8, [1300, 400e3]),
  sandstone: M(8, 920, 'mineral', 2, [1300, 400e3]),
  marble: M(18, 880, 'mineral', 2.5, [1300, 400e3]),
  terracotta: M(8, 840, 'mineral', 0.8, [1400, 400e3]),
  ceramic: M(12, 840, 'mineral', 1, [1400, 400e3]),
  asphalt: M(3, 920, 'mineral', 0.75),
  adobe: M(1.5, 900, 'mineral', 0.6),
  plaster: M(1, 1000, 'soft', 0.5),
  drywall: M(0.3, 1090, 'soft', 0.25),
  roof: M(8, 840, 'mineral', 0.8),
  wood: TIMBER, crate: TIMBER, tnt: TIMBER,
  oak: M(0.16, 1700, 'timber', 0.17),
  plywood: M(0.12, 1700, 'timber', 0.13),
  pvc: M(0.2, 1000, 'soft', 0.19),
  insulation: M(0.01, 1400, 'soft', 0.025), frp: M(0.6, 1100, 'soft', 0.35), cardboard: M(0.02, 1300, 'soft', 0.06), rubber: M(0.08, 1900, 'soft', 0.15),
  glass: M(10, 840, 'glass', 1), tempered: M(10, 840, 'glass', 1), lamp: M(10, 840, 'glass', 1),
};
/* Abrasive cut-off wheels plough and rub with negative-rake grits: ~2.5× the energy of a sharp tool. */
const ABRASIVE = 2.5;
/* Rotary-percussive drilling crushes brittle mineral instead of grinding it: a Ø40 SDS-max bore through
   200 mm of concrete takes ~75 s at ~750 W on the bit, ≈0.2 J/mm³. */
const PERCUSSIVE = 0.015;

interface Tool {
  name: string;
  power: number;   // W at the disc / chain / spindle / arc / flame
  eff: number;     // share of power that removes material
  blade: number;   // share of power that ends up in the blade
  kerf: number;    // m
  reach: number;   // m from the eye
  depth: number;   // m it sinks per side; solid members up to twice this
}
const TOOLS: Record<MachineTool, Tool> = {
  // 230 mm grinder: 2.3 kW, disc Ø230 on a Ø60 flange, 3 mm cut-off / diamond disc
  grinder: { name: 'Disc cutter', power: 2300, eff: 0.6, blade: 0.12, kerf: 0.003, reach: 1.9, depth: 0.085, },
  // 3 kW chainsaw, 18" bar, 8 mm kerf
  saw: { name: 'Chainsaw', power: 3000, eff: 0.5, blade: 0.05, kerf: 0.008, reach: 1.9, depth: 0.42 },
  // SDS-max 1.5 kW hammer drill (Ø40 bit) for masonry, 1.2 kW magnetic drill with Ø30 annular cutter for steel
  drill: { name: 'Drill rig', power: 1500, eff: 0.5, blade: 0.08, kerf: 0.004, reach: 1.9, depth: 0.5 },
  shears: { name: 'Hydraulic jaws', power: 0, eff: 0, blade: 0, kerf: 0, reach: 2.1, depth: 0.2 },
  // 12 kW air plasma: ~40% of the arc goes into the kerf on thin plate, falling off with thickness
  plasma: { name: 'Plasma cutter', power: 12000, eff: 0.4, blade: 0, kerf: 0.0016, reach: 1.8, depth: 0.05 },
  // oxy-acetylene cutting torch, ~8 kW preheat flame plus the iron burning in the oxygen jet
  torch: { name: 'Oxy-fuel torch', power: 8000, eff: 0.09, blade: 0, kerf: 0.0015, reach: 1.8, depth: 0.6 },
};

/* Shears: jaw force at the throat, stroke time, opening. Shearing needs ~0.75 × fu over the section
   (blanking practice); fu ≈ 1.55 × fy for structural steel. */
const JAWS = { force: 200 * 1000 * 9.81, stroke: 2.2, open: 0.42, reopen: 0.6 };
const SHEAR_UTS = 0.75 * 1.55;

/* Oxy-fuel: steel ignites in oxygen at ~870 °C. Fe → FeO releases ~23.8 MJ per m³ of O2 consumed;
   cutting oxygen flow rises with thickness (≈1.5 m³/h + 0.06 m³/h per mm, cutting-chart figures). */
const KINDLE = 870;
const O2_MJ = 23.8e6;
const o2Flow = (t: number): number => 1.5 + 60 * t;  // m³/h, t in m
/* Preheat spot: Ø20 mm, up to 20 mm deep, flame couples ~40% into it, conduction bleeds ~3 W/K. */
const SPOT = { r: 0.01, d: 0.02, absorb: 0.4, loss: 3 };
/* Thermal lance on mineral: burning iron rod, ~40 kW, Ø30 mm bore. */
const LANCE = { power: 40e3, eff: 0.3, kerf: 0.03 };

/* Consumable life (per ammo unit): abrasive disc wears by the G-ratio; diamond rims barely wear. */
const WEAR = {
  abrasive: { vol: 7.2e-5, G: 4 },     // usable disc volume Ø230→Ø150 × 3 mm, m³; G-ratio on steel
  diamond: { vol: 1.7e-5, G: 1500 },
  chain: 0.4,                          // m³ of timber per chain
  bit: 0.02,                           // m³ of material per drill bit / cutter
  electrode: 3600,                     // s of arc per plasma electrode + nozzle
  oxygen: 10,                          // m³ of O2 per bottle
};

const DRILL = {
  mineral: { d: 0.04, full: true, power: 1500 },
  metal: { d: 0.03, full: false, power: 1200 },
  timber: { d: 0.032, full: true, power: 1500 },
  soft: { d: 0.04, full: true, power: 1500 },
};

export const machineHooks = {
  notify: (_msg: string): void => {},
  /** take one consumable (disc, chain, bit, electrode, oxygen bottle); false when none are left */
  consume: (_tool: MachineTool): boolean => true,
  kick: (_strength: number): void => {},
  hit: (_k: number): void => {},
};

interface Cut {
  tool: MachineTool;
  p: Piece;
  mode: 'abrasive' | 'diamond' | 'teeth' | 'bore' | 'plasma' | 'oxy' | 'lance';
  cm: CutMat;
  lp: Vec3;       // cut point on the face, piece frame
  ln: Vec3;       // outward face normal, piece frame
  la: Vec3;       // member axis = cut-plane normal, piece frame
  lx: Vec3;       // kerf direction across the face, piece frame
  width: number;  // kerf length across the member
  thick: number;  // depth through the member from this face
  A: number;      // m², material in the cut plane (drill: removed from the net section)
  plate: number;  // governing wall/plate thickness
  kerf: number;
  e: number;      // J/m³
  V: number;      // m³ to remove
  done: number;
  heatIn: number; // W into the member while cutting
  zoneE: number;  // J stored in the band around the kerf
  tWork: number;  // real seconds the cut has been worked
  T: number;      // °C near the cut
  spot: number;   // oxy preheat spot temperature
  lit: boolean;
  bound: boolean;
  limit: number;  // ligament squash load the member's connections were last capped to, N
  idle: number;
  // drill
  d: number;
  axisK: number;
  station: number;
}

interface Hole { p: Piece; lp: Vec3; ln: Vec3; r: number; depth: number; axisK: number; station: number; a: number }

interface Bite {
  p: Piece;
  lp: Vec3;
  ln: Vec3;
  la: Vec3;
  lx: Vec3;
  t: number;
  need: number;   // N
  crush: boolean;
  stalled: boolean;
  width: number;
  reopen: number;
}

const cuts: Cut[] = [];
const holes: Hole[] = [];
const netLoss = new WeakMap<Piece, number>();
let active: Cut | null = null;
let bite: Bite | null = null;
let want: MachineTool | null = null;
let heldAt = -1;
let now = 0;
let fxT = 0;
let bladeT = AMBIENT;
let swapT = 0;
const wear = { abrasive: WEAR.abrasive.vol, diamond: WEAR.diamond.vol, chain: WEAR.chain, bit: WEAR.bit, electrode: WEAR.electrode, oxygen: WEAR.oxygen };
const eye: Vec3 = [0, 0, 0], dir: Vec3 = [0, 0, 1];
let lastErr: string | null = null;
let load = 0;
let soundOn = false;

const up: Vec3 = [0, 1, 0];
const _a: Vec3 = [0, 0, 0], _b: Vec3 = [0, 0, 0], _c: Vec3 = [0, 0, 0], _mn: Vec3 = [0, 0, 0], _mx: Vec3 = [0, 0, 0];
const _q: Quat = [0, 0, 0, 1];

function toLocalDir(out: Vec3, p: Piece, d: Vec3): Vec3 {
  quat.conjugate(_q, p.curRot as Quat);
  return vec3.transformQuat(out, d, _q) as Vec3;
}
function toWorldDir(out: Vec3, p: Piece, d: Vec3): Vec3 {
  return vec3.transformQuat(out, d, p.curRot as Quat) as Vec3;
}
function toWorldPt(out: Vec3, p: Piece, lp: Vec3): Vec3 {
  vec3.transformQuat(out, lp, p.curRot as Quat);
  return vec3.add(out, out, p.curPos) as Vec3;
}

const cutMat = (p: Piece): CutMat => CUT[p.mat] ?? (p.pm.surface === 'metal' ? STEEL : p.pm.surface === 'wood' ? TIMBER : CONCRETE);
const density = (p: Piece): number => p.pm.density;
const fy = (p: Piece): number => Math.max(1, p.pm.eng.fc) * 1e6 * Math.max(0.05, p.heatK);

/* Member section at the cut: the real rolled section where the member still is one, else its solid
   cross-section scaled by how full the body is. */
interface Section { k: number; A: number; plate: number; solid: boolean; thick: number; dims: Vec3 }
function sectionAt(p: Piece, laxis: Vec3, lnormal: Vec3): Section {
  P.bounds(p.poly, _mn, _mx);
  const dims: Vec3 = [_mx[0] - _mn[0], _mx[1] - _mn[1], _mx[2] - _mn[2]];
  let k = 0, kn = 0;
  for (let i = 1; i < 3; i++) {
    if (Math.abs(laxis[i]) > Math.abs(laxis[k])) k = i;
    if (Math.abs(lnormal[i]) > Math.abs(lnormal[kn])) kn = i;
  }
  const u = (k + 1) % 3, v = (k + 2) % 3;
  const sec = p.depth === 0 ? sectionOf(p.root.spec) : null;
  const box = dims[u] * dims[v];
  let A: number, fill: number;
  if (sec && sec.axis === k) { A = sec.A; fill = sec.fill; }
  else { fill = clamp(p.volume / Math.max(dims[0] * dims[1] * dims[2], 1e-9), 0.02, 1); A = box * fill; }
  const solid = fill > 0.75;
  const plate = solid ? Math.min(dims[u], dims[v]) : A / (1.8 * (dims[u] + dims[v]));
  return { k, A, plate, solid, thick: kn === k ? Math.min(dims[u], dims[v]) : dims[kn], dims };
}

/* Axial force along the member (+ compression, N): the frame analysis where it tracks the member,
   else the joint forces projected on the axis. */
function axialForce(p: Piece, axis: Vec3): number {
  const ma = memberAxial.get(p);
  if (ma) return ma.N;
  let hi = 0, lo = 0;
  for (const w of p.welds) {
    if (!w.alive) continue;
    vec3.transformQuat(_c, w.n, w.a.curRot as Quat);
    const f = w.sN * Math.abs(vec3.dot(_c, axis));
    if (f > hi) hi = f;
    if (f < lo) lo = f;
  }
  return hi >= -lo ? hi : lo;
}

/* A kerf pinches shut when the ligament left can no longer carry the axial load elastically, or when
   it is on the compression side of a beam sagging between supports (or hogging over one). */
function pinches(c: Cut): boolean {
  const x = c.done / c.V;
  if (x < 0.12) return false;
  const p = c.p;
  const axis = toWorldDir(_a, p, c.la), n = toWorldDir(_b, p, c.ln);
  const u = axialForce(p, axis) / (c.A * fy(p));
  if (u > 0.02 && 1 - x < 1.15 * u) return true;
  if (Math.abs(vec3.dot(axis, up)) > 0.5 || x < 0.45) return false;
  const at = toWorldPt(_c, p, c.lp);
  let before = false, after = false;
  const w3: Vec3 = [0, 0, 0];
  for (const w of p.welds) {
    if (!w.alive) continue;
    weldPos(w, w3);
    const s = (w3[0] - at[0]) * axis[0] + (w3[1] - at[1]) * axis[1] + (w3[2] - at[2]) * axis[2];
    if (s > 0.05) after = true; else if (s < -0.05) before = true;
  }
  const fromTop = vec3.dot(n, up) > 0.6, fromBelow = vec3.dot(n, up) < -0.6;
  return (before && after) ? fromTop : (before || after) ? fromBelow : false;
}

/* ---------------- setup ---------------- */

function blockReason(tool: MachineTool, p: Piece, cm: CutMat, s: Section): string | null {
  const T = TOOLS[tool];
  const through = s.solid ? s.thick : s.plate;
  const mm = (m: number) => `${Math.round(m * 1000)} mm`;
  if (p.pm.explosive && tool !== 'shears') return null;
  switch (tool) {
    case 'grinder':
      if (cm.cls === 'glass') return 'Disc cutter would shatter the glass — break it instead';
      if (through > 2 * discDepth(cm)) return `${mm(through)} is beyond a Ø230 disc from both sides — use the torch or stitch-drill it`;
      return null;
    case 'saw':
      if (cm.cls === 'metal') return 'Chainsaw on steel strips the chain — use the disc cutter or plasma';
      if (cm.cls === 'mineral' || cm.cls === 'glass') return 'Chainsaw is for timber — use the disc cutter or drill';
      if (through > 2 * T.depth) return `${mm(through)} is beyond an 18" bar from both sides`;
      return null;
    case 'drill':
      if (cm.cls === 'glass') return 'Glass shatters under a drill';
      if (through > T.depth) return `${mm(through)} is deeper than the drill barrel (${mm(T.depth)})`;
      return null;
    case 'plasma':
      if (cm.cls !== 'metal') return `Plasma needs a conductive workpiece — ${p.mat} isn't`;
      if (s.plate > T.depth) return `Plasma arc can't pierce ${mm(s.plate)} — use the oxy-fuel torch`;
      return null;
    case 'torch':
      if (cm.cls === 'metal' && !cm.ferrous) return `Oxy-fuel won't cut ${p.mat}: its oxide melts above the metal — use plasma`;
      if (cm.cls === 'glass') return 'Torch only cracks glass';
      if (cm.cls === 'metal' && s.plate > T.depth) return `${mm(s.plate)} is past the torch's cutting capacity`;
      return null;
    case 'shears':
      return null;
  }
}

function discDepth(cm: CutMat): number {
  if (cm.cls !== 'metal') return TOOLS.grinder.depth;
  // abrasive wheel shrinks from Ø230 to Ø150 over its life: depth falls with it
  const r = Math.sqrt(0.075 * 0.075 + wear.abrasive / (Math.PI * TOOLS.grinder.kerf));
  return clamp(r - 0.03, 0.02, TOOLS.grinder.depth);
}

function makeCut(tool: MachineTool, p: Piece, point: Vec3, normal: Vec3): Cut | string {
  const cm = cutMat(p);
  const axis: Vec3 = [0, 0, 0], across: Vec3 = [0, 0, 0];
  const width = memberAxis(p, normal, axis, across);
  const la = toLocalDir([0, 0, 0], p, axis), ln = toLocalDir([0, 0, 0], p, normal);
  const s = sectionAt(p, la, ln);
  const why = blockReason(tool, p, cm, s);
  if (why) return why;
  const lp: Vec3 = [0, 0, 0];
  b3.b3Body_GetLocalPoint(lp, p.body, point);
  const T = TOOLS[tool];
  const c: Cut = {
    tool, p, mode: 'teeth', cm, lp, ln, la, lx: toLocalDir([0, 0, 0], p, across), width, thick: s.solid ? s.thick : s.plate,
    A: s.A, plate: s.plate, kerf: T.kerf, e: cm.e * 1e9, V: 0, done: 0, heatIn: 0, zoneE: 0, tWork: 0, T: p.temp, spot: p.temp,
    lit: false, bound: false, limit: Infinity, idle: 0, d: 0, axisK: s.k, station: lp[s.k],
  };
  switch (tool) {
    case 'grinder':
      c.mode = cm.cls === 'metal' ? 'abrasive' : 'diamond';
      if (c.mode === 'abrasive') c.e *= ABRASIVE;
      c.heatIn = T.power * Math.max(0, 1 - T.eff - T.blade);
      break;
    case 'saw':
      c.heatIn = T.power * Math.max(0, 1 - T.eff - T.blade) * 0.3;
      break;
    case 'plasma': {
      c.mode = 'plasma';
      c.e = meltEnergy(p, cm);
      c.heatIn = T.power * 0.25;
      break;
    }
    case 'torch':
      if (cm.cls === 'metal') {
        c.mode = 'oxy';
        c.e = meltEnergy(p, cm);
        c.kerf = T.kerf + 0.02 * s.plate;
      } else if (cm.cls === 'mineral') {
        c.mode = 'lance';
        c.e = meltEnergy(p, cm);
        c.kerf = LANCE.kerf;
      } else c.mode = 'oxy';
      c.heatIn = T.power * 0.35;
      break;
    case 'drill': {
      c.mode = 'bore';
      const dd = DRILL[cm.cls === 'glass' ? 'soft' : cm.cls];
      c.d = dd.d;
      const through = s.solid ? s.thick : s.plate;
      c.thick = through;
      c.V = dd.full ? (Math.PI / 4) * dd.d * dd.d * through : Math.PI * dd.d * T.kerf * through;
      c.A = dd.d * through;
      if (cm.cls === 'mineral') c.e *= PERCUSSIVE;
      else if (cm.cls === 'metal') c.e *= 1.3;
      c.heatIn = dd.power * 0.2;
      return c;
    }
    case 'shears':
      break;
  }
  c.V = c.kerf * c.A;
  return c;
}

/* Energy to melt the kerf from where the member is now: ρ·(c·ΔT + L). */
function meltEnergy(p: Piece, cm: CutMat): number {
  const [Tm, L] = cm.melt ?? [1500, 300e3];
  return density(p) * (cm.c * Math.max(0, Tm - p.temp) + L);
}

/* ---------------- rates ---------------- */

function bladeFactor(): number {
  const t = clamp((bladeT - 180) / 240, 0, 1);
  return 1 - 0.55 * t * t * (3 - 2 * t);
}

/* Useful power (W) removing material right now. */
function cutPower(c: Cut): number {
  const T = TOOLS[c.tool];
  switch (c.mode) {
    case 'abrasive': case 'diamond': return T.power * T.eff * bladeFactor();
    case 'teeth': return T.power * T.eff;
    case 'bore': return DRILL[c.cm.cls === 'glass' ? 'soft' : c.cm.cls].power * T.eff;
    case 'plasma': return T.power * T.eff / (1 + (c.plate / 0.025) ** 2);
    case 'oxy': return c.lit ? T.eff * (T.power + (o2Flow(c.plate) / 3600) * O2_MJ) : 0;
    case 'lance': return LANCE.power * LANCE.eff;
  }
}

/** Seconds of game time the energy model predicts for a fresh cut of `tool` at this face (cold blade,
 *  no preheat), or the reason it can't be cut. */
export function predictCut(tool: MachineTool, p: Piece, point: Vec3, normal: Vec3): { seconds: number; V: number; e: number; power: number } | string {
  const c = makeCut(tool, p, point, normal);
  if (typeof c === 'string') return c;
  if (c.mode === 'oxy') c.lit = true;
  const saved = bladeT;
  bladeT = AMBIENT;
  const power = cutPower(c);
  bladeT = saved;
  return { seconds: (c.V * c.e) / power / SITE_TIME, V: c.V, e: c.e, power };
}

/* ---------------- acquisition ---------------- */

function aimHit(tool: MachineTool): { p: Piece; point: Vec3; normal: Vec3 } | null {
  const R = TOOLS[tool].reach;
  const hit = raycast(eye, [dir[0] * R, dir[1] * R, dir[2] * R], NO_HIT);
  const p = hit ? pieceOf(hit.entity) : null;
  return p && hit ? { p, point: [hit.point[0], hit.point[1], hit.point[2]], normal: [hit.normal[0], hit.normal[1], hit.normal[2]] } : null;
}

/* The kerf a fresh aim lands on: the same member, within a few cm of an existing kerf plane. */
function findCut(tool: MachineTool, p: Piece, point: Vec3): Cut | null {
  const lp: Vec3 = [0, 0, 0];
  b3.b3Body_GetLocalPoint(lp, p.body, point);
  for (const c of cuts) {
    if (c.p !== p || c.tool !== tool) continue;
    if (tool === 'drill') { if (vec3.distance(lp, c.lp) < c.d) return c; continue; }
    const off = (lp[0] - c.lp[0]) * c.la[0] + (lp[1] - c.lp[1]) * c.la[1] + (lp[2] - c.lp[2]) * c.la[2];
    if (Math.abs(off) < 0.04) return c;
  }
  return null;
}

/** Called every frame fire is held with a machining tool. Returns why it can't work (only worth
 *  showing on a fresh press). */
export function machiningHold(tool: MachineTool, eyePos: Vec3, fwd: Vec3, fresh: boolean): string | null {
  vec3.copy(eye, eyePos);
  vec3.copy(dir, fwd);
  if (want !== tool) { active = null; bite = null; }
  want = tool;
  heldAt = now;
  if (fresh && active) active.bound = active.bound && pinches(active);
  if (fresh && bite?.stalled) bite = null;
  const hit = aimHit(tool);
  if (!hit) { active = null; if (!bite || bite.reopen <= 0) bite = null; lastErr = `${TOOLS[tool].name}: work a member within ${TOOLS[tool].reach} m`; return lastErr; }
  if (tool === 'shears') return startBite(hit.p, hit.point, hit.normal);
  if (active && active.p === hit.p && !active.p.dead && findCut(tool, hit.p, hit.point) === active) return null;
  const found = findCut(tool, hit.p, hit.point);
  if (found) { active = found; lastErr = null; return null; }
  const c = makeCut(tool, hit.p, hit.point, hit.normal);
  if (typeof c === 'string') { active = null; lastErr = c; return c; }
  if (cuts.length >= 8) cuts.splice(cuts.findIndex(k => k !== active), 1);
  cuts.push(c);
  active = c;
  lastErr = null;
  return null;
}

/* ---------------- stepping ---------------- */

export function machiningStep(dt: number, held: boolean): void {
  now += dt;
  const on = held && want !== null && now - heldAt < 0.1;
  if (!on) { active = null; if (bite && !bite.stalled && bite.t > 0) bite.t = Math.max(0, bite.t - dt / JAWS.reopen); }
  const dtw = dt * SITE_TIME;
  load = 0;
  if (swapT > 0) swapT -= dt;
  const blade = on && (want === 'grinder' || want === 'saw') && active !== null && !active.bound && swapT <= 0;
  const bw = TOOLS.grinder;
  const bladeIn = blade && active ? bw.power * (active.cm.cls === 'metal' ? bw.blade : 0.2) : 0;
  bladeT += ((bladeIn - 1.2 * (bladeT - AMBIENT)) / 150) * dtw;

  if (on && want === 'shears') stepBite(dt);
  else if (on && active && swapT <= 0) stepCut(active, dt, dtw);

  for (let i = cuts.length - 1; i >= 0; i--) {
    const c = cuts[i];
    if (c.p.dead) { cuts.splice(i, 1); if (c === active) active = null; continue; }
    if (c !== active || !on) {
      c.idle += dt;
      c.spot += (c.p.temp - c.spot) * Math.min(1, (SPOT.loss / spotCap(c)) * dtw);
      relaxZone(c, dtw);
    }
    if (c.idle > 90 && c.done === 0) cuts.splice(i, 1);
  }
  for (let i = holes.length - 1; i >= 0; i--) if (holes[i].p.dead) holes.splice(i, 1);

  fxT -= dt;
  if (fxT <= 0) {
    fxT += 0.05;
    tickEffects(on);
  }
}

function spotCap(c: Cut): number {
  return density(c.p) * c.cm.c * Math.PI * SPOT.r * SPOT.r * Math.min(Math.max(c.plate, 0.004), SPOT.d);
}

/* Heat near the kerf spreads along the member by conduction: the band that holds it widens as
   2·√(α·t), so the temperature there is stored heat over that band's heat capacity. */
function zoneTemp(c: Cut): number {
  const rho = density(c.p), alpha = c.cm.k / (rho * c.cm.c);
  const band = 0.01 + 2 * Math.sqrt(alpha * Math.max(c.tWork, 0));
  const A = c.tool === 'drill' ? Math.PI * c.d * c.thick * 0.5 : c.A;
  return c.p.temp + c.zoneE / (rho * c.cm.c * A * band);
}

function relaxZone(c: Cut, dtw: number): void {
  c.zoneE *= Math.exp(-dtw / 60);
  c.T = zoneTemp(c);
}

function stepCut(c: Cut, dt: number, dtw: number): void {
  const p = c.p;
  c.idle = 0;
  if (c.bound) { load = 1; return; }
  if (c.mode === 'oxy' && !c.lit) {
    const Q = TOOLS.torch.power * SPOT.absorb;
    c.spot += ((Q - SPOT.loss * (c.spot - p.temp)) / spotCap(c)) * dtw;
    if (c.cm.cls === 'timber') {
      c.zoneE += Q * dtw;
      c.tWork += dtw;
      c.T = zoneTemp(c);
      if (c.spot >= (p.pm.thermal.ignite ?? 300)) { ignite(p); heat(p, 40 * dt); }
      load = 0.3;
      return;
    }
    if (c.cm.cls !== 'metal') { c.zoneE += Q * dtw; c.T = zoneTemp(c); load = 0.3; return; }
    load = 0.2;
    if (c.spot >= KINDLE) {
      c.lit = true;
      audio.toolEvent('ignite', toWorldPt(_a, p, c.lp));
    }
    heat(p, (Q * dtw) / (p.mass * c.cm.c));
    return;
  }
  const power = cutPower(c);
  const dV = (power * dtw) / c.e;
  if (!wearOut(c, dV, dtw)) return;
  c.done = Math.min(c.V, c.done + dV);
  c.tWork += dtw;
  const q = c.heatIn * dtw;
  c.zoneE += q;
  c.T = zoneTemp(c);
  heat(p, q / (p.mass * c.cm.c));
  load = c.mode === 'plasma' || c.mode === 'oxy' || c.mode === 'lance' ? 0.5 : 0.75 + 0.25 * (1 - bladeFactor());
  // sparks and heat into a fuel drum or gas bottle set it off
  if (p.pm.explosive && c.done > 0.3 * c.V) { damagePiece(p, toWorldPt(_a, p, c.lp), p.hp, false); return; }
  if (c.tool !== 'drill') {
    const x = c.done / c.V;
    if (x >= 1) { finishCut(c); return; }
    /* The member's connections can't outlast the ligament left in the kerf: any rated above its
       squash load are derated to it. */
    const lig = (1 - x) * c.A * fy(p);
    if (lig < c.limit * 0.98) { limitPiece(p, lig); c.limit = lig; }
    if ((c.tool === 'grinder' || c.tool === 'saw') && pinches(c)) bind(c);
  } else if (c.done >= c.V) finishHole(c);
}

function wearOut(c: Cut, dV: number, dtw: number): boolean {
  let left: number;
  switch (c.tool) {
    case 'grinder': {
      const w = c.mode === 'abrasive' ? WEAR.abrasive : WEAR.diamond;
      const key = c.mode === 'abrasive' ? 'abrasive' : 'diamond';
      wear[key] -= dV / w.G;
      left = wear[key];
      if (left > 0) return true;
      wear[key] = w.vol;
      break;
    }
    case 'saw': wear.chain -= dV; left = wear.chain; if (left > 0) return true; wear.chain = WEAR.chain; break;
    case 'drill': wear.bit -= dV; left = wear.bit; if (left > 0) return true; wear.bit = WEAR.bit; break;
    case 'plasma': wear.electrode -= dtw; left = wear.electrode; if (left > 0) return true; wear.electrode = WEAR.electrode; break;
    case 'torch':
      wear.oxygen -= (o2Flow(c.plate) / 3600) * dtw;
      left = wear.oxygen;
      if (left > 0) return true;
      wear.oxygen = WEAR.oxygen;
      break;
    default: return true;
  }
  if (!machineHooks.consume(c.tool)) {
    machineHooks.notify(`${TOOLS[c.tool].name}: no ${CONSUMABLE[c.tool]} left`);
    active = null;
    return false;
  }
  swapT = 0.8;
  if (c.tool === 'grinder') bladeT = AMBIENT;
  audio.toolEvent('swap', eye);
  machineHooks.notify(`Fitting a new ${CONSUMABLE[c.tool]}`);
  return false;
}
const CONSUMABLE: Record<MachineTool, string> = { grinder: 'disc', saw: 'chain', drill: 'bit', shears: 'hose', plasma: 'electrode', torch: 'oxygen bottle' };

function bind(c: Cut): void {
  c.bound = true;
  const at = toWorldPt(_a, c.p, c.lp);
  audio.toolEvent('bind', at);
  machineHooks.kick(c.tool === 'saw' ? 1 : 0.5);
  machineHooks.notify(c.tool === 'saw'
    ? 'Chain pinched — the kerf is closing under load. Cut from the tension side.'
    : 'Disc binding — the member is in compression and the kerf is closing');
}

function finishCut(c: Cut): void {
  const p = c.p;
  const at = toWorldPt([0, 0, 0], p, c.lp);
  const axis = toWorldDir([0, 0, 0], p, c.la), n = toWorldDir([0, 0, 0], p, c.ln), across = toWorldDir([0, 0, 0], p, c.lx);
  vec3.scaleAndAdd(at, at, n, -Math.min(c.thick, 0.5) * 0.5);
  const N = axialForce(p, axis), L = p.volume / Math.max(c.A, 1e-4), E = p.pm.eng.E * 1e9;
  cuts.splice(cuts.indexOf(c), 1);
  if (active === c) active = null;
  if (!sever(p, at, axis)) { if (Number.isFinite(p.pm.toughness)) damagePiece(p, at, p.hp * 1.5, true); return; }
  machineHooks.hit(0.8);
  const near = piecesNear(at, Math.max(0.6, c.width));
  for (const { p: q } of near) cutRebarNear(q, at, c.width);
  if (N < 0) springApart(near.map(k => k.p), at, axis, N, L, E, c.A);
  audio.toolEvent('through', at);
  fx.cutThrough(at, across, clamp(c.width, 0.05, 3), c.mode);
}

/* A tension member stores N²L/(2EA) of strain energy; cut through, it recoils and the halves fly apart. */
function springApart(ps: Piece[], at: Vec3, axis: Vec3, N: number, L: number, E: number, A: number): void {
  const U = (N * N * L) / (2 * E * Math.max(A, 1e-5));
  for (const q of ps) {
    const s = (q.curPos[0] - at[0]) * axis[0] + (q.curPos[1] - at[1]) * axis[1] + (q.curPos[2] - at[2]) * axis[2];
    const J = Math.min(Math.sqrt(U * q.mass), q.mass * 8) * Math.sign(s || 1);
    applyImpulseAt(q, [axis[0] * J, axis[1] * J, axis[2] * J], at);
  }
}

/* A finished bore takes D × depth out of the net section at its station along the member; holes
   within a diameter of each other share a section, so a stitched line adds up and, once little is
   left between the holes, the member parts along it. */
function finishHole(c: Cut): void {
  const p = c.p;
  cuts.splice(cuts.indexOf(c), 1);
  if (active === c) active = null;
  holes.push({ p, lp: [...c.lp], ln: [...c.ln], r: c.d / 2, depth: c.thick, axisK: c.axisK, station: c.lp[c.axisK], a: c.A });
  if (holes.length > 48) holes.splice(holes.findIndex(h => h.p !== p), 1);
  const sec = sectionAt(p, c.la, c.ln);
  let worst = 0, at = c.station;
  for (const h of holes) {
    if (h.p !== p || h.axisK !== c.axisK) continue;
    let sum = 0;
    for (const o of holes) if (o.p === p && o.axisK === c.axisK && Math.abs(o.station - h.station) < c.d) sum += o.a;
    if (sum > worst) { worst = sum; at = h.station; }
  }
  const lost = clamp(worst / Math.max(sec.A, 1e-6), 0, 1);
  const prev = netLoss.get(p) ?? 0;
  const pt = toWorldPt([0, 0, 0], p, c.lp);
  audio.toolEvent('through', pt);
  machineHooks.hit(0.3);
  if (lost >= 0.85) {
    const lp: Vec3 = [c.lp[0], c.lp[1], c.lp[2]];
    lp[c.axisK] = at;
    const w = toWorldPt([0, 0, 0], p, lp);
    const ax: Vec3 = [0, 0, 0];
    ax[c.axisK] = 1;
    const axis = toWorldDir([0, 0, 0], p, ax);
    if (sever(p, w, axis)) { machineHooks.hit(1); fx.cutThrough(w, toWorldDir([0, 0, 0], p, c.lx), 0.5, 'bore'); return; }
  }
  if (lost > prev) {
    weakenPiece(p, (1 - lost) / (1 - prev));
    netLoss.set(p, lost);
  }
}

/* ---------------- jaws ---------------- */

function startBite(p: Piece, point: Vec3, normal: Vec3): string | null {
  if (bite && bite.p === p && !p.dead) return bite.stalled ? stallMsg(bite) : null;
  if (bite && bite.t > 0.05 && !bite.p.dead) return null;
  const cm = cutMat(p);
  const axis: Vec3 = [0, 0, 0], across: Vec3 = [0, 0, 0];
  const width = memberAxis(p, normal, axis, across);
  const la = toLocalDir([0, 0, 0], p, axis), ln = toLocalDir([0, 0, 0], p, normal);
  const s = sectionAt(p, la, ln);
  const u = (s.k + 1) % 3, v = (s.k + 2) % 3;
  const gap = Math.min(s.dims[u], s.dims[v]);
  if (gap > JAWS.open) { lastErr = `Jaws open to ${JAWS.open * 1000} mm — this is ${Math.round(gap * 1000)} mm`; bite = null; return lastErr; }
  if (cm.cls === 'glass') return 'Jaws would just burst the glass';
  const crush = cm.cls === 'mineral';
  let need: number;
  if (crush) need = p.pm.eng.fc * 1e6 * 0.2 * Math.min(s.thick, JAWS.open) * 0.15;
  else if (cm.cls === 'metal') need = s.A * fy(p) * SHEAR_UTS;
  else need = s.A * (p.pm.eng.perp?.fc ?? p.pm.eng.fc) * 1e6 * 1.5;
  const lp: Vec3 = [0, 0, 0];
  b3.b3Body_GetLocalPoint(lp, p.body, point);
  bite = { p, lp, ln, la, lx: toLocalDir([0, 0, 0], p, across), t: 0, need, crush, stalled: false, width, reopen: 0 };
  lastErr = null;
  return null;
}

const tonnes = (n: number) => Math.round(n / 9810);
const stallMsg = (b: Bite) => `Jaws stall at ${tonnes(JAWS.force)} t — this section needs ${tonnes(b.need)} t`;

function stepBite(dt: number): void {
  const b = bite;
  if (!b || b.p.dead) { bite = null; return; }
  if (b.reopen > 0) { b.reopen -= dt; b.t = Math.max(0, b.t - dt / JAWS.reopen); if (b.reopen <= 0) bite = null; return; }
  if (b.stalled) { load = 1; return; }
  const engage = 0.35;
  const t = b.t + dt / JAWS.stroke;
  // force builds as the jaws take up the section; the relief valve caps it at the rated force
  const f = clamp((t - engage) / 0.3, 0, 1) * b.need;
  load = clamp(f / JAWS.force, 0, 1);
  if (f > JAWS.force) {
    b.stalled = true;
    b.t = engage + 0.3 * (JAWS.force / b.need);
    audio.toolEvent('stall', toWorldPt(_a, b.p, b.lp));
    machineHooks.notify(stallMsg(b));
    return;
  }
  b.t = t;
  if (b.t < 1) return;
  const p = b.p;
  const at = toWorldPt([0, 0, 0], p, b.lp), n = toWorldDir([0, 0, 0], p, b.ln);
  const axis = toWorldDir([0, 0, 0], p, b.la), across = toWorldDir([0, 0, 0], p, b.lx);
  heat(p, (Math.min(b.need, JAWS.force) * 0.02) / (p.mass * cutMat(p).c));
  b.reopen = JAWS.reopen;
  machineHooks.hit(0.7);
  if (b.crush) {
    let bars = 0;
    for (const { p: q } of piecesNear(at, 0.4)) bars += cutRebarNear(q, at, 0.35);
    damagePiece(p, at, Math.max(p.hp * 2, 2e5), true);
    fx.crush(at, n, p.pm.dust, p.pm.chips);
    audio.toolEvent(bars ? 'shear' : 'crush', at);
    return;
  }
  vec3.scaleAndAdd(at, at, n, -0.5 * Math.min(b.width, 0.4));
  if (sever(p, at, axis)) {
    fx.shearLip(at, across, clamp(b.width, 0.05, 1), cutMat(p).cls === 'metal');
    audio.toolEvent('shear', at);
  } else damagePiece(p, at, p.hp, true);
}

/* ---------------- effects ---------------- */

const _fp: Vec3 = [0, 0, 0], _fn: Vec3 = [0, 0, 0], _fd: Vec3 = [0, 0, 0];

function tickEffects(on: boolean): void {
  const tool = on ? want : null;
  const c = active;
  let at: Vec3 = eye;
  if (tool === 'shears' && bite && !bite.p.dead) at = toWorldPt(_fp, bite.p, bite.lp);
  else if (c && !c.p.dead) at = toWorldPt(_fp, c.p, c.lp);
  if (tool || soundOn) audio.powerTool(tool ?? 'off', at, tool ? 1 : 0, load);
  soundOn = !!tool;
  if (!tool || !c || c.p.dead || c.bound || swapT > 0 || tool === 'shears') {
    if (tool === 'torch' && !c) fx.torchFlame([eye[0] + dir[0] * 0.9, eye[1] + dir[1] * 0.9 - 0.15, eye[2] + dir[2] * 0.9], dir, 0, false);
    return;
  }
  toWorldDir(_fn, c.p, c.ln);
  const x = c.V > 0 ? c.done / c.V : 0;
  // throw direction: the disc/chain carries debris down and back toward the operator
  vec3.set(_fd, -dir[0] + _fn[0] * 0.3, -dir[1] - 0.6 + _fn[1] * 0.3, -dir[2] + _fn[2] * 0.3);
  vec3.normalize(_fd, _fd);
  const cls = c.cm.cls;
  switch (c.mode) {
    case 'abrasive':
      fx.grindSparks(at, _fd, 1, clamp((c.T - 300) / 900, 0, 1));
      break;
    case 'diamond':
      if (cls === 'timber') fx.sawdust(at, _fd, 0.6, c.p.pm.dust, c.p.pm.chips);
      else fx.cutDust(at, _fd, 1, c.p.pm.dust);
      break;
    case 'teeth':
      fx.sawdust(at, _fd, 1, c.p.pm.dust, c.p.pm.chips);
      break;
    case 'bore':
      if (cls === 'metal') fx.swarf(at, _fn, 1, 0.3 + 0.7 * clamp((c.T - 100) / 300, 0, 1));
      else if (cls === 'timber') fx.sawdust(at, _fn, 0.5, c.p.pm.dust, c.p.pm.chips);
      else fx.cutDust(at, _fn, 0.6, c.p.pm.dust);
      break;
    case 'plasma':
      fx.plasmaArc(at, _fn, 1, x);
      break;
    case 'oxy':
      fx.torchFlame(at, _fn, clamp((c.spot - AMBIENT) / (KINDLE - AMBIENT), 0, 1), c.lit);
      break;
    case 'lance':
      fx.torchFlame(at, _fn, 1, true);
      fx.cutDust(at, _fn, 0.4, 0x6b645c);
      break;
  }
}

const _ka: Vec3 = [0, 0, 0], _kx: Vec3 = [0, 0, 0], _kn: Vec3 = [0, 0, 0], _kc: Vec3 = [0, 0, 0];

/** Once per rendered frame: kerf and bore decals follow their members, the tool in hand animates. */
export function syncMachining(_alpha: number, dt: number): void {
  let slot = 0;
  for (const c of cuts) {
    if (c.p.dead || slot >= 8) continue;
    const x = c.V > 0 ? c.done / c.V : 0;
    const glow = c.mode === 'plasma' || c.mode === 'oxy' || c.mode === 'lance'
      ? (c === active && (c.lit || c.mode !== 'oxy') ? 1 : clamp((c.T - 450) / 900, 0, 1))
      : clamp((Math.max(c.T, c === active && c.mode === 'abrasive' ? 900 : 0) - 450) / 900, 0, 1);
    toWorldDir(_kx, c.p, c.lx); toWorldDir(_kn, c.p, c.ln);
    if (c.tool === 'drill') fx.bore(slot + 48, toWorldPt(_ka, c.p, c.lp), _kn, c.d / 2, x, glow);
    else if (x > 0 || c.mode === 'oxy') {
      // the kerf runs across the whole member through its centreline, not just from where it was started
      const s = vec3.dot(c.lp, c.lx);
      vec3.scaleAndAdd(_kc, c.lp, c.lx, -s);
      fx.kerf(slot, toWorldPt(_ka, c.p, _kc), _kx, _kn, c.width, x, c.kerf, glow, c.mode === 'oxy' && !c.lit ? clamp((c.spot - 400) / (KINDLE - 400), 0, 1) : 0);
    }
    slot++;
  }
  let hs = 0;
  for (const h of holes) {
    if (h.p.dead || hs >= 48) continue;
    toWorldPt(_ka, h.p, h.lp); toWorldDir(_kn, h.p, h.ln);
    fx.bore(hs++, _ka, _kn, h.r, 1, 0);
  }
  fx.machiningFrame(dt);
  const working = want !== null && now - heldAt < 0.12;
  const close = bite ? clamp(bite.t, 0, 1) : 0;
  viewmodel.work(working, load, clamp((bladeT - AMBIENT) / 500, 0, 1), close, active?.lit ?? false);
}

/* ---------------- status / reset ---------------- */

export interface MachiningStatus {
  tool: MachineTool;
  /** 0..1 through the member (drill: through the bore; shears: jaw stroke) */
  progress: number;
  /** game seconds left at the current rate, Infinity when stalled */
  eta: number;
  /** °C near the cut, °C of the disc */
  temp: number;
  blade: number;
  bound: boolean;
  preheat: number;
  message: string | null;
}

export function machiningStatus(): MachiningStatus | null {
  if (!want || now - heldAt > 0.2) return null;
  if (want === 'shears') {
    if (!bite) return { tool: want, progress: 0, eta: Infinity, temp: AMBIENT, blade: AMBIENT, bound: false, preheat: 0, message: lastErr };
    return { tool: want, progress: bite.t, eta: bite.stalled ? Infinity : (1 - bite.t) * JAWS.stroke, temp: bite.p.temp, blade: AMBIENT, bound: bite.stalled, preheat: 0, message: bite.stalled ? stallMsg(bite) : null };
  }
  const c = active;
  if (!c) return { tool: want, progress: 0, eta: Infinity, temp: AMBIENT, blade: bladeT, bound: false, preheat: 0, message: lastErr };
  const power = cutPower(c);
  const eta = c.bound || power <= 0 ? Infinity : ((c.V - c.done) * c.e) / power / SITE_TIME;
  return {
    tool: want, progress: c.V > 0 ? c.done / c.V : 0, eta, temp: c.T, blade: bladeT, bound: c.bound,
    preheat: c.mode === 'oxy' ? clamp((c.spot - AMBIENT) / (KINDLE - AMBIENT), 0, 1) : 1, message: null,
  };
}

/** A finished bore in p whose mouth lies within r of the world point (the splitter works in these). */
export function holeNear(p: Piece, point: Vec3, r: number): { point: Vec3; normal: Vec3; radius: number; depth: number } | null {
  let best: Hole | null = null, bd = r;
  for (const h of holes) {
    if (h.p !== p) continue;
    const d = vec3.distance(toWorldPt(_a, p, h.lp), point);
    if (d < bd) { bd = d; best = h; }
  }
  return best ? { point: toWorldPt([0, 0, 0], p, best.lp), normal: toWorldDir([0, 0, 0], p, best.ln), radius: best.r, depth: best.depth } : null;
}

/** Test/debug view of the live cut state. */
export function machiningDebug(): { active: Cut | null; cuts: readonly Cut[]; holes: readonly Hole[]; bite: Bite | null; bladeT: number } {
  return { active, cuts, holes, bite, bladeT };
}

export function releaseMachining(): void {
  heldAt = -9;
}

export function clearMachining(): void {
  cuts.length = 0;
  holes.length = 0;
  active = null;
  bite = null;
  want = null;
  heldAt = -9;
  bladeT = AMBIENT;
  swapT = 0;
  Object.assign(wear, { abrasive: WEAR.abrasive.vol, diamond: WEAR.diamond.vol, chain: WEAR.chain, bit: WEAR.bit, electrode: WEAR.electrode, oxygen: WEAR.oxygen });
  audio.powerTool('off', eye, 0, 0);
  fx.clearMachining();
}
