import type {
  UiHandlers, Settings, ScreenId, ContractCard, BriefingView, ResultsView, HudState, WeaponView, WeaponId, EnvPreset, Quality,
  SandboxSettings, SandboxAction, PrefabView, ToolReadout, TimelineView,
} from '../types';
import { clamp } from 'math';
import { easing, spring } from 'math/time';
import { audio } from '../audio/audio';
import { DEFAULT_SETTINGS, WORLD_DEFAULTS } from '../core/save';
import { ACTIONS, RESERVED, captureKey, codeLabel, bindingOf, usingPad, PAD_LABEL, type Action as KeyAction } from '../core/input';
import { WEAPON_ICON, STAR, LOCK, MOUSE, WARN, SEARCH } from './icons';
import { CATS, DEAD, LOCK as LOCK_R, TOOL_R, SECTOR, fanAngle, type Wheel } from '../game/toolsel';
import { TOOL_HELP, type Btn } from './toolhelp';

/* ---------------- static copy ---------------- */

type KeyRow = readonly [string, string];

/** the full list on the pause screen, in the keys the player has chosen */
const K = (a: KeyAction): string => codeLabel(bindingOf(a));
const controls = (): KeyRow[] => [
  [`${K('forward')} ${K('left')} ${K('back')} ${K('right')}`, 'Move'],
  ['Mouse', 'Look'],
  [K('jump'), 'Jump · at a wall or ledge up to chest height: climb it (walk into anything knee-high to scramble over)'],
  [K('sprint'), 'Sprint (stamina; jumps cost some too)'],
  [`${K('crouch')} / Ctrl`, 'Crouch (stands back up only where there is headroom)'],
  [K('careful'), `Careful: slow, quiet walk · with ${K('left')}/${K('right')}, lean round a corner`],
  [`${K('zoom')} / MMB`, 'Zoom (hold)'],
  [K('interact'), 'Drive a vehicle / operate a machine (crane, excavator) / get out'],
  ['At the controls', 'A/D slew · W/S boom, luff, trolley · R/F stick, mast · T/G bucket · Space/C hoist'],
  [K('use'), 'Work the breaker, valve, meter or standby set you aim at'],
  [K('respawn'), 'Back to spawn'],
  ['LMB', 'Fire / use tool (hold the sledge to wind up)'],
  ['RMB', 'Tool’s second action, else detonate'],
  [K('detonate'), 'Detonate charges / fire the sequence'],
  ['1–6', 'Quick slots'],
  [`${K('bank')} (hold)`, 'Tool wheel: point at a category, then along its tools; release to take · 1–6 pins the tool to that slot'],
  [`${K('bank')} (tap)`, 'Back to the last tool'],
  ['Wheel', 'Tool setting (charge size, delay, boom, blocks…), else next tool'],
  ['Shift + Wheel', 'Detonator panel: delay in 250 ms steps'],
  [K('xray'), 'Engineer’s x-ray (stress / thermal / services / fields)'],
  [K('bullet'), 'Bullet time (the world at 0.3×)'],
  [K('replay'), 'Replay the last 12 s: mouse orbit, wheel zoom, WASD/QE move, Space pause, 1–3 speed, ←/→ scrub, V exit'],
  ['Enter', 'Call the job early'],
  [K('restart'), 'Restart'],
  ['Esc', 'Pause · every key can be changed in Settings'],
  ['Gamepad', 'Sticks move/look · A jump · B crouch · X drive · Y detonate · RT/LT fire/second · LB/RB tool setting or next tool · D-pad ↑ hold: tool wheel (right stick points, A takes) · L3 sprint · R3 zoom · Start pause'],
];

/** the pause list while a pad is in use */
const padControls = (): KeyRow[] => [
  ['L stick · R stick', 'Move · look'],
  ['A', 'Jump · climb what is in front'],
  ['B', 'Crouch'],
  ['L3 · R3', 'Sprint · zoom (hold)'],
  ['D-pad ↓', 'Careful: slow, quiet walk · with the stick, lean'],
  ['RT · LT', 'Fire / use the tool · the tool’s second action, else detonate'],
  ['Y', 'Detonate charges / fire the sequence'],
  ['LB · RB', 'Tool setting (charge size, delay…), else the previous / next quick slot'],
  ['D-pad ← →', 'Quick slots'],
  ['D-pad ↑', 'Hold: tool wheel (right stick points, LB RB step, A takes, B cancels) · tap: last tool'],
  ['X', 'Drive a vehicle / operate a machine / get out'],
  [PAD_LABEL.xray ?? 'View', 'Engineer’s x-ray'],
  ['Start', 'Pause · Sign off the job is in this menu'],
];

const freeControls = (): KeyRow[] => [
  [K('panel'), 'Site control panel'],
  [K('palette'), 'Spawn menu'],
  [K('fly'), `Fly (${K('jump')} up, ${K('crouch')} down)`],
  ['LMB / RMB', 'Place / cancel spawn'],
  ['Wheel', 'Rotate spawn'],
  ['Backspace', 'Remove the structure you aim at'],
];

const TIME_SCALES = [1, 0.5, 0.25, 0.1] as const;
const RENDER_SCALES: readonly (readonly [number, string])[] = [[0, 'Auto'], [1, '100%'], [0.85, '85%'], [0.7, '70%'], [0.5, '50%']];

const SANDBOX_ACTIONS: readonly (readonly [SandboxAction, string, string])[] = [
  ['quake', 'Earthquake', 'pbtn--warn'],
  ['clearDebris', 'Clear debris', ''],
  ['rebuild', 'Rebuild site', ''],
  ['extinguish', 'Extinguish fires', 'pbtn--water'],
  ['freezeAll', 'Freeze all', 'pbtn--ice'],
  ['unfreezeAll', 'Unfreeze all', ''],
  ['lightning', 'Lightning strike', 'pbtn--warn'],
  ['storm', 'Thunderstorm', ''],
];

const CATEGORY: readonly (readonly [PrefabView['category'], string])[] = [
  ['houses', 'Houses'],
  ['towers', 'Towers'],
  ['industrial', 'Industrial'],
  ['infrastructure', 'Infrastructure'],
  ['heritage', 'Heritage'],
  ['props', 'Props'],
];

const ENV_LABEL: Record<EnvPreset, string> = {
  noon: 'Midday, clear',
  golden: 'Golden hour',
  overcast: 'Overcast',
  dusk: 'Dusk',
  night: 'Night shift',
};

/* ---------------- helpers ---------------- */

const nf = new Intl.NumberFormat('en-US');
const fmt = (n: number) => (n < 0 ? '−' : '') + nf.format(Math.abs(Math.round(n)));
const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
const clockS = (sec: number) => {
  const t = Math.max(0, Math.floor(sec));
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
};
const clockT = (tenths: number) => `${pad2(Math.floor(tenths / 600))}:${pad2(Math.floor(tenths / 10) % 60)}.${tenths % 10}`;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const rmq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => rmq?.matches === true || S.reduceMotion;
const stars = (n: number) =>
  `<span class="stars" role="img" aria-label="${n} of 3 stars">${[0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}">${STAR}</i>`).join('')}</span>`;
const keyRows = (rows: readonly KeyRow[]) => rows.map(([k, d]) => `<dt><span class="kbd">${k}</span></dt><dd>${d}</dd>`).join('');
const keys = (free: boolean) =>
  `<dl class="keys">${keyRows(usingPad() ? padControls() : controls())}</dl>` +
  (free ? `<h3 class="label">Free play</h3><dl class="keys">${keyRows(freeControls())}</dl>` : '');
const windLabel = (w: number) => (w < 0.05 ? 'Calm' : w < 0.3 ? 'Breeze' : w < 0.55 ? 'Gusty' : w < 0.8 ? 'Gale' : 'Storm');
const btn = (act: string, label: string, cls = '', key = '') =>
  `<button type="button" class="btn ${cls}" data-act="${act}"><span class="btn__l">${label}</span>${key ? `<span class="btn__k">${key}</span>` : ''}</button>`;

function shake(el: HTMLElement, px = 5, ms = 260): void {
  if (reduced()) return;
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: `translateX(${-px}px)` },
      { transform: `translateX(${px * 0.8}px)` },
      { transform: `translateX(${-px * 0.5}px)` },
      { transform: 'translateX(0)' },
    ],
    { duration: ms, easing: 'ease-out' },
  );
}

/* ---------------- markup ---------------- */

const TEMPLATE = () => `
<div class="vig" data-r="vig" aria-hidden="true"></div>
<div class="daze" data-r="daze" aria-hidden="true"></div>
<div class="pen-flash" data-r="penFlash" aria-hidden="true"></div>

<div class="hud" data-r="hud" aria-hidden="true">
  <div class="hud-tl plate" data-r="tl">
    <div class="hud-title" data-r="title">Sandbox</div>
    <div class="hud-time"><span class="hud-clock" data-r="clock">00:00.0</span><span class="hud-par" data-r="par"></span></div>
  </div>
  <div class="hud-slowmo" data-r="slow"><i></i><b>Slow-mo</b><span data-r="slowX"></span></div>
  <div class="hud-replay" data-r="rp" aria-hidden="true">
    <div class="hud-replay__top"><b class="hud-replay__rec"><i></i>Replay</b><span data-r="rpSpeed"></span><span data-r="rpTime"></span></div>
    <div class="hud-replay__bar"><i data-r="rpBar"></i></div>
    <div class="hud-replay__keys">Mouse orbit · Wheel zoom · WASD / Q E move · Space pause · 1 2 3 speed · ← → scrub · R rewind · V exit</div>
  </div>
  <div class="hud-demo is-sandbox" data-r="demo">
    <div class="hud-demo__pct"><span data-r="pct">0</span><small>%</small></div>
    <div class="hud-demo__label" data-r="demoLabel">Demolished</div>
    <div class="hud-demo__bar"><i class="hud-demo__fill" data-r="fill"></i><span class="hud-demo__notch" data-r="notch"><span data-r="notchLabel"></span></span></div>
  </div>
  <div class="hud-tr plate" data-r="tr">
    <div class="hud-kicker">Score</div>
    <div class="hud-score" data-r="score">0</div>
    <div class="hud-combo" data-r="combo"><span class="hud-combo__x" data-r="comboX">&times;1.0</span><span class="hud-combo__meter"><i data-r="comboFill"></i></span></div>
    <div class="hud-penalty" data-r="penalty"></div>
  </div>
  <div class="xh" data-r="xh" data-w="hammer">
    <div class="xh__pulse" data-r="xhPulse">
      <div class="xh__rot"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i></div>
      <i class="xh__dot"></i><span class="xh__ring"></span>
    </div>
    <div class="xh__hit" data-r="hit"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i></div>
  </div>
  <div class="pops" data-r="pops"></div>
  <div class="hud-bottom" data-r="bottom">
    <div class="hud-dock" data-r="dock">
      <div class="hud-charges" data-r="charges"><i class="led"></i><b data-r="chargeN">0</b><span>Armed</span></div>
      <div class="hud-seq" data-r="seq"><div class="hud-seq__track" data-r="seqTrack"></div><div class="hud-seq__scale" data-r="seqScale"></div></div>
      <div class="hud-tool" data-r="tool"><div class="hud-tool__t" data-r="toolT"></div><div class="hud-tool__bar"><i data-r="toolBar"></i></div><div class="hud-tool__lines" data-r="toolL"></div><div class="hud-tool__d" data-r="toolD"></div><div class="hud-tool__keys" data-r="toolK"></div></div>
    </div>
    <div class="hud-hint" data-r="hint"></div>
    <div class="hotbar" data-r="weapons"></div>
  </div>
  <div class="tw" data-r="wheel">
    <div class="tw__dial" data-r="twDial"></div>
    <div class="tw__keys" data-r="twKeys"></div>
  </div>
  <div class="hud-fps" data-r="fps"></div>
</div>

<div class="ptr" data-r="ptr" aria-hidden="true">
  <div class="ptr__card">${MOUSE}<strong>Click to play</strong><small>Esc to pause</small></div>
</div>

