import * as THREE from 'three';
import { vec3, quat, clamp } from 'math';
import type { b3ShapeId, b3JointId } from 'box3d.js';
import type { WeaponId, WeaponView, Vec3, Quat, MaterialId, ToolReadout, TimelineView } from '../types';
import {
  b3, world, ground, CAT, ALL, filter, register, unregister, raycast, stepCount, copy3, FIXED_DT,
  type PhysEntity,
} from '../physics/physics';
import {
  explode, damagePiece, applyImpulseAt, pieceOf, heat, ignite, sever, cutRebarNear, type Piece,
} from '../destruction/structure';
import { flammable } from '../destruction/materials';
import { softHeat } from '../sim/soft';
import { addHeat, addSmoke } from '../sim/fields/index';
import { heatCap, surfaceArea } from '../sim/fields/thermal';
import { groundAt } from '../terrain/terrain';
import { vehicleOf } from '../vehicles/vehicle';
import { getProjectileMaterial } from '../render/materials';
import { fx } from '../render/fx';
import { cables } from '../render/cables';
import { aim as marks, obb, type AimState } from '../render/aim';
import { viewmodel } from '../render/viewmodel';
import { audio } from '../audio/audio';
import { hitmarker } from '../ui/ui';
import { input } from '../core/input';
import { player, forward, eyePosition, kickRecoil, addTrauma, kickFov, knockback } from './player';
import {
  NO_HIT, GROUND_Y, piecesNear, nearestPiece, memberAxis, basisQuat, toolHooks, chord, fillOf, localBounds,
} from './tools/common';
import {
  initWrecker, fireWrecker, dropBall, luffBoom, wreckerPreStep, wreckerAfterStep, wreckerHit, wreckerBusy, syncWrecker,
  clearWrecker, wreckerStatus,
} from './tools/wrecker';
import {
  initWinch, WINCH_RANGE, rigWinch, hitchWinch, winchTargets, winchActive, winchPreStep, winchAfterStep, syncWinch,
  clearWinch, castOff, setWinchParts, winchParts, winchStatus,
} from './tools/winch';
import { gravFire, gravPreStep, heldEntity, clearGrav, gravFlyby, gravDistance, gravRelease, gravStatus } from './tools/gravgun';
import {
  isMachineTool, machineHooks, machiningHold, machiningStep, syncMachining, releaseMachining, clearMachining, machiningStatus,
  type MachineTool,
} from './tools/machining';
import {
  SLEDGE, sledgeBlow, sledgeEnergy, percHooks, breakerHold, breakerStep, breakerStatus, clearPercussive, BREAKER,
} from './tools/percussive';
import { hoseHold, hoseStep, hoseStatus, hoseHooks, toggleFog, hoseFog, traceJet, clearHose, hoseOn, hosePath, type JetPath } from './tools/hose';
import { splitterFire, splitterStep, splitterStatus, splitHooks, clearSplitter, SPLITTER } from './tools/splitter';
import { wireFire, wireStep, syncWire, wireStatus, wireHooks, removeRig, clearWire, WIRE } from './tools/wiresaw';
import {
  excavatorHold, excavatorStep, excavatorStatus, excavatorCurl, excavatorDump, excavatorAim, excavatorLinked, excHooks,
  clearExcavator,
} from './tools/excavator';
import { holeNear } from './tools/machining';

/* Ordered tool list; `bank` is the six-slot page the number keys address (Q cycles). */
export const BANK_COUNT = 4;
export const WEAPONS: { id: WeaponId; name: string; key: string; bank: 0 | 1 | 2 | 3; cooldown: number }[] = [
  { id: 'hammer', name: 'Sledgehammer', key: '1', bank: 0, cooldown: 0.62 },
  { id: 'cannon', name: 'Hand Cannon', key: '2', bank: 0, cooldown: 0.95 },
  { id: 'rocket', name: 'Rocket Launcher', key: '3', bank: 0, cooldown: 1.25 },
  { id: 'charge', name: 'Remote Charges', key: '4', bank: 0, cooldown: 0.4 },
  { id: 'airstrike', name: 'Airstrike Marker', key: '5', bank: 0, cooldown: 2.5 },
  { id: 'thermite', name: 'Thermite', key: '6', bank: 0, cooldown: 0.5 },
  { id: 'cutter', name: 'Cutting Charge', key: '1', bank: 1, cooldown: 0.4 },
  { id: 'wrecker', name: 'Wrecking Ball', key: '2', bank: 1, cooldown: 1.2 },
  { id: 'winch', name: 'Tow Winch', key: '3', bank: 1, cooldown: 0.6 },
  { id: 'gravgun', name: 'Gravity Gun', key: '4', bank: 1, cooldown: 0.25 },
  { id: 'incendiary', name: 'Firebomb', key: '5', bank: 1, cooldown: 1.1 },
  { id: 'megabomb', name: 'Megabomb', key: '6', bank: 1, cooldown: 2 },
  { id: 'grinder', name: 'Disc Cutter', key: '1', bank: 2, cooldown: 0.2 },
  { id: 'saw', name: 'Chainsaw', key: '2', bank: 2, cooldown: 0.2 },
  { id: 'drill', name: 'Drill Rig', key: '3', bank: 2, cooldown: 0.2 },
  { id: 'shears', name: 'Hydraulic Shears', key: '4', bank: 2, cooldown: 0.2 },
  { id: 'plasma', name: 'Plasma Cutter', key: '5', bank: 2, cooldown: 0.2 },
  { id: 'torch', name: 'Oxy-Fuel Torch', key: '6', bank: 2, cooldown: 0.2 },
  { id: 'planner', name: 'Detonator Panel', key: '1', bank: 3, cooldown: 0.15 },
  { id: 'excavator', name: 'Excavator Remote', key: '2', bank: 3, cooldown: 0.2 },
  { id: 'breaker', name: 'Hydraulic Breaker', key: '3', bank: 3, cooldown: 0.2 },
  { id: 'hose', name: 'Water Cannon', key: '4', bank: 3, cooldown: 0.2 },
  { id: 'splitter', name: 'Rock Splitter', key: '5', bank: 3, cooldown: 0.6 },
  { id: 'wiresaw', name: 'Diamond Wire Saw', key: '6', bank: 3, cooldown: 0.5 },
];
const DEF = Object.fromEntries(WEAPONS.map(w => [w.id, w])) as Record<WeaponId, (typeof WEAPONS)[number]>;

export const MAX_CHARGES = 8;
export const MAX_CUTTERS = 8;
export const MAX_THERMITE = 6;
/* Hopkinson-Cranz scaling on the game's calibrated 2.5 kg charge: the same effect at the same R/W^⅓; power is the
   game's 60 kJ per kg of TNT (what the terrain craters by) and the push on loose bodies goes with √W. */
export const blastOf = (kg: number) => ({ radius: 3.1 * Math.cbrt(kg), power: 60e3 * kg, impulse: 2150 * Math.sqrt(kg) });
export const CHARGE_KG = [0.5, 1, 2.5, 5] as const;
const ROCKET = { radius: 5, power: 75e3, impulse: 3200 };
/* Tandem HEAT-FT: a copper jet whose penetration goes as L·√(ρjet/ρtarget) (hydrodynamic limit), ~0.48 m of steel,
   ~0.87 m of concrete; what it perforates lets the 1 kg follow-through charge detonate inside, where the room's
   walls reflect and confine it. Defeated, the whole warhead goes off at the face. */
const TANDEM = { jet: 0.45, rhoJet: 8960, follow: 1, air: 1.5 };
/* rocket motor: a gas-generator kick out of the tube, then the sustainer after a few metres */
const MOTOR = { launch: 32, ignite: 0.08, burn: 0.6, accel: 170, max: 125 };
const BACKBLAST = { cone: 0.6, reach: 8, wall: 2.2 };
const BOMB = blastOf(4);
const PLANE = { v: 105, h: 70, bombs: 4, spacing: 0.06, approach: 5, radio: 2.5 };
const CHARGE = { weldReach: 1.45 };
const THERMITE = { delay: 0.6, burn: 7, core: 2500, rate: 0.03, reach: 0.8 };
/* Host temperature at which a pot has burned through the member (≈ melting point). */
const MELT: Partial<Record<MaterialId, number>> = { steel: 1400, castiron: 1150, aluminum: 700 };
const CUTTER = { kick: 0.5, radius: 1.5, power: 9e3, impulse: 500 };
/* 0.75 L of petrol in a bottle: a ~3 m splash that flashes at ~60 kW/m² for a couple of seconds, then a ~1 m² pool
   burning ~9 s at ~2.4 MW (0.055 kg/m²·s × 44 MJ/kg). */
const FIRE = { radius: 3, flux: 60e3, flash: 2, pool: 1.6, poolTime: 9, hrr: 2.4e6 };
const MEGA = { kg: 100, weldReach: 1.3, fractures: 120, fuse: 5, fireball: 10 };
const PLANT_REACH = 4;
const PLAN = { reach: 60, autoMsPerM: 150, step: 50, big: 250, max: 5000 };
/* Tools that act once per click rather than auto-repeating while fire is held. */
const PRESS_ONLY = new Set<WeaponId>(['wrecker', 'winch', 'gravgun', 'planner', 'splitter', 'wiresaw']);

type ProjType = 'ball' | 'rocket' | 'charge' | 'beacon' | 'bomb' | 'thermite' | 'cutter' | 'bottle' | 'megabomb';
type Warhead = 'tandem' | 'he';
const STICKY = new Set<ProjType>(['charge', 'thermite', 'megabomb']);
const LOOKAHEAD = new Set<ProjType>(['rocket', 'bomb', 'charge', 'thermite', 'megabomb', 'bottle']);
const STICK_OFFSET: Partial<Record<ProjType, number>> = { charge: 0.05, thermite: 0.08, cutter: 0.022, megabomb: 0.2 };
/* drag: radius (m), drag coefficient */
const AERO: Partial<Record<ProjType, [number, number]>> = {
  ball: [0.15, 0.47], rocket: [0.075, 0.3], bomb: [0.14, 0.25], bottle: [0.07, 0.8], beacon: [0.06, 0.8],
  charge: [0.1, 1], thermite: [0.085, 0.9], megabomb: [0.25, 1],
};

interface Projectile extends PhysEntity {
  kind: 'projectile';
  type: ProjType;
  shape: b3ShapeId;
  mesh: THREE.Object3D;
  born: number;
  dead: boolean;
  stuck: boolean;
  joint: b3JointId | null;
  trail: number;
  landedAt: number;
  target?: Vec3;
  host: Piece | null;
  /** thermite: ignition time; megabomb: detonation time */
  armAt: number;
  lit: boolean;
  tick: number;
  beat: number;
  chew: number;
  width: number;
  /** charge size, kg TNT equivalent */
  kg: number;
  /** firing delay in the demolition sequence, ms */
  delay: number;
  /** quadratic drag per unit mass, 1/m */
  drag: number;
  warhead: Warhead;
}

export const loadout = {
  current: 'hammer' as WeaponId,
  ammo: {} as Partial<Record<WeaponId, number>>,
};
const lastFire = Object.fromEntries(WEAPONS.map(w => [w.id, -99])) as Record<WeaponId, number>;
let now = 0;
let scene: THREE.Scene;
const projectiles: Projectile[] = [];
const swings: { t: number; k: number }[] = [];
const detonations: { t: number; p: Projectile }[] = [];
const patches: { pos: Vec3; until: number; tick: number }[] = [];
interface Sortie { target: Vec3; heading: Vec3; start: Vec3; t0: number; release: number; dropped: number; mesh: THREE.Object3D | null; done: number }
const sorties: Sortie[] = [];
const views: WeaponView[] = WEAPONS.map(w => ({ id: w.id, name: w.name, key: w.key, ammo: 0, available: false, ready: 1 }));
/* Frame bookkeeping: tryFire runs every frame fire is held, so a call with no call in the previous
   frame is a fresh press; the winch reels only on frames where fire is held. */
