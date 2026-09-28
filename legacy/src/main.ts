import * as THREE from 'three';
import { initGfx, setQuality, renderer, scene, camera, sun } from './render/gfx';
import { initMaterials, initGround } from './render/textures';
import { initParticles, updateParticles, clearParticles } from './render/particles';
import { initEffects, updateEffects } from './render/effects';
import { initPhysics, world, eventQueue } from './physics/world';
import {
  clearSite, siteBuilt, destroyedFraction, processImpacts, syncDestructibles,
  lastDestructionAt,
} from './physics/destructible';
import { initPlayer, resetPlayer, updatePlayer, applyLook, toggleFly } from './player/controller';
import {
  initWeapons, setLoadout, selectWeapon, cycleWeapon, fireWeapon, detonateC4,
  clearProjectiles, updateProjectiles, ammo, liveOrdnance,
} from './weapons/weapons';
import { initInput, requestLock, releaseLock, setLockLostHandler, setMouseDeltaHandler, setActiveCheck, inputActive, fallbackLook } from './core/input';
import * as scoring from './sim/scoring';
import { CONTRACTS, buildFreeplay } from './sim/contracts';
import { loadSave, writeSave, SaveData } from './core/save';
import { sfx, setVolume } from './audio/sfx';
import { showHud, setObjective, updateHud, toast } from './ui/hud';
import { showScreen, renderContractGrid, renderBriefing, renderResults, ResultRow } from './ui/screens';
import { $, clamp } from './util';

type GameState = 'title' | 'select' | 'briefing' | 'playing' | 'paused' | 'results';
type Mode = 'campaign' | 'freeplay';

let state: GameState = 'title';
let mode: Mode = 'freeplay';
let contractIdx = 0;
let save: SaveData;
let winAt = -1;         // game-time (s) when target was first met
let settleTimer = 0;    // seconds of out-of-ammo stillness before failing
let lastWon = false;

/* ---------------- flow ---------------- */
function goTitle(): void {
  state = 'title';
  releaseLock();
  showHud(false);
  showScreen('#titleScreen');
}

function goSelect(): void {
  state = 'select';
  releaseLock();
  showHud(false);
  renderContractGrid(save, i => { contractIdx = i; goBriefing(); });
  showScreen('#levelSelect');
}

function goBriefing(): void {
  state = 'briefing';
  renderBriefing(contractIdx);
  showScreen('#briefing');
}

function resetWorldState(): void {
  clearSite();
  clearProjectiles();
  clearParticles();
  scoring.resetScoring();
  resetPlayer();
  winAt = -1;
  settleTimer = 0;
}

function startContract(i: number): void {
  mode = 'campaign';
  contractIdx = i;
  resetWorldState();
  const c = CONTRACTS[i];
  c.build();
  siteBuilt();
  setLoadout(c.loadout);
  selectWeapon(Math.max(0, c.loadout.findIndex(n => n !== 0)));
  setObjective(c.target);
  document.querySelectorAll('.wcard').forEach((el, w) =>
    el.classList.toggle('locked', c.loadout[w] === 0));
  showHud(true);
  showScreen(null);
  state = 'playing';
  requestLock();
  toast(c.name.toUpperCase(), 1800);
}

function startFreeplay(): void {
  mode = 'freeplay';
  resetWorldState();
  buildFreeplay();
  siteBuilt();
  setLoadout([-1, -1, -1, -1]);
  selectWeapon(0);
  setObjective(0);
  document.querySelectorAll('.wcard').forEach(el => el.classList.remove('locked'));
  showHud(true);
  showScreen(null);
  state = 'playing';
  requestLock();
  toast('FREE PLAY', 1500);
}

function restartCurrent(): void {
  if (mode === 'campaign') startContract(contractIdx);
  else startFreeplay();
}

function pauseGame(): void {
  if (state !== 'playing') return;
  state = 'paused';
  releaseLock();
  showScreen('#pauseScreen');
}

function resumeGame(): void {
  state = 'playing';
  showScreen(null);
  requestLock();
}

