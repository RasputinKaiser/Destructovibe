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

- **Contracts** — campaign with demolition targets, par times, limited ordnance, star ratings,
  sequential unlocks. Progress in localStorage.
- **Free play** — everything unlimited, three sites:
  - *Clearance Zone*: a plumbed-in quarter (high street, terraces, works yard, construction site, canal
    cut) on one site grid — a substation, gas governor and pump hall feed every building by buried
    ducts, overhead lines and mains. Cut a feeder and a street goes dark; cut a live main and it burns.
  - *Downtown*: steel-frame skyscraper, offices, car park, flats, stadium stand and a substation.
  - *Heritage Yard*: chapel, mill, Victorian terrace, rotunda, arch bridge, boiler house, mill wheel.
  - `Tab` site panel (time scale, gravity, joint strength, wind, fire spread, debris limit, earthquake,
    freeze), `B` spawn any of ~90 buildings and machines, `Backspace` remove what you aim at.
  - Settings → *Sandbox explosives* turns the loose barrels / propane / TNT off.
- **Engineer's x-ray** (`X`) — joint stress, thermal, and building services (live/dead networks,
  breaks, running machines).

## Tools

Two banks of six (`Q` switches): sledgehammer, cannon, rocket launcher, charges, airstrike beacon,
thermite · linear cutting charge, wrecking ball, tow winch, gravity manipulator, firebomb, megabomb.

## Controls

`WASD` move · `Shift` sprint · `Space` jump · `1–6`/wheel tool · `Q` bank · `LMB` fire ·
`RMB`/`G` detonate · `X` x-ray · `Enter` call the contract early · `R` restart · `Esc` pause ·
free play: `F` fly · `Tab` panel · `B` spawn (`wheel` rotates, `RMB` cancels) · `Backspace` remove

## Layout

- `src/physics/` — Box3D bridge: world, entity registry, fixed step, events, queries
- `src/destruction/` — materials, convex polytopes + Voronoi fracture, joints / damage / heat /
  rebar / collapse, batched piece rendering
- `src/game/` — player controller, weapons, scoring
- `src/levels/` — building kit, structures, contracts, blueprint validator
- `src/render/` — renderer + post, procedural materials, VFX pools, viewmodels, rebar, x-ray, scenery
- `src/ui/`, `src/audio/` — DOM screens/HUD, procedural WebAudio
- `legacy/` — the v1 (Rapier) version, kept for reference

## Validation and CI

GitHub Actions runs the production build, the FX regression (`npm test`), and
four existing validators: `npm run validate:fractures`, `npm run validate:levels`,
`npm run validate:grid`, and `npm run validate:rigging`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Hosting

Serve the built `dist/` directory over HTTPS with these response headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

The Vite development and preview servers already set these headers. They enable
cross-origin isolation for the Box3D worker and SharedArrayBuffer. A static host
must support these headers; publishing the repository alone does not deploy the game.

## License

No project license has been selected yet. Dependencies retain their respective licenses.

## Current verification status

The initial GitHub snapshot builds successfully, and the fracture, level, grid,
and rigging validators pass. The level validator emits blueprint warnings.
The existing FX regression currently fails at `steel must not throw a masonry dust cloud`.
CI retains that assertion and will report the failure until it is addressed.
The production build also reports browser externalization warnings for Box3D's Node imports.
