import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../src/buildings/fingerprint.ts';
import type { PieceSpec } from '../src/types.ts';
import { assemble, buildParts, footprintFrame, type BuildingDef } from '../src/buildings/assemble.ts';
import { block } from '../src/levels/kit.ts';

const a: PieceSpec = { mat: 'brick', size: [1, 1, 0.2], pos: [0, 0.5, 0] } as PieceSpec;
const b: PieceSpec = { mat: 'oak', size: [2, 0.1, 0.1], pos: [0, 1.05, 0] } as PieceSpec;

test('fingerprint is order-independent and ignores part tags', () => {
  const f1 = fingerprint([a, b]);
  const f2 = fingerprint([{ ...b, part: 'x/roof' }, { ...a, part: 'x/walls' }]);
  assert.equal(f1.hash, f2.hash);
  assert.equal(f1.pieces, 2);
});

test('fingerprint changes when geometry changes', () => {
  assert.notEqual(fingerprint([a, b]).hash, fingerprint([a, { ...b, pos: [0, 1.1, 0] }]).hash);
});

const H = (ps: PieceSpec[]) => fingerprint(ps).hash;
const withDetail = (detail: PieceSpec[]): PieceSpec => ({ ...a, detail } as PieceSpec);
const d1 = { mat: 'brick', size: [0.2, 0.1, 0.1], pos: [0, 0.05, 0] } as PieceSpec;
const d2 = { mat: 'mortar', size: [0.2, 0.01, 0.1], pos: [0, 0.105, 0] } as PieceSpec;

test('part inside detail is ignored', () => {
  assert.equal(H([withDetail([d1, d2])]), H([withDetail([{ ...d1, part: 'x/a' }, { ...d2, part: 'x/b' }])]));
});

test('detail order does not matter', () => {
  assert.equal(H([withDetail([d1, d2])]), H([withDetail([d2, d1])]));
});

test('nested-object key order does not matter', () => {
  const s1 = { ...a, section: { t: 0.01, tw: 0.02 } } as unknown as PieceSpec;
  const s2 = { ...a, section: { tw: 0.02, t: 0.01 } } as unknown as PieceSpec;
  assert.equal(H([s1]), H([s2]));
});

test('sub-mm float noise inside nested arrays and objects is ignored', () => {
  const n1 = { ...a, ropeTo: { at: [0.1 + 0.2, 1, 2], k: 0.3 } } as unknown as PieceSpec;
  const n2 = { ...a, ropeTo: { at: [0.3, 1, 2], k: 0.1 + 0.2 } } as unknown as PieceSpec;
  assert.equal(H([n1]), H([n2]));
});

test('a real 1 mm change inside a nested object changes the hash', () => {
  const n1 = { ...a, section: { t: 0.01, tw: 0.02 } } as unknown as PieceSpec;
  const n2 = { ...a, section: { t: 0.011, tw: 0.02 } } as unknown as PieceSpec;
  assert.notEqual(H([n1]), H([n2]));
});

test('NaN does not collide with null', () => {
  const n1 = { ...a, section: { t: NaN } } as unknown as PieceSpec;
  const n2 = { ...a, section: { t: null } } as unknown as PieceSpec;
  assert.notEqual(H([n1]), H([n2]));
});

test('mass is order-independent', () => {
  const ps = [a, b, d1, d2, { ...a, pos: [3, 0.5, 0] } as PieceSpec];
  assert.equal(fingerprint(ps).mass, fingerprint([...ps].reverse()).mass);
});

const toy: BuildingDef<{ h: number }> = {
  id: 'toy', name: 'Toy', category: 'houses', group: 'toy', defaults: { h: 3 },
  frame: (p) => ({ ...footprintFrame([-2, 2], [-2, 2]), bearings: { wallTop: { y: p.h, x: [-2, 2], z: [-2, 2] } } }),
  parts: [
    { id: 'walls', budget: 4, provides: ['wallTop'], build: (f, p) => [block('brick', [-2, 2], [0, p.h], [-2, -1.8])] },
    { id: 'roof', budget: 2, needs: ['wallTop'], build: (f) => [block('oak', [-2, 2], [f.bearings.wallTop.y, f.bearings.wallTop.y + 0.2], [-2, 2])] },
  ],
};

