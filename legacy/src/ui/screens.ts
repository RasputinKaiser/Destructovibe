import { $ } from '../util';
import { CONTRACTS } from '../sim/contracts';
import { SaveData, isUnlocked } from '../core/save';

const SCREENS = ['#titleScreen', '#levelSelect', '#briefing', '#pauseScreen', '#resultsScreen'];

export function showScreen(sel: string | null): void {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== sel);
}

export function renderContractGrid(save: SaveData, onPick: (i: number) => void): void {
  const grid = $('#contractGrid');
  grid.innerHTML = '';
  CONTRACTS.forEach((c, i) => {
    const unlocked = isUnlocked(save, i);
    const stars = save.stars[i] ?? 0;
    const card = document.createElement('div');
    card.className = `ccard glass${unlocked ? '' : ' locked'}`;
    card.innerHTML = `
      <div class="cnum">CONTRACT ${String(i + 1).padStart(2, '0')}</div>
      <div class="cname">${c.name}</div>
      <div class="ctgt">Demolish ${Math.round(c.target * 100)}% · par ${Math.floor(c.par / 60)}:${String(c.par % 60).padStart(2, '0')}</div>
      <div class="cstars">${'★'.repeat(stars)}<span class="off">${'★'.repeat(3 - stars)}</span></div>
      ${unlocked ? '' : '<div class="lockIco">🔒</div>'}`;
    if (unlocked) card.addEventListener('click', () => onPick(i));
    grid.appendChild(card);
  });
}

const WEAPON_NAMES = ['Cannonball', 'Grenade', 'Rocket', 'C4'];

export function renderBriefing(i: number): void {
  const c = CONTRACTS[i];
  $('#briefNum').textContent = `CONTRACT ${String(i + 1).padStart(2, '0')}`;
  $('#briefName').textContent = c.name;
  $('#briefDesc').textContent = c.desc;
  const loadout = c.loadout
    .map((n, w) => (n !== 0 ? `<b>${n < 0 ? '∞' : n}×</b> ${WEAPON_NAMES[w]}` : null))
    .filter(Boolean).join(' &nbsp; ');
  $('#briefStats').innerHTML = `
    <div>Target <b>${Math.round(c.target * 100)}% demolished</b></div>
    <div>Par time <b>${Math.floor(c.par / 60)}:${String(c.par % 60).padStart(2, '0')}</b></div>
    <div class="full">Loadout &nbsp; ${loadout}</div>
    ${c.briefNote ? `<div class="full" style="color:var(--red)">${c.briefNote}</div>` : ''}`;
}

export interface ResultRow { label: string; value: number }

export function renderResults(
  won: boolean, stars: number, rows: ResultRow[], total: number, hasNext: boolean,
): void {
  $('#resStatus').textContent = won ? 'CONTRACT COMPLETE' : 'CONTRACT FAILED';
  $('#resStatus').classList.toggle('fail', !won);
  $('#resHazard').classList.toggle('fail', !won);
  document.querySelectorAll('#stars span').forEach((s, i) => {
    s.classList.remove('lit');
    if (won && i < stars) setTimeout(() => s.classList.add('lit'), 350 + i * 380);
  });
  $('#resBreakdown').innerHTML = rows
    .map(r => `<div class="row${r.value < 0 ? ' neg' : ''}"><span>${r.label}</span><b>${r.value < 0 ? '−' : ''}${Math.abs(r.value).toLocaleString()}</b></div>`)
    .join('');
  $('#resTotal').textContent = Math.max(0, total).toLocaleString();
  $('#btnNext').classList.toggle('hidden', !won || !hasNext);
}
