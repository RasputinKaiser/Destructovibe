import type { PieceSpec } from '../types.ts';
import { block, chamfer, curtains, cyl, envelopeFinish, extrude, place, splitRange, tag, wallRun, type Opening, type PieceOpts, type Range } from './kit.ts';
import { band, bay as bayWindow, downpipe, hood } from './facade.ts';
import {
  bar, bathroom, bed, bookcase, FURN, fit, joistFloor, kitchen, rafterRoof, sofa, stair, studWall, table, wardrobe, chair,
} from './interior.ts';
import { conduit, lamp, LIGHT, radiatorPanel, supplyBox, wallBoiler } from './services.ts';
import { gridFeed, type Placement } from './structures.ts';
import { layerize } from './layers.ts';

/* Buildings authored as their real construction systems, with interiors. Local metres, front +Z. */

function put(ps: PieceSpec[], p: Placement, fallback: string, extra: PieceOpts = {}): PieceSpec[] {
  return gridFeed(tag(place(envelopeFinish(ps), p.x, p.z, p.rot ?? 0), { group: p.group ?? fallback, ...extra }), p.gridFed);
}

const win = (c: number, w = 1.2, y0 = 0.9, h = 1.2): Opening => ({ c, w, y0, h });
const door = (c: number, w = 0.9, h = 2.05): Opening => ({ c, w, y0: 0, h, glass: false });

/** Two-storey platform-frame house, 8.4 x 6.6 m, on a ground-bearing slab: stud walls (plates, studs at 600,
    noggins, headers, sill trimmers) clad in weatherboard outside and plasterboard inside, joisted first floor
    with a trimmed stair well, stud partitions, a cut roof (plates, ridge board, rafters, purlins, ceiling joists,
    battens, tiles), and a furnished interior: kitchen, living room, stair, bathroom and two bedrooms. */
