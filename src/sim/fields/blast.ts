import type { Vec3 } from '../../types';
import { vec3 } from 'math';
import { b3, CAT, overlapAABB, entityOfShape } from '../../physics/physics';
import type { Piece } from '../../destruction/structure';
import { rasterize, rasterizeParts, isFragile, polyBox } from './grid';

/* Blast loading from a TNT-equivalent charge. Free-field peak overpressure and positive impulse follow Kinney &
   Graham's closed forms of the Kingery–Bulmash curves in scaled distance Z = R / W^⅓; a charge on or near the
   ground reflects off it (W × 1.8, hemispherical burst). A local 1 m occupancy grid round the charge supplies line
   of sight (walls shadow what is behind them, openings channel the wave), and the volume the wave can reach
   under cover.

   Confinement is judged on the building as it stood when the charge went off, not on what the charge's own crater
   leaves: the room is the covered space connected to the charge, its ceiling the real one. The charge holes only
   what lies inside its contact-breach radius (P = R³·K·C, the rule the satchel uses, masonry K); openings (glazing
   counts as open: it goes at a few kPa) and that breach vent the room. In a room that holds it the charge adds:
   - the quasi-static gas pressure of its products and their afterburn, Pqs = 2.25 MPa · (W/V)^0.78 (UFC 3-340-02
     Fig. 2-152 as replotted by Salvado et al.), never above what their whole heat with afterburn can put into the
     air, W the charge's own mass (the ground's reflection of the shock adds no heat to the room's air);
   - its blow-down through the vent area A: P(t) = (Pqs + P0)·e^(−2.13 τ) − P0, τ = A·a0·t / V (Baker et al. 1983),
     whose impulse over the first 50 ms (a member's response time) is the gas impulse;
   - the reverberations: each wall takes its first reflected impulse again at half, then a quarter (1.75 × in all,
     Baker et al. 1983).
   How much of that a room holds goes with its vent ratio A / V^⅔ (fully confined below ~0.3, effectively open past
   ~1.5). Walls the gas blows out vent the rest of the blow-down (explode() dry-runs its wall panels and calls vent()). */

export const POWER_PER_KG = 60e3;       // explode() power per kg TNT: rocket 1.25 kg, charge 2.5, propane tank 2.5
const P0 = 101325, A0 = 340;
/* Within the breach radius the charge holes whatever stands there: nothing in it shadows (≥ 1.5 m, half the
   blast radius). */
const FREE = 1.5, BREACH = 0.5;
const MAX_H = 18;
/* impulse (Pa·s) of gas pressure plus reverberation that loads a room's walls like a charge's full power at contact */
const GAS_IMPULSE = 15e3;
/* peak gas pressure: 2.25 MPa at W/V = 1 kg/m³ and ~0.4 bar at 0.0058 kg/m³ (UFC 3-340-02 Fig. 2-152 as replotted by
   Salvado et al.), and never more than the products' heat with full afterburn can raise the air: (γ − 1)·3.22·4.184 MJ/kg
   per m³ */
const QS_P = 2.25e6, QS_EXP = 0.78, QS_E = 0.4 * 3.22 * 4.184e6;
/* the gas phase that counts for a member: its first 50 ms */
const GAS_T = 0.05;
/* a closed room still leaks (door gaps, flues, services): m² */
const LEAK = 0.5;
/* contact breach, P = R³·K·C (P lb TNT, R ft): ordinary masonry and concrete K 0.35, untamped C 3.2 (see
   game/ordnance/breach.ts) */
const BREACH_K = 0.35, BREACH_C = 3.2, FT = 0.3048, LB = 0.4536;

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
/** Peak quasi-static gas overpressure (Pa) of `kg` TNT in a closed volume V (m³). */
export function gasPressure(kg: number, V: number): number {
  return kg > 0 && V > 0 ? Math.min(QS_P * Math.min(1, kg / V) ** QS_EXP, QS_E * kg / V) : 0;
}
/* The TNT-eq that would raise V m³ to P: the inverse of gasPressure. */
function gasMass(P: number, V: number): number {
  return P > 0 ? Math.max(V * (P / QS_P) ** (1 / QS_EXP), (P * V) / QS_E) : 0;
}

