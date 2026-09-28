import './styles.css';
import * as THREE from 'three';
import type { Blueprint, Contract, HudState, Settings, Vec3, WeaponId, ContractCard, ResultsView, SandboxSettings, SandboxAction, PrefabView } from './types';
import { MATS } from './destruction/materials';
import {
  b3, threads, setGravity, initPhysics, createWorld, step as physicsStep, stepCount, FIXED_DT, raycast, overlapAABB, CAT,
  type StepHandlers,
} from './physics/physics';
import {
  initStructures, buildBlueprint, clearStructures, demolitionFraction, totalValue, onHit, onJointBroken,
  afterStep, maintain, syncMeshes, setStructureHooks, stats, explode, ignite, live, specVolume, setXrayMode, xrayMode, updateXray,
  setJointStrength, setWind, setFireSpread, setDebrisLimit, startQuake, clearDebris, extinguish, setFrozen, quakeActive,
  spawnPieces, removeConnected, pieceOf, setServiceViewer,
} from './destruction/structure';
import { initXray } from './render/xray';
import { lightningStrike, setStorm, stormOn } from './destruction/electrical';
import { initGhost, ghost } from './render/ghost';
import { initAim } from './render/aim';
import { initCables, cables } from './render/cables';
import { initLampLights, lampLights, updateLampLights } from './render/lights';
import { initWater, updateWater, clearWaterMeshes } from './render/water';
import { initTerrainGfx, updateTerrainGfx } from './render/terrain';
import { stand } from './levels/maps/ground';
import { PREFABS, prefabView, type Prefab } from './levels/prefabs';
import {
  player, createPlayer, playerPreStep, playerPostStep, updateCamera, applyLook, toggleFly, addTrauma, kickFov,
  knockback, eyePosition, forward, respawn, teleport as teleportPlayer, setPlayerEnabled, vfov,
} from './game/player';
import {
  initWeapons, setLoadout, select, cycle, tryFire, detonate, weaponsPreStep, weaponsAfterStep, syncProjectiles,
  clearWeapons, weaponViews, chargesPlaced, liveOrdnance, rangedAmmoLeft, onProjectileHit, loadout, WEAPONS,
  setWeaponHooks, weaponName, BANK_COUNT, releaseFire, toolWheel, toolSecondary, toolReadout, timelineView,
} from './game/weapons';
import * as scoring from './game/scoring';
import { driving, vehicleNear, enterVehicle, exitVehicle, driveControls, driveLook, driveCamera, driveHud } from './vehicles/drive';
import { operating, machineNear, enterMachine, exitMachine, operateControls, operateLook, operateCamera, operateHud, vehicleGear, releaseVehicleGear } from './vehicles/operate';
import { svcInfo, svcNearestGate, svcOperate } from './destruction/services';
import { input, initInput, requestLock, releaseLock, endFrame } from './core/input';
import { loadSave, writeSave, type SaveData } from './core/save';
import { initRenderer, setQuality, setEnvironment, setShadowFocus, renderFrame, type Gfx } from './render/renderer';
import { initMaterials, getPieceMaterials } from './render/materials';
import { initRebar } from './render/rebar';
import { initFx, fx } from './render/fx';
import { initViewmodel, viewmodel } from './render/viewmodel';
import { buildScenery } from './render/scenery';
import { audio } from './audio/audio';
import * as ui from './ui/ui';
import { CONTRACTS, SANDBOX, SHOWCASE, DOWNTOWN } from './levels/contracts';

type State = 'loading' | 'title' | 'contracts' | 'briefing' | 'settings' | 'playing' | 'paused' | 'results';

let state: State = 'loading';
let settingsReturn: State = 'title';
let mode: 'campaign' | 'sandbox' = 'campaign';
let contractIdx = 0;
let active: Contract = SANDBOX;
let save: SaveData;
let gfx: Gfx;
let targetMetAt = -1;
let quietT = 0;
let lastDemo = 0;
let lastWon = false;
let stars2 = 0, stars3 = 0;
let hint: string | null = null;
let hintT = 0;
let fpsAvg = 60;
const perf = { phys: 0, render: 0, fx: 0, sync: 0 };

/* ---------------- level lifecycle ---------------- */

/* rAF lets the loading screen paint; the timeout covers hidden tabs where rAF never fires. */
const nextFrame = (): Promise<void> => new Promise(r => {
  const t = setTimeout(r, 60);
  requestAnimationFrame(() => { clearTimeout(t); setTimeout(r, 0); });
});
let loadSeq = 0;

