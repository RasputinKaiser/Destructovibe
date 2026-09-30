import type { Vec3 } from '../../types';
import { vec3 } from 'math';
import { CAT, overlapAABB, entityOfShape } from '../../physics/physics';
import type { Piece } from '../../destruction/structure';
import { rasterize, isFragile, polyBox } from './grid';

/* Blast loading from a TNT-equivalent charge. Free-field peak overpressure and positive impulse follow Kinney &
   Graham's closed forms of the Kingery–Bulmash curves in scaled distance Z = R / W^⅓; a charge on or near the
   ground reflects off it (W × 1.8, hemispherical burst). A local 1 m occupancy grid round the charge supplies line
   of sight (walls shadow what is behind them, openings channel the wave), and the volume the wave can reach
   under cover: a charge inside a room adds the room's quasi-static gas pressure (UFC 3-340-02 Fig. 2-152 fit,
   ~2.25 MPa · (W/V)^0.72) held for the room's blow-down time, and multiple reflections off its walls. */

export const POWER_PER_KG = 60e3;       // explode() power per kg TNT: rocket 1.25 kg, charge 2.5, propane tank 2.5
const P0 = 101325;
/* Within the breach radius the charge holes whatever stands there: nothing in it shadows (≥ 1.5 m, half the
   blast radius). */
const FREE = 1.5, BREACH = 0.5;
const MAX_H = 18;
/* impulse (Pa·s) of gas pressure plus reverberation that loads a room's walls like a charge's full power at contact */
const GAS_IMPULSE = 15e3;

export function pso(Z: number): number {
  const z = Math.max(Z, 0.05);
  return (P0 * 808 * (1 + (z / 4.5) ** 2)) / Math.sqrt((1 + (z / 0.048) ** 2) * (1 + (z / 0.32) ** 2) * (1 + (z / 1.35) ** 2));
}
/** positive-phase side-on impulse, Pa·s per kg^⅓ */
export function iso(Z: number): number {
  const z = Math.max(Z, 0.05);
  return (6.7 * Math.sqrt(1 + (z / 0.23) ** 4)) / (z * z * Math.cbrt(1 + (z / 1.55) ** 3));
}
/** normal reflection coefficient (ideal gas, γ = 1.4) */
export function cr(P: number): number {
  return (2 * (7 * P0 + 4 * P)) / (7 * P0 + P);
}

export interface Survey {
  pos: Vec3; W: number; cw: number; radius: number; free: number;
  x0: number; y0: number; z0: number; n: number;
  occ: Uint8Array; steps: Uint16Array; roofed: Uint8Array;
  confined: boolean; V: number; Av: number; Pqs: number; tg: number; iGas: number; iMulti: number;
  gas: number;              // confined-room load share, in units of the charge's power (0 in the open)
  roomMin: Vec3; roomMax: Vec3;
  ms: number;
}

const UNREACHED = 65535;
let occ = new Uint8Array(0), por = new Uint8Array(0), cov = new Uint8Array(0), steps = new Uint16Array(0), roofed = new Uint8Array(0);
let queue = new Int32Array(0);
let inside = new Uint8Array(0);

/** gasPower: the energy that pressurises a room it fills, when it differs from the shock's (a fuel-air charge: a low,
 * long push from far more energy than its peak pressure shows) */
/* covered: solid somewhere above within the grid */
function coverPass(n: number): void {
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    let cover = 0;
    for (let y = n - 1; y >= 0; y--) {
      const i = x + n * (y + n * z);
      if (occ[i]) cover = 1;
      else roofed[i] = cover;
    }
  }
}