/* Blow-down from P (Pa) with time constant T = V / (A·a0) for up to `dur` s: its impulse (Pa·s) and the pressure left. */
function blowDown(P: number, T: number, dur: number): { I: number; P: number } {
  if (P <= 0 || dur <= 0) return { I: 0, P: Math.max(0, P) };
  const tm = Math.log((P + P0) / P0) / 2.13, te = Math.min(tm, dur / T);
  return { I: T * ((P + P0) * (1 - Math.exp(-2.13 * te)) / 2.13 - P0 * te), P: Math.max(0, (P + P0) * Math.exp(-2.13 * te) - P0) };
}
/** Gas impulse (Pa·s) over the first GAS_T s of a room of V m³ at Pqs blowing down through A m² of vents, and through
 * A + A2 once walls of A2 m² that the gas blew out have opened (after tOpen s). */
export function gasImpulse(Pqs: number, V: number, A: number, A2 = 0, tOpen = Infinity): number {
  if (Pqs <= 0) return 0;
  const t1 = Math.min(GAS_T, tOpen);
  const a = blowDown(Pqs, V / (Math.max(LEAK, A) * A0), t1);
  return a.I + blowDown(a.P, V / (Math.max(LEAK, A + A2) * A0), GAS_T - t1).I;
}
/** Radius (m) a contact charge of `kg` TNT breaches ordinary masonry or concrete to. */
export function contactBreach(kg: number): number {
  return kg > 0 ? Math.cbrt(kg / LB / (BREACH_K * BREACH_C)) * FT : 0;
}
/** Share of the gas phase and reverberation a room of V m³ keeps with A m² of vents. */
export function heldBy(V: number, A: number): number {
  const vent = V > 0 ? A / Math.pow(V, 2 / 3) : 99;
  return Math.max(0, Math.min(1, (1.5 - vent) / 1.2));
}

export interface Survey {
  pos: Vec3; W: number; cw: number; radius: number; free: number;
  x0: number; y0: number; z0: number; n: number;
  occ: Uint8Array; steps: Uint16Array; roofed: Uint8Array;
  /** Wg: TNT-eq that heats the room's gas; V (m³) and Av (m², openings and the charge's own breach) of the room;
   * held: the share of the peak and of the reverberation it keeps (the blow-down's own vents take care of the gas
   * impulse); Pqs its peak gas pressure, Pres what earlier charges had left in it; iGasAll the room's whole gas impulse
   * (what a wall is judged on), iGas0 the rise this charge makes before
   * any wall goes, iGas after the walls the gas blew out have vented it (vent()); iMulti the reverberations on a wall
   * at the room's half-width */
  confined: boolean; Wg: number; V: number; Av: number; held: number; Pqs: number; Pres: number; tg: number; iGas0: number; iGas: number; iGasAll: number; iMulti: number;
  gas: number;              // confined-room load share this charge adds, in units of the charge's power (0 in the open)
  gasAll: number;           // the same for the room's whole gas (what a joint is judged on)
  roomMin: Vec3; roomMax: Vec3;
  ms: number;
}

/* Charges fired together in one room share its air: the room's gas pressure after the last one, blown down on Baker's
   curve since (time constant V / (A·a0), the blown-out walls' area included), is there when the next goes off. The peak
   is that of all of it; what the next one adds to the room's members is the rise it makes (n charges at once load the
   room as one of n·W), while walls and joints are judged on the whole of it. */
const roomGas: { min: Vec3; max: Vec3; P: number; V: number; T: number; t: number }[] = [];
export function clearRoomGas(): void { roomGas.length = 0; }

const UNREACHED = 65535;
let occ = new Uint8Array(0), occ0 = new Uint8Array(0), por = new Uint8Array(0), cov = new Uint8Array(0), por0 = new Uint8Array(0), cov0 = new Uint8Array(0), steps = new Uint16Array(0), roofed = new Uint8Array(0);
let queue = new Int32Array(0);
let inside = new Uint8Array(0);

