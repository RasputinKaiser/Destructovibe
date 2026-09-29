import { assemble, buildParts, type BuildingDef } from '../src/buildings/assemble.ts';
import { bearingIssues } from '../src/buildings/bearings.ts';
import { claimRefusal, describeClaim, isClaimFile, parseClaim, type Claim } from '../src/buildings/claims.ts';
import { fingerprint } from '../src/buildings/fingerprint.ts';
import { validateBlueprint } from '../src/levels/validate.ts';
import type { Blueprint, PieceSpec } from '../src/types.ts';

type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean };
declare const process: {
  argv: string[];
  execPath: string;
  pid: number;
  exit(code: number): never;
  getBuiltinModule(id: 'fs'): {
    existsSync(path: string): boolean;
    readFileSync(path: string, enc: 'utf8'): string;
    writeFileSync(path: string, data: string): void;
    readdirSync(path: string, opts: { withFileTypes: true }): Dirent[];
    mkdirSync(path: string, opts: { recursive: true }): void;
    renameSync(from: string, to: string): void;
    rmSync(path: string, opts: { recursive: true; force: true }): void;
  };
  getBuiltinModule(id: 'path'): { join(...parts: string[]): string; dirname(p: string): string };
  getBuiltinModule(id: 'url'): { fileURLToPath(u: string): string; pathToFileURL(p: string): { href: string } };
  getBuiltinModule(id: 'child_process'): {
    spawnSync(cmd: string, args: string[], opts: { cwd: string; encoding: 'utf8'; maxBuffer: number; timeout: number }): { status: number | null; stdout: string | null; stderr: string | null; error?: Error & { code?: string } };
  };
};
const { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, rmSync } = process.getBuiltinModule('fs');
const { join, dirname } = process.getBuiltinModule('path');
const { fileURLToPath, pathToFileURL } = process.getBuiltinModule('url');
const { spawnSync } = process.getBuiltinModule('child_process');

const SETTLE_TIMEOUT_MS = 600_000;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BROOT = join(ROOT, 'src', 'buildings');
const VALID_ID = /^[a-z0-9][a-z0-9-]*$/;
type Fp = ReturnType<typeof fingerprint>;
type Def = BuildingDef<Record<string, unknown>>;

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const valueArgs = new Set([opt('--variant'), opt('--part'), opt('--agent')].filter((v): v is string => v !== undefined));
const target = argv.find((a) => !a.startsWith('--') && !valueArgs.has(a));
if (!target) {
  console.error('usage: node scripts/check-building.ts <id> [--variant v] [--part p] [--settle] [--update [--agent a]]');
  process.exit(2);
}
const wantVariant = opt('--variant');
const wantPart = opt('--part');
const agent = opt('--agent');
const settle = flag('--settle');
const update = flag('--update');

const errors: string[] = [];
const warnings: string[] = [];

/* ---- registry integrity: every package folder, each def imported on its own so one broken package cannot take down
   another package's check. Problems that involve the target are errors; problems confined to other packages are warnings
   (their own checks fail on them). ---- */
const folders = readdirSync(BROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(BROOT, d.name, 'def.ts')))
  .map((d) => d.name).sort();
const defs = new Map<string, Def>();
const issues: { pkgs: string[]; msg: string }[] = [];
async function load(folder: string): Promise<void> {
  try {
    const m = await import(pathToFileURL(join(BROOT, folder, 'def.ts')).href) as { default?: Def };
    if (!m.default || typeof m.default.frame !== 'function' || !Array.isArray(m.default.parts)) issues.push({ pkgs: [folder], msg: `package '${folder}': def.ts has no BuildingDef default export` });
    else defs.set(folder, m.default);
  } catch (e) {
    issues.push({ pkgs: [folder], msg: `package '${folder}' failed to load: ${String((e as Error)?.message ?? e).split('\n')[0]}` });
  }
}
if (folders.includes(target)) await load(target);
for (const f of folders) if (f !== target) await load(f);

/* ids used by hand-written palette entries (prefab('<id>', ...) in src/levels/prefabs.ts), read as text so this check
   does not import the registry. */
