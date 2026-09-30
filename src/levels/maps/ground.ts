import type { MaterialId, PieceSpec } from '../../types.ts';
import { block, cyl, raise, splitRange, weldParts, type Range } from '../kit.ts';
import { GROUND_TOL, pieceAabb } from '../validate.ts';
import type { TerrainPlan } from '../../terrain/plan.ts';
import { found, type FoundOpts } from '../../terrain/foundations.ts';
import { KERB_UP } from '../../terrain/spec.ts';

/* Standing things on a free-play site's terrain (terrain/plan.ts): the natural ground is y ≈ 0, carriageways are
   carved a kerb upstand below the footways, buildings stand a damp course up on their foundations
   (terrain/foundations.ts). Street furniture is fixed where it stands. */

export const KERB = KERB_UP;
/** Levels of the retired made ground, kept for scripts written against it: the footway is now the natural ground
    and the carriageway a kerb below it. */
export const DECK = 0, ROAD = -KERB_UP;

/** Stand pieces built at y = 0 on ground at `y`: what stood on the ground is anchored to it there. */
export function stand(ps: PieceSpec[], y: number): PieceSpec[] {
  if (Math.abs(y) < 1e-9) return ps;
  const low = ps.map((p) => !p.noWeld && !p.mech && pieceAabb(p).min[1] <= GROUND_TOL);
  return raise(ps, y).map((p, i) => (low[i] ? { ...p, anchored: true } : p));
}

/** Retired name for `stand`. */
export const onDeck = (ps: PieceSpec[], y = DECK): PieceSpec[] => stand(ps, y);

/** A building placed on its foundations (see terrain/foundations.ts); returns its pieces. */
export function building(ps: PieceSpec[], plan: TerrainPlan, o: FoundOpts = {}): PieceSpec[] {
  return found(ps, plan, o).pieces;
}

/* ---------------- street furniture: cheap pieces, welded where they would be fixed ---------------- */

const F = { black: 0x26282a, green: 0x2f4f3f, red: 0xb3262a, grey: 0x6d7275, yellow: 0xe6be2e, wood: 0x8a6a48 };

/** Marker post for a buried service (a yellow 'G' plate for gas, 'H' plate for a hydrant, 'W' for water). */
export function marker(x: number, z: number, y: number, tint = F.yellow): PieceSpec {
  return weldParts([cyl('steel', 0.08, [y, y + 1.1], x, z), block('steel', [x - 0.13, x + 0.13], [y + 0.75, y + 1.05], [z + 0.04, z + 0.09])],
    { tint, group: 'furniture', anchored: true });
}

export function bollard(x: number, z: number, y: number): PieceSpec {
  return cyl('castiron', 0.2, [y, y + 0.95], x, z, { tint: F.black, group: 'furniture', anchored: true });
}

export function litterBin(x: number, z: number, y: number): PieceSpec {
  return cyl('metal', 0.5, [y, y + 0.95], x, z, { tint: F.green, group: 'furniture', anchored: true });
}

/** Wheelie bin: loose, a prop by design (tall enough to be walked round, not tripped over). */
export function wheelieBin(x: number, z: number, y: number, tint = 0x2f5a3a): PieceSpec {
  return block('pvc', [x - 0.3, x + 0.3], [y, y + 1.05], [z - 0.36, z + 0.36], { tint, noWeld: true, group: 'bins' });
}

/** Bench: timber seat and back on two cast ends, one welded body, facing +Z (`face` -1 faces -Z) or along X. */
export function bench(x: number, z: number, y: number, alongX = true, face: 1 | -1 = 1): PieceSpec {
  const L = 1.8, s = face;
  const P = (u: Range, yy: Range, v: Range) => (alongX ? block('wood', u.map((q) => x + q) as Range, yy, v.map((q) => z + s * q).sort((a, b) => a - b) as Range)
    : block('wood', v.map((q) => x + s * q).sort((a, b) => a - b) as Range, yy, u.map((q) => z + q) as Range));
  return weldParts([
    P([-L / 2, -L / 2 + 0.08], [y, y + 0.8], [-0.25, 0.22]), P([L / 2 - 0.08, L / 2], [y, y + 0.8], [-0.25, 0.22]),
    P([-L / 2 + 0.08, L / 2 - 0.08], [y + 0.4, y + 0.46], [-0.22, 0.2]), P([-L / 2 + 0.08, L / 2 - 0.08], [y + 0.5, y + 0.8], [-0.25, -0.2]),
  ], { tint: F.wood, group: 'furniture', anchored: true });
}

