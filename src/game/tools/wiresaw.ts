/* Diamond wire saw: a loop of beaded wire (Ø11 mm beads) is threaded round the member and driven at ~25 m/s by a
   22 kW flywheel unit that backs away on its rail to keep the wire tensioned. It cuts any section at a steady area
   rate (site figures: 2-4 m²/h through reinforced concrete, well under 1 m²/h through solid steel), bars included,
   and runs unattended: rig it, start it, walk away. As the kerf deepens the ligament left caps what the member's
   connections can pass on, so a loaded member lets go before the wire is fully through. */
import { vec3, quat, clamp } from 'math';
import type { Vec3, Quat, MaterialId, ToolReadout } from '../../types';
import { raycast } from '../../physics/physics';
import { sever, limitPiece, cutRebarNear, pieceOf, type Piece } from '../../destruction/structure';
import { cables } from '../../render/cables';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { NO_HIT, memberAxis, sectionArea, localBounds, piecesNear, nearestPiece } from './common';
import { SITE_TIME } from './machining';

/* cutting rate with a 22 kW unit, m²/h */
const RATE: Partial<Record<MaterialId, number>> = {
  rconcrete: 2.5, concrete: 3.5, brick: 5, cinderblock: 6, stone: 1.5, marble: 2, sandstone: 4, terracotta: 5,
  ceramic: 3, asphalt: 4, glass: 3, tempered: 3, adobe: 8, plaster: 8, roof: 5, steel: 0.6, metal: 0.8, machine: 0.6,
  castiron: 0.8, aluminum: 1.5, copper: 1.2, wood: 10, oak: 8, plywood: 10, frp: 3,
};
export const WIRE = { power: 22e3, reach: 3, standoff: 3.5, speed: 25 };
export const wireHooks = { notify: (_m: string): void => {}, hit: (_k: number): void => {} };

interface Rig {
  p: Piece; lp: Vec3; la: Vec3; k: number; A: number; width: number; done: number; running: boolean;
  unit: Vec3; wires: number[]; mat: MaterialId; limit: number;
}
let rig: Rig | null = null;
let now = 0, fxT = 0, cutsDone = 0, lastErr: string | null = null, shownAt = -9;
const _q: Quat = [0, 0, 0, 1], _mn: Vec3 = [0, 0, 0], _mx: Vec3 = [0, 0, 0];
const rate = (m: MaterialId): number => ((RATE[m] ?? 2) * SITE_TIME) / 3600;

export function wireActive(): boolean { return rig !== null; }

/** One press: rig the loop round the aimed member, or start/stop the rigged one. */
export function wireFire(eye: Vec3, fwd: Vec3): string | null {
  shownAt = now;
  const R = WIRE.reach;
  const hit = raycast(eye, [fwd[0] * R, fwd[1] * R, fwd[2] * R], NO_HIT);
  const p = hit ? pieceOf(hit.entity) : null;
  if (rig && (!p || p === rig.p)) {
    rig.running = !rig.running;
    if (!rig.running) audio.rig('wiresaw', rig.unit, 0, 0);
    wireHooks.notify(rig.running ? 'Wire saw running' : 'Wire saw stopped');
    return null;
  }
  if (!hit || !p) return (lastErr = `Wire saw: thread the loop round a member within ${R} m`);
  if (p.hinged) return (lastErr = 'Not on moving machinery');
  const axis: Vec3 = [0, 0, 0], across: Vec3 = [0, 0, 0];
  const width = memberAxis(p, hit.normal as Vec3, axis, across);
  const sec = sectionArea(p, axis);
  if (Math.max(sec.dims[(sec.k + 1) % 3], sec.dims[(sec.k + 2) % 3]) > 6) return (lastErr = 'Too big to loop — wire saws take sections up to 6 m across');
  removeRig();
  quat.conjugate(_q, p.curRot as Quat);
  const lp = vec3.transformQuat([0, 0, 0], vec3.sub([0, 0, 0], hit.point as Vec3, p.curPos), _q) as Vec3;
  const la = vec3.transformQuat([0, 0, 0], axis, _q) as Vec3;
  // the drive unit stands back from the member toward the operator, on whatever is below
  let hx = eye[0] - hit.point[0], hz = eye[2] - hit.point[2];
  const hl = Math.hypot(hx, hz) || 1;
  hx /= hl; hz /= hl;
  const ux = hit.point[0] + hx * WIRE.standoff, uz = hit.point[2] + hz * WIRE.standoff;
  const down = raycast([ux, hit.point[1] + 2, uz], [0, -60, 0], NO_HIT);
  const unit: Vec3 = [ux, (down ? down.point[1] : 0) + 0.6, uz];
  rig = { p, lp, la, k: sec.k, A: sec.A, width, done: 0, running: true, unit, wires: [], mat: p.mat, limit: Infinity };
  for (let i = 0; i < 6; i++) rig.wires.push(cables.add(0.007, 0x8d949b));
  lastErr = null;
  audio.chargeStick(hit.point as Vec3);
  return null;
}

