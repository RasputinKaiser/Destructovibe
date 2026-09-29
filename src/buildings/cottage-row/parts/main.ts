import type { JointSpec, PieceSpec } from '../../../types.ts';
import { block, extrude, type Opening, type Range, type WallRunOpts } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { band } from '../../../levels/facade.ts';
import { conduit, lamp, LIGHT, supplyBox } from '../../../levels/services.ts';
import { type Placement, TINT } from '../../_shared/base.ts';
import { put } from '../../_shared/structures-helpers.ts';
import { bond, brickRun, door, lime, type LimeOpts, PAINT, sash, timberDeck } from '../../_shared/vernacular.ts';
import { gableCourses, pitchRoof, roofUnits, type RoofStack } from '../../_shared/roofs.ts';
import { mulTint, shadeTint, vary } from '../../_shared/tints.ts';

/** Byelaw terrace of two-up two-down brick cottages, front +Z (c. 1890). Solid 9-inch (225 mm) walls in Flemish bond
    with darker burnt headers, lime plaster inside, stone lintels and sills, tall two-over-two sashes and four-panel
    doors with fanlights, the doors paired at alternate party walls.
    Load path: every wall is continuous brick down to the ground — the party walls are built in two lifts, the upper
    standing on the lower; the first floor and the ceiling joists butt the wall faces (their pockets); the slate roof
    (~38°) seats on the front and back walls and leans on brick gable triangles on the party walls; the stacks rise from
    the flue-carrying party walls and end gables through the roof (slopes and gables are cut back round them), so a
    stack stands on the wall below it and falls with it. Each front room has a chimney breast bonded into its flue wall;
    boarded floors and lath-and-plaster ceilings. The 'terrace' row is red brick with dark doors and tall red pots; any
    other row has rendered fronts painted a different colour per house over a dark plinth, buff side and back brick,
    painted doors and short buff pots. Behind, a single-storey
    scullery outrigger per house with a lean-to slate roof, paired against a shared wall that rises above both roofs. */
/* the joist ends sit in pockets and are nailed to wall plates; a butt-jointed party wall is held to the front wall by
   a few wall ties */
const JOISTS: JointSpec = { kind: 'nail', n: 12, d: 0.0045 }, TIES: JointSpec = { kind: 'nail', n: 6, d: 0.004 };

