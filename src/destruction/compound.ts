import { quickhull3 } from 'math/geometry';
import type { PieceSpec, Vec3 } from '../types';

/* Compound (non-convex) members: one rigid body made of several convex parts. Pure geometry shared by the
   core (bodies, meshes, fracture) and the level validator, so it imports nothing at runtime but `math`.

   Structural sections are expanded into their real profile. Plates are drawn at their real thickness down to
   MIN_PLATE; below that the collision plate is thicker than the steel and the member's density is lowered so it
   still weighs its real kg/m. Section frame: `axis` runs along the member, `depth` is the web's direction (the
   one flanges are spaced along), `width` is the third. Channels open toward +width (web at -width), angles have
   their heel at (-depth, -width), tees carry the flange at +depth. */

export type PartSpec = NonNullable<PieceSpec['parts']>[number];
type Axis = 0 | 1 | 2;

/** thinnest plate the solver is given: thinner hulls tunnel, and the core refuses hulls under 0.035 m */
export const MIN_PLATE = 0.04;
/** hollow sections at least this wide get real walls (a void you can see and shoot through); smaller ones stay solid */
const RHS_WALLS = 0.6;
const CHS_WALLS = 0.5;
/** net share of the gross section in precast hollowcore planks and hollow blocks */
const FILL = { hollowcore: 0.6, hollowblock: 0.55 } as const;

export interface SectionFrame { axis: Axis; depth: Axis; width: Axis; L: number; D: number; B: number }

export function sectionFrame(spec: PieceSpec): SectionFrame {
  const s = spec.size, sec = spec.section;
  const axis: Axis = sec?.axis ?? (s[0] >= s[1] && s[0] >= s[2] ? 0 : s[1] >= s[2] ? 1 : 2);
  const cross = ([0, 1, 2] as Axis[]).filter(k => k !== axis);
  let depth = sec?.depth !== undefined && sec.depth !== axis ? sec.depth : undefined;
  if (depth === undefined) {
    const [u, v] = cross;
    depth = Math.abs(s[u] - s[v]) > 1e-6 ? (s[u] > s[v] ? u : v) : cross.includes(1) ? 1 : 2;
  }
  const width = cross.find(k => k !== depth)!;
  return { axis, depth, width, L: s[axis], D: s[depth], B: s[width] };
}

interface Rect { d0: number; d1: number; w0: number; w1: number }

/** real flange/wall thickness t and web thickness tw, with rolled-section proportions when unspecified */
function thickness(spec: PieceSpec, f: SectionFrame): { t: number; tw: number } {
  const sec = spec.section!, big = Math.max(f.D, f.B), small = Math.min(f.D, f.B);
  switch (sec.kind) {
    case 'I': case 'channel': case 'tee': {
      const t = sec.t ?? big / 16;
      return { t, tw: sec.tw ?? Math.min(t, big / 25) };
    }
    case 'angle': { const t = sec.t ?? small / 10; return { t, tw: t }; }
    default: { const t = sec.t ?? small / 20; return { t, tw: t }; }
  }
}

function plates(kind: string, D: number, B: number, t: number, tw: number): Rect[] {
  const hd = D / 2, hb = B / 2;
  switch (kind) {
    case 'I': return [
      { d0: hd - t, d1: hd, w0: -hb, w1: hb }, { d0: -hd, d1: -hd + t, w0: -hb, w1: hb }, { d0: -hd + t, d1: hd - t, w0: -tw / 2, w1: tw / 2 },
    ];
    case 'channel': return [
      { d0: -hd, d1: hd, w0: -hb, w1: -hb + tw }, { d0: hd - t, d1: hd, w0: -hb + tw, w1: hb }, { d0: -hd, d1: -hd + t, w0: -hb + tw, w1: hb },
    ];
    case 'angle': return [{ d0: -hd, d1: hd, w0: -hb, w1: -hb + t }, { d0: -hd, d1: -hd + t, w0: -hb + t, w1: hb }];
    case 'tee': return [{ d0: hd - t, d1: hd, w0: -hb, w1: hb }, { d0: -hd, d1: hd - t, w0: -tw / 2, w1: tw / 2 }];
    case 'rhs': return [
      { d0: hd - t, d1: hd, w0: -hb, w1: hb }, { d0: -hd, d1: -hd + t, w0: -hb, w1: hb },
      { d0: -hd + t, d1: hd - t, w0: -hb, w1: -hb + t }, { d0: -hd + t, d1: hd - t, w0: hb - t, w1: hb },
    ];
    default: return [];
  }
}

/** Collision/render thickness: never under MIN_PLATE, and always leaving a real web between the flanges. */
function modelThickness(kind: string, D: number, B: number, t: number, tw: number): { t: number; tw: number } | null {
  let tm = Math.max(t, MIN_PLATE), twm = Math.max(tw, MIN_PLATE);
  if (kind === 'I' || kind === 'rhs') tm = Math.min(tm, (D - MIN_PLATE) / 2 - 1e-6);
  else tm = Math.min(tm, D - MIN_PLATE - 1e-6);
  twm = Math.min(twm, kind === 'rhs' || kind === 'angle' ? tm : B / 2);
  if (kind === 'angle') twm = tm = Math.min(tm, B - MIN_PLATE - 1e-6);
  if (kind === 'channel') twm = Math.min(twm, B - MIN_PLATE - 1e-6);
  return tm >= MIN_PLATE - 1e-9 && twm >= MIN_PLATE - 1e-9 ? { t: tm, tw: twm } : null;
}

