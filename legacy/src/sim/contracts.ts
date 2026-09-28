import * as B from '../levels/builders';

export interface Contract {
  name: string;
  desc: string;
  target: number;                 // demolition fraction to hit
  loadout: number[];              // [ball, nade, rocket, c4]; -1 = infinite, 0 = not issued
  par: number;                    // par time in seconds (time bonus below this)
  silver: number;                 // score for 2 stars
  gold: number;                   // score for 3 stars
  build: () => void;
  briefNote?: string;
  unlock?: string;                // toast shown when completing unlocks something
}

export const CONTRACTS: Contract[] = [
  {
    name: 'Training Grounds',
    desc: 'A condemned bungalow and its chimney. The yard wants them flat. All the cannonballs you can carry — get a feel for the arc.',
    target: 0.6,
    loadout: [40, 0, 0, 0],
    par: 150,
    silver: 6000, gold: 9500,
    build: () => { B.buildBrickHouse(0, -18); B.buildChimney(-11, -22); },
    unlock: 'GRENADES UNLOCKED',
  },
  {
    name: 'Timber!',
    desc: 'Three watchtowers left over from the old fairground. Timber snaps clean if you hit it hard — grenades bounce into the legs nicely.',
    target: 0.7,
    loadout: [12, 14, 0, 0],
    par: 160,
    silver: 6000, gold: 9000,
    build: () => {
      B.buildWatchtower(-7, -18); B.buildWatchtower(4, -24); B.buildWatchtower(11, -14);
      B.buildCrates(-1, -13);
    },
    unlock: 'ROCKETS UNLOCKED',
  },
  {
    name: 'Steel Resolve',
    desc: 'A steel frame workshop with brick infill. Steel dents, bends, and — under enough violence — shears. Rockets speak its language.',
    target: 0.75,
    loadout: [8, 8, 12, 0],
    par: 180,
    silver: 7000, gold: 10500,
    build: () => {
      B.buildSteelFrame(0, -16);
      B.buildBarrels(6, -22, 4);
      B.buildChimney(-9, -20, 10);
    },
    unlock: 'C4 UNLOCKED',
  },
  {
    name: 'Fragile',
    desc: 'Four chimney stacks around an OCCUPIED site office. Every brick that touches that trailer comes out of your pay. Place your shots.',
    target: 0.8,
    loadout: [8, 0, 6, 4],
    par: 170,
    silver: 5500, gold: 8500,
    build: () => {
      B.buildChimney(-8, -16); B.buildChimney(8, -16);
      B.buildChimney(-8, -28); B.buildChimney(8, -28);
      B.buildTrailer(0, -22);
    },
    briefNote: 'PROTECTED: site office — damage penalties apply',
  },
  {
    name: 'Chain Reaction',
    desc: 'A grain silo wired with leftover TNT and fuel drums. Ammo is thin — let the site do the work. One good charge starts the dominoes.',
    target: 0.85,
    loadout: [0, 5, 0, 8],
    par: 150,
    silver: 10000, gold: 16000,
    build: () => {
      B.buildSilo(0, -20);
      B.buildTntStack(-2.4, -18.4); B.buildTntStack(2.2, -21.8); B.buildTntStack(0.2, -16.6, 3);
      B.buildBarrels(-6, -22, 5); B.buildBarrels(6, -17, 4);
      B.buildCrates(-4, -14, 3, 2);
    },
  },
  {
    name: 'Skyline Finale',
    desc: 'Six storeys of brick, timber and steel. The whole arsenal is yours. Leave nothing standing on the pad.',
    target: 0.9,
    loadout: [20, 12, 12, 8],
    par: 300,
    silver: 14000, gold: 20000,
    build: () => {
      B.buildTowerBlock(0, -20, 6);
      B.buildBarrels(-8, -14, 3);
      B.buildCrates(8, -14, 2, 3);
    },
  },
];

export function buildFreeplay(): void {
  B.buildBrickHouse(-8, -16);
  B.buildSteelFrame(9, -14);
  B.buildWatchtower(1, -27);
  B.buildChimney(-15, -25);
  B.buildBarrels(5, -20.5, 5);
}
