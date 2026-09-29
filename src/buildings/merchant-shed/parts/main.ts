import type { MaterialId, PieceSpec } from '../../../types.ts';
import { block, carton, hull, weldParts, type Range } from '../../../levels/kit.ts';
import { withDetail } from '../../../levels/layers.ts';
import { conduit, lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import type { Placement } from '../../_shared/base.ts';
import { put } from '../../_shared/clearance-helpers.ts';
import { frameDims, portalShed, roofY } from '../../portal-shed/parts/main.ts';

/** Builders' merchant: an open-fronted portal shed in painted grey steel sheet, the two yard bays open between the
    exposed columns (a fascia over them), the third bay closed; two runs of pallet racking along the back wall with
    their stock (timber packs, bagged cement, concrete blocks, plasterboard), timber packs on bearers under cover, the
    office consumer unit on the west gable and a bay light off a conduit run along the rafters. */
export function merchantShed(p: Placement): PieceSpec[] {
  const X = 10, Z = 6, H = 5.5;
  const ps = portalShed({ x: 0, z: 0, X, Z, H, bays: 3, tint: 0x9aa3a8, roofTint: 0xa3a9ab, front: [[(-X + 0.05 + X / 3) / 2, X / 3 + X - 0.05, 4.6]], hoods: false });
  ps.push(supplyBox([-X, -X + 0.12], [1.4, 2.0], [-2.2, -1.7]));
  // the lighting conduit runs up the gable and along under the rafters' bottom flanges, clipped to each it passes
  const f = frameDims(X, Z, H), yc = roofY(f, 1.95) - f.dR / f.cs - 0.04;
  ps.push(...conduit([[-X + 0.06, 2.0, -1.95], [-X + 0.06, yc, -1.95], [-0.25, yc, -1.95]]));
  ps.push(lamp([-0.25, 0.25], [yc - 0.2, yc + 0.04], [-2.2, -1.7], LIGHT.bay));
  ps.push(racking([-9.4, -4.0], [-5.4, -4.3], ['timber', 'cement', 'blocks', 'plaster', 'timber', 'blocks']));
  ps.push(racking([-2.9, 2.5], [-5.4, -4.3], ['cement', 'plaster', 'blocks', 'timber', 'cement', 'timber']));
  ps.push(timberPack([-6.5, -2.3], [0.6, 1.7]), timberPack([-1.5, 2.7], [0.6, 1.7]));
  // boxed stock by the racking
  for (const x of [4.8, 5.4, 6.0, 6.6]) ps.push(carton(x, -4.6, 0, [0.45, 0.35, 0.35]));
  return put(ps, p, 'merchant');
}

type Stock = 'timber' | 'cement' | 'blocks' | 'plaster';
const BLUE = 0x2d5b9a, ORANGE = 0xe06a1c, PINE = 0xc8a574, PALLET = 0x9c7b52;

/* units filling a box with a stock type: a pallet under most, then boards, bags, blocks or boards of plasterboard */
function stockUnits(kind: Stock, x: Range, y: Range, z: Range, d: PieceSpec[]): void {
  const u = (mat: MaterialId, xr: Range, yr: Range, zr: Range, tint: number, rho?: number) => { const q = block(mat, xr, yr, zr); q.tint = tint; if (rho) q.density = rho; d.push(q); };
  let y0 = y[0];
  if (kind !== 'timber') {
    // pallet: three bearers under a deck
    for (const zz of [[z[0], z[0] + 0.1], [(z[0] + z[1]) / 2 - 0.05, (z[0] + z[1]) / 2 + 0.05], [z[1] - 0.1, z[1]]] as Range[]) u('wood', x, [y0, y0 + 0.1], zz, PALLET, 500);
    u('wood', x, [y0 + 0.1, y0 + 0.13], z, PALLET, 500);
    y0 += 0.13;
  }
  const X = x[1] - x[0], Zd = z[1] - z[0];
  if (kind === 'timber') {
    // sawn softwood pack: courses of 47 × 150 boards on sticks
    for (const bx of [x[0] + 0.3, x[1] - 0.4]) u('wood', [bx, bx + 0.1], [y0, y0 + 0.08], z, 0x7a5c3e, 500);
    y0 += 0.08;
    for (let yy = y0; yy + 0.047 <= y[1] - 0.001; yy += 0.049) for (let zz = z[0]; zz + 0.15 <= z[1] + 1e-6; zz += 0.152) u('wood', x, [yy, yy + 0.047], [zz, Math.min(zz + 0.15, z[1])], PINE, 480);
  } else if (kind === 'cement') {
    // 25 kg bags, five to a layer, wrapped
    const nx = Math.max(1, Math.floor(X / 0.45)), nz = Math.max(1, Math.floor(Zd / 0.62));
    for (let yy = y0, k = 0; yy + 0.12 <= y[1] - 0.001 && k < 8; yy += 0.121, k++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const bx: Range = [x[0] + (X * i) / nx + 0.005, x[0] + (X * (i + 1)) / nx - 0.005], bz: Range = [z[0] + (Zd * j) / nz + 0.005, z[0] + (Zd * (j + 1)) / nz - 0.005];
      u('cardboard', bx, [yy, yy + 0.12], bz, (i + j + k) % 3 ? 0xb8b2a4 : 0xa99f8c, 1350);
    }
  } else if (kind === 'blocks') {
    // dense concrete blocks 440 × 215 × 100, laid flat in courses
    const nx = Math.max(1, Math.floor(X / 0.445)), nz = Math.max(1, Math.floor(Zd / 0.22));
    for (let yy = y0; yy + 0.1 <= y[1] - 0.001; yy += 0.101) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      u('cinderblock', [x[0] + i * 0.445 + 0.002, x[0] + i * 0.445 + 0.442], [yy, yy + 0.1], [z[0] + j * 0.22 + 0.002, z[0] + j * 0.22 + 0.217], 0x9d9c96, 2000);
    }
  } else {
    // plasterboard: packs of ten 1200-wide boards, banded, on dunnage
    for (let yy = y0, k = 0; yy + 0.125 <= y[1] - 0.001; yy += 0.13, k++) {
      u('plaster', x, [yy, yy + 0.125], [z[0] + 0.02, z[1] - 0.02], k % 2 ? 0xe6e4dd : 0xdcdad2, 700);
      if (yy + 0.13 + 0.125 <= y[1] - 0.001) u('wood', [x[0] + 0.1, x[0] + 0.2], [yy + 0.125, yy + 0.13], [z[0] + 0.02, z[1] - 0.02], PALLET, 500);
    }
  }
}

