// Headless settle/step-cost harness. Usage: node scripts/sim.mjs <mapKey> [steps] [boom x,y,z,r]
// mapKey: S (Clearance), H (Heritage), D (Downtown), R (Railway), 1..8 contracts, P:<prefabId>, B:<buildingOrVariantId>
// env: CANON=0 spawn pieces in the given order (not canonical); PERM=<seed> seeded shuffle of a prefab's/building's
//      pieces; TERRAIN=0 skip the soil step (by default the soil steps with the live pieces every step, as the game's
//      main loop does: falling pieces dent the ground, the buried sweep runs at 10 Hz); WIN=<steps> per-window report
//      length; VIEWER=x,y,z the player/camera position (services, soft bodies and detail LOD are told it every frame,
//      as main.ts does; VPART=svc,soft,detail tells only those parts); SPF=<n> physics steps per drawn frame (default
//      1; the renderer's syncMeshes/maintain run once a frame, as in the game)
// The run goes through the same per-step and per-frame calls as main.ts, so what it reports is what the player sees.
// Neither the viewer nor the frame rate may change the outcome (tests/viewer-independence.test.ts): a run with no
// VIEWER is the player's collapse wherever the player stands.
// Last stdout line: RESULT {"weldsLost":n,"runaways":n,"awakeAtEnd":n,"awakeMachine":n,"awakeOther":n,"fingerprint":"…"}
// (fingerprint: every live body's position to 1 mm, so two runs that should match can be compared). Machines work all
// the time, so a settled map is not all asleep: awakeMachine is the awake bodies in a machine's own island (its parts,
// whatever they are jointed to and whatever awake body touches them: the pallet on the forks, the cartons on a belt),
// awakeOther everything else, which a settled map keeps at 0. The JSON's `machines` names them per machine group.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(ROOT, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const key = process.argv[2] ?? 'S';
const STEPS = +(process.argv[3] ?? 600);
const BOOM = process.argv[4]?.split(',').map(Number);
const VIEWER = process.env.VIEWER ? process.env.VIEWER.split(',').map(Number) : null;
const SPF = Math.max(1, +(process.env.SPF ?? 1));
globalThis.window ??= globalThis;
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 16);

