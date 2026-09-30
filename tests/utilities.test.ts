import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTail, stepTail, tailEnd } from '../src/destruction/conductors.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* A snapped conductor half swings down from its insulator and comes to rest lying along the ground (or dangling, when
   it is shorter than the insulator is high), and stops being stepped. */
test('a fallen conductor half lands and lies still', () => {
  const flat = () => 0;
  const long = makeTail([0, 7.7, 0], [10, 7.7, 0], 9), short = makeTail([0, 7.7, 0], [10, 7.7, 0], 5);
  for (let i = 0; i < 60 * 20; i++) { stepTail(long, [0, 7.7, 0], 1 / 60, flat); stepTail(short, [0, 7.7, 0], 1 / 60, flat); }
  const e: [number, number, number] = [0, 0, 0], d: [number, number, number] = [0, 0, 0];
  tailEnd(long, e, d);
  assert.ok(long.grounded && e[1] < 0.05, `the 9 m half should lie on the ground, end at ${e.map((v) => v.toFixed(2))}`);
  assert.ok(!long.awake, 'it should have stopped moving within 20 s');
  tailEnd(short, e, d);
  assert.ok(!short.grounded && e[1] > 2 && e[1] < 3, `the 5 m half should hang ~2.7 m clear of the ground, end at ${e[1].toFixed(2)}`);
  for (let i = 0; i < 60 * 3; i++) stepTail(long, null, 1 / 60, flat);
  tailEnd(long, e, d);
  assert.ok(e[1] < 0.05, 'with its insulator gone the whole length drops');
});

/* On the Clearance Zone grid: a gas service torn with its meter shut is a safe cut while one torn live is a strike; a
   knocked-over hydrant opens the main at its supply's pressure, a second break on the same main lowers the first jet,
   and cutting the pump hall's power drops the supply to its static head. */
test('burst mains share their supply; isolating first makes a cut safe', { timeout: 600_000 }, async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.requestAnimationFrame ??= (f: () => void) => setTimeout(f, 16);
  const req = createRequire(join(ROOT, 'package.json'));
  const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
  const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  try {
    const L = (p: string) => server.ssrLoadModule(p);
    const THREE = await L('three');
    const phys = await L('/src/physics/physics.ts');
    const st = await L('/src/destruction/structure.ts');
    const svc = await L('/src/destruction/services.ts');
    const { initFx } = await L('/src/render/fx.ts');
    const C = await L('/src/levels/contracts.ts');
    initFx(new THREE.Scene(), new THREE.PerspectiveCamera());
    await phys.initPhysics();
    st.initStructures(new THREE.Scene());
    const handlers = { hit: (a: unknown, b: unknown, p: unknown, n: unknown, s: unknown) => st.onHit(a, b, p, n, s), begin() {}, jointBroken: (id: unknown) => st.onJointBroken(id) };
    const step = (n: number) => { for (let i = 0; i < n; i++) { phys.step(handlers); st.afterStep(phys.FIXED_DT); } };
    const build = () => { phys.createWorld(); st.setDebrisLimit(1400); st.buildBlueprint(C.SANDBOX.build()); step(60); };
    const piece = (test: (p: { root: { spec: { group?: string } }; svc?: { kind: string; part: string | null }; curPos: number[] }) => boolean) => [...st.live].find(test);
    const mainJets = () => svc.serviceBreaks().filter((b: { kind: string; full: boolean; spr: boolean; piece: { root: { spec: { group?: string } } } }) =>
      b.kind === 'water' && b.full && !b.spr && b.piece.root.spec.group === 'watermain');
    const pumpNet = () => svc.serviceNets().find((n: { kind: string; src: { root: { spec: { group?: string } } } }) => n.kind === 'water' && n.src.root.spec.group === 'pumping');

    build();
    /* gas: the pub's service torn with its meter shut, then the shop's torn live */
    const meter = piece((p) => p.svc?.kind === 'gas' && p.svc.part === 'efv' && Math.hypot(p.curPos[0] + 12.9, p.curPos[2] + 13.9) < 1);
    assert.ok(meter, 'the pub has a gas meter');
    svc.svcOperate(meter);
    step(30);
    st.explode([-13.1, 0.6, -13.3], 1.2, 90e3, 3200);
    st.explode([5.1, 0.6, -10.3], 1.2, 90e3, 3200);
    step(90);
    assert.equal(svc.serviceStrikes(['pub']).gas, 0, 'with its meter shut the pub\'s service is a safe cut');
    assert.ok(svc.serviceStrikes(['shop-a']).gas > 0, 'the shop\'s service torn live is a strike');

    /* water: two hydrants off the same pumped main */
    assert.equal(pumpNet().P, 1, 'the pumped main starts at full pressure');
    st.explode([18, 0.5, -0.9], 1.6, 90e3, 3200);
    step(60);
    const one = mainJets();
    assert.ok(one.length >= 1, 'the hydrant blast opens the main');
    const P1 = pumpNet().P, q1 = one[0].q;
    st.explode([-6, 0.5, -0.9], 1.6, 90e3, 3200);
    step(60);
    const P2 = pumpNet().P, q2 = mainJets()[0].q;
    assert.ok(P2 < P1 - 0.05 && q2 < q1, `a second break must lower the first jet: P ${P1.toFixed(2)} → ${P2.toFixed(2)}, q ${q1.toFixed(3)} → ${q2.toFixed(3)}`);
    assert.ok(svc.serviceStrikes().water > 0, 'mains torn live are strikes');
    const isolator = piece((p) => p.root.spec.group === 'pumping' && p.svc?.kind === 'power' && (p.svc.part === 'fuse' || p.svc.part === 'breaker'));
    assert.ok(isolator, 'the pump hall has an isolator');
    svc.svcOperate(isolator);
    step(240);
    assert.ok(pumpNet().P < 0.35 * P2 + 1e-6, `pumps stopped: the main falls to its static head (${pumpNet().P.toFixed(2)} of ${P2.toFixed(2)})`);
  } finally {
    await server.close();
  }
});