let frame = 0;
let lastTry = -9;
let reelFrame = -9;
let workFrame = -9;
let chargeKg = 2.5;
let warhead: Warhead = 'tandem';
let windAt = -1;
let lastBlow: { mat: MaterialId | null; energy: number; progress: number; chipped: boolean } | null = null;
let selected: Projectile | null = null;
let firing: { t0: number; span: number } | null = null;
const cord: number[] = [];
/** order the last sequence fired in, and when (tests, HUD) */
export const fired: { type: 'charge' | 'cutter'; delay: number; at: number; pos: Vec3 }[] = [];

export let onDeny: (msg: string) => void = () => {};
export function setWeaponHooks(deny: typeof onDeny): void {
  onDeny = deny;
  toolHooks.notify = deny;
  machineHooks.notify = deny;
  percHooks.notify = deny;
  splitHooks.notify = deny;
  wireHooks.notify = deny;
  excHooks.notify = deny;
}

export function initWeapons(s: THREE.Scene): void {
  scene = s;
  initWrecker(s);
  initWinch(s);
  machineHooks.consume = id => {
    const a = loadout.ammo[id];
    if (a === undefined || a === 0) return false;
    if (a > 0) loadout.ammo[id] = a - 1;
    lastFire[id] = now;
    return true;
  };
  machineHooks.kick = k => { kickRecoil(1.4 * k); addTrauma(0.2 * k); };
  machineHooks.hit = k => hitmarker(k);
  percHooks.kick = k => addTrauma(k);
  percHooks.hit = k => hitmarker(k);
  splitHooks.hit = k => hitmarker(k);
  wireHooks.hit = k => hitmarker(k);
  hoseHooks.kick = k => addTrauma(k);
  hoseHooks.douseAt = (p, r) => {
    for (let i = patches.length - 1; i >= 0; i--) if (vec3.distance(patches[i].pos, p) < r + FIRE.pool) { patches.splice(i, 1); fx.dust(p, 1.2, 0xe8eef2); }
  };
}

export function setLoadout(ammo: Partial<Record<WeaponId, number>>): void {
  loadout.ammo = { ...ammo };
  for (const w of WEAPONS) lastFire[w.id] = -99;
  now = 0;
  const first = WEAPONS.find(w => ammo[w.id] !== undefined && ammo[w.id] !== 0) ?? WEAPONS.find(w => ammo[w.id] !== undefined);
  loadout.current = first ? first.id : 'hammer';
  viewmodel.setWeapon(loadout.current);
}

export function select(id: WeaponId): void {
  if (loadout.ammo[id] === undefined) { audio.ui('deny'); onDeny(`${DEF[id].name} not issued on this contract`); return; }
  if (id === loadout.current) return;
  windAt = -1;
  loadout.current = id;
  viewmodel.setWeapon(id);
}

export function cycle(dir: number): void {
  const i = WEAPONS.findIndex(w => w.id === loadout.current);
  for (let k = 1; k <= WEAPONS.length; k++) {
    const w = WEAPONS[(i + dir * k + WEAPONS.length * 2) % WEAPONS.length];
    if (loadout.ammo[w.id] !== undefined) { select(w.id); return; }
  }
}

function count(type: ProjType): number {
  let n = 0;
  for (const p of projectiles) if (p.type === type && !p.dead) n++;
  return n;
}

function armed(): Projectile[] {
  return projectiles.filter(p => (p.type === 'charge' || p.type === 'cutter') && !p.dead && !detonations.some(d => d.p === p));
}

/* Everything the detonate key will set off (charges and cutting charges). */
export function chargesPlaced(): number {
  return armed().length;
}

export function liveOrdnance(): number {
  let n = sorties.length + detonations.length + patches.length;
  for (const p of projectiles) if (!p.dead && p.type !== 'ball') n++;
  if (wreckerBusy()) n++;
  return n;
}

/* Ammo left that can still move the needle (hand tools never run out, so they don't count). */
export function rangedAmmoLeft(): number {
  let n = 0;
  for (const w of WEAPONS) {
    if (w.id === 'hammer' || w.id === 'gravgun') continue;
    const a = loadout.ammo[w.id];
    if (a === undefined) continue;
    n += a < 0 ? 999 : a;
  }
  return n;
}

export function weaponViews(): WeaponView[] {
  for (const v of views) {
    const a = loadout.ammo[v.id];
    v.available = a !== undefined;
    v.ammo = a ?? 0;
    v.ready = clamp((now - lastFire[v.id]) / DEF[v.id].cooldown, 0, 1);
  }
  return views;
}

/* ---------------- firing ---------------- */

const _eye: Vec3 = [0, 0, 0], _fwd: Vec3 = [0, 0, 0], _right: Vec3 = [0, 0, 0], _muzzle: Vec3 = [0, 0, 0];