test('buildParts tags every piece with building/part and merges params', () => {
  const parts = buildParts(toy, { h: 5 });
  assert.deepEqual(parts.map((x) => x.part), ['walls', 'roof']);
  assert.ok(parts.every((x) => x.pieces.every((q) => q.part === `toy/${x.part}`)));
  assert.equal(parts[1].pieces[0].pos[1], 5.1);
});

test('assemble places at (x, z), applies the group and keeps part tags', () => {
  const ps = assemble(toy, { x: 10, z: 0 });
  assert.ok(ps.every((q) => q.group === 'toy'));
  assert.ok(ps.some((q) => q.pos[0] > 8));
  assert.ok(ps.every((q) => q.part?.startsWith('toy/')));
});

import { checkBearings } from '../src/buildings/bearings.ts';

test('bearings pass when roof sits on wall top', () => {
  assert.deepEqual(checkBearings(toy, { h: 3 }), []);
});

test('bearings fail when roof floats above the wall top', () => {
  const bad = { ...toy, parts: [toy.parts[0], { ...toy.parts[1], build: () => [block('oak', [-2, 2], [3.5, 3.7], [-2, 2])] }] };
  assert.ok(checkBearings(bad, { h: 3 }).some((e) => e.includes('roof') && e.includes('wallTop')));
});

test('bearings fail when a needed bearing is provided by no part', () => {
  const bad = { ...toy, parts: [{ ...toy.parts[0], provides: [] }, toy.parts[1]] };
  assert.ok(checkBearings(bad, { h: 3 }).some((e) => e.includes('roof') && e.includes('wallTop') && e.includes('no part provides')));
});

test('bearings fail when a provider does not reach the bearing', () => {
  const bad = { ...toy, parts: [{ ...toy.parts[0], build: () => [block('brick', [-2, 2], [0, 2], [-2, -1.8])] }, toy.parts[1]] };
  assert.ok(checkBearings(bad, { h: 3 }).some((e) => e.includes('walls') && e.includes('provides wallTop')));
});

test('bearings fail when the needing piece is outside the bearing range', () => {
  const bad = { ...toy, parts: [toy.parts[0], { ...toy.parts[1], build: () => [block('oak', [5, 6], [3, 3.2], [5, 6])] }] };
  assert.ok(checkBearings(bad, { h: 3 }).some((e) => e.includes('roof needs wallTop')));
});

import { hull } from '../src/levels/kit.ts';
import type { Vec3 } from '../src/types.ts';

/* An inclined bearing: a 30-degree seat through (0, 1, 0). The ramp's sloped top face lies in it; the plank's underside does. */
const SLOPE = Math.tan(Math.PI / 6), N: Vec3 = [-Math.sin(Math.PI / 6), Math.cos(Math.PI / 6), 0];
const onPlane = (x: number, z: number, lift: number): Vec3 => [x + N[0] * lift, 1 + x * SLOPE + N[1] * lift, z];
const ramp = () => hull('stone', [-1, 1].flatMap((x) => [-1, 1].flatMap((z) => [[x, 0, z] as Vec3, onPlane(x, z, 0)])));
const plank = (gap: number) => hull('oak', [-1, 1].flatMap((x) => [-1, 1].flatMap((z) => [onPlane(x, z, gap), onPlane(x, z, gap + 0.2)])));
const sloped = (gap: number, normal = true): BuildingDef<Record<string, never>> => ({
  id: 'slope', name: 'Slope', category: 'props', group: 'slope', defaults: {},
  frame: () => ({ ...footprintFrame([-1, 1], [-1, 1]), bearings: { seat: { y: 1, x: [-1, 1], z: [-1, 1], ...(normal ? { normal: N, point: [0, 1, 0] as Vec3 } : {}) } } }),
  parts: [
    { id: 'ramp', budget: 1, provides: ['seat'], build: () => [ramp()] },
    { id: 'plank', budget: 1, needs: ['seat'], build: () => [plank(gap)] },
  ],
});

test('inclined bearing passes when the plank lies on the sloped seat', () => {
  assert.deepEqual(checkBearings(sloped(0), {}), []);
});

test('inclined bearing fails when the plank is lifted off the seat along its normal', () => {
  assert.ok(checkBearings(sloped(0.1), {}).some((e) => e.includes('plank needs seat')));
});

test('the same seat declared horizontal cannot see the sloped contact', () => {
  assert.ok(checkBearings(sloped(0, false), {}).some((e) => e.includes('plank needs seat')));
});
