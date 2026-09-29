import { mulberry32 } from 'math/random';
import type { PieceSpec } from '../../types.ts';

export interface Placement {
  x: number; z: number; rot?: number; group?: string;
  /** furniture, fittings, stairs and room partitions (default true); false keeps only the structure and services */
  interior?: boolean;
  /** the building's own intake (its consumer unit / supply cabinet) becomes a plain live member, to be fed from a site grid */
  gridFed?: boolean;
}

/** A grid-fed building: its local intake sources become ordinary power members. */
export function gridFeed(ps: PieceSpec[], on?: boolean): PieceSpec[] {
  if (!on) return ps;
  for (const q of ps) if (q.fixture === 'transformer') { delete q.fixture; q.util = 'power'; }
  return ps;
}

export const TINT = {
  cream: 0xf1e6cf, white: 0xf4f1ea, sage: 0xcfd8c0, pink: 0xecc9c1, blue: 0xc9d6e3, butter: 0xf3e2a9,
  shedGreen: 0x7f9f6c, woodDark: 0x8a6a4a, woodPale: 0xc9b596, weatherboard: 0xd9d2c3,
  slate: 0x7a808a, terracotta: 0xd08a64, felt: 0x55585c,
  concrete: 0xcfcfca, darkConcrete: 0x9a9a96, soot: 0x6d625c, brickPale: 0xe3c9b0, brickDark: 0xa98474,
  steelRed: 0xb0493a, steelGrey: 0x8d949b, metalWhite: 0xeceae4, metalBlue: 0x6f8fae, metalGreen: 0x7d9a86,
  rubber: 0x2a2a2a, vanWhite: 0xf2f2ee, carRed: 0xb8352c, carTeal: 0x3f8c8a,
  iron: 0x3c4044, stone: 0xe6dcc6, sand: 0xe8d2a6, barnRed: 0xa8503c, shingle: 0x6e5a48, blueGlass: 0xa9cde0, bronze: 0xa07a3c, craneYellow: 0xe8b82a,
};

export function rng(seed: number): () => number {
  const s = mulberry32.create(seed);
  return () => mulberry32.sample(s);
}