function aim(): void {
  eyePosition(_eye, 1);
  forward(_fwd);
  vec3.set(_right, Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  vec3.scaleAndAdd(_muzzle, _eye, _fwd, 0.85);
  vec3.scaleAndAdd(_muzzle, _muzzle, _right, 0.16);
  _muzzle[1] -= 0.12;
}

function deny(id: WeaponId, msg: string, fresh: boolean): false {
  if (fresh) { audio.ui('deny'); onDeny(msg); }
  lastFire[id] = Math.max(lastFire[id], now - DEF[id].cooldown * 0.6);
  return false;
}

function spend(id: WeaponId, a: number): void {
  lastFire[id] = now;
  if (a > 0) loadout.ammo[id] = a - 1;
  viewmodel.fire(id);
  audio.fire(id);
}

/* Called every frame while fire is held (main respects nothing else); tools decide for themselves
   whether a held button repeats (cooldown-gated) or acts once per press. */
export function tryFire(): boolean {
  const id = loadout.current;
  const a = loadout.ammo[id];
  const fresh = (input.clicked & 1) !== 0 || lastTry < frame - 1;
  lastTry = frame;
  if (a === undefined || !player.e) return false;
  aim();
  if (id === 'winch' && winchActive()) reelFrame = frame;
  if (isMachineTool(id)) {
    if (a === 0) return deny(id, `${DEF[id].name}: no consumables left`, fresh);
    workFrame = frame;
    const err = machiningHold(id, _eye, _fwd, fresh);
    return err ? deny(id, err, fresh) : true;
  }
  switch (id) {
    case 'hammer': return windHammer();
    case 'breaker': {
      workFrame = frame;
      const err = breakerHold(_eye, _fwd);
      if (!err && fresh) viewmodel.fire(id);
      return err ? deny(id, err, fresh) : true;
    }
    case 'hose':
      workFrame = frame;
      hoseHold(_eye, _fwd);
      return true;
    case 'excavator': {
      workFrame = frame;
      const err = excavatorHold(_eye, _fwd, fresh);
      if (!err && fresh) viewmodel.fire(id);
      return err ? deny(id, err, fresh) : true;
    }
  }
  if (PRESS_ONLY.has(id) && !fresh) return false;
  if (now - lastFire[id] < DEF[id].cooldown) return false;

  if (id === 'gravgun') {
    lastFire[id] = now;
    const err = gravFire(_eye, _fwd, canGrab);
    if (err) return deny(id, err, true);
    viewmodel.fire(id);
    return true;
  }
  if (id === 'winch') {
    const hit = raycast(_eye, [_fwd[0] * WINCH_RANGE, _fwd[1] * WINCH_RANGE, _fwd[2] * WINCH_RANGE], NO_HIT);
    const piece = hit ? pieceOf(hit.entity) : null;
    if (hit && piece && vehicleOf(piece)) {
      const err = hitchWinch(piece, hit.point as Vec3);
      if (err) return deny(id, err, true);
      onDeny('Tow line made fast to the vehicle — E to drive it and pull');
      spend(id, 0);
      return true;
    }
    if (!hit || !piece || winchTargets().includes(piece)) {
      return winchActive() ? false : deny(id, `Tow winch — hook a structure within ${WINCH_RANGE} m`, true);
    }
    if (a === 0) return deny(id, `Out of ${DEF[id].name.toLowerCase()} cable`, true);
    const err = rigWinch(piece, hit.point as Vec3, _fwd);
    if (err) return deny(id, err, true);
    spend(id, a);
    reelFrame = frame;
    return true;
  }
  if (id === 'planner') {
    lastFire[id] = now;
    plannerClick();
    viewmodel.fire(id);
    return true;
  }
  if (id === 'splitter' || id === 'wiresaw') {
    const err = id === 'splitter' ? splitterFire(_eye, _fwd) : wireFire(_eye, _fwd);
    if (err) return deny(id, err, true);
    spend(id, 0);
    return true;
  }

  if (a === 0) return deny(id, `Out of ${DEF[id].name.toLowerCase()} ammo`, true);
  const pv: Vec3 = [0, 0, 0];
  b3.b3Body_GetLinearVelocity(pv, player.e.body);
  const err = fire(id, pv);
  if (err) return deny(id, err, fresh);
  spend(id, a);
  return true;
}

/* Performs the shot, or returns why it can't happen (nothing spent in that case). */
function fire(id: WeaponId, pv: Vec3): string | null {
  switch (id) {
    case 'cannon': {
      spawn('ball', _muzzle, [_fwd[0] * 62 + pv[0] * 0.3, _fwd[1] * 62 + pv[1] * 0.3, _fwd[2] * 62 + pv[2] * 0.3]);
      fx.muzzle(_muzzle, _fwd, id);
      kickRecoil(1.4); addTrauma(0.18); kickFov(6);
      return null;
    }
    case 'rocket': {
      const p = spawn('rocket', _muzzle, [_fwd[0] * MOTOR.launch + pv[0], _fwd[1] * MOTOR.launch + pv[1], _fwd[2] * MOTOR.launch + pv[2]]);
      p.warhead = warhead;
      fx.muzzle(_muzzle, _fwd, id);
      backblast();
      kickRecoil(0.8); addTrauma(0.12);
      return null;
    }
    case 'charge': {
      if (count('charge') >= MAX_CHARGES) return `${MAX_CHARGES} charges placed — detonate first`;
      const p = plantOrThrow('charge', pv, 11, 1.5);
      p.kg = chargeKg;
      p.mesh.scale.setScalar(Math.cbrt(chargeKg / 2.5));
      p.delay = nextDelay(p);
      return null;
    }
    case 'airstrike':
      if (sorties.length >= 2) return 'Two sorties already inbound — wait for them to clear';
      spawn('beacon', _muzzle, [_fwd[0] * 17 + pv[0] * 0.5, _fwd[1] * 17 + 3.5, _fwd[2] * 17 + pv[2] * 0.5]);
      return null;
    case 'thermite':
      if (count('thermite') >= MAX_THERMITE) return `${MAX_THERMITE} thermite pots already burning`;
      plantOrThrow('thermite', pv, 12, 1.8);
      return null;
    case 'cutter':
      return plantCutter();
    case 'wrecker':
      return fireWrecker(_eye, _fwd);
    case 'incendiary':
      spawn('bottle', _muzzle, [_fwd[0] * 17 + pv[0] * 0.5, _fwd[1] * 17 + 3.5, _fwd[2] * 17 + pv[2] * 0.5]);
      kickRecoil(0.3);
      return null;
    case 'megabomb': {
      if (count('megabomb')) return 'Megabomb already armed — clear the blast zone';
      const p = plantOrThrow('megabomb', pv, 8, 1.5);
      p.kg = MEGA.kg;
      p.armAt = now + MEGA.fuse;
      p.beat = Math.ceil(MEGA.fuse) + 1;
      addTrauma(0.05);
      return null;
    }
    default:
      return null;
  }
}

/* Rocket backblast: the propellant gas and the counter-mass go out of the tube's back in a ~70° cone. Near a wall
   it comes straight back at the firer; in the open it throws what is loose and scorches what burns. */
function backblast(): void {
  const back: Vec3 = [-_fwd[0], -_fwd[1], -_fwd[2]];
  const rear: Vec3 = [_eye[0] + back[0] * 0.5, _eye[1] - 0.1 + back[1] * 0.5, _eye[2] + back[2] * 0.5];
  fx.muzzle(rear, back, 'rocket');
  fx.dust([rear[0] + back[0] * 2, rear[1] - 0.8, rear[2] + back[2] * 2], 2.2, 0xb8b0a0);
  const wall = raycast(rear, [back[0] * BACKBLAST.wall, back[1] * BACKBLAST.wall, back[2] * BACKBLAST.wall], NO_HIT);
  if (wall && wall.entity?.kind !== 'ground') {
    const k = 1 - wall.fraction;
    addTrauma(0.3 + 0.4 * k);
    kickFov(8 + 10 * k);
    knockback(0.25 + 0.3 * k);
    onDeny('Backblast came straight back off the wall behind you');
  }
  const c: Vec3 = [rear[0] + back[0] * BACKBLAST.reach * 0.5, rear[1] + back[1] * BACKBLAST.reach * 0.5, rear[2] + back[2] * BACKBLAST.reach * 0.5];
  for (const { p: q, cp } of piecesNear(c, BACKBLAST.reach * 0.5)) {
    const v: Vec3 = [cp[0] - rear[0], cp[1] - rear[1], cp[2] - rear[2]];
    const d = vec3.length(v);
    if (d < 1e-3 || vec3.dot(v, back) / d < Math.cos(BACKBLAST.cone)) continue;
    const f = clamp(1 - d / BACKBLAST.reach, 0, 1);
    if (!q.welds.length && !q.hinged) {
      const J = Math.min(q.mass * 12, 900 * f * f);
      applyImpulseAt(q, [(v[0] / d) * J, (v[1] / d) * J + J * 0.2, (v[2] / d) * J], q.curPos);
    }
    if (d < 3) {
      heat(q, 90 * f);
      if (flammable(q.pm) && q.volume < 0.2 && Math.random() < 0.5 * f) ignite(q);
    }
  }
}

function plantOrThrow(type: ProjType, pv: Vec3, speed: number, lift: number): Projectile {
  const reach = raycast(_eye, [_fwd[0] * PLANT_REACH, _fwd[1] * PLANT_REACH, _fwd[2] * PLANT_REACH], NO_HIT);
  if (reach) {
    const p = spawn(type, reach.point as Vec3, [0, 0, 0]);
    stick(p, reach.point as Vec3, reach.normal as Vec3, reach.entity, plantRot(pieceOf(reach.entity), reach.normal as Vec3));
    return p;
  }
  return spawn(type, _muzzle, [_fwd[0] * speed + pv[0] * 0.5, _fwd[1] * speed + lift, _fwd[2] * speed + pv[2] * 0.5]);
}

/* A block charge lies with its long side along the member, the way it's taped on. */
function plantRot(host: Piece | null, n: Vec3): Quat | undefined {
  if (!host) return undefined;
  const axis: Vec3 = [0, 0, 0], across: Vec3 = [0, 0, 0];
  memberAxis(host, n, axis, across);
  vec3.scaleAndAdd(axis, axis, n, -vec3.dot(axis, n));
  if (vec3.length(axis) < 1e-3) return undefined;
  vec3.normalize(axis, axis);
  return basisQuat([0, 0, 0, 1], axis, n);
}

/* A cutting charge lies along the cut: across the member's long axis, on the face it was put on. */
function plantCutter(): string | null {
  const reach = raycast(_eye, [_fwd[0] * PLANT_REACH, _fwd[1] * PLANT_REACH, _fwd[2] * PLANT_REACH], NO_HIT);
  const host = reach ? pieceOf(reach.entity) : null;
  if (!reach || !host) return `Cutting charges go on a structural member within ${PLANT_REACH} m`;
  if (count('cutter') >= MAX_CUTTERS) return `${MAX_CUTTERS} cutting charges placed — detonate first`;
  const axis: Vec3 = [0, 0, 0], across: Vec3 = [0, 0, 0];
  const n = reach.normal as Vec3;
  const width = memberAxis(host, n, axis, across);
  vec3.scaleAndAdd(across, across, n, -vec3.dot(across, n));
  vec3.normalize(across, across);
  const p = spawn('cutter', reach.point as Vec3, [0, 0, 0]);
  p.width = width;
  p.delay = nextDelay(p);
  const strip = p.mesh.getObjectByName('strip');
  if (strip) strip.scale.x = clamp(width, 0.25, 1.4) / 0.6;
  stick(p, reach.point as Vec3, n, reach.entity, basisQuat([0, 0, 0, 1], across, n));
  return null;
}

/* A fresh device goes 70 ms after the last one in the plan, the old default stagger. */
function nextDelay(p: Projectile): number {
  let d = -70;
  for (const q of armed()) if (q !== p) d = Math.max(d, q.delay);
  return clamp(d + 70, 0, PLAN.max);
}

export function detonate(): boolean {
  const list = armed();
  if (!list.length) return false;
  audio.detonate();
  const t0 = now + 0.12;
  let span = 0;
  for (const p of list) {
    detonations.push({ t: t0 + p.delay / 1000, p });
    span = Math.max(span, p.delay);
  }
  firing = { t0, span };
  fired.length = 0;
  return true;
}

/* main may call this on LMB release; without it a release is inferred one frame late. */
export function releaseFire(): void {
  lastTry = -9;
  reelFrame = -9;
  workFrame = -9;
  releaseMachining();
  if (loadout.current === 'hammer') releaseHammer();
}

/* ---------------- sledgehammer ---------------- */

function windHammer(): boolean {
  if (windAt < 0) {
    if (now - lastFire.hammer < DEF.hammer.cooldown) return false;
    windAt = now;
  }
  viewmodel.charge(hammerWind());
  return true;
}

const hammerWind = (): number => (windAt < 0 ? 0 : clamp((now - windAt) / SLEDGE.wind, 0, 1));

function releaseHammer(): void {
  if (windAt < 0) return;
  const k = hammerWind();
  windAt = -1;
  lastFire.hammer = now;
  swings.push({ t: now + 0.14, k });
  viewmodel.charge(0);
  viewmodel.fire('hammer');
  audio.fire('hammer');
}

function swingHammer(k: number): void {
  aim();
  const b = sledgeBlow(_eye, _fwd, k);
  if (!b) { audio.hammer(null); return; }
  addTrauma(0.08 + 0.1 * k);
  kickRecoil(-0.3 - 0.4 * k);
  lastBlow = { mat: b.mat, energy: b.energy, progress: b.progress, chipped: b.chipped };
  const mat: MaterialId = b.mat ?? 'concrete';
  fx.impact(b.point, b.normal, mat, b.chipped ? 0.5 + 0.3 * k : 0.2 + 0.2 * k);
  if (b.piece && !Number.isFinite(b.piece.pm.toughness)) fx.sparks(b.point, b.normal, 6);
  audio.hammer(mat);
  if (b.piece) hitmarker(b.broke ? 1 : b.chipped ? 0.7 : 0.35);
}

/* ---------------- demolition planner ---------------- */

function pickDevice(): Projectile | null {
  let best: Projectile | null = null, bs = Infinity;
  for (const p of armed()) {
    const v: Vec3 = [p.curPos[0] - _eye[0], p.curPos[1] - _eye[1], p.curPos[2] - _eye[2]];
    const along = vec3.dot(v, _fwd);
    if (along < 0.3 || along > PLAN.reach) continue;
    const perp = Math.sqrt(Math.max(0, vec3.squaredLength(v) - along * along));
    if (perp > 0.25 + along * 0.025) continue;
    const s = perp / along;
    if (s < bs) { bs = s; best = p; }
  }
  return best;
}

/* LMB with the panel: pick the device under the crosshair, or sequence the lot toward the aim point — whatever
   is nearest it goes first and the rest follow at 150 ms per metre, so the structure folds that way (aim at the
   middle of a building and it implodes). */
function plannerClick(): void {
  const list = armed();
  if (!list.length) { audio.ui('deny'); onDeny('No charges placed — set charges or cutting charges first, then plan the sequence here'); return; }
  const p = pickDevice();
  if (p) {
    selected = p;
    audio.ui('click');
    onDeny(`${p.type === 'cutter' ? 'Cutting charge' : `${p.kg} kg charge`} · fires at ${p.delay} ms — wheel to change`);
    return;
  }
  const hit = raycast(_eye, [_fwd[0] * 150, _fwd[1] * 150, _fwd[2] * 150], NO_HIT);
  if (!hit) { audio.ui('deny'); onDeny('Aim at a device to select it, or at the spot the building should fall toward'); return; }
  autoSequence(hit.point as Vec3);
  audio.ui('click');
  onDeny(`Sequenced ${list.length} devices toward the aim point · span ${Math.max(...list.map(q => q.delay))} ms`);
}

export function autoSequence(fall: Vec3, msPerM = PLAN.autoMsPerM): void {
  const list = armed();
  const d = list.map(p => Math.hypot(p.curPos[0] - fall[0], p.curPos[2] - fall[2]));
  const d0 = Math.min(...d);
  list.forEach((p, i) => { p.delay = clamp(Math.round(((d[i] - d0) * msPerM) / 25) * 25, 0, PLAN.max); });
}

export function setDelay(p: Projectile, ms: number): void { p.delay = clamp(Math.round(ms), 0, PLAN.max); }
export function devices(): readonly Projectile[] { return armed(); }

export function timelineView(): TimelineView | null {
  const showing = loadout.current === 'planner' || loadout.current === 'charge' || loadout.current === 'cutter';
  const live = firing && (now - firing.t0) * 1000 < firing.span + 1200;
  const list = armed();
  if (!live && (!showing || !list.length)) return null;
  const items: TimelineView['items'] = list.map(p => ({ delay: p.delay, kind: p.type === 'cutter' ? 'cutter' : 'charge', sel: p === selected, fired: false }));
  if (live) for (const f of fired) items.push({ delay: f.delay, kind: f.type, sel: false, fired: true });
  for (const d of detonations) if (!d.p.dead && !list.includes(d.p)) items.push({ delay: d.p.delay, kind: d.p.type === 'cutter' ? 'cutter' : 'charge', sel: false, fired: false });
  items.sort((a, b) => a.delay - b.delay);
  return {
    t: live && firing ? Math.max(0, (now - firing.t0) * 1000) : null,
    span: Math.max(500, ...items.map(i => i.delay)),
    items,
  };
}

/* ---------------- secondary controls ---------------- */

/** Wheel, for tools that have a setting on it; false when the wheel should cycle tools as usual. */
export function toolWheel(dir: number): boolean {
  const big = input.down.has('ShiftLeft') || input.down.has('ShiftRight');
  switch (loadout.current) {
    case 'charge': {
      const i = clamp(CHARGE_KG.indexOf(chargeKg as (typeof CHARGE_KG)[number]) + dir, 0, CHARGE_KG.length - 1);
      chargeKg = CHARGE_KG[i];
      onDeny(`Charge size ${chargeKg} kg TNT-eq · lethal radius ${blastOf(chargeKg).radius.toFixed(1)} m`);
      return true;
    }
    case 'planner': {
      if (!selected || selected.dead || !armed().includes(selected)) selected = armed()[0] ?? null;
      if (!selected) return true;
      setDelay(selected, selected.delay + dir * (big ? PLAN.big : PLAN.step));
      audio.ui('click');
      return true;
    }
    case 'winch':
      onDeny(`${setWinchParts(winchParts() + dir)} part(s) of line through snatch blocks`);
      return true;
    case 'wrecker':
      onDeny(`Boom luffed: tip ${luffBoom(dir)} m over the target for the next rig`);
      return true;
    case 'excavator':
      if (!excavatorLinked()) return false;
      excavatorCurl(dir);
      return true;
    case 'gravgun':
      return gravDistance(dir);
    default:
      return false;
  }
}

/** Right button, for tools with a secondary action; false when it should detonate charges as usual. */
export function toolSecondary(): boolean {
  if (!player.e) return false;
  aim();
  switch (loadout.current) {
    case 'rocket':
      warhead = warhead === 'tandem' ? 'he' : 'tandem';
      audio.ui('click');
      onDeny(warhead === 'tandem' ? 'Warhead: tandem HEAT-FT — punches through, then detonates inside' : 'Warhead: HE-FRAG — blast at the surface');
      return true;
    case 'winch': return castOff();
    case 'wrecker': {
      const err = dropBall(_eye, _fwd);
      if (err) deny('wrecker', err, true);
      return true;
    }
    case 'excavator': return excavatorDump();
    case 'hose':
      audio.ui('click');
      onDeny(toggleFog() ? 'Fog pattern: wide, short, cools the gas' : 'Straight stream: reach and punch');
      return true;
    case 'gravgun': return gravRelease();
    case 'wiresaw': return removeRig();
    default: return false;
  }
}

/* ---------------- projectiles ---------------- */

let glowMat: THREE.MeshBasicMaterial | null = null;
let ledMat: THREE.MeshBasicMaterial | null = null;
let glassMat: THREE.MeshStandardMaterial | null = null;
const glow = (): THREE.Material => (glowMat ??= new THREE.MeshBasicMaterial({ color: 0xffd79a }));
const led = (): THREE.Material => (ledMat ??= new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
const glass = (): THREE.Material =>
  (glassMat ??= new THREE.MeshStandardMaterial({ color: 0x4d7a45, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.8 }));

function ledBox(size: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.6, size), led());
  m.position.set(x, y, z);
  m.name = 'led';
  return m;
}

