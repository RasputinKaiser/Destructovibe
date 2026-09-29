import type { MaterialId, PieceSpec, Vec3 } from '../../types.ts';
import { block, hull, swapXZ, weldParts, type Range } from '../../levels/kit.ts';
import { withDetail } from '../../levels/layers.ts';

export function hullOf(mat: 'roof', pts: [number, number, number][], tint: number): PieceSpec {
  const min = [0, 1, 2].map((k) => Math.min(...pts.map((q) => q[k]))), max = [0, 1, 2].map((k) => Math.max(...pts.map((q) => q[k])));
  const c = min.map((v, k) => (v + max[k]) / 2) as [number, number, number];
  return { mat, shape: 'hull', pos: c, size: max.map((v, k) => v - min[k]) as [number, number, number], verts: pts.map((q) => [q[0] - c[0], q[1] - c[1], q[2] - c[2]] as [number, number, number]), tint };
}

/* ---------------- pointed (lancet) openings ---------------- */

export interface Lancet {
  /** centre along the wall, clear width */
  c: number; w: number;
  /** sill (0 for a doorway) and springing heights */
  y0: number; spring: number;
  /** arc radius as a multiple of the width: 1 = equilateral arch, > 1 a lancet */
  r?: number;
  /** what fills it: leaded glazing, a boarded door leaf, or nothing (an open archway) */
  fill?: 'glass' | 'door' | 'open';
}

/** Arch polyline of a pointed opening a..b springing at `spring`: two arcs struck from centres on the springing line,
    three chords a side, as [u, y] from the left springing over the apex to the right springing. */
export function archPoints(a: number, b: number, spring: number, rk = 1.4): [number, number][] {
  const w = b - a, R = rk * w, c = (a + b) / 2;
  const fa = Math.acos((c - a - R) / R);
  const left: [number, number][] = [];
  for (let i = 0; i <= 3; i++) {
    const f = Math.PI - ((Math.PI - fa) * i) / 3;
    left.push(i === 3 ? [c, spring + R * Math.sin(fa)] : [a + R + R * Math.cos(f), spring + R * Math.sin(f)]);
  }
  left[0] = [a, spring];
  const right = left.slice(0, 3).reverse().map(([u, y]) => [a + b - u, y] as [number, number]);
  return [...left, ...right];
}

export const apexOf = (l: Lancet): number => archPoints(l.c - l.w / 2, l.c + l.w / 2, l.spring, l.r)[3][1];

/* heights of the arch (or the flat top below the springing) at u, for strips of a filling */
function archY(pts: [number, number][], u: number): number {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [u0, y0] = pts[i], [u1, y1] = pts[i + 1];
    if (u >= Math.min(u0, u1) - 1e-9 && u <= Math.max(u0, u1) + 1e-9) return u1 === u0 ? Math.max(y0, y1) : y0 + ((y1 - y0) * (u - u0)) / (u1 - u0);
  }
  return pts[0][1];
}

type Map3 = (u: number, y: number, t: number) => Vec3;

/* a vertical strip u0..u1 from y0 up to the arch (a convex prism: the arch polygon is convex) */
function stripUnder(mat: MaterialId, pts: [number, number][], u: Range, y0: number, t: Range, m: Map3, drop = 0): PieceSpec {
  const tops: [number, number][] = [[u[0], archY(pts, u[0]) - drop], [u[1], archY(pts, u[1]) - drop]];
  for (const [pu, py] of pts) if (pu > u[0] + 1e-6 && pu < u[1] - 1e-6) tops.push([pu, py - drop]);
  const q: Vec3[] = [];
  for (const tt of t) { q.push(m(u[0], y0, tt), m(u[1], y0, tt)); for (const [pu, py] of tops) q.push(m(pu, py, tt)); }
  return hull(mat, q);
}

export interface ArchWallOpts {
  from: number; to: number;
  /** wall thickness band on the across axis, and which side is outside */
  t: Range; out: 1 | -1;
  h: number;
  openings: Lancet[];
  tint: number; dress: number;
  /** stonework: quoins at these ends (building corners), quoin returns (the other wall's quoins show here in
      alternate courses), a limewashed plaster inner face, or stone both faces (porch) */
  quoins?: ('from' | 'to')[]; returns?: ('from' | 'to')[]; plaster?: boolean; twoFaced?: boolean;
  /** a plain dressed through-stone at u × y, where a service can be sleeved without cutting the walling (with
      `lift`, it stands in the lower lift and its top is the lift) */
  through?: { u: Range; y: Range };
  /** a horizontal break line at this height (the sill string course): below it the wall is laid in bays split at
      the window centres and round doorways, above it piers between the openings and the heads — so a blown wall
      comes apart in course-high lifts and bays, not full-height slabs */
  lift?: number;
}

/** A stone wall along X with pointed openings: plain piers and sill panels (which take coursed-stone detail later),
    each opening's head as one body — the walling over the apex plus the dressed spandrel stones cut to the arch —
    and its filling: a leaded light (lead cames, a saddle bar line), a boarded door, or nothing. Swap the result for a
    wall along Z. */
