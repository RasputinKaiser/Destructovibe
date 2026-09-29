import type { PieceSpec } from '../../../types.ts';
import { BRICK, SHAFT, SIDES, SOOT, liftY, outer, ring, wall } from '../lib.ts';

/* Shaft: 26.3 m of battered square brickwork, 2.6 m across at the base to 1.6 m under the cap (1 in 53 each face), in
   six lifts of 58-59 courses (~4.4 m). Walls step in at internal set-offs, 2.5 bricks (560 mm) for the lowest two lifts
   down to one brick (230 mm) for the top one, after the old rule of half a brick more for each 20 ft down. Each lift's
   four walls lap alternately at the corners, like the quoins of the courses they stand for. Soot darkens the top
   lifts; wrought-iron bands every 1.5 m over the upper half; the copper down-tape runs the north face. */
export function shaft(): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const n = SHAFT.courses.length;
  for (let j = 0; j < n; j++) {
    const y = liftY(j);
    const inner = outer(y[1]) - SHAFT.walls[j];
    const ws: PieceSpec[] = [];
    for (const side of SIDES) {
      const full = (side.axis === 'z') === (j % 2 === 0);
      ws.push(wall(side, y, outer, inner, full ? outer : () => inner, {
        tint: j >= n - 2 ? SOOT : BRICK,
        course: (k) => (j >= n - 2 && (k * 7) % 5 < 2 ? { tint: SOOT } : null),
        band: (k) => k * 0.075 > 17 && k % 20 === 10,
        tape: side.axis === 'z' && side.s < 0 ? -0.4 : undefined,
      }));
    }
    ps.push(ring(ws));
  }
  return ps;
}