function makeMesh(type: ProjType): THREE.Object3D {
  switch (type) {
    case 'ball': return new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), getProjectileMaterial('iron'));
    case 'bomb': {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.9, 4, 12), getProjectileMaterial('rocket'));
      body.rotation.x = Math.PI / 2;
      g.add(body);
      for (const r of [0, Math.PI / 2]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.25), getProjectileMaterial('iron'));
        fin.rotation.z = r;
        fin.position.z = 0.55;
        g.add(fin);
      }
      return g;
    }
    case 'rocket': {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.6, 12), getProjectileMaterial('rocket'));
      body.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.2, 12), getProjectileMaterial('iron'));
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = -0.4;
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), glow());
      flame.position.z = 0.33;
      flame.name = 'flame';
      g.add(body, tip, flame);
      return g;
    }
    case 'charge': {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.2), getProjectileMaterial('charge')));
      g.add(ledBox(0.05, 0.08, 0.06, 0.05));
      return g;
    }
    case 'beacon': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 10), getProjectileMaterial('beacon'));
      m.rotation.z = Math.PI / 2;
      const g = new THREE.Group();
      g.add(m);
      return g;
    }
    case 'thermite': {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.16, 14), getProjectileMaterial('iron')));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.088, 0.04, 14), getProjectileMaterial('rocket'));
      band.position.y = -0.02;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.02, 12), glow());
      cap.position.y = 0.085;
      cap.name = 'glow';
      cap.visible = false;
      g.add(band, cap);
      return g;
    }
    case 'cutter': {
      const g = new THREE.Group();
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.036, 0.06), getProjectileMaterial('charge'));
      strip.name = 'strip';
      const det = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.07), getProjectileMaterial('iron'));
      det.position.y = 0.035;
      g.add(strip, det, ledBox(0.03, 0.02, 0.065, 0.02));
      return g;
    }
    case 'bottle': {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.17, 10), glass()));
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.03, 0.08, 8), glass());
      neck.position.y = 0.12;
      const rag = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), glow());
      rag.position.y = 0.17;
      g.add(neck, rag);
      return g;
    }
    case 'megabomb': {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.28, 0.42), getProjectileMaterial('rocket'));
      box.position.y = -0.06;
      g.add(box);
      for (const z of [-0.1, 0.1]) {
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 14), getProjectileMaterial('charge'));
        drum.rotation.z = Math.PI / 2;
        drum.position.set(0, 0.1, z);
        g.add(drum);
      }
      g.add(ledBox(0.07, 0.2, 0.1, 0.2));
      return g;
    }
  }
}

function makePlane(): THREE.Object3D {
  const g = new THREE.Group();
  const grey = getProjectileMaterial('rocket'), dark = getProjectileMaterial('iron');
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 9, 4, 12), grey);
  body.rotation.x = Math.PI / 2;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.18, 2.4), grey);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.14, 1.3), grey);
  tail.position.z = 4.3;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2, 1.5), grey);
  fin.position.set(0, 1, 4.2);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), dark);
  canopy.scale.set(1, 0.7, 2);
  canopy.position.set(0, 0.6, -3);
  g.add(body, wing, tail, fin, canopy);
  for (const x of [-3, 3]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.4, 12), dark);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(x, 0.7, 2.2);
    g.add(eng);
  }
  g.traverse(o => { o.castShadow = true; });
  return g;
}

function spawn(type: ProjType, pos: Vec3, vel: Vec3, target?: Vec3): Projectile {
  const bd = b3.b3DefaultBodyDef();
  bd.type = b3.b3BodyType.b3_dynamicBody;
  bd.position = [pos[0], pos[1], pos[2]];
  bd.linearVelocity = vel;
  bd.isBullet = type === 'ball' || type === 'rocket' || type === 'bomb';
  if (type === 'ball' || type === 'beacon' || type === 'bottle') bd.angularVelocity = [Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8];
  const body = b3.b3CreateBody(world, bd);
  const sd = b3.b3DefaultShapeDef();
  sd.filter = filter(CAT.projectile, ALL & ~(CAT.player | CAT.projectile));
  sd.enableContactEvents = false;
  sd.enableHitEvents = type === 'ball';
  sd.baseMaterial.friction = 0.6;
  sd.baseMaterial.restitution = type === 'beacon' ? 0.3 : 0.08;
  sd.baseMaterial.rollingResistance = 0.05;
  let shape: b3ShapeId;
  if (type === 'charge') {
    sd.density = 350;
    shape = b3.b3CreateBoxShape(body, sd, 0.14, 0.05, 0.1);
  } else if (type === 'thermite') {
    sd.density = 900;
    shape = b3.b3CreateBoxShape(body, sd, 0.085, 0.08, 0.085);
  } else if (type === 'cutter') {
    sd.density = 900;
    shape = b3.b3CreateBoxShape(body, sd, 0.15, 0.018, 0.03);
  } else if (type === 'megabomb') {
    sd.density = 700;
    shape = b3.b3CreateBoxShape(body, sd, 0.28, 0.2, 0.21);
  } else {
    const r = type === 'ball' ? 0.15 : type === 'bomb' ? 0.14 : type === 'bottle' ? 0.07 : 0.08;
    sd.density = type === 'ball' ? 2120 : type === 'bomb' ? 4400 : type === 'bottle' ? 900 : 700;
    shape = b3.b3CreateSphereShape(body, sd, { center: [0, 0, 0], radius: r });
  }
  const mesh = makeMesh(type);
  mesh.traverse(o => { o.castShadow = true; });
  mesh.position.fromArray(pos);
  scene.add(mesh);
  const mass = b3.b3Body_GetMass(body);
  const ae = AERO[type];
  const p: Projectile = {
    kind: 'projectile', body, mass, type, shape, mesh, born: now, dead: false,
    stuck: false, joint: null, trail: 0, landedAt: -1, target,
    prevPos: [...pos], prevRot: [0, 0, 0, 1], curPos: [...pos], curRot: [0, 0, 0, 1], movedStep: -1,
    host: null, armAt: -1, lit: false, tick: 0, beat: 0, chew: 0, width: 0.6, kg: 2.5, delay: 0,
    drag: ae ? (0.5 * 1.225 * ae[1] * Math.PI * ae[0] * ae[0]) / Math.max(mass, 0.1) : 0, warhead: 'he',
  };
  register(p);
  projectiles.push(p);
  orient(p, vel);
  return p;
}

const _fwdAxis = new THREE.Vector3(0, 0, -1), _dir = new THREE.Vector3();
function orient(p: Projectile, v: ArrayLike<number>): void {
  if (p.type !== 'rocket' && p.type !== 'bomb') return;
  _dir.set(v[0], v[1], v[2]);
  if (_dir.lengthSq() < 1) return;
  p.mesh.quaternion.setFromUnitVectors(_fwdAxis, _dir.normalize());
}

function removeProjectile(p: Projectile): void {
  if (p.dead) return;
  p.dead = true;
  if (p === selected) selected = null;
  unregister(p);
  if (b3.b3Body_IsValid(p.body)) b3.b3DestroyBody(p.body);
  scene.remove(p.mesh);
  p.mesh.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
}

function blowUp(p: Projectile, at: Vec3): void {
  if (p.type === 'cutter') { recordFire(p); cut(p); return; }
  if (p.type === 'megabomb') { megaBlast(p, at); return; }
  if (p.type === 'charge') recordFire(p);
  removeProjectile(p);
  if (p.type === 'rocket') explode(at, ROCKET.radius, ROCKET.power, ROCKET.impulse);
  else if (p.type === 'bomb') explode(at, BOMB.radius, BOMB.power, BOMB.impulse, 1.2);
  else if (p.type === 'charge') {
    const b = blastOf(p.kg);
    explode(at, b.radius, b.power, b.impulse, CHARGE.weldReach);
  }
}

function recordFire(p: Projectile): void {
  fired.push({ type: p.type === 'cutter' ? 'cutter' : 'charge', delay: p.delay, at: now, pos: [...p.curPos] });
}

