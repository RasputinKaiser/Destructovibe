import type { MaterialId, PieceSpec } from '../types';
import { sectionProps, specDensity } from './compound.ts';

export type Surface = 'dirt' | 'concrete' | 'wood' | 'metal';

/* How a piece comes apart once its fracture energy is exceeded. */
export type FractureStyle =
  | 'voronoi'   // brittle solid: impact-clustered cells
  | 'splinter'  // timber: snaps across the grain, splinters along it
  | 'shards'    // annealed glass: long radial shards from the impact
  | 'dice'      // tempered glass: the whole pane bursts into small cubes
  | 'crumble'   // weak mineral (drywall, adobe, sandstone): mostly powder, a few lumps
  | 'clean'     // stone, marble, cast iron: a few large pieces along clean planes
  | 'none';     // ductile metal: never shatters — its connections yield and bend

export interface Engineering {
  /** Young's modulus, GPa (along the grain for timber) */
  E: number;
  /** compressive strength of the material / its bed joints, MPa (masonry: derived from `unit`) */
  fc: number;
  /** tensile strength of the connection (mortar bond, weld, nailing, unreinforced concrete), MPa */
  ft: number;
  /** shear cohesion of the connection, MPa (Mohr–Coulomb c) */
  c: number;
  /** joint friction coefficient (Mohr–Coulomb μ: shear capacity grows with compression) */
  mu: number;
  /** fracture energy, J/m² (low = shatters easily) */
  Gc: number;
  /** strain to failure: < 0.01 brittle, ≥ 0.05 ductile (plastic hinges) */
  ductility: number;
  /** Anisotropic solids: values across the strong direction, blended by Hankinson's formula. 'axis' = timber,
   * grain along the piece's longest dimension; 'plane' = cross-laminated panels, weak only through the thickness. */
  perp?: { E: number; fc: number; ft: number; along: 'axis' | 'plane' };
  /** reinforced concrete: longitudinal bar ratio and bar yield strength (MPa) — bars carry tension once the concrete cracks */
  rho?: number;
  fy?: number;
  /** Masonry: the unit (fb, its tensile strength ft) and the mortar (fm) with the EN 1996-1-1 group constant K.
   * fc is then the assembled masonry's mean strength; ft / c / mu describe the mortar bed joint. */
  unit?: { fb: number; ft: number; fm: number; K: number };
  /** dynamic increase factor on yield at impact / blast strain rates (UFC 3-340-02) */
  dif?: number;
}

export interface Thermal {
  /** ignition temperature, °C (flammable solids) */
  ignite?: number;
  /** seconds for a 1 m³ piece to burn through (scaled by size); timber with `char` uses its charring rate instead */
  burn?: number;
  /** notional charring rate β_n, mm/min (EN 1995-1-2 §3.4) */
  char?: number;
  /** strength falls linearly from 1 at soften[0] °C to 0.1 at soften[1] °C (derived from `curve` when given) */
  soften?: [number, number];
  /** strength reduction factors [°C, k] (Eurocode fire parts); overrides the linear `soften` ramp */
  curve?: [number, number][];
  /** melting / solidus temperature, °C: no strength left */
  melt?: number;
  /** spalling threshold, °C (concrete, stone) */
  spall?: number;
  /** thermal-shock cracking threshold, °C (glass) */
  shock?: number;
  /** cook-off temperature, °C (explosives) */
  cookOff?: number;
  /** limiting oxygen index: above air's 0.21 the flame needs an outside fire's heat to keep going (PVC-U ~0.45) */
  loi?: number;
  /** how fast it takes up heat from a neighbouring fire (fraction of the gap per 0.25 s) */
  absorb: number;
}

export interface PhysMat {
  eng: Engineering;
  thermal: Thermal;
  density: number;          // kg/m³, effective (hollow blocks and tiled roofs are lighter than solid)
  friction: number;
  restitution: number;
  style: FractureStyle;
  cells: [number, number];
  /** squash of the Voronoi metric along the grain (<1 → splinters) */
  grain: number;
  /** fragments stay tied by rebar */
  rebar: boolean;
  /** masonry unit as laid, [course height, unit length] m: cracks follow bed joints and release whole courses */
  course?: [number, number];
  /** derived game-scale joint capacities per m² of face */
  bond: number;             // tension
  cohesion: number;         // shear at zero compression
  crush: number;            // compression
  /** energy per m³ of struck region to fracture, J (game-scaled from Gc) */
  toughness: number;
  blastResist: number;
  ductile: boolean;
  value: number;
  dust: number;
  chips: number;
  surface: Surface;
  explosive?: { radius: number; power: number; impulse: number };
}

type Spec = Omit<PhysMat, 'bond' | 'cohesion' | 'crush' | 'toughness' | 'ductile'> & { toughness?: number };

/* Game units keep the real ratios between materials but scale absolute capacities down so a hand
   cannon can matter; the settle-and-measure calibration still guarantees every structure carries
   its own weight. FRACTURE is pinned so plain C30/37 (G_F 140 J/m²) keeps the piece toughness the
   collapse tuning was done against. */
const TENSION = 1e5, SHEAR = 1e5, CRUSH = 3e4, FRACTURE = 60e3 / 140;
/* EN 1052-1: characteristic ≈ mean / 1.2 for masonry prisms. */
const MASONRY_MEAN = 1.2;

