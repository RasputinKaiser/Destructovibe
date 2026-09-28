import { vec3, clamp } from 'math';
import type { MaterialId, Vec3 } from '../types';
import { b3, CAT, overlapAABB, entityOfShape } from '../physics/physics';
import { fx } from '../render/fx';
import { audio } from '../audio/audio';
import { lighting } from '../render/shared';
import { live, heat, ignite, damagePiece, explode, type Piece } from './structure';
import { flammable } from './materials';
import * as fields from '../sim/fields/index';
import { svcSurge, svcViewerPos } from './services';

/* The electrical side of the power networks: each network is a radial circuit fed from its source. Loop impedances
   (source %Z, conductor resistance from length and cross-section, the contact resistance of every joint) are solved
   when the topology changes; a fault draws V / Z, and the protective devices on the path upstream of it act on their
   time-current curves, the nearest one first. Lightning, the weather the grid sees and lifting magnets live here too. */

/* ---------------- sources and conductors ---------------- */

export const U0 = 230;                 // LV phase-earth, V (400 V between phases)
export const U0_HV = 11000 / Math.sqrt(3);
export const HV_RATIO = 11000 / 400;   // HV fault currents referred to the LV side, for the transformer's relay
const Z_HV = 0.48;                     // 11 kV network at ~250 MVA fault level, Ω
const Z_INTAKE = 0.25;                 // Ze at a building intake (TN-C-S), Ω
export const R_EARTH = 15;             // a live end lying on damp masonry or soil back to the source earth, Ω
const RHO_CU = 2.2e-8;                 // Ω·m at ~70 °C
const RHO_AL = 3.4e-8;

export interface Supply { u0: number; z: number; S: number; big: boolean }

/** A power source's open-circuit voltage, phase-earth loop impedance and rating. A pad transformer (>= 2 m³ tank) is
    500 kVA at 4.75 % impedance, a kiosk or pole unit 200 kVA at 4 %, anything smaller a building's intake behind the
    supplier's network; a generator's subtransient reactance is ~15 %. */
export function supplyOf(p: Piece): Supply {
  const v = p.root.volume, gen = p.svc!.fixture === 'generator';
  if (gen) { const S = clamp(200e3 * v, 20e3, 500e3); return { u0: U0, z: (0.15 * 400 * 400) / S, S, big: S >= 400e3 }; }
  if (v >= 2) return { u0: U0, z: (0.0475 * 400 * 400) / 500e3, S: 500e3, big: true };
  if (v >= 0.5) return { u0: U0, z: (0.04 * 400 * 400) / 200e3, S: 200e3, big: false };
  return { u0: U0, z: Z_INTAKE, S: 69e3, big: false };
}

/** Phase-earth loop resistance of the conductor a member stands for, end to end. Cables are sized by their drawn
    section (a 140 mm feeder duct holds 185 mm², a 100 mm tail 35 mm², conduit a 2.5 mm² final circuit); copper
    busbars and tails 240 mm²; live steelwork (arms, columns, trays) carries a 50 mm² conductor. */
export function memberR(p: Piece): number {
  const m = p.svc!, s = p.root.spec.size;
  if (m.fixture || m.source) return 2e-4;
  const L = Math.max(s[0], s[1], s[2]) * Math.min(1, p.volume / Math.max(p.root.volume, 1e-9));
  const d = Math.min(s[0], s[1], s[2]);
  const mm2 = p.mat === 'copper' ? 240 : p.mat === 'pvc' ? (d >= 0.13 ? 185 : d >= 0.09 ? 35 : 2.5) : p.mat === 'ceramic' ? 240 : 50;
  return (2 * RHO_CU * L) / (mm2 * 1e-6);
}

/** An overhead span: 50 mm² aluminium. */
export function ropeR(len: number): number { return (2 * RHO_AL * len) / 50e-6; }

/** Lamp wattage from its light output (a 5-intensity domestic lamp ~100 W, a sodium lantern ~200 W, a flood ~900 W). */
export function lampW(p: Piece): number {
  return 12 * Math.pow(p.root.spec.light?.intensity ?? 1.2, 1.3);
}
/** diversified load of a building behind its consumer unit that the model does not draw (sockets, heating, kitchens) */
export const BASE_A = 12;
/** a running 3-phase induction motor, A per kW at 400 V, pf 0.85 */
export const A_PER_KW = 1.7;

