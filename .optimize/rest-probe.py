"""Resting-rubble census (/optimize run 4). Builds a sim.mjs copy that prints, every 60 steps, a REST row: awake bodies,
awake loose demolished pieces (awakeDyn), how many of those moved < 1 cm in the last second (rest1, by volume bin
<0.012/<0.05/<0.3/>=0.3 m^3) or for >= 3 s running (rest3), frozen/thawed rubble (if the tree exports frozenRubble /
thawedRubble), the fracture queue length (fq), fractures so far, live pieces and cumulative phys ms; then any
globalThis.__frz debug counters. Run 4 used it to find what keeps settled rubble in the solve.
  python3 .optimize/rest-probe.py <tree> <out.mjs>
  cd <tree> && DV_ROOT=$PWD node <out.mjs> D 1200 -60,1.5,-55,5"""
import sys
src = open(sys.argv[1] + '/scripts/sim.mjs').read()
src = src.replace("const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');", "const ROOT = process.env.DV_ROOT;")
hook = r'''
    if ((i + 1) % 60 === 0) { const B = phys.b3; const row = { t: (i + 1) / 60, awake: 0, awakeDyn: 0, rest1: 0, rest1v: 0, rest3: 0, big: 0, frozen: st.frozenRubble?.() ?? 0, thawed: st.thawedRubble?.() ?? 0, fq: st.stats().queued, fracs: st.stats().fractures, pieces: st.stats().pieces, phys: +(physT).toFixed(0), byVol: [0,0,0,0] };
      for (const p of st.live) { if (p.dead || !p.body) continue; if (B.b3Body_GetType(p.body) !== B.b3BodyType.b3_dynamicBody) continue;
        const prev = REST.get(p); const cur = [...p.curPos];
        if (B.b3Body_IsAwake(p.body)) { row.awake++;
          const loose = !p.welds.length && !p.rebars.length && !p.ropes.length && !p.mechs && p.demolished;
          if (loose) { row.awakeDyn++;
            const d = prev ? Math.hypot(cur[0]-prev.pos[0], cur[1]-prev.pos[1], cur[2]-prev.pos[2]) : 9;
            if (d < 0.01) { row.rest1++; row.rest1v += p.volume; const k = p.volume < 0.012 ? 0 : p.volume < 0.05 ? 1 : p.volume < 0.3 ? 2 : 3; row.byVol[k]++;
              if (prev && prev.still >= 2) row.rest3++; } } }
        const d2 = prev ? Math.hypot(cur[0]-prev.pos[0], cur[1]-prev.pos[1], cur[2]-prev.pos[2]) : 9;
        REST.set(p, { pos: cur, still: d2 < 0.01 ? (prev?.still ?? 0) + 1 : 0 }); }
      row.rest1v = +row.rest1v.toFixed(2); console.log('REST ' + JSON.stringify(row) + ' ' + JSON.stringify(globalThis.__frz ?? {})); }
'''
src = src.replace("    ter?.terrainStep(st.live);\n", "    ter?.terrainStep(st.live);\n" + hook, 1)
src = src.replace("  for (let i = 0; i < STEPS; i++) {", "  const REST = new Map();\n  for (let i = 0; i < STEPS; i++) {", 1)
open(sys.argv[2], 'w').write(src)
print('ok', 'REST ' in src)
