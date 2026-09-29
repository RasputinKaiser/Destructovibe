import type { Frame } from '../assemble.ts';
import type { Range } from '../../levels/kit.ts';
import type { Vec3 } from '../../types.ts';

/* Datums of the terminus. Shed column lines at x = ±SPAN, rib lines along -Z behind the booking hall, whose street front
   faces +Z. Parts read every cross-part datum from the Frame they are given; these constants only seed it. */
const SPAN = 18;
const RIBS = [-2, -10, -18, -26, -34, -42, -50];
const Z_END = -66, CONCOURSE = -8;
/** booking hall: half-length, depth, wall thickness */
const HX = 20, HZ = 14, T = 0.45;
/** clock tower: centre offset from the hall's east front corner */
const TOWER_OFF = 2.7;
/** rib depth (m); the extrados at the crown sits half of it above the centreline */
export const RH = 1.0;
/** riveted segments per rib */
export const NSEG = 16;

const girderSeat = 8.6, springing = 9.5, crown = 22.5;

export function frame(): Frame {
  const z: Record<string, number> = {
    hallFront: HZ, hallBack: 0, hallBackIn: T, clockTower: HZ - TOWER_OFF, concourse: CONCOURSE, shedEnd: Z_END,
  };
  RIBS.forEach((v, i) => { z[`rib${i}`] = v; });
  const cols: Range = [-SPAN - 0.4, SPAN + 0.4], bays: Range = [RIBS[RIBS.length - 1] - 0.4, RIBS[0] + 0.4];
  const levels = {
    ground: 0,
    platform: 0.9,     // platform copes, concourse, column pads and booking-hall floor
    firstFloor: 5.4,
    hallEaves: 10.5,
    girderSeat,        // top of the column capitals' bearing plates
    springing,         // top of the plate girders; rib feet
    crown,             // rib centreline at mid-span (springing + 13 m rise)
    extrados: crown + RH / 2,
  };
  const f: Frame = {
    levels,
    grid: { x: { colW: -SPAN, colE: SPAN, hallW: -HX, hallE: HX, clockTower: HX + TOWER_OFF }, z },
    footprint: { x: [-HX - 0.3, HX + 2 * TOWER_OFF], z: [Z_END, HZ + 2.6] },
    bearings: {
      girderSeat: { y: girderSeat, x: cols, z: bays },
      ribSpring: { y: springing, x: cols, z: bays },
    },
  };
  // purlin seat: the inclined outer-flange chord face of the segment just east of the crown (the purlins' bottom faces
  // lie in it; every segment's seat is the same plane rotated about the arch centre)
  const a = arch(f), j = NSEG / 2 - 1, am = (a.ang(j) + a.ang(j + 1)) / 2, n: Vec3 = [Math.cos(am), Math.sin(am), 0];
  const hs = a.RO * Math.cos(a.DA / 2), point: Vec3 = [n[0] * hs, a.YC + n[1] * hs, 0];
  f.bearings.purlinLine = { y: point[1], x: [a.RO * Math.cos(a.ang(j + 1)), a.RO * Math.cos(a.ang(j))], z: bays, normal: n, point };
  return f;
}

/** Circular-arc geometry of the shed ribs, from the frame's column lines, springing and crown. */
export function arch(f: Frame) {
  const SPAN = f.grid.x.colE, YS = f.levels.springing, RISE = f.levels.crown - YS;
  const R = (SPAN * SPAN + RISE * RISE) / (2 * RISE), YC = YS + RISE - R;
  const RI = R - RH / 2, RO = R + RH / 2;
  const PHI = Math.asin((YS - YC) / R);
  const DA = (Math.PI - 2 * PHI) / NSEG;
  const ang = (j: number) => PHI + j * DA;
  const cutR = (r: number) => Math.asin((YS - YC) / r);
  return { SPAN, YS, R, YC, RI, RO, PHI, DA, ang, cutR, RIBS: ribLines(f) };
}

/** Rib lines rib0..ribN, concourse end first. */
export function ribLines(f: Frame): number[] {
  const out: number[] = [];
  for (let i = 0; `rib${i}` in f.grid.z; i++) out.push(f.grid.z[`rib${i}`]);
  return out;
}

/** Booking-hall datums: half-length, depth, wall thickness, ground and first-floor lifts. */
export function hall(f: Frame) {
  const HX = f.grid.x.hallE, HZ = f.grid.z.hallFront, T = f.grid.z.hallBackIn - f.grid.z.hallBack;
  const L1: Range = [f.levels.ground, f.levels.firstFloor], L2: Range = [f.levels.firstFloor, f.levels.hallEaves];
  return { HX, HZ, T, L1, L2 };
}