export function timberHouse(p: Placement & { cladTint?: number; roofTint?: number }): PieceSpec[] {
  const X = 4.2, Z = 3.3, W = 0.22, g0 = 0.15, h1 = 2.5, fl = 0.26, h2 = 2.4;
  const f1 = g0 + h1 + fl, eave = f1 + h2;
  const clad = { mat: 'wood' as const, tint: p.cladTint ?? 0xdfe3dc }, board = { tint: FURN.plaster };
  const ps: PieceSpec[] = [], fur: PieceSpec[] = [];
  ps.push(...splitRange(-X, X, 4.2).flatMap((x) => splitRange(-Z, Z, 3.3).map((z) => block('concrete', x, [0, g0], z, { tint: 0xb9b9b4 }))));
  const inb = { ...board, from: -X + W, to: X - W };
  const ext = (y0: number, h: number, front: Opening[], back: Opening[], left: Opening[], right: Opening[]) => {
    for (const [s, ops] of [[1, front], [-1, back]] as const) {
      ps.push(...studWall({ from: -X, to: X, at: s * (Z - 0.11), y0, h, openings: ops,
        liningPos: s > 0 ? clad : inb, liningNeg: s > 0 ? inb : clad }));
    }
    for (const [s, ops] of [[-1, left], [1, right]] as const) {
      ps.push(...studWall({ axis: 'z', from: -Z + 0.16, to: Z - 0.16, at: s * (X - 0.11), y0, h, openings: ops,
        liningPos: s > 0 ? clad : board, liningNeg: s > 0 ? board : clad }));
    }
  };
  // ground storey; the inner linings of the front/back walls stop at the side walls' linings
  // external doors 1.0 x 2.1 m
  ext(g0, h1, [door(-1.5, 1.0, 2.1), win(1.2, 1.4), win(3.0, 0.9)], [win(-1.85, 1.0, 1.0, 1.0), door(0.9, 1.0, 2.1), win(2.8)], [win(0.5, 1.0)], []);
  // first floor: joists across the depth, bearing on the front and back top plates; trimmed well over the stair
  const well = { x: [-4.0, -3.0] as Range, z: [-1.6, 1.1] as Range };
  ps.push(...joistFloor({ x: [-X + 0.05, X - 0.05], z: [-Z + 0.05, Z - 0.05], span: 'z', y: f1, depth: 0.2, pitch: 0.45, well,
    ceiling: { x: [-X + W, X - W], z: [-Z + W, Z - W] } }));
  ext(f1, h2, [win(-2.6, 1.1), win(0, 1.1), win(2.6, 1.1)], [win(-2.2, 0.8, 1.2, 0.8), win(2.6, 1.1)], [win(0.3, 0.9)], [win(-0.8, 0.9)]);
  // partitions: ground floor splits living room from hall and kitchen; upstairs a bedroom wall and a bathroom
  const inner = (y0: number, h: number) => ({ y0, h, t: 0.075, liningNeg: board, liningPos: board, noggins: false, pitch: 0.6 });
  ps.push(...studWall({ ...inner(g0, h1 - 0.05), axis: 'z', from: -Z + W, to: Z - W, at: 0.4, openings: [door(1.4, 0.9, 2.0)] }));
  const up = eave + 0.04 - f1;
  ps.push(...studWall({ ...inner(f1, up), axis: 'z', from: -Z + W, to: Z - W, at: 0.4, openings: [door(-2.3, 0.8, 2.0)] }));
  ps.push(...studWall({ ...inner(f1, up), from: -2.95, to: 0.3025, at: 0.45, openings: [door(-1.2, 0.8, 2.0)] }));
  ps.push(...rafterRoof({ x: [-X - 0.3, X + 0.3], gables: [[-X, -X + W], [X - W, X]], z: [-Z, Z], y: eave, rise: 2.4, pitch: 0.6,
    covering: { tint: p.roofTint ?? 0x6e5a48 }, gableTint: clad.tint, ceiling: { z: [-Z + 0.15, Z - 0.15] } }));
  ps.push(...stair({ axis: 'z', from: 2.0, to: -1.6, cross: [-X + W, -3.1], y0: g0, y1: f1, open: 'hi' }));
  // ground floor: kitchen on the back wall, table, living room
  const bi = -Z + W, fi = Z - W;
  fur.push(...fit(kitchen(2.1, { wallUnits: false }), -2.95, bi, g0));
  fur.push(...fit(table(1.2, 0.8), -1.6, -0.6, g0));
  for (const z of [-1.3, 0.1]) fur.push(...fit(chair(), -1.6, z, g0));
  fur.push(...fit(sofa(2.0), 2.3, bi + 0.45, g0), ...fit(table(1.0, 0.55, { tint: FURN.oak }), 2.3, -1.0, g0));
  fur.push(...fit(bookcase(), X - W - 0.2, 0.3, g0, 3), ...fit(bookcase(), 0.72, -2.2, g0, 1));
  // services: consumer unit by the front door, a pendant in the living room, combi boiler on a kitchen radiator
  ps.push(supplyBox([2.05, 2.45], [1.5, 2.1], [fi - 0.12, fi]), ...conduit([[2.25, 2.1, fi - 0.04], [2.25, 2.56, fi - 0.04], [2.25, 2.56, 0.5]]));
  ps.push(lamp([2.05, 2.45], [2.3, 2.52], [0.3, 0.7], LIGHT.warm));
  ps.push(wallBoiler([-0.75, -0.25], [1.3, 2.0], [bi, bi + 0.3]), radiatorPanel([-0.75, 0.3], [0.5, 1.3], [bi, bi + 0.1]));
  // first floor: bathroom at the front left, double bedroom right, single bedroom back left
  fur.push(...fit(bathroom(), 0.25, fi, f1, 2));
  fur.push(...fit(bed(true), 2.6, -1.8, f1, 0), ...fit(wardrobe(1.0), X - W - 0.32, 1.8, f1, 3));
  fur.push(...fit(bed(false), -1.4, bi + 1.1, f1, 0));
  // curtains on the living-room window and the middle bedroom window, on the front wall's inner lining
  fur.push(...curtains({ face: Z - 0.22, into: -1, c: 1.3, w: 1.2, head: g0 + 2.1, drop: 1.3, fabric: 'velvet', tint: 0x5a2a36 }));
  fur.push(...curtains({ face: Z - 0.22, into: -1, c: -0.25, w: 0.8, head: f1 + 2.1, drop: 1.4, tint: 0xcfd8c0 }));
  if (p.interior !== false) ps.push(...fur);
  return put(ps, p, 'house');
}

/** Victorian brick terrace: solid brick front and back walls (stone lintels and sills), party walls with the
    first-floor joists pocketed into them (the walls above bear on the joist ends), a chimney breast with an open
    flue in each house on both floors and a stack on the ridge, lath-and-plaster ceilings, a half-brick ground-floor
    spine, a stud-and-plaster upstairs partition, a straight stair up the hall, and a slate roof on rafters.
    The last house is a corner pub (`pub`). */
