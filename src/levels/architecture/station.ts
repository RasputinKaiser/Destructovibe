import type { PieceSpec, Vec3 } from '../../types.ts';
import { partsVolume } from '../../destruction/compound.ts';
import { block, cyl, extrude, hollowStack, hull, pitchedRoof, place, prism, ringCourse, splitRange, stairs, wallRun, weldParts, type PieceOpts, type Range, type WallRunOpts } from '../kit.ts';
import { layerize, roofDetail, withDetail } from '../layers.ts';
import { band, canopy, hood, quoins } from '../facade.ts';
import { fit, pew } from '../interior.ts';
import { conduit, disc, lamp, LIGHT, pendant, streetLamp, supplyBox } from '../services.ts';
import { TINT } from '../structures.ts';
import { arcPt, finish, member, obox, PROF, sect, type Placement } from './common.ts';

/* Victorian railway terminus. A brick booking hall (Flemish-bonded, stone-dressed, a clock tower on its corner)
   fronts a 36 m train shed: seven wrought-iron lattice arch ribs springing from plate girders on cast-iron
   columns, purlins on the ribs, slate on the haunches and patent glazing over the crown. Four roads end at
   buffer stops on the concourse between two side platforms and an island; umbrella canopies carry the
   platforms out beyond the shed. Cast iron only ever works in compression (columns, capitals, brackets under
   load); the ribs, girders and purlins are wrought iron (riveted). Front of the booking hall faces +Z. */

const IRON = 0x3a4a44, CAST = 0x2f3534, GLAZE = 0xcfe0e6;

/* shed geometry: column lines x = ±18, rib springing on the girder tops */
const SPAN = 18, YS = 9.5, RISE = 13, NSEG = 16;
const R = (SPAN * SPAN + RISE * RISE) / (2 * RISE), YC = YS + RISE - R;
const RH = 1.0, RB = 0.36, TF = 0.08;
const RI = R - RH / 2, RO = R + RH / 2;
const PHI = Math.asin((YS - YC) / R);
const DA = (Math.PI - 2 * PHI) / NSEG;
const ang = (j: number) => PHI + j * DA;
const cutR = (r: number) => Math.asin((YS - YC) / r);
const RIBS = [-2, -10, -18, -26, -34, -42, -50];
const Z_END = -66;

/** One rib segment: inner and outer flanges, and a Warren pair of lattice bars (a solid-web springer at each foot). */
function ribSegment(j: number, z: number): PieceSpec {
  const zz: Range = [z - RB / 2, z + RB / 2];
  const lo = (r: number) => (j === 0 ? cutR(r) : ang(j));
  const hi = (r: number) => (j === NSEG - 1 ? Math.PI - cutR(r) : ang(j + 1));
  const band = (r0: number, r1: number, zr: Range): PieceSpec => {
    const pts: Vec3[] = [];
    for (const r of [r0, r1]) for (const a of [lo(r), hi(r)]) for (const zv of zr) pts.push(arcPt(0, YC, r, a, zv));
    return hull('steel', pts);
  };
  const parts: PieceSpec[] = [band(RI, RI + TF, zz), band(RO - TF, RO, zz)];
  const web: Range = [z - 0.03, z + 0.03];
  if (j === 0 || j === NSEG - 1) parts.push(band(RI + TF, RO - TF, [z - 0.02, z + 0.02]));
  else {
    const at = (r: number, u: number): Vec3 => {
      const a = arcPt(0, YC, r, ang(j), 0), b = arcPt(0, YC, r, ang(j + 1), 0);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, 0];
    };
    const bar = (r0: number, u0: Range, r1: number, u1: Range): PieceSpec => {
      const pts: Vec3[] = [];
      for (const [r, us] of [[r0, u0], [r1, u1]] as [number, Range][]) for (const u of us) for (const zv of web) { const p = at(r, u); pts.push([p[0], p[1], zv]); }
      return hull('steel', pts);
    };
    parts.push(bar(RI + TF, [0, 0.12], RO - TF, [0.38, 0.5]), bar(RO - TF, [0.5, 0.62], RI + TF, [0.88, 1]));
  }
  const seg = weldParts(parts);
  // riveted wrought iron: two 150 × 150 angles and a 360 × 16 plate per flange, lattice flats — ~190 kg/m
  seg.density = Math.round((190 * R * DA) / partsVolume(seg.parts!));
  seg.tint = IRON;
  seg.joint = { kind: 'rivet', n: 24, d: 0.022 };
  return seg;
}