function stick(p: Projectile, point: Vec3, normal: Vec3, target: PhysEntity | undefined, rot?: Quat): void {
  const off = STICK_OFFSET[p.type] ?? 0.05;
  const pos: Vec3 = [point[0] + normal[0] * off, point[1] + normal[1] * off, point[2] + normal[2] * off];
  rot ??= quat.rotationTo([0, 0, 0, 1], [0, 1, 0], normal) as Quat;
  b3.b3Body_SetTransform(p.body, pos, rot);
  b3.b3Body_SetLinearVelocity(p.body, [0, 0, 0]);
  b3.b3Body_SetAngularVelocity(p.body, [0, 0, 0]);
  copy3(p.curPos, pos); copy3(p.prevPos, pos);
  p.curRot = [...rot]; p.prevRot = [...rot];
  p.stuck = true;
  const piece = pieceOf(target);
  p.host = piece;
  const jd = b3.b3DefaultWeldJointDef();
  jd.base.bodyIdA = p.body;
  jd.base.localFrameA = { position: [0, 0, 0], quaternion: quat.conjugate([0, 0, 0, 1], rot) as Quat };
  if (piece) {
    jd.base.bodyIdB = piece.body;
    const lp: Vec3 = [0, 0, 0];
    b3.b3Body_GetLocalPoint(lp, piece.body, pos);
    const pr: Quat = [0, 0, 0, 1];
    b3.b3Body_GetRotation(pr, piece.body);
    quat.conjugate(pr, pr);
    jd.base.localFrameB = { position: lp, quaternion: pr };
  } else {
    jd.base.bodyIdB = ground;
    jd.base.localFrameB = { position: [pos[0], pos[1] - GROUND_Y, pos[2]], quaternion: [0, 0, 0, 1] };
  }
  p.joint = b3.b3CreateWeldJoint(world, jd);
  if (p.type === 'thermite' && p.armAt < 0) p.armAt = now + THERMITE.delay;
  audio.chargeStick(pos);
}

/* Outward face normal of a planted device (its local +Y), or straight up once it has come loose. */
function faceNormal(p: Projectile, out: Vec3): Vec3 {
  if (!p.stuck) return vec3.set(out, 0, 1, 0);
  return vec3.transformQuat(out, [0, 1, 0], p.curRot);
}

/* ---------------- rocket ---------------- */

function rocketImpact(p: Projectile, point: Vec3, entity: PhysEntity | undefined, back: Vec3): void {
  b3.b3Body_GetLinearVelocity(_v, p.body);
  const sp = vec3.length(_v) || 1;
  const dir: Vec3 = [_v[0] / sp, _v[1] / sp, _v[2] / sp];
  const tandem = p.warhead === 'tandem';
  removeProjectile(p);
  let piece = pieceOf(entity);
  if (!tandem || !piece) { explode(back, ROCKET.radius, ROCKET.power, ROCKET.impulse); return; }
  // the precursor's own small blast at the face
  explode(back, 1.2, 12e3, 500, 0.4, 3);
  let jet = TANDEM.jet, pos: Vec3 = [...point], exit: Vec3 | null = null;
  for (let layer = 0; layer < 4 && piece; layer++) {
    const fill = fillOf(piece);
    const solid = chord(piece, pos, dir);
    const geo = solid / fill;
    const need = solid * Math.sqrt(piece.pm.density / TANDEM.rhoJet);
    const reach = Math.min(geo, (jet / Math.sqrt(piece.pm.density / TANDEM.rhoJet)) / fill);
    cutRebarNear(piece, [pos[0] + dir[0] * reach * 0.5, pos[1] + dir[1] * reach * 0.5, pos[2] + dir[2] * reach * 0.5], 0.12);
    if (need > jet || !Number.isFinite(need)) {
      damagePiece(piece, pos, piece.hp * 0.7, true);
      fx.debris(pos, 10, piece.pm.chips, 6, [-dir[0], -dir[1], -dir[2]]);
      exit = null;
      break;
    }
    jet -= need;
    const out: Vec3 = [pos[0] + dir[0] * geo, pos[1] + dir[1] * geo, pos[2] + dir[2] * geo];
    // behind-armour debris: the exit face spalls out in a cone
    damagePiece(piece, out, piece.hp * 1.05, true);
    fx.debris(out, 14, piece.pm.chips, 9, dir);
    exit = out;
    const next = raycast([out[0] + dir[0] * 0.02, out[1] + dir[1] * 0.02, out[2] + dir[2] * 0.02], [dir[0] * TANDEM.air, dir[1] * TANDEM.air, dir[2] * TANDEM.air], NO_HIT);
    if (!next) break;
    piece = pieceOf(next.entity);
    pos = [next.point[0], next.point[1], next.point[2]];
  }
  if (exit) {
    const b = blastOf(TANDEM.follow);
    explode([exit[0] + dir[0] * 0.9, exit[1] + dir[1] * 0.9, exit[2] + dir[2] * 0.9], b.radius, b.power, b.impulse, 1.2);
    hitmarker(1);
  } else explode(back, ROCKET.radius * 0.8, ROCKET.power * 0.8, ROCKET.impulse * 0.8);
}

/* ---------------- cutting charge ---------------- */

function cut(p: Projectile): void {
  const pos: Vec3 = [0, 0, 0], rot: Quat = [0, 0, 0, 1];
  b3.b3Body_GetTransform(pos, rot, p.body);
  const n = vec3.transformQuat([0, 0, 0], [0, 1, 0], rot) as Vec3;
  const across = vec3.transformQuat([0, 0, 0], [1, 0, 0], rot) as Vec3;
  const host = p.host && !p.host.dead ? p.host : nearestPiece(pos, 0.4);
  let width = p.width;
  removeProjectile(p);
  const at: Vec3 = [pos[0] - n[0] * 0.03, pos[1] - n[1] * 0.03, pos[2] - n[2] * 0.03];
  if (host) {
    const axis: Vec3 = [0, 0, 0];
    width = memberAxis(host, n, axis, across);
    if (sever(host, at, axis)) {
      hitmarker(1);
      for (const { p: q } of piecesNear(at, 0.6)) {
        const j = Math.min(q.mass * CUTTER.kick, 4000);
        applyImpulseAt(q, [-n[0] * j, -n[1] * j, -n[2] * j], at);
      }
    } else {
      damagePiece(host, at, Math.min(host.hp * 1.5, 250e3), true);
    }
  }
  fx.cutter(at, across, clamp(width, 0.3, 3));
  audio.cutter(at);
  explode(pos, CUTTER.radius, CUTTER.power, CUTTER.impulse, 0.5, 2);
}

/* ---------------- thermite ---------------- */

const _n: Vec3 = [0, 0, 0];

function thermiteHost(p: Projectile, near: { p: Piece; d: number }[]): Piece | null {
  if (p.stuck && p.host && !p.host.dead) return p.host;
  return near.length && near[0].d < 0.3 ? near[0].p : null;
}

function updateThermite(p: Projectile, dt: number): void {
  if (p.armAt < 0) {
    if (now - p.born > 2.5) p.armAt = now;
    return;
  }
  const age = now - p.armAt;
  if (age < 0) return;
  if (age >= THERMITE.burn) { burnOut(p); return; }
  p.tick -= dt;
  if (p.tick > 0) return;
  p.tick += 0.1;
  const pos = p.curPos;
  faceNormal(p, _n);
  if (!p.lit) {
    p.lit = true;
    fx.sparks(pos, _n, 24);
    audio.sizzle(pos, 1);
  }
  const k = Math.min(1, 0.25 + age / 0.4) * Math.min(1, (THERMITE.burn - age) / 0.8);
  fx.thermite(pos, k);
  audio.thermite(pos, k);
  const near = piecesNear(pos, THERMITE.reach);
  const host = thermiteHost(p, near);
  for (const { p: q, d } of near) {
    const rate = (THERMITE.rate * k) / clamp(Math.cbrt(q.volume) * 1.4, 0.7, 2.5);
    if (q === host) heat(q, (THERMITE.core - q.temp) * rate);
    else heat(q, (1500 - q.temp) * rate * 0.35 * (1 - d / THERMITE.reach));
    if (q.pm.thermal.ignite !== undefined && d < 0.5) ignite(q);
  }
  if (!host) return;
  const melt = MELT[host.mat];
  if (melt !== undefined) {
    if (host.temp >= melt) burnThrough(p, host);
    return;
  }
  p.chew -= 0.1;
  if (p.chew <= 0 && Number.isFinite(host.pm.toughness)) {
    p.chew = 0.5;
    damagePiece(host, pos, host.hp * 0.22, true);
    fx.debris(pos, 3, host.pm.chips, 2.5, _n);
  }
}

/* Molten iron has eaten through the section: cut the member across its long axis at the pot. */
function burnThrough(p: Projectile, host: Piece): void {
  const n = faceNormal(p, [0, 0, 0]);
  const at: Vec3 = [p.curPos[0] - n[0] * 0.08, p.curPos[1] - n[1] * 0.08, p.curPos[2] - n[2] * 0.08];
  const axis: Vec3 = [0, 0, 0], across: Vec3 = [0, 0, 0];
  memberAxis(host, n, axis, across);
  removeProjectile(p);
  if (!sever(host, at, axis)) damagePiece(host, at, Math.min(host.hp * 1.5, 250e3), true);
  fx.sparks(at, n, 40);
  fx.debris(at, 10, 0xffa640, 3);
  audio.steelGroan(at, 1);
  hitmarker(0.8);
}

function burnOut(p: Projectile): void {
  const host = thermiteHost(p, piecesNear(p.curPos, 0.3));
  if (host && MELT[host.mat] !== undefined) { burnThrough(p, host); return; }
  fx.dust(p.curPos, 0.5, 0x4a4540);
  removeProjectile(p);
}

/* ---------------- firebomb ---------------- */

function shatter(p: Projectile, at: Vec3, normal: Vec3): void {
  removeProjectile(p);
  fx.firebomb(at, FIRE.radius);
  softHeat(at, FIRE.radius, 700);
  fx.shards(at, 10);
  audio.firebomb(at);
  for (const { p: q, d } of piecesNear(at, FIRE.radius)) {
    const f = 1 - d / FIRE.radius;
    // the flash heats a surface skin, not the whole member: q·A·t over its heat capacity, a few hundred °C on a crate
    heat(q, (FIRE.flux * f * Math.min(4, surfaceArea(q)) * FIRE.flash) / heatCap(q));
    if (flammable(q.pm) && (d < FIRE.radius * 0.6 || Math.random() < f)) ignite(q);
  }
  const o: Vec3 = [at[0] + normal[0] * 0.15, at[1] + normal[1] * 0.15 + 0.05, at[2] + normal[2] * 0.15];
  const down = raycast(o, [0, -12, 0], NO_HIT);
  const pool: Vec3 = down ? [down.point[0], down.point[1] + 0.03, down.point[2]] : [at[0], 0.03, at[2]];
  fx.fire(pool, FIRE.poolTime, 2);
  if (down?.entity?.kind === 'ground') fx.scorch([pool[0], pool[1] - 0.02, pool[2]], 2.2);
  patches.push({ pos: pool, until: now + FIRE.poolTime, tick: 0 });
  if (player.e && vec3.distance(player.e.curPos, at) < 12) addTrauma(0.1);
}

/* The burning pool keeps cooking whatever stands in it, and pours its heat and smoke into the room. */
function updatePatches(dt: number): void {
  for (let i = patches.length - 1; i >= 0; i--) {
    const f = patches[i];
    if (now >= f.until) { patches.splice(i, 1); continue; }
    f.tick -= dt;
    if (f.tick > 0) continue;
    f.tick += 0.25;
    const above: Vec3 = [f.pos[0], f.pos[1] + 0.6, f.pos[2]];
    addHeat(above, FIRE.hrr, 0.25);
    addSmoke(above, 40, 0.9, 0.25);
    for (const { p: q, d } of piecesNear(above, FIRE.pool)) {
      const k = 1 - d / FIRE.pool;
      if (flammable(q.pm)) {
        heat(q, 45 * k);
        if (d < 1.2 && Math.random() < 0.2) ignite(q);
      } else heat(q, 12 * k);
    }
  }
}