export function survey(pos: Vec3, radius: number, power: number, gasPower = power): Survey {
  const t0 = performance.now();
  const W = Math.max(0.01, power / POWER_PER_KG) * (pos[1] < 2.5 ? 1.8 : 1);
  const Wg = gasPower === power ? W : Math.max(0.01, gasPower / POWER_PER_KG) * (pos[1] < 2.5 ? 1.8 : 1);
  const H = Math.min(MAX_H, Math.max(8, Math.ceil(radius * 2) + 2));
  const n = 2 * H + 1, n3 = n * n * n;
  if (occ.length < n3) { occ = new Uint8Array(n3); por = new Uint8Array(n3); cov = new Uint8Array(n3); steps = new Uint16Array(n3); roofed = new Uint8Array(n3); queue = new Int32Array(n3); }
  occ.fill(0, 0, n3); por.fill(0, 0, n3); cov.fill(0, 0, n3); steps.fill(UNREACHED, 0, n3); roofed.fill(0, 0, n3);
  const x0 = Math.floor(pos[0]) - H, y0 = Math.floor(pos[1]) - H, z0 = Math.floor(pos[2]) - H;
  const idx = (x: number, y: number, z: number): number => (x - x0) + n * ((y - y0) + n * (z - z0));
  const seen = new Set<Piece>();
  const vox: number[] = [], frac: number[] = [];
  overlapAABB([x0, Math.max(y0, -0.5), z0], [x0 + n, y0 + n, z0 + n], CAT.structure | CAT.prop | CAT.debris, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece') return;
    const p = e as Piece;
    if (seen.has(p) || p.dead || isFragile(p)) return;
    seen.add(p);
    vox.length = 0;
    frac.length = 0;
    const solid = rasterize(p, x0, y0, z0, n, (x, y, z, f) => { vox.push(idx(x, y, z)); frac.push(f); });
    if (solid) for (let k = 0; k < vox.length; k++) { const i = vox[k]; cov[i] = Math.min(255, cov[i] + Math.round(frac[k] * 32)); if (cov[i] > 16) occ[i] = 1; }
    else for (const i of vox) if (++por[i] >= 3) occ[i] = 1;
  });
  for (let z = 0; z < n; z++) for (let y = 0; y < n && y0 + y < 0; y++) for (let x = 0; x < n; x++) occ[x + n * (y + n * z)] = 1;
  const cx = Math.floor(pos[0]) - x0, cy = Math.floor(pos[1]) - y0, cz = Math.floor(pos[2]) - z0;
  /* a fuel-air charge breaches nothing round itself: what covers it is the room's real ceiling, judged before the charge's
     own breach sphere is cleared (a point charge of this size would have holed that ceiling; a cloud does not) */
  const trueCover = gasPower !== power;
  if (trueCover) coverPass(n);
  // …and it holes no wall round itself either: only its own cell is cleared
  const free = trueCover ? 0.5 : Math.max(FREE, radius * BREACH);
  const fr = Math.ceil(free);
  for (let z = -fr; z <= fr; z++) for (let y = -fr; y <= fr; y++) for (let x = -fr; x <= fr; x++) {
    if (x * x + y * y + z * z > free * free + 0.5 || y0 + cy + y < 0) continue;
    const i = cx + x + n * (cy + y + n * (cz + z));
    if (trueCover && occ[i]) roofed[i] = 1;
    occ[i] = 0;
  }
  if (!trueCover) coverPass(n);
  /* breadth-first reach through open cells */
  let head = 0, tail = 0;
  const c0 = cx + n * (cy + n * cz);
  steps[c0] = 0; queue[tail++] = c0;
  const maxSteps = Math.round(H * 1.4);
  while (head < tail) {
    const i = queue[head++];
    const x = i % n, y = ((i / n) | 0) % n, z = (i / (n * n)) | 0;
    const s = steps[i];
    if (s >= maxSteps) continue;
    for (let k = 0; k < 6; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0), nz = z + (k === 4 ? 1 : k === 5 ? -1 : 0);
      if (nx < 0 || ny < 0 || nz < 0 || nx >= n || ny >= n || nz >= n) continue;
      const j = nx + n * (ny + n * nz);
      if (occ[j] || steps[j] !== UNREACHED) continue;
      steps[j] = s + 1;
      queue[tail++] = j;
    }
  }
  /* The room the gas fills: the covered space connected to the charge under cover. Openings to the open air vent it;
     the wave that leaves through a window and comes back in through the next house's is the shock's business, not the
     gas's. */
  if (inside.length < n3) inside = new Uint8Array(n3);
  inside.fill(0, 0, n3);
  let V = 0, Av = 0;
  const rmin: Vec3 = [Infinity, Infinity, Infinity], rmax: Vec3 = [-Infinity, -Infinity, -Infinity];
  head = tail = 0;
  if (roofed[c0]) { inside[c0] = 1; queue[tail++] = c0; }
  while (head < tail) {
    const i = queue[head++];
    const x = i % n, y = ((i / n) | 0) % n, z = (i / (n * n)) | 0;
    V++;
    if (x < rmin[0]) rmin[0] = x; if (y < rmin[1]) rmin[1] = y; if (z < rmin[2]) rmin[2] = z;
    if (x > rmax[0]) rmax[0] = x; if (y > rmax[1]) rmax[1] = y; if (z > rmax[2]) rmax[2] = z;
    if (x === 0 || y === n - 1 || z === 0 || x === n - 1 || z === n - 1) Av++;
    if (steps[i] >= maxSteps) continue;
    for (let k = 0; k < 6; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0), nz = z + (k === 4 ? 1 : k === 5 ? -1 : 0);
      if (nx < 0 || ny < 0 || nz < 0 || nx >= n || ny >= n || nz >= n) continue;
      const j = nx + n * (ny + n * nz);
      if (occ[j] || inside[j]) continue;
      if (!roofed[j]) { Av++; continue; }
      inside[j] = 1;
      queue[tail++] = j;
    }
  }
  const cw = Math.cbrt(W);
  const confined = roofed[c0] === 1 && V > 1;
  let Pqs = 0, tg = 0, iGas = 0, iMulti = 0;
  if (confined) {
    Pqs = 2.25e6 * Math.min(1, Wg / V) ** 0.72;
    tg = Math.min(0.05, Math.max(0.003, V / (Math.max(0.5, Av) * 0.6 * 340)));
    iGas = 0.5 * Pqs * tg;
    const Zr = Math.cbrt(V) / cw;
    iMulti = 2 * cw * iso(Zr) * cr(pso(Zr));
  }
  return {
    pos: [pos[0], pos[1], pos[2]], W, cw, radius, free, x0, y0, z0, n, occ, steps, roofed, confined, V, Av, Pqs, tg, iGas, iMulti,
    gas: confined ? Math.min(1.2, (iGas + iMulti) / GAS_IMPULSE) : 0,
    roomMin: [x0 + rmin[0], y0 + rmin[1], z0 + rmin[2]], roomMax: [x0 + rmax[0] + 1, y0 + rmax[1] + 1, z0 + rmax[2] + 1],
    ms: performance.now() - t0,
  };
}

