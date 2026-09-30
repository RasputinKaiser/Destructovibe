"""Late-rubble motion probe (/optimize run 4). Builds a copy of <tree>/scripts/sim.mjs that, from step ROLL0 (default
960 = t 16 s, ~15 s after a step-60 blast) to the end, accumulates each loose piece's path length and net displacement
and its rolling signature (mean |v| / (|w| r_eff), ~1 when rolling without slip), then prints ROLLERS: the TOP (default 30)
demolished, unwelded, non-machine pieces by late path with volume, material, depth, cylinder flag, rolling resistance, sleep threshold and final y.
  python3 .optimize/rollers.py <tree> <out.mjs>
  cd <tree> && DV_ROOT=$PWD [ROLL0=960] [TOP=30] node <out.mjs> S 1800 -60.35,1.2,-8,5
Run from the tree's own directory (vite resolves its config there)."""
import sys
src = open(sys.argv[1] + '/scripts/sim.mjs').read()
src = src.replace("const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');", "const ROOT = process.env.DV_ROOT;")
hook = r'''
    if (i >= ROLL0) { const B = phys.b3, v = [0, 0, 0], w = [0, 0, 0];
      for (const p of st.live) { if (p.dead || !p.body || p.welds.length || p.mechs?.length || p.root?.spec?.mech || p.root?.spec?.vehicle || p.root?.spec?.wheel || !p.demolished) continue;
        let r = ROLL.get(p); if (!r) ROLL.set(p, r = { p0: [...p.curPos], last: [...p.curPos], path: 0, vs: 0, ws: 0, n: 0, wmax: 0 });
        const d = Math.hypot(p.curPos[0] - r.last[0], p.curPos[1] - r.last[1], p.curPos[2] - r.last[2]);
        r.path += d; r.last = [...p.curPos];
        if (d > 1e-4 && B.b3Body_GetType(p.body) === B.b3BodyType.b3_dynamicBody) { B.b3Body_GetLinearVelocity(v, p.body); B.b3Body_GetAngularVelocity(w, p.body);
          const lw = Math.hypot(...w); r.vs += Math.hypot(...v); r.ws += lw * Math.cbrt(p.volume) * 0.62; r.n++; r.wmax = Math.max(r.wmax, lw); } } }
'''
src = src.replace("    ter?.terrainStep(st.live);\n", "    ter?.terrainStep(st.live);\n" + hook, 1)
src = src.replace("  for (let i = 0; i < STEPS; i++) {", "  const ROLL0 = +(process.env.ROLL0 ?? 960), ROLL = new Map();\n  for (let i = 0; i < STEPS; i++) {", 1)
tail = r'''
  { const B = phys.b3;
    const rows = [...ROLL.entries()].filter(([p]) => !p.dead).sort((a, b) => b[1].path - a[1].path).slice(0, +(process.env.TOP ?? 30)).map(([p, r]) => {
      let rr = null; try { rr = +B.b3Shape_GetRollingResistance?.(p.shape)?.toFixed?.(3); } catch {}
      return { id: p.id, mat: p.mat, style: null, vol: +p.volume.toFixed(4), depth: p.depth, cyl: !!p.cyl, parts: p.parts ? p.parts.length : 1, dem: !!p.demolished,
        path: +r.path.toFixed(2), net: +Math.hypot(p.curPos[0] - r.p0[0], p.curPos[1] - r.p0[1], p.curPos[2] - r.p0[2]).toFixed(2), roll: r.ws ? +(r.vs / r.ws).toFixed(2) : null,
        wmax: +r.wmax.toFixed(1), rr, thr: +B.b3Body_GetSleepThreshold(p.body).toFixed(2), awake: B.b3Body_IsAwake(p.body), y: +p.curPos[1].toFixed(2), x: +p.curPos[0].toFixed(1), z: +p.curPos[2].toFixed(1) }; });
    const all = [...ROLL.values()]; const tot = all.reduce((s, r) => s + r.path, 0);
    console.log('ROLLSUM ' + JSON.stringify({ tracked: all.length, totalPath: +tot.toFixed(1), over1m: all.filter(r => r.path > 1).length, over3m: all.filter(r => r.path > 3).length }));
    console.log('ROLLERS ' + JSON.stringify(rows)); }
'''
src = src.replace("  const s1 = st.stats();", tail + "  const s1 = st.stats();", 1)
open(sys.argv[2], 'w').write(src)
print('ok', 'ROLLERS' in src, 'ROLL0' in src, 'b3Body_GetType(p.body)' in src)
