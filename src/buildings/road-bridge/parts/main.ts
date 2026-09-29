import type { PieceSpec, Vec3 } from '../../../types.ts';
import { block, hull, splitRange, type PieceOpts, type Range } from '../../../levels/kit.ts';
import { boards, floorSlab, withDetail } from '../../../levels/layers.ts';
import { lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import { add, cross, finish, member, mul, PROF, sect, sub, unit, type Placement } from '../../../levels/architecture/common.ts';

/* Riveted steel road bridge of the 1890s: two 42 m Pratt through-trusses (eight 5.25 m panels, 7 m deep) on
   cast-iron rocker bearings, a masonry river pier and abutments, and ramped approaches. Built-up box chords and
   end posts carry compression, the flat eyebar diagonals tension; cross girders at every panel point carry four
   lines of stringers under a reinforced-concrete deck with its asphalt surfacing, and cantilever brackets carry
   a timber footway outside each truss. Top struts and a lower lateral system brace the trusses. The two spans
   stand apart on their bearings (a 0.4 m gap over the pier), so one can fall and leave the other. Runs along X. */

const PANEL = 5.25, NP = 8, SPAN = PANEL * NP, DEPTH = 7, ZT = 4.2, YB = 2.6, GAP = 0.4;
/** road surface, and the footways a kerb above it */
const ROADY = YB + 1.3, FW = ROADY + 0.15;
const CH: [number, number] = [0.6, 0.5];   // chord depth (y) and width (z)
const GREEN = 0x4f6b5a, IRON = 0x3c4044;
const RIVET = { kind: 'rivet' as const, n: 16, d: 0.022 };

function span(x0: number): PieceSpec[] {
  const ps: PieceSpec[] = [], o: PieceOpts = { tint: GREEN, joint: RIVET };
  const node = (i: number) => x0 + i * PANEL;
  const yt = YB + DEPTH, box = { kind: 'rhs' as const, t: 0.016 };
  for (const s of [-1, 1]) {
    const zc = s * ZT, cz: Range = [zc - CH[1] / 2, zc + CH[1] / 2];
    // bottom chord: one box per panel; top chord between the end posts' heads
    for (let i = 0; i < NP; i++) ps.push(sect('steel', [node(i), node(i + 1)], [YB, YB + CH[0]], cz, box, o));
    for (let i = 1; i < NP - 1; i++) ps.push(sect('steel', [node(i) + (i === 1 ? 0.25 : 0), node(i + 1) - (i + 2 === NP ? 0.25 : 0)], [yt - CH[0], yt], cz, box, o));
    // inclined end posts: land level on the chord's end, butt the top chord's end; hip verticals hang under them
    for (const [e, h, d] of [[0, 1, 1], [NP, NP - 1, -1]] as [number, number, number][]) {
      const foot: Vec3 = [node(e) + d * 0.35, YB + CH[0], zc], head: Vec3 = [node(h) + d * 0.25, yt - CH[0] / 2, zc];
      ps.push(member('steel', foot, head, PROF.box(CH[1], 0.5, 0.016), { ...o, depth: [0, 0, 1], cut: [{ at: foot, n: [0, 1, 0] }, { at: [head[0], 0, zc], n: [1, 0, 0] }] }));
      const t = unit(sub(head, foot)), wv = cross(t, [0, 0, 1]), down: Vec3 = wv[1] < 0 ? wv : mul(wv, -1);
      const under = add(foot, mul(down, 0.25));
      ps.push(member('steel', [node(h), YB + CH[0], zc], [node(h), yt, zc], PROF.I(0.3, 0.4, 0.02, 0.012), { ...o, depth: [1, 0, 0], cut: [{ at: [0, YB + CH[0], 0], n: [0, 1, 0] }, { at: under, n: down }] }));
    }
    // verticals (compression, rolled I) and Pratt diagonals (tension, flat bars) sloping down toward mid-span
    for (let i = 2; i < NP - 1; i++) ps.push(sect('steel', [node(i) - 0.15, node(i) + 0.15], [YB + CH[0], yt - CH[0]], [zc - 0.2, zc + 0.2], { kind: 'I', t: 0.02, tw: 0.012, axis: 1, depth: 0 }, o));
    for (let i = 1; i < NP; i++) {
      if (i === NP / 2) continue;
      const left = i < NP / 2, a: Vec3 = [node(i) + (left ? 0.45 : -0.45), yt - CH[0], zc], b: Vec3 = [node(left ? i + 1 : i - 1) + (left ? -0.45 : 0.45), YB + CH[0], zc];
      ps.push(member('steel', a, b, PROF.flat(0.08, 0.24), { ...o, depth: [0, 0, 1], cut: 'level' }));
    }
    // footway: cantilever brackets off the bottom chord at each panel point, timber decking, a railing
    const zo = s * (ZT + CH[1] / 2), zf: Range = s > 0 ? [zo, zo + 1.9] : [zo - 1.9, zo];
    for (let i = 0; i <= NP; i++) {
      const x = Math.min(Math.max(node(i), node(0) + 0.15), node(NP) - 0.15);
      ps.push(sect('steel', [x - 0.15, x + 0.15], [YB + 0.25, FW - 0.1], zf, { kind: 'I', t: 0.015, tw: 0.01, depth: 1 }, o));
    }
    for (let i = 0; i < NP; i++) {
      const deck = block('wood', [node(i), node(i + 1)], [FW - 0.1, FW], zf, { tint: 0x8a6a4a });
      const planks: PieceSpec[] = [];
      for (const x of splitRange(node(i), node(i + 1), 0.15)) planks.push(block('wood', [x[0] + 0.004, x[1] - 0.004], [FW - 0.1, FW], zf, { tint: 0x7a5c40 }));
      ps.push(withDetail(deck, planks));
      const rz: Range = s > 0 ? [zf[1] - 0.08, zf[1]] : [zf[0], zf[0] + 0.08];
      ps.push(block('steel', [node(i), node(i + 1)], [FW, FW + 1.1], rz, { tint: IRON }));
    }
  }
  // cross girders at the panel points, stringers on them, the RC deck with its surfacing on the stringers
  const zi: Range = [-ZT + CH[1] / 2, ZT - CH[1] / 2];
  for (let i = 0; i <= NP; i++) {
    const x = Math.min(Math.max(node(i), node(0) + 0.15), node(NP) - 0.15);
    ps.push(sect('steel', [x - 0.15, x + 0.15], [YB, YB + CH[0]], zi, { kind: 'I', t: 0.02, tw: 0.012, depth: 1 }, o));
  }
  const yd: Range = [YB + CH[0] + 0.45, YB + CH[0] + 0.7];
  for (const zs of [-2.6, -0.87, 0.87, 2.6]) for (let i = 0; i < NP; i++) {
    ps.push(sect('steel', [node(i), node(i + 1)], [YB + CH[0], yd[0]], [zs - 0.12, zs + 0.12], { kind: 'I', t: 0.016, tw: 0.01, depth: 1 }, o));
  }
  for (let i = 0; i < NP; i++) {
    const x: Range = [node(i), node(i + 1)], s = floorSlab(x, zi, yd);
    const d: PieceSpec[] = [...boards(s, [yd[1] - 0.06, yd[1]], 'asphalt', [2.4, 2.4], 0, { tint: 0x3b3d40 }), ...boards(s, [yd[0], yd[1] - 0.06], 'rconcrete', [1.75, 1.75], 0, { tint: 0xbdbab2 })];
    ps.push(withDetail(block('rconcrete', x, yd, zi, { tint: 0xbdbab2 }), d));
  }
  // kerbs along the carriageway edges
  for (const s of [-1, 1]) for (let i = 0; i < NP; i++) ps.push(block('stone', [node(i), node(i + 1)], [yd[1], yd[1] + 0.15], s > 0 ? [zi[1] - 0.3, zi[1]] : [zi[0], zi[0] + 0.3], { tint: 0x9a968d }));
  // top struts at each panel point between the top chords, lower lateral bracing between the girders
  for (let i = 1; i < NP; i++) ps.push(sect('steel', [node(i) - 0.15, node(i) + 0.15], [yt - 0.5, yt], zi, { kind: 'I', t: 0.016, tw: 0.01, depth: 1 }, o));
  // top lateral bracing: a diagonal in plan across each panel between the struts, triangulating the top chords
  for (let i = 1; i < NP - 1; i++) {
    const za = i % 2 ? zi[0] : zi[1], zb = i % 2 ? zi[1] : zi[0];
    const a: Vec3 = [node(i) + 0.27, yt - 0.3, za], b: Vec3 = [node(i + 1) - 0.27, yt - 0.3, zb];
    ps.push(member('steel', a, b, PROF.angle(0.2, 0.016), { ...o, depth: [0, 1, 0], cut: [{ at: a, n: [0, 0, 1] }, { at: b, n: [0, 0, 1] }] }));
  }
  for (let i = 0; i < NP; i++) {
    const za = i % 2 ? zi[1] : zi[0], zb = i % 2 ? zi[0] : zi[1];
    const a: Vec3 = [node(i) + (i === 0 ? 0.3 : 0.15) + 0.12, YB + 0.08, za], b: Vec3 = [node(i + 1) - (i + 1 === NP ? 0.3 : 0.15) - 0.12, YB + 0.08, zb];
    ps.push(member('steel', a, b, PROF.angle(0.16, 0.014), { ...o, depth: [0, 1, 0], cut: [{ at: a, n: [0, 0, 1] }, { at: b, n: [0, 0, 1] }] }));
  }
  // cast-iron rocker bearings under the chords' ends
  for (const s of [-1, 1]) for (const x of [node(0) + 0.35, node(NP) - 0.35]) ps.push(block('castiron', [x - 0.3, x + 0.3], [YB - 0.5, YB], [s * ZT - 0.4, s * ZT + 0.4], { tint: IRON }));
  return ps;
}

/** Stone pier (with cutwaters) and abutments; ramps down to the ground at 1:8 behind each abutment. */
function substructure(): PieceSpec[] {
  const ps: PieceSpec[] = [], stone = { tint: 0xb9ad96 }, top = YB - 0.5, W = ZT + 2.3;
  // the pier is built as two halves on a movement joint, one under each span's bearings, so a falling span
  // tears out its own half rather than dragging the other span off through a shared pier
  for (const h of [[-1.2, -0.05], [0.05, 1.2]] as Range[]) {
    ps.push(block('stone', h, [0, top], [-W + 1.2, W - 1.2], stone));
    for (const s of [-1, 1]) ps.push(hull('stone', h.flatMap((x) => [0, top].flatMap((y) => [[x, y, s * (W - 1.2)], [x, y, s * (W + 0.2 - Math.abs(x) * 1.15)]] as Vec3[])), stone));
  }
  const road = ROADY;
  for (const s of [-1, 1]) {
    // bearing shelf, and the back wall up to road level behind a 0.1 m expansion gap
    const xe = s * (SPAN + GAP / 2), back: Range = s > 0 ? [xe + 0.1, xe + 1.35] : [xe - 1.35, xe - 0.1];
    ps.push(block('stone', s > 0 ? [xe - 0.7, xe + 0.1] : [xe - 0.1, xe + 0.7], [0, top], [-W, W], stone));
    ps.push(block('stone', back, [0, road], [-W, W], stone));
    // approach: a retained ramp at 1:8 down to the ground in 6 m lengths, surfaced as the deck
    const len = road * 8, x0 = s > 0 ? back[1] : back[0];
    for (const [a, b] of splitRange(0, len, 6)) {
      const xa = x0 + s * a, xb = x0 + s * b, ya = road * (1 - a / len), yb = road * (1 - b / len);
      const pts: Vec3[] = [];
      for (const z of [-W, W]) pts.push([xa, 0, z], [xb, 0, z], [xa, ya, z], [xb, yb, z]);
      ps.push(hull('concrete', pts, { tint: 0x9d9a92 }));
    }
  }
  return ps;
}

/** Lamps on the footway railings at the piers and abutments, fed from a pillar on each abutment. */
function lighting(): PieceSpec[] {
  const ps: PieceSpec[] = [], road = ROADY;
  for (const s of [-1, 1]) for (const zs of [-1, 1]) {
    const x = s * (SPAN + GAP / 2 + 0.75), z = zs * 6.0;
    ps.push(supplyBox([x - 0.3, x + 0.3], [road, road + 1.2], [z - 0.3, z + 0.3]));
    ps.push(block('steel', [x - 0.08, x + 0.08], [road + 1.2, road + 5.5], [z - 0.08, z + 0.08], { tint: IRON, util: 'power' }));
    ps.push(lamp([x - 0.3, x + 0.3], [road + 5.5, road + 5.9], [z - 0.3, z + 0.3], LIGHT.sodium));
  }
  return ps;
}

/** Two-span riveted Pratt through-truss road bridge with ramped approaches (runs along X). */
export function trussRoadBridge(p: Placement): PieceSpec[] {
  const ps = [...span(-SPAN - GAP / 2), ...span(GAP / 2), ...substructure(), ...lighting()];
  return finish(ps, p, 'roadbridge', { years: 130, exposure: 'outdoor' });
}
