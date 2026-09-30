import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* Gas that gathers where nothing burns deflagrates once when it meets a flame; gas that burns as it comes out (a lit
   leak, a pilot at the orifice) is a standing jet flame and never blows up however long it runs. A closed concrete
   room filled to ~9 % methane and sparked must give exactly one blast; an open leak held alight by a pilot for 30 s
   gives at most the first flash of what it let out before the flame caught, then burns steadily. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a gas-filled room explodes once; a burning leak stays a steady flame', { timeout: 300_000 }, async () => {
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
    const { initFx } = await L('/src/render/fx.ts');
    const fields = await L('/src/sim/fields/index.ts');
    initFx(new THREE.Scene(), new THREE.PerspectiveCamera());
    await phys.initPhysics();
    st.initStructures(new THREE.Scene());
    phys.createWorld();
    st.buildBlueprint({ pieces: [] });
    /* a sealed 4 × 2.5 × 4 m room of 0.3 m concrete, its inside on whole metres */
    const [x0, z0] = [20, 20], t = 0.3, W = 4, H = 2.5;
    const box = (pos: number[], size: number[]) => ({ mat: 'concrete', size, pos, anchored: true });
    st.spawnPieces([
      box([x0 + W / 2, -t / 2 + 0.001, z0 + W / 2], [W + 2 * t, t, W + 2 * t]),
      box([x0 + W / 2, H + t / 2, z0 + W / 2], [W + 2 * t, t, W + 2 * t]),
      box([x0 - t / 2, H / 2, z0 + W / 2], [t, H, W]),
      box([x0 + W + t / 2, H / 2, z0 + W / 2], [t, H, W]),
      box([x0 + W / 2, H / 2, z0 - t / 2], [W + 2 * t, H, t]),
      box([x0 + W / 2, H / 2, z0 + W + t / 2], [W + 2 * t, H, t]),
    ]);
    let booms = 0, frame = 0;
    const log: string[] = [];
    st.setStructureHooks((pos: number[], r: number) => { booms++; log.push(`${(frame / 60).toFixed(2)} s at ${pos.map((v) => v.toFixed(1))} r ${r.toFixed(1)}`); }, () => {});
    const handlers = { hit: (a: unknown, b: unknown, p: unknown, n: unknown, s: unknown) => st.onHit(a, b, p, n, s), begin() {}, jointBroken: (id: unknown) => st.onJointBroken(id) };
    const step = (n: number, each?: () => void) => {
      for (let i = 0; i < n; i++, frame++) { each?.(); phys.step(handlers); st.afterStep(phys.FIXED_DT); }
    };
    step(30);

    /* confined: ~9 % methane through the room, then a spark */
    for (let y = 0; y < 2; y++) for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) fields.addGas([x0 + x + 0.5, y + 0.5, z0 + z + 0.5], 0.06, 'methane', 1);
    step(6);
    const d0 = fields.fieldStats().deflagrations;
    fields.spark([x0 + 2.5, 1.5, z0 + 2.5], 0.5);
    step(420);
    const roomDefl = fields.fieldStats().deflagrations - d0, roomBooms = booms;
    assert.equal(roomDefl, 1, `the gas-filled room deflagrated ${roomDefl} times`);
    assert.equal(roomBooms, 1, `the gas-filled room blew ${roomBooms} times: ${log.join('; ')}`);

    /* open leak, 0.2 kg/s of methane with a pilot flame at the orifice for 30 s */
    const leak = [-20.5, 0.5, -20.5];
    const d1 = fields.fieldStats().deflagrations, b1 = booms;
    step(1800, () => { fields.addGas(leak, 0.2, 'methane'); fields.spark(leak, 0.05); });
    const leakDefl = fields.fieldStats().deflagrations - d1;
    assert.ok(leakDefl <= 1, `the lit leak deflagrated ${leakDefl} times in 30 s: ${log.join('; ')}`);
    assert.ok(booms - b1 <= 1, `the lit leak blew ${booms - b1} times in 30 s: ${log.join('; ')}`);
    /* the core of the jet is too rich to be premixed; it burns where it mixes, at the pilot, heating the air over it */
    let hot = 0;
    for (let dy = 0; dy <= 3; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) hot = Math.max(hot, fields.sampleField([leak[0] + dx, leak[1] + dy, leak[2] + dz], 'T'));
    assert.ok(hot > 80, `the lit leak is not burning (hottest gas by it ${hot.toFixed(0)} °C)`);
  } finally {
    await server.close();
  }
});
