import * as THREE from 'three';
import { vec3, clamp } from 'math';
import type { Vec3, ToolReadout } from '../../types';
import { raycast } from '../../physics/physics';
import { pieceOf } from '../../destruction/structure';
import { vehicleOf } from '../../vehicles/vehicle';
import { getProjectileMaterial } from '../../render/materials';
import { audio } from '../../audio/audio';
import { hitmarker } from '../../ui/ui';
import { viewmodel } from '../../render/viewmodel';
import { player } from '../player';
import { NO_HIT, interpPoint, toolHooks } from './common';
import {
  LINES, makeLine, makeStake, faceStake, anchorOn, anchorWorld, releaseLine, setRest, currentLength, lineBar, inSnapZone,
  type Anchor, type Line,
} from './lines';

/* A 3.2 t lever hoist (come-along) on 10 mm grade 80 chain. The lever drives the load sheave through a reduction gear,
   so each full stroke takes in the same short length of chain whatever the load; what the load changes is how hard the
   operator has to pull: HAND N at the rated load, in proportion below it. Past about 1.4 × that a person can't move the
   lever (the hoist's overload limiter slips at a similar margin), so a stuck load stops the operator long before it
   breaks the 126 kN chain. A load brake holds whatever the last stroke won. Free-chain (neutral) runs the chain through
   by hand at walking pace, but only with no load on it. */
export const HOIST = {
  wll: 31.4e3,
  /** hand force on the lever at the rated load, N (Kito LB 3.2 t: 363 N) */
  hand: 363,
  /** chain taken in per lever stroke, m: 20 mm per full turn of the lever (Yale 3 t) over ~0.46 m of a 415 mm lever's
   *  1.47 m of hand travel a turn */
  travel: 0.006,
  /** strokes per second an operator keeps up, light and at the rated load (judgement) */
  rateLight: 1.3, rateRated: 0.7,
  /** the most a person puts on the lever, share of HAND */
  maxHand: 1.4,
  /** pawl clicks per stroke (teeth on the ratchet wheel passed) */
  clicks: 5,
  /** the operator stands at the hoist, hand on the lever (horizontal distance, m) */
  reach: 1.3,
  rigReach: 6,
  maxLen: 12,
  freeSpeed: 0.8,
};

type Mode = 'up' | 'down' | 'free';
const MODES: Mode[] = ['up', 'down', 'free'];
let mode: Mode = 'up';
let load: { anchor: Anchor; at: Vec3 } | null = null;
interface Rig { line: Line; body: THREE.Group; lever: THREE.Object3D; wheel: THREE.Object3D; phase: number; strokes: number; stall: boolean; clickAt: number }
let h: Rig | null = null;
let scene: THREE.Scene;
let working = false;
let t = 0;

export function initHoist(s: THREE.Scene): void { scene = s; }
export const hoistRigged = (): boolean => !!h;
export const hoistPhase = (): number => (h ? h.phase : 0);

let hoistRed: THREE.MeshStandardMaterial | null = null;
/* The hoist as it looks: a flat red housing with the big round gear cover on one side and the load-brake cover on the
   other, the flat stamped lever over the ratchet with its rubber grip, the top hook with its safety latch, and the load
   chain down to the bottom hook. */
function makeBody(): { body: THREE.Group; lever: THREE.Object3D; wheel: THREE.Object3D } {
  const body = new THREE.Group();
  const red = hoistRed ??= new THREE.MeshStandardMaterial({ color: 0xb3261a, roughness: 0.45, metalness: 0.3 }), iron = getProjectileMaterial('iron');
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.8 });
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.2, 0.15), red);
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 24).rotateZ(Math.PI / 2), red);
  cover.position.x = -0.05;
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 20).rotateZ(Math.PI / 2), red);
  brake.position.x = 0.05;
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 20).rotateZ(Math.PI / 2), iron));
  for (let i = 0; i < 12; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.009), iron);
    const a = (i / 12) * Math.PI * 2;
    tooth.position.set(0, Math.cos(a) * 0.053, Math.sin(a) * 0.053);
    tooth.rotation.x = a;
    wheel.add(tooth);
  }
  wheel.position.set(0.075, 0, 0);
  const lever = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.415, 0.035), red);
  bar.position.y = 0.2;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.045), black);
  grip.position.y = 0.36;
  lever.add(bar, grip);
  lever.position.set(0.09, 0, 0);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.011, 6, 14, Math.PI * 1.45), iron);
  hook.position.y = 0.15;
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.045, 0.012), iron);
  latch.position.set(0, 0.16, 0.03);
  latch.rotation.x = 0.5;
  const bottom = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 14, Math.PI * 1.45), iron);
  bottom.position.y = -0.2;
  bottom.rotation.z = Math.PI;
  body.add(housing, cover, brake, wheel, lever, hook, latch, bottom);
  body.traverse(o => { o.castShadow = true; });
  scene.add(body);
  return { body, lever, wheel };
}