const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const L = (p) => server.ssrLoadModule(p);
  const THREE = await L('three');
  const phys = await L('/src/physics/physics.ts');
  const st = await L('/src/destruction/structure.ts');
  const { initFx } = await L('/src/render/fx.ts');
  const svc = await L('/src/destruction/services.ts');
  const det = await L('/src/destruction/detail.ts');
  const soft = await L('/src/sim/soft.ts');
  const fields = await L('/src/sim/fields/index.ts');
  const an = await L('/src/destruction/analysis.ts');
  const ter = process.env.TERRAIN !== '0' ? await L('/src/terrain/terrain.ts') : null;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
  initFx(scene, cam);
  await phys.initPhysics();
  st.initStructures(scene);
  const prefabId = key.startsWith('P:') ? key.slice(2) : null;
  const buildingId = key.startsWith('B:') ? key.slice(2) : null;
  // contracts (and through them the building registry) load only for map keys, so B: builds just its own package
  const C = prefabId || buildingId ? null : await L('/src/levels/contracts.ts');
  const c = prefabId ? { name: 'prefab ' + prefabId, build: () => ({ pieces: [] }) } : buildingId ? { name: 'building ' + buildingId, build: () => ({ pieces: [] }) } : key === 'S' ? C.SANDBOX : key === 'H' ? C.SHOWCASE : key === 'D' ? C.DOWNTOWN : key === 'R' ? C.RAILWAY : C.CONTRACTS[+key - 1];
  if (!c) throw new Error('no map ' + key);
  phys.createWorld();
  if (process.env.CANON === '0' && st.spawnOrder) st.spawnOrder.canonical = false;
  st.setDebrisLimit?.(1400);
  const bp = c.build();
  const t0 = performance.now();
  const perm = (specs) => {
    if (!process.env.PERM) return specs;
    let s = (+process.env.PERM * 2654435761) >>> 0 || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const out = specs.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  };
  st.buildBlueprint(bp);
  if (prefabId) {
    const { PREFABS } = await L('/src/levels/prefabs.ts');
    const { stand } = await L('/src/levels/maps/ground.ts');
    const pf = PREFABS.find((p) => p.id === prefabId);
    const specs = perm(stand(pf.build(0, 0, 0), 0));
    bp.pieces = specs;
    st.spawnPieces(specs);
  }
  if (buildingId) {
    const { stand } = await L('/src/levels/maps/ground.ts');
    const { assemble } = await L('/src/buildings/assemble.ts');
    const specs = perm(stand(assemble(...await resolveBuilding(L, buildingId)), 0));
    bp.pieces = specs;
    st.spawnPieces(specs);
  }
  const buildMs = performance.now() - t0;
  const handlers = { hit: (a, b, p, n, s) => st.onHit(a, b, p, n, s), begin() {}, jointBroken: (id) => st.onJointBroken(id) };
  const pick = (s) => ({ pieces: s.pieces, welds: s.welds, snaps: s.snaps, eventSnaps: s.eventSnaps, fractures: s.fractures, cracks: s.cracks, buckles: s.buckles, yields: s.yields, creepFails: s.creepFails, fatigue: s.fatigue, crushes: s.crushes, slips: s.slips, delams: s.delams });
  const s0 = st.stats();
  let physT = 0, afterT = 0, maxStep = 0, softSum = 0;
  const win = { phys: 0, after: 0, soft: 0, n: 0 };
  const perWin = [];
  const awake = () => { try { return phys.b3.b3World_GetAwakeBodyCount(phys.world); } catch { return -1; } };
  const cost0 = { svc: svc.svcCost.ms, mech: svc.mechCost.ms, field: fields.fieldCost.ms, joint: st.jointCost.ms, an: an.stats.ms };
  for (let i = 0; i < STEPS; i++) {
    if (BOOM && i === 60) st.explode([BOOM[0], BOOM[1], BOOM[2]], BOOM[3] ?? 5, 90e3, 3200);
    const a = performance.now();
    phys.step(handlers);
    const b = performance.now();
    st.afterStep(phys.FIXED_DT);
    ter?.terrainStep(st.live);
    const d = performance.now();
    if ((i + 1) % SPF === 0) {
      if (VIEWER) {
        const vp = process.env.VPART ?? 'svc,soft,detail';
        if (vp.includes('svc')) svc.setServiceViewer(VIEWER);
        if (vp.includes('detail')) det.setDetailCamera(VIEWER);
        if (vp.includes('soft')) soft.setSoftViewer(VIEWER);
      }
      st.syncMeshes(1);
      st.maintain(phys.FIXED_DT * SPF);
    }
    physT += b - a; afterT += d - b; maxStep = Math.max(maxStep, d - a);
    softSum += soft.softPerf.ms;
    win.max = Math.max(win.max ?? 0, d - a); win.phys += b - a; win.after += d - b; win.soft += soft.softPerf.ms; win.n++;
    if ((i + 1) % (process.env.WIN ? +process.env.WIN : 120) === 0) {
      const s = st.stats();
      perWin.push(`t=${((i + 1) / 60).toFixed(0)}s phys ${(win.phys / win.n).toFixed(2)} after ${(win.after / win.n).toFixed(2)} soft ${(win.soft / win.n).toFixed(2)} ms | welds ${s.welds} pieces ${s.pieces} demo ${(100 * st.demolitionFraction()).toFixed(2)}% awakeBodies ${awake()} softAwake ${soft.softPerf.awake} snaps ${s.snaps} evSnaps ${s.eventSnaps} frac ${s.fractures} cracks ${s.cracks} yields ${s.yields} hangs ${s.hangs ?? 0} relieved ${s.relieved ?? 0} frozen ${s.frozen ?? 0} anPending ${an.stats.pending} anMax ${an.stats.maxMs.toFixed(1)} maxStep ${win.max.toFixed(1)}`); win.max = 0;
      win.phys = win.after = win.soft = win.n = 0;
    }
  }
  const s1 = st.stats();
  const mi = machineIslands();
  const kinds = {};
  for (const b of soft.softBodies) { if (b.dead) continue; const k = b.kind + (b.awake ? ':awake' : ':asleep'); kinds[k] = (kinds[k] ?? 0) + 1; }
  const per = (x) => +(x / STEPS).toFixed(3);
  console.log(JSON.stringify({ map: c.name, bpPieces: bp.pieces.length, buildMs: Math.round(buildMs), start: pick(s0), end: pick(s1),
    weldsLostPct: +(100 * (1 - s1.welds / Math.max(1, s0.welds))).toFixed(2), demolitionPct: +(100 * st.demolitionFraction()).toFixed(3),
    avgPhysMs: per(physT), avgAfterMs: per(afterT), avgSoftMs: per(softSum), maxStepMs: +maxStep.toFixed(1),
    breakdownMsPerStep: { svc: per(svc.svcCost.ms - cost0.svc), mech: per(svc.mechCost.ms - cost0.mech), fields: per(fields.fieldCost.ms - cost0.field), joints: per(st.jointCost.ms - cost0.joint), analysis: per(an.stats.ms - cost0.an) },
    machines: mi.groups, runaways: phys.runaways, pumped: phys.pumped, designIssues: st.designIssues.length, softKinds: kinds, perWin }, null, 1));
  const fp = createHash('sha1');
  for (const p of [...st.live].filter((p) => !p.dead).sort((a, b) => a.id - b.id)) fp.update(`${p.id}:${p.curPos.map((v) => Math.round(v * 1000)).join(',')};`);
  console.log('RESULT ' + JSON.stringify({ weldsLost: Math.max(0, s0.welds - s1.welds), runaways: phys.runaways, awakeAtEnd: awake(), awakeMachine: mi.bodies, awakeOther: awake() - mi.bodies, fingerprint: fp.digest('hex').slice(0, 16) }));

  /* The awake bodies a working machine keeps awake, per machine group: a flood from every awake machine axis over the
     joints (its host chain, ropes, welds of a carried frame) and over touching awake bodies (Box3D wakes and sleeps a
     whole island of jointed or touching bodies together). */
  function machineIslands() {
    const b3 = phys.b3, byBody = new Map(), byId = new Map();
    for (const p of st.live) if (!p.dead) { byBody.set(p.body.index1, p); byId.set(p.id, p); }
    const isAwake = (p) => !p.dead && b3.b3Body_IsAwake(p.body);
    const cand = [...byBody.values()].filter(isAwake);
    const seen = new Set(), groups = {};
    const A = [0, 0, 0, 0, 0, 0], B = [0, 0, 0, 0, 0, 0], M = 0.05;
    const axes = svc.mechSummary();
    for (const g of [...new Set(axes.map((m) => m.group ?? '?'))].sort()) {
      const q = [];
      for (const m of axes) { const p = byId.get(m.id); if ((m.group ?? '?') === g && p && isAwake(p) && !seen.has(p)) { seen.add(p); q.push(p); } }
      for (let i = 0; i < q.length; i++) {
        const p = q[i], add = (o) => { if (o && !seen.has(o) && isAwake(o)) { seen.add(o); q.push(o); } };
        const js = b3.b3Body_GetJoints(p.body);
        for (let k = 0; k < js.size(); k++) { const j = js.get(k); add(byBody.get(b3.b3Joint_GetBodyA(j).index1)); add(byBody.get(b3.b3Joint_GetBodyB(j).index1)); }
        js.delete?.();
        b3.b3Body_ComputeAABB(A, p.body);
        for (const o of cand) {
          if (seen.has(o)) continue;
          b3.b3Body_ComputeAABB(B, o.body);
          if (A[0] - M < B[3] && B[0] - M < A[3] && A[1] - M < B[4] && B[1] - M < A[4] && A[2] - M < B[5] && B[2] - M < A[5]) add(o);
        }
      }
      const mine = axes.filter((m) => (m.group ?? '?') === g);
      if (q.length || mine.some((m) => m.running)) groups[g] = { awake: q.length, axes: mine.length, running: mine.filter((m) => m.running).length };
    }
    return { bodies: seen.size, groups };
  }
} catch (e) { console.error('HARNESS ERROR', e?.stack ?? e); process.exitCode = 2; }
finally { await server.close(); }

/* [def, placement] for a building or variant id: its own package's def.ts when the id is a folder, else each package def
   loaded on its own (a broken package is skipped, not fatal) until one owns the variant. */
async function resolveBuilding(L, id) {
  const { existsSync, readdirSync } = await import('node:fs');
  const dir = join(ROOT, 'src', 'buildings');
  const at = { x: 0, z: 0 };
  if (existsSync(join(dir, id, 'def.ts'))) return [(await L(`/src/buildings/${id}/def.ts`)).default, at];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (!f.isDirectory() || f.name.startsWith('_') || !existsSync(join(dir, f.name, 'def.ts'))) continue;
    let d;
    try { d = (await L(`/src/buildings/${f.name}/def.ts`)).default; } catch (e) { console.error(`skipping broken package ${f.name}: ${e?.message ?? e}`); continue; }
    const v = d?.variants?.find((x) => x.id === id);
    if (v) return [d, { ...at, ...v.params }];
  }
  throw new Error(`unknown building '${id}'`);
}
