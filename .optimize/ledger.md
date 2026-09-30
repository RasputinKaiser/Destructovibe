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

## Run 3 — 2026-09-29 (runtime focus, branch perf-3 from main ee1aac2, worktree, CPU-time A/B, 10k tok ≈ 60 s)

Machine: load average 10-90 (other agents). Timing claims are interleaved concurrent pairs from `runtime.py --base
<git archive ee1aac2> --concurrent`, buildMs ratio 0.92-1.05 on every pair. Raw tables: runs/20260929T-r3-ab.txt
(+ -ab-blast/-ab-idle/-ab-terrace/-ab-chapel2 .json); realism probes: runs/r3-probe/.

Harness:
- runtime.py idle window moved to t 10-20 s (1200 steps) and idle rows print phys_cpu and awake_other (68f0a7c).
- `.optimize/keepers.py <tree> <out.mjs>`: run 2's scratch mkcalls.py, promoted. Builds a sim.mjs copy that runs extra
  tail steps and prints awake counts, a per-step event log (over-threshold bodies, creates, destroys, impulses, wakes),
  KEEPERS (net vs path displacement per body) and, with MODE=calls, every b3 setter call with its stack; KNOCK=<regex>
  no-ops matching calls, MODE=noafter skips afterStep. Run it from the tree's own directory.
- `.optimize/realism-probe.mjs`: run 1's verifier probe, promoted (hover/no-contact sleepers, wake test, demo% timeline).

Diagnosis (chapel blast, +19 s, tail 240-600 steps; scratchpad r3/):
- Physics-only steps (MODE=noafter) DO sleep the chapel pile at HEAD (1046 → 49 awake in 200 steps; the 3 bodies left
  are machine parts), so the keeper was in afterStep after all. Tracking the rocking hot fragments step by step showed
  no afterStep call touches their velocity: the jitter came from the island being woken.
- Wakers found with KNOCK: freezeRubble's b3Body_SetType (81 calls in one budget pass; Box3D's SetType wakes the whole
  island and drops the body's contacts, so the heap re-settles on cold contacts, OVERAVG over-threshold bodies/step
  29.6 → 17.0 when knocked) and updateFire/updateHeat's SetAwake on welded burning/softening members (1 every ~2 s).
  Knocking either alone does not sleep the pile; both together does (then it is re-woken only by genuine events: a
  burnt fragment destroyed, a gas deflagration). No jitter/creep rule was needed: the rocking stops once nothing wakes.

Applied:
- `optimize: freezing resting rubble no longer wakes its heap` (71ed5d2): a sleeping piece being frozen collects its
  asleep neighbours (the onRubble AABB query) and puts them back to sleep after SetType.
- `optimize: heat/fire wakes a sleeping member only when a joint is near capacity` (f1d2a50): heatWake() wakes a
  sleeping member only if a weld's last solved force/torque or static demand is ≥ 0.6 of its (heat-reduced) cap.
  Freeze-only (71ed5d2 alone) does not sleep the chapel (awake 945 at +29 s); both do.
- A/B vs ee1aac2 (5 chapel shifts, 3 tower, 4 terrace, idle S/D × 2), medians:
  chapel_S t10-20 s phys_cpu 14.6 → 12.5 ms (shifts 0/±0.15), 13.9 → 11.6 ms (±0.3); shift 0: 19.5 → 7.5 ms, awake at
  30 s 981 → 50 (awakeOther 932 → 0); +0.3: 947 → 88 (awakeOther 859 → 0). ±0.15 and -0.3 stay awake (below).
  tower_D, terrace_S: neutral (all timing within ±7 %, fp SAME on 2/3 tower pairs); both piles are still collapsing at
  20 s (tower awake 3800, terrace 1850), so their sleep is not judged by these windows.
  idle_S/idle_D: fingerprints SAME on 4/4 pairs, timings neutral.
- Realism (probe, chapel shift 0, 30 s): wake test on all loose sleepers (180 steps at the default threshold) head
  1489 sleepers, 0 moved > 2 cm, 0 dropped; base 899 sleepers, 9 moved > 2 cm, 1 dropped 21 cm. no-contact sleepers
  18 (base 47). hoverN 348 vs 129 is ray geometry over 1.7x more sleepers (the wake test shows they are supported).
  demo % per pair (base/head): chapel 3.76/3.48, 3.62/3.74, 3.75/3.35, 3.63/3.61, 8.82/9.25; terrace 3.69/3.27,
  4.35/4.39, 4.39/4.42, 3.38/3.63: signed differences both ways, within the trajectory scatter. weldsLost similar.

- Realism (probe, terrace shift 0, 61 s): demo 4.57 % base / 4.28 % head (the A/B terrace pairs span 3.3-4.4 %);
  wake test base 770 sleepers, 2 dropped > 10 cm (0.15 m); head 704 sleepers, 1 dropped (brick 4918 at y 3.1, a
  creep-raised sleeper that slid off when woken, 2.9 m). Neither pile sleeps by 60 s (awake 1720 / 1836; head was at
  60 awake at 50 s and was woken again).

