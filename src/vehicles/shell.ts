import type { Vec3 } from '../types';
import type { Piece } from '../destruction/structure';
import * as D from '../render/deform';
import { invRot } from './math';

/* Shell physics for thin metal: any 'metal' piece (sheet steel by definition: car panels, containers, cladding, ducts,
   bins) with the skin thickness its mass implies, and steel / aluminium / copper plates thinner than 10 cm.
   A blow above yield dents it plastically: a ring of plastic bending plus membrane stretch,
     W(δ) = π·σy·t·(t·δ + δ²),
   with work hardening (σ rises with the dent already there), so a second blow on the same spot goes less deep.
   The dent is limited by the panel's own depth. Sheet metal that dents absorbs the blow's plastic work before it
   can tear. Panels carrying compression beyond their plate buckling load go wavy. */

const STEEL = 7850;
const YIELD: Partial<Record<Piece['mat'], number>> = { metal: 250e6, steel: 275e6, aluminum: 200e6, copper: 70e6 };
const DENT_MIN = 0.004;
const HARDEN = 2;

interface Shell { t: number; sy: number; sheet: boolean; ext: [number, number, number] }
const info = new WeakMap<Piece, Shell | null>();

function faceArea(pts: number[]): number {
  let x = 0, y = 0, z = 0;
  for (let i = 3; i + 5 < pts.length; i += 3) {
    const ux = pts[i] - pts[0], uy = pts[i + 1] - pts[1], uz = pts[i + 2] - pts[2];
    const vx = pts[i + 3] - pts[0], vy = pts[i + 4] - pts[1], vz = pts[i + 5] - pts[2];
    x += uy * vz - uz * vy; y += uz * vx - ux * vz; z += ux * vy - uy * vx;
  }
  return 0.5 * Math.hypot(x, y, z);
}

export function shellOf(p: Piece): Shell | null {
  let s = info.get(p);
  if (s !== undefined) return s;
  s = null;
  const sy = YIELD[p.mat];
  if (sy && !p.cyl && !p.root.spec.section && !p.root.spec.wheel) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], area = 0;
    for (const f of p.poly.faces) {
      area += faceArea(f.pts);
      for (let i = 0; i < f.pts.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], f.pts[i + k]); hi[k] = Math.max(hi[k], f.pts[i + k]); }
    }
    const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] as [number, number, number];
    const e = [...ext].sort((a, b) => a - b);
    if (p.mat === 'metal') s = { t: Math.min(0.012, Math.max(0.0006, p.mass / (STEEL * Math.max(area, 1e-3)))), sy, sheet: true, ext };
    else if (e[0] <= 0.1 && e[1] >= 5 * e[0]) s = { t: e[0], sy, sheet: false, ext };
  }
  info.set(p, s);
  return s;
}

/** Plastic work to push a dent from d0 to d1 deep in skin t at yield sy (hardened by the existing depth over radius R). */
function work(sy: number, t: number, d0: number, d1: number, R: number): number {
  return Math.PI * sy * (1 + (HARDEN * d0) / R) * t * (t * (d1 - d0) + d1 * d1 - d0 * d0);
}

interface Req { p: Piece; pt: Vec3; dir: Vec3; R: number; d: number }
const queue: Req[] = [];
export const shellStats = { dents: 0, absorbed: 0 };

