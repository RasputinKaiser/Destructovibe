import type { PieceSpec } from '../../../types.ts';
import { block, carton, wallRun, type Opening, type Range } from '../../../levels/kit.ts';
import { layerize } from '../../../levels/layers.ts';
import { band } from '../../../levels/facade.ts';
import { BORE, clipped, combiBoiler, conduit, lamp, LIGHT, radiatorPanel, supplyBox } from '../../../levels/services.ts';
import type { Placement } from '../../_shared/base.ts';
import { put, kitchenSink } from '../../_shared/clearance-helpers.ts';
import { brickRun, door, glaze, glazeAll, lime, PAINT, panelled, pilasterPiece, sash, shade, shopfront, timberDeck } from '../../_shared/vernacular.ts';
import { pitchRoof } from '../../_shared/roofs.ts';
import { inscribe, letters, type SignFace } from '../../_shared/lettering.ts';

/** Two-storey Victorian high-street building, front +Z, eaves to the street under a slate roof on brick gables with a
    stack on the gable. Shop: a timber shopfront (stall riser, transomed display window, half-glazed door, pilasters with
    consoles, fascia and cornice) in a bressummer opening, a blind over it, the flat above lit by two-over-two sashes
    with stone heads and sills. Pub (`pub`): a painted timber pub front across the whole ground floor — two doors, two
    big transomed windows over panelled stall risers, pilasters and a full-width fascia — three sashes above and a
    hanging sign. Solid 9-inch brick; a timber first floor butting the walls.
    Consumer unit by the back door, a shop light off the ceiling; a wall boiler in the back room heats a radiator on
    the side wall, its gas leaving low through the back wall for the meter box outside; a stopcock under the back
    room's sink takes the water main. */
