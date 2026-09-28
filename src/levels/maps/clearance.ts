import type { Blueprint, PieceSpec, UtilityKind } from '../../types.ts';
import { airDome, awning, balloons, block, carton, crates, dunnageBag, envelopeFinish, extrude, panels, pitchedRoof, place, raise, sandbags, scaffold, splitRange, stockpile, tag, wallRun, type Range } from '../kit.ts';
import { BORE, clipped, combiBoiler, conduit, lamp, LIGHT, radiatorPanel, route, sprinklerRanges, stopcock, supplyBox, SVC } from '../services.ts';
import { chipShop, cottageRow, dump, rotunda, stoneArchBridge, towerCrane, TINT, type Placement } from '../structures.ts';
import { boilerHouse } from '../plant.ts';
import * as M from '../machines.ts';
import * as EL from '../electrical.ts';
import { band, downpipe } from '../facade.ts';
import { MAIN, SiteGrid, checkGrid, depthOf, intakes, kindOf, networks, pumpHall, substation, unsource } from '../grid.ts';
import { bench, bollard, fence, litterBin, marker, phoneBox, postBox, sign, stand, stopFlag, wheelieBin } from './ground.ts';
import { TerrainPlan } from '../../terrain/plan.ts';
import { found, type FoundOpts } from '../../terrain/foundations.ts';
import { groundFn, groundHeight } from '../../terrain/raster.ts';
import { DPC, KERB_UP } from '../../terrain/spec.ts';

/* Clearance Zone: an urban-edge district condemned whole, inside the site fence (±64 m; x east, +z south).
     Streets   High Street (E-W, z 2.5..9.5), the main road, with a raised crossing by the chip shop and signals at
               the Works Road junction · Mill Lane (N-S, x -25.5..-18.5) from the site gate · Works Road (N-S,
               x 23..29) into the yards · Terrace Row (E-W, z 35..41), with a back alley behind the houses.
     North of High Street, east to west: the utility compound and the heritage quarter (chapel, drained canal cut
               under a stone arch bridge, rotunda) west of Mill Lane; the high street shops and pub, with the
               construction site behind them; the industrial yard (boiler house, works hall, press shop) past
               Works Road.
     South of High Street: the car park and the builders' merchant; Terrace Row houses; open demolition ground
               in the south-west by the Mill Lane entrance, where the player starts.
   Every street verge carries the mains, plot side to kerb: gas, water, power (see V below), buried at their real
   cover under the footways and verges (grid.ts). The ground is terrain (terrain/*): carriageways carved a kerb below
   the footways, the canal a stone-walled cut, the construction site an open excavation; buildings stand on their
   foundations a damp course above it (terrain/foundations.ts). */

/* verge offsets from the pavement edge, outward */
const V = { power: 0.3, water: 1.0, gas: 1.65 };
const HSN = 0.35, HSS = 11.65, MLW = -27.65, MLE = -16.35, TRS = 43.15;
const at = { hsN: (k: keyof typeof V) => HSN - V[k], mlW: (k: keyof typeof V) => MLW - V[k], mlE: (k: keyof typeof V) => MLE + V[k], trS: (k: keyof typeof V) => TRS + V[k] };

/* ---------------- local buildings ---------------- */

function put(ps: PieceSpec[], p: Placement, fallback: string): PieceSpec[] {
  return tag(place(envelopeFinish(ps), p.x, p.z, p.rot ?? 0), { group: p.group ?? fallback });
}

/** Sink base under a back-wall window at `c` (inner face `bi`, room toward +Z): two end panels and the sink, with the
    stopcock at the foot of the wall inside it and the 15 mm rising main clipped up to the sink. */
function kitchenSink(c: number, bi: number): PieceSpec[] {
  const zc = bi + 0.048;
  return [
    block('wood', [c - 0.6, c - 0.55], [0, 0.87], [bi, bi + 0.6], { tint: 0xe8e2d4 }),
    block('wood', [c + 0.55, c + 0.6], [0, 0.87], [bi, bi + 0.6], { tint: 0xe8e2d4 }),
    block('steel', [c - 0.6, c + 0.6], [0.87, 0.95], [bi, bi + 0.6], { tint: 0xc9cdd0 }),
    stopcock([c - 0.1, c + 0.15], [0.15, 0.45], [bi, bi + 0.2]),
    ...clipped('water', 'copper', [[c + 0.025, 0.45, zc], [c + 0.025, 0.87, zc]], BORE.cu15, [0, 0, -1]),
  ];
}

