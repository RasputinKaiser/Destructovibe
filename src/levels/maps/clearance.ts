import type { Blueprint, PieceSpec, UtilityKind } from '../../types.ts';
import { airDome, block, dunnageBag, place, raise, sandbags, splitRange, stockpile, tag, type Range } from '../kit.ts';
import { route, SVC } from '../services.ts';
import { chipShop, cottageRow, dump, rotunda, stoneArchBridge, towerCrane, TINT, type Placement } from '../structures.ts';
import { boilerHouse } from '../plant.ts';
import * as M from '../machines.ts';
import * as EL from '../electrical.ts';
import { MAIN, SiteGrid, checkGrid, depthOf, intakes, kindOf, networks, pumpHall, substation, unsource } from '../grid.ts';
import { barrier, bench, bollard, cone, fence, heras, litterBin, marker, palisade, phoneBox, postBox, sign, stand, stopFlag, wheelieBin } from './ground.ts';
import { TerrainPlan } from '../../terrain/plan.ts';
import { found, onFoundation, type FoundOpts } from '../../terrain/foundations.ts';
import { groundFn, groundHeight } from '../../terrain/raster.ts';
import { DPC, KERB_UP } from '../../terrain/spec.ts';
import { highStreetUnit } from '../../buildings/high-street-unit/parts/main.ts';
import { semiPair } from '../../buildings/semi-pair/parts/main.ts';
import { chapelLite } from '../../buildings/chapel-lite/parts/main.ts';
import { siteCabin } from '../../buildings/site-cabin/parts/main.ts';
import { portalShed } from '../../buildings/portal-shed/parts/main.ts';
import { worksHall } from '../../buildings/works-hall/parts/main.ts';
import { merchantShed } from '../../buildings/merchant-shed/parts/main.ts';
import { frameUnderConstruction } from '../../buildings/frame-under-construction/parts/main.ts';
import { put } from '../../buildings/_shared/clearance-helpers.ts';
import { assemble } from '../../buildings/assemble.ts';
import boilerChimney from '../../buildings/boiler-chimney/def.ts';
import { foundationLocal as chimneyFoundation } from '../../buildings/boiler-chimney/lib.ts';

/* Clearance Zone: an urban-edge district condemned whole, inside the site fence (±64 m; x east, +z south).
     Streets   High Street (E-W, z 2.5..9.5), the main road, with a raised crossing by the chip shop and signals at
               the Works Road junction · Mill Lane (N-S, x -25.5..-18.5) from the site gate · Works Road (N-S,
               x 23..29) into the yards · Terrace Row (E-W, z 35..41), with a back alley behind the houses.
     North of High Street, east to west: the utility compound and the heritage quarter (chapel, drained canal cut
               under a stone arch bridge, rotunda) west of Mill Lane; the high street shops and pub, with the
               construction site behind them (hoarded on three sides); the works yard past Works Road, its
               boiler house and brick chimney at the east end with a felling lane down the yard.
     South of High Street: the car park, a green with a cut-through path and the builders' merchant; Terrace Row
               houses behind walled front gardens, then cleared plots down to their slabs; open demolition ground
               in the south-west by the Mill Lane entrance, where the player starts.
   Every street verge carries the mains, plot side to kerb: gas, water, power (see V below), buried at their real
   cover under the footways and verges (grid.ts). The ground is terrain (terrain/*): carriageways carved a kerb below
   the footways, the canal a stone-walled cut, the construction site an open excavation; buildings stand on their
   foundations a damp course above it (terrain/foundations.ts). */

/* verge offsets from the pavement edge, outward */
const V = { power: 0.3, water: 1.0, gas: 1.65 };
const HSN = 0.35, HSS = 11.65, MLW = -27.65, MLE = -16.35, TRS = 43.15;
const at = { hsN: (k: keyof typeof V) => HSN - V[k], mlW: (k: keyof typeof V) => MLW - V[k], mlE: (k: keyof typeof V) => MLE + V[k], trS: (k: keyof typeof V) => TRS + V[k] };
/** the boiler-house chimney (square to the blast grid, flue toward +x) and its boiler house, whose west wall the flue
    meets `wall` metres east of the chimney's axis */
const STACK = { x: 52, z: -10, wall: 4 }, BH = { x: STACK.x + STACK.wall + 3.5, z: STACK.z };

/* ---------------- local buildings (stockpiles only; the buildings are packages under src/buildings) ---------------- */

/** Stockpiles: brick pallets, a steel beam stack and block pallets, all loose. */
function stockpiles(p: Placement): PieceSpec[] {
  const ps: PieceSpec[] = [];
  for (const [x, z, tint] of [[0, 0, 0xa0654e], [1.3, 0, 0xa0654e], [0, 1.4, 0xc8c6bd]] as [number, number, number][]) {
    ps.push(block('wood', [x - 0.55, x + 0.55], [0, 0.14], [z - 0.55, z + 0.55], { tint: 0x9b7a50, noWeld: true }));
    ps.push(block(tint === 0xc8c6bd ? 'cinderblock' : 'brick', [x - 0.5, x + 0.5], [0.14, 0.94], [z - 0.5, z + 0.5], { tint, noWeld: true }));
  }
  for (let i = 0; i < 3; i++) ps.push(block('steel', [3.0, 9.0], [0.1 + i * 0.3, 0.4 + i * 0.3], [-0.5, -0.1], { tint: 0x7d5a45, noWeld: true }));
  ps.push(block('wood', [3.4, 3.6], [0, 0.1], [-0.8, 0.8], { tint: 0x9b7a50, noWeld: true }), block('wood', [8.4, 8.6], [0, 0.1], [-0.8, 0.8], { tint: 0x9b7a50, noWeld: true }));
  // loose aggregate and a sandbag wall beside the brick pallets
  ps.push(stockpile('sand', [-4.2, -2.4], [-1.2, 0.6], 0.8), stockpile('gravel', [-4.2, -2.4], [1.2, 3.0], 0.8));
  ps.push(...sandbags(-1.6, -2.2, 0, 4, 2));
  // an air-supported cover over the sand and gravel, its blower at the west end
  ps.push(airDome([-4.6, -2.0], [-1.6, 3.4], 0, 1.8, [-5.2, 0.9], { tint: 0xdfe4d8 }));
  return put(ps, p, 'stock');
}

