import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { timberBarn } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'barn', name: 'Timber barn', category: 'industrial', group: 'barn', pipeline: 'raw',
  defaults: { hay: true },
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 100, build: (_f, p) => timberBarn(p as never) }],
};
export default def;
