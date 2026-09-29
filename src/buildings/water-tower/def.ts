import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { waterTower } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'water-tower', name: 'Water tower', category: 'towers', group: 'water-tower', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => waterTower(p as never) }],
};
export default def;