/** Drained canal cut along Z: a cutting in the ground with stone retaining walls (static), a stone parapet with coping
    on them, opened where the bridge's abutments stand. */
function canalCut(plan: TerrainPlan, x: number, z: Range, gaps: Range[], w = 6): PieceSpec[] {
  const bed = -2.2, ps: PieceSpec[] = [], stone = { tint: 0xb9ad96 }, cope = { tint: 0xd8cdb4 };
  plan.pit([x - w / 2, x + w / 2], z, bed, 0, 'soil');
  const runs: Range[] = [];
  let z0 = z[0];
  for (const g of [...gaps].sort((a, b) => a[0] - b[0])) { runs.push([z0, g[0]]); z0 = g[1]; }
  runs.push([z0, z[1]]);
  for (const s of [-1, 1]) {
    const xr: Range = s < 0 ? [x - w / 2 - 0.5, x - w / 2] : [x + w / 2, x + w / 2 + 0.5];
    plan.block(xr, [z[0] - 0.5, z[1] + 0.5], bed - 0.2, 0, 'stone');
    for (const r of runs) for (const zr of splitRange(r[0], r[1], 14)) {
      ps.push(block('stone', xr, [0, 0.9], zr, { ...stone, anchored: true }), block('stone', [xr[0] - 0.05, xr[1] + 0.05], [0.9, 1.05], zr, cope));
    }
  }
  for (const zz of [[z[0] - 0.5, z[0]], [z[1], z[1] + 0.5]] as Range[]) plan.block([x - w / 2, x + w / 2], zz, bed - 0.2, 0, 'stone');
  return tag(ps, { group: 'canal' });
}

/** Rubble heaps from earlier clearance: loose masonry lumps. */
function rubble(x: number, z: number, seed: number): PieceSpec[] {
  const ps: PieceSpec[] = [];
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 6; i++) {
    const sx = 0.6 + rnd() * 0.9, sy = 0.35 + rnd() * 0.4, sz = 0.6 + rnd() * 0.9;
    const px = x + (rnd() - 0.5) * 3.2, pz = z + (rnd() - 0.5) * 3.2;
    ps.push(block(i % 2 ? 'brick' : 'concrete', [px - sx / 2, px + sx / 2], [0, sy], [pz - sz / 2, pz + sz / 2], { tint: i % 2 ? 0x9c6a58 : 0xa9a79f, noWeld: true }));
  }
  // drop any lump that lands in another
  return tag(ps.filter((q, i) => ps.slice(0, i).every((o) => Math.abs(o.pos[0] - q.pos[0]) > (o.size[0] + q.size[0]) / 2 + 0.02 || Math.abs(o.pos[2] - q.pos[2]) > (o.size[2] + q.size[2]) / 2 + 0.02)), { group: 'rubble' });
}

/* ---------------- ground ---------------- */

const CH = -KERB_UP;

/** A raised crossing: the carriageway brought up to footway level over `x`/`z`, ramped 1.5 m either side along the
    road, a zebra across it and its kerbs flush. */
function table(plan: TerrainPlan, axis: 'x' | 'z', along: Range, across: Range): void {
  const x: Range = axis === 'x' ? along : across, z: Range = axis === 'x' ? across : along;
  plan.level(x, z, 0, 'paving');
  const lo: Range = [along[0] - 1.5, along[0]], hi: Range = [along[1], along[1] + 1.5];
  plan.ramp(axis === 'x' ? lo : across, axis === 'x' ? across : lo, axis, CH, 0, 'asphalt');
  plan.ramp(axis === 'x' ? hi : across, axis === 'x' ? across : hi, axis, 0, CH, 'asphalt');
  const c = (along[0] + along[1]) / 2;
  plan.mark('zebra', axis === 'x' ? [c, across[0] + 0.3] : [across[0] + 0.3, c], axis === 'x' ? [c, across[1] - 0.3] : [across[1] - 0.3, c], along[1] - along[0] - 0.6);
}