function part(f: SectionFrame, r: Rect): PartSpec {
  const size: Vec3 = [0, 0, 0], pos: Vec3 = [0, 0, 0];
  size[f.axis] = f.L; size[f.depth] = r.d1 - r.d0; size[f.width] = r.w1 - r.w0;
  pos[f.depth] = (r.d0 + r.d1) / 2; pos[f.width] = (r.w0 + r.w1) / 2;
  return { size, pos };
}

/** a straight prism of `ring` (depth, width) points along the member axis, as a hull part */
function prismPart(f: SectionFrame, ring: [number, number][]): PartSpec {
  const pts: Vec3[] = [];
  for (const a of [-f.L / 2, f.L / 2]) for (const [d, w] of ring) {
    const v: Vec3 = [0, 0, 0];
    v[f.axis] = a; v[f.depth] = d; v[f.width] = w;
    pts.push(v);
  }
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return {
    shape: 'hull', size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], pos: c,
    verts: pts.map(v => [v[0] - c[0], v[1] - c[1], v[2] - c[2]] as Vec3),
  };
}

/**
 * The real profile of `spec.section` as convex parts (relative to `pos`, before `rotY`), or null when the section
 * keeps the piece's own solid shape and only lowers its density (hollowcore, hollow blocks, small RHS/CHS).
 */
export function sectionParts(spec: PieceSpec): PartSpec[] | null {
  const sec = spec.section;
  if (!sec || sec.kind === 'hollowcore' || sec.kind === 'hollowblock') return null;
  const f = sectionFrame(spec);
  if (sec.kind === 'chs') {
    /* 12 flats, one square to each frame axis, so members butting the tube meet a face, not an edge */
    const ro = Math.min(f.D, f.B) / 2, k = 1 / Math.cos(Math.PI / 12);
    const at = (i: number, r: number): [number, number] => [Math.cos((i + 0.5) * Math.PI / 6) * r * k, Math.sin((i + 0.5) * Math.PI / 6) * r * k];
    if (ro * 2 >= CHS_WALLS) {
      const { t } = thickness(spec, f), ri = ro - Math.min(Math.max(t, MIN_PLATE), ro * 0.5);
      return Array.from({ length: 12 }, (_, i) => prismPart(f, [at(i, ro), at(i + 1, ro), at(i + 1, ri), at(i, ri)]));
    }
    if (spec.shape === 'cylinder' || spec.shape === 'prism') return null;
    if (f.axis === 1) return [{ shape: 'cylinder', size: [ro * 2, f.L, ro * 2], pos: [0, 0, 0] }];
    return [prismPart(f, Array.from({ length: 12 }, (_, i) => at(i, ro)))];
  }
  if ((spec.shape ?? 'box') !== 'box') return null;
  if (sec.kind === 'rhs' && Math.min(f.D, f.B) < RHS_WALLS) return null;
  const { t, tw } = thickness(spec, f);
  const m = modelThickness(sec.kind, f.D, f.B, t, tw);
  return m ? plates(sec.kind, f.D, f.B, m.t, m.tw).map(r => part(f, r)) : null;
}

/** The convex parts a spec is built from: its explicit `parts`, else its expanded section; null = one convex solid. */
export function specParts(spec: PieceSpec): PartSpec[] | null {
  if (spec.parts && spec.parts.length) return spec.parts;
  return sectionParts(spec);
}

export interface SectionProps {
  /** net area, m² */ A: number;
  /** second moment about the major axis (bending in the depth direction), m⁴ */ Iy: number;
  /** second moment about the minor axis (bending in the width direction), m⁴ */ Iz: number;
  /** St Venant torsion constant, m⁴ */ J: number;
  /** elastic moduli Iy / (D/2), Iz / (B/2), m³ */ Wy: number; Wz: number;
  kgPerM: number;
  axis: Axis; depth: Axis; width: Axis;
  /** length, depth and width, m */ L: number; D: number; B: number;
}

