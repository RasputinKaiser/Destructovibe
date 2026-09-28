import type { Blueprint, Contract, PieceSpec, Vec3, WeaponId } from '../types.ts';
import {
  brickByBrickWall, brickStack, bungalow, busShelter, car, chapel, chipShop, cottageRow, dump, gardenShed,
  gardenWall, greenhouse, industrialChimney, mill, outhouse, overpass, pipeRack, pumpHouse, rng, siteOffice,
  spiralFolly, towerBlock, van, warehouse, waterTower, TINT,
} from './structures.ts';
import { poleLineSite, windTurbineSite } from './plant.ts';
import { clearanceZone } from './maps/clearance.ts';
import { heritageYard } from './maps/heritage.ts';
import { downtown } from './maps/downtown.ts';

const bp = (spawn: Vec3, ...parts: PieceSpec[][]): Blueprint => ({ pieces: parts.flat(), spawn: { pos: spawn, yaw: 0 } });

/** Free play: every tool, unlimited. */
/* a full Record so the compiler refuses a new WeaponId that free play forgot to issue */
const ALL_TOOLS: Record<WeaponId, number> = {
  hammer: -1, cannon: -1, rocket: -1, charge: -1, airstrike: -1,
  thermite: -1, cutter: -1, wrecker: -1, winch: -1, gravgun: -1, incendiary: -1, megabomb: -1,
  grinder: -1, saw: -1, drill: -1, shears: -1, plasma: -1, torch: -1,
  planner: -1, excavator: -1, breaker: -1, hose: -1, splitter: -1, wiresaw: -1,
};

