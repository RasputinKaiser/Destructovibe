/* Water cannon: a portable fire monitor on a tripod, 1900 L/min at 10 bar. The stream is traced as a ballistic
   jet (gravity plus the drag of a breaking-up column), so it lobs and falls short like the real thing. Where it
   lands it takes heat out of what it wets (sensible heat to 100 °C and the steam it boils off), soaks and douses
   what burns, feeds the gas and water fields, and its momentum flux (ṁ·v) shoves what nothing holds. */
import { vec3 } from 'math';
import type { Vec3, ToolReadout } from '../../types';
import { raycast } from '../../physics/physics';
import { applyImpulseAt, damagePiece, douse, pieceOf, type Piece } from '../../destruction/structure';
import { addWaterSpray, isFragile } from '../../sim/fields/index';
import { heatCap, surfaceArea, recOf } from '../../sim/fields/thermal';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { NO_HIT, piecesNear } from './common';

const RHO = 1000, G = 9.81;
export const MONITOR = {
  flow: 1900 / 60,   // kg/s
  bar: 10,
  cd: 0.97,          // smooth-bore tip discharge coefficient
  drag: 0.017,       // 1/m: the solid column breaks up into drops that the air slows
  fogDrag: 0.07,
  fogV: 0.55,        // a fog pattern throws the same flow at a fraction of the tip speed
  fogCone: 0.32,     // rad half-angle
};
export const JET_V = MONITOR.cd * Math.sqrt((2 * MONITOR.bar * 1e5) / RHO);

export const hoseHooks = {
  /** douse ground fires (firebomb pools) near a point */
  douseAt: (_p: Vec3, _r: number): void => {},
  kick: (_k: number): void => {},
};

export interface JetPath { pts: number[]; n: number; hit: { point: Vec3; normal: Vec3; piece: Piece | null; speed: number; dist: number; dir: Vec3 } | null }

let fog = false;
let heldAt = -9, now = 0, fxT = 0, fieldT = 0, doused = 0, pushed = 0;
let path: JetPath = { pts: [], n: 0, hit: null };
const eye: Vec3 = [0, 0, 0], dir: Vec3 = [0, 0, 1], nozzle: Vec3 = [0, 0, 0];
const wet = new WeakMap<Piece, number>();

export function hoseFog(): boolean { return fog; }
export function toggleFog(): boolean { fog = !fog; return fog; }

/** Trace the stream from the nozzle: 40 ms steps, each checked against the world. */
export function traceJet(from: Vec3, aim: Vec3, fogMode: boolean, out: JetPath = { pts: [], n: 0, hit: null }): JetPath {
  const v0 = JET_V * (fogMode ? MONITOR.fogV : 1), k = fogMode ? MONITOR.fogDrag : MONITOR.drag;
  const p: Vec3 = [...from], v: Vec3 = [aim[0] * v0, aim[1] * v0, aim[2] * v0];
  const h = 0.04;
  out.pts.length = 0;
  out.pts.push(p[0], p[1], p[2]);
  out.hit = null;
  let dist = 0;
  for (let i = 0; i < 90; i++) {
    const s = vec3.length(v);
    v[0] -= k * s * v[0] * h; v[1] -= (k * s * v[1] + G) * h; v[2] -= k * s * v[2] * h;
    const t: Vec3 = [v[0] * h, v[1] * h, v[2] * h];
    const r = raycast(p, t, NO_HIT);
    if (r) {
      const seg = vec3.length(t) * r.fraction;
      dist += seg;
      out.pts.push(r.point[0], r.point[1], r.point[2]);
      const sp = vec3.length(v);
      out.hit = { point: [r.point[0], r.point[1], r.point[2]], normal: [r.normal[0], r.normal[1], r.normal[2]], piece: pieceOf(r.entity), speed: sp, dist, dir: [v[0] / sp, v[1] / sp, v[2] / sp] };
      break;
    }
    dist += vec3.length(t);
    vec3.add(p, p, t);
    out.pts.push(p[0], p[1], p[2]);
    if (p[1] < -5) break;
  }
  out.n = out.pts.length / 3;
  return out;
}

function nozzleAt(out: Vec3): Vec3 {
  return vec3.set(out, eye[0] + dir[0] * 0.9, eye[1] + dir[1] * 0.9 - 0.25, eye[2] + dir[2] * 0.9);
}

export function hoseHold(eyePos: Vec3, fwd: Vec3): void {
  vec3.copy(eye, eyePos);
  vec3.copy(dir, fwd);
  heldAt = now;
}

export function hoseOn(): boolean { return now - heldAt < 0.1; }

const _c: Vec3 = [0, 0, 0];