function shed(): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const iron: PieceOpts = { tint: IRON, joint: { kind: 'rivet', n: 12, d: 0.022 } }, cast: PieceOpts = { tint: CAST };
  for (const z of RIBS) for (let j = 0; j < NSEG; j++) ps.push(ribSegment(j, z));
  // cast-iron columns on stone pads, capitals, riveted plate girders along each column line
  for (const s of [-1, 1]) {
    const x = s * SPAN;
    for (const z of RIBS) {
      ps.push(block('stone', [x - 0.4, x + 0.4], [0, 0.9], [z - 0.4, z + 0.4], { tint: TINT.stone }));
      for (const y of [[0.9, 4.45], [4.45, 8.0]] as Range[]) ps.push(prism('castiron', 0.45, y, x, z, 16, cast));
      ps.push(weldParts([prism('castiron', 0.62, [8.0, 8.3], x, z, 16, cast), block('castiron', [x - 0.4, x + 0.4], [8.3, 8.6], [z - 0.4, z + 0.4], cast)]));
    }
    for (let k = 0; k + 1 < RIBS.length; k++) {
      ps.push(sect('steel', [x - 0.225, x + 0.225], [8.6, YS], [RIBS[k + 1], RIBS[k]], { kind: 'I', t: 0.025, tw: 0.012, depth: 1 }, iron));
    }
  }
  // purlins and roof: one purlin per rib segment on its outer flange, slate or patent glazing on each
  const hc = Math.cos(DA / 2);
  for (let k = 0; k + 1 < RIBS.length; k++) {
    const z1 = RIBS[k] + (k === 0 ? RB / 2 : 0), z0 = RIBS[k + 1] - (k + 2 === RIBS.length ? RB / 2 : 0);
    for (let j = 0; j < NSEG; j++) {
      const am = (ang(j) + ang(j + 1)) / 2, n: Vec3 = [Math.cos(am), Math.sin(am), 0], e: Vec3 = [-Math.sin(am), Math.cos(am), 0];
      const hs = RO * hc, pc = (d: number, zv: number): Vec3 => [n[0] * d, YC + n[1] * d, zv];
      ps.push(member('steel', pc(hs + 0.15, RIBS[k + 1]), pc(hs + 0.15, RIBS[k]), PROF.I(0.3, 0.15, 0.012, 0.008), { ...iron, depth: n }));
      const hb = hs + 0.3, glass = j >= 5 && j <= 10, th = glass ? 0.08 : 0.25;
      const pts: Vec3[] = [];
      for (const a of [ang(j), ang(j + 1)]) for (const d of [hb, hb + th]) for (const zv of [z0, z1]) pts.push(arcPt(0, YC, d / hc, a, zv));
      if (!glass) { ps.push(roofDetail(hull('roof', pts, { tint: TINT.slate }), { tile: 'slate' })); continue; }
      const half = hb * Math.tan(DA / 2) - 0.01, o = pc(hb, 0), fr: [Vec3, Vec3, Vec3] = [e, [0, 0, 1], n];
      const units: PieceSpec[] = [];
      const bars: number[] = [];
      for (let zv = Math.ceil((z0 + 0.03) / 0.6) * 0.6; zv < z1 - 0.03; zv += 0.6) bars.push(zv);
      for (const zb of bars) units.push(obox('steel', o, fr, [[-half, half], [zb - 0.025, zb + 0.025], [0, th]], { tint: IRON }));
      const edges = [z0, ...bars, z1];
      for (let i = 0; i + 1 < edges.length; i++) {
        const za = edges[i] + (i === 0 ? 0.005 : 0.025), zb = edges[i + 1] - (i + 2 === edges.length ? 0.005 : 0.025);
        if (zb - za < 0.1) continue;
        for (const eh of [[-half, -0.002], [0.002, half]] as Range[]) units.push(obox('glass', o, fr, [eh, [za, zb], [th / 2 - 0.003, th / 2 + 0.003]], { tint: GLAZE }));
      }
      ps.push(withDetail(hull('glass', pts, { tint: GLAZE }), units));
    }
  }
  return ps;
}

