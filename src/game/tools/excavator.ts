/* Excavator remote: drives the nearest tracked excavator's own hydraulics (slew, boom, stick, bucket) through its
   valves. Held fire puts the bucket teeth where the crosshair is: the three arm axes are solved each step by damped
   least squares on the arm's live geometry, and each valve opens in proportion to what its axis still has to turn.
   Teeth pushed into the ground dig it out at what the machine's hydraulic power buys in soil (bank m³; it comes up
   bulked, and the bucket's heaped capacity is loose m³); the bucket carries what it dug (its mass and kind, heaped
   in the bucket for all to see) and tips it as a falling stream that lands and runs to its angle of repose. */
import { vec3, quat, clamp } from 'math';
import type { Vec3, Quat, ToolReadout } from '../../types';
import { b3, raycast } from '../../physics/physics';
import { live, pieceOf, type Piece } from '../../destruction/structure';
import { mechCommand, mechPose } from '../../destruction/services';
import { digGround, spill, groundAt, surfaceAt } from '../../terrain/terrain';
import { SURFACE } from '../../terrain/surface';
import { SOIL, carriers, type CarryView, type SoilId } from '../../terrain/soil';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { NO_HIT } from './common';

/* 20 t class: 1.0 m³ heaped bucket, ~110 kW engine of which ~35 % reaches the teeth; loose-to-firm soil takes
   ~0.35 MJ per m³ to cut and lift, so a pass fills the bucket in 8-10 s of digging. */
export const DIGGER = { link: 45, bucket: 1.0, power: 110e3, eff: 0.35, soil: 0.35e6, reach: 10.5, gain: 3.5, dead: 0.12 };

/* height over grade of the bucket's lowest point at which it is biting */
const BITE = 0.12;

export const excHooks = { notify: (_m: string): void => {} };

interface Rig {
  low: number; sign: number[]; house: Piece; boom: Piece; stick: Piece; bucket: Piece; teeth: Piece | null;
  /** loose m³ in the bucket, its mass (kg) and kind */
  load: number; mass: number; soil: SoilId;
  pending: number; digT: number; dug: number; dumped: number;
  /** kg/s while tipping */
  pour: number;
  /** the bucket's mouth in its spawn frame: centre, half-width, half-length */
  mouth: { c: Vec3; hx: number; hz: number };
}
let rig: Rig | null = null;
let skidT = -9, now = 0, heldAt = -9, dumpT = 0, curl = 0, fxT = 0, lastErr: string | null = null, digging = false, reachOk = true;
const target: Vec3 = [0, 0, 0];
let targetGround = false;

const alive = (r: Rig): boolean => ![r.house, r.boom, r.stick, r.bucket].some(p => p.dead);

/* An arm is a chain of four driven hinges (bucket → stick → boom → slewing house) above a fixed undercarriage. */
function findRig(at: Vec3, range: number): Rig | null {
  let best: Rig | null = null, bd = range;
  for (const p of live) {
    if (p.dead || !p.hinged) continue;
    const chain: Piece[] = [p];
    let q: Piece = p;
    for (let i = 0; i < 4; i++) {
      const h = mechPose(q)?.host;
      if (!h || !h.hinged) break;
      chain.push(h);
      q = h;
    }
    if (chain.length !== 4) continue;
    const [bucket, stick, boom, house] = chain;
    const hp = mechPose(house);
    if (!hp || Math.abs(hp.axis[1]) < 0.9) continue;
    const d = vec3.distance(house.curPos, at);
    if (d >= bd) continue;
    let teeth: Piece | null = null;
    for (const m of bucket.mechs ?? []) if (m.host === bucket && m.part !== bucket && !m.drive) teeth = m.part;
    bd = d;
    best = { low: 0, sign: [0, 0, 0], house, boom, stick, bucket, teeth, load: 0, mass: 0, soil: 'topsoil', pending: 0, digT: 0, dug: 0, dumped: 0, pour: 0, mouth: mouthOf(bucket) };
  }
  if (!best) return null;
  for (const p of [best.house, best.boom, best.stick, best.bucket]) if (!mechCommand(p, 0)) return null;
  return best;
}

