import type { PieceSpec, Vec3 } from '../../../types.ts';
import { block, cyl, weldParts, type Range } from '../../../levels/kit.ts';
import { withDetail } from '../../../levels/layers.ts';
import { member, PROF } from '../../../levels/architecture/common.ts';
import type { Placement } from '../../_shared/base.ts';
import { put } from '../../_shared/clearance-helpers.ts';

const PRIMER = 0x8a5a44, GALV = 0x9aa1a6, TIMBER = 0xb08a5a, CON = 0xc4c2ba;
/* the deck's pans face down, lit only by the site's warm ground bounce: drawn cool so the galvanised soffit reads grey */
const SOFFIT = 0xa0bde6;
const S = 3.6;
const xs = [-7.5, 0, 7.5], zs = [-4.5, 4.5];
const cw = 0.26;         // UC 254x254x89: 260 deep, 256 wide
const bD = 0.46, bB = 0.19;  // UB 457x191x67 (7.5 m and 9 m spans)

type Unit = PieceSpec;
const u = (q: PieceSpec, tint: number, finish?: PieceSpec['finish'], density?: number): Unit => {
  q.tint = tint;
  if (finish) q.finish = finish;
  if (density !== undefined) q.density = density;
  return q;
};

/** UC column on its base plate with holding-down bolts, a splice cap for the next lift: plates as parts and as detail. */
function column(x: number, z: number, top: number): PieceSpec {
  const h = cw / 2, t = 0.04, bp = 0.04;
  const parts = [
    block('steel', [x - 0.25, x + 0.25], [0, bp], [z - 0.25, z + 0.25]),
    block('steel', [x + h - t, x + h], [bp, top], [z - h, z + h]),
    block('steel', [x - h, x - h + t], [bp, top], [z - h, z + h]),
    block('steel', [x - h + t, x + h - t], [bp, top], [z - t / 2, z + t / 2]),
  ];
  const d: Unit[] = [
    u(block('steel', [x - 0.25, x + 0.25], [0, 0.02], [z - 0.25, z + 0.25]), PRIMER, 'paint'),
    ...([[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]] as [number, number][]).map(([a, b]) => { const n = cyl('steel', 0.036, [0.02, 0.04], x + a, z + b); return u(n, 0x3a3d40); }),
    ...parts.slice(1).map((q) => u({ ...q }, PRIMER, 'paint')),
  ];
  const p = weldParts(parts, { section: { kind: 'I', t: 0.011, tw: 0.0072, axis: 1, depth: 0 }, joint: { kind: 'bolt', n: 4, d: 0.024, grade: '8.8', preload: 0.2 } });
  p.tint = PRIMER;
  p.finish = 'paint';
  return withDetail(p, d);
}

/** UB beam at level top `y`, along x or z, with bolted end plates (bolts and nuts as detail). Along x it bears on the
    column flanges; along z it is coped between them and its end plates (narrower than the flange gap) bolt to the
    column webs `cope` beyond the flange tips. */
function beam(axis: 'x' | 'z', span: Range, y: number, at: number, cope = 0): PieceSpec {
  const t = 0.04, m = (a: Range, yy: Range, c: Range) => (axis === 'x' ? block('steel', a, yy, c) : block('steel', c, yy, a));
  const pw = cope > 0 ? 0.07 : bB / 2;
  const c: Range = [at - bB / 2, at + bB / 2], w: Range = [at - t / 2, at + t / 2], ep: Range = [at - pw, at + pw];
  const e: Range = [span[0] - cope, span[1] + cope];
  const inner: Range = [span[0] + (cope ? 0 : t), span[1] - (cope ? 0 : t)];
  const parts = [
    m([e[0], e[0] + t], [y - bD + (cope ? 0.04 : 0), y - (cope ? 0.04 : 0)], ep), m([e[1] - t, e[1]], [y - bD + (cope ? 0.04 : 0), y - (cope ? 0.04 : 0)], ep),
    m(inner, [y - t, y], c), m(inner, [y - bD, y - bD + t], c), m(cope ? [e[0] + t, e[1] - t] : inner, [y - bD + t, y - t], w),
  ];
  const d: Unit[] = [];
  const py: Range = [y - bD + (cope ? 0.04 : 0), y - (cope ? 0.04 : 0)];
  for (const [e0, s] of [[e[0], 1], [e[1], -1]] as [number, number][]) {
    const plate: Range = s > 0 ? [e0, e0 + 0.015] : [e0 - 0.015, e0];
    d.push(u(m(plate, py, ep), PRIMER, 'paint'));
    const nut: Range = s > 0 ? [e0 + 0.015, e0 + 0.038] : [e0 - 0.038, e0 - 0.015];
    for (const yy of [py[1] - 0.06, (py[0] + py[1]) / 2, py[0] + 0.06]) for (const cc of [at - pw + 0.025, at + pw - 0.025]) d.push(u(m(nut, [yy - 0.016, yy + 0.016], [cc - 0.016, cc + 0.016]), 0x3a3d40, undefined, 7850));
  }
  d.push(...parts.slice(2).map((q) => u({ ...q }, PRIMER, 'paint')));
  const p = weldParts(parts, { section: { kind: 'I', t: 0.0102, tw: 0.006, axis: axis === 'x' ? 0 : 2, depth: 1 }, joint: { kind: 'bolt', n: 4, d: 0.02, grade: '8.8', preload: 0.3 } });
  p.tint = PRIMER;
  p.finish = 'paint';
  return withDetail(p, d);
}