/** Roads, platforms and buffer stops; umbrella canopies on the platform ends beyond the shed. */
function roads(): PieceSpec[] {
  const ps: PieceSpec[] = [];
  const bays = splitRange(Z_END, -8, 8.3);
  const deck = { tint: 0x55575a }, cope = { tint: 0xd8d0bd }, fill = { tint: TINT.brickDark };
  const platforms: [Range, number[]][] = [[[-17.6, -11.4], [-11.4]], [[-5, 5], [-5, 5]], [[11.4, 17.6], [11.4]]];
  for (const z of bays) {
    for (const [x, edges] of platforms) {
      ps.push(block('brick', x, [0, 0.75], z, fill));
      const cx: Range[] = edges.map((e) => (e < x[0] + 0.1 ? [e, e + 0.6] : [e - 0.6, e]) as Range);
      let a = x[0], b = x[1];
      for (const c of cx) { if (Math.abs(c[0] - a) < 1e-6) a = c[1]; else b = c[0]; ps.push(block('stone', c, [0.75, 0.9], z, cope)); }
      ps.push(block('asphalt', [a, b], [0.75, 0.9], z, deck));
    }
  }
  // ballast beds with their sleepers as detail, bullhead rails in 16 m lengths, buffer stops against the concourse
  for (const c of [-9.95, -6.45, 6.45, 9.95]) {
    for (const z of splitRange(Z_END, -8, 14.5)) {
      const zr: Range = [z[0], Math.min(z[1], -8.35)];
      const bed = block('stone', [c - 1.4, c + 1.4], [0, 0.3], z, { tint: 0x8d8778 });
      const sl: PieceSpec[] = [];
      for (let zz = Math.ceil((z[0] + 0.2) / 0.7) * 0.7; zz < z[1] - 0.2; zz += 0.7) sl.push(block('wood', [c - 1.3, c + 1.3], [0.17, 0.3], [zz - 0.125, zz + 0.125], { tint: 0x5a4a3c }));
      ps.push(withDetail(bed, sl));
      for (const r of [c - 0.7175, c + 0.7175]) ps.push({ ...block('steel', [r - 0.035, r + 0.035], [0.3, 0.45], zr, { tint: 0x6f665c }), section: { kind: 'I', t: 0.04, tw: 0.02, depth: 1 } });
    }
    ps.push(block('castiron', [c - 1.0, c + 1.0], [0.3, 1.25], [-8.35, -8], { tint: 0xa8332b }));
    for (const s of [-1, 1]) ps.push(disc('steel', 'z', [c + s * 0.87, 1.0, -8.5], 0.2, 0.3, { tint: 0x3a3d40 }, 12));
  }
  // concourse made ground, flush with the platforms
  for (const x of splitRange(-17.6, 17.6, 8.8)) ps.push(block('concrete', x, [0, 0.9], [-8, -0.06], { tint: 0xb5ad9d }));
  // umbrella canopies: cast-iron column, bracketed head beam across the platform, boarded roof, fretted valance
  const canopies: [number, Range][] = [[-16.8, [-17.6, -11.5]], [0, [-4.9, 4.9]], [16.8, [11.5, 17.6]]];
  for (const [cxp, span] of canopies) {
    const heads: number[] = [-54, -62];
    for (const zc of heads) {
      ps.push(prism('castiron', 0.3, [0.9, 4.0], cxp, zc, 16, { tint: CAST }));
      const head = weldParts([
        block('castiron', [span[0], span[1]], [4.0, 4.3], [zc - 0.15, zc + 0.15]),
        extrude('castiron', [[cxp - 0.15, 3.3], [cxp - 0.15, 4.0], [cxp - 1.4, 4.0]], 'z', [zc - 0.06, zc + 0.06]),
        extrude('castiron', [[cxp + 0.15, 3.3], [cxp + 0.15, 4.0], [cxp + 1.4, 4.0]], 'z', [zc - 0.06, zc + 0.06]),
      ].filter((q) => q.pos[0] - q.size[0] / 2 >= span[0] - 1e-6 && q.pos[0] + q.size[0] / 2 <= span[1] + 1e-6));
      head.tint = CAST;
      ps.push(head);
    }
    for (const z of [[-66, -58], [-58, -50.2]] as Range[]) ps.push(block('wood', span, [4.3, 4.42], z, { tint: 0x7a6a58 }));
    for (const e of span) ps.push(block('wood', e === span[0] ? [e - 0.05, e] : [e, e + 0.05], [3.95, 4.42], [-66, -50.2], { tint: 0xe9e1cf }));
  }
  // platform lamps (each on its own feeder)
  for (const [x, z, q] of [[-14.5, -30, 0], [0, -20, 0], [0, -40, 2], [14.5, -30, 2]] as [number, number, number][]) {
    for (const p of place(streetLamp(4.5, 0.6, LIGHT.warm), x, z, q)) ps.push({ ...p, pos: [p.pos[0], p.pos[1] + 0.9, p.pos[2]] });
  }
  return ps;
}