/* The bucket's open top as spawned: the highest face of its hull. */
function mouthOf(p: Piece): Rig['mouth'] {
  const sp = p.root.spec, vs = sp.verts;
  if (!vs?.length) return { c: [sp.pos[0], sp.pos[1] + sp.size[1] / 2, sp.pos[2]], hx: sp.size[0] / 2, hz: sp.size[2] / 2 };
  const top = Math.max(...vs.map(v => v[1]));
  const lid = vs.filter(v => v[1] > top - 0.02);
  const x0 = Math.min(...lid.map(v => v[0])), x1 = Math.max(...lid.map(v => v[0])), z0 = Math.min(...lid.map(v => v[2])), z1 = Math.max(...lid.map(v => v[2]));
  return { c: [sp.pos[0] + (x0 + x1) / 2, sp.pos[1] + top, sp.pos[2] + (z0 + z1) / 2], hx: Math.max(0.1, (x1 - x0) / 2), hz: Math.max(0.1, (z1 - z0) / 2) };
}

const _dq: Quat = [0, 0, 0, 1];
/** hinge axis and pivot of a machine part, now */
function frame(p: Piece, axis: Vec3, pivot: Vec3): void {
  const m = p.root.spec.mech!;
  quat.multiply(_dq, p.curRot as Quat, quat.conjugate([0, 0, 0, 1], p.spawnRot));
  vec3.transformQuat(axis, m.axis, _dq);
  vec3.normalize(axis, axis);
  vec3.sub(pivot, m.at, p.spawnPos);
  vec3.transformQuat(pivot, pivot, _dq);
  vec3.add(pivot, pivot, p.curPos);
}

function tip(r: Rig, out: Vec3): Vec3 {
  return vec3.copy(out, (r.teeth && !r.teeth.dead ? r.teeth : r.bucket).curPos) as Vec3;
}

const _bb: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
function bottom(p: Piece): number {
  b3.b3Body_ComputeAABB(_bb, p.body);
  return _bb[1];
}

export function excavatorLinked(): Piece | null { return rig && alive(rig) ? rig.house : null; }

function isRig(p: Piece | null): boolean {
  if (!p || !rig) return false;
  if (p === rig.house || p === rig.boom || p === rig.stick || p === rig.bucket || p === rig.teeth) return true;
  for (const m of p.mechs ?? []) if (m.part === p && (m.host === rig.house || m.host === rig.bucket)) return true;
  return false;
}

/** Aim point for the teeth: the crosshair's hit, looking past the machine's own arm. */
function aimPoint(eye: Vec3, fwd: Vec3): { point: Vec3; ground: boolean } | null {
  const o: Vec3 = [...eye];
  for (let i = 0; i < 4; i++) {
    const hit = raycast(o, [fwd[0] * 60, fwd[1] * 60, fwd[2] * 60], NO_HIT);
    if (!hit) return null;
    const p = pieceOf(hit.entity);
    if (!isRig(p)) return { point: [hit.point[0], hit.point[1], hit.point[2]], ground: hit.entity?.kind === 'ground' || !p };
    vec3.scaleAndAdd(o, hit.point as Vec3, fwd, 0.05);
  }
  return null;
}

/** Fire held: link on the first press, then drive the teeth toward the crosshair. */
export function excavatorHold(eye: Vec3, fwd: Vec3, fresh: boolean): string | null {
  if (rig && !alive(rig)) release();
  if (!rig || (fresh && vec3.distance(rig.house.curPos, eye) > DIGGER.link + 20)) {
    if (!fresh) return lastErr;
    release();
    rig = findRig(eye, DIGGER.link);
    if (!rig) {
      // say where the nearest one is, so the remote is never a dead end
      const far = findRig(eye, 2000);
      if (!far) return (lastErr = 'No excavator on this site — spawn one (B, industrial) to drive by remote');
      const dx = far.house.curPos[0] - eye[0], dz = far.house.curPos[2] - eye[2];
      const dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360 / 45) % 8];
      return (lastErr = `Nearest excavator ${Math.round(Math.hypot(dx, dz))} m ${dir} — get within ${DIGGER.link} m to take over`);
    }
    excHooks.notify(`Excavator linked, ${vec3.distance(rig.house.curPos, eye).toFixed(0)} m away — hold fire to dig where you aim`);
    lastErr = null;
    heldAt = now;
    return null;
  }
  const a = aimPoint(eye, fwd);
  if (!a) return (lastErr = 'Aim the bucket at the ground or a structure');
  vec3.copy(target, a.point);
  targetGround = a.ground;
  // into the ground: push the teeth a bucket's depth below grade so they bite
  if (a.ground) target[1] -= 0.45;
  heldAt = now;
  lastErr = null;
  return null;
}

