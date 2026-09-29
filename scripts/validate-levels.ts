import { CONTRACTS, DOWNTOWN, RAILWAY, SANDBOX, SHOWCASE } from '../src/levels/contracts.ts';
import { PREFABS, prefabView } from '../src/levels/prefabs.ts';
import { checkWalkability, validateBlueprint, type Limits } from '../src/levels/validate.ts';
import type { Blueprint, Contract } from '../src/types.ts';

declare const process: { argv: string[]; exit(code: number): never };

const SHORT: Record<string, string> = { hammer: 'ham', cannon: 'can', rocket: 'rkt', charge: 'chg', airstrike: 'air' };
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const rows: string[][] = [];
let failed = 0;
const notes: string[] = [];

/* contracts cut from a free-play map take that map's bounds and a free-play budget */
const SITE: Record<string, Limits> = { showcase: { bounds: 45, maxPieces: 3000 }, downtown: { bounds: 80, maxPieces: 5500 }, railway: { bounds: 90, maxPieces: 4800 } };
/* (from the blueprint the loop builds anyway: a build of a map-cut contract costs as much as the map's) */
const onMap = (bp: Blueprint): Limits => { const h = bp.terrain?.half; return h ? { bounds: h, maxPieces: h > 80 ? SITE.railway.maxPieces : h > 50 ? SITE.downtown.maxPieces : SITE.showcase.maxPieces } : {}; };
const levels: [string, Contract, Limits | typeof onMap][] = [...CONTRACTS.map((c, i) => [String(i + 1), c, onMap] as [string, Contract, typeof onMap]), ['S', SANDBOX, { bounds: 65, maxPieces: 3200 }], ['H', SHOWCASE, SITE.showcase], ['D', DOWNTOWN, SITE.downtown], ['R', RAILWAY, SITE.railway]];
/* free-play sites stand on terrain: walkability, buried services, and a doorway into each building on foot */
const WALK: Record<string, string[]> = {
  S: ['pub', 'chipshop', 'shop-a', 'terrace', 'cottages', 'semis', 'chapel', 'boilerhouse', 'merchant', 'works', 'pressshop', 'pumping'],
  H: ['cathedral', 'mill', 'barn', 'tudor', 'boilerhouse', 'terrace', 'rotunda'],
  D: ['tower', 'store', 'skyscraper2', 'office', 'stand', 'carpark', 'flats', 'flats2'],
  R: ['station', 'millworks', 'stadium', 'cottages'],
};
for (const [idx, c, lim] of levels) {
  const bp = c.build();
  const limits = typeof lim === 'function' ? lim(bp) : lim;
  const { errors, warnings, stats } = validateBlueprint(bp, limits);
  if (WALK[idx]) {
    const w = checkWalkability(bp, { buildings: WALK[idx] });
    errors.push(...w.errors.map((e) => `walk: ${e}`));
    warnings.push(...w.warnings.map((e) => `walk: ${e}`));
    if (stats.pieces > (limits.maxPieces ?? 0)) errors.push(`${stats.pieces} pieces over the site budget of ${limits.maxPieces}`);
  }
  if (JSON.stringify(c.build()) !== JSON.stringify(bp)) errors.push('build() is not deterministic');
  if (errors.length) failed++;
  const tools = Object.entries(c.ammo);
  const ammo = tools.length >= 12 && tools.every(([, v]) => v < 0) ? 'every tool ∞'
    : tools.map(([k, v]) => `${SHORT[k] ?? k} ${v < 0 ? '∞' : v}`).join(', ');
  rows.push([idx, c.name, c.target.toFixed(2), String(c.par), c.env, String(stats.pieces), String(stats.welds), String(stats.groundWelds),
    String(stats.protectedPieces), String(stats.props), String(stats.lamps), String(stats.sources), String(stats.mechs), String(stats.ropes), stats.volume.toFixed(0), stats.maxHeight.toFixed(1), String(errors.length), String(warnings.length), ammo]);
  for (const e of errors) notes.push(`[${idx}] ERROR ${e}`);
  for (const w of warnings) notes.push(`[${idx}] warn  ${w}`);
  if (verbose) {
    const mats = Object.entries(stats.byMaterial).map(([k, v]) => `${k} ${v}`).join(', ');
    const groups = Object.entries(stats.byGroup).map(([k, v]) => `${k} ${v}`).join(', ');
    notes.push(`[${idx}] materials: ${mats}`, `[${idx}] groups: ${groups}`);
  }
}

const head = ['#', 'contract', 'target', 'par', 'env', 'pieces', 'welds', 'ground', 'prot', 'props', 'lamps', 'srcs', 'mech', 'ropes', 'vol m3', 'top m', 'err', 'warn', 'ammo'];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (r: string[]) => r.map((v, i) => (i === 1 || i === 4 || i === 18 ? v.padEnd(widths[i]) : v.padStart(widths[i]))).join('  ');
console.log(line(head));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(line(r));

// prefabs: each checked where it is dropped at the origin and again moved and turned a quarter
const PREFAB_LIMITS: Limits = { bounds: 80, maxPieces: 1500 };
const prefabRows: string[] = [];
for (const pf of PREFABS) {
  const v = prefabView(pf);
  const errs: string[] = [], warns: string[] = [];
  let welds = 0, lamps = 0, mechs = 0;
  for (const [x, z, q] of [[0, 0, 0], [7.3, -4.1, 1]] as const) {
    const r = validateBlueprint({ pieces: pf.build(x, z, q) }, PREFAB_LIMITS);
    errs.push(...r.errors);
    warns.push(...r.warnings);
    if (!q) ({ welds, lamps, mechs } = r.stats);
  }
  if (errs.length) failed++;
  prefabRows.push(`${v.id.padEnd(18)} ${v.category.padEnd(14)} ${String(v.pieces).padStart(5)} pcs ${String(welds).padStart(5)} welds ${String(lamps).padStart(3)} lamps ${String(mechs).padStart(2)} mech  ${v.footprint[0].toFixed(1).padStart(5)} x ${v.footprint[1].toFixed(1).padStart(5)} m  ${errs.length ? `ERR ${errs.length}` : ''}${warns.length ? ` warn ${warns.length}` : ''}`);
  for (const e of errs.slice(0, 3)) notes.push(`[prefab ${v.id}] ERROR ${e}`);
  for (const w of warns.slice(0, 3)) notes.push(`[prefab ${v.id}] warn  ${w}`);
}
console.log(`\n${PREFABS.length} prefabs\n${prefabRows.join('\n')}`);
if (notes.length) console.log('\n' + notes.join('\n'));
console.log(failed ? `\n${failed} level(s)/prefab(s) with errors` : '\nall levels and prefabs valid');
process.exit(failed ? 1 : 0);
