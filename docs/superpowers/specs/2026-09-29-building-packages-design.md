# Building packages — design

Date: 2026-09-29 · Status: approved (approach A)

## Goal

Let several agents deeply edit or add buildings at the same time — including different parts of the same building —
without editing the same files. The project has no git (decided 2026-09-29), so file ownership is the only
isolation mechanism; the layout must make disjoint ownership the natural case.

## Problems today

- ~40 buildings live in three monoliths: `src/levels/structures.ts` (1954 lines), `buildings.ts`, and the landmark
  files in `src/levels/architecture/`.
- Registration is two hand-edited central lists: `PREFABS` in `src/levels/prefabs.ts` and `LANDMARKS` in
  `src/levels/architecture/index.ts`.
- Each building is one function; its nave, spire and roof cannot have different owners.
- `scripts/validate-levels.ts` validates everything at once; there is no per-building check or settle test.
- Shared helpers (`kit.ts`, `layers.ts`, `facade.ts`, `interior.ts`, `services.ts`) are edited by everyone.

## Design

### 1. Package layout

```
src/buildings/
  assemble.ts            shared: BuildingDef/PartDef/Frame types, assemble(), part tagging
  registry.gen.ts        generated — never hand-edited
  <id>/
    def.ts               export default BuildingDef
    frame.ts             datums: levels, grid lines, footprint, bearings
    parts/<part>.ts      one sub-assembly per file
    lib.ts               optional package-local helpers
    SPEC.md              real-world reference, structural system, load path, budget, known gaps
    baseline/<variant>/<part>.json  per-part piece count, mass, fingerprint (one file per part, so part owners never share a file)
    CLAIM                optional ownership marker
```

Package ids are kebab-case and equal the folder name.

### 2. Types and assembly (`src/buildings/assemble.ts`)

```ts
export interface Bearing { y: number; x: Range; z: Range }          // a horizontal surface in local metres
export interface Frame {
  levels: Record<string, number>;                                    // named heights, e.g. eaves, floor1
  grid: { x: Record<string, number>; z: Record<string, number> };    // named grid lines
  footprint: { x: Range; z: Range };
  bearings: Record<string, Bearing>;                                 // named surfaces one part provides for another
}
export interface PartDef<P> {
  id: string;
  budget: number;                          // max simulated pieces
  provides?: string[];                     // bearing names this part must physically occupy
  needs?: string[];                        // bearing names this part rests on
  build(f: Frame, p: P): PieceSpec[];      // local metres, front facing +Z, origin at footprint centre
}
export interface BuildingDef<P = {}> {
  id: string; name: string; category: PrefabView['category'];
  group: string;                           // default group tag
  age?: AgeSpec;
  defaults: P;
  variants?: { id: string; name: string; params: Partial<P> }[];
  frame(p: P): Frame;
  parts: PartDef<P>[];
}
export function assemble<P>(def: BuildingDef<P>, placement: Placement & Partial<P>): PieceSpec[];
```

`assemble` merges `defaults` with the placement's params, builds the frame, runs each part in order, tags every
piece with `part: '<buildingId>/<partId>'` (new optional `PieceSpec.part` field, diagnostics only — ignored by the
physics), then applies the existing `finish` pipeline (`envelopeFinish` → `place` → `tag` group/age → `gridFeed`).
Output is the same `PieceSpec[]` the game consumes today; nothing downstream changes.

### 3. Registry

`scripts/gen-buildings.ts` scans `src/buildings/*/def.ts` in sorted order and writes `registry.gen.ts`:
`BUILDINGS: Record<string, BuildingDef<any>>` plus a flat `BUILDING_VARIANTS` list (base + variants) for the palette.
Output is deterministic, so concurrent regeneration by two agents produces the same file.
`prefabs.ts` and `architecture/index.ts` derive their entries from the registry instead of hand lists; maps and
contracts call `building(id, placement)` (or keep calling the old function names during migration, see §6).
`npm run buildings` runs the generator; `npm run build` runs it first.

