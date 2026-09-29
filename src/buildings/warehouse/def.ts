import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { warehouse } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'warehouse', name: 'Steel warehouse', category: 'industrial', group: 'warehouse', pipeline: 'raw',
  defaults: {},
  variants: [
    { id: 'warehouse-stocked', name: 'Warehouse full of gas', params: { stock: true } },
  ],
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 400, build: (_f, p) => warehouse(p as never) }],
};
export default def;
