import type { MaterialId } from '../../types';

/** Solid thermal properties: conductivity W/m·K, specific heat J/kg·K, surface emissivity, linear expansion 1/K,
 * free moisture (kg water per kg solid, evaporated at 100 °C before the solid heats further). */
export interface Thermo { k: number; c: number; eps: number; alpha: number; moist?: number }

/* EN 1992/1993/1995/1996-1-2 ambient values, CIBSE Guide A for the rest. */
export const THERMO: Record<MaterialId, Thermo> = {
  concrete: { k: 1.6, c: 900, eps: 0.7, alpha: 10e-6 },
  rconcrete: { k: 1.8, c: 900, eps: 0.7, alpha: 11e-6 },
  brick: { k: 0.8, c: 840, eps: 0.9, alpha: 6e-6 },
  cinderblock: { k: 0.6, c: 840, eps: 0.9, alpha: 8e-6 },
  stone: { k: 2.8, c: 790, eps: 0.9, alpha: 8e-6 },
  sandstone: { k: 2.3, c: 800, eps: 0.9, alpha: 11e-6 },
  marble: { k: 2.5, c: 880, eps: 0.9, alpha: 7e-6 },
  terracotta: { k: 0.9, c: 840, eps: 0.9, alpha: 6e-6 },
  ceramic: { k: 1.2, c: 850, eps: 0.9, alpha: 6e-6 },
  asphalt: { k: 0.75, c: 920, eps: 0.93, alpha: 20e-6 },
  copper: { k: 390, c: 385, eps: 0.6, alpha: 17e-6 },
  adobe: { k: 0.6, c: 900, eps: 0.9, alpha: 7e-6 },
  plaster: { k: 0.7, c: 900, eps: 0.9, alpha: 12e-6 },
  // gypsum's 21 % water of crystallisation is what makes plasterboard a fire barrier
  drywall: { k: 0.25, c: 1000, eps: 0.9, alpha: 16e-6, moist: 0.2 },
  wood: { k: 0.13, c: 1600, eps: 0.9, alpha: 5e-6, moist: 0.12 },
  oak: { k: 0.17, c: 1700, eps: 0.9, alpha: 5e-6, moist: 0.12 },
  plywood: { k: 0.13, c: 1600, eps: 0.9, alpha: 6e-6, moist: 0.1 },
  steel: { k: 45, c: 490, eps: 0.7, alpha: 12e-6 },
  castiron: { k: 50, c: 460, eps: 0.8, alpha: 10.5e-6 },
  aluminum: { k: 200, c: 900, eps: 0.3, alpha: 23e-6 },
  metal: { k: 50, c: 490, eps: 0.7, alpha: 12e-6 },
  pvc: { k: 0.17, c: 1000, eps: 0.9, alpha: 70e-6 },
  lamp: { k: 1, c: 840, eps: 0.9, alpha: 9e-6 },
  machine: { k: 45, c: 500, eps: 0.8, alpha: 12e-6 },
  glass: { k: 1, c: 840, eps: 0.92, alpha: 9e-6 },
  tempered: { k: 1, c: 840, eps: 0.92, alpha: 9e-6 },
  roof: { k: 0.84, c: 800, eps: 0.9, alpha: 6e-6 },
  crate: { k: 0.12, c: 1600, eps: 0.9, alpha: 5e-6, moist: 0.1 },
  barrel: { k: 50, c: 490, eps: 0.7, alpha: 12e-6 },
  propane: { k: 50, c: 490, eps: 0.7, alpha: 12e-6 },
  tnt: { k: 0.23, c: 1370, eps: 0.9, alpha: 50e-6 },
  insulation: { k: 0.025, c: 1400, eps: 0.9, alpha: 60e-6 },
  frp: { k: 0.3, c: 1100, eps: 0.9, alpha: 12e-6 },
  cardboard: { k: 0.07, c: 1400, eps: 0.9, alpha: 5e-6, moist: 0.08 },
  rubber: { k: 0.15, c: 1900, eps: 0.9, alpha: 200e-6 },
};

/** Burning solid: heat release per m² of exposed face at the flaming peak (kW/m², cone at 50 kW/m²), effective heat
 * of combustion (MJ/kg), soot and CO yields (kg/kg, well ventilated), soot blackness (0 grey-brown, 1 black) and the
 * surface temperature where pyrolysis starts (°C). SFPE Handbook ch. 36 (Tewarson) and cone data. */
