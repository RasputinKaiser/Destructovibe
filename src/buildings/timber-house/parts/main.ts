import type { PieceSpec } from '../../../types.ts';
import { block, curtains, splitRange, type Opening, type Range } from '../../../levels/kit.ts';
import { bathroom, bed, bookcase, chair, fit, kitchen, sofa, stair, studWall, table, wardrobe, FURN, joistFloor, rafterRoof } from '../../../levels/interior.ts';
import { conduit, lamp, LIGHT, radiatorPanel, supplyBox, wallBoiler } from '../../../levels/services.ts';
import { type Placement } from '../../_shared/base.ts';
import { door, put, win } from '../../_shared/structures-helpers.ts';

/** Two-storey platform-frame house, 8.4 x 6.6 m, on a ground-bearing slab: stud walls (plates, studs at 600,
    noggins, headers, sill trimmers) clad in weatherboard outside and plasterboard inside, joisted first floor
    with a trimmed stair well, stud partitions, a cut roof (plates, ridge board, rafters, purlins, ceiling joists,
    battens, tiles), and a furnished interior: kitchen, living room, stair, bathroom and two bedrooms. */
export function timberHouse(p: Placement & { cladTint?: number; roofTint?: number }): PieceSpec[] {
  const X = 4.2, Z = 3.3, W = 0.22, g0 = 0.15, h1 = 2.5, fl = 0.26, h2 = 2.4;
  const f1 = g0 + h1 + fl, eave = f1 + h2;
  const clad = { mat: 'wood' as const, tint: p.cladTint ?? 0xdfe3dc }, board = { tint: FURN.plaster };
  const ps: PieceSpec[] = [], fur: PieceSpec[] = [];
  ps.push(...splitRange(-X, X, 4.2).flatMap((x) => splitRange(-Z, Z, 3.3).map((z) => block('concrete', x, [0, g0], z, { tint: 0xb9b9b4 }))));
  const inb = { ...board, from: -X + W, to: X - W };
  const ext = (y0: number, h: number, front: Opening[], back: Opening[], left: Opening[], right: Opening[]) => {
    for (const [s, ops] of [[1, front], [-1, back]] as const) {
      ps.push(...studWall({ from: -X, to: X, at: s * (Z - 0.11), y0, h, openings: ops,
        liningPos: s > 0 ? clad : inb, liningNeg: s > 0 ? inb : clad }));
    }
    for (const [s, ops] of [[-1, left], [1, right]] as const) {
      ps.push(...studWall({ axis: 'z', from: -Z + 0.16, to: Z - 0.16, at: s * (X - 0.11), y0, h, openings: ops,
        liningPos: s > 0 ? clad : board, liningNeg: s > 0 ? board : clad }));
    }
  };
  // ground storey; the inner linings of the front/back walls stop at the side walls' linings
  // external doors 1.0 x 2.1 m
  ext(g0, h1, [door(-1.5, 1.0, 2.1), win(1.2, 1.4), win(3.0, 0.9)], [win(-1.85, 1.0, 1.0, 1.0), door(0.9, 1.0, 2.1), win(2.8)], [win(0.5, 1.0)], []);
  // first floor: joists across the depth, bearing on the front and back top plates; trimmed well over the stair
  const well = { x: [-4.0, -3.0] as Range, z: [-1.6, 1.1] as Range };
  ps.push(...joistFloor({ x: [-X + 0.05, X - 0.05], z: [-Z + 0.05, Z - 0.05], span: 'z', y: f1, depth: 0.2, pitch: 0.45, well,
    ceiling: { x: [-X + W, X - W], z: [-Z + W, Z - W] } }));
  ext(f1, h2, [win(-2.6, 1.1), win(0, 1.1), win(2.6, 1.1)], [win(-2.2, 0.8, 1.2, 0.8), win(2.6, 1.1)], [win(0.3, 0.9)], [win(-0.8, 0.9)]);
  // partitions: ground floor splits living room from hall and kitchen; upstairs a bedroom wall and a bathroom
  const inner = (y0: number, h: number) => ({ y0, h, t: 0.075, liningNeg: board, liningPos: board, noggins: false, pitch: 0.6 });
  ps.push(...studWall({ ...inner(g0, h1 - 0.05), axis: 'z', from: -Z + W, to: Z - W, at: 0.4, openings: [door(1.4, 0.9, 2.0)] }));
  const up = eave + 0.04 - f1;
  ps.push(...studWall({ ...inner(f1, up), axis: 'z', from: -Z + W, to: Z - W, at: 0.4, openings: [door(-2.3, 0.8, 2.0)] }));
  ps.push(...studWall({ ...inner(f1, up), from: -2.95, to: 0.3025, at: 0.45, openings: [door(-1.2, 0.8, 2.0)] }));
  ps.push(...rafterRoof({ x: [-X - 0.3, X + 0.3], gables: [[-X, -X + W], [X - W, X]], z: [-Z, Z], y: eave, rise: 2.4, pitch: 0.6,
    covering: { tint: p.roofTint ?? 0x6e5a48 }, gableTint: clad.tint, ceiling: { z: [-Z + 0.15, Z - 0.15] } }));
  ps.push(...stair({ axis: 'z', from: 2.0, to: -1.6, cross: [-X + W, -3.1], y0: g0, y1: f1, open: 'hi' }));
  // ground floor: kitchen on the back wall, table, living room
  const bi = -Z + W, fi = Z - W;
  fur.push(...fit(kitchen(2.1, { wallUnits: false }), -2.95, bi, g0));
  fur.push(...fit(table(1.2, 0.8), -1.6, -0.6, g0));
  for (const z of [-1.3, 0.1]) fur.push(...fit(chair(), -1.6, z, g0));
  fur.push(...fit(sofa(2.0), 2.3, bi + 0.45, g0), ...fit(table(1.0, 0.55, { tint: FURN.oak }), 2.3, -1.0, g0));
  fur.push(...fit(bookcase(), X - W - 0.2, 0.3, g0, 3), ...fit(bookcase(), 0.72, -2.2, g0, 1));
  // services: consumer unit by the front door, a pendant in the living room, combi boiler on a kitchen radiator
  ps.push(supplyBox([2.05, 2.45], [1.5, 2.1], [fi - 0.12, fi]), ...conduit([[2.25, 2.1, fi - 0.04], [2.25, 2.56, fi - 0.04], [2.25, 2.56, 0.5]]));
  ps.push(lamp([2.05, 2.45], [2.3, 2.52], [0.3, 0.7], LIGHT.warm));
  ps.push(wallBoiler([-0.75, -0.25], [1.3, 2.0], [bi, bi + 0.3]), radiatorPanel([-0.75, 0.3], [0.5, 1.3], [bi, bi + 0.1]));
  // first floor: bathroom at the front left, double bedroom right, single bedroom back left
  fur.push(...fit(bathroom(), 0.25, fi, f1, 2));
  fur.push(...fit(bed(true), 2.6, -1.8, f1, 0), ...fit(wardrobe(1.0), X - W - 0.32, 1.8, f1, 3));
  fur.push(...fit(bed(false), -1.4, bi + 1.1, f1, 0));
  // curtains on the living-room window and the middle bedroom window, on the front wall's inner lining
  fur.push(...curtains({ face: Z - 0.22, into: -1, c: 1.3, w: 1.2, head: g0 + 2.1, drop: 1.3, fabric: 'velvet', tint: 0x5a2a36 }));
  fur.push(...curtains({ face: Z - 0.22, into: -1, c: -0.25, w: 0.8, head: f1 + 2.1, drop: 1.4, tint: 0xcfd8c0 }));
  if (p.interior !== false) ps.push(...fur);
  return put(ps, p, 'house');
}
