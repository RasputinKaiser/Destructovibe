import { renderer } from '../render/gfx';
import { sfx } from '../audio/sfx';

export const keys: Record<string, boolean> = {};
export let locked = false;
export let fallbackLook = false;

let wantLock = false;
let onLockLost: () => void = () => { /* set by game */ };
let onMouseDelta: (dx: number, dy: number) => void = () => { /* set by controller */ };
let isGameActive: () => boolean = () => false;

export function setLockLostHandler(fn: () => void): void { onLockLost = fn; }
export function setMouseDeltaHandler(fn: (dx: number, dy: number) => void): void { onMouseDelta = fn; }
export function setActiveCheck(fn: () => boolean): void { isGameActive = fn; }

export const inputActive = (): boolean => (locked || fallbackLook) && isGameActive();

function enableFallback(): void {
  fallbackLook = true;
  renderer.domElement.style.cursor = 'crosshair';
}

/* Pointer lock with fallback for iframes/browsers that deny it. */
export function requestLock(): void {
  sfx.resume();
  wantLock = true;
  if (fallbackLook) return;
  try {
    const r = renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
    if (r && typeof r.catch === 'function') r.catch(() => enableFallback());
    setTimeout(() => { if (wantLock && !locked && !fallbackLook) enableFallback(); }, 350);
  } catch {
    enableFallback();
  }
}

export function releaseLock(): void {
  wantLock = false;
  if (locked) document.exitPointerLock();
}

export function initInput(): void {
  addEventListener('keydown', e => { keys[e.code] = true; });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });

  document.addEventListener('pointerlockerror', () => { if (wantLock) enableFallback(); });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    if (locked) fallbackLook = false;
    else if (wantLock && !fallbackLook) { wantLock = false; onLockLost(); }
  });

  addEventListener('mousemove', e => {
    if (!inputActive()) return;
    onMouseDelta(e.movementX, e.movementY);
  });
}
