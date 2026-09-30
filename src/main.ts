import './styles.css';
import * as THREE from 'three';
import type { Blueprint, Contract, HudState, Settings, Vec3, WeaponId, ContractCard, ResultsView, SandboxSettings, SandboxAction, PrefabView } from './types';
import { MATS } from './destruction/materials';
import {
  b3, threads, setGravity, initPhysics, createWorld, step as physicsStep, stepCount, FIXED_DT, raycast, overlapAABB, CAT,
  type StepHandlers,
} from './physics/physics';
import {
  initStructures, buildBlueprint, clearStructures, demolitionFraction, onHit, onJointBroken,
  afterStep, maintain, syncMeshes, setStructureHooks, stats, explode, ignite, live, specVolume, setXrayMode, xrayMode, updateXray,
  setJointStrength, setWind, setFireSpread, setDebrisLimit, startQuake, clearDebris, extinguish, setFrozen, quakeActive,
  spawnPieces, removeConnected, pieceOf, setServiceViewer, setDetailQuality, kinetic,
} from './destruction/structure';
import { initXray } from './render/xray';
import { lightningStrike, setStorm, stormOn } from './destruction/electrical';
import { initGhost, ghost } from './render/ghost';
import { initAim, aim as marks } from './render/aim';
import { replay } from './render/replay';
import { tags } from './render/tags';
import { hitstop, simScale, toggleBulletTime, bulletTime, resetTime } from './game/timefx';
import { initGuards, setGuards, guardAt, flagGuard, updateGuards, type Guarded } from './render/guard';
import { initCables, cables } from './render/cables';
import { initLampLights, lampLights, updateLampLights } from './render/lights';
import { initWater, updateWater, clearWaterMeshes } from './render/water';
import { initTerrainGfx, updateTerrainGfx } from './render/terrain';
import { terrainStep } from './terrain/terrain';
import { stand } from './levels/maps/ground';
import { PREFABS, prefabView, type Prefab } from './levels/prefabs';
import {
  player, createPlayer, playerPreStep, playerPostStep, updateCamera, applyLook, toggleFly, addTrauma, kickFov,
  knockback, eyePosition, forward, respawn, teleport as teleportPlayer, setPlayerEnabled, vfov,
} from './game/player';
import {
  initWeapons, setLoadout, select, cycle, tryFire, detonate, weaponsPreStep, weaponsAfterStep, syncProjectiles,
  clearWeapons, weaponViews, chargesPlaced, liveOrdnance, rangedAmmoLeft, onProjectileHit, loadout, WEAPONS,
  setWeaponHooks, weaponName, BANK_COUNT, releaseFire, toolWheel, toolSecondary, toolReadout, timelineView, weaponsDebug,
  devices, setDelay, fired,
} from './game/weapons';
import * as scoring from './game/scoring';
import { driving, vehicleNear, enterVehicle, exitVehicle, driveControls, driveLook, driveCamera, driveHud } from './vehicles/drive';
import { operating, machineNear, enterMachine, exitMachine, operateControls, operateLook, operateCamera, operateHud, vehicleGear, releaseVehicleGear } from './vehicles/operate';
import { svcInfo, svcNearestGate, svcOperate } from './destruction/services';
import { input, initInput, requestLock, releaseLock, endFrame } from './core/input';
import { loadSave, writeSave, WORLD_DEFAULTS, type SaveData } from './core/save';
import {
  initRenderer, setQuality, setEnvironment, setShadowFocus, renderFrame, setRenderScale, setPostFx, onDetailTier, renderStats, type Gfx,
} from './render/renderer';
import { initMaterials, getPieceMaterials } from './render/materials';
import { initRebar } from './render/rebar';
import { initFx, fx } from './render/fx';
import { initViewmodel, viewmodel, tuneViewmodel } from './render/viewmodel';
import { buildScenery } from './render/scenery';
import { audio } from './audio/audio';
import * as ui from './ui/ui';
import { CONTRACTS, SANDBOX, SHOWCASE, DOWNTOWN, RAILWAY, type Job } from './levels/contracts';

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
/** what the active contract's fee is reckoned on: its target groups' worth, or the whole site's */
let siteValue = 0;
let hint: string | null = null;
let hintT = 0;
let fpsAvg = 60;
const perf = { phys: 0, render: 0, fx: 0, sync: 0, rec: 0 };
let recMs = 0;
/** how fast the world runs this frame (bullet time, hitstop, replay speed): particles and the viewmodel follow it */
let fxScale = 1;

/* ---------------- level lifecycle ---------------- */

/* rAF lets the loading screen paint; the timeout covers hidden tabs where rAF never fires. */
const nextFrame = (): Promise<void> => new Promise(r => {
  const t = setTimeout(r, 60);
  requestAnimationFrame(() => { clearTimeout(t); setTimeout(r, 0); });
});
let loadSeq = 0;

