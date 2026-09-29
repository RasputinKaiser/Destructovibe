import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { departmentStore } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'deptstore', name: 'Art Deco department store', category: 'towers', group: 'store', pipeline: 'raw',
  landmark: true, order: 4,
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 1000, build: (_f, p) => departmentStore(p as never) }],
};
export default def;