/** Street sign on a post: `w` wide plate, its face across X (alongX) or Z. */
export function sign(x: number, z: number, y: number, alongX = true, tint = 0xe8e8e2, w = 0.9, h = 2.5): PieceSpec {
  const plate = alongX ? block('steel', [x - w / 2, x + w / 2], [y + h - 0.45, y + h], [z + 0.05, z + 0.1]) : block('steel', [x + 0.05, x + 0.1], [y + h - 0.45, y + h], [z - w / 2, z + w / 2]);
  return weldParts([cyl('steel', 0.08, [y, y + h], x, z), plate], { tint, group: 'furniture', anchored: true });
}

/** Pillar post box. */
export function postBox(x: number, z: number, y: number): PieceSpec {
  return weldParts([cyl('castiron', 0.5, [y, y + 1.4], x, z), cyl('castiron', 0.56, [y + 1.4, y + 1.5], x, z)], { tint: F.red, group: 'furniture', anchored: true });
}

/** K6 telephone box: cast-iron frame and roof (one body) round a glazed core, door toward +Z (or -Z). */
export function phoneBox(x: number, z: number, y: number): PieceSpec[] {
  const w = 0.46, posts: PieceSpec[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.push(block('castiron', [x + sx * w - 0.05, x + sx * w + 0.05].sort((a, b) => a - b) as Range, [y + 0.1, y + 2.3], [z + sz * w - 0.05, z + sz * w + 0.05].sort((a, b) => a - b) as Range));
  return [
    weldParts([block('castiron', [x - w - 0.06, x + w + 0.06], [y, y + 0.1], [z - w - 0.06, z + w + 0.06]), ...posts,
      block('castiron', [x - w - 0.06, x + w + 0.06], [y + 2.3, y + 2.55], [z - w - 0.06, z + w + 0.06])], { tint: F.red, group: 'furniture', anchored: true }),
    block('glass', [x - w + 0.06, x + w - 0.06], [y + 0.1, y + 2.3], [z - w + 0.06, z + w - 0.06], { group: 'furniture', anchored: true }),
  ];
}

/** Bus stop flag: a pole with the stop plate. */
export function stopFlag(x: number, z: number, y: number, alongX = true): PieceSpec {
  return sign(x, z, y, alongX, 0xc8302a, 0.45, 2.8);
}

/** Low boundary wall with coping, along X or Z, from a to b at `at`. */
export function boundaryWall(axis: 'x' | 'z', a: number, b: number, at: number, y: number, h = 1.0, mat: MaterialId = 'brick', tint = 0x9c6a58, maxL = 6): PieceSpec[] {
  return splitRange(Math.min(a, b), Math.max(a, b), maxL).map((u) => (axis === 'x'
    ? block(mat, u, [y, y + h], [at - 0.11, at + 0.11], { tint, group: 'walls', anchored: true }) : block(mat, [at - 0.11, at + 0.11], [y, y + h], u, { tint, group: 'walls', anchored: true })));
}

/** Steel palisade along X or Z: pales (65 mm, 150 mm centres) bolted to two angle rails on posts set in concrete, one
    welded run per `maxL`. Light and see-through; `side` is the face the pales are on. */
export function palisade(axis: 'x' | 'z', a: number, b: number, at: number, y: number, h = 2.0, tint = 0x2f3a36, maxL = 6.8, side: 1 | -1 = 1): PieceSpec[] {
  const B = (u: Range, yy: Range, v: Range) => {
    const w = [at + side * v[0], at + side * v[1]].sort((p, q) => p - q) as Range;
    return axis === 'x' ? block('steel', u, yy, w) : block('steel', w, yy, u);
  };
  return splitRange(Math.min(a, b), Math.max(a, b), maxL).map(([u0, u1]) => {
    const parts: PieceSpec[] = [];
    const nb = Math.max(1, Math.round((u1 - u0) / 2.75)), step = (u1 - u0) / nb;
    // (no part thinner than 40 mm: a finer part is not drawn)
    for (let i = 0; i <= nb; i++) { const u = Math.min(u1 - 0.05, Math.max(u0 + 0.05, u0 + i * step)); parts.push(B([u - 0.05, u + 0.05], [y, y + h - 0.12], [-0.19, -0.09])); }
    for (const ry of [0.3, h - 0.45]) parts.push(B([u0, u1], [y + ry, y + ry + 0.05], [-0.09, -0.04]));
    const n = Math.floor((u1 - u0) / 0.15);
    for (let i = 0; i < n; i++) { const u = u0 + (u1 - u0 - (n - 1) * 0.15) / 2 + i * 0.15; parts.push(B([u - 0.0325, u + 0.0325], [y + 0.06, y + h - (i % 2) * 0.04], [-0.04, 0.0])); }
    return weldParts(parts, { tint, group: 'walls', anchored: true });
  });
}

/** Road-closure barrier run: interlocking plastic barrier sections (red and white boards on feet), loose on the road. */
export function barrier(axis: 'x' | 'z', a: number, b: number, at: number, y: number, tint = 0xc8302a): PieceSpec {
  const lo = Math.min(a, b), hi = Math.max(a, b), parts: PieceSpec[] = [];
  const B = (u: Range, yy: Range, v: Range) => (axis === 'x' ? block('pvc', u, yy, [at + v[0], at + v[1]]) : block('pvc', [at + v[0], at + v[1]], yy, u));
  const n = Math.max(1, Math.round((hi - lo) / 2)), s = (hi - lo) / n;
  for (let i = 0; i <= n; i++) { const u = Math.min(hi - 0.04, Math.max(lo + 0.04, lo + i * s)); parts.push(B([u - 0.04, u + 0.04], [y, y + 0.08], [-0.3, 0.3]), B([u - 0.035, u + 0.035], [y + 0.08, y + 1.0], [-0.035, 0.035])); }
  parts.push(B([lo, hi], [y + 0.78, y + 0.98], [-0.03, 0.03]), B([lo, hi], [y + 0.3, y + 0.42], [-0.03, 0.03]));
  return weldParts(parts, { tint, noWeld: true, group: 'closure' });
}

/** Traffic cone (base and body, one loose piece). */
export function cone(x: number, z: number, y: number): PieceSpec {
  return weldParts([block('pvc', [x - 0.19, x + 0.19], [y, y + 0.04], [z - 0.19, z + 0.19]), cyl('pvc', 0.2, [y + 0.04, y + 0.75], x, z)],
    { tint: 0xe0602a, noWeld: true, group: 'closure' });
}

/** Temporary mesh fence (Heras) along X or Z: 3.45 m panels of framed mesh clipped end to end on concrete feet, one
    loose run; the mesh is drawn as its vertical wires at 0.3 m and a mid rail (no part thinner than 40 mm is drawn). */
export function heras(axis: 'x' | 'z', a: number, b: number, at: number, y: number): PieceSpec {
  const lo = Math.min(a, b), hi = Math.max(a, b), parts: PieceSpec[] = [];
  const B = (m: MaterialId, u: Range, yy: Range, v: Range) => (axis === 'x' ? block(m, u, yy, [at + v[0], at + v[1]]) : block(m, [at + v[0], at + v[1]], yy, u));
  const n = Math.max(1, Math.round((hi - lo) / 3.45)), s = (hi - lo) / n;
  for (let i = 0; i < n; i++) {
    const u0 = lo + i * s + 0.03, u1 = lo + (i + 1) * s - 0.03;
    for (const u of [u0, u1 - 0.04]) parts.push(B('steel', [u, u + 0.04], [y + 0.14, y + 2.0], [-0.02, 0.02]));
    for (const yy of [y + 0.14, y + 1.05, y + 1.96]) parts.push(B('steel', [u0, u1], [yy, yy + 0.04], [-0.02, 0.02]));
    for (let u = u0 + 0.3; u < u1 - 0.15; u += 0.3) parts.push(B('steel', [u - 0.02, u + 0.02], [y + 0.18, y + 1.96], [-0.02, 0.02]));
  }
  // the feet (the run's material is its steel: the feet are drawn as blocks at the panel joints)
  for (let i = 0; i <= n; i++) { const u = Math.min(hi - 0.08, Math.max(lo + 0.08, lo + i * s)); parts.push(B('concrete', [u - 0.08, u + 0.08], [y, y + 0.14], [-0.25, 0.25])); }
  return weldParts(parts, { tint: 0x9aa0a0, noWeld: true, group: 'closure' });
}

/** Palisade / close-boarded fence panels along X or Z. */
export function fence(axis: 'x' | 'z', a: number, b: number, at: number, y: number, h = 1.8, mat: MaterialId = 'wood', tint = 0x7a5c3e, maxL = 6): PieceSpec[] {
  return splitRange(Math.min(a, b), Math.max(a, b), maxL).map((u) => (axis === 'x'
    ? block(mat, u, [y, y + h], [at - 0.03, at + 0.03], { tint, group: 'walls', anchored: true }) : block(mat, [at - 0.03, at + 0.03], [y, y + h], u, { tint, group: 'walls', anchored: true })));
}