/* ---------------- protective devices ---------------- */

export type Curve = 'B' | 'C' | 'D' | 'gG' | 'EI';
export interface Device {
  curve: Curve;
  In: number;       // rated current (relays: pickup), A
  rcd: boolean;     // 30 mA residual-current element
  H: number;        // melting / thermal integral, 1 = operated
  armed: boolean;   // saw fault current on the previous tick
  stamp: number;
  t: number;        // curve time for the fault being walked
}

const STD = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600];
export const stdRating = (a: number): number => STD.find((r) => r >= a - 1e-9) ?? 1600;
const INST: Record<'B' | 'C' | 'D', number> = { B: 5, C: 10, D: 20 };
const TMS = 0.2;

export function device(curve: Curve, In: number, rcd: boolean): Device {
  return { curve, In, rcd, H: 0, armed: false, stamp: 0, t: Infinity };
}

/** Operating time at current I (A, LV-referred) with earth leakage `leak` (A):
    MCB (IEC 60898): thermal ~100/(m²-1) s above the 1.13 × In conventional non-tripping current; magnetic at the upper
      bound of its type (B 5, C 10, D 20 × In), current-limiting (energy class 3): it lets through ~4.5 kA²s at 1 kA,
      rising as I^0.9, so it opens in a few milliseconds;
    gG fuse (BS 88): pre-arcing ~5·(5.8/m)^5 s above 1.5 × In (an hour at the 1.6 × In fusing current, ~0.1 s at 12 ×),
      never less than its adiabatic pre-arcing I²t of ~2.1·In²;
    relay (IEC 60255 extremely inverse, the curve that grades with fuses): TMS·80 / ((I/Is)² − 1), 0.1 s at least;
    RCD (30 mA): 300 ms at IΔn down to 40 ms at 5 × IΔn.
    Comparing let-through against pre-arcing I²t is what makes a B32 discriminate with a 100 A fuse up to ~5 kA. */
export function tripTime(d: Device, I: number, leak: number): number {
  let t = Infinity;
  if (d.rcd && leak >= 0.03) t = leak >= 0.15 ? 0.04 : 0.3 - (0.26 * (leak - 0.03)) / 0.12;
  const m = I / d.In;
  switch (d.curve) {
    case 'B': case 'C': case 'D':
      if (m >= INST[d.curve]) t = Math.min(t, 0.01, (4.5e3 * Math.pow(I / 1000, 0.9) * (d.In / 32)) / (I * I));
      else if (m > 1.13) t = Math.min(t, 100 / (m * m - 1));
      break;
    case 'gG':
      if (m > 1.5) t = Math.min(t, Math.max(5 * Math.pow(5.8 / m, 5), 2.1 / (m * m)));
      break;
    case 'EI':
      if (m > 1.05) t = Math.min(t, Math.max(0.1, (TMS * 80) / (m * m - 1)));
      break;
  }
  return t;
}

/* ---------------- arcs ---------------- */

/* The arc column: ~30 V at the electrodes plus ~1.8 V/mm of column (an LV arc in air; IEEE 1584 enclosures run
   25-32 mm gaps at 70-90 V); an 11 kV arc burns at ~1.5 kV. Against metal an arc burns across a ~25 mm gap. A cable
   end parting in air draws its arc out at the parting speed until the supply can no longer re-strike it each half
   cycle (~0.9 of the peak voltage, ~150 mm at 230 V) and it goes out. The arc voltage is a back-EMF: the arcing
   current is (U0 − Uarc) / Z, so a long arc on a weak circuit carries little and dies young. */
export const ARC_GAP = 25;             // mm
export const arcVolts = (gapMm: number, hv: boolean): number => (hv ? 1500 + 1.2 * gapMm : 30 + 1.8 * gapMm);
export const arcHolds = (U: number, u0: number): boolean => U < 0.9 * Math.SQRT2 * u0;

