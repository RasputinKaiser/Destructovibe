/* Terrain authoring data: plain JSON built by the map builders (plan.ts) and carried on the Blueprint. The heights,
   materials and feature meshes are rasterised from it (raster.ts); nothing here is simulated directly.
   Heights are metres (y up), x east, +z south. The natural ground is y ≈ 0. */

export type Range = [number, number];

/** ground surfacing, in id order (the physics, render splat channels and audio all index by it) */
export const SURFACES = ['asphalt', 'concrete', 'paving', 'setts', 'gravel', 'grass', 'soil', 'rubble'] as const;
export type SurfaceId = typeof SURFACES[number];

/** soil kinds of the ground's strata and of loose spoil, in id order (terrain/soil.ts holds their properties) */
export const SOILS = ['topsoil', 'clay', 'sand', 'gravel', 'fill', 'rock'] as const;
export type SoilId = typeof SOILS[number];

/** The ground's strata, top down: each layer's typical thickness (m) and how much it varies across the site (a
    fraction; above 1 the layer is patchy, absent where the variation takes it below nothing). The last layer runs
    on down. Topsoil is stripped under sealed and engineered ground (the sub-base, made ground, starts there). */
export interface SoilProfile { layers: { soil: SoilId; thick: number; vary?: number }[] }

export type TerrainOp =
  /** flat (or falling) plot at y; `blend` feathers the edge into what was there over that many metres */
  | { k: 'level'; x: Range; z: Range; y: number; mat?: SurfaceId; blend?: number; fall?: { axis: 'x' | 'z'; dy: number } }
  /** carriageway along `axis`: channel level y at both edges, crowned by `camber` (rise/run) toward the centre line */
  | { k: 'road'; x: Range; z: Range; axis: 'x' | 'z'; y: number; camber?: number; mat?: SurfaceId }
  /** linear ramp along `axis` from y0 at the low-coordinate end to y1 at the high end */
  | { k: 'ramp'; x: Range; z: Range; axis: 'x' | 'z'; y0: number; y1: number; mat?: SurfaceId }
  /** surfacing only */
  | { k: 'mat'; x: Range; z: Range; mat: SurfaceId }
  /** excavation or cutting with sloped (batter run/rise) or vertical (0) sides down to a floor at y */
  | { k: 'pit'; x: Range; z: Range; y: number; batter?: number; mat?: SurfaceId }
  /** bed a structure on unengineered ground: level the footprint at y, feathered out over natural ground only */
  | { k: 'seat'; x: Range; z: Range; y: number }
  /** soft undulation (amplitude m, wavelength m) inside the rect, on top of what is there */
  | { k: 'rough'; x: Range; z: Range; amp: number; scale?: number };

/** A kerb line on the footway side of a carriageway edge: face at `at` (a grid line), the stone and its haunch
    occupying one cell toward `side`. `up` is the upstand over the channel; `drops` are dropped (flush) runs. */
export interface Kerb { axis: 'x' | 'z'; at: number; from: number; to: number; side: 1 | -1; top: number; up: number; drops?: Range[]; mat?: SurfaceId }

/** Solid block feature (retaining wall, dock, plinth, step): box footprint from y0 to y1, static and rendered. */
export interface Block { x: Range; z: Range; y0: number; y1: number; mat: 'stone' | 'concrete' | 'brick'; tint?: number }

/** A building's ground-bearing slab: flat static ground at `top` over the footprint (a large piece resting on it
    touches two triangles, not the heightfield's hundreds), its edge a plinth down into the ground. */
export interface Pad { x: Range; z: Range; top: number }

/** Flight of steps along `axis`, climbing toward `dir` from y0 to y1. */
export interface Steps { x: Range; z: Range; axis: 'x' | 'z'; dir: 1 | -1; y0: number; y1: number; n: number; mat: 'stone' | 'concrete' }

export type DecalKind = 'manhole' | 'valve' | 'gasvalve' | 'grating' | 'hydrant' | 'stopcock' | 'oil' | 'patch' | 'puddle';
export interface Decal { kind: DecalKind; x: number; z: number; w: number; d?: number; rot?: number }

export type MarkKind = 'line' | 'dash' | 'double' | 'stop' | 'give' | 'zebra' | 'hatch' | 'bay' | 'yellow';
/** Road marking strip: centre line from (x0,z0) to (x1,z1), width w. */
export interface Marking { kind: MarkKind; a: [number, number]; b: [number, number]; w: number }

export interface TerrainSpec {
  /** the heightfield covers [-half, half]² (a multiple of the tile, 32 samples); beyond it lies a flat apron at y = 0 */
  half: number;
  /** sample spacing, m (default CELL) */
  cell?: number;
  seed: number;
  /** natural-ground undulation where nothing is engineered, m */
  undulate: number;
  ops: TerrainOp[];
  kerbs: Kerb[];
  blocks: Block[];
  pads: Pad[];
  steps: Steps[];
  decals: Decal[];
  marks: Marking[];
  /** strata under the site (default: an urban profile, terrain/soil.ts) */
  soil?: SoilProfile;
}

/* 0.5 m samples: box3d gathers at most 256 triangles per shape pair, so a 5.5 m slab of debris lying on the
   heightfield is the most it can support whole (at 0.25 m, a 2.8 m one) */
export const CELL = 0.5;
export const TILE_CELLS = 32;
export const TILE = CELL * TILE_CELLS;
/** kerb upstand over the channel */
export const KERB_UP = 0.125;
/** damp-proof course: a building's floor stands this far above the ground round it */
export const DPC = 0.15;
/** cover over the buried mains (to the crown of the pipe), by kind; steam deepest */
export const COVER = { power: 0.5, gas: 0.75, water: 0.95, steam: 1.3 } as const;
