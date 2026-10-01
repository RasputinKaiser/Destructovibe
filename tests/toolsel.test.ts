import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATS, ordered, issued, fans, quickSlots, pin, wheelStart, wheelAt, wheelStep, fanAngle, SECTOR } from '../src/game/toolsel.ts';
import type { WeaponId } from '../src/types.ts';

/* The tool wheel and quick slots read the WEAPONS table: every tool filed once under a category, a small contract's
   tools straight onto 1–6, the player's pins kept in a big loadout, and a pointer that picks what it points at. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src/game/weapons.ts'), 'utf8');
const TABLE = [...src.matchAll(/\{ id: '(\w+)', name: '[^']+', short: '[^']+', cat: '(\w+)', cooldown/g)].map(m => ({ id: m[1] as WeaponId, cat: m[2] as never }));
const ALL = Object.fromEntries(TABLE.map(t => [t.id, -1])) as Record<WeaponId, number>;

test('every tool is filed once, under a known category', () => {
  assert.equal(TABLE.length, 33);
  const o = ordered(TABLE);
  assert.equal(new Set(o.map(t => t.id)).size, 33);
  const cats = CATS.map(c => c.id) as string[];
  for (const t of TABLE) assert.ok(cats.includes(t.cat), `${t.id}: ${t.cat}`);
  // categories run contiguously in wheel order
  const seq = o.map(t => cats.indexOf(t.cat));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1]);
  for (const f of fans(TABLE, ALL)) assert.ok(f.length >= 1 && f.length <= 7, 'a fan fits the wheel');
});

test('a small loadout goes straight onto 1-6 in wheel order', () => {
  const ammo = { hammer: -1, cutter: 4, grinder: -1 } as Partial<Record<WeaponId, number>>;
  const s = quickSlots(TABLE, ammo, ['grinder', 'rocket']);
  assert.deepEqual(s.filter(Boolean), issued(TABLE, ammo));
  assert.equal(s[0], 'hammer');
  assert.equal(s.filter(Boolean).length, 3);
  const f = fans(TABLE, ammo);
  assert.equal(f.flat().length, 3, 'the wheel shows only what was issued');
});

test('a big loadout keeps the pins where they were put', () => {
  const pins: WeaponId[] = ['hammer', 'rocket', 'charge', 'planner', 'grinder', 'tether'];
  assert.deepEqual(quickSlots(TABLE, ALL, pins), pins);
  const moved = pin(pins, 0, 'tether');
  assert.deepEqual(moved, ['tether', 'rocket', 'charge', 'planner', 'grinder', 'hammer'], 'pinning swaps with the old slot');
  // a pin that was not issued leaves its slot to the rest, in wheel order
  const noRocket = { ...ALL } as Partial<Record<WeaponId, number>>;
  delete noRocket.rocket;
  const s = quickSlots(TABLE, noRocket, pins);
  assert.equal(s[0], 'hammer');
  assert.notEqual(s[1], 'rocket');
  assert.ok(s[1]);
  assert.equal(new Set(s).size, 6);
});

test('the wheel pointer picks a category, then along its fan', () => {
  const f = fans(TABLE, ALL);
  const w = wheelStart('hammer', f);
  assert.equal(w.tool, 'hammer');
  wheelAt(w, 0, -0.1, f);
  assert.equal(w.tool, 'hammer', 'the centre keeps the pick');
  // straight up, inside the ring: the impact category
  wheelAt(w, 0, -0.4, f);
  assert.equal(CATS[w.cat].id, 'impact');
  assert.equal(w.lock, false);
  // into the ordnance sector and out past the ring, then round its fan to each tool's own angle
  const c = CATS.findIndex(k => k.id === 'ordnance'), mid = (c * SECTOR * Math.PI) / 180;
  f[c].forEach((id, i) => {
    const a = (fanAngle(c, i, f[c].length) * Math.PI) / 180;
    wheelAt(w, Math.sin(mid) * 0.4, -Math.cos(mid) * 0.4, f);
    wheelAt(w, Math.sin(mid) * 0.9, -Math.cos(mid) * 0.9, f);
    wheelAt(w, Math.sin(a) * 0.9, -Math.cos(a) * 0.9, f);
    assert.equal(w.tool, id);
    assert.equal(w.lock, true);
  });
  // swung right round to the opposite side: the category lets go and the new one is taken
  const opp = (c + 3) % CATS.length, b = (opp * SECTOR * Math.PI) / 180;
  wheelAt(w, Math.sin(b), -Math.cos(b), f);
  assert.equal(w.cat, opp);
  assert.ok(f[opp].includes(w.tool!));
  // stepping wraps within the category
  const first = w.tool;
  for (let i = 0; i < f[opp].length; i++) wheelStep(w, 1, f);
  assert.equal(w.tool, first);
});

test('sweeping the rim from one fan reaches the next wedge, not the one beyond', () => {
  const f = fans(TABLE, ALL);
  const w = wheelStart('hammer', f);
  const cut = CATS.findIndex(k => k.id === 'cutting'), ord = CATS.findIndex(k => k.id === 'ordnance');
  const at = (deg: number, r: number) => wheelAt(w, Math.sin((deg * Math.PI) / 180) * r, -Math.cos((deg * Math.PI) / 180) * r, f);
  at(cut * SECTOR, 0.4);
  at(cut * SECTOR, 0.95);
  assert.equal(w.cat, cut);
  const seen = new Set<number>();
  for (let a = cut * SECTOR; a >= ord * SECTOR - 20; a -= 3) { at(a, 0.95); seen.add(w.cat); }
  assert.equal(w.cat, ord);
  assert.ok(!seen.has(CATS.findIndex(k => k.id === 'explosive')), 'never jumped past ordnance');
});

test('any pointer path on any loadout settles (two-tool fans included)', () => {
  const loadouts: Partial<Record<WeaponId, number>>[] = [
    { hammer: -1, cannon: 12 },
    { charge: 4, cutter: 2, hammer: -1 },
    { hammer: -1 },
    ALL,
  ];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const ammo of loadouts) {
    const f = fans(TABLE, ammo);
    const w = wheelStart(issued(TABLE, ammo)[0], f);
    for (let k = 0; k < 4000; k++) {
      const a = rnd() * Math.PI * 2, r = rnd() * 1.2;
      wheelAt(w, Math.sin(a) * r, -Math.cos(a) * r, f);
      if (w.tool) assert.ok(f[w.cat].includes(w.tool));
    }
    // a slow sweep round the rim, the stick's path: every degree
    for (let d = 0; d < 720; d++) wheelAt(w, Math.sin((d * Math.PI) / 180), -Math.cos((d * Math.PI) / 180), f);
  }
});

test('an empty category picks nothing', () => {
  const ammo = { hammer: -1, charge: 3 } as Partial<Record<WeaponId, number>>;
  const f = fans(TABLE, ammo);
  const w = wheelStart('hammer', f);
  const cut = CATS.findIndex(k => k.id === 'cutting'), a = (cut * SECTOR * Math.PI) / 180;
  wheelAt(w, Math.sin(a) * 0.9, -Math.cos(a) * 0.9, f);
  assert.equal(w.tool, null);
  assert.equal(w.cat, -1);
});

test('an older save loads with the new settings defaulted', async () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  store.set('destructovibe.v2', JSON.stringify({
    version: 2, progress: { c1: { stars: 2, best: 900 } },
    settings: { volume: 0.4, quality: 'medium', sensitivity: 1.3, fov: 95, fovH: true, invertY: true, explosives: true, shake: false, grain: true, aberration: true, renderScale: 0, headBob: true, crouchToggle: true, sprintToggle: false, impacts: 'stumble', keys: { bank: 'KeyR', restart: 'KeyQ' } },
  }));
  const { loadSave, DEFAULT_PINS } = await import('../src/core/save.ts');
  const d = loadSave();
  assert.equal(d.settings.volume, 0.4);
  assert.equal(d.settings.crouchToggle, true);
  assert.deepEqual(d.settings.keys, { bank: 'KeyR', restart: 'KeyQ' }, 'rebinds survive');
  assert.equal(d.settings.uiScale, 1);
  assert.equal(d.settings.prompts, 'new');
  assert.equal(d.settings.colorblind, false);
  assert.deepEqual(d.pins, DEFAULT_PINS);
  assert.deepEqual(d.seen, {});
  assert.equal(d.progress.c1.stars, 2);
});