/** Incident arc energy, J: arc voltage × arcing current × burning time, capped at 2 s (IEEE 1584's exposure cap). */
export function arcEnergy(U: number, Ia: number, t: number): number {
  return U * Ia * Math.min(Math.max(t, 0.005), 2);
}

/** A large arc: its flash, blast and molten copper spatter, which lights what it lands on. */
export function arcBlast(pos: Vec3, E: number, src: Piece | null): void {
  if (E < 3e4) return;
  const r = clamp(0.3 * Math.cbrt(E / 1000), 0.4, 6);
  fx.arcBlast(pos, r);
  audio.arcFlash(pos);
  // the arc's pressure wave: a big fault arc blows a cubicle apart, on the order of a transformer blowout
  if (E > 5e5) explode(pos, Math.min(r * 0.5, 2.5), Math.min(E * 0.02, 40e3), Math.min(Math.sqrt(E) * 1.5, 1500));
  const rs = 0.6 + r * 0.6, chance = clamp(E / 1e6, 0.05, 0.7);
  overlapAABB([pos[0] - rs, pos[1] - rs, pos[2] - rs], [pos[0] + rs, pos[1] + rs, pos[2] + rs], CAT.structure | CAT.debris | CAT.prop, (shape) => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const q = e as Piece;
    if (q.dead || q === src || vec3.distance(q.curPos, pos) > rs + 0.5) return;
    heat(q, (120 * chance + 40) * clamp(0.01 / q.volume, 0.02, 1));
    if (flammable(q.pm) && Math.random() < chance) ignite(q);
  });
  fields.spark(pos, 0.5);
}

/* ---------------- contacts ---------------- */

export const RC0 = 5e-5;               // a sound bolted or crimped termination, Ω
/** Contact resistance: a constriction that oxidation multiplies, plus what a loose (barely touching) joint adds. */
export const contactR = (loose: number, ox: number): number => (RC0 + 0.06 * Math.pow(loose, 1.5)) * (1 + 40 * ox);
export const RTH = 15;                 // terminal and cable end to ambient, K/W
/* Contact faults take hours to days to develop; like the fires, they play compressed: a first-order lag of TAU_C s
   and oxidation K_OX per second at 20 °C, doubling every OX_DOUBLE K (Arrhenius). A joint half worked loose on a
   house's 12 A runs away in a minute or so; on 25 A in seconds; a sound one never. */
export const TAU_C = 15;
export const K_OX = 3e-5;
export const OX_DOUBLE = 25;

/** Service years and exposure of the building a piece belongs to (joints/age model): contacts start oxidised and
    corrode faster in the wet. */
export function ageOf(p: Piece): { years: number; wet: number } {
  const a = p.root.spec.age;
  if (!a) return { years: 0, wet: 1 };
  return { years: a.years, wet: a.exposure === 'wet' ? 3 : a.exposure === 'salt' ? 5 : a.exposure === 'outdoor' ? 1.6 : 1 };
}

/* ---------------- surface tracking ---------------- */

const EXPOSED = new Set<MaterialId>(['machine', 'copper', 'ceramic', 'steel', 'metal']);
/** Live gear whose conductors are within reach of a wet surface: boards, cut-outs, busbars, insulators. */
export const exposedGear = (p: Piece): boolean => EXPOSED.has(p.mat) && (p.mat !== 'steel' && p.mat !== 'metal' ? true : p.curPos[1] > 2.5);

/** Surface leakage current, A: a dry surface is ~10 GΩ; water, and the dirt it dissolves, bring it down to kΩ. HV
    insulators have forty times the creepage path. */
export function leakage(u: number, wet: number, dirt: number, hv: boolean): number {
  const R = 1e10 * Math.exp(-10.8 * wet * (1 + dirt)) * (hv ? 40 : 1);
  return u / R;
}
export const TRACK_K = 0.0038;         // carbon track growth per second per mA above the 1 mA dry-band threshold
export const DRY_TAU = 40;

export function dirtOf(p: Piece): number {
  const a = ageOf(p);
  return clamp(0.2 + a.years / 80 + (a.wet - 1) * 0.1, 0, 1.5);
}

