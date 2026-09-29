/* Connections: what actually holds two members together. The solver sees one rigid weld per contact; this module
   decides what that weld stands for (a mortar bed, a fillet weld, a bolt group, rivets, nails or oak pegs, screws,
   a glue line, a soldered or brazed socket, a press fit, bars anchored across a cast joint, a bonded rubber mount)
   and gives it that connection's real capacities, stiffness, damping, fatigue class, creep, ageing and heat
   response. Real units throughout (N, m, Pa, °C, s), and no solver calls, so each model can be driven alone. */

import type { AgeSpec, JointKind, JointSpec, MaterialId, PieceSpec, Vec3 } from '../types';
import type { PhysMat } from './materials';

export interface Caps { comp: number; ten: number; shear: number; torque: number }
export type Adhesive = NonNullable<JointSpec['adhesive']>;

export interface Joint {
  kind: JointKind;
  n: number;                // fasteners (bolts, rivets, nails, screws, bars)
  d: number;                // fastener / bar diameter, m
  As: number;               // one fastener's stress area, m²
  fu: number;               // fastener ultimate strength, Pa
  P0: number;               // clamp force when made: bolt preload, hot-rivet shrink, interference, N (whole group)
  P: number;                // clamp force now
  mu: number;               // faying-surface slip factor
  gap: number;              // hole clearance taken up when the joint slips, m
  slipped: boolean;         // friction grip lost: bolts now bear on the hole sides
  plastic: number;          // rivet / fastener shear deformation, m
  lock: boolean;            // locking nut, seized by rust, or not a threaded fastener: cannot back off
  D: number;                // Miner fatigue damage
  dsc: number;              // EN 1993-1-9 detail category Δσc, MPa; 0 = normalised S-N on the capacity
  Af: number;               // area carrying the fatigue stress range, m²
  Fr: number;               // reference strength for normalised fatigue and creep, N
  anch: number;             // RC: bar anchorage / bond as a share of the bars' yield (≤ 1 pulls out first)
  phi: number;              // creep coefficient reached
  creepD: number;           // creep-rupture damage (adhesives, solder, hot steel)
  sag: number;              // creep rotation put into the joint's rest pose, rad
  loss: number;             // corroded share of the section
  ageK: number;             // capacity left after ageing (corrosion, carbonation, washed-out mortar)
  ageC: number;             // …of it in bearing / crushing (washed-out joints still bear; a wasted section does not)
  adhesive: Adhesive | null;
  cure: number;             // adhesive cure 0..1
  melt: number;             // °C at which the connection simply lets go
  soft: [number, number] | null;  // °C over which a heat-sensitive connection loses its strength
  kf: number;               // stiffness factor for the frame analysis (1 = as rigid as the members)
  zeta: number;             // damping ratio the connection adds (friction, hysteresis)
  heatK: number;            // current temperature / cure / moisture factor on capacity
  haz: boolean;             // weld heat-affected zone overaged by fire
  t: number;                // clock at the last round-robin visit, s
  t0: number;               // clock when the connection was made, s
  pend: number;             // creep rotation accrued but not yet put into the rest pose, rad
}

/** One member of a connection, as the models need it. */
export interface Side {
  mat: MaterialId;
  pm: PhysMat;
  spec: PieceSpec;
  dims: Vec3;               // local extents, m
  vol: number;
  mass: number;
}

const MASONRY = new Set<MaterialId>(['brick', 'cinderblock', 'stone', 'sandstone', 'marble', 'terracotta', 'adobe', 'plaster']);
const TIMBER = new Set<MaterialId>(['wood', 'oak', 'plywood', 'crate']);
const STEELY = new Set<MaterialId>(['steel', 'castiron', 'aluminum', 'machine']);

const least = (s: Side) => Math.min(s.dims[0], s.dims[1], s.dims[2]);
const most = (s: Side) => Math.max(s.dims[0], s.dims[1], s.dims[2]);
const ageOf = (a: Side, b: Side | null): AgeSpec | undefined => a.spec.age ?? b?.spec.age;

/* ---------------- which connection ---------------- */

/** The connection two members most plausibly have, from their materials, shapes and the building's age. */
export function inferKind(a: Side, b: Side | null, sameRoot: boolean): JointKind {
  const o = a.spec.joint?.kind ?? b?.spec.joint?.kind;
  if (o) return o;
  if (sameRoot) return 'bearing';
  const ma = a.mat;
  if (!b) {
    if (ma === 'rconcrete') return 'anchor';
    if (STEELY.has(ma)) return 'bolt';            // holding-down bolts
    return MASONRY.has(ma) ? 'mortar' : 'bearing';
  }
  const mb = b.mat;
  const has = (m: MaterialId) => ma === m || mb === m;
  const any = (s: Set<MaterialId>) => s.has(ma) || s.has(mb);
  const both = (s: Set<MaterialId>) => s.has(ma) && s.has(mb);
  if (has('rubber')) return 'mount';
  if (ma === 'copper' && mb === 'copper') return a.spec.util === 'power' || b.spec.util === 'power' ? 'bolt' : 'solder';
  if (ma === 'pvc' && mb === 'pvc') return 'glue';   // solvent-welded
  if (has('frp')) return any(STEELY) ? 'bolt' : 'glue';
  if (has('insulation') || has('cardboard')) return 'glue';
  if ((ma === 'rconcrete' && (mb === 'rconcrete' || mb === 'concrete')) || (mb === 'rconcrete' && ma === 'concrete')) return 'anchor';
  if (any(MASONRY)) return 'mortar';
  if (ma === 'machine' && mb === 'machine') return a.spec.shape === 'cylinder' || b.spec.shape === 'cylinder' ? 'press' : 'bolt';
  if (has('metal')) return 'screw';                  // sheeting on self-drilling screws
  if (has('drywall')) return any(TIMBER) || any(STEELY) ? 'screw' : 'bearing';
  if (any(STEELY)) {
    if (any(TIMBER) || has('concrete') || has('rconcrete') || has('copper') || has('pvc')) return 'bolt';
    if (!both(STEELY)) return 'bearing';
    if (has('castiron') || has('machine') || has('aluminum')) return 'bolt';
    if ((ageOf(a, b)?.years ?? 0) >= 90) return 'rivet';
    return Math.min(most(a), most(b)) < 0.6 || Math.min(a.vol, b.vol) < 0.01 ? 'weld' : 'bolt';
  }
  if (both(TIMBER)) return 'nail';
  if (has('roof') && any(TIMBER)) return 'nail';
  return 'bearing';
}

