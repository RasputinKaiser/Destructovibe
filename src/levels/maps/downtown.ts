import type { Blueprint, PieceSpec } from '../../types.ts';
import { apartmentBlock, busShelter, carPark, dump, officeBlock, stadiumStand, towerCrane, TINT } from '../structures.ts';
import { backdropTower } from '../buildings.ts';
import { bus, car, van } from '../machines.ts';
import { SiteGrid, substation } from '../grid.ts';
import { LANDMARKS } from '../architecture/index.ts';
import { landmarkFoundation } from '../architecture/foundations.ts';
import { bench, bollard, boundaryWall, litterBin, phoneBox, postBox, sign } from './ground.ts';
import { TerrainPlan } from '../../terrain/plan.ts';
import { found, onFoundation, type FoundOpts } from '../../terrain/foundations.ts';
import { groundHeight } from '../../terrain/raster.ts';
import { KERB_UP } from '../../terrain/spec.ts';
import { raise, type Range } from '../kit.ts';

/* Downtown, ±80 m (x east, +z south), closed for redevelopment. The Avenue (E-W, z 8..20, four lanes) is the main
   road; Tower Street (E-W, z -30..-22) runs behind the middle band; West, Centre and East Streets (N-S) cross both.
     north band   34-storey residential tower over its basement and piles · 14-storey tower on a piled raft with the
                  crane behind it · glass office over a basement · stadium stand
     middle band  the Art Deco department store over its basement sales floor · car park · walk-up flats over a
                  basement · scaffolded flats
     south        the raised plaza where the player starts, looking up Centre Street to the crane; the gasholder in
                  the south-west park and the district substation in the east park, its feeders under the pavements
                  to the street lights and signals */

const P = 0.6; // the plaza stands this far above the pavements, up three steps
const CH = -KERB_UP;

export function downtownGround(): TerrainPlan {
  const t = new TerrainPlan(80, 37, 0.1);
  const A = 80, side: Range[] = [[-38, -32], [0, 6], [29, 35]];
  // the blocks behind the streets are paved yards; the parks south of the Avenue grass
  t.level([-A, A], [-A, 5], 0, 'concrete', 1);
  // footways
  for (const [x, z] of [[[-A, A], [5, 8]], [[-A, A], [20, 23]], [[-A, A], [-33, -30]], [[-A, A], [-22, -19]],
    [[-40.5, -38], [-A, 5]], [[-32, -29.5], [-A, 5]], [[-2.5, 0], [-A, 5]], [[6, 8.5], [-A, 5]], [[26.5, 29], [-A, 5]], [[35, 37.5], [-A, 5]]] as [Range, Range][]) t.level(x, z, 0, 'paving', 1.5);
  // the side streets, crossed by continuous footways at Tower Street's south side and the Avenue's north side
  for (const x of side) {
    t.street('z', x, [-A, -30], { centre: false });
    t.street('z', x, [-17.5, 3.5], { centre: false });
    t.road(x, [-19, -17.5], 'z', CH, 0).ramp(x, [-19, -17.5], 'z', 0, CH, 'asphalt');
    t.road(x, [3.5, 5], 'z', CH, 0).ramp(x, [3.5, 5], 'z', CH, 0, 'asphalt');
    t.level(x, [-22, -19], 0, 'paving').level(x, [5, 8], 0, 'paving');
  }
  t.street('x', [-30, -22], [-A, A], { kerbs: [1], drops: { 1: side } });
  for (const [a, b] of [[-A, -38], [-32, 0], [6, 29], [35, A]] as Range[]) t.kerb({ axis: 'x', at: -30, from: a, to: b, side: -1, top: 0, up: KERB_UP });
  t.street('x', [8, 20], [-A, A], { noKerb: [[-12, -8], [16, 20]], drops: { [-1]: side } });
  t.mark('double', [-A + 1, 14], [A - 1, 14], 0.1).mark('dash', [-A + 1, 11], [A - 1, 11], 0.1).mark('dash', [-A + 1, 17], [A - 1, 17], 0.1);
  // raised crossings on the Avenue
  for (const x of [[-12, -8], [16, 20]] as Range[]) {
    t.level(x, [8, 20], 0, 'paving');
    t.ramp([x[0] - 1.5, x[0]], [8, 20], 'x', CH, 0, 'asphalt').ramp([x[1], x[1] + 1.5], [8, 20], 'x', 0, CH, 'asphalt');
    t.mark('zebra', [(x[0] + x[1]) / 2, 8.3], [(x[0] + x[1]) / 2, 19.7], 3.4);
  }
  for (const x of side) t.mark('stop', [x[0] + 0.3, 3.2], [x[1] - 0.3, 3.2], 0.3).mark('give', [x[0] + 0.3, -29.7], [x[1] - 0.3, -29.7], 0.2);
  t.mark('hatch', [-5, 14], [11, 14], 1.6).mark('yellow', [-A + 1, 8.25], [A - 1, 8.25], 0.1);
  // the plaza up its steps, retained along its open sides
  t.steps([-30, 30], [23, 23.9], 'z', 1, 0, P, 3, 'stone');
  t.level([-30, 30], [23.9, 50], P, 'setts');
  t.block([-30.5, -30], [23, 50.5], -0.3, P, 'stone').block([30, 30.5], [23, 50.5], -0.3, P, 'stone').block([-30.5, 30.5], [50, 50.5], -0.3, P, 'stone');
  // drainage and wear
  for (let x = -70; x <= 70; x += 14) t.decal('grating', x, 8.25, 0.5, 0.35).decal('grating', x + 7, 19.75, 0.5, 0.35);
  for (const [x, z] of [[-40, 14], [10, 12], [50, 14], [-10, -26], [20, -26], [3, -40]]) t.decal('manhole', x, z, 0.7);
  for (const [x, z, w] of [[-50, 9.1, 1.2], [-26, 9.1, 1.1], [46, 9.1, 1.3], [45, 18.9, 1.2], [-32, 18.3, 2.2]]) t.decal('oil', x, z, w, w * 0.6);
  for (const [x, z] of [[-60, 12], [30, 16], [3, -10], [-20, -26]]) t.decal('patch', x, z, 2.4, 1.4);
  for (const [x, z] of [[-70, 14.2], [62, 13.8], [3, -50]]) t.decal('puddle', x, z, 1.8, 1.1);
  return t;
}