/** Real section properties (real plate thicknesses, not the collision model's), per member, for `rho` kg/m³. */
export function sectionProps(spec: PieceSpec, rho = 7850): SectionProps | null {
  const sec = spec.section;
  if (!sec) return null;
  const f = sectionFrame(spec), { D, B } = f;
  let A: number, Iy: number, Iz: number, J: number;
  if (sec.kind === 'chs') {
    const ro = Math.min(D, B) / 2, ri = Math.max(0, ro - thickness(spec, f).t);
    A = Math.PI * (ro * ro - ri * ri);
    Iy = Iz = (Math.PI / 4) * (ro ** 4 - ri ** 4);
    J = 2 * Iy;
  } else if (sec.kind === 'hollowcore' || sec.kind === 'hollowblock') {
    const k = FILL[sec.kind];
    A = k * B * D;
    Iy = (0.5 + k / 2) * (B * D ** 3) / 12;
    Iz = k * (D * B ** 3) / 12;
    J = k * rectTorsion(D, B);
  } else {
    const { t, tw } = thickness(spec, f);
    const rs = plates(sec.kind, D, B, Math.min(t, D / 2), Math.min(tw, B / 2));
    A = 0;
    let dc = 0, wc = 0;
    for (const r of rs) { const a = (r.d1 - r.d0) * (r.w1 - r.w0); A += a; dc += a * (r.d0 + r.d1) / 2; wc += a * (r.w0 + r.w1) / 2; }
    dc /= A; wc /= A;
    Iy = 0; Iz = 0; J = 0;
    for (const r of rs) {
      const h = r.d1 - r.d0, w = r.w1 - r.w0, a = h * w;
      Iy += (w * h ** 3) / 12 + a * ((r.d0 + r.d1) / 2 - dc) ** 2;
      Iz += (h * w ** 3) / 12 + a * ((r.w0 + r.w1) / 2 - wc) ** 2;
      J += (Math.max(h, w) * Math.min(h, w) ** 3) / 3;
    }
    if (sec.kind === 'rhs') {
      const am = (B - t) * (D - t);
      J = (4 * am * am * t) / (2 * (B - t + D - t));
    }
  }
  return { A, Iy, Iz, J, Wy: Iy / (D / 2), Wz: Iz / (B / 2), kgPerM: A * rho, axis: f.axis, depth: f.depth, width: f.width, L: f.L, D, B };
}

function rectTorsion(a: number, b: number): number {
  const l = Math.max(a, b), s = Math.min(a, b);
  return (l * s ** 3 / 3) * (1 - 0.63 * (s / l));
}

/** Volume of one part as the core builds it (cylinders as 16-gons, hulls exact). */
export function partVolume(q: PartSpec): number {
  const [x, y, z] = q.size;
  switch (q.shape ?? 'box') {
    case 'cylinder': return 16 * (x / 2) ** 2 * Math.tan(Math.PI / 16) * y;
    case 'prism': { const n = Math.min(24, Math.max(3, Math.round(q.sides ?? 8))); return n * (x / 2) ** 2 * Math.tan(Math.PI / n) * y; }
    case 'wedge': return (x * y * z) / 2;
    case 'hull': return q.verts && q.verts.length >= 4 ? hullVolume(q.verts) : 0;
    default: return x * y * z;
  }
}

export function partsVolume(parts: readonly PartSpec[]): number {
  let v = 0;
  for (const q of parts) v += partVolume(q);
  return v;
}

function hullVolume(verts: Vec3[]): number {
  const p = verts.flat(), t = quickhull3(p);
  let v = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return Math.abs(v) / 6;
}

/** Model volume of a spec: the sum of its parts when it has any, else its own solid (boxes and cylinders). */
export function modelVolume(spec: PieceSpec): number {
  const parts = specParts(spec);
  if (parts) return partsVolume(parts);
  const [x, y, z] = spec.size;
  if (spec.shape === 'cylinder') return Math.PI * (x / 2) ** 2 * y;
  return x * y * z;
}

/**
 * Density that makes a section member weigh its real kg/m: the section's net area over the modelled one.
 * `modelVol` is the volume the core actually builds (pass it when already known). Explicit `density` wins.
 */
export function specDensity(spec: PieceSpec, rho: number, modelVol?: number): number {
  if (spec.density !== undefined) return spec.density;
  const sp = sectionProps(spec, rho);
  if (!sp) return rho;
  const v = modelVol ?? modelVolume(spec);
  return v > 0 ? Math.min(rho, (sp.A * sp.L * rho) / v) : rho;
}

/* ---------------- placement ---------------- */

const swapV = (v: Vec3): Vec3 => [v[2], v[1], v[0]];

/** Mirror across the x = z plane (kit.swapXZ): parts are mirrored in the piece frame; the caller negates the yaw. */
export function mirrorParts(parts: readonly PartSpec[]): PartSpec[] {
  return parts.map(q => {
    const src = q.shape === 'wedge' ? wedgeHull(q) : q;
    const out: PartSpec = { ...src, size: swapV(src.size), pos: swapV(src.pos) };
    if (src.verts) out.verts = src.verts.map(swapV);
    if (src.rotY !== undefined) out.rotY = -src.rotY;
    return out;
  });
}

/** The section of a spec mirrored across x = z, with its frame made explicit (a tie-broken default would not mirror). */
export function mirrorSection(spec: PieceSpec): NonNullable<PieceSpec['section']> {
  const f = sectionFrame(spec);
  const sw = (k: Axis): Axis => (k === 0 ? 2 : k === 2 ? 0 : 1);
  return { ...spec.section!, axis: sw(f.axis), depth: sw(f.depth) };
}

function wedgeHull(q: PartSpec): PartSpec {
  const [hx, hy, hz] = q.size.map(v => v / 2);
  return { ...q, shape: 'hull', verts: [[-hx, -hy, -hz], [hx, -hy, -hz], [-hx, hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [-hx, hy, hz]] };
}
