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
      ps.push(dressedStone(u, th.y, o.t, o.out, { dress: o.dress, plaster: o.plaster && !o.twoFaced }));
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
        ps.push(walling(th.u, [0, th.y[0]]), dressedStone(th.u, [th.y[0], L], o.t, o.out, { dress: o.dress, plaster: o.plaster && !o.twoFaced }));
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
      const out: PieceSpec[] = [poly(insetPoly(q2, 0.003), band(0, 0.011)), poly(q2, band(0.011, T - inner))];
      if (inner) out.push(poly(insetPoly(q2, 0.003), band(T - inner, T)));
      return out.map((u, k) => { if (k !== 1) u.mat = 'drywall'; u.tint = tint; u.density = k === 1 ? rho : 2500; return u; });
    };
    const area = (q2: [number, number][]) => { let s2 = 0; for (let i = 0; i < q2.length; i++) { const [x1, y1] = q2[i], [x2, y2] = q2[(i + 1) % q2.length]; s2 += x1 * y2 - x2 * y1; } return Math.abs(s2) / 2; };
    const dedup = (q2: [number, number][]) => q2.filter((p, i) => q2.findIndex((r) => Math.hypot(r[0] - p[0], r[1] - p[1]) < 1e-5) === i);
    const vous: [number, number][][] = [], fans: [number, number][][] = [];
    // each ring stone's soffit (its face on the arch) takes an 11 mm dressed skin across the reveal, the body drawn
    // back off it: the soffits had shown the bare, speckled, chamfered stone bodies
    const soffits = new Map<number, [number, number][]>();
    const leftP = [0, 1, 2, 3].map((i) => pts[i]), rightP = [6, 5, 4, 3].map((i) => pts[i]);
    for (const [P2, E2] of [[leftP, eL], [rightP, eR]] as [[number, number][], [number, number][]][]) {
      for (let i = 0; i < 3; i++) {
        const q2 = dedup([P2[i], P2[i + 1], E2[i + 1], E2[i]]);
        if (q2.length >= 3 && Math.hypot(P2[i + 1][0] - P2[i][0], P2[i + 1][1] - P2[i][1]) > 0.05) {
          // square off the chord: a rectangular skin is a thin box, which the engine keeps cosmetic at any slope
          const [p0, p1] = [P2[i], P2[i + 1]], l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          let nx = -(p1[1] - p0[1]) / l, ny = (p1[0] - p0[0]) / l;
          if (nx * (E2[i + 1][0] - p0[0]) + ny * (E2[i + 1][1] - p0[1]) < 0) { nx = -nx; ny = -ny; }
          // (drawn in 8 mm from each end, clear of the neighbours: the joints between ring stones open there)
          // (a springer is a wedge from a point at the jamb: its skin starts where the wedge is thick enough for it)
          const ux = (p1[0] - p0[0]) / l, uy = (p1[1] - p0[1]) / l;
          let s0 = 0.008;
          if (q2.length === 3) {
            const e = q2[2], el = Math.hypot(e[0] - p0[0], e[1] - p0[1]) || 1, sin = Math.abs(ux * (e[1] - p0[1]) - uy * (e[0] - p0[0])) / el;
            s0 = Math.max(s0, 0.016 / Math.max(sin, 1e-3));
          }
          if (s0 > l - 0.06) { vous.push(q2); continue; }
          const a0: [number, number] = [p0[0] + ux * s0, p0[1] + uy * s0], a1: [number, number] = [p1[0] - ux * 0.008, p1[1] - uy * 0.008];
          soffits.set(vous.length, [a0, a1, [a1[0] + nx * 0.011, a1[1] + ny * 0.011], [a0[0] + nx * 0.011, a0[1] + ny * 0.011]]);
        }
        vous.push(q2);
      }
    }
    vous.push(dedup([pts[3], eR[3], kt, eL[3]]));
    const cornerL: [number, number] = [a, yE], cornerR: [number, number] = [b, yE];
    const chainL = [...eL, kt], chainR = [...eR, kt];
    for (let i = 0; i + 1 < chainL.length; i++) fans.push(dedup([cornerL, chainL[i], chainL[i + 1]]));
    for (let i = 0; i + 1 < chainR.length; i++) fans.push(dedup([cornerR, chainR[i + 1], chainR[i]]));
    fans.push(dedup([cornerL, kt, cornerR]));
    const vi = vous.map((_, i) => i).filter((i) => vous[i].length >= 3 && area(vous[i]) > 2e-4), vq = vi.map((i) => vous[i]);
    const fq = fans.filter((q2) => q2.length >= 3 && area(q2) > 2e-4);
    const vp = vq.map((q2) => poly(q2)), fp = fq.map((q2) => poly(q2));
    const vdet = vi.flatMap((vIdx, i) => {
      const q2 = vous[vIdx], tint = tone(o.dress, 0.95 + 0.07 * h3(i, 41)), sf = soffits.get(vIdx);
      const us = layers(q2, tint, 2500);
      if (!sf) return us;
      // the body without its soffit strip, and the soffit skin across the reveal between the face skins
      const T = o.t[1] - o.t[0], inner = o.twoFaced ? 0.011 : 0;
      const band = (a2: number, b2: number): Range => { const x = outF + dir * a2, y = outF + dir * b2; return [Math.min(x, y), Math.max(x, y)]; };
      us[1] = { ...poly([sf[3], sf[2], ...q2.slice(2)], band(0.011, T - inner)), tint, density: 2500 };
      const k = poly(sf, band(0.011, T - inner)); k.mat = 'drywall'; k.tint = tint; k.density = 2500;
      return [...us, k];
    });
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