export function archWall(o: ArchWallOpts): PieceSpec[] {
  const m: Map3 = (u, y, t) => [u, y, t];
  const ps: PieceSpec[] = [];
  const stone = { tint: o.tint };
  const tm = (o.t[0] + o.t[1]) / 2;
  const ops = [...o.openings].sort((p, q) => p.c - q.c);
  const edges = ops.map((l) => ({ a: l.c - l.w / 2, b: l.c + l.w / 2, y: [l.y0, apexOf(l)] as Range }));
  const ends = (u: Range) => ({
    quoin: [...(o.quoins?.includes('from') && Math.abs(u[0] - o.from) < 1e-6 ? [u[0]] : []), ...(o.quoins?.includes('to') && Math.abs(u[1] - o.to) < 1e-6 ? [u[1]] : [])],
    ret: [...(o.returns?.includes('from') && Math.abs(u[0] - o.from) < 1e-6 ? [u[0]] : []), ...(o.returns?.includes('to') && Math.abs(u[1] - o.to) < 1e-6 ? [u[1]] : [])],
    jambs: edges.flatMap((e) => [...(Math.abs(e.b - u[0]) < 1e-6 ? [{ u: u[0], y: e.y }] : []), ...(Math.abs(e.a - u[1]) < 1e-6 ? [{ u: u[1], y: e.y }] : [])]),
  });
  const walling = (u: Range, y: Range, extra: Partial<RubbleOpts> = {}): PieceSpec => {
    const q = block('stone', u, y, o.t, stone);
    return withDetail(q, rubble(u, y, o.t, o.out, { tint: o.tint, dress: o.dress, plaster: o.plaster, twoFaced: o.twoFaced, ...ends(u), ...extra }));
  };
  const L = o.lift;
  const pier = (u: Range) => {
    const th = o.through;
    if (L !== undefined) ps.push(walling(u, [L, o.h]));
    else if (th && th.u[0] >= u[0] - 1e-6 && th.u[1] <= u[1] + 1e-6) {
      ps.push(walling(u, [0, th.y[0]]), walling(u, [th.y[1], o.h]));
      ps.push(block('stone', u, th.y, o.t, { tint: o.dress }));
    } else ps.push(walling(u, [0, o.h]));
  };
  if (L !== undefined) {
    // the lower lift: bays between the window centres, stopping at doorways; the through-stone gets a column of its own
    const th = o.through;
    let segs: Range[] = [[o.from, o.to]];
    for (const e of edges) if (e.y[0] < L - 1e-6) segs = segs.flatMap((s) => [[s[0], Math.min(s[1], e.a)], [Math.max(s[0], e.b), s[1]]] as Range[]).filter((s) => s[1] - s[0] > 1e-6);
    const cuts = ops.filter((l) => l.y0 >= L - 1e-6).map((l) => l.c).filter((c) => !th || c < th.u[0] - 0.3 || c > th.u[1] + 0.3);
    // (a bay shorter than 1.2 m would only be a strip of stones: those runs stay whole)
    for (const c of cuts) segs = segs.flatMap((s) => (c > s[0] + 1.2 && c < s[1] - 1.2 ? [[s[0], c], [c, s[1]]] as Range[] : [s]));
    for (const s of segs) {
      if (th && th.u[0] >= s[0] - 1e-6 && th.u[1] <= s[1] + 1e-6) {
        if (th.u[0] - s[0] > 1e-6) ps.push(walling([s[0], th.u[0]], [0, L]));
        ps.push(walling(th.u, [0, th.y[0]]), block('stone', th.u, [th.y[0], L], o.t, { tint: o.dress }));
        if (s[1] - th.u[1] > 1e-6) ps.push(walling([th.u[1], s[1]], [0, L]));
      } else ps.push(walling(s, [0, L]));
    }
  }
  let cur = o.from;
  for (const l of ops) {
    const a = l.c - l.w / 2, b = l.c + l.w / 2;
    if (a - cur > 1e-6) pier([cur, a]);
    cur = b;
    if (L !== undefined) { if (l.y0 > L + 1e-6) ps.push(walling([a, b], [L, l.y0], { sill: true })); }
    else if (l.y0 > 0) ps.push(walling([a, b], [0, l.y0], { sill: true }));
    const pts = archPoints(a, b, l.spring, l.r ?? 1.4), apex = pts[3][1];
    // head: a ring of dressed voussoirs struck from the two arc centres (and a keystone), rubble spandrels fanned
    // out to the head's corners, walling over it — one body, its detail the same stones
    const R = (l.r ?? 1.4) * (b - a), cL: [number, number] = [a + R, l.spring], cRt: [number, number] = [b - R, l.spring];
    let vd = Math.max(0.06, Math.min(0.2, o.h - apex - 0.03));
    let yE = Math.min(o.h, apex + vd + 0.02);
    if (o.h - yE < 0.05) { yE = o.h; vd = Math.min(vd, o.h - apex - 0.005); }
    const ext = (p: [number, number], c: [number, number]): [number, number] => {
      const dx = p[0] - c[0], dy = p[1] - c[1], l2 = Math.hypot(dx, dy) || 1;
      // points that land within 50 mm of a jamb go onto it, so no sliver of spandrel is left between them
      let x = Math.min(b, Math.max(a, p[0] + (dx / l2) * vd));
      if (x - a < 0.05) x = a; else if (b - x < 0.05) x = b;
      return [x, Math.min(yE, p[1] + (dy / l2) * vd)];
    };
    const eL = [0, 1, 2, 3].map((i) => ext(pts[i], cL)), eR = [6, 5, 4, 3].map((i) => ext(pts[i], cRt));
    const kt: [number, number] = [(a + b) / 2, yE];
    const poly = (q2: [number, number][], tr: Range = o.t) => {
      const q: Vec3[] = [];
      for (const tt of tr) for (const p of q2) q.push(m(p[0], p[1], tt));
      return hull('stone', q);
    };
    // a stone of the head as detail: an 11 mm face skin (flat, no arris chamfer, crumbles to dust) on each exposed
    // face over the body, which is what flies
    const outF = o.out > 0 ? o.t[1] : o.t[0], dir = o.out > 0 ? -1 : 1;
    const layers = (q2: [number, number][], tint: number, rho: number): PieceSpec[] => {
      const band = (a: number, b2: number): Range => { const x = outF + dir * a, y = outF + dir * b2; return [Math.min(x, y), Math.max(x, y)]; };
      const T = o.t[1] - o.t[0], inner = o.twoFaced ? 0.011 : 0;
      const out: PieceSpec[] = [poly(q2, band(0, 0.011)), poly(q2, band(0.011, T - inner))];
      if (inner) out.push(poly(q2, band(T - inner, T)));
      return out.map((u, k) => { if (k !== 1) u.mat = 'drywall'; u.tint = tint; u.density = k === 1 ? rho : 2500; return u; });
    };
    const area = (q2: [number, number][]) => { let s2 = 0; for (let i = 0; i < q2.length; i++) { const [x1, y1] = q2[i], [x2, y2] = q2[(i + 1) % q2.length]; s2 += x1 * y2 - x2 * y1; } return Math.abs(s2) / 2; };
    const dedup = (q2: [number, number][]) => q2.filter((p, i) => q2.findIndex((r) => Math.hypot(r[0] - p[0], r[1] - p[1]) < 1e-5) === i);
    const vous: [number, number][][] = [], fans: [number, number][][] = [];
    const leftP = [0, 1, 2, 3].map((i) => pts[i]), rightP = [6, 5, 4, 3].map((i) => pts[i]);
    for (const [P2, E2] of [[leftP, eL], [rightP, eR]] as [[number, number][], [number, number][]][]) {
      for (let i = 0; i < 3; i++) vous.push(dedup([P2[i], P2[i + 1], E2[i + 1], E2[i]]));
    }
    vous.push(dedup([pts[3], eR[3], kt, eL[3]]));
    const cornerL: [number, number] = [a, yE], cornerR: [number, number] = [b, yE];
    const chainL = [...eL, kt], chainR = [...eR, kt];
    for (let i = 0; i + 1 < chainL.length; i++) fans.push(dedup([cornerL, chainL[i], chainL[i + 1]]));
    for (let i = 0; i + 1 < chainR.length; i++) fans.push(dedup([cornerR, chainR[i + 1], chainR[i]]));
    fans.push(dedup([cornerL, kt, cornerR]));
    const vq = vous.filter((q2) => q2.length >= 3 && area(q2) > 2e-4), fq = fans.filter((q2) => q2.length >= 3 && area(q2) > 2e-4);
    const vp = vq.map((q2) => poly(q2)), fp = fq.map((q2) => poly(q2));
    const vdet = vq.flatMap((q2, i) => layers(q2, tone(o.dress, 0.95 + 0.07 * h3(i, 41)), 2500));
    const fdet = fq.flatMap((q2, i) => layers(q2, tone(RUBBLE[Math.floor(h3(i, 43) * RUBBLE.length)], 0.95), 2400));
    const parts: PieceSpec[] = [...vp, ...fp];
    let wall: PieceSpec[] = [];
    if (o.h - yE > 0.049) {
      parts.unshift(block('stone', [a, b], [yE, o.h], o.t, stone));
      wall = rubble([a, b], [yE, o.h], o.t, o.out, { tint: o.tint, dress: o.dress, plaster: o.plaster, twoFaced: o.twoFaced, quoin: [], ret: [], jambs: [] });
    }
    const head = weldParts(parts, { tint: o.dress });
    ps.push(withDetail(head, [...wall, ...vdet, ...fdet]));
    const fill = l.fill ?? (l.y0 > 0 ? 'glass' : 'door');
    if (fill === 'glass') ps.push(leadedLight(pts, l.y0, [tm - 0.03, tm + 0.03], m));
    else if (fill === 'door') {
      const dt: Range = o.out > 0 ? [o.t[0] + 0.04, o.t[0] + 0.12] : [o.t[1] - 0.12, o.t[1] - 0.04];
      ps.push(boardedDoor(pts, dt, m));
    }
  }
  if (o.to - cur > 1e-6) pier([cur, o.to]);
  return ps;
}