/* `backdrop`: build the site behind whatever menu is showing, without the loading screen (the title's scenery). */
async function loadLevel(c: Contract, label: string, backdrop = false): Promise<boolean> {
  const seq = ++loadSeq;
  if (!backdrop) {
    state = 'loading';
    ui.showHud(false);
    ui.showScreen('loading');
  }
  ui.setLoading(0.15, label);
  await nextFrame();
  if (seq !== loadSeq) return false;
  if (operating.machine) exitMachine();
  endReplay();
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
  if ((c === SANDBOX || c === SHOWCASE || c === DOWNTOWN || c === RAILWAY) && !save.settings.explosives) bp.pieces = bp.pieces.filter(p => !MATS[p.mat].explosive);
  const spawn = bp.spawn ?? { pos: [0, 0, 26] as Vec3, yaw: 0 };
  createPlayer(spawn.pos, spawn.yaw);
  setEnvironment(c.env);
  buildScenery(gfx.scene, c.env, bp.terrain?.half);
  ui.setLoading(0.3, 'Mixing materials');
  await nextFrame();
  for (const m of new Set(bp.pieces.map(p => p.mat))) getPieceMaterials(m);
  ui.setLoading(0.45, 'Surveying load paths');
  await nextFrame();
  if (seq !== loadSeq) return false;
  buildBlueprint(bp);
  guards = guardsOf(bp);
  setGuards(guards);
  const goal = goalOf(c);
  scoring.setGoal(goal, bp.pieces, i => specVolume(bp.pieces[i]));
  markPlans(goal);
  ui.setLoading(1, 'Site secured');
  siteValue = blueprintValue(bp, goal?.groups);
  /* one account per protected structure: outlines of the same thing (a building split round a gap, two parked cars) share it */
  const accounts = new Map<string, number>();
  for (const g of guards) accounts.set(g.label, (accounts.get(g.label) ?? 0) + g.raw);
  scoring.setLiabilities([...accounts].map(([label, raw]) => ({ key: label, label, raw, cap: Math.round(siteValue * scoring.LIABILITY) })));
  scoring.resetScore();
  dmg.clear();
  toastAt = -1e9;
  setLoadout(c.ammo);
  replay.reset();
  resetTime();
  active = c;
  targetMetAt = -1;
  quietT = 0;
  lastDemo = 0;
  [stars2, stars3] = starThresholds(c, siteValue);
  audio.setAmbience(c.env);
  return true;
}

async function showTitle(): Promise<void> {
  releaseLock();
  const pristine = state === 'contracts' || state === 'settings';
  state = 'title';
  ui.showHud(false);
  viewmodel.setVisible(false);
  ui.showScreen('title');
  audio.setPaused(false);
  /* the menu is usable at once; the Clearance Zone builds behind it (a pick made meanwhile supersedes it) */
  if (!pristine) {
    mode = 'sandbox';
    await loadLevel(SANDBOX, 'Preparing site', true);
  }
}

function showContracts(): void {
  state = 'contracts';
  releaseLock();
  ui.showHud(false);
  ui.renderContracts(contractCards());
  ui.showScreen('contracts');
}

function contractCards(): ui.JobCard[] {
  return CONTRACTS.map((c, i) => {
    const pr = save.progress[c.id];
    const prev = i > 0 ? save.progress[CONTRACTS[i - 1].id] : undefined;
    return {
      index: i, id: c.id, name: c.name, location: c.location, chapter: c.chapter,
      stars: pr?.stars ?? 0, best: pr?.best ?? 0,
      locked: i > 0 && !(prev && prev.stars > 0),
    };
  });
}