function mat(s: Spec): PhysMat {
  const e = s.eng, th = s.thermal;
  if (e.unit) e.fc = +(MASONRY_MEAN * e.unit.K * e.unit.fb ** 0.7 * e.unit.fm ** 0.3).toFixed(1);
  let ft = e.ft, c = e.c;
  if (e.rho && e.fy) {
    /* Bars crossing a joint add shear friction ρ·fy·μ (EN 1992-1-1 6.2.5), capped by strut crushing 0.5·ν·fc.
       Their tension is not added here: once the concrete cracks, rebar ties (rebarTie) carry it. */
    c = Math.min(c + e.rho * e.fy * e.mu, 0.5 * 0.6 * (1 - e.fc / 250) * e.fc);
  }
  if (th.curve && !th.soften) {
    const first = th.curve.findIndex(([, k]) => k < 1);
    th.soften = [th.curve[Math.max(0, first - 1)][0], th.curve[th.curve.length - 1][0]];
  }
  return {
    ...s,
    bond: ft * TENSION,
    cohesion: c * SHEAR,
    crush: e.fc * CRUSH,
    toughness: s.toughness ?? (s.style === 'none' ? Infinity : e.Gc * FRACTURE),
    ductile: e.ductility >= 0.05,
  };
}

/* EN 1993-1-2 Table 3.1, k_y,θ (carbon steel). */
const STEEL_FIRE: [number, number][] = [[400, 1], [500, 0.78], [600, 0.47], [700, 0.23], [800, 0.11], [900, 0.06], [1000, 0.04], [1200, 0]];
/* EN 1999-1-2 Table 3.2a, k_0.2p,θ for EN AW-6061 T6. */
const ALU_FIRE: [number, number][] = [[100, 1], [150, 0.91], [200, 0.79], [250, 0.55], [300, 0.31], [350, 0.1], [550, 0]];