/* ---------------- weather ---------------- */

const weather = { storm: false, rain: 0, next: 0, strikes: 0 };

/** Sandbox storm: rain on the gear (tracking, corona) and a strike every few seconds near the viewer. */
export function setStorm(on: boolean): void {
  weather.storm = on;
  weather.rain = on ? 0.85 : 0;
  weather.next = on ? 2 + Math.random() * 4 : 0;
  fields.setRain(weather.rain);
}
export const stormOn = (): boolean => weather.storm;
/** 0..1: rain on outdoor gear, air humidity, darkness (corona is seen only in the dark) */
export function gridWeather(): { rain: number; humid: number; dark: number } {
  return { rain: weather.rain, humid: Math.max(lighting.humidity, weather.rain), dark: Math.max(lighting.lamps, weather.storm ? 0.6 : 0) };
}

export function stepWeather(dt: number): void {
  if (!weather.storm) return;
  weather.next -= dt;
  if (weather.next > 0) return;
  weather.next = 5 + Math.random() * 15;
  const v = svcViewerPos;
  lightningStrike({ at: [v[0], v[1], v[2]], spread: 160 });
}

/* ---------------- lightning ---------------- */

export const STRIKE_R = 45;            // rolling-sphere radius, m (BS EN 62305 class III)
const CONDUCT = new Set<MaterialId>(['steel', 'castiron', 'copper', 'metal', 'machine', 'aluminum']);
const DOWN = new Set<MaterialId>([...CONDUCT, 'rconcrete']);
const MASONRY = new Set<MaterialId>(['concrete', 'rconcrete', 'brick', 'cinderblock', 'stone', 'sandstone', 'marble', 'terracotta', 'ceramic', 'adobe', 'plaster', 'roof', 'glass', 'tempered']);

export interface Strike {
  pos: Vec3; kA: number; piece: Piece | null;
  /** struck an air terminal and followed its down conductor to earth */
  rod: boolean;
  earthed: boolean;
  /** the pieces the current ran through to earth, struck point first */
  path: Piece[];
  side: Piece | null;
  surge: { nets: number; flashovers: number; lamps: number; trips: number; blown: number };
}
export const lightningStats = { strikes: 0, rods: 0, sideFlashes: 0, ms: 0 };
const _ab: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

/** Peak return-stroke current: log-normal, median 30 kA (CIGRE), clamped to 5-200 kA. */
function strokeKA(): number {
  const g = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  return clamp(30 * Math.exp(0.7 * g), 5, 200);
}

/** A cloud-to-ground strike. The leader descends at a random point within `spread` of `at`; the first thing it comes
    within the striking distance of (the electrogeometric form of the rolling-sphere method, r = 45 m) takes it: the
    ground at r, an object of height h at horizontal offset d at h + √(r² − d²). Sharp earthed metal launches its
    upward streamer a little sooner. The current then runs to earth along rods and down conductors, or through steel;
    through masonry it flashes moisture to steam and shatters it; timber splits and catches; and it couples a surge
    into every power network near it. */
