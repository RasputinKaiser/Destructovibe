import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { rotunda } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'rotunda', name: 'Domed rotunda', category: 'heritage', group: 'rotunda', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => rotunda(p as never) }],
};
export default def;
