import type { PieceSpec } from '../../types.ts';
import { block, place, splitRange, type Range } from '../kit.ts';
import type { Placement } from './common.ts';

/* Below-grade parts of the landmarks, for a site with real ground under it. Every landmark stands on y = 0 as
   built (its footings are where its ground-bearing members meet y = 0), so these are an optional, separate
   `foundation` group laid out in the same local frame as the building and placed the same way: add them where
   the terrain has been dug out for them. Nothing here is part of the prefabs (the physics has no ground below
   y = 0 until the terrain does). */

const RC = { tint: 0x9d9a92 }, BRICK = { tint: 0x8f5a48 }, STONE = { tint: 0xa89f8c };
type Opt = { tint: number };

/** Walled box below grade: perimeter walls, base slab and a roof slab whose top is y = 0 (the building bears on it). */
function basement(mat: 'rconcrete' | 'brick' | 'stone', x: Range, z: Range, depth: number, t: number, o: Opt, roof = true): PieceSpec[] {
  const ps: PieceSpec[] = [], y: Range = [-depth, roof ? -0.3 : 0];
  ps.push(...splitRange(x[0], x[1], 6).flatMap((xr) => splitRange(z[0], z[1], 6).map((zr) => block('rconcrete', xr, [-depth - 0.4, -depth], zr, RC))));
  for (const zz of [[z[0], z[0] + t], [z[1] - t, z[1]]] as Range[]) for (const xr of splitRange(x[0], x[1], 6)) ps.push(block(mat, xr, y, zz, o));
  for (const xx of [[x[0], x[0] + t], [x[1] - t, x[1]]] as Range[]) for (const zr of splitRange(z[0] + t, z[1] - t, 6)) ps.push(block(mat, xx, y, zr, o));
  if (roof) ps.push(...splitRange(x[0], x[1], 6).flatMap((xr) => splitRange(z[0], z[1], 6).map((zr) => block('rconcrete', xr, [-0.3, 0], zr, RC))));
  return ps;
}

/** Mass-concrete pad under a column or pier. */
const pad = (x: number, z: number, w: number, d: number): PieceSpec => block('concrete', [x - w / 2, x + w / 2], [-d, 0], [z - w / 2, z + w / 2], RC);
/** Strip footing under a wall line. */
const strip = (x: Range, z: Range, d: number, o: Opt = RC): PieceSpec[] =>
  (x[1] - x[0] >= z[1] - z[0] ? splitRange(x[0], x[1], 6).map((xr) => block('concrete', xr, [-d, 0], z, o)) : splitRange(z[0], z[1], 6).map((zr) => block('concrete', x, [-d, 0], zr, o)));

const FOUNDATIONS: Record<string, () => PieceSpec[]> = {
  // brick-vaulted undercroft (left-luggage and parcels) under the booking hall; pads under the shed columns
  station: () => [
    ...basement('brick', [-20, 20], [0, 14], 4.2, 0.6, BRICK),
    ...[-18, 18].flatMap((x) => [-2, -10, -18, -26, -34, -42, -50].map((z) => pad(x, z, 2.2, 2.0))),
    ...basement('brick', [20, 25.4], [8.6, 14], 3.0, 0.6, BRICK),
  ],
  // stepped rubble strip footings under the walls and arcades, a crypt under the chancel bay, the tower's footing
  cathedral: () => cathedralFoundation(6),
  'cathedral-4': () => cathedralFoundation(4),
  // piled raft: a 2 m raft over the footprint (the piles below it are not modelled)
  highrise: () => splitRange(-15.1, 15.1, 7.6).flatMap((x) => splitRange(-15.1, 15.1, 7.6).map((z) => block('rconcrete', x, [-2.0, 0], z, RC))),
  // basement sales floor with its own columns under the ground floor
  deptstore: () => [...basement('rconcrete', [-18, 18], [-12, 12], 4.5, 0.4, RC), ...[-12, -6, 0, 6, 12].flatMap((x) => [-6, 0, 6].map((z) => block('rconcrete', [x - 0.3, x + 0.3], [-4.5, -0.3], [z - 0.3, z + 0.3], RC)))],
  // strip footings, the engine bed's mass block and the chimney's footing
  millworks: () => [
    ...strip([-15, 15], [-7, -6.44], 1.5), ...strip([-15, 15], [6.44, 7], 1.5), ...strip([-15, -14.44], [-6.44, 6.44], 1.5), ...strip([14.44, 15], [-6.44, 6.44], 1.5),
    pad(20, -1.2, 4.0, 3.0), pad(40, 0, 9.0, 4.0),
  ],
  // pier and abutment footings on caissons
  'road-bridge': () => [...[[-1.4, -0.05], [0.05, 1.4]].map((x) => block('concrete', x as Range, [-5.0, 0], [-6.8, 6.8], RC)), ...[-1, 1].map((s) => block('concrete', s > 0 ? [42.2, 44] : [-44, -42.2], [-4.0, 0], [-6.5, 6.5], RC))],
  // the holder tank is really a sunk tank: its puddled-clay floor and the lower courses below grade
  gasholder: () => [...splitRange(-21, 21, 7).flatMap((x) => splitRange(-21, 21, 7).map((z) => block('concrete', x, [-1.2, -0.8], z, RC))), ...basement('brick', [-22.6, 22.6], [-22.6, 22.6], 6.0, 1.0, BRICK, false)],
  // a strip footing under each raker line of both stands
  stadium: () => [-1, 1].flatMap((sd) => splitRange(-32, 32, 8).map((r) => r[0]).concat([32]).map((x) => block('concrete', [x - 0.6, x + 0.6], [-1.5, 0], sd < 0 ? [-55, -35] : [35, 55], RC))),
};

function cathedralFoundation(bays: number): PieceSpec[] {
  const ze = 18 - 6.5 * bays;
  return [
    ...[-11.05, 11.05].flatMap((x) => strip([x - 1.2, x + 1.2], [ze - 1.2, 19.2], 2.5, STONE)),
    ...[-5.5, 5.5].flatMap((x) => strip([x - 1.2, x + 1.2], [ze + 6.5, 19.2], 2.5, STONE)),
    ...basement('stone', [-6, 6], [ze - 1.2, ze + 6.5], 3.5, 1.0, STONE),
    ...basement('stone', [-4.5, 4.5], [19.28, 28.28], 4.0, 1.5, STONE, false),
  ];
}

/** Below-grade parts for a landmark id, placed like the building (group 'foundation'); [] when none. */
export function landmarkFoundation(id: string, p: Placement): PieceSpec[] {
  const make = FOUNDATIONS[id];
  if (!make) return [];
  return place(make(), p.x, p.z, p.rot ?? 0).map((q) => ({ ...q, group: 'foundation' }));
}
