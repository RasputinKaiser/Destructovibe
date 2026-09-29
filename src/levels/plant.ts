import type { PieceSpec } from '../types.ts';
import { block, cyl, envelopeFinish, panels, place, raise, splitRange, tag, wallRun, type Opening, type Range } from './kit.ts';
import {
  boilerSet, conduit, conveyor, flangedValve, flywheelDrive, gasMeter, VALVE_L, groundTransformer, guy, hvacUnit, hydrant, lamp, LIGHT, pipe, poleLine, press,
  pumpSet, streetLamp, supplyBox, wallFan, waterwheel, windTurbine,
} from './services.ts';
import { gridFeed, type Placement } from '../buildings/_shared/base.ts';
import { band } from './facade.ts';

/* Utility and machinery sites. Authored like structures: local metres, front +Z, dropped with place(). */

const BRICK = 0xa98474, CON = 0xcfcfca, STEEL = 0x8d949b, CLAD = 0x7d9a86, SVC_COPPER = 0xb87840;

function put(ps: PieceSpec[], p: Placement, fallback: string): PieceSpec[] {
  return gridFeed(tag(place(envelopeFinish(ps), p.x, p.z, p.rot ?? 0), { group: p.group ?? fallback }), p.gridFed);
}

/** Brick shell with a flat rconcrete roof: X, Z half-extents, wall thickness t, height h. */
function brickShed(X: number, Z: number, h: number, open: { front?: Opening[]; back?: Opening[]; left?: Opening[]; right?: Opening[] }): PieceSpec[] {
  const t = 0.3;
  const wall = { mat: 'brick' as const, t, y0: 0, h, tint: BRICK, lintel: 'rconcrete' as const, sill: 'stone' as const, maxW: 3 };
  return [
    ...wallRun({ ...wall, from: -X, to: X, at: Z - t / 2, openings: open.front }),
    ...wallRun({ ...wall, from: -X, to: X, at: -Z + t / 2, out: -1, openings: open.back }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: -X + t / 2, out: -1, openings: open.left }),
    ...wallRun({ ...wall, axis: 'z', from: -Z + t, to: Z - t, at: X - t / 2, openings: open.right }),
    ...panels('rconcrete', [-X - 0.1, 0, X + 0.1], [h, h + 0.25], [-Z - 0.1, Z + 0.1], { tint: CON }),
    // stone cornice under the roof overhang on all four faces
    ...band({ mat: 'stone', face: Z, from: -X, to: X, y: [h - 0.25, h], depth: 0.1, profile: 'cornice', tint: 0xe6dcc6 }),
    ...band({ mat: 'stone', face: -Z, out: -1, from: -X, to: X, y: [h - 0.25, h], depth: 0.1, profile: 'cornice', tint: 0xe6dcc6 }),
    ...band({ mat: 'stone', axis: 'z', face: -X, out: -1, from: -Z, to: Z, y: [h - 0.25, h], depth: 0.1, profile: 'cornice', tint: 0xe6dcc6 }),
    ...band({ mat: 'stone', axis: 'z', face: X, from: -Z, to: Z, y: [h - 0.25, h], depth: 0.1, profile: 'cornice', tint: 0xe6dcc6 }),
  ];
}

const win = (c: number) => ({ c, w: 1.2, y0: 1.3, h: 1.5 });

/** Water pumping station: brick house over a buried main rising at the back wall, a header feeding two motor-driven
    pump sets with outlet risers, its own supply cabinet, ceiling lamps and a hydrant at the door. */