export function lightningStrike(o: { at?: Vec3; spread?: number; kA?: number } = {}): Strike {
  const t0 = performance.now();
  const at = o.at ?? svcViewerPos, spread = o.spread ?? 60;
  const a = Math.random() * 2 * Math.PI, rr = spread * Math.sqrt(Math.random());
  const lx = at[0] + Math.cos(a) * rr, lz = at[2] + Math.sin(a) * rr;
  const kA = o.kA ?? strokeKA();
  const r = STRIKE_R;
  let best: Piece | null = null, by = r, bx = lx, bz = lz, btop = 0;
  for (const p of live) {
    if (p.dead) continue;
    const s = p.root.spec.size, h = 0.5 * Math.max(s[0], s[1], s[2]);
    if (p.curPos[1] + h < 3 || Math.abs(p.curPos[0] - lx) > r + h || Math.abs(p.curPos[2] - lz) > r + h) continue;
    b3.b3Body_ComputeAABB(_ab, p.body);
    const cx = clamp(lx, _ab[0], _ab[3]), cz = clamp(lz, _ab[2], _ab[5]);
    const d = Math.hypot(lx - cx, lz - cz);
    if (d >= r) continue;
    const up = CONDUCT.has(p.mat) || p.root.spec.lps ? 2 : 0;
    const y = _ab[4] + up + Math.sqrt(r * r - d * d);
    if (y > by) {
      by = y; best = p; btop = _ab[4];
      // a slender top takes it on its axis, a broad roof where the leader came down
      const narrow = _ab[3] - _ab[0] < 2 && _ab[5] - _ab[2] < 2;
      bx = narrow ? p.curPos[0] : cx; bz = narrow ? p.curPos[2] : cz;
    }
  }
  const pos: Vec3 = best ? [bx, btop, bz] : [lx, 0, lz];
  const res: Strike = { pos, kA, piece: best, rod: false, earthed: false, path: [], side: null, surge: { nets: 0, flashovers: 0, lamps: 0, trips: 0, blown: 0 } };
  lightningStats.strikes++;
  drawBolt(lx, lz, pos, kA);
  audio.thunder(pos, clamp(kA / 30, 0.3, 2));
  let surgeAt: Vec3 = pos, direct: Piece | null = null, couple = 1;
  if (!best) {
    fx.scorch(pos, 0.8);
    fx.dust(pos, 1.2, 0x6b5f52);
  } else if (best.root.spec.lps || CONDUCT.has(best.mat)) {
    const { path, earth } = downPath(best);
    res.path = path;
    res.rod = !!best.root.spec.lps;
    res.earthed = earth;
    // a stroke's action integral (~10⁵-10⁶ A²s) barely warms 50 mm² of copper; thin steel a little more
    for (const q of path) heat(q, q.root.spec.lps ? 3 : 8);
    fx.sparks(pos, [0, 1, 0], 24);
    if (res.rod) lightningStats.rods++;
    const low = path[path.length - 1];
    if (!earth && low) {
      // a broken down conductor: the current leaves its lowest end across the gap to whatever is nearest
      const side = nearest(low.curPos, 4, new Set(path));
      if (side) { res.side = side; lightningStats.sideFlashes++; hitNonConductor(side, [side.curPos[0], side.curPos[1], side.curPos[2]], kA); surgeAt = side.curPos; if (side.svc?.kind === 'power') direct = side; }
    }
    // an earthed rod still couples into services run beside its down conductor
    couple = earth ? (res.rod ? 0.3 : 0.6) : 1;
    if (best.svc?.kind === 'power') direct = best;
  } else {
    hitNonConductor(best, pos, kA);
    // the current finds its way down through damp masonry to the nearest earthed metal: services, frames
    const side = nearest(pos, 4, new Set([best]), true);
    if (side) { res.side = side; lightningStats.sideFlashes++; surgeAt = side.curPos; if (side.svc?.kind === 'power') direct = side; bolt(pos, side.curPos); }
  }
  res.surge = svcSurge(surgeAt, kA * couple, direct);
  lightningStats.ms += performance.now() - t0;
  return res;
}

function hitNonConductor(p: Piece, pos: Vec3, kA: number): void {
  const k = clamp(kA / 30, 0.3, 3);
  if (MASONRY.has(p.mat)) {
    // moisture in the pores flashes to steam: the top spalls off explosively
    damagePiece(p, pos, p.hp * (1.2 + k), true);
    explode(pos, 0.8 + 0.4 * k, 5e3 * k, 200 * k);
    fx.debris(pos, 14, 0x9a948a, 6);
  } else if (flammable(p.pm)) {
    damagePiece(p, pos, p.hp * 0.6 * k, true);
    heat(p, 400);
    ignite(p);
    fx.splinters(pos, 16);
  } else heat(p, 80 * k);
}

/** Through welds (and bonded slew rings and slides), along air terminals, down conductors, structural metal and bonded
    reinforcement, to a weld to the ground. */
