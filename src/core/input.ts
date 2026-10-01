/* Raw input state plus the action layer on top of it. Gameplay reads it once per frame; endFrame() clears the
   edge-triggered parts. Keys are rebindable per action (one chosen key each, plus fixed alternates such as the arrow
   keys that give way when a chosen key takes them); a gamepad drives the same actions through pollPad(). */

export const input = {
  down: new Set<string>(),
  pressed: new Set<string>(),
  buttons: 0,
  clicked: 0,
  mouseDX: 0,
  mouseDY: 0,
  wheel: 0,
  locked: false,
};

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint' | 'careful' | 'zoom'
  | 'interact' | 'use' | 'detonate' | 'bank' | 'fly' | 'respawn' | 'restart' | 'xray' | 'replay' | 'bullet' | 'palette' | 'panel';

export interface ActionDef { id: Action; label: string; key: string; alt: string[]; group: 'Move' | 'Act' | 'Site' }
export const ACTIONS: readonly ActionDef[] = [
  { id: 'forward', label: 'Forward', key: 'KeyW', alt: ['ArrowUp'], group: 'Move' },
  { id: 'back', label: 'Back', key: 'KeyS', alt: ['ArrowDown'], group: 'Move' },
  { id: 'left', label: 'Left', key: 'KeyA', alt: ['ArrowLeft'], group: 'Move' },
  { id: 'right', label: 'Right', key: 'KeyD', alt: ['ArrowRight'], group: 'Move' },
  { id: 'jump', label: 'Jump / climb', key: 'Space', alt: [], group: 'Move' },
  { id: 'crouch', label: 'Crouch', key: 'KeyC', alt: ['ControlLeft', 'ControlRight'], group: 'Move' },
  { id: 'sprint', label: 'Sprint', key: 'ShiftLeft', alt: ['ShiftRight'], group: 'Move' },
  { id: 'careful', label: 'Careful (walk, A/D lean)', key: 'AltLeft', alt: ['AltRight'], group: 'Move' },
  { id: 'zoom', label: 'Zoom (hold)', key: 'KeyZ', alt: [], group: 'Move' },
  { id: 'interact', label: 'Drive / operate', key: 'KeyE', alt: [], group: 'Act' },
  { id: 'use', label: 'Work service gear', key: 'KeyU', alt: [], group: 'Act' },
  { id: 'detonate', label: 'Detonate', key: 'KeyG', alt: [], group: 'Act' },
  { id: 'bank', label: 'Tool wheel (hold) · last tool (tap)', key: 'KeyQ', alt: [], group: 'Act' },
  { id: 'fly', label: 'Fly (free play)', key: 'KeyF', alt: [], group: 'Site' },
  { id: 'respawn', label: 'Respawn', key: 'KeyP', alt: [], group: 'Site' },
  { id: 'restart', label: 'Restart', key: 'KeyR', alt: [], group: 'Site' },
  { id: 'xray', label: 'X-ray', key: 'KeyX', alt: [], group: 'Site' },
  { id: 'replay', label: 'Replay', key: 'KeyV', alt: [], group: 'Site' },
  { id: 'bullet', label: 'Bullet time', key: 'KeyT', alt: [], group: 'Site' },
  { id: 'palette', label: 'Spawn palette', key: 'KeyB', alt: [], group: 'Site' },
  { id: 'panel', label: 'World panel', key: 'Tab', alt: [], group: 'Site' },
];
const DEF = new Map(ACTIONS.map(a => [a.id, a]));
/** codes each action answers to, rebuilt by setBindings */
const codes = new Map<Action, string[]>();
const primary = new Map<Action, string>();
/** keys that never rebind: pause and the settings' own capture cancel */
export const RESERVED = new Set(['Escape']);

/** Applies user key choices (action → code); anything unset keeps its default. Duplicates resolve to the later pick. */
export function setBindings(user: Partial<Record<Action, string>> | undefined): void {
  primary.clear();
  const taken = new Set<string>();
  for (const a of ACTIONS) {
    const k = user?.[a.id];
    primary.set(a.id, k && !RESERVED.has(k) ? k : a.key);
  }
  for (const k of primary.values()) taken.add(k);
  for (const a of ACTIONS) codes.set(a.id, [primary.get(a.id)!, ...a.alt.filter(c => !taken.has(c))]);
}
setBindings(undefined);

export function bindingOf(a: Action): string { return primary.get(a)!; }
export function defaultBinding(a: Action): string { return DEF.get(a)!.key; }