/* ---------------- stone faces ----------------

   A face stone is drawn as a thin skin (cosmetic: it goes to dust when struck) proud of a lime mortar bed, over the
   stone's body, which is what flies. Skins are convex prisms of an irregular outline (a rectangle with its corners
   knocked off by varied amounts; dressed stones only lose a 4 mm arris) set into their cell with a joint round them,
   so the mortar shows between the stones in varied widths. They are hulls, never boxes: the renderer draws any
   box-shaped thin unit as one unit cube stretched to size, which streaked the texture on every stone. Their sizes
   come from short lists, so a wall's thousands of skins draw as a few hundred shapes. */

type Out2 = [number, number][];
/** skin depth (the stone face proud of the bed), mortar bed, reveal and sill skins */
const SK = 0.006, MB = 0.011, RV = 0.011;
const FACE_W = [0.1, 0.13, 0.16, 0.19, 0.22, 0.25, 0.28, 0.32, 0.36, 0.4, 0.45, 0.5, 0.55, 0.6];
const FACE_H = [0.07, 0.09, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.23];
/** face-stone bodies: each carries one to two stone faces; the core behind is laid in lumps two courses high */
const BODY_L = [0.42, 0.49, 0.56, 0.63, 0.7], DRESSED_L = [0.7, 0.77, 0.84, 0.91, 0.98];
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function faceOutline(W: number, H: number, rough: boolean, v = 0): Out2 {
  const w = W / 2, h = H / 2;
  if (!rough) {
    const c = Math.min(0.004, W / 6, H / 6);
    return ([[-w + c, -h], [w - c, -h], [w, -h + c], [w, h - c], [w - c, h], [-w + c, h], [-w, h - c], [-w, -h + c]] as Out2).map(([a, b]) => [r4(a), r4(b)]);
  }
  // a roughly squared stone: the rectangle's top corners dropped and pushed a little (the bed stays level), then each
  // corner knocked off by its own amount along each edge
  const s = Math.round(W * 1000) * 7 + Math.round(H * 1000) * 131 + v * 7919, m = Math.min(W, H);
  const P: Out2 = [[-w, -h], [w, -h], [w - 0.012 * h3(s, 5, 75), h - 0.1 * H * h3(s, 6, 75)], [-w + 0.012 * h3(s, 7, 75), h - 0.1 * H * h3(s, 8, 75)]];
  const out: Out2 = [];
  for (let i = 0; i < 4; i++) {
    const a = P[(i + 3) % 4], c = P[i], b = P[(i + 1) % 4];
    const la = Math.hypot(a[0] - c[0], a[1] - c[1]), lb = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const ka = Math.min(0.35 * la, m * (0.02 + 0.2 * h3(s, i, 71))), kb = Math.min(0.35 * lb, m * (0.02 + 0.2 * h3(s, i, 73)));
    out.push([c[0] + ((a[0] - c[0]) * ka) / la, c[1] + ((a[1] - c[1]) * ka) / la], [c[0] + ((b[0] - c[0]) * kb) / lb, c[1] + ((b[1] - c[1]) * kb) / lb]);
  }
  // recentred on its box, so every stone of one size and variant is one shape
  const lo = [Math.min(...out.map((q) => q[0])), Math.min(...out.map((q) => q[1]))], hi = [Math.max(...out.map((q) => q[0])), Math.max(...out.map((q) => q[1]))];
  return out.map(([a, b]) => [r4(a - (lo[0] + hi[0]) / 2), r4(b - (lo[1] + hi[1]) / 2)]);
}

