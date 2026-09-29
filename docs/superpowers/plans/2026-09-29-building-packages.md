# Building Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every building into a self-contained package (`src/buildings/<id>/`) made of independently owned parts, so several agents can deepen or add buildings in parallel without touching the same files.

**Architecture:** A shared `assemble()` turns a `BuildingDef` (frame of named datums + ordered parts) into the same `PieceSpec[]` the game already consumes. A generator writes a deterministic registry from the package folders; a per-building checker validates geometry, budgets, bearings, a per-part baseline and an optional headless settle. Existing functions become thin shims so maps and contracts are untouched.

**Tech Stack:** TypeScript (tsc 6, `.ts` imports), Node 22 type-stripping for scripts, `node --test`, Vite SSR for the headless physics harness, Box3D.

Spec: `docs/superpowers/specs/2026-09-29-building-packages-design.md`.

## Global Constraints

- Project root: the repository root (at the time, an iCloud folder whose path contains spaces — quote paths). No git: there are no commit steps; each task ends with a verification step instead. Snapshot before large moves: `tar` to `~/Destructovibe-snapshots/`.
- Migration is behaviour-preserving: every prefab and landmark fingerprint must be identical before/after (the new `part` field is excluded from the fingerprint).
- Imports use explicit `.ts` extensions (existing convention). Scripts start with `declare const process: …` like `scripts/validate-levels.ts` when they need `process`.
- Never hand-edit `src/buildings/registry.gen.ts`.
- Shared helper files (`src/levels/kit.ts`, `layers.ts`, `facade.ts`, `interior.ts`, `services.ts`, `architecture/common.ts`) are additive-only.
- Out of scope: `machines.ts`, `plant.ts`, `grid.ts`, `electrical.ts`, `rigging.ts`, map layout code.
- Files owned by other concurrent agents must not be edited: `src/destruction/*`, `src/physics/*`, `src/sim/*`, `src/terrain/*`, `src/render/*`, `tests/fx-impact.mjs`. `src/levels/prefabs.ts`, `src/levels/contracts.ts`, `src/levels/maps/*` are off-limits until the lead says the campaign agent has finished (Task 6 gate).
- Verification per task: `npx tsc --noEmit` exit 0, plus the task's own checks. Judge by exit code or grep of pass/fail lines, never by `tail`.

## File Structure

| File | Responsibility |
|---|---|
| `src/buildings/assemble.ts` | `Bearing`, `Frame`, `PartDef`, `BuildingDef` types; `assemble()`; `footprintFrame()` helper |
| `src/buildings/registry.gen.ts` | generated: `BUILDINGS`, `BUILDING_VARIANTS`, `building()` |
| `src/buildings/_shared/*.ts` | helpers used by several migrated buildings (moved out of `structures.ts`) |
| `src/buildings/<id>/def.ts` | default-exported `BuildingDef` |
| `src/buildings/<id>/frame.ts` | frame datums (Task 7 packages; migrated ones inline a footprint frame in def.ts) |
| `src/buildings/<id>/parts/*.ts` | one part per file |
| `src/buildings/<id>/SPEC.md`, `baseline.json`, `CLAIM` | docs, per-part baseline, ownership |
| `scripts/fingerprint-levels.ts` | fingerprint every prefab + landmark variant → JSON |
| `scripts/gen-buildings.ts` | writes registry.gen.ts |
| `scripts/check-building.ts` | per-building checks |
| `scripts/sim.mjs` | headless physics harness (promoted from the audit scratchpad) |
| `tests/buildings.test.ts` | node --test unit tests for assemble / fingerprint / bearings |
| `src/types.ts` | add optional `part?: string` to `PieceSpec` |

---

### Task 1: Fingerprint baseline

**Files:**
- Create: `scripts/fingerprint-levels.ts`, `src/buildings/fingerprint.ts`
- Test: `tests/buildings.test.ts`

**Interfaces:**
- Produces: `fingerprint(ps: PieceSpec[]): { pieces: number; mass: number; hash: string }` in `src/buildings/fingerprint.ts` (order-independent, excludes `part`); CLI `node scripts/fingerprint-levels.ts <out.json>` writing `{ [prefabId]: {pieces, mass, hash} }` for every `PREFABS` entry plus `landmark:<id>` for every `LANDMARKS` entry.