/* leaded light: the pane (one body, the opening's shape) with lead cames in quarries and iron saddle bars as detail */
function leadedLight(pts: [number, number][], y0: number, t: Range, m: Map3): PieceSpec {
  const a = pts[0][0], b = pts[6][0], c = (a + b) / 2;
  const q: Vec3[] = [];
  for (const tt of t) { q.push(m(a, y0, tt), m(b, y0, tt)); for (const [u, y] of pts) q.push(m(u, y, tt)); }
  const pane = hull('glass', q, { finish: 'smoked' });
  const d: PieceSpec[] = [];
  const lead = 0x3b3e42, glassT: Range = [t[0] + 0.024, t[1] - 0.024], cameT: Range = [t[0] + 0.022, t[1] - 0.022];
  const cw = 0.012, rows: number[] = [];
  for (let y = y0 + 0.36; y < pts[0][1] - 0.1; y += 0.36) rows.push(y);
  const bands: Range[] = [];
  let y = y0;
  for (const r of rows) { bands.push([y, r - cw / 2]); y = r + cw / 2; }
  const lights: Range[] = [[a + 0.001, c - cw / 2], [c + cw / 2, b - 0.001]];
  for (const lu of lights) {
    for (const bnd of bands) {
      const g = block('glass', lu, bnd, glassT); g.tint = 0xc4d4c6; g.finish = 'smoked'; d.push(g);
    }
    const g = stripUnder('glass', pts, lu, y + 0.0005, glassT, m, 0.002); g.tint = 0xc4d4c6; g.finish = 'smoked'; d.push(g);
  }
  for (const r of rows) for (const lu of lights) { const cm = block('metal', lu, [r - cw / 2, r + cw / 2], cameT); cm.tint = lead; d.push(cm); }
  const mv = stripUnder('metal', pts, [c - cw / 2, c + cw / 2], y0, cameT, m, 0.004); mv.tint = lead; d.push(mv);
  return withDetail(pane, d);
}

