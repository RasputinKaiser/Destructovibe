import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { latticePylon } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'pylon', name: 'Transmission pylon', category: 'towers', group: 'pylon', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => latticePylon(p as never) }],
};
export default def;
