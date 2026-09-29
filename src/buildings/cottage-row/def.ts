import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { cottageRow } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'cottage-row', name: 'Cottage terrace', category: 'houses', group: 'cottage-row', pipeline: 'raw',
  defaults: {},
  variants: [
    { id: 'cottages', name: 'Cottage terrace', params: {} },
    { id: 'cottages-2', name: 'Pair of cottages', params: { count: 2 } },
    { id: 'cottage-row-5', name: 'Long cottage terrace', category: 'heritage', params: { count: 5 } },
  ],
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 480, build: (_f, p) => cottageRow(p as never) }],
};
export default def;
