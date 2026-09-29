import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { industrialChimney } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'chimney', name: 'Industrial chimney', category: 'towers', group: 'chimney', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 200, build: (_f, p) => industrialChimney(p as never) }],
};
export default def;
