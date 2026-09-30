/* Plan geometry for a felling hinge: where a toppling stack still bears on what is under it, and the edge of that
   bearing it turns over. Points are [x, z] in world metres. */

export type P2 = [number, number];

/** Convex hull (monotone chain), counter-clockwise, no repeated end point. */
export function hull2(pts: P2[]): P2[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [], hi: P2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 1e-12) hi.pop();
    hi.push(q);
  }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

/** The part of convex polygon `a` inside convex polygon `b` (both counter-clockwise), Sutherland–Hodgman. */
export function clip2(a: P2[], b: P2[]): P2[] {
  let out = a;
  for (let i = 0; i < b.length && out.length; i++) {
    const p = b[i], q = b[(i + 1) % b.length];
    const inside = (r: P2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) >= -1e-9;
    const src = out;
    out = [];
    for (let j = 0; j < src.length; j++) {
      const c = src[j], d = src[(j + 1) % src.length];
      const ci = inside(c), di = inside(d);
      if (ci) out.push(c);
      if (ci !== di) {
        const ex = d[0] - c[0], ez = d[1] - c[1], fx = q[0] - p[0], fz = q[1] - p[1];
        const den = ex * fz - ez * fx;
        if (Math.abs(den) > 1e-12) {
          const t = ((p[0] - c[0]) * fz - (p[1] - c[1]) * fx) / den;
          out.push([c[0] + ex * t, c[1] + ez * t]);
        }
      }
    }
  }
  return out;
}

/** Area and centroid of a simple polygon. */
export function area2(poly: P2[]): { a: number; c: P2 } {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    const k = x0 * z1 - x1 * z0;
    a += k; cx += (x0 + x1) * k; cz += (z0 + z1) * k;
  }
  a /= 2;
  if (Math.abs(a) < 1e-12) {
    const n = Math.max(1, poly.length);
    return { a: 0, c: [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n] };
  }
  return { a: Math.abs(a), c: [cx / (6 * a), cz / (6 * a)] };
}
