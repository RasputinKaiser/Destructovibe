/* Hydraulic wedge splitter (wedge and feathers on a 500-700 bar ram, Darda class): the feathers go into a drilled
   bore and the wedge drives them apart with up to ~300 t. Brittle material fails in tension across the plane the
   bore lies in, so a block or member opens along its weakest section through the hole; bars crossing that plane
   have to be pulled apart too, which is why reinforced sections mostly stall it. */
import { vec3, quat, clamp } from 'math';
import type { Vec3, Quat, ToolReadout } from '../../types';
import { raycast } from '../../physics/physics';
import { sever, applyImpulseAt, pieceOf, type Piece } from '../../destruction/structure';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { NO_HIT, fillOf, localBounds, piecesNear } from './common';
import { holeNear } from './machining';

export const SPLITTER = { force: 300 * 1000 * 9.81, stroke: 3.2, reach: 2, minDepth: 0.2 };
/* wedge splitting: the spreading force a bore needs to open a tension crack of area A is ≈ 0.6·ft·A */
const WEDGE = 0.6;

export const splitHooks = { notify: (_m: string): void => {}, hit: (_k: number): void => {} };

interface Job { p: Piece; lp: Vec3; la: Vec3; ln: Vec3; A: number; need: number; t: number; F: number; stalled: boolean; ft: number }
let job: Job | null = null;
let now = 0, lastErr: string | null = null, splits = 0, shownAt = -9;
const _q: Quat = [0, 0, 0, 1], _mn: Vec3 = [0, 0, 0], _mx: Vec3 = [0, 0, 0];
const t = (n: number) => Math.round(n / 9810);

/** One press: seat the splitter in the bore under the crosshair and start the pump. */
export function splitterFire(eye: Vec3, fwd: Vec3): string | null {
  shownAt = now;
  if (job && !job.p.dead && !job.stalled) return (lastErr = 'Splitter is already pumping');
  const R = SPLITTER.reach;
  const hit = raycast(eye, [fwd[0] * R, fwd[1] * R, fwd[2] * R], NO_HIT);
  const p = hit ? pieceOf(hit.entity) : null;
  if (!hit || !p) return (lastErr = `Splitter: seat it in a bore within ${R} m`);
  const cls = p.pm.surface;
  if (cls === 'metal' || cls === 'wood' || !Number.isFinite(p.pm.toughness)) return (lastErr = `Splitters open rock, concrete and masonry — not ${p.mat}`);
  const hole = holeNear(p, hit.point as Vec3, 0.12);
  if (!hole) return (lastErr = 'No bore here — drill a Ø40 hole first (Drill Rig, bank III), then seat the splitter in it');
  if (hole.depth < SPLITTER.minDepth) return (lastErr = `Bore only ${Math.round(hole.depth * 1000)} mm deep — the feathers need ${SPLITTER.minDepth * 1000} mm`);
  quat.conjugate(_q, p.curRot as Quat);
  const ln = vec3.transformQuat([0, 0, 0], hole.normal, _q) as Vec3;
  localBounds(p, _mn, _mx);
  const dims: Vec3 = [_mx[0] - _mn[0], _mx[1] - _mn[1], _mx[2] - _mn[2]];
  // the crack plane contains the bore axis: of the member's own planes that do, the smallest section opens
  let best = -1, A = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(ln[k]) > 0.7) continue;
    const a = dims[(k + 1) % 3] * dims[(k + 2) % 3];
    if (a < A) { A = a; best = k; }
  }
  if (best < 0) return (lastErr = 'Bore runs along the member — no plane to open');
  A *= fillOf(p);
  const e = p.pm.eng;
  const ft = e.ft + (e.rho ?? 0) * (e.fy ?? 0);
  const la: Vec3 = [0, 0, 0];
  la[best] = 1;
  const lp = vec3.transformQuat([0, 0, 0], vec3.sub([0, 0, 0], hole.point, p.curPos), _q) as Vec3;
  // seat the feathers halfway down the bore: that's where the crack starts
  vec3.scaleAndAdd(lp, lp, ln, -hole.depth * 0.5);
  job = { p, lp, la, ln, A, need: WEDGE * ft * 1e6 * A, t: 0, F: 0, stalled: false, ft };
  lastErr = null;
  audio.toolEvent('swap', hole.point);
  return null;
}

const _w: Vec3 = [0, 0, 0], _a: Vec3 = [0, 0, 0], _n: Vec3 = [0, 0, 0];

export function splitterStep(dt: number): void {
  now += dt;
  const j = job;
  if (!j) return;
  if (j.p.dead) { job = null; return; }
  if (j.stalled) return;
  j.t += dt;
  j.F = Math.min(SPLITTER.force, (j.t / SPLITTER.stroke) * SPLITTER.force);
  vec3.transformQuat(_w, j.lp, j.p.curRot as Quat);
  vec3.add(_w, _w, j.p.curPos);
  if (Math.floor(j.t * 4) !== Math.floor((j.t - dt) * 4)) audio.rig('splitter', _w, 1, j.F / SPLITTER.force);
  if (j.F >= j.need) { split(j); return; }
  if (j.F >= SPLITTER.force) {
    j.stalled = true;
    audio.rig('splitter', _w, 0, 0);
    audio.toolEvent('stall', _w);
    splitHooks.notify(`Splitter stalls at ${t(SPLITTER.force)} t — this section needs ${t(j.need)} t (drill a line of bores and split it smaller)`);
  }
}

function split(j: Job): void {
  const p = j.p;
  vec3.transformQuat(_a, j.la, p.curRot as Quat);
  vec3.transformQuat(_n, j.ln, p.curRot as Quat);
  const at: Vec3 = [_w[0], _w[1], _w[2]];
  job = null;
  audio.rig('splitter', at, 0, 0);
  if (!sever(p, at, _a)) { splitHooks.notify('The block cracked but held together'); return; }
  splits++;
  splitHooks.hit(0.9);
  // the wedge opens the crack by a few millimetres: the halves ease apart
  for (const { p: q } of piecesNear(at, 0.8)) {
    const s = Math.sign((q.curPos[0] - at[0]) * _a[0] + (q.curPos[1] - at[1]) * _a[1] + (q.curPos[2] - at[2]) * _a[2]) || 1;
    const J = Math.min(q.mass * 0.4, 400);
    applyImpulseAt(q, [_a[0] * J * s, _a[1] * J * s, _a[2] * J * s], q.curPos);
  }
  const across: Vec3 = vec3.cross([0, 0, 0], _a, _n) as Vec3;
  vec3.normalize(across, across);
  fx.crack(at, across, _n, Math.sqrt(j.A) * 1.4, p.pm.dust, p.pm.chips);
  audio.toolEvent('split', at);
}

export function splitterStatus(): ToolReadout | null {
  const j = job;
  if (!j) return now - shownAt < 3 && lastErr ? { title: 'Hydraulic splitter', progress: null, detail: lastErr, warn: true } : null;
  return {
    title: `Hydraulic splitter · ${j.p.mat}`,
    progress: clamp(j.F / Math.min(j.need, SPLITTER.force), 0, 1),
    detail: `${t(j.F)} t of ${t(SPLITTER.force)} t · crack ${j.A.toFixed(2)} m² at ${j.ft.toFixed(1)} MPa needs ${t(j.need)} t${j.stalled ? ' · STALLED' : ''}`,
    warn: j.stalled,
  };
}

export function splitterDebug(): { job: Job | null; splits: number } { return { job, splits }; }

export function clearSplitter(): void { job = null; splits = 0; lastErr = null; }
