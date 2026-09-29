import { PREFABS } from '../src/levels/prefabs.ts';
import { LANDMARKS } from '../src/levels/architecture/index.ts';
import { fingerprint } from '../src/buildings/fingerprint.ts';

declare const process: { argv: string[]; exit(code: number): never; getBuiltinModule(id: 'fs'): { writeFileSync(path: string, data: string): void } };
const { writeFileSync } = process.getBuiltinModule('fs');
const out = process.argv[2];
if (!out) { console.error('usage: node scripts/fingerprint-levels.ts <out.json>'); process.exit(2); }
const res: Record<string, ReturnType<typeof fingerprint>> = {};
for (const p of PREFABS) res[p.id] = fingerprint(p.build(0, 0, 0));
for (const l of LANDMARKS) res[`landmark:${l.id}`] = fingerprint(l.make({ x: 0, z: 0 }));
writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`fingerprinted ${Object.keys(res).length} builds -> ${out}`);
