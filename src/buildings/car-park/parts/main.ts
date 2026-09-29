import type { PieceSpec } from '../../../types.ts';
import { block, column, flight, hollowStack, raise, splitRange, type Range } from '../../../levels/kit.ts';
import { band, downpipe } from '../../../levels/facade.ts';
import { stair } from '../../../levels/interior.ts';
import { conduit, lamp, LIGHT, supplyBox, SVC } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';
import { car } from '../../car/parts/main.ts';

/** Open-deck concrete car park, 18.5 x 16.5 m: flat-slab decks on columns, edge upstands, lapped ramps that
    alternate sides deck to deck, and a stair tower on the -X end. */
export function carPark(p: Placement & { decks?: number; cars?: number }): PieceSpec[] {
  const D = p.decks ?? 3, H = 3.0, slab = 0.3, e = 0.2;
  const colX = [-9, -3, 3, 9], colZ = [-8, -8 / 3, 8 / 3, 8];
  const xs = [-9.25, -3, 3, 9.25], zs = [-8.25, -8 / 3, 8 / 3, 8.25];
  const con = { tint: TINT.concrete }, dark = { tint: TINT.darkConcrete };
  // each deck has a two-bay hole along one side strip where the ramp from the deck below arrives
  const holeStrip = (deck: number) => (deck % 2 === 1 ? 0 : 2);
  const has = (deck: number, i: number, j: number) => i >= 0 && i < 3 && j >= 0 && j < 3 && (deck === 0 || j !== holeStrip(deck) || i === 0);
  const ps: PieceSpec[] = [];
  for (let s = 0; s < D; s++) {
    const y0 = s * H, top = (s + 1) * H, d = s + 1;
    for (let il = 0; il < 4; il++) {
      for (let jl = 0; jl < 4; jl++) {
        const carries = [il - 1, il].some((i) => [jl - 1, jl].some((j) => has(d, i, j)));
        if (!carries) continue;
        // a column standing in the ramp hole of the deck below drops through it to the deck under that
        const standsOnDeck = s === 0 || [il - 1, il].some((i) => [jl - 1, jl].some((j) => has(s, i, j)));
        // flat slab: the column stops under a drop panel that spreads the punching load into the slab
        const dp = 0.39, cx = colX[il], cz = colZ[jl];
        ps.push(...column('rconcrete', cx, cz, [standsOnDeck ? y0 : y0 - H, top - slab - 0.25], 0.5, con, 6));
        ps.push(block('rconcrete', [Math.max(xs[0], cx - dp), Math.min(xs[3], cx + dp)], [top - slab - 0.25, top - slab], [Math.max(zs[0], cz - dp), Math.min(zs[3], cz + dp)], con));
      }
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (has(d, i, j)) ps.push(block('rconcrete', [xs[i], xs[i + 1]], [top - slab, top], [zs[j], zs[j + 1]], con));
    // edge upstands run between column faces so the next storey's columns stand clear of them
    const by: Range = [top, top + 1.0];
    for (let i = 0; i < 3; i++) {
      const xr: Range = [colX[i] + 0.25, colX[i + 1] - 0.25];
      if (has(d, i, 0)) ps.push(block('rconcrete', xr, by, [zs[0], zs[0] + e], dark));
      if (has(d, i, 2)) ps.push(block('rconcrete', xr, by, [zs[3] - e, zs[3]], dark));
    }
    for (let j = 0; j < 3; j++) {
      const zr: Range = [colZ[j] + 0.25, colZ[j + 1] - 0.25];
      if (has(d, 0, j)) ps.push(block('rconcrete', [xs[0], xs[0] + e], by, zr, dark));
      if (has(d, 2, j)) ps.push(block('rconcrete', [xs[3] - e, xs[3]], by, zr, dark));
    }
    const cross: Range = holeStrip(d) === 0 ? [-7.6, -3.1] : [3.1, 7.6];
    const x0 = s === 0 ? xs[3] : xs[3] - e;
    ps.push(...flight({ mat: 'rconcrete', axis: 'x', from: x0, to: xs[1], cross, y0, steps: 10, rise: H / 10, ...dark }));
    // prop under tread 4, clear of tread 3 below it
    const run = (x0 - xs[1]) / 10, zc = (cross[0] + cross[1]) / 2;
    ps.push(block('rconcrete', [x0 - 5.8 * run, x0 - 5.2 * run], [y0, y0 + 4 * (H / 10)], [zc - 0.3, zc + 0.3], con));
  }
  ps.push(...hollowStack('cinderblock', xs[0] - 1.6, 0, 0, 3.2, 0.25, H, D + 1, dark));
  // switchback stair inside the tower: a flight to a half landing, a flight back to the deck-level landing
  {
    const cx = xs[0] - 1.6, b = 1.35, A: Range = [cx - b, cx - 0.05], Bs: Range = [cx + 0.05, cx + b];
    for (let L = 0; L < D; L++) {
      const y = L * H, mid = y + H / 2, up = (L + 1) * H;
      ps.push(block('rconcrete', [cx - b, cx + b], [mid - 0.2, mid], [0.8, b], con), block('rconcrete', [cx - b, cx + b], [up - 0.2, up], [-b, -0.8], con));
      ps.push(...stair({ axis: 'z', from: -0.8, to: 0.8, cross: A, y0: y, y1: mid, steps: 8, seat: true, mat: 'rconcrete', tint: TINT.concrete, open: 'hi' }));
      ps.push(...stair({ axis: 'z', from: 0.8, to: -0.8, cross: Bs, y0: mid, y1: up, steps: 8, seat: true, mat: 'rconcrete', tint: TINT.concrete, open: 'lo' }));
    }
  }
  ps.push(block('rconcrete', [xs[0] - 3.3, xs[0]], [(D + 1) * H, (D + 1) * H + 0.2], [-1.7, 1.7], con));
  ps.push(block('metal', [xs[0] - 2.6, xs[0] - 0.6], [(D + 1) * H - 2.6, (D + 1) * H - 0.6], [1.6, 1.68], { tint: TINT.metalBlue }));
  // coping rails on the top deck upstands, a cornice round the stair tower head, corner downpipes
  {
    const top = D * H + 1.0, rail = { tint: TINT.steelGrey };
    for (let i = 0; i < 3; i++) {
      const xr: Range = [colX[i] + 0.25, colX[i + 1] - 0.25];
      if (has(D, i, 0)) ps.push(block('steel', xr, [top, top + 0.08], [zs[0] - 0.05, zs[0] + e], rail));
      if (has(D, i, 2)) ps.push(block('steel', xr, [top, top + 0.08], [zs[3] - e, zs[3] + 0.05], rail));
    }
    for (let j = 0; j < 3; j++) {
      const zr: Range = [colZ[j] + 0.25, colZ[j + 1] - 0.25];
      if (has(D, 0, j)) ps.push(block('steel', [xs[0], xs[0] + e], [top, top + 0.08], zr, rail));
      if (has(D, 2, j)) ps.push(block('steel', [xs[3] - e, xs[3] + 0.05], [top, top + 0.08], zr, rail));
    }
    const ty: Range = [(D + 1) * H - 0.25, (D + 1) * H];
    ps.push(...band({ mat: 'concrete', face: 1.6, from: xs[0] - 3.2, to: xs[0], y: ty, depth: 0.1, profile: 'cornice', ...dark }));
    ps.push(...band({ mat: 'concrete', face: -1.6, out: -1, from: xs[0] - 3.2, to: xs[0], y: ty, depth: 0.1, profile: 'cornice', ...dark }));
    ps.push(...band({ mat: 'concrete', axis: 'z', face: xs[0] - 3.2, out: -1, from: -1.6, to: 1.6, y: ty, depth: 0.1, profile: 'cornice', ...dark }));
    for (const [x, z] of [[-8.9, 1], [8.9, 1], [-8.9, -1], [8.9, -1]] as const) ps.push(...downpipe({ face: z * zs[3], out: z }, x, [0, top]));
  }
  // strip lights under every deck on a conduit fed by a riser on the west slab edges
  ps.push(supplyBox([-9.85, -9.33], [0, 1.4], [-2.3, -1.7]), ...splitRange(0, D * H, 6).map((y) => block('steel', [-9.33, -9.25], y, [-2.0, -1.92], { tint: SVC.cable, util: 'power' })));
  for (let s = 1; s <= D; s++) {
    const u = s * H - slab;
    ps.push(...conduit([[-9.25, u - 0.04, -1.96], [9.25, u - 0.04, -1.96]], {}, 0.08, 'pvc', 6.2));
    for (const x of [-6, 0, 6]) ps.push(lamp([x - 0.6, x + 0.6], [u - 0.18, u - 0.08], [-2.08, -1.84], LIGHT.cool));
  }
  const parked = [car({ x: -6, z: 5.3, protected: false }), car({ x: 6, z: 0, tint: TINT.carTeal, protected: false })];
  ps.push(...raise(parked.slice(0, p.cars ?? 0).flat(), H));
  return put(ps, p, 'carpark', { age: { years: 50, exposure: 'salt', cover: 0.025 } });
}