/* ---------------- capacities ---------------- */

const GRADE = { '4.6': { fub: 400e6, proof: 225e6 }, '8.8': { fub: 800e6, proof: 600e6 }, '10.9': { fub: 1000e6, proof: 830e6 } } as const;

/** Adhesives: shear strength, peel (line load at the edge, N/m), the band over which heat takes their strength,
 * where they are gone, cure time at 20 °C (h). Peel ≪ shear: a bonded lap carries tonnes along the line and
 * unzips from an edge at a few newtons per millimetre. */
const ADH: Record<Adhesive, { tau: number; peel: number; soft: [number, number]; melt: number; cureH: number }> = {
  pva: { tau: 8e6, peel: 1.5e3, soft: [45, 95], melt: 220, cureH: 24 },          // Tg ~35 °C thermoplastic
  epoxy: { tau: 20e6, peel: 3e3, soft: [60, 140], melt: 300, cureH: 24 },        // cold-cure Tg 55–80 °C
  pu: { tau: 9e6, peel: 4e3, soft: [90, 220], melt: 300, cureH: 12 },            // 1K PUR (EN 15425)
  prf: { tau: 10e6, peel: 2.5e3, soft: [220, 320], melt: 400, cureH: 24 },       // phenol-resorcinol: chars with the wood
  silicone: { tau: 0.9e6, peel: 3e3, soft: [180, 300], melt: 350, cureH: 48 },   // structural glazing sealant
  solvent: { tau: 6e6, peel: 1.5e3, soft: [65, 90], melt: 200, cureH: 24 },      // PVC-U solvent cement
  starch: { tau: 1e6, peel: 0.3e3, soft: [150, 220], melt: 230, cureH: 1 },      // corrugating / carton glue
};

/* Shear the substrate itself carries next to a glue line, Pa: timber fails in the wood (plywood in rolling
   shear), foam and board tear in their own cells long before the adhesive. */
const SUBSTRATE: Partial<Record<MaterialId, number>> = {
  wood: 6e6, oak: 8e6, plywood: 2e6, crate: 4e6, frp: 40e6, insulation: 0.12e6, cardboard: 0.4e6, pvc: 30e6, drywall: 0.3e6,
  glass: 30e6, tempered: 50e6, rubber: 3e6, ceramic: 1.5e6,
};

function defaultAdhesive(a: Side, b: Side | null): Adhesive {
  const m = (x: MaterialId) => a.mat === x || b?.mat === x;
  if (m('pvc') && (!b || a.mat === b.mat)) return 'solvent';
  if (m('cardboard')) return 'starch';
  if (m('insulation')) return 'pu';
  if (m('glass') || m('tempered')) return 'silicone';
  if (m('frp') || STEELY.has(a.mat) || (b && STEELY.has(b.mat))) return 'epoxy';
  return 'prf';
}

function blank(kind: JointKind): Joint {
  return {
    kind, n: 0, d: 0, As: 0, fu: 0, P0: 0, P: 0, mu: 0, gap: 0, slipped: false, plastic: 0, lock: true, D: 0, dsc: 0, Af: 0, Fr: 0,
    anch: 1, phi: 0, creepD: 0, sag: 0, loss: 0, ageK: 1, ageC: 1, adhesive: null, cure: 1, melt: Infinity, soft: null, kf: 1, zeta: 0.02,
    heatK: 1, haz: false, t: 0, t0: 0, pend: 0,
  };
}

/** Plate / flange thickness a steel member of this face size is taken to have, m. */
const plateT = (s: number) => Math.min(0.025, Math.max(0.006, 0.004 + 0.03 * s));
const boltD = (s: number) => (s < 0.12 ? 0.012 : s < 0.25 ? 0.016 : s < 0.5 ? 0.02 : 0.024);
const fuPlate = (m: MaterialId) => (m === 'castiron' ? 150e6 : m === 'aluminum' ? 260e6 : m === 'machine' ? 350e6 : 430e6);

/**
 * A connection of `kind` over contact `area` between a and b (null = ground), with `mat` the members' own
 * strength across the contact (real N). Returns the joint and its real capacities; ageing is folded in.
 */
