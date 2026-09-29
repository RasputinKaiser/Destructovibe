import type { PieceSpec } from '../../../types.ts';
import { block, cyl, grid, panels, pitchedRoof, scaffold, timberWall, GLASS_T, type Opening, type Range } from '../../../levels/kit.ts';
import { band, canopy, dormer, downpipe } from '../../../levels/facade.ts';
import { bed, bookcase, chair, fit, table, wardrobe } from '../../../levels/interior.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Two-storey jettied box-frame house: oak frame on a brick plinth with daub infill, braced end bays,
    oak joists carrying a jettied upper floor on a bressumer, tiled roof on purlins, brick gable chimney. */
export function timberFrameHouse(p: Placement & { scaffold?: boolean }): PieceSpec[] {
  const X = 3.6, Z = 2.4, J = 0.4, wt = 0.3, plinth = 0.4, sh = 2.5;
  const up0 = plinth + sh + 0.2;
  const oak = { tint: TINT.woodDark }, brick = { tint: TINT.brickDark };
  const frame = { frame: 'oak' as const, infill: 'adobe' as const, frameTint: TINT.woodDark, tint: TINT.cream, rail: 1.0, mullion: 'oak' as const };
  const posts = [-3.5, -1.2, 1.2, 3.5];
  const braces = [{ bay: 0, dir: 1 as const }, { bay: 2, dir: -1 as const }];
  const win = (c: number, w = 0.8) => ({ c, w, y0: 1.15, h: 0.9 });
  const ps: PieceSpec[] = [
    ...grid('brick', [-X, X], [0, plinth], [Z - wt, Z], { x: 4 }, brick),
    ...grid('brick', [-X, X], [0, plinth], [-Z, -Z + wt], { x: 4 }, brick),
    block('brick', [-X, -X + wt], [0, plinth], [-Z + wt, Z - wt], brick),
    block('brick', [X - wt, X], [0, plinth], [-Z + wt, Z - wt], brick),
  ];
  const storey = (y0: number, front: number, openF: Opening[], openB: Opening[], openS: Opening[][]) => {
    ps.push(...timberWall({ ...frame, from: -X, to: X, face: front, y0, h: sh, posts, braces, openings: openF }));
    ps.push(...timberWall({ ...frame, from: -X, to: X, face: -Z, out: -1, y0, h: sh, posts, braces, openings: openB }));
    const zr: Range = [-Z + wt, front - wt];
    for (const s of [-1, 1] as const) {
      ps.push(...timberWall({ ...frame, axis: 'z', from: zr[0], to: zr[1], face: s * X, out: s, y0, h: sh,
        posts: [zr[0] + 0.1, (zr[0] + zr[1]) / 2, zr[1] - 0.1], openings: openS[s > 0 ? 1 : 0] }));
    }
  };
  storey(plinth, Z, [{ c: 0, w: 1.0, y0: 0.2, h: 1.9, glass: false }, win(-1.85), win(1.85)], [win(-1.85), win(0, 1.0), win(1.85)],
    [[{ c: 1.0, w: 0.7, y0: 1.15, h: 0.9 }], [{ c: -1.0, w: 0.7, y0: 1.15, h: 0.9 }]]);
  // jetty: oak joists sit on the ground-floor plates and run 0.4 m past the front to carry the upper front wall
  const jy: Range = [plinth + sh, up0];
  for (const x of [-X + 0.15, -1.75, 0, 1.75, X - 0.15]) {
    const w = Math.abs(x) > 3 ? 0.15 : 0.1;
    ps.push(block('oak', [x - w, x + w], jy, [-Z, Z + J], oak));
  }
  storey(up0, Z + J, [win(-1.85), win(0, 1.4), win(1.85)], [win(-1.85), win(1.85)],
    [[{ c: -1.0, w: 0.7, y0: 1.15, h: 0.9 }], [{ c: -1.0, w: 0.7, y0: 1.15, h: 0.9 }]]);
  ps.push(...panels('plywood', [-X + wt, 0, X - wt], [up0, up0 + 0.08], [-Z + wt, Z + J - wt], { tint: TINT.woodPale }));
  const eave = up0 + sh;
  ps.push(...pitchedRoof({ mat: 'roof', x: [-X, X + 0.3], z: [-Z, Z + J], y: eave, rise: 2.8, thick: 0.42, seat: 0.2, maxW: 4,
    tint: TINT.terracotta, gables: { mat: 'adobe', x: [[-X, -X + wt], [X - wt, X]], tint: TINT.cream } }));
  const stackTop = eave + 3.4 + 0.6;
  ps.push(...grid('brick', [-X - 0.7, -X], [0, stackTop], [-0.6, 0.6], { y: 2.6 }, brick));
  ps.push(block('stone', [-X - 0.75, -X + 0.05], [stackTop, stackTop + 0.1], [-0.65, 0.65], { tint: TINT.stone }));
  for (const z of [-0.22, 0.22]) ps.push(cyl('terracotta', 0.22, [stackTop + 0.1, stackTop + 0.5], -X - 0.35, z, { tint: TINT.terracotta }));
  if (p.interior !== false) {
    ps.push(...fit(table(1.4, 0.8), 1.0, 0, 0), ...fit(chair(), 1.0, -0.8, 0), ...fit(chair(), 1.0, 0.8, 0), ...fit(bookcase(1.2, 1.8), -2.2, -Z + wt + 0.16, 0));
    ps.push(...fit(bed(true), -1.6, 0.3, up0 + 0.08), ...fit(wardrobe(1.0), 2.6, -1.6, up0 + 0.08));
  }
  // two front dormers sitting flush on the upper roof slope, each glazed
  {
    const zr: Range = [-Z, Z + J], mid = (zr[0] + zr[1]) / 2, half = (zr[1] - zr[0]) / 2, k = 2.8 / (half - 0.2);
    const ridgeTop = eave + k * (half - 0.2 - 0.12) + 0.42, yAt = (d: number) => ridgeTop - k * (d - 0.12);
    for (const x of [-2.2, 1.2]) {
      const front = 1.9, top = 7.4, back = 0.12 + (ridgeTop - top) / k;
      ps.push(...dormer([x - 0.6, x + 0.6], mid, 1, front, back, top, yAt, { tint: TINT.terracotta }));
      ps.push(block('glass', [x - 0.42, x + 0.42], [yAt(front) + 0.12, top - 0.1], [mid + front, mid + front + GLASS_T]));
    }
  }
  // bracketed door hood, gutters on both eaves, two rear downpipes
  ps.push(...canopy({ face: Z }, [-0.75, 0.75], 2.52, 0.5, { mat: 'wood', tint: TINT.woodDark, t: 0.28, brackets: true }));
  const gy: Range = [eave - 0.14, eave];
  ps.push(...band({ mat: 'pvc', face: Z + J, from: -X, to: X, y: gy, depth: 0.13, tint: 0x3a3d40 }));
  ps.push(...band({ mat: 'pvc', face: -Z, out: -1, from: -X, to: X, y: gy, depth: 0.13, tint: 0x3a3d40 }));
  for (const x of [-3.0, 3.0]) ps.push(...downpipe({ face: -Z, out: -1 }, x, [0, gy[0]]));
  if (p.scaffold) ps.push(...scaffold({ from: -X, to: X, face: -Z, out: -1, height: eave - 0.1, tint: TINT.steelGrey }));
  return put(ps, p, 'tudor');
}
