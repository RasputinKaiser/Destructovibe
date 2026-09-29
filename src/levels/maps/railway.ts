import type { Blueprint, PieceSpec } from '../../types.ts';
import { block, raise, splitRange, type Range } from '../kit.ts';
import { withDetail } from '../layers.ts';
import { cottageRow, dump, TINT } from '../structures.ts';
import { car, dumpTruck, excavator, van } from '../machines.ts';
import { SiteGrid, substation } from '../grid.ts';
import { LANDMARKS } from '../architecture/index.ts';
import { landmarkFoundation } from '../architecture/foundations.ts';
import { bench, bollard, boundaryWall, fence, litterBin, phoneBox, postBox, sign, stopFlag } from './ground.ts';
import { TerrainPlan } from '../../terrain/plan.ts';
import { onFoundation } from '../../terrain/foundations.ts';
import { groundHeight } from '../../terrain/raster.ts';
import { KERB_UP } from '../../terrain/spec.ts';

/* The Railway Quarter, ±90 m (x east, +z south): the Victorian edge of town between the terminus and the river.
     north    the riveted road bridge carries Viaduct Road east-west over the walled, dry bed of the river (x -15..15,
              culverted south of z -48), its river pier standing on the bed · the goods yard west of the river
     middle   the terminus (booking hall facing south onto its forecourt, the train shed running north) · the
              substation by the river headwall · the cotton mill with its engine house and 60 m chimney along the
              north side of Mill Street
     south    the football ground east of Station Approach · Railway Terrace's cottages in the south-west, where the
              player starts on Station Approach looking north
   Station Approach (N-S, x -21..-15) and Mill Street (E-W, z -29.5..-24.5) carry the substation's feeders under
   their footways to the street lights. */

export const RQ = {
  half: 90,
  bed: -3.5,
  river: [-15, 15] as Range,
  bridge: { x: 0, z: -68 },
  station: { x: -52, z: 22 },
  mill: { x: 37, z: -40 },
  stadium: { x: 40, z: 32 },
  substation: { x: 0, z: -40 },
};
const BED = RQ.bed, [RW, RE] = RQ.river, RS = -48;
const APP: Range = [-21, -15], MILL_ST: Range = [-29.5, -24.5], TERR: Range = [52, 58], VIA: Range = [-72, -64];

export function railwayGround(): TerrainPlan {
  const t = new TerrainPlan(RQ.half, 41, 0.1);
  const A = RQ.half;
  // the goods yard and the mill yard are hard standing; the pitch is turf
  t.level([-88, -24], [-59, -45], 0, 'gravel', 1.5);
  t.level([16, 88], [-50, -33], 0, 'setts', 1);
  t.level([8, 72], [-3, 67], 0, 'grass', 1);
  // forecourt in front of the booking hall
  t.level([-74, -24], [38.5, 52], 0, 'setts', 1);
  // footways
  for (const [x, z] of [[[-24, -21], [-45, A]], [[-15, -12], [-45, A]], [[-15, A], [-32, -29.5]], [[-15, A], [-24.5, -22.6]],
    [[-A, -21], [49.5, 52]], [[-A, -21], [58, 60.5]], [[-A, -74.75], [-74, -72]], [[-A, -74.75], [-64, -62]], [[74.75, A], [-74, -72]], [[74.75, A], [-64, -62]]] as [Range, Range][]) t.level(x, z, 0, 'paving', 1.5);
  // Station Approach, kerbed but for the junction mouths; Mill Street and Railway Terrace run into it
  t.street('z', APP, [-45, A], { kerbs: [] });
  const kz = (at: number, side: 1 | -1, runs: Range[]) => { for (const [a, b] of runs) t.kerb({ axis: 'z', at, from: a, to: b, side, top: 0, up: KERB_UP }); };
  kz(APP[0], -1, [[-45, TERR[0]], [TERR[1], A]]);
  kz(APP[1], 1, [[-45, MILL_ST[0]], [MILL_ST[1], A]]);
  t.kerb({ axis: 'x', at: -45, from: APP[0], to: APP[1], side: -1, top: 0, up: KERB_UP });
  t.street('x', MILL_ST, [APP[1], A]);
  t.street('x', TERR, [-A, APP[0]]);
  // Viaduct Road at grade beyond the bridge approaches
  for (const x of [[-A, -74.75], [74.75, A]] as Range[]) t.street('x', VIA, x);
  t.mark('give', [APP[1] + 0.3, MILL_ST[0] - 0.3], [APP[1] + 0.3, MILL_ST[1] + 0.3], 0.2).mark('give', [APP[0] - 0.3, TERR[0] + 0.3], [APP[0] - 0.3, TERR[1] - 0.3], 0.2);
  t.mark('zebra', [-20.7, 46], [-15.3, 46], 3.4);
  // the river: a stone-walled channel on a dry bed, headwall over the culvert mouth at its south end
  t.pit([RW, RE], [-88.5, RS - 0.5], BED, 0, 'soil');
  t.block([RW - 0.5, RW], [-89, RS], BED - 0.2, 0, 'stone').block([RE, RE + 0.5], [-89, RS], BED - 0.2, 0, 'stone');
  t.block([RW, RE], [RS - 0.5, RS], BED - 0.2, 0, 'stone').block([RW, RE], [-89, -88.5], BED - 0.2, 0, 'stone');
  t.decal('puddle', -6, -80, 3.2, 1.8).decal('puddle', 7, -56, 2.4, 1.5).decal('puddle', -3, -66, 1.6, 1.2);
  // drainage and wear
  for (const z of [-20, 5, 30, 70]) t.decal('grating', APP[0] + 0.25, z, 0.35, 0.5).decal('grating', APP[1] - 0.25, z + 12, 0.35, 0.5);
  for (const x of [0, 30, 60]) t.decal('grating', x, MILL_ST[0] + 0.25, 0.5, 0.35).decal('grating', x + 15, MILL_ST[1] - 0.25, 0.5, 0.35);
  for (const [x, z] of [[-18, 0], [-18, 60], [40, -27], [-50, 55]]) t.decal('manhole', x, z, 0.7);
  for (const [x, z, w] of [[-60, -52, 2.4], [-40, -50, 1.6], [-35, 45, 1.2], [20, -27, 1.1]]) t.decal('oil', x, z, w, w * 0.6);
  for (const [x, z] of [[-18, 25], [55, -26], [-60, 55]]) t.decal('patch', x, z, 2.4, 1.4);
  return t;
}

