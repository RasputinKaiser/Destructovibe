/* Percussive tools: the sledgehammer (a few hundred joules a blow through a flat face) and the handheld hydraulic
   breaker (~55 J blows at 25 Hz through a chisel point). Neither topples a wall: the energy goes into the spot the
   tool lands on, and a fragment comes away once that spot has taken what the material needs to let one go. */
import { vec3, quat, clamp } from 'math';
import type { Vec3, Quat, MaterialId, ToolReadout } from '../../types';
import { raycast } from '../../physics/physics';
import { damagePiece, applyImpulseAt, pieceOf, type Piece } from '../../destruction/structure';
import { fx } from '../../render/fx';
import { audio } from '../../audio/audio';
import { NO_HIT } from './common';
import { SITE_TIME } from './machining';

/* Energy (J) a flat sledge face must put into one spot before a fragment comes away: a pane goes at once, plaster
   and board in a blow or two, a brick unit after three or four good blows, sound concrete after a dozen or more. */
const CHIP: Partial<Record<MaterialId, number>> = {
  glass: 8, lamp: 3, tempered: 60, drywall: 60, insulation: 30, cardboard: 40, plaster: 150, adobe: 200,
  ceramic: 250, roof: 300, terracotta: 350, tnt: 400, pvc: 500, crate: 500, cinderblock: 600, barrel: 800,
  sandstone: 900, brick: 1100, propane: 1200, plywood: 1500, frp: 1500, wood: 2500, castiron: 2500,
  marble: 2600, stone: 2800, oak: 3500, asphalt: 4000, concrete: 4500, rconcrete: 6500,
};

/* Breaker: energy per m³ broken out by a chisel (J/m³), from site rates of a 30 kg-class breaker (≈0.15 m³/h in
   sound concrete). Timber splits and binds on a chisel; metal just skates. */
const BREAK_E: Partial<Record<MaterialId, number>> = {
  drywall: 1e6, glass: 2e6, tempered: 3e6, adobe: 3e6, plaster: 4e6, cinderblock: 7e6, terracotta: 9e6, roof: 9e6,
  brick: 10e6, asphalt: 12e6, ceramic: 15e6, sandstone: 15e6, wood: 25e6, crate: 8e6, plywood: 20e6, oak: 35e6,
  concrete: 30e6, marble: 35e6, rconcrete: 40e6, stone: 45e6, castiron: 60e6,
};

export const SLEDGE = { head: 6.4, vMin: 5.5, vMax: 11, reach: 2.4, wind: 0.55 };
/* 30 kg handheld breaker: 1.6 kW hydraulic in, ~55 J at 1500 blows/min on the steel, ~45 % of that breaks rock */
export const BREAKER = { power: 1600, eff: 0.45, reach: 1.7, chunk: 0.003, blow: 55, rate: 25 };

export const percHooks = {
  notify: (_msg: string): void => {},
  kick: (_k: number): void => {},
  hit: (_k: number): void => {},
};

interface Spot { p: Piece; lp: Vec3; e: number }
const spots: Spot[] = [];
const _q: Quat = [0, 0, 0, 1], _l: Vec3 = [0, 0, 0];

function toLocal(out: Vec3, p: Piece, w: Vec3): Vec3 {
  quat.conjugate(_q, p.curRot as Quat);
  vec3.sub(out, w, p.curPos);
  return vec3.transformQuat(out, out, _q) as Vec3;
}

function spotAt(p: Piece, point: Vec3): Spot {
  toLocal(_l, p, point);
  for (const s of spots) if (s.p === p && vec3.distance(s.lp, _l) < 0.18) return s;
  for (let i = spots.length - 1; i >= 0; i--) if (spots[i].p.dead) spots.splice(i, 1);
  if (spots.length >= 64) spots.shift();
  const s: Spot = { p, lp: [..._l], e: 0 };
  spots.push(s);
  return s;
}

/** Sledge head energy for a swing wound up to k (0..1): ½·m·v² with the head at 5.5–11 m/s. */
export function sledgeEnergy(k: number): number {
  const v = SLEDGE.vMin + (SLEDGE.vMax - SLEDGE.vMin) * clamp(k, 0, 1);
  return 0.5 * SLEDGE.head * v * v;
}

/* A fragment's worth of the spot comes away: the struck region of the member takes a third of its hit points per
   fragment (a brick-built wall drops the units round the blow), so the member breaks up blow by blow. */
function chip(p: Piece, point: Vec3, normal: Vec3, ratio: number): boolean {
  const was = p.queued;
  damagePiece(p, point, p.hp * 0.34 * ratio, false);
  fx.debris(point, Math.round(3 + 3 * Math.min(ratio, 3)), p.pm.chips, 2.5, normal);
  fx.dust(point, 0.35 + 0.1 * Math.min(ratio, 4), p.pm.dust);
  return p.queued && !was;
}

export interface Blow { piece: Piece | null; mat: MaterialId | null; energy: number; point: Vec3; normal: Vec3; chipped: boolean; broke: boolean; progress: number }