async function loadLevel(c: Contract, label: string): Promise<boolean> {
  const seq = ++loadSeq;
  state = 'loading';
  ui.showHud(false);
  ui.showScreen('loading');
  ui.setLoading(0.15, label);
  await nextFrame();
  if (seq !== loadSeq) return false;
  if (operating.machine) exitMachine();
  clearStructures();
  clearWeapons();
  cancelSpawn();
  fx.clear();
  cables.clear();
  lampLights.clear();
  clearWaterMeshes();
  createWorld();
  applyWorld(WORLD_DEFAULTS);
  audio.setScene((o, t) => raycast(o, t, CAT.structure | CAT.ground)?.fraction ?? null);
  const bp = c.build();
  if ((c === SANDBOX || c === SHOWCASE || c === DOWNTOWN) && !save.settings.explosives) bp.pieces = bp.pieces.filter(p => !MATS[p.mat].explosive);
  const spawn = bp.spawn ?? { pos: [0, 0, 26] as Vec3, yaw: 0 };
  createPlayer(spawn.pos, spawn.yaw);
  setEnvironment(c.env);
  buildScenery(gfx.scene, c.env);
  ui.setLoading(0.3, 'Mixing materials');
  await nextFrame();
  for (const m of new Set(bp.pieces.map(p => p.mat))) getPieceMaterials(m);
  ui.setLoading(0.45, 'Surveying load paths');
  await nextFrame();
  if (seq !== loadSeq) return false;
  buildBlueprint(bp);
  ui.setLoading(1, 'Site secured');
  scoring.resetScore();
  setLoadout(c.ammo);
  active = c;
  targetMetAt = -1;
  quietT = 0;
  lastDemo = 0;
  [stars2, stars3] = starThresholds(c, totalValue());
  audio.setAmbience(c.env);
  return true;
}

async function showTitle(): Promise<void> {
  releaseLock();
  const pristine = state === 'contracts' || state === 'settings';
  if (!pristine) {
    mode = 'sandbox';
    if (!await loadLevel(SANDBOX, 'Preparing site')) return;
  }
  state = 'title';
  ui.showHud(false);
  viewmodel.setVisible(false);
  ui.showScreen('title');
  audio.setPaused(false);
}

function showContracts(): void {
  state = 'contracts';
  releaseLock();
  ui.showHud(false);
  ui.renderContracts(contractCards());
  ui.showScreen('contracts');
}

function contractCards(): ContractCard[] {
  return CONTRACTS.map((c, i) => {
    const pr = save.progress[c.id];
    const prev = i > 0 ? save.progress[CONTRACTS[i - 1].id] : undefined;
    return {
      index: i, id: c.id, name: c.name, location: c.location,
      stars: pr?.stars ?? 0, best: pr?.best ?? 0,
      locked: i > 0 && !(prev && prev.stars > 0),
    };
  });
}

function showBriefing(i: number): void {
  contractIdx = i;
  const c = CONTRACTS[i];
  state = 'briefing';
  const thresholds = starThresholds(c, blueprintValue(c.build()));
  ui.renderBriefing({
    index: i, name: c.name, location: c.location, brief: c.brief, target: c.target, par: c.par,
    stars: thresholds,
    ammo: WEAPONS.filter(w => c.ammo[w.id] !== undefined).map(w => ({ id: w.id, name: w.name, count: c.ammo[w.id]! })),
    protectedNote: c.protectedNote, env: c.env,
  });
  ui.showScreen('briefing');
}

async function startContract(i: number): Promise<void> {
  mode = 'campaign';
  contractIdx = i;
  requestLock();
  if (!await loadLevel(CONTRACTS[i], CONTRACTS[i].name)) return;
  beginPlay(CONTRACTS[i].name);
}

let freeSite: Contract = SANDBOX;
let bank = 0;
const WORLD_DEFAULTS: SandboxSettings = { timeScale: 1, gravity: 1, jointStrength: 1, wind: 0, fireSpread: true, debrisLimit: 1400 };
const sandbox: SandboxSettings = { ...WORLD_DEFAULTS };

function applyWorld(s: SandboxSettings): void {
  setGravity(s.gravity);
  setJointStrength(s.jointStrength);
  setWind(s.wind);
  const w = 0.6 + s.wind * 14;
  fx.setWind([w * 0.92, 0, w * 0.38]);
  setFireSpread(s.fireSpread);
  setDebrisLimit(s.debrisLimit);
}

function applySandbox(s: SandboxSettings): void {
  Object.assign(sandbox, s);
  applyWorld(sandbox);
}

function openSandboxPanel(): void {
  if (mode !== 'sandbox') return;
  ui.openSandboxPanel(sandbox);
  ui.setPointerHint(false);
  releaseLock();
}

/* ---------------- free-play spawning ---------------- */

interface Placing { prefab: Prefab; quarter: number; bounds: { c: Vec3; size: Vec3 }[] }
let placing: Placing | null = null;
let prefabViews: PrefabView[] | null = null;

function openSpawnPalette(): void {
  if (mode !== 'sandbox') return;
  ui.openSpawnPalette(prefabViews ??= PREFABS.map(prefabView));
  ui.setPointerHint(false);
  releaseLock();
}

/* World-aligned bounds of a prefab built at the origin, per quarter turn. */
function prefabBounds(p: Prefab, quarter: number): { c: Vec3; size: Vec3 } {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
  for (const s of p.build(0, 0, quarter)) {
    const sx = s.size[0] / 2, sz = (s.shape === 'cylinder' || s.shape === 'prism' ? s.size[0] : s.size[2]) / 2;
    const cs = Math.abs(Math.cos(s.rotY ?? 0)), sn = Math.abs(Math.sin(s.rotY ?? 0));
    const hx = cs * sx + sn * sz, hz = sn * sx + cs * sz;
    x0 = Math.min(x0, s.pos[0] - hx); x1 = Math.max(x1, s.pos[0] + hx);
    z0 = Math.min(z0, s.pos[2] - hz); z1 = Math.max(z1, s.pos[2] + hz);
    y1 = Math.max(y1, s.pos[1] + s.size[1] / 2);
  }
  return { c: [(x0 + x1) / 2, y1 / 2, (z0 + z1) / 2], size: [x1 - x0, y1, z1 - z0] };
}