export const MATS: Record<MaterialId, PhysMat> = {
  // EN 1992-1-1 C30/37 (mean): fcm 38, fctm 2.9, Ecm 33 GPa; construction joint c = 0.4·fctm, μ 0.7 (6.2.5, rough);
  // G_F = 73·fcm^0.18 (fib MC2010); εcu 0.0035; ρ 2400 (EN 1991-1-1). Spalls ~350 °C with 3% moisture.
  concrete: mat({
    eng: { E: 33, fc: 38, ft: 2.9, c: 1.2, mu: 0.7, Gc: 140, ductility: 0.0035, dif: 1.2 }, thermal: { spall: 380, absorb: 0.03 },
    density: 2400, friction: 0.75, restitution: 0.02, style: 'voronoi', cells: [6, 10], grain: 1, rebar: false,
    blastResist: 1.0, value: 100, dust: 0xbdb8ae, chips: 0x9a978f, surface: 'concrete',
  }),
  // C30/37 + B500B bars (fyk 500) at ρ = 1%: cracked tension ρ·fy, monolithic c = 0.5·fctm (indented) + shear friction;
  // G_F of the concrete plus bar pull-out; ρ 2500 (EN 1991-1-1 Table A.1).
  rconcrete: mat({
    eng: { E: 33, fc: 38, ft: 2.9, c: 1.45, mu: 0.9, Gc: 200, ductility: 0.0035, rho: 0.008, fy: 500, dif: 1.2 }, thermal: { spall: 380, absorb: 0.03 },
    density: 2500, friction: 0.75, restitution: 0.02, style: 'voronoi', cells: [5, 9], grain: 1, rebar: true,
    blastResist: 1.2, value: 115, dust: 0xbab6ad, chips: 0x92908a, surface: 'concrete',
  }),
  // BS EN 771-1 clay brick fb 20 in M4 mortar, EN 1996-1-1 group 1 K 0.55; bed joint bond ~0.3, fvk0 0.2 (mean 0.3),
  // μ 0.65 (triplet tests); unit G_F ~80 J/m² (mortar joints 5–20).
  brick: mat({
    eng: { E: 7, fc: 0, ft: 0.3, c: 0.3, mu: 0.65, Gc: 80, ductility: 0.002, unit: { fb: 20, ft: 2, fm: 4, K: 0.55 } }, thermal: { absorb: 0.025 },
    density: 1900, friction: 0.7, restitution: 0.02, style: 'voronoi', cells: [6, 10], grain: 1, rebar: false, course: [0.3, 0.62],
    blastResist: 0.85, value: 130, dust: 0xa08a7e, chips: 0x9b4a32, surface: 'concrete',
  }),
  // EN 771-3 hollow concrete block, fb 7 on gross area, group 2 K 0.45, M4 mortar; face-shell bedding halves the bond.
  cinderblock: mat({
    eng: { E: 4, fc: 0, ft: 0.2, c: 0.2, mu: 0.6, Gc: 40, ductility: 0.002, unit: { fb: 7, ft: 1.3, fm: 4, K: 0.45 } }, thermal: { spall: 450, absorb: 0.03 },
    density: 1300, friction: 0.7, restitution: 0.02, style: 'voronoi', cells: [5, 8], grain: 1, rebar: false, course: [0.4, 0.8],
    blastResist: 0.7, value: 90, dust: 0xb3b0aa, chips: 0x8f8d88, surface: 'concrete',
  }),
  // Granite/limestone ashlar (EN 771-6, fb 80) in lime mortar fm 2, K 0.45; lime bond ~0.1; granite G_F ~150;
  // quartz α–β inversion at 573 °C shatters the surface.
  stone: mat({
    eng: { E: 20, fc: 0, ft: 0.1, c: 0.15, mu: 0.7, Gc: 150, ductility: 0.002, unit: { fb: 80, ft: 6, fm: 2, K: 0.45 } }, thermal: { spall: 573, absorb: 0.02 },
    density: 2650, friction: 0.75, restitution: 0.03, style: 'clean', cells: [2, 4], grain: 1, rebar: false,
    blastResist: 1.4, value: 170, dust: 0xc4bfb5, chips: 0x9d988e, surface: 'concrete',
  }),
  // Building sandstone UCS ~40 in lime mortar; porous, G_F ~45; ρ 2300.
  sandstone: mat({
    eng: { E: 8, fc: 0, ft: 0.08, c: 0.12, mu: 0.7, Gc: 45, ductility: 0.002, unit: { fb: 40, ft: 2.5, fm: 2, K: 0.45 } }, thermal: { spall: 500, absorb: 0.025 },
    density: 2300, friction: 0.75, restitution: 0.02, style: 'crumble', cells: [8, 14], grain: 1, rebar: false,
    blastResist: 0.8, value: 150, dust: 0xcdb58c, chips: 0xb89a66, surface: 'concrete',
  }),
  // Carrara-type marble UCS ~110, E 60, G_F ~80; drums and cladding on thin or dry joints (fk ≈ 0.55·UCS).
  marble: mat({
    eng: { E: 60, fc: 60, ft: 0.1, c: 0.2, mu: 0.65, Gc: 80, ductility: 0.002 }, thermal: { spall: 600, absorb: 0.02 },
    density: 2700, friction: 0.6, restitution: 0.04, style: 'clean', cells: [2, 4], grain: 1, rebar: false,
    blastResist: 1.2, value: 260, dust: 0xe8e6e1, chips: 0xdad7d0, surface: 'concrete',
  }),
  // Architectural terracotta (hollow-cored, fb ~40), fixed with cramps and mortar.
  terracotta: mat({
    eng: { E: 15, fc: 20, ft: 0.3, c: 0.3, mu: 0.6, Gc: 40, ductility: 0.001 }, thermal: { absorb: 0.03 },
    density: 1900, friction: 0.7, restitution: 0.03, style: 'voronoi', cells: [5, 9], grain: 1, rebar: false,
    blastResist: 0.6, value: 180, dust: 0xb88a70, chips: 0xb4532e, surface: 'concrete',
  }),
  // EN 14411 glazed tile on EN 12004 C1 adhesive (0.5 MPa adhesion); passes ISO 10545-9 ΔT 125 K, cracks ~200 K.
  ceramic: mat({
    eng: { E: 30, fc: 50, ft: 0.5, c: 0.5, mu: 0.6, Gc: 25, ductility: 0.001 }, thermal: { shock: 220, absorb: 0.035 },
    density: 2100, friction: 0.55, restitution: 0.04, style: 'voronoi', cells: [8, 14], grain: 1, rebar: false,
    blastResist: 0.55, value: 185, dust: 0xe1ddd0, chips: 0xb7c4b9, surface: 'concrete',
  }),
  // EN 13108-1 AC surface course at 20 °C: stiffness ~5 GPa, ITS ~0.8, G_F ~250 J/m²; 70/100 binder softens from ~45 °C.
  asphalt: mat({
    eng: { E: 5, fc: 6, ft: 0.8, c: 0.6, mu: 0.8, Gc: 250, ductility: 0.015 }, thermal: { soften: [45, 160], absorb: 0.055 },
    density: 2350, friction: 0.9, restitution: 0.01, style: 'crumble', cells: [6, 11], grain: 1, rebar: false,
    blastResist: 0.85, value: 80, dust: 0x52504d, chips: 0x3a3b38, surface: 'concrete',
  }),
  // Adobe (NZS 4297 / E.080): f'm ~1.5, bond ~0.05, v'm 0.03–0.08, E ~0.3 GPa.
  adobe: mat({
    eng: { E: 0.3, fc: 1.5, ft: 0.05, c: 0.06, mu: 0.6, Gc: 10, ductility: 0.004 }, thermal: { absorb: 0.02 },
    density: 1700, friction: 0.8, restitution: 0.01, style: 'crumble', cells: [8, 14], grain: 1, rebar: false,
    blastResist: 0.5, value: 70, dust: 0xbfa27c, chips: 0x9c7c55, surface: 'dirt',
  }),
  // Rendered (lime-cement, EN 998-1 CS II) older brickwork: weaker mortar than new brick, render adds a little bond.
  plaster: mat({
    eng: { E: 5, fc: 6, ft: 0.35, c: 0.35, mu: 0.65, Gc: 40, ductility: 0.002 }, thermal: { absorb: 0.04 },
    density: 1500, friction: 0.65, restitution: 0.02, style: 'voronoi', cells: [6, 10], grain: 1, rebar: false,
    blastResist: 0.75, value: 110, dust: 0xe2ddd0, chips: 0xd8d2c4, surface: 'concrete',
  }),
  // EN 520 gypsum board ~700 kg/m³ screwed to studs; the core calcines from ~120 °C and is spent by ~700 °C.
  drywall: mat({
    eng: { E: 2.5, fc: 4, ft: 0.3, c: 0.3, mu: 0.5, Gc: 10, ductility: 0.003 }, thermal: { soften: [120, 700], absorb: 0.06 },
    density: 700, friction: 0.6, restitution: 0.02, style: 'crumble', cells: [6, 10], grain: 1, rebar: false,
    blastResist: 0.35, value: 60, dust: 0xefece6, chips: 0xe5e1d8, surface: 'concrete',
  }),
  // EN 338 C24 (Scots pine / redwood, ρ ~510 at 12% MC): E0 11 / E90 0.37 GPa, fc0 21 / fc90 2.5, ft90 0.4;
  // nailed joints ~1.2 along the grain; mode I G_F ~250; EN 1995-1-2 β_n 0.8 mm/min.
  wood: mat({
    eng: { E: 11, fc: 21, ft: 1.2, c: 1, mu: 0.45, Gc: 250, ductility: 0.02, perp: { E: 0.37, fc: 2.5, ft: 0.4, along: 'axis' }, dif: 1.3 },
    thermal: { ignite: 300, burn: 26, char: 0.8, absorb: 0.07 },
    density: 510, friction: 0.45, restitution: 0.05, style: 'splinter', cells: [4, 7], grain: 0.3, rebar: false,
    blastResist: 0.7, value: 70, dust: 0xb8a68c, chips: 0x8a6238, surface: 'wood',
  }),
  // EN 338 D30 (European oak): E0 11 / E90 0.73, fc0 24 / fc90 5.3, ft90 0.6; pegged joints; ρ 700 seasoned; β_n 0.55.
  oak: mat({
    eng: { E: 11, fc: 24, ft: 2, c: 1.6, mu: 0.45, Gc: 450, ductility: 0.02, perp: { E: 0.73, fc: 5.3, ft: 0.6, along: 'axis' }, dif: 1.3 },
    thermal: { ignite: 330, burn: 48, char: 0.55, absorb: 0.05 },
    density: 700, friction: 0.45, restitution: 0.05, style: 'splinter', cells: [3, 6], grain: 0.35, rebar: false,
    blastResist: 0.9, value: 120, dust: 0xa89478, chips: 0x5e4128, surface: 'wood',
  }),
  // EN 636 softwood plywood (EN 12369-2): in-plane E ~8, fc ~15; weak through the thickness (delamination);
  // EN 1995-1-2 β0 1.0 mm/min for panels.
  plywood: mat({
    eng: { E: 8, fc: 15, ft: 1, c: 0.8, mu: 0.45, Gc: 200, ductility: 0.02, perp: { E: 0.4, fc: 3, ft: 0.3, along: 'plane' }, dif: 1.3 },
    thermal: { ignite: 280, burn: 20, char: 1.0, absorb: 0.08 },
    density: 500, friction: 0.45, restitution: 0.05, style: 'splinter', cells: [3, 5], grain: 0.5, rebar: false,
    blastResist: 0.55, value: 60, dust: 0xc4b08e, chips: 0xa8844f, surface: 'wood',
  }),
  // EN 10025-2 S275: fy 275, fu 430, E 210, A ≥ 22%, KV 27 J (ductile at room temperature); DIF 1.3 (UFC 3-340-02);
  // joint tension/shear are per m² of the member's bounding face (a rolled section fills ~5% of it).
  steel: mat({
    eng: { E: 210, fc: 275, ft: 14, c: 11, mu: 0.45, Gc: Infinity, ductility: 0.22, dif: 1.3 },
    thermal: { curve: STEEL_FIRE, melt: 1500, absorb: 0.1 },
    density: 7850, friction: 0.55, restitution: 0.05, style: 'none', cells: [0, 0], grain: 1, rebar: false,
    blastResist: 2.5, value: 220, dust: 0x8a8a8a, chips: 0x555a5e, surface: 'metal',
  }),
  // EN 1561 grey iron (Victorian, ~EN-GJL-150): fc ≈ 4.5 × UTS, E 110, elongation < 0.6%, KIc ~18 MPa√m;
  // no strain-rate reserve. Piece toughness is game-capped.
  castiron: mat({
    eng: { E: 110, fc: 650, ft: 6, c: 5, mu: 0.4, Gc: 2900, ductility: 0.005, dif: 1 },
    thermal: { curve: [[400, 1], [500, 0.8], [600, 0.5], [700, 0.25], [800, 0.1], [1000, 0]], melt: 1200, absorb: 0.09 },
    density: 7200, friction: 0.5, restitution: 0.05, style: 'clean', cells: [2, 3], grain: 1, rebar: false,
    blastResist: 2, value: 240, dust: 0x77787a, chips: 0x3e4042, surface: 'metal', toughness: 90e3,
  }),
  // EN AW-6061 T6: Rp0.2 240, E 69, A 8–10%; nearly rate-insensitive; solidus 582 °C.
  aluminum: mat({
    eng: { E: 69, fc: 240, ft: 7, c: 5.5, mu: 0.45, Gc: Infinity, ductility: 0.1, dif: 1.05 },
    thermal: { curve: ALU_FIRE, melt: 582, absorb: 0.12 },
    density: 2700, friction: 0.5, restitution: 0.08, style: 'none', cells: [0, 0], grain: 1, rebar: false,
    blastResist: 1.4, value: 150, dust: 0xb8bcc0, chips: 0xa9aeb3, surface: 'metal',
  }),
  // EN 10346 S280GD corrugated sheet: a thin skin, so per-face strengths are small and the density is effective;
  // it tears at its fixings (game-tuned toughness).
  metal: mat({
    eng: { E: 210, fc: 40, ft: 1.5, c: 1.2, mu: 0.45, Gc: 75, ductility: 0.004, dif: 1.3 },
    thermal: { curve: STEEL_FIRE, melt: 1500, absorb: 0.1 },
    density: 2000, friction: 0.5, restitution: 0.08, style: 'voronoi', cells: [3, 5], grain: 1, rebar: false,
    blastResist: 0.9, value: 60, dust: 0x9aa0a4, chips: 0x6d757b, surface: 'metal', toughness: 45e3,
  }),
  // EN 1652 Cu-DHP half-hard sheet: Rp0.2 ~250, E 120, A ~20%; effective density/strength of a thin panel.
  copper: mat({
    eng: { E: 120, fc: 35, ft: 1.2, c: 0.9, mu: 0.45, Gc: 85, ductility: 0.2, dif: 1.1 },
    thermal: { curve: [[200, 1], [300, 0.85], [400, 0.65], [500, 0.5], [700, 0.25], [900, 0.1], [1085, 0]], melt: 1085, absorb: 0.12 },
    density: 1800, friction: 0.55, restitution: 0.05, style: 'voronoi', cells: [3, 5], grain: 1, rebar: false,
    blastResist: 0.85, value: 195, dust: 0x79a89b, chips: 0xa96b45, surface: 'metal', toughness: 50e3,
  }),
  // EN 1452 PVC-U conduit (hollow, effective density): Vicat ~80 °C, decomposes ~200 °C, piloted ignition ~400 °C
  // and barely self-sustaining (LOI 45).
  pvc: mat({
    eng: { E: 3, fc: 20, ft: 1.4, c: 1, mu: 0.5, Gc: 30, ductility: 0.03 }, thermal: { soften: [75, 200], ignite: 400, burn: 14, absorb: 0.09, loi: 0.45 },
    density: 600, friction: 0.5, restitution: 0.1, style: 'voronoi', cells: [2, 4], grain: 1, rebar: false,
    blastResist: 0.5, value: 50, dust: 0xd6d6cf, chips: 0xdcdcd4, surface: 'wood',
  }),
  // Thin soda-lime envelope (bulb, diffuser): survives ~200 K of shock being thin.
  lamp: mat({
    eng: { E: 70, fc: 40, ft: 0.6, c: 0.4, mu: 0.4, Gc: 2, ductility: 0.001 }, thermal: { shock: 220, absorb: 0.05 },
    density: 900, friction: 0.4, restitution: 0.05, style: 'shards', cells: [4, 7], grain: 1, rebar: false,
    blastResist: 0.12, value: 120, dust: 0xf0efe6, chips: 0xf4f1df, surface: 'concrete',
  }),
  // Cast/fabricated housing plus internals: an IEC frame motor weighs ~3000–4000 kg/m³ of envelope.
  machine: mat({
    eng: { E: 200, fc: 250, ft: 9, c: 7, mu: 0.45, Gc: 250, ductility: 0.004, dif: 1.2 },
    thermal: { curve: [[450, 1], [550, 0.75], [650, 0.45], [750, 0.2], [950, 0.1], [1200, 0]], absorb: 0.02 },
    density: 3800, friction: 0.55, restitution: 0.05, style: 'clean', cells: [2, 3], grain: 1, rebar: false,
    blastResist: 2.4, value: 260, dust: 0x80868a, chips: 0x4a5560, surface: 'metal', toughness: 160e3,
  }),
  // EN 572-1 annealed float: E 70, fg,k 45, G_c = KIc²/E ≈ 8 J/m²; framed panes crack at a centre–edge ΔT ~40 K,
  // which a uniformly heated piece reaches at ~120 °C.
  glass: mat({
    eng: { E: 70, fc: 50, ft: 0.8, c: 0.5, mu: 0.5, Gc: 8, ductility: 0.001 }, thermal: { shock: 120, absorb: 0.05 },
    density: 2500, friction: 0.5, restitution: 0.05, style: 'shards', cells: [7, 11], grain: 1, rebar: false,
    blastResist: 0.15, value: 160, dust: 0xe4f1f3, chips: 0xcfe8ee, surface: 'concrete',
  }),
  // EN 12150 toughened: fb,k 120 from surface compression → ~4× the impact energy of annealed; ΔT ~200 K.
  tempered: mat({
    eng: { E: 70, fc: 60, ft: 1.2, c: 0.8, mu: 0.5, Gc: 35, ductility: 0.001 }, thermal: { shock: 520, absorb: 0.05 },
    density: 2500, friction: 0.5, restitution: 0.05, style: 'dice', cells: [30, 40], grain: 1, rebar: false,
    blastResist: 0.3, value: 190, dust: 0xe4f1f3, chips: 0xd6eef2, surface: 'concrete',
  }),
  // EN 1304 clay tiles on battens: ~60 kg/m² over the modelled depth.
  roof: mat({
    eng: { E: 10, fc: 15, ft: 0.9, c: 0.6, mu: 0.6, Gc: 33, ductility: 0.002 }, thermal: { absorb: 0.03 },
    density: 700, friction: 0.7, restitution: 0.03, style: 'voronoi', cells: [5, 9], grain: 1, rebar: false,
    blastResist: 0.7, value: 90, dust: 0x9c8579, chips: 0x8e3f28, surface: 'concrete',
  }),
  crate: mat({
    eng: { E: 9, fc: 20, ft: 0.4, c: 0.4, mu: 0.45, Gc: 20, ductility: 0.02 }, thermal: { ignite: 280, burn: 16, absorb: 0.08 },
    density: 500, friction: 0.5, restitution: 0.08, style: 'voronoi', cells: [4, 6], grain: 0.4, rebar: false,
    blastResist: 0.6, value: 40, dust: 0xb9a88c, chips: 0x9b7442, surface: 'wood',
  }),
  barrel: mat({
    eng: { E: 200, fc: 20, ft: 0.4, c: 0.4, mu: 0.4, Gc: 8, ductility: 0.004 }, thermal: { cookOff: 160, absorb: 0.1 },
    density: 800, friction: 0.5, restitution: 0.1, style: 'none', cells: [0, 0], grain: 1, rebar: false,
    blastResist: 0.4, value: 150, dust: 0x6b6b6b, chips: 0xb3261e, surface: 'metal', toughness: 5e3,
    explosive: { radius: 5.5, power: 90e3, impulse: 3800 },
  }),
  propane: mat({
    eng: { E: 200, fc: 20, ft: 0.4, c: 0.4, mu: 0.4, Gc: 13, ductility: 0.004 }, thermal: { cookOff: 120, absorb: 0.1 },
    density: 700, friction: 0.5, restitution: 0.1, style: 'none', cells: [0, 0], grain: 1, rebar: false,
    blastResist: 0.4, value: 200, dust: 0x6b6b6b, chips: 0xe8e8e2, surface: 'metal', toughness: 8e3,
    explosive: { radius: 8, power: 150e3, impulse: 5200 },
  }),
  tnt: mat({
    eng: { E: 9, fc: 10, ft: 0.4, c: 0.4, mu: 0.5, Gc: 5, ductility: 0.004 }, thermal: { cookOff: 180, absorb: 0.08 },
    density: 900, friction: 0.6, restitution: 0.05, style: 'none', cells: [0, 0], grain: 1, rebar: false,
    blastResist: 0.3, value: 180, dust: 0x6b6b6b, chips: 0xa3281c, surface: 'wood', toughness: 3e3,
    explosive: { radius: 6.5, power: 120e3, impulse: 4600 },
  }),
  // PIR board (EN 13165) ~32 kg/m³: E ~5 MPa, σ10 ~140 kPa (EN 826), bonded or mechanically fixed; chars from ~250 °C,
  // ignites ~400 °C and burns hot and sooty.
  insulation: mat({
    eng: { E: 0.005, fc: 0.14, ft: 0.08, c: 0.06, mu: 0.5, Gc: 60, ductility: 0.03 }, thermal: { soften: [100, 250], ignite: 400, burn: 8, absorb: 0.1 },
    density: 32, friction: 0.6, restitution: 0.05, style: 'crumble', cells: [4, 7], grain: 1, rebar: false,
    blastResist: 0.2, value: 20, dust: 0xe0d6a8, chips: 0xd8c38a, surface: 'wood', toughness: 6e3,
  }),
  // GFRP laminate / pultrusion (EN 13706 E23): E 25 GPa in-plane, ~8 through the thickness, bonded/bolted joints ~5 MPa,
  // interlaminar shear ~35 MPa; epoxy/polyester matrix Tg ~100 °C, resin ignites ~450 °C. Brittle-elastic to ~2% strain.
  frp: mat({
    eng: { E: 25, fc: 200, ft: 5, c: 6, mu: 0.3, Gc: 3000, ductility: 0.02, perp: { E: 8, fc: 100, ft: 0.8, along: 'plane' }, dif: 1.2 },
    thermal: { soften: [80, 220], ignite: 450, burn: 20, absorb: 0.07 },
    density: 1900, friction: 0.35, restitution: 0.1, style: 'voronoi', cells: [4, 7], grain: 0.4, rebar: false,
    blastResist: 0.9, value: 160, dust: 0xd9d8cc, chips: 0xcfd3c8, surface: 'metal', toughness: 80e3,
  }),
  // Corrugated board and packed paper stock (ECT ~6 kN/m, flat crush ~0.3 MPa): tears, crushes, loses ~70% of its
  // strength wet; ignites ~230 °C and burns out in seconds.
  cardboard: mat({
    eng: { E: 1.5, fc: 0.4, ft: 0.3, c: 0.2, mu: 0.45, Gc: 300, ductility: 0.03 }, thermal: { ignite: 233, burn: 5, absorb: 0.12 },
    density: 120, friction: 0.5, restitution: 0.05, style: 'crumble', cells: [4, 7], grain: 1, rebar: false,
    blastResist: 0.2, value: 15, dust: 0xc9b48e, chips: 0xb09067, surface: 'wood', toughness: 8e3,
  }),
  // Natural / EPDM rubber (mounts, pads, seals, tyres): E ~5 MPa, bonded to steel ~1–2 MPa, tensile ~20 MPa; hysteretic
  // loss factor ~0.15; hyperelastic rather than plastic, so no hinge (ductility kept under the plastic threshold).
  rubber: mat({
    eng: { E: 0.005, fc: 12, ft: 1.5, c: 1.5, mu: 0.9, Gc: 10000, ductility: 0.04 }, thermal: { soften: [80, 220], ignite: 350, burn: 30, absorb: 0.05 },
    density: 1150, friction: 0.9, restitution: 0.5, style: 'none', cells: [0, 0], grain: 1, rebar: false,
    blastResist: 1.5, value: 30, dust: 0x2a2a2a, chips: 0x202020, surface: 'wood',
  }),
};