export interface Burn { hrr: number; dH: number; soot: number; co: number; dark: number; pyro: number }

export const BURN: Partial<Record<MaterialId, Burn>> = {
  wood: { hrr: 150, dH: 12.4, soot: 0.015, co: 0.004, dark: 0.2, pyro: 250 },
  oak: { hrr: 120, dH: 12.4, soot: 0.012, co: 0.004, dark: 0.2, pyro: 270 },
  plywood: { hrr: 180, dH: 12, soot: 0.015, co: 0.005, dark: 0.3, pyro: 240 },
  crate: { hrr: 200, dH: 12.4, soot: 0.015, co: 0.004, dark: 0.2, pyro: 250 },
  // HCl and CO together, counted as CO-equivalent toxicity
  pvc: { hrr: 90, dH: 5.7, soot: 0.17, co: 0.1, dark: 1, pyro: 200 },
  insulation: { hrr: 250, dH: 24, soot: 0.1, co: 0.03, dark: 0.9, pyro: 250 },
  frp: { hrr: 180, dH: 15, soot: 0.08, co: 0.02, dark: 0.8, pyro: 300 },
  cardboard: { hrr: 250, dH: 13, soot: 0.01, co: 0.004, dark: 0.15, pyro: 230 },
  rubber: { hrr: 300, dH: 30, soot: 0.15, co: 0.05, dark: 1, pyro: 300 },
};

/** Soft furnishings by fabric (for callers feeding burning cloth/foam in with addFire). */
export const FABRIC_BURN: Record<string, Burn> = {
  foam: { hrr: 450, dH: 23, soot: 0.13, co: 0.03, dark: 1, pyro: 200 },
  poly: { hrr: 350, dH: 21, soot: 0.09, co: 0.02, dark: 0.9, pyro: 250 },
  cotton: { hrr: 150, dH: 14, soot: 0.02, co: 0.01, dark: 0.35, pyro: 250 },
  canvas: { hrr: 150, dH: 14, soot: 0.02, co: 0.01, dark: 0.35, pyro: 250 },
  velvet: { hrr: 200, dH: 15, soot: 0.03, co: 0.01, dark: 0.45, pyro: 250 },
  tarp: { hrr: 300, dH: 20, soot: 0.08, co: 0.02, dark: 0.9, pyro: 230 },
  hemp: { hrr: 150, dH: 14, soot: 0.02, co: 0.01, dark: 0.35, pyro: 250 },
};

/* EN 1993-1-2 §3.4.1.1: thermal elongation of carbon steel, with the α–γ transformation plateau at 750–860 °C. */
export function steelStrain(t: number): number {
  if (t < 20) return 1.2e-5 * (t - 20);
  if (t <= 750) return 1.2e-5 * t + 0.4e-8 * t * t - 2.416e-4;
  if (t <= 860) return 1.1e-2;
  return 2e-5 * t - 6.2e-3;
}

/* EN 1993-1-2 Table 3.1, k_E,θ: the slope of the linear elastic range. */
const KE: [number, number][] = [[100, 1], [200, 0.9], [300, 0.8], [400, 0.7], [500, 0.6], [600, 0.31], [700, 0.13], [800, 0.09], [900, 0.0675], [1000, 0.045], [1100, 0.0225], [1200, 0]];
export function steelModulus(t: number): number {
  if (t <= KE[0][0]) return 1;
  for (let i = 1; i < KE.length; i++) {
    if (t > KE[i][0]) continue;
    const [t0, k0] = KE[i - 1], [t1, k1] = KE[i];
    return k0 + ((k1 - k0) * (t - t0)) / (t1 - t0);
  }
  return 0;
}

/** Cooling drop within one 0.25 s heat tick that cracks a quenched solid (K), and the temperature it must start above. */
export const SHOCK: Partial<Record<MaterialId, [number, number]>> = {
  glass: [60, 80], tempered: [200, 220], lamp: [90, 110], ceramic: [150, 170], castiron: [250, 300],
  concrete: [300, 350], rconcrete: [300, 350], stone: [250, 300], marble: [250, 300], sandstone: [250, 300],
};