/* ---------------- megabomb ---------------- */

function megaBlast(p: Projectile, at: Vec3): void {
  removeProjectile(p);
  const b = blastOf(MEGA.kg);
  explode(at, b.radius, b.power, b.impulse, MEGA.weldReach, MEGA.fractures);
  fx.megablast(at, b.radius * 1.4);
  audio.megabomb(at);
  for (const { p: q, d } of piecesNear(at, MEGA.fireball)) {
    const f = 1 - d / MEGA.fireball;
    heat(q, 900 * f);
    if (f > 0.3 && flammable(q.pm)) ignite(q);
  }
  const d = player.e ? vec3.distance(player.e.curPos, at) : 0;
  const k = clamp(1.15 - d / 90, 0.2, 1);
  addTrauma(k);
  kickFov(34 * k);
  kickRecoil(1.2 * k);
  if (d < b.radius * 1.6) knockback(0.4 + 0.6 * (1 - d / (b.radius * 1.6)));
}

/* ---------------- airstrike ---------------- */

/* One integration step of free flight with quadratic drag (the same the solver steps use). */
function fly(pos: Vec3, vel: Vec3, drag: number, h: number): void {
  const s = vec3.length(vel);
  vel[0] -= drag * s * vel[0] * h;
  vel[1] -= (drag * s * vel[1] + 9.81) * h;
  vel[2] -= drag * s * vel[2] * h;
  pos[0] += vel[0] * h; pos[1] += vel[1] * h; pos[2] += vel[2] * h;
}

const bombDrag = (): number => {
  const ae = AERO.bomb!;
  const m = 4400 * (4 / 3) * Math.PI * ae[0] ** 3;
  return (0.5 * 1.225 * ae[1] * Math.PI * ae[0] * ae[0]) / m;
};

/* The smoke is down: a ground-attack jet runs in over the player toward the marker and releases a stick of four
   bombs at the point their fall (with drag) carries them onto it. */
function callStrike(p: Projectile): void {
  p.landedAt = now;
  const c: Vec3 = [...p.curPos];
  fx.beacon(c, 16);
  const ex = player.e ? player.e.curPos : [c[0] + 1, c[1], c[2]];
  let hx = c[0] - ex[0], hz = c[2] - ex[2];
  const hl = Math.hypot(hx, hz) || 1;
  hx /= hl; hz /= hl;
  const pos: Vec3 = [0, PLANE.h, 0], vel: Vec3 = [PLANE.v, 0, 0], k = bombDrag();
  let t = 0;
  while (pos[1] > 0 && t < 20) { fly(pos, vel, k, 1 / 60); t += 1 / 60; }
  const range = pos[0];
  const heading: Vec3 = [hx, 0, hz];
  const mid = (PLANE.bombs - 1) / 2 * PLANE.spacing;
  const t0 = now + PLANE.radio;
  const start: Vec3 = [c[0] - hx * (range + PLANE.v * PLANE.approach), c[1] + PLANE.h, c[2] - hz * (range + PLANE.v * PLANE.approach)];
  sorties.push({ target: c, heading, start, t0, release: t0 + PLANE.approach - mid, dropped: 0, mesh: null, done: t0 + PLANE.approach + 9 });
  onDeny(`Airstrike inbound — ${Math.round(PLANE.radio + PLANE.approach + t)} s, get clear of the smoke`);
}

const _pp: Vec3 = [0, 0, 0];
function planePos(s: Sortie, out: Vec3): Vec3 {
  const d = PLANE.v * (now - s.t0);
  return vec3.set(out, s.start[0] + s.heading[0] * d, s.start[1], s.start[2] + s.heading[2] * d);
}

function updateSorties(): void {
  for (let i = sorties.length - 1; i >= 0; i--) {
    const s = sorties[i];
    if (now < s.t0) continue;
    if (now > s.done) {
      if (s.mesh) { scene.remove(s.mesh); s.mesh.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
      sorties.splice(i, 1);
      continue;
    }
    planePos(s, _pp);
    if (!s.mesh) {
      s.mesh = makePlane();
      s.mesh.rotation.y = Math.atan2(-s.heading[0], -s.heading[2]);
      scene.add(s.mesh);
      audio.incoming(s.target);
    }
    while (s.dropped < PLANE.bombs && now >= s.release + s.dropped * PLANE.spacing) {
      spawn('bomb', [_pp[0], _pp[1] - 1.2, _pp[2]], [s.heading[0] * PLANE.v, 0, s.heading[2] * PLANE.v]);
      s.dropped++;
    }
  }
}

const _v: Vec3 = [0, 0, 0];

/* Look-ahead rays before the solver runs, so fast ordnance detonates/sticks on the surface instead
   of bouncing; drag and rocket thrust; then the hand tools steer their bodies for this step. */
export function weaponsPreStep(): void {
  const held = heldEntity();
  for (const p of projectiles) {
    if (p.dead || p.stuck || p === held) continue;
    if (p.drag > 0 || p.type === 'rocket') {
      b3.b3Body_GetLinearVelocity(_v, p.body);
      const age = now - p.born;
      const s = vec3.length(_v);
      if (p.type === 'rocket' && age > MOTOR.ignite && age < MOTOR.burn && s > 1 && s < MOTOR.max) {
        const a = Math.min(MOTOR.accel * FIXED_DT, MOTOR.max - s);
        vec3.scaleAndAdd(_v, _v, _v, a / s);
      }
      const k = 1 - p.drag * vec3.length(_v) * FIXED_DT;
      vec3.scale(_v, _v, k);
      b3.b3Body_SetLinearVelocity(p.body, _v);
    }
    if (!LOOKAHEAD.has(p.type)) continue;
    b3.b3Body_GetLinearVelocity(_v, p.body);
    const k = FIXED_DT * 1.25;
    const hit = raycast(p.curPos, [_v[0] * k, _v[1] * k, _v[2] * k], NO_HIT);
    if (!hit) continue;
    const back: Vec3 = [hit.point[0] - _v[0] * 0.002, hit.point[1] - _v[1] * 0.002, hit.point[2] - _v[2] * 0.002];
    if (STICKY.has(p.type)) stick(p, hit.point as Vec3, hit.normal as Vec3, hit.entity, plantRot(pieceOf(hit.entity), hit.normal as Vec3));
    else if (p.type === 'bottle') shatter(p, back, hit.normal as Vec3);
    else if (p.type === 'rocket') rocketImpact(p, hit.point as Vec3, hit.entity, back);
    else blowUp(p, back);
  }
  if (player.e) {
    aim();
    gravPreStep(_eye, _fwd, loadout.current === 'gravgun', FIXED_DT);
  }
  winchPreStep(reelFrame === frame && loadout.current === 'winch');
  wreckerPreStep(FIXED_DT);
}

export function weaponsAfterStep(dt: number): void {
  now += dt;
  for (let i = swings.length - 1; i >= 0; i--) if (now >= swings[i].t) { const s = swings.splice(i, 1)[0]; swingHammer(s.k); }

  for (let i = detonations.length - 1; i >= 0; i--) {
    const d = detonations[i];
    if (now < d.t) continue;
    detonations.splice(i, 1);
    if (d.p.dead) continue;
    const pos: Vec3 = [0, 0, 0];
    b3.b3Body_GetPosition(pos, d.p.body);
    blowUp(d.p, pos);
  }

  updateSorties();

  const held = heldEntity();
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (p.dead) { projectiles.splice(i, 1); continue; }
    const age = now - p.born;
    if (p.stuck && p.joint && !b3.b3Joint_IsValid(p.joint)) { p.stuck = false; p.joint = null; p.host = null; }
    switch (p.type) {
      case 'rocket':
        if (age > 7) blowUp(p, [...p.curPos]);
        break;
      case 'bomb':
        if (age > 20 || p.curPos[1] < groundAt(p.curPos[0], p.curPos[2]) + 0.15) blowUp(p, [p.curPos[0], Math.max(groundAt(p.curPos[0], p.curPos[2]) + 0.2, p.curPos[1]), p.curPos[2]]);
        break;
      case 'ball':
        if (age > 12) removeProjectile(p);
        break;
      case 'beacon':
        if (p.landedAt < 0) {
          if (p === held) break;
          b3.b3Body_GetLinearVelocity(_v, p.body);
          if ((age > 0.5 && vec3.length(_v) < 1) || age > 3) callStrike(p);
        } else if (now - p.landedAt > 14) {
          removeProjectile(p);
        }
        break;
      case 'thermite':
        updateThermite(p, dt);
        break;
      case 'bottle':
        if (p === held) break;
        b3.b3Body_GetLinearVelocity(_v, p.body);
        if ((age > 0.3 && vec3.length(_v) < 1.5) || age > 8) shatter(p, [...p.curPos], [0, 1, 0]);
        break;
      case 'megabomb': {
        const left = p.armAt - now;
        if (left <= 0) { blowUp(p, [...p.curPos]); break; }
        const s = Math.ceil(left);
        if (s !== p.beat) {
          p.beat = s;
          audio.ui('deny');
          onDeny(s === Math.ceil(MEGA.fuse) ? `MEGABOMB ARMED — ${s}` : `MEGABOMB — ${s}`);
        }
        break;
      }
      case 'charge':
      case 'cutter':
        break;
    }
    if (!p.dead && p.curPos[1] < -20) removeProjectile(p);
  }

  updatePatches(dt);
  winchAfterStep(dt);
  wreckerAfterStep(dt);
  const cur = loadout.current;
  machiningStep(dt, workFrame === frame && isMachineTool(cur));
  breakerStep(dt, workFrame === frame && cur === 'breaker');
  hoseStep(dt);
  excavatorStep(dt);
  splitterStep(dt);
  wireStep(dt);
}

/* Wired to the physics hit handler: projectile feedback, including the wrecking ball. */
export function onProjectileHit(a: PhysEntity | undefined, b: PhysEntity | undefined, point: Vec3, speed: number): void {
  if (wreckerHit(a, b, point, speed)) return;
  const ball = a?.kind === 'projectile' ? (a as Projectile) : b?.kind === 'projectile' ? (b as Projectile) : null;
  if (!ball || ball.type !== 'ball' || speed < 10) return;
  const other = ball === a ? b : a;
  if (pieceOf(other)) hitmarker(clamp(speed / 60, 0.3, 1));
  else fx.impact(point, [0, 1, 0], 'concrete', clamp(speed / 60, 0.2, 0.8));
}

function canGrab(e: PhysEntity): boolean {
  const p = e as Projectile;
  return projectiles.includes(p) && !p.dead && !p.stuck && p.type !== 'rocket' && p.type !== 'bomb';
}

/* ---------------- aim assist ---------------- */

const _bc: Vec3 = [0, 0, 0], _bs: Vec3 = [0, 0, 0], _br: Quat = [0, 0, 0, 1], _mn: Vec3 = [0, 0, 0], _mx: Vec3 = [0, 0, 0];

function outline(p: Piece, s: AimState, opacity = 0.55): void {
  localBounds(p, _mn, _mx);
  obb(p.curPos, p.curRot, _mn, _mx, _bc, _br, _bs);
  marks.box(_bc, _br, _bs, s, opacity);
}