/** Two-storey high-street unit, front +Z: shopfront (or pub windows) and door below, flat over, flat roof, fascia.
    Consumer unit by the back door, a shop light off the ceiling; a wall boiler in the back room heats a radiator on
    the side wall, its gas leaving low through the back wall for the meter box outside; a stopcock under the back
    room's sink takes the water main. */
function highStreetUnit(p: Placement & { X?: number; Z?: number; tint?: number; fascia?: number; pub?: boolean }): PieceSpec[] {
  const X = p.X ?? 3, Z = p.Z ?? 4, t = 0.25, g = 3.3, f = 2.7, s = 0.2;
  const br = { mat: 'brick' as const, t, maxW: 4.5, lintel: 'rconcrete' as const, tint: p.tint ?? 0xa98474 };
  const front = p.pub
    ? [{ c: -X + 1.2, w: 1.0, y0: 0, h: 2.2 }, { c: -X + 3.0, w: 1.8, y0: 0.7, h: 1.8 }, { c: X - 2.0, w: 1.8, y0: 0.7, h: 1.8 }]
    : [{ c: -X + 0.9, w: 0.9, y0: 0, h: 2.2 }, { c: 0.75, w: 2 * X - 2.5, y0: 0.45, h: 2.4 }];
  const ps: PieceSpec[] = [
    ...wallRun({ ...br, y0: 0, h: g, from: -X, to: X, at: Z - t / 2, glazing: 'tempered', mullion: 'aluminum', mullionTint: 0x2f3336, openings: front }),
    ...wallRun({ ...br, y0: 0, h: g, from: -X, to: X, at: -Z + t / 2, out: -1, openings: [{ c: X - 1.4, w: 0.9, y0: 0, h: 2.1 }] }),
    ...wallRun({ ...br, y0: 0, h: g, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1 }),
    ...wallRun({ ...br, y0: 0, h: g, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2 }),
    ...panels('rconcrete', [-X, 0, X], [g, g + s], [-Z, Z], { tint: 0xcfcfca }),
    ...wallRun({ ...br, y0: g + s, h: f, from: -X, to: X, at: Z - t / 2, openings: [{ c: -X / 2, w: 1.1, y0: 0.8, h: 1.3 }, { c: X / 2, w: 1.1, y0: 0.8, h: 1.3 }] }),
    ...wallRun({ ...br, y0: g + s, h: f, from: -X, to: X, at: -Z + t / 2, out: -1, openings: [{ c: 0, w: 1.0, y0: 0.9, h: 1.1 }] }),
    ...wallRun({ ...br, y0: g + s, h: f, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1 }),
    ...wallRun({ ...br, y0: g + s, h: f, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2 }),
    ...panels('rconcrete', [-X, 0, X], [g + s + f, g + s + f + s], [-Z, Z], { tint: 0x9a9a96 }),
    extrude('wood', [[Z, g - 0.42], [Z + 0.08, g - 0.42], [Z + 0.1, g - 0.38], [Z + 0.1, g - 0.1], [Z + 0.15, g - 0.06], [Z + 0.15, g - 0.02], [Z, g - 0.02]], 'x',
      [-X + 0.2, X - 0.2], { tint: p.fascia ?? 0x2f4f3f, finish: 'paint' }),
  ];
  const bi = -Z + t, zb = bi + 0.048, xs = -X + t + 0.048;
  ps.push(supplyBox([X - 0.65, X - 0.3], [1.5, 2.1], [bi, bi + 0.12]));
  ps.push(...conduit([[X - 0.475, 2.1, bi + 0.06], [X - 0.475, g - 0.04, bi + 0.06], [X - 0.475, g - 0.04, 0], [0.2, g - 0.04, 0]]));
  ps.push(lamp([-0.2, 0.2], [g - 0.24, g], [-0.2, 0.2], p.pub ? LIGHT.warm : LIGHT.cool));
  ps.push(...combiBoiler([-X + 0.4, -X + 0.85], [1.3, 2.0], bi, 1, -Z));
  ps.push(radiatorPanel([-X + t, -X + t + 0.1], [0.25, 0.75], [bi + 1.2, bi + 2.2]));
  ps.push(...clipped('steam', 'copper', [[-X + 0.5, 1.3, zb], [-X + 0.5, 0.1, zb], [xs, 0.1, zb], [xs, 0.1, bi + 2.05], [xs, 0.25, bi + 2.05]], BORE.cu15, [0, 0, -1]));
  ps.push(...clipped('gas', 'copper', [[-X + 0.75, 1.3, zb], [-X + 0.75, 0.3, zb], [-X + 1.5, 0.3, zb]], BORE.cu22, [0, 0, -1]));
  ps.push(...kitchenSink(0.3, bi));
  if (!p.pub) ps.push(...awning([-X + 1.5, X - 0.3], Z, 2.82, 2.4, 1.3, p.fascia ?? 0x2f4f3f));
  // the pub's balloons tied under the fascia; the shop's stock in cartons at the back
  if (p.pub) ps.push(...balloons(-1.0, Z + 0.2, g - 0.45, 5));
  else ps.push(carton(X - 1.6, -Z + 0.9, 0), carton(X - 1.0, -Z + 0.9, 0, [0.4, 0.3, 0.3], 0xa87c4c), carton(X - 1.6, -Z + 1.4, 0, [0.35, 0.25, 0.3]));
  return put(ps, p, p.pub ? 'pub' : 'shop');
}