function aimEnd(eye: Vec3, fwd: Vec3): { anchor: Anchor; at: Vec3 } | string {
  const R = HOIST.rigReach;
  const hit = raycast(eye, [fwd[0] * R, fwd[1] * R, fwd[2] * R], NO_HIT);
  if (!hit) return `Lever hoist — hook onto a member, a vehicle or the ground within ${R} m`;
  const at = hit.point as Vec3;
  const piece = pieceOf(hit.entity);
  if (piece) return { anchor: anchorOn(vehicleOf(piece)?.chassis ?? piece, at), at: [...at] };
  return { anchor: anchorOn(null, [at[0], at[1] + 0.12, at[2]]), at: [at[0], at[1] + 0.12, at[2]] };
}

/** LMB press: hook the load chain, then hang the hoist on its anchor. */
export function hoistRig(eye: Vec3, fwd: Vec3): string | null {
  if (h) return null;
  const e = aimEnd(eye, fwd);
  if (typeof e === 'string') return e;
  if (!load) {
    if (!e.anchor.piece) return 'Hook the load chain onto what is to be pulled, then hang the hoist on its anchor';
    load = e;
    audio.chargeStick(e.at);
    toolHooks.notify('Load hook on — now LMB where the hoist hangs (a post, a vehicle, the ground) · RMB lets go');
    return null;
  }
  const len = vec3.distance(load.at, e.at);
  if (e.anchor.piece && e.anchor.piece === load.anchor.piece) return 'Hoist and load on the same member';
  if (len > HOIST.maxLen) return `${Math.round(len)} m apart — the hoist has ${HOIST.maxLen} m of chain`;
  if (len < 0.5) return 'Too close to work the lever';
  const stake = !e.anchor.piece ? makeStake(e.anchor.local) : null;
  if (stake) faceStake(stake, load.at);
  const line = makeLine('chain10', 'hoist', e.anchor, load.anchor, len + 0.05, {
    stake,
    onGone: () => { if (h && h.line === line) drop(); },
  });
  const m = makeBody();
  h = { line, ...m, phase: 0, strokes: 0, stall: false, clickAt: -9 };
  load = null;
  audio.chargeStick(e.at);
  hitmarker(0.4);
  toolHooks.notify(`3.2 t lever hoist hung, ${len.toFixed(1)} m of chain to the load — walk up to it and hold LMB to work the lever`);
  return null;
}

function drop(): void {
  if (!h) return;
  scene.remove(h.body);
  h.body.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  h = null;
  working = false;
}

export function hoistWheel(dir: number): string {
  mode = MODES[(MODES.indexOf(mode) + (dir > 0 ? 1 : MODES.length - 1)) % MODES.length];
  audio.ui('click');
  return mode === 'up' ? 'Selector: PULL — each stroke takes in chain' : mode === 'down' ? 'Selector: LOWER — each stroke pays out chain under load' : 'Selector: FREE CHAIN — haul the slack through by hand (no load only)';
}

/** RMB: let go of a loose load hook, else take the hoist down (only with the load off it). */
export function hoistSecondary(): boolean {
  if (load) { load = null; audio.ui('click'); return true; }
  if (!h) return false;
  const T = h.line.tension;
  if (T > 1500) { audio.ui('deny'); toolHooks.notify(`${(T / 1000).toFixed(1)} kN on the chain — LOWER it off first (or cut the chain, and stand clear)`); return true; }
  releaseLine(h.line, 'off');
  drop();
  audio.ui('click');
  return true;
}

const _hp: Vec3 = [0, 0, 0];
/** where the operator works the lever: the hoist hangs at the anchor end */
function hoistAt(out: Vec3): Vec3 { return anchorWorld(out, h!.line.a); }
const atHoist = (): boolean => !!player.e && !!h && Math.hypot(player.e.curPos[0] - hoistAt(_hp)[0], player.e.curPos[2] - _hp[2]) < HOIST.reach && Math.abs(player.e.curPos[1] + 1 - _hp[1]) < 1.6;

