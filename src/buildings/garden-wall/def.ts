import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { gardenWall } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'garden-wall', name: 'Garden wall', category: 'infrastructure', group: 'garden-wall', pipeline: 'raw',
  defaults: { length: 12, gate: 2 },
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => gardenWall(p as never) }],
};
export default def;