export function removeRig(): boolean {
  if (!rig) return false;
  audio.rig('wiresaw', rig.unit, 0, 0);
  for (const w of rig.wires) cables.remove(w);
  rig = null;
  return true;
}

const _c: Vec3 = [0, 0, 0], _a: Vec3 = [0, 0, 0];

function centre(r: Rig, out: Vec3): Vec3 {
  localBounds(r.p, _mn, _mx);
  const l: Vec3 = [(_mn[0] + _mx[0]) / 2, (_mn[1] + _mx[1]) / 2, (_mn[2] + _mx[2]) / 2];
  l[r.k] = r.lp[r.k];
  vec3.transformQuat(out, l, r.p.curRot as Quat);
  return vec3.add(out, out, r.p.curPos) as Vec3;
}

export function wireStep(dt: number): void {
  now += dt;
  const r = rig;
  if (!r || !r.running) return;
  if (r.p.dead) {
    // what the wire was round broke up: keep going on whichever fragment now holds the loop
    const at = centre(r, _c);
    const q = nearestPiece(at, 0.3);
    if (!q) { removeRig(); wireHooks.notify('Wire saw: the member it was round has gone'); return; }
    quat.conjugate(_q, q.curRot as Quat);
    r.lp = vec3.transformQuat([0, 0, 0], vec3.sub([0, 0, 0], at, q.curPos), _q) as Vec3;
    r.la = vec3.transformQuat([0, 0, 0], vec3.transformQuat(_a, r.la, r.p.curRot as Quat), _q) as Vec3;
    r.p = q;
    const s = sectionArea(q, vec3.transformQuat(_a, r.la, q.curRot as Quat) as Vec3);
    r.k = s.k;
    r.A = Math.max(s.A, 1e-3);
    r.done = Math.min(r.done, r.A * 0.95);
  }
  const p = r.p;
  r.done += rate(p.mat) * dt;
  const x = clamp(r.done / r.A, 0, 1);
  const fy = Math.max(1, p.pm.eng.fc) * 1e6 * Math.max(0.05, p.heatK);
  const lig = (1 - x) * r.A * fy;
  if (lig < r.limit * 0.98) { limitPiece(p, lig); r.limit = lig; }
  fxT -= dt;
  if (fxT <= 0) {
    fxT += 0.08;
    centre(r, _c);
    vec3.sub(_a, r.unit, _c);
    vec3.normalize(_a, _a);
    fx.cutDust(_c, _a, 0.4, p.pm.surface === 'metal' ? 0x5a5550 : 0x9c9a94);
    audio.rig('wiresaw', r.unit, 1, 0.4 + 0.5 * x);
  }
  if (x < 1) return;
  const at = centre(r, [0, 0, 0]);
  const axis = vec3.transformQuat([0, 0, 0], r.la, p.curRot as Quat) as Vec3;
  removeRig();
  if (!sever(p, at, axis)) { wireHooks.notify('Wire saw through — the member is too small to part'); return; }
  cutsDone++;
  for (const { p: q } of piecesNear(at, 1)) cutRebarNear(q, at, 1);
  wireHooks.hit(0.9);
  audio.toolEvent('through', at);
  fx.cutThrough(at, [axis[1], axis[2], axis[0]], 1, 'teeth');
}

