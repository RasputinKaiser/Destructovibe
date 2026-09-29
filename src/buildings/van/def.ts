import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { van } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'van', name: 'Panel van', category: 'props', group: 'van', pipeline: 'raw',
  defaults: {},
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => van(p as never) }],
};
export default def;