function finishContract(won: boolean): void {
  const c = CONTRACTS[contractIdx];
  state = 'results';
  lastWon = won;
  releaseLock();

  const demolition = scoring.score + scoring.penalty;
  const ammoBonus = won
    ? Math.round(ammo.reduce((s, a) => s + (isFinite(a) ? a : 0), 0) * 15 * (destroyedFraction() >= c.target ? 1 : 0))
    : 0;
  const timeBonus = won ? Math.round(Math.max(0, c.par - scoring.elapsed) * 8) : 0;
  const total = Math.max(0, scoring.score + ammoBonus + timeBonus);

  let stars = 0;
  const firstClear = won && (save.stars[contractIdx] ?? 0) === 0;
  if (won) {
    stars = 1;
    if (total >= c.silver) stars = 2;
    if (total >= c.gold) stars = 3;
    save.stars[contractIdx] = Math.max(save.stars[contractIdx] ?? 0, stars);
    writeSave(save);
    sfx.win();
  } else {
    sfx.lose();
  }

  const rows: ResultRow[] = [
    { label: `Demolition (${Math.round(destroyedFraction() * 100)}%)`, value: demolition },
  ];
  if (scoring.penalty > 0) rows.push({ label: 'Property damage penalty', value: -scoring.penalty });
  if (won) {
    rows.push({ label: 'Unused ordnance bonus', value: ammoBonus });
    rows.push({ label: 'Time bonus', value: timeBonus });
  }
  renderResults(won, stars, rows, total, contractIdx < CONTRACTS.length - 1);
  $('#resStatus').textContent = won
    ? (firstClear && c.unlock ? `COMPLETE — ${c.unlock}` : 'CONTRACT COMPLETE')
    : 'CONTRACT FAILED';
  showHud(false);
  showScreen('#resultsScreen');
}

/* ---------------- win / fail checks ---------------- */
function checkContractState(dt: number): void {
  if (mode !== 'campaign' || state !== 'playing') return;
  const c = CONTRACTS[contractIdx];
  const pct = destroyedFraction();

  if (pct >= c.target) {
    if (winAt < 0) {
      winAt = scoring.elapsed;
      toast('TARGET MET — WRAPPING UP', 2400);
      sfx.beep(988, .12, .2);
    } else if (scoring.elapsed - winAt > 2.6) {
      finishContract(true);
    }
    return;
  }

  // out of everything and the dust has settled → failed
  const ammoLeft = ammo.reduce((s, a) => s + (isFinite(a) ? a : 1), 0);
  if (ammoLeft <= 0 && liveOrdnance() === 0) {
    const sinceKill = scoring.elapsed - lastDestructionAt;
    const quiet = sinceKill > 1.5 || objects.every(o => o.body.isSleeping());
    if (quiet) settleTimer += dt; else settleTimer = 0;
    if (settleTimer > 3.5) finishContract(false);
  } else {
    settleTimer = 0;
  }
}

/* ---------------- input wiring ---------------- */
function wireInput(): void {
  setActiveCheck(() => state === 'playing');
  setMouseDeltaHandler(applyLook);
  setLockLostHandler(() => { if (state === 'playing') pauseGame(); });

  addEventListener('keydown', e => {
    if (state === 'playing' && inputActive()) {
      if (e.code === 'KeyF') toggleFly();
      if (e.code === 'KeyR') restartCurrent();
      if (e.code === 'KeyG') { if (detonateC4()) toast('C4 DETONATED', 1000); }
      if (e.code === 'Digit1') selectWeapon(0);
      if (e.code === 'Digit2') selectWeapon(1);
      if (e.code === 'Digit3') selectWeapon(2);
      if (e.code === 'Digit4') selectWeapon(3);
      if (e.code === 'Escape' && fallbackLook) pauseGame();
    } else if (state === 'paused' && e.code === 'Escape') {
      resumeGame();
    }
  });

  addEventListener('wheel', e => {
    if (state === 'playing' && inputActive()) cycleWeapon(e.deltaY > 0 ? 1 : -1);
  });

  addEventListener('mousedown', e => {
    if (state !== 'playing' || e.button !== 0 || !inputActive()) return;
    fireWeapon();
  });
}