/** The streets, footways, yards and green of the quarter (the plots are laid by the buildings' foundations). */
export function clearanceGround(): TerrainPlan {
  const t = new TerrainPlan(64, 11, 0.12);
  const A = 64;
  // yards, setts and gravel at the natural ground level; the verges keep their gentle roll
  t.level([-64, -27.65], [-64, -28], 0, 'concrete', 1.5).level([-64, -44], [-16, -2], 0, 'setts', 1)
    .level([-64, -27.65], [34, 64], 0, 'gravel', 2).level([-16.35, 20.85], [-64, -15.5], 0, 'gravel', 1)
    .level([-16.35, 20.85], [-15.5, -2.6], 0, 'concrete').level([31.15, 64], [-64, -1.6], 0, 'concrete')
    .fall([-14, 12], [14.5, 30], 0.06, 'z', -0.06, 'asphalt').level([33, 64], [11.65, 32.85], 0, 'concrete', 1)
    .level([-16.35, 44], [59.6, 62.4], 0, 'setts', 1);
  // footways (paving) along every street
  for (const [x, z] of [[[-27.65, -25.5], [-A, A]], [[-18.5, -16.35], [-A, A]], [[-16.35, 20.85], [-2.6, 2.5]], [[20.85, A], [0.35, 2.5]], [[-16.35, A], [9.5, 11.65]],
    [[20.85, 23], [-A, 0.35]], [[29, 31.15], [-A, 0.35]], [[-16.35, A], [32.85, 35]], [[-16.35, A], [41, 43.15]]] as [Range, Range][]) t.level(x, z, 0, 'paving', 1.5);
  // carriageways, their kerbs and the junction mouths
  t.street('z', [-25.5, -18.5], [-A, A], { noKerb: [[21, 24]], kerbs: [-1] });
  for (const [a, b] of [[-A, 2.5], [9.5, 21], [24, 35], [41, A]] as Range[]) t.kerb({ axis: 'z', at: -18.5, from: a, to: b, side: 1, top: 0, up: KERB_UP });
  t.street('x', [2.5, 9.5], [-18.5, A], { noKerb: [[-2, 1]], drops: { [-1]: [[23, 29]] } });
  t.street('z', [23, 29], [-A, -0.85]);
  t.ramp([23, 29], [-0.85, 0.35], 'z', CH, 0, 'asphalt');
  t.level([23, 29], [0.35, 2.5], 0, 'paving');
  t.street('x', [35, 41], [-18.5, A], { noKerb: [[5, 8]] });
  table(t, 'x', [-2, 1], [2.5, 9.5]);
  table(t, 'x', [5, 8], [35, 41]);
  table(t, 'z', [21, 24], [-25.5, -18.5]);
  // stop lines at the Works Road junction, give-way at the side streets, parking bays by the merchant
  t.mark('stop', [23.3, 0.2], [28.7, 0.2], 0.3).mark('give', [-18.8, 2.8], [-18.8, 9.2], 0.2).mark('give', [-18.8, 35.3], [-18.8, 40.7], 0.2);
  t.mark('hatch', [23, 6], [29, 6], 1.2);
  for (let x = -12; x <= 10; x += 2.5) t.mark('bay', [x, 14.8], [x, 19.8], 0.1);
  // the construction site's open excavation, battered back 1:1, and the soil it came out of
  t.pit([-1, 4], [-60, -55], -1.8, 1, 'soil');
  t.mat([-16.35, 20.85], [-64, -61], 'soil');
  // drainage: gullies at the kerbs, manholes over the sewer in the carriageways, patches and oil where cars park
  for (const x of [-14, -4, 6, 16, 26, 36, 46, 56]) t.decal('grating', x, 2.75, 0.5, 0.35).decal('grating', x + 3, 9.25, 0.5, 0.35);
  for (const z of [-50, -30, -10, 16, 50]) t.decal('grating', -25.25, z, 0.35, 0.5).decal('grating', -18.75, z + 4, 0.35, 0.5);
  for (const [x, z] of [[12, 6], [40, 5], [-22, -20], [-22, 40], [20, 38]]) t.decal('manhole', x, z, 0.7);
  for (const [x, z, w] of [[-9, 18, 1.4], [6, 26, 1.2], [0, 26, 1.0], [38, 8.3, 1.1], [45, 16, 1.6]]) t.decal('oil', x, z, w, w * 0.7);
  for (const [x, z] of [[30, 6], [-22, 12], [48, 38], [-3, 5]]) t.decal('patch', x, z, 1.8, 1.2);
  return t;
}

/* ---------------- the map ---------------- */

const GRID_GROUPS = new Set(['substation', 'governor', 'pumping', 'boilerhouse', 'generator', 'lighttower', 'office']);
export const gridSource = (p: PieceSpec) => GRID_GROUPS.has(p.group ?? '') || p.fixture === 'boiler';