<div class="ovl" data-r="ovl">
  <aside class="sbx" data-r="sbx" role="dialog" aria-label="Site control" inert>
    <span class="sbx__clip" aria-hidden="true"></span>
    <div class="sbx__paper">
      <header class="sbx__head">
        <div><div class="sbx__form">Form DV-7 &middot; Free play</div><h2 class="sbx__title">Site control</h2></div>
        <span class="stamp sbx__stamp">Live site</span>
      </header>
      <div class="sbx__row sbx__row--seg"><span class="sbx__name">Time scale</span>
        <div class="seg seg--4" role="radiogroup" aria-label="Time scale" data-r="xTime">
          ${TIME_SCALES.map(v => `<label><input type="radio" name="dv-ts" value="${v}"><span>${v}&times;</span></label>`).join('')}
        </div></div>
      <div class="sbx__row"><label for="dv-grav">Gravity</label><output data-r="oGrav"></output><input class="range" id="dv-grav" type="range" min="0.25" max="2" step="0.05" data-r="xGrav"></div>
      <div class="sbx__row"><label for="dv-joint">Joint strength</label><output data-r="oJoint"></output><input class="range" id="dv-joint" type="range" min="0.25" max="3" step="0.05" data-r="xJoint"></div>
      <div class="sbx__row"><label for="dv-wind">Wind</label><output data-r="oWind"></output><input class="range" id="dv-wind" type="range" min="0" max="1" step="0.01" data-r="xWind"><div class="sbx__scale"><span>Calm</span><span>Storm</span></div></div>
      <div class="sbx__row sbx__row--inline"><label for="dv-fire">Fire spread</label><input class="switch" id="dv-fire" type="checkbox" data-r="xFire"><output data-r="oFire"></output></div>
      <div class="sbx__row"><label for="dv-debris">Debris limit</label><output data-r="oDebris"></output><input class="range" id="dv-debris" type="range" min="600" max="4000" step="100" data-r="xDebris"></div>
    </div>
    <div class="sbx__acts">
      ${SANDBOX_ACTIONS.map(([a, label, cls]) => `<button type="button" class="pbtn ${cls}" data-sbx="${a}"><i></i><span>${label}</span></button>`).join('')}
    </div>
    <footer class="sbx__foot"><span><span class="kbd">Tab</span> / <span class="kbd">Esc</span> close</span><span>Changes apply live</span></footer>
  </aside>

  <section class="pal" data-r="pal" role="dialog" aria-label="Spawn structure" inert>
    <header class="pal__head">
      <div><div class="eyebrow">Plan chest</div><h2 class="h2">Spawn</h2></div>
      <label class="pal__search">${SEARCH}<input type="search" placeholder="Search plans" aria-label="Search plans" autocomplete="off" spellcheck="false" data-r="palSearch"></label>
      <span class="pal__count" data-r="palCount"></span>
    </header>
    <div class="pal__body" data-r="palBody"></div>
    <footer class="pal__foot"><span>Click a plan, then LMB to place &middot; RMB to cancel</span><span><span class="kbd">B</span> / <span class="kbd">Esc</span> close</span></footer>
  </section>
</div>

<section class="screen screen--loading" data-screen="loading" aria-label="Loading">
  <div class="load">
    <div class="logo logo--sm">DESTRUCTO<em>VIBE</em></div>
    <div class="load__bar"><div class="load__fill" data-r="loadFill"><i></i></div></div>
    <div class="load__meta"><span data-r="loadLabel">Mobilising crew</span><span data-r="loadPct">0%</span></div>
  </div>
  <div class="tape" aria-hidden="true"></div>
</section>

<section class="screen screen--title" data-screen="title" aria-label="Title">
  <div class="title">
    <div class="eyebrow">Structural demolition contractors</div>
    <h1 class="logo">DESTRUCTO<em>VIBE</em></h1>
    <div class="logo-rule" aria-hidden="true"></div>
    <p class="title__tag">Licensed. Insured. Unreasonably thorough.</p>
    <nav class="menu">
      ${btn('campaign', 'Contracts', 'btn--primary', 'Enter')}
      ${btn('sandbox', 'Sandbox')}
      ${btn('downtown', 'Downtown')}
      ${btn('showcase', 'Heritage Yard')}
      ${btn('railway', 'Railway Quarter')}
      ${btn('settings', 'Settings')}
    </nav>
  </div>
  <footer class="title__foot"><span>RasputinKaiser</span><span>Site office v2.0</span></footer>
</section>

<section class="screen screen--contracts screen--sheet" data-screen="contracts" aria-label="Contracts">
  <div class="sheet">
    <header class="sheet__head">
      <div><div class="eyebrow">Job board</div><h2 class="h2">Contracts</h2></div>
      ${btn('back', 'Back', 'btn--ghost', 'Esc')}
    </header>
    <div class="chapters" data-r="cards"></div>
  </div>
</section>

<section class="screen screen--briefing screen--sheet" data-screen="briefing" aria-label="Briefing">
  <article class="brief bp">
    <header class="brief__head">
      <span class="brief__no" data-r="bNo"></span>
      <h2 class="brief__name" data-r="bName"></h2>
      <div class="brief__loc" data-r="bLoc"></div>
    </header>
    <div class="brief__grid">
      <div class="brief__main">
        <h3 class="label">Work order</h3>
        <p class="brief__text" data-r="bText"></p>
        <div class="protect" data-r="bProtect">${WARN}<div><strong>Protected structure</strong><span data-r="bProtectText"></span></div></div>
        <h3 class="label" data-r="bTermsLabel">Conditions of contract</h3>
        <ul class="terms" data-r="bTerms"></ul>
        <h3 class="label">Issued ordnance</h3>
        <ul class="ordnance" data-r="bAmmo"></ul>
      </div>
      <aside class="brief__side">
        <dl class="specs">
          <div><dt>Target</dt><dd data-r="bTarget"></dd></div>
          <div><dt>Par</dt><dd data-r="bPar"></dd></div>
          <div class="is-env"><dt>Conditions</dt><dd data-r="bEnv"></dd></div>
        </dl>
        <h3 class="label">Rating</h3>
        <ol class="thresholds" data-r="bStars"></ol>
        <h3 class="label">Controls for this job</h3>
        <dl class="keys" data-r="bKeys"></dl>
        <p class="brief__more">Full list: <span class="kbd">Esc</span> in play</p>
      </aside>
    </div>
    <footer class="brief__foot">
      ${btn('back', 'Back', 'btn--ghost', 'Esc')}
      ${btn('start', 'Start demolition', 'btn--primary', 'Enter')}
    </footer>
  </article>
</section>

<section class="screen screen--pause" data-screen="pause" aria-label="Paused">
  <div class="pause">
    <div class="pause__col">
      <div class="eyebrow">Site work suspended</div>
      <h2 class="h1">Paused</h2>
      <nav class="menu">
        ${btn('resume', 'Resume', 'btn--primary', 'Esc')}
        ${btn('signoff', 'Sign off the job')}
        ${btn('restart', 'Restart')}
        ${btn('settings', 'Settings')}
        ${btn('quit', 'Quit to title', 'btn--danger')}
      </nav>
    </div>
    <div class="panel pause__keys" data-r="pauseKeys"><h3 class="label">Controls</h3>${keys(true)}</div>
  </div>
</section>

<section class="screen screen--results" data-screen="results" aria-label="Results">
  <div class="report" data-r="report">
    <header class="report__band"><span class="report__title" data-r="rTitle"></span></header>
    <div class="report__sub" data-r="rSub"></div>
    <ol class="report__rows" data-r="rRows"></ol>
    <div class="report__total" data-r="rTotalRow"><span>Total</span><b data-r="rTotal">0</b></div>
    <div class="report__stars" data-r="rStars">${[0, 1, 2].map(() => `<span class="rstar">${STAR}</span>`).join('')}</div>
    <div class="stamp report__best" data-r="rBest">New best</div>
    <div class="report__unlock" data-r="rUnlock"></div>
    <footer class="report__foot">
      ${btn('quit', 'Quit', 'btn--ghost')}
      <button type="button" class="btn" data-act="retry" data-r="rRetry"><span class="btn__l">Retry</span><span class="btn__k">Enter</span></button>
      <button type="button" class="btn btn--primary" data-act="next" data-r="rNext"><span class="btn__l">Next contract</span><span class="btn__k">Enter</span></button>
    </footer>
  </div>
</section>

