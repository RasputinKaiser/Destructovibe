declare const process: { argv: string[]; exit(code: number): never; getBuiltinModule(id: 'fs'): { readFileSync(path: string, enc: 'utf8'): string } };
const { readFileSync } = process.getBuiltinModule('fs');
type Fp = { pieces: number; mass: number; hash: string };
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) { console.error('usage: node scripts/compare-fingerprints.ts <before.json> <after.json>'); process.exit(2); }
const before: Record<string, Fp> = JSON.parse(readFileSync(beforePath, 'utf8'));
const after: Record<string, Fp> = JSON.parse(readFileSync(afterPath, 'utf8'));
let bad = 0;
for (const id of Object.keys(before)) {
  const b = before[id], a = after[id];
  if (!a) { console.log(`MISSING  ${id}`); bad++; continue; }
  if (a.hash !== b.hash || a.pieces !== b.pieces || a.mass !== b.mass) {
    console.log(`DIFF     ${id}: pieces ${b.pieces}->${a.pieces}, mass ${b.mass}->${a.mass}, hash ${b.hash}->${a.hash}`);
    bad++;
  }
}
const added = Object.keys(after).filter((id) => !before[id]);
for (const id of added) console.log(`NEW      ${id}`);
console.log(`${Object.keys(before).length} compared, ${bad} differ/missing, ${added.length} new`);
process.exit(bad ? 1 : 0);
