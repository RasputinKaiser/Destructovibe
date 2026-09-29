import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { chapel } from './parts/main.ts';

const def: BuildingDef<Record<string, unknown>> = {
  id: 'chapel', name: 'Chapel and spire', category: 'heritage', group: 'chapel', pipeline: 'raw',
  defaults: { graves: 5 },
  frame: () => footprintFrame([0, 0], [0, 0]),
  parts: [{ id: 'main', budget: 400, build: (_f, p) => chapel(p as never) }],
};
export default def;
