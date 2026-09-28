export const $ = <T extends HTMLElement = HTMLElement>(s: string): T =>
  document.querySelector(s) as T;
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const nowSec = (): number => performance.now() / 1000;