const arcPts: number[] = [];
/* Forward-simulate a shot with the solver's own drag and thrust to show where it will come down. */
function predict(type: ProjType, pos: Vec3, vel: Vec3, s: AimState): Vec3 | null {
  const ae = AERO[type];
  const r = ae ? ae[0] : 0.1;
  const mass = type === 'ball' ? 2120 * (4 / 3) * Math.PI * 0.15 ** 3 : type === 'rocket' ? 700 * (4 / 3) * Math.PI * 0.08 ** 3 : 900 * (4 / 3) * Math.PI * 0.07 ** 3;
  const drag = ae ? (0.5 * 1.225 * ae[1] * Math.PI * r * r) / mass : 0;
  const p: Vec3 = [...pos], v: Vec3 = [...vel];
  const h = 1 / 30;
  arcPts.length = 0;
  arcPts.push(p[0], p[1], p[2]);
  let hitAt: Vec3 | null = null, n: Vec3 = [0, 1, 0];
  for (let t = 0; t < 4; t += h) {
    if (type === 'rocket' && t > MOTOR.ignite && t < MOTOR.burn) {
      const sp = vec3.length(v);
      if (sp < MOTOR.max) vec3.scaleAndAdd(v, v, v, Math.min(MOTOR.accel * h, MOTOR.max - sp) / sp);
    }
    const q: Vec3 = [...p];
    fly(p, v, drag, h);
    const hit = raycast(q, [p[0] - q[0], p[1] - q[1], p[2] - q[2]], NO_HIT);
    if (hit) { hitAt = [hit.point[0], hit.point[1], hit.point[2]]; n = [hit.normal[0], hit.normal[1], hit.normal[2]]; arcPts.push(...hitAt); break; }
    arcPts.push(p[0], p[1], p[2]);
  }
  marks.arc(arcPts, arcPts.length / 3, s);
  if (hitAt) marks.marker(hitAt, n, type === 'rocket' ? ROCKET.radius * 0.15 : 0.35, s);
  predicted = hitAt;
  return hitAt;
}

function reachPreview(R: number, what: (p: Piece | null) => AimState): void {
  const hit = raycast(_eye, [_fwd[0] * R * 3, _fwd[1] * R * 3, _fwd[2] * R * 3], NO_HIT);
  if (!hit) return;
  const p = pieceOf(hit.entity);
  const far = hit.fraction * R * 3 > R;
  const s = far ? 'far' : what(p);
  marks.marker(hit.point as Vec3, hit.normal as Vec3, 0.12, s);
  if (p && !far) outline(p, s, 0.4);
}

function plantPreview(type: 'charge' | 'thermite' | 'megabomb'): void {
  const hit = raycast(_eye, [_fwd[0] * PLANT_REACH, _fwd[1] * PLANT_REACH, _fwd[2] * PLANT_REACH], NO_HIT);
  if (!hit) {
    aim();
    const sp = type === 'thermite' ? 12 : type === 'megabomb' ? 8 : 11;
    predict('bottle', _muzzle, [_fwd[0] * sp, _fwd[1] * sp + 1.6, _fwd[2] * sp], 'far');
    return;
  }
  const p = pieceOf(hit.entity);
  const n = hit.normal as Vec3;
  const rot = plantRot(p, n) ?? (quat.rotationTo([0, 0, 0, 1], [0, 1, 0], n) as Quat);
  const kg = type === 'charge' ? chargeKg : type === 'megabomb' ? MEGA.kg : 1;
  const k = type === 'charge' ? Math.cbrt(kg / 2.5) : 1;
  const size: Vec3 = type === 'charge' ? [0.28 * k, 0.1 * k, 0.2 * k] : type === 'megabomb' ? [0.56, 0.4, 0.42] : [0.17, 0.16, 0.17];
  const off = (STICK_OFFSET[type] ?? 0.05);
  marks.box([hit.point[0] + n[0] * off, hit.point[1] + n[1] * off, hit.point[2] + n[2] * off], rot, size, 'ok', 0.9);
  const r = type === 'thermite' ? THERMITE.reach : blastOf(kg).radius * 0.25;
  const bad = type === 'thermite' && p && MELT[p.mat] === undefined;
  marks.marker(hit.point as Vec3, n, r, bad ? 'far' : 'ok');
  if (p) outline(p, bad ? 'far' : 'ok');
}

function cutterPreview(): void {
  const hit = raycast(_eye, [_fwd[0] * PLANT_REACH * 2, _fwd[1] * PLANT_REACH * 2, _fwd[2] * PLANT_REACH * 2], NO_HIT);
  if (!hit) return;
  const p = pieceOf(hit.entity);
  const far = hit.fraction * PLANT_REACH * 2 > PLANT_REACH;
  const n = hit.normal as Vec3;
  if (!p) { marks.marker(hit.point as Vec3, n, 0.15, 'bad'); return; }
  const s: AimState = far ? 'far' : 'ok';
  outline(p, s);
  const axis: Vec3 = [0, 0, 0], across: Vec3 = [0, 0, 0];
  const w = memberAxis(p, n, axis, across);
  vec3.scaleAndAdd(across, across, n, -vec3.dot(across, n));
  vec3.normalize(across, across);
  const h = Math.min(w, 3) / 2;
  const a: Vec3 = [hit.point[0] - across[0] * h, hit.point[1] - across[1] * h, hit.point[2] - across[2] * h];
  const b: Vec3 = [hit.point[0] + across[0] * h, hit.point[1] + across[1] * h, hit.point[2] + across[2] * h];
  marks.line(a, b, s);
  // the plane it will sever along, drawn round the member
  localBounds(p, _mn, _mx);
  const depth = chord(p, hit.point as Vec3, [-n[0], -n[1], -n[2]]) / fillOf(p);
  marks.line(a, [a[0] - n[0] * depth, a[1] - n[1] * depth, a[2] - n[2] * depth], s);
  marks.line(b, [b[0] - n[0] * depth, b[1] - n[1] * depth, b[2] - n[2] * depth], s);
  marks.marker(hit.point as Vec3, n, 0.08, s);
}

const jetPreview: JetPath = { pts: [], n: 0, hit: null };

function preview(): void {
  marks.begin();
  if (!player.e) { marks.end(); return; }
  aim();
  const cur = loadout.current;
  switch (cur) {
    case 'charge': case 'thermite': case 'megabomb': plantPreview(cur); break;
    case 'cutter': cutterPreview(); break;
    case 'cannon': predict('ball', _muzzle, [_fwd[0] * 62, _fwd[1] * 62, _fwd[2] * 62], 'ok'); break;
    case 'rocket': predict('rocket', _muzzle, [_fwd[0] * MOTOR.launch, _fwd[1] * MOTOR.launch, _fwd[2] * MOTOR.launch], warhead === 'tandem' ? 'ok' : 'far'); break;
    case 'incendiary': case 'airstrike': predict('bottle', _muzzle, [_fwd[0] * 17, _fwd[1] * 17 + 3.5, _fwd[2] * 17], 'ok'); break;
    case 'hammer': reachPreview(SLEDGE.reach, p => (p && Number.isFinite(p.pm.toughness) ? 'ok' : 'bad')); break;
    case 'breaker': reachPreview(BREAKER.reach, p => (p && Number.isFinite(p.pm.toughness) && p.pm.surface !== 'metal' ? 'ok' : 'bad')); break;
    case 'grinder': case 'saw': case 'drill': case 'shears': case 'plasma': case 'torch': reachPreview(cur === 'shears' ? 2.1 : 1.9, p => (p ? 'ok' : 'bad')); break;
    case 'winch': {
      const hit = raycast(_eye, [_fwd[0] * WINCH_RANGE, _fwd[1] * WINCH_RANGE, _fwd[2] * WINCH_RANGE], NO_HIT);
      const p = hit ? pieceOf(hit.entity) : null;
      if (hit && p) { const s: AimState = vehicleOf(p) ? 'sel' : 'ok'; marks.marker(hit.point as Vec3, hit.normal as Vec3, 0.25, s); outline(p, s); }
      break;
    }
    case 'gravgun': {
      const hit = raycast(_eye, [_fwd[0] * 12, _fwd[1] * 12, _fwd[2] * 12], ALL & ~CAT.player);
      const p = hit ? pieceOf(hit.entity) : null;
      if (p && !heldEntity()) outline(p, p.welds.length ? 'far' : p.mass > 2500 ? 'bad' : 'ok');
      break;
    }
    case 'wrecker': reachPreview(60, p => (p ? 'ok' : 'far')); break;
    case 'planner': {
      const pick = pickDevice();
      for (const p of armed()) {
        const s: AimState = p === selected ? 'sel' : p === pick ? 'ok' : 'far';
        marks.box(p.curPos, p.curRot, p.type === 'cutter' ? [p.width, 0.08, 0.1] : [0.35, 0.18, 0.28], s, 0.9);
      }
      if (!pick) {
        const hit = raycast(_eye, [_fwd[0] * 150, _fwd[1] * 150, _fwd[2] * 150], NO_HIT);
        if (hit) marks.marker(hit.point as Vec3, [0, 1, 0], 1.2, 'sel');
      }
      break;
    }
    case 'excavator': {
      const a = excavatorAim();
      if (a) {
        marks.marker(a.target, [0, 1, 0], 0.6, a.ok ? 'ok' : 'far');
        marks.line(a.tip, a.target, a.ok ? 'ok' : 'far');
      }
      break;
    }
    case 'hose': {
      const path = hoseOn() ? hosePath() : traceJet([_eye[0] + _fwd[0] * 0.9, _eye[1] + _fwd[1] * 0.9 - 0.25, _eye[2] + _fwd[2] * 0.9], _fwd, hoseFog(), jetPreview);
      if (!hoseOn()) marks.arc(path.pts, path.n, 'sel');
      if (path.hit) marks.marker(path.hit.point, path.hit.normal, hoseFog() ? 0.8 + 0.14 * path.hit.dist : 0.3 + 0.025 * path.hit.dist, 'sel');
      break;
    }
    case 'splitter': {
      const hit = raycast(_eye, [_fwd[0] * SPLITTER.reach, _fwd[1] * SPLITTER.reach, _fwd[2] * SPLITTER.reach], NO_HIT);
      const p = hit ? pieceOf(hit.entity) : null;
      if (hit && p) {
        const h = holeNear(p, hit.point as Vec3, 0.12);
        marks.marker(h ? h.point : (hit.point as Vec3), hit.normal as Vec3, h ? 0.06 : 0.1, h ? 'ok' : 'bad');
        outline(p, h ? 'ok' : 'far');
      }
      break;
    }
    case 'wiresaw': reachPreview(WIRE.reach, p => (p ? 'ok' : 'bad')); break;
  }
  marks.end();
}

/* ---------------- per-frame sync ---------------- */

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const FLYBY: Partial<Record<ProjType, number>> = { ball: 0.3, rocket: 0.3, bomb: 0.5, bottle: 0.15, charge: 0.2, thermite: 0.2, megabomb: 0.5 };

function syncCord(): void {
  const list = armed().sort((a, b) => a.delay - b.delay || a.born - b.born);
  const need = Math.max(0, list.length - 1);
  while (cord.length < need) { const id = cables.add(0.008, 0xe0661c); if (id < 0) break; cord.push(id); }
  while (cord.length > need) cables.remove(cord.pop()!);
  for (let i = 0; i < cord.length; i++) {
    const a = list[i].mesh.position, b = list[i + 1].mesh.position;
    const d = a.distanceTo(b);
    cables.set(cord[i], [a.x, a.y, a.z], [b.x, b.y, b.z], Math.min(0.6, 0.05 + d * 0.04));
  }
}