/** The road bridge over the river: the pier's two halves carried down to the bed on masonry plinths, the abutments
    and approaches on the ground (as built, ground-welded), no buried footings. */
function roadBridge(): PieceSpec[] {
  const { x, z } = RQ.bridge;
  const br = LANDMARKS.find((l) => l.id === 'road-bridge')!.make({ x, z });
  const stone = { tint: 0xa89f8c, group: 'roadbridge' };
  const plinths = [[-1.35, -0.05], [0.05, 1.35]].map((h) => block('stone', [x + h[0], x + h[1]], [BED, 0], [z - 6.9, z + 6.9], stone));
  return [...br, ...plinths];
}

/** Parapets along the river walls and over the headwall. */
function riverParapets(): PieceSpec[] {
  const ps: PieceSpec[] = [], o = { tint: 0xb9ad96, group: 'river', anchored: true }, cope = { tint: 0xd8cdb4, group: 'river' };
  for (const x of [[RW - 0.4, RW], [RE, RE + 0.4]] as Range[]) for (const z of splitRange(-88.5, RS - 0.44, 13)) {
    ps.push(block('stone', x, [0, 0.8], z, o), block('stone', [x[0] - 0.04, x[1] + 0.04], [0.8, 0.92], z, cope));
  }
  for (const x of splitRange(RW - 0.4, RE + 0.4, 10.3)) ps.push(block('stone', x, [0, 0.8], [RS - 0.4, RS], o), block('stone', x, [0.8, 0.92], [RS - 0.44, RS + 0.04], cope));
  return ps;
}

/** The two running lines carried on out of the shed to buffer stops at the goods yard fence: ballast, sleepers as
    detail, bullhead rails. */
function runningLines(): PieceSpec[] {
  const ps: PieceSpec[] = [], z0 = RQ.station.z - 66, o = { group: 'sidings' };
  for (const c of [-6.45, 6.45].map((d) => RQ.station.x + d)) {
    for (const zr of splitRange(-58, z0, 7)) {
      const bed = block('stone', [c - 1.4, c + 1.4], [0, 0.3], zr, { tint: 0x8d8778, ...o });
      const sl: PieceSpec[] = [];
      for (let zz = Math.ceil((zr[0] + 0.2) / 0.7) * 0.7; zz < zr[1] - 0.2; zz += 0.7) sl.push(block('wood', [c - 1.3, c + 1.3], [0.17, 0.3], [zz - 0.125, zz + 0.125], { tint: 0x5a4a3c }));
      ps.push(withDetail(bed, sl));
      for (const r of [c - 0.7175, c + 0.7175]) ps.push({ ...block('steel', [r - 0.035, r + 0.035], [0.3, 0.45], [Math.max(zr[0], -57.65), zr[1]], { tint: 0x6f665c, ...o }), section: { kind: 'I', t: 0.04, tw: 0.02, depth: 1 } });
    }
    ps.push(block('castiron', [c - 1.0, c + 1.0], [0.3, 1.25], [-58, -57.65], { tint: 0xa8332b, ...o }));
  }
  return ps;
}

/** The football ground: each stand (with its two masts) on its own slab, so the pitch between them stays turf. */
function stadium(plan: TerrainPlan): PieceSpec[] {
  const p = RQ.stadium, id = 'stadium', ps = LANDMARKS.find((l) => l.id === id)!.make(p), below = landmarkFoundation(id, p);
  return [-1, 1].flatMap((s) => {
    const half = (q: PieceSpec) => Math.sign(q.pos[2] - p.z) === s;
    return onFoundation(ps.filter(half), below.filter(half), plan);
  });
}

