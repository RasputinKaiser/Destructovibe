import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { towerCrane } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'crane', name: 'Tower crane', category: 'towers', group: 'crane', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => towerCrane(p as never) }],
};
export default def;