export function highStreetUnit(p: Placement & { X?: number; Z?: number; tint?: number; fascia?: number; pub?: boolean }): PieceSpec[] {
  const X = p.X ?? 3, Z = p.Z ?? 4, t = 0.25, g = 3.3, fs = 0.2, up = g + fs, eave = up + 2.75, head = 2.9, fTop = 3.45;
  // the pub front is painted deep green with gilt lining and a brown-black fascia (the map's colour); shops are cream
  const tint = p.tint ?? 0xa98474, fascia = p.fascia ?? 0x2f4f3f, joinery = p.pub ? 0x2a4a36 : PAINT.cream;
  const br = { mat: 'brick' as const, t, maxW: 3.2, lintel: 'stone' as const, sill: 'stone' as const, tint };
  const ps: PieceSpec[] = [];
  const sashD = (g0: PieceSpec) => sash(g0, PAINT.white);
  // front, ground storey
  if (p.pub) {
    const bays = [{ c: -X + 0.95, w: 1.0, door: true }, { c: -X + 0.95 + 2.05, w: 2.2 }, { c: X - 0.95 - 2.05, w: 2.2 }, { c: X - 0.95, w: 1.0, door: true }];
    const ops: Opening[] = bays.map((b) => (b.door ? { c: b.c, w: b.w, y0: 0, h: head } : { c: b.c, w: b.w, y0: 0.85, h: head - 0.85 }));
    const front = wallRun({ mat: 'wood', tint: joinery, t, maxW: 3.2, lintel: 'wood', lintelH: 0.2, from: -X, to: X, at: Z - t / 2, y0: 0, h: up, out: 1, openings: ops });
    // the painted timber front: every pier, stall riser and head framed and sunk-panelled
    for (const q of front) if (q.mat === 'wood') q.finish = 'joinery';
    ps.push(...glazeAll(front, (pane) => glaze(pane, { rails: [0.74], bars: 3, tint: joinery, frame: 0.07, barW: 0.035 }))
      .map((q) => (q.mat === 'wood' && q.size[1] > 0.3 ? panelled(q, 'x', 1, { tint: joinery, panelTint: shade(joinery, 0.62), relief: 0.03, frame: 0.1, rails: q.size[1] > 1.5 ? 2 : 1, cols: Math.max(1, Math.round(q.size[0] / 0.7)) }) : q)));
    for (const b of bays) if (b.door) ps.push(door('x', [b.c - b.w / 2, b.c + b.w / 2], [0, head], [Z - t, Z], 1, { tint: fascia, fan: 0.55, glazed: 0.45, panels: 2 }));
    // pilasters on every pier, the full-width fascia and cornice over them
    const piers = [-X, ...bays.flatMap((b) => [b.c - b.w / 2, b.c + b.w / 2]), X];
    for (let i = 0; i < piers.length; i += 2) {
      const a = piers[i], b = piers[i + 1], m = (a + b) / 2, w = Math.min(0.32, b - a - 0.04);
      ps.push(pilasterPiece(m - w / 2 + 0.02, m + w / 2 - 0.02, head, Z, joinery, 0xc9a24a));
    }
    const sf: SignFace = { axis: 'x', at: Z + 0.14, out: 1, u: [-X + 0.5, X - 0.5], y: [head + 0.1, fTop - 0.2] };
    ps.push(...inscribe(band({ mat: 'wood', face: Z, from: -X, to: X, y: [head, fTop - 0.1], depth: 0.14, tint: fascia, maxW: 4.6 }), letters('THE RAILWAY TAVERN', sf, 0xe2c26a), [sf]));
    ps.push(...band({ mat: 'wood', face: Z, from: -X, to: X, y: [fTop - 0.1, fTop + 0.05], depth: 0.24, profile: 'cornice', tint: fascia, maxW: 4.6 }));
  } else {
    const u: Range = [-X + 0.45, X - 0.45];
    ps.push(...lime(wallRun({ ...br, lintel: 'steel', lintelH: 0.2, maxW: 6, from: -X, to: X, at: Z - t / 2, y0: 0, h: up, out: 1, openings: [{ c: 0, w: u[1] - u[0], y0: 0, h: head, glass: false }] }), 1));
    ps.push(...shopfront({ u, head, face: Z, t, fasciaTop: fTop, door: 'lo', tint: joinery, fascia, sign: 'HOLLAND GROCER', signTint: 0xeadcae }));
  }
  // front, first floor: sashes with stone heads and sills
  const upWins: Opening[] = p.pub ? [-X + 1.4, 0, X - 1.4].map((c) => ({ c, w: 1.15, y0: 0.75, h: 1.7 })) : [-X / 2 + 0.1, X / 2 - 0.1].map((c) => ({ c, w: 1.05, y0: 0.8, h: 1.6 }));
  ps.push(...brickRun({ ...br, from: -X, to: X, at: Z - t / 2, y0: up, h: eave - up, out: 1, openings: upWins }, 1, { dress: sashD }));
  // back: a door and the back-room window below, a window above
  const bi = -Z + t;
  // the power and gas tails leave through patches in the back wall (the meter box stands outside)
  const backOps: Opening[] = [{ c: 0.3, w: 1.0, y0: 1.0, h: 1.2 }, { c: X - 1.4, w: 0.9, y0: 0, h: 2.1 }];
  ps.push(...brickRun({ ...br, from: -X, to: X, at: -Z + t / 2, y0: 0, h: up, out: -1, openings: backOps }, -1, { dress: sashD, patches: [[X - 0.475, 1.8], [-X + 1.125, 0.3]] }));
  ps.push(...brickRun({ ...br, from: -X, to: X, at: -Z + t / 2, y0: up, h: eave - up, out: -1, openings: [{ c: 0, w: 1.0, y0: 0.9, h: 1.3 }] }, -1, { dress: sashD }));
  ps.push(door('x', [X - 1.85, X - 0.95], [0, 2.1], [-Z, -Z + t], -1, { tint: PAINT.black, panels: 4 }));
  // gables, full height; the first floor butts all four walls
  for (const s of [-1, 1] as const) {
    const w = { ...br, axis: 'z' as const, from: -Z + t, to: Z - t, at: s * (X - t / 2), out: s, maxW: 4 };
    // the pub's west gable faces the side street: windows on both floors; the others are blank party-style gables
    if (p.pub && s < 0) {
      ps.push(...brickRun({ ...w, y0: 0, h: up, openings: [-1.2, 2.2].map((c) => ({ c, w: 1.1, y0: 0.9, h: 1.8 })) }, s, { dress: sashD }));
      ps.push(...brickRun({ ...w, y0: up, h: eave - up, openings: [-1.2, 2.2].map((c) => ({ c, w: 1.0, y0: 0.8, h: 1.5 })) }, s, { dress: sashD }));
    } else ps.push(...brickRun({ ...w, y0: 0, h: eave }, s));
  }
  ps.push(timberDeck(block('plywood', [-X + t, X - t], [g, up], [-Z + t, Z - t], { tint: 0x9a7a58 }), { span: 'x' }));
  ps.push(timberDeck(block('plywood', [-X + t, X - t], [eave - 0.15, eave], [-Z + t, Z - t], { tint: 0xb89b72 }), { span: 'x', boards: false }));
  // slate roof ~35° on the gables; the stacks rise from the gable walls through it
  const rise = 0.7 * (Z - t);
  ps.push(...pitchRoof({ x: [-X - 0.06, X + 0.06], z: [-Z, Z], y: eave, rise, thick: 0.3, seat: t, maxW: p.pub ? 4.6 : 6.2, cover: 'slate', tint: 0x4f555d, ridgeTint: 0x8a4a3a,
    gableTint: tint, gables: [[-X, -X + t], [X - t, X]], stacks: (p.pub ? [-1, 1] : [1]).map((s) => ({ x: (s > 0 ? [X - 0.85, X] : [-X, -X + 0.85]) as Range, sz: 0.3, h: 1.2, pots: p.pub ? 3 : 2, neck: (s > 0 ? [X - t, X] : [-X, -X + t]) as Range })) }));
  for (const s of [1, -1] as const) ps.push(...band({ mat: 'castiron', face: s * Z, out: s, from: -X, to: X, y: [eave - 0.13, eave], depth: 0.12, tint: 0x24272a }));
  ps.push(block('castiron', [-X + 0.265, -X + 0.335], [0, eave - 0.13], [-Z - 0.07, -Z], { tint: 0x24272a }));
  // services
  const zb = bi + 0.048, xs = -X + t + 0.048;
  ps.push(supplyBox([X - 0.65, X - 0.3], [1.5, 2.1], [bi, bi + 0.12]));
  ps.push(...conduit([[X - 0.475, 2.1, bi + 0.06], [X - 0.475, g - 0.04, bi + 0.06], [X - 0.475, g - 0.04, 0], [0.2, g - 0.04, 0]]));
  ps.push(lamp([-0.2, 0.2], [g - 0.24, g], [-0.2, 0.2], p.pub ? LIGHT.warm : LIGHT.cool));
  ps.push(...combiBoiler([-X + 0.4, -X + 0.85], [1.3, 2.0], bi, 1, -Z));
  ps.push(radiatorPanel([-X + t, -X + t + 0.1], [0.25, 0.75], [bi + 1.2, bi + 2.2]));
  ps.push(...clipped('steam', 'copper', [[-X + 0.5, 1.3, zb], [-X + 0.5, 0.1, zb], [xs, 0.1, zb], [xs, 0.1, bi + 2.05], [xs, 0.25, bi + 2.05]], BORE.cu15, [0, 0, -1]));
  ps.push(...clipped('gas', 'copper', [[-X + 0.75, 1.3, zb], [-X + 0.75, 0.3, zb], [-X + 1.5, 0.3, zb]], BORE.cu22, [0, 0, -1]));
  ps.push(...kitchenSink(0.3, bi));
  if (p.pub) {
    // the sign on a wrought bracket at first-floor level, sign-written both sides
    ps.push(block('steel', [X - 0.9, X - 0.84], [up + 0.4, up + 0.46], [Z, Z + 0.95], { tint: 0x1f2124 }));
    const board = block('wood', [X - 0.9, X - 0.84], [up - 0.45, up + 0.4], [Z + 0.32, Z + 0.9], { tint: fascia, finish: 'joinery' });
    const faces: SignFace[] = [];
    const lines: PieceSpec[] = [];
    for (const [at, out] of [[X - 0.84, 1], [X - 0.9, -1]] as const) {
      const top: SignFace = { axis: 'z', at, out, u: [Z + 0.38, Z + 0.84], y: [up + 0.08, up + 0.3] };
      const bot: SignFace = { axis: 'z', at, out, u: [Z + 0.38, Z + 0.84], y: [up - 0.3, up - 0.02] };
      faces.push(top); lines.push(...letters('THE', top, 0xe2c26a), ...letters('RAILWAY', bot, 0xe2c26a));
    }
    ps.push(...inscribe([board], lines, faces));
  } else {
    ps.push(carton(X - 1.6, -Z + 0.9, 0), carton(X - 1.0, -Z + 0.9, 0, [0.4, 0.3, 0.3], 0xa87c4c), carton(X - 1.6, -Z + 1.4, 0, [0.35, 0.25, 0.3]));
  }
  return put(layerize(ps, { timber: true }), p, p.pub ? 'pub' : 'shop');
}