/** 'KeyW' → 'W', 'ShiftLeft' → 'Shift' … for prompts and the settings list */
export function codeLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  const m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (m) return (m[1] === 'Control' ? 'Ctrl' : m[1] === 'Meta' ? 'Cmd' : m[1]) + (m[2] === 'Right' ? ' (R)' : '');
  return ({ Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', CapsLock: 'Caps', Enter: 'Enter', Tab: 'Tab', Backspace: 'Bksp' } as Record<string, string>)[code] ?? code;
}
export function keyLabel(a: Action): string { return codeLabel(bindingOf(a)); }

/* ---------------- gamepad ---------------- */

export const pad = {
  connected: false,
  /** left stick: x right, y forward, magnitude 0..1 after the deadzone */
  moveX: 0, moveY: 0,
  /** right stick, response-curved, -1..1 */
  lookX: 0, lookY: 0,
  /** right stick after the deadzone, linear (the tool wheel points with it) */
  rx: 0, ry: 0,
  /** D-pad left/right this frame: steps through the quick slots */
  slot: 0,
  /** bumpers this frame: +1 RB (more, next), -1 LB */
  bump: 0,
  held: new Set<Action>(),
  hit: new Set<Action>(),
  /** menu navigation this frame: D-pad or left stick (repeating while held), A, B, Start */
  nav: new Set<'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'start'>(),
  /** performance.now() of the last pad input, and of the last key or mouse input: prompts follow whichever was later */
  usedAt: -1,
};
let kbmAt = 0;
/** true while the pad is what the player last touched (prompts show pad buttons, the click-to-play card stands down) */
export function usingPad(): boolean { return pad.connected && pad.usedAt > kbmAt; }
const NAV_DELAY = 380, NAV_REPEAT = 110;
let navDir = '', navNext = 0;
const DEAD = 0.16;
let padBits = 0, padPrev: boolean[] = [];
/** standard mapping: button index → action (fire/secondary/wheel/pause handled apart) */
/** the pad's button for an action, where it has one (prompts and hints while a pad is in use) */
export const PAD_LABEL: Partial<Record<Action, string>> = {
  jump: 'A', crouch: 'B', interact: 'X', detonate: 'Y', sprint: 'L3', zoom: 'R3', bank: 'D-pad ↑', careful: 'D-pad ↓', xray: 'View',
};
/** the key (or, while a pad is in use, the button) the player would press for an action */
export function keyName(a: Action): string { return usingPad() && PAD_LABEL[a] ? PAD_LABEL[a]! : keyLabel(a); }
const PAD: [number, Action][] = [[0, 'jump'], [1, 'crouch'], [2, 'interact'], [3, 'detonate'], [10, 'sprint'], [11, 'zoom'], [12, 'bank'], [13, 'careful'], [8, 'xray']];

function stick(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return [x * k, y * k];
}

/** Reads the first standard gamepad into `pad` and the shared button/wheel state. Returns true on a Start press
    (the caller pauses). Cheap when nothing is plugged in. */
export function pollPad(): boolean {
  pad.hit.clear();
  const gp = typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()).find(g => g && g.connected && g.mapping === 'standard') : null;
  if (!gp) {
    if (pad.connected) { pad.connected = false; pad.held.clear(); pad.moveX = pad.moveY = pad.lookX = pad.lookY = pad.rx = pad.ry = 0; padBits = 0; input.buttons = mouseBits; }
    pad.nav.clear();
    return false;
  }
  pad.connected = true;
  const b = (i: number): boolean => !!gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.5;
  const edge = (i: number): boolean => b(i) && !padPrev[i];
  const [mx, my] = stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
  pad.moveX = mx; pad.moveY = -my;
  const [lx, ly] = stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
  // a gentle curve: fine aim near the centre, full turn rate at the rim
  pad.lookX = Math.sign(lx) * lx * lx; pad.lookY = Math.sign(ly) * ly * ly;
  pad.rx = lx; pad.ry = ly;
  pad.held.clear();
  for (const [i, a] of PAD) { if (b(i)) pad.held.add(a); if (edge(i)) pad.hit.add(a); }
  padBits = (b(7) ? 1 : 0) | (b(6) ? 4 : 0);
  if (edge(7)) input.clicked |= 1;
  if (edge(6)) input.clicked |= 4;
  // bumpers: RB more / next, LB less / previous (the tool's setting, else the quick slots); D-pad left/right always step
  // the slots
  if (edge(4)) pad.bump -= 1;
  if (edge(5)) pad.bump += 1;
  if (edge(14)) pad.slot -= 1;
  if (edge(15)) pad.slot += 1;
  input.buttons = mouseBits | padBits;
  const start = edge(9);
  // menus: a direction fires once, then repeats while it is held; A, B and Start on the press
  pad.nav.clear();
  const sx = gp.axes[0] ?? 0, sy = gp.axes[1] ?? 0;
  const dir = b(12) || sy < -0.6 ? 'up' : b(13) || sy > 0.6 ? 'down' : b(14) || sx < -0.6 ? 'left' : b(15) || sx > 0.6 ? 'right' : '';
  const t = performance.now();
  if (dir && dir !== navDir) { pad.nav.add(dir as 'up'); navNext = t + NAV_DELAY; }
  else if (dir && t >= navNext) { pad.nav.add(dir as 'up'); navNext = t + NAV_REPEAT; }
  navDir = dir;
  if (edge(0)) pad.nav.add('ok');
  if (edge(1)) pad.nav.add('back');
  if (start) pad.nav.add('start');
  if (gp.buttons.some(x => x.pressed) || mx || my || lx || ly) pad.usedAt = t;
  padPrev = gp.buttons.map(x => x.pressed);
  return start;
}

/* ---------------- action queries ---------------- */

