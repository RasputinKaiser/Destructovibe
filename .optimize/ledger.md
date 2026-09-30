# /optimize ledger — Destructovibe

Machine: Apple M1, 16 GB, node v22.22.3. Shared with other agents: load average 12-32 during run 1, so wall times
swing 2-3x (validate:levels 135 s quiet vs 396 s loaded). Runtime probes also record process-CPU ms per step
(`*_cpu`), but CPU time is not load-proof either: the M1's 4 efficiency cores roughly double CPU time for the same
work, and under load the scheduler puts work there. Use `buildMs` (code no fix touched) as the load control: when it
moves, the timing comparison is confounded. Deterministic metrics (fingerprints, awake counts, settle_s, draw calls,
triangles) are the load-proof ones. Compare runs back to back only. Exchange rate (tokens): 10k ≈ 60 s.

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

Baseline numbers above were taken under load average 12-32. The same probes on the same code later, at load ~5-13:
types 5.3 s, test 21.6 s, build 6.0 s, checkbld 3.3 s (final-devloop.json). Never compare against the loaded baseline.

Applied (each verified back to back, output or fingerprint checks listed):
- `optimize: validate:levels builds each contract twice, not three times` (5cd39b1) and `optimize: validateBlueprint
  memoises hull axes per point list and packs detail-grid keys into numbers` (73c6480). Measured together:
  validate:levels 108.35 → 77.07 s (−28.9 %, ab1). A repeat A/B at higher load: 142.15 → 109.78 s (−22.8 %, abF).
  Output byte-identical to baseline. check-building 3.96 → 3.79 s (−4 %, inside noise, not claimed).
- `optimize: loose pieces creeping slower than 0.4 m/s for 3 s may sleep` (d2d7c6b). **Intended behaviour change**:
  every blast fingerprint moves; idle fingerprints are unchanged. Result (ab2, sequential): chapel_S settle 17 → 12 s
  and t10-20 s physics CPU 5.96 → 2.40 ms/step (−60 %). tower_D neutral: its collapse is still running at 20 s.
  terrace_S aftermath went 19.9 → 25.3 ms CPU on the standard blast, a trajectory divergence (weldsLost 1213 → 1229).
  Across 4 perturbed terrace blasts run in parallel, base aftermath was 27.5-31.8 ms; with the fix, 3 runs were
  28.9-32.2 ms and 1 run slept the whole pile (10.3 ms, 0 awake at 16 s).
- `optimize: terrain impacts() returns at once when no body moved in the last two steps` (79f5a9e). Output-identical
  (idle S/D and chapel fingerprints the same). Idle terrain ms/step: S 0.091 → 0.010, D 0.338 → 0.021 (ab3).
  idle_D after-step CPU 1.69 → 1.52 ms.
- Harness: sim.mjs PERF=1 mode, runtime.py (5 scenarios incl. chapel_S settle), render-probe.mjs, cpuprof.py.

Final A/B, base 70eec10 vs HEAD 79f5a9e (abF): **confounded by load.** buildMs, which no fix touched, rose +99 % on
tower_D and +227 % on terrace_S. Timing deltas in that file are not evidence. Its deterministic parts agree with the
A/Bs above: chapel settle 17 → 12 s, idle fingerprints SAME, blast fingerprints CHANGED (creep), ter_ms −89/−92 %.
Render at HEAD under load 18: rest 19.4 fps (vs 28.4 at baseline under load ~12). Draw calls and triangles at rest are
identical (176 / 1,497,735). After the blast: 3.6 fps, phys 178 ms. Not comparable; see Next run.

Failed or inconclusive:
- A first creep variant that covered only demolished pieces left terrace awake counts unchanged. Two undemolished
  loose wood props creeping at 0.1 m/s held the pile, so the rule was widened to every loose piece.
- The terrace pile does not sleep even when nothing moves above threshold (OVER=0 at 60 s, 1611 awake). Physics-only
  steps sleep it within 40 steps, so afterStep wakes it. Suppressing b3Body_SetAwake/b3Joint_WakeBodies did not help.
  The remaining wakers at 60 s are fire (updateFire scaleWeld → applyCaps; SetAwake), lamina delamination, and gas
  deflagrations (b3World_Explode plus impulses). Backlog #1a.
