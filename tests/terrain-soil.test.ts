import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterize } from '../src/terrain/raster.ts';
import type { SoilProfile, TerrainSpec } from '../src/terrain/spec.ts';
import { SOIL, SOILS, busy, ceilings, craterSoil, dentSoil, digSoil, displace, heapSoil, initSoil, looseVolume, soilIndex, soilStep, totalMass, type SoilState } from '../src/terrain/soil.ts';
import type { TerrainData } from '../src/terrain/raster.ts';

const spec = (soil?: SoilProfile): TerrainSpec => ({
  half: 16, cell: 0.5, seed: 3, undulate: 0, ops: [{ k: 'mat', x: [-16, 16], z: [-16, 16], mat: 'grass' }],
  kerbs: [], blocks: [], pads: [], steps: [], decals: [], marks: [], ...(soil ? { soil } : {}),
});

function site(soil?: SoilProfile): { d: TerrainData; s: SoilState } {
  const d = rasterize(spec(soil));
  const s = initSoil(d);
  d.soil = s;
  return { d, s };
}

function settle(d: TerrainData, s: SoilState, max = 30000): number {
  let k = 0;
  while (busy(s) && k < max) { soilStep(d, s); k++; }
  return k;
}

const only = (t: string): SoilProfile => ({ layers: [{ soil: t as never, thick: 12 }, { soil: 'rock', thick: Infinity }] });
const idx = (d: TerrainData, x: number, z: number) => Math.round((x + d.half) / d.cell) + d.n * Math.round((z + d.half) / d.cell);

test('soil: dig and dump conserve mass; the bucket carries the bulked volume', () => {
  const { d, s } = site();
  const m0 = totalMass(s);
  const acc = new Float64Array(SOILS.length);
  let taken = 0;
  for (let x = -3; x <= 3; x += 0.5) taken += digSoil(d, s, x, 0, 0.6, 0.5, acc);
  assert.ok(taken > 1000, `dug ${taken} kg`);
  const bank = acc.reduce((a, m, t) => a + m / SOIL[SOILS[t]].rho, 0);
  assert.ok(looseVolume(acc) > bank * 1.1, 'spoil bulks when dug');
  // the bucket is out of the ground now
  assert.ok(Math.abs(totalMass(s) + taken - m0) < 1e-6 * m0);
  heapSoil(d, s, 6, 4, 0.8, taken, soilIndex('fill'));
  settle(d, s);
  assert.ok(!busy(s), 'settles');
  const m1 = totalMass(s);
  assert.ok(Math.abs(m1 - m0) < 1e-6 * m0, `mass drift ${m1 - m0} kg of ${m0}`);
});

test('soil: a crater lays back all it throws out (rim + blanket + clods)', () => {
  const { d, s } = site();
  const m0 = totalMass(s);
  const c = craterSoil(d, s, 0.3, -0.2, 0, 2.2, 0.99);
  assert.ok(c.mass > 5000, `crater bowl ${c.mass} kg`);
  assert.ok(s.parts.n > 0, 'clods in flight');
  settle(d, s);
  const m1 = totalMass(s);
  assert.ok(Math.abs(m1 - m0) < 1e-6 * m0, `mass drift ${m1 - m0} kg`);
  // the rim stands above the old ground; the bowl below it
  const rim = Math.max(...[0, 1, 2, 3].map((q) => d.h[idx(d, 0.3 + 2.6 * Math.cos(q * 1.57), -0.2 + 2.6 * Math.sin(q * 1.57))]));
  assert.ok(rim > 0.05, `rim ${rim}`);
  assert.ok(d.h[idx(d, 0.3, -0.2)] < -0.5, 'bowl');
});

test('soil: dumped spoil of every kind comes to rest at its angle of repose', () => {
  for (const t of ['topsoil', 'clay', 'sand', 'gravel', 'fill', 'rock'] as const) {
    const { d, s } = site(only('rock'));
    heapSoil(d, s, 0, 0, 0.5, 12000, soilIndex(t));
    const steps = settle(d, s);
    assert.ok(!busy(s), `${t} settles (${steps} steps)`);
    const tn = Math.tan((SOIL[t].repose * Math.PI) / 180);
    let worst = 0;
    for (let j = 1; j < d.n - 1; j++) for (let i = 1; i < d.n - 1; i++) {
      const k = i + d.n * j;
      if (s.L[k] <= 1e-4) continue;
      for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const m = k + di + d.n * dj, run = d.cell * Math.hypot(di, dj);
        worst = Math.max(worst, Math.abs(d.h[k] - d.h[m]) / run);
      }
    }
    assert.ok(worst <= tn + 0.05, `${t}: steepest ${worst.toFixed(3)} vs tan(repose) ${tn.toFixed(3)}`);
    // the flank: from the peak out to the toe
    const peak = d.h[idx(d, 0, 0)];
    let x = 0;
    while (s.L[idx(d, x, 0)] > 0.02) x += d.cell;
    const flank = peak / x;
    assert.ok(flank > tn * 0.8 && flank < tn * 1.1, `${t}: flank ${flank.toFixed(3)} vs ${tn.toFixed(3)}`);
  }
});