/* covered: solid somewhere above within the grid */
function coverPass(n: number, o: Uint8Array): void {
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    let cover = 0;
    for (let y = n - 1; y >= 0; y--) {
      const i = x + n * (y + n * z);
      if (o[i]) cover = 1;
      else roofed[i] = cover;
    }
  }
}

const _cp: Vec3 = [0, 0, 0], _vel: Vec3 = [0, 0, 0];
/* The side of the solid a charge sits on: from the nearest surface point of what fills its cell, outward. A charge
   planted on a wall shares the wall's grid cell; it is on the face it was put on, not in the wall. */
function airSide(pos: Vec3): Vec3 | null {
  let best = Infinity;
  const out: Vec3 = [0, 0, 0];
  overlapAABB([pos[0] - 0.6, pos[1] - 0.6, pos[2] - 0.6], [pos[0] + 0.6, pos[1] + 0.6, pos[2] + 0.6], CAT.structure | CAT.prop | CAT.debris, shape => {
    const e = entityOfShape(shape);
    if (!e || e.kind !== 'piece' || (e as Piece).dead) return;
    // what the charge sits on is built in or at rest; a chunk flying past is not the wall it was planted on
    const q = e as Piece;
    if (!q.welds.length && b3.b3Body_IsAwake(q.body)) return;
    b3.b3Shape_GetClosestPoint(_cp, shape, pos);
    const d = Math.hypot(pos[0] - _cp[0], pos[1] - _cp[1], pos[2] - _cp[2]);
    if (d > 1e-4 && d < best) { best = d; vec3.set(out, (pos[0] - _cp[0]) / d, (pos[1] - _cp[1]) / d, (pos[2] - _cp[2]) / d); }
  });
  return best < Infinity ? out : null;
}

/** gasPower: the energy that pressurises a room it fills, when it differs from the shock's (a fuel-air charge: a low,
 * long push from far more energy than its peak pressure shows; 0: none, e.g. a gas deflagration, whose point blast
 * already stands for the room's pressure). cloud: a fuel-air cloud, which holes nothing round itself. */
