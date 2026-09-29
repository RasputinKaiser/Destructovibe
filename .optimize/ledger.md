# /optimize ledger — Destructovibe

Machine: Apple M1, 16 GB, node v22.22.3. Shared with other agents: load average 12-32 during run 1, so wall times
swing 2-3x (validate:levels 135 s quiet vs 396 s loaded). Runtime probes also record process-CPU ms per step
(`*_cpu`), which is steadier under load. Compare runs back to back only. Exchange rate (tokens): 10k ≈ 60 s.

Probes: `.optimize/probes.sh` (devloop wall times, measure.py), `.optimize/runtime.py` (sim.mjs PERF=1 ms/step,
fingerprints), `.optimize/render-probe.mjs` (headless system Chrome via Playwright, Downtown High/Auto).

## Run 1 — 2026-09-29 (runtime + devloop, branch perf-1 from main 0005557, worktree, heuristic-chars/4, 10k tok ≈ 60 s)

Baseline (0005557 + sim.mjs PERF output mode; fingerprints identical to plain sim.mjs):

| probe | value |
|---|---|
| types (tsc --noEmit) | 18.7 s (loaded; 17.7 s quiet) |
| test (npm test) | 74.0 s (loaded; 43.9 s quiet) |
| build | 46.4 s (loaded; 12.8 s quiet) |
| check-building cottage-row | 15.9 s (loaded; 5.0 s quiet) |
| validate:levels | 395.8 s (loaded; 135.3 s quiet) |
| idle_S after-step | 0.84 ms (cpu 0.84), 0 awake, fp ff6aa73781e99dcc |
| idle_D after-step | 3.57 ms (cpu 2.52; soft 1.73, ter 1.03), 0 awake, fp 57dce26087cace8c |
| tower_D collapse t1-10 s | phys 45.0 + after 27.3 = 76.0 ms/step (analysis 6.4, fields 2.4, svc 1.4) |
| tower_D aftermath t15-20 s | phys 90.0 + after 22.2 = 121.9 ms/step, awake 3771 @16 s, 4825 @20 s (collapse still running: demo 57 %→64 %) |
| terrace_S collapse t1-10 s | phys 40.6 + after 20.2 = 64.4 ms/step (fields 4.7), +2079 pieces |
| terrace_S aftermath t15-20 s | phys 28.7 + after 11.1 = 43.0 ms/step, awake 1762 @16 s, 1743 @20 s |
| render rest (Downtown High/Auto, M1 Metal) | 28.4 fps, p50 33.3 ms, p95 66.7 ms, 176 calls, 1.50 M tris, phys 3.3 ms, render 14.2 ms |
| render +5 s after tower blast | 5.0 fps, p50 166.7 ms, 151 calls, 1.23 M tris, phys 134.3 ms (6 threads), render 17.0 ms |