export function pumpingStation(p: Placement): PieceSpec[] {
  const X = 4.5, Z = 3, h = 4.2, zi = -2.7;
  const ps: PieceSpec[] = brickShed(X, Z, h, { front: [{ c: -2.5, w: 1.2, y0: 0, h: 2.3 }, win(0.6), win(2.8)], back: [win(-2), win(2)], left: [win(0)] });
  ps.push({ ...cyl('castiron', 0.4, [0, 0.6], -3.6, -2.49, { tint: 0x3d6ea8, fixture: 'watermain' }), bore: 0.3 });
  // the header off the incoming main, with its isolating valve
  const hv = -2.6;
  ps.push(...pipe('water', 'castiron', [[-3.6, 0.6, -2.5], [-3.6, 1.2, -2.5], [hv - VALVE_L / 2, 1.2, -2.5]], 0.36));
  ps.push(flangedValve('water', [hv, 1.2, -2.5], 'x', 0.36, 0.3));
  ps.push(...pipe('water', 'castiron', [[hv + VALVE_L / 2, 1.2, -2.5], [3.4, 1.2, -2.5]], 0.36));
  const cz = zi + 0.38 + 0.357;
  for (const x of [-1, 2]) {
    ps.push(...place(pumpSet(), x, cz));
    ps.push(...pipe('water', 'steel', [[x, 1.1, cz], [x, 3.2, cz], [x, 3.2, zi]], 0.24));
  }
  ps.push(supplyBox([3.98, 4.2], [0.2, 1.0], [-1.4, -0.8]));
  ps.push(...conduit([[3.98, 0.6, -1.1], [2.35, 0.6, -1.1]]), ...conduit([[1.65, 0.6, -1.1], [-0.65, 0.6, -1.1]]));
  ps.push(...conduit([[4.09, 1.0, -1.1], [4.09, 4.16, -1.1], [-2.5, 4.16, -1.1]]));
  for (const x of [-1.5, 1.5]) ps.push(lamp([x - 0.2, x + 0.2], [3.87, 4.12], [-1.3, -0.9], LIGHT.cool));
  ps.push(...hydrant(-1.2, Z + 1.2));
  return put(ps, p, 'pumping');
}

/** Boiler house: two fire-tube boilers on a shared gas feed, a steam header out through the east wall, and a
    guyed steel flue stack outside that wall. */
export function boilerHouse(p: Placement): PieceSpec[] {
  const X = 5, Z = 3.5, h = 4.6;
  const ps: PieceSpec[] = brickShed(X, Z, h, {
    front: [{ c: -3, w: 1.4, y0: 0, h: 2.6 }, win(0.5), win(3)], back: [win(-2.5), win(2.5)], left: [win(0)],
  });
  const bz = -1.2, bx = [-2.2, 1.4];
  for (const x of bx) {
    ps.push(...place(boilerSet(), x, bz));
    ps.push(...pipe('steam', 'steel', [[x + 0.81, 1.9, bz + 0.15], [x + 0.81, 1.9, -0.3], [x + 0.81, 3.5, -0.3]], 0.14));
  }
  ps.push(...pipe('steam', 'steel', [[bx[0] + 0.66, 3.6, -0.3], [X - 0.3, 3.6, -0.3]], 0.2));
  ps.push(gasMeter([-4.7, -4.3], [0, 0.9], [-0.6, -0.1]));
  // gas from the meter, through the boiler house's emergency isolating valve
  const gv = -3.9;
  ps.push(...pipe('gas', 'steel', [[-4.3, 0.5, -0.33], [gv - VALVE_L / 2, 0.5, -0.33]], 0.1));
  ps.push(flangedValve('gas', [gv, 0.5, -0.33], 'x', 0.1, 0.05));
  ps.push(...pipe('gas', 'steel', [[gv + VALVE_L / 2, 0.5, -0.33], [bx[1] + 0.35, 0.5, -0.33]], 0.1));
  ps.push(supplyBox([-1.8, -1.3], [1.2, 1.8], [Z - 0.5, Z - 0.3]));
  ps.push(...conduit([[-1.55, 1.8, Z - 0.34], [-1.55, h - 0.04, Z - 0.34], [3.5, h - 0.04, Z - 0.34]]));
  for (const x of [0.5, 3.0]) ps.push(lamp([x - 0.2, x + 0.2], [h - 0.35, h - 0.08], [Z - 0.55, Z - 0.3], LIGHT.warm));
  // flue stack against the east wall, guyed three ways from a collar
  const sx = X + 0.1 + 0.561, top = 18;
  for (const y of splitRange(0, top, 4.5)) ps.push(cyl('steel', 1.1, y, sx, 0, { tint: 0x5b5f63 }));
  ps.push(cyl('steel', 1.3, [top, top + 0.3], sx, 0, { tint: 0x3c4044 }));
  for (const [dx, dz, ax, az] of [[0.681, 0, sx + 8, 0], [-0.3, 0.681, sx - 3, 8.5], [-0.3, -0.681, sx - 3, -8.5]]) {
    ps.push(...guy([sx + dx, 13, dz], [ax, az]));
  }
  return put(ps, p, 'boilerhouse');
}

