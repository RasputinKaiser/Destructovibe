import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { officeBlock } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'office-block', name: 'Glass office, 4 storeys', category: 'towers', group: 'office-block', pipeline: 'raw',
  defaults: {},
  variants: [
    { id: 'office-4', name: 'Glass office, 4 storeys', params: {} },
    { id: 'office-5', name: 'Glass office, 5 storeys', params: { storeys: 5 } },
  ],
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 700, build: (_f, p) => officeBlock(p as never) }],
};
export default def;