Remaining awake piles are real motion, not wakers: on chapel +0.15 (x -60.35) at +29 s, pure physics (MODE=noafter)
still has stones rolling away from the heap (3332/3334: 7 m in 5 s at y 0.1-0.3; 1586: 3.3 m), and the full run has a gas
deflagration at +31 s (5 bodies made, 624 impulses). The pile then sleeps by +33 s in both (awake 1046 -> 126, of which
95 machine). So "asleep within ~15 s of motion ending" holds on that trajectory; the 30 s window of chapel_S just ends
before it. (Crates 553-556 riding the conveyor at (39, -41) and a crane/magnet group are separate machine islands.)
The terrace at +29 s is still failing welds (15 in 5 s), carving detail and remaking terrain tiles. At +47-57 s
(keepers.py, S 2880 + 600): pure physics sleeps it (awake 57 -> 15, machines only); the full run sleeps it to 47-60 awake
and is re-woken by gas deflagrations every ~4.3 s (b3World_Explode from fields deflagrations, 614-674 impulses and
13-27 bodies destroyed each, then detail shrink/carve of the damaged units) plus single destroys (fire disintegrate,
fading rubble, terrain sweep freeing a buried body). All are real events; whether a leaking main should keep puffing
(rather than settle into a jet flame) is a gas-model realism question, not a sleep bug.
Risk to watch: heatWake has no dedicated fire-collapse scenario in the harness (the chapel's gas fire is the only one);
a burning frame's joints now break when their load reaches 0.6 of the decaying cap instead of on a random nudge.

End checks at f1d2a50: tsc exit 0; npm test exit 0, 35/35 (viewer-independence green); validate:grid, rigging, fractures,
levels exit 0; idle sim 1800 S/H/D/R: weldsLost 0, awakeOther 0 on all four.

Backlog top 3: #1 rolling rubble (stones rolling 7 m at +29 s) and late deflagrations on the chapel; #4 terrace late
aftermath (gas deflagrations every ~4.3 s, a gas-model question); #2 collapse phase proper (Box3D step 50 % of tower).

Next run: probes trusted. A/B with `runtime.py --base <git archive of the base rev> --concurrent`; realism with
`.optimize/realism-probe.mjs` (wake test + demo% over shifts); wakers with `.optimize/keepers.py` (MODE=noafter first:
if pure physics sleeps the pile, the keeper is a wake call, find it with MODE=calls/KNOCK). New scenario terrace_S60
(3600 steps, t 45-60 s): A/B vs ee1aac2, 2 pairs: late phys_cpu 12.6 -> 11.1 ms, after_cpu 7.1 -> 6.7 ms, awake_min_late 60 / 52 (both piles do sleep between deflagrations; neither run changes the cadence). Start with backlog #1: why round stones roll 7 m on the
chapel heap (rolling resistance of pieces over RUBBLE_VOL), then the gas deflagration cadence (#4) with the owner's
view on realism. No fire-collapse scenario exists: add one before touching heat/fire rules again (heatWake, f1d2a50).

## Run 4 — 2026-09-30 (runtime focus, branch perf-4 from main efe6d57, worktree, CPU-time A/B, 10k tok ≈ 60 s)

Machine: load average 12-570 and swapping (16 GB, 116 MB free, 5.5 GB compressed; other agents). Timing pairs are
concurrent (`runtime.py --base <git archive> --concurrent`), buildMs ratio 0.93-1.05 on every pair, but with 2-3 pairs
at this load only large or one-sided deltas count. **No src change landed this run** (both candidate rules reverted);
the committed work is harness + diagnosis. Raw data: runs/20260930T-r4-*, runs/20260929T-r4-*, runs/r4-probe/.

Harness:
- `.optimize/rollers.py <tree> <out.mjs>`: sim.mjs copy tracking every loose demolished non-machine piece from t 16 s
  (ROLL0): late path, net displacement, rolling signature |v|/(|w| r). ROLLSUM + top-30 ROLLERS.
- `.optimize/rest-probe.py <tree> <out.mjs>`: per-second census of awake loose rubble at rest (<1 cm/s, by volume bin),
  frozen/thawed, fracture queue length (fq), fractures, pieces, cumulative phys ms.
- runtime.py: new scenario chapel_S45 (S 2700, kind late, window t 20-45 s; prints awake_mean_late). 'late' scenarios
  take an optional (lo, hi) window.

Re-measured (backlog #4, gas-settle merged): terrace_S60 A/B 4917780 (pre gas-settle) vs efe6d57, 2 pairs
(runs/20260929T-r4-terrace60-gas.*): shift 0 fingerprint SAME (awakeOther 25/25: the leak there never mattered);
shift +0.15 awake_end 1733 -> 115, awakeOther 1684 -> 26. Both trajectories now sleep by 60 s. #4 closed.

Backlog #1 (rolling rubble) not reproduced at HEAD (engine round 4 changed the trajectories): rollers.py on chapel +0.15,
t 16-30 s (runs/r4-probe/roll-c015.txt): 1548 loose pieces, 139 m total late path, 10 over 3 m. The long paths are
crane/rope loads (castiron 702 on 2 ropes), conveyor crates and machine parts; the only free rollers are oak log
fragments (cylinder prisms, 0.007-0.1 m³) rolling 2-4 m on flat ground at y 0.1-0.2. No stone moves over 1 m. No change;
closed. What keeps that pile awake instead (keepers.py MODE=calls + a WAKER wrapper, runs/r4-probe/keep*.txt): it sleeps
(~90 awake, machines) and each b3DestroyBody of a piece in it wakes ~960 bodies: detailHeat shrink of a burnt-out
detail piece, fire disintegrate, pulverize, fade. 5 such destroys in 10 s.

Failed (reverted, numbers kept):
- **freeze-v1** (runs/20260930T-r4-freeze-v1-REVERTED.diff, -ab-freeze-v1-REVERTED.json): loose rubble of any size at
  rest 2 s (1 cm, 1°), touching only ground or unjointed rubble, set static; thawed by a hit able to lift it 2 cm, a
  blast over it, applyImpulseAt (tools), gravgun grab, magnet reach, a moving machine/vehicle contact, or a support
  (contact below/beside) shifting 1 cm or dying; mass data restored on thaw. A/B 2 pairs: tower_D aftermath phys_cpu
  78.7 -> 70.6 ms (-10 %, ranges overlap 55-102 / 55-86), collapse neutral, demo 61.0 -> 57.0 % (57.7-64.3 / 56.0-57.9);
  terrace_S aftermath phys_cpu 14.8 -> 23.7 ms, shift 0 base slept at 16 s (93 awake), head did not (1826), weldsLost
  1018 -> 2063. Why it cannot bite (rest-probe with debug counters, runs/r4-probe/rest-*-h*.txt): in the tower at
  t 20 s the ~1900 resting loose pieces are mostly queued for fracture (p.queued, ~1600 a tick) or detail pieces;
  of 918 candidates 483 froze and 315 were thawed again (287 by a support creeping 1 cm). On the terrace 2993 of 3231
  candidates lie on standing (welded) floors, which must not be frozen (static rubble would stop loading the floor).
- **quiet destroy** (runs/20260930T-r4-quiet-destroy-REVERTED.diff, -ab-quiet-REVERTED.*): a sleeping unjointed piece
  whose dynamic contacts are all asleep and either below it or pressing on it with < 5 % of their weight
  (totalNormalImpulse) is destroyed and its neighbours put back to sleep (SetAwake(false) splits the island first).
  Qualified 1 of 5 chapel destroys. A/B chapel_S45, 3 pairs: awake_mean_late 569 -> 898 (shift 0: 569 -> 1371;
  ±0.15 neutral 970/898, 554/547), late_phys_cpu median ratio x0.95, awake_end 73 -> 1026 (3/3 pairs higher). Realism
  probe (chapel +0.15, 45 s): wake test moved > 2 cm 9 -> 4, dropped 1 / 1. No win.

Diagnosis for the next run (backlog #2, tower collapse):
- The tower's fracture queue (FRACTURE_PER_STEP 3, sorted by intensity) holds 75 entries at t 5 s, 1966 at 10 s, 2243
  at 14 s and still 1432 at 20 s (fractures 537 -> 1240 over t 10-20 s, ~70 a second). Queued pieces lie in the heap
  for 10-20 s before breaking late. Experiment (scratch, not landed): processFractures(max(3, ceil(queue / 30))) empties
  it by t 18 s with 1632 fractures total (so many queued entries were stale), awake at 20 s 3598 vs 3742, pieces 6612
  vs 6696, demo 57.88 vs 57.73 %, cumulative phys ms 255 s vs 246 s (concurrent, same load): no speed gain by itself.
- The sim's "awakeMachine 3341" on the tower is its AABB flood reaching the heap through a store machine that is not
  running (axes 1, running 0), not a motor keeping it awake.

End checks at c5daec1 + this ledger (src/scripts/tests identical to efe6d57: `git diff efe6d57 --stat -- src scripts
tests package.json` empty): tsc exit 0. npm test / validate / idle sims / render probe not re-run: no code under test
changed, and the machine was swapping (load 275-570).

Backlog top 3: #2 tower collapse (fracture backlog: decide with the owner whether a piece past its hp at impact breaks
within ~1 s, then measure; what keeps 3400 awake at 20 s: keepers MODE=noafter at t 20 s), #1 burning-heap re-wakes
(destroys of burnt/faded pieces), #3 procedural textures.

Next run: probes trusted. chapel_S45 is the scenario for heap re-wakes (t 20-45 s); rest-probe.py for what rubble sits
in the solve; rollers.py for late movers. Before any freeze rule: the terrace's rubble lies on standing floors and the
tower's is queued for fracture, so a freeze rule needs the fracture backlog settled first. Run A/Bs only when
`uptime` load < 50 and `vm_stat` shows free pages; this run's timings are weak.