/* Damage is judged against the struck region, not the whole piece, so one cannonball can hole a big
   wall; the floor keeps lintels, sills and linings from vaporising at the edge of every blast. */
export const DAMAGE_REGION = 0.4;

export function pieceHp(m: PhysMat, volume: number): number {
  return m.toughness * Math.min(Math.max(volume, 0.12), DAMAGE_REGION);
}

export function flammable(m: PhysMat): boolean {
  return m.thermal.ignite !== undefined || m.thermal.cookOff !== undefined;
}

/* Eurocode reduction curves where given (steel holds to ~400 °C and is at 11% by 800 °C); otherwise a
   linear ramp to 10%. Past the melting point nothing is left. */
export function strengthAt(m: PhysMat, t: number): number {
  const th = m.thermal;
  if (th.melt !== undefined && t >= th.melt) return 0;
  const c = th.curve;
  if (c) {
    if (t <= c[0][0]) return 1;
    for (let i = 1; i < c.length; i++) {
      if (t > c[i][0]) continue;
      const [t0, k0] = c[i - 1], [t1, k1] = c[i];
      return Math.max(0.02, k0 + ((k1 - k0) * (t - t0)) / (t1 - t0));
    }
    return 0.02;
  }
  const s = th.soften;
  if (!s || t <= s[0]) return 1;
  return Math.max(0.1, 1 - (0.9 * (t - s[0])) / (s[1] - s[0]));
}