/* Once per rendered frame: interpolated meshes, trails, blinkers, rigs and cables (flushes cables). */
export function syncProjectiles(alpha: number, dt: number): void {
  // a hammer swing wound up and let go without main seeing the release
  if (windAt >= 0 && (lastTry < frame - 1 || loadout.current !== 'hammer')) {
    if (loadout.current === 'hammer') releaseHammer(); else windAt = -1;
  }
  for (const p of projectiles) {
    if (p.dead) continue;
    const a = p.movedStep === stepCount ? alpha : 1;
    p.mesh.position.set(
      p.prevPos[0] + (p.curPos[0] - p.prevPos[0]) * a,
      p.prevPos[1] + (p.curPos[1] - p.prevPos[1]) * a,
      p.prevPos[2] + (p.curPos[2] - p.prevPos[2]) * a,
    );
    const whoosh = p.stuck ? undefined : FLYBY[p.type];
    if (whoosh !== undefined) {
      b3.b3Body_GetLinearVelocity(_v, p.body);
      audio.flyby(p.curPos, _v, whoosh);
    }
    if (p.type === 'rocket' || p.type === 'bomb') {
      b3.b3Body_GetLinearVelocity(_v, p.body);
      orient(p, _v);
      const burning = p.type === 'rocket' && now - p.born < MOTOR.burn;
      const f = p.mesh.getObjectByName('flame');
      if (f) f.visible = burning;
      p.trail += dt;
      const every = burning ? 0.018 : p.type === 'rocket' ? 0.05 : 0.2;
      while (p.trail > every) { p.trail -= every; fx.smokeTrail([p.mesh.position.x, p.mesh.position.y, p.mesh.position.z]); }
      continue;
    }
    _qa.fromArray(p.prevRot); _qb.fromArray(p.curRot);
    p.mesh.quaternion.slerpQuaternions(_qa, _qb, a);
    if (p.type === 'charge' || p.type === 'cutter') {
      const l = p.mesh.getObjectByName('led');
      if (l) l.visible = Math.sin(now * (detonations.some(d => d.p === p) ? 60 : p === selected ? 30 : 9)) > 0;
    } else if (p.type === 'megabomb') {
      const l = p.mesh.getObjectByName('led');
      const left = p.armAt - now;
      if (l) l.visible = Math.sin(now * (left < 1.5 ? 70 : 12 + (MEGA.fuse - left) * 7)) > 0;
    } else if (p.type === 'thermite') {
      const c = p.mesh.getObjectByName('glow');
      if (c) {
        c.visible = p.lit;
        c.scale.setScalar(0.85 + Math.random() * 0.4);
      }
    } else if (p.type === 'bottle') {
      p.trail += dt;
      while (p.trail > 0.05) { p.trail -= 0.05; fx.flames([p.mesh.position.x, p.mesh.position.y + 0.17, p.mesh.position.z], 0.12, 0.8); }
    }
  }
  for (const s of sorties) {
    if (!s.mesh || now < s.t0) continue;
    planePos(s, _pp);
    s.mesh.position.set(_pp[0], _pp[1], _pp[2]);
    audio.flyby(_pp, [s.heading[0] * PLANE.v, 0, s.heading[2] * PLANE.v], 9);
  }
  syncCord();
  syncWrecker(alpha);
  syncWinch(alpha);
  syncWire();
  gravFlyby();
  syncMachining(alpha, dt);
  const cur = loadout.current;
  if (cur === 'breaker' || cur === 'hose' || cur === 'excavator') viewmodel.hold(workFrame >= frame - 1, cur === 'hose' ? (hoseFog() ? 0.5 : 1) : 0.8);
  preview();
  cables.flush();
  frame++;
}

/* ---------------- HUD readout ---------------- */

const mm = (m: number) => `${Math.round(m * 1000)} mm`;

/** What the tool in hand is doing, for the HUD. */
export function toolReadout(): ToolReadout | null {
  const cur = loadout.current;
  eyePosition(_eye, 1);
  if (isMachineTool(cur)) {
    const s = machiningStatus();
    const name = DEF[cur].name;
    if (!s) return { title: name, progress: null, detail: `hold LMB on a member · ${machineHint(cur)}`, warn: false };
    if (s.message && s.progress === 0) return { title: name, progress: null, detail: s.message, warn: true };
    const eta = Number.isFinite(s.eta) ? `${s.eta.toFixed(1)} s left` : 'stalled';
    const extra = s.tool === 'torch' && s.preheat < 1 ? ` · preheat ${Math.round(s.preheat * 100)}%` : s.tool === 'grinder' || s.tool === 'saw' ? ` · blade ${Math.round(s.blade)} °C` : '';
    return { title: name, progress: s.progress, detail: `${eta} · cut ${Math.round(s.temp)} °C${extra}${s.message ? ` · ${s.message}` : ''}`, warn: s.bound };
  }
  switch (cur) {
    case 'hammer': {
      const k = hammerWind();
      const last = lastBlow ? ` · last ${Math.round(lastBlow.energy)} J into ${lastBlow.mat ?? 'ground'}${lastBlow.chipped ? ' — chipped' : lastBlow.mat ? ` (${Math.round(lastBlow.progress * 100)}% to a chip)` : ''}` : '';
      return { title: `Sledgehammer · ${Math.round(sledgeEnergy(windAt < 0 ? 1 : k))} J`, progress: windAt < 0 ? null : k, detail: `hold to wind up, release to strike${last}`, warn: false };
    }
    case 'cannon': return { title: 'Hand cannon', progress: null, detail: '30 kg iron ball · 62 m/s · 57 kJ · drag and drop shown by the arc', warn: false };
    case 'rocket': return {
      title: `Rocket · ${warhead === 'tandem' ? 'tandem HEAT-FT' : 'HE-FRAG'}`, progress: null,
      detail: warhead === 'tandem'
        ? `perforates ~${mm(TANDEM.jet * Math.sqrt(TANDEM.rhoJet / 7850))} steel / ${mm(TANDEM.jet * Math.sqrt(TANDEM.rhoJet / 2400))} concrete, then ${TANDEM.follow} kg inside · RMB warhead · keep ${BACKBLAST.wall} m clear behind`
        : '1.25 kg HE at the surface · RMB warhead · mind the backblast',
      warn: false,
    };
    case 'charge': return { title: `Remote charge · ${chargeKg} kg`, progress: null, detail: `lethal radius ${blastOf(chargeKg).radius.toFixed(1)} m · wheel size · RMB/G detonate${chargesPlaced() ? ` (${chargesPlaced()} armed)` : ''} · delays on the Detonator Panel`, warn: false };
    case 'cutter': return { title: 'Linear cutting charge', progress: null, detail: 'the line shows the cut · severs the member along it · RMB/G detonate', warn: false };
    case 'thermite': return { title: 'Thermite pot', progress: null, detail: '2500 °C: melts through steel, cast iron, aluminium · chars timber · only spalls masonry', warn: false };
    case 'airstrike': return { title: 'Airstrike marker', progress: null, detail: `${PLANE.bombs} × 4 kg bombs onto the smoke${sorties.length ? ` · ${sorties.length} inbound` : ''}`, warn: sorties.length > 0 };
    case 'incendiary': return { title: 'Firebomb', progress: null, detail: `0.75 L petrol · ${FIRE.radius} m splash · pool burns ${FIRE.poolTime} s at ${FIRE.hrr / 1e6} MW`, warn: false };
    case 'megabomb': return { title: `Megabomb · ${MEGA.kg} kg`, progress: null, detail: `${MEGA.fuse} s fuse · lethal radius ${blastOf(MEGA.kg).radius.toFixed(0)} m · run`, warn: true };
    case 'wrecker': return wreckerStatus();
    case 'winch': return winchStatus();
    case 'gravgun': {
      const g = gravStatus();
      return g
        ? { title: `Gravity gun · ${(g.mass / 1000).toFixed(2)} t`, progress: clamp(g.mass / 2500, 0, 1), detail: `held at ${g.dist.toFixed(1)} m · lagging ${g.lag.toFixed(2)} m · wheel distance · RMB set down · LMB throw`, warn: g.lag > 2 }
        : { title: 'Gravity gun', progress: null, detail: 'lifts loose pieces up to 2.5 t · yanks small welded ones', warn: false };
    }
    case 'planner': {
      const list = armed();
      const span = list.length ? Math.max(...list.map(p => p.delay)) : 0;
      const sel = selected && list.includes(selected) ? ` · selected ${selected.delay} ms` : '';
      return {
        title: `Detonator panel · ${list.length} device${list.length === 1 ? '' : 's'}`,
        progress: firing && (now - firing.t0) * 1000 < firing.span + 200 ? clamp(((now - firing.t0) * 1000) / Math.max(firing.span, 1), 0, 1) : null,
        detail: `span ${span} ms${sel} · LMB device / auto-sequence toward aim · wheel ±${PLAN.step} ms (Shift ±${PLAN.big}) · RMB/G fire`,
        warn: false,
      };
    }
    case 'excavator': return excavatorStatus(_eye);
    case 'breaker': return breakerStatus() ?? { title: 'Hydraulic breaker', progress: null, detail: `hold LMB on concrete or masonry within ${BREAKER.reach} m`, warn: false };
    case 'hose': return hoseStatus();
    case 'splitter': return splitterStatus() ?? { title: 'Rock splitter', progress: null, detail: `LMB in a drilled bore · ${Math.round(SPLITTER.force / 9810)} t spreading force`, warn: false };
    case 'wiresaw': return wireStatus();
  }
  return null;
}

function machineHint(t: MachineTool): string {
  switch (t) {
    case 'grinder': return 'abrasive on steel, diamond on masonry';
    case 'saw': return 'timber only; pinches on the compression side';
    case 'drill': return 'bores weaken the section; the splitter works in them';
    case 'shears': return '200 t jaws: shear steel, crush concrete';
    case 'plasma': return 'conductive metal up to 50 mm';
    case 'torch': return 'preheat to 870 °C, then the oxygen cuts';
  }
}

export function clearWeapons(): void {
  for (const p of projectiles) {
    if (p.dead) continue;
    p.dead = true;
    scene.remove(p.mesh);
    p.mesh.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
  for (const s of sorties) if (s.mesh) scene.remove(s.mesh);
  for (const c of cord) cables.remove(c);
  cord.length = 0;
  projectiles.length = 0;
  swings.length = 0;
  detonations.length = 0;
  sorties.length = 0;
  patches.length = 0;
  fired.length = 0;
  selected = null;
  firing = null;
  windAt = -1;
  lastBlow = null;
  clearWrecker();
  clearWinch();
  clearGrav();
  clearMachining();
  clearPercussive();
  clearHose();
  clearSplitter();
  clearWire();
  clearExcavator();
  reelFrame = -9;
  workFrame = -9;
  marks.begin();
  marks.end();
}

let predicted: Vec3 | null = null;
/** Test view: where the aim arc says the shot lands, and what is in flight. */
export function weaponsDebug(): { predicted: Vec3 | null; strikes: Vec3[]; flying: { type: ProjType; pos: Vec3; vel: Vec3 }[] } {
  return {
    predicted,
    strikes: sorties.map(s => s.target),
    flying: projectiles.filter(p => !p.dead).map(p => {
      const v: Vec3 = [0, 0, 0];
      b3.b3Body_GetLinearVelocity(v, p.body);
      return { type: p.type, pos: [...p.curPos] as Vec3, vel: v };
    }),
  };
}

export function weaponTime(): number {
  return now;
}

export function weaponName(id: WeaponId): string {
  return DEF[id].name;
}
