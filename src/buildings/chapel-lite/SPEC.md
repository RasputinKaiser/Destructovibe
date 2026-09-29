# Parish chapel

Victorian nonconformist chapel, gable front (west door) toward -X: 13 × 7.2 m single-cell nave in 500 mm walls of
squared rubble (`rubble` in `lib.ts`: shared courses round the building with a dressed plinth and a sill-level string
course, stones in 12 brown and grey tones, each drawn as an 11 mm face skin (flat, crumbles to dust) over the stone
body (so the engine's stone arris chamfer stays out of sight), snecks, lime joints raked back, pale ashlar quoins and returns, dressed jambs, sills,
voussoir rings struck from the two arc centres at the pointed heads with rubble spandrels, a rubble core, limewashed plaster inside). Three lancets a side, two in the
west front and a wide lancet in the east gable (leaded lights: lead cames and a centre came as detail). 43° slate roof
(rafters, felt, battens, grey-blue slates as stone detail, one slab per slope) on four oak king-post trusses whose tie beams span the nave on the wall
heads; fascias with cast-iron gutters, downpipes. A coped west parapet gable carrying a bellcote with its bell; a
gabled stone porch with a pointed open archway over the boarded west door. Inside: pews on timber platforms, the
communion table before a raised panelled pulpit on its dais, the consumer unit on the north wall with its supply
sleeved through a plain dressed through-stone (so the service entry cuts no walling), two nave lights off a cable along
the north wall head. Pointed openings: `archWall` (heads are one body: the voussoir ring, keystone and the spandrel
stones fanned to the head's corners). Footprint frame only.

How it comes apart (critic loop round 4):
- The side and east walls break at the sill string course (`lift: 1.5`). Below it they are laid in bays between the
  window centres; above it they are piers and heads.
- The gables are `gableBlocks`: lifts on course lines, each split into columns across open 12 mm joints, so a block
  that loses its support drops instead of hanging off its neighbours.
- The west wall keeps full-height piers: blasted at the door, that collapsed sooner than a lift.
- The roof is two bays a slope, jointed over the truss at x = -1.7, and kept 10 mm clear of the parapet.
- Every piece is aged 150 years (lime joints leached to about 0.6 strength).
- Face stones are an 11 mm hull skin (the 'drywall' texture, tinted per stone) over a stone body, with a lumped
  hearting core behind. Stone lengths come from five sizes, fitted per course, so the skins stay a few hundred draw
  kinds.

Known gaps:
- The spire and its lightning protection went with the tower (a chapel of this size has a bellcote).
- No hood moulds or buttresses (the envelope cannot project), no gallery.
- Window reveals and the gable above the tie beam are bare stone.
- The block columns of the gables show as straight perpends.
- Engine-side (critic accepted): stone arris chamfer on every stone body (hook 3); member bending (1); dust look (5,
  E8); unit accounting (6); brown ambient ground term (7).
- Also engine-side, found this round:
  - E9: a blast-shattered panel releases its stones in place at about 1 m/s, and the heap props what stood on it, so
    in-game the west gable can stand on its own rubble past 8 s.
  - E10: the detail LOD viewer is the player's position, not the render camera, and the 250 k instance cap drops the
    farthest sets first: seen from 30–40 m in a dense site, the chapel can fall back to its plain envelopes.