- [ ] **Step 1: Write the failing test** (`tests/buildings.test.ts`)

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../src/buildings/fingerprint.ts';
import type { PieceSpec } from '../src/types.ts';

const a: PieceSpec = { mat: 'brick', size: [1, 1, 0.2], pos: [0, 0.5, 0] } as PieceSpec;
const b: PieceSpec = { mat: 'oak', size: [2, 0.1, 0.1], pos: [0, 1.05, 0] } as PieceSpec;

test('fingerprint is order-independent and ignores part tags', () => {
  const f1 = fingerprint([a, b]);
  const f2 = fingerprint([{ ...b, part: 'x/roof' }, { ...a, part: 'x/walls' }]);
  assert.equal(f1.hash, f2.hash);
  assert.equal(f1.pieces, 2);
});

test('fingerprint changes when geometry changes', () => {
  assert.notEqual(fingerprint([a, b]).hash, fingerprint([a, { ...b, pos: [0, 1.1, 0] }]).hash);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/buildings.test.ts; echo EXIT=$?`
Expected: FAIL (cannot find module `fingerprint.ts`), `EXIT=1`.

- [ ] **Step 3: Implement** `src/buildings/fingerprint.ts`

```ts
import type { PieceSpec } from '../types.ts';
import { MATS } from '../destruction/materials.ts';
import { pieceSolid } from '../levels/validate.ts';

const r = (v: number) => Math.round(v * 1000);

/* Canonical form of a piece, recursive into detail, with the diagnostic `part` tag removed. */
function canon(p: PieceSpec): unknown {
  const { part: _part, detail, ...rest } = p as PieceSpec & { part?: string };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(rest).sort()) {
    const v = (rest as Record<string, unknown>)[k];
    out[k] = typeof v === 'number' ? r(v) : Array.isArray(v) ? JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? r(x) : x))) : v;
  }
  if (detail) out.detail = detail.map((d) => JSON.stringify(canon(d))).sort();
  return out;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function fingerprint(ps: PieceSpec[]): { pieces: number; mass: number; hash: string } {
  const lines = ps.map((p) => JSON.stringify(canon(p))).sort();
  let mass = 0;
  for (const p of ps) mass += (MATS[p.mat]?.density ?? 0) * pieceSolid(p).volume;
  return { pieces: ps.length, mass: Math.round(mass), hash: fnv(lines.join('\n')) };
}
```

If `pieceSolid(p)` has no `volume` field, read `src/levels/validate.ts:115-220` and use the field it exposes for volume (or `size[0]*size[1]*size[2]` for boxes); keep the exported signature unchanged. Add `part?: string` to `PieceSpec` in `src/types.ts` (after `protected`), doc comment: `/** diagnostics only: '<building>/<part>' that authored this piece (building packages); ignored by physics */`.

- [ ] **Step 4: Run tests**

Run: `node --test tests/buildings.test.ts; echo EXIT=$?` → both pass, `EXIT=0`. `npx tsc --noEmit; echo EXIT=$?` → `EXIT=0`.

- [ ] **Step 5: Baseline CLI** `scripts/fingerprint-levels.ts`

```ts
import { writeFileSync } from 'node:fs';
import { PREFABS } from '../src/levels/prefabs.ts';
import { LANDMARKS } from '../src/levels/architecture/index.ts';
import { fingerprint } from '../src/buildings/fingerprint.ts';

