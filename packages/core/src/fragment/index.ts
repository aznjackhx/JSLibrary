/**
 * Fragmentation — internal.
 *
 * Step 2 of the pipeline: decide where pages end. The measured tree is
 * flattened into spans that must not be divided, and pages are filled greedily
 * without dividing one.
 */

export { buildFragmentModel } from "./atoms.js";
export type { AtomKind, BreakAtom, ForcedBreak, FragmentModel } from "./atoms.js";
export {
  applyStranding,
  collectLineBlocks,
  strandingPositions,
} from "./stranding.js";
export type { LineBlock, StrandingDefaults } from "./stranding.js";
export { paginate } from "./paginate.js";
export type { PageSlice, PaginateOptions } from "./paginate.js";
