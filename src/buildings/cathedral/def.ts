import type { BuildingDef } from '../assemble.ts';
import { frame, type CathedralParams } from './frame.ts';
import { sideWalls } from './parts/side-walls.ts';
import { endWalls } from './parts/end-walls.ts';
import { arcade } from './parts/arcade.ts';
import { aisles } from './parts/aisles.ts';
import { tower } from './parts/tower.ts';
import { belfry } from './parts/belfry.ts';
import { spire } from './parts/spire.ts';
import { vault } from './parts/vault.ts';
import { naveRoof } from './parts/nave-roof.ts';
import { floor } from './parts/floor.ts';
import { interior } from './parts/interior.ts';

/* Gothic nave church: clustered piers and pointed arcade under a clerestory, quadripartite rib vault, slated roof on oak
   trusses, lean-to aisles with flying buttresses, west tower with belfry and broach spire. See SPEC.md. */
const def: BuildingDef<CathedralParams> = {
  id: 'cathedral', name: 'Gothic church with spire', category: 'heritage', group: 'cathedral', age: { years: 160, exposure: 'outdoor' },
  landmark: true, order: 2,
  defaults: { bays: 6 },
  variants: [{ id: 'cathedral-4', name: 'Gothic church, four bays', params: { bays: 4 } }],
  frame,
  parts: [
    { id: 'side-walls', budget: 255, needs: ['arcadeTop'], provides: ['navePlate', 'aislePlate'], build: sideWalls },
    { id: 'end-walls', budget: 90, build: endWalls },
    { id: 'arcade', budget: 250, provides: ['arcadeTop'], build: arcade },
    { id: 'aisles', budget: 90, needs: ['aislePlate'], build: aisles },
    { id: 'tower', budget: 35, provides: ['belfryFloor'], build: tower },
    { id: 'belfry', budget: 40, needs: ['belfryFloor'], provides: ['spireSeat'], build: belfry },
    { id: 'spire', budget: 80, needs: ['spireSeat'], build: spire },
    { id: 'vault', budget: 225, build: vault },
    { id: 'nave-roof', budget: 95, needs: ['navePlate'], build: naveRoof },
    { id: 'floor', budget: 45, build: floor },
    { id: 'interior', budget: 50, build: interior },
  ],
};
export default def;