<section class="screen screen--settings screen--sheet" data-screen="settings" aria-label="Settings">
  <div class="sheet settings">
    <header class="sheet__head">
      <div><div class="eyebrow">Site office</div><h2 class="h2">Settings</h2></div>
      ${btn('back', 'Back', 'btn--ghost', 'Esc')}
    </header>
    <div class="set-list">
      <h3 class="set-group">Sound &amp; picture</h3>
      <div class="set-row"><label for="dv-vol">Volume</label><input class="range" id="dv-vol" type="range" min="0" max="1" step="0.01" data-r="sVol"><output data-r="oVol"></output></div>
      <div class="set-row"><span class="set-name">Quality</span>
        <div class="seg" role="radiogroup" aria-label="Quality" data-r="sQual">
          ${(['low', 'medium', 'high'] as Quality[]).map(q => `<label><input type="radio" name="dv-quality" value="${q}"><span>${q}</span></label>`).join('')}
        </div><output></output></div>
      <div class="set-row"><span class="set-name">Render scale</span>
        <div class="seg seg--5" role="radiogroup" aria-label="Render scale" data-r="sScale">
          ${RENDER_SCALES.map(([v, l]) => `<label title="${v ? `${l} of the quality's resolution` : 'Holds 60 fps by trading resolution, then brick detail distance'}"><input type="radio" name="dv-scale" value="${v}"><span>${l}</span></label>`).join('')}
        </div><output></output></div>
      <div class="set-row"><label for="dv-fov">Field of view</label><input class="range" id="dv-fov" type="range" min="70" max="120" step="1" data-r="sFov"><output data-r="oFov"></output></div>
      <div class="set-row"><label for="dv-grain">Film grain</label><input class="switch" id="dv-grain" type="checkbox" data-r="sGrain"><output data-r="oGrain"></output></div>
      <div class="set-row"><label for="dv-ca">Chromatic aberration</label><input class="switch" id="dv-ca" type="checkbox" data-r="sCA"><output data-r="oCA"></output></div>
      <h3 class="set-group">Controls</h3>
      <div class="set-row"><label for="dv-sens">Mouse sensitivity</label><input class="range" id="dv-sens" type="range" min="0.2" max="3" step="0.05" data-r="sSens"><output data-r="oSens"></output></div>
      <div class="set-row"><label for="dv-inv">Invert Y</label><input class="switch" id="dv-inv" type="checkbox" data-r="sInv"><output data-r="oInv"></output></div>
      <div class="set-row"><label for="dv-ctog">Toggle crouch</label><input class="switch" id="dv-ctog" type="checkbox" data-r="sCTog"><output data-r="oCTog"></output></div>
      <div class="set-row"><label for="dv-stog">Toggle sprint</label><input class="switch" id="dv-stog" type="checkbox" data-r="sSTog"><output data-r="oSTog"></output></div>
      <div class="set-row"><span class="set-name" title="Each tool's buttons under its readout">Control prompts</span>
        <div class="seg" role="radiogroup" aria-label="Control prompts" data-r="sPr">
          ${PROMPTS.map(([v, l]) => `<label><input type="radio" name="dv-prompts" value="${v}"><span>${l}</span></label>`).join('')}
        </div><output></output></div>
      <h3 class="set-group">Comfort &amp; access</h3>
      <div class="set-row"><label for="dv-ui">Interface size</label><input class="range" id="dv-ui" type="range" min="0.8" max="1.5" step="0.05" data-r="sUi"><output data-r="oUi"></output></div>
      <div class="set-row"><label for="dv-cb" title="Good and bad shown in blue and orange, with marks, not green against red">Colour-blind palette</label><input class="switch" id="dv-cb" type="checkbox" data-r="sCb"><output data-r="oCb"></output></div>
      <div class="set-row"><label for="dv-fl" title="Dims blast, arc and muzzle flashes, the blast vignette and the damage flash">Reduce flashing</label><input class="switch" id="dv-fl" type="checkbox" data-r="sFl"><output data-r="oFl"></output></div>
      <div class="set-row"><label for="dv-rm" title="Stills the HUD's own bumps, slides and pulses (the system setting does too)">Reduce motion</label><input class="switch" id="dv-rm" type="checkbox" data-r="sRm"><output data-r="oRm"></output></div>
      <div class="set-row"><label for="dv-shake">Camera shake</label><input class="switch" id="dv-shake" type="checkbox" data-r="sShake"><output data-r="oShake"></output></div>
      <div class="set-row"><label for="dv-bob">Head bob</label><input class="switch" id="dv-bob" type="checkbox" data-r="sBob"><output data-r="oBob"></output></div>
      <div class="set-row"><span class="set-name" title="What falls and falling debris do to you">Impacts</span>
        <div class="seg" role="radiogroup" aria-label="Impacts" data-r="sImp">
          ${IMPACTS.map(([v, l, t]) => `<label title="${t}"><input type="radio" name="dv-impacts" value="${v}"><span>${l}</span></label>`).join('')}
        </div><output></output></div>
      <h3 class="set-group">Free play</h3>
      <div class="set-row"><label for="dv-exp">Sandbox explosives</label><input class="switch" id="dv-exp" type="checkbox" data-r="sExp"><output data-r="oExp"></output></div>
    </div>
    <div class="keymap-head"><div class="eyebrow">Controls</div><span class="keymap-note" data-r="keyNote">Click a key to change it · Esc cancels · a gamepad works in menus and play (Start pauses)</span>
      <button type="button" class="btn btn--ghost btn--sm" data-r="keyReset"><span class="btn__l">Reset keys</span></button></div>
    <div class="keymap" data-r="keys">
      ${ACTIONS.map(a => `<div class="key-row"><span class="key-name">${a.label}</span><button type="button" class="keycap" data-key="${a.id}" aria-label="${a.label}: change key"></button></div>`).join('')}
    </div>
  </div>
</section>

<div class="toasts" data-r="toasts" aria-live="polite"></div>
`;

const REFS = [
  'vig', 'penFlash', 'hud', 'tl', 'title', 'clock', 'par', 'demo', 'pct', 'demoLabel', 'fill', 'notch', 'notchLabel',
  'tr', 'score', 'combo', 'comboX', 'comboFill', 'penalty', 'xh', 'xhPulse', 'hit', 'pops', 'charges', 'chargeN', 'hint',
  'weapons', 'fps', 'ptr', 'tool', 'toolT', 'toolBar', 'toolD', 'toolL', 'toolK', 'bottom', 'dock', 'wheel', 'twDial', 'twKeys', 'seq', 'seqTrack', 'seqScale', 'loadFill', 'loadLabel', 'loadPct', 'cards', 'bNo', 'bName', 'bLoc', 'bText', 'bProtect',
  'bProtectText', 'bTerms', 'bTermsLabel', 'bAmmo', 'bKeys', 'bTarget', 'bPar', 'bEnv', 'bStars', 'report', 'rTitle', 'rSub', 'rRows', 'rTotalRow', 'rTotal',
  'rStars', 'rBest', 'rUnlock', 'rRetry', 'rNext', 'sVol', 'oVol', 'sQual', 'sSens', 'oSens', 'sFov', 'oFov', 'sInv', 'oInv', 'sExp', 'oExp', 'sScale', 'sShake', 'oShake', 'sGrain', 'oGrain', 'sCA', 'oCA',
  'pauseKeys', 'sUi', 'oUi', 'sCb', 'oCb', 'sFl', 'oFl', 'sRm', 'oRm', 'sPr', 'sBob', 'oBob', 'sCTog', 'oCTog', 'sSTog', 'oSTog', 'sImp', 'keys', 'keyReset', 'keyNote', 'daze',
  'toasts', 'slow', 'slowX', 'rp', 'rpSpeed', 'rpTime', 'rpBar', 'ovl', 'sbx', 'pal', 'palSearch', 'palCount', 'palBody', 'xTime', 'xGrav', 'oGrav', 'xJoint', 'oJoint',
  'xWind', 'oWind', 'xFire', 'oFire', 'xDebris', 'oDebris',
] as const;
type Ref = (typeof REFS)[number];

/* ---------------- state ---------------- */

/** the free-play sites past the three in UiHandlers, and contract cards with the chapter they are filed under */
export type Handlers = UiHandlers & { onRailway(): void; onSignOff(): void };
export type JobCard = ContractCard & { chapter: string };
/** conditions beyond the demolition target (what it counts, footprint, time limit, salvage) */
export type JobBriefing = BriefingView & { terms?: string[] };

let H: Handlers | null = null;
let S: Settings = { ...DEFAULT_SETTINGS };
let root: HTMLElement | null = null;
let viewport: HTMLElement | null = null;
let current: ScreenId | null = 'loading';
let R = {} as Record<Ref, HTMLElement>;
const screens = new Map<ScreenId, HTMLElement>();

/* ---------------- lifecycle ---------------- */

export function getViewport(): HTMLElement {
  if (viewport) return viewport;
  let el = document.getElementById('viewport');
  if (!el) {
    el = document.createElement('div');
    el.id = 'viewport';
    document.body.prepend(el);
  }
  return (viewport = el);
}

/** settings the page itself carries out: interface size, the palette, motion */
function applyLook(): void {
  if (!root) return;
  root.dataset.quality = S.quality;
  document.documentElement.style.setProperty('--ui-scale', String(S.uiScale));
  root.classList.toggle('cb', S.colorblind);
  root.classList.toggle('calm', S.reduceMotion);
  root.classList.toggle('dim-flash', S.reduceFlash);
  layoutDirty = true;
}

export function initUI(h: Handlers, settings: Settings): void {
  H = h;
  S = { ...settings };
  if (root) return;
  getViewport();
  let el = document.getElementById('ui');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ui';
    document.body.append(el);
  }
  root = el;
  root.innerHTML = TEMPLATE();
  for (const k of REFS) {
    const r = root.querySelector<HTMLElement>(`[data-r="${k}"]`);
    if (!r) throw new Error(`ui: missing [data-r=${k}]`);
    R[k] = r;
  }
  root.querySelectorAll<HTMLElement>('[data-screen]').forEach(s => screens.set(s.dataset.screen as ScreenId, s));
  bindSettings();
  bindSandbox();
  bindInput();
  addEventListener('resize', () => { layoutDirty = true; });
  document.getElementById('boot')?.remove();
  showScreen(current);
}

function bindInput(): void {
  const r = root!;
  const first = () => {
    window.removeEventListener('pointerdown', first, true);
    window.removeEventListener('keydown', first, true);
    H?.onUserGesture();
  };
  window.addEventListener('pointerdown', first, true);
  window.addEventListener('keydown', first, true);

  r.addEventListener('click', e => {
    const t = e.target as Element;
    if (t === R.ovl) return closeByUser();
    const b = t.closest<HTMLElement>('[data-act], [data-sbx], [data-prefab]');
    if (!b || !r.contains(b)) return;
    if (b.dataset.act) act(b.dataset.act, b);
    else if (b.dataset.sbx) sandboxAction(b.dataset.sbx as SandboxAction, b);
    else if (b.dataset.prefab) pickPrefab(b.dataset.prefab);
  });

  let hovered: Element | null = null;
  r.addEventListener('pointerover', e => {
    const b = (e.target as Element).closest('button, .seg label, .switch');
    if (b === hovered) return;
    hovered = b;
    if (b && !b.classList.contains('is-locked')) audio.ui('hover');
  });

  // the mouse is back: focus marks return to the browser's own judgement
  r.addEventListener('pointermove', e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) { r.classList.remove('nav-keys'); if (current !== null) chipLabels(); } });
  r.addEventListener('pointerdown', e => {
    if (current === 'results' && resFinish && !(e.target as Element).closest('button')) finishResults();
  });

  window.addEventListener('keydown', e => { if (e.key === 'Enter') enterHeld = true; if (current !== null) chipLabels(); });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => {
    if (e.key !== 'Enter') return;
    enterHeld = false;
    if (current === 'results') resKeyFresh = true;
  });
  window.addEventListener('blur', () => { enterHeld = false; });
}

function onKey(e: KeyboardEvent): void {
  if (overlay) {
    // the overlay owns the keyboard: keep keystrokes (search text, Tab, B) away from gameplay input
    e.stopImmediatePropagation();
    onOverlayKey(e);
    return;
  }
  if (!root || !H || current === null) return;
  const s = current;
  if (e.key.startsWith('Arrow') && s !== 'loading') {
    // menus: arrows move between controls (a slider or option row keeps left/right for its value)
    const t = e.target as HTMLElement | null;
    const valued = t instanceof HTMLInputElement && (t.type === 'range' || t.type === 'radio');
    if (valued && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    e.preventDefault();
    move(({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as 'ArrowUp'] ?? 'down', true);
    return;
  }
  // an Enter held from "sign off" must not press the report's focused button before it has been read
  if (e.key === 'Enter' && s === 'results' && (e.repeat || !resKeyFresh || performance.now() - resultsAt < 900)) { e.preventDefault(); return; }
  if (e.repeat) return;
  if (e.key === 'Escape') {
    if (!back()) return;
    e.preventDefault();
  } else if (e.key === 'Enter') {
    if ((e.target as Element | null)?.closest?.('button, input, select, textarea, label')) return;
    if (s === 'title') run('onCampaign');
    else if (s === 'briefing') run('onStartContract');
    else if (s === 'results') {
      /* an Enter meant for "sign off" that lands as the job signs itself off must not skip the report unread: only a
         press that starts after the report is up counts, and while the figures are still counting it only finishes them */
      if (!resKeyFresh || performance.now() - resultsAt < 900) { e.preventDefault(); return; }
      if (resFinish) { finishResults(); e.preventDefault(); return; }
      run(resHasNext ? 'onNext' : 'onRetry');
    }
    else return;
    e.preventDefault();
  }
}

/* ---------------- menu navigation (keys and pad) ---------------- */

/** Esc / B: one screen back. False when the screen has no back. */
function back(): boolean {
  const s = current;
  if (s === 'contracts' || s === 'briefing' || s === 'settings') run('onBack');
  else if (s === 'pause') run('onResume');
  else if (s === 'results') {
    if (performance.now() - resultsAt < 900) return true;
    if (resFinish) { finishResults(); return true; }
    run('onBack');
  } else return false;
  return true;
}

function controlsOf(scope: Element): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('button, input:not([type=radio]), .seg input:checked, .seg label'))
    .map(el => (el.matches('.seg label') ? el.querySelector<HTMLInputElement>('input:checked') ?? el.querySelector<HTMLInputElement>('input') : el))
    .filter((el, i, a): el is HTMLElement => !!el && a.indexOf(el) === i && !(el as HTMLButtonElement).disabled && !el.closest('[hidden], [inert]') && (el.offsetParent !== null || !!el.closest('.seg')));
}

let navMark: Element | null = null;
function focusEl(el: HTMLElement, pad: boolean): void {
  if (pad) root?.classList.add('nav-keys');
  // the mark is a class as well as focus: it shows whether or not the page has the system's focus
  navMark?.classList.remove('is-nav');
  navMark = el.matches('.seg input') ? el.closest('label') : el;
  navMark?.classList.add('is-nav');
  (el.focus as (o?: FocusOptions & { focusVisible?: boolean }) => void)({ preventScroll: false, focusVisible: pad || undefined });
  el.closest('.seg, .set-row, .card, .btn')?.scrollIntoView({ block: 'nearest' });
}

/* Spatial: the nearest control whose centre lies that way, weighted against sideways drift. */
function move(dir: 'up' | 'down' | 'left' | 'right', pad: boolean): void {
  const scope = current ? screens.get(current) : null;
  if (!scope) return;
  const list = controlsOf(scope);
  if (!list.length) return;
  const ae = document.activeElement as HTMLElement | null;
  const from = ae && list.includes(ae) ? ae : null;
  if (!from) { focusEl(scope.querySelector<HTMLElement>('.btn--primary:not([hidden])') ?? list[0], pad); return; }
  const box = (el: HTMLElement) => (el.matches('.seg input') ? el.closest('label')! : el).getBoundingClientRect();
  const a = box(from), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null, bd = Infinity;
  for (const el of list) {
    if (el === from) continue;
    const b = box(el), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    const side = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along <= 2) continue;
    const d = along + side * 2.5;
    if (d < bd) { bd = d; best = el; }
  }
  if (best) { focusEl(best, pad); audio.ui('hover'); }
}

/** the right stick scrolls a long screen (the briefing's controls, the settings, the pause list) */
export function padScroll(dy: number): void {
  if (!root || current === null || Math.abs(dy) < 0.2) return;
  const scope = screens.get(current);
  if (!scope) return;
  for (const el of [scope, ...Array.from(scope.querySelectorAll<HTMLElement>('.sheet, .brief, .pause, .pause__keys, .chapters, .report'))]) {
    if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)) { el.scrollBy(0, dy * 22); return; }
  }
}

/** A pad's menu input this frame (main polls the pad outside play). */
export function padNav(nav: ReadonlySet<string>): void {
  if (!root || current === null || current === 'loading') return;
  chipLabels();
  if (overlay) { if (nav.has('back') || nav.has('start')) closeByUser(); return; }
  const ae = document.activeElement as HTMLElement | null;
  const scope = screens.get(current);
  const inScope = !!ae && !!scope?.contains(ae) && ae !== scope;
  for (const d of ['up', 'down', 'left', 'right'] as const) {
    if (!nav.has(d)) continue;
    // a slider or an option row takes left/right as its value
    if (inScope && ae instanceof HTMLInputElement && (d === 'left' || d === 'right')) {
      if (ae.type === 'range') { if (d === 'left') ae.stepDown(); else ae.stepUp(); ae.dispatchEvent(new Event('input', { bubbles: true })); continue; }
      if (ae.type === 'radio') {
        const group = Array.from(ae.closest('.seg')!.querySelectorAll<HTMLInputElement>('input[type=radio]'));
        const next = group[clamp(group.indexOf(ae) + (d === 'left' ? -1 : 1), 0, group.length - 1)];
        if (next !== ae) { next.checked = true; next.dispatchEvent(new Event('change', { bubbles: true })); focusEl(next, true); }
        continue;
      }
    }
    move(d, true);
  }
  if (nav.has('ok')) {
    if (!inScope) move('down', true);
    else if (current === 'results' && resFinish) finishResults();
    else ae!.click();
  }
  if (nav.has('back')) back();
  if (nav.has('start')) { if (current === 'pause') run('onResume'); else if (current === 'title') run('onCampaign'); }
}

type Action = Exclude<
  keyof Handlers,
  'onPickContract' | 'onSettingsChange' | 'onUserGesture' | 'onSandboxChange' | 'onSandboxAction' | 'onSpawnPick' | 'onOverlayClosed'
>;
const ACTS: Record<string, Action> = {
  campaign: 'onCampaign',
  sandbox: 'onSandbox',
  showcase: 'onShowcase',
  downtown: 'onDowntown',
  railway: 'onRailway',
  settings: 'onOpenSettings',
  back: 'onBack',
  start: 'onStartContract',
  resume: 'onResume',
  restart: 'onRestart',
  quit: 'onQuit',
  next: 'onNext',
  retry: 'onRetry',
  signoff: 'onSignOff',
};

function run(k: Action): void {
  audio.ui('click');
  H?.[k]();
}

function act(a: string, el: HTMLElement): void {
  if (!H) return;
  if (a !== 'pick') {
    const k = ACTS[a];
    if (k) run(k);
    return;
  }
  if (el.classList.contains('is-locked')) {
    audio.ui('deny');
    shake(el);
    return;
  }
  audio.ui('click');
  H.onPickContract(Number(el.dataset.i));
}

/* ---------------- screens ---------------- */

/** the pause menu offers "sign off" on a contract (a pad has no Enter) */
export function setSignOff(on: boolean, met = true): void {
  root?.querySelectorAll<HTMLElement>('[data-act="signoff"]').forEach(b => {
    b.hidden = !on;
    const l = b.querySelector('.btn__l');
    // signing off short of the target fails the job: the button says so
    if (l) l.textContent = met ? 'Sign off the job' : 'Sign off — target not met';
    b.classList.toggle('btn--danger', !met);
  });
}

/* key chips on menu buttons read as the pad's buttons while a pad is what the player is using */
const PAD_KEY: Record<string, string> = { Enter: 'A', Esc: 'B' };
let padChips: boolean | null = null;
function chipLabels(): void {
  const p = usingPad();
  if (!root || p === padChips) return;
  padChips = p;
  for (const k of root.querySelectorAll<HTMLElement>('.btn__k')) {
    k.dataset.k ??= k.textContent ?? '';
    k.textContent = p ? PAD_KEY[k.dataset.k] ?? k.dataset.k : k.dataset.k;
  }
}

export function showScreen(s: ScreenId | null): void {
  current = s;
  if (!root) return;
  chipLabels();
  if (s === 'pause') R.pauseKeys.innerHTML = `<h3 class="label">Controls</h3>${keys(true)}`;
  root.dataset.view = s ?? 'game';
  const target = s ? screens.get(s) : undefined;
  const ae = document.activeElement;
  if (ae instanceof HTMLElement && root.contains(ae) && !(target && target.contains(ae))) ae.blur();
  if (s !== null) closeOverlays();
  for (const [id, el] of screens) {
    const on = id === s;
    el.classList.toggle('is-active', on);
    el.inert = !on;
  }
  // a menu comes up with its main button in focus, so Enter, arrows or a pad work from the first press
  if (target && s !== 'loading') {
    // the job board starts on the next job to do (the first issued one not yet cleared)
    const first = (s === 'contracts' ? target.querySelector<HTMLElement>('.card:not(.is-locked):not(.is-cleared)') ?? target.querySelector<HTMLElement>('.card:not(.is-locked)') : null)
      ?? target.querySelector<HTMLElement>('.btn--primary:not([hidden])')
      // a failed report's way forward is another go
      ?? (s === 'results' ? target.querySelector<HTMLElement>('[data-act="retry"]') : null) ?? controlsOf(target)[0];
    if (first) requestAnimationFrame(() => { if (current === s && !target.contains(document.activeElement)) focusEl(first, usingPad()); });
  }
  if (s === 'results') {
    resultsAt = performance.now();
    resKeyFresh = !enterHeld;
    if (resPending) startResults();
  } else if (resFinish) finishResults();
}

export function setLoading(progress: number, label: string): void {
  if (!root) return;
  const p = clamp(progress, 0, 1);
  R.loadFill.style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)`;
  R.loadPct.textContent = `${Math.round(p * 100)}%`;
  if (R.loadLabel.textContent !== label) R.loadLabel.textContent = label;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/* Contracts are filed by chapter (one site or kind of job each), in the order they unlock. */
export function renderContracts(cards: JobCard[]): void {
  if (!root) return;
  const chapters: { name: string; cards: JobCard[] }[] = [];
  for (const c of cards) {
    const last = chapters[chapters.length - 1];
    if (last && last.name === c.chapter) last.cards.push(c);
    else chapters.push({ name: c.chapter, cards: [c] });
  }
  let d = 0;
  R.cards.innerHTML = chapters
    .map((ch, k) => {
      const cleared = ch.cards.filter(c => c.stars > 0).length;
      const got = ch.cards.reduce((n, c) => n + c.stars, 0);
      const locked = ch.cards.every(c => c.locked);
      return `<section class="chapter${locked ? ' is-locked' : ''}${cleared === ch.cards.length ? ' is-done' : ''}" aria-label="${esc(ch.name)}">
  <header class="chapter__head">
    <span class="chapter__no">Chapter ${ROMAN[k] ?? k + 1}</span>
    <h3 class="chapter__name">${esc(ch.name)}</h3>
    <span class="chapter__count">${locked ? `${LOCK}Locked` : `${cleared}/${ch.cards.length} cleared<b>${STAR}${got}/${ch.cards.length * 3}</b>`}</span>
  </header>
  <div class="cards">${ch.cards.map(c => card(c, d++)).join('')}</div>
</section>`;
    })
    .join('');
}

function card(c: JobCard, i: number): string {
  const cleared = c.stars > 0;
  const rot = -9 + ((c.index * 37) % 11);
  return `<button type="button" class="card bp${c.locked ? ' is-locked' : ''}${cleared ? ' is-cleared' : ''}" data-act="pick" data-i="${c.index}"${c.locked ? ' aria-disabled="true"' : ''} style="--d:${i};--rot:${rot}deg">
  <span class="card__top"><span class="card__no">No. ${pad2(c.index + 1)}</span>${stars(c.stars)}</span>
  <span class="card__name">${esc(c.name)}</span>
  <span class="card__loc">${esc(c.location)}</span>
  <span class="card__best">${c.best > 0 ? `Best<b>${fmt(c.best)}</b>` : c.locked ? 'Not yet issued' : 'Not attempted'}</span>
  ${cleared ? '<span class="stamp card__stamp">Cleared</span>' : ''}
  ${c.locked ? `<span class="card__lock"><span>${LOCK}Locked</span></span>` : ''}
</button>`;
}

/* The briefing lists the keys this job's loadout needs; the pause screen keeps the full list. */
function jobKeys(ids: WeaponId[]): KeyRow[] {
  const has = (...w: WeaponId[]) => w.some(id => ids.includes(id));
  if (usingPad()) {
    const rows: KeyRow[] = [
      ['L stick · R stick', 'Move · look · L3 sprint · A jump / climb'],
      ['RT', has('hammer') ? 'Fire / use the tool · hold the sledge to wind up, release to strike' : 'Fire / use the tool'],
      ['D-pad ← →', 'Quick slots'],
    ];
    if (ids.length > 1) rows.push(['D-pad ↑', 'Hold: tool wheel (right stick points, A takes) · tap: last tool']);
    rows.push(['LB RB', 'Tool setting (charge size, delay…), else the next slot']);
    if (has('charge', 'cutter', 'planner', 'satchel')) rows.push(['LT · Y', 'Detonate what you have placed']);
    if (has('excavator')) rows.push(['X', 'Climb into the machine / get out']);
    rows.push(['Start', 'Pause: every control, and sign off the job']);
    return rows;
  }
  const rows: KeyRow[] = [
    [`${K('forward')} ${K('left')} ${K('back')} ${K('right')}`, `Move · mouse to look · ${K('sprint')} sprint · ${K('jump')} jump / climb`],
    ['LMB', has('hammer') ? 'Fire / use the tool · hold the sledge to wind up, release to strike' : 'Fire / use the tool'],
    [ids.length > 6 ? `1–6 · ${K('bank')}` : '1–6', ids.length > 6 ? `Quick slots · hold ${K('bank')} for every tool` : `Pick a tool · tap ${K('bank')} for the last one`],
  ];
  if (has('charge', 'cutter', 'planner', 'satchel')) rows.push([`${K('detonate')} / RMB`, 'Detonate what you have placed'], ['Wheel', 'Charge size / delay on the tool in hand']);
  if (has('excavator')) rows.push([K('interact'), 'Climb into the machine / get out']);
  /* the viewing aids wait until a job has enough going on to need them (Esc lists them all along) */
  if (ids.length > 3 || has('charge')) rows.push([K('xray'), 'Engineer’s x-ray: which joints carry the load'], [K('bullet'), 'Bullet time'], [K('replay'), 'Replay the last 12 s']);
  rows.push(['Enter', 'Sign off (or call the job early)'], [`${K('restart')} · Esc`, 'Restart · pause, with every control']);
  return rows;
}

export function renderBriefing(v: JobBriefing): void {
  if (!root) return;
  R.bNo.textContent = `Contract No. ${pad2(v.index + 1)}`;
  R.bName.textContent = v.name;
  R.bLoc.textContent = v.location;
  R.bText.textContent = v.brief;
  R.bProtect.hidden = !v.protectedNote;
  R.bProtectText.textContent = v.protectedNote ?? '';
  const terms = v.terms ?? [];
  R.bTerms.hidden = R.bTermsLabel.hidden = !terms.length;
  R.bTerms.innerHTML = terms.map(t => `<li>${esc(t)}</li>`).join('');
  R.bTarget.textContent = `${Math.round(v.target * 100)}%`;
  R.bPar.textContent = clockS(v.par);
  R.bEnv.textContent = ENV_LABEL[v.env];
  R.bStars.innerHTML =
    `<li>${stars(1)}<span>Hit ${Math.round(v.target * 100)}% target</span></li>` +
    `<li>${stars(2)}<span>${fmt(v.stars[0])} pts</span></li>` +
    `<li>${stars(3)}<span>${fmt(v.stars[1])} pts</span></li>`;
  R.bKeys.innerHTML = keyRows(jobKeys(v.ammo.map(a => a.id)));
  R.bAmmo.innerHTML = v.ammo.length
    ? v.ammo
        .map(a => `<li><span class="ord__icon">${WEAPON_ICON[a.id]}</span><span class="ord__name">${esc(a.name)}</span><span class="ord__n">${a.count < 0 ? '∞' : `&times;${a.count}`}</span></li>`)
        .join('')
    : '<li class="ord--none">Bare hands. Good luck.</li>';
}

/* ---------------- results ---------------- */

interface Tween {
  el: HTMLElement;
  to: number;
  t0: number;
  dur: number;
  last: number;
}
let tweens: Tween[] = [];
let tweenRaf = 0;
let resTimers: number[] = [];
let resPending: ResultsView | null = null;
let resFinish: (() => void) | null = null;
let resHasNext = false;
let resultsAt = -1e9;
/* Enter is down now; the results screen has seen no Enter held over from the game since it came up */
let enterHeld = false, resKeyFresh = false;

function countUp(el: HTMLElement, to: number, dur: number): void {
  tweens.push({ el, to, t0: performance.now(), dur, last: NaN });
  if (!tweenRaf) tweenRaf = requestAnimationFrame(stepTweens);
}

function stepTweens(now: number): void {
  tweenRaf = 0;
  tweens = tweens.filter(tw => {
    const k = clamp((now - tw.t0) / tw.dur, 0, 1);
    const val = Math.round(tw.to * easing.cubicOut(k));
    if (val !== tw.last) {
      tw.last = val;
      tw.el.textContent = fmt(val);
    }
    return k < 1;
  });
  if (tweens.length) tweenRaf = requestAnimationFrame(stepTweens);
}

function stopResults(): void {
  for (const t of resTimers) window.clearTimeout(t);
  resTimers = [];
  if (tweenRaf) cancelAnimationFrame(tweenRaf);
  tweenRaf = 0;
  tweens = [];
  resFinish = null;
}

export function renderResults(v: ResultsView): void {
  if (!root) return;
  stopResults();
  R.report.classList.toggle('is-won', v.won);
  R.report.classList.toggle('is-failed', !v.won);
  R.rTitle.textContent = v.title;
  R.rSub.textContent = v.subtitle;
  R.rRows.innerHTML = v.rows
    .map(r => `<li class="row"><span class="row__label">${esc(r.label)}</span><span class="row__dots"></span><b class="row__val${r.value < 0 ? ' is-neg' : ''}">0</b></li>`)
    .join('');
  R.rTotal.textContent = '0';
  R.rTotalRow.classList.remove('is-in');
  for (const s of R.rStars.children) s.classList.remove('is-on');
  R.rStars.classList.toggle('is-none', v.stars === 0);
  R.rBest.classList.remove('is-in');
  R.rUnlock.classList.remove('is-in');
  R.rUnlock.textContent = v.unlockText ?? '';
  resHasNext = v.hasNext && v.won;
  R.rNext.hidden = !resHasNext;
  R.rRetry.classList.toggle('has-key', !resHasNext);
  resPending = v;
  if (current === 'results') startResults();
}

function startResults(): void {
  const v = resPending;
  resPending = null;
  if (!v) return;
  const rows = Array.from(R.rRows.children) as HTMLElement[];
  const vals = rows.map(r => r.querySelector<HTMLElement>('.row__val')!);
  const starEls = Array.from(R.rStars.children) as HTMLElement[];
  const earned = clamp(Math.round(v.stars), 0, 3);
  const at = (ms: number, fn: () => void) => resTimers.push(window.setTimeout(fn, ms));

  resFinish = () => {
    rows.forEach((r, i) => {
      r.classList.add('is-in');
      vals[i].textContent = fmt(v.rows[i].value);
    });
    R.rTotalRow.classList.add('is-in');
    R.rTotal.textContent = fmt(v.total);
    for (let i = 0; i < earned; i++) starEls[i].classList.add('is-on');
    if (v.newBest) R.rBest.classList.add('is-in');
    if (v.unlockText) R.rUnlock.classList.add('is-in');
  };

  let t = 320;
  rows.forEach((row, i) => {
    at(t, () => {
      row.classList.add('is-in');
      countUp(vals[i], v.rows[i].value, 420);
    });
    t += 190;
  });
  t += 220;
  at(t, () => {
    R.rTotalRow.classList.add('is-in');
    countUp(R.rTotal, v.total, 900);
  });
  t += 1000;
  for (let i = 0; i < earned; i++) {
    at(t, () => {
      starEls[i].classList.add('is-on');
      audio.ui('star');
      shake(R.report, 3, 180);
    });
    t += 380;
  }
  if (v.newBest) {
    at(t, () => {
      R.rBest.classList.add('is-in');
      audio.ui('star');
    });
    t += 360;
  }
  if (v.unlockText) {
    at(t, () => {
      R.rUnlock.classList.add('is-in');
      audio.ui('toast');
    });
    t += 300;
  }
  at(t, () => {
    resFinish = null;
    resTimers = [];
  });
}

function finishResults(): void {
  const f = resFinish;
  stopResults();
  f?.();
}

/* ---------------- settings ---------------- */

function fillRange(el: HTMLInputElement): void {
  const lo = Number(el.min), hi = Number(el.max);
  el.style.setProperty('--p', `${((Number(el.value) - lo) / (hi - lo)) * 100}%`);
}

function bindSettings(): void {
  const vol = R.sVol as HTMLInputElement;
  const sens = R.sSens as HTMLInputElement;
  const fov = R.sFov as HTMLInputElement;
  const inv = R.sInv as HTMLInputElement;
  const exp = R.sExp as HTMLInputElement;
  const toggles = [
    [R.sShake, R.oShake, 'shake'], [R.sGrain, R.oGrain, 'grain'], [R.sCA, R.oCA, 'aberration'],
    [R.sBob, R.oBob, 'headBob'], [R.sCTog, R.oCTog, 'crouchToggle'], [R.sSTog, R.oSTog, 'sprintToggle'],
    [R.sCb, R.oCb, 'colorblind'], [R.sFl, R.oFl, 'reduceFlash'], [R.sRm, R.oRm, 'reduceMotion'],
  ] as [HTMLInputElement, HTMLElement, 'shake' | 'grain' | 'aberration' | 'headBob' | 'crouchToggle' | 'sprintToggle' | 'colorblind' | 'reduceFlash' | 'reduceMotion'][];
  const uiScale = R.sUi as HTMLInputElement;
  const prompts = Array.from(R.sPr.querySelectorAll<HTMLInputElement>('input[type=radio]'));
  const impacts = Array.from(R.sImp.querySelectorAll<HTMLInputElement>('input[type=radio]'));
  const caps = Array.from(R.keys.querySelectorAll<HTMLButtonElement>('button[data-key]'));
  let waiting: HTMLButtonElement | null = null;
  const radios = Array.from(R.sQual.querySelectorAll<HTMLInputElement>('input[type=radio]'));
  const scales = Array.from(R.sScale.querySelectorAll<HTMLInputElement>('input[type=radio]'));
  const paint = () => {
    R.oVol.textContent = `${Math.round(S.volume * 100)}%`;
    R.oSens.textContent = `${S.sensitivity.toFixed(2)}×`;
    R.oFov.textContent = `${Math.round(S.fov)}°`;
    R.oInv.textContent = S.invertY ? 'On' : 'Off';
    R.oExp.textContent = S.explosives ? 'On' : 'Off';
    for (const r of radios) r.parentElement!.classList.toggle('is-on', r.checked);
    for (const r of scales) r.parentElement!.classList.toggle('is-on', r.checked);
    for (const r of impacts) { r.checked = r.value === S.impacts; r.parentElement!.classList.toggle('is-on', r.checked); }
    for (const r of prompts) { r.checked = r.value === S.prompts; r.parentElement!.classList.toggle('is-on', r.checked); }
    R.oUi.textContent = `${Math.round(S.uiScale * 100)}%`;
    for (const [, o, k] of toggles) o.textContent = S[k] ? 'On' : 'Off';
    for (const b of caps) {
      const a = b.dataset.key as KeyAction;
      b.textContent = b === waiting ? 'Press a key…' : codeLabel(keyOf(a));
      b.classList.toggle('is-waiting', b === waiting);
      b.classList.toggle('is-custom', !!S.keys[a] && S.keys[a] !== defKey(a));
    }
    for (const el of [vol, sens, fov, uiScale]) fillRange(el);
    applyLook();
  };
  vol.value = String(S.volume);
  uiScale.value = String(S.uiScale);
  sens.value = String(S.sensitivity);
  fov.value = String(S.fov);
  inv.checked = S.invertY;
  exp.checked = S.explosives;
  for (const r of radios) r.checked = r.value === S.quality;
  for (const r of scales) r.checked = Number(r.value) === S.renderScale;
  for (const [el, , k] of toggles) el.checked = S[k];
  paint();

  const emit = () => {
    paint();
    H?.onSettingsChange({ ...S });
  };
  let tick = 0;
  vol.addEventListener('input', () => {
    S.volume = clamp(Number(vol.value), 0, 1);
    emit();
    const now = performance.now();
    if (now - tick > 90) {
      tick = now;
      audio.ui('hover');
    }
  });
  sens.addEventListener('input', () => {
    S.sensitivity = clamp(Number(sens.value), 0.2, 3);
    emit();
  });
  // the size applies when the slider is let go: the settings sheet itself rescales under the pointer otherwise
  uiScale.addEventListener('input', () => { R.oUi.textContent = `${Math.round(Number(uiScale.value) * 100)}%`; fillRange(uiScale); });
  uiScale.addEventListener('change', () => {
    S.uiScale = clamp(Number(uiScale.value), 0.8, 1.5);
    audio.ui('click');
    emit();
  });
  for (const r of prompts)
    r.addEventListener('change', () => {
      if (!r.checked) return;
      S.prompts = r.value as Settings['prompts'];
      audio.ui('click');
      emit();
    });
  fov.addEventListener('input', () => {
    S.fov = clamp(Number(fov.value), 70, 120);
    emit();
  });
  inv.addEventListener('change', () => {
    S.invertY = inv.checked;
    audio.ui('click');
    emit();
  });
  exp.addEventListener('change', () => {
    S.explosives = exp.checked;
    audio.ui('click');
    emit();
  });
  for (const r of radios)
    r.addEventListener('change', () => {
      if (!r.checked) return;
      S.quality = r.value as Quality;
      audio.ui('click');
      emit();
    });
  for (const r of scales)
    r.addEventListener('change', () => {
      if (!r.checked) return;
      S.renderScale = Number(r.value);
      audio.ui('click');
      emit();
    });
  for (const [el, , k] of toggles)
    el.addEventListener('change', () => {
      S[k] = el.checked;
      audio.ui('click');
      emit();
    });
  for (const r of impacts)
    r.addEventListener('change', () => {
      if (!r.checked) return;
      S.impacts = r.value as Settings['impacts'];
      audio.ui('click');
      emit();
    });
  // rebinding: the next key pressed goes to the action; a key another action had is swapped over to it
  const stop = () => { waiting = null; captureKey(null); paint(); };
  for (const b of caps)
    b.addEventListener('click', () => {
      if (waiting === b) { stop(); return; }
      waiting = b;
      audio.ui('click');
      paint();
      captureKey(code => {
        waiting = null;
        if (RESERVED.has(code)) { paint(); return; }
        const a = b.dataset.key as KeyAction, was = keyOf(a);
        const other = ACTIONS.find(x => x.id !== a && keyOf(x.id) === code);
        const keys = { ...S.keys, [a]: code };
        if (other) keys[other.id] = was;
        for (const x of ACTIONS) if (keys[x.id] === x.key) delete keys[x.id];
        S.keys = keys;
        audio.ui('click');
        emit();
      });
    });
  R.keyReset.addEventListener('click', () => { S.keys = {}; audio.ui('click'); stop(); emit(); });
}

const PROMPTS: [Settings['prompts'], string][] = [['new', 'New tools'], ['always', 'Always'], ['off', 'Off']];
const IMPACTS: [Settings['impacts'], string, string][] = [
  ['off', 'Off', 'Falls and debris shake you up at most'],
  ['stumble', 'Stumble', 'Big falls and heavy debris knock you down for a moment'],
  ['real', 'Real', 'Knockdowns, and a blackout and respawn from a lethal fall or crush'],
];
const defKey = (a: KeyAction): string => ACTIONS.find(x => x.id === a)!.key;
const keyOf = (a: KeyAction): string => S.keys[a] ?? defKey(a);

/** hurt vignette (0..1, a knock or a fall) and blackout (0..1) over the view */
let dazeK = -1, blackK = -1;
export function setDaze(k: number, black: number): void {
  if (!root) return;
  const a = Math.round(k * 100) / 100, b = Math.round(black * 100) / 100;
  if (a === dazeK && b === blackK) return;
  dazeK = a; blackK = b;
  R.daze.style.setProperty('--k', String(a));
  R.daze.style.setProperty('--b', String(b));
}

/* ---------------- free-play overlays ---------------- */

type Overlay = 'panel' | 'palette';
let overlay: Overlay | null = null;
let SB: SandboxSettings = { ...WORLD_DEFAULTS };
let paintSandbox: () => void = () => {};
let prefabKey = '';

export function overlayOpen(): boolean {
  return overlay !== null;
}

function showOverlay(kind: Overlay): void {
  if (!root) return;
  const ae = document.activeElement;
  if (ae instanceof HTMLElement && root.contains(ae)) ae.blur();
  overlay = kind;
  root.dataset.ovl = kind;
  R.ovl.classList.add('is-on');
  R.sbx.classList.toggle('is-on', kind === 'panel');
  R.pal.classList.toggle('is-on', kind === 'palette');
  R.sbx.inert = kind !== 'panel';
  R.pal.inert = kind !== 'palette';
  audio.ui('click');
}

/** hides any free-play overlay without calling onOverlayClosed (the core initiated it) */
export function closeOverlays(): void {
  if (!root || !overlay) return;
  overlay = null;
  delete root.dataset.ovl;
  const ae = document.activeElement;
  if (ae instanceof HTMLElement && root.contains(ae)) ae.blur();
  R.ovl.classList.remove('is-on');
  R.sbx.classList.remove('is-on');
  R.pal.classList.remove('is-on');
  R.sbx.inert = true;
  R.pal.inert = true;
}

function closeByUser(): void {
  if (!overlay) return;
  closeOverlays();
  audio.ui('click');
  H?.onOverlayClosed();
}

function onOverlayKey(e: KeyboardEvent): void {
  const search = R.palSearch as HTMLInputElement;
  const inSearch = e.target === search;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (e.repeat) return;
    if (inSearch && search.value) {
      search.value = '';
      filterPrefabs();
      return;
    }
    return closeByUser();
  }
  if (overlay === 'panel') {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.repeat) closeByUser();
    }
    return;
  }
  if (inSearch) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = R.palBody.querySelector<HTMLElement>('.pcard:not([hidden])');
      if (first?.dataset.prefab) pickPrefab(first.dataset.prefab);
    }
    return;
  }
  if (e.code === 'KeyB') {
    e.preventDefault();
    if (!e.repeat) closeByUser();
    return;
  }
  // any other printable key starts a search; focusing now lets the character land in the box
  if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) search.focus();
}