export function victorianTerrace(p: Placement & { count?: number; pub?: boolean; protected?: boolean }): PieceSpec[] {
  const n = p.count ?? 3, bay = 5.0, X = (n * bay) / 2, Z = 4.5, te = 0.34, tp = 0.23;
  const jb = 2.68, jt = 2.94, f1 = 3.0, eave = 5.6, g0 = 0.08, ceil = jb - 0.06;
  const brick = { mat: 'brick' as const, tint: 0xa3553f, lintel: 'stone' as const, sill: 'stone' as const, maxW: 2.5 };
  const plaster = { mat: 'plaster' as const, tint: 0xece3cf };
  const centres = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? -X + te / 2 : i === n ? X - te / 2 : -X + i * bay));
  const face = (i: number, side: -1 | 1) => {
    const c = centres[i], t = i === 0 || i === n ? te : tp;
    return c + (side * t) / 2;
  };
  const ps: PieceSpec[] = [], fur: PieceSpec[] = [];
  const pubAt = p.pub ?? true ? n - 1 : -1;
  const fronts: Opening[] = [], frontsUp: Opening[] = [], backs: Opening[] = [], backsUp: Opening[] = [];
  for (let i = 0; i < n; i++) {
    const lf = face(i, 1), rf = face(i + 1, -1);
    if (i === pubAt) fronts.push({ c: lf + 1.5, w: 2.0, y0: 0.6, h: 2.0 }, door(rf - 0.6, 1.0, 2.3));
    else fronts.push({ c: lf + 1.7, w: 1.3, y0: 0.8, h: 1.8, glass: false }, door(rf - 0.6, 0.95, 2.3));
    frontsUp.push(win(lf + 1.3, 1.0, 0.8, 1.6), win(rf - 1.4, 1.0, 0.8, 1.6));
    backs.push(win(lf + 1.5, 1.0, 1.0, 1.3), door(rf - 0.75, 0.9, 2.2));
    backsUp.push(win(lf + 1.5, 1.0, 0.9, 1.3));
  }
  for (const [s, lo, up] of [[1, fronts, frontsUp], [-1, backs, backsUp]] as const) {
    const at = s * (Z - te / 2);
    ps.push(...wallRun({ ...brick, from: -X, to: X, at, t: te, y0: 0, h: f1, out: s, openings: lo, arris: 0.06 }));
    ps.push(...wallRun({ ...brick, from: -X, to: X, at, t: te, y0: f1, h: eave - f1, out: s, openings: up, arris: 0.06 }));
  }
  // party and gable walls: a lift up to the joists, the open pocket course, and the lift above bearing on the joists
  for (let i = 0; i <= n; i++) {
    const t = i === 0 || i === n ? te : tp;
    const w = { ...brick, axis: 'z' as const, from: -Z + te, to: Z - te, at: centres[i], t, out: (i === n ? 1 : -1) as 1 | -1 };
    ps.push(...wallRun({ ...w, y0: 0, h: jb }), ...wallRun({ ...w, y0: jt, h: eave - jt }));
  }
  const zi: Range = [-Z + te, Z - te];
  for (let i = 0; i < n; i++) {
    const lf = face(i, 1), rf = face(i + 1, -1), pub = i === pubAt;
    const well = { x: [rf - 1.0, rf] as Range, z: [-1.3, 2.3] as Range };
    // ground boards (the strip along the left wall is the hearth), first floor, ceiling under it
    for (const x of splitRange(lf + 0.4, rf, 4.8)) for (const z of splitRange(zi[0], zi[1], 4.5)) ps.push(block('plywood', x, [0, g0], z, { tint: 0x9a7a58 }));
    ps.push(...joistFloor({ x: [lf, rf], z: zi, span: 'x', y: f1, depth: jt - jb, pitch: 0.6, bear: [lf - centres[i], centres[i + 1] - rf], sheet: 4.8,
      deck: { tint: 0x9a7a58 }, ceiling: { mat: 'plaster', tint: 0xf1ece2 }, well }));
    // chimney breast on the left wall, both floors: two cheeks, the breast front over the fireplace, a stone mantel
    for (const [y0, y1] of [[0, ceil], [f1, eave + 0.04]] as Range[]) {
      const bx: Range = [lf, lf + 0.4];
      ps.push(block('brick', bx, [y0, y1], [0.4, 0.62], { tint: brick.tint }), block('brick', bx, [y0, y1], [1.38, 1.6], { tint: brick.tint }));
      ps.push(block('brick', [lf + 0.28, lf + 0.4], [y0 + 1.0, y1], [0.62, 1.38], { tint: brick.tint }));
      ps.push(block('stone', [lf + 0.4, lf + 0.52], [y0 + 1.0, y0 + 1.08], [0.35, 1.65], { tint: 0xe6dcc6 }));
    }
    ps.push(...stair({ axis: 'z', from: 2.6, to: -1.3, cross: [rf - 0.95, rf], y0: g0, y1: f1, open: 'lo' }));
    if (!pub) ps.push(...wallRun({ mat: 'brick', tint: 0xe9e1cf, from: lf, to: rf - 0.9, at: -1.5, t: 0.115, y0: g0, h: ceil - g0, openings: [door(rf - 1.55, 0.8, 2.1)] }));
    ps.push(...studWall({ from: lf, to: rf - 1.0, at: -1.6, y0: f1, h: eave + 0.04 - f1, t: 0.075, pitch: 0.6, noggins: false,
      liningNeg: plaster, liningPos: plaster, openings: [door(rf - 1.6, 0.8, 2.0)] }));
    // rooms
    if (pub) {
      fur.push(...fit(bar(2.6, 3), lf + 0.6, -0.9, g0), ...fit(table(0.9, 0.9), lf + 2.0, 2.8, g0), ...fit(table(0.9, 0.9), lf + 2.9, 1.2, g0));
      for (const [x, z] of [[lf + 2.0, 3.55], [lf + 2.0, 2.05], [lf + 2.9, 0.45]]) fur.push(...fit(chair(), x, z, g0));
    } else {
      fur.push(...fit(sofa(1.8), lf + 2.0, Z - te - 0.45, g0, 2), ...fit(table(0.8, 0.6), lf + 1.8, 1.0, g0));
      fur.push(...fit(table(1.2, 0.8), lf + 1.6, -2.8, g0), ...fit(bookcase(1.2, 1.9), lf + 1.6, -Z + te + 0.16, g0));
    }
    fur.push(...fit(bed(true), lf + 1.6, 2.2, f1, 2), ...fit(bed(false), lf + 1.1, -2.8, f1), ...fit(wardrobe(1.0), rf - 1.6, Z - te - 0.3, f1, 2));
    ps.push(supplyBox([rf - 0.12, rf], [1.6, 2.2], [3.3, 3.7]), lamp([rf - 0.25, rf], [1.9, 2.2], [3.7, 3.95], LIGHT.warm));
    if (pub) ps.push(lamp([lf + 0.8, lf + 1.2], [ceil - 0.22, ceil], [-0.3, 0.1], LIGHT.warm), supplyBox([lf + 1.2, lf + 1.6], [ceil - 0.3, ceil], [-0.3, 0.1]));
  }
  ps.push(...rafterRoof({ x: [-X - 0.25, X + 0.25], gables: [[-X, -X + te], [X - te, X]], z: [-Z, Z], y: eave, rise: 2.8, pitch: 0.8,
    covering: { tint: 0x5f656e }, gableMat: 'brick', gableTint: brick.tint, ceiling: { z: [-Z + 0.15, Z - 0.15] } }));
  // stacks on the ridge over each chimney breast
  const k = 2.8 / Z, capTop = eave + 0.1 + k * (Z - 0.03) + 0.15 + 0.065 + 0.07 + 0.06;
  for (let i = 0; i < n; i++) {
    const x = face(i, 1) + 0.2;
    ps.push(block('brick', [x - 0.35, x + 0.35], [capTop, capTop + 1.1], [-0.4, 0.4], { tint: brick.tint }));
    // mortar flaunching either side of the ridge tile, so the stack beds across the slates rather than on the ridge alone
    for (const s of [1, -1]) {
      ps.push(extrude('concrete', ([[0.03, capTop - 0.06], [0.4, capTop - 0.06 - k * 0.37], [0.4, capTop], [0.03, capTop]] as [number, number][])
        .map(([z, y]) => [s * z, y] as [number, number]), 'x', [x - 0.35, x + 0.35], { tint: 0x9a9a96 }));
    }
    ps.push(block('stone', [x - 0.42, x + 0.42], [capTop + 1.1, capTop + 1.2], [-0.47, 0.47], { tint: 0xe6dcc6 }));
    for (const dz of [-0.18, 0.18]) ps.push(cyl('terracotta', 0.22, [capTop + 1.2, capTop + 1.65], x, dz, { tint: 0xd08a64 }));
  }
  // cast-iron gutters, downpipes on the party walls, and the pub's fascia and lamp
  for (const s of [-1, 1] as const) ps.push(...band({ mat: 'castiron', face: s * Z, out: s, from: -X, to: X, y: [eave - 0.14, eave], depth: 0.13, tint: 0x2f3336 }));
  for (let i = 1; i < n; i++) ps.push(...downpipe({ face: Z }, centres[i], [0, eave - 0.14]));
  if (pubAt >= 0) {
    const lf = face(pubAt, 1), rf = face(pubAt + 1, -1);
    ps.push(extrude('wood', [[Z, 2.55], [Z + 0.08, 2.55], [Z + 0.1, 2.6], [Z + 0.1, 2.86], [Z + 0.15, 2.9], [Z + 0.15, 2.95], [Z, 2.95]], 'x', [lf, rf],
      { tint: 0x2f4f3a, finish: 'paint' }));
  }
  // a canted bay on each house's front room, a segmental stone hood over each front door
  for (let i = 0; i < n; i++) {
    if (i === pubAt) continue;
    const [w, d] = fronts.slice(2 * i, 2 * i + 2);
    ps.push(...bayWindow({ face: Z }, [w.c - w.w / 2, w.c + w.w / 2], [w.y0, w.y0 + w.h], { tint: brick.tint }), ...hood({ face: Z }, [d.c - d.w / 2, d.c + d.w / 2], d.y0 + d.h));
  }
  if (p.interior !== false) ps.push(...fur);
  return put(layerize(ps, { brick: 'solid', lining: true, partitions: true, timber: true, roofs: 'slate' }), p, 'terrace', { protected: p.protected, age: { years: 130, exposure: 'outdoor' } });
}