/** Wheel: curl the bucket in (+) or out (−). */
export function excavatorCurl(dir: number): void { curl = clamp(curl + dir * 0.35, -1.2, 1.2); }

/** Right button: dump what the bucket holds. */
export function excavatorDump(): boolean {
  if (!rig) return false;
  dumpT = 1.4;
  return true;
}

const _t: Vec3 = [0, 0, 0], _e: Vec3 = [0, 0, 0], _a: Vec3 = [0, 0, 0], _o: Vec3 = [0, 0, 0], _c: Vec3 = [0, 0, 0];
const J = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];

/* Damped least squares: dq = Jᵀ (J Jᵀ + λ² I)⁻¹ e over the three arm axes. */
function solve(r: Rig, e: Vec3, out: number[]): void {
  const parts = [r.house, r.boom, r.stick];
  tip(r, _t);
  for (let j = 0; j < 3; j++) {
    frame(parts[j], _a, _o);
    vec3.sub(_c, _t, _o);
    vec3.cross(_c, _a, _c);
    J[j][0] = _c[0]; J[j][1] = _c[1]; J[j][2] = _c[2];
  }
  const l2 = 0.4;
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    let s = 0;
    for (let j = 0; j < 3; j++) s += J[j][a] * J[j][b];
    M[a * 3 + b] = s + (a === b ? l2 : 0);
  }
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  if (Math.abs(det) < 1e-9) { out[0] = out[1] = out[2] = 0; return; }
  const inv = [
    (M[4] * M[8] - M[5] * M[7]) / det, (M[2] * M[7] - M[1] * M[8]) / det, (M[1] * M[5] - M[2] * M[4]) / det,
    (M[5] * M[6] - M[3] * M[8]) / det, (M[0] * M[8] - M[2] * M[6]) / det, (M[2] * M[3] - M[0] * M[5]) / det,
    (M[3] * M[7] - M[4] * M[6]) / det, (M[1] * M[6] - M[0] * M[7]) / det, (M[0] * M[4] - M[1] * M[3]) / det,
  ];
  const y = [0, 1, 2].map(a => inv[a * 3] * e[0] + inv[a * 3 + 1] * e[1] + inv[a * 3 + 2] * e[2]);
  for (let j = 0; j < 3; j++) out[j] = J[j][0] * y[0] + J[j][1] * y[1] + J[j][2] * y[2];
}

const dq = [0, 0, 0];
const _r: Quat = [0, 0, 0, 1], _r0: Quat = [0, 0, 0, 1], _ax: Vec3 = [0, 0, 0];

/* Which way the joint's own angle turns about the declared hinge axis: read off the part's rotation relative to
   its host since spawn, once the joint has moved far enough to tell. */
function jointSign(r: Rig, j: number, p: Piece): number {
  if (r.sign[j] !== 0) return r.sign[j];
  const pose = mechPose(p);
  const h = pose?.host;
  if (!pose || !h || Math.abs(pose.at) < 0.03) return 1;
  quat.multiply(_r, quat.conjugate(_r, h.curRot as Quat), p.curRot as Quat);
  quat.multiply(_r0, quat.conjugate(_r0, h.spawnRot), p.spawnRot);
  quat.multiply(_r, _r, quat.conjugate(_r0, _r0));
  vec3.transformQuat(_ax, p.root.spec.mech!.axis, quat.conjugate(_r0, h.spawnRot));
  const turn = (_r[0] * _ax[0] + _r[1] * _ax[1] + _r[2] * _ax[2]) * Math.sign(_r[3] || 1);
  if (Math.abs(turn) < 1e-3) return 1;
  r.sign[j] = Math.sign(turn) === Math.sign(pose.at) ? 1 : -1;
  return r.sign[j];
}

