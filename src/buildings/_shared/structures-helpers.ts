import type { PieceSpec } from '../../types.ts';
import { block, envelopeFinish, place, raise, pipeRun, tag, type Opening, type PieceOpts } from '../../levels/kit.ts';
import { boilerSet } from '../../levels/services.ts';
import { type Placement, gridFeed, TINT } from './base.ts';

export function put(ps: PieceSpec[], p: Placement, fallback: string, extra: PieceOpts = {}): PieceSpec[] {
  return gridFeed(tag(place(envelopeFinish(ps), p.x, p.z, p.rot ?? 0), { group: p.group ?? fallback, ...extra }), p.gridFed);
}

/** Floor-bolted line drive: plinth, continuous skids, motor, shaft, split flywheel,
 * guarded belt and intake hopper. The thin parts seat on thicker members so an
 * impact can strip the guard/hopper before it dislodges the heavy machine bed. */
export function lineDrive(x: number, z: number, y = 0): PieceSpec[] {
  const iron: PieceOpts = { tint: TINT.iron, finish: 'satin' }, frame: PieceOpts = { finish: 'galv' }, guard: PieceOpts = { tint: 0x161616, finish: 'decal' };
  const ps: PieceSpec[] = [
    block('concrete', [-1.45, 1.45], [0, 0.24], [-0.85, 0.85], { tint: TINT.darkConcrete }),
    block('steel', [-1.25, 1.25], [0.24, 0.42], [-0.7, -0.46], frame),
    block('steel', [-1.25, 1.25], [0.24, 0.42], [0.46, 0.7], frame),
    block('castiron', [-0.95, 0.4], [0.42, 1.48], [-0.48, 0.48], { ...iron, fixture: 'motor' }),
    block('steel', [-1.08, -0.95], [0.62, 1.28], [-0.38, 0.38], { ...frame, util: 'power' }),
    block('castiron', [-0.08, 0.08], [1.48, 1.65], [-0.13, 0.13], iron),
    ...pipeRun('steel', 'x', [0.4, 0.9], [0, 1.0, 0], 0.24, frame),
    block('castiron', [0.9, 1.08], [0.42, 1.56], [-0.55, 0.55], iron),
    block('castiron', [1.08, 1.2], [0.42, 1.56], [-0.55, 0.55], iron),
    // Belt reaches between the motor and wheel; two removable guard cheeks
    // stand on the skids, while the top cap bridges them.
    block('metal', [0.08, 0.9], [1.56, 1.64], [-0.13, -0.03], { tint: TINT.rubber }),
    block('metal', [0.22, 1.25], [0.42, 1.78], [-0.69, -0.59], guard),
    block('metal', [0.22, 1.25], [0.42, 1.78], [0.59, 0.69], guard),
    block('metal', [0.22, 1.25], [1.78, 1.86], [-0.69, 0.69], guard),
    block('steel', [-0.65, -0.47], [1.48, 1.87], [-0.52, -0.34], frame),
    block('metal', [-1.05, -0.08], [1.87, 2.03], [-0.7, -0.16], { tint: TINT.metalGreen }),
    block('metal', [-1.05, -0.93], [2.03, 2.42], [-0.7, -0.16], { tint: TINT.metalGreen }),
    block('metal', [-0.2, -0.08], [2.03, 2.42], [-0.7, -0.16], { tint: TINT.metalGreen }),
  ];
  return raise(place(ps, x, z), y);
}

/** Horizontal boiler (steam source) on a masonry hearth; no full-size obstacle crosses a door. */
export function boiler(x: number, z: number, y = 0): PieceSpec[] {
  return raise(place(boilerSet(), x, z), y);
}

/** Radiator fastened to a floor and wall by its base and two manifold ends.
 * Fins meet both headers face-to-face and break away individually. */
export function radiator(x: number, z: number, y = 0): PieceSpec[] {
  const iron = { tint: TINT.metalWhite, util: 'steam' as const }, copper = { tint: TINT.bronze, util: 'steam' as const };
  const ps: PieceSpec[] = [
    block('castiron', [-0.92, 0.92], [0, 0.16], [-0.17, 0.17], iron),
    block('castiron', [-0.92, 0.92], [0.16, 0.29], [-0.12, 0.12], iron),
    block('castiron', [-0.92, 0.92], [1.04, 1.17], [-0.12, 0.12], { tint: TINT.metalWhite, fixture: 'radiator' }),
  ];
  for (const dx of [-0.7, -0.35, 0, 0.35, 0.7]) ps.push(block('castiron', [dx - 0.075, dx + 0.075], [0.29, 1.04], [-0.15, 0.15], iron));
  ps.push(block('copper', [0.92, 1.08], [1.04, 1.17], [-0.1, 0.1], copper));
  return raise(place(ps, x, z), y);
}

export const win = (c: number, w = 1.2, y0 = 0.9, h = 1.2): Opening => ({ c, w, y0, h });

export const door = (c: number, w = 0.9, h = 2.05): Opening => ({ c, w, y0: 0, h, glass: false });