/* boarded (ledged) door filling the arch, boards as detail cut to the arch */
function boardedDoor(pts: [number, number][], t: Range, m: Map3): PieceSpec {
  const a = pts[0][0], b = pts[6][0];
  const q: Vec3[] = [];
  for (const tt of t) { q.push(m(a, 0, tt), m(b, 0, tt)); for (const [u, y] of pts) q.push(m(u, y, tt)); }
  const leaf = hull('wood', q, { tint: 0x5a3b26 });
  const d: PieceSpec[] = [];
  const n = Math.max(3, Math.round((b - a) / 0.15));
  for (let i = 0; i < n; i++) {
    const u: Range = [a + ((b - a) * i) / n + (i ? 0.0015 : 0.001), a + ((b - a) * (i + 1)) / n - (i === n - 1 ? 0.001 : 0)];
    const s = stripUnder('wood', pts, u, 0.001, t, m, 0.002);
    s.tint = i % 2 ? 0x5a3b26 : 0x523622;
    d.push(s);
  }
  return withDetail(leaf, d);
}

/* ---------------- coursed stone in a convex polygon (gables) ---------------- */

/** Stone courses filling a convex polygon (u, y) in a wall along X (thickness band t): each course cut at the
    polygon's edges into stones of a few lengths, the end stones hulls following the slope. Each stone is its body
    with an 11 mm face skin on the outer face (`out`, the +t or -t side) and, with `both`, on the inner face too:
    the skins draw flat and crumble to dust, the bodies fly. */
export function coursedPolygon(poly: [number, number][], t: Range, o: { tint: number; seed?: number; out?: 1 | -1; both?: boolean } = { tint: 0xb9ad96 }): PieceSpec[] {
  const ys = poly.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = polySpan(poly);
  const out: PieceSpec[] = [];
  const seed = o.seed ?? 7;
  const sgn = o.out ?? 1, T = t[1] - t[0], J = 0.0115, R = 0.008;
  const band = (a: number, b: number): Range => (sgn > 0 ? [t[1] - b, t[1] - a] : [t[0] + a, t[0] + b]);
  const bands: [Range, boolean][] = o.both ? [[band(0, 0.011), true], [band(0.011, T - 0.011), false], [band(T - 0.011, T), true]] : [[band(0, 0.011), true], [band(0.011, T), false]];
  // a stone: skins and body, or (a slope-cut end stone) one body, whose odd outline would be a draw batch of its own
  const put = (q2: [number, number][], tint: number, skins: boolean) => {
    for (const [tr, skin] of skins ? bands : [[t, false] as [Range, boolean]]) {
      const q: Vec3[] = [];
      for (const tt of tr) for (const [u, y] of q2) q.push([u, y, tt]);
      const s = hull(skin ? 'drywall' : 'stone', q); s.tint = tint; s.density = skin ? 2500 : 2400; out.push(s);
    }
  };
  const mortar = (u: Range, y: Range) => {
    const c = (u[0] + u[1]) / 2, w = Math.min(u[1] - u[0], J);
    const m = block('concrete', [c - w / 2, c + w / 2], y, [t[0] + R, t[1] - R]); m.tint = MORTAR; m.density = 1800; out.push(m);
  };
  const rows = rowsIn(y0, y1);
  rows.forEach((r, ri) => {
    const top = ri === rows.length - 1;
    const ya = r.y[0] + 0.001, yb = r.y[1] - (top ? 0.001 : J);
    const sa = span(ya), sb = span(yb);
    if (!sa || !sb) return;
    const lo = Math.max(sa[0], sb[0]), hi = Math.min(sa[1], sb[1]);
    const tint = (i: number) => tone(RUBBLE[Math.floor(h3(seed, ri, 30 + i) * RUBBLE.length)], 0.9 + 0.18 * h3(seed, ri, 60 + i));
    if (!top) {
      const s0 = span(r.y[1] - J), s1 = span(r.y[1]);
      if (s0 && s1) { const m = block('concrete', [Math.max(s0[0], s1[0]) + 0.002, Math.min(s0[1], s1[1]) - 0.002], [r.y[1] - J, r.y[1]], [t[0] + R, t[1] - R]); m.tint = MORTAR; m.density = 1800; out.push(m); }
    }
    if (hi - lo < 0.3) {
      // the apex course: one stone following both slopes
      put([[sa[0] + 0.001, ya], [sa[1] - 0.001, ya], [sb[1] - 0.001, yb], [sb[0] + 0.001, yb]], tint(0), false);
      return;
    }
    const slopeL = Math.abs(sa[0] - sb[0]) > 1e-4, slopeR = Math.abs(sa[1] - sb[1]) > 1e-4;
    const fit = fitRow(hi - lo - 0.002, RUBBLE_L, seed * 17 + r.k, J);
    let x = lo + 0.001;
    fit.lens.forEach((len, i) => {
      const first = i === 0, last = i + 1 === fit.lens.length;
      const ua = x, ub = x + len;
      const cutL = first && slopeL, cutR = last && slopeR;
      put([[cutL ? sa[0] + 0.001 : ua, ya], [cutR ? sa[1] - 0.001 : ub, ya], [cutR ? sb[1] - 0.001 : ub, yb], [cutL ? sb[0] + 0.001 : ua, yb]], tint(i), !cutL && !cutR);
      x = ub;
      if (!last) { mortar([x, x + J + fit.e], [ya, yb]); x += J + fit.e; }
    });
  });
  return out;
}