/* composite deck over x × z at level y, its trapezoidal ribs spanning along x between the Z beams at 300 mm: the
   pans, crests and webs as units; `cast` adds the concrete topping (then the member is concrete, the deck its soffit) */
function deck(x: Range, z: Range, y: number, cast: boolean): PieceSpec {
  const top = y + (cast ? 0.19 : 0.06);
  const p = block(cast ? 'rconcrete' : 'metal', x, [y, top], z, { tint: cast ? CON : GALV });
  const d: Unit[] = [];
  for (let zz = z[0]; zz < z[1] - 0.05; zz += 0.3) {
    const z1 = Math.min(zz + 0.3, z[1]);
    const pan: Range = [zz + 0.001, Math.min(zz + 0.12, z1)], crest: Range = [Math.min(zz + 0.15, z1), Math.min(zz + 0.27, z1)];
    d.push(u(block('metal', x, [y, y + 0.0115], pan), SOFFIT, 'paint', 900));
    if (crest[1] - crest[0] > 0.02) d.push(u(block('metal', x, [y + 0.0485, y + 0.06], crest), SOFFIT, 'paint', 900));
    for (const wz of [zz + 0.132, zz + 0.285]) if (wz + 0.011 < z1) d.push(u(block('metal', x, [y, y + 0.06], [wz, wz + 0.011]), 0x8a9bb4, 'paint', 900));
  }
  if (cast) for (const xr of [[x[0], (x[0] + x[1]) / 2], [(x[0] + x[1]) / 2, x[1]]] as Range[]) d.push(u(block('rconcrete', [xr[0] + 0.001, xr[1] - 0.001], [y + 0.061, top], z), CON));
  return withDetail(p, d);
}

/** Steel frame going up: a 15 × 9 m UC/UB frame of two 7.5 m bays by one 9 m span on its pad foundations, two storeys
    of UC 254 columns erected with their heads left long for the next lift's splices; the first floor's UB 457 beams
    all in (bolted end plates, bolts and nuts as detail: along X onto the column flanges, along Z coped onto the column
    webs, a secondary beam at mid-bay coped onto the edge beams' webs), the first floor decked (one bay cast, one bare
    trapezoidal deck spanning between the Z beams) with a decking bundle landed on the bare bay; the second floor's
    back-line beams and the west gable beam in; temporary X-bracing (primed angles) in the back line and the west gable;
    edge protection along the open first-floor front; the next delivery (UBs on timber bearers, a decking bundle). */
export function frameUnderConstruction(p: Placement): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const h = cw / 2, fh = bB / 2;
  for (const x of xs) for (const z of zs) ps.push(column(x, z, 2 * S + 0.7));
  for (const z of zs) for (let i = 0; i + 1 < xs.length; i++) ps.push(beam('x', [xs[i] + h, xs[i + 1] - h], S, z));
  for (const x of xs) ps.push(beam('z', [zs[0] + h, zs[1] - h], S, x, h - 0.02));
  // secondary beams at mid-bay, coped onto the edge beams' webs
  for (let i = 0; i + 1 < xs.length; i++) ps.push(beam('z', [zs[0] + fh, zs[1] - fh], S, (xs[i] + xs[i + 1]) / 2, fh - 0.02));
  // second floor: the back-line beams and the west gable beam are in
  for (let i = 0; i + 1 < xs.length; i++) ps.push(beam('x', [xs[i] + h, xs[i + 1] - h], 2 * S, zs[0]));
  ps.push(beam('z', [zs[0] + h, zs[1] - h], 2 * S, xs[0], h - 0.02));
  const dz: Range = [zs[0] + h + 0.005, zs[1] - h - 0.005];
  ps.push(deck([xs[0] - fh, xs[1]], dz, S, true), deck([xs[1], xs[2] + fh], dz, S, false));
  // decking bundle landed on the bare bay, on bearers
  ps.push(bundle([1.5, 5.6], [-1.0, 0.1], S + 0.06, 0.32, true));
  // temporary X-bracing: two primed angles in each braced bay, one each side of the column centreline
  const brace = (a: Vec3, b: Vec3, dep: Vec3) => ({ ...member('steel', a, b, PROF.angle(0.12, 0.012), { cut: 'plumb', depth: dep }), tint: PRIMER, finish: 'paint' as const });
  const y0 = 0.35, y1 = S - bD - 0.12;
  ps.push(brace([xs[0] + h, y0, zs[0] - 0.06], [xs[1] - h, y1, zs[0] - 0.06], [0, 0, 1]), brace([xs[0] + h, y1, zs[0] + 0.06], [xs[1] - h, y0, zs[0] + 0.06], [0, 0, 1]));
  // gable: seen end-on the UC shows only its flange tips, so these lap onto the outer and inner flange faces instead
  const yg = y1 - 0.1;
  ps.push(brace([xs[0] - h - 0.06, y0, zs[0] - h], [xs[0] - h - 0.06, yg, zs[1] + h], [1, 0, 0]), brace([xs[0] + h + 0.06, yg, zs[0] - h], [xs[0] + h + 0.06, y0, zs[1] + h], [1, 0, 0]));
  // edge protection along the open front edge of the first floor, on the edge beams bay by bay
  for (let i = 0; i + 1 < xs.length; i++) ps.push(guardrail([xs[i] + h + 0.02, xs[i + 1] - h - 0.02], [zs[1] - 0.05, zs[1] + 0.01], S));
  // next delivery on the ground: UBs on timber bearers, decking bundles
  ps.push(stack([-4.5, 1.5], 5.4));
  ps.push(bundle([2.2, 6.4], [5.5, 6.6], 0, 0.36, true));
  return put(ps, p, 'frame');
}