function downPath(p: Piece): { path: Piece[]; earth: boolean } {
  const seen = new Set<Piece>([p]), q: Piece[] = [p], prev = new Map<Piece, Piece>();
  let end: Piece | null = null, low = p;
  const visit = (c: Piece, o: Piece | null): void => {
    if (!o || seen.has(o) || o.dead || !(o.root.spec.lps || DOWN.has(o.mat))) return;
    seen.add(o); prev.set(o, c); q.push(o);
  };
  for (let i = 0; i < q.length && i < 2000 && !end; i++) {
    const c = q[i];
    if (c.curPos[1] < low.curPos[1]) low = c;
    for (const w of c.welds) {
      if (!w.alive) continue;
      if (!w.b) { end = c; break; }
      visit(c, w.a === c ? w.b : w.a);
    }
    if (c.mechs) for (const m of c.mechs) if (m.alive) visit(c, m.part === c ? m.host : m.part);
  }
  const path: Piece[] = [];
  for (let c: Piece | undefined = end ?? low; c; c = prev.get(c)) path.push(c);
  path.reverse();
  return { path, earth: !!end };
}

function nearest(pos: ArrayLike<number>, r: number, skip: Set<Piece>, conductor = false): Piece | null {
  let best: Piece | null = null, bd = r * r;
  overlapAABB([pos[0] - r, pos[1] - r, pos[2] - r], [pos[0] + r, pos[1] + r, pos[2] + r], CAT.structure | CAT.debris | CAT.prop, (shape) => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const q = e as Piece;
    if (q.dead || skip.has(q) || (conductor && !q.svc && !CONDUCT.has(q.mat))) return;
    const d = vec3.squaredDistance(q.curPos, pos as Vec3) * (q.svc ? 0.5 : 1);
    if (d < bd) { bd = d; best = q; }
  });
  return best;
}

/* The channel: midpoint displacement of the leader's path from the cloud base, with a few forks off its upper part. */
function drawBolt(lx: number, lz: number, end: Vec3, kA: number): void {
  const top: Vec3 = [lx + (Math.random() - 0.5) * 60, 260, lz + (Math.random() - 0.5) * 60];
  const main = jag(top, end, 7, 0.22);
  const forks: Vec3[][] = [];
  const nf = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < nf; i++) {
    const a = main[Math.floor(Math.random() * main.length * 0.7)];
    const L = (a[1] - end[1]) * (0.2 + Math.random() * 0.35), ang = Math.random() * 2 * Math.PI;
    forks.push(jag(a, [a[0] + Math.cos(ang) * L * 0.7, a[1] - L, a[2] + Math.sin(ang) * L * 0.7], 4, 0.3));
  }
  fx.lightning(main, forks, clamp(kA / 30, 0.4, 2));
}

function jag(a: Vec3, b: Vec3, depth: number, rough: number): Vec3[] {
  let pts: Vec3[] = [a, b];
  for (let d = 0; d < depth; d++) {
    const out: Vec3[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i], L = vec3.distance(p, q) * rough;
      out.push([(p[0] + q[0]) / 2 + (Math.random() - 0.5) * L, (p[1] + q[1]) / 2 + (Math.random() - 0.5) * L * 0.4, (p[2] + q[2]) / 2 + (Math.random() - 0.5) * L], q);
    }
    pts = out;
  }
  return pts;
}

function bolt(a: ArrayLike<number>, b: ArrayLike<number>): void {
  fx.lightning(jag([a[0], a[1], a[2]], [b[0], b[1], b[2]], 3, 0.3), [], 0.4);
}

/* ---------------- lifting magnets ---------------- */

/* A lifting magnet's pull falls off with the air gap: F = Fh · (g0 / (d + g0))², full holding force Fh at contact, capped,
   and shared across everything it holds, so it lifts up to its rating (Fh is twice the rated load, the usual margin)
   and no more. It drops everything the moment it loses power. */
const FERROUS = new Set<MaterialId>(['steel', 'castiron', 'metal', 'machine']);
const G0 = 0.12, REACH = 1.6;
export const magnets = new Set<Piece>();
export const magnetStats = { held: 0, pulled: 0, ms: 0 };
const _mf: Vec3 = [0, 0, 0], _cp: Vec3 = [0, 0, 0], _mv: Vec3 = [0, 0, 0], _qv: Vec3 = [0, 0, 0];
interface Held { pulls: { q: Piece; f: number; x: number; y: number; z: number }[]; k: number; wait: number }
const held = new Map<Piece, Held>();