export function makeJoint(kind: JointKind, a: Side, b: Side | null, area: number, mat: Caps): { j: Joint; real: Caps } {
  const j = blank(kind);
  const o: JointSpec = { ...b?.spec.joint, ...a.spec.joint };
  const A = Math.max(area, 1e-4), s = Math.sqrt(A);
  const t = Math.min(least(a), b ? least(b) : Infinity);
  const other = b ?? a;
  const timberA = TIMBER.has(a.mat), timberB = !!b && TIMBER.has(b.mat);
  const wood = timberA ? a : timberB ? other : null;
  const rhoK = wood ? Math.min(timberA ? a.pm.density : Infinity, timberB ? other.pm.density : Infinity) * 0.69 : 0;
  let real: Caps = { ...mat };
  switch (kind) {
    case 'mortar':
      j.zeta = 0.04;
      break;
    case 'bearing':
      j.zeta = 0.03;
      break;
    case 'anchor': {
      /* bars across a cast joint (EN 1992-1-1 8.4): bond f_bd = 2.25·η·f_ctm over an anchorage of 25 φ */
      const pm = a.pm.eng.rho ? a.pm : other.pm, rho = pm.eng.rho ?? 0.008, fy = (pm.eng.fy ?? 500) * 1e6;
      j.d = 0.016;
      j.n = Math.max(2, (rho * A) / ((Math.PI * j.d * j.d) / 4));
      const yieldF = j.n * ((Math.PI * j.d * j.d) / 4) * fy;
      const pull = j.n * Math.PI * j.d * Math.min(25 * j.d, Math.max(0.15, t)) * 2.25 * pm.eng.ft * 1e6;
      j.anch = Math.min(1, pull / yieldF);
      j.Fr = Math.max(mat.shear, yieldF);
      j.zeta = 0.03;
      break;
    }
    case 'weld': {
      /* fillet all round: directional method, f_vw = f_u / (√3 β_w) (EN 1993-1-8 4.5.3.3) */
      const aT = o.throat ?? 0.7 * plateT(s), L = 4 * s;
      const Fw = (430e6 / (Math.sqrt(3) * 0.85)) * aT * L;
      real = { comp: mat.comp, ten: Fw, shear: Fw, torque: Fw * 0.35 * s };
      j.dsc = o.detail ?? 71;
      j.Af = aT * L;
      j.Fr = Fw;
      j.zeta = 0.01;
      break;
    }
    case 'bolt':
    case 'rivet': {
      const rivet = kind === 'rivet', years = ageOf(a, b)?.years ?? 0;
      j.d = o.d ?? (rivet ? (s < 0.2 ? 0.016 : 0.022) : boltD(s));
      j.n = o.n ?? Math.round(Math.min(16, Math.max(wood ? 1 : 2, A / (wood ? 0.02 : 0.012))));
      const A0 = (Math.PI * j.d * j.d) / 4;
      j.As = rivet ? A0 : 0.78 * A0;
      /* wrought-iron rivets before ~1900, mild steel after */
      const g = GRADE[o.grade ?? (years >= 60 ? '4.6' : '8.8')];
      j.fu = rivet ? (years >= 110 ? 330e6 : 370e6) : g.fub;
      /* preload 0.8 × proof × A_s when torqued; a hot rivet's shrink clamps at ~100 MPa; old and timber bolts are snug */
      const pre = o.preload ?? (wood || a.mat === 'castiron' || other.mat === 'castiron' || years >= 60 ? 0.2 : 1);
      j.P0 = j.P = rivet ? j.n * 100e6 * A0 * (years >= 60 ? 0.8 : 1) : j.n * 0.8 * g.proof * j.As * pre;
      j.mu = wood ? 0.4 : 0.3;
      j.gap = rivet ? 0 : 0.002;
      j.lock = !!o.lock || rivet;
      const tp = wood ? Math.min(least(wood), 0.1) : plateT(s);
      const Fv = j.n * 0.6 * j.fu * j.As;
      const fh = wood ? 0.082 * (1 - 0.01 * j.d * 1e3) * rhoK * 1e6 : 0;
      const plateFu = Math.min(fuPlate(a.mat), b ? fuPlate(b.mat) : Infinity);
      const Fb = wood ? j.n * fh * j.d * tp : j.n * 2.5 * 0.7 * plateFu * j.d * tp;
      const shear = Math.min(Fv, Fb);
      /* tension through the threads (0.9 f_ub A_s) with 25% prying; a rivet head pulls through at 0.6 f_ur A_0 */
      let ten = rivet ? j.n * 0.6 * j.fu * A0 * 0.8 : (j.n * 0.9 * j.fu * j.As) / 1.25;
      const engage = o.engage ?? 1;
      if (!rivet && engage < 0.8) ten *= engage / 0.8;
      if (wood) ten = Math.min(ten, j.n * 3 * 2.5e6 * Math.PI * (1.5 * j.d) ** 2);   // washer crushing across the grain
      real = { comp: mat.comp, ten, shear, torque: ten * 0.4 * s };
      j.dsc = o.detail ?? (rivet ? 71 : 112);
      j.Af = j.n * j.As;
      j.Fr = shear;
      /* snug (bearing-type) bolts slipped into bearing when the structure took its load; preloaded ones grip */
      j.slipped = !rivet && pre < 0.5;
      j.kf = rivet ? 0.6 : j.slipped ? 0.5 : 0.8;
      j.zeta = 0.02;
      break;
    }
    case 'nail': {
      /* EN 1995-1-1 8.2 Johansen single shear, β = 1, plus the rope effect; oak frames are pegged (22 mm oak dowels) */
      const peg = a.mat === 'oak' || other.mat === 'oak';
      j.d = o.d ?? (peg ? 0.022 : s > 0.15 ? 0.004 : 0.0031);
      j.n = o.n ?? (peg ? 2 : Math.round(Math.min(60, Math.max(2, A / 0.0015))));
      const d = j.d * 1e3, tm = Math.min(Math.max(t, 0.012), peg ? 0.1 : 0.05) * 1e3;
      const rk = Math.max(rhoK, 300);
      const fh = 0.082 * rk * d ** -0.3;
      const My = 0.3 * (peg ? 90 : 600) * d ** 2.6;
      const Fa = fh * tm * d;
      const Fd = ((1.05 * fh * tm * d) / 3) * (Math.sqrt(4 + (12 * My) / (fh * d * tm * tm)) - 1);
      const Ff = 1.15 * Math.sqrt(2 * My * fh * d);
      const Fj = Math.min(Fa, Fd, Ff);
      const Fax = peg ? Fj : Math.min(20e-6 * rk * rk * d * Math.min(tm, 12 * d), 70e-6 * rk * rk * (2 * d) ** 2);
      const Fv = Fj + Math.min(Fax / 4, 0.15 * Fj);
      real = { comp: mat.comp, ten: j.n * Fax, shear: j.n * Fv, torque: j.n * Fv * 0.25 * s };
      j.Fr = j.n * Fv;
      j.kf = peg ? 0.15 : 0.05;
      j.zeta = 0.05;
      break;
    }
    case 'screw': {
      const into = STEELY.has(a.mat) || STEELY.has(other.mat) || a.mat === 'metal' || other.mat === 'metal' ? 'steel'
        : a.mat === 'drywall' || other.mat === 'drywall' ? 'board' : 'timber';
      j.d = o.d ?? (into === 'steel' ? 0.0055 : into === 'board' ? 0.0035 : 0.005);
      j.n = o.n ?? Math.round(Math.min(40, Math.max(2, A / 0.004)));
      const engage = o.engage ?? 1;
      let Fax: number, Fv: number;
      if (into === 'steel') { Fax = 2e3 * engage; Fv = 3e3; }            // sheet pull-over / bearing per fixing
      else if (into === 'board') { Fax = 350; Fv = 500; }                 // gypsum pulls over the head
      else {
        /* EN 1995-1-1 8.7.2: f_ax = 0.52 d^-0.5 l_ef^-0.1 ρ_k^0.8; stripped threads leave a fraction of l_ef */
        const d = j.d * 1e3, lef = Math.max(4, Math.min(t * 1e3, 50) * engage), rk = Math.max(rhoK, 300);
        Fax = Math.min(0.52 * d ** -0.5 * lef ** -0.1 * rk ** 0.8 * d * lef, 10 * (rk / 350) ** 0.8 * (2 * d) ** 2 * 2);
        Fv = 1.15 * Math.sqrt(2 * 0.3 * 600 * (0.7 * d) ** 2.6 * 0.082 * rk * d ** -0.3 * d);
      }
      real = { comp: mat.comp, ten: j.n * Fax, shear: j.n * Fv, torque: j.n * Math.min(Fax, Fv) * 0.25 * s };
      j.Fr = j.n * Fv;
      j.kf = 0.08;
      j.zeta = 0.04;
      break;
    }
    case 'glue': {
      const ad = (j.adhesive = o.adhesive ?? defaultAdhesive(a, b)), p = ADH[ad];
      const sub = Math.min(SUBSTRATE[a.mat] ?? 1e9, b ? SUBSTRATE[b.mat] ?? 1e9 : 1e9);
      const tau = Math.min(p.tau, sub);
      /* a normal pull or a bending moment opens the glue line from its edge: peel governs both */
      const ten = Math.min(tau * A, 8 * p.peel * s), torque = 2 * p.peel * s * s;
      real = { comp: mat.comp, ten, shear: tau * A, torque };
      j.soft = p.soft;
      j.melt = p.melt;
      j.cure = o.cure ?? 1;
      j.Fr = tau * A;
      j.zeta = ad === 'silicone' ? 0.06 : 0.02;
      break;
    }
    case 'solder':
    case 'braze': {
      /* capillary socket: lap ≈ 0.8 D round the pipe; soft solder ~25 MPa, silver/phosphor-copper braze ~150 MPa */
      const D = Math.max(t, 0.012), lap = 0.8 * D + 0.005, Aj = Math.PI * D * lap;
      const lead = o.lead ?? (ageOf(a, b)?.years ?? 0) >= 35;
      const tau = kind === 'solder' ? 25e6 : 150e6;
      j.melt = kind === 'solder' ? (lead ? 183 : 227) : 645;
      j.soft = kind === 'solder' ? [50, j.melt] : [350, j.melt];
      real = { comp: mat.comp, ten: tau * Aj, shear: tau * Aj, torque: tau * Aj * D * 0.5 };
      j.Fr = tau * Aj;
      j.kf = 0.6;
      j.zeta = 0.01;
      break;
    }
    case 'press': {
      /* H7/s6 interference δ ≈ 1.2 µm/mm on a hub twice the bore: p = E δ /(2D)·(1 − ¼); hold = μ p π D L, L = D */
      const D = Math.max(t, 0.02), E = Math.min(a.pm.eng.E, other.pm.eng.E) * 1e9;
      const p = ((E * 0.0012 * D) / (2 * D)) * 0.75;
      const hold = 0.15 * p * Math.PI * D * D;
      real = { comp: mat.comp, ten: hold, shear: mat.shear, torque: (hold * D) / 2 };
      j.P0 = j.P = p * Math.PI * D * D;
      j.mu = 0.15;
      j.Fr = hold;
      j.kf = 0.8;
      j.zeta = 0.01;
      break;
    }
    case 'mount': {
      /* bonded natural rubber: tears ~1.5 MPa in shear, ~1 MPa off the plate; hysteresis loss η ≈ 0.15 */
      real = { comp: mat.comp, ten: 1e6 * A, shear: 1.5e6 * A, torque: 0.5e6 * A * s };
      j.Fr = 1.5e6 * A;
      j.zeta = 0.08;
      j.soft = [80, 220];
      j.melt = 300;
      break;
    }
  }
  if (!j.Fr) j.Fr = Math.max(real.shear, real.ten, 1);
  const age = ageOf(a, b);
  if (age) ageJoint(j, age, a, b);
  const k = j.ageK;
  return { j, real: { comp: real.comp * j.ageC, ten: real.ten * k, shear: real.shear * k, torque: real.torque * k } };
}