function bundle(x: Range, z: Range, y: number, h: number, bearers = false): PieceSpec {
  const y0 = bearers ? y + 0.1 : y;
  const p = block('metal', x, [y, y0 + h], z, { tint: GALV });
  const d: Unit[] = [];
  if (bearers) for (const bx of [x[0] + 0.4, (x[0] + x[1]) / 2, x[1] - 0.5]) d.push(u(block('wood', [bx, bx + 0.1], [y, y0], z), TIMBER, undefined, 500));
  for (let k = 0, yy = y0; yy + 0.06 <= y0 + h + 1e-6; yy += 0.06, k++) d.push(u(block('metal', [x[0] + (k % 2) * 0.02, x[1] - ((k + 1) % 2) * 0.02], [yy, yy + 0.058], [z[0] + 0.01, z[1] - 0.01]), k % 2 ? 0xa9b0b5 : GALV, 'paint', 1300));
  d.push(u(block('steel', [x[0] + 0.3, x[0] + 0.33], [y0, y0 + h], [z[0], z[0] + 0.01]), 0x2a5fa8, undefined, 7850));
  return withDetail(p, d);
}

/** Edge protection on the slab edge: posts at 2 m with top and mid rails and a toe board, one body. */
function guardrail(x: Range, z: Range, y: number): PieceSpec {
  const parts: PieceSpec[] = [block('steel', x, [y, y + 0.15], z)];
  const n = Math.max(1, Math.round((x[1] - x[0]) / 2));
  for (const r of [[0.45, 0.5], [1.0, 1.05]] as Range[]) parts.push(block('steel', x, [y + r[0], y + r[1]], z));
  for (let i = 0; i <= n; i++) {
    const px = x[0] + 0.03 + ((x[1] - x[0] - 0.06) * i) / n, pr: Range = [px - 0.03, px + 0.03];
    parts.push(block('steel', pr, [y + 0.15, y + 0.45], z), block('steel', pr, [y + 0.5, y + 1.0], z));
  }
  return weldParts(parts, { tint: 0xe0b020, finish: 'paint' });
}

/** Four UB 457s laid on two timber bearers, the next lift's steel waiting for the crane (their I ends show). */
function stack(x: Range, z0: number): PieceSpec {
  const parts: PieceSpec[] = [];
  for (const bx of [x[0] + 0.6, x[1] - 0.7]) parts.push(block('steel', [bx, bx + 0.1], [0, 0.1], [z0, z0 + 1.2]));
  const t = 0.04;
  for (let i = 0; i < 4; i++) {
    const c = z0 + 0.15 + i * 0.3, w: Range = [c - bB / 2 + 0.005, c + bB / 2 - 0.005];
    const y0 = 0.1;
    parts.push(block('steel', x, [y0, y0 + t], w), block('steel', x, [y0 + bD - t, y0 + bD], w), block('steel', x, [y0 + t, y0 + bD - t], [c - t / 2, c + t / 2]));
  }
  const p = weldParts(parts, { tint: PRIMER, finish: 'paint' });
  return withDetail(p, parts.map((q, i) => u({ ...q }, i < 2 ? TIMBER : PRIMER, i < 2 ? undefined : 'paint', i < 2 ? 500 : undefined)).map((q, i) => (i < 2 ? { ...q, mat: 'wood' as const } : q)));
}

export type { Vec3 };
