import { $, clamp } from '../util';
import * as scoring from '../sim/scoring';
import { destroyedFraction, objects } from '../physics/destructible';
import { ammo, cooldownFrac, projectiles } from '../weapons/weapons';

let target = 0;         // 0 = freeplay (no objective)
let toastT: ReturnType<typeof setTimeout> | null = null;
let fpsAcc = 0, fpsN = 0, fpsT = 0;

export function showHud(on: boolean): void {
  $('#hud').classList.toggle('hidden', !on);
}

export function setObjective(t: number): void {
  target = t;
  const panel = $('#objectivePanel');
  panel.classList.toggle('hidden', t <= 0);
  if (t > 0) {
    $('#objTitle').textContent = `Demolish ${Math.round(t * 100)}%`;
    $('#objTarget').style.left = `${t * 100}%`;
  }
  $('#objWarn').classList.add('hidden');
}

export function toast(text: string, ms = 2200): void {
  const el = $('#toast');
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.add('show');
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), ms);
}

export function updateHud(dt: number): void {
  $('#scoreVal').textContent = Math.max(0, scoring.score).toLocaleString();

  const combo = $('#comboVal');
  if (scoring.comboCount >= 2) {
    combo.classList.remove('hidden');
    combo.textContent = `×${scoring.comboMult().toFixed(1)} COMBO`;
    combo.classList.toggle('hot', scoring.comboMult() >= 2);
  } else combo.classList.add('hidden');

  if (target > 0) {
    const pct = destroyedFraction();
    const bar = $('#objBar');
    bar.style.width = `${clamp(pct, 0, 1) * 100}%`;
    bar.classList.toggle('done', pct >= target);
    $('#objPct').textContent = `${Math.round(pct * 100)}% demolished`;
    const warn = $('#objWarn');
    if (scoring.penalty > 0) {
      warn.classList.remove('hidden');
      $('#penaltyVal').textContent = `-${scoring.penalty.toLocaleString()}`;
    }
  }

  const m = Math.floor(scoring.elapsed / 60), s = Math.floor(scoring.elapsed % 60);
  $('#timeVal').textContent = `${m}:${String(s).padStart(2, '0')}`;

  // weapon cards: ammo + cooldown
  document.querySelectorAll<HTMLElement>('.wcard').forEach((c, i) => {
    const a = ammo[i];
    const el = $(`#ammo${i}`);
    el.textContent = isFinite(a) ? String(a) : '∞';
    c.classList.toggle('empty', a === 0);
    const f = cooldownFrac(i);
    const cd = c.querySelector<HTMLElement>('.cd')!;
    cd.style.width = `${f * 100}%`;
    cd.style.opacity = f >= 1 ? '0' : '1';
  });

  // fps + body count (0.5 s window)
  fpsAcc += 1 / Math.max(dt, 1e-4); fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    $('#fps').textContent = String(Math.round(fpsAcc / fpsN));
    $('#bodies').textContent = String(objects.length + projectiles.length);
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }
}