/* 3D DDA through the survey grid from the charge to t: false when a solid cell (beyond the charge's own reach)
   stands between. */
function clear(s: Survey, t: Vec3): boolean {
  const n = s.n;
  let x = Math.floor(s.pos[0]), y = Math.floor(s.pos[1]), z = Math.floor(s.pos[2]);
  const tx = Math.floor(t[0]), ty = Math.floor(t[1]), tz = Math.floor(t[2]);
  const dx = t[0] - s.pos[0], dy = t[1] - s.pos[1], dz = t[2] - s.pos[2];
  const L = Math.hypot(dx, dy, dz);
  if (L < s.free) return true;
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const idx = dx !== 0 ? Math.abs(1 / dx) : Infinity, idy = dy !== 0 ? Math.abs(1 / dy) : Infinity, idz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let mx = dx > 0 ? (x + 1 - s.pos[0]) * idx : (s.pos[0] - x) * idx;
  let my = dy > 0 ? (y + 1 - s.pos[1]) * idy : (s.pos[1] - y) * idy;
  let mz = dz > 0 ? (z + 1 - s.pos[2]) * idz : (s.pos[2] - z) * idz;
  for (let k = 0; k < 3 * n; k++) {
    if (x === tx && y === ty && z === tz) return true;
    if (mx < my && mx < mz) { x += sx; mx += idx; } else if (my < mz) { y += sy; my += idy; } else { z += sz; mz += idz; }
    const lx = x - s.x0, ly = y - s.y0, lz = z - s.z0;
    if (lx < 0 || ly < 0 || lz < 0 || lx >= n || ly >= n || lz >= n) return true;
    if (x === tx && y === ty && z === tz) return true;
    const ex = x + 0.5 - s.pos[0], ey = y + 0.5 - s.pos[1], ez = z + 0.5 - s.pos[2];
    if (ex * ex + ey * ey + ez * ez < s.free * s.free) continue;
    if (s.occ[lx + n * (ly + n * lz)]) return false;
  }
  return true;
}