/** a trench along x, ~1.5 m wide; the mass dug (kg) */
function trench(d: TerrainData, s: SoilState, depth: number): number {
  const acc = new Float64Array(SOILS.length);
  let m = 0;
  for (let pass = 0; pass < Math.ceil(depth / 0.5); pass++) for (let x = -4; x <= 4; x += 0.5) for (const z of [-0.5, 0, 0.5]) m += digSoil(d, s, x, z, 0.55, 0.5, acc);
  return m;
}

function wall(d: TerrainData): number {
  // steepest drop across the trench's side, in its middle
  let worst = 0;
  for (let z = -2; z <= 2; z += d.cell) worst = Math.max(worst, Math.abs(d.h[idx(d, 0, z)] - d.h[idx(d, 0, z + d.cell)]) / d.cell);
  return worst;
}

test('soil: dry sand runs at once; clay stands on its undrained strength, then fails', () => {
  const sand = site({ layers: [{ soil: 'gravel', thick: 12 }, { soil: 'rock', thick: Infinity }] });
  const m0 = totalMass(sand.s);
  const acc = new Float64Array(SOILS.length);
  for (let x = -4; x <= 4; x += 0.5) digSoil(sand.d, sand.s, x, 3, 0.55, 0.4, acc);
  const out = acc.reduce((a, b) => a + b, 0) * sand.d.cell * sand.d.cell;
  const dug = trench(sand.d, sand.s, 2.5);
  for (let i = 0; i < 90; i++) soilStep(sand.d, sand.s);
  assert.ok(sand.s.stats.fails > 0, 'gravel walls fail');
  settle(sand.d, sand.s);
  assert.ok(wall(sand.d) < Math.tan((40 * Math.PI) / 180) + 0.1, `gravel wall ${wall(sand.d)}`);
  // what slipped is all still there: only the trench's own spoil left the site
  const drift = totalMass(sand.s) + out + dug - m0;
  assert.ok(Math.abs(drift) < 1e-6 * m0, `slips conserve mass (drift ${drift} kg)`);

  const clay = site(only('clay'));
  trench(clay.d, clay.s, 3.5);
  for (let i = 0; i < 60; i++) soilStep(clay.d, clay.s);
  assert.equal(clay.s.stats.fails, 0, 'a fresh cut in clay stands');
  assert.ok(wall(clay.d) > 2, `clay wall ${wall(clay.d)}`);
  for (let i = 0; i < 60 * 240 && clay.s.stats.fails === 0; i++) soilStep(clay.d, clay.s);
  assert.ok(clay.s.stats.fails > 0, 'softened, it slips');
});

test('soil: an impact dents soft ground and heaves the rim, mass conserved', () => {
  const { d, s } = site();
  const m0 = totalMass(s);
  const m = dentSoil(d, s, -0.6, 0.6, -0.4, 0.4, 0.2);
  assert.ok(m > 0);
  assert.ok(d.h[idx(d, 0, 0)] < -0.15, 'dented');
  settle(d, s);
  assert.ok(Math.abs(totalMass(s) - m0) < 1e-6 * m0);
});

test('soil: deterministic', () => {
  const run = () => {
    const { d, s } = site();
    const acc = new Float64Array(SOILS.length);
    craterSoil(d, s, 2, 1, 0, 2.5, 1.1);
    for (let x = -6; x <= -2; x += 0.5) digSoil(d, s, x, -3, 0.55, 0.6, acc);
    heapSoil(d, s, -4, 3, 0.6, acc.reduce((a, b) => a + b, 0), soilIndex('clay'));
    for (let i = 0; i < 900; i++) soilStep(d, s, 800);
    return Buffer.from(d.h.buffer).toString('base64');
  };
  assert.equal(run(), run());
});

