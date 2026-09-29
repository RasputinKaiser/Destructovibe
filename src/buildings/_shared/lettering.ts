import type { PieceSpec, Vec3 } from '../../types.ts';
import { block, hull, type Range } from '../../levels/kit.ts';
import { withDetail } from '../../levels/layers.ts';

/* Sign-writing as dormant detail: raised serif capitals on the face of a fascia or sign board, so a painted sign costs
   no simulated pieces and falls with its board. Each glyph is drawn as strokes on a 5 × 7 cap-height box, the way a
   signwriter lays out Roman letters: thick stems, thin hairlines, bowls turned in 45° facets, bracketed-off with
   short slab serifs. Upright and level strokes are box units; slanted strokes are thin oriented prisms, cut flat at
   the baseline and the cap line. */

/** a stroke: from (x0, y0) to (x1, y1) in glyph units (cap height 7), `w` wide */
type Stroke = [number, number, number, number, number];
const TK = 1.05, TN = 0.55, TD = 0.8;
const stem = (x: number, y0 = 0, y1 = 7, w = TK): Stroke => [x, y0, x, y1, w];
const bar = (x0: number, x1: number, y: number, w = TN): Stroke => [x0, y, x1, y, w];
const base = (x0: number, x1: number): Stroke => bar(x0, x1, TN / 2);
const cap = (x0: number, x1: number): Stroke => bar(x0, x1, 7 - TN / 2);
const ln = (x0: number, y0: number, x1: number, y1: number, w = TD): Stroke => [x0, y0, x1, y1, w];
/** a closed chain of strokes through points, each `w` (or per-leg widths) */
const chain = (pts: [number, number][], w: number | number[]): Stroke[] =>
  pts.slice(1).map((q, i) => [pts[i][0], pts[i][1], q[0], q[1], Array.isArray(w) ? w[i] : w]);

const O_: [number, number][] = [[1.8, 7], [3.2, 7], [4.5, 5.7], [4.5, 1.3], [3.2, 0], [1.8, 0], [0.5, 1.3], [0.5, 5.7], [1.8, 7]];
const oW = [TN, TD, TK, TD, TN, TD, TK, TD];

