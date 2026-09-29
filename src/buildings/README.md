# Building packages — guide for agents

Every building is a self-contained package `src/buildings/<id>/`. Agents working on different packages, or on
different parts of one package, never write the same file.

```
<id>/def.ts                        BuildingDef (default export): id, name, category, group, defaults, variants, frame, parts
<id>/frame.ts, lib.ts              datums/bearings and package-private helpers (optional)
<id>/parts/<part>.ts               one file per part
<id>/SPEC.md                       what it is, load paths, known gaps
<id>/baseline/<variant>/<part>.json fingerprint per part (variant `default` or a variant id), written by check-building
<id>/CLAIM or CLAIM.<agent>        active ownership markers
```

`registry.gen.ts` is generated; never edit it. `_shared/` holds cross-package helpers (`base.ts`: Placement, gridFeed,
TINT, rng). `zz-test-*` folders are scratch packages created by the tests; gen-buildings ignores them.

## Add a building

1. Create `src/buildings/<id>/def.ts` (id = folder name, `[a-z0-9][a-z0-9-]*`, unique across all building and variant ids
   and the hand-written prefab ids in `src/levels/prefabs.ts`) plus `parts/*.ts` and `SPEC.md`.
2. `npm run buildings` — regenerates the registry. The building (every variant) joins the prefab palette automatically;
   set `landmark: true` (and `order`) in the def to list it among the landmarks instead.
3. `node scripts/check-building.ts <id> --update` to write its baselines, then `--settle` to prove it stands.

Nothing outside the package needs editing.

## Claim before you edit

Write a claim file in the package, one per agent: `src/buildings/<id>/CLAIM.<agent>` (plain `CLAIM` also works when a
single agent owns the package):

```
agent: roof-agent
task: glaze the train-shed roof
parts: roof, canopies        # or: all (default)
since: 2026-09-29T14:00Z
```

Edit only the parts you claim (their `parts/<part>.ts`; shared package files such as `frame.ts` only with a claim on
`all`). `npm run buildings` and `check-building` print active claims. Delete your claim file when done.

`check-building --update` enforces claims: on a claimed package it refuses without `--agent <name>`, refuses a part
another agent's claim covers, and refuses a part your own claim does not cover. Unclaimed packages need no `--agent`.

## Check

```
node scripts/check-building.ts <id|variant-id> [--variant v] [--part p] [--settle] [--update [--agent a]]
```

- Loads only `<id>/def.ts` (not the registry); every other package is imported in isolation for the id-integrity scan,
  so a broken package elsewhere is a warning, never a crash.
- Checks per variant: part budgets, blueprint validity (overlaps, floating/below-ground pieces), bearings (every `needs`
  has a provider and both sides touch the bearing), and each part's fingerprint against its baseline file.
- `--part p`: only findings about `p` (its pieces, its budget, bearings it needs or provides, its baseline) are errors;
  everything else is printed as a `[not p]` warning. Use this while other agents edit other parts.
- `--settle`: 1800-step headless settle (`scripts/sim.mjs B:<id>`); fails on lost welds, runaways or bodies still awake.
- Exit 0 = OK, 1 = errors. Read the `OK`/`FAIL` line, not the tail.

## Update baselines

After an intended change: `node scripts/check-building.ts <id> --update --part <p> --agent <you>`. It writes only
`baseline/<variant>/<p>.json` for the variants checked, and only when there are no in-scope errors. Without `--part` it
rewrites every part of the package and removes stale baseline files (needs a claim on `all` if the package is claimed).
Stale entries (a variant or part that no longer exists) are reported as warnings.

Piece order: `assemble()` sorts a `finish`-pipeline building's pieces into a canonical order, so part order and emission
order do not affect the collapse sim; fingerprints are order-independent.