export const CONTRACTS: Contract[] = [
  {
    id: 'garden-variety',
    name: 'Garden Variety',
    location: '9 Larch Avenue, back garden · 12:05',
    brief: 'The new owners want a lawn, and they want it by teatime: shed, greenhouse, outdoor facilities, the lot — and the back wall. '
      + 'The hammer is on the house; cannonballs are not, so save them for the brickwork. The greenhouse will not put up a fight.',
    target: 0.5,
    par: 90,
    stars: [0, 0],
    ammo: { hammer: -1, cannon: 12 },
    env: 'noon',
    build: () => bp([0, 0, 6],
      gardenWall({ x: 0, z: -17, length: 18, gate: 3 }),
      gardenShed({ x: -5, z: -10 }),
      greenhouse({ x: 3.5, z: -10 }),
      outhouse({ x: 9, z: -13 }),
      dump({ x: -10, z: -8, crates: [2, 1, 2], group: 'props' }),
      dump({ x: 6, z: -15.2, barrels: [2, 1] }),
    ),
  },
  {
    id: 'kerb-appeal',
    name: 'Kerb Appeal',
    location: '14 Orchard Close · 16:50',
    brief: 'One brick bungalow, one tired garden wall, one shed nobody will admit to owning. The developer wants a clean plot for six '
      + 'executive homes. Knock the corners out and the roof does the rest; roofs are heavy and they know it.',
    target: 0.6,
    par: 150,
    stars: [0, 0],
    ammo: { hammer: -1, cannon: 18 },
    env: 'golden',
    unlockText: 'ROCKETS UNLOCKED',
    build: () => bp([0, 0, 8],
      bungalow({ x: 0, z: -16 }),
      gardenWall({ x: 0, z: -9.5, length: 12, gate: 2 }),
      gardenShed({ x: 9.5, z: -19, rot: 3 }),
      dump({ x: -9, z: -11, crates: [2, 2, 2] }),
    ),
  },
  {
    id: 'high-and-dry',
    name: 'High and Dry',
    location: 'Kettle Lane Pumping Station · 11:15',
    brief: 'The water board has finally noticed the tower has been empty since 1987. Twelve tonnes of tank on four skinny legs — '
      + 'work out which leg is load-bearing (all of them) and remove one. Rockets are new to you; the pump house is not precious.',
    target: 0.65,
    par: 120,
    stars: [0, 0],
    ammo: { hammer: -1, cannon: 10, rocket: 6 },
    env: 'overcast',
    build: () => bp([0, 0, 6],
      waterTower({ x: -3, z: -18 }),
      pumpHouse({ x: 6.5, z: -12.5 }),
      dump({ x: -5.3, z: -14.6, barrels: [2, 1], group: 'props' }),
      dump({ x: 9.5, z: -10, propane: [2, 1] }),
      gardenShed({ x: -12, z: -12, rot: 1, group: 'stores' }),
    ),
  },
  {
    id: 'four-stacks',
    name: 'Four Stacks, No Scratches',
    location: 'Old Brickworks Yard · 18:40',
    brief: 'Four boiler stacks, and parked in the middle of them the site office, the foreman\'s van and a surveyor\'s very clean car. '
      + 'Everything tall comes down; everything with wheels or a kettle stays pristine. Take the base out on the side you want it to fall.',
    target: 0.7,
    par: 150,
    stars: [0, 0],
    ammo: { hammer: -1, cannon: 8, rocket: 5 },
    env: 'dusk',
    protectedNote: 'PROTECTED: site office, van and car — any damage is deducted from your fee.',
    unlockText: 'REMOTE CHARGES UNLOCKED',
    build: () => {
      const r = rng(4);
      const stacks = ([[-8, -14], [8, -14], [-8, -26], [8, -26]] as const).map(([x, z], i) =>
        brickStack({ x, z, courses: 6 + Math.floor(r() * 3), tint: [0xffffff, TINT.brickPale, 0xf0ddd0, TINT.brickDark][i], group: `stack${i + 1}` }));
      return bp([0, 0, 4],
        ...stacks,
        siteOffice({ x: 0, z: -20 }),
        van({ x: -2, z: -26.5 }),
        car({ x: 2.5, z: -13 }),
        dump({ x: 12.5, z: -20, crates: [2, 2, 2] }),
      );
    },
  },
  {
    id: 'hot-property',
    name: 'Hot Property',
    location: 'Unit 7, Canal Wharf · 23:10',
    brief: 'Steel shed, tin skin, and a previous tenant who stored propane like it was a hobby. It all has to go before the insurers '
      + 'wake up. Six charges on the right columns is a job; one rocket into the gas is a shortcut. Stand well back either way.',
    target: 0.55,
    par: 150,
    stars: [0, 0],
    ammo: { hammer: -1, cannon: 6, rocket: 3, charge: 8 },
    env: 'night',
    build: () => bp([0, 0, 6],
      warehouse({ x: 0, z: -20, stock: true }),
      pumpHouse({ x: -16, z: -9, rot: 1, group: 'gatehouse' }),
      dump({ x: 13, z: -9, barrels: [3, 2], propane: [2, 1] }),
    ),
  },
  {
    id: 'tall-order',
    name: 'The Tall Order',
    location: 'Bramley Mill · 07:40',
    brief: 'Twenty-six metres of Victorian chimney, a mill that should have closed with the Victorians, and a terrace of cottages '
      + 'whose residents are watching from their front steps. Cut the stack on its east side and it lays itself down across the mill. '
      + 'Cut it anywhere else and we will be having a conversation.',
    target: 0.8,
    par: 210,
    stars: [0, 0],
    ammo: { hammer: -1, cannon: 6, rocket: 4, charge: 8, winch: 2 },
    env: 'golden',
    protectedNote: 'PROTECTED: the cottage terrace to the west is occupied. Nothing falls west.',
    unlockText: 'AIRSTRIKE UNLOCKED',
    build: () => bp([3, 0, 3],
      industrialChimney({ x: -2, z: -24 }),
      mill({ x: 14, z: -24, stock: true }),
      cottageRow({ x: -19, z: -24, protected: true }),
    ),
  },
  {
    id: 'road-closed',
    name: 'Road Closed',
    location: 'Junction 9 flyover · 05:30',
    brief: 'The flyover failed its inspection in several languages. We have a two-hour closure, so all four spans on the ground before '
      + 'the rush. Piers first, deck follows; someone also abandoned a lorry-load of fuel up top. The bus shelter is council property.',
    target: 0.72,
    par: 180,
    stars: [0, 0],
    ammo: { hammer: -1, cannon: 6, rocket: 4, charge: 8, airstrike: 1 },
    env: 'overcast',
    protectedNote: 'PROTECTED: the bus shelter by the east abutment.',
    build: () => bp([-4, 0, 6],
      overpass({ x: 0, z: -20, traffic: true }),
      busShelter({ x: 22, z: -12 }),
      dump({ x: -10.5, z: -14.6, crates: [1, 1, 1], barrels: [2, 1] }),
    ),
  },
  {
    id: 'last-orders',
    name: 'Last Orders',
    location: 'Carrow Heights · 21:00',
    brief: 'Six storeys of 1960s optimism, now mostly pigeons. Bring it straight down into its own footprint: take the ground-floor '
      + 'columns and let gravity handle the paperwork. The chip shop across the road is open until midnight, and it is staying open.',
    target: 0.9,
    par: 240,
    stars: [0, 0],
    ammo: { hammer: -1, cannon: 6, rocket: 4, charge: 10, airstrike: 2, cutter: 4 },
    env: 'night',
    protectedNote: 'PROTECTED: the chip shop and the car outside it. Topple the tower east and you will pay for both.',
    build: () => bp([-6, 0, 4],
      towerBlock({ x: 0, z: -22 }),
      dump({ x: -2.8, z: -19.5, propane: [2, 1], group: 'props' }),
      chipShop({ x: 15, z: -12, rot: 3 }),
      car({ x: 15.5, z: -5, tint: TINT.carTeal }),
    ),
  },
];

