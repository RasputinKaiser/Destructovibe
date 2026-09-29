import type { PieceSpec } from '../../../types.ts';
import { BLUE, PED, SOOT, duct } from '../lib.ts';

/* The boiler flue: a 1.5 m wide brick duct 1.95 m high from the pedestal's inlet to the boiler house's wall, `wall`
   metres from the chimney's axis, sooted, capped with blue bricks. */
export function flue(wall: number): PieceSpec[] {
  if (wall - PED.half <= 0.3) return [];
  return [duct([PED.half, wall], [0, 1.95], [-0.75, 0.75], { tint: SOOT, course: (k) => (k >= 24 ? { tint: BLUE } : null) })];
}