export function clearanceZone(): Blueprint {
  const plan = clearanceGround();
  const streets = plan.data();
  const lv = (x: number, z: number) => { const y = groundHeight(streets, x, z); return Number.isFinite(y) ? y : 0; };
  const g = new SiteGrid();
  g.ground = lv;
  const world: PieceSpec[] = [];
  const add = (...lists: PieceSpec[][]) => { for (const l of lists) world.push(...l); };
  const house = (ps: PieceSpec[], o: FoundOpts = {}) => found(ps, plan, o).pieces;
  const fail: string[] = [];

  /* utility compound: the plant stands on its own bases at grade; the pump hall is a building */
  const pumps = house(pumpHall({ x: -56, z: -36, mainY: depthOf('water') - DPC }));
  const sewage = M.sewageStation({ x: -56, z: -22, feed: 'grid' });
  world.push(...pumps, ...sewage);
  add(substation({ x: -46, z: -52 }), M.gasGovernor({ x: -34, z: -52 }));

  /* ---- mains, each at its own cover ---- */
  const bay = -52 + 3.0 + 0.45; // switchboard feeder face
  g.main('water', [[-50, -36], [at.mlW('water'), -36], [at.mlW('water'), at.hsN('water')], [60, at.hsN('water')]],
    { valves: [[-40, -36], [at.mlW('water'), -20], [0, at.hsN('water')], [40, at.hsN('water')]], group: 'watermain' });
  g.main('water', [[at.mlE('water'), at.hsN('water') + 0.12], [at.mlE('water'), at.trS('water')], [58, at.trS('water')]], { valves: [[20, at.trS('water')]], group: 'watermain' });
  // the feeders come down out of the switchboard's front ways into the ground
  g.main('power', [[-45.6, bay + MAIN.power.d / 2], [-45.6, -44], [at.mlW('power'), -44], [at.mlW('power'), at.hsN('power')],
    [31.45, at.hsN('power')], [31.45, -60]], { group: 'feeder', rise: 0.4 });
  g.main('power', [[at.mlE('power'), at.hsN('power') + 0.07], [at.mlE('power'), at.trS('power')], [60, at.trS('power')]], { group: 'feeder' });
  g.main('power', [[at.mlE('power') + 0.07, HSS + V.power], [60, HSS + V.power]], { group: 'feeder' });
  // the governor's outlet turns down into the ground
  g.main('gas', [[-32.2, -48.8 + MAIN.gas.d / 2], [-32.2, -40], [at.mlW('gas'), -40], [at.mlW('gas'), at.hsN('gas')], [60, at.hsN('gas')]],
    { valves: [[at.mlW('gas'), -30], [-8, at.hsN('gas')], [36, at.hsN('gas')]], group: 'gasmain', rise: 0.2 });
  g.main('gas', [[at.mlE('gas'), at.hsN('gas') + 0.09], [at.mlE('gas'), at.trS('gas')], [55, at.trS('gas')]], { valves: [[10, at.trS('gas')]], group: 'gasmain' });

  /* ---- overhead lines, each fed up its first pole ---- */
  const lineA = g.poleLine([[-12, 13.3], [0, 13.3], [12, 13.3]], { street: -1, lamps: true, group: 'line-highst', stays: [[-13.5, 13.3], [13.5, 13.3]] });
  const lineB = g.poleLine([[-12, 45.4], [2, 45.4], [16, 45.4], [30, 45.4]], { street: -1, lamps: true, group: 'line-terrace', stays: [[-13.5, 45.4], [31.5, 45.4]] });
  const lineC = g.poleLine([[-31, -14], [-46, -14]], { street: 1, lamps: true, group: 'line-chapel', stays: [[-30.2, -15], [-48, -14]] });
  g.main('power', [[lineA.feet[0][0], HSS + V.power + 0.07], [lineA.feet[0][0], 13.3 - 0.04]], { group: 'feeder' });
  g.main('power', [[lineB.feet[0][0], at.trS('power') + 0.07], [lineB.feet[0][0], 45.4 - 0.04]], { group: 'feeder' });
  g.main('power', [[at.mlW('power') - 0.07, -14], [lineC.feet[0][0] + 0.04, -14]], { group: 'feeder' });
  // works hall floor feeder, in under the west door
  g.main('power', [[31.45 + 0.07, -45], [58, -45]], { group: 'feeder' });
  // district steam main under the works hall floor, up to its heaters and out under the roller door
  g.main('steam', [[37.5, -34.4], [52, -34.4], [52, -28]], { group: 'steammain' });

  /* street lights, signals and hydrants on the mains */
  for (const z of [16, 28]) g.streetLight(at.mlE('power'), z, 'z', 1, -1);
  for (const z of [-34, -8]) g.streetLight(at.mlW('power'), z, 'z', -1, 1);
  for (const x of [-4, 14]) g.streetLight(x, at.hsN('power'), 'x', -1, 1);
  for (const z of [-38, -54]) g.streetLight(31.45, z, 'z', 1, -1);
  for (const x of [26, 52]) g.streetLight(x, HSS + V.power, 'x', 1, -1);
  // the Works Road junction: a signal on each High Street approach and one facing out of Works Road
  g.signal(20, HSS + V.power, 'x', -1, [-1, 0]);
  g.signal(31.45, -2.0, 'z', 1, [1, 0], true);
  g.signal(31.45, -4.0, 'z', 1, [0, -1]);
  for (const x of [-6, 18, 50]) g.hydrant(x, at.hsN('water'), 'x', 1);
  for (const x of [4, 36]) g.hydrant(x, at.trS('water'), 'x', -1);
  g.hydrant(at.mlW('water'), -12, 'z', 1);

  /* ---- buildings on their foundations (the pub over its cellar) ---- */
  type B = { ps: PieceSpec[]; power?: 'drop' | 'ground'; gas?: boolean; steam?: boolean; water?: boolean; name: string };
  const buildings: B[] = [];
  const bld = (name: string, ps: PieceSpec[], power: 'drop' | 'ground' | undefined, gas = false, steam = false, water = false, o: FoundOpts = {}) =>
    buildings.push({ ps: unsource(house(ps, o), [...(power ? ['power'] : []), ...(gas ? ['gas'] : []), ...(water ? ['water'] : [])] as UtilityKind[]), power, gas, steam, water, name });
  bld('pub', highStreetUnit({ x: -9.5, z: -8.1, X: 4.5, Z: 5.5, pub: true, tint: 0x7c4a3a, fascia: 0x3a2418, group: 'pub' }), 'drop', true, false, false, { basement: { depth: 2.6 } });
  bld('chipshop', chipShop({ x: 0, z: -6.4, interior: false }), 'drop', true);
  bld('shop-a', highStreetUnit({ x: 7.2, z: -6.6, tint: 0xa98474, fascia: 0x2f4f7f, group: 'shop-a' }), 'drop', true);
  bld('terrace', cottageRow({ x: -6, z: 50.8, rot: 2, group: 'terrace' }), 'drop');
  bld('cottages', cottageRow({ x: 10.5, z: 50.8, rot: 2 }), 'drop');
  bld('semis', semiPair({ x: 28, z: 51.4, rot: 2 }), 'drop', true, false, true);
  bld('chapel', chapelLite({ x: -53, z: -8 }), 'drop', false, false, false, { depth: 1.0 });
  // the boiler house at the east end of the works yard; the brick chimney is its flue, so the guyed steel stack the
  // plant kit stands on its end wall (and the stack's guys) is left out. It is the next job on the demolition
  // programme, so its power and gas services have already been cut back to the mains and capped: its transformer and
  // gas intake are dead ends (no tail runs to them), and a felling that wrecks the house cannot draw a fault or a leak
  const bhps = unsource(house(place(boilerHouse({ x: 0, z: 0 }).filter((q) => q.pos[0] < 5.12 && Math.abs(q.pos[2]) < 4.2), BH.x, BH.z, 1)), ['power', 'gas']);
  for (const q of bhps) if (q.fixture === 'lamp') delete q.fixture;
  buildings.push({ ps: bhps, gas: false, steam: true, water: false, name: 'boilerhouse' });
  // its brick chimney west of it on a mass-concrete pad, the flue duct running to the boiler house's west wall between
  // its windows; felled west along z -10 it comes down the length of the works yard (the felling lane, kept clear of
  // plant) and its top lands on Works Road: ~36 m of open ground for a ~34 m pile
  add(onFoundation(assemble(boilerChimney, STACK), place(chimneyFoundation(STACK.wall), STACK.x, STACK.z), plan));
  bld('merchant', merchantShed({ x: 47, z: 24 }), 'ground');
  add(rotunda({ x: -54, z: 22 }), stoneArchBridge({ x: -40, z: 12 }).filter((q) => !kindOf(q)));
  world.push(...canalCut(plan, -40, [-24, 32], [[9.2, 14.8]]));
  add(house(worksHall({ x: 48, z: -40 })), house(put(portalShed({ x: 0, z: 0, X: 7, Z: 4, H: 5.5, bays: 2, tint: 0x6f8fae, west: [[0, 1.2, 2.3]], front: [[3, 3.5, 4]] }), { x: 48, z: -54 }, 'pressshop')));
  // machines in the halls stand on their floors, the yard plant on the ground
  const hallKit = [M.conveyorLine({ x: 36.5, z: -41.5, len: 5, feed: 'grid' }), M.robotArm({ x: 45, z: -41.2, feed: 'grid' }), M.cncGantry({ x: 54.5, z: -39.2, rot: 1, feed: 'grid' }),
    M.pressLine({ x: 48, z: -54, presses: 3, feed: 'grid', group: 'pressline' })].map((m) => stand(m, DPC));
  // the yard plant stands north of the chimney's felling lane (z -10), where a fall drifting off line cannot reach it
  const yard = [
    M.rotaryKiln({ x: 58.5, z: -22, rot: 1, feed: 'grid' }),
    M.bucketElevator({ x: 54.5, z: -20, feed: 'grid' }),
    M.coolingTowerFans({ x: 51, z: -21, cells: 1, feed: 'grid' }),
    M.fanBank({ x: 44.5, z: -20.5, feed: 'grid' }),
    M.ventStack({ x: 60.5, z: -29.5, feed: 'grid' }),
    // the builders' merchant's scrap corner: a grid-fed magnet crane working a scrap heap by the pavement
    EL.magnetCrane({ x: 59.5, z: 18.2, rot: 1, feed: 'grid', slew: 0.55 }),
    [...EL.scrapPile(57.4, 12.9), ...EL.scrapPile(61.4, 12.6)],
  ];
  for (const m of [...hallKit, ...yard]) world.push(...m);
  for (const b of buildings) world.push(...b.ps);

  // steam off-take from the boiler house header, turned along the north end wall (points in the house's frame)
  const sy = DPC + 3.6, bh = ([lx, lz]: [number, number]): [number, number, number] => [BH.x + lz, sy, BH.z - lx];
  const steamStub = route('steel', [bh([4.35, -0.4]), bh([4.35, -1.5]), bh([4.7, -1.5])], 0.14, { tint: SVC.steam, util: 'steam', group: 'boilerhouse' }, { round: true, elbow: 0.18 });
  buildings.find((b) => b.name === 'boilerhouse')!.ps.push(...steamStub);
  world.push(...steamStub);
  const swap = (b: B, ps: PieceSpec[]) => {
    const old = new Set(b.ps);
    const keep = world.filter((q) => !old.has(q));
    world.length = 0;
    world.push(...keep, ...ps);
    b.ps = ps;
  };
  const others = (b: B) => { const own = new Set(b.ps); return world.filter((q) => !own.has(q)); };
  // deepest first: a tail's riser drops through the shallower mains' depths, so the shallower tails route round it
  for (const kind of ['steam', 'water', 'gas', 'power'] as UtilityKind[]) for (const b of buildings) {
    if (!({ power: !!b.power, gas: b.gas, steam: b.steam, water: b.water })[kind]) continue;
    {
      /* a building whose gas pipework has no meter inside leaves it low for a meter box outside */
      const outside = kind === 'gas' && !b.ps.some((q) => intakes.has(q) && kindOf(q) === 'gas');
      const nets = kind === 'steam' ? [steamStub] : networks(b.ps, kind).filter((n) => n.some((q) => intakes.has(q)) || outside);
      for (const net of nets) {
        const meter = outside;
        const low = meter ? net.reduce((a, q) => (q.pos[1] < a.pos[1] ? q : a)) : null;
        const head = (kind === 'power' && b.power === 'drop') || meter;
        const e = g.entry(b.ps, kind, { members: net, head, prefer: (q) => intakes.has(q) || q === low || (kind === 'steam' && q.pos[1] > DPC + 3) });
        // a meter box already standing at the foot of an outside wall takes its service pipe straight from the main
        const box = !e && kind === 'gas' ? net.find((q) => intakes.has(q) && q.pos[1] - q.size[1] / 2 < DPC + 0.05) : undefined;
        if (box) { if (!g.feed(box, 'gas', world)) fail.push(`${b.name}: gas meter box unroutable (${g.why})`); continue; }
        if (!e) { fail.push(`${b.name}: no ${kind} entry`); continue; }
        const rest = others(b);
        swap(b, e.bldg);
        if (head) g.ps.push(...tag(e.tail, { group: 'services' }));
        if (kind === 'power' && head) { if (!g.drop(e.head!)) fail.push(`${b.name}: no pole in reach`); }
        else if (meter) { if (!g.feed(e.head!, 'gas', [...rest, ...e.bldg])) fail.push(`${b.name}: gas meter box unroutable (${g.why})`); }
        else if (!g.groundTail(kind, e.path, [...rest, ...e.bldg])) fail.push(`${b.name}: ${kind} tail unroutable (${g.why})`);
      }
    }
  }
  for (const m of [pumps, ...hallKit, ...yard, sewage]) {
    const q = M.isolatorOf(m);
    if (q && !g.feed(q, 'power', world)) fail.push(`isolator of ${q.group} unroutable (${g.why})`);
  }
  if (fail.length) throw new Error('clearance grid: ' + fail.join('; '));

  /* construction site behind the shops: site power from its own generator */
  const gen = M.dieselGenerator({ x: -10, z: -36, rot: 1 });
  const crane = towerCrane({ x: 2, z: -44, gridFed: true });
  const cab = crane.find((q) => q.util === 'power' && q.mat === 'machine')!;
  gen.find((q) => q.util === 'power' && q.mat === 'machine')!.ropeTo = { end: [...cab.pos], slack: 1.5, strength: 1500, kind: 'wire' };
  add(gen, house(crane, { type: 'raft' }),
    house(frameUnderConstruction({ x: 10, z: -26 })),
    siteCabin({ x: -8, z: -19.5 }), siteCabin({ x: -8, z: -23, tint: 0x2f6f4f }),
    // the winter-works enclosure: an air dome over the ground-works bay
    [airDome([-15.4, -9.4], [-31, -27], 0, 3, [-12.4, -31.7], { tint: 0xe9e9e4 })],
    M.excavator({ x: -6, z: -54, rot: 3 }),
    M.dumpTruck({ x: 11, z: -56 }),
    M.mixerTruck({ x: 11, z: -36, rot: 2 }),
    // clear of the frame: its bundle set down inside the frame's bay and slewed out through the west wall
    M.mobileCrane({ x: 2, z: -37, rot: 2 }),
    M.compressor({ x: 14, z: -18.5 }),
    M.scissorLift({ x: 9.5, z: -18.2 }),
    M.lightTower({ x: -12, z: -46 }),
    M.lightTower({ x: 16, z: -40, rot: 2 }),
    stockpiles({ x: -10, z: -60 }),
    dump({ x: 17, z: -60, barrels: [2, 1], propane: [2, 1], group: 'site-gas' }),
  );

  /* car park, merchant yard and its loading dock, parked vehicles (one at the High Street kerb) */
  add(raise(M.car({ x: -9, z: 18, rot: 1 }), lv(-9, 18)), raise(M.car({ x: 6, z: 26, rot: 3, tint: 0x2f3f6f }), lv(6, 26)), raise(M.van({ x: 0, z: 26, rot: 3 }), lv(0, 26)),
    M.lorry({ x: 45, z: 16 }), M.forklift({ x: 54.5, z: 16, rot: 2 }));
  world.push(...raise(M.car({ x: 38, z: 8.3, rot: 0, tint: TINT.carTeal }), lv(38, 8.3)));
  // the loading dock is ground: a concrete platform with steps up its south end
  plan.block([58, 62.5], [20, 26], -0.3, 1.1, 'concrete');
  plan.steps([59, 60.4], [26, 27.05], 'z', -1, 0, 1.1, 4, 'concrete');
  // a lorry load staged on the dock: two crated pallets braced apart by inflated dunnage bags
  const dk = 1.1;
  world.push(block('crate', [58.4, 59.6], [dk, dk + 1.1], [21, 23], { tint: 0xb3833f, noWeld: true, group: 'dock' }),
    block('crate', [59.85, 61.05], [dk, dk + 1.1], [21, 23], { tint: 0xb3833f, noWeld: true, group: 'dock' }),
    dunnageBag([59.63, 59.82], [dk, dk + 1.0], [21.1, 22.9], 'dock', 1500));

  /* cleared ground by the entrance */
  add(rubble(-36, 40, 7), rubble(-55, 58, 13),
    dump({ x: -58, z: 40, barrels: [2, 2], tnt: 2, group: 'caches' }), dump({ x: -34, z: 50, propane: [2, 1], group: 'caches' }),
    dump({ x: -50, z: 36, crates: [2, 2, 2], group: 'caches' }));

  /* surface boxes over the valves, marker plates for the gas and water mains, hydrant plates */
  const furn: PieceSpec[] = [];
  for (const v of g.valveAt) {
    plan.decal(v.kind === 'gas' ? 'gasvalve' : 'valve', v.x, v.z, 0.4);
    if (v.kind === 'gas') furn.push(marker(v.x + 0.7, v.z, lv(v.x + 0.7, v.z)));
  }
  for (const x of [-6.5, 17.5]) furn.push(marker(x, -2.3, 0, SVC.hydrant));
  /* furniture along the High Street and at the crossings */
  furn.push(...[-2.4, 1.4].flatMap((x) => [bollard(x, 2.1, 0), bollard(x, 9.9, 0)]), bollard(4.6, 34.3, 0), bollard(8.4, 34.3, 0));
  furn.push(litterBin(-3.2, -1.6, 0), litterBin(12, 11.1, 0), litterBin(-17.4, 20, 0), litterBin(30, 1.6, 0));
  furn.push(bench(-12, 11.2, 0, true, -1), bench(-50, -3, 0, true, -1), bench(8, 10.9, 0, true, -1));
  furn.push(stopFlag(10, 11.3, 0), postBox(-15.2, -1.9, 0), ...phoneBox(-17.4, 13.5, 0));
  furn.push(sign(-18.1, 0.6, 0, false), sign(22.6, 0.6, 0, false), sign(-18.1, 34.5, 0, false));
  /* back alley behind Terrace Row: garden fences, wheelie bins at the back gates */
  furn.push(...fence('x', -16.35, 44, 59.54, 0, 1.8));
  for (const x of [-9, -3, 7, 14, 24, 32]) furn.push(wheelieBin(x, 60.3, 0, x % 2 ? 0x2f5a3a : 0x3a3d40));
  /* the site hoarding round the construction site: along the shops' back yards (open at the plant gate by the frame),
     down Mill Lane and down Works Road (open at the delivery gate) */
  furn.push(...fence('x', -16, 20.4, -15.4, 0, 2.2, 'plywood', 0x4f6f4f, 6.1).filter((q) => Math.abs(q.pos[0] - 14.5) > 3.5));
  furn.push(...fence('z', -15.45, -62.5, -16, 0, 2.2, 'plywood', 0x4f6f4f, 8.2));
  furn.push(...fence('z', -15.45, -37.6, 20.4, 0, 2.2, 'plywood', 0x4f6f4f, 8.2), ...fence('z', -44.2, -62.5, 20.4, 0, 2.2, 'plywood', 0x4f6f4f, 8.2));

  /* plot boundaries (ground features: low walls stand as the ground does) */
  const wall = (x: Range, z: Range, top: number, mat: 'brick' | 'stone' | 'concrete' = 'brick', tint?: number, y0 = -0.1) => {
    plan.block(x, z, y0, top, mat);
    if (tint !== undefined) plan.spec.blocks[plan.spec.blocks.length - 1].tint = tint;
  };
  const coped = (x: Range, z: Range, top: number, tint = 0x9c5a44) => {
    const alongX = x[1] - x[0] > z[1] - z[0];
    wall(x, z, top - 0.08, 'brick', tint);
    wall(alongX ? x : [x[0] - 0.03, x[1] + 0.03], alongX ? [z[0] - 0.03, z[1] + 0.03] : z, top, 'stone', 0xcfc6b2, top - 0.08);
  };
  // Terrace Row front gardens: a dwarf wall with brick piers at each gate, half-brick walls between the gardens, a
  // flagged path from each gate to the step; the row ends walled back to the alley
  const FW: Range = [43.2, 43.43], FRONT = 46.9;
  const rows = [{ x: [-13.35, 1.35] as Range, doors: [-12.32, -4.37, -2.83], party: [-8.55, -3.75] },
    { x: [3.15, 17.85] as Range, doors: [4.18, 12.13, 13.66], party: [7.95, 12.75] },
    { x: [22.5, 33.5] as Range, doors: [26.95, 29.05], party: [28] }];
  for (const r of rows) {
    const gates = r.doors.map((d) => [d - 0.5, d + 0.5] as Range).sort((a, b) => a[0] - b[0]);
    let x0 = r.x[0];
    for (const g0 of gates) {
      if (g0[0] - x0 > 0.3) coped([x0, g0[0]], FW, 0.85);
      for (const px of [g0[0] - 0.18, g0[1] + 0.18]) coped([px - 0.17, px + 0.17], [FW[0] - 0.06, FW[1] + 0.06], 1.1, 0x8e4e3a);
      plan.mat([g0[0] + 0.05, g0[1] - 0.05], [FW[1], 47.1], 'paving');
      x0 = g0[1];
    }
    if (r.x[1] - x0 > 0.3) coped([x0, r.x[1]], FW, 0.85);
    for (const px of r.party) wall([px - 0.06, px + 0.06], [FW[1], FRONT], 0.9);
  }
  // side walls closing the gardens off from Mill Lane and from the cleared plots east of the semis
  coped([-16.25, -16.02], [FW[0], 59.3], 1.5);
  coped([35.4, 35.63], [FW[0], 59.3], 1.5);
  // the builders' merchant's yard: steel palisade on its west side, along the green (pales toward the green)
  furn.push(...palisade('z', 12.2, 32.3, 33.2, 0, 2.0, 0x2f3a36, 6.8, -1));
  // the works yard's frontage to High Street: palisade, open at the yard gate (pales toward the street)
  furn.push(...palisade('x', 32.4, 63.6, -1.95, 0, 2.0, 0x2f3a36, 6.8, 1).filter((q) => q.pos[0] < 38.5 || q.pos[0] > 45.5));
  // a cut-through path across the green from High Street to Terrace Row, with a bench on it
  plan.mat([21.3, 22.7], [11.65, 32.85], 'paving');
  furn.push(bench(23.6, 22, 0, false, 1), litterBin(23.4, 24.6, 0));
  // the shops' back yards: yard walls between them and a rear wall along the hoarding
  const yardWall = (x: Range, z: Range) => world.push(block('brick', x, [0, 1.8], z, { tint: 0x9a5a46, anchored: true, group: 'yards' }));
  yardWall([-4.3, -4.07], [-15.1, -9.95]);
  yardWall([3.6, 3.83], [-15.1, -10.85]);
  yardWall([10.55, 10.78], [-15.1, -10.85]);
  yardWall([-4.07, 3.6], [-15.1, -14.87]);
  yardWall([3.83, 10.55], [-15.1, -14.87]);
  /* the cleared plots at the east end of Terrace Row: three houses already down to their floor slabs and footings,
     the ground broken up and a heap of what came out of them */
  plan.mat([36, 63], [44.5, 59.5], 'rubble');
  for (const x0 of [37.5, 45, 52.5]) {
    wall([x0, x0 + 6.4], [47.4, 55.2], 0.12, 'concrete', 0x8f8a80);
    wall([x0 - 0.12, x0 + 6.52], [47.28, 47.52], 0.3, 'brick', 0x8e4e3a);
    wall([x0 + 6.4, x0 + 6.64], [47.4, 51 + (x0 % 2)], 0.45, 'brick', 0x8e4e3a);
  }
  add(rubble(58.5, 52, 29));

  /* the chimney's exclusion zone. The fall line runs west down the yard (a bed of broken-out slab and soil laid along
     it to take the impact); a spoil bund across its end on the concrete behind the shops catches what skids and
     bounces on past Works Road short of shop-a, with mesh fencing along its front; Works Road and the High Street
     from shop-a to past the yard gate are closed at barriers for the felling, and the yard gate is fenced shut. */
  plan.mat([31.2, 47.5], [-13.5, -6.5], 'soil');
  for (const [i, y] of [0.6, 1.2, 1.8, 2.3].entries()) plan.level([14.8 + i * 0.5, 20.4 - i * 0.5], [-15.0 + i * 0.4, -3.4 - i * 0.4], y, 'soil');
  furn.push(heras('z', -15.3, -2.9, 21.4, lv(21.4, -9)), heras('x', 38.8, 44.7, -2.6, lv(41.75, -2.6)));
  const closed = (axis: 'x' | 'z', a: number, b: number, at: number, cones: [number, number][], sx: number, sz: number) => {
    const mid = (a + b) / 2, y = axis === 'x' ? lv(mid, at) : lv(at, mid);
    furn.push(barrier(axis, a, b, at, y), ...cones.map(([x, z]) => cone(x, z, lv(x, z))), sign(sx, sz, lv(sx, sz), axis === 'x', 0xe8e8e2, 0.75, 1.9));
  };
  closed('x', 23.3, 28.7, -1.6, [[23.8, -0.4], [26, 0]], 23.2, -1.3);
  closed('x', 23.3, 28.7, -24, [], 28.8, -24.3);
  // High Street from the shops to past the yard's east end (a fall drifting 10-15 deg south of the lane throws
  // brick over the yard frontage onto the carriageway as far east as the yard gate); cones taper each approach
  closed('z', 2.8, 9.2, 12.4, [[11, 3.4], [9.6, 4.4]], 12.4, 2.3);
  closed('z', 2.8, 9.2, 50.5, [[51.9, 8.6], [53.3, 7.6]], 50.5, 9.7);

  /* the demolition contractor's staging ground by the Mill Lane entrance: a hardcore laydown with two stockpiles of
     crushed brick, a dozer, and a rutted haul track in from the lane with standing water in the ruts */
  plan.mat([-62, -29], [43, 63], 'rubble').mat([-50, -28], [55.6, 58.4], 'soil');
  for (const z of [56.3, 57.7]) plan.mat([-54, -28], [z - 0.3, z + 0.3], 'soil');
  for (const [x, z, w] of [[-31, 56.3, 1.6], [-36.5, 57.7, 1.2], [-41, 56.4, 2.0], [-47, 57.6, 1.4], [-40, 47, 2.6]]) plan.decal('puddle', x, z, w, w * 0.45);
  world.push(stockpile('gravel', [-45, -40.5], [49, 53], 1.6, 'staging'), stockpile('gravel', [-40, -37], [52.5, 55.3], 1.2, 'staging'));
  add(M.bulldozer({ x: -31, z: 45, rot: 1 }));

  const pieces = [...world, ...g.ps, ...furn];
  for (const q of pieces) delete q.protected;
  plan.seat(pieces);
  // the player starts at the back of the staging ground looking north-east over it and across Terrace Row: the
  // stockpiles and dozer, Mill Lane, the terrace, the High Street roofs and the works chimney (bearing 54 deg, 16 deg
  // right of the view's centre) all in the first frame
  return { pieces, spawn: { pos: [-46, lv(-46, 61), 61], yaw: -0.66 }, terrain: plan.spec, backdrop: 'town' };
}

/** Grid check for this map: every consumer reaches a grid (or site plant) source. */
export function checkClearanceGrid(bp: Blueprint = clearanceZone()) {
  return checkGrid(bp, gridSource, groundFn(bp.terrain));
}