/* Site plan and utility grid: see maps/clearance.ts. */
export const SANDBOX: Contract = {
  id: 'sandbox',
  name: 'Clearance Zone',
  location: 'Hollins Estate, whole-quarter clearance · any time',
  brief: 'A whole quarter slated for clearance while it is still plumbed in: High Street shops and a pub, Terrace Row, the works yard, '
    + 'a half-built frame on the construction site, the chapel over the canal cut. One substation, one gas governor and one pump hall feed all of it. '
    + 'Cut the right cable and a street goes dark; cut the wrong main and it burns. No targets, no clock, no invoices.',
  target: 0,
  par: 0,
  stars: [0, 0],
  ammo: ALL_TOOLS,
  env: 'golden',
  build: clearanceZone,
};

/* A second free-play site for the craft pieces: every period material in one yard (site plan: maps/heritage.ts). */
export const SHOWCASE: Contract = {
  id: 'showcase',
  name: 'The Heritage Yard',
  location: 'Open-air building museum, after hours · any time',
  brief: 'A museum of how things used to be built, assembled one voussoir, brace and brick at a time by volunteers with a lot of patience. '
    + 'The trustees want the site cleared for a car park. Oak burns slow, cast iron snaps, sandstone crumbles; find out which in what order.',
  target: 0,
  par: 0,
  stars: [0, 0],
  ammo: ALL_TOOLS,
  env: 'golden',
  build: heritageYard,
};

/* Downtown: the central business district, site plan in maps/downtown.ts. */
export const DOWNTOWN: Contract = {
  id: 'downtown',
  name: 'Downtown',
  location: 'Central business district, closed for redevelopment · dusk',
  brief: 'The whole district has been sold to a developer who wants a very large hole. Two towers, offices, a car park, flats, a stand '
    + 'from the old ground and a crane nobody remembered to take down. Everything is on the list. Mind the traffic, there is none.',
  target: 0,
  par: 0,
  stars: [0, 0],
  ammo: ALL_TOOLS,
  env: 'dusk',
  build: downtown,
};