export function stepMagnets(): void {
  if (!magnets.size) return;
  const t0 = performance.now();
  magnetStats.held = 0; magnetStats.pulled = 0;
  for (const mg of magnets) {
    if (mg.dead) { magnets.delete(mg); held.delete(mg); continue; }
    if (!mg.svc?.on) { held.delete(mg); continue; }
    // the pieces in reach are surveyed every few steps (every tenth of a second with none); the pull acts every step
    let h = held.get(mg);
    if (!h) held.set(mg, h = { pulls: [], k: 1, wait: 0 });
    if (h.wait-- <= 0) survey(mg, h);
    if (!h.pulls.length) continue;
    let rx = 0, ry = 0, rz = 0;
    b3.b3Body_GetLinearVelocity(_mv, mg.body);
    for (const u of h.pulls) {
      if (u.q.dead) continue;
      const seated = u.f < 0, f = Math.abs(u.f) * h.k;
      _mf[0] = u.x * f; _mf[1] = u.y * f; _mf[2] = u.z * f;
      if (seated) {
        // a seated piece moves with the pole face: its slip against the face is damped out
        b3.b3Body_GetLinearVelocity(_qv, u.q.body);
        const c = 6 * u.q.mass;
        for (let a = 0; a < 3; a++) _mf[a] -= c * (_qv[a] - _mv[a]);
        magnetStats.held++;
      }
      b3.b3Body_ApplyForceToCenter(u.q.body, _mf, true);
      rx -= _mf[0]; ry -= _mf[1]; rz -= _mf[2];
      magnetStats.pulled++;
    }
    _mf[0] = rx; _mf[1] = ry; _mf[2] = rz;
    b3.b3Body_ApplyForceToCenter(mg.body, _mf, true);
  }
  magnetStats.ms += performance.now() - t0;
}

function survey(mg: Piece, h: Held): void {
  const Fh = (mg.root.spec.magnet ?? 1000) * 9.81 * 2;
  b3.b3Body_ComputeAABB(_ab, mg.body);
  const fx0 = (_ab[0] + _ab[3]) / 2, fy = _ab[1], fz = (_ab[2] + _ab[5]) / 2;
  const face: Vec3 = [fx0, fy, fz];
  h.pulls.length = 0;
  let total = 0;
  overlapAABB([fx0 - REACH, fy - REACH, fz - REACH], [fx0 + REACH, fy + 0.2, fz + REACH], CAT.structure | CAT.debris | CAT.prop, (shape) => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const q = e as Piece;
    if (q === mg || q.dead || q.hinged || q.svc || !FERROUS.has(q.mat) || q.welds.length) return;
    b3.b3Shape_GetClosestPoint(_cp, shape, face);
    const d = Math.hypot(face[0] - _cp[0], face[1] - _cp[1], face[2] - _cp[2]);
    if (d > REACH) return;
    /* the flux a piece takes is what seats it, a few times its weight; more would only fight the contact solver */
    const f = Math.min(Fh * (G0 / (d + G0)) ** 2, 3 * q.mass * 9.81);
    const dl = Math.hypot(face[0] - q.curPos[0], face[1] - q.curPos[1], face[2] - q.curPos[2]) || 1;
    h.pulls.push({ q, f: d < 0.05 ? -f : f, x: (face[0] - q.curPos[0]) / dl, y: (face[1] - q.curPos[1]) / dl, z: (face[2] - q.curPos[2]) / dl });
    total += f;
  });
  h.k = total > Fh ? Fh / total : 1;
  h.wait = h.pulls.length ? 2 : 5;
}

export function clearElectrical(): void {
  magnets.clear();
  held.clear();
  if (weather.storm) fields.setRain(0);
  weather.storm = false; weather.rain = 0; weather.next = 0;
  lightningStats.strikes = 0; lightningStats.rods = 0; lightningStats.sideFlashes = 0; lightningStats.ms = 0;
}