/** A glazed ground floor given its entrance: the pane on the face at z `face` is split round a 2.4 m doorway at x. */
function entrance(ps: PieceSpec[], x: number, face: number): PieceSpec[] {
  return ps.flatMap((p) => {
    const lo = p.pos[1] - p.size[1] / 2, z1 = p.pos[2] + p.size[2] / 2, x0 = p.pos[0] - p.size[0] / 2, x1 = p.pos[0] + p.size[0] / 2;
    if (p.mat !== 'tempered' || Math.abs(lo) > 0.01 || Math.abs(z1 - face) > 0.01 || x0 > x - 1.2 || x1 < x + 1.2) return [p];
    return [[x0, x - 1.2], [x + 1.2, x1]].map(([a, b]) => ({ ...p, size: [b - a, p.size[1], p.size[2]], pos: [(a + b) / 2, p.pos[1], p.pos[2]] }));
  });
}

export function downtown(): Blueprint {
  const plan = downtownGround();
  const base = plan.data();
  const lv = (x: number, z: number) => { const y = groundHeight(base, x, z); return Number.isFinite(y) ? y : 0; };
  const g = new SiteGrid();
  g.ground = lv;
  g.bound = 79.5;
  const house = (ps: PieceSpec[], o: FoundOpts = {}) => found(ps, plan, o).pieces;
  const lm = (id: string) => LANDMARKS.find((l) => l.id === id)!;
  const tower = { x: -60, z: -55 }, store = { x: -59, z: -7 }, holder = { x: -55, z: 47.5 };
  const world: PieceSpec[] = [
    ...house(lm('highrise').make(tower), { basement: { depth: 3.5 }, piles: true }),
    ...house(entrance(backdropTower({ x: -15, z: -52, storeys: 14, group: 'skyscraper2' }), -15, -42), { type: 'raft', piles: true }),
    ...house(towerCrane({ x: -2, z: -73 }), { type: 'raft' }),
    ...house(officeBlock({ x: 18, z: -52, storeys: 5 }), { basement: { depth: 3.2 } }),
    ...house(stadiumStand({ x: 56, z: -38 })),
    ...house(lm('deptstore').make(store), { basement: { depth: 4.5 } }),
    ...house(carPark({ x: -15, z: -5, cars: 2 })),
    ...house(apartmentBlock({ x: 16, z: -5 }), { basement: { depth: 2.8 } }),
    ...house(apartmentBlock({ x: 54, z: -5, storeys: 3, scaffold: true, group: 'flats2' })),
    ...onFoundation(lm('gasholder').make(holder), landmarkFoundation('gasholder', holder), plan),
    ...dump({ x: -65, z: -76, barrels: [2, 2], propane: [2, 1] }),
    ...dump({ x: 40, z: -14, barrels: [3, 1], tnt: 2 }),
    ...dump({ x: -30, z: -69, propane: [2, 1], tnt: 2 }),
    // the district substation in the east park, its switchboard facing the Avenue
    ...substation({ x: 55, z: 33, rot: 2 }),
  ];

  /* feeders: under the south pavement, across the Avenue and back under the north pavement, and up Centre Street */
  g.main('power', [[54.6, 29.55 - 0.07], [54.6, 22.7], [-70, 22.7]], { group: 'feeder', rise: 0.4 });
  g.main('power', [[40, 22.7 - 0.07], [40, 5.3], [-70, 5.3]], { group: 'feeder' });
  g.main('power', [[8.2, 5.3 - 0.07], [8.2, -60]], { group: 'feeder' });
  for (const x of [-60, -40, -20, 20, 44]) g.streetLight(x, 22.7, 'x', -1, -1, 7);
  for (const x of [-48, -20, 20, 37]) g.streetLight(x, 5.3, 'x', 1, 1, 7);
  for (const z of [-12, -40]) g.streetLight(8.2, z, 'z', -1, -1, 7);
  // signals at the Centre Street junction
  g.signal(12, 5.3, 'x', 1, [1, 0]);
  g.signal(-5, 22.7, 'x', -1, [-1, 0], true);
  g.signal(8.2, -1.5, 'z', -1, [0, -1]);
  for (const v of g.valveAt) plan.decal(v.kind === 'gas' ? 'gasvalve' : 'valve', v.x, v.z, 0.4);

  const plaza = P;
  const furn: PieceSpec[] = [
    ...[-12.4, -7.6, 15.6, 20.4].flatMap((x) => [bollard(x, 7.6, 0), bollard(x, 20.4, 0)]),
    ...busShelter({ x: -24, z: 21.6 }), ...busShelter({ x: 26, z: 21.6 }),
    litterBin(-3, 21, 0), litterBin(9, 6.5, 0), litterBin(-36, -20, 0), litterBin(38, 6, 0),
    postBox(-1.5, 6.2, 0), ...phoneBox(37, 21.6, 0),
    sign(-0.3, 4.6, 0, false), sign(-32.3, 4.6, 0, false), sign(29.3, 4.6, 0, false),
    // the plaza: benches round it, bins, and a low wall along its open sides
    ...[-20, -8, 14, 26].map((x) => bench(x, 30, plaza, true, -1)), ...[-20, 26].map((x) => bench(x, 44, plaza, true, 1)),
    litterBin(-14, 29, plaza), litterBin(20, 29, plaza),
    ...boundaryWall('z', 23.9, 50, -29.8, plaza, 0.5, 'stone', 0xb9b3a6, 13), ...boundaryWall('z', 23.9, 50, 29.8, plaza, 0.5, 'stone', 0xb9b3a6, 13),
    ...boundaryWall('x', -29.6, 29.6, 49.8, plaza, 0.5, 'stone', 0xb9b3a6, 15),
  ];
  // parked along the Avenue's kerbs, a coach at the stop
  const cars = [
    car({ x: -50, z: 9.1 }), car({ x: -26, z: 9.1, tint: TINT.carTeal }), car({ x: 46, z: 9.1, tint: TINT.vanWhite }),
    car({ x: 45, z: 18.9, rot: 2 }), van({ x: 2, z: 18.4, rot: 2 }), bus({ x: -32, z: 18.3, rot: 2 }),
  ].flatMap((c) => { const q = c.find((p) => p.vehicle) ?? c[0]; return raise(c, lv(q.pos[0], q.pos[2])); });
  const pieces = [...world, ...g.ps, ...furn, ...cars];
  for (const p of pieces) delete p.protected;
  plan.seat(pieces);
  return { pieces, spawn: { pos: [3, plaza, 42], yaw: 0 }, terrain: plan.spec };
}