/** Pair of two-storey semi-detached houses under one pitched roof, front +Z. Each half: a consumer unit on the front
    wall by the door feeding the hall light along the ceiling; a combi boiler on the kitchen's back wall with its flue
    through it, flow pipework clipped along the skirting to the living-room radiator under the front window (along the
    party wall on the left, the gable on the right, so neither crosses a doorway); the boiler's gas leaving low
    through the back wall for the meter box outside; a stopcock under the kitchen sink on the rising main. */
function semiPair(p: Placement & { tint?: number }): PieceSpec[] {
  const X = 5.5, Z = 4, t = 0.25, g = 2.6, f = 2.5, s = 0.18;
  const br = { mat: 'brick' as const, t, maxW: 6, lintel: 'rconcrete' as const, tint: p.tint ?? 0xb07a62 };
  const half = (c: number) => [{ c: c - 1.4, w: 0.9, y0: 0, h: 2.1 }, { c: c + 1.2, w: 1.4, y0: 0.8, h: 1.3 }];
  const up = (c: number) => [{ c: c - 1.4, w: 0.9, y0: 0.8, h: 1.2 }, { c: c + 1.2, w: 1.4, y0: 0.8, h: 1.2 }];
  const ps: PieceSpec[] = [];
  for (const [y0, h, fr, bk] of [[0, g, [...half(-2.75), ...half(2.75)], [{ c: -2.75, w: 1.2, y0: 0.9, h: 1.1 }, { c: 2.75, w: 1.2, y0: 0.9, h: 1.1 }]],
    [g + s, f, [...up(-2.75), ...up(2.75)], [{ c: -2.75, w: 1.0, y0: 0.9, h: 1.0 }, { c: 2.75, w: 1.0, y0: 0.9, h: 1.0 }]]] as const) {
    ps.push(...wallRun({ ...br, y0, h, from: -X, to: X, at: Z - t / 2, openings: [...fr] }));
    ps.push(...wallRun({ ...br, y0, h, from: -X, to: X, at: -Z + t / 2, out: -1, openings: [...bk] }));
    for (const x of [-X + t / 2, X - t / 2]) ps.push(...wallRun({ ...br, y0, h, axis: 'z', from: -Z + t, to: Z - t, at: x, out: x < 0 ? -1 : 1 }));
    ps.push(...wallRun({ ...br, y0, h, axis: 'z', from: -Z + t, to: Z - t, at: 0, t: 0.22 }));
  }
  ps.push(...panels('wood', [-X, 0, X], [g, g + s], [-Z, Z], { tint: 0xb89b72 }));
  const top = g + s + f;
  ps.push(...pitchedRoof({ mat: 'roof', x: [-X - 0.15, X + 0.15], z: [-Z, Z], y: top, rise: 2.6, thick: 0.32, seat: 0.22, tint: TINT.slate, maxW: 3.8,
    gables: { mat: 'brick', x: [[-X, -X + t], [X - t, X]], tint: br.tint } }));
  for (const c of [-2.75, 2.75]) {
    const left = c < 0, bi = -Z + t, fi = Z - t, zb = bi + 0.048, zf = fi - 0.048;
    const cu = left ? c - 2.2 : c - 2.3;
    ps.push(supplyBox([cu - 0.2, cu + 0.2], [1.4, 2.0], [fi - 0.12, fi]));
    ps.push(...conduit([[cu, 2.0, fi - 0.06], [cu, g - 0.04, fi - 0.06], [cu, g - 0.04, 1.0], [c - 0.2, g - 0.04, 1.0]]));
    ps.push(lamp([c - 0.2, c + 0.2], [g - 0.22, g], [0.8, 1.2], LIGHT.warm));
    const bx: Range = left ? [-0.7, -0.25] : [4.5, 4.95], flow = left ? -0.4 : 4.85, gas = left ? -0.62 : 4.6;
    const wall = left ? -0.11 - 0.048 : X - t - 0.048, rad = c + 1.2;
    ps.push(...combiBoiler(bx, [1.25, 1.95], bi, 1, -Z));
    ps.push(radiatorPanel([rad - 0.5, rad + 0.5], [0.25, 0.75], [fi - 0.1, fi]));
    ps.push(...clipped('steam', 'copper', [[flow, 1.25, zb], [flow, 0.1, zb], [wall, 0.1, zb], [wall, 0.1, zf], [rad + (left ? 0.35 : -0.35), 0.1, zf], [rad + (left ? 0.35 : -0.35), 0.25, zf]], BORE.cu15, [0, 0, -1]));
    ps.push(...clipped('gas', 'copper', [[gas, 1.25, zb], [gas, 0.3, zb], [gas - 0.7, 0.3, zb]], BORE.cu22, [0, 0, -1]));
    ps.push(...kitchenSink(c, bi));
  }
  // eaves gutters front and back to downpipes into back-inlet gullies below ground: the front pair on the front wall,
  // the back pair turned onto the gables so the service trench along the back wall stays clear
  const gy: Range = [top - 0.14, top];
  for (const [z, out] of [[Z, 1], [-Z, -1]] as const) {
    ps.push(...band({ mat: 'pvc', face: z, out, from: -X, to: X, y: gy, depth: 0.14, tint: 0x3a3d40 }));
    for (const x of [-X, X]) ps.push(...(out > 0 ? downpipe({ face: z, out }, x - Math.sign(x) * 0.3, [0, gy[0]]) : downpipe({ axis: 'z', face: x, out: x > 0 ? 1 : -1 }, -Z + 0.2, [0, gy[0]])));
  }
  return put(ps, p, 'semis');
}