- Sim harness at texture tier low (−1.7 s per sim build) is blocked: materials.ts re-forces tier medium whenever
  initMaterials was not called, and initMaterials would also change meshDetail, which drives the detail LOD (sim).

Profiles (node --cpu-prof, summarised by .optimize/cpuprof.py):
- Tower blast 1200 steps, 183 s sampled: Box3D wasm step 51 %, afterStep 18 % (stepAnalysis 5.9, onHit 4.3,
  syncMeshes 4.5, terrainStep 3.7, stepVehicles 2.3), physics.step JS move loop 4.8 % self, GC 2.4 %.
- validate:levels (before the fixes), 191 s: GC 24 %, validateBlueprint 34 % (checkDetail 27 %), builds 17 %+,
  onMap's extra builds 9 %.
- Downtown build (sim): buildBlueprint 8.8 s = calibrate 4.0, createPiece 3.5 (addPieceGfx → texSet 2.3), analysis 2.0.
- Island mechanism (Box3D sleeps whole islands): diag in scratchpad/diag.mjs (ZERO / MOVERTHR / BISECT / NOWAKE /
  CALLS / OVER modes). Worth promoting into scripts/ if the next run works on sleep.

Backlog top 3: #1 collapse physics / wake scoping (fire and deflagration wakes keep piles awake); #2 multi-seed
runtime.py so chaotic blasts can be judged; #3 procedural textures at load (2.3 s CPU).

Next run: start with backlog #2. Interleave base and head (ABAB, ≥ 3 pairs) in runtime.py and report buildMs as a
load control, because single sequential A/Bs on this shared M1 swung ±100 %. Then #1a (wake scoping for burning
members). Dev server: port 5196 was taken by another agent's snap-recv tool; run 1 used 5206 (probes.sh names it).
The probes are trusted; the render probe needs `npx -y playwright@1.63.0 --version` once, and it drives system Chrome.

## Run 2 — 2026-09-29 (runtime focus, branch perf-2 from main 7ce1c56, worktree, CPU-time A/B, 10k tok ≈ 60 s)

Machine: load average 5-180 during the run (other agents' Chrome at 230 %+ and a map agent's sims in the shared
scratchpad). All timing claims below are interleaved, concurrent base/head pairs from `runtime.py --base`, each side's
buildMs within 0.97-1.05 of the other; fingerprints compared per pair.

Harness:
- `runtime.py --base <dir> [--shifts 0,0.15,-0.15] [--reps N] [--concurrent]` (4b81cf1): paired A/B, order alternating,
  blast scenarios over shifted blast x, medians and per-pair ratios of the CPU metrics, buildMs load control, per-pair
  fingerprints, NO-MACHINES flag. `--report <json>` reprints a saved table. Base trees: `git archive <rev> | tar -x -C
  <scratch>/<dir>` plus a node_modules symlink.
- `.optimize/bench-tex.mjs [tier] [rounds] [root]` (21c88b6): every PBR set through texSet, CPU ms per set, pixel hash.
  Medium, 64 sets: 3.5-3.8 s CPU, hash d1fb29e616291780.

Applied:
- `optimize: terrain impacts() walks only the pieces that moved` (771ef79). Machines-on made some body move every step,
  so run 1's early-out never fired and impacts() walked all 5-6k live pieces. physics.step now keeps this step's and
  the last step's moved entities; impacts() walks those in id order (= live-set order, so the dent budget is spent
  identically), falling back to the set when a quarter of it moved. A/B vs 7ce1c56 (runs/20260929T-r2-ab-impacts.*):
  idle_D ter 1.767 → 0.167 ms (x0.09), after_cpu 3.28 → 2.49 ms (−24 %); idle_S ter 1.80 → 0.91 ms, after_cpu
  3.46 → 3.07 ms (−11 %). Fingerprints SAME on 9/9 pairs (idle S×3, D×3, chapel, terrace, tower); blasts neutral.