/** One sledge blow along the aim, wound up to k: the spot accumulates energy until a fragment comes away. */
export function sledgeBlow(eye: Vec3, fwd: Vec3, k: number): Blow | null {
  const R = SLEDGE.reach;
  const hit = raycast(eye, [fwd[0] * R, fwd[1] * R, fwd[2] * R], NO_HIT);
  if (!hit) return null;
  const E = sledgeEnergy(k);
  const v = Math.sqrt((2 * E) / SLEDGE.head);
  const point: Vec3 = [hit.point[0], hit.point[1], hit.point[2]], normal: Vec3 = [hit.normal[0], hit.normal[1], hit.normal[2]];
  const piece = pieceOf(hit.entity);
  const out: Blow = { piece, mat: piece?.mat ?? null, energy: E, point, normal, chipped: false, broke: false, progress: 0 };
  if (!piece) return out;
  // the head's momentum, with a partial rebound, goes to whatever nothing holds
  if (!piece.welds.length && !piece.hinged) {
    const J = Math.min(SLEDGE.head * v * 1.3, piece.mass * 6);
    applyImpulseAt(piece, [fwd[0] * J, fwd[1] * J, fwd[2] * J], point);
  }
  const need = CHIP[piece.mat];
  if (need === undefined) return out;
  const s = spotAt(piece, point);
  s.e += E;
  out.progress = clamp(s.e / need, 0, 1);
  if (s.e >= need) {
    out.chipped = true;
    out.broke = chip(piece, point, normal, s.e / need);
    s.e = 0;
  } else if (s.e > 0.4 * need) fx.debris(point, 1, piece.pm.chips, 1.5, normal);
  return out;
}

/* ---------------- breaker ---------------- */

interface Work { p: Piece; lp: Vec3; ln: Vec3; removed: number; total: number }
let work: Work | null = null;
let heldAt = -9, now = 0, fxT = 0, lastErr: string | null = null, running = false, broken = 0;
const eye: Vec3 = [0, 0, 0], dir: Vec3 = [0, 0, 1];

/** Called every frame fire is held with the breaker; returns why it can't work. */
export function breakerHold(eyePos: Vec3, fwd: Vec3): string | null {
  vec3.copy(eye, eyePos);
  vec3.copy(dir, fwd);
  heldAt = now;
  const R = BREAKER.reach;
  const hit = raycast(eye, [fwd[0] * R, fwd[1] * R, fwd[2] * R], NO_HIT);
  const p = hit ? pieceOf(hit.entity) : null;
  if (!hit || !p) { work = null; return (lastErr = `Breaker: put the chisel on a member within ${R} m`); }
  if (BREAK_E[p.mat] === undefined) { work = null; return (lastErr = `Chisel skates off ${p.mat} — cut it instead`); }
  const lp = toLocal([0, 0, 0], p, hit.point as Vec3);
  if (!work || work.p !== p || vec3.distance(work.lp, lp) > 0.15) {
    quat.conjugate(_q, p.curRot as Quat);
    work = { p, lp, ln: vec3.transformQuat([0, 0, 0], hit.normal, _q) as Vec3, removed: 0, total: work?.p === p ? work.total : 0 };
  }
  lastErr = null;
  return null;
}

const _wp: Vec3 = [0, 0, 0], _wn: Vec3 = [0, 0, 0];

export function breakerStep(dt: number, held: boolean): void {
  now += dt;
  running = held && now - heldAt < 0.1 && work !== null && !work.p.dead;
  if (work?.p.dead) work = null;
  const w = work;
  if (!running || !w) {
    fxT -= dt;
    if (fxT <= 0) { fxT = 0.1; audio.rig('breaker', eye, 0, 0); }
    return;
  }
  const p = w.p;
  vec3.transformQuat(_wp, w.lp, p.curRot as Quat);
  vec3.add(_wp, _wp, p.curPos);
  vec3.transformQuat(_wn, w.ln, p.curRot as Quat);
  const dV = (BREAKER.power * BREAKER.eff * dt * SITE_TIME) / BREAK_E[p.mat]!;
  w.removed += dV;
  w.total += dV;
  percHooks.kick(0.05);
  if (w.removed >= BREAKER.chunk) {
    w.removed -= BREAKER.chunk;
    broken++;
    percHooks.hit(0.35);
    if (chip(p, [..._wp], [..._wn], 1)) percHooks.hit(0.8);
  }
  fxT -= dt;
  if (fxT <= 0) {
    fxT += 0.06;
    fx.cutDust(_wp, _wn, 0.5, p.pm.dust);
    if (Math.random() < 0.35) fx.debris(_wp, 1, p.pm.chips, 2, _wn);
    audio.rig('breaker', _wp, 1, clamp(w.removed / BREAKER.chunk, 0.3, 1));
  }
}

export function breakerStatus(): ToolReadout | null {
  if (now - heldAt > 0.25) return null;
  if (!work) return { title: 'Hydraulic breaker', progress: null, detail: lastErr ?? 'set the chisel on concrete or masonry', warn: !!lastErr };
  const e = BREAK_E[work.p.mat]!;
  const rate = (BREAKER.power * BREAKER.eff * SITE_TIME) / e;
  return {
    title: `Hydraulic breaker · ${work.p.mat}`,
    progress: clamp(work.removed / BREAKER.chunk, 0, 1),
    detail: `${BREAKER.blow} J × ${BREAKER.rate} Hz · ${(e / 1e6).toFixed(0)} MJ/m³ · ${(rate * 3600 / SITE_TIME).toFixed(2)} m³/h site rate · ${(work.total * 1000).toFixed(1)} L out`,
    warn: false,
  };
}

export function breakerDebug(): { work: Work | null; broken: number; running: boolean } {
  return { work, broken, running };
}

export function clearPercussive(): void {
  spots.length = 0;
  work = null;
  heldAt = -9;
  broken = 0;
  running = false;
}
