/* Raw input state. Gameplay reads it once per frame; endFrame() clears the edge-triggered parts. */

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

let target: HTMLElement;
let lockChange: (locked: boolean) => void = () => {};
let lockError: () => void = () => {};

export function initInput(el: HTMLElement, onLockChange: (locked: boolean) => void, onLockError: () => void): void {
  target = el;
  lockChange = onLockChange;
  lockError = onLockError;
  addEventListener('keydown', e => {
    if (e.repeat) return;
    input.down.add(e.code);
    input.pressed.add(e.code);
    if (input.locked && (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow'))) e.preventDefault();
  });
  addEventListener('keyup', e => input.down.delete(e.code));
  addEventListener('blur', () => { input.down.clear(); input.buttons = 0; });
  addEventListener('mousedown', e => {
    if (!input.locked) return;
    input.buttons |= 1 << e.button;
    input.clicked |= 1 << e.button;
  });
  addEventListener('mouseup', e => { input.buttons &= ~(1 << e.button); });
  addEventListener('mousemove', e => {
    if (!input.locked) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  });
  addEventListener('wheel', e => { if (input.locked) input.wheel += Math.sign(e.deltaY); }, { passive: true });
  addEventListener('contextmenu', e => { if (input.locked) e.preventDefault(); });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === target;
    if (!input.locked) { input.buttons = 0; input.down.clear(); }
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
  input.pressed.clear();
  input.clicked = 0;
  input.mouseDX = 0;
  input.mouseDY = 0;
  input.wheel = 0;
}
