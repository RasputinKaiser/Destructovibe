# Gothic church with spire

Landmark `cathedral` (6 bays) and variant `cathedral-4` (4 bays, used on the Heritage map). Pipeline `finish`: parts
return local, unplaced pieces; `assemble` applies the envelope finish, placement, group `cathedral` and age
(160 years, outdoor).

## Real-world reference

An English Gothic town church built to small-cathedral ambition (Early English into Decorated, c. 1220–1320):

- **Nave arcade** of clustered piers (a square core with four attached shafts, like the Purbeck-shafted piers at
  Salisbury) carrying two-centred pointed arches with radiating voussoirs, a keystone and solid spandrels up to a level
  string course.
- **Clerestory** above the arcade, a pair of lancets per bay.
- **Quadripartite rib vault** over the nave (a cathedral feature; most parish churches stop at a timber roof), with a
  **steep slated roof on oak king-post trusses** above it, hidden from below.
- **Lean-to aisles** under slated mono-pitch roofs, **stepped buttresses** with pinnacles at every bay line and
  **flying buttresses** carrying the vault thrust over the aisle roofs to the clerestory (as at Westminster Abbey or
  Salisbury's nave).
- **West tower** standing against the west front on its own foundations, with a louvred **belfry** hung with three bells
  and an **octagonal broach spire** (the Northamptonshire and Rutland type, e.g. Ketton or Oakham) with finial and
  weathercock at about 64 m.

Nave axis along Z, west front toward +Z. Bay length 6.5 m; nave clear width 10 m; aisles 4.6 m clear.

## Frame (`frame.ts`, a function of `bays`)

| datum | value | meaning |
|---|---|---|
| `grid.z.bay0..bayN` | 18 − 6.5 i | bay lines; `bay0` is the west wall's inner face, `bayN` the east wall's outer face |
| `grid.z.towerFace` | bay0 + 1.2 + 0.08 | tower's east face (80 mm movement joint behind the west wall) |
| `grid.x.nave / arcade` | 5 / 6 | inner and outer faces of the arcade and clerestory walls |
| `grid.x.aisleIn / aisleOut` | 10.6 / 11.5 | aisle wall faces |
| `levels.floor` | 0.3 | top of the flagged floor |
| `levels.pierTop / capital` | 8 / 8.6 | pier shafts, capital top (arch springing) |
| `levels.aisleEaves` | 9.5 | aisle wall plate |
| `levels.arcadeTop` | 13.4 | level course on the arcade; clerestory seat |
| `levels.springing` | 15.5 | vault springing |
| `levels.wallPlate` | 22.5 | clerestory and end-wall tops; nave roof seat |
| `levels.belfryFloor` | 24 | top of the tower shaft |
| `levels.spireSeat` | 30.8 | top of the belfry's corbel course |

Member sizes shared across parts (`END_W` 1.2, `CAPW` 0.95, tower half-width 4.5, tower wall 1.2) and the palette are
constants in `frame.ts`.

## Structural system

Unreinforced load-bearing masonry (lime-mortared stone with ashlar faces) and oak. Masonry pieces are welded where they
touch; the tower is deliberately not bonded to the nave. Bells hang on hinges from oak bell beams and can swing free.

## Parts and load paths

Piece counts are for 6 bays / 4 bays. Budgets are about 20% over the 6-bay count.

| part | pieces | budget | provides | needs | load path |
|---|---|---|---|---|---|
| `side-walls` | 213 / 141 | 255 | `navePlate`, `aislePlate` | `arcadeTop` | clerestory → arcade level course → arcade → piers → ground; aisle walls → ground |
| `end-walls` | 73 / 73 | 90 | | | west and east end walls (aisle ends, nave end, nave gable wall up to the wall plate) → ground |
| `arcade` | 204 / 136 | 250 | `arcadeTop` | | spandrels and voussoirs → capitals → clustered piers and end responds → ground |
| `aisles` | 74 / 50 | 90 | | `aislePlate` | lean-to roof → aisle wall plate (upper edge rests against the arcade's outer face); buttresses → ground; flyers → buttress heads, butting the clerestory |
| `tower` | 28 / 28 | 35 | `belfryFloor` | | tower shaft → ground |
| `belfry` | 31 / 31 | 40 | `spireSeat` | `belfryFloor` | bells → bell beams → belfry piers → tower shaft; corbel course, parapet, pinnacles → belfry piers |
| `spire` | 66 / 66 | 80 | | `spireSeat` | finial → spire courses → corbel course → belfry → tower → ground |
| `vault` | 186 / 126 | 225 | | | web courses and ribs → springers on the clerestory's inner faces (lateral; see gaps) |
| `nave-roof` | 78 / 53 | 95 | | `navePlate` | slates and trusses → clerestory wall plate; gables → end walls |
| `floor` | 36 / 24 | 45 | | | 0.3 m flagged floor on hardcore → ground |
| `interior` | 41 / 25 | 50 | | | pews, chancel step, altar, font → floor; lanterns and conduit → north aisle wall |

`lib.ts` holds the shared masonry kit: `stoneRun()` (the limewashed wall run), `walls()` (leaded lights, then the ashlar
pass) and `masonry()` (the ashlar pass alone). Each glass pane's colour seed comes from its own position, so `side-walls`
and `end-walls` are independent.

## Verification

- Split: every part's pieces were bit-identical to the old single-part body. Since the final fix the glass colours come
  from each pane's position (tints only; pieces, geometry and mass unchanged, verified with tints stripped), so the
  fingerprints of `cathedral`, `cathedral-4` and their `landmark:` entries changed once, deliberately.
- `check-building cathedral --settle`: bearings satisfied, 0 welds lost and 0 awake bodies at rest, both variants.
- Pier hit `node scripts/sim.mjs P:cathedral 900 5.5,2,1.9,3` (piers at z = 8.4 and 1.9 in prefab coordinates), with
  canonical piece order, 2026-09-29T07:15Z: 2048 welds lost (57.21%), 12.621% demolished, 0 runaways; identical across
  two runs. (Before canonical ordering: 964 lost, 26.93%.) The collapse engine is being tuned concurrently; re-record
  before comparing.

## Known gaps

- **Piece order was load-bearing for the collapse sim** (the same geometry in a different order gave 49% welds lost
  instead of 27% on the pier hit). `assemble()` now sorts pieces into a canonical order, so part order and emission
  order no longer matter; the pier-hit reference was re-recorded under it (see the SDD ledger).
- **Lateral contacts are not bearings.** The vault springs off the clerestory's inner faces at 15.5 m, the aisle roofs'
  upper edges rest against the arcade's outer face, and the flyers butt the clerestory; the bearing checker models
  only vertical seats, so `vault` has no `needs` and `aisles` declares only the aisle wall plate.
- `aislePlate` is declared for the +x aisle wall only (a bearing is one box); the −x side mirrors it.
- **No footings.** Walls, piers and the tower stand on grade; the map supplies the foundation (`onFoundation` /
  `landmarkFoundation` on Heritage). The floor is a slab, not a foundation.
- A shattered pier stays as rubble in place and keeps carrying the shaft above it, so a pier hit under-collapses the
  arcade.
- The vault has no springer fill (tas-de-charge): its lowest courses only touch the clerestory's inner face.
- Part-local literals not tied to the frame: aisle-roof profile heights (12.6, 12.95, 9.85), buttress offsets and
  heights, flyer geometry, belfry louvre and beam heights, spire tip (62 m), and the interior's west-end positions
  (pews from z = 14.5, font at 16.2, supply box at 16.4–17), which assume `bay0` = 18.
