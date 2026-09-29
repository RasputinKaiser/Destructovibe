import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { timberFrameHouse } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'timber-frame-house', name: 'Timber-frame house', category: 'houses', group: 'timber-frame-house', pipeline: 'raw',
  defaults: {},
  variants: [
    { id: 'tudor', name: 'Timber-frame house', params: {} },
    { id: 'tudor-scaffold', name: 'Timber-frame house, scaffolded', params: { scaffold: true } },
  ],
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 300, build: (_f, p) => timberFrameHouse(p as never) }],
};
export default def;