const handIds = new Set([...readFileSync(join(ROOT, 'src', 'levels', 'prefabs.ts'), 'utf8').matchAll(/\bprefab\(\s*'([^']+)'/g)].map((m) => m[1]));
const seen = new Map<string, string>();
for (const folder of folders) {
  if (!VALID_ID.test(folder)) issues.push({ pkgs: [folder], msg: `folder '${folder}' is not a valid building id (${VALID_ID}); gen-buildings skips it` });
  const d = defs.get(folder);
  if (!d) continue;
  if (d.id !== folder) issues.push({ pkgs: [folder], msg: `def.id '${d.id}' does not match its folder '${folder}'` });
  for (const id of [d.id, ...(d.variants ?? []).map((v) => v.id)]) {
    const prev = seen.get(id);
    if (prev !== undefined) issues.push({ pkgs: [prev, folder], msg: `id '${id}' is used by both '${prev}' and '${folder}'` });
    else seen.set(id, folder);
    if (handIds.has(id)) issues.push({ pkgs: [folder], msg: `id '${id}' of '${folder}' clashes with a hand-written prefab in src/levels/prefabs.ts` });
  }
}

const baseId = folders.includes(target) ? target : [...defs].find(([, d]) => d.id === target || (d.variants ?? []).some((v) => v.id === target))?.[0];
for (const i of issues) (baseId !== undefined && i.pkgs.includes(baseId) ? errors : warnings).push(`registry: ${i.msg}`);
if (baseId === undefined) { errors.push(`unknown building or variant '${target}'`); finish(); }
const def = defs.get(baseId!);
if (!def) finish();
const id = baseId!;
if (!id.startsWith('zz-test-')) {
  const reg = join(BROOT, 'registry.gen.ts');
  if (!existsSync(reg) || !readFileSync(reg, 'utf8').includes(`'./${id}/def.ts'`)) warnings.push(`${id}: not in registry.gen.ts (run npm run buildings)`);
}

const all = [
  { key: 'default', id: def!.id, params: {} as Record<string, unknown> },
  ...(def!.variants ?? []).map((v) => ({ key: v.id, id: v.id, params: v.params as Record<string, unknown> })),
];
const isVariantTarget = target !== id && target !== def!.id;
const runs = wantVariant ? all.filter((v) => v.key === wantVariant) : isVariantTarget ? all.filter((v) => v.id === target) : all;
if (wantVariant && runs.length === 0) errors.push(`${id}: no variant '${wantVariant}'`);
const partIds = def!.parts.map((p) => p.id);
const scopePart = wantPart ? def!.parts.find((p) => p.id === wantPart) : undefined;
if (wantPart && !scopePart) { errors.push(`${id}: no part '${wantPart}'`); finish(); }

/* ---- --part scoping: findings about other parts are reported as warnings ---- */
const inScope = (p: string) => !wantPart || p === wantPart;
const report = (own: boolean, msg: string) => (own ? errors : warnings).push(own || !wantPart ? msg : `[not ${wantPart}] ${msg}`);
const scopeBearings = new Set([...(scopePart?.needs ?? []), ...(scopePart?.provides ?? [])]);

/* validateBlueprint names pieces by `#index`; map them to the parts they came from. */
function partsOf(msg: string, ps: PieceSpec[]): Set<string> {
  const parts = new Set<string>();
  for (const m of msg.matchAll(/#(\d+)/g)) { const q = ps[+m[1]]; if (q?.part) parts.add(q.part); }
  return parts;
}

/* ---- baselines: baseline/<variant>/<part>.json, one file per part so part owners never write the same file ---- */
const bdir = join(BROOT, id, 'baseline');
const hasBaseline = existsSync(bdir);
if (existsSync(join(BROOT, id, 'baseline.json'))) warnings.push(`${id}: legacy baseline.json is ignored (baselines live in baseline/<variant>/<part>.json); delete it`);
if (!hasBaseline) warnings.push(`${id}: no baseline/${update ? ' (creating)' : ' (run with --update to create)'}`);
const listDir = (d: string, dirs: boolean) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => (dirs ? e.isDirectory() : e.isFile())).map((e) => e.name) : []);
const readFp = (file: string): Fp | 'bad' | undefined => {
  if (!existsSync(file)) return undefined;
  try { return JSON.parse(readFileSync(file, 'utf8')) as Fp; } catch { return 'bad'; }
};
const same = (a: Fp, b: Fp) => a.hash === b.hash && a.pieces === b.pieces && a.mass === b.mass;
const writes: { file: string; fp: Fp }[] = [];
const removals: string[] = [];

if (hasBaseline) {
  const keys = new Set(all.map((v) => v.key));
  for (const v of listDir(bdir, true)) if (!keys.has(v)) {
    warnings.push(`${id}: stale baseline entry baseline/${v}/ (no such variant)`);
    if (update && !wantPart && !wantVariant && !isVariantTarget) removals.push(join(bdir, v));
  }
}

for (const run of runs) {
  const label = `${id}${run.key === 'default' ? '' : ` [${run.key}]`}`;
  const params = { ...def!.defaults, ...run.params };
  const parts = buildParts(def!, params);

  for (const pt of def!.parts) {
    const n = parts.find((x) => x.part === pt.id)!.pieces.length;
    if (n > pt.budget) report(inScope(pt.id), `${label}: part ${pt.id}: ${n} pieces over budget ${pt.budget}`);
  }

  const placed = assemble(def!, { x: 0, z: 0, ...params });
  const v = validateBlueprint({ pieces: placed } as Blueprint, { bounds: 200, maxPieces: 100000 });
  for (const e of v.errors) {
    const ps = partsOf(e, placed);
    const tagged = ps.size ? `[${[...ps].join(', ')}] ${e}` : e;
    report(!wantPart || ps.size === 0 || ps.has(`${id}/${wantPart}`), `${label}: ${tagged}`);
  }
  /* validate.ts rates floating pieces as warnings (the stand has two pre-existing ones), so they stay warnings here. */
  for (const w of v.warnings) if (/^floating|loose prop/.test(w)) {
    const ps = partsOf(w, placed);
    const own = !wantPart || ps.size === 0 || ps.has(`${id}/${wantPart}`);
    warnings.push(`${own || !wantPart ? '' : `[not ${wantPart}] `}${label}: ${ps.size ? `[${[...ps].join(', ')}] ` : ''}${w}`);
  }

  if (def!.pipeline !== 'raw') for (const b of bearingIssues(def!, params)) report(inScope(b.part) || scopeBearings.has(b.bearing), `${label}: ${b.msg}`);

  const vdir = join(bdir, run.key);
  const now: Record<string, Fp> = {};
  for (const x of parts) now[x.part] = fingerprint(x.pieces);
  for (const f of listDir(vdir, false)) {
    if (f.endsWith('.tmp')) continue;
    const p = f.replace(/\.json$/, '');
    if (!f.endsWith('.json') || !partIds.includes(p)) {
      warnings.push(`${label}: stale baseline entry baseline/${run.key}/${f} (no such part)`);
      if (update && !wantPart) removals.push(join(vdir, f));
    }
  }
  for (const p of partIds) {
    const file = join(vdir, `${p}.json`), have = readFp(file);
    if (update) {
      if (inScope(p) && (have === undefined || have === 'bad' || !same(have, now[p]))) writes.push({ file, fp: now[p] });
      continue;
    }
    if (!hasBaseline) continue;
    if (have === 'bad') report(inScope(p), `${label}: baseline/${run.key}/${p}.json is not valid JSON`);
    else if (have === undefined) report(inScope(p), `${label}: part ${p} changed (new, not in baseline; run with --update)`);
    else if (!same(have, now[p]))
      report(inScope(p), `${label}: part ${p} changed (pieces ${have.pieces}->${now[p].pieces}, mass ${have.mass}->${now[p].mass}, hash ${have.hash}->${now[p].hash})`);
  }

  if (settle) {
    const r = spawnSync(process.execPath, ['scripts/sim.mjs', `B:${run.id}`, '1800'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: SETTLE_TIMEOUT_MS });
    const out = r.stdout ?? '', err = r.stderr ?? '';
    const tail = (err || out).trim().split('\n').slice(-3).join(' | ');
    const line = out.split('\n').reverse().find((l) => l.startsWith('RESULT '));
    if (r.error?.code === 'ETIMEDOUT') errors.push(`${label}: settle timed out after ${SETTLE_TIMEOUT_MS / 1000}s`);
    else if (r.error) errors.push(`${label}: settle failed to run (${r.error.message})`);
    else if (r.status !== 0) errors.push(`${label}: settle exited with status ${r.status}${tail ? `: ${tail}` : ''}`);
    else if (!out.trim()) errors.push(`${label}: settle produced no output`);
    else if (!line) errors.push(`${label}: settle produced no RESULT line${tail ? `: ${tail}` : ''}`);
    else {
      console.log(`${label}: ${line}`);
      let res: { weldsLost: number; runaways: number; awakeAtEnd: number } | undefined;
      try { res = JSON.parse(line.slice(7)); } catch { errors.push(`${label}: settle RESULT line is not valid JSON: ${line}`); }
      if (res) {
        if (res.weldsLost > 0) errors.push(`${label}: settle lost ${res.weldsLost} welds`);
        if (res.runaways > 0) errors.push(`${label}: settle had ${res.runaways} runaways`);
        if (res.awakeAtEnd > 0) errors.push(`${label}: settle ended with ${res.awakeAtEnd} bodies still awake`);
      }
    }
  }
}

/* ---- claims ---- */
const claims: Claim[] = listDir(join(BROOT, id), false).filter(isClaimFile).map((f) => parseClaim(f, readFileSync(join(BROOT, id, f), 'utf8')));
for (const c of claims) console.log(`CLAIM ${id}/${describeClaim(c)}`);

if (update) {
  const refusal = claimRefusal(claims, agent, wantPart ? [wantPart] : partIds);
  if (refusal) errors.push(`${id}: --update refused: ${refusal}`);
  if (errors.length) console.error('baseline not updated: fix errors first');
  else {
    for (const w of writes) {
      mkdirSync(dirname(w.file), { recursive: true });
      const tmp = `${w.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(w.fp, null, 1) + '\n');
      renameSync(tmp, w.file);
      console.log(`wrote ${w.file.slice(BROOT.length + 1)}`);
    }
    for (const r of removals) { rmSync(r, { recursive: true, force: true }); console.log(`removed stale ${r.slice(BROOT.length + 1)}`); }
    if (!writes.length && !removals.length) console.log(`${id}: baseline already up to date`);
  }
}

finish();

function finish(): never {
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`FAIL ${target} (${errors.length} error${errors.length === 1 ? '' : 's'})`);
    process.exit(1);
  }
  console.log(`OK ${target}${wantPart ? ` --part ${wantPart}` : ''}`);
  process.exit(0);
}