/** Parish chapel, front (west door) toward -X: stone nave with lancet windows under a slate roof, a solid stone
    tower with its spire at the west end, consumer unit by the door and two nave lights. */
function chapelLite(p: Placement): PieceSpec[] {
  const X = 7, Z = 3.5, t = 0.45, h = 5.2, st = { tint: 0xc9bea6 };
  const wall = { mat: 'stone' as const, t, y0: 0, h, maxW: 5, tint: st.tint, lintel: 'stone' as const };
  const lancets = [-3.5, 0, 3.5].map((c) => ({ c, w: 0.9, y0: 1.6, h: 2.8 }));
  const ps: PieceSpec[] = [
    ...wallRun({ ...wall, from: -X, to: X, at: Z - t / 2, openings: lancets }),
    ...wallRun({ ...wall, from: -X, to: X, at: -Z + t / 2, out: -1, openings: lancets }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2, openings: [{ c: 0, w: 1.6, y0: 1.8, h: 3.0 }] }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1, openings: [{ c: 0, w: 1.4, y0: 0, h: 2.8 }] }),
    ...pitchedRoof({ mat: 'roof', x: [-X, X + 0.25], z: [-Z, Z], y: h, rise: 2.8, thick: 0.4, seat: 0.2, tint: TINT.slate, maxW: 3.6,
      gables: { mat: 'stone', x: [[X - t, X]], tint: st.tint } }),
    // west tower, clear of the nave gable, and its spire
    block('stone', [-X - 3.2, -X - 0.05], [0, 4.5], [-1.6, 1.6], st),
    block('stone', [-X - 3.2, -X - 0.05], [4.5, 9.0], [-1.6, 1.6], st),
    block('stone', [-X - 3.3, -X + 0.05], [9.0, 9.3], [-1.7, 1.7], { tint: 0xd8cdb4 }),
  ];
  const tipX = -X - 1.625;
  const spire = [[-X - 3.1, 9.3, -1.5], [-X - 3.1, 9.3, 1.5], [-X - 0.15, 9.3, -1.5], [-X - 0.15, 9.3, 1.5], [tipX, 16.5, 0]] as [number, number, number][];
  ps.push(hullOf('roof', spire, TINT.slate));
  // lightning protection: an air terminal on the spire tip, copper tape down its west face, the cap and the tower
  ps.push(...EL.lightningRod([tipX, 16.5, 0], 1.2, [[-X - 3.16, 9.33, 0], [-X - 3.33, 9.33, 0], [-X - 3.33, 0, 0]], { slope: [-X - 3.1, 9.3, 0], out: [-0.98, 0.2, 0] }));
  const wi = -X + t;
  ps.push(supplyBox([wi, wi + 0.12], [1.3, 1.9], [2.2, 2.6]));
  // lighting cable along the top of the south wall's inner face, the lamps hung off it
  const zc = Z - t - 0.04;
  ps.push(...conduit([[wi + 0.06, 1.9, 2.4], [wi + 0.06, h - 0.04, 2.4], [wi + 0.06, h - 0.04, zc], [5, h - 0.04, zc]]));
  for (const x of [-2.5, 1.5]) ps.push(lamp([x - 0.25, x + 0.25], [h - 0.28, h - 0.08], [Z - t - 0.4, Z - t], LIGHT.warm));
  return put(ps, p, 'chapel');
}

