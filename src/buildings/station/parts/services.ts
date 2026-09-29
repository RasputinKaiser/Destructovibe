import type { PieceSpec } from '../../../types.ts';
import type { Frame } from '../../assemble.ts';
import { place } from '../../../levels/kit.ts';
import { LIGHT, streetLamp } from '../../../levels/services.ts';

/** Platform lamps, each on its own feeder, standing on the platform decks. */
export function services(f: Frame): PieceSpec[] {
  const ps: PieceSpec[] = [];
  for (const [x, z, q] of [[-14.5, -30, 0], [0, -20, 0], [0, -40, 2], [14.5, -30, 2]] as [number, number, number][]) {
    for (const p of place(streetLamp(4.5, 0.6, LIGHT.warm), x, z, q)) ps.push({ ...p, pos: [p.pos[0], p.pos[1] + f.levels.platform, p.pos[2]] });
  }
  return ps;
}
