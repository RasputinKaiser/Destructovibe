# Gameplay and map loops

Same shape as the critic loop (docs/critic-loop.md): an improver owns a piece on its own git branch/worktree, a fresh
critic with no stake judges the evidence, repeat up to 4 rounds. The pieces here are play experiences rather than
single buildings.

## Pieces

- **Contract chapters** — each chapter of contracts (I odd jobs, II Heritage Yard, III Railway Quarter, IV Downtown).
- **Free-play maps** — Clearance Zone, Heritage Yard, Downtown, Railway Quarter: layout, composition, sightlines,
  landmark placement, how the site reads from the spawn and from the street, frame rate.
- **Core feel** — first minutes of play (menu → briefing → first blast), tool readability, feedback, HUD.

## Evidence pack (improver → critic)

`<scratchpad>/play/<piece-id>/round-<n>/`:

1. `playthrough.md` — every contract/map in the piece actually played in the browser to completion (or to failure),
   with the tool sequence used, time taken, score/stars, and anything confusing, dead, broken or tedious, written as
   observations, not self-assessment.
2. `shots/` — spawn view, briefing, key moments (first blast, collapse, results screen), map overview, problem spots.
3. `perf.txt` — frame time (at rest, during and after the biggest collapse), piece count, load time.
4. `claims.md` — what changed since the last round, one line each.

## What the critic judges

- **Clarity:** does the player know the goal, the target, the protected neighbours, the rules (footprint, time,
  salvage), and why they won or lost? Are the tools' effects readable before and after use?
- **Pacing and challenge:** par times and star thresholds achievable but not trivial; loadouts that make the intended
  tools matter; no dead time (waiting for a slow collapse, walking far with nothing to do); a difficulty curve across
  the chapter.
- **Payoff:** does the big moment look and sound as good as the references (docs/references/REFERENCES.md) and is it
  worth replaying (collapse replay `V`)?
- **Maps:** believable site plan (streets, plots, services, scale), landmark sightlines, no props inside buildings or
  floating, no empty dead zones, performance within budget.
- **Bugs:** anything broken, stuck, unwinnable, or scored wrong.

Findings ranked Critical / Important / Minor with shot + reproduction steps; verdict PASS / FAIL.
