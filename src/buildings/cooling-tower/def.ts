import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { coolingTower } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'cooling-tower', name: 'Cooling tower', category: 'towers', group: 'cooling-tower', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 200, build: (_f, p) => coolingTower(p as never) }],
};
export default def;
