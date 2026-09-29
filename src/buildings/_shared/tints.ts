import type { PieceSpec } from '../../types.ts';

/* Deterministic colour variation for units: fired brick varies unit to unit, walls darken at the foot (splash) and
   under sills (run-off), stacks soot up toward the pots. */

/** hash of a position (mm grid) and a salt → [0, 1) */
export function hash3(x: number, y: number, z: number, salt = 0): number {
  let h = Math.imul(Math.round(x * 1000) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(y * 1000) + 0x7f4a7c15, 0xc2b2ae35)
    ^ Math.imul(Math.round(z * 1000) + 0x165667b1 + salt * 0x27d4eb2f, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** scale a colour by k, with a small warm/cool shift w in [-1, 1] */
export function shadeTint(c: number, k: number, w = 0): number {
  const ch = (v: number, s: number) => Math.max(0, Math.min(255, Math.round(v * k * (1 + s))));
  return (ch((c >> 16) & 255, 0.05 * w) << 16) | (ch((c >> 8) & 255, 0) << 8) | ch(c & 255, -0.06 * w);
}

/** one unit's colour: base ± fired variation (range `spread`) */
export function vary(c: number, u: PieceSpec, spread = 0.22, salt = 0): number {
  const r = hash3(u.pos[0], u.pos[1], u.pos[2], salt), s = hash3(u.pos[2], u.pos[0], u.pos[1], salt + 7);
  return shadeTint(c, 1 - spread / 2 + spread * r * r * 0.6 + spread * 0.4 * s, (s - 0.5) * 2);
}

/** a colour multiplied channel by channel by another (a white-laid finish taking a paint colour) */
export function mulTint(c: number, by: number): number {
  const ch = (s: number) => Math.round((((c >> s) & 255) * ((by >> s) & 255)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