function armSpawn(id: string | null): void {
  const prefab = id ? PREFABS.find(p => p.id === id) : undefined;
  if (!prefab) { cancelSpawn(); return; }
  placing = { prefab, quarter: placing?.quarter ?? 0, bounds: [0, 1, 2, 3].map(q => prefabBounds(prefab, q)) };
  flashHint(`${prefab.name} — LMB place · wheel rotate · RMB done`, 5);
}

function cancelSpawn(): void {
  placing = null;
  ghost.hide();
}

const _gc: Vec3 = [0, 0, 0];
let spawnOk = false;

/* Returns true while the placement tool owns the mouse. */
function updatePlacement(): boolean {
  if (!placing) return false;
  if (input.clicked & 4) { cancelSpawn(); return true; }
  if (input.wheel) placing.quarter = (placing.quarter + (input.wheel > 0 ? 1 : 3)) % 4;
  eyePosition(_eye, 1);
  forward(_fwd);
  const hit = raycast(_eye, [_fwd[0] * 160, _fwd[1] * 160, _fwd[2] * 160], CAT.ground | CAT.structure | CAT.debris | CAT.prop);
  if (!hit) { ghost.hide(); spawnOk = false; return true; }
  const x = Math.round(hit.point[0] * 2) / 2, z = Math.round(hit.point[2] * 2) / 2;
  const b = placing.bounds[placing.quarter];
  vec3Set(_gc, x + b.c[0], b.c[1], z + b.c[2]);
  spawnOk = Math.abs(x) < 360 && Math.abs(z) < 360 && siteClear(_gc, b.size);
  ghost.show(_gc, b.size, 0, spawnOk);
  if (input.clicked & 1) {
    if (spawnOk) {
      // stood on the terrain where it was aimed (a road lies a kerb below the footway)
      const gy = hit.entity?.kind === 'ground' ? hit.point[1] : 0;
      spawnPieces(stand(placing.prefab.build(x, z, placing.quarter), gy));
      audio.spawnPlace();
    } else {
      audio.ui('deny');
      flashHint('Blocked — something is in the way', 1.5);
    }
  }
  return true;
}

function siteClear(c: Vec3, size: Vec3): boolean {
  let blocked = false;
  const m = 0.08;
  overlapAABB(
    [c[0] - size[0] / 2 + m, 0.12, c[2] - size[2] / 2 + m],
    [c[0] + size[0] / 2 - m, size[1], c[2] + size[2] / 2 - m],
    CAT.structure | CAT.prop | CAT.player,
    () => { blocked = true; },
  );
  return !blocked;
}

function deleteAimed(): void {
  eyePosition(_eye, 1);
  forward(_fwd);
  const hit = raycast(_eye, [_fwd[0] * 160, _fwd[1] * 160, _fwd[2] * 160], CAT.structure | CAT.debris | CAT.prop);
  const p = hit ? pieceOf(hit.entity) : null;
  if (!p) { audio.ui('deny'); return; }
  const n = removeConnected(p);
  audio.ui('click');
  flashHint(`Removed ${n} piece${n === 1 ? '' : 's'}`, 1.5);
}

function vec3Set(o: Vec3, x: number, y: number, z: number): Vec3 { o[0] = x; o[1] = y; o[2] = z; return o; }

function sandboxAction(a: SandboxAction): void {
  switch (a) {
    case 'quake': startQuake(9, 1); flashHint('EARTHQUAKE', 3); break;
    case 'clearDebris': flashHint(`Cleared ${clearDebris()} fragments`, 2); break;
    case 'rebuild': restart(); break;
    case 'extinguish': extinguish(); flashHint('Fires out', 2); break;
    case 'freezeAll': setFrozen(true); flashHint('Everything frozen', 2); break;
    case 'unfreezeAll': setFrozen(false); flashHint('Unfrozen', 2); break;
    case 'lightning': eyePosition(_eye, 1); lightningStrike({ at: [..._eye], spread: 60 }); flashHint('LIGHTNING', 2); break;
    case 'storm': setStorm(!stormOn()); flashHint(stormOn() ? 'THUNDERSTORM' : 'STORM PASSES', 2); break;
  }
}

async function startSandbox(site: Contract = SANDBOX): Promise<void> {
  requestLock();
  mode = 'sandbox';
  freeSite = site;
  if (!await loadLevel(site, site.name)) return;
  applyWorld(sandbox);
  beginPlay(site.name);
}

function beginPlay(title: string): void {
  state = 'playing';
  ui.showScreen(null);
  ui.showHud(true);
  ui.setHudTitle(title);
  viewmodel.setVisible(true);
  viewmodel.setWeapon(loadout.current);
  audio.setPaused(false);
  if (!input.locked) requestLock();
  ui.setPointerHint(!input.locked);
  flashHint(mode === 'sandbox' ? 'F — fly · R — rebuild site' : `Target ${Math.round(active.target * 100)}% · Enter — call it early`, 5);
  ui.toast(title.toUpperCase(), 'info', 1800);
}