/** Background tower for distant skylines: the same load path as a real one (RC core, perimeter columns, flat
    slabs, storey-high glazing) but in few, large members, so a skyline costs a fraction of a hero building. */
export function backdropTower(p: Placement & { storeys?: number; tint?: number }): PieceSpec[] {
  const n = p.storeys ?? 12, H = 4.2, E = 10, c = 3.15, t = 0.3, slab = 0.3;
  const con = { tint: 0xcfcfca }, glaze = { tint: p.tint ?? 0xa9cde0 };
  const ps: PieceSpec[] = [];
  for (let k = 0; k < n; k += 2) {
    const y: Range = [k * H, Math.min(n, k + 2) * H];
    ps.push(block('rconcrete', [-c, c], y, [c - t, c], con), block('rconcrete', [-c, c], y, [-c, -c + t], con));
    ps.push(block('rconcrete', [-c, -c + t], y, [-c + t, c - t], con), block('rconcrete', [c - t, c], y, [-c + t, c - t], con));
  }
  for (let k = 0; k < n; k++) {
    const y0 = k * H, top = (k + 1) * H - slab;
    for (const x of [-9.6, 0, 9.6]) for (const z of [-9.6, 0, 9.6]) if (x || z) ps.push(block('rconcrete', [x - 0.3, x + 0.3], [y0, top], [z - 0.3, z + 0.3], con));
    const sy: Range = [top, top + slab];
    ps.push(block('rconcrete', [-E, E], sy, [c, E], con), block('rconcrete', [-E, E], sy, [-E, -c], con));
    ps.push(block('rconcrete', [-E, -c], sy, [-c, c], con), block('rconcrete', [c, E], sy, [-c, c], con));
    const g: Range = [y0, top - 0.03];
    ps.push(block('tempered', [-E, E], g, [E - 0.06, E], glaze), block('tempered', [-E, E], g, [-E, -E + 0.06], glaze));
    ps.push(block('tempered', [E - 0.06, E], g, [-E + 0.06, E - 0.06], glaze), block('tempered', [-E, -E + 0.06], g, [-E + 0.06, E - 0.06], glaze));
  }
  const roof = n * H;
  for (const s of [-1, 1]) {
    ps.push(block('rconcrete', [-E, E], [roof, roof + 1.2], s > 0 ? [E - 0.25, E] : [-E, -E + 0.25], con));
    ps.push(block('rconcrete', s > 0 ? [E - 0.25, E] : [-E, -E + 0.25], [roof, roof + 1.2], [-E + 0.25, E - 0.25], con));
  }
  ps.push(block('metal', [-c, c], [roof, roof + 3], [-c, c], { tint: 0xeceae4 }));
  return put(ps, p, 'backdrop');
}