declare const process: { argv: string[]; exit(code: number): never };
const out = process.argv[2];
if (!out) { console.error('usage: node scripts/fingerprint-levels.ts <out.json>'); process.exit(2); }
const res: Record<string, ReturnType<typeof fingerprint>> = {};
for (const p of PREFABS) res[p.id] = fingerprint(p.build(0, 0, 0));
for (const l of LANDMARKS) res[`landmark:${l.id}`] = fingerprint(l.make({ x: 0, z: 0 }));
writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`fingerprinted ${Object.keys(res).length} builds -> ${out}`);
```

Run: `node scripts/fingerprint-levels.ts "<scratchpad>/fp-before.json"; echo EXIT=$?` → `EXIT=0`, count ≥ 120. Run it twice and `cmp` the outputs → identical (determinism).

Also add `scripts/compare-fingerprints.ts <before.json> <after.json>`: prints each id whose `hash`/`pieces`/`mass` differs and each id missing from `after`; exits 1 if any id present in both differs or any `before` id is missing from `after`, else 0.

---

### Task 2: `assemble()` and package types

**Files:**
- Create: `src/buildings/assemble.ts`
- Test: `tests/buildings.test.ts` (append)

**Interfaces:**
- Consumes: `finish(ps, p, group, age)` from `src/levels/architecture/common.ts` (envelopeFinish → place → tag → gridFeed); `Placement` from `src/levels/structures.ts`; `Range` from `src/levels/kit.ts`.
- Produces (exact):

```ts
export interface Bearing { y: number; x: Range; z: Range }
export interface Frame { levels: Record<string, number>; grid: { x: Record<string, number>; z: Record<string, number> }; footprint: { x: Range; z: Range }; bearings: Record<string, Bearing> }
export interface PartDef<P> { id: string; budget: number; provides?: string[]; needs?: string[]; build(f: Frame, p: P): PieceSpec[] }
export interface BuildingDef<P = Record<string, unknown>> {
  id: string; name: string; category: PrefabView['category']; group: string; age?: AgeSpec;
  defaults: P; variants?: { id: string; name: string; params: Partial<P> }[];
  /** 'finish' (default): assemble applies the landmark finish pipeline; 'raw': parts already return placed, finished pieces (migrated legacy functions) */
  pipeline?: 'finish' | 'raw';
  frame(p: P): Frame; parts: PartDef<P>[];
}
export function footprintFrame(x: Range, z: Range): Frame
export function buildParts<P>(def: BuildingDef<P>, params: P): { part: string; pieces: PieceSpec[] }[]   // local, tagged, unfinished
export function assemble<P>(def: BuildingDef<P>, placement: Placement & Partial<P>): PieceSpec[]
```

- [ ] **Step 1: Failing tests** (append to `tests/buildings.test.ts`)

```ts
import { assemble, buildParts, footprintFrame, type BuildingDef } from '../src/buildings/assemble.ts';
import { block } from '../src/levels/kit.ts';

const toy: BuildingDef<{ h: number }> = {
  id: 'toy', name: 'Toy', category: 'houses', group: 'toy', defaults: { h: 3 },
  frame: (p) => ({ ...footprintFrame([-2, 2], [-2, 2]), bearings: { wallTop: { y: p.h, x: [-2, 2], z: [-2, 2] } } }),
  parts: [
    { id: 'walls', budget: 4, provides: ['wallTop'], build: (f, p) => [block('brick', [-2, 2], [0, p.h], [-2, -1.8])] },
    { id: 'roof', budget: 2, needs: ['wallTop'], build: (f) => [block('oak', [-2, 2], [f.bearings.wallTop.y, f.bearings.wallTop.y + 0.2], [-2, 2])] },
  ],
};

test('buildParts tags every piece with building/part and merges params', () => {
  const parts = buildParts(toy, { h: 5 });
  assert.deepEqual(parts.map((x) => x.part), ['walls', 'roof']);
  assert.ok(parts.every((x) => x.pieces.every((q) => q.part === `toy/${x.part}`)));
  assert.equal(parts[1].pieces[0].pos[1], 5.1);
});

test('assemble places at (x, z) and applies the group', () => {
  const ps = assemble(toy, { x: 10, z: 0 });
  assert.ok(ps.every((q) => q.group === 'toy'));
  assert.ok(ps.some((q) => q.pos[0] > 8));
});
```

- [ ] **Step 2:** `node --test tests/buildings.test.ts; echo EXIT=$?` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/buildings/assemble.ts`

