# Victorian railway terminus (`station`)

A brick booking hall with a corner clock tower fronts (+Z) a 36 m single-span wrought-iron train shed over four platform
roads. Placed by `src/levels/maps/railway.ts` (`LANDMARKS` id `station`). Pipeline `finish` (group `station`, age 140 y
outdoor).

## Real-world reference

References: `docs/references/REFERENCES.md`, id `landmark/station`.

- Barlow shed, St Pancras (1868): 73.2 m span, 30.5 m to apex, 24 wrought-iron lattice ribs at 8.94 m centres, each
  1.8 m deep; rise/span about 0.42; glazed over the middle, slated at the haunches.
- Paddington (1854) and Liverpool Street / Manchester Central: arched wrought-iron ribs carried on longitudinal
  girders over rows of cast-iron columns, the arrangement modelled here (St Pancras's ribs instead spring from platform
  level and are tied under the deck).
- Booking hall and clock tower: the brick-and-stone street range in front of the shed, as at King's Cross and St Pancras.

Model versus reference: 36 m span (x = ±18), 13 m rise (rise/span 0.36), 7 ribs at 8 m centres (z = -2 … -50), rib
depth 1.0 m, springing at 9.5 m on 1 m plate girders over 8.6 m cast-iron columns. Canopies carry the platforms on to
z = -66.

## Structural system and load path

| Part | Pieces | Budget | Provides | Needs | Load path |
|---|---|---|---|---|---|
| `booking-hall` | 559 | 600 | | | slate → king-post oak trusses → brick walls (Flemish-bonded street front, plain members elsewhere) → made ground. Counters, benches, supply box, conduit and tie-beam pendants included. |
| `clock-tower` | 31 | 40 | | | slated pyramid → stone course → open belfry corner piers → brick shaft on its own walls → ground. Independent of the hall. |
| `ribs` | 112 | 120 | `purlinLine` | `ribSpring` | purlins → rib segments (riveted, 190 kg/m, flanges + Warren lattice, solid-web springers) → girder tops. |
| `columns` | 56 | 60 | `girderSeat` | | capital bearing plate → two cast-iron column lifts (compression only) → stone pads → ground. |
| `girders` | 12 | 16 | `ribSpring` | `girderSeat` | rib feet → riveted plate girders (I, 0.9 m deep) → column capitals. |
| `roof` | 192 | 220 | | `purlinLine` | slate (j 0–4, 11–15) or patent glazing with pane-scale bars (j 5–10) → I purlins, one per rib segment per bay → rib outer flanges. |
| `platforms` | 134 | 150 | | | asphalt decks and stone copes → brick fill → ground; ballast with sleepers, bullhead rail, buffer stops, concourse made ground. |
| `canopies` | 24 | 30 | | | boarded roof and valance → bracketed cast-iron head beams → umbrella columns on the platform decks. |
| `services` | 24 | 30 | | | platform lamps on the decks, each on its own feeder. |

Frame datums (`frame.ts`; parts read them only through the Frame they are given): levels `ground` 0, `platform` 0.9,
`firstFloor` 5.4, `girderSeat` 8.6, `springing` 9.5, `hallEaves` 10.5, `crown` 22.5, `extrados` (crown + half the rib
depth, 23.0); grid x `colW`/`colE` ±18, `hallW`/`hallE` ±20, `clockTower` 22.7; grid z `rib0..rib6`, `concourse` -8,
`shedEnd` -66, `hallBack` 0, `hallBackIn` 0.45 (the hall's wall thickness is `hallBackIn - hallBack`), `clockTower` 11.3,
`hallFront` 14. The column lifts, buffer stops and canopy heads are placed relative to these. `arch(f)` in `frame.ts`
(re-exported by `lib.ts`) derives the arch geometry (radius, centre, segment angles) from them, and `hall(f)` derives the
booking-hall dimensions. `purlinLine` is an inclined bearing: the outer-flange chord face of the segment just east of the
crown (normal along that segment's mid-angle), which the ribs' flanges and the purlins' undersides both lie in.

## Known gaps

- `purlinLine` checks one representative seat (the segment east of the crown); the other segments' seats are the same
  plane rotated about the arch centre and are not checked separately.
- Part order in `def.ts` no longer matters to the physics: `assemble()` sorts the pieces into a canonical order. The
  blast reference `node scripts/sim.mjs P:station 900 0,1.5,-18,4` was re-recorded with that order (see the SDD ledger).
- The hall's supply box, conduit and pendants stay in `booking-hall` (they hang from its tie beams); `services` holds only
  the platform lamps.
- Ribs are 1.0 m deep against St Pancras's 1.8 m, and rise/span is 0.36 against 0.42. The shed is 48 m long (7 ribs); no
  glazed end screens.
- Street front brick-by-brick only; other hall walls are plain members to hold the budget.