function showBriefing(i: number): void {
  contractIdx = i;
  const c = CONTRACTS[i];
  state = 'briefing';
  const thresholds = starThresholds(c, blueprintValue(c.build(), c.goal?.groups));
  ui.renderBriefing({
    terms: termsOf(c),
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
  ui.resetHud();
  viewmodel.setVisible(true);
  viewmodel.setWeapon(loadout.current);
  audio.setPaused(false);
  if (!input.locked) requestLock();
  ui.setPointerHint(!input.locked);
  clockOn = mode === 'sandbox';
  flashHint(mode === 'sandbox' ? 'F — fly · R — rebuild site' : `Target ${Math.round(active.target * 100)}% · the clock starts when you move or fire · Enter calls it early`, 6);
  ui.toast(title.toUpperCase(), 'info', 1800);
}

/* The contract clock waits for the crew: looking round from the spawn (and clicking in for the mouse) is free; the first
   key, click or tool use starts it. */
let clockOn = true;
const startClock = (): void => { clockOn = true; };

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
  const pct = scoring.objective.frac;
  const raw = scoring.score.points + scoring.score.penalty;
  const rows: ResultsView['rows'] = [{ label: `Demolition — ${Math.round(pct * 100)}%`, value: raw }];
  const hurt = scoring.fines();
  if (scoring.score.penalty > 0) rows.push({ label: `Property damage${hurt.length ? ` — ${hurt.map(f => f.label).join(', ')}` : ''}`, value: -scoring.score.penalty });
  let total = scoring.score.points;
  if (won) {
    /* bonuses scale with the site's value so stars mean the same thing on a shed and a tower block */
    const v = siteValue;
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
    /* fly-tipping: the target's volume lying outside its footprint, charged at twice the site's worth */
    const out = goalOf(c)?.footprint ? scoring.objective.outside : 0;
    if (out > 0.005) {
      const tip = Math.round(v * 2 * out);
      rows.push({ label: `Outside the footprint — ${Math.round(out * 100)}%`, value: -tip });
      total -= tip;
    }
  }
  total = Math.max(0, total);
  let stars = 0;
  let newBest = false;
  const firstClear = won && !(save.progress[c.id]?.stars);
  /* protected property: any damage and the job cannot be a clean ★★★; a structure wrecked and it is a ★ job */
  const severity = scoring.protectedSeverity();
  const capStars = severity === 2 ? 1 : severity === 1 ? 2 : 3;
  const wrecked = hurt.filter(f => f.level === 2).map(f => f.label);
  if (won) {
    stars = Math.min(capStars, total >= stars3 ? 3 : total >= stars2 ? 2 : 1);
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
      ? `${c.name} — ${Math.round(pct * 100)}% down in ${fmtTime(scoring.score.elapsed)} (par ${fmtTime(c.par)})\n★★ ${stars2.toLocaleString()} pts · ★★★ ${stars3.toLocaleString()} pts`
        + (severity === 2 ? `\n★ at most: the ${wrecked.join(' and the ')} ${wrecked.length > 1 ? 'were' : 'was'} wrecked` : severity === 1 ? '\n★★ at most: protected property was damaged' : hurt.length ? '\nProtected property: minor damage only, no cap on the stars' : '')
      : `${c.name} — ${Math.round(pct * 100)}% of ${Math.round(c.target * 100)}% required · ${failReason(c)}${(c as Partial<Job>).tip ? `\nForeman: ${(c as Partial<Job>).tip}` : ''}`,
    rows, total, stars, newBest,
    hasNext: won && contractIdx < CONTRACTS.length - 1,
    unlockText: firstClear ? c.unlockText : undefined,
  });
  ui.showScreen('results');
}

/* Why a job was lost, in the report's words. */
function failReason(c: Contract): string {
  const g = goalOf(c);
  if (scoring.goalExpired(c.target)) return 'out of time';
  if (g?.salvage && scoring.salvageLost()) return 'salvage lost';
  if (scoring.objective.frac >= c.target && scoring.salvageOwed() > 0) return 'salvage not carried out';
  if (g?.fell && scoring.stillStanding()) return `${g.fell.what} still standing`;
  if (rangedAmmoLeft() === 0 && liveOrdnance() === 0) return 'ordnance spent';
  return 'called early';
}

/* ---------------- protected property ---------------- */

const GUARD_LABEL: Record<string, string> = {
  office: 'site office', van: 'foreman’s van', car: 'parked car', cottages: 'cottage terrace', terrace: 'terrace',
  shelter: 'bus shelter', chipshop: 'chip shop', gatehouse: 'canal trust gatehouse',
  archbridge: 'listed arch bridge', millwheel: 'mill wheel', boilerhouse: 'boiler house', rotunda: 'rotunda', mill: 'mill',
  eastspan: 'east span', millworks: 'cotton mill', bookinghall: 'booking hall', flats: 'occupied flats',
  skyscraper2: 'Tower Street tower', store: 'department store',
};

/* One outline per protected structure: pieces of a group, split where they stand apart (two parked cars). `raw` is what
   the structure's pieces would add up to at the per-piece fine structure.ts credits (its measure of the whole). */
function guardsOf(bp: Blueprint): (Guarded & { raw: number })[] {
  const boxes = new Map<string, { lo: Vec3; hi: Vec3; raw: number }[]>();
  for (const p of bp.pieces) {
    if (!p.protected) continue;
    const sx = p.size[0] / 2, sz = (p.shape === 'cylinder' || p.shape === 'prism' ? p.size[0] : p.size[2]) / 2;
    const cs = Math.abs(Math.cos(p.rotY ?? 0)), sn = Math.abs(Math.sin(p.rotY ?? 0));
    const hx = cs * sx + sn * sz, hz = sn * sx + cs * sz, hy = p.size[1] / 2;
    const b = { lo: [p.pos[0] - hx, p.pos[1] - hy, p.pos[2] - hz] as Vec3, hi: [p.pos[0] + hx, p.pos[1] + hy, p.pos[2] + hz] as Vec3, raw: 400 + specVolume(p) * MATS[p.mat].value * 4 };
    const key = p.group ?? '';
    const list = boxes.get(key) ?? [];
    // merge with every cluster it comes within 1.5 m of
    const near = list.filter(c => [0, 1, 2].every(i => b.lo[i] - 1.5 <= c.hi[i] && c.lo[i] - 1.5 <= b.hi[i]));
    for (const c of near) {
      for (let i = 0; i < 3; i++) { b.lo[i] = Math.min(b.lo[i], c.lo[i]); b.hi[i] = Math.max(b.hi[i], c.hi[i]); }
      b.raw += c.raw;
    }
    boxes.set(key, [...list.filter(c => !near.includes(c)), b]);
  }
  const out: (Guarded & { raw: number })[] = [];
  for (const [key, list] of boxes) for (const b of list) out.push({ label: GUARD_LABEL[key] ?? (key || 'protected property'), lo: b.lo, hi: b.hi, raw: b.raw });
  return declutter(out, bp.spawn?.pos ?? [0, 0, 26]);
}

