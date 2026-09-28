import { boxPoly, contains, makeSeeds, volumeCentroid, voronoi } from '../src/destruction/polytope.ts';
import type { Vec3 } from '../src/types.ts';

/** The thin-face impact formerly rejected most clustered 3-D seeds and shattered the whole wall. */
const cases: { name: string; half: Vec3; impact: Vec3; count: number; fraction: number }[] = [
  { name: 'thin masonry wall', half: [4, 1.5, 0.12], impact: [1.4, 0.3, 0.12], count: 12, fraction: 0.7 },
  { name: 'floor slab', half: [3, 0.1, 2], impact: [-1, 0.1, 0.4], count: 12, fraction: 0.7 },
  { name: 'thick column', half: [0.6, 1.8, 0.6], impact: [0.6, 0.5, 0], count: 10, fraction: 0.6 },
];
for (const c of cases) {
  const solid = boxPoly(...c.half);
  const seeds = makeSeeds(solid, c.impact, c.count, c.fraction, 0.85);
  if (seeds.length !== c.count || seeds.some(s => !contains(solid, s, 0.004))) {
    throw Error(`${c.name}: missing or out-of-bounds seeds (${seeds.length}/${c.count})`);
  }
  if (new Set(seeds.map(s => s.map(v => Math.round(v * 25)).join(','))).size < c.count - 1) {
    throw Error(`${c.name}: overlapping seeds`);
  }
  if (c.name === 'thin masonry wall' && seeds.filter(s => Math.hypot(s[0] - c.impact[0], s[1] - c.impact[1]) < 1.5).length < 5) {
    throw Error(`${c.name}: damage stopped clustering at the impact`);
  }
  const cells = voronoi(solid, seeds, [1, 1, 1]);
  const centre: Vec3 = [0, 0, 0];
  const expected = volumeCentroid(solid, centre);
  const actual = cells.reduce((sum, cell) => sum + cell.volume, 0);
  if (Math.abs(expected - actual) / expected > 0.003) {
    throw Error(`${c.name}: volume changed from ${expected} to ${actual}`);
  }
  if (cells.length < c.count - 1) throw Error(`${c.name}: ${cells.length}/${c.count} cells survived`);
  console.log(`${c.name}: ${seeds.length} seeds, ${cells.length} cells, volume error ${((actual / expected - 1) * 100).toFixed(3)}%`);
}