export function hoseStep(dt: number): void {
  now += dt;
  const on = now - heldAt < 0.1;
  fxT -= dt;
  if (!on) {
    if (fxT <= 0) { fxT = 0.1; audio.rig('hose', eye, 0, 0); }
    return;
  }
  nozzleAt(nozzle);
  traceJet(nozzle, dir, fog, path);
  hoseHooks.kick(0.02);
  const h = path.hit;
  const mdot = MONITOR.flow;
  if (h) {
    const r = fog ? 0.8 + 0.14 * h.dist : 0.3 + 0.025 * h.dist;
    const near = piecesNear(h.point, r);
    let wsum = 0;
    for (const q of near) wsum += 1 - q.d / r;
    const F = mdot * h.speed * (fog ? 0.5 : 1);
    for (const { p: q, d } of near) {
      const share = wsum > 0 ? (1 - d / r) / wsum : 0;
      const mw = mdot * dt * share;
      // half the water runs off; the rest warms to 100 °C and, on a hot surface, boils away
      if (q.temp > 25) {
        const J = 0.5 * mw * (4186 * Math.max(0, Math.min(100, q.temp) - 20) + (q.temp > 100 ? 2.26e6 : 0));
        q.temp = Math.max(20, q.temp - J / heatCap(q));
      }
      const soak = (wet.get(q) ?? 0) + mw;
      wet.set(q, soak);
      const rec = recOf(q);
      rec.wet = Math.min(2, rec.wet + mw / Math.max(1, surfaceArea(q)));
      if (q.burning && soak > Math.max(1, 0.5 * surfaceArea(q))) { douse(q); doused++; }
      const Fq = F * share;
      if (!fog && isFragile(q) && Fq > 400) damagePiece(q, h.point, q.hp * 1.2, false);
      if (!q.welds.length && !q.hinged) {
        const J = Math.min(Fq * dt, q.mass * 0.25);
        applyImpulseAt(q, [h.dir[0] * J, h.dir[1] * J * 0.3, h.dir[2] * J], q.curPos);
        if (J > 1) pushed++;
      }
    }
    hoseHooks.douseAt(h.point, r + 0.5);
  }
  fieldT -= dt;
  if (fieldT <= 0) {
    fieldT += 0.1;
    // the spray the stream sheds on the way, and the splash where it lands, go into the gas and water fields
    const n = path.n;
    if (fog) for (const f of [0.35, 0.7]) {
      const i = Math.floor(n * f) * 3;
      addWaterSpray([path.pts[i], path.pts[i + 1], path.pts[i + 2]], dir, mdot * 0.25, 0.1);
    }
    if (h) {
      vec3.scaleAndAdd(_c, h.point, h.normal, 0.3);
      addWaterSpray(_c, [h.dir[0], -0.5, h.dir[2]], mdot * (fog ? 0.5 : 0.8), 0.1);
    }
  }
  if (fxT <= 0) {
    fxT += 0.05;
    const n = path.n;
    for (let k = 0; k < 3; k++) {
      const i = Math.min(n - 2, Math.floor(((k + Math.random()) / 3) * (n - 1))) * 3;
      const a: Vec3 = [path.pts[i], path.pts[i + 1], path.pts[i + 2]], b: Vec3 = [path.pts[i + 3], path.pts[i + 4], path.pts[i + 5]];
      vec3.sub(_c, b, a);
      fx.waterJet(a, _c, fog ? 0.6 : 0.15, fog ? 1.6 : 1);
    }
    if (h) fx.waterSpray(h.point, [h.normal[0] - h.dir[0], h.normal[1] + 0.4, h.normal[2] - h.dir[2]], fog ? 1.2 : 1.6);
    audio.rig('hose', nozzle, 1, fog ? 0.5 : 0.8);
    if (h) audio.waterSpray(h.point, 1.5);
  }
}

export function hosePath(): JetPath { return path; }

export function hoseStatus(): ToolReadout | null {
  if (now - heldAt > 0.25) {
    return { title: `Water cannon · ${fog ? 'fog' : 'straight stream'}`, progress: null, detail: `${Math.round(MONITOR.flow * 60)} L/min @ ${MONITOR.bar} bar · RMB ${fog ? 'straight stream' : 'fog pattern'}`, warn: false };
  }
  const h = path.hit;
  return {
    title: `Water cannon · ${fog ? 'fog' : 'straight stream'}`,
    progress: null,
    detail: h
      ? `${Math.round(MONITOR.flow * 60)} L/min · tip ${Math.round(JET_V * (fog ? MONITOR.fogV : 1))} m/s · lands ${h.dist.toFixed(0)} m out at ${h.speed.toFixed(0)} m/s · ${(MONITOR.flow * h.speed * (fog ? 0.5 : 1) / 1000).toFixed(2)} kN on target`
      : 'stream falls short of anything',
    warn: !h,
  };
}

export function hoseDebug(): { doused: number; pushed: number; path: JetPath } { return { doused, pushed, path }; }

export function clearHose(): void {
  heldAt = -9;
  doused = 0;
  pushed = 0;
  path = { pts: [], n: 0, hit: null };
}
