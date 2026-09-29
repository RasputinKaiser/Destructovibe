import type { PieceSpec, Vec3 } from '../../../types.ts';
import { hull } from '../../../levels/kit.ts';
import { BLUE, CAPSTONE, PED, liftY, SHAFT, SIDES, STONE, outer, ring, wall, withUnits, type Side } from '../lib.ts';

/** the base course's walls are laid in thirds, jointed at ±SPLIT along each face: a gob cut through one face and the
    near thirds of the two faces beside it (and their middle thirds, to run the cut past the centre line) leaves the
    far face and far thirds standing as the hinge; which thirds go sets the direction */
export const SPLIT = 0.7;
const SLATE = 0x45484c, GAP = 0.03;

/* Pedestal: 4.0 m square, 680 mm (three-brick) walls in English bond on a blue engineering-brick plinth, 4.5 m high.
   The lowest 1.2 m (16 courses) is the base course, each wall in three lengths (the east and west walls run to the
   corners, the north and south walls stop at them); the east wall's middle length is the flue inlet (1.4 m wide, the
   base course's full height, bridged by the lift above), closed by the flue duct from the boiler house. A cast-iron
   soot door in the south wall. Above it the rest of the pedestal, 3.3 m, is one lift with its weathered stone capping
   course, which oversails inward to carry the shaft's walls on the pedestal's. */
export function pedestal(): PieceSpec[] {
  const ps: PieceSpec[] = [], h = PED.half, i = h - PED.wall;
  const plinth = (k: number) => (k < 4 ? { tint: BLUE } : k === 15 ? { mat: 'stone' as const, tint: SLATE } : null);
  // its top course is the damp-proof course, two slates in cement, and the lift above stands on it across an open
  // joint (no bond: it only bears there)
  const y0: [number, number] = [0, PED.low - GAP];
  for (const side of SIDES) {
    const e = side.axis === 'x' ? h : i;
    for (const span of [[-e, -SPLIT], [-SPLIT, SPLIT], [SPLIT, e]] as [number, number][]) {
      if (side.axis === 'x' && side.s > 0 && span[0] === -SPLIT) continue;
      const door = side.axis === 'z' && side.s > 0 && span[0] === -SPLIT;
      ps.push(wall(side, y0, () => h, i, () => e, { course: plinth, span, plate: door ? { u: [-0.3, 0.3], y: [0.15, 1.05] } : undefined }));
    }
  }
  const y1: [number, number] = [PED.low, PED.top];
  ps.push(ring([...SIDES.map((side) => wall(side, y1, () => h, i, side.axis === 'z' ? () => h : () => i, { course: (k) => (k === 16 ? { tint: BLUE } : null) })), ...capstone()]));
  return ps;
}

/** The weathered stone course, one stone to each face (lapping at the corners like the lift below): flat under the
    shaft, falling 60 mm to its 100 mm oversail. */
function capstone(): PieceSpec[] {
  const ws: PieceSpec[] = [], o = PED.half + 0.1, flat = outer(SHAFT.y0) + 0.05, i = outer(liftY(0)[1]) - SHAFT.walls[0] - 0.02;
  const [y0, y1] = CAPSTONE, drop = y1 - 0.06;
  const at = (s: Side, u: number, y: number, t: number): Vec3 => (s.axis === 'z' ? [u, y, s.s * t] : [s.s * t, y, u]);
  for (const side of SIDES) {
    const full = side.axis === 'x';
    const shape = (u0: number, u1: number): Vec3[] => {
      const pts: Vec3[] = [];
      for (const u of [u0, u1]) pts.push(at(side, u, y0, i), at(side, u, y0, o), at(side, u, y1, i), at(side, u, y1, flat), at(side, u, drop, o));
      return pts;
    };
    const e = full ? o : i;
    // stones of about 0.9 m, each its own hull unit inside the course
    const n = Math.max(1, Math.round((2 * e) / 0.9)), units: PieceSpec[] = [];
    for (let k = 0; k < n; k++) units.push(hull('stone', shape(-e + (2 * e * k) / n + 0.003, -e + (2 * e * (k + 1)) / n - 0.003), { tint: STONE }));
    const pts = shape(-e, e);
    ws.push(withUnits(hull('brick', pts, { tint: STONE }), units, pts));
  }
  return ws;
}
