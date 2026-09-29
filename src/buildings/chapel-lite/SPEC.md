# Parish chapel

Victorian nonconformist chapel, gable front (west door) toward -X: 13 × 7.2 m single-cell nave in 500 mm walls of
random-coursed rubble (`rubble` in `lib.ts`): shared courses round the building with a dressed plinth and a sill-level
string course; face stones of varied size (one to three faces on each stone body, snecks) and 12 brown, ochre and grey
tones, set in a lime mortar bed that shows between them; pale dressed quoins and returns, dressed jambs with dressed
reveals outside and limewashed splays inside, dressed sills, dressed soffits on the arch rings, voussoir rings struck from the two arc centres at the
pointed heads with rubble spandrels, a hearting core, limewashed plaster inside. Three lancets a side, two in the west
front and a wide lancet in the east gable (leaded lights: lead cames and a centre came as detail). 43° slate roof
(rafters, felt, battens, grey-blue slates as stone detail, each course closed to the bay's end with a cut slate), two
bays a slope, on four king-post trusses whose tie beams span the nave on the wall heads; fascias with cast-iron
gutters, downpipes. A west parapet gable with dressed verge stones, carrying a bellcote with its bell; a gabled stone
porch with a pointed open archway over the boarded west door. Inside: pews (raked backs, book ledges, shaped bench
ends) on one timber platform, the communion table, a raised panelled pulpit with its stair and handrail on the north
side of the dais (clear of the east window), limewashed gables above the tie beams, the consumer unit on the north
wall with its supply sleeved through a dressed through-stone (so the service entry cuts no walling), two nave lights
off a cable along the north wall head. Pointed openings: `archWall` (heads are one body: the voussoir ring, keystone
and the spandrel stones fanned to the head's corners). Footprint frame only.

How it comes apart:
- The side and east walls break at the sill string course (`lift: 1.5`). Below it they are laid in bays between the
  window centres; above it they are piers and heads.
- The gables are `gableBlocks`: lifts on course lines, each split into columns across open 12 mm joints, so a block
  that loses its support drops instead of hanging off its neighbours.
- The west wall keeps full-height piers: blasted at the door, that collapsed sooner than a lift.
- The roof is two bays a slope, jointed over the truss at x = -1.7, and kept 10 mm clear of the parapet.
- Every piece is aged 150 years (lime joints leached to about 0.6 strength).
- What flies: face-stone bodies 0.42-0.7 m long (a few split into two small stones), hearting lumps 0.55-1.0 m long
  and two courses high, dressed quoins, jambs and verge stones. The faces (6 mm skins), mortar bed, reveals and plaster
  are cosmetic and go to dust. One standard blast at the west door leaves 1230-1310 unit bodies headless
  (round 4: 1552).
- Face skins are convex hulls of irregular outline from short size lists, never boxes (a thin box unit draws as one
  stretched unit cube, which streaked the stone texture); a wall draws as a few hundred skin shapes.

Known gaps:
- No hood moulds or buttresses (the envelope cannot project), no gallery.
- The window heads' inner (nave) faces and the bellcote are bare stone bodies (the engine's stone texture and arris
  chamfer); the ring stones' soffits have dressed skins, drawn in 8 mm at each joint.
- The block columns of the gables show as straight perpends.
- The mortar bed is a thin box per course, so the plaster texture on it is stretched along the course (it reads as a
  faint grain in the joints at arm's length).
- The east window's glass is clear (no tinted translucent glass for cathedral quarries).
- Rubble is clean cuboid bodies with no fines: the shape of a stone is the engine's fracture (the package only sets
  the size spread, now small stones to two-course lumps).
- Rafters and battens are thrown whole (a 50 × 150 rafter is a single unit; timber splintering is engine-side).
- Engine-side (critic accepted): stone arris chamfer on every stone body (hook 3); member bending (1); dust look (5,
  E8); unit accounting (6); brown ambient ground term (7).
- Also engine-side:
  - E9: a blast-shattered panel releases its stones in place at about 1 m/s, and the heap props what stood on it, so
    in-game the west gable can stand on its own rubble past 8 s.
  - E10: the detail LOD viewer is the player's position, and the 250 k instance cap switches a building between its
    detail and its plain envelopes by viewer distance. That changes the physics, not only the look: seen from 30-40 m
    the chapel collapses on the envelope path, seen from near it stands longer on the detail path. The headless
    harness reproduces the collapsing outcome, not the one a player standing near sees, so it cannot certify X2.
  - Debris budget: the site shares one debris budget; a chapel blast's bodies left uncleared starve later blasts (the
    press shop barely moved after one in round 4). The chapel's share is cut by 15-20 %; the budget is the engine's.