/** Share of each mode the connection has relative to the members' own contact envelope (game capacities scale by it). */
export function connRatio(real: Caps, mat: Caps, kind: JointKind, authored = false): Caps {
  if (kind === 'mortar' || kind === 'bearing' || kind === 'anchor') return { comp: 1, ten: 1, shear: 1, torque: 1 };
  /* An inferred connection keeps at least a third of its contact's strength (the members' own envelope is a guess at
     how it was really fixed); one the builder specified is what it says: six wall ties hold a 7 t lift of brickwork up
     only by ~2 kN, and calibration still guarantees each joint its measured static load. */
  const lo = authored ? 0.01 : 0.35;
  const r = (x: number, y: number) => Math.min(3, Math.max(lo, x / Math.max(y, 1)));
  return { comp: 1, ten: r(real.ten, mat.ten), shear: r(real.shear, mat.shear), torque: r(real.torque, mat.torque) };
}

/* ---------------- ageing ---------------- */

/* ISO 9224 carbon-steel first-year corrosion (µm) and exponent b; zinc loses ~1/25 of that; carbonation
   K (mm/√yr, EN 1992 background: fastest in sheltered, part-dry concrete), bar corrosion once depassivated (µm/yr). */
const EXPOSURE = {
  dry: { r: 1.2, b: 0.5, zinc: 0.1, K: 4.5, bar: 2, lime: 0.2 },
  outdoor: { r: 30, b: 0.52, zinc: 1.5, K: 3.5, bar: 15, lime: 0.6 },
  wet: { r: 60, b: 0.55, zinc: 4, K: 2, bar: 30, lime: 1 },
  salt: { r: 120, b: 0.6, zinc: 8, K: 2, bar: 60, lime: 1.2 },
} as const;