/** Path length the wave travels to reach t: straight when in sight, round the obstacles otherwise. */
export function pathLength(s: Survey, t: Vec3): number {
  const d = Math.hypot(t[0] - s.pos[0], t[1] - s.pos[1], t[2] - s.pos[2]);
  if (clear(s, t)) return d;
  const n = s.n, lx = Math.floor(t[0]) - s.x0, ly = Math.floor(t[1]) - s.y0, lz = Math.floor(t[2]) - s.z0;
  if (lx < 0 || ly < 0 || lz < 0 || lx >= n || ly >= n || lz >= n) return d * 1.3;
  let best = UNREACHED;
  for (let k = 0; k < 7; k++) {
    const x = lx + (k === 1 ? 1 : k === 2 ? -1 : 0), y = ly + (k === 3 ? 1 : k === 4 ? -1 : 0), z = lz + (k === 5 ? 1 : k === 6 ? -1 : 0);
    if (x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n) continue;
    best = Math.min(best, s.steps[x + n * (y + n * z)]);
  }
  /* six-connected steps overstate a straight run by ~1.3 on average */
  return best === UNREACHED ? d * 4 : Math.max(d * 1.05, best * 0.78);
}

/** Face-on reflected impulse at path length L, Pa·s. */
export function reflectedImpulse(s: Survey, L: number): number {
  const Z = Math.max(0.2, L) / s.cw;
  return s.cw * iso(Z) * cr(pso(Z));
}

export function inRoom(s: Survey, p: ArrayLike<number>, pad = 1): boolean {
  return s.confined && p[0] > s.roomMin[0] - pad && p[0] < s.roomMax[0] + pad && p[1] > s.roomMin[1] - pad && p[1] < s.roomMax[1] + pad
    && p[2] > s.roomMin[2] - pad && p[2] < s.roomMax[2] + pad;
}

/** Loading factors for a piece whose nearest point cp is d from the charge:
 * `shadow` scales the line-of-sight blast (1 in plain view), `gas` is the confined-room load share (0 in the open). */
export function loadFactors(s: Survey, cp: Vec3, d: number): { shadow: number; gas: number } {
  const t: Vec3 = [cp[0], cp[1], cp[2]];
  if (d > 0.6) {
    const k = 0.6 / d;
    t[0] += (s.pos[0] - cp[0]) * k; t[1] += (s.pos[1] - cp[1]) * k; t[2] += (s.pos[2] - cp[2]) * k;
  }
  let shadow = 1;
  if (d > s.free) {
    const L = pathLength(s, t);
    if (L > d * 1.02) shadow = Math.max(0.3, Math.min(1, reflectedImpulse(s, L) / reflectedImpulse(s, d)));
  }
  let gas = 0;
  if (inRoom(s, cp)) gas = s.gas;
  return { shadow, gas };
}

/** Load on the face of a wall panel at c (unit normal n, facing either way): peak reflected overpressure P (Pa) and
 * positive-phase impulse I (Pa·s) of the shock, reflected by the angle of incidence and cut where the wave has to
 * diffract round cover, plus, when the panel bounds the charge's room, the gas phase (Pqs held for the blow-down)
 * and the reverberations. */
