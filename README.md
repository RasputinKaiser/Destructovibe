# Destructovibe

First-person structural demolition. Three.js + [Box3D](https://github.com/erincatto/box3d)
(via [box3d.js](https://github.com/isaac-mason/box3d.js)) + [math](https://github.com/pmndrs/math),
TypeScript, Vite.

Requires **Node.js 22.18+** and npm.

```sh
npm ci
npm run dev        # http://localhost:5183
npm run build      # typecheck + production build → dist/
node scripts/validate-levels.ts   # check every blueprint for overlaps / floating pieces
```

## What's simulated

- **Structures are joined, not stacked.** Every blueprint piece (box, cylinder, n-gon prism, wedge
  or arbitrary convex hull) is a Box3D rigid body; touching faces are auto-welded. On load the site
  settles once and each joint's static load is measured in every mode, so buildings stand on their
  own but losing a support overloads the neighbours and the collapse propagates.
- **Joints have a real failure envelope.** Crushing and bending are Box3D thresholds; tension and
  Mohr–Coulomb shear (cohesion + μ·compression) are checked from the measured joint force. Masonry
  carries weight but opens in tension; only sustained or gross overload fails a joint.
- **25 materials from engineering properties** (E, compressive / tensile / shear strength, fracture
  energy, ductility, thermal behaviour): plain and reinforced concrete, brick, cinder block, stone,
  sandstone, marble, terracotta, adobe, plaster, drywall, pine, oak, plywood, structural steel,
  cast iron, aluminium, sheet metal, annealed and tempered glass, tiles, props and explosives.
- **Ductile vs brittle.** Steel and aluminium joints yield into plastic hinges — they sag and stay
  bent, strain-harden, and rupture only when their rotation capacity runs out. Reinforced concrete
  hinges yield with little reserve; once they rupture the fragments stay tied by **rebar** that
  stretches, dangles slabs and twangs when it snaps. Cast iron snaps clean.
- **Fracture by material.** Impact-seeded Voronoi cells from a face-list polyhedron clipper: timber
  snaps across the grain into jagged halves and splinters, annealed glass runs radial shards,
  tempered glass bursts into cubes, stone and cast iron break into a few clean pieces, drywall and
  adobe crumble to powder. Hard hits run on as cracks into bonded neighbours; damaged pieces darken.
- **Construction and services.** Buildings are built the way they are really built — stud walls,
  joists, rafters and trusses, pocketed brick, RC flat slabs with drop panels, steel I-sections with
  fin and end plates — with interiors, furniture, and working power, gas, water and steam networks.
  Machines (excavators, cranes, presses, conveyors, lifts, fans, turbines, vehicles) run on hinge and
  slider joints with electric (torque–speed curve, thermal trip), hydraulic (p·A, flow-limited,
  relief valve) or diesel drives, at real masses.
- **Heat.** Fire heats whatever touches it: timber ignites and chars through, explosives cook off,
  steel loses strength past ~400 °C (frames sag and come down), concrete spalls, glass cracks.
- Explosions damage by closest-point distance and cut joints in reach; blast momentum goes only to
  bodies nothing holds (pushing a welded island would unzip it in one step). Cannonballs and hammer
  blows knock sections loose.

## Game

- **Contracts** — eighteen jobs in four chapters (odd jobs, the Heritage Yard, the Railway Quarter,
  Downtown) with demolition targets, par times, limited ordnance, star ratings and sequential unlocks.
  Jobs on the big sites count only their target structure and may add conditions: protected
  neighbours, a footprint to bring it down inside (debris outside is fly-tipping), a hard time limit,
  or salvage to carry out first. Each chapter's loadouts are built round a family of tools: machining
  and hot works, wrecking ball, fire and water, wire saw and sequenced charges, excavator, thermite,
  gravity gun, megabomb. The par clock starts at your first move or shot; meeting the target does not
  end the job — keep going for score and sign off with `Enter` (it signs itself off once the ordnance
  is spent or the site goes quiet). A failed report says why and gives the foreman's tip. Progress in
  localStorage. Star thresholds are set per job. A structure that must come down whatever the
  percentage says (the Tall Order's chimney) holds the sign-off until it is on the ground.
- **Protected property** — damage is docked per structure, per incident: a building that goes on
  shedding pieces for a minute is one incident, not a toast per brick, and what it can cost is capped
  at its liability (30 % of the job's value, so the same currency on a shed and a tower block). Broken
  windows from a blast wave are a ding; past 4 % of a structure hurt the job can earn ★★ at most, past
  15 % (wrecked) ★.
- **Free play** — everything unlimited, four sites:
  - *Clearance Zone*: a plumbed-in quarter (high street, terraces, works yard, construction site, canal
    cut) on one site grid — a substation, gas governor and pump hall feed every building by buried
    ducts, overhead lines and mains. Cut a feeder and a street goes dark; cut a live main and it burns.
  - *Downtown*: steel-frame skyscraper, offices, car park, flats, stadium stand and a substation.
  - *Heritage Yard*: chapel, mill, Victorian terrace, rotunda, arch bridge, boiler house, mill wheel.
  - *Railway Quarter*: the Victorian terminus, the cotton mill with its 60 m chimney, the football
    ground and the riveted road bridge over a walled river bed, with cottages, sidings and a
    substation feeding the street lights.
  - `Tab` site panel (time scale, gravity, joint strength, wind, fire spread, debris limit, earthquake,
    freeze), `B` spawn any of ~90 buildings and machines, `Backspace` remove what you aim at.
  - Settings → *Sandbox explosives* turns the loose barrels / propane / TNT off.
- **Engineer's x-ray** (`X`) — joint stress, thermal, and building services (live/dead networks,
  breaks, running machines).

## Tools

Banks of six (`Q` cycles them; `1–6` pick within the bank shown on the hotbar; the wheel steps through
every issued tool and the hotbar follows it to its bank):

- **I** sledgehammer, hand cannon, rocket launcher, remote charges, airstrike marker, thermite
- **II** cutting charge, wrecking ball, tow winch, gravity gun, firebomb, megabomb
- **III** disc cutter, chainsaw, drill rig, hydraulic shears, plasma cutter, oxy-fuel torch
- **IV** detonator panel, excavator remote, hydraulic breaker, water cannon, rock splitter, diamond wire saw
- **V** grapple launcher, rigging lines, lever hoist
- **VI** flamethrower, grenade launcher, recoilless rifle, thermobaric rocket, bunker buster, satchel charge

Bank VI, the ordnance and fire kit, runs on real numbers:

- **Flamethrower** (M2-2): 15 L of thickened fuel, ~1.8 L/s, ~8 s of trigger per pack. The stream is a rope of burning
  gel that sags ~15 m flat and reaches ~37 m at the best elevation; it splashes, clings to walls and ceilings and runs
  down into pools that burn at the fuel's own rate (0.04 kg/m²·s, sooty black smoke) for tens of seconds. What the
  flame touches heats through its own skin: timber catches in seconds, masonry spalls, steel warms slowly. `RMB`
  closes the igniter for a wet shot (soak it, then light it); a spare pack takes 6 s to put on.
- **Grenade launcher** (40 mm): 76 m/s lob with the arc shown, arms after 18 m (a dud inside that), 32 g of Comp B
  and 300 fragments: breaks glass and pocks walls, does not breach them. `RMB`/wheel: impact or programmed airburst.
- **Recoilless rifle** (84 mm HEAT, 255 m/s): the jet perforates ~0.4 m of steel, ~0.7 m of concrete, ~0.8 m of brick
  and leaves a narrow hole with spall thrown into the space behind; a breach takes several rounds. Keep 5 m clear
  behind; fired from a small or closed room the backblast fills it.
- **Thermobaric rocket** (93 mm): 2.1 kg of fuel thrown out as a cloud into the gas field and lit 0.12 s later
  (~5.5 kg TNT-equivalent). Put it through a window: a room holds the cloud and its walls are pushed out.
- **Bunker buster**: lase a spot; 4 s later a 129 kg penetrator comes down at ~260 m/s, punches through slabs by the
  Young/Sandia depth equation and fires 21 kg TNT-eq in the Nth void it counts (wheel: 0-4 floors).
- **Satchel charge**: 9.1 kg of C-4, pressed on within 4 m or thrown to lie where it lands; fired with `G` or from
  the Detonator Panel with the other devices and their delays.

The hand cannon's ball penetrates by the modified NDRC formula (a 30 kg ball at 62 m/s goes through ~20 cm of brick,
scabs the back of walls up to ~0.5 m and craters thicker ones; it glances off below ~33°); the rocket's backblast
knocks the firer down off a wall right behind him.

**Rigging.** Every line — the tow winch's, a rigging line, the hoist's chain, the grapple's — is a tension-only
spring of its own stiffness (EA/L) that knows its breaking load: it hangs in a catenary when slack, straightens under
load, frays near its break, and when it parts the stored energy U = T²L/2EA throws both halves back past their
anchors (stand out of line with a loaded line; the HUD says when you are in its snap-back zone). A line is made fast
round what it pulls, never to a bare face: a choker round a column or beam, a timber needle through a wall with a
bearing plate on the far face (it spreads the pull over the bricks behind the plate), a sling round a block, a welded
lug on steel; nothing goes round anything wider than 3 m. Ground anchors have a holding power — a 3-2-1 picket
holdfast ~18 kN, the winch's buried log deadman ~120 kN — and plough out past it, throwing the line toward whatever
pulled it. While a rigging tool is in hand each line shows a numbered tag with its tension and share of its working
load, and the tool readout has a matching bar per line (full scale its break, a tick at its WLL; amber past the WLL,
red past 60 % of the break). Any cutting tool held on a line cuts it — a loaded one parts before the cut is through.

- **Grapple launcher** — `LMB` throws a four-tine grapnel on 60 m of 10 mm HMPE line (34 m/s). It bites round a
  post, beam or exposed rebar, over an edge the line runs back across (a parapet, sill, slab lip), or drags back
  across a flat top until it catches the edge; a sheer face gives no purchase. Hold `LMB` to reel (2.45 kN, 1.1 m/s,
  a powered ascender's drive): what is loose and light comes to you, what holds hauls you to it — off your feet, into
  a swing, up to the ledge (`Space` at the top climbs on). `Wheel` pays line out or takes it in a metre (lower
  yourself). `RMB` makes the line fast to the vehicle you aim at or a ground anchor at your feet (hanging in the air:
  let go). The hook tears out of an edge past what the edge bears (one tine ~8.9 kN on steel, less on masonry) and
  skids off if the pull swings away from the edge; round a member it holds while the pull is within ~20° of square to
  it, and slides along it to the next stop otherwise. The reel's 2.6 kN slip clutch pays line out rather than take
  more: a load falling away, or you falling onto the line, is arrested at that.
- **Rigging lines** — `LMB` one end, `LMB` the other: members, a vehicle's chassis, or a ground anchor. `Wheel`
  picks 16 mm wire rope (179 kN), 22 mm nylon kinetic rope (127 kN, stretches up to 30 % and gives a run-up back as a
  snatch) or 13 mm G80 chain (212 kN, no stretch, heavy). Several lines from the top of a wall to one truck and a drive
  away is the classic pull-down (put the truck at least twice the wall's height off). `RMB` lets go of a half-made
  line, or casts off the slack line under the crosshair (a loaded one must be slackened or cut). Eight lines.
- **Lever hoist** — a 3.2 t lever hoist on 10 mm G80 chain: `LMB` the load, `LMB` where it hangs, then stand at it
  and hold `LMB` to work the lever: 6 mm of chain a stroke, 363 N on the handle at the rated load, and past ~1.4 × that
  you can't move it. `Wheel` selects PULL / LOWER / FREE chain (free runs slack through by hand, no load only). `RMB`
  takes it down (not under load).
- **Tow winch** — an 18,000 lb hydraulic winch on 13 mm wire rope (80 kN, 7 m/min, the speed held to the rated pull);
  `Wheel` reeves 1–3 parts of line through snatch blocks; `LMB` on a vehicle makes the newest line fast to it. The
  winch is set down on a log deadman 8 m to your side, out of the line of pull; its pull falls off by drum layer
  (100 / 83 / 71 / 62 %) and 5 % per sheave.

Every blow and shot reads back: heavy hits land with a beat of hitstop and a jolt through the tool in hand, blows
that break nothing leave a strike mark on the face (cracks on masonry and glass, a scuff on metal, a bruise on
timber) that grows toward the chip, thrown and fired ordnance shows its arc plus a wire sphere of what the blast
will reach, and armed charges and cutters carry their firing order and delay (`#1 · 0 ms`) over them, counting
down once the sequence is fired. Launchers show their reload on the tool readout, which sits over the hotbar,
fades once read, and for the cannon and rockets says what the arc comes down on (`on target: steel at 12 m`).
The sledge puts ~390 J into a full swing: glass goes at a tap, a board or a brick in a lime-mortared wall
after a blow or two; the blow that breaks a member knocks out the units round the head.

**Bullet time** (`T`) runs the world at 0.3×. **Collapse replay** (`V`) freezes the site and plays the last ~12 s
back (every piece that moved, fragments riding their parent member until it broke, blasts re-fired) with a free
orbit camera: mouse orbits, wheel zooms, `WASD`/`Q``E` move the focus, `Space` pauses, `1`/`2`/`3` pick
0.25/0.5/1×, `←`/`→` scrub a second, `R` rewinds, `V` returns to play with everything where it was.

## Controls

`WASD` move · `Shift` sprint · `Space` jump, or climb what is in front (a ledge up to ~1.25 m; walking into
anything knee-high scrambles over it; fast at a low wall it is a vault) · `C`/`Ctrl` crouch · `Alt` careful: slow
walk, and with `A`/`D` lean round a corner · `Z`/`MMB` zoom (hold) · `1–6` tool in bank · `Q` next bank (I–VI) ·
`Wheel` tool setting (charge size, delay, boom, line…) where the tool has one, else next tool · `Shift`+`Wheel` detonator
delay · `LMB` fire / use · `RMB` tool's second action, else detonate · `G` detonate · `E` drive / operate / get out ·
`U` work a breaker, valve or meter · `X` x-ray · `T` bullet time · `V` collapse replay · `P` back to spawn ·
`Enter` call the contract early ·
`R` restart · `Esc` pause ·
bank VI: `RMB` flamethrower igniter / grenade fuze · `Wheel` airburst range / bunker-buster floor count ·
free play: `F` fly · `Tab` panel · `B` spawn (`wheel` rotates, `RMB` cancels) · `Backspace` remove

Every key above can be rebound under Settings → Controls (a key another action had is swapped over). A standard
gamepad works once the mouse is captured: sticks move and look, `A` jump/climb, `B` crouch, `X` drive, `Y`
detonate, `RT`/`LT` fire/second action, `LB`/`RB` tools, `L3` sprint, `R3` zoom, `Start` pause.

On foot the body has weight: a jog builds in ~0.2 s and a sprint in ~0.6 s, a standing jump lifts 0.48 m for
about half a second in the air, and landings cost pace (bunny-hopping bleeds speed; jumps cost stamina). Falls are
graded by the height fallen — a dip, a hard landing, a stumble from ~2.5 m, a knockdown and a limp from ~4.5 m, and
past ~9 m a blackout and respawn — and heavy falling members knock the player down rather than throwing him.
*Impacts* in Settings sets how far that goes (off / stumble / real); head bob, toggle crouch and toggle sprint are
there too.

Settings also carry render scale (*Auto* holds 60 fps by trading resolution, then the distance at which walls
draw as individual bricks), camera shake (off also drops the lens punch and softens the aim kick), film grain and
chromatic aberration.

## Layout

- `src/physics/` — Box3D bridge: world, entity registry, fixed step, events, queries
- `src/destruction/` — materials, convex polytopes + Voronoi fracture, joints / damage / heat /
  rebar / collapse, batched piece rendering
- `src/game/` — player controller, weapons, scoring
- `src/levels/` — building kit, structures, contracts, blueprint validator
- `src/render/` — renderer + post, procedural materials, VFX pools, viewmodels, rebar, x-ray, scenery
- `src/ui/`, `src/audio/` — DOM screens/HUD, procedural WebAudio
- `legacy/` — the v1 (Rapier) version, kept for reference