function wireUi(): void {
  $('#btnCampaign').addEventListener('click', () => { sfx.resume(); goSelect(); });
  $('#btnFreeplay').addEventListener('click', () => { sfx.resume(); startFreeplay(); });
  $('#btnBackTitle').addEventListener('click', goTitle);
  $('#btnStartContract').addEventListener('click', () => startContract(contractIdx));
  $('#btnBackSelect').addEventListener('click', goSelect);
  $('#btnResume').addEventListener('click', resumeGame);
  $('#btnRestart').addEventListener('click', restartCurrent);
  $('#btnQuit').addEventListener('click', goTitle);
  $('#btnRetry').addEventListener('click', restartCurrent);
  $('#btnResMenu').addEventListener('click', goSelect);
  $('#btnNext').addEventListener('click', () => {
    if (lastWon && contractIdx < CONTRACTS.length - 1) { contractIdx++; goBriefing(); }
  });

  const vol1 = $('#volSlider') as HTMLInputElement;
  const vol2 = $('#volSlider2') as HTMLInputElement;
  const syncVol = (v: number): void => {
    setVolume(v);
    vol1.value = vol2.value = String(Math.round(v * 100));
    save.volume = v; writeSave(save);
  };
  vol1.addEventListener('input', () => syncVol(Number(vol1.value) / 100));
  vol2.addEventListener('input', () => syncVol(Number(vol2.value) / 100));

  const qSel = $('#qualitySel') as HTMLSelectElement;
  qSel.addEventListener('change', () => {
    save.quality = qSel.value === 'low' ? 'low' : 'high';
    setQuality(save.quality);
    writeSave(save);
  });
}

/* ---------------- main loop ---------------- */
const FIXED = 1 / 60;
let acc = 0;
const clock = new THREE.Clock();

let frameCount = 0;
let lastLoopError: unknown = null;
let rafId = 0;
let toId: ReturnType<typeof setTimeout> | undefined;

/* Hybrid scheduler: rAF when the tab paints, timeout fallback when it
   doesn't (backgrounded/headless), so simulation never silently stalls. */
function animate(): void {
  cancelAnimationFrame(rafId);
  clearTimeout(toId);
  rafId = requestAnimationFrame(animate);
  toId = setTimeout(animate, 66);
  frameCount++;
  try { animateInner(); } catch (err) { lastLoopError = String(err); }
}

function animateInner(dtForced?: number): void {
  const dt = dtForced ?? Math.min(clock.getDelta(), 0.05);

  if (state === 'playing') {
    updatePlayer(dt);
    acc = Math.min(acc + dt, FIXED * 4);
    let steps = 0;
    while (acc >= FIXED && steps < 3) {
      world.step(eventQueue);
      processImpacts();
      acc -= FIXED; steps++;
    }
    updateProjectiles(dt);
    updateParticles(dt);
    syncDestructibles();
    scoring.tickScoring(dt);
    checkContractState(dt);
  }

  updateEffects(dt);
  if (state === 'playing' || state === 'paused') updateHud(dt);
  renderer.render(scene, camera);
}

/* ---------------- boot ---------------- */
async function boot(): Promise<void> {
  initGfx();
  await initPhysics();
  initMaterials();
  initGround();
  initParticles();
  initEffects();
  initPlayer();
  initWeapons();
  initInput();
  wireInput();
  wireUi();

  save = loadSave();
  setVolume(save.volume);
  ($('#volSlider') as HTMLInputElement).value = String(Math.round(save.volume * 100));
  ($('#volSlider2') as HTMLInputElement).value = String(Math.round(save.volume * 100));
  ($('#qualitySel') as HTMLSelectElement).value = save.quality;
  if (save.quality === 'low') setQuality('low');

  camera.position.set(0, 2.3, 4);
  camera.lookAt(0, 2, -16);

  goTitle();
  animate();
}

/* playtest/debug hook */
import { objects } from './physics/destructible';
declare global { interface Window { __dbg: unknown } }
window.__dbg = {
  get state() { return state; },
  get mode() { return mode; },
  get nObjects() { return objects.length; },
  get pct() { return destroyedFraction(); },
  get score() { return scoring.score; },
  get elapsed() { return scoring.elapsed; },
  get ammo() { return ammo; },
  get frames() { return frameCount; },
  get loopError() { return lastLoopError; },
  /* simulate n seconds synchronously (playtest use) */
  tick(seconds: number) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) animateInner(1 / 60);
    return { pct: destroyedFraction(), score: scoring.score, state };
  },
  look: applyLook,
  fire: fireWeapon,
  gfx: { get renderer() { return renderer; }, get scene() { return scene; }, get sun() { return sun; }, get camera() { return camera; } },
  get shadowInfo() {
    return {
      mapEnabled: renderer.shadowMap.enabled,
      sunCast: sun.castShadow,
      camL: sun.shadow.camera.left,
      mapExists: sun.shadow.map !== null,
    };
  },
  selectWeapon,
  detonate: detonateC4,
};

boot().catch(err => {
  console.error('boot failed', err);
  document.body.innerHTML = `<pre style="color:#f66;padding:20px">Failed to start: ${String(err)}</pre>`;
});
