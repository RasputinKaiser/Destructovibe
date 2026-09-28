import type { Blueprint, PieceSpec } from '../../types.ts';
import { block, place, raise, splitRange, type Range } from '../kit.ts';
import { streetLamp } from '../services.ts';
import { dump, mill, rotunda, stoneArchBridge, timberBarn, timberFrameHouse, trussBridge, TINT } from '../structures.ts';
import { boilerHouse, millWheel } from '../plant.ts';
import { victorianTerrace } from '../buildings.ts';
import { car } from '../machines.ts';
import { LANDMARKS } from '../architecture/index.ts';
import { landmarkFoundation } from '../architecture/foundations.ts';
import { bench, bollard, boundaryWall, litterBin, phoneBox, postBox, sign, stand, stopFlag, wheelieBin } from './ground.ts';
import { TerrainPlan } from '../../terrain/plan.ts';
import { found, onFoundation } from '../../terrain/foundations.ts';
import { groundHeight } from '../../terrain/raster.ts';
import { KERB_UP } from '../../terrain/spec.ts';

/* The Heritage Yard: an open-air building museum (±44 m; x east, +z south), every period material in one yard.
     Museum Road (E-W, z 31..37) along the south, the entrance forecourt off it where the player starts, looking
     north up cobbled Museum Street (x 5.5..11) to the mill.
     Market Street (setts, z 3..9) and Chapel Lane (setts, z -15.5..-10.5) cross the site; between them the canal,
     a cutting 2 m deep between stone retaining walls (z -6..0), bridged by the stone arch footbridge and the truss
     footbridge, with the mill wheel turning in it and Museum Street carried over it on a culvert.
     north    the four-bay Gothic church on its crypt · mill · barn
     south    boiler house · Victorian terrace (back alley onto Market Street, gardens to Museum Road) · rotunda ·
              timber-frame house under scaffold */

const BED = -2.0;

export function heritageGround(): TerrainPlan {
  const t = new TerrainPlan(48, 23, 0.1);
  // setts lanes and yards at the natural ground level
  for (const [x, z] of [[[-6, 22], [39, 44]], [[5.5, 11], [-10.5, 29]], [[-44, 44], [3, 9]], [[-44, 44], [-15.5, -10.5]], [[-13, 3], [9, 12.1]], [[-15.6, -13.2], [9, 29]]] as [Range, Range][]) t.level(x, z, 0, 'setts', 1);
  // Museum Road, its footways, the crossing to the forecourt
  t.level([-48, 48], [29, 31], 0, 'paving', 1.5).level([-48, 48], [37, 39], 0, 'paving', 1.5);
  t.street('x', [31, 37], [-48, 48], { noKerb: [[6, 10.5]] });
  t.level([6, 10.5], [31, 37], 0, 'paving');
  t.ramp([4.5, 6], [31, 37], 'x', -KERB_UP, 0, 'asphalt').ramp([10.5, 12], [31, 37], 'x', 0, -KERB_UP, 'asphalt');
  t.mark('zebra', [8.25, 31.3], [8.25, 36.7], 3.9);
  for (const x of [-30, -10, 16, 36]) t.decal('grating', x, 31.25, 0.5, 0.35).decal('grating', x + 4, 36.75, 0.5, 0.35);
  t.decal('manhole', -20, 34, 0.7).decal('manhole', 24, 34, 0.7).decal('oil', -30, 32.1, 1.2, 0.8);
  // the canal cutting either side of the Museum Street culvert, its retaining walls and end walls
  for (const x of [[-42, 5.5], [11, 42]] as Range[]) {
    t.pit(x, [-5.5, -0.5], BED, 0, 'soil');
    t.block(x, [-6, -5.5], BED - 0.2, 0, 'stone').block(x, [-0.5, 0], BED - 0.2, 0, 'stone');
  }
  t.block([-42.5, -42], [-6, 0], BED - 0.2, 0, 'stone').block([5.5, 6], [-6, 0], BED - 0.2, 0, 'stone');
  t.block([10.5, 11], [-6, 0], BED - 0.2, 0, 'stone').block([42, 42.5], [-6, 0], BED - 0.2, 0, 'stone');
  t.decal('puddle', -30, -3, 3, 1.6).decal('puddle', 20, -2.5, 2.4, 1.4);
  return t;
}