/** A blow of `energy` J at world `point`. Queues the dent and returns the energy left for fracture. */
export function shellDamage(p: Piece, point: Vec3, energy: number, blast: boolean): number {
  const s = shellOf(p);
  if (!s || energy <= 0 || p.dead) return energy;
  const pt = invRot([0, 0, 0], p.curRot, [point[0] - p.curPos[0], point[1] - p.curPos[1], point[2] - p.curPos[2]]);
  /* push toward the body's middle: inward through a sheet, back along a crash into a hull */
  const dir: Vec3 = [-pt[0], -pt[1], -pt[2]];
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  if (l < 1e-4) return energy;
  dir[0] /= l; dir[1] /= l; dir[2] /= l;
  let span = 0;
  for (let k = 0; k < 3; k++) span += Math.abs(dir[k]) * s.ext[k];
  const E = energy * (blast ? 0.3 : 0.7);
  const sy = s.sy * Math.max(0.1, p.heatK);
  const guess = Math.sqrt(E / (Math.PI * sy * s.t));
  const R = blast ? Math.min(0.9, Math.max(0.3, 0.35 + guess)) : Math.min(0.7, Math.max(0.1, 0.1 + 1.5 * guess));
  const limit = s.sheet ? 0.8 * span : Math.min(0.5 * R, 40 * s.t);
  const d0 = Math.min(limit, D.dentDepthAt(p, pt, R * 0.5));
  const h = 1 + (HARDEN * d0) / R, c = d0 * d0 + s.t * d0 + E / (Math.PI * sy * h * s.t);
  const d1 = Math.min(limit, (-s.t + Math.sqrt(s.t * s.t + 4 * c)) / 2);
  const dd = d1 - d0;
  if (dd < DENT_MIN) return energy;
  const used = Math.min(E, work(sy, s.t, d0, d1, R));
  for (const q of queue) {
    if (q.p !== p) continue;
    const dx = q.pt[0] - pt[0], dy = q.pt[1] - pt[1], dz = q.pt[2] - pt[2];
    if (dx * dx + dy * dy + dz * dz < (q.R * q.R) / 4) {
      if (dd > q.d) { q.d = dd; q.R = Math.max(q.R, R); }
      return p.mat === 'metal' ? energy - used : energy;
    }
  }
  if (queue.length < 64) queue.push({ p, pt, dir, R, d: dd });
  shellStats.absorbed += used;
  return p.mat === 'metal' ? energy - used : energy;
}

export function flushDents(): void {
  for (const q of queue) if (!q.p.dead && D.dent(q.p, q.pt, q.dir, q.R, q.d)) shellStats.dents++;
  queue.length = 0;
}

/* ---------------- buckling of loaded thin panels ---------------- */

const panels = new Set<Piece>();
const waveAmp = new WeakMap<Piece, number>();

export function notePanels(list: Piece[]): void {
  for (const p of list) if (p.depth === 0 && p.welds.length && shellOf(p)) panels.add(p);
}

/** Plate buckling σcr = 4π²E/(12(1−ν²))·(t/b)² on the loaded edge; the modelled thickness stands in for
    corrugation and stiffeners (a quarter of the panel's thinnest extent at least). */
export function checkBuckling(): void {
  for (const p of panels) {
    if (p.dead) { panels.delete(p); continue; }
    const s = shellOf(p)!;
    let N = 0;
    for (const w of p.welds) if (w.alive && w.sN > N) N = w.sN;
    if (N <= 0) continue;
    const e = [...s.ext].sort((a, b) => a - b);
    const t = Math.max(s.t, 0.25 * e[0]);
    const Ncr = 3.6 * 210e9 * t ** 3 * Math.max(0.3, p.heatK);
    const amp = N > Ncr ? Math.min(0.08, 1.5 * t * Math.sqrt(N / Ncr - 1)) : 0;
    if (amp < 0.003 && !waveAmp.has(p)) continue;
    const k = s.ext.indexOf(e[0]);
    const n: Vec3 = [0, 0, 0];
    n[k] = 1;
    if (Math.abs((waveAmp.get(p) ?? 0) - amp) < 0.003) continue;
    waveAmp.set(p, amp);
    D.buckleWaves(p, n, amp, Math.max(2, Math.round(e[2] / Math.max(e[1], 0.3))));
  }
}

export function clearShells(): void {
  queue.length = 0;
  panels.clear();
  shellStats.dents = 0; shellStats.absorbed = 0;
  D.clearDeform();
}
