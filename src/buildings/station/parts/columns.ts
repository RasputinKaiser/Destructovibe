import type { PieceSpec } from '../../../types.ts';
import type { Frame } from '../../assemble.ts';
import { block, prism, weldParts, type PieceOpts, type Range } from '../../../levels/kit.ts';
import { TINT } from '../../_shared/base.ts';
import { ribLines } from '../frame.ts';
import { CAST } from '../lib.ts';

/** Cast-iron columns (two lifts) on stone pads under every rib line, capital and bearing plate up to the girder seat. */
export function columns(f: Frame): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const cast: PieceOpts = { tint: CAST }, seat = f.levels.girderSeat, pad = f.levels.platform;
  // bearing plate 0.3 m under the seat, capital 0.3 m under that; the shaft is cast in two equal lifts
  const neck = seat - 0.6, cap = neck + 0.3, mid = (pad + neck) / 2;
  for (const x of [f.grid.x.colW, f.grid.x.colE]) {
    for (const z of ribLines(f)) {
      ps.push(block('stone', [x - 0.4, x + 0.4], [f.levels.ground, pad], [z - 0.4, z + 0.4], { tint: TINT.stone }));
      for (const y of [[pad, mid], [mid, neck]] as Range[]) ps.push(prism('castiron', 0.45, y, x, z, 16, cast));
      ps.push(weldParts([prism('castiron', 0.62, [neck, cap], x, z, 16, cast), block('castiron', [x - 0.4, x + 0.4], [cap, seat], [z - 0.4, z + 0.4], cast)]));
    }
  }
  return ps;
}