```ts
import type { AgeSpec, PieceSpec, PrefabView } from '../types.ts';
import type { Range } from '../levels/kit.ts';
import type { Placement } from '../levels/structures.ts';
import { finish } from '../levels/architecture/common.ts';

export interface Bearing { y: number; x: Range; z: Range }
export interface Frame { levels: Record<string, number>; grid: { x: Record<string, number>; z: Record<string, number> }; footprint: { x: Range; z: Range }; bearings: Record<string, Bearing> }
export interface PartDef<P> { id: string; budget: number; provides?: string[]; needs?: string[]; build(f: Frame, p: P): PieceSpec[] }
export interface BuildingDef<P = Record<string, unknown>> {
  id: string; name: string; category: PrefabView['category']; group: string; age?: AgeSpec;
  defaults: P; variants?: { id: string; name: string; params: Partial<P> }[];
  pipeline?: 'finish' | 'raw';
  frame(p: P): Frame; parts: PartDef<P>[];
}

export function footprintFrame(x: Range, z: Range): Frame {
  return { levels: {}, grid: { x: {}, z: {} }, footprint: { x, z }, bearings: {} };
}

export function buildParts<P>(def: BuildingDef<P>, params: P): { part: string; pieces: PieceSpec[] }[] {
  const f = def.frame(params);
  return def.parts.map((pt) => {
    const pieces = pt.build(f, params);
    for (const q of pieces) q.part = `${def.id}/${pt.id}`;
    return { part: pt.id, pieces };
  });
}

export function assemble<P>(def: BuildingDef<P>, placement: Placement & Partial<P>): PieceSpec[] {
  const params = { ...def.defaults, ...placement } as P & Placement;
  const all = buildParts(def, params).flatMap((x) => x.pieces);
  return def.pipeline === 'raw' ? all : finish(all, placement, def.group, def.age);
}
```

`raw` exists because migrated legacy functions already call `put`/`finish` themselves and receive the full placement in `params`; a `raw` part is `build: (_f, p) => legacyFn(p)`.

- [ ] **Step 4:** `node --test tests/buildings.test.ts; echo EXIT=$?` → all pass. `npx tsc --noEmit; echo EXIT=$?` → 0.

---

### Task 3: Registry generator

**Files:**
- Create: `scripts/gen-buildings.ts`, `src/buildings/registry.gen.ts` (generated), `src/buildings/_example/def.ts` is NOT created — the generator must handle an empty set.
- Modify: `package.json` scripts: `"buildings": "node scripts/gen-buildings.ts"`, `"build": "node scripts/gen-buildings.ts && tsc && vite build"`, `"test": "node --test tests/*.test.ts"`.

**Interfaces:**
- Produces in `registry.gen.ts`:

```ts
export const BUILDINGS: Record<string, BuildingDef<any>>;
export const BUILDING_VARIANTS: { id: string; name: string; category: PrefabView['category']; base: string; params: Record<string, unknown> }[];
export function building(id: string, placement: Placement & Record<string, unknown>): PieceSpec[];  // id may be a variant id
```

- [ ] **Step 1: Implement generator**

```ts
import { readdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'buildings');
const ids = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(ROOT, d.name, 'def.ts')))
  .map((d) => d.name).sort();
const ident = (id: string) => 'b_' + id.replace(/[^a-z0-9]/gi, '_');
const src = `/* GENERATED by scripts/gen-buildings.ts — do not edit. Run \`npm run buildings\`. */
import type { PieceSpec, PrefabView } from '../types.ts';
import type { Placement } from '../levels/structures.ts';
import { assemble, type BuildingDef } from './assemble.ts';
${ids.map((id) => `import ${ident(id)} from './${id}/def.ts';`).join('\n')}

export const BUILDINGS: Record<string, BuildingDef<any>> = {
${ids.map((id) => `  '${id}': ${ident(id)},`).join('\n')}
};

export const BUILDING_VARIANTS: { id: string; name: string; category: PrefabView['category']; base: string; params: Record<string, unknown> }[] =
  Object.values(BUILDINGS).flatMap((d) => [
    { id: d.id, name: d.name, category: d.category, base: d.id, params: {} },
    ...(d.variants ?? []).map((v) => ({ id: v.id, name: v.name, category: d.category, base: d.id, params: v.params as Record<string, unknown> })),
  ]);