export function survey(pos: Vec3, radius: number, power: number, gasPower = power, cloud = false, now = 0, face: Vec3 | null = null): Survey {
  const t0 = performance.now();
  const W = Math.max(0.01, power / POWER_PER_KG) * (pos[1] < 2.5 ? 1.8 : 1);
  const Wg = Math.max(0, gasPower / POWER_PER_KG);
  const H = Math.min(MAX_H, Math.max(8, Math.ceil(radius * 2) + 2));
  const n = 2 * H + 1, n3 = n * n * n;
  if (occ.length < n3) { occ = new Uint8Array(n3); occ0 = new Uint8Array(n3); por0 = new Uint8Array(n3); cov0 = new Uint8Array(n3); por = new Uint8Array(n3); cov = new Uint8Array(n3); steps = new Uint16Array(n3); roofed = new Uint8Array(n3); queue = new Int32Array(n3); }
  occ.fill(0, 0, n3); por.fill(0, 0, n3); cov.fill(0, 0, n3); occ0.fill(0, 0, n3); por0.fill(0, 0, n3); cov0.fill(0, 0, n3); steps.fill(UNREACHED, 0, n3); roofed.fill(0, 0, n3);
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
    /* the room's grid sees a compound by its parts (a stair tower or a chimney course is hollow, not its envelope), and
       not what is flying through it or falling past it (a façade coming down over a charge does not make it a room) */
    if (b3.b3Body_IsAwake(p.body)) { b3.b3Body_GetLinearVelocity(_vel, p.body); if (Math.hypot(_vel[0], _vel[1], _vel[2]) > 1) return; }
    if (p.parts) { vox.length = 0; frac.length = 0; rasterizeParts(p, x0, y0, z0, n, (x, y, z, f) => { vox.push(idx(x, y, z)); frac.push(f); }); }
    if (solid) for (let k = 0; k < vox.length; k++) { const i = vox[k]; cov0[i] = Math.min(255, cov0[i] + Math.round(frac[k] * 32)); if (cov0[i] > 16) occ0[i] = 1; }
    else for (const i of vox) if (++por0[i] >= 3) occ0[i] = 1;
  });
  for (let z = 0; z < n; z++) for (let y = 0; y < n && y0 + y < 0; y++) for (let x = 0; x < n; x++) { occ[x + n * (y + n * z)] = 1; occ0[x + n * (y + n * z)] = 1; }
  const cx = Math.floor(pos[0]) - x0, cy = Math.floor(pos[1]) - y0, cz = Math.floor(pos[2]) - z0;
  const c0 = cx + n * (cy + n * cz);

  /* the building as it stood: its cover, and the air cell the charge went off in */
  coverPass(n, occ0);
  /* A charge planted on a face is on that face's side: the room is looked for along its outward normal, never from the
     cell it shares with the wall (whose other side is someone else's air until the charge holes it). A loose charge in
     a solid cell finds its side from the nearest built-in surface. */
  let seed = c0;
  const dir = face ?? (occ0[c0] ? airSide(pos) : null);
  if (dir) {
    // out through its own wall (solid cells up to half a metre along the normal: a wall's thickness) into the first air
    // on its side; anything solid past that within a metre (furniture, the other wall of a passage) and it is judged
    // from its own cell if that is air, else in the open
    seed = -1;
    for (let k = 0.25; k <= 1.0; k += 0.25) {
      const sx = Math.floor(pos[0] + dir[0] * k) - x0, sy = Math.floor(pos[1] + dir[1] * k) - y0, sz = Math.floor(pos[2] + dir[2] * k) - z0;
      if (sx < 0 || sy < 0 || sz < 0 || sx >= n || sy >= n || sz >= n) break;
      const j = sx + n * (sy + n * sz);
      if (j === c0) continue;
      if (!occ0[j]) { seed = j; break; }
      if (k > 0.5) break;
    }
    // blocked by something in front (goods stacked by a column): it is where it is, if that is air
    if (seed < 0 && !occ0[c0]) seed = c0;
  }
  /* what the charge holes: only what lies inside its contact-breach radius (a fuel-air cloud, nothing); a holed cell of
     the envelope counts as under cover, so the flood below reaches the far side of the hole and counts it as a vent */
  const rb = cloud ? 0 : contactBreach(Wg > 0 ? Wg : power / POWER_PER_KG);
  const br = Math.ceil(rb) + 1;
  for (let z = -br; z <= br; z++) for (let y = -br; y <= br; y++) for (let x = -br; x <= br; x++) {
    const gx = cx + x, gy = cy + y, gz = cz + z;
    if (gx < 0 || gy < 0 || gz < 0 || gx >= n || gy >= n || gz >= n || y0 + gy < 0) continue;
    const i = gx + n * (gy + n * gz);
    if (!occ0[i]) continue;
    const dx = Math.max(x0 + gx - pos[0], 0, pos[0] - (x0 + gx + 1)), dy = Math.max(y0 + gy - pos[1], 0, pos[1] - (y0 + gy + 1)), dz = Math.max(z0 + gz - pos[2], 0, pos[2] - (z0 + gz + 1));
    if (dx * dx + dy * dy + dz * dz >= rb * rb) continue;
    occ0[i] = 0;
    roofed[i] = 1;
  }

  /* the shock's view: within the breach sphere the charge holes whatever stands there and nothing shadows */
  const free = cloud ? 0.5 : Math.max(FREE, radius * BREACH);
  const fr = Math.ceil(free);
  for (let z = -fr; z <= fr; z++) for (let y = -fr; y <= fr; y++) for (let x = -fr; x <= fr; x++) {
    if (x * x + y * y + z * z > free * free + 0.5 || y0 + cy + y < 0) continue;
    occ[cx + x + n * (cy + y + n * (cz + z))] = 0;
  }
  /* breadth-first reach through open cells */
  let head = 0, tail = 0;
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
  /* The room the gas fills: the covered space connected to the charge under cover, as it stood. Openings to the open
     air (and the charge's own breach through the envelope) vent it; the wave that leaves through a window and comes
     back in through the next house's is the shock's business, not the gas's. */
  if (inside.length < n3) inside = new Uint8Array(n3);
  inside.fill(0, 0, n3);
  let V = 0, Av = 0;
  const rmin: Vec3 = [Infinity, Infinity, Infinity], rmax: Vec3 = [-Infinity, -Infinity, -Infinity];
  head = tail = 0;
  if (dir && seed !== c0) inside[c0] = 1;
  const sy0 = seed >= 0 ? ((seed / n) | 0) % n : -1;
  if (seed >= 0 && roofed[seed] && y0 + sy0 >= 0) { inside[seed] = 1; queue[tail++] = seed; }
  while (head < tail) {
    const i = queue[head++];
    const x = i % n, y = ((i / n) | 0) % n, z = (i / (n * n)) | 0;
    V++;
    if (x < rmin[0]) rmin[0] = x; if (y < rmin[1]) rmin[1] = y; if (z < rmin[2]) rmin[2] = z;
    if (x > rmax[0]) rmax[0] = x; if (y > rmax[1]) rmax[1] = y; if (z > rmax[2]) rmax[2] = z;
    if (x === 0 || y === n - 1 || z === 0 || x === n - 1 || z === n - 1) Av++;
    for (let k = 0; k < 6; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0), nz = z + (k === 4 ? 1 : k === 5 ? -1 : 0);
      if (nx < 0 || ny < 0 || nz < 0 || nx >= n || ny >= n || nz >= n) continue;
      const j = nx + n * (ny + n * nz);
      if (occ0[j] || inside[j]) continue;
      if (!roofed[j]) { Av++; continue; }
      inside[j] = 1;
      queue[tail++] = j;
    }
  }
  /* the hole a charge on a wall blows through it (a wall no thicker than its breach radius) vents the room, when what
     is behind is the open air */
  if (dir && seed !== c0 && tail > 0 && rb > 0) {
    for (let k = 0.25; k <= rb + 0.5; k += 0.25) {
      const bx = Math.floor(pos[0] - dir[0] * k) - x0, by = Math.floor(pos[1] - dir[1] * k) - y0, bz = Math.floor(pos[2] - dir[2] * k) - z0;
      if (bx < 0 || by < 0 || bz < 0 || bx >= n || by >= n || bz >= n) break;
      const b = bx + n * (by + n * bz);
      if (b === c0 || occ0[b]) continue;
      if (!inside[b] && !roofed[b] && k <= rb + 0.5) Av += Math.PI * rb * rb;
      break;
    }
  }
  if (dir && seed !== c0) inside[c0] = 0;
  const cw = Math.cbrt(W);
  const held = heldBy(V, Av);
  const confined = tail > 0 && V > 1 && held > 0 && Wg > 0;
  let Pqs = 0, tg = 0, iGas0 = 0, iGasAll = 0, iMulti = 0, Pres = 0, Vres = V;
  let Wroom = Wg;
  if (confined) {
    const sx = x0 + (seed % n) + 0.5, sy = y0 + sy0 + 0.5, sz = z0 + ((seed / (n * n)) | 0) + 0.5;
    for (let k = roomGas.length - 1; k >= 0; k--) {
      const r = roomGas[k], dt = now - r.t;
      if (dt < 0 || dt > 2) { roomGas.splice(k, 1); continue; }
      // the room's latest state only: it already holds what came before it
      if (sx > r.min[0] && sx < r.max[0] && sy > r.min[1] && sy < r.max[1] && sz > r.min[2] && sz < r.max[2]) { Pres = blowDown(r.P, r.T, dt).P; Vres = r.V; break; }
    }
    // the gas that is there, as the mass that made it in the room it filled
    Wroom = gasMass(Pres, Vres) + Wg;
    Pqs = gasPressure(Wroom, V);
    /* the gas builds only to what the room holds (held) and blows down from there through its vents */
    tg = (V / (Math.max(LEAK, Av) * A0)) * Math.log((Pqs * held + P0) / P0) / 2.13;
    iGasAll = gasImpulse(Pqs * held, V, Av);
    iGas0 = Math.max(0, iGasAll - gasImpulse(Pres * held, V, Av));
    const Zr = Math.max(1, 0.5 * Math.cbrt(V)) / cw;
    iMulti = 0.75 * cw * iso(Zr) * cr(pso(Zr));
    roomGas.push({ min: [x0 + rmin[0], y0 + rmin[1], z0 + rmin[2]], max: [x0 + rmax[0] + 1, y0 + rmax[1] + 1, z0 + rmax[2] + 1], P: Pqs * held, V, T: V / (Math.max(LEAK, Av) * A0), t: now });
  }
  const s: Survey = {
    pos: [pos[0], pos[1], pos[2]], W, cw, radius, free, x0, y0, z0, n, occ, steps, roofed, confined, Wg: Wroom, V, Av, held, Pqs, Pres, tg, iGas0, iGas: iGas0, iGasAll, iMulti,
    gas: 0, gasAll: 0,
    roomMin: [x0 + rmin[0], y0 + rmin[1], z0 + rmin[2]], roomMax: [x0 + rmax[0] + 1, y0 + rmax[1] + 1, z0 + rmax[2] + 1],
    ms: 0,
  };
  s.gas = confined ? Math.min(1.2, (s.iGas + held * iMulti) / GAS_IMPULSE) : 0;
  s.gasAll = confined ? Math.min(1.2, (iGasAll + held * iMulti) / GAS_IMPULSE) : 0;
  s.ms = performance.now() - t0;
  return s;
}

