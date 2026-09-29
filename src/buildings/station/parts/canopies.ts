import type { PieceSpec } from '../../../types.ts';
import type { Frame } from '../../assemble.ts';
import { block, extrude, prism, weldParts, type Range } from '../../../levels/kit.ts';
import { ribLines } from '../frame.ts';
import { CAST } from '../lib.ts';

/** Umbrella canopies on the platform ends beyond the shed: cast-iron column, bracketed head beam across the platform,
    boarded roof, fretted valance. */
export function canopies(f: Frame): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const top = f.levels.platform, end = f.grid.z.shedEnd, RIBS = ribLines(f);
  // two heads per canopy, 8 m apart; the boarding runs from the shed end to just short of the last rib
  const heads = [end + 12, end + 4], joint = end + 8, inner = RIBS[RIBS.length - 1] - 0.2;
  const rows: [number, Range][] = [[-16.8, [-17.6, -11.5]], [0, [-4.9, 4.9]], [16.8, [11.5, 17.6]]];
  for (const [cxp, span] of rows) {
    for (const zc of heads) {
      ps.push(prism('castiron', 0.3, [top, 4.0], cxp, zc, 16, { tint: CAST }));
      const head = weldParts([
        block('castiron', [span[0], span[1]], [4.0, 4.3], [zc - 0.15, zc + 0.15]),
        extrude('castiron', [[cxp - 0.15, 3.3], [cxp - 0.15, 4.0], [cxp - 1.4, 4.0]], 'z', [zc - 0.06, zc + 0.06]),
        extrude('castiron', [[cxp + 0.15, 3.3], [cxp + 0.15, 4.0], [cxp + 1.4, 4.0]], 'z', [zc - 0.06, zc + 0.06]),
      ].filter((q) => q.pos[0] - q.size[0] / 2 >= span[0] - 1e-6 && q.pos[0] + q.size[0] / 2 <= span[1] + 1e-6));
      head.tint = CAST;
      ps.push(head);
    }
    for (const z of [[end, joint], [joint, inner]] as Range[]) ps.push(block('wood', span, [4.3, 4.42], z, { tint: 0x7a6a58 }));
    for (const e of span) ps.push(block('wood', e === span[0] ? [e - 0.05, e] : [e, e + 0.05], [3.95, 4.42], [end, inner], { tint: 0xe9e1cf }));
  }
  return ps;
}