Failed or not landed (numbers kept so the next run does not retry blind):
- `impacts()` landing state on the piece instead of a WeakMap: A/B vs 771ef79 (runs/20260929T-r2-ab-fall-REVERTED.*,
  load 5-13, 2 shifts): tower collapse after_cpu 31.32 → 31.09 ms (−1 %), terrace +1 %, idle_D +1 %. Noise; reverted.
  (Tower profile at HEAD: impacts self 3.1 s of 124 s, 2.5 %, all in the collapse-time fallback walk.)
- Soft bodies waking only when a bearer has shifted 2 mm / tilted 2 mrad since they fell asleep (tried in a scratch copy,
  not landed): Clearance sandbag wakes over t5-20 s 23 → 20. The bearers (7 timbers under 4 sandbags near
  (-12, 0.1, -62)) really are shoved at 0.16-0.32 m/s each time the bags wake, so the threshold barely bites. The loop
  settles by 9.5 s and recurs (soft 2.7-3.0 ms/step around t 16 s and 32 s on 7ce1c56).

Collapse-sleep diagnosis (backlog #1; diag scripts are in the session scratchpad: mkcalls.py builds a sim.mjs copy that
runs N extra steps after the scenario with MODE=calls|noafter|nohits|knock, KNOCK=<regex over "b3Fn @ stack"> turning
matching b3 calls into no-ops, and prints KEEPERS (bodies over their sleep threshold, net vs path displacement), a
per-step event log and every b3 setter call with its stack; wake2.mjs attributes each rise of the awake count to the
b3 call that caused it):
- Terrace at +20 s is still collapsing (roof falling in, 15-45 bodies over threshold a step): not a waker problem.
- Terrace at +60 s: 1580 awake. Knocking out any one family of b3 calls from afterStep (fire/heat SetAwake, machine
  motors, vehicles, blast impulses, SetType, SetMassData, soft impulses, terrain tile remakes) changes nothing; knocking
  out all setters sleeps it in ~3 s and a later body create/destroy wakes it again.
- Chapel at +20-30 s: 1040-1130 awake on 7ce1c56 in every variant, including physics-only steps for 8 s and with all 36
  filter joints destroyed. On 1a4ee3d (just before machines-on) the same pile does sleep at 21 s and is re-woken every
  few seconds by updateHeat's SetAwake on a softening member (4 calls woke 780 bodies). b9962a7 made every open service
  break act on the world, so the chapel's gas break now burns; its pile has hot (400-1200 °C) fragments rocking in place
  (oak 4794: 1.0 m of path, 3.6 cm net in 4 s). The keeper is in the physics, not in an afterStep call.
- Chapel settle_s: 12 s at run 1's end (79f5a9e), none within 30 s on 7ce1c56 (awakeOther 986 at 30 s).

End checks at 771ef79 (load 9-12): tsc exit 0; npm test exit 0, 35/35 (viewer-independence green); validate:levels,
grid, rigging, fractures exit 0; idle sim 1800 S/H/D/R: weldsLost 0, awakeOther 0 on all four (S fingerprint equals
7ce1c56's, 6d7ac09ba5cc0d8f).
Render (runs/20260929T-r2-render.txt, HEAD, load 9): rest 24.8 fps, p50 33.3 ms, 176 calls, 1.50 M tris, phys 3.0 ms,
render 12.6 ms; +5 s after the tower blast 4.4 fps, p50 200 ms, phys 131.9 ms, render 29.1 ms. Still physics-bound.
The probe now waits for the title screen (main.ts builds Clearance behind it before physics is free; the old probe hit
`b3DefaultWorldDef` of undefined).

Backlog top 3: #1 rubble piles that never sleep (find the physical keeper: hot rocking fragments), #2 collapse physics
proper, #3 procedural textures (worker or cache).

Next run: probes trusted; use `runtime.py --base <git-archive export of the base rev> --concurrent` for every timing
claim (idle via --reps 3, blasts via --shifts 0,0.15,-0.15), CPU-time metrics, buildMs ratio as the load control.
Start with backlog #1 from the chapel at +20 s on HEAD: build per-island keeper lists (contact BFS from the rocking hot
fragments), then try a jitter rule next to creep(). Before that, move runtime.py's idle window to t10-20 s (backlog #4).
Dev/probe server port 5206 (free this run). Other agents share the scratchpad and load the machine (load 5-180).
