/* Game-feel time: hitstop (a few frames of near-freeze on a heavy blow) and the player's bullet-time toggle.
   Both scale how much simulated time the main loop feeds the solver; nothing here touches the physics itself. */

const HITSTOP_DEPTH = 0.06;
const BULLET = 0.3;

let stopT = 0;
let stopDepth = 1;
let bullet = false;
let bulletK = 1;

/** Freeze the world for `seconds` of real time (clamped short), deepest wins. */
export function hitstop(seconds: number, depth = HITSTOP_DEPTH): void {
  const s = Math.min(0.12, Math.max(0, seconds));
  if (s <= 0) return;
  stopT = Math.max(stopT, s);
  stopDepth = Math.min(stopDepth, depth);
}

export function toggleBulletTime(): boolean {
  bullet = !bullet;
  return bullet;
}

export function bulletTime(): boolean {
  return bullet;
}

/** 0..1 how far into slow motion the eased bullet-time blend is (HUD vignette). */
export function bulletBlend(): number {
  return (1 - bulletK) / (1 - BULLET);
}

/** Advance the real-time timers by dt and return the sim-time multiplier for this frame. */
export function simScale(dt: number): number {
  bulletK += ((bullet ? BULLET : 1) - bulletK) * Math.min(1, dt * 7);
  let k = bulletK;
  if (stopT > 0) {
    stopT -= dt;
    k *= stopDepth;
    if (stopT <= 0) { stopT = 0; stopDepth = 1; }
  }
  return k;
}

export function resetTime(): void {
  stopT = 0;
  stopDepth = 1;
  bullet = false;
  bulletK = 1;
}