/** samples whose (x, z) lies in [x0, x1] × [z0, z1] */
function inside(d: TerrainData, x0: number, x1: number, z0: number, z1: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < d.n; j++) for (let i = 0; i < d.n; i++) {
    const x = -d.half + i * d.cell, z = -d.half + j * d.cell;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) out.push(i + d.n * j);
  }
  return out;
}

test('soil: nothing rises into what lies on the ground; what is held comes back out when it goes', () => {
  const { d, s } = site();
  const m0 = totalMass(s);
  // a slab resting on the ground over [-1, 1]², its underside at the surface
  ceilings(s, -5, 5, -5, 5, (put) => put(-1, 1, -1, 1, -0.01));
  const under = inside(d, -1, 1, -1, 1), ring = inside(d, -1.5, 1.5, -1.5, 1.5), h0 = ring.map((k) => d.h[k]);
  heapSoil(d, s, 0, 0, 0.6, 3000, soilIndex('fill'));
  heapSoil(d, s, 2.2, 0, 0.6, 6000, soilIndex('sand'));
  let worst = -Infinity;
  for (let q = 0; q < 20000 && busy(s); q++) {
    soilStep(d, s);
    for (const k of under) worst = Math.max(worst, d.h[k]);
  }
  assert.ok(!busy(s), 'settles');
  assert.ok(worst <= 1e-9, `the ground under the slab rose ${worst} m`);
  // a cell out from its edge the ground may stand only a little higher (0.5 m per m)
  ring.forEach((k, q) => assert.ok(d.h[k] <= Math.max(s.cap[k], h0[q]) + 1e-9, `ring sample over its cap by ${d.h[k] - s.cap[k]}`));
  assert.ok(s.holds.size > 0, 'the spoil tipped onto the slab is held under it');
  assert.ok(Math.abs(totalMass(s) - m0 - 9000) < 1e-6 * m0, `mass drift ${totalMass(s) - m0 - 9000} kg`);
  // the slab is lifted away
  ceilings(s, -5, 5, -5, 5, () => {});
  settle(d, s);
  assert.equal(s.holds.size, 0, 'all laid back');
  assert.ok(d.h[idx(d, 0, 0)] > 0.1, `the held spoil is back on the ground (${d.h[idx(d, 0, 0)]} m)`);
  assert.ok(Math.abs(totalMass(s) - m0 - 9000) < 1e-6 * m0);
});

test('soil: a slipping face bulks into the cut, never up under what rests on its crest', () => {
  const { d, s } = site({ layers: [{ soil: 'gravel', thick: 12 }, { soil: 'rock', thick: Infinity }] });
  const m0 = totalMass(s);
  const dug = trench(d, s, 2.5);
  // rubble lying along the crest of the cut's north side
  const crest = inside(d, -3, 3, 0.9, 2.1);
  const y = Math.min(...crest.map((k) => d.h[k]));
  ceilings(s, -8, 8, -8, 8, (put) => put(-3, 3, 0.9, 2.1, y - 0.01));
  const before = crest.map((k) => d.h[k]);
  let rose = 0;
  for (let q = 0; q < 3000 && busy(s); q++) {
    soilStep(d, s);
    crest.forEach((k, q2) => { rose = Math.max(rose, d.h[k] - before[q2]); });
  }
  assert.ok(s.stats.fails > 0, 'the gravel walls fail');
  assert.ok(rose <= 1e-9, `the crest under the rubble rose ${rose} m`);
  const drift = totalMass(s) + dug - m0;
  assert.ok(Math.abs(drift) < 1e-6 * m0, `mass drift ${drift} kg`);
});

test('soil: a body handed back to the ground pushes the soil out from under it, mass conserved', () => {
  const { d, s } = site();
  const m0 = totalMass(s);
  const ks = inside(d, -0.6, 0.6, -0.6, 0.6), ys = ks.map(() => -0.3);
  const m = displace(d, s, ks, ys);
  assert.ok(m > 800, `displaced ${m} kg`);
  for (const k of ks) assert.ok(d.h[k] <= -0.3 + 1e-9, `sample at ${d.h[k]}`);
  assert.ok(Math.max(...inside(d, -1.2, 1.2, -1.2, 1.2).map((k) => d.h[k])) > 0.1, 'heaped round it');
  settle(d, s);
  assert.ok(Math.abs(totalMass(s) - m0) < 1e-6 * m0, `mass drift ${totalMass(s) - m0} kg`);
});