function hullOf(mat: 'roof', pts: [number, number, number][], tint: number): PieceSpec {
  const min = [0, 1, 2].map((k) => Math.min(...pts.map((q) => q[k]))), max = [0, 1, 2].map((k) => Math.max(...pts.map((q) => q[k])));
  const c = min.map((v, k) => (v + max[k]) / 2) as [number, number, number];
  return { mat, shape: 'hull', pos: c, size: max.map((v, k) => v - min[k]) as [number, number, number], verts: pts.map((q) => [q[0] - c[0], q[1] - c[1], q[2] - c[2]] as [number, number, number]), tint };
}

/** Site cabin: a steel container office on sleepers with a window and door in its long side (+Z). */
function siteCabin(p: Placement & { tint?: number }): PieceSpec[] {
  const box = block('metal', [-3, 3], [0.15, 2.75], [-1.2, 1.2], { tint: p.tint ?? 0x3f6f9a });
  box.density = 180;
  return put([
    block('wood', [-2.6, -2.3], [0, 0.15], [-1.2, 1.2], { tint: 0x7a5c3e }), block('wood', [2.3, 2.6], [0, 0.15], [-1.2, 1.2], { tint: 0x7a5c3e }),
    box,
    block('tempered', [-1.8, -0.4], [1.1, 2.1], [1.2, 1.26]),
    block('wood', [1.2, 2.1], [0.2, 2.3], [1.2, 1.25], { tint: 0x5a4a3a }),
  ], p, 'cabins');
}

/** Steel portal shed, front +Z: columns, rafters and eaves beams, profiled cladding with door openings, sheet roof.
    `doors` are openings on the front (south) and west gable, as [x or z centre, width, height]. */
