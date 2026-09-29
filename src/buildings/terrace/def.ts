import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { victorianTerrace } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'terrace', name: 'Victorian terrace with pub', category: 'houses', group: 'terrace', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 700, build: (_f, p) => victorianTerrace(p as never) }],
};
export default def;
