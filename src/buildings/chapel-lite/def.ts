import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { chapelLite } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'chapel-lite', name: 'Parish chapel', category: 'heritage', group: 'chapel-lite', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 110, build: (_f, p) => chapelLite(p as never) }],
};
export default def;