/** a convex outline pulled in toward its centroid by d (a stone's face inside its joint) */
export function insetPoly(q2: [number, number][], d: number): [number, number][] {
  const cx = q2.reduce((s, p) => s + p[0], 0) / q2.length, cy = q2.reduce((s, p) => s + p[1], 0) / q2.length;
  return q2.map(([u, y]) => { const l = Math.hypot(u - cx, y - cy) || 1; return [r4(u - ((u - cx) / l) * d), r4(y - ((y - cy) / l) * d)]; });
}
const pick = (set: number[], x: number) => [...set].reverse().find((s) => s <= x + 1e-9) ?? Math.floor(x / 0.02) * 0.02;

/** The face stone to set in a cell cu × cy: its outline, size and centre. Rubble sits low in its bed with a joint of
    7-30 mm round it; a dressed stone is centred with a fine joint. */
function faceIn(cu: Range, cy: Range, rough: boolean, seed: number): { ol: Out2; c: [number, number] } | null {
  const cw = cu[1] - cu[0], ch = cy[1] - cy[0];
  const W = rough ? pick(FACE_W, cw - 0.012) : Math.floor((cw - 0.006) / 0.04) * 0.04;
  const H = rough ? pick(FACE_H, ch - 0.011) : Math.floor((ch - 0.006) / 0.02) * 0.02;
  if (W < 0.04 || H < 0.03) return null;
  const x = cu[0] + (cw - W) * (rough ? 0.3 + 0.4 * h3(seed, 1, 81) : 0.5) + W / 2;
  const y = cy[0] + (ch - H) * (rough ? 0.2 + 0.35 * h3(seed, 2, 83) : 0.5) + H / 2;
  return { ol: faceOutline(W, H, rough), c: [x, y] };
}

/** Lays one course u0..u1 as face stones: bodies of a few lengths (2 mm apart), each showing one stone face or two
    (a split beside it, or a sneck: two thinner stones one over the other, now and then two bodies too). `body` and
    `face` place the units; the skin cells run to the middle of the gaps between the bodies. */
function layCourse(u0: number, u1: number, cy: Range, by: Range, dressed: { tint: number } | null, rs: number,
  body: (u: Range, y: Range, tint: number) => void, face: (u: Range, y: Range, tint: number, rough: boolean, seed: number) => void): void {
  if (u1 - u0 < 0.03) return;
  const fit = fitRow(u1 - u0, dressed ? DRESSED_L : BODY_L, rs, 0.002);
  const us: Range[] = [];
  let x = u0;
  for (const len of fit.lens) { us.push([x, x + len]); x += len + 0.002 + fit.e; }
  const ch = cy[1] - cy[0];
  us.forEach((u, i) => {
    const cu: Range = [i === 0 ? u0 : (us[i - 1][1] + u[0]) / 2, i + 1 === us.length ? u1 : (u[1] + us[i + 1][0]) / 2];
    const r = h3(rs, i, 9), seed = rs * 31 + i * 7;
    const tint = dressed ? tone(dressed.tint, 0.96 + 0.06 * h3(rs, i, 11)) : tone(RUBBLE[Math.floor(r * RUBBLE.length)], 0.93 + 0.12 * h3(rs, i, 11));
    const t2 = tone(RUBBLE[Math.floor(h3(rs, i, 17) * RUBBLE.length)], 0.93 + 0.12 * h3(rs, i, 19));
    if (dressed) { body(u, by, tint); face(cu, cy, tint, false, seed); return; }
    if (ch > 0.19 && r > 0.55) {
      const ym = cy[0] + ch * (h3(rs, i, 13) < 0.5 ? 0.42 : 0.58);
      // a sneck; one in four is two stones right through (the small stuff in the heap)
      if (r > 0.9) { body(u, [by[0], ym - 0.001], tint); body(u, [ym + 0.001, by[1]], t2); } else body(u, by, tint);
      face(cu, [cy[0], ym], tint, true, seed); face(cu, [ym, cy[1]], t2, true, seed + 3);
    } else if (r < 0.5) {
      // two or three stones side by side on one body
      body(u, by, tint);
      const n = u[1] - u[0] > 0.55 && r < 0.2 ? 3 : 2, cut = [cu[0]];
      for (let j = 1; j < n; j++) cut.push(cu[0] + ((cu[1] - cu[0]) * (j + 0.3 * (h3(rs, i, 15 + j) - 0.5))) / n);
      cut.push(cu[1]);
      for (let j = 0; j < n; j++) face([cut[j], cut[j + 1]], cy, j % 2 ? t2 : tint, true, seed + 3 * j);
    } else { body(u, by, tint); face(cu, cy, tint, true, seed); }
  });
}