export function openSandboxPanel(s: SandboxSettings): void {
  if (!root) return;
  SB = { ...s };
  paintSandbox();
  showOverlay('panel');
}

function bindSandbox(): void {
  const grav = R.xGrav as HTMLInputElement;
  const joint = R.xJoint as HTMLInputElement;
  const wind = R.xWind as HTMLInputElement;
  const debris = R.xDebris as HTMLInputElement;
  const fire = R.xFire as HTMLInputElement;
  const radios = Array.from(R.xTime.querySelectorAll<HTMLInputElement>('input[type=radio]'));
  const outputs = () => {
    R.oGrav.textContent = `${SB.gravity.toFixed(2)}×`;
    R.oJoint.textContent = `${SB.jointStrength.toFixed(2)}×`;
    R.oWind.textContent = windLabel(SB.wind);
    R.oFire.textContent = SB.fireSpread ? 'On' : 'Off';
    R.oDebris.textContent = `${fmt(SB.debrisLimit)} fragments`;
    for (const r of radios) r.parentElement!.classList.toggle('is-on', r.checked);
    for (const el of [grav, joint, wind, debris]) fillRange(el);
  };
  paintSandbox = () => {
    grav.value = String(SB.gravity);
    joint.value = String(SB.jointStrength);
    wind.value = String(SB.wind);
    debris.value = String(SB.debrisLimit);
    fire.checked = SB.fireSpread;
    const near = TIME_SCALES.reduce<number>((a, b) => (Math.abs(b - SB.timeScale) < Math.abs(a - SB.timeScale) ? b : a), 1);
    for (const r of radios) r.checked = Number(r.value) === near;
    outputs();
  };
  const emit = () => {
    outputs();
    H?.onSandboxChange({ ...SB });
  };
  grav.addEventListener('input', () => {
    SB.gravity = clamp(Number(grav.value), 0.25, 2);
    emit();
  });
  joint.addEventListener('input', () => {
    SB.jointStrength = clamp(Number(joint.value), 0.25, 3);
    emit();
  });
  wind.addEventListener('input', () => {
    SB.wind = clamp(Number(wind.value), 0, 1);
    emit();
  });
  debris.addEventListener('input', () => {
    SB.debrisLimit = Math.round(clamp(Number(debris.value), 600, 4000));
    emit();
  });
  fire.addEventListener('change', () => {
    SB.fireSpread = fire.checked;
    audio.ui('click');
    emit();
  });
  for (const r of radios)
    r.addEventListener('change', () => {
      if (!r.checked) return;
      SB.timeScale = Number(r.value);
      audio.ui('click');
      emit();
    });
  R.palSearch.addEventListener('input', filterPrefabs);
  paintSandbox();
}