/** A run of adjustable pallet racking: blue upright frames, orange box beams at 1.5 and 3.0 m, and a load in every
    bay position (floor and both beam levels), one body; its detail is the steel and every board, bag and block. */
function racking(x: Range, z: Range, loads: Stock[]): PieceSpec {
  const bays = 2, post = 0.09, bw = (x[1] - x[0] - (bays + 1) * post) / bays, levels = [0.12, 1.5, 3.0], beam = 0.12;
  const parts: PieceSpec[] = [], d: PieceSpec[] = [];
  const zf: Range = [z[0], z[0] + 0.07], zb: Range = [z[1] - 0.07, z[1]];
  for (let i = 0; i <= bays; i++) {
    const px: Range = [x[0] + i * (post + bw), x[0] + i * (post + bw) + post];
    for (const zz of [zf, zb]) { parts.push(block('steel', px, [0, 4.2], zz)); d.push({ ...block('steel', px, [0, 4.2], zz), tint: BLUE, finish: 'paint', density: 2400 }); }
    // frame lacing between the posts: horizontals and diagonals zig-zagging up the upright frame
    const lz: Range = [zf[1], zb[0]], lx: Range = [px[0] + 0.02, px[1] - 0.02];
    parts.push(block('steel', lx, [0.1, 4.1], lz));
    for (let y = 0.1, k = 0; y < 4.0; y += 0.65, k++) {
      d.push({ ...block('steel', lx, [y, y + 0.035], lz), tint: BLUE, finish: 'paint', density: 3000 });
      const y1 = Math.min(y + 0.65, 4.065), a = k % 2 ? lz[0] : lz[1], b2 = k % 2 ? lz[1] : lz[0];
      if (y1 - y > 0.2) {
        const q: [number, number][] = [[a, y + 0.035], [b2, y1]];
        const w = 0.03, dz = q[1][0] - q[0][0], dy = q[1][1] - q[0][1], l = Math.hypot(dz, dy), nz = (-dy / l) * w / 2, ny = (dz / l) * w / 2;
        const pts: [number, number][] = [[q[0][0] + nz, q[0][1] + ny], [q[0][0] - nz, q[0][1] - ny], [q[1][0] + nz, q[1][1] + ny], [q[1][0] - nz, q[1][1] - ny]]
          .map(([zz, yy]) => [Math.min(lz[1], Math.max(lz[0], zz)), Math.min(y1 - 0.0005, Math.max(y + 0.0355, yy))] as [number, number]);
        const h = hull('steel', lx.flatMap((xx) => pts.map(([zz, yy]) => [xx, yy, zz] as [number, number, number])));
        d.push({ ...h, tint: BLUE, finish: 'paint', density: 3000 });
      }
    }
  }
  let k = 0;
  for (let b = 0; b < bays; b++) {
    const bx: Range = [x[0] + post + b * (post + bw), x[0] + post + b * (post + bw) + bw];
    for (const y of levels) {
      let base = y;
      {
        for (const zz of [zf, zb]) { parts.push(block('steel', bx, [y - beam, y], zz)); d.push({ ...block('steel', bx, [y - beam, y], zz), tint: ORANGE, finish: 'paint', density: 1500 }); }
      }
      const lx: Range = [bx[0] + 0.05, bx[1] - 0.05], lz: Range = [zf[0] + 0.02, zb[1] - 0.02];
      const top = base + 1.2;
      parts.push(block('steel', lx, [base, top], lz));
      stockUnits(loads[k++ % loads.length], lx, [base, top], lz, d);
      base = top;
    }
  }
  const out = weldParts(parts, { tint: BLUE });
  return withDetail(out, d);
}

/** A pack of sawn timber on two bearers, banded, under cover in the yard bay. */
function timberPack(x: Range, z: Range): PieceSpec {
  const p = block('wood', x, [0, 0.62], z, { tint: PINE });
  const d: PieceSpec[] = [];
  stockUnits('timber', x, [0, 0.62], z, d);
  return withDetail(p, d);
}