/** Section lost to corrosion from one face, m, after `years` (galvanising spends its 85 µm of zinc first). */
export function corrosionDepth(age: AgeSpec, galv = false): number {
  const e = EXPOSURE[age.exposure ?? 'outdoor'];
  const t = Math.max(0, age.years - (age.galv || galv ? 85 / e.zinc : 0));
  return t > 0 ? e.r * t ** e.b * 1e-6 : 0;
}

/** Carbonation depth (m) and bar corrosion penetration (m) of reinforced concrete after `years`. */
export function carbonation(age: AgeSpec): { x: number; pen: number; cracked: boolean } {
  const e = EXPOSURE[age.exposure ?? 'outdoor'];
  const cover = age.cover ?? 0.03;
  const x = e.K * Math.sqrt(age.years) * 1e-3;
  /* chlorides reach the bars in ~15 years whatever the carbonation front does */
  const init = age.exposure === 'salt' ? Math.min(15, (cover * 1e3 / e.K) ** 2) : (cover * 1e3 / e.K) ** 2;
  const pen = Math.max(0, age.years - init) * e.bar * 1e-6;
  return { x, pen, cracked: pen > 50e-6 };
}

/** Rust staining 0..1 a member of this material shows after this service (render only). */
export function stainOf(mat: MaterialId, age: AgeSpec | undefined, galv = false): number {
  if (!age) return 0;
  if (mat === 'steel' || mat === 'castiron' || mat === 'metal' || mat === 'machine') return Math.min(1, corrosionDepth(age, galv) / 250e-6);
  if (mat === 'rconcrete') { const c = carbonation(age); return c.cracked ? Math.min(0.4, c.pen / 300e-6) : 0; }
  return 0;
}

