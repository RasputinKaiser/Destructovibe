import type { PieceSpec } from '../../../types.ts';
import { cyl } from '../../../levels/kit.ts';
import { C, CAP, IRON, SHAFT, SHAFT_TOP, SIDES, SOOT, STONE, outer, ring, wall } from '../lib.ts';

/* Corbelled cap: six oversailing courses of 50 mm each (300 mm out), ten plain courses and a stone coping course, all
   one brick thick and soot-black; a wrought-iron band under the coping; the copper air terminal on the north wall. */
export function cap(): PieceSpec[] {
  const ps: PieceSpec[] = [], y0 = SHAFT_TOP, y1 = y0 + CAP.h, o0 = outer(y0), inner = o0 - SHAFT.walls[SHAFT.walls.length - 1];
  const k0 = Math.round(y0 / C), ws: PieceSpec[] = [];
  const o = (y: number) => o0 + Math.min(CAP.out, Math.max(0, (y - y0) / C) * (CAP.out / CAP.corbel));
  for (const side of SIDES) {
    const full = side.axis === 'x';
    ws.push(wall(side, [y0, y1], o, inner, full ? o : () => inner, {
      tint: SOOT,
      course: (k) => (k === k0 + 15 ? { mat: 'stone', tint: STONE } : null),
      band: (k) => k === k0 + 13,
      tape: side.axis === 'z' && side.s < 0 ? -0.4 : undefined,
    }));
  }
  ps.push(ring(ws));
  const rod = cyl('copper', 0.04, [y1, y1 + 1.5], -0.4, -(inner + o0 + CAP.out) / 2, { tint: 0x7a5a3a });
  rod.lps = true;
  ps.push(rod);
  void IRON;
  return ps;
}