export function held(a: Action): boolean {
  if (pad.held.has(a)) return true;
  for (const c of codes.get(a)!) if (input.down.has(c)) return true;
  return false;
}
export function hit(a: Action): boolean {
  if (pad.hit.has(a)) return true;
  for (const c of codes.get(a)!) if (input.pressed.has(c)) return true;
  return false;
}
/** takes this frame's press so a second physics step in the same frame does not act on it again */
export function consume(a: Action): void {
  pad.hit.delete(a);
  for (const c of codes.get(a)!) input.pressed.delete(c);
}
/** forward/back and right/left, -1..1 (the stick is analog; keys are full deflection) */
export function moveAxes(out: [number, number]): [number, number] {
  let f = (held('forward') ? 1 : 0) - (held('back') ? 1 : 0);
  let s = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  if (pad.connected && (pad.moveX || pad.moveY)) { f = Math.abs(pad.moveY) > Math.abs(f) ? pad.moveY : f; s = Math.abs(pad.moveX) > Math.abs(s) ? pad.moveX : s; }
  out[0] = f; out[1] = s;
  return out;
}

/** The held (or pressed) keys as the default layout would have them, for code that reads raw WASD (vehicles,
    machines): a rebound or pad-held action shows up as its default key. */
export function canonical(src: Set<string>, pressed = false): Set<string> {
  const out = new Set<string>();
  const bound = new Set<string>();
  for (const a of ACTIONS) {
    for (const c of codes.get(a.id)!) bound.add(c);
    if (codes.get(a.id)!.some(c => src.has(c)) || (pressed ? pad.hit.has(a.id) : pad.held.has(a.id))) { out.add(a.key); for (const x of a.alt) out.add(x); }
  }
  if (!pressed && pad.connected) {
    if (pad.moveY > 0.3) out.add('KeyW'); else if (pad.moveY < -0.3) out.add('KeyS');
    if (pad.moveX > 0.3) out.add('KeyD'); else if (pad.moveX < -0.3) out.add('KeyA');
  }
  for (const c of src) if (!bound.has(c)) out.add(c);
  return out;
}

/* ---------------- DOM wiring ---------------- */

let target: HTMLElement;
let lockChange: (locked: boolean) => void = () => {};
let lockError: () => void = () => {};
let mouseBits = 0;
/** while set, the next key goes to it instead of the game (settings key capture) */
let capture: ((code: string) => void) | null = null;
export function captureKey(f: ((code: string) => void) | null): void { capture = f; }

export function initInput(el: HTMLElement, onLockChange: (locked: boolean) => void, onLockError: () => void): void {
  target = el;
  lockChange = onLockChange;
  lockError = onLockError;
  // a key being captured for a binding goes nowhere else (capture phase, ahead of the UI's and the game's handlers)
  addEventListener('keydown', e => {
    if (!capture) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const f = capture; capture = null; f(e.code);
  }, true);
  // bubble phase: an open overlay (the spawn palette's search box) stops keys before they get here
  addEventListener('keydown', e => {
    if (e.repeat) return;
    kbmAt = performance.now();
    input.down.add(e.code);
    input.pressed.add(e.code);
    // Alt would pull focus to the browser menu, Tab/Space/arrows scroll or move focus
    if (input.locked && (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow') || e.code.startsWith('Alt'))) e.preventDefault();
  });
  addEventListener('keyup', e => { input.down.delete(e.code); if (input.locked && e.code.startsWith('Alt')) e.preventDefault(); });
  addEventListener('blur', () => { input.down.clear(); mouseBits = 0; input.buttons = padBits; });
  addEventListener('mousedown', e => {
    kbmAt = performance.now();
    if (!input.locked) return;
    mouseBits |= 1 << e.button;
    input.buttons |= 1 << e.button;
    input.clicked |= 1 << e.button;
  });
  addEventListener('mouseup', e => { mouseBits &= ~(1 << e.button); input.buttons = mouseBits | padBits; });
  addEventListener('mousemove', e => {
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) kbmAt = performance.now();
    if (!input.locked) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  });
  addEventListener('wheel', e => { if (input.locked) input.wheel += Math.sign(e.deltaY); }, { passive: true });
  addEventListener('contextmenu', e => { if (input.locked) e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === target;
    if (!input.locked) { mouseBits = 0; input.buttons = padBits; input.down.clear(); }
    lockChange(input.locked);
  });
  document.addEventListener('pointerlockerror', () => lockError());
}

export function requestLock(): void {
  if (document.pointerLockElement === target) return;
  try {
    const r = target.requestPointerLock({ unadjustedMovement: true }) as unknown as Promise<void> | undefined;
    r?.catch?.(() => {
      try { (target.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => lockError()); } catch { lockError(); }
    });
  } catch {
    lockError();
  }
}

export function releaseLock(): void {
  if (document.pointerLockElement) document.exitPointerLock();
}

export function endFrame(): void {
  pad.slot = 0;
  pad.bump = 0;
  input.pressed.clear();
  input.clicked = 0;
  input.mouseDX = 0;
  input.mouseDY = 0;
  input.wheel = 0;
  pad.hit.clear();
}