function ageJoint(j: Joint, age: AgeSpec, a: Side, b: Side | null): void {
  const e = EXPOSURE[age.exposure ?? 'outdoor'];
  const mats = [a.mat, b?.mat];
  let k = 1;
  if (mats.some(m => m === 'steel' || m === 'castiron' || m === 'metal' || m === 'machine')) {
    const d = corrosionDepth(age, a.spec.finish === 'galv' || b?.spec.finish === 'galv');
    /* both faces of the governing plate or wall; cast iron also graphitises and loses toughness */
    const th = Math.min(...[a, b].filter((x): x is Side => !!x && (x.mat === 'steel' || x.mat === 'castiron' || x.mat === 'metal' || x.mat === 'machine'))
      .map(x => (x.mat === 'castiron' ? 0.025 : x.mat === 'metal' ? 0.002 : plateT(Math.sqrt(x.dims[0] * x.dims[2])))));
    j.loss = Math.min(0.7, (2 * d) / th);
    k *= (1 - j.loss) * (mats.includes('castiron') ? 0.9 : 1);
    if (j.n && j.d) {
      const boltLoss = Math.min(0.6, (4 * d) / j.d);
      k = Math.min(k, 1 - boltLoss);
      /* rust jacking seizes a threaded fastener: it can no longer back off, and bites harder */
      if (d > 50e-6 && (j.kind === 'bolt' || j.kind === 'screw')) { j.lock = true; j.mu = Math.min(0.6, j.mu + 0.2); }
    }
  }
  if (mats.includes('rconcrete') && j.kind === 'anchor') {
    const c = carbonation(age);
    const barLoss = Math.min(0.5, (2 * c.pen) / j.d);
    /* corrosion products split the cover and destroy bond long before they eat the bar */
    j.anch *= Math.max(0.2, 1 - Math.min(1, c.pen / 150e-6) * 0.6);
    k *= (1 - barLoss) * (c.cracked ? 0.75 : 1);
  }
  if (j.kind === 'mortar' && age.years >= 60) {
    /* lime mortar: leached and frost-worked out of the bed faces over a century of weather */
    k *= 1 - 0.45 * Math.min(1, (age.years - 50) / 120) * Math.min(1, e.lime);
  }
  if (j.kind === 'glue' && age.years > 30) k *= 0.85;
  j.ageK = Math.max(0.5, k);
  j.ageC = j.kind === 'mortar' ? Math.min(1, j.ageK + 0.2) : j.ageK;
}

/* ---------------- temperature, cure, moisture ---------------- */

/** Capacity factor of a heat-sensitive connection at temperature T; 0 once it has melted or charred off. */
export function heatFactor(j: Joint, T: number): number {
  if (T >= j.melt) return 0;
  const s = j.soft;
  if (!s || T <= s[0]) return 1;
  const x = Math.min(1, (T - s[0]) / (s[1] - s[0]));
  /* soft solder keeps ~40% at 150 °C and nothing at its solidus; adhesives fall off past Tg */
  return j.kind === 'solder' ? (1 - x) ** 1.5 : Math.max(0.02, 1 - 0.98 * x);
}

/** Refresh the joint's temperature × cure × wetness factor; true when it moved enough to re-apply capacities. */
export function updateHeatK(j: Joint, T: number, wet = 0): boolean {
  if (j.kind === 'weld' && T > 700) j.haz = true;
  const k = heatFactor(j, T) * (j.adhesive ? 0.05 + 0.95 * j.cure : 1) * (1 - 0.7 * Math.min(1, wet)) * (j.haz ? 0.85 : 1);
  if (Math.abs(k - j.heatK) < 0.02 && !(k === 0 && j.heatK > 0)) return false;
  j.heatK = k;
  return true;
}

/** Adhesive cure over `hours` at temperature T (rate doubles per 10 °C). */
export function cureStep(j: Joint, hours: number, T: number): void {
  if (!j.adhesive || j.cure >= 1) return;
  j.cure = Math.min(1, j.cure + (hours * 2 ** ((Math.min(T, 80) - 20) / 10)) / ADH[j.adhesive].cureH);
}

/* ---------------- bolts, rivets, press fits ---------------- */

/** Friction the clamp still provides before the plies slip, N. */
export function slipResistance(j: Joint): number {
  return j.mu * j.P;
}

export type Phase = 'stick' | 'slip' | 'bearing' | 'yield' | 'fail';

/**
 * A bolted or riveted joint under shear V (N) with shear capacity Fv: friction grip until V exceeds μ·P, then it
 * slips through the hole clearance into bearing; the fasteners shear at Fv. Rivets yield plastically (from ~0.65 Fv)
 * and deform up to ~0.3 d before they go.
 */
export function shearPhase(j: Joint, V: number, Fv: number): Phase {
  if (V >= Fv) return 'fail';
  if (j.kind === 'rivet') {
    const Vy = 0.65 * Fv;
    if (V > Vy) {
      j.plastic = Math.max(j.plastic, 0.3 * j.d * ((V - Vy) / (Fv - Vy)) ** 1.5);
      if (!j.slipped) j.slipped = true;
      return 'yield';
    }
  }
  if (!j.slipped && V > slipResistance(j)) {
    j.slipped = true;
    return 'slip';
  }
  return j.slipped ? 'bearing' : 'stick';
}

/**
 * Transverse vibration backs a nut off (Junker): once the cyclic shear amplitude Fa slips the head or thread
 * interface (≳ 20% of the clamp's friction) the preload decays exponentially with the cycles. Returns the new preload.
 */