/* Hankinson's formula: share of the along-grain strength left at an angle to the grain, c2 = cos² of that angle
   (1 = load along the grain). Only tension is brittle across the grain (the member splits); crushing across it
   densifies the fibres with a rising load rather than breaking, so it never lets a joint go. */
export function grainShare(m: PhysMat, c2: number): { comp: number; ten: number } {
  const p = m.eng.perp;
  if (!p) return ISO;
  return { comp: 1, ten: Math.min(1, p.ft / (m.eng.ft * (1 - c2) + p.ft * c2)) };
}
const ISO = { comp: 1, ten: 1 };

/** Game capacity units → real N: joint tension, shear and crushing as the material really carries them. */
export const REAL_SCALE = { ten: 1e6 / TENSION, shear: 1e6 / SHEAR, comp: 1e6 / CRUSH } as const;

/** Pull-out strength of the bars tying a cracked RC joint, game N per m² of joint. */
export function rebarTie(m: PhysMat): number {
  const e = m.eng;
  return (e.rho ?? 0.008) * (e.fy ?? 500) * TENSION;
}

/* Timber burns inwards at its charring rate; one real minute of charring plays out in one second. */
const FIRE_MINUTE = 1;
export function charTime(m: PhysMat, leastDim: number): number | undefined {
  const b = m.thermal.char;
  return b ? (leastDim * 500 / b) * FIRE_MINUTE : undefined;
}

