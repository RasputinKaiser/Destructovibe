import type { Frame } from '../assemble.ts';
import type { Range } from '../../levels/kit.ts';

export interface CathedralParams { bays: number }

/* Member sizes shared by several parts (m). Positions and levels live in the frame. */
export const END_W = 1.2;      // end-wall thickness
export const CAPW = 0.95;      // half-width of a pier capital; arches spring this far off the bay line
export const TOWER_A = 4.5;    // half-width of the west tower
export const TOWER_T = 1.2;    // tower wall thickness
export const BAY = 6.5, WEST = 18;

export const LIME = 0xd9d0bc, DARK = 0xb9ae98, SLATE = 0x5f656e, OAK = 0x6e5238;

/** Datums for a `bays`-bay church. Bay lines run from the west wall's inner face (bay0) eastward; the last one is the
    east wall's outer face. Nave axis along Z, west front toward +Z. */
export function frame(p: CathedralParams): Frame {
  const bays = p.bays ?? 6;
  const z: Record<string, number> = {};
  for (let i = 0; i <= bays; i++) z[`bay${i}`] = WEST - BAY * i;
  const west = z.bay0, east = z[`bay${bays}`];
  const towerFace = west + END_W + 0.08;   // 80 mm movement joint between the west wall and the tower
  z.towerFace = towerFace;
  const cz = towerFace + TOWER_A;
  const levels = { floor: 0.3, pierTop: 8, capital: 8.6, aisleEaves: 9.5, arcadeTop: 13.4, springing: 15.5, wallPlate: 22.5, belfryFloor: 24, spireSeat: 30.8 };
  const x = { nave: 5, arcade: 6, aisleIn: 10.6, aisleOut: 11.5 };
  const tx: Range = [-TOWER_A, TOWER_A], tz: Range = [cz - TOWER_A, cz + TOWER_A];
  return {
    levels,
    grid: { x, z },
    footprint: { x: [-(x.aisleOut + 2.2), x.aisleOut + 2.2], z: [east, towerFace + 2 * TOWER_A] },
    bearings: {
      arcadeTop: { y: levels.arcadeTop, x: [-x.arcade, x.arcade], z: [east, west] },
      navePlate: { y: levels.wallPlate, x: [-x.arcade, x.arcade], z: [east, west] },
      aislePlate: { y: levels.aisleEaves, x: [x.aisleIn, x.aisleOut], z: [east, west] },   // the +x aisle wall; mirrored at -x
      belfryFloor: { y: levels.belfryFloor, x: tx, z: tz },
      spireSeat: { y: levels.spireSeat, x: [-3.6, 3.6], z: [cz - 3.6, cz + 3.6] },
    },
  };
}

/** Bay lines bay0..bayN, west to east. */
export function bayLines(f: Frame): number[] {
  const out: number[] = [];
  for (let i = 0; `bay${i}` in f.grid.z; i++) out.push(f.grid.z[`bay${i}`]);
  return out;
}
