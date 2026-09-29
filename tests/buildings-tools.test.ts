import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimRefusal, parseClaim } from '../src/buildings/claims.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (script: string, args: string[]) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

test('gen-buildings: folder filter, claims listing and deterministic, idempotent output', () => {
  const dirs = [mkdtempSync(join(tmpdir(), 'gen-a-')), mkdtempSync(join(tmpdir(), 'gen-b-'))];
  try {
    const folders = ['beta', 'alpha', '_shared', 'zz-test-scratch', 'Bad Name', 'no-def'];
    dirs.forEach((d, i) => {
      for (const f of i ? folders : [...folders].reverse()) {
        mkdirSync(join(d, f));
        if (f !== 'no-def') writeFileSync(join(d, f, 'def.ts'), 'export default {};\n');
      }
      writeFileSync(join(d, 'alpha', 'CLAIM.roofer'), 'agent: roofer\nparts: roof\nsince: 2026-09-29\n');
    });
    const first = run('gen-buildings.ts', ['--root', dirs[0]]);
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /registry: 2 buildings \(written\)/);
    assert.match(first.out, /skipped building folders with invalid names.*'Bad Name'/);
    assert.match(first.out, /alpha\/CLAIM\.roofer: agent=roofer parts=roof since=2026-09-29/);
    const reg = join(dirs[0], 'registry.gen.ts');
    const src = readFileSync(reg, 'utf8');
    assert.ok(src.indexOf("'./alpha/def.ts'") > 0 && src.indexOf("'./alpha/def.ts'") < src.indexOf("'./beta/def.ts'"));
    for (const skipped of ['_shared', 'zz-test-scratch', 'Bad Name', 'no-def']) assert.ok(!src.includes(`./${skipped}/def.ts`), skipped);
    const mtime = statSync(reg).mtimeMs;
    const second = run('gen-buildings.ts', ['--root', dirs[0]]);
    assert.match(second.out, /\(unchanged\)/);
    assert.equal(statSync(reg).mtimeMs, mtime);
    assert.equal(run('gen-buildings.ts', ['--root', dirs[1]]).code, 0);
    assert.equal(readFileSync(join(dirs[1], 'registry.gen.ts'), 'utf8'), src);
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

test('claims: parse and refusal rules', () => {
  const a = parseClaim('CLAIM.a', 'agent: a\nparts: roof, ribs  # mine\n');
  const b = parseClaim('CLAIM.b', 'agent: b\nparts: [walls]\n');
  assert.deepEqual(a.parts, ['roof', 'ribs']);
  assert.deepEqual(parseClaim('CLAIM', 'agent: c\n').parts, 'all');
  assert.equal(claimRefusal([], undefined, ['roof']), null);
  assert.match(claimRefusal([a, b], undefined, ['roof'])!, /--agent/);
  assert.equal(claimRefusal([a, b], 'a', ['roof']), null);
  assert.equal(claimRefusal([a, b], 'b', ['walls']), null);
  assert.match(claimRefusal([a, b], 'b', ['roof'])!, /claimed by 'a'/);
  assert.match(claimRefusal([a, b], 'a', ['floor'])!, /no claim covering part floor/);
  assert.match(claimRefusal([a, b], 'a', ['roof', 'walls'])!, /claimed by 'b'/);
});

/* A two-part toy package: `a` is a pair of walls that provides wallTop, `b` a slab that needs it. `bad` adds a floating
   slab to `b` (over budget, changed; floating is a warning); `lifted` raises b's slab off wallTop; `clash` gives the package a
   variant id that a hand-written prefab already uses. */
const toyDef = (id: string, mode: 'good' | 'bad' | 'lifted' | 'clash') => `import { footprintFrame, type BuildingDef } from '../assemble.ts';
import { block } from '../../levels/kit.ts';
const def: BuildingDef<{ h: number }> = {
  id: '${id}', name: 'Test toy', category: 'props', group: '${id}', defaults: { h: 2 },
  ${mode === 'clash' ? "variants: [{ id: 'crate', name: 'clash', params: {} }]," : ''}
  frame: (p) => ({ ...footprintFrame([-1, 1], [-1, 1]), bearings: { wallTop: { y: p.h, x: [-1, 1], z: [-1, 1] } } }),
  parts: [
    { id: 'a', budget: 4, provides: ['wallTop'], build: (_f, p) => [block('brick', [-1, 1], [0, p.h], [-1, -0.6]), block('brick', [-1, 1], [0, p.h], [0.6, 1])] },
    { id: 'b', budget: 1, needs: ['wallTop'], build: (f) => [block('oak', [-1, 1], ${mode === 'lifted' ? '[2.5, 2.7]' : '[f.bearings.wallTop.y, f.bearings.wallTop.y + 0.2]'}, [-1, 1])${mode === 'bad' ? ", block('oak', [-1, 1], [6, 6.2], [-1, 1])" : ''}] },
  ],
};
export default def;
`;

test('check-building: --part scoping, per-part baselines, stale entries, claims and package isolation', () => {
  const id = `zz-test-${process.pid}`;
  const pkg = join(ROOT, 'src', 'buildings', id), broken = join(ROOT, 'src', 'buildings', `${id}-broken`);
  const file = (p: string) => join(pkg, 'baseline', 'default', `${p}.json`);
  const check = (...args: string[]) => run('check-building.ts', [id, ...args]);
  try {
    mkdirSync(pkg);
    writeFileSync(join(pkg, 'def.ts'), toyDef(id, 'good'));

    let r = check('--update', '--part', 'a');
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(file('a')) && !existsSync(file('b')), 'only part a written');
    const aBytes = readFileSync(file('a'), 'utf8'), aTime = statSync(file('a')).mtimeMs;
    r = check('--update', '--part', 'b');
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(file('b')));
    assert.equal(readFileSync(file('a'), 'utf8'), aBytes);
    assert.equal(statSync(file('a')).mtimeMs, aTime, 'updating b does not rewrite a');
    assert.equal(check().code, 0);

    writeFileSync(join(pkg, 'def.ts'), toyDef(id, 'bad'));
    r = check('--part', 'a');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /warning: \[not a\] .*part b: 2 pieces over budget 1/);
    assert.match(r.out, /warning: \[not a\] .*floating/);
    assert.match(r.out, /warning: \[not a\] .*part b changed/);
    r = check('--part', 'b');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /error: .*part b: 2 pieces over budget 1/);
    assert.match(r.out, /warning: .*\[zz-test-\d+\/b\] floating/);
    assert.match(r.out, /error: .*part b changed/);
    assert.equal(check().code, 1);
    r = check('--update', '--part', 'a');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /baseline already up to date/);
    assert.equal(statSync(file('a')).mtimeMs, aTime);
    assert.equal(check('--update', '--part', 'b').code, 1, 'broken part b cannot be baselined');
    writeFileSync(join(pkg, 'def.ts'), toyDef(id, 'lifted'));
    r = check('--part', 'a');
    assert.equal(r.code, 1, 'a bearing that a provides is in a\'s scope');
    assert.match(r.out, /error: .*part b needs wallTop: no piece bottom/);
    writeFileSync(join(pkg, 'def.ts'), toyDef(id, 'good'));

    writeFileSync(file('gone'), '{}\n');
    mkdirSync(join(pkg, 'baseline', 'ghost'));
    r = check();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /warning: .*stale baseline entry baseline\/default\/gone\.json/);
    assert.match(r.out, /warning: .*stale baseline entry baseline\/ghost\//);
    rmSync(file('gone'));
    rmSync(join(pkg, 'baseline', 'ghost'), { recursive: true });

    writeFileSync(join(pkg, 'CLAIM.alice'), 'agent: alice\nparts: a\nsince: 2026-09-29T00:00Z\n');
    r = check('--update', '--part', 'a');
    assert.equal(r.code, 1);
    assert.match(r.out, /--update refused: package is claimed/);
    r = check('--update', '--part', 'a', '--agent', 'bob');
    assert.equal(r.code, 1);
    assert.match(r.out, /refused: part a is claimed by 'alice'/);
    r = check('--update', '--part', 'b', '--agent', 'carol');
    assert.equal(r.code, 1);
    assert.match(r.out, /refused: agent 'carol' holds no claim covering part b/);
    r = check('--update', '--part', 'b', '--agent', 'alice');
    assert.equal(r.code, 1);
    assert.match(r.out, /refused: agent 'alice' holds no claim covering part b/);
    writeFileSync(join(pkg, 'CLAIM.bob'), 'agent: bob\nparts: b\n');
    assert.match(check('--update', '--part', 'a', '--agent', 'bob').out, /part a is claimed by 'alice'/);
    assert.equal(check('--update', '--part', 'a', '--agent', 'alice').code, 0);
    assert.equal(check('--update', '--part', 'b', '--agent', 'bob').code, 0);
    assert.match(check('--update', '--agent', 'alice').out, /part b is claimed by 'bob'/);

    mkdirSync(broken);
    writeFileSync(join(broken, 'def.ts'), "throw new Error('half-edited');\n");
    r = check();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`warning: registry: package '${id}-broken' failed to load: half-edited`));
    r = run('check-building.ts', [`${id}-broken`]);
    assert.equal(r.code, 1);
    assert.match(r.out, new RegExp(`error: registry: package '${id}-broken' failed to load`));

    writeFileSync(join(pkg, 'def.ts'), toyDef(id, 'clash'));
    r = check();
    assert.equal(r.code, 1);
    assert.match(r.out, /id 'crate' of '.*' clashes with a hand-written prefab/);
  } finally {
    rmSync(pkg, { recursive: true, force: true });
    rmSync(broken, { recursive: true, force: true });
  }
});