export function excavatorStep(dt: number): void {
  now += dt;
  const r = rig;
  if (!r) return;
  if (!alive(r)) { release(); excHooks.notify('Excavator link lost — the machine is wrecked'); return; }
  const held = now - heldAt < 0.1;
  tip(r, _t);
  digging = false;
  if (held) {
    vec3.sub(_e, target, _t);
    solve(r, _e, dq);
    const err = vec3.length(_e);
    const parts = [r.house, r.boom, r.stick];
    for (let j = 0; j < 3; j++) mechCommand(parts[j], err < DIGGER.dead ? 0 : clamp(jointSign(r, j, parts[j]) * dq[j] * DIGGER.gain, -1, 1));
    frame(r.boom, _a, _o);
    reachOk = vec3.distance(target, _o) < DIGGER.reach;
  } else for (const p of [r.house, r.boom, r.stick]) mechCommand(p, 0);

  // bucket: dumping overrides, then the wheel's curl pulses, then a gentle curl while it bites
  let bc = 0;
  if (dumpT > 0) {
    dumpT -= dt;
    bc = -1;
    // once the bucket has rolled open the spoil pours off its lip for ~0.8 s, clod by clod
    if (r.mass > 0 && dumpT < 0.9) {
      if (r.pour <= 0) { r.pour = r.mass / 0.8; audio.toolEvent('dump', _t); }
      const m = dumpT <= dt ? r.mass : Math.min(r.mass, r.pour * dt);
      const v = r.bucket.vel ?? [0, 0, 0], col = SOIL[r.soil].color;
      for (let c = 0; c < 2; c++) {
        const a = now * 37 + c * 2.4;
        spill([_t[0] + 0.25 * Math.cos(a), _t[1] - 0.1, _t[2] + 0.25 * Math.sin(a)], [v[0] * 0.5 + 0.4 * Math.cos(a), Math.min(0, v[1]) - 0.5, v[2] * 0.5 + 0.4 * Math.sin(a)], m / 2, r.soil);
      }
      if ((fxT * 10 | 0) % 2 === 0) fx.grainSpill([_t[0], _t[1] - 0.2, _t[2]], [0, -1, 0], 6, col);
      r.dumped += (r.load * m) / r.mass;
      r.load -= (r.load * m) / r.mass;
      r.mass -= m;
      if (r.mass < 0.5) { r.mass = 0; r.load = 0; r.pour = 0; fx.dust([_t[0], groundAt(_t[0], _t[2]), _t[2]], 1.2, col); }
    }
  } else if (Math.abs(curl) > 0.01) {
    bc = Math.sign(curl);
    curl -= Math.sign(curl) * Math.min(Math.abs(curl), dt);
  }

  const gy = groundAt(_t[0], _t[2]);
  const low = r.low = Math.min(bottom(r.bucket), r.teeth && !r.teeth.dead ? bottom(r.teeth) : Infinity);
  const soft = SURFACE[surfaceAt(_t[0], _t[2])]?.soaks ?? true;
  if (held && targetGround && !soft && low < gy + BITE && now - skidT > 4) {
    skidT = now;
    excHooks.notify('Teeth skid on the pavement — break it out first (breaker, charge)');
  }
  if (held && targetGround && soft && low < gy + BITE && r.load < DIGGER.bucket) {
    digging = true;
    if (bc === 0) bc = 0.35;
    r.pending += ((DIGGER.power * DIGGER.eff) / DIGGER.soil) * dt;
    r.digT -= dt;
    if (r.digT <= 0) {
      r.digT = 0.25;
      // bank m³ the power has bought, no more than the bucket has room for once it bulks (~25 %)
      const want = Math.min(r.pending, (DIGGER.bucket - r.load) / 1.25);
      const rad = 0.6;
      const got = digGround(_t[0], _t[2], rad, want / (0.5 * Math.PI * rad * rad));
      r.pending = 0;
      if (got.mass > 0) {
        if (got.mass > r.mass) r.soil = got.soil;
        r.mass += got.mass;
        r.load = Math.min(DIGGER.bucket, r.load + got.vol);
        r.dug += got.vol;
        const col = SOIL[got.soil].color;
        fx.debris([_t[0], gy + 0.1, _t[2]], 6, col, 2.5, [0, 1, 0]);
        fx.dust([_t[0], gy, _t[2]], 0.6, col);
      }
      if (r.load >= DIGGER.bucket - 1e-3) excHooks.notify('Bucket full — right-click to dump');
    }
  }
  mechCommand(r.bucket, bc);
  fxT -= dt;
  if (fxT <= 0) {
    fxT += 0.2;
    audio.rig('excavator', r.house.curPos, 1, held || dumpT > 0 || bc !== 0 ? (digging ? 0.9 : 0.55) : 0.15);
  }
}

