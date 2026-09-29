import type { PieceSpec } from '../../../types.ts';
import { block, chamfer, cyl, extrude, weldParts, type PieceOpts, type Range } from '../../../levels/kit.ts';
import type { Frame } from '../../assemble.ts';
import { bayLines, CAPW, DARK, LIME } from '../frame.ts';
import { masonry } from '../lib.ts';

type P2 = [number, number];
const RISE = 4.0, RING = 0.6;

/** Two-centred pointed arch from u = a to u = b springing at ys: convex (u, y) polygons for its voussoirs, keystone
    and the spandrel slices above the extrados up to the level course at yt. */
function pointedArch(a: number, b: number, ys: number, rise: number, d: number, yt: number, nv = 3): P2[][] {
  const s = b - a, r = (s * s / 4 + rise * rise) / s, cl = a + r, m = (a + b) / 2;
  const ta = Math.acos((s / 2 - r) / r);
  const I = (t: number): P2 => [cl + r * Math.cos(t), ys + r * Math.sin(t)];
  const E = (t: number): P2 => [cl + (r + d) * Math.cos(t), ys + (r + d) * Math.sin(t)];
  const th = (i: number) => Math.PI - (i * (Math.PI - ta)) / nv;
  const left: P2[][] = [];
  for (let i = 0; i < nv; i++) {
    left.push([I(th(i)), I(th(i + 1)), E(th(i + 1)), E(th(i))]);
    left.push([E(th(i)), E(th(i + 1)), [E(th(i + 1))[0], yt], [E(th(i))[0], yt]]);
  }
  const mir = (pg: P2[]): P2[] => pg.map(([u, y]) => [a + b - u, y] as P2);
  const ek = E(ta);
  const key: P2[] = [[m, ys + rise], ek, [ek[0], yt], [a + b - ek[0], yt], [a + b - ek[0], ek[1]]];
  return [...left, ...left.map(mir), key];
}

/** Clustered stone piers on the interior bay lines, responds against the end walls, and pointed arcade arches with their
    spandrels up to the level course the clerestory stands on. */
export function arcade(f: Frame): PieceSpec[] {
  const ZB = bayLines(f), ZE = ZB[ZB.length - 1], XI = f.grid.x.nave, XO = f.grid.x.arcade;
  const PIER_TOP = f.levels.pierTop, CAP = f.levels.capital, LEVEL = f.levels.arcadeTop;
  const o: PieceOpts = { tint: LIME }, ps: PieceSpec[] = [];
  const pier = (x: number, z: number): PieceSpec[] => {
    const shafts = (y: Range) => weldParts([
      block('stone', [x - 0.5, x + 0.5], y, [z - 0.5, z + 0.5], o),
      ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => cyl('stone', 0.44, y, x + dx * 0.715, z + dz * 0.715, o)),
    ]);
    return [shafts([0, 4]), shafts([4, PIER_TOP]), chamfer('stone', [x - CAPW, x + CAPW], [PIER_TOP, CAP], [z - CAPW, z + CAPW], 0.12, o, 'top')];
  };
  for (const s of [-1, 1]) {
    const x = s * (XI + XO) / 2, xr: Range = s > 0 ? [XI, XO] : [-XO, -XI];
    for (let k = 1; k < ZB.length - 1; k++) ps.push(...pier(x, ZB[k]));
    // responds against the end walls
    ps.push(block('stone', xr, [0, CAP], [ZB[0] - CAPW, ZB[0]], o), block('stone', xr, [0, CAP], [ZE, ZE + CAPW], o));
    for (let k = 0; k + 1 < ZB.length; k++) {
      const a = ZB[k + 1] + CAPW, b = ZB[k] - CAPW;
      for (const pg of pointedArch(a, b, CAP, RISE, RING, LEVEL)) ps.push(extrude('stone', pg, 'x', xr, { ...o, tint: DARK }));
      // pier-top slice between the springers of neighbouring arches (and against the end walls)
      const hi = a - RING, lo = k + 2 === ZB.length ? ZE : hi - 2 * (CAPW - RING);
      if (hi - lo > 0.05) ps.push(block('stone', xr, [CAP, LEVEL], [lo, hi], { ...o, tint: DARK }));
      if (k === 0) ps.push(block('stone', xr, [CAP, LEVEL], [b + RING, ZB[0]], { ...o, tint: DARK }));
    }
  }
  return masonry(ps);
}