/* the polygon's u extent at height y */
function polySpan(poly: [number, number][]): (y: number) => Range | null {
  return (y: number) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [u0, v0] = poly[i], [u1, v1] = poly[(i + 1) % poly.length];
      if ((y < Math.min(v0, v1) - 1e-9) || (y > Math.max(v0, v1) + 1e-9)) continue;
      if (Math.abs(v1 - v0) < 1e-9) { lo = Math.min(lo, u0, u1); hi = Math.max(hi, u0, u1); continue; }
      const u = u0 + ((u1 - u0) * (y - v0)) / (v1 - v0);
      lo = Math.min(lo, u); hi = Math.max(hi, u);
    }
    return lo < hi ? [lo, hi] : null;
  };
}

/* the building's courses between y0 and y1, a sliver at either end merged into its neighbour */
function rowsIn(y0: number, y1: number): { y: Range; k: number }[] {
  const rows: { y: Range; k: number }[] = [];
  COURSES.forEach((c, k) => {
    const y: Range = [Math.max(c.y[0], y0), Math.min(c.y[1], y1)];
    if (y[1] - y[0] <= 1e-6) return;
    if (y[1] - y[0] < 0.06 && rows.length) rows[rows.length - 1].y[1] = y[1];
    else rows.push({ y, k });
  });
  if (rows.length > 1 && rows[0].y[1] - rows[0].y[0] < 0.06) { rows[1].y[0] = rows[0].y[0]; rows.shift(); }
  return rows;
}

/** A gable (convex polygon in u = z, y, standing across x in `xr`) laid as masonry that can come apart: horizontal
    lifts on course lines (at `lifts`), each lift split into blocks at `splits[lift]` along a perpend that runs up the
    lift. Blocks in a lift stand side by side across an open 12 mm joint (the perished lime of a 150-year-old gable
    carries no tension): each bears only on the lift below, so one that loses its support drops, rather than the gable
    hanging off its neighbours as one triangle. (A stepped, bonded break line interlocks: the blocks' teeth would
    catch on each other as rigid bodies.) Each block is one body (its courses as parts) carrying its stones as detail;
    `out` is the outer face's side of x. */
export function gableBlocks(poly: [number, number][], xr: Range, tint: number, o: { lifts: number[]; splits: number[][]; out: 1 | -1; seed?: number }): PieceSpec[] {
  const ys = poly.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = polySpan(poly);
  const rows = rowsIn(y0, y1);
  // the apex course, if too narrow to stand on its own, joins the one below
  while (rows.length > 1) {
    const r = rows[rows.length - 1], s = span(r.y[0] + 1e-4);
    if (s && s[1] - s[0] >= 0.7) break;
    rows[rows.length - 2].y[1] = r.y[1]; rows.pop();
  }
  const liftOf = (y: number) => o.lifts.filter((l) => l <= y + 1e-6).length;
  const blocks = new Map<string, { parts: PieceSpec[]; detail: PieceSpec[] }>();
  const live = o.splits.map((s) => [...s]);
  rows.forEach((r, ri) => {
    const li = liftOf(r.y[0]), sa = span(r.y[0]), sb = span(r.y[1]);
    if (!sa || !sb) return;
    const lo = Math.max(sa[0], sb[0]), hi = Math.min(sa[1], sb[1]);
    // a split the lift narrows past is dropped for the rest of the lift (its blocks merge), never reinstated
    if (live[li]) live[li] = live[li].filter((c) => c > lo + 0.4 && c < hi - 0.4);
    const cuts = live[li] ?? [];
    const bounds = [-Infinity, ...cuts, Infinity];
    for (let j = 0; j + 1 < bounds.length; j++) {
      const a = Number.isFinite(bounds[j]) ? bounds[j] + 0.006 : bounds[j], b = Number.isFinite(bounds[j + 1]) ? bounds[j + 1] - 0.006 : bounds[j + 1];
      // the course segment's outline: sloped at the polygon's ends, plumb at the cuts
      const q2: [number, number][] = [
        [Number.isFinite(a) ? a : sa[0], r.y[0]], [Number.isFinite(b) ? b : sa[1], r.y[0]],
        [Number.isFinite(b) ? b : sb[1], r.y[1]], [Number.isFinite(a) ? a : sb[0], r.y[1]],
      ];
      // which block: counted from the left among the splits the row still has
      const key = `${li}:${(o.splits[li] ?? []).filter((c) => Number.isFinite(a) && c <= a + 1e-6).length}`;
      const pts: Vec3[] = [];
      for (const x of xr) for (const [u, y] of q2) pts.push([u, y, x]);
      const part = hull('stone', pts);
      const st = coursedPolygon(q2, xr, { tint, seed: 7 + ri * 31 + j * 7, out: o.out, both: true });
      let bk = blocks.get(key);
      if (!bk) { bk = { parts: [], detail: [] }; blocks.set(key, bk); }
      bk.parts.push(part); bk.detail.push(...st);
    }
  });
  const out: PieceSpec[] = [];
  for (const { parts, detail } of blocks.values()) {
    const b = parts.length > 1 ? weldParts(parts, { tint }) : { ...parts[0], tint };
    out.push(withDetail(b, detail));
  }
  return swapXZ(out);
}

