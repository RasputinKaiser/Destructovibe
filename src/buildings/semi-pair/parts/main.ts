import type { PieceSpec, Vec3 } from '../../../types.ts';
import { block, hull, type Opening, type Range, type WallRunOpts } from '../../../levels/kit.ts';
import { layerize, withDetail } from '../../../levels/layers.ts';
import { BORE, clipped, combiBoiler, conduit, lamp, LIGHT, radiatorPanel, supplyBox } from '../../../levels/services.ts';
import { band, canopy } from '../../../levels/facade.ts';
import { type Placement } from '../../_shared/base.ts';
import { put, kitchenSink } from '../../_shared/clearance-helpers.ts';
import { brickRun, cantedLight, door, glaze, hipRoof, type LimeOpts, PAINT, timberDeck } from '../../_shared/vernacular.ts';
import { stackShaft } from '../../_shared/roofs.ts';
import { shadeTint, vary } from '../../_shared/tints.ts';

/** Pair of 1930s semi-detached houses under one hipped clay-tile roof, front +Z, each half the mirror of the other.
    Brick ground storey, rendered first storey; a two-storey canted bay on each front room (tile-hung between its
    lights, its own hipped roof tucked under the main eaves); the front doors paired by the party wall under a shared
    bracketed canopy; boxed eaves with gutters all round; a shared stack with four pots on the party wall at the ridge.
    The first-floor joists pocket into the party wall and butt the outer walls.
    Each half: a consumer unit on the front wall by the door feeding the hall light along the ceiling; a combi boiler
    on the kitchen's back wall by the side wall with its flue through it, flow pipework clipped along the skirting of
    the side wall and front wall to the radiator under the bay (never across a doorway); the boiler's gas leaving low
    through the back wall for the meter box outside; a stopcock under the kitchen sink on the rising main. */
