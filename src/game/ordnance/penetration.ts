import type { MaterialId } from '../../types';

/* Hard-missile penetration into structural materials.

   Round shot and other blunt, slow missiles: the modified NDRC formula (Kennedy 1976, as in UFC 3-340-02),
     G = 3.8e-5 · N* · M / (d·√fc) · (V/d)^1.8        (SI: M kg, d m, V m/s, fc Pa)
     x/d = 2√G (G ≤ 1),  x/d = G + 1 (G > 1)          penetration depth x
     perforation  e/d = 3.19(x/d) − 0.718(x/d)²  (x/d ≤ 1.35),  1.32 + 1.24(x/d)  (x/d ≤ 13.5)
     scabbing     h/d = 7.91(x/d) − 5.06(x/d)²   (x/d ≤ 0.65),  2.12 + 1.36(x/d)  (x/d ≤ 11.75)
   Long rod penetrators (bombs): the Young/Sandia equation, D = 1.8e-5 · S · N · (m/A)^0.7 · (V − 30.5), V ≥ 61 m/s,
   with the target's penetrability S (plain concrete of ~38 MPa ≈ 0.9; soils 4-8).

   The formulae are for concrete. Masonry takes an effective compressive strength of the wall (units and mortar
   together, EN 1996 fk ~ 5-15 MPa) and timber its crushing strength across the grain; that masonry is weaker than
   concrete the historical record agrees (Metz 1834: brick lets shot in ×1.76 further than rubble masonry). */

/** effective compressive strength for NDRC, MPa; absent: not penetrable this way (metals: they dent and ring) */
export const PEN_FC: Partial<Record<MaterialId, number>> = {
  concrete: 38, rconcrete: 38, brick: 11, cinderblock: 6, stone: 55, sandstone: 30, marble: 65, terracotta: 9, ceramic: 18,
  asphalt: 6, adobe: 2, plaster: 3, drywall: 1.2, wood: 6, oak: 9, plywood: 5, crate: 2.5, cardboard: 0.3, insulation: 0.2,
  frp: 25, pvc: 12, rubber: 1, glass: 1.5, tempered: 3, lamp: 0.8, roof: 8, tnt: 3,
};

/** Young/Sandia penetrability S (bigger goes deeper) */
export const PEN_S: Partial<Record<MaterialId, number>> = {
  concrete: 0.9, rconcrete: 0.8, brick: 1.4, cinderblock: 2.2, stone: 0.7, sandstone: 1, marble: 0.65, terracotta: 1.8, ceramic: 1.2,
  asphalt: 2.5, adobe: 4, plaster: 5, drywall: 12, wood: 8, oak: 6, plywood: 8, crate: 15, cardboard: 40, insulation: 40,
  frp: 3, pvc: 6, rubber: 10, glass: 20, tempered: 12, lamp: 30, roof: 3, tnt: 10, barrel: 0.4, propane: 0.4,
  // ductile metal: resists roughly as a slab of concrete ~7× thicker
  steel: 0.12, castiron: 0.18, aluminum: 0.35, metal: 0.15, copper: 0.2, machine: 0.15,
};
/** penetrability of the ground (dense fill and soil, Young's S ≈ 4-8) */
export const GROUND_S = 6;

export interface Ndrc { x: number; perforate: number; scab: number }

/** Blunt hard missile of mass M (kg), diameter d (m) at V (m/s) into a material of strength fc (MPa). */
export function ndrc(M: number, d: number, V: number, fcMPa: number, nose = 0.84): Ndrc {
  const G = 3.8e-5 * nose * (M / (d * Math.sqrt(fcMPa * 1e6))) * Math.pow(V / d, 1.8);
  const xd = G <= 1 ? 2 * Math.sqrt(G) : G + 1;
  const e = xd <= 1.35 ? 3.19 * xd - 0.718 * xd * xd : 1.32 + 1.24 * xd;
  const h = xd <= 0.65 ? 7.91 * xd - 5.06 * xd * xd : 2.12 + 1.36 * xd;
  return { x: xd * d, perforate: e * d, scab: h * d };
}

/** Speed left after perforating a slab of thickness t that it would just perforate at e: the energy it spent goes as
 * t/e (a slab at its perforation limit takes it all). */
export function residual(V: number, t: number, e: number): number {
  return t >= e ? 0 : V * Math.sqrt(1 - t / e);
}

/** Young/Sandia depth (m) for a penetrator of mass m (kg), cross-section A (m²), nose factor N at V (m/s). */
export function young(m: number, A: number, V: number, S: number, N = 1): number {
  if (V < 61) return 0;
  return 1.8e-5 * S * N * Math.pow(m / A, 0.7) * (V - 30.5);
}

/** The speed at which the same penetrator reaches depth D in S (inverse of young, for what is left after a layer). */
export function youngSpeed(m: number, A: number, D: number, S: number, N = 1): number {
  if (D <= 0) return 0;
  return 30.5 + D / (1.8e-5 * S * N * Math.pow(m / A, 0.7));
}
