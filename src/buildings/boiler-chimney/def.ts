import type { BuildingDef } from '../assemble.ts';
import { footprintFrame } from '../assemble.ts';
import { PED } from './lib.ts';
import { pedestal } from './parts/pedestal.ts';
import { shaft } from './parts/shaft.ts';
import { cap } from './parts/cap.ts';
import { flue } from './parts/flue.ts';

/** `wall`: the boiler house's wall, metres from the axis along +X, where the flue duct stops. */
export interface BoilerChimneyParams { [k: string]: unknown; wall: number }

const def: BuildingDef<BoilerChimneyParams> = {
  id: 'boiler-chimney', name: 'Boiler-house chimney', category: 'towers', group: 'boilerchimney', age: { years: 120, exposure: 'wet' },
  defaults: { wall: PED.half + 2.0 },
  frame: (p) => footprintFrame([-PED.half, p.wall], [-PED.half, PED.half]),
  parts: [
    { id: 'pedestal', budget: 14, build: () => pedestal() },
    { id: 'shaft', budget: 8, build: () => shaft() },
    { id: 'cap', budget: 3, build: () => cap() },
    { id: 'flue', budget: 1, build: (_f, p) => flue(p.wall) },
  ],
};
export default def;
