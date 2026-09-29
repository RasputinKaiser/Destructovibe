# Portal shed

Steel portal-frame shed (UK single-span practice), front +Z, frames across Z at the bay lines along X. Shared by the
works hall and the builders' merchant (`portalShed` in `parts/main.ts`, helpers in `lib.ts`); the palette entry wraps it
in the map's `put`. Footprint frame only; no datums.

- Frame: UB columns (one body each: flanges, web, base plate, web stiffeners at the haunch and rafter-top levels;
  bolted base). Each rafter is two bodies bolted at the haunch toe (the plastic-hinge point): the eaves segment (end
  plate bolted to the column's inner flange, cut-from-section haunch ~span/10 long, splice plate) and the main rafter
  (splice plate, UB, apex plate bolted to its partner). The gable frames carry half a bay and are unhaunched (the
  rafter at full depth to the column); a haunch's kinked soffit under the gable sheeting read as a curved rafter. End/splice plates are drawn 25 mm with bolts and nuts as detail.
- Roof: each bay and slope is two bodies, split between the purlins either side of the rafter splice, so the roof can
  fold with the frame instead of propping it as one plate. Detail: end-bay bracing, Z purlins on cleats, trapezoidal
  sheets (each 1 m sheet one body — its pan — with the crowns as cosmetic cap + web fins, painted, not textured) with
  a grey backing coat underneath drawn cool (it faces the warm ground bounce), and on the walls each band of backing
  coat faced outside in the sheet's own tone (a stripped sheet leaves strips of sheet, not pale stripes), pale opaque GRP roof-light sheets, ridge flashing, an eaves filler over each wall head, verge flashings.
- Walls: panels break at the frame lines; rails, eaves strut and end-bay cross-bracing inside; sheets two-tone outside
  with the grey backing coat inside, band flashing, corner trims; gable triangles with sheets cut to the roof line.
- Box gutters, aluminium downpipes, roller shutters (curtain of laths) with coil boxes (optional), steel personnel door.
- Load path: roof bodies bear on the rafter tops and the gable triangles; rafter segments bolt to each other and to
  the column inner flanges; columns on footings; cladding and gutters screwed on (6 × 5.5 mm per joint: the fixings are the weak link, so
  whole panels peel off instead of carrying the eaves across a lost column).

Known gaps:
- No ground-bearing slab (the site pad is the floor, the machines stand on it).
- Purlins are dormant detail (they tie frames only through the roof bodies they sit in).
- Sheets are painted with the clearcoat 'paint' finish and read glossy, near-mirror at grazing angles (the works gable
  sheets read as green glass in round 3). No matte untextured finish exists in the renderer: 'satin' and 'galv' are
  textured and stretch into grain on flat units (a thin box unit draws as one stretched unit cube). Needs a render-side
  matte paint finish.
- Roof lights are pale opaque sheets (no translucent material: engine hook 4).
- The roof liner is tinted cool against the renderer's brown ground term (hook 7).
- Torn sheets stay flat rigid plates (crumple: hook 2); frame members stay straight (bending: hook 1).
- Where a pan and its crowns go to dust, the backing bands behind straddling the struck region stay: they now show
  the sheet's tone outside, so a stripped bay reads as torn strips of sheet; the strips are still flat and straight
  (crumpling is hook 2). The roof keeps one film of the sheet's tone per sheet (seen stripped only from above).
- Dust look and the E8 box: a blast's dust around a shed draws as a translucent box with hard edges (the most visible
  defect of the works blast); engine-side.