/** Per step, before the solver. `held`: LMB is down with the hoist in hand. */
export function hoistPreStep(held: boolean, dt: number): void {
  t += dt;
  if (!h) { working = false; return; }
  const L = h.line;
  working = held && atHoist();
  if (!working) { h.stall = false; return; }
  const T = L.tension;
  if (mode === 'free') {
    if (T > 300) { h.stall = true; return; }
    h.stall = false;
    const cur = currentLength(L);
    const next = Math.max(0.3, Math.min(L.rest, cur + 0.05) - HOIST.freeSpeed * dt);
    if (next < L.rest - 1e-3) setRest(L, next);
    h.phase = (h.phase + dt * 3) % 1;
    return;
  }
  // how hard the lever pulls at this load, against how hard a person can pull
  const hand = HOIST.hand * (T / HOIST.wll);
  h.stall = mode === 'up' && hand > HOIST.hand * HOIST.maxHand;
  if (h.stall) return;
  const k = clamp(T / HOIST.wll, 0, 1);
  const rate = HOIST.rateLight + (HOIST.rateRated - HOIST.rateLight) * k;
  const before = h.phase;
  h.phase += dt * rate;
  // the chain comes in through the stroke (the load rises with it and the lever stops dead where the arm can't
  // pull any more), and the pawl drops into a tooth a few times a stroke
  const d = HOIST.travel * rate * dt;
  setRest(L, clamp(mode === 'up' ? L.rest - d : L.rest + d, 0.3, HOIST.maxLen));
  if (Math.floor(before * HOIST.clicks) !== Math.floor(h.phase * HOIST.clicks) && t - h.clickAt > 0.05) {
    h.clickAt = t;
    audio.ratchet(hoistAt(_hp), k);
  }
  if (h.phase >= 1) { h.phase -= 1; h.strokes++; }
}

const _q = new THREE.Quaternion();
/** Once a frame: the hoist hangs at its anchor, the lever where the stroke has it, the ratchet wheel turned. */
export function syncHoist(alpha: number): void {
  viewmodel.rig({ lever: h && working ? h.phase : 0, strokes: h ? h.strokes : 0 });
  if (!h) return;
  const a = h.line.a;
  if (a.piece) interpPoint(_hp, a.piece, a.local, alpha); else vec3.copy(_hp, a.local);
  const dx = h.line.pb[0] - _hp[0], dz = h.line.pb[2] - _hp[2];
  if (a.piece) {
    // hung from its anchor, in line with the chain
    h.body.position.set(_hp[0], _hp[1] - 0.17, _hp[2]);
    h.body.rotation.set(0, Math.atan2(dx, dz), 0);
  } else {
    // hooked to the picket's eye it lies on the ground on its side, the chain leading off toward the load
    h.body.position.set(_hp[0] + (dx / Math.hypot(dx, dz)) * 0.2, _hp[1] - 0.02, _hp[2] + (dz / Math.hypot(dx, dz)) * 0.2);
    h.body.rotation.set(Math.PI / 2, Math.atan2(dx, dz), 0, 'YXZ');
  }
  h.lever.rotation.x = -0.4 + 0.9 * Math.sin(Math.PI * h.phase);
  h.wheel.rotation.z = -((h.strokes + h.phase) * Math.PI * 2) / 12 * HOIST.clicks / 5;
  void _q;
}

export function hoistStatus(): ToolReadout {
  const m = mode === 'up' ? 'PULL' : mode === 'down' ? 'LOWER' : 'FREE';
  if (load) return { title: '3.2 t lever hoist', progress: null, detail: 'load hook on — LMB where the hoist hangs · RMB lets go', warn: false };
  if (!h) return { title: `3.2 t lever hoist · ${m}`, progress: null, detail: `LMB the load, then the anchor (${HOIST.maxLen} m of 10 mm G80 chain) · wheel: pull / lower / free chain`, warn: false };
  const L = h.line;
  const T = L.tension;
  const hand = Math.round(HOIST.hand * (T / HOIST.wll));
  const zone = inSnapZone();
  const near = atHoist();
  const lines = [lineBar(L, 'chain')];
  const detail = !near ? `stand at the hoist, hand on the lever, to work it · ${(T / 1000).toFixed(1)} kN on the chain`
    : h.stall ? (mode === 'free' ? 'free chain only runs with no load on it — select PULL or LOWER' : `the lever won't move: ${hand} N on the handle, ${(T / 1000).toFixed(1)} kN on the chain — over what you can pull`)
    : `${m} · ${(T / 1000).toFixed(1)} kN (${Math.round((T / HOIST.wll) * 100)} % of rated${T > HOIST.wll ? ' — OVERLOAD' : ''}) · ${hand} N on the lever · ${h.strokes} strokes, ${(h.strokes * HOIST.travel * 100).toFixed(1)} cm${zone ? ' · in the chain\'s line: step aside' : ''}`;
  return { title: `3.2 t lever hoist · ${m}`, progress: clamp(T / HOIST.wll, 0, 1.5) / 1.5, detail, warn: h.stall || T > HOIST.wll || !!zone, lines };
}

export function hoistWorking(): boolean { return working; }

export function clearHoist(): void {
  load = null;
  if (h) drop();
}