export function loosen(j: Joint, Fa: number, cycles: number): number {
  if (j.lock || j.kind !== 'bolt' || j.P <= 0 || cycles <= 0) return j.P;
  const steps = Math.min(40, Math.ceil(cycles / 50));
  const n = cycles / steps;
  for (let i = 0; i < steps && j.P > 1; i++) {
    const x = Fa / Math.max(j.mu * j.P, 1e-6);
    if (x <= 0.2) break;
    j.P *= Math.exp(-0.004 * Math.min(x - 0.2, 5) * n);
  }
  return j.P;
}

/* ---------------- fatigue ---------------- */

/** Cycles to failure at stress range Δσ (MPa) for detail category Δσc (EN 1993-1-9 Fig. 7.1): m = 3 down to the
 * constant-amplitude limit at 5·10⁶, m = 5 to the cut-off at 10⁸, none below. */
export function cyclesToFailure(dsc: number, ds: number): number {
  const dD = 0.737 * dsc, dL = 0.549 * dD;
  if (ds <= dL) return Infinity;
  if (ds >= dD) return 2e6 * (dsc / ds) ** 3;
  return 5e6 * (dD / ds) ** 5;
}

/** Normalised S-N for masonry, concrete, timber and bonded joints (Aas-Jakobsen form, R = 0): log N = (1 − S)/0.07. */
export function cyclesNorm(S: number): number {
  return S <= 0.05 ? Infinity : 10 ** ((1 - Math.min(S, 1)) / 0.07);
}

/** n cycles of force range ΔF (N) through the joint (Miner's rule); true once the joint has failed by fatigue. */
export function addCycles(j: Joint, dF: number, n: number): boolean {
  if (n <= 0 || dF <= 0) return j.D >= 1;
  const dsc = j.kind === 'bolt' && (j.slipped || j.P < 0.5 * j.P0) ? (j.P < 0.5 * j.P0 ? 50 : 90) : j.dsc;
  const N = dsc > 0 && j.Af > 0 ? cyclesToFailure(dsc, dF / j.Af / 1e6 / Math.max(0.3, 1 - j.loss)) : cyclesNorm(dF / (j.Fr * j.ageK * Math.max(0.05, j.heatK)));
  if (Number.isFinite(N)) j.D += n / N;
  if (j.kind === 'bolt') loosen(j, dF / 2, n);
  return j.D >= 1;
}

/* ---------------- vibration ---------------- */

/** Damping ratio of members by material (EN 1991-1-4 F.5 / Bachmann): welded steel ~1%, concrete 2%, timber 3%, masonry 4%. */
const ZETA: Partial<Record<MaterialId, number>> = {
  steel: 0.008, aluminum: 0.008, castiron: 0.01, machine: 0.02, concrete: 0.02, rconcrete: 0.02, wood: 0.03, oak: 0.03, plywood: 0.03,
  brick: 0.04, stone: 0.04, cinderblock: 0.04, rubber: 0.08, insulation: 0.1, cardboard: 0.1,
};
export const materialDamping = (m: MaterialId) => ZETA[m] ?? 0.02;

/** First bending mode of a simply supported member, Hz: f₁ = (π / 2L²)·√(EI / m̄). */
export function firstMode(E: number, I: number, mbar: number, L: number): number {
  return (Math.PI / (2 * L * L)) * Math.sqrt((E * I) / Math.max(mbar, 1e-6));
}

/** Dynamic amplification of a harmonic force at frequency ratio r with damping ζ. */
export function amplification(r: number, zeta: number): number {
  return 1 / Math.sqrt((1 - r * r) ** 2 + (2 * zeta * r) ** 2);
}

/** Force transmissibility through a damped mount (what reaches the floor per unit of machine force). */
export function transmissibility(r: number, zeta: number): number {
  return Math.sqrt(1 + (2 * zeta * r) ** 2) * amplification(r, zeta);
}

/** Rubber stiffens with frequency: storage modulus ≈ E₀·(1 + 0.25·log₁₀(1 + f)). */
export const rubberStiffening = (f: number) => 1 + 0.25 * Math.log10(1 + f);

/** Rotating unbalance force, N, of mass m spinning at ω for ISO 21940-11 balance grade G (m/s): F = m·G·ω. */
export function unbalance(m: number, omega: number, G = 6.3e-3): number {
  return m * G * omega;
}

/* ---------------- creep ---------------- */

/** Final creep coefficient φ∞ of the members, or 0 where creep at ambient is negligible. Timber: EN 1995-1-1 k_def
 * (service class 1 / 2 / 3, mechano-sorptive when wet); concrete: EN 1992-1-1 Fig. 3.1 (RH 50 / 80%). */
export function creepFinal(m: MaterialId, wet: boolean, outdoor: boolean): number {
  if (m === 'wood' || m === 'oak' || m === 'crate') return wet ? 2 : outdoor ? 0.8 : 0.6;
  if (m === 'plywood') return wet ? 2.5 : outdoor ? 1 : 0.8;
  if (m === 'concrete' || m === 'rconcrete') return outdoor || wet ? 1.6 : 2.2;
  if (m === 'pvc' || m === 'frp' || m === 'insulation') return 1;
  return 0;
}

/** Creep coefficient after `days` under load: φ(t) = φ∞·(t / (t + τ))^0.4, τ ~30 d timber, ~100 d concrete. */
export function creepPhi(phiInf: number, days: number, m: MaterialId): number {
  const tau = m === 'concrete' || m === 'rconcrete' ? 100 : 30;
  return phiInf * (days / (days + tau)) ** 0.4;
}