export function excavatorAim(): { target: Vec3; tip: Vec3; ok: boolean; held: boolean } | null {
  if (!rig) return null;
  return { target, tip: tip(rig, [0, 0, 0]), ok: reachOk, held: now - heldAt < 0.1 };
}

export function excavatorStatus(eye: Vec3): ToolReadout {
  const r = rig;
  if (!r) return { title: 'Excavator remote', progress: null, detail: lastErr ?? `LMB: take over the nearest excavator (within ${DIGGER.link} m)`, warn: !!lastErr };
  const deg = (p: Piece) => Math.round(((mechPose(p)?.at ?? 0) * 180) / Math.PI);
  tip(r, _t);
  const below = groundAt(_t[0], _t[2]) - _t[1];
  return {
    title: `Excavator · ${vec3.distance(r.house.curPos, eye).toFixed(0)} m${digging ? ' · digging' : ''}`,
    progress: r.load / DIGGER.bucket,
    detail: `bucket ${r.load.toFixed(2)}/${DIGGER.bucket.toFixed(1)} m³${r.mass > 1 ? ` ${r.soil} ${(r.mass / 1000).toFixed(2)} t` : ''} · slew ${deg(r.house)}° boom ${deg(r.boom)}° stick ${deg(r.stick)}° · teeth ${below > 0 ? `${below.toFixed(2)} m below` : `${(-below).toFixed(1)} m above`} grade${reachOk ? '' : ' · OUT OF REACH'} · RMB dump · wheel curl`,
    warn: !reachOk,
  };
}

export function excavatorDebug(): Rig | null { return rig; }

function release(): void {
  if (rig) for (const p of [rig.house, rig.boom, rig.stick, rig.bucket]) if (!p.dead) mechCommand(p, null);
  if (rig) audio.rig('excavator', rig.house.curPos, 0, 0);
  rig = null;
}

export function clearExcavator(): void {
  rig = null;
  heldAt = -9;
  dumpT = 0;
  curl = 0;
  lastErr = null;
}

/* The load heaped in the bucket, for the renderer: the mouth as the bucket now stands, and how full it is. */
const _cv: CarryView = { pos: [0, 0, 0], rot: [0, 0, 0, 1], hx: 0, hz: 0, fill: 0, color: 0 };
carriers.add(() => {
  const r = rig;
  if (!r || r.load < 0.02 || r.bucket.dead) return null;
  const b = r.bucket;
  quat.multiply(_cv.rot as Quat, b.curRot as Quat, quat.conjugate([0, 0, 0, 1], b.spawnRot));
  vec3.sub(_cv.pos as Vec3, r.mouth.c, b.spawnPos);
  vec3.transformQuat(_cv.pos as Vec3, _cv.pos as Vec3, _cv.rot as Quat);
  vec3.add(_cv.pos as Vec3, _cv.pos as Vec3, b.curPos);
  _cv.hx = r.mouth.hx; _cv.hz = r.mouth.hz;
  _cv.fill = r.load / DIGGER.bucket;
  _cv.color = SOIL[r.soil].color;
  return _cv;
});