function portalShed(p: Placement & { X: number; Z: number; H: number; bays: number; tint?: number; front?: [number, number, number][]; west?: [number, number, number][] }): PieceSpec[] {
  const { X, Z, H } = p, c = 0.15, steel = { tint: 0x8d949b };
  const xs = Array.from({ length: p.bays + 1 }, (_, i) => -X + (2 * X * i) / p.bays);
  const ps: PieceSpec[] = [];
  for (const x of xs) {
    const xr: Range = [Math.max(-X, x - c), Math.min(X, x + c)];
    for (const z of [-Z + c, Z - c]) ps.push(block('steel', xr, [0, H], [z - c, z + c], steel));
    ps.push(block('steel', xr, [H, H + 0.4], [-Z, Z], steel));
  }
  for (let i = 0; i < p.bays; i++) for (const z of [-Z, Z - 2 * c]) ps.push(block('steel', [xs[i] + c, xs[i + 1] - c], [H, H + 0.4], [z, z + 2 * c], steel));
  ps.push(...panels('metal', splitRange(-X - 0.1, X + 0.1, 4.5).flatMap((r, i) => (i === 0 ? r : [r[1]])), [H + 0.4, H + 0.5], [-Z - 0.1, 0, Z + 0.1], { tint: 0x7a8288 }));
  const clad = { mat: 'metal' as const, t: 0.1, y0: 0, h: H + 0.4, maxW: 4.5, tint: p.tint ?? 0x7d9a86 };
  const op = (d: [number, number, number][] = []) => d.map(([cc, w, h]) => ({ c: cc, w, y0: 0, h }));
  ps.push(...wallRun({ ...clad, from: -X, to: X, at: Z + 0.05, openings: op(p.front) }));
  ps.push(...wallRun({ ...clad, from: -X, to: X, at: -Z - 0.05, out: -1 }));
  ps.push(...wallRun({ ...clad, axis: 'z', from: -Z - 0.1, to: Z + 0.1, at: -X - 0.05, out: -1, openings: op(p.west) }));
  ps.push(...wallRun({ ...clad, axis: 'z', from: -Z - 0.1, to: Z + 0.1, at: X + 0.05 }));
  return ps;
}

/** Works hall shell: portal shed with a north-wall lighting tray fed by a riser from the floor feeder (local z -5).
    The floor feeder and the steam main are laid by the site grid through the west door and the south roller door;
    its machines and unit heaters are placed with the map. A wet-pipe sprinkler installation (ordinary hazard, a head
    per ~10 m²) hangs from the roof on drop rods: three ranges off a cross main, fed up the west gable from the
    control valve set of its own tank-and-pump supply (a works' sprinkler water rarely comes off the town main). */
function worksHall(p: Placement): PieceSpec[] {
  const X = 13, Z = 7;
  const ps = portalShed({ x: 0, z: 0, X, Z, H: 6, bays: 4, front: [[4, 4, 4.5]], west: [[-5, 1.2, 2.3]] });
  // lighting tray on the north columns, fed by a riser from the floor feeder (local z -5)
  ps.push(block('steel', [-X + 0.3, X - 0.3], [5.5, 5.6], [-Z + 0.3, -Z + 0.5], { tint: SVC.cable, util: 'power' }));
  for (const x of [-9.75, -3.25, 3.25, 9.75]) ps.push(lamp([x - 0.25, x + 0.25], [5.28, 5.5], [-Z + 0.3, -Z + 0.5], LIGHT.bay));
  // the floor feeder comes up into a distribution board on the north column; the lighting riser leaves its top
  const db = block('machine', [-6.35, -5.75], [1.2, 2.0], [-6.9, -6.45], { tint: 0x9aa09c });
  db.util = 'power';
  db.svcPart = 'breaker';
  // (the feeder and the steam main lie in the ground under the floor, which stands a damp course above it)
  const yf = depthOf('power') - DPC;
  ps.push(db, ...conduit([[-6.0, yf, -5 - MAIN.power.d / 2], [-6.0, yf, -6.675], [-6.0, 1.2, -6.675]]), ...conduit([[-6.0, 2.0, -Z + 0.4], [-6.0, 5.5, -Z + 0.4]]));
  const valve = block('castiron', [-X, -X + 0.4], [0.3, 1.2], [1.5, 2.1], { tint: 0xb0302a, fixture: 'watermain' });
  valve.bore = BORE.st100;
  const rx = -X + 0.02 + 0.052, main = -12.2, rafters = [-13, -6.5, 0, 6.5, 13];
  ps.push(valve, ...clipped('water', 'steel', [[rx, 1.2, 1.8], [rx, 5.6, 1.8], [main - 0.035, 5.6, 1.8]], BORE.st80, [-1, 0, 0]));
  ps.push(...sprinklerRanges({ x: [main, X - 0.4], zs: [-3.5, 0, 3.5], y: 5.6, main, soffit: 6.4, rodAt: (x) => rafters.every((r) => Math.abs(x - r) > 0.3) }));
  // unit heaters, each on a flow riser up through the floor from the steam main along local z 5.6
  for (const x of [-9, -1, 3]) {
    ps.push(radiatorPanel([x - 0.5, x + 0.5], [0, 1.0], [Z - 1.51 - 0.3, Z - 1.51]));
    ps.push(block('steel', [x - 0.05, x + 0.05], [depthOf('steam') - DPC, 0], [Z - 1.61, Z - 1.51], { tint: SVC.steam, util: 'steam' }));
  }
  return put(ps, p, 'works');
}

