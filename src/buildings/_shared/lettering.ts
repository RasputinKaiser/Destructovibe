import type { PieceSpec } from '../../types.ts';
import { block, type Range } from '../../levels/kit.ts';
import { withDetail } from '../../levels/layers.ts';

/* Sign-writing as dormant detail: raised block capitals (a 5 × 7 grid, each row's runs merged into one bar) on the face
   of a fascia or sign board, so a painted sign costs no simulated pieces and falls with its board. */

const G: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'], H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'], J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'], S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'], U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'], W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'], "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

export interface SignFace {
  /** the face plane: the board's face along axis 'x' (normal ±z) or 'z' (normal ±x), at `at`, standing `out` */
  axis: 'x' | 'z';
  at: number;
  out: 1 | -1;
  /** the text box on the face (along the axis, and height) */
  u: Range;
  y: Range;
}

/** Letter units for `text` centred in the box, raised `depth` off the face. Reads left to right seen from outside. */
export function letters(text: string, f: SignFace, tint: number, depth = 0.008): PieceSpec[] {
  const chars = [...text.toUpperCase()];
  const H = f.y[1] - f.y[0], W = f.u[1] - f.u[0];
  const px = Math.min(H / 7, W / (chars.length * 6 - 1));
  const tw = px * (chars.length * 6 - 1), y0 = (f.y[0] + f.y[1]) / 2 - 3.5 * px;
  // seen from outside, "right" is +u on a +z face or a -x face, -u on a -z face or a +x face
  const dir = (f.axis === 'x' ? f.out : -f.out) as 1 | -1;
  const start = (f.u[0] + f.u[1]) / 2 - (dir * tw) / 2;
  const t: Range = f.out > 0 ? [f.at - depth, f.at] : [f.at, f.at + depth];
  const out: PieceSpec[] = [];
  chars.forEach((ch, i) => {
    const g = G[ch] ?? G[' '];
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      for (let c = 0; c < 5;) {
        if (row[c] !== '1') { c++; continue; }
        let e = c;
        while (e < 5 && row[e] === '1') e++;
        const a = start + dir * (i * 6 + c) * px, b = start + dir * (i * 6 + e) * px;
        const u: Range = [Math.min(a, b), Math.max(a, b)], y: Range = [y0 + (6 - r) * px, y0 + (7 - r) * px];
        const q = f.axis === 'x' ? block('wood', u, y, t) : block('wood', t, y, u);
        q.tint = tint; q.finish = 'paint';
        out.push(q);
        c = e;
      }
    }
  });
  return out;
}

/** Sign-write boards: each board (a box member without detail) gets a painted core set back `depth` from the lettered
    face(s) and the letters that fall on it (split where a line of letters runs over two boards). */
export function inscribe(boards: PieceSpec[], units: PieceSpec[], faces: SignFace[], depth = 0.008): PieceSpec[] {
  return boards.map((b) => {
    if (b.detail || (b.shape && b.shape !== 'box')) return b;
    const lo = b.pos.map((v, i) => v - b.size[i] / 2), hi = b.pos.map((v, i) => v + b.size[i] / 2);
    const core = { lo: [...lo], hi: [...hi] };
    for (const f of faces) {
      const k = f.axis === 'x' ? 2 : 0;
      if (Math.abs((f.out > 0 ? hi[k] : lo[k]) - f.at) > 1e-4) continue;
      if (f.out > 0) core.hi[k] = f.at - depth; else core.lo[k] = f.at + depth;
    }
    const d: PieceSpec[] = [block(b.mat, [core.lo[0], core.hi[0]], [core.lo[1], core.hi[1]], [core.lo[2], core.hi[2]], { tint: b.tint, finish: b.finish })];
    for (const u of units) {
      const ul = u.pos.map((v, i) => v - u.size[i] / 2), uh = u.pos.map((v, i) => v + u.size[i] / 2);
      const cl = ul.map((v, i) => Math.max(v, lo[i])), ch = uh.map((v, i) => Math.min(v, hi[i]));
      if (ch.some((v, i) => v - cl[i] < 0.004)) continue;
      const q = block(u.mat, [cl[0], ch[0]], [cl[1], ch[1]], [cl[2], ch[2]], { tint: u.tint, finish: u.finish });
      d.push(q);
    }
    return withDetail({ ...b }, d);
  });
}