/** Press shop: steel portal shed with a ground transformer, a wall cable tray feeding high-bay lamps, two power
    presses with a roller conveyor between them, a flywheel set and an end-wall extractor fan. */
export function pressShop(p: Placement): PieceSpec[] {
  const xs = [-8, -4, 0, 4, 8], Z = 5, H = 6, c = 0.15;
  const steel = { tint: STEEL };
  const ps: PieceSpec[] = [];
  for (const x of xs) for (const z of [-Z, Z]) ps.push(block('steel', [x - c, x + c], [0, H], [z - c, z + c], steel));
  for (const x of xs) ps.push(block('steel', [x - c, x + c], [H, H + 0.4], [-Z - c, Z + c], steel));
  for (const z of [-Z, Z]) for (let i = 0; i < 4; i++) ps.push(block('steel', [xs[i] + c, xs[i + 1] - c], [H, H + 0.4], [z - c, z + c], steel));
  ps.push(...panels('metal', [-8.25, -4, 0, 4, 8.25], [H + 0.4, H + 0.5], [-Z - 0.25, 0, Z + 0.25], { tint: 0x8d949b }));
  const clad = { mat: 'metal' as const, t: 0.1, y0: 0, h: H + 0.4, maxW: 3, tint: CLAD };
  ps.push(...wallRun({ ...clad, from: -8.25, to: 8.25, at: Z + c + 0.05, openings: [{ c: 0, w: 4, y0: 0, h: 4.5 }] }));
  ps.push(...wallRun({ ...clad, from: -8.25, to: 8.25, at: -Z - c - 0.05, out: -1 }));
  ps.push(...wallRun({ ...clad, axis: 'z', from: -Z - c, to: Z + c, at: -8.2, out: -1, openings: [{ c: 2.5, w: 1.1, y0: 0, h: 2.3 }] }));
  ps.push(...wallRun({ ...clad, axis: 'z', from: -Z - c, to: Z + c, at: 8.2 }));
  const ty = 3.74, tz: Range = [-Z + c, -Z + c + 0.4];
  ps.push(...place(groundTransformer(0.9), -6.5, -3.2));
  ps.push(...splitRange(-7.85, 7.85, 4).map((x) => block('metal', x, [ty - 0.04, ty + 0.04], tz, { tint: 0x5b5f63, util: 'power' })));
  ps.push(...conduit([[-5.87, 2.18, -3.2], [-5.6, 2.18, -3.2], [-5.6, ty, -3.2], [-5.6, ty, tz[1]]]));
  for (const x of [-6, -2, 2, 6]) ps.push(lamp([x - 0.25, x + 0.25], [ty - 0.34, ty - 0.04], [tz[0], tz[0] + 0.35], LIGHT.bay));
  for (const x of [-3, 1.5]) {
    ps.push(...place(press(), x, -2.5));
    ps.push(...conduit([[x, ty, tz[1]], [x, ty, -2.85]]));
  }
  ps.push(...place(conveyor(2.4), -1.95, -2.5));
  ps.push(...conduit([[-0.75, ty, tz[1]], [-0.75, ty, -1.3], [-0.75, 0.6, -1.3], [-0.75, 0.6, -1.6]]));
  ps.push(...place(flywheelDrive(), 5, 1));
  ps.push(...conduit([[4.3, ty, tz[1]], [4.3, ty, 1.0], [4.3, 1.1, 1.0]]));
  ps.push(...raise(place(wallFan(1.4), 8.15, 0, 3), 4.5));
  ps.push(...conduit([[7.85, ty, -4.65], [8.11, ty, -4.65], [8.11, ty, -0.6], [8.11, 4.5, -0.6], [8.11, 4.5, -0.25]]));
  return put(ps, p, 'pressshop');
}