const _p: Vec3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

/** Per rendered frame: the wire loop round the section and the two runs back to the drive unit. */
export function syncWire(): void {
  const r = rig;
  if (!r || r.p.dead) return;
  localBounds(r.p, _mn, _mx);
  const u = (r.k + 1) % 3, v = (r.k + 2) % 3;
  const corners = [[_mn[u], _mn[v]], [_mx[u], _mn[v]], [_mx[u], _mx[v]], [_mn[u], _mx[v]]];
  corners.forEach(([a, b], i) => {
    const l: Vec3 = [0, 0, 0];
    l[r.k] = r.lp[r.k]; l[u] = a; l[v] = b;
    vec3.transformQuat(_p[i], l, r.p.curRot as Quat);
    vec3.add(_p[i], _p[i], r.p.curPos);
  });
  for (let i = 0; i < 4; i++) cables.set(r.wires[i], _p[i], _p[(i + 1) % 4], 0);
  // the two runs leave from the corners nearest the unit
  const order = [0, 1, 2, 3].sort((i, j) => vec3.squaredDistance(_p[i], r.unit) - vec3.squaredDistance(_p[j], r.unit));
  cables.set(r.wires[4], r.unit, _p[order[0]], 0.02);
  cables.set(r.wires[5], [r.unit[0], r.unit[1] + 0.25, r.unit[2]], _p[order[1]], 0.02);
  const x = clamp(r.done / r.A, 0, 1);
  vec3.sub(_c, r.unit, _p[order[0]]);
  vec3.normalize(_c, _c);
  const n: Vec3 = [_c[0], _c[1], _c[2]];
  const across: Vec3 = vec3.sub([0, 0, 0], _p[order[1]], _p[order[0]]) as Vec3;
  const w = vec3.length(across);
  if (w > 1e-3) {
    vec3.scale(across, across, 1 / w);
    const mid: Vec3 = [(_p[order[0]][0] + _p[order[1]][0]) / 2, (_p[order[0]][1] + _p[order[1]][1]) / 2, (_p[order[0]][2] + _p[order[1]][2]) / 2];
    fx.kerf(8, mid, across, n, w, x, 0.011, 0, 0);
  }
}

export function wireStatus(): ToolReadout | null {
  const r = rig;
  if (!r) return now - shownAt < 3 && lastErr ? { title: 'Diamond wire saw', progress: null, detail: lastErr, warn: true } : { title: 'Diamond wire saw', progress: null, detail: 'LMB: loop the wire round a member', warn: false };
  const rt = rate(r.p.mat);
  const left = Math.max(0, r.A - r.done) / rt;
  return {
    title: `Diamond wire saw · ${r.p.mat}${r.running ? '' : ' · stopped'}`,
    progress: clamp(r.done / r.A, 0, 1),
    detail: `${r.A.toFixed(2)} m² at ${RATE[r.p.mat] ?? 2} m²/h · ${Math.ceil(left)} s left · ${WIRE.power / 1000} kW · LMB ${r.running ? 'stop' : 'start'} · RMB unrig`,
    warn: false,
  };
}

export function wireDebug(): { rig: Rig | null; cuts: number } { return { rig, cuts: cutsDone }; }

export function clearWire(): void {
  if (rig) for (const w of rig.wires) cables.remove(w);
  rig = null;
  cutsDone = 0;
  lastErr = null;
}