function restart(): void {
  if (mode === 'campaign') void startContract(contractIdx);
  else void startSandbox(freeSite);
}

function pause(): void {
  if (state !== 'playing') return;
  state = 'paused';
  audio.setPaused(true);
  ui.showScreen('pause');
}

function resume(): void {
  if (state !== 'paused') return;
  state = 'playing';
  ui.showScreen(null);
  audio.setPaused(false);
  requestLock();
}

function finish(won: boolean): void {
  if (state !== 'playing') return;
  state = 'results';
  lastWon = won;
  releaseLock();
  ui.showHud(false);
  viewmodel.setVisible(false);
  const c = active;
  const pct = demolitionFraction();
  const raw = scoring.score.points + scoring.score.penalty;
  const rows: ResultsView['rows'] = [{ label: `Demolition — ${Math.round(pct * 100)}%`, value: raw }];
  if (scoring.score.penalty > 0) rows.push({ label: 'Property damage', value: -scoring.score.penalty });
  let total = scoring.score.points;
  if (won) {
    /* bonuses scale with the site's value so stars mean the same thing on a shed and a tower block */
    const v = totalValue();
    const timeBonus = Math.round(v * 0.5 * Math.max(0, 1 - scoring.score.elapsed / c.par));
    const worth: Record<WeaponId, number> = {
      hammer: 0, cannon: 1, rocket: 2, charge: 2, airstrike: 5, thermite: 2, cutter: 2, wrecker: 3, winch: 1, gravgun: 0, incendiary: 1, megabomb: 8,
      grinder: 1, saw: 1, drill: 1, shears: 1, plasma: 2, torch: 2, planner: 0, excavator: 1, breaker: 1, hose: 0, splitter: 1, wiresaw: 2,
    };
    let spare = 0, issued = 0;
    for (const w of WEAPONS) {
      const n = c.ammo[w.id], a = loadout.ammo[w.id];
      if (n === undefined || n <= 0 || a === undefined) continue;
      issued += n * worth[w.id];
      spare += Math.max(0, a) * worth[w.id];
    }
    const ammoBonus = issued > 0 ? Math.round((v * 0.35 * spare) / issued) : 0;
    const chainBonus = scoring.score.bestChain >= 10 ? Math.round(v * 0.004 * scoring.score.bestChain) : 0;
    rows.push({ label: 'Under par', value: timeBonus });
    rows.push({ label: 'Unused ordnance', value: ammoBonus });
    if (chainBonus) rows.push({ label: `Longest chain ×${scoring.score.bestChain}`, value: chainBonus });
    total += timeBonus + ammoBonus + chainBonus;
  }
  total = Math.max(0, total);
  let stars = 0;
  let newBest = false;
  const firstClear = won && !(save.progress[c.id]?.stars);
  if (won) {
    stars = total >= stars3 ? 3 : total >= stars2 ? 2 : 1;
    const pr = save.progress[c.id] ?? { stars: 0, best: 0 };
    newBest = total > pr.best;
    save.progress[c.id] = { stars: Math.max(pr.stars, stars), best: Math.max(pr.best, total) };
    writeSave(save);
    audio.ui('win');
  } else {
    audio.ui('lose');
  }
  ui.renderResults({
    won,
    title: won ? 'Contract complete' : 'Contract failed',
    subtitle: won
      ? `${c.name} — ${Math.round(pct * 100)}% down in ${fmtTime(scoring.score.elapsed)} · ★★ ${stars2.toLocaleString()} · ★★★ ${stars3.toLocaleString()}`
      : `${c.name} — ${Math.round(pct * 100)}% of ${Math.round(c.target * 100)}% required`,
    rows, total, stars, newBest,
    hasNext: won && contractIdx < CONTRACTS.length - 1,
    unlockText: firstClear ? c.unlockText : undefined,
  });
  ui.showScreen('results');
}

function blueprintValue(bp: Blueprint): number {
  let v = 0;
  for (const p of bp.pieces) {
    if (p.protected) continue;
    v += specVolume(p) * MATS[p.mat].value;
  }
  return v;
}

