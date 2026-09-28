/* Light cast by energised building lamps. A fixed pool of shadowless PointLights is created once and
   never hidden (a changing light count recompiles every lit shader); unused lights sit at intensity 0.
   Together with fx's 3 flash lights and the 4 floodlight spots that is 13 punctual lights. */
import * as THREE from 'three';
import type { Vec3 } from '../types';

const POOL = 6, MATCH = 0.75, FADE_IN = 0.35, FADE_OUT = 0.3, STUTTER = 0.45;

interface Slot {
  light: THREE.PointLight;
  /** current / wanted position, so a falling fitting glides between the ~4 Hz updates */
  pos: THREE.Vector3; want: THREE.Vector3;
  intensity: number;
  level: number; on: boolean;
  /** seconds since switched on / off, drives the start-up and dying stutter */
  since: number;
  seed: number;
  claimed: boolean;
}

const slots: Slot[] = [];
/** the pooled lights, in slot order (fx lights the dust with them) */
export const lampPool: THREE.PointLight[] = [];
let root: THREE.Group | null = null;
let clock = 0;
const _p = new THREE.Vector3();

export function initLampLights(scene: THREE.Scene): void {
  if (root) { if (root.parent !== scene) scene.add(root); return; }
  root = new THREE.Group();
  root.name = 'lampLights';
  for (let i = 0; i < POOL; i++) {
    const light = new THREE.PointLight(0xffe0b0, 0, 8, 2);
    light.castShadow = false;
    root.add(light);
    lampPool.push(light);
    slots.push({ light, pos: new THREE.Vector3(), want: new THREE.Vector3(), intensity: 0, level: 0, on: false, since: 9, seed: i * 1.37, claimed: false });
  }
  scene.add(root);
}

function hash(x: number): number {
  const s = Math.sin(x * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export const lampLights = {
  /** the lamps to light now, most important first (only the first POOL are used) */
  set(list: { pos: Vec3; color: number; intensity: number; range: number }[]): void {
    for (const s of slots) s.claimed = false;
    const n = Math.min(list.length, POOL);
    // pass 1: keep lamps that already own a light on that light
    const taken = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const l = list[i];
      _p.set(l.pos[0], l.pos[1], l.pos[2]);
      let best: Slot | null = null, bd = MATCH * MATCH;
      for (const s of slots) {
        if (s.claimed || !s.on) continue;
        const d = s.want.distanceToSquared(_p);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { best.claimed = true; taken[i] = 1; apply(best, l, false); }
    }
    // pass 2: newly lit lamps take the dimmest free light
    for (let i = 0; i < n; i++) {
      if (taken[i]) continue;
      let best: Slot | null = null;
      for (const s of slots) if (!s.claimed && (!best || s.level < best.level)) best = s;
      if (!best) break;
      best.claimed = true;
      apply(best, list[i], true);
    }
    for (const s of slots) if (!s.claimed && s.on) { s.on = false; s.since = 0; }
  },
  clear(): void {
    for (const s of slots) { s.on = false; s.level = 0; s.since = 9; s.light.intensity = 0; }
  },
};

function apply(s: Slot, l: { pos: Vec3; color: number; intensity: number; range: number }, fresh: boolean): void {
  s.want.set(l.pos[0], l.pos[1], l.pos[2]);
  if (fresh) {
    s.pos.copy(s.want);
    s.level = 0;
    s.on = true;
    s.since = 0;
    s.seed = Math.random() * 100;
  }
  s.intensity = l.intensity;
  s.light.color.setHex(l.color);
  s.light.distance = l.range;
}

/** per frame, after the core's lamp update */
export function updateLampLights(dt: number): void {
  dt = Math.min(Math.max(dt, 0), 0.1);
  clock += dt;
  for (const s of slots) {
    s.since += dt;
    s.level = s.on ? Math.min(1, s.level + dt / FADE_IN) : Math.max(0, s.level - dt / FADE_OUT);
    if (s.level <= 0) { s.light.intensity = 0; continue; }
    s.pos.lerp(s.want, Math.min(1, dt * 12));
    s.light.position.copy(s.pos);
    let k = 1;
    // a tube striking or a fitting dying: stepped on/off stutter, ~30 ms steps
    if (s.since < STUTTER) k = hash(Math.floor(clock * 33) + s.seed) < (s.on ? 0.35 : 0.5) ? 0.12 : 1;
    s.light.intensity = s.intensity * s.level * s.level * k;
  }
}
