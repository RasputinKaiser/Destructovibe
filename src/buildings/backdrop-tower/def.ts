import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { backdropTower } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'backdrop-tower', name: 'Skyline tower (simple)', category: 'towers', group: 'backdrop-tower', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 300, build: (_f, p) => backdropTower(p as never) }],
};
export default def;