/* Stars scale with the site's worth so they mean the same on a shed and a tower block. */
function starThresholds(c: Contract, v: number): [number, number] {
  if (c.stars[0] > 0) return c.stars;
  return [
    Math.round((v * (c.target * 1.3 + 0.25)) / 50) * 50,
    Math.round((v * (Math.min(1, c.target + 0.25) * 1.6 + 0.45)) / 50) * 50,
  ];
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function flashHint(text: string, seconds: number): void {
  hint = text;
  hintT = seconds;
}

/* ---------------- per-frame gameplay ---------------- */

const handlers: StepHandlers = {
  hit(a, b, point, normal, speed) {
    onHit(a, b, point, normal, speed);
    onProjectileHit(a, b, point, speed);
  },
  begin() {},
  jointBroken(id) { onJointBroken(id); },
};

let frameDt = 1 / 60;

/* E takes the nearest vehicle's wheel or machine's controls (whichever is closer) and leaves them again; while
   driving or operating, keys and mouse go to it. */
function handleDriving(): boolean {
  if (input.pressed.has('KeyE')) {
    if (driving.vehicle || operating.machine) {
      if (driving.vehicle) releaseVehicleGear(driving.vehicle.chassis);
      const at = driving.vehicle ? exitVehicle() : exitMachine();
      setPlayerEnabled(true);
      if (at) teleportPlayer(at);
      return true;
    }
    eyePosition(_eye, 1);
    const v = vehicleNear(_eye), m = machineNear(_eye);
    const dv = v ? Math.hypot(v.chassis.curPos[0] - _eye[0], v.chassis.curPos[2] - _eye[2]) : Infinity;
    if (v && (!m || dv <= m.d + 1)) { enterVehicle(v); setPlayerEnabled(false); cancelSpawn(); return true; }
    if (m) { enterMachine(m.m); setPlayerEnabled(false); cancelSpawn(); flashHint(`At the controls: ${m.m.name}`, 2); return true; }
  }
  if (operating.machine) {
    operateControls(input.down, frameDt);
    if (input.mouseDX || input.mouseDY) operateLook(input.mouseDX * 0.002 * player.sensitivity, -input.mouseDY * 0.002 * player.sensitivity);
    return true;
  }
  if (!driving.vehicle) return false;
  driveControls(input.down, input.pressed, frameDt);
  gearHint = vehicleGear(driving.vehicle.chassis, input.down);
  if (input.mouseDX || input.mouseDY) driveLook(-input.mouseDX * 0.002 * player.sensitivity, -input.mouseDY * 0.002 * player.sensitivity);
  return true;
}
let gearHint: string | null = null;

/* U works the service gear in front of the player: a breaker, fuse, valve (a buried one through its surface box),
   meter or standby set within reach. */
function useService(): void {
  eyePosition(_eye, 1);
  forward(_fwd);
  const hit = raycast(_eye, [_fwd[0] * 4, _fwd[1] * 4, _fwd[2] * 4], CAT.ground | CAT.structure | CAT.debris | CAT.prop);
  const p = hit ? pieceOf(hit.entity) : null;
  const g = p?.svc && svcInfo(p)?.action ? p : hit ? svcNearestGate(hit.point, 1.2) : null;
  const msg = g ? svcOperate(g) : null;
  if (!msg) { audio.ui('deny'); flashHint('Nothing here to operate — aim at a breaker, valve, meter or valve box', 1.5); return; }
  flashHint(msg, 2.5);
}

/* What the crosshair is on, if it is a service: its readout for the HUD. */
let svcHint: string | null = null;
function aimService(): void {
  svcHint = null;
  eyePosition(_eye, 1);
  forward(_fwd);
  const hit = raycast(_eye, [_fwd[0] * 6, _fwd[1] * 6, _fwd[2] * 6], CAT.ground | CAT.structure | CAT.debris | CAT.prop);
  if (!hit) return;
  const p = pieceOf(hit.entity);
  const q = p?.svc ? p : svcNearestGate(hit.point, 1.2);
  const info = q ? svcInfo(q) : null;
  if (info) svcHint = `${info.title} · ${info.detail}${info.action ? ` · U — ${info.action}` : ''}`;
}

let fireHeld = false;

function handleInput(): void {
  if (handleDriving()) return;
  if (input.mouseDX || input.mouseDY) applyLook(input.mouseDX, input.mouseDY);
  if (input.pressed.has('KeyQ')) { bank = (bank + 1) % BANK_COUNT; audio.ui('click'); }
  for (let k = 1; k <= 6; k++) {
    if (!input.pressed.has(`Digit${k}`)) continue;
    const w = WEAPONS[bank * 6 + k - 1];
    if (w) { select(w.id); cancelSpawn(); }
  }
  if (!updatePlacement()) {
    // the wheel sets the tool's own parameter where it has one (scroll up = more), else cycles tools
    if (input.wheel && !toolWheel(input.wheel > 0 ? -1 : 1)) cycle(input.wheel > 0 ? 1 : -1);
    if (input.buttons & 1) tryFire();
    else if (fireHeld) releaseFire();
    fireHeld = (input.buttons & 1) !== 0;
    const rmb = (input.clicked & 4) !== 0 && !toolSecondary();
    if (rmb || input.pressed.has('KeyG')) {
      if (detonate()) flashHint('Detonating', 1);
      else if (loadout.current === 'charge' || loadout.current === 'planner') flashHint('No charges placed', 1.5);
    }
  }
  if (input.pressed.has('Tab')) openSandboxPanel();
  if (input.pressed.has('KeyB')) openSpawnPalette();
  if ((input.pressed.has('Backspace') || input.pressed.has('Delete')) && mode === 'sandbox') deleteAimed();
  if (input.pressed.has('KeyR')) restart();
  if (input.pressed.has('KeyF') && mode === 'sandbox') flashHint(toggleFly() ? 'Fly mode — Space up, C down' : 'Fly mode off', 2);
  if (input.pressed.has('Enter') && mode === 'campaign') finish(demolitionFraction() >= active.target);
  if (input.pressed.has('KeyP')) respawn();
  if (input.pressed.has('KeyU')) useService();
  if (input.pressed.has('KeyX')) {
    const next = ({ off: 'stress', stress: 'thermal', thermal: 'services', services: 'fields', fields: 'off' } as const)[xrayMode()];
    setXrayMode(next);
    audio.ui('click');
    ui.toast({ off: 'X-RAY OFF', stress: 'X-RAY · JOINT STRESS', thermal: 'X-RAY · THERMAL', services: 'X-RAY · SERVICES', fields: 'X-RAY · GAS, SMOKE & HEAT FIELDS' }[next], 'info', 1400);
  }
}

function checkContract(dt: number): void {
  if (mode !== 'campaign') return;
  const pct = demolitionFraction();
  if (pct > lastDemo + 0.002) { lastDemo = pct; quietT = 0; } else quietT += dt;
  if (pct >= active.target) {
    if (targetMetAt < 0) {
      targetMetAt = scoring.score.elapsed;
      audio.ui('target');
      ui.toast('TARGET MET — keep going for score, Enter to wrap up', 'good', 3500);
    }
    const since = scoring.score.elapsed - targetMetAt;
    if ((since > 6 && quietT > 2.5 && scoring.score.comboTimer <= 0) || since > 25) finish(true);
    return;
  }
  if (rangedAmmoLeft() === 0 && liveOrdnance() === 0) {
    if (loadout.ammo.hammer !== undefined) {
      if (quietT > 3) flashHint('Out of ordnance — keep swinging or Enter to call it', 0.5);
    } else if (quietT > 5) {
      finish(false);
    }
  }
}

const _eye: Vec3 = [0, 0, 0], _fwd: Vec3 = [0, 0, 0];
const _ce: Vec3 = [0, 0, 0], _cl: Vec3 = [0, 0, 0];
const hud: HudState = {
  demolition: 0, target: null, score: 0, combo: 1, comboTime: 0, time: 0, par: null, weapon: 'hammer',
  weapons: [], bank: 0, timeScale: 1, chargesPlaced: 0, penalty: 0, hint: null, fps: 60, tool: null, timeline: null,
};

let nearVehicle = false, nearMachine = false, nearT = 0;
function updateHudState(): void {
  if (++nearT % 10 === 0) {
    eyePosition(_eye, 1);
    const free = !driving.vehicle && !operating.machine;
    nearVehicle = free && !!vehicleNear(_eye);
    nearMachine = free && !nearVehicle && !!machineNear(_eye);
    if (free) aimService(); else svcHint = null;
  }
  hud.demolition = demolitionFraction();
  hud.target = mode === 'campaign' ? active.target : null;
  hud.score = scoring.score.points;
  hud.combo = scoring.comboMult();
  hud.comboTime = scoring.comboFraction();
  hud.time = scoring.score.elapsed;
  hud.par = mode === 'campaign' ? active.par : null;
  hud.weapon = loadout.current;
  hud.weapons = weaponViews();
  hud.bank = bank;
  hud.timeScale = mode === 'sandbox' ? sandbox.timeScale : 1;
  hud.chargesPlaced = chargesPlaced();
  hud.penalty = scoring.score.penalty;
  const dh = driving.vehicle ? driveHud() : null;
  const oh = operateHud();
  hud.hint = hintT > 0 ? hint
    : oh ? oh
    : dh ? `${Math.round(dh.kmh)} km/h · ${dh.gear < 0 ? 'R' : dh.gear === 0 ? 'N' : dh.gear} · ${Math.round(dh.rpm)} rpm${dh.flat ? ` · ${dh.flat} flat` : ''} · W/S drive · Space handbrake · C view${gearHint ? ` · ${gearHint}` : ''} · E exit`
    : nearVehicle ? 'E — drive'
    : nearMachine ? 'E — operate'
    : svcHint ? svcHint
    : xrayMode() === 'stress' ? 'X-RAY · joints: green idle · yellow loaded · red at capacity · magenta yielding · X to cycle'
    : xrayMode() === 'thermal' ? 'X-RAY · thermal: blue ambient → purple → orange 500 °C → white 1000 °C · X to cycle'
    : xrayMode() === 'fields' ? 'X-RAY · fields: temperature, smoke and fuel gas around the action · X to cycle'
    : xrayMode() === 'services' ? 'X-RAY · services: yellow power · orange gas · blue water · white steam · grey dead · pulsing = live break · green = running machine'
    : hud.chargesPlaced > 0 ? `${hud.chargesPlaced} charge${hud.chargesPlaced > 1 ? 's' : ''} armed — G${loadout.current === 'charge' || loadout.current === 'cutter' || loadout.current === 'planner' ? ' / right-click' : ''} to detonate` : null;
  hud.fps = Math.round(fpsAvg);
  hud.tool = driving.vehicle || operating.machine ? null : toolReadout();
  hud.timeline = timelineView();
}

let acc = 0;
let last = performance.now();
let orbitT = 0;
let rafId = 0;
let timeoutId: ReturnType<typeof setTimeout> | undefined;

/* rAF when visible; a timeout keeps the simulation honest when the tab is hidden or headless. */
function loop(): void {
  cancelAnimationFrame(rafId);
  clearTimeout(timeoutId);
  rafId = requestAnimationFrame(loop);
  timeoutId = setTimeout(loop, 100);
  const nowT = performance.now();
  const dt = Math.min(0.1, (nowT - last) / 1000);
  last = nowT;
  if (dt <= 0) return;
  try { frame(dt); } catch (err) { console.error(err); }
}

function frame(dt: number): void {
  fpsAvg += (1 / dt - fpsAvg) * 0.05;
  hintT -= dt;
  const cam = gfx.camera;

  if (state === 'playing') {
    frameDt = dt;
    handleInput();
    acc += dt * (mode === 'sandbox' ? sandbox.timeScale : 1);
    let steps = 0;
    const tp = performance.now();
    while (acc >= FIXED_DT && steps < 4) {
      if (!driving.vehicle && !operating.machine) { playerPreStep(FIXED_DT); weaponsPreStep(); }
      physicsStep(handlers);
      afterStep(FIXED_DT);
      weaponsAfterStep(FIXED_DT);
      playerPostStep();
      scoring.tickScore(FIXED_DT);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === 4) acc = Math.min(acc, FIXED_DT);
    perf.phys += (performance.now() - tp - perf.phys) * 0.1;
    const alpha = acc / FIXED_DT;
    const ts = performance.now();
    syncMeshes(alpha);
    maintain(dt);
    syncProjectiles(alpha, dt);
    perf.sync += (performance.now() - ts - perf.sync) * 0.1;
    checkContract(dt);
    updateCamera(cam, alpha, dt);
    if (driveCamera(alpha, _ce, _cl) || operateCamera(_ce, _cl)) { cam.position.set(_ce[0], _ce[1], _ce[2]); cam.lookAt(_cl[0], _cl[1], _cl[2]); }
    updateXray(dt);
    setServiceViewer([cam.position.x, cam.position.y, cam.position.z]);
    viewmodel.update(dt, { move: player.move, grounded: player.grounded, sprint: player.sprint, lookDelta: player.lookDelta });
    player.lookDelta[0] = player.lookDelta[1] = 0;
  } else if (state === 'title' || state === 'contracts' || state === 'briefing' || (state === 'settings' && settingsReturn !== 'paused') || state === 'loading') {
    orbitT += dt * 0.05;
    const r = 34;
    cam.position.set(Math.sin(orbitT) * r, 11 + Math.sin(orbitT * 0.7) * 2, Math.cos(orbitT) * r);
    cam.lookAt(0, 5, 0);
  }

  const inPlay = state === 'playing' || state === 'paused';
  audio.quake(inPlay && quakeActive() ? 1 : 0);
  audio.wind(inPlay && mode === 'sandbox' ? sandbox.wind : 0);
  if (inPlay) {
    eyePosition(_eye, 1);
    setShadowFocus([_eye[0] + forward(_fwd)[0] * 18, 0, _eye[2] + _fwd[2] * 18]);
    audio.setListener([cam.position.x, cam.position.y, cam.position.z], forward(_fwd));
    updateHudState();
    ui.updateHud(hud, dt);
  } else {
    setShadowFocus([0, 0, 0]);
    audio.setListener([cam.position.x, cam.position.y, cam.position.z], [-cam.position.x, 0, -cam.position.z]);
  }

  const tr = performance.now();
  fx.update(dt);
  updateLampLights(dt);
  updateWater();
  updateTerrainGfx(cam.position);
  const tf = performance.now();
  renderFrame(dt);
  const te = performance.now();
  perf.fx += (tf - tr - perf.fx) * 0.1;
  perf.render += (te - tf - perf.render) * 0.1;
  endFrame();
}

/* ---------------- wiring ---------------- */

function applySettings(s: Settings): void {
  const rebuild = s.explosives !== save.settings.explosives && mode === 'sandbox';
  save.settings = { ...s };
  if (rebuild) flashHint(`Sandbox explosives ${s.explosives ? 'on' : 'off'} — R to rebuild the site`, 4);
  writeSave(save);
  audio.setVolume(s.volume);
  setQuality(s.quality);
  player.sensitivity = s.sensitivity;
  player.invertY = s.invertY;
  player.baseFov = s.fov;
}

function wire(): void {
  setStructureHooks(
    (pos, radius) => {
      eyePosition(_eye, 1);
      const d = Math.hypot(pos[0] - _eye[0], pos[1] - _eye[1], pos[2] - _eye[2]);
      const k = Math.max(0, 1 - d / (radius * 6));
      if (k <= 0) return;
      addTrauma(k * k * 0.9);
      kickFov(k * 10);
      if (d < radius * 1.6) {
        const close = 1 - d / (radius * 1.6);
        ui.blastVignette(close);
        audio.setMuffle(close);
        knockback(0.25 + close * 0.4);
      }
    },
    () => ui.toast('PROPERTY DAMAGE — penalty applied', 'bad', 2600),
  );
  scoring.setScoreHooks(
    (pts, label) => ui.scorePop(pts, label),
    () => {},
  );
  setWeaponHooks(msg => flashHint(msg, 1.8));
}

async function boot(): Promise<void> {
  save = loadSave();
  ui.initUI({
    onCampaign: () => showContracts(),
    onSandbox: () => void startSandbox(SANDBOX),
    onShowcase: () => void startSandbox(SHOWCASE),
    onDowntown: () => void startSandbox(DOWNTOWN),
    onPickContract: i => showBriefing(i),
    onStartContract: () => void startContract(contractIdx),
    onBack: () => {
      if (state === 'contracts') void showTitle();
      else if (state === 'briefing') showContracts();
      else if (state === 'settings') {
        state = settingsReturn;
        ui.showScreen(settingsReturn === 'paused' ? 'pause' : 'title');
      }
    },
    onResume: () => resume(),
    onRestart: () => restart(),
    onQuit: () => void showTitle(),
    onNext: () => { if (lastWon && contractIdx < CONTRACTS.length - 1) showBriefing(contractIdx + 1); },
    onRetry: () => restart(),
    onOpenSettings: () => {
      settingsReturn = state === 'paused' ? 'paused' : 'title';
      state = 'settings';
      ui.showScreen('settings');
    },
    onSettingsChange: s => applySettings(s),
    onUserGesture: () => { void audio.resume(); },
    onSandboxChange: s => applySandbox(s),
    onSandboxAction: a => sandboxAction(a),
    onSpawnPick: id => armSpawn(id),
    onOverlayClosed: () => {
      if (state !== 'playing') return;
      requestLock();
      ui.setPointerHint(!input.locked);
    },
  }, save.settings);
  ui.showScreen('loading');
  ui.setLoading(0.05, 'Starting renderer');

  gfx = initRenderer(ui.getViewport(), save.settings.quality);
  initMaterials(gfx.renderer, save.settings.quality);
  initRebar(gfx.scene);
  initCables(gfx.scene);
  initLampLights(gfx.scene);
  initWater(gfx.scene);
  initTerrainGfx(gfx.scene);
  initGhost(gfx.scene);
  initAim(gfx.scene);
  initXray(gfx.scene);
  initFx(gfx.scene, gfx.camera);
  initViewmodel();
  viewmodel.setVisible(false);
  audio.init();
  audio.setVolume(save.settings.volume);
  player.sensitivity = save.settings.sensitivity;
  player.invertY = save.settings.invertY;
  player.baseFov = save.settings.fov;
  gfx.camera.fov = vfov(save.settings.fov);
  gfx.camera.updateProjectionMatrix();

  ui.setLoading(0.1, 'Loading Box3D');
  await initPhysics();
  initStructures(gfx.scene);
  initWeapons(gfx.scene);
  initInput(gfx.renderer.domElement, locked => {
    if (ui.overlayOpen()) return;
    ui.setPointerHint(state === 'playing' && !locked);
    if (!locked && state === 'playing') pause();
  }, () => {
    if (state === 'playing' && !ui.overlayOpen()) ui.setPointerHint(true);
  });
  gfx.renderer.domElement.addEventListener('click', () => { if (state === 'playing' && !input.locked) requestLock(); });
  wire();
  loop();
  await showTitle();
}

/* Playtest hooks (dev server only): drive the game without pointer lock. */
declare global { interface Window { __dv: unknown } }
if (import.meta.env.DEV) window.__dv = {
  get state() { return state; },
  get stats() { return { ...stats(), demolition: demolitionFraction(), score: scoring.score.points, step: stepCount, fps: Math.round(fpsAvg) }; },
  get player() { return player; },
  start: (i: number) => startContract(i),
  sandbox: () => startSandbox(SANDBOX),
  showcase: () => startSandbox(SHOWCASE),
  downtown: () => startSandbox(DOWNTOWN),
  look: (dx: number, dy: number) => applyLook(dx, dy),
  fire: () => tryFire(),
  select: (id: WeaponId) => select(id),
  detonate: () => detonate(),
  setPlaying: () => { if (state === 'paused') { state = 'playing'; ui.showScreen(null); } },
  get perf() { return { phys: +perf.phys.toFixed(2), render: +perf.render.toFixed(2), fx: +perf.fx.toFixed(2), sync: +perf.sync.toFixed(2), calls: gfx.renderer.info.render.calls, tris: gfx.renderer.info.render.triangles }; },
  spawnPrefab: (id: string, x: number, z: number, quarter = 0) => {
    const prefab = PREFABS.find(p => p.id === id);
    if (!prefab) throw Error(`Unknown prefab: ${id}`);
    return spawnPieces(prefab.build(x, z, quarter));
  },
  removeConnected: (piece: Parameters<typeof removeConnected>[0]) => removeConnected(piece),
  teleport: (x: number, y: number, z: number, yaw = player.yaw, pitch = 0) => teleportPlayer([x, y, z], yaw, pitch),
  hint: (v: boolean) => ui.setPointerHint(v),
  xray: (m?: 'off' | 'stress' | 'thermal' | 'services' | 'fields') => { if (m) setXrayMode(m); return xrayMode(); },
  get scene() { return gfx.scene; },
  get threads() { return { threads, isolated: globalThis.crossOriginIsolated }; },
  boom: (x: number, y: number, z: number, r = 5) => explode([x, y, z], r, 90e3, 3200),
  ignite: (x: number, y: number, z: number, r = 1.5) => { let n = 0; for (const p of live) if (Math.hypot(p.curPos[0] - x, p.curPos[1] - y, p.curPos[2] - z) < r) { ignite(p); n++; } return n; },
  finish: (won?: boolean) => finish(won ?? demolitionFraction() >= active.target),
  THREE,
  weaponName,
};

boot().catch(err => {
  console.error('boot failed', err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;color:#f66;background:#111;z-index:99;white-space:pre-wrap';
  pre.textContent = `Failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
  document.body.appendChild(pre);
});
