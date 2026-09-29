import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { factory } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'sawtooth-factory', name: 'Sawtooth factory with stack', category: 'industrial', group: 'sawtooth-factory', pipeline: 'raw',
  defaults: {},
  variants: [
    { id: 'factory', name: 'Sawtooth factory with stack', params: { stock: true } },
    { id: 'factory-plain', name: 'Sawtooth factory', params: { stack: false } },
  ],
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 500, build: (_f, p) => factory(p as never) }],
};
export default def;
