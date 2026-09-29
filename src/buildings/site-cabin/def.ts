import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { siteCabin } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'site-cabin', name: 'Site cabin', category: 'props', group: 'site-cabin', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 10, build: (_f, p) => siteCabin(p as never) }],
};
export default def;
