import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { towerBlock } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'tower-block', name: 'Tower block, 6 storeys', category: 'towers', group: 'tower-block', pipeline: 'raw',
  defaults: {},
  variants: [
    { id: 'tower-block-6', name: 'Tower block, 6 storeys', params: {} },
    { id: 'tower-block-4', name: 'Tower block, 4 storeys', params: { storeys: 4 } },
  ],
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 800, build: (_f, p) => towerBlock(p as never) }],
};
export default def;
