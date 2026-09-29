import type { BuildingDef } from '../assemble.ts';
import { frame } from './frame.ts';
import { bookingHall } from './parts/booking-hall.ts';
import { clockTower } from './parts/clock-tower.ts';
import { ribs } from './parts/ribs.ts';
import { columns } from './parts/columns.ts';
import { girders } from './parts/girders.ts';
import { roof } from './parts/roof.ts';
import { platforms } from './parts/platforms.ts';
import { canopies } from './parts/canopies.ts';
import { services } from './parts/services.ts';

/* Victorian railway terminus: a brick booking hall with a corner clock tower fronts (+Z) a 36 m wrought-iron train shed
   of lattice arch ribs on plate girders and cast-iron columns over four platform roads. See SPEC.md. */
const def: BuildingDef<Record<string, unknown>> = {
  id: 'station', name: 'Victorian railway terminus', category: 'heritage', group: 'station', age: { years: 140, exposure: 'outdoor' },
  landmark: true, order: 1,
  defaults: {},
  frame,
  parts: [
    { id: 'booking-hall', budget: 600, build: bookingHall },
    { id: 'clock-tower', budget: 40, build: clockTower },
    { id: 'ribs', budget: 120, needs: ['ribSpring'], provides: ['purlinLine'], build: ribs },
    { id: 'columns', budget: 60, provides: ['girderSeat'], build: columns },
    { id: 'girders', budget: 16, needs: ['girderSeat'], provides: ['ribSpring'], build: girders },
    { id: 'roof', budget: 220, needs: ['purlinLine'], build: roof },
    { id: 'platforms', budget: 150, build: platforms },
    { id: 'canopies', budget: 30, build: canopies },
    { id: 'services', budget: 30, build: services },
  ],
};
export default def;