/* Tags of structures standing close together print over each other from the spawn: the nearest keeps its height and
   each one behind it is lifted until its tag clears the last on screen, on the outline's corner posts (they run up to
   the tag, a leader line). Tag size follows render/guard.ts: s tall and 4s wide, s = 7.5 % of the range (1.6–9 m). */
function declutter<T extends Guarded>(list: T[], eye: Vec3): T[] {
  const EYE = 1.6, LIFT = 1.2;
  const at = (g: Guarded) => {
    const x = (g.lo[0] + g.hi[0]) / 2 - eye[0], z = (g.lo[2] + g.hi[2]) / 2 - eye[2], d = Math.max(1, Math.hypot(x, z));
    return { d, bearing: Math.atan2(x, z), s: Math.min(9, Math.max(1.6, d * 0.075)) };
  };
  const placed: T[] = [];
  for (const g of [...list].sort((a, b) => at(a).d - at(b).d)) {
    const G = at(g);
    for (const o of placed) {
      const O = at(o);
      let db = Math.abs(G.bearing - O.bearing);
      if (db > Math.PI) db = 2 * Math.PI - db;
      if (db > Math.atan(2 * G.s / G.d) + Math.atan(2 * O.s / O.d)) continue;
      const top = o.hi[1] + LIFT + O.s * 1.05;
      const need = EYE - LIFT + ((top - EYE) * G.d) / O.d;
      if (g.hi[1] < need) g.hi[1] = need;
    }
    placed.push(g);
  }
  return list;
}

let guards: (Guarded & { raw: number })[] = [];

/* Damage lands per piece: it is booked against the protected structure it came from (the nearest outline, however far
   the piece flew) and the player hears about it once per incident, and once more if it went on growing. */
const dmg = new Map<string, { label: string; shown: number; fine: number; lastT: number; openT: number; toasted: boolean; capped: boolean; level: 0 | 1 | 2; shownLevel: number }>();
const LEVEL_TAG = ['MINOR, NO STAR CAP', '★★ MAX', 'WRECKED · ★ MAX'] as const;
let toastAt = -1e9;