export function semiPair(p: Placement & { tint?: number }): PieceSpec[] {
  const X = 5.5, Z = 4, t = 0.25, tp = 0.22, g = 2.6, fs = 0.2, top = 5.3, up = g + fs;
  const brickTint = p.tint ?? 0xa0604a, render = 0xe6dcc4;
  const br = { mat: 'brick' as const, t, maxW: 3.2, lintel: 'rconcrete' as const, sill: 'stone' as const, tint: brickTint };
  const bayU: Range = [2.7, 4.7], doorU: Range = [0.6, 1.5];
  const ps: PieceSpec[] = [];
  const both = <T>(f: (s: 1 | -1) => T[]): T[] => [...f(1), ...f(-1)];
  const mx = (s: number, x: number) => s * x;
  const mr = (s: number, a: number, b: number): Range => (s > 0 ? [a, b] : [-b, -a]);
  const op = (s: number, a: number, b: number, y0: number, h: number, glass?: boolean): Opening => {
    const r = mr(s, a, b);
    return { c: (r[0] + r[1]) / 2, w: r[1] - r[0], y0, h, glass };
  };
  const cas1 = (pane: PieceSpec) => glaze(pane, { rails: [0.72], bars: pane.size[0] > 1.1 || pane.size[2] > 1.1 ? 3 : 2, tint: PAINT.white });
  // front and back walls, brick below, rendered above
  const front = both((s) => [op(s, doorU[0], doorU[1], 0, 2.1), op(s, bayU[0], bayU[1], 0.8, 1.4, false)]);
  const frontUp = both((s) => [op(s, bayU[0], bayU[1], 0.7, 1.4, false), op(s, 1.3, 1.9, 0.9, 1.0)]);
  const back = both((s) => [op(s, 0.5, 1.35, 0, 2.05), op(s, 2.15, 3.35, 0.9, 1.1)]);
  const backUp = both((s) => [op(s, 0.75, 1.35, 1.1, 0.8), op(s, 2.25, 3.25, 0.9, 1.0)]);
  const run = (w: WallRunOpts, out: 1 | -1, lo: LimeOpts = {}, patches: [number, number][] = []) =>
    brickRun(w, out, { bond: 'stretcher', dress: cas1, patches, ...lo });
  // front and back walls, brick below, rendered above; the service tails are sleeved through patches: the meters'
  // supplies either side of the party wall at the front, gas and water low through the back wall
  for (const [s, lo, hi] of [[1, front, frontUp], [-1, back, backUp]] as const) {
    const at = s * (Z - t / 2);
    const patches: [number, number][] = s > 0 ? [[0.33, 1.7], [-0.33, 1.7]] : [[4.25, 0.3], [-4.25, 0.3], [2.775, 0.3], [-2.775, 0.3]];
    ps.push(...run({ ...br, from: -X, to: X, at, y0: 0, h: up, out: s, openings: [...lo] }, s, {}, patches));
    ps.push(...run({ ...br, tint: render, from: -X, to: X, at, y0: up, h: top - up, out: s, openings: [...hi] }, s, { render, foot: -1 }));
  }
  for (const s of [1, -1] as const) {
    const w = { ...br, axis: 'z' as const, from: -Z + t, to: Z - t, at: s * (X - t / 2), out: s };
    ps.push(...run({ ...w, y0: 0, h: up }, s), ...run({ ...w, tint: render, y0: up, h: top - up }, s, { render, foot: -1 }));
    // first floor and ceiling joists butting the party, side, front and back walls
    ps.push(timberDeck(block('plywood', mr(s, tp / 2, X - t), [g, up], [-Z + t, Z - t], { tint: 0x9a7a58 }), { span: 'x' }));
    ps.push(timberDeck(block('plywood', mr(s, tp / 2, X - t), [top - 0.15, top], [-Z + t, Z - t], { tint: 0xb89b72 }), { span: 'x', boards: false }));
  }
  // the party wall in two lifts, the upper standing on the lower
  const pw = { ...br, axis: 'z' as const, from: -Z + t, to: Z - t, at: 0, t: tp, maxW: 2.2 };
  ps.push(...run({ ...pw, y0: 0, h: up }, 1, { both: true }), ...run({ ...pw, y0: up, h: top - up }, 1, { both: true }));
  // doors: glazed-top front doors, half-glazed back doors
  for (const s of [1, -1] as const) {
    ps.push(door('x', mr(s, doorU[0], doorU[1]), [0, 2.1], [Z - t, Z], 1, { tint: s > 0 ? PAINT.red : PAINT.green, glazed: 0.3, panels: 2 }));
    ps.push(door('x', mr(s, 0.5, 1.35), [0, 2.05], [-Z, -Z + t], -1, { tint: PAINT.white, glazed: 0.45, panels: 2 }));
  }
  // two-storey canted bays
  for (const s of [1, -1] as const) ps.push(...bay(mr(s, bayU[0], bayU[1]), Z, brickTint));
  ps.push(...canopy({ face: Z }, [-1.75, 1.75], 2.3, 0.8, { mat: 'wood', tint: PAINT.white, t: 0.16, brackets: true }));
  // hipped plain-tile roof with boxed eaves; the shared stack rises from the party wall through the ridge
  const ov = 0.2, k = 0.84, seat = ov + t;
  const roof = hipRoof({ x: [-X - ov, X + ov], z: [-Z - ov, Z + ov], y: top, k, thick: 0.1 + k * seat, seat, tint: 0x8a5242, ridgeTint: 0x7a4436, maxW: 4.2,
    hole: { x: [-0.53, 0.53], sz: 0.33 }, cover: 'plain' });
  ps.push(...roof.pieces);
  ps.push(...stackShaft({ x: [-0.5, 0.5], z: [-0.3, 0.3], y: [top, roof.ridge + 0.9], tint: brickTint, pots: 4, soot: roof.ridge - 0.3, neck: { x: [-tp / 2, tp / 2], top: top + 0.6 } }));
  // gutters on all four eaves, downpipes on the front wall and the sides
  const gy: Range = [top - 0.02, top + 0.12];
  for (const s of [1, -1] as const) {
    ps.push(...band({ mat: 'pvc', face: s * (Z + ov), out: s, from: -X - ov, to: X + ov, y: gy, depth: 0.12, tint: 0x2f3236 }));
    ps.push(...band({ mat: 'pvc', axis: 'z', face: s * (X + ov), out: s, from: -Z - ov, to: Z + ov, y: gy, depth: 0.12, tint: 0x2f3236 }));
    ps.push(block('pvc', [s * (X - 0.3) - 0.034, s * (X - 0.3) + 0.034], [0, top], [Z, Z + 0.068], { tint: 0x2f3236 }));
    ps.push(block('pvc', s > 0 ? [X, X + 0.068] : [-X - 0.068, -X], [0, top], [-Z + 0.3 - 0.034, -Z + 0.3 + 0.034], { tint: 0x2f3236 }));
  }
  // services, each half the mirror of the other
  const bi = -Z + t, fi = Z - t, zb = bi + 0.048, zf = fi - 0.048;
  for (const s of [1, -1] as const) {
    const c = 2.75, cu = 0.33;
    const P = (x: number, y: number, z: number): Vec3 => [mx(s, x), y, z];
    ps.push(supplyBox(mr(s, 0.15, 0.51), [1.4, 2.0], [fi - 0.12, fi]));
    ps.push(...conduit([P(cu, 2.0, fi - 0.06), P(cu, g - 0.04, fi - 0.06), P(cu, g - 0.04, 1.0), P(c - 0.2, g - 0.04, 1.0)]));
    ps.push(lamp(mr(s, c - 0.2, c + 0.2), [g - 0.22, g], [0.8, 1.2], LIGHT.warm));
    const flow = 4.85, gas = 4.6, wall = X - t - 0.048, rad = (bayU[0] + bayU[1]) / 2;
    ps.push(...combiBoiler(mr(s, 4.5, 4.95), [1.25, 1.95], bi, 1, -Z));
    ps.push(radiatorPanel(mr(s, rad - 0.5, rad + 0.5), [0.25, 0.75], [fi - 0.1, fi]));
    ps.push(...clipped('steam', 'copper', [P(flow, 1.25, zb), P(flow, 0.1, zb), P(wall, 0.1, zb), P(wall, 0.1, zf), P(rad + 0.35, 0.1, zf), P(rad + 0.35, 0.25, zf)], BORE.cu15, [0, 0, -1]));
    ps.push(...clipped('gas', 'copper', [P(gas, 1.25, zb), P(gas, 0.3, zb), P(gas - 0.7, 0.3, zb)], BORE.cu22, [0, 0, -1]));
    ps.push(...kitchenSink(mx(s, c), bi));
  }
  // the two halves' render was last painted at different times: the left half a shade warmer and darker
  for (const q of ps) for (const u of q.detail ?? []) if (u.mat === 'concrete' && u.pos[0] < 0 && u.tint !== undefined) u.tint = shadeTint(u.tint, 0.93, 0.6);
  return put(layerize(ps, { timber: true }), p, 'semis');
}