export function building(id: string, placement: Placement & Record<string, unknown>): PieceSpec[] {
  const v = BUILDING_VARIANTS.find((b) => b.id === id);
  if (!v) throw new Error(\`unknown building '\${id}'\`);
  return assemble(BUILDINGS[v.base], { ...v.params, ...placement });
}
`;
const out = join(ROOT, 'registry.gen.ts');
if (!existsSync(out) || readFileSync(out, 'utf8') !== src) writeFileSync(out, src);
console.log(`registry: ${ids.length} buildings`);
```

Also verify each def's `id` equals its folder name: after generation, the script imports nothing, so add the check to `check-building.ts` (Task 4) and to a unit test in Task 5.

- [ ] **Step 2: Verify**

Run: `node scripts/gen-buildings.ts && node scripts/gen-buildings.ts && npx tsc --noEmit; echo EXIT=$?` → prints `registry: 0 buildings` twice, `EXIT=0`. Rewriting only when content changes keeps Vite HMR quiet.

---

### Task 4: `check-building` and the promoted sim harness

**Files:**
- Create: `scripts/check-building.ts`, `scripts/sim.mjs` (copy of `<scratchpad>/sim.mjs` with `ROOT` computed from `import.meta.url`, and a new mode `B:<buildingOrVariantId>` that spawns `building(id, {x:0,z:0})` via `stand()` exactly like the existing `P:` mode, then prints a final JSON line `RESULT {"weldsLost":n,"runaways":n,"awakeAtEnd":n}`), `src/buildings/bearings.ts`
- Test: `tests/buildings.test.ts` (append bearing tests)

**Interfaces:**
- Produces: `checkBearings(def, params): string[]` in `src/buildings/bearings.ts` — errors for (a) a `needs` bearing that no part `provides`, (b) a `provides` bearing with no piece of that part whose AABB top face lies within `TOUCH_GAP` of `bearing.y` and overlaps its x/z range, (c) a `needs` part with no piece whose AABB bottom lies within `TOUCH_GAP` of `bearing.y` inside its range. Uses `pieceAabb`, `TOUCH_GAP` from `src/levels/validate.ts`.
- CLI: `node scripts/check-building.ts <id> [--variant v] [--part p] [--settle] [--update]` exit 0 = pass.

- [ ] **Step 1: Failing bearing tests** (append)

```ts
import { checkBearings } from '../src/buildings/bearings.ts';

test('bearings pass when roof sits on wall top', () => {
  assert.deepEqual(checkBearings(toy, { h: 3 }), []);
});

test('bearings fail when roof floats above the wall top', () => {
  const bad = { ...toy, parts: [toy.parts[0], { ...toy.parts[1], build: () => [block('oak', [-2, 2], [3.5, 3.7], [-2, 2])] }] };
  assert.ok(checkBearings(bad, { h: 3 }).some((e) => e.includes('roof') && e.includes('wallTop')));
});
```

(Adjust the toy wall in Task 2's test so its top spans the bearing: it already spans x −2..2 at y = h.)

- [ ] **Step 2:** run → FAIL (module missing). **Step 3:** implement `bearings.ts`. **Step 4:** run → PASS.

- [ ] **Step 5: Implement `check-building.ts`**, in this order, collecting errors:
  1. Resolve id/variant via `BUILDINGS`/`BUILDING_VARIANTS`; error if def.id ≠ folder name.
  2. `parts = buildParts(def, params)`; for each part, `pieces.length > budget` → error `part <id>: N pieces over budget B`.
  3. `validateBlueprint({ pieces: assemble(def, {x:0,z:0, ...params}) } as Blueprint, { bounds: 200, maxPieces: 100000 })` — errors prefixed with the offending piece's `part` when the message names a piece index (map index → `pieces[i].part`).
  4. `checkBearings(def, params)` unless `def.pipeline === 'raw'`.
  5. Baseline: per part `fingerprint(pieces)` vs `src/buildings/<id>/baseline.json` (`{ [variant]: { [part]: {pieces,mass,hash} } }`). Differences → error `part <p> changed (…)`, unless `--update` (writes the new values, restricted to `--part` when given). Missing baseline file → warning, and `--update` creates it.
  6. `--settle`: spawn `node scripts/sim.mjs B:<variantId> 1800`, parse the `RESULT` line; error if `weldsLost > 0` or `runaways > 0`.
  7. Print active `CLAIM` file contents if present. Print `OK <id>` or the error list; exit 0/1.

- [ ] **Step 6: Verify** with a temporary package: create `src/buildings/zz-toy/def.ts` exporting the toy def (from the test), run `npm run buildings`, `node scripts/check-building.ts zz-toy --update; echo EXIT=$?` → 0, then `node scripts/check-building.ts zz-toy --settle; echo EXIT=$?` → 0. Delete `src/buildings/zz-toy/`, rerun `npm run buildings`, `npx tsc --noEmit` → 0.

---

### Task 5: Migrate the landmarks

**Files:**
- Create: `src/buildings/{station,cathedral,highrise,deptstore,road-bridge,gasholder,stadium,millworks}/def.ts` (+ `SPEC.md`, `baseline.json`)
- Move: the body of each `src/levels/architecture/<file>.ts` into its package (`parts/main.ts` + package `lib.ts` for file-local helpers). `architecture/common.ts` and `architecture/foundations.ts` stay where they are (shared).
- Modify: `src/levels/architecture/index.ts` → derive `LANDMARKS` from the registry; each old `architecture/<file>.ts` becomes a one-line re-export of the package function it used to define, so any importer keeps working.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: package ids `station`, `cathedral` (variant `cathedral-4` with `params: { bays: 4 }`), `highrise`, `deptstore`, `road-bridge`, `gasholder`, `stadium`, `millworks` — identical to current `LANDMARKS` ids.

- [ ] **Step 1:** Snapshot: `tar` the project to `~/Destructovibe-snapshots/destructovibe-pre-landmarks-$(date +%H%M).tgz` (excluding node_modules, dist, legacy). Ensure `fp-before.json` from Task 1 exists.
- [ ] **Step 2:** For each landmark, a def of this shape (the landmark function already calls `finish` itself, so use `pipeline: 'raw'`):

```ts
import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { railwayStation } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'station', name: 'Victorian railway terminus', category: 'heritage', group: 'station', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 2000, build: (_f, p) => railwayStation(p as never) }],
};
export default def;
```

Set each `budget` to the current piece count rounded up to the next 100 (read it from `fp-before.json`). `group` = the fallback group string the landmark passes to `finish`.
- [ ] **Step 3:** `index.ts`:

```ts
import { BUILDING_VARIANTS, building } from '../../buildings/registry.gen.ts';
const IDS = ['station', 'cathedral', 'cathedral-4', 'highrise', 'deptstore', 'road-bridge', 'gasholder', 'stadium', 'millworks'];
export const LANDMARKS: Landmark[] = IDS.map((id) => {
  const v = BUILDING_VARIANTS.find((b) => b.id === id)!;
  return { id, name: v.name, category: v.category, make: (p) => building(id, p as never) };
});
```

- [ ] **Step 4: Verify** — `npm run buildings`; `npx tsc --noEmit`; `node scripts/fingerprint-levels.ts "<scratchpad>/fp-landmarks.json"`; `node scripts/compare-fingerprints.ts "<scratchpad>/fp-before.json" "<scratchpad>/fp-landmarks.json"; echo EXIT=$?` → `EXIT=0`; `node scripts/check-building.ts <id> --update` for all 8 → exit 0; `node scripts/validate-levels.ts; echo EXIT=$?` → 0; `node --test tests/*.test.ts` → all pass.

---

### Task 6: Migrate `structures.ts` and `buildings.ts` buildings; registry-driven prefabs

**Gate:** start only after the lead confirms the campaign agent has finished (it edits `prefabs.ts`, `contracts.ts`, maps).

**Files:**
- Create: one package per exported building function in `src/levels/structures.ts` and `src/levels/buildings.ts` (e.g. `garden-shed`, `bungalow`, `warehouse`, `mill`, `cottage-row`, `tower-block`, `apartment-block`, `car-park`, `office-block`, `chapel`, `rotunda`, `skyscraper`, `factory`, `stadium-stand`, `timber-house`, `victorian-terrace`, `backdrop-tower`, …). Package id = kebab-case of the function name unless a `PREFABS` id already names it, in which case use that id. Props/rigs that are not buildings (`dump`, `van`, `car`, `brickStack`, `towerCrane`, `scaffoldTower`, `latticePylon`, `pipeRack`) still migrate — they are placed by maps the same way.
- Create: `src/buildings/_shared/structures-helpers.ts` holding `put`, `lineDrive`, `boiler`, `radiator`, and any other non-exported helper used by more than one migrated function. `TINT`, `rng`, `gridFeed`, `Placement` stay exported from `structures.ts` (widely imported).
- Modify: `src/levels/structures.ts`, `src/levels/buildings.ts` → keep `Placement`, `TINT`, `rng`, `gridFeed` and re-export each migrated function from its package (`export { bungalow } from '../buildings/bungalow/parts/main.ts';`) so maps/contracts/prefabs need no edits.
- Modify: `src/levels/prefabs.ts` → every entry whose builder is a migrated function or landmark becomes `prefab(v.id, v.name, v.category, () => building(v.id, at))` built from `BUILDING_VARIANTS`, keeping the existing order and ids; entries for machines/plant/grid/electrical/rigging stay as they are.

- [ ] **Step 1:** Snapshot (as Task 5 Step 1). Re-run `node scripts/fingerprint-levels.ts "<scratchpad>/fp-before6.json"` (the campaign agent may have added prefabs since Task 1).
- [ ] **Step 2:** Move functions in batches of ~8, running `npx tsc --noEmit` and the fingerprint comparison after each batch; each def uses `pipeline: 'raw'`, one part `main`, `variants` for the parameter presets `PREFABS` uses (e.g. `flats-3`/`flats-4`/`flats-6` → `apartment-block` variants with `{ storeys: n }`).
- [ ] **Step 3:** Rewrite `prefabs.ts` registration as above.
- [ ] **Step 4: Verify** — `compare-fingerprints fp-before6.json fp-after6.json` → `EXIT=0`; `node scripts/validate-levels.ts`, `validate-grid.ts`, `validate-rigging.ts`, `validate-fractures.ts` → each exit 0; `node --test tests/*.test.ts` → pass; `check-building --update` for every package → exit 0; `wc -l src/levels/structures.ts` shows only shims/shared exports; Browser pane: load Clearance, Heritage, Downtown and the Railway map, no console errors after fresh reload, `B` palette lists the same entries as before.

---

### Task 7: Split cathedral and station into real parts (two agents in parallel)

**Gate:** Task 6 done. One agent per landmark; each writes a `CLAIM` in its package and edits only that package.

**Files (per landmark `<id>` ∈ {cathedral, station}):**
- Create: `src/buildings/<id>/frame.ts`, `src/buildings/<id>/parts/*.ts`, `SPEC.md`
- Modify: `src/buildings/<id>/def.ts` (switch to `pipeline: 'finish'`, real frame, parts), delete `parts/main.ts` once empty.

**Target parts:**
- cathedral: `foundations`, `arcade` (piers + arches, provides `arcadeTop`), `aisles` (walls + lean-to roofs, needs `arcadeTop`), `clerestory` (provides `navePlate`), `nave-roof` (needs `navePlate`), `tower` (provides `belfryFloor`), `spire` (needs `belfryFloor`), `west-front`, `interior`.
- station: `booking-hall`, `clock-tower`, `columns` (provides `girderSeat`), `girders` (needs `girderSeat`, provides `ribSpring`), `ribs` (needs `ribSpring`, provides `purlinLine`), `roof` (needs `purlinLine`), `platforms`, `canopies`, `services`.

- [ ] **Step 1:** Record `fp` of the current landmark (`check-building <id>` baseline from Task 5 is the reference).
- [ ] **Step 2:** Extract datums (heights, grid lines, spans) from the existing module constants into `frame.ts` — e.g. station: `levels.springing = YS`, `grid.z.rib0..rib6 = RIBS`, `bearings.girderSeat` from the column cap height.
- [ ] **Step 3:** Move code into parts one at a time; after each, `node scripts/check-building.ts <id>` must show the moved part's pieces fingerprint-identical to the same pieces in the old `main` (the union of all parts' fingerprints must equal the old `main` fingerprint; compare the whole-building fingerprint via `fingerprint(assemble(...))` against the Task 5 whole value).
- [ ] **Step 4:** Write `SPEC.md`: real-world reference, structural system, load path per part, per-part budgets, known gaps.
- [ ] **Step 5: Verify** — `check-building <id> --update --settle; echo EXIT=$?` → 0 (bearings satisfied, 0 welds lost at rest); whole-building fingerprint unchanged; `validate-levels` exit 0; for cathedral also `node scripts/sim.mjs B:cathedral 900 5.5,2,5,3` behaves as the collapse-engine agent's report states (bounded, repeatable). Remove the `CLAIM` file.

---

## Execution map (for the lead)

| Agent | Tasks | When |
|---|---|---|
| Framework agent | 1 → 2 → 3 → 4 → 5 | now (touches only new files, `src/types.ts` one field, `package.json`, `architecture/*`) |
| Framework agent (continued) | 6 | after the campaign agent reports |
| Two landmark agents | 7 (cathedral), 7 (station) | after Task 6, in parallel |