function nearestGuard(pos: Vec3): number {
  const g = guardAt(pos);
  let best = g ? guards.indexOf(g as Guarded & { raw: number }) : -1, bd = Infinity;
  if (best >= 0) return best;
  guards.forEach((k, i) => {
    const dx = Math.max(k.lo[0] - pos[0], 0, pos[0] - k.hi[0]), dz = Math.max(k.lo[2] - pos[2], 0, pos[2] - k.hi[2]);
    const d = Math.hypot(dx, dz);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function protectedHit(pos: Vec3): void {
  const i = nearestGuard(pos);
  if (i >= 0) flagGuard(guards[i]);
  scoring.chargePenalty(i >= 0 ? guards[i].label : null);
}

function onFine(f: scoring.Incident): void {
  const now = performance.now();
  let e = dmg.get(f.key);
  if (f.fine <= 0 && (!e || f.opened)) return;   // more of a structure already at full liability: nothing new to say
  if (!e || f.opened) {
    if (e?.toasted && e.fine > e.shown) settleToast(e);
    e = { label: f.label, shown: 0, fine: 0, lastT: now, openT: now, toasted: false, capped: false, level: f.level, shownLevel: -1 };
    dmg.set(f.key, e);
  }
  e.fine = f.fine;
  e.capped = f.capped;
  e.level = f.level;
  e.lastT = now;
}

function settleToast(e: { label: string; shown: number; fine: number; capped: boolean; level: 0 | 1 | 2; shownLevel: number }): void {
  ui.toast(`${e.label.toUpperCase()} — DAMAGE SETTLED AT −${e.fine.toLocaleString()}${e.capped ? ' (FULL LIABILITY)' : ''} · ${LEVEL_TAG[e.level]}`, 'bad', 3400);
  e.shown = e.fine;
  e.shownLevel = e.level;
  toastAt = performance.now();
}

function flushDamage(): void {
  const now = performance.now();
  for (const [key, e] of dmg) {
    if (!e.toasted) {
      // the first burst of an incident arrives over a few hundred ms: say it once, with what it came to
      if (now - e.openT < 450 || now - toastAt < 1200) continue;
      ui.toast(`PROPERTY DAMAGE — ${e.label.toUpperCase()} · −${e.fine.toLocaleString()} · ${LEVEL_TAG[e.level]}`, 'bad', 3400);
      e.toasted = true;
      e.shown = e.fine;
      e.shownLevel = e.level;
      toastAt = now;
    } else if (now - e.lastT > 4000) {
      if ((e.fine > e.shown * 1.3 || e.level > e.shownLevel) && now - toastAt > 1200) settleToast(e);
      if (now - e.lastT > scoring.INCIDENT_GAP * 1000) dmg.delete(key);
    }
  }
}

/* What the fee is reckoned on, counted the way demolition is credited (structure.ts credit): loose props and protected
   pieces earn nothing, so they are not in it. The briefing and the results read the same number. */
function blueprintValue(bp: Blueprint, groups?: string[]): number {
  let v = 0;
  for (const p of bp.pieces) {
    if (p.protected || (p.noWeld && !p.mech && !MATS[p.mat].explosive)) continue;
    if (groups && !(p.group && groups.includes(p.group) && !scoring.belowGrade(p))) continue;
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

/* ---------------- contract objectives ---------------- */

function goalOf(c: Contract): scoring.Goal | undefined {
  return (c as Partial<Job>).goal;
}

/** The goal's conditions in the briefing's words. */
function termsOf(c: Job): string[] {
  const g = c.goal;
  const out: string[] = [];
  if (c.protectedNote) out.push('Protected property: any damage is docked from the fee. Past broken windows the job can earn ★★ at most; wreck it and ★ is the best it can do.');
  if (!g) return out;
  if (g.groups) out.push(`The ${Math.round(c.target * 100)}% target counts ${g.what ?? g.groups.join(', ')} only; the rest of the site is not on this order.`);
  if (g.footprint) out.push(`It comes down inside the marked footprint. Whatever of it lies outside at the end is fly-tipping, deducted from the fee.`);
  if (g.limit) out.push(`Hard limit ${fmtTime(g.limit)}: not met by then and the contract is forfeit.`);
  if (g.salvage) out.push(`Salvage first: ${Math.ceil(g.salvage.need * 100)}% of the ${g.salvage.what} carried into ${g.salvage.where} (marked) before the job is signed off.`);
  if (g.fell) out.push(`${g.fell.what[0].toUpperCase()}${g.fell.what.slice(1)} must be on the ground, whatever the percentage says${g.fell.from ? ` (everything of it above ${g.fell.from} m brought down; the stump can stay)` : ''}: the job is not signed off while it stands.`);
  return out;
}

/* The footprint and the salvage zone, pegged out on site: a hazard-yellow rope at knee height on corner posts. */
let plans: THREE.Group | null = null;
function markPlans(g: scoring.Goal | undefined): void {
  if (plans) { gfx.scene.remove(plans); plans.traverse(o => { if (o instanceof THREE.Line || o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); plans = null; }
  const boxes = [g?.footprint, g?.salvage?.zone].filter((b): b is scoring.Plan => !!b);
  if (!boxes.length) return;
  plans = new THREE.Group();
  plans.name = 'contract-plans';
  for (const [x0, x1, z0, z1] of boxes) {
    const y = 0.6;
    const rope = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([x0, x1, x1, x0].map((x, i) => new THREE.Vector3(x, y, i < 2 ? z0 : z1))),
      new THREE.LineDashedMaterial({ color: 0xffc400, dashSize: 0.8, gapSize: 0.5 }));
    rope.computeLineDistances();
    plans.add(rope);
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), new THREE.MeshBasicMaterial({ color: 0xffc400 }));
      post.position.set(x, 0.6, z);
      plans.add(post);
    }
  }
  gfx.scene.add(plans);
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
    onProjectileHit(a, b, point, speed, normal);
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

/* V: freeze the world and watch the last ~12 s back from any angle; V again (or a level change) puts it all back. */
function startReplay(): void {
  if (driving.vehicle || operating.machine) { flashHint('Replay — step out of the cab first', 1.6); return; }
  if (fireHeld) { releaseFire(); fireHeld = false; }
  if (!replay.start(gfx.camera)) { audio.ui('deny'); flashHint('Nothing to replay yet — knock something down first', 1.8); return; }
  audio.ui('click');
  viewmodel.setVisible(false);
  marks.begin(); marks.end();
  tags.begin(); tags.end();
  ui.setReplay(replay.view());
}

function endReplay(): void {
  if (!replay.playing) return;
  replay.stop();
  ui.setReplay(null);
  if (state === 'playing' || state === 'paused') viewmodel.setVisible(true);
}

function handleInput(): void {
  if (!clockOn && (input.pressed.size || input.clicked || input.buttons)) startClock();
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
  if (input.pressed.has('Enter') && mode === 'campaign') finish(scoring.goalMet(active.target));
  if (input.pressed.has('KeyP')) respawn();
  if (input.pressed.has('KeyU')) useService();
  if (input.pressed.has('KeyT')) {
    audio.ui('click');
    flashHint(toggleBulletTime() ? 'Bullet time — T to return to real time' : 'Real time', 1.6);
  }
  if (input.pressed.has('KeyV')) startReplay();
  if (input.pressed.has('KeyX')) {
    const next = ({ off: 'stress', stress: 'thermal', thermal: 'services', services: 'fields', fields: 'off' } as const)[xrayMode()];
    setXrayMode(next);
    audio.ui('click');
    ui.toast({ off: 'X-RAY OFF', stress: 'X-RAY · JOINT STRESS', thermal: 'X-RAY · THERMAL', services: 'X-RAY · SERVICES', fields: 'X-RAY · GAS, SMOKE & HEAT FIELDS' }[next], 'info', 1400);
  }
}

/* A structure settling under its own weight can take half a minute to let go, and the percentage only moves once it
   does. Every 0.3 s: how many standing members have dropped since the last look. */
const sagY = new WeakMap<object, number>();
let sagT = 0, sagging = 0;
function sagMeter(dt: number): void {
  sagT += dt;
  if (sagT < 0.3) return;
  sagT = 0;
  let n = 0;
  for (const p of live) {
    if (p.demolished || p.root.prop || p.root.protected) continue;
    const y = p.curPos[1], was = sagY.get(p);
    sagY.set(p, y);
    if (was !== undefined && was - y > 0.015) n++;
  }
  sagging = n;
}

function checkContract(dt: number): void {
  if (mode !== 'campaign') return;
  scoring.trackGoal(live, demolitionFraction());
  sagMeter(dt);
  const pct = scoring.objective.frac;
  if (pct < active.target && sagging >= 4 && quietT > 1.5) flashHint('It is going — the structure is sagging under its own weight. Give it a few seconds.', 0.5);
  if (pct > lastDemo + 0.002) { lastDemo = pct; quietT = 0; } else quietT += dt;
  const goal = goalOf(active);
  if (scoring.goalExpired(active.target)) {
    ui.toast('OUT OF TIME — THE SITE IS HANDED BACK', 'bad', 3500);
    finish(false);
    return;
  }
  if (goal?.salvage && scoring.salvageLost()) {
    ui.toast(`SALVAGE LOST — TOO FEW ${goal.salvage.what.toUpperCase()} LEFT TO SIGN OFF`, 'bad', 3500);
    finish(false);
    return;
  }
  if (goal?.limit && goal.limit - scoring.score.elapsed < 60 && !scoring.goalMet(active.target)) flashHint(`${Math.ceil(goal.limit - scoring.score.elapsed)} s left on the clock`, 0.5);
  if (pct >= active.target) {
    const owed = scoring.salvageOwed();
    if (owed > 0) {
      if (quietT > 2) flashHint(`Target met — ${owed} more ${goal!.salvage!.what} to carry into ${goal!.salvage!.where}`, 0.5);
      return;
    }
    if (scoring.stillStanding()) {
      if (quietT > 2) flashHint(`${Math.round(pct * 100)}% down — but ${goal!.fell!.what} is still standing, and it has to come down`, 0.5);
      return;
    }
    if (targetMetAt < 0) {
      targetMetAt = scoring.score.elapsed;
      audio.ui('target');
      ui.toast('TARGET MET — keep going for score, Enter to sign off', 'good', 3500);
    }
    /* "keep going" means it: the job signs itself off only once there is nothing left to do — the target all down, the
       ordnance spent, or the site quiet for half a minute with nothing armed */
    const settled = quietT > 2.5 && scoring.score.comboTimer <= 0;
    const spent = rangedAmmoLeft() === 0 && liveOrdnance() === 0;
    if (settled && (pct >= 0.995 || (spent && quietT > 8) || (quietT > 30 && liveOrdnance() === 0))) finish(true);
    else if (settled) flashHint('Target met — Enter to sign off, or keep going for score', 0.5);
    return;
  }
  if (rangedAmmoLeft() === 0 && liveOrdnance() === 0) {
    if (loadout.ammo.hammer !== undefined) {
      if (quietT > 3 && sagging < 4) flashHint('Out of ordnance — keep swinging or Enter to call it', 0.5);
    } else if (quietT > 5 && sagging < 4) {
      finish(false);
    }
  }
}

const _eye: Vec3 = [0, 0, 0], _fwd: Vec3 = [0, 0, 0];
const _camDir = new THREE.Vector3();
const _ce: Vec3 = [0, 0, 0], _cl: Vec3 = [0, 0, 0];
const hud: HudState = {
  demolition: 0, target: null, score: 0, combo: 1, comboTime: 0, time: 0, par: null, weapon: 'hammer',
  weapons: [], bank: 0, timeScale: 1, chargesPlaced: 0, penalty: 0, hint: null, fps: 60, tool: null, timeline: null,
};

let nearVehicle = false, nearMachine = false, nearT = 0;
let bankFor: WeaponId | null = null;
function updateHudState(): void {
  // whatever changed the tool (wheel, a new loadout), the number keys must address the bank it sits in
  if (loadout.current !== bankFor) {
    bankFor = loadout.current;
    bank = WEAPONS.find(w => w.id === bankFor)?.bank ?? bank;
  }
  if (++nearT % 10 === 0) {
    eyePosition(_eye, 1);
    const free = !driving.vehicle && !operating.machine;
    nearVehicle = free && !!vehicleNear(_eye);
    nearMachine = free && !nearVehicle && !!machineNear(_eye);
    if (free) aimService(); else svcHint = null;
  }
  hud.demolition = mode === 'campaign' ? scoring.objective.frac : demolitionFraction();
  const fell = mode === 'campaign' ? goalOf(active)?.fell : undefined;
  ui.setDemoCaveat(fell && scoring.stillStanding() ? `${fell.what.replace(/^the /, '')} still standing` : null);
  hud.target = mode === 'campaign' ? active.target : null;
  hud.score = scoring.score.points;
  hud.combo = scoring.comboMult();
  hud.comboTime = scoring.comboFraction();
  hud.time = scoring.score.elapsed;
  hud.par = mode === 'campaign' ? active.par : null;
  hud.weapon = loadout.current;
  hud.weapons = weaponViews();
  hud.bank = bank;
  hud.timeScale = (mode === 'sandbox' ? sandbox.timeScale : 1) * (bulletTime() ? 0.3 : 1);
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
    : xrayMode() === 'services' ? 'X-RAY · services: yellow power · orange gas · blue water · white steam · grey dead · beads run from supply to load · red shut (blinking: tripped) · amber standby set · white on battery · pulsing = live break · green = running machine'
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

  if (state === 'playing' && replay.playing) {
    if (input.pressed.has('KeyV') || input.pressed.has('Escape')) endReplay();
    else {
      replay.update(dt, cam);
      ui.setReplay(replay.view());
    }
    const v = replay.view();
    fxScale = v ? (v.paused ? 0 : v.speed) : 1;
  } else if (state === 'playing') {
    frameDt = dt;
    handleInput();
    fxScale = simScale(dt);
    acc += dt * (mode === 'sandbox' ? sandbox.timeScale : 1) * fxScale;
    let steps = 0;
    const tp = performance.now();
    while (acc >= FIXED_DT && steps < 4) {
      if (!driving.vehicle && !operating.machine) { playerPreStep(FIXED_DT); weaponsPreStep(); }
      physicsStep(handlers);
      afterStep(FIXED_DT);
      terrainStep(live);
      weaponsAfterStep(FIXED_DT);
      const tr0 = performance.now();
      replay.recordStep();
      recMs += performance.now() - tr0;
      playerPostStep();
      if (clockOn) scoring.tickScore(FIXED_DT);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === 4) acc = Math.min(acc, FIXED_DT);
    perf.phys += (performance.now() - tp - perf.phys) * 0.1;
    perf.rec += (recMs - perf.rec) * 0.1;
    recMs = 0;
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
    viewmodel.update(dt * fxScale, { move: player.move, grounded: player.grounded, sprint: player.sprint, lookDelta: player.lookDelta });
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
    if (replay.playing) {
      cam.getWorldDirection(_camDir);
      _fwd[0] = _camDir.x; _fwd[1] = _camDir.y; _fwd[2] = _camDir.z;
      setShadowFocus([cam.position.x + _fwd[0] * 18, 0, cam.position.z + _fwd[2] * 18]);
    } else setShadowFocus([_eye[0] + forward(_fwd)[0] * 18, 0, _eye[2] + _fwd[2] * 18]);
    audio.setListener([cam.position.x, cam.position.y, cam.position.z], _fwd);
    updateHudState();
    ui.updateHud(hud, dt);
    flushDamage();
  } else {
    setShadowFocus([0, 0, 0]);
    audio.setListener([cam.position.x, cam.position.y, cam.position.z], [-cam.position.x, 0, -cam.position.z]);
  }

  updateGuards(cam.position, inPlay, dt);
  const tr = performance.now();
  fx.update(state === 'playing' ? dt * fxScale : dt);
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
  applyDisplay(s);
  player.sensitivity = s.sensitivity;
  player.invertY = s.invertY;
  player.baseFov = s.fov;
}

function applyDisplay(s: Settings): void {
  setRenderScale(s.renderScale);
  setPostFx({ grain: s.grain, aberration: s.aberration });
  player.shake = s.shake ? 1 : 0;
}

function wire(): void {
  setStructureHooks(
    (pos, radius) => {
      eyePosition(_eye, 1);
      const d = Math.hypot(pos[0] - _eye[0], pos[1] - _eye[1], pos[2] - _eye[2]);
      replay.noteBlast(pos, radius);
      const k = Math.max(0, 1 - d / (radius * 6));
      if (k <= 0) return;
      addTrauma(k * k * 0.9);
      kickFov(k * 10);
      if (k > 0.35) hitstop(0.03 + 0.06 * k * k);
      if (d < radius * 1.6) {
        const close = 1 - d / (radius * 1.6);
        ui.blastVignette(close);
        audio.setMuffle(close);
        knockback(0.25 + close * 0.4);
      }
    },
    pos => protectedHit(pos),
  );
  scoring.setScoreHooks(
    (pts, label) => ui.scorePop(pts, label),
    () => {},
  );
  scoring.setFineHook(onFine);
  setWeaponHooks(msg => flashHint(msg, 1.8));
}

async function boot(): Promise<void> {
  save = loadSave();
  ui.initUI({
    onCampaign: () => showContracts(),
    onSandbox: () => void startSandbox(SANDBOX),
    onShowcase: () => void startSandbox(SHOWCASE),
    onDowntown: () => void startSandbox(DOWNTOWN),
    onRailway: () => void startSandbox(RAILWAY),
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
  onDetailTier(q => setDetailQuality(q));
  applyDisplay(save.settings);
  initMaterials(gfx.renderer, save.settings.quality);
  initRebar(gfx.scene);
  initCables(gfx.scene);
  initLampLights(gfx.scene);
  initWater(gfx.scene);
  initTerrainGfx(gfx.scene);
  initGhost(gfx.scene);
  initAim(gfx.scene);
  initGuards(gfx.scene);
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
if (import.meta.env.DEV) void import('./render/photo').then((m) => m.installPhoto());
if (import.meta.env.DEV) window.__dv = {
  get state() { return state; },
  get stats() { return { ...stats(), demolition: demolitionFraction(), score: scoring.score.points, step: stepCount, fps: Math.round(fpsAvg) }; },
  get player() { return player; },
  start: (i: number) => startContract(i),
  sandbox: () => startSandbox(SANDBOX),
  showcase: () => startSandbox(SHOWCASE),
  downtown: () => startSandbox(DOWNTOWN),
  railway: () => startSandbox(RAILWAY),
  get objective() { return { ...scoring.objective, target: active.target, met: scoring.goalMet(active.target), id: active.id }; },
  look: (dx: number, dy: number) => applyLook(dx, dy),
  fire: () => { startClock(); return tryFire(); },
  select: (id: WeaponId) => { startClock(); select(id); },
  detonate: () => detonate(),
  setPlaying: () => { if (state === 'paused') { state = 'playing'; ui.showScreen(null); } },
  get perf() { return { phys: +perf.phys.toFixed(2), render: +perf.render.toFixed(2), fx: +perf.fx.toFixed(2), sync: +perf.sync.toFixed(2), rec: +perf.rec.toFixed(3), calls: gfx.renderer.info.render.calls, tris: gfx.renderer.info.render.triangles, ...renderStats() }; },
  spawnPrefab: (id: string, x: number, z: number, quarter = 0) => {
    const prefab = PREFABS.find(p => p.id === id);
    if (!prefab) throw Error(`Unknown prefab: ${id}`);
    return spawnPieces(prefab.build(x, z, quarter));
  },
  removeConnected: (piece: Parameters<typeof removeConnected>[0]) => removeConnected(piece),
  spawn: (specs: Parameters<typeof spawnPieces>[0]) => spawnPieces(specs),
  clearDebris: () => clearDebris(),
  release: () => releaseFire(),
  secondary: () => toolSecondary(),
  wheel: (d: number) => toolWheel(d),
  weaponsDebug: () => weaponsDebug(),
  replay: {
    start: () => { startReplay(); return replay.playing; },
    stop: () => endReplay(),
    seek: (f: number) => replay.seek(f),
    view: () => replay.view(),
    stats: () => replay.stats(),
    setRecording: (on: boolean) => replay.setRecording(on),
  },
  bulletTime: () => toggleBulletTime(),
  devices: () => devices().map(p => ({ type: p.type, delay: p.delay, pos: [...p.curPos] })),
  setDelay: (i: number, ms: number) => { const p = devices()[i]; if (p) setDelay(p as Parameters<typeof setDelay>[0], ms); },
  fired: () => fired.map(f => ({ ...f })),
  vm: (id: WeaponId, pos?: Vec3, rot?: Vec3, scale?: number) => tuneViewmodel(id, pos, rot, scale),
  teleport: (x: number, y: number, z: number, yaw = player.yaw, pitch = 0) => teleportPlayer([x, y, z], yaw, pitch),
  hint: (v: boolean) => ui.setPointerHint(v),
  xray: (m?: 'off' | 'stress' | 'thermal' | 'services' | 'fields') => { if (m) setXrayMode(m); return xrayMode(); },
  get scene() { return gfx.scene; },
  get gfx() { return gfx; },
  get threads() { return { threads, isolated: globalThis.crossOriginIsolated }; },
  boom: (x: number, y: number, z: number, r = 5) => explode([x, y, z], r, 90e3, 3200),
  kinetic: (x: number, y: number, z: number, dx: number, dy: number, dz: number, e: number, reach: number, perJ: number) => kinetic([x, y, z], [dx, dy, dz], e, reach, perJ),
  ignite: (x: number, y: number, z: number, r = 1.5) => { let n = 0; for (const p of live) if (Math.hypot(p.curPos[0] - x, p.curPos[1] - y, p.curPos[2] - z) < r) { ignite(p); n++; } return n; },
  finish: (won?: boolean) => finish(won ?? scoring.goalMet(active.target)),
  pieces: (test?: (p: { group: string; mat: string; pos: number[] }) => boolean) => {
    const out: { id: number; group: string; mat: string; pos: number[]; vol: number; hp: number; demolished: boolean; sleep: number; welds: number; protected: boolean }[] = [];
    for (const p of live) {
      const q = { id: p.id, group: p.root.spec.group ?? '', mat: p.mat, pos: [...p.curPos].map(v => +v.toFixed(2)), vol: +p.volume.toFixed(4), hp: +p.hp.toFixed(1), demolished: p.demolished, sleep: +p.sleepT.toFixed(2), welds: p.welds.length, protected: p.root.protected };
      if (!test || test(q)) out.push(q);
    }
    return out;
  },
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