const G: Record<string, Stroke[]> = {
  A: [ln(0.4, 0, 2.5, 7, TN), ln(2.5, 7, 4.6, 0, TK + 0.1), bar(1.3, 3.7, 2.4), base(-0.3, 1.2), base(3.8, 5.3)],
  B: [stem(0.6), cap(-0.2, 3.2), ...chain([[3.2, 6.72], [4.2, 5.8], [4.2, 4.6], [3.2, 3.6]], [TD, TK, TD]), bar(0.6, 3.4, 3.6),
    ...chain([[3.4, 3.6], [4.6, 2.4], [4.6, 1.2], [3.4, 0.28]], [TD, TK, TD]), base(-0.2, 3.4)],
  C: [...chain([[4.5, 5.0], [4.5, 5.7], [3.2, 7], [1.8, 7], [0.5, 5.7], [0.5, 1.3], [1.8, 0], [3.2, 0], [4.5, 1.3], [4.5, 2.0]], [TN, TD, TN, TD, TK, TD, TN, TD, TN])],
  D: [stem(0.6), cap(-0.2, 2.6), base(-0.2, 2.6), ...chain([[2.6, 6.72], [4.6, 4.8], [4.6, 2.2], [2.6, 0.28]], [TD, TK, TD])],
  E: [stem(0.6), cap(-0.2, 4.6), bar(0.6, 3.6, 3.6), base(-0.2, 4.8), stem(4.6, 5.9, 7, TN), stem(4.8, 0, 1.2, TN), stem(3.6, 3.0, 4.2, TN)],
  F: [stem(0.6), cap(-0.2, 4.6), bar(0.6, 3.6, 3.6), base(-0.2, 1.6), stem(4.6, 5.9, 7, TN), stem(3.6, 3.0, 4.2, TN)],
  G: [...chain([[4.5, 5.0], [4.5, 5.7], [3.2, 7], [1.8, 7], [0.5, 5.7], [0.5, 1.3], [1.8, 0], [3.2, 0], [4.5, 1.3]], [TN, TD, TN, TD, TK, TD, TN, TD]),
    stem(4.5, 1.3, 3.2), bar(2.6, 5.0, 3.2)],
  H: [stem(0.6), stem(4.4), bar(0.6, 4.4, 3.6), base(-0.3, 1.5), base(3.5, 5.3), cap(-0.3, 1.5), cap(3.5, 5.3)],
  I: [stem(2.5), base(1.3, 3.7), cap(1.3, 3.7)],
  J: [stem(3.4, 1.3, 7), ...chain([[3.4, 1.3], [2.1, 0], [1.2, 0], [0.4, 0.8]], [TD, TN, TD]), cap(2.2, 4.6)],
  K: [stem(0.6), ln(0.6, 2.6, 4.4, 7, TN), ln(1.9, 4.1, 4.7, 0, TK), base(-0.3, 1.5), cap(-0.3, 1.5), cap(3.6, 5.2), base(3.8, 5.4)],
  L: [stem(0.6), base(-0.2, 4.8), cap(-0.3, 1.5), stem(4.8, 0, 1.2, TN)],
  M: [stem(0.4, 0, 7, TN), stem(4.6), ln(0.4, 7, 2.5, 1.2, TK), ln(2.5, 1.2, 4.6, 7, TN), base(-0.3, 1.1), base(3.7, 5.4), cap(-0.3, 0.4), cap(4.6, 5.4)],
  N: [stem(0.5, 0, 7, TN), stem(4.5, 0, 7, TN), ln(0.5, 7, 4.5, 0, TK + 0.1), base(-0.3, 1.3), cap(-0.3, 0.9), cap(3.7, 5.3)],
  O: chain(O_, oW),
  P: [stem(0.6), cap(-0.2, 3.2), ...chain([[3.2, 6.72], [4.4, 5.5], [4.4, 4.3], [3.2, 3.1]], [TD, TK, TD]), bar(0.6, 3.2, 3.1), base(-0.3, 1.6)],
  Q: [...chain(O_, oW), ln(2.8, 1.8, 4.9, 0, TK)],
  R: [stem(0.6), cap(-0.2, 3.2), ...chain([[3.2, 6.72], [4.4, 5.5], [4.4, 4.8], [3.2, 3.6]], [TD, TK, TD]), bar(0.6, 3.2, 3.6),
    ln(2.3, 3.6, 4.6, 0, TK), base(-0.3, 1.6), base(3.9, 5.3)],
  S: [...chain([[4.5, 4.9], [4.5, 5.8], [3.3, 7], [1.7, 7], [0.5, 5.8], [0.5, 4.9], [1.4, 4.0], [3.6, 3.0], [4.5, 2.1], [4.5, 1.2], [3.3, 0], [1.7, 0], [0.5, 1.2], [0.5, 2.1]],
    [TN, TD, TN, TD, TK, TD, TK, TD, TK, TD, TN, TD, TN])],
  T: [stem(2.5), cap(0, 5), stem(0.25, 5.8, 7, TN), stem(4.75, 5.8, 7, TN), base(1.3, 3.7)],
  U: [stem(0.5, 1.3, 7), stem(4.5, 1.3, 7, TN), ...chain([[0.5, 1.3], [1.8, 0], [3.2, 0], [4.5, 1.3]], [TD, TN, TD]), cap(-0.3, 1.3), cap(3.8, 5.2)],
  V: [ln(0.4, 7, 2.5, 0, TK + 0.1), ln(2.5, 0, 4.6, 7, TN), cap(-0.3, 1.2), cap(3.8, 5.3)],
  W: [ln(0.1, 7, 1.3, 0, TK), ln(1.3, 0, 2.5, 5.4, TN), ln(2.5, 5.4, 3.7, 0, TK), ln(3.7, 0, 4.9, 7, TN), cap(-0.5, 0.8), cap(4.3, 5.5)],
  X: [ln(0.4, 7, 4.6, 0, TK), ln(0.4, 0, 4.6, 7, TN), base(-0.3, 1.2), base(3.8, 5.3), cap(-0.3, 1.2), cap(3.8, 5.3)],
  Y: [ln(0.4, 7, 2.5, 3.5, TK), ln(4.6, 7, 2.5, 3.5, TN), stem(2.5, 0, 3.6), base(1.3, 3.7), cap(-0.3, 1.2), cap(3.8, 5.3)],
  Z: [cap(0.5, 4.6), ln(4.6, 7, 0.4, 0, TK), base(0.4, 4.6), stem(0.5, 5.8, 7, TN), stem(4.6, 0, 1.2, TN)],
  '&': [ln(1.0, 5.3, 4.9, 0, TK), ...chain([[1.0, 5.3], [1.0, 6.2], [1.8, 7], [2.6, 7], [3.4, 6.2], [3.4, 5.6], [0.5, 2.5], [0.5, 1.2], [1.7, 0], [3.0, 0], [4.7, 2.6]],
    [TK, TD, TN, TD, TN, TK, TK, TD, TN, TN])],
  '.': [bar(2.0, 3.0, 0.5, 1.0)],
  "'": [ln(2.7, 7, 2.2, 5.4, TD)],
  '-': [bar(1.0, 4.0, 3.5, 0.8)],
  ' ': [],
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

/* clip a convex polygon (glyph units) to cap height: flat terminals at the baseline and the cap line */
function clipY(poly: [number, number][], a: number, b: number): [number, number][] {
  const cut = (pts: [number, number][], keep: (y: number) => boolean, c: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if (keep(p[1])) out.push(p);
      if (keep(p[1]) !== keep(q[1])) { const t = (c - p[1]) / (q[1] - p[1]); out.push([p[0] + t * (q[0] - p[0]), c]); }
    }
    return out;
  };
  return cut(cut(poly, (y) => y >= a - 1e-9, a), (y) => y <= b + 1e-9, b);
}

