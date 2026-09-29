import type { PieceSpec } from '../../../types.ts';
import type { Frame } from '../../assemble.ts';
import type { PieceOpts } from '../../../levels/kit.ts';
import { sect } from '../../../levels/architecture/common.ts';
import { ribLines } from '../frame.ts';
import { IRON } from '../lib.ts';

/** Riveted wrought-iron plate girders along each column line, capital to capital; the ribs spring from their tops. */
export function girders(f: Frame): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const iron: PieceOpts = { tint: IRON, joint: { kind: 'rivet', n: 12, d: 0.022 } }, RIBS = ribLines(f);
  for (const x of [f.grid.x.colW, f.grid.x.colE]) {
    for (let k = 0; k + 1 < RIBS.length; k++) {
      ps.push(sect('steel', [x - 0.225, x + 0.225], [f.levels.girderSeat, f.levels.springing], [RIBS[k + 1], RIBS[k]], { kind: 'I', t: 0.025, tw: 0.012, depth: 1 }, iron));
    }
  }
  return ps;
}