function sandboxAction(a: SandboxAction, el: HTMLElement): void {
  audio.ui('click');
  if (!reduced()) el.animate([{ transform: 'translateY(3px)' }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
  H?.onSandboxAction(a);
}

export function openSpawnPalette(prefabs: PrefabView[]): void {
  if (!root) return;
  const key = prefabs.map(p => `${p.id}:${p.pieces}`).join('|');
  if (key !== prefabKey) {
    prefabKey = key;
    renderPrefabs(prefabs);
  }
  (R.palSearch as HTMLInputElement).value = '';
  filterPrefabs();
  showOverlay('palette');
}

const metres = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

function plan(fp: [number, number], maxDim: number): string {
  const big = Math.max(fp[0], fp[1], 0.1);
  // sqrt scaling keeps a shed visible next to a tower block
  const side = 10 + 24 * Math.sqrt(big / maxDim);
  const w = (fp[0] / big) * side;
  const h = (fp[1] / big) * side;
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M0 10h40M0 20h40M0 30h40M10 0v40M20 0v40M30 0v40" stroke="currentColor" stroke-opacity=".14" stroke-width=".5" fill="none"/><rect x="${((40 - w) / 2).toFixed(1)}" y="${((40 - h) / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#ffc400" fill-opacity=".16" stroke="#ffc400" stroke-width="1.2"/></svg>`;
}

function renderPrefabs(prefabs: PrefabView[]): void {
  const maxDim = Math.max(1, ...prefabs.map(p => Math.max(p.footprint[0], p.footprint[1])));
  R.palBody.innerHTML =
    CATEGORY.map(([cat, label]) => {
      const items = prefabs.filter(p => p.category === cat);
      if (!items.length) return '';
      const cards = items
        .map(
          p => `<button type="button" class="pcard bp" data-prefab="${esc(p.id)}" data-q="${esc(`${p.name} ${cat}`.toLowerCase())}">
  <span class="pcard__plan">${plan(p.footprint, maxDim)}</span>
  <span class="pcard__name">${esc(p.name)}</span>
  <span class="pcard__meta">${fmt(p.pieces)} pcs &middot; ${metres(p.footprint[0])} &times; ${metres(p.footprint[1])} m</span>
</button>`,
        )
        .join('');
      return `<section class="pal__group"><h3 class="label">${label}<span class="pal__n">${items.length}</span></h3><div class="pal__cards">${cards}</div></section>`;
    }).join('') + '<p class="pal__empty" hidden>No plans match that search.</p>';
}

function filterPrefabs(): void {
  const terms = (R.palSearch as HTMLInputElement).value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const g of Array.from(R.palBody.querySelectorAll<HTMLElement>('.pal__group'))) {
    let n = 0;
    for (const c of Array.from(g.querySelectorAll<HTMLElement>('.pcard'))) {
      const q = c.dataset.q ?? '';
      const ok = terms.every(t => q.includes(t));
      c.hidden = !ok;
      if (ok) n++;
    }
    g.hidden = n === 0;
    shown += n;
  }
  R.palCount.textContent = `${shown} plan${shown === 1 ? '' : 's'}`;
  const empty = R.palBody.querySelector<HTMLElement>('.pal__empty');
  if (empty) empty.hidden = shown > 0;
}

function pickPrefab(id: string): void {
  audio.ui('click');
  closeOverlays();
  H?.onSpawnPick(id);
  H?.onOverlayClosed();
}

/* ---------------- HUD ---------------- */

export function setHudTitle(name: string): void {
  if (root && R.title.textContent !== name) R.title.textContent = name;
}

let rpKey = '';
/** Collapse replay overlay: playhead, speed and keys; null closes it and gives the HUD back. */
export function setReplay(v: { t: number; span: number; speed: number; paused: boolean } | null): void {
  if (!root) return;
  R.hud.classList.toggle('is-replay', !!v);
  R.rp.classList.toggle('is-on', !!v);
  if (!v) { rpKey = ''; return; }
  const key = `${v.t.toFixed(1)}|${v.speed}|${v.paused}`;
  if (key === rpKey) return;
  rpKey = key;
  R.rpSpeed.textContent = v.paused ? 'Paused' : `${v.speed}×`;
  R.rpTime.textContent = `${v.t.toFixed(1)} / ${v.span.toFixed(1)} s`;
  R.rpBar.style.transform = `scaleX(${v.span > 0 ? clamp(v.t / v.span, 0, 1) : 0})`;
  R.rp.classList.toggle('is-paused', v.paused);
}

export function showHud(on: boolean): void {
  if (!root) return;
  R.hud.classList.toggle('is-on', on);
}

interface Slot {
  el: HTMLElement;
  ammo: HTMLElement;
  bar: HTMLElement;
  id: WeaponId | null;
  a: number;
  r: number;
  sel: boolean | null;
}
/** the six quick slots, then the tool in hand when it is on none of them */
let slots: Slot[] = [];
let slotKey = '';
let viewIdx = new Map<WeaponId, number>();
let names: Partial<Record<WeaponId, { name: string; short: string }>> = {};

/** the tool table's names (main passes them once: ui cannot import the weapons module, which imports it) */
export function setToolNames(rows: readonly { id: WeaponId; name: string; short: string }[]): void {
  names = Object.fromEntries(rows.map(r => [r.id, { name: r.name, short: r.short }]));
}
const shortOf = (id: WeaponId): string => names[id]?.short ?? id;
const nameOf = (id: WeaponId): string => names[id]?.name ?? id;
const wheelKey = (): string => (usingPad() ? 'D-pad ↑' : K('bank'));

function slotCell(id: WeaponId | null, key: string, extra = ''): string {
  if (!id) return `<div class="wslot is-free${extra}"><span class="wslot__key">${key}</span></div>`;
  return `<div class="wslot${extra}" data-id="${id}" title="${esc(nameOf(id))}"><span class="wslot__key">${key}</span><span class="wslot__icon">${WEAPON_ICON[id] ?? ''}</span><span class="wslot__name">${esc(shortOf(id))}</span><span class="wslot__ammo"></span><span class="wslot__ready"><i></i></span></div>`;
}

function syncSlots(ws: WeaponView[], ids: (WeaponId | null)[], cur: WeaponId): void {
  const loose = ids.includes(cur) ? null : cur;
  const key = `${ids.join(',')}|${loose ?? ''}|${wheelKey()}`;
  if (key === slotKey && viewIdx.size === ws.length) return;
  slotKey = key;
  viewIdx = new Map(ws.map((w, i) => [w.id, i]));
  R.weapons.innerHTML =
    `<div class="hb-wheel" data-r-wheel><span class="kbd">${esc(wheelKey())}</span><span>Tools</span></div>` +
    ids.map((id, i) => slotCell(id, String(i + 1))).join('') +
    (loose ? slotCell(loose, '', ' wslot--loose') : '');
  const cells = Array.from(R.weapons.querySelectorAll<HTMLElement>('.wslot'));
  slots = cells.map(el => ({
    el,
    ammo: el.querySelector<HTMLElement>('.wslot__ammo') ?? el,
    bar: el.querySelector<HTMLElement>('.wslot__ready > i') ?? el,
    id: (el.dataset.id as WeaponId | undefined) ?? null,
    a: NaN, r: NaN, sel: null,
  }));
  layoutDirty = true;
}

/* ---------------- tool wheel ---------------- */

export interface WheelView {
  fans: WeaponId[][];
  slots: (WeaponId | null)[];
  wheel: Wheel;
  current: WeaponId;
  ammo: Partial<Record<WeaponId, number>>;
  pad: boolean;
  /** pinning to slots is on offer (the loadout is bigger than the slots) */
  pins: boolean;
}
let twKey = '', twHot = '';
const polar = (r: number, deg: number): [number, number] => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
const at = (r: number, deg: number): string => { const [x, y] = polar(r * 50, deg); return `left:${(50 + x).toFixed(2)}%;top:${(50 + y).toFixed(2)}%`; };

function sectorPath(c: number): string {
  const a0 = c * SECTOR - SECTOR / 2 + 1.2, a1 = c * SECTOR + SECTOR / 2 - 1.2, r0 = DEAD * 100 + 2, r1 = LOCK_R * 100;
  const p = (r: number, a: number) => polar(r, a).map(v => v.toFixed(2)).join(' ');
  return `M${p(r0, a0)}L${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

/** Shows the tool wheel (null puts it away): the category ring, the fan of the category under the pointer, and the
    tool it is on in the hub. */
export function setWheel(v: WheelView | null): void {
  if (!root) return;
  R.wheel.classList.toggle('is-on', !!v);
  R.hud.classList.toggle('is-wheel', !!v);
  if (!v) { twHot = ''; return; }
  const ammoTxt = (id: WeaponId) => { const a = v.ammo[id] ?? 0; return a < 0 ? '∞' : String(a); };
  const key = `${v.fans.map(f => f.join(',')).join('|')}#${v.slots.join(',')}`;
  if (key !== twKey) {
    twKey = key;
    R.twDial.innerHTML =
      `<svg class="tw__ring" viewBox="-100 -100 200 200" aria-hidden="true">${CATS.map((_, c) => `<path class="tw__sec${v.fans[c].length ? '' : ' is-empty'}" data-c="${c}" d="${sectorPath(c)}"/>`).join('')}<circle class="tw__track" r="${TOOL_R * 100}"/></svg>` +
      CATS.map((cat, c) => `<span class="tw__cat${v.fans[c].length ? '' : ' is-empty'}" data-c="${c}" style="${at((DEAD + LOCK_R) / 2 + 0.01, c * SECTOR)}">${esc(cat.name)}<small>${v.fans[c].length || '—'}</small></span>`).join('') +
      v.fans.map((f, c) => f.map((id, i) => {
        const slot = v.slots.indexOf(id);
        return `<span class="tw__tool" data-c="${c}" data-id="${id}" style="${at(TOOL_R, fanAngle(c, i, f.length))}">${WEAPON_ICON[id] ?? ''}<b>${esc(shortOf(id))}</b><em>${ammoTxt(id)}</em>${slot >= 0 ? `<i>${slot + 1}</i>` : ''}</span>`;
      }).join('')).join('') +
      `<div class="tw__hub"><b data-tw="name"></b><span data-tw="meta"></span></div><i class="tw__ptr" data-tw="ptr"></i>`;
  }
  // ammo moves between openings (and between jobs with the same tools): the tiles read it fresh each time
  for (const em of R.twDial.querySelectorAll<HTMLElement>('.tw__tool em')) {
    const id = (em.parentElement as HTMLElement).dataset.id as WeaponId, t = ammoTxt(id);
    if (em.textContent !== t) em.textContent = t;
  }
  const w = v.wheel;
  const hot = `${w.cat}|${w.tool}|${v.pad}|${v.pins}|${ammoTxt(w.tool ?? 'hammer')}`;
  const ptr = R.twDial.querySelector<HTMLElement>('[data-tw="ptr"]')!;
  ptr.style.transform = `translate(${(w.x * 50).toFixed(2)}cqw, ${(w.y * 50).toFixed(2)}cqw)`;
  if (hot === twHot) return;
  twHot = hot;
  for (const el of R.twDial.querySelectorAll<Element>('[data-c]')) el.classList.toggle('is-hot', Number((el as HTMLElement).dataset.c) === w.cat);
  for (const el of R.twDial.querySelectorAll<HTMLElement>('.tw__tool')) {
    el.classList.toggle('is-pick', el.dataset.id === w.tool);
    el.classList.toggle('is-cur', el.dataset.id === v.current);
  }
  const name = R.twDial.querySelector<HTMLElement>('[data-tw="name"]')!, meta = R.twDial.querySelector<HTMLElement>('[data-tw="meta"]')!;
  if (w.tool) {
    const slot = v.slots.indexOf(w.tool);
    name.textContent = nameOf(w.tool);
    meta.textContent = `${CATS[w.cat]?.name ?? ''} · ${ammoTxt(w.tool) === '∞' ? 'unlimited' : `${ammoTxt(w.tool)} left`}${slot >= 0 ? ` · slot ${slot + 1}` : ''}`;
  } else {
    name.textContent = 'Point at a category';
    meta.textContent = '';
  }
  R.twKeys.innerHTML = v.pad
    ? '<span><b class="kbd">Right stick</b> point</span><span><b class="kbd">LB RB</b> step</span><span><b class="kbd">A</b> / release <b class="kbd">D-pad ↑</b> take</span><span><b class="kbd">B</b> cancel</span>'
    : `<span><b class="kbd">Mouse</b> point</span><span><b class="kbd">Wheel</b> step</span><span>release <b class="kbd">${esc(K('bank'))}</b> / <b class="kbd">LMB</b> take</span>${v.pins ? '<span><b class="kbd">1–6</b> pin to slot</span>' : ''}<span><b class="kbd">RMB</b> cancel</span>`;
}

const hc = {
  demoLabel: '',
  pct: -1,
  fill: -1,
  target: undefined as number | null | undefined,
  met: false,
  scoreTarget: 0,
  scoreShown: -1,
  bumpAt: 0,
  comboOn: false,
  comboX: -1,
  comboFill: -1,
  comboLevel: 1,
  tenths: -1,
  par: undefined as number | null | undefined,
  over: false,
  weapon: '',
  wheelNew: false,
  ts: -1,
  charges: -1,
  penalty: 0,
  hint: undefined as string | null | undefined,
  tool: '',
  toolBar: -1,
  toolL: '',
  seq: '',
  fpsAcc: 1,
  fps: -1,
};
const scoreSpring = spring.create(0);

/** A fresh site: the score starts at 0 instead of counting back from the last job's, and no stale penalty flash. */
/* what still stands between the percentage and the sign-off (a structure the job says must come down), or null */
let demoCaveat: string | null = null;
export function setDemoCaveat(text: string | null): void { demoCaveat = text; }

export function resetHud(): void {
  scoreSpring.value = 0;
  scoreSpring.velocity = 0;
  hc.scoreTarget = 0;
  if (root) R.penalty.textContent = '';
}

export function updateHud(s: HudState, dt: number): void {
  if (!root) return;
  const d = clamp(dt, 0, 0.1);
  const now = performance.now();

  const demo = clamp(s.demolition, 0, 1);
  const pct = Math.floor(demo * 100);
  if (pct !== hc.pct) {
    hc.pct = pct;
    R.pct.textContent = String(pct);
  }
  const fq = Math.round(demo * 400) / 400;
  if (fq !== hc.fill) {
    hc.fill = fq;
    R.fill.style.transform = `scaleX(${fq})`;
  }
  if (s.target !== hc.target) {
    hc.target = s.target;
    R.demo.classList.toggle('is-sandbox', s.target === null);
    if (s.target !== null) {
      R.notch.style.left = `${clamp(s.target, 0, 1) * 100}%`;
      R.notchLabel.textContent = `Target ${Math.round(s.target * 100)}%`;
    }
  }
  const reached = s.target !== null && demo >= s.target;
  const met = reached && !demoCaveat;
  const label = met ? 'Target met' : reached && demoCaveat ? demoCaveat : 'Demolished';
  if (label !== hc.demoLabel) { hc.demoLabel = label; R.demoLabel.textContent = label; }
  if (met !== hc.met) {
    hc.met = met;
    R.demo.classList.toggle('is-met', met);
    if (met && !reduced()) {
      R.pct.parentElement!.animate(
        [{ transform: 'scale(1.35)', filter: 'brightness(1.8)' }, { transform: 'scale(1)', filter: 'brightness(1)' }],
        { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }

  if (s.score < hc.scoreTarget) scoreSpring.value = s.score;
  if (s.score - hc.scoreTarget >= 150 && now - hc.bumpAt > 140 && !reduced()) {
    hc.bumpAt = now;
    R.score.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
  }
  hc.scoreTarget = s.score;
  spring.damp(scoreSpring, s.score, 0.28, d);
  if (Math.abs(s.score - scoreSpring.value) < 0.5) {
    scoreSpring.value = s.score;
    scoreSpring.velocity = 0;
  }
  const shown = Math.round(scoreSpring.value);
  if (shown !== hc.scoreShown) {
    hc.scoreShown = shown;
    R.score.textContent = fmt(shown);
  }

  const comboOn = s.combo > 1.0001;
  if (comboOn !== hc.comboOn) {
    hc.comboOn = comboOn;
    R.combo.classList.toggle('is-on', comboOn);
  }
  if (comboOn) {
    const cx = Math.round(s.combo * 10);
    if (cx !== hc.comboX) {
      hc.comboX = cx;
      R.comboX.textContent = `×${(cx / 10).toFixed(1)}`;
    }
    const cf = Math.round(clamp(s.comboTime, 0, 1) * 150) / 150;
    if (cf !== hc.comboFill) {
      hc.comboFill = cf;
      R.comboFill.style.transform = `scaleX(${cf})`;
    }
  }
  const lvl = Math.floor(s.combo);
  if (lvl > hc.comboLevel) {
    audio.ui('combo');
    if (!reduced()) R.comboX.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.3,1.5,.5,1)' });
  }
  hc.comboLevel = Math.max(1, lvl);

  const tenths = Math.floor(Math.max(0, s.time) * 10);
  if (tenths !== hc.tenths) {
    hc.tenths = tenths;
    R.clock.textContent = clockT(tenths);
  }
  if (s.par !== hc.par) {
    hc.par = s.par;
    R.par.textContent = s.par === null ? '' : `Par ${clockS(s.par)}`;
  }
  const over = s.par !== null && s.time > s.par;
  if (over !== hc.over) {
    hc.over = over;
    R.tl.classList.toggle('is-over', over);
  }

  if (s.weapon !== hc.weapon) {
    hc.weapon = s.weapon;
    R.xh.dataset.w = s.weapon;
  }
  syncSlots(s.weapons, s.slots, s.weapon);
  for (const sl of slots) {
    if (!sl.id) continue;
    const w = s.weapons[viewIdx.get(sl.id) ?? -1];
    if (!w) continue;
    if (w.ammo !== sl.a) {
      sl.a = w.ammo;
      sl.ammo.textContent = w.ammo < 0 ? '∞' : String(w.ammo);
      sl.el.classList.toggle('is-empty', w.ammo === 0);
    }
    const rq = Math.round(clamp(w.ready, 0, 1) * 100) / 100;
    if (rq !== sl.r) {
      sl.r = rq;
      sl.bar.style.transform = `scaleX(${rq})`;
      sl.el.classList.toggle('is-cooling', rq < 1);
    }
    const sel = w.id === s.weapon;
    if (sel !== sl.sel) {
      sl.sel = sel;
      sl.el.classList.toggle('is-sel', sel);
    }
  }
  if (!!s.wheelNew !== hc.wheelNew) {
    hc.wheelNew = !!s.wheelNew;
    R.weapons.classList.toggle('is-new', hc.wheelNew);
  }
  if (layoutDirty || now - layoutAt > 500) relayout(now);

  const ts = Math.round((s.timeScale ?? 1) * 100) / 100;
  if (ts !== hc.ts) {
    hc.ts = ts;
    const slow = ts < 0.995;
    R.slow.classList.toggle('is-on', slow);
    if (slow) R.slowX.textContent = `${ts}×`;
  }

  if (s.chargesPlaced !== hc.charges) {
    hc.charges = s.chargesPlaced;
    R.charges.classList.toggle('is-on', s.chargesPlaced > 0);
    R.chargeN.textContent = String(s.chargesPlaced);
  }

  if (s.penalty > hc.penalty) penaltyFlash(s.penalty);
  hc.penalty = s.penalty;

  if (s.hint !== hc.hint) {
    hc.hint = s.hint;
    if (s.hint) R.hint.textContent = s.hint;
    if (R.hint.classList.contains('is-on') !== !!s.hint) layoutDirty = true;
    R.hint.classList.toggle('is-on', !!s.hint);
  }

  updateTool(s.tool);
  updateTimeline(s.timeline);

  hc.fpsAcc += d;
  if (hc.fpsAcc >= 0.25) {
    hc.fpsAcc = 0;
    const f = Math.round(s.fps);
    if (f !== hc.fps) {
      hc.fps = f;
      R.fps.textContent = `${f} FPS`;
    }
  }
}

/* The readout stays at full strength while the tool is being worked (fire, RMB or the wheel in the last few seconds,
   a bar filling, a warning, a loaded line) and only dims, never vanishes, once it has sat unread for TOOL_IDLE s. Under
   it, the tool's controls in the player's own keys: for PROMPT_S s after the tool comes out, while it is new to them
   (main decides), or always. */
const TOOL_IDLE = 4, PROMPT_S = 6, PROMPT_MAX = 30;
let promptWait = false;
let toolGist = '', toolShownAt = -1e9, pokedAt = -1e9, promptTool: WeaponId | null = null, promptUntil = -1e9, promptKey = '';

/** the player is working the tool: keep its readout up (and start the prompt's countdown: it waits for them) */
export function toolPoke(): void {
  pokedAt = performance.now() / 1000;
  if (promptWait) { promptWait = false; promptUntil = Math.min(promptUntil, pokedAt + PROMPT_S); }
}

/** a new tool in hand; `prompt`: show its controls under the readout for a while */
export function toolChanged(id: WeaponId, prompt: boolean): void {
  promptTool = id;
  // up until the tool has been used and PROMPT_S more, or PROMPT_MAX s if it is never used
  promptWait = prompt;
  promptUntil = prompt ? performance.now() / 1000 + PROMPT_MAX : -1e9;
  pokedAt = performance.now() / 1000;
}

function btnLabel(b: Btn, pad: boolean): string {
  switch (b) {
    case 'fire': return pad ? 'RT' : 'LMB';
    case 'hold': return pad ? 'Hold RT' : 'Hold LMB';
    case 'alt': return pad ? 'LT' : 'RMB';
    case 'wheel': return pad ? 'LB RB' : 'Wheel';
    case 'det': return pad ? 'LT / Y' : `RMB / ${K('detonate')}`;
  }
}

/* the readout's detail drops its own key hints ("LMB …", "wheel …", "RMB/G …") while the prompt row shows them, or
   while a pad is in use (its buttons are not those keys) */
const KEYISH = /\b(LMB|RMB|MMB|[Ww]heel)\b|\bShift ±/;
/* a segment loses its key words; what is left stays if it still says something ("within 5 m", "(2 armed)") */
const stripKeys = (d: string): string => d.split(' · ').map(p => {
  if (!KEYISH.test(p)) return p;
  if (/^\s*(hold |press )?[Ww]heel\b/.test(p)) return '';
  const rest = p.replace(/\b(hold |press )?(LMB|RMB|MMB)(\/\S+)?/g, '').replace(/^\s*(on|to|at)\b/, '').trim();
  return rest.split(/\s+/).length >= 3 ? rest : '';
}).filter(Boolean).join(' · ');

function updateTool(t: ToolReadout | null): void {
  const now = performance.now() / 1000;
  const gist = t ? `${t.title.replace(/[\d.,]+/g, '')}|${t.warn}|${/on target: (\w+)|lands on the ground|no landing/.exec(t.detail)?.[0] ?? ''}` : '';
  if (gist !== toolGist) { toolGist = gist; toolShownAt = now; }
  const prompting = !!promptTool && S.prompts !== 'off' && (S.prompts === 'always' || now < promptUntil);
  const busy = !!t && (t.warn || t.progress !== null || !!t.lines?.length || now - pokedAt < TOOL_IDLE || prompting);
  R.tool.classList.toggle('is-idle', !busy && now - toolShownAt > TOOL_IDLE);
  const showKeys = !!promptTool && (S.prompts === 'always' || (S.prompts !== 'off' && now < promptUntil));
  const pad = usingPad();
  const pk = showKeys && promptTool ? `${promptTool}|${pad}|${K('detonate')}` : '';
  if (pk !== promptKey) {
    promptKey = pk;
    R.toolK.innerHTML = pk && promptTool
      ? TOOL_HELP[promptTool].map(([b, what]) => `<span class="kc"><b class="kbd">${esc(btnLabel(b, pad))}</b>${esc(what)}</span>`).join('')
      : '';
  }
  const strip = !!pk || pad;
  const key = t ? `${t.title}|${t.detail}|${t.warn}|${t.progress === null}|${strip}` : '';
  if (key !== hc.tool) {
    hc.tool = key;
    R.tool.classList.toggle('is-on', !!t);
    R.xh.classList.toggle('is-warn', !!t?.warn);
    if (t) {
      R.toolT.textContent = t.title;
      R.toolD.textContent = strip ? stripKeys(t.detail) : t.detail;
      R.tool.classList.toggle('is-warn', t.warn);
      R.tool.classList.toggle('has-bar', t.progress !== null);
    }
    layoutDirty = true;
  }
  /* rigging: one bar per loaded line, full scale its breaking load, a tick at its working load limit; green within the
     WLL, amber over it, red past 60 % of the break. The number is the share of the WLL, as a rigger reads it. */
  const ls = t?.lines ?? [];
  const lk = ls.map(l => `${l.label}:${Math.round((clamp(l.util, 0, 1.2) / (l.wll ?? 0.2)) * 100)}:${l.wll ?? 0}`).join('|');
  if (lk !== hc.toolL) {
    hc.toolL = lk;
    R.toolL.innerHTML = ls.map(l => {
      const u = clamp(l.util, 0, 1), w = l.wll ?? 0.2;
      const lvl = u > 0.6 ? ' is-red' : u > w ? ' is-amber' : '';
      return `<div class="tl${lvl}"><span class="tl__n">${esc(l.label)}</span><span class="tl__b"><i style="transform:scaleX(${u.toFixed(3)})"></i><em style="left:${(w * 100).toFixed(1)}%"></em></span><span class="tl__p">${Math.round((l.util / w) * 100)}% WLL</span></div>`;
    }).join('');
  }
  const b = t && t.progress !== null ? Math.round(clamp(t.progress, 0, 1) * 200) / 200 : -1;
  if (b !== hc.toolBar) {
    hc.toolBar = b;
    if (b >= 0) R.toolBar.style.transform = `scaleX(${b})`;
  }
}

/* Firing plan: one tick per device at its delay on a 0..span ms track, the cursor sweeping it while it fires. */
function updateTimeline(v: TimelineView | null): void {
  const key = v ? `${v.span}|${v.t === null ? '' : Math.round(v.t / 20)}|${v.items.map(i => `${i.delay}${i.kind[1]}${i.sel ? 's' : ''}${i.fired ? 'f' : ''}`).join(',')}` : '';
  if (key === hc.seq) return;
  hc.seq = key;
  R.seq.classList.toggle('is-on', !!v);
  if (!v) return;
  const pct = (ms: number) => `${clamp(ms / v.span, 0, 1) * 100}%`;
  R.seqTrack.innerHTML =
    v.items.map(i => `<i class="seq-dev seq-dev--${i.kind}${i.sel ? ' is-sel' : ''}${i.fired ? ' is-fired' : ''}" style="left:${pct(i.delay)}" title="${i.delay} ms"></i>`).join('') +
    (v.t === null ? '' : `<b class="seq-cursor" style="left:${pct(v.t)}"></b>`);
  const step = v.span > 2500 ? 1000 : v.span > 1000 ? 500 : 250;
  const marks: string[] = [];
  for (let ms = 0; ms <= v.span + 1; ms += step) marks.push(`<span style="left:${pct(ms)}">${ms}</span>`);
  R.seqScale.innerHTML = marks.join('');
}

/* Wide screens keep the tool readout and firing plan in the bottom-left corner, clear of the hotbar; when the corner
   would run into the hotbar (narrow screens, a big UI scale) they stack over it in the middle column instead, capped in
   height so the column stops short of the crosshair. Measured, not guessed from the viewport, so the UI scale counts. */
let layoutDirty = true, layoutAt = -1e9;
function relayout(now: number): void {
  layoutDirty = false;
  layoutAt = now;
  const W = R.bottom.clientWidth;
  if (!W) return;
  // the corner dock's width, as the CSS has it (--dock-w): a quarter of the screen within 16..24 rem
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const dockW = clamp(0.26 * innerWidth, 16 * rem, 24 * rem);
  const barW = R.weapons.offsetWidth;
  const gap = 16;
  R.hud.classList.toggle('is-stacked', (W - barW) / 2 < dockW + gap);
  // stacked, the dock gets what is left between the hint and hotbar and the crosshair's zone
  const g = parseFloat(getComputedStyle(R.bottom).rowGap) || 8;
  const below = R.weapons.offsetHeight + (R.hint.classList.contains('is-on') ? R.hint.offsetHeight + g : 0) + g + 6;
  R.bottom.style.setProperty('--below', `${below}px`);
}

/** dev check: every visible HUD box, whether any overlap each other, and whether any reach the crosshair's zone (the
    middle 18 vmin square) */
export function layoutReport(): { w: number; h: number; boxes: Record<string, number[]>; overlaps: string[]; crosshair: string[] } {
  const w = innerWidth, h = innerHeight, z = 0.09 * Math.min(w, h);
  const zone = { left: w / 2 - z, right: w / 2 + z, top: h / 2 - z, bottom: h / 2 + z };
  const pick: [string, string][] = [['title', '.hud-tl'], ['score', '.hud-tr'], ['meter', '.hud-demo'], ['slowmo', '.hud-slowmo.is-on'], ['tool', '.hud-tool.is-on'],
    ['plan', '.hud-seq.is-on'], ['armed', '.hud-charges.is-on'], ['hint', '.hud-hint.is-on'], ['hotbar', '.hotbar'], ['fps', '.hud-fps'], ['toasts', '.toasts'],
    ['wheel', '.tw.is-on .tw__dial'], ['wheelKeys', '.tw.is-on .tw__keys']];
  // the wheel stands the dock and the hint down (hidden under it), and is meant to sit on the crosshair
  const wheelOn = R.wheel.classList.contains('is-on');
  const hidden = new Set(wheelOn ? ['tool', 'plan', 'armed', 'hint'] : []);
  const boxes: Record<string, number[]> = {};
  for (const [k, sel] of pick) {
    if (hidden.has(k)) continue;
    const el = root?.querySelector<HTMLElement>(sel);
    if (!el || !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    boxes[k] = [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
  }
  const hit = (a: number[], b: { left: number; top: number; right: number; bottom: number }) => a[0] < b.right && a[2] > b.left && a[1] < b.bottom && a[3] > b.top;
  const keys = Object.keys(boxes), overlaps: string[] = [], crosshair: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const a = boxes[keys[i]];
    if (hit(a, zone) && keys[i] !== 'wheel') crosshair.push(keys[i]);
    for (let j = i + 1; j < keys.length; j++) {
      const b = boxes[keys[j]];
      if (hit(a, { left: b[0], top: b[1], right: b[2], bottom: b[3] })) overlaps.push(`${keys[i]}×${keys[j]}`);
    }
  }
  return { w, h, boxes, overlaps, crosshair };
}

/* the running property-damage total, flashed each time it grows */
function penaltyFlash(total: number): void {
  R.penalty.textContent = `${fmt(-total)} property damage`;
  R.penalty.animate(
    [
      { opacity: 0, transform: 'translateY(-.4rem)' },
      { opacity: 1, transform: 'none', offset: 0.1 },
      { opacity: 1, offset: 0.75 },
      { opacity: 0 },
    ],
    { duration: 2200, easing: 'ease-out' },
  );
  R.penFlash.animate([{ opacity: S.reduceFlash ? 0.3 : 1 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
  shake(R.tr, 4, 240);
}

/* ---------------- transient feedback ---------------- */

let hitAnim: Animation | null = null;
let xhAnim: Animation | null = null;
let hitLast = 0;
let hitLastS = 0;

export function hitmarker(strength: number): void {
  if (!root) return;
  const s = clamp(strength, 0, 1);
  if (s <= 0) return;
  const now = performance.now();
  if (now - hitLast < 45 && s <= hitLastS) return;
  hitLast = now;
  hitLastS = s;
  R.hit.classList.toggle('is-crit', s >= 0.75);
  hitAnim?.cancel();
  hitAnim = R.hit.animate(
    [
      { opacity: 0.4 + 0.6 * s, transform: `rotate(45deg) scale(${1.45 + 0.35 * s})` },
      { opacity: 0, transform: 'rotate(45deg) scale(1)' },
    ],
    { duration: 170 + 220 * s, easing: 'cubic-bezier(.2,.7,.3,1)' },
  );
  xhAnim?.cancel();
  xhAnim = R.xhPulse.animate([{ transform: `scale(${1 + 0.45 * s})` }, { transform: 'scale(1)' }], {
    duration: 200 + 160 * s,
    easing: 'cubic-bezier(.2,.7,.3,1)',
  });
}

interface Pop {
  el: HTMLElement;
  pts: HTMLElement;
  lab: HTMLElement;
  inner: HTMLElement;
  value: number;
  label: string;
  born: number;
  slot: number;
  anim: Animation | null;
}
const pops: Pop[] = [];
const popPool: Pop[] = [];
const POP_MAX = 5;
const POP_LIFE = 1350;

function popTier(v: number): string {
  if (v < 0) return 'neg';
  return v >= 5000 ? '3' : v >= 1000 ? '2' : v >= 250 ? '1' : '0';
}

function popLife(p: Pop, fresh: boolean): void {
  p.anim?.cancel();
  const rm = reduced();
  const frames: Keyframe[] = rm
    ? [{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }]
    : [
        { opacity: fresh ? 0 : 1, transform: `translateY(${fresh ? '.5rem' : '0'}) scale(${fresh ? 1.5 : 1.25})` },
        { opacity: 1, transform: 'none', offset: 0.12 },
        { opacity: 1, transform: 'translateY(-.2rem)', offset: 0.72 },
        { opacity: 0, transform: 'translateY(-.9rem)' },
      ];
  const a = p.inner.animate(frames, { duration: POP_LIFE, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
  p.anim = a;
  a.onfinish = () => {
    if (p.anim === a) retirePop(p);
  };
}

function retirePop(p: Pop): void {
  const i = pops.indexOf(p);
  if (i >= 0) pops.splice(i, 1);
  p.anim?.cancel();
  p.anim = null;
  p.el.remove();
  popPool.push(p);
  relayoutPops();
}

function relayoutPops(): void {
  for (let i = 0; i < pops.length; i++) {
    const p = pops[i];
    if (p.slot !== i) {
      p.slot = i;
      p.el.style.setProperty('--slot', String(i));
    }
  }
}

export function scorePop(points: number, label = ''): void {
  if (!root || !points) return;
  const now = performance.now();
  const top = pops[0];
  if (top && top.label === label && now - top.born < 420 && Math.sign(points) === Math.sign(top.value)) {
    top.value += points;
    top.born = now;
    top.pts.textContent = (top.value > 0 ? '+' : '') + fmt(top.value);
    top.el.dataset.tier = popTier(top.value);
    popLife(top, false);
    return;
  }
  let p = popPool.pop();
  if (!p) {
    const el = document.createElement('div');
    el.className = 'pop';
    el.innerHTML = '<div class="pop__in"><b></b><span></span></div>';
    const inner = el.firstElementChild as HTMLElement;
    p = { el, inner, pts: inner.children[0] as HTMLElement, lab: inner.children[1] as HTMLElement, value: 0, label: '', born: 0, slot: -1, anim: null };
  }
  p.value = points;
  p.label = label;
  p.born = now;
  p.slot = -1;
  p.pts.textContent = (points > 0 ? '+' : '') + fmt(points);
  p.lab.textContent = label;
  p.el.dataset.tier = popTier(points);
  p.el.style.setProperty('--slot', '0');
  pops.unshift(p);
  R.pops.append(p.el);
  while (pops.length > POP_MAX) retirePop(pops[pops.length - 1]);
  relayoutPops();
  popLife(p, true);
}

let toastSound = 0;
export function toast(text: string, kind: 'info' | 'good' | 'warn' | 'bad' = 'info', ms = 2600): void {
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', 'status');
  el.innerHTML = '<i class="toast__bar"></i><span></span>';
  el.lastElementChild!.textContent = text;
  R.toasts.prepend(el);
  while (R.toasts.children.length > 4) R.toasts.lastElementChild!.remove();
  const now = performance.now();
  if (now - toastSound > 150) {
    toastSound = now;
    audio.ui('toast');
  }
  window.setTimeout(() => {
    el.classList.add('is-out');
    window.setTimeout(() => el.remove(), 260);
  }, Math.max(400, ms));
}

let vigAnim: Animation | null = null;
let vigFrom = 0;
let vigT = 0;
let vigDur = 1;

export function blastVignette(amount: number): void {
  if (!root) return;
  const a = clamp(amount, 0, 1) * (S.reduceFlash ? 0.35 : 1);
  if (a < 0.02) return;
  const now = performance.now();
  const k = clamp((now - vigT) / vigDur, 0, 1);
  const cur = vigFrom * (1 - easing.cubicOut(k));
  const start = Math.min(1, Math.max(cur, a) + (cur > 0.05 ? a * 0.25 : 0));
  vigFrom = start;
  vigT = now;
  vigDur = 450 + 1400 * start;
  vigAnim?.cancel();
  vigAnim = R.vig.animate([{ opacity: start }, { opacity: 0 }], { duration: vigDur, easing: 'cubic-bezier(.33,1,.68,1)' });
  if (a > 0.3 && !reduced()) {
    const j = 2 + 7 * a;
    R.hud.animate(
      [
        { transform: 'translate(0,0)' },
        { transform: `translate(${-j}px,${j * 0.6}px)` },
        { transform: `translate(${j * 0.7}px,${-j * 0.4}px)` },
        { transform: `translate(${-j * 0.3}px,${j * 0.2}px)` },
        { transform: 'translate(0,0)' },
      ],
      { duration: 280, easing: 'ease-out' },
    );
  }
}

export function setPointerHint(visible: boolean): void {
  if (!root) return;
  R.ptr.classList.toggle('is-on', visible);
}