/* two convex polygons overlap (separating-axis test; touching is not overlapping) */
function overlap(a: [number, number][], b: [number, number][]): boolean {
  for (const P of [a, b]) for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], nx = q[1] - p[1], ny = p[0] - q[0];
    if (Math.hypot(nx, ny) < 1e-9) continue;
    const pa = a.map(([x, y]) => x * nx + y * ny), pb = b.map(([x, y]) => x * nx + y * ny);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
  }
  return true;
}

/** a stroke's outline in glyph units: a box for a level or upright stroke, else a parallelogram capped half a stroke
    past each end (so facets join without notches); all cut flat at the baseline and the cap line */
function outline([x0, y0, x1, y1, w]: Stroke): { poly: [number, number][]; box: boolean } {
  if (Math.abs(y1 - y0) < 1e-9) return { poly: clipY([[Math.min(x0, x1), y0 - w / 2], [Math.max(x0, x1), y0 - w / 2], [Math.max(x0, x1), y0 + w / 2], [Math.min(x0, x1), y0 + w / 2]], 0, 7), box: true };
  if (Math.abs(x1 - x0) < 1e-9) return { poly: clipY([[x0 - w / 2, Math.min(y0, y1)], [x0 + w / 2, Math.min(y0, y1)], [x0 + w / 2, Math.max(y0, y1)], [x0 - w / 2, Math.max(y0, y1)]], 0, 7), box: true };
  const L = Math.hypot(x1 - x0, y1 - y0), dx = (x1 - x0) / L, dy = (y1 - y0) / L, nx = -dy * w / 2, ny = dx * w / 2, e = w / 2;
  const a: [number, number] = [x0 - dx * e, y0 - dy * e], b: [number, number] = [x1 + dx * e, y1 + dy * e];
  return { poly: clipY([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], 0, 7), box: false };
}