/* ---------------- coursed stone in a convex polygon (gables) ---------------- */

/** Stone courses filling a convex polygon (u, y) in a wall along X (thickness band t), the outer face toward `out`
    (+t or -t): face stones as `layCourse` lays them, dressed verge stones of one width along a sloped edge, a mortar
    bed per course under the skins, and the bodies right through (a gable has no separate core). With `both` the
    inner face takes stone faces too; with `plaster` it is left for a plaster coat (laid by the caller). */
export function coursedPolygon(poly: [number, number][], t: Range, o: { tint: number; dress?: number; seed?: number; out?: 1 | -1; both?: boolean; plaster?: boolean } = { tint: 0xb9ad96 }): PieceSpec[] {
  const ys = poly.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = polySpan(poly);
  const out: PieceSpec[] = [];
  const seed = o.seed ?? 7, dress = o.dress ?? DRESS_T;
  const sgn = o.out ?? 1, T = t[1] - t[0];
  const band = (a: number, b: number, inner = false): Range => ((sgn > 0) !== inner ? [t[1] - b, t[1] - a] : [t[0] + a, t[0] + b]);
  const faces = o.both && !o.plaster ? [false, true] : [false];
  const bodyT = band(MB, T - (o.plaster ? 0.012 : o.both ? MB : 0));
  const prism = (mat: MaterialId, q2: Out2, tr: Range, tint: number, rho: number) => {
    const q: Vec3[] = [];
    for (const tt of tr) for (const [u, y] of q2) q.push([u, y, tt]);
    const s = hull(mat, q); s.tint = tint; s.density = rho; out.push(s);
  };
  const skinAt = (ol: Out2, c: [number, number], inner: boolean, tint: number) => prism('drywall', ol.map(([a, b]) => [c[0] + a, c[1] + b]), band(0, SK, inner), tint, 2500);
  // a sloped stone's face: its own outline pulled in 4 mm (each such shape is a draw batch, so verge stones share a width)
  const inset = (q2: Out2, d: number): Out2 => {
    const cx = q2.reduce((s, p) => s + p[0], 0) / q2.length, cy = q2.reduce((s, p) => s + p[1], 0) / q2.length;
    return q2.map(([u, y]) => { const l = Math.hypot(u - cx, y - cy) || 1; return [r4(u - ((u - cx) / l) * d), r4(y - ((y - cy) / l) * d)]; });
  };
  const rows = rowsIn(y0, y1);
  rows.forEach((r, ri) => {
    const top = ri === rows.length - 1;
    const ya = r.y[0] + 0.001, yb = r.y[1] - (top ? 0.001 : 0.002);
    const sa = span(ya), sb = span(yb);
    if (!sa || !sb) return;
    const lo = Math.max(sa[0], sb[0]), hi = Math.min(sa[1], sb[1]);
    if (hi - lo < 0.3) {
      // the apex course: one dressed stone following both slopes
      const q2: Out2 = [[sa[0] + 0.001, ya], [sa[1] - 0.001, ya], [sb[1] - 0.001, yb], [sb[0] + 0.001, yb]];
      prism('stone', q2, bodyT, tone(dress, 0.97), 2400);
      for (const f of faces) prism('drywall', inset(q2, 0.004), band(0, SK, f), tone(dress, 0.97), 2500);
      if (o.plaster) prism('plaster', q2, band(T - 0.011, T), LIMEWASH, 1500);
      return;
    }
    const VW = 0.2;
    const slopeL = Math.abs(sa[0] - sb[0]) > 1e-4, slopeR = Math.abs(sa[1] - sb[1]) > 1e-4;
    let a0 = slopeL ? lo + VW : lo + 0.001, a1 = slopeR ? hi - VW : hi - 0.001;
    if (a1 - a0 < 0.12) { a0 = a1 = (lo + hi) / 2; }
    // dressed verge stones along a raking edge, one width (measured at the course's top), so they repeat
    const verge = (q2: Out2) => {
      const tint = tone(dress, 0.94 + 0.06 * h3(seed, ri, 91));
      prism('stone', q2, bodyT, tint, 2400);
      for (const f of faces) prism('drywall', inset(q2, 0.004), band(0, SK, f), tint, 2500);
    };
    if (slopeL) verge([[sa[0] + 0.001, ya], [a0 - 0.001, ya], [a0 - 0.001, yb], [sb[0] + 0.001, yb]]);
    if (slopeR) verge([[a1 + 0.001, ya], [sa[1] - 0.001, ya], [sb[1] - 0.001, yb], [a1 + 0.001, yb]]);
    if (a1 - a0 > 0.02) {
      layCourse(a0 + 0.001, a1 - 0.001, [r.y[0], r.y[1]], [ya, yb], null, seed * 17 + r.k,
        (u, y, tint) => prism('stone', [[u[0], y[0]], [u[1], y[0]], [u[1], y[1]], [u[0], y[1]]], bodyT, tint, 2400),
        (u, y, tint, rough, s) => { for (const f of faces) { const st = faceIn(u, y, rough, s + (f ? 5 : 0)); if (st) skinAt(st.ol, st.c, f, tint); } });
    }
    // the inner face's limewash, the course's whole outline
    if (o.plaster) prism('plaster', [[sa[0] + 0.001, ya], [sa[1] - 0.001, ya], [sb[1] - 0.001, yb], [sb[0] + 0.001, yb]], band(T - 0.011, T), LIMEWASH, 1500);
    // the mortar bed behind the faces, across the course's plumb part
    for (const f of faces) {
      const m = block('plaster', [lo + 0.001, hi - 0.001], [ya, yb], band(SK, MB, f)); m.tint = MORTAR; m.density = 1800; out.push(m);
    }
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
    `out` is the outer face's side of x. With `plaster`, the inner face is limewashed. */
export function gableBlocks(poly: [number, number][], xr: Range, tint: number, o: { lifts: number[]; splits: number[][]; out: 1 | -1; seed?: number; plaster?: boolean; dress?: number }): PieceSpec[] {
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
      const st = coursedPolygon(q2, xr, { tint, dress: o.dress, seed: 7 + ri * 31 + j * 7, out: o.out, both: true, plaster: o.plaster });
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
  // what is left widens the stones, not the joints (a gap between bodies is hidden, but the faces are cut to it)
  const add = Math.max(0, left) / lens.length;
  return { lens: lens.map((l) => l + add), e: 0 };
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
/* warm brown, ochre and grey sandstones and slatestone, as in a Devon chapel's random-coursed rubble */
const RUBBLE = [0x9a8f7e, 0x8c8272, 0xa89a82, 0x7f776c, 0xa3906f, 0x96846a, 0xb0a084, 0x8a7a62, 0x9b968c, 0x767068, 0xae9f86, 0x8e8474];
const tone = (c: number, k: number): number =>
  (Math.min(255, Math.round(((c >> 16) & 255) * k)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k));
export const MORTAR = 0xd3cbb7, CORE = 0x8f887a, LIMEWASH = 0xeee9dc;
const DRESS_T = 0xe0dacb;

export interface RubbleOpts {
  tint: number; dress: number;
  quoin: number[]; ret: number[]; jambs: { u: number; y: Range }[];
  plaster?: boolean; twoFaced?: boolean; sill?: boolean;
}

/** Squared-rubble walling for a wall block u × y (along X, thickness band t, outside toward `out`): face stones of
    varied size and tone in the building's courses (`layCourse`), set in a lime mortar bed that shows between them,
    dressed quoins and returns at corners, dressed jamb stones beside openings with the reveal dressed (stone outside,
    limewash inside), a dressed sill course and sill under windows; a core of hearting lumps two courses high behind,
    and either limewashed plaster or a second stone face on the inside. */
export function rubble(U: Range, Y: Range, t: Range, out: 1 | -1, o: RubbleOpts): PieceSpec[] {
  const T = t[1] - t[0], FD = Math.min(0.16, T / 2 - 0.01), G = 0.002;
  const plasterIn = !!o.plaster && !o.twoFaced, PL = plasterIn ? 0.012 : 0;
  const d: PieceSpec[] = [];
  const depth = (a: number, b: number, inner = false): Range => {
    // a band a..b deep from the outer face (or from the inner face)
    const face = (out > 0) !== inner ? t[1] : t[0], dir = (out > 0) !== inner ? -1 : 1;
    const p = face + dir * a, q = face + dir * b;
    return [Math.min(p, q), Math.max(p, q)];
  };
  const put = (u: Range, y: Range, dd: Range, tint: number, rho: number, mat: 'stone' | 'concrete' | 'plaster' = 'stone') => {
    if (u[1] - u[0] < 0.004 || y[1] - y[0] < 0.004 || dd[1] - dd[0] < 0.001) return;
    const q = block(mat, u, y, dd); q.tint = tint; q.density = rho; d.push(q);
  };
  const prism = (pts: Vec3[], tint: number) => { const k = hull('drywall', pts); k.tint = tint; k.density = 2500; d.push(k); };
  // a stone face in its cell on the outer (or inner) face
  const face = (cu: Range, cy: Range, tint: number, rough: boolean, seed: number, inside: boolean) => {
    const st = faceIn(cu, cy, rough, seed);
    if (!st) return;
    const pts: Vec3[] = [];
    for (const tt of depth(0, SK, inside)) for (const [a, b] of st.ol) pts.push([st.c[0] + a, st.c[1] + b, tt]);
    prism(pts, tint);
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
  const jambAt = (lo: boolean, y: Range) => o.jambs.some((jb) => (lo ? jb.u <= U[0] + 1e-6 : jb.u >= U[1] - 1e-6) && y[1] > jb.y[0] + 0.02 && y[0] < jb.y[1] - 0.02);
  const anyLo = o.jambs.some((jb) => jb.u <= U[0] + 1e-6), anyHi = o.jambs.some((jb) => jb.u >= U[1] - 1e-6);
  const sillTop = !!o.sill;
  const cores: { y: Range; cu: Range }[] = [];
  rows.forEach((row, ri) => {
    const { k } = row;
    const top = ri === rows.length - 1 && Math.abs(row.y[1] - Y[1]) < 1e-6;
    // skins fill the course; bodies stand 2 mm clear of the course above (a sill course stops under the sill skin)
    const cy: Range = [row.y[0], top && sillTop ? row.y[1] - RV : row.y[1]];
    const by: Range = [row.y[0], top ? cy[1] : row.y[1] - G];
    const dressed = row.kind !== 'rubble' || (o.sill && ri === rows.length - 1);
    // the reveal: an opening's jamb at this end of the block, within its height, takes an 11 mm dressed return face
    const revLo = jambAt(true, row.y), revHi = jambAt(false, row.y);
    const Ua = U[0] + (revLo ? RV : 0), Ub = U[1] - (revHi ? RV : 0);
    // quoins (through-stones) and returns at the ends, jamb dressings beside openings
    const stops: { u: Range; through: boolean }[] = [];
    for (const q of o.quoin) { const L = k % 2 ? 0.56 : 0.3; stops.push({ u: q <= U[0] + 1e-6 ? [Ua, Ua + L] : [Ub - L, Ub], through: true }); }
    for (const q of o.ret) if (k % 2 === 0) stops.push({ u: q <= U[0] + 1e-6 ? [Ua, Ua + 0.25] : [Ub - 0.25, Ub], through: false });
    for (const jb of o.jambs) if (row.y[1] > jb.y[0] + 0.02 && row.y[0] < jb.y[1] - 0.02) { const L = k % 2 ? 0.38 : 0.22; stops.push({ u: jb.u <= U[0] + 1e-6 ? [Ua, Ua + L] : [Ub - L, Ub], through: false }); }
    // a narrow pier cannot take full-length dressings at both ends
    const w = Ub - Ua, lo = stops.filter((s) => s.u[0] <= Ua + 1e-6), hi = stops.filter((s) => s.u[1] >= Ub - 1e-6);
    const need = Math.max(0, ...lo.map((s) => s.u[1] - s.u[0])) + Math.max(0, ...hi.map((s) => s.u[1] - s.u[0])) + 2 * G;
    if (need > w) {
      const cap = (w - 2 * G) / (lo.length && hi.length ? 2 : 1);
      for (const s of lo) s.u = [Ua, Ua + Math.min(cap, s.u[1] - s.u[0])];
      for (const s of hi) s.u = [Ub - Math.min(cap, s.u[1] - s.u[0]), Ub];
    }
    const inner: Range = [Math.max(Ua, ...lo.map((s) => s.u[1] + G)), Math.min(Ub, ...hi.map((s) => s.u[0] - G))];
    for (const inside of faces) {
      for (const s of stops) {
        const tint = tone(o.dress, 0.95 + 0.08 * h3(k, Math.round(s.u[0] * 100)));
        if (!inside) put(s.u, by, depth(MB, s.through ? T - (o.twoFaced ? MB : PL) : FD), tint, 2500);
        else if (!s.through) put(s.u, by, depth(MB, FD, true), tint, 2500);
        const cu: Range = [s.u[0] <= Ua + 1e-6 ? Ua : s.u[0] - G / 2, s.u[1] >= Ub - 1e-6 ? Ub : s.u[1] + G / 2];
        face(cu, cy, tint, false, k * 13 + Math.round(s.u[0] * 100), inside);
      }
      // the stones between
      const rs = k * 131 + Math.round((inner[0] + 50) * 100) + (inside ? 7 : 0);
      layCourse(inner[0], inner[1], cy, by, dressed ? { tint: o.dress } : null, rs,
        (u, y, tint) => put(u, y, depth(MB, FD, inside), tint, 2500),
        (u, y, tint, rough, s) => face([u[0] <= inner[0] + 1e-6 ? u[0] - G / 2 : u[0], u[1] >= inner[1] - 1e-6 ? u[1] + G / 2 : u[1]], y, tint, rough, s, inside));
      // the mortar bed the faces are set in
      put([Ua, Ub], cy, depth(SK, MB, inside), MORTAR, 1800, 'plaster');
    }
    // the reveal's return face: a dressed jamb stone outside, the limewashed splay inside
    for (const [on, ur] of [[revLo, [U[0], U[0] + RV]], [revHi, [U[1] - RV, U[1]]]] as [boolean, Range][]) {
      if (!on) continue;
      const deep = o.twoFaced ? T : FD, dd = depth(0, deep);
      const W = Math.floor((deep - 0.006) / 0.02) * 0.02, H = Math.floor((cy[1] - cy[0] - 0.006) / 0.02) * 0.02;
      if (W >= 0.04 && H >= 0.03) {
        const ol = faceOutline(W, H, false), tc = (dd[0] + dd[1]) / 2, yc = (cy[0] + cy[1]) / 2;
        const pts: Vec3[] = [];
        for (const uu of ur) for (const [a, b] of ol) pts.push([uu, yc + b, tc + a]);
        prism(pts, tone(o.dress, 0.97 + 0.04 * h3(k, 57)));
      }
      if (plasterIn) put(ur, cy, depth(FD, T), LIMEWASH, 1500, 'plaster');
    }
    const cu: Range = [Math.max(Ua, ...stops.filter((s) => s.through && s.u[0] <= Ua + 1e-6).map((s) => s.u[1] + G)), Math.min(Ub, ...stops.filter((s) => s.through && s.u[1] >= Ub - 1e-6).map((s) => s.u[0] - G))];
    cores.push({ y: [row.y[0], by[1]], cu });
  });
  // the core: hearting lumps of mixed lengths, two courses high, bedded in lime, so a breached wall spills a few big
  // lumps among the face stones, not a plank (and not a second wall's worth of bodies)
  const core: Range = o.twoFaced ? [FD, T - FD] : [FD, T - PL];
  for (let i = 0; i < cores.length; i += 2) {
    const a = cores[i], b = cores[i + 1] ?? a;
    const y: Range = [a.y[0], b.y[1]], cu: Range = [Math.max(a.cu[0], b.cu[0]), Math.min(a.cu[1], b.cu[1])];
    if (core[1] - core[0] < 0.01 || cu[1] - cu[0] < 0.004) continue;
    const k = Math.round(y[0] * 100);
    const xs = [cu[0]];
    for (let x = cu[0], j = 0; ; j++) {
      x += 0.55 + 0.15 * Math.floor(h3(k, j, 23) * 4);
      if (x > cu[1] - 0.35) break;
      xs.push(x);
    }
    xs.push(cu[1]);
    for (let j = 0; j + 1 < xs.length; j++) put([xs[j], xs[j + 1] - (j + 2 < xs.length ? 0.004 : 0)], y, depth(core[0], core[1]), tone(CORE, 0.88 + 0.24 * h3(k, j, 25)), 2100, 'stone');
  }
  // one coat of limewashed plaster over the whole inner face (a coat per course would show the coursing through it)
  const topY = sillTop ? Y[1] - RV : Y[1];
  if (plasterIn) put([U[0] + (anyLo ? RV : 0), U[1] - (anyHi ? RV : 0)], [Y[0], topY], depth(T - 0.011, T), LIMEWASH, 1500, 'plaster');
  // the sill: a dressed stone over the whole top of the panel, weathered to the glass
  if (sillTop) {
    const W = Math.floor((U[1] - U[0] - 0.004) / 0.02) * 0.02, D = Math.floor((T - 0.004) / 0.02) * 0.02;
    if (W >= 0.04 && D >= 0.04) {
      const ol = faceOutline(W, D, false), uc = (U[0] + U[1]) / 2, tc = (t[0] + t[1]) / 2;
      const pts: Vec3[] = [];
      for (const yy of [Y[1] - RV, Y[1]]) for (const [a, b] of ol) pts.push([uc + a, yy, tc + b]);
      prism(pts, tone(o.dress, 0.98));
    }
  }
  return d;
}

/** A plain dressed stone standing in the walling (a through-stone for a service sleeve): its body, a dressed face
    skin outside and the plaster coat (or a second face) inside. */
export function dressedStone(u: Range, y: Range, t: Range, out: 1 | -1, o: { dress: number; plaster?: boolean }): PieceSpec {
  const p = block('stone', u, y, t, { tint: o.dress });
  const d: PieceSpec[] = [];
  const face = (inner: boolean): Range => { const f = (out > 0) !== inner ? t[1] : t[0], s = (out > 0) !== inner ? -1 : 1; const a = f, b = f + s * SK; return [Math.min(a, b), Math.max(a, b)]; };
  const W = Math.floor((u[1] - u[0] - 0.006) / 0.02) * 0.02, H = Math.floor((y[1] - y[0] - 0.006) / 0.02) * 0.02;
  for (const inner of o.plaster ? [false] : [false, true]) {
    const ol = faceOutline(W, H, false), pts: Vec3[] = [];
    for (const tt of face(inner)) for (const [a, b] of ol) pts.push([(u[0] + u[1]) / 2 + a, (y[0] + y[1]) / 2 + b, tt]);
    const s = hull('drywall', pts); s.tint = tone(o.dress, 0.98); s.density = 2500; d.push(s);
  }
  const bd: Range = out > 0 ? [t[0] + (o.plaster ? 0.012 : MB), t[1] - MB] : [t[0] + MB, t[1] - (o.plaster ? 0.012 : MB)];
  const body = block('stone', u, y, bd); body.tint = o.dress; body.density = 2500; d.push(body);
  const m = block('plaster', u, y, out > 0 ? [t[1] - MB, t[1] - SK] : [t[0] + SK, t[0] + MB]); m.tint = MORTAR; m.density = 1800; d.push(m);
  if (o.plaster) { const c = block('plaster', u, y, out > 0 ? [t[0], t[0] + 0.011] : [t[1] - 0.011, t[1]]); c.tint = LIMEWASH; c.density = 1500; d.push(c); }
  return withDetail(p, d);
}
