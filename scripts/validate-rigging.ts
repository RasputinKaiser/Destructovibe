import { place } from '../src/levels/kit.ts';
import { riggingLine, wireLine } from '../src/levels/rigging.ts';
import { PREFABS } from '../src/levels/prefabs.ts';
import type { PieceSpec, Vec3 } from '../src/types.ts';

const near = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.02;
function endpoints(pieces: PieceSpec[], name: string): number {
  let count = 0;
  for (const start of pieces) {
    if (!start.ropeTo) continue;
    const target = pieces.find(p => p !== start && near(p.pos, start.ropeTo!.end));
    if (!target) throw Error(`${name}: line from ${start.pos} has no destructible end fixture at ${start.ropeTo.end}`);
    if (near(start.pos, target.pos)) throw Error(`${name}: zero-length line`);
    count++;
  }
  return count;
}
for (let quarter = 0; quarter < 4; quarter++) {
  const pieces = place([...riggingLine([-3, 4, 1], [2, 4, 1]), ...wireLine([-3, 2, 2], [2, 2, 2])], 11, -8, quarter);
  if (endpoints(pieces, `quarter ${quarter}`) !== 2) throw Error(`quarter ${quarter}: lines missing`);
}
let builtIn = 0;
for (const prefab of PREFABS) {
  const a = prefab.build(12, -15, 0);
  const lines = endpoints(a, prefab.id);
  if (!lines) continue;
  const rotated = prefab.build(-17, 21, 1);
  if (endpoints(rotated, `${prefab.id} turned`) !== lines) throw Error(`${prefab.id}: rotation changed line count`);
  builtIn += lines;
  console.log(`${prefab.id}: ${lines} joined rope/wire span(s)`);
}
if (builtIn < 2) throw Error('No prefabs ship rigging/wiring');
console.log(`rigging: ${builtIn} prefab spans, four authored rotations and turned placement passed`);
