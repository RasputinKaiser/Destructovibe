# Boiler-house chimney

Free-standing square brick chimney for a works boiler house. Local frame: shaft on Y, the flue (and the boiler house)
toward +X. Param `wall`: where the boiler house's wall stands, metres from the axis along +X (the flue duct runs to it).

In Clearance it stands at (52, -10), axis-aligned, at the east end of the works yard with its boiler house east of
it (the flue duct `wall` 4.0 m, to the house's west wall between its windows), on a mass-concrete pad (`foundationLocal`,
below grade, placed with `onFoundation`). Felled west it comes down the length of the works yard along z -10, a lane
kept clear of plant, and its top lands on Works Road: ~36 m of open ground (x 16-50 clear within ±4 m of the line)
for a ~34 m pile. The boiler house's gas service comes in from the High Street main at the house's south end, clear of
the gob charges. A turned chimney is not an option: a charge against a wall that is not square to the 1 m blast grid
is taken as confined (the pedestal's hollow becomes a "room" and its gas cracks the whole base), so it would fell
unpredictably.

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

## Behaviour

Gob: four 2.5 kg charges at 0.6 m (two on the west face, one on each side face 0.7 m west of the axis) and 1 kg on each
side face 0.1 m west of it, fired after the joints have calibrated (~15 s in; fired at 1 s the shaft's joints are still
unbreakable and it falls whole).
- Headless (`sim.mjs`-style, Clearance): leans over the east hinge as one body, 5° at 1.6 s, 45° at 4.1 s, cracks
  just above the base at ~20° and lands at 5.3 s due west; 95 % of the debris volume within 36 m of the base (1.1 H),
  lift-sized chunks and loose brick along the fall line.
- In the game (Browser pane, 20 fps): falls west as one body to ~8°, then breaks at about two-thirds height at 2.5 s
  and the top third jack-knifes back as the rest goes on (collapse/chimney-felling tell 1 and the Frankfurt sequence);
  down at ~5.5 s, chunks 7-30 m west. The game and the harness diverge (the engine's known E10 frame-slicing bug).
- Too small a gob (1 kg side charges only, or side charges 1 m west of the axis) leaves brickwork under the notch
  side: the column rocks and stands. Side charges on the axis at 2.5 kg take the hinge too and it telescopes.
- A small blast inside the base (dev `boom`) loses a few joints and stands. 2.5 kg on all four faces blows the base
  course out: the column sits down 1.2 m onto its pedestal lift and stands.

## Known gaps

- Square in plan (a round or octagonal shaft needs 8+ bodies a lift); flat faces, no entasis.
- The flue duct is solid brickwork (no passage), and the inlet behind it a plain opening without an arch.
- The 30 mm open joint on the DPC shows close up as a dark line; above it the chimney is a welded cluster with no weld
  path to the ground, standing on contact by design.
- No firebrick lining; the pedestal's interior is open to the flue.
- Wall set-offs follow the rule of thumb of half a brick more for each 20 ft down, not a sourced figure.
- Blasted bricks and the light air terminal can skid or be thrown tens of metres past the pile.
- In the game the column breaks at about mid-height during the fall and the top third lands short of the base's
  line and a few metres north of it (the engine's fall-direction drift); the lane is open ground either side.