/** `extra` adds contract plant and props, given the ground level at (x, z). */
export function railwayQuarter(extra?: (lv: (x: number, z: number) => number) => PieceSpec[]): Blueprint {
  const plan = railwayGround();
  const base = plan.data();
  const lv = (x: number, z: number) => { const y = groundHeight(base, x, z); return Number.isFinite(y) ? y : 0; };
  const g = new SiteGrid();
  g.ground = lv;
  g.bound = RQ.half - 0.5;
  const lm = (id: string) => LANDMARKS.find((l) => l.id === id)!;
  const onFnd = (id: string, p: { x: number; z: number; rot?: number }) => onFoundation(lm(id).make(p), landmarkFoundation(id, p), plan);
  const bridge = roadBridge();
  const world: PieceSpec[] = [
    ...onFnd('station', RQ.station),
    ...onFnd('millworks', RQ.mill),
    ...stadium(plan),
    ...cottageRow({ x: -70, z: 64.5, rot: 2, count: 4, protected: false }),
    ...cottageRow({ x: -44, z: 64.5, rot: 2, count: 4, protected: false }),
    ...riverParapets(),
    ...runningLines(),
    // the goods yard: the plant that was lifting the sidings, and what they left
    ...excavator({ x: -34, z: -52, rot: 1 }),
    ...dumpTruck({ x: -28, z: -47 }),
    ...dump({ x: -70, z: -50, crates: [2, 2, 2], barrels: [2, 1] }),
    ...dump({ x: -33, z: -56.5, propane: [2, 1], tnt: 2 }),
    // the substation by the headwall, its switchboard facing Mill Street
    ...substation({ x: RQ.substation.x, z: RQ.substation.z }),
  ];

  /* feeders: down to Mill Street, west under its north footway and south under Station Approach's east one; east
     under the north footway to the end of the street */
  const s = RQ.substation, fz = s.z + 3.45;
  g.main('power', [[s.x + 0.4, fz + 0.07], [s.x + 0.4, -31], [-13, -31], [-13, 80]], { group: 'feeder', rise: 0.4 });
  g.main('power', [[s.x + 1.2, fz + 0.07], [s.x + 1.2, -31], [86, -31]], { group: 'feeder', rise: 0.4 });
  for (const x of [12, 37, 62, 84]) g.streetLight(x, -31, 'x', 1, 1, 7);
  g.streetLight(-8, -31, 'x', 1, 1, 7);
  for (const z of [-12, 14, 40, 66]) g.streetLight(-13, z, 'z', -1, -1, 7);
  g.signal(-13, 44.2, 'z', -1, [0, 1]);
  g.signal(-13, 47.8, 'z', -1, [0, -1], true);

  const furn: PieceSpec[] = [
    // the forecourt: bollards along its kerb, benches, the cab rank sign, a phone box and a post box
    ...[40, 43, 46].map((z) => bollard(-24.3, z, 0)),
    ...[-62, -46, -38].map((x) => bench(x, 50.6, 0, true, -1)),
    litterBin(-54, 50.6, 0), litterBin(-30, 49.9, 0), litterBin(-13.6, -22.9, 0), litterBin(20, -31.2, 0),
    postBox(-23, 44, 0), ...phoneBox(-23, 36, 0),
    stopFlag(-12.6, 22, 0, false), bench(-12.9, 19.5, 0, false, 1),
    sign(-24.2, 50.5, 0, false), sign(-14.8, -32.2, 0, true), sign(-24.2, 60.2, 0, false),
    // the stadium's turnstile railings along Mill Street, the terrace's garden walls and the goods yard fence
    ...fence('x', 4, 76, -23.3, 0, 1.2, 'steel', 0x3d4a57, 8),
    ...boundaryWall('x', -80, -34, 70.2, 0, 1.0, 'brick', 0x9c6a58, 12),
    ...fence('x', -86, -26, -59.6, 0, 1.8, 'wood', 0x6a5a48, 6),
  ];
  const cars = [
    car({ x: -60, z: 45, rot: 1 }), car({ x: -40, z: 45, rot: 3, tint: TINT.carTeal }), van({ x: -48, z: 44.5, rot: 1 }),
    car({ x: 30, z: -25.6, rot: 2, tint: TINT.vanWhite }), car({ x: 70, z: -28.4 }),
  ].flatMap((c) => { const q = c.find((p) => p.vehicle) ?? c[0]; return raise(c, lv(q.pos[0], q.pos[2])); });
  const pieces = [...world, ...bridge, ...g.ps, ...furn, ...cars, ...(extra?.(lv) ?? [])];
  for (const p of pieces) delete p.protected;
  // the pier's plinths stand on the river bed, not on a bed levelled for them
  plan.seat(pieces.filter((p) => !(p.group === 'roadbridge' && Math.abs(p.pos[0] - RQ.bridge.x) < RE + 1)));
  const spawn = { pos: [-18, lv(-18, 80), 80] as [number, number, number], yaw: 0 };
  return { pieces, spawn, terrain: plan.spec };
}