/* Two-storey canted bay on the front face z = f in front of the openings over u: a brick base to the ground-floor sill,
   casement lights (a dressed front light and framed canted side lights), a panel of small plain tiles hung between the
   floors, the first-floor lights and a hipped bay roof tucked under the main eaves. */
function bay(u: Range, f: number, brickTint: number): PieceSpec[] {
  const D = 0.7, u0 = u[0] - 0.2, u1 = u[1] + 0.2, fu: Range = [u0 + 0.35, u1 - 0.35];
  const plan: [number, number][] = [[u0, f], [u1, f], [fu[1], f + D], [fu[0], f + D]];
  const prism = (mat: PieceSpec['mat'], pl: [number, number][], y0: number, y1: number, tint?: number) =>
    hull(mat, pl.flatMap(([x, z]) => [[x, y0, z], [x, y1, z]] as Vec3[]), tint !== undefined ? { tint } : {});
  const L = Math.hypot(0.35, D);
  const along = (a: [number, number], b: [number, number], d: number): [number, number] => [a[0] + ((b[0] - a[0]) * d) / L, a[1] + ((b[1] - a[1]) * d) / L];
  const lights = (y0: number, y1: number): PieceSpec[] => [
    glaze(block('glass', fu, [y0, y1], [f + D - 0.08, f + D - 0.02]), { rails: [0.72], bars: 3, tint: PAINT.white }),
    cantedLight(along([u0, f], [fu[0], f + D], 0.03), along([u0, f], [fu[0], f + D], L - 0.14), [y0, y1], 0.06, 1),
    cantedLight(along([u1, f], [fu[1], f + D], 0.03), along([u1, f], [fu[1], f + D], L - 0.14), [y0, y1], 0.06, -1),
  ];
  const s1 = 0.68, h1 = 2.2, s2 = 3.38, h2 = 4.9, roofTop = 5.3;
  return [
    prism('brick', plan, 0, s1, brickTint),
    ...lights(s1, h1),
    tileHung(plan, h1, s2),
    ...lights(s2, h2),
    hull('roof', [...plan.map(([x, z]) => [x, h2, z] as Vec3), [u0, roofTop, f], [u1, roofTop, f], [fu[1], h2 + 0.12, f + D], [fu[0], h2 + 0.12, f + D]], { tint: 0x8a5242 }),
  ];
}

