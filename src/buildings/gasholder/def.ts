import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { gasholder } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'gasholder', name: 'Column-guided gasholder', category: 'industrial', group: 'gasholder', pipeline: 'raw',
  landmark: true, order: 6,
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 300, build: (_f, p) => gasholder(p as never) }],
};
export default def;