/** Rooftop plant deck: two air handlers either side of a shared supply cabinet, with ducts off the back. */
export function hvacPlant(p: Placement): PieceSpec[] {
  const ps: PieceSpec[] = [block('concrete', [-4, 4], [0, 0.3], [-2.5, 2.5], { tint: CON })];
  ps.push(...raise(place(hvacUnit(), -2, 0), 0.3), ...raise(place(hvacUnit(), 2, 0, 2), 0.3));
  ps.push(supplyBox([-0.92, 0.92], [0.3, 1.4], [-0.4, 0.4]));
  for (const x of [-2, 2]) ps.push(block('metal', [x - 0.4, x + 0.4], [0.3, 1.0], [-2.5, -0.8], { tint: 0xa8adb0 }));
  return put(ps, p, 'hvac');
}

/** Distribution substation: two pad transformers stepping down onto a gantry busbar, fenced, floodlit. */
export function substation(p: Placement): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const gz = 0.5, s = 1.2, top = 0.2 + 1.7 * s + 0.4;
  for (const x of [-3.5, 3.5]) {
    ps.push(...place(groundTransformer(s), x, gz));
    ps.push(block('copper', [x - 0.05, x + 0.05], [top + 0.1, 5.1], [gz - 0.05, gz + 0.05], { tint: SVC_COPPER, util: 'power' }));
  }
  const steel = { tint: STEEL };
  for (const x of [-6, 6]) ps.push(block('steel', [x - 0.15, x + 0.15], [0, 6], [gz - 0.15, gz + 0.15], steel));
  ps.push(block('steel', [-6.15, 6.15], [6, 6.3], [gz - 0.15, gz + 0.15], steel));
  for (const x of [-3.5, 0, 3.5]) ps.push(cyl('ceramic', 0.16, [5.2, 6], x, gz, { tint: 0x8a5a44, util: 'power' }));
  ps.push(block('copper', [-5.5, 5.5], [5.1, 5.2], [gz - 0.07, gz + 0.07], { tint: SVC_COPPER, util: 'power' }));
  // palisade fence, gate gap on the front
  const fence = { tint: 0x55595d };
  const run = (a: number, b: number, at: number, alongX: boolean) => {
    for (const u of splitRange(a, b, 4.2)) ps.push(alongX ? block('metal', u, [0, 2.2], [at - 0.04, at + 0.04], fence) : block('metal', [at - 0.04, at + 0.04], [0, 2.2], u, fence));
  };
  run(-8, 8, -5, true);
  run(-8, -1.6, 5, true);
  run(1.6, 8, 5, true);
  run(-4.96, 4.96, -7.96, false);
  run(-4.96, 4.96, 7.96, false);
  ps.push(...place(streetLamp(7, 1.2, LIGHT.flood), -7.2, -4.2, 3), ...place(streetLamp(7, 1.2, LIGHT.flood), 7.2, 4.2, 1));
  return put(ps, p, 'substation');
}

/** Overhead line on four timber poles with a pole-mounted transformer feeding a lamp arm on the third pole. */
export function poleLineSite(p: Placement): PieceSpec[] {
  const h = 9;
  const ps = poleLine([[-18, 0], [-6, 0], [6, 0], [18, 0]], h);
  const x = 6;
  ps.push(cyl('machine', 0.5, [h - 2.4, h - 1.6], x + 0.408, 0, { tint: 0x8d949b, fixture: 'transformer' }));
  ps.push(block('steel', [x + 0.153, x + 2.0], [h - 2.52, h - 2.4], [-0.06, 0.06], { tint: 0x4a5055, util: 'power' }));
  ps.push(lamp([x + 1.6, x + 2.0], [h - 2.72, h - 2.52], [-0.15, 0.15], LIGHT.sodium));
  return put(ps, p, 'poleline');
}

/** Wind turbine on a tapering tower, always turning. */
export function windTurbineSite(p: Placement): PieceSpec[] {
  return put(windTurbine(24, 16), p, 'turbine');
}

/** Undershot mill wheel between stone piers, fed by a timber flume on posts. */
export function millWheel(p: Placement): PieceSpec[] {
  const oak = { tint: 0x6e5238 };
  const ps = waterwheel(2.2);
  ps.push(block('oak', [-6, -0.4], [4.8, 5.05], [-0.4, 0.4], oak));
  for (const x of [-5.5, -2.8]) ps.push(cyl('oak', 0.25, [0, 4.8], x, 0, oak));
  return put(ps, p, 'millwheel');
}
