import type { PieceSpec } from '../../../types.ts';
import { block, cyl, extrude, splitRange, wallRun, type Opening, type Range } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { band, downpipe, bay as bayWindow, hood } from '../../../levels/facade.ts';
import { bar, bed, bookcase, chair, fit, sofa, stair, studWall, table, wardrobe, joistFloor, rafterRoof } from '../../../levels/interior.ts';
import { lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import { type Placement } from '../../_shared/base.ts';
import { door, put, win } from '../../_shared/structures-helpers.ts';

/** Victorian brick terrace: solid brick front and back walls (stone lintels and sills), party walls with the
    first-floor joists pocketed into them (the walls above bear on the joist ends), a chimney breast with an open
    flue in each house on both floors and a stack on the ridge, lath-and-plaster ceilings, a half-brick ground-floor
    spine, a stud-and-plaster upstairs partition, a straight stair up the hall, and a slate roof on rafters.
    The last house is a corner pub (`pub`). */
export function victorianTerrace(p: Placement & { count?: number; pub?: boolean; protected?: boolean }): PieceSpec[] {
  const n = p.count ?? 3, bay = 5.0, X = (n * bay) / 2, Z = 4.5, te = 0.34, tp = 0.23;
  const jb = 2.68, jt = 2.94, f1 = 3.0, eave = 5.6, g0 = 0.08, ceil = jb - 0.06;
  const brick = { mat: 'brick' as const, tint: 0xa3553f, lintel: 'stone' as const, sill: 'stone' as const, maxW: 2.5 };
  const plaster = { mat: 'plaster' as const, tint: 0xece3cf };
  const centres = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? -X + te / 2 : i === n ? X - te / 2 : -X + i * bay));
  const face = (i: number, side: -1 | 1) => {
    const c = centres[i], t = i === 0 || i === n ? te : tp;
    return c + (side * t) / 2;
  };
  const ps: PieceSpec[] = [], fur: PieceSpec[] = [];
  const pubAt = p.pub ?? true ? n - 1 : -1;
  const fronts: Opening[] = [], frontsUp: Opening[] = [], backs: Opening[] = [], backsUp: Opening[] = [];
  for (let i = 0; i < n; i++) {
    const lf = face(i, 1), rf = face(i + 1, -1);
    if (i === pubAt) fronts.push({ c: lf + 1.5, w: 2.0, y0: 0.6, h: 2.0 }, door(rf - 0.6, 1.0, 2.3));
    else fronts.push({ c: lf + 1.7, w: 1.3, y0: 0.8, h: 1.8, glass: false }, door(rf - 0.6, 0.95, 2.3));
    frontsUp.push(win(lf + 1.3, 1.0, 0.8, 1.6), win(rf - 1.4, 1.0, 0.8, 1.6));
    backs.push(win(lf + 1.5, 1.0, 1.0, 1.3), door(rf - 0.75, 0.9, 2.2));
    backsUp.push(win(lf + 1.5, 1.0, 0.9, 1.3));
  }
  for (const [s, lo, up] of [[1, fronts, frontsUp], [-1, backs, backsUp]] as const) {
    const at = s * (Z - te / 2);
    ps.push(...wallRun({ ...brick, from: -X, to: X, at, t: te, y0: 0, h: f1, out: s, openings: lo, arris: 0.06 }));
    ps.push(...wallRun({ ...brick, from: -X, to: X, at, t: te, y0: f1, h: eave - f1, out: s, openings: up, arris: 0.06 }));
  }
  // party and gable walls: a lift up to the joists, the open pocket course, and the lift above bearing on the joists
  for (let i = 0; i <= n; i++) {
    const t = i === 0 || i === n ? te : tp;
    const w = { ...brick, axis: 'z' as const, from: -Z + te, to: Z - te, at: centres[i], t, out: (i === n ? 1 : -1) as 1 | -1 };
    ps.push(...wallRun({ ...w, y0: 0, h: jb }), ...wallRun({ ...w, y0: jt, h: eave - jt }));
  }
  const zi: Range = [-Z + te, Z - te];
  for (let i = 0; i < n; i++) {
    const lf = face(i, 1), rf = face(i + 1, -1), pub = i === pubAt;
    const well = { x: [rf - 1.0, rf] as Range, z: [-1.3, 2.3] as Range };
    // ground boards (the strip along the left wall is the hearth), first floor, ceiling under it
    for (const x of splitRange(lf + 0.4, rf, 4.8)) for (const z of splitRange(zi[0], zi[1], 4.5)) ps.push(block('plywood', x, [0, g0], z, { tint: 0x9a7a58 }));
    ps.push(...joistFloor({ x: [lf, rf], z: zi, span: 'x', y: f1, depth: jt - jb, pitch: 0.6, bear: [lf - centres[i], centres[i + 1] - rf], sheet: 4.8,
      deck: { tint: 0x9a7a58 }, ceiling: { mat: 'plaster', tint: 0xf1ece2 }, well }));
    // chimney breast on the left wall, both floors: two cheeks, the breast front over the fireplace, a stone mantel
    for (const [y0, y1] of [[0, ceil], [f1, eave + 0.04]] as Range[]) {
      const bx: Range = [lf, lf + 0.4];
      ps.push(block('brick', bx, [y0, y1], [0.4, 0.62], { tint: brick.tint }), block('brick', bx, [y0, y1], [1.38, 1.6], { tint: brick.tint }));
      ps.push(block('brick', [lf + 0.28, lf + 0.4], [y0 + 1.0, y1], [0.62, 1.38], { tint: brick.tint }));
      ps.push(block('stone', [lf + 0.4, lf + 0.52], [y0 + 1.0, y0 + 1.08], [0.35, 1.65], { tint: 0xe6dcc6 }));
    }
    ps.push(...stair({ axis: 'z', from: 2.6, to: -1.3, cross: [rf - 0.95, rf], y0: g0, y1: f1, open: 'lo' }));
    if (!pub) ps.push(...wallRun({ mat: 'brick', tint: 0xe9e1cf, from: lf, to: rf - 0.9, at: -1.5, t: 0.115, y0: g0, h: ceil - g0, openings: [door(rf - 1.55, 0.8, 2.1)] }));
    ps.push(...studWall({ from: lf, to: rf - 1.0, at: -1.6, y0: f1, h: eave + 0.04 - f1, t: 0.075, pitch: 0.6, noggins: false,
      liningNeg: plaster, liningPos: plaster, openings: [door(rf - 1.6, 0.8, 2.0)] }));
    // rooms
    if (pub) {
      fur.push(...fit(bar(2.6, 3), lf + 0.6, -0.9, g0), ...fit(table(0.9, 0.9), lf + 2.0, 2.8, g0), ...fit(table(0.9, 0.9), lf + 2.9, 1.2, g0));
      for (const [x, z] of [[lf + 2.0, 3.55], [lf + 2.0, 2.05], [lf + 2.9, 0.45]]) fur.push(...fit(chair(), x, z, g0));
    } else {
      fur.push(...fit(sofa(1.8), lf + 2.0, Z - te - 0.45, g0, 2), ...fit(table(0.8, 0.6), lf + 1.8, 1.0, g0));
      fur.push(...fit(table(1.2, 0.8), lf + 1.6, -2.8, g0), ...fit(bookcase(1.2, 1.9), lf + 1.6, -Z + te + 0.16, g0));
    }
    fur.push(...fit(bed(true), lf + 1.6, 2.2, f1, 2), ...fit(bed(false), lf + 1.1, -2.8, f1), ...fit(wardrobe(1.0), rf - 1.6, Z - te - 0.3, f1, 2));
    ps.push(supplyBox([rf - 0.12, rf], [1.6, 2.2], [3.3, 3.7]), lamp([rf - 0.25, rf], [1.9, 2.2], [3.7, 3.95], LIGHT.warm));
    if (pub) ps.push(lamp([lf + 0.8, lf + 1.2], [ceil - 0.22, ceil], [-0.3, 0.1], LIGHT.warm), supplyBox([lf + 1.2, lf + 1.6], [ceil - 0.3, ceil], [-0.3, 0.1]));
  }
  ps.push(...rafterRoof({ x: [-X - 0.25, X + 0.25], gables: [[-X, -X + te], [X - te, X]], z: [-Z, Z], y: eave, rise: 2.8, pitch: 0.8,
    covering: { tint: 0x5f656e }, gableMat: 'brick', gableTint: brick.tint, ceiling: { z: [-Z + 0.15, Z - 0.15] } }));
  // stacks on the ridge over each chimney breast
  const k = 2.8 / Z, capTop = eave + 0.1 + k * (Z - 0.03) + 0.15 + 0.065 + 0.07 + 0.06;
  for (let i = 0; i < n; i++) {
    const x = face(i, 1) + 0.2;
    ps.push(block('brick', [x - 0.35, x + 0.35], [capTop, capTop + 1.1], [-0.4, 0.4], { tint: brick.tint }));
    // mortar flaunching either side of the ridge tile, so the stack beds across the slates rather than on the ridge alone
    for (const s of [1, -1]) {
      ps.push(extrude('concrete', ([[0.03, capTop - 0.06], [0.4, capTop - 0.06 - k * 0.37], [0.4, capTop], [0.03, capTop]] as [number, number][])
        .map(([z, y]) => [s * z, y] as [number, number]), 'x', [x - 0.35, x + 0.35], { tint: 0x9a9a96 }));
    }
    ps.push(block('stone', [x - 0.42, x + 0.42], [capTop + 1.1, capTop + 1.2], [-0.47, 0.47], { tint: 0xe6dcc6 }));
    for (const dz of [-0.18, 0.18]) ps.push(cyl('terracotta', 0.22, [capTop + 1.2, capTop + 1.65], x, dz, { tint: 0xd08a64 }));
  }
  // cast-iron gutters, downpipes on the party walls, and the pub's fascia and lamp
  for (const s of [-1, 1] as const) ps.push(...band({ mat: 'castiron', face: s * Z, out: s, from: -X, to: X, y: [eave - 0.14, eave], depth: 0.13, tint: 0x2f3336 }));
  for (let i = 1; i < n; i++) ps.push(...downpipe({ face: Z }, centres[i], [0, eave - 0.14]));
  if (pubAt >= 0) {
    const lf = face(pubAt, 1), rf = face(pubAt + 1, -1);
    ps.push(extrude('wood', [[Z, 2.55], [Z + 0.08, 2.55], [Z + 0.1, 2.6], [Z + 0.1, 2.86], [Z + 0.15, 2.9], [Z + 0.15, 2.95], [Z, 2.95]], 'x', [lf, rf],
      { tint: 0x2f4f3a, finish: 'paint' }));
  }
  // a canted bay on each house's front room, a segmental stone hood over each front door
  for (let i = 0; i < n; i++) {
    if (i === pubAt) continue;
    const [w, d] = fronts.slice(2 * i, 2 * i + 2);
    ps.push(...bayWindow({ face: Z }, [w.c - w.w / 2, w.c + w.w / 2], [w.y0, w.y0 + w.h], { tint: brick.tint }), ...hood({ face: Z }, [d.c - d.w / 2, d.c + d.w / 2], d.y0 + d.h));
  }
  if (p.interior !== false) ps.push(...fur);
  return put(layerize(ps, { brick: 'solid', lining: true, partitions: true, timber: true, roofs: 'slate' }), p, 'terrace', { protected: p.protected, age: { years: 130, exposure: 'outdoor' } });
}
