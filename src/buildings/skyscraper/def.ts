import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { skyscraper } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'skyscraper', name: 'Skyscraper, 18 storeys', category: 'towers', group: 'skyscraper', pipeline: 'raw',
  defaults: {},
  variants: [
    { id: 'skyscraper-18', name: 'Skyscraper, 18 storeys', params: {} },
    { id: 'skyscraper-12', name: 'Skyscraper, 12 storeys', params: { storeys: 12 } },
  ],
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 1400, build: (_f, p) => skyscraper(p as never) }],
};
export default def;
