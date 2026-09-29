# Performance loop

A recurring optimization loop, run with the `/optimize` skill (ledger in `.optimize/`, committed). Each iteration
runs on its own branch and worktree (`perf-<n>`), lands measured, behaviour-preserving fixes, and hands the branch to
the lead to merge. A separate verifier agent re-measures every claimed win before merge; the improver never grades
its own numbers.

## Probes

Runtime (the game's hot paths, headless and in-browser):

| probe | how | target |
|---|---|---|
| idle step | `node scripts/sim.mjs S|D 600` — after-step ms, awake bodies | ≤ 1 ms, 0 awake |
| collapse step | Downtown tower blast `D 1200 -60,1.5,-55,5` — physics + after-step ms during collapse | ≤ 16 ms total |
| aftermath step | same run, t = +15 s after collapse | ≤ 5 ms, < 500 awake |
| terrace blast | Clearance standard blast — after-step ms, bodies created | ≤ 10 ms |
| render (browser) | Downtown at High, Auto scale: frame ms, draw calls, triangles, GPU ms at rest and 5 s after a large blast | 60 fps at rest, ≥ 30 fps after |
| memory | JS heap after 3 large blasts | no growth across repeats |
| load | time to first playable frame per map | tracked, ratcheted |
| bundle | `npm run build` main chunk size (gzip) | ratcheted |

Dev loop: `npm test` (full), `node scripts/check-building.ts <id>` (per call, currently ~4 s from the integrity
scan), `npx tsc --noEmit`, `npm run build`, `npm run validate:*`.

Physics outcomes are part of behaviour: a perf fix that changes a sim `RESULT` fingerprint for a fixed input is not
behaviour-preserving unless the change is the documented goal of the fix. The viewer-independence test must stay green.

## Loop

1. Improver agent in `perf-<n>` runs `/optimize` (first run builds `.optimize/probes.sh`, including the browser
   render probe, and commits the baseline immediately).
2. Verifier agent (fresh, read-only on code) re-runs the probes on the improver's branch and on `main` back to back
   on the same machine and confirms or rejects each claimed delta.
3. Lead merges confirmed fixes, pushes, and starts the next iteration from the top of `.optimize/backlog.md`.
4. Stop when a run finds nothing above threshold in any area, or on user request.