/* ---------------- booking hall ---------------- */

const HX = 20, HZ = 14, T = 0.45, L1: Range = [0, 5.4], L2: Range = [5.4, 10.5];

function bookingHall(): PieceSpec[] {
  const brick = { tint: 0xb0664a }, stone = { tint: TINT.stone };
  const wall = (w: Partial<WallRunOpts> & { from: number; to: number; at: number; y0: number; h: number }): PieceSpec[] =>
    wallRun({ mat: 'brick', t: T, maxW: 2.6, sill: 'stone', lintel: 'stone', lintelH: 0.3, ...brick, ...w } as WallRunOpts);
  const win = (c: number, y0: number, h: number, w = 1.4) => ({ c, w, y0, h });
  const door = (c: number, w: number, h: number) => ({ c, w, y0: 0.9, h, glass: false });
  const wingC = [-17.5, -14, -10.5, 10.5, 14, 17.5], hallC = [-4.5, 0, 4.5];
  const ps: PieceSpec[] = [], face: PieceSpec[] = [];
  // front and back (the back opens on the concourse); the hall's tall windows run through both lifts
  for (const [at, out] of [[HZ - T / 2, 1], [T / 2, -1]] as const) {
    const front = out > 0, dst = front ? face : ps;
    dst.push(...wall({ from: -HX, to: HX, at, out, y0: L1[0], h: L1[1] - L1[0],
      openings: [...wingC.map((c) => win(c, 1.8, 2.6)), ...hallC.map((c) => door(c, front ? 2.4 : 3.0, front ? 3.2 : 3.6))] }));
    dst.push(...wall({ from: -HX, to: HX, at, out, y0: L2[0], h: L2[1] - L2[0],
      openings: [...wingC.map((c) => win(c, 1.2, 2.2)), ...hallC.map((c) => win(c, 0.6, 3.6, 2.4))] }));
  }
  for (const s of [-1, 1] as const) {
    const side = { axis: 'z' as const, from: T, to: HZ - T };
    ps.push(...wall({ ...side, at: s * (HX - T / 2), out: s, y0: L1[0], h: L1[1] - L1[0], openings: (s > 0 ? [4] : [4, 10]).map((c) => win(c, 1.8, 2.6)) }));
    ps.push(...wall({ ...side, at: s * (HX - T / 2), out: s, y0: L2[0], h: L2[1] - L2[0], openings: (s > 0 ? [4] : [4, 10]).map((c) => win(c, 1.2, 2.2)) }));
    // cross walls between the hall and the wings
    ps.push(...wall({ ...side, at: s * 8, y0: L1[0], h: L1[1] - L1[0], sill: undefined, openings: [door(7, 1.2, 2.1)] }));
    ps.push(...wall({ ...side, at: s * 8, y0: L2[0], h: L2[1] - L2[0], sill: undefined, openings: [{ c: 7, w: 1.0, y0: 0.3, h: 2.1, glass: false }] }));
    // wing spine (corridor) wall and first floor on it
    const wx: Range = s < 0 ? [-HX + T, -8 - T / 2] : [8 + T / 2, HX - T];
    ps.push(...wallRun({ mat: 'brick', from: wx[0], to: wx[1], at: 7, t: 0.225, y0: 0.9, h: L1[1] - 0.9, maxW: 3.2, ...brick,
      openings: [{ c: s * 14, w: 0.9, y0: 0, h: 2.1, glass: false }] }));
    for (const x of splitRange(wx[0], wx[1], 4)) for (const z of [[T, 7], [7, HZ - T]] as Range[]) ps.push(block('plywood', x, [L1[1], L1[1] + 0.3], z, { tint: 0xa98b66 }));
    // made-ground floor of the wing
    for (const x of splitRange(wx[0], wx[1], 6)) for (const z of [[T, 7], [7, HZ - T]] as Range[]) ps.push(block('concrete', x, [0, 0.9], z, { tint: 0xa9a293 }));
  }
  for (const x of splitRange(-8 + T / 2, 8 - T / 2, 5.3)) for (const z of [[T, 7], [7, HZ - T]] as Range[]) {
    ps.push(withDetail(block('concrete', x, [0, 0.9], z, { tint: 0xa9a293 }),
      splitRange(x[0], x[1], 0.6).flatMap((u) => splitRange(z[0], z[1], 0.6).map((v) => block('stone', [u[0] + 0.003, u[1] - 0.003], [0.84, 0.9], [v[0] + 0.003, v[1] - 0.003], { tint: (Math.round(u[0] / 0.6) + Math.round(v[0] / 0.6)) & 1 ? 0xd9d1c0 : 0x8f5a48 })))));
  }
  // the street front is laid brick by brick (Flemish bond); the other walls stay plain members to hold the budget
  const out: PieceSpec[] = [...layerize(face, { brick: 'solid', maxUnits: 3200 }), ...ps.map((q) => (q.mat === 'plywood' ? layerize([q], { timber: true })[0] : q))];
  // slate roof on king-post trusses, brick gables at both ends and fire gables over the cross walls
  out.push(...pitchedRoof({ mat: 'roof', x: [-HX - 0.3, HX], z: [0, HZ], y: L2[1], rise: 5.2, thick: 0.34, seat: 0.3, maxW: 4.2, tint: TINT.slate,
    gables: { mat: 'brick', x: [[-HX, -HX + T], [-8 - T / 2, -8 + T / 2], [8 - T / 2, 8 + T / 2], [HX - T, HX]], tint: brick.tint } }).map((q) => q.mat === 'roof' && q.size[1] > 1 ? roofDetail(q, { tile: 'slate' }) : q));
  {
    const zi = HZ - T, h = L2[1], kk = 5.2 / (HZ / 2 - 0.3), under = (dz: number) => h + kk * (HZ / 2 - 0.3 - dz), oak = { tint: TINT.woodDark };
    for (const x of [-4.8, -1.6, 1.6, 4.8]) {
      const xr: Range = [x - 0.12, x + 0.12];
      out.push(block('oak', [x - 0.15, x + 0.15], [h - 0.35, h], [T, zi], oak), block('oak', xr, [h, under(0.12)], [HZ / 2 - 0.12, HZ / 2 + 0.12], oak));
      for (const s of [-1, 1]) out.push(extrude('oak', [[HZ / 2 + s * (zi - HZ / 2), h], [HZ / 2 + s * (zi - HZ / 2), under(zi - HZ / 2)], [HZ / 2 + s * 0.12, under(0.12)], [HZ / 2 + s * 0.12, under(0.12) - 0.35]], 'x', xr, oak));
    }
  }
  // stone dressings: plinth, first-floor string course, cornice, quoins, hood moulds over the hall openings
  for (const [face, out_] of [[HZ, 1], [0, -1]] as const) {
    out.push(...band({ mat: 'stone', face, out: out_, from: -HX, to: HX, y: [5.2, 5.5], depth: 0.1, profile: 'drip', ...stone }));
    out.push(...band({ mat: 'stone', face, out: out_, from: -HX, to: HX, y: [10.1, L2[1]], depth: 0.25, profile: 'cornice', ...stone }));
    for (const c of hallC) out.push(...hood({ face, out: out_ }, [c - 1.2, c + 1.2], L2[0] + 4.2, { ...stone, rise: 0.2 }));
    for (const [u, d] of [[-HX, 1], [HX, -1]] as const) out.push(...quoins({ face, out: out_ }, u, d, [0.3, 5.2], 7, stone), ...quoins({ face, out: out_ }, u, d, [5.5, 10.1], 7, stone));
  }
  out.push(...canopy({ face: HZ }, [-6.2, 6.2], 4.4, 2.6, { mat: 'metal', brackets: true, tint: CAST }));
  // entrance steps up to the hall floor
  for (const c of hallC) for (let i = 0; i < 5; i++) out.push(block('stone', [c - 1.4, c + 1.4], [0, 0.18 * (i + 1)], [HZ + 1.56 - 0.3 * (i + 1), HZ + 1.56 - 0.3 * i], stone));
  // interior: booking-office counter and glazed screen, benches, a supply box feeding pendants from the tie beams
  out.push(block('oak', [-6.5, -1.5], [0.9, 2.0], [3.0, 3.8], { tint: TINT.woodDark }), block('glass', [-6.5, -1.5], [2.0, 3.1], [3.37, 3.43], { tint: 0xd8e4e6 }));
  out.push(block('oak', [1.5, 6.5], [0.9, 2.0], [3.0, 3.8], { tint: TINT.woodDark }), block('glass', [1.5, 6.5], [2.0, 3.1], [3.37, 3.43], { tint: 0xd8e4e6 }));
  for (const x of [-4, 4]) for (const z of [8.4, 10.6]) out.push(...fit(pew(3.0), x, z, 0.9, 0));
  out.push(supplyBox([-8 + T / 2, -8 + T / 2 + 0.25], [1.4, 2.2], [11.0, 11.6]));
  out.push(...conduit([[-7.65, 2.2, 11.3], [-7.65, 10.11, 11.3], [-7.65, 10.11, 7], [4.8, 10.11, 7]]));
  for (const x of [-4.8, -1.6, 1.6, 4.8]) out.push(...pendant(x, 7, 10.07, 2.2, LIGHT.warm, 0.5));
  return out;
}