/** Walls of `A` m² the gas has blown out vent the rest of the blow-down once they have opened, `tOpen` s after the
 * charge: what the room's other members take. The peak (Pqs, held) was reached before they moved. */
export function vent(s: Survey, A: number, tOpen: number): void {
  if (!s.confined || A <= 0) return;
  s.iGasAll = gasImpulse(s.Pqs * s.held, s.V, s.Av, A, tOpen);
  s.iGas = Math.max(0, s.iGasAll - gasImpulse(s.Pres * s.held, s.V, s.Av, A, tOpen));
  s.gas = Math.min(1.2, (s.iGas + s.held * s.iMulti) / GAS_IMPULSE);
  s.gasAll = Math.min(1.2, (s.iGasAll + s.held * s.iMulti) / GAS_IMPULSE);
  // what is left of it blows down through the walls it took out too
  const r = roomGas[roomGas.length - 1];
  if (r) r.T = s.V / (Math.max(LEAK, s.Av + A) * A0);
}

/** The reverberations on a surface d from the charge: its first reflection again at a half and a quarter, the wave
 * having crossed the room at least once (no nearer than its half-width). */
export function reverb(s: Survey, d: number): number {
  const Z = Math.max(0.2, d, 0.5 * Math.cbrt(Math.max(1, s.V))) / s.cw;
  return 0.75 * s.cw * iso(Z) * cr(pso(Z));
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
export function loadFactors(s: Survey, cp: Vec3, d: number): { shadow: number; gas: number; gasAll: number } {
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
  let gas = 0, gasAll = 0;
  if (inRoom(s, cp)) { gas = s.gas; gasAll = s.gasAll; }
  return { shadow, gas, gasAll };
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
  /* the gas phase and the reverberations build only in a room that holds them (s.held: vented through openings of
     more than about its own wall area the charge is effectively in the open). The wall is judged on the gas it takes
     before it moves, all of the room's (iGasAll); the reverberations are its own first reflection again at half and a quarter (Baker). */
  const gas = s.held > 0 && inRoom(s, c, 0.3);
  if (gas) {
    P = Math.max(P, s.Pqs * s.held);
    I += s.iGasAll + reverb(s, d) * s.held;
  }
  return { P, I, gas };
}

/** Peak overpressure a pane facing the blast along `n` sees (reflected by the angle of incidence), and the side-on
 * value, Pa. */
export function paneLoad(s: Survey, c: Vec3, n: Vec3 | null): { side: number; face: number } {
  const L = pathLength(s, c);
  const d = Math.hypot(c[0] - s.pos[0], c[1] - s.pos[1], c[2] - s.pos[2]);
  let P = pso(L / s.cw);
  if (L > d * 1.02) P *= Math.max(0.25, d / L);
  if (inRoom(s, c, 0.5)) P = Math.max(P, s.Pqs * s.held);
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