/* ---------------- machine weights ---------------- */

/** Typical in-service masses, kg, for scaling a prefab to real weight (manufacturer data, rounded). */
export const MACHINE_KG = {
  car: 1450, van: 2300, bus: 12000, lorry: 16000, mixerLoaded: 30000, mixerEmpty: 12500, dumpTruck: 30000,
  excavator: 21000, bulldozer: 20000, mobileCrane: 36000, forklift: 4200, forkliftCounterweight: 2000,
  scissorLift: 2500, compressor: 1200, genset500kVA: 5000, transformer500kVA: 1900, transformer1MVA: 4000,
  motor55kW: 350, motor7kW: 60, pump15kW: 250, windNacelle2MW: 70000, windRotor2MW: 40000, lightTower: 1500,
} as const;

/** Envelope volume of a spec, m³ (exact for boxes, cylinders and prisms; an upper bound for hulls). */
export function envelopeVolume(s: PieceSpec): number {
  const [x, y, z] = s.size;
  switch (s.shape ?? 'box') {
    case 'cylinder': return Math.PI * (x / 2) ** 2 * y;
    case 'prism': { const n = s.sides ?? 8; return n * (x / 2) ** 2 * Math.tan(Math.PI / n) * y; }
    case 'wedge': return (x * y * z) / 2;
    case 'hull': {
      if (!s.verts || s.verts.length < 4) return x * y * z;
      let best = Infinity;
      for (let k = 0; k < 3; k++) best = Math.min(best, hullArea(s.verts, (k + 1) % 3, (k + 2) % 3) * s.size[k]);
      return best;
    }
    default: return x * y * z;
  }
}

