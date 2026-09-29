import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { apartmentBlock } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'apartment-block', name: 'Walk-up flats, 4 storeys', category: 'houses', group: 'apartment-block', pipeline: 'raw',
  defaults: {},
  variants: [
    { id: 'flats-3', name: 'Walk-up flats, 3 storeys', params: { storeys: 3 } },
    { id: 'flats-4', name: 'Walk-up flats, 4 storeys', params: {} },
    { id: 'flats-6', name: 'Walk-up flats, 6 storeys', params: { storeys: 6 } },
    { id: 'flats-scaffold', name: 'Walk-up flats under scaffold', params: { storeys: 3, scaffold: true } },
  ],
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 700, build: (_f, p) => apartmentBlock(p as never) }],
};
export default def;