/**
 * Creep rupture of a sustained connection at utilisation S (hours to failure): adhesives and solder follow
 * log t = 9(1 − S), cut by ten per 15 °C past the start of their softening; steel from ~400 °C by a Larson–Miller
 * style ten-fold per 50 °C. Returns the damage accrued over `hours`.
 */
export function creepRupture(j: Joint, S: number, T: number, hours: number, steel: boolean): number {
  if (S <= 0.2 || hours <= 0) return 0;
  let tf: number;
  if (steel) {
    if (T < 400) return 0;
    tf = 10 ** (4 - (T - 450) / 50) * (0.5 / Math.min(S, 1)) ** 4;
  } else {
    if (!j.soft) return 0;
    tf = 10 ** (9 * (1 - Math.min(S, 1)) - Math.max(0, T - j.soft[0]) / 15);
  }
  return hours / Math.max(tf, 1e-6);
}

/* ---------------- laminates ---------------- */

export interface Laminate { plies: number; intact: number; delam: boolean; fibre: 'glass' | 'carbon' | 'wood'; ilss: number; fply: number }

/* interlaminar shear strength and ply strength (MPa): GFRP ILSS ~35, CFRP ~70; plywood rolling shear ~2, glulam PRF ~6 */
const LAM = { glass: { ilss: 35, fply: 300 }, carbon: { ilss: 70, fply: 700 }, wood: { ilss: 2, fply: 40 } } as const;

export function laminateOf(spec: PieceSpec, mat: MaterialId): Laminate | null {
  const l = spec.laminate ?? (mat === 'frp' ? { plies: 8, fibre: 'glass' as const } : mat === 'plywood' ? { plies: 5, fibre: 'wood' as const } : null);
  if (!l || l.plies < 2) return null;
  const fibre = l.fibre ?? (mat === 'frp' ? 'glass' : 'wood');
  const f = LAM[fibre];
  return { plies: l.plies, intact: l.plies, delam: false, fibre, ilss: mat === 'wood' || mat === 'oak' ? 6 : f.ilss, fply: f.fply };
}

export type LamEvent = 'none' | 'delaminate' | 'ply' | 'fail';

/**
 * A laminate section b × h (m) under bending moment M (N·m) and shear V (N). Interlaminar shear 1.5 V/(b h) past the
 * ILSS parts the plies (which then bend on their own: stiffness and strength fall to 1/n); the outer ply fails when
 * its bending stress exceeds the ply strength, and each failure strips one ply off the section.
 */
export function laminateLoad(l: Laminate, M: number, V: number, b: number, h: number): LamEvent {
  if (l.intact <= 0) return 'fail';
  const he = (h * l.intact) / l.plies;
  if (!l.delam && (1.5 * V) / (b * he) > l.ilss * 1e6) { l.delam = true; return 'delaminate'; }
  const Z = l.delam ? (b * (he / l.intact) ** 2 * l.intact) / 6 : (b * he * he) / 6;
  if (M / Z > l.fply * 1e6) {
    l.intact--;
    return l.intact <= 0 ? 'fail' : 'ply';
  }
  return 'none';
}

/** Bending capacity left relative to the intact laminate. */
export function laminateK(l: Laminate): number {
  const k = l.intact / l.plies;
  return l.delam ? (k * k) / l.intact : k * k;
}

/* ---------------- crushable cellular solids ---------------- */

/** Rigid foams and board: plateau stress (Pa), densification strain, elastic strain recovered on unloading. */
const CELL: Partial<Record<MaterialId, { plateau: number; eD: number; back: number }>> = {
  insulation: { plateau: 0.14e6, eD: 0.75, back: 0.02 },   // PIR/EPS σ10 ≈ 100–150 kPa (EN 826)
  cardboard: { plateau: 0.3e6, eD: 0.8, back: 0.05 },      // corrugated board flat crush
};
export const crushable = (m: MaterialId) => CELL[m] !== undefined;

/** Stress in a cellular solid at strain ε (Gibson–Ashby): plateau, then locking up as the cells close. */
export function foamStress(m: MaterialId, e: number): number {
  const c = CELL[m];
  if (!c) return 0;
  return e < c.eD * 0.6 ? c.plateau : c.plateau / Math.max(0.02, 1 - (e - c.eD * 0.6) / (c.eD * 0.4 + 0.05));
}

/**
 * Energy E (J) driven into a volume V (m³) of cellular solid already crushed to strain e0: returns the new permanent
 * strain and the energy the crushing absorbed (the cells stay crushed; only a little strain springs back).
 */
export function crushFoam(m: MaterialId, e0: number, E: number, V: number): { e: number; absorbed: number } {
  const c = CELL[m];
  if (!c || E <= 0 || V <= 0) return { e: e0, absorbed: 0 };
  let e = e0, left = E;
  const de = 0.01;
  while (left > 0 && e < 0.97) {
    const w = foamStress(m, e + de / 2) * de * V;
    if (w > left) { e += (de * left) / w; left = 0; break; }
    left -= w;
    e += de;
  }
  return { e: Math.max(e0, e - c.back * (e > e0 ? 1 : 0)), absorbed: E - left };
}
