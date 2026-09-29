import type { PieceSpec } from '../../../types.ts';
import { block, crates, drums, hull, panels, pitchedRoof, wallRun, type Range } from '../../../levels/kit.ts';
import { canopy } from '../../../levels/facade.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';

/** Two-storey timber-framed barn, 12 x 7.5 m: full-height posts, hayloft on tie beams, wall plates, king-post
    trusses, plank cladding with barn and loft doors, shingle roof on purlins. Nearly all timber, so it snaps and burns. */
export function timberBarn(p: Placement & { hay?: boolean }): PieceSpec[] {
  const px = [-6, -2, 2, 6], pz = 3.75, w = 0.25, hw = w / 2, loft = 3.0, eave = 5.8;
  const oak = { tint: TINT.woodDark }, pine = { tint: TINT.woodPale };
  const ps: PieceSpec[] = [];
  for (const x of px) {
    for (const z of [-pz, pz]) ps.push(block('oak', [x - hw, x + hw], [0, eave], [z - hw, z + hw], oak));
    ps.push(block('oak', [x - hw, x + hw], [loft - 0.25, loft], [-pz + hw, pz - hw], oak));
    ps.push(block('oak', [x - hw, x + hw], [eave + 0.25, eave + 0.5], [-pz - hw, pz + hw], oak));
  }
  ps.push(...panels('plywood', [-2, 2, 6], [loft, loft + 0.08], [-pz + hw, -1.2083, 1.2083, pz - hw], pine));
  for (const z of [-pz, pz]) {
    for (const r of [[-6 - hw, -2], [-2, 2], [2, 6 + hw]] as Range[]) ps.push(block('oak', r, [eave, eave + 0.25], [z - hw, z + hw], oak));
  }
  const base = eave + 0.5;
  const skin = { mat: 'wood' as const, t: 0.08, maxW: 3.5, tint: TINT.barnRed };
  const X = 6 + hw + 0.08, Zc = pz + hw + 0.04, Xc = 6 + hw + 0.04;
  const rows: [number, number][] = [[0, loft], [loft, base - loft]];
  ps.push(...wallRun({ ...skin, from: -X, to: X, at: Zc, y0: 0, h: loft, openings: [{ c: 0, w: 3.2, y0: 0, h: 2.8 }] }));
  ps.push(...wallRun({ ...skin, from: -X, to: X, at: Zc, y0: loft, h: base - loft, openings: [{ c: 0, w: 1.6, y0: 0.4, h: 1.8, glass: false }] }));
  for (const [y0, h] of rows) ps.push(...wallRun({ ...skin, from: -X, to: X, at: -Zc, out: -1, y0, h }));
  const vent = { c: 0, w: 0.8, y0: 1.4, h: 0.8, glass: false };
  for (const s of [-1, 1] as const) {
    const end = { ...skin, axis: 'z' as const, from: -pz - hw, to: pz + hw, at: s * Xc, out: s };
    ps.push(...wallRun({ ...end, y0: 0, h: loft, openings: s > 0 ? [{ c: 0, w: 1.2, y0: 0, h: 2.2 }] : [] }));
    ps.push(...wallRun({ ...end, y0: loft, h: base - loft, openings: [vent] }));
  }
  const zr = pz + hw + 0.08, seat = 0.2, rise = 3.0;
  ps.push(...pitchedRoof({ mat: 'wood', x: [-6.6, 6.6], z: [-zr, zr], y: base, rise, thick: 0.26, seat, maxW: 4.5, tint: TINT.shingle,
    gables: { mat: 'wood', x: [[-X, -X + 0.08], [X - 0.08, X]], tint: TINT.barnRed } }));
  // king posts with gabled heads bearing on both roof slabs at the ridge
  const k = rise / (zr - seat), apex = base + rise;
  for (const x of [-2, 2]) {
    const pts: [number, number, number][] = [];
    for (const xx of [x - 0.1, x + 0.1]) {
      for (const z of [-0.1, 0.1]) pts.push([xx, base, z], [xx, apex - k * 0.1, z]);
      pts.push([xx, apex, 0]);
    }
    ps.push(hull('oak', pts, oak));
  }
  // bracketed hay hood over the loft door
  ps.push(...canopy({ face: Zc + 0.04 }, [-1.1, 1.1], 5.3, 0.8, { mat: 'wood', tint: TINT.woodDark, t: 0.25, brackets: true }));
  if (p.hay) {
    ps.push(...crates(4, -1.8, loft + 0.08, 2, 2, 2), ...crates(0, 2.2, loft + 0.08, 2, 1, 1), ...crates(-4, 1.5, 0, 1, 2, 1));
    ps.push(...drums('barrel', -4, -2.3, 0, 2, 1));
  }
  return put(ps, p, 'barn');
}