/* The panel between a bay's lights: a timber-framed core hung with 265 × 165 plain tiles at a 100 mm gauge on its
   front and canted faces (oriented units), each tile fired a little differently. */
function tileHung(plan: [number, number][], y0: number, y1: number): PieceSpec {
  const p = hull('roof', plan.flatMap(([x, z]) => [[x, y0, z], [x, y1, z]] as Vec3[]), { tint: 0xa0503c });
  const [bl, br, fr, fl] = plan, tt = 0.012;
  const cx = (bl[0] + br[0] + fr[0] + fl[0]) / 4, cz = (bl[1] + br[1] + fr[1] + fl[1]) / 4;
  const inset = (q: [number, number], d: number): [number, number] => { const dx = cx - q[0], dz = cz - q[1], l = Math.hypot(dx, dz); return [q[0] + (dx / l) * d, q[1] + (dz / l) * d]; };
  const d: PieceSpec[] = [hull('wood', [bl, br, fr, fl].map((q) => inset(q, 0.08)).flatMap(([x, z]) => [[x, y0 + 0.002, z], [x, y1 - 0.002, z]] as Vec3[]), { tint: 0x3a2a22 })];
  // faces: left canted (bl→fl), front (fl→fr), right canted (fr→br); tiles on the outer 12 mm of each
  for (const [a, b] of [[bl, fl], [fl, fr], [fr, br]] as [[number, number], [number, number]][]) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const nx = uz, nz = -ux;                          // outward normal for a clockwise-in-plan face order
    const sgn = ((cx - a[0]) * nx + (cz - a[1]) * nz) > 0 ? -1 : 1;
    const inward = (w: number): [number, number] => [-nx * sgn * w, -nz * sgn * w];
    const wTile = 0.165, g = 0.1;
    let row = 0;
    for (let y = y0 + 0.004; y + 0.02 < y1; y += g, row++) {
      const off = (row & 1) * wTile / 2;
      for (let s = 0.04 - off; s < L - 0.04; s += wTile) {
        const sa = Math.max(0.04, s) + 0.004, sb = Math.min(L - 0.04, s + wTile) - 0.004, yb = Math.min(y1 - 0.003, y + g - 0.008);
        if (sb - sa < 0.03 || yb - y < 0.03) continue;
        const pts: Vec3[] = [];
        for (const ss of [sa, sb]) for (const w of [0.002, 0.002 + tt]) for (const yy of [y, yb]) {
          const [ix, iz] = inward(w);
          pts.push([a[0] + ux * ss + ix, yy, a[1] + uz * ss + iz]);
        }
        // plain clay tiles, each fired differently; the dark backing shows in the joints between them
        const q = hull('ceramic', pts);
        q.tint = vary(0x9c4a36, q, 0.3, 9);
        d.push(q);
      }
    }
  }
  return withDetail(p, d);
}