export function cottageRow(p: Placement & { count?: number; protected?: boolean }): PieceSpec[] {
  const n = p.count ?? 3, bay = 4.8, X = (n * bay) / 2, Z = 3.4, t = 0.23;
  const f1 = 2.95, fd = 0.22, jb = f1 - fd, eave = 5.55, g0 = 0.15, rise = 2.45;
  const seed = Math.abs(Math.round((p.x ?? 0) * 7 + (p.z ?? 0) * 3));
  const red = p.group === 'terrace';
  const brickTint = red ? [0xb05a44, 0xa04c3a][seed % 2] : 0xdcb892;
  const doorTints = red ? [PAINT.maroon, PAINT.black, PAINT.green, 0x2a3a52] : [0x6f8fae, 0x8fae8a, PAINT.cream, 0xb56a4a, 0x5b6e3a];
  const pots = red ? { potTint: 0xb85a3a, potD: 0.22, potH: 0.75 } : { potTint: 0xd8b888, potD: 0.2, potH: 0.45 };
  const brick = { mat: 'brick' as const, tint: brickTint, lintel: 'stone' as const, sill: 'stone' as const, maxW: 2.4 };
  const centres = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? -X + t / 2 : i === n ? X - t / 2 : -X + i * bay));
  const lf = (i: number) => centres[i] + t / 2, rf = (i: number) => centres[i + 1] - t / 2;
  const doorRight = (i: number) => i % 2 === 0;
  const ps: PieceSpec[] = [];
  /* a wallRun, split round its service patches, glazed, and given its courses */
  const run = (w: WallRunOpts, out: 1 | -1, lo: LimeOpts = {}, patches: [number, number][] = []) =>
    brickRun(w, out, { burnt: true, dress: (g) => sash(g, PAINT.white), patches, ...lo });
  const fronts: Opening[] = [], frontsUp: Opening[] = [], backs: Opening[] = [], backsUp: Opening[] = [];
  const leafs: { u: Range; tint: number }[] = [];
  const meters: number[] = [];
  const O = { w: 2.4, d: 2.1, hi: 3.25, lo: 2.45 };   // outrigger: width, depth, party-side and yard-side wall heights
  for (let i = 0; i < n; i++) {
    const a = lf(i), b = rf(i), dr = doorRight(i);
    const dc = dr ? b - 0.65 : a + 0.65, wc = dr ? a + 1.5 : b - 1.5;
    fronts.push({ c: dc, w: 0.9, y0: 0, h: 2.45 }, { c: wc, w: 1.1, y0: 0.7, h: 1.75 });
    frontsUp.push({ c: wc, w: 1.0, y0: 0.75, h: 1.45 }, { c: dc, w: 0.7, y0: 0.75, h: 1.45 });
    leafs.push({ u: [dc - 0.45, dc + 0.45], tint: doorTints[(i + seed) % doorTints.length] });
    meters.push(dr ? b - 1.55 : a + 1.55);
    const oc = dr ? b - 0.75 : a + 0.75, bc = dr ? a + 1.4 : b - 1.4;
    backs.push({ c: oc, w: 0.8, y0: 0, h: 2.0, glass: false }, { c: bc, w: 1.0, y0: 0.9, h: 1.4 });
    backsUp.push({ c: bc, w: 0.9, y0: 0.8, h: 1.35 }, { c: oc - (dr ? 0.35 : -0.35), w: 0.7, y0: 0.9, h: 1.1 });
  }
  /* any row but the red 'terrace' has its fronts rendered and painted, each house its own colour over a dark
     painted plinth (the render units are laid white, then tinted per house) */
  const paints = [0xf4e9c9, 0xc6dcc0, 0xf4cfb2, 0xc4d3ea, 0xf6e59c, 0xebc6c6];
  const paint = (q: PieceSpec[]): PieceSpec[] => {
    if (red) return q;
    for (const m of q) for (const u of m.detail ?? []) {
      if (u.mat !== 'concrete' || u.tint === undefined) continue;
      const house = Math.min(n - 1, Math.max(0, Math.floor((u.pos[0] + X) / bay)));
      u.tint = u.pos[1] < 0.42 ? shadeTint(vary(0x45423f, u, 0.06, 3), 1) : mulTint(u.tint, paints[(house + seed) % paints.length]);
    }
    return q;
  };
  const face: LimeOpts = red ? {} : { render: 0xffffff };
  // front and back walls, one run per storey; the meter's service is sleeved through a patch beside each front door
  for (const [s, lo, up] of [[1, fronts, frontsUp], [-1, backs, backsUp]] as const) {
    const at = s * (Z - t / 2), f = s > 0 ? face : {};
    ps.push(...paint(run({ ...brick, from: -X, to: X, at, t, y0: 0, h: f1, out: s, openings: lo }, s, f, s > 0 ? meters.map((m) => [m, 1.55] as [number, number]) : [])));
    ps.push(...paint(run({ ...brick, from: -X, to: X, at, t, y0: f1, h: eave - f1, out: s, openings: up }, s, f)));
  }
  for (const l of leafs) ps.push(door('x', l.u, [0, 2.45], [Z - t, Z], 1, { tint: l.tint, fan: 0.4 }));
  /* chimney breasts: each house's breast is on the side away from its door, corbelled from that wall; two cheeks and
     the breast over the fireplace opening, plastered */
  const breasts = new Map<number, PieceSpec[]>();
  const inner = { tint: brickTint, burnt: false };
  for (let i = 0; i < n; i++) {
    const dr = doorRight(i), bw = dr ? lf(i) : rf(i), j = dr ? i : i + 1, bx: Range = dr ? [bw, bw + 0.36] : [bw - 0.36, bw];
    breasts.set(j, [...(breasts.get(j) ?? []), ...lime([block('brick', bx, [0, jb], [0.7, 0.95], inner), block('brick', bx, [0, jb], [1.95, 2.2], inner),
      block('brick', bx, [0.95, jb], [0.95, 1.95], inner)], 1, { both: true, inset: 0 })]);
  }
  /* end gables full height; party walls in two lifts, the upper standing on the lower. A flue wall's ground lift is
     bonded with the breasts either side of it (one body over z 0.7–2.2), so they stand and fall with the wall. */
  const BZ: Range = [0.7, 2.2];
  for (let j = 0; j <= n; j++) {
    const end = j === 0 || j === n;
    const w = { ...brick, axis: 'z' as const, from: -Z + t, to: Z - t, at: centres[j], t, maxW: end ? 3.4 : 1.8, out: (j === n ? 1 : -1) as 1 | -1 };
    const lo = end ? { y0: 0, h: eave } : { y0: 0, h: f1 }, lopts: LimeOpts = end ? {} : { both: true, burnt: false }, out = end ? w.out : 1;
    const br = breasts.get(j);
    if (br) {
      ps.push(...run({ ...w, ...lo, to: BZ[0] }, out, lopts), ...run({ ...w, ...lo, from: BZ[1] }, out, lopts));
      ps.push(bond([...run({ ...w, ...lo, from: BZ[0], to: BZ[1] }, out, lopts), ...br]));
    } else ps.push(...run({ ...w, ...lo }, out, lopts));
    // byelaw party walls butt the front and back walls on a few ties: the upper lift stands on the lower, and hangs on
    // nothing else when the lower goes
    if (!end) ps.push(...run({ ...w, y0: f1, h: eave - f1 }, 1, { both: true, burnt: false }).map((q) => ({ ...q, joint: TIES })));
  }
  const zi: Range = [-Z + t, Z - t];
  const flues: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = lf(i), b = rf(i), dr = doorRight(i);
    // the breast is on the side away from the door; its wall carries the flue
    const bw = dr ? a : b, wallJ = dr ? i : i + 1;
    if (!flues.includes(wallJ)) flues.push(wallJ);
    const bx: Range = dr ? [bw, bw + 0.36] : [bw - 0.36, bw];
    // suspended ground floor (the strip along the breast is the hearth); first floor and ceiling joists butting the walls
    ps.push(timberDeck(block('plywood', dr ? [bx[1], b] : [a, bx[0]], [0, g0], zi, { tint: 0x8a6a4a }), { span: 'z', ceiling: false }));
    ps.push(timberDeck(block('plywood', [a, b], [jb, f1], zi, { tint: 0x9a7a58, joint: JOISTS }), { span: 'x' }));
    ps.push(timberDeck(block('plywood', [a, b], [eave - 0.15, eave], zi, { tint: 0xb89b72, joint: JOISTS }), { span: 'x', boards: false }));
    // meter and consumer unit behind the front door (its tail sleeved out through the patch), feeding the hall light
    const mx = meters[i], zf = Z - t;
    ps.push(supplyBox([mx - 0.2, mx + 0.2], [1.3, 1.8], [zf - 0.16, zf]));
    ps.push(...conduit([[mx, 1.8, zf - 0.08], [mx, jb - 0.04, zf - 0.08], [mx, jb - 0.04, 1.9]]));
    ps.push(lamp([mx - 0.2, mx + 0.2], [jb - 0.29, jb - 0.08], [1.75, 2.15], LIGHT.warm));
  }
  // scullery outriggers, paired on the door-side party walls
  const back = -Z;
  const pairs = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const j = doorRight(i) ? i + 1 : i; pairs.set(j, [...(pairs.get(j) ?? []), i]); }
  const oz: Range = [back - O.d, back], ozi: Range = [back - O.d + t, back];
  for (const [j, hs] of pairs) {
    const pc = centres[j], pt = t;
    // the shared wall on the party line, rising above both lean-to roofs
    ps.push(...run({ ...brick, axis: 'z', from: oz[0], to: oz[1], at: pc, t: pt, y0: 0, h: O.hi + 0.45, maxW: 3 }, 1, { burnt: false, bare: true }));
    for (const i of hs) {
      const s = i < j ? -1 : 1;                         // which side of the party line this house's outrigger lies
      const innerX = pc + s * pt / 2, outer = pc + s * O.w, yx = outer - s * t / 2;
      const xr: Range = s > 0 ? [innerX, outer] : [outer, innerX];
      ps.push(...run({ ...brick, axis: 'z', from: ozi[0], to: ozi[1], at: yx, t, y0: 0, h: O.lo, out: s as 1 | -1,
        openings: [{ c: (ozi[0] + ozi[1]) / 2, w: 0.7, y0: 1.0, h: 1.0 }] }, s as 1 | -1));
      const dx = s > 0 ? innerX + 0.6 : innerX - 0.6;
      ps.push(...run({ ...brick, from: xr[0], to: xr[1], at: oz[0] + t / 2, t, y0: 0, h: O.lo, out: -1, openings: [{ c: dx, w: 0.8, y0: 0, h: 2.0 }] }, -1));
      ps.push(door('x', [dx - 0.4, dx + 0.4], [0, 2.0], [oz[0], oz[0] + t], -1, { tint: PAINT.black, panels: 2 }));
      // lean-to roof: seated on the yard wall, rising to the party wall and abutting the house's back wall
      const runL = Math.abs(innerX - outer), k = (O.hi - O.lo) / (runL - t), th = 0.22;
      const yAt = (d: number) => O.lo + k * (d - t);
      const x = (d: number) => outer - s * d;
      const prof: [number, number][] = [[x(0), O.lo], [x(t), O.lo], [x(runL), yAt(runL)], [x(runL), yAt(runL) + th], [x(0), O.lo + th - k * t]];
      ps.push(roofUnits(extrude('roof', prof, 'z', [oz[0] - 0.06, back], { tint: 0x4f555d }), { cover: 'slate' }));
      // the gable infill over the end wall, under the slope, built of courses
      const inf = extrude('brick', [[x(t), O.lo], [x(runL), O.lo], [x(runL), yAt(runL)]], 'z', [oz[0], oz[0] + t], { tint: brickTint });
      ps.push(gableCourses(inf, 'z', [oz[0], oz[0] + t], x(t), x(runL), O.lo, yAt(runL), brickTint));
    }
  }
  // roof: bays broken at the party walls, stacks through it on the flue walls
  const stacks: RoofStack[] = flues.map((j) => {
    const end = j === 0 || j === n;
    return { x: end ? (j === 0 ? [-X, -X + 0.8] : [X - 0.8, X]) : [centres[j] - 0.45, centres[j] + 0.45], sz: 0.3, h: 1.0, pots: end ? 2 : 4, ...pots,
      neck: j === 0 ? [-X, -X + t] : j === n ? [X - t, X] : [centres[j] - t / 2, centres[j] + t / 2] } as RoofStack;
  });
  ps.push(...pitchRoof({ x: [-X - 0.08, X + 0.08], breaks: centres.slice(1, -1), z: [-Z, Z], y: eave, rise, thick: 0.3, seat: t, cover: 'slate', tint: red ? 0x4f555d : 0x5c6068, maxW: 1.2,
    ridgeTint: 0x8a4a3a, gableTint: brickTint, gables: centres.map((c, j) => (j === 0 ? [-X, -X + t] : j === n ? [X - t, X] : [c - t / 2, c + t / 2]) as Range), stacks }));
  // cast-iron gutters on both eaves, square cast-iron downpipes at the party walls
  for (const s of [1, -1] as const) ps.push(...band({ mat: 'castiron', face: s * Z, out: s, from: -X, to: X, y: [eave - 0.13, eave], depth: 0.12, tint: 0x24272a, maxW: 7.5 }));
  for (let j = 1; j < n; j++) ps.push(block('castiron', [centres[j] - 0.035, centres[j] + 0.035], [0, eave - 0.13], [Z, Z + 0.07], { tint: 0x24272a }));
  // stone step at each front door
  for (const l of leafs) ps.push(block('stone', l.u, [0, 0.12], [Z, Z + 0.3], { tint: TINT.stone }));
  return put(layerize(ps, { brick: 'solid', timber: true }), p, 'cottages', { protected: p.protected, age: { years: 130, exposure: 'outdoor' } });
}
