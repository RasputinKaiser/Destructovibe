import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { busShelter } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'bus-shelter', name: 'Bus shelter', category: 'infrastructure', group: 'bus-shelter', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => busShelter(p as never) }],
};
export default def;