/** Builders' merchant: an open-fronted portal shed with racking stock and its office consumer unit. */
function merchantShed(p: Placement): PieceSpec[] {
  const X = 10, Z = 6, H = 5.5;
  const ps = portalShed({ x: 0, z: 0, X, Z, H, bays: 3, tint: 0x8a6d4e, front: [[-4, 5.5, 4.6], [4, 5.5, 4.6]] });
  ps.push(supplyBox([-X, -X + 0.12], [1.4, 2.0], [-2.2, -1.7]));
  ps.push(...conduit([[-X + 0.06, 2.0, -1.95], [-X + 0.06, 5.4, -1.95], [-0.25, 5.4, -1.95]]));
  ps.push(lamp([-0.25, 0.25], [5.2, 5.44], [-2.2, -1.7], LIGHT.bay));
  for (const x of [-6, -2, 2]) ps.push(...crates(x, -4, 0, 2, 1, 2, { tint: 0xb3833f }));
  // boxed stock by the racking
  for (const x of [4.8, 5.4, 6.0, 6.6]) ps.push(carton(x, -4.6, 0, [0.45, 0.35, 0.35]));
  return put(ps, p, 'merchant');
}

/** Reinforced-concrete frame going up: two storeys of columns and slabs (the top one half cast) under a scaffold. */
function frameUnderConstruction(p: Placement): PieceSpec[] {
  const con = { tint: 0xc4c2ba }, s = 3.0, sl = 0.25;
  const ps: PieceSpec[] = [];
  for (const x of [-5, 0, 5]) for (const z of [-4, 4]) {
    ps.push(block('rconcrete', [x - 0.2, x + 0.2], [0, s], [z - 0.2, z + 0.2], con));
    ps.push(block('rconcrete', [x - 0.2, x + 0.2], [s + sl, 2 * s + sl], [z - 0.2, z + 0.2], con));
  }
  ps.push(...panels('rconcrete', [-5.25, 0, 5.25], [s, s + sl], [-4.25, 0, 4.25], con));
  ps.push(...panels('rconcrete', [-5.25, 0], [2 * s + sl, 2 * s + 2 * sl], [-4.25, 0, 4.25], con));
  // shuttering on the uncast half
  ps.push(...panels('plywood', [0, 5.25], [2 * s + sl, 2 * s + sl + 0.05], [-4.25, 4.25], { tint: 0xc9a86e }));
  ps.push(...scaffold({ from: -5.4, to: 5.4, face: 4.25, height: 4.6, bay: 3.6, tieEvery: 2, tint: 0x8d949b }));
  return put(ps, p, 'frame');
}

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
  g.main('gas', [[-32.2, -48.8 + MAIN.gas.d / 2], [-32.2, -40], [at.mlW('gas'), -40], [at.mlW('gas'), at.hsN('gas')], [50, at.hsN('gas')]],
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
  bld('boilerhouse', boilerHouse({ x: 45, z: -13, rot: 1 }), 'ground', true, true);
  bld('merchant', merchantShed({ x: 47, z: 24 }), 'ground');
  add(rotunda({ x: -54, z: 22 }), stoneArchBridge({ x: -40, z: 12 }).filter((q) => !kindOf(q)));
  world.push(...canalCut(plan, -40, [-24, 32], [[9.2, 14.8]]));
  add(house(worksHall({ x: 48, z: -40 })), house(put(portalShed({ x: 0, z: 0, X: 7, Z: 4, H: 5.5, bays: 2, tint: 0x6f8fae, west: [[0, 1.2, 2.3]], front: [[3, 3.5, 4]] }), { x: 48, z: -54 }, 'pressshop')));
  // machines in the halls stand on their floors, the yard plant on the ground
  const hallKit = [M.conveyorLine({ x: 36.5, z: -41.5, len: 5, feed: 'grid' }), M.robotArm({ x: 45, z: -41.2, feed: 'grid' }), M.cncGantry({ x: 54.5, z: -39.2, rot: 1, feed: 'grid' }),
    M.pressLine({ x: 48, z: -54, presses: 3, feed: 'grid', group: 'pressline' })].map((m) => stand(m, DPC));
  const yard = [
    M.rotaryKiln({ x: 58.5, z: -22, rot: 1, feed: 'grid' }),
    M.bucketElevator({ x: 51, z: -4.5, feed: 'grid' }),
    M.coolingTowerFans({ x: 58, z: -4.2, cells: 1, feed: 'grid' }),
    M.fanBank({ x: 38.5, z: -4.2, feed: 'grid' }),
    M.ventStack({ x: 60.5, z: -29.5, feed: 'grid' }),
    // the builders' merchant's scrap corner: a grid-fed magnet crane working a scrap heap by the pavement
    EL.magnetCrane({ x: 59.5, z: 18.2, rot: 1, feed: 'grid', slew: 0.55 }),
    [...EL.scrapPile(57.4, 12.9), ...EL.scrapPile(61.4, 12.6)],
  ];
  for (const m of [...hallKit, ...yard]) world.push(...m);
  for (const b of buildings) world.push(...b.ps);

  // steam off-take from the boiler house header, turned along the north wall clear of the flue stack
  const sy = DPC + 3.6;
  const steamStub = route('steel', [[44.6, sy, -17.35], [43.5, sy, -17.35], [43.5, sy, -17.7]], 0.14, { tint: SVC.steam, util: 'steam', group: 'boilerhouse' }, { round: true, elbow: 0.18 });
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
    [airDome([-17, -11], [-31, -27], 0, 3, [-14, -31.7], { tint: 0xe9e9e4 })],
    M.excavator({ x: -6, z: -54, rot: 3 }),
    M.dumpTruck({ x: 11, z: -56 }),
    M.mixerTruck({ x: 11, z: -36, rot: 2 }),
    M.mobileCrane({ x: -5, z: -28.5 }),
    M.bulldozer({ x: 15, z: -50 }),
    M.compressor({ x: 14, z: -18.5 }),
    M.scissorLift({ x: 9.5, z: -18.2 }),
    M.lightTower({ x: -12, z: -46 }),
    M.lightTower({ x: 16, z: -40, rot: 2 }),
    stockpiles({ x: -12, z: -60 }),
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
  /* the site hoarding round the construction site, open at its gate on Works Road side */
  furn.push(...fence('x', -16, 20.4, -15.4, 0, 2.2, 'plywood', 0x4f6f4f, 6.1).filter((q) => Math.abs(q.pos[0] - 14.5) > 3.5));

  const pieces = [...world, ...g.ps, ...furn];
  for (const q of pieces) delete q.protected;
  plan.seat(pieces);
  return { pieces, spawn: { pos: [-22, lv(-22, 61), 61], yaw: 0 }, terrain: plan.spec };
}

/** Grid check for this map: every consumer reaches a grid (or site plant) source. */
export function checkClearanceGrid(bp: Blueprint = clearanceZone()) {
  return checkGrid(bp, gridSource, groundFn(bp.terrain));
}