/** A gable (convex polygon in u = z, y) as one stone hull across x in `xr`, with coursed-stone detail. */
export function gable(poly: [number, number][], xr: Range, tint: number, out: 1 | -1 = 1): PieceSpec {
  const q: Vec3[] = [];
  for (const x of xr) for (const [u, y] of poly) q.push([x, y, u]);
  const p = hull('stone', q, { tint });
  const d = swapXZ(coursedPolygon(poly, xr, { tint, out, both: true }));
  return withDetail(p, d);
}

/* ---------------- squared rubble ---------------- */

const RUBBLE_L = [0.28, 0.35, 0.42, 0.49, 0.56], DRESSED_L = [0.7, 0.77, 0.84, 0.91, 0.98];

/** Stone lengths from `set` (joints J between) filling W: drawn in turn, then the longest that still fits, then
    stones lengthened a step at a time while a whole step is left; what remains widens the perpends by `e`. */
function fitRow(W: number, set: number[], seed: number, J: number): { lens: number[]; e: number } {
  if (W < set[0] + 1e-9) return { lens: [W], e: 0 };
  const lens: number[] = [];
  let used = -J;
  for (let i = 0; ; i++) {
    const L = set[Math.floor(h3(seed, i, 5) * set.length)];
    if (used + J + L > W + 1e-9) break;
    lens.push(L); used += J + L;
  }
  for (;;) {
    const f = set.filter((s2) => used + J + s2 <= W + 1e-9).pop();
    if (f === undefined) break;
    lens.push(f); used += J + f;
  }
  if (lens.length < 2) return { lens: [W], e: 0 };
  let left = W - used;
  const step = set[1] - set[0], max = set[set.length - 1];
  for (let i = 0; left >= step - 1e-9 && i < 400; i++) {
    const j = Math.floor(h3(seed, i, 7) * lens.length);
    if (lens[j] + step <= max + 1e-9) { lens[j] = Math.round((lens[j] + step) * 1000) / 1000; left -= step; }
    else if (lens.every((l) => l + step > max + 1e-9)) break;
  }
  return { lens, e: Math.max(0, left) / (lens.length - 1) };
}

/** The building's courses (builder y): a dressed plinth, rubble courses to a dressed sill-level string course, rubble
    above. Every wall and gable takes its stones from the same courses, so the coursing runs round the building. */
export const COURSES: { y: Range; kind: 'plinth' | 'string' | 'rubble' }[] = (() => {
  const out: { y: Range; kind: 'plinth' | 'string' | 'rubble' }[] = [{ y: [0, 0.32], kind: 'plinth' }];
  let y = 0.32;
  // five course heights, not a continuum: every distinct face-stone size is a draw batch of its own
  for (const h of [0.26, 0.26, 0.24, 0.26]) { out.push({ y: [y, y + h], kind: 'rubble' }); y += h; }
  out.push({ y: [1.34, 1.5], kind: 'string' });
  y = 1.5;
  const pat = [0.22, 0.18, 0.26, 0.2, 0.24, 0.2, 0.22, 0.24, 0.26, 0.18, 0.24];
  for (let i = 0; y < 16; i++) { const h = pat[i % pat.length]; out.push({ y: [y, y + h], kind: 'rubble' }); y += h; }
  return out;
})();

