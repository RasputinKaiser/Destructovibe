/* One structure-of-arrays pool for every soft particle, so bodies can share a spatial hash and the inner
   loops never touch objects. Bodies own contiguous ranges handed out by a first-fit allocator. */

export const ALIVE = 1, BURNING = 2, FROZEN = 4, SOLID = 8, PINNED = 16, CUT = 32, GRAIN = 64;

export const pool = {
  cap: 0,
  top: 0,
  x: new Float64Array(0),   // position
  px: new Float64Array(0),  // position at the start of the substep
  sx: new Float64Array(0),  // position at the start of the step (render interpolation, sleep test)
  v: new Float64Array(0),
  w: new Float64Array(0),   // inverse mass in the solve (0 = pinned / frozen)
  m: new Float64Array(0),
  r: new Float32Array(0),
  /** contact friction and cohesion (solid particles) */
  mu: new Float32Array(0),
  coh: new Float32Array(0),
  temp: new Float32Array(0),
  char: new Float32Array(0),
  fl: new Uint8Array(0),
  body: new Int32Array(0),
  rest: new Uint16Array(0),
};

const free: [number, number][] = [];

function grow(cap: number): void {
  const g = <T extends Float64Array | Float32Array | Uint8Array | Int32Array | Uint16Array>(a: T, k: number): T => {
    const b = new (a.constructor as new (n: number) => T)(cap * k);
    b.set(a);
    return b;
  };
  pool.x = g(pool.x, 3); pool.px = g(pool.px, 3); pool.sx = g(pool.sx, 3); pool.v = g(pool.v, 3);
  pool.w = g(pool.w, 1); pool.m = g(pool.m, 1); pool.r = g(pool.r, 1); pool.mu = g(pool.mu, 1); pool.coh = g(pool.coh, 1); pool.temp = g(pool.temp, 1); pool.char = g(pool.char, 1);
  pool.fl = g(pool.fl, 1); pool.body = g(pool.body, 1); pool.rest = g(pool.rest, 1);
  pool.cap = cap;
}

export function allocParticles(n: number): number {
  for (let i = 0; i < free.length; i++) {
    const [s, c] = free[i];
    if (c < n) continue;
    if (c === n) free.splice(i, 1); else free[i] = [s + n, c - n];
    clearRange(s, n);
    return s;
  }
  if (pool.top + n > pool.cap) grow(Math.max(pool.top + n, pool.cap * 2, 4096));
  const s = pool.top;
  pool.top += n;
  clearRange(s, n);
  return s;
}

export function freeParticles(s: number, n: number): void {
  clearRange(s, n);
  if (s + n === pool.top) {
    pool.top = s;
    // swallow free ranges that now touch the top
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < free.length; i++) if (free[i][0] + free[i][1] === pool.top) { pool.top = free[i][0]; free.splice(i, 1); merged = true; break; }
    }
    return;
  }
  free.push([s, n]);
}

export function resetParticles(): void {
  free.length = 0;
  clearRange(0, pool.top);
  pool.top = 0;
}

function clearRange(s: number, n: number): void {
  pool.fl.fill(0, s, s + n);
  pool.w.fill(0, s, s + n);
  pool.v.fill(0, s * 3, (s + n) * 3);
  pool.char.fill(0, s, s + n);
  pool.temp.fill(20, s, s + n);
  pool.rest.fill(0, s, s + n);
  pool.body.fill(-1, s, s + n);
}
