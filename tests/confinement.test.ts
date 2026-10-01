import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* The same 2.5 kg charge, 1 m up in the middle of the same 6 × 3 × 6 m brick room, three ways: open air (the walls
   with no roof over them), a room with a 3 m × 3 m opening in one wall under an RC roof slab, and the closed room. The
   room is judged on the building as it stood: the closed room holds its gas (UFC 3-340-02: ~1.2 bar at
   W/V = 0.023 kg/m³) and blows out, the opening vents most of the blow-down, and in the open only the shock acts.
   Demolition goes closed > vented > open. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a charge in a closed room demolishes more than in a vented one, and that more than in the open', { timeout: 300_000 }, async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.requestAnimationFrame ??= (f: () => void) => setTimeout(f, 16);
  const req = createRequire(join(ROOT, 'package.json'));
  const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
  const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  try {
    const L = (p: string) => server.ssrLoadModule(p);
    const THREE = await L('three');
    const phys = await L('/src/physics/physics.ts');
    const st = await L('/src/destruction/structure.ts');
    const { initFx } = await L('/src/render/fx.ts');
    initFx(new THREE.Scene(), new THREE.PerspectiveCamera());
    await phys.initPhysics();
    st.initStructures(new THREE.Scene());
    const handlers = { hit: (a: unknown, b: unknown, p: unknown, n: unknown, s: unknown) => st.onHit(a, b, p, n, s), begin() {}, jointBroken: (id: unknown) => st.onJointBroken(id) };
    const W = 6, H = 3, t = 0.23, KG = 2.5;
    const room = (roof: boolean, gap: boolean) => {
      const s: Record<string, unknown>[] = [];
      const wall = (x: number, z: number, alongX: boolean) => s.push({ mat: 'brick', size: alongX ? [1.5, H, t] : [t, H, 1.5], pos: [x, H / 2 + 0.001, z], anchored: true, group: 'walls' });
      for (let k = 0; k < 4; k++) {
        const u = -W / 2 + 0.75 + k * 1.5;
        if (!(gap && (k === 1 || k === 2))) wall(u, -W / 2 - t / 2, true);
        wall(u, W / 2 + t / 2, true);
        wall(-W / 2 - t / 2, u, false);
        wall(W / 2 + t / 2, u, false);
      }
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s.push({ mat: 'brick', size: [t, H, t], pos: [x * (W / 2 + t / 2), H / 2 + 0.001, z * (W / 2 + t / 2)], anchored: true, group: 'walls' });
      if (roof) s.push({ mat: 'rconcrete', size: [W + 2 * t, 0.25, W + 2 * t], pos: [0, H + 0.127, 0], group: 'roof' });
      return s;
    };
    type Out = { confined: boolean; Pqs: number; held: number; iGas: number; walls: number; site: number };
    const run = (specs: Record<string, unknown>[]): Out => {
      st.clearStructures();
      phys.createWorld();
      st.buildBlueprint({ pieces: [] });
      st.spawnPieces(specs);
      for (let i = 0; i < 90; i++) { phys.step(handlers); st.afterStep(phys.FIXED_DT); }
      const wallVol = () => {
        let all = 0, up = 0;
        for (const p of st.live) {
          if (p.root.spec.group !== 'walls') continue;
          all += p.volume;
          // standing: not demolished and still on its line
          if (!p.dead && !p.demolished && Math.hypot(p.curPos[0] - p.root.spec.pos[0], p.curPos[2] - p.root.spec.pos[2]) < 0.3) up += p.volume;
        }
        return { all, up };
      };
      const w0 = wallVol().all;
      st.explode([0, 1.0, 0], 3.1 * Math.cbrt(KG), 60e3 * KG, 2150 * Math.sqrt(KG), 1.45, 30);
      const sv = st.lastBlast.survey;
      for (let i = 0; i < 240; i++) { phys.step(handlers); st.afterStep(phys.FIXED_DT); if (i % 4 === 3) { st.syncMeshes(1); st.maintain(phys.FIXED_DT * 4); } }
      return { confined: sv.confined, Pqs: sv.Pqs, held: sv.held, iGas: sv.iGas, walls: 1 - wallVol().up / w0, site: st.demolitionFraction() };
    };
    const open = run(room(false, false)), vented = run(room(true, true)), closed = run(room(true, false));
    const line = (o: Out) => `confined ${o.confined} Pqs ${(o.Pqs / 1e3).toFixed(0)} kPa held ${o.held.toFixed(2)} iGas ${o.iGas.toFixed(0)} Pa·s walls down ${(100 * o.walls).toFixed(0)} % site ${(100 * o.site).toFixed(0)} %`;
    const all = `\nopen   ${line(open)}\nvented ${line(vented)}\nclosed ${line(closed)}`;

    assert.equal(open.confined, false, `nothing over the walls is not a room${all}`);
    assert.ok(closed.confined && vented.confined, `a roofed room is confined, its ceiling judged before the crater${all}`);
    /* UFC 3-340-02 Fig. 2-152 at W/V = 2.5 / 108 kg/m³, and the afterburn energy bound (γ − 1)·3.22·4.184 MJ/kg·W/V = 125 kPa */
    assert.ok(closed.Pqs > 80e3 && closed.Pqs < 170e3, `closed-room gas pressure ${(closed.Pqs / 1e3).toFixed(0)} kPa${all}`);
    assert.ok(vented.held < closed.held && vented.iGas < 0.2 * closed.iGas, `a 9 m² opening vents the blow-down${all}`);
    assert.ok(closed.walls > 0.8 && closed.site > 0.7, `the closed room blows out${all}`);
    assert.ok(closed.site > vented.site + 0.3, `closed > vented${all}`);
    assert.ok(vented.walls > open.walls + 0.15, `vented > open${all}`);
    assert.ok(open.walls < 0.2, `in the open 2.5 kg 3 m off 9 in brick only scars it${all}`);

    /* two charges fired 70 ms apart in one closed room share its air: the second finds the first's gas still there */
    const fields = await L('/src/sim/fields/index.ts');
    st.clearStructures();
    phys.createWorld();
    st.buildBlueprint({ pieces: [] });
    st.spawnPieces(room(true, false));
    for (let i = 0; i < 30; i++) { phys.step(handlers); st.afterStep(phys.FIXED_DT); }
    const one = fields.survey([-1.5, 1.0, 0], 3.1 * Math.cbrt(KG), 60e3 * KG, 60e3 * KG, false, 1.0);
    const two = fields.survey([1.5, 1.0, 0], 3.1 * Math.cbrt(KG), 60e3 * KG, 60e3 * KG, false, 1.07);
    const late = fields.survey([1.5, 1.0, 0], 3.1 * Math.cbrt(KG), 60e3 * KG, 60e3 * KG, false, 3.5);
    assert.ok(two.Pqs > 1.3 * one.Pqs && late.Pqs < 1.05 * one.Pqs,
      `together ${(one.Pqs / 1e3).toFixed(0)} then ${(two.Pqs / 1e3).toFixed(0)} kPa; 2.5 s later ${(late.Pqs / 1e3).toFixed(0)} kPa`);

    /* six charges in the same instant load the room as one of six times the mass: the last sees the peak of all six,
       and their gas impulses add up to that one charge's, not more */
    const blast = await L('/src/sim/fields/blast.ts');
    fields.clearFields();
    let sumI = 0, last = one;
    for (let k = 0; k < 6; k++) { last = fields.survey([-1.5 + 0.6 * k, 1.0, 0], 3.1 * Math.cbrt(KG), 60e3 * KG, 60e3 * KG, false, 5.0); sumI += last.iGas0; }
    const P6 = blast.gasPressure(6 * KG, last.V), I6 = blast.gasImpulse(P6, last.V, last.Av);
    assert.ok(Math.abs(last.Pqs / P6 - 1) < 0.02 && Math.abs(sumI / I6 - 1) < 0.02,
      `six at once: last peak ${(last.Pqs / 1e3).toFixed(0)} kPa vs ${(P6 / 1e3).toFixed(0)}; impulses ${sumI.toFixed(0)} vs ${I6.toFixed(0)} Pa·s`);

    /* a charge planted on the street face of the wall is in the open; on the room face it is in the room */
    fields.clearFields();
    const wallZ = W / 2 + t / 2;
    const out = fields.survey([0.75, 1.2, wallZ + t / 2 + 0.07], 3.1 * Math.cbrt(KG), 60e3 * KG, 60e3 * KG, false, 7.0, [0, 0, 1]);
    const inn = fields.survey([0.75, 1.2, wallZ - t / 2 - 0.07], 3.1 * Math.cbrt(KG), 60e3 * KG, 60e3 * KG, false, 7.0, [0, 0, -1]);
    assert.ok(!out.confined && inn.confined, `outside face confined ${out.confined}, inside face confined ${inn.confined}`);
  } finally {
    await server.close();
  }
});