function h3(a: number, b: number, c = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
const RUBBLE = [0x9a968e, 0x8a8781, 0xa8a49a, 0x7d7a74, 0xa39a86, 0x95897a, 0xb2a894, 0x8c7f6c, 0x9d9a91, 0x6f6c66, 0xb5ad9d, 0x8e8577];
const tone = (c: number, k: number): number =>
  (Math.min(255, Math.round(((c >> 16) & 255) * k)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k));
export const MORTAR = 0xcfc8b4, CORE = 0x8f887a, LIMEWASH = 0xeee9dc;

export interface RubbleOpts {
  tint: number; dress: number;
  quoin: number[]; ret: number[]; jambs: { u: number; y: Range }[];
  plaster?: boolean; twoFaced?: boolean; sill?: boolean;
}

/** Squared-rubble walling for a wall block u × y (along X, thickness band t, outside toward `out`): stones of varied
    length and tone in the building's courses, occasional snecks, lime mortar joints raked back 8 mm, dressed quoins
    and returns at corners, dressed jamb stones beside openings, a dressed sill course under windows; a rubble core
    behind, and either limewashed plaster or a second stone face on the inside. */
export function rubble(U: Range, Y: Range, t: Range, out: 1 | -1, o: RubbleOpts): PieceSpec[] {
  const T = t[1] - t[0], FD = Math.min(0.16, T / 2 - 0.01), J = 0.0115, R = 0.008;  // joints under the 12 mm cosmetic limit: struck mortar goes to dust, not bodies
  const d: PieceSpec[] = [];
  const depth = (a: number, b: number, inner = false): Range => {
    // a band a..b deep from the outer face (or from the inner face)
    const face = (out > 0) !== inner ? t[1] : t[0], dir = (out > 0) !== inner ? -1 : 1;
    const p = face + dir * a, q = face + dir * b;
    return [Math.min(p, q), Math.max(p, q)];
  };
  const put = (u: Range, y: Range, dd: Range, tint: number, rho: number, mat: 'stone' | 'concrete' | 'plaster' = 'stone') => {
    if (u[1] - u[0] < 0.004 || y[1] - y[0] < 0.004) return;
    const q = block(mat, u, y, dd); q.tint = tint; q.density = rho; d.push(q);
  };
  /* a stone seen on a face: its weathered face as an 11 mm skin over the stone's body, which is what flies. The skin
     is a hull, so it draws flat (no arris chamfer: it is under the cosmetic limit) with its texture unstretched (a
     box skin draws it squashed from a unit cube: the wood grain). Every skin's texture starts at its own corner, so
     the set must be near-uniform: the 'drywall' set's fine stipple reads as a tooled face, where 'stone' (coursed
     ashlar: bricks inside every stone) and 'plaster' (a dirt cloud: the same smudge on every stone) do not. The
     stone's colour is its tint. It crumbles to dust when struck. */
  const skin = (u: Range, y: Range, dd: Range, tint: number) => {
    if (u[1] - u[0] < 0.004 || y[1] - y[0] < 0.004) return;
    const q: Vec3[] = [];
    for (const a of u) for (const b of y) for (const c of dd) q.push([a, b, c]);
    const k = hull('drywall', q); k.tint = tint; k.density = 2500; d.push(k);
  };
  // a perpend: one mortar strip under the cosmetic limit in the middle; the slack either side reads as a deeper joint
  const joint = (u: Range, y: Range, dd: Range) => {
    const c = (u[0] + u[1]) / 2, w = Math.min(u[1] - u[0], J);
    put([c - w / 2, c + w / 2], y, dd, MORTAR, 1800, 'concrete');
  };
  const stone = (u: Range, y: Range, a: number, b: number, inside: boolean, tint: number) => {
    skin(u, y, inside ? depth(a, a + 0.011, true) : depth(a, a + 0.011), tint);
    put(u, y, inside ? depth(a + 0.011, b, true) : depth(a + 0.011, b), tint, 2500);
  };
  // courses clipped to the block; slivers merge into the course below
  const rows: { y: Range; kind: string; k: number }[] = [];
  COURSES.forEach((c, k) => {
    const y: Range = [Math.max(c.y[0], Y[0]), Math.min(c.y[1], Y[1])];
    if (y[1] - y[0] <= 1e-6) return;
    if (y[1] - y[0] < 0.06 && rows.length) rows[rows.length - 1].y[1] = y[1];
    else rows.push({ y, kind: c.kind, k });
  });
  if (rows.length > 1 && rows[0].y[1] - rows[0].y[0] < 0.06) { rows[1].y[0] = rows[0].y[0]; rows.shift(); }
  const faces = o.twoFaced ? [false, true] : [false];
  rows.forEach((row, ri) => {
    const { k } = row;
    const top = ri === rows.length - 1 && Math.abs(row.y[1] - Y[1]) < 1e-6;
    const sy: Range = [row.y[0], top ? row.y[1] : row.y[1] - J];
    const dressed = row.kind !== 'rubble' || (o.sill && ri === rows.length - 1);
    // quoins (through-stones) and returns at the ends, jamb dressings beside openings
    const stops: { u: Range; through: boolean }[] = [];
    for (const q of o.quoin) { const L = k % 2 ? 0.56 : 0.3; stops.push({ u: q <= U[0] + 1e-6 ? [U[0], U[0] + L] : [U[1] - L, U[1]], through: true }); }
    for (const q of o.ret) if (k % 2 === 0) stops.push({ u: q <= U[0] + 1e-6 ? [U[0], U[0] + 0.25] : [U[1] - 0.25, U[1]], through: false });
    for (const jb of o.jambs) if (row.y[1] > jb.y[0] + 0.02 && row.y[0] < jb.y[1] - 0.02) { const L = k % 2 ? 0.38 : 0.22; stops.push({ u: jb.u <= U[0] + 1e-6 ? [U[0], U[0] + L] : [U[1] - L, U[1]], through: false }); }
    // a narrow pier cannot take full-length dressings at both ends
    const w = U[1] - U[0], lo = stops.filter((s) => s.u[0] <= U[0] + 1e-6), hi = stops.filter((s) => s.u[1] >= U[1] - 1e-6);
    const need = Math.max(0, ...lo.map((s) => s.u[1] - s.u[0])) + Math.max(0, ...hi.map((s) => s.u[1] - s.u[0])) + 2 * J;
    if (need > w) {
      const cap = (w - 2 * J) / (lo.length && hi.length ? 2 : 1);
      for (const s of lo) s.u = [U[0], U[0] + Math.min(cap, s.u[1] - s.u[0])];
      for (const s of hi) s.u = [U[1] - Math.min(cap, s.u[1] - s.u[0]), U[1]];
    }
    const inner: Range = [Math.max(U[0], ...stops.filter((s) => s.u[0] <= U[0] + 1e-6).map((s) => s.u[1] + J)), Math.min(U[1], ...stops.filter((s) => s.u[1] >= U[1] - 1e-6).map((s) => s.u[0] - J))];
    for (const inside of faces) {
      const fd = (a: number, b: number) => depth(a, b, inside);
      for (const s of stops) {
        if (s.through && inside) continue;
        stone(s.u, sy, 0, s.through ? T - (o.plaster && !o.twoFaced ? 0.012 : 0) : FD, inside, tone(o.dress, 0.95 + 0.08 * h3(k, Math.round(s.u[0] * 100))));
      }
      // the stones between, in a few lengths fitted to the gap (the slack goes into the perpends)
      if (inner[1] - inner[0] > 0.02) {
        const rs = k * 131 + Math.round((inner[0] + 50) * 100) + (inside ? 7 : 0);
        const fit = fitRow(inner[1] - inner[0], dressed ? DRESSED_L : RUBBLE_L, rs, J);
        let x = inner[0];
        for (let i = 0; i < fit.lens.length; i++) {
          const u: Range = [x, x + fit.lens[i]];
          {
            const r = h3(rs, i, 9), base = dressed ? o.dress : RUBBLE[Math.floor(r * RUBBLE.length)];
            const tint = tone(base, 0.9 + 0.18 * h3(rs, i, 11));
            if (!dressed && sy[1] - sy[0] > 0.2 && r > 0.72) {
              // a sneck: the slot split into two smaller stones
              const ym = sy[0] + (sy[1] - sy[0]) * (h3(rs, i, 13) < 0.5 ? 0.45 : 0.55);
              stone(u, [sy[0], ym - J / 2], 0, FD, inside, tint);
              stone(u, [ym + J / 2, sy[1]], 0, FD, inside, tone(RUBBLE[Math.floor(h3(rs, i, 17) * RUBBLE.length)], 1));
              put(u, [ym - J / 2, ym + J / 2], fd(R, FD), MORTAR, 1800, 'concrete');
            } else stone(u, sy, 0, FD, inside, tint);
          }
          x = u[1];
          if (i + 1 < fit.lens.length) { joint([x, x + J + fit.e], sy, fd(R, FD)); x += J + fit.e; }
        }
      }
      // joints beside the end stones
      for (const s of stops) {
        if (s.through && inside) continue;
        const pj: Range = s.u[0] <= U[0] + 1e-6 ? [s.u[1], Math.min(s.u[1] + J, U[1])] : [Math.max(s.u[0] - J, U[0]), s.u[0]];
        if (pj[1] - pj[0] > 0.002 && pj[0] >= inner[0] - J - 1e-6 && pj[1] <= inner[1] + J + 1e-6) put(pj, sy, fd(R, FD), MORTAR, 1800, 'concrete');
      }
      // bed joint over the course
      if (!top) {
        const bu: Range = [U[0], U[1]];
        const through = stops.filter((s) => s.through);
        const segs: Range[] = [];
        let c0 = bu[0];
        for (const s of through.sort((a, b) => a.u[0] - b.u[0])) { if (s.u[0] > c0) segs.push([c0, s.u[0]]); c0 = Math.max(c0, s.u[1]); }
        if (bu[1] > c0) segs.push([c0, bu[1]]);
        for (const sg of segs) put(sg, [row.y[1] - J, row.y[1]], fd(R, FD), MORTAR, 1800, 'concrete');
        for (const s of through) if (!inside) put(s.u, [row.y[1] - J, row.y[1]], depth(R, T - (o.plaster && !o.twoFaced ? 0.012 : 0)), MORTAR, 1800, 'concrete');
      }
    }
    // core between the faces (clear of the through-stones), then plaster
    const core: Range = o.twoFaced ? [FD, T - FD] : [FD, T - (o.plaster ? 0.012 : 0)];
    const cu: Range = [Math.max(U[0], ...stops.filter((s) => s.through && s.u[0] <= U[0] + 1e-6).map((s) => s.u[1])), Math.min(U[1], ...stops.filter((s) => s.through && s.u[1] >= U[1] - 1e-6).map((s) => s.u[0]))];
    // the core: hearting stones of mixed lengths bedded in lime, so a breached wall spills lumps, not a plank
    if (core[1] - core[0] > 0.01 && cu[1] - cu[0] > 0.004) {
      const cs = [cu[0]];
      for (let x = cu[0] + 0.15 + 0.3 * h3(k, 21), i = 0; x < cu[1] - 0.15; x += 0.3 + 0.1 * Math.floor(h3(k, i, 23) * 4), i++) cs.push(x);
      cs.push(cu[1]);
      for (let i = 0; i + 1 < cs.length; i++) put([cs[i], cs[i + 1] - (i + 2 < cs.length ? 0.004 : 0)], row.y, depth(core[0], core[1]), tone(CORE, 0.88 + 0.24 * h3(k, i, 25)), 2100, 'stone');
    }
  });
  // one coat of limewashed plaster over the whole inner face (a coat per course would show the coursing through it)
  if (o.plaster && !o.twoFaced) put(U, Y, depth(T - 0.011, T), LIMEWASH, 1500, 'plaster');
  return d;
}
