import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { pumpHouse } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'pump-house', name: 'Pump house', category: 'industrial', group: 'pump-house', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => pumpHouse(p as never) }],
};
export default def;