/** Clock tower on the booking hall's east corner: brick shaft, four dials, open belfry, slated pyramid, finial. */
function clockTower(): PieceSpec[] {
  const cx = HX + 2.7, cz = HZ - 2.7, brick = { tint: 0xb0664a }, stone = { tint: TINT.stone };
  const ps: PieceSpec[] = [...hollowStack('brick', cx, cz, 0, 5.4, 0.6, 2.5, 10, brick)];
  ps.push(...hollowStack('stone', cx, cz, 25, 5.4, 0.6, 0.4, 1, stone), ...hollowStack('brick', cx, cz, 25.4, 5.4, 0.6, 3.6, 1, brick));
  for (const [ax, dx, dz] of [['z', 0, 1], ['z', 0, -1], ['x', 1, 0], ['x', -1, 0]] as ['x' | 'z', number, number][]) {
    const c: Vec3 = [cx + dx * 2.76, 27.2, cz + dz * 2.76];
    ps.push(disc('castiron', ax, c, 1.15, 0.12, { tint: 0xf4efe2 }, 24));
    const face: Range = [2.82, 2.88], v = (k: number, r: Range): Range => (k > 0 ? [r[0], r[1]] : [-r[1], -r[0]]);
    const hx: Range = ax === 'x' ? v(dx, face).map((q) => cx + q) as Range : [c[0] - 0.035, c[0] + 0.035];
    const hz: Range = ax === 'z' ? v(dz, face).map((q) => cz + q) as Range : [c[2] - 0.035, c[2] + 0.035];
    ps.push(block('steel', hx, [27.2, 28.1], hz, { tint: 0x1c1c1c }));
  }
  ps.push(...hollowStack('stone', cx, cz, 29, 5.4, 0.6, 0.4, 1, stone));
  const corner = (c: number, s: number): Range => (s > 0 ? [c + 1.6, c + 2.7] : [c - 2.7, c - 1.6]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.push(block('brick', corner(cx, sx), [29.4, 33], corner(cz, sz), brick));
  ps.push(...hollowStack('stone', cx, cz, 33, 5.8, 1.0, 0.45, 1, stone));
  ps.push(...ringCourse('roof', cx, cz, [33.45, 40.5], [2.9 * Math.SQRT2 - 0.45, 0], [2.9 * Math.SQRT2, 0.12], 4, { tint: TINT.slate }, Math.PI / 4));
  ps.push(prism('steel', 0.16, [40.5, 42.8], cx, cz, 8, { tint: 0x2b2f31 }));
  return ps;
}

/** Victorian terminus: booking hall and clock tower (front +Z), 36 m arched train shed and four platform roads behind. */
export function railwayStation(p: Placement): PieceSpec[] {
  const ps = [...bookingHall(), ...clockTower(), ...shed(), ...roads()];
  return finish(ps, p, 'station', { years: 140, exposure: 'outdoor' });
}