/** Letter units for `text` centred in the box, raised `depth` off the face. Reads left to right seen from outside.
    Strokes that cross or join stand at stepped depths (a millimetre or so apart), so no two units share volume. */
export function letters(text: string, f: SignFace, tint: number, depth = 0.012): PieceSpec[] {
  const chars = [...text.toUpperCase()];
  const H = f.y[1] - f.y[0], W = f.u[1] - f.u[0];
  const px = Math.min(H / 7, W / (chars.length * 6 - 1));
  const tw = px * (chars.length * 6 - 1), y0 = (f.y[0] + f.y[1]) / 2 - 3.5 * px;
  // seen from outside, "right" is +u on a +z face or a -x face, -u on a -z face or a +x face
  const dir = (f.axis === 'x' ? f.out : -f.out) as 1 | -1;
  const start = (f.u[0] + f.u[1]) / 2 - (dir * tw) / 2;
  const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
  const out: PieceSpec[] = [];
  chars.forEach((ch, i) => {
    const U = (gx: number) => start + dir * (i * 6 + gx) * px, Y = (gy: number) => y0 + gy * px;
    const strokes = (G[ch] ?? G[' ']).map(outline).filter((s) => s.poly.length >= 3);
    // stepped depths: each stroke takes the frontmost level none of the strokes it touches already holds
    const lvl: number[] = [];
    strokes.forEach((s, k) => {
      const used = new Set(strokes.slice(0, k).flatMap((o, m) => (overlap(o.poly, s.poly) ? [lvl[m]] : [])));
      let l = 0;
      while (used.has(l)) l++;
      lvl.push(l);
    });
    const n = Math.max(1, ...lvl.map((l) => l + 1)), step = depth / n;
    strokes.forEach((s, k) => {
      const t: Range = f.out > 0 ? [f.at - (lvl[k] + 1) * step, f.at - lvl[k] * step] : [f.at + lvl[k] * step, f.at + (lvl[k] + 1) * step];
      let q: PieceSpec;
      if (s.box) {
        const us = s.poly.map(([gx]) => U(gx)), ys = s.poly.map(([, gy]) => Y(gy));
        const u: Range = [Math.min(...us), Math.max(...us)], y: Range = [Math.min(...ys), Math.max(...ys)];
        q = f.axis === 'x' ? block('wood', u, y, t) : block('wood', t, y, u);
      } else {
        const pts: Vec3[] = [];
        for (const [gx, gy] of s.poly) for (const d of t) pts.push(f.axis === 'x' ? [r5(U(gx)), r5(Y(gy)), d] : [d, r5(Y(gy)), r5(U(gx))]);
        q = hull('wood', pts);
      }
      q.tint = tint; q.finish = 'paint';
      out.push(q);
    });
  });
  return out;
}

/** Sign-write boards: each board (a box member without detail) gets a painted core set back `depth` from the lettered
    face(s) and the letters that fall on it (a box letter split where a line runs over two boards; a slanted stroke
    goes with the board its centre is on). */
export function inscribe(boards: PieceSpec[], units: PieceSpec[], faces: SignFace[], depth = 0.012): PieceSpec[] {
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
      if (u.shape === 'hull') {
        if (u.pos.every((v, i) => v >= lo[i] - 1e-4 && v < hi[i] + 1e-4)) d.push(u);
        continue;
      }
      const ul = u.pos.map((v, i) => v - u.size[i] / 2), uh = u.pos.map((v, i) => v + u.size[i] / 2);
      const cl = ul.map((v, i) => Math.max(v, lo[i])), ch = uh.map((v, i) => Math.min(v, hi[i]));
      if (ch.some((v, i) => v - cl[i] < 0.0015)) continue;
      const q = block(u.mat, [cl[0], ch[0]], [cl[1], ch[1]], [cl[2], ch[2]], { tint: u.tint, finish: u.finish });
      d.push(q);
    }
    return withDetail({ ...b }, d);
  });
}
