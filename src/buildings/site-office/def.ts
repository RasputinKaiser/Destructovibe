import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { siteOffice } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'site-office', name: 'Site office', category: 'houses', group: 'site-office', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => siteOffice(p as never) }],
};
export default def;
