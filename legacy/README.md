# Destructovibe

First-person physics demolition game. Three.js + Rapier (WASM), TypeScript, Vite.

```sh
npm install
npm run dev      # http://localhost:5183
npm run build    # production build → dist/
```

## Game

- **Contracts** — 6-level campaign: demolition % targets, limited ordnance, par times,
  1–3 star ratings, sequential unlocks (grenade → rocket → C4). Progress saved to localStorage.
- **Free play** — the open sandbox, all weapons, `R` rebuilds the site.
- Materials break differently: brick cracks then shatters, timber snaps, steel dents and
  shears, barrels and TNT chain-react. Demolition credit is paid for collapse
  (displacement/topple), not just pulverization. Combo multiplier up to ×3 for chained kills.

## Controls

`WASD` move · `Space` jump · `F` fly · `1–4`/wheel weapon · `LMB` fire ·
`G` detonate C4 · `R` restart · `Esc` pause

## Structure

- `src/physics/` — Rapier world; destructible registry + damage model (contact-force events)
- `src/weapons/` — projectiles, C4 placement/detonation
- `src/levels/` + `src/sim/contracts.ts` — structure builders and contract definitions
- `src/sim/scoring.ts` — score, combos, penalties
- `src/render/` — renderer/lights/sky, procedural textures, particles, effects
- `src/ui/` — DOM HUD and screens; `src/core/` — input, save
