# Critic loop

Every important piece (a building, a collapse behaviour, a material, a tool, a map) is improved in a loop between two
separate agents. The critic never sees the improver's reasoning, only the evidence.

## Roles

- **Improver** — owns the piece (a CLAIM on the building package, or an explicit file list). Produces an evidence pack,
  fixes what the critic reports, re-shoots. Never grades its own work.
- **Critic** — fresh context each round, read-only, told to be harsh. Compares the evidence pack side by side with
  real references and returns findings. It has no stake in the work and is not asked to be encouraging.

## Evidence pack (improver → critic)

Written to `<scratchpad>/critic/<piece-id>/round-<n>/`:

1. `shots/` — screenshots at the same camera angles as the reference photos listed for the piece in
   `docs/references/REFERENCES.md` (the "Angle/shows" notes), plus one close-up of a joint/edge detail and one wide
   context shot. High quality, 100 % render scale, daylight.
2. `refs.txt` — the reference ids and local photo paths used (`<scratchpad>/refs/<item>/NN.jpg`).
3. `physics.txt` — headless numbers from `scripts/sim.mjs`: idle settle (welds lost, awake), and for buildings a
   standard blast (the SPEC.md load-path weak point), reporting demolished % at t = 1, 2, 3, 5, 8 s, debris-pile height
   ÷ building height, debris spread radius, fragment count by material.
4. `claims.md` — what changed since the last round (one line each). No self-assessment.

## Critic output

Findings ranked Critical / Important / Minor, each with: what is wrong, which reference shows the real thing
(file path), where in our shot, and the physical or visual principle violated. Visual tells to check include
proportions (storey heights, bay rhythm, roof pitch), material texture and scale, weathering, edge detail, what breaks
into what, rubble shape and size distribution, dust. Physical tells: collapse onset and duration vs the benchmarks in
REFERENCES.md, pile-height ratio, spread, whether members fail where real ones fail. Ends with a verdict:
`PASS` (no Critical/Important) or `FAIL`.

## Loop

1. Improver builds the round-1 evidence pack.
2. Critic reviews → findings.
3. Improver fixes every Critical and Important finding (Minor at its discretion), re-runs `check-building --settle`,
   writes the next evidence pack.
4. A fresh critic reviews the new pack **and** the previous findings (addressed / not addressed).
5. Stop at `PASS` or after 4 rounds; unresolved findings go to the piece's `SPEC.md` "Known gaps".

Headless numbers are the source of truth for physics claims; screenshots are the source of truth for looks. A critic
may reject a claim it cannot see in the evidence.
