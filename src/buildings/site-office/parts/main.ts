import type { PieceSpec } from '../../../types.ts';
import { block, panels, place, stairs, wallRun } from '../../../levels/kit.ts';
import { band, downpipe } from '../../../levels/facade.ts';
import { conduit, generatorSet, lamp, LIGHT } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Site office on blocks: steel chassis, clad box with windows, timber steps on the door side (+Z). */
export function siteOffice(p: Placement): PieceSpec[] {
  const X = 3.6, Z = 1.3, t = 0.08, y0 = 0.65, h = 2.3;
  const skin = { mat: 'metal' as const, t, y0, h, tint: TINT.metalWhite };
  const win = (c: number) => ({ c, w: 1.2, y0: 0.9, h: 0.9 });
  const ps: PieceSpec[] = [];
  for (const sx of [-2.8, 2.8]) for (const sz of [-0.9, 0.9]) ps.push(block('cinderblock', [sx - 0.25, sx + 0.25], [0, 0.45], [sz - 0.25, sz + 0.25], { tint: TINT.darkConcrete }));
  ps.push(block('steel', [-X, X], [0.45, y0], [-Z, Z], { tint: TINT.steelGrey }));
  ps.push(...wallRun({ ...skin, from: -X, to: X, at: Z - t / 2, openings: [{ c: -2.4, w: 0.9, y0: 0, h: 2.0 }, win(-0.6), win(1.6)] }));
  ps.push(...wallRun({ ...skin, from: -X, to: X, at: -Z + t / 2, out: -1, openings: [win(-1.6), win(1.0)] }));
  ps.push(...wallRun({ ...skin, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1, openings: [{ c: 0, w: 0.8, y0: 0.9, h: 0.9 }] }));
  ps.push(...wallRun({ ...skin, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2, maxW: 2.5 }));
  ps.push(...panels('metal', [-X - 0.1, 0, X + 0.1], [y0 + h, y0 + h + 0.1], [-Z - 0.1, Z + 0.1], { tint: TINT.steelGrey }));
  ps.push(...place(stairs('wood', 0, [-0.5, 0.5], 0, 2, 0.3, 0.3, { tint: TINT.woodDark }), -2.4, Z + 0.6, 1));
  ps.push(...band({ mat: 'pvc', face: Z, from: -X, to: X, y: [y0 + h - 0.12, y0 + h], depth: 0.1, tint: 0x3a3d40 }), ...downpipe({ face: Z }, 3.3, [0, y0 + h - 0.12]));
  // site generator on the east end: its lead climbs the end wall to a floodlight over the door side
  ps.push(...place(generatorSet(), X + 0.65, 0, 1));
  ps.push(...conduit([[X + 0.2, 0.9, -0.75], [X + 0.04, 0.9, -0.75], [X + 0.04, y0 + h - 0.06, -0.75], [X + 0.04, y0 + h - 0.06, Z - 0.2]]));
  ps.push(lamp([X, X + 0.3], [y0 + h - 0.4, y0 + h - 0.1], [Z - 0.5, Z - 0.2], LIGHT.flood));
  return put(ps, p, 'office', { protected: true });
}