export function panelLoad(s: Survey, c: Vec3, n: Vec3): { P: number; I: number; gas: boolean } {
  const d = Math.hypot(c[0] - s.pos[0], c[1] - s.pos[1], c[2] - s.pos[2]);
  // sample in the air just in front of the face, not inside the wall's own cell
  const side = (s.pos[0] - c[0]) * n[0] + (s.pos[1] - c[1]) * n[1] + (s.pos[2] - c[2]) * n[2] >= 0 ? 1 : -1;
  const t: Vec3 = [c[0] + n[0] * 0.45 * side, c[1] + n[1] * 0.45 * side, c[2] + n[2] * 0.45 * side];
  const L = Math.max(pathLength(s, t), d);
  const Z = Math.max(0.2, L) / s.cw;
  let P = pso(Z), I = s.cw * iso(Z);
  const c1 = d > 1e-3 ? Math.abs((s.pos[0] - c[0]) * n[0] + (s.pos[1] - c[1]) * n[1] + (s.pos[2] - c[2]) * n[2]) / d : 1;
  const r = 1 + (cr(P) - 1) * c1 * c1;
  P *= r; I *= r;
  if (L > d * 1.02) { const k = Math.max(0.2, d / L); P *= k; I *= k; }
  /* the gas phase and the reverberations build only in a room that holds them: vented through openings of more than
     about its own wall area (vent area / V^⅔ past ~1.5, an aisle bay open to a nave) the charge is effectively in
     the open (UFC 3-340-02 §2-15: gas impulse falls away with the vent ratio) */
  const vent = s.V > 0 ? s.Av / Math.pow(s.V, 2 / 3) : 99;
  const held = Math.max(0, Math.min(1, (1.5 - vent) / 1.2));
  const gas = held > 0 && inRoom(s, c, 0.3);
  if (gas) { P = Math.max(P, s.Pqs * held); I += (s.iGas + s.iMulti) * held; }
  return { P, I, gas };
}

/** Peak overpressure a pane facing the blast along `n` sees (reflected by the angle of incidence), and the side-on
 * value, Pa. */
export function paneLoad(s: Survey, c: Vec3, n: Vec3 | null): { side: number; face: number } {
  const L = pathLength(s, c);
  const d = Math.hypot(c[0] - s.pos[0], c[1] - s.pos[1], c[2] - s.pos[2]);
  let P = pso(L / s.cw);
  if (L > d * 1.02) P *= Math.max(0.25, d / L);
  if (inRoom(s, c, 0.5)) P = Math.max(P, s.Pqs);
  let cos2 = 1;
  if (n && d > 1e-3) {
    const c1 = ((s.pos[0] - c[0]) * n[0] + (s.pos[1] - c[1]) * n[1] + (s.pos[2] - c[2]) * n[2]) / d;
    cos2 = c1 * c1;
  }
  return { side: P, face: P * (1 + (cr(P) - 1) * cos2) };
}

/** Range within which a charge can still break glass (side-on ≥ 1 kPa). */
export function glassRange(W: number): number {
  const cw = Math.cbrt(W);
  let lo = 1, hi = 400;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (pso(m) > 1000) lo = m; else hi = m; }
  return lo * cw;
}

const _n: Vec3 = [0, 0, 0];
/** Pane normal: the thinnest local axis of the piece, in world space. */
export function paneNormal(p: Piece): Vec3 {
  const [mn, mx] = polyBox(p.poly);
  const x = mx[0] - mn[0], y = mx[1] - mn[1], z = mx[2] - mn[2];
  vec3.set(_n, x <= y && x <= z ? 1 : 0, y < x && y <= z ? 1 : 0, z < x && z < y ? 1 : 0);
  return vec3.transformQuat(_n, _n, p.curRot) as Vec3;
}

/* Annealed panes of ordinary size fail between ~4 and 10 kPa of reflected pressure (static capacity 3–5 kPa, a
   dynamic factor of ~2 at blast durations); toughened glass takes about four times that. The spread is per pane. */
export function paneCapacity(p: Piece): number {
  const u = ((p.id * 2654435761) >>> 0) / 4294967296;
  const base = 4e3 + 6e3 * u;
  return p.mat === 'tempered' ? base * 4 : p.mat === 'lamp' ? 12e3 : base;
}

export function glassBreaks(s: Survey, p: Piece): boolean {
  return paneLoad(s, p.curPos, paneNormal(p)).face > paneCapacity(p);
}