/** Parapets on the canal walls, open where the arch bridge's voussoirs spring. */
function canalParapets(): PieceSpec[] {
  const ps: PieceSpec[] = [], o = { tint: 0xb9ad96, group: 'canal', anchored: true }, cope = { tint: 0xd8cdb4, group: 'canal' };
  const runs: Range[] = [[-42, -14.2], [-9.8, 5.5], [11, 42]];
  for (const [a, b] of runs) for (const u of splitRange(a, b, 13)) for (const z of [[-6, -5.6], [-0.4, 0]] as Range[]) {
    ps.push(block('stone', u, [0, 0.8], z, o), block('stone', u, [0.8, 0.92], [z[0] - 0.04, z[1] + 0.04], cope));
  }
  return ps;
}

export function heritageYard(): Blueprint {
  const plan = heritageGround();
  const base = plan.data();
  const lv = (x: number, z: number) => { const y = groundHeight(base, x, z); return Number.isFinite(y) ? y : 0; };
  const house = (ps: PieceSpec[], o: Parameters<typeof found>[2] = {}) => found(ps, plan, o).pieces;
  const church = { x: -34.55, z: -29.6, rot: 1 };
  const cathedral = LANDMARKS.find((l) => l.id === 'cathedral-4')!;
  const world: PieceSpec[] = [
    // the church on its own stepped rubble footings and crypt
    ...onFoundation(cathedral.make(church), landmarkFoundation('cathedral-4', church), plan),
    ...house(mill({ x: 4, z: -27, stock: true }), { depth: 1.0 }),
    ...house(timberBarn({ x: 29, z: -26, hay: true })),
    ...stoneArchBridge({ x: -12, z: -3, rot: 1 }),
    ...trussBridge({ x: 28, z: -3, rot: 1 }),
    ...house(boilerHouse({ x: -30, z: 19 })),
    ...house(victorianTerrace({ x: -5, z: 17 })),
    ...rotunda({ x: 18, z: 16 }),
    ...house(timberFrameHouse({ x: 32, z: 17, scaffold: true })),
    // the wheel turns in the canal bed
    ...stand(millWheel({ x: 39, z: -3 }), BED),
    ...canalParapets(),
    ...dump({ x: -8, z: -12.8, crates: [2, 2, 2], barrels: [2, 1] }),
    ...dump({ x: 13, z: 5, propane: [2, 1], tnt: 2 }),
  ];
  const furn: PieceSpec[] = [
    // Museum Road: lamps, the bus stop, the crossing's bollards, a parked car at the north kerb
    ...[-26, 26].flatMap((x) => place(streetLamp(6, 1.1), x, 29.6, 3)),
    stopFlag(-18, 37.6, 0), bench(-19.5, 38.4, 0, true, -1), bench(14, 43.2, 0, true, -1), bench(-2, 43.2, 0, true, -1),
    ...[5.6, 10.9].flatMap((x) => [bollard(x, 30.4, 0), bollard(x, 37.6, 0)]),
    litterBin(4.6, 38.5, 0), litterBin(11.9, 29.5, 0), litterBin(4.8, 8.4, 0), litterBin(-23, -11, 0),
    postBox(-7, 38.4, 0), ...phoneBox(20.8, 40, 0),
    sign(5.2, 29.4, 0, false), sign(11.3, 8.8, 0, false), sign(-13.1, 8.8, 0, false),
    // the terrace's bins in its back alley, the museum's boundary wall along the north
    ...[-10.5, -5.5, -0.5].map((x) => wheelieBin(x, 10.2, 0)),
    ...boundaryWall('x', -44, 44, -43.8, 0, 1.4, 'stone', 0xb9ad96, 22),
  ];
  const pieces = [...world, ...furn, ...raise(car({ x: -30, z: 32.1, rot: 0, tint: TINT.carTeal }), lv(-30, 32.1))];
  plan.seat(pieces);
  return { pieces, spawn: { pos: [8.25, lv(8.25, 42), 42], yaw: 0 }, terrain: plan.spec };
}
