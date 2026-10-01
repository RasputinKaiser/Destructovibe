/* A contact charge against a wall or slab (the satchel pressed on): the field-manual breaching rule P = R³·K·C (P lb of
   TNT, R ft, the radius inside which the charge destroys the wall) sets the hole, and the charge's energy beyond that
   goes into the air. K by material (FM 5-250 classes: earth and timber 0.23, ordinary concrete and good masonry 0.35,
   dense concrete and first-class masonry 0.45; reinforced concrete fitted to FM 3-06.11 Table 8-2). C for an
   untamped charge on the face is fitted here, not sourced: 3.2 puts 5 lb of C-4 at the FM 3-06.11 man-sized hole
   (≈ 1 m²) in plain concrete. A wall thicker than R is not breached, only cratered and scabbed. */
import type { MaterialId, Vec3 } from '../../types';
import { explode, damagePiece, cutRebarNear, type Piece } from '../../destruction/structure';
import { fx } from '../../render/fx';
import { strikes } from '../../render/strikes';
import { chord } from '../tools/common';

const K: Partial<Record<MaterialId, number>> = {
  // reinforced: fitted to FM 3-06.11 Table 8-2 (5 kg TNT for <= 10 cm, 20 kg for 15-20 cm): the bars hold the breach shut
  concrete: 0.35, rconcrete: 5, brick: 0.35, cinderblock: 0.23, stone: 0.45, sandstone: 0.35, marble: 0.45, terracotta: 0.23,
  adobe: 0.23, plaster: 0.23, drywall: 0.23, wood: 0.23, oak: 0.23, plywood: 0.23, asphalt: 0.23, ceramic: 0.35,
};
export const BREACH_C = 3.2;
const FT = 0.3048, LB = 0.4536;

/** Breach radius (m) a contact charge of `kg` TNT-eq makes in `mat`. */
export function breachRadius(kg: number, mat: MaterialId): number {
  const k = K[mat];
  if (k === undefined) return 0;
  return Math.cbrt(kg / LB / (k * BREACH_C)) * FT;
}

export const breachLog: { mat: string; thick: number; R: number; breached: boolean }[] = [];

/** Fire a contact charge of `kg` TNT-eq at `at` on host's face (outward normal n). */
/** face: the face it was pressed on, when it still sits where it was pressed (it goes off on that side) */
export function contactCharge(kg: number, at: Vec3, n: Vec3, host: Piece | null, face: Vec3 | null = null): void {
  const b = { radius: 3.1 * Math.cbrt(kg), power: 60e3 * kg, impulse: 2150 * Math.sqrt(kg) };
  const R = host ? breachRadius(kg, host.mat) : 0;
  const thick = host ? chord(host, at, [-n[0], -n[1], -n[2]]) : 0;
  if (host && R > 0) {
    const breached = R >= thick;
    breachLog.push({ mat: host.mat, thick, R, breached });
    if (breachLog.length > 16) breachLog.shift();
    cutRebarNear(host, at, breached ? R : 0);
    if (breached) {
      // the wall inside R goes; where the sphere of radius R meets the back face the hole is √(R² − t²) across: a thicker
      // wall leaves a narrower breach
      explode(at, Math.max(0.3, Math.sqrt(R * R - thick * thick)), b.power, b.impulse * 0.5, 1, 12, 0, false, n);
    } else {
      damagePiece(host, at, Math.min(host.hp * 0.45, b.power), true);
      if (!host.dead) strikes.add(host, at, n, Math.min(1.2, R * 2));
      fx.debris(at, 14, host.pm.chips, 5, n);
    }
    /* what the wall did not take goes into the air on the charge's side: no fresh breaking by the shock, a few welds
       near by. The charge's gas is all of it, once: a room on that side is pressurised by the whole charge */
    const o: Vec3 = [at[0] + n[0] * Math.max(0.6, R), at[1] + n[1] * Math.max(0.6, R), at[2] + n[2] * Math.max(0.6, R)];
    explode(o, b.radius, b.power * 0.5, b.impulse, 0.15, 0, b.power, false, n);
    return;
  }
  explode(at, b.radius, b.power, b.impulse, 1.45, 30, b.power, false, face);
}
