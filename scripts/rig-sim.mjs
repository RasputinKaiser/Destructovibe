// Headless rigging harness: rope pull-downs and line physics through the tools' own line core (src/game/tools/lines.ts),
// stepped the way main.ts steps them (physics step → structure afterStep, which steps the vehicles → rigAfterStep).
// Usage: node scripts/rig-sim.mjs <scenario> [args]
//   pulldown [prefab=chimney] [lines=3] [kind=wire16] [steps=900]  lines from the top third of a structure's south face
//            to a lorry 2 × its height away (NSW demolition code), the lorry reversing away at 60 % throttle
//   hang     one member of known mass hung from the ground on each line kind: tension should read m·g
//   snatch   a nylon kinetic rope between a van and a lorry: the lorry's run-up stored in the stretch and handed on
// env: PERF=1 adds CPU ms per step for the physics step, the structure/vehicle afterStep and the rigging step.
// Prints per-second lines and a final `RESULT {...}` JSON line.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(ROOT, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
globalThis.window ??= globalThis;
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 16);

const [scenario = 'pulldown', ...args] = process.argv.slice(2);
const PERF = process.env.PERF === '1';
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const r1 = (x) => Math.round(x * 10) / 10;
try {
  const L = (p) => server.ssrLoadModule(p);
  const THREE = await L('three');
  const phys = await L('/src/physics/physics.ts');
  const st = await L('/src/destruction/structure.ts');
  const { initFx } = await L('/src/render/fx.ts');
  const V = await L('/src/vehicles/vehicle.ts');
  const R = await L('/src/game/tools/lines.ts');
  const { PREFABS } = await L('/src/levels/prefabs.ts');
  const { stand } = await L('/src/levels/maps/ground.ts');
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
  initFx(scene, cam);
  await phys.initPhysics();
  st.initStructures(scene);
  phys.createWorld();
  st.setDebrisLimit?.(1400);
  st.buildBlueprint({ pieces: [], spawn: { pos: [0, 0, 0], yaw: 0 } });
  R.initRigging(scene);
  const handlers = { hit: (a, b, p, n, s) => st.onHit(a, b, p, n, s), begin() {}, jointBroken: (id) => st.onJointBroken(id) };
  const spawn = (id, x, z, q = 0) => st.spawnPieces(stand(PREFABS.find((p) => p.id === id).build(x, z, q), 0));
  const t = { phys: 0, after: 0, rig: 0, n: 0 };
  const step = () => {
    const a = PERF ? cpu() : 0;
    phys.step(handlers);
    const b = PERF ? cpu() : 0;
    st.afterStep(phys.FIXED_DT);
    const c = PERF ? cpu() : 0;
    R.rigAfterStep(phys.FIXED_DT);
    if (PERF) { t.phys += b - a; t.after += c - b; t.rig += cpu() - c; t.n++; }
  };
  const perStep = () => ({ physCpu: +(t.phys / t.n).toFixed(3), afterCpu: +(t.after / t.n).toFixed(3), rigCpu: +(t.rig / t.n).toFixed(4) });
  const resetT = () => { t.phys = t.after = t.rig = t.n = 0; };
  const gone = [];
  const watch = (Ln, name) => { Ln.onGone = (why) => gone.push({ name, why, t: r1(clock), peak: Math.round(Ln.peak / 1000) }); };
  let clock = 0;
  const run = (n, each) => { for (let i = 0; i < n; i++) { step(); clock += phys.FIXED_DT; each?.(i); } };

  if (scenario === 'pulldown') {
    const [prefab = 'chimney', nLines = '3', kind = 'wire16', steps = '900'] = args;
    spawn(prefab, 0, 0);
    const mine = [...st.live].filter((p) => !p.dead);
    let H = 0, x0 = 1e9, x1 = -1e9, zMax = -1e9;
    for (const p of mine) { H = Math.max(H, p.curPos[1]); x0 = Math.min(x0, p.curPos[0]); x1 = Math.max(x1, p.curPos[0]); zMax = Math.max(zMax, p.curPos[2]); }
    run(120);
    // NOTCH=r: a felling mouth blown out of the base on the pull side (a charge of that radius), the way a stack is
    // pre-weakened so it hinges toward the pull
    if (process.env.NOTCH) { st.explode([0, 0.9, zMax], +process.env.NOTCH, 60e3, 2000); run(180); }
    // the lorry 2 × H off the south face, nose to the structure, so reversing pulls
    const dist = Math.max(8, 2 * H);
    const PULLER = process.env.PULLER ?? 'lorry';
    spawn(PULLER === 'dumptruck' ? 'dump-truck' : PULLER, 0, zMax + dist + 4, 1);
    run(60);
    const lorry = V.vehicles.find((v) => v.model === PULLER);
    const hitch = V.vehiclePoint(lorry, -Math.max(...lorry.wheels.map((w) => Math.abs(w.x))) - 0.5, 0.9, 0);
    // rig points: the top third of the south face, spread across its width
    const lines = [];
    const k = +nLines;
    for (let i = 0; i < k; i++) {
      const x = k === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * (i + 0.5)) / k;
      const y = H * 0.72;
      const hit = phys.raycast([x, y, zMax + 6], [0, 0, -20], phys.ALL & ~(phys.CAT.player | phys.CAT.projectile));
      const piece = hit && st.pieceOf(hit.entity);
      if (!piece) continue;
      const a = R.anchorOn(lorry.chassis, hitch), b = R.anchorOn(piece, hit.point);
      const Ln = R.makeLine(kind, 'tether', a, b, Math.hypot(hitch[0] - hit.point[0], hitch[1] - hit.point[1], hitch[2] - hit.point[2]) + 0.2);
      watch(Ln, `line${i}`);
      lines.push(Ln);
    }
    const h0 = H;
    const topNow = () => { let m = 0; for (const p of st.live) if (!p.dead && !V.vehicleOf(p) && p.curPos[2] < zMax + 3) m = Math.max(m, p.curPos[1]); return m; };
    V.setDriven(lorry);
    lorry.gear = -1;
    lorry.controls.throttle = +(process.env.THROTTLE ?? 0.6);
    resetT();
    const out = [];
    let fell = null, peak = 0;
    const s0 = st.stats();
    run(+steps, (i) => {
      for (const Ln of lines) if (!Ln.dead) peak = Math.max(peak, Ln.tension);
      const top = topNow();
      if (fell === null && top < h0 * 0.5) fell = r1(clock - 3);
      if ((i + 1) % 60 === 0) out.push(`t=${((i + 1) / 60).toFixed(0)}s lorry z ${lorry.chassis.curPos[2].toFixed(1)} v ${lorry.speed.toFixed(2)} m/s | lines ${lines.map((Ln) => (Ln.dead ? 'x' : Math.round(Ln.tension / 1000))).join('/')} kN | top ${top.toFixed(1)} m of ${h0.toFixed(1)} | demo ${(100 * st.demolitionFraction()).toFixed(1)}%`);
    });
    console.log(out.join('\n'));
    console.log('RESULT ' + JSON.stringify({ scenario, prefab, kind, puller: PULLER, lines: lines.length, height: r1(h0), pullerAt: r1(dist), fellAtS: fell, peakKN: Math.round(peak / 1000), parted: gone, weldsLost: s0.welds - st.stats().welds, demolitionPct: r1(100 * st.demolitionFraction()), ...(PERF ? perStep() : {}) }));
  } else if (scenario === 'hang') {
    // a 1 t steel block hung 3 m under a ground anchor on each line: the reading should be m·g = 9.8 kN
    const res = {};
    for (const [i, kind] of ['wire16', 'nylon', 'chain13', 'dyneema'].entries()) {
      const x = i * 6;
      st.spawnPieces([{ mat: 'steel', size: [0.5, 0.5, 0.5], pos: [x, 6, 0], noWeld: true }]);
    }
    const blocks = [...st.live].filter((p) => !p.dead);
    const lines = blocks.map((p, i) => R.makeLine(['wire16', 'nylon', 'chain13', 'dyneema'][i], 'tether', R.anchorOn(null, [p.curPos[0], 9, 0]), R.anchorOn(p, [p.curPos[0], p.curPos[1] + 0.25, 0]), 2.75));
    run(240);
    lines.forEach((Ln, i) => { res[Ln.kind] = { massKg: Math.round(blocks[i].mass), tensionN: Math.round(Ln.tension), mgN: Math.round(blocks[i].mass * 9.81), stretchMm: Math.round((R.currentLength(Ln) - Ln.rest) * 1000) }; });
    console.log('RESULT ' + JSON.stringify({ scenario, res }));
  } else if (scenario === 'snatch') {
    spawn('saloon', 0, 0, 1);
    run(30);
    spawn('lorry', 0, 14, 1);
    run(90);
    const car = V.vehicles.find((v) => v.model === 'car'), lorry = V.vehicles.find((v) => v.model === 'lorry');
    if (!car || !lorry) throw new Error('vehicles: ' + V.vehicles.map((v) => v.model).join(','));
    const pa = V.vehiclePoint(lorry, -4, 0.8, 0), pb = V.vehiclePoint(car, 2.2, 0.5, 0);
    const d = Math.hypot(pa[0] - pb[0], pa[2] - pb[2]);
    const Ln = R.makeLine(args[0] ?? 'nylon', 'tether', R.anchorOn(lorry.chassis, pa), R.anchorOn(car.chassis, pb), d + 1.5);
    watch(Ln, 'rope');
    V.setDriven(lorry);
    lorry.gear = -1;
    lorry.controls.throttle = 1;
    car.controls.hand = true;
    let peak = 0, carV = 0, stretch = 0, U = 0;
    const out = [];
    run(420, (i) => {
      if (!Ln.dead) { peak = Math.max(peak, Ln.tension); const s = R.currentLength(Ln) - Ln.rest; if (s > stretch) { stretch = s; U = R.strainEnergy(Ln); } }
      carV = Math.max(carV, Math.abs(car.speed));
      if (i % 30 === 29) out.push(`t=${r1((i + 1) / 60)}s lorry ${lorry.speed.toFixed(2)} car ${car.speed.toFixed(2)} m/s | rope ${Ln.dead ? 'x' : `${Math.round(Ln.tension / 1000)} kN, stretch ${Math.round((R.currentLength(Ln) - Ln.rest) * 100)} cm`}`);
    });
    console.log(out.join('\n'));
    console.log('RESULT ' + JSON.stringify({ scenario, kind: Ln.kind, peakKN: Math.round(peak / 1000), maxStretchM: +stretch.toFixed(2), storedKJ: r1(U / 1000), carPeakV: +carV.toFixed(2), parted: gone }));
  } else throw new Error('unknown scenario ' + scenario);
} catch (e) { console.error('HARNESS ERROR', e?.stack ?? e); process.exitCode = 2; }
finally { await server.close(); }
