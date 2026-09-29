# Boiler-house chimney

Free-standing square brick chimney for a works boiler house. Local frame: shaft on Y, the flue (and the boiler house)
toward +X. Param `wall`: where the boiler house's wall stands, metres from the axis along +X (the flue duct runs to it).

In Clearance it stands at (37, -13), axis-aligned, 2.5 m west of the boiler house (`wall` 4.5) on a mass-concrete pad
(`foundationLocal`, below grade, placed with `onFoundation`). Felled west it comes down across the yard and Works Road:
~25 m of open ground, its top landing in the back yards behind the high street shops (their boundary wall at z -15.4,
gas meter boxes on the shop backs). No spot beside the boiler house has a clear 35 m lane in an axis direction, and a
turned chimney is not an option: a charge against a wall that is not square to the 1 m blast grid is taken as confined
(the pedestal's hollow becomes a "room" and its gas cracks the whole base), so it would fell unpredictably.

## What it is

| | |
|---|---|
| height | 32.3 m to the coping, 33.8 m to the tip of the air terminal |
| pedestal | 4.0 m square, 4.5 m high, 680 mm (three-brick) walls, English bond, four blue engineering-brick plinth courses, a slate damp-proof course at 1.2 m, a weathered stone capping course (100 mm oversail) that corbels inward to carry the shaft |
| shaft | 26.3 m, square, battered from 2.6 m to 1.6 m across (1 in 53 a face); walls set off inside at each lift: 560, 560, 450, 450, 340, 230 mm |
| cap | six oversailing courses of 50 mm (300 mm out), ten plain courses, a stone coping course, a wrought-iron band under it, soot-black |
| flue | 1.5 × 1.95 m brick duct from the boiler house wall into a 1.4 m wide inlet through the pedestal's east wall |
| fittings | cast-iron soot door (south face), wrought-iron bands every 1.5 m over the upper half, copper down-tape on the north face, 1.5 m copper air terminal (`lps`) on the cap |

Slenderness (height / shaft base) 32.3 / 2.6 = 12.4, against Broadstone Mill's 69 / 5.5 = 12.5; square base section, a
taper to ~0.6 of the base width and a corbelled cap (docs/references/REFERENCES.md, landmark/mill: benchmark and tell 3).
Top lift and cap sooted. Bricks 215 × 65 mm on a 225 × 75 module.

## How it is built (21 pieces, ~29 k dormant units)

- Every lift is one body: a compound of its four wall hulls (lapping alternately at the corners) whose dormant detail
  is the brickwork, course by course, 12 mm behind the envelope (bands and tape sit in that skin). The joints between
  lifts are whole rings of courses, so the chimney lets go along bed joints and damage releases bricks, not slabs
  (collapse/chimney-felling, tell 4).
- Base course (lowest 1.2 m): each wall in three lengths jointed at ±0.7 m, all welded to the ground: blow one face and
  the near and middle thirds of the faces beside it and what is left (the far face and far thirds) is the hinge. Its top
  course is the slate DPC, and the pedestal lift stands on it across a 30 mm open joint: no weld, it only bears. With a
  mortar weld there the frame analysis saw the column cantilevered off whatever remained after a gob and cracked it up
  the shaft within a second (it telescoped or fell back over its hinge); standing free on a bed that only bears, the
  column tips over its hinge as one body and its joints feel only what the fall puts on them.
- Pedestal lift (3.3 m) with the capping course as one body; six shaft lifts of 58-59 courses (~4.4 m); the cap.
- Mortar welds between lifts (lime, 120 years, wet exposure).

## Behaviour (headless; see the commit message for the runs)

- Stands: settle 0 welds lost, 0 awake; Clearance 30 s idle 0/0.
- Gob felling (four 2.5 kg charges at 0.6 m: two on the west face, one on each side face 0.7 m west of the axis): the
  column leans over the east hinge as one body, breaks into sections just before and at impact and comes down as
  lift-sized chunks and loose brick in a narrow pile along the fall line, about 1 H long. It falls within ~20° of the
  notch's axis (it has drifted north in every run so far).
- Too small a gob (1 kg charges) leaves brickwork under the notch side: the column rocks and stands.
- A small blast inside the base (dev `boom`) loses a few joints and stands. Charges on all four faces blow the base
  course out: the column sits down 1.2 m onto its pedestal lift and stands, and later its upper third breaks off.

## Known gaps

- Square in plan (a round or octagonal shaft needs 8+ bodies a lift); flat faces, no entasis.
- The flue duct is solid brickwork (no passage), and the inlet behind it a plain opening without an arch.
- The 30 mm open joint on the DPC shows close up as a dark line; above it the chimney is a welded cluster with no weld
  path to the ground, standing on contact by design.
- No firebrick lining; the pedestal's interior is open to the flue.
- Wall set-offs follow the rule of thumb of half a brick more for each 20 ft down, not a sourced figure.
- Blasted bricks and the light air terminal can skid or be thrown tens of metres past the pile.
- The fall lane in Clearance is ~25 m of open ground for a ~34 m pile (see above).
