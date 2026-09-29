import { arch, NSEG, RH } from './frame.ts';

export const IRON = 0x3a4a44, CAST = 0x2f3534, GLAZE = 0xcfe0e6, BRICK = 0xb0664a;

/** Rib flange width and flange plate thickness (m). Rib depth RH, segments per rib NSEG and the arch geometry are frame
    datums (frame.ts), re-exported here for the parts. */
export { arch, NSEG, RH };
export const RB = 0.36, TF = 0.08;