### 4. Per-building check

`node scripts/check-building.ts <id> [--variant v] [--settle] [--update]`:

- Overlap / floating / anchoring checks from `src/levels/validate.ts`, scoped to this building, errors reported
  by part.
- Per-part piece count against `budget`.
- Bearings: for every `needs`, some piece of a part that `provides` it must touch that surface (within weld
  tolerance); every `provides` must actually be occupied.
- Baseline diff against `baseline/<variant>/<part>.json`: piece count, total mass and an order-independent fingerprint
  (rounded mat/shape/size/pos/rot). Unchanged parts must match. `--update --part <p> --agent <a>` rewrites only that
  part's files and is refused unless the CLAIM names that agent and covers the part. `--part` also scopes budget,
  validation and bearing errors to that part (other parts' problems are warnings).
- Only the target building's `def.ts` is imported; registry integrity is checked per folder in isolation, so a broken
  package cannot crash other packages' checks.
- `--settle`: 30 s headless settle via `scripts/sim.mjs`; fails on any weld lost, body runaway, or body still awake.

`assemble` sorts `finish`-pipeline pieces into a canonical order (local coordinates, fingerprint key) before `finish`,
so reorganising code between parts cannot change simulation outcomes. (Revised 2026-09-29 after the final review.)

Exit code 0 only when all checks pass. `validate-levels.ts` keeps validating whole maps.

### 5. Ownership and shared code rules

- A `CLAIM` file (`agent`, `task`, `parts: all | [ids]`, `since`) marks what an agent owns. `check-building` and
  `gen-buildings` print active claims. Agent briefs say: edit only claimed packages/parts; never edit another
  package.
- Shared helper files (`kit.ts`, `layers.ts`, `facade.ts`, `interior.ts`, `services.ts`,
  `architecture/common.ts`) are additive-only during parallel work. New helpers start in the package's `lib.ts`;
  promotion to a shared file is a separate single-owner task.
- `frame.ts` is owned by whoever owns the package as a whole; part owners request datum changes through the
  package owner (or via SPEC.md notes when working alone).

### 6. Migration

1. Before moving anything, record a fingerprint of every current prefab and map (`scripts/fingerprint-levels.ts`,
   output to the scratchpad).
2. Move each building function from `structures.ts`, `buildings.ts` and `architecture/*.ts` into its own package as
   a single part `main` with a minimal frame (footprint only). Local helpers used by one building move with it;
   helpers used by several go to `src/buildings/_shared/` (e.g. the `put`, `boiler`, `radiator`, `TINT`, `rng`
   helpers in structures.ts).
3. `structures.ts`, `buildings.ts` and `architecture/index.ts` become thin re-export shims so maps, contracts and
   other importers keep working unchanged.
4. Re-fingerprint: every prefab and map must be identical to step 1 (only the added `part` tag may differ; the
   fingerprint excludes it).
5. Split `cathedral` and `station` into real parts with frames and bearings as the worked examples, with
   `check-building --settle` passing and the r=3 pier-blast behaviour unchanged.

Out of scope: machines (`machines.ts`), plant, grid and electrical networks, maps' own layout code.

### 7. Scheduling

Starts after the campaign-expansion agent finishes (it edits `prefabs.ts` and maps). Can run alongside the
collapse-engine agent, which owns only destruction/physics/sim files. One agent does steps 1–4 (mechanical,
one owner of the monoliths); step 5 is two agents in parallel — one per landmark — as the first real test of the
workflow.

## Success criteria

- Two agents can each claim a different part of the same building, edit only their own files, and both pass
  `check-building`.
- Adding a building = create a folder + run `npm run buildings`; no hand edit of any shared file.
- All prefabs and maps fingerprint-identical after migration; `tsc`, `validate-levels`, `validate-grid`,
  `validate-rigging` pass.