function hullArea(v: PieceSpec['size'][], u: number, w: number): number {
  const p = v.map(q => [q[u], q[w]] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const h: number[][] = [];
  for (const pass of [p, [...p].reverse()]) {
    const start = h.length;
    for (const q of pass) {
      while (h.length >= start + 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
  }
  let a = 0;
  for (let i = 0; i < h.length; i++) { const j = (i + 1) % h.length; a += h[i][0] * h[j][1] - h[j][0] * h[i][1]; }
  return Math.abs(a) / 2;
}

/* ---------------- structural sections ---------------- */

type SectionSpec = NonNullable<PieceSpec['section']>;

/** Cross-section of a member cut across its `axis`, in local axes u = (axis+1)%3, v = (axis+2)%3. SI units. */
export interface Section {
  axis: 0 | 1 | 2;
  A: number;
  /** second moments of area about u (bending in the axis–v plane) and about v */
  Iu: number;
  Iv: number;
  /** St Venant torsion constant */
  J: number;
  /** shear area */
  As: number;
  /** A / bounding rectangle: the member's mass relative to a solid bar of its envelope */
  fill: number;
}

/* Thin rectangle torsion (Roark): J = a·b³·(1/3 − 0.21·b/a·(1 − b⁴/12a⁴)), a ≥ b. */
function rectJ(p: number, q: number): number {
  const a = Math.max(p, q), b = Math.min(p, q);
  return a * b ** 3 * (1 / 3 - 0.21 * (b / a) * (1 - b ** 4 / (12 * a ** 4)));
}

/** Solid rectangle bu × bv (along u, v), optionally thinned to `fill` of its area. */
export function solidSection(axis: 0 | 1 | 2, bu: number, bv: number, fill = 1): Section {
  const A = bu * bv;
  return { axis, A: A * fill, Iu: (bu * bv ** 3 / 12) * fill, Iv: (bv * bu ** 3 / 12) * fill, J: rectJ(bu, bv) * fill, As: (A * fill * 5) / 6, fill };
}

/** The section a member really has: its `section`, else the rolled section a slender steel/aluminium box stands for. */
export function memberSection(s: PieceSpec): SectionSpec | null {
  return s.section ?? autoSection(s);
}

/** Real section properties (compound.sectionProps, the same numbers its mass comes from), or null when solid. */
export function sectionOf(s: PieceSpec): Section | null {
  const sec = memberSection(s);
  if (!sec) return null;
  const sp = sectionProps(sec === s.section ? s : { ...s, section: sec });
  if (!sp) return null;
  const u = ((sp.axis + 1) % 3) as 0 | 1 | 2;
  // Iy bends in the depth direction (about the width axis): it is Iu when the width axis is u
  const Iu = sp.width === u ? sp.Iy : sp.Iz, Iv = sp.width === u ? sp.Iz : sp.Iy;
  const web = sec.kind === 'chs' ? sp.A / 2 : sec.kind === 'hollowcore' || sec.kind === 'hollowblock' ? sp.A * 0.7 : sp.A * 0.45;
  return { axis: sp.axis, A: sp.A, Iu, Iv, J: sp.J, As: web, fill: sp.A / (sp.D * sp.B) };
}

/* A long steel or aluminium "box" stands for a rolled or extruded section, not a solid bar: a 300 mm
   square column is a UC, not 700 kg/m of billet. Plates, rods and anything the level sized itself
   (density, section) stay as drawn. Services and machinery belong to their own models. */
export function autoSection(s: PieceSpec): SectionSpec | null {
  if (s.section || s.density !== undefined || (s.mat !== 'steel' && s.mat !== 'aluminum')) return null;
  if (s.util || s.fixture || s.mech || s.svcPart || s.soft || s.parts) return null;
  const shape = s.shape ?? 'box';
  const z = s.size;
  if (shape === 'cylinder') {
    const D = z[0];
    return z[1] >= 3 * D && D >= 0.06 ? { kind: 'chs', t: Math.max(0.003, D / (s.mat === 'steel' ? 18 : 15)) } : null;
  }
  if (shape !== 'box') return null;
  const ax: 0 | 1 | 2 = z[0] >= z[1] && z[0] >= z[2] ? 0 : z[1] >= z[2] ? 1 : 2;
  const a = Math.min(z[(ax + 1) % 3], z[(ax + 2) % 3]), b = Math.max(z[(ax + 1) % 3], z[(ax + 2) % 3]);
  if (z[ax] < 3 * b || b < 0.06 || a < 0.04) return null;
  if (s.mat === 'aluminum') return { kind: 'rhs', t: Math.max(0.002, Math.min(0.008, a / 15)), axis: ax };
  if (b < 0.14) return { kind: 'rhs', t: Math.max(0.003, a / 12), axis: ax };
  /* BS 4 proportions: UC flanges ~ d/20, webs ~ d/32; UB ~ d/30 and d/50 */
  return b / a < 1.4 ? { kind: 'I', t: b / 20, tw: b / 32, axis: ax } : { kind: 'I', t: b / 30, tw: b / 50, axis: ax };
}

/** kg/m³ the body is given for a spec modelled with volume `modelVol`: the level's override, else the material ×
 * the solidity of its explicit section (compound parts) or of the section it is taken to be (solid box, thinned). */
export function effectiveDensity(s: PieceSpec, modelVol?: number): number {
  const rho = MATS[s.mat].density;
  if (s.density !== undefined || s.section) return specDensity(s, rho, modelVol);
  const pane = glazing(s);
  if (pane) return rho * pane;
  const auto = autoSection(s);
  if (!auto) return rho;
  const sp = sectionProps({ ...s, section: auto }, rho);
  return sp ? Math.min(rho, rho * (sp.A / (sp.D * sp.B)) * (s.shape === 'cylinder' ? 4 / Math.PI : 1)) : rho;
}

/* Glazing is drawn thicker than it is (a 6 mm plate tunnels): a pane over 30 mm stands for an insulated or
   laminated unit with ~20 mm of glass in it (EN 1279 IGU 10/16/10: 50 kg/m²), and weighs that. */
const PANE_GLASS = 0.02;
function glazing(s: PieceSpec): number | null {
  if ((s.mat !== 'glass' && s.mat !== 'tempered') || (s.shape ?? 'box') !== 'box') return null;
  const z = [...s.size].sort((a, b) => a - b);
  return z[0] > 0.03 && z[1] >= 0.3 ? PANE_GLASS / z[0] : null;
}

/** Mass properties of a heuristic section member modelled as a solid envelope: its mass and principal moments
 * about its centre (body axes), so a thinned box still swings and spins like the rolled section it stands for. */
export function autoSectionInertia(s: PieceSpec, mass: number): [number, number, number] | null {
  if (s.section || s.density !== undefined || !autoSection(s)) return null;
  const sec = sectionOf(s);
  if (!sec) return null;
  const k = sec.axis, L = s.size[k], m = mass, rhoL = m / sec.A;   // ρ·L = m / A
  const out: [number, number, number] = [0, 0, 0];
  out[k] = rhoL * (sec.Iu + sec.Iv);
  out[(k + 1) % 3] = rhoL * sec.Iu + (m * L * L) / 12;
  out[(k + 2) % 3] = rhoL * sec.Iv + (m * L * L) / 12;
  return out;
}

/** Sets `density` on every piece (keeping their relative densities) so the group weighs `kg` in total. */
export function scaleToMass(ps: PieceSpec[], kg: number): PieceSpec[] {
  let m = 0;
  for (const s of ps) m += envelopeVolume(s) * (s.density ?? MATS[s.mat].density);
  if (m <= 0) return ps;
  const k = kg / m;
  for (const s of ps) s.density = Math.round((s.density ?? MATS[s.mat].density) * k);
  return ps;
}
