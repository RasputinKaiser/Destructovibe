import { DOWNTOWN, SANDBOX } from '../src/levels/contracts.ts';
import { checkGrid } from '../src/levels/grid.ts';
import { checkClearanceGrid } from '../src/levels/maps/clearance.ts';
import { groundFn } from '../src/terrain/raster.ts';

declare const process: { exit(code: number): never };

/* Every consumer on the Clearance Zone reaches a grid source (substation, governor, pumping station, boiler house or
   a site generator), and every non-engine motor sits on a live supply. */
const bp = SANDBOX.build();
const { errors, networks } = checkClearanceGrid(bp);
const live = networks.filter((n) => n.sources.length);
for (const k of ['power', 'gas', 'water', 'steam'] as const) {
  const ns = networks.filter((n) => n.kind === k);
  const big = ns.reduce((a, n) => (n.members > a.members ? n : a), { members: 0, sources: [] as string[] });
  console.log(`${k.padEnd(6)} ${String(ns.length).padStart(3)} networks, largest ${String(big.members).padStart(4)} members fed by ${big.sources.join(', ') || 'nothing'}`);
}
console.log(`${live.length} live networks, ${bp.pieces.length} pieces`);
// Downtown: the street lights and signals hang off the district substation's feeders
const dbp = DOWNTOWN.build();
const dt = checkGrid(dbp, (p) => p.fixture === 'transformer', groundFn(dbp.terrain));
console.log(`downtown: ${dt.networks.filter((n) => n.sources.length).length} live networks`);
errors.push(...dt.errors.map((e) => `downtown: ${e}`));
for (const e of errors) console.log('ERROR ' + e);
console.log(errors.length ? `\n${errors.length} grid error(s)` : '\ngrid ok: every consumer reaches a grid source');
process.exit(errors.length ? 1 : 0);
