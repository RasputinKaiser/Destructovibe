import type { PieceSpec } from '../../../types.ts';
import { block, cyl, wallRun, type Range } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { band } from '../../../levels/facade.ts';
import { conduit, lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import { type Placement } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';
import { brickRun, door, hipRoof, lime, PAINT, panelled, sash, shopfront, timberDeck } from '../../_shared/vernacular.ts';
import { inscribe, letters, type SignFace } from '../../_shared/lettering.ts';

/** Protected corner chip shop: a two-storey brick lock-up with the flat above, under a hipped tile roof with boxed eaves
    and a stack for the range flue; a timber shopfront with a teal fascia, a blade sign over it, two sashes upstairs. */
export function chipShop(p: Placement): PieceSpec[] {
  const X = 3, Z = 2.5, t = 0.23, g = 3.0, fs = 0.2, up = g + fs, eave = up + 2.6, head = 2.65, fTop = 3.15;
  const brickTint = 0xb06a50, fascia = 0x2f7f7a;
  const br = { mat: 'brick' as const, t, maxW: 3.2, lintel: 'stone' as const, sill: 'stone' as const, tint: brickTint };
  const sashD = (g0: PieceSpec) => sash(g0, PAINT.white);
  const u: Range = [-X + 0.45, X - 0.45];
  const ps: PieceSpec[] = [
    ...lime(wallRun({ ...br, lintel: 'steel', lintelH: 0.2, maxW: 6, from: -X, to: X, at: Z - t / 2, y0: 0, h: up, out: 1, openings: [{ c: 0, w: u[1] - u[0], y0: 0, h: head, glass: false }] }), 1),
    ...shopfront({ u, head, face: Z, t, fasciaTop: fTop, door: 'lo', tint: PAINT.cream, fascia, sign: 'FISH & CHIPS', signTint: 0xf3e9c8 }),
    ...brickRun({ ...br, from: -X, to: X, at: Z - t / 2, y0: up, h: eave - up, out: 1, openings: [-1.3, 1.3].map((c) => ({ c, w: 0.95, y0: 0.8, h: 1.45 })) }, 1, { dress: sashD }),
    // the power tail leaves through a patch in the back wall by the consumer unit
    ...brickRun({ ...br, from: -X, to: X, at: -Z + t / 2, y0: 0, h: up, out: -1, openings: [{ c: 1.5, w: 0.9, y0: 0, h: 2.1 }] }, -1, { dress: sashD, patches: [[-1.75, 1.7]] }),
    ...brickRun({ ...br, from: -X, to: X, at: -Z + t / 2, y0: up, h: eave - up, out: -1, openings: [{ c: 0.8, w: 0.8, y0: 1.0, h: 1.1 }] }, -1, { dress: sashD }),
    door('x', [1.05, 1.95], [0, 2.1], [-Z, -Z + t], -1, { tint: PAINT.white, panels: 2, glazed: 0.4 }),
    timberDeck(block('plywood', [-X + t, X - t], [g, up], [-Z + t, Z - t], { tint: 0x9a7a58 }), { span: 'z' }),
    timberDeck(block('plywood', [-X + t, X - t], [eave - 0.15, eave], [-Z + t, Z - t], { tint: 0xb89b72 }), { span: 'z', boards: false }),
  ];
  for (const s of [-1, 1] as const) ps.push(...brickRun({ ...br, axis: 'z', from: -Z + t, to: Z - t, at: s * (X - t / 2), y0: 0, h: eave, out: s, maxW: 4 }, s));
  // hipped plain-tile roof with boxed eaves; the fryer range vents up a stainless flue on the back wall
  const ov = 0.25, k = 0.75, seat = ov + t;
  ps.push(...hipRoof({ x: [-X - ov, X + ov], z: [-Z - ov, Z + ov], y: eave, k, thick: 0.1 + k * seat, seat, tint: 0x7e4a3c, ridgeTint: 0x6e3e32, maxW: 3.4, cover: 'plain' }).pieces);
  ps.push(cyl('steel', 0.3, [0, eave + 1.6], 1.0, -Z - 0.55, { tint: 0xb8bcbf, finish: 'satin' }));
  for (const y of [2.2, 4.6]) ps.push(block('steel', [0.95, 1.05], [y, y + 0.06], [-Z - 0.4, -Z], { tint: 0x5c6064 }));
  const gy: Range = [eave - 0.02, eave + 0.12];
  for (const s of [1, -1] as const) {
    ps.push(...band({ mat: 'pvc', face: s * (Z + ov), out: s, from: -X - ov, to: X + ov, y: gy, depth: 0.12, tint: 0x2f3236 }));
    ps.push(...band({ mat: 'pvc', axis: 'z', face: s * (X + ov), out: s, from: -Z - ov, to: Z + ov, y: gy, depth: 0.12, tint: 0x2f3236 }));
  }
  ps.push(block('pvc', [-X + 0.316, -X + 0.384], [0, eave], [-Z - 0.068, -Z], { tint: 0x2f3236 }));
  // blade sign on the first-floor wall over the fascia, sign-written both sides
  const blade = block('metal', [X - 0.42, X - 0.36], [up + 0.35, up + 1.15], [Z, Z + 0.7], { tint: 0xf3e2a9, finish: 'satin' });
  const bf: SignFace[] = [], bl: PieceSpec[] = [];
  for (const [at, out] of [[X - 0.36, 1], [X - 0.42, -1]] as const) {
    const a1: SignFace = { axis: 'z', at, out, u: [Z + 0.08, Z + 0.62], y: [up + 0.8, up + 1.05] }, a2: SignFace = { axis: 'z', at, out, u: [Z + 0.08, Z + 0.62], y: [up + 0.45, up + 0.7] };
    bf.push(a1); bl.push(...letters('FISH', a1, 0x1f5f5a), ...letters('BAR', a2, 0x1f5f5a));
  }
  ps.push(...inscribe([blade], bl, bf));
  // the shop's fittings (they are someone's livelihood, and fixed): the counter across the shop, the fryer range behind
  ps.push(panelled(block('wood', [-1.3, 2.5], [0, 0.95], [0.1, 0.7], { tint: 0xd9d4c8 }), 'x', 1, { cols: 5, tint: 0xd9d4c8 }));
  ps.push(block('steel', [-1.3, 2.5], [0.95, 1.0], [0.05, 0.75], { tint: 0xc8cccf, finish: 'satin' }));
  ps.push(block('steel', [-0.6, 2.2], [0, 0.95], [-Z + t, -Z + t + 0.8], { tint: 0xc8cccf, finish: 'satin' }));
  ps.push(block('steel', [-0.6, 2.2], [1.9, 2.6], [-Z + t, -Z + t + 0.9], { tint: 0xa9adb0, finish: 'satin' }));
  ps.push(supplyBox([-2.0, -1.5], [1.4, 2.0], [-Z + t, -Z + t + 0.2]));
  ps.push(...conduit([[-1.75, 2.0, -Z + t + 0.1], [-1.75, g - 0.04, -Z + t + 0.1], [-1.75, g - 0.04, 0.5]]));
  ps.push(lamp([-1.95, -1.55], [g - 0.33, g - 0.08], [0.05, 0.45], LIGHT.cool));
  return put(layerize(ps, { timber: true }), p, 'chipshop', { protected: true });
}
